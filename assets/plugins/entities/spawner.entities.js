// filename: spawner.entities.js
// Sistema de spawners visibles con colas por población (animals / humans / carts).
// - Cada spawner tiene sprite propio, cooldown fijo de 120 s y cola interna.
// - Las muertes notifican a SpawnerAPI.notifyDeath(entity|data) para encolar reapariciones.
// - SpawnerAPI reparte peticiones al spawner con menor cola y más cercano al jugador.
// - Compatibilidad: se expone SpawnerManager con firmas similares al módulo previo.

(function (W) {
  'use strict';

  const TILE = (typeof W.TILE_SIZE === 'number') ? W.TILE_SIZE : (typeof W.TILE === 'number' ? W.TILE : 32);
  const COOLDOWN_SEC = 120;
  const STATE = {
    spawners: { animals: [], humans: [], carts: [] },
    pending: { animals: [], humans: [], carts: [] },
    autoUpdateHooked: false
  };

  // ------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------
  function getGame() { return W.G || (W.G = { entities: [] }); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function logDebug(...args) { if (W.DEBUG_SPAWNER) try { console.info('[Spawner]', ...args); } catch (_) {} }
  function nowSec() { return (W.performance && performance.now ? performance.now() / 1000 : Date.now() / 1000); }

  function distanceToPlayer(sp) {
    const g = getGame();
    const p = g.player;
    if (!p) return Infinity;
    const dx = (sp.worldX || sp.x) - (p.x || 0);
    const dy = (sp.worldY || sp.y) - (p.y || 0);
    return Math.hypot(dx, dy);
  }

  function ensureAutoUpdate() {
    if (STATE.autoUpdateHooked) return;
    const game = getGame();
    if (Array.isArray(game.systems)) {
      game.systems.push({ id: 'spawner_api', update: (dt) => SpawnerAPI.update(dt) });
      STATE.autoUpdateHooked = true;
      return;
    }
    // Fallback suave si no existe systems
    let last = nowSec();
    function tick() {
      const t = nowSec();
      const dt = clamp(t - last, 0, 0.25);
      last = t;
      try { SpawnerAPI.update(dt); } catch (_) {}
      W.requestAnimationFrame(tick);
    }
    W.requestAnimationFrame(tick);
    STATE.autoUpdateHooked = true;
  }

  function normalizeType(raw) {
    const t = String(raw || '').toLowerCase();
    if (t === 'enemy' || t === 'animals' || t === 'animal') return 'animals';
    if (t === 'npc' || t === 'human' || t === 'humans') return 'humans';
    if (t === 'cart' || t === 'carts' || t === 'car') return 'carts';
    return t;
  }

  function spriteForType(spawnType) {
    switch (spawnType) {
      case 'animals': return { spriteKey: 'spawner_animals', skin: 'spawner_animals.png' };
      case 'humans':  return { spriteKey: 'spawner_humans',  skin: 'spawner_humans.png' };
      case 'carts':   return { spriteKey: 'spawner_carts',   skin: 'spawner_carts.png' };
      default:        return { spriteKey: 'spawner_generic', skin: 'spawner_generic.png' };
    }
  }

  function createSpawnerEntity(spawnType, x, y, opts = {}) {
    const { spriteKey, skin } = spriteForType(spawnType);
    const baseX = opts.inTiles ? x * TILE : x;
    const baseY = opts.inTiles ? y * TILE : y;
    const w = opts.w || TILE * 0.9;
    const h = opts.h || TILE * 0.9;
    return {
      id: 'SP_' + Math.random().toString(36).slice(2),
      spawnType,
      x, y, w, h,
      worldX: baseX,
      worldY: baseY,
      inTiles: !!opts.inTiles,
      static: true,
      solid: false,
      spriteKey,
      skin,
      puppet: opts.puppet || null,
      _cooldown: 0,
      _queue: [],
      allows: Array.isArray(opts.allows) ? opts.allows.map((s) => String(s || '').toLowerCase()) : [],
      prefer: typeof opts.prefer === 'string' ? opts.prefer.toLowerCase() : '',
      _meta: opts.meta || {},
    };
  }

  function spawnerQueueLength(sp) { return Array.isArray(sp?._queue) ? sp._queue.length : 0; }

  function spawnerAccepts(sp, template) {
    if (!sp) return false;
    if (!sp.allows || !sp.allows.length) return true;
    const key = (template?.kind || template?.role || template?.sub || '').toLowerCase();
    if (!key) return true;
    return sp.allows.includes(key);
  }

  function assignRequestToBestSpawner(type, request) {
    const list = STATE.spawners[type];
    if (!Array.isArray(list) || !list.length) return false;
    const candidates = list.filter((sp) => spawnerAccepts(sp, request.template));
    if (!candidates.length) return false;
    let best = candidates[0];
    for (const sp of candidates) {
      const lenBest = spawnerQueueLength(best);
      const lenCur = spawnerQueueLength(sp);
      if (lenCur < lenBest) { best = sp; continue; }
      if (lenCur === lenBest) {
        if (distanceToPlayer(sp) < distanceToPlayer(best)) best = sp;
      }
    }
    best._queue.push(request);
    logDebug('Asignado request a spawner', { spawner: best.id, type, pending: best._queue.length });
    return true;
  }

  function processGlobalPending(type) {
    const pend = STATE.pending[type];
    if (!pend.length) return;
    for (let i = pend.length - 1; i >= 0; i--) {
      const req = pend[i];
      const ok = assignRequestToBestSpawner(type, req);
      if (ok) pend.splice(i, 1);
    }
  }

  // ------------------------------------------------------------
  // Spawners
  // ------------------------------------------------------------
  const Spawn = {
    animals(sub, x, y, payload) {
      const key = (sub || payload?.kind || payload?.role || '').toLowerCase();
      if (key === 'mosquito' && W.MosquitoAPI?.spawn) return W.MosquitoAPI.spawn(x, y, payload);
      if (key === 'rat' && W.RatsAPI?.spawn) return W.RatsAPI.spawn(x, y, payload);
      if (W.Entities?.Enemy?.spawn) return W.Entities.Enemy.spawn(key, x, y, payload);
      console.warn('[SpawnerAPI] No hay factory para animal:', key);
      return null;
    },
    humans(sub, x, y, payload) {
      const key = (sub || payload?.role || payload?.kind || '').toLowerCase();
      if (W.Entities?.NPC?.spawn) return W.Entities.NPC.spawn(key, x, y, payload);
      if (W.Entities?.SupervisoraAPI?.spawn && key === 'supervisora') return W.Entities.SupervisoraAPI.spawn(x, y);
      if (W.Entities?.Guardia?.spawn && key === 'guardia') return W.Entities.Guardia.spawn({ tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) });
      if (W.Entities?.TCAE?.spawn && key === 'tcae') return W.Entities.TCAE.spawn({ tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) });
      if (W.EnfermeraSexyAPI?.spawnEnfermera && (key === 'enfermera' || key === 'enfermera_sexy')) {
        return W.EnfermeraSexyAPI.spawnEnfermera(Math.floor(x / TILE), Math.floor(y / TILE), {});
      }
      if (W.MedicoAPI?.registerMedicEntity && key === 'medico') {
        const e = { x, y, w: TILE * 0.9, h: TILE * 0.9 };
        W.MedicoAPI.registerMedicEntity(e);
        return e;
      }
      if (W.FamiliarAPI?.registerFamiliarEntity && key === 'familiar') {
        const e = { x, y, w: TILE * 0.95, h: TILE * 0.95 };
        W.FamiliarAPI.registerFamiliarEntity(e);
        return e;
      }
      if (W.Humans && typeof W.Humans.spawn === 'function') return W.Humans.spawn(key, x, y, payload);
      console.warn('[SpawnerAPI] No hay factory para human:', key);
      return null;
    },
    carts(sub, x, y, payload) {
      const key = (sub || payload?.kind || payload?.type || '').toLowerCase();
      if (W.Entities?.Cart?.spawn) return W.Entities.Cart.spawn(key, x, y, payload);
      if (W.CartsAPI?.spawn) return W.CartsAPI.spawn({ type: key, x, y, ...(payload || {}) });
      console.warn('[SpawnerAPI] No hay factory para cart:', key);
      return null;
    }
  };

  function spawnFromSpawner(sp) {
    if (!sp || !sp._queue.length) return false;
    const req = sp._queue[0];
    const baseX = sp.inTiles ? sp.x * TILE : sp.worldX;
    const baseY = sp.inTiles ? sp.y * TILE : sp.worldY;
    const payload = Object.assign({ spawnerId: sp.id }, req.template || {});

    let ent = null;
    if (sp.spawnType === 'animals') ent = Spawn.animals(payload.kind || payload.sub, baseX, baseY, payload);
    else if (sp.spawnType === 'humans') ent = Spawn.humans(payload.role || payload.kind || payload.sub, baseX, baseY, payload);
    else if (sp.spawnType === 'carts') ent = Spawn.carts(payload.kind || payload.type || payload.sub, baseX, baseY, payload);

    if (ent) {
      sp._queue.shift();
      sp._cooldown = COOLDOWN_SEC;
      const g = getGame();
      if (Array.isArray(g.entities) && !g.entities.includes(ent)) g.entities.push(ent);
      logDebug('Spawn realizado', { spawner: sp.id, type: sp.spawnType, remaining: sp._queue.length });
      return true;
    }
    return false;
  }

  function tickSpawner(sp, dt) {
    sp._cooldown = Math.max(0, (sp._cooldown || 0) - dt);
    if (sp._cooldown > 0) return;
    if (!sp._queue.length) return;
    spawnFromSpawner(sp);
  }

  // ------------------------------------------------------------
  // Notificación de muertes y colas
  // ------------------------------------------------------------
  function normalizeTemplateFromEntity(entity) {
    if (!entity) return {};
    const role = (entity.role || entity.kindName || entity.kind || entity.type || '').toString().toLowerCase();
    const cartType = (entity.cartType || entity.cartTier || '').toString().toLowerCase();
    const template = {};
    if (entity.spawnTemplate && typeof entity.spawnTemplate === 'object') Object.assign(template, entity.spawnTemplate);
    if (entity.sub) template.sub = entity.sub;
    if (entity.kindName) template.kind = entity.kindName.toLowerCase();
    if (entity.kind && typeof entity.kind === 'string') template.kind = entity.kind.toLowerCase();
    if (entity.role) template.role = entity.role.toLowerCase();
    if (cartType) template.kind = cartType;
    else if (role) template.kind = role;
    return template;
  }

  function resolvePopulationFromEntity(entity) {
    if (!entity) return null;
    const ENT = W.ENT || {};
    const kind = (entity.kindName || entity.kind || '').toString().toLowerCase();
    const role = (entity.role || '').toString().toLowerCase();
    const sprite = (entity.spriteKey || entity.skin || '').toString().toLowerCase();

    if (entity.kind === ENT.CART || kind === 'cart' || entity.cartType) return 'carts';
    if (kind === 'mosquito' || kind === 'rat' || sprite.includes('mosquito') || sprite.includes('rat')) return 'animals';
    if (role || sprite.includes('enfermera') || sprite.includes('guardia') || sprite.includes('tcae')) return 'humans';
    return null;
  }

  function enqueueRequest(population, template) {
    const type = normalizeType(population);
    if (!STATE.pending[type]) STATE.pending[type] = [];
    const req = { type, template: template || {}, createdAt: nowSec() };
    const assigned = assignRequestToBestSpawner(type, req);
    if (!assigned) STATE.pending[type].push(req);
    logDebug('Nueva petición encolada', { type, assigned });
  }

  // ------------------------------------------------------------
  // API pública
  // ------------------------------------------------------------
  const SpawnerAPI = {
    /** Registra un spawner visible y lo añade a la escena */
    registerSpawner(type, x, y, opts = {}) {
      const spawnType = normalizeType(type);
      if (!STATE.spawners[spawnType]) STATE.spawners[spawnType] = [];
      const sp = createSpawnerEntity(spawnType, x, y, opts);
      STATE.spawners[spawnType].push(sp);
      const g = getGame();
      if (Array.isArray(g.entities) && !g.entities.includes(sp)) g.entities.push(sp);
      processGlobalPending(spawnType);
      logDebug('Spawner registrado', { spawnType, id: sp.id });
      return sp;
    },

    /** Notifica una muerte para encolar respawn */
    notifyDeath(data) {
      if (!data) return;
      let population = null;
      let template = {};
      if (typeof data === 'string') {
        population = data;
      } else if (data.population) {
        population = data.population;
        template = data.template || {};
      } else if (data.entity) {
        population = resolvePopulationFromEntity(data.entity);
        template = normalizeTemplateFromEntity(data.entity);
      } else {
        population = resolvePopulationFromEntity(data);
        template = normalizeTemplateFromEntity(data);
      }
      if (!population) return;
      enqueueRequest(population, template);
    },

    /** Procesa colas y cooldowns */
    update(dt = 0) {
      if (!dt || !isFinite(dt)) return;
      ['animals', 'humans', 'carts'].forEach((type) => processGlobalPending(type));
      for (const type of Object.keys(STATE.spawners)) {
        for (const sp of STATE.spawners[type]) { tickSpawner(sp, dt); }
      }
    },

    /** Resumen de depuración */
    debugSummary() {
      return {
        spawners: Object.fromEntries(Object.entries(STATE.spawners).map(([k, arr]) => [k, arr.map((s) => ({ id: s.id, queue: s._queue.length, cooldown: s._cooldown }))])),
        pending: STATE.pending
      };
    }
  };

  // ------------------------------------------------------------
  // Compatibilidad con la API previa
  // ------------------------------------------------------------
  const SpawnerManager = {
    init(Gref) { if (Gref) W.G = Gref; ensureAutoUpdate(); return this; },
    registerPoint(type, x, y, opts) { return SpawnerAPI.registerSpawner(type, x, y, opts); },
    registerFromPlacement(p) {
      if (!p || !p.type) return null;
      const t = String(p.type).toLowerCase();
      const inTiles = !!p.inTiles;
      const px = inTiles ? p.x : (p.x | 0);
      const py = inTiles ? p.y : (p.y | 0);
      if (t === 'spawn_mosquito' || t === 'spawn_rat' || t === 'spawn_animal') {
        return SpawnerAPI.registerSpawner('animals', px, py, { inTiles, allows: p.allows || [], prefer: p.prefer });
      }
      if (t === 'spawn_staff' || t === 'spawn_human') return SpawnerAPI.registerSpawner('humans', px, py, { inTiles, allows: p.allows || [] });
      if (t === 'spawn_cart') return SpawnerAPI.registerSpawner('carts', px, py, { inTiles, allows: p.allows || [] });
      return null;
    },
    reportDeath(type, sub, n = 1) {
      const population = normalizeType(type);
      for (let i = 0; i < Math.max(1, n | 0); i++) enqueueRequest(population, { kind: sub });
    },
    update(dt) { SpawnerAPI.update(dt); }
  };

  W.SpawnerAPI = SpawnerAPI;
  W.SpawnerManager = SpawnerManager; // compat
  SpawnerManager.init(W.G);

})(this);
