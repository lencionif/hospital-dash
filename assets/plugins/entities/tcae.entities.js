// filename: tcae.entities.js
// ============================================================================
// TCAE con IA cooperativa + recarga de Carro de Medicinas (30 usos).
// - Patrulla, evita peligros, atiende timbres, puede seguir al héroe.
// - Coop vía TeamBus (mini pub/sub): escoltas, avisos de recarga, etc.
// - Recarga in situ carros MED vacíos: usesLeft -> 30, vuelve pushable=true.
// - Tolerante: si faltan módulos, funciona en modo básico.
// - Se autoengancha al loop si detecta G.__updateHooks (o usa RAF fallback).
// ============================================================================

(function (W) {
  'use strict';

  // ---------------- Entorno / constantes ----------------
  const G = W.G || (W.G = {});
  const ENT = W.ENT || (W.ENT = {});
  ENT.PLAYER = (ENT.PLAYER ?? 1);
  ENT.NPC    = (ENT.NPC    ?? 20);
  ENT.PATIENT= (ENT.PATIENT?? 21);
  ENT.FIRE   = (ENT.FIRE   ?? 801);
  ENT.FURIOUS= (ENT.FURIOUS?? 802);
  ENT.CART   = (ENT.CART   ?? 5);   // carts.entities.js ya usa kind===5
  ENT.TCAE   = (ENT.TCAE   ?? 120);
  const TILE = (W.TILE_SIZE || W.TILE || 32);

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
      try { console.warn('[TCAE] No se pudo adjuntar linterna', err); } catch (_) {}
    }
  }

  // ---------------- TeamBus (cooperación simple) ----------------
  // publish/subscribe basado en EventTarget (nativo, muy ligero)
  const TeamBus = (function(){
    const et = new (W.EventTarget || function(){ this._=document.createElement('span'); this.addEventListener=(...a)=>this._.addEventListener(...a); this.removeEventListener=(...a)=>this._.removeEventListener(...a); this.dispatchEvent=(...a)=>this._.dispatchEvent(...a); })();
    const publish = (type, detail={}) => {
      try { et.dispatchEvent(new CustomEvent(type, { detail })); } catch(_) {}
    };
    const subscribe = (type, cb) => {
      const fn = (ev)=>{ try{ cb(ev.detail||{}); }catch(e){} };
      et.addEventListener(type, fn);
      return () => et.removeEventListener(type, fn);
    };
    return { publish, subscribe };
  })();
  W.TeamBus = W.TeamBus || TeamBus;

  // ---------------- Compat Carro MED: stock/consumo ----------------
  const MED_MAX_USES = 30;
  function ensureMedMeta(cart){
    if (!cart || cart.kind!==ENT.CART) return;
    const type = (cart.cartType||cart.type||'').toLowerCase();
    if (type!=='med') return;
    if (!Number.isFinite(cart.usesLeft)) cart.usesLeft = MED_MAX_USES;
    if (!('empty' in cart)) cart.empty = false;
    if (!('pushable' in cart)) cart.pushable = true;
    updateCartPushability(cart);
  }
  function updateCartPushability(cart){
    // si está sin material → no empujable
    cart.empty = (cart.usesLeft|0) <= 0;
    cart.pushable = !cart.empty;
    // sprite opcional si tu SpritesAPI lo usa por spriteKey
    if (cart.spriteKey && cart.spriteKey.indexOf('carro_medicinas')===0){
      cart.spriteKey = cart.empty ? 'carro_medicinas_vacio' : 'carro_medicinas';
    }
  }

  // API global para consumo de medicinas desde un carro
  const CartMeds = {
    consume(cart, n=1){
      if (!cart || cart.kind!==ENT.CART) return false;
      if ((cart.cartType||cart.type||'').toLowerCase()!=='med') return false;
      ensureMedMeta(cart);
      if (cart.usesLeft<=0) return false;
      cart.usesLeft = Math.max(0, cart.usesLeft - Math.max(1, n|0));
      updateCartPushability(cart);
      // Notifica (para que el TCAE reaccione si va quedando bajo)
      try { W.dispatchEvent?.(new CustomEvent('med:consume', { detail:{ cart, left:cart.usesLeft } })); } catch(_){}
      TeamBus.publish('med:consumed', { cart, left:cart.usesLeft });
      if (cart.usesLeft===0){
        try { W.dispatchEvent?.(new CustomEvent('cart:empty', { detail:{ cart, type:'med' } })); } catch(_){}
        TeamBus.publish('cart:empty', { cart, type:'med' });
      }
      return true;
    }
  };
  W.CartMeds = W.CartMeds || CartMeds;

  // Escuchas externas tolerantes (por si otros sistemas disparan eventos)
  W.addEventListener?.('med:consume', (ev)=> {
    const { cart, n } = (ev.detail||{});
    if (cart) CartMeds.consume(cart, n||1);
  });

  // ---------------- Utilidades geom / mapa ----------------
  function aabb(a,b){ return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
  function center(e){ return { x:e.x + (e.w||TILE)*0.5, y:e.y + (e.h||TILE)*0.5 }; }
  function dist2(ax,ay,bx,by){ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; }
  function isWallRect(x,y,w,h){
    if (typeof W.isWallAt === 'function') return W.isWallAt(x,y,w,h);
    const x1 = (x/TILE)|0, y1 = (y/TILE)|0;
    const x2 = ((x+w-1)/TILE)|0, y2 = ((y+h-1)/TILE)|0;
    const M = G.map || [];
    for (let ty=y1; ty<=y2; ty++){
      for (let tx=x1; tx<=x2; tx++){
        if (M?.[ty]?.[tx]===1) return true;
      }
    }
    return false;
  }
  function moveWithCollisions(e, dt){
    if (typeof W.moveWithCollisions === 'function') { W.moveWithCollisions(e); return; }
    // Fallback simple
    const nx = e.x + (e.vx||0) * dt, ny = e.y + (e.vy||0) * dt;
    if (!isWallRect(nx, e.y, e.w, e.h)) e.x = nx; else e.vx = 0;
    if (!isWallRect(e.x, ny, e.w, e.h)) e.y = ny; else e.vy = 0;
  }

  // ---------------- Balance / Config ----------------
  const DEF = {
    w: Math.round(TILE*0.7),
    h: Math.round(TILE*0.9),
    speed: 1.75,        // patrulla
    run: 2.35,          // hacia timbre o tarea
    friction: 0.90,
    avoidPush: 3.0,
    avoidRadiusTiles: 6,
    detectBellTiles: 12,
    helpRadiusTiles: 2.0,
    followDistTiles: 1.6,
    reloadNearTiles: 1.4,       // distancia para iniciar recarga
    lowThreshold: 5,            // debajo de esto, “bajo de carga”
    reloadTimeMs: 2500,         // animación de recarga
    thinkMs: 180,               // “tick” de IA
    lightColor: 'rgba(120,220,255,0.28)',
    spriteKey: 'tcae',
    name: 'TCAE'
  };
  const BAL = ()=> ({ ...DEF, ...(G.BALANCE && G.BALANCE.tcae || {}) });

  // ---------------- Estado y helpers de TCAE ----------------
  let UID=1;
  const list = ()=> (G.entities||[]).filter(e => e.kind===ENT.TCAE && !e.dead);

  function placeSafeNear(tx,ty,w,h){
    // coloca en px alrededor de una celda
    const px = tx*TILE + Math.max(1,(TILE-w)*0.5);
    const py = ty*TILE + Math.max(1,(TILE-h)*0.5);
    if (!isWallRect(px,py,w,h)) return {x:px,y:py};
    const ring = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
    for (const [dx,dy] of ring){
      const nx = (tx+dx)*TILE + Math.max(1,(TILE-w)*0.5);
      const ny = (ty+dy)*TILE + Math.max(1,(TILE-h)*0.5);
      if (!isWallRect(nx,ny,w,h)) return {x:nx,y:ny};
    }
    return {x:px,y:py};
  }

  function nearestMedCart(from, onlyEmptyOrLow=true){
    const arr = (G.entities||[]).filter(e => e && e.kind===ENT.CART && ((e.cartType||e.type||'').toLowerCase()==='med'));
    let best=null, bd=Infinity;
    for (const c of arr){
      ensureMedMeta(c);
      if (onlyEmptyOrLow && c.usesLeft > DEF.lowThreshold) continue;
      const c1 = center(from), c2 = center(c);
      const d2 = dist2(c1.x,c1.y,c2.x,c2.y);
      if (d2 < bd){ bd=d2; best=c; }
    }
    return best;
  }

  function nearestRingingPatient(from, radiusTiles){
    const r2 = Math.pow(radiusTiles*TILE,2);
    const arr = (G.entities||[]);
    let best=null, bd=Infinity;
    const c1 = center(from);
    for (const e of arr){
      if (e.kind===ENT.PATIENT && e.ringing && !e.attended && !e.dead){
        const c2=center(e), d2=dist2(c1.x,c1.y,c2.x,c2.y);
        if (d2<r2 && d2<bd){ bd=d2; best=e; }
      }
    }
    return best;
  }

  function dangerVector(from, radiusTiles){
    const r2 = Math.pow(radiusTiles*TILE,2);
    const arr = (G.entities||[]);
    const c = center(from);
    let dx=0, dy=0;
    for (const e of arr){
      if (e.kind===ENT.FIRE || e.kind===ENT.FURIOUS){
        const ce=center(e), d2=dist2(c.x,c.y,ce.x,ce.y);
        if (d2<r2 && d2>1){
          const inv=1/Math.sqrt(d2);
          dx += (c.x - ce.x)*inv;
          dy += (c.y - ce.y)*inv;
        }
      }
    }
    return {dx,dy};
  }

  function goToTarget(e, tx,ty, speed){
    const c=center(e);
    const dx = tx - c.x, dy = ty - c.y;
    const L = Math.hypot(dx,dy) || 1;
    const s = speed;
    e.vx += (dx/L)*s;
    e.vy += (dy/L)*s;
  }

  // ---------------- Core de entidad ----------------
  function spawn(opts={}){
    const B=BAL();
    const tx = Number.isFinite(opts.tx)?opts.tx : (G.spawn?.tx ?? 2);
    const ty = Number.isFinite(opts.ty)?opts.ty : (G.spawn?.ty ?? 2);
    const pos = placeSafeNear(tx,ty,B.w,B.h);

    const t = {
      id: 'TCAE'+(UID++),
      kind: ENT.TCAE,
      name: B.name,
      x: pos.x|0, y: pos.y|0,
      w: B.w|0, h: B.h|0,
      vx:0, vy:0,
      emitsLight:true,
      lightColor:B.lightColor,
      spriteKey: B.spriteKey,
      skin: 'TCAE.png',
      aiId: 'TCAE',
      // Estado
      mode: 'patrol',         // patrol|follow|toBell|toCart|reloading
      taskUntil: 0,           // timestamp para throttling
      targetId: null,         // id de paciente, carro, etc.
      followingPlayer: false,
      // recarga
      _reloading: false,
      _reloadEndAt: 0,
      _thinkAt: 0,
      // API por entidad
      interact(by){ return TCAE.toggleFollowNearest(by); }
    };
    (G.entities||(G.entities=[])).push(t);
    t.group = 'human';
    try { W.EntityGroups?.assign?.(t); } catch (_) {}
    try { W.EntityGroups?.register?.(t, G); } catch (_) {}
    try { W.AI?.attach?.(t, 'TCAE'); } catch (_) {}
    try {
      const puppet = window.Puppet?.bind?.(t, 'npc_tcae', { z: 0, scale: 1, data: { skin: t.skin } })
        || window.PuppetAPI?.attach?.(t, { rig: 'npc_tcae', z: 0, scale: 1, data: { skin: t.skin } });
      t.rigOk = t.rigOk === true || !!puppet;
    } catch (_) {
      t.rigOk = t.rigOk === true;
    }
    tryAttachFlashlight(t);
    return t;
  }

  // ---------------- IA paso-a-paso ----------------
  function updateOne(t, dt){
    if (!t || t._inactive) return;
    const B=BAL();

    // 1) Evitar peligros
    const av = dangerVector(t, B.avoidRadiusTiles);
    if (av.dx||av.dy){
      const L = Math.hypot(av.dx,av.dy)||1;
      t.vx += (av.dx/L)*B.avoidPush;
      t.vy += (av.dy/L)*B.avoidPush;
    }

    // 2) Si recargando, quedarse quieto hasta finalizar
    if (t._reloading){
      t.vx*=0.85; t.vy*=0.85;
      if (performance.now() >= t._reloadEndAt){
        finishReload(t);
      }
      moveWithCollisions(t, dt);
      friction(t,B);
      return;
    }

    // 3) Think con throttling
    if (performance.now() >= t._thinkAt){
      t._thinkAt = performance.now() + B.thinkMs;

      // Prioridad 1: si hay paciente con timbre en rango amplio → ir
      const bell = nearestRingingPatient(t, B.detectBellTiles);
      if (bell){
        t.mode='toBell'; t.targetId=bell.id||bell.__id||bell; // heurístico
      } else {
        // Prioridad 2: Carro MED vacío/“bajo” cercano → ir a recargar
        const cart = nearestMedCart(t, /*onlyEmptyOrLow*/true);
        if (cart){
          t.mode='toCart'; t.targetId=cart.id||cart.__id||cart;
        } else if (t.followingPlayer && G.player) {
          t.mode='follow'; t.targetId=null;
        } else {
          t.mode='patrol'; t.targetId=null;
        }
      }
    }

    // 4) Ejecutar modo actual
    if (t.mode==='toBell'){
      // moverse hacia el paciente y calmar el timbre si está dentro de rango
      const p = (G.entities||[]).find(e => (e.id===t.targetId || e===t.targetId) && e.kind===ENT.PATIENT && e.ringing);
      if (!p){ t.mode='patrol'; }
      else {
        const c2=center(p);
        goToTarget(t, c2.x, c2.y, B.run);
        const d = Math.hypot(c2.x - (t.x+t.w*0.5), c2.y - (t.y+t.h*0.5));
        if (d <= B.helpRadiusTiles*TILE){
          calmBell(p);
          t.mode = t.followingPlayer ? 'follow' : 'patrol';
        }
      }
    } else if (t.mode==='toCart'){
      const cart = (G.entities||[]).find(e => (e.id===t.targetId || e===t.targetId) && e.kind===ENT.CART);
      if (!cart){ t.mode='patrol'; }
      else {
        ensureMedMeta(cart);
        const c2=center(cart);
        goToTarget(t, c2.x, c2.y, B.run);
        const d = Math.hypot(c2.x - (t.x+t.w*0.5), c2.y - (t.y+t.h*0.5));
        if (d <= B.reloadNearTiles*TILE){
          // comienza recarga si está vacío o bajo
          if (cart.usesLeft < MED_MAX_USES){
            beginReload(t, cart);
          } else {
            // ya estaba lleno: a otra tarea
            t.mode = t.followingPlayer ? 'follow' : 'patrol';
          }
        }
      }
    } else if (t.mode==='follow' && G.player){
      const pc = center(G.player), tc=center(t);
      const d = Math.hypot(pc.x-tc.x, pc.y-tc.y);
      if (d > BAL().followDistTiles*TILE) goToTarget(t, pc.x, pc.y, B.speed);
    } else {
      // patrol → deambular suave
      const jitter = 0.5;
      t.vx += (Math.random()-0.5)*jitter;
      t.vy += (Math.random()-0.5)*jitter;
    }

    moveWithCollisions(t, dt);
    friction(t,B);
  }

  function friction(t,B){
    t.vx *= B.friction; t.vy *= B.friction;
    if (Math.abs(t.vx)<0.01) t.vx=0;
    if (Math.abs(t.vy)<0.01) t.vy=0;
  }

  // ---------------- Timbrado / asistencia ----------------
  function calmBell(patient){
    // Integra con tu sistema: marcamos attended/stop ring y damos “bonus tiempo”
    if (!patient) return;
    patient.ringing = false;
    patient.attended = true;
    patient.ringDeadline = Math.max(patient.ringDeadline||0, Date.now()+12000);
    // SFX opcional
    try{ W.AudioAPI?.play?.('bell_off',{vol:0.8}); }catch(_){}
  }

  // ---------------- Ciclo de recarga ----------------
  function beginReload(t, cart){
    const B=BAL();
    ensureMedMeta(cart);
    // “Modo de recarga”: inmoviliza al TCAE y al cart durante unos segundos
    t._reloading = true;
    t._reloadEndAt = performance.now() + B.reloadTimeMs;
    t._reloadingCartRef = cart;

    // feedback
    try{ W.AudioAPI?.play?.('reload_start',{vol:0.8}); }catch(_){}
    TeamBus.publish('cart:reload:start', { tcae:t, cart });

    // cart “bloqueado” mientras recarga
    cart.pushable = false;
    cart.reloading = true;
  }

  function finishReload(t){
    const cart = t._reloadingCartRef;
    t._reloading=false;
    t._reloadingCartRef=null;

    if (cart){
      ensureMedMeta(cart);
      cart.usesLeft = MED_MAX_USES;
      cart.reloading = false;
      updateCartPushability(cart); // vuelve a pushable=true
      // notifica
      try { W.dispatchEvent?.(new CustomEvent('cart:reloaded', { detail:{ cart, type:'med' } })); } catch(_){}
      TeamBus.publish('cart:reload:done', { cart, type:'med' });
      try{ W.AudioAPI?.play?.('reload_done',{vol:0.9}); }catch(_){}
    }
  }

  // ---------------- API pública TCAE ----------------
  const TCAE = {
    spawn,
    list,
    // toggle follow del TCAE más cercano al jugador
    toggleFollowNearest(player){
      if (!player) player = G.player;
      if (!player) return false;
      const arr = list(); if (!arr.length) return false;
      let best=null, bd=Infinity, pc=center(player);
      for (const t of arr){
        const tc=center(t); const d2=dist2(pc.x,pc.y,tc.x,tc.y);
        if (d2<bd){ bd=d2; best=t; }
      }
      if (best){
        best.followingPlayer = !best.followingPlayer;
        best.mode = best.followingPlayer ? 'follow' : 'patrol';
        return true;
      }
      return false;
    },
    // ciclo global
    update(dt=1/60){
      // Asegura meta de carros MED existentes (por si los creó otro sistema)
      for (const e of (G.entities||[])){
        if (e && e.kind===ENT.CART && ((e.cartType||e.type||'').toLowerCase()==='med')){
          ensureMedMeta(e);
        }
      }
      for (const t of list()) updateOne(t, dt);
    }
  };

  W.Entities = W.Entities || {};
  W.Entities.TCAE = TCAE;

  // ---------------- Autoinstalación en el loop ----------------
  // Si tu game loop tiene G.__updateHooks, nos registramos ahí.
  // Si no, activamos un pequeño RAF con dt fijo (no interfiere si ya tienes loop).
  (function autoHook(){
    if (Array.isArray(G.__updateHooks)){
      const hook = (dt)=> TCAE.update(dt);
      if (!G.__updateHooks.includes(hook)) G.__updateHooks.push(hook);
      return;
    }
    // RAF fallback (se desactiva si detecta un hook externo llamando update)
    let last = performance.now();
    function tick(){
      // Si el motor externo ya nos está llamando (flag), paramos el RAF
      if (G._externalUpdateCallsTCAE){ return; }
      const now = performance.now();
      const dt = Math.min(1/30, (now-last)/1000);
      last = now;
      try { TCAE.update(dt); } catch(_){}
      W.requestAnimationFrame(tick);
    }
    W.requestAnimationFrame(tick);
  })();

  // ---------------- Señal para “usar medicinas” ejemplo ----------------
  // Si en algún sitio del juego se cura a un paciente usando un carro MED cercano:
  //   CartMeds.consume(cart, 1);
  // Este script reacciona, y cuando usesLeft llega a 0 → TCAE lo recarga.
  // También puedes disparar:  window.dispatchEvent(new CustomEvent('med:consume',{detail:{cart,n:1}}))
  // ---------------------------------------------------------------------

})(this);