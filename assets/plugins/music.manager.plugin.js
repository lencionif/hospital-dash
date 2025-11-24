/* ==========================================================================
 * Il Divo: Hospital Dash! — MusicManager
 * --------------------------------------------------------------------------
 * Sistema de música dinámica con cross-fade y un único canal lógico.
 * IDs de pista soportados (MUSIC_TRACKS):
 *   intro, main_menu, level1, level2, level3,
 *   miniboss1, miniboss2, miniboss3,
 *   boss1, boss2,
 *   pre_final_boss, boss_final_A, boss_final_B, fire_escape,
 *   score, credits.
 * Mapeo de estados de juego → pistas (sugerido):
 *   - Intro/viñetas iniciales: intro
 *   - Menú principal: main_menu
 *   - Niveles base: level1/level2/level3
 *   - Mini bosses: miniboss1/2/3 según nivel
 *   - Boss nivel 1/2: boss1/boss2
 *   - Final nivel 3: pre_final_boss → boss_final_A → boss_final_B → fire_escape
 *   - Pantalla de puntuación: score
 *   - Créditos finales: credits
 *
 * Uso desde otros módulos:
 *   - Llamar a MusicManager.init() tras el primer gesto de usuario.
 *   - MusicManager.fadeTo('level1', { fadeTime: 2.0 });
 *   - MusicManager.play(id) fuerza un cambio inmediato (sin crossfade).
 *   - MusicManager.stop({ fadeTime }) apaga la música.
 *   - Invoca MusicManager.update(dt) una vez por frame para animar los fades.
 *
 * Nota sobre nombres de archivos con espacios: el repositorio incluye
 *   "pantalla_de_puntuación .mp3" y "creditos_finales .mp3" (espacio antes de
 *   la extensión). El código mantiene los nombres exactos pero se recomienda
 *   renombrar a variantes sin espacio para evitar confusiones.
 * ========================================================================= */
(function (global) {
  'use strict';

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const DEBUG_MUSIC = false;
  const DEFAULT_FADE_TIME = 2.0;
  const DEFAULT_VOLUME = 0.8;

  // Rutas centralizadas de música (mantener nombres exactos del repositorio)
  const MUSIC_TRACKS = {
    intro: 'assets/music/intro.mp3',
    main_menu: 'assets/music/pagina_principal.mp3',
    level1: 'assets/music/nivel1.mp3',
    level2: 'assets/music/nivel2.mp3',
    level3: 'assets/music/nivel3.mp3',
    miniboss1: 'assets/music/Mini_boss1.mp3',
    miniboss2: 'assets/music/mini_boss2.mp3',
    miniboss3: 'assets/music/mini_boss3.mp3',
    boss1: 'assets/music/boss_nivel1.mp3',
    boss2: 'assets/music/boss_nivel2.mp3',
    pre_final_boss: 'assets/music/pre_final_boss.mp3',
    boss_final_A: 'assets/music/boss_final_parteA.mp3',
    boss_final_B: 'assets/music/boss_final_parteB.mp3',
    fire_escape: 'assets/music/huida_del_fuego.mp3',
    score: 'assets/music/pantalla_de_puntuación .mp3', // ← hay un espacio en el nombre del fichero
    credits: 'assets/music/creditos_finales .mp3',     // ← hay un espacio en el nombre del fichero
  };

  const LOOP_CONFIG = {
    intro: false,
    main_menu: true,
    level1: true,
    level2: true,
    level3: true,
    miniboss1: true,
    miniboss2: true,
    miniboss3: true,
    boss1: true,
    boss2: true,
    pre_final_boss: false,
    boss_final_A: false,
    boss_final_B: false,
    fire_escape: false,
    score: false,
    credits: false,
  };

  const MusicManager = {
    _initialized: false,
    _unlocked: false,
    _masterVolume: DEFAULT_VOLUME,
    _baseVolume: DEFAULT_VOLUME,
    _fadeTime: DEFAULT_FADE_TIME,
    _fadeTimer: 0,
    _fading: false,
    _fadeDuration: DEFAULT_FADE_TIME,
    _currentTrackId: null,
    _nextTrackId: null,
    _currentAudio: null,
    _nextAudio: null,
    _channels: [],
    _pendingPlay: null,

    init(opts = {}) {
      if (this._initialized) return this;
      this._initialized = true;
      this._baseVolume = clamp01(opts.volume != null ? opts.volume : DEFAULT_VOLUME);
      this._masterVolume = this._baseVolume;
      this._fadeTime = Math.max(0.1, opts.fadeTime || DEFAULT_FADE_TIME);
      this._channels = [this._createAudio(), this._createAudio()];
      this._currentAudio = this._channels[0];
      this._bindUnlock();
      if (DEBUG_MUSIC) console.log('[MUSIC] init');
      return this;
    },

    _createAudio() {
      const a = new Audio();
      a.preload = 'auto';
      a.loop = true;
      a.volume = 0;
      return a;
    },

    _bindUnlock() {
      if (this._unlockBound) return;
      const unlock = () => {
        this._unlocked = true;
        if (this._pendingPlay) {
          const { id, opts } = this._pendingPlay;
          this._pendingPlay = null;
          this.fadeTo(id, Object.assign({}, opts, { force: true }));
        }
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      };
      window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
      window.addEventListener('keydown', unlock, { capture: true, passive: true });
      this._unlockBound = true;
    },

    setVolume(v) {
      this._masterVolume = clamp01(v);
      this._applyVolumes();
    },

    getCurrentTrackId() {
      return this._currentTrackId;
    },

    play(trackId, opts = {}) {
      return this.fadeTo(trackId, Object.assign({ fadeTime: 0 }, opts));
    },

    stop(opts = {}) {
      const fadeTime = opts.fadeTime != null ? opts.fadeTime : this._fadeTime;
      if (!this._currentAudio) return;
      this._fading = true;
      this._fadeTimer = 0;
      this._fadeDuration = Math.max(0.1, fadeTime);
      this._nextAudio = null;
      this._nextTrackId = null;
    },

    fadeTo(trackId, opts = {}) {
      if (!trackId) return;
      if (!this._initialized) this.init(opts);
      if (!this._unlocked && !opts.force) {
        this._pendingPlay = { id: trackId, opts };
        return;
      }
      if (this._currentTrackId === trackId && !opts.restart) return;

      const nextAudio = this._getAudioFor(trackId);
      if (!nextAudio) return;

      const fadeTime = opts.fadeTime != null ? opts.fadeTime : this._fadeTime;
      const immediate = fadeTime <= 0.01 || (opts.immediate === true);

      if (DEBUG_MUSIC) console.log(`[MUSIC] fadeTo ${this._currentTrackId || 'none'} -> ${trackId}`);

      this._fadeDuration = Math.max(0.05, fadeTime);
      this._fadeTimer = 0;
      this._fading = !immediate;
      this._nextTrackId = trackId;
      this._nextAudio = nextAudio;

      if (!this._nextAudio.src) {
        this._nextAudio.src = MUSIC_TRACKS[trackId];
      }
      this._nextAudio.loop = LOOP_CONFIG[trackId] !== false;
      this._nextAudio.currentTime = 0;
      this._nextAudio.volume = immediate ? this._masterVolume : 0;
      this._nextAudio.play().catch(() => {});

      if (immediate) {
        this._swapToNext();
      } else {
        this._ensureDualChannels();
      }
    },

    _ensureDualChannels() {
      if (!this._currentAudio) this._currentAudio = this._channels[0];
      if (!this._nextAudio && this._channels.length > 1) this._nextAudio = this._channels[1];
    },

    _getAudioFor(trackId) {
      if (!MUSIC_TRACKS[trackId]) return null;
      if (!this._channels.length) this._channels = [this._createAudio(), this._createAudio()];
      // Alternate channels to avoid restarting same element mid-fade
      const next = this._channels.find((a) => a !== this._currentAudio) || this._channels[0];
      next.src = MUSIC_TRACKS[trackId];
      return next;
    },

    _swapToNext() {
      if (this._currentAudio && this._currentAudio !== this._nextAudio) {
        this._currentAudio.pause();
        this._currentAudio.currentTime = 0;
      }
      this._currentAudio = this._nextAudio;
      this._currentTrackId = this._nextTrackId;
      this._nextAudio = null;
      this._nextTrackId = null;
      this._fading = false;
      this._fadeTimer = 0;
      this._applyVolumes();
      if (DEBUG_MUSIC && this._currentTrackId) console.log(`[MUSIC] now playing ${this._currentTrackId}`);
    },

    update(dt = 0) {
      if (!this._initialized) return;
      if (this._fading) {
        this._fadeTimer += dt;
        const t = Math.min(1, this._fadeTimer / this._fadeDuration);
        const inv = 1 - t;
        if (this._currentAudio) this._currentAudio.volume = inv * this._masterVolume;
        if (this._nextAudio) this._nextAudio.volume = t * this._masterVolume;
        if (t >= 1) {
          if (this._nextAudio) this._nextAudio.volume = this._masterVolume;
          this._swapToNext();
        }
      }
    },

    _applyVolumes() {
      if (this._currentAudio) this._currentAudio.volume = this._masterVolume;
      if (this._nextAudio && this._fading) {
        const progress = Math.min(1, this._fadeTimer / Math.max(0.0001, this._fadeDuration));
        this._nextAudio.volume = progress * this._masterVolume;
        this._currentAudio.volume = (1 - progress) * this._masterVolume;
      } else if (this._nextAudio) {
        this._nextAudio.volume = this._masterVolume;
      }
    },
  };

  global.MusicManager = MusicManager;
})(typeof window !== 'undefined' ? window : globalThis);
