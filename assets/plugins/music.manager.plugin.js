/* ==========================================================================
 * Il Divo: Hospital Dash! — MusicManager
 * --------------------------------------------------------------------------
 * Sistema de música dinámica con cross-fade y un único canal lógico.
 * IDs de pista soportados (MUSIC_TRACKS):
 *   intro, menu_theme/main_menu, level_theme/level1/level2/level3,
 *   miniboss1, miniboss2, miniboss3,
 *   boss_theme/boss1/boss2,
 *   pre_final_boss, boss_final_A, boss_final_B, fire_escape,
 *   score, credits, gameover_theme.
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
 * Contrato BGM (nuevo): solo la start-screen inicia pagina_principal.mp3 mediante
 *   MusicManager.playMenu(); los niveles llaman a MusicManager.playLevel(config)
 *   y el manager hace stop/fade de la música previa antes de la del nivel.
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
  const MENU_TRACK_ID = 'menu_theme';
  const DEFAULT_LEVEL_TRACK = 'level_theme';
  const MUSIC_TRACKS = {
    intro: { url: 'assets/music/intro.mp3', loop: false },
    menu_theme: { url: 'assets/music/pagina_principal.mp3', loop: true },
    main_menu: { url: 'assets/music/pagina_principal.mp3', loop: true },
    level_theme: { url: 'assets/music/nivel1.mp3', loop: true },
    level1: { url: 'assets/music/nivel1.mp3', loop: true },
    level2: { url: 'assets/music/nivel2.mp3', loop: true },
    level3: { url: 'assets/music/nivel3.mp3', loop: true },
    miniboss1: { url: 'assets/music/Mini_boss1.mp3', loop: true },
    miniboss2: { url: 'assets/music/mini_boss2.mp3', loop: true },
    miniboss3: { url: 'assets/music/mini_boss3.mp3', loop: true },
    boss_theme: { url: 'assets/music/boss_nivel1.mp3', loop: true },
    boss1: { url: 'assets/music/boss_nivel1.mp3', loop: true },
    boss2: { url: 'assets/music/boss_nivel2.mp3', loop: true },
    pre_final_boss: { url: 'assets/music/pre_final_boss.mp3', loop: false },
    boss_final_A: { url: 'assets/music/boss_final_parteA.mp3', loop: false },
    boss_final_B: { url: 'assets/music/boss_final_parteB.mp3', loop: false },
    fire_escape: { url: 'assets/music/huida_del_fuego.mp3', loop: false },
    score: { url: 'assets/music/pantalla_de_puntuación .mp3', loop: false }, // ← hay un espacio en el nombre del fichero
    credits: { url: 'assets/music/creditos_finales .mp3', loop: false },     // ← hay un espacio en el nombre del fichero
    gameover_theme: { url: 'assets/music/pantalla_de_puntuación .mp3', loop: false },
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
    _tracks: { ...MUSIC_TRACKS },
    _usingMusicAPI: false,
    _musicApiReady: false,
    _currentContext: null,     // 'menu' | 'level' | null
    _currentLevelTrack: null,

    init(opts = {}) {
      if (this._initialized) return this;
      this._initialized = true;
      this._baseVolume = clamp01(opts.volume != null ? opts.volume : DEFAULT_VOLUME);
      this._masterVolume = this._baseVolume;
      this._fadeTime = Math.max(0.1, opts.fadeTime || DEFAULT_FADE_TIME);
      this._tracks = Object.assign({}, MUSIC_TRACKS, opts.tracks || {});
      this._channels = [this._createAudio(), this._createAudio()];
      this._currentAudio = this._channels[0];
      this._bindUnlock();
      this._ensureMusicAPI();
      if (DEBUG_MUSIC) console.log('[MUSIC] init');
      return this;
    },

    _ensureMusicAPI() {
      if (this._musicApiReady) return true;
      const api = global.MusicAPI;
      if (!api || typeof api.init !== 'function') return false;
      const urls = {};
      for (const [key, meta] of Object.entries(this._tracks)) {
        const info = this._normalizeTrack(meta);
        if (info && info.url) urls[key] = info.url;
      }
      try {
        api.init({ urls, preload: false });
        api.fadeDefault = this._fadeTime;
        this._musicApiReady = true;
        this._usingMusicAPI = true;
      } catch (_) {
        this._musicApiReady = false;
      }
      return this._musicApiReady;
    },

    _normalizeTrack(trackDef) {
      if (!trackDef) return null;
      if (typeof trackDef === 'string') return { url: trackDef, loop: true };
      return { url: trackDef.url || trackDef.src || trackDef.path, loop: trackDef.loop !== false };
    },

    _getTrackMeta(trackId) {
      const meta = this._normalizeTrack(this._tracks[trackId]);
      if (meta && meta.url) return meta;
      return null;
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

    playMenu(opts = {}) {
      if (!this._initialized) this.init(opts);
      const alreadyMenu = this._currentTrackId === MENU_TRACK_ID && this._currentContext === 'menu';
      if (alreadyMenu) return;
      this._currentContext = 'menu';
      this._currentLevelTrack = null;
      this.fadeTo(MENU_TRACK_ID, Object.assign({ loop: true, fadeTime: this._fadeTime }, opts));
    },

    stopMenu(opts = {}) {
      if (this._currentContext !== 'menu' && this._currentTrackId !== MENU_TRACK_ID) return;
      this._currentContext = null;
      this._currentLevelTrack = null;
      this.stop(opts);
    },

    playLevel(levelConfig = {}, opts = {}) {
      if (!this._initialized) this.init(opts);
      const trackId = this._resolveLevelTrack(levelConfig) || DEFAULT_LEVEL_TRACK;
      this.stopMenu({ fadeTime: opts.fadeTime });
      if (this._currentContext === 'level' && this._currentTrackId === trackId && !opts.restart) return;
      this._currentContext = 'level';
      this._currentLevelTrack = trackId;
      this.fadeTo(trackId, Object.assign({ loop: true, fadeTime: this._fadeTime }, opts));
    },

    stopLevel(opts = {}) {
      if (this._currentContext !== 'level') return;
      this._currentContext = null;
      this._currentLevelTrack = null;
      this.stop(opts);
    },

    stopAll(opts = {}) {
      this._currentContext = null;
      this._currentLevelTrack = null;
      this.stop(opts);
    },

    crossfade(trackId, duration) {
      const fade = duration != null ? duration : this._fadeTime;
      return this.fadeTo(trackId, { fadeTime: fade });
    },

    stop(opts = {}) {
      const fadeTime = opts.fadeTime != null ? opts.fadeTime : this._fadeTime;
      if (this._usingMusicAPI && this._ensureMusicAPI()) {
        try { global.MusicAPI?.stopAll?.(fadeTime); } catch (_) {}
        this._currentTrackId = null;
        return;
      }
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

      const meta = this._getTrackMeta(trackId);
      if (!meta) return;

      const fadeTime = opts.fadeTime != null ? opts.fadeTime : this._fadeTime;
      const immediate = fadeTime <= 0.01 || (opts.immediate === true);

      // Ruta principal: usar MusicAPI (WebAudio + fallback HTMLAudio gestionado ahí)
      if (this._ensureMusicAPI()) {
        this._playViaMusicAPI(trackId, meta, { fadeTime, immediate, loop: opts.loop });
        return;
      }

      const nextAudio = this._getAudioFor(trackId, meta);
      if (!nextAudio) return;

      const loop = opts.loop != null ? !!opts.loop : meta.loop !== false;

      if (DEBUG_MUSIC) console.log(`[MUSIC] fadeTo ${this._currentTrackId || 'none'} -> ${trackId}`);

      this._fadeDuration = Math.max(0.05, fadeTime);
      this._fadeTimer = 0;
      this._fading = !immediate;
      this._nextTrackId = trackId;
      this._nextAudio = nextAudio;

      if (!this._nextAudio.src) {
        this._nextAudio.src = meta.url;
      }
      this._nextAudio.loop = loop;
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

    _resolveLevelTrack(levelConfig = {}) {
      const cfg = levelConfig || {};
      const explicit = cfg.music || cfg.track || cfg.bgm || cfg.levelMusic || cfg?.level?.music;
      if (explicit && this._getTrackMeta(explicit)) return explicit;

      const levelId = Number(cfg.levelId ?? cfg.id ?? cfg.level) || Number(window?.G?.level) || 1;
      if (levelId >= 3 && this._getTrackMeta('level3')) return 'level3';
      if (levelId === 2 && this._getTrackMeta('level2')) return 'level2';
      if (this._getTrackMeta('level1')) return 'level1';
      return null;
    },

    _playViaMusicAPI(trackId, meta, { fadeTime, immediate, loop }) {
      const targetLoop = loop != null ? !!loop : meta.loop !== false;
      const fade = immediate ? 0.01 : Math.max(0.05, fadeTime);
      try {
        global.MusicAPI?._crossfadeTo?.(trackId, { loop: targetLoop, fade });
      } catch (_) {
        // fallback silencioso
      }
      this._currentTrackId = trackId;
      this._nextTrackId = null;
      this._nextAudio = null;
      this._fading = false;
    },

    _getAudioFor(trackId, meta) {
      if (!meta || !meta.url) return null;
      if (!this._channels.length) this._channels = [this._createAudio(), this._createAudio()];
      // Alternate channels to avoid restarting same element mid-fade
      const next = this._channels.find((a) => a !== this._currentAudio) || this._channels[0];
      next.src = meta.url;
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
