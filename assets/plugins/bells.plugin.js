// filename: bells.plugin.js
// Timbres por paciente: se activan de vez en cuando (≥5 min).
// Si expira el tiempo sin apagarse => el paciente se transforma en "Furiosa".
// Permite: apagar timbre con E (cerca) y mute global (teléfono).

(function () {
  const PNG_EXT = /\.(png|jpg|jpeg|gif)$/i;

  function coerceSpriteName(value, fallback){
    const raw = (value == null) ? '' : String(value).trim();
    if (!raw) return fallback;
    return PNG_EXT.test(raw) ? raw : `${raw}.png`;
  }

  function applyBellSprite(bell, spriteKey) {
    if (!bell || !spriteKey) return;
    bell.spriteKey = spriteKey;
    bell.skin = spriteKey;
    try {
      if (bell.puppet && typeof bell.puppet.setSkin === 'function') {
        bell.puppet.setSkin(spriteKey);
      } else if (window.PuppetAPI?.attach && bell.puppet) {
        bell.puppet.skin = spriteKey;
      }
    } catch (_) {}
  }

  function updateBellSpriteVisual(bell, ringing) {
    if (!bell) return;
    const idle = coerceSpriteName(bell._spriteIdle || bell.spriteKey || 'timbre_apagado.png', 'timbre_apagado.png');
    const active = coerceSpriteName(bell._spriteRinging || bell.spriteKey || 'timbre_encendido.png', 'timbre_encendido.png');
    const sprite = ringing ? active : idle;
    bell.ringing = !!ringing;
    bell.active = !!ringing;
    applyBellSprite(bell, sprite);
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function getEntityRect(ent, tileSize) {
    if (!ent) return null;
    const ms = typeof window !== 'undefined' ? window.MovementSystem : null;
    const st = ms && typeof ms.getState === 'function' ? ms.getState(ent) : null;
    const x = st ? st.x : (ent.x || 0);
    const y = st ? st.y : (ent.y || 0);
    const w = Number.isFinite(ent.w) ? ent.w : tileSize;
    const h = Number.isFinite(ent.h) ? ent.h : tileSize;
    return { x, y, w, h };
  }

  function tileFromEntity(ent, tileSize) {
    if (!ent) return null;
    const rect = getEntityRect(ent, tileSize);
    if (!rect) return null;
    const cx = rect.x + rect.w * 0.5;
    const cy = rect.y + rect.h * 0.5;
    return {
      tx: Math.floor(cx / tileSize),
      ty: Math.floor(cy / tileSize)
    };
  }

  const ADJACENT_OFFSETS = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: -1 }
  ];

  const BellsAPI = {
    G: null, TILE: 32,
    cfg: {
      // Tiempo entre activaciones por timbre (segundos)
      ringMin: 300,   // 5 minutos
      ringMax: 540,   // 9 minutos
      // Tiempo que dura sonando antes de “furiosa” (segundos)
      ringDuration: 45,
      // Umbral para aviso visual de urgencia (segundos restantes)
      warningThreshold: null, // si null -> usa warningRatio * ringDuration (mínimo 3 s)
      warningRatio: 0.25,
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
    _boundInteract: null,

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
      if (!Array.isArray(this.G.onInteract)) this.G.onInteract = [];
      if (!this._boundInteract) {
        this._boundInteract = () => this.tryInteract();
      }
      if (!this.G.onInteract.includes(this._boundInteract)) {
        this.G.onInteract.push(this._boundInteract);
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

    _linkBellAndPatient(entry, patient) {
      if (!entry || !patient) return;
      entry.patient = patient;
      if (typeof patient === 'object') {
        patient.bellId = entry.e?.id || patient.bellId;
        patient.anchorBell = entry.e || patient.anchorBell;
      }
      if (entry.e) {
        entry.e.patientId = patient.id || entry.e.patientId;
        entry.e.forPatientId = patient.id || entry.e.forPatientId;
      }
    },

    _isPatientActive(patient) {
      if (!patient) return false;
      if (patient.dead || patient.attended || patient.satisfied || patient.hidden) return false;
      return true;
    },

    _resolvePatientTile(patient) {
      if (!patient) return null;
      const tile = this.TILE || 32;
      return tileFromEntity(patient, tile);
    },

    _isTileFreeForBell(patient, tx, ty) {
      const G = this.G || window.G || {};
      const map = G.map || [];
      const tile = this.TILE || 32;
      if (!Number.isInteger(tx) || !Number.isInteger(ty)) return false;
      if (!map[ty] || map[ty][tx] !== 0) return false;
      const rect = { x: tx * tile, y: ty * tile, w: tile, h: tile };
      for (const ent of G.entities || []) {
        if (!ent || ent === patient || ent.dead || !ent.solid) continue;
        const otherRect = getEntityRect(ent, tile);
        if (!otherRect) continue;
        if (rectsOverlap(rect.x, rect.y, rect.w, rect.h, otherRect.x, otherRect.y, otherRect.w, otherRect.h)) {
          return false;
        }
      }
      return true;
    },

    findFreeAdjacentTile(entity) {
      this._ensureInit();
      const base = this._resolvePatientTile(entity);
      if (!base) return null;
      for (const offset of ADJACENT_OFFSETS) {
        const tx = base.tx + offset.dx;
        const ty = base.ty + offset.dy;
        if (this._isTileFreeForBell(entity, tx, ty)) {
          return { tx, ty };
        }
      }
      return null;
    },

    _beginRinging(entry, opts = {}) {
      if (!entry || entry.state === 'ringing') return false;
      if (!this._isPatientActive(entry.patient)) return false;
      entry.state = 'ringing';
      entry.tLeft = Number.isFinite(opts.duration) ? opts.duration : this.cfg.ringDuration;
      entry.ringDuration = entry.tLeft;
      entry.ringStartedAt = Date.now();
      entry.ringDeadline = entry.ringStartedAt + (entry.tLeft || this.cfg.ringDuration) * 1000;
      if (entry.e) {
        entry.e._warning = false;
      }
      if (entry.patient && typeof entry.patient === 'object') {
        entry.patient.ringingUrgent = false;
      }
      if (opts.playSound !== false && window.AudioAPI) {
        try { AudioAPI.play(this.cfg.sfxRing, { at: { x: entry.e?.x, y: entry.e?.y }, volume: 0.9 }); }
        catch (_) {}
      }
      this._applyRingingState(entry, true);
      this._logBellOn(entry);
      return true;
    },

    spawnPatientBell(patient, tileX = null, tileY = null, opts = {}) {
      this._ensureInit();
      if (!patient) return null;
      if (patient.bellId && !opts.force) {
        const existing = this.bells.find((entry) => entry?.e?.id === patient.bellId);
        if (existing && existing.e) {
          this._linkBellAndPatient(existing, patient);
          return existing.e;
        }
      }
      let targetTile = null;
      if (Number.isInteger(tileX) && Number.isInteger(tileY)) {
        targetTile = this._isTileFreeForBell(patient, tileX, tileY)
          ? { tx: tileX, ty: tileY }
          : null;
      }
      if (!targetTile) {
        targetTile = this.findFreeAdjacentTile(patient);
      }
      if (!targetTile) {
        const id = patient.id || patient.keyName || 'unknown';
        console.warn('[BELL] No free tile for patient', id);
        return null;
      }
      const tile = this.TILE || 32;
      const px = targetTile.tx * tile + tile * 0.1;
      const py = targetTile.ty * tile + tile * 0.1;
      const bell = this.spawnBell(px, py, {
        ...opts,
        patient,
        patientId: patient.id,
        link: opts.link || patient.id,
        pairName: opts.pairName || patient.id,
        forPatientId: patient.id,
      });
      if (!bell) return null;
      const entry = this.bells.find((b) => b && b.e === bell);
      if (entry) {
        this._linkBellAndPatient(entry, patient);
      }
      return bell;
    },

    forceActivateFirstBell(opts = {}) {
      this._ensureInit();
      for (const entry of this.bells) {
        if (!entry || entry.state === 'ringing') continue;
        if (!this._isPatientActive(entry.patient)) continue;
        if (this._beginRinging(entry, { playSound: opts.playSound !== false })) {
          entry.nextAt = this.now + this.cfg.ringMax;
          return entry.e || null;
        }
      }
      return null;
    },

    _getWarningThreshold() {
      const cfg = this.cfg || {};
      const ringDur = Number.isFinite(cfg.ringDuration) ? Math.max(0, cfg.ringDuration) : 0;
      if (Number.isFinite(cfg.warningThreshold) && cfg.warningThreshold > 0) {
        return Math.min(ringDur, cfg.warningThreshold);
      }
      const ratio = Number.isFinite(cfg.warningRatio) ? cfg.warningRatio : 0.25;
      const raw = ringDur * Math.max(0, ratio);
      const candidate = Math.max(0, Math.min(ringDur, raw || 0));
      const minFloor = Math.min(ringDur, 3);
      return Math.max(minFloor, candidate);
    },

    _createBellEntity(x, y, opts = {}) {
      const G = this._ensureGameCollections();
      const tile = this.TILE || (typeof window.TILE_SIZE !== 'undefined' ? window.TILE_SIZE : 32);
      const width = Number.isFinite(opts.w) ? opts.w : tile * 0.75;
      const height = Number.isFinite(opts.h) ? opts.h : tile * 0.75;
      const idleSprite = coerceSpriteName(opts.spriteKey || opts.idleSprite, 'timbre_apagado.png');
      const ringingSprite = coerceSpriteName(opts.ringingSprite, 'timbre_encendido.png');
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
        spriteKey: idleSprite,
        _spriteIdle: idleSprite,
        _spriteRinging: ringingSprite,
        label: opts.label || 'Timbre',
        pairName: opts.pairName || opts.keyName || opts.targetName || opts.link || null,
        anchorPatient: opts.patient || null,
        isBell: true,
        ringing: false,
        _warning: false
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
      applyBellSprite(bell, idleSprite);
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
      if (!ringing && entry.e) {
        entry.e._warning = false;
      }
      updateBellSpriteVisual(entry.e, ringing);
      if (ringing) {
        const baseDuration = Number.isFinite(entry.tLeft) ? entry.tLeft : (this.cfg.ringDuration || 0);
        if (!Number.isFinite(entry.ringDuration) || entry.ringDuration <= 0) {
          entry.ringDuration = baseDuration;
        }
        if (!Number.isFinite(entry.ringStartedAt)) {
          entry.ringStartedAt = Date.now();
        }
        if (!Number.isFinite(entry.ringDeadline)) {
          entry.ringDeadline = entry.ringStartedAt + baseDuration * 1000;
        }
      } else {
        entry.ringStartedAt = null;
        entry.ringDeadline = null;
        entry.ringDuration = null;
      }
      const patient = entry.patient;
      if (patient && typeof patient === 'object') {
        patient.ringing = !!ringing;
        if (ringing) {
          const seconds = Number.isFinite(entry.tLeft) ? entry.tLeft : this.cfg.ringDuration;
          patient.ringDeadline = Date.now() + seconds * 1000;
          patient.ringingUrgent = !!(entry.e && entry.e._warning);
          if (!entry._narratorAnnounced) {
            entry._narratorAnnounced = true;
            const name = patient.displayName || patient.name || patient.keyName;
            try { window.Narrator?.say?.('bell_ring', { patientName: name }, { priority: 'high' }); } catch (_) {}
          }
        } else {
          if (patient.ringDeadline) patient.ringDeadline = 0;
          patient.ringingUrgent = false;
        }
      }
      if (entry.e) {
        entry.e.on = !!ringing;
      }
      if (!ringing) {
        entry._narratorAnnounced = false;
      }
    },

    _resolvePatientId(entry) {
      const patient = entry?.patient;
      if (!patient) return entry?.e?.forPatientId || entry?.e?.pairName || null;
      if (typeof patient === 'object') {
        return patient.id || patient.forPatientId || patient.pairName || patient.keyName || null;
      }
      return patient;
    },

    _logBellOn(entry) {
      if (!entry || entry._ringingLogged) return;
      const bell = entry.e;
      if (!bell) return;
      const payload = {
        bell: bell.id || null,
        patient: this._resolvePatientId(entry),
        duration: Number.isFinite(entry.tLeft) ? Number(entry.tLeft.toFixed(2)) : this.cfg.ringDuration,
      };
      try { window.LOG?.event?.('BELL_ON', payload); } catch (_) {}
      entry._ringingLogged = true;
    },

    _logBellOff(entry, reason) {
      if (!entry || !entry._ringingLogged) return;
      const bell = entry.e;
      if (!bell) return;
      const payload = {
        bell: bell.id || null,
        patient: this._resolvePatientId(entry),
        reason: reason || 'unknown',
      };
      try { window.LOG?.event?.('BELL_OFF', payload); } catch (_) {}
      entry._ringingLogged = false;
    },

    _transformPatientToFurious(patient) {
      if (!patient) return null;
      if (window.FuriousAPI && typeof window.FuriousAPI.transformToFurious === 'function') {
        try { return window.FuriousAPI.transformToFurious(patient); }
        catch (err) { console.warn('[Bells] FuriousAPI.transformToFurious', err); }
      }
      if (window.PatientsAPI && typeof window.PatientsAPI.toFurious === 'function') {
        try { return window.PatientsAPI.toFurious(patient); }
        catch (err) { console.warn('[Bells] PatientsAPI.toFurious', err); }
      }
      if (window.FuriousAPI && typeof window.FuriousAPI.spawnFromPatient === 'function') {
        try { return window.FuriousAPI.spawnFromPatient(patient); }
        catch (err) { console.warn('[Bells] FuriousAPI.spawnFromPatient', err); }
      }
      return this._transformPatientFallback(patient);
    },

    spawnBell(x, y, opts = {}) {
      const bell = this._createBellEntity(x, y, opts);
      if (!bell) return null;
      const entry = this.registerBellEntity(bell);
      const target = this._resolvePatientTarget(opts);
      if (entry && target) {
        this._linkBellAndPatient(entry, target);
      }
      if (opts.patientId && !bell.patientId) {
        bell.patientId = opts.patientId;
      }
      if (entry) {
        if (typeof opts.nextAt === 'number') entry.nextAt = opts.nextAt;
        if (opts.startRinging) {
          this._beginRinging(entry, { duration: Number.isFinite(opts.initialDuration) ? opts.initialDuration : undefined });
        } else {
          this._applyRingingState(entry, false);
        }
      }
      return bell;
    },

    spawnBellNear(patient, opts = {}) {
      return this.spawnPatientBell(patient, opts.tileX ?? null, opts.tileY ?? null, opts);
    },

    // Llamar desde parseMap al ver 'T' (timbre): registra la entidad
    registerBellEntity(bellEnt) {
      // bellEnt: entidad con kind ENT.BELL, x,y,w,h
      const entry = {
        e: bellEnt,
        patient: null,
        nextAt: this._nextTime(this.cfg.ringMin, this.cfg.ringMax),
        state: 'idle',
        tLeft: 0,
        _ringingLogged: false,
        _narratorAnnounced: false,
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
          this._linkBellAndPatient(b, best);
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
        bell.active = b.state === 'ringing';

        // Si el paciente ya no existe o ya está satisfecho -> desactiva ese timbre
        if (!b.patient || b.patient.dead || b.patient.satisfied) {
          if (b.state === 'ringing') {
            this._logBellOff(b, 'satisfied');
          }
          if (b.patient && typeof b.patient === 'object' && b.patient.bellId === bell.id) {
            b.patient.bellId = null;
            b.patient.ringingUrgent = false;
          }
          b.state = 'idle';
          b.nextAt = this._nextTime(this.cfg.ringMin, this.cfg.ringMax);
          this._applyRingingState(b, false);
          if (bell) bell._warning = false;
          continue;
        }

        // 1) Programación de la próxima llamada
        if (b.state === 'idle' && this.now >= b.nextAt) {
          this._beginRinging(b);
        }

        // 2) Si está sonando, cuenta atrás; si llega a 0 -> convertir paciente en furiosa
        if (b.state === 'ringing') {
          b.tLeft -= dt;
          // ping visual liviano
          bell._pulse = ((bell._pulse || 0) + dt) % 1.0;

          const warningThreshold = this._getWarningThreshold();
          if (warningThreshold > 0 && Number.isFinite(b.tLeft)) {
            const urgent = b.tLeft <= warningThreshold;
            if (bell && bell._warning !== urgent) {
              bell._warning = urgent;
              updateBellSpriteVisual(bell, true);
            }
            if (b.patient && typeof b.patient === 'object' && b.patient.ringingUrgent !== urgent) {
              b.patient.ringingUrgent = urgent;
            }
          }

          // Si el jugador está cerca y pulsa E -> apaga
          // (la interacción real se hace por tryInteract(); aquí solo el estado)
          if (b.tLeft <= 0) {
            this._logBellOff(b, 'timeout');
            const patient = b.patient || null;
            if (patient) {
              this._transformPatientToFurious(patient);
              const name = patient.displayName || patient.name || patient.keyName;
              try { window.Narrator?.say?.('patient_furious', { patientName: name }, { priority: 'high' }); } catch (_) {}
              try { window.LOG?.event?.('BELL_TIMEOUT', { patient: patient.id || null }); } catch (_) {}
              try {
                if (typeof window.counterSnapshot === 'function') {
                  window.LOG?.event?.('PATIENTS_COUNTER', window.counterSnapshot());
                }
              } catch (_) {}
            }
            this._applyRingingState(b, false);
            b.patient = null;
            b.state = 'idle';
            b.nextAt = this._nextTime(this.cfg.ringMin, this.cfg.ringMax);
            if (typeof bell === 'object') {
              bell.ringing = false;
              bell._warning = false;
            }
            if (patient && typeof patient === 'object') {
              patient.ringingUrgent = false;
            }
          }
        }
      }
    },

    getActiveTimers(limit = null) {
      this._ensureInit();
      const out = [];
      const now = Date.now();
      for (const entry of this.bells) {
        if (!entry || entry.state !== 'ringing') continue;
        const seconds = Math.max(0, Number(entry.tLeft || 0));
        const total = (Number.isFinite(entry.ringDuration) && entry.ringDuration > 0)
          ? entry.ringDuration
          : this.cfg.ringDuration;
        const patient = entry.patient;
        const name = patient?.displayName || patient?.name || patient?.keyName || entry.e?.label || 'Paciente';
        const id = entry.e?.id || patient?.id || `bell_${out.length}`;
        out.push({
          id,
          patientName: name,
          secondsLeft: seconds,
          totalSeconds: total,
          urgent: !!(entry.e && entry.e._warning),
          deadline: entry.ringDeadline || (now + seconds * 1000)
        });
      }
      out.sort((a, b) => a.secondsLeft - b.secondsLeft);
      if (Number.isFinite(limit) && limit > 0) return out.slice(0, limit);
      return out;
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
          this._logBellOff(b, 'player');
          if (window.AudioAPI) AudioAPI.play(this.cfg.sfxOff, { at: { x: bell.x, y: bell.y }, volume: 0.9 });
          // bonus opcional:
          if (this.G.addScore) this.G.addScore(50);
          if (bell) bell._warning = false;
          if (b.patient && typeof b.patient === 'object') {
            b.patient.ringingUrgent = false;
            const name = b.patient.displayName || b.patient.name || b.patient.keyName;
            try { window.Narrator?.say?.('bell_off', { patientName: name }); window.Narrator?.progress?.(); } catch (_) {}
          }
          return true;
        }
      }
      return false;
    },

    // Teléfono de control: apaga TODO y reprograma
    silenceAllBells() {
      this._ensureInit();
      let silenced = false;
      for (const b of this.bells) {
        if (!b.e || b.e.dead) continue;
        if (b.state === 'ringing') {
          this._logBellOff(b, 'phone');
          silenced = true;
        }
        b.state = 'idle';
        b.tLeft = 0;
        b.nextAt = this._nextTime(this.cfg.ringMin, this.cfg.ringMax);
        this._applyRingingState(b, false);
        if (b.patient && typeof b.patient === 'object') {
          b.patient.ringingUrgent = false;
        }
        if (b.e) b.e._warning = false;
      }
      if (silenced && window.AudioAPI) AudioAPI.play('phone_ok', { volume: 0.8 });
      return silenced;
    },

    muteAll() {
      return this.silenceAllBells();
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
      if (Array.isArray(this.G.humans)) this.G.humans = this.G.humans.filter(x => x !== patient);
      if (Array.isArray(this.G.animals)) this.G.animals = this.G.animals.filter(x => x !== patient);
      if (Array.isArray(this.G.objects)) this.G.objects = this.G.objects.filter(x => x !== patient);
      if (Array.isArray(this.G.hostiles)) this.G.hostiles = this.G.hostiles.filter(x => x !== patient);
      // Crea un "enemigo simple" si no existe FuriousAPI
      const ENT = this.G.ENT || {};
      const e = {
        kind: ENT.FURIOUS || 'furious',
        x: patient.x, y: patient.y, w: patient.w, h: patient.h,
        vx: 0, vy: 0, mass: 120, dynamic: true, solid: true,
        color: '#ff5a6b', t: 0, touchCD: 0,
        hostile: true,
        group: 'human'
      };
      this.G.entities.push(e);
      this.G.hostiles = this.G.hostiles || [];
      this.G.hostiles.push(e);
      try { window.EntityGroups?.register?.(e, this.G); } catch (_) {}
      if (window.Physics && Physics.registerEntity) Physics.registerEntity(e);
    }
  };

  window.BellsAPI = BellsAPI;
  window.spawnBellNear = function (patient, opts) {
    return BellsAPI.spawnBellNear(patient, opts || {});
  };
  window.spawnBell = function (x, y, opts) {
    return BellsAPI.spawnBell(x, y, opts || {});
  };
  window.spawnPatientBell = function (patient, tx, ty, opts) {
    return BellsAPI.spawnPatientBell(patient, tx, ty, opts || {});
  };
})();
