// filename: objectiveflow.plugin.js
// Director de objetivos unificado para Il Divo: Hospital Dash!
// Mantiene una única fuente de verdad para HUD, narrador y flecha guía.
(function (W) {
  'use strict';

  const DEFAULT_LABEL = 'Objetivo: ninguno';
  const state = {
    phase: 'none',
    type: 'none',
    label: DEFAULT_LABEL,
    targetResolver: null,
    targetType: null,
    targetId: null,
    targetPoint: null,
    patientId: null,
    patientKey: null,
    pillId: null,
    lastNarration: null,
    lastNarrationAt: 0,
  };

  function getGame() {
    return W.G || (W.G = {});
  }

  function getStats() {
    const G = getGame();
    const stats = G.stats || {};
    return stats;
  }

  function getRemainingPatients() {
    const G = getGame();
    const stats = getStats();
    const pending = Number.isFinite(stats.remainingPatients)
      ? stats.remainingPatients
      : (G.patientsPending | 0);
    const furious = Number.isFinite(stats.activeFuriosas)
      ? stats.activeFuriosas
      : (G.patientsFurious | 0);
    return { pending, furious };
  }

  function isUrgenciasOpen() {
    const G = getGame();
    if (G.urgenciasOpen) return true;
    const flow = typeof W.GameFlowAPI?.getState === 'function' ? W.GameFlowAPI.getState() : null;
    if (flow?.bossDoorOpened) return true;
    return false;
  }

  function speak(text) {
    if (!text) return;
    const now = Date.now();
    if (state.lastNarration === text && now - state.lastNarrationAt < 1200) return;
    try {
      const ok = W.Narrator?.say?.(text, {}, { priority: 'high', minCooldownMs: 0, force: true });
      if (ok) {
        W.Narrator?.progress?.();
        state.lastNarration = text;
        state.lastNarrationAt = now;
      }
    } catch (_) {}
  }

  function setCurrentObjective(payload = {}) {
    state.phase = payload.phase || payload.type || state.phase || 'none';
    state.type = payload.type || state.phase;
    state.label = payload.label || DEFAULT_LABEL;
    state.targetResolver = payload.targetResolver || null;
    state.targetType = payload.targetType || payload.type || null;
    state.targetId = payload.targetEntity?.id ?? payload.targetId ?? null;
    state.targetPoint = payload.targetPoint ? { x: payload.targetPoint.x, y: payload.targetPoint.y } : null;
    state.patientId = payload.patientId ?? null;
    state.patientKey = payload.patientKey || null;
    state.pillId = payload.pillId ?? null;

    const G = getGame();
    G.currentObjective = { ...state };
    G.currentObjectiveLabel = state.label;

    try { W.HUD?.setObjectiveText?.(state.label); } catch (_) {}

    if (payload.narratorText) {
      speak(payload.narratorText);
    }

    console.debug('[OBJECTIVE] Updated', {
      type: state.type,
      phase: state.phase,
      targetResolver: state.targetResolver,
      targetId: state.targetId,
      label: state.label,
    });
    return { ...state };
  }

  function centerPoint(entity) {
    if (!entity) return { x: 0, y: 0 };
    const w = Number(entity.w) || 0;
    const h = Number(entity.h) || 0;
    return { x: (Number(entity.x) || 0) + w * 0.5, y: (Number(entity.y) || 0) + h * 0.5 };
  }

  function findEntityById(G, eid) {
    if (!G || !eid) return null;
    if (typeof G.byId === 'function') {
      try {
        const ent = G.byId(eid);
        if (ent) return ent;
      } catch (_) {}
    }
    const pool = Array.isArray(G.entities) ? G.entities : [];
    return pool.find((e) => e && e.id === eid) || null;
  }

  function listPatients(G) {
    return Array.isArray(G?.patients) ? G.patients : [];
  }

  function findPatientById(G, id) {
    if (!id) return null;
    const patients = listPatients(G);
    return patients.find((p) => p && p.id === id) || null;
  }

  function findPatientByKey(G, key) {
    if (!key) return null;
    if (G?._patientsByKey instanceof Map) {
      const found = G._patientsByKey.get(key);
      if (found) return found;
    }
    const patients = listPatients(G);
    return patients.find((p) => p && p.keyName === key) || null;
  }

  function listActivePills(G) {
    const pills = Array.isArray(G?.pills) ? G.pills : [];
    const entities = Array.isArray(G?.entities) ? G.entities : [];
    const ENT = W.ENT || {};
    const direct = pills.filter((pill) => pill && !pill.dead && !pill.collected && !pill.disabled);
    const extras = entities.filter((e) => e && !e.dead && (ENT.PILL == null || e.kind === ENT.PILL));
    const combined = [...new Set([...direct, ...extras])];
    return combined.filter((pill) => pill && !pill.dead && !pill.collected && !pill.disabled);
  }

  function targetForNearestPill(G) {
    const hero = G?.player;
    if (!hero) return null;
    const origin = centerPoint(hero);
    let best = null;
    let bestD = Infinity;
    for (const pill of listActivePills(G)) {
      const c = centerPoint(pill);
      const dx = c.x - origin.x;
      const dy = c.y - origin.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        best = c;
      }
    }
    if (!best) return null;
    return { x: best.x, y: best.y, type: 'pill' };
  }

  function targetForPatient(G, id, key) {
    if (!id && !key) return null;
    const patient = findPatientById(G, id) || findPatientByKey(G, key);
    if (!patient || patient.dead || patient.attended || patient.hidden) return null;
    const c = centerPoint(patient);
    return { x: c.x, y: c.y, type: 'patient' };
  }

  function findEmergencyCart(G) {
    if (!G) return null;
    if (G.cart && !G.cart.dead) return G.cart;
    const entities = Array.isArray(G.entities) ? G.entities : [];
    return entities.find((e) => e && e.kind === W.ENT?.CART && !e.dead && (e.cartType === 'er' || e.cart === 'urgencias' || e.tag === 'emergency')) || null;
  }

  function targetForCart(G) {
    const cart = findEmergencyCart(G);
    if (!cart) return null;
    const c = centerPoint(cart);
    return { x: c.x, y: c.y, type: 'cart' };
  }

  function findBossDoor(G) {
    if (!G) return null;
    if (G.door && (G.door.bossDoor || G.door.isBossDoor || G.door.tag === 'bossDoor')) return G.door;
    const entities = Array.isArray(G.entities) ? G.entities : [];
    return entities.find((e) => e && e.kind === W.ENT?.DOOR && (e.bossDoor || e.isBossDoor || e.tag === 'bossDoor')) || null;
  }

  function targetForDoor(G) {
    const door = findBossDoor(G);
    if (!door) return null;
    const c = centerPoint(door);
    return { x: c.x, y: c.y, type: 'door' };
  }

  function findBoss(G) {
    if (!G) return null;
    if (G.boss && !G.boss.dead) return G.boss;
    const entities = Array.isArray(G.entities) ? G.entities : [];
    return entities.find((e) => e && e.kind === W.ENT?.BOSS && !e.dead) || null;
  }

  function targetForBoss(G) {
    const boss = findBoss(G);
    if (!boss) return null;
    const c = centerPoint(boss);
    return { x: c.x, y: c.y, type: 'boss' };
  }

  function computeTarget(G) {
    if (state.targetPoint) {
      return { x: state.targetPoint.x, y: state.targetPoint.y, type: state.targetType || state.type };
    }
    if (state.targetId) {
      const entity = findEntityById(G, state.targetId);
      if (entity) {
        const c = centerPoint(entity);
        return { x: c.x, y: c.y, type: state.targetType || entity.kind || 'custom' };
      }
    }
    switch (state.targetResolver) {
      case 'patient':
        return targetForPatient(G, state.patientId, state.patientKey);
      case 'nearest_pill':
        return targetForNearestPill(G);
      case 'cart':
        return targetForCart(G);
      case 'door':
        return targetForDoor(G);
      case 'boss':
        return targetForBoss(G);
      default:
        return null;
    }
  }

  function setObjectiveFindPill(reason) {
    const label = 'Objetivo: encuentra una píldora.';
    setCurrentObjective({
      phase: 'find_pill',
      type: 'pill',
      label,
      targetResolver: 'nearest_pill',
      targetType: 'pill',
      patientId: null,
      patientKey: null,
      pillId: null,
      narratorText: 'Busca una píldora para cualquier paciente.',
    });
  }

  function onPillPicked(carry) {
    const G = getGame();
    const patient = findPatientById(G, carry?.forPatientId || carry?.patientId) || findPatientByKey(G, carry?.pairName);
    const patientName = patient?.displayName || patient?.name || carry?.patientName || 'el paciente asignado';
    const patientId = patient?.id ?? carry?.forPatientId ?? carry?.patientId ?? null;
    setCurrentObjective({
      phase: 'deliver_pill',
      type: 'patient',
      label: `Objetivo: lleva la píldora a ${patientName}.`,
      targetResolver: 'patient',
      targetType: 'patient',
      patientId,
      patientKey: carry?.pairName || patient?.keyName || null,
      pillId: carry?.id || null,
      narratorText: `Lleva la píldora a ${patientName}.`,
    });
  }

  function onCarryCleared(details = {}) {
    const { pending, furious } = getRemainingPatients();
    if (pending > 0 || furious > 0) {
      setObjectiveFindPill(details.reason || 'cleared');
    }
  }

  function setObjectiveCartReady() {
    const G = getGame();
    const cart = findEmergencyCart(G);
    const resolver = cart ? 'cart' : 'door';
    const label = 'Objetivo: lleva el carro de urgencias hasta la salida.';
    setCurrentObjective({
      phase: 'escort_cart',
      type: resolver,
      label,
      targetResolver: resolver,
      targetType: resolver === 'cart' ? 'cart' : 'door',
      narratorText: 'Lleva el carro de urgencias hasta la salida.',
    });
  }

  function setObjectiveGuideCartToBoss() {
    const label = 'Objetivo: guía el carro de urgencias hasta el Boss.';
    setCurrentObjective({
      phase: 'guide_cart',
      type: 'boss',
      label,
      targetResolver: 'boss',
      targetType: 'boss',
      narratorText: 'Guía el carro de urgencias hasta el Boss.',
    });
  }

  function onPatientDelivered() {
    const { pending, furious } = getRemainingPatients();
    if (pending === 0 && furious === 0) {
      setObjectiveCartReady();
    } else {
      setObjectiveFindPill('next_patient');
    }
  }

  function onUrgenciasOpened() {
    setObjectiveCartReady();
  }

  function onCartEngaged(cart) {
    if (!cart || !isUrgenciasOpen()) return;
    if (state.phase === 'guide_cart') return;
    setObjectiveGuideCartToBoss();
  }

  function onCartDelivered(_cart, _boss) {
    setCurrentObjective({
      phase: 'victory',
      type: 'boss',
      label: 'Objetivo: has completado el turno. ¡Nivel superado!',
      targetResolver: 'boss',
      targetType: 'boss',
      narratorText: 'Has completado el turno. ¡Nivel superado!'
    });
  }

  function resetForLevel() {
    const { pending, furious } = getRemainingPatients();
    if (pending === 0 && furious === 0) {
      if (isUrgenciasOpen()) {
        setObjectiveCartReady();
      } else {
        setCurrentObjective({ phase: 'idle', type: 'none', label: DEFAULT_LABEL });
      }
      return;
    }
    setObjectiveFindPill('level_start');
  }

  function getArrowTarget(Gref) {
    const G = Gref || getGame();
    const target = computeTarget(G);
    if (!target && state.targetResolver === 'patient' && (state.patientId || state.patientKey)) {
      setObjectiveFindPill('patient_missing');
    }
    return target;
  }

  const ObjectiveSystem = {
    setCurrentObjective,
    setFindPill: setObjectiveFindPill,
    onPillPicked,
    onCarryCleared,
    onPatientDelivered,
    onUrgenciasOpened,
    onCartEngaged,
    onCartDelivered,
    resetForLevel,
    getArrowTarget,
  };

  W.ObjectiveSystem = ObjectiveSystem;
})(this);
