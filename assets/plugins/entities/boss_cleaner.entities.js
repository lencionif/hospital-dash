// assets/plugins/entities/boss_cleaner.entities.js
// Entidad Boss Nivel 2: Jefa de limpiadoras desmayada. Se activa cuando
// no quedan pacientes normales, lanza cuenta atrás de 5 minutos y se cura
// acercando el carro de urgencias sin aplastarla.
(function (W) {
  'use strict';

  const root = W || window;
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.BOSS === 'undefined') e.BOSS = 'BOSS';
    if (typeof e.BOSS_CLEANER === 'undefined') e.BOSS_CLEANER = 'BOSS_CLEANER';
    if (typeof e.CART_EMERGENCY === 'undefined') e.CART_EMERGENCY = e.CART_URG || e.CART || 'CART_EMERGENCY';
    if (typeof e.FIRE === 'undefined') e.FIRE = 'FIRE';
    return e;
  })(root.ENT || (root.ENT = {}));

  const G = root.G || (root.G = {});
  const TILE = root.TILE_SIZE || root.TILE || 32;
  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 10;
  const HP_PER_HEART = root.HP_PER_HEART || 1;
  const BOSS_CLEANER_HP = root.BOSS_CLEANER_HP || 1200;
  const DEBUG_BOSS = !!root.DEBUG_BOSS || !!root.DEBUG_RIGS;

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.movers)) G.movers = [];
    if (!Array.isArray(G.bosses)) G.bosses = [];
    if (!Array.isArray(G.cleaners)) G.cleaners = [];
  }

  function attachRig(e) {
    try {
      const puppet = root.PuppetAPI?.attach?.(e, e.puppet || { rig: 'boss_cleaner', z: HERO_Z, skin: 'default' });
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

  function spawnAggressiveCleanersAround(e) {
    if (!e) return [];
    const offsets = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }
    ];
    const spawned = [];
    const spawnFns = [
      root.Entities?.spawnAggressiveCleaner,
      root.Entities?.spawnCleanerAggressive,
      root.Entities?.spawnCleanerHostile,
      root.Entities?.spawnCleaner,
    ].filter(Boolean);

    for (const off of offsets) {
      if (spawned.length >= 3) break;
      const tx = Math.round(e.x / TILE - 0.5) + off.x;
      const ty = Math.round(e.y / TILE - 0.5) + off.y;
      if (tileIsBlocked(tx, ty)) continue;
      for (const fn of spawnFns) {
        try {
          const npc = fn.call(root.Entities, tx, ty, { aggressive: true, group: 'boss_add' });
          if (npc) {
            spawned.push(npc);
            break;
          }
        } catch (err) {
          if (DEBUG_BOSS) console.warn('[BossCleaner] Spawn cleaner add failed', err);
        }
      }
    }
    if (DEBUG_BOSS && !spawnFns.length) console.debug('[BossCleaner] No hay factoría de limpiadora hostil disponible');
    return spawned;
  }

  function activateBossCleaner(e) {
    if (!e || e.activated) return;
    e.activated = true;
    e.bossTimer = 5 * 60;
    e.state = 'idle';
    e.flashTimer = 0.5;
    e.adds = spawnAggressiveCleanersAround(e);
    try { root.BossAPI?.startBossCountdown?.(e.bossTimer); } catch (_) {}
    if (DEBUG_BOSS) console.log('[BossCleaner] Activada cuenta atrás 5 min nivel 2');
  }

  function maybeCureBossCleaner(e, cart) {
    if (!e || !cart || e.dead || e.cured) return false;
    const overlapX = Math.abs(cart.x - e.x) < (cart.w + e.w) * 0.5;
    const overlapY = Math.abs(cart.y - e.y) < (cart.h + e.h) * 0.5;
    if (overlapX && overlapY) return false; // está aplastando

    e.cured = true;
    e.state = 'talk';
    e.haloTimer = 1.2;
    e.activated = false;
    e.bossTimer = 0;
    e.dead = false;
    e.deathCause = null;

    if (Array.isArray(e.adds)) {
      for (const add of e.adds) {
        if (!add) continue;
        add.aggressive = false;
        add.state = 'idle';
      }
    }

    try { root.GameFlowAPI?.onBossCured?.(2, e); } catch (_) {}
    try { root.BossAPI?.completeBoss?.(e); } catch (_) {}
    return true;
  }

  function checkFireDamage(e, dt) {
    const fires = root.FireAPI?.getActive?.();
    if (!Array.isArray(fires) || !fires.length || e.fireImmune) return;
    for (const fire of fires) {
      if (!fire || fire.dead) continue;
      const dx = Math.abs((fire.x || 0) - e.x);
      const dy = Math.abs((fire.y || 0) - e.y);
      if (dx < (fire.w || TILE) * 0.5 && dy < (fire.h || TILE) * 0.5) {
        const tick = typeof fire.tick === 'number' ? Math.max(0.05, fire.tick) : 0.4;
        e._fireTimer = (e._fireTimer || 0) + dt;
        if (e._fireTimer >= tick) {
          e.health -= fire.damage || fire.dps || 0.5 * HP_PER_HEART;
          if (e.health <= 0) {
            e.dead = true;
            e.deathCause = 'fire';
          }
          e._fireTimer = 0;
        }
      }
    }
  }

  function bossCleanerAiUpdate(dt = 0, e) {
    if (!e) return;
    if (e._culled) return;

    if (e.dead) {
      const cause = e.deathCause || 'damage';
      e.state = `death_${cause}`;
      return;
    }

    if (e.cured) {
      e.state = 'talk';
      e.activated = false;
      return;
    }

    checkFireDamage(e, dt);
    if (e.dead) return;

    const patientsRemaining = (G.patientsRemaining ?? G.stats?.remainingPatients ?? G.patients?.pending ?? 0);
    const level = (G.level ?? G.levelIndex ?? 1);
    if (!e.activated && level === 2 && patientsRemaining <= 0) activateBossCleaner(e);

    if (e.activated) {
      e.bossTimer = Math.max(0, (e.bossTimer || 0) - dt);
      try { root.BossAPI?.updateBossCountdown?.(e.bossTimer); } catch (_) {}
      if (e.bossTimer <= 0) {
        e.dead = true;
        e.deathCause = e.deathCause || 'damage';
        e.state = 'death_damage';
        try { root.BossAPI?.failBoss?.(e); } catch (_) {}
        return;
      }
    }

    const emergencyCart = Array.isArray(G.entities)
      ? G.entities.find((o) => !o?._remove && (o.kind === ENT.CART_EMERGENCY || o.kind === ENT.CART_URG || o.kind === ENT.CART)
        && (o.cartType === 'emergency' || o.cart === 'urgencias' || o.tag === 'emergency' || o.kind === ENT.CART_URG || o.kind === ENT.CART_EMERGENCY))
      : null;

    if (emergencyCart && e.activated && !e.cured) {
      const dx = emergencyCart.x - e.x;
      const dy = emergencyCart.y - e.y;
      const distSq = dx * dx + dy * dy;
      const maxDist = TILE * 2;
      if (distSq <= maxDist * maxDist) {
        maybeCureBossCleaner(e, emergencyCart);
      }
    }

    e.state = e.state || 'idle';
  }

  function spawnBossCleanerAtTile(tx, ty, opts = {}) {
    ensureCollections();
    if (G.bossCleaner) return G.bossCleaner;
    const x = (tx + 0.5) * TILE;
    const y = (ty + 0.5) * TILE;
    const e = {
      id: root.genId ? root.genId() : `bosscleaner-${Math.random().toString(36).slice(2, 9)}`,
      kind: ENT.BOSS_CLEANER,
      kindName: 'boss_cleaner',
      baseKind: ENT.BOSS,
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
      health: opts.health ?? BOSS_CLEANER_HP,
      maxHealth: opts.maxHealth ?? BOSS_CLEANER_HP,
      touchDamage: 0,
      touchCooldown: 0.9,
      _touchCD: 0,
      fireImmune: false,
      dead: false,
      deathCause: null,
      activated: false,
      bossTimer: 0,
      cured: false,
      state: 'idle',
      deathProgress: 0,
      aiUpdate: bossCleanerAiUpdate,
      onCrush() {
        if (this.dead) return;
        this.deathCause = 'crush';
        this.dead = true;
        this.state = 'death_crush';
        try { root.BossAPI?.failBoss?.(this); } catch (_) {}
      },
      puppet: { rig: 'boss_cleaner', z: HERO_Z, skin: 'default' }
    };

    attachRig(e);
    addEntity(e);
    G.bossCleaner = e;
    return e;
  }

  root.Entities = root.Entities || {};
  root.Entities.spawnBossCleanerAtTile = spawnBossCleanerAtTile;
  root.Entities.spawnBossCleaner = function spawnBossCleaner(x, y, opts) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    return spawnBossCleanerAtTile(tx, ty, opts);
  };

  root.BossCleaner = {
    spawnBossCleanerAtTile,
    bossCleanerAiUpdate,
    activateBossCleaner,
    maybeCureBossCleaner,
  };
})(this);
