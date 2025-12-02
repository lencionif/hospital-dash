// assets/plugins/entities/boss_hema.entities.js
// Entidad Boss Nivel 1: paciente hematológica en cama con cuenta atrás.
(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.BOSS_HEMA === 'undefined') e.BOSS_HEMA = e.BOSS || 'BOSS_HEMA';
    if (typeof e.CART_EMERGENCY === 'undefined') e.CART_EMERGENCY = e.CART_URG || e.CART || 'CART_EMERGENCY';
    return e;
  })(root.ENT || (root.ENT = {}));

  const TILE = root.TILE_SIZE || root.TILE || 32;
  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 10;
  const HP_PER_HEART = root.HP_PER_HEART || 1;
  const DEBUG_BOSS = !!root.DEBUG_BOSS || !!root.DEBUG_RIGS;

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.movers)) G.movers = [];
    if (!Array.isArray(G.bosses)) G.bosses = [];
  }

  function attachRig(e) {
    try {
      const puppet = root.PuppetAPI?.attach?.(e, e.puppet || { rig: 'boss_hema', z: HERO_Z, skin: 'default' });
      e.rigOk = e.rigOk === true || !!puppet;
    } catch (_) {
      e.rigOk = e.rigOk === true;
    }
  }

  function addEntity(e) {
    ensureCollections();
    if (e && !G.entities.includes(e)) G.entities.push(e);
    if (e && e.dynamic !== false && !G.movers.includes(e)) G.movers.push(e);
    if (e && !G.bosses.includes(e)) G.bosses.push(e);
    try { root.EntityGroups?.assign?.(e); } catch (_) {}
    try { root.EntityGroups?.register?.(e, G); } catch (_) {}
  }

  function tileIsBlocked(tx, ty) {
    const map = G.map || [];
    if (!map.length) return false;
    return map[ty]?.[tx] === 1;
  }

  function spawnAggressiveNursesAround(e) {
    if (!e) return;
    const offsets = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }
    ];
    let spawned = 0;
    for (const off of offsets) {
      if (spawned >= 3) break;
      const tx = Math.round(e.x / TILE - 0.5) + off.x;
      const ty = Math.round(e.y / TILE - 0.5) + off.y;
      if (tileIsBlocked(tx, ty)) continue;
      const spawn = root.Entities?.spawnAggressiveNurse || root.Entities?.spawnNurseSexyAt;
      if (typeof spawn === 'function') {
        const nurse = spawn(tx, ty, { aggressive: true });
        if (nurse) {
          spawned += 1;
          continue;
        }
      }
      if (DEBUG_BOSS) console.debug('[BossHema] No se pudo spawnear enfermera agresiva en', tx, ty);
    }
  }

  function bossHemaAiUpdate(dt = 0, e) {
    if (!e) return;
    if (e._culled && !e.bossActive) return;

    if (e.dead) {
      e.deathProgress = Math.min(1, (e.deathProgress || 0) + dt * 1.5);
      const cause = e.deathCause || 'damage';
      e.state = e.state?.startsWith('death_') ? e.state : `death_${cause}`;
      return;
    }

    if (e.cured) {
      e.state = 'cured';
      return;
    }

    const patientsRemaining = (G.patientsRemaining ?? G.stats?.remainingPatients ?? G.patients?.pending ?? 0);
    if (!e.bossActive && patientsRemaining <= 0) {
      e.bossActive = true;
      e.bossTimer = 5 * 60;
      e.state = 'talk';
      if (DEBUG_BOSS) console.log('[BossHema] Activada cuenta atrás 5 min');
      try { root.BossAPI?.startBossCountdown?.(e.bossTimer); } catch (_) {}
      spawnAggressiveNursesAround(e);
    }

    if (e.bossActive && !e.dead && !e.cured) {
      e.bossTimer = Math.max(0, (e.bossTimer || 0) - dt);
      try { root.BossAPI?.updateBossCountdown?.(e.bossTimer); } catch (_) {}
      if (e.bossTimer <= 0) {
        e.dead = true;
        e.deathCause = 'damage';
        e.state = 'death_damage';
        try { root.BossAPI?.failBoss?.(e); } catch (_) {}
        if (DEBUG_BOSS) console.log('[BossHema] Fracaso: paciente hematológica muerta');
        return;
      }
    }

    const emergencyCart = Array.isArray(G.entities)
      ? G.entities.find((o) => !o?._remove && (o.kind === ENT.CART_EMERGENCY || o.kind === ENT.CART_URG || o.kind === ENT.CART)
        && (o.cartType === 'emergency' || o.cart === 'urgencias' || o.tag === 'emergency' || o.kind === ENT.CART_URG || o.kind === ENT.CART_EMERGENCY))
      : null;

    if (emergencyCart && e.bossActive && !e.cured && !e.dead) {
      const dx = emergencyCart.x - e.x;
      const dy = emergencyCart.y - e.y;
      const distSq = dx * dx + dy * dy;
      const maxDist = TILE * 2;
      if (distSq <= maxDist * maxDist) {
        const speedSq = (emergencyCart.vx || 0) * (emergencyCart.vx || 0) + (emergencyCart.vy || 0) * (emergencyCart.vy || 0);
        if (speedSq < (TILE * 3) * (TILE * 3)) {
          e.cured = true;
          e.bossActive = false;
          e.state = 'cured';
          try { root.BossAPI?.completeBoss?.(e); } catch (_) {}
          if (DEBUG_BOSS) console.log('[BossHema] Curada correctamente');
        }
      }
    }
  }

  function spawnBossHemaAtTile(tx, ty, opts = {}) {
    const x = (tx + 0.5) * TILE;
    const y = (ty + 0.5) * TILE;
    const e = {
      id: root.genId ? root.genId() : `bosshema-${Math.random().toString(36).slice(2, 9)}`,
      kind: ENT.BOSS_HEMA,
      kindName: 'boss_hema',
      baseKind: ENT.BOSS || ENT.BOSS_HEMA,
      x,
      y,
      w: opts.w || 24,
      h: opts.h || 24,
      dir: opts.dir ?? 0,
      vx: 0,
      vy: 0,
      solid: true,
      pushable: true,
      populationType: 'boss',
      group: 'boss',
      health: opts.health ?? 999,
      maxHealth: opts.maxHealth ?? 999,
      touchDamage: 0,
      touchCooldown: 0.9,
      _touchCD: 0,
      fireImmune: false,
      dead: false,
      deathCause: null,
      bossActive: false,
      bossTimer: 0,
      cured: false,
      state: 'idle',
      deathProgress: 0,
      aiUpdate: bossHemaAiUpdate,
      onCrush() {
        if (this.dead) return;
        this.deathCause = 'crush';
        this.dead = true;
        this.state = 'death_crush';
        try { root.BossAPI?.failBoss?.(this); } catch (_) {}
      },
      puppet: { rig: 'boss_hema', z: HERO_Z, skin: 'default' }
    };

    attachRig(e);
    addEntity(e);
    return e;
  }

  root.Entities = root.Entities || {};
  root.Entities.spawnBossHemaAtTile = spawnBossHemaAtTile;

  root.BossHema = {
    spawnBossHemaAtTile,
    bossHemaAiUpdate,
    spawnAggressiveNursesAround
  };
})(this);
