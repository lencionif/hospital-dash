// assets/plugins/entities/supervisor.entities.js
// Supervisora: NPC hostil que patrulla zonas clave, deja papelitos y lanza aviones de papel.
(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.SUPERVISOR === 'undefined') e.SUPERVISOR = 20;
    if (typeof e.PAPER_PLANE === 'undefined') e.PAPER_PLANE = 21;
    if (typeof e.PAPER_NOTE === 'undefined') e.PAPER_NOTE = 22;
    return e;
  })(root.ENT || (root.ENT = {}));

  const TILE = root.TILE_SIZE || root.TILE || 32;
  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 5;
  const HP_PER_HEART = root.HP_PER_HEART || 1;
  const DEBUG_SUPERVISOR = !!root.DEBUG_SUPERVISOR;
  const supervisors = [];

  function gridToWorldCenter(tx, ty) {
    const size = typeof root.GridMath?.tileSize === 'function' ? root.GridMath.tileSize() : TILE;
    return { x: tx * size + size * 0.5, y: ty * size + size * 0.5 };
  }

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.movers)) G.movers = [];
    if (!Array.isArray(G.npcs)) G.npcs = [];
  }

  function attachRig(e) {
    if (root.PuppetAPI?.attach) {
      try {
        const rig = root.PuppetAPI.attach(e, { rig: 'npc_supervisora', z: HERO_Z, skin: e.skin || 'default' });
        if (rig) e.rigOk = true;
      } catch (err) {
        if (DEBUG_SUPERVISOR) console.warn('[supervisora] rig attach error', err);
        e.rigOk = false;
      }
    }
  }

  function spawnSupervisor(x, y, opts = {}) {
    ensureCollections();
    const e = {
      id: root.genId ? root.genId() : `super-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.SUPERVISOR,
      kindName: 'supervisora',
      populationType: 'humans',
      role: 'npc',
      x,
      y,
      w: 24,
      h: 24,
      vx: 0,
      vy: 0,
      dir: 0,
      solid: true,
      health: opts.health ?? 4 * HP_PER_HEART,
      maxHealth: opts.maxHealth ?? 4 * HP_PER_HEART,
      touchDamage: opts.touchDamage ?? 0.5,
      touchCooldown: opts.touchCooldown ?? 0.9,
      _touchCD: 0,
      fireImmune: false,
      dead: false,
      deathCause: null,
      state: 'idle',
      aiState: 'idle',
      patrolPoints: opts.patrolPoints || null,
      currentPatrolIndex: 0,
      detectionRadius: opts.detectionRadius || TILE * 6,
      rangedCooldown: 0,
      noteCooldown: 0,
      stunnedTimer: 0,
      maxSpeed: 110,
      puppet: { rig: 'npc_supervisora', z: HERO_Z, skin: 'default' },
      update(dt) { supervisorAiUpdate(this, dt); },
    };

    attachRig(e);
    G.entities.push(e);
    G.npcs.push(e);
    G.movers.push(e);
    supervisors.push(e);
    if (DEBUG_SUPERVISOR) console.log('[supervisora] creada', x, y);
    return e;
  }

  function spawnSupervisorAt(tx, ty, opts = {}) {
    const pos = gridToWorldCenter(tx, ty);
    return spawnSupervisor(pos.x, pos.y, opts);
  }

  function handleDeath(e) {
    if (!e.dead) return;
    if (!e.deathCause) e.deathCause = 'damage';
    try { root.SpawnerAPI?.notifyDeath?.(e, { populationType: e.populationType || 'humans', kind: ENT.SUPERVISOR }); } catch (_) {}
  }

  function updateCooldowns(e, dt) {
    if (e._touchCD > 0) e._touchCD -= dt;
    if (e.rangedCooldown > 0) e.rangedCooldown -= dt;
    if (e.noteCooldown > 0) e.noteCooldown -= dt;
  }

  function maybeApplySupervisorTouch(e, player) {
    if (!player || e._touchCD > 0) return;
    const AABB = root.AABB || ((a, b) => a && b && Math.abs(a.x - b.x) * 2 < (a.w + b.w) && Math.abs(a.y - b.y) * 2 < (a.h + b.h));
    const overlap = AABB(e, player);
    if (!overlap) return;
    if (!player._supervisorTouchStage || player._supervisorTouchStage === 0) {
      player._supervisorTouchStage = 1;
      player.stunnedTimer = Math.max(player.stunnedTimer || 0, 0.8);
    } else {
      if (root.DamageAPI?.applyTouch) root.DamageAPI.applyTouch(e, player);
      player._supervisorTouchStage = 0;
    }
    e._touchCD = e.touchCooldown || 0.9;
  }

  function moveSupervisorToward(e, target, dt) {
    if (!target) { e.vx = 0; e.vy = 0; return; }
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = 80 + (e.aggressive ? 30 : 0);
    e.vx = (dx / dist) * speed;
    e.vy = (dy / dist) * speed;
    e.dir = Math.atan2(dy, dx);
  }

  function patrolSupervisor(e, dt) {
    const pts = e.patrolPoints || [];
    if (!pts.length) { e.vx = 0; e.vy = 0; e.state = 'idle'; return; }
    const target = pts[e.currentPatrolIndex % pts.length];
    moveSupervisorToward(e, target, dt);
    const dist = Math.hypot((target.x || 0) - e.x, (target.y || 0) - e.y);
    if (dist < 8) {
      e.currentPatrolIndex = (e.currentPatrolIndex + 1) % pts.length;
      e.vx = 0; e.vy = 0; e.state = 'talk';
    }
  }

  function getStrategicTarget(e, player) {
    if (!player) return null;
    const bells = Array.isArray(G.bells) ? G.bells : [];
    const meds = root.Entities?.Objects?.medCart || G.cart;
    const points = [];
    for (const b of bells) {
      const bellEnt = b?.e || b;
      if (bellEnt?.x != null && bellEnt?.y != null) points.push({ x: bellEnt.x, y: bellEnt.y });
    }
    if (meds?.x != null && meds?.y != null) points.push({ x: meds.x, y: meds.y });
    if (!points.length) return { x: player.x, y: player.y };
    // elige punto más cercano al jugador para interponerse
    let best = points[0];
    let bestDist = Math.hypot(points[0].x - player.x, points[0].y - player.y);
    for (const p of points) {
      const d = Math.hypot(p.x - player.x, p.y - player.y);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return { x: (player.x + best.x) * 0.5, y: (player.y + best.y) * 0.5 };
  }

  function findSupervisorPatrolPoints() {
    const pts = [];
    const bells = Array.isArray(G.bells) ? G.bells : [];
    for (const b of bells) {
      const bell = b?.e || b;
      if (bell?.x != null && bell?.y != null) pts.push({ x: bell.x, y: bell.y });
    }
    if (G.cart?.x != null && G.cart?.y != null) pts.push({ x: G.cart.x, y: G.cart.y });
    if (!pts.length && G.mapW && G.mapH) {
      const center = gridToWorldCenter(Math.floor(G.mapW / 2), Math.floor(G.mapH / 2));
      pts.push(center);
    }
    return pts;
  }

  function dropDebuffNote(e) {
    if (!root.Entities?.PaperNote?.spawn) return;
    const note = root.Entities.PaperNote.spawn(e.x, e.y, { source: e, debuffType: 'controls' });
    if (note) G.entities.push(note);
    if (DEBUG_SUPERVISOR) console.log('[supervisora] suelta papelito');
  }

  function spawnPaperPlane(e, player) {
    if (!root.Entities?.PaperPlane?.spawn) return null;
    const proj = root.Entities.PaperPlane.spawn(e, player);
    if (proj && !G.entities.includes(proj)) G.entities.push(proj);
    if (DEBUG_SUPERVISOR) console.log('[supervisora] lanza avión');
    return proj;
  }

  function updateSupervisorVisualState(e) {
    if (e.dead) return;
    const mvx = Math.abs(e.vx || 0);
    const mvy = Math.abs(e.vy || 0);
    if (e.state === 'attack' || e.state === 'eat' || e.state === 'talk') return;
    if (mvx > 1 || mvy > 1) {
      e.state = mvx > mvy ? 'walk_h' : 'walk_v';
    } else {
      e.state = 'idle';
    }
  }

  function supervisorAiUpdate(e, dt = 0) {
    if (!e || e.dead) { handleDeath(e); return; }
    if (e._culled) return;
    updateCooldowns(e, dt);

    if (!e.patrolPoints || !e.patrolPoints.length) {
      e.patrolPoints = findSupervisorPatrolPoints();
      e.currentPatrolIndex = 0;
    }

    const player = G.player;
    const dx = player ? player.x - e.x : 0;
    const dy = player ? player.y - e.y : 0;
    const dist = player ? Math.hypot(dx, dy) : Infinity;
    const inDetection = player && dist < e.detectionRadius;

    if (inDetection) {
      moveSupervisorToward(e, getStrategicTarget(e, player), dt);
      if (e.rangedCooldown <= 0) { e.state = 'attack'; spawnPaperPlane(e, player); e.rangedCooldown = 5; }
      if (e.noteCooldown <= 0) { dropDebuffNote(e); e.noteCooldown = 8; }
      maybeApplySupervisorTouch(e, player);
    } else {
      patrolSupervisor(e, dt);
    }

    updateSupervisorVisualState(e);
    handleDeath(e);
  }

  function cleanupList(list) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (!list[i] || list[i]._dead) list.splice(i, 1);
    }
  }

  const SupervisoraAPI = {
    spawn: (x, y, opts = {}) => spawnSupervisor(x, y, opts),
    spawnAt: (tx, ty, opts = {}) => spawnSupervisorAt(tx, ty, opts),
    spawnFromAscii: (tx, ty, def) => spawnSupervisorAt(tx, ty, def || {}),
    aiUpdate: supervisorAiUpdate,
    update(dt = 0) {
      for (const s of supervisors) supervisorAiUpdate(s, dt);
      cleanupList(supervisors);
    }
  };

  root.SupervisoraAPI = SupervisoraAPI;
  root.Entities = root.Entities || {};
  root.Entities.Supervisor = SupervisoraAPI;
  root.Entities.spawnSupervisorFromAscii = (tx, ty, def) => spawnSupervisorAt(tx, ty, def || {});
})(window);
