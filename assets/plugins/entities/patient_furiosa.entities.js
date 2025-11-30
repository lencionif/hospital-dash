// filename: patient_furiosa.entities.js
// Nueva entidad "Paciente Enfurecida" con IA inteligente + rig canvas.
(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const ENT = W.ENT || (W.ENT = {});
  ENT.FURIOUS = (typeof ENT.FURIOUS !== 'undefined') ? ENT.FURIOUS : 0xf001;

  const TILE = (typeof W.TILE_SIZE === 'number') ? W.TILE_SIZE : (typeof W.TILE === 'number' ? W.TILE : 32);
  const DETECT_RADIUS = 6 * TILE;
  const LOSE_INTEREST_RADIUS = 10 * TILE;

  function debugEnabled() {
    return !!(W.DEBUG_PATIENT_FURIOSA || W.DEBUG_FORCE_ASCII);
  }

  function logDebug(tag, payload) {
    if (!debugEnabled()) return;
    try { console.debug(`[PATIENT_FURIOSA_${tag}]`, payload); } catch (_) {}
  }

  function clamp(v, a, b) {
    return v < a ? a : (v > b ? b : v);
  }

  function distanceBetween(a, b) {
    if (!a || !b) return Infinity;
    const ax = (a.x || 0) + (a.w || 0) * 0.5;
    const ay = (a.y || 0) + (a.h || 0) * 0.5;
    const bx = (b.x || 0) + (b.w || 0) * 0.5;
    const by = (b.y || 0) + (b.h || 0) * 0.5;
    return Math.hypot(ax - bx, ay - by);
  }

  function checkEntitiesTouch(a, b) {
    if (!a || !b) return false;
    return !(
      a.x + a.w <= b.x ||
      a.x >= b.x + b.w ||
      a.y + a.h <= b.y ||
      a.y >= b.y + b.h
    );
  }

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.hostiles)) G.hostiles = [];
    if (!Array.isArray(G.movers)) G.movers = [];
    if (!G.stats) G.stats = {};
    try { W.EntityGroups?.ensure?.(G); } catch (_) {}
  }

  function attachRig(ent) {
    try {
      const puppet = W.Puppet?.bind?.(ent, 'patient_furious', { z: 0, scale: 1, data: { skin: ent.skin } })
        || W.PuppetAPI?.attach?.(ent, { rig: 'patient_furious', z: 0, scale: 1, data: { skin: ent.skin } });
      if (puppet) {
        ent.puppet = puppet;
        ent.puppetState = puppet.state || ent.puppetState || { anim: 'idle' };
      } else {
        ent.puppetState = ent.puppetState || { anim: 'idle' };
      }
    } catch (_) {
      ent.puppetState = ent.puppetState || { anim: 'idle' };
    }
  }

  function addEntity(ent) {
    ensureCollections();
    if (!ent) return ent;
    if (!G.entities.includes(ent)) G.entities.push(ent);
    if (!G.hostiles.includes(ent)) G.hostiles.push(ent);
    if (!G.movers.includes(ent)) G.movers.push(ent);
    ent.group = 'human';
    ent._alwaysUpdate = true;
    try { W.EntityGroups?.assign?.(ent); } catch (_) {}
    try { W.EntityGroups?.register?.(ent, G); } catch (_) {}
    try { W.MovementSystem?.register?.(ent); } catch (_) {}
    attachRig(ent);
    return ent;
  }

  function detachRig(ent) {
    if (!ent) return;
    try {
      if (typeof W.detachEntityRig === 'function') {
        W.detachEntityRig(ent);
      } else {
        W.PuppetAPI?.detach?.(ent);
      }
    } catch (_) {}
  }

  function removeEntity(ent) {
    if (!ent) return;
    ent.dead = true;
    detachRig(ent);
    try { W.MovementSystem?.unregister?.(ent); } catch (_) {}
    if (Array.isArray(G.entities)) G.entities = G.entities.filter((it) => it !== ent);
    if (Array.isArray(G.hostiles)) G.hostiles = G.hostiles.filter((it) => it !== ent);
    if (Array.isArray(G.movers)) G.movers = G.movers.filter((it) => it !== ent);
    if (Array.isArray(G.patients)) G.patients = G.patients.filter((it) => it !== ent);
    if (Array.isArray(G.allPatients)) G.allPatients = G.allPatients.filter((it) => it !== ent);
    if (G._patientsByKey instanceof Map && ent.keyName) {
      const current = G._patientsByKey.get(ent.keyName);
      if (current === ent) G._patientsByKey.delete(ent.keyName);
    }
    try { W.EntityGroups?.unregister?.(ent, G); } catch (_) {}
  }

  function scheduleEntityFadeOut(ent, seconds) {
    if (!ent) return;
    const ms = Math.max(0, (seconds || 0.8) * 1000);
    setTimeout(() => removeEntity(ent), ms);
  }

  function resolveHeroCarry(hero) {
    const player = hero || G.player || null;
    if (player?.currentPill) return player.currentPill;
    if (player?.carry) return player.carry;
    if (player?.inventory?.medicine) return player.inventory.medicine;
    if (G.currentPill) return G.currentPill;
    if (G.carry) return G.carry;
    return null;
  }

  function clearHeroCarry(hero) {
    const player = hero || G.player || null;
    if (player) {
      player.carry = null;
      player.currentPill = null;
      if (player.inventory) player.inventory.medicine = null;
    }
    G.carry = null;
    G.currentPill = null;
    try { W.ObjectiveSystem?.onCarryCleared?.({ reason: 'delivery' }); } catch (_) {}
  }

  function ensurePillMatch(ent, carry) {
    if (!ent || !carry) return false;
    const targetId = ent.originalPatientId || ent.targetPatientId || ent.id;
    if (carry.targetPatientId && carry.targetPatientId === targetId) return true;
    if (carry.patientId && carry.patientId === targetId) return true;
    if (carry.forPatientId && carry.forPatientId === targetId) return true;
    if (carry.pairName && ent.keyName && carry.pairName === ent.keyName) return true;
    return false;
  }

  function heroAPI() {
    return W.Entities?.Hero || null;
  }

  function applyDamageToHero(hero, amount, meta) {
    if (window.Damage?.applyToHero) {
      window.Damage.applyToHero(amount, meta?.source || 'patient_furiosa', Object.assign({
        attacker: meta?.attacker || null,
        source: meta?.source || 'patient_furiosa'
      }, meta || {}));
      return;
    }
    const api = heroAPI();
    if (api && typeof api.applyDamage === 'function') {
      api.applyDamage(hero, amount, meta);
    } else if (typeof hero?.takeDamage === 'function') {
      hero.takeDamage(amount, meta);
    } else if (hero) {
      hero.hp = Math.max(0, (hero.hp || 0) - amount);
    }
  }

  function applyStunToHero(hero, duration, meta) {
    const api = heroAPI();
    if (api && typeof api.applyStun === 'function') {
      api.applyStun(hero, duration, meta);
    } else if (hero) {
      hero.stunTimer = Math.max(hero.stunTimer || 0, duration || 0);
    }
  }

  function updatePatientCountersOnCure(ent) {
    const patients = W.PatientsAPI || null;
    const stats = patients?.ensureStats?.() || (G.stats || (G.stats = {}));
    stats.attended = (stats.attended || 0) + 1;
    G.patientsCured = (G.patientsCured | 0) + 1;
    patients?.syncCounters?.();
    try { W.ScoreAPI?.addScore?.(100, 'deliver_patient', { patient: ent.displayName || ent.name }); } catch (_) {}
    try { W.ObjectiveSystem?.onPatientDelivered?.(ent.originalPatient || ent); } catch (_) {}
    try { W.GameFlowAPI?.notifyPatientCountersChanged?.(); } catch (_) {}
  }

  function createAIState() {
    return {
      state: 'idle',
      repathTimer: 0,
      attackCooldown: 0,
      rageLevel: 1,
      path: null,
      pathIndex: 0,
      wanderTimer: 0,
      wanderDir: { x: 0, y: 0 },
      pathGoal: null
    };
  }

  function spawn(x, y, opts = {}) {
    const ent = {
      id: opts.id || `FUR_${Math.random().toString(36).slice(2, 9)}`,
      kind: ENT.FURIOUS,
      kindName: 'patient_furiosa',
      role: 'patient',
      isHostile: true,
      hostile: true,
      x: Number(x) || 0,
      y: Number(y) || 0,
      w: opts.w || opts.width || Math.round(TILE * 0.9),
      h: opts.h || opts.height || Math.round(TILE * 0.95),
      vx: 0,
      vy: 0,
      solid: true,
      dynamic: true,
      pushable: true,
      mass: opts.mass || 130,
      mu: 0.08,
      hp: opts.hp || 60,
      hpMax: opts.hp || 60,
      moveSpeed: (opts.moveSpeed || 1.4) * TILE,
      maxSpeed: (opts.moveSpeed || 1.4) * TILE,
      attackDamage: opts.attackDamage || 1,
      stunTime: opts.stunTime || 1.2,
      currentPillId: opts.pillId || null,
      targetPatientId: opts.targetPatientId || null,
      keyName: opts.keyName || null,
      displayName: opts.displayName || opts.name || 'Paciente enfurecida',
      name: opts.displayName || opts.name || 'Paciente enfurecida',
      nameTagYOffset: opts.nameTagYOffset ?? 18,
      showNameTag: true,
      ai: createAIState(),
      disableAutoDamage: true,
      puppetState: { anim: 'idle' },
      originalPatientId: opts.targetPatientId || null,
      originalPatient: opts.originalPatient || null,
      skin: opts.skin || 'paciente_furiosa.png'
    };
    ent.aiId = 'PATIENT_FURIOSA';
    try { W.AI?.attach?.(ent, 'PATIENT_FURIOSA'); } catch (_) {}
    ent.onKilled = (meta) => killPatientFuriosa(ent, meta?.cause || meta?.source || 'generic');
    ent.applyDamage = (amount, meta) => {
      const dmg = Math.max(0, Number(amount) || 0);
      if (!(dmg > 0) || ent.dead) return;
      ent.hp = clamp(ent.hp - dmg, 0, ent.hpMax);
      if (ent.hp <= 0) {
        killPatientFuriosa(ent, meta?.cause || meta?.source || 'hit');
      }
    };
    ent.puppetState = ent.puppetState || { anim: 'idle' };
    addEntity(ent);
    return ent;
  }

  function spawnAtTiles(tx, ty, opts = {}) {
    const px = tx * TILE;
    const py = ty * TILE;
    return spawn(px, py, opts);
  }

  function spawnFromPatient(patient, opts = {}) {
    if (!patient) return null;
    const ent = spawn(patient.x, patient.y, {
      w: patient.w,
      h: patient.h,
      targetPatientId: patient.id,
      pillId: patient.pillId || null,
      keyName: patient.keyName,
      displayName: patient.displayName || patient.name,
      nameTagYOffset: patient.nameTagYOffset,
      originalPatient: {
        id: patient.id,
        displayName: patient.displayName,
        name: patient.name,
        keyName: patient.keyName,
        anagram: patient.anagram
      }
    });
    ent.originalPatientId = patient.id;
    ent.identityIndex = patient.identityIndex;
    if (patient.keyName && G._patientsByKey instanceof Map) {
      G._patientsByKey.set(patient.keyName, ent);
    }
    return ent;
  }

  function toTileCoord(value) {
    return Math.max(0, Math.floor(value / TILE));
  }

  function findPath(start, goal) {
    const map = G.map;
    if (!Array.isArray(map) || !map.length) return null;
    const height = map.length;
    const width = map[0]?.length || 0;
    const sx = clamp(start.tx, 0, width - 1);
    const sy = clamp(start.ty, 0, height - 1);
    const gx = clamp(goal.tx, 0, width - 1);
    const gy = clamp(goal.ty, 0, height - 1);
    if (sx === gx && sy === gy) return [{ tx: sx, ty: sy }];
    const queue = [];
    const visited = new Set();
    const parents = new Map();
    const key = (x, y) => `${x}|${y}`;
    queue.push({ tx: sx, ty: sy });
    visited.add(key(sx, sy));
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1]
    ];
    while (queue.length) {
      const current = queue.shift();
      if (current.tx === gx && current.ty === gy) {
        const path = [current];
        let ck = key(current.tx, current.ty);
        while (parents.has(ck)) {
          const prev = parents.get(ck);
          path.push(prev);
          ck = key(prev.tx, prev.ty);
        }
        path.reverse();
        return path;
      }
      for (const [dx, dy] of dirs) {
        const nx = current.tx + dx;
        const ny = current.ty + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (map[ny]?.[nx] === 1) continue;
        const nk = key(nx, ny);
        if (visited.has(nk)) continue;
        visited.add(nk);
        parents.set(nk, current);
        queue.push({ tx: nx, ty: ny });
      }
    }
    return null;
  }

  function ensurePath(ent, hero) {
    const ai = ent.ai || (ent.ai = createAIState());
    const heroTile = { tx: toTileCoord(hero.x + hero.w * 0.5), ty: toTileCoord(hero.y + hero.h * 0.5) };
    const needRepath = !ai.path || ai.repathTimer <= 0 || !ai.pathGoal
      || ai.pathGoal.tx !== heroTile.tx || ai.pathGoal.ty !== heroTile.ty;
    if (!needRepath) return;
    const start = { tx: toTileCoord(ent.x + ent.w * 0.5), ty: toTileCoord(ent.y + ent.h * 0.5) };
    const newPath = findPath(start, heroTile);
    if (newPath && newPath.length) {
      ai.path = newPath;
      ai.pathIndex = Math.min(ai.pathIndex || 0, newPath.length - 1);
      ai.pathGoal = heroTile;
      logDebug('PATH', { id: ent.id, pathLen: newPath.length });
    } else {
      ai.path = null;
      ai.pathGoal = null;
    }
    ai.repathTimer = 0.7;
  }

  function followPath(ent) {
    const ai = ent.ai;
    if (!ai || !ai.path || !ai.path.length) {
      ent.vx = 0;
      ent.vy = 0;
      return;
    }
    ai.pathIndex = clamp(ai.pathIndex || 0, 0, ai.path.length - 1);
    const tile = ai.path[ai.pathIndex];
    if (!tile) {
      ent.vx = ent.vy = 0;
      return;
    }
    const targetX = tile.tx * TILE + TILE * 0.5;
    const targetY = tile.ty * TILE + TILE * 0.5;
    const cx = ent.x + ent.w * 0.5;
    const cy = ent.y + ent.h * 0.5;
    const dx = targetX - cx;
    const dy = targetY - cy;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < 4) {
      if (ai.pathIndex < ai.path.length - 1) {
        ai.pathIndex += 1;
        return followPath(ent);
      }
      ent.vx = ent.vy = 0;
      return;
    }
    const speed = (ent.moveSpeed || 120) * (ai.rageLevel || 1);
    ent.vx = (dx / dist) * speed;
    ent.vy = (dy / dist) * speed;
  }

  function setFuriosaWalkAnim(ent) {
    const puppet = ent.puppetState || (ent.puppetState = { anim: 'idle' });
    const absVx = Math.abs(ent.vx || 0);
    const absVy = Math.abs(ent.vy || 0);
    if (absVx > absVy) {
      puppet.anim = 'walk_side';
    } else if (ent.vy < 0) {
      puppet.anim = 'walk_up';
    } else {
      puppet.anim = 'walk_down';
    }
  }

  function updateFuriosaWander(ent, dt) {
    const ai = ent.ai || (ent.ai = createAIState());
    ai.wanderTimer -= dt;
    if (ai.wanderTimer <= 0) {
      ai.wanderTimer = 1.2 + Math.random() * 1.4;
      const angle = Math.random() * Math.PI * 2;
      ai.wanderDir = { x: Math.cos(angle), y: Math.sin(angle) };
    }
    const wanderSpeed = (ent.moveSpeed || 110) * 0.45;
    ent.vx = ai.wanderDir.x * wanderSpeed;
    ent.vy = ai.wanderDir.y * wanderSpeed;
    setFuriosaWalkAnim(ent);
  }

  function tryFuriosaAttackOrCure(ent, hero) {
    if (!hero) return;
    const ai = ent.ai || (ent.ai = createAIState());
    const carry = resolveHeroCarry(hero);
    if (carry && ensurePillMatch(ent, carry)) {
      curePatientFuriosa(ent, hero);
      return;
    }
    if (ai.attackCooldown > 0) return;
    ai.attackCooldown = 1.0;
    const puppet = ent.puppetState || (ent.puppetState = { anim: 'attack' });
    puppet.anim = 'attack';
    applyDamageToHero(hero, ent.attackDamage || 1, { source: 'patient_furiosa', attacker: ent });
    applyStunToHero(hero, ent.stunTime || 1.2, { source: 'patient_furiosa' });
    logDebug('ATTACK', { id: ent.id, heroId: hero.id || null });
    logDebug('STUN', { heroId: hero.id || null, stun: ent.stunTime || 1.2 });
  }

  function curePatientFuriosa(ent, hero) {
    if (!ent || ent.isCured) return;
    ent.isCured = true;
    ent.ai.state = 'dead';
    ent.vx = ent.vy = 0;
    const puppet = ent.puppetState || (ent.puppetState = { anim: 'powerup' });
    puppet.anim = 'powerup';
    ent.currentPillId = null;
    clearHeroCarry(hero);
    ent.isHostile = false;
    ent.hostile = false;
    try { W.ArrowGuide?.clearTarget?.(); } catch (_) {}
    try { W.PatientsAPI?.onFuriosaNeutralized?.(ent); } catch (_) {}
    updatePatientCountersOnCure(ent);
    scheduleEntityFadeOut(ent, 1.2);
    logDebug('CURED', { id: ent.id, heroId: hero?.id || null });
  }

  function killPatientFuriosa(ent, cause) {
    if (!ent || ent.dead) return;
    ent.dead = true;
    ent.isHostile = false;
    ent.hostile = false;
    ent.vx = ent.vy = 0;
    const puppet = ent.puppetState || (ent.puppetState = { anim: 'die_hit' });
    if (cause && typeof cause === 'string') {
      if (cause.includes('fire')) puppet.anim = 'die_fire';
      else if (cause.includes('crush')) puppet.anim = 'die_crush';
      else puppet.anim = 'die_hit';
    } else {
      puppet.anim = 'die_hit';
    }
    try { W.PatientsAPI?.onFuriosaNeutralized?.(ent); } catch (_) {}
    scheduleEntityFadeOut(ent, 1.2);
    logDebug('DEAD', { id: ent.id, cause: cause || 'generic' });
  }

  function updatePatientFuriosa(ent, dt, state) {
    if (!ent || ent.dead) return;
    const ai = ent.ai || (ent.ai = createAIState());
    ai.repathTimer -= dt;
    ai.attackCooldown = Math.max(0, ai.attackCooldown - dt);
    const hero = (state && state.player) || G.player || null;
    if (ent.isCured) {
      ent.vx = ent.vy = 0;
      return;
    }
    if (!hero) {
      ai.state = 'idle';
      ent.vx = ent.vy = 0;
      ent.puppetState.anim = 'idle';
      return;
    }
    const dist = distanceBetween(ent, hero);
    const prevState = ai.state;
    if (dist <= DETECT_RADIUS) {
      ai.state = 'chase';
    } else if (ai.state === 'chase' && dist >= LOSE_INTEREST_RADIUS) {
      ai.state = 'wander';
    } else if (!ai.state) {
      ai.state = 'idle';
    }
    if (ai.state !== prevState) {
      logDebug('STATE', { id: ent.id, state: ai.state });
    }
    switch (ai.state) {
      case 'chase':
        ensurePath(ent, hero);
        followPath(ent);
        setFuriosaWalkAnim(ent);
        if (checkEntitiesTouch(ent, hero)) {
          tryFuriosaAttackOrCure(ent, hero);
        }
        break;
      case 'wander':
        ai.path = null;
        updateFuriosaWander(ent, dt);
        break;
      default:
        ent.vx = ent.vy = 0;
        ent.puppetState.anim = 'idle';
        break;
    }
  }

  const PatientFuriosaAPI = {
    spawn,
    spawnAtTiles,
    spawnFromPatient,
    update: updatePatientFuriosa,
    kill: killPatientFuriosa,
    cure: curePatientFuriosa,
    supportsPillCures: true
  };

  W.Entities = W.Entities || {};
  W.Entities.PatientFuriosa = PatientFuriosaAPI;
  W.PatientFuriosaAPI = PatientFuriosaAPI;

  if (W.AI && typeof W.AI.register === 'function') {
    W.AI.register('PATIENT_FURIOSA', (ent, world, dt) => updatePatientFuriosa(ent, dt || 0, world || G));
  }
})(typeof window !== 'undefined' ? window : this);
