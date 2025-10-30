// filename: supervisora.entities.js
// Supervisora: deja “paperitos” que, al recoger, aplican DEBUFFS negativos.
// Integra Dialog, Audio y el sistema combinado de efectos.
// Expone: window.SupervisoraAPI y window.Entities.SupervisoraAPI

(function () {
  'use strict';

  // --- Aliases / Guards ------------------------------------------------------
  const W = window;
  const G = () => (W.G || (W.G = {}));

  // Asegura que Dialog exista como "Dialog" (muchos scripts llaman Dialog.open)
  if (!W.Dialog && W.DialogAPI) W.Dialog = W.DialogAPI;

  W.Entities = W.Entities || {};
  const ENT = (G().ENT = G().ENT || {});
  ENT.SUPERVISORA = ENT.SUPERVISORA || 'supervisora';
  ENT.PAPER       = ENT.PAPER       || 'paper_sup';

  const TILE = (typeof W.TILE_SIZE !== 'undefined') ? W.TILE_SIZE : 32;

  // --- Utilidades geom / colisiones -----------------------------------------
  function AABB(a,b){
    return !(a.x+a.w <= b.x || b.x+b.w <= a.x || a.y+a.h <= b.y || b.y+b.h <= a.y);
  }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  // --- Config por defecto ----------------------------------------------------
  const DEFAULTS = {
    w: TILE*0.95, h: TILE*0.95,
    mass: 110, restitution: 0.05, friction: 0.85,
    maxSpeed: 120,
    dropEveryMinSec: 10,          // cada 10..18 s suelta un papel
    dropEveryMaxSec: 18,
    paperTTL: 28,                 // el papel desaparece si no se recoge
    paperPickRadiusPx: TILE*0.75, // radio de recogida
    roamRadiusTiles: 8,
    sfx: {
      step: 'sup_step',
      drop: 'paper_drop',
      pick: 'paper_pick'
    },
    // Curvas para el “bridge” de G.debuff -> efectos combinados (G._supEffects)
    bridge: {
      recoilToPushMul: (recoilMul)=> clamp(1 / clamp(recoilMul||1, 0.5, 3), 0.5, 1) // más recoil => menos push
    }
  };

  // --- Estado / API ----------------------------------------------------------
  const SupervisoraAPI = {
    cfg: null, list: [], papers: [],
    _tDrop: 0, _rng: Math.random, _effectsBridgeActive: false,

    init(opts={}){
      this.cfg = Object.assign({}, DEFAULTS, opts||{});
      const g = G();
      g.entities = g.entities || [];
      g.npcs     = g.npcs || [];
      return this;
    },

    // Crear entidad
    spawn(x, y, p = {}){
      if (!this.cfg) this.init();

      const e = {
        kind: ENT.SUPERVISORA,
        x: x|0, y: y|0, w: this.cfg.w, h: this.cfg.h,
        vx:0, vy:0, mass:this.cfg.mass, restitution:this.cfg.restitution, friction:this.cfg.friction,
        maxSpeed: this.cfg.maxSpeed, pushable: true, solid: true, dynamic: true,
        ai: { roamAngle: this._rng()*Math.PI*2, roamTime: 0, pause: 0 }
      };

      // Registrar en listas globales
      const g = G();
      g.entities.push(e);
      g.npcs.push(e);
      this.list.push(e);

      // Arrancar temporizador de drop aleatorio
      this._tDrop = this._nextDrop();

      return e;
    },

    // Actualizar todo
    update(dt){
      if (!this.list.length && !this.papers.length && !G().debuff) return;

      // 1) IA de movimiento + suelta papeles
      for (const e of this.list){
        if (!e || e.dead) continue;
        this._aiRoam(e, dt);
      }

      // 2) Tick de papeles (vida y recogida)
      this._tickPapers(dt);

      // 3) Adaptador: G.debuff -> G._supEffects y expiración
      this._tickDebuffAdapter(dt);
    },

    // --- IA básica de “paseíto” + soltar papeles ----------------------------
    _aiRoam(e, dt){
      const c = this.cfg;
      const g = G();

      // Paseo pseudo-aleatorio con cambio de dirección cada ~1.2..2.0 s
      e.ai.roamTime -= dt;
      if (e.ai.roamTime <= 0){
        e.ai.roamTime = 1.2 + this._rng()*0.8;
        e.ai.roamAngle = (e.ai.roamAngle + (this._rng()*1.4 - 0.7) + Math.PI*2)%(Math.PI*2);
      }

      const sp = c.maxSpeed * 0.55;
      e.vx = Math.cos(e.ai.roamAngle) * sp;
      e.vy = Math.sin(e.ai.roamAngle) * sp;

      // Integración muy simple (si ya tienes Physics.plugin, lo moverá allí)
      e.x += e.vx * dt;
      e.y += e.vy * dt;

      // Pasos / sonido
      if (W.AudioAPI) W.AudioAPI.play(c.sfx.step, { volume:0.15, throttleMs:220 });

      // Soltar papel cada cierto tiempo global (no por instancia para no spamear demasiado)
      this._tDrop -= dt;
      if (this._tDrop <= 0){
        this._tDrop = this._nextDrop();
        this._dropPaperNear(e.x+e.w/2, e.y+e.h/2);
      }
    },

    _nextDrop(){
      const c = this.cfg;
      return c.dropEveryMinSec + this._rng()*(c.dropEveryMaxSec - c.dropEveryMinSec);
    },

    // --- Paperitos -----------------------------------------------------------
    _dropPaperNear(cx, cy){
      const c = this.cfg;
      const r = TILE * (0.6 + this._rng()*1.2);
      const ang = this._rng()*Math.PI*2;
      const px = (cx + Math.cos(ang)*r)|0;
      const py = (cy + Math.sin(ang)*r)|0;

      const p = {
        kind: ENT.PAPER, x: px, y: py, w: TILE*0.6, h: TILE*0.5,
        ttl: c.paperTTL,
        content: this._randomPaperDialog(), // puede ser texto/QA si lo deseas
      };
      this.papers.push(p);
      G().entities.push(p);

      if (W.AudioAPI) W.AudioAPI.play(c.sfx.drop, { volume:0.45 });
    },

    _randomPaperDialog(){
      // Puedes personalizar con variedad de textos / “firmas”
      const frases = [
        'Rellena este formulario de calidad, por favor.',
        'Falta la firma de conformidad del paciente.',
        'Sin sello no pasa control. ¿Lo tienes?',
        'Adjunta copia del informe quirúrgico.',
        'Checklist de seguridad pendiente. ¡Firma!',
        'Sube esto al portal antes de medianoche.',
        'Necesito tu firma en duplicado.',
        '¡Auditoría sorpresa! Completa este papel.'
      ];
      const pick = frases[(Math.random()*frases.length)|0];
      return { text: pick, options: ['OK'] };
    },

    _tickPapers(dt){
      const g = G();

      // 1) Expirar y limpiar
      for (let i=this.papers.length-1;i>=0;i--){
        const p = this.papers[i];
        if (p.dead){ this.papers.splice(i,1); continue; }
        p.ttl -= dt;
        if (p.ttl <= 0){
          p.dead = true;
          // saca de entities
          const idx = g.entities.indexOf(p);
          if (idx>=0) g.entities.splice(idx,1);
          this.papers.splice(i,1);
        }
      }

      // 2) Recogida por el jugador
      const pl = g.player;
      if (!pl) return;
      for (const p of this.papers){
        if (p.dead) continue;
        // Recogida: usar AABB rápido con un radio extra
        const pad = this.cfg.paperPickRadiusPx;
        const fake = { x:pl.x-pad/2, y:pl.y-pad/2, w:pl.w+pad, h:pl.h+pad };
        if (AABB(fake, p)){
          // === Llamada a la función pedida (pegada TAL CUAL) ===
          onPickupPaper(p, pl);
          if (W.AudioAPI) W.AudioAPI.play(this.cfg.sfx.pick, { volume:0.5 });
        }
      }
    },

    // --- Adaptador: G.debuff -> sistema combinado (G._supEffects) -----------
    _tickDebuffAdapter(dt){
      const g = G();
      if (!g.debuff) return;

      // Ticking del temporizador
      g.debuff.t = (g.debuff.t||0) - dt;
      if (g.debuff.t <= 0){
        // fin del debuff: limpiar flags y efecto puente
        if (g.debuff.invert) g.inputInvert = false;
        delete g.debuff;

        // quitar efecto puente
        g._supEffects = g._supEffects || [];
        for (let i=g._supEffects.length-1;i>=0;i--){
          if (g._supEffects[i]._source === 'sup_bridge') g._supEffects.splice(i,1);
        }
        this._recomputeAllEffects();
        return;
      }

      // Mapear a efecto combinado (para velocidad/empuje/visión)
      const eff = {
        _source: 'sup_bridge',
        t: g.debuff.t,
        speedMul: g.debuff.speedMul || 1,
        pushMul:  this.cfg.bridge.recoilToPushMul(g.debuff.recoilMul || 1),
        visionDelta: 0 // estos debuffs no tocan visión en tu función pedida
      };

      // Aplica invert de controles si procede (tu input layer debe respetar G.inputInvert)
      if (g.debuff.invert) g.inputInvert = true;

      // Inserta/sustituye el efecto puente
      g._supEffects = g._supEffects || [];
      const idx = g._supEffects.findIndex(e => e && e._source==='sup_bridge');
      if (idx >= 0) g._supEffects[idx] = eff; else g._supEffects.push(eff);

      this._recomputeAllEffects();
    },

    // Recomputa stats combinando Médico + Jefe + Supervisora + Familiar
    _recomputeAllEffects(){
      const g = G(), p = g.player; if (!p) return;

      // Baselines si no existen
      if (p._baseMaxSpeed == null) p._baseMaxSpeed = p.maxSpeed || 160;
      if (p._basePush     == null) p._basePush     = p.pushForce || 380;
      if (p._baseVision   == null) p._baseVision   = p.visionTiles || 3;

      const all = []
        .concat(g._medicEffects || [])
        .concat(g._chiefEffects || [])
        .concat(g._supEffects   || [])
        .concat(g._famEffects   || []);

      let speedMul=1, pushMul=1, visionDelta=0;
      for (const e of all){
        speedMul   *= (e.speedMul||1);
        pushMul    *= (e.pushMul ||1);
        visionDelta += (e.visionDelta||0);
      }

      p.maxSpeed    = clamp((p._baseMaxSpeed) * speedMul, 80, 340);
      p.pushForce   = clamp((p._basePush)     * pushMul,  180, 900);
      p.visionTiles = clamp((p._baseVision)   + visionDelta, 1, 9);
    }
  };

  // ======================================================================
  // === FUNCIÓN SOLICITADA: reemplazar onPickupPaper TAL CUAL (pegar) ===
  // ======================================================================
  function onPickupPaper(paper, player) {
    // Popup si tienes diálogo; si no, aplica debuff directamente
    const applyRandomDebuff = () => {
      const roll = Math.random();
      // Tres debuffs sencillos: lento, invertido, más retroceso
      if (roll < 0.34) {
        // Lentitud 20% durante 8 s
        window.G = window.G || {};
        G().debuff = { ...(G().debuff||{}), speedMul: 0.80, t: Math.max(8, (G().debuff?.t||0)) };
        G().debuff.label = 'Lentitud';
      } else if (roll < 0.67) {
        // Controles invertidos 6 s
        window.G = window.G || {};
        G().debuff = { ...(G().debuff||{}), invert: true, t: Math.max(6, (G().debuff?.t||0)) };
        G().debuff.label = 'Controles invertidos';
      } else {
        // Más retroceso recibido 10 s
        window.G = window.G || {};
        G().debuff = { ...(G().debuff||{}), recoilMul: 1.35, t: Math.max(10, (G().debuff?.t||0)) };
        G().debuff.label = 'Retroceso +35%';
      }
    };

    if (window.Dialog && paper.content) {
      window.Dialog.open({
        portrait: "supervisora.png",
        text: paper.content.text || "¡Firma aquí!",
        options: paper.content.options || ["OK"],
        correct: paper.content.correct,
        onAnswer: (_opt) => { applyRandomDebuff(); }
      });
    } else {
      applyRandomDebuff();
    }
    paper.dead = true;
  }
  // ======================================================================
  // === FIN función pedida =================================================
  // ======================================================================

  // --- Export / Auto-init ----------------------------------------------------
  W.SupervisoraAPI = SupervisoraAPI;
  W.Entities.SupervisoraAPI = SupervisoraAPI; // para el spawner y placement
  if (!SupervisoraAPI.cfg) SupervisoraAPI.init();

  // Si tu game loop no llama explícitamente, puedes engancharte al tick global:
  // (Descomenta si no tienes otro sitio llamando)
  // (function hook(){
  //   const step = (ts)=>{
  //     const now = ts * 0.001;
  //     const dt = (W.__lastTS ? (ts - W.__lastTS) : 16.6) * 0.001;
  //     W.__lastTS = ts;
  //     SupervisoraAPI.update(dt);
  //     W.requestAnimationFrame(step);
  //   };
  //   W.requestAnimationFrame(step);
  // })();

})();