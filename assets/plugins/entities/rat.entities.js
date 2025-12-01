// assets/plugins/entities/rat.entities.js
// Entidad "rata" chibi terrestre con IA de persecución y rig Puppet.
(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.RAT === 'undefined') e.RAT = 6;
    return e;
  })(root.ENT || (root.ENT = {}));

  const TILE = root.TILE_SIZE || root.TILE || 32;
  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 5;
  const HP_PER_HEART = root.HP_PER_HEART || 1;
  const DEBUG_RAT = !!root.DEBUG_RAT;

  const RAT_MAX_SPEED = 180;            // rata muy rápida
  const RAT_ACCEL = 520;                // aceleración agresiva
  const RAT_DETECT_RADIUS = TILE * 10;  // radio de detección
  const RAT_WANDER_INTERVAL = 1.0;      // cambio ligero en modo wander
  const RAT_TOUCH = 0.5;

  function gridToWorldCenter(tx, ty) {
    const size = typeof root.GridMath?.tileSize === 'function' ? root.GridMath.tileSize() : TILE;
    return { x: tx * size + size * 0.5, y: ty * size + size * 0.5 };
  }

  function rngAngleNoise() { return (Math.random() - 0.5) * Math.PI * 0.2; }

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.enemies)) G.enemies = [];
    if (!Array.isArray(G.movers)) G.movers = [];
  }

  function attachRig(e) {
    if (root.PuppetAPI?.attach) {
      try {
        const rig = root.PuppetAPI.attach(e, { rig: 'enemy_rat', z: HERO_Z, data: { skin: 'rat_default' } });
        if (rig) e.rigOk = true;
      } catch (err) {
        if (DEBUG_RAT) console.warn('[rat] rig attach error', err);
        e.rigOk = false;
      }
    }
  }

  function spawnRat(x, y, opts = {}) {
    ensureCollections();
    const e = {
      id: root.genId ? root.genId() : `rat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.RAT,
      kindName: 'rat',
      populationType: 'animals',
      x,
      y,
      w: 24,
      h: 24,
      vx: 0,
      vy: 0,
      dir: 0,
      solid: true,
      maxSpeed: opts.maxSpeed ?? RAT_MAX_SPEED,
      acceleration: opts.acceleration ?? RAT_ACCEL,
      detectRadius: opts.detectRadius ?? RAT_DETECT_RADIUS,
      wanderChangeInterval: opts.wanderChangeInterval ?? RAT_WANDER_INTERVAL,
      health: opts.health ?? HP_PER_HEART,
      maxHealth: opts.maxHealth ?? HP_PER_HEART,
      touchDamage: opts.touchDamage ?? RAT_TOUCH,
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
      update(dt) { ratAiUpdate(this, dt); },
    };

    attachRig(e);

    G.entities.push(e);
    G.enemies.push(e);
    G.movers.push(e);
    if (DEBUG_RAT) console.log('[rat] creada', { x, y });
    return e;
  }

  function spawnRatAtTile(tx, ty, opts = {}) {
    const pos = gridToWorldCenter(tx, ty);
    return spawnRat(pos.x, pos.y, opts);
  }

  function updateCooldowns(e, dt) {
    if (e._touchCD > 0) e._touchCD = Math.max(0, e._touchCD - dt);
  }

  function applyMovement(e, ax, ay, dt) {
    e.vx += ax * dt;
    e.vy += ay * dt;
    const speed = Math.hypot(e.vx, e.vy);
    const max = e.maxSpeed || RAT_MAX_SPEED;
    if (speed > max) {
      const s = max / speed;
      e.vx *= s;
      e.vy *= s;
    }
  }

  function wanderBehavior(e, dt) {
    e._wanderTimer -= dt;
    if (e._wanderTimer <= 0) {
      e._wanderTimer = e.wanderChangeInterval;
      e._wanderDir += rngAngleNoise();
    }
    const ax = Math.cos(e._wanderDir) * e.acceleration * 0.35;
    const ay = Math.sin(e._wanderDir) * e.acceleration * 0.35;
    applyMovement(e, ax, ay, dt);
    e.isAttacking = false;
    e.isEating = false;
  }

  function chaseBehavior(e, player, dt) {
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ax = (dx / dist) * e.acceleration;
    const ay = (dy / dist) * e.acceleration;
    applyMovement(e, ax, ay, dt);
    e.dir = Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 1 : 3) : (dy >= 0 ? 2 : 0);
    return dist;
  }

  function handleAttack(e, target) {
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

  function handleDeathIfNeeded(e) {
    if (!e || !e.dead) return;
    if (!e.deathCause) e.deathCause = 'damage';
    try { root.SpawnerAPI?.notifyDeath?.(e, { populationType: e.populationType || 'animals', kind: ENT.RAT }); } catch (_) {}
  }

  function ratAiUpdate(e, dt = 0) {
    if (!e || e.dead) { handleDeathIfNeeded(e); return; }
    if (e._culled) return; // respeta culling de cámara

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
      if (e.aiMode !== 'chase' && DEBUG_RAT) console.log('[rat] modo persecución');
      e.aiMode = 'chase';
      const d = chaseBehavior(e, player, dt);
      if (d < TILE * 0.9) {
        handleAttack(e, player);
      }
    }

    if (root.PuppetAPI?.update && e.rig) {
      root.PuppetAPI.update(e.rig, dt);
    }

    handleDeathIfNeeded(e);
  }

  const RatAPI = {
    spawn: (x, y, opts = {}) => spawnRat(x, y, opts),
    spawnAtTile: (tx, ty, opts = {}) => spawnRatAtTile(tx, ty, opts),
    ai: ratAiUpdate,
  };

  root.RatAPI = RatAPI;
  root.Entities = root.Entities || {};
  root.Entities.spawnRatAtTile = spawnRatAtTile;
  root.Entities.spawnRatFromAscii = (tx, ty, def) => spawnRatAtTile(tx, ty, def || {});
})(window);
