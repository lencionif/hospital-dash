// filename: enfermera_sexy.entities.js
// Enfermera Enamoradiza — NPC patrullero con acertijos y estado "love".
// ---------------------------------------------------------------------
// • Patrulla habitaciones usando pathfinding básico en tiles.
// • Si choca con el héroe abre un diálogo con acertijos de enfermería.
// • Si el héroe se acerca demasiado entra en modo "love" y lo hechiza.
// • Dibujo via PuppetAPI con rig dedicado "npc_enfermera_enamoradiza".
// • Diseño a prueba de motores incompletos (usa guards y fallbacks).

(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const ENT = (function () {
    const e = W.ENT || (W.ENT = {});
    e.ENFERMERA_SEXY = e.ENFERMERA_SEXY || 812;
    e.PLAYER = e.PLAYER || 1;
    return e;
  })();

  const TILE = (typeof W.TILE_SIZE === 'number') ? W.TILE_SIZE : (W.TILE || 32);
  const LOVE_RADIUS_TILES = 2.5;
  const LOVE_DURATION = 4;
  const LOVE_COOLDOWN_TIME = 10;
  const TALK_COOLDOWN = 8;
  const PATROL_SPEED = 74;
  const PATROL_WAIT_MIN = 1.1;
  const PATROL_WAIT_MAX = 2.2;
  const REPATH_INTERVAL = 1.15;
  const LOVE_RADIUS_PX = LOVE_RADIUS_TILES * TILE;
  const LOVE_RADIUS2 = LOVE_RADIUS_PX * LOVE_RADIUS_PX;

  const nurseLovePatrolPoints = [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 2 },
    { x: 0, y: 2 },
    { x: -2, y: 1 }
  ];

  const nurseRiddles = [
    {
      ask: '¿Cuántos segundos mínimos debe durar el lavado de manos clínico?',
      hint: 'Es el número que recomienda la OMS.',
      options: [
        { label: '10 segundos', correct: false },
        { label: '20 segundos', correct: true },
        { label: '35 segundos', correct: false }
      ]
    },
    {
      ask: 'Cuando administras un medicamento IV, ¿qué debes comprobar siempre?',
      hint: 'Piensa en la regla de los 5 correctos.',
      options: [
        { label: 'Solo el horario', correct: false },
        { label: 'Paciente, dosis, vía, medicamento y hora', correct: true },
        { label: 'El color del fármaco', correct: false }
      ]
    },
    {
      ask: '¿Cuál es el valor normal aproximado de la saturación de oxígeno?',
      hint: 'Más del 95% mantiene al paciente estable.',
      options: [
        { label: '75%', correct: false },
        { label: '92%', correct: false },
        { label: '95% o más', correct: true }
      ]
    }
  ];

  const S = { nurses: [] };
  const DEBUG = () => (W.DEBUG_NURSE_LOVE || W.DEBUG_FORCE_ASCII);

  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx; const dy = ay - by; return dx * dx + dy * dy; };
  const toTx = (px) => Math.max(0, Math.floor(px / TILE));
  const toTy = (py) => Math.max(0, Math.floor(py / TILE));
  const toPx = (tx) => tx * TILE;
  const toPy = (ty) => ty * TILE;
  const nowSec = () => (performance?.now ? performance.now() / 1000 : Date.now() / 1000);

  function center(ent){ return { x: ent.x + ent.w * 0.5, y: ent.y + ent.h * 0.5 }; }
  function rectsOverlap(a, b){ return a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

  function getGrid(){ return G.collisionGrid || G.map || []; }
  function canWalk(tx, ty){ const grid = getGrid(); const row = grid[ty]; return row && row[tx] === 0; }

  function bfsPath(start, goal){
    const grid = getGrid();
    const H = grid.length; const Wd = grid[0]?.length || 0;
    if (!H || !Wd) return null;
    const inb = (x,y)=> y>=0 && y<H && x>=0 && x<Wd;
    const sx = clamp(start.x|0, 0, Wd-1), sy = clamp(start.y|0, 0, H-1);
    const tx = clamp(goal.x|0, 0, Wd-1), ty = clamp(goal.y|0, 0, H-1);
    if (grid[ty]?.[tx] === 1) return null;
    const key = (x,y)=> (y<<16)|x;
    const q = [[sx,sy]];
    const prev = new Map();
    const vis = new Set([key(sx,sy)]);
    const N4 = [[1,0],[-1,0],[0,1],[0,-1]];
    while (q.length){
      const [cx,cy] = q.shift();
      if (cx===tx && cy===ty) break;
      for (const [dx,dy] of N4){
        const nx=cx+dx, ny=cy+dy;
        if (!inb(nx,ny) || grid[ny]?.[nx] === 1) continue;
        const k = key(nx,ny);
        if (vis.has(k)) continue;
        vis.add(k);
        prev.set(k, key(cx,cy));
        q.push([nx,ny]);
        if (nx===tx && ny===ty){
          q.length = 0;
          break;
        }
      }
    }
    const tgtKey = key(tx,ty);
    if (!prev.has(tgtKey) && !(sx===tx && sy===ty)) return null;
    const path = [];
    let cur = tgtKey;
    path.push({ x: tx, y: ty });
    while (cur !== key(sx,sy)){
      const prevKey = prev.get(cur);
      if (prevKey == null) break;
      const px = prevKey & 0xFFFF;
      const py = prevKey >> 16;
      path.push({ x: px, y: py });
      cur = prevKey;
    }
    path.reverse();
    return path;
  }

  function pushUnique(arr, item){ if (!arr || !item) return; if (!arr.includes(item)) arr.push(item); }

  function ensureArrays(e){
    pushUnique(G.entities || (G.entities = []), e);
    pushUnique(G.movers || (G.movers = []), e);
    e.group = 'human';
    try { W.EntityGroups?.assign?.(e); } catch (_) {}
    try { W.EntityGroups?.register?.(e, G); } catch (_) {}
    try { W.MovementSystem?.register?.(e); } catch (_) {}
  }

  function buildPatrolRoute(ai, props){
    const base = Array.isArray(props?.patrolPoints) && props.patrolPoints.length ? props.patrolPoints : nurseLovePatrolPoints;
    const absolute = props?.patrolAbsolute === true;
    const route = [];
    for (const point of base){
      if (!point) continue;
      const dx = Number(point.x) || 0;
      const dy = Number(point.y) || 0;
      const tx = absolute ? dx : ai.spawnTx + dx;
      const ty = absolute ? dy : ai.spawnTy + dy;
      route.push({ x: tx, y: ty });
    }
    return route.length ? route : [{ x: ai.spawnTx, y: ai.spawnTy }];
  }

  function setAnim(e, anim){
    if (!anim) return;
    e.anim = anim;
    if (e.puppet?.state) e.puppet.state.anim = anim;
  }

  function startTalk(e, hero){
    const ai = e.ai;
    if (!ai || ai.state === 'talk') return;
    ai.state = 'talk';
    ai.dialogActive = false;
    ai.waitTimer = 0;
    e.vx = 0; e.vy = 0;
    if (hero){ hero.vx *= 0.3; hero.vy *= 0.3; }
  }

  function startLove(e){
    const ai = e.ai; if (!ai) return;
    const hero = G.player;
    if (!hero) return;
    ai.state = 'love';
    ai.loveTimer = LOVE_DURATION;
    ai.loveCooldown = LOVE_COOLDOWN_TIME;
    hero.loveLock = e.id;
    if (DEBUG()) console.debug('[NURSE_LOVE] enter love', { nurseId: e.id, heroId: hero.id });
  }

  function leaveLove(e){
    const ai = e.ai; if (!ai) return;
    const hero = G.player;
    ai.state = 'patrol';
    ai.loveTimer = 0;
    if (hero && hero.loveLock === e.id) hero.loveLock = null;
    if (DEBUG()) console.debug('[NURSE_LOVE] leave love', { nurseId: e.id });
  }

  function openRiddleDialog(e){
    const ai = e.ai; if (!ai) return;
    const hero = G.player;
    const riddle = nurseRiddles[ai.riddleIndex % nurseRiddles.length];
    ai.riddleIndex = (ai.riddleIndex + 1) % nurseRiddles.length;
    const onAnswer = (correct) => {
      if (correct) {
        W.DialogAPI?.system?.('¡Correcto! ❤️', { ms: 1400 });
      } else {
        W.DialogAPI?.system?.('Ups, repasa tus apuntes.', { ms: 1400 });
      }
    };
    const finish = () => {
      ai.dialogActive = false;
      ai.state = 'patrol';
      ai.cooldownTimer = 1.2;
      ai.talkCooldown = TALK_COOLDOWN;
      setAnim(e, 'idle');
      if (DEBUG()) console.debug('[NURSE_TALK] end dialog, back to patrol');
    };
    if (!riddle){ finish(); return; }
    ai.dialogActive = true;
    if (DEBUG()) console.debug('[NURSE_TALK] start riddle', { riddleIndex: ai.riddleIndex });
    const opened = W.DialogUtils?.openRiddleDialog?.({
      id: riddle.key,
      title: 'Enfermera del Corazón',
      ask: riddle.ask,
      hint: riddle.hint,
      options: riddle.options.map((opt) => opt.label),
      correctIndex: Math.max(0, riddle.options.findIndex((opt) => opt.correct)),
      portraitCssVar: '--sprite-enfermera-sexy',
      onSuccess: () => onAnswer(true),
      onFail: () => onAnswer(false),
      onClose: finish
    });

    if (!opened) {
      finish();
    }
  }

  function updateTalk(e){
    const ai = e.ai;
    if (!ai) return;
    e.vx = 0; e.vy = 0;
    setAnim(e, 'talk');
    if (!ai.dialogActive){
      openRiddleDialog(e);
    }
  }

  function ensurePath(ai, from, goal){
    ai.path = bfsPath(from, goal) || null;
    ai.pathIndex = 0;
    ai.repathTimer = REPATH_INTERVAL;
  }

  function moveAlongPath(e, dt){
    const ai = e.ai;
    if (!ai?.path || ai.pathIndex >= ai.path.length) return false;
    const step = ai.path[ai.pathIndex];
    const gx = toPx(step.x) + TILE * 0.5;
    const gy = toPy(step.y) + TILE * 0.5;
    const c = center(e);
    const dx = gx - c.x;
    const dy = gy - c.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = PATROL_SPEED;
    e.vx = (dx / dist) * speed;
    e.vy = (dy / dist) * speed;
    if (dist < 4){
      ai.pathIndex++;
    }
    return true;
  }

  function updatePatrol(e, dt){
    const ai = e.ai; if (!ai) return;
    if (!Array.isArray(ai.patrolRoute) || !ai.patrolRoute.length){
      ai.patrolRoute = buildPatrolRoute(ai, ai.props || {});
      ai.patrolIndex = 0;
    }
    if (ai.waitTimer > 0){
      ai.waitTimer = Math.max(0, ai.waitTimer - dt);
      e.vx *= 0.2; e.vy *= 0.2;
      setAnim(e, ai.waitTimer > 0.5 ? 'extra' : 'idle');
      return;
    }
    const target = ai.patrolRoute[ai.patrolIndex % ai.patrolRoute.length];
    const c = center(e);
    const here = { x: toTx(c.x), y: toTy(c.y) };
    const goal = { x: target.x, y: target.y };
    ai.repathTimer = Math.max(0, (ai.repathTimer || 0) - dt);
    if (!ai.path || ai.repathTimer <= 0){
      ensurePath(ai, here, goal);
    }
    const moved = moveAlongPath(e, dt);
    if (!moved){
      const dx = (goal.x * TILE + TILE * 0.5) - c.x;
      const dy = (goal.y * TILE + TILE * 0.5) - c.y;
      const L = Math.hypot(dx, dy);
      if (L < TILE * 0.35){
        ai.patrolIndex = (ai.patrolIndex + 1) % ai.patrolRoute.length;
        ai.waitTimer = rand(PATROL_WAIT_MIN, PATROL_WAIT_MAX);
        ai.path = null;
      } else {
        e.vx = (dx / (L || 1)) * PATROL_SPEED;
        e.vy = (dy / (L || 1)) * PATROL_SPEED;
      }
    }
    const spd = Math.hypot(e.vx, e.vy);
    if (spd > 2){
      if (Math.abs(e.vx) > Math.abs(e.vy)){
        ai.dir = e.vx >= 0 ? 'right' : 'left';
        setAnim(e, 'walk_side');
      } else if (e.vy < 0){
        ai.dir = 'up';
        setAnim(e, 'walk_up');
      } else {
        ai.dir = 'down';
        setAnim(e, 'walk_down');
      }
    } else {
      setAnim(e, 'idle');
    }
  }

  function updateLove(e, dt){
    const ai = e.ai;
    e.vx *= 0.5;
    e.vy *= 0.5;
    setAnim(e, 'extra');
    ai.loveTimer = Math.max(0, ai.loveTimer - dt);
    ai.loveCooldown = Math.max(0, ai.loveCooldown - dt);
    if (ai.loveTimer <= 0){
      leaveLove(e);
    }
  }

  function updateNurse(e, dt){
    if (!e || e.dead){
      if (G.player && G.player.loveLock === e?.id) G.player.loveLock = null;
      return;
    }
    const ai = e.ai;
    if (!ai) return;
    ai.talkCooldown = Math.max(0, (ai.talkCooldown || 0) - dt);
    ai.cooldownTimer = Math.max(0, (ai.cooldownTimer || 0) - dt);
    ai.loveCooldown = Math.max(0, (ai.loveCooldown || 0) - dt);

    const hero = G.player;
    if (hero && hero.loveLock && hero.loveLock === e.id && ai.state !== 'love'){
      hero.loveLock = null;
    }

    if (ai.state === 'talk'){
      updateTalk(e);
      return;
    }
    if (ai.state === 'love'){
      updateLove(e, dt);
      return;
    }
    if (ai.cooldownTimer > 0){
      e.vx *= 0.6; e.vy *= 0.6;
      setAnim(e, 'idle');
    } else {
      ai.state = 'patrol';
      updatePatrol(e, dt);
    }

    if (!hero || hero.dead) return;

    const overlap = rectsOverlap(e, hero);
    if (overlap && ai.talkCooldown <= 0 && ai.state !== 'talk'){
      startTalk(e, hero);
      return;
    }

    const ec = center(e);
    const hc = center(hero);
    const d2 = dist2(ec.x, ec.y, hc.x, hc.y);
    if (!overlap && ai.loveCooldown <= 0 && d2 < LOVE_RADIUS2){
      startLove(e);
    }
  }

  function updateAll(dt){
    S.nurses = S.nurses.filter((e) => e && !e._inactive);
    for (const e of S.nurses){
      try { updateNurse(e, dt || 0); }
      catch (err){ if (DEBUG()) console.warn('[NurseLove] update error', err); }
    }
  }

  function create(x, y, props = {}){
    const px = props.tile ? toPx(x) + TILE * 0.1 : Math.round(x);
    const py = props.tile ? toPy(y) : Math.round(y);
    const w = Math.round(TILE * 0.85);
    const h = Math.round(TILE * 0.95);
    const e = {
      id: 'nurse_love_' + Math.random().toString(36).slice(2),
      kind: ENT.ENFERMERA_SEXY,
      name: 'Enfermera Enamoradiza',
      x: px,
      y: py,
      w,
      h,
      vx: 0,
      vy: 0,
      solid: true,
      pushable: false,
      mu: 0.18,
      spriteKey: 'nurse_enamorada',
      skin: 'enfermera_sexy.png',
      anim: 'idle',
      ai: {
        state: 'patrol',
        dir: 'down',
        patrolIndex: 0,
        patrolRoute: null,
        path: null,
        pathIndex: 0,
        repathTimer: 0,
        spawnTx: toTx(px + w * 0.5),
        spawnTy: toTy(py + h * 0.5),
        loveTimer: 0,
        loveCooldown: 0,
        riddleIndex: 0,
        waitTimer: rand(PATROL_WAIT_MIN, PATROL_WAIT_MAX),
        talkCooldown: 0,
        cooldownTimer: 0,
        props
      },
      onInteract(player){ startTalk(e, player); }
    };
    e.ai.patrolRoute = buildPatrolRoute(e.ai, props);
    ensureArrays(e);
    pushUnique(S.nurses, e);
    try { W.AI?.attach?.(e, 'NURSE_LOVE'); } catch (_) {}
    try {
      const puppet = W.Puppet?.bind?.(e, 'npc_enfermera_enamoradiza', { z: 0, scale: 1 })
        || W.PuppetAPI?.attach?.(e, { rig: 'npc_enfermera_enamoradiza', z: 0, scale: 1 });
      e.rigOk = !!puppet;
    } catch (_) { e.rigOk = false; }
    return e;
  }

  const API = {
    init(){
      if (!Array.isArray(G.entities)) G.entities = [];
      if (!G._nurseLoveSystem){
        try { W.AI?.registerSystem?.('NURSE_LOVE', (_state, dt) => updateAll(dt)); }
        catch (_) {}
        if (Array.isArray(G.systems)){
          G.systems.push({ id: 'nurse_love', update: (dt) => updateAll(dt) });
        }
        G._nurseLoveSystem = true;
      }
      return this;
    },
    spawn(x, y, props = {}){
      return create(x, y, props);
    },
    update: updateAll,
    getAll(){ return S.nurses.slice(); }
  };

  W.Entities = W.Entities || {};
  W.Entities.NurseSexy = API;
  W.EnfermeraSexyAPI = {
    spawnEnfermera(tx, ty, props = {}){
      return API.spawn(tx, ty, Object.assign({ tile: true }, props));
    }
  };

  API.init();

})(this);
