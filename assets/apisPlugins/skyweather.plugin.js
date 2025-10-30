/* skyweather.plugin.js  — v2
   Efectos SOLO FUERA DEL MAPA + overlays de cámara (niebla/gotas) según nivel.
   API:
     SkyFX.init({ canvas, getCamera, getMapAABB, worldToScreen })
     SkyFX.setLevel(level)           // 1=soleado, 2=noche+niebla, 3=tormenta
     SkyFX.update(dt)
     SkyFX.renderBackground(ctx)     // pintar CIELO y fondo fuera del mapa
     SkyFX.renderForeground(ctx)     // lluvia/niebla/relámpagos (fuera) + overlays cámara
     SkyFX.getAmbientLight()         // { darkness, tint } para sincronizar con Fog/Lights
*/
(function(){
  'use strict';

  const TAU = Math.PI*2;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;

  const DEF = {
    canvas:null,
    getCamera:null,                  // ()=>{x,y,zoom}
    getMapAABB:null,                 // ()=>{x,y,w,h} en mundo
    worldToScreen:null,              // (x,y)=>{x,y}
    timeScale:120,                   // seg juego por seg real
    // sonido opcional: usa tu AudioFX si existe
    onThunder: ()=>{ try{ AudioFX?.play('thunder'); }catch(e){} },
    onStartRain: ()=>{ try{ AudioFX?.loop('rain',true); }catch(e){} },
    onStopRain : ()=>{ try{ AudioFX?.stop('rain'); }catch(e){} },
  };

  const SkyFX = {
    _o:null,
    _hour:9,
    _t:0,
    _mode:'sunny', // 'sunny' | 'nightFog' | 'storm'
    // estrellas / nubes
    _stars:[],
    _clouds:[],
    // partículas “fuera” (lluvia)
    _rain:[],
    // overlays de cámara
    _fogPuffs:[],
    _drops:[],
    _flashA:0,

    init(opts){
      // opciones seguras
      this._o = Object.assign({}, opts||{});
      this.canvas = this._o.canvas || document.getElementById('gameCanvas');
      if (!this.canvas) return;

      // callbacks seguros
      this._o.getCamera       = this._o.getCamera       || (() => ({x:0,y:0,zoom:1}));
      this._o.getMapAABB      = this._o.getMapAABB      || (() => ({x:0,y:0,w:this.canvas.width, h:this.canvas.height}));
      this._o.worldToScreen   = this._o.worldToScreen   || ((x,y)=>({x,y}));
      this._o.onStartRain     = this._o.onStartRain     || (()=>{});
      this._o.onStopRain      = this._o.onStopRain      || (()=>{});
      this._o.onThunder       = this._o.onThunder       || (()=>{});
      this.getCamera          = this._o.getCamera;
      this.getMapAABB         = this._o.getMapAABB;
      this.worldToScreen      = this._o.worldToScreen;

      // estado
      this._t = 0;
      this._flashA = 0;
      this._mode = 'sunny'; // sunny | nightFog | storm
      this._hour = 12;

      // === NIEBLA (parches grandes, muy pocos, por toda la pantalla) ===
      const count = Math.max(8, Math.ceil((this.canvas.width + this.canvas.height) / 520));
      this._clouds = Array.from({length: count}, () => ({
        x: Math.random(),            // 0..1 → se multiplicará por W
        y: Math.random(),            // 0..1 → se multiplicará por H (toda la pantalla)
        s: 0.75 + Math.random()*0.9, // tamaño un poco menor
        v: 5 + Math.random()*8       // muy lenta
      }));

      // lluvia / niebla / gotas
      this._rain     = new Array(200).fill(0).map(()=>({x:0,y:-999,vx:0,vy:0,alive:false}));
      this._fogPuffs = new Array(28 ).fill(0).map(()=>this._mkFog());
      this._drops    = new Array(120).fill(0).map(()=>this._mkDrop());

      // nivel por defecto
      this.setLevel(1);
    },

    setLevel(level){
      this._mode = (level===3) ? 'storm' : (level===2 ? 'nightFog' : 'sunny');
      this._hour = (this._mode==='sunny') ? 9 : (this._mode==='nightFog' ? 23 : 21);

      // Callbacks seguros (aunque alguien pase true/false por error)
      const safe = (fn)=> (typeof fn === 'function') ? fn : ()=>{};
      const onStartRain = safe(this._o?.onStartRain);
      const onStopRain  = safe(this._o?.onStopRain);
      this._o.onStopRain();   // o this.onStopRain()
      this._o.onStartRain();  // o this.onStartRain()


      if (this._mode === 'storm') onStartRain();
      else onStopRain();

      // reinicia rayo si estabas en flash
      this._flashA = 0;
    },

    // --- helpers de coordenadas ---
    // cámara segura aunque no haya init
    _cam(){
      // cámara segura por si no hay init todavía
      try { 
        const c = this._o?.getCamera?.();
        return c ? c : { x:0, y:0, zoom:1 };
      } catch(e){
        return { x:0, y:0, zoom:1 };
      }
    },

    // world -> screen seguro (fallback suma centro del canvas)
    _w2s(x,y){
      try {
        if (this._o && this._o.worldToScreen) return this._o.worldToScreen(x,y);
      } catch(_){}
      const c=this._cam(), w=this.canvas?.width||0, h=this.canvas?.height||0;
      return { x:(x-c.x)*c.zoom + w*0.5, y:(y-c.y)*c.zoom + h*0.5 };
    },

    // AABB del mapa en coordenadas de pantalla (seguro sin init)
    _mapRectScr(){
      let m=null;
      if (!this._o || typeof this._o.getMapAABB !== 'function') return null;
      try { m = (this._o && this._o.getMapAABB) ? this._o.getMapAABB() : null; } catch(_){}
      if (!m) {
        const w=this.canvas?.width||0, h=this.canvas?.height||0;
        m = { x:0, y:0, w:w, h:h };  // fallback: cubre la pantalla
      }
      const a=this._w2s(m.x, m.y), b=this._w2s(m.x+m.w, m.y+m.h);
      return { x:a.x, y:a.y, w:b.x-a.x, h:b.y-a.y };
    },
    _outsideRects(W,H,r){
      if (!r) return [{x:0,y:0,w:W,h:H}];
      const arr=[];
      // arriba
      if (r.y>0) arr.push({x:0,y:0,w:W,h:r.y});
      // abajo
      const bh = H-(r.y+r.h);
      if (bh>0) arr.push({x:0,y:r.y+r.h,w:W,h:bh});
      // izq
      if (r.x>0) arr.push({x:0,y:r.y,w:r.x,h:r.h});
      // der
      const rw = W-(r.x+r.w);
      if (rw>0) arr.push({x:r.x+r.w,y:r.y,w:rw,h:r.h});
      return arr;
    },

    // --- iluminación global para sincronizar con Fog/Lights ---
    getAmbientLight(){
      let darkness=0, tint='rgba(0,0,0,0)';
      if (this._mode==='sunny'){
        const h=this._hour;
        // 6..19 día, amanecer/atardecer tibio
        if (h>=6 && h<=19){ darkness=0.12; }
        if (h<6){ darkness=0.65; tint='rgba(40,60,120,0.10)'; }
        if (h>19){ darkness=0.45; tint='rgba(255,140,60,0.08)'; }
      }
      if (this._mode==='nightFog'){
        darkness=0.70; tint='rgba(40,60,120,0.12)';
      }
      if (this._mode==='storm'){
        darkness=0.60; tint='rgba(40,60,120,0.08)';
      }
      return { darkness, tint };
    },

    update(dt){
      this._t += dt;
      this._hour = (this._hour + (dt*(this._mode==='sunny' ? (this._o.timeScale||60) : (this._o.timeScale||60)))/3600) % 24;

      // decaimiento del flash
      if (this._flashA > 0) this._flashA = Math.max(0, this._flashA - dt*2.2);

      // === MOVER NUBES normalizadas (0..1) ===
      const W = this.canvas ? this.canvas.width : 960;
      for (const c of (this._clouds||[])){
        c.x += (c.v / W) * dt;     // muy despacito
        if (c.x > 1.5) c.x -= 2;   // wrap: sale por la derecha → entra por la izq.
      }

      // Lluvia (solo en tormenta) – mantiene tu lógica actual
      if (this._mode==='storm'){
        const c = this._o.canvas || document.getElementById('gameCanvas');
        const w = c ? c.width  : 960;
        const h = c ? c.height : 540;

        let need = 180;
        let toSpawn = Math.floor(need*dt*1.2);
        for (let i=0;i<this._rain.length && toSpawn>0;i++){
          const p=this._rain[i]; if (p.alive) continue;
          p.alive=true; p.x=Math.random()*w; p.y=-12; p.vx=40; p.vy=360+Math.random()*180;
          toSpawn--;
        }
        for(const p of this._rain){
          if (!p.alive) continue;
          p.x += p.vx*dt; p.y += p.vy*dt;
          if (p.x>w+16 || p.y>h+16) p.alive=false;
        }
        if (Math.random()<0.003 && this._flashA<=0){
          this._flashA=1.0;
          try{ this._o.onThunder(); }catch(_){}
        }
      }

      // Niebla de cámara (nivel 2)
      if (this._mode==='nightFog'){
        const c = this._o.canvas || document.getElementById('gameCanvas');
        const w = c ? c.width  : 960;
        const h = c ? c.height : 540;
        for(const f of this._fogPuffs){
          f.x += Math.cos(f.seed*9)*6*dt;
          f.y += Math.sin(f.seed*11)*4*dt;
          f.a = 0.12+0.10*Math.sin(this._t*0.5 + f.seed*10);
          if (f.x<-f.r) f.x=w+f.r; if (f.x>w+f.r) f.x=-f.r;
          if (f.y<-f.r) f.y=h+f.r; if (f.y>h+f.r) f.y=-f.r;
        }
      }
    },

    // --- RENDER: solo fuera del mapa para cielo/lluvia/relámpagos ---
    renderBackground(ctx){
      const W = ctx.canvas.width, H = ctx.canvas.height;

      // Pintamos CIELO solo en las zonas "de fuera" (como ya tenías)
      const r = this._mapRectScr && this._mapRectScr();
      const outs = (this._outsideRects && this._outsideRects(W,H,r)) || [{x:0,y:0,w:W,h:H}];

      const paintSkyRect = (rx,ry,rw,rh)=>{
        let top='#5fa9ff', bot='#bfe1ff';
        if (this._mode==='nightFog' || this._mode==='storm'){ top='#0b1025'; bot='#111837'; }
        else { top='#76b6ff'; bot='#ffe2a3'; }
        const g = ctx.createLinearGradient(0,ry,0,ry+rh);
        g.addColorStop(0, top); g.addColorStop(1, bot);
        ctx.fillStyle=g; ctx.fillRect(rx,ry,rw,rh);
      };
      for(const o of outs) paintSkyRect(o.x,o.y,o.w,o.h);

      // === NIEBLA A PANTALLA COMPLETA (solo en nightFog/storm) ===
      if (this._mode !== 'sunny'){
        ctx.save();
        // más transparente; un poco más fuerte en tormenta
        ctx.globalAlpha = (this._mode==='storm') ? 0.15 : 0.10;
        for (const c of (this._clouds||[])){
          const x = (c.x % 1) * W;
          const y = (c.y % 1) * H;       // 💡 toda la altura (antes se limitaba arriba)
          // tres copias horizontales para cubrir el wrap
          this._cloud(ctx, x,     y, 120*c.s, 0, 0, W, H);
          this._cloud(ctx, x - W, y, 120*c.s, 0, 0, W, H);
          this._cloud(ctx, x + W, y, 120*c.s, 0, 0, W, H);
        }
        ctx.restore();
      }
    },

    renderForeground(ctx){
      const W=ctx.canvas.width, H=ctx.canvas.height;
      const r=this._mapRectScr();
      const outs=this._outsideRects(W,H,r);

      // (la niebla general se pinta en renderBackground; aquí no repetimos)

      // LLUVIA + RELÁMPAGO (nivel 3) — SIEMPRE SOBRE LA PANTALLA
      if (this._mode==='storm'){
        ctx.save();
        ctx.fillStyle = 'rgba(200,210,235,0.9)';
        for (const p of this._rain){
          if (!p.alive) continue;
          ctx.fillRect(p.x, p.y, 1.2, 10);
        }
        ctx.restore();

        // flash a pantalla completa (se queda igual)
        if (this._flashA > 0){
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = 0.85 * this._flashA;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.restore();
        }
      }

      // OVERLAYS DE CÁMARA (dentro del mapa):
      if (this._mode==='nightFog'){
        // Nieblas “en parches”
        ctx.save();
        ctx.globalCompositeOperation='lighter';
        for(const f of this._fogPuffs){
          const g = ctx.createRadialGradient(f.x,f.y,0,f.x,f.y,f.r);
          g.addColorStop(0, `rgba(220,220,230,${(f.a*0.6).toFixed(3)})`);
          g.addColorStop(1, `rgba(220,220,230,0)`);
          ctx.fillStyle=g;
          ctx.fillRect(f.x-f.r, f.y-f.r, f.r*2, f.r*2);
        }
        ctx.restore();
      }

    },

    // --- figuras ---
    _cloud(ctx, x,y,r, rx,ry,rw,rh){
      if (x+r<rx || x-r>rx+rw || y+r<ry || y-r>ry+rh) return;
      ctx.fillStyle='#fff';
      ctx.beginPath();
      ctx.arc(x, y, r*0.6, 0, TAU);
      ctx.arc(x+r*0.45, y+6, r*0.45, 0, TAU);
      ctx.arc(x-r*0.5,  y+8, r*0.5,  0, TAU);
      ctx.fill();
    },

    _mkFog(){
      const W=this._o.canvas?.width||800, H=this._o.canvas?.height||600;
      const r= 90+Math.random()*160;
      return { x:Math.random()*W, y:Math.random()*H, r, a:0.16, seed:Math.random(), t:0 };
    },
    _mkDrop(){
      const W=this._o.canvas?.width||800;
      return { x:Math.random()*W, y:-Math.random()*200, v:160+Math.random()*180, t:0, seed:Math.random() };
    }
  };

  window.SkyFX = SkyFX;
})();