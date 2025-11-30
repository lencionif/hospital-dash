// filename: enfermera_sexy.entities.js
// NPC Aliado — Enfermera Sexy (IA avanzada cooperativa)
// ------------------------------------------------------
// • Patrulla con pathfinding sobre G.map / G.collisionGrid.
// • Evita peligros (fuego/charco) y zonas bloqueadas.
// • Abre puertas si el motor lo permite (Entities.Door.*).
// • Luz propia (rosa) y cura al jugador/pacientes cercanos.
// • "Perfume" que repele enemigos (ratas/mosquitos/furiosas).
// • Interacción (E): Curar o dar Turbo.
// • Seguro ante ausencia de APIs: todo con guards.
//
// Integración típica:
//   <script src="enfermera_sexy.entities.js"></script>
//   // Se auto-registra en G.systems; puedes llamar:
//   Entities.NurseSexy.spawn(x,y,{tile:true})  // x,y en tiles si tile:true
//   // o via placement.api -> Entities.NPC.spawn('enfermera_sexy', x,y, p)

(function (W) {
  'use strict';

  // ====== Entorno y constantes =========================================================
  const G = W.G || (W.G = {});
  const ENT = (function () {
    const e = W.ENT || (W.ENT = {});
    e.ENFERMERA_SEXY   = e.ENFERMERA_SEXY   || 812;
    e.ENEMY_RAT        = e.ENEMY_RAT        || 301;
    e.ENEMY_MOSQUITO   = e.ENEMY_MOSQUITO   || 302;
    e.PACIENTE_FURIOSO = e.PACIENTE_FURIOSO || 401;
    e.DOOR             = e.DOOR             || 30;
    e.WALL             = e.WALL             || 31;
    e.PATIENT          = e.PATIENT          || 51;
    return e;
  })();

  const TILE = (typeof W.TILE_SIZE === 'number') ? W.TILE_SIZE : (W.TILE || 32);

  function tryAttachFlashlight(e){
    if (!e || e.flashlight === false || e._flashlightAttached) return;
    const attach = W.Entities?.attachFlashlight;
    if (typeof attach !== 'function') return;
    try {
      const radius = Number.isFinite(e.flashlightRadius) ? e.flashlightRadius : TILE * 4.8;
      const intensity = Number.isFinite(e.flashlightIntensity) ? e.flashlightIntensity : 0.55;
      const color = e.flashlightColor || '#fff2c0';
      const id = attach(e, { color, radius, intensity });
      if (id != null){
        e._flashlightAttached = true;
        e._flashlightId = id;
      }
    } catch (err){
      try { console.warn('[NurseSexy] No se pudo adjuntar linterna', err); } catch (_) {}
    }
  }

  // ====== Utilidades ==================================================================
  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const randf = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const toTx = (px) => Math.max(0, Math.floor(px / TILE));
  const toTy = (py) => Math.max(0, Math.floor(py / TILE));
  const toPx = (tx) => tx * TILE;
  const toPy = (ty) => ty * TILE;
  const nowSec = () => (performance.now() / 1000);

  function push(list, e){ if (list && e && !list.includes?.(e)) list.push(e); }

  // Grids
  function getGrid(){
    // 1=pared, 0=suelo: compat con tu core
    return G.collisionGrid || G.map || [];
  }
  function inb(g, x, y) { const H=g.length, Wd=g[0]?.length||0; return y>=0 && y<H && x>=0 && x<Wd; }
  function isWallAtPx(px, py, w, h) {
    const g = getGrid(); if (!g.length) return false;
    const ax = toTx(px), ay = toTy(py), bx = toTx(px + (w||TILE) - 1), by = toTy(py + (h||TILE) - 1);
    for (let ty = ay; ty <= by; ty++) for (let tx = ax; tx <= bx; tx++) {
      if (!inb(g, tx, ty)) return true;
      if (g[ty][tx] === 1) return true;
    }
    return false;
  }

  // Hazards (opt.)
  function isFireTile(tx, ty){
    // Si existe HazardsAPI o mapa de peligros, úsalo:
    if (W.HazardsAPI?.isFireTile) return !!W.HazardsAPI.isFireTile(tx,ty);
    // Fallback: si guardas “fuego” en G.hazards.fireTiles como Set<string> "x,y"
    const key = tx+','+ty;
    if (G.hazards?.fireTiles?.has?.(key)) return true;
    return false;
  }
  function isWetTile(tx, ty){
    if (W.HazardsAPI?.isWetTile) return !!W.HazardsAPI.isWetTile(tx,ty);
    const key = tx+','+ty;
    if (G.hazards?.wetTiles?.has?.(key)) return true;
    return false;
  }

  // ====== Pathfinder (BFS en 4-dir con costes blandos para evitar hazards) =============
  const N4 = [[1,0],[-1,0],[0,1],[0,-1]];
  function bfsPath(start, goal, opts={}){
    const g = getGrid(); const H=g.length, Wd=g[0]?.length||0;
    if (!H || !Wd) return null;
    const s = { x: clamp(start.x|0, 0, Wd-1), y: clamp(start.y|0, 0, H-1) };
    const t = { x: clamp(goal.x|0, 0, Wd-1), y: clamp(goal.y|0, 0, H-1) };
    if (g[t.y]?.[t.x] === 1) return null; // objetivo bloqueado

    // cola y visited con “coste” (preferimos tiles seguros)
    const q = [s], prev = new Map(); // key "x,y" -> anterior "x,y"
    const cost = Array.from({length:H},()=>Array(Wd).fill(Infinity));
    cost[s.y][s.x] = 0;

    function k(x,y){ return x+','+y; }
    while(q.length){
      const cur = q.shift();
      if (cur.x===t.x && cur.y===t.y) break;

      for (const [dx,dy] of N4){
        const nx = cur.x+dx, ny = cur.y+dy;
        if (!inb(g, nx, ny) || g[ny][nx]===1) continue;

        // Penaliza peligros: evita fuego (mucha penalización) y charco (algo)
        let step = 1;
        if (isFireTile(nx,ny)) step += 50;      // casi prohibido
        if (isWetTile(nx,ny))  step += 4;       // mejor evitar
        // (puedes añadir más capas aquí)

        const nc = cost[cur.y][cur.x] + step;
        if (nc < cost[ny][nx]){
          cost[ny][nx] = nc;
          prev.set(k(nx,ny), k(cur.x,cur.y));
          q.push({x:nx,y:ny});
        }
      }
    }

    if (!prev.has(k(t.x,t.y))) return null; // sin camino
    const path = [];
    let curK = k(t.x,t.y);
    while (curK !== k(s.x,s.y)){
      const [cx,cy] = curK.split(',').map(n=>+n);
      path.push({x:cx,y:cy});
      curK = prev.get(curK);
    }
    path.reverse();
    return path;
  }

  // ====== Config de IA ================================================================
  const CFG = {
    speedPx: 86,
    interactRadiusPx: TILE * 1.6,
    healThreshold: 0.60,     // si el jugador ≤ 60% se prioriza curar
    healAmt: 1,
    talkCooldown: 10,
    helpCooldown: 12,
    replanEvery: 0.8,        // seg entre recalcular camino
    stuckRepath: 1.2,        // seg sin avanzar -> repath
    light: { color: 'rgba(255,120,180,0.66)', radius: TILE * 3.6 },
    perfume: {
      radius: TILE * 3.2,
      pushPerSecond: 170,
      cooldown: 0.6,
      affectsKinds: [ENT.ENEMY_RAT, ENT.ENEMY_MOSQUITO, ENT.PACIENTE_FURIOSO]
    },
    doorOpenRadius: 1.1,         // en tiles
    avoidPlayerDoorBlock: true,  // no quedarse en cuellos
    // prioridades
    prio: {
      assistPlayer: true,
      assistPatients: true,
      patrol: true
    }
  };

  // ====== Estado interno ==============================================================
  const S = {
    nurses: [],
    lightIds: new Map()
  };

  // ====== Núcleo de entidad ===========================================================
  function create(x, y, props={}){
    const px = props.tile ? toPx(x) + 2 : Math.round(x);
    const py = props.tile ? toPy(y) + 2 : Math.round(y);
    const e = {
      id: 'nurse_' + Math.random().toString(36).slice(2),
      kind: ENT.ENFERMERA_SEXY,
      x: px, y: py, w: Math.round(TILE * 0.88), h: Math.round(TILE * 0.92),
      vx: 0, vy: 0,
      spriteKey: 'nurse_sexy',
      color: '#ff6aa2',
      skin: 'enfermera_sexy.png',
      pushable: false,
      mass: 1.0, rest: 0.10, mu: 0.12,
      // IA
      ai: {
        mode: 'patrol',       // 'patrol' | 'assist_player' | 'assist_patient'
        targetTx: toTx(px), targetTy: toTy(py),
        spawnTx:  toTx(px), spawnTy:  toTy(py),
        patrolR:  Math.max(4, props.patrolRadiusTiles|0 || 5),
        path: null, pathIdx: 0,
        nextPlanAt: 0,
        lastPos: {x:px, y:py, t:nowSec()},
        lastPerfume: 0,
        talkCD: 0, helpCD: 0
      },
      aiId: 'NURSE',
      // Interacción
      onInteract: (player) => onTalk(e, player)
    };
    try { window.AI?.attach?.(e, 'NURSE'); } catch (_) {}
    return e;
  }

  function ensureOnArrays(e){
    push(G.entities || (G.entities=[]), e);
    e.group = 'human';
    try { window.EntityGroups?.assign?.(e); } catch (_) {}
    try { window.EntityGroups?.register?.(e, G); } catch (_) {}
  }

  // ====== Luz / iluminación ===========================================================
  function attachLight(e){
    if (!W.LightingAPI || !CFG.light) return;
    try{
      const id = W.LightingAPI.addLight({
        x: e.x + e.w/2, y: e.y + e.h/2,
        radius: CFG.light.radius,
        color: CFG.light.color,
        owner: e.id
      });
      S.lightIds.set(e.id, id);
      e._onDestroy = e._onDestroy || [];
      e._onDestroy.push(()=>{ try{ W.LightingAPI.removeLight(id); }catch(_){}; });
    }catch(_){}
  }
  function updateLight(e){
    if (!e || e._inactive) return;
    const id = S.lightIds.get(e.id);
    if (id!=null && W.LightingAPI) {
      try{ W.LightingAPI.updateLight(id, {x:e.x+e.w/2, y:e.y+e.h/2}); }catch(_){}
    }
  }

  // ====== Puertas (abrir si bloquean) =================================================
  function tryOpenNearbyDoor(e){
    if (!W.Entities?.Door?.open && !W.Entities?.Door?.toggle) return;
    const tx = toTx(e.x + e.w/2), ty = toTy(e.y + e.h/2);
    const rad = Math.ceil(CFG.doorOpenRadius);
    for (let dy=-rad; dy<=rad; dy++){
      for (let dx=-rad; dx<=rad; dx++){
        const nx=tx+dx, ny=ty+dy;
        const d = findDoorAt(nx, ny);
        if (d){
          if (typeof W.Entities.Door.open === 'function') W.Entities.Door.open(d, {by:'nurse'});
          else if (typeof W.Entities.Door.toggle === 'function') W.Entities.Door.toggle(d, {by:'nurse'});
        }
      }
    }
  }
  function findDoorAt(tx,ty){
    const ex = toPx(tx), ey = toPy(ty);
    for (const o of (G.entities||[])){
      if (o.kind===ENT.DOOR){
        if (o.x<=ex+1 && o.y<=ey+1 && (o.x+o.w)>=ex+TILE-1 && (o.y+o.h)>=ey+TILE-1) return o;
      }
    }
    return null;
  }

  // ====== Percepción =================================================================
  function nearestPatientNeedingHelp(e, maxTiles=8){
    const r2 = Math.pow(maxTiles*TILE, 2);
    let best=null, bd=Infinity;
    for (const o of (G.patients||G.entities||[])){
      if (!o || o.kind!==ENT.PATIENT) continue;
      // Si tienes sistema de “furiosa”, evita acercarse y deja al perfume actuar
      const dx=(o.x+o.w/2)-(e.x+e.w/2), dy=(o.y+o.h/2)-(e.y+e.h/2);
      const d2=dx*dx+dy*dy; if(d2>r2) continue;
      if (d2<bd){ bd=d2; best=o; }
    }
    return best;
  }
  function playerNeedsHeal(){
    const p = G.player; if (!p || p.dead) return false;
    const hp = (p.hp!=null ? p.hp : (p.hearts ?? p.heartsMax));
    const hm = (p.hpMax!=null ? p.hpMax : (p.heartsMax ?? 5));
    if (!hm) return false;
    const ratio = hp / hm;
    return ratio <= CFG.healThreshold;
  }

  // ====== Planner de alto nivel ======================================================
  function plan(e){
    const ai = e.ai;
    const t = nowSec();
    if (t < ai.nextPlanAt) return;
    ai.nextPlanAt = t + CFG.replanEvery;

    // 1) ¿Jugador necesita ayuda?
    if (CFG.prio.assistPlayer && playerNeedsHeal()){
      ai.mode = 'assist_player';
      ai.path = null;
      return;
    }

    // 2) ¿Algún paciente cercano al que acercarse?
    if (CFG.prio.assistPatients){
      const p = nearestPatientNeedingHelp(e, 10);
      if (p){
        ai.mode = 'assist_patient';
        ai.targetTx = toTx(p.x+p.w/2); ai.targetTy = toTy(p.y+p.h/2);
        ai.path = null;
        return;
      }
    }

    // 3) Patrulla alrededor de su spawn
    ai.mode = 'patrol';
    const ang = randf(0, Math.PI*2);
    const rad = (ai.patrolR * TILE) * randf(0.35, 0.95);
    ai.targetTx = toTx(ai.spawnTx*TILE + Math.cos(ang)*rad);
    ai.targetTy = toTy(ai.spawnTy*TILE + Math.sin(ang)*rad);
    ai.path = null;
  }

  // ====== Path y movimiento ===========================================================
  function ensurePath(e, destTx, destTy){
    const ai=e.ai;
    const sx=toTx(e.x+e.w/2), sy=toTy(e.y+e.h/2);
    ai.path = bfsPath({x:sx,y:sy}, {x:destTx,y:destTy}) || null;
    ai.pathIdx = 0;
  }
  function stepAlongPath(e, dt){
    const ai=e.ai;
    if (!ai.path || ai.pathIdx>=ai.path.length) return false;
    const step = ai.path[ai.pathIdx];
    const tx = step.x, ty = step.y;
    const gx = tx*TILE + TILE/2, gy = ty*TILE + TILE/2;
    const done = moveTowardsPx(e, gx, gy, dt);
    if (done || dist2(e.x+e.w/2, e.y+e.h/2, gx, gy) < 9*9) ai.pathIdx++;
    // si nos atascamos mucho, replan
    const t = nowSec();
    const dMove = Math.hypot(e.x - ai.lastPos.x, e.y - ai.lastPos.y);
    if (t - ai.lastPos.t > CFG.stuckRepath){
      if (dMove < 2) ai.path = null;
      ai.lastPos.x = e.x; ai.lastPos.y = e.y; ai.lastPos.t = t;
    }
    return true;
  }
  function moveTowardsPx(e, gx, gy, dt){
    const dx = gx - (e.x+e.w/2);
    const dy = gy - (e.y+e.h/2);
    const L = Math.max(1, Math.hypot(dx,dy));
    const sp = CFG.speedPx;
    const vx = (dx/L)*sp*dt;
    const vy = (dy/L)*sp*dt;

    let nx = e.x + vx, ny = e.y;
    if (isWallAtPx(nx, ny, e.w, e.h)) {
      nx = e.x;
      ny = e.y + vy;
      if (isWallAtPx(nx, ny, e.w, e.h)) {
        // busca “peinar” bordes
        const sx = Math.sign(vx || 0.0001);
        const sy = Math.sign(vy || 0.0001);
        if (!isWallAtPx(e.x + sx, e.y, e.w, e.h)) e.x += sx;
        if (!isWallAtPx(e.x, e.y + sy, e.w, e.h)) e.y += sy;
      } else {
        e.y = ny;
      }
    } else {
      e.x = nx;
      ny = e.y + vy;
      if (!isWallAtPx(e.x, ny, e.w, e.h)) e.y = ny;
    }
    return (L < 1.5);
  }

  // ====== Perfume (repelente) =========================================================
  function perfumeRepel(e, dt){
    const ai = e.ai;
    const t = nowSec();
    if (t < ai.lastPerfume + CFG.perfume.cooldown) return;
    const r = CFG.perfume.radius, r2 = r*r, push = CFG.perfume.pushPerSecond;

    let did=false;
    for (const o of (G.entities||[])){
      if (!o || o===e) continue;
      if (!CFG.perfume.affectsKinds.includes(o.kind)) continue;
      const dx=(o.x+o.w/2)-(e.x+e.w/2), dy=(o.y+o.h/2)-(e.y+e.h/2);
      const d2=dx*dx+dy*dy; if (d2>r2 || d2<1) continue;
      const L=Math.sqrt(d2), ux=dx/L, uy=dy/L;
      o.vx = (o.vx||0) + ux * push * dt;
      o.vy = (o.vy||0) + uy * push * dt;
      did=true;
    }
    if (did){
      ai.lastPerfume = t;
      try { G.Audio?.playSfx?.('perfume'); } catch(_){}
    }
  }

  // ====== Curación & Turbo ============================================================
  function tryAmbientHeal(e){
    const p = G.player; if (!p) return;
    const r2 = (CFG.interactRadiusPx*CFG.interactRadiusPx);
    if (dist2(p.x+p.w/2, p.y+p.h/2, e.x+e.w/2, e.y+e.h/2) <= r2){
      giveHeal(e, p);
    }
  }
  function giveHeal(e, p){
    if (!p || p.dead) return;
    // HUD estándar (hp/hpMax) o sistema de corazones (hearts/heartsMax)
    if (p.hpMax!=null){
      p.hp = clamp((p.hp ?? p.hpMax) + CFG.healAmt, 0, p.hpMax);
    } else if (p.heartsMax!=null) {
      p.hearts = clamp((p.hearts ?? p.heartsMax) + CFG.healAmt, 0, p.heartsMax);
    }
    try { G.Audio?.playSfx?.('heal'); } catch(_){}
  }
  function giveSpeed(e, p) {
    if (!p) return;
    try { G.Audio?.playSfx?.('powerup'); } catch(_){}
    const now = nowSec();
    p._tempBuffs = p._tempBuffs || {};
    p._tempBuffs.speedMul = { value: 1.35, until: now + 12 };
  }

  // ====== Interacción (E) =============================================================
  let _keyE=false;
  W.addEventListener('keydown', ev => { if (ev.key==='e'||ev.key==='E') _keyE=true;  }, {passive:true});
  W.addEventListener('keyup',   ev => { if (ev.key==='e'||ev.key==='E') _keyE=false; }, {passive:true});
  function isActionPressed(){ return _keyE || !!(G.keys && (G.keys.e||G.keys.E)); }

  function onTalk(e, player){
    const ai = e.ai; if (ai.talkCD>0) return;
    ai.talkCD = CFG.talkCooldown;

    const line = '¿Necesitas mimos sanitarios? 💕 Puedo curarte o darte turbo.';
    const doHeal = ()=> giveHeal(e, player);
    const doTurbo= ()=> giveSpeed(e, player);

    if (W.DialogAPI?.open){
      W.DialogAPI.open({
        title:'Enfermera',
        text: line,
        buttons: [
          {id:'heal',  label:'Curita ❤️', action:doHeal},
          {id:'turbo', label:'Turbo 💨',  action:doTurbo},
          {id:'ok',    label:'Gracias ✨', action:()=>W.DialogAPI.close?.()}
        ],
        pauseGame:true
      });
    } else {
      const c = W.prompt('[Enfermera]\n1) Curita ❤️\n2) Turbo 💨\n3) Gracias', '1');
      const n = parseInt(c||'3',10);
      if (n===1) doHeal(); else if (n===2) doTurbo();
    }
  }

  function tryInteractNearest(){
    const p = G.player; if (!p) return false;
    let best=null, bd2=Infinity;
    for (const e of S.nurses){
      const d2 = dist2(p.x+p.w/2,p.y+p.h/2, e.x+e.w/2, e.y+e.h/2);
      if (d2<bd2){ bd2=d2; best=e; }
    }
    if (!best) return false;
    const r2 = CFG.interactRadiusPx*CFG.interactRadiusPx;
    if (bd2<=r2){ onTalk(best, p); return true; }
    return false;
  }

  // ====== Update general del sistema =================================================
  function update(dt){
    if (G.state && G.state!=='PLAYING') return;
    for (const e of S.nurses){
      if (!e || e._inactive) continue;
      const ai = e.ai;
      // perfumito contra amenazas
      perfumeRepel(e, dt);
      // curación pasiva si el jugador está cerca
      tryAmbientHeal(e);
      // interacción manual
      if (ai.talkCD>0) ai.talkCD -= dt;
      if (ai.helpCD>0) ai.helpCD -= dt;
      if (isActionPressed()){
        // solo abre diálogo si realmente estás cerca
        const p=G.player;
        if (p && dist2(p.x+p.w/2,p.y+p.h/2, e.x+e.w/2, e.y+e.h/2) <= (CFG.interactRadiusPx*CFG.interactRadiusPx)){
          onTalk(e, p);
        }
      }

      // planificar alto nivel
      plan(e);

      // comportamiento según modo
      if (ai.mode === 'assist_player' && G.player){
        const gx = toTx(G.player.x+G.player.w/2), gy = toTy(G.player.y+G.player.h/2);
        if (!ai.path) ensurePath(e, gx, gy);
        if (!stepAlongPath(e, dt)) moveTowardsPx(e, G.player.x+G.player.w/2, G.player.y+G.player.h/2, dt);
        tryOpenNearbyDoor(e);
      }
      else if (ai.mode === 'assist_patient'){
        if (!ai.path) ensurePath(e, ai.targetTx, ai.targetTy);
        if (!stepAlongPath(e, dt)) moveTowardsPx(e, ai.targetTx*TILE+TILE/2, ai.targetTy*TILE+TILE/2, dt);
        tryOpenNearbyDoor(e);
      }
      else { // patrol
        if (!ai.path) ensurePath(e, ai.targetTx, ai.targetTy);
        if (!stepAlongPath(e, dt)){
          // llegó — el planner ya asignará otra diana
        }
        tryOpenNearbyDoor(e);
      }

      updateLight(e);
    }
  }

  // ====== API público ================================================================
  const API = {
    init(GIn){
      if (GIn && GIn!==G) Object.assign(G, GIn);
      if (!G.systems) G.systems = [];
      if (!G._nurseSexySystem){
        G.systems.push({ id:'nurse_sexy', update:(dt)=>update(dt) });
        G._nurseSexySystem = true;
      }
      return this;
    },
    update,
    spawn(x,y,props={}){
      const e = create(x,y,props);
      ensureOnArrays(e);
      try {
        const puppet = window.Puppet?.bind?.(e, 'npc_enfermera_sexy', { z: 0, scale: 1, data: { skin: e.skin } })
          || window.PuppetAPI?.attach?.(e, { rig: 'npc_enfermera_sexy', z: 0, scale: 1, data: { skin: e.skin } });
        e.rigOk = e.rigOk === true || !!puppet;
      } catch (_) {
        e.rigOk = e.rigOk === true;
      }
      tryAttachFlashlight(e);
      attachLight(e);
      return e;
    },
    getAll(){ return S.nurses.slice(); },
    tryInteractNearest
  };

  // ====== Registro en window.Entities ===============================================
  W.Entities = W.Entities || {};
  W.Entities.NurseSexy = API;

  // Hook seguro para placement.api → Entities.NPC.spawn('enfermera_sexy', …)
  (function hookNPCSpawn(){
    W.Entities.NPC = W.Entities.NPC || {};
    const prev = W.Entities.NPC.spawn;
    W.Entities.NPC.spawn = function(sub, x, y, p){
      const key = String(sub || p?.sub || '').toLowerCase();
      if (key==='enfermera_sexy' || key==='nurse_sexy' || key==='enfermera'){
        return W.Entities.NurseSexy.spawn(x, y, { tile: !(p && p._units==='px') });
      }
      if (typeof prev === 'function') return prev.call(this, sub, x, y, p);
      return null;
    };
  })();

  // Auto-init
  API.init(G);

})(this);