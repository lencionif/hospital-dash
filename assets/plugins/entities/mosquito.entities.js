// assets/plugins/entities/mosquito.entities.js
// Entidad "mosquito" volador chibi con IA y rig Puppet.
(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.MOSQUITO === 'undefined') e.MOSQUITO = 7;
    return e;
  })(root.ENT || (root.ENT = {}));

  const TILE = root.TILE_SIZE || root.TILE || 32;
  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 5;
  const HP_PER_HEART = root.HP_PER_HEART || 1;
  const DEBUG_MOSQUITO = !!root.DEBUG_MOSQUITO;

  const MOSQUITO_MAX_SPEED = 140;
  const MOSQUITO_ACCEL = 420;
  const DETECT_RADIUS = TILE * 8;
  const ORBIT_RADIUS = TILE * 1.5;
  const ATTACK_RANGE = TILE * 0.7;
  const WANDER_INTERVAL = 0.7;

  function gridToWorldCenter(tx, ty) {
    const size = typeof root.GridMath?.tileSize === 'function' ? root.GridMath.tileSize() : TILE;
    return { x: tx * size + size * 0.5, y: ty * size + size * 0.5 };
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rngAngleNoise() { return (Math.random() - 0.5) * Math.PI * 0.35; }

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.enemies)) G.enemies = [];
    if (!Array.isArray(G.movers)) G.movers = [];
  }

  function attachRig(e) {
    if (root.PuppetAPI?.attach) {
      try {
        const rig = root.PuppetAPI.attach(e, { rig: 'enemy_mosquito', z: HERO_Z, data: { skin: 'mosquito_default' } });
        if (rig) e.rigOk = true;
      } catch (err) {
        if (DEBUG_MOSQUITO) console.warn('[mosquito] rig attach error', err);
        e.rigOk = false;
      }
    }
  }

  function spawnMosquito(x, y, opts = {}) {
    ensureCollections();
    const e = {
      id: root.genId ? root.genId() : `mosq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.MOSQUITO,
      kindName: 'mosquito',
      populationType: 'animals',
      x,
      y,
      w: 22,
      h: 22,
      vx: 0,
      vy: 0,
      dir: 0,
      solid: true,
      maxSpeed: MOSQUITO_MAX_SPEED,
      acceleration: MOSQUITO_ACCEL,
      detectRadius: DETECT_RADIUS,
      orbitRadius: ORBIT_RADIUS,
      wanderChangeInterval: WANDER_INTERVAL,
      attackRange: ATTACK_RANGE,
      health: opts.health ?? HP_PER_HEART,
      maxHealth: opts.maxHealth ?? HP_PER_HEART,
      touchDamage: opts.touchDamage ?? 0.5,
      touchCooldown: opts.touchCooldown ?? 0.9,
      _touchCD: 0,
      fireImmune: false,
      dead: false,
      deathCause: null,
      isAttacking: false,
      isEating: false,
      aiMode: 'wander',
      _wanderDir: Math.random() * Math.PI * 2,
      _wanderTimer: 0,
      _orbitClockwise: Math.random() > 0.5,
      update(dt) { mosquitoAiUpdate(this, dt); },
    };

    attachRig(e);

    G.entities.push(e);
    G.enemies.push(e);
    G.movers.push(e);
    if (DEBUG_MOSQUITO) console.log('[mosquito] creado', { x, y });
    return e;
  }

  function spawnMosquitoAtTile(tx, ty, opts = {}) {
    const pos = gridToWorldCenter(tx, ty);
    return spawnMosquito(pos.x, pos.y, opts);
  }

  function handleAttack(e, target, dt) {
    if (!target || e._touchCD > 0) return;
    const overlap = !(e.x + e.w * 0.5 <= target.x - target.w * 0.5
      || e.x - e.w * 0.5 >= target.x + target.w * 0.5
      || e.y + e.h * 0.5 <= target.y - target.h * 0.5
      || e.y - e.h * 0.5 >= target.y + target.h * 0.5);
    if (!overlap) return;
    e.isAttacking = true;
    e._touchCD = e.touchCooldown;
    if (root.DamageAPI?.applyTouch) {
      root.DamageAPI.applyTouch(e, target);
    } else if (typeof root.damagePlayer === 'function') {
      root.damagePlayer(e, e.touchDamage * 2);
    }
  }

  function updateCooldowns(e, dt) {
    if (e._touchCD > 0) e._touchCD = Math.max(0, e._touchCD - dt);
  }

  function applyMovement(e, ax, ay, dt) {
    e.vx += ax * dt;
    e.vy += ay * dt;
    const speed = Math.hypot(e.vx, e.vy);
    const max = e.maxSpeed || MOSQUITO_MAX_SPEED;
    if (speed > max) {
      const s = max / speed;
      e.vx *= s;
      e.vy *= s;
    }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
  }

  function wanderBehavior(e, dt) {
    e._wanderTimer -= dt;
    if (e._wanderTimer <= 0) {
      e._wanderTimer = e.wanderChangeInterval;
      e._wanderDir += rngAngleNoise();
    }
    const ax = Math.cos(e._wanderDir) * e.acceleration * 0.4;
    const ay = Math.sin(e._wanderDir) * e.acceleration * 0.4;
    applyMovement(e, ax, ay, dt);
    e.isAttacking = false;
    e.isEating = false;
  }

  function orbitBehavior(e, player, dt) {
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist;
    const dirY = dy / dist;
    const tangent = e._orbitClockwise ? { x: dirY, y: -dirX } : { x: -dirY, y: dirX };
    const targetX = player.x + tangent.x * e.orbitRadius;
    const targetY = player.y + tangent.y * e.orbitRadius;
    const toTargetX = targetX - e.x;
    const toTargetY = targetY - e.y;
    const toTargetDist = Math.hypot(toTargetX, toTargetY) || 1;
    const ax = (toTargetX / toTargetDist) * e.acceleration;
    const ay = (toTargetY / toTargetDist) * e.acceleration;
    applyMovement(e, ax, ay, dt);
    e.isAttacking = false;
    e.isEating = false;
  }

  function mosquitoAiUpdate(e, dt = 0) {
    if (!e || e.dead) return;
    if (e._culled) return;

    e.isAttacking = false;
    e.isEating = false;
    updateCooldowns(e, dt);

    const player = G.player;
    const dx = player ? player.x - e.x : 0;
    const dy = player ? player.y - e.y : 0;
    const dist = player ? Math.hypot(dx, dy) : Infinity;

    if (!player || dist > e.detectRadius) {
      e.aiMode = 'wander';
      wanderBehavior(e, dt);
    } else {
      e.aiMode = 'orbit';
      orbitBehavior(e, player, dt);
      if (dist < e.attackRange) {
        handleAttack(e, player, dt);
      }
    }

    if (player && e.isAttacking && dist < e.attackRange * 0.8) {
      e.isEating = true;
    }

    if (root.PuppetAPI?.update && e.rig) {
      root.PuppetAPI.update(e.rig, dt);
    }
  }

  const MosquitoAPI = {
    spawn: (x, y, opts = {}) => spawnMosquito(x, y, opts),
    spawnAtTile: (tx, ty, opts = {}) => spawnMosquitoAtTile(tx, ty, opts),
    ai: mosquitoAiUpdate,
  };

  root.MosquitoAPI = MosquitoAPI;
  root.Mosquitos = MosquitoAPI;

  root.Entities = root.Entities || {};
  root.Entities.spawnMosquitoAtTile = spawnMosquitoAtTile;
  root.Entities.spawnMosquitoFromAscii = (tx, ty, def) => spawnMosquitoAtTile(tx, ty, def || {});
})(window);
