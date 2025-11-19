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

  const THINK_INTERVAL = 1.2;
  const CLEAN_DURATION = 2.5;
  const SMALL_ENEMY_KINDS = new Set(['enemy_rat', 'enemy_mosquito']);

  const CLEANER_RIDDLES = [
    {
      key: 'riddle_cleaner_1',
      ask: '¿Cuántas esquinas tiene un hospital con planta cuadrada?',
      options: ['Cuatro', 'Tres', 'Cinco'],
      correctIndex: 0,
      hint: 'Piensa en las paredes exteriores.'
    },
    {
      key: 'riddle_cleaner_2',
      ask: '¿Qué planeta es conocido como el “planeta rojo”?',
      options: ['Venus', 'Marte', 'Saturno'],
      correctIndex: 1,
      hint: 'Lo ves rojizo en fotografías del espacio.'
    },
    {
      key: 'riddle_cleaner_3',
      ask: 'Si tienes dos cubos y cada uno pesa 3 kg, ¿cuánto pesan juntos?',
      options: ['5 kg', '6 kg', '9 kg'],
      correctIndex: 2,
      hint: 'Suma ambos pesos.'
    }
  ];

  const DEBUG_CLEANER = () => Boolean(W.DEBUG_CLEANER_AI || G.DEBUG_CLEANER_AI || W.DEBUG_NPCS || W.DEBUG);
  const logCleanerDebug = (tag, payload) => { if (DEBUG_CLEANER()) { try { console.debug(tag, payload); } catch (_) {} } };

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
  function applyWetToEntity(e, dt = 1/60){
    const B = BAL().wet;
    if (!e || e.static) return;
    const onWet = isWetAtPx(e.x + (e.w||TILE)/2, e.y + (e.h||TILE)/2);
    if (!onWet){
      e._wetSlipTimer = Math.max(0, (e._wetSlipTimer || 0) - dt);
      e._wetOnPuddle = false;
      return;
    }
    if (!e._wetOnPuddle){
      applySlipEffect(e, { duration: 0.7, force: 1.2 });
    }
    e._wetOnPuddle = true;

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

  function applySlipEffect(entity, opts = {}){
    if (!entity) return;
    const duration = Number.isFinite(opts.duration) ? opts.duration : 0.7;
    const force = Number.isFinite(opts.force) ? opts.force : 1.2;
    const angle = rng() * Math.PI * 2;
    const slipMagnitude = force * TILE * 0.35;
    entity.vx = (entity.vx || 0) + Math.cos(angle) * slipMagnitude;
    entity.vy = (entity.vy || 0) + Math.sin(angle) * slipMagnitude;
    entity.slipping = Math.max(entity.slipping || 0, duration);
    entity.controlLockTimer = Math.max(entity.controlLockTimer || 0, duration * 0.8);
    try { W.EffectsAPI?.applyTimedEffect?.(entity, { secs: duration, slip: true }); } catch (_) {}
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
  let CLEANER_UID = 1;

  function spawn(x, y, opts={}){
    const B = BAL().cleaner;
    const width = Math.floor(TILE*0.8);
    const height = Math.floor(TILE*0.9);
    const ent = {
      id: opts.id || `npc_limpiadora_${CLEANER_UID++}`,
      kind: 'npc_limpiadora',
      kindId: ENT.CLEANER,
      role: 'cleaner',
      x: x|0, y: y|0,
      w: width, h: height,
      vx: 0, vy: 0,
      speed: 1.0,
      walkSpeedPx: B.speed,
      accel: B.accel,
      hp: 70,
      maxHp: 70,
      isNeutral: true,
      mode: opts.mode || B.mode,
      emitsLight: true,
      lightColor: B.lightColor,
      spriteKey: 'npc_limpiadora',
      skin: 'chica_limpieza.png',
      ai: createCleanerAiState(),
      static: false,
      pushable: true,
      aiId: 'CLEANER'
    };
    try { window.AI?.attach?.(ent, 'CLEANER'); } catch (_) {}

    if (hitsWallRect(ent.x,ent.y,ent.w,ent.h)) {
      const p = findFreeSpotNear(ent.x,ent.y, 6);
      if (p){ ent.x=p.x; ent.y=p.y; }
    }

    (G.entities || (G.entities=[])).push(ent);
    ent.group = 'human';
    try { window.EntityGroups?.assign?.(ent); } catch (_) {}
    try { window.EntityGroups?.register?.(ent, G); } catch (_) {}
    cleaners.push(ent);
    try {
      const puppet = window.Puppet?.bind?.(ent, 'npc_limpiadora', { z: 0, scale: 1, data: { skin: ent.skin } })
        || window.PuppetAPI?.attach?.(ent, { rig: 'npc_limpiadora', z: 0, scale: 1, data: { skin: ent.skin } });
      ent.rigOk = ent.rigOk === true || !!puppet;
      ent.puppetState = puppet?.state || ent.puppetState || { anim: 'idle' };
    } catch (_) {
      ent.rigOk = ent.rigOk === true;
    }
    tryAttachFlashlight(ent);
    return ent;
  }

  function createCleanerAiState(){
    return {
      state: 'patrol',
      dir: 'down',
      targetTile: null,
      thinkTimer: THINK_INTERVAL,
      cleanTimer: 0,
      talkCooldown: 0,
      riddleIndex: 0
    };
  }

  function updateCleaner(ent, dt = 1/60){
    if (!ent || ent._inactive) return;
    const ai = ent.ai || (ent.ai = createCleanerAiState());
    ai.thinkTimer -= dt;
    ai.talkCooldown = Math.max(0, ai.talkCooldown - dt);

    if (ent.hp <= 0 || ent.dead){
      ent.dead = true;
      ai.state = 'dead';
      ent.vx *= 0.6;
      ent.vy *= 0.6;
      if (ent.puppetState){
        const cause = (ent.deathCause || ent.lastDamageCause || '').toLowerCase();
        ent.puppetState.anim = cause.includes('fire') ? 'die_fire'
          : (cause.includes('crush') ? 'die_crush' : 'die_hit');
      }
      moveEntity(ent, dt);
      return;
    }

    if (ai.state !== 'talk' && ai.state !== 'dead' && ai.thinkTimer <= 0){
      ai.thinkTimer = THINK_INTERVAL;
      if (ai.state !== 'clean' || !ai.targetTile){
        const dirtyTile = findClosestDirtyTile(ent);
        if (dirtyTile){
          ai.state = 'clean';
          ai.targetTile = { x: dirtyTile.x|0, y: dirtyTile.y|0 };
          ai.cleanTimer = CLEAN_DURATION;
          logCleanerDebug('[CLEANER_AI] start clean', { id: ent.id, tile: ai.targetTile });
        } else if (!ai.targetTile) {
          ai.state = 'patrol';
          ai.targetTile = getRandomPatrolTile(ent);
        }
        logCleanerDebug('[CLEANER_AI] state', { id: ent.id, state: ai.state, targetTile: ai.targetTile });
      }
    }

    if (ai.state === 'talk'){
      if (ent.puppetState) ent.puppetState.anim = 'talk';
      ent.vx *= 0.2;
      ent.vy *= 0.2;
      moveEntity(ent, dt);
      return;
    }

    if (ai.state === 'clean'){
      const tile = ai.targetTile;
      if (!tile){
        ai.state = 'patrol';
      } else if (!isNearTile(ent, tile.x, tile.y, 0.2)) {
        moveTowardsTile(ent, tile.x, tile.y, ent.walkSpeedPx, dt);
        setCleanerWalkAnim(ent, ai);
      } else {
        ent.vx = 0; ent.vy = 0;
        ai.cleanTimer -= dt;
        if (ent.puppetState) ent.puppetState.anim = 'extra';
        if (ai.cleanTimer <= 0){
          markTileAsClean(tile);
          spawnWaterPuddle(tile.x, tile.y);
          ai.state = 'patrol';
          ai.targetTile = null;
          ai.cleanTimer = 0;
        }
      }
    } else if (ai.state === 'patrol') {
      if (!ai.targetTile || isNearTile(ent, ai.targetTile.x, ai.targetTile.y, 0.25)){
        ai.targetTile = getRandomPatrolTile(ent);
        logCleanerDebug('[CLEANER_AI] state', { id: ent.id, state: ai.state, targetTile: ai.targetTile });
      }
      if (ai.targetTile){
        moveTowardsTile(ent, ai.targetTile.x, ai.targetTile.y, ent.walkSpeedPx * 0.9, dt);
        setCleanerWalkAnim(ent, ai);
      } else {
        ent.vx *= 0.8; ent.vy *= 0.8;
        if (ent.puppetState) ent.puppetState.anim = 'idle';
      }
    } else {
      ent.vx *= 0.8; ent.vy *= 0.8;
      if (ent.puppetState) ent.puppetState.anim = 'idle';
    }

    moveEntity(ent, dt);

    if (ai.state === 'clean') maybeExtinguishFireNear(ent);
    applyWetToEntity(ent, dt);

    const smallEnemies = findNearbySmallEnemies(ent, 0.6);
    for (const enemy of smallEnemies){
      if (SMALL_ENEMY_KINDS.has(enemy.kind)){
        killEnemyWithCleanHit(enemy);
        if (ent.puppetState) ent.puppetState.anim = 'attack';
        logCleanerDebug('[CLEANER_ANIMALS] kill small enemy', { cleaner: ent.id, enemy: enemy.id, kind: enemy.kind });
      }
    }

    const hero = G.player;
    if (hero && !hero.dead && ai.state !== 'dead' && ai.state !== 'talk' && ai.talkCooldown <= 0 && collides(ent, hero)){
      startCleanerRiddleDialog(ent, hero);
    }

    if (ai.state === 'patrol' || ai.state === 'clean'){
      const speed = Math.hypot(ent.vx, ent.vy);
      if (ai.state === 'clean' && ai.targetTile && isNearTile(ent, ai.targetTile.x, ai.targetTile.y, 0.25)){
        if (ent.puppetState) ent.puppetState.anim = 'extra';
      } else if (speed > 0.01) {
        setCleanerWalkAnim(ent, ai);
      } else if (ent.puppetState) {
        ent.puppetState.anim = 'idle';
      }
    }
  }

  function updateAll(dt = 1/60){
    const now = performance.now();
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

    for (let i=0;i<cleaners.length;i++){
      const e = cleaners[i];
      if (!e || e.dead || e._inactive) continue;
      updateCleaner(e, dt);
    }

    const hero = G.player;
    if (hero && !hero.dead) applyWetToEntity(hero, dt);
    const entities = Array.isArray(G.entities) ? G.entities : [];
    for (const ent of entities){
      if (!ent || ent.dead || ent === hero || ent.kind === 'npc_limpiadora') continue;
      if (ent.static || ent.ignoreWet) continue;
      applyWetToEntity(ent, dt);
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

  function getEntityCenter(ent){
    return {
      x: (ent?.x || 0) + (ent?.w || TILE) * 0.5,
      y: (ent?.y || 0) + (ent?.h || TILE) * 0.5
    };
  }

  function moveEntity(ent, dt = 1/60){
    if (typeof W.moveWithCollisions === 'function'){ W.moveWithCollisions(ent, dt); return; }
    ent.x += (ent.vx || 0) * dt;
    ent.y += (ent.vy || 0) * dt;
  }

  function moveTowardsTile(ent, tileX, tileY, speed, dt = 1/60){
    if (!ent) return false;
    const center = getEntityCenter(ent);
    const targetX = tileX * TILE + TILE * 0.5;
    const targetY = tileY * TILE + TILE * 0.5;
    const dx = targetX - center.x;
    const dy = targetY - center.y;
    const len = Math.hypot(dx, dy) || 1;
    const maxSpeed = speed ?? ent.walkSpeedPx ?? (ent.speed || 1) * TILE;
    const accel = maxSpeed * (dt > 0 ? dt * 2.1 : 1);
    ent.vx += (dx / len) * accel;
    ent.vy += (dy / len) * accel;
    const vel = Math.hypot(ent.vx, ent.vy);
    if (vel > maxSpeed){
      const s = maxSpeed / vel;
      ent.vx *= s;
      ent.vy *= s;
    }
    return Math.hypot(dx, dy) <= TILE * 0.2;
  }

  function isNearTile(ent, tileX, tileY, radiusTiles = 0.25){
    if (!ent) return false;
    const center = getEntityCenter(ent);
    const txPx = tileX * TILE + TILE * 0.5;
    const tyPx = tileY * TILE + TILE * 0.5;
    return Math.hypot(center.x - txPx, center.y - tyPx) <= TILE * radiusTiles;
  }

  function setCleanerWalkAnim(ent, ai){
    if (!ent) return;
    const vx = ent.vx || 0;
    const vy = ent.vy || 0;
    const absX = Math.abs(vx);
    const absY = Math.abs(vy);
    if (!ent.puppetState) ent.puppetState = { anim: 'idle' };
    if (absX > absY + 0.05){
      ent.puppetState.anim = 'walk_side';
      if (ai) ai.dir = 'side';
      ent.flipX = vx < 0 ? -1 : 1;
    } else if (vy < 0){
      ent.puppetState.anim = 'walk_up';
      if (ai) ai.dir = 'up';
    } else {
      ent.puppetState.anim = 'walk_down';
      if (ai) ai.dir = 'down';
    }
  }

  function findClosestDirtyTile(ent){
    const center = getEntityCenter(ent);
    const candidates = getDirtyTileCandidates();
    let best = null;
    let bestDist = Infinity;
    for (const tile of candidates){
      const dx = tile.x * TILE + TILE * 0.5 - center.x;
      const dy = tile.y * TILE + TILE * 0.5 - center.y;
      const dist2 = dx*dx + dy*dy;
      if (dist2 < bestDist){
        bestDist = dist2;
        best = tile;
      }
    }
    return best;
  }

  function getDirtyTileCandidates(){
    const list = [];
    const seen = new Set();
    const pushTile = (tile) => {
      if (!tile) return;
      const key = `${tile.x|0},${tile.y|0}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ x: tile.x|0, y: tile.y|0 });
    };
    const sources = [];
    try {
      const apiTiles = typeof W.WorldAPI?.getDirtyTiles === 'function' ? W.WorldAPI.getDirtyTiles() : null;
      if (Array.isArray(apiTiles)) sources.push(apiTiles);
    } catch (_) {}
    const extraSources = [G.dirtyTiles, G.mapDirtyTiles, G.rooms?.dirtyTiles];
    for (const src of extraSources) if (src) sources.push(src);
    for (const src of sources){
      if (!src) continue;
      for (const item of src){
        const normalized = normalizeTileCandidate(item);
        pushTile(normalized);
      }
    }
    return list;
  }

  function normalizeTileCandidate(item){
    if (!item) return null;
    if (Array.isArray(item) && item.length >= 2){
      return { x: item[0]|0, y: item[1]|0 };
    }
    if (typeof item === 'string' && item.includes(',')){
      const parts = item.split(',').map(Number);
      return { x: parts[0]|0, y: parts[1]|0 };
    }
    if (typeof item === 'object'){
      const txVal = Number.isFinite(item.tx) ? item.tx : item.x;
      const tyVal = Number.isFinite(item.ty) ? item.ty : item.y;
      if (Number.isFinite(txVal) && Number.isFinite(tyVal)){
        return { x: txVal|0, y: tyVal|0 };
      }
    }
    return null;
  }

  function getRandomPatrolTile(ent){
    const mapW = G.mapW || 32;
    const mapH = G.mapH || 32;
    const hero = G.player;
    const base = hero && rng() < 0.55 ? hero : ent;
    const center = base ? getEntityCenter(base) : { x: TILE, y: TILE };
    let txBase = Math.max(0, Math.min(mapW - 1, tx(center.x)));
    let tyBase = Math.max(0, Math.min(mapH - 1, ty(center.y)));
    const radius = 3 + Math.floor(rng() * 5);
    const tileX = Math.max(0, Math.min(mapW - 1, txBase + Math.round((rng()*2 - 1) * radius)));
    const tileY = Math.max(0, Math.min(mapH - 1, tyBase + Math.round((rng()*2 - 1) * radius)));
    return { x: tileX, y: tileY };
  }

  function markTileAsClean(tile){
    if (!tile) return;
    const txv = tile.x|0;
    const tyv = tile.y|0;
    try { W.WorldAPI?.markTileClean?.(txv, tyv); } catch (_) {}
    const collections = [G.dirtyTiles, G.mapDirtyTiles, G.rooms?.dirtyTiles];
    for (const collection of collections){
      if (!Array.isArray(collection)) continue;
      const idx = collection.findIndex((it) => {
        const norm = normalizeTileCandidate(it);
        return norm && norm.x === txv && norm.y === tyv;
      });
      if (idx >= 0) collection.splice(idx, 1);
    }
  }

  function spawnWaterPuddle(txVal, tyVal){
    if (!Number.isFinite(txVal) || !Number.isFinite(tyVal)) return null;
    leaveWetAtPx(txVal * TILE + TILE * 0.5, tyVal * TILE + TILE * 0.8, BAL().wet.ttlMs * 1.1);
    logCleanerDebug('[CLEANER_AI] spawn puddle', { x: txVal, y: tyVal });
    return { x: txVal, y: tyVal };
  }

  function findNearbySmallEnemies(ent, radiusTiles = 0.6){
    const res = [];
    if (!ent) return res;
    const entities = Array.isArray(G.entities) ? G.entities : [];
    const center = getEntityCenter(ent);
    const radius = radiusTiles * TILE;
    for (const other of entities){
      if (!other || other === ent || other.dead) continue;
      if (!SMALL_ENEMY_KINDS.has(other.kind)) continue;
      const oc = getEntityCenter(other);
      if (Math.hypot(center.x - oc.x, center.y - oc.y) <= radius){
        res.push(other);
      }
    }
    return res;
  }

  function killEnemyWithCleanHit(enemy){
    if (!enemy || enemy.dead) return;
    const dmg = enemy.hp || 5;
    if (typeof enemy.takeDamage === 'function'){
      try { enemy.takeDamage(dmg, { cause: 'cleaner', kind: 'mop' }); return; } catch (_) {}
    }
    enemy.hp = 0;
    enemy.dead = true;
    enemy.deathCause = 'cleaner_mop';
    enemy.remove = true;
    if (typeof enemy.onKilled === 'function'){
      try { enemy.onKilled({ killer: 'npc_limpiadora', cause: 'cleaner_mop' }); } catch (_) {}
    }
  }

  function collides(a, b){
    if (!a || !b) return false;
    return !(a.x + a.w < b.x || a.x > b.x + (b.w||TILE) || a.y + a.h < b.y || a.y > b.y + (b.h||TILE));
  }

  function startCleanerRiddleDialog(ent, hero){
    const ai = ent.ai || (ent.ai = createCleanerAiState());
    ai.state = 'talk';
    ai.talkCooldown = 10;
    ai.cleanTimer = 0;
    ent.vx = 0; ent.vy = 0;
    if (!ent.puppetState) ent.puppetState = { anim: 'talk' }; else ent.puppetState.anim = 'talk';
    if (hero){
      hero.vx = 0; hero.vy = 0;
      hero.isTalking = true;
      try { W.Entities?.Hero?.setTalking?.(hero, true); } catch (_) {}
    }
    logCleanerDebug('[CLEANER_TALK] start riddle', { id: ent.id });

    const riddle = CLEANER_RIDDLES[ai.riddleIndex % CLEANER_RIDDLES.length];
    ai.riddleIndex = (ai.riddleIndex + 1) % CLEANER_RIDDLES.length;

    const finish = (success) => {
      onCleanerDialogEnd(ent, hero, success);
      logCleanerDebug('[CLEANER_TALK] end dialog', { id: ent.id, success });
    };

    if (!riddle){ finish(false); return; }

    const resolve = (correct) => {
      if (correct) applySmallReward(hero);
      else applySmallPenalty(hero);
      finish(correct);
    };

    const dialogPayload = {
      title: 'Limpiadora',
      ask: riddle.ask,
      hint: riddle.hint || '',
      options: riddle.options,
      correctIndex: riddle.correctIndex,
      key: riddle.key
    };

    if (W.DialogAPI?.openRiddle){
      W.DialogAPI.openRiddle({
        id: dialogPayload.key,
        title: dialogPayload.title,
        ask: dialogPayload.ask,
        hints: [dialogPayload.hint],
        portraitCssVar: '--sprite-cleaner',
        answers: dialogPayload.options,
        correctIndex: dialogPayload.correctIndex,
        onSuccess: () => resolve(true),
        onFail: () => resolve(false),
        onClose: () => finish(false)
      });
      return;
    }

    if (W.DialogAPI?.open){
      W.DialogAPI.open({
        title: dialogPayload.title,
        text: `${dialogPayload.ask}\n\n${dialogPayload.hint}`,
        portraitCssVar: '--sprite-cleaner',
        buttons: dialogPayload.options.map((label, idx) => ({
          label,
          primary: idx === dialogPayload.correctIndex,
          action: () => resolve(idx === dialogPayload.correctIndex)
        })),
        onClose: () => finish(false)
      });
      return;
    }

    if (W.Dialog?.open){
      W.Dialog.open({
        portrait: 'chica_limpieza.png',
        text: dialogPayload.ask,
        options: dialogPayload.options,
        correct: dialogPayload.correctIndex,
        onAnswer: (idx) => resolve(idx === dialogPayload.correctIndex)
      });
      return;
    }

    const answer = Number(prompt(`${dialogPayload.title}\n\n${dialogPayload.ask}\n${dialogPayload.options.map((o, i) => `[${i}] ${o}`).join('\n')}`, '0')) || 0;
    resolve(answer === dialogPayload.correctIndex);
  }

  function onCleanerDialogEnd(ent, hero, success){
    const ai = ent.ai || (ent.ai = createCleanerAiState());
    ai.state = 'patrol';
    ai.targetTile = null;
    ai.thinkTimer = 0.2;
    if (hero){
      hero.isTalking = false;
      try { W.Entities?.Hero?.setTalking?.(hero, false); } catch (_) {}
    }
    if (success){
      try { W.HUD?.showFloatingMessage?.(hero || ent, '¡Bien contestado!', 1.4); } catch (_) {}
    } else {
      try { W.HUD?.showFloatingMessage?.(hero || ent, 'Inténtalo de nuevo', 1.4); } catch (_) {}
    }
  }

  function applySmallReward(hero){
    if (!hero) return;
    if (typeof hero.hp === 'number'){
      const maxHp = hero.maxHp || hero.hpMax || hero.hp;
      hero.hp = Math.min(maxHp, hero.hp + 4);
    }
    if (typeof G.score === 'number') G.score += 12;
    try { W.ScoreAPI?.addPoints?.(12); } catch (_) {}
    try { W.EffectsAPI?.applyTimedEffect?.(hero, { secs: 6, speedMul: 1.05, pushMul: 1.05 }); } catch (_) {}
  }

  function applySmallPenalty(hero){
    if (!hero) return;
    if (typeof hero.hp === 'number') hero.hp = Math.max(1, hero.hp - 3);
    if (typeof G.score === 'number') G.score = Math.max(0, G.score - 8);
    try { W.ScoreAPI?.addPoints?.(-8); } catch (_) {}
    try { W.EffectsAPI?.applyTimedEffect?.(hero, { secs: 5, speedMul: 0.9, pushMul: 0.9, dmgHalves: 1 }); } catch (_) {}
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
    spawnWaterPuddle,
    applySlipEffect,
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