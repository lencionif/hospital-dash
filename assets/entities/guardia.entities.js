// filename: guardia.entities.js
// Guardia — Cierra puertas del mapa. Si ve a un héroe empujar un carro, lo persigue un rato.
// - Independiente del resto de módulos; usa guards y fallbacks.
// - Soporta puertas del sistema Entities.Door (abiertas/cerradas/boss).
// - Abre puertas para pasar y las cierra detrás (si no son boss).
// - Pathfinding 4-dir por tiles (BFS) + LOS (línea de visión) contra muros.
// - Estados: PATROL -> (CLOSE_DOOR) -> PURSUE (si héroe empuja carro) -> PATROL.
// - Varias guardias cooperan compartiendo “broadcast” del último héroe empujando.

(function () {
  'use strict';

  const W = window;
  const G = W.G || (W.G = {});
  const ENT = (function () {
    const e = W.ENT || (W.ENT = {});
    e.GUARD   = e.GUARD   ?? 42;
    e.PLAYER  = e.PLAYER  ?? 1;
    e.CART    = e.CART    ?? 5;     // coherente con carts.entities.js
    e.DOOR    = e.DOOR    ?? 30;
    return e;
  })();
  const TILE = (W.TILE_SIZE || W.TILE || 32);

  // ========================= Utilidades de entorno =========================
  function pushUnique(list, it){ if (!list) return; if (!list.includes(it)) list.push(it); }
  function aabb(a,b){ return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  function len2(dx,dy){ return dx*dx + dy*dy; }
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }
  function t2px(tx,ty){ return { x: tx*TILE + (TILE*0.5), y: ty*TILE + (TILE*0.5) }; }
  function px2t(x,y){ return { tx: (x/TILE|0), ty:(y/TILE|0) }; }
  function isWallTile(tx,ty){
    const m = G.map || [];
    return !m[ty] || m[ty][tx] === 1;
  }
  function canWalk(tx,ty){ return !isWallTile(tx,ty); }

  // Movimiento con colisión (usa tu motor si existe; si no, fallback)
  function tryMove(e, dt){
    if (typeof W.moveWithCollisions === 'function') {
      W.moveWithCollisions(e, dt);
      if (typeof W.resolveAgainstSolids === 'function') W.resolveAgainstSolids(e);
      return;
    }
    // Fallback: barrido sencillo por ejes
    const sub = 3;
    for (let i=0;i<sub;i++){
      const sx=(e.vx||0)*dt/sub, sy=(e.vy||0)*dt/sub;
      const nx = e.x + sx, ny = e.y + sy;
      // chequear muro por rectángulo
      const hit = rectHitsWall(nx, e.y, e.w, e.h) || rectHitsWall(e.x, ny, e.w, e.h);
      if (!hit){ e.x = nx; e.y = ny; }
      else { e.vx *= 0.2; e.vy *= 0.2; }
    }
  }
  function rectHitsWall(x,y,w,h){
    const gx0=(x/TILE|0), gy0=(y/TILE|0);
    const gx1=((x+w-1)/TILE|0), gy1=((y+h-1)/TILE|0);
    for (let gy=gy0; gy<=gy1; gy++){
      for (let gx=gx0; gx<=gx1; gx++){
        if (isWallTile(gx,gy)) return true;
      }
    }
    return false;
  }

  // BFS 4-dir para pathfinding por tiles
  function bfsPath(map, sx,sy, tx,ty, maxNodes=4000){
    const H = map.length, Wd = map[0]?.length||0;
    if (sx===tx && sy===ty) return [{tx,ty}];
    const inb = (x,y)=> y>=0 && y<H && x>=0 && x<Wd;
    const key = (x,y)=> (y<<16)|x;
    const q = [], prev = new Map(), vis = new Set();
    q.push([sx,sy]); vis.add(key(sx,sy));
    const N4=[[1,0],[-1,0],[0,1],[0,-1]];
    let nodes=0;
    while(q.length && nodes<maxNodes){
      nodes++;
      const [x,y] = q.shift();
      for (const[dX,dY] of N4){
        const nx=x+dX, ny=y+dY;
        if (!inb(nx,ny) || isWallTile(nx,ny)) continue;
        const k=key(nx,ny); if (vis.has(k)) continue;
        prev.set(k,[x,y]); vis.add(k); q.push([nx,ny]);
        if (nx===tx && ny===ty){
          // reconstruye
          const path=[{tx,ty}];
          let cx=tx, cy=ty;
          while (!(cx===sx && cy===sy)){
            const p = prev.get(key(cx,cy)); if (!p) break;
            path.push({tx:p[0], ty:p[1]});
            cx=p[0]; cy=p[1];
          }
          path.reverse();
          return path;
        }
      }
    }
    return null; // sin camino
  }

  // LOS (raycast discreto) contra muros
  function hasLineOfSight(ax,ay, bx,by){
    // Bresenham simplificado en tiles
    const A = px2t(ax,ay), B = px2t(bx,by);
    let x0=A.tx, y0=A.ty, x1=B.tx, y1=B.ty;
    const dx = Math.abs(x1-x0), sx = x0<x1?1:-1;
    const dy = -Math.abs(y1-y0), sy = y0<y1?1:-1;
    let err = dx + dy;
    while(true){
      if (isWallTile(x0,y0)) return false;
      if (x0===x1 && y0===y1) break;
      const e2 = 2*err;
      if (e2 >= dy){ err += dy; x0 += sx; }
      if (e2 <= dx){ err += dx; y0 += sy; }
    }
    return true;
  }

  // ========================= Percepción & objetivos =========================
  function listDoors(){
    // Preferimos G.doors (entities), si no, hacemos un escaneo aproximado del ASCII si existiera.
    if (Array.isArray(G.doors) && G.doors.length) return G.doors.slice();
    return []; // mantenlo simple: el MapGen ya colocará por placement → Entities.Door.spawn
  }

  function findOpenDoors(){
    const ds = listDoors();
    return ds.filter(d => d && d.kind===ENT.DOOR && d.open && !d.isBossDoor);
  }

  function findNearestOpenDoorPx(e){
    const opens = findOpenDoors();
    if (!opens.length) return null;
    let best=null, bd2=1e12;
    for (const d of opens){
      const cx = d.x + d.w*0.5, cy = d.y + d.h*0.5;
      const d2 = len2(cx - (e.x+e.w*0.5), cy - (e.y+e.h*0.5));
      if (d2<bd2){ bd2=d2; best=d; }
    }
    return best;
  }

  // Héroe empujando carro: heurística robusta (sirve aunque no tengas flag .pushing)
  function isHeroPushingCart(hero){
    if (!hero) return false;
    // si tu motor marca e.pushing → úsalo
    if (hero.pushing === true) return true;

    // heurística: si hay un CART muy cerca y ese cart tiene velocidad apreciable
    const carts = (G.entities||[]).filter(o => o && o.kind===ENT.CART && !o.dead);
    const H2 = TILE*TILE*2.0; // ~√(2)*TILE de radio
    for (const c of carts){
      const dx = (c.x + c.w*0.5) - (hero.x + hero.w*0.5);
      const dy = (c.y + c.h*0.5) - (hero.y + hero.h*0.5);
      const near = (dx*dx+dy*dy) <= H2;
      const sp2 = (c.vx||0)*(c.vx||0) + (c.vy||0)*(c.vy||0);
      if (near && sp2 > 1.2*1.2) return true; // velocidad > ~1.2 px/frame
    }
    return false;
  }

  // Broadcast cooperativo para todas las guardias
  const RADIO = {
    lastPusherPos: null,       // {x,y}
    lastPusherAt:  -1,         // ms
    ttlMs:         6000,       // memoria 6s
    ping(pos){ this.lastPusherPos = pos; this.lastPusherAt = performance.now ? performance.now() : Date.now(); },
    read(){
      const now = performance.now ? performance.now() : Date.now();
      if (now - this.lastPusherAt <= this.ttlMs) return this.lastPusherPos;
      return null;
    }
  };

  // ========================= Construcción de guardia =========================
  function makeGuard(x,y, opts={}){
    const e = (typeof W.makeRect === 'function')
      ? W.makeRect(x, y, TILE*0.9, TILE*0.9, ENT.GUARD, '#2b5bd7', false, true, { mass:1.2, rest:0.08, mu:0.12 })
      : { x,y,w:TILE*0.9, h:TILE*0.9, kind:ENT.GUARD, color:'#2b5bd7', vx:0,vy:0, solid:true, static:false, mass:1.2 };

    e.skin   = opts.skin || 'guardia';
    e.role   = 'guardia';
    e.isNPC  = true;                 // para puertas: canOperateDoor(actor)
    e.speed  = opts.speed || 70;     // px/s
    e.turn   = 0;                    // acumulador dt
    e.state  = 'PATROL';             // PATROL | CLOSE_DOOR | PURSUE
    e.path   = null;                 // lista de {tx,ty}
    e.pathI  = 0;
    e.target = null;                 // {x,y} en px
    e.retargetCooldown = 0;
    e.pursueTimer = 0;
    e.visionRadiusPx = TILE * 12;    // alcance para detectar héroe empujando
    e.closeRangePx   = TILE * 0.9;   // distancia para operar puerta

    // Registro
    G.entities = G.entities || []; pushUnique(G.entities, e);
    G.npcs     = G.npcs || [];     pushUnique(G.npcs, e);

    return e;
  }

  function spawn(opts={}){
    const tx = (Number.isFinite(opts.tx)? opts.tx : 2);
    const ty = (Number.isFinite(opts.ty)? opts.ty : 2);
    const p = t2px(tx,ty);
    return makeGuard(p.x - TILE*0.45, p.y - TILE*0.45, opts);
  }

  // ========================= Lógica de estados =========================
  function statePatrol(g, dt){
    // 1) ¿Hay puertas abiertas? → prioridad cerrar
    const door = findNearestOpenDoorPx(g);
    if (door){
      g.state = 'CLOSE_DOOR';
      g.path  = planPathToDoor(g, door);
      g.pathI = 0;
      g.target= door; // record
      return;
    }

    // 2) Si no hay puertas abiertas → patrulla aleatoria
    if (!g.target || g.retargetCooldown <= 0){
      const R = TILE * 8;
      const nx = g.x + g.w*0.5 + (Math.random()*2-1)*R;
      const ny = g.y + g.h*0.5 + (Math.random()*2-1)*R;
      g.target = { x:nx, y:ny };
      g.path   = planPathToPx(g, nx, ny);
      g.pathI  = 0;
      g.retargetCooldown = 1.2 + Math.random()*1.0;
    } else {
      g.retargetCooldown -= dt;
    }

    moveAlongPathOrSeek(g, dt, g.speed);

    // 3) Vigilancia: ¿héroe empuja carro y lo vemos?
    const hero = G.player;
    if (hero && isHeroPushingCart(hero)){
      const dx=(hero.x+hero.w*0.5)-(g.x+g.w*0.5), dy=(hero.y+hero.h*0.5)-(g.y+g.h*0.5);
      const inRange = (dx*dx+dy*dy) <= (g.visionRadiusPx*g.visionRadiusPx);
      const vis = inRange && hasLineOfSight(g.x+g.w*0.5, g.y+g.h*0.5, hero.x+hero.w*0.5, hero.y+hero.h*0.5);
      if (vis){
        RADIO.ping({ x: hero.x+hero.w*0.5, y: hero.y+hero.h*0.5 });
        startPursue(g, hero);
      }
    } else {
      // quizá otro guardia vio algo
      const ping = RADIO.read();
      if (ping){
        startPursue(g, ping);
      }
    }
  }

  function startPursue(g, target){
    g.state = 'PURSUE';
    g.pursueTimer = 4.0 + Math.random()*2.0;  // 4–6s de persecución
    const tx = (target.x != null ? target.x : (G.player?.x||g.x));
    const ty = (target.y != null ? target.y : (G.player?.y||g.y));
    g.path = planPathToPx(g, tx, ty);
    g.pathI = 0;
  }

  function statePursue(g, dt){
    g.pursueTimer -= dt;
    const hero = G.player;
    // re-ajusta destino hacia el héroe si lo tenemos
    if (hero){
      if (isHeroPushingCart(hero)){
        RADIO.ping({ x: hero.x+hero.w*0.5, y: hero.y+hero.h*0.5 });
      }
      if (g.retargetCooldown <= 0){
        g.path = planPathToPx(g, hero.x+hero.w*0.5, hero.y+hero.h*0.5);
        g.pathI = 0;
        g.retargetCooldown = 0.6; // refresco de ruta
      } else {
        g.retargetCooldown -= dt;
      }
    }
    moveAlongPathOrSeek(g, dt, g.speed * 1.2);

    // si ya no tiene razón para perseguir, vuelve a patrulla
    if (g.pursueTimer <= 0){
      g.state = 'PATROL';
      g.target = null;
      g.path = null;
    }
  }

  function stateCloseDoor(g, dt){
    const door = g.target && g.target.kind === ENT.DOOR ? g.target : findNearestOpenDoorPx(g);
    if (!door){ g.state='PATROL'; g.path=null; return; }

    // mueve hacia la puerta
    if (!g.path || g.pathI>= (g.path?.length||0)){
      g.path = planPathToDoor(g, door);
      g.pathI = 0;
    }
    moveAlongPathOrSeek(g, dt, g.speed);

    // abrir para pasar si nos estorbamos con una (y cerrarla detrás)
    autoOpenNearbyFor(g);

    // Si cerca, intentar cerrar
    const cx = door.x + door.w*0.5, cy = door.y + door.h*0.5;
    const dx = cx - (g.x + g.w*0.5), dy = cy - (g.y + g.h*0.5);
    if ((dx*dx + dy*dy) <= (g.closeRangePx*g.closeRangePx)){
      // usa API de puertas si existe
      const D = W.Entities?.Door;
      if (D && typeof D.tryClose === 'function'){
        D.tryClose(door, g);
      } else if (D && typeof D.interact === 'function'){
        D.interact(g, 1.2);
      }
      // si la puerta ya está cerrada, siguiente
      if (!door.open){ g.state='PATROL'; g.target=null; g.path=null; }
    }

    // vigilancia paralela: si ve empuje, pasa a PURSUE
    const hero = G.player;
    if (hero && isHeroPushingCart(hero) && hasLineOfSight(g.x+g.w*0.5, g.y+g.h*0.5, hero.x+hero.w*0.5, hero.y+hero.h*0.5)){
      startPursue(g, hero);
    }
  }

  // ========================= Navegación / movimiento =========================
  function planPathToDoor(g, door){
    const s = px2t(g.x+g.w*0.5, g.y+g.h*0.5);
    const t = px2t(door.x+door.w*0.5, door.y+door.h*0.5);
    return bfsPath(G.map||[], s.tx,s.ty, t.tx,t.ty) || null;
  }
  function planPathToPx(g, x,y){
    const s = px2t(g.x+g.w*0.5, g.y+g.h*0.5);
    const t = px2t(x,y);
    return bfsPath(G.map||[], s.tx,s.ty, t.tx,t.ty) || null;
  }

  function moveAlongPathOrSeek(g, dt, speed){
    const maxSp = speed||g.speed||70;
    let targetPx = null;

    if (g.path && g.pathI < g.path.length){
      const node = g.path[g.pathI];
      const p = t2px(node.tx, node.ty);
      targetPx = { x: p.x - g.w*0.5, y: p.y - g.h*0.5 };
      const dx = (targetPx.x - g.x), dy = (targetPx.y - g.y);
      const d2 = len2(dx,dy);
      if (d2 < (TILE*0.3)*(TILE*0.3)){
        g.pathI++;
      }
    } else if (g.target){
      targetPx = { x: g.target.x - g.w*0.5, y: g.target.y - g.h*0.5 };
    }

    if (targetPx){
      const dx = targetPx.x - g.x, dy = targetPx.y - g.y;
      const d = Math.sqrt(dx*dx+dy*dy) || 1;
      const nx = dx/d, ny = dy/d;
      g.vx = nx * maxSp;
      g.vy = ny * maxSp;
    } else {
      // ligera deriva de patrulla
      g.vx *= 0.9; g.vy *= 0.9;
    }

    // paso físico
    tryMove(g, dt);
  }

  function autoOpenNearbyFor(g){
    // Para poder cruzar, abre puertas en las que está colisionando y ciérralas luego.
    const D = W.Entities?.Door;
    if (!D) return;
    if (typeof D.proximityOpenFor === 'function'){
      D.proximityOpenFor(g); // abre si colisiona
    } else if (typeof D.interact === 'function'){
      D.interact(g, 1.0);
    }
  }

  // ========================= Update global & API =========================
  const S = { list: [] };

  function updateAll(dt=1/60){
    // mantener lista
    for (let i=S.list.length-1; i>=0; i--){
      const g = S.list[i];
      if (!g || g.dead){ S.list.splice(i,1); continue; }

      switch(g.state){
        case 'PURSUE':     statePursue(g, dt); break;
        case 'CLOSE_DOOR': stateCloseDoor(g, dt); break;
        default:           statePatrol(g, dt); break;
      }

      // Cierre oportunista si justo toca una puerta abierta
      const nearDoor = (G.doors||[]).find(d => d && d.open && aabb(g,d));
      if (nearDoor && W.Entities?.Door?.tryClose) {
        W.Entities.Door.tryClose(nearDoor, g);
      }
    }
  }

  function drawLabel(ctx, g){
    if (!ctx || !g) return;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '11px monospace';
    ctx.fillText('Guardia', g.x, g.y-4);
    ctx.restore();
  }

  // Limpieza / helpers
  function remove(e){
    e.dead = true;
    if (G.entities) G.entities = G.entities.filter(x=>x!==e);
    if (G.npcs)     G.npcs     = G.npcs.filter(x=>x!==e);
    S.list = S.list.filter(x=>x!==e);
  }

  // ========= Registro público =========
  W.Entities = W.Entities || {};
  W.Entities.Guardia = {
    spawn(opts){ const g=spawn(opts); pushUnique(S.list, g); return g; },
    updateAll, remove, drawLabel,
    // debug helper
    forceRetarget(g){ if (g){ g.target=null; g.path=null; g.pathI=0; } }
  };
  // alias por tiles
  W.Entities.spawnGuardia = function(tx,ty){ return W.Entities.Guardia.spawn({ tx, ty }); };

})();