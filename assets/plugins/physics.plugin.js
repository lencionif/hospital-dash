// physics.plugin.js
(() => {
  'use strict';

  let G = null;                  // estado del juego
  let TILE = 32;                 // fallback si no hay window.TILE_SIZE
  const CFG = {                  // valores por defecto; override en init()
    restitution: 0.12,           // tope global de rebote
    friction: 0.045,             // rozamiento estándar
    slideFriction: 0.020,        // mojado pero controlable
    crushImpulse: 110,
    hurtImpulse: 45,
    explodeImpulse: 170
  };

  // ---------- Utilidades ----------
  const AABB = (a,b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  const nearAABB = (a,b,m=10) =>
    a.x < b.x + b.w + m && a.x + a.w > b.x - m &&
    a.y < b.y + b.h + m && a.y + a.h > b.y - m;

  function isWall(px,py,w,h){
    // si game.js expuso isWallAt, úsalo
    if (typeof window.isWallAt === 'function') return window.isWallAt(px,py,w,h);
    // fallback con G.map
    const x1 = Math.floor(px / TILE);
    const y1 = Math.floor(py / TILE);
    const x2 = Math.floor((px+w) / TILE);
    const y2 = Math.floor((py+h) / TILE);
    if (!G || !G.map || x1<0 || y1<0 || x2>=G.mapW || y2>=G.mapH) return true;
    return G.map[y1][x1]===1 || G.map[y1][x2]===1 || G.map[y2][x1]===1 || G.map[y2][x2]===1;
  }

  function resolveOverlapPush(e, o){
    const ax1=e.x, ay1=e.y, ax2=e.x+e.w, ay2=e.y+e.h;
    const bx1=o.x, by1=o.y, bx2=o.x+o.w, by2=o.y+o.h;
    const overlapX = (ax2 - bx1 < bx2 - ax1) ? ax2 - bx1 : -(bx2 - ax1);
    const overlapY = (ay2 - by1 < by2 - ay1) ? ay2 - by1 : -(by2 - ay1);
    if (Math.abs(overlapX) < Math.abs(overlapY)){
      e.x -= overlapX;
      if (e.pushable && o.pushable){ const t=e.vx; e.vx=o.vx; o.vx=t; } else { e.vx = 0; }
    } else {
      e.y -= overlapY;
      if (e.pushable && o.pushable){ const t=e.vy; e.vy=o.vy; o.vy=t; } else { e.vy = 0; }
    }
  }

  function clampOutOfWalls(e){
      // Saca al objeto probando 4 direcciones; NO depende de la velocidad (evita “enganche”).
      let tries = 12;
      const STEP = 1.0;
      while (tries-- > 0 && isWall(e.x, e.y, e.w, e.h)){
        // Prueba derecha, izquierda, abajo, arriba (elige la 1ª libre)
        if (!isWall(e.x + STEP, e.y, e.w, e.h))      { e.x += STEP; continue; }
        if (!isWall(e.x - STEP, e.y, e.w, e.h))      { e.x -= STEP; continue; }
        if (!isWall(e.x, e.y + STEP, e.w, e.h))      { e.y += STEP; continue; }
        if (!isWall(e.x, e.y - STEP, e.w, e.h))      { e.y -= STEP; continue; }
        // Si todas fallan, aumenta paso y vuelve a intentar (pequeño “escape” controlado)
        if (!isFinite(e._clampGrow)) e._clampGrow = 1;
        e._clampGrow = Math.min(e._clampGrow + 0.5, TILE * 0.5);
        const g = e._clampGrow;
        e.x += (Math.random() < 0.5 ? -g : g);
        e.y += (Math.random() < 0.5 ? -g : g);
      }
      // Guarda último punto seguro
      if (!isWall(e.x, e.y, e.w, e.h)) { e._lastSafeX = e.x; e._lastSafeY = e.y; }
    }

  function snapInsideMap(e){
    if (!G || !e) return;

    const inBounds = (tx,ty)=> tx>=0 && ty>=0 && tx<G.mapW && ty<G.mapH;

    if (inBounds(Math.floor(e.x/TILE), Math.floor(e.y/TILE)) &&
        !isWall(e.x,e.y,e.w,e.h)) return;

    if (typeof e._lastSafeX === 'number' && typeof e._lastSafeY === 'number'){
      e.x = e._lastSafeX; e.y = e._lastSafeY; e.vx = e.vy = 0;
      if (!isWall(e.x,e.y,e.w,e.h)) return;
    }

    const cx = Math.max(0, Math.min(G.mapW-1, Math.floor(e.x/TILE)));
    const cy = Math.max(0, Math.min(G.mapH-1, Math.floor(e.y/TILE)));
    for (let r=0;r<6;r++){
      for (let dy=-r; dy<=r; dy++){
        for (let dx=-r; dx<=r; dx++){
          const tx=cx+dx, ty=cy+dy;
          if (!inBounds(tx,ty)) continue;
          if (G.map[ty][tx]===0){ e.x=tx*TILE+2; e.y=ty*TILE+2; e.vx=e.vy=0; return; }
        }
      }
    }
  }

  // Daño/muerte por carro (incluye llamada opcional a damagePlayer si la expusieras)
  function cartImpactDamage(a, b){
    // Si tu "kind" del carro es 5 (como en el motor), lo detecta; si no, puedes
    // cambiarlo o añadir un flag "isCart" a la entidad y comprobar eso.
    const cart = (a && a.kind===5) ? a : (b && b.kind===5 ? b : null);
    if (!cart) return;
    const other = (cart===a) ? b : a;

    const spdC  = Math.hypot(cart.vx||0, cart.vy||0);
    const rel   = Math.hypot((cart.vx||0)-(other.vx||0), (cart.vy||0)-(other.vy||0));
    const nearW = isWall(other.x-1, other.y-1, other.w+2, other.h+2);

    const MIN_ENEMY_KILL_SPEED  = 6;
    const MIN_PLAYER_HURT_SPEED = 22;

    if (spdC<=0.01 && rel<=0.01 && !nearW) return;

    if (G && other===G.player){
      if (spdC>MIN_PLAYER_HURT_SPEED || rel>MIN_PLAYER_HURT_SPEED){
        if (rel>360) { window.damagePlayer?.(cart,6); return; }
        if (rel>240) { window.damagePlayer?.(cart,2); return; }
        if (rel>120) { window.damagePlayer?.(cart,1); return; }
      }
      return;
    }
    if (other.static) return;

    if (spdC>MIN_ENEMY_KILL_SPEED || rel>MIN_ENEMY_KILL_SPEED || nearW){
        // si expusieras un kill utilitario, úsalo; si no, marca dead
        const meta = {
        via: 'cart',
        impactSpeed: Math.max(spdC, rel),
        killerTag: (cart._lastPushedBy || null),
        killerId:  (cart._lastPushedId || null),
        killerRef: (cart._pushedByEnt || cart._grabbedBy || null)
      };
      window.killEntityGeneric ? window.killEntityGeneric(other, meta) : (other.dead = true);
    }
  }

  // ---------- Núcleo “idéntico a game.js” pero en el plugin ----------
  function moveWithCollisions(e, dt){
    const sub  = 4;
    const base = 1 - (CFG.friction ?? 0.02);          // usa fricción global
    const fr   = base * (1 - (e.mu ?? 0));            // respeta fricción local si la hay
    const wr   = Math.max(CFG.restitution, e.rest || 0); // usa la mayor restitución disponible

    let nx = e.x, ny = e.y;

    for (let i=0;i<sub;i++){
      const sx = (e.vx||0)/sub;
      const sy = (e.vy||0)/sub;

      // Padding extra para el HÉROE en huecos 1-tile
      const pad = (G && e === G.player) ? 6 : 4;
      const cw = Math.max(2, (e.w - pad*2));
      const ch = Math.max(2, (e.h - pad*2));

      // Eje X
      const tryX = nx + sx;
      if (!isWall(tryX+4, ny+4, e.w-8, e.h-8)) {
        nx = tryX;
      } else {
        const v = - (e.vx || 0) * wr;
        e.vx = (Math.abs(v) < 10) ? (v >= 0 ? 10 : -10) : v; // mini-impulso de salida
        // micro-corrección de 1px hacia fuera del muro
        const s = Math.sign(e.vx || 1);
        if (!isWall(nx + s, ny, e.w, e.h)) nx += s;
      }

      // Eje Y
      const tryY = ny + sy;
      if (!isWall(nx+4, tryY+4, e.w-8, e.h-8)) {
        ny = tryY;
      } else {
        const v = - (e.vy || 0) * wr;
        e.vy = (Math.abs(v) < 10) ? (v >= 0 ? 10 : -10) : v; // mini-impulso de salida
        const s = Math.sign(e.vy || 1);
        if (!isWall(nx, ny + s, e.w, e.h)) ny += s;
      }
    }

    e.x = nx; e.y = ny;

    if (!isWall(e.x, e.y, e.w, e.h)) { e._lastSafeX = e.x; e._lastSafeY = e.y; }

    e.vx *= fr; e.vy *= fr;

    // Si por algún motivo quedó dentro de pared → saca o teleporta cerca
    if (isWall(e.x, e.y, e.w, e.h)) {
      clampOutOfWalls(e);
      if (isWall(e.x, e.y, e.w, e.h)) snapInsideMap(e);
    }

    if (Math.abs(e.vx) < 0.001) e.vx = 0;
    if (Math.abs(e.vy) < 0.001) e.vy = 0;
  }

  function resolveAgainstSolids(e){
    if (!G) return;
    for (const o of G.entities){
      if (o===e || !o.solid || o.dead) continue;

      // contacto (margen)
      if (!nearAABB(e, o, 2)) continue;

      // daño/muerte por carro aunque no haya solape real
      cartImpactDamage(e, o);

      // si NO hay solape, no hace falta separación
      if (!AABB(e, o)) continue;

      // resolución mínima
      resolveOverlapPush(e, o);
      clampOutOfWalls(e);
      snapInsideMap(e);
    }
    snapInsideMap(e);
  }

  function resolveEntityPairs(dt){
    if (!G) return;

    const dyn = G.entities.filter(e =>
      e && !e.static && !e.dead && (e.solid || e.pushable || e.dynamic ||
      ((Math.abs(e.vx||0) + Math.abs(e.vy||0)) > 0))
    );

    for (let i=0; i<dyn.length; i++){
      for (let k=i+1; k<dyn.length; k++){
        const a = dyn[i], b = dyn[k];

        if (!nearAABB(a,b,2)) continue;

        // lógica inmediata “segura”
        cartImpactDamage(a, b);

        if (!AABB(a, b)) continue;

        const ax=a.x+a.w*0.5, ay=a.y+a.h*0.5;
        const bx=b.x+b.w*0.5, by=b.y+b.h*0.5;
        const penX=(a.w*0.5 + b.w*0.5) - Math.abs(ax-bx);
        const penY=(a.h*0.5 + b.h*0.5) - Math.abs(ay-by);
        if (penX<=0 || penY<=0) continue;

        let nx=0, ny=0;
        if (penX < penY){ nx = (ax < bx ? -1 : 1); }
        else            { ny = (ay < by ? -1 : 1); }

        const invA = (a.invMass != null) ? a.invMass : (a.mass ? 1/Math.max(1, a.mass) : 1);
        const invB = (b.invMass != null) ? b.invMass : (b.mass ? 1/Math.max(1, b.mass) : 1);
        const invSum = invA + invB;
        if (invSum === 0) continue;

        const pen = (penX < penY ? penX : penY);
        const SLOP = 0.001;
        const MAX_PUSH = TILE * 0.45;
        const corr = (pen + SLOP) / invSum;
        const corrA = Math.min(corr * invA, MAX_PUSH);
        const corrB = Math.min(corr * invB, MAX_PUSH);

        a.x += nx * corrA; a.y += ny * corrA;
        b.x -= nx * corrB; b.y -= ny * corrB;

        // impulso (rebote) limitado
        const rvx = (a.vx||0) - (b.vx||0);
        const rvy = (a.vy||0) - (b.vy||0);
        const velN = rvx * nx + rvy * ny;
        if (velN < 0){
          const rest = Math.max(CFG.restitution, a.rest||0, b.rest||0); // base pinball
          let j = -(1 + rest) * velN / invSum;
          // tope más alto para “punch” pinball (sin irse de madre)
          j = Math.max(-1200, Math.min(1200, j));
          const ix = j * nx, iy = j * ny;
          a.vx += ix * invA; a.vy += iy * invA;
          b.vx -= ix * invB; b.vy -= iy * invB;
        }

        if (isWall(a.x,a.y,a.w,a.h)) snapInsideMap(a);
        if (isWall(b.x,b.y,b.w,b.h)) snapInsideMap(b);
        if (!isWall(a.x,a.y,a.w,a.h)) { a._lastSafeX=a.x; a._lastSafeY=a.y; }
        if (!isWall(b.x,b.y,b.w,b.h)) { b._lastSafeX=b.x; b._lastSafeY=b.y; }
      }
    }
  }

  function step(dt){
    if (!G) return;

    // mueve TODO lo dinámico (jugador incluido)
    for (const e of G.entities){
      if (!e || e.dead || e.static) continue;
      moveWithCollisions(e, dt);
      resolveAgainstSolids(e);
    }
    // y ahora separaciones e impulsos entre pares
    resolveEntityPairs(dt);
  }

  // ---------- API pública ----------
  function applyImpulse(e, ix, iy){
    if (!e || e.static) return;
    const inv = (e.invMass != null) ? e.invMass : (e.mass ? 1/Math.max(1, e.mass) : 1);
    e.vx = (e.vx||0) + ix * inv;
    e.vy = (e.vy||0) + iy * inv;
  }
  function init(opts={}){
    Object.assign(CFG, opts||{});
    TILE = window.TILE_SIZE || TILE;
    return api;
  }
  function bindGame(game){
    G = game;
    TILE = window.TILE_SIZE || TILE;
    return api;
  }

  const api = {
    init, bindGame, step,
    moveWithCollisions,
    resolveAgainstSolids,
    resolveEntityPairs,
    snapInsideMap,
    applyImpulse
  };

  window.Physics = api;
})();
