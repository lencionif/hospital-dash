// assets/plugins/entities/carts.entities.js
// Registro y comportamiento de los carros pinball (carro de comidas equilibrado)
(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.CART_FOOD === 'undefined') e.CART_FOOD = 'cart_food';
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

  root.Entities = root.Entities || {};
  root.Entities.Carts = root.Entities.Carts || {};
  root.Entities.Carts.spawnCartFood = spawnCartFood;
  if (!root.spawnCartFood) root.spawnCartFood = spawnCartFood;
  root.cartFoodAiUpdate = cartFoodAiUpdate;
})(typeof window !== 'undefined' ? window : globalThis);
