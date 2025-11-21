// assets/plugins/entities/fire.entities.js
// Peligro de fuego dibujado en canvas (sin sprites)
(function(){
  'use strict';

  const W = window;
  const G = W.G || (W.G = {});
  const TILE = (typeof W.TILE_SIZE !== 'undefined') ? W.TILE_SIZE : (W.TILE || 32);
  const DEBUG_FIRE = W.DEBUG_FIRE === true;

  const MAX_ACTIVE = 64;
  const TTL_RANGE = [8, 15];
  const SPREAD_RANGE = [0.7, 1.2];
  const SPREAD_PROB = 0.72;
  const HP_PER_HEART = 1;
  const FIRE_DPS = 0.5 * HP_PER_HEART; // medio corazón por segundo
  const MIN_DMG_CHUNK = 0.25; // aplica en cuartos de corazón para precisión
  const BASE_SIZE = TILE * 0.82;
  const EXT_RADIUS = TILE * 0.6;

  const FireAPI = {
    _list: [],

    /** Crea fuego en la casilla (tx,ty). */
    spawnAtTile(tx, ty, opts = {}){
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
      const px = tx * TILE + TILE * 0.5;
      const py = ty * TILE + TILE * 0.5;
      return this.spawnAtPx(px, py, Object.assign({}, opts, { tx, ty }));
    },

    /** Crea fuego usando coordenadas de píxel. */
    spawnAtPx(x, y, opts = {}){
      const tx = (opts.tx != null) ? opts.tx : Math.floor(x / TILE);
      const ty = (opts.ty != null) ? opts.ty : Math.floor(y / TILE);
      if (this._isWet(tx, ty, x, y)) return null;
      if (!this._canPlace(tx, ty)) return null;
      if (this.isFireAt(tx, ty)) return null;
      if (this._list.length >= MAX_ACTIVE){
        // elimina el más antiguo
        this._list.sort((a,b)=> (a.born||0)-(b.born||0));
        this._list.shift();
      }
      const size = opts.size ?? BASE_SIZE;
      const fire = {
        id: opts.id || `fire-${Math.random().toString(36).slice(2,8)}`,
        x: x - size * 0.5,
        y: y - size * 0.5,
        tx,
        ty,
        w: size,
        h: size,
        ttl: (opts.ttl != null) ? opts.ttl : randRange(TTL_RANGE[0], TTL_RANGE[1]),
        intensity: opts.intensity ?? randRange(0.7, 1.2),
        spreadTimer: randRange(SPREAD_RANGE[0], SPREAD_RANGE[1]),
        seed: Math.random() * Math.PI * 2,
        dead: false,
        hazard: 'fire',
        source: opts.source || null,
        _damageAcc: 0,
        born: W.performance?.now?.() || Date.now()
      };
      this._list.push(fire);
      if (DEBUG_FIRE) console.debug('[Fire] spawn', { tx, ty, id: fire.id });
      return fire;
    },

    /**
     * Lógica principal de fuego: ttl, propagación, daño y auto-extinción por agua.
     */
    updateAll(dt = 0){
      const wet = W.CleanerAPI;
      const entities = Array.isArray(G.entities) ? G.entities : [];
      const player = G.player;
      const survivors = [];

      for (const fire of this._list){
        if (!fire || fire.dead) continue;

        // Agua apaga
        if (this._isWet(fire.tx, fire.ty, fire.x + fire.w*0.5, fire.y + fire.h*0.5)){
          this.extinguish(fire, { cause: 'agua', tileX: fire.tx, tileY: fire.ty, x: fire.x + fire.w*0.5, y: fire.y + fire.h*0.5 });
          continue;
        }

        fire.ttl -= dt;
        if (fire.ttl <= 0){
          this.extinguish(fire, { cause: 'ttl' });
          continue;
        }

        // Propagación
        fire.spreadTimer -= dt;
        if (fire.spreadTimer <= 0){
          this._trySpreadFrom(fire);
          fire.spreadTimer = randRange(SPREAD_RANGE[0], SPREAD_RANGE[1]);
        }

        // Daño a entidades
        if (player) this._damageEntity(player, fire, dt);
        for (const e of entities){
          if (!e || e.dead || e === player) continue;
          this._damageEntity(e, fire, dt);
        }

        survivors.push(fire);
      }

      this._list = survivors;
      return this._list;
    },

    /** Dibuja todas las llamas en el canvas del mundo. */
    renderAll(ctx, camera){
      if (!ctx) return;
      const camX = camera?.x || 0;
      const camY = camera?.y || 0;
      const zoom = camera?.zoom || 1;
      const cull = Math.max(W.VIEW_W || 0, W.VIEW_H || 0) * 0.7 / (zoom||1);
      for (const fire of this._list){
        if (!fire || fire.dead) continue;
        const cx = fire.x + fire.w * 0.5;
        const cy = fire.y + fire.h * 0.5;
        if (cull && Math.hypot(cx - camX, cy - camY) > cull) continue;
        drawFlame(ctx, fire);
      }
    },

    /** Devuelve los focos de fuego activos. */
    getActive(){
      return this._list.filter(f => f && !f.dead);
    },

    /** Apaga una instancia concreta. */
    extinguish(fire, opts = {}){
      if (!fire || fire.dead) return false;
      fire.dead = true;
      this._onExtinguish(fire, opts);
      if (DEBUG_FIRE) console.debug('[Fire] extinguish', { id: fire.id, reason: opts.cause });
      return true;
    },

    /** Apaga fuego cerca de una posición en píxeles. */
    extinguishAt(x, y, opts = {}){
      const radius = Number.isFinite(opts.radius) ? opts.radius : EXT_RADIUS;
      const r2 = radius * radius;
      let hit = false;
      for (const fire of this.getActive()){
        const fx = fire.x + fire.w * 0.5;
        const fy = fire.y + fire.h * 0.5;
        const dx = fx - x;
        const dy = fy - y;
        if (dx*dx + dy*dy <= r2){
          hit = this.extinguish(fire, Object.assign({}, opts, { x: fx, y: fy, tileX: fire.tx, tileY: fire.ty })) || hit;
        }
      }
      return hit;
    },

    /** Apaga el fuego en una casilla concreta. */
    extinguishAtTile(tx, ty, opts = {}){
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
      const px = tx * TILE + TILE * 0.5;
      const py = ty * TILE + TILE * 0.5;
      return this.extinguishAt(px, py, Object.assign({
        radius: EXT_RADIUS,
        tileX: tx,
        tileY: ty
      }, opts));
    },

    /** Devuelve true si ya hay fuego en la casilla. */
    isFireAt(tx, ty){
      return this._list.some(f => f && !f.dead && f.tx === tx && f.ty === ty);
    },

    // -------- Compatibilidad con APIs previas --------
    spawnFire(tx, ty, opts){ return this.spawnAtTile(tx, ty, opts); },
    spawn(x, y, opts){ return this.spawnAtPx(x, y, opts); },
    spawnPx(x, y, opts){ return this.spawnAtPx(x, y, opts); },
    update(dt){ return this.updateAll(dt); },
    render(ctx, camera){ return this.renderAll(ctx, camera); },
    spawnImpact(x, y, impulse, meta = {}){
      const base = Math.max(1, meta.threshold || 1);
      if (!(impulse >= base)) return null;
      const ratio = Math.max(0, (impulse - base) / base);
      return this.spawnAtPx(x, y, Object.assign({}, meta, {
        ttl: (meta.ttl ?? randRange(TTL_RANGE[0], TTL_RANGE[1])) + ratio * 2,
        intensity: (meta.intensity ?? 1) * (1 + ratio * 0.35)
      }));
    },

    // -------- Internas --------
    _damageEntity(ent, fire, dt){
      if (!ent || ent.dead || ent.fireImmune) return;
      if (!aabb(ent, fire)) return;
      const amount = FIRE_DPS * dt;
      if (!(amount > 0)) return;
      ent._fireAccum = (ent._fireAccum || 0) + amount;
      if (ent._fireAccum < MIN_DMG_CHUNK) return;
      const chunk = ent._fireAccum;
      ent._fireAccum = 0;

      const meta = { cause: 'fire', source: fire };
      if (typeof ent.takeDamage === 'function'){
        try { ent.takeDamage(Math.max(1, Math.round(chunk * 2)), meta); return; } catch(_){}
      }
      if (typeof ent.applyDamage === 'function' && chunk >= 1){
        try { ent.applyDamage(chunk, meta); return; } catch(_){}
      }
      if (typeof ent.hp === 'number'){
        ent.hp = Math.max(0, ent.hp - chunk);
        if (typeof ent.hpMax === 'number') ent.hp = Math.min(ent.hpMax, ent.hp);
        if (ent.hp <= 0) ent.dead = ent.dead || (ent === G.player ? ent.dead : true);
      }
      if (typeof ent.health === 'number'){
        ent.health = Math.max(0, ent.health - chunk);
      }
    },

    _trySpreadFrom(fire){
      const dirs = [ [1,0], [-1,0], [0,1], [0,-1] ];
      for (const [dx, dy] of dirs){
        const nx = fire.tx + dx;
        const ny = fire.ty + dy;
        if (!this._canPlace(nx, ny)) continue;
        if (this.isFireAt(nx, ny)) continue;
        if (this._isWet(nx, ny)) continue;
        if (Math.random() <= SPREAD_PROB){
          this.spawnAtTile(nx, ny, { source: fire.id });
          if (DEBUG_FIRE) console.debug('[Fire] spread', { from: {x:fire.tx,y:fire.ty}, to:{x:nx,y:ny} });
        }
      }
    },

    _canPlace(tx, ty){
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return false;
      if (W.Level?.isInsideBounds && !W.Level.isInsideBounds(tx, ty)) return false;
      if (W.Level?.isWalkable && !W.Level.isWalkable(tx, ty)) return false;
      if (W.Level?.isWall && W.Level.isWall(tx, ty)) return false;
      return true;
    },

    _isWet(tx, ty, px, py){
      const api = W.CleanerAPI;
      if (!api) return false;
      if (typeof api.isWetAtTile === 'function') return !!api.isWetAtTile(tx, ty);
      if (typeof api.isWetAtPx === 'function') return !!api.isWetAtPx(px, py);
      return false;
    },

    _onExtinguish(fire, opts = {}){
      const px = opts.x ?? (fire ? fire.x + fire.w*0.5 : null);
      const py = opts.y ?? (fire ? fire.y + fire.h*0.5 : null);
      const tx = opts.tileX ?? fire?.tx;
      const ty = opts.tileY ?? fire?.ty;
      try { W.CleanerAPI?.spawnSteamFx?.(px, py, Object.assign({ ttl: 800 }, opts.fx || {})); } catch(_){}
      try { W.AudioAPI?.play?.('steam_sizzle', { at: { x: px, y: py }, volume: opts.volume ?? 0.55 }); } catch(_){}
    }
  };

  // ---------- Helpers de dibujo y colisión ----------
  function aabb(a, b){
    return !(a.x + a.w <= b.x || a.x >= b.x + b.w || a.y + a.h <= b.y || a.y >= b.y + b.h);
  }

  function randRange(min, max){ return min + Math.random() * (max - min); }

  function drawFlame(ctx, fire){
    const t = (W.performance?.now?.() || Date.now()) * 0.001;
    const cx = fire.x + fire.w * 0.5;
    const cy = fire.y + fire.h * 0.5;
    const baseR = fire.w * 0.45;
    const flicker = 1 + Math.sin(t * 7 + fire.seed) * 0.12 + (Math.random()-0.5)*0.08;
    const heightMul = 1.1 + Math.sin(t * 5.3 + fire.seed*1.7) * 0.2;
    const radius = baseR * flicker * (fire.intensity || 1);
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.15, cx, cy, radius);
    grad.addColorStop(0, 'rgba(255, 250, 210, 0.95)');
    grad.addColorStop(0.35, 'rgba(255, 190, 90, 0.9)');
    grad.addColorStop(0.7, 'rgba(255, 90, 20, 0.6)');
    grad.addColorStop(1, 'rgba(120, 20, 5, 0)');

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, heightMul);
    ctx.translate(-cx, -cy);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(cx, cy - radius*0.15, radius*0.9, radius*1.25, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  W.FireAPI = FireAPI;
  W.Entities = W.Entities || {};
  W.Entities.Fire = FireAPI;

  // Hook de loop (similar a CleanerAPI)
  const _oldOnFrame = W.onFrame;
  W.onFrame = function(dt){
    if (typeof _oldOnFrame === 'function') _oldOnFrame(dt);
    try { FireAPI.updateAll(dt || 1/60); } catch(err){ if (DEBUG_FIRE) console.warn('[Fire] update error', err); }
  };
})();
