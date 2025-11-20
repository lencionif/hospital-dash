// filename: tcae.entities.js
// NPC TCAE auxiliar con IA para carros, reparaciones y diálogos con acertijos.
(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const ENT = W.ENT || (W.ENT = {});
  const TILE = (typeof W.TILE_SIZE === 'number') ? W.TILE_SIZE : (typeof W.TILE === 'number' ? W.TILE : 32);

  ENT.CART = ENT.CART ?? 5;
  ENT.PATIENT = ENT.PATIENT ?? 21;
  ENT.PLAYER = ENT.PLAYER ?? 1;
  const KIND_STRING = 'npc_tcae';
  ENT.TCAE = ENT.TCAE ?? 120;

  const THINK_INTERVAL = 1.5;
  const REPAIR_TIME = 3.0;
  const CART_NEAR_RADIUS = 0.6;
  const PATIENT_NEAR_RADIUS = 0.8;
  const PUSH_FORCE = 0.9;
  const PATROL_RADIUS = TILE * 3;

  const RIDDLES = [
    {
      key: 'riddle_tcae_1',
      ask: '¿Qué debe comprobar una TCAE antes de acercar el carro de medicación a la cama?',
      options: ['Que el timbre funcione', 'Identificación del paciente y dosis correctas', 'Que el carro pese menos de 10 kg'],
      correctIndex: 1,
      hint: 'Seguridad del paciente ante todo.'
    },
    {
      key: 'riddle_tcae_2',
      ask: 'Cuando un carro chirría y el freno falla, ¿qué haces primero?',
      options: ['Seguir empujando con cuidado', 'Avisar y bloquearlo', 'Correr para buscar al jefe'],
      correctIndex: 1,
      hint: 'Nunca dejes un carro defectuoso en un pasillo.'
    },
    {
      key: 'riddle_tcae_3',
      ask: '¿Cuál es el orden correcto al repartir bandejas de comida?',
      options: ['Pacientes alfabéticamente', 'Dietas especiales primero y luego el resto', 'Según quien grite más fuerte'],
      correctIndex: 1,
      hint: 'Prioriza alergias y pautas médicas.'
    }
  ];

  const DEBUG_TCAE = () => Boolean(W.DEBUG_TCAE_AI || G.DEBUG_TCAE_AI || W.DEBUG_NPCS);
  const logDebug = (tag, payload) => { if (DEBUG_TCAE()) { try { console.debug(tag, payload); } catch (_) {} } };

  let UID = 1;

  function list() {
    const arr = (G.entities || []);
    return arr.filter((e) => isTcae(e) && !e.dead);
  }

  function isTcae(ent) {
    return ent && (ent.kind === KIND_STRING || ent.kind === ENT.TCAE || ent.kindId === ENT.TCAE);
  }

  function spawn(opts = {}) {
    const size = Math.round(TILE * 0.9);
    const tx = Number.isFinite(opts.tx) ? opts.tx : (G.spawn?.tx ?? 2);
    const ty = Number.isFinite(opts.ty) ? opts.ty : (G.spawn?.ty ?? 2);
    const pos = placeSafeNear(tx, ty, size, size);

    const ent = {
      id: opts.id || `npc_tcae_${UID++}`,
      kind: KIND_STRING,
      kindId: ENT.TCAE,
      role: 'auxiliar_enfermeria',
      name: 'TCAE',
      x: pos.x | 0,
      y: pos.y | 0,
      w: size,
      h: size,
      vx: 0,
      vy: 0,
      speed: 1.1,
      hp: 80,
      maxHp: 80,
      isNeutral: true,
      solid: true,
      pushable: false,
      dynamic: true,
      ai: createAiState(),
      anim: 'idle',
      npcAnim: 'idle',
      spriteKey: 'tcae',
      skin: 'TCAE.png'
    };

    if (!Array.isArray(G.entities)) G.entities = [];
    G.entities.push(ent);
    try { W.EntityGroups?.assign?.(ent); } catch (_) {}
    try { W.EntityGroups?.register?.(ent, G); } catch (_) {}
    try { W.AI?.attach?.(ent, 'TCAE'); } catch (_) {}
    try { W.MovementSystem?.register?.(ent); } catch (_) {}

    try {
      const puppet = W.Puppet?.bind?.(ent, 'npc_tcae', { z: 0, scale: 1, data: { skin: ent.skin } })
        || W.PuppetAPI?.attach?.(ent, { rig: 'npc_tcae', z: 0, scale: 1, data: { skin: ent.skin } });
      ent.puppet = puppet || ent.puppet;
      ent.puppetState = puppet?.state || ent.puppetState || { anim: 'idle' };
      ent.rigOk = !!puppet;
    } catch (_) { ent.rigOk = false; }

    return ent;
  }

  function createAiState() {
    return {
      state: 'patrol',
      dir: 'down',
      targetCartId: null,
      targetPatientId: null,
      repairTimer: 0,
      thinkTimer: THINK_INTERVAL,
      talkCooldown: 0,
      riddleIndex: 0,
      patrolTimer: 0,
      patrolTarget: null
    };
  }

  function update(dt = 1 / 60) {
    for (const ent of list()) updateOne(ent, dt);
  }

  function updateOne(ent, dt) {
    if (!ent) return;
    const ai = ent.ai || (ent.ai = createAiState());

    ai.talkCooldown = Math.max(0, ai.talkCooldown - dt);
    ai.repairTimer = Math.max(0, ai.repairTimer - dt);
    ai.thinkTimer -= dt;

    if (ent.dead) {
      ai.state = 'dead';
      const cause = (ent.deathCause || ent.lastDamageCause || ent.lastDamageKind || '').toLowerCase();
      const anim = cause.includes('fire') ? 'die_fire' : (cause.includes('crush') ? 'die_crush' : 'die_hit');
      updateRigAnim(ent, anim);
      ent.vx *= 0.6; ent.vy *= 0.6;
      moveWithCollisions(ent, dt);
      return;
    }

    if (ai.state === 'talk') {
      setTcaeTalkAnim(ent);
      ent.vx *= 0.2; ent.vy *= 0.2;
      moveWithCollisions(ent, dt);
      return;
    }

    const hero = G.player;
    if (hero && !hero.dead && ai.state !== 'dead' && ai.talkCooldown <= 0 && rectsOverlap(ent, hero)) {
      startTcaeRiddleDialog(ent, hero);
    }

    if (ai.thinkTimer <= 0 && ai.state !== 'dead') {
      ai.thinkTimer = THINK_INTERVAL;
      decideNextTask(ent, ai);
    }

    switch (ai.state) {
      case 'repair_cart':
        updateRepairCart(ent, ai, dt);
        break;
      case 'push_cart':
        updatePushCart(ent, ai, dt);
        break;
      case 'patrol':
      default:
        updatePatrol(ent, ai, dt);
        break;
    }

    applyFriction(ent, 0.85);
    moveWithCollisions(ent, dt);

    if (ai.state === 'repair_cart') {
      setTcaeExtraAnim(ent, ai);
    } else if (ai.state === 'push_cart' && ai.pushingCart) {
      setTcaePushAnim(ent, ai);
    } else if (Math.hypot(ent.vx, ent.vy) > 0.05) {
      setTcaeWalkAnim(ent, ai);
    } else {
      setTcaeIdleAnim(ent);
    }
  }

  function decideNextTask(ent, ai) {
    const brokenCart = findClosestCart(ent, { broken: true });
    if (brokenCart) {
      ai.state = 'repair_cart';
      ai.targetCartId = getEntityId(brokenCart);
      ai.targetPatientId = null;
      ai.repairTimer = REPAIR_TIME;
      logDebug('[TCAE_AI] repair start', { id: ent.id, cart: ai.targetCartId });
      return;
    }

    const foodCart = findClosestCart(ent, { type: 'food_cart' });
    if (foodCart) {
      ai.state = 'push_cart';
      ai.targetCartId = getEntityId(foodCart);
      const patient = findClosestPatientToCart(foodCart);
      ai.targetPatientId = patient ? getEntityId(patient) : null;
      ai.pushingCart = false;
      logDebug('[TCAE_AI] push cart', { id: ent.id, cart: ai.targetCartId, patient: ai.targetPatientId });
      return;
    }

    ai.state = 'patrol';
    ai.targetCartId = null;
    ai.targetPatientId = null;
    logDebug('[TCAE_AI] state', { id: ent.id, state: ai.state, cart: ai.targetCartId });
  }

  function updateRepairCart(ent, ai, dt) {
    const cart = getEntityById(ai.targetCartId);
    if (!cart || !cart.broken) {
      ai.state = 'patrol';
      ai.targetCartId = null;
      return;
    }

    if (!isNear(ent, cart, CART_NEAR_RADIUS)) {
      moveTowards(ent, cart.x + (cart.w || TILE) * 0.5, cart.y + (cart.h || TILE) * 0.5, ent.speed);
      setTcaeWalkAnim(ent, ai);
      return;
    }

    ent.vx = 0; ent.vy = 0;
    setTcaeExtraAnim(ent, ai);
    if (ai.repairTimer <= 0) {
      cart.broken = false;
      if (typeof cart.hp === 'number' && Number.isFinite(cart.maxHp)) {
        cart.hp = cart.maxHp;
      }
      if (typeof cart.onRepair === 'function') {
        try { cart.onRepair(ent); } catch (_) {}
      }
      ai.state = 'patrol';
      ai.targetCartId = null;
      ai.repairTimer = 0;
      logDebug('[TCAE_AI] state', { id: ent.id, state: ai.state, cart: ai.targetCartId });
    }
  }

  function updatePushCart(ent, ai, dt) {
    const cart = getEntityById(ai.targetCartId);
    if (!cart) {
      ai.state = 'patrol';
      ai.targetCartId = null;
      ai.pushingCart = false;
      return;
    }

    const patient = getEntityById(ai.targetPatientId) || findClosestPatient(ent);
    if (!isNear(ent, cart, CART_NEAR_RADIUS)) {
      moveTowards(ent, cart.x + (cart.w || TILE) * 0.5, cart.y + (cart.h || TILE) * 0.5, ent.speed);
      setTcaeWalkAnim(ent, ai);
      ai.pushingCart = false;
      return;
    }

    ai.pushingCart = true;
    if (patient) {
      pushCartTowards(cart, patient.x + (patient.w || TILE) * 0.5, patient.y + (patient.h || TILE) * 0.5, PUSH_FORCE);
      setTcaePushAnim(ent, ai);
      if (isNear(cart, patient, PATIENT_NEAR_RADIUS)) {
        ai.state = 'patrol';
        ai.pushingCart = false;
        ai.targetCartId = null;
        ai.targetPatientId = null;
      }
    } else {
      ai.state = 'patrol';
      ai.pushingCart = false;
    }
  }

  function updatePatrol(ent, ai, dt) {
    ai.patrolTimer -= dt;
    if (ai.patrolTimer <= 0 || !ai.patrolTarget) {
      ai.patrolTimer = 2 + Math.random() * 2.5;
      const base = findClosestPatient(ent);
      const cx = base ? base.x + (base.w || TILE) * 0.5 : ent.x + ent.w * 0.5;
      const cy = base ? base.y + (base.h || TILE) * 0.5 : ent.y + ent.h * 0.5;
      ai.patrolTarget = {
        x: cx + (Math.random() - 0.5) * PATROL_RADIUS,
        y: cy + (Math.random() - 0.5) * PATROL_RADIUS
      };
    }
    const target = ai.patrolTarget;
    moveTowards(ent, target.x, target.y, ent.speed * 0.75);
  }

  function findClosestCart(ent, filterOpts = {}) {
    const arr = (G.entities || []);
    const centerEnt = center(ent);
    let best = null;
    let bestD2 = Infinity;
    for (const item of arr) {
      if (!item) continue;
      const kindOk = item.kind === ENT.CART || item.kind === 'cart' || (item.group === 'cart');
      if (!kindOk) continue;
      if (filterOpts.broken === true && !item.broken) continue;
      if (filterOpts.type && (item.cartType || item.type) !== filterOpts.type) continue;
      const c = center(item);
      const d2 = dist2(centerEnt.x, centerEnt.y, c.x, c.y);
      if (d2 < bestD2) {
        best = item;
        bestD2 = d2;
      }
    }
    return best;
  }

  function findClosestPatient(ent) {
    const pools = [G.patients, G.entities];
    const centerEnt = center(ent);
    let best = null;
    let bestD2 = Infinity;
    for (const pool of pools) {
      if (!Array.isArray(pool)) continue;
      for (const patient of pool) {
        if (!patient) continue;
        const kind = patient.kind;
        const isPatient = kind === ENT.PATIENT || kind === 'patient' || patient.role === 'patient';
        if (!isPatient || patient.dead) continue;
        const c = center(patient);
        const d2 = dist2(centerEnt.x, centerEnt.y, c.x, c.y);
        if (d2 < bestD2) {
          best = patient;
          bestD2 = d2;
        }
      }
    }
    return best;
  }

  function findClosestPatientToCart(cart) {
    if (!cart) return null;
    const fakeEnt = { x: cart.x, y: cart.y, w: cart.w, h: cart.h };
    return findClosestPatient(fakeEnt);
  }

  function moveTowards(ent, tx, ty, speed) {
    const c = center(ent);
    const dx = tx - c.x;
    const dy = ty - c.y;
    const len = Math.hypot(dx, dy) || 1;
    const s = speed || ent.speed || 1;
    ent.vx += (dx / len) * s;
    ent.vy += (dy / len) * s;
  }

  function isNear(a, b, radiusTiles) {
    if (!a || !b) return false;
    const radius = radiusTiles * TILE;
    const ca = center(a);
    const cb = center(b);
    return Math.hypot(ca.x - cb.x, ca.y - cb.y) <= radius;
  }

  function pushCartTowards(cart, tx, ty, force = 1) {
    if (!cart) return;
    const cx = cart.x + (cart.w || TILE) * 0.5;
    const cy = cart.y + (cart.h || TILE) * 0.5;
    const dx = tx - cx;
    const dy = ty - cy;
    const len = Math.hypot(dx, dy) || 1;
    const f = force * 12;
    cart.vx = (cart.vx || 0) * 0.6 + (dx / len) * f;
    cart.vy = (cart.vy || 0) * 0.6 + (dy / len) * f;
    cart.pushing = true;
    cart.pushedBy = KIND_STRING;
    if (typeof cart.onPush === 'function') {
      try { cart.onPush({ x: cart.vx, y: cart.vy, agent: KIND_STRING }); } catch (_) {}
    }
  }

  function startTcaeRiddleDialog(ent, hero) {
    const ai = ent.ai || (ent.ai = createAiState());
    if (ai.state === 'talk') return;
    ai.state = 'talk';
    ai.talkCooldown = 10;
    ent.vx = 0; ent.vy = 0;
    setTcaeTalkAnim(ent);
    if (hero) {
      hero.vx = 0; hero.vy = 0;
      hero.isTalking = true;
      try { W.Entities?.Hero?.setTalking?.(hero, true, 1.2); } catch (_) {}
    }
    ent.isTalking = true;
    logDebug('[TCAE_TALK] start riddle', { id: ent.id });

    const riddle = RIDDLES[ai.riddleIndex % RIDDLES.length];
    ai.riddleIndex = (ai.riddleIndex + 1) % RIDDLES.length;

    const finish = (success) => {
      ai.state = 'patrol';
      ent.isTalking = false;
      if (hero && hero.isTalking) hero.isTalking = false;
      setTcaeIdleAnim(ent);
      onTcaeDialogEnd(ent, hero, success);
      logDebug('[TCAE_TALK] end dialog', { id: ent.id, success });
    };

    if (!riddle) { finish(true); return; }

    const resolve = (correct) => {
      if (correct) applySmallReward(hero);
      else applySmallPenalty(hero);
      finish(correct);
    };

    const opened = W.DialogUtils?.openRiddleDialog?.({
      id: riddle.key,
      title: 'Auxiliar TCAE',
      portraitCssVar: '--sprite-tcae',
      ask: riddle.ask,
      hint: riddle.hint,
      options: riddle.options,
      correctIndex: riddle.correctIndex,
      onSuccess: () => resolve(true),
      onFail: () => resolve(false),
      onClose: () => finish(false)
    });

    if (!opened) {
      finish(false);
    }
  }

  function onTcaeDialogEnd(ent, hero, success) {
    const ai = ent.ai || (ent.ai = createAiState());
    ai.state = 'patrol';
    ai.talkCooldown = 8;
    if (hero) {
      try { W.Entities?.Hero?.setTalking?.(hero, false); } catch (_) {}
    }
  }

  function applySmallReward(hero) {
    if (!hero) return;
    const heal = 2;
    if (typeof hero.hp === 'number') {
      const maxHp = hero.maxHp || hero.hpMax || hero.hp;
      hero.hp = Math.min(maxHp, hero.hp + heal);
    }
    if (typeof G.score === 'number') G.score += 15;
    W.ScoreAPI?.addPoints?.(15);
    W.EffectsAPI?.applyTimedEffect?.(hero, { secs: 6, speedMul: 1.05, pushMul: 1.05 });
  }

  function applySmallPenalty(hero) {
    if (!hero) return;
    if (typeof hero.hp === 'number') hero.hp = Math.max(1, hero.hp - 2);
    if (typeof G.score === 'number') G.score = Math.max(0, G.score - 10);
    W.ScoreAPI?.addPoints?.(-10);
    W.EffectsAPI?.applyTimedEffect?.(hero, { secs: 5, speedMul: 0.9, pushMul: 0.9, dmgHalves: 1 });
  }

  function center(ent) {
    return {
      x: (ent.x || 0) + (ent.w || TILE) * 0.5,
      y: (ent.y || 0) + (ent.h || TILE) * 0.5
    };
  }

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function rectsOverlap(a, b) {
    if (!a || !b) return false;
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function applyFriction(ent, amount) {
    ent.vx *= amount;
    ent.vy *= amount;
    if (Math.abs(ent.vx) < 0.01) ent.vx = 0;
    if (Math.abs(ent.vy) < 0.01) ent.vy = 0;
  }

  function setTcaeWalkAnim(ent, ai) {
    if (!ent) return;
    if (Math.abs(ent.vx) > Math.abs(ent.vy)) {
      ai.dir = 'side';
      updateRigAnim(ent, 'walk_side');
    } else if (ent.vy < 0) {
      ai.dir = 'up';
      updateRigAnim(ent, 'walk_up');
    } else {
      ai.dir = 'down';
      updateRigAnim(ent, 'walk_down');
    }
  }

  function setTcaePushAnim(ent) {
    updateRigAnim(ent, 'push_action');
  }

  function setTcaeExtraAnim(ent) {
    updateRigAnim(ent, 'extra');
  }

  function setTcaeIdleAnim(ent) {
    updateRigAnim(ent, 'idle');
  }

  function setTcaeTalkAnim(ent) {
    updateRigAnim(ent, 'talk');
  }

  function updateRigAnim(ent, anim) {
    if (!anim || !ent) return;
    ent.anim = anim;
    ent.npcAnim = anim;
    if (ent.puppet?.state) ent.puppet.state.anim = anim;
    if (ent.puppetState) ent.puppetState.anim = anim;
  }

  function getEntityId(entity) {
    if (!entity) return null;
    return entity.id || entity.__id || entity.uuid || null;
  }

  function getEntityById(id) {
    if (!id) return null;
    if (typeof id === 'object') return id;
    const pools = [G.entities, G.objects, G.decor, G.patients];
    for (const pool of pools) {
      if (!Array.isArray(pool)) continue;
      const found = pool.find((e) => e && (e.id === id || e.__id === id || e.uuid === id));
      if (found) return found;
    }
    return null;
  }

  function placeSafeNear(tx, ty, w, h) {
    const px = tx * TILE + Math.max(1, (TILE - w) * 0.5);
    const py = ty * TILE + Math.max(1, (TILE - h) * 0.5);
    if (!isWallRect(px, py, w, h)) return { x: px, y: py };
    const ring = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
    for (const [dx, dy] of ring) {
      const nx = (tx + dx) * TILE + Math.max(1, (TILE - w) * 0.5);
      const ny = (ty + dy) * TILE + Math.max(1, (TILE - h) * 0.5);
      if (!isWallRect(nx, ny, w, h)) return { x: nx, y: ny };
    }
    return { x: px, y: py };
  }

  function isWallRect(x, y, w, h) {
    if (typeof W.isWallAt === 'function') return W.isWallAt(x, y, w, h);
    const x1 = Math.floor(x / TILE);
    const y1 = Math.floor(y / TILE);
    const x2 = Math.floor((x + w - 1) / TILE);
    const y2 = Math.floor((y + h - 1) / TILE);
    const map = G.map || [];
    for (let ty = y1; ty <= y2; ty++) {
      for (let tx = x1; tx <= x2; tx++) {
        if (map?.[ty]?.[tx] === 1) return true;
      }
    }
    return false;
  }

  function moveWithCollisions(ent, dt) {
    if (typeof W.moveWithCollisions === 'function') { W.moveWithCollisions(ent, dt); return; }
    const nx = ent.x + (ent.vx || 0) * dt;
    const ny = ent.y + (ent.vy || 0) * dt;
    if (!isWallRect(nx, ent.y, ent.w, ent.h)) ent.x = nx; else ent.vx = 0;
    if (!isWallRect(ent.x, ny, ent.w, ent.h)) ent.y = ny; else ent.vy = 0;
  }

  const API = { spawn, list, update, startTcaeRiddleDialog: startTcaeRiddleDialog };
  W.Entities = W.Entities || {};
  W.Entities.TCAE = API;

  (function autoHook() {
    if (Array.isArray(G.__updateHooks)) {
      const hook = (dt) => API.update(dt);
      if (!G.__updateHooks.includes(hook)) G.__updateHooks.push(hook);
      return;
    }
    let last = performance.now();
    function tick() {
      const now = performance.now();
      const dt = Math.min(1 / 30, (now - last) / 1000);
      last = now;
      API.update(dt);
      W.requestAnimationFrame(tick);
    }
    W.requestAnimationFrame(tick);
  })();

})(this);
