// filename: elevators.entities.js
// Ascensores emparejados (par a par) con activación aleatoria cada 10 minutos.
// Al activarse una pareja, teletransporta al instante TODO lo que esté pisando
// cualquiera de los dos al otro lado, recolocando alrededor para evitar paredes
// y solapes. Las parejas quedan fijas tras el arranque.
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
    nextActivationAt: 600,   // primera activación a los 600s (10 min)
    activationCooldown: 600, // 10 minutos
    allowObjects: true,      // mueve también carros / items / NPCs
  };

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
      _cooldown: 0, // local, por si alguna vez lo quieres por-ascensor
      draw: null
    };

    // pinta “semáforo” simple si no hay SpriteManager
    e.draw = function(ctx){
      if (!ctx) return;
      const state = e.locked ? 'locked' : (e.active ? 'active' : 'idle');
      ctx.save();
      ctx.fillStyle = e.locked ? '#6b7280' : (e.active ? '#22c55e' : '#64748b');
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(e.x + e.w*0.2, e.y + e.h*0.2, e.w*0.6, e.h*0.15);
      ctx.fillRect(e.x + e.w*0.45, e.y + e.h*0.35, e.w*0.1, e.h*0.45);
      // etiqueta
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#e5e7eb';
      ctx.font = '10px monospace';
      ctx.fillText('EV ' + (e.pairId||'?') + ' ' + state, e.x+3, e.y+e.h-3);
      ctx.restore();
    };

    try { window.PuppetAPI?.attach?.(e, { rig: 'elevator', z: 0, scale: 1 }); } catch (_) {}

    return e;
  }

  // ---------- Emparejado ----------
  function _ensurePairId(e){
    if (e.pairId || !S.freeIds.length) return;
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
    // si hay 2, enlaza referencias
    if (arr.length === 2){ arr[0].pairRef = arr[1]; arr[1].pairRef = arr[0]; }
  }

  function _finalizePairsOnce(){
    if (S.frozen) return;
    // si hay impares, empareja por cercanía dentro de las que no tienen pairId
    const unpaired = S.list.filter(e => !e.pairId);
    if (unpaired.length){
      // muy simple: orden por X,Y y empareja de dos en dos
      unpaired.sort((a,b)=> (a.x+a.y*1e-3) - (b.x+b.y*1e-3));
      for (let i=0; i<unpaired.length; i+=2){
        const a = unpaired[i], b = unpaired[i+1];
        if (!b) break; // uno suelto, lo dejamos sin pareja
        const id = S.freeIds.shift() || ('P'+(Object.keys(S.pairs).length+1));
        a.pairId = id; b.pairId = id;
      }
    }
    // re-indexa
    S.pairs = Object.create(null);
    for (const e of S.list){ _indexPair(e); }
    S.frozen = true; // ¡parejas fijadas!
  }

  // ---------- Activación & teletransporte ----------
  function _pickRandomReadyPairId(){
    const ids = Object.keys(S.pairs).filter(id => (S.pairs[id] && S.pairs[id].length===2));
    if (!ids.length) return null;
    return ids[(Math.random()*ids.length)|0];
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
      ent.x = pos.x; ent.y = pos.y;
      shove(ent, 16);
      moved++;
    }

    // de B -> A
    const atx = Math.floor(a.x / TILE), aty = Math.floor(a.y / TILE);
    for (const ent of B){
      const pos = placeAroundTile(ent, atx, aty);
      ent.x = pos.x; ent.y = pos.y;
      shove(ent, 16);
      moved++;
    }

    // pulso visual opcional (si tienes AudioAPI)
    try { W.AudioAPI?.play?.('elevator_warp', {vol:0.9}); } catch(_){}
    return moved;
  }

  function _activateRandomPair(){
    const id = _pickRandomReadyPairId();
    if (!id) return;
    const moved = _teleportNowPair(id);
    // log suave
    console.log('[Elevators] Activación pareja', id, '→ entidades movidas:', moved);
  }

  // ---------- API pública ----------
  const API = {
    // Crea un ascensor en (x,y) px. Se recomienda enviar pairId desde el MapGen si ya lo tienes.
    spawn(x, y, opts={}){
      const e = makeElevator(x, y, opts);
      if (!Array.isArray(G.entities)) G.entities = [];
      G.entities.push(e);
      S.list.push(e);
      _ensurePairId(e);
      _indexPair(e);
      return e;
    },

    // Llamar cada frame (dt en segundos)
    update(dt){
      if (!Number.isFinite(dt)) return;
      // Primera pasada tras el poblamiento: congela parejas
      if (!S.frozen) _finalizePairsOnce();

      // Reloj global
      S.time += dt;

      // ¿toca activar una pareja al azar?
      if (S.time >= S.nextActivationAt){
        _activateRandomPair();
        S.nextActivationAt = S.time + S.activationCooldown; // siguiente dentro de 10 min
      }
    },

    // Fuerza activación inmediata de una pareja concreta (para debug)
    forceActivate(pairId){
      if (!pairId) return _activateRandomPair();
      _teleportNowPair(pairId);
    },

    // Debug / introspección
    getPairs(){ return Object.freeze({ ...S.pairs }); },
    freezePairs(){ S.frozen = true; },
    setGlobalCooldownSeconds(sec){ S.activationCooldown = Math.max(10, sec|0); },
    setAllowObjects(v){ S.allowObjects = !!v; }
  };

  W.Entities = W.Entities || {};
  W.Entities.Elevator = API;

})();