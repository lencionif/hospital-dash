// filename: medico.entities.js
// Doctora NPC para “Il Divo: Hospital Dash!”
//  - Patrulla consultas/pasillos con rig canvas npc_medico (sin sprites y dentro de 1 TILE).
//  - Al tocar al héroe inicia diálogos con acertijos fáciles de medicina.
//  - Genera píldoras con buffs positivos o negativos usando el sistema estándar del juego.
//  - Expone MedicoAPI compatible con spawn/register/update/tryInteract.

(function () {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (min, max) => min + Math.random() * (max - min);
  const H = Math.hypot;

  function tryAttachFlashlight(e) {
    if (!e || e.flashlight === false || e._flashlightAttached) return;
    const attach = window.Entities?.attachFlashlight;
    if (typeof attach !== 'function') return;
    try {
      const tile = (typeof window.TILE_SIZE !== 'undefined') ? window.TILE_SIZE : 32;
      const radius = Number.isFinite(e.flashlightRadius) ? e.flashlightRadius : tile * 4.8;
      const intensity = Number.isFinite(e.flashlightIntensity) ? e.flashlightIntensity : 0.55;
      const color = e.flashlightColor || '#fff2c0';
      const id = attach(e, { color, radius, intensity });
      if (id != null) {
        e._flashlightAttached = true;
        e._flashlightId = id;
      }
    } catch (err) {
      try { console.warn('[Medico] No se pudo adjuntar linterna', err); } catch (_) {}
    }
  }

  const PATROL_ROUTE_TILES = [
    { x: 6, y: 3, label: 'consulta_general' },
    { x: 12, y: 6, label: 'box_urgencias' },
    { x: 8, y: 11, label: 'pasillo_norte' },
    { x: 3, y: 7, label: 'pasillo_sur' }
  ];

  const DOCTOR_RIDDLES = [
    {
      key: 'doc_riddle_easy_1',
      title: 'Signos vitales',
      text: 'Si tomas mi medida en muñeca o cuello sabrás si late el corazón. ¿Qué soy?',
      options: ['El pulso radial', 'Un fonendo', 'La glucemia'],
      correctIndex: 0,
      hint: 'Cuenta 15 segundos y multiplica por cuatro.',
      success: '¡Buen pulso! Sigue controlando signos vitales.',
      fail: 'Revisa siempre el pulso antes de actuar.'
    },
    {
      key: 'doc_riddle_easy_2',
      title: 'Higiene básica',
      text: 'Tengo agua y jabón, y todos deberían visitarme antes de tocar a un paciente. ¿Quién soy?',
      options: ['El lavamanos', 'La camilla', 'El dispensador de guantes'],
      correctIndex: 0,
      hint: 'Evita infecciones y reduce contagios.',
      success: '¡Manos limpias, pacientes felices!',
      fail: 'Sin lavado de manos no hay seguridad en planta.'
    },
    {
      key: 'doc_riddle_easy_3',
      title: 'Medicación sencilla',
      text: 'Me tomas cada 8 horas cuando hay fiebre y dolor. ¿Cuál es mi nombre?',
      options: ['Paracetamol', 'Insulina', 'Suero oral'],
      correctIndex: 0,
      hint: 'Soy un analgésico muy común.',
      success: '¡Correcto! Controlar la dosis evita sustos.',
      fail: 'No confundas medicaciones: lee siempre la pauta.'
    },
    {
      key: 'doc_riddle_easy_4',
      title: 'Respiración',
      text: 'Si colocas mi campana en el tórax escucharás cómo entra el aire. ¿Qué instrumento soy?',
      options: ['Fonendoscopio', 'Termómetro', 'Otoscopio'],
      correctIndex: 0,
      hint: 'También me llaman estetoscopio.',
      success: '¡Buen oído clínico!',
      fail: 'Repasemos la auscultación respiratoria.'
    }
  ];

  const POSITIVE_BUFFS = ['speed_up', 'push_boost', 'shield'];
  const NEGATIVE_BUFFS = ['slow', 'invert_controls', 'weak_push', 'heart_loss'];

  const BUFF_CONFIG = {
    speed_up:   { type: 'positive', duration: 12, speedMul: 1.25, accelMul: 1.15 },
    push_boost: { type: 'positive', duration: 10, pushMul: 1.35 },
    shield:     { type: 'positive', duration: 14, shield: 1 },
    slow:       { type: 'negative', duration: 9,  speedMul: 0.6, accelMul: 0.75 },
    invert_controls: { type: 'negative', duration: 8, invertControls: true },
    weak_push:  { type: 'negative', duration: 11, pushMul: 0.65 },
    heart_loss: { type: 'negative', duration: 0, damage: 1 }
  };

  const DEFAULTS = {
    speed: 62,
    accel: 480,
    mass: 95,
    restitution: 0.05,
    friction: 0.1,
    talkCooldown: 10,
    patrolPauseMin: 1,
    patrolPauseMax: 2,
    arrivalDistance: 18,
    spawnPillIntervalMin: 8,
    spawnPillIntervalMax: 16,
    interactRadius: 44,
    portraitCssVar: '--sprite-medic-portrait'
  };

  const isDebug = () => !!(window.DEBUG_MEDICO || window.DEBUG_FORCE_ASCII);

  function convertRoute(points, tile, fallbackRoute) {
    const result = [];
    for (const pt of points || []) {
      if (!pt) continue;
      if (Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
        result.push({ x: pt.x, y: pt.y, label: pt.label || null });
      } else if (Number.isFinite(pt.tx) && Number.isFinite(pt.ty)) {
        result.push({ x: pt.tx * tile, y: pt.ty * tile, label: pt.label || null });
      }
    }
    if (result.length) return result;
    return fallbackRoute ? fallbackRoute.slice() : [];
  }

  function overlaps(a, b) {
    if (!a || !b) return false;
    return (a.x < b.x + b.w) && (a.x + a.w > b.x) && (a.y < b.y + b.h) && (a.y + a.h > b.y);
  }

  function centerPoint(e) {
    return { x: e.x + e.w * 0.5, y: e.y + e.h * 0.5 };
  }

  const NEAR_OFFSETS = [
    { x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 },
    { x: 1, y: 1 }, { x: -1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }
  ];
  const PILL_OFFSETS = [{ x: 0, y: 0 }, ...NEAR_OFFSETS];
  const MedicoAPI = {
    G: null,
    TILE: 32,
    cfg: null,
    medics: [],
    _patrolPoints: [],

    init(Gref, opts = {}) {
      this.G = Gref || window.G || (window.G = {});
      this.TILE = (typeof window.TILE_SIZE !== 'undefined') ? window.TILE_SIZE : 32;
      this.cfg = Object.assign({}, DEFAULTS, opts || {});
      this._patrolPoints = convertRoute(PATROL_ROUTE_TILES, this.TILE);
      if (!Array.isArray(this.G.entities)) this.G.entities = [];
      if (!Array.isArray(this.G.humans)) this.G.humans = [];
      if (!Array.isArray(this.G.movers)) this.G.movers = [];
      return this;
    },

    spawn(x, y, p = {}) {
      this.init(this.G || window.G);
      const tile = this.TILE;
      const ent = {
        id: 'DOC_' + Math.random().toString(36).slice(2),
        x, y,
        w: tile * 0.9,
        h: tile * 0.9,
        vx: 0,
        vy: 0,
        solid: true,
        dynamic: true,
        pushable: true,
        color: '#f8ffff'
      };
      if (p.patrolPoints) ent.patrolPoints = p.patrolPoints;
      return this.registerMedicEntity(ent);
    },

    registerMedicEntity(ent) {
      this.init(this.G || window.G);
      const ENT = this.G.ENT || window.ENT || {};
      const tile = this.TILE;
      ent.kind = ENT.MEDICO || ENT.DOCTOR || 'npc_medico';
      ent.kindName = 'npc_medico';
      ent.type = 'npc';
      ent.role = 'npc_medico';
      ent.name = ent.name || 'Doctora';
      ent.displayName = ent.displayName || 'Doctora';
      ent.w = ent.w || tile * 0.9;
      ent.h = ent.h || tile * 0.9;
      ent.mass = this.cfg.mass;
      ent.restitution = this.cfg.restitution;
      ent.friction = this.cfg.friction;
      ent.solid = true;
      ent.dynamic = true;
      ent.pushable = true;
      ent.anim = ent.anim || 'idle';
      ent.ai = Object.assign({
        state: 'patrol',
        dir: 'down',
        patrolIndex: 0,
        riddleIndex: 0,
        talkCooldown: 0,
        cooldownTimer: 0,
        idleAnim: 'idle',
        extraNoteTimer: 0,
        animOverride: null,
        animOverrideTimer: 0,
        powerGlowTimer: 0,
        spawnPillIntervalMin: this.cfg.spawnPillIntervalMin,
        spawnPillIntervalMax: this.cfg.spawnPillIntervalMax,
        spawnPillTimer: rand(this.cfg.spawnPillIntervalMin, this.cfg.spawnPillIntervalMax),
        pushActionCooldown: rand(2, 5)
      }, ent.ai || {});
      const fallbackRoute = this._patrolPoints.length ? this._patrolPoints : [centerPoint(ent)];
      ent.ai.route = convertRoute(ent.patrolPoints || ent.ai.route, tile, fallbackRoute);
      if (!ent.ai.route.length) {
        ent.ai.route = this._createFallbackRoute(ent);
      } else {
        ent.ai.route = ent.ai.route.map((pt) => ({
          x: Number.isFinite(pt.x) ? pt.x : (pt.tx || 0) * tile,
          y: Number.isFinite(pt.y) ? pt.y : (pt.ty || 0) * tile,
          label: pt.label || null
        }));
      }
      ent.ai.patrolIndex = ent.ai.patrolIndex % Math.max(1, ent.ai.route.length);

      this._ensureOnWorld(ent);
      this.medics.push({ e: ent });

      try {
        const puppet = window.Puppet?.bind?.(ent, 'npc_medico', { z: 0, scale: 1 })
          || window.PuppetAPI?.attach?.(ent, { rig: 'npc_medico', z: 0, scale: 1 });
        ent.rigOk = !!puppet;
      } catch (_) {
        ent.rigOk = true;
      }
      tryAttachFlashlight(ent);
      return ent;
    },

    ensureOneIfMissing() {
      if (this.medics.length > 0) return;
      const fallbackX = this.TILE * 5;
      const fallbackY = this.TILE * 4;
      this.spawn(fallbackX, fallbackY, {});
    },

    update(dt) {
      const hero = this.G?.player || null;
      for (const slot of this.medics) {
        const ent = slot.e;
        if (!ent) continue;
        this._updateDoctor(ent, dt || 0, hero);
      }
      this._updateBuffs(dt || 0);
    },

    tryInteract() {
      const hero = this.G?.player;
      if (!hero) return false;
      let best = null;
      let bestDist = Infinity;
      for (const slot of this.medics) {
        const e = slot.e;
        if (!e || e.dead) continue;
        const dx = (e.x + e.w * 0.5) - (hero.x + hero.w * 0.5);
        const dy = (e.y + e.h * 0.5) - (hero.y + hero.h * 0.5);
        const dist = H(dx, dy);
        if (dist < bestDist) {
          bestDist = dist;
          best = e;
        }
      }
      if (!best || bestDist > this.cfg.interactRadius) return false;
      if (best.ai?.state === 'talk' || (best.ai?.talkCooldown || 0) > 0) return false;
      best.ai.talkCooldown = this.cfg.talkCooldown;
      best.ai.state = 'talk';
      return startDoctorEasyRiddleDialog(best, hero);
    },

    _ensureOnWorld(ent) {
      const G = this.G;
      if (!G.entities.includes(ent)) G.entities.push(ent);
      if (!G.humans.includes(ent)) G.humans.push(ent);
      if (!G.movers.includes(ent)) G.movers.push(ent);
      ent.group = 'human';
      try { window.EntityGroups?.assign?.(ent); } catch (_) {}
      try { window.EntityGroups?.register?.(ent, G); } catch (_) {}
      try { window.MovementSystem?.register?.(ent); } catch (_) {}
    },

    _createFallbackRoute(ent) {
      const { x, y, w, h } = ent;
      const cx = x + w * 0.5;
      const cy = y + h * 0.5;
      const t = this.TILE;
      return [
        { x: cx, y: cy },
        { x: cx + t * 2, y: cy },
        { x: cx + t * 2, y: cy + t * 2 },
        { x: cx, y: cy + t * 2 }
      ];
    },

    _updateDoctor(ent, dt, hero) {
      const ai = ent.ai || (ent.ai = {});
      ai.talkCooldown = Math.max(0, (ai.talkCooldown || 0) - dt);
      ai.animOverrideTimer = Math.max(0, (ai.animOverrideTimer || 0) - dt);
      if (ai.animOverrideTimer <= 0) ai.animOverride = null;
      ai.powerGlowTimer = Math.max(0, (ai.powerGlowTimer || 0) - dt);
      ent.powerGlow = ai.powerGlowTimer;
      ai.extraNoteTimer = Math.max(0, (ai.extraNoteTimer || 0) - dt);
      ai.pushActionCooldown = Math.max(0, (ai.pushActionCooldown || 0) - dt);

      if (ent.dead || ai.state === 'dead') {
        ai.state = 'dead';
        const cause = (ent.deathCause || '').toLowerCase();
        ai.deadAnim = ai.deadAnim || (cause.includes('fire') ? 'die_fire' : cause.includes('crush') ? 'die_crush' : 'die_hit');
        ent.anim = ai.deadAnim;
        ent.vx = 0; ent.vy = 0;
        return;
      }

      if (ai.spawnPillTimer != null) {
        ai.spawnPillTimer -= dt;
        if (ai.spawnPillTimer <= 0 && ai.state !== 'dead' && ai.state !== 'talk') {
          spawnDoctorRandomPill(ent);
          const min = ai.spawnPillIntervalMin || this.cfg.spawnPillIntervalMin;
          const max = ai.spawnPillIntervalMax || this.cfg.spawnPillIntervalMax;
          ai.spawnPillTimer = rand(min, max);
          ai.animOverride = 'powerup';
          ai.animOverrideTimer = 0.8;
          ai.powerGlowTimer = 0.8;
        }
      }

      if (ai.state === 'talk') {
        ent.vx = 0; ent.vy = 0;
        ent.anim = 'talk';
        this._lookAtHero(ent, hero);
        return;
      }

      if (ai.state === 'cooldown') {
        ai.cooldownTimer = Math.max(0, (ai.cooldownTimer || 0) - dt);
        ent.vx *= 0.8;
        ent.vy *= 0.8;
        if (ai.cooldownTimer <= 0) {
          ai.state = 'patrol';
          if (ai.route && ai.route.length) {
            ai.patrolIndex = ai.patrolIndex % ai.route.length;
            if (isDebug()) console.debug('[DOCTOR] patrol target', { id: ent.id, index: ai.patrolIndex });
          }
        }
      }

      if (ai.state === 'patrol') {
        this._moveTowardsPatrol(ent, dt);
        if (ai.pushActionCooldown <= 0 && !ai.animOverride) {
          ai.animOverride = 'push_action';
          ai.animOverrideTimer = 0.55;
          ai.pushActionCooldown = rand(6, 10);
        }
      }

      this._mapAnimation(ent, ai);
      this._maybeStartCollisionDialog(ent, hero);
    },

    _lookAtHero(ent, hero) {
      if (!hero) return;
      const hx = hero.x + hero.w * 0.5;
      const hy = hero.y + hero.h * 0.5;
      const cx = ent.x + ent.w * 0.5;
      const cy = ent.y + ent.h * 0.5;
      const dx = hx - cx;
      const dy = hy - cy;
      if (Math.abs(dx) > Math.abs(dy)) {
        ent.ai.dir = dx >= 0 ? 'right' : 'left';
      } else {
        ent.ai.dir = dy >= 0 ? 'down' : 'up';
      }
      ent.flipX = (ent.ai.dir === 'left') ? -1 : 1;
    },

    _moveTowardsPatrol(ent, dt) {
      const ai = ent.ai || (ent.ai = {});
      const route = ai.route && ai.route.length ? ai.route : (ai.route = this._createFallbackRoute(ent));
      if (!route.length) return;
      ai.patrolIndex = ai.patrolIndex % route.length;
      const target = route[ai.patrolIndex];
      const cx = ent.x + ent.w * 0.5;
      const cy = ent.y + ent.h * 0.5;
      const dx = target.x - cx;
      const dy = target.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < this.cfg.arrivalDistance) {
        ai.patrolIndex = (ai.patrolIndex + 1) % route.length;
        ai.state = 'cooldown';
        ai.cooldownTimer = rand(this.cfg.patrolPauseMin, this.cfg.patrolPauseMax);
        ai.extraNoteTimer = Math.random() < 0.55 ? ai.cooldownTimer : rand(0.3, 0.8);
        ai.idleAnim = (ai.extraNoteTimer > 0.4) ? 'extra' : (Math.random() < 0.3 ? 'eat' : 'idle');
        ent.vx = 0; ent.vy = 0;
        if (isDebug()) console.debug('[DOCTOR] patrol target', { id: ent.id, index: ai.patrolIndex });
        return;
      }
      const dirX = dx / Math.max(dist, 0.001);
      const dirY = dy / Math.max(dist, 0.001);
      const targetSpeed = this.cfg.speed;
      const desiredVx = dirX * targetSpeed;
      const desiredVy = dirY * targetSpeed;
      ent.vx += clamp(desiredVx - ent.vx, -this.cfg.accel, this.cfg.accel) * dt;
      ent.vy += clamp(desiredVy - ent.vy, -this.cfg.accel, this.cfg.accel) * dt;
      const sp = Math.hypot(ent.vx, ent.vy);
      if (sp > targetSpeed) {
        const s = targetSpeed / Math.max(sp, 0.001);
        ent.vx *= s;
        ent.vy *= s;
      }
      if (Math.abs(ent.vx) > Math.abs(ent.vy)) {
        ai.dir = ent.vx >= 0 ? 'right' : 'left';
        ent.flipX = (ai.dir === 'left') ? -1 : 1;
      } else if (ent.vy < 0) {
        ai.dir = 'up';
      } else {
        ai.dir = 'down';
      }
    },

    _maybeStartCollisionDialog(ent, hero) {
      if (!hero) return;
      if (ent.ai?.state === 'talk' || ent.ai?.state === 'dead') return;
      if ((ent.ai?.talkCooldown || 0) > 0) return;
      if (!overlaps(ent, hero)) return;
      ent.ai.state = 'talk';
      ent.ai.talkCooldown = this.cfg.talkCooldown;
      ent.vx = 0; ent.vy = 0;
      startDoctorEasyRiddleDialog(ent, hero);
    },

    _mapAnimation(ent, ai) {
      if (ai.animOverride) {
        ent.anim = ai.animOverride;
        return;
      }
      if (ai.state === 'talk') {
        ent.anim = 'talk';
        return;
      }
      if (ai.state === 'cooldown') {
        ent.anim = ai.extraNoteTimer > 0.1 ? 'extra' : (ai.idleAnim || 'idle');
        return;
      }
      if (ai.state === 'patrol') {
        const speed = Math.hypot(ent.vx || 0, ent.vy || 0);
        if (speed > 4) {
          if (Math.abs(ent.vx) > Math.abs(ent.vy)) {
            ent.anim = 'walk_side';
            ai.dir = ent.vx >= 0 ? 'right' : 'left';
            ent.flipX = (ai.dir === 'left') ? -1 : 1;
          } else if (ent.vy < 0) {
            ent.anim = 'walk_up';
            ai.dir = 'up';
          } else {
            ent.anim = 'walk_down';
            ai.dir = 'down';
          }
        } else {
          ent.anim = ai.extraNoteTimer > 0.1 ? 'extra' : 'idle';
        }
        return;
      }
      ent.anim = 'idle';
    },
    _updateBuffs(dt) {
      const G = this.G;
      const p = G?.player;
      if (!p || !Array.isArray(G._medicEffects) || !G._medicEffects.length) return;
      for (let i = G._medicEffects.length - 1; i >= 0; i--) {
        const eff = G._medicEffects[i];
        eff.t -= dt;
        if (eff.t <= 0) {
          if (eff.shield && p.shield) {
            p.shield = Math.max(0, p.shield - eff.shield);
          }
          G._medicEffects.splice(i, 1);
        }
      }
      this._recomputeStatsFromEffects();
    },

    _addEffect(eff) {
      const G = this.G;
      const p = G?.player;
      if (!p) return;
      G._medicEffects = G._medicEffects || [];
      if (p._baseMaxSpeed == null) p._baseMaxSpeed = p.maxSpeed || 160;
      if (p._basePush == null) p._basePush = p.pushForce || p.push || 380;
      if (p._baseVision == null) p._baseVision = p.visionTiles || 3;
      if (p._baseAccel == null) p._baseAccel = p.accel || 800;
      G._medicEffects.push(eff);
      this._recomputeStatsFromEffects();
    },

    _recomputeStatsFromEffects() {
      const G = this.G;
      const p = G?.player;
      if (!p) return;
      const effects = G._medicEffects || [];
      const baseSpeed = p._baseMaxSpeed ?? p.maxSpeed ?? 160;
      const basePush = p._basePush ?? p.pushForce ?? 380;
      const baseVision = p._baseVision ?? p.visionTiles ?? 3;
      const baseAccel = p._baseAccel ?? p.accel ?? 800;
      let speedMul = 1;
      let pushMul = 1;
      let accelMul = 1;
      let visionDelta = 0;
      let invert = false;
      for (const eff of effects) {
        speedMul *= eff.speedMul || 1;
        pushMul *= eff.pushMul || 1;
        accelMul *= eff.accelMul || eff.speedMul || 1;
        visionDelta += eff.visionDelta || 0;
        if (eff.invertControls) invert = true;
      }
      p.maxSpeed = clamp(baseSpeed * speedMul, 60, 320);
      p.accel = clamp(baseAccel * accelMul, 300, 1400);
      p.pushForce = clamp(basePush * pushMul, 150, 900);
      p.visionTiles = clamp(baseVision + visionDelta, 1, 9);
      p._doctorInvertControls = invert;
    }
  };
  function startDoctorEasyRiddleDialog(e, hero) {
    if (!e || e.kind !== 'npc_medico') return false;
    const ai = e.ai || (e.ai = {});
    const idx = ai.riddleIndex % DOCTOR_RIDDLES.length;
    const riddle = DOCTOR_RIDDLES[idx];
    ai.riddleIndex = (ai.riddleIndex + 1) % DOCTOR_RIDDLES.length;
    ai.state = 'talk';
    e.vx = 0; e.vy = 0;
    e.anim = 'talk';
    e.isTalking = true;
    if (hero) {
      hero.vx = 0; hero.vy = 0;
      hero.isTalking = true;
      try { window.Entities?.Hero?.setTalking?.(hero, true, 1.4); } catch (_) {}
    }
    if (isDebug()) console.debug('[DOCTOR] start easy riddle', { heroId: hero?.id || hero?.heroId || 'player' });
    if (typeof pauseGame === 'function') pauseGame();

    const hint = riddle.hint ? `\n\n${riddle.hint}` : '';
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (typeof resumeGame === 'function') resumeGame();
      onDoctorDialogEnd(e, hero);
    };
    const handleAnswer = (isCorrect) => {
      if (finished) return;
      finished = true;
      const correct = !!isCorrect;
      if (correct) {
        ai.animOverride = 'powerup';
        ai.animOverrideTimer = 0.8;
        if (riddle.success) {
          try { window.HUD?.showFloatingMessage?.(hero || e, riddle.success, 1.6); } catch (_) {}
        }
      } else {
        ai.animOverride = 'attack';
        ai.animOverrideTimer = 0.8;
        if (riddle.fail) {
          try { window.HUD?.showFloatingMessage?.(hero || e, riddle.fail, 1.6); } catch (_) {}
        }
      }
      if (typeof window.DialogAPI?.close === 'function') {
        try { window.DialogAPI.close(); } catch (_) {}
      }
      if (typeof window.Dialog?.close === 'function') {
        try { window.Dialog.close(); } catch (_) {}
      }
      finish();
    };
    const opened = window.DialogUtils?.openRiddleDialog?.({
      id: riddle.key,
      title: riddle.title,
      ask: riddle.text,
      hint: riddle.hint,
      options: riddle.options,
      correctIndex: riddle.correctIndex,
      portraitCssVar: MedicoAPI.cfg.portraitCssVar,
      portrait: 'medico.png',
      onSuccess: () => handleAnswer(true),
      onFail: () => handleAnswer(false),
      onClose: () => finish()
    });

    if (!opened) {
      finish();
    }
    return true;
  }

  function onDoctorDialogEnd(e, hero) {
    if (!e || e.kind !== 'npc_medico') return;
    const ai = e.ai || (e.ai = {});
    ai.state = 'patrol';
    ai.animOverride = null;
    ai.animOverrideTimer = 0;
    ai.extraNoteTimer = 0;
    e.anim = 'idle';
    e.isTalking = false;
    e.vx = 0; e.vy = 0;
    if (hero) {
      hero.isTalking = false;
      try { window.Entities?.Hero?.setTalking?.(hero, false); } catch (_) {}
    }
    if (isDebug()) console.debug('[DOCTOR] end riddle, back to patrol');
  }

  function spawnDoctorRandomPill(doctor) {
    const api = MedicoAPI;
    const G = api.G;
    if (!G || !doctor) return null;
    const spot = findDoctorPillSpot(api, doctor);
    if (!spot) return null;
    const buff = chooseRandomBuff(Math.random() < 0.5 ? 'positive' : 'negative');
    if (!buff) return null;
    const pill = {
      id: 'PILL_DOC_' + Math.random().toString(36).slice(2, 9),
      kind: 'pill_doctor',
      kindName: 'pill',
      type: 'pill',
      source: 'doctor',
      buffType: buff.type,
      buff,
      x: spot.cx - spot.size * 0.5,
      y: spot.cy - spot.size * 0.5,
      w: spot.size,
      h: spot.size,
      solid: false,
      dynamic: false,
      spriteKey: 'pill_generic',
      color: buff.type === 'positive' ? '#7cf29a' : '#ff7c7c'
    };
    if (!G.entities.includes(pill)) G.entities.push(pill);
    if (!G.movers.includes(pill)) G.movers.push(pill);
    if (!G.pills.includes(pill)) G.pills.push(pill);
    pill.group = 'item';
    try { window.EntityGroups?.assign?.(pill); } catch (_) {}
    try {
      window.Puppet?.bind?.(pill, 'pill', { z: 0, scale: 1, data: { skin: 'pill_generic' } })
        || window.PuppetAPI?.attach?.(pill, { rig: 'pill', z: 0, scale: 1, data: { skin: 'pill_generic' } });
    } catch (_) {}
    if (isDebug()) console.debug('[DOCTOR_PILL] spawn', { doctorId: doctor.id || null, x: pill.x, y: pill.y, buff: pill.buff });
    return pill;
  }

  function findDoctorPillSpot(api, doctor) {
    const tile = api.TILE || 32;
    const size = tile * 0.4;
    const base = centerPoint(doctor);
    for (const off of PILL_OFFSETS) {
      const cx = base.x + off.x * tile;
      const cy = base.y + off.y * tile;
      if (isSpotFree(api, doctor, cx, cy, size)) {
        return { cx, cy, size };
      }
    }
    return null;
  }

  function isSpotFree(api, doctor, cx, cy, size) {
    const half = size * 0.5;
    const left = cx - half;
    const top = cy - half;
    if (typeof window.isWallAt === 'function' && window.isWallAt(left, top, size, size)) return false;
    const tile = api.TILE || 32;
    const map = api.G?.map;
    if (Array.isArray(map) && map.length) {
      const tx = Math.floor(cx / tile);
      const ty = Math.floor(cy / tile);
      if (ty < 0 || ty >= map.length || tx < 0 || tx >= (map[ty]?.length || 0)) return false;
      if (map[ty][tx]) return false;
    }
    const area = { x: left, y: top, w: size, h: size };
    for (const other of api.G?.entities || []) {
      if (!other || other === doctor || other.dead) continue;
      if (overlaps(area, other)) return false;
    }
    return true;
  }

  function chooseRandomBuff(type) {
    const pool = type === 'positive' ? POSITIVE_BUFFS : type === 'negative' ? NEGATIVE_BUFFS : [...POSITIVE_BUFFS, ...NEGATIVE_BUFFS];
    if (!pool.length) return null;
    const effectId = pool[Math.floor(Math.random() * pool.length)];
    const cfg = BUFF_CONFIG[effectId];
    if (!cfg) return null;
    return { type: cfg.type || type, effectId };
  }

  function applyDoctorBuff(hero, buff) {
    const api = MedicoAPI;
    const G = api.G;
    const carrier = hero || G?.player;
    if (!carrier || !buff) return false;
    const config = BUFF_CONFIG[buff.effectId];
    if (!config) return false;
    if (config.damage) {
      try { window.damagePlayer?.({ kind: 'pill_doctor', id: 'doctor_pill' }, config.damage); } catch (_) {}
    }
    if (!config.duration || config.duration <= 0) {
      if (isDebug()) console.debug('[DOCTOR_PILL] apply buff', { heroId: carrier.id || carrier.heroId || 'player', type: config.type || buff.type || 'instant', effectId: buff.effectId });
      return true;
    }
    const effect = {
      effectId: buff.effectId,
      type: config.type || buff.type,
      t: config.duration,
      speedMul: config.speedMul,
      pushMul: config.pushMul,
      accelMul: config.accelMul,
      visionDelta: config.visionDelta,
      invertControls: !!config.invertControls,
      shield: config.shield || 0
    };
    if (effect.shield > 0) {
      carrier.shield = (carrier.shield || 0) + effect.shield;
    }
    api._addEffect(effect);
    if (isDebug()) console.debug('[DOCTOR_PILL] apply buff', { heroId: carrier.id || carrier.heroId || 'player', type: effect.type || buff.type || 'random', effectId: buff.effectId });
    return true;
  }

  MedicoAPI.spawnDoctorRandomPill = spawnDoctorRandomPill;
  MedicoAPI.applyDoctorBuff = applyDoctorBuff;

  try {
    const G = window.G || (window.G = {});
    MedicoAPI.init(G);
    if (Array.isArray(G.systems)) {
      G.systems.push({ id: 'medics', update: (dt) => MedicoAPI.update(dt) });
    } else {
      G.systems = [{ id: 'medics', update: (dt) => MedicoAPI.update(dt) }];
    }
    if (!Array.isArray(G.onInteract)) G.onInteract = [];
    G.onInteract.push(() => MedicoAPI.tryInteract());
  } catch (_) {}

  window.MedicoAPI = MedicoAPI;
  window.startDoctorEasyRiddleDialog = startDoctorEasyRiddleDialog;
  window.onDoctorDialogEnd = onDoctorDialogEnd;
})();
