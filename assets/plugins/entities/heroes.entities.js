// filename: heroes.entities.js
// Héroes para “Il Divo: Hospital Dash!”
//
// Francesco: linterna AZUL, 4 corazones, equilibrado, +visión
// Enrique:   linterna AMARILLA, 5 corazones, +fuerza, peor visión
// Roberto:   linterna NARANJA, 3 corazones, +velocidad, visión media
//
// Mantiene compat con tu motor: usa window.G/ENT/TILE_SIZE, LightingAPI y FogAPI si existen.
// Llamada de poblamiento: placement.api -> Entities.Hero.spawnPlayer(x,y,p)

(function () {
  'use strict';

  // ===== Helpers básicos / entorno =========================================================
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

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pushUnique(arr, x){ if (!Array.isArray(arr)) return; if (!arr.includes(x)) arr.push(x); }
  function aabb(a,b){ return a.x<a.bx && a.bx>b.x && a.y<a.by && a.by>b.y; }
  function rectFrom(e){ return { x:e.x, y:e.y, bx:e.x+e.w, by:e.y+e.h }; }

  // ===== Config balanceada por personaje ===================================================
  const MAX_HEARTS_LIMIT = 7; // por HUD
  const CFG = {
    // Visión base (en tiles, para Fog/luces internas)
    visionTiles: {
      enrique:   2,   // peor visión
      roberto:   4,   // media
      francesco: 6,   // mejor
    },
    // Corazones iniciales
    hearts: {
      enrique:   5,
      roberto:   3,
      francesco: 4,
    },
    // Stats: velocidad / aceleración / empuje / masa
    stats: {
      // Enrique: fuerte y lento
      enrique:   { maxSpeed: 145, accel: 700, push: 520, mass: 110 },
      // Roberto: rápido y más frágil
      roberto:   { maxSpeed: 205, accel: 900, push: 320, mass:  85 },
      // Francesco: equilibrado
      francesco: { maxSpeed: 175, accel: 800, push: 420, mass:  95 },
    },
    // Linterna por héroe (color + radios)
    light: {
      defaults: {
        color: '#66b3ff',
        radiusTiles: 5.2,
        innerRatio: 0.48,
        intensity: 0.42,
        coneDeg: 80
      },
      byHero: {
        enrique:   { color: '#ffd34d', radiusTiles: 6.0, innerTiles: 3.2, intensity: 0.6 },
        roberto:   { color: '#ff9f40', radiusTiles: 6.0, innerTiles: 3.0, intensity: 0.5 },
        francesco: { color: '#66b3ff', radiusTiles: 7.6, innerTiles: 3.6, intensity: 0.6 }
      }
    }
  };

  // ===== Núcleo de entidad jugador =========================================================
  function createPlayer(x, y, heroKey) {
    const key = (heroKey || 'francesco').toLowerCase();
    const stats = CFG.stats[key] || CFG.stats.francesco;
    const hearts = clamp(CFG.hearts[key] || 4, 1, MAX_HEARTS_LIMIT);

    const w = Math.round(TILE * 0.82), h = Math.round(TILE * 0.82);
    const p = {
      kind: ENT.PLAYER,
      tag: 'player',
      hero: key,
      heroId: key,
      x: Math.round(x), y: Math.round(y),
      w, h,
      vx: 0, vy: 0,
      ax: 0, ay: 0,
      // vida
      hp: hearts,
      hpMax: hearts,
      // físicas / empuje
      maxSpeed: stats.maxSpeed,
      accel: stats.accel,
      push: stats.push,
      mass: stats.mass,
      // estado
      dir: { x: 1, y: 0 },
      pushing: false,
      sprint: 1.0,
      // render / sprite
      spriteKey: key,     // sprites.plugin: "enrique.png", "roberto.png", "francesco.png"
      // orientación + giro suave de linterna/FOW
      facing: 'S',
      lookAngle: Math.PI / 2,  // 90º hacia abajo (sur)
      turnSpeed: 6.0,          // radianes/segundo (~143º/s) -> ajustable
      _facingHold: 0,          // anti-parpadeo de cardinales
      _flashlightId: null,
      _fogRange: null,
      _lastHitAt: 0,
      _destroyCbs: [],
      // util
      onDestroy(){ for(const fn of this._destroyCbs) try{ fn(); }catch(e){}; this._destroyCbs.length=0; },
    };
    window.MovementSystem?.register?.(p);
    return p;
  }

  function ensureOnArrays(e) {
    pushUnique(G.entities || (G.entities=[]), e);
    pushUnique(G.movers   || (G.movers=[]),   e);
    e.group = 'human';
    try { window.EntityGroups?.assign?.(e); } catch (_) {}
    try { window.EntityGroups?.register?.(e, G); } catch (_) {}
    G.player = e;
  }

  // ===== Linterna y visión (Fog) ===========================================================
  function attachFlashlight(e, overrides = {}) {
    const heroKey = (e.hero || 'francesco');
    const defaults = CFG.light.defaults || {};
    const heroLight = (CFG.light.byHero && CFG.light.byHero[heroKey]) || {};
    const overrideRadiusTiles = (overrides.radiusTiles ?? (Number.isFinite(overrides.radius)
      ? overrides.radius / (TILE || 32)
      : undefined));
    const radiusTiles = overrideRadiusTiles ?? heroLight.radiusTiles ?? defaults.radiusTiles ?? 6;
    const innerTiles = overrides.innerTiles
      ?? heroLight.innerTiles
      ?? ((heroLight.innerRatio ?? defaults.innerRatio ?? 0.5) * radiusTiles);
    const color = overrides.color || heroLight.color || defaults.color || '#ffffff';
    const intensity = overrides.intensity ?? heroLight.intensity ?? defaults.intensity ?? 0.6;
    const coneDeg = heroLight.coneDeg ?? defaults.coneDeg ?? 80;
    const radius = Math.max(1, radiusTiles) * TILE;
    const inner = Math.max(0.5, innerTiles) * TILE;

    e._visionTiles = (CFG.visionTiles[heroKey] || CFG.visionTiles.francesco);
    e._flashInner  = inner;
    e._flashOuter  = radius;
    e._flashlightSpec = { color, radiusTiles, innerTiles, intensity, coneDeg };

    if (!Array.isArray(e._destroyCbs)) e._destroyCbs = [];
    if (e._flashlightId && W.LightingAPI && typeof W.LightingAPI.removeLight === 'function') {
      try { W.LightingAPI.removeLight(e._flashlightId); } catch (_) {}
    }

    const extAttach = W.Entities?.attachFlashlight;
    if (typeof extAttach === 'function') {
      try {
        const id = extAttach(e, { color, radius, intensity, coneDeg });
        if (id != null) {
          e._flashlightId = id;
          e._destroyCbs.push(() => { try { W.LightingAPI?.removeLight?.(id); } catch (_) {} });
        }
        console.log(`[HeroLight] Linterna ${heroKey} -> radio ${radiusTiles.toFixed(2)} tiles @ ${intensity.toFixed(2)} intensidad`);
      } catch (err) {
        console.warn('[HeroLight] Error al usar Entities.attachFlashlight, se intentará LightingAPI directa.', err);
      }
    }

    if ((!e._flashlightId || !W.LightingAPI) && W.LightingAPI && typeof W.LightingAPI.addLight === 'function') {
      const id = W.LightingAPI.addLight({
        owner: e,
        type: 'player',
        color,
        intensity,
        radius,
        innerRadius: inner,
        coneDeg
      });
      e._flashlightId = id;
      e._destroyCbs.push(() => { try { W.LightingAPI.removeLight(id); } catch(_){} });
      console.log(`[HeroLight] LightingAPI directa para ${heroKey} (radio ${radiusTiles.toFixed(2)} tiles).`);
    } else if (!W.LightingAPI) {
      console.warn(`[HeroLight] LightingAPI no disponible para ${heroKey}; sólo se verá la linterna CSS.`);
    }

    const vt = (CFG.visionTiles[heroKey] || CFG.visionTiles.francesco);
    if (W.FogAPI && typeof W.FogAPI.setPlayerVisionTiles === 'function') {
      try { W.FogAPI.setPlayerVisionTiles(vt); } catch(_){}
    } else {
      // Fallback: usa escala global si la manejas en el core
      G.visionScale = vt / 4; // 1.0 = visión media (4 tiles)
    }
  }

  // ===== Daño / curación ===========================================================
  const HERO_ANIM_PROFILE = {
    enrique: {
      attack: 0.75,
      attackWindup: 0.18,
      pushPenalty: 0.86,
      pushEase: 0.6,
      talk: 0.8,
      consume: { eat: 1.1, power: 1.2 },
      hurt: 0.55,
      flinch: 0.18,
      idleEasing: 0.32
    },
    roberto: {
      attack: 0.48,
      attackWindup: 0.1,
      pushPenalty: 0.52,
      pushEase: 0.35,
      talk: 0.55,
      consume: { eat: 0.7, power: 0.8 },
      hurt: 0.4,
      flinch: 0.12,
      idleEasing: 0.16
    },
    francesco: {
      attack: 0.6,
      attackWindup: 0.14,
      pushPenalty: 0.7,
      pushEase: 0.45,
      talk: 0.7,
      consume: { eat: 0.95, power: 1.0 },
      hurt: 0.5,
      flinch: 0.15,
      idleEasing: 0.24
    }
  };

  function ensureAnimState(e) {
    if (!e) return null;
    if (!e._heroAnimState) {
      const profile = HERO_ANIM_PROFILE[e.hero] || HERO_ANIM_PROFILE.francesco;
      e._heroAnimState = {
        profile,
        action: 'idle',
        orientation: 'down',
        dir: 1,
        moving: false,
        attackTimer: 0,
        attackWindup: 0,
        pushTimer: 0,
        pushHeavy: false,
        talkTimer: 0,
        hurtTimer: 0,
        flinchTimer: 0,
        consumeTimer: 0,
        consumeType: null,
        deathCause: null,
        deathTimer: 0,
        sweating: false,
        smoke: false,
        sparkle: false,
        lastSpeedPenalty: 1,
        dirty: true
      };
    }
    return e._heroAnimState;
  }

  function mapDamageSourceToCause(source) {
    if (!source) return 'generic';
    if (typeof source === 'string') {
      const s = source.toLowerCase();
      if (s.includes('fire') || s.includes('fuego')) return 'fire';
      if (s.includes('explos') || s.includes('boom')) return 'explosion';
      if (s.includes('crush') || s.includes('aplast')) return 'crush';
      if (s.includes('slip') || s.includes('ice') || s.includes('wet') || s.includes('resbal')) return 'slip';
      if (s.includes('electric')) return 'shock';
      if (s.includes('enemy') || s.includes('hit') || s.includes('physical')) return 'impact';
      if (s.includes('poison')) return 'poison';
      if (s.includes('mosquito')) return 'sting';
      if (s.includes('rat')) return 'bite';
    }
    if (typeof source === 'object') {
      const kind = String(source.kind || source.kindName || source.type || '').toLowerCase();
      if (kind.includes('fire') || kind.includes('flame')) return 'fire';
      if (kind.includes('explos') || kind.includes('boom')) return 'explosion';
      if (kind.includes('crush') || kind.includes('aplast')) return 'crush';
      if (kind.includes('mosquito')) return 'sting';
      if (kind.includes('rat')) return 'bite';
      if (kind.includes('water') || kind.includes('ice')) return 'slip';
      if (kind.includes('electric')) return 'shock';
    }
    return 'generic';
  }

  function applyDamage(e, amount, source) {
    if (!e || e.dead) return;
    const t = Date.now();
    if (t - (e._lastHitAt||0) < 250) return; // i-frames cortos
    e._lastHitAt = t;

    e.hp = clamp(e.hp - Math.max(0, amount|0), 0, e.hpMax);
    const st = ensureAnimState(e);
    if (st){
      st.hurtTimer = Math.max(st.hurtTimer, (st.profile?.hurt ?? 0.5));
      st.flinchTimer = Math.max(st.flinchTimer, (st.profile?.flinch ?? 0.15));
      st.deathCause = st.deathCause || mapDamageSourceToCause(source);
      st.dirty = true;
    }
    if (e.hp <= 0) {
      e.dead = true;
      if (st){
        st.deathCause = mapDamageSourceToCause(source);
        st.deathTimer = 0;
        st.dirty = true;
      }
      try{ e.onDestroy(); }catch(_){};
    }
  }
  function heal(e, amount, opts) {
    if (!e || e.dead) return;
    const val = Math.max(0, amount||0);
    e.hp = clamp(e.hp + val, 0, e.hpMax);
    const st = ensureAnimState(e);
    const profile = st?.profile || HERO_ANIM_PROFILE[e.hero] || HERO_ANIM_PROFILE.francesco;
    const cause = (opts && typeof opts === 'object' && opts.cause) || null;
    if (st && val > 0) {
      const type = cause === 'powerup' ? 'powerup' : 'eat';
      const duration = (type === 'powerup'
        ? (profile.consume?.power ?? 1.0)
        : (profile.consume?.eat ?? 0.9));
      st.consumeTimer = Math.max(st.consumeTimer, duration);
      st.consumeType = type;
      st.sparkle = type === 'powerup';
      st.dirty = true;
    }
  }

  function updateHeroAnimation(e, dt){
    const st = ensureAnimState(e);
    if (!st) return;
    const prof = st.profile || HERO_ANIM_PROFILE[e.hero] || HERO_ANIM_PROFILE.francesco;
    const speed = Math.hypot(e.vx || 0, e.vy || 0);
    st.moving = speed > 8;
    e.isMoving = st.moving;
    if (typeof e.facing === 'string') {
      const f = e.facing.toUpperCase();
      if (f === 'N') st.orientation = 'up';
      else if (f === 'S') st.orientation = 'down';
      else st.orientation = 'side';
      st.dir = (f === 'W') ? -1 : (f === 'E' ? 1 : st.dir || 1);
    } else if (typeof e.lookAngle === 'number') {
      const ang = e.lookAngle;
      const deg = ang * 180 / Math.PI;
      if (deg > 45 && deg <= 135) st.orientation = 'down';
      else if (deg <= -45 && deg > -135) st.orientation = 'up';
      else st.orientation = 'side';
      st.dir = (deg < -90 || deg > 90) ? -1 : 1;
    }

    st.attackTimer = Math.max(0, st.attackTimer - dt);
    if (st.attackTimer <= 0) {
      e.isAttacking = false;
      st.attackWindup = 0;
    } else if (st.attackWindup > 0) {
      st.attackWindup = Math.max(0, st.attackWindup - dt);
    }

    const pushAnimT = (typeof e.pushAnimT === 'number') ? e.pushAnimT : 0;
    if (pushAnimT > 0.02) {
      st.pushTimer = Math.max(st.pushTimer, pushAnimT);
    }
    st.pushTimer = Math.max(0, st.pushTimer - dt);
    if (st.pushTimer <= 0 && e.pushing) e.pushing = false;

    st.talkTimer = Math.max(0, st.talkTimer - dt);
    if (st.talkTimer <= 0 && e.isTalking) e.isTalking = false;

    st.hurtTimer = Math.max(0, st.hurtTimer - dt);
    st.flinchTimer = Math.max(0, st.flinchTimer - dt);
    if (st.flinchTimer <= 0) st.deathCause = st.deathCause || null;

    st.consumeTimer = Math.max(0, st.consumeTimer - dt);
    if (st.consumeTimer <= 0) {
      st.consumeType = null;
      st.sparkle = false;
    }

    if (e.dead) {
      st.action = 'dead';
      st.deathTimer += dt;
    } else if (st.hurtTimer > 0) {
      st.action = 'hurt';
    } else if (st.attackTimer > 0 || e.isAttacking) {
      st.action = 'attack';
    } else if (st.consumeTimer > 0 && st.consumeType) {
      st.action = st.consumeType === 'powerup' ? 'powerup' : 'eat';
    } else if (st.pushTimer > 0 || e.pushing) {
      st.action = 'push';
    } else if (st.talkTimer > 0 || e.isTalking) {
      st.action = 'talk';
    } else if (st.moving) {
      st.action = 'walk';
    } else {
      st.action = 'idle';
    }

    if (st.action !== 'push' && st.action !== 'attack') {
      st.pushHeavy = false;
    }

    st.sweating = (st.pushTimer > 0.1 || e.pushing === true) && e.hero === 'roberto';
    if (e.hero === 'enrique') {
      st.sweating = st.pushTimer > 0.25 ? false : st.sweating;
    }
    st.smoke = e.dead && st.deathCause === 'fire';

    // Ajusta velocidad efectiva al empujar según personaje
    if ((st.pushTimer > 0 || e.pushing) && !e.dead) {
      const penalty = Math.max(0.25, prof.pushPenalty || 0.6);
      e.vx *= penalty;
      e.vy *= penalty;
      st.lastSpeedPenalty = penalty;
    } else {
      st.lastSpeedPenalty = 1;
    }

    st.dirty = true;
  }

  function startAttack(e, opts = {}) {
    if (!e || e.dead) return;
    const st = ensureAnimState(e);
    const prof = st?.profile || HERO_ANIM_PROFILE[e.hero] || HERO_ANIM_PROFILE.francesco;
    const duration = Math.max(0.2, opts.duration || prof.attack || 0.6);
    const windup = Math.max(0, opts.windup ?? prof.attackWindup ?? 0.12);
    if (st) {
      st.attackTimer = duration;
      st.attackWindup = windup;
      st.pushHeavy = !!opts.heavy;
      st.dirty = true;
    }
    e.isAttacking = true;
  }

  function setTalking(e, active, duration) {
    if (!e) return;
    const st = ensureAnimState(e);
    const prof = st?.profile || HERO_ANIM_PROFILE[e.hero] || HERO_ANIM_PROFILE.francesco;
    const time = Math.max(0.3, duration || prof.talk || 0.7);
    if (active) {
      e.isTalking = true;
      if (st) {
        st.talkTimer = Math.max(st.talkTimer, time);
        st.dirty = true;
      }
    } else if (st) {
      st.talkTimer = 0;
      e.isTalking = false;
      st.dirty = true;
    }
  }

  function triggerPush(e, opts = {}) {
    if (!e || e.dead) return;
    const st = ensureAnimState(e);
    const prof = st?.profile || HERO_ANIM_PROFILE[e.hero] || HERO_ANIM_PROFILE.francesco;
    const duration = Math.max(0.2, opts.duration || prof.pushEase || 0.5);
    if (st) {
      st.pushTimer = Math.max(st.pushTimer, duration);
      st.pushHeavy = !!opts.heavy;
      st.dirty = true;
    }
    e.pushing = true;
  }

  function notifyDamage(e, meta = {}) {
    if (!e) return;
    const st = ensureAnimState(e);
    if (!st) return;
    if (meta && meta.source) {
      const cause = mapDamageSourceToCause(meta.source);
      st.deathCause = cause;
    }
    const prof = st.profile || HERO_ANIM_PROFILE[e.hero] || HERO_ANIM_PROFILE.francesco;
    st.hurtTimer = Math.max(st.hurtTimer, (meta.duration || prof.hurt || 0.45));
    st.flinchTimer = Math.max(st.flinchTimer, prof.flinch || 0.12);
    st.dirty = true;
  }

  function setDeathCause(e, cause) {
    if (!e) return;
    const st = ensureAnimState(e);
    if (!st) return;
    st.deathCause = mapDamageSourceToCause(cause) || cause || 'generic';
    st.dirty = true;
  }

  function getAnimationState(e){
    return ensureAnimState(e);
  }

  // ===== API pública =======================================================================
  const Hero = {
    // Lee selección desde p.sub / p.skin o desde G.selectedHero
    resolveKey(p) {
      window.G = window.G || {};
      const q = new URLSearchParams(location.search);
      const qs = (q.get('hero') || '').toLowerCase();
      const k = (p?.skin || p?.sub || qs || G.selectedHero || 'francesco').toLowerCase();
      G.selectedHero = k; // persistimos la selección para el resto del motor
      return k;
    },

    // Punto de entrada del poblamiento (lo llama placement.api)
    // -> crea el jugador con la skin/stats adecuadas y lo inserta en G.entities
    spawnPlayer(x, y, p = {}) {
      const key = this.resolveKey(p);
      const e = createPlayer(x, y, key); G.selectedHero = key; window.selectedHeroKey = key; e.spriteKey = key;
      window.G = window.G || {};
      G.selectedHero = key;
      ensureOnArrays(e);
      e.spec = e.spec || {};
      e.spec.skin = `${key}.png`;
      e.skin = `${key}.png`;
      const rigName = `hero_${key}`;
      let puppet = null;
      try {
        if (window.Puppet?.bind) {
          puppet = window.Puppet.bind(e, rigName, { z: 0, scale: 1, data: { hero: key } });
        }
      } catch (err) {
        console.warn(`[HeroRig] Error en Puppet.bind(${rigName})`, err);
      }
      if (!puppet && window.PuppetAPI?.attach) {
        try {
          puppet = window.PuppetAPI.attach(e, { rig: rigName, z: 0, scale: 1, data: { hero: key } });
        } catch (err) {
          console.warn(`[HeroRig] Error en PuppetAPI.attach(${rigName})`, err);
        }
      }
      if (!puppet) {
        console.warn(`[HeroRig] Rig default para héroe ${key}; verifica registro de ${rigName}.`);
        try {
          puppet = window.PuppetAPI?.attach?.(e, { rig: 'default', z: 0, scale: 1, data: { hero: key } }) || null;
        } catch (err) {
          console.error('[HeroRig] Falló el fallback "default".', err);
        }
      }
      e.rig = puppet || null;
      e.rigName = puppet?.rigName || rigName;
      e.rigOk = !!(puppet && puppet.rigName === rigName);
      if (!e.rigOk) {
        console.warn(`[HeroRig] ${key} no tiene rig ${rigName}, usando ${puppet?.rigName || 'default'}.`);
      } else {
        try { console.log(`[HeroRig] ${key} vinculado a ${rigName}.`); } catch (_) {}
      }
      const lightOverrides = CFG.light.byHero?.[key] || {};
      attachFlashlight(e, {
        color: lightOverrides.color,
        radiusTiles: lightOverrides.radiusTiles,
        intensity: lightOverrides.intensity
      });
      ensureAnimState(e);
      updateHeroAnimation(e, 0);
      const prevUpdate = typeof e.update === 'function' ? e.update.bind(e) : null;
      e.update = function heroUpdate(dt){
        if (prevUpdate) {
          try { prevUpdate(dt); } catch(err){ console.warn('[Hero] prev update error', err); }
        }
        updateHeroAnimation(e, dt || 0);
      };
      try { console.log(`%cHERO spawn => ${key}`, 'color:#9cc2ff;font-weight:bold'); } catch(_){}
      return e;
    },

    // Seguidor opcional (compat con placement: type=follower, sub=...)
    spawnFollower(sub, x, y, p = {}) {
      const key = (sub || p.sub || 'francesco').toLowerCase();
      const e = createPlayer(x, y, key);
      e.tag = 'follower';
      e.hp = 1; e.hpMax = 1;
      ensureOnArrays(e);
      e.spec = e.spec || {};
      e.spec.skin = `${key}.png`;
      e.skin = `${key}.png`;
      const rigName = `hero_${key}`;
      let puppet = null;
      try {
        if (window.Puppet?.bind) {
          puppet = window.Puppet.bind(e, rigName, { z: 0, scale: 1, data: { hero: key, follower: true } });
        }
      } catch (err) {
        console.warn(`[HeroRig] Follower bind error (${rigName})`, err);
      }
      if (!puppet && window.PuppetAPI?.attach) {
        try {
          puppet = window.PuppetAPI.attach(e, { rig: rigName, z: 0, scale: 1, data: { hero: key, follower: true } });
        } catch (err) {
          console.warn(`[HeroRig] Follower attach error (${rigName})`, err);
        }
      }
      if (!puppet) {
        console.warn(`[HeroRig] Seguidor ${key} usando rig fallback.`);
        try {
          puppet = window.PuppetAPI?.attach?.(e, { rig: 'default', z: 0, scale: 1, data: { hero: key, follower: true } }) || null;
        } catch (err) {
          console.error('[HeroRig] Follower fallback "default" también falló.', err);
        }
      }
      e.rig = puppet || null;
      e.rigName = puppet?.rigName || rigName;
      e.rigOk = !!(puppet && puppet.rigName === rigName);
      if (!e.rigOk) {
        console.warn(`[HeroRig] follower ${key} está en fallback (${puppet?.rigName || 'none'}).`);
      } else {
        try { console.log(`[HeroRig] follower ${key} → ${rigName}.`); } catch (_) {}
      }
      const lightOverrides = CFG.light.byHero?.[key] || {};
      attachFlashlight(e, {
        color: lightOverrides.color,
        radiusTiles: lightOverrides.radiusTiles,
        intensity: lightOverrides.intensity
      });
      ensureAnimState(e);
      updateHeroAnimation(e, 0);
      const prevUpdate = typeof e.update === 'function' ? e.update.bind(e) : null;
      e.update = function followerUpdate(dt){
        if (prevUpdate) {
          try { prevUpdate(dt); } catch(err){ console.warn('[HeroFollower] prev update error', err); }
        }
        updateHeroAnimation(e, dt || 0);
      };
      return e;
    },

    // Exponer utilidades (por si otras entidades las usan)
    applyDamage,
    heal,
    startAttack,
    setTalking,
    triggerPush,
    notifyDamage,
    setDeathCause,
    getAnimationState,
    updateAnimation: updateHeroAnimation,
  };

  W.Entities = W.Entities || {};
  W.Entities.Hero = Hero;
})();