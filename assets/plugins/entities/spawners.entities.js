(function (root) {
  'use strict';

  const G = root.G || (root.G = {});
  const TILE = root.TILE_SIZE || 32;
  const HERO_Z = root.HERO_Z || 10;

  const SpawnerAPI = root.SpawnerAPI || (root.SpawnerAPI = {});
  const EntityFactory = root.EntityFactory || (root.EntityFactory = {});
  const spawners = [];

  const POPULATION = {
    ANIMALS: 'animals',
    HUMANS: 'humans',
    CARTS: 'carts'
  };

  function spawnerIgnoreDamage() { return false; }
  function spawnerIgnoreDeath(e) { if (e) e.dead = false; return false; }

  function createSpawnerEntity(cfg) {
    const base = createPhysicalEntity({
      kind: cfg.kind,
      x: cfg.x,
      y: cfg.y,
      w: 24,
      h: 24,
      solid: false,
      isFloorTile: true,
      health: 9999,
      fireImmune: true,
      touchDamage: 0,
      populationType: 'none',
      group: 'spawners',
      spriteId: cfg.spriteId,
      z: HERO_Z
    });

    base.aiState = 'idle';
    base.aiTimer = 0;
    base.aiUpdate = spawnerAiUpdate;
    base.spawnPopulation = cfg.spawnPopulation;
    base.spawnRadiusTiles = cfg.spawnRadiusTiles || 3;
    base.spawnCooldownBase = cfg.spawnCooldownBase;
    base.spawnCooldownRand = cfg.spawnCooldownRand || 1.5;
    base._cooldown = 0;
    base.lastTemplateKey = null;
    base.world = cfg.world || G.worldId || 'default';

    base.onDamage = spawnerIgnoreDamage;
    base.onDeath = spawnerIgnoreDeath;

    return base;
  }

  function distanceSq(a, b) {
    if (!a || !b) return Infinity;
    const dx = (a.x || 0) - (b.x || 0);
    const dy = (a.y || 0) - (b.y || 0);
    return dx * dx + dy * dy;
  }

  function normalizePopulation(pop) {
    const key = (pop || '').toString().toLowerCase();
    if (key.startsWith('animal')) return POPULATION.ANIMALS;
    if (key.startsWith('human')) return POPULATION.HUMANS;
    if (key.startsWith('cart')) return POPULATION.CARTS;
    return null;
  }

  function resolveTemplateKey(info) {
    if (!info) return null;
    const ent = info.entity || {};
    return info.templateId || info.template || ent.templateId || ent.template || ent.spawnTemplate || ent.kind || info.kind || null;
  }

  function isWalkableTile(tx, ty) {
    if (!Array.isArray(G.map) || !Array.isArray(G.map[ty])) return false;
    return G.map[ty][tx] === 0;
  }

  function findFreeTileAround(spawner) {
    const radius = Math.max(1, Math.round(spawner.spawnRadiusTiles || 1));
    const cx = spawner.tileX ?? Math.round(spawner.x / TILE);
    const cy = spawner.tileY ?? Math.round(spawner.y / TILE);
    const candidates = [];

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 0 || ty < 0) continue;
        if (!isWalkableTile(tx, ty)) continue;
        const px = tx * TILE + TILE / 2;
        const py = ty * TILE + TILE / 2;
        candidates.push({ tx, ty, x: px, y: py, dist: (dx * dx + dy * dy) });
      }
    }

    candidates.sort((a, b) => a.dist - b.dist);
    return candidates[0] || null;
  }

  function spawnCooldown(e) {
    const base = Number(e.spawnCooldownBase) || 0;
    const rand = Number(e.spawnCooldownRand) || 0;
    const jitter = rand ? (Math.random() * 2 - 1) * rand : 0;
    return Math.max(0.1, base + jitter);
  }

  function spawnerAiUpdate(e, dt) {
    if (!e || e.aiState === 'disabled') return;

    if (e._cooldown > 0) {
      e._cooldown = Math.max(0, e._cooldown - dt);
      if (e._cooldown > 0) {
        e.aiState = 'cooldown';
        return;
      }
    }

    if (e.aiState === 'cooldown' && e._cooldown <= 0) {
      e.aiState = 'idle';
    }

    if (e.aiState !== 'spawning') return;

    if (!e.lastTemplateKey) {
      e.aiState = 'idle';
      return;
    }

    const spot = findFreeTileAround(e);
    if (!spot) {
      e._cooldown = 0.75;
      e.aiState = 'cooldown';
      return;
    }

    const spawned = EntityFactory.spawnFromTemplate?.(e.lastTemplateKey, {
      tileX: spot.tx,
      tileY: spot.ty,
      tx: spot.tx,
      ty: spot.ty,
      x: spot.x,
      y: spot.y,
      spawnPopulation: e.spawnPopulation,
      fromSpawner: e,
      world: e.world
    });

    e._cooldown = spawnCooldown(e);
    e.aiState = 'cooldown';

    if (!spawned) return;
    try { if (!G.entities?.includes(spawned)) G.entities.push(spawned); } catch (_) {}
  }

  function resolveCartSpawner(key, tx, ty, opts) {
    if (!root.Entities?.Carts) return null;
    switch (key) {
      case 'cart_emergency': return root.Entities.Carts.spawnEmergencyCart?.(tx, ty, opts);
      case 'cart_meds': return root.Entities.Carts.spawnCartMeds?.(tx, ty, opts);
      case 'cart_food':
      case 'cart':
      default: return root.Entities.Carts.spawnCartFood?.(tx, ty, opts);
    }
  }

  function spawnFromTemplate(templateKey, opts = {}) {
    if (!templateKey) return null;
    const key = String(templateKey).toLowerCase();
    const tx = opts.tx ?? opts.tileX;
    const ty = opts.ty ?? opts.tileY;
    const x = opts.x ?? (Number.isFinite(tx) && Number.isFinite(ty) ? tx * TILE + TILE / 2 : null);
    const y = opts.y ?? (Number.isFinite(tx) && Number.isFinite(ty) ? ty * TILE + TILE / 2 : null);
    const args = { ...opts, tx, ty, x, y };

    const map = {
      rat: () => root.Entities?.spawnRatAtTile?.(tx, ty, args) || root.Entities?.spawnRatFromAscii?.(tx, ty, args),
      mosquito: () => root.Entities?.spawnMosquitoAtTile?.(tx, ty, args) || root.Entities?.spawnMosquitoFromAscii?.(tx, ty, args),
      guard: () => root.Entities?.Guardia?.spawnFromAscii?.(tx, ty, args) || root.Entities?.spawnGuardiaFromAscii?.(tx, ty, args),
      cleaner: () => root.Entities?.spawnCleanerFromAscii?.(tx, ty, args) || root.Entities?.Cleaner?.spawn?.(tx, ty, args),
      supervisor: () => root.Entities?.spawnSupervisorFromAscii?.(tx, ty, args) || root.Entities?.Supervisor?.spawn?.(tx, ty, args),
      celador: () => root.Entities?.spawnCeladorFromAscii?.(tx, ty, args) || root.Entities?.Celador?.spawnCeladorAtTile?.(tx, ty, args),
      tcae: () => root.Entities?.spawnTcaeAtTile?.(tx, ty, args) || root.Entities?.TCAE?.spawn?.(tx, ty, args),
      visitor_annoying: () => root.Entities?.VisitorAnnoying?.spawnAtTile?.(tx, ty, args),
      cart: () => resolveCartSpawner('cart_food', tx, ty, args),
      cart_food: () => resolveCartSpawner('cart_food', tx, ty, args),
      cart_meds: () => resolveCartSpawner('cart_meds', tx, ty, args),
      cart_emergency: () => resolveCartSpawner('cart_emergency', tx, ty, args)
    };

    const factory = map[key];
    if (typeof factory === 'function') return factory();

    return null;
  }

  EntityFactory.spawnFromTemplate = spawnFromTemplate;

  SpawnerAPI.createSpawner = function createSpawner(cfg) {
    if (!cfg || !cfg.kind) return null;
    const sp = createSpawnerEntity(cfg);
    if (!sp) return null;
    sp.tileX = cfg.tileX ?? Math.round(sp.x / TILE);
    sp.tileY = cfg.tileY ?? Math.round(sp.y / TILE);
    spawners.push(sp);
    return sp;
  };

  SpawnerAPI.reset = function resetSpawners() {
    spawners.length = 0;
  };

  SpawnerAPI.notifyDeath = function notifyDeath(info) {
    if (!info) return;
    const ent = info.entity || info;
    const pop = normalizePopulation(info.populationType || ent.populationType);
    if (!pop || !(pop === POPULATION.ANIMALS || pop === POPULATION.HUMANS || pop === POPULATION.CARTS)) return;

    const templateKey = resolveTemplateKey(info);
    if (!templateKey) return;

    const world = info.world || ent.world || G.worldId || 'default';
    let best = null;
    let bestDist = Infinity;
    for (const sp of spawners) {
      if (!sp || sp.world !== world || sp.spawnPopulation !== pop) continue;
      if (sp.aiState === 'disabled') continue;
      const dist = distanceSq(sp, ent);
      if (dist < bestDist) { best = sp; bestDist = dist; }
    }

    if (!best) return;
    if (best._cooldown > 0 && best.aiState === 'cooldown') return;

    best.lastTemplateKey = templateKey;
    best.aiState = 'spawning';
    best._cooldown = 0;
  };

  SpawnerAPI.updateAll = function updateAll(dt) {
    for (const sp of spawners) {
      if (typeof sp.aiUpdate === 'function') {
        sp.aiUpdate(sp, dt);
      }
    }
  };

  SpawnerAPI._list = spawners;
})(typeof window !== 'undefined' ? window : globalThis);
