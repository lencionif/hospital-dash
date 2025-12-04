// Entities.TCAE: NPC TCAE despistada con IA amable y rig chibi dedicado.
(function (root) {
  'use strict';

  const W = root || window;
  const G = W.G || (W.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.TCAE === 'undefined') e.TCAE = 947;
    if (typeof e.CART === 'undefined') e.CART = 401;
    if (typeof e.CART_FOOD === 'undefined') e.CART_FOOD = 402;
    if (typeof e.CART_MED === 'undefined') e.CART_MED = 403;
    if (typeof e.CART_URG === 'undefined') e.CART_URG = 404;
    return e;
  })(W.ENT || (W.ENT = {}));

  const TILE = W.TILE_SIZE || W.TILE || 32;
  const HERO_Z = typeof W.HERO_Z === 'number' ? W.HERO_Z : 10;
  const HP_PER_HEART = W.HP_PER_HEART || 1;

  const list = [];

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.npcs)) G.npcs = [];
  }

  function toCenter(tx, ty) {
    return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
  }

  function overlap(a, b) {
    return a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function normalize(dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  function distanceSq(a, b) {
    const dx = (b.x || 0) - (a.x || 0);
    const dy = (b.y || 0) - (a.y || 0);
    return dx * dx + dy * dy;
  }

  function moveTowards(e, x, y, speed) {
    const dx = x - e.x;
    const dy = y - e.y;
    const dir = normalize(dx, dy);
    e.vx = dir.x * speed;
    e.vy = dir.y * speed;
    e.dir = Math.abs(dx) > Math.abs(dy)
      ? (dx >= 0 ? 0 : Math.PI)
      : (dy >= 0 ? Math.PI / 2 : -Math.PI / 2);
    e.state = Math.abs(dx) > Math.abs(dy) ? 'walk_h' : 'walk_v';
  }

  function attachRig(e) {
    if (!W.PuppetAPI?.attach) return;
    try {
      const rig = PuppetAPI.attach(e, e.puppet);
      if (rig) e.rigOk = true;
    } catch (err) {
      e.rigOk = false;
      if (W.DEBUG_RIGS) {
        console.warn('[RigError] No rig for kind=TCAE', err);
      }
    }
  }

  function register(e) {
    ensureCollections();
    if (!G.entities.includes(e)) G.entities.push(e);
    if (!G.npcs.includes(e)) G.npcs.push(e);
    if (!list.includes(e)) list.push(e);
    try { W.EntityGroups?.assign?.(e); } catch (_) {}
    try { W.EntityGroups?.register?.(e, G); } catch (_) {}
  }

  function isCart(ent) {
    if (!ent || ent.dead) return false;
    const kinds = [ENT.CART, ENT.CART_FOOD, ENT.CART_MED, ENT.CART_URG];
    if (kinds.includes(ent.kind)) return true;
    return ent.isCart === true || !!ent.cartType || ent.kind === 'cart';
  }

  function findNearestBrokenCart(e, radius) {
    const radiusSq = radius * radius;
    let best = null;
    let bestDist = Infinity;
    for (const ent of G.entities || []) {
      if (!isCart(ent)) continue;
      if (!(ent.broken || ent.needsRepair || (ent.maxHealth && ent.health < ent.maxHealth * 0.6))) continue;
      const dSq = distanceSq(e, ent);
      if (dSq > radiusSq || dSq >= bestDist) continue;
      bestDist = dSq;
      best = ent;
    }
    return best;
  }

  function repairCart(cart) {
    if (!cart) return;
    cart.broken = false;
    cart.needsRepair = false;
    if (Number.isFinite(cart.maxHealth) && Number.isFinite(cart.health)) {
      cart.health = Math.min(cart.maxHealth, Math.max(cart.health, cart.maxHealth * 0.9));
    }
    cart.state = cart.state === 'broken' ? 'idle' : cart.state;
  }

  function healHeroFromTcae(e, hero) {
    if (!hero) return;
    if (Number.isFinite(hero.hpMax)) {
      hero.hp = Math.min(hero.hpMax, (hero.hp || 0) + 1);
    }
    if (Number.isFinite(hero.maxHealth) && Number.isFinite(hero.health)) {
      hero.health = Math.min(hero.maxHealth, hero.health + HP_PER_HEART);
      hero.hearts = hero.health / HP_PER_HEART;
    }
    if (typeof hero.heal === 'function') hero.heal(1, e);
  }

  function findCartTouching(e) {
    for (const ent of G.entities || []) {
      if (!isCart(ent)) continue;
      if (overlap(e, ent)) return ent;
    }
    return null;
  }

  function pushCartAccidentally(e, cart) {
    const dir = normalize(e.vx || 0.01, e.vy || 0.01);
    cart.vx = (cart.vx || 0) + dir.x * 160;
    cart.vy = (cart.vy || 0) + dir.y * 160;
    cart.lastPushedBy = e.id;
  }

  function spawnTcae(x, y, opts = {}) {
    ensureCollections();
    const hp = (opts.health ?? 3) * HP_PER_HEART;
    const e = {
      id: W.genId ? W.genId() : `tcae-${Math.random().toString(36).slice(2)}`,
      kind: ENT.TCAE,
      role: 'npc',
      populationType: 'humans',
      x, y,
      w: 24,
      h: 24,
      vx: 0,
      vy: 0,
      dir: 0,
      solid: true,
      health: hp,
      maxHealth: hp,
      touchDamage: 0,
      touchCooldown: 0.9,
      _touchCD: 0,
      fireImmune: false,
      aiState: 'idle',
      aiTimer: 0,
      targetCartId: null,
      canHealHeroes: opts.canHealHeroes !== false,
      puppet: { rig: 'npc_tcae', z: HERO_Z, skin: 'default' },
      aiUpdate: tcaeAiUpdate,
      state: 'idle',
      rigOk: false,
    };
    attachRig(e);
    register(e);
    return e;
  }

  function spawnTcaeAtTile(tx, ty, opts = {}) {
    const { x, y } = toCenter(tx, ty);
    return spawnTcae(x, y, opts);
  }

  function spawnFromAscii(tx, ty, def) {
    return spawnTcaeAtTile(tx, ty, { char: def?.char });
  }

  function tcaeAiUpdate(dt, e) {
    if (!e || e.dead || e._culled) return;
    e.state = e.state || 'idle';
    e.aiTimer = (e.aiTimer || 0) - dt;
    e._touchCD = Math.max(0, (e._touchCD || 0) - dt);

    const brokenCart = findNearestBrokenCart(e, 8 * TILE);
    if (brokenCart) {
      moveTowards(e, brokenCart.x, brokenCart.y, 30);
      e.dir = Math.atan2(brokenCart.y - e.y, brokenCart.x - e.x);
      if (distanceSq(e, brokenCart) < (TILE * TILE) * 0.36) {
        repairCart(brokenCart);
        e.state = 'talk';
        e.aiTimer = 1.0;
        e.vx = e.vy = 0;
      }
      return;
    }

    const hero = G.player;
    if (hero && e.canHealHeroes && ((hero.hp != null && hero.hp < hero.hpMax) || (hero.health != null && hero.health < hero.maxHealth))) {
      const d = Math.hypot((hero.x || 0) - e.x, (hero.y || 0) - e.y);
      if (d < 3 * TILE) {
        moveTowards(e, hero.x, hero.y, 28);
        if (d < TILE * 0.9) {
          healHeroFromTcae(e, hero);
          e.state = 'eat';
          e.aiTimer = 1.0;
          e.vx = e.vy = 0;
        }
        return;
      }
    }

    if (e.aiTimer <= 0) {
      const r = Math.random();
      if (r < 0.5) {
        const angle = Math.random() * Math.PI * 2;
        e.vx = Math.cos(angle) * 25;
        e.vy = Math.sin(angle) * 25;
        e.state = 'walk_h';
      } else {
        e.vx = 0;
        e.vy = 0;
        e.state = 'idle';
      }
      e.aiTimer = 1.5 + Math.random() * 2;
    }

    const cartHit = findCartTouching(e);
    if (cartHit) {
      pushCartAccidentally(e, cartHit);
      e.state = 'push';
    }
  }

  function updateAll(dt = 0) {
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e) { list.splice(i, 1); continue; }
      if (e.dead) {
        if (!e._notifiedDeath && W.SpawnerAPI?.notifyDeath) {
          e._notifiedDeath = true;
          try { SpawnerAPI.notifyDeath(e); } catch (_) {}
        }
        continue;
      }
      if (typeof e.aiUpdate === 'function') e.aiUpdate(dt, e);
    }
  }

  const api = W.TCAEAPI = W.TCAEAPI || {};
  api.spawn = spawnTcaeAtTile;
  api.spawnAt = spawnTcae;
  api.spawnFromAscii = spawnFromAscii;
  api.update = updateAll;

  const Entities = W.Entities || (W.Entities = {});
  Entities.TCAE = Entities.TCAE || {};
  Entities.TCAE.spawn = spawnTcaeAtTile;
  Entities.TCAE.spawnFromAscii = spawnFromAscii;
  Entities.TCAE.updateAll = updateAll;
  Entities.spawnTcaeAtTile = spawnTcaeAtTile;
})(typeof window !== 'undefined' ? window : globalThis);
