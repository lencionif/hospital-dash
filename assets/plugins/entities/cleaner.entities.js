// filename: assets/entities/cleaner.entities.js
// NPC: Chica de la Limpieza + Charcos (suelo mojado) con IA mejorada
// - Deja charcos al moverse y en “ráfagas de fregado”; se evaporan solos.
// - Cualquier entidad encima de charco resbala (menos fricción + pequeño skid).
// - IA: patrulla pasillos, evita paredes y fuego, decide cuándo fregar, frases contextuales.
// - Expuesto como window.CleanerAPI (spawn / updateAll / applyWetToEntity / renderWetOverlay / isWetAtPx).
// - Tolerante: funciona aunque falten algunos plugins (Sprites, Lighting, Physics).

(function () {
  'use strict';
  const W = (typeof window !== 'undefined') ? window : globalThis;
  const G = W.G || (W.G = {});
  const ENT = W.ENT || (W.ENT = { PLAYER:1, CLEANER:101, WET:102, WALL:999 });
  const TILE = (W.TILE_SIZE || W.TILE || G.TILE_SIZE || 32)|0;

  function tryAttachFlashlight(e){
    if (!e || e.flashlight === false || e._flashlightAttached) return;
    const attach = W.Entities?.attachFlashlight;
    if (typeof attach !== 'function') return;
    try {
      const radius = Number.isFinite(e.flashlightRadius) ? e.flashlightRadius : TILE * 4.8;
      const intensity = Number.isFinite(e.flashlightIntensity) ? e.flashlightIntensity : 0.55;
      const color = e.flashlightColor || '#fff2c0';
      const id = attach(e, { color, radius, intensity });
      if (id != null){
        e._flashlightAttached = true;
        e._flashlightId = id;
      }
    } catch (err){
      try { console.warn('[Cleaner] No se pudo adjuntar linterna', err); } catch (_) {}
    }
  }

  // -----------------------
  // Balance (overrideable)
  // -----------------------
  const DEF = {
    cleaner: {
      speed:  75,          // px/s
      accel:  14,          // lerp hacia la velocidad objetivo
      turnEveryMs: 1100,   // cada cuánto reconsidera rumbo (patrulla)
      visionTiles: 7,      // “visión” para evitar choques
      avoidProbe: 12,      // raycast corto para girar antes de pared
      mode: "neutral",     // neutral | shy (huye jugador) | agro (se acerca jugador)
      lightColor: "rgba(180,220,255,0.25)",
      speakCooldownMs: 5000
    },
    wet: {
      dropEveryMs: 800,     // frecuencia normal de gotas al caminar
      burstEveryMs: 12000,  // cada X ms, “ráfaga” de fregado en cruz
      burstDrops:  4,       // cuántas casillas moja a su alrededor en ráfaga
      ttlMs:       14000,   // vida de un charco (ms)
      fadeMs:      2500,    // fade final
      maxPuddles:  240,     // cap global
      frictionMul: 0.82,    // <1 ⇒ menos fricción (más desliz)
      pushMul:     1.25,    // empuje extra cuando empujas estando mojado
      slipAccel:   18,      // micro sacudida lateral para “skid”
      color:       "rgba(90,170,255,0.20)"
    },
    lines: {
      near: [
        "¡Cuidado, que resbala!",
        "Paso mojado — pisa suave.",
        "Te lo dejo limpito… y deslizante.",
        "Ojo, que aún está húmedo."
      ],
      mop: [
        "Un momento, que esto chorreaba.",
        "Dejo la zona como nueva.",
        "¡Fregando! No pases corriendo."
      ]
    }
  };
  // Permite override suave desde G.BALANCE.cleaner
  function BAL(){
    const b = (G.BALANCE && G.BALANCE.cleaner) || {};
    return {
      cleaner: Object.assign({}, DEF.cleaner, b.cleaner||{}),
      wet:     Object.assign({}, DEF.wet,     b.wet||{}),
      lines:   Object.assign({}, DEF.lines,   b.lines||{})
    };
  }

  // -----------------------
  // RNG determinista suave
  // -----------------------
  const rng = (() => {
    if (G.seededRandom) return G.seededRandom;
    let s = (G.seed || 0x9E3779B1)>>>0;
    return function(){ // mulberry32
      s = (s + 0x6D2B79F5)>>>0; let t = Math.imul(s ^ (s>>>15), 1 | s);
      t ^= t + Math.imul(t ^ (t>>>7), 61 | t);
      return ((t ^ (t>>>14))>>>0) / 4294967296;
    };
  })();

  // -----------------------
  // World helpers
  // -----------------------
  function inBoundsPx(x,y){
    const Ww = (G.mapW||0)*TILE, Wh = (G.mapH||0)*TILE;
    return x>=0 && y>=0 && x<Ww && y<Wh;
  }
  function tx(x){ return Math.floor(x / TILE); }
  function ty(y){ return Math.floor(y / TILE); }
  function isWallTile(Tx,Ty){
    const m = G.map; return !!(m && m[Ty] && m[Ty][Tx]);
  }
  function hitsWallRect(x,y,w,h){
    const x0 = tx(x), y0 = ty(y), x1 = tx(x+w-1), y1 = ty(y+h-1);
    for(let Y=y0; Y<=y1; Y++) for(let X=x0; X<=x1; X++){
      if (isWallTile(X,Y)) return true;
    }
    return false;
  }
  function findFreeSpotNear(px,py, rTiles=4){
    const R = (rTiles|0)*TILE;
    for(let i=0;i<180;i++){
      const ang = 2*Math.PI*(i/180);
      const rx  = px + Math.cos(ang)*R*0.6*rng();
      const ry  = py + Math.sin(ang)*R*0.6*rng();
      const w = Math.floor(TILE*0.8), h = Math.floor(TILE*0.9);
      if (inBoundsPx(rx,ry) && !hitsWallRect(rx,ry,w,h))
        return {x:rx, y:ry};
    }
    return null;
  }

  // -----------------------
  // Charcos (suelo mojado)
  // -----------------------
  const WetMap = new Map(); // key "tx,ty" -> {born, expires}
  const WetQueue = [];
  const SteamFx = [];

  function kWet(Tx,Ty){ return Tx+","+Ty; }

  function leaveWetAtPx(px,py, ttl){
    const B = BAL().wet;
    const Tx = tx(px), Ty = ty(py);
    if (Tx<0 || Ty<0 || Tx>=G.mapW || Ty>=G.mapH) return;
    if (isWallTile(Tx,Ty)) return;
    const now = performance.now();
    const key = kWet(Tx,Ty);
    const prev = WetMap.get(key);
    if (prev && (now - prev.born) < 260){
      prev.expires = Math.max(prev.expires, now + (ttl || B.ttlMs));
    } else {
      const item = { born: now, expires: now + (ttl||B.ttlMs) };
      WetMap.set(key, item);
      WetQueue.push(key);
    }
    maybeExtinguishTile(Tx, Ty, { cause: 'charco', px: px, py: py });
    // recorte
    while (WetQueue.length > B.maxPuddles) {
      const rm = WetQueue.shift();
      WetMap.delete(rm);
    }
  }

  function isWetAtPx(px,py){
    const key = kWet(tx(px),ty(py));
    const it = WetMap.get(key);
    if (!it) return false;
    const now = performance.now();
    if (now > it.expires){ WetMap.delete(key); return false; }
    return true;
  }

  function isWetAtTile(Tx, Ty){
    if (!Number.isFinite(Tx) || !Number.isFinite(Ty)) return false;
    const key = kWet(Tx, Ty);
    const it = WetMap.get(key);
    if (!it) return false;
    const now = performance.now();
    if (now > it.expires){ WetMap.delete(key); return false; }
    return true;
  }

  function evaporateWetAtTile(Tx, Ty, opts = {}){
    if (!Number.isFinite(Tx) || !Number.isFinite(Ty)) return false;
    const key = kWet(Tx, Ty);
    const it = WetMap.get(key);
    if (!it) return false;
    WetMap.delete(key);
    const idx = WetQueue.indexOf(key);
    if (idx >= 0) WetQueue.splice(idx, 1);
    const px = opts.x ?? (Tx*TILE + TILE*0.5);
    const py = opts.y ?? (Ty*TILE + TILE*0.5);
    if (opts.fx !== false) spawnSteamFx(px, py, opts.fx);
    if (opts.sound !== false){
      try { W.AudioAPI?.play?.('steam_sizzle', { at:{ x:px, y:py }, volume: opts.volume ?? 0.65 }); } catch(_){}
    }
    if (opts.log){
      try { W.LOG?.debug?.(`[Hazards] Fuego extinguido por ${opts.cause || 'agua'} en (${Tx},${Ty})`); } catch(_){}
    }
    return true;
  }

  // Aplica efecto “resbaladizo” a una entidad que pisa charco
  function applyWetToEntity(e, dt){
    const B = BAL().wet;
    if (!e || e.static) return;
    if (!isWetAtPx(e.x + (e.w||TILE)/2, e.y + (e.h||TILE)/2)) return;

    // 1) Menos fricción (⚠️ si tu física usa e.mu como “fricción extra” >0,
    //    aquí usamos un mu NEGATIVO para “quitar” fricción)
    e.mu = Math.min(e.mu||0, -0.18);  // más cercano a 0 ⇒ menos freno

    // 2) Pequeña sacudida lateral (skid) aleatoria
    const jitter = (rng()*2-1) * B.slipAccel * dt;
    if (Math.abs(e.vx||0) > Math.abs(e.vy||0)) e.vy += jitter;
    else                                        e.vx += jitter;

    // 3) Si tu core usa “pushImpulse” o empujes, podemos aumentar un pelín
    if (e.pushMul == null) e.pushMul = 1.0;
    e.pushMul = Math.max(e.pushMul, B.pushMul);
    e._wetSlipTimer = Math.max(e._wetSlipTimer || 0, 0.6);
  }

  // Overlay: dibuja charcos (opcional)
  function renderWetOverlay(ctx, camera){
    const B = BAL().wet;
    const cam = camera || {x:0,y:0};
    const now = performance.now();
    ctx.save();
    for (const [key, it] of WetMap){
      const [Tx,Ty] = key.split(',').map(Number);
      const px = Tx*TILE - (cam.x||0);
      const py = Ty*TILE - (cam.y||0);
      const age = now - it.born;
      const left = it.expires - now;
      if (left <= 0) continue;

      // alpha y “respiración” suave
      let alpha = 0.23 + 0.06*Math.sin(now/280 + (Tx+Ty));
      if (left < B.fadeMs) alpha *= (left / B.fadeMs);

      ctx.fillStyle = B.color.replace(/0\.\d+\)$/, alpha.toFixed(3)+')');
      ctx.fillRect(px+2, py+2, TILE-4, TILE-4);
    }
    const survivors = [];
    for (const fx of SteamFx){
      if (!fx) continue;
      const age = now - fx.born;
      if (age >= fx.ttl){ continue; }
      survivors.push(fx);
      const t = age / fx.ttl;
      const alpha = Math.max(0, (1 - t) * 0.6);
      const radius = fx.radius ?? (TILE * 0.45);
      ctx.save();
      ctx.globalAlpha = alpha;
      const cx = fx.x - (cam.x||0);
      const cy = fx.y - (cam.y||0);
      const r = radius * (1 + 0.15*Math.sin(now/120 + fx.seed));
      const grad = ctx.createRadialGradient(cx, cy, r*0.15, cx, cy, r);
      grad.addColorStop(0, 'rgba(220,240,255,0.85)');
      grad.addColorStop(1, 'rgba(220,240,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
    SteamFx.length = 0;
    Array.prototype.push.apply(SteamFx, survivors);
    ctx.restore();
  }

  // -----------------------
  // Limpiadoras
  // -----------------------
  const cleaners = []; // referencia dentro de G.entities, pero llevamos cache

  function spawn(x, y, opts={}){
    const B = BAL().cleaner;
    const e = {
      id: "CLR"+((Math.random()*1e8)|0),
      kind: ENT.CLEANER,
      x: x|0, y: y|0,
      w: Math.floor(TILE*0.8), h: Math.floor(TILE*0.9),
      vx: 0, vy: 0,
      dirX: (rng()<0.5?-1:1), dirY: 0,
      speed: B.speed, accel: B.accel,
      mode: opts.mode || B.mode,
      emitsLight: true,
      lightColor: B.lightColor,
      // visual
      spriteKey: "chica_limpieza",
      skin: 'chica_limpieza.png',
      // timers IA
      nextTurnAt: performance.now() + B.turnEveryMs * (0.5 + 0.8*rng()),
      nextDropAt: performance.now() + BAL().wet.dropEveryMs * (0.5 + 0.8*rng()),
      nextBurstAt: performance.now() + BAL().wet.burstEveryMs * (0.5 + 0.8*rng()),
      nextThinkAt: performance.now() + 120,
      speakReadyAt: 0,
      // flags
      static: false,
      pushable: true,
      aiId: 'CLEANER'
    };
    try { window.AI?.attach?.(e, 'CLEANER'); } catch (_) {}

    // evitar nacer dentro de pared
    if (hitsWallRect(e.x,e.y,e.w,e.h)) {
      const p = findFreeSpotNear(e.x,e.y, 6);
      if (p){ e.x=p.x; e.y=p.y; }
    }

    (G.entities || (G.entities=[])).push(e);
    e.group = 'human';
    try { window.EntityGroups?.assign?.(e); } catch (_) {}
    try { window.EntityGroups?.register?.(e, G); } catch (_) {}
    cleaners.push(e);
    try {
      const puppet = window.Puppet?.bind?.(e, 'npc_female_base', { z: 0, scale: 1, data: { skin: e.skin || 'cleaner' } })
        || window.PuppetAPI?.attach?.(e, { rig: 'npc_female_base', z: 0, scale: 1, data: { skin: e.skin || 'cleaner' } });
      e.rigOk = e.rigOk === true || !!puppet;
    } catch (_) {
      e.rigOk = e.rigOk === true;
    }
    tryAttachFlashlight(e);
    return e;
  }

  function updateCleaner(e, dt){
    if (!e || e._inactive) return;
    const now = performance.now();
    const BC = BAL().cleaner;
    const BW = BAL().wet;

    // 0) Pensar cada 120–200ms: cambia dir o reacciona al jugador/hazards
    if (now >= e.nextThinkAt){
      e.nextThinkAt = now + 120 + 80*rng();
      think(e);
    }

    // 1) Girar de vez en cuando aunque no haya bloqueo (para patrullar pasillos)
    if (now >= e.nextTurnAt){
      e.nextTurnAt = now + BC.turnEveryMs * (0.6 + 0.9*rng());
      randomTurn(e);
    }

    // 2) Evitar paredes con un probe corto (raycast de caja)
    steerToAvoidWalls(e);

    // 3) Integración con física del proyecto si existe
    if (typeof W.moveWithCollisions === "function"){
      // “target velocity” con lerp
      const tvx = e.dirX * e.speed, tvy = e.dirY * e.speed;
      e.vx += (tvx - e.vx) * Math.min(1, dt*e.accel);
      e.vy += (tvy - e.vy) * Math.min(1, dt*e.accel);
      W.moveWithCollisions(e);
    } else {
      // Fallback simple AABB
      const tvx = e.dirX * e.speed * dt, tvy = e.dirY * e.speed * dt;
      const nx = e.x + tvx, ny = e.y + tvy;
      if (!hitsWallRect(nx, e.y, e.w, e.h)) e.x = nx; else e.dirX *= -1;
      if (!hitsWallRect(e.x, ny, e.w, e.h)) e.y = ny; else e.dirY *= -1;
    }

    // 4) Dejar agua al caminar
    if (now >= e.nextDropAt){
      e.nextDropAt = now + BW.dropEveryMs * (0.6 + 0.9*rng());
      leaveWetAtPx(e.x + e.w*0.5, e.y + e.h*0.8);
    }

    // 5) Ráfagas de fregado (cruz / entorno)
    if (now >= e.nextBurstAt){
      e.nextBurstAt = now + BW.burstEveryMs * (0.8 + 0.7*rng());
      const T = [[0,0],[1,0],[-1,0],[0,1],[0,-1]];
      for (let i=0;i<Math.min(BW.burstDrops,T.length);i++){
        const [dx,dy] = T[i];
        leaveWetAtPx(e.x + e.w*0.5 + dx*TILE, e.y + e.h*0.5 + dy*TILE, BW.ttlMs*1.1);
      }
      say(e, pick(BAL().lines.mop));
    }

    // 6) Efecto físico del charco (sobre la propia limpiadora también)
    applyWetToEntity(e, dt);
    maybeExtinguishFireNear(e);

    // 7) Frase contextual si pasa junto al jugador
    const p = G.player;
    if (p && nearRect(e, p, TILE*1.2) && now >= e.speakReadyAt){
      e.speakReadyAt = now + BC.speakCooldownMs;
      say(e, pick(BAL().lines.near));
    }
  }

  function updateAll(dt){
    // Evaporación de charcos
    const now = performance.now(), BW = BAL().wet;
    for (const [key, it] of WetMap){
      if (now >= it.expires){
        WetMap.delete(key);
        const idx = WetQueue.indexOf(key);
        if (idx >= 0) WetQueue.splice(idx, 1);
      }
    }
    for (let i=SteamFx.length-1; i>=0; i--){
      const fx = SteamFx[i];
      if (!fx) continue;
      if (now - fx.born >= fx.ttl) SteamFx.splice(i,1);
    }

    // IA / movimiento limpiadoras
    for (let i=0;i<cleaners.length;i++){
      const e = cleaners[i];
      if (!e || e.dead || e._inactive) continue;
      updateCleaner(e, dt);
    }
  }

  // -----------------------
  // IA helpers
  // -----------------------
  function randomTurn(e){
    // 80% mantiene eje predominante; 20% cambia
    if (rng() < 0.20){
      if (Math.abs(e.dirX) > Math.abs(e.dirY)) { e.dirY = rng()<0.5?-1:1; e.dirX = 0; }
      else { e.dirX = rng()<0.5?-1:1; e.dirY = 0; }
    }
  }

  function steerToAvoidWalls(e){
    const probe = BAL().cleaner.avoidProbe;
    const lookX = e.x + e.dirX * probe;
    const lookY = e.y + e.dirY * probe;
    if (hitsWallRect(lookX, e.y, e.w, e.h)) { e.dirX *= -1; e.dirY = 0; }
    if (hitsWallRect(e.x, lookY, e.w, e.h)) { e.dirY *= -1; e.dirX = 0; }
    // corregir si se queda a 0, elige eje aleatorio
    if (!e.dirX && !e.dirY){
      if (rng()<0.5) e.dirX = rng()<0.5?-1:1;
      else           e.dirY = rng()<0.5?-1:1;
    }
  }

  function think(e){
    // Si el modo es "shy", evita al jugador; si es "agro", se aproxima (para “molestar”)
    const p = G.player;
    if (!p) return;
    const dx = (p.x - e.x), dy = (p.y - e.y);
    const dist2 = dx*dx + dy*dy, R = (TILE*7)*(TILE*7);
    if (dist2 > R) return; // fuera de rango de reacción

    if (e.mode === "shy"){
      // huye: elige dirección opuesta al vector al jugador
      if (Math.abs(dx) > Math.abs(dy)){ e.dirX = dx>0 ? -1:1; e.dirY = 0; }
      else { e.dirY = dy>0 ? -1:1; e.dirX = 0; }
    } else if (e.mode === "agro"){
      // se acerca un poco (para “molestar” en pasillos)
      if (Math.abs(dx) > Math.abs(dy)){ e.dirX = dx>0 ? 1:-1; e.dirY = 0; }
      else { e.dirY = dy>0 ? 1:-1; e.dirX = 0; }
    } else {
      // neutral: no cambia nada aquí
    }
  }

  // -----------------------
  // Utilitarios varios
  // -----------------------
  function nearRect(a,b, r){
    const ax = a.x+a.w*0.5, ay=a.y+a.h*0.5;
    const bx = b.x+(b.w||TILE)*0.5, by=b.y+(b.h||TILE)*0.5;
    const dx=ax-bx, dy=ay-by; return (dx*dx+dy*dy) <= (r*r);
  }
  function pick(arr){ return arr[(arr.length*rng())|0]; }

  function say(e, text){
    if (!text) return;
    // Si tienes un Dialog/HUD API, úsalo; si no, console:
    if (W.DialogAPI && W.DialogAPI.speech){
      W.DialogAPI.speech(text, { who:"cleaner", anchor:{x:e.x+e.w/2, y:e.y} });
    } else {
      console.log("[Cleaner]", text);
    }
  }

  function spawnSteamFx(px, py, opts={}){
    const now = performance.now();
    const ttl = (opts && opts.ttl != null) ? opts.ttl : 900;
    SteamFx.push({
      x: px,
      y: py,
      born: now,
      ttl: ttl,
      radius: opts.radius ?? (TILE * (0.35 + 0.25*rng())),
      seed: rng()*Math.PI*2
    });
    return true;
  }

  function maybeExtinguishFireNear(e){
    const API = W.FireAPI || W.Entities?.Fire;
    if (!API || typeof API.getActive !== 'function') return;
    const cx = e.x + e.w*0.5;
    const cy = e.y + e.h*0.5;
    const radius = TILE * 0.7;
    const fires = API.getActive();
    for (const fire of fires){
      if (!fire || fire.dead) continue;
      const fx = fire.x + fire.w*0.5;
      const fy = fire.y + fire.h*0.5;
      if (Math.hypot(fx - cx, fy - cy) > radius) continue;
      const opts = {
        cause: 'limpiadora',
        x: fx,
        y: fy,
        tileX: tx(fx),
        tileY: ty(fy),
        fx: { ttl: 850, radius: TILE * 0.6 },
        log: true,
        volume: 0.55
      };
      if (typeof API.extinguish === 'function'){ API.extinguish(fire, opts); return; }
      if (typeof API.extinguishAt === 'function' && API.extinguishAt(fx, fy, opts)) return;
    }
  }

  function maybeExtinguishTile(Tx, Ty, meta={}){
    const API = W.FireAPI || W.Entities?.Fire;
    if (!API) return;
    if (typeof API.extinguishAtTile === 'function'){
      API.extinguishAtTile(Tx, Ty, Object.assign({
        cause: meta.cause || 'charco',
        x: meta.px ?? (Tx*TILE + TILE*0.5),
        y: meta.py ?? (Ty*TILE + TILE*0.5),
        fx: { ttl: 780, radius: TILE * 0.55 },
        log: true
      }, meta.fireOpts || {}));
    }
  }

  // -----------------------
  // API pública
  // -----------------------
  W.CleanerAPI = {
    spawn, updateAll, renderWetOverlay,
    applyWetToEntity, isWetAtPx, isWetAtTile,
    evaporateWetAtTile,
    spawnSteamFx,
    // Calidad de vida: deja charco a demanda
    leaveWetAtPx
  };

  // Integración suave con tu loop si no lo haces tú:
  // (Si usas un game loop propio con dt, llama a updateAll(dt) desde allí.)
  if (!G.__hookedCleanerLoop) {
    G.__hookedCleanerLoop = true;
    // Intenta colgarse de un “tick” global si existe
    const _oldTick = W.onFrame;
    W.onFrame = function(dt){
      if (typeof _oldTick === 'function') _oldTick(dt);
      W.CleanerAPI.updateAll(dt || 1/60);
    };
  }

})();