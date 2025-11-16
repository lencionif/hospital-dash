// filename: human_ai.plugin.js
// IA común para todas las entidades humanas del hospital.
// Gestiona patrullas, persecución, interacción con puertas/ascensores/items
// y evita colisiones con paredes u otras entidades sólidas.
(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const TILE = (typeof W.TILE_SIZE === 'number') ? W.TILE_SIZE : (typeof W.TILE === 'number' ? W.TILE : 32);
  const ENT = W.ENT || (W.ENT = {});

  const HumanState = {
    IDLE: 'idle',
    PATROL: 'patrol',
    CHASE_PLAYER: 'chase_player',
    USE_DOOR: 'use_door',
    USE_ELEVATOR: 'use_elevator',
    SEEK_ITEM: 'seek_item',
    PUSH_OBJECT: 'push_object',
    TALKING: 'talking',
    STUNNED: 'stunned',
    BLOCKED: 'blocked',
    DEAD: 'dead'
  };

  const DEFAULTS = {
    role: 'npc',
    canPatrol: true,
    patrolPoints: null,
    patrolLoop: true,
    patrolSpeed: 48,
    chaseSpeed: 68,
    seekSpeed: 56,
    pushSpeed: 40,
    touchDamage: 0.5,
    canTalk: false,
    dialogueId: null,
    canSeekItems: true,
    ignoredItems: ['pill'],
    canPush: false,
    canUseDoors: true,
    canUseElevators: true,
    detectionRadius: 7 * TILE,
    talkDistance: 1.2 * TILE,
    pushImpulse: 120,
    blockToleranceMs: 900,
    unblockProbeMs: 600,
    targetRefreshMs: 750,
    elevatorCooldownMs: 3000
  };

  const occupancy = new Map();
  const tracked = new Set();

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function clamp(v, a, b) {
    return v < a ? a : (v > b ? b : v);
  }

  function lerp(a, b, t) {
    return a + (b - a) * clamp(t, 0, 1);
  }

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function entityCenter(ent) {
    return {
      x: (ent.x || 0) + (ent.w || TILE) * 0.5,
      y: (ent.y || 0) + (ent.h || TILE) * 0.5
    };
  }

  function toTile(px) {
    return Math.floor(px / TILE);
  }

  function isWallTile(tx, ty) {
    const map = G.map || [];
    if (!map.length) return false;
    if (ty < 0 || ty >= map.length) return true;
    const row = map[ty];
    if (!row || tx < 0 || tx >= row.length) return true;
    return row[tx] === 1;
  }

  function tileKey(tx, ty) {
    return `${tx},${ty}`;
  }

  function isElevator(ent) {
    if (!ent) return false;
    if (ent.kind && ENT.ELEVATOR != null && ent.kind === ENT.ELEVATOR) return true;
    return String(ent.kindName || ent.type || '').toLowerCase().includes('elevator');
  }

  function isDoor(ent) {
    if (!ent) return false;
    if (ent.kind && ENT.DOOR != null && ent.kind === ENT.DOOR) return true;
    return String(ent.kindName || ent.type || '').toLowerCase().includes('door');
  }

  function isDoorWalkable(ent) {
    return !!(ent && ent.open && (ent.walkable || ent.solid === false));
  }

  function isTileOccupied(tx, ty, self) {
    const key = tileKey(tx, ty);
    const set = occupancy.get(key);
    if (!set || !set.size) return false;
    for (const other of set) {
      if (!other || other === self || other.dead) continue;
      if (!other.solid) continue;
      if (isElevator(other) || isDoorWalkable(other)) continue;
      return true;
    }
    return false;
  }

  function updateOccupancy(ent) {
    if (!ent) return;
    const center = entityCenter(ent);
    const tx = toTile(center.x);
    const ty = toTile(center.y);
    const key = tileKey(tx, ty);
    if (ent._humanAI_lastKey === key) return;
    if (ent._humanAI_lastKey) {
      const prev = occupancy.get(ent._humanAI_lastKey);
      if (prev) {
        prev.delete(ent);
        if (!prev.size) occupancy.delete(ent._humanAI_lastKey);
      }
    }
    let bucket = occupancy.get(key);
    if (!bucket) {
      bucket = new Set();
      occupancy.set(key, bucket);
    }
    bucket.add(ent);
    ent._humanAI_lastKey = key;
  }

  function clearOccupancy(ent) {
    if (!ent || !ent._humanAI_lastKey) return;
    const prev = occupancy.get(ent._humanAI_lastKey);
    if (prev) {
      prev.delete(ent);
      if (!prev.size) occupancy.delete(ent._humanAI_lastKey);
    }
    delete ent._humanAI_lastKey;
  }

  function normalize(dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  function stopMovement(ent) {
    ent.intentVx = 0;
    ent.intentVy = 0;
    ent.vx = 0;
    ent.vy = 0;
  }

  function projectPosition(ent, dir, speed, dt) {
    const nx = (ent.x || 0) + dir.x * speed * dt;
    const ny = (ent.y || 0) + dir.y * speed * dt;
    return { x: nx, y: ny };
  }

  function isTileWalkable(tx, ty, ent) {
    if (isWallTile(tx, ty)) return false;
    if (isTileOccupied(tx, ty, ent)) return false;
    return true;
  }

  function findPath(start, goal, ent) {
    const sx = clamp(start.tx, 0, (G.map?.[0]?.length || 1) - 1);
    const sy = clamp(start.ty, 0, (G.map?.length || 1) - 1);
    const gx = clamp(goal.tx, 0, (G.map?.[0]?.length || 1) - 1);
    const gy = clamp(goal.ty, 0, (G.map?.length || 1) - 1);
    if (sx === gx && sy === gy) return [{ tx: sx, ty: sy }];
    const open = [];
    const cameFrom = new Map();
    const visited = new Set();
    function key(x, y) { return `${x}|${y}`; }
    open.push({ tx: sx, ty: sy });
    visited.add(key(sx, sy));
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (open.length) {
      const current = open.shift();
      if (current.tx === gx && current.ty === gy) {
        const path = [current];
        let ck = key(current.tx, current.ty);
        while (cameFrom.has(ck)) {
          const prev = cameFrom.get(ck);
          path.push(prev);
          ck = key(prev.tx, prev.ty);
        }
        path.reverse();
        return path;
      }
      for (const [dx, dy] of dirs) {
        const nx = current.tx + dx;
        const ny = current.ty + dy;
        const nk = key(nx, ny);
        if (visited.has(nk)) continue;
        if (!isTileWalkable(nx, ny, ent)) continue;
        visited.add(nk);
        cameFrom.set(nk, current);
        open.push({ tx: nx, ty: ny });
      }
    }
    return null;
  }

  function samplePatrolPoints(points) {
    if (!Array.isArray(points) || !points.length) return null;
    return points
      .map((p) => {
        if (!p) return null;
        if (typeof p.x === 'number' && typeof p.y === 'number') {
          return { x: p.x, y: p.y };
        }
        if (Array.isArray(p) && p.length >= 2) {
          return { x: p[0], y: p[1] };
        }
        if (typeof p.tx === 'number' && typeof p.ty === 'number') {
          return { x: p.tx * TILE + TILE * 0.5, y: p.ty * TILE + TILE * 0.5 };
        }
        return null;
      })
      .filter(Boolean);
  }

  function warnInvalidPatrolPoint(point, role) {
    try {
      console.warn(`[HumanAI] Punto de patrulla inválido para ${role || 'human'}:`, point);
    } catch (_) {}
  }

  function ensurePatrolPoints(ent, ctx) {
    if (!ctx._patrolResolved && ctx.patrolPoints) {
      const pts = samplePatrolPoints(ctx.patrolPoints) || [];
      const valid = [];
      for (const pt of pts) {
        const tx = toTile(pt.x);
        const ty = toTile(pt.y);
        if (isWallTile(tx, ty)) {
          warnInvalidPatrolPoint(pt, ctx.role);
          continue;
        }
        valid.push(pt);
      }
      ctx._patrolResolved = true;
      ctx._patrol = valid.length ? valid : null;
      ctx._patrolIndex = 0;
      ctx._patrolDir = 1;
    }
  }

  function setState(ent, ctx, next) {
    if (ctx.state === next) return;
    ctx.state = next;
    ctx.stateSince = nowMs();
  }

  function reached(ent, target, tolerance = TILE * 0.25) {
    if (!target) return true;
    const c = entityCenter(ent);
    return dist2(c.x, c.y, target.x, target.y) <= tolerance * tolerance;
  }

  function moveTowards(ent, ctx, target, speed, dt) {
    if (!target) {
      stopMovement(ent);
      return;
    }
    const c = entityCenter(ent);
    const dir = normalize(target.x - c.x, target.y - c.y);
    const probe = projectPosition(ent, dir, speed, dt);
    const tx = toTile(probe.x + ent.w * 0.5);
    const ty = toTile(probe.y + ent.h * 0.5);
    if (!isTileWalkable(tx, ty, ent)) {
      // Intenta pathfinding si no hay ruta directa
      const start = { tx: toTile(c.x), ty: toTile(c.y) };
      const goal = { tx: toTile(target.x), ty: toTile(target.y) };
      const path = findPath(start, goal, ent);
      ctx.path = path;
      ctx.pathIndex = 0;
      if (!path) {
        stopMovement(ent);
        ctx._blockedAccum = (ctx._blockedAccum || 0) + dt * 1000;
        if (ctx._blockedAccum > ctx.blockToleranceMs) setState(ent, ctx, HumanState.BLOCKED);
        return;
      }
      return followPath(ent, ctx, speed, dt);
    }
    ent.intentVx = dir.x * speed;
    ent.intentVy = dir.y * speed;
    ctx._blockedAccum = 0;
  }

  function followPath(ent, ctx, speed, dt) {
    const path = ctx.path;
    if (!Array.isArray(path) || ctx.pathIndex >= path.length) {
      stopMovement(ent);
      return;
    }
    const node = path[ctx.pathIndex];
    const target = {
      x: node.tx * TILE + TILE * 0.5,
      y: node.ty * TILE + TILE * 0.5
    };
    moveTowards(ent, ctx, target, speed, dt);
    if (reached(ent, target, TILE * 0.2)) {
      ctx.pathIndex += 1;
    }
  }

  function hasLineOfSight(a, b) {
    const start = entityCenter(a);
    const end = entityCenter(b);
    const steps = Math.max(6, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / (TILE * 0.5)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = lerp(start.x, end.x, t);
      const y = lerp(start.y, end.y, t);
      if (isWallTile(toTile(x), toTile(y))) return false;
    }
    return true;
  }

  function findNearest(list, origin, filter) {
    if (!Array.isArray(list) || !list.length) return null;
    let best = null;
    let bestD = Infinity;
    const c = entityCenter(origin);
    for (const it of list) {
      if (!it || it.dead) continue;
      if (filter && !filter(it)) continue;
      const d = dist2(c.x, c.y, it.x + (it.w || TILE) * 0.5, it.y + (it.h || TILE) * 0.5);
      if (d < bestD) {
        best = it;
        bestD = d;
      }
    }
    return best;
  }

  function listEntitiesByKind(kindNames) {
    if (!Array.isArray(G.entities)) return [];
    return G.entities.filter((it) => {
      if (!it || it.dead) return false;
      const k = String(it.kindName || it.kind || it.type || '').toLowerCase();
      return kindNames.some((needle) => k.includes(needle));
    });
  }

  function handlePlayerContact(ent, ctx, player) {
    if (!player || player.dead) return;
    const touching = !(ent.x + ent.w <= player.x || ent.x >= player.x + player.w || ent.y + ent.h <= player.y || ent.y >= player.y + player.h);
    if (!touching) return;
    if (ctx.canTalk && ctx.dialogueId) {
      setState(ent, ctx, HumanState.TALKING);
      ctx._talkUntil = nowMs() + 2500;
      if (W.Dialogue && typeof W.Dialogue.start === 'function') {
        W.Dialogue.start(ctx.dialogueId, ent, player);
      } else if (W.DialogAPI?.open) {
        W.DialogAPI.open({
          title: ctx.dialogueTitle || (ent.displayName || 'Personal'),
          text: ctx.dialogueText || ctx.dialogueId,
          portrait: ctx.dialoguePortrait,
          buttons: [{ id: 'ok', label: 'Cerrar', action: () => W.DialogAPI.close?.() }],
        });
      }
      return;
    }
    const dmg = Math.max(0, ctx.touchDamage || 0);
    if (dmg > 0) {
      try {
        const heroAPI = W.Entities?.Hero;
        if (heroAPI?.applyDamage) {
          heroAPI.applyDamage(player, dmg, ent.role || 'npc');
        }
      } catch (_) {}
    }
  }

  function tryUseDoor(ent, door) {
    if (!door) return false;
    if (door.open && (door.walkable || door.solid === false)) return true;
    const Doors = W.Entities?.Door;
    try {
      if (Doors?.open) { Doors.open(door, { by: ent.role || 'human' }); return true; }
      if (Doors?.toggle) { Doors.toggle(door, { by: ent.role || 'human' }); return true; }
      door.open = true;
      door.walkable = true;
      door.solid = false;
      door._autoCloseAt = nowMs() + 2000;
      return true;
    } catch (_) {}
    return false;
  }

  function tryUseElevator(ent, elevator, targetFloor) {
    if (!elevator) return false;
    if (typeof targetFloor === 'string' && W.Entities?.Elevator?.forceActivate) {
      try { W.Entities.Elevator.forceActivate(targetFloor); return true; }
      catch (_) { return false; }
    }
    if (elevator.pairId && W.Entities?.Elevator?.forceActivate) {
      try { W.Entities.Elevator.forceActivate(elevator.pairId); return true; }
      catch (_) { return false; }
    }
    if (W.Entities?.Elevator?.travel) {
      try { W.Entities.Elevator.travel(elevator); return true; }
      catch (_) { return false; }
    }
    return false;
  }

  function isPushable(ent) {
    if (!ent || ent.dead) return false;
    if (ent.static) return false;
    if (ent.pushable) return true;
    const kind = String(ent.kindName || ent.type || '').toLowerCase();
    return kind.includes('cart') || kind.includes('bed') || kind.includes('carro');
  }

  function tryPush(ent, target, ctx) {
    if (!isPushable(target)) return false;
    const dir = normalize(target.x + (target.w || TILE) * 0.5 - (ent.x + ent.w * 0.5), target.y + (target.h || TILE) * 0.5 - (ent.y + ent.h * 0.5));
    const impulse = ctx.pushImpulse * (ctx.role === 'celador' ? 1.25 : 1);
    target.vx = (target.vx || 0) + dir.x * impulse;
    target.vy = (target.vy || 0) + dir.y * impulse;
    target.pushedBy = ent.id || ent.role;
    return true;
  }

  function isIgnoredItemName(name, ctx) {
    if (!name) return false;
    const lower = String(name).toLowerCase();
    return (ctx.ignoredItems || []).some((ignore) => lower.includes(String(ignore).toLowerCase()));
  }

  function findItemTarget(ent, ctx) {
    const list = Array.isArray(G.objects) ? G.objects : G.entities || [];
    return findNearest(list, ent, (obj) => {
      if (!obj || obj.dead) return false;
      if (obj.pickup === false) return false;
      const name = obj.name || obj.id || obj.kindName || obj.kind;
      if (isIgnoredItemName(name, ctx)) return false;
      const kind = String(obj.kindName || obj.type || '').toLowerCase();
      if (kind.includes('pill')) return false;
      return true;
    });
  }

  function pickDoorBlocking(ent) {
    const list = Array.isArray(G.doors) ? G.doors : (G.entities || []);
    const c = entityCenter(ent);
    return findNearest(list, ent, (door) => {
      if (!door || door.dead) return false;
      if (!isDoor(door)) return false;
      if (isDoorWalkable(door)) return false;
      const dx = Math.abs((door.x + door.w * 0.5) - c.x);
      const dy = Math.abs((door.y + door.h * 0.5) - c.y);
      return Math.max(dx, dy) < TILE * 1.2;
    });
  }

  function pickElevator(ent) {
    const list = Array.isArray(G.elevators) ? G.elevators : (G.entities || []);
    const c = entityCenter(ent);
    return findNearest(list, ent, (ev) => {
      if (!isElevator(ev)) return false;
      const dx = Math.abs((ev.x + ev.w * 0.5) - c.x);
      const dy = Math.abs((ev.y + ev.h * 0.5) - c.y);
      return Math.max(dx, dy) < TILE * 1.0;
    });
  }

  function ensureInCollections(ent) {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!G.entities.includes(ent)) G.entities.push(ent);
    if (!Array.isArray(G.humans)) G.humans = [];
    if (!G.humans.includes(ent)) G.humans.push(ent);
  }

  function attach(ent, config = {}) {
    if (!ent) return ent;
    const ctx = Object.assign({}, DEFAULTS, config || {});
    ent.humanAI = ctx;
    ctx.state = HumanState.IDLE;
    ctx.stateSince = nowMs();
    ctx.lastDecisionAt = 0;
    ctx.path = null;
    ctx.pathIndex = 0;
    ctx._blockedAccum = 0;
    ctx._lastAdvance = nowMs();
    ctx._lastTargetRefresh = 0;
    ctx._talkUntil = 0;
    ctx._nextElevatorUseAt = 0;
    ensurePatrolPoints(ent, ctx);
    ensureInCollections(ent);
    tracked.add(ent);
    ent.group = ent.group || 'human';
    ent.solid = true;
    ent.dynamic = true;
    ent.maxSpeed = Math.max(ctx.chaseSpeed, ctx.patrolSpeed) * 1.1;
    if (!ent.id) ent.id = `hum_${Math.random().toString(36).slice(2, 9)}`;
    updateOccupancy(ent);
    try { W.AI?.attach?.(ent, 'HUMAN_AI'); } catch (_) {}
    window.MovementSystem?.register?.(ent);
    return ent;
  }

  function detach(ent) {
    if (!ent) return;
    tracked.delete(ent);
    clearOccupancy(ent);
    if (Array.isArray(G.humans)) G.humans = G.humans.filter((h) => h !== ent);
  }

  function refreshState(ent, ctx, dt) {
    const player = G.player;
    if (!player || player.dead) {
      if (ctx.canPatrol && ctx._patrol && ctx._patrol.length) {
        setState(ent, ctx, HumanState.PATROL);
      } else {
        setState(ent, ctx, HumanState.IDLE);
      }
      return;
    }
    const center = entityCenter(ent);
    const d2 = dist2(center.x, center.y, player.x + player.w * 0.5, player.y + player.h * 0.5);
    const detection = ctx.detectionRadius || (6 * TILE);
    if (d2 <= detection * detection && hasLineOfSight(ent, player)) {
      setState(ent, ctx, HumanState.CHASE_PLAYER);
      ctx.targetEntity = player;
      return;
    }
    if (ctx.canSeekItems) {
      const now = nowMs();
      if (!ctx.itemTarget || now - ctx._lastTargetRefresh > ctx.targetRefreshMs) {
        ctx.itemTarget = findItemTarget(ent, ctx);
        ctx._lastTargetRefresh = now;
      }
      if (ctx.itemTarget) {
        setState(ent, ctx, HumanState.SEEK_ITEM);
        return;
      }
    }
    if (ctx.canPush) {
      const pushables = findNearest(G.entities, ent, (it) => isPushable(it));
      if (pushables) {
        ctx.pushTarget = pushables;
        setState(ent, ctx, HumanState.PUSH_OBJECT);
        return;
      }
    }
    if (ctx.canPatrol && ctx._patrol && ctx._patrol.length) {
      setState(ent, ctx, HumanState.PATROL);
    } else {
      setState(ent, ctx, HumanState.IDLE);
    }
  }

  function tickState(ent, ctx, dt) {
    switch (ctx.state) {
      case HumanState.IDLE:
        stopMovement(ent);
        ctx._blockedAccum = 0;
        break;
      case HumanState.PATROL:
        ensurePatrolPoints(ent, ctx);
        if (!ctx._patrol || !ctx._patrol.length) {
          setState(ent, ctx, HumanState.IDLE);
          break;
        }
        const target = ctx._patrol[ctx._patrolIndex];
        moveTowards(ent, ctx, target, ctx.patrolSpeed, dt);
        if (reached(ent, target)) {
          ctx._blockedAccum = 0;
          ctx._patrolIndex += ctx._patrolDir;
          if (ctx.patrolLoop) {
            ctx._patrolIndex = ctx._patrolIndex % ctx._patrol.length;
          } else {
            if (ctx._patrolIndex >= ctx._patrol.length || ctx._patrolIndex < 0) {
              ctx._patrolDir *= -1;
              ctx._patrolIndex = clamp(ctx._patrolIndex, 0, ctx._patrol.length - 1);
            }
          }
        }
        break;
      case HumanState.CHASE_PLAYER:
        if (!ctx.targetEntity || ctx.targetEntity.dead) {
          refreshState(ent, ctx, dt);
          break;
        }
        moveTowards(ent, ctx, entityCenter(ctx.targetEntity), ctx.chaseSpeed, dt);
        break;
      case HumanState.SEEK_ITEM:
        if (!ctx.itemTarget || ctx.itemTarget.dead) {
          ctx.itemTarget = null;
          refreshState(ent, ctx, dt);
          break;
        }
        moveTowards(ent, ctx, entityCenter(ctx.itemTarget), ctx.seekSpeed, dt);
        if (reached(ent, entityCenter(ctx.itemTarget))) {
          ctx.itemTarget.collectedBy = ent.id;
          if (typeof ctx.itemTarget.onCollect === 'function') {
            try { ctx.itemTarget.onCollect(ent); } catch (_) {}
          }
          ctx.itemTarget.dead = true;
          ctx.itemTarget = null;
          refreshState(ent, ctx, dt);
        }
        break;
      case HumanState.PUSH_OBJECT:
        if (!ctx.pushTarget || ctx.pushTarget.dead) {
          ctx.pushTarget = null;
          refreshState(ent, ctx, dt);
          break;
        }
        if (!reached(ent, entityCenter(ctx.pushTarget), TILE * 0.4)) {
          moveTowards(ent, ctx, entityCenter(ctx.pushTarget), ctx.pushSpeed, dt);
        } else {
          stopMovement(ent);
          tryPush(ent, ctx.pushTarget, ctx);
        }
        break;
      case HumanState.USE_DOOR:
        stopMovement(ent);
        const door = pickDoorBlocking(ent);
        if (!door) {
          refreshState(ent, ctx, dt);
          break;
        }
        tryUseDoor(ent, door);
        setState(ent, ctx, HumanState.IDLE);
        break;
      case HumanState.USE_ELEVATOR:
        stopMovement(ent);
        if (ctx._nextElevatorUseAt && nowMs() < ctx._nextElevatorUseAt) break;
        const elevator = pickElevator(ent);
        if (elevator) {
          if (tryUseElevator(ent, elevator, ctx.requestedFloor)) {
            ctx._nextElevatorUseAt = nowMs() + ctx.elevatorCooldownMs;
          }
        }
        setState(ent, ctx, HumanState.IDLE);
        break;
      case HumanState.TALKING:
        stopMovement(ent);
        if (nowMs() > ctx._talkUntil) {
          setState(ent, ctx, HumanState.IDLE);
        }
        break;
      case HumanState.STUNNED:
        stopMovement(ent);
        if (ctx.stunnedUntil && nowMs() > ctx.stunnedUntil) {
          setState(ent, ctx, HumanState.IDLE);
        }
        break;
      case HumanState.BLOCKED:
        stopMovement(ent);
        if (!ctx._blockedProbeAt || nowMs() - ctx._blockedProbeAt > ctx.unblockProbeMs) {
          ctx._blockedProbeAt = nowMs();
          // Mira alrededor a ver si hay casilla libre
          const c = entityCenter(ent);
          const around = [
            { x: c.x + TILE, y: c.y },
            { x: c.x - TILE, y: c.y },
            { x: c.x, y: c.y + TILE },
            { x: c.x, y: c.y - TILE }
          ];
          const free = around.some((p) => !isWallTile(toTile(p.x), toTile(p.y)));
          if (free) {
            ctx._blockedAccum = 0;
            setState(ent, ctx, HumanState.IDLE);
          }
        }
        break;
      case HumanState.DEAD:
        stopMovement(ent);
        detach(ent);
        break;
    }
  }

  function update(ent, dt) {
    if (!ent || ent.dead) {
      detach(ent);
      return;
    }
    const ctx = ent.humanAI;
    if (!ctx) return;
    if (ctx.state === HumanState.DEAD) {
      detach(ent);
      return;
    }
    updateOccupancy(ent);
    if (ctx.health != null && ctx.health <= 0) {
      setState(ent, ctx, HumanState.DEAD);
      return;
    }
    if (ctx.state === HumanState.STUNNED && ctx.stunnedUntil && nowMs() < ctx.stunnedUntil) {
      tickState(ent, ctx, dt);
      return;
    }
    const doorBlocking = ctx.canUseDoors ? pickDoorBlocking(ent) : null;
    if (doorBlocking) {
      setState(ent, ctx, HumanState.USE_DOOR);
      tickState(ent, ctx, dt);
      return;
    }
    if (ctx.canUseElevators && ctx.wantElevator && (!ctx._nextElevatorUseAt || nowMs() > ctx._nextElevatorUseAt)) {
      setState(ent, ctx, HumanState.USE_ELEVATOR);
      tickState(ent, ctx, dt);
      return;
    }
    refreshState(ent, ctx, dt);
    tickState(ent, ctx, dt);
    handlePlayerContact(ent, ctx, G.player);
  }

  function updateAll(state, dt) {
    const list = Array.isArray(state?.entities) ? state.entities : Array.from(tracked);
    for (const ent of list) {
      try {
        update(ent, dt || 0);
      } catch (err) {
        if (W.DEBUG_FORCE_ASCII) console.warn('[HumanAI] update error', err);
      }
    }
  }

  const HumanAI = {
    HumanState,
    attach,
    detach,
    update,
    updateAll,
    tryUseDoor,
    tryUseElevator,
    tryPush,
    trySeekItem(ent, ctx) {
      return findItemTarget(ent, ctx || ent?.humanAI || {});
    }
  };

  if (!W.HumanAI) W.HumanAI = HumanAI;
  if (W.AI && typeof W.AI.register === 'function') {
    W.AI.register('HUMAN_AI', (ent, Gref, dt) => HumanAI.update(ent, dt));
  }
  if (W.AI && typeof W.AI.registerSystem === 'function') {
    W.AI.registerSystem('HUMAN_AI', (Gref, dt) => HumanAI.updateAll(Gref || G, dt));
  }
})(window);
