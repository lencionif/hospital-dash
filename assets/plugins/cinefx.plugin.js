// assets/plugins/cinefx.plugin.js
// Sistema unificado de efectos cinemáticos: cámara lenta, sacudidas y ragdoll.
(function (global) {
  'use strict';

  const W = (typeof window !== 'undefined') ? window : global;
  const nowSeconds = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? (performance.now() / 1000)
    : (Date.now() / 1000);
  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const mix = (a, b, t) => a + (b - a) * clamp(t, 0, 1);

  const DEFAULTS = {
    slowMoScale: 0.45,
    slowMoDuration: 0.7,
    slowMoHold: 0.42,
    slowMoRelease: 0.55,
    slowMoThreshold: 160,
    slowMoCooldown: 0.35,
    shakeThreshold: 110,
    shakeDuration: 0.55,
    shakeBase: 6,
    shakeMax: 18,
    shakeFrequency: 28,
    shakeFalloff: 2.1,
    shakeImpulseRange: 260,
    ragdollImpulse: 140,
    ragdollDuration: 1.1,
    ragdollCooldown: 0.65,
    ragdollMinMass: 1.35,
    ragdollPushScale: 0.055,
    ragdollMaxPush: 220,
    ragdollSpinDamp: 3.4,
    ragdollWobble: 2.6,
    ragdollFriction: 0.02,
    readySlowMo: { scale: 0.6, duration: 0.8, hold: 0.45, release: 0.45 },
    readyShake: { intensity: 7, duration: 0.38, frequency: 26, decay: 2.2 },
    scoreboardSlowMo: { scale: 0.5, duration: 1.2, hold: 0.5, release: 0.65 },
    scoreboardShake: { intensity: 11, duration: 0.6, frequency: 22, decay: 2.6 }
  };

  const state = {
    config: Object.assign({}, DEFAULTS),
    timeScale: 1,
    slowMoTimer: 0,
    slowMoHold: 0,
    slowMoRelease: 0,
    slowMoTarget: 1,
    slowMoCooldown: 0,
    shakeTime: 0,
    shakeDuration: 0,
    shakePower: 0,
    shakePhaseX: Math.random() * Math.PI * 2,
    shakePhaseY: Math.random() * Math.PI * 2,
    shakeOffsetX: 0,
    shakeOffsetY: 0,
    ragdolls: new Set(),
  };

  function configure(opts = {}) {
    if (!opts || typeof opts !== 'object') return state.config;
    state.config = Object.assign({}, state.config, opts);
    return state.config;
  }

  function triggerSlowMo(opts = {}) {
    const cfg = state.config;
    const scale = clamp(Number.isFinite(opts.scale) ? opts.scale : cfg.slowMoScale, 0.05, 1);
    const duration = Math.max(0, Number.isFinite(opts.duration) ? opts.duration : cfg.slowMoDuration);
    const hold = Math.max(0, Number.isFinite(opts.hold) ? opts.hold : (Number.isFinite(cfg.slowMoHold) ? cfg.slowMoHold : duration * 0.6));
    const release = Math.max(0.12, Number.isFinite(opts.release) ? opts.release : (Number.isFinite(cfg.slowMoRelease) ? cfg.slowMoRelease : Math.max(0.3, duration - hold)));
    const cooldown = Math.max(0, Number.isFinite(opts.cooldown) ? opts.cooldown : cfg.slowMoCooldown);
    if (state.slowMoCooldown > 0 && !opts.force) return false;
    state.slowMoTarget = scale;
    state.slowMoTimer = hold + release;
    state.slowMoHold = hold;
    state.slowMoRelease = release;
    state.slowMoCooldown = cooldown;
    state.timeScale = Math.min(state.timeScale, scale);
    return true;
  }

  function addScreenShake(intensity = 6, duration = 0.4, opts = {}) {
    const power = Math.max(0, intensity);
    const span = Math.max(0.05, duration);
    state.shakePower = Math.max(state.shakePower, power);
    state.shakeDuration = Math.max(state.shakeDuration, span);
    state.shakeTime = state.shakeDuration;
    if (Number.isFinite(opts.frequency)) state.config.shakeFrequency = opts.frequency;
    if (Number.isFinite(opts.decay)) state.config.shakeFalloff = opts.decay;
    return true;
  }

  function isHumanNPC(ent) {
    if (!ent || ent.dead || ent.static) return false;
    const G = W.G || {};
    if (G.player && ent === G.player) return false;
    const ENT = W.ENT || {};
    if (ent.kind === ENT.PLAYER || ent.kindName === 'PLAYER') return false;
    if (ent.kind === ENT.PATIENT) return false;
    const group = typeof ent.group === 'string' ? ent.group.toLowerCase() : '';
    if (group === 'human' && ent.kind !== ENT.PLAYER) return true;
    if (ent.isNPC === true) return true;
    const rig = typeof ent.rigName === 'string' ? ent.rigName.toLowerCase() : '';
    if (rig.includes('npc_')) return true;
    const tag = typeof ent.tag === 'string' ? ent.tag.toLowerCase() : '';
    if (tag.includes('npc')) return true;
    const kindStr = (typeof ent.kind === 'string') ? ent.kind.toLowerCase() : '';
    if (/npc|celador|medico|guardia|supervisora|familiar|enfermera/.test(kindStr)) return true;
    const kindName = (typeof ent.kindName === 'string') ? ent.kindName.toLowerCase() : '';
    if (/npc|celador|medico|guardia|supervisora|familiar|enfermera/.test(kindName)) return true;
    return false;
  }

  function releaseRagdoll(ent, immediate = false) {
    if (!ent) return;
    if (ent._ragdollPrevMu != null) {
      ent.mu = ent._ragdollPrevMu;
    }
    delete ent._ragdollPrevMu;
    ent.ragdoll = false;
    ent.ragdolling = false;
    if (immediate) {
      ent._ragdollAngle = 0;
      ent._ragdollAngularVel = 0;
    } else {
      ent._ragdollAngularVel = 0;
      if (typeof ent._ragdollAngle === 'number') ent._ragdollAngle *= 0.35;
    }
  }

  function registerRagdoll(ent, opts = {}) {
    if (!isHumanNPC(ent)) return false;
    const cfg = state.config;
    const now = nowSeconds();
    if ((ent._ragdollCooldownUntil || 0) > now && !opts.force) return false;
    const impact = Math.max(0, Number.isFinite(opts.impact) ? opts.impact : 0);
    const mass = Math.max(0.2, Number.isFinite(opts.mass) ? opts.mass : (Number.isFinite(ent.mass) ? ent.mass : 1));
    if (opts.minMassCheck !== false) {
      const heavy = Number.isFinite(opts.heavyMass) ? opts.heavyMass : (Array.isArray(opts.masses) ? Math.max(...opts.masses.filter(Number.isFinite)) : mass);
      if (Number.isFinite(cfg.ragdollMinMass) && heavy < cfg.ragdollMinMass && (!opts.wall && !opts.force)) return false;
    }
    const duration = Math.max(0.35, Number.isFinite(opts.duration) ? opts.duration : cfg.ragdollDuration);
    const cooldown = Math.max(0.2, Number.isFinite(opts.cooldown) ? opts.cooldown : cfg.ragdollCooldown);
    ent._ragdollTimer = Math.max(ent._ragdollTimer || 0, duration);
    ent._ragdollCooldownUntil = now + cooldown;
    if (ent._ragdollPrevMu == null && typeof ent.mu === 'number') {
      ent._ragdollPrevMu = ent.mu;
    }
    if (typeof ent.mu === 'number') {
      const fr = cfg.ragdollFriction ?? 0.02;
      ent.mu = Math.min(ent.mu, fr);
    }
    ent.ragdoll = true;
    ent.ragdolling = true;
    const normal = opts.normal || { x: 0, y: 0 };
    const baseAngle = Number.isFinite(opts.angle)
      ? opts.angle
      : (Math.atan2(normal.y || 0, normal.x || 0) - Math.PI / 2 + (Math.random() - 0.5) * 0.7);
    ent._ragdollAngle = baseAngle;
    const spinBase = Number.isFinite(opts.angular) ? opts.angular : ((Math.random() - 0.5) * 5.6 + impact * 0.008);
    ent._ragdollAngularVel = clamp(spinBase, -6.5, 6.5);
    const pushScale = Number.isFinite(opts.pushScale) ? opts.pushScale : (cfg.ragdollPushScale ?? 0.05);
    if (pushScale > 0 && (normal.x || normal.y)) {
      const push = clamp((impact / Math.max(mass, 0.2)) * pushScale, -cfg.ragdollMaxPush, cfg.ragdollMaxPush);
      ent.vx = (ent.vx || 0) + (normal.x || 0) * push;
      ent.vy = (ent.vy || 0) + (normal.y || 0) * push;
    }
    state.ragdolls.add(ent);
    return true;
  }

  function updateRagdolls(dt) {
    if (!state.ragdolls.size) return;
    const remove = [];
    const wobble = state.config.ragdollWobble ?? 2.6;
    const damp = state.config.ragdollSpinDamp ?? 3.4;
    state.ragdolls.forEach(ent => {
      if (!ent || ent.dead) {
        if (ent) releaseRagdoll(ent, true);
        remove.push(ent);
        return;
      }
      const timer = Math.max(0, ent._ragdollTimer || 0) - dt;
      ent._ragdollTimer = timer;
      ent.ragdoll = timer > 0;
      ent.ragdolling = timer > 0;
      if (timer <= 0) {
        releaseRagdoll(ent);
        remove.push(ent);
        return;
      }
      ent._ragdollAngle = (ent._ragdollAngle || 0) + (ent._ragdollAngularVel || 0) * dt;
      ent._ragdollAngularVel = (ent._ragdollAngularVel || 0) * Math.max(0, 1 - dt * damp);
      if (Math.abs(ent._ragdollAngularVel) < 0.05) ent._ragdollAngularVel = 0;
      ent._ragdollAngle += (Math.random() - 0.5) * dt * wobble;
    });
    for (const ent of remove) state.ragdolls.delete(ent);
  }

  function updateSlowMo(dt) {
    if (state.slowMoCooldown > 0) state.slowMoCooldown = Math.max(0, state.slowMoCooldown - dt);
    if (state.slowMoTimer <= 0) {
      state.timeScale += (1 - state.timeScale) * Math.min(1, dt * 6.2);
      if (Math.abs(1 - state.timeScale) < 0.01) state.timeScale = 1;
      return;
    }
    state.slowMoTimer = Math.max(0, state.slowMoTimer - dt);
    const holdTime = Math.max(0, state.slowMoTimer - state.slowMoRelease);
    if (holdTime > 0) {
      state.timeScale += (state.slowMoTarget - state.timeScale) * Math.min(1, dt * 10);
    } else {
      const rel = state.slowMoRelease || 0.0001;
      const t = 1 - (state.slowMoTimer / rel);
      const target = mix(state.slowMoTarget, 1, clamp(t, 0, 1));
      state.timeScale += (target - state.timeScale) * Math.min(1, dt * 7);
    }
  }

  function updateShake(dt) {
    if (state.shakeTime > 0) {
      state.shakeTime = Math.max(0, state.shakeTime - dt);
      const t = state.shakeDuration > 0 ? state.shakeTime / state.shakeDuration : 0;
      const falloffPow = state.config.shakeFalloff ?? 2.1;
      const decay = Math.pow(clamp(t, 0, 1), falloffPow);
      const freq = state.config.shakeFrequency ?? 28;
      state.shakePhaseX += dt * freq * 3.1;
      state.shakePhaseY += dt * freq * 2.6;
      const range = clamp(state.config.shakeMax ?? 18, 2, 48);
      const base = state.config.shakeBase ?? 4;
      const magnitude = clamp(state.shakePower, base, range) * decay;
      state.shakeOffsetX = Math.sin(state.shakePhaseX) * magnitude;
      state.shakeOffsetY = Math.cos(state.shakePhaseY) * magnitude * 0.72;
    } else {
      state.shakeOffsetX *= Math.max(0, 1 - dt * 12);
      state.shakeOffsetY *= Math.max(0, 1 - dt * 12);
      if (Math.abs(state.shakeOffsetX) < 0.01) state.shakeOffsetX = 0;
      if (Math.abs(state.shakeOffsetY) < 0.01) state.shakeOffsetY = 0;
    }
  }

  function computeImpactNormal(evt) {
    if (evt && evt.normal && typeof evt.normal === 'object') {
      return { x: evt.normal.x || 0, y: evt.normal.y || 0 };
    }
    const list = Array.isArray(evt?.entities) ? evt.entities.filter(Boolean) : [];
    if (list.length >= 2) {
      const a = list[0], b = list[1];
      const ax = a.x + a.w * 0.5, ay = a.y + a.h * 0.5;
      const bx = b.x + b.w * 0.5, by = b.y + b.h * 0.5;
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      return { x: dx / len, y: dy / len };
    }
    return { x: 0, y: -1 };
  }

  function onPhysicsImpact(evt = {}) {
    const cfg = state.config;
    const impulse = Math.max(0, Number.isFinite(evt.impulse) ? evt.impulse : (Number.isFinite(evt.impact) ? evt.impact : 0));
    if (!(impulse > 0)) return;
    if (impulse >= (cfg.shakeThreshold ?? 0)) {
      const base = cfg.shakeBase ?? 6;
      const max = cfg.shakeMax ?? 18;
      const range = Math.max(1, cfg.shakeImpulseRange ?? 260);
      const ratio = clamp((impulse - (cfg.shakeThreshold ?? 0)) / range, 0, 1);
      const intensity = mix(base, max, ratio);
      addScreenShake(intensity, cfg.shakeDuration ?? 0.5, { frequency: cfg.shakeFrequency, decay: cfg.shakeFalloff });
    }
    if (impulse >= (cfg.slowMoThreshold ?? 0)) {
      triggerSlowMo({
        scale: cfg.slowMoScale,
        duration: cfg.slowMoDuration,
        hold: cfg.slowMoHold,
        release: cfg.slowMoRelease,
        cooldown: cfg.slowMoCooldown
      });
    }
    const entities = Array.isArray(evt.entities) ? evt.entities : (evt.entity ? [evt.entity] : []);
    if (!entities.length && evt.entity) entities.push(evt.entity);
    if (impulse >= (cfg.ragdollImpulse ?? Infinity)) {
      const masses = Array.isArray(evt.masses) ? evt.masses : [];
      const heavy = masses.filter(Number.isFinite).reduce((acc, v) => Math.max(acc, v), 0);
      const baseNormal = computeImpactNormal(evt);
      entities.forEach((ent, idx) => {
        if (!ent) return;
        const entMass = Number.isFinite(masses[idx]) ? masses[idx] : (Number.isFinite(ent.mass) ? ent.mass : 1);
        const partner = entities.find(o => o && o !== ent) || evt.other || null;
        let normal = baseNormal;
        if (partner && partner.x != null && partner.y != null && partner.w != null && partner.h != null &&
            ent.x != null && ent.y != null && ent.w != null && ent.h != null) {
          const ax = ent.x + ent.w * 0.5;
          const ay = ent.y + ent.h * 0.5;
          const bx = partner.x + partner.w * 0.5;
          const by = partner.y + partner.h * 0.5;
          const dx = ax - bx;
          const dy = ay - by;
          const len = Math.hypot(dx, dy) || 1;
          normal = { x: dx / len, y: dy / len };
        } else if (idx % 2 === 1 && baseNormal) {
          normal = { x: -(baseNormal.x || 0), y: -(baseNormal.y || 0) };
        }
        registerRagdoll(ent, {
          impact: impulse,
          mass: entMass,
          heavyMass: heavy,
          normal,
          duration: cfg.ragdollDuration,
          cooldown: cfg.ragdollCooldown,
          wall: evt.type === 'wall',
          masses
        });
      });
    }
  }

  function readyBeat(opts = {}) {
    const preset = state.config.readySlowMo || {};
    triggerSlowMo(Object.assign({}, preset, opts));
    const shakePreset = state.config.readyShake;
    if (shakePreset) {
      addScreenShake(
        Number.isFinite(shakePreset.intensity) ? shakePreset.intensity : 6,
        Number.isFinite(shakePreset.duration) ? shakePreset.duration : 0.35,
        shakePreset
      );
    }
  }

  function levelCompleteCue(opts = {}) {
    const preset = state.config.scoreboardSlowMo || {};
    triggerSlowMo(Object.assign({}, preset, opts));
    const shakePreset = state.config.scoreboardShake;
    if (shakePreset) {
      addScreenShake(
        Number.isFinite(shakePreset.intensity) ? shakePreset.intensity : 10,
        Number.isFinite(shakePreset.duration) ? shakePreset.duration : 0.6,
        shakePreset
      );
    }
  }

  function update(dt = 0, context = {}) {
    const delta = Math.max(0, dt);
    updateSlowMo(delta);
    updateShake(delta);
    updateRagdolls(delta);
    if (context && context.camera && typeof context.camera === 'object') {
      context.camera.shakeOffsetX = state.shakeOffsetX;
      context.camera.shakeOffsetY = state.shakeOffsetY;
    }
  }

  const api = {
    configure,
    update,
    getTimeScale: () => clamp(state.timeScale, 0.05, 2),
    triggerSlowMo,
    addScreenShake,
    onPhysicsImpact,
    registerRagdoll,
    triggerRagdoll: registerRagdoll,
    releaseRagdoll,
    isRagdolling(ent) { return !!(ent && !ent.dead && (state.ragdolls.has(ent) || (ent._ragdollTimer > 0))); },
    getCameraShake() { return { x: state.shakeOffsetX, y: state.shakeOffsetY }; },
    getCameraShakeWorld(zoom = 1) {
      const z = Number.isFinite(zoom) && zoom !== 0 ? zoom : 1;
      return { x: state.shakeOffsetX / z, y: state.shakeOffsetY / z };
    },
    readyBeat,
    levelCompleteCue
  };

  W.CineFX = Object.assign(W.CineFX || {}, api);

})(this);
