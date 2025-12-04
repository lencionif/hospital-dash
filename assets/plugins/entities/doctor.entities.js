// Entities.Medic: factory + IA de la Médica (npc_medica).
(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.MEDIC === 'undefined') e.MEDIC = 915;
    if (typeof e.PILL_POISON === 'undefined') e.PILL_POISON = 916;
    return e;
  })(root.ENT || (root.ENT = {}));

  const TILE = root.TILE_SIZE || root.TILE || 32;
  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 10;
  const HP_PER_HEART = root.HP_PER_HEART || 1;

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.movers)) G.movers = [];
    if (!Array.isArray(G.npcs)) G.npcs = [];
    if (!Array.isArray(G.hazards)) G.hazards = [];
  }

  function gridToWorldCenter(tx, ty) {
    return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function moveWithCollisions(e) {
    if (typeof root.moveWithCollisions === 'function') return root.moveWithCollisions(e);
    const sub = 2;
    for (let i = 0; i < sub; i++) {
      const stepX = (e.vx || 0) / sub;
      const stepY = (e.vy || 0) / sub;
      let nx = e.x + stepX;
      let ny = e.y + stepY;
      if (root.isWallAt && root.isWallAt(nx, e.y, e.w, e.h)) { nx = e.x; e.vx = 0; }
      if (root.isWallAt && root.isWallAt(nx, ny, e.w, e.h)) { ny = e.y; e.vy = 0; }
      e.x = nx; e.y = ny;
    }
  }

  function overlap(a, b) {
    return a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function attachRig(e) {
    if (root.PuppetAPI?.attach) {
      try {
        const rig = root.PuppetAPI.attach(e, e.puppet);
        if (rig) e.rigOk = true;
      } catch (err) {
        console.warn('[RigError] No rig for npc_medica', err);
        e.rigOk = false;
      }
    }
  }

  function applyPoisonDebuff(player) {
    if (!player) return;
    player.status = player.status || {};
    player.status.poisoned = { t: 6, slow: 0.75 };
    if (root.DamageAPI?.applyDamage) {
      root.DamageAPI.applyDamage(player, HP_PER_HEART * 0.5, { cause: 'poison' });
    } else if (typeof player.health === 'number') {
      player.health = Math.max(0, player.health - HP_PER_HEART * 0.5);
    }
  }

  const PoisonPills = {
    _list: [],
    spawn(x, y) {
      ensureCollections();
      const pill = {
        id: root.genId ? root.genId() : `pill-${Math.random().toString(36).slice(2)}`,
        kind: ENT.PILL_POISON,
        x, y,
        w: TILE * 0.4,
        h: TILE * 0.4,
        vx: 0,
        vy: 0,
        rigOk: true,
        isHazard: true,
        pickup: true,
        puppet: { rig: 'pill_poison', z: HERO_Z },
      };
      this._list.push(pill);
      G.entities.push(pill);
      return pill;
    },
    update(dt) {
      const player = G.player;
      for (let i = this._list.length - 1; i >= 0; i--) {
        const pill = this._list[i];
        if (!pill || pill.dead) continue;
        if (player && overlap(pill, player)) {
          applyPoisonDebuff(player);
          pill.dead = true;
          if (G.entities) {
            const idx = G.entities.indexOf(pill);
            if (idx >= 0) G.entities.splice(idx, 1);
          }
          this._list.splice(i, 1);
        }
      }
    }
  };

  function medicPatrolAroundPatients(e, dt) {
    e._patrolTimer = (e._patrolTimer || 0) - dt;
    if (e._patrolTimer > 0) return;
    e._patrolTimer = 1.2 + Math.random() * 1.2;
    const speed = 40;
    const angle = Math.random() * Math.PI * 2;
    e.vx = Math.cos(angle) * speed;
    e.vy = Math.sin(angle) * speed;
  }

  function medicDropPoisonPill(e, dx, dy, distSq) {
    const len = Math.sqrt(distSq) || 1;
    const dropX = e.x + (dx / len) * TILE;
    const dropY = e.y + (dy / len) * TILE;
    PoisonPills.spawn(dropX, dropY);
    e.poisonCD = 10;
    e.castingPoison = false;
  }

  function medicAiUpdate(dt, e) {
    if (e.dead) return;
    if (e.poisonCD > 0) e.poisonCD -= dt;
    const player = G.player;
    if (!player) return;
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const distSq = dx * dx + dy * dy;
    const detectRadius = 8 * TILE;

    if (distSq < detectRadius * detectRadius) {
      if (e.poisonCD <= 0 && !e.castingPoison && distSq > (3 * TILE) * (3 * TILE)) {
        e.state = 'cast_poison';
        e.castingPoison = true;
        e.vx = e.vy = 0;
        if (!e._castTimer || e._castTimer <= 0) e._castTimer = 0.4;
      } else {
        const speed = 60;
        const len = Math.sqrt(distSq) || 1;
        e.vx = (dx / len) * speed;
        e.vy = (dy / len) * speed;
        e.dir = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? 0 : Math.PI)
          : (dy > 0 ? Math.PI / 2 : -Math.PI / 2);
        e.state = Math.abs(dx) > Math.abs(dy) ? 'walk_h' : 'walk_v';
      }
    } else {
      medicPatrolAroundPatients(e, dt);
      e.state = 'patrol';
    }

    if (e.castingPoison) {
      e._castTimer -= dt;
      if (e._castTimer <= 0) {
        medicDropPoisonPill(e, dx, dy, distSq || 1);
      }
    }

    moveWithCollisions(e);

    if (!e.dead && player && root.DamageAPI?.applyTouch && overlap(e, player)) {
      root.DamageAPI.applyTouch(e, player);
      player.stunnedTime = Math.max(player.stunnedTime || 0, 0.4);
    }
  }

  function spawnMedic(x, y, opts = {}) {
    ensureCollections();
    const e = {
      id: root.genId ? root.genId() : `medic-${Math.random().toString(36).slice(2)}`,
      kind: ENT.MEDIC,
      kindName: 'medic',
      populationType: 'humans',
      x, y,
      w: 24,
      h: 24,
      vx: 0,
      vy: 0,
      dir: 0,
      solid: true,
      health: opts.health ?? 4 * HP_PER_HEART,
      maxHealth: opts.maxHealth ?? 4 * HP_PER_HEART,
      touchDamage: opts.touchDamage ?? 0.5,
      touchCooldown: opts.touchCooldown ?? 0.9,
      _touchCD: 0,
      fireImmune: false,
      state: 'idle',
      deathCause: null,
      dead: false,
      confused: false,
      castingPoison: false,
      poisonCD: 0,
      puppet: { rig: 'npc_medica', z: HERO_Z, skin: 'default' },
      aiUpdate: (dtSelf) => medicAiUpdate(dtSelf, e),
    };
    attachRig(e);
    G.entities.push(e);
    G.npcs.push(e);
    return e;
  }

  function spawnMedicAtTile(tx, ty, opts = {}) {
    const pos = gridToWorldCenter(tx, ty);
    return spawnMedic(pos.x, pos.y, opts);
  }

  const MedicoAPI = {
    _list: [],
    spawn(x, y, opts) {
      const m = spawnMedic(x, y, opts);
      this._list.push(m);
      return m;
    },
    spawnAtTile(tx, ty, opts) {
      const m = spawnMedicAtTile(tx, ty, opts);
      this._list.push(m);
      return m;
    },
    update(dt = 0) {
      for (const m of this._list) { if (m && !m.dead) medicAiUpdate(dt, m); }
      PoisonPills.update(dt);
    },
  };

  root.Entities = root.Entities || {};
  root.Entities.Medic = {
    spawnMedicAtTile,
    spawnMedicFromAscii: spawnMedicAtTile,
  };
  root.MedicoAPI = MedicoAPI;
  root.Entities.Pills = root.Entities.Pills || {};
  if (!root.Entities.Pills.spawnPoisonPillAtPx) {
    root.Entities.Pills.spawnPoisonPillAtPx = (x, y) => PoisonPills.spawn(x, y);
  }
})(window);
