// filename: guardia.entities.js
// Guardia de seguridad táctico con IA avanzada y rig 1 tile.
(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const ENT = W.ENT || (W.ENT = {});
  const Entities = W.Entities || (W.Entities = {});
  const TILE = W.TILE_SIZE || W.TILE || 32;

  ENT.GUARDIA = ENT.GUARDIA ?? ENT.GUARD ?? 402;
  ENT.CART = ENT.CART ?? 5;

  // Backwards compatible registration helper
  if (typeof Entities.define !== 'function') {
    Entities.define = function define(name, factory) {
      this[name] = factory;
      return factory;
    };
  }

  function ensureArrays() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.movers)) G.movers = [];
    if (!Array.isArray(G.hostiles)) G.hostiles = [];
  }

  function logDebug(tag, data) {
    if (W.DEBUG || W.DEBUG_GUARDIA) {
      try { console.debug(tag, data); } catch (_) {}
    }
  }

  function toWorldPoint(pt) {
    if (!pt) return { x: 0, y: 0 };
    if (typeof pt.x === 'number' && typeof pt.y === 'number') return pt;
    if (Array.isArray(pt)) return { x: pt[0] ?? 0, y: pt[1] ?? 0 };
    return { x: 0, y: 0 };
  }

  function toPxPoint(pt) {
    const p = toWorldPoint(pt);
    const x = p.x * TILE + TILE * 0.5;
    const y = p.y * TILE + TILE * 0.5;
    return { x, y };
  }

  function getHero() {
    const hero = G.player;
    return hero && !hero.dead ? hero : null;
  }

  function distanceBetween(a, b) {
    if (!a || !b) return Infinity;
    const ax = a.x + a.w * 0.5;
    const ay = a.y + a.h * 0.5;
    const bx = b.x + b.w * 0.5;
    const by = b.y + b.h * 0.5;
    return Math.hypot(ax - bx, ay - by);
  }

  function distanceSqPoint(ent, point) {
    const ax = ent.x + ent.w * 0.5;
    const ay = ent.y + ent.h * 0.5;
    const dx = (point.x ?? point.tx ?? 0) - ax;
    const dy = (point.y ?? point.ty ?? 0) - ay;
    return dx * dx + dy * dy;
  }

  function normalize(dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  function moveEntityTowards(ent, target, speedTiles, dt) {
    if (!ent || !target) return;
    const goal = target._units === 'px' ? target : toPxPoint(target);
    const dx = goal.x - (ent.x + ent.w * 0.5);
    const dy = goal.y - (ent.y + ent.h * 0.5);
    const dir = normalize(dx, dy);
    const speedPx = (speedTiles ?? ent.moveSpeed ?? 1) * TILE;
    ent.vx = dir.x * speedPx;
    ent.vy = dir.y * speedPx;
    ent.facingX = dir.x;
    ent.facingY = dir.y;
  }

  function isAtPoint(ent, target, tolerancePx = TILE * 0.25) {
    const goal = target._units === 'px' ? target : toPxPoint(target);
    const dx = goal.x - (ent.x + ent.w * 0.5);
    const dy = goal.y - (ent.y + ent.h * 0.5);
    return Math.abs(dx) < tolerancePx && Math.abs(dy) < tolerancePx;
  }

  function hasLineOfSight(ax, ay, bx, by) {
    const map = G.map || [];
    const tx0 = Math.floor(ax / TILE), ty0 = Math.floor(ay / TILE);
    const tx1 = Math.floor(bx / TILE), ty1 = Math.floor(by / TILE);
    const dx = Math.abs(tx1 - tx0), sx = tx0 < tx1 ? 1 : -1;
    const dy = -Math.abs(ty1 - ty0), sy = ty0 < ty1 ? 1 : -1;
    let err = dx + dy;
    let x = tx0, y = ty0;
    while (true) {
      if (!map[y] || map[y][x] === 1) return false;
      if (x === tx1 && y === ty1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    return true;
  }

  function canGuardiaSeeHero(ent, hero) {
    if (!ent || !hero) return false;
    const radiusPx = (ent.detectRadius || 6) * TILE;
    const dx = hero.x + hero.w * 0.5 - (ent.x + ent.w * 0.5);
    const dy = hero.y + hero.h * 0.5 - (ent.y + ent.h * 0.5);
    if (dx * dx + dy * dy > radiusPx * radiusPx) return false;
    return hasLineOfSight(ent.x + ent.w * 0.5, ent.y + ent.h * 0.5, hero.x + hero.w * 0.5, hero.y + hero.h * 0.5);
  }

  function applyDamageToHero(hero, dmg, meta) {
    if (!hero) return;
    if (typeof W.applyDamage === 'function') {
      W.applyDamage(hero, dmg, meta?.source || 'guardia');
    } else if (typeof hero.hp === 'number') {
      hero.hp = Math.max(0, hero.hp - dmg);
      if (hero.hp === 0) hero.dead = true;
    }
  }

  function applyStunToHero(hero, seconds, meta) {
    if (!hero) return;
    if (typeof W.applyStun === 'function') {
      W.applyStun(hero, seconds, meta);
    } else {
      hero.stunnedUntil = (performance.now ? performance.now() : Date.now()) + seconds * 1000;
    }
  }

  function findNearestDoor(ent, maxDistTiles = 1) {
    const list = Array.isArray(G.doors) ? G.doors : [];
    const maxD2 = (maxDistTiles * TILE) * (maxDistTiles * TILE);
    let best = null;
    let bestD2 = maxD2 + 1;
    for (const d of list) {
      if (!d) continue;
      const cx = d.x + d.w * 0.5;
      const cy = d.y + d.h * 0.5;
      const dx = cx - (ent.x + ent.w * 0.5);
      const dy = cy - (ent.y + ent.h * 0.5);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = d; }
    }
    return best;
  }

  function findNearestElevator(ent, maxDistTiles = 1.2) {
    const list = Array.isArray(G.elevators) ? G.elevators : [];
    const maxD2 = (maxDistTiles * TILE) * (maxDistTiles * TILE);
    let best = null;
    let bestD2 = maxD2 + 1;
    for (const el of list) {
      if (!el) continue;
      const cx = el.x + (el.w || TILE) * 0.5;
      const cy = el.y + (el.h || TILE) * 0.5;
      const dx = cx - (ent.x + ent.w * 0.5);
      const dy = cy - (ent.y + ent.h * 0.5);
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = el; }
    }
    return best;
  }

  function tryGuardiaToggleNearbyDoor(ent) {
    if (ent.ai.doorCooldown > 0) return;
    const door = findNearestDoor(ent, 1.1);
    if (!door || door.isBossDoor) return;
    const DoorAPI = W.Entities?.Door;
    if (DoorAPI?.toggleDoor) DoorAPI.toggleDoor(door);
    else if (DoorAPI?.interact) DoorAPI.interact(ent, 1.0);
    ent.ai.doorCooldown = 2.0;
    logDebug('[GUARDIA_DOOR_TOGGLE]', { guardId: ent.id, doorId: door?.id });
  }

  function chooseStrategicFloor() {
    return Math.round(Math.random() * 2);
  }

  function tryGuardiaUseElevator(ent) {
    if (ent.ai.elevatorCooldown > 0) return;
    const elev = findNearestElevator(ent, 1.1);
    if (!elev) return;
    const ElevatorAPI = W.ElevatorAPI || W.Entities?.Elevator;
    if (ElevatorAPI?.requestRide) ElevatorAPI.requestRide(elev, ent, chooseStrategicFloor(ent));
    ent.ai.elevatorCooldown = 5.0;
    logDebug('[GUARDIA_ELEVATOR]', { guardId: ent.id, elevId: elev?.id });
  }

  function onCollideGuardiaWithCart(guard, cart) {
    const impulse = 2.5;
    cart.vx = (cart.vx || 0) + Math.sign(guard.vx || 0) * impulse;
    cart.vy = (cart.vy || 0) + Math.sign(guard.vy || 0) * impulse;
  }

  function setGuardiaWalkAnim(ent) {
    const ps = ent.puppetState || (ent.puppetState = { anim: 'idle' });
    if (Math.abs(ent.vx) > Math.abs(ent.vy)) {
      ps.anim = 'walk_side';
    } else if (ent.vy < 0) {
      ps.anim = 'walk_up';
    } else {
      ps.anim = 'walk_down';
    }
  }

  function updateGuardiaAnimFromState(ent) {
    const ai = ent.ai || {};
    const ps = ent.puppetState || (ent.puppetState = { anim: 'idle' });
    switch (ai.state) {
      case 'inspect':
        ps.anim = 'extra';
        break;
      case 'subdue':
        ps.anim = 'attack';
        break;
      case 'return':
        ps.anim = 'walk_down';
        break;
      case 'dead':
        ps.anim = 'die_hit';
        break;
      default:
        break;
    }
  }

  function startGuardiaInspect(ent, pos) {
    const ai = ent.ai;
    ai.state = 'inspect';
    ai.inspectTimer = ent.inspectTime;
    ai.inspectPos = { x: pos.x, y: pos.y };
    ent.vx = ent.vy = 0;
    ent.puppetState.anim = 'extra';
    logDebug('[GUARDIA_INSPECT]', { guardId: ent.id });
  }

  function updateGuardiaInspect(ent, dt) {
    const ai = ent.ai;
    ai.inspectTimer -= dt;
    if (ai.inspectTimer <= 0) {
      ai.state = 'return';
      updateGuardiaAnimFromState(ent);
    }
  }

  function startGuardiaSubdue(ent, hero) {
    const ai = ent.ai;
    ai.state = 'subdue';
    ai.subdueTimer = 0.6;
    ent.vx = ent.vy = 0;
    ent.puppetState.anim = 'attack';
    applyDamageToHero(hero, ent.attackDamage, { source: 'guardia' });
    applyStunToHero(hero, ent.subdueStunTime, { source: 'guardia' });
    logDebug('[GUARDIA_SUBDUE_HERO]', { guardId: ent.id, heroId: hero?.id });
  }

  function updateGuardiaSubdue(ent, hero, dt) {
    const ai = ent.ai;
    ai.subdueTimer -= dt;
    if (ai.subdueTimer <= 0) {
      ai.state = 'alert';
      updateGuardiaAnimFromState(ent);
    }
  }

  function findClosestPatrolIndex(ent, pts) {
    let best = 0;
    let bestD2 = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const goal = p._units === 'px' ? p : toPxPoint(p);
      const d2 = distanceSqPoint(ent, goal);
      if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
    return best;
  }

  function updateGuardiaReturn(ent) {
    const ai = ent.ai;
    if (!ai.patrolPoints || ai.patrolPoints.length === 0) { ai.state = 'patrol'; return; }
    ai.patrolIndex = findClosestPatrolIndex(ent, ai.patrolPoints);
    ai.state = 'patrol';
  }

  function updateGuardiaPatrol(ent, hero, dt) {
    const ai = ent.ai;
    if (ai.patrolPoints && ai.patrolPoints.length) {
      const target = ai.patrolPoints[ai.patrolIndex];
      moveEntityTowards(ent, target, ent.moveSpeed, dt);
      setGuardiaWalkAnim(ent);
      if (isAtPoint(ent, target)) {
        ai.patrolIndex = (ai.patrolIndex + 1) % ai.patrolPoints.length;
        if (Math.random() < 0.25) startGuardiaInspect(ent, target);
        tryGuardiaToggleNearbyDoor(ent);
      }
    }
    tryGuardiaUseElevator(ent);
  }

  function updateGuardiaAlert(ent, hero, dt) {
    const ai = ent.ai;
    ai.alertTimer -= dt;
    if (!ai.lastHeardPos || ai.alertTimer <= 0) { ai.state = 'return'; return; }
    moveEntityTowards(ent, ai.lastHeardPos, ent.moveSpeed, dt);
    setGuardiaWalkAnim(ent);
    if (isAtPoint(ent, ai.lastHeardPos)) {
      startGuardiaInspect(ent, ai.lastHeardPos);
    }
  }

  function updateGuardiaChase(ent, hero, dt) {
    const ai = ent.ai;
    if (!hero) { ai.state = 'return'; return; }
    const dist = distanceBetween(ent, hero);
    if (dist > ent.detectRadius * 1.8 * TILE || !canGuardiaSeeHero(ent, hero)) {
      ai.state = 'alert';
      ai.lastHeardPos = { x: hero.x + hero.w * 0.5, y: hero.y + hero.h * 0.5, _units: 'px' };
      return;
    }
    if (dist > TILE * 0.9) {
      moveEntityTowards(ent, { x: hero.x + hero.w * 0.5, y: hero.y + hero.h * 0.5, _units: 'px' }, ent.runSpeed, dt);
      setGuardiaWalkAnim(ent, true);
    } else {
      startGuardiaSubdue(ent, hero);
    }
  }

  function updateGuardiaPerception(ent, hero) {
    const ai = ent.ai;
    if (!hero) return;
    if (canGuardiaSeeHero(ent, hero)) {
      ai.state = 'chase';
      ai.targetHeroId = hero.id;
      ai.alertTimer = ent.alertDuration;
      logDebug('[GUARDIA_ALERT_SEE]', { guardId: ent.id, heroId: hero.id });
      return;
    }
    if (hero.lastNoisePos) {
      const dx = hero.lastNoisePos.x - (ent.x + ent.w * 0.5);
      const dy = hero.lastNoisePos.y - (ent.y + ent.h * 0.5);
      if (dx * dx + dy * dy < ent.hearRadius * ent.hearRadius * TILE * TILE) {
        ai.state = 'alert';
        ai.lastHeardPos = { x: hero.lastNoisePos.x, y: hero.lastNoisePos.y, _units: 'px' };
        ai.alertTimer = ent.alertDuration;
        logDebug('[GUARDIA_ALERT_HEAR]', { guardId: ent.id });
      }
    }
  }

  function updateGuardia(ent, dt) {
    const ai = ent.ai;
    if (!ai || ai.state === 'dead') return;
    const hero = getHero();
    ai.doorCooldown = Math.max(0, ai.doorCooldown - dt);
    ai.elevatorCooldown = Math.max(0, ai.elevatorCooldown - dt);
    if (ai.state === 'subdue') {
      updateGuardiaSubdue(ent, hero, dt);
      return;
    }
    updateGuardiaPerception(ent, hero);
    switch (ai.state) {
      case 'patrol':
        updateGuardiaPatrol(ent, hero, dt);
        break;
      case 'alert':
        updateGuardiaAlert(ent, hero, dt);
        break;
      case 'chase':
        updateGuardiaChase(ent, hero, dt);
        break;
      case 'inspect':
        updateGuardiaInspect(ent, dt);
        break;
      case 'return':
        updateGuardiaReturn(ent, dt);
        break;
      default:
        break;
    }
  }

  function attachRig(ent) {
    try {
      const rig = W.Puppet?.bind?.(ent, 'npc_guardia_seguridad')
        || W.PuppetAPI?.attach?.(ent, { rig: 'npc_guardia_seguridad', z: 0, scale: 1 });
      if (rig) ent.rigOk = true;
    } catch (_) {
      ent.rigOk = false;
    }
  }

  function createGuardia(pos, opts = {}) {
    const base = (typeof Entities.createBaseHuman === 'function')
      ? Entities.createBaseHuman(pos, opts)
      : {
          x: (pos?.x ?? (Array.isArray(pos) ? pos[0] : 0)) || 0,
          y: (pos?.y ?? (Array.isArray(pos) ? pos[1] : 0)) || 0,
          w: TILE * 0.9,
          h: TILE * 0.95,
          vx: 0,
          vy: 0,
          solid: true,
          dynamic: true,
          pushable: true,
          mass: 1.2,
          mu: 0.08,
          rest: 0.2,
          puppetState: { anim: 'idle' },
        };

    const ent = base;
    ent.id = ent.id || `GSEC_${Math.random().toString(36).slice(2, 8)}`;
    ent.kind = 'guardia_seguridad';
    ent.kindName = 'guardia_seguridad';
    ent.role = 'npc_guardia_seguridad';
    ent.moveSpeed = opts.moveSpeed ?? 1.0;
    ent.runSpeed = opts.runSpeed ?? 1.4;
    ent.hp = opts.hp ?? 120;
    ent.attackDamage = opts.attackDamage ?? 40;
    ent.subdueStunTime = opts.subdueStunTime ?? 3.5;
    ent.detectRadius = opts.detectRadius ?? 6.0;
    ent.hearRadius = opts.hearRadius ?? 8.0;
    ent.alertDuration = opts.alertDuration ?? 12.0;
    ent.inspectTime = opts.inspectTime ?? 2.0;
    ent.skin = ent.skin || opts.skin || 'guardia.png';
    ent.puppetState = ent.puppetState || { anim: 'idle' };
    ent.ai = Object.assign({
      state: 'patrol',
      patrolIndex: 0,
      patrolPoints: null,
      alertTimer: 0,
      inspectTimer: 0,
      lastHeardPos: null,
      targetHeroId: null,
      doorCooldown: 0,
      elevatorCooldown: 0,
    }, opts.ai || {});
    if (!ent.ai.patrolPoints) {
      ent.ai.patrolPoints = [
        { x: 2, y: 2 },
        { x: 8, y: 2 },
        { x: 8, y: 8 },
        { x: 2, y: 8 },
      ];
    }
    attachRig(ent);
    ensureArrays();
    if (!G.entities.includes(ent)) G.entities.push(ent);
    if (!G.movers.includes(ent)) G.movers.push(ent);
    if (!G.hostiles.includes(ent)) G.hostiles.push(ent);
    ent.group = ent.group || 'human';
    try { W.EntityGroups?.assign?.(ent); } catch (_) {}
    try { W.EntityGroups?.register?.(ent, G); } catch (_) {}
    ent.onCollide = function onCollide(other) {
      if (other && other.kind === ENT.CART) onCollideGuardiaWithCart(ent, other);
    };
    ent.update = function update(dt) { updateGuardia(ent, dt || 1 / 60); };
    return ent;
  }

  function spawn(opts = {}) {
    const tx = Number.isFinite(opts.tx) ? opts.tx : 2;
    const ty = Number.isFinite(opts.ty) ? opts.ty : 2;
    const pos = { x: tx * TILE, y: ty * TILE };
    const ent = createGuardia(pos, opts);
    logDebug('[GUARDIA_STATE]', { id: ent.id, state: ent.ai.state });
    return ent;
  }

  const Pool = { list: [] };

  function updateAll(dt = 1 / 60) {
    for (let i = Pool.list.length - 1; i >= 0; i--) {
      const e = Pool.list[i];
      if (!e || e.dead) { Pool.list.splice(i, 1); continue; }
      e.update?.(dt);
    }
  }

  Entities.define('guardia_seguridad', createGuardia);

  Entities.Guardia = {
    spawn(opts) { const g = spawn(opts); if (!Pool.list.includes(g)) Pool.list.push(g); return g; },
    updateAll,
    remove(e) { e.dead = true; Pool.list = Pool.list.filter((x) => x !== e); },
  };
  Entities.spawnGuardia = function spawnGuardia(tx, ty) { return Entities.Guardia.spawn({ tx, ty }); };
})(window);
