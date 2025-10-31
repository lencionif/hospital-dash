/* Il Divo: Hospital Dash! — Motor central
   - Núcleo autosuficiente y estable para integrar plugins/APIs sin romper el loop.
   - Mantiene: física AABB con subpasos, empuje “Rompers”, cámara con zoom, HUD nítido,
     luces con cono del héroe (oscurece y desenfoca fuera), mapa ASCII mínimo con secuencia base.
   - Plugin de luces opcional (window.LightingAPI). El motor no depende de él.
*/
(() => {
  'use strict';

  // ------------------------------------------------------------
  // Parámetros globales y utilidades
  // ------------------------------------------------------------
  const TILE = 32;
  const VIEW_W = 960;
  const VIEW_H = 540;
  const FORCE_PLAYER = 40.0;

  const ENT = {
    PLAYER: 1,
    PATIENT: 2,
    PILL: 3,
    BED: 4,
    CART: 5,
    RAT: 6,
    MOSQUITO: 7,
    DOOR: 8,
    BOSS: 9,
  };

  const COLORS = {
    floor: '#111418',
    wall: '#31363f',
    bed: '#6ca0dc',
    cart: '#b0956c',
    doorClosed: '#7f8c8d',
    doorOpen: '#2ecc71',
    patient: '#ffd166',
    pill: '#a0ffcf',
    rat: '#c7c7c7',
    mosquito: '#ff77aa',
    boss: '#e74c3c',
    player: '#9cc2ff',
    hudText: '#e6edf3',
    hudBg: '#0b0d10',
  };

  // Balance (ligero; extensible sin romper APIs)
  const BALANCE = {
    physics: {
      substeps: 4,
      friction: 0.90,
      playerFriction: 0.86,
      restitution: 0.65,
      pushImpulse: 340,
      maxSpeedPlayer: 165,
      maxSpeedObject: 360
    },
    enemies: {
      mosquito: {
        speed: 10,
        max: 1,
        // ahora en MINUTOS (2–4 min aleatorio por spawn)
        respawnDelayMin: 120,   // 2 minutos
        respawnDelayMax: 240,   // 4 minutos
        zigzag: 42
      }
    },
    cycle: { secondsFullLoop: 1800 },
    hearts: { max: 6, halfHearts: true },
  };

  // Estado global visible
  const G = {
    state: 'START', // START | PLAYING | PAUSED | COMPLETE | GAMEOVER
    time: 0,
    score: 0,
    health: 6, // medias vidas (0..6)
    entities: [],
    movers: [],
    enemies: [],
    patients: [],
    pills: [],
    lights: [],       // lógicas (para info)
    roomLights: [],   // focos de sala
    npcs: [],         // (los pacientes cuentan como NPC)
    mosquitoSpawn: null,
    door: null,
    cart: null,
    boss: null,
    player: null,
    map: [],
    mapW: 0,
    mapH: 0,
    timbresRest: 1,
    delivered: 0,
    lastPushDir: { x: 1, y: 0 },
    carry: null,      // <- lo que llevas en la mano (pastilla)
    cycleSeconds: 0
  };
  window.G = G; // (expuesto)
  // Control de respawn diferido (solo al morir)
  const SPAWN = {
    max: BALANCE.enemies.mosquito.max,
    cooldown: rngRange(
      BALANCE.enemies.mosquito.respawnDelayMin,
      BALANCE.enemies.mosquito.respawnDelayMax
    ),
    pending: 0,
    t: 0
  };

  // Canvas principal + fog + HUD (capas independientes)
  const canvas    = document.getElementById('gameCanvas');
  const ctx       = canvas.getContext('2d');
  const fogCanvas = document.getElementById('fogCanvas');
  const hudCanvas = document.getElementById('hudCanvas');
  const hudCtx    = hudCanvas.getContext('2d');

  window.DEBUG_POPULATE = window.DEBUG_POPULATE || { LOG:false, VERBOSE:false };
  // SkyFX listo desde el menú (antes de startGame)
  window.SkyFX?.init?.({
    canvas,
    getCamera: () => ({ x: camera.x, y: camera.y, zoom: camera.zoom }),
    getMapAABB: () => ({ x: 0, y: 0, w: G.mapW * TILE, h: G.mapH * TILE }),
    worldToScreen: (x, y) => ({
      x: (x - camera.x) * camera.zoom + VIEW_W * 0.5,
      y: (y - camera.y) * camera.zoom + VIEW_H * 0.5
    })
  });
  if (fogCanvas){ fogCanvas.width = VIEW_W; fogCanvas.height = VIEW_H; }
  if (hudCanvas){ hudCanvas.width = VIEW_W; hudCanvas.height = VIEW_H; }

  // === Sprites (plugin unificado) ===
  Sprites.init({ basePath: './assets/images/', tile: TILE });
  Sprites.preload && Sprites.preload();
  // --- INIT de sistemas que pueblan enemigos (antes de los placements) ---
  try { window.MosquitoAPI && MosquitoAPI.init(window.G); } catch(e){}
  try { window.RatsAPI && RatsAPI.init(window.G); } catch(e){}
  // (si tienes otro sistema parecido, inícialo aquí también)

  // === Luces + Niebla ===
  if (window.LightingAPI){
    LightingAPI.init({ gameCanvasId:'gameCanvas', containerId:'game-container', rays:96 });
    LightingAPI.setEnabled(true);
    LightingAPI.setGlobalAmbient(0.35); // luz ambiente leve por si quieres tono cálido
  }
  if (window.FogAPI){
    FogAPI.init({ fogCanvasId:'fogCanvas', gameCanvasId:'gameCanvas' });
    FogAPI.setEnabled(true);
    FogAPI.setSoftness(0.70);
    // 👇 Importante: no fijamos radios aquí. Los pondrá el héroe (Heroes API)
  }


  // Overlays UI (ids reales del index.html)
  const startScreen = document.getElementById('start-screen');
  const pausedScreen = document.getElementById('pause-screen');
  const levelCompleteScreen = document.getElementById('level-complete-screen');
  const gameOverScreen = document.getElementById('game-over-screen');

  // ---- Construye desglose de puntuación para el scoreboard ---------------
  function buildLevelBreakdown(){
    // Si existe ScoreAPI con breakdown, lo usamos. Si no, mostramos un único renglón.
    const totals = (window.ScoreAPI && typeof ScoreAPI.getTotals === 'function')
      ? ScoreAPI.getTotals() : { total: 0, breakdown: [] };

    // Adaptamos {reason/label, pts/points} a {label, points}
    if (Array.isArray(totals.breakdown) && totals.breakdown.length) {
      return totals.breakdown.map(r => ({
        label: r.label || r.reason || 'Puntos',
        points: Number(r.points ?? r.pts ?? 0)
      }));
    }
    // Fallback mínimo
    return [{ label: 'Puntos del nivel', points: Number(totals.total || 0) }];
  }
  // --- Selección de héroe en el menú ---
  (function setupHeroSelection(){
    const cards = document.querySelectorAll('#start-screen .char-card');
    if (!cards.length) return;

    // Estado inicial: lo que esté marcado con .selected en el HTML
    const selInit = document.querySelector('#start-screen .char-card.selected');
    window.G = window.G || {};
    window.selectedHeroKey = (selInit?.dataset?.hero || 'enrique').toLowerCase();
    G.selectedHero = window.selectedHeroKey;

    // Al hacer clic en una tarjeta: marcar visualmente y guardar clave
    cards.forEach(btn => {
      btn.addEventListener('click', () => {
        cards.forEach(b => { b.classList.remove('selected'); b.setAttribute('aria-selected','false'); });
        btn.classList.add('selected');
        btn.setAttribute('aria-selected','true');
        const hero = (btn.dataset.hero || 'enrique').toLowerCase();
        window.selectedHeroKey = hero;
        window.G.selectedHero = hero;
      });
    });

    // Al pulsar "Empezar turno", asegúrate de tener una clave
    document.getElementById('start-button')?.addEventListener('click', () => {
      if (!window.selectedHeroKey) {
        const first = document.querySelector('#start-screen .char-card[data-hero]');
        window.selectedHeroKey = (first?.dataset?.hero || 'enrique').toLowerCase();
        window.G.selectedHero = window.selectedHeroKey;
      }
    });
  })();
  const metrics = document.getElementById('metricsOverlay') || document.createElement('pre'); // por si no existe

  // Cámara
  const camera = { x: 0, y: 0, zoom: 0.45 }; // ⬅️ arranca ya alejado

  // RNG simple (semilla fija por demo)
  function mulberry32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
  let RNG = mulberry32(0xC0FFEE);
  function rngRange(a,b){ return a + Math.random()*(b-a); }


// === INPUT CORE (único, sin duplicados) ===
const keys = Object.create(null);
function __preventNavKeys__(k, e){
  if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault();
}
function __clearAllKeys__(){ for (const k in keys) keys[k] = false; }

function __onKeyUp__(e){
  try {
    const k = e.key.toLowerCase();
    keys[k] = false;
    __preventNavKeys__(k, e);
  } catch(err){
    console.warn('[INPUT] keyup error:', err);
  }
}

function __onKeyDown__(e){
  try{
    const k = e.key.toLowerCase();
    const code = e.code;

    // Escudo: si el juego está en curso, no dejes que otras capas capten la tecla
    if (window.G?.state === 'PLAYING') {
      e.stopPropagation();
      e.stopImmediatePropagation?.();
    }

    keys[k] = true;
    __preventNavKeys__(k, e);

    // === Atajos comunes ===
    if (k === '0'){ e.preventDefault(); fitCameraToMap(); }
    if (k === 'q'){ window.camera.zoom = clamp(window.camera.zoom - 0.1, 0.6, 2.5); }
    if (k === 'r'){
      if (G.state === 'GAMEOVER' || G.state === 'COMPLETE'){
        e.preventDefault();
        try { PresentationAPI.levelIntro(G.level || 1, () => startGame()); }
        catch(_){ startGame(); }
        return;
      }else{
        window.camera.zoom = clamp(window.camera.zoom + 0.1, 0.6, 2.5);
      }
    }
    if (k === 'f1'){ e.preventDefault(); metrics.style.display = (metrics.style.display === 'none' ? 'block' : 'none'); }
    if (k === 'escape'){ togglePause(); }

    // === Clima/Fog — protegidas con try/catch ===
    if (code === 'Digit1'){ e.preventDefault(); try{ SkyFX?.setLevel?.(1); FogAPI?.setEnabled?.(true); FogAPI?.setDarkness?.(0); if (window.DEBUG_FORCE_ASCII) console.log('[Key1] Día'); }catch(err){ console.warn('[Key1] error:', err); } }
    if (code === 'Digit2'){ e.preventDefault(); try{ SkyFX?.setLevel?.(2); FogAPI?.setEnabled?.(true); FogAPI?.setDarkness?.(1); if (window.DEBUG_FORCE_ASCII) console.log('[Key2] Noche'); }catch(err){ console.warn('[Key2] error:', err); } }
    if (code === 'Digit3'){ e.preventDefault(); try{ SkyFX?.setLevel?.(3); FogAPI?.setEnabled?.(true); FogAPI?.setDarkness?.(1); if (window.DEBUG_FORCE_ASCII) console.log('[Key3] Tormenta'); }catch(err){ console.warn('[Key3] error:', err); } }
    if (code === 'Digit4'){ // Sólo alterna FOW, NUNCA salir del juego
      e.preventDefault();
      try{
        const next = !(window.FogAPI && FogAPI._enabled);
        FogAPI?.setEnabled?.(next);
        if (window.DEBUG_FORCE_ASCII) console.log('[Key4] FOW', next ? 'ON' : 'OFF');
      }catch(err){ console.warn('[Key4] error:', err); }
      return; // <- no dejes que nada más maneje esta tecla
    }
    if (code === 'Digit5'){ e.preventDefault(); try{ window.ArrowGuide?.setEnabled?.(!window.ArrowGuide?.enabled); if (window.DEBUG_FORCE_ASCII) console.log('[Key5] ArrowGuide toggled'); }catch(err){ console.warn('[Key5] error:', err); } }

  }catch(err){
    console.warn('[INPUT] keydown error:', err);
  }
}

// Registro ÚNICO en captura (bloquea otras capas)
document.removeEventListener('keydown', __onKeyDown__, true);
document.removeEventListener('keyup', __onKeyUp__, true);
document.addEventListener('keydown', __onKeyDown__, { capture:true });
document.addEventListener('keyup',   __onKeyUp__,   { capture:true });
window.addEventListener('blur', __clearAllKeys__);

// Acción con E (usar/empujar) — también en captura
document.addEventListener('keydown', (e)=>{
  if (e.key.toLowerCase() === 'e'){ e.preventDefault(); doAction(); }
}, { capture:true });




  // si la ventana pierde el foco, vaciamos todas las teclas
  window.addEventListener('blur', () => {
    for (const key in keys) keys[key] = false;
  });
  
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dz = e.deltaY > 0 ? -0.1 : 0.1;
    camera.zoom = clamp(camera.zoom + dz, 0.25, 3.0);
  }, { passive: false });

  function fitCameraToMap(padding = 0.95){
    const W = G.mapW * TILE, H = G.mapH * TILE;
    if (!W || !H) return;
    const zx = VIEW_W / W, zy = VIEW_H / H;
    camera.zoom = Math.max(0.1, Math.min(zx, zy) * padding);
    camera.x = W * 0.5; 
    camera.y = H * 0.5;
  }

  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

  // Offscreens para composición (escena nítida y desenfocada)
  const sceneCanvas = document.createElement('canvas');
  const sceneCtx = sceneCanvas.getContext('2d');
  const blurCanvas = document.createElement('canvas');
  const blurCtx = blurCanvas.getContext('2d');

  function ensureBuffers(){
    if (sceneCanvas.width !== VIEW_W || sceneCanvas.height !== VIEW_H) {
      sceneCanvas.width = VIEW_W; sceneCanvas.height = VIEW_H;
      blurCanvas.width = VIEW_W; blurCanvas.height = VIEW_H;
    }
  }

  // ------------------------------------------------------------
  // Mapa ASCII — leyenda completa (usa placement.api.js)
  // S: spawn del héroe
  // P: paciente encamado
  // I: pastilla vinculada al paciente (target = primer P si no se indica)
  // D: puerta boss cerrada (se abre al terminar pacientes normales)
  // X: boss (inmóvil)
  // C: carro de urgencias (1º ER, 2º MED, resto FOOD)
  // M: spawner de mosquito (tiles)
  // R: spawner de rata (tiles)
  // m: enemigo directo mosquito (px)
  // r: enemigo directo rata (px)
  // E: ascensor
  // H: NPC médico    | U: supervisora | T: TCAE
  // G: guardia       | F: familiar    | N: enfermera sexy
  // L: luz de sala
  // #: pared  · .: suelo
  // ------------------------------------------------------------
    // Mapa por defecto (inmutable)
    const DEFAULT_ASCII_MAP = [
    "##############################",
    "#............m...............#",
    "#....####............####....#",
    "#......S#....P.I#....#X.#....#",
    "#....#..#.......#....#..D....#",
    "#....####....C..#....####....#",
    "#...............#............#",
    "#...............#............#",
    "#............####............#",
    "#............#..#............#",
    "#..............r#............#",
    "#............####............#",
    "##############################",
    ];
    // --- Flags globales de modo mapa ---
    (function () {
      const q = new URLSearchParams(location.search);
      const m = (q.get('map') || '').toLowerCase();
      window.__MAP_MODE = m;                 // para compatibilidad con código viejo
      window.DEBUG_FORCE_ASCII = (m === 'debug' || m === 'mini' || m === 'ascii');
      window.DEBUG_MINIMAP   = (m === 'mini') || /(?:\?|&)mini=(?:1|true)\b/i.test(location.search);
      window.G = window.G || {};
      G.flags = G.flags || {};
      G.flags.DEBUG_FORCE_ASCII = window.DEBUG_FORCE_ASCII;
    })();

    // Mapa ASCII mini (para pruebas rápidas con ?map=mini)
    const DEBUG_ASCII_MINI = DEFAULT_ASCII_MAP;

  // --- selector de mapa por URL ---
  // ?map=debug  → fuerza el mapa ASCII de arriba
  // ?map=normal → usa el generador (MapGen)
  // ?mini=1     → mini map de debug encendido


  // --- selector de mapa por URL (banderas globales) ---
  (function(){
    const raw = (location.search || '').toLowerCase();
    const q   = new URLSearchParams(location.search);

    // Forzar ASCII si ?map=debug, ?map=mini o ?map=ascii
    window.DEBUG_FORCE_ASCII =
      (q.get('map') === 'debug' || q.get('map') === 'mini' || q.get('map') === 'ascii');

    // Mostrar mini-mapa si ?map=mini o ?mini=1|true
    window.DEBUG_MINIMAP =
      (q.get('map') === 'mini' || q.get('mini') === '1' || q.get('mini') === 'true');

    // Copiar banderas en G.flags (por si otros ficheros las usan)
    window.G = window.G || {};
    G.flags = G.flags || {};
    G.flags.DEBUG_FORCE_ASCII = !!window.DEBUG_FORCE_ASCII;
    G.flags.DEBUG_MINIMAP    = !!window.DEBUG_MINIMAP;
  })();


// Mapa activo (se puede sustituir por el de MapGen)
let ASCII_MAP = DEFAULT_ASCII_MAP.slice();

  // ------------------------------------------------------------
  // Creación de entidades
  // ------------------------------------------------------------
  // === Defaults de física por tipo (fallback si el spawn no los pasa) ===
  const PHYS_DEFAULTS = {};
  PHYS_DEFAULTS[ENT.PLAYER]   = { mass: 1.00, rest: 0.10, mu: 0.12 };
  PHYS_DEFAULTS[ENT.MOSQUITO] = { mass: 0.08, rest: 0.05, mu: 0.12 };
  PHYS_DEFAULTS[ENT.RAT]      = { mass: 0.12, rest: 0.08, mu: 0.12 };
  PHYS_DEFAULTS[ENT.CART]     = { mass: 6.00, rest: 0.65, mu: 0.06 };
  PHYS_DEFAULTS[ENT.BED]      = { mass: 4.00, rest: 0.25, mu: 0.08 };
  PHYS_DEFAULTS[ENT.PATIENT]  = { mass: 1.00, rest: 0.10, mu: 0.12 };
  PHYS_DEFAULTS[ENT.BOSS]     = { mass: 8.00, rest: 0.20, mu: 0.10 };
  PHYS_DEFAULTS[ENT.DOOR]     = { mass: 0.00, rest: 0.00, mu: 0.00 }; // estática

  function makeRect(
    x, y, w, h,
    kind, color,
    pushable = false, solid = false,
    opts = {}
  ){
    const e = {
      x, y, w, h, kind, color,
      pushable, solid,
      vx: 0, vy: 0,
      bouncy: false,
      static: !!opts.static
    };
    // Física base por tipo (fallback)…
    const def = {
      mass: (typeof massFor === 'function') ? massFor(kind) : 1,
      rest: (typeof restitutionFor === 'function') ? restitutionFor(kind) : 0.1,
      mu:   (typeof frictionFor === 'function') ? frictionFor(kind) : 0.12,
    };
    // …pero **deja que el spawn lo sobreescriba**
    e.mass = (opts.mass ?? def.mass);
    e.rest = (opts.rest ?? def.rest);
    e.mu   = (opts.mu   ?? def.mu);
    e.invMass = e.mass > 0 ? 1 / e.mass : 0;
    return e;
  }

  function makePlayer(x, y) {
    // Lee la selección (si no la hay, cae en 'enrique')
    const key =
      (window.selectedHeroKey) ||
      ((window.G && G.selectedHero) ? G.selectedHero : null) ||
      'enrique';

    // Camino correcto: usa la API de héroes (aplica corazones y stats)
    if (window.Entities?.Hero?.spawnPlayer) {
      const p = window.Entities.Hero.spawnPlayer(x, y, { skin: key });
      // 🛡️ Defaults “sanos” si la skin no los define:
      p.mass     = (p.mass     != null) ? p.mass     : 1.00;
      p.rest     = (p.rest     != null) ? p.rest     : 0.10;
      p.mu       = (p.mu       != null) ? p.mu       : 0.12;
      p.maxSpeed = (p.maxSpeed != null) ? p.maxSpeed : (BALANCE.physics.maxSpeedPlayer || 165);
      p.accel    = (p.accel    != null) ? p.accel    : 800;
      p.pushForce= (p.pushForce!= null) ? p.pushForce: FORCE_PLAYER;
      p.facing   = p.facing || 'S';

      // === Giro más sensible por defecto ===
      p.turnSpeed = (p.turnSpeed != null) ? p.turnSpeed : 4.5;
      p.lookAngle = (typeof p.lookAngle === 'number')
        ? p.lookAngle
        : (p.facing === 'E' ? 0 :
           p.facing === 'S' ? Math.PI/2 :
           p.facing === 'W' ? Math.PI : -Math.PI/2);

      G.player = p;
      return p;
    }

    // Fallback de emergencia (por si faltara la API)
    const p = makeRect(x, y, TILE * 0.8, TILE * 0.8, ENT.PLAYER, COLORS.player, false);
    p.speed = 4.0;
    p.pushForce = FORCE_PLAYER;
    p.invuln = 0;
    p.facing = 'S';
    p.pushAnimT = 0;
    p.skin = key;

    // === Giro más sensible por defecto ===
    p.turnSpeed = 4.5;
    p.lookAngle = Math.PI / 2; // SUR
    // Asegura corazones mínimos si no hay API
    p.hp = p.hp || 3;
    p.hpMax = p.hpMax || 3;
    return p;
  }
  // --------- Spawn de mosquito (enemigo básico) ----------
  function spawnMosquito(x, y) {
    const e = makeRect(
      x - TILE*0.3, y - TILE*0.3,
      TILE*0.6, TILE*0.6,
      ENT.MOSQUITO, COLORS.mosquito,
      false,     // pushable
      true,      // sólido
      { mass: 0.08, rest: 0.05, mu: 0.12 }
    );
    e.t = 0; e.vx = 0; e.vy = 0;
    e.bouncy = false;
    e.static = false;
    G.entities.push(e);
    G.enemies.push(e);
    return e;
    if (window.Physics && typeof Physics.registerEntity === 'function') Physics.registerEntity(e);
  }

  function loadLevelWithMapGen(level=1) {
    if (!window.MapGen) return false;            // fallback al ASCII si no está el plugin

    // Tamaños por nivel (ajústalos si quieres)
    const dims = (level===1) ? {w:60,h:40}
                : (level===2) ? {w:120,h:80}
                :               {w:180,h:120};

    // Limpieza de estado como haces al cargar ASCII
    G.entities = []; G.movers = []; G.enemies = []; G.npcs = [];
    G.patients = []; G.pills = []; G.map = []; G.mapW = dims.w; G.mapH = dims.h;
    G.player = null; G.cart = null; G.door = null; G.boss = null;

    MapGen.init(G);                               // vincula el estado del juego
    const res = MapGen.generate({
      w: dims.w, h: dims.h, level,
      seed: Date.now(),                           // o un seed fijo si quieres reproducible
      place: true,                                // que coloque entidades vía callbacks
      callbacks: {
        placePlayer: (tx,ty) => {
          const key = (window.selectedHeroKey || (window.G && G.selectedHero) || null);
          const p =
            (window.Entities?.Hero?.spawnPlayer?.(tx*TILE+4, ty*TILE+4, { skin: key })) ||
            makePlayer(tx*TILE+4, ty*TILE+4);
          G.player = p;
          if (!G.entities.includes(p)) G.entities.push(p);
        },
        placeDoor: (tx,ty,opts={})=>{
          const e = makeRect(tx*TILE+6, ty*TILE+4, TILE, TILE,
                            ENT.DOOR, COLORS.doorClosed, false, true,
                            {mass:0, rest:0, mu:0, static:true});
          G.entities.push(e); G.door = e;
        },
        placeBoss: (kind,tx,ty)=>{
          const b = makeRect(tx*TILE+8, ty*TILE+8, TILE*1.2, TILE*1.2,
                            ENT.BOSS, COLORS.boss, false, true,
                            {mass:8, rest:0.1, mu:0.1, static:true});
          G.entities.push(b); G.boss = b;
        },
        placeEnemy: (kind,tx,ty)=>{
          if (kind==='mosquito') spawnMosquito(tx*TILE+TILE/2, ty*TILE+TILE/2);
          // añade aquí más tipos si MapGen los emite (ratas, etc.)
        },
        placeSpawner: (kind,tx,ty)=>{
          // si usas spawners, guarda sus coords para tus sistemas
          if (kind==='mosquito') G.mosquitoSpawn = {x:tx*TILE+TILE/2, y:ty*TILE+TILE/2, t:0, n:0};
        },
        placeNPC: (kind,tx,ty)=>{ /* según tus factories existentes */ },
        placeElevator: (tx,ty)=>{ /* si tienes elevators.plugin */ },
        placePatient: (tx,ty,opts)=>{ /* makePatient + timbre si lo usas aquí */ },
        placeBell: (tx,ty)=>{ /* crear timbre suelto */ }
      }
    });

    // Establece el mapa sólido para colisiones
    G.map   = res.map;             // matriz 0/1
    G.mapW  = res.width;
    G.mapH  = res.height;

    return true;
  }



// -------------------------------------------------------------------------------------------
// Función NUCLEO - Parseo mapa + colocación base (may/min OK, sin duplicar con placements)
// -------------------------------------------------------------------------------------------


 // === Parser ASCII → grid de colisiones (sin instanciar entidades) ===



  function parseMap(lines){
    // === Reset de listas (como la antigua, estable) ===
    G.entities.length = 0;
    G.movers.length = 0;
    G.enemies.length = 0;
    G.patients.length = 0;
    G.pills.length = 0;
    G.npcs.length = 0;
    G.lights.length = 0;
    G.roomLights.length = 0;

    // === Constantes / fallback ===
    // Importante: NO redefinimos el TILE del motor aquí (evita la TDZ).
    // Usamos el valor global expuesto por el motor: window.TILE_SIZE (o window.TILE como compat),
    // y como último recurso 32.
    const TILE = (typeof window !== 'undefined' && (window.TILE_SIZE || window.TILE)) || 32;

    // === Validación mínima de entrada ===
    if (!Array.isArray(lines) || !lines.length){
      G.mapH = 1; G.mapW = 1;
      G.map = [[0]];
      // No colocamos nada más para no romper.
      return;
    }

    // === Tamaño y buffer de mapa ===
    G.mapH = lines.length;
    G.mapW = lines[0].length;
    G.map = [];

    // Recogeremos aquí los placements derivados del ASCII (en píxeles)
    const asciiPlacements = [];
    // Guarda referencia global para applyPlacementsFromMapgen
    G.__asciiPlacements = asciiPlacements;

    for (let y = 0; y < G.mapH; y++){
      const row = [];
      const line = lines[y] || '';
      for (let x = 0; x < G.mapW; x++){
        const ch = line[x] || ' ';
        const wx = x * TILE, wy = y * TILE;

        // pared/espacio (igual que la antigua)
        if (ch === '#') { row.push(1); } else { row.push(0); }

        // === MARCAS ASCII ===
        if (ch === 'S') {
          // HÉROE: se crea INMEDIATO como antes (no depende de factories)
          const p = (typeof makePlayer === 'function')
            ? makePlayer(wx+4, wy+4)
            : (window.Entities?.Hero?.spawnPlayer?.(wx+4, wy+4, {}) || null);

          if (p){
            G.player = p; G.entities.push(p);
            // sala segura (5x5 tiles centrados en S)
            G.safeRect = { x: wx - 2*TILE, y: wy - 2*TILE, w: 5*TILE, h: 5*TILE };
            // luz blanca suave en sala de control
            G.roomLights.push({ x: (p.x||wx)+TILE/2, y: (p.y||wy)+TILE/2, r: 5.5*TILE, baseA: 0.28 });
          }
        }
        else if (ch === 'P') {
          // Paciente: placement (NO instanciamos aquí)
          asciiPlacements.push({ type:'patient', x: wx+4, y: wy+4, _units:'px' });
          // luz clara de sala (igual que antigua)
          G.roomLights.push({ x: wx+TILE/2, y: wy+TILE/2, r: 5.0*TILE, baseA: 0.25 });
        }
        else if (ch === 'I') {
          asciiPlacements.push({ type:'pill', x: wx+8, y: wy+8, _units:'px' });
        }
        else if (ch === 'C') {
          // Orden debug: 1º ER, 2º MED, 3º+ FOOD
          window.G = window.G || {};
          const n = (G._debugCartCount = (G._debugCartCount|0) + 1);
          const sub = (n === 1) ? 'er' : (n === 2 ? 'med' : 'food');
          asciiPlacements.push({ type:'cart', sub, x: wx+6, y: wy+8, _units:'px' });
        }
        else if (ch === 'M') {
          // Spawner mosquito: SOLO lo apuntamos (si lo apagas en debug/HTML no romperá)
          asciiPlacements.push({ type:'spawn_mosquito', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'R') {
          asciiPlacements.push({ type:'spawn_rat', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'D') {
          asciiPlacements.push({ type:'door', x: wx, y: wy, locked:true, _units:'px' });
        }
        else if (ch === 'X') {
          asciiPlacements.push({ type:'boss', x: wx+TILE/2, y: wy+TILE/2, _units:'px', tier:1 });
        }
        else if (ch === 'L') {
          asciiPlacements.push({ type:'light', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'm') { // enemigo directo: mosquito
          asciiPlacements.push({ type:'enemy', sub:'mosquito', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'r') { // enemigo directo: rata
          asciiPlacements.push({ type:'enemy', sub:'rat', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'E') { // ascensor activo
          asciiPlacements.push({ type:'elevator', active:true, x: wx, y: wy, _units:'px' });
        }
        else if (ch === 'H') { // NPC: médico
          asciiPlacements.push({ type:'npc', sub:'medico', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'U') { // NPC: supervisora
          asciiPlacements.push({ type:'npc', sub:'supervisora', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'T') { // NPC: tcae
          asciiPlacements.push({ type:'npc', sub:'tcae', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'G') { // NPC: guardia
          asciiPlacements.push({ type:'npc', sub:'guardia', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'F') { // NPC: familiar molesto
          asciiPlacements.push({ type:'npc', sub:'familiar', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'N') { // NPC: enfermera sexy
          asciiPlacements.push({ type:'npc', sub:'enfermera_sexy', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'L') { // luz de sala
          asciiPlacements.push({ type:'light', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        // Si añades más letras ASCII, convierte aquí a placements (en píxeles).
      }
      G.map.push(row);
    }

    // Mezclamos con placements del generador (si ya existían)
    // ========== DEBUG ASCII (mini) ==========
    try {
      // Guardar placements para usarlos en startGame cuando se autorice
      window.G = window.G || {};
      G.__asciiPlacements = asciiPlacements;
      // Señala que se está usando ASCII pero NO instanciamos aquí
      G.flags = G.flags || {};
      G.flags.DEBUG_FORCE_ASCII = true;
      G.usedMapASCII = true;

      // limpiar autorización
      G.__allowASCIIPlacements = false; delete G.__allowASCIIPlacements;
    } catch(_){}
    // =======================================

    // Fallback por si el mapa no trae 'S' (igual que la antigua)
    if (!G.player) {
      const p = (typeof makePlayer === 'function')
        ? makePlayer(TILE*2, TILE*2)
        : (window.Entities?.Hero?.spawnPlayer?.(TILE*2, TILE*2, {}) || null);
      if (p){ G.player = p; G.entities.push(p); }
    }
  }






///////////////////////////////////////////////////////////////////////////








  function initSpawnersForLevel(){
    G.spawners = [];
    if (G.mosquitoSpawn){
      G.spawners.push({
        kind: 'mosquito',
        x: G.mosquitoSpawn.x,
        y: G.mosquitoSpawn.y,
        cooldown: rngRange(
          BALANCE.enemies.mosquito.respawnDelayMin,
          BALANCE.enemies.mosquito.respawnDelayMax
        ),
        t: 0
      });
      // 1º mosquito inicial del nivel (solo uno)
      spawnMosquito(G.mosquitoSpawn.x, G.mosquitoSpawn.y);
    }
  }

  // ------------------------------------------------------------
  // Collisiones por tiles
  // ------------------------------------------------------------
  function inBounds(tx, ty){
    return tx>=0 && ty>=0 && tx<G.mapW && ty<G.mapH;
  }
  function isWallAt(px, py, w, h){
    const x1 = Math.floor(px / TILE);
    const y1 = Math.floor(py / TILE);
    const x2 = Math.floor((px+w) / TILE);
    const y2 = Math.floor((py+h) / TILE);
    if (!inBounds(x1,y1) || !inBounds(x2,y2)) return true;
    return G.map[y1][x1]===1 || G.map[y1][x2]===1 || G.map[y2][x1]===1 || G.map[y2][x2]===1;
  }
  window.isWallAt = isWallAt; // contrato

  // === Física: tablas por entidad ===
  function massFor(kind){
    switch(kind){
      case ENT.PLAYER:    return 1.0;
      case ENT.MOSQUITO:  return 0.08; // muy ligero -> no empuja al héroe
      case ENT.RAT:       return 0.12;
      case ENT.CART:      return 6.0;  // carro pesado
      case ENT.BED:       return 4.0;
      case ENT.PATIENT:   return 1.0;
      case ENT.BOSS:      return 8.0;
      default:            return 1.0;
    }
  }
  function restitutionFor(kind){
    switch(kind){
      case ENT.CART:      return 0.35; // rebote “billar” suave
      case ENT.BED:       return 0.25;
      case ENT.MOSQUITO:  return 0.05;
      default:            return 0.10;
    }
  }
  function frictionFor(kind){
    // coeficiente “mu” (0..1) -> lo transformamos a factor más abajo
    switch(kind){
      case ENT.CART:      return 0.06;
      case ENT.BED:       return 0.08;
      default:            return 0.12;
    }
  }

  // ------------------------------------------------------------
  // Física con subpasos y empuje “Rompers”
  // ------------------------------------------------------------
  


  // Enrutadores de compatibilidad: mismas firmas, pero delegan en el plugin
  const moveWithCollisions   = (e, dt) => Physics.moveWithCollisions(e, dt);
  const resolveAgainstSolids = (e)     => Physics.resolveAgainstSolids(e);
  const resolveEntityPairs   = (dt)    => Physics.resolveEntityPairs(dt);
  const snapInsideMap        = (e)     => Physics.snapInsideMap(e);

  // (opcional) expón también en window por si algún script viejo los mira ahí
  window.moveWithCollisions   = moveWithCollisions;
  window.resolveAgainstSolids = resolveAgainstSolids;
  window.resolveEntityPairs   = resolveEntityPairs;
  window.snapInsideMap        = snapInsideMap;

  function AABB(a,b){ return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y; }
  // Toca/roza con margen (sirve para "contacto" aunque la física los separe)
  // IDs simples para vincular pill → patient
  let NEXT_ID = 1;
  const uid = () => NEXT_ID++;

  // "Contacto" con margen (sirve para entregar sin tener que solaparse)
  function nearAABB(a, b, m = 10) {
    return (
      a.x < b.x + b.w + m &&
      a.x + a.w > b.x - m &&
      a.y < b.y + b.h + m &&
      a.y + a.h > b.y - m
    );
  }
  window.AABB = AABB;
  
  function killEnemy(e, meta){
      if (e.dead) return;
      e.dead = true;
      if (window.ScoreAPI){ try{ ScoreAPI.awardForDeath(e, Object.assign({cause:'killEnemy'}, meta||{})); }catch(_){} }
    // saca de las listas
    G.enemies = G.enemies.filter(x => x !== e);
    G.entities = G.entities.filter(x => x !== e);
    // notificar respawn diferido
    SPAWN.pending = Math.min(SPAWN.pending + 1, SPAWN.max);
    // Planificar respawn si hay spawner de este tipo
    if (e.kind === ENT.MOSQUITO && Array.isArray(G.spawners)){
      const s = G.spawners.find(s => s.kind === 'mosquito');
      if (s) { s.t = s.cooldown; }  // arranca cooldown
    }
  }

  function killEntityGeneric(e, meta){
    if (!e || e.dead) return;
    e.dead = true;
    if (window.ScoreAPI){ try{ ScoreAPI.awardForDeath(e, Object.assign({cause:'killEntityGeneric'}, meta||{})); }catch(_){} }

    // quítalo de todas las listas donde pueda estar
    G.entities = G.entities.filter(x => x !== e);
    G.movers   = G.movers.filter(x => x !== e);
    G.enemies  = G.enemies.filter(x => x !== e);
    G.npcs     = G.npcs.filter(x => x !== e);
    G.patients = G.patients.filter(x => x !== e);

    // si era enemigo “con vida”, respawn por su sistema
    if (e.kind === ENT.MOSQUITO) {
      SPAWN.pending = Math.min(SPAWN.pending + 1, SPAWN.max);
    }
  }

  // Cualquier enemigo o NPC que toque un CARRO en movimiento muere instantáneo.
  // Al jugador le hace daño según velocidad; puertas/estáticos no mueren.
  function cartImpactDamage(a, b){
    const cart = (a.kind === ENT.CART) ? a : (b.kind === ENT.CART ? b : null);
    if (!cart) return;

    const other = (cart === a) ? b : a;

    // velocidad del carro y relativa
    const spdC  = Math.hypot(cart.vx || 0, cart.vy || 0);
    const rel   = Math.hypot((cart.vx||0)-(other.vx||0), (cart.vy||0)-(other.vy||0));
    const nearWall = isWallAt(other.x-1, other.y-1, other.w+2, other.h+2);

    // umbrales
    const MIN_ENEMY_KILL_SPEED  = 6;   // “mínimo”: toca y muere
    const MIN_PLAYER_HURT_SPEED = 22;  // héroe no sufre si el carro casi parado

    // parado de verdad -> NO hace nada
    if (spdC <= 0.01 && rel <= 0.01 && !nearWall) return;

    // HÉROE: daño progresivo según velocidad
    if (other.kind === ENT.PLAYER){
      if (spdC > MIN_PLAYER_HURT_SPEED || rel > MIN_PLAYER_HURT_SPEED){
        if (rel > 360) { damagePlayer(cart, 6); return; } // golpe brutal
        if (rel > 240) { damagePlayer(cart, 2); return; } // fuerte
        if (rel > 120) { damagePlayer(cart, 1); return; } // leve
      }
      return;
    }

    // estáticos que NO se matan
    if (other.kind === ENT.DOOR || other.static) return;

    // ENEMIGOS / NPC: con movimiento mínimo o arrinconados -> MUEREN SIEMPRE
    if (spdC > MIN_ENEMY_KILL_SPEED || rel > MIN_ENEMY_KILL_SPEED || nearWall){
    const meta = {
      via:'cart',
      impactSpeed: Math.max(spdC, rel),
      killerTag: (cart._lastPushedBy || null),
      killerId:  (cart._lastPushedId || null),
      killerRef: (cart._pushedByEnt || cart._grabbedBy || null)
    };
    if (other.kind === ENT.MOSQUITO) killEnemy(other, meta);
    else                             killEntityGeneric(other, meta);
    }
  }

  function resolveOverlapPush(e, o){
    // separa a 'e' del sólido 'o' por el eje de mínima penetración
    const ax1 = e.x, ay1 = e.y, ax2 = e.x + e.w, ay2 = e.y + e.h;
    const bx1 = o.x, by1 = o.y, bx2 = o.x + o.w, by2 = o.y + o.h;
    const overlapX = (ax2 - bx1 < bx2 - ax1) ? ax2 - bx1 : -(bx2 - ax1);
    const overlapY = (ay2 - by1 < by2 - ay1) ? ay2 - by1 : -(by2 - ay1);

    if (Math.abs(overlapX) < Math.abs(overlapY)){
      e.x -= overlapX;
      if (e.pushable && o.pushable){ // choque entre objetos empujables
        const tmp = e.vx; e.vx = o.vx; o.vx = tmp;
      } else {
        e.vx = 0;
      }
    } else {
      e.y -= overlapY;
      if (e.pushable && o.pushable){
        const tmp = e.vy; e.vy = o.vy; o.vy = tmp;
      } else {
        e.vy = 0;
      }
    }
  }

  function clampOutOfWalls(e){
    // pequeño empujón hacia atrás si quedó tocando pared
    let tries = 8;
    while (tries-- > 0 && isWallAt(e.x, e.y, e.w, e.h)) {
      if (Math.abs(e.vx) > Math.abs(e.vy)) {
        e.x -= Math.sign(e.vx || 1) * 0.5;
      } else {
        e.y -= Math.sign(e.vy || 1) * 0.5;
      }
    }
  }

  // ------------------------------------------------------------
  // Input + empuje
  // ------------------------------------------------------------
  function softFacingFromKeys(p, dx, dy, dt){
    if (!dx && !dy) return;
    const want = Math.atan2(dy, dx);
    if (!isFinite(want)) return;

    const cur = (p.lookAngle ?? want);
    const maxTurn = (p.turnSpeed || 4.5) * dt;

    let diff = ((want - cur + Math.PI) % (2*Math.PI));
    if (diff > Math.PI) diff -= 2*Math.PI;

    const heavy = Math.abs(diff) > 2.7 ? 1.75 : 1.0; // turbo ~180º
    const step = Math.max(-maxTurn*heavy, Math.min(maxTurn*heavy, diff));
    p.lookAngle = cur + step;

    p._facingHold = Math.max(0, (p._facingHold || 0) - dt);
    if (p._facingHold <= 0){
      const ang = p.lookAngle;
      const deg = ang * 180/Math.PI;
      const newCard =
        (deg > -45 && deg <= 45)   ? 'E' :
        (deg > 45  && deg <= 135)  ? 'S' :
        (deg <= -45 && deg > -135) ? 'N' : 'W';
      if (newCard !== p.facing){ p.facing = newCard; p._facingHold = 0.08; }
    }
  }
  
  function handleInput(dt) {
    const p = G.player;
    if (!p) return;

    const R = !!keys['arrowright'], L = !!keys['arrowleft'];
    const D = !!keys['arrowdown'],  U = !!keys['arrowup'];
    let dx = (R ? 1 : 0) - (L ? 1 : 0);
    let dy = (D ? 1 : 0) - (U ? 1 : 0);

    if (window.DEBUG_FORCE_ASCII) {
      // log discreto solo en debug
      //console.log('[INPUT] arrows', {U,D,L,R, dx, dy});
    }

    if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }

    // ROTACIÓN SUAVE DEL CONO (teclado)
    softFacingFromKeys(p, dx, dy, dt);

    // === NUEVO: aceleración y tope de velocidad ===
    const accel = (p.accel != null) ? p.accel
                : (p.speed != null) ? p.speed * 60    // compat viejo
                : 800;                                  // fallback seguro
    const maxSp = (p.maxSpeed != null) ? p.maxSpeed
                : (BALANCE?.physics?.maxSpeedPlayer ?? 165);

    // aplicar aceleración por dt
    p.vx += dx * accel * dt;
    p.vy += dy * accel * dt;

    // limitar velocidad máxima del jugador
    const sp = Math.hypot(p.vx || 0, p.vy || 0);
    if (sp > maxSp) { const s = maxSp / sp; p.vx *= s; p.vy *= s; }

    // --- Anti-atascos en pasillos 1-tile (centrado suave como MouseNav) ---
    (function antiStuckCorridor(){
      const t = TILE; // 32 px
      const pcx = p.x + p.w*0.5, pcy = p.y + p.h*0.5;
      const ptx = (pcx/t)|0, pty = (pcy/t)|0;
      const W = G.mapW, H = G.mapH;
      const isWalk = (x,y)=> x>=0 && y>=0 && x<W && y<H && G.map[y][x]===0;

      // si nos movemos mayormente en X y hay paredes arriba/abajo -> recentra en Y
      if (Math.abs(dx) > Math.abs(dy) && !isWalk(ptx,pty-1) && !isWalk(ptx,pty+1)){
        const cy = pty*t + t*0.5;           // centro del tile en Y
        p.vy += (cy - pcy) * 6.5 * dt;      // fuerza suave hacia el centro
      }
      // si nos movemos mayormente en Y y hay paredes izquierda/derecha -> recentra en X
      if (Math.abs(dy) > Math.abs(dx) && !isWalk(ptx-1,pty) && !isWalk(ptx+1,pty)){
        const cx = ptx*t + t*0.5;           // centro del tile en X
        p.vx += (cx - pcx) * 6.5 * dt;
      }
    })();

    if (dx || dy) G.lastPushDir = { x: Math.sign(dx || 0), y: Math.sign(dy || 0) };
  }

  function doAction() {
    const p = G.player;
    if (!p) return;

    // 1 segundo de anim de empuje
    p.pushAnimT = 1;

    // Dirección desde el facing actual
    const dir = facingDir(p.facing);
    const hit = findPushableInFront(p, dir);
    if (hit) {
      // 1) Desatasco preventivo: si está tocando muro, sácalo o colócalo en un punto libre cercano
      try { if (window.Physics?.snapInsideMap) Physics.snapInsideMap(hit); } catch(_){}
      if (typeof isWallAt === 'function' && isWallAt(hit.x, hit.y, hit.w, hit.h)) {
        // pequeño “paso atrás” de 2px alejándolo del muro antes del empuje
        hit.x -= dir.x * 2;
        hit.y -= dir.y * 2;
      }

      // 2) Empuje normal
      const F = (p.pushForce ?? p.push ?? FORCE_PLAYER);
      const scale = 1 / Math.max(1, (hit.mass || 1) * 0.5); // objetos muy pesados salen menos
      hit.vx += dir.x * F * scale;
      hit.vy += dir.y * F * scale;

      // 3) Marca de autor del empuje (para atribuir kills)
      hit._lastPushedBy   = (p.tag==='follower' ? 'HERO' : 'PLAYER');
      hit._lastPushedId   = p.id || p._nid || p._uid || 'player1';
      hit._pushedByEnt    = p;                // referencia útil si la necesitas
      hit._lastPushedTime = performance.now();
    }
  }

  function damagePlayer(src, amount=1){
    const p = G.player;
    const isRatHit = !!src && (src.kind === ENT.RAT || src.kindName === 'rat');
    if (!p) return;
    if (!isRatHit && p.invuln > 0) return;
    const halvesBefore = Math.max(0, ((G.player?.hp|0) * 2));
    const halvesAfter  = Math.max(0, halvesBefore - (amount|0));
    G.player.hp = Math.ceil(halvesAfter / 2);
    G.health     = halvesAfter;
    p.invuln = (isRatHit ? 0.50 : 1.0); // mordisco de rata: 0,5 s; resto: 1 s

    // knockback desde 'src' hacia fuera
    if (src){
      const dx = (p.x + p.w/2) - (src.x + src.w/2);
      const dy = (p.y + p.h/2) - (src.y + src.h/2);
      const n = Math.hypot(dx,dy) || 1;
      p.vx += (dx/n) * 160;
      p.vy += (dy/n) * 160;
    }

    if (G.health <= 0){
      G.state = 'GAMEOVER';
      gameOverScreen.classList.remove('hidden');
      // Muestra la viñeta animada "GAME OVER" (debajo o encima según zIndex)
      PresentationAPI.gameOver({ mode: 'under' }); // 'under' = deja ver tu texto de "El caos te ha superado"
    }
  }

  function facingDir(f) {
    switch (f) {
      case 'E': return {x: 1, y: 0};
      case 'W': return {x:-1, y: 0};
      case 'S': return {x: 0, y: 1};
      default : return {x: 0, y:-1}; // 'N'
    }
  }

  function findPushableInFront(p, dir) {
    // AABB delante del jugador
    const range = 18;
    const rx = p.x + p.w/2 + dir.x * (p.w/2 + 2);
    const ry = p.y + p.h/2 + dir.y * (p.h/2 + 2);
    const box = { x: rx - (dir.x ? range/2 : p.w/2),
                  y: ry - (dir.y ? range/2 : p.h/2),
                  w: dir.x ? range : p.w,
                  h: dir.y ? range : p.h };

    for (const e of G.movers) {
      if (!e.dead && e.pushable && AABB(box, e)) return e;
    }
    return null;
  }

  // Actualiza TODAS las entidades del juego: enemigos, NPC, carros, puertas, ascensores, etc.
  // - Llama al método update(dt) propio de cada entidad (IA y lógica de contacto).
  // - Gestiona movimiento y colisiones de forma uniforme.
  // - Ejecuta la lógica de respawn desde SpawnerManager (para enemigos, NPC y carros).
  // - Muestra logs de depuración en modo debug (?map=debug).
  // Actualiza TODAS las entidades (IA + física) evitando doble movimiento
function updateEntities(dt){
  const dbg = !!window.DEBUG_FORCE_ASCII;
  // sin lista, no hay nada que hacer
  if (!Array.isArray(G.entities)) return;
  const num = G.entities.length;
  //if (dbg) console.log('[updateEntities] dt:', (dt ?? 0).toFixed(4), 'ents:', num);

  for (const e of G.entities){
    if (!e || e.dead) continue;
    // posición inicial (para detectar saltos bruscos)
    const bx = e.x, by = e.y;

    // 1) IA propia
    if (typeof e.update === 'function'){
      try { e.update(dt); }
      catch(err){
        if (dbg) console.warn('[updateEntities] error update', e.id || e.kindName || e, err);
      }
    }

    // 2) Movimiento y colisiones — lo hace Physics.step(dt). No mover aquí para evitar doble integración.
    // (Dejamos un clamp suave de seguridad sobre la velocidad)
    if (typeof e.vx === 'number' && typeof e.vy === 'number'){
      const LIM = 160;
      e.vx = Math.max(-LIM, Math.min(LIM, e.vx));
      e.vy = Math.max(-LIM, Math.min(LIM, e.vy));
    }

    // 3) Anti‑warp: limita la distancia recorrida en un solo frame
    const dx = e.x - bx, dy = e.y - by;
    const step = Math.hypot(dx, dy);
    // Usa e.maxSpeed si existe, de lo contrario 90 px/s por defecto
    const maxStep = ((typeof e.maxSpeed === 'number' ? e.maxSpeed : 90) * dt * 1.5);
    if (step > maxStep && maxStep > 0){
      const s = maxStep / step;
      e.x = bx + dx * s;
      e.y = by + dy * s;
      if (dbg) console.warn('[updateEntities] CLAMP_WARP', e.id || e.kindName || e.kind, 'step', step.toFixed(3), 'limit', maxStep.toFixed(3));
    }
  }

  // 4) Actualiza spawners (mosquitos, ratas, etc.)
  if (window.SpawnerManager && typeof SpawnerManager.update === 'function'){
    try { SpawnerManager.update(dt); }
    catch(err){ if (dbg) console.warn('[updateEntities] error SpawnerManager.update', err); }
  }
}

  // ------------------------------------------------------------
  // Reglas de juego base (pill→patient→door→boss with cart)
  // ------------------------------------------------------------
  function gameplay(dt){
    // 1) Recoger píldora (ENT.PILL)
    if (!G.carry) {
      for (const e of [...G.entities]) {
        if (e.kind !== ENT.PILL || e.dead) continue;
        if (AABB(G.player, e)) {
          // Vinculada ya en parseMap (targetName o patientName)
          G.carry = { label: e.label, patientName: e.targetName };
          // Quita la píldora del mundo
          G.entities = G.entities.filter(x => x !== e);
          G.movers   = G.movers.filter(x => x !== e);
          break;
        }
      }
    }

    // 2) Entregar al paciente correcto tocándolo (ENT.PATIENT)
    if (G.carry) {
      for (const pac of [...G.patients]) {
        if (pac.dead) continue;
        const esCorrecto = (pac.name === G.carry.patientName);
        if (esCorrecto && nearAABB(G.player, pac, 12)) {
          pac.satisfied = true;
          pac.dead = true;
          pac.solid = false;
          // Elimina paciente del mundo
          G.entities = G.entities.filter(e => e !== pac);
          G.patients = G.patients.filter(e => e !== pac);
          G.npcs     = G.npcs.filter(e => e !== pac);
          // Actualiza HUD
          G.carry = null;
          G.delivered++;
          break;
        }
      }
    }

    // 3) Abrir puerta si ya no quedan pacientes
    if (G.door && G.patients.length === 0) {
      G.door.color = COLORS.doorOpen;
      G.door.solid = false;
    }

    // 4) Victoria: carro de urgencias cerca del boss con puerta abierta
    if (G.door && G.door.color===COLORS.doorOpen && G.cart && G.boss){
      const d = Math.hypot(G.cart.x-G.boss.x, G.cart.y-G.boss.y);
      if (d < TILE*2.2){
        G.state = 'COMPLETE';
        levelCompleteScreen.classList.remove('hidden');

        // Desglose + total (animado estilo Metal Slug) y botón "Ir al siguiente turno"
        const breakdown = buildLevelBreakdown();
        const total = (window.ScoreAPI && typeof ScoreAPI.getTotals === 'function')
          ? (ScoreAPI.getTotals().total || 0)
          : breakdown.reduce((a, r) => a + (r.points|0), 0);

        // Muestra la tarjeta "¡Nivel X completado!" con lista animada y botón
        PresentationAPI.levelComplete((window.G?.level || 1), { breakdown, total }, () => {
          // <<<< AQUÍ LO QUE YA USABAS PARA PASAR DE NIVEL >>>>
          // Si ya tienes una función nextLevel(), úsala:
          if (typeof nextLevel === 'function') { nextLevel(); return; }
          // Fallback sencillito: reinicia el turno actual
          if (typeof startGame === 'function') { startGame(); }
        });

        PresentationAPI.levelComplete(G.level || 1, { breakdown, total }, () => {
          // pasa al siguiente nivel
          nextLevel(); // o GameFlowAPI.nextLevel() si lo usas
        });
      }
    }
  }

    // === Flashlights (héroe + NPCs) con colores por entidad ===
    function flashlightColorFor(e){
      const k = ((e.skin || e.spriteKey || '') + '').toLowerCase();
      if (k.includes('enrique'))   return 'rgba(255,235,90,0.45)';   // amarillo
      if (k.includes('roberto'))   return 'rgba(255,170,90,0.45)';   // naranja cálido
      if (k.includes('francesco')) return 'rgba(80,160,255,0.45)';   // azul frío
      if (e.isNPC || e.kind === ENT.PATIENT) return 'rgba(255,245,170,0.85)'; // cálida suave
      return 'rgba(210,230,255,0.85)'; // neutro
    }

    function updateEntityFlashlights(){
      const list = [];
      const add = (e, fov = Math.PI * 0.55, dist = 620) => {
        const cx = e.x + e.w*0.5, cy = e.y + e.h*0.5;
        const ang = (typeof e.lookAngle === 'number')
          ? e.lookAngle
          : (Math.hypot(e.vx||0, e.vy||0) > 0.01 ? Math.atan2(e.vy||0, e.vx||0) : Math.PI/2);
        list.push({
          x: cx, y: cy, angle: ang,
          fov, dist, color: flashlightColorFor(e), softness: 0.70
        });
      };

      if (G.player && !G.player.dead) {
        const dist = (G.player._flashOuter || 740);   // ← del héroe
        add(G.player, Math.PI * 0.60, dist);
      }
      if (Array.isArray(G.npcs)) {
        for (const npc of G.npcs) { if (npc && !npc.dead) add(npc, Math.PI * 0.50, 520); }
      }
      G.lights = list;

      // Si tu plugin de luces acepta entrada directa
      try { window.LightingAPI?.setFlashlights?.(list); } catch(e){}
    }

  // ------------------------------------------------------------
  // Update principal
  // ------------------------------------------------------------
  function update(dt){
    window.SkyFX?.update?.(dt);
    try { window.ArrowGuide?.update?.(dt); } catch(e){}
    if (G.state !== 'PLAYING' || !G.player) return; // <-- evita tocar nada sin jugador
    G.time += dt;
    G.cycleSeconds += dt;

    // input
    handleInput(dt);
    // sincroniza ángulo continuo con la niebla (si la API lo soporta)
    try { window.FogAPI?.setFacingAngle?.(G.player?.lookAngle || 0); } catch(_) {}
    
    // alimenta al rig con el mismo ángulo (evita “héroe invertido”)
    if (G.player) G.player.facingAngle = G.player.lookAngle || 0;
    
    // jugador
    const p = G.player;
    if (p){
      // Desciende invulnerabilidad con “hard clamp” a cero
      p.invuln = Math.max(0, (p.invuln || 0) - dt);
      if (p.invuln < 0.0005) p.invuln = 0;
      if (p.pushAnimT>0) p.pushAnimT = Math.max(0, p.pushAnimT - dt);
    }

    // Posición del oyente (para paneo/atenuación en SFX posicionales)
    //if (G.player) AudioAPI.setListener(G.player.x + G.player.w/2, G.player.y + G.player.h/2);

    // objetos/movers (camas, carros, pastillas sueltas)
    for (const e of G.movers){
      if (e.dead) continue;
      // clamp velocidad máxima
      const ms = BALANCE.physics.maxSpeedObject;
      const sp = Math.hypot(e.vx, e.vy);
      if (sp>ms){ e.vx = e.vx*(ms/sp); e.vy = e.vy*(ms/sp); }
    }

    // IA enemigos y NPCs
    updateEntities(dt);

    // === paso de física (rebotes, empujes, aplastamientos, etc.)
    Physics.step(dt);

    // Sistemas auxiliares
    Entities?.Elevator?.update?.(dt);
    if (window.MouseNav && window._mouseNavInited) MouseNav.update(dt);
    gameplay(dt);

    // Daño por contacto con enemigos
    if (window.DamageAPI) {
      DamageAPI.update(dt, G.player);
      DamageAPI.tickAttackers(dt, G.entities);
      for (const e of (G.entities || [])) {
        if (!e || e.dead) continue;
        const kind = e.kind;
        const name = (e.kindName || '').toUpperCase();
        if (
          kind === 'RAT' || kind === 'MOSQUITO' ||
          kind === ENT.RAT || kind === ENT.MOSQUITO ||
          name === 'RAT' || name === 'MOSQUITO'
        ) {
          if (aabbOverlap(G.player, e)) DamageAPI.applyTouch(e, G.player);
        }
      }
    }

    // Puppet: alimentar estado de animación
    if (G.player?.rig) { PuppetAPI.update(G.player.rig, dt); }  // el plugin deduce el estado del host

    updateEntityFlashlights();

    // Si quieres sincronizar la oscuridad con tu Fog/Luces:
    const amb = SkyFX.getAmbientLight();
    window.FogAPI?.setDarkness?.(amb.darkness);
    // si tu plugin expone este método, úsalo; si no, coméntalo:
    window.LightingAPI?.setAmbientTint?.(amb.tint);
  }

  // ------------------------------------------------------------
  // Dibujo: mundo → blur fuera de luz → HUD nítido
  // ------------------------------------------------------------
  function drawWorldTo(ctx2d){
    // fondo
    ctx2d.fillStyle = COLORS.floor;
    ctx2d.fillRect(0,0,VIEW_W,VIEW_H);

    // cámara
    ctx2d.save();
    ctx2d.translate(VIEW_W/2, VIEW_H/2);
    ctx2d.scale(camera.zoom, camera.zoom);
    ctx2d.translate(-camera.x, -camera.y);

    // mundo
    drawTiles(ctx2d);
    drawEntities(ctx2d);

    ctx2d.restore();
  }

  // Dibuja el suelo ajedrezado + paredes con SpriteManager
  function drawTiles(c2){
    Sprites.drawFloorAndWalls(c2, G);
  }

function drawEntities(c2){
  for (const e of G.entities){
    if (!e || e.dead) continue;

    // El jugador se pinta aparte con su rig (más nítido)
    if (e === G.player || e.kind === ENT.PLAYER) continue;

    // 1) Si la entidad tiene "muñeco" (rig), dibújalo
    const rig = e._rig || e.rig;
    if (rig && window.PuppetAPI && typeof PuppetAPI.draw === 'function'){
      try { PuppetAPI.draw(rig, c2, camera); } catch(_){}
      continue; // no dupliques con sprite
    }

    // 2) Si hay sprites, dibuja la sprite de la entidad
    let dibujado = false;
    try {
      if (window.Sprites && typeof Sprites.drawEntity === 'function'){
        Sprites.drawEntity(c2, e);
        dibujado = true;
      } else if (typeof e.spriteKey === 'string' && typeof window.Sprites?.draw === 'function'){
        // camino alternativo si tu gestor de sprites usa draw(key, x, y, opts)
        Sprites.draw(c2, e.spriteKey, e.x, e.y, { w: e.w, h: e.h });
        dibujado = true;
      }
    } catch(_){ /* cae a fallback */ }

    // 3) Fallback visible (rectángulo) si no hay sprites
    if (!dibujado){
      c2.fillStyle = e.color || '#a0a0a0';
      c2.fillRect(e.x - e.w/2, e.y - e.h/2, e.w, e.h);
    }
  }
}

  // Luz del héroe + fog-of-war interna (sin plugins)
  function drawLightingAndFog(){
    ensureBuffers();

    // Si no hay jugador, limpia y sal.
    if (!G.player) {
      ctx.clearRect(0, 0, VIEW_W, VIEW_H);
      return;
    }

    // FogAPI: activa -> la usa; desactivada -> DEBUG sin niebla (mundo limpio)
    if (window.FogAPI) {
      if (FogAPI._enabled) {
        // pinta mundo nítido; FogAPI hará su máscara en su propio canvas
        ctx.clearRect(0, 0, VIEW_W, VIEW_H);
        drawWorldTo(ctx);

        // (B2) “fade lejano” sutil para realismo (puedes comentar si no lo quieres)
        if (G.player) {
          const px = (G.player.x + G.player.w*0.5 - camera.x) * camera.zoom + VIEW_W*0.5;
          const py = (G.player.y + G.player.h*0.5 - camera.y) * camera.zoom + VIEW_H*0.5;
          const R  = Math.max(VIEW_W, VIEW_H) * 0.55;
          const g  = ctx.createRadialGradient(px, py, R*0.40, px, py, R);
          g.addColorStop(0.00, 'rgba(0,0,0,0)');     // cerca: nítido
          g.addColorStop(1.00, 'rgba(0,0,0,0.35)');  // lejos: oscurece un poco
          ctx.save();
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, VIEW_W, VIEW_H);
          ctx.restore();
        }

        return;
      } else {
        // FogAPI desactivada por debug -> mapa completo sin niebla
        ctx.clearRect(0, 0, VIEW_W, VIEW_H);
        drawWorldTo(ctx);
        return;
      }
    }

    // ⬇️ Fallback SIN FogAPI (modo antiguo radial simple)
    drawWorldTo(sceneCtx);
    blurCtx.clearRect(0, 0, VIEW_W, VIEW_H);
    blurCtx.filter = 'blur(2.2px)';
    blurCtx.drawImage(sceneCanvas, 0, 0);
    blurCtx.filter = 'none';

    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    ctx.drawImage(blurCanvas, 0, 0);

    const p = G.player;
    const px = (p.x + p.w/2 - camera.x) * camera.zoom + VIEW_W/2;
    const py = (p.y + p.h/2 - camera.y) * camera.zoom + VIEW_H/2;
    const R  = TILE * 6.5 * camera.zoom;

    const fog = ctx.createRadialGradient(px, py, R*0.65, px, py, R*1.30);
    fog.addColorStop(0, 'rgba(0,0,0,0)');
    fog.addColorStop(1, 'rgba(0,0,0,0.95)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  // ------------------------------------------------------------
  // Draw + loop
  // ------------------------------------------------------------
  function draw(){
    // actualizar cámara centrada en jugador
    if (G.player){
      camera.x = G.player.x + G.player.w/2;
      camera.y = G.player.y + G.player.h/2;
    }

    // composición: mundo borroso fuera de luz + mundo nítido en cono
    drawLightingAndFog();
    // ⬇️ MUÑECO: encima del mundo, pero por DEBAJO de la niebla/luces
    if (G.player?.rig){
      PuppetAPI.draw(G.player.rig, ctx, camera);
    }

    // Plugins que pintan en sus propios canvas (arriba del mundo)
    try { window.FogAPI?.render(camera, G); } catch(e){ console.warn('FogAPI.render', e); }
    try { window.LightingAPI?.render(camera, G); } catch(e){ console.warn('LightingAPI.render', e); }

    // Efectos de clima sobre la cámara (lluvia, relámpagos, gotas)
    window.SkyFX.renderBackground(ctx);
    window.SkyFX?.renderForeground?.(ctx);
    // Marcador de click del MouseNav (anillo)
    if (window.MouseNav && window._mouseNavInited) { try { MouseNav.render(ctx, camera); } catch(e){} }

    // 1) Dibuja el HUD (esta función hace clearRect del HUD canvas)
    try { window.HUD && HUD.render(hudCtx, camera, G); } catch(e){ console.warn('HUD.render', e); }
    try { window.ArrowGuide?.draw(hudCtx, camera, G); } catch(e){ console.warn('ArrowGuide.draw', e); }
    if (window.Sprites?.renderOverlay) { Sprites.renderOverlay(hudCtx); }

    // 2) Dibuja AHORA la flecha y overlays, para que el clear del HUD no las borre
    try { window.ArrowGuide?.draw(hudCtx, camera, G); } catch(e){ console.warn('ArrowGuide.draw', e); }
    if (window.Sprites?.renderOverlay) { Sprites.renderOverlay(hudCtx); }
  }

  // Fixed timestep
  let lastT = performance.now();
  let acc = 0;
  const DT = 1/60;
  let frames = 0, dtAcc=0, msFrame=0, FPS=60;

  function loop(now){
    const delta = (now - lastT)/1000; lastT = now;
    acc += Math.min(delta, 0.05);
    while (acc >= DT){
      update(DT);
      acc -= DT;
      frames++; dtAcc += DT;
      if (dtAcc >= 0.25){
        FPS = frames/dtAcc;
        msFrame = 1000/FPS;
        frames=0; dtAcc=0;
      }
    }
    draw();
    requestAnimationFrame(loop);
  }

  // === Post-parse: instanciar placements SOLO UNA VEZ ===
  function finalizeLevelBuildOnce(){
    if (G._placementsFinalized) return;          // evita duplicados
    G._placementsFinalized = true;

    if (!Array.isArray(G.mapgenPlacements) || !G.mapgenPlacements.length) return;

    try {
      // Camino “oficial”: si existe el helper, úsalo
      if (typeof window.applyPlacementsFromMapgen === 'function') {
        window.applyPlacementsFromMapgen(G.mapgenPlacements);
        return;
      }

      // Fallback LOCAL: instanciar lo básico si no hay placement.api.js
      const T = (window.TILE_SIZE || 32);
      for (const p of G.mapgenPlacements) {
        if (!p || !p.type) continue;

        if (p.type === 'patient') {
          const e = makeRect(p.x|0, p.y|0, T, T, ENT.PATIENT, '#ffd166', false, true);
          e.name = p.name || `Paciente_${G.patients.length+1}`;
          G.entities.push(e); G.patients.push(e); G.npcs.push(e);
        }
        else if (p.type === 'pill') {
          const e = makeRect(p.x|0, p.y|0, T*0.6, T*0.6, ENT.PILL, '#a0ffcf', false, false);
          e.label = p.label || 'Píldora';
          // intenta vincularla al primer paciente existente si no se indicó target
          e.targetName = p.targetName || (G.patients[0]?.name) || null;
          G.entities.push(e); G.movers.push(e); G.pills.push(e);
        }
        else if (p.type === 'door') {
          const e = makeRect(p.x|0, p.y|0, T, T, ENT.DOOR, '#7f8c8d', false, true, {mass:0,rest:0,mu:0,static:true});
          G.entities.push(e); G.door = e;
        }
        else if (p.type === 'boss') {
          const e = makeRect(p.x|0, p.y|0, T*1.2, T*1.2, ENT.BOSS, '#e74c3c', false, true, {mass:8,rest:0.1,mu:0.1,static:true});
          G.entities.push(e); G.boss = e;
        }
        else if (p.type === 'cart') {
          const e = makeRect(p.x|0, p.y|0, T, T, ENT.CART, '#b0956c', true, true, {mass:6,rest:0.35,mu:0.06});
          G.entities.push(e); G.movers.push(e); G.cart = e;
        }
      }
    } catch(e){ console.warn('finalizeLevelBuildOnce (fallback):', e); }
  }
  // ------------------------------------------------------------
  // Control de estado
  // ------------------------------------------------------------
  function startGame(){
    G.state = 'PLAYING';
    // si hay minimapa de debug, muéstralo ahora (no en el menú)
    window.__toggleMinimap?.(!!window.DEBUG_MINIMAP);
    startScreen.classList.add('hidden');
    pausedScreen.classList.add('hidden');
    levelCompleteScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    // mostrar mini-mapa solo en juego
    try { window.__toggleMinimap?.(true); } catch(_){}


    // Reset de estado base
    G.time = 0; G.score = 0; G.health = 6; G.delivered = 0; G.timbresRest = 1;
    G.carry = null;
    G._placementsFinalized = false; 

    // Flag global (lo usará placement.api.js para NO sembrar)
    window.DEBUG_FORCE_ASCII = DEBUG_FORCE_ASCII;
    G.flags = G.flags || {};
    G.flags.DEBUG_FORCE_ASCII = DEBUG_FORCE_ASCII;

    // Si fuerzas ASCII → NO LLAMAR a NINGÚN generador/siembra
    if (DEBUG_FORCE_ASCII) {
      ASCII_MAP = (window.__MAP_MODE === 'mini' ? DEBUG_ASCII_MINI : DEFAULT_ASCII_MAP).slice();
      parseMap(ASCII_MAP);

      // Permite instanciación de placements derivados del ASCII, pero SIN algoritmos
      G.__allowASCIIPlacements = true;
      if (typeof window.applyPlacementsFromMapgen === 'function') {
        window.applyPlacementsFromMapgen(G.__asciiPlacements || G.mapgenPlacements || []);
      }
      finalizeLevelBuildOnce();
      console.log('%cMAP_MODE','color:#0bf', window.__MAP_MODE, '→ ASCII forzado (sin generadores/siembra)');
      if (window.__MAP_MODE === 'debug' && typeof window.auditPuppets === 'function') {
        console.log('PUPPET_AUDIT start');
        try { window.auditPuppets(G.entities || []); } catch(_){}
      }
    } else {
      // ---------- Flujo procedural normal ----------
      let usadoGenerador = false;
      try {
        if (window.MapGen && typeof MapGen.generate === 'function') {
          if (typeof MapGen.init === 'function') MapGen.init(G);
          usadoGenerador = !!loadLevelWithMapGen(G.level || 1);
        }
      } catch(e){ console.warn('[MapGen] init/generate falló:', e); }

      if (!usadoGenerador) {
        try {
          if (window.MapGenAPI && typeof MapGenAPI.generate === 'function') {
            const res = MapGenAPI.generate(G.level || 1, {
              seed: G.seed || Date.now(),
              place: false,
              defs: null,
              width:  window.DEBUG_MINIMAP ? 128 : undefined,
              height: window.DEBUG_MINIMAP ? 128 : undefined
            });
            ASCII_MAP = (res.ascii || '').trim().split('\n');
            G.mapgenPlacements = res.placements || [];
            G.mapAreas = res.areas || null;
            parseMap(ASCII_MAP);
            finalizeLevelBuildOnce();
            usadoGenerador = true;
            console.log('%cMAP_MODE','color:#0bf', window.DEBUG_MINIMAP ? 'procedural mini' : 'procedural normal');
          }
        } catch(e){ console.warn('[MapGenAPI] generate falló:', e); }
      }

      if (!usadoGenerador) {
        parseMap(ASCII_MAP);
        finalizeLevelBuildOnce();
        console.log('%cMAP_MODE','color:#0bf', 'fallback DEFAULT_ASCII_MAP');
      }
    }

    // 1) Generador "nuevo" (MapGen con callbacks y colocación directa)
    if (!window.DEBUG_FORCE_ASCII) { let usadoGenerador = false;
    try {
      if (window.MapGen && typeof MapGen.generate === 'function') {
        // Vincula el estado del juego al plugin (si lo necesita)
        if (typeof MapGen.init === 'function') MapGen.init(G);

        // Crea el nivel entero (coloca entidades vía callbacks)
        usadoGenerador = !!loadLevelWithMapGen(G.level || 1);
      }
    } catch(e){ console.warn('[MapGen] init/generate falló:', e); }

    // 2) Generador "API simple" (MapGenAPI → devuelve ASCII)
    if (!usadoGenerador) {
      try {
        if (window.MapGenAPI && typeof MapGenAPI.generate === 'function') {
          const mini = /[?&]mini=1/.test(location.search) || window.DEBUG_SMALLMAP === true;
          const res = MapGenAPI.generate(G.level || 1, {
            seed: G.seed || Date.now(),
            place: false,       // dejamos que lo coloque parseMap
            defs: null,         // auto
            // ↓↓↓ Forzamos mapa pequeño cuando mini=1 en la URL o flag global
            width:  mini ? 128 : undefined,
            height: mini ? 128 : undefined
          });
          ASCII_MAP = (res.ascii || '').trim().split('\n');   // ⚠️ requiere que sea 'let'
          G.mapgenPlacements = res.placements || [];
          G.mapAreas = res.areas || null;

          parseMap(ASCII_MAP);
          finalizeLevelBuildOnce();
          usadoGenerador = true;
        }
      } catch(e){ console.warn('[MapGenAPI] generate falló:', e); }
    }

    // 3) Fallback: usa el ASCII por defecto si no hubo generador
    if (!usadoGenerador) {
      parseMap(ASCII_MAP);
      finalizeLevelBuildOnce();
    }
  } // ← cierra el if (!window.DEBUG_FORCE_ASCII) que encapsula el bloque duplicado
    // --- Selección de mapa por URL ---
    // ?map=debug  -> fuerza ASCII grande (DEFAULT_ASCII_MAP)
    // ?map=mini   -> fuerza ASCII pequeño (DEBUG_ASCII_MINI)
    // ?mini=1     -> sigue usando MapGen/MapGenAPI pero en tamaño reducido
  const __qs      = new URLSearchParams(location.search);
  window.__MAP_MODE = (__qs.get('map') || '').toLowerCase();

  if (window.DEBUG_FORCE_ASCII) {
    // 1) Forzar ASCII sin llamar a generadores ni auto-siembra
    ASCII_MAP = (window.__MAP_MODE === 'mini' ? DEBUG_ASCII_MINI : DEFAULT_ASCII_MAP).slice();
    parseMap(ASCII_MAP);

    // Autoriza instanciación de placements derivados del ASCII sin algoritmo
    G.__allowASCIIPlacements = true;
    if (typeof window.applyPlacementsFromMapgen === 'function') {
      window.applyPlacementsFromMapgen(G.__asciiPlacements || []);
    }
    finalizeLevelBuildOnce();
    console.log('%cMAP_MODE','color:#0bf', window.__MAP_MODE || 'debug', '→ ASCII forzado (sin generadores/siembra)');
    // Mostrar u ocultar minimapa
    window.__toggleMinimap?.(!!window.DEBUG_MINIMAP);
    if ((window.__MAP_MODE || 'debug') === 'debug' && typeof window.auditPuppets === 'function') {
      console.log('PUPPET_AUDIT start');
      try { window.auditPuppets(G.entities || []); } catch(_){}
    }
  } else {
    // 2) Procedural normal (MapGen/MapGenAPI)
    let usadoGenerador = false;
    try {
      if (window.MapGen && typeof MapGen.generate === 'function') {
        if (typeof MapGen.init === 'function') MapGen.init(G);
        usadoGenerador = !!loadLevelWithMapGen(G.level || 1);
      }
    } catch(e){ console.warn('[MapGen] init/generate falló:', e); }
    if (!usadoGenerador) {
      try {
        if (window.MapGenAPI && typeof MapGenAPI.generate === 'function') {
          const res = MapGenAPI.generate(G.level || 1, {
            seed: G.seed || Date.now(),
            place: false,
            defs: null,
            width:  window.DEBUG_MINIMAP ? 128 : undefined,
            height: window.DEBUG_MINIMAP ? 128 : undefined
          });
          ASCII_MAP = (res.ascii || '').trim().split('\n');
          G.mapgenPlacements = res.placements || [];
          G.mapAreas = res.areas || null;
          parseMap(ASCII_MAP);
          finalizeLevelBuildOnce();
          usadoGenerador = true;
          console.log('%cMAP_MODE','color:#0bf', window.DEBUG_MINIMAP ? 'procedural mini' : 'procedural normal');
        }
      } catch(e){ console.warn('[MapGenAPI] generate falló:', e); }
    }
    if (!usadoGenerador) {
      parseMap(ASCII_MAP);
      finalizeLevelBuildOnce();
      console.log('%cMAP_MODE','color:#0bf', 'fallback DEFAULT_ASCII_MAP');
    }
  }



      // === Puppet rig (visual) para el jugador) — CREAR AL FINAL ===
      if (window.PuppetAPI && G.player){
        const k = (window.selectedHeroKey || window.G?.selectedHero || 'enrique').toLowerCase();

        if (G.player.puppet) {
          if (!G.player.rig && typeof PuppetAPI.attach === 'function') {
            try { PuppetAPI.attach(G.player, G.player.puppet); } catch(_){}
          }
        } else {
          G.player.rig = PuppetAPI.create({
            host: G.player,
            scale: (window.TILE_SIZE||32) / 32
          });
          PuppetAPI.setHeroHead(G.player.rig, k);
        }

        // Reforzar rango de visión del héroe si FogAPI lo expone
        try {
          if (typeof FogAPI.setPlayerVisionTiles === 'function' && G.player?._visionTiles){
            FogAPI.setPlayerVisionTiles(G.player._visionTiles);
          }
        } catch(_) {}
      }

    window.SkyFX?.init?.({
    canvas,
    getCamera: () => camera,
    getMapAABB: () => ({ x:0, y:0, w:G.mapW*TILE_SIZE, h:G.mapH*TILE_SIZE }),
    worldToScreen: (x,y) => ({
      x: (x - camera.x) * camera.zoom + VIEW_W*0.5,
      y: (y - camera.y) * camera.zoom + VIEW_H*0.5
    })
  });

    // === Mouse click-to-move (activar mover con ratón) ===
    if (window.MouseNav && !window._mouseNavInited) {
      MouseNav.init({
        canvas: document.getElementById('gameCanvas'),
        camera,          // usa la cámara real del juego
        TILE,            // tamaño de tile (32)
        getMap:      () => G.map,                   // tu grid 0/1
        getEntities: () => G.entities,
        getPlayer:   () => G.player,
        isWalkable:  (tx,ty) => !!(G.map[ty] && G.map[ty][tx] === 0)
      });
      window._mouseNavInited = true; // evita crear múltiples listeners si reinicias nivel
    }

    // --- Parche para que MouseNav reconozca DOOR/CART con kind numérico ---
    if (window.MouseNav) {
      // 1) Qué consideras interactuable en tu juego
      const isInteractuable = (ent) => {
        if (!ent) return false;
        if (ent.kind === ENT.DOOR) return true;      // puertas
        if (ent.pushable === true) return true;      // carros/camas empujables
        return false;
      };

      // 2) Conectar el detector interno de MouseNav con lo anterior (sin romper nada)
      const _orig = MouseNav._isInteractable?.bind(MouseNav);
      MouseNav._isInteractable = (ent) => isInteractuable(ent) || (_orig ? _orig(ent) : false);

      // 3) Acción al llegar: abrir puerta / empujar carro
      MouseNav._performUse = (player, target) => {
        if (!target) return;
        if (target.kind === ENT.DOOR) {
          // abre/cierra cambiando solidez y color (tu puerta ya usa esto)
          target.solid = !target.solid;
          target.color = target.solid ? '#7f8c8d' : '#2ecc71';
          return;
        }
        if (target.pushable === true) {
          const dx = (target.x + target.w*0.5) - (player.x + player.w*0.5);
          const dy = (target.y + target.h*0.5) - (player.y + player.h*0.5);
          const L  = Math.hypot(dx,dy) || 1;
          const F  = (player.pushForce || FORCE_PLAYER);       // misma fuerza que tecla E
          const scale = 1 / Math.max(1, (target.mass || 1) * 0.5); // más pesado → menos empuje
          target.vx += (dx/L) * F * scale;
          target.vy += (dy/L) * F * scale;
        }
      };
    }

    //Init Audio
    /*
    AudioAPI.init({
      urls: {
        // deja los defaults o sobreescribe aquí tus rutas reales
        // ui_click: 'assets/sfx/ui_click.ogg', ...
      },
      vol: { master: 1, sfx: 0.95, ui: 1, ambient: 0.7, env: 0.9 },
      maxDistance: 520,
      minDistance: 48
    });*/
    // Compat: si alguien usa "Lighting", apunta al nuevo API
    window.Lighting = window.LightingAPI || window.Lighting || null;
    SkyFX.init({
      canvas: document.getElementById('gameCanvas'),
      getCamera: () => ({ x: camera.x, y: camera.y, zoom: camera.zoom }),
      getMapAABB: () => ({ x: 0, y: 0, w: G.mapW * TILE_SIZE, h: G.mapH * TILE_SIZE }),
      worldToScreen: (x,y) => ({
        x: (x - camera.x) * camera.zoom + VIEW_W * 0.5,
        y: (y - camera.y) * camera.zoom + VIEW_H * 0.5
      }),
      // AUDIO: siempre funciones
      //onStartRain: () => { try{ AudioFX?.loop('rain', true); }catch(e){} },
      //onStopRain : () => { try{ AudioFX?.stop('rain'); }catch(e){} },
      //onThunder  : () => { try{ AudioFX?.play('thunder'); }catch(e){} }
    });
    SkyFX.setLevel(G.level);   // ya estaba inicializado arriba

    // Spawners del nivel (solo una vez por arranque)
    initSpawnersForLevel();
    // === Física: vincular entidades del nivel ===
    Physics.init({
          restitution: 0.12,          // tope global de rebote (bajo)
          friction: 0.045,            // rozamiento estándar (menos desliz)
          slideFriction: 0.020,       // mojado resbala pero no “hielo”
          crushImpulse: 110,
          hurtImpulse: 45,
          explodeImpulse: 170
        }).bindGame(G);

    if (G.player && typeof G.player.hp === 'number') {
      G.healthMax = (G.player.hpMax|0) * 2;      // p.ej. Enrique: 5 corazones → 10 “halves”
      G.health    = Math.min(G.healthMax, (G.player.hp|0) * 2);
    }
  }


  function togglePause(){
    if (G.state==='PLAYING'){ G.state='PAUSED'; pausedScreen.classList.remove('hidden'); }
    else if (G.state==='PAUSED'){ G.state='PLAYING'; pausedScreen.classList.add('hidden'); }
  }

  document.getElementById('start-button')?.addEventListener('click', () => {
    // Dejar libre el manejador de click y ejecutar el arranque en el próximo frame
    requestAnimationFrame(() => startGame());
  });
  document.getElementById('resumeBtn')?.addEventListener('click', togglePause);
  document.getElementById('restartBtn')?.addEventListener('click', startGame);

  // Arranque
  requestAnimationFrame(loop);

  // Exponer algunas APIs esperadas por otros plugins/sistemas
  window.TILE_SIZE = TILE;
  window.ENT = ENT;                 // para plugins/sprites
  window.G = G;
  window.camera = camera;
  window.damagePlayer = damagePlayer; // ⬅️ EXponer daño del héroe para las ratas
  })();
// ==== DEBUG MINI-MAP OVERLAY =================================================
(function(){
  // Actívalo con ?mini=1 o definiendo window.DEBUG_MINIMAP = true en consola
  const enabled = /[?&]mini=1/.test(location.search) || window.DEBUG_MINIMAP === true;
  if (!enabled) return;

  const TILE = window.TILE_SIZE || window.TILE || 32;
  const VIEW_W = window.VIEW_W || 1024;
  const VIEW_H = window.VIEW_H || 768;

  let mm = document.getElementById('minimap');
  if (!mm) {
    mm = document.createElement('canvas');
    mm.id = 'minimap';
    mm.width = 256; mm.height = 256;
    mm.style.position = 'fixed';
    mm.style.right = '8px';
    mm.style.bottom = '8px';                // ⬅ abajo-derecha
    mm.style.zIndex = '48';                 // bajo HUD/overlays
    mm.style.background = 'transparent';    // sin opacidad
    mm.style.pointerEvents = 'none';        // no bloquea UI
    mm.style.imageRendering = 'pixelated';
    document.body.appendChild(mm);

    // oculto por defecto si no estás jugando
    mm.style.display = (window.G?.state === 'PLAYING') ? 'block' : 'none';
    // helper global para mostrar/ocultar
    window.__toggleMinimap = (on) => { mm.style.display = on ? 'block' : 'none'; };
  }
  const mctx = mm.getContext('2d');

  function colorFor(ent){
    const ENT = window.ENT || {};
    if (!ent) return '#ffffff';
    if (ent === (window.G && window.G.player)) return '#ffffff';
    if (ent.kind === ENT.DOOR) return '#9aa1a6';
    if (ent.kind === ENT.ELEVATOR) return '#3ddc97';
    if (ent.pushable === true) return '#b68c5a'; // carros/camas
    if (ent.isEnemy || ent.kind === ENT.MOSQUITO || ent.kind === ENT.RAT) return '#e74c3c';
    if (ent.isNPC) return '#5dade2';
    if (ent.kind === ENT.SPAWNER) return '#c27cf7';
    return '#fffd82';
  }

  function drawMinimap(){
    const G = window.G;
    if (!G || !G.map || !G.mapW || !G.mapH) { requestAnimationFrame(drawMinimap); return; }

    const w = G.mapW, h = G.mapH;
    const sx = mm.width  / w;
    const sy = mm.height / h;

    // Mapa base
    mctx.clearRect(0,0,mm.width,mm.height);
    for (let ty=0; ty<h; ty++){
      for (let tx=0; tx<w; tx++){
        const v = (G.map[ty] && G.map[ty][tx]) ? 1 : 0; // 1=pared, 0=suelo
        mctx.fillStyle = v ? '#1d1f22' : '#6b7280';
        mctx.fillRect(tx*sx, ty*sy, sx, sy);
      }
    }

    // Entidades (puntitos)
    const ents = (G.entities || []);
    for (const e of ents){
      const ex = (e.x || 0) / TILE;
      const ey = (e.y || 0) / TILE;
      mctx.fillStyle = colorFor(e);
      mctx.fillRect(ex*sx, ey*sy, Math.max(1,sx*0.85), Math.max(1,sy*0.85));
    }

    // Player
    if (G.player){
      const px = (G.player.x||0)/TILE, py = (G.player.y||0)/TILE;
      mctx.fillStyle = '#ffffff';
      mctx.fillRect(px*sx, py*sy, Math.max(1,sx), Math.max(1,sy));
    }

    // Frustum de cámara (rectángulo)
    const cam = window.camera || {x:0,y:0,zoom:1};
    const vwTiles = VIEW_W / (TILE*cam.zoom);
    const vhTiles = VIEW_H / (TILE*cam.zoom);
    const leftTiles = (cam.x/TILE) - vwTiles*0.5;
    const topTiles  = (cam.y/TILE) - vhTiles*0.5;
    mctx.strokeStyle = '#ffffff';
    mctx.lineWidth = 1;
    mctx.strokeRect(leftTiles*sx, topTiles*sy, vwTiles*sx, vhTiles*sy);

    requestAnimationFrame(drawMinimap);
  }
  drawMinimap();
})();
// ==== /DEBUG MINI-MAP OVERLAY ================================================
