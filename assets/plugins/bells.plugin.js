// filename: bells.plugin.js
// Timbres por paciente: se activan de vez en cuando (≥5 min).
// Si expira el tiempo sin apagarse => el paciente se transforma en "Furiosa".
// Permite: apagar timbre con E (cerca) y mute global (teléfono).

(function () {
  function updateBellSpriteVisual(bell, ringing) {
    if (!bell) return;
    const idle = bell._spriteIdle || bell.spriteKey || 'timbre_apagado';
    const active = bell._spriteRinging || idle;
    bell.ringing = !!ringing;
    bell.spriteKey = ringing ? active : idle;
  }

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
    _initialized: false,

    init(Gref, opts = {}) {
      this.G = Gref || window.G || (window.G = {});
      this.TILE = (typeof window.TILE_SIZE !== 'undefined') ? window.TILE_SIZE : 32;
      Object.assign(this.cfg, opts || {});
      if (this.cfg.debugShortTimers) {
        this.cfg.ringMin = 8; this.cfg.ringMax = 14; this.cfg.ringDuration = 10;
      }
      if (!Array.isArray(this.G.entities)) this.G.entities = [];
      if (!Array.isArray(this.G.patients)) this.G.patients = [];
      if (!Array.isArray(this.G.decor)) this.G.decor = [];
      if (!Array.isArray(this.G.bells)) this.G.bells = [];
      if (!this.G.ENT) this.G.ENT = window.ENT || {};
      if (this.G.ENT && typeof this.G.ENT.BELL === 'undefined') {
        this.G.ENT.BELL = (typeof window.ENT?.BELL !== 'undefined') ? window.ENT.BELL : 'BELL';
      }
      this._initialized = true;
      return this;
    },

    _ensureInit() {
      if (!this._initialized || !this.G) {
        this.init(this.G || window.G || (window.G = {}));
      }
      return this.G;
    },

    _ensureGameCollections() {
      const G = this._ensureInit();
      if (!Array.isArray(G.entities)) G.entities = [];
      if (!Array.isArray(G.decor)) G.decor = [];
      if (!Array.isArray(G.patients)) G.patients = [];
      if (!Array.isArray(G.bells)) G.bells = [];
      return G;
    },

    _createBellEntity(x, y, opts = {}) {
      const G = this._ensureGameCollections();
      const tile = this.TILE || (typeof window.TILE_SIZE !== 'undefined' ? window.TILE_SIZE : 32);
      const width = Number.isFinite(opts.w) ? opts.w : tile * 0.75;
      const height = Number.isFinite(opts.h) ? opts.h : tile * 0.75;
      const bell = {
        id: opts.id || `BELL_${Math.random().toString(36).slice(2, 9)}`,
        kind: (G.ENT && typeof G.ENT.BELL !== 'undefined') ? G.ENT.BELL
              : ((window.ENT && typeof window.ENT.BELL !== 'undefined') ? window.ENT.BELL : 'BELL'),
        kindName: 'BELL',
        type: 'bell',
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        w: width,
        h: height,
        static: true,
        solid: false,
        spriteKey: opts.spriteKey || opts.idleSprite || 'timbre_apagado',
        _spriteIdle: opts.spriteKey || opts.idleSprite || 'timbre_apagado',
        _spriteRinging: opts.ringingSprite || 'timbre_encendido',
        label: opts.label || 'Timbre',
        pairName: opts.pairName || opts.keyName || opts.targetName || opts.link || null,
        anchorPatient: opts.patient || null,
        isBell: true,
        ringing: false
      };
      if (G.ENT && typeof G.ENT.BELL === 'undefined') {
        G.ENT.BELL = bell.kind;
      }
      if (window.ENT && typeof window.ENT.BELL === 'undefined') {
        window.ENT.BELL = bell.kind;
      }
      if (!G.entities.includes(bell)) G.entities.push(bell);
      if (!G.decor.includes(bell)) G.decor.push(bell);
      if (!G.bells.includes(bell)) G.bells.push(bell);
      updateBellSpriteVisual(bell, false);
      return bell;
    },

    _resolvePatientTarget(opts = {}) {
      if (opts.patient && typeof opts.patient === 'object') return opts.patient;
      const key = opts.link || opts.pairName || opts.keyName || opts.targetName || opts.patientId;
      if (!key) return null;
      const keyLower = String(key).toLowerCase();
      const matches = (candidate) => {
        if (!candidate) return false;
        const values = [candidate.id, candidate.name, candidate.displayName, candidate.label, candidate.keyName];
        return values.some((val) => typeof val === 'string' && val.toLowerCase() === keyLower);
      };
      const G = this.G || window.G || {};
      if (Array.isArray(G.patients)) {
        const found = G.patients.find(matches);
        if (found) return found;
      }
      if (Array.isArray(G.entities)) {
        const found = G.entities.find((e) => e && e.kind === (G.ENT?.PATIENT ?? window.ENT?.PATIENT) && matches(e));
        if (found) return found;
      }
      try {
        const api = window.PatientsAPI || window.Entities?.Patient;
        if (api && typeof api.findByKeyName === 'function') {
          const res = api.findByKeyName(key);
          if (res) return res;
        }
      } catch (_) {}
      return null;
    },

    _applyRingingState(entry, ringing) {
      if (!entry) return;
      updateBellSpriteVisual(entry.e, ringing);
      const patient = entry.patient;
      if (patient && typeof patient === 'object') {
        patient.ringing = !!ringing;
        if (ringing) {
          const seconds = Number.isFinite(entry.tLeft) ? entry.tLeft : this.cfg.ringDuration;
          patient.ringDeadline = Date.now() + seconds * 1000;
        } else {
          if (patient.ringDeadline) patient.ringDeadline = 0;
        }
      }
    },

    spawnBell(x, y, opts = {}) {
      const bell = this._createBellEntity(x, y, opts);
      if (!bell) return null;
      const entry = this.registerBellEntity(bell);
      const target = this._resolvePatientTarget(opts);
      if (entry && target) {
        entry.patient = target;
        if (typeof target === 'object') {
          target.bellId = target.bellId || bell.id;
        }
      }
      if (entry) {
        if (typeof opts.nextAt === 'number') entry.nextAt = opts.nextAt;
        if (opts.startRinging) {
          entry.state = 'ringing';
          entry.tLeft = Number.isFinite(opts.initialDuration) ? opts.initialDuration : this.cfg.ringDuration;
          this._applyRingingState(entry, true);
        } else {
          this._applyRingingState(entry, false);
        }
      }
      return bell;
    },

    // Llamar desde parseMap al ver 'T' (timbre): registra la entidad
    registerBellEntity(bellEnt) {
      // bellEnt: entidad con kind ENT.BELL, x,y,w,h
      const entry = {
        e: bellEnt, patient: null,
        nextAt: this._nextTime(this.cfg.ringMin, this.cfg.ringMax),
        state: 'idle', tLeft: 0
      };
      this._applyRingingState(entry, false);
      this.bells.push(entry);
      return entry;
    },

    // Vincula cada timbre al paciente más cercano (si el mapa no lo dejó pre-asignado)
    linkBellsToPatients() {
      this._ensureInit();
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
          if (typeof best === 'object') {
            best.bellId = best.bellId || b.e?.id || null;
          }
        }
      }
    },

    // Llamar cada frame
    update(dt) {
      this._ensureInit();
      this.now += dt;
      const G = this.G;

      for (let i = this.bells.length - 1; i >= 0; i--) {
        const b = this.bells[i];
        const bell = b.e;
        if (!bell || bell.dead) { this.bells.splice(i, 1); continue; }

        // Si el paciente ya no existe o ya está satisfecho -> desactiva ese timbre
        if (!b.patient || b.patient.dead || b.patient.satisfied) {
          if (b.patient && typeof b.patient === 'object' && b.patient.bellId === bell.id) {
            b.patient.bellId = null;
          }
          b.state = 'idle';
          b.nextAt = this._nextTime(this.cfg.ringMin, this.cfg.ringMax);
          this._applyRingingState(b, false);
          continue;
        }

        // 1) Programación de la próxima llamada
        if (b.state === 'idle' && this.now >= b.nextAt) {
          b.state = 'ringing';
          b.tLeft = this.cfg.ringDuration;
          // Sonido:
          if (window.AudioAPI) AudioAPI.play(this.cfg.sfxRing, { at: { x: bell.x, y: bell.y }, volume: 0.9 });
          // Visual opcional: marca
          this._applyRingingState(b, true);
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
            this._applyRingingState(b, false);
            b.patient = null;
            b.state = 'idle';
            b.nextAt = this._nextTime(this.cfg.ringMin, this.cfg.ringMax);
            if (typeof bell === 'object') {
              bell.ringing = false;
            }
          }
        }
      }
    },

    // Intenta apagar un timbre cercano cuando el jugador pulsa E
    tryInteract() {
      this._ensureInit();
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
          this._applyRingingState(b, false);
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
      this._ensureInit();
      for (const b of this.bells) {
        if (!b.e || b.e.dead) continue;
        b.state = 'idle';
        b.tLeft = 0;
        b.nextAt = this._nextTime(this.cfg.ringMin, this.cfg.ringMax);
        this._applyRingingState(b, false);
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
  window.spawnBell = function (x, y, opts) {
    return BellsAPI.spawnBell(x, y, opts || {});
  };
})();
