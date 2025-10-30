/* mouse.control.api.js  –  Click-to-move + usar/abrir + cursores.
   Requiere:
     - mapa en grid de colisiones (0 = libre, !=0 muro)
     - camera {x,y,zoom}
     - TILE (tamaño del tile en mundo)
   Se integra con:
     MouseNav.init({...});  // ver pasos en la sección 2
     MouseNav.update(dt);
     MouseNav.render(ctx, camera);
*/

(function () {
  'use strict';

  const CUR = { GO:'go', FORBID:'forbid', INTERACT:'interact' };

  // Utilidades sencillas
  const clamp = (v,a,b)=> Math.max(a, Math.min(b,v));
  const dist  = (ax,ay,bx,by)=> Math.hypot(ax-bx, ay-by);
  const toTile= (x,TILE)=> (x/TILE)|0;

  // A* muy ligero sobre grid
  function astar(grid, sx,sy, tx,ty) {
    const W=grid.w,H=grid.h, block=grid.block;
    const key=(x,y)=> (y<<16)+x;
    const open=[], came=new Map(), g=new Map(), f=new Map();
    const st=key(sx,sy), tt=key(tx,ty);
    const put=(x,y,gg,ff,p)=>{ const k=key(x,y); g.set(k,gg); f.set(k,ff); came.set(k,p); open.push([ff,x,y]); };
    const h=(x,y)=> Math.abs(x-tx)+Math.abs(y-ty); // Manhattan
    put(sx,sy,0,h(sx,sy),-1);
    while(open.length){
      open.sort((a,b)=>a[0]-b[0]); // pequeño => OK
      const [_, x,y]=open.shift();
      if (x===tx && y===ty){
        // reconstruir
        const path=[ [x,y] ];
        let k=key(x,y);
        while(came.get(k)!==-1){ k=came.get(k); path.push([k&0xffff, k>>16]); }
        return path.reverse();
      }
      const gg=g.get(key(x,y))+1;
      const N=[ [x+1,y],[x-1,y],[x,y+1],[x,y-1] ];
      for (const [nx,ny] of N){
        if (nx<0||ny<0||nx>=W||ny>=H) continue;
        if (block(nx,ny)) continue;
        const nk=key(nx,ny);
        if (!g.has(nk) || gg<g.get(nk)){
          put(nx,ny,gg,gg+h(nx,ny), key(x,y));
        }
      }
    }
    return null;
  }

  // --- Suavizado de giro del cono de luz / FOW (ratón/teclado) ---
  function softFacing(p, ndx, ndy, dt, fromMouse = false){
    const want = Math.atan2(ndy, ndx);
    if (!isFinite(want)) return;

    const cur = (p.lookAngle ?? want);
    // ↑ sensibilidad base mayor (antes 2.5)
    const maxTurn = (p.turnSpeed || 4.5) * dt;

    // diferencia angular normalizada a [-PI, PI]
    let diff = ((want - cur + Math.PI) % (2*Math.PI));
    if (diff > Math.PI) diff -= 2*Math.PI;

    // TURBO para giros grandes: si superas ~155º, gira 1.75× más rápido
    const heavy = Math.abs(diff) > 2.7 ? 1.75 : 1.0;

    // Ratón: ignora micro-ruido más pequeño (antes 0.35 rad ≈ 20º)
    const ignore = fromMouse && Math.abs(diff) < 0.18; // ≈10º
    if (!ignore){
      const step = Math.max(-maxTurn*heavy, Math.min(maxTurn*heavy, diff));
      p.lookAngle = cur + step;
    }

    // Histeresis a cardinales (más ágil: antes 0.12s)
    p._facingHold = Math.max(0, (p._facingHold || 0) - dt);
    if (p._facingHold <= 0){
      const ang = (p.lookAngle ?? want);
      const deg = ang * 180 / Math.PI;
      const newCard =
        (deg > -45 && deg <= 45)    ? 'E' :
        (deg > 45  && deg <= 135)   ? 'S' :
        (deg <= -45 && deg > -135)  ? 'N' : 'W';
      if (newCard !== p.facing){
        p.facing = newCard;
        p._facingHold = 0.08; // más sensible
      }
    }
  }

  // Dibujo marcador “anillo”
  function drawRing(ctx, x,y, r, a){
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = '#ffd76a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }

  const MouseNav = {
    // referencias
    _canvas:null, _ctx:null, _camera:null,
    _getMap:null, _tile:32,
    _getEntities:null, _player:null,
    _isWalkable:null, _isDoorOpen:null,
    _performUse:null,            // callback para “usar/abrir/push”

    // estado
    _cursor:CUR.FORBID,
    _hover:{type:null, ent:null, tileX:0,tileY:0, worldX:0,worldY:0},
    _marker:null,               // {x,y,t,mode}
    _path:[],                   // lista de puntos mundo (centros de tile)
    _pendingInteract:null,      // entidad a usar al llegar
    _enabled:true,

    // Configuración de cursores (pon tus PNG si quieres)
    _cursorCSS:{
      [CUR.GO]:'crosshair', 
      [CUR.FORBID]:'not-allowed',
      [CUR.INTERACT]:'grab'
    },

    init(opts){
      const {
        canvas, camera, TILE,
        getMap, getEntities, getPlayer,
        isWalkable, isDoorOpen,
        performUse,         // (player, targetEntity|null)
      } = opts;

      this._canvas = canvas;
      this._ctx    = canvas.getContext('2d');
      this._camera = camera;
      this._tile   = TILE;
      this._getMap = getMap;
      this._getEntities = getEntities;
      this._player = getPlayer;
      this._isWalkable = isWalkable;
      this._isDoorOpen = isDoorOpen || (()=>true);
      this._performUse = performUse || null;

      canvas.addEventListener('mousemove', this._onMove.bind(this));
      canvas.addEventListener('mouseleave', ()=> this._setCursor(CUR.FORBID));
      canvas.addEventListener('contextmenu', (e)=>e.preventDefault());
      canvas.addEventListener('mousedown', this._onDown.bind(this));
    },

    setEnabled(v){ this._enabled = !!v; },

    // ------------- EVENTOS RATÓN -------------
    _screenToWorld(mx,my){
      const r = this._canvas.getBoundingClientRect();
      const x = (mx - r.left - this._canvas.width/2)/this._camera.zoom + this._camera.x;
      const y = (my - r.top  - this._canvas.height/2)/this._camera.zoom + this._camera.y;
      return {x,y};
    },

    _onMove(e){
      if (!this._enabled) return;
      const {x,y} = this._screenToWorld(e.clientX, e.clientY);
      const tx = toTile(x, this._tile);
      const ty = toTile(y, this._tile);
      this._hover.worldX = x; this._hover.worldY = y;
      this._hover.tileX = tx; this._hover.tileY = ty;

      // ¿Hay algo interactuable debajo?
      const ent = this._findEntityAt(x,y);
      if (ent && this._isInteractable(ent)){
        this._hover.type = 'ent';
        this._hover.ent  = ent;
        this._setCursor(CUR.INTERACT);
        return;
      }

      // ¿Es casilla alcanzable?
      if (this._isReachable(tx,ty)){
        this._hover.type = 'tile';
        this._hover.ent  = null;
        this._setCursor(CUR.GO);
      } else {
        this._hover.type = null; this._hover.ent=null;
        this._setCursor(CUR.FORBID);
      }
    },

    _onDown(e){
      if (!this._enabled) return;
      if (e.button!==0) return; // solo click izq
      const {x,y} = this._screenToWorld(e.clientX, e.clientY);
      const ent = this._findEntityAt(x,y);

      // Guardamos marcador visual
      this._marker = { x,y, mode:this._cursor, t:0 };

      if (this._cursor===CUR.FORBID) return;

      // ¿Interacción? -> mover cerca y usar al llegar
      if (this._cursor===CUR.INTERACT && ent){
        const tgt = this._adjacentFree(ent.x+ent.w/2, ent.y+ent.h/2);
        this._gotoWorld(tgt.x, tgt.y);
        this._pendingInteract = ent;
        return;
      }

      // “GO” normal
      this._gotoWorld(x,y);
      this._pendingInteract = null;
    },

    // ------------- LÓGICA -------------
    _setCursor(mode){
      this._cursor = mode;
      const css = this._cursorCSS[mode] || 'default';
      this._canvas.style.cursor = css;
    },

    _isReachable(tx,ty){
      const map = this._getMap();
      if (!map || !map[ty] || map[ty][tx]===undefined) return false;
      return this._isWalkable(tx,ty);
    },

    _isInteractable(ent){
      // Empujables o puertas (puedes ajustar por tipo)
      const PUSH = ['CART','BED','CRATE'];
      if (ent.kind === 'DOOR') return true;
      if (PUSH.includes(ent.kind)) return true;
      return false;
    },

    _findEntityAt(x,y){
      const E = this._getEntities();
      for (let i=E.length-1;i>=0;i--){
        const e=E[i];
        if (x>=e.x && y>=e.y && x<=e.x+e.w && y<=e.y+e.h){
          return e;
        }
      }
      return null;
    },

    _adjacentFree(cx,cy){
      // Devuelve el punto mundo “adyacente libre” más cercano
      const t = this._tile, tx = toTile(cx,t), ty = toTile(cy,t);
      const C = [ [tx+1,ty],[tx-1,ty],[tx,ty+1],[tx,ty-1] ];
      for (const [ax,ay] of C){
        if (this._isWalkable(ax,ay)) return {x: ax*t + t*0.5, y: ay*t + t*0.5};
      }
      // fallback
      return {x: tx*t + t*0.5, y: ty*t + t*0.5};
    },

    _gotoWorld(wx,wy){
      // Construir A* hasta ese tile
      const t=this._tile, map=this._getMap();
      const W=map[0].length, H=map.length;
      const px = toTile(this._player().x+this._player().w/2, t);
      const py = toTile(this._player().y+this._player().h/2, t);
      const tx = clamp(toTile(wx,t), 0, W-1);
      const ty = clamp(toTile(wy,t), 0, H-1);

      const grid = { w:W, h:H, block:(x,y)=> !this._isWalkable(x,y) };
      const path = astar(grid, px,py, tx,ty);
      this._path.length = 0;
      if (path){
        for (const [gx,gy] of path){
          this._path.push({ x: gx*t + t*0.5, y: gy*t + t*0.5 });
        }
      }
    },

    update(dt){
      if (!this._enabled) return;
      // Seguir camino
      const p=this._player(); if (!p) return;
      if (this._path && this._path.length){
        const tgt = this._path[0];
        let dx = tgt.x - (p.x+p.w/2);
        let dy = tgt.y - (p.y+p.h/2);
        let len = Math.hypot(dx,dy);

        // Steering: ajusta hacia una velocidad objetivo, sin “pasarse”
        const accel = (p.accel != null) ? p.accel
                    : (p.speed != null) ? p.speed * 60
                    : 800;                                // igual que teclado
        const maxSp = (p.maxSpeed != null) ? p.maxSpeed
                    : 165;

        if (len > 18){
          // === Centrado suave en pasillos estrechos ===
          const t = this._tile, map = this._getMap();
          const pcx = p.x + p.w/2, pcy = p.y + p.h/2;
          const ptx = (pcx/t)|0, pty = (pcy/t)|0;
          const W = map[0].length, H = map.length;
          const isWalk = (x,y)=> x>=0 && y>=0 && x<W && y<H && this._isWalkable(x,y);

          const ndx0 = dx/len, ndy0 = dy/len;
          // pasillo horizontal (pared arriba y abajo) -> atrae al centro en Y
          if (Math.abs(ndx0) > Math.abs(ndy0) && !isWalk(ptx,pty-1) && !isWalk(ptx,pty+1)){
            const cy = pty*t + t*0.5;
            dy += (cy - pcy) * 0.20; // 20% de corrección hacia el centro del pasillo
          }
          // pasillo vertical (pared izquierda y derecha) -> atrae al centro en X
          if (Math.abs(ndy0) > Math.abs(ndx0) && !isWalk(ptx-1,pty) && !isWalk(ptx+1,pty)){
            const cx = ptx*t + t*0.5;
            dx += (cx - pcx) * 0.20;
          }
          // recalcula módulo tras el ajuste
          len = Math.hypot(dx,dy);
          const ndx = dx/Math.max(1e-6,len), ndy = dy/Math.max(1e-6,len);

        // 👉 Igual que teclado: aceleración con dt + límite de velocidad
        // Frenada en giros: si la orientación difiere mucho, acelera menos
        const wantAng = Math.atan2(ndy, ndx);
        const curAng  = (p.lookAngle ?? wantAng);
        let angErr = ((wantAng - curAng + Math.PI) % (2*Math.PI)) - Math.PI;
        angErr = Math.abs(angErr);
        const brake = (angErr > 1.6) ? 0.35 : (angErr > 0.9) ? 0.55 : 1.0;

        p.vx += ndx * accel * brake * dt;
        p.vy += ndy * accel * brake * dt;

        const sp = Math.hypot(p.vx||0, p.vy||0);
        if (sp > maxSp){ const s = maxSp / sp; p.vx *= s; p.vy *= s; }

        // ROTACIÓN SUAVE DEL CONO (no cambies de golpe)
        softFacing(p, ndx, ndy, dt, /*fromMouse=*/true);

          p.usingMouse = true;
        } else {
          // Llegada: corta vibración con una frenada más firme
          p.vx *= 0.5; p.vy *= 0.5;
          if (Math.abs(p.vx) < 0.4) p.vx = 0;
          if (Math.abs(p.vy) < 0.4) p.vy = 0;

          // Alinea la cara hacia el último tramo
          if (len > 0.001){
            const ndx = dx/len, ndy = dy/len;
            softFacing(p, ndx, ndy, dt, /*fromMouse=*/true);
          }
          this._path.shift();
        }

        // Si no quedan puntos y había interacción pendiente -> orientar + usar
        if (!this._path.length && this._pendingInteract){
          const tgt = this._pendingInteract;
          const cx = (tgt.x + (tgt.w||0)/2) - (p.x + p.w/2);
          const cy = (tgt.y + (tgt.h||0)/2) - (p.y + p.h/2);
          const L  = Math.hypot(cx, cy) || 1;
          const ndx = cx/L, ndy = cy/L;
          softFacing(p, ndx, ndy, dt, /*fromMouse=*/true);

          if (this._performUse) this._performUse(p, tgt);
          this._pendingInteract = null;
        }
      } else {
          // No anulamos la inercia: así puede seguir empujando/recibiendo empujón
                    if (p.usingMouse){
            p.vx *= 0.85; p.vy *= 0.85;
            if (Math.abs(p.vx) < 0.25) p.vx = 0;
            if (Math.abs(p.vy) < 0.25) p.vy = 0;
            p.usingMouse = false;
          }
      }

      // Animación del marcador
      if (this._marker){
        this._marker.t += dt;
        if (this._marker.t > 1.2) this._marker = null;
      }
    },

    render(ctx, camera){
      if (!this._marker) return;
      const m=this._marker, t = clamp(m.t/1.2,0,1);
      const A = (1-t);
      const R = 26 + 20*t;
      // Pasar a pantalla
      const w = ctx.canvas.width, h=ctx.canvas.height;
      const sx = (m.x - camera.x) * camera.zoom + w/2;
      const sy = (m.y - camera.y) * camera.zoom + h/2;
      drawRing(ctx, sx, sy, R, A);
    },
  };

  window.MouseNav = MouseNav;
})();