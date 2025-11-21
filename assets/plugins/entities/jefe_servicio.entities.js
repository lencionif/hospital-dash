// filename: assets/plugins/entities/jefe_servicio.entities.js
// "Il Divo: Hospital Dash!" – NPC "Jefe de Servicio"
// • IA estratégica que patrulla, busca comida/power-ups, empuja carros, abre puertas
//   y usa ascensores.
// • Al tocar al jugador lanza acertijos médicos muy difíciles con premios/castigos potentes.
// • Usa un rig procedural en canvas (npc_jefe_servicio) y todas las animaciones encajan
//   dentro de 1 TILE.

/* global Physics */
(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const TILE = (typeof W.TILE_SIZE !== 'undefined') ? W.TILE_SIZE : (W.TILE || 32);
  const MAX_DISTANCE = TILE * 22;
  const THINK_INTERVAL = 2.0;
  const EAT_DURATION = 2.0;
  const PUSH_DURATION = 3.0;
  const PATROL_REPATH = 4.0;

  const BASE_STATS = {
    kind: 'npc_jefe_servicio',
    name: 'Jefe de Servicio',
    hp: 999,
    maxHp: 999,
    speed: 0.8,
    strength: 5.0,
    intelligence: 10,
    isHostile: true
  };

  const RIDDLES = [
    {
      id: 'triaje',
      title: 'Triaje de Urgencias',
      text: 'Paciente con dolor torácico súbito + diaforesis. ¿Prioridad?',
      options: ['Baja', 'Diferida', 'Alta', 'No urgente'],
      correctIndex: 2,
      reward: { healHalves: 4, secs: 18, speedMul: 1.22, pushMul: 1.30, visionDelta: +1, points: 200 },
      penalty: { dmgHalves: 4, secs: 14, speedMul: 0.65, pushMul: 0.80, visionDelta: -1 }
    },
    {
      id: 'asepsia',
      title: 'Asepsia quirúrgica',
      text: '¿Qué medida NO es una técnica de barrera?',
      options: ['Guantes estériles', 'Mascarilla', 'Lavado de manos', 'Antitérmico oral'],
      correctIndex: 3,
      reward: { healHalves: 4, secs: 16, speedMul: 1.18, pushMul: 1.25, visionDelta: +1, points: 150 },
      penalty: { dmgHalves: 3, secs: 12, speedMul: 0.7, pushMul: 0.8, visionDelta: -1 }
    },
    {
      id: 'electrolitos',
      title: 'Electrolitos',
      text: 'Hiponatremia severa sintomática. ¿Tratamiento inicial adecuado?',
      options: [
        'Restringir agua y observar',
        'Bolo de salino hipertónico controlado',
        'Aumentar agua libre',
        'Diurético de asa + más agua libre'
      ],
      correctIndex: 1,
      reward: { healHalves: 4, secs: 20, speedMul: 1.24, pushMul: 1.32, visionDelta: +1, points: 220 },
      penalty: { dmgHalves: 4, secs: 14, speedMul: 0.66, pushMul: 0.78, visionDelta: -1 }
    },
    {
      id: 'antibioticos',
      title: 'Antibióticos',
      text: '¿Cuándo se recomienda desescalar en infección nosocomial?',
      options: ['Nunca se desescala', 'Siempre a las 24h', 'Tras cultivo y estabilidad clínica', 'Al terminar el suero'],
      correctIndex: 2,
      reward: { healHalves: 2, secs: 14, speedMul: 1.12, pushMul: 1.15, visionDelta: 0, points: 120 },
      penalty: { dmgHalves: 2, secs: 10, speedMul: 0.82, pushMul: 0.88, visionDelta: 0 }
    },
    {
      id: 'trombo',
      title: 'Tromboembolismo',
      text: 'Paciente con TVP masiva + disnea. ¿Actuación inicial?',
      options: ['Analgesia y reposo', 'Anticoagulación inmediata', 'Alta y revisión', 'Sólo medias compresivas'],
      correctIndex: 1,
      reward: { healHalves: 3, secs: 16, speedMul: 1.15, pushMul: 1.18, visionDelta: +1, points: 160 },
      penalty: { dmgHalves: 3, secs: 12, speedMul: 0.8, pushMul: 0.84, visionDelta: -1 }
    }
  ];

  if (!G.effects) G.effects = Object.create(null);

  function nowSec() {
    return (G.timeSec || 0);
  }

  function clamp(v, a, b) {
    return v < a ? a : (v > b ? b : v);
  }

  function entityCenter(ent) {
    return {
      x: (ent.x || 0) + (ent.w || TILE) * 0.5,
      y: (ent.y || 0) + (ent.h || TILE) * 0.5
    };
  }

  function rectsOverlap(a, b) {
    return a && b && (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);
  }

  function applyTimedEffect(player, fx) {
    if (!player) return;
    const listKey = player.id || 'player';
    const list = (G.effects[listKey] = G.effects[listKey] || []);
    const effect = {
      until: nowSec() + (fx.secs || 10),
      speedMul: fx.speedMul || 1,
      pushMul: fx.pushMul || 1,
      visionDelta: fx.visionDelta || 0,
      healHalves: fx.healHalves || 0,
      dmgHalves: fx.dmgHalves || 0
    };
    list.push(effect);
    if (fx.healHalves && player.hp != null) {
      player.hp = Math.min(player.maxHp || player.hp + fx.healHalves, player.hp + fx.healHalves);
    }
    if (fx.dmgHalves && player.hp != null) {
      player.hp = Math.max(0, player.hp - fx.dmgHalves);
    }
    if (fx.points && typeof G.score === 'number') {
      G.score += fx.points;
    }
  }

  W.EffectsAPI = W.EffectsAPI || {};
  W.EffectsAPI.applyTimedEffect = applyTimedEffect;

  const ChiefSystem = {
    list: [],
    spawn(x, y, opts = {}) {
      const e = {
        id: opts.id || `npc_jefe_servicio_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
        kind: BASE_STATS.kind,
        name: BASE_STATS.name,
        x: x || 0,
        y: y || 0,
        w: TILE * 0.9,
        h: TILE * 0.9,
        vx: 0,
        vy: 0,
        hp: BASE_STATS.hp,
        maxHp: BASE_STATS.maxHp,
        speed: opts.speed || BASE_STATS.speed,
        strength: opts.strength || BASE_STATS.strength,
        intelligence: opts.intelligence || BASE_STATS.intelligence,
        isHostile: true,
        solid: true,
        dynamic: true,
        pushable: false,
        ai: {
          state: 'patrol',
          dir: 'down',
          patrolTimer: 0,
          riddleIndex: 0,
          energy: 100,
          searchTarget: null,
          path: null,
          pathIndex: 0,
          pathGoal: null,
          thinkTimer: THINK_INTERVAL,
          talkCooldown: 0,
          stateTimer: 0,
          pushTarget: null,
          pushTimer: 0,
          extraTimer: 0,
          logTimer: 0
        }
      };

      Object.assign(e, opts || {});

      bindRig(e);
      ensureCollections(e);
      ChiefSystem.list.push(e);
      return e;
    },
    update(dt) {
      G.timeSec = (G.timeSec || 0) + dt;
      for (let i = ChiefSystem.list.length - 1; i >= 0; i--) {
        const e = ChiefSystem.list[i];
        if (!e || e.dead) continue;
        updateChief(e, dt);
      }
    }
  };

  function bindRig(ent) {
    try {
      const puppet = W.Puppet?.bind?.(ent, 'npc_jefe_servicio', { z: 0, scale: 1 })
        || W.PuppetAPI?.attach?.(ent, { rig: 'npc_jefe_servicio', z: 0, scale: 1 });
      if (puppet) {
        ent.puppet = puppet;
        ent.rigOk = true;
        if (puppet.state) puppet.state.anim = 'idle';
      }
    } catch (err) {
      try { console.warn('[Chief] rig attach error', err); } catch (_) {}
    }
  }

  function ensureCollections(ent) {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!G.entities.includes(ent)) G.entities.push(ent);
    ent.group = ent.group || 'human';
    try { W.EntityGroups?.assign?.(ent); } catch (_) {}
    try { W.EntityGroups?.register?.(ent, G); } catch (_) {}
    if (Physics?.registerEntity) {
      try { Physics.registerEntity(ent); } catch (_) {}
    }
  }

  function updateChief(e, dt) {
    const ai = e.ai || (e.ai = {});
    ai.thinkTimer = Math.max(0, ai.thinkTimer - dt);
    ai.talkCooldown = Math.max(0, ai.talkCooldown - dt);
    ai.patrolTimer = Math.max(0, ai.patrolTimer - dt);
    ai.extraTimer = Math.max(0, ai.extraTimer - dt);
    ai.logTimer = Math.max(0, ai.logTimer - dt);

    if (ai.state === 'dead') {
      e.vx = e.vy = 0;
      setAnim(e, 'die_hit');
      return;
    }

    if (ai.thinkTimer <= 0 && ai.state !== 'talk' && ai.state !== 'eat') {
      ai.thinkTimer = THINK_INTERVAL;
      ai.searchTarget = findClosestEntity(e, ['food', 'powerup'], MAX_DISTANCE);
      if (ai.searchTarget) {
        ai.state = 'smart_move';
        ai.path = null;
        ai.pathGoal = null;
        ai.pathIndex = 0;
        console.debug('[CHIEF_AI] found food', { id: e.id, target: ai.searchTarget?.id || ai.searchTarget?.kind });
      }
    }

    switch (ai.state) {
      case 'eat':
        e.vx = e.vy = 0;
        ai.stateTimer -= dt;
        if (ai.stateTimer <= 0) {
          ai.energy = Math.min(100, ai.energy + 20);
          ai.state = 'patrol';
          ai.extraTimer = 1.2;
        }
        break;
      case 'talk':
        e.vx = e.vy = 0;
        break;
      case 'push':
        handlePushState(e, dt);
        break;
      case 'smart_move':
        pursueTarget(e, dt, true);
        break;
      case 'patrol':
      default:
        if (ai.logTimer <= 0) {
          // console.debug('[CHIEF_AI] patrol step', { id: e.id, state: ai.state });
          ai.logTimer = 1.0;
        }
        pursueTarget(e, dt, false);
        break;
    }

    limitSpeed(e);
    moveEntity(e, dt);
    updateAnimation(e);
    tryInteractWithObstacles(e, dt);
    maybeCollideWithHero(e);
  }

  function pursueTarget(e, dt, chasingItem) {
    const ai = e.ai;
    const target = chasingItem ? ai.searchTarget : ai.pathGoal;
    const reached = advancePath(e, dt, chasingItem ? target : null);
    if (!reached && (!ai.path || ai.pathIndex >= (ai.path?.length || 0) || ai.patrolTimer <= 0)) {
      if (chasingItem && target) {
        const goal = entityCenter(target);
        planPathTo(e, goal.x, goal.y);
      } else {
        planPatrolPath(e);
      }
    }
    if (chasingItem && ai.searchTarget && ai.searchTarget._remove) {
      ai.searchTarget = null;
      ai.state = 'patrol';
    }
    if (chasingItem && ai.searchTarget && isTouchingEntity(e, ai.searchTarget)) {
      consumeTarget(ai.searchTarget);
      ai.searchTarget = null;
      ai.state = 'eat';
      ai.stateTimer = EAT_DURATION;
      ai.extraTimer = 0.8;
      console.debug('[CHIEF_AI] eating', { id: e.id });
      setAnim(e, 'eat');
    }
  }

  function planPatrolPath(e) {
    const ai = e.ai;
    ai.patrolTimer = PATROL_REPATH;
    const target = pickRandomTile();
    if (!target) return;
    ai.path = bfsPath(entityToTile(e), target);
    ai.pathIndex = 0;
    ai.pathGoal = target ? {
      x: target.x * TILE + TILE * 0.5,
      y: target.y * TILE + TILE * 0.5
    } : null;
  }

  function planPathTo(e, x, y) {
    const ai = e.ai;
    const goal = {
      x: clamp(Math.floor(x / TILE), 0, getGridWidth() - 1),
      y: clamp(Math.floor(y / TILE), 0, getGridHeight() - 1)
    };
    ai.path = bfsPath(entityToTile(e), goal);
    ai.pathIndex = 0;
    ai.pathGoal = goal ? {
      x: goal.x * TILE + TILE * 0.5,
      y: goal.y * TILE + TILE * 0.5
    } : null;
  }

  function advancePath(e, dt, preferEntity) {
    const ai = e.ai;
    if (!ai.path || ai.pathIndex >= ai.path.length) return false;
    const node = ai.path[ai.pathIndex];
    const targetPx = preferEntity && preferEntity.kind ? entityCenter(preferEntity) : {
      x: node.x * TILE + TILE * 0.5,
      y: node.y * TILE + TILE * 0.5
    };
    const reached = moveTowards(e, targetPx, dt);
    if (reached) {
      ai.pathIndex++;
      return ai.pathIndex < ai.path.length;
    }
    return true;
  }

  function moveTowards(e, target, dt) {
    const cx = (e.x || 0) + e.w * 0.5;
    const cy = (e.y || 0) + e.h * 0.5;
    const dx = target.x - cx;
    const dy = target.y - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const dirX = dx / dist;
    const dirY = dy / dist;
    const speedPx = (e.speed || BASE_STATS.speed) * TILE * 0.9;
    e.vx = dirX * speedPx;
    e.vy = dirY * speedPx;
    const ai = e.ai;
    if (Math.abs(dirX) > Math.abs(dirY)) {
      ai.dir = dirX > 0 ? 'right' : 'left';
    } else {
      ai.dir = dirY > 0 ? 'down' : 'up';
    }
    return dist < Math.max(8, TILE * 0.25);
  }

  function limitSpeed(e) {
    const speedPx = (e.speed || BASE_STATS.speed) * TILE;
    const speed = Math.hypot(e.vx, e.vy);
    if (speed > speedPx) {
      const s = speedPx / speed;
      e.vx *= s;
      e.vy *= s;
    }
  }

  function moveEntity(e, dt) {
    if (typeof W.moveWithCollisions === 'function') {
      W.moveWithCollisions(e, dt);
      return;
    }
    e.x += (e.vx || 0) * dt;
    e.y += (e.vy || 0) * dt;
  }

  function updateAnimation(e) {
    const ai = e.ai || {};
    if (ai.state === 'dead') {
      setAnim(e, 'die_crush');
      return;
    }
    if (ai.state === 'talk') {
      setAnim(e, 'talk');
      return;
    }
    if (ai.state === 'eat') {
      setAnim(e, 'eat');
      return;
    }
    if (ai.state === 'push') {
      setAnim(e, 'push_action');
      return;
    }
    if (ai.extraTimer > 0) {
      setAnim(e, 'powerup');
      return;
    }
    const speed = Math.hypot(e.vx || 0, e.vy || 0);
    if (speed > 0.1) {
      if (Math.abs(e.vx) > Math.abs(e.vy)) {
        setAnim(e, 'walk_side');
      } else if (e.vy < 0) {
        setAnim(e, 'walk_up');
      } else {
        setAnim(e, 'walk_down');
      }
    } else {
      setAnim(e, 'idle');
    }
  }

  function setAnim(e, anim) {
    if (!anim || !e) return;
    e.anim = anim;
    if (e.puppet?.state) e.puppet.state.anim = anim;
  }

  function tryInteractWithObstacles(e, dt) {
    const pushTarget = findPushable(e);
    if (pushTarget) {
      const ai = e.ai;
      ai.state = 'push';
      ai.pushTarget = pushTarget;
      ai.pushTimer = PUSH_DURATION;
      return;
    }
    const door = pickDoorBlocking(e);
    if (door) tryUseDoor(e, door);
    const elevator = pickElevator(e);
    if (elevator) tryUseElevator(e, elevator);
  }

  function handlePushState(e, dt) {
    const ai = e.ai;
    ai.pushTimer -= dt;
    if (!ai.pushTarget || ai.pushTarget.dead || ai.pushTimer <= 0) {
      ai.state = 'patrol';
      ai.pushTarget = null;
      return;
    }
    const pushed = pushEntity(e, ai.pushTarget);
    if (!pushed) {
      ai.state = 'patrol';
      ai.pushTarget = null;
    }
  }

  function pushEntity(e, target) {
    if (!target || target.dead) return false;
    const dir = entityCenter(target);
    const self = entityCenter(e);
    const dx = dir.x - self.x;
    const dy = dir.y - self.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    const impulse = (e.strength || BASE_STATS.strength) * 0.6;
    target.vx = (target.vx || 0) + nx * impulse;
    target.vy = (target.vy || 0) + ny * impulse;
    target.pushedBy = e.id;
    return true;
  }

  function findPushable(e) {
    const list = Array.isArray(G.entities) ? G.entities : [];
    for (const it of list) {
      if (!it || it === e || it.dead) continue;
      if (!isPushable(it)) continue;
      if (distanceSq(e, it) < (TILE * 1.1) ** 2) return it;
    }
    return null;
  }

  function isPushable(ent) {
    if (!ent) return false;
    if (ent.pushable) return true;
    const kind = String(ent.kind || ent.kindName || ent.name || '').toLowerCase();
    return kind.includes('cart') || kind.includes('carro') || kind.includes('car');
  }

  function distanceSq(a, b) {
    const ac = entityCenter(a);
    const bc = entityCenter(b);
    const dx = ac.x - bc.x;
    const dy = ac.y - bc.y;
    return dx * dx + dy * dy;
  }

  function pickDoorBlocking(ent) {
    const doors = Array.isArray(G.doors) ? G.doors : [];
    return doors.find((door) => door && !door.open && rectsOverlap(expand(ent, 6), expand(door, 6)));
  }

  function pickElevator(ent) {
    const elevators = Array.isArray(G.elevators) ? G.elevators : [];
    return elevators.find((ev) => ev && rectsOverlap(expand(ent, 4), expand(ev, 4)));
  }

  function expand(ent, pad) {
    return { x: ent.x - pad, y: ent.y - pad, w: ent.w + pad * 2, h: ent.h + pad * 2 };
  }

  function tryUseDoor(ent, door) {
    if (!door) return false;
    try {
      const Doors = W.Entities?.Door;
      if (Doors?.open) { Doors.open(door, { by: ent.name }); return true; }
      if (Doors?.toggle) { Doors.toggle(door, { by: ent.name }); return true; }
      door.open = true;
      door.walkable = true;
      door.solid = false;
      return true;
    } catch (_) {
      return false;
    }
  }

  function tryUseElevator(ent, elevator) {
    if (!elevator) return false;
    try {
      if (W.Entities?.Elevator?.travel) {
        W.Entities.Elevator.travel(elevator, { by: ent.name });
        return true;
      }
      if (W.Entities?.Elevator?.forceActivate && elevator.pairId) {
        W.Entities.Elevator.forceActivate(elevator.pairId);
        return true;
      }
    } catch (_) {}
    return false;
  }

  function findClosestEntity(e, types, maxDist) {
    const list = getPickupCandidates();
    let best = null;
    let bestDist = maxDist * maxDist;
    for (const item of list) {
      if (!item || item.dead || item._remove) continue;
      if (!matchesType(item, types)) continue;
      const d2 = distanceSq(e, item);
      if (d2 < bestDist) {
        best = item;
        bestDist = d2;
      }
    }
    return best;
  }

  function getPickupCandidates() {
    const list = [];
    const items = (W.Items && Array.isArray(W.Items._list)) ? W.Items._list : null;
    if (items) list.push(...items);
    if (Array.isArray(G.objects)) list.push(...G.objects);
    if (Array.isArray(G.entities)) list.push(...G.entities);
    return list;
  }

  function matchesType(item, types) {
    if (!types || !types.length) return false;
    const name = String(item.kind || item.kindName || item.itemType || item.type || item.name || '').toLowerCase();
    return types.some((needle) => name.includes(String(needle).toLowerCase()));
  }

  function isTouchingEntity(a, b) {
    if (!a || !b) return false;
    return rectsOverlap(a, b);
  }

  function consumeTarget(target) {
    if (!target) return;
    target.dead = true;
    target._remove = true;
    const itemPool = (W.Items && Array.isArray(W.Items._list)) ? W.Items._list : null;
    if (itemPool) {
      const idx = itemPool.indexOf(target);
      if (idx >= 0) itemPool.splice(idx, 1);
    }
    const idxG = Array.isArray(G.entities) ? G.entities.indexOf(target) : -1;
    if (idxG >= 0) G.entities.splice(idxG, 1);
  }

  function maybeCollideWithHero(e) {
    const hero = G.player;
    const ai = e.ai;
    if (!hero || hero.dead || ai.state === 'talk' || ai.state === 'dead') return;
    if (ai.talkCooldown > 0) return;
    if (!rectsOverlap(e, hero)) return;
    ai.state = 'talk';
    ai.talkCooldown = 12;
    e.vx = e.vy = 0;
    console.debug('[CHIEF_TALK] start hard riddle', { id: e.id });
    startChiefRiddleDialog(e, hero);
  }

  function startChiefRiddleDialog(e, hero) {
    const ai = e.ai || (e.ai = {});
    const riddle = RIDDLES[ai.riddleIndex % RIDDLES.length];
    ai.riddleIndex = (ai.riddleIndex + 1) % RIDDLES.length;
    setAnim(e, 'talk');
    e.isTalking = true;
    if (hero) {
      hero.vx = 0; hero.vy = 0;
      hero.isTalking = true;
      try { W.Entities?.Hero?.setTalking?.(hero, true); } catch (_) {}
    }
    if (typeof pauseGame === 'function') pauseGame();
    let finished = false;
    const finish = (correct) => {
      if (finished) return;
      finished = true;
      if (typeof resumeGame === 'function') resumeGame();
      onChiefDialogEnd(e, hero, correct);
    };

    const opened = W.DialogUtils?.openRiddleDialog?.({
      id: riddle.key || riddle.title,
      title: 'Jefe de Servicio',
      ask: riddle.text,
      options: riddle.options,
      hint: riddle.hint,
      correctIndex: riddle.correctIndex,
      portraitCssVar: '--sprite-jefe-servicio',
      allowEsc: false,
      onSuccess: () => finish(true),
      onFail: () => finish(false),
      onClose: () => finish(false)
    });

    if (!opened) {
      finish(false);
    }
  }

  function onChiefDialogEnd(e, hero, correct) {
    const ai = e.ai || (e.ai = {});
    ai.state = 'patrol';
    e.isTalking = false;
    setAnim(e, 'idle');
    if (hero) {
      hero.isTalking = false;
      try { W.Entities?.Hero?.setTalking?.(hero, false); } catch (_) {}
    }
    if (correct) {
      applyMajorReward(hero);
    } else {
      applyMajorPunishment(hero);
    }
    console.debug('[CHIEF_TALK] end dialog', { id: e.id });
  }

  function applyMajorReward(hero) {
    if (!hero) return;
    applyTimedEffect(hero, { healHalves: 6, secs: 18, speedMul: 1.35, pushMul: 1.4, visionDelta: 1, points: 250 });
    try { W.DialogAPI?.system?.('¡Respuesta perfecta! Te ganas el respeto del jefe.', { ms: 2200 }); } catch (_) {}
  }

  function applyMajorPunishment(hero) {
    if (!hero) return;
    applyTimedEffect(hero, { dmgHalves: 6, secs: 14, speedMul: 0.55, pushMul: 0.6, visionDelta: -1 });
    hero.slowUntil = nowSec() + 6;
    try { W.DialogAPI?.system?.('El jefe te reprende: pierdes energía.', { ms: 2200 }); } catch (_) {}
  }

  function entityToTile(e) {
    const cx = (e.x || 0) + e.w * 0.5;
    const cy = (e.y || 0) + e.h * 0.5;
    return { x: clamp(Math.floor(cx / TILE), 0, getGridWidth() - 1), y: clamp(Math.floor(cy / TILE), 0, getGridHeight() - 1) };
  }

  function pickRandomTile() {
    const h = getGridHeight();
    const w = getGridWidth();
    if (!h || !w) return null;
    return { x: Math.floor(Math.random() * w), y: Math.floor(Math.random() * h) };
  }

  function getGrid() {
    const map = G.map;
    if (Array.isArray(map) && map.length) return map;
    return [[0]];
  }

  function getGridWidth() {
    const grid = getGrid();
    return grid[0]?.length || 1;
  }

  function getGridHeight() {
    const grid = getGrid();
    return grid.length || 1;
  }

  function isWalkable(tx, ty) {
    const grid = getGrid();
    const row = grid[ty];
    if (!row) return true;
    return row[tx] !== 1;
  }

  function bfsPath(start, goal) {
    const grid = getGrid();
    const height = grid.length;
    const width = grid[0]?.length || 0;
    if (!height || !width) return null;
    const sx = clamp(start.x | 0, 0, width - 1);
    const sy = clamp(start.y | 0, 0, height - 1);
    const gx = clamp(goal.x | 0, 0, width - 1);
    const gy = clamp(goal.y | 0, 0, height - 1);
    if (sx === gx && sy === gy) return [{ x: sx, y: sy }];
    const queue = [[sx, sy]];
    const visited = new Set([`${sx},${sy}`]);
    const prev = new Map();
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (queue.length) {
      const [cx, cy] = queue.shift();
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!isWalkable(nx, ny)) continue;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        visited.add(key);
        prev.set(key, `${cx},${cy}`);
        queue.push([nx, ny]);
        if (nx === gx && ny === gy) {
          return reconstructPath(prev, sx, sy, gx, gy);
        }
      }
    }
    return null;
  }

  function reconstructPath(prev, sx, sy, gx, gy) {
    const path = [{ x: gx, y: gy }];
    let key = `${gx},${gy}`;
    while (key !== `${sx},${sy}`) {
      const p = prev.get(key);
      if (!p) break;
      const [px, py] = p.split(',').map((n) => Number(n));
      path.push({ x: px, y: py });
      key = p;
    }
    path.reverse();
    return path;
  }

  (function ensureUpdateHook() {
    G._hooks = G._hooks || {};
    if (!G._hooks.jefeServicioUpdate) {
      G._hooks.jefeServicioUpdate = true;
      const prev = G.onTick;
      G.onTick = function patchedChiefTick(dt) {
        if (typeof prev === 'function') prev(dt);
        ChiefSystem.update(dt || 0.016);
      };
    }
  })();

  W.JefeServicioAPI = ChiefSystem;
  W.Entities = W.Entities || {};
  W.Entities.JefeServicio = { spawn: ChiefSystem.spawn };
  W.startChiefRiddleDialog = startChiefRiddleDialog;
  W.onChiefDialogEnd = onChiefDialogEnd;

})(this);
