// filename: patients.entities.js
// Sistema de Pacientes (7 parejas) + Pastillas + Timbres + Furiosa.
// - 7 pacientes con 7 pastillas y 7 timbres.
// - Entregar la pastilla correcta apaga el timbre, marca al paciente como atendido
//   y deja de contar como “paciente normal” (cambia a kind=PATIENT_DONE).
// - Si expira el timbre (random 5–10 min), el paciente se transforma en Paciente Furiosa.
// - Se integra con placement.api.js a través de window.Entities.Patient.spawn.
// - Incluye shims de Entities.Objects.spawnPill/spawnBell si no existen.
// - Auto-hook opcional al bucle si G.systems está disponible.

(function (W) {
  'use strict';

  const G   = W.G || (W.G = {});
  const ENT = G.ENT || (G.ENT = {
    PLAYER:'PLAYER',
    PATIENT:'PATIENT',
    PATIENT_DONE:'PATIENT_DONE',
    FURIOUS:'FURIOUS',
    PILL:'PILL',
    BELL:'BELL'
  });
  const TILE = (W.TILE_SIZE ?? W.TILE ?? G.TILE_SIZE ?? 32);

  // ==== Balance (puedes ajustar en runtime con PatientsAPI.setBalance) ====
  const DEF = {
    minPairs: 7,
    maxPairs: 7,
    // <-- Lo que pediste: 5–10 minutos para atender/apagar timbre
    ringMinMs: 5 * 60 * 1000,   // 5 minutos
    ringMaxMs: 10 * 60 * 1000,  // 10 minutos
    ringWarnMs: 15 * 1000,      // aviso sonoro/visual en los últimos 15s

    // Apariencia / físicas mínimas
    patientW: 28, patientH: 24,
    pillW: 14, pillH: 14,
    bellW: 12, bellH: 12,

    // IA furiosa básica (fallback; si tienes furious.plugin.js úsalo)
    furiousSpeed: 1.35,
    furiousDamage: 1,
    furiousLightColor: 'rgba(255,80,100,0.35)',

    // Efecto campana
    bellPulseHz: 1.2,
  };

  // Catálogo de parejas “pastilla ↔ paciente”
  // Nota: los nombres son las “claves” que tienen que coincidir.
  const PAIRS_CATALOG = [
    { pill: 'analgesico',     label: 'Paciente con dolor' },
    { pill: 'antibiotico',    label: 'Paciente con infección' },
    { pill: 'ansiolitico',    label: 'Paciente ansioso' },
    { pill: 'antipsicotico',  label: 'Paciente delirante' },
    { pill: 'diuretico',      label: 'Paciente con edemas' },
    { pill: 'anticoagulante', label: 'Paciente trombótico' },
    { pill: 'broncodilat',    label: 'Paciente asmático' },
    // Añade más si quieres, pero el set inicial fuerza 7 únicos.
  ];

  // === Estado / helpers breves ===
  const entities = () => (G.entities || (G.entities = []));
  const now = () => (performance && performance.now) ? performance.now() : Date.now();

  // RNG semillado si existe
  const rng = (() => {
    if (G.seededRandom) return G.seededRandom;
    if (typeof G.makeRNG === 'function') return G.makeRNG(G.seed || 1234567);
    let s = (G.seed || 0x9E3779B1) >>> 0;
    const mulberry32 = (a)=>()=>{let t=(a+=0x6D2B79F5);t=Math.imul(t^(t>>>15), t|1);t^=t+Math.imul(t^(t>>>7), t|61);return((t^(t>>>14))>>>0)/4294967296;};
    return mulberry32(s);
  })();

  // ==== Utils geométricos mínimos ====
  function aabb(a,b){ return a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  function dist2(a,b){ const dx=(a.x+a.w/2)-(b.x+b.w/2), dy=(a.y+a.h/2)-(b.y+b.h/2); return dx*dx+dy*dy; }
  function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
  function isWallTile(tx,ty){ const m=G.map||[]; return !m[ty] || m[ty][tx]===1; }
  function isWallRect(x,y,w,h){
    const gx0=Math.floor(x/TILE), gy0=Math.floor(y/TILE);
    const gx1=Math.floor((x+w-1)/TILE), gy1=Math.floor((y+h-1)/TILE);
    for(let gy=gy0; gy<=gy1; gy++){
      for(let gx=gx0; gx<=gx1; gx++){
        if(isWallTile(gx,gy)) return true;
      }
    }
    return false;
  }

  // ==== Creadores ===========================================================
  let _id=0; const nextId = (p)=> `${p}_${(++_id).toString(36)}`;

  function BAL(){ return { ...(G.BALANCE?.patients||{}), ...DEF, ...G.BALANCE?.patients }; }

  function createPatient(x,y, p={}){
    const B = BAL();
    const pair = p.pair || pickRandomPair();
    const tMin = Math.min(B.ringMinMs, B.ringMaxMs);
    const tMax = Math.max(B.ringMinMs, B.ringMaxMs);
    const deadline = Math.floor(rng()*(tMax - tMin)) + tMin;

    const e = {
      id: nextId('PAT'),
      kind: ENT.PATIENT,
      x, y, w:B.patientW, h:B.patientH,
      requiredPillName: pair.pill,
      label: pair.label,
      skin: 'patient', static:true, solid:true,
      ringing: false,
      ringDeadline: deadline,  // ms restantes
      bellId: null,
      attended: false
    };

    // timbre asociado al paciente (al lado de la cama)
    const bell = createBellNear(e);
    e.bellId = bell?.id || null;

    // registro
    entities().push(e);
    G.patients = G.patients || [];
    G.npcs = G.npcs || [];
    G.patients.push(e); G.npcs.push(e);

    // luz tenue en habitación (opcional)
    if (Array.isArray(G.roomLights)) {
      G.roomLights.push({ x:e.x+B.patientW*0.5, y:e.y+B.patientH*0.5, r:5*TILE, baseA:0.22 });
    }

    return e;
  }

  function createPillForPatient(patient, mode='near'){
    const B = BAL();
    // por defecto cerca del paciente pero no encima de paredes
    let pos = null;
    if (mode==='near'){
      const angles=[0,Math.PI/3,2*Math.PI/3,Math.PI,4*Math.PI/3,5*Math.PI/3];
      for (const a of angles){
        const r = TILE*1.3;
        const px = patient.x + B.patientW*0.5 + Math.cos(a)*r - B.pillW*0.5;
        const py = patient.y + B.patientH*0.5 + Math.sin(a)*r - B.pillH*0.5;
        if (!isWallRect(px,py,B.pillW,B.pillH)){ pos={x:px,y:py}; break; }
      }
    }
    if (!pos){
      // fallback: buscar casillas libres aleatorias
      for (let i=0;i<80;i++){
        const tx = Math.floor(rng()* (G.map[0]?.length||40));
        const ty = Math.floor(rng()* (G.map.length||30));
        const px = tx*TILE + (TILE - B.pillW)*0.5;
        const py = ty*TILE + (TILE - B.pillH)*0.5;
        if (!isWallRect(px,py,B.pillW,B.pillH)){ pos={x:px,y:py}; break; }
      }
    }
    if (!pos) return null;

    const pill = {
      id: nextId('PILL'),
      kind: ENT.PILL,
      x: pos.x, y: pos.y, w: B.pillW, h: B.pillH,
      name: patient.requiredPillName,
      skin: `pill_${patient.requiredPillName}`,
      targetId: patient.id,
    };
    entities().push(pill);
    G.pills = G.pills || []; G.pills.push(pill);
    return pill;
  }

  function createBellNear(patient){
    const B=BAL();
    const spots = [
      {dx: -TILE*0.6, dy: 0},
      {dx:  TILE*0.6, dy: 0},
      {dx:  0, dy: -TILE*0.6},
      {dx:  0, dy:  TILE*0.6},
    ];
    for (const s of spots){
      const x = patient.x + B.patientW*0.5 + s.dx - B.bellW*0.5;
      const y = patient.y + B.patientH*0.5 + s.dy - B.bellH*0.5;
      if (!isWallRect(x,y,B.bellW,B.bellH)){
        const bell = {
          id: nextId('BELL'),
          kind: ENT.BELL,
          x, y, w:B.bellW, h:B.bellH,
          skin: 'bell',
          pulse: 0,
          ownerId: patient.id
        };
        entities().push(bell);
        G.bells = G.bells || []; G.bells.push(bell);
        return bell;
      }
    }
    return null;
  }

  // ==== Generación del set de 7 parejas ====================================
  function pickUnique(n, arr){
    const pool=[...arr], out=[];
    while (n-- > 0 && pool.length){
      const i = Math.floor(rng()*pool.length);
      out.push(pool.splice(i,1)[0]);
    }
    return out;
  }

  function resolvePlacement(placeFn){
    // placeFn(): {x,y} (píxeles) sobre suelo libre
    if (typeof placeFn==='function'){
      for (let i=0;i<60;i++){
        const p = placeFn(); if (!p) continue;
        if (!isWallRect(p.x,p.y,DEF.patientW,DEF.patientH)) return p;
      }
      return null;
    }
    // fallback: barrido aleatorio de casillas libres
    for (let i=0;i<400;i++){
      const tx=Math.floor(rng()*(G.map[0]?.length||40));
      const ty=Math.floor(rng()*(G.map.length||30));
      if (!isWallTile(tx,ty)){
        return { x: tx*TILE+(TILE-DEF.patientW)*0.5, y: ty*TILE+(TILE-DEF.patientH)*0.5 };
      }
    }
    return null;
  }

  function pickRandomPair(){ return PAIRS_CATALOG[Math.floor(rng()*PAIRS_CATALOG.length)]; }

  function generateSet(opts={}){
    const B = BAL();
    const n = clamp((opts.count ?? B.minPairs), B.minPairs, B.maxPairs); // fuerza 7
    const pairs = pickUnique(n, PAIRS_CATALOG);
    const created = [];

    for (let i=0;i<n;i++){
      const pos = resolvePlacement(opts.place);
      if (!pos) break;
      const pair = pairs[i] || pickRandomPair();
      const pat = createPatient(pos.x,pos.y,{ pair });
      const pill = createPillForPatient(pat, opts.pillsWhere || 'near');
      created.push({ patient:pat, pill });
    }

    // crea 1–2 camas vacías (decoración) opcionalmente
    const empties = (typeof opts.emptyBeds==='number') ? opts.emptyBeds : (1 + Math.floor(rng()*2));
    for (let i=0;i<empties;i++){
      const pos = resolvePlacement(opts.place); if (!pos) break;
      entities().push({ id:nextId('BEDV'), kind:'BED_EMPTY', x:pos.x, y:pos.y, w:DEF.patientW, h:DEF.patientH, static:true, skin:'bed' });
    }

    return created;
  }

  // ==== Entrega / interacción ==============================================
  function tryAutoDeliverNear(patient, radiusTiles=1.2){
    if (!patient || patient.kind!==ENT.PATIENT || patient.attended) return false;
    const r2 = Math.pow(radiusTiles*TILE,2);
    for (const o of entities()){
      if (o.kind!==ENT.PILL) continue;
      if (o.name !== patient.requiredPillName) continue;
      const d = dist2(patient,o);
      if (d<=r2) { deliver(patient,o); return true; }
    }
    return false;
  }

  function deliver(patient, pill){
    // apagar timbre
    if (patient.bellId){
      const i = entities().findIndex(e=>e.id===patient.bellId);
      if (i>=0) entities().splice(i,1);
      patient.bellId = null;
    }
    // consumir pastilla
    const pi = entities().indexOf(pill); if (pi>=0) entities().splice(pi,1);
    G.pills = (G.pills||[]).filter(x=>x!==pill);

    // marcar atendido y que deje de contar como “normal”
    patient.attended = true;
    patient.ringing = false;
    patient.skin = 'patient_calm';
    patient.kind = ENT.PATIENT_DONE;     // <-- clave: ya no cuenta como paciente normal
    G.patients = (G.patients||[]).filter(x=>x!==patient);

    // métricas / HUD
    G.progress = G.progress || {};
    G.progress.patientsDelivered = (G.progress.patientsDelivered||0) + 1;
    if (typeof G.onPillDelivered==='function') G.onPillDelivered(patient);
    if (G.sfx?.pick) G.sfx.pick(patient);
  }

  function onPlayerInteract(player, radiusTiles=1.2){
    if (!player) return false;
    // paciente más cercano sin atender
    let near=null, best=Infinity, r2=Math.pow(radiusTiles*TILE,2);
    for (const e of entities()){
      if (e.kind!==ENT.PATIENT || e.attended) continue;
      const d = dist2(player,e);
      if (d<=r2 && d<best){ best=d; near=e; }
    }
    if (near){
      const ok = tryAutoDeliverNear(near);
      if (ok){
        if (G.sfx?.patientOk) G.sfx.patientOk(near);
        if (typeof G.onPatientAttended==='function') G.onPatientAttended(near);
        return true;
      } else {
        // pista opcional
        if (W.DialogAPI?.open){
          W.DialogAPI.open({
            portrait:'patient', title:near.label,
            text:`Creo que necesito “${near.requiredPillName}”. ¿La has visto?`,
            buttons:[{label:'OK', value:'ok'}], pauseGame:true
          });
          return true;
        }
      }
    }
    return false;
  }

  // ==== Expiración → Furiosa ===============================================
  function toFurious(patient){
    // elimina bell y al paciente original
    if (patient.bellId){
      const i = entities().findIndex(e=>e.id===patient.bellId);
      if (i>=0) entities().splice(i,1);
    }
    const pi = entities().indexOf(patient); if (pi>=0) entities().splice(pi,1);
    G.patients = (G.patients||[]).filter(x=>x!==patient);
    G.npcs     = (G.npcs||[]).filter(x=>x!==patient);

    // si tienes furious.plugin.js, úsalo
    if (W.FuriousAPI?.init){
      W.FuriousAPI.init(G);
      const f = W.FuriousAPI.spawnFromPatient(patient);
      if (f) return;
    }

    // fallback: furiosa mínima “perseguir jugador”
    const B=BAL();
    const f = {
      id: nextId('FUR'),
      kind: ENT.FURIOUS,
      x: patient.x, y: patient.y, w: patient.w, h: patient.h,
      vx:0, vy:0, speed:B.furiousSpeed, damage:B.furiousDamage, emitsLight:true,
      skin:'furious'
    };
    entities().push(f);
    G.enemies = G.enemies || []; G.enemies.push(f);
    if (G.sfx?.angry) G.sfx.angry(f);
  }

  // ==== Update loop =========================================================
  function updateAll(dtSec){
    const B = BAL(); const ms = (dtSec||0) * 1000;
    for (const e of [...entities()]){
      if (e.kind===ENT.PATIENT && !e.attended){
        if (!e.ringing) e.ringing = true;
        e.ringDeadline -= ms;

        // aviso en últimos segundos
        if (e.ringDeadline < B.ringWarnMs && now() - (e.lastWarnAt||0) > 150){
          e.lastWarnAt = now();
          if (G.sfx?.bellPing) G.sfx.bellPing(e);
        }

        if (e.ringDeadline <= 0){
          toFurious(e);
          continue;
        }
      }
      if (e.kind===ENT.BELL){
        e.pulse = (e.pulse||0) + (ms*0.001)*B.bellPulseHz*2*Math.PI;
      }
    }
  }

  // ==== Consultas ===========================================================
  function getPatients(){ return entities().filter(e=>e && e.kind===ENT.PATIENT && !e.attended); }
  function getAllPatients(){ return entities().filter(e=>e && (e.kind===ENT.PATIENT || e.kind===ENT.PATIENT_DONE)); }
  function getPills(){ return entities().filter(e=>e && e.kind===ENT.PILL); }
  function isAllDelivered(){ return getPatients().length===0; }

  // ==== API pública =========================================================
  const PatientsAPI = {
    createPatient, createPillForPatient, generateSet,
    onPlayerInteract, tryAutoDeliverNear, deliver,
    toFurious,
    updateAll,
    getPatients, getAllPatients, getPills, isAllDelivered,
    setBalance(patch){ G.BALANCE = G.BALANCE || {}; G.BALANCE.patients = { ...(G.BALANCE.patients||{}), ...(patch||{}) }; }
  };

  // ==== Integraciones / shims ==============================================
  // 1) placement.api.js llama a Entities.Patient.spawn(x,y,p) para "patient".
  //    (y a Entities.Objects.spawnPill/spawnBell para "pill"/"bell")
  W.Entities = W.Entities || {};
  W.Entities.Patient = W.Entities.Patient || {
    spawn(x,y,p){ return createPatient(x,y,p); }
  };

  W.Entities.Objects = W.Entities.Objects || {};
  if (!W.Entities.Objects.spawnPill){
    W.Entities.Objects.spawnPill = function(name, x, y, p){
      // Si viene desde placements, respeta el nombre
      const fakePat = { id: nextId('PFAKE'), requiredPillName: name };
      // Coloca exactamente en x,y si llegan:
      if (Number.isFinite(x) && Number.isFinite(y)){
        const B=BAL();
        const pill = {
          id: nextId('PILL'), kind: ENT.PILL,
          x: x - (B.pillW*0.5), y: y - (B.pillH*0.5), w:B.pillW, h:B.pillH,
          name, skin:`pill_${name}`, targetId: p?.targetId || null
        };
        entities().push(pill); G.pills=(G.pills||[]).push?G.pills:(G.pills=[]); G.pills.push(pill);
        return pill;
      }
      return createPillForPatient(fakePat,'near');
    };
  }
  if (!W.Entities.Objects.spawnBell){
    W.Entities.Objects.spawnBell = function(x,y,p){
      const B=BAL();
      const bell = {
        id: nextId('BELL'),
        kind: ENT.BELL,
        x: x - (B.bellW*0.5), y: y - (B.bellH*0.5), w:B.bellW, h:B.bellH,
        skin:'bell', pulse:0, ownerId: p?.ownerId || null
      };
      entities().push(bell); G.bells=(G.bells||[]).push?G.bells:(G.bells=[]); G.bells.push(bell);
      return bell;
    };
  }

  // 2) Auto-hook al bucle si existe sistema de “systems”
  try{
    if (Array.isArray(G.systems)) G.systems.push({ id:'patients', update: (dt)=>PatientsAPI.updateAll(dt) });
  }catch(_){}

  // 3) Export simple
  W.PatientsAPI = PatientsAPI;
  // --- Wrapper opcional para compatibilidad con placement.api.js ---
  window.Entities = window.Entities || {};
  window.Entities.Objects = window.Entities.Objects || {};
  if (!window.Entities.Objects.spawnPill){
    window.Entities.Objects.spawnPill = function(targetName, x, y, p){
      const PAPI = window.Entities?.Patient || window.PatientsAPI || window.Patients;
      // intenta por nombre/id → si no, el más cercano
      const all = (window.G?.entities||[]).filter(o=>o && o.kind===window.ENT?.PATIENT);
      let target = null;
      if (targetName){ target = all.find(o => (o.id===targetName || o.name===targetName || o.label===targetName)) || null; }
      if (!target){
        let best=Infinity; for (const o of all){ const d=(o.x-(x||o.x))**2+(o.y-(y||o.y))**2; if (d<best){best=d; target=o;} }
      }
      if (target && PAPI?.createPillForPatient) return PAPI.createPillForPatient(target,'near');
      return null;
    };
  }

})(this);