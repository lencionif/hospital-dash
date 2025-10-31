// filename: placement.plugin.js
// Colocación de entidades sobre el mapa respetando zonas: sala de control, boss room, fuera de mapa.
// Usa tiles walkables (map[y][x] !== 1). Evita spawn en cámara inicial si se indica.

(function(W){
    // === DEBUG POPULATE (filtros por tipo) =========================
  (function(){
    const ALL_KEYS = [
      'HERO','BOSS','PATIENT','PILL',
      'SPAWNER','MOSQUITO','RAT',
      'CART','DOOR','ELEVATOR','LIGHT',
      'NPC_MEDICO','NPC_CHIEF','NPC_GUARDIA','NPC_FAMILIAR','NPC_ENFERMERA',
      'HAZARD_FUEGO','HAZARD_MOJADO','DECOR','TRIGGER','OTHER'
    ];

    // Cortafuegos para mapa debug: NO sembrar nada si se fuerza ASCII
    const __NO_SEED__ = !!(window.DEBUG_FORCE_ASCII || (window.G?.flags?.DEBUG_FORCE_ASCII));

    const DEFAULTS = ALL_KEYS.reduce((acc,k)=> (acc[k]=true, acc), {
      DRY_RUN:false, LOG:true, VERBOSE:false
    });

    function parseQS(){
      const q = new URLSearchParams(location.search);
      const out = {};
      if (q.has('dry')) out.DRY_RUN = q.get('dry') === '1';
      if (q.has('log')) out.LOG = q.get('log') !== '0';

      const applyList = (key, val, setTo) => {
        if (!val) return;
        const list = val.split(',').map(s=>s.trim().toUpperCase());
        if (list.includes('ALL')) {
          ALL_KEYS.forEach(k => out[k] = setTo);
        } else {
          list.forEach(k => { if (ALL_KEYS.includes(k)) out[k] = setTo; });
        }
      };
      applyList('allow', q.get('allow'), true);
      applyList('deny',  q.get('deny'),  false);
      return out;
    }

    const LS_KEY = 'HD_DEBUG_POPULATE_V1';
    const DebugPopulate = {
      save(){ try{ localStorage.setItem(LS_KEY, JSON.stringify(window.DEBUG_POPULATE)); }catch(e){} },
      load(){
        try{
          const raw = localStorage.getItem(LS_KEY);
          if (raw) Object.assign(window.DEBUG_POPULATE, JSON.parse(raw));
        }catch(e){}
      },
      reset(){
        window.DEBUG_POPULATE = JSON.parse(JSON.stringify(DEFAULTS));
      }
    };

    const qs = parseQS();
    window.DEBUG_POPULATE = Object.assign({}, DEFAULTS, qs);
    window.DebugPopulate = DebugPopulate;

    // --- Clasificador: normaliza placement.type/sub -> KEY ---
    window.classifyKind = function(kindOrType, p){
      const t = String(kindOrType || p?.type || '').toLowerCase();
      const sub = String(p?.sub || '').toLowerCase();

      // Mapeo placements -> keys
      if (t === 'player' || t === 'follower') return 'HERO';
      if (t === 'boss' || t === 'boss_door')  return 'BOSS';
      if (t === 'patient') return 'PATIENT';
      if (t === 'pill' || t === 'item' || t === 'phone' || t === 'bell') return 'DECOR';
      if (t === 'cart' || t === 'spawn_cart') return 'CART';
      if (t === 'door') return 'DOOR';
      if (t.startsWith('elevator')) return 'ELEVATOR';
      if (t === 'light' || t === 'boss_light') return 'LIGHT';

      if (t === 'spawn_mosquito' || t === 'spawn_rat' || t === 'spawn_staff') return 'SPAWNER';
      if (t === 'enemy') {
        if (sub.includes('mosquito')) return 'MOSQUITO';
        if (sub.includes('rat')) return 'RAT';
        return 'OTHER';
      }
      if (t === 'npc' || t === 'npc_unique'){
        if (sub.includes('medico')) return 'NPC_MEDICO';
        if (sub.includes('chief') || sub.includes('jefe') || sub.includes('supervisora')) return 'NPC_CHIEF';
        if (sub.includes('guardia')) return 'NPC_GUARDIA';
        if (sub.includes('familiar')) return 'NPC_FAMILIAR';
        if (sub.includes('enfermera')) return 'NPC_ENFERMERA';
        return 'OTHER';
      }

      if (t === 'hazard'){
        if (sub.includes('fuego')) return 'HAZARD_FUEGO';
        if (sub.includes('mojado') || sub.includes('agua')) return 'HAZARD_MOJADO';
        return 'OTHER';
      }
      if (t === 'trigger') return 'TRIGGER';
      return 'OTHER';
    };

    window.allowByDebug = function(key){
      const cfg = window.DEBUG_POPULATE || {};
      return cfg[key] !== false; // por defecto true
    };

    window.logPlacement = function(p, key, allowed){
      const C = window.DEBUG_POPULATE;
      if (!C.LOG) return;
      const where = (p.x!=null && p.y!=null) ? `at(${p.x},${p.y})` : '';
      if (C.DRY_RUN) {
        console.log(`DRY_RUN kind=${key} ${where} wouldCreate=true`, C.VERBOSE ? p : '');
      } else if (!allowed) {
        console.log(`PLACEMENT_SKIPPED kind=${key} ${where} reason=debug`, C.VERBOSE ? p : '');
      } else {
        console.log(`PLACEMENT_OK kind=${k} at(${x},${y}) ok=${ok}  [${_countsStr(_snapCounts())}]`);
      }
    };
  })();
  'use strict';
  const TILE = (typeof W.TILE_SIZE!=='undefined')? W.TILE_SIZE : (W.TILE||32);
  const ENT  = (W.ENT || {});

  //Helpers
  function isWalkable(map, tx,ty){
    return map[ty] && map[ty][tx] !== 1;
  }
  function inRect(tx,ty, r){ return tx>=r.x && ty>=r.y && tx<r.x+r.w && ty<r.y+r.h; }

  function _snapCounts() {
    const G = window.G || {};
    const n = (a) => Array.isArray(a) ? a.length : 0;
    return { entities: n(G.entities), enemies: n(G.enemies), npcs: n(G.npcs), patients: n(G.patients), movers: n(G.movers) };
  }
  function _countsStr(c) {
    return `ents=${c.entities} ene=${c.enemies} npc=${c.npcs} pat=${c.patients} mov=${c.movers}`;
  }
  function normalizeCartSub(raw) {
    const s = String(raw || '').toLowerCase();
    if (s.includes('food') || s.includes('comida')) return 'food';
    if (s.includes('med')  || s.includes('medic'))  return 'med';
    if (s.includes('urg')  || s.includes('er'))     return 'er';
    return 'med'; // por defecto
  }


  // Busca una casilla libre aleatoria cumpliendo restricciones
  function findFreeTile(G, constraints){
    const { map, rng } = G;
    const H = map.length, Wd = map[0].length;
    let safety = 2000;
    while (safety--){
      const tx = Math.floor((rng? rng(): Math.random()) * Wd);
      const ty = Math.floor((rng? rng(): Math.random()) * H);
      if (!isWalkable(map,tx,ty)) continue;

      if (constraints?.avoidRects){
        let bad=false; for(const r of constraints.avoidRects){ if (inRect(tx,ty,r)) {bad=true; break;} }
        if (bad) continue;
      }
      if (constraints?.minDistFrom){
        const md = constraints.minDistFrom; // {x,y,d}
        const dx = tx - md.x, dy = ty - md.y;
        if (dx*dx+dy*dy < (md.d*md.d)) continue;
      }
      return {tx,ty};
    }
    return null;
  }

  // Coloca N entidades de un tipo concreto usando NPC API
  function placeBatch(G, typeKey, count, opts = {}) {
    const TILE = (window.TILE_SIZE || window.TILE || 32);
    const out = [];
    const tKey = String(typeKey || '').toUpperCase();

    const colorByKey = {
      DOCTOR:'#2ecc71', SUPERVISOR:'#f39c12', FAMILY:'#e67e22',
      CLEANER:'#1abc9c', GUARDIA:'#3498db',
      RAT:'#8b4513', MOSQUITO:'#00ff88',
      PATIENT:'#ffd166', CART:'#b0956c'
    };

    function pushIfNew(e) {
      if (!e) return;
      G.entities = Array.isArray(G.entities) ? G.entities : (G.entities = []);
      if (!G.entities.includes(e)) G.entities.push(e);
    }

    function fallbackRect(x, y, k) {
      const make = window.makeRect;
      const c = colorByKey[k] || '#ff00ff55';
      const e = make ? make(x, y, TILE * 0.9, TILE * 0.9, 0, c, true, false, {}) :
        { x, y, w: TILE * 0.9, h: TILE * 0.9, kind: 0, color: c };
      pushIfNew(e);
      return e;
    }

    function spawnByKey(k, x, y, props) {
      const kk = k.toUpperCase();

      // NPCs
      if (kk === 'CLEANER' && window.CleanerAPI?.spawn) return window.CleanerAPI.spawn(x, y, props);
      if (kk === 'GUARDIA' && window.GuardiaAPI?.spawn) return window.GuardiaAPI.spawn(x, y, props);
      if (kk === 'SUPERVISOR' && window.SupervisoraAPI?.spawn) return window.SupervisoraAPI.spawn(x, y, props);
      if (kk === 'DOCTOR' && window.MedicoAPI?.spawn) return window.MedicoAPI.spawn(x, y, props);
      if (kk === 'FAMILY' && window.FamiliarMolestoAPI?.spawn) return window.FamiliarMolestoAPI.spawn(x, y, props);
      if (kk === 'TCAE' && window.TCAEAPI?.spawn) return window.TCAEAPI.spawn(x, y, props);

      // Enemigos
      if (kk === 'RAT') {
        if (window.RatsAPI?.spawn) return window.RatsAPI.spawn(x, y, props);
        if (e && e.update) {
          G.movers = G.movers || [];
          if (G.movers.indexOf(e) === -1) G.movers.push(e);
        }
        if (window.Entities?.Rat?.spawn) return window.Entities.Rat.spawn(x, y, props);
      }
      if (kk === 'MOSQUITO') {
        if (window.MosquitoAPI?.spawn) return window.MosquitoAPI.spawn(x, y, props);
        if (e && e.update) {
          G.movers = G.movers || [];
          if (G.movers.indexOf(e) === -1) G.movers.push(e);
        }
        if (window.Entities?.Mosquito?.spawn) return window.Entities.Mosquito.spawn(x, y, props);
      }

      // Paciente (por si quieres sembrar alguno suelto)
      if (kk === 'PATIENT' && window.Entities?.Patient?.spawn) return window.Entities.Patient.spawn(x, y, props);

      // Carros (si los usas aquí)
      if (kk === 'CART' && window.Entities?.Cart?.spawn) return window.Entities.Cart.spawn((props?.sub || 'med'), x, y, props);

      // Factoría genérica opcional (si existiera):
      if (window.NPC?.create) return window.NPC.create(kk, x, y, props);

      return null; // forzará fallback
    }

    for (let i = 0; i < (count | 0); i++) {
      const t = findFreeTile(G, opts.constraints);
      if (!t) break;
      const x = t.tx * TILE + TILE * 0.1;
      const y = t.ty * TILE + TILE * 0.1;

      const before = (Array.isArray(G.entities) ? G.entities.length : 0) +
                    (Array.isArray(G.enemies) ? G.enemies.length : 0) +
                    (Array.isArray(G.npcs) ? G.npcs.length : 0);

      let e = spawnByKey(tKey, x, y, (opts.props || {}));

      // Si la factoría no inserta en G.entities, lo metemos nosotros
      if (e) pushIfNew(e);

      const after = (Array.isArray(G.entities) ? G.entities.length : 0) +
                    (Array.isArray(G.enemies) ? G.enemies.length : 0) +
                    (Array.isArray(G.npcs) ? G.npcs.length : 0);

      // Fallback visible si no “subió” ninguna lista
      if (!e || after <= before) e = e || fallbackRect(x, y, tKey);

      // Log con color
      const css = `color:${colorByKey[tKey] || '#ffffff'}; font-weight:bold;`;
      if (__LOG_ON__) {
        try { console.log(`%cBATCH_OK%c ${type} x${n}`,
          'background:#1d3557;color:#fff;padding:2px 6px;border-radius:4px',
          'color:#1d3557', payload);
        } catch(_) {}
      }

      out.push(e);
    }

    return out;
  }


  // API público
  const MapPlacementAPI = {
    // constraints example:
    // { avoidRects:[controlRoomRect, bossRoomRect], minDistFrom:{x:spawnTx,y:spawnTy,d:15} }
    placeEntities(G, plan){
      // plan: { patients:7, pills:8, rats:1, mosquitos:1, cleaners:1, supervisor:1, family:1, doctor:1, boss:{roomRect, type:'a'} }
      const cons = plan.constraints || {};
      placeBatch(G, 'DOCTOR', plan.doctor||1, {constraints:cons});
      placeBatch(G, 'SUPERVISOR', plan.supervisor||1, {constraints:cons});
      placeBatch(G, 'FAMILY', plan.family||1, {constraints:cons});
      placeBatch(G, 'CLEANER', plan.cleaners||2, {constraints:cons});
      placeBatch(G, 'RAT', plan.rats||1, {constraints:cons});
      placeBatch(G, 'MOSQUITO', plan.mosquitos||1, {constraints:cons});
      // Pacientes encamados con nombres/pastillas cómicos
      const funny = [
        ['Dolores De Barriga','barrigaliv-500'],
        ['Agueda Tos','antitussin-12'],
        ['Esteban Do','ibuprex-400'],
        ['Lola Njar','antiflam-600'],
        ['Paco Picores','antihist-10'],
        ['Ana Femia','antipy-1g'],
        ['Rita Titis','gastrocalm-20']
      ];
      const nP = Math.max(1, plan.patients||7);
      for(let i=0;i<nP;i++){
        const t = findFreeTile(G, cons); if(!t) break;
        const e = W.NPC?.create('PATIENT', t.tx*TILE+4, t.ty*TILE+4, { name: funny[i%funny.length][0], pillId: funny[i%funny.length][1] });
        if (e) G.entities.push(e);
      }
      // Boss inmóvil en su sala
      if (plan.boss?.roomRect){
        const r = plan.boss.roomRect;
        const tx = Math.floor(r.x + r.w/2), ty = Math.floor(r.y + r.h/2);
        const e = W.NPC?.create('BOSS', tx*TILE+6, ty*TILE+6, { bossType: plan.boss.type||'a' });
        if (e) G.entities.push(e);
      }
    }
  };

  W.MapPlacementAPI = MapPlacementAPI;

})(this);



// === Instanciador NUCLEO único para placements del MapGen ===

window.applyPlacementsFromMapgen = function(arr){
  const W = window, G = W.G || (W.G = {});
  // KILL-SWITCH (instancia SIEMPRE si viene autorizado desde parseMap ASCII)
  const __allowAscii = (G && G.__allowASCIIPlacements === true);
  // Solo saltamos si NO es ASCII y además alguien lo ha deshabilitado explícitamente
  if (!__allowAscii && G?.flags?.__DISABLE_MAPGEN_PLACEMENTS === true) {
    console.warn('applyPlacementsFromMapgen: SKIPPED por __DISABLE_MAPGEN_PLACEMENTS');
    return { skipped:true };
  }
  const TILE = (W.TILE_SIZE || W.TILE || 32);
  const ENT  = W.ENT || {};

  // ---------- Helpers ----------
  const UPPER = s => (s||'').toString().trim().toUpperCase();
  const LOWER = s => (s||'').toString().trim().toLowerCase();
  function pushUnique(list, e){ if (list && e && !list.includes(e)) list.push(e); }
  function ensureLists(){
    G.entities  = G.entities  || [];
    G.enemies   = G.enemies   || [];
    G.npcs      = G.npcs      || [];
    G.doors     = G.doors     || [];
    G.elevators = G.elevators || [];
    G.movers    = G.movers    || [];
    G.patients  = G.patients  || [];
    G.pushables = G.pushables || [];
  }
  ensureLists();

function ensureOnLists(e){
  if (!e) return;
  pushUnique(G.entities, e);
  if (e.isNPC === true || e.kind === ENT.NPC)            pushUnique(G.npcs, e);
  if (e.isEnemy === true ||
      e.kind === (ENT.MOSQUITO||-999) ||
      e.kind === (ENT.RAT||-998))                        pushUnique(G.enemies, e);
  if (e.kind === ENT.DOOR)                               pushUnique(G.doors, e);
  if (e.kind === ENT.ELEVATOR)                           pushUnique(G.elevators, e);
  if (e.pushable === true)                               pushUnique(G.pushables, e);
  if (typeof e.update === 'function')                    pushUnique(G.movers, e);
  try { if (window.Physics?.registerEntity) Physics.registerEntity(e); } catch(_){}
}

  // Normaliza a PX y a TILES (según units o heurística)
  function toPxFromPlacement(p) {
    const units = (p && (p._units || p.units)) || null;
    if (units === 'px') return { x: p.x, y: p.y };
    if (units === 'tile' || units === 'tiles') return { x: p.x * TILE, y: p.y * TILE };
    const mapW = Array.isArray(G.map) && G.map[0] ? G.map[0].length : 0;
    const mapH = Array.isArray(G.map) ? G.map.length : 0;
    const looksLikeTiles =
      Number.isFinite(p.x) && Number.isFinite(p.y) &&
      p.x >= 0 && p.y >= 0 && mapW > 0 && mapH > 0 && p.x <= mapW && p.y <= mapH;
    return looksLikeTiles ? { x: p.x * TILE, y: p.y * TILE } : { x: p.x, y: p.y };
  }
  function toTilesFromPlacement(p, xPx, yPx) {
    const units = (p && (p._units || p.units)) || null;
    if (units === 'tile' || units === 'tiles') return { tx: Math.floor(p.x), ty: Math.floor(p.y) };
    if (units === 'px') return { tx: Math.floor(xPx / TILE), ty: Math.floor(yPx / TILE) };
    // heurística: si parecen tiles, úsalo como tal; si no, deriva de px
    const mapW = Array.isArray(G.map) && G.map[0] ? G.map[0].length : 0;
    const mapH = Array.isArray(G.map) ? G.map.length : 0;
    const looksLikeTiles =
      Number.isFinite(p.x) && Number.isFinite(p.y) &&
      p.x >= 0 && p.y >= 0 && mapW > 0 && mapH > 0 && p.x <= mapW && p.y <= mapH;
    return looksLikeTiles ? { tx: Math.floor(p.x), ty: Math.floor(p.y) }
                          : { tx: Math.floor(xPx / TILE), ty: Math.floor(yPx / TILE) };
  }

  // Logs silenciables con DEBUG_POPULATE.LOG (y .VERBOSE para detalle)
  const __LOG_ON__ = !!(window.DEBUG_POPULATE && window.DEBUG_POPULATE.LOG);
  const __VERBOSE__ = !!(window.DEBUG_POPULATE && window.DEBUG_POPULATE.VERBOSE);

  function logTry(p,x,y){
    if (!__LOG_ON__ || !__VERBOSE__) return;
    try { console.log('%cTRY','color:#aaa', p, '→', x, y); } catch(_) {}
  }
  function logOk(kind,x,y,e){
    if (!__LOG_ON__) return;
    try { console.log('%cOK','color:#2aa198', kind,'@',x,y,e); } catch(_) {}
  }
  function logFail(kind,x,y,why){
    if (!__LOG_ON__) return;
    try { console.warn('%cFAIL','color:#dc322f', kind,'@',x,y,why||''); } catch(_) {}
  }

  const count = () => ({
    ents:(G.entities||[]).length,
    npcs:(G.npcs||[]).length,
    enemies:(G.enemies||[]).length,
    doors:(G.doors||[]).length,
    elevators:(G.elevators||[]).length,
    pushables:(G.pushables||[]).length
  });
  const before = count();

  (arr||[]).forEach((p) => {
    ensureLists();
    const type = LOWER(p.type || p.kind || p.k);   // tipo "canónico"
    const sub  = LOWER(p.sub || p.subType || p.role || p.enemy || p.name || p.key || '');
    const { x, y } = toPxFromPlacement(p);
    const { tx, ty } = toTilesFromPlacement(p, x, y);
    let e = null;

    logTry(p,x,y);

    switch(type){

      // ---------- Jugador / seguidores ----------
      case 'player': {
        e = W.Entities?.Hero?.spawnPlayer?.(x,y,p);
        if (e){ ensureOnLists(e); logOk('HERO',x,y,e); return; }
        logFail('HERO',x,y,'Entities.Hero.spawnPlayer no disponible');
        return;
      }
      case 'follower': {
        e = W.Entities?.Hero?.spawnFollower?.(sub,x,y,p);
        if (e){ ensureOnLists(e); logOk('FOLLOWER_'+sub,x,y,e); return; }
        logFail('FOLLOWER_'+sub,x,y,'Entities.Hero.spawnFollower no disponible');
        return;
      }

      // ---------- NPCs ----------
      case 'npc_unique': return window.Entities?.NPC?.spawn?.(p.sub,x,y,{unique:true,...p});
      case 'npc':
      case 'NPC': {
        const sub = (p.sub || p.role || '').toLowerCase();
        const tryApi = (API) => API ? (API.spawn?.(x,y,p) || API.create?.(x,y,p) || null) : null;
        if (sub === 'cleaner')       return tryApi(window.CleanerAPI);
        if (sub === 'celador')       return tryApi(window.CeladorAPI);
        if (sub === 'tcae')          return tryApi(window.TCAEAPI);
        if (sub === 'guardia')       return tryApi(window.GuardiaAPI);
        if (sub === 'medico')        return tryApi(window.MedicoAPI);
        if (sub === 'supervisora')   return tryApi(window.SupervisoraAPI);
        if (sub === 'familiar' || sub === 'familiar_molesto') return tryApi(window.FamiliarMolestoAPI);
        if (sub === 'enfermera_sexy') return tryApi(window.EnfermeraSexyAPI);
        return window.Entities?.NPC?.spawn?.(sub || 'generic', x, y, p);
      }
      case 'spawn_staff': {
        // Soporte directo por roles conocidos (si existen), si no, genérico
        const tryDirect = () => {
          if (sub==='tcae' && W.Entities?.TCAE?.spawn) return W.Entities.TCAE.spawn(x,y,p);
          if (W.Entities?.NPC?.spawn)                 return W.Entities.NPC.spawn(sub||'generic', x,y,p);
          return null;
        };
        e = tryDirect() || W.Entities?.Spawner?.spawn?.('staff', x, y, p);
        if (e){ e.isNPC = true; ensureOnLists(e); logOk('NPC_'+(sub||'?'),x,y,e); return; }
        logFail('NPC_'+(sub||'?'),x,y,'No hay API de NPC/Spawner');
        return;
      }

      // ---------- Enemigos directos ----------
      case 'enemy': {
        if (sub==='mosquito'){
          e = (W.MosquitoAPI?.spawnAtTiles ? W.MosquitoAPI.spawnAtTiles(tx,ty,p) : W.MosquitoAPI?.spawn?.(x,y,p));
          if (e){ e.isEnemy = true; ensureOnLists(e); logOk('ENEMY_MOSQUITO',x,y,e); return; }
          logFail('ENEMY_MOSQUITO',x,y,'No hay API de Mosquito');
          return;
        }
        if (sub==='rat' || sub==='rata' || sub==='ratas'){
          e = (W.RatsAPI?.spawnAtTiles ? W.RatsAPI.spawnAtTiles(tx,ty,p) : W.RatsAPI?.spawn?.(x,y,p));
            if (e && e.update) {
            G.movers = G.movers || [];
            if (G.movers.indexOf(e) === -1) G.movers.push(e);
          }
          if (e){ e.isEnemy = true; ensureOnLists(e); logOk('ENEMY_RAT',x,y,e); return; }
          // --- ENEMY_RAT placement tolerante ---
          // Asume coords en píxeles (p.x, p.y). Adapta si vienen en tiles.
          (function(px, py){
            const spawnRat =
              (window.RatsAPI && typeof RatsAPI.spawn === 'function')
              || (window.Entities && window.Entities.Rat && typeof Entities.Rat.spawn === 'function')
              || null;

            if (!spawnRat) {
              logFail('ENEMY_RAT', px, py, 'No hay API de Ratas (RatsAPI/Entities.Rat)');
              return;
            }

            try {
              const r = spawnRat(px|0, py|0, { id: 'rat_' + Math.random().toString(36).slice(2) });
              if (window.DEBUG_FORCE_ASCII) console.log('OK ENEMY_RAT @', px|0, py|0, r);
            } catch(err){
              logFail('ENEMY_RAT', px, py, 'spawn error: '+err.message);
            }
          })(p.x, p.y);
          return;
        }
        logFail('ENEMY_'+(sub||'?'),x,y,'Tipo de enemigo desconocido');
        return;
      }

      // ---------- Spawners (registran y SIEMBRAN 1 visible) ----------
    case 'spawn_mosquito':
    case 'mosquito_spawn': {
      if (!__NO_SEED__) {
      try { window.MosquitoAPI?.registerSpawn?.(p.x, p.y, p); } catch(_){}
      let e = null;
      try {
        e = window.MosquitoAPI?.spawnAtTiles ? MosquitoAPI.spawnAtTiles(p.x, p.y, p)
            : window.MosquitoAPI?.spawn?.(x, y, p);
      } catch(_){}
      if (e){ (G.enemies||(G.enemies=[])).push(e); (G.entities||(G.entities=[])).push(e); }
      console.log('%cMOSQUITO_SEEDED at tiles','color:#00ff88', p.x, p.y);
      return e || true;
      }
    }
    case 'spawn_rat':
    case 'rat_spawn': {
      if (!__NO_SEED__) {
      try { window.RatsAPI?.registerSpawn?.(p.x, p.y, p); } catch(_){}
      let e = null;
      try {
        e = window.RatsAPI?.spawnAtTiles ? RatsAPI.spawnAtTiles(p.x, p.y, p)
            : window.RatsAPI?.spawn?.(x, y, p);
      } catch(_){}
      if (e){ (G.enemies||(G.enemies=[])).push(e); (G.entities||(G.entities=[])).push(e); }
      console.log('%cRAT_SEEDED at tiles','color:#8b4513', p.x, p.y);
      return e || true;
      }
    }

      // ---------- Carros / camas / sillas ----------
      case 'cart': {
        // el 1º carro sin subtipo → urgencias
        G._debugCartCount = (G._debugCartCount|0);
        let sub = String(p.sub||'').toLowerCase();
        if (!sub) sub = (G._debugCartCount === 0) ? 'urgencias' : 'medicinas';
        G._debugCartCount++;
        return (window.Entities?.Cart?.spawn?.(sub, x, y, p) ||
                window.CartsAPI?.spawn?.(sub, x, y, p) ||
                window.Entities?.Spawner?.spawn?.('cart', x, y, { ...p, sub }));
      }
      case 'spawn_cart': {
        const sub = (String(p.sub||'').toLowerCase()||'medicinas');
        return (window.Entities?.Cart?.spawn?.(sub, x, y, p) ||
                window.CartsAPI?.spawn?.(sub, x, y, p) ||
                window.Entities?.Spawner?.spawn?.('cart', x, y, { ...p, sub }));
      }
      case 'boss_door': return window.Entities?.Door?.spawn?.(x,y,{locked:true,isBoss:true,...p});
      case 'wheelchair': {
        const cartType = (sub==='comida'||sub==='meal'||sub==='food') ? 'comida' :
                         (sub==='urgencias'||sub==='er'||sub==='emergency') ? 'urgencias' : 'medicinas';
        if (W.Entities?.Cart?.spawn) {
          e = W.Entities.Cart.spawn(cartType, x, y, p);
        } else if (W.CartsAPI?.spawn) {
          e = W.CartsAPI.spawn(cartType, x, y, p);
        } else if (W.Entities?.Spawner?.spawn) {
          e = W.Entities.Spawner.spawn('cart', x, y, { ...p, sub:cartType });
        }
        if (e){ e.pushable = true; ensureOnLists(e); logOk('CART_'+cartType,x,y,e); return; }
        logFail('CART_'+cartType,x,y,'No hay API de Cart');
        return;
      }

      // ---------- Puertas / Ascensores ----------
      case 'door': return window.Entities?.Door?.spawn?.(x,y,{locked:true, ...p});
      // ---------- Boss ----------
      case 'boss': {
        // soporta: Entities.Boss.spawn || BossRushAPI.spawnBoss
        let e = (window.Entities?.Boss?.spawn?.(x, y, p) ||
                window.BossRushAPI?.spawnBoss?.(x, y, { tier: p.tier || 1, ...p }) ||
                null);
        if (e){ ensureOnLists(e); logOk('BOSS',x,y,e); return; }
        logFail('BOSS',x,y,'No hay API de Boss');
        return;
      }
      case 'boss_door': {
        e = W.Entities?.Door?.spawn?.(x,y,{ locked: !!p.locked, isBoss:(type==='boss_door'), ...p });
        if (e){ ensureOnLists(e); logOk(UPPER(type),x,y,e); return; }
        logFail(UPPER(type),x,y,'Entities.Door.spawn no disponible');
        return;
      }
      case 'elevator':
      case 'elevator_active':
      case 'elevator_closed':
      return window.Entities?.Elevator?.spawn?.(x,y,{ pairId:p.pairId, active:(p.active!==false), ...p });
      case 'lift': {
        // OJO: el wrapper de Elevator espera TILES, no PX
        e = (W.Entities?.Elevator?.spawn ? W.Entities.Elevator.spawn(tx, ty, { pairId:p.pairId, active:(p.active!==false), ...p })
             : W.ElevatorsAPI?.spawnElevator?.(tx, ty, { pairId:p.pairId, active:(p.active!==false), ...p }));
        if (e){ ensureOnLists(e); logOk('ELEVATOR',x,y,e); return; }
        logFail('ELEVATOR',x,y,'Elevator.spawn / ElevatorsAPI.spawnElevator no disponible');
        return;
      }

      // ---------- Luces ----------
      case 'light':
      case 'boss_light':
        if (p.type==='boss_light'){
          return (window.Entities?.spawnFromPlacement_BossLight?.(p) ||
                  (window.Entities?.BossLight && new window.Entities.BossLight(p)));
        }
        return (window.Entities?.spawnFromPlacement_Light?.(p) ||
                window.Entities?.Light?.spawn?.(x,y,p));

      // ---------- Objetos varios ----------
      case 'patient': { e = W.Entities?.Patient?.spawn?.(x,y,p); if (e){ ensureOnLists(e); logOk('PATIENT',x,y,e); return; } logFail('PATIENT',x,y,'sin API'); return; }
      case 'pill': {
        // 1) Camino oficial si existe
        e = W.Entities?.Objects?.spawnPill?.(p.sub||p.targetName, x, y, p);
        if (e){ ensureOnLists(e); logOk('PILL',x,y,e); return; }
        // 2) Fallback robusto: usa Patients API para crear la pastilla del paciente objetivo
        const PAPI = W.Entities?.Patient || W.PatientsAPI || W.Patients;
        // buscar paciente por nombre o el más cercano
        let target = null;
        const all = (W.G?.entities||[]).filter(o=>o && o.kind===W.ENT?.PATIENT);
        if (p?.targetName){ target = all.find(o => (o.id===p.targetName || o.name===p.targetName || o.label===p.targetName)) || null; }
        if (!target){
          let best=Infinity; for (const o of all){ const d=(o.x-x)*(o.x-x)+(o.y-y)*(o.y-y); if (d<best){best=d; target=o;} }
        }
        if (target && PAPI?.createPillForPatient){
          e = PAPI.createPillForPatient(target, 'near');
          if (e){ ensureOnLists(e); logOk('PILL',e.x,e.y,e); return; }
        }
        // 3) Último recurso visible
        e = { id:'PILL_'+Math.random().toString(36).slice(2), kind:W.ENT?.PILL, x:x|0, y:y|0, w:(W.TILE_SIZE||32)*0.5, h:(W.TILE_SIZE||32)*0.5, name:(p?.sub||'azul'), skin:('pastilla_'+(p?.sub||'azul')) };
        (W.G?.entities||(W.G.entities=[])).push(e); (W.G.pills||(W.G.pills=[])).push(e);
        ensureOnLists(e); logOk('PILL(FALLBACK)',x,y,e); return;
      }
      case 'bell':    { e = W.Entities?.Objects?.spawnBell?.(x,y,p); if (e){ ensureOnLists(e); logOk('BELL',x,y,e); return; } logFail('BELL',x,y,'sin API'); return; }

      default:
        logFail(UPPER(type||'UNKNOWN'),x,y,'tipo no soportado');
        return;
    }
  });

  const after = count();
  if (__LOG_ON__) {
    try {   console.log('%cPLACEMENT_SUMMARY','background:#222;color:#fff;padding:2px 6px',
      { before, after, delta:{
        ents: after.ents-before.ents,
        npcs: after.npcs-before.npcs,
        enemies: after.enemies-before.enemies,
        doors: after.doors-before.doors,
        elevators: after.elevators-before.elevators,
        pushables: after.pushables-before.pushables
      }}); } catch(_) {}
  }
};

// === Hotkeys debug ===
window.addEventListener('keydown', (ev)=>{
  if (ev.code === 'F8') { // toggle DRY_RUN
    window.DEBUG_POPULATE.DRY_RUN = !window.DEBUG_POPULATE.DRY_RUN;
    console.log('[DEBUG_POPULATE] DRY_RUN =', window.DEBUG_POPULATE.DRY_RUN);
  }
  if (ev.code === 'F9') { // toggle ALL ON/OFF
    const on = !Object.values(window.DEBUG_POPULATE).some(v => v === true);
    const KEYS = Object.keys(window.DEBUG_POPULATE).filter(k=>/^[A-Z_]+$/.test(k));
    KEYS.forEach(k => window.DEBUG_POPULATE[k] = on);
    console.log('[DEBUG_POPULATE] ALL =', on ? 'ON' : 'OFF');
  }
});
window.applyPlacementsFromMapgen_core = window.applyPlacementsFromMapgen;