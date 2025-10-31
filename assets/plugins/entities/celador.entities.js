// filename: celador.entities.js
// IA AVANZADA — Celador / Orderly (FSM + A* + utilidades de empuje)
// -------------------------------------------------------------------
// ✔ Patrulla con desvíos si hay atasco.
// ✔ Detecta carros/objetos empujables y alinea empuje “hacia el héroe”.
// ✔ Solo él empuja carros (puedes reforzarlo con isPushable).
// ✔ Abre puertas, evita paredes/fuego/charcos y no aplasta al boss.
// ✔ Pathfinding A* sobre grid del mapa (con costes por peligro).
// ✔ Memoria corta de héroe y objetivos (blackboard).
// ✔ Integración: Entities.Celador.spawn(x,y,p), update(e,dt,all)
//    y CeladorAPI.updateAll(G.entities, dt).
// ✔ Shim opcional: Entities.NPC.spawn('celador', x,y,p) → Celador.
//
// NOTA: El fichero es autocontenible y tolerante a motores incompletos.
//       Usa guards para G, ENT, física y HUD. No revienta si faltan APIs.

(function (W) {
  'use strict';

  // ---------- Integración básica ----------
  const G    = W.G || (W.G = {});
  const ENT  = W.ENT || (W.ENT = {});
  const TILE = W.TILE_SIZE || W.TILE || 32;

  // Claves de ENT por si no existieran
  ENT.CELADOR  = ENT.CELADOR  ?? 401;
  ENT.CART     = ENT.CART     ?? 5;
  ENT.DOOR     = ENT.DOOR     ?? 7;
  ENT.WALL     = ENT.WALL     ?? 1;
  ENT.BOSS     = ENT.BOSS     ?? 99;
  ENT.PLAYER   = ENT.PLAYER   ?? 1001;

  // Utilidades blandas del core (guards + fallbacks)
  const now = () => (performance?.now?.() ?? Date.now());
  const clamp = (v,a,b)=> v<a?a : (v>b?b : v);
  const rnd   = (a,b)=> a + Math.random()*(b-a);
  const sgn   = (v)=> v<0?-1: v>0?1:0;

  function aabb(a,b){
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function near(a,b,m=10){
    return a.x < b.x + b.w + m && a.x + a.w > b.x - m &&
           a.y < b.y + b.h + m && a.y + a.h > b.y - m;
  }
  function isWallAABB(px,py,w,h){
    if (typeof W.isWallAt === 'function') return W.isWallAt(px,py,w,h);
    // Fallback con G.map
    const tx1 = Math.floor(px/TILE), ty1 = Math.floor(py/TILE);
    const tx2 = Math.floor((px+w)/TILE), ty2 = Math.floor((py+h)/TILE);
    if (!G.map || tx1<0 || ty1<0 || tx2>=G.mapW || ty2>=G.mapH) return true;
    return (G.map[ty1][tx1]===1)||(G.map[ty1][tx2]===1)||(G.map[ty2][tx1]===1)||(G.map[ty2][tx2]===1);
  }
  function isHazardAt(tx,ty){
    // Marca peligros: agua/fuego si tu engine los expone; si no, devuelve false.
    if (typeof W.isHazardAt === 'function') return !!W.isHazardAt(tx,ty);
    // Puedes poblar G.hazardGrid[ty][tx] = cost > 0 desde tu hazards.entities.js
    return !!(G.hazardGrid && G.hazardGrid[ty] && G.hazardGrid[ty][tx]);
  }
  function doorTryOpenAt(tx,ty){
    // Busca puerta en esa celda y ábrela si tu Door API existe
    const px = tx*TILE, py = ty*TILE;
    const list = G.entities || [];
    for (const o of list){
      if (o.kind===ENT.DOOR && aabb({x:px,y:py,w:TILE,h:TILE}, o)){
        // API “bonita”
        if (W.Entities?.Door?.open) { W.Entities.Door.open(o); return true; }
        // Fallback
        o.solid = false; o.locked = false; o._autoRecloseAt = now()+2000;
        return true;
      }
    }
    return false;
  }
  function bossSafeClampImpulse(e){
    // Anti-suicidio: si el boss está cerca, baja el impulso del empuje
    if (!G.boss) return 1;
    const bx = G.boss.x+G.boss.w*0.5, by=G.boss.y+G.boss.h*0.5;
    const ex = e.x+e.w*0.5,         ey= e.y+e.h*0.5;
    const d2 = (bx-ex)*(bx-ex) + (by-ey)*(by-ey);
    const R  = (8*TILE)*(8*TILE); // radio de seguridad ~8 tiles
    return (d2<R) ? 0.25 : 1.0;   // reduce a 25% dentro de zona
  }

  // ---------- Balance / Config (override con G.BALANCE?.CELADOR) ----------
  const DEF = {
    speed:            0.75,       // vel. base patrulla
    speedCarry:       0.65,       // si “acompaña” un carrito
    patrolTurnMs:     2400,
    replanMs:         350,        // cada cuánto replanifica A*
    jamTimeoutMs:     1200,       // atasco → maniobra
    scanRadiusTiles:  8,          // radio de interés
    heroMemMs:        4000,       // memoria de héroe visto
    pushImpulse:      5.5,        // empuje inicial
    sustainedPush:    0.30,       // empuje sostenido
    maxPushMs:        5200,
    regrabCooldownMs: 2000,
    doorOpenAhead:    true,       // abre puertas en ruta
    costHazard:       5,          // coste extra casilla peligrosa
    costDark:         1,          // (si implementas oscuridad)
    LOSstep:          10,
    aimHeroBias:      0.75,       // cuánto “apunta” el empuje hacia el héroe
    lightColor:       'orange',
    crushSpeedThresh: 2.2,
    crushDamage:      1,
  };
  function B(){ return Object.assign({}, DEF, (G.BALANCE?.CELADOR||{})); }

  // ---------- Heurísticas & utilidades ----------
  function dist2(a,b){ const dx=(a.x+a.w*0.5)-(b.x+b.w*0.5), dy=(a.y+a.h*0.5)-(b.y+b.h*0.5); return dx*dx+dy*dy; }
  function dist2Pt(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; }
  function entitiesInRadius(list, e, rTiles, pred){
    const r2=(rTiles*TILE)*(rTiles*TILE);
    const out=[]; for(const o of list){ if(o===e) continue; if(pred && !pred(o)) continue; if(dist2(e,o)<=r2) out.push(o); }
    return out;
  }
  function isPushable(o){
    if (!o || o.static) return false;
    if (o.kind===ENT.WALL || o.kind===ENT.DOOR || o.kind===ENT.BOSS) return false;
    if (o.pushable === false) return false;
    // refuerza que los carros SÍ son empujables, y otros depende de flags
    return (o.kind===ENT.CART) || (o.pushable===true) || (typeof o.vx==='number' && typeof o.vy==='number');
  }
  function hasLOS(a,b,step=B().LOSstep){
    const ax=a.x+a.w*0.5, ay=a.y+a.h*0.5, bx=b.x+b.w*0.5, by=b.y+b.h*0.5;
    const dx=bx-ax, dy=by-ay, L=Math.hypot(dx,dy)||1, nx=dx/L, ny=dy/L, n=Math.floor(L/step);
    for(let i=1;i<=n;i++){ const px=ax+nx*i*step, py=ay+ny*i*step; if (isWallAABB(px-4,py-4,8,8)) return false; }
    return true;
  }

  // ---------- A* Pathfinder mínimo (grid) ----------
  function findPath(tx0,ty0, tx1,ty1){
    if (!G.map) return null;
    const H=G.mapH, Wd=G.mapW;
    function walk(tx,ty){ return tx>=0 && ty>=0 && tx<Wd && ty<H && G.map[ty][tx]!==1; }
    function key(tx,ty){ return (ty*Wd+tx)|0; }
    const open=[], came=new Map(), g=Object.create(null), f=Object.create(null);
    const startK=key(tx0,ty0), goalK=key(tx1,ty1);
    g[startK]=0; f[startK]=0; open.push([tx0,ty0,0]);
    const neigh=[[1,0],[-1,0],[0,1],[0,-1]];

    while(open.length){
      // escoge el de menor f (lista corta; puedes optimizar con bin-heap)
      let best=0, bestF=Infinity;
      for(let i=0;i<open.length;i++){ const k=key(open[i][0],open[i][1]); const fi=f[k] ?? Infinity; if(fi<bestF){bestF=fi; best=i;} }
      const [cx,cy]=open.splice(best,1)[0];
      if (cx===tx1 && cy===ty1){
        // reconstruye
        const path=[[cx,cy]];
        let ck=goalK;
        while(came.has(ck)){ const p=came.get(ck); path.push([p[0],p[1]]); ck=key(p[0],p[1]); }
        path.reverse(); return path;
      }
      const ck=key(cx,cy);
      for(const [dx,dy] of neigh){
        const nx=cx+dx, ny=cy+dy;
        if (!walk(nx,ny)) continue;
        // coste por peligros
        let extra = 0;
        if (isHazardAt(nx,ny)) extra += B().costHazard;
        // (si tuvieses oscuridad: extra += B().costDark;)
        const nk=key(nx,ny);
        const tentative = (g[ck]??Infinity) + 1 + extra;
        if (tentative < (g[nk]??Infinity)){
          came.set(nk,[cx,cy]);
          g[nk]=tentative;
          // heurística Manhattan
          const h = Math.abs(tx1-nx)+Math.abs(ty1-ny);
          f[nk]=tentative + h;
          // añade a open si no estaba
          if (!open.some(p=>p[0]===nx && p[1]===ny)) open.push([nx,ny, f[nk]]);
        }
      }
    }
    return null;
  }

  // ---------- FSM de alto nivel ----------
  // Estados: PATROL → (SEE_CART/SEE_BLOCK) → LINE_UP_PUSH → PUSH → (CHASE_HERO_WITH_CART|PATROL)
  //         + ASSIST (seguir héroe un rato), + UNJAM (maniobra si atasco)
  const S = { PATROL:'PATROL', SEEK:'SEEK', LINEUP:'LINEUP', PUSH:'PUSH', CHASE:'CHASE', ASSIST:'ASSIST', UNJAM:'UNJAM' };

  function create(x,y, p={}){
    const b = B();
    const e = {
      kind: ENT.CELADOR,
      x, y, w: 28, h: 28,
      vx:0, vy:0, mu:0.04,
      speed: b.speed,
      mode: S.PATROL,
      dir: {x:1, y:0},
      turnAt: now()+rnd(900, b.patrolTurnMs),
      replanAt: 0,
      jamUntil: 0,
      target: null,      // {ent?, tx?, ty?}
      path: null, pathIdx:0,
      pushUntil: 0,
      lastGrabId: null,
      regrabAfter: 0,
      lastHeroSeenAt: 0,
      lastHeroPos: null,
      name: "Celador",
      skin: "celador",
      light: b.lightColor,
      _lastSafeX: x, _lastSafeY: y
    };
    pushUnique(G.entities, e);
    pushUnique(G.npcs || (G.npcs=[]), e);
    return e;
  }

  function pushUnique(list, e){ if(Array.isArray(list) && e && !list.includes(e)) list.push(e); }

  function selectHero(){
    const p = G.player;
    return (p && !p.dead) ? p : null;
  }

  function nearestPushable(list, e){
    const near = entitiesInRadius(list, e, B().scanRadiusTiles, o=>isPushable(o));
    // prioriza carros
    const carts = near.filter(o=>o.kind===ENT.CART);
    return carts[0] || near[0] || null;
  }

  function planTo(e, tx,ty){
    const path = findPath(Math.floor((e.x+e.w*0.5)/TILE), Math.floor((e.y+e.h*0.5)/TILE), tx,ty);
    e.path = path; e.pathIdx = path ? 0 : 0;
    e.replanAt = now() + B().replanMs;
  }

  function stepAlongPath(e, dt){
    if (!e.path || e.pathIdx >= e.path.length) return false;
    const [tx,ty] = e.path[e.pathIdx];
    const gx = tx*TILE + TILE*0.5, gy = ty*TILE + TILE*0.5;
    const dx = gx - (e.x+e.w*0.5), dy = gy - (e.y+e.h*0.5);
    const L  = Math.hypot(dx,dy) || 1;
    const v  = e.speed;
    e.vx += (dx/L) * v; e.vy += (dy/L) * v;
    // si hemos llegado a este nodo, pasa al siguiente
    if (Math.abs(dx)<6 && Math.abs(dy)<6) e.pathIdx++;
    // abrir puerta en el siguiente nodo si procede
    if (B().doorOpenAhead && e.pathIdx<e.path.length){
      const [nx,ny]=e.path[e.pathIdx];
      doorTryOpenAt(nx,ny);
    }
    return true;
  }

  function lineUpWithTarget(e, tgt){
    // Alinea al celador en la “cara” del objeto para empujarlo hacia el héroe
    const hero = selectHero();
    if (!hero || !tgt) return false;
    const hx=hero.x+hero.w*0.5, hy=hero.y+hero.h*0.5;
    const ox=tgt.x+tgt.w*0.5,  oy=tgt.y+tgt.h*0.5;
    // calcula lado opuesto al héroe para colocarse
    const vx = ox - hx, vy = oy - hy;
    const L  = Math.hypot(vx,vy)||1, nx=vx/L, ny=vy/L;
    const px = ox + nx* (tgt.w*0.6); // punto destino para “enganchar” por el lado opuesto
    const py = oy + ny* (tgt.h*0.6);
    const tx = clamp(Math.floor(px/TILE), 0, G.mapW-1);
    const ty = clamp(Math.floor(py/TILE), 0, G.mapH-1);
    planTo(e, tx, ty);
    e.mode = S.LINEUP;
    e.target = { ent:tgt };
    return true;
  }

  function applyPush(e, tgt, dt){
    // Empuje inicial + sostenido, sesgado hacia el héroe
    const b = B();
    const hero = selectHero();
    const ox=tgt.x+tgt.w*0.5, oy=tgt.y+tgt.h*0.5;
    let nx = e.x+e.w*0.5 < ox ? 1 : -1;
    let ny = e.y+e.h*0.5 < oy ? 1 : -1;
    // sesgo hacia hero
    if (hero){
      const tx = (hero.x+hero.w*0.5) - ox;
      const ty = (hero.y+hero.h*0.5) - oy;
      const L  = Math.hypot(tx,ty)||1;
      const hx = tx/L, hy = ty/L;
      nx = clamp(nx*(1-b.aimHeroBias) + hx*b.aimHeroBias, -1, 1);
      ny = clamp(ny*(1-b.aimHeroBias) + hy*b.aimHeroBias, -1, 1);
    }
    const anti = bossSafeClampImpulse(tgt); // baja fuerza si estamos cerca del boss
    // impulso inicial
    if (!tgt._grabbedBy || tgt._grabbedBy!==e){
      tgt.vx = (tgt.vx||0) + nx * b.pushImpulse * anti;
      tgt.vy = (tgt.vy||0) + ny * b.pushImpulse * anti;
      tgt._grabbedBy = e; e.lastGrabId = tgt.id || tgt._nid || tgt._uid || tgt;
    }
    // empuje sostenido
    tgt.vx += nx * b.sustainedPush * anti;
    tgt.vy += ny * b.sustainedPush * anti;

    // marca para daño por aplastamiento cuando colisiona a alta velocidad
    tgt._lastPushedBy   = "CELADOR";
    tgt._lastPushedTime = now();
  }

  function handleCrushFromRecentlyPushed(celador, all){
    const b = B();
    const pushes = all.filter(o=> isPushable(o) && o._lastPushedBy==="CELADOR" && now()-(o._lastPushedTime||0) < 1200);
    tgt._lastPushedId = e.id || e._nid || e._uid || null;
    tgt._pushedByEnt  = e;
    for (const obj of pushes){
      const spd = Math.hypot(obj.vx||0, obj.vy||0);
      if (spd < b.crushSpeedThresh) continue;
      for (const t of all){
        if (t===celador || t===obj) continue;
        if (t.kind===ENT.WALL || t.kind===ENT.DOOR || t.kind===ENT.BOSS) continue;
        if (!aabb(obj,t)) continue;
        // Daño (si existe API de daño)
        if (typeof W.applyDamage==='function') W.applyDamage(t, b.crushDamage, 'crush');
        else if (typeof t.hp==='number'){ t.hp=Math.max(0, t.hp-b.crushDamage); if(t.hp===0) t.dead=true; }
        // rebote pequeño
        obj.vx*=0.5; obj.vy*=0.5;
      }
    }
  }

  // ---------- Update por entidad ----------
  function update(e, dt, all=(G.entities||[])){
    if (e.dead) return;
    const b = B();
    const hero = selectHero();

    // re-cierre de puertas abiertas “a mano”
    if (e._autoRecloseAt && now()>e._autoRecloseAt){ e.solid=true; e._autoRecloseAt=0; }

    // memoria de héroe
    if (hero && hasLOS(e, hero)) { e.lastHeroSeenAt = now(); e.lastHeroPos = {x:hero.x, y:hero.y}; }

    // atascos: si no se mueve “mucho” en jamTimeout → maniobra UNJAM
    const moved2 = dist2Pt(e.x, e.y, e._lastX ?? e.x, e._lastY ?? e.y);
    const jammed = (moved2 < 0.1) && (now() > (e._sinceMove ?? 0) + b.jamTimeoutMs);
    if (moved2 > 0.1){ e._sinceMove = now(); }
    e._lastX = e.x; e._lastY = e.y;

    if (jammed){ e.mode = S.UNJAM; e.jamUntil = now()+ rnd(250, 600); e.path=null; }

    switch(e.mode){
      case S.PATROL:{
        // patrulla simple (gira cada X ms o si chocamos con muro)
        if (now()>e.turnAt || isWallAABB(e.x+e.dir.x*16, e.y+e.dir.y*16, e.w, e.h)){
          const dirs = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
          e.dir = dirs[(Math.random()*dirs.length)|0];
          e.turnAt = now()+rnd(900, b.patrolTurnMs);
        }
        e.vx += e.dir.x * e.speed;
        e.vy += e.dir.y * e.speed;

        // ve algo empujable interesante?
        const tgt = nearestPushable(all, e);
        if (tgt) { lineUpWithTarget(e, tgt); break; }

        // si el héroe está cerca, “asiste” empujando su camino
        if (hero && dist2(e,hero) < (6*TILE)*(6*TILE)){
          e.mode = S.ASSIST; e.target = { ent: hero }; e.path=null; break;
        }
      } break;

      case S.ASSIST:{
        // sigue al héroe un rato para abrir paso
        if (!e.target?.ent || e.target.ent.dead){ e.mode=S.PATROL; break; }
        const h = e.target.ent;
        if (now() > (e._assistUntil ?? 0)) e._assistUntil = now()+2000;
        const tx = Math.floor((h.x+h.w*0.5)/TILE), ty = Math.floor((h.y+h.h*0.5)/TILE);
        if (now()>e.replanAt) planTo(e, tx, ty);
        stepAlongPath(e, dt);

        // si hay carro cerca, cambia a LINEUP → PUSH
        const tgt = nearestPushable(all,e);
        if (tgt){ lineUpWithTarget(e, tgt); break; }

        // si se aleja mucho, vuelve a patrulla
        if (dist2(e,h) > (10*TILE)*(10*TILE)) { e.mode=S.PATROL; e.path=null; }
      } break;

      case S.LINEUP:{
        const tgt = e.target?.ent;
        if (!tgt || tgt.dead){ e.mode=S.PATROL; e.path=null; break; }
        // si ya estamos pegados al objeto, pasa a PUSH
        if (near(e, tgt, 4)){ e.mode = S.PUSH; e.pushUntil = now()+b.maxPushMs; break; }
        // seguir ruta hacia el punto de enganche
        if (now()>e.replanAt && e.path && e.pathIdx<e.path.length){
          // seguir
        } else {
          // replan (sitúate en la cara opuesta al héroe)
          lineUpWithTarget(e, tgt);
        }
        stepAlongPath(e, dt);
      } break;

      case S.PUSH:{
        const tgt = e.target?.ent;
        if (!tgt || tgt.dead){ e.mode=S.PATROL; break; }
        // si empujamos demasiado tiempo o perdimos al héroe, suelta
        if (now()>e.pushUntil){ e.mode=S.PATROL; e.target=null; break; }
        applyPush(e, tgt, dt);
        // si el héroe está cerca, acelera un poco
        if (hero && dist2(e,hero) < (5*TILE)*(5*TILE)) e.speed = b.speedCarry;
        else e.speed = b.speed;

        // si el carro se aleja (rebote), re-alínea
        if (!near(e,tgt, 28)) { e.mode=S.LINEUP; break; }
      } break;

      case S.UNJAM:{
        // maniobra corta para salir del atasco
        e.vx += -e.dir.x * (b.speed*0.8);
        e.vy += -e.dir.y * (b.speed*0.8);
        if (now()>e.jamUntil){ e.mode=S.PATROL; }
      } break;
    }

    // navegación por path si existe
    if (e.path) stepAlongPath(e, dt);

    // “frenos” suaves
    e.vx *= 0.92; e.vy *= 0.92;

    // separaciones/resoluciones las hace tu physics.plugin.js; aquí solo guardamos safe pos
    if (!isWallAABB(e.x,e.y,e.w,e.h)){ e._lastSafeX=e.x; e._lastSafeY=e.y; }

    // daño por aplastamiento de objetos que empujó hace nada
    handleCrushFromRecentlyPushed(e, all);
  }

  // ---------- API pública ----------
  const CeladorAPI = {
    create, update,
    updateAll(list, dt){ for(const e of (list||[])){ if (e && e.kind===ENT.CELADOR) update(e,dt,list); } }
  };

  // Exponer
  W.Entities = W.Entities || {};
  W.Entities.Celador    = CeladorAPI;     // “spawn” = create
  W.Entities.CeladorAPI = CeladorAPI;

  // Shim opcional: mapear NPC.spawn('celador') → Celador
  W.Entities.NPC = W.Entities.NPC || {};
  if (!W.Entities.NPC.spawn){
    W.Entities.NPC.spawn = function(sub, x,y, p){
      if ((sub||'').toLowerCase()==='celador'){ return CeladorAPI.create(x,y,p); }
      return null;
    };
  }

  // Facilitar llamada desde placement.api.js si alguna vez usa Entities.Celador.spawn
  W.Entities.Celador.spawn = (x,y,p)=> CeladorAPI.create(x,y,p);

})(this);