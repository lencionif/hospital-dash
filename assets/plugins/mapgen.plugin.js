// filename: mapgen.plugin.js
// ─────────────────────────────────────────────────────────────────────────────
// MapGenAPI – Generador procedural ASCII para “Il Divo: Hospital Dash!”
//
// ✔ Niveles: 1 → 350×350, 2 → 700×700, 3 → 1050×1050 (configurable).
// ✔ Habitaciones con ÚNICA puerta (normal) y Boss-Room con puerta ESPECIAL.
// ✔ Pasillos laberínticos + cul-de-sacs (callejones sin salida).
// ✔ Sala de Control (spawn héroe) con teléfono, lejos de la Boss-Room.
// ✔ Conectividad garantizada: todo accesible desde Control (menos Boss mientras esté cerrada).
// ✔ Colocación de 7 pacientes + 7 pastillas + 7 timbres, con cercanía garantizada.
// ✔ Luces (algunas rotas con flicker), ascensores (1 par activo, 2 pares cerrados).
// ✔ Spawners (mosquitos, ratas, staff, carros) y NPC únicos (Jefe/ Supervisora) si existen.
// ✔ Detección automática de entidades “NOT NULL” en window.* y ENT.*
// ✔ Salida: { ascii, map, placements, areas, elevators, report, charset }
//
// API:
//   MapGenAPI.init(G?)                          // opcional, referenciar G (si quieres)
//   MapGenAPI.generate(level, options?) -> {…}  // ver options más abajo
//
// options (todas opcionales):
//   seed: number|string                 // RNG determinista
//   w,h: number                         // forzar tamaño (sino usa nivel)
//   defs: object                        // override de detección de entidades
//   charset: object                     // override de caracteres ASCII
//   place: boolean                      // si true, invoca callbacks para instanciar
//   callbacks: {                        // se llaman si place:true
//     placePlayer, placePhone, placeDoor, placeBoss,
//     placeLight, placeSpawner, placeElevator,
//     placePatient, placePill, placeBell
//   }
//   density: { rooms, lights, worms }   // tuning fino por tamaño
//
// Caracteres ASCII por defecto (override con options.charset):
//   '#': pared      '.' : suelo         'd': puerta normal  'D': puerta boss
//   'S': start      'T' : teléfono      'X' : boss (marcador)
//   'L': luz        'l' : luz rota      'E' : ascensor activo  'e': ascensor cerrado
//   'M': spwn mosq  'R' : spwn rata     'N' : spwn staff       'C': spwn carro
//   'p': paciente   'i' : pastilla      'b' : timbre
//
// NOTA RENDIMIENTO: 1050×1050 ≈ 1.1M tiles. El generador usa ocio O(W·H) solo en
// validaciones principales; el resto son operaciones por-sala. En móviles antiguos,
// considera bajar a 800×800 para nivel 3.
//
// ─────────────────────────────────────────────────────────────────────────────
(function (W) {
  'use strict';

  // --- REGLAS DE GENERACIÓN (mapa) ---
  const GEN_RULES = {
    MIN_CORRIDOR: 2,          // pasillo mínimo (tiles)
    MAX_CORRIDOR: 3,          // 💡 límite duro de ancho
    DOOR_NECK: 1,             // cuello de botella = 1 tile
    MIN_ROOM_GAP: 10,         // separación mínima entre habitaciones (en tiles)
    CORRIDOR_DOCK: 3,         // tramo que entra en el costado (≈ al centro)
    perRoom: (level) => ({ enemies: level, npcs: 1, celadores: 1 }),
    cartProb: { food: 0.6, meds: 0.3, urg: 0.1 },
  };

  // Helpers simples
  // --- Utils sobre grid (0/1/2: ajusta si tu representación difiere) ---
  function cloneGrid(g){ return g.map(r => r.slice()); }// --- Reachability (BFS) sobre grid 0/1 (0 suelo, 1 muro) ---
  function bfsReach(map, sx, sy){
    const H = map.length, W = map[0].length;
    const inb = (x,y)=> y>=0 && y<H && x>=0 && x<W;
    const vis = Array.from({length:H},()=>Array(W).fill(false));
    const q = [];
    if (!inb(sx,sy) || map[sy][sx]===1) return vis;
    vis[sy][sx] = true; q.push([sx,sy]);
    while(q.length){
      const [x,y] = q.shift();
      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      for (const [dx,dy] of dirs){
        const nx=x+dx, ny=y+dy;
        if (!inb(nx,ny) || vis[ny][nx] || map[ny][nx]===1) continue;
        vis[ny][nx] = true; q.push([nx,ny]);
      }
    }
    return vis;
  }

  // --- Carvar corredor recto tipo Bresenham con ancho (3..5) ---
  // Pasillo en L estrictamente ortogonal (usa digH/digV)
  function carveOrthCorridor(map, x0, y0, x1, y1, width=3){
    const w = clamp(width || GEN_RULES.MIN_CORRIDOR, GEN_RULES.MIN_CORRIDOR, GEN_RULES.MAX_CORRIDOR);
    // escogemos el orden que menos “muerde” paredes
    const hFirst = Math.abs(x1-x0) >= Math.abs(y1-y0);
    if (hFirst){
      digH(map, Math.min(x0,x1), Math.max(x0,x1), y0, w);
      digV(map, Math.min(y0,y1), Math.max(y0,y1), x1, w);
    } else {
      digV(map, Math.min(y0,y1), Math.max(y0,y1), x0, w);
      digH(map, Math.min(x0,x1), Math.max(x0,x1), y1, w);
    }
  }

  // --- Conecta TODAS las habitaciones a Control (si alguna queda aislada) ---
  function ensureAllRoomsReachable(map, rooms, start){
    const center = (r)=>({ x:(r.x+r.w/2)|0, y:(r.y+r.h/2)|0 });
    let vis = bfsReach(map, start.x, start.y);

    // devuelve un punto interior alcanzable de una sala o null
    const roomHasReach = (r)=>{
      for (let y=r.y; y<r.y+r.h; y++)
        for (let x=r.x; x<r.x+r.w; x++)
          if (vis[y]?.[x]) return {x,y};
      return null;
    };

    // lista de salas no alcanzadas
    let pending = rooms.filter(r=>!roomHasReach(r));

    // mientras queden aisladas, conecta con el punto alcanzable más cercano
    while(pending.length){
      const r = pending[0];
      const c = center(r);

      // busca punto alcanzable más cercano a 'c'
      let best = null, bestD2 = Infinity;
      for (let y=0;y<map.length;y++){
        for (let x=0;x<map[0].length;x++){
          if (!vis[y][x]) continue;
          const d2 = (x-c.x)*(x-c.x)+(y-c.y)*(y-c.y);
          if (d2 < bestD2){ bestD2=d2; best={x,y}; }
        }
      }
      if (!best) break; // (mapa vacío raro)

      carveOrthCorridor(map, best.x, best.y, c.x, c.y, 3);
      // recalcula alcanzables tras carvar el nuevo corredor
      vis = bfsReach(map, start.x, start.y);
      pending = rooms.filter(rr=>!roomHasReach(rr));
    }
  }

  // Asegura "cuello" de 1 tile dentro de la sala para cada puerta detectada en el anillo.
  function enforceNecksWidth1(ascii, room, doors, cs){
    const H = ascii.length, W = ascii[0].length;
    const put = (x,y,ch)=>{ if (y>=0&&y<H&&x>=0&&x<W) ascii[y][x]=ch; };

    for (const d of doors){
      let dirX=0, dirY=0, xin=0, yin=0, side='';

      if (d.y === room.y-1){           // puerta en el lado superior → entra hacia +Y
        side='N'; xin = d.x; yin = room.y;        dirY = 1;
      } else if (d.y === room.y+room.h){ // inferior → entra hacia -Y
        side='S'; xin = d.x; yin = room.y+room.h-1; dirY = -1;
      } else if (d.x === room.x-1){     // izquierda → entra hacia +X
        side='W'; xin = room.x; yin = d.y;        dirX = 1;
      } else if (d.x === room.x+room.w){ // derecha → entra hacia -X
        side='E'; xin = room.x+room.w-1; yin = d.y; dirX = -1;
      } else continue;

      // 1 ó 2 tiles de profundidad con 1 tile de ancho
      for (let t=0; t<2; t++){
        const xx = xin + dirX*t, yy = yin + dirY*t;
        put(xx, yy, cs.floor);
        if (side==='N' || side==='S'){ put(xx-1,yy,cs.wall); put(xx+1,yy,cs.wall); }
        else                          { put(xx,yy-1,cs.wall); put(xx,yy+1,cs.wall); }
      }
    }
  }

  function inb(g,x,y){ return y>=0 && y<g.length && x>=0 && x<g[0].length; }

  // Engorda el suelo para que ningún pasillo quede < MIN_CORRIDOR
  function thickenFloor(grid, minWidth){
    const r = Math.max(0, Math.floor((minWidth-1)/2));
    if (r<=0) return grid;
    const H = grid.length, W = grid[0].length;
    const out = cloneGrid(grid);
    for (let y=0;y<H;y++){
      for (let x=0;x<W;x++){
        if (grid[y][x] !== 2) continue;           // 2 = suelo
        for (let dy=-r; dy<=r; dy++){
          for (let dx=-r; dx<=r; dx++){
            const xx=x+dx, yy=y+dy;
            if (!inb(grid,xx,yy)) continue;
            if (out[yy][xx]===1) out[yy][xx]=2;   // 1=muro → suelo
          }
        }
      }
    }
    return out;
  }

  // Deja una bocana de 1 tile y coloca una puerta
  function neckAndDoorAt(grid, roomRect, placements){
    const {x,y,w,h} = roomRect; // en tiles
    const sides = ['N','S','W','E'];
    for (let tries=0; tries<8; tries++){
      const side = sides[Math.floor(Math.random()*sides.length)];
      let px, py;
      if (side==='N'){ px=Math.floor(x+w/2); py=y-1; }
      if (side==='S'){ px=Math.floor(x+w/2); py=y+h; }
      if (side==='W'){ px=x-1;              py=Math.floor(y+h/2); }
      if (side==='E'){ px=x+w;              py=Math.floor(y+h/2); }
      if (!inb(grid,px,py)) continue;
      grid[py][px] = 2; // abre hueco de 1 tile
      placements.push({ kind:'door', x:px, y:py, opts:{ locked:false }});
      return;
    }
  }

  function pickOne(arr){ return arr[(Math.random()*arr.length)|0]; }

  // Engorda SOLO corredores (0=suelocorredor, 1=muro). No toca suelos de habitación.
  function thickenCorridors(grid, minWidth, rooms){
    const H = grid.length, W = grid[0].length;

    // 1) Máscara de habitaciones para no invadirlas
    const roomMask = Array.from({length:H},()=>Array(W).fill(false));
    for (const r of rooms){
      for (let yy=r.y; yy<r.y+r.h; yy++){
        for (let xx=r.x; xx<r.x+r.w; xx++){
          if (yy>=0 && yy<H && xx>=0 && xx<W) roomMask[yy][xx] = true;
        }
      }
    }

    // 2) Radio en función del ancho deseado (3..5 → r=1..2)
    const r = Math.max(0, Math.floor((minWidth-1)/2));
    if (r<=0) return grid;

    // 3) Snapshot para leer (src) y un buffer de salida (out)
    const src = cloneGrid(grid);
    const out = cloneGrid(grid);

    // 4) Ensancha SOLO alrededor de los corredores originales de src
    for (let y=1; y<H-1; y++){
      for (let x=1; x<W-1; x++){
        // corredor original (suelo fuera de habitaciones)
        if (src[y][x]!==0 || roomMask[y][x]) continue;

        for (let dy=-r; dy<=r; dy++){
          for (let dx=-r; dx<=r; dx++){
            const yy = y+dy, xx = x+dx;
            if (yy<=0 || yy>=H-1 || xx<=0 || xx>=W-1) continue;
            if (roomMask[yy][xx]) continue;     // NO tocar dentro de habitaciones
            if (src[yy][xx] === 1) out[yy][xx] = 0; // muro → suelo (una sola pasada)
          }
        }
      }
    }

    // 5) Vuelca el resultado al grid original
    for (let y=0; y<H; y++){
      for (let x=0; x<W; x++){
        grid[y][x] = out[y][x];
      }
    }
    return grid;
  }

  // Cuenta y repara uniones solo por esquina.
  // Si dos suelos se tocan en diagonal y ambos vecinos ortogonales son muro,
  // abrimos UN vecino ortogonal para convertir la unión en válida.
  // Cierra uniones SOLO por esquina (no abre pasos). Trabaja en el grid 0/1.
  function sealDiagonalCorners(map, maxPasses=3){
    const H = map.length, W = map[0].length;
    for (let pass=0; pass<maxPasses; pass++){
      let changed = 0;
      for (let y=1; y<H-1; y++){
        for (let x=1; x<W-1; x++){
          // caso diag ↘ : suelos en (x,y) y (x+1,y+1) pero ortogonales bloqueados
          if (map[y][x]===0 && map[y+1][x+1]===0 && map[y][x+1]===1 && map[y+1][x]===1){
            // sellamos UNO de los dos suelos diagonales
            if (Math.random()<0.5) map[y][x] = 1; else map[y+1][x+1] = 1;
            changed++; continue;
          }
          // caso diag ↗
          if (map[y][x]===0 && map[y-1][x+1]===0 && map[y][x+1]===1 && map[y-1][x]===1){
            if (Math.random()<0.5) map[y][x] = 1; else map[y-1][x+1] = 1;
            changed++; continue;
          }
        }
      }
      if (!changed) break;
    }
  }

  // Crear cuello de botella visual en ASCII alrededor de la puerta
  function applyNeck(ascii, x, y, cs){
    const H = ascii.length, W = ascii[0].length;
    const wall = cs.wall, floor = cs.floor;
    const at = (xx,yy)=> (yy>=0&&yy<H&&xx>=0&&xx<W) ? ascii[yy][xx] : wall;
    const isWalk = (xx,yy)=> {
      const c = at(xx,yy);
      return (c===floor || c===cs.door || c===cs.bossDoor);
    };

    // ¿pared principal arriba/abajo (corredor vertical) o izq/der (corredor horizontal)?
    const horizontalWall =
      (at(x, y-1) === wall && isWalk(x, y+1)) ||
      (at(x, y+1) === wall && isWalk(x, y-1));

    if (horizontalWall){
      // corredor vertical -> tapa laterales, deja 1-tile
      if (x-1 >= 0 && ascii[y][x-1] !== cs.door && ascii[y][x-1] !== cs.bossDoor) ascii[y][x-1] = wall;
      if (x+1 <  W && ascii[y][x+1] !== cs.door && ascii[y][x+1] !== cs.bossDoor) ascii[y][x+1] = wall;
    } else {
      // corredor horizontal -> tapa arriba/abajo, deja 1-tile
      if (y-1 >= 0 && ascii[y-1][x] !== cs.door && ascii[y-1][x] !== cs.bossDoor) ascii[y-1][x] = wall;
      if (y+1 <  H && ascii[y+1][x] !== cs.door && ascii[y+1][x] !== cs.bossDoor) ascii[y+1][x] = wall;
    }
  }

// Reduce cualquier hueco del perímetro a 1 tile EXACTO por banda de pasillo.
// Si una banda no es pasillo real (solo “hoyo” 1-tile), se sella completa.
// Además blinda esquinas para evitar uniones por diagonal.
function fixRoomPerimeterGaps(ascii, room, cs){
  const H = ascii.length, W = ascii[0].length;
  const at  = (x,y)=> (y>=0&&y<H&&x>=0&&x<W) ? ascii[y][x] : cs.wall;
  const isW = (x,y)=> at(x,y) === cs.wall;
  const isD = (x,y)=> { const c = at(x,y); return c===cs.door || c===cs.bossDoor; };
  const isF = (x,y)=> at(x,y) === cs.floor;

  // Devuelve el índice dentro de [i..j) que debe quedarse abierto como puerta
  // (elige la puerta existente más cercana al centro; si no hay, el mejor
  //  punto dentro de la banda que realmente sea pasillo "profundo")
  function pickOneInRun(line, i, j, nX, nY, centerCoord, orient){
    // posiciones del run que continúan siendo pasillo al avanzar 1–2 hacia fuera
    const corridorIdx = [];
    for (let k=i; k<j; k++){
      const p = line[k];
      const x1 = p.x + nX, y1 = p.y + nY;
      const x2 = p.x + 2*nX, y2 = p.y + 2*nY;
      // exigimos al menos 2 de profundidad para evitar “hoyos” sin salida
      if (isF(x1,y1) && isF(x2,y2)) corridorIdx.push(k);
    }
    if (corridorIdx.length === 0) return -1; // no es pasillo real → cerrar todo

    // ¿hay puertas existentes en el tramo?
    const doorIdx = [];
    for (let k=i; k<j; k++) if (isD(line[k].x, line[k].y)) doorIdx.push(k);

    // función distancia al centro de la sala en el eje visible de este lado
    const dist = (k)=>{
      const p = line[k];
      return (orient==='H') ? Math.abs(p.x - centerCoord) : Math.abs(p.y - centerCoord);
    };

    if (doorIdx.length > 0){
      // conservar UNA puerta: la más centrada respecto a la sala
      doorIdx.sort((a,b)=> dist(a)-dist(b));
      return doorIdx[0];
    } else {
      // no había puerta: abrir UNA en el mejor punto del pasillo
      corridorIdx.sort((a,b)=> dist(a)-dist(b));
      return corridorIdx[0];
    }
  }

    // Procesa una línea del anillo exterior (top/bottom = H, left/right = V)
    function processLine(line, nX, nY, orient){
      // orient: 'H' (línea horizontal) o 'V' (línea vertical)
      // nX,nY: vector normal que apunta HACIA FUERA de la sala en esa línea
      const centerCoord = (orient==='H')
        ? (room.x + (room.w>>1))
        : (room.y + (room.h>>1));

      let i = 0;
      while (i < line.length){
        // saltar muros
        while (i < line.length && isW(line[i].x, line[i].y)) i++;
        if (i >= line.length) break;

        // tramo abierto [i..j)
        let j = i;
        while (j < line.length && !isW(line[j].x, line[j].y)) j++;

        // elegir UNA única celda que quedará como puerta (o -1 para cerrar todo)
        const keep = pickOneInRun(line, i, j, nX, nY, centerCoord, orient);

        // cerrar todo el tramo…
        for (let k=i; k<j; k++){
          const p = line[k];
          ascii[p.y][p.x] = cs.wall;
        }
        // …y si hay posición elegida, marcarla como puerta
        if (keep !== -1){
          const p = line[keep];
          // si ya había puerta boss, respetar su char; si no, puerta normal
          if (!isD(p.x,p.y)) ascii[p.y][p.x] = cs.door;
          else ascii[p.y][p.x] = at(p.x,p.y); // deja el que hubiese (d/D)
        }

        i = j;
      }
    }

    // anillo exterior (1 celda FUERA del rectángulo de la sala)
    const top=[];    for (let x=room.x; x<room.x+room.w; x++) top.push({x, y:room.y-1});
    const bottom=[]; for (let x=room.x; x<room.x+room.w; x++) bottom.push({x, y:room.y+room.h});
    const left=[];   for (let y=room.y; y<room.y+room.h; y++) left.push({x:room.x-1, y});
    const right=[];  for (let y=room.y; y<room.y+room.h; y++) right.push({x:room.x+room.w, y});

    //        línea   , normal hacia fuera, orientación
    processLine(top   ,  0, -1, 'H');
    processLine(bottom,  0,  1, 'H');
    processLine(left  , -1,  0, 'V');
    processLine(right ,  1,  0, 'V');

    // blindar esquinas del anillo (evita diagonales)
    const corners = [
      {x:room.x-1,      y:room.y-1},
      {x:room.x+room.w, y:room.y-1},
      {x:room.x-1,      y:room.y+room.h},
      {x:room.x+room.w, y:room.y+room.h},
    ];
    for (const c of corners){
      if (c.x>=0 && c.x<W && c.y>=0 && c.y<H){
        const ch = ascii[c.y][c.x];
        if (ch!==cs.door && ch!==cs.bossDoor) ascii[c.y][c.x] = cs.wall;
      }
    }
  }

  // Pone muro en TODO el perímetro de la habitación excepto en la puerta d{x,y}
  function sealRoomAsciiExceptDoor(ascii, room, dOrList, cs){
    const doors = Array.isArray(dOrList) ? dOrList : [dOrList];
    const {x,y,w,h} = room, H=ascii.length, W=ascii[0].length;
    const inb=(xx,yy)=> yy>=0&&yy<H&&xx>=0&&xx<W;
    const isDoor=(xx,yy)=> doors.some(d => d && d.x===xx && d.y===yy);

    for (let xx=x; xx<x+w; xx++){
      const ty=y-1, by=y+h;
      if (inb(xx,ty) && !isDoor(xx,ty)) ascii[ty][xx] = cs.wall;
      if (inb(xx,by) && !isDoor(xx,by)) ascii[by][xx] = cs.wall;
    }
    for (let yy=y; yy<y+h; yy++){
      const lx=x-1, rx=x+w;
      if (inb(lx,yy) && !isDoor(lx,yy)) ascii[yy][lx] = cs.wall;
      if (inb(rx,yy) && !isDoor(rx,yy)) ascii[yy][rx] = cs.wall;
    }
  }

  // Spawns por habitación (añade a los "spawns" globales)
  function placePerRoomSpawns(rng, rooms, ctrl, boss, level, map, ascii, cs){
    const extra = { mosquito:[], rat:[], staff:[], cart:[] };
    const roomList = rooms.filter(r=> r!==ctrl && r!==boss);

    for (const room of roomList){
      const { enemies, npcs, celadores } = GEN_RULES.perRoom(level);

      // Enemigos: mezcla M/R
      for (let i=0;i<enemies;i++){
        const sub = Math.random()<0.5 ? 'M' : 'R';
        // mete en ASCII para que tu parseMap actual funcione
        const p = placeInside(map, room) || centerOf(room);
        ascii[p.ty][p.tx] = sub; // 'M' o 'R'
        if (sub==='M') extra.mosquito.push({tx:p.tx,ty:p.ty});
        else           extra.rat.push({tx:p.tx,ty:p.ty});
      }

      // NPC random (staff genérico 'N')
      for (let i=0;i<npcs;i++){
        const p = placeInside(map, room) || centerOf(room);
        ascii[p.ty][p.tx] = 'N';
        extra.staff.push({tx:p.tx,ty:p.ty});
      }

      // 1 Celador (también como staff genérico 'N' en ASCII)
      for (let i=0;i<celadores;i++){
        const p = placeInside(map, room) || centerOf(room);
        ascii[p.ty][p.tx] = 'N';
        extra.staff.push({tx:p.tx,ty:p.ty});
      }

      // 1 carro por habitación (spawn 'C')
      {
        const p = placeInside(map, room) || centerOf(room);
        ascii[p.ty][p.tx] = 'C';
        extra.cart.push({tx:p.tx,ty:p.ty});
      }
    }

    return extra;
  }

  const MapGenAPI = { _G: null, init(G){ this._G = G || W.G || (W.G={}); }, generate };
  W.MapGenAPI = MapGenAPI;

  // ─────────────────────────────────────────
  // Config & constantes
  // ─────────────────────────────────────────
  const BASE = 350; // lado base por nivel
  const TILE = (typeof W.TILE_SIZE!=='undefined') ? W.TILE_SIZE : (W.TILE||32);

// === AMPLIACIÓN CHARSET PARA DEBUG ASCII ===
const EXTRA_CHARSET = {
  door:'d', bossDoor:'D', elev:'E', elevClosed:'e',
  player:'S', followerA:'F', followerB:'G', bossMarker:'X',
  spMosquito:'M', spRat:'R', spStaff:'N', spCart:'C',
  nurse:'n', tcae:'t', celador:'c', cleaner:'h', guardia:'g', medico:'k',
  jefe_servicio:'J', supervisora:'V',
  mosquito:'m', rat:'r',
  cartUrg:'U', cartMed:'m', cartFood:'q',
  light:'L', lightBroken:'l',
  coin:'o', bag:'$', food:'f', power:'u',
  patient:'p', pill:'i', bell:'b',
  phone:'T'
};

// **defecto + extra**
const CHARSET_DEFAULT = {
  wall:'#', floor:'.',
  door:'d', bossDoor:'D',
  elev:'E', elevClosed:'e',
  start:'S', light:'L', lightBroken:'l',
  spMosquito:'M', spRat:'R', spStaff:'N', spCart:'C',
  patient:'p', pill:'i', bell:'b', phone:'T', bossMarker:'X'
};
const CHARSET = Object.assign({}, (window.CHARSET_DEFAULT || {}), EXTRA_CHARSET);

  // Nivel → densidades base (se pueden sobreescribir con options.density)
  const LAYERS = {
    1: { rooms: 120, lights: 520, worms: 0.10, extraLoops: 0.08 },
    2: { rooms: 260, lights: 1100, worms: 0.12, extraLoops: 0.10 },
    3: { rooms: 420, lights: 1800, worms: 0.14, extraLoops: 0.12 },
  };

  // Escalado de spawns por nivel
  const SPAWN_SCALE = {
    mosquito: lvl => Math.max(1, Math.floor([2,4,7][lvl-1] || 2)),
    rat:      lvl => Math.max(1, Math.floor([2,5,8][lvl-1] || 2)),
    staff:    lvl => Math.max(1, Math.floor([1,2,3][lvl-1] || 1)),
    carts:    lvl => Math.max(1, Math.floor([1,2,3][lvl-1] || 1)),
  };

  // RNG (mulberry32)
  function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
  function hashStr(s){let h=2166136261>>>0;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
  function RNG(seed){ const s = (typeof seed==='number' ? seed>>>0 : hashStr(String(seed))); const r = mulberry32(s); return { rand:r, int(a,b){return a+Math.floor(r()*(b-a+1));}, chance(p){return r()<p;}, pick(arr){return arr[(r()*arr.length)|0];}, shuffle(arr){for(let i=arr.length-1;i>0;i--){const j=(r()* (i+1))|0; [arr[i],arr[j]]=[arr[j],arr[i]];}return arr;} }; }

  const N4 = [[1,0],[-1,0],[0,1],[0,-1]];
  const clamp=(v,a,b)=>v<a?a:(v>b?b:v);
  const inB=(W,H,x,y)=> x>0 && y>0 && x<W-1 && y<H-1;

  // ─────────────────────────────────────────
  // Detección de entidades NOT NULL
  // ─────────────────────────────────────────
  function has(v){ return typeof v!=='undefined' && v!==null; }
  function detectDefs(){
    const ENT = W.ENT||{};
    const out = {
      enemies: {
        mosquito: has(W.MosquitoAPI) || has(ENT.MOSQUITO),
        rat:      has(W.RatAPI)      || has(ENT.RAT),
      },
      npcs: {
        celador: has(W.CeladorAPI) || has(ENT.CELADOR),
        tcae: has(W.TCAEAPI) || has(ENT.TCAE),
        nurse: has(W.SexyNurseAPI) || has(ENT.NURSE_SEXY),
        supervisor: has(W.SupervisoraAPI) || has(ENT.SUPERVISOR),
        jefe: has(W.JefeServicioAPI) || has(ENT.JEFE_SERVICIO),
        medico: has(W.MedicoAPI) || has(ENT.DOCTOR),
        patient: true,  // el motor base siempre puede dibujar pacientes
        staff: true     // spawner genérico de personal
      },
      carts: { food: has(W.CartsAPI)||has(ENT.CART), meds: has(W.CartsAPI)||has(ENT.CART), er: has(W.CartsAPI)||has(ENT.CART) },
      boss: { a:true, b: has(W.Boss2API), c: has(W.Boss3API) },
      items:{ bell:true, phone:true },
      structs:{ elevator:true },
      lights:{ enabled:true },
    };
    return out;
  }

  // ─────────────────────────────────────────
  // Flood para conectividad / distancias
  // ─────────────────────────────────────────
  function flood(map, sx, sy, blockRect=null){
    const H=map.length, W=map[0].length;
    const D=Array.from({length:H},()=>Array(W).fill(Infinity));
    const q=[];
    if (isWalkable(map,sx,sy,blockRect)){ D[sy][sx]=0; q.push([sx,sy]); }
    while(q.length){
      const [x,y]=q.shift();
      for(const[dx,dy] of N4){
        const nx=x+dx, ny=y+dy;
        if(!inB(W,H,nx,ny)) continue;
        if(!isWalkable(map,nx,ny,blockRect)) continue;
        if(D[ny][nx]>D[y][x]+1){ D[ny][nx]=D[y][x]+1; q.push([nx,ny]); }
      }
    }
    return D;
  }
  function isWalkable(map,x,y,blockRect){
    if (map[y]?.[x]===1) return false;
    if (blockRect){
      const {x1,y1,x2,y2} = blockRect;
      if (x>=x1 && x<=x2 && y>=y1 && y<=y2) return false;
    }
    return true;
  }

  // ─────────────────────────────────────────
  // Carving básico: habitaciones + corredores + cul-de-sacs
  // ─────────────────────────────────────────
  function carveRect(map, r, v=0){
    for(let y=r.y;y<r.y+r.h;y++)
      for(let x=r.x;x<r.x+r.w;x++)
        if (inB(map[0].length,map.length,x,y)) map[y][x]=v;
  }
  function overlap(a,b){return !(a.x+a.w<=b.x || b.x+b.w<=a.x || a.y+a.h<=b.y || b.y+b.h<=a.y);}
  function expand(r, p){return {x:r.x-p, y:r.y-p, w:r.w+2*p, h:r.h+2*p};}
  function centerOf(r){return {x: (r.x + ((r.w/2)|0)), y: (r.y + ((r.h/2)|0))};}
  function digH(map, x1, x2, y, w){
    const useW = clamp(w || GEN_RULES.MIN_CORRIDOR, GEN_RULES.MIN_CORRIDOR, GEN_RULES.MAX_CORRIDOR);
    const r = Math.max(0, ((useW - 1) / 2) | 0);
    for (let yy = y - r; yy <= y + r; yy++){
      for (let x = x1; x <= x2; x++){
        if (inB(map[0].length, map.length, x, yy)) map[yy][x] = 0; // 0 = suelo
      }
    }
  }
  function digV(map, y1, y2, x, w){
    const useW = clamp(w || GEN_RULES.MIN_CORRIDOR, GEN_RULES.MIN_CORRIDOR, GEN_RULES.MAX_CORRIDOR);
    const r = Math.max(0, ((useW - 1) / 2) | 0);
    for (let xx = x - r; xx <= x + r; xx++){
      for (let y = y1; y <= y2; y++){
        if (inB(map[0].length, map.length, xx, y)) map[y][xx] = 0; // 0 = suelo
      }
    }
  }

  function mst(points){
    // Kruskal light
    const edges=[];
    for(let i=0;i<points.length;i++)
      for(let j=i+1;j<points.length;j++){
        const a=points[i], b=points[j];
        const d=(a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y);
        edges.push({a,b,d});
      }
    edges.sort((u,v)=>u.d-v.d);
    const parent = new Map(points.map(p=>[p,p]));
    function find(x){ while(parent.get(x)!==x) x=parent.get(x); return x; }
    const res=[];
    for(const e of edges){
      const pa=find(e.a), pb=find(e.b);
      if (pa!==pb){ parent.set(pa,pb); res.push(e); if (res.length>=points.length-1) break; }
    }
    return res;
  }

  function sprinkleWorms(rng, map, count, rooms){
    const rand = (typeof rng === 'function') ? rng : rng.rand; // <- AQUÍ el cambio
    const H = map.length, W = map[0].length;
    const insideRoom = (x,y)=>{
      for (const r of rooms){
        if (x>=r.x && x<r.x+r.w && y>=r.y && y<r.y+r.h) return true;
      }
      return false;
    };
    for (let i=0;i<count;i++){
      let x = (rand()*W)|0, y = (rand()*H)|0, len = 8 + ((rand()*24)|0);
      for (let k=0;k<len;k++){
        if (x<=1||x>=W-2||y<=1||y>=H-2) break;
        if (!insideRoom(x,y)) map[y][x] = 0; // nunca dentro de habitaciones
        x += (rand()<0.5?1:-1);
        y += (rand()<0.5?1:-1);
      }
    }
  }

  // ─────────────────────────────────────────
  // Puertas (1 por sala) + puerta Boss especial
  // ─────────────────────────────────────────
  function openSingleDoor(rng, grid, room, doorChar){
    const cand = [];
    const {x,y,w,h} = room;
    const inb = (xx,yy)=> yy>=0&&yy<grid.length&&xx>=0&&xx<grid[0].length;

    function tryEdge(px,py, nx,ny){ // px,py = pared; nx,ny = fuera mirando corredor
      if (!inb(px,py) || !inb(nx,ny)) return;
      if (grid[py][px]!==1) return;      // pared
      if (grid[ny][nx]!==0) return;      // fuera debe ser corredor
      cand.push({x:px,y:py});
    }

    // perímetro completo
    for (let xx=x; xx<x+w; xx++){ tryEdge(xx,y-1, xx,y-2); tryEdge(xx,y+h, xx,y+h+1); }
    for (let yy=y; yy<y+h; yy++){ tryEdge(x-1,yy, x-2,yy); tryEdge(x+w,yy, x+w+1,yy); }

    if (!cand.length) return null;
    const d = rng.pick(cand);
    grid[d.y][d.x] = 0;          // abre hueco exacto de 1 tile en la pared
    return d;                    // devolvemos {x,y} de la puerta en el GRID
  }

  function openMultipleDoors(rng, grid, room, count){
    const out = [];
    for (let i=0;i<count;i++){
      const d = openSingleDoor(rng, grid, room);
      if (!d) break;
      if (out.some(p => p.x===d.x && p.y===d.y)) { i--; continue; } // evita duplicados
      out.push(d);
    }
    return out;
  }

  // Forzar “exactamente 1 puerta” por sala: si hay más, las tapa salvo 1 aleatoria
  function enforceOneDoorPerRoom(rng, ascii, r, cs){
    const doors=[];
    for(let x=r.x; x<r.x+r.w; x++){ if (ascii[r.y-1]?.[x]===cs.door||ascii[r.y-1]?.[x]===cs.bossDoor) doors.push({x,y:r.y-1});
                                     if (ascii[r.y+r.h]?.[x]===cs.door||ascii[r.y+r.h]?.[x]===cs.bossDoor) doors.push({x,y:r.y+r.h}); }
    for(let y=r.y; y<r.y+r.h; y++){ if (ascii[y]?.[r.x-1]===cs.door||ascii[y]?.[r.x-1]===cs.bossDoor) doors.push({x:r.x-1,y});
                                     if (ascii[y]?.[r.x+r.w]===cs.door||ascii[y]?.[r.x+r.w]===cs.bossDoor) doors.push({x:r.x+r.w,y}); }
    if (doors.length<=1) return;
    const keep = rng.pick(doors);
    for(const d of doors){
      if (d.x===keep.x && d.y===keep.y) continue;
      // “cerrar” puerta: volver a muro
      ascii[d.y][d.x]=cs.wall;
    }
  }

  // ─────────────────────────────────────────
  // Helpers de colocación
  // ─────────────────────────────────────────
  function put(ascii,x,y,ch){ if (ascii[y] && ascii[y][x]!==undefined) ascii[y][x]=ch; }
  function rowsToString(A){ return A.map(r=>r.join('')).join('\n'); }
  function sealMapBorder(ascii, cs){
    const H=ascii.length, W=ascii[0].length;
    for (let x=0;x<W;x++){ ascii[0][x]=cs.wall; ascii[H-1][x]=cs.wall; }
    for (let y=0;y<H;y++){ ascii[y][0]=cs.wall; ascii[y][W-1]=cs.wall; }
  }
  function asciiToNumeric(A){ const H=A.length,W=A[0].length, grid=Array.from({length:H},()=>Array(W)); for(let y=0;y<H;y++) for(let x=0;x<W;x++) grid[y][x]=A[y][x]==='#'?1:0; return grid; }
  function placeInside(map, r, tries=200){
    for(let k=0;k<tries;k++){
      const tx = clamp(r.x + 1 + (Math.random()*Math.max(1,r.w-2))|0, r.x+1, r.x+r.w-2);
      const ty = clamp(r.y + 1 + (Math.random()*Math.max(1,r.h-2))|0, r.y+1, r.y+r.h-2);
      if (map[ty]?.[tx]===0) return {tx,ty};
    }
    return null;
  }
  function placeNear(map, x,y, radius){
    for(let k=0;k<100;k++){
      const nx = x + ((Math.random()*2*radius)|0) - radius;
      const ny = y + ((Math.random()*2*radius)|0) - radius;
      if (map[ny]?.[nx]===0) return {tx:nx,ty:ny};
    }
    return null;
  }
  function farFrom(rng, map, ref, minDist){
    const W=map[0].length,H=map.length, cand=[];
    for(let y=2;y<H-2;y++){
      for(let x=2;x<W-2;x++){
        if (map[y][x]!==0) continue;
        const d2=(x-ref.x)*(x-ref.x)+(y-ref.y)*(y-ref.y);
        if (d2>=minDist*minDist) cand.push({tx:x,ty:y,score:d2});
      }
    }
    if(!cand.length) return null;
    cand.sort((a,b)=>b.score-a.score);
    return cand[rng.int(0, Math.min(10,cand.length-1))];
  }

  function ensureConnectivity(rng, map, start, blockRect, maxPatches=600){
    // Abre “costuras” si quedan islas inaccesibles (excepto boss-room bloqueada)
    const W=map[0].length,H=map.length;
    let D = flood(map, start.x, start.y, blockRect);
    const isInf=(x,y)=>D[y][x]===Infinity;
    let infCount=0;
    for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++) if(map[y][x]===0 && isInf(x,y)) infCount++;
    if (infCount<=0) return;

    let patches=0;
    while(infCount>0 && patches<maxPatches){
      patches++;
      // busca muro que conecte dos regiones (una accesible y otra inaccesible)
      let opened=false;
      for(let y=2;y<H-2 && !opened;y++){
        for(let x=2;x<W-2 && !opened;x++){
          if(map[y][x]!==1) continue; // muro candidato
          // ¿hay suelo accesible en un lado e inaccesible en el otro?
          let acc=0, inac=0;
          for(const[dx,dy] of N4){
            const nx=x+dx, ny=y+dy;
            if(!inB(W,H,nx,ny)) continue;
            if(map[ny][nx]===0){
              if(D[ny][nx]===Infinity) inac++; else acc++;
            }
          }
          if(acc>0 && inac>0){
            map[y][x]=0; opened=true;
          }
        }
      }
      D = flood(map, start.x, start.y, blockRect);
      infCount=0;
      for(let y=1;y<H-1;y++) for(let x=1;x<W-1;x++) if(map[y][x]===0 && D[y][x]===Infinity) infCount++;
    }
  }

  // ─────────────────────────────────────────
  // Nombres de pacientes (ejemplo)
  // ─────────────────────────────────────────
  function funnyPatientName(i){
    const base = [
      'Dolores De Barriga','Ana Lítica','Rafael Alergia','Aitor Tilla',
      'Elsa Pato','Luz Cuesta Mogollón','Armando Bronca','Paco Trón',
      'Sara Pilla','Prudencio Gasa'
    ];
    return base[i % base.length];
  }

  // ─────────────────────────────────────────
  // GENERATE (núcleo principal)
  // ─────────────────────────────────────────
  function generate(level=1, options={}){
    // salidas básicas para el motor (ASCII + placements)
    const placements = [];
    const lvl = clamp(level|0 || 1, 1, 3);
    const defs = options.defs || detectDefs();
    const cs   = { ...CHARSET_DEFAULT, ...(options.charset||{}) };
    const seed = options.seed ?? (W.G?.seed ?? (Date.now()>>>0));
    const rng  = RNG(seed);

    // Tamaño
    const Wd = clamp(options.w|0 || BASE*lvl, 40, BASE*3);
    const Hd = clamp(options.h|0 || BASE*lvl, 40, BASE*3);

    // Grid: 1 muro, 0 suelo
    const map = Array.from({length:Hd},()=>Array(Wd).fill(1));
    const rooms=[];

    // Densidades por nivel
    const dens = {
      rooms: options.density?.rooms ?? LAYERS[lvl].rooms,
      lights: options.density?.lights ?? LAYERS[lvl].lights,
      worms: options.density?.worms ?? LAYERS[lvl].worms,
      extraLoops: options.density?.extraLoops ?? LAYERS[lvl].extraLoops,
    };
    dens.rooms = 35; // fuerza 35 habitaciones
    // 1) Sala de Control (cerca del centro, con jitter) + tallado
    const ctrl = carveRoomAtCenterish(rng, map, Wd, Hd, { tag:'control' });
    rooms.push(ctrl);

    // 2) Habitaciones aleatorias (sin solaparse, con padding) y carving
    attemptRooms(rng, map, rooms, dens.rooms);

    // 3) Corredores MST + algunos loops extra
    connectRoomsWithCorridors(rng, map, rooms, dens.extraLoops);

    // 4) Cul-de-sacs (gusanos/ruido) → nunca dentro de habitaciones
    //const wormsCount = Math.floor((Wd*Hd)/3000 * dens.worms * 10);
    const wormsCount = 0;
    sprinkleWorms(rng, map, wormsCount, rooms);

    // 4.5) Engordar SOLO corredores a ≥ 3 tiles (habitaciones intactas)
    thickenCorridors(map, 3, rooms);   // limita pasillos a 3 tiles máximo

    // 4.6) Garantiza conectividad global: todas las salas alcanzables desde Control
    const ctrlC = centerOf(ctrl);
    ensureAllRoomsReachable(map, rooms, ctrlC);

    // Anti-diagonal: evita uniones por esquina y vuelve a verificar accesibilidad
    sealDiagonalCorners(map);
    ensureAllRoomsReachable(map, rooms, ctrlC);

    // 5) Boss-room = la más lejana a Control
    let boss = pickFarthestRoom(rooms, ctrlC);
    if (!boss) boss = rooms[rooms.length-1];

    // 6) Convertir a ASCII base
    const ascii = Array.from({length:Hd},()=>Array(Wd).fill(cs.wall));
    for(let y=0;y<Hd;y++) for(let x=0;x<Wd;x++) if(map[y][x]===0) ascii[y][x]=cs.floor;
    sealMapBorder(ascii, cs);
    // 7) Puertas: Boss = 1 puerta; resto = 1..4 puertas (todas cuello 1-tile)
    const doors = [];
    for (const r of rooms) {
      const isBoss  = (r === boss);
      const nDoors  = isBoss ? 1 : rng.int(1, 4); // 1..4 puertas (boss=1)

      // Abrimos en el GRID (0/1) para que el hueco sea exactamente de 1 tile
      const ds = openMultipleDoors ? openMultipleDoors(rng, map, r, nDoors)
                                  : [ openSingleDoor(rng, map, r, cs.door) ].filter(Boolean);
      if (!ds.length) continue;

      // Dibuja puertas en ASCII y crea el "cuello 1-tile" visual
      for (const d of ds) {
        put(ascii, d.x, d.y, isBoss ? cs.bossDoor : cs.door);
        // (sin applyNeck aquí: el cuello se hace solo dentro con enforceNecksWidth1)
        doors.push({ x: d.x, y: d.y, boss: isBoss, room: r });
      }

      // Fuerza 1 puerta por habitación (cierra las demás si las hubiera)
      //enforceOneDoorPerRoom(rng, ascii, r, cs);

      // Sella todo el perímetro salvo la(s) puerta(s) que hayan quedado → cuello 1 tile garantizado
      const finalDoors = [];
      // recolecta las puertas que realmente hayan quedado tras enforceOneDoorPerRoom
      for (let x = r.x; x < r.x + r.w; x++) {
        if (ascii[r.y - 1]?.[x] === cs.door || ascii[r.y - 1]?.[x] === cs.bossDoor) finalDoors.push({ x, y: r.y - 1 });
        if (ascii[r.y + r.h]?.[x] === cs.door || ascii[r.y + r.h]?.[x] === cs.bossDoor) finalDoors.push({ x, y: r.y + r.h });
      }
      for (let y = r.y; y < r.y + r.h; y++) {
        if (ascii[y]?.[r.x - 1] === cs.door || ascii[y]?.[r.x - 1] === cs.bossDoor) finalDoors.push({ x: r.x - 1, y });
        if (ascii[y]?.[r.x + r.w] === cs.door || ascii[y]?.[r.x + r.w] === cs.bossDoor) finalDoors.push({ x: r.x + r.w, y });
      }
      enforceNecksWidth1(ascii, r, finalDoors.length ? finalDoors : ds, cs);
      // Remata el perímetro: si quedó un hueco >1, redúcelo a 1 tile (respeta puertas)
      fixRoomPerimeterGaps(ascii, r, cs);
    }

    // 8) Elementos de Control: start + teléfono
    const start = centerOf(ctrl);
    put(ascii, start.x, start.y, cs.start);
    const phone = placeInside(map, ctrl) || start;
    if (defs.items.phone) put(ascii, phone.tx, phone.ty, cs.phone);

    // 9) Boss marker + puerta Boss ya puesta
    const bossC = centerOf(boss);
    put(ascii, bossC.x, bossC.y, cs.boss);

    // 10) Conectividad global (bloqueando boss-room para validar resto)
    const blockBoss = { x1: boss.x, y1: boss.y, x2: boss.x+boss.w-1, y2: boss.y+boss.h-1 };
    ensureConnectivity(rng, map, start, blockBoss);

    // 11) Ascensores: 3 pares (1 activo, 2 cerrados) en salas diferentes
    const elevators = placeElevators(rng, map, rooms, ctrl, boss, ascii, cs);

    // 12) Luces (nunca en paredes). Mezcla rotas / normales. Evitar start inmediato
    const lights = placeLights(rng, map, ascii, cs, dens.lights, start);

    // 13) Spawns base globales (mosquitos/ratas/staff/carros) por nivel
    const spawns = placeSpawners(rng, map, ascii, cs, defs, lvl, start, ctrl, boss);

    // 13.1) Spawns extra por habitación (L = nivel) + 1 NPC + 1 celador + 1 carro
    const extraSpawns = placePerRoomSpawns(rng, rooms, ctrl, boss, lvl, map, ascii, cs);

    // mézclalos
    spawns.mosquito.push(...extraSpawns.mosquito);
    spawns.rat.push(...extraSpawns.rat);
    spawns.staff.push(...extraSpawns.staff);
    spawns.cart.push(...extraSpawns.cart);

    // 14) Pacientes + pastillas + timbres (7 sets), cada set cercano
    const {patients, pills, bells} = placePatientsSet(rng, map, ascii, cs, rooms, ctrl, boss);

    // --- PASO EXTRA: reforzar perímetros y cuellos tras TODO ---
    for (const r of rooms){
      // localizar las puertas definitivas en ASCII
      const ds = [];
      for (let x=r.x; x<r.x+r.w; x++){
        if (ascii[r.y-1]?.[x]===cs.door || ascii[r.y-1]?.[x]===cs.bossDoor) ds.push({x, y:r.y-1});
        if (ascii[r.y+r.h]?.[x]===cs.door || ascii[r.y+r.h]?.[x]===cs.bossDoor) ds.push({x, y:r.y+r.h});
      }
      for (let y=r.y; y<r.y+r.h; y++){
        if (ascii[y]?.[r.x-1]===cs.door || ascii[y]?.[r.x-1]===cs.bossDoor) ds.push({x:r.x-1, y});
        if (ascii[y]?.[r.x+r.w]===cs.door || ascii[y]?.[r.x+r.w]===cs.bossDoor) ds.push({x:r.x+r.w, y});
      }

      // 1) cuello 1-tile dentro de la sala (1–2 tiles de profundidad)
      enforceNecksWidth1(ascii, r, ds, cs);

      // 2) perímetro: NINGÚN hueco > 1 y NADA si no hay puerta
      fixRoomPerimeterGaps(ascii, r, cs);
    }

    // 15) Validaciones finales
    const report=[];
    validateDoorsPerRoom(ascii, rooms, cs, report);
    validateSetsReachability(map, start, blockBoss, patients, pills, bells, report);

    // 15.5) Marca explícita de boss para los chequeos de puertas (por si no tiene tag)
    boss.tag = 'boss';

    // Informe ortogonalidad/conectividad 4-dir
    const diagV = countDiagonalViolations(map);
    const unreach = countUnreachable(map, start, blockBoss);
    report.push({
      summary: {
        ok: (diagV===0 && unreach===0),
        unreachable_count: unreach,
        diagonal_violations: diagV,
        seed, width:Wd, height:Hd
      }
    });

    // 16) Luz del boss (rojo/azul cíclico)
    const bossLight = { tx: bossC.x, ty: bossC.y, cycle: ['#5cc1ff','#ff4d4d'], period: 2.6 };

    // 17) Únicos globales (si tu motor admite placements tipo 'npc')
    const roomA = rooms.find(r=> r!==ctrl && r!==boss) || ctrl;
    const roomB = rooms.find(r=> r!==ctrl && r!==boss && r!==roomA) || boss;
    const a = placeInside(map, roomA) || centerOf(roomA);
    const b = placeInside(map, roomB) || centerOf(roomB);
    placements.push({ type:'npc', sub:'supervisora', x:a.tx*TILE, y:a.ty*TILE });
    placements.push({ type:'npc', sub:'jefe_servicio', x:b.tx*TILE, y:b.ty*TILE });

    const result = {
      ascii: rowsToString(ascii),
      map: asciiToNumeric(ascii),
      placements,
      areas: { control:ctrl, boss },
      elevators,
      report,
      charset: cs,
      seed, level:lvl, width:Wd, height:Hd
    };

    // 18) Callbacks (si place:true)
    if (options.place && options.callbacks){
      try { placeWithCallbacks(result, options.callbacks); } catch(e){ console.warn(e); }  
    }

    return result;
  }

  // ─────────────────────────────────────────
  // Sub-rutinas de generación (detalladas)
  // ─────────────────────────────────────────
  function carveRoomAtCenterish(rng, map, Wd, Hd, meta={}){
    const rw = rng.int(14, 24), rh = rng.int(12, 20);
    const cx = rng.int(Math.floor(Wd*0.35), Math.floor(Wd*0.65));
    const cy = rng.int(Math.floor(Hd*0.35), Math.floor(Hd*0.65));
    const r  = { x: clamp(cx-(rw>>1), 2, Wd-rw-2), y: clamp(cy-(rh>>1), 2, Hd-rh-2), w:rw, h:rh, tag: meta.tag||'' };
    carveRect(map, r, 0);
    return r;
  }

  function attemptRooms(rng, map, rooms, target){
    const W=map[0].length, H=map.length;
    const tries = Math.max(target*3, 600);
    let placed=1; // ya hay control
    for(let i=0;i<tries && placed<target;i++){
      const rw = rng.int(8, 22), rh = rng.int(6, 20);
      const rx = rng.int(2, W-rw-3), ry = rng.int(2, H-rh-3);
      const rect = { x:rx, y:ry, w:rw, h:rh };
      const pad2 = expand(rect, 10); // >=10 tiles de separación entre salas
      let ok=true;
      for(const o of rooms){ if (overlap(pad2,o)) { ok=false; break; } }
      if (!ok) continue;
      carveRect(map, rect, 0);
      // guardar un poquito el “pad” en la propia sala para evitar puertas pegadas
      rooms.push(rect);
      placed++;
    }
  }

  function connectRoomsWithCorridors(rng, map, rooms, extraLoops){
    const centers = rooms.map(centerOf);
    const edges = mst(centers);
    for(const e of edges) carveL(map, e.a, e.b, rng);
    // loops extra
    const add = Math.floor(edges.length * extraLoops);
    for(let i=0;i<add;i++){
      const a = rng.pick(centers), b = rng.pick(centers);
      carveL(map, a, b, rng);
    }
  }

  function carveL(map, a, b, rng) {
    // Pasillo estrecho (2 tiles) y boca pequeña en el borde de la sala
    const w = 2;

    const ax = a.x|0, ay = a.y|0;
    const bx = b.x|0, by = b.y|0;

    // Punto medio entre centros (charnera de la "L")
    const mid = (p,q)=> (p+q)>>1;
    const mx = mid(ax,bx), my = mid(ay,by);

    // Trazo en L (H+V o V+H), limitado al entorno; NO barre paredes enteras
    if (rng && rng.chance ? rng.chance(0.5) : Math.random() < 0.5) {
      digH(map, Math.min(ax, mx), Math.max(ax, mx), ay, w);
      digV(map, Math.min(ay, by), Math.max(ay, by), mx, w);
      digH(map, Math.min(mx, bx), Math.max(mx, bx), by, w);
    } else {
      digV(map, Math.min(ay, my), Math.max(ay, my), ax, w);
      digH(map, Math.min(ax, bx), Math.max(ax, bx), my, w);
      digV(map, Math.min(my, by), Math.max(my, by), bx, w);
    }

    // Abre la boca EN EL BORDE de cada sala, alineada al centro del lateral, evitando esquinas
    openMouthToward(ax, ay, bx, by);
    openMouthToward(bx, by, ax, ay);

    function openMouthToward(cx, cy, tx, ty){
      // elegimos eje dominante hacia el destino
      const horiz = Math.abs(tx - cx) >= Math.abs(ty - cy);

      if (horiz) {
        const dir = (tx > cx) ? 1 : -1;
        let x = cx;
        // avanza desde el centro hasta chocar con pared (1) → borde
        while (map[cy][x] === 0) x += dir;
        // celda de pared y la celda exterior
        const doorX = x;
        const outX  = x + dir;
        // evita esquinas: desplaza una casilla si arriba/abajo son pared
        let y = cy;
        if (map[y-1]?.[doorX] === 1 && map[y+1]?.[doorX] === 1) {
          y += (ty > cy) ? 1 : -1;
        }
        // abre hueco de 1 tile (cuello) en la pared y un pellizco fuera
        digH(map, doorX, doorX, y, 1);
        digH(map, Math.min(outX, outX), Math.max(outX, outX), y, 1);
      } else {
        const dir = (ty > cy) ? 1 : -1;
        let y = cy;
        while (map[y][cx] === 0) y += dir;
        const doorY = y;
        const outY  = y + dir;
        let x = cx;
        if (map[doorY]?.[x-1] === 1 && map[doorY]?.[x+1] === 1) {
          x += (tx > cx) ? 1 : -1;
        }
        digV(map, doorY, doorY, x, 1);
        digV(map, Math.min(outY, outY), Math.max(outY, outY), x, 1);
      }
    }
  }

  function pickFarthestRoom(rooms, ref){
    let best=null, bestD=-1;
    for(const r of rooms){
      const c=centerOf(r);
      const d=(c.x-ref.x)*(c.x-ref.x)+(c.y-ref.y)*(c.y-ref.y);
      if(d>bestD){ bestD=d; best=r; }
    }
    return best;
  }

  function placeElevators(rng, map, rooms, ctrl, boss, ascii, cs){
    const usable = rooms.filter(r=> r!==ctrl && r!==boss);
    rng.shuffle(usable);
    const pairs = [];
    const closed = [];
    // Elegimos 3 salas distintas (si hay)
    const r1 = usable[0], r2 = usable[1], r3 = usable[2], r4 = usable[3];
    if (r1 && r2){
      const a = placeInside(map, r1) || centerOf(r1);
      const b = placeInside(map, r2) || centerOf(r2);
      put(ascii, a.tx, a.ty, cs.elev);
      put(ascii, b.tx, b.ty, cs.elev);
      pairs.push(a,b);
    }
    if (r3){
      const c = placeInside(map, r3) || centerOf(r3);
      put(ascii, c.tx, c.ty, cs.elevClosed);
      closed.push(c);
    }
    if (r4){
      const d = placeInside(map, r4) || centerOf(r4);
      put(ascii, d.tx, d.ty, cs.elevClosed);
      closed.push(d);
    }
    return { activePair: pairs, closed };
  }

  function placeLights(rng, map, ascii, cs, count, start){
    const W=map[0].length,H=map.length;
    const out=[];
    let placed=0, tries=0, maxTries=count*50;
    while(placed<count && tries<maxTries){
      tries++;
      const x=rng.int(2,W-3), y=rng.int(2,H-3);
      if (map[y][x]!==0) continue;
      if (Math.abs(x-start.x)+Math.abs(y-start.y)<6) continue; // alejar de start
      const around=[map[y-1][x],map[y+1][x],map[y][x-1],map[y][x+1]].filter(v=>v===1).length;
      if (around>=3) continue; // no pegado a pared
      const broken=rng.chance(0.14);
      put(ascii, x,y, broken? cs.lightBroken : cs.light);
      out.push({tx:x,ty:y,broken, color: pickLightColor(rng)});
      placed++;
    }
    return out;
  }
  function pickLightColor(rng){
    const pool=[
      'rgba(255,245,200,0.28)','rgba(180,220,255,0.25)',
      'rgba(220,255,210,0.25)','rgba(255,235,170,0.30)'
    ];
    return rng.pick(pool);
  }

  function placeSpawners(rng, map, ascii, cs, defs, lvl, start, ctrl, boss){
    const out={ mosquito:[], rat:[], staff:[], cart:[] };
    const W=map[0].length,H=map.length;
    const mins = { mosquito: 40, rat:30, staff:25, cart:22 };

    if (defs.enemies.mosquito){
      const n = SPAWN_SCALE.mosquito(lvl);
      for(let i=0;i<n;i++){
        const p = farFrom(RNG(rng.rand()*1e9), map, start, mins.mosquito);
        if (!p) break; put(ascii, p.tx,p.ty, cs.spMosquito); out.mosquito.push(p);
      }
    }
    if (defs.enemies.rat){
      const n = SPAWN_SCALE.rat(lvl);
      for(let i=0;i<n;i++){
        const p = farFrom(RNG(rng.rand()*1e9), map, start, mins.rat);
        if (!p) break; put(ascii, p.tx,p.ty, cs.spRat); out.rat.push(p);
      }
    }
    if (defs.npcs.staff){
      const n = SPAWN_SCALE.staff(lvl);
      for(let i=0;i<n;i++){
        const p = farFrom(RNG(rng.rand()*1e9), map, start, mins.staff);
        if (!p) break; put(ascii, p.tx,p.ty, cs.spStaff); out.staff.push(p);
      }
    }
    if (defs.carts.food || defs.carts.meds || defs.carts.er){
      const n = SPAWN_SCALE.carts(lvl);
      for(let i=0;i<n;i++){
        const p = farFrom(RNG(rng.rand()*1e9), map, start, mins.cart);
        if (!p) break; put(ascii, p.tx,p.ty, cs.spCart); out.cart.push(p);
      }
    }
    return out;
    }

  function placePatientsSet(rng, map, ascii, cs, rooms, ctrl, boss){
    const candidates = rooms.filter(r=>r!==ctrl && r!==boss);
    const picked = RNG(rng.rand()*1e9).shuffle(candidates.slice()).slice(0,7);
    const patients=[], pills=[], bells=[];
    for(let i=0;i<picked.length;i++){
      const r=picked[i];
      const P = placeInside(map, r) || centerOf(r);
      const I = placeNear(map, P.tx, P.ty, RNG(rng.rand()*1e9).int(6,12)) || P;
      const B = placeNear(map, P.tx, P.ty, 4) || P;
      put(ascii, P.tx,P.ty, cs.patient);
      put(ascii, I.tx,I.ty, cs.pill);
      put(ascii, B.tx,B.ty, cs.bell);
      patients.push({tx:P.tx,ty:P.ty, name: funnyPatientName(i) });
      pills.push({tx:I.tx,ty:I.ty, targetName: funnyPatientName(i) });
      bells.push({tx:B.tx,ty:B.ty});
    }
    return { patients, pills, bells };
  }

  function validateDoorsPerRoom(ascii, rooms, cs, report){
    let ok=true;
    for(const r of rooms){
      let c=0;
      for(let x=r.x; x<r.x+r.w; x++){
        if (ascii[r.y-1]?.[x]===cs.door||ascii[r.y-1]?.[x]===cs.bossDoor) c++;
        if (ascii[r.y+r.h]?.[x]===cs.door||ascii[r.y+r.h]?.[x]===cs.bossDoor) c++;
      }
      for(let y=r.y; y<r.y+r.h; y++){
        if (ascii[y]?.[r.x-1]===cs.door||ascii[y]?.[r.x-1]===cs.bossDoor) c++;
        if (ascii[y]?.[r.x+r.w]===cs.door||ascii[y]?.[r.x+r.w]===cs.bossDoor) c++;
      }
      const isBoss = (r.tag==='boss') || false;
      const good = isBoss ? (c===1) : (c>=1 && c<=4);
      if (!good){ ok=false; report.push({warn:'room_door_count', room:r, count:c}); }
    }
    if (ok) report.push({ ok:'rooms_have_valid_door_count' });
  }

  function validateSetsReachability(map, start, blockBoss, patients, pills, bells, report){
    const D = flood(map, start.x, start.y, blockBoss);
    let unreachable=0;
    function chk(list,label){
      for(const p of list){ if (D[p.ty]?.[p.tx]===Infinity) { unreachable++; report.push({warn:'unreachable_'+label, at:p}); } }
    }
    chk(patients,'patient');
    chk(pills,'pill');
    chk(bells,'bell');
    if (unreachable===0) report.push({ ok:'all_sets_reachable_ex_boss' });
  }

  function countDiagonalViolations(map){
    const H=map.length, W=map[0].length;
    let v=0;
    for(let y=1;y<H-1;y++){
      for(let x=1;x<W-1;x++){
        if (map[y][x]!==0) continue;
        if (map[y+1][x+1]===0 && map[y][x+1]===1 && map[y+1][x]===1) v++;
        if (map[y-1][x+1]===0 && map[y][x+1]===1 && map[y-1][x]===1) v++;
      }
    }
    return v;
  }
  function countUnreachable(map, start, blockRect){
    const D = flood(map, start.x, start.y, blockRect);
    let n=0;
    for(let y=0;y<map.length;y++)
      for(let x=0;x<map[0].length;x++)
        if (map[y][x]===0 && D[y][x]===Infinity) n++;
    return n;
  }

  function buildPlacements(map, areas, rooms, corridors, ascii, level, rng, charset) {
    const placements = [];
    const rint = (a,b)=> (a + Math.floor(rng()*(b-a+1)));
    const pick = (arr)=> arr[Math.floor(rng()*arr.length)];
    function centerOf(room){ return {x: Math.floor(room.x + room.w/2), y: Math.floor(room.y + room.h/2)}; }
    function randomInside(room, margin=1){
      return { x: rint(room.x+margin, room.x+room.w-1-margin), y: rint(room.y+margin, room.y+room.h-1-margin) };
    }
    function nearPerimeter(room, dist=2){
      const side = pick(['TOP','BOTTOM','LEFT','RIGHT']); let x,y;
      if (side==='TOP'){ y = room.y+1+dist; x = rint(room.x+2, room.x+room.w-3); }
      if (side==='BOTTOM'){ y = room.y+room.h-2-dist; x = rint(room.x+2, room.x+room.w-3); }
      if (side==='LEFT'){ x = room.x+1+dist; y = rint(room.y+2, room.y+room.h-3); }
      if (side==='RIGHT'){ x = room.x+room.w-2-dist; y = rint(room.y+2, room.y+room.h-3); }
      return {x,y};
    }
    function sampleAlongCorridor(c, step=10){
      const cells=[]; if (c.w >= c.h){ const y = c.y + Math.floor(c.h/2);
        for (let x=c.x+2; x<c.x+c.w-2; x+=step) cells.push({x,y});
      } else { const x = c.x + Math.floor(c.w/2);
        for (let y=c.y+2; y<c.y+c.h-2; y+=step) cells.push({x,y});
      } return cells;
    }
    function markAscii(x,y,ch){ if (ascii[y] && ascii[y][x]) ascii[y][x] = ch; }

    // 1) HÉROES + TELÉFONO en Sala de Control
    const ctrl = areas.control; const pC = centerOf(ctrl);
    placements.push({type:'player', x:pC.x, y:pC.y, id:'P1'});
    placements.push({type:'follower', sub:'nurse', x:pC.x-2, y:pC.y});
    placements.push({type:'follower', sub:'tcae',  x:pC.x+2, y:pC.y});
    const ctrlPhone = { x: Math.floor(ctrl.x+ctrl.w/2), y: ctrl.y+1 };
    placements.push({type:'phone', x: ctrlPhone.x, y: ctrlPhone.y});

    // 2) BOSS pegado a pared en Boss-Room (+ marcador ASCII)
    const bossR = areas.boss;
    const pB = nearPerimeter(bossR, 2);
    placements.push({type:'boss', x:pB.x, y:pB.y, nearWall:true});
    markAscii(pB.x, pB.y, charset.bossMarker||'X');

    // 3) TODAS LAS PUERTAS (cerradas) incl. Boss Door si hay 'D'
    for (let y=0; y<ascii.length; y++){
      for (let x=0; x<ascii[y].length; x++){
        const ch = ascii[y][x];
        if (ch===charset.door || ch==='d'){ placements.push({type:'door', x,y, locked:true}); }
        if (ch===charset.bossDoor || ch==='D'){ placements.push({type:'boss_door', x,y, locked:true, isBoss:true}); }
      }
    }

    // 4) LUCES: 1 por sala + pasillos cada ~10 tiles (10% rotas)
    for (const r of rooms){
      const c = centerOf(r); const broken = rng()<0.10;
      const colors = ['#eef','#ffd','#def'];
      placements.push({type:'light', x:c.x, y:c.y, broken, color: pick(colors)});
      markAscii(c.x, c.y, broken ? (charset.lightBroken||'l') : (charset.light||'L'));
    }
    for (const seg of corridors){
      for (const p of sampleAlongCorridor(seg, 10)){
        const broken = rng()<0.10; const colors = ['#eef','#ffd','#def'];
        placements.push({type:'light', x:p.x, y:p.y, broken, color: pick(colors)});
        markAscii(p.x, p.y, broken ? (charset.lightBroken||'l') : (charset.light||'L'));
      }
    }

    // 5) 34 ASCENSORES (17 pares) – una sala se queda sin ascensor
    const roomsCopy = rooms.slice();
    while (roomsCopy.length > 34) roomsCopy.splice(Math.floor(rng()*roomsCopy.length),1);
    let pairId = 1;
    for (let i=0; i+1<roomsCopy.length; i+=2){
      const A = roomsCopy[i], B = roomsCopy[i+1];
      const a = centerOf(A), b = centerOf(B);
      placements.push({type:'elevator', x:a.x, y:a.y, pairId});
      placements.push({type:'elevator', x:b.x, y:b.y, pairId});
      markAscii(a.x, a.y, charset.elev || 'E');
      markAscii(b.x, b.y, charset.elev || 'E');
      pairId++;
    }

    // 6) POBLACIÓN por sala y por tramo de pasillo: [1..3] enemigos y [1..3] NPC
    function populateAreaRect(rect){
      const enemies = rint(1,3), npcs = rint(1,3);
      for (let i=0;i<enemies;i++){
        const p = randomInside(rect, 2); const sub = (rng()<0.5) ? 'mosquito' : 'rat';
        placements.push({type:'enemy', sub, x:p.x, y:p.y});
        markAscii(p.x, p.y, sub==='mosquito' ? (charset.mosquito||'m') : (charset.rat||'r'));
      }
      const staff = ['nurse','tcae','celador','cleaner','guardia','medico'];
      for (let i=0;i<npcs;i++){
        const p = randomInside(rect, 2); const sub = pick(staff);
        placements.push({type:'npc', sub, x:p.x, y:p.y});
        markAscii(p.x, p.y, charset[sub]||'N');
      }
    }
    for (const r of rooms) populateAreaRect(r);
    for (const c of corridors) populateAreaRect(c);

    // ÚNICOS: 1 jefe_servicio y 1 supervisora (no Control/Boss)
    const candidateRooms = rooms.filter(r=> r!==ctrl && r!==bossR);
    if (candidateRooms.length){
      const rJ = pick(candidateRooms), pJ = randomInside(rJ,2);
      placements.push({type:'npc_unique', sub:'jefe_servicio', x:pJ.x, y:pJ.y});
      markAscii(pJ.x, pJ.y, charset.jefe_servicio||'J');
    }
    if (candidateRooms.length>1){
      const rV = pick(candidateRooms), pV = randomInside(rV,2);
      placements.push({type:'npc_unique', sub:'supervisora', x:pV.x, y:pV.y});
      markAscii(pV.x, pV.y, charset.supervisora||'V');
    }

    // 7) CARROS por sala: 3..6 (10% urgencias, 30% medicinas, 60% comida)
    function placeRoomCarts(room){
      const n = rint(3,6);
      for (let i=0;i<n;i++){
        const p = randomInside(room,2);
        const roll = rng(); const sub = roll<0.10 ? 'urgencias' : (roll<0.40 ? 'medicinas' : 'comida');
        placements.push({type:'cart', sub, x:p.x, y:p.y});
        markAscii(p.x,p.y, sub==='urgencias' ? (charset.cartUrg||'U') : (sub==='medicinas' ? (charset.cartMed||'m') : (charset.cartFood||'q')));
      }
    }
    for (const r of rooms) placeRoomCarts(r);

    // 8) ÍTEMS por sala (1 power, 2 comidas, 3 monedas; + bolsa si cerca de Boss)
    function dist2(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy; }
    const bossC = centerOf(bossR), nearBossR2 = Math.pow(120,2);
    for (const r of rooms){
      let p = randomInside(r,2);
      placements.push({type:'item', sub:'power', x:p.x, y:p.y}); markAscii(p.x,p.y, charset.power||'u');
      for (let i=0;i<2;i++){ p = randomInside(r,2);
        placements.push({type:'item', sub:'food', x:p.x, y:p.y}); markAscii(p.x,p.y, charset.food||'f');
      }
      for (let i=0;i<3;i++){ p = randomInside(r,2);
        placements.push({type:'item', sub:'coin', x:p.x, y:p.y}); markAscii(p.x,p.y, charset.coin||'o');
      }
      const rc = centerOf(r);
      if (dist2(rc,bossC) <= nearBossR2){ p = randomInside(r,2);
        placements.push({type:'item', sub:'bag', x:p.x, y:p.y}); markAscii(p.x,p.y, charset.bag||'$');
      }
    }

    // 9) SPAWNERS extra por nivel
    const baseSpM = level===1 ? rint(2,4) : (level===2 ? rint(3,6) : rint(4,8));
    const baseSpR = level===1 ? rint(2,3) : (level===2 ? rint(3,4) : rint(4,6));
    const baseSpS = level===1 ? rint(2,3) : (level===2 ? rint(3,4) : rint(4,6));
    const baseSpC = level===1 ? rint(1,2) : (level===2 ? rint(2,3) : rint(3,4));
    function dropSpawners(kind, count){
      for (let i=0;i<count;i++){
        const r = pick(rooms); const p = randomInside(r,2);
        placements.push({type: kind, x:p.x, y:p.y});
        const ch = (kind==='spawn_mosquito') ? (charset.spMosquito||'M') :
                  (kind==='spawn_rat')      ? (charset.spRat||'R') :
                  (kind==='spawn_staff')    ? (charset.spStaff||'N') : (charset.spCart||'C');
        markAscii(p.x,p.y, ch);
      }
    }
    dropSpawners('spawn_mosquito', baseSpM);
    dropSpawners('spawn_rat',      baseSpR);
    dropSpawners('spawn_staff',    baseSpS);
    dropSpawners('spawn_cart',     baseSpC);

    // 10) 7 PACIENTES + PASTILLAS + TIMBRES enlazados (no en Control ni Boss)
    const usedRooms = rooms.filter(r=> r!==ctrl && r!==bossR);
    const kindsPills = ['pastilla_azul','pastilla_zenidina','pastilla_tillalout','pastilla_gaviscon','pastilla_luzon','pastilla_patoplast','pastilla_generic'];
    const takeN = Math.min(7, usedRooms.length);
    for (let i=0;i<takeN;i++){
      const rP = usedRooms[i]; const pPt = randomInside(rP,2);
      placements.push({type:'patient', x:pPt.x, y:pPt.y, id:`patient${i+1}`});
      const pBell = randomInside(rP,2);
      placements.push({type:'bell', x:pBell.x, y:pBell.y, link:`patient${i+1}`});
      const rPi = pick(usedRooms.filter(rr=> rr!==rP)); const pPi = randomInside(rPi,2);
      const sub = pick(kindsPills);
      placements.push({type:'pill', sub, x:pPi.x, y:pPi.y, link:`patient${i+1}`});
      markAscii(pPt.x,pPt.y, charset.patient||'p');
      markAscii(pBell.x,pBell.y, charset.bell||'b');
      markAscii(pPi.x,pPi.y, charset.pill||'i');
    }

    return placements;
  }

  function placeWithCallbacks(res, cbs){
    const {placements} = res;
    for(const p of placements){
      switch(p.type){
        case 'follower':   cbs.placeFollower?.(p.sub, p.x, p.y, p); break;
        case 'boss':       cbs.placeBoss?.(p.x, p.y, p); break;
        case 'door':       cbs.placeDoor?.(p.x, p.y, {locked:true, ...p}); break;
        case 'boss_door':  cbs.placeDoor?.(p.x, p.y, {locked:true,isBoss:true, ...p}); break;
        case 'elevator':   cbs.placeElevator?.(p.x, p.y, {pairId:p.pairId, active:true}); break;
        case 'enemy':      cbs.placeEnemy?.(p.sub, p.x, p.y, p); break;
        case 'npc':        cbs.placeNPC?.(p.sub, p.x, p.y, p); break;
        case 'npc_unique': cbs.placeNPC?.(p.sub, p.x, p.y, {unique:true, ...p}); break;
        case 'cart':       cbs.placeCart?.(p.sub, p.x, p.y, p); break;
        case 'item':       cbs.placeItem?.(p.sub, p.x, p.y, p); break;
        case 'spawn_mosquito':
        case 'spawn_rat':
        case 'spawn_staff':
        case 'spawn_cart': cbs.placeSpawner?.(p.type, p.x, p.y, p); break;
      }
    }
  }

})(this);