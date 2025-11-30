(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const ENT = W.ENT || (W.ENT = {});
  const Entities = W.Entities || (W.Entities = {});
  const TILE = W.TILE_SIZE || W.TILE || 32;

  ENT.BOSS = ENT.BOSS || 'boss';

  if (typeof Entities.define !== 'function') {
    Entities.define = function define(name, factory) {
      this[name] = factory;
      return factory;
    };
  }

  function centerOf(e) {
    return { x: (e?.x || 0) + (e?.w || 0) * 0.5, y: (e?.y || 0) + (e?.h || 0) * 0.5 };
  }

  function distanceBetween(a, b) {
    if (!a || !b) return Infinity;
    const ca = centerOf(a);
    const cb = centerOf(b);
    return Math.hypot(ca.x - cb.x, ca.y - cb.y);
  }

  function resolveHero() {
    const hero = G.player;
    return hero && !hero.dead ? hero : null;
  }

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.patients)) G.patients = [];
  }

  function resolveTimerSeconds(opts) {
    const candidate = Number(opts?.hemaTimerSeconds ?? opts?.hematologicTimerSeconds);
    if (Number.isFinite(candidate) && candidate > 0) return candidate;
    const levelRule = Number(G?.hematologicTimerSeconds ?? G?.levelRules?.level?.hematologicTimerSeconds);
    if (Number.isFinite(levelRule) && levelRule > 0) return levelRule;
    const globalRule = Number(G?.levelRules?.globals?.hematologicTimerSeconds);
    if (Number.isFinite(globalRule) && globalRule > 0) return globalRule;
    return 90;
  }

  function attachRig(ent) {
    ent.puppetState = ent.puppetState || { anim: 'idle' };
    try {
      ent.puppet = (W.Puppet?.bind?.(ent, 'boss_hema'))
        || W.PuppetAPI?.attach?.(ent, { rig: 'boss_hema', z: 0, scale: 1 });
    } catch (_) {
      ent.puppet = ent.puppet || null;
    }
  }

  function activateTimer(ent) {
    if (!ent || ent.hemaTimerActive || ent.cured || ent.dead) return;
    ent.hemaTimerActive = true;
    ent.ai.state = 'calling_help';
    try { W.HUD?.showHematologicTimer?.(); } catch (_) {}
    try { W.HUD?.updateHematologicTimer?.(ent.hemaTimeLeft, ent.hemaTimeMax); } catch (_) {}
    try { W.Narrator?.showObjective?.('¡Atiende a la paciente hematológica antes de que se acabe el tiempo!'); } catch (_) {}
    try { W.Narrator?.say?.('hematologic_timer', { seconds: Math.round(ent.hemaTimeLeft || ent.hemaTimeMax || 0) }); } catch (_) {}
  }

  function markGameOver(ent) {
    ent.dead = true;
    ent.ai.state = 'dead';
    ent.hemaTimerActive = false;
    try { W.HUD?.hideHematologicTimer?.(); } catch (_) {}
    if (G) G._gameOverReason = 'hematologic_timeout';
    try { W.Narrator?.say?.('hematologic_fail', {}); } catch (_) {}
    try { W.GameFlowAPI?.notifyHeroDeath?.(); } catch (_) {}
  }

  function tryDeliverTreatment(hero, patient) {
    if (!patient?.isHematologic || patient.cured || patient.dead) return false;
    const pill = hero?.carry || hero?.currentPill || G.carry || null;
    if (!pill) return false;
    const targetId = pill.targetPatientId || pill.patientId || pill.forPatientId || pill.pairName;
    if (targetId && targetId !== patient.id && targetId !== patient.keyName) return false;
    patient.cured = true;
    patient.ai.state = 'cured';
    patient.hemaTimerActive = false;
    patient.hemaTimeLeft = patient.hemaTimeMax;
    patient.attended = true;
    patient.puppetState.anim = 'relaxed';
    if (hero) {
      hero.carry = null;
      hero.currentPill = null;
    }
    G.carry = null;
    try { W.HUD?.hideHematologicTimer?.(); } catch (_) {}
    try { W.Narrator?.say?.('hematologic_cured'); W.Narrator?.showObjective?.('¡La paciente está estable! Acerca el carro de urgencias a su cama.'); } catch (_) {}
    console.debug('[HEMA_CURE]', { patientId: patient.id });
    return true;
  }

  function handleUrgencyCart(patient) {
    if (!patient || !patient.cured || patient.dead || patient.urgencyCartArrived) return;
    const cart = G.cart;
    if (!cart || cart.dead) return;
    const dist = distanceBetween(patient, cart) / TILE;
    if (dist <= 1.1) {
      patient.urgencyCartArrived = true;
      try { W.Narrator?.say?.('hematologic_saved'); } catch (_) {}
      try { W.Narrator?.showObjective?.('¡Paciente hematológica salvada! Nivel completado.'); } catch (_) {}
      try { W.GameFlowAPI?.notifyBossFinalDelivered?.(); } catch (_) {}
      console.debug('[HEMA_URGENCY_CART_REACHED]', { patientId: patient.id, cartId: cart.id });
    } else if (dist <= 2.2 && !patient._warnedCart) {
      patient._warnedCart = true;
      try { W.Narrator?.say?.('hematologic_cart_hint'); } catch (_) {}
    }
  }

  function updateAnim(ent) {
    const ai = ent.ai || {};
    const ps = ent.puppetState || (ent.puppetState = { anim: 'idle' });
    if (ent.dead) { ps.anim = 'die_hit'; return; }
    switch (ai.state) {
      case 'rest': ps.anim = 'idle'; break;
      case 'calling_help': ps.anim = 'call_help'; break;
      case 'critical': ps.anim = 'critical'; break;
      case 'cured': ps.anim = 'relaxed'; break;
      default: ps.anim = 'idle'; break;
    }
  }

  function updateAI(ent, dt) {
    const hero = resolveHero();
    const ai = ent.ai;
    ai.callPulse += dt;
    if (ai.state === 'calling_help' || ai.state === 'critical') {
      const dist = distanceBetween(ent, hero) / TILE;
      if (dist < 3.5) {
        ent.puppetState.anim = 'call_help';
      }
      if (dist < 1.2) {
        try { W.DialogAPI?.triggerOnce?.(ent, 'hematologic_help'); } catch (_) {}
      }
      if (ent.hemaTimerActive && ent.hemaTimeMax > 0 && ent.hemaTimeLeft / ent.hemaTimeMax < 0.25) {
        ai.state = 'critical';
        try { W.HUD?.flashHematologicWarning?.(true); } catch (_) {}
      }
    }
    if (ai.state === 'dead') {
      ent.puppetState.anim = 'die_hit';
    }
  }

  function updatePatientHema(ent, dt) {
    if (!ent._timerInit) {
      ent.hemaTimeMax = resolveTimerSeconds(ent.opts || {});
      ent.hemaTimeLeft = ent.hemaTimeMax;
      ent._timerInit = true;
    }

    if (!ent.hemaTimerActive && !ent.cured && !ent.dead) {
      const stats = G.stats || {};
      const total = stats.totalPatients || 0;
      if (total <= 0) return;
      const remaining = (stats.remainingPatients || 0) + (stats.activeFuriosas || 0);
      if (remaining <= 0) {
        activateTimer(ent);
      }
    }

    if (ent.hemaTimerActive && !ent.cured && !ent.dead) {
      ent.hemaTimeLeft = Math.max(0, (ent.hemaTimeLeft || 0) - dt);
      try { W.HUD?.updateHematologicTimer?.(ent.hemaTimeLeft, ent.hemaTimeMax); } catch (_) {}
      if (ent.hemaTimeLeft <= 0) {
        markGameOver(ent);
      }
    }

    updateAI(ent, dt);
    updateAnim(ent);
    handleUrgencyCart(ent);
  }

  function createPatientHematologic(pos, opts = {}) {
    ensureCollections();
    const p = pos || {};
    const x = (typeof p.x === 'number') ? p.x : (Array.isArray(p) ? p[0] : p);
    const y = (typeof p.y === 'number') ? p.y : (Array.isArray(p) ? p[1] : 0);
    const base = (typeof Entities.createBaseHuman === 'function')
      ? Entities.createBaseHuman(pos, opts)
      : { x: x || 0, y: y || 0, w: TILE * 0.95, h: TILE * 0.95, solid: true, static: true, puppetState: { anim: 'idle' } };

    const ent = Object.assign(base, {
      id: opts.id || `HEMA_${Math.random().toString(36).slice(2, 8)}`,
      kind: ENT.BOSS,
      kindName: 'patient_hematologic_lvl1',
      subtype: 'hematologic',
      role: 'patient_hematologic',
      isPatient: true,
      isHematologic: true,
      isBoss: true,
      hp: 100,
      immobile: true,
      static: true,
      pushable: false,
      canBePushed: false,
      solid: true,
      targetPillId: opts?.targetPillId || null,
      cured: false,
      dead: false,
      hemaTimerActive: false,
      hemaTimeLeft: 0,
      hemaTimeMax: 0,
      urgencyCartRequired: true,
      urgencyCartArrived: false,
      ai: { state: 'rest', callPulse: 0 },
      opts,
      update(dt) { updatePatientHema(this, dt || 0); }
    });

    ent.group = 'human';
    try { W.EntityGroups?.assign?.(ent); } catch (_) {}
    try { W.EntityGroups?.register?.(ent, G); } catch (_) {}
    if (!G.entities.includes(ent)) G.entities.push(ent);
    if (!G.patients.includes(ent)) G.patients.push(ent);
    G.boss = ent;

    attachRig(ent);
    return ent;
  }

  Entities.define('patient_hematologic_lvl1', createPatientHematologic);
  Entities.PatientHematologic = {
    spawn(x, y, opts = {}) {
      return createPatientHematologic({ x, y }, opts);
    },
    tryDeliverTreatment: tryDeliverTreatment
  };

  W.HematologicPatientAPI = {
    tryDeliver: tryDeliverTreatment,
    activateTimer
  };
})(typeof window !== 'undefined' ? window : globalThis);
