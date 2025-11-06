// ./assets/plugins/entities/phone.plugin.js
// Teléfono de control: permite silenciar todos los timbres activos de pacientes.

(function (W) {
  const PhoneAPI = {
    G: null,
    TILE: 32,
    phones: [],
    cfg: {
      interactRadius: 56,
      cooldownMs: 1200
    },
    _boundInteract: null,

    init(Gref, opts = {}) {
      this.G = Gref || W.G || (W.G = {});
      this.TILE = (typeof W.TILE_SIZE !== 'undefined') ? W.TILE_SIZE : 32;
      Object.assign(this.cfg, opts || {});
      if (!Array.isArray(this.phones)) this.phones = [];
      if (!Array.isArray(this.G.entities)) this.G.entities = [];
      if (!Array.isArray(this.G.decor)) this.G.decor = [];
      if (!Array.isArray(this.G.onInteract)) this.G.onInteract = [];
      if (!this._boundInteract) this._boundInteract = () => this.tryInteract();
      if (!this.G.onInteract.includes(this._boundInteract)) {
        this.G.onInteract.push(this._boundInteract);
      }
      if (!this.G.ENT) this.G.ENT = W.ENT || {};
      if (this.G.ENT && typeof this.G.ENT.PHONE === 'undefined') {
        this.G.ENT.PHONE = (W.ENT && typeof W.ENT.PHONE !== 'undefined') ? W.ENT.PHONE : 'PHONE';
      }
      return this;
    },

    _ensureInit() {
      if (!this.G) {
        this.init(W.G || (W.G = {}));
      }
      return this.G;
    },

    _attachPuppet(phone) {
      try {
        const puppet = W.Puppet?.bind?.(phone, 'phone', { z: 0, scale: 1 })
          || W.PuppetAPI?.attach?.(phone, { rig: 'phone', z: 0, scale: 1 });
        phone.rigOk = phone.rigOk === true || !!puppet;
      } catch (_) {
        phone.rigOk = phone.rigOk === true;
      }
    },

    spawnPhone(x, y, opts = {}) {
      const G = this._ensureInit();
      const tile = this.TILE;
      const phone = {
        id: opts.id || `PHONE_${Math.random().toString(36).slice(2, 9)}`,
        kind: (G.ENT && typeof G.ENT.PHONE !== 'undefined') ? G.ENT.PHONE : 'PHONE',
        kindName: 'PHONE',
        type: 'phone',
        static: true,
        solid: false,
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        w: Number.isFinite(opts.w) ? opts.w : tile * 0.65,
        h: Number.isFinite(opts.h) ? opts.h : tile,
        interactRadius: Number.isFinite(opts.interactRadius) ? opts.interactRadius : this.cfg.interactRadius,
        cooldownMs: Number.isFinite(opts.cooldownMs) ? opts.cooldownMs : this.cfg.cooldownMs,
        label: opts.label || 'Teléfono',
        _cooldownUntil: 0
      };
      this._attachPuppet(phone);
      if (!G.entities.includes(phone)) G.entities.push(phone);
      if (!G.decor.includes(phone)) G.decor.push(phone);
      if (!this.phones.includes(phone)) this.phones.push(phone);
      return phone;
    },

    tryInteract() {
      const G = this._ensureInit();
      const player = G.player;
      if (!player) return false;
      const now = Date.now();
      for (const phone of this.phones) {
        if (!phone || phone.dead) continue;
        const radius = Number.isFinite(phone.interactRadius) ? phone.interactRadius : this.cfg.interactRadius;
        const px = player.x + player.w * 0.5;
        const py = player.y + player.h * 0.5;
        const tx = phone.x + phone.w * 0.5;
        const ty = phone.y + phone.h * 0.5;
        const dist = Math.hypot(px - tx, py - ty);
        if (dist > radius) continue;
        if (phone._cooldownUntil && now < phone._cooldownUntil) continue;
        if (this._usePhone(phone)) {
          phone._cooldownUntil = now + Math.max(0, Number.isFinite(phone.cooldownMs) ? phone.cooldownMs : this.cfg.cooldownMs);
          return true;
        }
      }
      return false;
    },

    _usePhone(phone) {
      let silenced = false;
      try {
        if (W.BellsAPI && typeof W.BellsAPI.silenceAllBells === 'function') {
          silenced = !!W.BellsAPI.silenceAllBells();
        } else if (W.BellsAPI && typeof W.BellsAPI.muteAll === 'function') {
          silenced = !!W.BellsAPI.muteAll();
        }
      } catch (err) {
        console.warn('[PhoneAPI] silenceAllBells', err);
      }
      if (silenced) {
        try { W.HUD?.showFloatingMessage?.(phone, 'Timbres apagados', 1.6); } catch (_) {}
      }
      return silenced;
    }
  };

  W.PhoneAPI = PhoneAPI;
  W.spawnPhone = function (x, y, opts) {
    return PhoneAPI.spawnPhone(x, y, opts || {});
  };
})(this);
