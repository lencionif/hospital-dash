// filename: bossrush.entities.js
// 3 Bosses (uno por nivel): hematológico, jefa de limpieza (desmayada) y paciente psiquiátrica.
// - Cronómetro 5:00 en HUD, arranca cuando no quedan pacientes normales.
// - Si muere el boss -> GAME OVER.
// - Limpieza: llama a cleaners al activarse el cronómetro.
// - Psiquiatría: se mueve poco, crea fuego cerca y evita pisarlo (90%).
(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const TILE = (W.TILE_SIZE || W.TILE || 32);
  const RNG = Math.random;
  const CLAMP = (v, a, b) => Math.max(a, Math.min(b, v));
  const LEN2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const AABB = (a, b) => (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);
  const CENTER = (e) => ({ x: e.x + e.w * 0.5, y: e.y + e.h * 0.5 });

  W.Entities = W.Entities || {};
  const E = W.Entities;

  // =================== HUD: cronómetro ===================
  const BossHUD = {
    el: null,
    ensure() {
      if (typeof document === 'undefined') return;
      if (this.el && this.el.parentNode) return;
      const hud = document.getElementById('hud') || document.querySelector('.hud');
      if (!hud) return;
      const left = hud.querySelector('.hud-left') || hud;
      let el = document.getElementById('bossTimer');
      if (!el) {
        el = document.createElement('div');
        el.id = 'bossTimer';
        el.className = 'pill';
        el.textContent = '⏱️ 05:00';
        left.appendChild(el);
      }
      this.el = el;
    },
    set(sec) {
      this.ensure();
      if (!this.el) return;
      const s = Math.max(0, Math.floor(sec|0));
      const m = Math.floor(s / 60);
      const r = s % 60;
      this.el.textContent = `⏱️ ${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`;
      this.el.style.borderColor = (s<=20 ? '#ff6b6b' : '#2b3347');
      this.el.style.color = (s<=20 ? '#ffd5d5' : '#cfe0ff');
    },
    hide() {
      if (this.el) this.el.style.display = 'none';
    },
    show() {
      if (this.el) this.el.style.display = '';
    }
  };

  // =================== Helpers mapa/colisión ===================
  function tileAt(x, y) {
    const tx = Math.floor(CLAMP(x, 0, G.mapW * TILE - 1) / TILE);
    const ty = Math.floor(CLAMP(y, 0, G.mapH * TILE - 1) / TILE);
    return { tx, ty };
  }
  function walkableXY(nx, ny) {
    const tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
    const grid = G.collisionGrid || G.map;
    const ok = grid?.[ty]?.[tx] === 0;
    return !!ok;
  }

  // =================== Fuego (fallback si no hay API) ===================
  function spawnFire(x, y, p = {}) {
    if (W.ObjectsAPI?.spawnFire) return W.ObjectsAPI.spawnFire(x, y, p);
    // Fallback simplito
    const e = {
      id: 'fire_' + Math.random().toString(36).slice(2),
      kind: 'hazard',
      sub: 'fire',
      x: x - TILE * 0.4,
      y: y - TILE * 0.4,
      w: TILE * 0.8,
      h: TILE * 0.8,
      ttl: (p.ttl || 6000) | 0,
      dmgPerSec: p.dps || 0.5,
      update(dt) {
        this.ttl -= dt * 1000;
        if (this.ttl <= 0) this.dead = true;
      },
      draw(ctx) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#ff7a00';
        ctx.fillRect(this.x, this.y, this.w, this.h);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#ffd54d';
        ctx.fillRect(this.x + 3, this.y + 3, this.w - 6, this.h - 6);
        ctx.restore();
      }
    };
    (G.entities || (G.entities = [])).push(e);
    return e;
  }
  function isFireAtRect(rect) {
    return (G.entities || []).some(e => e && !e.dead && e.kind === 'hazard' && e.sub === 'fire' && AABB(rect, e));
  }

  // =================== GAME OVER / Score ===================
  function triggerGameOver(reason = 'boss_dead') {
    G.state = 'GAMEOVER';
    if (W.Audio?.duck) { try { W.Audio.duck(true); } catch (e) {} }
    // Mostrar overlay (compat con dos variantes de IDs)
    const el1 = (typeof document !== 'undefined') ? document.getElementById('game-over-screen') : null;
    const el2 = (typeof document !== 'undefined') ? document.getElementById('screen-gameover') : null;
    if (el1 && el1.classList) el1.classList.remove('hidden');
    if (el2 && el2.classList) el2.classList.remove('hidden');
    // Penaliza puntuación si hay API
    if (W.ScoreAPI?.onPatientDied) {
      try { ScoreAPI.onPatientDied(1, { who: 'boss', reason }); } catch (e) {}
    }
  }

  // =================== Módulo Boss Phase ===================
  const BossPhase = {
    active: false,
    timeLeft: 300,         // 5 minutos
    firedCallCleaners: false,
    rescueTiles: 2.0,      // distancia del carro al boss (en losetas) para detener el timer
    start(boss) {
      this.active = true;
      this.firedCallCleaners = false;
      this.timeLeft = 300;
      BossHUD.show();
      BossHUD.set(this.timeLeft);
      // Hook especial: jefa de limpieza llama a cleaners
      if (boss?.subtype === 'jefa_limpieza') {
        this.callAllCleanersTo(boss);
        this.firedCallCleaners = true;
      }
    },
    stop() {
      this.active = false;
      BossHUD.hide();
    },
    tick(dt, boss) {
      if (!this.active || !boss || boss.dead) return;
      this.timeLeft -= dt;
      BossHUD.set(this.timeLeft);
      if (this.timeLeft <= 0) {
        // Se “muere” el paciente especial por tiempo
        boss.dead = true;
        triggerGameOver('timeout');
        this.stop();
        return;
      }
      // ¿Carro cerca? → Detener timer
      const cart = G.cart;
      if (cart && !cart.dead) {
        const bc = CENTER(boss), cc = CENTER(cart);
        const rad = this.rescueTiles * TILE;
        if (LEN2(bc.x, bc.y, cc.x, cc.y) <= rad * rad) {
          this.stop();
        }
      }
    },
    // Llamada a cleaners (API si existe, si no, fallback)
    callAllCleanersTo(boss) {
      const target = CENTER(boss);
      if (W.CleanerAPI?.callAllTo) {
        try { W.CleanerAPI.callAllTo(target.x, target.y, { reason: 'boss_cleaner' }); return; } catch (e) {}
      }
      // Fallback: buscar NPCs con sub/role “cleaner”
      (G.npcs || []).forEach(n => {
        const tag = (n.sub || n.role || n.kind || '').toLowerCase();
        if (tag.includes('clean')) {
          n.goalX = target.x; n.goalY = target.y;
          n.intent = 'goto_boss';
        }
      });
    }
  };

  // =================== Base Boss ===================
  function makeBaseBoss(x, y, subtype, p = {}) {
    const e = {
      id: 'boss_' + subtype + '_' + Math.random().toString(36).slice(2),
      kind: 'boss',
      isBoss: true,
      subtype,
      x, y,
      w: TILE * 0.9,
      h: TILE * 0.9,
      hp: 1,
      cured: false,
      dead: false,
      // Dibujo fallback si no hay sprites
      draw(ctx) {
        ctx.save();
        ctx.fillStyle = (subtype === 'psiquiatrica') ? '#c07cff'
                      : (subtype === 'jefa_limpieza') ? '#7ce9ff'
                      : '#ffd1dc';
        ctx.fillRect(this.x, this.y, this.w, this.h);
        ctx.restore();
      },
      // Muerte = GAME OVER
      kill(reason = 'killed') {
        if (this.dead) return;
        this.dead = true;
        triggerGameOver(reason);
      },
      // Update común: vigila arranque de fase y tickea cronómetro
      update(dt) {
        // Arranque del cronómetro si no quedan pacientes “normales”
        if (!BossPhase.active && countNormalPatientsAlive() === 0) {
          BossPhase.start(this);
        }
        // Tick cronómetro (si activo)
        BossPhase.tick(dt, this);
      }
    };
    const rig = (subtype === 'psiquiatrica') ? 'boss3_pyro' : (subtype === 'jefa_limpieza' ? 'boss2_fainted' : 'boss1_bed');
    if (!e.skin) {
      e.skin = (subtype === 'psiquiatrica') ? 'boss_nivel3.png' : (subtype === 'jefa_limpieza' ? 'boss_nivel2.png' : 'boss_nivel1.png');
    }
    // Asegura presencia global
    G.boss = e;
    if (!G.entities.includes(e)) G.entities.push(e);
    if (!G.patients.includes(e)) G.patients.push(e);
    try {
    const puppet = window.Puppet?.bind?.(e, rig, { z: 0, scale: 1, data: { skin: e.skin } })\n      || W.PuppetAPI?.attach?.(e, { rig, z: 0, scale: 1, data: { skin: e.skin } });
    e.rigOk = e.rigOk === true || !!puppet;
  } catch (_) {
    e.rigOk = e.rigOk === true;
  }
    return e;
  }

  function countNormalPatientsAlive() {
    const arr = G.patients || [];
    let c = 0;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (!p || p.dead) continue;
      // “Normales” = pacientes que NO son boss y no están ya entregados
      if (!p.isBoss && !p.delivered) c++;
    }
    return c;
  }

  // =================== Boss: Hematológico (quieto) ===================
  function spawnHematologico(x, y, p = {}) {
    const e = makeBaseBoss(x, y, 'hematologico', p);
    e.hp = 1; // si recibe daño por error, muere (y hace GAME OVER)
    // Sin movimiento.
    return e;
  }

  // =================== Boss: Jefa de limpieza (desmayada, llama cleaners) ===================
  function spawnJefaLimpieza(x, y, p = {}) {
    const e = makeBaseBoss(x, y, 'jefa_limpieza', p);
    e.hp = 1;
    // Quieto; la llamada a cleaners la hace BossPhase.start() al activar el timer.
    return e;
  }

  // =================== Boss: Psiquiátrica (mueve poco, crea fuego, evita fuego) ===================
  function spawnPsiquiatrica(x, y, p = {}) {
    const e = makeBaseBoss(x, y, 'psiquiatrica', p);
    e.hp = 1;
    e.wanderCooldown = 0;          // tiempo hasta elegir otro micro-movimiento
    e.fireCooldown = 2.5 + RNG() * 2.5;    // primer fuego entre 2.5 y 5.0 s
    e.speed = 18; // px/s, muy lento

    e.update = function(dt) {
      // Base (arranque de fase + cronómetro)
      if (!BossPhase.active && countNormalPatientsAlive() === 0) {
        BossPhase.start(this);
      }
      BossPhase.tick(dt, this);

      if (this.dead) return;

      // Micro-wander (poco movimiento)
      this.wanderCooldown -= dt;
      if (this.wanderCooldown <= 0) {
        this.wanderCooldown = 0.8 + RNG() * 1.2;
        // Probar un pequeño paso (máx 1/2 loseta) evitando fuego
        const dir = pickSafeDirAvoidingFire(this, 0.9); // 90% evitar
        const step = (TILE * (0.35 + RNG() * 0.25));
        const nx = this.x + dir.dx * step * (dt * this.speed / Math.max(1, this.speed));
        const ny = this.y + dir.dy * step * (dt * this.speed / Math.max(1, this.speed));
        const rect = { x: nx, y: ny, w: this.w, h: this.h };
        if (walkableXY(nx + this.w * 0.5, ny + this.h * 0.5) && !isFireAtRect(rect)) {
          this.x = nx; this.y = ny;
        }
      }

      // Generar fuego cerca de ella cada X segundos
      this.fireCooldown -= dt;
      if (this.fireCooldown <= 0) {
        this.fireCooldown = 3.5 + RNG() * 3.5;
        const c = CENTER(this);
        // Offset aleatorio en 1–1.5 tiles
        const ang = RNG() * Math.PI * 2;
        const rad = TILE * (1 + RNG() * 0.5);
        const fx = c.x + Math.cos(ang) * rad;
        const fy = c.y + Math.sin(ang) * rad;
        spawnFire(fx, fy, { ttl: 6000, dps: 0.5 });
      }
    };

    return e;
  }

  function pickSafeDirAvoidingFire(e, avoidProb = 0.9) {
    // 8 direcciones; decide la que evita fuego con probabilidad alta
    const dirs = [
      { dx:  1, dy:  0 }, { dx: -1, dy:  0 }, { dx: 0, dy:  1 }, { dx: 0, dy: -1 },
      { dx:  1, dy:  1 }, { dx:  1, dy: -1 }, { dx: -1, dy: 1 }, { dx: -1, dy: -1 }
    ];
    // Escoge una al azar, pero si detecta fuego en ese “siguiente rect”, re-tira con probabilidad 90%
    for (let tries = 0; tries < 3; tries++) {
      const d = dirs[(Math.random() * dirs.length) | 0];
      const nx = e.x + d.dx * TILE * 0.5;
      const ny = e.y + d.dy * TILE * 0.5;
      const rect = { x: nx, y: ny, w: e.w, h: e.h };
      const fireAhead = isFireAtRect(rect);
      if (!fireAhead) return d;
      // 10% se arriesga igualmente
      if (Math.random() > avoidProb) return d;
    }
    // Si todo falla, quieto
    return { dx: 0, dy: 0 };
  }

  // =================== API pública ===================
  const BossAPI = {
    /**
     * spawn(x, y, p)
     * p.sub puede ser: 'hematologico' | 'psiquiatrica' | 'jefa_limpieza'
     * Si no llega, se decide por nivel (1: hema, 2: psiq, 3+: jefa).
     */
    spawn(x, y, p = {}) {
      const level = (W.GameFlowAPI && W.GameFlowAPI.getLevel && W.GameFlowAPI.getLevel()) || G.level || 1;
      const sub = (p.sub || p.kind || p.type || '').toLowerCase() ||
                  (level === 1 ? 'hematologico' : level === 2 ? 'psiquiatrica' : 'jefa_limpieza');

      let e;
      if (sub === 'psiquiatrica') e = spawnPsiquiatrica(x, y, p);
      else if (sub === 'jefa_limpieza' || sub === 'jefa' || sub === 'limpieza') e = spawnJefaLimpieza(x, y, p);
      else e = spawnHematologico(x, y, p); // por defecto

      // Registro global
      if (!G.entities.includes(e)) G.entities.push(e);
      if (!G.patients.includes(e)) G.patients.push(e);
      G.boss = e;

      return e;
    },

    // Utilidad: consulta si el cronómetro está activo y el tiempo restante
    isActive() { return BossPhase.active; },
    getTimeLeft() { return BossPhase.timeLeft; },
    forceStartTimer() { if (G.boss) BossPhase.start(G.boss); },
    forceStopTimer() { BossPhase.stop(); }
  };

  // Exponer en Entities
  E.Boss = E.Boss || {};
  E.Boss.spawn = (x, y, p) => BossAPI.spawn(x, y, p);

  // Por comodidad, exponer BossAPI también en global
  W.BossAPI = BossAPI;

})(this);