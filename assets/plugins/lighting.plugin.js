/* filename: lighting.plugin.js
   Motor de luces (con oclusión por paredes) + FOW direccional
   - addLight/updateLight/removeLight/clear/render
   - Luces radiales o en CONO (coneDeg + dirRad o owner.facing/vx,vy)
   - Soporta broken (parpadeo), owner (sigue al dueño) y color 'dynamic_boss'
   - Fog direccional: delante claro/lejos, detrás oscuro/corto
*/
(function (W) {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v,a,b)=> v<a?a:(v>b?b:v);

  // ─────────────────────────────────────────────────────
  // LightingAPI
  // ─────────────────────────────────────────────────────
  const LIGHT_PRESETS = {
    broken: {
      palette: ['#ffd46b', '#ffdd85', '#ffc862'],
      radius: 150,
      intensityRange: [0.4, 0.9],
      flickerSpeed: 7.5,
      softness: 0.75
    }
  };

  const LightingAPI = {
    _c:null,_ctx:null,_game:null,_cont:null,_w:0,_h:0,
    _tile:32,_rays:96,_lights:new Map(),_flash:[],_nextId:1,_enabled:true,_lastT:null,

    // ─ Ambient global (compat con game.js) ─
    _ambient: 0,
    _ambientTint: 'rgba(0,0,0,0)',
    setGlobalAmbient(a){ this._ambient = Math.max(0, Math.min(1, a ?? 0)); },
    setAmbientTint(css){ this._ambientTint = css || 'rgba(0,0,0,0)'; },
    setEnabled(v){ this._enabled = !!v; if(!v) this._ctx?.clearRect(0,0,this._w,this._h); },

    // Recibe la lista [{x,y,angle,fov,dist,color,softness}, ...] desde el juego
    setFlashlights(list){
      this._flash = Array.isArray(list) ? list.slice() : [];
      this._enabled = true;
    },


    init({ gameCanvasId='gameCanvas', containerId='game-container', rays=96 } = {}){
      this._game = document.getElementById(gameCanvasId);
      this._cont = document.getElementById(containerId) || this._game?.parentElement || document.body;
      if (!this._game || !this._cont){ console.warn('[LightingAPI] Falta canvas'); return; }
      this._rays = Math.max(24, rays|0);
      this._tile = W.TILE_SIZE || W.TILE || 32;

      let c = document.getElementById('lightingCanvas');
      if (!c){ c=document.createElement('canvas'); c.id='lightingCanvas'; this._cont.appendChild(c); }
      this._c=c; this._ctx=c.getContext('2d');
      const s=c.style; s.position='absolute'; s.left='0'; s.top='0'; s.zIndex='5'; s.pointerEvents='none'; s.imageRendering='pixelated';
      this._resize(); W.addEventListener('resize', ()=>this._resize());
    },

    _resize(){
      if (!this._c || !this._game) return;
      if (this._c.width!==this._game.width || this._c.height!==this._game.height){
        this._c.width=this._game.width; this._c.height=this._game.height;
      }
      this._w=this._c.width; this._h=this._c.height;
    },

    _preset(kind){
      return kind && LIGHT_PRESETS[kind] ? { ...LIGHT_PRESETS[kind] } : null;
    },

    addLight({ x=0,y=0,radius=160,intensity=0.6,color='#fff2c0',type='room',broken=false,
               owner=null, coneDeg=0, dirRad=null, kind=null, innerRadius=null,
               softness=null }={}){
      const preset = this._preset(kind);
      const palette = preset?.palette;
      const finalColor = color || (Array.isArray(palette)
        ? palette[(Math.random()*palette.length)|0]
        : '#fff2c0');
      const presetRadius = preset?.radius != null ? preset.radius : radius;
      const presetSoft = preset?.softness;
      const range = preset?.intensityRange;
      const baseIntensity = clamp(
        (typeof intensity === 'number' ? intensity
          : (range ? (range[0] + range[1]) * 0.5 : 0.6)),
        0, 1
      );
      const flickerRange = Array.isArray(range) && range.length === 2
        ? [Math.min(range[0], range[1]), Math.max(range[0], range[1])]
        : (broken ? [0.4, 0.9] : null);
      const id=this._nextId++;
      this._lights.set(id,{
        id,
        x,y,
        radius: Math.max(8, presetRadius),
        baseIntensity,
        color: finalColor,
        type,
        broken: broken || kind === 'broken',
        owner,
        coneDeg: Math.max(0, coneDeg|0),
        dirRad,
        kind,
        innerRadius,
        softness: (typeof softness === 'number') ? clamp(softness, 0.05, 0.95)
          : (typeof presetSoft === 'number' ? clamp(presetSoft, 0.05, 0.95) : null),
        flickerRange,
        _flickerValue: null,
        _flickerTarget: null,
        _flickerTimer: 0,
        flickerSpeed: preset?.flickerSpeed || 6,
        flickerPhase:Math.random()*TAU, flickerFreq:4+Math.random()*4, _blinkT:0,_blinkOn:true
      });
      return id;
    },
    updateLight(id,props){
      const L=this._lights.get(id);
      if(!L || !props) return;
      const upd={...props};
      if ('intensity' in upd && typeof upd.intensity === 'number'){
        const ci = clamp(upd.intensity, 0, 1);
        upd.baseIntensity = ci;
        upd.intensity = ci;
        if (Array.isArray(L.flickerRange)){
          L._flickerValue = clamp(ci, L.flickerRange[0], L.flickerRange[1]);
          L._flickerTarget = L._flickerValue;
        }
      }
      if ('radius' in upd){ upd.radius = Math.max(8, Number(upd.radius)||8); }
      if ('softness' in upd && typeof upd.softness === 'number'){
        upd.softness = clamp(upd.softness, 0.05, 0.95);
      }
      Object.assign(L, upd);
    },
    removeLight(id){ this._lights.delete(id); },
    clear(){ this._lights.clear(); this._ctx?.clearRect(0,0,this._w,this._h); },

    render(camera, G){
          if(!this._c || !this._ctx){ return; }
          this._resize();
          const ctx=this._ctx, w=this._w, h=this._h;

          // 0) limpiar buffer siempre
          ctx.clearRect(0,0,w,h);

          // 1) si está apagado -> sal sin crashear
          if(!this._enabled){ return; }

          const now = (performance?.now?.() || Date.now()) * 0.001;
          const dt = this._lastT == null ? 1/60 : Math.min(0.2, Math.max(0, now - this._lastT));
          this._lastT = now;

          // 2) tinte ambiental opcional (día/noche/tormenta)
          if (this._ambient > 0){
            ctx.globalCompositeOperation='source-over';
            const tint = (typeof applyIntensity === 'function')
              ? applyIntensity(this._ambientTint || 'rgba(0,0,0,1)', this._ambient)
              : `rgba(0,0,0,${Math.max(0, Math.min(1, this._ambient))})`;
            ctx.fillStyle = tint;
            ctx.fillRect(0,0,w,h);
          }

          const hasStatic = this._lights.size > 0;
          const hasFlash  = Array.isArray(this._flash) && this._flash.length > 0;
          if (!hasStatic && !hasFlash){ return; }

          ctx.globalCompositeOperation='lighter';

          if (hasStatic){
            const t = now;
            for (const L of this._lights.values()){
              if(!L) continue;
              let dir = (typeof L.dirRad === 'number' && isFinite(L.dirRad)) ? L.dirRad : null;
              if (L.owner){
                try {
                  const o=L.owner;
                  if (o){
                    const cx = (o.x||0) + (o.w||0)/2 + (L.offsetX||0);
                    const cy = (o.y||0) + (o.h||0)/2 + (L.offsetY||0);
                    L.x=cx; L.y=cy;
                    let ownerDir = null;
                    if (typeof o.lookAngle === 'number') ownerDir = o.lookAngle;
                    else if (typeof o.facingAngle === 'number') ownerDir = o.facingAngle;
                    else if (typeof o.facing === 'string'){
                      const f=o.facing.toUpperCase();
                      ownerDir = (f==='E')?0:(f==='S')?Math.PI/2:(f==='W')?Math.PI:-Math.PI/2;
                    } else if (Math.abs(o.vx||0)+Math.abs(o.vy||0)>0.001){
                      ownerDir = Math.atan2(o.vy||0,o.vx||0);
                    }
                    if (ownerDir != null && isFinite(ownerDir)) dir = ownerDir;
                  }
                } catch(_){}
              }

              const px=(L.x - camera.x)*camera.zoom + w/2;
              const py=(L.y - camera.y)*camera.zoom + h/2;
              if (!isFinite(px) || !isFinite(py)) continue;

              const worldRadius = Math.max(8, (L.radius||160));
              const radius = worldRadius * camera.zoom;
              const baseSoft = (typeof L.softness === 'number') ? L.softness : 0.72;
              const softness = clamp(baseSoft, 0.05, 0.95);
              const worldInner = (L.innerRadius != null)
                ? Math.max(4, L.innerRadius)
                : Math.max(4, worldRadius * (1 - softness));
              const innerRad = Math.min(radius * 0.98, Math.max(2, worldInner * camera.zoom));

              let intensity = (typeof L.intensity === 'number') ? clamp(L.intensity,0,1)
                : (typeof L.baseIntensity === 'number' ? clamp(L.baseIntensity,0,1) : 0.6);

              if (Array.isArray(L.flickerRange)){
                const [lo,hi] = L.flickerRange;
                if (L._flickerValue == null){
                  const init = clamp(intensity, lo, hi);
                  L._flickerValue = init;
                  L._flickerTarget = init;
                  L._flickerTimer = 0;
                }
                L._flickerTimer -= dt;
                if (L._flickerTimer <= 0){
                  L._flickerTimer = 0.08 + Math.random()*0.22;
                  L._flickerTarget = lo + Math.random()*(Math.max(hi - lo, 0.001));
                }
                const speed = Math.max(0.5, L.flickerSpeed || 6);
                const lerp = 1 - Math.exp(-speed*dt);
                L._flickerValue = L._flickerValue + (L._flickerTarget - L._flickerValue)*lerp;
                intensity = clamp(L._flickerValue, lo, hi);
              }

              const baseColor = resolveColor(L, intensity, t);

              ctx.save();
              ctx.translate(px,py);

              if (L.coneDeg>0){
                const dist = Math.max(radius, 24);
                const fov = Math.max(0.05, Math.min(Math.PI, (L.coneDeg||0)*Math.PI/180));
                const gx = dist * 0.70;
                const ry = dist * 0.42;
                const g = ctx.createRadialGradient(gx,0,innerRad, gx,0, dist);
                g.addColorStop(0, applyIntensity(baseColor, intensity));
                g.addColorStop(1, applyIntensity(baseColor, 0));
                ctx.fillStyle = g;

                const ang = (typeof dir === 'number' && isFinite(dir)) ? dir : 0;
                ctx.rotate(ang + Math.PI);

                ctx.beginPath();
                const a0 = -fov*0.5, a1 = fov*0.5;
                ctx.moveTo(0,0);
                ctx.ellipse(gx, 0, dist, ry, 0, a0, a1);
                ctx.closePath();
                ctx.fill();
              } else {
                const g = ctx.createRadialGradient(0,0,innerRad, 0,0, radius);
                g.addColorStop(0, applyIntensity(baseColor, intensity));
                g.addColorStop(1, applyIntensity(baseColor, 0));
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(0,0,radius,0,TAU);
                ctx.fill();
              }

              ctx.restore();
            }
          }

          if (hasFlash){
            for (const L of this._flash){
              if(!L) continue;
              const px=(L.x - camera.x)*camera.zoom + w/2;
              const py=(L.y - camera.y)*camera.zoom + h/2;
              const ang= +L.angle || 0;
              const dist = Math.max(24, (L.dist||600)) * camera.zoom;
              const fov  = Math.max(0.05, Math.min(Math.PI, L.fov || Math.PI*0.5));
              const soft = Math.max(0.05, Math.min(0.95, L.softness || 0.7));

              ctx.save();
              ctx.translate(px,py);
              ctx.rotate(ang + Math.PI);

              const rx = dist * 1.00, ry = dist * 0.42;
              const gx = rx * 0.70;
              const inner = Math.max(6, rx*(1-soft));
              const intensity = (typeof L.intensity === 'number') ? clamp(L.intensity, 0, 1) : 0.6;
              const g = ctx.createRadialGradient(gx,0,inner, gx,0, rx);
              const baseColor = L.color || 'rgba(255,255,200,1)';
              g.addColorStop(0, applyIntensity(baseColor, intensity));
              g.addColorStop(1, applyIntensity(baseColor, 0));
              ctx.fillStyle = g;

              // Cono: elipse recortada por FOV
              ctx.beginPath();
              const a0 = -fov*0.5, a1 = fov*0.5;
              ctx.moveTo(0,0);
              ctx.ellipse(gx, 0, rx, ry, 0, a0, a1);
              ctx.closePath();
              ctx.fill();

              ctx.restore();
            }
          }

          ctx.globalCompositeOperation='source-over';
        },

    // rays en [a0..a1]
    _rayFan(px,py,r,G,N,a0,a1){
      const pts=[]; const span=(a1-a0); const step=span/N;
      for(let i=0;i<=N;i++){
        const ang=a0 + i*step; const dx=Math.cos(ang), dy=Math.sin(ang);
        pts.push(this._rayDDA(px,py,dx,dy,r,G));
      }
      return pts;
    },
    _rayDDA(px,py,dx,dy,maxDist,G){
      const TILE=this._tile; let mapX=Math.floor(px/TILE), mapY=Math.floor(py/TILE);
      const stepX=(dx>0)?1:-1, stepY=(dy>0)?1:-1;
      const inv=1/Math.max(1e-6,Math.hypot(dx,dy)); dx*=inv; dy*=inv;
      let sideX = (dx>0)?(((mapX+1)*TILE-px)/dx):((px-mapX*TILE)/-dx);
      let sideY = (dy>0)?(((mapY+1)*TILE-py)/dy):((py-mapY*TILE)/-dy);
      const deltaX=(dx===0)?1e9:Math.abs(TILE/dx), deltaY=(dy===0)?1e9:Math.abs(TILE/dy);
      let dist=0, wx=px+dx*maxDist, wy=py+dy*maxDist, hit=false;

      for(let iter=0; iter<512; iter++){
        if (sideX < sideY){ dist=sideX; sideX+=deltaX; mapX+=stepX; }
        else              { dist=sideY; sideY+=deltaY; mapY+=stepY; }
        if (dist>maxDist) break;
        if (mapY<0||mapX<0||mapY>=G.map.length||mapX>=G.map[0].length) break;
        if (G.map[mapY][mapX]===1){ hit=true; break; }
      }
      if (hit){ const eps=0.8; wx=px+dx*Math.max(0,dist-eps); wy=py+dy*Math.max(0,dist-eps); }
      return [wx,wy];
    }
  };

  // helpers color
  function withAlpha(css,a){ if (/^rgba?\(/i.test(css)){ const n=css.match(/[\d.]+/g)||[255,255,255,1]; return `rgba(${+n[0]||255},${+n[1]||255},${+n[2]||255},${clamp(a,0,1)})`; }
    const h=String(css).replace('#',''); const c=(h.length===3)?[h[0]+h[0],h[1]+h[1],h[2]+h[2]]:[h.slice(0,2),h.slice(2,4),h.slice(4,6)];
    const r=parseInt(c[0],16)||255,g=parseInt(c[1],16)||240,b=parseInt(c[2],16)||200; return `rgba(${r},${g},${b},${clamp(a,0,1)})`; }
  function applyIntensity(css,a){ return withAlpha(css, clamp(a,0,1)); }
  function bossColor(t,I){ const k=(Math.sin(t*2.2)+1)*0.5; const r=Math.round(120+135*k), b=Math.round(120+135*(1-k)); return `rgba(${r},60,${b},${clamp(I,0,1)})`; }
  function resolveColor(L, intensity, t){
    const col = L?.color;
    if (typeof col === 'function'){
      try { const v = col(t, intensity); if (v) return v; }
      catch(_){}
    }
    if (String(col).toLowerCase() === 'dynamic_boss'){
      return bossColor(t, intensity);
    }
    return col || '#fff2c0';
  }

  W.LightingAPI = LightingAPI;

  const Lighting = {
    presets: LIGHT_PRESETS,
    addLight(x, y, opts={}){
      if (typeof x === 'object' && x !== null){
        return W.LightingAPI?.addLight?.(x) ?? null;
      }
      const payload = { ...opts, x, y };
      return W.LightingAPI?.addLight?.(payload) ?? null;
    },
    updateLight(id, props){
      return W.LightingAPI?.updateLight?.(id, props);
    },
    removeLight(id){
      return W.LightingAPI?.removeLight?.(id);
    }
  };
  W.Lighting = Lighting;

  // ─────────────────────────────────────────────────────
  // FogAPI (niebla direccional negra + linterna elíptica)
  // ─────────────────────────────────────────────────────
  const FogAPI = {
    _c:null,_ctx:null,_target:null,_w:0,_h:0,_enabled:true,
    // radios base en PIXELES DE MUNDO (se escalan con el zoom de la cámara)
    _front: 900,   // delante (muy largo)
    _side:  360,   // laterales (ancho)
    _back:  120,   // detrás (corto)
    _opacity: 1.0, // **NEGRO SÓLIDO** fuera de la visión
    _soft:   0.70, // transición (0 = borde duro, 1 = muy suave)

    // Permite que el ciclo día/noche module la visibilidad (0 = día, 1 = noche)
    setDarkness(d){
      const v = Math.max(0, Math.min(1, d ?? 0));
      const front = Math.round(1100 - 700*v); // 1100 (día) → 400 (noche)
      const side  = Math.round( 420 - 200*v); //  420 → 220
      const back  = Math.round( 220 - 120*v); //  220 → 100
      this.setRadii({ front, side, back });
    },

    init({ fogCanvasId='fogCanvas', gameCanvasId='gameCanvas' }={}){
      this._target = document.getElementById(gameCanvasId);
      let c = document.getElementById(fogCanvasId);
      if (!c){ c=document.createElement('canvas'); c.id=fogCanvasId; this._target?.parentElement?.appendChild(c); }
      this._c=c; this._ctx=c.getContext('2d');
      const s=c.style; s.position='absolute'; s.left='0'; s.top='0'; s.zIndex='6'; s.pointerEvents='none'; s.imageRendering='pixelated';
      this._resize(); window.addEventListener('resize', ()=>this._resize());
    },
    _resize(){
      if (!this._c || !this._target) return;
      if (this._c.width!==this._target.width || this._c.height!==this._target.height){
        this._c.width=this._target.width; this._c.height=this._target.height;
      }
      this._w=this._c.width; this._h=this._c.height;
    },
    setEnabled(v){ this._enabled=!!v; if(!v) this._ctx?.clearRect(0,0,this._w,this._h); },
    setRadii({front,side,back}){ if(front) this._front=front; if(side) this._side=side; if(back) this._back=back; },
    setSoftness(s){ this._soft = Math.max(0.05, Math.min(0.95, s||0.70)); },

    // === NUEVO: aceptar ángulo continuo desde el jugador ===
    setFacingAngle(rad){ if (typeof rad === 'number' && isFinite(rad)) this._angOverride = rad; },

    // === NUEVO: visión por tiles según el héroe (Enrique/Roberto/Francesco) ===
    setPlayerVisionTiles(v){
      const base = Math.max(0.5, Math.min(2.0, Number(v)/4 || 1)); // 4 tiles = 1.0 (medio)
      this.setRadii({
        front: Math.round(900*base),
        side:  Math.round(360*base),
        back:  Math.round(120*base)
      });
    },
    render(camera, G){
      if(!this._c||!this._ctx){ return; }
      this._resize();
      const ctx=this._ctx, w=this._w, h=this._h;
      ctx.clearRect(0,0,w,h);
      if(!this._enabled || !G?.player){ return; }

      // Centro del jugador en PANTALLA
      const px=(G.player.x+G.player.w/2 - camera.x)*camera.zoom + w/2;
      const py=(G.player.y+G.player.h/2 - camera.y)*camera.zoom + h/2;

      // Dirección de la mirada: 1º override continuo, 2º lookAngle, 3º facing/velocidad
      let ang = (typeof this._angOverride === 'number') ? this._angOverride
               : (typeof G.player.lookAngle === 'number') ? G.player.lookAngle
               : null;
      if (ang == null || !isFinite(ang)) {
        if (typeof G.player.facing === 'string'){
          const f=G.player.facing;
          ang = (f==='E')?0 : (f==='S')?Math.PI/2 : (f==='W')?Math.PI : -Math.PI/2;
        } else if (Math.abs(G.player.vx||0)+Math.abs(G.player.vy||0)>0.01){
          ang = Math.atan2(G.player.vy||0, G.player.vx||0);
        } else {
          ang = 0;
        }
      }

      // Capa base: NEGRO sólido (tapamos TODO)
      ctx.globalCompositeOperation='source-over';
      ctx.fillStyle = `rgba(0,0,0,${this._opacity})`;
      ctx.fillRect(0,0,w,h);

      // Agujero de visión: “destino-fuera” recorta del negro.
      const Rf=this._front*camera.zoom, Rs=this._side*camera.zoom, Rb=this._back*camera.zoom;

      ctx.save();
      ctx.translate(px,py);
      ctx.rotate(ang + Math.PI);   // ⬅️ invierte 180º: lóbulo grande VA DELANTE
      ctx.globalCompositeOperation='destination-out';

      // 1) Zona DELANTERA: elipse MUY alargada hacia delante y ancha en laterales
      const gF = ctx.createRadialGradient(Rf*0.55, 0, Math.max(8, Rf*(1-this._soft)), Rf*0.55, 0, Rf*1.05);
      gF.addColorStop(0,'rgba(0,0,0,1)');   // centro nítido
      gF.addColorStop(1,'rgba(0,0,0,0)');   // se desvanece
      ctx.fillStyle = gF;
      ctx.beginPath();
      // rx MUY grande delante (1.45) y ry ancho (0.90)
      ctx.ellipse(Rf*0.55, 0, Rf*1.45, Rs*0.90, 0, 0, Math.PI*2);
      ctx.fill();

      ctx.restore();

      ctx.globalCompositeOperation='source-over';
    }
  };

  window.FogAPI = FogAPI;

})(this);