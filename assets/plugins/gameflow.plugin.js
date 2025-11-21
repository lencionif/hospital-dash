// filename: gameflow.api.js
// Gestión del flujo del juego: progreso, victoria y game over para “Il Divo: Hospital Dash!”.
// Módulo tolerante: no rompe si faltan APIs (Fog/Lights/Camera/Objects). Se integra con G, ENT y DOM overlays si existen.

(function (global) {
  'use strict';

  // Utilidades básicas
  const W = (typeof window !== 'undefined') ? window : global;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const TILE = (typeof W.TILE_SIZE !== 'undefined') ? W.TILE_SIZE : (typeof W.TILE !== 'undefined' ? W.TILE : 32);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  const centerOf = (e) => ({ x: e.x + e.w * 0.5, y: e.y + e.h * 0.5 });
  const aabbOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // Adaptadores
  const ENT = W.ENT || {
    PLAYER: 'player',
    PATIENT: 'patient',
    FURIOUS: 'furious',
    ENEMY: 'enemy',
    DOOR: 'door',
    BOSS: 'boss',
    CART: 'cart',
    ITEM: 'item'
  };

  // Overlays DOM (tolerante si no existen)
  const DOM = {
    start:       (typeof document !== 'undefined') ? document.getElementById('start-screen') : null,
    pause:       (typeof document !== 'undefined') ? document.getElementById('pause-screen') : null,
    complete:    (typeof document !== 'undefined') ? document.getElementById('level-complete-screen') : null,
    gameover:    (typeof document !== 'undefined') ? document.getElementById('game-over-screen') : null
  };

  let readyOverlayEl = null;
  let readyContentEl = null;
  const readyTimers = [];
  let readyActive = false;
  const raf = (typeof W.requestAnimationFrame === 'function')
    ? W.requestAnimationFrame.bind(W)
    : (fn) => setTimeout(fn, 16);

  function ensureReadyOverlay(){
    if (readyOverlayEl || typeof document === 'undefined') return readyOverlayEl;
    const overlay = document.createElement('div');
    overlay.id = 'ready-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(8,12,18,0.45)',
      backdropFilter: 'blur(2px)',
      zIndex: 40000,
      pointerEvents: 'none',
      opacity: '0'
    });

    const card = document.createElement('div');
    card.className = 'ready-card';
    Object.assign(card.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '18px',
      borderRadius: '22px',
      border: '2px solid #19c37d',
      background: 'rgba(12,16,24,0.92)',
      boxShadow: '0 24px 48px rgba(0,0,0,0.45)',
      src: './assets/images/ready.jpg', // no 'enfermera_sexy.png'
      alt: 'READY',
      loading: 'eager',
      decoding: 'sync',
      objectFit: 'contain',
      width: '48vw',  // antes ~22vw
      height: '64vw',
      maxWidth: '720px',
      padding: '12px 18px',
      borderRadius: '16px',
      translate: '0 0', // la animación ya modifica translateX
      transform: 'translateX(120vw)'
    });

    const img = document.createElement('img');
    img.src = './assets/images/ready.jpg';
    Object.assign(img.style, {
      width: '52vw',
      height: '56vw',
      objectFit: 'contain',
      filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.45))'
    });

    const text = document.createElement('div');
    Object.assign(text.style, {
      fontFamily: '"IBM Plex Sans", Inter, system-ui, sans-serif',
      fontSize: '64px',
      fontWeight: '700',
      color: '#f8fcff',
      letterSpacing: '4px',
      textShadow: '0 4px 18px rgba(0,0,0,0.6)'
    });

    card.appendChild(img);
    card.appendChild(text);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    readyOverlayEl = overlay;
    readyContentEl = card;
    return readyOverlayEl;
  }

  function clearReadyOverlayTimers(){
    while (readyTimers.length){
      const id = readyTimers.pop();
      clearTimeout(id);
    }
  }

  function hideReadyOverlayImmediate(){
    readyActive = false;
    S.readyOverlayActive = false;
    const overlay = readyOverlayEl || ensureReadyOverlay();
    if (!overlay) return;
    clearReadyOverlayTimers();
    overlay.style.transition = 'none';
    overlay.style.opacity = '0';
    overlay.style.display = 'none';
    overlay.style.pointerEvents = 'none';
    if (readyContentEl){
      readyContentEl.style.transition = 'none';
      readyContentEl.style.transform = 'translateX(120vw)';
    }
  }

  function triggerReadyOverlay(opts = {}){
    const overlay = ensureReadyOverlay();
    if (!overlay || readyActive) return false;
    readyActive = true;
    S.readyOverlayActive = true;
    overlay.style.display = 'flex';
    overlay.style.transition = 'opacity 180ms ease-out';
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'auto';
    readyContentEl.style.transition = 'none';
    readyContentEl.style.transform = 'translateX(120vw)';
    clearReadyOverlayTimers();

    raf(() => {
      overlay.style.opacity = '1';
      // Force layout to apply initial transform
      void readyContentEl.offsetWidth;
      readyContentEl.style.transition = 'transform 650ms cubic-bezier(0.19,0.7,0.32,1)';
      readyContentEl.style.transform = 'translateX(0)';
      const fxKick = setTimeout(() => {
        try { window.CineFX?.readyBeat?.({ hold: 0.32, duration: 0.7, release: 0.4 }); }
        catch (err){ if (W.DEBUG_FORCE_ASCII) console.warn('[CineFX] ready overlay cue', err); }
      }, 200);
      readyTimers.push(fxKick);
      const fxGo = setTimeout(() => {
        try { window.CineFX?.readyBeat?.({ scale: 0.55, hold: 0.25, duration: 0.55, release: 0.35 }); }
        catch (err){ if (W.DEBUG_FORCE_ASCII) console.warn('[CineFX] ready overlay go', err); }
      }, 820);
      readyTimers.push(fxGo);
      const pauseTimer = setTimeout(() => {
        readyContentEl.style.transition = 'transform 550ms cubic-bezier(0.55,0,0.85,0.36)';
        readyContentEl.style.transform = 'translateX(-120vw)';
        const exitTimer = setTimeout(() => {
          overlay.style.transition = 'opacity 200ms ease-in';
          overlay.style.opacity = '0';
          const doneTimer = setTimeout(() => {
            overlay.style.display = 'none';
            overlay.style.pointerEvents = 'none';
            readyActive = false;
            S.readyOverlayActive = false;
            readyTimers.length = 0;
            if (typeof opts.onComplete === 'function') opts.onComplete();
          }, 210);
          readyTimers.push(doneTimer);
        }, 550);
        readyTimers.push(exitTimer);
      }, 650 + 350);
      readyTimers.push(pauseTimer);
    });

    return true;
  }

  function readyOverlayIsActive(){
    return readyActive;
  }


  // Estado interno
  const S = {
    G: null,
    level: 1,
    maxLevels: 3,
    // Pacientes y pastillas
    totalPatients: 0,
    deliveredPatients: 0,
    allDelivered: false,
    // Fases finales
    bossDoorOpened: false,
    fogFaded: false,
    zooming: false,
    zoomPhase: 0,
    zoomTimer: 0,
    finalDelivered: false,
    // Boss y cart detectados
    boss: null,
    bossDoor: null,
    emergencyCart: null,
    // Flags de transición
    running: false,
    victory: false,
    gameOver: false,
    urgenciasOpen: false,
    // Opciones
    opts: {
      zoomToBossMs: 1500,
      holdOnBossMs: 900,
      zoomBackMs: 900,
      cartBossTiles: 1.5
    },
    readyOverlayActive: false
  };

  // API pública
  const GameFlow = {
    init(G, opts = {}) {
      S.G = G || S.G || {};
      S.maxLevels = (typeof opts.maxLevels === 'number') ? opts.maxLevels : S.maxLevels;
      if (opts.zoomToBossMs) S.opts.zoomToBossMs = opts.zoomToBossMs;
      if (opts.holdOnBossMs) S.opts.holdOnBossMs = opts.holdOnBossMs;
      if (opts.zoomBackMs) S.opts.zoomBackMs = opts.zoomBackMs;
      if (opts.cartBossTiles) S.opts.cartBossTiles = opts.cartBossTiles;
      // Reinicia contadores de nivel si ya hay mapa
      hideReadyOverlayImmediate();
      resetLevelState();
      S.running = true;
      return GameFlow;
    },

    // Llamar cuando cargues o reinicies un nivel
    startLevel(levelNumber) {
      S.level = (typeof levelNumber === 'number') ? clamp(levelNumber, 1, S.maxLevels) : S.level;
      hideReadyOverlayImmediate();
      resetLevelState();
      S.running = true;
      S.victory = false;
      S.gameOver = false;
      hideOverlay(DOM.complete);
      hideOverlay(DOM.gameover);
      const G = S.G || window.G || {};
      resetGlobalStats(G);
      G.__placementsApplied = false;
      // Asegurar estado de puerta y niebla acorde al inicio
      lockBossDoor();
      syncUrgenciasFromStats();
      if (W.FogAPI && typeof W.FogAPI.reset === 'function') W.FogAPI.reset();
      try {
        W.Narrator?.say?.('level_start', { level: S.level });
        W.Narrator?.progress?.();
      } catch (_) {}
    },

    // Llamar cada frame con dt en segundos
    update(dt) {
      if (!S.running || S.gameOver || S.victory) return;
      autoScanReferences();
      if (!S.G || !S.G.entities || !S.G.player) return;

      // 1) Game Over por vida
      if (isHeroDead()) { triggerGameOver(); return; }

      // 2) Progreso pacientes: ¿entregadas todas las pastillas correctas?
      trackPatientsProgress();

      // 3) Apertura de puerta + secuencia de niebla y zoom al boss
      if (S.allDelivered && !S.bossDoorOpened) {
        openBossDoor();
      }
      if (S.bossDoorOpened && !S.fogFaded) {
        startFogFadeAndZoomToBoss();
      }
      if (S.zooming) {
        tickZoom(dt);
      }

      // 4) Detectar entrega del carro de urgencias al paciente crítico
      autoDetectFinalDelivery();

      // 5) Victoria de nivel
      if (S.finalDelivered) {
        onLevelComplete();
      }
    },

    // Notificaciones opcionales (si el juego prefiere eventos explícitos)
    notifyPatientDelivered(patient) {
      if (!patient) return;
      patient.delivered = true;
      // Sumar y revisar progreso
      S.deliveredPatients = Math.min(S.totalPatients, S.deliveredPatients + 1);
      S.allDelivered = (S.deliveredPatients >= S.totalPatients && S.totalPatients > 0);
      syncUrgenciasFromStats();
    },

    notifyBossFinalDelivered() {
      S.finalDelivered = true;
    },

    notifyHeroDeath() {
      triggerGameOver();
    },

    notifyPatientCountersChanged() {
      syncUrgenciasFromStats();
    },

    // Avance de nivel / fin de juego
    nextLevel() {
      if (S.level < S.maxLevels) {
        S.level++;
        if (typeof S.G.resetAndLoadLevel === 'function') {
          S.G.resetAndLoadLevel(S.level);
        } else {
          // Fallback: reinicia banderas y espera a que el juego regenere el mapa externamente
          resetLevelState();
        }
        return true;
      } else {
        // Fin de juego
        showOverlay(DOM.complete);
        S.running = false;
        return false;
      }
    },

    // Accesores
    getState() {
      return {
        level: S.level,
        maxLevels: S.maxLevels,
        totalPatients: S.totalPatients,
        deliveredPatients: S.deliveredPatients,
        allDelivered: S.allDelivered,
        bossDoorOpened: S.bossDoorOpened,
        finalDelivered: S.finalDelivered,
        victory: S.victory,
        gameOver: S.gameOver,
        readyOverlayActive: S.readyOverlayActive
      };
    },

    getLevel(){
      return S.level || 1;
    },

    playReadyOverlay(opts){
      return triggerReadyOverlay(opts);
    },

    cancelReadyOverlay(){
      hideReadyOverlayImmediate();
    },

    isReadyOverlayActive(){
      return readyOverlayIsActive();
    }
  };

  function resetGlobalStats(G) {
    if (!G) return;
    const stats = G.stats || (G.stats = {});
    stats.totalPatients = 0;
    stats.remainingPatients = 0;
    stats.activeFuriosas = 0;
    stats.furiosasNeutralized = 0;
  }

  // Estado interno por nivel
  function resetLevelState() {
    hideReadyOverlayImmediate();
    S.totalPatients = 0;
    S.deliveredPatients = 0;
    S.allDelivered = false;
    S.bossDoorOpened = false;
    S.fogFaded = false;
    S.zooming = false;
    S.zoomPhase = 0;
    S.zoomTimer = 0;
    S.finalDelivered = false;
    S.victory = false;
    S.gameOver = false;
    S.boss = null;
    S.bossDoor = null;
    S.emergencyCart = null;
    S.urgenciasOpen = false;
    S.readyOverlayActive = false;
    const G = S.G || window.G || {};
    if (G) {
      G.__placementsApplied = false;
      resetGlobalStats(G);
    }
    autoScanReferences();
    recountPatients();
    lockBossDoor();
  }

  // Escanea referencias básicas si no están cacheadas
  function autoScanReferences() {
    const G = S.G;
    if (!G || !Array.isArray(G.entities)) return;
    if (!S.boss) S.boss = G.entities.find(e => e.kind === ENT.BOSS);
    if (!S.bossDoor) {
      S.bossDoor = G.entities.find(e => e.kind === ENT.DOOR && (e.isBossDoor || e.bossDoor || e.tag === 'bossDoor'));
      if (!S.bossDoor) {
        // Fallback: puerta más cercana al boss
        if (S.boss) {
          let best = null, bestD2 = Infinity;
          for (const e of G.entities) {
            if (e.kind !== ENT.DOOR) continue;
            const d2 = dist2(e.x, e.y, S.boss.x, S.boss.y);
            if (d2 < bestD2) { bestD2 = d2; best = e; }
          }
          S.bossDoor = best;
        }
      }
    }
    if (!S.emergencyCart) {
      S.emergencyCart = G.entities.find(e => e.kind === ENT.CART && (e.cartType === 'emergency' || e.cart === 'urgencias' || e.tag === 'emergency'));
    }
  }

  function recountPatients() {
    const G = S.G;
    if (!G) return;
    const stats = G.stats || {};
    const total = stats.totalPatients || 0;
    const remaining = stats.remainingPatients || 0;
    const furiosas = stats.activeFuriosas || 0;
    S.totalPatients = total;
    S.deliveredPatients = Math.max(0, total - remaining);
    S.allDelivered = (remaining === 0 && furiosas === 0);
  }

  // Puerta del boss: cerrar al inicio, abrir en progreso
  function lockBossDoor() {
    if (!S.bossDoor) return;
    try { window.DoorsAPI?.setLocked?.(S.bossDoor, true); } catch (_) {}
    S.bossDoor.open = false;
    S.bossDoor.solid = true;
    S.bossDoor.color = S.bossDoor.colorClosed || '#db6d28';
    if (S.bossDoor.spriteKey) S.bossDoor.spriteKey = '--sprite-door-closed';
    if (S.bossDoor.state) {
      S.bossDoor.state.open = false;
      S.bossDoor.state.holdOpen = false;
    }
  }
  function openBossDoor() {
    if (S.bossDoorOpened) return;
    S.bossDoorOpened = true;
    S.urgenciasOpen = true;
    let openedDoor = null;
    try {
      const opened = window.Doors?.openUrgencias?.(S.G);
      if (opened && Array.isArray(S.G?.doors)) {
        openedDoor = S.G.doors.find(d => d && (d.bossDoor || d.isBossDoor || d.tag === 'bossDoor')) || null;
      }
    } catch (_) {}
    const door = openedDoor || S.bossDoor;
    if (door) {
      S.bossDoor = door;
      door.locked = false;
      door.open = true;
      door.solid = false;
      door.color = door.colorOpen || '#3fb950';
      if (door.spriteKey) door.spriteKey = '--sprite-door-open';
      if (door.state) {
        door.state.open = true;
        door.state.holdOpen = true;
        door.state.autoCloseTimer = 0;
        door.state.autoCloser = null;
      }
    }
    try {
      const level = (S.G && S.G.level) || S.level || 1;
      window.LOG?.event?.('OPEN_BOSS_DOOR', {
        level,
        patientsDelivered: S.deliveredPatients || 0,
        totalPatients: S.totalPatients || 0,
      });
    } catch (_) {}
    try {
      const remaining = Math.max(0, (S.totalPatients || 0) - (S.deliveredPatients || 0));
      W.Narrator?.say?.('door_open', { level: S.level, remaining });
      W.Narrator?.progress?.();
    } catch (_) {}
  }

  // Fog + Zoom al boss
  function startFogFadeAndZoomToBoss() {
    S.fogFaded = true;
    // Niebla
    if (W.FogAPI && typeof W.FogAPI.fadeTo === 'function') {
      try { W.FogAPI.fadeTo(0, 800); } catch (e) {}
    } else if (S.G) {
      // Fallback: aumenta visión
      S.G.visionScale = Math.max(S.G.visionScale || 1, 3.0);
    }
    // Zoom
    if (S.boss && getCamera()) {
      S.zooming = true;
      S.zoomPhase = 0;
      S.zoomTimer = 0;
      S._camSnap = snapshotCamera();
    }
  }

  function syncUrgenciasFromStats() {
    const G = S.G || window.G || {};
    const stats = G.stats || {};
    const ready = (stats.remainingPatients || 0) === 0 && (stats.activeFuriosas || 0) === 0;
    if (ready) {
      openBossDoor();
    } else {
      if (S.bossDoor) {
        try { window.DoorsAPI?.setLocked?.(S.bossDoor, true); } catch (_) {}
        S.bossDoor.open = false;
        S.bossDoor.solid = true;
        if (S.bossDoor.spriteKey) S.bossDoor.spriteKey = '--sprite-door-closed';
        if (S.bossDoor.state) {
          S.bossDoor.state.open = false;
          S.bossDoor.state.holdOpen = false;
        }
      }
      S.bossDoorOpened = false;
      S.urgenciasOpen = false;
    }
    if (typeof G.onUrgenciasStateChanged === 'function') {
      try { G.onUrgenciasStateChanged(ready); } catch (e) { console.warn('onUrgenciasStateChanged', e); }
    }
  }

  function tickZoom(dt) {
    const cam = getCamera();
    if (!cam || !S.boss) { S.zooming = false; return; }
    S.zoomTimer += dt * 1000;
    const { zoomToBossMs, holdOnBossMs, zoomBackMs } = S.opts;
    if (S.zoomPhase === 0) {
      const t = clamp(S.zoomTimer / zoomToBossMs, 0, 1);
      const bossC = centerOf(S.boss);
      if (!Number.isFinite(bossC.x) || !Number.isFinite(bossC.y)) { S.zooming = false; return; }
      cam.x = cam.x + (bossC.x - cam.x) * easeOutQuad(t);
      cam.y = cam.y + (bossC.y - cam.y) * easeOutQuad(t);
      cam.zoom = lerp(cam.zoom || 1.0, Math.max((cam.zoom || 1.0) * 1.6, 1.6), easeOutQuad(t));
      if (t >= 1) { S.zoomPhase = 1; S.zoomTimer = 0; }
    } else if (S.zoomPhase === 1) {
      if (S.zoomTimer >= holdOnBossMs) { S.zoomPhase = 2; S.zoomTimer = 0; }
    } else if (S.zoomPhase === 2) {
      const t = clamp(S.zoomTimer / zoomBackMs, 0, 1);
      const snap = S._camSnap || { x: cam.x, y: cam.y, zoom: 1 };
      cam.x = lerp(cam.x, snap.x, easeInOutQuad(t));
      cam.y = lerp(cam.y, snap.y, easeInOutQuad(t));
      cam.zoom = lerp(cam.zoom, snap.zoom, easeInOutQuad(t));
      if (t >= 1) { S.zooming = false; }
    }

    cam.zoom = clamp(Number.isFinite(cam.zoom) ? cam.zoom : 1, 0.5, 3);
  }

  function snapshotCamera() {
    const cam = getCamera();
    if (!cam) return null;
    return { x: cam.x, y: cam.y, zoom: cam.zoom || 1 };
  }

  function getCamera() {
    if (S.G && S.G.camera) return S.G.camera;
    if (W.camera) return W.camera;
    if (S.G) {
      if (!S.G.camera) S.G.camera = { x: 0, y: 0, zoom: 1 };
      return S.G.camera;
    }
    return null;
  }

  function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
  function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Comprobación de vida del héroe
  function isHeroDead() {
    const p = S.G && S.G.player;
    if (!p) return false;
    if (typeof p.hp === 'number') return p.hp <= 0;
    if (typeof p.hearts === 'number') return p.hearts <= 0;
    return false;
  }

  function triggerGameOver() {
    S.gameOver = true;
    S.running = false;
    if (S.G) S.G.state = 'GAMEOVER';
    showOverlay(DOM.gameover);
    // Pausa subsistemas tolerante
    if (S.G && typeof S.G.pauseAll === 'function') { try { S.G.pauseAll(true); } catch (e) {} }
    if (W.Audio && typeof W.Audio.duck === 'function') { try { W.Audio.duck(true); } catch (e) {} }
    if (S.G) {
      S.G._gameOverReason = S.G._gameOverReason || 'gameflow';
      if (!S.G._gameOverLogged) {
        S.G._gameOverLogged = true;
        window.LOG?.event?.('GAME_OVER', {
          level: S.G.level || S.level || 1,
          reason: S.G._gameOverReason,
          deliveredPatients: S.deliveredPatients || 0,
        });
      }
    }
  }

  // Seguimiento de pacientes
  function trackPatientsProgress() {
    const G = S.G;
    if (!G) return;
    const stats = G.stats || {};
    const total = stats.totalPatients || 0;
    const remaining = stats.remainingPatients || 0;
    const furiosas = stats.activeFuriosas || 0;
    const delivered = Math.max(0, total - remaining);
    const ready = remaining === 0 && furiosas === 0;
    S.totalPatients = total;
    S.deliveredPatients = delivered;
    S.allDelivered = ready;
  }

  function findEmergencyCart() {
    const G = S.G;
    if (!G || !Array.isArray(G.entities)) return null;
    return G.entities.find(e => e.kind === ENT.CART && (e.cartType === 'emergency' || e.cart === 'urgencias' || e.tag === 'emergency')) || null;
  }

  // Detección automática de entrega del carro de urgencias al paciente crítico
  function autoDetectFinalDelivery() {
    if (S.finalDelivered) return;
    const G = S.G;
    if (!G || !Array.isArray(G.entities) || !S.boss || !S.bossDoorOpened) return;

    const cart = S.emergencyCart || findEmergencyCart();
    const patient = S.boss;
    if (!cart || !patient) return;

    if (patient.isHematologic && !patient.cured) return;
    if (patient.isJefaLimpiadoras && !patient.cured) return;

    const cartCenter = centerOf(cart);
    const patientCenter = centerOf(patient);
    const tiles = Math.sqrt(dist2(cartCenter.x, cartCenter.y, patientCenter.x, patientCenter.y)) / TILE;
    if (tiles <= S.opts.cartBossTiles) {
      S.finalDelivered = true;
      if (patient) {
        patient.cured = true;
        patient.finalPillGiven = true;
      }
      cart.delivered = true;
      try { window.AudioAPI?.play?.('deliver_ok', { volume: 0.9, tag: 'cart_delivery' }); } catch (_) {}
      try { window.DialogAPI?.system?.('Paciente crítico estabilizado. ¡Entrega completada!', { ms: 4200 }); } catch (_) {}
      try {
        const name = patient?.displayName || patient?.name || 'el paciente crítico';
        W.Narrator?.say?.('final_delivery', { patientName: name });
        W.Narrator?.progress?.();
      } catch (_) {}
      console.debug('[VICTORY] Cart reached boss with urgencias open = true');
      try { window.ObjectiveSystem?.onCartDelivered?.(cart, patient); } catch (_) {}
    }
  }

  // Fin de nivel y avance
  function onLevelComplete() {
    if (S.victory) return;
    S.victory = true;
    S.running = false;
    if (S.G) S.G.state = 'COMPLETE';
    showOverlay(DOM.complete);
    try { window.CineFX?.levelCompleteCue?.(); }
    catch (err){ if (W.DEBUG_FORCE_ASCII) console.warn('[CineFX] level complete cue', err); }
    // Música/ducking leve
    if (W.Audio && W.Audio.duck) { try { W.Audio.duck(true); } catch (e) {} }
    if (S.G && !S.G._levelCompleteLogged) {
      S.G._levelCompleteLogged = true;
      window.LOG?.event?.('LEVEL_COMPLETE', {
        level: S.G.level || S.level || 1,
        deliveredPatients: S.deliveredPatients || 0,
        totalPatients: S.totalPatients || 0,
      });
    }
    try {
      W.Narrator?.say?.('level_complete', { level: S.level, remaining: 0 });
      W.Narrator?.progress?.();
    } catch (_) {}
  }

  // Helpers overlays
  function showOverlay(el) { if (el && el.classList) el.classList.remove('hidden'); }
  function hideOverlay(el) { if (el && el.classList) el.classList.add('hidden'); }

  // Exponer módulo
  W.GameFlowAPI = GameFlow;

})(this);