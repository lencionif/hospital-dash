// filename: elevators.entities.js
// Ascensores emparejados controlados por el jugador.
// Al pulsar E sobre un ascensor, teletransporta al instante TODO lo que esté
// pisando al ascensor emparejado correspondiente, recolocando alrededor para
// evitar paredes y solapes. Las parejas quedan fijas tras el arranque.
//
// API clave:
//   Entities.Elevator.spawn(x, y, { pairId?, active?, locked? })
//   Entities.Elevator.update(dt)
//
// Notas:
// - Soporta coords en píxeles (placement.api.js ya envía px).
// - Si no llega pairId, auto-asigna (A,B,C,...) y empareja de dos en dos por cercanía.
// - Llama a Entities.Elevator.update(dt) en tu loop de juego.
// - Cooldown global entre activaciones: 600s (10 min). Pareja al azar cada ciclo.
// - Se puede forzar con Entities.Elevator.forceActivate(pairId).

(function () {
  'use strict';
  const W    = window;
  const G    = W.G || (W.G = {});
  const TILE = (typeof W.TILE_SIZE !== 'undefined') ? W.TILE_SIZE : (W.TILE || 32);

  // ---------- Estado interno ----------
  const S = {
    list: [],                // todos los ascensores (objetos-ascensor)
    pairs: Object.create(null), // pairId -> [e1,e2]
    freeIds: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    frozen: false,           // cuando true, ya no se reasignan parejas
    time: 0,                 // reloj en segundos (acumulado por update(dt))
    allowObjects: true,      // mueve también carros / items / NPCs
    interactBound: false,
  };

  const BUSY_SECONDS = 1.1;
  const OPEN_CLOSE_SECONDS = 0.5;

  // ---------- Utilidades ----------
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function aabb(a,b){ return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y; }
  function isWallAt(x,y,w,h){
    if (typeof W.isWallAt === 'function') return !!W.isWallAt(x,y,w,h);
    // Fallback con grid (0 libre / 1 muro)
    const map = G.map; if (!map) return false;
    const x1 = Math.floor(x/TILE), y1 = Math.floor(y/TILE);
    const x2 = Math.floor((x+w-1)/TILE), y2 = Math.floor((y+h-1)/TILE);
    for (let ty=y1; ty<=y2; ty++){
      for (let tx=x1; tx<=x2; tx++){
        if (map[ty]?.[tx] === 1) return true;
      }
    }
    return false;
  }
  function inBounds(x,y){ 
    const H = G.map?.length|0, Wd = G.map?.[0]?.length|0;
    return x>=0 && y>=0 && x < Wd*TILE && y < H*TILE;
  }
  function shove(entity, impulse=18){
    const ang = Math.random()*Math.PI*2;
    entity.vx = (entity.vx||0) + Math.cos(ang)*impulse;
    entity.vy = (entity.vy||0) + Math.sin(ang)*impulse;
  }

  // Lista de entidades “candidatas a viajar”
  function candidatesOver(elev){
    const out = [];
    const list = (S.allowObjects ? (G.movers || G.entities || []) : [G.player].filter(Boolean));
    for (const ent of list){
      if (!ent || ent.dead) continue;
      // ascensor es walkable (no sólido): si lo pisa → viaja
      if (aabb(ent, elev)) out.push(ent);
    }
    return out;
  }

  // Busca posición libre alrededor de (tx,ty) con radio en tiles
  function placeAroundTile(ent, tx, ty){
    const tried = new Set();
    const maxR = 3; // 3 tiles alrededor suelen bastar
    for (let r=1; r<=maxR; r++){
      for (let dy=-r; dy<=r; dy++){
        for (let dx=-r; dx<=r; dx++){
          // borde del anillo (no el interior)
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const wx = Math.floor(tx*TILE + dx*TILE + (TILE-ent.w)/2);
          const wy = Math.floor(ty*TILE + dy*TILE + (TILE-ent.h)/2);
          const key = (wx|0)<<16 ^ (wy|0); if (tried.has(key)) continue;
          tried.add(key);

          if (!inBounds(wx, wy)) continue;
          if (isWallAt(wx, wy, ent.w|0, ent.h|0)) continue;

          // evitar solapes con otras entidades ya colocadas
          let coll = false;
          const rect = { x:wx, y:wy, w:ent.w|0, h:ent.h|0 };
          for (const other of (G.entities||[])){
            if (!other || other===ent || other.dead) continue;
            if (aabb(rect, other)) { coll = true; break; }
          }
          if (coll) continue;

          // posición válida encontrada
          return { x: wx, y: wy };
        }
      }
    }
    // si no hay hueco alrededor, deja en el centro del tile (último recurso)
    return { x: Math.floor(tx*TILE + (TILE-ent.w)/2), y: Math.floor(ty*TILE + (TILE-ent.h)/2) };
  }

  function findElevatorUnder(ent){
    if (!ent) return null;
    for (const elev of S.list){
      if (!elev || elev.dead) continue;
      if (aabb(ent, elev)) return elev;
    }
    return null;
  }

  function ensureInteractBinding(){
    if (S.interactBound) return;
    const G = window.G || (window.G = {});
    if (!Array.isArray(G.onInteract)) G.onInteract = [];
    const handler = (player) => {
      const elev = findElevatorUnder(player);
      if (!elev) return false;
      return travel(elev, player);
    };
    G.onInteract.unshift(handler);
    S.interactBound = true;
    S._interactHandler = handler;
  }

  // ---------- Objeto-ascensor ----------
  function makeElevator(x, y, opts={}){
    const e = {
      kind: (G.ENT && (G.ENT.ELEVATOR||'elevator')) || 'elevator',
      x: x|0, y: y|0, w:TILE, h:TILE,
      vx:0, vy:0,
      color: '#64748b',
      walkable: true, solid:false, static:true,
      pairId: opts.pairId || null,
      pairRef: null,
      active: false,
      locked: !!opts.locked,
      busyUntil: 0,
      lightState: 'ready',
      _pulse: 0,
      isPaired: false,
      aiId: 'ELEVATOR',
      draw: null,
      state: { open: false, openProgress: 0 },
      open: false
    };
    try { W.AI?.attach?.(e, 'ELEVATOR'); } catch (_) {}

    // pinta “semáforo” simple si no hay SpriteManager
    e.draw = function(ctx){
      if (!ctx) return;
      const ls = e.locked ? 'locked' : (e.lightState || 'ready');
      const mainColor = e.locked ? '#6b7280' : '#475569';
      const lightColor = ls === 'busy' ? '#f87171'
        : ls === 'locked' ? '#9ca3af'
        : '#34d399';
      const pulse = (e._pulse || 0);
      const blink = (ls === 'busy') ? (0.5 + 0.5 * Math.sin(pulse * 4)) : 1;
      ctx.save();
      ctx.fillStyle = mainColor;
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(e.x + e.w*0.2, e.y + e.h*0.25, e.w*0.6, e.h*0.18);
      ctx.fillRect(e.x + e.w*0.42, e.y + e.h*0.43, e.w*0.16, e.h*0.42);
      ctx.beginPath();
      ctx.fillStyle = lightColor;
      ctx.globalAlpha = blink;
      ctx.arc(e.x + e.w*0.5, e.y + e.h*0.16, e.w*0.18, 0, Math.PI*2);
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#e5e7eb';
      ctx.font = '10px monospace';
      ctx.fillText('EV ' + (e.pairId||'?'), e.x+4, e.y+e.h-4);
      ctx.restore();
    };

    try {
      const puppet = window.Puppet?.bind?.(e, 'elevator', { z: 0, scale: 1 })
        || window.PuppetAPI?.attach?.(e, { rig: 'elevator', z: 0, scale: 1 });
      if (puppet) {
        e.puppet = puppet;
        e.rig = puppet;
      }
      e.rigOk = e.rigOk === true || !!puppet;
    } catch (_) {
      e.rigOk = e.rigOk === true;
    }

    return e;
  }

  // ---------- Emparejado ----------
  function _ensurePairId(e){
    if (e.pairId) return;
    // auto-asigna letras de dos en dos (A, A, B, B, C, C…)
    // estrategia: si hay una letra “en uso impar”, completa la pareja; si no, coge nueva
    const countById = {};
    for (const it of S.list){ if (!it.pairId) continue; countById[it.pairId]=(countById[it.pairId]||0)+1; }
    let idToUse = null;
    for (const [pid,c] of Object.entries(countById)){
      if (c===1){ idToUse = pid; break; }
    }
    if (!idToUse){
      idToUse = S.freeIds.shift() || ('P'+(Object.keys(S.pairs).length+1));
    }
    e.pairId = idToUse;
  }

  function _indexPair(e){
    if (!e.pairId) return;
    const arr = (S.pairs[e.pairId] = S.pairs[e.pairId] || []);
    if (!arr.includes(e)) arr.push(e);
    if (arr.length === 2){
      arr[0].pairRef = arr[1];
      arr[1].pairRef = arr[0];
      arr[0].isPaired = true;
      arr[1].isPaired = true;
    }
  }

  function _finalizePairsOnce(){
    if (S.frozen) return;
    const alive = S.list.filter(e => e && !e.dead);
    // si hay impares, empareja por cercanía dentro de las que no tienen pairId
    const unpaired = alive.filter(e => !e.pairId);
    if (unpaired.length){
      // muy simple: orden por X,Y y empareja de dos en dos
      unpaired.sort((a,b)=> (a.x+a.y*1e-3) - (b.x+b.y*1e-3));
      for (let i=0; i<unpaired.length; i+=2){
        const a = unpaired[i], b = unpaired[i+1];
        if (!b){
          console.warn('[Elevators] Ascensor sin pareja, quedará fuera de servicio.', a);
          a.isPaired = false;
          a.locked = true;
          continue;
        }
        const id = S.freeIds.shift() || ('P'+(Object.keys(S.pairs).length+1));
        a.pairId = id; b.pairId = id;
      }
    }
    // re-indexa
    S.pairs = Object.create(null);
    for (const e of alive){
      _indexPair(e);
    }
    // marca pares incompletos como bloqueados
    for (const id of Object.keys(S.pairs)){
      const arr = S.pairs[id];
      if (!Array.isArray(arr)) continue;
      if (arr.length !== 2){
        for (const elev of arr){
          elev.isPaired = false;
          elev.pairRef = null;
          elev.locked = true;
          elev.lightState = 'locked';
        }
      }
    }
    S.frozen = true; // ¡parejas fijadas!
  }

  // ---------- Activación & teletransporte ----------
  function markBusy(elev){
    if (!elev) return;
    const now = S.time || 0;
    const base = Number.isFinite(elev.busyUntil) ? elev.busyUntil : 0;
    elev.busyUntil = Math.max(base, now + BUSY_SECONDS);
    elev.state = elev.state || { open: false, openProgress: 0 };
    elev.state.open = true;
    elev.lightState = elev.locked ? 'locked' : 'busy';
    elev.active = true;
  }

  function notify(msg){
    if (!msg) return;
    try { W.DialogAPI?.system?.(msg, { ms: 2400 }); }
    catch(_) { console.info('[Elevators]', msg); }
  }

  function travel(elevatorEnt, activator){
    if (!elevatorEnt) return false;
    ensureInteractBinding();
    if (!S.frozen) _finalizePairsOnce();
    if (elevatorEnt.locked){
      notify('Este ascensor está fuera de servicio.');
      return true;
    }
    if (!elevatorEnt.pairId || !S.pairs[elevatorEnt.pairId] || S.pairs[elevatorEnt.pairId].length !== 2){
      notify('El ascensor no tiene pareja asignada.');
      return true;
    }
    const moved = _teleportNowPair(elevatorEnt.pairId);
    if (moved <= 0){
      // Incluso si nadie viaja, mostrar feedback de activación
      markBusy(elevatorEnt);
      markBusy(elevatorEnt.pairRef);
      try { W.AudioAPI?.play?.('door_open', { volume: 0.55, tag: 'elevator_door' }); } catch(_){}
      try { W.AudioAPI?.play?.('ui_click', { volume: 0.8, tag: 'elevator_ding' }); } catch(_){}
    }
    return true;
  }

  function _teleportNowPair(pairId){
    const pair = S.pairs[pairId]; if (!pair || pair.length!==2) return 0;
    const [a,b] = pair;
    if (a.locked || b.locked) return 0;

    // recoge candidatos pisando cada plataforma
    const A = candidatesOver(a);
    const B = candidatesOver(b);

    let moved = 0;

    // de A -> B (alrededores de tile de B)
    const btx = Math.floor(b.x / TILE), bty = Math.floor(b.y / TILE);
    for (const ent of A){
      const pos = placeAroundTile(ent, btx, bty);
      try { W.MovementSystem?.allowTeleport?.(ent, { reason: 'elevator' }); } catch (_) {}
      ent.x = pos.x; ent.y = pos.y;
      shove(ent, 16);
      moved++;
    }

    // de B -> A
    const atx = Math.floor(a.x / TILE), aty = Math.floor(a.y / TILE);
    for (const ent of B){
      const pos = placeAroundTile(ent, atx, aty);
      try { W.MovementSystem?.allowTeleport?.(ent, { reason: 'elevator' }); } catch (_) {}
      ent.x = pos.x; ent.y = pos.y;
      shove(ent, 16);
      moved++;
    }

    markBusy(a);
    markBusy(b);

    try { W.AudioAPI?.play?.('door_open', { volume: 0.7, tag: 'elevator_door' }); } catch(_){}
    try { W.AudioAPI?.play?.('ui_click', { volume: 0.9, tag: 'elevator_ding' }); } catch(_){}
    return moved;
  }

  // ---------- API pública ----------
  const API = {
    // Crea un ascensor en (x,y) px. Se recomienda enviar pairId desde el MapGen si ya lo tienes.
    spawn(x, y, opts={}){
      const e = makeElevator(x, y, opts);
      if (!Array.isArray(G.entities)) G.entities = [];
      if (!Array.isArray(G.elevators)) G.elevators = [];
      ensureInteractBinding();
      G.entities.push(e);
      if (!G.elevators.includes(e)) G.elevators.push(e);
      S.list.push(e);
      S.frozen = false;
      window.MovementSystem?.register?.(e);
      _ensurePairId(e);
      _finalizePairsOnce();
      return e;
    },

    // Llamar cada frame (dt en segundos)
    update(dt){
      if (!Number.isFinite(dt)) return;
      ensureInteractBinding();
      // Primera pasada tras el poblamiento: congela parejas
      if (!S.frozen) _finalizePairsOnce();

      // Reloj global
      S.time += dt;
      const speed = (dt <= 0) ? 0 : clamp(dt / OPEN_CLOSE_SECONDS, 0, 1);
      for (const elev of S.list){
        if (!elev || elev.dead) continue;
        elev.state = elev.state || { open: false, openProgress: 0 };
        const st = elev.state;
        const busyRemaining = Math.max(0, (Number.isFinite(elev.busyUntil) ? elev.busyUntil : 0) - S.time);
        if (busyRemaining > 0) {
          st.open = true;
        } else if (!elev.manualHold) {
          st.open = false;
          elev.active = false;
        }
        if (speed > 0){
          st.openProgress += (st.open ? speed : -speed);
          if (st.openProgress < 0) st.openProgress = 0;
          if (st.openProgress > 1) st.openProgress = 1;
        }
        elev.open = st.openProgress >= 0.65;
        elev.lightState = elev.locked ? 'locked'
          : (busyRemaining > 0 ? 'busy' : 'ready');
        elev._pulse = (elev._pulse || 0) + dt * (elev.lightState === 'busy' ? 6 : 2);
        if (elev._pulse > Math.PI * 4) elev._pulse -= Math.PI * 4;
      }
    },

    // Fuerza activación inmediata de una pareja concreta (para debug)
    forceActivate(pairId){
      if (!pairId) return false;
      if (!S.frozen) _finalizePairsOnce();
      return _teleportNowPair(pairId);
    },

    // Debug / introspección
    getPairs(){ return Object.freeze({ ...S.pairs }); },
    freezePairs(){ S.frozen = true; },
    setAllowObjects(v){ S.allowObjects = !!v; },
    travel
  };

  W.Entities = W.Entities || {};
  W.Entities.Elevator = API;

})();