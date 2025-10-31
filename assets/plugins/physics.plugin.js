(() => {
  'use strict';

  const bodies = new Set();
  let bodyIndex = new WeakMap();
  let currentMap = null;
  let tileSize = 32;

  function getBody(entity) {
    return bodyIndex.get(entity) || null;
  }

  function getAABB(entity) {
    const w = entity.width || tileSize * 0.8;
    const h = entity.height || tileSize * 0.8;
    return {
      minX: entity.x - w * 0.5,
      maxX: entity.x + w * 0.5,
      minY: entity.y - h * 0.5,
      maxY: entity.y + h * 0.5,
      width: w,
      height: h
    };
  }

  function aabbOverlap(a, b) {
    return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
  }

  function collidesWithMap(body) {
    if (!currentMap || !body.solid) return false;
    const entity = body.entity;
    const box = getAABB(entity);
    const startCol = Math.floor(box.minX / tileSize);
    const endCol = Math.floor((box.maxX - 1) / tileSize);
    const startRow = Math.floor(box.minY / tileSize);
    const endRow = Math.floor((box.maxY - 1) / tileSize);
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        if (MapGen.isWall(currentMap, col, row)) {
          return true;
        }
      }
    }
    return false;
  }

  function detectCollisions(body) {
    const hits = { map: false, bodies: [] };
    if (collidesWithMap(body)) {
      hits.map = true;
    }
    const box = getAABB(body.entity);
    bodies.forEach((other) => {
      if (other === body) return;
      if (!other.solid) return;
      const otherBox = getAABB(other.entity);
      if (aabbOverlap(box, otherBox)) {
        hits.bodies.push(other);
      }
    });
    if (!hits.map && hits.bodies.length === 0) {
      return null;
    }
    return hits;
  }

  function attemptMove(body, axis, delta, visited = new Set(), depth = 0) {
    if (!delta) return 0;
    if (depth > 4) return 0;
    const entity = body.entity;
    const sign = delta > 0 ? 1 : -1;
    const maxStep = Math.max(tileSize / 6, 4);
    let remaining = Math.abs(delta);
    let moved = 0;
    visited.add(body);

    while (remaining > 0) {
      const step = Math.min(maxStep, remaining);
      entity[axis] += step * sign;
      const collisions = detectCollisions(body);
      if (!collisions) {
        moved += step * sign;
        remaining -= step;
        continue;
      }

      let resolved = false;
      if (collisions.bodies.length) {
        resolved = true;
        for (const other of collisions.bodies) {
          if (!body.canPush || !other.movable || visited.has(other)) {
            resolved = false;
            break;
          }
          const pushed = attemptMove(other, axis, step * sign, visited, depth + 1);
          if (Math.abs(pushed - step * sign) > 0.001) {
            resolved = false;
            break;
          }
        }
      }

      if (resolved && !collisions.map) {
        moved += step * sign;
        remaining -= step;
        continue;
      }

      entity[axis] -= step * sign;
      break;
    }

    visited.delete(body);
    return moved;
  }

  function tryEpsilonSlide(body, desiredX, desiredY, movedX, movedY) {
    if (!desiredX || !desiredY) return;
    if (Math.abs(movedX) >= Math.abs(desiredX) || Math.abs(movedY) >= Math.abs(desiredY)) return;
    const epsilon = tileSize * 0.2 * Math.sign(desiredX || desiredY);
    if (Math.abs(desiredX) > Math.abs(desiredY)) {
      attemptMove(body, 'y', Math.sign(desiredY || 0) * Math.abs(epsilon));
    } else {
      attemptMove(body, 'x', Math.sign(desiredX || 0) * Math.abs(epsilon));
    }
  }

  const PhysicsAPI = {
    init(map) {
      currentMap = map || null;
      tileSize = map?.tileSize || tileSize;
    },
    setMap(map) {
      currentMap = map;
      tileSize = map?.tileSize || tileSize;
    },
    registerBody(entity, options = {}) {
      if (!entity) return null;
      const body = {
        entity,
        solid: options.solid !== false,
        movable: !!options.movable,
        canPush: !!options.canPush,
        weight: options.weight || 1,
        friction: options.friction ?? 0.9
      };
      bodies.add(body);
      bodyIndex.set(entity, body);
      return body;
    },
    unregisterBody(entity) {
      const body = getBody(entity);
      if (!body) return;
      bodies.delete(body);
      bodyIndex.delete(entity);
    },
    clear() {
      bodies.clear();
      bodyIndex = new WeakMap();
    },
    setSolid(entity, solid) {
      const body = getBody(entity);
      if (body) {
        body.solid = !!solid;
      }
      if (entity) entity.solid = !!solid;
    },
    update(dt) {
      bodies.forEach((body) => {
        const entity = body.entity;
        const desiredX = (entity.vx || 0) * dt;
        const desiredY = (entity.vy || 0) * dt;
        const movedX = attemptMove(body, 'x', desiredX);
        if (Math.abs(movedX) < Math.abs(desiredX)) {
          entity.vx = 0;
        }
        const movedY = attemptMove(body, 'y', desiredY);
        if (Math.abs(movedY) < Math.abs(desiredY)) {
          entity.vy = 0;
        }
        tryEpsilonSlide(body, desiredX, desiredY, movedX, movedY);
      });
    }
  };

  window.PhysicsAPI = PhysicsAPI;
})();
