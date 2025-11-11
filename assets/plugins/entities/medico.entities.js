// filename: medico.entities.js
// NPC MÉDICO para “Il Divo: Hospital Dash!”
//
// - Patrulla automáticamente por los pacientes.
// - Interacción (tecla E): lanza acertijo con premio/castigo.
// - Premios/Castigos: curas/daño + buffs/debuffs temporales (velocidad/empuje/visión).
// - Integración: DialogAPI (o Dialog), Physics, DoorsAPI, PatientsAPI.
// - Compatible con Spawner: W.MedicoAPI.spawn(x,y,p) o registerMedicEntity(e).

(function () {
  'use strict';

  // Utilidades
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const H = Math.hypot;

  // ---- Config por defecto ---------------------------------------------------
  const DEFAULTS = {
    speed: 62,           // px/s caminando
    accel: 480,          // aceleración (px/s^2)
    mass: 95,            // empujable (billar leve)
    restitution: 0.05,
    friction: 0.1,
    pauseAtPatient: 1.2, // segundos parado junto al paciente

    interactRadius: 44,  // distancia jugador-médico para hablar
    riddleCooldown: 16,  // s entre acertijos del mismo médico

    // Buffs / castigos por defecto
    rewards: { healHalves: 2, secs: 12, speedMul: 1.12, pushMul: 1.12, visionDelta: +1 },
    penalties:{ dmgHalves: 2, secs: 10, speedMul: 0.88, pushMul: 0.9,  visionDelta: -1 },

    // Adivinanzas (personaliza libremente)
    riddles: [
      {
        id: 'termometro',
        title: 'Consulta del Dr.',
        text: 'Si me pones debajo del brazo, te diré la verdad. ¿Qué soy?',
        options: ['El fonendo', 'El termómetro', 'El otoscopio'],
        correctIndex: 1,
        reward: { healHalves: 2, secs: 12, speedMul: 1.10, pushMul: 1.10, visionDelta: +1 },
        penalty:{ dmgHalves: 2, secs: 10, speedMul: 0.85, pushMul: 0.90, visionDelta: -1 }
      },
      {
        id: 'lavamanos',
        title: 'Higiene ante todo',
        text: 'En quirófano me usan sin parar. No soy guante ni mascarilla. ¿Qué soy?',
        options: ['Lavamanos', 'Café del turno', 'Gorro de quirófano'],
        correctIndex: 0,
        reward: { healHalves: 2, secs: 14, speedMul: 1.12, pushMul: 1.12, visionDelta: +1 },
        penalty:{ dmgHalves: 2, secs: 12, speedMul: 0.80, pushMul: 0.85, visionDelta: -1 }
      },
      {
        id: 'historias',
        title: 'Papeles eternos',
        text: 'Todos me abren y me leen, pero nadie me estudia. ¿Qué soy?',
        options: ['Historias clínicas', 'Libro de farmacología', 'El BOE'],
        correctIndex: 0,
        reward: { healHalves: 2, secs: 16, speedMul: 1.15, pushMul: 1.15, visionDelta: +1 },
        penalty:{ dmgHalves: 2, secs: 12, speedMul: 0.85, pushMul: 0.85, visionDelta: -1 }
      }
    ],

    portraitCssVar: '--sprite-medic-portrait' // si tienes retrato en CSS
  };

  // ---- API principal --------------------------------------------------------
  const MedicoAPI = {
    G: null, TILE: 32, cfg: null,
    medics: [],       // [{ e, tHold }]
    _targets: null,   // { list:[{x,y}], i, _stamp }

    init(Gref, opts = {}) {
      this.G = Gref || window.G || (window.G = {});
      this.TILE = (typeof window.TILE_SIZE !== 'undefined') ? window.TILE_SIZE : 32;
      this.cfg = Object.assign({}, DEFAULTS, opts || {});
      if (!Array.isArray(this.G.entities)) this.G.entities = [];
      try { window.EntityGroups?.ensure?.(this.G); } catch (_) {}
      return this;
    },

    // Crea y registra un médico (para Spawner/placements)
    spawn(x, y, p = {}) {
      this.init(this.G || window.G);
      const e = {
        id: 'MED' + Math.random().toString(36).slice(2),
        x, y, w: this.TILE * 0.9, h: this.TILE * 0.9,
        vx: 0, vy: 0, color: '#5ac6ff',
        skin: 'medico.png', dynamic: true, solid: true, pushable: true
      };
      this.registerMedicEntity(e);
      return e;
    },

    // Registra un objeto ya creado como médico
    registerMedicEntity(medicEnt) {
      medicEnt.kind = (this.G.ENT?.MEDIC) || 'medic';
      medicEnt.mass = this.cfg.mass;
      medicEnt.restitution = this.cfg.restitution;
      medicEnt.friction = this.cfg.friction;
      medicEnt.solid = true; medicEnt.dynamic = true; medicEnt.pushable = true;
      medicEnt.vx = medicEnt.vx || 0; medicEnt.vy = medicEnt.vy || 0;
      medicEnt.ai = { i: 0, pause: 0 };
      medicEnt.lastRiddleAt = -999;

      medicEnt.skin = medicEnt.skin || 'medico.png';
      medicEnt.aiId = 'MEDIC';
      try { window.AI?.attach?.(medicEnt, 'MEDIC'); } catch (_) {}

      this.G.entities.push(medicEnt);
      medicEnt.group = 'human';
      try { window.EntityGroups?.assign?.(medicEnt); } catch (_) {}
      try { window.EntityGroups?.register?.(medicEnt, this.G); } catch (_) {}
      this.medics.push({ e: medicEnt, tHold: 0 });

      if (window.Physics?.registerEntity) Physics.registerEntity(medicEnt);

      try {
        const puppet = window.Puppet?.bind?.(medicEnt, 'npc_medico', { z: 0, scale: 1, data: { skin: medicEnt.skin } })
          || window.PuppetAPI?.attach?.(medicEnt, { rig: 'npc_medico', z: 0, scale: 1, data: { skin: medicEnt.skin } });
        medicEnt.rigOk = true;
      } catch (_) {
        medicEnt.rigOk = true;
      }
    },

    // Garantiza al menos 1 médico (fallback)
    ensureOneIfMissing() {
      if (this.medics.length > 0) return;
      const p0 = (this.G.patients || [])[0];
      const x = p0 ? p0.x + this.TILE * 2 : this.TILE * 4;
      const y = p0 ? p0.y : this.TILE * 4;
      this.spawn(x, y, {});
    },

    // Llamar en tu game loop o vía systems
    update(dt) {
      this._refreshTargetsIfNeeded();

      for (const m of this.medics) {
        const e = m.e;
        if (!e || e.dead) continue;

        if (e.ai.pause > 0) {
          e.ai.pause -= dt;
          e.vx *= 0.9; e.vy *= 0.9;
        } else {
          this._patrolStep(e, dt);
        }

        // Cap de velocidad
        const spd = Math.hypot(e.vx || 0, e.vy || 0);
        if (spd > this.cfg.speed) {
          const s = this.cfg.speed / spd; e.vx *= s; e.vy *= s;
        }

        // Abrir puertas cercanas si hay DoorsAPI
        if (window.DoorsAPI?.autoOpenNear) DoorsAPI.autoOpenNear(e, this.TILE * 0.8);
      }

      // Gestiona efectos activos aplicados por médicos al jugador
      this._updateBuffs(dt);
    },

    // Atajo para input: si jugador está cerca de algún médico, abre acertijo
    tryInteract() {
      const p = this.G.player; if (!p) return false;
      let target = null, bestD = 1e9;
      for (const m of this.medics) {
        const e = m.e; if (!e || e.dead) continue;
        const d = H(p.x + p.w / 2 - (e.x + e.w / 2), p.y + p.h / 2 - (e.y + e.h / 2));
        if (d < bestD) { bestD = d; target = e; }
      }
      if (!target || bestD > this.cfg.interactRadius) return false;

      // Cooldown de diálogo
      const now = (this.G.nowSec ? this.G.nowSec() : performance.now() / 1000);
      if ((target.lastRiddleAt || -999) + this.cfg.riddleCooldown > now) return false;
      target.lastRiddleAt = now;

      this._openRiddleDialog(target);
      return true;
    },

    // ===== Internos: patrulla / destino =====
    _refreshTargetsIfNeeded() {
      const ps = (this.G.patients || []).filter(p => p && !p.dead);
      if (!this._targets || this._targets._stamp !== ps.length) {
        this._targets = {
          list: ps.map(p => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 })),
          _stamp: ps.length, i: 0
        };
      }
    },

    _patrolStep(e, dt) {
      const list = (this._targets && this._targets.list) || [];
      if (!list.length) { e.vx *= 0.9; e.vy *= 0.9; return; }

      // Siguiente punto
      const ai = e.ai;
      if (ai.i >= list.length) ai.i = 0;
      const tgt = list[ai.i];
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      const dx = tgt.x - cx, dy = tgt.y - cy;
      const dist = Math.hypot(dx, dy);

      if (dist < this.TILE * 0.6) {
        ai.i = (ai.i + 1) % list.length;
        ai.pause = this.cfg.pauseAtPatient;
        if (window.AudioAPI) AudioAPI.play('medic_step', { volume: 0.4, throttleMs: 200 });
        return;
      }

      // Dirección con pequeño look-ahead anti-pared
      let dirx = Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0;
      let diry = (dirx === 0) ? Math.sign(dy) : 0;

      const la = 14; // px de look-ahead
      if (this._hitsWall(cx + dirx * la, cy + diry * la, e.w, e.h)) {
        if (dirx !== 0) { dirx = 0; diry = Math.sign(dy) || 1; }
        else { diry = 0; dirx = Math.sign(dx) || 1; }
      }

      const tvx = dirx * this.cfg.speed;
      const tvy = diry * this.cfg.speed;
      const ax = clamp(tvx - (e.vx || 0), -this.cfg.accel, this.cfg.accel);
      const ay = clamp(tvy - (e.vy || 0), -this.cfg.accel, this.cfg.accel);

      if (window.Physics?.applyImpulse) {
        Physics.applyImpulse(e, ax * dt * e.mass, ay * dt * e.mass);
      } else {
        e.vx = (e.vx || 0) + ax * dt;
        e.vy = (e.vy || 0) + ay * dt;
      }
    },

    _hitsWall(nx, ny, w, h) {
      if (typeof window.isWallAt === 'function') return !!isWallAt(nx - w / 2, ny - h / 2, w, h);
      return false;
    },

    // ===== Adivinanzas / Diálogo =====
    _openRiddleDialog(medic) {
      const pool = this.cfg.riddles;
      const r = pool[(Math.random() * pool.length) | 0];
      const player = this.G?.player || null;

      const setTalking = (active) => {
        if (medic) medic.isTalking = !!active;
        if (player) player.isTalking = !!active;
      };
      setTalking(true);

      const closeTalking = () => setTalking(false);

      // Soporte para varios dialog systems
      const onSelect = (idx) => {
        closeTalking();
        this._resolveRiddle(r, idx, medic);
      };
      const buttons = r.options.map((label, idx) => ({ label, value: idx }));

      if (window.DialogAPI?.open) {
        DialogAPI.open({
          portrait: 'medico',
          title: r.title,
          text: r.text,
          buttons: buttons.map((btn, idx) => ({
            label: btn.label,
            primary: idx === r.correctIndex,
            action: () => onSelect(idx)
          })),
          pauseGame: true,
          onClose: closeTalking
        });
        return;
      }
      if (window.Dialog?.open) {
        Dialog.open({
          portrait: "medico.png",
          text: r.text,
          options: r.options,
          correct: r.correctIndex,
          onAnswer: (idx) => { onSelect(idx); }
        });
        return;
      }

      // Fallback mínimo
      const idx = Number(prompt(`${r.title}\n\n${r.text}\n\n${r.options.map((o,i)=>`[${i}] ${o}`).join('\n')}\n\nRespuesta (número):`, '0'))|0;
      onSelect(idx);
    },

    _resolveRiddle(r, chosenIdx, medic) {
      const ok = (chosenIdx === r.correctIndex);
      this._applyOutcome(ok ? (r.reward || this.cfg.rewards) : (r.penalty || this.cfg.penalties), ok);
      if (ok && this.G?.sfx?.ok) this.G.sfx.ok(medic);
      if (!ok && this.G?.sfx?.bad) this.G.sfx.bad(medic);
    },

    _applyOutcome(cfg, isReward) {
      const G = this.G, p = G.player; if (!p) return;

      // Vida (usa tu sistema de corazones/vidas si existe)
      if (isReward && cfg.healHalves) {
        p.hearts = Math.min((p.heartsMax || 10), (p.hearts || 6) + cfg.healHalves);
      }
      if (!isReward && cfg.dmgHalves) {
        p.hearts = Math.max(0, (p.hearts || 6) - cfg.dmgHalves);
        if (typeof G.onPlayerDamaged === 'function') G.onPlayerDamaged(p, cfg.dmgHalves, 'medico_riddle');
      }

      // Efecto temporal
      const eff = {
        t: cfg.secs || 10,
        speedMul: cfg.speedMul || 1,
        pushMul: cfg.pushMul || 1,
        visionDelta: cfg.visionDelta || 0
      };
      this._addEffect(eff);
    },

    // ===== Efectos acumulables sobre el jugador =====
    _addEffect(eff) {
      const G = this.G, p = G.player; if (!p) return;
      G._medicEffects = G._medicEffects || [];

      // Guarda bases si no existían
      if (p._baseMaxSpeed == null) p._baseMaxSpeed = p.maxSpeed || 160;
      if (p._basePush == null)     p._basePush     = p.pushForce || 380;
      if (p._baseVision == null)   p._baseVision   = p.visionTiles || 3;

      G._medicEffects.push(eff);
      this._recomputeStatsFromEffects();
    },

    _updateBuffs(dt) {
      const G = this.G, p = G.player; if (!p) return;
      if (!G._medicEffects || !G._medicEffects.length) return;

      for (let i = G._medicEffects.length - 1; i >= 0; i--) {
        const e = G._medicEffects[i];
        e.t -= dt;
        if (e.t <= 0) G._medicEffects.splice(i, 1);
      }
      this._recomputeStatsFromEffects();
    },

    _recomputeStatsFromEffects() {
      const G = this.G, p = G.player; if (!p) return;
      const baseSpeed  = p._baseMaxSpeed || p.maxSpeed || 160;
      const basePush   = p._basePush     || p.pushForce || 380;
      const baseVision = p._baseVision   || p.visionTiles || 3;

      let speedMul = 1, pushMul = 1, visionDelta = 0;
      for (const e of (G._medicEffects || [])) {
        speedMul *= (e.speedMul || 1);
        pushMul  *= (e.pushMul || 1);
        visionDelta += (e.visionDelta || 0);
      }

      p.maxSpeed    = clamp(baseSpeed * speedMul, 80, 320);
      p.pushForce   = clamp(basePush  * pushMul,  180, 800);
      p.visionTiles = clamp(baseVision + visionDelta, 1, 9);
      // Fog/linterna se adaptan en tus otros sistemas
    }
  };

  // ---- Auto-hook: systems / input -----------------------------------------
  try {
    const G = window.G || (window.G = {});
    MedicoAPI.init(G);
    // meter update al sistema si existe
    if (Array.isArray(G.systems)) G.systems.push({ id: 'medics', update: (dt) => MedicoAPI.update(dt) });
    // si tu input central expone g.onInteract, nos enganchamos
    if (!G.onInteract) G.onInteract = [];
    G.onInteract.push(() => MedicoAPI.tryInteract());
  } catch(_) {}

  // Export público
  window.MedicoAPI = MedicoAPI;
})();