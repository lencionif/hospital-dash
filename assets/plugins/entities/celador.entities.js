// Entities.Celador: NPC hostil especializado en empujar carros contra el héroe.
(function (root) {
  'use strict';

  const W = root || window;
  const G = W.G || (W.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.CELADOR === 'undefined') e.CELADOR = 942;
    if (typeof e.CART === 'undefined') e.CART = 401;
    if (typeof e.CART_FOOD === 'undefined') e.CART_FOOD = 402;
    if (typeof e.CART_MED === 'undefined') e.CART_MED = 403;
    if (typeof e.CART_URG === 'undefined') e.CART_URG = 404;
    return e;
  })(W.ENT || (W.ENT = {}));

  const TILE = W.TILE_SIZE || W.TILE || 32;
  const HERO_Z = typeof W.HERO_Z === 'number' ? W.HERO_Z : 10;
  const HP_PER_HEART = W.HP_PER_HEART || 1;

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.npcs)) G.npcs = [];
  }

  function overlap(a, b) {
    return a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function distanceSq(a, b) {
    const dx = (b.x || 0) - (a.x || 0);
    const dy = (b.y || 0) - (a.y || 0);
    return dx * dx + dy * dy;
  }

  function normalize(dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  function moveWithPhysics(e, dt) {
    if (W.PhysicsAPI?.moveEntity) {
      PhysicsAPI.moveEntity(e, dt);
    } else {
      e.x += (e.vx || 0) * dt;
      e.y += (e.vy || 0) * dt;
    }
  }

  function playSfx(id, e) {
    if (!id || !W.AudioAPI?.play) return;
    AudioAPI.play(id, { x: e.x, y: e.y });
  }

  function applyTouchDamage(e, player) {
    if (!player || !W.DamageAPI?.applyTouch) return;
    DamageAPI.applyTouch(e, player);
  }

  function isCart(ent) {
    if (!ent || ent.dead) return false;
    const kinds = [ENT.CART, ENT.CART_FOOD, ENT.CART_MED, ENT.CART_URG];
    if (kinds.includes(ent.kind)) return true;
    return Boolean(ent.cartType || ent.cart);
  }

  function findCandidateCart(e, hero, entities) {
    const radius = 12 * TILE;
    const radiusSq = radius * radius;
    let best = null;
    let bestScore = -Infinity;
    for (const ent of entities) {
      if (!isCart(ent)) continue;
      const dSq = distanceSq(e, ent);
      if (dSq > radiusSq) continue;
      const hx = hero.x - ent.x;
      const hy = hero.y - ent.y;
      const dist = Math.hypot(hx, hy) || 1;
      const dir = { x: hx / dist, y: hy / dist };
      // Preferimos carros que se puedan alinear con el vector hacia el héroe.
      const score = -dist + Math.abs(dir.x) * 4 + Math.abs(dir.y) * 4;
      if (score > bestScore) {
        bestScore = score;
        best = ent;
      }
    }
    return best;
  }

  function desiredPushPosition(cart, hero, e) {
    const hx = hero.x - cart.x;
    const hy = hero.y - cart.y;
    const dir = normalize(-hx, -hy);
    const offset = TILE * 0.6 + (cart.w || 24) * 0.5 + (e.w || 24) * 0.5;
    return { x: cart.x + dir.x * offset, y: cart.y + dir.y * offset, dir };
  }

  function pushCart(e, cart, dir) {
    const force = 220;
    cart.vx = (cart.vx || 0) + dir.x * force;
    cart.vy = (cart.vy || 0) + dir.y * force;
    e.isPushing = true;
    e.state = 'push';
    e._pushTimer = 0.65;
    playSfx(e.audioProfile?.attack || 'sfx_attack', e);
  }

  function handleTouch(e, player, dt) {
    if (!e.touchDamage || e.dead || !player || player.dead) return;
    if (e._touchCD > 0) {
      e._touchCD -= dt;
      return;
    }
    if (overlap(e, player)) {
      e._touchCD = e.touchCooldown;
      applyTouchDamage(e, player);
    }
  }

  function celadorAiUpdate(dt, e, entities = G.entities) {
    if (e.dead) return;
    const player = G.player;
    if (!player) return;

    if (e._pushTimer > 0) {
      e._pushTimer -= dt;
      if (e._pushTimer <= 0) {
        e.isPushing = false;
        e.behavior = 'chase';
        e.targetCart = null;
      }
    }

    if (!e.targetCart || e.targetCart.dead) {
      e.targetCart = null;
      if (!e.isPushing) e.behavior = 'chase';
    }

    // Selección de carro prioritario.
    if (!e.targetCart && !e.isPushing) {
      const candidate = findCandidateCart(e, player, entities || []);
      if (candidate) {
        e.targetCart = candidate;
        e.behavior = 'get_cart';
      }
    }

    if (e.behavior === 'get_cart' && e.targetCart) {
      const { x: tx, y: ty, dir } = desiredPushPosition(e.targetCart, player, e);
      const dx = tx - e.x;
      const dy = ty - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const speed = e.speed || 70;
      e.vx = (dx / dist) * speed;
      e.vy = (dy / dist) * speed;
      e.state = Math.abs(e.vx) > Math.abs(e.vy) ? 'walk_h' : 'walk_v';
      if (overlap(e, e.targetCart)) {
        pushCart(e, e.targetCart, dir);
      }
    } else {
      // Persecución directa al héroe.
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const speed = e.speed || 70;
      e.vx = (dx / dist) * speed;
      e.vy = (dy / dist) * speed;
      const inContact = overlap(e, player);
      if (inContact) {
        e.state = 'attack';
      } else {
        e.state = Math.abs(e.vx) > Math.abs(e.vy) ? 'walk_h' : 'walk_v';
      }
    }

    // Ataque por contacto.
    if (!e.isPushing) handleTouch(e, player, dt);

    // Fallback de flags de animación secundaria.
    if (!e.behavior && Math.abs(e.vx) < 0.01 && Math.abs(e.vy) < 0.01) {
      e.state = 'idle';
    }
  }

  function celadorPhysics(dt, e) {
    moveWithPhysics(e, dt);
  }

  function celadorOnDamage(e, amount, cause) {
    if (e.dead) return;
    if (cause === 'fire' && e.fireImmune) return;
    e.health -= amount;
    if (e.health <= 0) {
      e.health = 0;
      e.dead = true;
      e.deathCause = cause || 'damage';
      e.state = 'dead';
      e.vx = e.vy = 0;
      try { W.SpawnerAPI?.notifyDeath?.(e, { populationType: e.populationType || 'humans', kind: ENT.CELADOR }); } catch (_) {}
      playSfx(e.audioProfile?.death || 'sfx_death', e);
      return;
    }
    playSfx(e.audioProfile?.hit || 'sfx_hit', e);
  }

  function spawnCelador(x, y, cfg = {}) {
    ensureCollections();
    const health = cfg.health ?? 4 * HP_PER_HEART;
    const e = {
      id: W.genId ? W.genId() : `celador-${Math.random().toString(36).slice(2)}`,
      kind: ENT.CELADOR,
      role: 'npc',
      populationType: 'humans',
      x,
      y,
      w: 24,
      h: 24,
      vx: 0,
      vy: 0,
      dir: 0,
      solid: true,
      health,
      maxHealth: health,
      touchDamage: cfg.touchDamage ?? 0.5,
      touchCooldown: cfg.touchCooldown ?? 0.9,
      _touchCD: 0,
      fireImmune: false,
      state: 'idle',
      behavior: 'chase',
      isPushing: false,
      targetCart: null,
      speed: cfg.speed || 70,
      puppet: { rig: 'npc_celador', z: HERO_Z, skin: 'default' },
      audioProfile: {
        hit: 'sfx_hit',
        death: 'sfx_death',
        attack: 'sfx_attack',
      },
      aiUpdate: celadorAiUpdate,
      physicsUpdate: celadorPhysics,
      onDamage: celadorOnDamage,
    };

    if (W.PuppetAPI?.attach) {
      try { PuppetAPI.attach(e, e.puppet); } catch (_) { e.rigOk = false; }
    }

    G.entities.push(e);
    G.npcs.push(e);
    return e;
  }

  function spawnCeladorAtTile(tx, ty, cfg) {
    const cx = (tx + 0.5) * TILE;
    const cy = (ty + 0.5) * TILE;
    return spawnCelador(cx, cy, cfg);
  }

  const CeladorAPI = {
    spawn: spawnCelador,
    aiUpdate: celadorAiUpdate,
    update(dt = 0) {
      for (const e of G.entities || []) {
        if (e && e.kind === ENT.CELADOR && !e.dead) {
          celadorAiUpdate(dt, e, G.entities);
        }
      }
    },
  };

  W.CeladorAPI = CeladorAPI;
  W.Entities = W.Entities || {};
  W.Entities.Celador = CeladorAPI;
  W.Entities.spawnCeladorAt = spawnCelador;
  W.Entities.spawnCeladorAtTile = spawnCeladorAtTile;
  W.Entities.spawnCeladorFromAscii = (tx, ty, def) => spawnCeladorAtTile(tx, ty, def || {});
})(window);
