/* ============================================================================
 *  Il Divo - AudioAPI (SFX)
 *  FX con Web Audio + fallback HTMLAudio. Pan/atenuación por distancia,
 *  variación de pitch, throttling y loops con handles.
 *  Requiere: nada. Opcional: MusicAPI para música (ya lo tienes).
 * ========================================================================== */
(function (global) {
  const hasWA = !!(window.AudioContext || window.webkitAudioContext);

  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const nowMs = ()=>performance.now();

  const DEFAULT_URLS = {
    // --- UI
    ui_click: 'assets/audio/ui_click.ogg',
    ui_back:  'assets/audio/ui_back.ogg',

    // --- Gameplay genérico
    pill_pick:   'assets/audio/pill_pick.ogg',
    deliver_ok:  'assets/audio/deliver_ok.ogg',
    hurt:        'assets/audio/hurt.ogg',
    heart_down:  'assets/audio/heart_down.ogg',
    heart_up:    'assets/audio/heart_up.ogg',
    coin:        'assets/audio/coin.ogg',

    // --- Clima / ambiente
    rain_loop: 'assets/audio/rain_loop.ogg',
    thunder:   'assets/audio/thunder.ogg',


    // --- Carros / físicas
    push_start:  'assets/audio/push_start.ogg',
    push_slide:  'assets/audio/push_slide_loop.ogg', // loop suave
    cart_hit:    'assets/audio/cart_hit.ogg',
    cart_kill:   'assets/audio/cart_crush.ogg',
    wall_bounce: 'assets/audio/wall_bounce.ogg',

    // --- Puertas
    door_open:   'assets/audio/door_open.ogg',
    boss_door:   'assets/audio/boss_door.ogg',

    // --- Enemigos
    mosquito_buzz: 'assets/audio/mosquito_loop.ogg', // loop
    mosquito_die:  'assets/audio/mosquito_die.ogg',
    rat_squeak:    'assets/audio/rat.ogg',

    // --- Alarmas / ambiente
    alarm_loop:  'assets/audio/alarm_loop.ogg',      // urgencias (amb)
  };

  const AudioAPI = {
    ctx: null,
    master: null,
    buses: {},            // {master,sfx,ui,ambient,env}
    vol:   { master: 1, sfx: 0.95, ui: 1, ambient: 0.9, env: 0.9 },
    muted: false,
    buffers: {},          // WebAudio buffers
    urls: {},             // key -> url
    html: {},             // fallback HTMLAudio (base)
    instances: new Set(), // playing nodes (para limpieza)
    throttles: {},        // key -> lastMs
    lastListener: { x:0, y:0 },
    worldToScreen: null,  // opcional: (x,y)=>{x,y} si usas cámara
    maxDistance: 520,     // atenuación total a partir de aquí (px mundo)
    minDistance: 48,      // volumen máximo dentro de este radio
    pitchVar:    0.05,    // variación aleatoria de rate
    resumeBound: false,

    /* ------------------------------- INIT ---------------------------------- */
    init(opts={}) {
      this.urls = Object.assign({}, DEFAULT_URLS, opts.urls||{});
      this.vol  = Object.assign(this.vol, opts.vol||{});
      this.maxDistance = opts.maxDistance ?? this.maxDistance;
      this.minDistance = opts.minDistance ?? this.minDistance;
      this.pitchVar    = opts.pitchVar    ?? this.pitchVar;
      this.muted       = !!opts.muted;

      if (hasWA) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this._mkBus('sfx'); this._mkBus('ui'); this._mkBus('ambient'); this._mkBus('env');
        this._applyVols(true);
        this._bindResume();
      } else {
        console.warn('[AudioAPI] WebAudio no disponible. Fallback HTMLAudio');
      }

      if (opts.preload !== false) this.preloadAll().catch(()=>{});
    },

    _bindResume() {
      if (this.resumeBound) return;
      const resume = () => { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); };
      window.addEventListener('pointerdown', resume, { once:true, passive:true });
      window.addEventListener('keydown', resume, { once:true, passive:true });
      this.resumeBound = true;
    },

    _mkBus(name) {
      const g = this.ctx.createGain();
      g.gain.value = this.vol[name] ?? 1;
      g.connect(this.master);
      this.buses[name] = g;
    },

    _applyVols(fast=false) {
      if (!hasWA) return;
      const t = this.ctx.currentTime + (fast?0.05:0.2);
      const mv = this.muted ? 0 : clamp(this.vol.master,0,1);
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(mv, t);
      for (const k of ['sfx','ui','ambient','env']) {
        if (!this.buses[k]) continue;
        this.buses[k].gain.setValueAtTime(this.vol[k], t);
      }
    },

    setMuted(m){ this.muted = !!m; this._applyVols(); },
    setVolume(group, v){ if(group==='master') this.vol.master=v; else this.vol[group]=v; this._applyVols(); },

    setListener(x,y){ this.lastListener.x = x; this.lastListener.y = y; },
    setWorldToScreen(fn){ this.worldToScreen = fn; },

    /* ---------------------------- LOADING ---------------------------------- */
    async preloadAll() {
      const keys = Object.keys(this.urls);
      await Promise.all(keys.map(k => this._ensureLoaded(k)));
    },

    async _ensureLoaded(key) {
      if (this.buffers[key] || this.html[key]) return;
      const url = this.urls[key]; if (!url) return;
      if (hasWA) {
        const ab = await fetch(url).then(r=>r.arrayBuffer());
        const buf = await this.ctx.decodeAudioData(ab);
        this.buffers[key] = buf;
      } else {
        const a = new Audio(url); a.preload='auto'; a.load(); this.html[key]=a;
      }
    },

    register(map){ Object.assign(this.urls, map||{}); },

    /* ----------------------------- PLAYERS --------------------------------- */
    /**
     * Reproduce un sonido.
     * opts: { group='sfx', volume=1, rate=1, var=true, pan=0, loop=false,
     *         throttleMs=0, tag, at:{x,y}, falloff, detune }
     */
    async play(key, opts={}) {
      const { group='sfx', volume=1, rate=1, loop=false, pan=0,
              throttleMs=0, tag=null, at=null, falloff=null, detune=0, varPitch=true } = opts;

      // throttling
      if (throttleMs>0) {
        const last = this.throttles[key]||0;
        if (nowMs()-last < throttleMs) return null;
        this.throttles[key]=nowMs();
      }

      await this._ensureLoaded(key);

      if (hasWA) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.buffers[key];
        src.loop = !!loop;

        const gain = this.ctx.createGain();
        const panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;

        // volumen base por grupo + individual
        const baseBus = this.buses[group] || this.buses.sfx;
        const baseVol = (this.muted ? 0 : this.vol[group] ?? 1);
        const v = clamp(volume * baseVol, 0, 2);

        // random pitch
        const rVar = varPitch ? (1 + (Math.random()*2-1)*this.pitchVar) : 1;
        src.playbackRate.value = clamp(rate * rVar, 0.25, 4);

        // pan/atenuación por distancia si se da posición
        let finalGain = v;
        let finalPan = pan;
        if (at) {
          const L = this.lastListener;
          const dx = at.x - L.x, dy = at.y - L.y;
          const d  = Math.hypot(dx,dy);
          const f  = falloff ?? this.maxDistance;
          const min= this.minDistance;
          finalGain *= (d<=min) ? 1 : clamp(1 - (d-min)/(f-min), 0, 1);

          // pan rudimentario (izq/dcha relativo)
          finalPan = clamp(dx / (f*0.75), -1, 1);
        }

        if (panner) {
          panner.pan.value = finalPan;
          src.connect(panner); panner.connect(gain);
        } else {
          src.connect(gain);
        }
        gain.gain.value = finalGain;
        gain.connect(baseBus);

        const node = { src, gain, panner, group, key, tag, loop, stop: ()=>{ try{src.stop();}catch(_){} } };
        src.onended = ()=> this.instances.delete(node);
        src.start();
        this.instances.add(node);
        return node;

      } else {
        // Fallback
        const aBase = this.html[key]; if (!aBase) return null;
        const a = aBase.cloneNode(true);
        a.loop = !!loop;
        a.volume = this.muted ? 0 : clamp(volume * (this.vol[group] ?? 1), 0, 1);
        a.playbackRate = clamp(rate, 0.25, 4);
        a.play().catch(()=>{});
        const node = { html:a, key, group, tag, loop, stop:()=>{ a.pause(); a.currentTime=0; } };
        this.instances.add(node);
        a.onended = ()=> this.instances.delete(node);
        return node;
      }
    },

    /** Reproduce un loop asociado a un objeto y devuelve un handle con update/stop. */
    async playLoopAttached(key, getPosFn, opts={}) {
      const handle = { node:null, alive:true,
        async start(){ this.node = await AudioAPI.play(key, Object.assign({}, opts, { loop:true, at:getPosFn() })); },
        update(){ if (!this.alive||!this.node) return; const p=getPosFn(); if (!p||!AudioAPI.ctx) return;
          // actualizar atenuación/pan
          const L=AudioAPI.lastListener, dx=p.x-L.x, dy=p.y-L.y, d=Math.hypot(dx,dy),
                f=opts.falloff??AudioAPI.maxDistance, min=AudioAPI.minDistance;
          const v = (d<=min)?1:clamp(1-(d-min)/(f-min),0,1);
          if (this.node.gain) this.node.gain.gain.setTargetAtTime(v*(opts.volume??1), AudioAPI.ctx.currentTime, 0.05);
          if (this.node.panner) this.node.panner.pan.setTargetAtTime(clamp(dx/(f*0.75),-1,1), AudioAPI.ctx.currentTime, 0.05);
        },
        stop(){ this.alive=false; if(this.node) this.node.stop(); }
      };
      await handle.start();
      return handle;
    },

    stopByTag(tag){
      for (const n of [...this.instances]) if (n.tag===tag) { try{n.stop();}catch(_){} this.instances.delete(n); }
    },
    stopAll(){ for (const n of [...this.instances]) { try{n.stop();}catch(_){} } this.instances.clear(); }
  };

  // --- Adaptador simple para plugins que esperan AudioFX ---
  window.AudioFX = {
    _rainTag: 'rain',
    loop(name, on=true){
      if (name==='rain'){
        if (on){
          AudioAPI.play('rain_loop', { group:'env', loop:true, tag:this._rainTag, volume:0.75 });
        } else {
          AudioAPI.stopByTag(this._rainTag);
        }
      }
    },
    play(name){
      if (name==='thunder'){
        // relámpago puntual, leve variación de pitch y paneo
        AudioAPI.play('thunder', {
          group:'env',
          volume: 0.9,
          varPitch: true,
          pan: (Math.random()*2-1)*0.6,
          throttleMs: 300   // evita spam
        });
      }
    },
    stop(name){
      if (name==='rain') AudioAPI.stopByTag(this._rainTag);
    }
  };
  global.AudioAPI = AudioAPI;
})(window);