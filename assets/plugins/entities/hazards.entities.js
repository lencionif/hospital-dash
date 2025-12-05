// assets/plugins/entities/hazards.entities.js
// TODO: Archivo no referenciado en index.html. Candidato a eliminación si se confirma que no se usa.
// Papelitos y aviones de papel usados por la supervisora.
(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.PAPER_PLANE === 'undefined') e.PAPER_PLANE = 21;
    if (typeof e.PAPER_NOTE === 'undefined') e.PAPER_NOTE = 22;
    return e;
  })(root.ENT || (root.ENT = {}));

  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 5;

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
  }

  function paperNoteAiUpdate(e, dt = 0) {
    if (!e || e.dead) return;
    if (e._culled) return;
    const hero = G.player;
    if (!hero) return;
    const AABB = root.AABB || ((a, b) => a && b && Math.abs(a.x - b.x) * 2 < (a.w + b.w) && Math.abs(a.y - b.y) * 2 < (a.h + b.h));
    if (AABB(e, hero)) {
      hero.status = hero.status || {};
      const timerKey = 'supervisorDebuffTimer';
      hero.status[timerKey] = { t: 4, type: e.debuffType || 'controls' };
      if (e.touchDamage && root.DamageAPI?.applyTouch) root.DamageAPI.applyTouch(e, hero);
      e._dead = true;
    }
  }

  function spawnPaperNote(x, y, opts = {}) {
    ensureCollections();
    const e = {
      id: root.genId ? root.genId() : `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.PAPER_NOTE,
      kindName: 'paper_note',
      populationType: 'hazards',
      x,
      y,
      w: 16,
      h: 16,
      vx: 0,
      vy: 0,
      dir: 0,
      solid: false,
      isTriggerOnly: true,
      debuffType: opts.debuffType || 'hud',
      health: opts.health ?? 1,
      maxHealth: opts.maxHealth ?? 1,
      touchDamage: opts.touchDamage ?? 0,
      touchCooldown: 0,
      _touchCD: 0,
      fireImmune: false,
      dead: false,
      puppet: { rig: 'hazard_paper_note', z: HERO_Z, skin: 'default' },
      aiState: 'idle',
      aiTimer: 0,
      aiUpdate: paperNoteAiUpdate,
      update(dt) { paperNoteAiUpdate(this, dt); },
    };

    try {
      const rig = root.PuppetAPI?.attach?.(e, e.puppet);
      if (rig) e.rigOk = true;
    } catch (_) { e.rigOk = false; }

    G.entities.push(e);
    return e;
  }

  function paperPlaneAiUpdate(e, dt = 0) {
    if (!e || e.dead) return;
    if (e._culled) return;
    const hero = G.player;
    if (e.homingTime > 0 && hero) {
      e.homingTime -= dt;
      const dx = hero.x - e.x;
      const dy = hero.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      e.vx = (dx / dist) * e.speed;
      e.vy = (dy / dist) * e.speed;
      e.dir = Math.atan2(dy, dx);
    }
    e.x += (e.vx || 0) * dt;
    e.y += (e.vy || 0) * dt;
    e.life -= dt;
    const AABB = root.AABB || ((a, b) => a && b && Math.abs(a.x - b.x) * 2 < (a.w + b.w) && Math.abs(a.y - b.y) * 2 < (a.h + b.h));
    if (hero && AABB(e, hero)) {
      if (root.DamageAPI?.applyTouch) root.DamageAPI.applyTouch(e, hero);
      e._dead = true;
    }
    if (e.life <= 0) e._dead = true;
  }

  function spawnPaperPlane(shooter, target) {
    ensureCollections();
    const e = {
      id: root.genId ? root.genId() : `plane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.PAPER_PLANE,
      kindName: 'paper_plane',
      populationType: 'hazards',
      x: shooter?.x || 0,
      y: (shooter?.y || 0) - 8,
      w: 12,
      h: 12,
      dir: 0,
      vx: 0,
      vy: 0,
      solid: false,
      isTriggerOnly: true,
      health: 1,
      maxHealth: 1,
      touchDamage: 0.5,
      touchCooldown: 0.9,
      _touchCD: 0,
      homingTime: 1.2,
      life: 3.0,
      speed: 90,
      puppet: { rig: 'hazard_paper_plane', z: HERO_Z, skin: 'default' },
      aiState: 'idle',
      aiTimer: 0,
      aiUpdate: paperPlaneAiUpdate,
      update(dt) { paperPlaneAiUpdate(this, dt); },
    };

    try {
      const rig = root.PuppetAPI?.attach?.(e, e.puppet);
      if (rig) e.rigOk = true;
    } catch (_) { e.rigOk = false; }

    G.entities.push(e);
    return e;
  }

  root.Entities = root.Entities || {};
  root.Entities.PaperNote = { spawn: spawnPaperNote, aiUpdate: paperNoteAiUpdate };
  root.Entities.PaperPlane = { spawn: spawnPaperPlane, aiUpdate: paperPlaneAiUpdate };

  // ---------------------------------------------------------------------------
  // Water puddle hazard
  // ---------------------------------------------------------------------------
  const createPhysicalEntity = root.createPhysicalEntity || root.createGameEntity;
  const TILE = root.TILE_SIZE || root.TILE || 32;
  const DEBUG_WATER = !!root.DEBUG_WATER;

  if (typeof ENT.WATER_PUDDLE === 'undefined') ENT.WATER_PUDDLE = 'water_puddle';

  function waterPuddleAiUpdate(e, dt = 0) {
    if (!e || e.dead) return;
    if (e._culled) return;
    e._slipCooldown = Math.max(0, (e._slipCooldown || 0) - dt);

    const targets = [];
    if (G.player) targets.push(G.player);
    if (Array.isArray(G.entities)) {
      for (const other of G.entities) {
        if (!other || other === G.player) continue;
        if (other.populationType === 'carts') targets.push(other);
      }
    }

    const tileX = Math.floor(e.x / TILE);
    const tileY = Math.floor(e.y / TILE);
    if (root.FireAPI?.extinguishAtTile) {
      try {
        root.FireAPI.extinguishAtTile(tileX, tileY, { cause: 'water_puddle' });
        if (DEBUG_WATER && !e._extinguishLogged) {
          console.log('[WATER] Extinguish @', tileX, tileY);
          e._extinguishLogged = true;
        }
      } catch (_) {}
    }

    const overlapFn = root.overlap || ((a, b) => a && b && Math.abs(a.x - b.x) * 2 < (a.w + b.w) && Math.abs(a.y - b.y) * 2 < (a.h + b.h));
    for (const target of targets) {
      if (!target || target.dead) continue;
      if (!overlapFn(e, target)) {
        target._prevWetSpeed = 0;
        continue;
      }

      const baseFrictionMult = Number.isFinite(target._baseFrictionMultiplier)
        ? target._baseFrictionMultiplier
        : (Number.isFinite(target.frictionMultiplier) ? target.frictionMultiplier : 1);
      if (!Number.isFinite(target._baseFrictionMultiplier)) target._baseFrictionMultiplier = baseFrictionMult;

      target.onWetFloor = true;
      target._wetFloorTimer = Math.max(target._wetFloorTimer || 0, 0.25);
      target.frictionMultiplier = e.frictionScale ?? 0;

      if (target.populationType === 'carts') {
        target.frictionMultiplier = 0;
        const baseMax = Number.isFinite(target._basePuddleMaxSpeed) ? target._basePuddleMaxSpeed : (target.physics?.maxSpeed || target.maxSpeed || 0);
        if (!Number.isFinite(target._basePuddleMaxSpeed)) target._basePuddleMaxSpeed = baseMax || 140;
        const boosted = (Number.isFinite(baseMax) ? baseMax : 140) * 1.05;
        if (target.physics) target.physics.maxSpeed = boosted;
        else target.maxSpeed = boosted;
      }

      const speed = Math.hypot(target.vx || 0, target.vy || 0);
      const prevSpeed = target._prevWetSpeed || 0;
      const slowed = prevSpeed > 60 && speed < prevSpeed * 0.35;

      if (slowed && Math.random() < (e.slipChance || 0) && e._slipCooldown <= 0) {
        const hitPlayer = target === G.player;
        if (hitPlayer && root.DamageAPI?.applyTouch && overlapFn(e, G.player)) {
          root.DamageAPI.applyTouch(e, G.player);
        }
        if (hitPlayer && !G.player.dead) {
          G.player.stunnedTimer = Math.max(G.player.stunnedTimer || 0, 0.8);
          if (DEBUG_WATER) console.log('[WATER] Player slipped on puddle @', e.x, e.y);
        }
        if (typeof root.playEntityAudio === 'function') root.playEntityAudio(e, 'hit');
        e._slipCooldown = 1.2;
      }

      target._prevWetSpeed = speed;
    }
  }

  function createWaterPuddle(x, y, opts = {}) {
    if (!createPhysicalEntity) return null;
    const e = createPhysicalEntity({
      kind: ENT.WATER_PUDDLE,
      x, y,
      populationType: 'hazards',
      group: 'hazards',
      role: 'hazard_water',

      solid: false,
      isFloorTile: true,
      w: opts.w || TILE * 0.9,
      h: opts.h || TILE * 0.9,

      health: opts.health ?? 1,
      maxHealth: opts.maxHealth ?? 1,

      fireImmune: true,
      touchDamage: opts.touchDamage ?? 0.5,
      touchCooldown: opts.touchCooldown ?? 1.0,

      ai: { mode: 'idle', speed: 0, sightRadius: 0 },

      dialog: { enabled: false },

      rig: 'puddle_wet',
      spriteId: null,
      skin: 'puddle_default',
      audioProfile: {
        hit: 'puddle_slip',
        death: 'puddle_dry',
        step: 'puddle_step',
      },
    });

    e.isWaterPuddle = true;
    e.frictionScale = 0.0;
    e.slipChance = opts.slipChance ?? 0.75;
    e._slipCooldown = 0;

    e.aiUpdate = waterPuddleAiUpdate;

    try { root.PuppetAPI?.attach?.(e, { rig: 'puddle_wet', z: HERO_Z, skin: 'puddle_default' }); } catch (_) {}
    if (DEBUG_WATER) console.log('[WATER] Puddle created at', x, y);

    return e;
  }

  root.createWaterPuddle = createWaterPuddle;
  root.Entities.WaterPuddle = {
    create: createWaterPuddle,
    spawn: createWaterPuddle,
    spawnAtTile(tx, ty, opts = {}) { return createWaterPuddle(tx * TILE + TILE * 0.5, ty * TILE + TILE * 0.5, opts); },
    spawnFromAscii(tx, ty, opts = {}) { return this.spawnAtTile(tx, ty, opts); },
    aiUpdate: waterPuddleAiUpdate,
  };
})(window);
