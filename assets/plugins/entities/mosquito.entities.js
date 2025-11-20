// ./assets/plugins/entities/mosquito.entities.js
(function () {
  'use strict';
  const W = (typeof window !== 'undefined') ? window : globalThis;
  const G = W.G || (W.G = {});
  const ENT = W.ENT || (W.ENT = {});
  ENT.MOSQUITO = ENT.MOSQUITO || 206;
  const TILE = (W.TILE_SIZE || W.TILE || G.TILE_SIZE || 32) | 0;

  const MOS_BALANCE = {
    maxHp: 12,
    moveSpeed: 3.2 * TILE,
    sightTiles: 6,
    attackRangeTiles: 0.6,
    attackCooldown: 0.8,
    baseDamage: 4,
    heavyDamage: 7,
    pushOnHit: 0.7 * TILE,
    annoyanceScore: -2,
  };

  const mosquitos = [];
  let mosquitoCounter = 0;

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

  function setAnimIdle(ent) { setAnim(ent, 'idle'); }
  function setAnimFly(ent, vx, vy) {
    const absX = Math.abs(vx || 0);
    const absY = Math.abs(vy || 0);
    if (absY >= absX) {
      if (vy < -1e-3) { setAnim(ent, 'walk_up', false); }
      else if (vy > 1e-3) { setAnim(ent, 'walk_down', false); }
      else { setAnimIdle(ent); }
    } else {
      setAnim(ent, 'walk_side', vx < 0);
    }
  }
  function setAnimAttack(ent) { setAnim(ent, 'attack', ent.vx < 0); }
  function setAnimEat(ent) { setAnim(ent, 'eat', ent.vx < 0); }
  function setAnimPowerup(ent) { setAnim(ent, 'powerup', ent.vx < 0); }
  function setAnimPush(ent) { setAnim(ent, 'push_action', ent.vx < 0); }
  function setAnimTalk(ent) { setAnim(ent, 'talk', ent.vx < 0); }
  function setAnimExtra(ent) { setAnim(ent, 'extra', ent.vx < 0); }
  function setAnimDead(ent, cause) {
    const c = (cause || '').toLowerCase();
    if (c.includes('fire')) setAnim(ent, 'die_fire');
    else if (c.includes('crush')) setAnim(ent, 'die_crush');
    else setAnim(ent, 'die_hit');
  }

  function bindRig(ent) {
    let puppet = null;
    try {
      puppet = W.Puppet?.bind?.(ent, 'mosquito', { z: 0, scale: 1, data: { skin: ent.skin } })
        || W.PuppetAPI?.attach?.(ent, { rig: 'mosquito', z: 0, scale: 1, data: { skin: ent.skin } });
    } catch (err) {
      puppet = null;
    }
    ent.puppet = puppet || ent.puppet;
    ent._puppet = ent._puppet || puppet;
    ent.rigOk = !!puppet;
    ent.puppetState = puppet?.state || { anim: 'idle' };
    if (!ent.rigOk) {
      try { console.error('[MOSQUITO] rig mosquito non trovato'); } catch (_) {}
    }
    return puppet;
  }

  function spawn(x, y, opts = {}) {
    ensureEntityArrays();
    const ent = Object.assign({
      id: opts.id || `MOSQUITO_${++mosquitoCounter}`,
      kind: 'enemy_mosquito',
      kindId: ENT.MOSQUITO,
      role: 'enemy',
      x: Number(x) || 0,
      y: Number(y) || 0,
      w: Math.max(6, Math.floor(TILE * 0.65)),
      h: Math.max(6, Math.floor(TILE * 0.6)),
      vx: 0,
      vy: 0,
      group: 'enemy',
      static: false,
      pushable: false,
      spriteKey: 'enemy_mosquito',
      skin: opts.skin || 'mosquito_hospital.png',
      ai: { state: 'hover', hoverTimer: 0, buzzTimer: 0, attackTimer: 0, powerTimer: 0 },
      hp: MOS_BALANCE.maxHp,
      maxHp: MOS_BALANCE.maxHp,
      hostile: true,
      solid: true,
      dynamic: true,
      rest: 0.4,
      mu: 0.02,
    }, opts || {});

    bindRig(ent);
    G.entities.push(ent);
    G.movers.push(ent);
    G.enemies.push(ent);
    try { W.EntityGroups?.assign?.(ent); } catch (_) {}
    try { W.EntityGroups?.register?.(ent, G); } catch (_) {}

    mosquitos.push(ent);
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

  function damageHero(hero, mos) {
    if (!hero || !mos) return;
    if ((mos.ai.attackTimer || 0) > 0) return;
    const hx = hero.x + (hero.w || 0) * 0.5;
    const hy = hero.y + (hero.h || 0) * 0.5;
    const mx = mos.x + (mos.w || 0) * 0.5;
    const my = mos.y + (mos.h || 0) * 0.5;
    const dx = hx - mx;
    const dy = hy - my;
    const dist = Math.hypot(dx, dy) || 1;
    const close = dist < (MOS_BALANCE.attackRangeTiles * TILE * 0.55);
    const dmg = close ? MOS_BALANCE.heavyDamage : MOS_BALANCE.baseDamage;
    if (close) { setAnimPowerup(mos); }
    else { setAnimEat(mos); }

    const kb = MOS_BALANCE.pushOnHit;
    const vx = (dx / dist) * kb;
    const vy = (dy / dist) * kb;
    if (typeof hero.takeDamage === 'function') {
      try { hero.takeDamage(dmg, { cause: 'mosquito_bite', source: mos, knockback: { vx, vy } }); } catch (_) {}
    } else {
      hero.hp = Math.max(0, (hero.hp || 0) - dmg);
    }
    applyKnockback(hero, mos, kb);
    try { W.ScoreAPI?.addPoints?.(MOS_BALANCE.annoyanceScore); } catch (_) {}
    mos.ai.attackTimer = MOS_BALANCE.attackCooldown;
  }

  function updateHover(ent, dt) {
    ent.ai.hoverTimer = (ent.ai.hoverTimer || 0) - dt;
    ent.ai.buzzTimer = (ent.ai.buzzTimer || 0) - dt;
    if (ent.ai.hoverTimer <= 0) {
      ent.ai.hoverTimer = 0.6 + Math.random() * 1.6;
      ent.ai.hoverDir = Math.random() * Math.PI * 2;
    }
    if (ent.ai.buzzTimer <= 0 && Math.random() < 0.2) {
      ent.ai.buzzTimer = 2 + Math.random() * 2;
      setAnimExtra(ent);
    }
    const sway = Math.sin((ent.ai.buzzTimer || 0) + ent.y * 0.01) * 0.3;
    const dir = (ent.ai.hoverDir || 0) + sway * 0.6;
    const speed = MOS_BALANCE.moveSpeed * 0.35;
    ent.vx = Math.cos(dir) * speed;
    ent.vy = Math.sin(dir) * speed;
    setAnimFly(ent, ent.vx, ent.vy);
  }

  function updateHarass(ent, hero, dt) {
    const cx = ent.x + (ent.w || 0) * 0.5;
    const cy = ent.y + (ent.h || 0) * 0.5;
    const hx = hero.x + (hero.w || 0) * 0.5;
    const hy = hero.y + (hero.h || 0) * 0.5;
    const dx = hx - cx;
    const dy = hy - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const perpendicular = { x: -uy, y: ux };
    const zig = (Math.random() - 0.5) * 0.6;
    const speed = MOS_BALANCE.moveSpeed;
    ent.vx = (ux + perpendicular.x * zig) * speed;
    ent.vy = (uy + perpendicular.y * zig) * speed;
    setAnimFly(ent, ent.vx, ent.vy);
  }

  function updateAttack(ent, hero, dt) {
    const cx = ent.x + (ent.w || 0) * 0.5;
    const cy = ent.y + (ent.h || 0) * 0.5;
    const hx = hero.x + (hero.w || 0) * 0.5;
    const hy = hero.y + (hero.h || 0) * 0.5;
    const dx = hx - cx;
    const dy = hy - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const hover = MOS_BALANCE.moveSpeed * 0.25;
    ent.vx = ux * hover + Math.sin(ent.y * 0.1 + ent.x * 0.05) * hover * 0.3;
    ent.vy = uy * hover + Math.cos(ent.x * 0.1 + ent.y * 0.07) * hover * 0.3;
    setAnimAttack(ent);

    ent.ai.attackTimer = Math.max(0, (ent.ai.attackTimer || 0) - dt);
    const rangePx = MOS_BALANCE.attackRangeTiles * TILE;
    if (dist <= rangePx && rectsOverlap(ent, hero)) {
      damageHero(hero, ent);
    }
  }

  function updateMosquito(ent, dt) {
    if (!ent || ent.dead) return;
    const hero = (G.player && !G.player.dead) ? G.player : (G.hero && !G.hero.dead ? G.hero : null);
    ent.ai = ent.ai || { state: 'hover', hoverTimer: 0, buzzTimer: 0, attackTimer: 0 };
    ent.ai.attackTimer = Math.max(0, (ent.ai.attackTimer || 0) - dt);

    if (ent.hp <= 0) {
      ent.dead = true;
      ent.vx *= 0.7;
      ent.vy = (ent.vy || 0) + TILE * 0.2 * dt;
      setAnimDead(ent, ent.deathCause || 'hit');
      moveWithCollisionsOrSimple(ent, dt);
      return;
    }

    const sightPx = MOS_BALANCE.sightTiles * TILE;
    let state = ent.ai.state || 'hover';
    if (!hero) { state = 'hover'; }
    else {
      const cx = ent.x + (ent.w || 0) * 0.5;
      const cy = ent.y + (ent.h || 0) * 0.5;
      const hx = hero.x + (hero.w || 0) * 0.5;
      const hy = hero.y + (hero.h || 0) * 0.5;
      const dx = hx - cx;
      const dy = hy - cy;
      const dist = Math.hypot(dx, dy);
      if (dist <= MOS_BALANCE.attackRangeTiles * TILE * 1.1) state = 'attack';
      else if (dist <= sightPx) state = 'harass';
      else state = 'hover';
      ent.ai._distToHero = dist;
    }

    ent.ai.state = state;

    switch (state) {
      case 'harass':
        updateHarass(ent, hero, dt);
        break;
      case 'attack':
        updateAttack(ent, hero, dt);
        break;
      default:
        updateHover(ent, dt);
        break;
    }

    if (state === 'harass' && Math.random() < 0.05) setAnimTalk(ent);
    if (state === 'hover' && Math.random() < 0.03) setAnimPush(ent);

    moveWithCollisionsOrSimple(ent, dt);
  }

  function updateAll(dt = 1 / 60) {
    for (let i = 0; i < mosquitos.length; i++) {
      updateMosquito(mosquitos[i], dt);
    }
  }

  const api = { spawn, updateAll, MOS_BALANCE };
  W.MosquitoAPI = api;

  // Legacy alias used by existing AI hooks
  W.Mosquitos = W.Mosquitos || {};
  W.Mosquitos.ai = function (ent, G, dt) {
    updateMosquito(ent, dt || 1 / 60, G);
  };
  W.Mosquitos.updateAll = api.updateAll;

  const oldOnFrame = W.onFrame;
  if (!W._mosquitoHooked) {
    W.onFrame = function (dt) {
      if (typeof oldOnFrame === 'function') oldOnFrame(dt);
      api.updateAll(dt || 1 / 60);
    };
    W._mosquitoHooked = true;
  }
})();
