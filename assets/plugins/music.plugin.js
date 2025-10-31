/* ============================================================================
 *  Il Divo - MusicAPI
 *  Motor de música con Web Audio (crossfades, loops, stingers, ducking).
 *  Carga: incluir este archivo antes o después de game.js; sólo asegúrate
 *  de llamar a MusicAPI.init(...) antes de usar playLevel/setUrgency/etc.
 * ========================================================================== */

(function (global) {
  const hasWA = !!(window.AudioContext || window.webkitAudioContext);

  const MusicAPI = {
    ctx: null,
    master: null,      // master gain
    musicBus: null,    // música (BGM)
    sfxBus: null,      // stingers / one-shots
    duckGain: null,    // ducking para diálogos (multiplica a musicBus)
    // doble canal para crossfade
    chA: null, chB: null, srcA: null, srcB: null, keyA: null, keyB: null,
    active: 'A',
    buffers: {},       // { key: AudioBuffer }
    htmlFallback: {},  // { key: HTMLAudioElement } si no hay WebAudio
    urls: { intro: 'assets/audio/intro.ogg' },          // + 'intro' para la música de la intro
// { level1, level2, level3, urgency, victory, gameover } (se pueden sobreescribir en init)
    currentLevelKey: null,
    isUrgency: false,
    musicVol: 0.9,
    sfxVol: 1.0,
    muted: false,
    fadeDefault: 2.0,
    resumeBound: false,
    visibilityBound: false,

    /* ------------------------------- INIT ---------------------------------- */
    init(opts = {}) {
      this.urls = Object.assign({ intro: 'assets/audio/intro.ogg' }, opts.urls || {});
      this.musicVol = clamp(+loadLS('musicVol', 0.9), 0, 1);
      this.sfxVol   = clamp(+loadLS('sfxVol',   1.0), 0, 1);
      this.muted    = loadLS('musicMuted', '0') === '1';

      if (hasWA) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master   = this.ctx.createGain();
        this.musicBus = this.ctx.createGain();
        this.sfxBus   = this.ctx.createGain();
        this.duckGain = this.ctx.createGain();

        // Cadena: musicBus -> duckGain -> master -> destination
        this.musicBus.connect(this.duckGain);
        this.duckGain.connect(this.master);
        this.sfxBus.connect(this.master);
        this.master.connect(this.ctx.destination);

        this._applyVolumes();

        // Doble canal para crossfades
        this.chA = this.ctx.createGain();
        this.chB = this.ctx.createGain();
        this.chA.gain.value = 0;
        this.chB.gain.value = 0;
        this.chA.connect(this.musicBus);
        this.chB.connect(this.musicBus);

        // mobile autoplay
        this._bindResumeOnUserGesture();
        this._bindVisibility();
      } else {
        console.warn('[MusicAPI] WebAudio no disponible: uso HTMLAudio fallback.');
      }

      // precarga opcional (no bloquea)
      if (opts.preload !== false) this.preloadAll().catch(()=>{});
    },

    _bindResumeOnUserGesture() {
      if (this.resumeBound) return;
      const resume = () => { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); };
      window.addEventListener('pointerdown', resume, { once: true, passive: true });
      window.addEventListener('keydown', resume, { once: true, passive: true });
      this.resumeBound = true;
    },

    _bindVisibility() {
      if (this.visibilityBound) return;
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.visibilityState === 'hidden') {
          this.master.gain.cancelScheduledValues(this.ctx.currentTime);
          this.master.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.2);
        } else {
          this._applyVolumes(true);
        }
      });
      this.visibilityBound = true;
    },

    _applyVolumes(fast=false) {
      if (!this.master) return;
      const t = this.ctx.currentTime + (fast ? 0.05 : 0.2);
      const mv = this.muted ? 0 : this.musicVol;
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(1, t);
      this.musicBus.gain.setValueAtTime(mv, t);
      this.sfxBus.gain.setValueAtTime(this.sfxVol, t);
      this.duckGain.gain.setValueAtTime(1, t);
    },

    /* ---------------------------- LOADING ---------------------------------- */
    async preloadAll() {
      const keys = Object.keys(this.urls);
      await Promise.all(keys.map(k => this._ensureLoaded(k)));
    },

    async _ensureLoaded(key) {
      if (this.buffers[key] || this.htmlFallback[key]) return;
      const url = this.urls[key];
      if (!url) return;

      if (hasWA) {
        const buf = await fetch(url).then(r => r.arrayBuffer()).then(b => this.ctx.decodeAudioData(b));
        this.buffers[key] = buf;
      } else {
        const a = new Audio(url);
        a.loop = false;
        a.load();
        this.htmlFallback[key] = a;
      }
    },

    /* --------------------------- CORE CONTROL ------------------------------ */
    setVolumeMusic(v) {
      this.musicVol = clamp(+v, 0, 1);
      saveLS('musicVol', this.musicVol);
      this._applyVolumes();
    },
    setVolumeSfx(v) {
      this.sfxVol = clamp(+v, 0, 1);
      saveLS('sfxVol', this.sfxVol);
      this._applyVolumes();
    },
    setMuted(m) {
      this.muted = !!m;
      saveLS('musicMuted', this.muted ? '1' : '0');
      this._applyVolumes();
    },
    toggleMute() { this.setMuted(!this.muted); },

    duck(amount = 0.35) {
      if (!hasWA) return;
      const t = this.ctx.currentTime;
      this.duckGain.gain.cancelScheduledValues(t);
      this.duckGain.gain.linearRampToValueAtTime(clamp(1-amount, 0, 1), t + 0.08);
    },
    unduck() {
      if (!hasWA) return;
      const t = this.ctx.currentTime;
      this.duckGain.gain.cancelScheduledValues(t);
      this.duckGain.gain.linearRampToValueAtTime(1, t + 0.15);
    },

    /* ---------------------------- PLAY FLOWS ------------------------------- */
    async playLevel(level = 1, fade = this.fadeDefault) {
      const key = level <= 1 ? 'level1' : level === 2 ? 'level2' : 'level3';
      this.currentLevelKey = key;
      this.isUrgency = false;
      await this._crossfadeTo(key, { loop: true, fade });
    },

    async setUrgency(on, fade = 0.6) {
      if (on === this.isUrgency) return;
      this.isUrgency = !!on;
      const key = this.isUrgency ? 'urgency' : (this.currentLevelKey || 'level1');
      await this._crossfadeTo(key, { loop: true, fade });
    },

    async levelComplete() {
      // sube fanfarria, baja música
      this._tempLowerBGM(0.25, 0.2);
      await this._playSFX('victory', { gain: 1 });
    },

    async gameOver() {
      this._tempLowerBGM(0.15, 0.2);
      await this._playSFX('gameover', { gain: 1 });
    },

    stopAll(fade = 0.4) {
      if (hasWA) {
        const now = this.ctx.currentTime;
        if (this.chA) this.chA.gain.linearRampToValueAtTime(0, now + fade);
        if (this.chB) this.chB.gain.linearRampToValueAtTime(0, now + fade);
        setTimeout(() => { this._stopSrc('A'); this._stopSrc('B'); }, (fade+0.05)*1000);
      } else {
        Object.values(this.htmlFallback).forEach(a => { a.pause(); a.currentTime = 0; });
      }
    },

    /* ---------------------------- INTERNALS -------------------------------- */
    async _crossfadeTo(key, { loop = true, fade = 1.5 } = {}) {
      await this._ensureLoaded(key);
      if (hasWA) {
        const toCh  = (this.active === 'A') ? 'B' : 'A';
        const fromCh= this.active;
        const toGain= (toCh === 'A') ? this.chA : this.chB;
        const fmGain= (fromCh === 'A') ? this.chA : this.chB;

        const toSrc = this._makeSrc(key, loop);
        if (toCh === 'A') { this.srcA = toSrc; this.keyA = key; } else { this.srcB = toSrc; this.keyB = key; }

        const t0 = this.ctx.currentTime;
        toGain.gain.setValueAtTime(0, t0);
        toSrc.start();

        // crossfade
        toGain.gain.linearRampToValueAtTime(this.musicVol, t0 + fade);
        fmGain.gain.cancelScheduledValues(t0);
        fmGain.gain.linearRampToValueAtTime(0, t0 + fade);

        // parar el canal saliente al finalizar
        setTimeout(() => { this._stopSrc(fromCh); }, (fade + 0.05) * 1000);
        this.active = toCh;
      } else {
        // Fallback simple sin crossfade fino
        Object.entries(this.htmlFallback).forEach(([k,a]) => { a.pause(); a.currentTime = 0; });
        const a = this.htmlFallback[key];
        if (a) { a.loop = loop; a.volume = this.muted ? 0 : this.musicVol; a.play().catch(()=>{}); }
      }
    },

    _makeSrc(key, loop) {
      const buf = this.buffers[key];
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = !!loop;
      const g = (this.active === 'A') ? this.chB : this.chA; // el que vamos a usar como destino
      src.connect(g);
      return src;
    },

    _stopSrc(ch) {
      try {
        if (ch === 'A' && this.srcA) { this.srcA.stop(); this.srcA.disconnect(); this.srcA = null; this.keyA = null; }
        if (ch === 'B' && this.srcB) { this.srcB.stop(); this.srcB.disconnect(); this.srcB = null; this.keyB = null; }
      } catch(_) {}
    },

    async _playSFX(key, { gain = 1 } = {}) {
      await this._ensureLoaded(key);
      if (hasWA) {
        const src = this.ctx.createBufferSource();
        const g = this.ctx.createGain();
        src.buffer = this.buffers[key];
        g.gain.value = gain * (this.muted ? 0 : this.sfxVol);
        src.connect(g); g.connect(this.sfxBus);
        return new Promise(res => {
          src.onended = res;
          src.start();
        });
      } else {
        const a = this.htmlFallback[key];
        if (a) { a.loop = false; a.volume = this.sfxVol; return a.play().catch(()=>{}); }
      }
    },

    _tempLowerBGM(to = 0.3, fad = 0.2) {
      if (!hasWA) return;
      const t = this.ctx.currentTime;
      this.musicBus.gain.cancelScheduledValues(t);
      this.musicBus.gain.linearRampToValueAtTime(clamp(to,0,1), t + fad);
      // volver arriba después de 3s
      setTimeout(() => this._applyVolumes(true), 3000);
    },
    // ------------------------------- INTRO BGM ---------------------------------
    playIntro(opts = {}) { this._crossfadeTo('intro', { loop:false, fade:(opts.fade ?? 1.2) }); }
  };

  /* ------------------------------- HELPERS --------------------------------- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function saveLS(k,v){ try{ localStorage.setItem(k,String(v)); }catch(_){} }
  function loadLS(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:v; }catch(_){ return d; } }

  global.MusicAPI = MusicAPI;
})(window);