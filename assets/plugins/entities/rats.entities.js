// ./assets/plugins/entities/rats.entities.js
(function () {
  'use strict';
  const W = (typeof window !== 'undefined') ? window : globalThis;
  const G = W.G || (W.G = {});
  const ENT = W.ENT || (W.ENT = {});
  ENT.RAT = ENT.RAT || 205;
  const TILE = (W.TILE_SIZE || W.TILE || G.TILE_SIZE || 32) | 0;

  const RAT_BALANCE = {
    maxHp: 40,
    moveSpeed: 2.4 * TILE,
    sightTiles: 7,
    attackRangeTiles: 0.7,
    attackCooldown: 0.9,
    baseDamage: 22,
    heavyDamage: 32,
    pushOnHit: 1.4 * TILE,
  };

  const rats = [];
  let ratCounter = 0;

  function ensureEntityArrays() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.movers)) G.movers = [];
    if (!Array.isArray(G.enemies)) G.enemies = [];
    try { W.EntityGroups?.ensure?.(G); } catch (_) {}
  }

  function rectsOverlap(a, b) {
    if (!a || !b) return false;
    const ax1 = a.x, ay1 = a.y, ax2 = a.x + (a.w || 0), ay2 = a.y + (a.h || 0);
    const bx1 = b.x, by1 = b.y, bx2 = b.x + (b.w || 0), by2 = b.y + (b.h || 0);
    return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
  }

  function moveWithCollisionsOrSimple(ent, dt) {
    if (typeof W.moveWithCollisions === 'function') {
      try { W.moveWithCollisions(ent, dt); return; } catch (_) {}
    }
    ent.x += (ent.vx || 0) * dt;
    ent.y += (ent.vy || 0) * dt;
  }

  function setAnim(ent, anim, flipX) {
    if (!ent) return;
    const puppet = ent.puppet || ent._puppet;
    if (puppet && puppet.state) {
      puppet.state.anim = anim;
      puppet.state.flipX = !!flipX;
    }
    ent.puppetState = ent.puppetState || {};
    ent.puppetState.anim = anim;
    ent.puppetState.flipX = !!flipX;
  }

  function setAnimWalk(ent, vx, vy) {
    const absX = Math.abs(vx || 0);
    const absY = Math.abs(vy || 0);
    if (absY >= absX) {
      if (vy < -1e-3) { setAnim(ent, 'walk_up', false); }
      else if (vy > 1e-3) { setAnim(ent, 'walk_down', false); }
      else { setAnim(ent, 'idle', false); }
    } else {
      setAnim(ent, 'walk_side', vx < 0);
    }
  }

  function setAnimAttack(ent) { setAnim(ent, 'attack', ent.vx < 0); }
  function setAnimEat(ent) { setAnim(ent, 'eat', ent.vx < 0); }
  function setAnimPowerup(ent) { setAnim(ent, 'powerup', ent.vx < 0); }
  function setAnimPush(ent) { setAnim(ent, 'push_action', ent.vx < 0); }
  function setAnimDead(ent, cause) {
    const c = (cause || '').toLowerCase();
    if (c.includes('fire')) setAnim(ent, 'die_fire');
    else if (c.includes('crush')) setAnim(ent, 'die_crush');
    else setAnim(ent, 'die_hit');
  }

  function bindRig(ent) {
    let puppet = null;
    try {
      puppet = W.Puppet?.bind?.(ent, 'rat', { z: 0, scale: 1, data: { skin: ent.skin } })
        || W.PuppetAPI?.attach?.(ent, { rig: 'rat', z: 0, scale: 1, data: { skin: ent.skin } });
    } catch (err) {
      puppet = null;
    }
    ent.puppet = puppet || ent.puppet;
    ent._puppet = ent._puppet || puppet;
    ent.rigOk = !!puppet;
    ent.puppetState = puppet?.state || { anim: 'idle' };
    if (!ent.rigOk) {
      try { console.error('[RAT] No se pudo asociar rig rat'); } catch (_) {}
    }
    return puppet;
  }

  function spawn(x, y, opts = {}) {
    ensureEntityArrays();
    const ent = Object.assign({
      id: opts.id || `RAT_${++ratCounter}`,
      kind: 'enemy_rat',
      kindId: ENT.RAT,
      role: 'enemy',
      x: Number(x) || 0,
      y: Number(y) || 0,
      w: Math.max(8, Math.floor(TILE * 0.9)),
      h: Math.max(8, Math.floor(TILE * 0.8)),
      vx: 0,
      vy: 0,
      group: 'enemy',
      spriteKey: 'enemy_rat',
      skin: opts.skin || 'rat_hospital.png',
      ai: { state: 'patrol', patrolTimer: 0, attackTimer: 0, powerTimer: 0 },
      hp: RAT_BALANCE.maxHp,
      maxHp: RAT_BALANCE.maxHp,
      hostile: true,
      solid: true,
      dynamic: true,
      pushable: true,
      rest: 0.42,
      mu: 0.04,
      knockback: opts.knockback || 0,
    }, opts || {});

    bindRig(ent);
    G.entities.push(ent);
    G.movers.push(ent);
    G.enemies.push(ent);
    try { W.EntityGroups?.assign?.(ent); } catch (_) {}
    try { W.EntityGroups?.register?.(ent, G); } catch (_) {}

    rats.push(ent);
    try { W.LOG?.debug?.('[RAT] spawn', { id: ent.id, x: ent.x, y: ent.y }); } catch (_) {}
    return ent;
  }

  function applyKnockback(hero, from, strength) {
    if (!hero || !from) return;
    const hx = hero.x + (hero.w || 0) * 0.5;
    const hy = hero.y + (hero.h || 0) * 0.5;
    const rx = from.x + (from.w || 0) * 0.5;
    const ry = from.y + (from.h || 0) * 0.5;
    const dx = hx - rx;
    const dy = hy - ry;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    hero.vx = (hero.vx || 0) + ux * strength;
    hero.vy = (hero.vy || 0) + uy * strength;
  }

  function damageHero(ent, hero, distToHero) {
    if (!hero || ent.ai.attackTimer > 0) return;
    const rangePx = RAT_BALANCE.attackRangeTiles * TILE;
    if (distToHero > rangePx) return;
    const close = distToHero < rangePx * 0.55;
    const dmg = close ? RAT_BALANCE.heavyDamage : RAT_BALANCE.baseDamage;
    if (close) {
      setAnimPowerup(ent);
    } else {
      setAnimAttack(ent);
    }
    const kb = RAT_BALANCE.pushOnHit;
    const hx = hero.x + (hero.w || 0) * 0.5;
    const hy = hero.y + (hero.h || 0) * 0.5;
    const rx = ent.x + (ent.w || 0) * 0.5;
    const ry = ent.y + (ent.h || 0) * 0.5;
    const dx = hx - rx;
    const dy = hy - ry;
    const dist = Math.hypot(dx, dy) || 1;
    const vx = (dx / dist) * kb;
    const vy = (dy / dist) * kb;
    if (typeof hero.takeDamage === 'function') {
      try { hero.takeDamage(dmg, { cause: 'rat_bite', source: ent, knockback: { vx, vy } }); } catch (_) {}
    } else {
      hero.hp = Math.max(0, (hero.hp || 0) - dmg);
    }
    applyKnockback(hero, ent, kb);
    try { W.ScoreAPI?.addPoints?.(-5); } catch (_) {}
    ent.ai.attackTimer = RAT_BALANCE.attackCooldown;
  }

  function updatePatrol(ent, dt) {
    ent.ai.patrolTimer = (ent.ai.patrolTimer || 0) - dt;
    if (ent.ai.patrolTimer <= 0) {
      ent.ai.patrolTimer = 0.8 + Math.random() * 2.2;
      ent.ai.dir = Math.random() * Math.PI * 2;
    }
    const dir = ent.ai.dir || 0;
    ent.vx = Math.cos(dir) * RAT_BALANCE.moveSpeed * 0.35;
    ent.vy = Math.sin(dir) * RAT_BALANCE.moveSpeed * 0.35;
    setAnimWalk(ent, ent.vx, ent.vy);
  }

  function updateChase(ent, hero, dt) {
    const cx = ent.x + (ent.w || 0) * 0.5;
    const cy = ent.y + (ent.h || 0) * 0.5;
    const hx = hero.x + (hero.w || 0) * 0.5;
    const hy = hero.y + (hero.h || 0) * 0.5;
    const dx = hx - cx;
    const dy = hy - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = RAT_BALANCE.moveSpeed;
    ent.vx = (dx / dist) * speed;
    ent.vy = (dy / dist) * speed;
    setAnimWalk(ent, ent.vx, ent.vy);
    return dist;
  }

  function updateRat(ent, dt) {
    if (!ent || ent.dead) return;
    const ai = ent.ai || (ent.ai = {});
    ai.attackTimer = Math.max(0, (ai.attackTimer || 0) - dt);
    ai.powerTimer = Math.max(0, (ai.powerTimer || 0) - dt);

    if (ent.hp != null && ent.hp <= 0) {
      ent.dead = true;
      setAnimDead(ent, ent.lastDamageCause);
      ent.vx *= 0.6; ent.vy *= 0.6;
      moveWithCollisionsOrSimple(ent, dt);
      return;
    }

    const hero = G.player || G.hero || null;
    const hasHero = hero && !hero.dead;
    const sight = RAT_BALANCE.sightTiles * TILE;
    let distToHero = Infinity;
    if (hasHero) {
      const cx = ent.x + (ent.w || 0) * 0.5;
      const cy = ent.y + (ent.h || 0) * 0.5;
      const hx = hero.x + (hero.w || 0) * 0.5;
      const hy = hero.y + (hero.h || 0) * 0.5;
      const dx = hx - cx;
      const dy = hy - cy;
      distToHero = Math.hypot(dx, dy);
    }

    if (!hasHero) {
      ai.state = 'patrol';
    } else if (distToHero <= sight) {
      ai.state = 'chase';
    } else if (ai.state !== 'attack') {
      ai.state = 'patrol';
    }

    if (ai.state === 'chase' && hasHero) {
      distToHero = updateChase(ent, hero, dt);
      if (distToHero <= RAT_BALANCE.attackRangeTiles * TILE) {
        ai.state = 'attack';
      }
    }

    if (ai.state === 'attack' && hasHero) {
      ent.vx *= 0.4; ent.vy *= 0.4;
      const overlap = rectsOverlap(ent, hero);
      if (overlap) {
        damageHero(ent, hero, distToHero);
      }
      if (ai.attackTimer > 0) {
        setAnimAttack(ent);
      }
      if (!overlap || distToHero > RAT_BALANCE.attackRangeTiles * TILE * 1.15) {
        ai.state = 'chase';
      }
    }

    if (ai.state === 'patrol') {
      updatePatrol(ent, dt);
    }

    moveWithCollisionsOrSimple(ent, dt);
  }

  function updateAll(dt) {
    const delta = Number.isFinite(dt) ? dt : 1 / 60;
    for (let i = rats.length - 1; i >= 0; i--) {
      const r = rats[i];
      if (!r || r.destroyed) { rats.splice(i, 1); continue; }
      updateRat(r, delta);
    }
  }

  W.RatAPI = { spawn, updateAll };

  if (!G.__hookedRatsLoop) {
    G.__hookedRatsLoop = true;
    const oldOnFrame = W.onFrame;
    W.onFrame = function (dt) {
      if (typeof oldOnFrame === 'function') oldOnFrame(dt);
      W.RatAPI.updateAll(dt || 1 / 60);
    };
  }
})();
