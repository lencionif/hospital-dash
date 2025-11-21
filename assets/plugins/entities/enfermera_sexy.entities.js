// filename: enfermera_sexy.entities.js
// ENFERMERA ENAMORADIZA — NPC que patrulla, enamora y lanza acertijos tipo test.
// Todo el rig cabe en 1 tile y usa PuppetAPI con el rig "npc_enfermera_enamoradiza".

(function (W) {
  'use strict';

  const Entities = W.Entities || (W.Entities = {});
  if (typeof Entities.define !== 'function') {
    Entities.define = function define(name, factory) {
      Entities[name] = factory;
    };
  }

  const G = W.G || (W.G = {});
  const ENT = (function ensureEnt() {
    const e = W.ENT || (W.ENT = {});
    if (typeof e.PLAYER === 'undefined') e.PLAYER = 1;
    if (typeof e.ENFERMERA_SEXY === 'undefined') e.ENFERMERA_SEXY = 812;
    return e;
  })();

  const TILE = (typeof W.TILE_SIZE === 'number') ? W.TILE_SIZE : (W.TILE || 32);
  const DEBUG = () => (W.DEBUG_NURSE_LOVE || W.DEBUG_FORCE_ASCII);

  const DEFAULT_PATROL_POINTS = [
    { x: 0, y: 0 },
    { x: 2, y: 1 },
    { x: 4, y: -1 },
    { x: 1, y: -3 },
    { x: -2, y: -1 },
    { x: -3, y: 2 },
  ];

  const LoveNurseRiddles = [
    { id: 'nurse_q1', question: '¿Cuál es la zona correcta para pinchar una heparina subcutánea?', options: [
      'En la cara anterior del muslo', 'En la zona periumbilical del abdomen', 'En la palma de la mano'
    ], correctIndex: 1 },
    { id: 'nurse_q2', question: 'Antes de administrar un antibiótico IV, ¿qué es lo más importante comprobar?', options: [
      'El color favorito del paciente', 'La fecha y hora del último baño', 'La alergia del paciente a ese fármaco'
    ], correctIndex: 2 },
    { id: 'nurse_q3', question: '¿Cada cuánto hay que cambiar una vía periférica salvo complicaciones?', options: [
      'Cada 96 horas', 'Una vez al mes', 'Nunca si no molesta'
    ], correctIndex: 0 },
    { id: 'nurse_q4', question: 'Para medir la tensión arterial correctamente el brazo debe estar…', options: [
      'Por encima del nivel del corazón', 'A nivel del corazón', 'Colgando hacia el suelo'
    ], correctIndex: 1 },
    { id: 'nurse_q5', question: '¿Qué indica una saturación de oxígeno menor al 90% de forma mantenida?', options: [
      'Hipoxia', 'Estado óptimo', 'Solo nervios'
    ], correctIndex: 0 },
    { id: 'nurse_q6', question: '¿Qué hay que confirmar antes de administrar insulina rápida?', options: [
      'La marca del tensiómetro', 'La glucemia capilar', 'El color del pijama'
    ], correctIndex: 1 },
    { id: 'nurse_q7', question: 'Al mover a un paciente encamado para evitar úlceras, ¿cada cuánto se recomienda cambiar de posición?', options: [
      'Cada 2-3 horas', 'Una vez al día', 'Solo si se queja'
    ], correctIndex: 0 },
    { id: 'nurse_q8', question: '¿Qué debe hacerse antes de manipular una sonda vesical?', options: [
      'Usar guantes y técnica aséptica', 'Solo preguntar al paciente', 'Nada, no hace falta'
    ], correctIndex: 0 },
    { id: 'nurse_q9', question: '¿Qué vacuna se revisa especialmente en personal sanitario expuesto a sangre?', options: [
      'Vacuna del sarampión', 'Vacuna de la hepatitis B', 'Vacuna de la varicela'
    ], correctIndex: 1 },
    { id: 'nurse_q10', question: 'Para calcular goteo de suero por gravedad se usa la fórmula…', options: [
      'Volumen (ml) / tiempo (h) x 20', 'Peso / 2', 'Altura x 10'
    ], correctIndex: 0 },
    { id: 'nurse_q11', question: '¿Qué es un “ISBAR” en comunicación clínica?', options: [
      'Un tipo de suero', 'Un método estructurado de pase de información', 'Un dispositivo de oxígeno'
    ], correctIndex: 1 },
    { id: 'nurse_q12', question: '¿Cuál es el rango normal de frecuencia cardíaca en reposo en adultos?', options: [
      '30-40 lpm', '60-100 lpm', '120-150 lpm'
    ], correctIndex: 1 },
    { id: 'nurse_q13', question: '¿Qué se debe comprobar antes de usar un desfibrilador?', options: [
      'Que la cama esté hecha', 'Que las palas tengan gel y nadie toque al paciente', 'Que haya música puesta'
    ], correctIndex: 1 },
    { id: 'nurse_q14', question: 'En una escala de Glasgow, ¿qué puntaje indica apertura ocular espontánea?', options: [
      '1', '2', '4'
    ], correctIndex: 2 },
    { id: 'nurse_q15', question: '¿Qué valor aproximado se considera fiebre en adultos?', options: [
      '≥ 38ºC', '35ºC', '36ºC'
    ], correctIndex: 0 },
  ];

  W.LoveNurseRiddles = LoveNurseRiddles;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx; const dy = ay - by; return dx * dx + dy * dy; };
  const center = (ent) => ({ x: ent.x + ent.w * 0.5, y: ent.y + ent.h * 0.5 });
  const randRange = (a, b) => a + Math.random() * (b - a);

  function getHero() { return G.player; }
  function toTileX(px) { return Math.max(0, Math.floor(px / TILE)); }
  function toTileY(py) { return Math.max(0, Math.floor(py / TILE)); }
  function toPx(tx) { return tx * TILE; }
  function toPy(ty) { return ty * TILE; }

  function bfsPath(start, goal) {
    const grid = G.collisionGrid || G.map || [];
    const H = grid.length; const Wd = grid[0]?.length || 0;
    if (!H || !Wd) return null;
    const inb = (x, y) => y >= 0 && y < H && x >= 0 && x < Wd;
    const sx = clamp(start.x | 0, 0, Wd - 1);
    const sy = clamp(start.y | 0, 0, H - 1);
    const tx = clamp(goal.x | 0, 0, Wd - 1);
    const ty = clamp(goal.y | 0, 0, H - 1);
    if (grid[ty]?.[tx] === 1) return null;
    const key = (x, y) => (y << 16) | x;
    const queue = [[sx, sy]];
    const visited = new Set([key(sx, sy)]);
    const prev = new Map();
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (queue.length) {
      const [cx, cy] = queue.shift();
      if (cx === tx && cy === ty) break;
      for (const [dx, dy] of N4) {
        const nx = cx + dx, ny = cy + dy;
        if (!inb(nx, ny) || grid[ny]?.[nx] === 1) continue;
        const k = key(nx, ny);
        if (visited.has(k)) continue;
        visited.add(k);
        prev.set(k, key(cx, cy));
        queue.push([nx, ny]);
        if (nx === tx && ny === ty) { queue.length = 0; break; }
      }
    }
    const tgtKey = key(tx, ty);
    if (!prev.has(tgtKey) && !(sx === tx && sy === ty)) return null;
    const path = [];
    let cur = tgtKey;
    path.push({ x: tx, y: ty });
    while (cur !== key(sx, sy)) {
      const prevKey = prev.get(cur);
      if (prevKey == null) break;
      const px = prevKey & 0xFFFF; const py = prevKey >> 16;
      path.push({ x: px, y: py });
      cur = prevKey;
    }
    path.reverse();
    return path;
  }

  function applyAnim(ent, anim) {
    ent.anim = anim;
    if (!ent.puppetState) ent.puppetState = {};
    ent.puppetState.anim = anim;
  }

  function updateLoveNurseAnim(ent) {
    const ai = ent.ai || {};
    const st = ent.puppetState || (ent.puppetState = {});
    const speed = Math.hypot(ent.vx || 0, ent.vy || 0);
    if (ai.state === 'dead') { st.anim = ai.deathAnim || 'die_hit'; return; }
    if (ai.state === 'talk') { st.anim = 'talk'; return; }
    if (ai.state === 'love') { st.anim = 'extra'; return; }
    if (speed > 0.01) {
      if (Math.abs(ent.vx) > Math.abs(ent.vy)) st.anim = 'walk_side';
      else if (ent.vy < 0) st.anim = 'walk_up';
      else st.anim = 'walk_down';
    } else {
      st.anim = 'idle';
    }
  }

  function onLoveNurseDialogFinished(nurse, result) {
    const ai = nurse.ai || (nurse.ai = {});
    ai.state = 'cooldown';
    ai.loveCooldown = nurse.loveCooldownTime * 0.5;
    ai.dialogActive = false;
    nurse.vx = nurse.vy = 0;
    if (DEBUG()) console.debug('[NURSE_TALK] end dialog', { nurseId: nurse.id, result });
  }

  function startRiddleDialog(nurse) {
    const ai = nurse.ai || (nurse.ai = {});
    const riddle = LoveNurseRiddles[ai.riddleIndex % LoveNurseRiddles.length];
    ai.riddleIndex = (ai.riddleIndex + 1) % LoveNurseRiddles.length;
    if (!riddle) { onLoveNurseDialogFinished(nurse, { missing: true }); return; }
    ai.dialogActive = true;
    if (DEBUG()) console.debug('[NURSE_TALK] start riddle', { nurseId: nurse.id, riddleIndex: ai.riddleIndex });
    if (typeof pauseGame === 'function') pauseGame();

    const finish = (payload) => {
      if (typeof resumeGame === 'function') resumeGame();
      onLoveNurseDialogFinished(nurse, payload);
    };

    const resolve = (correct) => {
      if (correct) W.DialogAPI?.system?.('¡Correcto! ❤️', { ms: 1400 });
      else W.DialogAPI?.system?.('Ups, repasa tus apuntes.', { ms: 1400 });
      finish({ correct });
    };

    const opened = W.DialogUtils?.openRiddleDialog?.({
      id: riddle.id,
      title: 'Enfermera Enamoradiza',
      ask: riddle.question,
      options: riddle.options,
      correctIndex: riddle.correctIndex,
      portraitCssVar: '--sprite-enfermera-sexy',
      onSuccess: () => resolve(true),
      onFail: () => resolve(false),
      onClose: (correct) => finish({ correct })
    });

    if (!opened) finish({ opened: false });
  }

  function onLoveNurseTouchHero(nurse, hero) {
    const ai = nurse.ai || (nurse.ai = {});
    if (ai.state === 'dead' || ai.state === 'love' || ai.state === 'talk') return;
    ai.state = 'talk';
    ai.riddleIndex = ai.riddleIndex || 0;
    nurse.vx = nurse.vy = 0;
    if (DEBUG()) console.debug('[NURSE_TALK] start', { nurseId: nurse.id });
    const talkAPI = W.DialogueAPI || W.DialogAPI;
    talkAPI?.startRiddleDialog?.('love_nurse', nurse.id);
    startRiddleDialog(nurse);
  }

  function enterLove(ent) {
    const ai = ent.ai || (ent.ai = {});
    const hero = getHero();
    if (!hero) return;
    ai.state = 'love';
    ai.loveTimer = ent.loveDuration;
    ai.loveCooldown = ent.loveCooldownTime;
    ent.vx = ent.vy = 0;
    hero.loveLock = ent.id;
    if (DEBUG()) console.debug('[NURSE_LOVE] enter love', { nurseId: ent.id, heroId: hero.id });
  }

  function leaveLove(ent) {
    const ai = ent.ai || (ent.ai = {});
    ai.state = 'patrol';
    ai.loveTimer = 0;
    const hero = getHero();
    if (hero && hero.loveLock === ent.id) hero.loveLock = null;
    if (DEBUG()) console.debug('[NURSE_LOVE] leave love', { nurseId: ent.id });
  }

  function buildPatrolRoute(ent) {
    const ai = ent.ai || (ent.ai = {});
    const base = Array.isArray(ai.patrolPoints) && ai.patrolPoints.length ? ai.patrolPoints : DEFAULT_PATROL_POINTS;
    const absolute = ai.patrolAbsolute === true;
    const route = [];
    for (const p of base) {
      if (!p) continue;
      const dx = Number(p.x) || 0; const dy = Number(p.y) || 0;
      const tx = absolute ? dx : ai.spawnTx + dx;
      const ty = absolute ? dy : ai.spawnTy + dy;
      route.push({ x: tx, y: ty });
    }
    return route.length ? route : [{ x: ai.spawnTx, y: ai.spawnTy }];
  }

  function ensurePath(ai, from, goal) {
    ai.path = bfsPath(from, goal) || null;
    ai.pathIndex = 0;
    ai.repathTimer = 1.15;
  }

  function moveAlongPath(ent, dt) {
    const ai = ent.ai;
    if (!ai?.path || ai.pathIndex >= ai.path.length) return false;
    const step = ai.path[ai.pathIndex];
    const gx = toPx(step.x) + TILE * 0.5;
    const gy = toPy(step.y) + TILE * 0.5;
    const c = center(ent);
    const dx = gx - c.x;
    const dy = gy - c.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = ent.speed * TILE * 1.6;
    ent.vx = (dx / dist) * speed;
    ent.vy = (dy / dist) * speed;
    if (dist < 4) ai.pathIndex++;
    return true;
  }

  function updatePatrol(ent, dt) {
    const ai = ent.ai;
    if (!ai.patrolRoute || !ai.patrolRoute.length) ai.patrolRoute = buildPatrolRoute(ent);
    if (ai.waitTimer > 0) {
      ai.waitTimer = Math.max(0, ai.waitTimer - dt);
      ent.vx *= 0.2; ent.vy *= 0.2;
      applyAnim(ent, ai.waitTimer > 0.4 ? 'extra' : 'idle');
      return;
    }

    const target = ai.patrolRoute[ai.patrolIndex % ai.patrolRoute.length];
    const c = center(ent);
    const here = { x: toTileX(c.x), y: toTileY(c.y) };
    const goal = { x: target.x, y: target.y };
    ai.repathTimer = Math.max(0, (ai.repathTimer || 0) - dt);
    if (!ai.path || ai.repathTimer <= 0) ensurePath(ai, here, goal);
    const moved = moveAlongPath(ent, dt);
    if (!moved) {
      const dx = (goal.x * TILE + TILE * 0.5) - c.x;
      const dy = (goal.y * TILE + TILE * 0.5) - c.y;
      const L = Math.hypot(dx, dy) || 1;
      if (L < TILE * 0.35) {
        ai.patrolIndex = (ai.patrolIndex + 1) % ai.patrolRoute.length;
        ai.waitTimer = randRange(1.0, 2.0);
        ai.path = null;
      } else {
        ent.vx = (dx / L) * ent.speed * TILE * 1.5;
        ent.vy = (dy / L) * ent.speed * TILE * 1.5;
      }
    }

    if (Math.abs(ent.vx) > Math.abs(ent.vy)) ai.dir = ent.vx > 0 ? 'right' : 'left';
    else ai.dir = ent.vy > 0 ? 'down' : 'up';
  }

  function updateLove(ent, dt) {
    const ai = ent.ai;
    ent.vx = 0; ent.vy = 0;
    ai.loveTimer = Math.max(0, ai.loveTimer - dt);
    ai.loveCooldown = Math.max(0, ai.loveCooldown - dt);
    applyAnim(ent, 'extra');
    if (ai.loveTimer <= 0) leaveLove(ent);
  }

  function updateLoveNurse(ent, dt) {
    const ai = ent.ai;
    if (!ai || ai.state === 'dead') return;

    const hero = getHero();
    if (!hero && ai.state === 'love') leaveLove(ent);
    if (hero && hero.loveLock && hero.loveLock === ent.id && ai.state !== 'love') hero.loveLock = null;

    ai.loveCooldown = Math.max(0, (ai.loveCooldown || 0) - dt);

    if (ai.state === 'talk') {
      ent.vx = ent.vy = 0;
      applyAnim(ent, 'talk');
      if (!ai.dialogActive) startRiddleDialog(ent);
      updateLoveNurseAnim(ent);
      return;
    }
    if (ai.state === 'love') { updateLove(ent, dt); updateLoveNurseAnim(ent); return; }

    if (ai.cooldownTimer > 0) ai.cooldownTimer = Math.max(0, ai.cooldownTimer - dt);

    updatePatrol(ent, dt);

    if (hero && !hero.dead) {
      const overlap = hero.x < ent.x + ent.w && hero.x + hero.w > ent.x && hero.y < ent.y + ent.h && hero.y + hero.h > ent.y;
      if (overlap) { onLoveNurseTouchHero(ent, hero); updateLoveNurseAnim(ent); return; }

      const ec = center(ent); const hc = center(hero);
      const d2 = dist2(ec.x, ec.y, hc.x, hc.y);
      const loveRadiusPx2 = (ent.loveRadius * TILE) * (ent.loveRadius * TILE);
      if (ai.loveCooldown <= 0 && (ai.state === 'patrol' || ai.state === 'cooldown' || ai.state === 'idle') && d2 < loveRadiusPx2) {
        enterLove(ent);
      }
    }

    updateLoveNurseAnim(ent);
  }

  function attachRig(ent) {
    try {
      const rig = W.Puppet?.bind?.(ent, 'npc_enfermera_enamoradiza')
        || W.PuppetAPI?.attach?.(ent, { rig: 'npc_enfermera_enamoradiza', z: 0, scale: 1 });
      if (rig) ent.rigOk = true;
    } catch (_) { ent.rigOk = false; }
  }

  function createLoveNurse(pos, opts = {}) {
    const base = (typeof Entities.createBaseHuman === 'function')
      ? Entities.createBaseHuman(pos, opts)
      : {
          x: (pos?.x ?? (Array.isArray(pos) ? pos[0] : 0)) || 0,
          y: (pos?.y ?? (Array.isArray(pos) ? pos[1] : 0)) || 0,
          w: TILE * 0.9,
          h: TILE * 0.95,
          vx: 0, vy: 0,
          solid: true,
          pushable: false,
          mass: 1,
          mu: 0.16,
          puppetState: { anim: 'idle' },
        };

    const ent = base;
    ent.id = ent.id || `love_nurse_${Math.random().toString(36).slice(2, 8)}`;
    ent.kind = 'npc_enfermera_enamoradiza';
    ent.role = 'love_nurse';
    ent.speed = opts.speed ?? 2.6;
    ent.touchDamage = 0;
    ent.isStunning = false;
    ent.loveRadius = opts.loveRadius ?? 2.5;
    ent.loveDuration = opts.loveDuration ?? 4.0;
    ent.loveCooldownTime = opts.loveCooldownTime ?? 10;
    ent.skin = ent.skin || opts.skin || 'enfermera_sexy.png';
    ent.anim = ent.anim || 'idle';
    ent.puppetState = ent.puppetState || { anim: 'idle' };
    ent.ai = Object.assign({
      state: 'patrol',
      dir: 'down',
      patrolIndex: 0,
      patrolRoute: null,
      path: null,
      pathIndex: 0,
      repathTimer: 0,
      spawnTx: toTileX(ent.x + ent.w * 0.5),
      spawnTy: toTileY(ent.y + ent.h * 0.5),
      waitTimer: randRange(0.5, 1.2),
      loveTimer: 0,
      loveCooldown: 0,
      riddleIndex: 0,
      cooldownTimer: 0,
    }, opts.ai || {});
    ent.ai.patrolRoute = ent.ai.patrolRoute || buildPatrolRoute(ent);
    ent.update = function update(dt) { updateLoveNurse(ent, dt || 1 / 60); };
    ent.onCollide = function onCollide(other) {
      if (other && other.kind === ENT.PLAYER) onLoveNurseTouchHero(ent, other);
    };

    if (!Array.isArray(G.entities)) G.entities = [];
    if (!G.entities.includes(ent)) G.entities.push(ent);
    if (!Array.isArray(G.movers)) G.movers = [];
    if (!G.movers.includes(ent)) G.movers.push(ent);
    ent.group = ent.group || 'human';
    try { W.EntityGroups?.assign?.(ent); } catch (_) {}
    try { W.EntityGroups?.register?.(ent, G); } catch (_) {}

    attachRig(ent);
    return ent;
  }

  Entities.define('enfermera_enamoradiza', createLoveNurse);
  Entities.define('npc_enfermera_enamoradiza', createLoveNurse);

  W.EnfermeraSexyAPI = {
    spawnEnfermera(tx, ty, props = {}) {
      return createLoveNurse({ x: toPx(tx), y: toPy(ty) }, Object.assign({ tile: true }, props));
    },
  };

  W.LoveNurseAPI = {
    spawn(pos, opts) { return createLoveNurse(pos, opts); },
    list() { return (G.entities || []).filter((e) => e && e.kind === 'npc_enfermera_enamoradiza'); },
  };

})(this);
