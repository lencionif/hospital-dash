// assets/plugins/entities/jefe_servicio.entities.js
// Entidad hostil "jefe de servicio" con IA avanzada, trampas y proyectiles de yogur.
(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.JEFE_SERVICIO === 'undefined') e.JEFE_SERVICIO = 60;
    if (typeof e.YOGURT_BOMB === 'undefined') e.YOGURT_BOMB = 61;
    if (typeof e.JEFE_TRAP === 'undefined') e.JEFE_TRAP = 62;
    return e;
  })(root.ENT || (root.ENT = {}));

  const TILE = root.TILE_SIZE || root.TILE || 32;
  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 5;
  const HP_PER_HEART = root.HP_PER_HEART || 1;
  const DEBUG_NPC = !!root.DEBUG_NPC;

  const jefeList = [];

  function gridToWorldCenter(tx, ty) {
    const size = typeof root.GridMath?.tileSize === 'function' ? root.GridMath.tileSize() : TILE;
    return { x: tx * size + size * 0.5, y: ty * size + size * 0.5 };
  }

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.movers)) G.movers = [];
    if (!Array.isArray(G.npcs)) G.npcs = [];
  }

  function attachRig(e) {
    if (root.PuppetAPI?.attach) {
      try {
        const rig = root.PuppetAPI.attach(e, e.puppet || { rig: 'npc_jefe_servicio', z: HERO_Z, skin: 'default' });
        if (rig) e.rigOk = true;
      } catch (err) {
        e.rigOk = false;
        if (root.DEBUG_RIGS) console.error('[RigError] No rig for kind=JEFE_SERVICIO', err);
      }
    }
  }

  function overlap(a, b) {
    if (!a || !b) return false;
    return Math.abs((a.x || 0) - (b.x || 0)) * 2 < (a.w || 0) + (b.w || 0)
      && Math.abs((a.y || 0) - (b.y || 0)) * 2 < (a.h || 0) + (b.h || 0);
  }

  function spawnTrap(x, y, opts = {}) {
    const trap = {
      id: root.genId ? root.genId() : `trap-${Date.now().toString(36)}`,
      kind: ENT.JEFE_TRAP,
      role: 'hazard',
      populationType: 'hazards',
      x,
      y,
      w: 24,
      h: 24,
      vx: 0,
      vy: 0,
      solid: false,
      isFloorTile: true,
      isHazard: true,
      dead: false,
      touchDamage: opts.touchDamage ?? 0.25,
      slow: 0.45,
      ttl: opts.ttl ?? 12,
      puppet: { rig: 'puddle_wet', z: HERO_Z - 1, skin: 'default' },
      update(dt) {
        if (this.dead) return;
        this.ttl -= dt;
        if (this.ttl <= 0) { this.dead = true; this._remove = true; return; }
        const player = G.player;
        if (!player || player.dead) return;
        if (!overlap(this, player)) return;
        if (root.DamageAPI?.applyTouch) {
          root.DamageAPI.applyTouch(this, player);
        }
        if (typeof player.slowTimer === 'number') {
          player.slowTimer = Math.max(player.slowTimer, 1.2);
        } else {
          player.slowTimer = 1.2;
        }
      }
    };
    attachRig(trap);
    ensureCollections();
    G.entities.push(trap);
    return trap;
  }

  function spawnYogurtBomb(owner, target) {
    if (!owner) return null;
    const angle = target ? Math.atan2((target.y || 0) - owner.y, (target.x || 0) - owner.x) : owner.dir || 0;
    const speed = 140;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const proj = {
      id: root.genId ? root.genId() : `yog-${Date.now().toString(36)}`,
      kind: ENT.YOGURT_BOMB,
      role: 'projectile',
      populationType: 'hazards',
      x: owner.x,
      y: owner.y,
      w: 12,
      h: 12,
      vx,
      vy,
      dir: angle,
      solid: false,
      dead: false,
      ttl: 2.2,
      touchDamage: 0.75,
      puppet: { rig: 'projectile_yogurt', z: HERO_Z + 1, skin: 'default' },
      update(dt) {
        if (this.dead) return;
        this.ttl -= dt;
        if (this.ttl <= 0) { this.dead = true; this._remove = true; return; }
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        const player = G.player;
        if (player && !player.dead && overlap(this, player)) {
          if (root.DamageAPI?.applyTouch) root.DamageAPI.applyTouch(this, player);
          spawnTrap(this.x, this.y, { ttl: 6, touchDamage: 0.25 });
          this.dead = true;
          this._remove = true;
        }
      }
    };
    attachRig(proj);
    ensureCollections();
    G.entities.push(proj);
    G.movers.push(proj);
    return proj;
  }

  function findEntitiesBy(fn) {
    const list = G.entities || [];
    const out = [];
    for (const e of list) {
      if (!e || e.dead) continue;
      if (fn(e)) out.push(e);
    }
    return out;
  }

  function findCartTarget(e, player) {
    if (!player) return null;
    const carts = findEntitiesBy(ent => (ent._tag === 'cart' || String(ent.kind || '').toLowerCase().includes('cart')) && !ent.dead);
    let best = null;
    let bestScore = Infinity;
    for (const cart of carts) {
      const dx = player.x - cart.x;
      const dy = player.y - cart.y;
      const aligned = Math.abs(dx) < TILE * 0.6 || Math.abs(dy) < TILE * 0.6;
      if (!aligned) continue;
      const distCart = Math.hypot(cart.x - e.x, cart.y - e.y);
      if (distCart < bestScore) { bestScore = distCart; best = cart; }
    }
    return best;
  }

  function findLootTarget(e) {
    return findEntitiesBy(ent => {
      const kind = String(ent.kind || '').toLowerCase();
      if (kind.includes('coin') || kind.includes('money') || kind.includes('loot') || kind.includes('food')) return true;
      return ent.role === 'loot';
    }).sort((a, b) => (Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y)))[0] || null;
  }

  function stepToward(e, target, speedMul = 1) {
    if (!target) { e.vx = 0; e.vy = 0; return; }
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = (e.maxSpeed || 90) * speedMul;
    e.vx = (dx / dist) * speed;
    e.vy = (dy / dist) * speed;
    e.dir = Math.atan2(dy, dx);
  }

  function idleState(e) {
    e.vx = 0; e.vy = 0; e.state = 'idle'; e.isMoving = false;
    e.isAttacking = false; e.isPushing = false; e.isEating = false;
  }

  function handleTouchDamage(e, player, dt) {
    if (!player || e._touchCD > 0 || e.dead) return;
    if (!overlap(e, player)) return;
    e._touchCD = e.touchCooldown || 0.9;
    if (root.DamageAPI?.applyTouch) root.DamageAPI.applyTouch(e, player);
  }

  function useNearestElevator(e, player) {
    const elevators = Array.isArray(G.elevators) ? G.elevators : findEntitiesBy(ent => String(ent.kind || '').toLowerCase().includes('elevator'));
    if (!elevators.length || !player) return false;
    const far = Math.hypot(player.x - e.x, player.y - e.y) > TILE * 10;
    if (!far) return false;
    let best = null;
    let bestDist = Infinity;
    for (const el of elevators) {
      const d = Math.hypot(el.x - e.x, el.y - e.y);
      if (d < bestDist) { bestDist = d; best = el; }
    }
    if (!best) return false;
    stepToward(e, best, 0.85);
    e.state = 'walk_v';
    if (bestDist < TILE * 0.6 && typeof best.onUse === 'function') {
      best.onUse(best, e);
      e.useCooldown = 3;
    }
    return true;
  }

  function jefeServicioAiUpdate(e, dt = 0) {
    if (!e || e.dead) { return; }
    if (e._culled) return;

    e.trapCD = Math.max(0, (e.trapCD || 0) - dt);
    e.yogurtCD = Math.max(0, (e.yogurtCD || 0) - dt);
    e.lootCD = Math.max(0, (e.lootCD || 0) - dt);
    e.cartCD = Math.max(0, (e.cartCD || 0) - dt);
    e._touchCD = Math.max(0, (e._touchCD || 0) - dt);
    e.stateTimer = (e.stateTimer || 0) + dt;

    const player = G.player;
    const dist = player ? Math.hypot(player.x - e.x, player.y - e.y) : Infinity;

    if (useNearestElevator(e, player)) { e.aiState = 'use_elevator'; handleTouchDamage(e, player, dt); return; }

    if (player && !player.dead) {
      const cart = e.cartCD <= 0 ? findCartTarget(e, player) : null;
      if (cart) {
        e.aiState = 'use_cart';
        e.isPushing = true;
        e.isAttacking = false;
        const pushPoint = { x: cart.x - Math.cos(Math.atan2(player.y - cart.y, player.x - cart.x)) * 12, y: cart.y - Math.sin(Math.atan2(player.y - cart.y, player.x - cart.x)) * 12 };
        stepToward(e, pushPoint, 0.9);
        e.state = 'push';
        if (Math.hypot(pushPoint.x - e.x, pushPoint.y - e.y) < 10) {
          cart.vx = (player.x - cart.x) * 0.6;
          cart.vy = (player.y - cart.y) * 0.6;
          cart._tag = cart._tag || 'cart';
          e.cartCD = 6;
        }
        handleTouchDamage(e, player, dt);
        return;
      }

      if (dist > TILE * 4 && dist < TILE * 7 && e.yogurtCD <= 0) {
        e.aiState = 'throw_yogurt';
        e.vx = 0; e.vy = 0; e.isAttacking = true; e.state = 'attack';
        spawnYogurtBomb(e, player);
        e.yogurtCD = 3.5;
        handleTouchDamage(e, player, dt);
        return;
      }

      if (dist <= TILE * 3) {
        e.aiState = 'chase';
        e.isPushing = false; e.isAttacking = false;
        stepToward(e, player, 0.9);
        e.state = Math.abs(e.vx) > Math.abs(e.vy) ? 'walk_h' : 'walk_v';
        handleTouchDamage(e, player, dt);
        return;
      }
    }

    if (e.trapCD <= 0 && (!player || dist > TILE * 2.5)) {
      e.aiState = 'set_trap';
      e.vx = 0; e.vy = 0; e.state = 'push';
      spawnTrap(e.x, e.y, { ttl: 10 });
      e.trapCD = 8;
      return;
    }

    if (e.lootCD <= 0) {
      const loot = findLootTarget(e);
      if (loot) {
        e.aiState = 'loot';
        stepToward(e, loot, 0.7);
        e.state = Math.abs(e.vx) > Math.abs(e.vy) ? 'walk_h' : 'walk_v';
        if (Math.hypot(loot.x - e.x, loot.y - e.y) < TILE * 0.6) {
          e.isEating = true;
          e.state = 'eat';
          e.health = Math.min(e.maxHealth || e.health, (e.health || 0) + HP_PER_HEART * 0.5);
          loot._remove = true; loot.dead = true;
          e.lootCD = 6;
        }
        handleTouchDamage(e, player, dt);
        return;
      }
    }

    e.aiState = 'patrol';
    const patrolRadius = TILE * 2;
    if (!e.patrolTarget || Math.hypot(e.patrolTarget.x - e.x, e.patrolTarget.y - e.y) < 6) {
      e.patrolTarget = { x: e.spawnX + (Math.random() - 0.5) * patrolRadius, y: e.spawnY + (Math.random() - 0.5) * patrolRadius };
    }
    stepToward(e, e.patrolTarget, 0.4);
    e.state = Math.abs(e.vx) > Math.abs(e.vy) ? 'walk_h' : 'walk_v';
    e.isPushing = false; e.isAttacking = false; e.isEating = false;
    handleTouchDamage(e, player, dt);
  }

  function spawnJefeServicio(x, y, opts = {}) {
    ensureCollections();
    const e = {
      id: root.genId ? root.genId() : `jefe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.JEFE_SERVICIO,
      kindName: 'jefe_servicio',
      populationType: 'humans',
      role: 'npc',
      x,
      y,
      spawnX: x,
      spawnY: y,
      w: 24,
      h: 24,
      vx: 0,
      vy: 0,
      dir: 0,
      solid: true,
      health: opts.health ?? 7 * HP_PER_HEART,
      maxHealth: opts.maxHealth ?? 7 * HP_PER_HEART,
      touchDamage: opts.touchDamage ?? 1,
      touchCooldown: opts.touchCooldown ?? 0.9,
      _touchCD: 0,
      fireImmune: false,
      dead: false,
      deathCause: null,
      state: 'idle',
      aiState: 'idle',
      maxSpeed: 95,
      trapCD: 2.5,
      yogurtCD: 1.2,
      lootCD: 1.5,
      cartCD: 0,
      puppet: { rig: 'npc_jefe_servicio', z: HERO_Z, skin: 'default' },
      aiUpdate: jefeServicioAiUpdate,
      update(dt) { jefeServicioAiUpdate(this, dt); },
      onDeath() {
        this.dead = true;
        try { root.SpawnerAPI?.notifyDeath?.(this, { populationType: this.populationType || 'humans', kind: ENT.JEFE_SERVICIO }); } catch (_) {}
      }
    };

    attachRig(e);
    G.entities.push(e);
    G.npcs.push(e);
    G.movers.push(e);
    jefeList.push(e);
    if (DEBUG_NPC) console.log('[JefeServicio] creado en', x, y, 'state', e.state);
    return e;
  }

  function spawnJefeServicioAt(tx, ty, opts = {}) {
    const pos = gridToWorldCenter(tx, ty);
    return spawnJefeServicio(pos.x, pos.y, opts);
  }

  const JefeServicioAPI = {
    spawn: (x, y, opts = {}) => spawnJefeServicio(x, y, opts),
    spawnAt: (tx, ty, opts = {}) => spawnJefeServicioAt(tx, ty, opts),
    spawnFromAscii: (tx, ty, def) => spawnJefeServicioAt(tx, ty, def || {}),
    aiUpdate: jefeServicioAiUpdate,
    update(dt = 0) {
      for (const j of jefeList) jefeServicioAiUpdate(j, dt);
    }
  };

  root.JefeServicioAPI = JefeServicioAPI;
  root.Entities = root.Entities || {};
  root.Entities.JefeServicio = JefeServicioAPI;
  root.Entities.spawnJefeServicioFromAscii = (tx, ty, def) => spawnJefeServicioAt(tx, ty, def || {});
})(window);

// Implementación del jefe de servicio: IA, trampas, yogures y wiring ASCII.
