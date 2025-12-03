(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = root.ENT || (root.ENT = {});

  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 10;
  const TILE_SIZE = root.TILE_SIZE || root.TILE || 32;
  const MAX_FIRES = 80;
  const DEBUG_FIRE = root.DEBUG_FIRE === true;

  if (typeof ENT.FIRE_HAZARD === 'undefined') ENT.FIRE_HAZARD = 'fire_hazard';

  const fires = [];

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
  }

  function overlap(a, b) {
    if (!a || !b) return false;
    const dx = Math.abs((a.x || 0) - (b.x || 0));
    const dy = Math.abs((a.y || 0) - (b.y || 0));
    return dx * 2 < (a.w + b.w) && dy * 2 < (a.h + b.h);
  }

  function worldToTile(x, y) {
    return { tx: Math.floor(x / TILE_SIZE), ty: Math.floor(y / TILE_SIZE) };
  }

  function isTileInsideMap(tx, ty) {
    if (!Array.isArray(G.map) || !G.map.length) return false;
    if (ty < 0 || ty >= G.map.length) return false;
    const row = G.map[ty];
    return Array.isArray(row) && tx >= 0 && tx < row.length;
  }

  function isWallTile(tx, ty) {
    if (!isTileInsideMap(tx, ty)) return true;
    return G.map?.[ty]?.[tx] === 1;
  }

  function removeFireFromList(fire) {
    const idx = fires.indexOf(fire);
    if (idx >= 0) fires.splice(idx, 1);
    const gIdx = Array.isArray(G.entities) ? G.entities.indexOf(fire) : -1;
    if (gIdx >= 0) G.entities.splice(gIdx, 1);
  }

  function fireOnDeath(e) {
    if (!e || e.dead) return;
    e.dead = true;
    e.state = 'dead';
    e._culled = true;
    removeFireFromList(e);

    if (root.SpawnerAPI?.notifyDeath) {
      try {
        root.SpawnerAPI.notifyDeath({ populationType: e.populationType || 'hazards', template: 'fire_tile', entity: e });
      } catch (_) {}
    }
  }

  function fireOnDamage(e, amount, cause) {
    if (!e || e.dead) return;
    if (cause === 'water' || cause === 'extinguish') {
      fireOnDeath(e);
    }
  }

  function trySpread(e) {
    const tile = worldToTile(e.x, e.y);
    const neighbors = [
      { tx: tile.tx + 1, ty: tile.ty },
      { tx: tile.tx - 1, ty: tile.ty },
      { tx: tile.tx, ty: tile.ty + 1 },
      { tx: tile.tx, ty: tile.ty - 1 },
    ];

    neighbors.forEach((pos) => {
      if (!isTileInsideMap(pos.tx, pos.ty)) return;
      if (isWallTile(pos.tx, pos.ty)) return;
      if (FireAPI.hasFireAtTile(pos.tx, pos.ty)) return;
      if (root.CleanerAPI?.isTileWet && root.CleanerAPI.isTileWet(pos.tx, pos.ty)) return;
      if (Math.random() < 0.7 && FireAPI.canSpawnMore()) {
        if (DEBUG_FIRE) console.log('[FireAPI] spread →', pos.tx, pos.ty);
        FireAPI.spawnAtTile(pos.tx, pos.ty);
      }
    });
  }

  function fireAiUpdate(e, dt = 0) {
    if (!e || e.dead) return;

    e.health -= dt;
    if (e.health <= 0) {
      fireOnDeath(e);
      return;
    }

    if (e._touchCD > 0) e._touchCD -= dt;
    if (e._touchCD <= 0) {
      const player = G.player;
      if (player && overlap(e, player) && !player.fireImmune) {
        if (root.DamageAPI?.applyTouch) {
          root.DamageAPI.applyTouch(e, player);
        }
        e._touchCD = e.touchCooldown;
      }
    }

    e.spreadTimer += dt;
    if (!e._nextSpread) {
      const range = e.spreadIntervalMax - e.spreadIntervalMin;
      e._nextSpread = e.spreadIntervalMin + Math.random() * range;
    }
    if (e.spreadTimer >= e._nextSpread) {
      e.spreadTimer = 0;
      e._nextSpread = e.spreadIntervalMin + Math.random() * (e.spreadIntervalMax - e.spreadIntervalMin);
      trySpread(e);
    }
  }

  function firePhysicsUpdate(e, dt) {
    if (!e || e.dead) return;
    if (root.PhysicsAPI?.registerHazardTile) {
      try { root.PhysicsAPI.registerHazardTile(e); } catch (_) {}
    }
  }

  function createFireAtPx(x, y, opts = {}) {
    ensureCollections();
    const ttl = opts.ttl ?? opts.health ?? 12;
    const fire = {
      id: root.genId ? root.genId() : `fire-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.FIRE_HAZARD,
      kindName: 'fire',
      x,
      y,
      w: 24,
      h: 24,
      dir: 0,
      vx: 0,
      vy: 0,
      solid: false,
      isTileWalkable: true,
      maxHealth: ttl,
      health: ttl,
      fireImmune: false,
      touchDamage: 0.5,
      touchCooldown: 1.0,
      _touchCD: 0,
      populationType: 'hazards',
      state: 'idle',
      aiState: 'burning',
      aiTimer: 0,
      spreadTimer: 0,
      spreadIntervalMin: opts.spreadIntervalMin ?? 0.7,
      spreadIntervalMax: opts.spreadIntervalMax ?? 1.3,
      puppet: { rig: 'fire_tile', z: HERO_Z, skin: 'default' },
      aiUpdate: fireAiUpdate,
      physicsUpdate: firePhysicsUpdate,
      onDamage: fireOnDamage,
      onDeath: fireOnDeath,
    };

    const tile = worldToTile(x, y);
    fire.tx = tile.tx;
    fire.ty = tile.ty;

    try { root.PuppetAPI?.attach?.(fire, fire.puppet); } catch (_) {}
    try { root.EntityGroupsAPI?.add?.(fire, 'hazards'); } catch (_) {}

    G.entities.push(fire);
    fires.push(fire);
    return fire;
  }

  const FireAPI = {
    spawnAtTile(tx, ty, opts = {}) {
      if (!this.canSpawnMore()) return null;
      if (this.hasFireAtTile(tx, ty)) return null;
      const px = opts.x ?? tx * TILE_SIZE + TILE_SIZE / 2;
      const py = opts.y ?? ty * TILE_SIZE + TILE_SIZE / 2;
      const fire = createFireAtPx(px, py, opts);
      fire.tx = tx;
      fire.ty = ty;
      if (DEBUG_FIRE) console.log('[FireAPI] spawnAtTile', tx, ty);
      return fire;
    },
    spawnAtPx(x, y, opts = {}) {
      const tile = worldToTile(x, y);
      if (this.hasFireAtTile(tile.tx, tile.ty) || !this.canSpawnMore()) return null;
      return this.spawnAtTile(tile.tx, tile.ty, Object.assign({}, opts, { x, y }));
    },
    spawn(x, y, opts = {}) {
      return this.spawnAtPx(x, y, opts);
    },
    spawnImpact(x, y, _impulse, opts = {}) {
      return this.spawnAtPx(x, y, opts);
    },
    updateAll(dt = 0) {
      for (const fire of [...fires]) {
        if (!fire || fire.dead) continue;
        fire.aiUpdate?.(fire, dt);
        fire.physicsUpdate?.(fire, dt);
        if (fire.puppetState && root.PuppetAPI?.update) {
          root.PuppetAPI.update(fire.puppetState, dt, fire);
        }
      }
      for (let i = fires.length - 1; i >= 0; i--) {
        if (fires[i]?.dead) fires.splice(i, 1);
      }
    },
    renderAll(ctx, cam) {
      if (!ctx) return;
      const active = fires.filter((f) => f && !f.dead);
      active.sort((a, b) => (a?.y || 0) - (b?.y || 0));
      for (const fire of active) {
        if (fire.puppetState && root.PuppetAPI?.draw) {
          root.PuppetAPI.draw(fire.puppetState, ctx, cam);
        }
      }
    },
    update(dt = 0) {
      this.updateAll(dt);
    },
    render(ctx, cam) {
      this.renderAll(ctx, cam);
    },
    getActive() {
      return fires.filter((f) => f && !f.dead);
    },
    extinguish(fire, opts = {}) {
      if (!fire || fire.dead) return false;
      if (DEBUG_FIRE) console.log('[FireAPI] extinguish', fire.tx, fire.ty, opts);
      fireOnDeath(fire);
      return true;
    },
    extinguishAt(x, y, opts = {}) {
      const tile = worldToTile(x, y);
      return this.extinguishAtTile(tile.tx, tile.ty, opts);
    },
    extinguishAtTile(tx, ty, opts = {}) {
      let removed = false;
      for (const fire of [...fires]) {
        if (!fire || fire.dead) continue;
        if (fire.tx === tx && fire.ty === ty) {
          if (DEBUG_FIRE) console.log('[FireAPI] extinguishAtTile', tx, ty);
          fireOnDeath(fire);
          removed = true;
        }
      }
      return removed;
    },
    extinguishAll(opts = {}) {
      let removed = false;
      for (const fire of [...fires]) {
        if (!fire || fire.dead) continue;
        if (DEBUG_FIRE) console.log('[FireAPI] extinguishAll', opts);
        fireOnDeath(fire);
        removed = true;
      }
      return removed;
    },
    hasFireAtTile(tx, ty) {
      return fires.some((f) => f && !f.dead && f.tx === tx && f.ty === ty);
    },
    canSpawnMore() {
      return this.getActive().length < MAX_FIRES;
    },
  };

  root.FireAPI = FireAPI;
  root.Entities = root.Entities || {};
  root.Entities.Fire = { createFireAtPx, createFireAtTile: FireAPI.spawnAtTile };
  root.__FIRE_HOOKED = true;

  const prevOnFrame = root.onFrame || function () {};
  root.onFrame = function onFrame(dt, ctx, cam) {
    prevOnFrame(dt, ctx, cam);
    FireAPI.updateAll(dt);
    FireAPI.renderAll(ctx, cam);
  };
})(typeof window !== 'undefined' ? window : this);
