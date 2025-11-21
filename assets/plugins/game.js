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
  const SEARCH_PARAMS = new URLSearchParams(location.search || '');
  const DEBUG_MAP_MODE = /(?:\?|&)map=debug\b/i.test(location.search || '');
  const DEFAULT_DEBUG_MAP_PATH = 'assets/config/debug-map.txt';
  const DEBUG_MAP_FILE_PARAM = (() => {
    const raw = SEARCH_PARAMS.get('debugMap')
      || SEARCH_PARAMS.get('debugMapFile')
      || SEARCH_PARAMS.get('mapfile');
    if (!raw) return null;
    try {
      return decodeURIComponent(raw.replace(/\+/g, ' '));
    } catch (_) {
      return raw;
    }
  })();
  const DEBUG_MAP_FILE = DEBUG_MAP_FILE_PARAM || DEFAULT_DEBUG_MAP_PATH;
  window.DEBUG_MAP_FILE_PARAM = DEBUG_MAP_FILE_PARAM;
  window.DEBUG_MAP_FILE = DEBUG_MAP_FILE;
  const DIAG_MODE = SEARCH_PARAMS.get('diag') === '1';
  const LEVEL_PARAM_RAW = SEARCH_PARAMS.get('level');
  const MAP_DEBUG_LEVEL_PARAM_RAW = getParamCaseInsensitive('MapDebug');
  const DEFAULT_LEVEL_ID = 'level1';
  const NORMALIZED_LEVEL_ID = normalizeLevelParam(LEVEL_PARAM_RAW);
  const NORMALIZED_MAP_DEBUG_LEVEL = normalizeLevelParam(MAP_DEBUG_LEVEL_PARAM_RAW);
  const DEBUG_LEVEL_ID = DEBUG_MAP_MODE
    ? (NORMALIZED_MAP_DEBUG_LEVEL || NORMALIZED_LEVEL_ID || DEFAULT_LEVEL_ID)
    : null;
  const DEBUG_LEVEL_NUMBER = DEBUG_LEVEL_ID ? extractLevelNumber(DEBUG_LEVEL_ID) : null;
  const CURRENT_LEVEL_ID = DEBUG_MAP_MODE
    ? (DEBUG_LEVEL_ID || DEFAULT_LEVEL_ID)
    : (NORMALIZED_LEVEL_ID || DEFAULT_LEVEL_ID);
  const CURRENT_LEVEL_NUMBER = extractLevelNumber(CURRENT_LEVEL_ID) || 1;
  window.DEBUG_MAP_MODE = DEBUG_MAP_MODE;
  window.DEBUG_LEVEL_PARAM = MAP_DEBUG_LEVEL_PARAM_RAW || LEVEL_PARAM_RAW || null;
  window.DEBUG_LEVEL_ID = DEBUG_LEVEL_ID;
  window.DEBUG_LEVEL_NUMBER = DEBUG_LEVEL_NUMBER;
  if (DEBUG_MAP_MODE) {
    console.debug('[LEVEL_DEBUG] Selected debug level', DEBUG_LEVEL_ID || DEFAULT_LEVEL_ID);
  }

  function logThrough(level, ...args){
    const logger = window.LOG;
    if (logger && typeof logger[level] === 'function') {
      try { logger[level](...args); return; }
      catch (err){ console.warn('[LOG proxy]', err); }
    }
    const fallback = (level === 'error') ? console.error
      : (level === 'warn') ? console.warn : console.log;
    fallback(...args);
  }

  function getParamCaseInsensitive(name){
    if (!name) return null;
    const direct = SEARCH_PARAMS.get(name);
    if (direct != null) return direct;
    const needle = name.toLowerCase();
    for (const [key, value] of SEARCH_PARAMS.entries()) {
      if (key.toLowerCase() === needle) return value;
    }
    return null;
  }

  function normalizeLevelParam(value){
    if (value == null) return null;
    const raw = value.toString().trim().toLowerCase();
    if (!raw) return null;
    if (/^level\d+$/.test(raw)) return raw;
    if (/^\d+$/.test(raw)) return `level${raw}`;
    return null;
  }

  function extractLevelNumber(id){
    if (!id) return null;
    const match = /level(\d+)/.exec(String(id).toLowerCase());
    if (!match) return null;
    const num = parseInt(match[1], 10);
    return Number.isFinite(num) ? num : null;
  }

  const TILE = 32;
  const VIEW_W = 960;
  const VIEW_H = 540;
  const FORCE_PLAYER = 100.0;

  const ENT = (() => {
    const root = (typeof window !== 'undefined') ? window : globalThis;
    const existing = (root && typeof root.ENT === 'object')
      ? root.ENT
      : (root && typeof root.G === 'object' && typeof root.G.ENT === 'object')
        ? root.G.ENT
        : {};
    const defaults = {
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
    for (const [key, value] of Object.entries(defaults)) {
      existing[key] = value;
    }
    if (root && typeof root === 'object') {
      root.ENT = existing;
    }
    return existing;
  })();

  function matchesKind(entity, key){
    if (!entity) return false;
    const target = String(key).toUpperCase();
    if (typeof entity.kind === 'string' && entity.kind.toUpperCase() === target) return true;
    if (typeof entity.kind === 'number' && ENT[target] === entity.kind) return true;
    if (typeof entity.kindName === 'string' && entity.kindName.toUpperCase() === target) return true;
    if (typeof entity.type === 'string' && entity.type.toUpperCase() === target) return true;
    return false;
  }

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
      maxSpeedPlayer: 240,
      maxSpeedObject: 1040
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
    levelState: 'READY_TO_START', // READY_TO_START | LOADING | READY | PLAYING | PAUSED | IDLE
    pendingLevel: null,
    level: CURRENT_LEVEL_NUMBER,
    debugLevelId: DEBUG_LEVEL_ID || CURRENT_LEVEL_ID || DEFAULT_LEVEL_ID,
    debugLevelNumber: DEBUG_LEVEL_NUMBER || CURRENT_LEVEL_NUMBER,
    currentLevelId: CURRENT_LEVEL_ID,
    currentLevelNumber: CURRENT_LEVEL_NUMBER,
    entities: [],
    movers: [],
    hostiles: [],
    humans: [],
    animals: [],
    objects: [],
    patients: [],
    pills: [],
    lights: [],       // lógicas (para info)
    roomLights: [],   // focos de sala
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
    patientsTotal: 0,
    patientsPending: 0,
    patientsCured: 0,
    patientsFurious: 0,
    cycleSeconds: 0,
    TILE_SIZE: TILE,
    cullingRadiusTiles: 20,
    cullingRadiusPx: 20 * TILE,
    isDebugMap: DEBUG_MAP_MODE,
    firstBellDelayMinutes: 5,
    firstBellDelaySeconds: 300,
    firstBellDeadline: null,
    firstBellTriggered: false,
    _firstBellPendingLog: false
  };

  const PINBALL_GROUPS = new Set(['cart', 'human', 'animal']);

  function pinballGroupName(ent){
    return (ent && ent.group ? String(ent.group) : '').toLowerCase();
  }

  function isPinballCandidate(ent){
    if (!ent || ent.dead || ent.pinballExempt) return false;
    if (ent.static) return false;
    if (ent.pushable) return true;
    if (ent.kind === ENT.PLAYER) return true;
    if (typeof isCartEntity === 'function' && isCartEntity(ent)) return true;
    const group = pinballGroupName(ent);
    return PINBALL_GROUPS.has(group);
  }

  function approximatePinballMass(ent){
    if (!ent) return 0;
    if (Number.isFinite(ent.mass)) return Math.max(0.2, ent.mass);
    if (ent.kind === ENT.PLAYER) return 1.0;
    if (typeof isCartEntity === 'function' && isCartEntity(ent)) return 3.5;
    if (PINBALL_GROUPS.has(pinballGroupName(ent))) return 1.1;
    return 1.0;
  }

  function pinballRestitution(ent){
    const phys = physicsConfig();
    let rest = (phys?.restitution ?? 0.32);
    if (typeof isCartEntity === 'function' && isCartEntity(ent)) {
      rest = Math.max(rest, phys?.cartRestitution ?? rest);
    }
    if (Number.isFinite(ent?.rest)) rest = Math.max(rest, ent.rest);
    if (Number.isFinite(ent?.restitution)) rest = Math.max(rest, ent.restitution);
    return Math.max(0.2, Math.min(0.98, rest));
  }

  function shouldDebugPushLogs(){
    try {
      if (window.DEBUG_PUSH || window.DEBUG_FORCE_ASCII) return true;
      return typeof window.location?.search === 'string' && window.location.search.includes('map=debug');
    } catch (_) {
      return false;
    }
  }
  window.G = G; // (expuesto)
  G.ENT = ENT;
  if (typeof window === 'object') {
    window.ENT = ENT;
  }

  let currentCullingInfo = null;

  function detachEntityRig(ent){
    if (!ent) return;
    try {
      if (typeof window.detachEntityRig === 'function' && window.detachEntityRig !== detachEntityRig) {
        window.detachEntityRig(ent);
        return;
      }
    } catch (_) {}
    try {
      window.PuppetAPI?.detach?.(ent);
    } catch (err){
      if (window.DEBUG_FORCE_ASCII) console.warn('[Game] detachEntityRig error', err);
    }
  }
  window.detachEntityRig = detachEntityRig;

  function resolveCullingRadiusTiles(){
    const candidates = [
      Number.isFinite(G?.cullingRadiusTiles) ? G.cullingRadiusTiles : null,
      G?.levelRules?.level?.culling,
      G?.levelRules?.globals?.culling,
      G?.globals?.culling
    ];
    for (const value of candidates){
      if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
  }

  function computeCullingInfo(){
    const hero = G.player;
    if (!hero){
      currentCullingInfo = null;
      if (G) G.__cullingInfo = null;
      return null;
    }
    const radiusTiles = resolveCullingRadiusTiles();
    if (!Number.isFinite(radiusTiles) || radiusTiles <= 0){
      currentCullingInfo = null;
      G.__cullingInfo = null;
      return null;
    }
    const tileSize = window.TILE_SIZE || window.TILE || TILE;
    const radiusPx = radiusTiles * tileSize;
    const info = {
      radiusTiles,
      radiusPx,
      radiusSq: radiusPx * radiusPx,
      hx: hero.x + (hero.w || tileSize) * 0.5,
      hy: hero.y + (hero.h || tileSize) * 0.5,
      timestamp: (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now()
    };
    currentCullingInfo = info;
    G.__cullingInfo = info;
    return info;
  }

  function setEntityActivity(ent, active){
    if (!ent) return;
    const wasInactive = ent._inactive === true;
    const nowInactive = !active;
    if (wasInactive === nowInactive) return;
    ent._inactive = nowInactive;
    const hooks = active
      ? ['onActivate', 'onWake', 'onWakeUp']
      : ['onDeactivate', 'onSleep', 'onSleepy'];
    for (const name of hooks){
      const fn = ent && typeof ent[name] === 'function' ? ent[name] : null;
      if (!fn) continue;
      try {
        fn.call(ent, G, currentCullingInfo);
      } catch (err){
        if (window.DEBUG_FORCE_ASCII) console.warn(`[Entity:${name}] error`, err);
      }
      break;
    }
  }

  function shouldUpdateEntity(ent){
    if (!ent) return false;
    if (ent === G.player){
      setEntityActivity(ent, true);
      return true;
    }
    const info = currentCullingInfo;
    if (!info){
      setEntityActivity(ent, true);
      return true;
    }
    if (ent._alwaysUpdate === true){
      setEntityActivity(ent, true);
      return true;
    }
    const now = info.timestamp || ((typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now());
    const awakeUntil = Number(ent._alwaysUpdateUntil);
    if (Number.isFinite(awakeUntil) && awakeUntil > now){
      setEntityActivity(ent, true);
      return true;
    }
    const w = Number.isFinite(ent.w) ? ent.w : TILE;
    const h = Number.isFinite(ent.h) ? ent.h : TILE;
    const ex = (Number(ent.x) || 0) + w * 0.5;
    const ey = (Number(ent.y) || 0) + h * 0.5;
    const dx = ex - info.hx;
    const dy = ey - info.hy;
    const active = (dx * dx + dy * dy) <= info.radiusSq;
    setEntityActivity(ent, active);
    return active;
  }
  const PATH_BLOCK_LOG_INTERVAL_MS = 220;
  const isPathDebugEnabled = () => {
    try {
      const root = typeof window !== 'undefined'
        ? window
        : (typeof globalThis !== 'undefined' ? globalThis : null);
      if (!root) return false;
      return !!(root.PATH_DEBUG || root.DEBUG_PATHS || root.DEBUG_FORCE_PATHS);
    } catch (_) {
      return false;
    }
  };
  function describeEntity(ent){
    if (!ent) return 'entity';
    return ent.id || ent.name || ent.kindName || ent.kind || 'entity';
  }
  function logPathBlocked(ent, reason){
    if (!ent || !isPathDebugEnabled()) return;
    const nowTs = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    if (ent._lastPathBlockedLog && nowTs - ent._lastPathBlockedLog < PATH_BLOCK_LOG_INTERVAL_MS) return;
    ent._lastPathBlockedLog = nowTs;
    const suffix = reason ? ` (${reason})` : '';
    console.debug(`[PATH_BLOCKED] ${describeEntity(ent)}${suffix}`);
  }
  function snapEntityInsideMap(ent){
    try {
      if (window.Physics?.snapInsideMap) {
        window.Physics.snapInsideMap(ent);
      }
    } catch (_) {}
  }

  const MovementSystem = (() => {
    const states = new WeakMap();
    const movers = new Set();
    let currentMap = null;
    let tileSize = TILE;

    function ensure(e){
      if (!e) return null;
      let st = states.get(e);
      if (st) return st;
      st = {
        x: e.x || 0,
        y: e.y || 0,
        vx: e.vx || 0,
        vy: e.vy || 0,
        intentVx: e.vx || 0,
        intentVy: e.vy || 0,
        teleportX: e.x || 0,
        teleportY: e.y || 0,
        forceTeleport: false,
        teleportFromX: e.x || 0,
        teleportFromY: e.y || 0,
        lastSafeX: e.x || 0,
        lastSafeY: e.y || 0,
        pendingTeleportApproved: true,
        pendingTeleportReason: null,
        friction: typeof e.mu === 'number' ? Math.max(0, Math.min(1, e.mu)) : 0
      };
      states.set(e, st);
      defineProps(e, st);
      if (!e.static) movers.add(e);
      return st;
    }

    function defineProps(e, st){
      Object.defineProperty(e, 'x', {
        configurable: true,
        enumerable: true,
        get(){ return st.x; },
        set(value){
          const v = Number(value) || 0;
          st.teleportFromX = st.x;
          st.teleportX = v;
          st.x = v;
          st.forceTeleport = true;
          st.pendingTeleportApproved = false;
        }
      });
      Object.defineProperty(e, 'y', {
        configurable: true,
        enumerable: true,
        get(){ return st.y; },
        set(value){
          const v = Number(value) || 0;
          st.teleportFromY = st.y;
          st.teleportY = v;
          st.y = v;
          st.forceTeleport = true;
          st.pendingTeleportApproved = false;
        }
      });
      Object.defineProperty(e, 'vx', {
        configurable: true,
        enumerable: true,
        get(){ return st.vx; },
        set(value){
          const v = Number(value) || 0;
          st.intentVx = v;
          st.vx = v;
        }
      });
      Object.defineProperty(e, 'vy', {
        configurable: true,
        enumerable: true,
        get(){ return st.vy; },
        set(value){
          const v = Number(value) || 0;
          st.intentVy = v;
          st.vy = v;
        }
      });
    }

    function unregister(e){
      if (!e) return;
      if (!e.__loggedDespawn){
        e.__loggedDespawn = true;
        try {
          window.LOG?.event?.('DESPAWN', {
            id: e.id || e.name || null,
            kind: e.kindName || e.kind || null,
            x: Number.isFinite(e.x) ? Math.round(e.x) : null,
            y: Number.isFinite(e.y) ? Math.round(e.y) : null,
          });
        } catch (_) {}
      }
      movers.delete(e);
      states.delete(e);
    }

    function setMap(map, size){
      currentMap = map || null;
      tileSize = size || TILE;
    }

    function isBlocked(x, y, w, h){
      if (!currentMap) return false;
      const tx1 = Math.floor(x / tileSize);
      const ty1 = Math.floor(y / tileSize);
      const tx2 = Math.floor((x + w) / tileSize);
      const ty2 = Math.floor((y + h) / tileSize);
      const H = currentMap.length;
      const W = H ? currentMap[0].length : 0;
      const clamped = (tx,ty)=> tx<0 || ty<0 || tx>=W || ty>=H;
      if (clamped(tx1,ty1) || clamped(tx2,ty1) || clamped(tx1,ty2) || clamped(tx2,ty2)) return true;
      return (
        currentMap[ty1][tx1] === 1 ||
        currentMap[ty1][tx2] === 1 ||
        currentMap[ty2][tx1] === 1 ||
        currentMap[ty2][tx2] === 1
      );
    }

    function collidesEntity(e, x, y){
      if (!Array.isArray(G.entities)) return false;
      for (const other of G.entities){
        if (!other || other === e) continue;
        if (!other.solid || other.dead) continue;
        if (!other.static && isPinballCandidate(e) && isPinballCandidate(other)) continue;
        const stOther = states.get(other);
        const ox = stOther ? stOther.x : other.x;
        const oy = stOther ? stOther.y : other.y;
        const ow = other.w || 0;
        const oh = other.h || 0;
        if (x + e.w <= ox || x >= ox + ow) continue;
        if (y + e.h <= oy || y >= oy + oh) continue;
        return true;
      }
      return false;
    }

    function consumeTeleport(e, st){
      const targetX = st.teleportX;
      const targetY = st.teleportY;
      const fromX = st.teleportFromX ?? targetX;
      const fromY = st.teleportFromY ?? targetY;
      const delta = Math.hypot(targetX - fromX, targetY - fromY);
      const needsApproval = !e.static && delta > tileSize * 0.5;
      const allowed = st.pendingTeleportApproved || !needsApproval;
      const blocked = isBlocked(targetX, targetY, e.w, e.h) || collidesEntity(e, targetX, targetY);
      if (!allowed) {
        logPathBlocked(e, 'teleport_denied');
        snapEntityInsideMap(e);
        st.x = st.lastSafeX ?? st.x;
        st.y = st.lastSafeY ?? st.y;
      } else if (blocked) {
        logPathBlocked(e, 'teleport_blocked');
        snapEntityInsideMap(e);
        st.x = st.lastSafeX ?? st.x;
        st.y = st.lastSafeY ?? st.y;
      } else {
        st.x = targetX;
        st.y = targetY;
        st.lastSafeX = st.x;
        st.lastSafeY = st.y;
      }
      st.forceTeleport = false;
      st.pendingTeleportApproved = false;
      st.pendingTeleportReason = null;
    }

    function moveAxis(e, st, dt, axis){
      const vel = axis === 'x' ? st.vx : st.vy;
      if (Math.abs(vel) < 1e-6) return;
      let pos = axis === 'x' ? st.x : st.y;
      const delta = vel * dt;
      const steps = Math.max(1, Math.ceil(Math.abs(delta)));
      const step = delta / steps;
      for (let i = 0; i < steps; i++){
        const next = pos + step;
        const nx = axis === 'x' ? next : st.x;
        const ny = axis === 'y' ? next : st.y;
        const hitWall = isBlocked(nx, ny, e.w, e.h);
        const hitSolid = !hitWall && collidesEntity(e, nx, ny);
        if (hitWall || hitSolid){
          logPathBlocked(e, axis === 'x' ? 'axis-x' : 'axis-y');
          const bounce = isPinballCandidate(e);
          const rest = bounce ? pinballRestitution(e) : 0;
          if (axis === 'x') {
            st.vx = bounce ? -st.vx * rest : 0;
          } else {
            st.vy = bounce ? -st.vy * rest : 0;
          }
          return;
        }
        pos = next;
        if (axis === 'x') st.x = pos; else st.y = pos;
      }
      if (!isBlocked(st.x, st.y, e.w, e.h)) {
        st.lastSafeX = st.x;
        st.lastSafeY = st.y;
      }
    }

    function applyFriction(e, st){
      const mu = (typeof e.mu === 'number') ? Math.max(0, Math.min(1, e.mu)) : (st.friction || 0);
      st.friction = mu;
      const fr = 1 - Math.max(0, Math.min(0.95, mu || 0));
      st.vx *= fr;
      st.vy *= fr;
      if (Math.abs(st.vx) < 0.0001) st.vx = 0;
      if (Math.abs(st.vy) < 0.0001) st.vy = 0;
    }

    function step(dt){
      if (!dt || dt <= 0) return;
      for (const e of movers){
        if (!e || e.dead) continue;
        const st = ensure(e);
        if (!st) continue;
        if (st.forceTeleport){
          consumeTeleport(e, st);
          continue;
        }
        if (!shouldUpdateEntity(e)){
          st.intentVx = 0;
          st.intentVy = 0;
          st.vx = 0;
          st.vy = 0;
          continue;
        }
        st.vx = st.intentVx;
        st.vy = st.intentVy;
        const maxSp = (typeof e.maxSpeed === 'number') ? e.maxSpeed : null;
        if (maxSp != null){
          const sp = Math.hypot(st.vx, st.vy);
          if (sp > maxSp){
            const k = maxSp / (sp || 1);
            st.vx *= k;
            st.vy *= k;
          }
        }
        moveAxis(e, st, dt, 'x');
        moveAxis(e, st, dt, 'y');
        applyFriction(e, st);
        st.intentVx = st.vx;
        st.intentVy = st.vy;
      }
    }

    return {
      register: ensure,
      unregister,
      step,
      setMap,
      getState(e){ return ensure(e); },
      allowTeleport(e, opts = {}) {
        const st = ensure(e);
        if (!st) return null;
        st.pendingTeleportApproved = true;
        st.pendingTeleportReason = opts.reason || 'manual';
        return st;
      }
    };
  })();
  window.MovementSystem = MovementSystem;
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
  const canvas      = document.getElementById('gameCanvas');
  const ctx         = canvas.getContext('2d');
  const fogCanvas   = document.getElementById('fogCanvas');
  const fogCtx      = fogCanvas ? fogCanvas.getContext('2d') : null;
  const guideCanvas = document.getElementById('guideCanvas');
  const guideCtx    = guideCanvas ? guideCanvas.getContext('2d') : null;

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
  if (guideCanvas){ guideCanvas.width = VIEW_W; guideCanvas.height = VIEW_H; }

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

  function clearLights(){
    try { window.LightingAPI?.clear?.(); } catch (_) {}
    try { window.LightingAPI?.removeAllLights?.(); } catch (_) {}
    if (typeof document !== 'undefined'){
      const nodes = document.querySelectorAll('.fx-light, .fx-fire, .fx-glow');
      nodes.forEach((node) => {
        try { node.remove(); } catch (_) {}
      });
    }
    if (Array.isArray(G?.lights)) G.lights.length = 0;
    if (Array.isArray(G?.roomLights)) G.roomLights.length = 0;
    if (Array.isArray(G?.dynamicLights)) G.dynamicLights.length = 0;
    if (Array.isArray(G?.lightFX)) G.lightFX.length = 0;
  }

  function clearCanvasContext(targetCtx, width, height){
    if (!targetCtx) return;
    const w = Number.isFinite(width) && width > 0
      ? width
      : (targetCtx.canvas && Number.isFinite(targetCtx.canvas.width) ? targetCtx.canvas.width : VIEW_W);
    const h = Number.isFinite(height) && height > 0
      ? height
      : (targetCtx.canvas && Number.isFinite(targetCtx.canvas.height) ? targetCtx.canvas.height : VIEW_H);
    try {
      targetCtx.save();
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.clearRect(0, 0, w, h);
      targetCtx.restore();
    } catch (err){
      try {
        targetCtx.clearRect(0, 0, w, h);
      } catch (_) {}
    }
  }

  function syncGuideCanvasResolution(){
    if (!guideCanvas) return;
    const cssW = guideCanvas.clientWidth || VIEW_W;
    const cssH = guideCanvas.clientHeight || VIEW_H;
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const targetW = Math.max(1, Math.round(cssW * dpr));
    const targetH = Math.max(1, Math.round(cssH * dpr));
    if (guideCanvas.__hudDpr !== dpr || guideCanvas.width !== targetW || guideCanvas.height !== targetH){
      guideCanvas.__hudDpr = dpr;
      guideCanvas.width = targetW;
      guideCanvas.height = targetH;
    }
  }

  function resetGameWorld(opts = {}){
    const options = opts || {};
    const levelState = options.levelState || 'READY_TO_START';
    const reason = options.reason || 'world-reset';

    clearCanvasContext(ctx, canvas?.width, canvas?.height);
    clearCanvasContext(fogCtx, fogCanvas?.width, fogCanvas?.height);
    clearCanvasContext(guideCtx, guideCanvas?.width, guideCanvas?.height);

    try { window.FogAPI?.reset?.(); } catch (_) {}
    try { window.FogAPI?.clear?.(); } catch (_) {}
    try { window.LightingAPI?.reset?.(); } catch (_) {}
    try { window.SkyFX?.reset?.(); } catch (_) {}
    try { window.SkyFX?.clear?.(); } catch (_) {}
    try { window.Physics?.reset?.(); } catch (_) {}
    try { window.ArrowGuide?.reset?.(); } catch (_) {}
    try { window.GameFlowAPI?.cancelReadyOverlay?.(); } catch (_) {}

    resetGlobalLevelState();

    if (options.pendingLevel !== undefined) {
      const pending = Number(options.pendingLevel);
      G.pendingLevel = Number.isFinite(pending) ? pending : options.pendingLevel;
    } else if (options.keepPendingLevel !== true) {
      G.pendingLevel = null;
    }

    G.levelState = levelState;

    window.LOG?.event?.('WORLD_RESET', {
      reason,
      state: levelState,
      debug: DEBUG_MAP_MODE
    });
  }

  function resetAndLoadLevel(levelNumber){
    const numericLevel = Number(levelNumber);
    const nextLevel = Number.isFinite(numericLevel) && numericLevel > 0
      ? numericLevel
      : (G.level || 1);
    G.pendingLevel = nextLevel;
    if (G.levelState !== 'READY_TO_START') {
      resetGameWorld({ levelState: 'READY_TO_START', pendingLevel: nextLevel, reason: 'queue-level', keepPendingLevel: true });
    }
    requestAnimationFrame(() => startGame(nextLevel));
  }

  function fitStartScreen(){
    if (typeof window === 'undefined') return;
    const root = document.querySelector('#start-screen');
    if (!root) return;
    const viewportH = Math.max(window.innerHeight || document.documentElement?.clientHeight || 0, 320);
    root.style.height = `${viewportH}px`;
    root.style.maxHeight = `${viewportH}px`;
    root.style.setProperty('--start-screen-height', `${viewportH}px`);
  }
  if (typeof window !== 'undefined'){
    window.addEventListener('resize', fitStartScreen, { passive: true });
    window.addEventListener('orientationchange', fitStartScreen, { passive: true });
    setTimeout(fitStartScreen, 0);
  }

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
      }
      window.G.selectedHero = window.selectedHeroKey || 'francesco';
    });
  })();

  const JOKES_3D_ACCEL = [
    "Compilando triángulos en cuatro dimensiones...",
    "Insertando disquete de texturas de 1993...",
    "Sacudiendo el monitor CRT para alinear los píxeles mágicos...",
    "Persuadiendo a la tarjeta Voodoo para que despierte...",
    "Inflando el shader con aire de fallas...",
    "Desempolvando la aceleradora Matrox mística...",
    "Reservando 8 KB extra para la niebla dramática...",
    "Calibrando el giroscopio imaginario del ratón...",
    "Pidiendo permiso al jefe de planta para usar ray-tracing...",
    "Limpiando con alcohol isopropílico las normales invertidas...",
    "Leyendo el manual secreto del turbo botón...",
    "Armonizando el ventilador con ópera belcantista...",
    "Aplicando graxa valenciana a los FPS...",
    "Convenciendo a los vóxeles de que canten a tres voces...",
    "Colocando stickers de NOS sobre la GPU...",
    "Engrasando el eje Z con aceite de oliva virgen extra...",
    "Sacando brillo al busto de Guybrush para la suerte...",
    "Cronometrando el dithering con metrónomo de hospital...",
    "Invocando al shamán de DirectX 3.1...",
    "Cazando polígonos rebeldes detrás de la cafetería...",
    "Sintiendo el aura térmica de los condensadores...",
    "Agitando la coctelera de partículas especulares...",
    "Prestando gafas de realidad virtual al bedel...",
    "Cantando serenatas a los fotogramas perdidos...",
    "Abriendo un portal extra para los sprites tímidos...",
    "Sobornando al bus PCI con horchata fría...",
    "Alineando la constelación de píxeles con regla T...",
    "Dándole vacaciones al clipping frontal...",
    "Solicitando turno al santo patrón de los polígonos...",
    "Midiendo a ojo el parallax con cinta de carrocero..."
  ];

  let accelJokesPool = [];

  function shuffleAccelJokes(){
    const pool = [...JOKES_3D_ACCEL];
    for (let i = pool.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool;
  }

  function showRandom3DAccelerationJoke(){
    if (typeof document === 'undefined' || !JOKES_3D_ACCEL.length) return '';
    if (!accelJokesPool.length) {
      accelJokesPool = shuffleAccelJokes();
    }
    const next = accelJokesPool.shift() || '';
    const out = document.getElementById('accel-joke');
    if (out && next){
      out.textContent = next;
      out.classList.add('visible');
    }
    return next;
  }
  window.showRandom3DAccelerationJoke = showRandom3DAccelerationJoke;

  (function setup3DAccelerationButton(){
    const btn = document.getElementById('btn-3dacc');
    if (!btn) return;
    btn.addEventListener('click', () => {
      showRandom3DAccelerationJoke();
    });
  })();

  function ensureHeroSelected(){
    let key = (window.selectedHeroKey || '').toLowerCase();
    if (!key){
      const first = document.querySelector('#start-screen .char-card.selected')
        || document.querySelector('#start-screen .char-card[data-hero]');
      key = (first?.dataset?.hero || 'enrique').toLowerCase();
    }
    if (!key) key = 'enrique';
    window.selectedHeroKey = key;
    window.G = window.G || {};
    window.G.selectedHero = key;
    return key;
  }
  const metrics = document.getElementById('metricsOverlay') || document.createElement('pre'); // por si no existe

  // Cámara
  const camera = { x: 0, y: 0, zoom: 0.45 }; // ⬅️ arranca ya alejado
  G.camera = camera;
  
  function getCameraState(){
    const base = G.camera || camera || { x: 0, y: 0, zoom: 1 };
    const zoom = Number.isFinite(base.zoom) && base.zoom > 0 ? base.zoom : 1;
    const shake = window.CineFX?.getCameraShake?.() || { x: 0, y: 0 };
    return {
      cam: base,
      zoom,
      offsetX: VIEW_W * 0.5 + (shake.x || 0),
      offsetY: VIEW_H * 0.5 + (shake.y || 0)
    };
  }

  function centerCameraOnPlayer(player = G?.player){
    if (!player) return;
    const pw = Number.isFinite(player.w) ? player.w : TILE;
    const ph = Number.isFinite(player.h) ? player.h : TILE;
    const baseX = Number(player.x) || 0;
    const baseY = Number(player.y) || 0;
    camera.x = baseX + pw * 0.5;
    camera.y = baseY + ph * 0.5;
    camera.viewportOffsetX = 0;
    camera.viewportOffsetY = 0;
    camera.viewportX = VIEW_W * 0.5;
    camera.viewportY = VIEW_H * 0.5;
  }

  function applyWorldCamera(ctx){
    if (!ctx) return;
    const state = getCameraState();
    const cam = state.cam || {};
    const cx = Number(cam.x) || 0;
    const cy = Number(cam.y) || 0;
    const tx = Math.round(state.offsetX - cx * state.zoom);
    const ty = Math.round(state.offsetY - cy * state.zoom);
    ctx.setTransform(state.zoom, 0, 0, state.zoom, tx, ty);
  }
  window.applyWorldCamera = applyWorldCamera;

  function worldToScreenBasic(worldX, worldY, cam = camera, viewportWidth = VIEW_W, viewportHeight = VIEW_H) {
    const ref = cam || camera || {};
    const zoom = Number(ref.zoom) || 1;
    const shake = window.CineFX?.getCameraShake?.() || { x: 0, y: 0 };
    const baseX = Number(ref.x) || 0;
    const baseY = Number(ref.y) || 0;
    const viewportX = Number.isFinite(ref.viewportX) ? ref.viewportX : (viewportWidth * 0.5);
    const viewportY = Number.isFinite(ref.viewportY) ? ref.viewportY : (viewportHeight * 0.5);
    const offsetX = Number.isFinite(ref.viewportOffsetX) ? ref.viewportOffsetX : 0;
    const offsetY = Number.isFinite(ref.viewportOffsetY) ? ref.viewportOffsetY : 0;
    return {
      x: (worldX - baseX) * zoom + viewportX + offsetX + (shake.x || 0),
      y: (worldY - baseY) * zoom + viewportY + offsetY + (shake.y || 0),
    };
  }

  function worldToScreen(x, y, cam = camera) {
    const viewW = cam?.viewportWidth ?? VIEW_W;
    const viewH = cam?.viewportHeight ?? VIEW_H;
    const point = worldToScreenBasic(x, y, cam, viewW, viewH);
    return { sx: Math.round(point.x), sy: Math.round(point.y), x: point.x, y: point.y };
  }
  window.worldToScreen = worldToScreen;

  function bridgeToScreen(a, b, c, d) {
    if (typeof a === 'number') {
      const projected = worldToScreen(a, b, c);
      return { x: projected.x ?? projected.sx, y: projected.y ?? projected.sy };
    }
    const projected = worldToScreen(c, d, a);
    return { x: projected.x ?? projected.sx, y: projected.y ?? projected.sy };
  }

  let invalidZoomLogged = false;
  let pushableOverlapCooldown = 0;

  try {
    window.GameFlowAPI?.init?.(G, { cartBossTiles: 2.0 });
  } catch (err) {
    console.warn('[GameFlow] init error:', err);
  }

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

    if (window.GameFlowAPI?.isReadyOverlayActive?.()) {
      e.preventDefault();
      return;
    }

    // === Atajos comunes ===
    if (k === '0'){ e.preventDefault(); fitCameraToMap(); }
    if (k === 'q'){ window.camera.zoom = clamp(window.camera.zoom - 0.1, 0.6, 2.5); }
    if (k === 'r'){
      if (G.state === 'GAMEOVER' || G.state === 'COMPLETE'){
        e.preventDefault();
        startGame(G.level || 1);
        return;
      } else {
        window.camera.zoom = clamp(window.camera.zoom + 0.1, 0.6, 2.5);
      }
    }
    if (code === 'Space' || k === ' '){
      if (G.state === 'PLAYING'){
        e.preventDefault();
        window.__toggleMinimapMode?.();
      }
      return;
    }
    if (k === 'f1'){ e.preventDefault(); metrics.style.display = (metrics.style.display === 'none' ? 'block' : 'none'); }
    if (k === 'escape'){ togglePause(); }
    if (k === 'f'){
      if (G.state === 'PLAYING'){ e.preventDefault(); try { window.Entities?.Hero?.startAttack?.(G.player, { heavy: G.player?.hero === 'enrique' }); } catch(err){ if (window.DEBUG_FORCE_ASCII) console.warn('[Hero] attack trigger error', err); } }
      return;
    }

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
  // S: héroe principal (jugador)
  // p: paciente en cama          | f: paciente furiosa (debug)
  // i: pastilla vinculada al paciente
  // d: puerta normal               | u: puerta de urgencias cerrada (boss)
  // X: paciente crítico final (boss)
  // U: carro de urgencias        | +: carro de medicinas | F: carro de comida
  // N: spawner de humanos (NPC)  | C: spawner de carros
  // A: spawner de animales (ratas/mosquitos)
  // m: enemigo mosquito directo  | r: enemigo rata directo
  // k: médico NPC                | H: jefa de enfermería
  // t: técnico T.C.A.E.          | c: celador
  // n: enfermera cameo           | h: personal de limpieza
  // g: guardia de seguridad      | v: familiar visitante
  // L: luz funcionando           | l: luz rota
  // ~: charco de agua            | E: ascensor
  // #: pared  · .: suelo
  // ------------------------------------------------------------
    // Mapa por defecto (inmutable)
    const FALLBACK_DEBUG_ASCII_MAP = [
    "##############################",
    "#............................#",
    "#....####............####....#",
    "#....d..#....p.i#....#X.#....#",
    "#....#.S#.......#....#..D....#",
    "#....####..U+.#......####....#",
    "#...........#....N...A....c..#",
    "#...H..t..n..#..m............#",
    "#..............E.....F.......#",
    "#....b.......####.......i....#",
    "#......k.....#.r#............#",
    "#...............#............#",
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
    const DEBUG_ASCII_MINI = FALLBACK_DEBUG_ASCII_MAP;

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
let ASCII_MAP = FALLBACK_DEBUG_ASCII_MAP.slice();

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
    MovementSystem.register(e);
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
      p.maxSpeed = (p.maxSpeed != null) ? p.maxSpeed : (BALANCE.physics.maxSpeedPlayer || 240);
      p.accel    = (p.accel    != null) ? p.accel    : 1000;
      p.pushForce= (p.pushForce!= null) ? p.pushForce: FORCE_PLAYER;
      p.facing   = p.facing || 'S';

      // === Giro más sensible por defecto ===
      p.turnSpeed = (p.turnSpeed != null) ? p.turnSpeed : 4.5;
      p.lookAngle = (typeof p.lookAngle === 'number')
        ? p.lookAngle
        : (p.facing === 'E' ? 0 :
           p.facing === 'S' ? Math.PI/2 :
           p.facing === 'W' ? Math.PI : -Math.PI/2);

      p.heroId = (p.heroId || key);
      if (!p.hero) p.hero = key;
      if (!p.inventory) p.inventory = {};

      G.player = p;
      G.player.heroId = p.heroId;
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
    p.hero = key;
    p.heroId = key;
    p.inventory = p.inventory || {};
    p.maxSpeed = 440;
    p.accel = 1000;

    // === Giro más sensible por defecto ===
    p.turnSpeed = 4.5;
    p.lookAngle = Math.PI / 2; // SUR
    // Asegura corazones mínimos si no hay API
    p.hp = p.hp || 3;
    p.hpMax = p.hpMax || 3;
    MovementSystem.register(p);
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
    e.group = 'animal';
    e.hostile = true;
    G.hostiles = G.hostiles || [];
    G.hostiles.push(e);
    try { window.EntityGroups?.assign?.(e); } catch (_) {}
    try { window.EntityGroups?.register?.(e, G); } catch (_) {}
    window.LOG?.event?.('SPAWN', { kind: 'MOSQUITO', id: e.id || null, x: e.x, y: e.y });
    return e;
  }

  function loadLevelWithMapGen(level=1) {
    if (!window.MapGen) return false;            // fallback al ASCII si no está el plugin

    // Tamaños por nivel (ajústalos si quieres)
    const dims = (level===1) ? {w:60,h:40}
                : (level===2) ? {w:120,h:80}
                :               {w:180,h:120};

    // Limpieza de estado como haces al cargar ASCII
    G.entities = []; G.movers = [];
    G.hostiles = [];
    G.humans = [];
    G.animals = [];
    G.objects = [];
    G.patients = []; G.pills = []; G.map = []; G.mapW = dims.w; G.mapH = dims.h;
    G.patientsTotal = 0;
    G.patientsPending = 0;
    G.patientsCured = 0;
    G.patientsFurious = 0;
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
          const px = tx * TILE + 8;
          const py = ty * TILE + 8;
          let spawnFn = null;

          if (level === 1) {
            spawnFn = window.Entities?.PatientHematologic?.spawn;
          } else if (level === 2) {
            spawnFn = window.Entities?.JefaLimpiadoras?.spawn
              || window.Entities?.jefa_limpiadoras_lvl2
              || window.CleanerBossAPI?.spawn;
          } else if (level === 3) {
            spawnFn = window.Entities?.PacientePyromana?.spawn
              || window.Entities?.PyroPatientLvl3?.spawn
              || window.Entities?.paciente_pyromana_lvl3;
          }

          if (typeof spawnFn !== 'function') {
            console.error('[BossLoadError] Boss factory missing for level', level);
            return;
          }

          const bossEnt = spawnFn(px, py);
          if (!bossEnt) {
            console.error('[BossLoadError] Boss factory returned no entity for level', level);
            return;
          }

          G.boss = bossEnt;
          if (!G.entities.includes(bossEnt)) {
            G.entities.push(bossEnt);
          }
        },
        placeEnemy: (kind,tx,ty)=>{
          const cx = tx*TILE+TILE/2;
          const cy = ty*TILE+TILE/2;
          if (kind==='mosquito') spawnMosquito(cx, cy);
          else if (kind==='rat' && window.RatsAPI?.spawn) window.RatsAPI.spawn(cx, cy, { _units:'px' });
        },
        placeSpawner: (kind,tx,ty)=>{
          const cx = tx*TILE+TILE/2;
          const cy = ty*TILE+TILE/2;
          if (kind==='mosquito') G.mosquitoSpawn = {x:cx, y:cy, t:0, n:0};
          else if (kind==='animal') {
            G.animalSpawners = Array.isArray(G.animalSpawners) ? G.animalSpawners : [];
            G.animalSpawners.push({ x: cx, y: cy, tx, ty });
          }
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
    MovementSystem.setMap(G.map, TILE);
    if (Array.isArray(G.entities)){
      for (const ent of G.entities){ MovementSystem.register(ent); }
    }

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
    G.hostiles.length = 0;
    G.patients.length = 0;
    G.pills.length = 0;
    G.humans.length = 0;
    G.animals.length = 0;
    G.objects.length = 0;
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

    G.asciiMap = Array.isArray(lines) ? lines.slice() : [];

    // === Tamaño y buffer de mapa ===
    G.mapH = lines.length;
    G.mapW = lines[0].length;
    G.map = [];

    // Recogeremos aquí los placements derivados del ASCII (en píxeles)
    const asciiPlacements = [];
    // Guarda referencia global para Placement.applyFromAsciiMap
    G.__asciiPlacements = asciiPlacements;

    const reportUnknownChar = (char, lineIndex, colIndex) => {
      if (!char || char === '.' || char === ' ' || char === '\u0000') return;
      try {
        console.warn(`[MAP_PARSE] Carácter desconocido '${char}' en línea ${lineIndex + 1}, columna ${colIndex + 1}`);
      } catch (_) {}
    };

    for (let y = 0; y < G.mapH; y++){
      const row = [];
      const line = lines[y] || '';
      for (let x = 0; x < G.mapW; x++){
        const ch = line[x] || ' ';
        const wx = x * TILE, wy = y * TILE;
        let recognized = false;
        const addPlacement = (payload) => {
          if (!payload) return;
          asciiPlacements.push({ ...payload, char: ch });
          recognized = true;
        };

        // pared/espacio (igual que la antigua)
        if (ch === '#') { row.push(1); recognized = true; }
        else { row.push(0); if (ch === '.' || ch === ' ') recognized = true; }

        // === MARCAS ASCII ===
        if (ch === 'S' || ch === 's') {
          addPlacement({ type:'player', x: wx+4, y: wy+4, _units:'px' });
          // sala segura (5x5 tiles centrados en S)
          G.safeRect = { x: wx - 2*TILE, y: wy - 2*TILE, w: 5*TILE, h: 5*TILE };
          // luz blanca suave en sala de control
          G.roomLights.push({ x: wx + TILE/2, y: wy + TILE/2, r: 5.5*TILE, baseA: 0.28 });
        }
        else if (ch === 'p' || ch === 'P') {
          // Paciente: placement (NO instanciamos aquí)
          addPlacement({ type:'patient', x: wx+4, y: wy+4, _units:'px' });
          // luz clara de sala (igual que antigua)
          G.roomLights.push({ x: wx+TILE/2, y: wy+TILE/2, r: 5.0*TILE, baseA: 0.25 });
        }
        else if (ch === 'f') {
          addPlacement({ type:'enemy', sub:'furious', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'i' || ch === 'I') {
          addPlacement({ type:'pill', x: wx+8, y: wy+8, _units:'px' });
        }
        else if (ch === 'b') {
          addPlacement({ type:'bell', x: wx+TILE*0.1, y: wy+TILE*0.1, _units:'px' });
        }
        else if (ch === 'U') {
          addPlacement({ type:'cart', sub:'er', x: wx+6, y: wy+8, _units:'px' });
        }
        else if (ch === '+') {
          addPlacement({ type:'cart', sub:'med', x: wx+6, y: wy+8, _units:'px' });
        }
        else if (ch === 'F') {
          addPlacement({ type:'cart', sub:'food', x: wx+6, y: wy+8, _units:'px' });
        }
        else if (ch === 'C') {
          addPlacement({ type:'spawn_cart', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'V') { // legacy cart spawner
          addPlacement({ type:'spawn_cart', x: wx+TILE/2, y: wy+TILE/2, _units:'px', legacy:'V' });
        }
        else if (ch === 'N') {
          addPlacement({ type:'spawn_staff', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'B') { // legacy humano spawner
          addPlacement({ type:'spawn_staff', x: wx+TILE/2, y: wy+TILE/2, _units:'px', legacy:'B' });
        }
        else if (ch === 'A') {
          addPlacement({ type:'spawn_animal', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'M') { // legacy mosquito spawner
          addPlacement({ type:'spawn_animal', x: wx+TILE/2, y: wy+TILE/2, _units:'px', prefers:'mosquito', legacy:'M' });
        }
        else if (ch === 'R') { // legacy rat spawner
          addPlacement({ type:'spawn_animal', x: wx+TILE/2, y: wy+TILE/2, _units:'px', prefers:'rat', legacy:'R' });
        }
        else if (ch === 'D' || ch === 'd') {
          addPlacement({ type:'door', x: wx, y: wy, locked:true, _units:'px' });
        }
        else if (ch === 'u') {
          addPlacement({ type:'boss_door', x: wx, y: wy, locked:true, bossDoor:true, _units:'px' });
        }
        else if (ch === 'X') {
          addPlacement({ type:'boss', x: wx+TILE/2, y: wy+TILE/2, _units:'px', tier:1 });
        }
        else if (ch === 'L') {
          addPlacement({ type:'light', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'l') {
          addPlacement({ type:'light', x: wx+TILE/2, y: wy+TILE/2, broken:true, _units:'px' });
        }
        else if (ch === 'm') { // enemigo directo: mosquito
          addPlacement({ type:'enemy', sub:'mosquito', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'r') { // enemigo directo: rata
          addPlacement({ type:'enemy', sub:'rat', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'E') { // ascensor activo
          addPlacement({ type:'elevator', active:true, x: wx, y: wy, _units:'px' });
        }
        else if (ch === 'k' || ch === 'K') { // NPC: médico
          addPlacement({ type:'npc', sub:'medico', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'H') { // NPC: jefa enfermería
          addPlacement({ type:'npc', sub:'supervisora', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 't' || ch === 'T') { // NPC: tcae
          addPlacement({ type:'npc', sub:'tcae', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'c') { // NPC: celador
          addPlacement({ type:'npc', sub:'celador', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'h') { // NPC: limpieza
          addPlacement({ type:'npc', sub:'limpieza', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'n') { // NPC: enfermera cameo
          addPlacement({ type:'npc', sub:'enfermera_sexy', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'G') { // NPC: guardia
          addPlacement({ type:'npc', sub:'guardia', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === 'g') { // charco de agua
          const spawnedWet = window.HazardsAPI?.spawnWet?.(x, y);
          if (!spawnedWet) {
            addPlacement({ type:'hazard_wet', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
          }
          recognized = true;
        }
        else if (ch === 'v') { // visitante molesto
          addPlacement({ type:'npc', sub:'familiar_molesto', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
        }
        else if (ch === '~') {
          const spawned = window.HazardsAPI?.spawnWet?.(x, y);
          if (!spawned) {
            addPlacement({ type:'hazard_wet', x: wx+TILE/2, y: wy+TILE/2, _units:'px' });
          }
          recognized = true;
        }
        // Si añades más letras ASCII, convierte aquí a placements (en píxeles).

        if (!recognized) {
          reportUnknownChar(ch, y, x);
        }
      }
      G.map.push(row);
    }

    if (!asciiPlacements.some((p) => p && String(p.type).toLowerCase() === 'player')) {
      asciiPlacements.push({ type: 'player', x: TILE*2, y: TILE*2, _units: 'px', char: 'S' });
      if (!G.safeRect) {
        G.safeRect = { x: TILE * 0, y: TILE * 0, w: 5 * TILE, h: 5 * TILE };
      }
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

    MovementSystem.setMap(G.map, TILE);

    const width = G.mapW || (lines[0]?.length || 0);
    const height = G.mapH || lines.length;
    window.LOG?.event?.('ASCII_MAP_READY', {
      mode: DEBUG_MAP_MODE ? 'debug' : 'normal',
      width,
      height,
      source: G.debugAsciiSource || (DEBUG_MAP_MODE ? 'debug' : 'procedural')
    });
    logThrough('info', '[map] ASCII preparado', {
      mode: DEBUG_MAP_MODE ? 'debug' : 'normal',
      width,
      height,
      source: G.debugAsciiSource || (DEBUG_MAP_MODE ? 'debug' : 'procedural')
    });
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

  function notifySpawnerOnDeath(entity, population, template){
    const api = (window.SpawnerAPI && typeof window.SpawnerAPI.notifyDeath === 'function') ? window.SpawnerAPI : null;
    if (!api || !entity) return;
    const payload = Object.assign({ entity }, template || {});
    try { api.notifyDeath(population ? { population, template: payload, entity } : { entity }); }
    catch (err) { if (window.DEBUG_SPAWNER) console.warn('[SpawnerAPI] notifyDeath error', err); }
  }

  function killEnemy(e, meta){
      if (e.dead) return;
      e.dead = true;
      if (typeof e.onKilled === 'function') {
        try { e.onKilled(meta || {}); } catch (_) {}
      }
      if (window.ScoreAPI){ try{ ScoreAPI.awardForDeath(e, Object.assign({cause:'killEnemy'}, meta||{})); }catch(_){} }
    // saca de las listas
    G.hostiles = G.hostiles.filter(x => x !== e);
    G.entities = G.entities.filter(x => x !== e);
    detachEntityRig(e);
    MovementSystem.unregister(e);
    if (matchesKind(e, 'MOSQUITO')) notifySpawnerOnDeath(e, 'animals', { kind: 'mosquito' });
    else if (matchesKind(e, 'RAT')) notifySpawnerOnDeath(e, 'animals', { kind: 'rat' });
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
    if (typeof e.onKilled === 'function') {
      try { e.onKilled(meta || {}); } catch (_) {}
    }
    if (window.ScoreAPI){ try{ ScoreAPI.awardForDeath(e, Object.assign({cause:'killEntityGeneric'}, meta||{})); }catch(_){} }

    // quítalo de todas las listas donde pueda estar
    G.entities = G.entities.filter(x => x !== e);
    G.movers   = G.movers.filter(x => x !== e);
    G.hostiles  = G.hostiles.filter(x => x !== e);
    detachEntityRig(e);
    try { window.EntityGroups?.unregister?.(e, G); } catch (_) {}
    G.patients = G.patients.filter(x => x !== e);
    MovementSystem.unregister(e);
    if (matchesKind(e, 'CART')) {
      notifySpawnerOnDeath(e, 'carts', { kind: (e.cartType || e.cartTier || 'cart').toString().toLowerCase() });
    } else if (e.role || matchesKind(e, 'NPC')) {
      const role = (e.role || e.kindName || e.kind || '').toString().toLowerCase();
      notifySpawnerOnDeath(e, 'humans', { role, kind: role || undefined });
    }

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
  const HERO_LOVE_SPEED = 110;

  function findEntityById(id){
    if (!id || !Array.isArray(G.entities)) return null;
    for (const ent of G.entities){
      if (!ent) continue;
      if (ent.id === id || ent.__id === id) return ent;
    }
    return null;
  }

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

  function handleLovePursuit(p, dt){
    if (!p || !p.loveLock) return false;
    const target = findEntityById(p.loveLock);
    if (!target || target.dead || (target.ai && target.ai.state !== 'love')){
      p.loveLock = null;
      return false;
    }
    const pcx = p.x + p.w * 0.5;
    const pcy = p.y + p.h * 0.5;
    const ncx = target.x + target.w * 0.5;
    const ncy = target.y + target.h * 0.5;
    const dx = ncx - pcx;
    const dy = ncy - pcy;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = Math.min(p.maxSpeed || HERO_LOVE_SPEED, HERO_LOVE_SPEED);
    p.vx = (dx / dist) * speed;
    p.vy = (dy / dist) * speed;
    softFacingFromKeys(p, dx, dy, dt);
    if (dist < TILE * 0.6){
      p.vx *= 0.4;
      p.vy *= 0.4;
    }
    if (dx || dy){
      G.lastPushDir = { x: Math.sign(dx) || 0, y: Math.sign(dy) || 0 };
    }
    return true;
  }

  function handleInput(dt) {
    const p = G.player;
    if (!p) return;

    if (p.stunTimer && p.stunTimer > 0) {
      const stunDt = Math.max(0, Number(dt) || 0);
      p.stunTimer = Math.max(0, p.stunTimer - stunDt);
      p.isStunned = p.stunTimer > 0;
      p.vx *= 0.4;
      p.vy *= 0.4;
      if (!p.isStunned) {
        p.stunSource = null;
      }
      return;
    } else if (p.isStunned) {
      p.isStunned = false;
    }

    if (handleLovePursuit(p, dt)) {
      return;
    }

    const R = !!keys['arrowright'], L = !!keys['arrowleft'];
    const D = !!keys['arrowdown'],  U = !!keys['arrowup'];
    let dx = (R ? 1 : 0) - (L ? 1 : 0);
    let dy = (D ? 1 : 0) - (U ? 1 : 0);
    const confused = (() => {
      const checker = window.Entities?.Hero?.isConfused;
      if (typeof checker === 'function') return checker(p);
      const status = p.status || {};
      const now = (performance?.now ? performance.now() : Date.now()) / 1000;
      if (status.confused && (!status.confusedUntil || status.confusedUntil > now)) return true;
      if (status.confused && status.confusedUntil <= now) {
        status.confused = false;
        status.confusedSource = null;
      }
      return false;
    })();
    if (confused) {
      dx = -dx;
      dy = -dy;
      const wobble = Math.sin((performance?.now ? performance.now() : Date.now()) / 160);
      dx += wobble * 0.25;
      dy -= wobble * 0.25;
    }
    if (p._doctorInvertControls) {
      dx = -dx;
      dy = -dy;
    }

    if (window.DEBUG_FORCE_ASCII) {
      // log discreto solo en debug
      //console.log('[INPUT] arrows', {U,D,L,R, dx, dy});
    }

    if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }

    // ROTACIÓN SUAVE DEL CONO (teclado)
    softFacingFromKeys(p, dx, dy, dt);

    // === NUEVO: aceleración y tope de velocidad ===
    let accel = (p.accel != null) ? p.accel
              : (p.speed != null) ? p.speed * 60    // compat viejo
              : 800;                                  // fallback seguro
    let maxSp = (p.maxSpeed != null) ? p.maxSpeed
              : (BALANCE?.physics?.maxSpeedPlayer ?? 165);
    if (confused) {
      accel *= 0.9;
      maxSp *= 0.9;
    }

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

  function assignCarryFromPill(hero, pill) {
    if (!pill || pill.dead) return false;
    const carrier = hero || G.player || null;
    if (!carrier) return false;
    const kindStr = (pill.kind || pill.kindName || '').toString().toLowerCase();
    const isDoctorPill = kindStr === 'pill_doctor' || pill.source === 'doctor';
    if (isDoctorPill) {
      const applied = window.MedicoAPI?.applyDoctorBuff?.(carrier, pill.buff);
      removePillEntity(pill);
      return !!applied;
    }
    if (carrier.carry || G.carry) return false;
    const carry = {
      type: 'PILL',
      kind: 'PILL',
      id: pill.id,
      label: pill.label || 'Pastilla',
      patientName: pill.targetName || pill.patientName || null,
      pairName: pill.pairName || null,
      anagram: pill.anagram || null,
      forPatientId: pill.forPatientId || pill.patientId || null,
      patientId: pill.patientId || pill.forPatientId || null,
      targetPatientId: pill.forPatientId || pill.patientId || null,
    };
    carrier.carry = carry;
    G.carry = carry;
    carrier.currentPill = carry;
    G.currentPill = carry;
    carrier.inventory = carrier.inventory || {};
    carrier.inventory.medicine = Object.assign({}, carry);
    console.debug('[PILL] Player picked pill', { pillId: carry.id || pill.id || null, targetPatientId: carry.targetPatientId || null });
    try { window.ObjectiveSystem?.onPillPicked?.(carry); } catch (_) {}
    try { window.LOG?.event?.('PILL_PICKUP', { pill: pill.id, for: carry.forPatientId || null }); } catch (_) {}
    removePillEntity(pill);
    try {
      window.HUD?.showFloatingMessage?.(carrier, `Has cogido medicina para ${carry.patientName || 'un paciente'}`, 1.6);
    } catch (_) {}
    return true;
  }

  function removePillEntity(pill) {
    if (!pill) return;
    if (Array.isArray(G.entities)) G.entities = G.entities.filter((x) => x !== pill);
    if (Array.isArray(G.movers)) G.movers = G.movers.filter((x) => x !== pill);
    if (Array.isArray(G.pills)) G.pills = G.pills.filter((x) => x !== pill);
    detachEntityRig(pill);
    pill.dead = true;
  }

  function resolveHeroCarry(hero) {
    if (hero?.currentPill) return hero.currentPill;
    if (hero?.carry) return hero.carry;
    if (hero?.inventory?.medicine) return hero.inventory.medicine;
    if (G.currentPill) return G.currentPill;
    if (G.carry) return G.carry;
    return null;
  }

  function afterManualDelivery(patient){
    if (patient) {
      try { patient.onCure?.(); } catch (_) {}
    }
    G.delivered = (G.delivered || 0) + 1;
    const stats = G.stats || {};
    const snapshot = typeof window.patientsSnapshot === 'function' ? window.patientsSnapshot() : null;
    const pending = snapshot ? snapshot.pending : (stats.remainingPatients || 0);
    const furious = snapshot ? snapshot.furious : (stats.activeFuriosas || 0);
    if (pending === 0 && furious === 0) {
      try { window.ArrowGuide?.setTargetBossOrDoor?.(); } catch (_) {}
    }
  }

  function shouldLogPillDeliveryDebug() {
    return !!(window.DEBUG_PILL_DELIVERY || window.DEBUG_FORCE_ASCII || window.DEBUG_MAP_MODE);
  }

  function logPillDeliveryDebug(hero, patient, extra = {}) {
    if (!shouldLogPillDeliveryDebug()) return;
    const carry = hero?.currentPill || hero?.carry || hero?.inventory?.medicine || G.carry || G.currentPill || null;
    const payload = {
      playerHasPill: !!carry,
      pillId: carry?.id || null,
      pillTarget: carry?.targetPatientId || carry?.forPatientId || carry?.patientId || null,
      patientId: patient?.id || null,
      patientName: patient?.displayName || patient?.name || null,
      distance: extra.distance ?? null,
      canDeliver: extra.canDeliver ?? null,
      reason: extra.reason || null,
    };
    console.debug('[PILL_DELIVERY_DEBUG]', payload);
  }

  function logPillContactCheck(hero, patient, extra = {}) {
    if (!hero && !patient) return;
    const carry = resolveHeroCarry(hero);
    let dist = extra.distance ?? null;
    if (!Number.isFinite(dist) && hero && patient) {
      const hx = hero.x + hero.w * 0.5;
      const hy = hero.y + hero.h * 0.5;
      const px = patient.x + (patient.w || 0) * 0.5;
      const py = patient.y + (patient.h || 0) * 0.5;
      dist = Math.hypot(px - hx, py - hy);
    }
    const safeDist = Number.isFinite(dist) ? Number(dist.toFixed(2)) : null;
    console.debug('[PILL_CONTACT_CHECK]', {
      heroId: hero?.id || hero?.heroId || 'player',
      heroHasPill: !!carry,
      heroPill: carry || null,
      patientId: patient?.id || null,
      patientName: patient?.displayName || patient?.name || null,
      patientTags: patient?.tags || null,
      distance: safeDist,
      reason: extra.reason || null,
    });
  }

  function findPatientContact(hero, opts = {}) {
    if (!hero || !Array.isArray(G.patients)) return null;
    const patients = G.patients;
    const maxRange = Number.isFinite(opts.maxRange)
      ? opts.maxRange
      : (window.TILE_SIZE || window.TILE || 32) * (opts.rangeMultiplier || 1.2);
    const padding = Number.isFinite(opts.nearPadding) ? opts.nearPadding : 12;
    const hx = hero.x + hero.w * 0.5;
    const hy = hero.y + hero.h * 0.5;
    let target = null;
    let bestDist = Infinity;
    for (const pac of patients) {
      if (!pac || pac.dead || pac.hidden || pac.attended) continue;
      if (opts.requireOverlap) {
        if (!AABB(hero, pac)) continue;
      } else if (!nearAABB(hero, pac, padding)) {
        continue;
      }
      const px = pac.x + (pac.w || 0) * 0.5;
      const py = pac.y + (pac.h || 0) * 0.5;
      const dist = Math.hypot(px - hx, py - hy);
      if (dist <= maxRange && dist < bestDist) {
        bestDist = dist;
        target = pac;
      }
    }
    if (!target) return null;
    return { patient: target, distance: bestDist };
  }

  function tryDeliverPillFromAction(hero, opts = {}) {
    const carrying = hero?.carry || G.carry;
    if (!carrying || (carrying.kind !== 'PILL' && carrying.type !== 'PILL')) return false;
    const contact = findPatientContact(hero, {
      maxRange: opts.maxRange,
      rangeMultiplier: opts.rangeMultiplier || 1.2,
      nearPadding: opts.nearPadding ?? 12,
      requireOverlap: opts.requireOverlap || false,
    });
    if (!contact) return false;
    const target = contact.patient;
    const bestDist = contact.distance;
    logPillContactCheck(hero, target, { distance: bestDist, reason: opts.reason || 'action_button' });
    if (target?.isHematologic) {
      return window.HematologicPatientAPI?.tryDeliver?.(hero, target) || false;
    }
    if (target?.isJefaLimpiadoras) {
      return window.CleanerBossAPI?.tryTreat?.(hero, target) || false;
    }
    const canDeliver = (window.PatientsAPI && typeof window.PatientsAPI.canDeliver === 'function')
      ? window.PatientsAPI.canDeliver(hero, target)
      : false;
    const safeDist = Number.isFinite(bestDist) ? Number(bestDist.toFixed(2)) : null;
    logPillDeliveryDebug(hero, target, { distance: safeDist, canDeliver, reason: canDeliver ? 'match' : 'target_mismatch' });
    if (canDeliver) {
      const delivered = window.PatientsAPI?.deliverPill?.(hero, target);
      if (delivered) afterManualDelivery(target);
      return true;
    }
    if (!opts?.silentOnMismatch) {
      window.PatientsAPI?.wrongDelivery?.(target);
    }
    return true;
  }

  function autoDeliverPillIfTouching(hero) {
    const carry = resolveHeroCarry(hero);
    if (!carry || (carry.kind !== 'PILL' && carry.type !== 'PILL')) return false;
    const contact = findPatientContact(hero, {
      requireOverlap: true,
      nearPadding: 4,
      rangeMultiplier: 0.9,
    });
    if (!contact) return false;
    const patient = contact.patient;
    if (patient?.isHematologic) {
      return window.HematologicPatientAPI?.tryDeliver?.(hero, patient) || false;
    }
    if (patient?.isJefaLimpiadoras) {
      return window.CleanerBossAPI?.tryTreat?.(hero, patient) || false;
    }
    const canDeliver = (window.PatientsAPI && typeof window.PatientsAPI.canDeliver === 'function')
      ? window.PatientsAPI.canDeliver(hero, patient)
      : false;
    const safeDist = Number.isFinite(contact.distance) ? Number(contact.distance.toFixed(2)) : null;
    logPillDeliveryDebug(hero, patient, { distance: safeDist, canDeliver, reason: canDeliver ? 'auto_match' : 'auto_target_mismatch' });
    if (!canDeliver) return false;
    const delivered = window.PatientsAPI?.deliverPill?.(hero, patient);
    if (delivered) afterManualDelivery(patient);
    return delivered;
  }

  function trackHeroPatientContact(hero) {
    if (!hero) return;
    const contact = findPatientContact(hero, {
      requireOverlap: true,
      nearPadding: 2,
      rangeMultiplier: 0.8,
    });
    if (!contact) {
      G._lastPillContactPatientId = null;
      G._lastPillContactHasPill = null;
      return;
    }
    const carry = resolveHeroCarry(hero);
    const hasPill = !!carry;
    const patientId = contact.patient?.id || null;
    if (G._lastPillContactPatientId === patientId && G._lastPillContactHasPill === hasPill) {
      return;
    }
    G._lastPillContactPatientId = patientId;
    G._lastPillContactHasPill = hasPill;
    logPillContactCheck(hero, contact.patient, { distance: contact.distance, reason: 'contact_track' });
  }

  function isCartEntity(ent){
    if (!ent) return false;
    const ENT = window.ENT || {};
    if (typeof ENT.CART === 'number' && ent.kind === ENT.CART) return true;
    if (ent.kind === 5) return true;
    if (ent.cartType || ent._tag === 'cart' || ent.type === 'cart') return true;
    const rig = (ent.rigName || ent.puppet?.rigName || '').toString().toLowerCase();
    if (rig.includes('cart')) return true;
    const tag = (ent.tag || '').toString().toLowerCase();
    if (tag.includes('cart') || tag.includes('carro')) return true;
    const name = (ent.kindName || '').toString().toLowerCase();
    return name.includes('cart') || name.includes('carro');
  }

  function isBedEntity(ent){
    if (!ent) return false;
    const ENT = window.ENT || {};
    if (typeof ENT.BED === 'number' && ent.kind === ENT.BED) return true;
    const tag = (ent.tag || ent.type || '').toString().toLowerCase();
    if (tag.includes('bed') || tag.includes('cama')) return true;
    const rig = (ent.rigName || ent.puppet?.rigName || '').toString().toLowerCase();
    return rig.includes('bed');
  }

  function physicsConfig(){
    const api = window.Physics || null;
    if (!api) return null;
    return api.PHYS || api.DEFAULTS || null;
  }

  function ensurePushableProfile(ent){
    if (!ent) return null;
    const existing = ent._physProfile;
    if (existing && typeof existing.maxSpeedPx === 'number') return existing;
    const phys = physicsConfig();
    if (!phys) return existing || null;
    const tile = window.TILE_SIZE || window.TILE || TILE;

    if (isCartEntity(ent) && phys.cartProfiles){
      const raw = (ent.cartType || ent.type || ent.kindName || '').toString().toLowerCase();
      const key = raw.includes('er') || raw.includes('urgencias') ? 'er'
        : raw.includes('med') || raw.includes('medicine') ? 'med'
        : 'food';
      const profile = phys.cartProfiles[key] || phys.cartProfiles.food || null;
      if (profile){
        if (Number.isFinite(profile.mass)) {
          ent.mass = profile.mass;
          ent.invMass = profile.mass > 0 ? 1 / profile.mass : 0;
        }
        if (Number.isFinite(profile.restitution)) {
          ent.rest = profile.restitution;
          ent.restitution = profile.restitution;
        }
        const frictionValue = Number.isFinite(profile.friction) ? Math.max(0, Math.min(profile.friction, 1)) : null;
        if (Number.isFinite(profile.mu)) {
          ent.mu = Math.max(0, Math.min(profile.mu, 0.25));
        } else if (frictionValue != null) {
          ent.mu = Math.max(0, Math.min((1 - frictionValue) * 0.5, 0.25));
        }
        if (Number.isFinite(profile.slideFriction)) {
          const slide = Math.max(0.002, Math.min(profile.slideFriction, 0.3));
          ent._slideFrictionOverride = slide;
          ent.slideFriction = slide;
        } else if (frictionValue != null) {
          const slide = Math.max(0.002, Math.min(0.22, (1 - frictionValue) * 0.2 + 0.002));
          ent._slideFrictionOverride = slide;
          ent.slideFriction = slide;
        }
        if (Number.isFinite(profile.drag)) {
          const drag = Math.max(0.005, Math.min(profile.drag, 0.25));
          ent._frictionOverride = drag;
          ent.friction = drag;
        }
        if (Number.isFinite(profile.vmax)) ent.maxSpeed = profile.vmax;
        const maxSpeedPx = Number.isFinite(profile.vmax) ? profile.vmax * tile : null;
        ent._physProfile = {
          type: 'cart',
          key,
          vmax: profile.vmax,
          maxSpeedPx,
          restitution: profile.restitution,
          mu: ent.mu,
          slide: ent._slideFrictionOverride,
          drag: ent._frictionOverride
        };
        ent.slide = true;
        return ent._physProfile;
      }
    }

    if (isBedEntity(ent) && phys.bedProfiles){
      const rig = (ent.rigName || ent.puppet?.rigName || '').toString().toLowerCase();
      const key = rig.includes('patient') || rig.includes('paciente') ? 'bed_patient' : 'bed';
      const profile = phys.bedProfiles[key] || phys.bedProfiles.bed || null;
      if (profile){
        if (Number.isFinite(profile.mass)) {
          ent.mass = profile.mass;
          ent.invMass = profile.mass > 0 ? 1 / profile.mass : 0;
        }
        if (Number.isFinite(profile.restitution)) {
          ent.rest = profile.restitution;
          ent.restitution = profile.restitution;
        }
        if (Number.isFinite(profile.friction)) {
          const friction = Math.max(0, Math.min(profile.friction, 1));
          const slip = Math.max(0, Math.min((1 - friction) * 0.45, 0.25));
          const slide = Math.max(0.004, Math.min(0.2, (1 - friction) * 0.18 + 0.004));
          ent.mu = slip;
          ent._slideFrictionOverride = slide;
        }
        if (Number.isFinite(profile.vmax)) ent.maxSpeed = profile.vmax;
        const maxSpeedPx = Number.isFinite(profile.vmax) ? profile.vmax * tile : null;
        ent._physProfile = {
          type: 'bed',
          key,
          vmax: profile.vmax,
          maxSpeedPx,
          restitution: profile.restitution
        };
        ent.slide = true;
        return ent._physProfile;
      }
    }

    return existing || ent._physProfile || null;
  }

  function computePushForce(baseForce){
    const phys = physicsConfig();
    const mulCfg = phys?.pushMultipliers || {};
    let multiplier = Number.isFinite(mulCfg.base) ? mulCfg.base : 1;
    const hero = G.player;
    const heroKey = ((hero && (hero.heroId || hero.hero || hero.skin)) || window.selectedHeroKey || '').toString().toLowerCase();
    if (heroKey && Number.isFinite(mulCfg[heroKey])) {
      multiplier *= mulCfg[heroKey];
    }
    const baseBuff = Number.isFinite(G.pushMultiplier) ? G.pushMultiplier : 1;
    const syringeMul = (G.powerup && G.powerup.type === 'syringe-red' && Number.isFinite(mulCfg.syringeRed))
      ? mulCfg.syringeRed
      : 1;
    multiplier *= Math.max(baseBuff, syringeMul);
    return baseForce * multiplier;
  }

  function pushEntityWithImpulse(target, dir, baseForce){
    if (!target) return null;
    const pushDir = normalizeVec(dir.x || 0, dir.y || 0);
    if (!pushDir.x && !pushDir.y) return null;
    const physCfg = physicsConfig() || {};
    const totalForce = computePushForce(baseForce);
    const profile = ensurePushableProfile(target);
    const isCart = isCartEntity(target);
    const isBed = isBedEntity(target);
    const mass = Number.isFinite(target.mass) ? Math.max(0.25, target.mass) : 1;
    let impulse;
    if (isCart || isBed){
      const boost = Number.isFinite(physCfg.cartPushBoost) ? physCfg.cartPushBoost : 1.6;
      const massFactor = Number.isFinite(physCfg.cartPushMassFactor) ? physCfg.cartPushMassFactor : 0.28;
      const meta = isCart ? (window.Physics?.assignCartPhysicsMetadata?.(target) || target.cartPhysics || null) : null;
      const pushMul = meta?.pushImpulse ?? 1;
      impulse = totalForce * boost * pushMul / Math.max(0.25, mass * massFactor);
    } else {
      impulse = totalForce / Math.max(1, mass * 0.5);
    }

    const ix = pushDir.x * impulse;
    const iy = pushDir.y * impulse;
    target.vx = (target.vx || 0) + ix;
    target.vy = (target.vy || 0) + iy;

    const tile = window.TILE_SIZE || window.TILE || TILE;
    let maxSpeedPx = profile && Number.isFinite(profile.maxSpeedPx) ? profile.maxSpeedPx : null;
    if (!Number.isFinite(maxSpeedPx) && Number.isFinite(target.maxSpeed)) {
      maxSpeedPx = target.maxSpeed * tile;
    }
    if ((isCart || isBed) && !Number.isFinite(maxSpeedPx) && Number.isFinite(physCfg.cartMaxSpeed)) {
      maxSpeedPx = physCfg.cartMaxSpeed;
    }
    let minSpeedPx = null;
    if (isCart || isBed){
      if (profile && Number.isFinite(profile.maxSpeedPx)) {
        const baseMin = Number.isFinite(physCfg.cartMinSpeed) ? physCfg.cartMinSpeed : 0;
        const derived = profile.maxSpeedPx * 0.35;
        minSpeedPx = Math.max(baseMin, derived);
      } else if (Number.isFinite(physCfg.cartMinSpeed)) {
        minSpeedPx = physCfg.cartMinSpeed;
      }
    }

    const speed = Math.hypot(target.vx || 0, target.vy || 0);
    if (Number.isFinite(minSpeedPx) && speed < minSpeedPx){
      const factor = minSpeedPx / Math.max(speed, 1);
      target.vx *= factor;
      target.vy *= factor;
    }
    if (Number.isFinite(maxSpeedPx) && speed > maxSpeedPx){
      const factor = maxSpeedPx / speed;
      target.vx *= factor;
      target.vy *= factor;
    }

    if (profile && Number.isFinite(profile.restitution)) {
      const rest = profile.restitution;
      if (!Number.isFinite(target.restitution) || target.restitution < rest) target.restitution = rest;
      if (!Number.isFinite(target.rest) || target.rest < rest) target.rest = rest;
    }
    return { ix, iy, impulse, totalForce, minSpeedPx, maxSpeedPx };
  }

  function doAction() {
    const p = G.player;
    if (!p) return;
    if (G.state !== 'PLAYING') return;
    if (window.GameFlowAPI?.isReadyOverlayActive?.()) return;

    if (Array.isArray(G.onInteract)) {
      for (const fn of [...G.onInteract]) {
        try {
          if (typeof fn === 'function' && fn(p)) {
            return;
          }
        } catch (err) {
          console.warn('[Interact] handler error', err);
        }
      }
    }

    const talkRange = TILE * 1.2;
    if (Array.isArray(G.humans) && window.DialogAPI?.open){
      const px = p.x + p.w * 0.5;
      const py = p.y + p.h * 0.5;
      for (const npc of G.humans){
        if (!npc || npc.dead) continue;
        const nx = npc.x + (npc.w || 0) * 0.5;
        const ny = npc.y + (npc.h || 0) * 0.5;
        const dist = Math.hypot(nx - px, ny - py);
        if (dist > talkRange) continue;
        const lines = Array.isArray(npc.dialogLines)
          ? npc.dialogLines
          : (npc.dialog ? [String(npc.dialog)] : null);
      if (lines && lines.length){
        const title = npc.dialogTitle || npc.name || 'Conversación';
        const text = lines.join('\n\n');
        window.DialogAPI.open({
          title,
          text,
          buttons: [{ id: 'ok', label: 'Cerrar', action: () => window.DialogAPI.close() }]
        });
        try { window.Entities?.Hero?.setTalking?.(p, true, Math.max(2.5, lines.length * 1.2)); } catch(err){ if (window.DEBUG_FORCE_ASCII) console.warn('[Hero] talk trigger error', err); }
        return;
      }
    }
    }

    if (!p.carry && !G.carry) {
      const range = Math.max(p.w || 0, p.h || 0, (window.TILE_SIZE || window.TILE || 32) * 0.9);
      let best = null;
      let bestDist = Infinity;
      const hx = p.x + (p.w || 0) * 0.5;
      const hy = p.y + (p.h || 0) * 0.5;
      const source = Array.isArray(G.pills) && G.pills.length ? G.pills : G.entities;
      for (const pill of source || []) {
        if (!pill || pill.dead || !matchesKind(pill, 'PILL')) continue;
        const px = pill.x + (pill.w || 0) * 0.5;
        const py = pill.y + (pill.h || 0) * 0.5;
        const dist = Math.hypot(px - hx, py - hy);
        if (dist <= range && dist < bestDist) {
          best = pill;
          bestDist = dist;
        }
      }
      if (best && assignCarryFromPill(p, best)) {
        return;
      }
    }

    if (tryDeliverPillFromAction(p)) {
      return;
    }

    // 1 segundo de anim de empuje
    p.pushAnimT = 1;

    // Dirección desde el facing actual
    const dir = resolvePushDirection(p);
    const hit = findPushableInFront(p, dir);
    if (shouldDebugPushLogs()){
      console.debug('[PUSH] Player intent', {
        playerId: p.id || p.heroId || 'player',
        dir,
        targetId: hit?.id || null,
        targetKind: hit?.kindName || hit?.kind || null,
        group: hit?.group || null
      });
    }
    try { window.Entities?.Hero?.triggerPush?.(p, { heavy: !!(hit && (hit.mass || 0) > 140) }); } catch(err){ if (window.DEBUG_FORCE_ASCII) console.warn('[Hero] push trigger error', err); }
    if (hit) {
      if (isCartEntity(hit) && (G.urgenciasOpen || window.GameFlowAPI?.getState?.()?.bossDoorOpened)) {
        try { window.ObjectiveSystem?.onCartEngaged?.(hit); } catch (_) {}
      }
      // 1) Desatasco preventivo: si está tocando muro, sácalo o colócalo en un punto libre cercano
      try { if (window.Physics?.snapInsideMap) Physics.snapInsideMap(hit); } catch(_){}
      if (typeof isWallAt === 'function' && isWallAt(hit.x, hit.y, hit.w, hit.h)) {
        // pequeño “paso atrás” de 2px alejándolo del muro antes del empuje
        hit.x -= dir.x * 2;
        hit.y -= dir.y * 2;
      }

      // 2) Empuje normal
      const F = (p.pushForce ?? p.push ?? FORCE_PLAYER);
      let scaledForce = F;
      const aheadX = hit.x + hit.w * 0.5 + dir.x * (hit.w * 0.5 + 4) - hit.w * 0.5;
      const aheadY = hit.y + hit.h * 0.5 + dir.y * (hit.h * 0.5 + 4) - hit.h * 0.5;
      let blockedAhead = (typeof isWallAt === 'function' && isWallAt(aheadX, aheadY, hit.w, hit.h));
      if (!blockedAhead && Array.isArray(G.entities)){
        const aheadBox = { x: aheadX, y: aheadY, w: hit.w, h: hit.h };
        blockedAhead = G.entities.some((ent) => ent && ent !== hit && ent.solid && ent.static && !ent.dead && AABB(aheadBox, ent));
      }
      if (blockedAhead) {
        scaledForce *= 0.25;
        if (shouldDebugPushLogs()){
          console.debug('[PUSH] Blocked by wall/solid', { targetId: hit.id || null, reducedForce: scaledForce });
        }
      }
      const impulseMeta = pushEntityWithImpulse(hit, dir, scaledForce);
      if (shouldDebugPushLogs()){
        console.debug('[PUSH] Impulse applied', {
          targetId: hit.id || null,
          vx: hit.vx || 0,
          vy: hit.vy || 0,
          impulse: impulseMeta || null
        });
      }

      // 3) Marca de autor del empuje (para atribuir kills)
      hit._lastPushedBy   = (p.tag==='follower' ? 'HERO' : 'PLAYER');
      hit._lastPushedId   = p.id || p._nid || p._uid || 'player1';
      hit._pushedByEnt    = p;                // referencia útil si la necesitas
      hit._lastPushedTime = performance.now();
      if (hit.kind === ENT.CART && !hit.dead) {
        const cartType = (hit.cartType || hit.type || '').toLowerCase();
        const isEmergency = cartType === 'er' || hit.cart === 'urgencias' || hit.tag === 'emergency';
        if (isEmergency) {
          const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          if (!hit._narratorCartCue || now - hit._narratorCartCue > 6000) {
            hit._narratorCartCue = now;
            try {
              window.Narrator?.say?.('cart_push', {});
              window.Narrator?.progress?.();
            } catch (_) {}
          }
        }
      }
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
    try { window.Entities?.Hero?.notifyDamage?.(p, { source: src || (isRatHit ? 'bite' : 'impact'), duration: isRatHit ? 0.4 : 0.6 }); } catch(err){ if (window.DEBUG_FORCE_ASCII) console.warn('[Hero] damage notify error', err); }

    // knockback desde 'src' hacia fuera
    if (src){
      const dx = (p.x + p.w/2) - (src.x + src.w/2);
      const dy = (p.y + p.h/2) - (src.y + src.h/2);
      const n = Math.hypot(dx,dy) || 1;
      p.vx += (dx/n) * 160;
      p.vy += (dy/n) * 160;
    }

    if (G.health <= 0){
      G.health = 0;
      G._gameOverReason = isRatHit ? 'rat_hit' : 'health_zero';
      try { window.Entities?.Hero?.setDeathCause?.(p, isRatHit ? 'bite' : (src || 'impact')); } catch(err){ if (window.DEBUG_FORCE_ASCII) console.warn('[Hero] set death cause error', err); }
      setGameState('GAMEOVER');
      window.GameFlowAPI?.notifyHeroDeath?.();
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

  function normalizeVec(x, y){
    const len = Math.hypot(x, y);
    if (!len || !isFinite(len)) return { x: 0, y: 0 };
    return { x: x / len, y: y / len };
  }

  function resolvePushDirection(p){
    if (!p) return { x: 0, y: 0 };
    const vel = Math.hypot(p.vx || 0, p.vy || 0);
    if (vel > 0.1) return normalizeVec(p.vx || 0, p.vy || 0);
    if (G.lastPushDir && (G.lastPushDir.x || G.lastPushDir.y)) {
      return normalizeVec(G.lastPushDir.x || 0, G.lastPushDir.y || 0);
    }
    const facing = facingDir(p.facing);
    return normalizeVec(facing.x, facing.y);
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
    const list = Array.isArray(G.entities) && G.entities.length ? G.entities : G.movers;
    if (!Array.isArray(list)) return null;
    const px = p.x + p.w * 0.5;
    const py = p.y + p.h * 0.5;
    let best = null;
    let bestDist = Infinity;
    for (const e of list) {
      if (!e || e === p || e.dead) continue;
      if (!isPinballCandidate(e)) continue;
      if (!AABB(box, e)) continue;
      const cx = e.x + e.w * 0.5;
      const cy = e.y + e.h * 0.5;
      const toX = cx - px;
      const toY = cy - py;
      if ((toX * dir.x + toY * dir.y) < -4) continue;
      const dist = Math.hypot(toX, toY);
      if (dist < bestDist) {
        best = e;
        bestDist = dist;
      }
    }
    if (p) p._pushCandidate = best || null;
    G.pushCandidate = best || null;
    return best;
  }

  // Paso de IA específica por entidad hostil (antes de la física)
  function runEntityAI(dt){
    const ents = Array.isArray(G.entities) ? G.entities : null;
    const useCulling = !!currentCullingInfo && Array.isArray(ents);
    const toProcess = useCulling
      ? ents.filter((ent) => ent && !ent.dead && shouldUpdateEntity(ent))
      : (Array.isArray(ents) ? ents : []);
    let ragdollSuppressed = null;
    let originalEntities = null;
    if (window.AI?.update) {
      if (toProcess && toProcess.length){
        ragdollSuppressed = [];
        for (const ent of toProcess){
          if (!ent || ent.dead) continue;
          const ragdolling = (ent._ragdollTimer || 0) > 0 || ent.ragdolling || ent.ragdoll;
          if (!ragdolling) continue;
          ragdollSuppressed.push(ent);
          if (typeof ent.intentVx === 'number'){ ent._ragAI_prevVX = ent.intentVx; ent.intentVx = 0; }
          if (typeof ent.intentVy === 'number'){ ent._ragAI_prevVY = ent.intentVy; ent.intentVy = 0; }
        }
      }
      if (useCulling && toProcess !== ents){
        originalEntities = G.entities;
        G.entities = toProcess;
      }
      try {
        window.AI.update(G, dt);
        return;
      } catch (err) {
        if (window.DEBUG_FORCE_ASCII) console.warn('[AI] update error', err);
      } finally {
        if (useCulling && originalEntities) {
          G.entities = originalEntities;
        }
        if (ragdollSuppressed && ragdollSuppressed.length){
          for (const ent of ragdollSuppressed){
            if (!ent) continue;
            if (typeof ent._ragAI_prevVX === 'number'){ ent.intentVx = ent._ragAI_prevVX; }
            if (typeof ent._ragAI_prevVY === 'number'){ ent.intentVy = ent._ragAI_prevVY; }
            delete ent._ragAI_prevVX;
            delete ent._ragAI_prevVY;
          }
        }
      }
    }

    if (!Array.isArray(toProcess) || !toProcess.length) return;
    const dbg = !!window.DEBUG_FORCE_ASCII;
    for (const ent of toProcess){
      if (!ent || ent.dead) continue;
      if ((ent._ragdollTimer || 0) > 0 || ent.ragdolling || ent.ragdoll) continue;
      try {
        if (matchesKind(ent, 'RAT') && window.Rats?.ai){
          window.Rats.ai(ent, G, dt);
        } else if (matchesKind(ent, 'MOSQUITO') && window.Mosquitos?.ai){
          window.Mosquitos.ai(ent, G, dt);
        }
      } catch (err){
        if (dbg) console.warn('[AI] error', ent.kind || ent.kindName || ent, err);
      }
    }
  }

  // Actualiza TODAS las entidades del juego: enemigos, NPC, carros, puertas, ascensores, etc.
  // - Llama al método update(dt) propio de cada entidad (IA y lógica de contacto).
  // - Gestiona movimiento y colisiones de forma uniforme.
  // - Ejecuta la lógica de respawn desde SpawnerManager (para enemigos, NPC y carros).
  // - Muestra logs de depuración en modo debug (?map=debug).
  // Actualiza TODAS las entidades (IA + física) evitando doble movimiento
  function updateEntities(dt){
    const dbg = !!window.DEBUG_FORCE_ASCII;
    if (!Array.isArray(G.entities)) return;
    for (const e of G.entities){
      if (!e || e.dead) continue;
      MovementSystem.register(e);
      const ragTimer = Number.isFinite(e?._ragdollTimer) ? e._ragdollTimer : 0;
      if (!shouldUpdateEntity(e)){
        if (ragTimer > 0){
          e._ragdollTimer = Math.max(0, ragTimer - dt);
        }
        continue;
      }
      if (ragTimer > 0){
        if (!e.ragdolling){
          e.ragdolling = true;
          e.ragdoll = true;
        }
        if (e._ragdollPrevMu == null && typeof e.mu === 'number'){
          e._ragdollPrevMu = e.mu;
        }
        if (typeof e.mu === 'number'){
          e.mu = Math.min(e.mu, 0.02);
        }
        if (typeof e.intentVx === 'number') e.intentVx *= 0.4;
        if (typeof e.intentVy === 'number') e.intentVy *= 0.4;
        e.vx *= 0.96;
        e.vy *= 0.96;
        if (typeof e.onRagdollTick === 'function'){
          try { e.onRagdollTick(dt, ragTimer); }
          catch (err){ if (dbg) console.warn('[updateEntities] ragdoll tick', err); }
        }
        continue;
      } else if (e.ragdolling || e.ragdoll){
        e.ragdolling = false;
        e.ragdoll = false;
        if (typeof e._ragdollPrevMu === 'number'){
          e.mu = e._ragdollPrevMu;
        }
        delete e._ragdollPrevMu;
        if (Math.abs(e.vx || 0) < 12) e.vx = 0;
        if (Math.abs(e.vy || 0) < 12) e.vy = 0;
        if (typeof e.onRagdollRecover === 'function'){
          try { e.onRagdollRecover(); }
          catch (err){ if (dbg) console.warn('[updateEntities] ragdoll recover', err); }
        }
      }
      if (typeof e.update === 'function'){
        try { e.update(dt); }
        catch(err){
          if (dbg) console.warn('[updateEntities] error update', e.id || e.kindName || e, err);
        }
      }
    }

    if (window.SpawnerAPI && typeof SpawnerAPI.update === 'function'){
      try { SpawnerAPI.update(dt); }
      catch(err){ if (dbg) console.warn('[updateEntities] error SpawnerAPI.update', err); }
    } else if (window.SpawnerManager && typeof SpawnerManager.update === 'function'){
      try { SpawnerManager.update(dt); }
      catch(err){ if (dbg) console.warn('[updateEntities] error SpawnerManager.update', err); }
    }
  }

  function updateDoorEntities(dt){
    if (!window.Doors?.update) return;
    if (!Array.isArray(G.entities)) return;
    const dbg = !!window.DEBUG_FORCE_ASCII;
    for (const ent of G.entities){
      if (!ent || ent.dead) continue;
      if (!matchesKind(ent, 'DOOR')) continue;
      if (!shouldUpdateEntity(ent)) continue;
      try {
        window.Doors.update(ent, G, dt);
      } catch (err){
        if (dbg) console.warn('[Doors] update error', err);
      }
    }
  }

  function maybeTriggerFirstBell(){
    if (G.firstBellTriggered) return;
    if (!window.BellsAPI || !Array.isArray(window.BellsAPI.bells) || !window.BellsAPI.bells.length) return;
    const hasActive = window.BellsAPI.bells.some((entry) => entry && entry.state === 'ringing');
    if (hasActive) {
      G.firstBellTriggered = true;
      return;
    }
    const delaySeconds = Number.isFinite(G.firstBellDelaySeconds) ? G.firstBellDelaySeconds : 300;
    const deadline = Number.isFinite(G.firstBellDeadline) ? G.firstBellDeadline : delaySeconds;
    if (G.time < deadline) return;
    const bell = window.BellsAPI.forceActivateFirstBell?.({ reason: 'first_bell_auto' });
    if (bell) {
      G.firstBellTriggered = true;
      G.firstBellDeadline = null;
      G._firstBellPendingLog = false;
      console.debug(`[FIRST_BELL] Forced activation at ${G.time.toFixed(2)}s`, bell?.id || '');
      return;
    }
    G.firstBellDeadline = G.time + 1;
    if (!G._firstBellPendingLog) {
      console.debug('[FIRST_BELL] Waiting for available bell to auto-activate.');
      G._firstBellPendingLog = true;
    }
  }

  function resolvePinballCollisions(dt){
    const ents = Array.isArray(G.entities) ? G.entities.filter(isPinballCandidate) : [];
    if (ents.length <= 1) return;
    const tile = window.TILE_SIZE || TILE;
    const SLOP = 0.5;
    const MAX_PUSH = tile * 0.5;
    const MAX_IMPULSE = 2200;
    for (let i = 0; i < ents.length; i++){
      const a = ents[i];
      for (let k = i + 1; k < ents.length; k++){
        const b = ents[k];
        if (!nearAABB(a, b, 6)) continue;
        if (!AABB(a, b)) continue;
        const ax = a.x + a.w * 0.5;
        const ay = a.y + a.h * 0.5;
        const bx = b.x + b.w * 0.5;
        const by = b.y + b.h * 0.5;
        const penX = (a.w * 0.5 + b.w * 0.5) - Math.abs(ax - bx);
        const penY = (a.h * 0.5 + b.h * 0.5) - Math.abs(ay - by);
        if (penX <= 0 || penY <= 0) continue;
        let nx = 0, ny = 0;
        if (penX < penY) {
          nx = (ax < bx ? -1 : 1);
        } else {
          ny = (ay < by ? -1 : 1);
        }
        const invA = a.static ? 0 : (1 / Math.max(0.1, approximatePinballMass(a)));
        const invB = b.static ? 0 : (1 / Math.max(0.1, approximatePinballMass(b)));
        const invSum = invA + invB;
        if (invSum <= 0) continue;
        const pen = Math.min(penX, penY) + SLOP;
        const corrA = Math.min((pen * invA) / invSum, MAX_PUSH);
        const corrB = Math.min((pen * invB) / invSum, MAX_PUSH);
        if (corrA > 0) { a.x += nx * corrA; a.y += ny * corrA; }
        if (corrB > 0) { b.x -= nx * corrB; b.y -= ny * corrB; }
        const stA = MovementSystem.getState?.(a);
        const stB = MovementSystem.getState?.(b);
        if (stA) { stA.lastSafeX = stA.x; stA.lastSafeY = stA.y; }
        if (stB) { stB.lastSafeX = stB.x; stB.lastSafeY = stB.y; }
        const rvx = (a.vx || 0) - (b.vx || 0);
        const rvy = (a.vy || 0) - (b.vy || 0);
        const velN = rvx * nx + rvy * ny;
        if (velN > 0) continue;
        const rest = Math.max(pinballRestitution(a), pinballRestitution(b));
        let j = -(1 + rest) * velN / invSum;
        j = Math.max(-MAX_IMPULSE, Math.min(MAX_IMPULSE, j));
        const ix = j * nx;
        const iy = j * ny;
        if (!a.static) {
          a.vx = (a.vx || 0) + ix * invA;
          a.vy = (a.vy || 0) + iy * invA;
        }
        if (!b.static) {
          b.vx = (b.vx || 0) - ix * invB;
          b.vy = (b.vy || 0) - iy * invB;
        }
      }
    }
  }

  function runtimePushableSafety(dt){
    if (!window.Placement?.ensureNoPushableOverlap) return;
    if (!Number.isFinite(dt) || dt <= 0) dt = 0;
    pushableOverlapCooldown = Math.max(0, pushableOverlapCooldown - dt);
    if (pushableOverlapCooldown > 0) return;
    pushableOverlapCooldown = 1.0;
    try {
      window.Placement.ensureNoPushableOverlap(G, { log: false, maxRadius: 6 });
    } catch (err) {
      if (window.DEBUG_FORCE_ASCII) console.warn('[PushableSafety] runtime check failed', err);
    }
  }

  // ------------------------------------------------------------
  // Reglas de juego base (pill→patient→door→boss with cart)
  // ------------------------------------------------------------
  function gameplay(dt){
    // 1) Recoger píldora (ENT.PILL)
    const hero = G.player || null;
    if (!hero?.carry && !G.carry) {
      for (const e of [...G.entities]) {
        if (!e || e.dead || !matchesKind(e, 'PILL')) continue;
        if (!AABB(G.player, e)) continue;
        if (assignCarryFromPill(hero, e)) {
          break;
        }
      }
    }

    // 2) Mantener la puerta cerrada hasta atender a todos
    if ((G.stats?.remainingPatients || 0) > 0) {
      if (G.door && !G.door.locked) {
        G.door.locked = true;
        G.door.solid = true;
      }
    }

    trackHeroPatientContact(hero);
    autoDeliverPillIfTouching(hero);

  }

    // === Flashlights (héroe + NPCs) con colores por entidad ===
    const HERO_LIGHT_ALPHA = 0.35;
    const NPC_LIGHT_ALPHA = 0.40;
    const NPC_RADIUS_RATIO = 0.55;

    function flashlightColorForHero(e){
      const k = ((e.skin || e.spriteKey || '') + '').toLowerCase();
      if (k.includes('enrique'))   return `rgba(255,235,90,${HERO_LIGHT_ALPHA})`;
      if (k.includes('roberto'))   return `rgba(255,170,90,${HERO_LIGHT_ALPHA})`;
      if (k.includes('francesco')) return `rgba(80,160,255,${HERO_LIGHT_ALPHA})`;
      if (e.isNPC || e.kind === ENT.PATIENT) return `rgba(255,245,170,${NPC_LIGHT_ALPHA})`;
      return `rgba(210,230,255,${HERO_LIGHT_ALPHA})`;
    }

    function flashlightProfileForNPC(npc, heroDist){
      const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
      const id = ((npc.aiId || npc.kindName || npc.kind || npc.role || '') + '').toUpperCase();
      let color = `rgba(255,213,170,${NPC_LIGHT_ALPHA})`;
      let ratio = NPC_RADIUS_RATIO;
      let fov = Math.PI * 0.48;

      if (id.includes('MEDIC')) {
        color = `rgba(107,211,255,${NPC_LIGHT_ALPHA})`;
        ratio = NPC_RADIUS_RATIO * 1.05;
      } else if (id.includes('JEFESERVICIO') || id.includes('BOSS')) {
        color = `rgba(255,212,107,${NPC_LIGHT_ALPHA})`;
        ratio = NPC_RADIUS_RATIO * 1.08;
      } else if (id.includes('GUARDIA')) {
        color = `rgba(185,255,107,${NPC_LIGHT_ALPHA})`;
        ratio = NPC_RADIUS_RATIO * 0.98;
      } else if (id.includes('FAMILIAR')) {
        color = `rgba(255,107,154,${NPC_LIGHT_ALPHA})`;
        ratio = NPC_RADIUS_RATIO * 0.9;
        fov = Math.PI * 0.45;
      }

      const base = heroDist * NPC_RADIUS_RATIO;
      const dist = clamp(heroDist * ratio, base * 0.85, base * 1.1);
      return { color, dist, fov };
    }

    function updateEntityFlashlights(){
      const list = [];
      const hero = (G.player && !G.player.dead) ? G.player : null;
      const heroDist = hero ? (hero._flashOuter || 740) : 620;
      const npcRadiusBase = heroDist * NPC_RADIUS_RATIO;
      const computeAngle = (e) => {
        if (hero && matchesKind(e, 'PATIENT')) {
          const ex = (e.x || 0) + (e.w || 0) * 0.5;
          const ey = (e.y || 0) + (e.h || 0) * 0.5;
          const hx = (hero.x || 0) + (hero.w || 0) * 0.5;
          const hy = (hero.y || 0) + (hero.h || 0) * 0.5;
          return Math.atan2(hy - ey, hx - ex);
        }
        if (typeof e.lookAngle === 'number') return e.lookAngle;
        if (Math.hypot(e.vx || 0, e.vy || 0) > 0.01) {
          return Math.atan2(e.vy || 0, e.vx || 0);
        }
        return Math.PI / 2;
      };
      const add = (e, fov, dist, color, opts = {}) => {
        const cx = e.x + e.w*0.5, cy = e.y + e.h*0.5;
        const ang = computeAngle(e);
        list.push({
          x: cx, y: cy, angle: ang,
          fov, dist, color, softness: 0.70,
          isHero: opts.isHero === true
        });
      };

      if (hero) {
        add(hero, Math.PI * 0.60, heroDist, flashlightColorForHero(hero), { isHero: true });
      }
      if (Array.isArray(G.humans)) {
        for (const npc of G.humans) {
          if (!npc || npc.dead) continue;
          const profile = flashlightProfileForNPC(npc, heroDist);
          const npcDist = Number.isFinite(profile?.dist) ? profile.dist : npcRadiusBase;
          add(npc, profile.fov || Math.PI * 0.48, npcDist, profile.color);
        }
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
    try { window.Narrator?.tick?.(dt, G); } catch(e){}
    const isPlaying = (G.state === 'PLAYING');
    if (isPlaying) {
      try { window.GameFlowAPI?.update?.(dt); } catch(err){ console.warn('[GameFlow] update error:', err); }
    }
    applyStateVisuals();
    if (!isPlaying || !G.player){
      currentCullingInfo = null;
      G.__cullingInfo = null;
      return; // <-- evita tocar nada sin jugador
    }
    G.time += dt;
    G.cycleSeconds += dt;
    const dbg = !!window.DEBUG_FORCE_ASCII;

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

    computeCullingInfo();

    // Posición del oyente (para paneo/atenuación en SFX posicionales)
    //if (G.player) AudioAPI.setListener(G.player.x + G.player.w/2, G.player.y + G.player.h/2);

    // objetos/movers (camas, carros, pastillas sueltas)
    for (const e of G.movers){
      if (e.dead) continue;
      if (!shouldUpdateEntity(e)) continue;
      // clamp velocidad máxima
      const ms = BALANCE.physics.maxSpeedObject;
      const sp = Math.hypot(e.vx, e.vy);
      if (sp>ms){ e.vx = e.vx*(ms/sp); e.vy = e.vy*(ms/sp); }
    }

    // enemigos
    runEntityAI(dt);
    updateEntities(dt);

    maybeTriggerFirstBell();
    if (window.BellsAPI?.update) {
      try { window.BellsAPI.update(dt); }
      catch (err) { if (dbg) console.warn('[Bells] update error', err); }
    }

    // integración de movimiento centralizada
    MovementSystem.step(dt);
    resolvePinballCollisions(dt);
    runtimePushableSafety(dt);

    // ascensores
    Entities?.Elevator?.update?.(dt);

    if (window.MouseNav && window._mouseNavInited) MouseNav.update(dt);

    // reglas
    gameplay(dt);

    updateDoorEntities(dt);
    if (window.Doors?.gameflow) {
      try { Doors.gameflow(G); } catch(err){ if (dbg) console.warn('[Doors] gameflow error', err); }
    }

    if (window.DamageSystem?.update) {
      try { DamageSystem.update(G, dt); } catch(err){ if (dbg) console.warn('[DamageSystem] update error', err); }
    }

    if (window.PuppetAPI?.updateAll) {
      PuppetAPI.updateAll(G, dt);
    }

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
    applyWorldCamera(ctx2d);

    // mundo
    drawTiles(ctx2d);
    drawEntities(ctx2d);
    try { window.FireAPI?.renderAll?.(ctx2d, camera); } catch (e) { if (window.DEBUG_FORCE_ASCII) console.warn('[Fire] render error', e); }

    ctx2d.restore();
  }

  // Dibuja el suelo ajedrezado + paredes con SpriteManager
  function drawTiles(c2){
    Sprites.drawFloorAndWalls(c2, G);
  }

function drawEntities(c2){
  const tileSize = Number.isFinite(G?.TILE_SIZE) && G.TILE_SIZE > 0 ? G.TILE_SIZE : TILE;
  const radiusValue = Number(G?.cullingRadiusTiles);
  const baseRadius = Number.isFinite(radiusValue) && radiusValue > 0 ? radiusValue : 20;
  const entityRadius = Math.max(0, Math.ceil(baseRadius)) + 1;
  const hasPlayer = !!G.player;
  const applyCull = hasPlayer && !G.isDebugMap && tileSize > 0;
  const playerX = hasPlayer ? Number(G.player.x) || 0 : 0;
  const playerY = hasPlayer ? Number(G.player.y) || 0 : 0;

  for (const e of G.entities){
    if (!e || e.dead) continue;

    const isPlayerEntity = (e === G.player || e.kind === ENT.PLAYER);
    if (applyCull && !isPlayerEntity) {
      const dx = (Number(e.x) || 0) - playerX;
      const dy = (Number(e.y) || 0) - playerY;
      const distTiles = Math.max(Math.abs(dx / tileSize), Math.abs(dy / tileSize));
      if (distTiles > entityRadius) {
        continue;
      }
    }

    // El jugador se pinta aparte con su rig (más nítido)
    if (isPlayerEntity) continue;

    if (e.puppet && window.PuppetAPI) continue;

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
      c2.fillRect(e.x, e.y, e.w, e.h);
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
          const pos = worldToScreenBasic(
            G.player.x + G.player.w * 0.5,
            G.player.y + G.player.h * 0.5
          );
          const px = pos.x;
          const py = pos.y;
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
    const pos = worldToScreenBasic(p.x + p.w / 2, p.y + p.h / 2);
    const px = pos.x;
    const py = pos.y;
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
    const canRenderWorld = (G.levelState === 'PLAYING' || G.levelState === 'PAUSED' || G.levelState === 'READY');
    if (!canRenderWorld) {
      clearCanvasContext(ctx, canvas?.width, canvas?.height);
      clearCanvasContext(fogCtx, fogCanvas?.width, fogCanvas?.height);
      clearCanvasContext(guideCtx, guideCanvas?.width, guideCanvas?.height);
      return;
    }
    // actualizar cámara centrada en jugador
    if (G.player){
      camera.x = G.player.x + G.player.w/2;
      camera.y = G.player.y + G.player.h/2;
    }

    // composición: mundo borroso fuera de luz + mundo nítido en cono
    drawLightingAndFog();
    if (window.PuppetAPI?.drawAll){
      PuppetAPI.drawAll(ctx, camera);
    }

    // Plugins que pintan en sus propios canvas (arriba del mundo)
    try { window.FogAPI?.render(camera, G); } catch(e){ console.warn('FogAPI.render', e); }
    try { window.LightingAPI?.render(camera, G); } catch(e){ console.warn('LightingAPI.render', e); }

    // Efectos de clima sobre la cámara (lluvia, relámpagos, gotas)
    window.SkyFX.renderBackground(ctx);
    window.SkyFX?.renderForeground?.(ctx);
    // Marcador de click del MouseNav (anillo)
    if (window.MouseNav && window._mouseNavInited) { try { MouseNav.render(ctx, camera); } catch(e){} }

    try { window.HUD?.drawWorldOverlays?.(ctx, camera, G); } catch(e){ console.warn('HUD.drawWorldOverlays', e); }

    if (guideCtx){
      syncGuideCanvasResolution();
      clearCanvasContext(guideCtx, guideCanvas?.width, guideCanvas?.height);
      try { window.ArrowGuide?.draw(guideCtx, camera, G); } catch(e){ console.warn('ArrowGuide.draw', e); }
    }

    // 1) Dibuja el HUD DOM + overlays finales
    try { window.HUD && HUD.render(null, camera, G); } catch(e){ console.warn('HUD.render', e); }

    const overlayCtx = guideCtx || ctx;
    if (!guideCtx && overlayCtx){
      try { window.ArrowGuide?.draw(overlayCtx, camera, G); } catch(e){ console.warn('ArrowGuide.draw', e); }
    }
    if (overlayCtx && window.Sprites?.renderOverlay) {
      Sprites.renderOverlay(overlayCtx);
    }
  }

  // Fixed timestep
  let lastT = performance.now();
  let acc = 0;
  const DT = 1/60;
  let frames = 0, dtAcc=0, msFrame=0, FPS=60;

  function loop(now){
    if (!Number.isFinite(camera.zoom) || camera.zoom <= 0){
      if (!invalidZoomLogged){
        logThrough('warn', '[camera] zoom inválido, reajustando', { zoom: camera.zoom });
        window.LOG?.event('CAMERA', { issue: 'invalid-zoom', zoom: camera.zoom });
        invalidZoomLogged = true;
      }
      camera.zoom = 1;
    } else if (invalidZoomLogged) {
      invalidZoomLogged = false;
    }

    const delta = (now - lastT)/1000; lastT = now;
    if (window.CineFX && typeof window.CineFX.update === 'function'){
      try { window.CineFX.update(delta, { camera, game: G }); }
      catch (err){ if (window.DEBUG_FORCE_ASCII) console.warn('[CineFX] update error', err); }
    }
    const fxScale = window.CineFX && typeof window.CineFX.getTimeScale === 'function'
      ? clamp(window.CineFX.getTimeScale(), 0.05, 2)
      : 1;
    acc += Math.min(delta * fxScale, 0.05);
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
    if (window.LOG?.counter){
      const fpsVal = Number.isFinite(FPS) && FPS > 0 ? Number(FPS.toFixed(1)) : 0;
      window.LOG.counter('fps', fpsVal);
      window.LOG.counter('entities', Array.isArray(G.entities) ? G.entities.length : 0);
      const zoomVal = Number.isFinite(camera.zoom) ? Number(camera.zoom.toFixed(2)) : 0;
      window.LOG.counter('camera.zoom', zoomVal);
      const hpVal = (G.player && Number.isFinite(G.player.hp)) ? G.player.hp
        : Number.isFinite(G.health) ? Number((G.health || 0) / 2) : 0;
      window.LOG.counter('player.hp', hpVal);
      window.LOG.counter('mapMode', DEBUG_MAP_MODE ? 'debug' : 'normal');
    }
    requestAnimationFrame(loop);
  }

  // === Post-parse: instanciar placements SOLO UNA VEZ ===
  function finalizeLevelBuildOnce(options = {}){
    const forceFallback = options.forceFallback === true;
    if (G._placementsFinalized && !forceFallback) return;          // evita duplicados
    if (!forceFallback) {
      G._placementsFinalized = true;
    }

    const sourcePlacements = Array.isArray(G.mapgenPlacements) && G.mapgenPlacements.length
      ? G.mapgenPlacements
      : (Array.isArray(G.__asciiPlacements) ? G.__asciiPlacements : []);
    if (!sourcePlacements.length) return;

    if (!forceFallback && window.Placement?.applyFromAsciiMap) {
      return; // el flujo principal se encarga en startGame
    }

    try {
      // Fallback LOCAL: instanciar lo básico si no hay Placement API
      const T = (window.TILE_SIZE || 32);
      for (const p of sourcePlacements) {
        if (!p || !p.type) continue;

        if ((p.type === 'player' || p.type === 'hero' || p.type === 'start') && !G.player) {
          const px = (p.x ?? 0) | 0;
          const py = (p.y ?? 0) | 0;
          const hero = (typeof makePlayer === 'function')
            ? makePlayer(px, py)
            : (window.Entities?.Hero?.spawnPlayer?.(px, py, {}) || null);
          if (hero) {
            G.player = hero;
            G.entities.push(hero);
            MovementSystem.register(hero);
          }
        }
        else if (p.type === 'patient') {
          const e = makeRect(p.x|0, p.y|0, T, T, ENT.PATIENT, '#ffd166', false, true);
          e.name = p.name || `Paciente_${G.patients.length+1}`;
          e.group = 'human';
          G.entities.push(e); G.patients.push(e);
          try { window.EntityGroups?.assign?.(e); } catch (_) {}
          try { window.EntityGroups?.register?.(e, G); } catch (_) {}
        }
        else if (p.type === 'pill') {
          const e = makeRect(p.x|0, p.y|0, T*0.6, T*0.6, ENT.PILL, '#a0ffcf', false, false);
          e.label = p.label || 'Píldora';
          // intenta vincularla al primer paciente existente si no se indicó target
          e.targetName = p.targetName || (G.patients[0]?.name) || null;
          e.group = 'object';
          G.entities.push(e); G.movers.push(e); G.pills.push(e);
          try { window.EntityGroups?.assign?.(e); } catch (_) {}
          try { window.EntityGroups?.register?.(e, G); } catch (_) {}
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
          const e = makeRect(p.x|0, p.y|0, T, T, ENT.CART, '#b0956c', true, true, {mass:3.5,rest:0.12,mu:0.02});
          G.entities.push(e); G.movers.push(e); G.cart = e;
        }
      }
    } catch(e){ console.warn('finalizeLevelBuildOnce (fallback):', e); }
    G._placementsFinalized = true;
  }
  // ------------------------------------------------------------
  // Control de estado
  // ------------------------------------------------------------
  const GAME_OVER_MESSAGES = [
    'El caos te ha superado…',
    'Los pasillos del hospital necesitan refuerzos.',
    'La guardia sigue sin héroe. ¡Inténtalo de nuevo!'
  ];

  let lastUIState = null;

  function normalizeAsciiFromText(text){
    const normalized = String(text || '').replace(/\r\n?/g, '\n');
    const rows = normalized.split('\n');
    while (rows.length && !rows[0].trim()) rows.shift();
    while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
    return rows.map((row) => row.replace(/\t/g, ' '));
  }

  function padAsciiRow(row, width){
    const base = String(row ?? '');
    if (!Number.isFinite(width) || width <= 0) return base;
    if (base.length === width) return base;
    if (base.length > width) return base.slice(0, width);
    return base + '.'.repeat(width - base.length);
  }

  function buildAsciiSnapshotForExport(){
    const shouldUseDebugAscii = DEBUG_MAP_MODE
      || G.mode === 'debug'
      || G.isDebugMap
      || G.debugMap
      || (G.debugAsciiSource && !/^procedural/.test(G.debugAsciiSource));

    if (shouldUseDebugAscii && Array.isArray(G.asciiMap) && G.asciiMap.length) {
      return G.asciiMap.slice();
    }

    const mapRows = Array.isArray(G.map) ? G.map : [];
    const height = mapRows.length;
    const width = mapRows?.[0]?.length || 0;
    if (!height || !width) return [];

    const asciiGrid = [];
    for (let y = 0; y < height; y++) {
      const mapRow = mapRows[y] || [];
      const row = [];
      for (let x = 0; x < width; x++) {
        row.push(mapRow[x] === 1 ? '#' : '.');
      }
      asciiGrid.push(row);
    }

    const priority = {
      '#': 99,
      'S': 9,
      'X': 8,
      'u': 7,
      'd': 6,
      'f': 5,
      'p': 4,
      'C': 3,
      'i': 2,
      'b': 2,
      '.': 0
    };
    const setChar = (tx, ty, ch) => {
      if (!ch) return;
      const row = asciiGrid[ty];
      if (!row || typeof row[tx] === 'undefined') return;
      const curr = row[tx];
      const currP = priority[curr] ?? 0;
      const nextP = priority[ch] ?? 1;
      if (nextP >= currP) {
        row[tx] = ch;
      }
    };

    const tileSize = (typeof window !== 'undefined' && (window.TILE_SIZE || window.TILE)) || TILE;
    const entities = Array.isArray(G.entities) ? G.entities : [];
    for (const e of entities) {
      if (!e || e.dead) continue;
      const tx = Math.floor((e.x ?? 0) / tileSize);
      const ty = Math.floor((e.y ?? 0) / tileSize);
      if (tx < 0 || ty < 0 || ty >= height || tx >= width) continue;

      const isDoor = matchesKind(e, 'DOOR') || e.isDoor || e.type === 'door';
      const isBossDoor = isDoor && (e.bossDoor || e.isBossDoor || e.tag === 'bossDoor');
      const isPatient = matchesKind(e, 'PATIENT') || e.isPatient || e.role === 'patient' || e.requiredKeyName;
      const isCart = matchesKind(e, 'CART') || e.isCart;

      let ch = '';
      if (matchesKind(e, 'PLAYER') || e.hero || e.isPlayer) {
        ch = 'S';
      } else if (matchesKind(e, 'BOSS') || e.isBoss) {
        ch = 'X';
      } else if (isDoor) {
        ch = isBossDoor ? 'u' : 'd';
      } else if (matchesKind(e, 'PILL') || e.isPill) {
        ch = 'i';
      } else if (matchesKind(e, 'BELL') || e.isBell) {
        ch = 'b';
      } else if (isPatient) {
        const furious = e.furious || e.isFuriousPatient || e.angry || e.state === 'furious';
        ch = furious ? 'f' : 'p';
      } else if (isCart) {
        ch = 'C';
      }

      setChar(tx, ty, ch);
    }

    return asciiGrid.map((row) => row.join(''));
  }

  function exportAsciiMapForDebug(){
    if (G._asciiExportedForLevel) return;
    const lines = buildAsciiSnapshotForExport();
    if (!lines.length) return;
    const asciiText = lines.join('\n');
    G.lastAsciiExport = asciiText;

    try {
      if (typeof fetch === 'function') {
        fetch('debug-export.php', { method: 'POST', body: asciiText });
      }
    } catch (err) {
      console.warn('[debug-export] no se pudo enviar mapa ASCII', err);
    } finally {
      G._asciiExportedForLevel = true;
    }
  }

  function enforceAsciiDimensions(lines, desiredWidth, desiredHeight){
    if (!Array.isArray(lines) || !lines.length) return lines;
    const targetWidth = Number.isFinite(desiredWidth) && desiredWidth > 0
      ? desiredWidth
      : null;
    const targetHeight = Number.isFinite(desiredHeight) && desiredHeight > 0
      ? desiredHeight
      : null;
    if (!targetWidth && !targetHeight) return lines.slice();
    const adjusted = lines.map((row) => targetWidth ? padAsciiRow(row, targetWidth) : String(row ?? ''));
    const finalWidth = targetWidth || adjusted[0]?.length || 0;
    let output = adjusted;
    if (targetHeight && targetHeight > 0){
      if (output.length > targetHeight){
        output = output.slice(0, targetHeight);
      } else if (output.length < targetHeight){
        const filler = padAsciiRow('', finalWidth || 0);
        while (output.length < targetHeight){
          output.push(filler);
        }
      }
    }
    return output;
  }

  function pickCullingRadiusFromRules(ruleSet){
    const candidates = [
      Number.isFinite(ruleSet?.level?.culling) ? ruleSet.level.culling : null,
      Number.isFinite(ruleSet?.globals?.culling) ? ruleSet.globals.culling : null,
    ];
    for (const value of candidates){
      if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
  }

  async function loadDebugAsciiMap(fallbackLines){
    const fallback = {
      lines: Array.isArray(fallbackLines) ? fallbackLines.slice() : FALLBACK_DEBUG_ASCII_MAP.slice(),
      source: 'builtin',
      fromFile: false,
      file: null
    };
    const fallbackWidth = fallback.lines[0]?.length || 0;
    const fallbackHeight = fallback.lines.length;
    const fileToLoad = DEBUG_MAP_FILE;
    const mapFileOrigin = DEBUG_MAP_FILE_PARAM ? 'custom' : 'default';

    try {
      const response = await fetch(fileToLoad, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      const rows = normalizeAsciiFromText(text);
      if (!rows.length) {
        throw new Error('archivo vacío');
      }
      const payload = {
        lines: rows,
        source: mapFileOrigin === 'custom' ? 'file' : 'file-default',
        fromFile: true,
        file: fileToLoad,
        width: rows[0]?.length || 0,
        height: rows.length
      };
      logThrough('info', '[debug-map] mapa ASCII externo cargado', {
        file: fileToLoad,
        width: payload.width,
        height: payload.height
      });
      window.LOG?.event?.('DEBUG_MAP_LOAD', {
        mode: mapFileOrigin,
        file: fileToLoad,
        width: payload.width,
        height: payload.height
      });
      return payload;
    } catch (err) {
      logThrough('warn', '[debug-map] fallo al cargar mapa externo, usando fallback', {
        file: fileToLoad,
        error: err?.message || String(err)
      });
      window.LOG?.event?.('DEBUG_MAP_LOAD', {
        mode: `${mapFileOrigin}-error`,
        file: fileToLoad,
        error: err?.message || String(err)
      });
      fallback.source = 'builtin-error';
      return fallback;
    }
  }

  async function resolveAsciiMapForLevel(level){
    const asciiFallback = (window.__MAP_MODE === 'mini' ? DEBUG_ASCII_MINI : FALLBACK_DEBUG_ASCII_MAP).slice();
    const shouldUseDebugAscii = DEBUG_MAP_MODE || !!window.DEBUG_FORCE_ASCII;
    let levelRules = null;
    let ruleCullingRadius = null;
    let targetWidth = null;
    let targetHeight = null;

    if (!shouldUseDebugAscii && window.XMLRules?.load){
      try {
        levelRules = await window.XMLRules.load(level);
        targetWidth = Number.isFinite(levelRules?.level?.width) ? levelRules.level.width : null;
        targetHeight = Number.isFinite(levelRules?.level?.height) ? levelRules.level.height : null;
        ruleCullingRadius = pickCullingRadiusFromRules(levelRules);
      } catch (err) {
        console.warn('[level_rules] no se pudo cargar level_rules.xml', err);
      }
    }

    if (shouldUseDebugAscii) {
      const payload = await loadDebugAsciiMap(asciiFallback).catch((err) => {
        console.warn('[debug-map] error inesperado al cargar mapa debug', err);
        return {
          lines: asciiFallback.slice(),
          source: 'builtin-error',
          fromFile: false,
          file: null
        };
      });
      const lines = Array.isArray(payload?.lines) && payload.lines.length
        ? payload.lines.slice()
        : asciiFallback.slice();
      return {
        lines,
        source: payload?.source || (payload?.fromFile ? 'file' : 'builtin'),
        file: payload?.file || null,
        placements: [],
        areas: null,
        mode: 'debug'
      };
    }

    let asciiLines = null;
    let placements = [];
    let areas = null;
    let source = 'procedural';
    let meta = null;

    if (window.MapGenAPI && typeof MapGenAPI.generate === 'function') {
      try {
        const res = MapGenAPI.generate(level, {
          seed: G.seed || Date.now(),
          place: false,
          defs: null,
          width: window.DEBUG_MINIMAP ? 128 : undefined,
          height: window.DEBUG_MINIMAP ? 128 : undefined
        }) || {};
        const asciiText = typeof res.ascii === 'string'
          ? res.ascii
          : (typeof MapGenAPI.toAscii === 'function' ? MapGenAPI.toAscii(res) : '');
        let rows = normalizeAsciiFromText(asciiText);
        if (targetWidth || targetHeight) {
          rows = enforceAsciiDimensions(rows, targetWidth, targetHeight);
        }
        if (rows.length) {
          asciiLines = rows;
          placements = Array.isArray(res.placements) ? res.placements.slice() : [];
          areas = res.areas || null;
          source = window.DEBUG_MINIMAP ? 'procedural-mini' : 'procedural';
          meta = {
            ...(res.meta || {}),
            seed: res.seed ?? res.meta?.seed ?? (G.seed ?? null),
            level: res.level ?? res.meta?.level ?? level,
            width: res.width ?? res.meta?.width ?? (rows[0]?.length || null),
            height: res.height ?? res.meta?.height ?? rows.length
          };
        }
      } catch (err) {
        console.warn('[MapGenAPI] generate falló:', err);
      }
    }

    if (!asciiLines || !asciiLines.length) {
      asciiLines = enforceAsciiDimensions(asciiFallback.slice(), targetWidth, targetHeight);
      source = 'fallback';
    }

    const finalWidth = asciiLines?.[0]?.length || 0;
    const finalHeight = asciiLines?.length || 0;

    return {
      lines: asciiLines,
      source,
      file: null,
      placements,
      areas,
      mode: 'normal',
      meta,
      levelRules,
      cullingRadiusTiles: ruleCullingRadius,
      width: finalWidth,
      height: finalHeight
    };
  }

  async function maybeLogGeneratedMap(levelCfg, payload){
    try {
      if (!payload || payload.mode !== 'normal') return;
      const source = payload.source || '';
      if (!/procedural/.test(source)) return;
      if (!levelCfg || !Array.isArray(levelCfg.asciiRows) || !levelCfg.asciiRows.length) return;

      const req = (typeof window !== 'undefined' && typeof window.require === 'function')
        ? window.require
        : (typeof require === 'function' ? require : null);
      if (!req) return;

      let fs;
      let path;
      try {
        fs = req('fs');
        path = req('path');
      } catch (err) {
        console.warn('[MapLog] módulos fs/path no disponibles', err);
        return;
      }

      const resolveBaseDir = () => {
        if (typeof window !== 'undefined' && typeof window.MAP_LOG_DIR === 'string' && window.MAP_LOG_DIR.trim()) {
          return window.MAP_LOG_DIR.trim();
        }
        if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
          return path.join(process.cwd(), 'logs');
        }
        return path.join('.', 'logs');
      };

      const baseDir = resolveBaseDir();
      try {
        fs.mkdirSync(baseDir, { recursive: true });
      } catch (err) {
        console.warn('[MapLog] no se pudo preparar el directorio de logs', err);
        return;
      }

      const filePath = path.join(baseDir, 'logMAP.txt');
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestamp = `[${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}]`;

      const meta = payload.meta || {};
      const params = [];
      params.push('mode=normal');
      params.push('difficulty=normal');
      params.push(`source=${source}`);

      const seed = meta.seed ?? levelCfg.seed ?? ((typeof G !== 'undefined' && G && typeof G.seed !== 'undefined') ? G.seed : null);
      const roomsCount = Number.isFinite(meta.roomsCount) ? meta.roomsCount : null;
      const doorsCount = Number.isFinite(meta.doorsCount) ? meta.doorsCount : null;
      const spawns = meta.spawns || {};
      const animals = (typeof meta.animalSpawns === 'number' && !Number.isNaN(meta.animalSpawns))
        ? meta.animalSpawns
        : ((typeof spawns.mosquito === 'number' ? spawns.mosquito : 0) + (typeof spawns.rat === 'number' ? spawns.rat : 0));
      const staff = Number.isFinite(spawns.staff) ? spawns.staff : null;
      const carts = Number.isFinite(spawns.cart) ? spawns.cart : null;
      const patients = Number.isFinite(meta.patientsCount) ? meta.patientsCount : null;
      const pills = Number.isFinite(meta.pillsCount) ? meta.pillsCount : null;
      const bells = Number.isFinite(meta.bellsCount) ? meta.bellsCount : null;
      const elevators = Number.isFinite(meta.elevatorsCount) ? meta.elevatorsCount : null;
      const lights = Number.isFinite(meta.lightsCount) ? meta.lightsCount : null;

      const headerDetails = [];
      const pushDetail = (label, value) => {
        if (value === null || value === undefined) return;
        headerDetails.push(`${label}=${value}`);
      };

      if (seed !== null && seed !== undefined) {
        params.push(`seed=${seed}`);
        pushDetail('seed', seed);
      }
      pushDetail('difficulty', 'normal');
      pushDetail('rooms', roomsCount);
      pushDetail('doors', doorsCount);
      if (Number.isFinite(animals)) {
        params.push(`enemies=${animals}`);
        pushDetail('enemies', animals);
      }
      if (staff !== null) params.push(`staff=${staff}`);
      if (carts !== null) params.push(`carts=${carts}`);
      if (patients !== null) params.push(`patients=${patients}`);
      if (pills !== null) params.push(`pills=${pills}`);
      if (bells !== null) params.push(`bells=${bells}`);
      if (elevators !== null) params.push(`elevators=${elevators}`);
      if (lights !== null) params.push(`lights=${lights}`);
      if (doorsCount !== null) params.push(`doors=${doorsCount}`);
      if (roomsCount !== null) params.push(`rooms=${roomsCount}`);

      const asciiRows = levelCfg.asciiRows.map((row) => (row == null ? '' : String(row)));
      const width = levelCfg.width ?? (asciiRows[0]?.length ?? 0);
      const height = levelCfg.height ?? asciiRows.length;
      const fallbackLevel = (typeof G !== 'undefined' && G && typeof G.level !== 'undefined') ? G.level : '?';
      const levelLabel = (typeof levelCfg.level === 'number') ? `Level ${levelCfg.level}` : `Level ${fallbackLevel}`;

      const headerSuffix = headerDetails.length ? ` (Procedural, ${headerDetails.join(', ')})` : ' (Procedural)';
      const headerLine = `${timestamp} ${levelLabel}${headerSuffix}`;
      const paramsLine = `Parámetros: ${params.join(', ')}`;
      const mapHeader = `Mapa ${width}x${height}:`;
      const separator = '--------------------------------------------------';
      const entry = `${headerLine}\n${paramsLine}\n${mapHeader}\n${asciiRows.join('\n')}\n${separator}\n`;

      const appendPromise = (fs.promises && typeof fs.promises.appendFile === 'function')
        ? fs.promises.appendFile(filePath, entry, 'utf8')
        : new Promise((resolve, reject) => {
            fs.appendFile(filePath, entry, 'utf8', (err) => (err ? reject(err) : resolve()));
          });

      await appendPromise;
    } catch (err) {
      console.warn('[MapLog] error al escribir log de mapa', err);
    }
  }

  async function buildLevelForCurrentMode(levelNumber){
    const level = typeof levelNumber === 'number' ? levelNumber : (G.level || 1);
    G.debugMap = DEBUG_MAP_MODE;
    G.isDebugMap = DEBUG_MAP_MODE;
    G.mode = DEBUG_MAP_MODE ? 'debug' : 'normal';
    G._placementMode = G.mode;
    G._placementsFinalized = false;
    G._hasPlaced = false;
    G.mapgenPlacements = [];
    G.mapAreas = null;

    G.flags = G.flags || {};
    G.flags.DEBUG_FORCE_ASCII = !!(DEBUG_MAP_MODE || window.DEBUG_FORCE_ASCII);

    const payload = await resolveAsciiMapForLevel(level);
    if (payload?.levelRules) {
      G.levelRules = payload.levelRules;
      const hemaSeconds = Number(payload.levelRules?.level?.hematologicTimerSeconds ?? payload.levelRules?.globals?.hematologicTimerSeconds);
      if (Number.isFinite(hemaSeconds) && hemaSeconds > 0) {
        G.hematologicTimerSeconds = hemaSeconds;
      }

      const cleanerBossSeconds = Number(payload.levelRules?.level?.cleanerBossTimerSeconds ?? payload.levelRules?.globals?.cleanerBossTimerSeconds);
      if (Number.isFinite(cleanerBossSeconds) && cleanerBossSeconds > 0) {
        G.cleanerBossTimerSeconds = cleanerBossSeconds;
      }
    }
    const asciiLines = Array.isArray(payload.lines) && payload.lines.length
      ? payload.lines.slice()
      : (window.__MAP_MODE === 'mini' ? DEBUG_ASCII_MINI : FALLBACK_DEBUG_ASCII_MAP).slice();

    if (Number.isFinite(payload?.cullingRadiusTiles) && payload.cullingRadiusTiles > 0) {
      G.cullingRadiusTiles = payload.cullingRadiusTiles;
      const tileSize = Number.isFinite(G?.TILE_SIZE) && G.TILE_SIZE > 0 ? G.TILE_SIZE : TILE;
      G.cullingRadiusPx = G.cullingRadiusTiles * tileSize;
      G.culling = G.cullingRadiusTiles;
    }

    ASCII_MAP = asciiLines;
    G.debugAsciiSource = payload.source || (DEBUG_MAP_MODE ? 'debug' : 'procedural');
    G.debugAsciiFile = payload.file || null;
    G.mapgenPlacements = Array.isArray(payload.placements) ? payload.placements.slice() : [];
    G.mapAreas = payload.areas || null;

    parseMap(ASCII_MAP);

    const width = G.mapW || (ASCII_MAP[0]?.length || 0);
    const height = G.mapH || ASCII_MAP.length;
    const asciiString = ASCII_MAP.join('\n');

    G.ascii = () => asciiString;
    G.asciiString = asciiString;
    window.MapAPI = window.MapAPI || {};
    window.MapAPI.ascii = () => asciiString;
    if (DEBUG_MAP_MODE) {
      try {
        console.debug(`[debug-map] ASCII (${width}x${height}):\n${asciiString}`);
      } catch (_) {}
    }

    const asciiPlacements = Array.isArray(G.__asciiPlacements) ? G.__asciiPlacements.slice() : [];
    if (Array.isArray(G.mapgenPlacements) && G.mapgenPlacements.length) {
      asciiPlacements.push(...G.mapgenPlacements);
    }

    const levelCfg = {
      G,
      mode: G.mode,
      debug: DEBUG_MAP_MODE,
      ascii: asciiString,
      asciiMap: asciiString,
      asciiRows: ASCII_MAP.slice(),
      allowAscii: true,
      forceAscii: true,
      map: G.map,
      areas: G.mapAreas,
      width,
      height,
      level,
      seed: G.seed || null,
      placements: asciiPlacements
    };

    G._lastLevelCfg = levelCfg;

    if (window.LOG?.counter) {
      window.LOG.counter('mapMode', `${payload.mode}:${payload.source}`);
    }

    const eventPayload = {
      mode: payload.mode,
      source: payload.source,
      width,
      height
    };
    if (payload.file) {
      eventPayload.file = payload.file;
    }

    window.LOG?.event?.('MAP_READY', eventPayload);
    window.LOG?.event?.('MAP_ASCII_READY', {
      ...eventPayload,
      source: payload.source
    });
    logThrough('info', `[buildLevel] mapa ASCII preparado (${width}x${height})`, {
      mode: payload.mode,
      source: payload.source,
      file: payload.file || null
    });

    await maybeLogGeneratedMap(levelCfg, payload);

    return levelCfg;
  }

  function configureLevelSystems(){
    try {
      window.SkyFX?.init?.({
        canvas,
        getCamera: () => camera,
        getMapAABB: () => ({ x:0, y:0, w:G.mapW * TILE_SIZE, h:G.mapH * TILE_SIZE }),
        worldToScreen: (x,y) => ({
          x: (x - camera.x) * camera.zoom + VIEW_W * 0.5,
          y: (y - camera.y) * camera.zoom + VIEW_H * 0.5
        })
      });
    } catch (err){
      console.warn('[SkyFX] init error', err);
    }

    if (window.MouseNav && !window._mouseNavInited){
      MouseNav.init({
        canvas: document.getElementById('gameCanvas'),
        camera,
        TILE,
        getMap:      () => G.map,
        getEntities: () => G.entities,
        getPlayer:   () => G.player,
        isWalkable:  (tx,ty) => !!(G.map[ty] && G.map[ty][tx] === 0)
      });
      window._mouseNavInited = true;
    }

    if (window.MouseNav){
      const isInteractuable = (ent) => {
        if (!ent) return false;
        if (ent.kind === ENT.DOOR) return true;
        if (ent.pushable === true) return true;
        return false;
      };
      const original = MouseNav._isInteractable?.bind(MouseNav);
      MouseNav._isInteractable = (ent) => isInteractuable(ent) || (original ? original(ent) : false);
      MouseNav._performUse = (player, target) => {
        if (!target) return;
        if (target.kind === ENT.DOOR){
          if (window.Doors?.toggle){
            window.Doors.toggle(target);
          } else {
            target.solid = !target.solid;
            target.open = !target.solid;
            target.color = target.solid ? '#7f8c8d' : '#2ecc71';
          }
          return;
        }
        if (target.pushable === true){
          const dx = (target.x + target.w*0.5) - (player.x + player.w*0.5);
          const dy = (target.y + target.h*0.5) - (player.y + player.h*0.5);
          const L  = Math.hypot(dx,dy);
          if (L > 0.0001){
            const F  = (player.pushForce || FORCE_PLAYER);
            pushEntityWithImpulse(target, { x: dx / L, y: dy / L }, F);
          }
        }
      };
    }

    try {
      SkyFX.init({
        canvas: document.getElementById('gameCanvas'),
        getCamera: () => ({ x: camera.x, y: camera.y, zoom: camera.zoom }),
        getMapAABB: () => ({ x: 0, y: 0, w: G.mapW * TILE_SIZE, h: G.mapH * TILE_SIZE }),
        worldToScreen: (x,y) => ({
          x: (x - camera.x) * camera.zoom + VIEW_W * 0.5,
          y: (y - camera.y) * camera.zoom + VIEW_H * 0.5
        })
      });
      SkyFX.setLevel(G.level);
    } catch (err){
      console.warn('[SkyFX] reinit error', err);
    }

    initSpawnersForLevel();

    try {
      const basePhys = (window.Physics && (window.Physics.PHYS || window.Physics.DEFAULTS)) || {
        restitution: 0.18,
        friction: 0.045,
        slideFriction: 0.020,
        crushImpulse: 110,
        hurtImpulse: 45,
        explodeImpulse: 170
      };
      window.Physics?.init?.(basePhys)?.bindGame(G);
    } catch (err){
      console.warn('[Physics] init error', err);
    }

    try {
      window.BellsAPI?.init?.(G);
    } catch (err) {
      console.warn('[Bells] init error', err);
    }

    try {
      window.Narrator?.init?.({
        container: document.getElementById('game-container'),
        enabled: document.getElementById('opt-narrator')?.checked !== false
      });
    } catch (err) {
      console.warn('[Narrator] init error', err);
    }

    if (G.player && typeof G.player.hp === 'number') {
      G.healthMax = (G.player.hpMax|0) * 2;
      G.health    = Math.min(G.healthMax, (G.player.hp|0) * 2);
    }
  }

  function setGameState(next){
    if (G.state === next){
      applyStateVisuals(true);
      return;
    }
    if (next === 'READY') {
      G.levelState = 'READY';
    } else if (next === 'PLAYING') {
      G.levelState = 'PLAYING';
      G.pendingLevel = null;
    } else if (next === 'PAUSED') {
      G.levelState = 'PAUSED';
    }
    G.state = next;
    window.LOG?.event?.('STATE', { state: next, level: G.level || null });
    applyStateVisuals(true);
  }

  function applyStateVisuals(force = false){
    if (!force && lastUIState === G.state) return;
    lastUIState = G.state;

    switch (G.state){
      case 'READY': {
        // Minimap pequeño y visible al comenzar el turno
        window.__setMinimapMode?.('small');
        window.__toggleMinimap?.(true);
        startScreen.classList.add('hidden');
        pausedScreen.classList.add('hidden');
        levelCompleteScreen.classList.add('hidden');
        gameOverScreen.classList.add('hidden');
        if (!G._readySequenceActive){
          G._readySequenceActive = true;
          const beginPlay = () => {
            G._readySequenceActive = false;
            setGameState('PLAYING');
          };
          const triggerReady = () => {
            try { window.CineFX?.readyBeat?.(); }
            catch (err){ if (window.DEBUG_FORCE_ASCII) console.warn('[CineFX] readyBeat error', err); }
            const played = window.GameFlowAPI?.playReadyOverlay?.({ onComplete: beginPlay });
            if (!played) beginPlay();
          };
          if (window.PresentationAPI?.levelIntro){
            try {
              PresentationAPI.levelIntro(G.level || 1, triggerReady);
            } catch (err){
              console.warn('[PresentationAPI] levelIntro', err);
              triggerReady();
            }
          } else {
            triggerReady();
          }
        }
        break;
      }
      case 'PLAYING': {
        startScreen.classList.add('hidden');
        pausedScreen.classList.add('hidden');
        levelCompleteScreen.classList.add('hidden');
        gameOverScreen.classList.add('hidden');
        window.__toggleMinimap?.(true);
        G._gameOverShown = false;
        G._levelCompleteShown = false;
        break;
      }
      case 'GAMEOVER': {
        if (G.levelState !== 'READY_TO_START') {
          resetGameWorld({ levelState: 'READY_TO_START', reason: 'gameover' });
        } else {
          G.levelState = 'READY_TO_START';
        }
        window.__toggleMinimap?.(false);
        levelCompleteScreen.classList.add('hidden');
        gameOverScreen.classList.remove('hidden');
        if (!G._gameOverShown){
          G._gameOverShown = true;
          const pool = GAME_OVER_MESSAGES;
          const message = pool[Math.floor(Math.random() * pool.length)] || 'El caos te ha superado…';
          const textNode = gameOverScreen?.querySelector('.menu-box .game-over-message');
          if (textNode) textNode.textContent = message;
          try { window.PresentationAPI?.gameOver?.({ mode: 'under' }); }
          catch (err){ console.warn('[PresentationAPI] gameOver', err); }
        }
        if (!G._gameOverLogged) {
          G._gameOverLogged = true;
          const payload = {
            level: G.level || 1,
            reason: G._gameOverReason || 'unknown',
            time: Number.isFinite(G.time) ? Number(G.time.toFixed(2)) : null,
            health: Number.isFinite(G.health) ? G.health : null,
          };
          window.LOG?.event('GAME_OVER', payload);
        }
        break;
      }
      case 'COMPLETE': {
        if (G.levelState !== 'READY_TO_START') {
          resetGameWorld({ levelState: 'READY_TO_START', reason: 'level-complete', keepPendingLevel: true });
        } else {
          G.levelState = 'READY_TO_START';
        }
        window.__toggleMinimap?.(false);
        gameOverScreen.classList.add('hidden');
        levelCompleteScreen.classList.remove('hidden');
        try { window.CineFX?.levelCompleteCue?.(); }
        catch (err){ if (window.DEBUG_FORCE_ASCII) console.warn('[CineFX] levelCompleteCue error', err); }
        if (!G._levelCompleteShown){
          G._levelCompleteShown = true;
          const breakdown = buildLevelBreakdown();
          const total = (window.ScoreAPI && typeof ScoreAPI.getTotals === 'function')
            ? (ScoreAPI.getTotals().total || 0)
            : breakdown.reduce((acc, row) => acc + (row.points|0), 0);
          const proceed = () => {
            const advanced = window.GameFlowAPI?.nextLevel?.();
            if (advanced === false) return;
            if (!advanced) startGame((G.level || 1) + 1);
          };
          if (window.PresentationAPI?.levelComplete){
            try {
              PresentationAPI.levelComplete(G.level || 1, { breakdown, total }, proceed);
            } catch (err){
              console.warn('[PresentationAPI] levelComplete', err);
              proceed();
            }
          } else {
            proceed();
          }
          if (!G._levelCompleteLogged) {
            G._levelCompleteLogged = true;
            window.LOG?.event('LEVEL_COMPLETE', {
              level: G.level || 1,
              total,
              breakdown,
            });
          }
        }
        break;
      }
      default: {
        // Minimap pequeño y visible al comenzar el turno
        window.__setMinimapMode?.('small');
        window.__toggleMinimap?.(true);
        break;
      }
    }
  }

  function resetGlobalLevelState(){
    try {
      const rigCountBefore = window.PuppetAPI?.getActiveCount?.();
      const entityCountBefore = Array.isArray(G.entities) ? G.entities.filter(Boolean).length : 0;
      if (rigCountBefore != null){
        console.log(`[Puppet] Reset rigs (level-reset) -> antes: rigs=${rigCountBefore}, entidades=${entityCountBefore}`);
      }
      if (window.PuppetAPI?.reset){
        window.PuppetAPI.reset({ reason: 'level-reset', log: false });
      }
      const rigCountAfter = window.PuppetAPI?.getActiveCount?.();
      if (rigCountAfter != null){
        console.log(`[Puppet] Reset rigs (level-reset) -> después: rigs=${rigCountAfter}`);
      }
    } catch (err){
      console.warn('[Puppet] resetGlobalLevelState', err);
    }

    const arrayKeys = [
      'entities','movers','hostiles','humans','animals','objects','patients','pills','lights','roomLights','items','spawners','onInteract'
    ];
    for (const key of arrayKeys) {
      if (!Array.isArray(G[key])) {
        G[key] = [];
      } else {
        G[key].length = 0;
      }
    }

    if (Array.isArray(G.__asciiPlacements)) {
      G.__asciiPlacements.length = 0;
    } else {
      G.__asciiPlacements = [];
    }

    G.mapgenPlacements = [];
    G.mapAreas = null;
    G.map = [];
    G.mapW = 0;
    G.mapH = 0;
    G.asciiMap = [];

    G.player = null;
    G.cart = null;
    G.boss = null;
    G.door = null;
    G.carry = null;
    G.mosquitoSpawn = null;
    G._lastLevelCfg = null;
    G._placementsFinalized = false;
    G._hasPlaced = false;
    G.__placementsApplied = false;
    G.debugAsciiSource = null;
    G.debugAsciiFile = null;
    G.safeRect = null;

    G.flags = G.flags || {};
    G.flags.DEBUG_FORCE_ASCII = false;
    G.flags.DEBUG_MINIMAP = !!window.DEBUG_MINIMAP;

    try { MovementSystem?.setMap?.(null, TILE); } catch (_) {}
    try { window.Placement?.reset?.(); } catch (_) {}
    try { window.AI?.clearLevel?.(); } catch (_) {}
    try { window.BellsAPI?.reset?.(); } catch (_) {}

    clearLights();

    window.LOG?.event?.('LEVEL_RESET', { debug: DEBUG_MAP_MODE });
    logThrough('info', '[startGame] estado global reseteado', { debug: DEBUG_MAP_MODE });
  }

  function startGame(levelNumber){
    const fallbackLevel = Number.isFinite(G.currentLevelNumber) ? G.currentLevelNumber : (G.level || 1);
    const targetLevel = typeof levelNumber === 'number' ? levelNumber : fallbackLevel;
    const wasRestart = (G.state === 'GAMEOVER' || G.state === 'COMPLETE') && targetLevel === (G.level || targetLevel);
    G.level = targetLevel;
    G.currentLevelNumber = targetLevel;
    G.currentLevelId = `level${targetLevel}`;
    G.debugMap = DEBUG_MAP_MODE;
    G.isDebugMap = DEBUG_MAP_MODE;
    G._hasPlaced = false;
    G.__placementsApplied = false;
    G._gameOverLogged = false;
    G._levelCompleteLogged = false;
    G._asciiExportedForLevel = false;

    if (window.LOG?.counter) {
      window.LOG.counter('spawns', 0);
      window.LOG.counter('duplicates', 0);
      window.LOG.counter('mapMode', DEBUG_MAP_MODE ? 'debug' : 'normal');
    }

    const heroKey = ensureHeroSelected();
    if (heroKey) {
      G.selectedHero = heroKey;
    }

    logThrough('info', '[startGame] preparando turno', {
      level: targetLevel,
      debug: DEBUG_MAP_MODE,
      restart: wasRestart,
    });
    window.LOG?.event('START_GAME', { level: targetLevel, debug: DEBUG_MAP_MODE, restart: wasRestart });
    window.LOG?.event('LEVEL_START', { level: targetLevel, debug: DEBUG_MAP_MODE, restart: wasRestart });

    startScreen.classList.add('hidden');
    pausedScreen.classList.add('hidden');
    levelCompleteScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');

    // ⬇️ asegura minimapa pequeño por defecto
    document.getElementById('minimapOverlay')?.classList.add('hidden');
    document.getElementById('minimap')?.classList.remove('expanded');

    // ⬇️ modo mini al arrancar
    // Minimap pequeño y visible al comenzar el turno
    window.__setMinimapMode?.('small');
    window.__toggleMinimap?.(true);

    resetGameWorld({ levelState: 'LOADING', pendingLevel: targetLevel, keepPendingLevel: true, reason: 'start-game' });
    G.levelState = 'LOADING';

    G.time = 0;
    G.cycleSeconds = 0;
    const delayMinutes = Number.isFinite(G.firstBellDelayMinutes) ? Math.max(0, G.firstBellDelayMinutes) : 5;
    G.firstBellDelayMinutes = delayMinutes;
    G.firstBellDelaySeconds = delayMinutes * 60;
    G.firstBellDeadline = G.firstBellDelaySeconds;
    G.firstBellTriggered = false;
    G._firstBellPendingLog = false;
    if (!wasRestart) G.score = 0;
    G.delivered = 0;
    G.timbresRest = 1;
    G.carry = null;
    G._readySequenceActive = false;
    G._gameOverShown = false;
    G._levelCompleteShown = false;

    const mapReadyPromise = Promise.resolve(buildLevelForCurrentMode(targetLevel));

    const seedOnce = async () => {
      if (typeof window.resetLevelState === 'function') {
        try { window.resetLevelState(); } catch (err) { console.warn('[resetLevelState]', err); }
      }
      G.__placementsApplied = false;
      let placementApplied = false;
      const asciiString = Array.isArray(ASCII_MAP) ? ASCII_MAP.join('\n') : String(ASCII_MAP || '');
      const levelCfg = G._lastLevelCfg || {
        G,
        mode: (DEBUG_MAP_MODE ? 'debug' : 'normal'),
        debug: DEBUG_MAP_MODE,
        asciiMap: asciiString,
        ascii: asciiString,
        asciiRows: Array.isArray(ASCII_MAP) ? ASCII_MAP.slice() : normalizeAsciiFromText(asciiString),
        allowAscii: !!asciiString,
        forceAscii: true,
        map: G.map,
        areas: G.mapAreas,
        width: G.mapW,
        height: G.mapH,
        level: G.level,
        seed: G.seed,
        placements: (() => {
          const base = Array.isArray(G.__asciiPlacements) ? G.__asciiPlacements.slice() : [];
          if (Array.isArray(G.mapgenPlacements) && G.mapgenPlacements.length) {
            base.push(...G.mapgenPlacements);
          }
          return base;
        })()
      };
      try {
        if (window.Placement?.applyFromAsciiMap) {
          const result = await window.Placement.applyFromAsciiMap(levelCfg);
          placementApplied = (result?.applied === true || result?.reason === 'guard');
          if (result?.applied) {
            try { window.Placement?.summarize?.(); } catch(_){}
          }
        }
      } catch (err){
        console.warn('[Placement] applyFromAsciiMap error', err);
      }

      if (placementApplied) {
        G._hasPlaced = true;
        window.LOG?.event?.('PLACEMENT_APPLIED', {
          mode: DEBUG_MAP_MODE ? 'debug' : 'normal',
          source: 'ascii',
          entities: Array.isArray(G.entities) ? G.entities.length : null
        });
      } else {
        finalizeLevelBuildOnce({ forceFallback: true });
        if (Array.isArray(G.entities) && G.entities.length) {
          G._hasPlaced = true;
        }
        window.LOG?.event?.('PLACEMENT_APPLIED', {
          mode: DEBUG_MAP_MODE ? 'debug' : 'normal',
          source: 'fallback',
          entities: Array.isArray(G.entities) ? G.entities.length : null
        });
      }

      return placementApplied;
    };

    const postSeed = (placementApplied) => {
      try {
        if (Array.isArray(G.entities)) for (const e of G.entities) window.AI?.register?.(e);
        window.Minimap?.refresh?.();
      } catch(_){ }

      centerCameraOnPlayer();

      document.getElementById('minimapOverlay')?.classList.add('hidden');
      document.getElementById('minimap')?.classList.remove('expanded');
      window.__setMinimapMode?.('small');
      window.__toggleMinimap?.(false);
      window.__toggleMinimap?.(true);

      configureLevelSystems();

      window.LOG?.event?.('LEVEL_READY', {
        level: targetLevel,
        debug: DEBUG_MAP_MODE,
        placement: placementApplied ? 'ascii' : 'fallback'
      });

      try {
        window.GameFlowAPI?.startLevel?.(targetLevel);
      } catch (err){
        console.warn('[GameFlow] startLevel error:', err);
      }

      try {
        window.ObjectiveSystem?.resetForLevel?.(G);
      } catch (err) {
        if (window.DEBUG_FORCE_ASCII) console.warn('[ObjectiveSystem] reset error', err);
      }

      try {
        const rigCount = window.PuppetAPI?.getActiveCount?.();
        const entityCount = Array.isArray(G.entities) ? G.entities.filter(Boolean).length : 0;
        if (rigCount != null){
          console.log(`[Puppet] Rigs tras seed: ${rigCount} / entidades=${entityCount}`);
        }
        window.PuppetAPI?.debugListAll?.('level-ready');
      } catch (err){
        if (window.DEBUG_FORCE_ASCII) console.warn('[Puppet] level-ready audit error', err);
      }

      try {
        exportAsciiMapForDebug();
      } catch (err) {
        console.warn('[debug-export] exportAsciiMapForDebug error', err);
      }

      setGameState('READY');
      if (DEBUG_MAP_MODE) {
        logThrough('info', '[startGame] modo debug activo, esperando confirmación del jugador', {
          state: G.state
        });
        window.LOG?.event?.('DEBUG_WAITING', {
          level: targetLevel,
          state: G.state
        });
      }
      window.dispatchEvent(new CustomEvent('game:start', {
        detail: { level: targetLevel, debug: DEBUG_MAP_MODE, restart: wasRestart }
      }));
    };

    mapReadyPromise
      .catch((err) => {
        console.warn('[startGame] buildLevelForCurrentMode error', err);
        if (!Array.isArray(ASCII_MAP) || !ASCII_MAP.length) {
          ASCII_MAP = FALLBACK_DEBUG_ASCII_MAP.slice();
          parseMap(ASCII_MAP);
        }
        finalizeLevelBuildOnce({ forceFallback: true });
      })
      .then(() => seedOnce())
      .then(
        (placementApplied) => {
          try {
            postSeed(placementApplied);
          } catch (err) {
            console.warn('[startGame] postSeed error', err);
          }
        },
        (err) => {
          console.warn('[Placement] async seed error', err);
          finalizeLevelBuildOnce({ forceFallback: true });
          try {
            postSeed(false);
          } catch (postErr) {
            console.warn('[startGame] postSeed error tras fallo', postErr);
          }
        }
      );
  }


  function togglePause(){
    if (G.state==='PLAYING'){
      G.state='PAUSED';
      G.levelState = 'PAUSED';
      pausedScreen.classList.remove('hidden');
    }
    else if (G.state==='PAUSED'){
      G.state='PLAYING';
      G.levelState = 'PLAYING';
      pausedScreen.classList.add('hidden');
    }
  }

  function attachUIHandlers(){
    if (attachUIHandlers._done) return;
    attachUIHandlers._done = true;
    const startBtn = document.getElementById('start-button');
    if (startBtn){
      startBtn.addEventListener('click', () => {
        ensureHeroSelected();
        requestAnimationFrame(() => startGame());
      });
    }
    document.getElementById('resumeBtn')?.addEventListener('click', togglePause);
    document.getElementById('restartBtn')?.addEventListener('click', () => startGame());

    const narratorToggle = document.getElementById('opt-narrator');
    if (narratorToggle) {
      try {
        const stored = window.localStorage?.getItem('optNarrator');
        if (stored != null) narratorToggle.checked = stored !== '0';
      } catch (_) {}
      narratorToggle.addEventListener('change', () => {
        const enabled = narratorToggle.checked !== false;
        try { window.localStorage?.setItem('optNarrator', enabled ? '1' : '0'); } catch (_) {}
        try { window.Narrator?.setEnabled?.(enabled); } catch (_) {}
      });
      requestAnimationFrame(() => {
        const enabled = narratorToggle.checked !== false;
        try { window.Narrator?.setEnabled?.(enabled); } catch (_) {}
      });
    } else {
      requestAnimationFrame(() => {
        try { window.Narrator?.setEnabled?.(true); } catch (_) {}
      });
    }
  }

  function runBootstrapDiagnostics(){
    const missing = [];
    if (!window.G) missing.push('G');
    if (!window.PuppetAPI) missing.push('PuppetAPI');
    if (!window.Entities) missing.push('Entities');
    if (typeof window.toScreen !== 'function') missing.push('toScreen');
    if (missing.length){
      logThrough('error', '[bootstrap] dependencias ausentes', { missing });
      window.LOG?.event('BOOT_CHECK', { ok: false, missing });
    } else {
      logThrough('info', '[bootstrap] dependencias OK', { debug: DEBUG_MAP_MODE, diag: DIAG_MODE });
      window.LOG?.event('BOOT_CHECK', { ok: true, debug: DEBUG_MAP_MODE, diag: DIAG_MODE });
    }
  }

  function bootstrapGame(){
    attachUIHandlers();
    resetGameWorld({ levelState: 'READY_TO_START', reason: 'bootstrap' });
    if (window.LOG?.init){
      window.LOG.init({ buffer: 2000, uiHotkey: 'F10', verbose: DIAG_MODE, level: DIAG_MODE ? 'debug' : 'info' });
      if (DIAG_MODE) window.LOG.level = 'debug';
      if (DIAG_MODE) window.LOG.debug?.('[diag] modo diagnóstico activo');
      window.LOG.counter('mapMode', DEBUG_MAP_MODE ? 'debug' : 'normal');
    }
    requestAnimationFrame(loop);
    // Autostart SOLO si viene ?autoplay=1 (útil para dev), si no, espera al botón
    const p = new URLSearchParams(location.search);
    if (p.get('autoplay') === '1') {
      ensureHeroSelected();
      window.LOG?.debug?.('[autostart] autoplay=1 → start automático');
      requestAnimationFrame(() => startGame());
    } else if (DEBUG_MAP_MODE) {
      window.LOG?.debug?.('[debug] map=debug → sin autostart; esperar botón');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapGame, { once: true });
  } else {
    bootstrapGame();
  }
  window.addEventListener('load', runBootstrapDiagnostics, { once: true });

  // Exponer algunas APIs esperadas por otros plugins/sistemas
  window.TILE_SIZE = TILE;
  G.TILE_SIZE = TILE;
  window.ENT = ENT;                 // para plugins/sprites
  window.G = G;
  window.camera = camera;
  G.resetGameWorld = resetGameWorld;
  G.resetAndLoadLevel = resetAndLoadLevel;
  window.resetGameWorld = resetGameWorld;
  window.toScreen = bridgeToScreen;
  window.startGame = startGame;
  window.damagePlayer = damagePlayer; // ⬅️ EXponer daño del héroe para las ratas
  })();
// ==== DEBUG MINI-MAP OVERLAY =================================================
(function(){
  window.__toggleMinimap = window.__toggleMinimap || function(){};
  window.__setMinimapMode = window.__setMinimapMode || function(){ return 'small'; };
  window.__toggleMinimapMode = window.__toggleMinimapMode || function(){ return 'small'; };

  // Actívalo siempre por defecto; permite desactivarlo explícitamente con ?mini=0
  const searchParams = location.search || '';
  const forcedOff = /[?&]mini=0\b/.test(searchParams);
  if (forcedOff) {
    window.LOG?.debug?.('[minimap] mini=0 → minimapa desactivado');
    return;
  }

  const TILE = window.TILE_SIZE || window.TILE || 32;
  const VIEW_W = window.VIEW_W || 1024;
  const VIEW_H = window.VIEW_H || 768;
  const SMALL_SIZE = 224;

  let minimapMode = 'small';
  let minimapVisible = false;

  let mm = document.getElementById('minimap');
  if (!mm) {
    mm = document.createElement('canvas');
    mm.id = 'minimap';
    mm.style.position = 'fixed';
    mm.style.imageRendering = 'pixelated';
    mm.style.pointerEvents = 'auto';
    mm.style.cursor = 'pointer';
    document.body.appendChild(mm);
  }
  const mctx = mm.getContext('2d');

  function applyMode(){
    if (minimapMode === 'big'){
      const w = Math.max(256, Math.floor(window.innerWidth || VIEW_W));
      const h = Math.max(256, Math.floor(window.innerHeight || VIEW_H));
      mm.width = w;
      mm.height = h;
      mm.style.left = '0';
      mm.style.top = '0';
      mm.style.right = '';
      mm.style.bottom = '';
      mm.style.width = '100vw';
      mm.style.height = '100vh';
      mm.style.zIndex = '200';
      mm.style.background = 'rgba(8,10,16,0.85)';
      mm.style.borderRadius = '0';
      mm.style.boxShadow = 'none';
    } else {
      mm.width = SMALL_SIZE;
      mm.height = SMALL_SIZE;
      mm.style.right = '12px';
      mm.style.bottom = '12px';
      mm.style.left = '';
      mm.style.top = '';
      mm.style.width = `${SMALL_SIZE}px`;
      mm.style.height = `${SMALL_SIZE}px`;
      mm.style.zIndex = '48';
      mm.style.background = 'rgba(12,16,24,0.72)';
      mm.style.borderRadius = '12px';
      mm.style.boxShadow = '0 8px 24px rgba(0,0,0,0.45)';
    }
  }

  function updateVisibility(){
    mm.style.display = minimapVisible ? 'block' : 'none';
  }

  window.__setMinimapMode = (mode) => {
    const next = mode === 'big' ? 'big' : 'small';
    if (minimapMode !== next){
      minimapMode = next;
      applyMode();
    }
    return minimapMode;
  };
  window.__toggleMinimapMode = () => {
    const next = minimapMode === 'big' ? 'small' : 'big';
    window.__setMinimapMode(next);
    return minimapMode;
  };
  window.__toggleMinimap = (on) => {
    minimapVisible = !!on;
    updateVisibility();
  };

  // Arranca siempre en modo pequeño y visible; el overlay grande se alterna con clic/espacio
  minimapMode = window.__setMinimapMode('small');
  minimapVisible = true;
  updateVisibility();

  mm.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    window.__toggleMinimapMode();
  });
  mm.addEventListener('mousedown', (ev) => ev.stopPropagation());
  window.addEventListener('resize', () => {
    if (minimapMode === 'big') applyMode();
  });

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
    if (!minimapVisible) { requestAnimationFrame(drawMinimap); return; }

    const w = G.mapW, h = G.mapH;
    const scale = Math.min(mm.width / w, mm.height / h);
    const offsetX = (mm.width - w * scale) * 0.5;
    const offsetY = (mm.height - h * scale) * 0.5;
    const cellSize = scale;

    // Mapa base
    mctx.clearRect(0,0,mm.width,mm.height);
    for (let ty=0; ty<h; ty++){
      for (let tx=0; tx<w; tx++){
        const v = (G.map[ty] && G.map[ty][tx]) ? 1 : 0; // 1=pared, 0=suelo
        mctx.fillStyle = v ? '#1d1f22' : '#6b7280';
        mctx.fillRect(offsetX + tx*scale, offsetY + ty*scale, cellSize, cellSize);
      }
    }

    // Entidades (puntitos)
    const ents = (G.entities || []);
    for (const e of ents){
      const ex = ((e.x || 0) + ((e.w || TILE) * 0.5)) / TILE;
      const ey = ((e.y || 0) + ((e.h || TILE) * 0.5)) / TILE;
      mctx.fillStyle = colorFor(e);
      mctx.fillRect(offsetX + ex*scale, offsetY + ey*scale, Math.max(1, cellSize*0.85), Math.max(1, cellSize*0.85));
    }

    // Player
    if (G.player){
      const px = ((G.player.x||0) + ((G.player.w||TILE) * 0.5))/TILE;
      const py = ((G.player.y||0) + ((G.player.h||TILE) * 0.5))/TILE;
      mctx.fillStyle = '#ffffff';
      mctx.fillRect(offsetX + px*scale, offsetY + py*scale, Math.max(1, cellSize), Math.max(1, cellSize));
    }

    // Frustum de cámara (rectángulo)
    const cam = window.camera || {x:0,y:0,zoom:1};
    const vwTiles = VIEW_W / (TILE*cam.zoom);
    const vhTiles = VIEW_H / (TILE*cam.zoom);
    const leftTiles = (cam.x/TILE) - vwTiles*0.5;
    const topTiles  = (cam.y/TILE) - vhTiles*0.5;
    mctx.strokeStyle = '#ffffff';
    mctx.lineWidth = 1;
    mctx.strokeRect(offsetX + leftTiles*scale, offsetY + topTiles*scale, vwTiles*scale, vhTiles*scale);

    requestAnimationFrame(drawMinimap);
  }
  drawMinimap();
})();
// ==== /DEBUG MINI-MAP OVERLAY ================================================
