// assets/plugins/entities/boss_pyro.entities.js
// Boss nivel 3: Paciente psiquiátrica piromana.
(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.BOSS_PYRO === 'undefined') e.BOSS_PYRO = e.BOSS || 'BOSS_PYRO';
    if (typeof e.BOSS === 'undefined') e.BOSS = 9;
    if (typeof e.CART_EMERGENCY === 'undefined') e.CART_EMERGENCY = e.CART_URG || e.CART || 'CART_EMERGENCY';
    if (typeof e.GUARD === 'undefined') e.GUARD = 'GUARD';
    return e;
  })(root.ENT || (root.ENT = {}));

  const TILE = root.TILE_SIZE || root.TILE || 32;
  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 10;
  const DEBUG = !!root.DEBUG_BOSS_PYRO || !!root.DEBUG_RIGS;

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.movers)) G.movers = [];
    if (!Array.isArray(G.bosses)) G.bosses = [];
  }

  function attachRig(e) {
    try {
      const puppet = root.PuppetAPI?.attach?.(e, e.puppet || { rig: 'boss_pyro', z: HERO_Z, skin: 'default' });
      e.rigOk = e.rigOk === true || !!puppet;
    } catch (_) { e.rigOk = e.rigOk === true; }
  }

  function addEntity(e) {
    ensureCollections();
    if (e && !G.entities.includes(e)) G.entities.push(e);
    if (e && e.dynamic !== false && !G.movers.includes(e)) G.movers.push(e);
    if (e && !G.bosses.includes(e)) G.bosses.push(e);
    try { root.EntityGroups?.assign?.(e); } catch (_) {}
    try { root.EntityGroups?.register?.(e, G); } catch (_) {}
  }

  const randBetween = (a, b) => a + Math.random() * (b - a);

  function logDebug(...args) { if (DEBUG) try { console.log('[BossPyro]', ...args); } catch (_) {} }

  function startCountdownIfNeeded() {
    if (!G) return;
    if (typeof G.bossTimer !== 'number' || !Number.isFinite(G.bossTimer)) {
      G.bossTimer = 5 * 60;
    }
    try { root.BossAPI?.startBossCountdown?.(G.bossTimer); } catch (_) {}
    logDebug('Cuenta atrás iniciada', G.bossTimer);
  }

  function tickCountdown(dt, e) {
    if (!G || !e?.active) return;
    G.bossTimer = Math.max(0, (G.bossTimer ?? 0) - dt);
    e.bossTimer = G.bossTimer;
    try { root.BossAPI?.updateBossCountdown?.(G.bossTimer); } catch (_) {}
    if (G.bossTimer <= 0 && !e.dead && !e.cured) {
      e.dead = true;
      e.deathCause = e.deathCause || 'damage';
      e.state = 'death_damage';
      try { root.BossAPI?.failBoss?.(e); } catch (_) {}
    }
  }

  function spawnGuards(e) {
    if (!e) return;
    const baseTx = Math.round(e.x / TILE - 0.5);
    const baseTy = Math.round(e.y / TILE - 0.5);
    const spots = [
      { x: baseTx - 2, y: baseTy },
      { x: baseTx + 2, y: baseTy },
      { x: baseTx, y: baseTy - 2 },
    ];
    for (const pos of spots) {
      try {
        const guard = root.Entities?.Guardia?.spawnFromAscii?.(pos.x, pos.y, { touchDamage: 1, ai: { aggressive: true } })
          || root.Entities?.Guardia?.spawnAtTile?.(pos.x, pos.y, { touchDamage: 1, ai: { aggressive: true } });
        if (guard) {
          guard.speed = Math.max(guard.speed || 50, 70);
          guard.touchDamage = 1;
          guard.puppet = guard.puppet || { rig: 'npc_guard', z: HERO_Z };
          try { root.PuppetAPI?.attach?.(guard, guard.puppet); } catch (_) {}
          if (DEBUG) logDebug('Guardia agresiva creada', pos);
        }
      } catch (_) {}
    }
  }

  function attemptCure(e, cart) {
    if (!e || !cart) return false;
    const dx = cart.x - e.x;
    const dy = cart.y - e.y;
    const distSq = dx * dx + dy * dy;
    const maxDist = TILE * 2;
    if (distSq > maxDist * maxDist) return false;
    const relSpeed = Math.hypot(cart.vx || 0, cart.vy || 0);
    if (relSpeed > TILE * 3) {
      e.dead = true;
      e.deathCause = 'crush';
      e.state = 'death_crush';
      try { root.BossAPI?.failBoss?.(e); } catch (_) {}
      logDebug('Aplastada por carro');
      return false;
    }
    e.cured = true;
    e.active = false;
    e.state = 'cured';
    try { root.BossAPI?.completeBoss?.(e); } catch (_) {}
    try { root.FireAPI?.extinguishAll?.(); } catch (_) {}
    logDebug('Curada correctamente');
    return true;
  }

  function spawnPyroFire(e) {
    if (!root.FireAPI?.spawnAtTile || !G) return;
    const player = G.player;
    const cart = G.cart;
    const tiles = [];
    const ex = Math.round(e.x / TILE - 0.5);
    const ey = Math.round(e.y / TILE - 0.5);
    tiles.push({ tx: ex + 1, ty: ey });
    tiles.push({ tx: ex - 1, ty: ey });
    tiles.push({ tx: ex, ty: ey + 1 });
    tiles.push({ tx: ex, ty: ey - 1 });
    if (player) {
      tiles.push({ tx: Math.round(player.x / TILE), ty: Math.round(player.y / TILE) });
    }
    if (cart) {
      tiles.push({ tx: Math.round((player?.x ?? cart.x) / TILE), ty: Math.round((player?.y ?? cart.y) / TILE) });
      tiles.push({ tx: Math.round(cart.x / TILE), ty: Math.round(cart.y / TILE) });
    }
    const seen = new Set();
    for (const t of tiles) {
      const key = `${t.tx},${t.ty}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try { root.FireAPI.spawnAtTile(t.tx, t.ty, { source: 'boss_pyro' }); } catch (_) {}
    }
    logDebug('Fuego creado', tiles.length);
  }

  function updateMovement(e, dt) {
    if (!G.player) { e.vx = e.vy = 0; return; }
    const MAX_SPEED = 20;
    const dx = G.player.x - e.x;
    const dy = G.player.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const desired = { x: 0, y: 0 };
    if (dist < TILE) {
      desired.x = -(dx / dist) * MAX_SPEED;
      desired.y = -(dy / dist) * MAX_SPEED;
    } else if (e.strategyState === 'pressure_player') {
      desired.x = (dx / dist) * MAX_SPEED * 0.6;
      desired.y = (dy / dist) * MAX_SPEED * 0.6;
    } else {
      desired.x = (Math.sign(Math.random() - 0.5)) * MAX_SPEED * 0.25;
      desired.y = (Math.sign(Math.random() - 0.5)) * MAX_SPEED * 0.25;
    }
    e.vx = desired.x;
    e.vy = desired.y;
    e.state = (Math.abs(e.vx) > Math.abs(e.vy)) ? 'walk_h' : 'walk_v';
  }

  function bossPyroAiUpdate(dt = 0, e) {
    if (!e) return;
    if (e._culled && !e.active) return;

    e._touchCD = Math.max(0, (e._touchCD || 0) - dt);

    if (e.dead) {
      e.deathProgress = Math.min(1, (e.deathProgress || 0) + dt * 1.2);
      const cause = e.deathCause || 'damage';
      e.state = e.state?.startsWith('death_') ? e.state : `death_${cause}`;
      return;
    }

    if (e.cured) {
      e.state = 'cured';
      return;
    }

    const patientsRemaining = (G.patientsRemaining ?? G.stats?.remainingPatients ?? G.patients?.pending ?? 0);
    if (!e.active && patientsRemaining <= 0) {
      e.active = true;
      e.attackCooldown = randBetween(2, 4);
      e.moveCooldown = randBetween(1, 2);
      e.strategyState = 'zone_control';
      startCountdownIfNeeded();
      spawnGuards(e);
      logDebug('Boss Pyro activada');
    }

    if (e.active) {
      tickCountdown(dt, e);
    }

    const cart = Array.isArray(G.entities)
      ? G.entities.find((o) => !o?._remove && (o.kind === ENT.CART_EMERGENCY || o.kind === ENT.CART_URG || o.cart === 'urgencias'))
      : null;
    if (cart && e.active && !e.cured && !e.dead) {
      attemptCure(e, cart);
    }

    if (!e.active) {
      e.state = 'idle';
      return;
    }

    e.moveCooldown -= dt;
    if (e.moveCooldown <= 0) {
      updateMovement(e, dt);
      e.moveCooldown = randBetween(1, 2);
      e.strategyState = (e.strategyState === 'zone_control') ? 'pressure_player' : 'zone_control';
    }

    e.attackCooldown -= dt;
    if (e.attackCooldown <= 0) {
      e.state = 'attack';
      spawnPyroFire(e);
      e.attackCooldown = randBetween(3, 5);
    }

    const hero = G.player;
    const overlap = (a, b) => a && b && Math.abs(a.x - b.x) * 2 < (a.w + b.w) && Math.abs(a.y - b.y) * 2 < (a.h + b.h);
    if (hero && overlap(e, hero) && e._touchCD <= 0) {
      if (root.DamageAPI?.applyTouch) root.DamageAPI.applyTouch(e, hero);
      e._touchCD = e.touchCooldown || 0.9;
      e.state = 'eat';
    }

    if (!hero || (!e.vx && !e.vy)) {
      e.state = e.state === 'attack' ? e.state : 'idle';
    }
  }

  function spawnBossPyro(x, y, opts = {}) {
    ensureCollections();
    const e = {
      id: root.genId ? root.genId() : `bosspyro-${Math.random().toString(36).slice(2, 9)}`,
      kind: ENT.BOSS_PYRO,
      baseKind: ENT.BOSS,
      x,
      y,
      w: opts.w || 24,
      h: opts.h || 24,
      dir: opts.dir ?? 0,
      vx: 0,
      vy: 0,
      solid: true,
      health: opts.health ?? 8,
      maxHealth: opts.maxHealth ?? 8,
      touchDamage: 1,
      touchCooldown: 0.9,
      _touchCD: 0,
      fireImmune: true,
      populationType: 'boss_pyro',
      group: 'boss',
      state: 'idle',
      deathCause: null,
      aiUpdate: bossPyroAiUpdate,
      dead: false,
      active: false,
      strategyState: 'zone_control',
      puppet: { rig: 'boss_pyro', z: HERO_Z, skin: 'default' },
      onCrush() {
        if (this.dead) return;
        this.dead = true;
        this.deathCause = 'crush';
        this.state = 'death_crush';
        try { root.BossAPI?.failBoss?.(this); } catch (_) {}
      },
    };

    attachRig(e);
    addEntity(e);
    if (DEBUG) logDebug('Boss Pyro creada en', x, y);
    return e;
  }

  function spawnBossPyroAtTile(tx, ty, opts = {}) {
    const x = (tx + 0.5) * TILE;
    const y = (ty + 0.5) * TILE;
    return spawnBossPyro(x, y, opts);
  }

  function spawnBossForLevel(level, tx, ty) {
    if (level === 1 && root.Entities?.spawnBossHemaAtTile) return root.Entities.spawnBossHemaAtTile(tx, ty);
    if (level === 2 && root.Entities?.spawnBossCleanerAtTile) return root.Entities.spawnBossCleanerAtTile(tx, ty);
    if (level === 3) return spawnBossPyroAtTile(tx, ty);
    return null;
  }

  root.Entities = root.Entities || {};
  root.Entities.spawnBossPyro = spawnBossPyro;
  root.Entities.spawnBossPyroAtTile = spawnBossPyroAtTile;
  root.Entities.spawnBossForLevel = spawnBossForLevel;
  root.BossPyro = { spawnBossPyro, spawnBossPyroAtTile, bossPyroAiUpdate };
})(this);
