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
  let readyPrimed = false;
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
      padding: '18px 36px',
      borderRadius: '22px',
      border: '2px solid #19c37d',
      background: 'rgba(12,16,24,0.92)',
      boxShadow: '0 24px 48px rgba(0,0,0,0.45)',
      transform: 'translateX(120vw)'
    });

    const art = document.createElement('div');
    Object.assign(art.style, {
      width: '140px',
      height: '120px',
      borderRadius: '16px',
      backgroundImage: 'url("./assets/images/ready.jpg")',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      boxShadow: '0 16px 32px rgba(0,0,0,0.55)'
    });

    const text = document.createElement('div');
    text.textContent = 'READY?';
    Object.assign(text.style, {
      fontFamily: '"IBM Plex Sans", Inter, system-ui, sans-serif',
      fontSize: '64px',
      fontWeight: '700',
      color: '#f8fcff',
      letterSpacing: '4px',
      textShadow: '0 4px 18px rgba(0,0,0,0.6)'
    });

    card.appendChild(art);
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
    readyPrimed = false;
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
    if (!readyPrimed && !opts.force) return false;
    readyPrimed = false;
    readyActive = true;
    S.readyOverlayActive = true;
    overlay.style.display = 'flex';
    overlay.style.transition = 'opacity 180ms ease-out';
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'auto';
    readyContentEl.style.transition = 'none';
    readyContentEl.style.transform = 'translateX(120vw)';
    clearReadyOverlayTimers();

    const enterMs = opts.enterMs ?? (600 + Math.random() * 100);
    const holdMs = opts.holdMs ?? (300 + Math.random() * 100);
    const exitMs = opts.exitMs ?? (500 + Math.random() * 100);

    raf(() => {
      overlay.style.opacity = '1';
      // Force layout to apply initial transform
      void readyContentEl.offsetWidth;
      readyContentEl.style.transition = `transform ${enterMs}ms cubic-bezier(0.19,0.7,0.32,1)`;
      readyContentEl.style.transform = 'translateX(0)';
      const pauseTimer = setTimeout(() => {
        readyContentEl.style.transition = `transform ${exitMs}ms cubic-bezier(0.55,0,0.85,0.36)`;
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
        }, exitMs);
        readyTimers.push(exitTimer);
      }, enterMs + holdMs);
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
    finalPillSpawned: false,
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
      cartBossTiles: 2.0
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

      // 4) Spawn de la pastilla final al acercar el carro de urgencias
      if (S.fogFaded && !S.finalPillSpawned) {
        trySpawnFinalPillWhenCartNearBoss();
      }

      // 5) Entrega de la pastilla final al boss
      autoDetectFinalDelivery();

      // 6) Victoria de nivel
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
        finalPillSpawned: S.finalPillSpawned,
        finalDelivered: S.finalDelivered,
        victory: S.victory,
        gameOver: S.gameOver,
        readyOverlayActive: S.readyOverlayActive
      };
    },

    playReadyOverlay(opts){
      return triggerReadyOverlay(opts);
    },

    primeReadyOverlay(){
      readyPrimed = true;
      return true;
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
    S.finalPillSpawned = false;
    S.finalDelivered = false;
    S.victory = false;
    S.gameOver = false;
    S.boss = null;
    S.bossDoor = null;
    S.emergencyCart = null;
    S.urgenciasOpen = false;
    S.readyOverlayActive = false;
    readyPrimed = false;
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
    S.bossDoor.open = false;
    S.bossDoor.solid = true;
    S.bossDoor.color = S.bossDoor.colorClosed || '#db6d28';
    if (S.bossDoor.spriteKey) S.bossDoor.spriteKey = '--sprite-door-closed';
  }
  function openBossDoor() {
    if (S.bossDoorOpened) return;
    S.bossDoorOpened = true;
    S.urgenciasOpen = true;
    if (S.bossDoor) {
      S.bossDoor.open = true;
      S.bossDoor.solid = false;
      S.bossDoor.color = S.bossDoor.colorOpen || '#3fb950';
      if (S.bossDoor.spriteKey) S.bossDoor.spriteKey = '--sprite-door-open';
    }
    try {
      const level = (S.G && S.G.level) || S.level || 1;
      window.LOG?.event?.('OPEN_BOSS_DOOR', {
        level,
        patientsDelivered: S.deliveredPatients || 0,
        totalPatients: S.totalPatients || 0,
      });
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
      try { window.ArrowGuide?.setTargetBossOrDoor?.(); } catch (_) {}
    } else {
      if (S.bossDoor) {
        S.bossDoor.open = false;
        S.bossDoor.solid = true;
        if (S.bossDoor.spriteKey) S.bossDoor.spriteKey = '--sprite-door-closed';
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

  // Spawn de la pastilla final junto al boss cuando el carro de urgencias está cerca
  function trySpawnFinalPillWhenCartNearBoss() {
    if (!S.boss) return;
    const cart = S.emergencyCart || findEmergencyCart();
    if (!cart) return;
    const c = centerOf(cart);
    const b = centerOf(S.boss);
    const tiles = Math.sqrt(dist2(c.x, c.y, b.x, b.y)) / TILE;
    if (tiles <= S.opts.cartBossTiles) {
      spawnFinalPillNearBoss();
      S.finalPillSpawned = true;
    }
  }

  function findEmergencyCart() {
    const G = S.G;
    if (!G || !Array.isArray(G.entities)) return null;
    return G.entities.find(e => e.kind === ENT.CART && (e.cartType === 'emergency' || e.cart === 'urgencias' || e.tag === 'emergency')) || null;
  }

  function spawnFinalPillNearBoss() {
    const G = S.G;
    if (!G || !S.boss) return;
    const pos = centerOf(S.boss);
    const item = {
      kind: ENT.ITEM,
      itemKey: 'pill_final',
      type: 'quest',
      spriteKey: '--sprite-pill-final',
      x: pos.x + TILE * 0.5,
      y: pos.y,
      w: 20, h: 20,
      vx: 0, vy: 0,
      pickup: true,
      quest: true
    };
    if (!Array.isArray(G.entities)) G.entities = [];
    G.entities.push(item);
    // Partículas sutiles si hay sistema
    if (G.particles && typeof G.particles.spawn === 'function') {
      for (let i = 0; i < 10; i++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = 60 + Math.random() * 100;
        G.particles.spawn({
          x: item.x + item.w / 2,
          y: item.y + item.h / 2,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          size: 2 + Math.random() * 2,
          life: 500 + Math.random() * 400,
          color: '#ffd1dc'
        });
      }
    }
  }

  // Detección automática de entrega de pastilla final al boss
  function autoDetectFinalDelivery() {
    if (S.finalDelivered) return;
    const G = S.G;
    if (!G || !Array.isArray(G.entities) || !S.boss) return;

    // Si el juego tiene inventario y marca boss.cured, ya está
    if (S.boss.cured || S.boss.finalPillGiven) {
      S.finalDelivered = true;
      return;
    }

    // Si existe el ítem "pill_final" y el jugador lo usa cerca del boss
    const player = G.player;
    const hasInInventory = !!(player && (player.carryItemKey === 'pill_final' || player.finalPill === true));
    const pillEntity = G.entities.find(e => e.kind === ENT.ITEM && e.itemKey === 'pill_final' && !e.dead);
    const nearBoss = (ent) => {
      const p = centerOf(ent);
      const b = centerOf(S.boss);
      return dist2(p.x, p.y, b.x, b.y) <= (TILE * 1.6) * (TILE * 1.6);
    };

    // Caso 1: en inventario + acción
    const inputUse = readUseInput();
    if (hasInInventory && inputUse && nearBoss(player)) {
      deliverFinalPill();
      return;
    }

    // Caso 2: la pastilla está en el suelo y el boss la toca (auto-curado)
    if (pillEntity && aabbOverlap(pillEntity, S.boss)) {
      deliverFinalPill();
      pillEntity.dead = true;
      return;
    }
  }

  function readUseInput() {
    // Intenta leer input de uso/acción E
    if (S.G && S.G.input && (S.G.input.use || S.G.input.interact)) return true;
    if (W.keys && (W.keys['e'] || W.keys['E'])) return true;
    return false;
  }

  function deliverFinalPill() {
    S.finalDelivered = true;
    if (S.boss) { S.boss.cured = true; S.boss.finalPillGiven = true; }
    // Audio/UI
    if (W.Audio && W.Audio.sfx) { try { W.Audio.sfx('quest_complete'); } catch (e) {} }
  }

  // Fin de nivel y avance
  function onLevelComplete() {
    if (S.victory) return;
    S.victory = true;
    S.running = false;
    if (S.G) S.G.state = 'COMPLETE';
    showOverlay(DOM.complete);
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
  }

  // Helpers overlays
  function showOverlay(el) { if (el && el.classList) el.classList.remove('hidden'); }
  function hideOverlay(el) { if (el && el.classList) el.classList.add('hidden'); }

  // Exponer módulo
  W.GameFlowAPI = GameFlow;

})(this);