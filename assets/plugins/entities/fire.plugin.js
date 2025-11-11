// assets/plugins/entities/fire.plugin.js
// Fire hazards spawned by high-impact physics collisions
(function(){
  'use strict';

  const DEFAULTS = {
    ttl: 4.0,
    extraTTL: 2.5,
    damage: 0.5,
    tick: 0.4,
    size: 26,
    spawnCooldown: 0.6,
    minDistance: 16,
    recentWindow: 1.0,
    maxActive: 20,
    lightRadius: 72,
    lightIntensity: 0.55,
    lightColor: 'rgba(255,170,90,0.85)',
    color: 'rgba(255,160,72,0.88)',
    flicker: [2.5, 4.2],
    impulseThreshold: 220
  };

  const FireAPI = {
    state: null,
    cfg: Object.assign({}, DEFAULTS),
    list: [],
    _recent: [],
    _destroyed: new Set(),
    _lastSpawn: -Infinity,

    init(state, opts = {}){
      const target = this._resolveState(state);
      this.state = target;
      this.configure(opts);
      return this;
    },

    configure(opts = {}){
      this.cfg = Object.assign({}, DEFAULTS, this.cfg || {}, opts || {});
      if (!Array.isArray(this.list)) this.list = [];
      if (!Array.isArray(this._recent)) this._recent = [];
      if (!(this._destroyed instanceof Set)) this._destroyed = new Set();
      return this;
    },

    reset(){
      this.list = [];
      this._recent = [];
      this._destroyed = new Set();
      this._lastSpawn = -Infinity;
      return this;
    },

    spawn(x, y, opts = {}){
      const state = this._resolveState(this.state);
      this.state = state;
      const now = nowSeconds();
      this._purgeRecent(now);

      const cooldown = (opts.cooldown != null) ? opts.cooldown : (this.cfg.spawnCooldown || 0);
      const mergeRadius = (opts.mergeRadius != null) ? opts.mergeRadius : ((opts.size != null ? opts.size : this.cfg.size || 0) * 0.55);
      if (mergeRadius > 0){
        const active = this.list.find(f => f && !f.dead && Math.hypot((f.x + f.w * 0.5) - x, (f.y + f.h * 0.5) - y) <= mergeRadius);
        if (active){
          const ttl = opts.ttl != null ? opts.ttl : this.cfg.ttl;
          if (Number.isFinite(ttl)) active.ttl = Math.max(active.ttl, ttl);
          if (opts.damage != null) active.damage = opts.damage;
          if (opts.tick != null) active.tick = opts.tick;
          active._bornAt = now;
          this._recent.push({ x, y, t: now });
          return active;
        }
      }
      if (cooldown > 0 && (now - this._lastSpawn) < cooldown) return null;

      const minDist = (opts.minDistance != null) ? opts.minDistance : (this.cfg.minDistance || 0);
      if (minDist > 0){
        const minDistSq = minDist * minDist;
        const windowSec = (opts.recentWindow != null) ? opts.recentWindow : this.cfg.recentWindow;
        for (const recent of this._recent){
          if (!recent) continue;
          if (windowSec > 0 && (now - recent.t) > windowSec) continue;
          const dx = recent.x - x;
          const dy = recent.y - y;
          if (dx*dx + dy*dy <= minDistSq) return null;
        }
      }

      const maxActive = (opts.maxActive != null) ? opts.maxActive : this.cfg.maxActive;
      if (maxActive > 0){
        const active = this.list.filter(f => f && !f.dead);
        if (active.length >= maxActive){
          active.sort((a, b) => (a?._bornAt || 0) - (b?._bornAt || 0));
          const oldest = active.shift();
          if (oldest) this._destroy(oldest);
        }
      }

      const kind = this._resolveKind(state);
      const size = opts.size != null ? opts.size : this.cfg.size;
      const w = size, h = size;
      const fire = {
        id: opts.id || `fire-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        x: (Number.isFinite(x) ? x : 0) - w * 0.5,
        y: (Number.isFinite(y) ? y : 0) - h * 0.5,
        w,
        h,
        solid: false,
        static: true,
        pushable: false,
        dead: false,
        ttl: opts.ttl != null ? opts.ttl : this.cfg.ttl,
        damage: opts.damage != null ? opts.damage : this.cfg.damage,
        tick: opts.tick != null ? opts.tick : this.cfg.tick,
        spriteKey: opts.spriteKey || 'tile_fire',
        hazard: 'fire',
        source: opts.source || null,
        impulse: opts.impulse != null ? opts.impulse : null,
        _damageTimer: 0,
        _bornAt: now,
        color: opts.color || this.cfg.color,
        lightRadius: opts.lightRadius != null ? opts.lightRadius : this.cfg.lightRadius,
        lightIntensity: opts.lightIntensity != null ? opts.lightIntensity : this.cfg.lightIntensity,
        _lightId: null,
        _flickerHz: randRange(this.cfg.flicker[0], this.cfg.flicker[1])
      };

      this._attachVisuals(fire, opts);

      state.entities.push(fire);
      this.list.push(fire);
      this._lastSpawn = now;
      this._recent.push({ x, y, t: now });
      return fire;
    },

    spawnImpact(x, y, impulse, meta = {}){
      const threshold = meta.threshold != null ? meta.threshold : (this.cfg.impulseThreshold || 0);
      if (!(impulse >= threshold)) return null;
      const base = Math.max(threshold, 1);
      const ratio = Math.max(0, (impulse - threshold) / base);
      const ttl = meta.ttl != null ? meta.ttl : (this.cfg.ttl + (this.cfg.extraTTL || 0) * Math.min(ratio, 3));
      const damage = meta.damage != null ? meta.damage : (this.cfg.damage * (1 + Math.min(ratio, 2) * 0.5));
      const tick = meta.tick != null ? meta.tick : this.cfg.tick;
      const options = Object.assign({}, meta, { ttl, damage, tick, impulse });
      delete options.threshold;
      return this.spawn(x, y, options);
    },

    update(dt = 0){
      const state = this._resolveState(this.state);
      this.state = state;
      const now = nowSeconds();
      this._purgeRecent(now);

      const survivors = [];
      for (const fire of this.list){
        if (!fire || fire.dead){
          if (fire) this._destroyed.add(fire);
          continue;
        }
        fire.ttl -= dt;
        if (fire.ttl <= 0){
          this._destroy(fire);
          continue;
        }
        if (fire._lightId && window.LightingAPI){
          const baseIntensity = fire.lightIntensity != null ? fire.lightIntensity : this.cfg.lightIntensity;
          const hz = fire._flickerHz || randRange(this.cfg.flicker[0], this.cfg.flicker[1]);
          const intensity = Math.max(0.12, baseIntensity * (0.85 + 0.15 * Math.sin(now * hz * Math.PI * 2)));
          try {
            LightingAPI.updateLight(fire._lightId, {
              x: fire.x + fire.w * 0.5,
              y: fire.y + fire.h * 0.5,
              intensity
            });
          } catch (_) {}
        }
        survivors.push(fire);
      }

      this.list = survivors;
      if (this._destroyed.size && Array.isArray(state.entities)){
        state.entities = state.entities.filter(ent => !this._destroyed.has(ent));
        this._destroyed.clear();
      }
      return this.list;
    },

    getActive(){
      return this.list.filter(f => f && !f.dead);
    },

    _resolveState(state){
      let target = state && typeof state === 'object' ? state : null;
      if (!target){
        target = window.G || (window.G = {});
      }
      if (!Array.isArray(target.entities)) target.entities = [];
      if (!target.ENT){
        target.ENT = window.ENT || (window.ENT = {});
      } else if (window.ENT){
        Object.assign(window.ENT, target.ENT);
      }
      return target;
    },

    _resolveKind(state){
      const ent = state.ENT || (state.ENT = {});
      const globalENT = window.ENT || (window.ENT = {});
      if (typeof ent.FIRE === 'undefined' && typeof globalENT.FIRE !== 'undefined'){
        ent.FIRE = globalENT.FIRE;
      }
      if (typeof ent.FIRE === 'undefined'){
        ent.FIRE = (typeof globalENT.FIRE !== 'undefined') ? globalENT.FIRE : 'FIRE';
        if (typeof globalENT.FIRE === 'undefined') globalENT.FIRE = ent.FIRE;
      }
      return ent.FIRE;
    },

    _attachVisuals(fire, opts){
      if (window.LightingAPI && fire.lightRadius > 0){
        try {
          fire._lightId = LightingAPI.addLight({
            x: fire.x + fire.w * 0.5,
            y: fire.y + fire.h * 0.5,
            radius: fire.lightRadius,
            intensity: fire.lightIntensity,
            color: opts.lightColor || this.cfg.lightColor
          });
        } catch (_) {
          fire._lightId = null;
        }
      }
      try {
        const puppet = window.Puppet?.bind?.(fire, 'hazard_fire', { z: 0, scale: opts.scale || 1 })
          || window.PuppetAPI?.attach?.(fire, { rig: 'hazard_fire', z: 0, scale: opts.scale || 1 });
        fire.rigOk = fire.rigOk === true || !!puppet;
      } catch (_) {
        fire.rigOk = fire.rigOk === true;
      }
    },

    _destroy(fire){
      if (!fire) return;
      if (fire._lightId && window.LightingAPI){
        try { LightingAPI.removeLight(fire._lightId); } catch (_) {}
      }
      fire.dead = true;
      this._destroyed.add(fire);
    },

    _purgeRecent(now){
      const windowSec = this.cfg.recentWindow || 0;
      if (windowSec <= 0){
        this._recent = [];
        return;
      }
      this._recent = this._recent.filter(r => r && (now - r.t) <= windowSec);
    }
  };

  function nowSeconds(){
    return (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now() / 1000
      : Date.now() / 1000;
  }

  function randRange(min, max){
    return min + Math.random() * (max - min);
  }

  window.FireAPI = FireAPI;
  window.Entities = window.Entities || {};
  window.Entities.Fire = FireAPI;
})();
