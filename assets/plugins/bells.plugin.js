// filename: bells.plugin.js
// Timbres por paciente: se activan de vez en cuando (≥5 min).
// Si expira el tiempo sin apagarse => el paciente se transforma en "Furiosa".
// Permite: apagar timbre con E (cerca) y mute global (teléfono).

(function () {
  const BellsAPI = {
    G: null, TILE: 32,
    cfg: {
      // Tiempo entre activaciones por timbre (segundos)
      ringMin: 300,   // 5 minutos
      ringMax: 540,   // 9 minutos
      // Tiempo que dura sonando antes de “furiosa” (segundos)
      ringDuration: 45,
      // Radios
      interactRadius: 42, // distancia para apagar con E
      pairMaxDist: 80,    // distancia para vincular timbre<>paciente si el mapa no los empareja
      // Audio
      sfxRing: 'bell_ring',
      sfxOff:  'bell_off',
      // Debug opcional (para test) — déjalo en null en producción
      debugShortTimers: false, // si true: ringMin=8, ringMax=14, ringDuration=10
    },

    bells: [], // {e:ENT, patient, nextAt, state:'idle'|'ringing', tLeft}
    now: 0,

    init(Gref, opts = {}) {
      this.G = Gref || window.G || (window.G = {});
      this.TILE = (typeof window.TILE_SIZE !== 'undefined') ? window.TILE_SIZE : 32;
      Object.assign(this.cfg, opts || {});
      if (this.cfg.debugShortTimers) {
        this.cfg.ringMin = 8; this.cfg.ringMax = 14; this.cfg.ringDuration = 10;
      }
      if (!Array.isArray(this.G.entities)) this.G.entities = [];
      if (!Array.isArray(this.G.patients)) this.G.patients = [];
      return this;
    },

    // Llamar desde parseMap al ver 'T' (timbre): registra la entidad
    registerBellEntity(bellEnt) {
      // bellEnt: entidad con kind ENT.BELL, x,y,w,h
      this.bells.push({
        e: bellEnt, patient: null,
        nextAt: this._nextTime(this.cfg.ringMin, this.cfg.ringMax),
        state: 'idle', tLeft: 0
      });
    },

    // Vincula cada timbre al paciente más cercano (si el mapa no lo dejó pre-asignado)
    linkBellsToPatients() {
      const patients = this.G.patients || [];
      for (const b of this.bells) {
        if (b.patient && !b.patient.dead) continue;
        let best = null, bestD = 1e9;
        for (const p of patients) {
          if (p.dead) continue;
          const d = Math.hypot((p.x + p.w * 0.5) - (b.e.x + b.e.w * 0.5),
                               (p.y + p.h * 0.5) - (b.e.y + b.e.h * 0.5));
          if (d < bestD) { bestD = d; best = p; }
        }
        if (best && bestD <= this.cfg.pairMaxDist) {
          b.patient = best;
        }
      }
    },

    // Llamar cada frame
    update(dt) {
      this.now += dt;
      const G = this.G;

      for (let i = this.bells.length - 1; i >= 0; i--) {
        const b = this.bells[i];
        const bell = b.e;
        if (!bell || bell.dead) { this.bells.splice(i, 1); continue; }

        // Si el paciente ya no existe o ya está satisfecho -> desactiva ese timbre
        if (!b.patient || b.patient.dead || b.patient.satisfied) {
          b.state = 'idle';
          b.nextAt = this._nextTime(this.cfg.ringMin, this.cfg.ringMax);
          continue;
        }

        // 1) Programación de la próxima llamada
        if (b.state === 'idle' && this.now >= b.nextAt) {
          b.state = 'ringing';
          b.tLeft = this.cfg.ringDuration;
          // Sonido:
          if (window.AudioAPI) AudioAPI.play(this.cfg.sfxRing, { at: { x: bell.x, y: bell.y }, volume: 0.9 });
          // Visual opcional: marca
          bell.ringing = true;
        }

        // 2) Si está sonando, cuenta atrás; si llega a 0 -> convertir paciente en furiosa
        if (b.state === 'ringing') {
          b.tLeft -= dt;
          // ping visual liviano
          bell._pulse = ((bell._pulse || 0) + dt) % 1.0;

          // Si el jugador está cerca y pulsa E -> apaga
          // (la interacción real se hace por tryInteract(); aquí solo el estado)
          if (b.tLeft <= 0) {
            // TRANSFORMACIÓN a FURIOSA
            if (window.FuriousAPI) {
              FuriousAPI.spawnFromPatient(b.patient);
            } else {
              this._transformPatientFallback(b.patient);
            }
            // El paciente desaparece; resetea timbre
            b.patient = null;
            b.state = 'idle';
            b.nextAt = this._nextTime(this.cfg.ringMin, this.cfg.ringMax);
            bell.ringing = false;
          }
        }
      }
    },

    // Intenta apagar un timbre cercano cuando el jugador pulsa E
    tryInteract() {
      const p = this.G.player;
      if (!p) return false;
      for (const b of this.bells) {
        const bell = b.e;
        if (!bell || bell.dead || b.state !== 'ringing') continue;
        const d = Math.hypot((p.x + p.w * 0.5) - (bell.x + bell.w * 0.5),
                             (p.y + p.h * 0.5) - (bell.y + bell.h * 0.5));
        if (d <= this.cfg.interactRadius) {
          // apagar
          b.state = 'idle';
          b.nextAt = this._nextTime(this.cfg.ringMin, this.cfg.ringMax);
          b.tLeft = 0;
          bell.ringing = false;
          if (window.AudioAPI) AudioAPI.play(this.cfg.sfxOff, { at: { x: bell.x, y: bell.y }, volume: 0.9 });
          // bonus opcional:
          if (this.G.addScore) this.G.addScore(50);
          return true;
        }
      }
      return false;
    },

    // Teléfono de control: apaga TODO y reprograma
    muteAll() {
      for (const b of this.bells) {
        if (!b.e || b.e.dead) continue;
        b.state = 'idle';
        b.tLeft = 0;
        b.nextAt = this._nextTime(this.cfg.ringMin, this.cfg.ringMax);
        b.e.ringing = false;
      }
      if (window.AudioAPI) AudioAPI.play('phone_ok', { volume: 0.8 });
    },

    // ====== utilidades ======
    _nextTime(min, max) {
      const t = min + Math.random() * (max - min);
      return this.now + t;
    },

    _transformPatientFallback(patient) {
      if (!patient || patient.dead) return;
      // Quita paciente
      patient.dead = true;
      this.G.entities = this.G.entities.filter(x => x !== patient);
      this.G.patients = (this.G.patients || []).filter(x => x !== patient);
      this.G.npcs     = (this.G.npcs || []).filter(x => x !== patient);
      // Crea un "enemigo simple" si no existe FuriousAPI
      const ENT = this.G.ENT || {};
      const e = {
        kind: ENT.FURIOUS || 'furious',
        x: patient.x, y: patient.y, w: patient.w, h: patient.h,
        vx: 0, vy: 0, mass: 120, dynamic: true, solid: true,
        color: '#ff5a6b', t: 0, touchCD: 0
      };
      this.G.entities.push(e);
      this.G.enemies = this.G.enemies || [];
      this.G.enemies.push(e);
      if (window.Physics && Physics.registerEntity) Physics.registerEntity(e);
    }
  };

  window.BellsAPI = BellsAPI;
})();