// filename: mosquito.entities.js
// Enemigo MOSQUITO para “Il Divo: Hospital Dash!”
//
// ✔ Pobla al inicio (según cap / lo que pidas)
// ✔ Re-spawn SOLO al morir, con cooldown interno
// ✔ IA: persecución + zig-zag + anti-choque con pared
// ✔ Evita spawnear dentro de cámara (offscreen preferente)
// ✔ Sonido de zumbido (si AudioAPI existe)
// ✔ Integra con Physics si está disponible
//
// API pública (window.MosquitoAPI):
//   init(G?, opts?)                        // engancha auto a tu loop (G.systems si existe)
//   registerSpawn(tx, ty)                  // registra un punto (en tiles)
//   registerExistingSpawns()               // detecta entidades marcador si las hubiese
//   spawn(x, y, payload?)                  // crea 1 mosquito en PIXELES (para otros sistemas)
//   spawnAtTiles(tx, ty, payload?)         // crea 1 mosquito en TILES
//   populateAtStart(n?)                    // crea N al inicio (por defecto hasta cfg.maxAlive)
//   onEnemyKilled(entity)                  // llámala cuando un mosquito muere (programa respawn)
//   update(dt)                             // la llama el sistema autoenganchado
//
// Opciones (opts):
//   { maxAlive=1, respawnDelay=5, speed=18, accel=220, zigAmp=40, zigFreq=1.25,
//     touchDamage=1, touchCooldown=0.7, avoidLookAhead=18, offscreenMin=240,
//     body:{ mass:0.02, restitution:0.1, friction:0.02, dynamic:true, solid:true } }

(function () {
  'use strict';

  const MosquitoAPI = {
    G: null,
    TILE: 32,
    _hooked: false,

    cfg: {
      maxAlive: 1,          // cap simultáneo
      respawnDelay: 5,      // s tras morir
      speed: 18,            // px/s objetivo
      accel: 220,           // px/s^2
      zigAmp: 40,           // amplitud zigzag
      zigFreq: 1.25,        // Hz zigzag
      touchDamage: 1,       // daño al tocar jugador
      touchCooldown: 0.7,   // s entre toques
      avoidLookAhead: 18,   // sonda anti pared (px)
      offscreenMin: 240,    // evita spawns dentro cámara
      crushImpulse: 110,    // umbral “aplastado por carro”
      hurtImpulse: 45,
      body: {
        mass: 0.02,
        restitution: 0.1,
        friction: 0.02,
        dynamic: true,
        solid: true
      }
    },

    spawns: [],       // [{tx,ty}]
    live: new Set(),  // entidades mosquito vivas
    pending: [],      // [{at:{tx,ty}, t:secs}] para respawns diferidos
    t: 0,             // reloj local

    /* --------------------------- INIT / HOOK --------------------------- */
    init(Gref, opts = {}) {
      this.G = Gref || window.G || (window.G = {});
      this.TILE = (typeof window.TILE_SIZE !== 'undefined') ? window.TILE_SIZE : 32;
      Object.assign(this.cfg, opts || {});
      if (!Array.isArray(this.G.enemies))  this.G.enemies  = [];
      if (!Array.isArray(this.G.entities)) this.G.entities = [];

      // engánchate a tu loop si existe G.systems; si no, ticker suave
      if (!this._hooked) {
        if (Array.isArray(this.G.systems)) {
          this.G.systems.push({ id: 'mosquito_system', update: (dt) => this.update(dt) });
        } else {
          let _last = nowSec();
          const tick = () => {
            try {
              const t = nowSec(); const dt = clamp(t - _last, 0, 0.25); _last = t;
              this.update(dt);
            } catch (_) {}
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
        this._hooked = true;
      }
      return this;
    },

    /* --------------------------- REGISTRO PUNTOS ----------------------- */
    // Llamar desde parseMap cuando leas una 'M' (tiles)
    registerSpawn(tx, ty) {
      this.spawns.push({ tx, ty });
    },

    // Si ya creaste marcadores de spawn como entidades, los registra
    registerExistingSpawns() {
      const ENT = this.G.ENT || {};
      for (const e of (this.G.entities || [])) {
        if (!e) continue;
        if (e.kind === ENT.SPAWN_MOSQUITO || e.tag === 'spawn_mosquito') {
          const tx = Math.round(e.x / this.TILE), ty = Math.round(e.y / this.TILE);
          this.registerSpawn(tx, ty);
        }
      }
    },

    /* --------------------------- POBLACIÓN INICIAL --------------------- */
    // Crea N mosquitos al iniciar (por defecto hasta el cap maxAlive)
    populateAtStart(n) {
      const target = Math.max(0, Number.isFinite(n) ? n|0 : this.cfg.maxAlive|0);
      while (this.live.size < target) {
        const pt = this._pickSpawnOffscreen();
        if (!pt) break;
        this._spawnAt(pt.tx, pt.ty);
      }
    },

    /* --------------------------- UPDATE POR FRAME ---------------------- */
    update(dt) {
      this.t += dt;

      // 1) IA y daño por contacto
      for (const e of [...this.live]) {
        if (!e || e.dead) continue;
        this._updateOne(e, dt);
      }

      // 2) Respawns diferidos
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const it = this.pending[i];
        it.t -= dt;
        if (it.t <= 0) {
          if (this.live.size < this.cfg.maxAlive) {
            const pt = this._pickSpawnOffscreen(it.at); // intenta misma; si no, otra offscreen
            if (pt) this._spawnAt(pt.tx, pt.ty);
          }
          this.pending.splice(i, 1);
        }
      }
    },

    /* --------------------------- EVENTOS MUERTE ------------------------ */
    // Llamar cuando un mosquito muere (por carro, etc.)
    onEnemyKilled(e) {
      if (!e || !this.live.has(e)) return;
      this._kill(e, { scheduleRespawn: true });
    },

    /* --------------------------- FACTORÍAS ----------------------------- */
    // Pública en PIXELES (compatible con SpawnerManager / Systems externos)
    spawn(x, y, payload = {}) {
      const tx = Math.floor((x / this.TILE) + 0.5);
      const ty = Math.floor((y / this.TILE) + 0.5);
      return this._spawnAt(tx, ty, payload);
    },

    // Pública en TILES
    spawnAtTiles(tx, ty, payload = {}) {
      return this._spawnAt(tx|0, ty|0, payload);
    },

    // ====== Internos ======
    _spawnAt(tx, ty, payload = {}) {
      const ENT = this.G.ENT || {};
      const x = tx * this.TILE + this.TILE * 0.2;
      const y = ty * this.TILE + this.TILE * 0.2;
      const w = this.TILE * 0.6, h = this.TILE * 0.6;

      const e = {
        kind: ENT.MOSQUITO || 'mosquito',
        x, y, w, h,
        vx: 0, vy: 0,
        color: '#8B5CF6',
        solid: this.cfg.body.solid,
        dynamic: this.cfg.body.dynamic,
        pushable: false,
        mass: this.cfg.body.mass,
        restitution: this.cfg.body.restitution,
        friction: this.cfg.body.friction,
        t: 0,
        touchCD: 0,
        ai: { lastDirX: 0, lastDirY: 0 },
        ...payload
      };

      if (window.PuppetAPI) {
        e.puppet = { rig:'mosquito', z:4 };
        try { PuppetAPI.attach(e, e.puppet); } catch(_){}
      }

      e.touchDamage = 0.5;
      e.touchCooldown = 1.0;

      // Bucle de zumbido (si AudioAPI existe)
      if (window.AudioAPI) {
        e._buzz = null;
        (async () => {
          e._buzz = await AudioAPI.playLoopAttached('mosquito_buzz', () => ({ x: e.x, y: e.y }), {
            group: 'ambient', volume: 0.55, falloff: 420
          });
        })();
      }

      this.G.entities.push(e);
      this.G.enemies.push(e);
      this.live.add(e);

      // Física
      if (window.Physics && Physics.registerEntity) Physics.registerEntity(e);

      return e;
    },

    _updateOne(e, dt) {
      e.t += dt;
      if (e.touchCD > 0) e.touchCD = Math.max(0, e.touchCD - dt);

      const p = this.G.player;
      if (!p) return;

      // 1) Dirección hacia el jugador
      const dx = (p.x + p.w * 0.5) - (e.x + e.w * 0.5);
      const dy = (p.y + p.h * 0.5) - (e.y + e.h * 0.5);
      let ang = Math.atan2(dy, dx);
      let dirx = Math.cos(ang), diry = Math.sin(ang);

      // 2) Zig-zag perpendicular
      const sin = Math.sin(e.t * Math.PI * 2 * this.cfg.zigFreq);
      const px = -diry, py = dirx; // perpendicular
      const zigx = px * this.cfg.zigAmp * sin;
      const zigy = py * this.cfg.zigAmp * sin;

      // 3) Evita paredes (look-ahead)
      const la = this.cfg.avoidLookAhead;
      if (this._willHitWall(e.x + dirx * la, e.y + diry * la, e.w, e.h)) {
        const leftAng = ang + 0.9, rightAng = ang - 0.9;
        const lx = Math.cos(leftAng), ly = Math.sin(leftAng);
        const rx = Math.cos(rightAng), ry = Math.sin(rightAng);
        const lHit = this._willHitWall(e.x + lx * la, e.y + ly * la, e.w, e.h);
        const rHit = this._willHitWall(e.x + rx * la, e.y + ry * la, e.w, e.h);
        if (lHit && !rHit) { dirx = rx; diry = ry; ang = rightAng; }
        else if (!lHit && rHit) { dirx = lx; diry = ly; ang = leftAng; }
        else { dirx = px; diry = py; ang = Math.atan2(diry, dirx); }
      }

      // 4) Velocidad objetivo
      const targetVx = dirx * this.cfg.speed + zigx * 0.12;
      const targetVy = diry * this.cfg.speed + zigy * 0.12;

      // 5) Acelerar hacia objetivo
      const ax = clamp(targetVx - e.vx, -this.cfg.accel, this.cfg.accel);
      const ay = clamp(targetVy - e.vy, -this.cfg.accel, this.cfg.accel);

      if (window.Physics && Physics.applyImpulse) {
        Physics.applyImpulse(e, ax * dt * e.mass, ay * dt * e.mass);
      } else {
        e.vx += ax * dt; e.vy += ay * dt;
        e.x += e.vx * dt; e.y += e.vy * dt;
      }

      // 6) Daño por contacto al jugador (con cooldown)
      if (!window.DamageAPI && this._nearAABB(e, p, 4) && e.touchCD <= 0) {
        if (this.G.hurt) this.G.hurt(this.cfg.touchDamage, { source: e });
        e.touchCD = this.cfg.touchCooldown;
        const kb = 60;
        if (window.Physics && Physics.applyImpulse) Physics.applyImpulse(p, dirx * kb, diry * kb);
        else { p.vx += dirx * 60; p.vy += diry * 60; }
        if (window.AudioAPI) AudioAPI.play('hurt', { volume: 0.9, throttleMs: 100 });
      }

      // 7) Muerte por aplastamiento (carro rápido)
      const cart = this._cartHit(e);
      if (cart && this._relativeImpulse(e, cart) >= this.cfg.crushImpulse) {
        this._kill(e, { scheduleRespawn: true });
        if (window.AudioAPI) AudioAPI.play('mosquito_die', { at: { x: e.x, y: e.y }, volume: 0.9 });
        return;
      }
    },

    _kill(e, { scheduleRespawn = false } = {}) {
      if (!e || e.dead) return;
      e.dead = true;

      // corta zumbido
      if (e._buzz) { try { e._buzz.stop(); } catch (_) {} e._buzz = null; }

      // limpia listas
      this.live.delete(e);
      this.G.enemies  = (this.G.enemies  || []).filter(x => x !== e);
      this.G.entities = (this.G.entities || []).filter(x => x !== e);

      // programa respawn
      if (scheduleRespawn && this.spawns.length > 0) {
        const at = this.spawns[(Math.random() * this.spawns.length) | 0];
        this.pending.push({ at, t: this.cfg.respawnDelay });
      }
    },

    /* --------------------------- UTILIDADES ---------------------------- */
    _willHitWall(nx, ny, w, h) {
      if (typeof window.isWallAt === 'function') return !!window.isWallAt(nx, ny, w, h);
      // Fallback: si no hay función, asumimos libre
      return false;
    },

    _nearAABB(a, b, pad = 0) {
      return !(a.x + a.w <= b.x - pad || b.x + b.w <= a.x - pad || a.y + a.h <= b.y - pad || b.y + b.h <= a.y - pad);
    },

    _cartHit(e) {
      const ENT = this.G.ENT || {};
      for (const k of (this.G.entities || [])) {
        if (!k) continue;
        if (!(k.kind === ENT.CART || k.kind === ENT.CART_FOOD || k.kind === ENT.CART_MED || k.kind === ENT.CART_URG)) continue;
        if (this._nearAABB(e, k, 0)) return k;
      }
      return null;
    },

    _relativeImpulse(a, b) {
      const ax = a.vx || 0, ay = a.vy || 0;
      const bx = b.vx || 0, by = b.vy || 0;
      const rvx = ax - bx, rvy = ay - by;
      const relSpeed = Math.hypot(rvx, rvy);
      const ma = a.mass || 0.02, mb = b.mass || 120;
      const mred = (ma * mb) / (ma + mb);
      return relSpeed * mred;
    },

    _pickSpawnOffscreen(prefer) {
      const cam = this.G.camera || { x: 0, y: 0, w: 9999, h: 9999 };
      const off = this.cfg.offscreenMin;
      const arr = [...this.spawns];
      // ordena por distancia a cámara para preferir fuera
      arr.sort((a, b) => this._distToCam(b, cam) - this._distToCam(a, cam));
      if (prefer) {
        if (this._distToCam(prefer, cam) > off) return prefer;
      }
      for (const s of arr) {
        if (this._distToCam(s, cam) > off) return s;
      }
      // si todas están “cerca”, usa la primera
      return arr[0] || null;
    },

    _distToCam(sp, cam) {
      const x = sp.tx * this.TILE + this.TILE / 2;
      const y = sp.ty * this.TILE + this.TILE / 2;
      const cx = clamp(x, cam.x, cam.x + cam.w);
      const cy = clamp(y, cam.y, cam.y + cam.h);
      const dx = x - cx, dy = y - cy;
      return Math.hypot(dx, dy);
    }
  };

  /* --------------------------- Helpers sueltos ------------------------- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function nowSec(){ return (window.performance?.now ? performance.now() : Date.now()) / 1000; }

  // Export
  window.MosquitoAPI = MosquitoAPI;
})();