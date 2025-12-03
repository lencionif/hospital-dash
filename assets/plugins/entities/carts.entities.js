// assets/plugins/entities/carts.entities.js
// TODO: Archivo no referenciado en index.html. Candidato a eliminación si se confirma que no se usa.
// Registro y comportamiento de los carros pinball (carro de comidas equilibrado)
(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.CART_FOOD === 'undefined') e.CART_FOOD = 'cart_food';
    if (typeof e.CART_MEDS === 'undefined') e.CART_MEDS = 'cart_meds';
    if (typeof e.CART_EMERGENCY === 'undefined') e.CART_EMERGENCY = 'cart_emergency';
    return e;
  })(root.ENT || (root.ENT = {}));

  const TILE = root.TILE_SIZE || root.TILE || 32;
  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 10;
  const DEBUG_CARTS = !!root.DEBUG_CARTS;

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.movers)) G.movers = [];
    if (!Array.isArray(G.objects)) G.objects = [];
    if (!Array.isArray(G.hostiles)) G.hostiles = [];
    if (!Array.isArray(G.carts)) G.carts = [];
  }

  function toPxFromTile(t) {
    return t * TILE + TILE / 2;
  }

  const overlap = root.AABB || function overlap(a, b) {
    return (
      a && b &&
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  };

  function attachRig(e) {
    try {
      if (root.PuppetAPI?.attach) {
        const rig = root.PuppetAPI.attach(e, e.puppet || { rig: 'cart_food_pinball', z: HERO_Z, skin: 'cart_food' });
        if (rig) e.rigOk = true;
      }
    } catch (err) {
      if (DEBUG_CARTS) console.warn('[CART_FOOD] rig attach error', err);
      e.rigOk = false;
    }
  }

  function notifyGroups(e) {
    try { root.EntityGroups?.assign?.(e); } catch (_) {}
    try { root.EntityGroups?.register?.(e, G); } catch (_) {}
  }

  function notifySpawnerDeath(e) {
    try { root.SpawnerAPI?.notifyDeath?.(e); } catch (_) {}
  }

  function updateTouchCooldown(e, dt) {
    if (typeof e._touchCD === 'number' && e._touchCD > 0) {
      e._touchCD = Math.max(0, e._touchCD - dt);
    }
  }

  function cartFoodAiUpdate(e, dt) {
    if (!e) return;
    updateTouchCooldown(e, dt);

    if (e.health <= 0 || e.dead) {
      e.dead = true;
      e.state = 'dead';
      e.aiState = 'dead';
      if (!e.deathCause) e.deathCause = e._lastHitCause || 'damage';
      notifySpawnerDeath(e);
      return;
    }

    const speed = Math.hypot(e.vx || 0, e.vy || 0);
    if (speed < 1) {
      e.aiState = e.aiState === 'stopped' ? 'stopped' : 'idle';
    } else {
      e.aiState = 'moving';
    }

    if (e._touchCD <= 0 && speed > 40 && G.player && overlap(e, G.player)) {
      try {
        const base = e.touchDamage || 0;
        const scaled = base * (1 + Math.min(1, Math.max(0, (speed - e.baseSpeed) / (e.maxSpeed || 1))));
        const original = e.touchDamage;
        e.touchDamage = scaled;
        root.DamageAPI?.applyTouch?.(e, G.player);
        e.touchDamage = original;
        e._touchCD = e.touchCooldown;
      } catch (_) {}
    }
  }

  function cartMedsAiUpdate(e, dt) {
    if (!e) return;
    updateTouchCooldown(e, dt);

    if (e.health <= 0 || e.dead) {
      e.dead = true;
      e.state = 'dead';
      e.aiState = 'dead';
      if (!e.deathCause) e.deathCause = e._lastHitCause || 'damage';
      notifySpawnerDeath(e);
      return;
    }

    const speed = Math.hypot(e.vx || 0, e.vy || 0);
    e.state = speed > 5 ? 'move' : 'idle';

    if (e.aiState === 'stunned') {
      e.aiTimer -= dt;
      if (e.aiTimer <= 0) {
        e.aiState = 'idle';
      }
    }

    if (!e.dead && root.DamageAPI && overlap(e, G.player)) {
      if (!e._touchCD || e._touchCD <= 0) {
        root.DamageAPI.applyTouch(e, G.player);
        e._touchCD = e.touchCooldown;
      }
    }

    if (e.bounceCount >= e.maxBounces && speed > 0) {
      e.vx *= 0.85;
      e.vy *= 0.85;
      if (Math.hypot(e.vx, e.vy) < 10) {
        e.vx = 0;
        e.vy = 0;
        e.aiState = 'idle';
      }
    }
  }

  function emergencyCartAiUpdate(e, dt) {
    if (!e) return;
    updateTouchCooldown(e, dt);

    if (e.health <= 0 || e.dead) {
      e.dead = true;
      e.state = 'dead';
      e.aiState = 'dead';
      if (!e.deathCause) e.deathCause = e._lastHitCause || 'damage';
      notifySpawnerDeath(e);
      return;
    }

    const friction = 0.96;
    if (e.aiState !== 'stopped') {
      e.vx *= friction;
      e.vy *= friction;
    }

    const speedSq = (e.vx || 0) * (e.vx || 0) + (e.vy || 0) * (e.vy || 0);
    if (speedSq < 25) {
      e.vx = 0;
      e.vy = 0;
      e.aiState = 'idle';
    } else if (e.aiState !== 'stopped') {
      e.aiState = 'moving';
    }

    if (!e.dead && e._touchCD <= 0 && root.DamageAPI && G.player && overlap(e, G.player)) {
      root.DamageAPI.applyTouch(e, G.player);
      e._touchCD = e.touchCooldown;
    }
  }

  function onEmergencyCartWallHit(e, normalX = 0, normalY = 0, meta = {}) {
    if (!e) return true;
    const physics = e.cartPhysics || {};
    const restitution = Number.isFinite(physics.restitution) ? physics.restitution : (e.restitution || 1);
    const prevVx = meta.preVx ?? e.vx ?? 0;
    const prevVy = meta.preVy ?? e.vy ?? 0;

    if (normalX !== 0) e.vx = -(prevVx || 0) * restitution;
    if (normalY !== 0) e.vy = -(prevVy || 0) * restitution;

    e.bounceCount = (e.bounceCount || 0) + 1;

    const speed = Math.hypot(e.vx || 0, e.vy || 0);
    const boosted = Math.min(speed * 1.12, physics.maxSpeed || e.maxSpeed || speed);
    if (speed > 0) {
      const k = boosted / speed;
      e.vx *= k;
      e.vy *= k;
    }

    if (boosted >= (physics.fireThreshold || Infinity) && root.FireAPI?.spawnAtPx) {
      root.FireAPI.spawnAtPx(e.x, e.y, { ttl: 6 + Math.random() * 3 });
    }

    if (e.bounceCount >= (e.maxBounces ?? Infinity)) {
      e.vx = 0;
      e.vy = 0;
      e.aiState = 'stopped';
    }

    e.state = 'hit';
    if (e.puppetState) e.puppetState.hitFlash = 0.25;
    try { root.AudioAPI?.playOnce?.('cart_heavy_bounce'); } catch (_) {}
    return true;
  }

  function spawnCartFood(tx, ty) {
    ensureCollections();

    const e = {
      id: root.genId ? root.genId() : `cart-food-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.CART_FOOD,
      kindName: 'cart_food',
      populationType: 'carts',
      role: 'cart',
      x: toPxFromTile(tx),
      y: toPxFromTile(ty),
      w: 24,
      h: 24,
      dir: 0,
      vx: 0,
      vy: 0,
      solid: true,
      isTileWalkable: false,
      maxHealth: 3,
      health: 3,
      fireImmune: false,
      touchDamage: 1,
      touchCooldown: 0.9,
      _touchCD: 0,
      population: 'carts',
      aiState: 'idle',
      aiTimer: 0,
      bounceCount: 0,
      maxBounces: 4,
      baseSpeed: 90,
      maxSpeed: 220,
      restitution: 0.9,
      aiUpdate: cartFoodAiUpdate,
      puppet: {
        rig: 'cart_food_pinball',
        z: HERO_Z,
        skin: 'cart_food',
      },
    };

    attachRig(e);

    G.entities.push(e);
    G.movers.push(e);
    G.carts.push(e);
    notifyGroups(e);
    if (DEBUG_CARTS) console.log(`[CART_FOOD] spawn at (${tx},${ty})`);
    return e;
  }

  function createCartMeds(x, y) {
    ensureCollections();

    const e = {
      id: root.genId ? root.genId() : `cart-meds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.CART_MEDS,
      kindName: 'cart_meds',
      populationType: 'carts',
      role: 'cart',
      x,
      y,
      w: 24,
      h: 24,
      dir: 0,
      vx: 0,
      vy: 0,
      solid: true,
      isTileWalkable: false,
      health: 8,
      maxHealth: 8,
      fireImmune: false,
      touchDamage: 2,
      touchCooldown: 0.9,
      _touchCD: 0,
      population: 'carts',
      aiState: 'idle',
      state: 'idle',
      aiTimer: 0,
      bounceCount: 0,
      maxBounces: 5,
      pinballBoostPerHit: 1.12,
      pinballMaxSpeed: 260,
      aiUpdate: cartMedsAiUpdate,
      physics: {
        mass: 0.7,
        restitution: 0.95,
        friction: 0.015,
        maxSpeed: 260,
      },
      puppet: {
        rig: 'cart_meds_pinball',
        z: HERO_Z,
        skin: 'cart_meds',
      },
    };

    attachRig(e);
    G.entities.push(e);
    G.movers.push(e);
    G.carts.push(e);
    notifyGroups(e);
    return e;
  }

  function spawnCartMeds(tx, ty) {
    return createCartMeds(toPxFromTile(tx), toPxFromTile(ty));
  }

  function spawnEmergencyCart(x, y) {
    ensureCollections();

    const physics = {
      mass: 1.6,
      maxSpeed: 260,
      restitution: 0.9,
      damagePerHit: 1.5,
      fireThreshold: 260,
      squashThreshold: 1.0,
    };

    const e = {
      id: root.genId ? root.genId() : `cart-emergency-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.CART_EMERGENCY,
      kindName: 'cart_emergency',
      populationType: 'carts',
      role: 'cart',
      x,
      y,
      w: 24,
      h: 24,
      dir: 0,
      vx: 0,
      vy: 0,
      mass: physics.mass,
      maxSpeed: physics.maxSpeed,
      restitution: physics.restitution,
      solid: true,
      isTileWalkable: false,
      health: 12,
      maxHealth: 12,
      fireImmune: false,
      touchDamage: 1.5,
      touchCooldown: 0.9,
      _touchCD: 0,
      cartType: 'heavy',
      bounceCount: 0,
      maxBounces: 2,
      cartPhysics: physics,
      aiState: 'idle',
      aiTimer: 0,
      aiUpdate: emergencyCartAiUpdate,
      state: 'idle',
      deathCause: null,
      onWallHit: onEmergencyCartWallHit,
      puppet: {
        rig: 'cart_emergency_pinball',
        z: HERO_Z,
        skin: 'cart_emergency',
      },
    };

    attachRig(e);

    G.entities.push(e);
    G.movers.push(e);
    G.carts.push(e);
    notifyGroups(e);
    return e;
  }

  function spawnEmergencyCartAtTile(tx, ty) {
    return spawnEmergencyCart(toPxFromTile(tx), toPxFromTile(ty));
  }

  root.Entities = root.Entities || {};
  root.Entities.Carts = root.Entities.Carts || {};
  root.Entities.Carts.spawnCartFood = spawnCartFood;
  if (!root.spawnCartFood) root.spawnCartFood = spawnCartFood;
  root.Entities.Carts.spawnCartMeds = spawnCartMeds;
  if (!root.spawnCartMeds) root.spawnCartMeds = spawnCartMeds;
  root.Entities.Carts.spawnEmergencyCart = spawnEmergencyCartAtTile;
  if (!root.spawnEmergencyCart) root.spawnEmergencyCart = spawnEmergencyCartAtTile;
  root.createEmergencyCart = spawnEmergencyCart;
  root.cartFoodAiUpdate = cartFoodAiUpdate;
  root.cartMedsAiUpdate = cartMedsAiUpdate;
  root.emergencyCartAiUpdate = emergencyCartAiUpdate;
  root.onEmergencyCartWallHit = onEmergencyCartWallHit;
  root.createCartMeds = createCartMeds;
})(typeof window !== 'undefined' ? window : globalThis);
