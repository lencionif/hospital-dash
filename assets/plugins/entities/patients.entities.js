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
    try { W.EntityGroups?.ensure?.(G); } catch (_) {}
    G._patientsByKey = G._patientsByKey || new Map();
    ensurePatientCounters();
  }

  function ensurePatientCounters() {
    if (!Number.isFinite(G.patientsTotal)) G.patientsTotal = 0;
    if (!Number.isFinite(G.patientsPending)) G.patientsPending = 0;
    if (!Number.isFinite(G.patientsCured)) G.patientsCured = 0;
    if (!Number.isFinite(G.patientsFurious)) G.patientsFurious = 0;
    if (!Array.isArray(G.patients)) G.patients = G.patients || [];
    if (Array.isArray(G.patients)) {
      G.patients.total = G.patientsTotal | 0;
      G.patients.pending = G.patientsPending | 0;
      G.patients.cured = G.patientsCured | 0;
      G.patients.furious = G.patientsFurious | 0;
    }
  }

  function syncPatientArrayCounters() {
    ensurePatientCounters();
    if (Array.isArray(G.patients)) {
      G.patients.total = G.patientsTotal | 0;
      G.patients.pending = G.patientsPending | 0;
      G.patients.cured = G.patientsCured | 0;
      G.patients.furious = G.patientsFurious | 0;
    }
  }

  function counterSnapshot() {
    syncPatientArrayCounters();
    return {
      total: G.patientsTotal | 0,
      pending: G.patientsPending | 0,
      cured: G.patientsCured | 0,
      furious: G.patientsFurious | 0
    };
  }

  function emitPatientsCounter() {
    try { W.LOG?.event?.('PATIENTS_COUNTER', counterSnapshot()); } catch (_) {}
  }

  const PILL_SKINS = [
    'pastilla_analitica.png',
    'pastilla_azul.png',
    'pastilla_gaviscon.png',
    'pastilla_luzon.png',
    'pastilla_patoplast.png',
    'pastilla_tillaout.png',
    'pastilla_zenidina.png'
  ];

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
    try {
      if (typeof W.detachEntityRig === 'function') {
        W.detachEntityRig(e);
      } else {
        W.PuppetAPI?.detach?.(e);
      }
    } catch (_) {}
    if (Array.isArray(G.entities)) G.entities = G.entities.filter((x) => x !== e);
    if (Array.isArray(G.patients)) G.patients = G.patients.filter((x) => x !== e);
    if (Array.isArray(G.allPatients)) G.allPatients = G.allPatients.filter((x) => x !== e);
    try { W.EntityGroups?.unregister?.(e, G); } catch (_) {}
    if (Array.isArray(G.movers)) G.movers = G.movers.filter((x) => x !== e);
    if (Array.isArray(G.pills)) G.pills = G.pills.filter((x) => x !== e);
    try { W.MovementSystem?.unregister?.(e); } catch (_) {}
    if (e.id && G._patientsByKey instanceof Map) {
      for (const [k, v] of [...G._patientsByKey.entries()]) {
        if (v === e) G._patientsByKey.delete(k);
      }
    }
    syncPatientArrayCounters();
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
    e.group = 'human';
    try { W.EntityGroups?.assign?.(e); } catch (_) {}
    try { W.EntityGroups?.register?.(e, G); } catch (_) {}
    if (G._patientsByKey instanceof Map) {
      G._patientsByKey.set(e.keyName, e);
    }
    const stats = ensureStats();
    stats.totalPatients = Math.min(35, (stats.totalPatients || 0) + 1);
    stats.remainingPatients = Math.min(35, (stats.remainingPatients || 0) + 1);
    ensurePatientCounters();
      if (!e.__countersRegistered) {
        e.__countersRegistered = true;
        G.patientsTotal = (G.patientsTotal | 0) + 1;
        G.patientsPending = (G.patientsPending | 0) + 1;
        emitPatientsCounter();
        try { W.LOG?.event?.('PATIENT_CREATE', { id: e.id }); } catch (_) {}
        e.__creationLogged = true;
      }
      syncPatientArrayCounters();
      try { W.GameFlowAPI?.notifyPatientCountersChanged?.(); } catch (_) {}
    }

  function createPatient(x, y, opts = {}) {
    ensureCollections();
    const identity = opts.identity || nextIdentity();
    const stats = ensureStats();

    const variantIndex = (identity.index != null ? identity.index : stats.totalPatients || 0);
    const skinName = opts.skin || `paciente${(variantIndex % 7) + 1}.png`;

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
      skin: skinName,
      bellId: null,
      pillId: null,
      ringing: false
    };

    if (!patient.id) patient.id = (Math.random() * 1e9) | 0;
    patient.state = patient.state || 'idle_bed';
    patient.showNameTag = true;

    try {
      const puppet = window.Puppet?.bind?.(patient, 'patient_bed', { z: 0, scale: 1, data: { skin: patient.skin } })
        || W.PuppetAPI?.attach?.(patient, { rig: 'patient_bed', z: 0, scale: 1, data: { skin: patient.skin } });
      patient.rigOk = patient.rigOk === true || !!puppet;
    } catch (_) {
      patient.rigOk = patient.rigOk === true;
    }

    addEntity(patient);
    registerPatient(patient);

    const prevOnCure = patient.onCure;
    patient.onCure = function () {
      ensurePatientCounters();
      const store = G.patients || {};
      const snapshot = (typeof W.patientsSnapshot === 'function') ? W.patientsSnapshot() : null;
      if (snapshot) {
        store.total = snapshot.total | 0;
        store.pending = snapshot.pending | 0;
        store.cured = snapshot.cured | 0;
        store.furious = snapshot.furious | 0;
      } else {
        store.pending = Math.max(0, (store.pending | 0) - 1);
        store.cured = (store.cured | 0) + 1;
      }
      patient.disappear_on_cure = true;
      patient.dead = true;
      patient.attended = true;
      patient.solid = false;
      patient.furious = false;
      const name = patient.displayName || patient.name || patient.keyName;
      const remaining = store.pending != null ? store.pending : snapshot?.pending;
      const furious = store.furious != null ? store.furious : snapshot?.furious;
      try {
        W.Narrator?.say?.('patient_cured', { patientName: name, remaining, furious });
        W.Narrator?.progress?.();
      } catch (_) {}
      if (typeof prevOnCure === 'function') {
        try { prevOnCure.apply(patient, arguments); } catch (_) {}
      }
      try { syncPatientArrayCounters(); } catch (_) {}
    };

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
    const pillSkin = PILL_SKINS[(patient.identityIndex ?? 0) % PILL_SKINS.length];

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
      forPatientId: patient.id,
      patientId: patient.id,
      patientName: patient.displayName,
      spriteKey: 'pill.generic',
      skin: pillSkin
    };
    try {
      const puppet = window.Puppet?.bind?.(pill, 'pill', { z: 0, scale: 1, data: { skin: pill.skin } })
        || W.PuppetAPI?.attach?.(pill, { rig: 'pill', z: 0, scale: 1, data: { skin: pill.skin } });
      pill.rigOk = pill.rigOk === true || !!puppet;
    } catch (_) {
      pill.rigOk = pill.rigOk === true;
    }
    addEntity(pill);
    if (!G.pills.includes(pill)) G.pills.push(pill);
    if (patient && !patient.pillId) {
      patient.pillId = pill.id;
    }
    try { W.LOG?.event?.('PILL_CREATE', { pill: pill.id, forPatient: patient.id }); } catch (_) {}
    pill.__creationLogged = true;
    return pill;
  }

  function getCarry(hero) {
    if (hero?.carry) return hero.carry;
    if (hero && !hero.carry && G.carry && hero === (G.player || null)) return G.carry;
    return G.carry;
  }

  function canDeliver(hero, patient) {
    if (!patient || patient.attended) return false;
    const carry = getCarry(hero);
    if (!carry || (carry.type && carry.type !== 'PILL')) return false;
    if (carry?.forPatientId && patient.id) return carry.forPatientId === patient.id;
    if (carry?.patientId && patient.id) return carry.patientId === patient.id;
    if (carry?.pairName && patient.keyName) return carry.pairName === patient.keyName;
    if (carry?.patientName && patient.name) return carry.patientName === patient.name;
    return false;
  }

  function clearCarry(hero) {
    if (hero && hero.carry) hero.carry = null;
    if (G.carry) G.carry = null;
    try { W.ArrowGuide?.clearTarget?.(); } catch (_) {}
  }

  function deliverPill(hero, patient) {
    if (!patient || patient.attended) return false;
    const carrier = hero || G.player || null;
    if (!canDeliver(carrier, patient)) return false;
    const carry = getCarry(carrier);
    if (carry?.id && Array.isArray(G.pills)) {
      G.pills = G.pills.filter((p) => p && p.id !== carry.id);
    }
    clearCarry(carrier);
    const stats = ensureStats();
    stats.remainingPatients = Math.max(0, (stats.remainingPatients || 0) - 1);
    patient.state = 'disappear_on_cure';
    patient.attended = true;
    patient.furious = false;
    patient.solid = false;
    patient.hidden = true;
    patient.dead = true;
    patient.attendedAndMatched = true;
    patient.delivered = true;
      patient.pillSatisfied = true;
      if (G._patientsByKey instanceof Map) G._patientsByKey.delete(patient.keyName);
      ensurePatientCounters();
      G.patientsPending = Math.max(0, (G.patientsPending | 0) - 1);
      G.patientsCured = (G.patientsCured | 0) + 1;
      syncPatientArrayCounters();
      try { W.LOG?.event?.('PILL_DELIVER', { patient: patient.id }); } catch (_) {}
      try { W.LOG?.event?.('PATIENTS_COUNTER', counterSnapshot()); } catch (_) {}
    try { W.GameFlowAPI?.notifyPatientDelivered?.(patient); } catch (_) {}
    try { W.ScoreAPI?.addScore?.(100, 'deliver_patient', { patient: patient.displayName }); } catch (_) {}
    try { W.GameFlowAPI?.notifyPatientCountersChanged?.(); } catch (_) {}
    const fadeMs = Number.isFinite(W.PATIENT_FADE_MS) ? W.PATIENT_FADE_MS : 650;
    setTimeout(() => {
      try { W.PuppetAPI?.detach?.(patient); } catch (_) {}
      removeEntity(patient);
    }, Math.max(0, fadeMs));
    if ((G.patientsPending | 0) === 0 && (G.patientsFurious | 0) === 0) {
      try { window.Doors?.openUrgencias?.(); } catch (_) {}
    }
    return true;
  }

  function deliver(patient, pill, hero) {
    if (pill) removeEntity(pill);
    return deliverPill(hero, patient);
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
      ensurePatientCounters();
      G.patientsPending = Math.max(0, (G.patientsPending | 0) - 1);
      G.patientsFurious = (G.patientsFurious | 0) + 1;
      syncPatientArrayCounters();
      emitPatientsCounter();
      patient.__convertedViaPatientsAPI = true;
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
        color: '#ff5d6c',
        skin: 'paciente_furiosa.png',
        displayName: patient.displayName,
        name: patient.name,
        nameTagYOffset: patient.nameTagYOffset,
        showNameTag: true
      };
      addEntity(furiosa);
    }
    try {
      const puppet = window.Puppet?.bind?.(furiosa, 'patient_furiosa', { z: 0, scale: 1, data: { skin: furiosa.skin } })
        || W.PuppetAPI?.attach?.(furiosa, { rig: 'patient_furiosa', z: 0, scale: 1, data: { skin: furiosa.skin } });
      furiosa.rigOk = furiosa.rigOk === true || !!puppet;
    } catch (_) {
      furiosa.rigOk = furiosa.rigOk === true;
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
    ensurePatientCounters();
    G.patientsFurious = Math.max(0, (G.patientsFurious | 0) - 1);
    syncPatientArrayCounters();
    emitPatientsCounter();
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
    deliverPill,
    canDeliver,
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
    ensureCollections,
    counterSnapshot,
    syncCounters: syncPatientArrayCounters
  };

  W.PatientsAPI = PatientsAPI;

  if (typeof W.patientsSnapshot !== 'function') {
    W.patientsSnapshot = () => counterSnapshot();
  }
  if (!W.counterSnapshot) {
    W.counterSnapshot = () => counterSnapshot();
  }

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
