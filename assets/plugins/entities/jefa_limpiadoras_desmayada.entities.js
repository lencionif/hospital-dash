(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const ENT = W.ENT || (W.ENT = {});
  const Entities = W.Entities || (W.Entities = {});
  const TILE = W.TILE_SIZE || W.TILE || 32;

  ENT.BOSS = ENT.BOSS || 'boss';

  if (typeof Entities.define !== 'function') {
    Entities.define = function define(name, factory) {
      this[name] = factory;
      return factory;
    };
  }

  const SMALL_ENEMY_KINDS = new Set(['enemy_rat', 'MOSQUITO', 'mosquito']);

  function centerOf(e) {
    return { x: (e?.x || 0) + (e?.w || 0) * 0.5, y: (e?.y || 0) + (e?.h || 0) * 0.5 };
  }

  function distanceBetween(a, b) {
    if (!a || !b) return Infinity;
    const ca = centerOf(a);
    const cb = centerOf(b);
    return Math.hypot(ca.x - cb.x, ca.y - cb.y);
  }

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.patients)) G.patients = [];
    if (!Array.isArray(G.hostiles)) G.hostiles = [];
    if (!Array.isArray(G.movers)) G.movers = [];
  }

  function isWallTile(tx, ty) {
    const map = G.map || [];
    return !!(map?.[ty]?.[tx]);
  }

  function applyCleanerPuddle(tx, ty) {
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    try { W.CleanerAPI?.spawnWaterPuddle?.(tx, ty); } catch (_) {}
    try {
      const px = tx * TILE + TILE * 0.5;
      const py = ty * TILE + TILE * 0.5;
      W.CleanerAPI?.leaveWetAtPx?.(px, py, (W.BALANCE?.cleaner?.wet?.ttlMs || 14000) * 1.1);
    } catch (_) {}
  }

  function attachBossRig(ent) {
    ent.puppetState = ent.puppetState || { anim: 'unconscious' };
    try {
      ent.puppet = (W.Puppet?.bind?.(ent, 'jefa_limpiadoras_lvl2'))
        || W.PuppetAPI?.attach?.(ent, { rig: 'jefa_limpiadoras_lvl2', z: 0, scale: 1 });
    } catch (_) {
      ent.puppet = ent.puppet || null;
    }
  }

  function attachAggressiveRig(ent) {
    ent.puppetState = ent.puppetState || { anim: 'idle' };
    try {
      ent.puppet = (W.Puppet?.bind?.(ent, 'cleaner_agresiva'))
        || W.PuppetAPI?.attach?.(ent, { rig: 'cleaner_agresiva', z: 0, scale: 1 });
    } catch (_) {
      ent.puppet = ent.puppet || null;
    }
  }

  function activateBossTimer(ent) {
    if (!ent || ent.bossTimerActive || ent.cured || ent.dead) return;
    ent.bossTimerActive = true;
    ent.ai.state = 'calling_help';
    try { W.HUD?.showCleanerBossTimer?.(); } catch (_) {}
    try { W.HUD?.updateCleanerBossTimer?.(ent.bossTimeLeft, ent.bossTimeMax); } catch (_) {}
    try { W.Narrator?.showObjective?.('¡La jefa de las limpiadoras está desmayada! Atiéndela antes de que se agote el tiempo.'); } catch (_) {}
    try { W.DialogAPI?.triggerOnce?.(ent, 'cleaner_boss_help_intro'); } catch (_) {}
  }

  function markBossFailure(ent) {
    ent.dead = true;
    ent.ai.state = 'dead';
    ent.bossTimerActive = false;
    try { W.HUD?.hideCleanerBossTimer?.(); } catch (_) {}
    if (G) G._gameOverReason = 'cleaner_boss_timeout';
    try { W.Narrator?.say?.('cleaner_boss_fail'); } catch (_) {}
    try { W.GameFlowAPI?.notifyHeroDeath?.(); } catch (_) {}
  }

  function tryTreatCleanerBoss(hero, boss) {
    if (!boss?.isJefaLimpiadoras || boss.cured || boss.dead) return false;
    const pill = hero?.carry || hero?.currentPill || G.carry || null;
    if (!pill) return false;
    const targetId = pill.targetPatientId || pill.patientId || pill.forPatientId || pill.pairName;
    if (targetId && targetId !== boss.id && targetId !== boss.keyName) return false;

    boss.cured = true;
    boss.bossTimerActive = false;
    boss.ai.state = 'stabilized';
    boss.puppetState.anim = 'stabilized';
    boss.attended = true;
    if (hero) { hero.carry = null; hero.currentPill = null; }
    G.carry = null;
    try { W.HUD?.hideCleanerBossTimer?.(); } catch (_) {}
    try { W.Narrator?.showObjective?.('¡La jefa está estable! Acerca el carro de urgencias hasta ella.'); } catch (_) {}
    try { W.DialogAPI?.triggerOnce?.(boss, 'cleaner_boss_stable'); } catch (_) {}
    console.debug('[CLEANER_BOSS_CURE]', { bossId: boss.id });
    return true;
  }

  function handleUrgencyCart(boss) {
    if (!boss || !boss.cured || boss.dead || boss.urgencyCartArrived === true) return;
    const cart = G.cart || G.emergencyCart || null;
    if (!cart || cart.dead) return;
    const dist = distanceBetween(boss, cart) / TILE;
    if (dist <= 1.05) {
      boss.urgencyCartArrived = true;
      try { W.Narrator?.showObjective?.('¡Has salvado a la jefa de las limpiadoras! Nivel superado.'); } catch (_) {}
      try { W.Narrator?.say?.('cleaner_boss_saved'); } catch (_) {}
      try { W.GameFlowAPI?.notifyBossFinalDelivered?.(); } catch (_) {}
      console.debug('[CLEANER_BOSS_URGENCY_CART]', { bossId: boss.id, cartId: cart.id });
    } else if (dist <= 2.2 && !boss._warnedCart) {
      boss._warnedCart = true;
      try { W.Narrator?.showHint?.('¡Ya casi! Acerca el carro de urgencias un poco más.'); } catch (_) {}
    }
  }

  function updateJefaAI(ent, dt) {
    const hero = G.player;
    const ai = ent.ai;
    ai.callPulse += dt;

    if (ai.state === 'calling_help' || ai.state === 'critical') {
      const dist = distanceBetween(ent, hero);
      if (dist < TILE * 3) {
        ent.puppetState.anim = 'call_help';
      } else {
        ent.puppetState.anim = 'unconscious';
      }
      if (dist < TILE * 1.2) {
        try { W.DialogAPI?.triggerOnce?.(ent, 'cleaner_boss_help'); } catch (_) {}
      }
      if (ent.bossTimerActive && ent.bossTimeMax > 0 && (ent.bossTimeLeft / ent.bossTimeMax) < 0.25) {
        ai.state = 'critical';
        try { W.HUD?.flashCleanerBossWarning?.(true); } catch (_) {}
      }
    }

    if (ai.state === 'stabilized') {
      ent.puppetState.anim = 'stabilized';
    }

    if (ai.state === 'dead') {
      ent.puppetState.anim = 'die_hit';
    }
  }

  function updateJefaAnim(ent) {
    const ai = ent.ai;
    const ps = ent.puppetState;
    if (ent.dead) { ps.anim = 'die_hit'; return; }
    switch (ai.state) {
      case 'unconscious': ps.anim = 'unconscious'; break;
      case 'calling_help': ps.anim = 'call_help'; break;
      case 'critical': ps.anim = 'critical'; break;
      case 'stabilized': ps.anim = 'stabilized'; break;
      default: ps.anim = 'unconscious'; break;
    }
  }

  function updateJefa(ent, dt) {
    if (!ent._timerInit) {
      const seconds = Number(ent.opts?.cleanerBossTimerSeconds ?? ent.opts?.bossTimerSeconds ?? G.cleanerBossTimerSeconds);
      ent.bossTimeMax = Number.isFinite(seconds) && seconds > 0 ? seconds : 90;
      ent.bossTimeLeft = ent.bossTimeMax;
      ent._timerInit = true;
    }

    if (!ent.bossTimerActive && !ent.cured && !ent.dead) {
      const stats = G.stats || {};
      const remaining = (stats.remainingPatients || 0) + (stats.activeFuriosas || 0);
      if (remaining <= 0) {
        activateBossTimer(ent);
      }
    }

    if (ent.bossTimerActive && !ent.cured && !ent.dead) {
      ent.bossTimeLeft = Math.max(0, (ent.bossTimeLeft || 0) - dt);
      try { W.HUD?.updateCleanerBossTimer?.(ent.bossTimeLeft, ent.bossTimeMax); } catch (_) {}
      if (ent.bossTimeLeft <= 0) {
        markBossFailure(ent);
      }
    }

    updateJefaAI(ent, dt);
    updateJefaAnim(ent);
    handleUrgencyCart(ent);
  }

  function createCleanerAgresiva(pos, opts = {}) {
    ensureCollections();
    const p = pos || {};
    const x = (typeof p.x === 'number') ? p.x : (Array.isArray(p) ? p[0] : p);
    const y = (typeof p.y === 'number') ? p.y : (Array.isArray(p) ? p[1] : 0);
    const base = (typeof Entities.createBaseHuman === 'function')
      ? Entities.createBaseHuman(pos, opts)
      : { x: x || 0, y: y || 0, w: TILE * 0.85, h: TILE * 0.9, solid: true, dynamic: true, pushable: true, puppetState: { anim: 'idle' } };

    const ent = Object.assign(base, {
      id: opts.id || `CLN_AGR_${Math.random().toString(36).slice(2, 8)}`,
      kind: 'cleaner_agresiva',
      kindName: 'cleaner_agresiva',
      role: 'cleaner_agresiva',
      hostile: true,
      hp: opts.hp ?? 80,
      moveSpeed: opts.moveSpeed ?? 1.25,
      chaseRadius: opts.chaseRadius ?? 5.5,
      patrolRadius: opts.patrolRadius ?? 2.5,
      attackPush: opts.attackPush ?? 95,
      ai: { state: 'patrol', timer: 0, variantIndex: opts.variantIndex || 0 },
      update(dt) {
        updateAggressiveCleaner(this, dt || 0);
      }
    });

    ent.group = 'human';
    try { W.EntityGroups?.assign?.(ent); } catch (_) {}
    try { W.EntityGroups?.register?.(ent, G); } catch (_) {}
    G.entities.push(ent);
    G.hostiles.push(ent);
    G.movers.push(ent);
    attachAggressiveRig(ent);
    return ent;
  }

  function updateAggressiveCleaner(ent, dt) {
    if (!ent || ent.dead) return;
    const hero = G.player;
    const boss = G.entities?.find((e) => e && e.isJefaLimpiadoras) || null;
    const ai = ent.ai || (ent.ai = { state: 'patrol', timer: 0 });
    ai.timer = (ai.timer || 0) + dt;

    const center = centerOf(ent);
    let target = null;
    if (hero) {
      const d = distanceBetween(ent, hero) / TILE;
      if (d < (ent.chaseRadius || 5)) {
        target = hero;
        ai.state = 'chase';
      }
    }

    if (!target && boss) {
      const bx = boss.x + (boss.w || TILE) * 0.5 + Math.cos(ai.timer * 0.7 + ai.variantIndex) * TILE * (ent.patrolRadius || 2.5);
      const by = boss.y + (boss.h || TILE) * 0.5 + Math.sin(ai.timer * 0.7 + ai.variantIndex) * TILE * (ent.patrolRadius || 2.5);
      target = { x: bx, y: by, w: 1, h: 1 };
      ai.state = 'patrol';
    }

    if (target) {
      const tc = centerOf(target);
      const dx = tc.x - center.x;
      const dy = tc.y - center.y;
      const len = Math.hypot(dx, dy) || 1;
      const speed = (ent.moveSpeed || 1) * TILE;
      ent.vx = (dx / len) * speed;
      ent.vy = (dy / len) * speed;
      if (ent.puppetState) {
        ent.puppetState.anim = Math.abs(ent.vx) > Math.abs(ent.vy) ? 'walk_side' : (ent.vy < 0 ? 'walk_up' : 'walk_down');
        ent.flipX = ent.vx < 0 ? -1 : 1;
      }
    } else {
      ent.vx *= 0.9;
      ent.vy *= 0.9;
      if (ent.puppetState) ent.puppetState.anim = 'idle';
    }

    try { W.moveWithCollisions?.(ent, dt); } catch (_) { ent.x += ent.vx * dt; ent.y += ent.vy * dt; }

    if (hero && !hero.dead && !(hero.invincible)) {
      const hx = hero.x + (hero.w || TILE) * 0.5;
      const hy = hero.y + (hero.h || TILE) * 0.5;
      if (Math.hypot(center.x - hx, center.y - hy) < TILE * 0.7) {
        hero.vx = (hero.vx || 0) + ((hero.x < ent.x) ? -ent.attackPush : ent.attackPush) * 0.01;
        hero.vy = (hero.vy || 0) + ((hero.y < ent.y) ? -ent.attackPush : ent.attackPush) * 0.01;
        try { W.Narrator?.showHint?.('¡Las limpiadoras agresivas te empujan hacia los charcos!'); } catch (_) {}
      }
    }

    const entities = G.entities || [];
    for (const other of entities) {
      if (!other || other === ent || other.dead) continue;
      if (!SMALL_ENEMY_KINDS.has(other.kind)) continue;
      const oc = centerOf(other);
      if (Math.hypot(center.x - oc.x, center.y - oc.y) < TILE * 0.6) {
        other.dead = true;
        other.remove = true;
        if (typeof other.onKilled === 'function') {
          try { other.onKilled({ killer: 'cleaner_agresiva' }); } catch (_) {}
        }
      }
    }
  }

  function spawnAggressivePack(boss) {
    const tx = Math.round((boss?.x || 0) / TILE);
    const ty = Math.round((boss?.y || 0) / TILE);
    const offsets = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 },
    ];
    let spawned = 0;
    for (const off of offsets) {
      if (spawned >= 3) break;
      const nx = tx + off.x;
      const ny = ty + off.y;
      if (nx < 0 || ny < 0 || nx >= (G.mapW || 0) || ny >= (G.mapH || 0)) continue;
      if (isWallTile(nx, ny)) continue;
      applyCleanerPuddle(nx, ny);
      const worldX = nx * TILE + TILE * 0.05;
      const worldY = ny * TILE + TILE * 0.05;
      createCleanerAgresiva({ x: worldX, y: worldY }, { variantIndex: spawned });
      spawned++;
    }
  }

  function createJefa(pos, opts = {}) {
    ensureCollections();
    const p = pos || {};
    const x = (typeof p.x === 'number') ? p.x : (Array.isArray(p) ? p[0] : p);
    const y = (typeof p.y === 'number') ? p.y : (Array.isArray(p) ? p[1] : 0);
    const base = (typeof Entities.createBaseHuman === 'function')
      ? Entities.createBaseHuman(pos, opts)
      : { x: x || 0, y: y || 0, w: TILE * 0.95, h: TILE * 0.95, solid: true, static: true, puppetState: { anim: 'unconscious' } };

    const ent = Object.assign(base, {
      id: opts.id || `JEFA_${Math.random().toString(36).slice(2, 8)}`,
      kind: ENT.BOSS,
      kindName: 'jefa_limpiadoras_lvl2',
      role: 'cleaner_boss_unconscious',
      isJefaLimpiadoras: true,
      isBossLevel2: true,
      hp: 100,
      immobile: true,
      canBePushed: false,
      cured: false,
      dead: false,
      targetPillId: opts?.targetPillId || null,
      bossTimerActive: false,
      bossTimeLeft: 0,
      bossTimeMax: 0,
      urgencyCartRequired: true,
      urgencyCartArrived: false,
      ai: { state: 'unconscious', callPulse: 0 },
      opts,
      update(dt) { updateJefa(this, dt || 0); }
    });

    ent.group = 'human';
    try { W.EntityGroups?.assign?.(ent); } catch (_) {}
    try { W.EntityGroups?.register?.(ent, G); } catch (_) {}
    if (!G.entities.includes(ent)) G.entities.push(ent);
    if (!G.patients.includes(ent)) G.patients.push(ent);
    G.boss = ent;
    attachBossRig(ent);

    // Puddles + agresivas
    applyCleanerPuddle(Math.round(ent.x / TILE), Math.round(ent.y / TILE));
    spawnAggressivePack(ent);
    return ent;
  }

  Entities.define('jefa_limpiadoras_lvl2', createJefa);
  Entities.define('cleaner_agresiva', createCleanerAgresiva);

  W.CleanerBossAPI = {
    spawn: createJefa,
    tryTreat: tryTreatCleanerBoss
  };
})(typeof window !== 'undefined' ? window : globalThis);
