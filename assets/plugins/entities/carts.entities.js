// filename: carts.entities.js
// API de CARROS (Food / Med / ER) para “Il Divo: Hospital Dash!”
// - Independiente y tolerante: no requiere spawner para poblar al inicio.
// - Se integra con placement.api.js vía Entities.Cart.spawn(sub, x, y, p)
// - Compat con physics.plugin.js (cartImpactDamage) poniendo kind===5.
// - Fallbacks si faltan helpers del motor (isWallAt, moveWithCollisions, etc).

(function () {
  'use strict';

  // ---------------- Entorno / constantes ----------------
  const TILE = (typeof window.TILE_SIZE !== 'undefined') ? window.TILE_SIZE : (window.TILE || 32);

  // ENT map (asegura IDs y que CART sea 5 para el plugin de físicas)
  const ENT = (function () {
    const e = window.ENT || (window.ENT = {});
    e.PLAYER = (e.PLAYER ?? 1);
    e.ENEMY  = (e.ENEMY  ?? 10);
    e.NPC    = (e.NPC    ?? 20);
    e.DOOR   = (e.DOOR   ?? 30);
    e.CART   = 5; // <- MUY IMPORTANTE: el plugin de físicas mira kind===5
    e.ITEM   = (e.ITEM   ?? 902);
    return e;
  })();

  function getG() { return window.G || (window.G = { entities:[], movers:[], rng: Math.random }); }
  function sign(v){ return v<0?-1:(v>0?1:0); }
  function len(vx,vy){ return Math.sqrt((vx||0)*(vx||0)+(vy||0)*(vy||0)); }
  function clamp(v,a,b){ return v<a?a:(v>b?b:v); }

  // ---------- Fallbacks de motor ----------
  function _AABB(a,b){
    if (typeof window.AABB === 'function') return window.AABB(a,b);
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function _isWallAt(x,y,w,h){
    if (typeof window.isWallAt === 'function') return window.isWallAt(x,y,w,h);
    const G=getG();
    const x1=Math.floor(x/TILE), y1=Math.floor(y/TILE);
    const x2=Math.floor((x+w-1)/TILE), y2=Math.floor((y+h-1)/TILE);
    for(let ty=y1; ty<=y2; ty++){
      for(let tx=x1; tx<=x2; tx++){
        if (G.map?.[ty]?.[tx]===1) return true;
      }
    }
    return false;
  }
  function _moveWithCollisions(e){
    if (typeof window.moveWithCollisions === 'function') { window.moveWithCollisions(e); return; }
    // Fallback minimal (barrido por ejes con rebote)
    const sub=3, rest=(e.restitution ?? 0.55);
    for(let i=0;i<sub;i++){
      const sx=(e.vx||0)/sub, sy=(e.vy||0)/sub;
      let nx=e.x+sx;
      if (_isWallAt(nx,e.y,e.w,e.h)) { nx=e.x; e.vx=-(e.vx||0)*rest; }
      e.x=nx;
      let ny=e.y+sy;
      if (_isWallAt(e.x,ny,e.w,e.h)) { ny=e.y; e.vy=-(e.vy||0)*rest; }
      e.y=ny;
    }
  }
  function sfx(name, vol=1){ if (name && window.AudioAPI?.play) try{ window.AudioAPI.play(name,{vol}); }catch{} }

  // ---------------- Config por defecto ----------------
  const DEFAULT_CFG = {
    maxSpeed: 7.0,
    friction: 0.94,
    restitution: 0.55,
    playerPushImpulse: 8.5,
    crushThreshold: 5.0,      // velocidad relativa para dañar
    explodeThreshold: 8.0,    // food/med solo
    maxBouncesToExplode: 10,
    integrityFood: 24,
    integrityMed: 20,
    integrityER: 9999,        // nunca explota
    width: TILE*0.9,
    height: TILE*1.2,
    sfx: { hit:'cart_hit', explode:'cart_boom', ping:'cart_ping' },
    dropCounts: { food:[3,7], med:[2,4], coins:[3,6] },
  };

  function resolveConfig(){
    const B = getG().BALANCE?.carts;
    return { ...DEFAULT_CFG, ...(B||{}) };
  }

  // ---------------- API principal ----------------
  const Carts = {
    _G: null,
    _cfg: null,
    _list: [],
    _pool: [],
    TYPES: { FOOD:'food', MED:'med', ER:'er' },

    init(Gref){
      this._G = Gref || getG();
      this._cfg = resolveConfig();
      this._list.length = 0;
    },

    create(type, x, y, opts={}){
      if (!this._cfg) this._cfg = resolveConfig();
      const W=this._cfg.width|0, H=this._cfg.height|0;
      const e = this._pool.pop() || {};
      e.kind=ENT.CART;
      e.cartType=(type===this.TYPES.ER||type===this.TYPES.MED)?type:this.TYPES.FOOD;
      e.x=(x|0); e.y=(y|0); e.w=(opts.w|0)||W; e.h=(opts.h|0)||H;
      e.vx=0; e.vy=0;
      e.pushable=true; e.solid=true; e.static=false; e.mass=1.0;
      e.friction=this._cfg.friction; e.restitution=this._cfg.restitution; e.maxSpeed=this._cfg.maxSpeed;
      e.canExplode = (e.cartType!==this.TYPES.ER);
      e.integrity  = (e.cartType===this.TYPES.FOOD? this._cfg.integrityFood
                    : e.cartType===this.TYPES.MED ? this._cfg.integrityMed
                    : this._cfg.integrityER);
      // sprites por clave (SpritesAPI los mapea en draw)
      e.spriteKey = (e.cartType===this.TYPES.ER)? 'carro_urgencias' : (e.cartType===this.TYPES.MED? 'carro_medicinas' : 'carro_comida');
      // callbacks opcionales
      e.onExplode = opts.onExplode || null;
      e.dead = false;

      const rigName = (e.cartType === this.TYPES.ER)
        ? 'cart_emergency'
        : (e.cartType === this.TYPES.MED ? 'cart_meds' : 'cart_food');
      try {
        window.PuppetAPI?.attach?.(e, { rig: rigName, z: 0, scale: 1, data: { phase: Math.random() * Math.PI * 2 } });
      } catch (_) {}

      // registro
      const G=getG();
      if (!G.entities?.includes(e)) G.entities.push(e);
      if (!G.movers?.includes(e))   G.movers.push(e);
      if (!this._list.includes(e))  this._list.push(e);

      return e;
    },

    // wrapper de compat con placement.api.js y SpawnerAPI
    spawn(sub, x, y, p){
      const type = (typeof sub==='string'? sub : (p?.type||'med')).toLowerCase();
      return this.create(type, x|0, y|0, p||{});
    },

    remove(e){
      if (!e) return;
      e.dead = true;
      const G=getG();
      const rm=(arr,it)=>{ const i=arr?.indexOf(it); if (i>=0) arr.splice(i,1); };
      rm(this._list,e); rm(G.entities,e); rm(G.movers,e);
      // recicla
      this._pool.push(e);
      // notifica muerte (para spawner externo que escuche)
      try { window.dispatchEvent?.(new CustomEvent('entity:death', { detail:{ kind:'cart', sub:e.cartType, entity:e } })); } catch {}
    },

    // update opcional: si no usas physics.plugin, puedes llamarlo desde tu loop
    update(dt=1/60){
      const G=getG();
      const cfg=this._cfg || (this._cfg=resolveConfig());
      for (const e of this._list){
        if (!e || e.dead) continue;

        // limitar velocidad
        const sp = len(e.vx,e.vy);
        if (sp > cfg.maxSpeed){ const k = cfg.maxSpeed / (sp||1); e.vx*=k; e.vy*=k; }

        // rozamiento (si el motor no lo aplica)
        e.vx *= cfg.friction; e.vy *= cfg.friction;
        if (Math.abs(e.vx)<0.001) e.vx=0;
        if (Math.abs(e.vy)<0.001) e.vy=0;

        _moveWithCollisions(e);

        // Si queda empotrado en muro, saca un poco
        if (_isWallAt(e.x,e.y,e.w,e.h)){ e.x+=sign(e.vx||1); e.y+=sign(e.vy||1); }

        // Colisiones “suaves” con entidades cercanas (si no tienes physics.plugin)
        for (const o of G.entities){
          if (!o || o===e || o.dead) continue;
          if (!_AABB(e,o)) continue;
          // empuje mínimo
          const ax=e.x+e.w*0.5, ay=e.y+e.h*0.5;
          const bx=o.x+o.w*0.5, by=o.y+o.h*0.5;
          const dx=bx-ax, dy=by-ay;
          if (Math.abs(dx) > Math.abs(dy)) e.vx -= sign(dx)*0.3; else e.vy -= sign(dy)*0.3;

          // “aplastar” si pega fuerte
          crushIfNeeded(e,o);
        }

        // Explosión por integridad o por exceso de rebotes (si decides contarlos fuera)
        if (e.canExplode && e.integrity<=0){
          explodeCart(e);
        }
      }
    }
  };

  // ---------------- Interacciones / daño / drops ----------------
  function crushIfNeeded(cart, other){
    const cfg = Carts._cfg || (Carts._cfg = resolveConfig());
    const sp  = len(cart.vx, cart.vy);
    if (sp < cfg.crushThreshold) return;

    const lethal = sp >= (cfg.explodeThreshold * 0.9);
    const isDamageable =
      (other.kind === ENT.PLAYER) || (other.kind === ENT.ENEMY) || (other.kind === ENT.NPC);

    if (!isDamageable) return;

    const dmg = lethal ? 3 : 1;
    applyDamage(other, dmg);

    if (cart.canExplode) cart.integrity -= lethal ? 6 : 2;

    // si no es player y el impacto fue letal → “muerte”
    if (lethal && other.kind !== ENT.PLAYER){
      const meta = {
        via:'cart',
        impactSpeed: sp,
        killerTag: (cart._lastPushedBy || null),
        killerId:  (cart._lastPushedId || null),
        killerRef: (cart._pushedByEnt || cart._grabbedBy || null)
      };
      if (window.killEntityGeneric) window.killEntityGeneric(other, meta);
      else killEntity(other);
      spawnLootBurst(other.x+other.w*0.5, other.y+other.h*0.5, { coins:[2,5] });
    }

    // jugador empotrado contra muro → sácalo un poco
    if (other.kind === ENT.PLAYER && _isWallAt(other.x,other.y,other.w,other.h)){
      other.x -= sign(cart.vx||1)*2;
      other.y -= sign(cart.vy||1)*2;
    }
  }

  function applyDamage(ent, dmg){
    const G=getG();
    if (ent.kind===ENT.PLAYER){
      if (typeof G.damagePlayer === 'function'){ G.damagePlayer(dmg); return; }
      ent.hp = Math.max(0, (ent.hp||3)-dmg);
      if (ent.hp<=0){ ent.dead=true; if (typeof G.onPlayerDeath==='function') G.onPlayerDeath(); }
      return;
    }
    ent.hp = Math.max(0, (ent.hp||1)-dmg);
    if (ent.hp<=0) ent.dead=true;
  }

  function killEntity(ent){
    ent.dead = true;
    const G=getG();
    const rm=(arr,it)=>{ const i=arr?.indexOf(it); if (i>=0) arr.splice(i,1); };
    rm(G.entities,ent); rm(G.movers,ent);
  }

  function explodeCart(e){
    // ER nunca explota (seguridad)
    if (e.cartType===Carts.TYPES.ER){ e.integrity=9999; return; }
    sfx(Carts._cfg.sfx.explode, 0.8);

    const drops = Carts._cfg.dropCounts;
    if (e.cartType===Carts.TYPES.FOOD){
      for (let i=0,n=randIntIn(drops.food[0], drops.food[1]); i<n; i++) spawnItemAround(e.x+e.w*0.5, e.y+e.h*0.5, 'food');
      for (let i=0,n=randIntIn(drops.coins[0],drops.coins[1]); i<n; i++) spawnItemAround(e.x+e.w*0.5, e.y+e.h*0.5, 'coin');
    } else if (e.cartType===Carts.TYPES.MED){
      for (let i=0,n=randIntIn(drops.med[0], drops.med[1]); i<n; i++) spawnItemAround(e.x+e.w*0.5, e.y+e.h*0.5, 'med');
      for (let i=0,n=randIntIn(drops.coins[0],drops.coins[1]); i<n; i++) spawnItemAround(e.x+e.w*0.5, e.y+e.h*0.5, 'coin');
    }

    if (typeof e.onExplode === 'function'){ try{ e.onExplode(e); }catch{} }
    Carts.remove(e);
  }

  function spawnLootBurst(cx,cy,opts){ // opcional / suave
    const c=randIntIn(opts?.coins?.[0]||1, opts?.coins?.[1]||3);
    for (let i=0;i<c;i++) spawnItemAround(cx,cy,'coin');
  }

  function spawnItemAround(cx,cy,kind){
    // Primero intenta Objects API del juego
    const O = window.Entities?.Objects;
    if (O?.spawnCoin && kind==='coin') { O.spawnCoin(cx,cy); return; }
    if (O?.spawnFood && kind==='food') { O.spawnFood(cx,cy); return; }
    if (O?.spawnPill && kind==='med')  { O.spawnPill(cx,cy); return; }
    // Fallback visible
    const G=getG(), size=Math.max(10, TILE*0.5);
    const e = { x:cx-6+Math.random()*12, y:cy-6+Math.random()*12, w:size*0.5, h:size*0.5,
                kind:ENT.ITEM, color: kind==='coin' ? '#ffd54f' : (kind==='food' ? '#8bc34a' : '#7ddfff'),
                vx:(Math.random()-0.5)*2, vy:(Math.random()-0.5)*2 };
    (G.entities||=[]).push(e); (G.movers||=[]).push(e);
  }

  function randIntIn(a,b){ return (a|0) + Math.floor(Math.random()*((b|0)-(a|0)+1)); }

  // ---------------- Helpers utilitarios / debug ----------------
  function removeFromArray(arr,item){ if (!arr) return; const i=arr.indexOf(item); if (i>=0) arr.splice(i,1); }

  // “pastilla final” cuando el ER está cerca del boss
  Carts.trySpawnFinalPillNearBoss = function(erCart, boss, radius=TILE*2){
    if (!erCart || !boss) return false;
    const cx=erCart.x+erCart.w*0.5, cy=erCart.y+erCart.h*0.5;
    const bx=boss.x+boss.w*0.5, by=boss.y+boss.h*0.5;
    if (Math.hypot(cx-bx, cy-by) <= radius){ spawnItemAround(bx,by,'med'); return true; }
    return false;
  };

  // Debug helper: triada en línea
  Carts.debugSpawnTriplet = function(x,y){
    Carts.create(Carts.TYPES.FOOD, x, y);
    Carts.create(Carts.TYPES.MED , x+TILE*1.2, y);
    Carts.create(Carts.TYPES.ER  , x+TILE*2.4, y);
  };

  // ---------------- Exponer API ----------------
  window.Carts = Carts;
  window.CartsAPI = window.CartsAPI || window.Carts;

  // Auto-init suave si el dev no llama a init()
  if (document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(()=>{ if (!Carts._cfg) Carts.init(window.G); },0);
  } else {
    document.addEventListener('DOMContentLoaded', ()=>{ if (!Carts._cfg) Carts.init(window.G); });
  }
})();

// Compat con placement.api.js → Entities.Cart.spawn(sub,x,y,p)
window.Entities = window.Entities || {};
window.Entities.Cart = {
  spawn: (sub, x, y, p) => (window.CartsAPI?.spawn ? window.CartsAPI.spawn(sub, x, y, p) : null)
};