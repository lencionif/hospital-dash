// filename: celador.entities.js
// Celador brutal: empuja, persigue y aplasta en 1 tile.
(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const ENT = W.ENT || (W.ENT = {});
  const TILE = W.TILE_SIZE || W.TILE || 32;
  const Entities = W.Entities || (W.Entities = {});
  const Pathfinding = W.Pathfinding || null;

  ENT.CELADOR = ENT.CELADOR ?? 401;

  // Backwards compatible registration helper
  if (typeof Entities.define !== 'function') {
    Entities.define = function define(name, factory) {
      this[name] = factory;
      return factory;
    };
  }

  const celadorPatrolPoints = [
    { x: 2, y: 2 },
    { x: 8, y: 2 },
    { x: 8, y: 8 },
    { x: 2, y: 8 }
  ];

  function logDebug(tag, data) {
    if (W.DEBUG || W.DEBUG_CELADOR) {
      try { console.debug(tag, data); } catch (_) {}
    }
  }

  function ensureArrays() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.movers)) G.movers = [];
    if (!Array.isArray(G.hostiles)) G.hostiles = [];
  }

  function createBaseCelador(pos, opts = {}) {
    const p = pos || {};
    const x = (typeof p.x === 'number') ? p.x : (Array.isArray(p) ? p[0] : p);
    const y = (typeof p.y === 'number') ? p.y : (Array.isArray(p) ? p[1] : 0);
    const base = (typeof Entities.createBaseHuman === 'function')
      ? Entities.createBaseHuman(pos, opts)
      : {
          x: x || 0,
          y: y || 0,
          w: TILE * 0.9,
          h: TILE * 0.9,
          vx: 0,
          vy: 0,
          solid: true,
          dynamic: true,
          pushable: true,
          mass: 1.1,
          mu: 0.08,
          rest: 0.2,
          puppetState: { anim: 'idle' }
        };
    return base;
  }

  function getHero() {
    const hero = G.player;
    return hero && !hero.dead ? hero : null;
  }

  function distanceBetween(a, b) {
    if (!a || !b) return Infinity;
    const ax = a.x + a.w * 0.5;
    const ay = a.y + a.h * 0.5;
    const bx = b.x + b.w * 0.5;
    const by = b.y + b.h * 0.5;
    return Math.hypot(ax - bx, ay - by);
  }

  function normalize(v) {
    const L = Math.hypot(v.x || 0, v.y || 0) || 1;
    return { x: (v.x || 0) / L, y: (v.y || 0) / L };
  }

  function moveEntityTowardsTile(ent, target, speed, dt) {
    if (!ent || !target) return;
    const tx = target.x * TILE + TILE * 0.5;
    const ty = target.y * TILE + TILE * 0.5;
    const dx = tx - (ent.x + ent.w * 0.5);
    const dy = ty - (ent.y + ent.h * 0.5);
    const L = Math.hypot(dx, dy) || 1;
    const v = speed || ent.moveSpeed || 1;
    ent.vx += (dx / L) * v * dt;
    ent.vy += (dy / L) * v * dt;
    ent.facingX = dx / L;
    ent.facingY = dy / L;
  }

  function hasReachedTile(ent, target) {
    if (!ent || !target) return false;
    const tx = target.x * TILE + TILE * 0.5;
    const ty = target.y * TILE + TILE * 0.5;
    const dx = tx - (ent.x + ent.w * 0.5);
    const dy = ty - (ent.y + ent.h * 0.5);
    return Math.abs(dx) < 6 && Math.abs(dy) < 6;
  }

  function followPath(ent, path, speed, dt) {
    if (!ent || !path || !path.length) return;
    if (ent._pathIndex == null) ent._pathIndex = 0;
    const step = path[Math.min(ent._pathIndex, path.length - 1)];
    if (step) moveEntityTowardsTile(ent, { x: step[0] ?? step.x, y: step[1] ?? step.y }, speed, dt);
    const target = { x: (step[0] ?? step.x) * TILE + TILE * 0.5, y: (step[1] ?? step.y) * TILE + TILE * 0.5 };
    const dx = target.x - (ent.x + ent.w * 0.5);
    const dy = target.y - (ent.y + ent.h * 0.5);
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) ent._pathIndex++;
  }

  function findEntitiesInFront(ent, rangeTiles = 0.8) {
    ensureArrays();
    const list = G.entities || [];
    const dir = normalize({ x: ent.vx || ent.facingX || 1, y: ent.vy || ent.facingY || 0 });
    const maxDist = TILE * rangeTiles;
    const ex = ent.x + ent.w * 0.5;
    const ey = ent.y + ent.h * 0.5;
    const res = [];
    for (const other of list) {
      if (!other || other === ent || other.dead) continue;
      const ox = other.x + other.w * 0.5;
      const oy = other.y + other.h * 0.5;
      const dx = ox - ex;
      const dy = oy - ey;
      const dot = dx * dir.x + dy * dir.y;
      if (dot < 0) continue;
      const dist = Math.hypot(dx, dy);
      if (dist <= maxDist + (other.w || TILE) * 0.5) res.push(other);
    }
    return res;
  }

  function pushEntitiesInFront(ent) {
    const frontEntities = findEntitiesInFront(ent, 0.8);
    const dir = normalize({ x: ent.vx || ent.facingX || 1, y: ent.vy || ent.facingY || 0 });
    frontEntities.forEach((other) => {
      if (other.kind === ENT.CELADOR || other.static) return;
      if (!other.isMovable && other.pushable === false) return;
      if (typeof other.vx !== 'number' || typeof other.vy !== 'number') return;
      other.vx += dir.x * ent.pushForce;
      other.vy += dir.y * ent.pushForce;
      other._lastPushedBy = 'CELADOR';
      other._lastPushedTime = performance.now ? performance.now() : Date.now();
      if (other.kind === ENT.CART) other.crushBonusDamage = ent.crushBonusDamage;
    });
    ent.ai.pushCooldown = 0.2;
    ent.puppetState.anim = 'push_action';
    logDebug('[CELADOR_PUSH]', { id: ent.id });
  }

  function applyDamageToHero(hero, dmg, meta) {
    if (!hero) return;
    if (typeof W.applyDamage === 'function') {
      W.applyDamage(hero, dmg, meta?.source || 'celador');
    } else if (typeof hero.hp === 'number') {
      hero.hp = Math.max(0, hero.hp - dmg);
      if (hero.hp === 0) hero.dead = true;
    }
  }

  function applyStunToHero(hero, seconds, meta) {
    if (!hero) return;
    if (typeof W.applyStun === 'function') {
      W.applyStun(hero, seconds, meta);
    } else {
      hero.stunnedUntil = (performance.now ? performance.now() : Date.now()) + seconds * 1000;
    }
  }

  function celadorHitHero(ent, hero) {
    const ai = ent.ai || {};
    if (ai.attackCooldown > 0) return;

    ai.attackCooldown = 1.0;
    ent.puppetState.anim = 'attack';
    applyDamageToHero(hero, ent.attackDamage, { source: 'celador' });
    applyStunToHero(hero, ent.stunTime, { source: 'celador' });
    logDebug('[CELADOR_HIT_HERO]', { id: ent.id });
  }

  function setCeladorWalkAnim(ent) {
    if (Math.abs(ent.vx) > Math.abs(ent.vy)) {
      ent.puppetState.anim = 'walk_side';
    } else if (ent.vy < 0) {
      ent.puppetState.anim = 'walk_up';
    } else {
      ent.puppetState.anim = 'walk_down';
    }
  }

  function updateCeladorPatrol(ent, dt) {
    const ai = ent.ai;
    const target = celadorPatrolPoints[ai.patrolIndex % celadorPatrolPoints.length];
    moveEntityTowardsTile(ent, target, ent.moveSpeed * 0.7, dt);
    setCeladorWalkAnim(ent);
    if (hasReachedTile(ent, target)) {
      ai.patrolIndex = (ai.patrolIndex + 1) % celadorPatrolPoints.length;
    }
  }

  function updateCeladorChase(ent, hero, dt) {
    const ai = ent.ai;
    if (ai.repathTimer <= 0 || !ai.path || ai.path.isStale) {
      if (Pathfinding?.findPath) {
        ai.path = Pathfinding.findPath(ent, hero);
        logDebug('[CELADOR_PATH]', { id: ent.id, pathLen: ai.path?.length || 0 });
      }
      ai.repathTimer = 0.6;
      ent._pathIndex = 0;
    }

    if (ai.path && ai.path.length) {
      followPath(ent, ai.path, ent.moveSpeed * ai.rageLevel, dt);
    } else {
      const hx = hero.x + hero.w * 0.5;
      const hy = hero.y + hero.h * 0.5;
      const dx = hx - (ent.x + ent.w * 0.5);
      const dy = hy - (ent.y + ent.h * 0.5);
      const L = Math.hypot(dx, dy) || 1;
      ent.vx += (dx / L) * ent.moveSpeed * ai.rageLevel * dt;
      ent.vy += (dy / L) * ent.moveSpeed * ai.rageLevel * dt;
      ent.facingX = dx / L;
      ent.facingY = dy / L;
    }

    setCeladorWalkAnim(ent);

    if (ai.pushCooldown <= 0) {
      pushEntitiesInFront(ent);
    }

    if (checkEntitiesTouch(ent, hero)) {
      celadorHitHero(ent, hero);
    }
  }

  function scheduleEntityFadeOut(ent, seconds) {
    if (!ent) return;
    const ms = Math.max(0, (seconds || 1.5) * 1000);
    setTimeout(() => {
      ent._remove = true;
      if (Array.isArray(G.entities)) {
        const idx = G.entities.indexOf(ent);
        if (idx >= 0) G.entities.splice(idx, 1);
      }
    }, ms);
  }

  function killCelador(ent, cause) {
    const ai = ent.ai;
    if (!ai || ai.state === 'dead') return;
    ai.state = 'dead';
    ent.vx = ent.vy = 0;

    switch (cause) {
      case 'fire':
        ent.puppetState.anim = 'die_fire';
        break;
      case 'crush':
        ent.puppetState.anim = 'die_crush';
        break;
      default:
        ent.puppetState.anim = 'die_hit';
    }

    scheduleEntityFadeOut(ent, 1.5);
    logDebug('[CELADOR_DEAD]', { id: ent.id, cause });
  }

  function checkEntitiesTouch(a, b) {
    if (!a || !b) return false;
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function updateCelador(ent, dt) {
    const ai = ent.ai;
    if (!ai || ai.state === 'dead') return;

    const hero = getHero();
    ai.repathTimer -= dt;
    ai.attackCooldown -= dt;
    ai.pushCooldown -= dt;

    if (!hero) {
      ai.state = 'idle';
      ent.vx = ent.vy = 0;
      ent.puppetState.anim = 'idle';
      return;
    }

    const dist = distanceBetween(ent, hero);
    if (dist < 7 * TILE && ai.state !== 'dead') {
      ai.state = 'chase';
    } else if (ai.state === 'chase' && dist > 10 * TILE) {
      ai.state = 'patrol';
    }

    switch (ai.state) {
      case 'chase':
        updateCeladorChase(ent, hero, dt);
        break;
      case 'patrol':
        updateCeladorPatrol(ent, dt);
        break;
      case 'idle':
      default:
        ent.vx = ent.vy = 0;
        ent.puppetState.anim = 'idle';
        break;
    }

    const speed = Math.hypot(ent.vx, ent.vy);
    if (speed > 0.01) {
      ent.facingX = (ent.vx || 0) / speed;
      ent.facingY = (ent.vy || 0) / speed;
    }

    logDebug('[CELADOR_STATE]', { id: ent.id, state: ai.state });
  }

  function createCelador(pos, opts = {}) {
    ensureArrays();
    const ent = createBaseCelador(pos, opts);
    ent.kind = ENT.CELADOR;
    ent.kindName = 'celador';
    ent.role = 'enemy_celador';
    ent.hp = 80;
    ent.moveSpeed = 1.1;
    ent.pushForce = 2.0;
    ent.attackDamage = 1;
    ent.stunTime = 1.0;
    ent.crushBonusDamage = 2;
    ent.ai = {
      state: 'patrol',
      patrolIndex: 0,
      targetHeroId: null,
      path: null,
      repathTimer: 0,
      attackCooldown: 0,
      pushCooldown: 0,
      rageLevel: 1.0
    };

    ent.kill = (cause) => killCelador(ent, cause);

    try {
      const puppet = W.Puppet?.bind?.(ent, 'npc_celador')
        || W.PuppetAPI?.attach?.(ent, { rig: 'npc_celador', z: 0, scale: 1 });
      ent.puppet = puppet;
      ent.puppetState = ent.puppetState || puppet?.state || { anim: 'idle' };
    } catch (_) {
      ent.puppetState = ent.puppetState || { anim: 'idle' };
    }

    G.entities.push(ent);
    G.movers.push(ent);
    G.hostiles.push(ent);
    try { W.EntityGroups?.assign?.(ent); } catch (_) {}
    try { W.EntityGroups?.register?.(ent, G); } catch (_) {}

    return ent;
  }

  Entities.define('celador', createCelador);

  const CeladorAPI = {
    create: createCelador,
    spawn: createCelador,
    update: updateCelador,
    updateAll(list, dt) {
      for (const ent of (list || G.entities || [])) {
        if (ent && ent.kind === ENT.CELADOR) updateCelador(ent, dt);
      }
    },
    registerSpawn() { return true; }
  };

  W.Entities.Celador = CeladorAPI;
  W.Entities.CeladorAPI = CeladorAPI;
  W.CeladorAPI = CeladorAPI;

  W.Entities.NPC = W.Entities.NPC || {};
  if (!W.Entities.NPC.spawn) {
    W.Entities.NPC.spawn = function (sub, x, y, payload) {
      if ((sub || '').toLowerCase() === 'celador') return createCelador({ x, y }, payload);
      return null;
    };
  }

  W.Entities.Celador.spawn = (x, y, p) => createCelador({ x, y }, p);
})(this);
