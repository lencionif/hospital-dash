// filename: heroes.entities.js
// Sistema de héroe single player para “Il Divo: Hospital Dash!”
// Se garantiza que solo existe un héroe activo: el seleccionado en el Start Screen.

(function () {
  'use strict';

  const W = window;
  const G = W.G || (W.G = {});
  const ENT = (function () {
    const e = W.ENT || {};
    if (typeof e.PLAYER === 'undefined') e.PLAYER = 1;
    if (typeof e.WALL   === 'undefined') e.WALL   = 31;
    if (typeof e.DOOR   === 'undefined') e.DOOR   = 30;
    return e;
  })();
  const TILE = (typeof W.TILE_SIZE !== 'undefined') ? W.TILE_SIZE : (W.TILE || 32);
  const ENABLE_COOP = false;
  W.ENABLE_COOP = false;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const MAX_HEARTS_LIMIT = 7;
  const HERO_CONFIG = {
    visionTiles: {
      enrique: 2,
      roberto: 4,
      francesco: 6,
    },
    hearts: {
      enrique: 5,
      roberto: 3,
      francesco: 4,
    },
    stats: {
      enrique:   { maxSpeed: 145, accel: 700, push: 520, mass: 110 },
      roberto:   { maxSpeed: 205, accel: 900, push: 320, mass:  85 },
      francesco: { maxSpeed: 175, accel: 800, push: 420, mass:  95 },
    },
    light: {
      defaults: { color: '#66b3ff', radiusTiles: 5.2, innerRatio: 0.48, intensity: 0.42, coneDeg: 80 },
      byHero: {
        enrique:   { color: '#ffd34d', radiusTiles: 6.0, innerTiles: 3.2, intensity: 0.6 },
        roberto:   { color: '#ff9f40', radiusTiles: 6.0, innerTiles: 3.0, intensity: 0.5 },
        francesco: { color: '#66b3ff', radiusTiles: 7.6, innerTiles: 3.6, intensity: 0.6 },
      }
    }
  };

  function pushUnique(arr, x){ if (!Array.isArray(arr)) return; if (!arr.includes(x)) arr.push(x); }

  function ensureOnArrays(e) {
    pushUnique(G.entities || (G.entities = []), e);
    pushUnique(G.movers   || (G.movers   = []), e);
    e.group = 'human';
    try { W.EntityGroups?.assign?.(e); } catch (_) {}
    try { W.EntityGroups?.register?.(e, G); } catch (_) {}
    G.player = e; // referencia única
  }

  function applyDamage(hero, amount = 1) {
    const dmg = Math.max(0, amount | 0);
    hero.hp = clamp((hero.hp || 0) - dmg, 0, hero.hpMax || MAX_HEARTS_LIMIT);
  }

  function attachFlashlight(e, overrides = {}) {
    const heroKey = (e.hero || 'enrique');
    const defaults = HERO_CONFIG.light.defaults || {};
    const heroLight = (HERO_CONFIG.light.byHero && HERO_CONFIG.light.byHero[heroKey]) || {};
    const radiusTiles = overrides.radiusTiles ?? heroLight.radiusTiles ?? defaults.radiusTiles ?? 6;
    const innerTiles = overrides.innerTiles ?? heroLight.innerTiles ?? ((heroLight.innerRatio ?? defaults.innerRatio ?? 0.5) * radiusTiles);
    const color = overrides.color || heroLight.color || defaults.color || '#ffffff';
    const intensity = overrides.intensity ?? heroLight.intensity ?? defaults.intensity ?? 0.6;
    const coneDeg = heroLight.coneDeg ?? defaults.coneDeg ?? 80;
    const radius = Math.max(1, radiusTiles) * TILE;
    const inner = Math.max(0.5, innerTiles) * TILE;

    if (e._flashlightId && W.LightingAPI?.removeLight) {
      try { W.LightingAPI.removeLight(e._flashlightId); } catch (_) {}
    }

    if (W.LightingAPI?.addLight) {
      const id = W.LightingAPI.addLight({ owner: e, type: 'player', color, radius, innerRadius: inner, intensity, coneDeg });
      if (id != null) {
        e._flashlightId = id;
        if (!Array.isArray(e._destroyCbs)) e._destroyCbs = [];
        e._destroyCbs.push(() => { try { W.LightingAPI?.removeLight?.(id); } catch (_) {} });
      }
    }

    e._visionTiles = (HERO_CONFIG.visionTiles?.[heroKey] || HERO_CONFIG.visionTiles?.francesco || 4);
    e._flashInner  = inner;
    e._flashOuter  = radius;
    e._flashlightSpec = { color, radiusTiles, innerTiles, intensity, coneDeg };
  }

  function bindRig(e) {
    const rigName = `hero_${e.heroId}`;
    let puppet = null;
    try {
      if (W.PuppetAPI?.attach) puppet = W.PuppetAPI.attach({ rig: rigName, entity: e, z: 0, scale: 1, data: { hero: e.heroId } });
    } catch (_) {}
    if (!puppet && W.Puppet?.bind) {
      try { puppet = W.Puppet.bind(e, rigName, { z: 0, scale: 1, data: { hero: e.heroId } }); } catch (_) {}
    }
    e.rig = puppet || null;
    e.rigName = puppet?.rigName || rigName;
    e.rigOk = !!(puppet && puppet.rigName === rigName);
  }

  function bindUpdate(e){
    const prevUpdate = typeof e.update === 'function' ? e.update.bind(e) : null;
    e.update = function heroUpdate(dt){
      if (prevUpdate) {
        try { prevUpdate(dt); } catch(err){ console.warn('[Hero] prev update error', err); }
      }
      if (typeof e.invuln === 'number' && e.invuln > 0) e.invuln = Math.max(0, e.invuln - (dt || 0));
    };
  }

  function createHero(opts = {}) {
    const heroId = (opts.heroId || opts.hero || 'enrique').toLowerCase();
    const stats = HERO_CONFIG.stats[heroId] || HERO_CONFIG.stats.enrique;
    const hearts = clamp(HERO_CONFIG.hearts[heroId] || HERO_CONFIG.hearts.enrique || 3, 1, MAX_HEARTS_LIMIT);
    const w = Math.round(TILE * 0.82), h = Math.round(TILE * 0.82);

    const hero = {
      kind: ENT.PLAYER,
      tag: 'player',
      hero: heroId,
      heroId,
      x: Math.round(opts.x || 0),
      y: Math.round(opts.y || 0),
      w, h,
      solid: true,
      collisionLayer: 'living',
      pushable: true,
      vx: 0, vy: 0,
      ax: 0, ay: 0,
      hp: hearts,
      hpMax: hearts,
      maxSpeed: stats.maxSpeed,
      accel: stats.accel,
      push: stats.push,
      mass: stats.mass,
      dir: { x: 1, y: 0 },
      pushing: false,
      sprint: 1.0,
      spriteKey: heroId,
      facing: 'S',
      lookAngle: Math.PI / 2,
      turnSpeed: 6.0,
      _flashlightId: null,
      _destroyCbs: [],
      takeDamage(amount = 1, meta = {}) {
        const invuln = Number.isFinite(meta?.invuln) ? meta.invuln : 0.6;
        this.invuln = Math.max(this.invuln || 0, invuln);
        applyDamage(this, amount);
      },
      onDestroy(){
        for(const fn of this._destroyCbs) try{ fn(); }catch(_){}
        this._destroyCbs.length = 0;
      },
    };

    W.MovementSystem?.register?.(hero);
    ensureOnArrays(hero);
    attachFlashlight(hero, {});
    bindRig(hero);
    bindUpdate(hero);

    console.debug('[HERO_CREATE]', {
      id: hero.heroId,
      x: hero.x,
      y: hero.y,
      isCoop: !!hero.isCoop,
      isMain: hero === G.player,
    });

    return hero;
  }

  const Hero = {
    resolveKey(p){
      const q = (typeof URLSearchParams !== 'undefined') ? new URLSearchParams(location.search) : null;
      const qs = (q && q.get('hero')) ? q.get('hero').toLowerCase() : '';
      const k = (p?.heroId || p?.hero || p?.skin || p?.sub || W.START_HERO_ID || qs || G.selectedHero || 'enrique').toLowerCase();
      G.selectedHero = k;
      W.START_HERO_ID = W.START_HERO_ID || k;
      return k;
    },

    createHero(opts){
      return createHero(opts);
    },

    spawnPlayer(x, y, p = {}) {
      const key = this.resolveKey(p);
      if (!ENABLE_COOP && G.player) return G.player;
      return createHero({ x, y, heroId: key });
    },

    spawnFollower() {
      console.info('[Hero] modo coop desactivado, no se generan followers.');
      return null;
    },

    getAnimationState() { return null; },
  };

  W.Entities = W.Entities || {};
  W.Entities.Hero = Hero;
})();
