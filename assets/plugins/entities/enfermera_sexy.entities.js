// assets/plugins/entities/enfermera_sexy.entities.js
// IA enfermera sexy: patrulla + flirteo + disparo de jeringas
(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = (() => {
    const e = root.ENT || (root.ENT = {});
    if (typeof e.NURSE_SEXY === 'undefined') e.NURSE_SEXY = 50;
    if (typeof e.NURSE_SYRINGE === 'undefined') e.NURSE_SYRINGE = 51;
    return e;
  })();

  const TILE = root.TILE_SIZE || root.TILE || 32;
  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 5;
  const HP_PER_HEART = root.HP_PER_HEART || 1;
  const DETECT_RADIUS = TILE * 7.5;
  const FLIRT_RADIUS = TILE * 2.6;
  const KITE_RADIUS = TILE * 5;
  const CHARM_DURATION = 3.5;
  const SHOOT_COOLDOWN = 2.4;
  const NURSE_SPEED = 78;
  const NURSE_RETREAT = 96;

  function gridToWorldCenter(tx, ty) {
    const size = typeof root.GridMath?.tileSize === 'function' ? root.GridMath.tileSize() : TILE;
    return { x: tx * size + size * 0.5, y: ty * size + size * 0.5 };
  }

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.npcs)) G.npcs = [];
    if (!Array.isArray(G.movers)) G.movers = [];
  }

  function removeFromWorld(entity) {
    if (!entity) return;
    const pools = [G.entities, G.npcs, G.movers];
    for (const arr of pools) {
      if (!Array.isArray(arr)) continue;
      const idx = arr.indexOf(entity);
      if (idx >= 0) arr.splice(idx, 1);
    }
  }

  function attachRig(e) {
    if (root.PuppetAPI?.attach) {
      try {
        const rig = root.PuppetAPI.attach(e, e.puppet || { rig: 'npc_nurse_sexy', z: HERO_Z, data: { skin: 'default' } });
        if (rig) e.rigOk = true;
      } catch (err) {
        console.warn('[nurse] rig attach error', err);
        e.rigOk = false;
      }
    }
  }

  function makePatrolPoints(x, y) {
    const spread = TILE * 1.5;
    return [
      { x: x + spread, y: y },
      { x: x - spread, y: y },
      { x: x, y: y + spread },
      { x: x, y: y - spread },
    ];
  }

  function spawnNurseSexy(x, y, opts = {}) {
    ensureCollections();
    const e = {
      id: root.genId ? root.genId() : `nurse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.NURSE_SEXY,
      kindName: 'nurse_sexy',
      populationType: 'humans',
      role: 'npc',
      x,
      y,
      w: 24,
      h: 24,
      vx: 0,
      vy: 0,
      dir: 0,
      solid: true,
      health: opts.health ?? 3 * HP_PER_HEART,
      maxHealth: opts.maxHealth ?? 3 * HP_PER_HEART,
      touchDamage: opts.touchDamage ?? 0.5,
      touchCooldown: opts.touchCooldown ?? 0.9,
      _touchCD: 0,
      fireImmune: false,
      dead: false,
      deathCause: null,
      state: 'idle',
      aiState: 'patrol',
      aiTimer: 0,
      patrolPoints: opts.patrolPoints || makePatrolPoints(x, y),
      patrolIndex: 0,
      shootCD: SHOOT_COOLDOWN * 0.5,
      attackTimer: 0,
      talkTimer: 0,
      puppet: { rig: 'npc_nurse_sexy', z: HERO_Z, skin: 'default' },
      update(dt) { nurseSexyAiUpdate(dt, this); },
    };

    attachRig(e);
    G.entities.push(e);
    G.npcs.push(e);
    G.movers.push(e);
    NurseSexy._list.push(e);
    return e;
  }

  function spawnNurseSexyAt(tx, ty, opts = {}) {
    const pos = gridToWorldCenter(tx, ty);
    return spawnNurseSexy(pos.x, pos.y, opts);
  }

  function spawnNurseSyringe(owner, target) {
    const angle = Math.atan2((target?.y || owner.y) - owner.y, (target?.x || owner.x) - owner.x);
    const speed = 140;
    const proj = {
      id: root.genId ? root.genId() : `syr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      kind: ENT.NURSE_SYRINGE,
      kindName: 'nurse_syringe',
      populationType: 'hazard',
      x: owner.x,
      y: owner.y,
      w: 8,
      h: 8,
      dir: angle,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      solid: false,
      health: 1,
      maxHealth: 1,
      touchDamage: 0.5,
      touchCooldown: 0,
      _touchCD: 0,
      fireImmune: true,
      dead: false,
      ttl: 1.8,
      puppet: { rig: 'proj_nurse_syringe', z: HERO_Z, skin: 'default' },
    };
    try { root.PuppetAPI?.attach?.(proj, proj.puppet); } catch (_) {}
    NurseSexy._projectiles.push(proj);
    G.entities.push(proj);
    return proj;
  }

  function applyTouchToHero(attacker) {
    const hero = G.player;
    if (!hero) return;
    if (attacker._touchCD > 0) return;
    if (root.DamageAPI?.applyTouch) {
      root.DamageAPI.applyTouch(attacker, hero);
    } else if (root.Damage?.applyToHero) {
      root.Damage.applyToHero(attacker.touchDamage || 0.5, 'nurse_touch', { attacker });
    }
    attacker._touchCD = attacker.touchCooldown || 0.9;
  }

  function markCharm(hero, source) {
    hero.status = hero.status || {};
    hero.status.charmedByNurse = {
      t: CHARM_DURATION,
      sourceId: source?.id || null,
    };
  }

  function overlap(a, b) {
    return !(a.x + a.w * 0.5 <= b.x - b.w * 0.5
      || a.x - a.w * 0.5 >= b.x + b.w * 0.5
      || a.y + a.h * 0.5 <= b.y - b.h * 0.5
      || a.y - a.h * 0.5 >= b.y + b.h * 0.5);
  }

  function advancePatrol(e, dt) {
    if (!Array.isArray(e.patrolPoints) || !e.patrolPoints.length) return;
    const target = e.patrolPoints[e.patrolIndex % e.patrolPoints.length];
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 6) {
      e.patrolIndex = (e.patrolIndex + 1) % e.patrolPoints.length;
      e.aiTimer = 0.5;
      e.vx *= 0.4;
      e.vy *= 0.4;
      return;
    }
    const speed = NURSE_SPEED * 0.6;
    e.vx = (dx / (dist || 1)) * speed;
    e.vy = (dy / (dist || 1)) * speed;
    e.dir = Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 1 : 3) : (dy >= 0 ? 2 : 0);
  }

  function nurseSexyAiUpdate(dt = 0, e) {
    if (!e) return;
    if (e.dead) { e.state = 'dead'; return; }
    if (e._culled) return;

    e._touchCD = Math.max(0, (e._touchCD || 0) - dt);
    e.shootCD = Math.max(0, (e.shootCD || 0) - dt);
    e.attackTimer = Math.max(0, (e.attackTimer || 0) - dt);
    e.talkTimer = Math.max(0, (e.talkTimer || 0) - dt);
    e.aiTimer = Math.max(0, (e.aiTimer || 0) - dt);

    const hero = G.player;
    const dx = hero ? hero.x - e.x : 0;
    const dy = hero ? hero.y - e.y : 0;
    const dist = hero ? Math.hypot(dx, dy) : Infinity;

    if (!hero || hero.dead) {
      e.aiState = 'patrol';
    } else if (dist < FLIRT_RADIUS) {
      e.aiState = 'flirt';
    } else if (dist < DETECT_RADIUS) {
      e.aiState = 'kite_shoot';
    } else if (!e.aiState) {
      e.aiState = 'patrol';
    }

    if (e.aiState === 'patrol') {
      advancePatrol(e, dt);
      if (dist < DETECT_RADIUS) e.aiState = dist < FLIRT_RADIUS ? 'flirt' : 'kite_shoot';
    } else if (e.aiState === 'flirt') {
      const speed = NURSE_SPEED * 0.65;
      if (dist > FLIRT_RADIUS * 1.2) {
        e.aiState = 'kite_shoot';
      } else {
        e.vx = (dx / (dist || 1)) * speed;
        e.vy = (dy / (dist || 1)) * speed;
        e.dir = Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 1 : 3) : (dy >= 0 ? 2 : 0);
        e.talkTimer = 0.4;
        if (overlap(e, hero)) {
          applyTouchToHero(e);
          markCharm(hero, e);
          e.aiState = 'kite_shoot';
          e.aiTimer = 0.5;
          e.vx = -(dx / (dist || 1)) * NURSE_RETREAT;
          e.vy = -(dy / (dist || 1)) * NURSE_RETREAT;
        }
      }
    } else if (e.aiState === 'kite_shoot') {
      const desired = KITE_RADIUS;
      const dirX = dx / (dist || 1);
      const dirY = dy / (dist || 1);
      if (dist < desired * 0.75) {
        e.vx = -dirX * NURSE_RETREAT;
        e.vy = -dirY * NURSE_RETREAT;
      } else if (dist > desired * 1.25 && dist < DETECT_RADIUS * 1.2) {
        e.vx = dirX * NURSE_SPEED;
        e.vy = dirY * NURSE_SPEED;
      } else {
        e.vx *= 0.9;
        e.vy *= 0.9;
      }
      e.dir = Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 1 : 3) : (dy >= 0 ? 2 : 0);
      if (e.shootCD <= 0 && hero && dist < DETECT_RADIUS * 1.1) {
        spawnNurseSyringe(e, hero);
        e.shootCD = SHOOT_COOLDOWN + Math.random() * 0.6;
        e.attackTimer = 0.35;
        e.state = 'attack';
      }
    }

    if (!hero || dist > DETECT_RADIUS * 1.3) {
      e.vx *= 0.92;
      e.vy *= 0.92;
    }

    const moving = Math.hypot(e.vx, e.vy) > 4;
    if (e.attackTimer > 0) {
      e.state = 'attack';
    } else if (e.talkTimer > 0) {
      e.state = 'talk';
    } else if (moving) {
      e.state = Math.abs(e.vx) > Math.abs(e.vy) ? 'walk_h' : 'walk_v';
    } else {
      e.state = 'idle';
    }
  }

  function syringeAiUpdate(dt, s) {
    if (!s || s.dead) return;
    s.ttl -= dt;
    s.x += (s.vx || 0) * dt;
    s.y += (s.vy || 0) * dt;
    const hero = G.player;
    if (hero && !hero.dead && overlap(s, hero)) {
      applyTouchToHero(s);
      s.dead = true;
    }
    if (s.ttl <= 0) s.dead = true;
  }

  function cleanupList(list) {
    for (let i = list.length - 1; i >= 0; i--) {
      const ent = list[i];
      if (ent?.dead) {
        removeFromWorld(ent);
        list.splice(i, 1);
      }
    }
  }

  function updateCharm(dt) {
    const hero = G.player;
    if (!hero?.status?.charmedByNurse) return;
    const st = hero.status.charmedByNurse;
    st.t -= dt;
    if (st.t <= 0) {
      delete hero.status.charmedByNurse;
      return;
    }
    const source = NurseSexy._list.find(n => n.id === st.sourceId && !n.dead);
    if (source) {
      const dx = source.x - hero.x;
      const dy = source.y - hero.y;
      const dist = Math.hypot(dx, dy) || 1;
      hero.vx += (dx / dist) * 20 * dt;
      hero.vy += (dy / dist) * 20 * dt;
    }
  }

  const NurseSexy = {
    _list: [],
    _projectiles: [],
    spawn: spawnNurseSexy,
    spawnAtTile: spawnNurseSexyAt,
    spawnFromAscii(tx, ty, def) { return spawnNurseSexyAt(tx, ty, def || {}); },
    ai: nurseSexyAiUpdate,
    update(dt = 0) {
      for (const n of this._list) nurseSexyAiUpdate(dt, n);
      for (const s of this._projectiles) syringeAiUpdate(dt, s);
      cleanupList(this._projectiles);
      cleanupList(this._list);
      updateCharm(dt);
    },
  };

  root.NurseSexyAPI = NurseSexy;
  root.Entities = root.Entities || {};
  root.Entities.NurseSexy = NurseSexy;
  root.Entities.spawnNurseSexyAt = spawnNurseSexyAt;
  root.Entities.spawnNurseSexyFromAscii = (tx, ty, def) => spawnNurseSexyAt(tx, ty, def || {});
})(window);
