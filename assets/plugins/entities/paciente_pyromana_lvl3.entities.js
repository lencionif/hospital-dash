// filename: paciente_pyromana_lvl3.entities.js
// Entidad jefe "Paciente psiquiátrica piromana" nivel 3 con IA avanzada y rig 1 tile.
(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const ENT = W.ENT || (W.ENT = {});
  const Entities = W.Entities || (W.Entities = {});
  const TILE = W.TILE_SIZE || W.TILE || 32;

  // Registro helper retrocompatible
  if (typeof Entities.define !== 'function') {
    Entities.define = function define(name, factory) {
      this[name] = factory;
      return factory;
    };
  }

  ENT.PYRO_PATIENT_LVL3 = ENT.PYRO_PATIENT_LVL3 ?? 0xf103;

  function toPx(val) {
    return (typeof val === 'number') ? val * TILE : 0;
  }

  function clamp(v, a, b) {
    return v < a ? a : (v > b ? b : v);
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function getHero() {
    const hero = G.player;
    return hero && !hero.dead ? hero : null;
  }

  function distanceBetween(a, b) {
    if (!a || !b) return Infinity;
    const ax = a.x + (a.w || 0) * 0.5;
    const ay = a.y + (a.h || 0) * 0.5;
    const bx = b.x + (b.w || 0) * 0.5;
    const by = b.y + (b.h || 0) * 0.5;
    return Math.hypot(ax - bx, ay - by);
  }

  function hasLineOfSight(a, b) {
    const Level = W.Level;
    if (!Level || !Level.hasLineOfSight) return true;
    return Level.hasLineOfSight(a, b);
  }

  function isPyroL3Walkable(tx, ty) {
    if (W.FireAPI?.isFireAt?.(tx, ty)) return false;
    if (W.Level?.isWalkable) return !!W.Level.isWalkable(tx, ty);
    return true;
  }

  function ensureArrays() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.movers)) G.movers = [];
    if (!Array.isArray(G.hostiles)) G.hostiles = [];
    if (!Array.isArray(G.patients)) G.patients = [];
  }

  function activateBossTimer(ent) {
    if (!ent || ent.cured || ent.dead || ent.bossTimerActive) return;
    ent.bossTimerActive = true;
    ent.ai.state = 'patrol';
    try { W.Narrator?.showObjective?.('¡La paciente piromana de nivel 3 está fuera de control! Cúrala antes de que sea tarde.'); } catch (_) {}
    try { W.HUD?.showPyroL3Timer?.(); } catch (_) {}
  }

  function onAllNormalPatientsResolved() {
    const pyro = (W.Entities?.findByKind?.('paciente_pyromana_lvl3') || G.entities?.find((e) => e.kind === 'paciente_pyromana_lvl3'));
    if (!pyro || pyro.cured || pyro.dead) return;
    activateBossTimer(pyro);
  }

  function handleBossTimer(ent, dt) {
    if (!ent.bossTimerActive || ent.cured || ent.dead) return;
    ent.bossTimeLeft = Math.max(0, ent.bossTimeLeft - dt);
    try { W.HUD?.updatePyroL3Timer?.(ent.bossTimeLeft, ent.bossTimeMax); } catch (_) {}

    const ratio = ent.bossTimeMax > 0 ? ent.bossTimeLeft / ent.bossTimeMax : 0;
    if (ratio < ent.ai.rageThreshold && ent.ai.state !== 'rage') {
      ent.ai.state = 'rage';
      try { W.Narrator?.showHint?.('¡La piromana está en modo furia! Generará más fuego.'); } catch (_) {}
    }

    if (ent.bossTimeLeft <= 0) {
      ent.dead = true;
      ent.ai.state = 'dead';
      try { W.Level?.endWithFailure?.('pyro_lvl3_timeout'); } catch (_) {}
    }
  }

  function pyroL3Patrol(ent, dt, opts = {}) {
    const speed = (ent.moveSpeed || 1.6) * (opts.speedMul || 1);
    const roam = ent._roamDir || { x: 0, y: 1 };
    if (!ent._roamTimer || ent._roamTimer <= 0) {
      const dirs = shuffle([
        { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }
      ]);
      ent._roamDir = dirs.find((d) => {
        const nx = Math.floor((ent.x + ent.w * 0.5) / TILE) + d.x;
        const ny = Math.floor((ent.y + ent.h * 0.5) / TILE) + d.y;
        return isPyroL3Walkable(nx, ny);
      }) || { x: 0, y: 0 };
      ent._roamTimer = rand(0.6, 1.4);
    }
    ent._roamTimer -= dt;
    ent.vx = ent._roamDir.x * speed * TILE;
    ent.vy = ent._roamDir.y * speed * TILE;
    ent.ai.dir = Math.abs(ent.vx) > Math.abs(ent.vy) ? (ent.vx > 0 ? 'right' : 'left') : (ent.vy > 0 ? 'down' : 'up');
  }

  function pyroL3Chase(ent, target, dt, opts = {}) {
    const speed = (ent.moveSpeed || 2.0) * (opts.speedMul || 1);
    const tx = target.x + target.w * 0.5;
    const ty = target.y + target.h * 0.5;
    const cx = ent.x + ent.w * 0.5;
    const cy = ent.y + ent.h * 0.5;
    const dx = tx - cx;
    const dy = ty - cy;
    const len = Math.hypot(dx, dy) || 1;
    const dirx = dx / len;
    const diry = dy / len;

    // Evita fuego buscando desvío simple
    const nextTx = Math.floor((cx + dirx * TILE * 0.8) / TILE);
    const nextTy = Math.floor((cy + diry * TILE * 0.8) / TILE);
    if (!isPyroL3Walkable(nextTx, nextTy)) {
      ent.vx = ent.vy = 0;
      return pyroL3Patrol(ent, dt, opts);
    }

    ent.vx = dirx * speed * TILE;
    ent.vy = diry * speed * TILE;
    ent.ai.dir = Math.abs(ent.vx) > Math.abs(ent.vy) ? (ent.vx > 0 ? 'right' : 'left') : (ent.vy > 0 ? 'down' : 'up');
  }

  function schedulePyroL3Fire(ent) {
    const factor = (ent.ai.state === 'rage') ? 1.5 : 1.0;
    ent.fireCooldown = rand(ent.fireCooldownMin, ent.fireCooldownMax) / factor;

    const tiles = (W.Grid?.getTilesInRadius?.(ent.x, ent.y, ent.fireRadius) || []);
    shuffle(tiles);

    const maxFires = (ent.ai.state === 'rage') ? 5 : 3;
    let created = 0;
    for (const t of tiles) {
      if (created >= maxFires) break;
      if (!W.Level?.isInsideBounds?.(t.x, t.y)) continue;
      if (!W.Level?.isWalkable?.(t.x, t.y)) continue;
      if (W.FireAPI?.isFireAt?.(t.x, t.y)) continue;
      W.FireAPI?.spawnFire?.(t.x, t.y, {
        source: ent.id,
        lifetime: rand(10, 20),
        damage: 1.0
      });
      created++;
    }

    ent.fireCastAnimTime = 0.8;
    try { console.debug('[PYRO_L3_FIRE_CAST]', { id: ent.id, created, rage: ent.ai.state === 'rage' }); } catch (_) {}
  }

  function onPyroL3TouchHero(pyro, hero) {
    if (!pyro || pyro.cured || pyro.dead || !hero) return;
    if (!window.Damage?.applyToHero?.(pyro.damageOnTouch, 'pyro_lvl3_touch', { attacker: pyro, source: 'pyro_lvl3_touch', knockbackFrom: pyro })) {
      if (typeof hero.takeDamage === 'function') {
        hero.takeDamage(pyro.damageOnTouch, { source: 'pyro_lvl3_touch', attacker: pyro, knockbackFrom: pyro });
      } else {
        try { hero.applyDamage?.(pyro.damageOnTouch, 'pyro_lvl3_touch'); } catch (_) { hero.hp = Math.max(0, (hero.hp || 0) - pyro.damageOnTouch); }
      }
    }
    try { hero.applyStun?.(pyro.stunSecondsOnTouch); } catch (_) { hero.stunTimer = Math.max(hero.stunTimer || 0, pyro.stunSecondsOnTouch || 0); }
    try { console.debug('[PYRO_L3_HIT_HERO]', { pyroId: pyro.id, heroId: hero.id }); } catch (_) {}
  }

  function tryCurePyroL3(hero, pyro) {
    if (!pyro?.isPyroBoss || pyro.cured || pyro.dead) return false;
    const pill = hero?.currentPill;
    if (!pill || (pill.targetPatientId && pill.targetPatientId !== pyro.id && pill.patientId !== pyro.id)) return false;

    pyro.cured = true;
    pyro.bossTimerActive = false;
    pyro.ai.state = 'cured';
    pyro.vx = pyro.vy = 0;
    if (hero) hero.currentPill = null;
    try { W.HUD?.hidePyroL3Timer?.(); } catch (_) {}
    try { W.Narrator?.showObjective?.('¡Has estabilizado a la paciente piromana de nivel 3! Trae el carro de urgencias hasta ella.'); } catch (_) {}
    try { console.debug('[PYRO_L3_CURED]', { id: pyro.id }); } catch (_) {}
    return true;
  }

  function onUrgencyCartTouchPyroL3(cart, pyro) {
    if (!pyro?.isPyroBoss || pyro.dead) return;
    if (pyro.cured) {
      pyro.urgencyCartArrived = true;
      try { W.Level?.endWithVictory?.('pyro_lvl3_boss_saved'); } catch (_) {}
      try { W.Narrator?.showObjective?.('¡Nivel 3 superado! Has salvado a la paciente psiquiátrica y contenido el incendio.'); } catch (_) {}
    } else {
      try { W.Narrator?.showHint?.('Primero necesitas su píldora correcta para calmarla.'); } catch (_) {}
    }
  }

  function updatePyroL3AI(ent, dt) {
    const hero = getHero();
    const ai = ent.ai;
    if (ent.cured || ent.dead) {
      ai.state = ent.cured ? 'cured' : 'dead';
      ent.vx = ent.vy = 0;
      return;
    }

    const dist = distanceBetween(ent, hero);
    const seesHero = hero ? (dist < ai.visionRadius * TILE && hasLineOfSight(ent, hero)) : false;

    ent.fireCooldown -= dt;
    if (ent.fireCooldown <= 0) {
      ai.state = (ai.state === 'rage') ? 'rage' : 'casting_fire';
      schedulePyroL3Fire(ent);
    }

    if (ai.state === 'casting_fire') {
      ent.vx = ent.vy = 0;
      ent.fireCastAnimTime = Math.max(0, (ent.fireCastAnimTime || 0) - dt);
      if (ent.fireCastAnimTime <= 0) {
        ai.state = seesHero ? 'chase' : 'patrol';
      }
      return;
    }

    if (ai.state === 'rage') {
      if (seesHero) {
        pyroL3Chase(ent, hero, dt, { speedMul: 1.3 });
      } else {
        pyroL3Patrol(ent, dt, { speedMul: 1.1 });
      }
      return;
    }

    if (seesHero) {
      ai.state = 'chase';
      pyroL3Chase(ent, hero, dt, { speedMul: 1.1 });
    } else {
      if (ai.state === 'chase') ai.state = 'patrol';
      pyroL3Patrol(ent, dt, { speedMul: 1.0 });
    }
  }

  function updatePyroL3Anim(ent) {
    const ps = ent.puppetState || (ent.puppetState = { anim: 'idle' });
    const ai = ent.ai || {};
    if (ent.dead) { ps.anim = 'die_hit'; return; }
    if (ent.cured) { ps.anim = 'cured'; return; }
    const speed = Math.hypot(ent.vx || 0, ent.vy || 0);
    if (ai.state === 'casting_fire') {
      ps.anim = 'cast_fire';
    } else if (ai.state === 'rage') {
      if (speed > 0.01) {
        ps.anim = (Math.abs(ent.vx) > Math.abs(ent.vy)) ? 'walk_side' : (ent.vy < 0 ? 'walk_up' : 'walk_down');
      } else {
        ps.anim = 'rage';
      }
    } else if (speed > 0.01) {
      ps.anim = (Math.abs(ent.vx) > Math.abs(ent.vy)) ? 'walk_side' : (ent.vy < 0 ? 'walk_up' : 'walk_down');
    } else {
      ps.anim = 'idle';
    }
  }

  function updatePyroL3(ent, dt) {
    if (!ent._timerInit) {
      const rules = W.LevelRules?.current;
      ent.bossTimeMax = rules?.pyroPatientLvl3TimerSeconds || 75;
      ent.bossTimeLeft = ent.bossTimeMax;
      ent._timerInit = true;
    }

    // Activación automática cuando no quedan pacientes normales
    if (!ent.bossTimerActive && !ent.cured && !ent.dead) {
      const stats = G.stats || {};
      const remaining = (stats.remainingPatients || 0) + (stats.activeFuriosas || 0);
      if (remaining <= 0) onAllNormalPatientsResolved();
    }

    handleBossTimer(ent, dt);
    updatePyroL3AI(ent, dt);
    updatePyroL3Anim(ent);
  }

  function setupPyroL3Environment(pyro) {
    const neighbors = W.Grid?.getNeighborTiles?.(pyro.x, pyro.y) || [];
    const guardTiles = [];
    neighbors.forEach((tile) => {
      if (!W.Level?.isWalkable?.(tile.x, tile.y)) return;
      W.FireAPI?.spawnFire?.(tile.x, tile.y, {
        source: pyro.id,
        lifetime: rand(15, 30),
        damage: 1.0
      });
      if (guardTiles.length < 3) guardTiles.push(tile);
    });

    guardTiles.slice(0, 3).forEach((tile, idx) => {
      const guard = (W.Entities?.Guards?.spawnAggressive?.(tile.x, tile.y) || W.Entities?.spawnGuardia?.(tile.x, tile.y) || W.Entities?.Guardi)?.spawn?.({ tx: tile.x, ty: tile.y, variantIndex: idx }) || null;
      if (guard) {
        guard.variantIndex = idx;
        try { W.Puppet?.bind?.(guard, 'guardia_agresivo_lvl3'); } catch (_) {}
      }
    });
  }

  function createPyroL3(pos, opts = {}) {
    ensureArrays();
    const base = (typeof Entities.createBaseHuman === 'function')
      ? Entities.createBaseHuman(pos, opts)
      : { x: toPx(pos?.x || pos?.[0] || 0), y: toPx(pos?.y || pos?.[1] || 0), w: TILE * 0.95, h: TILE * 0.95, puppetState: { anim: 'idle' } };

    const ent = Object.assign(base, {
      id: opts.id || `PYROL3_${Math.random().toString(36).slice(2, 8)}`,
      kind: 'paciente_pyromana_lvl3',
      role: 'psycho_pyro_patient_lvl3',
      isPyroBoss: true,
      level: 3,
      hp: 120,
      damageOnTouch: 1.5,
      stunSecondsOnTouch: 1.2,
      cured: false,
      dead: false,
      targetPillId: opts?.targetPillId || null,
      bossTimerActive: false,
      bossTimeLeft: 0,
      bossTimeMax: 0,
      urgencyCartRequired: true,
      urgencyCartArrived: false,
      fireCooldown: 0,
      fireCooldownMin: 2.0,
      fireCooldownMax: 4.0,
      fireRadius: 4,
      moveSpeed: 2.1,
      ai: {
        state: 'idle',
        dir: 'down',
        visionRadius: 7,
        path: null,
        pathIndex: 0,
        rageThreshold: 0.4
      },
      update(dt) { updatePyroL3(this, dt || 0); }
    });

    ent.group = 'human';
    try { W.EntityGroups?.assign?.(ent); } catch (_) {}
    try { W.EntityGroups?.register?.(ent, G); } catch (_) {}
    if (!G.entities.includes(ent)) G.entities.push(ent);
    if (!G.movers.includes(ent)) G.movers.push(ent);
    if (!G.hostiles.includes(ent)) G.hostiles.push(ent);
    if (!G.patients.includes(ent)) G.patients.push(ent);

    try { W.Puppet?.bind?.(ent, 'boss_pyro'); } catch (_) { try { W.PuppetAPI?.attach?.(ent, { rig: 'boss_pyro' }); } catch (_) {} }

    setupPyroL3Environment(ent);

    return ent;
  }

  Entities.define('paciente_pyromana_lvl3', createPyroL3);
  Entities.PyroPatientLvl3 = {
    spawn(x, y, opts = {}) { return createPyroL3({ x, y }, opts); },
    onAllNormalPatientsResolved,
    onPyroL3TouchHero,
    tryCurePyroL3,
    onUrgencyCartTouchPyroL3
  };

  // Hooks públicos simples
  W.PyroPatientLvl3API = {
    activateTimer: activateBossTimer,
    onAllNormalPatientsResolved,
    tryCure: tryCurePyroL3,
    onCartTouch: onUrgencyCartTouchPyroL3
  };
})(typeof window !== 'undefined' ? window : globalThis);
