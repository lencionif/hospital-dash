// filename: hazards.entities.js
// PELIGROS DE SUELO — “Il Divo: Hospital Dash!”
//
// • Suelo mojado (resbalón): reduce control, aumenta “deslizamiento”; TTL y auto-limpieza.
// • Fuego: daño/segundo, ignición visual (opcional luz), TTL y auto-apagado.
// • Explosiones: empujón 360° (billar), daño instantáneo, puede encender fuego, respeta LOS (paredes).
//
// Contratos: G, ENT, TILE_SIZE, AABB, isWallAt(x,y,w,h), moveWithCollisions(e,dt) (si existe),
//            Physics.applyImpulse(entity, ix, iy) (si existe), LightingAPI (opcional), AudioAPI (opcional).
// Integración mínima: init() en start, update(dt) cada frame, y (opcional) parseMap para 'W' y 'F'.
//
// ENT sugeridos (si G.ENT existe, se usan; si no, strings):
//   HAZARD_WET, HAZARD_FIRE, HAZARD_SCORCH
//
(function(){
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const H = Math.hypot;

  const DEFAULTS = {
    tile: 32,

    // Suelo mojado
    wet: {
      ttl: 28,                 // segundos
      slipMul: 1.25,           // >1 => más deslizante (menos control)
      dragMul: 0.92,           // multiplicador a la amortiguación (se desliza más)
      color: 'rgba(120,180,255,0.65)',
      spriteKey: 'tile_floor_wet'
    },

    // Fuego
    fire: {
      ttl: 18,                 // segundos
      dps: 2,                  // “medios corazones” por segundo (2 => 1 corazón/s)
      tick: 0.25,              // intervalo daño
      color: 'rgba(255,140,60,0.85)',
      lightRadiusTiles: 3.2,   // radio luz (si LightingAPI)
      lightIntensity: 0.6,
      flickerHz: [3.5, 5.0],
      spriteKey: 'tile_fire'
    },

    // Explosión
    explosion: {
      radiusTiles: 3.8,        // radio en tiles
      impulse: 420,            // impulso base
      damageHalves: 4,         // daño instantáneo (mitades)
      igniteChance: 0.45,      // prob de encender casillas libres
      scorchTTL: 10,           // brasas residuales
      flashMs: 120             // luz flash muy breve (si LightingAPI)
    },

    // Daño por aplastamiento por impulso relativo
    crushImpulseToDie: 240,

    // Qué entidades pueden recibir daño de fuego/explosión
    damageKinds: ['player','rat','mosquito','furious','familiar','supervisora','tcae','celador','medic','chief','npc','boss'],

    // Dibujo simple (por si no usas SpriteManager en drawEntities)
    shapes: {
      wetRadius: 12,           // px
      fireInner: 6,            // px
      fireOuter: 12            // px
    }
  };

  const HazardsAPI = {
    G:null, cfg:null, TILE:32,
    list: [],            // entidades de peligro: {kind, x,y,w,h, ttl, ...}
    _tickAcc: 0,

    // === INIT / HELPERS ===
    init(Gref, opts={}){
      this.G = Gref || window.G || (window.G={});
      this.TILE = (typeof window.TILE_SIZE!=='undefined') ? window.TILE_SIZE : (opts.tile || DEFAULTS.tile);
      this.cfg = deepMerge(DEFAULTS, opts||{});
      if (!Array.isArray(this.G.entities)) this.G.entities = [];
      if (!this.G.ENT) this.G.ENT = {};
      this.G.ENT.HAZARD_WET   = this.G.ENT.HAZARD_WET   || 'hazard_wet';
      this.G.ENT.HAZARD_FIRE  = this.G.ENT.HAZARD_FIRE  || 'hazard_fire';
      this.G.ENT.HAZARD_SCORCH= this.G.ENT.HAZARD_SCORCH|| 'hazard_scorch';
      return this;
    },

    // === SPAWNERS DE CASILLA ===
    // tx,ty son coords de tile. Crea una “mancha” centrada en tile.
    spawnWet(tx, ty, opt={}){
      const w = this.TILE*0.9, h = this.TILE*0.9;
      const e = {
        kind: this.G.ENT.HAZARD_WET, ttl: opt.ttl ?? this.cfg.wet.ttl,
        x: tx*this.TILE + (this.TILE-w)/2, y: ty*this.TILE + (this.TILE-h)/2, w, h,
        slipMul: opt.slipMul ?? this.cfg.wet.slipMul,
        dragMul: opt.dragMul ?? this.cfg.wet.dragMul,
        color:   opt.color   ?? this.cfg.wet.color,
        spriteKey: this.cfg.wet.spriteKey,
        solid:false, dynamic:false, pushable:false, dead:false
      };
      this._register(e);
      try { window.PuppetAPI?.attach?.(e, { rig: 'hazard_water', z: 0, scale: 1 }); } catch (_) {}
      return e;
    },

    spawnFire(tx, ty, opt={}){
      const w = this.TILE*0.9, h = this.TILE*0.9;
      const lightR = (opt.lightRadiusTiles ?? this.cfg.fire.lightRadiusTiles) * this.TILE;
      const e = {
        kind: this.G.ENT.HAZARD_FIRE, ttl: opt.ttl ?? this.cfg.fire.ttl,
        x: tx*this.TILE + (this.TILE-w)/2, y: ty*this.TILE + (this.TILE-h)/2, w, h,
        dps:    opt.dps  ?? this.cfg.fire.dps,
        tick:   this.cfg.fire.tick,
        tAcc:   0,
        color:  opt.color ?? this.cfg.fire.color,
        spriteKey: this.cfg.fire.spriteKey,
        solid:false, dynamic:false, pushable:false, dead:false,
        _lightId: null, _fHz: randRange(...this.cfg.fire.flickerHz),
        _lightR: lightR, _lightI: opt.lightIntensity ?? this.cfg.fire.lightIntensity
      };
      // luz fuego (opcional)
      if (window.LightingAPI){
        e._lightId = LightingAPI.addLight({
          x: e.x+e.w/2, y: e.y+e.h/2, radius: e._lightR, color: e.color, intensity: e._lightI, broken:true
        });
      }
      this._register(e);
      try { window.PuppetAPI?.attach?.(e, { rig: 'hazard_fire', z: 0, scale: 1 }); } catch (_) {}
      return e;
    },

    // Explosión puntual en (x,y) mundo (no tile)
    spawnExplosion(x, y, opt={}){
      const radius = (opt.radiusTiles ?? this.cfg.explosion.radiusTiles) * this.TILE;
      const impulse= opt.impulse ?? this.cfg.explosion.impulse;
      const dmg    = opt.damageHalves ?? this.cfg.explosion.damageHalves;
      const igniteP= opt.igniteChance ?? this.cfg.explosion.igniteChance;
      const scorchTTL = opt.scorchTTL ?? this.cfg.explosion.scorchTTL;

      // Luz flash breve (si LightingAPI)
      if (window.LightingAPI){
        const id = LightingAPI.addLight({ x, y, radius: radius*1.2, color: 'rgba(255,220,160,1)', intensity: 1.0 });
        setTimeout(()=>LightingAPI.removeLight(id), this.cfg.explosion.flashMs|0);
      }
      if (window.AudioAPI) AudioAPI.play?.('explosion', { volume:1 });

      // Efectos sobre entidades con LOS (sin atravesar muros)
      this._affectEntitiesByExplosion(x, y, radius, impulse, dmg);

      // Brasas residuales (opcional: encender ciertas casillas libres con prob)
      if (igniteP > 0){
        const rTiles = Math.ceil(radius / this.TILE);
        forEachCircleTile(this.TILE, x, y, rTiles, (tx,ty)=>{
          if (!inBounds(this.G, tx,ty)) return;
          if (this.G.map[ty][tx] !== 0) return;   // sólo suelo
          if (Math.random() < igniteP){
            this.spawnFire(tx,ty,{ ttl: scorchTTL, dps: Math.max(1, (dmg/4)|0), lightRadiusTiles: 2.3, lightIntensity: 0.45 });
          }
        });
      }
    },

    // === UPDATE ===
    update(dt){
      // 1) Aplicación de efectos por superposición (AABB)
      const ents = this.G.entities || [];
      for (const hz of [...this.list]){
        if (!hz || hz.dead) continue;

        // Tiempo de vida
        hz.ttl -= dt;
        if (hz.ttl <= 0){
          this._destroy(hz);
          continue;
        }

        // FUEGO – daño por tick + micro flicker luz
        if (hz.kind === this.G.ENT.HAZARD_FIRE){
          hz.tAcc += dt;
          if (hz._lightId && window.LightingAPI){
            // flicker suave
            const I0 = this.cfg.fire.lightIntensity;
            const I  = clamp(I0 * (0.85 + 0.15*Math.sin(performance.now()/1000 * hz._fHz)), 0.1, 1);
            LightingAPI.updateLight(hz._lightId, { x: hz.x+hz.w/2, y: hz.y+hz.h/2, intensity: I });
          }
          if (hz.tAcc >= hz.tick){
            hz.tAcc = 0;
            for (const e of ents){
              if (!e || e.dead) continue;
              if (!this._isDamageable(e)) continue;
              if (AABB(hz, e)){
                this._dealDamage(e, hz.dps * hz.tick, { source:'fire' });
              }
            }
          }
        }

        // SUELO MOJADO – slip: aumenta “inercia” y reduce control
        if (hz.kind === this.G.ENT.HAZARD_WET){
          for (const e of ents){
            if (!e || e.dead) continue;
            if (!e.dynamic) continue; // solo los que se mueven
            if (AABB(hz, e)){
              // resbalón: baja amortiguación (dragMul) y mete pequeño drift
              e.vx = (e.vx||0) * hz.dragMul;
              e.vy = (e.vy||0) * hz.dragMul;

              // si hay input/vel, proyecta un pelín más (efecto “me paso”)
              const sp = Math.hypot(e.vx||0, e.vy||0);
              if (sp > 2){
                const k = (hz.slipMul - 1) * 0.5; // 0..~0.2
                e.vx += (e.vx||0) * k * dt * 10;
                e.vy += (e.vy||0) * k * dt * 10;
              }
            }
          }
        }
      }
    },

    // === DIBUJO OPCIONAL (si prefieres pintarlo en tu drawEntities, NO uses esto) ===
    // Llama desde draw(), después de dibujar el mundo y antes de Lighting/Fog si usas el mismo canvas.
    drawSimple(ctx, camera){
      if (!ctx || !this.list.length) return;
      const w = ctx.canvas.width, h = ctx.canvas.height;
      for (const hz of this.list){
        const sx = (hz.x - camera.x) * camera.zoom + w/2;
        const sy = (hz.y - camera.y) * camera.zoom + h/2;
        const sw = hz.w * camera.zoom, sh = hz.h * camera.zoom;

        if (hz.kind === this.G.ENT.HAZARD_WET){
          ctx.save();
          ctx.fillStyle = this.cfg.wet.color;
          ctx.beginPath();
          // charco ovalado
          ctx.ellipse(sx+sw/2, sy+sh/2, sw*0.45, sh*0.30, 0, 0, Math.PI*2);
          ctx.fill();
          ctx.restore();
        } else if (hz.kind === this.G.ENT.HAZARD_FIRE){
          ctx.save();
          // “llama” simple (dos capas)
          ctx.translate(sx+sw/2, sy+sh/2);
          const t = performance.now()/1000;
          const r1 = this.cfg.shapes.fireOuter * camera.zoom * (0.9 + 0.2*Math.sin(t*12));
          const r2 = this.cfg.shapes.fireInner * camera.zoom * (0.9 + 0.2*Math.cos(t*15));
          const grad = ctx.createRadialGradient(0,0,r2, 0,0,r1);
          grad.addColorStop(0, 'rgba(255,255,180,0.95)');
          grad.addColorStop(1, this.cfg.fire.color);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0,0,r1,0,Math.PI*2);
          ctx.fill();
          ctx.restore();
        }
      }
    },

    // === INTEGRACIÓN CON PARSEMAP (opcional) ===
    // Llama p.ej. desde tu parseMap() si encuentras marcadores ASCII:
    //  'W' => Wet, 'F' => Fire
    parseMapMarker(ch, wx, wy){
      const tx = Math.floor(wx/this.TILE), ty = Math.floor(wy/this.TILE);
      if (ch==='W'){ this.spawnWet(tx,ty); return true; }
      if (ch==='F'){ this.spawnFire(tx,ty); return true; }
      return false;
    },

    // === PRIVADOS ===
    _register(e){
      this.G.entities.push(e);
      this.list.push(e);
    },
    _destroy(hz){
      hz.dead = true;
      // apagar luz si la hay
      if (hz._lightId && window.LightingAPI){
        try{ LightingAPI.removeLight(hz._lightId); }catch(_){}
      }
      this.list = this.list.filter(x=>x!==hz);
      this.G.entities = (this.G.entities||[]).filter(x=>x!==hz);
    },

    _isDamageable(e){
      if (e===this.G.player) return true;
      const k = (e.kind || '').toString().toLowerCase();
      return this.cfg.damageKinds.some(tag => k.includes(tag));
    },

    _dealDamage(e, halves, meta){
      const h = Math.max(1, Math.round(halves)); // mitades
      if (e===this.G.player){
        if (this.G.hurt) this.G.hurt(h, meta);
        else this.G.hearts = clamp((this.G.hearts||0) - h, 0, this.G.heartsMaxHalves||14);
      } else {
        // enemigos/npc básicos
        if (typeof e.takeDamage === 'function'){ e.takeDamage(h, meta); }
        else { e.dead = true; this.G.entities = this.G.entities.filter(x=>x!==e); }
        if (this.G.addScore) this.G.addScore(10);
      }
    },

    _affectEntitiesByExplosion(x,y,R,impulse,dmg){
      const ents = this.G.entities || [];
      for (const e of ents){
        if (!e || e.dead) continue;
        // no afecta paredes/puertas sólidas
        if (e.solid && !e.dynamic) continue;

        const cx = e.x + e.w/2, cy = e.y + e.h/2;
        const d  = Math.hypot(cx-x, cy-y);
        if (d > R + Math.max(e.w,e.h)*0.5) continue;

        // LOS: no atraviesa paredes
        if (!this._hasLineOfSight(x,y,cx,cy)) continue;

        // Impulso radial decreciente
        const nx = (cx-x) / (d||1);
        const ny = (cy-y) / (d||1);
        const k  = clamp(1 - d/R, 0, 1);
        const I  = impulse * k;

        if (window.Physics && Physics.applyImpulse){
          Physics.applyImpulse(e, nx*I*(e.pushable?1:0.5), ny*I*(e.pushable?1:0.5));
        } else {
          e.vx = (e.vx||0) + nx*I / (e.mass||100);
          e.vy = (e.vy||0) + ny*I / (e.mass||100);
        }

        // Daño
        if (this._isDamageable(e)){
          this._dealDamage(e, Math.round(dmg*k), { source:'explosion' });
        }
      }
      if (window.AudioAPI) AudioAPI.play?.('hit_boom', { volume:0.9 });
    },

    _hasLineOfSight(ax,ay,bx,by){
      // DDA sobre grid para paredes (1=pared)
      const T=this.TILE;
      const dx = bx-ax, dy = by-ay;
      const len = Math.hypot(dx,dy)||1;
      const ux=dx/len, uy=dy/len;

      let mapX = Math.floor(ax/T), mapY = Math.floor(ay/T);
      const stepX = (ux>0)?1:-1, stepY=(uy>0)?1:-1;

      const rayX = ax, rayY = ay;
      let sideDistX, sideDistY;
      const deltaDistX = (ux===0)?Infinity:Math.abs(T/ux);
      const deltaDistY = (uy===0)?Infinity:Math.abs(T/uy);

      if (ux>0) sideDistX = ((mapX+1)*T - rayX)/ux;
      else      sideDistX = (rayX - mapX*T)/-ux;
      if (uy>0) sideDistY = ((mapY+1)*T - rayY)/uy;
      else      sideDistY = (rayY - mapY*T)/-uy;

      let dist=0;
      const maxDist=len;
      for (let i=0;i<512;i++){
        if (sideDistX < sideDistY){ dist = sideDistX; sideDistX += deltaDistX; mapX += stepX; }
        else { dist = sideDistY; sideDistY += deltaDistY; mapY += stepY; }
        if (dist > maxDist) break;
        if (!inBounds(this.G,mapX,mapY)) break;
        if (this.G.map[mapY][mapX] === 1) return false; // pared bloquea
      }
      return true;
    }
  };

  // === utilidades ===
  function inBounds(G,tx,ty){ return tx>=0 && ty>=0 && tx<G.mapW && ty<G.mapH; }
  function forEachCircleTile(T,x,y,rTiles,fn){
    const rpx = rTiles*T, r2=rpx*rpx;
    const minx=Math.floor((x-rpx)/T), maxx=Math.floor((x+rpx)/T);
    const miny=Math.floor((y-rpx)/T), maxy=Math.floor((y+rpx)/T);
    for (let ty=miny; ty<=maxy; ty++){
      for (let tx=minx; tx<=maxx; tx++){
        const cx = tx*T + T/2, cy = ty*T + T/2;
        if ((cx-x)*(cx-x) + (cy-y)*(cy-y) <= r2) fn(tx,ty);
      }
    }
  }
  function randRange(a,b){ return a + Math.random()*(b-a); }
  function deepMerge(base, ext){
    const out = Array.isArray(base)? base.slice(): Object.assign({}, base);
    for (const k of Object.keys(ext)){
      const v = ext[k], bv = base[k];
      if (v && typeof v === 'object' && !Array.isArray(v)){
        out[k] = deepMerge(bv||{}, v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  window.HazardsAPI = HazardsAPI;
})();
