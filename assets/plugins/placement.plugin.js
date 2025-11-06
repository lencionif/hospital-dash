// filename: placement.api.js
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
      const C = window.DEBUG_POPULATE || {};
      if (!C.LOG) return;
      const where = (p && p.x != null && p.y != null) ? `at(${p.x},${p.y})` : '';
      if (C.DRY_RUN) {
        console.log(`DRY_RUN kind=${key} ${where} wouldCreate=true`, C.VERBOSE ? p : '');
        return;
      }
      if (!allowed) {
        console.log(`PLACEMENT_SKIPPED kind=${key} ${where} reason=debug`, C.VERBOSE ? p : '');
        return;
      }
      const snapshot = _countsStr(_snapCounts());
      console.log(`PLACEMENT_OK kind=${key} ${where} [${snapshot}]`, C.VERBOSE ? p : '');
    };
  })();
  'use strict';
  const DEBUG_MAP = /(?:\?|&)map=debug\b/i.test(location.search || '');
  const TILE = (typeof W.TILE_SIZE!=='undefined')? W.TILE_SIZE : (W.TILE||32);
  const ENT  = (W.ENT || {});
  const EMPTY_SUMMARY = () => ({ countsPorTipo: {}, total: 0 });
  let lastSummary = EMPTY_SUMMARY();

  function shouldRunPlacement(mode, ctx){
    const targetG = ctx?.G;
    if (targetG && window.G !== targetG) {
      window.G = targetG;
    }
    const g = window.G || (window.G = {});
    const requested = mode || ctx?.mode || (DEBUG_MAP ? 'debug' : 'normal');
    const activeMode = g._placementMode || (g.debugMap ? 'debug' : requested);
    if (activeMode && requested && activeMode !== requested) {
      window.LOG?.debug?.('[placement] skip: modo activo distinto', { requested, active: activeMode });
      return false;
    }
    if (g._hasPlaced || g.__placementsApplied) {
      window.LOG?.warn?.('[placement] intento duplicado', { mode: requested });
      return false;
    }
    return true;
  }

  function finalizePlacement(mode, ctx){
    const targetG = ctx?.G;
    if (targetG && window.G !== targetG) {
      window.G = targetG;
    }
    const g = window.G || (window.G = {});
    g._hasPlaced = true;
    if (mode) g._placementMode = mode;
    g.__placementsApplied = true;
  }

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
        let spawned = null;
        if (window.RatsAPI?.spawn) spawned = window.RatsAPI.spawn(x, y, props);
        else if (window.Entities?.Rat?.spawn) spawned = window.Entities.Rat.spawn(x, y, props);
        if (spawned && spawned.update) {
          G.movers = G.movers || [];
          if (!G.movers.includes(spawned)) G.movers.push(spawned);
        }
        return spawned;
      }
      if (kk === 'MOSQUITO') {
        let spawned = null;
        if (window.MosquitoAPI?.spawn) spawned = window.MosquitoAPI.spawn(x, y, props);
        else if (window.Entities?.Mosquito?.spawn) spawned = window.Entities.Mosquito.spawn(x, y, props);
        if (spawned && spawned.update) {
          G.movers = G.movers || [];
          if (!G.movers.includes(spawned)) G.movers.push(spawned);
        }
        return spawned;
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
  function counterSnapshot() {
    try {
      if (typeof W.PatientsAPI?.counterSnapshot === 'function') {
        return W.PatientsAPI.counterSnapshot();
      }
    } catch (_) {}
    return (window.patientsSnapshot ? window.patientsSnapshot() : {
      total: G.patientsTotal | 0,
      pending: G.patientsPending | 0,
      cured: G.patientsCured | 0,
      furious: G.patientsFurious | 0,
    });
  }

  if (!W.counterSnapshot) {
    W.counterSnapshot = counterSnapshot;
  }

  function ensurePatientsStore(Gref = G) {
    let store = Gref.patients;
    if (Array.isArray(store)) return store;
    if (store && typeof store === 'object') return store;
    const arr = [];
    arr.total = 0;
    arr.pending = 0;
    arr.cured = 0;
    arr.furious = 0;
    Gref.patients = arr;
    return arr;
  }

  function ensurePatientCounters() {
    if (!Number.isFinite(G.patientsTotal)) G.patientsTotal = 0;
    if (!Number.isFinite(G.patientsPending)) G.patientsPending = 0;
    if (!Number.isFinite(G.patientsCured)) G.patientsCured = 0;
    if (!Number.isFinite(G.patientsFurious)) G.patientsFurious = 0;
    const store = ensurePatientsStore();
    if (typeof store.total !== 'number') store.total = G.patientsTotal;
    if (typeof store.pending !== 'number') store.pending = G.patientsPending;
    if (typeof store.cured !== 'number') store.cured = G.patientsCured;
    if (typeof store.furious !== 'number') store.furious = G.patientsFurious;
  }

  function spawnPillFor(patient) {
    if (!patient) return null;
    try {
      const pill = (window.PatientsAPI?.createPillForPatient?.(patient, 'near')
        || window.Patients?.createPillForPatient?.(patient, 'near')) || null;
      if (pill) {
        pill.forPatientId = patient.id;
        ensureOnLists(pill);
      }
      return pill;
    } catch (_) {
      return null;
    }
  }

  function spawnBellNear(patient) {
    if (!patient) return null;
    if (window.BellsAPI?.spawnBellNear) {
      try {
        return window.BellsAPI.spawnBellNear(patient);
      } catch (_) {}
    }
    const x = (patient.x || 0) + (patient.w || TILE) + 8;
    const y = patient.y || 0;
    const opts = { patient, forPatientId: patient.id, link: patient.id };
    try {
      const bell = window.BellsAPI?.spawnBell?.(x, y, opts)
        || window.spawnBell?.(x, y, opts)
        || null;
      if (bell) {
        bell.forPatientId = patient.id;
        ensureOnLists(bell);
      }
      return bell;
    } catch (_) {
      return null;
    }
  }

  window.spawnPillFor = spawnPillFor;
  if (!window.spawnBellNear) {
    window.spawnBellNear = spawnBellNear;
  }

  const MapPlacementAPI = {
    // constraints example:
    // { avoidRects:[controlRoomRect, bossRoomRect], minDistFrom:{x:spawnTx,y:spawnTy,d:15} }
    placeEntities(G, plan){
      if (!shouldRunPlacement('normal', { G })) {
        return;
      }
      // plan: { patients:7, pills:8, rats:1, mosquitos:1, cleaners:1, supervisor:1, family:1, doctor:1, boss:{roomRect, type:'a'} }
      const cons = plan.constraints || {};
      placeBatch(G, 'DOCTOR', plan.doctor||1, {constraints:cons});
      placeBatch(G, 'SUPERVISOR', plan.supervisor||1, {constraints:cons});
      placeBatch(G, 'FAMILY', plan.family||1, {constraints:cons});
      placeBatch(G, 'CLEANER', plan.cleaners||2, {constraints:cons});
      placeBatch(G, 'RAT', plan.rats||1, {constraints:cons});
      placeBatch(G, 'MOSQUITO', plan.mosquitos||1, {constraints:cons});
      // Pacientes encamados con nombres cómicos y pastilla enlazada
      const totalPatients = Math.max(0, Math.min(35, plan.patients || 7));
      for (let i = 0; i < totalPatients; i++) {
        const spot = findFreeTile(G, cons);
        if (!spot) break;
        const px = spot.tx * TILE + TILE * 0.1;
        const py = spot.ty * TILE + TILE * 0.1;
        ensurePatientCounters();
        const beforeTotal = G.patientsTotal | 0;
        const beforePending = G.patientsPending | 0;
        let manualIncrement = false;
        const patient = W.Entities?.Patient?.spawn?.(px, py, {}) || null;
        if (patient) {
          ensureOnLists(patient);
          patient.kind = ENT.PATIENT;
          patient.id = patient.id || `PAT_${Math.random().toString(36).slice(2)}`;
          if (!G.entities.includes(patient)) G.entities.push(patient);
          if (!G.patients.includes(patient)) G.patients.push(patient);
          if (!G.allPatients.includes(patient)) G.allPatients.push(patient);
          if ((G.patientsTotal | 0) === beforeTotal) {
            G.patientsTotal = beforeTotal + 1;
            manualIncrement = true;
          }
          if ((G.patientsPending | 0) === beforePending) {
            G.patientsPending = beforePending + 1;
            manualIncrement = true;
          }
          const pill = spawnPillFor(patient);
          if (pill) {
            patient.pillId = pill.id || pill;
            pill.forPatientId = patient.id;
            if (!pill.__creationLogged) {
              try { W.LOG?.event?.('PILL_CREATE', { pill: pill.id, forPatient: patient.id }); } catch (_) {}
              pill.__creationLogged = true;
            }
          }
          const bell = spawnBellNear(patient);
          if (bell) {
            patient.bellId = bell.id || bell;
            bell.forPatientId = patient.id;
            try { W.LOG?.event?.('BELL_CREATE', { bell: bell.id, forPatient: patient.id }); } catch (_) {}
          }
          try { W.GameFlowAPI?.onPatientCreated?.(patient); } catch(_) {}
          if (!patient.__creationLogged) {
            try { W.LOG?.event?.('PATIENT_CREATE', { id: patient.id }); } catch (_) {}
            patient.__creationLogged = true;
          }
          if (manualIncrement) {
            try { W.LOG?.event?.('PATIENTS_COUNTER', counterSnapshot()); } catch (_) {}
          }
        }
      }
      // Boss inmóvil en su sala
      if (plan.boss?.roomRect){
        const r = plan.boss.roomRect;
        const tx = Math.floor(r.x + r.w/2), ty = Math.floor(r.y + r.h/2);
        const e = W.NPC?.create('BOSS', tx*TILE+6, ty*TILE+6, { bossType: plan.boss.type||'a' });
        if (e) G.entities.push(e);
      }
      finalizePlacement('normal', { G });
    }
  };

  W.MapPlacementAPI = MapPlacementAPI;
  W.__placementShouldRun = shouldRunPlacement;
  W.__placementFinalize = finalizePlacement;

})(this);



// === Instanciador NUCLEO único para placements del MapGen ===

function applyPlacementsFromMapgen(arr, ctx){
  const W = window;
  const G = ctx?.G || W.G || (W.G = {});
  if (ctx?.G && W.G !== ctx.G) {
    W.G = ctx.G;
  }
  const mode = ctx?.mode || (G.debugMap === true ? 'debug' : 'normal');
  const runGuard = W.__placementShouldRun || (() => true);
  const finalize = W.__placementFinalize || (() => {});
  if (!runGuard(mode, { G, mode })) {
    return { skipped: true, reason: 'guard' };
  }
  if (G.__placementsApplied === true) {
    console.warn('applyPlacementsFromMapgen: SKIP duplicate invocation');
    try {
      window.LOG?.warn?.('[placement] invocación duplicada detectada', { mode });
      window.LOG?.event?.('PLACEMENT_GUARD', { duplicatePlacement: true, mode, level: G.level || null });
    } catch (_) {}
    finalize(mode, { G });
    return { skipped: true, reason: 'duplicate' };
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    window.LOG?.info?.('[placement] lista vacía');
    return { skipped: true, reason: 'empty' };
  }
  G.__placementsApplied = true;
  // KILL-SWITCH (instancia SIEMPRE si viene autorizado desde parseMap ASCII)
  const __allowAscii = (G && G.__allowASCIIPlacements === true);
  // Solo saltamos si NO es ASCII y además alguien lo ha deshabilitado explícitamente
  if (!__allowAscii && G?.flags?.__DISABLE_MAPGEN_PLACEMENTS === true) {
    console.warn('applyPlacementsFromMapgen: SKIPPED por __DISABLE_MAPGEN_PLACEMENTS');
    return { skipped:true, reason: 'disabled' };
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
    G.allPatients = G.allPatients || [];
    G.pills     = G.pills     || [];
    G.bells     = G.bells     || [];
    G.pushables = G.pushables || [];
  }
  ensureLists();

function ensureOnLists(e){
  if (!e) return;
  pushUnique(G.entities, e);
  if (e.kind === ENT.PATIENT) {
    pushUnique(G.patients, e);
    pushUnique(G.allPatients, e);
  }
  if (e.kind === ENT.PILL) {
    pushUnique(G.pills, e);
  }
  if (e.kind === ENT.BELL) {
    G.bells = G.bells || [];
    pushUnique(G.bells, e);
  }
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
    window.LOG?.event?.('SPAWN', { kind, x, y, id: e?.id || null });
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
      case 'npc_unique': {
        const npc = window.Entities?.NPC?.spawn?.(p.sub, x, y, { unique: true, ...p }) || null;
        if (npc) { npc.isNPC = true; ensureOnLists(npc); logOk('NPC_UNIQUE_'+(p.sub||'?'), x, y, npc); }
        else { logFail('NPC_UNIQUE_'+(p.sub||'?'), x, y, 'Entities.NPC.spawn no disponible'); }
        return;
      }
      case 'npc':
      case 'NPC': {
        const subName = (p.sub || p.role || '').toLowerCase();
        const tryApi = (API) => API ? (API.spawn?.(x,y,p) || API.create?.(x,y,p) || null) : null;
        let npc = null;
        if (subName === 'cleaner')       npc = tryApi(window.CleanerAPI);
        else if (subName === 'celador')  npc = tryApi(window.CeladorAPI);
        else if (subName === 'tcae')     npc = tryApi(window.TCAEAPI);
        else if (subName === 'guardia')  npc = tryApi(window.GuardiaAPI);
        else if (subName === 'medico')   npc = tryApi(window.MedicoAPI);
        else if (subName === 'supervisora' || subName === 'jefe') npc = tryApi(window.SupervisoraAPI || window.JefeServicioAPI);
        else if (subName === 'familiar' || subName === 'familiar_molesto') npc = tryApi(window.FamiliarMolestoAPI);
        else if (subName === 'enfermera_sexy') npc = tryApi(window.EnfermeraSexyAPI);
        if (!npc) {
          npc = window.Entities?.NPC?.spawn?.(subName || 'generic', x, y, p) || null;
        }
        if (npc) { npc.isNPC = true; ensureOnLists(npc); logOk('NPC_'+(subName || 'generic').toUpperCase(), x, y, npc); }
        else { logFail('NPC_'+(subName||'?').toUpperCase(), x, y, 'sin API'); }
        return;
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
        G._debugCartCount = (G._debugCartCount|0);
        let sub = String(p.sub||'').toLowerCase();
        if (!sub) sub = (G._debugCartCount === 0) ? 'urgencias' : 'medicinas';
        G._debugCartCount++;
        const cart = (window.Entities?.Cart?.spawn?.(sub, x, y, p)
          || window.CartsAPI?.spawn?.(sub, x, y, p)
          || window.Entities?.Spawner?.spawn?.('cart', x, y, { ...p, sub })
          || null);
        if (cart) { cart.pushable = true; ensureOnLists(cart); logOk('CART_'+sub.toUpperCase(), x, y, cart); }
        else { logFail('CART_'+sub.toUpperCase(), x, y, 'sin API'); }
        return;
      }
      case 'spawn_cart': {
        const sub = (String(p.sub||'').toLowerCase()||'medicinas');
        const cart = (window.Entities?.Cart?.spawn?.(sub, x, y, p)
          || window.CartsAPI?.spawn?.(sub, x, y, p)
          || window.Entities?.Spawner?.spawn?.('cart', x, y, { ...p, sub })
          || null);
        if (cart) { cart.pushable = true; ensureOnLists(cart); logOk('CART_'+sub.toUpperCase(), x, y, cart); }
        else { logFail('CART_'+sub.toUpperCase(), x, y, 'sin API'); }
        return;
      }
      case 'boss_door': {
        const door = window.Entities?.Door?.spawn?.(x,y,{locked:true,isBoss:true,...p}) || null;
        if (door) { ensureOnLists(door); logOk('BOSS_DOOR', x, y, door); }
        else { logFail('BOSS_DOOR', x, y, 'Entities.Door.spawn no disponible'); }
        return;
      }
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
      case 'door': {
        const door = window.Entities?.Door?.spawn?.(x,y,{locked:true, ...p}) || null;
        if (door) { ensureOnLists(door); logOk('DOOR', x, y, door); }
        else { logFail('DOOR', x, y, 'Entities.Door.spawn no disponible'); }
        return;
      }
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
      case 'elevator':
      case 'elevator_active':
      case 'elevator_closed': {
        const elev = window.Entities?.Elevator?.spawn?.(x,y,{ pairId:p.pairId, active:(p.active!==false), ...p }) || null;
        if (elev) { ensureOnLists(elev); logOk('ELEVATOR', x, y, elev); }
        else { logFail('ELEVATOR', x, y, 'Entities.Elevator.spawn no disponible'); }
        return;
      }
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
      case 'boss_light': {
        const isBossLight = (type === 'boss_light') || (p.type === 'boss_light');
        const payload = { ...p, x, y, _units: 'px' };
        const light = isBossLight
          ? (window.Entities?.spawnFromPlacement_BossLight?.(payload)
            || (window.Entities?.BossLight && new window.Entities.BossLight(payload)))
          : (window.Entities?.spawnFromPlacement_Light?.(payload)
            || window.Entities?.Light?.spawn?.(x, y, payload));
        if (light) {
          light.qaLightKind = isBossLight ? 'LIGHT_BOSS' : (payload.broken ? 'LIGHT_BROKEN' : 'LIGHT_NORMAL');
          if (payload.broken === true && light.puppet && light.puppet.data) {
            light.puppet.data.broken = true;
          }
          ensureOnLists(light);
          logOk(light.qaLightKind || (isBossLight ? 'BOSS_LIGHT' : 'LIGHT'), x, y, light);
          return;
        }
        logFail(isBossLight ? 'BOSS_LIGHT' : 'LIGHT', x, y, 'sin API');
        return;
      }

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
          if (e){ ensureOnLists(e); try { W.GameFlowAPI?.onPatientCreated?.(e); } catch(_) {} logOk('PILL',e.x,e.y,e); return; }
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

  finalize(mode, { G });
  const after = count();
  const delta = {
    ents: after.ents-before.ents,
    npcs: after.npcs-before.npcs,
    enemies: after.enemies-before.enemies,
    doors: after.doors-before.doors,
    elevators: after.elevators-before.elevators,
    pushables: after.pushables-before.pushables
  };
  if (__LOG_ON__ && !window.__PLACEMENT_SUPPRESS_INTERNAL_SUMMARY__) {
    try {
      console.log('%cPLACEMENT_RESULT','background:#222;color:#fff;padding:2px 6px', { before, after, delta });
    } catch(_) {}
  }
  try { window.GameFlowAPI?.notifyPatientCountersChanged?.(); } catch (_) {}
  return { applied: true, before, after, delta };
}

window.applyPlacementsFromMapgen = applyPlacementsFromMapgen;

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    if (min >= max) return min;
    return Math.max(min, Math.min(max, value));
  }

  function buildDefaultNormalPlacements(G) {
    const tile = TILE || 32;
    const mapArray = Array.isArray(G?.map) ? G.map : null;
    const inferredWidth = Number.isFinite(G?.mapW) && G.mapW > 0
      ? G.mapW
      : (mapArray && Array.isArray(mapArray[0]) ? mapArray[0].length : 40);
    const inferredHeight = Number.isFinite(G?.mapH) && G.mapH > 0
      ? G.mapH
      : (mapArray ? mapArray.length : 30);

    const clampTx = (tx) => clamp(tx, 1, Math.max(1, inferredWidth - 2));
    const clampTy = (ty) => clamp(ty, 1, Math.max(1, inferredHeight - 2));
    const centerTx = clampTx(Math.floor(inferredWidth / 2));
    const centerTy = clampTy(Math.floor(inferredHeight / 2));

    const toPx = (tx, ty) => ({
      x: tx * tile + tile / 2,
      y: ty * tile + tile / 2
    });

    const place = (type, dx, dy, extra = {}) => {
      const tx = clampTx(centerTx + dx);
      const ty = clampTy(centerTy + dy);
      return { type, _units: 'px', ...toPx(tx, ty), ...extra };
    };

    const patientId = 'patient_fallback';
    return [
      place('player', 0, 0, { id: 'fallback_player' }),
      place('light', 0, -2, { color: '#fef2c0' }),
      place('patient', 2, 0, { id: patientId, name: 'Paciente Demo' }),
      place('bell', 1, 0, { link: patientId }),
      place('pill', 3, 0, { targetName: patientId, sub: 'azul' }),
      place('cart', 0, 2, { sub: 'med' }),
      place('spawn_mosquito', -2, 2),
      place('spawn_rat', 2, 2),
      place('door', -3, 0, { locked: false }),
      place('elevator', -4, 2, { active: true }),
      place('npc', 1, 1, { sub: 'medico' }),
      place('npc', -1, 1, { sub: 'guardia' }),
      place('boss', 5, 0, { tier: 1 }),
      place('light', 2, -2, { broken: true }),
      place('light', -2, -2)
    ];
  }

  function resolvePlacementList(levelCfg, G) {
    if (Array.isArray(levelCfg?.placements) && levelCfg.placements.length) {
      return { list: levelCfg.placements, allowAscii: !!levelCfg.allowAscii };
    }
    if (Array.isArray(levelCfg?.asciiPlacements) && levelCfg.asciiPlacements.length) {
      return { list: levelCfg.asciiPlacements, allowAscii: true };
    }
    if (Array.isArray(G?.__asciiPlacements) && G.__asciiPlacements.length) {
      return { list: G.__asciiPlacements, allowAscii: true };
    }
    if (Array.isArray(G?.mapgenPlacements) && G.mapgenPlacements.length) {
      return { list: G.mapgenPlacements, allowAscii: false };
    }
    return { list: [], allowAscii: false };
  }

  function computeSummary(placements) {
    const counts = {};
    let total = 0;
    for (const p of placements || []) {
      const key = (typeof window.classifyKind === 'function')
        ? window.classifyKind(p?.type || p?.kind || p?.k, p)
        : String(p?.type || p?.kind || 'OTHER').toUpperCase();
      const normalized = key || 'OTHER';
      counts[normalized] = (counts[normalized] || 0) + 1;
      total++;
    }
    return { countsPorTipo: counts, total };
  }

  function registerSpawnedEntity(G, entity) {
    if (!entity || !G) return;
    const ENT = G.ENT || window.ENT || {};
    const ensureList = (key) => {
      const list = Array.isArray(G[key]) ? G[key] : (G[key] = []);
      if (!list.includes(entity)) list.push(entity);
    };
    ensureList('entities');
    if (typeof entity.update === 'function') ensureList('movers');
    if (entity.pushable === true) ensureList('pushables');
    const kindName = (entity.kindName || entity.type || '').toString().toUpperCase();
    const kindValue = entity.kind;
    const matchesKind = (value) => {
      if (value == null) return false;
      if (typeof kindValue === 'string') return kindValue.toUpperCase() === value;
      if (typeof kindValue === 'number') return ENT && ENT[value] === kindValue;
      return kindName === value;
    };
    if (matchesKind('PATIENT') || kindName === 'PATIENT') {
      ensureList('patients');
      ensureList('allPatients');
    }
    if (matchesKind('PILL') || kindName === 'PILL' || entity.type === 'pill') {
      ensureList('pills');
    }
    if (matchesKind('BELL') || kindName === 'BELL' || entity.type === 'bell') {
      ensureList('bells');
    }
    if (matchesKind('DOOR') || kindName === 'DOOR') {
      ensureList('doors');
    }
    if (matchesKind('ELEVATOR') || kindName === 'ELEVATOR') {
      ensureList('elevators');
    }
    if (entity.isEnemy === true || kindName === 'ENEMY') {
      ensureList('enemies');
    }
    if (entity.isNPC === true || kindName.startsWith('NPC') || kindName === 'MEDIC' || kindName === 'GUARDIA') {
      ensureList('npcs');
    }
  }

  function syncPatientCounters(G) {
    ensurePatientCounters();
    const snapshot = {
      total: G.patientsTotal | 0,
      pending: G.patientsPending | 0,
      cured: G.patientsCured | 0,
      furious: G.patientsFurious | 0,
    };
    const store = ensurePatientsStore(G);
    store.total = snapshot.total;
    store.pending = snapshot.pending;
    store.cured = snapshot.cured;
    store.furious = snapshot.furious;
    G.patientsCounters = { ...snapshot };
    return snapshot;
  }

  function pickWorldPosition(G, opts = {}) {
    const base = opts.near;
    const minDist = opts.minDist || 3;
    const avoid = Array.isArray(opts.avoidRects) ? opts.avoidRects : null;
    let tile = null;
    if (base && Number.isFinite(base.x) && Number.isFinite(base.y)) {
      const bx = Math.floor(base.x / TILE);
      const by = Math.floor(base.y / TILE);
      tile = findFreeTile(G, { minDistFrom: { x: bx, y: by, d: minDist }, avoidRects: avoid });
    }
    if (!tile) {
      tile = findFreeTile(G, { avoidRects: avoid }) || null;
    }
    if (!tile) {
      const fallbackTx = Math.max(1, Math.floor((G.mapW || (G.map?.[0]?.length || 8)) / 2) + (opts.offsetTx || 0));
      const fallbackTy = Math.max(1, Math.floor((G.mapH || (G.map?.length || 8)) / 2) + (opts.offsetTy || 0));
      tile = { tx: fallbackTx, ty: fallbackTy };
    }
    const anchorX = opts.anchorX != null ? opts.anchorX : 0.1;
    const anchorY = opts.anchorY != null ? opts.anchorY : 0.1;
    return {
      tx: tile.tx,
      ty: tile.ty,
      x: tile.tx * TILE + TILE * anchorX,
      y: tile.ty * TILE + TILE * anchorY,
    };
  }

  function ensureHeroEntity(G) {
    const ENT = G.ENT || window.ENT || {};
    const heroKind = ENT.PLAYER;
    if (G.player && !G.player.dead) {
      G.player.rigOk = G.player.rigOk === true || !!G.player.puppet;
      return G.player;
    }
    const candidates = Array.isArray(G.entities) ? G.entities.filter((e) => e && !e.dead && (e.isPlayer || matchesHeroKind(e))) : [];
    if (candidates.length) {
      const hero = candidates[0];
      G.player = hero;
      hero.rigOk = hero.rigOk === true || !!hero.puppet;
      return hero;
    }
    const pos = pickWorldPosition(G, {});
    const hero = window.Entities?.Hero?.spawnPlayer?.(pos.x, pos.y, { units: 'px' }) || null;
    if (hero) {
      registerSpawnedEntity(G, hero);
      G.player = hero;
      hero.rigOk = hero.rigOk === true || !!hero.puppet;
      try { window.AI?.register?.(hero); } catch (_) {}
    }
    return hero;

    function matchesHeroKind(entity) {
      if (!entity) return false;
      if (entity.isPlayer === true) return true;
      if (entity.kind === heroKind) return true;
      if (typeof entity.kind === 'string') return entity.kind.toUpperCase() === 'PLAYER';
      return false;
    }
  }

  function ensureDebugPatients(G, hero) {
    const patients = Array.isArray(G.patients) ? G.patients.filter((p) => p && !p.dead) : [];
    if (patients.length === 0) {
      const pos = pickWorldPosition(G, { near: hero, offsetTy: 1, anchorX: 0.2, anchorY: 0.15 });
      const patient = window.PatientsAPI?.createPatient?.(pos.x, pos.y, {})
        || window.Entities?.Patient?.spawn?.(pos.x, pos.y, {})
        || null;
      if (patient) {
        registerSpawnedEntity(G, patient);
        patients.push(patient);
      }
    }
    for (const patient of patients) {
      if (!patient) continue;
      if (!patient.pillId) {
        const pill = window.PatientsAPI?.createPillForPatient?.(patient, 'near') || null;
        if (pill) {
          pill.patientId = pill.patientId || patient.id;
          pill.forPatientId = pill.forPatientId || patient.id;
          registerSpawnedEntity(G, pill);
          if (pill.id) patient.pillId = pill.id;
        }
      }
      if (!patient.bellId) {
        const bell = window.BellsAPI?.spawnBellNear?.(patient, { patientId: patient.id })
          || window.BellsAPI?.spawnBell?.(patient.x + patient.w * 0.6, patient.y - TILE * 0.5, { patientId: patient.id })
          || window.spawnBellNear?.(patient, { patientId: patient.id })
          || null;
        if (bell) {
          registerSpawnedEntity(G, bell);
          if (bell.id) patient.bellId = bell.id;
        }
      }
    }
    const activePatients = Array.isArray(G.patients) ? G.patients.filter((p) => p && !p.dead) : [];
    G.patientsTotal = Math.max(G.patientsTotal | 0, activePatients.length);
    G.patientsPending = Math.max(G.patientsPending | 0, activePatients.length);
    syncPatientCounters(G);
  }

  function ensureSupportEntities(G, hero) {
    const ENT = G.ENT || window.ENT || {};
    const hasDoor = Array.isArray(G.doors) && G.doors.some((d) => d && (d.bossDoor || d.isBossDoor || d.kind === (ENT.DOOR ?? 'DOOR')));
    if (!hasDoor) {
      const pos = pickWorldPosition(G, { near: hero, offsetTy: 3 });
      const door = window.Entities?.Door?.spawn?.(pos.x, pos.y, { bossDoor: true, locked: true }) || null;
      if (door) registerSpawnedEntity(G, door);
    }

    const hasCart = Array.isArray(G.pushables) && G.pushables.some((c) => c && c.pushable);
    if (!hasCart) {
      const pos = pickWorldPosition(G, { near: hero, offsetTx: 1, offsetTy: 1 });
      const cart = window.Entities?.Cart?.spawn?.('urgencias', pos.x, pos.y, {})
        || window.CartsAPI?.spawn?.('urgencias', pos.x, pos.y, {})
        || null;
      if (cart) {
        cart.pushable = true;
        registerSpawnedEntity(G, cart);
      }
    }

    const hasPhone = Array.isArray(G.entities) && G.entities.some((e) => e && (e.kindName === 'PHONE' || e.type === 'phone'));
    if (!hasPhone && typeof window.spawnPhone === 'function') {
      const pos = pickWorldPosition(G, { near: hero, offsetTx: -1, anchorX: 0.35, anchorY: 0.2 });
      const phone = window.spawnPhone(pos.x, pos.y, {});
      if (phone) registerSpawnedEntity(G, phone);
    }

    const hasElevator = Array.isArray(G.elevators) && G.elevators.length > 0;
    if (!hasElevator) {
      const pos = pickWorldPosition(G, { near: hero, offsetTx: -2, offsetTy: 2 });
      const elevator = window.Entities?.Elevator?.spawn?.(pos.x, pos.y, { pairId: 'placement_auto' })
        || window.ElevatorsAPI?.spawnElevator?.(pos.x, pos.y, { pairId: 'placement_auto' })
        || null;
      if (elevator) registerSpawnedEntity(G, elevator);
    }

    const ensureNpc = (id, spawnFn, offsetIdx) => {
      const exists = Array.isArray(G.npcs) && G.npcs.some((npc) => {
        if (!npc) return false;
        const tag = (npc.aiId || npc.role || npc.kindName || '').toUpperCase();
        return tag.includes(id);
      });
      if (exists) return;
      const pos = pickWorldPosition(G, { near: hero, offsetTx: 1 + (offsetIdx || 0), offsetTy: 1 + (offsetIdx || 0) * 0.5 });
      const npc = spawnFn?.(pos.x, pos.y) || null;
      if (npc) {
        npc.isNPC = true;
        registerSpawnedEntity(G, npc);
        try { window.AI?.register?.(npc); } catch (_) {}
      }
    };

    ensureNpc('MEDIC', (x, y) => window.MedicoAPI?.spawn?.(x, y, {}) || window.Entities?.NPC?.spawn?.('medico', x, y, {}), 0);
    ensureNpc('JEFESERVICIO', (x, y) => window.JefeServicioAPI?.spawn?.(x, y, {}) || window.SupervisoraAPI?.spawn?.(x, y, { role: 'jefe' }), 1);
    ensureNpc('GUARDIA', (x, y) => window.GuardiaAPI?.spawn?.(x, y, {}) || window.Entities?.NPC?.spawn?.('guardia', x, y, {}), 2);
    ensureNpc('FAMILIAR', (x, y) => window.FamiliarMolestoAPI?.spawn?.(x, y, {}) || window.Entities?.NPC?.spawn?.('familiar', x, y, {}), 3);
    ensureNpc('CELADOR', (x, y) => window.CeladorAPI?.spawn?.(x, y, {}) || window.Entities?.NPC?.spawn?.('celador', x, y, {}), 4);
  }

  function snapshotWorld(G) {
    const counts = {};
    const add = (key, value) => {
      counts[key] = (counts[key] || 0) + value;
    };
    if (G.player && !G.player.dead) add('HERO', 1);
    add('PATIENT', Array.isArray(G.patients) ? G.patients.filter((p) => p && !p.dead).length : 0);
    add('PILL', Array.isArray(G.pills) ? G.pills.length : 0);
    add('BELL', Array.isArray(G.bells) ? G.bells.length : 0);
    add('NPC', Array.isArray(G.npcs) ? G.npcs.length : 0);
    add('ENEMY', Array.isArray(G.enemies) ? G.enemies.length : 0);
    add('DOOR', Array.isArray(G.doors) ? G.doors.length : 0);
    add('ELEVATOR', Array.isArray(G.elevators) ? G.elevators.length : 0);
    add('CART', Array.isArray(G.pushables) ? G.pushables.filter((e) => e && e.pushable).length : 0);
    return {
      countsPorTipo: counts,
      total: Array.isArray(G.entities) ? G.entities.length : 0,
    };
  }

  function applyFromAsciiMap(levelCfg = {}) {
    const W = window;
    const G = levelCfg.G || W.G || (W.G = {});
    if (levelCfg.G && W.G !== levelCfg.G) {
      W.G = levelCfg.G;
    }
    const mode = levelCfg.mode || (G.debugMap ? 'debug' : 'normal');

    if (G.__placementsApplied === true) {
      const summaryGuard = snapshotWorld(G);
      lastSummary = summaryGuard;
      return { applied: false, reason: 'guard', summary: summaryGuard };
    }

    G._lastLevelCfg = levelCfg;

    let placements = [];
    let allowAscii = false;
    try {
      const resolved = resolvePlacementList(levelCfg, G) || {};
      placements = Array.isArray(resolved.list) ? resolved.list : [];
      allowAscii = !!resolved.allowAscii;
    } catch (err) {
      console.warn('[Placement] resolvePlacementList error', err);
    }

    if ((!Array.isArray(placements) || placements.length === 0) && mode === 'normal') {
      try {
        placements = buildDefaultNormalPlacements(G);
        allowAscii = false;
        if (Array.isArray(placements) && placements.length) {
          console.info('[Placement] usando plantilla por defecto (normal)');
          try { window.LOG?.event?.('PLACEMENT_FALLBACK', { mode, template: 'default-normal' }); } catch (_) {}
        }
      } catch (err) {
        console.warn('[Placement] fallback default-normal error', err);
      }
    }

    let appliedMapgen = false;
    if (Array.isArray(placements) && placements.length) {
      try {
        if (allowAscii) G.__allowASCIIPlacements = true;
        window.__PLACEMENT_SUPPRESS_INTERNAL_SUMMARY__ = true;
        const result = applyPlacementsFromMapgen(placements, { G, mode });
        appliedMapgen = result?.skipped ? false : result?.applied !== false;
      } catch (err) {
        console.warn('[Placement] applyFromAsciiMap error', err);
      } finally {
        delete window.__PLACEMENT_SUPPRESS_INTERNAL_SUMMARY__;
        if (allowAscii) delete G.__allowASCIIPlacements;
      }
    }

    const hero = ensureHeroEntity(G);
    if (mode === 'debug') {
      ensureDebugPatients(G, hero);
    } else {
      syncPatientCounters(G);
    }
    ensureSupportEntities(G, hero);

    const finalize = window.__placementFinalize || finalizePlacement;
    finalize(mode, { G });

    G.__placementsApplied = true;
    G._hasPlaced = true;
    G._placementMode = mode;

    const summary = snapshotWorld(G);
    lastSummary = summary;
    try { window.LOG?.event?.('PLACEMENT_SUMMARY', summary); } catch (_) {}

    return { applied: true, summary, hero, mode, mapgen: appliedMapgen };
  }

  function placementShouldRun(levelCfg = {}) {
    const W = window;
    const G = levelCfg.G || W.G || (W.G = {});
    if (levelCfg.G && W.G !== levelCfg.G) {
      W.G = levelCfg.G;
    }
    const mode = levelCfg.mode || (G.debugMap ? 'debug' : 'normal');
    if (G.__placementsApplied) return false;
    const runGuard = W.__placementShouldRun || (() => true);
    const allowed = runGuard(mode, { G, mode });
    return allowed !== false && !G.__placementsApplied;
  }

  function summarizePlacements() {
    const G = window.G || {};
    const snapshot = snapshotWorld(G);
    lastSummary = snapshot;
    console.log('PLACEMENT_SUMMARY', snapshot);
    try { window.LOG?.event?.('PLACEMENT_SUMMARY', snapshot); } catch (_) {}
    return snapshot;
  }

  window.Placement = {
    applyFromAsciiMap,
    shouldRun: placementShouldRun,
    summarize: summarizePlacements
  };

  window.applyPlacementsFromMapGen = (arg0, arg1) => {
    if (Array.isArray(arg0)) {
      return applyPlacementsFromMapgen(arg0, arg1);
    }
    if (typeof arg0 === 'string') {
      const cfg = (arg1 && typeof arg1 === 'object') ? { ...arg1, ascii: arg0 } : { ascii: arg0 };
      return window.Placement.applyFromAsciiMap(cfg);
    }
    if (arg0 && typeof arg0 === 'object') {
      return window.Placement.applyFromAsciiMap(arg0);
    }
    return window.Placement.applyFromAsciiMap({});
  };
  window.shouldRunPlacement = (cfg) => window.Placement.shouldRun(cfg);

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
