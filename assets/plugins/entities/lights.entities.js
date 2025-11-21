/* filename: lights.entities.js
   Entidades de luz + linternas, con color por zona y rotas por ASCII.
   - Color por zona:
       · Sala de control -> azules
       · En / cerca de Boss room -> rojas
       · Otras salas / pasillos -> amarillos (tintes/ intensidades variadas)
   - Rotas: si el mapa marca 'l' (minúscula) o p.broken=true, parpadean.
   - Linterna (cono) para héroes/NPCs (color según héroe).
*/
(function (W) {
  'use strict';

  W.Entities = W.Entities || {};
  const ENT  = W.ENT || (W.ENT = {});
  const TILE = W.TILE_SIZE || W.TILE || 32;

  // ──────────────────────────────────────────────────────────
  // Utilidades
  // ──────────────────────────────────────────────────────────
  function inRectTile(tx, ty, r){
    if (!r) return false;
    return tx >= r.x && ty >= r.y && tx < (r.x + r.w) && ty < (r.y + r.h);
  }
  function dist2(a, b){ const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy; }

  function pickYellowVariant(){
    // paleta suave (sin “saturar” el mapa)
    const pool = [
      { color:'#fff2c0', intensity:0.62 },
      { color:'#ffe9a6', intensity:0.55 },
      { color:'#ffefb3', intensity:0.58 },
      { color:'#ffe29a', intensity:0.52 },
      { color:'#ffecad', intensity:0.60 },
    ];
    return pool[(Math.random()*pool.length)|0];
  }

  // Mapas de color por zona
  function colorByZone(x, y, p){
    // Prioridad: si el placement ya trae color/radio/intensidad, respetar
    if (p && (p.color || p.intensity || p.radius)) return {
      color: p.color,
      intensity: (typeof p.intensity === 'number') ? p.intensity : 0.60,
      radius: p.radius || TILE*5
    };

    const G = W.G || {};
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);

    // 1) Boss room (o cerca): ROJA
    const bossRect = G.areas && G.areas.boss;
    if (bossRect && (inRectTile(tx, ty, bossRect) || (()=>{ // “cerca de”
      const cx = (bossRect.x + bossRect.w/2), cy = (bossRect.y + bossRect.h/2);
      return dist2({x:tx,y:ty},{x:cx,y:cy}) <= (18*18); })())) {
      return { color:'#ff4d4d', intensity:0.70, radius:TILE*6.5 };
    }

    // 2) Sala de Control: AZUL
    const ctrlRect = G.areas && G.areas.control;
    if (inRectTile(tx, ty, ctrlRect)) {
      return { color:'#66b3ff', intensity:0.65, radius:TILE*6 };
    }

    // 3) Resto: AMARILLOS con variación
    const v = pickYellowVariant();
    return { color: v.color, intensity: v.intensity, radius:TILE*5.2 };
  }

  // ──────────────────────────────────────────────────────────
  // Entidades de luz
  // Requiere LightingAPI.addLight({x,y,radius,color,intensity,broken,...})
  // (ver motor de luces y FOW direccional). 0
  // ──────────────────────────────────────────────────────────
  class LightEntity {
    constructor(p){
      // p: {x,y,color,intensity,radius,broken,type, _ascii:'L'|'l'}
      const base = colorByZone(p.x||0, p.y||0, p||{});
      const broken = !!(p && (p.broken || p._ascii === 'l' || p.char === 'l'));
      const radius = p.radius || base.radius;
      const intensity = (typeof p.intensity==='number'?p.intensity:base.intensity);

      this.x = (p.x|0)||0; this.y = (p.y|0)||0;
      this.w = 2; this.h = 2;
      this.kind = ENT.LIGHT || (ENT.LIGHT = 505);
      this._lightId = (W.LightingAPI && W.LightingAPI.addLight({
        x:this.x, y:this.y,
        radius,
        color:   (p.color  || base.color),
        intensity,
        broken,
        type: p.type || 'room'
      })) || null;

      // Si quieres que “ocupe” para el renderer (invisible):
      this.static = true;
      this.solid = false;
      this.dead  = false;

      try {
        const puppet = window.Puppet?.bind?.(this, 'light', { z: 0, scale: 1, data: { radius, intensity, broken } })
          || window.PuppetAPI?.attach?.(this, { rig: 'light', z: 0, scale: 1, data: { radius, intensity, broken } });
        this.rigOk = this.rigOk === true || !!puppet;
      } catch (_) {
        this.rigOk = this.rigOk === true;
      }
    }
    update(/*dt*/){}
    draw(/*ctx*/){}
    destroy(){
      if (this.dead) return;
      this.dead = true;
      try { if (this._lightId && W.LightingAPI) W.LightingAPI.removeLight(this._lightId); } catch(e){}
    }
  }

  class BossLight extends LightEntity {
    constructor(p){
      // Fuerza color dinámico del motor (oscila rojo/azul). 1
      super({ ...p, radius: p.radius || TILE*7, intensity: (typeof p.intensity==='number'?p.intensity:0.72), type:'boss' });
    }
  }

  // ──────────────────────────────────────────────────────────
  // Linternas (cono) en héroes/NPCs
  // ──────────────────────────────────────────────────────────
  function flashlightColorForHero(heroId){
    // Pediste: Francesco=azul, Enrique=amarillo, Roberto=naranja
    const k = String(heroId||'').toLowerCase();
    if (k.includes('francesco')) return '#66b3ff';
    if (k.includes('enrique'))   return '#ffd34d';
    if (k.includes('roberto'))   return '#ff9f40';
    return '#fff2c0';
  }

  /** Engancha una linterna CONO a 'owner' (usa facing/vx,vy) */
  function attachFlashlight(owner, opts={}){
    if (!owner || !W.LightingAPI) return null;
    const heroKey = (owner.skin || owner.heroId || W.selectedHeroKey || '');
    const color   = opts.color || flashlightColorForHero(heroKey);

    const tileSize = (typeof TILE === 'number' && TILE > 0) ? TILE : 32;
    const desiredRadius = opts.radius   || tileSize * 6.5;
    const cullTiles = Number.isFinite(W?.G?.cullingRadiusTiles) && W.G.cullingRadiusTiles > 0 ? W.G.cullingRadiusTiles : null;
    const maxRadiusPx = cullTiles ? Math.max(tileSize, (cullTiles - 1) * tileSize) : null;
    const radius = maxRadiusPx ? Math.min(desiredRadius, maxRadiusPx) : desiredRadius;
    const intensity = (typeof opts.intensity === 'number' ? opts.intensity : 0.90);
    const offsetX = Number.isFinite(opts.offsetX) ? opts.offsetX
      : (Number.isFinite(owner.flashlightOffsetX) ? owner.flashlightOffsetX : 0);
    const offsetY = Number.isFinite(opts.offsetY) ? opts.offsetY
      : (Number.isFinite(owner.flashlightOffsetY) ? owner.flashlightOffsetY : 0);
    const id = W.LightingAPI.addLight({
      owner,
      color,
      radius,
      coneDeg: opts.coneDeg  || 70,
      intensity,
      type: 'npc',
      offsetX,
      offsetY
    });

    try {
      const label = owner.displayName || owner.name || owner.heroId || owner.kindName || owner.kind || 'entidad';
      const radiusTiles = (radius / TILE).toFixed(2);
      // console.log(`[Debug] Flashlight attached to ${label}: color=${color}, radius=${radius.toFixed(1)}px (${radiusTiles} tiles), intensity=${intensity.toFixed(2)}.`);
    } catch (_) {}
    try { W.Puppet?.__notifyLightsReady?.(); } catch (_) {}

    // Limpieza automática
    const prev = owner.onDestroy;
    owner.onDestroy = function(){
      try { W.LightingAPI.removeLight(id); } catch(e){}
      if (typeof prev === 'function') prev.call(owner);
    };
    return id;
  }

  // ──────────────────────────────────────────────────────────
  // API pública
  // ──────────────────────────────────────────────────────────
  function spawnLight(x, y, p={}){
    const e = new LightEntity({ x, y, ...p });
    (W.G?.entities || (W.G.entities=[])).push(e);
    return e;
  }
  function spawnBossLight(x, y, p={}){
    const e = new BossLight({ x, y, ...p });
    (W.G?.entities || (W.G.entities=[])).push(e);
    return e;
  }

  // Integración con placement.api.js (p.type==='light'/'boss_light')
  W.Entities.spawnFromPlacement_Light = function(p){ return spawnLight(p.x|0, p.y|0, p); };
  W.Entities.spawnFromPlacement_BossLight = function(p){ return spawnBossLight(p.x|0, p.y|0, p); };

  // Exponer
  W.Entities.Light = { spawn: spawnLight };
  W.Entities.BossLight = BossLight;
  W.Entities.attachFlashlight = attachFlashlight;

})(this);