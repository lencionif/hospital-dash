(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const ENT = G.ENT || (G.ENT = {
    PLAYER: 'PLAYER',
    PATIENT: 'PATIENT',
    FURIOUS: 'FURIOUS',
    PILL: 'PILL'
  });
  const TILE = W.TILE_SIZE ?? W.TILE ?? G.TILE_SIZE ?? 32;

  function ensureStats() {
    G.stats = G.stats || {};
    if (typeof G.stats.totalPatients !== 'number') G.stats.totalPatients = 0;
    if (typeof G.stats.remainingPatients !== 'number') G.stats.remainingPatients = 0;
    if (typeof G.stats.activeFuriosas !== 'number') G.stats.activeFuriosas = 0;
    if (typeof G.stats.furiosasNeutralized !== 'number') G.stats.furiosasNeutralized = 0;
    return G.stats;
  }

  function ensureCollections() {
    G.entities = Array.isArray(G.entities) ? G.entities : (G.entities = []);
    G.movers = Array.isArray(G.movers) ? G.movers : (G.movers = []);
    G.patients = Array.isArray(G.patients) ? G.patients : (G.patients = []);
    G.allPatients = Array.isArray(G.allPatients) ? G.allPatients : (G.allPatients = []);
    G.pills = Array.isArray(G.pills) ? G.pills : (G.pills = []);
    G.npcs = Array.isArray(G.npcs) ? G.npcs : (G.npcs = []);
    G._patientsByKey = G._patientsByKey || new Map();
  }

  function isBlockedRect(x, y, w, h) {
    const map = G.map || [];
    if (!map.length) return false;
    const ts = TILE;
    const x0 = Math.floor(x / ts);
    const y0 = Math.floor(y / ts);
    const x1 = Math.floor((x + w) / ts);
    const y1 = Math.floor((y + h) / ts);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (map[ty]?.[tx] === 1) return true;
      }
    }
    return false;
  }

  function addEntity(e) {
    if (!e) return;
    ensureCollections();
    if (!G.entities.includes(e)) G.entities.push(e);
    if (e.dynamic || !e.static) {
      if (!G.movers.includes(e)) G.movers.push(e);
    }
  }

  function removeEntity(e) {
    if (!e) return;
    if (Array.isArray(G.entities)) G.entities = G.entities.filter((x) => x !== e);
    if (Array.isArray(G.patients)) G.patients = G.patients.filter((x) => x !== e);
    if (Array.isArray(G.allPatients)) G.allPatients = G.allPatients.filter((x) => x !== e);
    if (Array.isArray(G.npcs)) G.npcs = G.npcs.filter((x) => x !== e);
    if (Array.isArray(G.movers)) G.movers = G.movers.filter((x) => x !== e);
    if (Array.isArray(G.pills)) G.pills = G.pills.filter((x) => x !== e);
    try { W.MovementSystem?.unregister?.(e); } catch (_) {}
    if (e.id && G._patientsByKey instanceof Map) {
      for (const [k, v] of [...G._patientsByKey.entries()]) {
        if (v === e) G._patientsByKey.delete(k);
      }
    }
  }

  function nextIdentity() {
    ensureStats();
    const seedBase = (G.levelSeed ?? G.seed ?? G.mapSeed ?? Date.now()) >>> 0;
    if (!G._patientRoster) {
      try { W.PatientNames?.reset?.(seedBase); } catch (_) {}
      G._patientRoster = { seed: seedBase, count: 0 };
    }
    const roster = G._patientRoster;
    const assign = (W.PatientNames && typeof W.PatientNames.next === 'function')
      ? W.PatientNames.next(roster.seed + roster.count)
      : {
          displayName: `Paciente ${roster.count + 1}`,
          keyName: `PACIENTE${roster.count + 1}`,
          anagram: `PAC${roster.count + 1}`,
          nameTagYOffset: 18
        };
    roster.count += 1;
    return assign;
  }

  function registerPatient(e) {
    ensureCollections();
    ensureStats();
    if (!G.entities.includes(e)) G.entities.push(e);
    if (!G.patients.includes(e)) G.patients.push(e);
    if (!G.allPatients.includes(e)) G.allPatients.push(e);
    if (!G.npcs.includes(e)) G.npcs.push(e);
    if (G._patientsByKey instanceof Map) {
      G._patientsByKey.set(e.keyName, e);
    }
    const stats = ensureStats();
    stats.totalPatients = Math.min(35, (stats.totalPatients || 0) + 1);
    stats.remainingPatients = Math.min(35, (stats.remainingPatients || 0) + 1);
    try { W.GameFlowAPI?.notifyPatientCountersChanged?.(); } catch (_) {}
  }

  function createPatient(x, y, opts = {}) {
    ensureCollections();
    const identity = opts.identity || nextIdentity();
    const stats = ensureStats();

    const patient = {
      id: opts.id || `PAT_${Math.random().toString(36).slice(2, 9)}`,
      kind: ENT.PATIENT,
      x: x || 0,
      y: y || 0,
      w: opts.w || TILE * 0.9,
      h: opts.h || TILE * 0.75,
      static: true,
      solid: true,
      displayName: identity.displayName,
      name: identity.displayName,
      keyName: identity.keyName,
      anagram: identity.anagram,
      nameTagYOffset: identity.nameTagYOffset ?? 18,
      attended: false,
      furious: false,
      requiredKeyName: identity.keyName,
      identitySeed: identity.seed,
      identityIndex: identity.index,
      spriteKey: opts.spriteKey || 'patient',
      skin: opts.skin || 'patient',
      bellId: null,
      ringing: false
    };

    try { W.PuppetAPI?.attach?.(patient, { rig: 'patient.std', z: 0, scale: 1, data: { skin: patient.skin } }); } catch (_) {}

    addEntity(patient);
    registerPatient(patient);
    return patient;
  }

  function createPillForPatient(patient, mode = 'near') {
    if (!patient) return null;
    ensureCollections();
    const stats = ensureStats();
    const radius = TILE * 1.6;
    let px = patient.x + patient.w * 0.5;
    let py = patient.y + patient.h * 0.5;
    let placed = false;
    if (mode === 'near') {
      const offsets = [0, 1, 2, 3, 4, 5].map(i => ((patient.identityIndex || 0) + i) * (Math.PI / 3));
      for (const ang of offsets) {
        const candidateX = px + Math.cos(ang) * radius - TILE * 0.25;
        const candidateY = py + Math.sin(ang) * radius - TILE * 0.25;
        if (!isBlockedRect(candidateX, candidateY, TILE * 0.5, TILE * 0.5)) {
          px = candidateX;
          py = candidateY;
          placed = true;
          break;
        }
      }
    }
    if (!placed) {
      for (let i = 0; i < 60; i++) {
        const tx = Math.floor(Math.random() * (G.map?.[0]?.length || 1));
        const ty = Math.floor(Math.random() * (G.map?.length || 1));
        const candidateX = tx * TILE + TILE * 0.25;
        const candidateY = ty * TILE + TILE * 0.25;
        if (!isBlockedRect(candidateX, candidateY, TILE * 0.5, TILE * 0.5)) {
          px = candidateX;
          py = candidateY;
          break;
        }
      }
    }
    const pill = {
      id: `PILL_${Math.random().toString(36).slice(2, 9)}`,
      kind: ENT.PILL,
      x: px,
      y: py,
      w: TILE * 0.5,
      h: TILE * 0.5,
      solid: false,
      dynamic: false,
      label: `Pastilla de ${patient.displayName}`,
      pairName: patient.keyName,
      targetName: patient.displayName,
      anagram: patient.anagram,
      spriteKey: 'pill.generic'
    };
    try { W.PuppetAPI?.attach?.(pill, { rig: 'pill.generic', z: 0, scale: 1 }); } catch (_) {}
    addEntity(pill);
    if (!G.pills.includes(pill)) G.pills.push(pill);
    return pill;
  }

  function deliver(patient, pill) {
    if (!patient || patient.attended) return false;
    ensureStats();
    patient.attended = true;
    patient.furious = false;
    patient.solid = false;
    patient.hidden = true;
    patient.dead = true;
    patient.attendedAndMatched = true;
    patient.delivered = true;
    patient.pillSatisfied = true;
    if (G._patientsByKey instanceof Map) G._patientsByKey.delete(patient.keyName);
    removeEntity(patient);
    if (pill) removeEntity(pill);
    const stats = ensureStats();
    stats.remainingPatients = Math.max(0, (stats.remainingPatients || 0) - 1);
    try { W.GameFlowAPI?.notifyPatientDelivered?.(patient); } catch (_) {}
    try { W.ScoreAPI?.addScore?.(100, 'deliver_patient', { patient: patient.displayName }); } catch (_) {}
    try { W.GameFlowAPI?.notifyPatientCountersChanged?.(); } catch (_) {}
    return true;
  }

  function wrongDelivery(patient) {
    if (!patient) return;
    try { W.HUD?.showFloatingMessage?.(patient, 'Paciente incorrecto. Busca al paciente.', 1.8); } catch (_) {}
  }

  function removePillForKey(keyName) {
    if (!keyName) return;
    for (const e of [...(G.entities || [])]) {
      if (e && e.kind === ENT.PILL && e.pairName === keyName) {
        removeEntity(e);
      }
    }
  }

  function dropCarriedPillIfMatches(keyName) {
    if (!keyName) return;
    const carry = G.carry;
    if (carry && carry.pairName === keyName) {
      G.carry = null;
      try { W.ArrowGuide?.clearTarget?.(); } catch (_) {}
      const player = G.player || { x: 0, y: 0, w: 1, h: 1, id: 'player' };
      try { W.HUD?.showFloatingMessage?.(player, 'La pastilla se ha retirado', 1.6); } catch (_) {}
    }
  }

  function convertToFuriosa(patient) {
    if (!patient || patient.furious || patient.attended) return null;
    removePillForKey(patient.keyName);
    dropCarriedPillIfMatches(patient.keyName);
    patient.furious = true;
    patient.dead = true;
    if (G._patientsByKey instanceof Map) G._patientsByKey.delete(patient.keyName);
    const stats = ensureStats();
    stats.remainingPatients = Math.max(0, (stats.remainingPatients || 0) - 1);
    stats.activeFuriosas = (stats.activeFuriosas || 0) + 1;
    removeEntity(patient);
    let furiosa = null;
    if (W.FuriousAPI && typeof W.FuriousAPI.spawnFromPatient === 'function') {
      try { furiosa = W.FuriousAPI.spawnFromPatient(patient); } catch (e) { console.warn('FuriousAPI.spawnFromPatient', e); }
    }
    if (!furiosa) {
      furiosa = {
        id: `FUR_${Math.random().toString(36).slice(2, 9)}`,
        kind: ENT.FURIOUS,
        x: patient.x,
        y: patient.y,
        w: patient.w,
        h: patient.h,
        solid: true,
        vx: 0,
        vy: 0,
        color: '#ff5d6c'
      };
      addEntity(furiosa);
    }
    try { W.GameFlowAPI?.notifyPatientCountersChanged?.(); } catch (_) {}
    return furiosa;
  }

  function onFuriosaNeutralized(furiosa) {
    if (furiosa) {
      if (furiosa._countedNeutralized) return;
      furiosa._countedNeutralized = true;
    }
    const stats = ensureStats();
    stats.activeFuriosas = Math.max(0, (stats.activeFuriosas || 0) - 1);
    stats.furiosasNeutralized = (stats.furiosasNeutralized || 0) + 1;
    try { W.GameFlowAPI?.notifyPatientCountersChanged?.(); } catch (_) {}
  }

  function getPatients() {
    ensureCollections();
    return G.patients.slice();
  }

  function getAllPatients() {
    ensureCollections();
    return G.allPatients.slice();
  }

  function getPills() {
    ensureCollections();
    return G.pills.slice();
  }

  function isAllDelivered() {
    const stats = ensureStats();
    return (stats.remainingPatients || 0) === 0;
  }

  function findByKeyName(keyName) {
    if (!keyName) return null;
    if (G._patientsByKey instanceof Map) return G._patientsByKey.get(keyName) || null;
    return (G.patients || []).find((p) => p && p.keyName === keyName) || null;
  }

  function generateSet(opts = {}) {
    const count = Math.max(0, Math.min(35, opts.count ?? 7));
    const created = [];
    for (let i = 0; i < count; i++) {
      const x = (opts.baseX ?? TILE) + (i % 5) * TILE * 2.2;
      const y = (opts.baseY ?? TILE) + Math.floor(i / 5) * TILE * 1.8;
      const patient = createPatient(x, y, {});
      const pill = createPillForPatient(patient, 'near');
      created.push({ patient, pill });
    }
    return created;
  }

  const PatientsAPI = {
    createPatient,
    createPillForPatient,
    deliver,
    wrongDelivery,
    toFurious: convertToFuriosa,
    onFuriosaNeutralized,
    getPatients,
    getAllPatients,
    getPills,
    isAllDelivered,
    findByKeyName,
    generateSet,
    ensureStats,
    ensureCollections
  };

  W.PatientsAPI = PatientsAPI;

  W.Entities = W.Entities || {};
  W.Entities.Patient = W.Entities.Patient || {};
  W.Entities.Patient.spawn = function (x, y, opts) {
    const patient = createPatient(x, y, opts || {});
    return patient;
  };

  W.Entities.Objects = W.Entities.Objects || {};
  W.Entities.Objects.spawnPill = function (_name, x, y, opts = {}) {
    if (opts.patient) return createPillForPatient(opts.patient, opts.mode || 'near');
    const target = findByKeyName(opts.pairName || opts.keyName || opts.targetName || _name);
    if (target) return createPillForPatient(target, opts.mode || 'near');
    const pill = {
      id: `PILL_${Math.random().toString(36).slice(2, 9)}`,
      kind: ENT.PILL,
      x: (x || 0) - TILE * 0.25,
      y: (y || 0) - TILE * 0.25,
      w: TILE * 0.5,
      h: TILE * 0.5,
      solid: false,
      label: 'Pastilla',
      pairName: opts.pairName || opts.keyName || opts.targetName || null
    };
    addEntity(pill);
    if (!G.pills.includes(pill)) G.pills.push(pill);
    return pill;
  };

  W.Patients = PatientsAPI;
})(this);
