// assets/entities/rats.entities.js
// Rata hiper-lenta (“modo caracol”), sin linterna, IA simple y daño por nivel.

;(function () {
  'use strict';

  const W = window;
  const G = (W.G ||= {});
  const ENT = (W.ENT ||= {});
  ENT.RAT = ENT.RAT || 6;

  const TILE = W.TILE_SIZE || W.TILE || 32;

  // --- Balance por nivel ---
  // Velocidades de movimiento (px/s): muy lentas a propósito
  const SPEED_BY_TIER = { 1: 0.5, 2: 0.8, 3: 1.2 };
  // Radio de visión (px) para persecución en Tier 3
  const SEE_BY_TIER   = { 1: 80,  2: 120, 3: 200 };
  // Daño en “unidades” (1 unidad = 1/2 corazón)
  const BITE_BY_TIER  = { 1: 1,   2: 2,   3: 3   };

  // IMPORTANTE:
  // El motor usa e.maxSpeed para calcular el “CLAMP_WARP”.
  // Le damos un valor ALTO sólo para ese cálculo (no para mover la rata),
  // y usamos SPEED_BY_TIER para su velocidad real.
  const MAXSPEED_FOR_CLAMP = 600; // evita logs CLAMP_WARP aunque haya pequeños snaps

  // ---------- Utilidades ----------
  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const len   = (x,y)=>Math.hypot(x,y)||1;
  const aabbOverlap = (a,b)=>(
    Math.abs((a.x) - (b.x)) < (a.w + b.w)*0.5 &&
    Math.abs((a.y) - (b.y)) < (a.h + b.h)*0.5
  );

  function pickRatSpriteKey(){
    try {
      if (W.Sprites?.has) {
        if (W.Sprites.has('raton')) return 'raton';
        if (W.Sprites.has('rat'))   return 'rat';
      }
    } catch(_){}
    return 'raton'; // fallback
  }

  function ensureOnLists(e){
    (G.entities ||= []).includes(e) || G.entities.push(e);
    (G.enemies  ||= []).includes(e) || G.enemies.push(e);
    (G.movers   ||= []).includes(e) || G.movers.push(e);
  }

  function tierOf(opts){
    const t = (opts && (opts.tier|0)) || (G.level|0) || 1;
    return clamp(t, 1, 3);
  }

  function createRat(x, y, opts={}){
    const tier = tierOf(opts);
    const spriteKey = pickRatSpriteKey();

    const e = {
      id: 'rat_' + Math.random().toString(36).slice(2,8),
      kind: ENT.RAT, kindName: 'rat', role: 'enemy',
      x: x|0, y: y|0, w: TILE*0.55, h: TILE*0.55,

      // Físicas / movimiento (el motor mueve con vx/vy)
      vx: 0, vy: 0,
      solid: true,       // NO atravesar paredes
      pushable: false,       // ← no se empuja, no se cuela
      static: false,     // deja que el motor lo desplace
      bouncy: false,

      // Para el “CLAMP_WARP” del motor (sólo para ese cálculo)
      maxSpeed: MAXSPEED_FOR_CLAMP,

      // Luces: la rata NO tiene linterna
      noLight: true,
      hasLight: false,

      // IA
      state: 'FORAGE',     // FORAGE (deambular) | CHASE (persecución en tier 3)
      thinkCd: 0,          // decide rumbo cada cierto tiempo
      biteCd: 0,           // cooldown para knockback

      // Stats reales
      moveSpeed: SPEED_BY_TIER[tier],
      seeRadius: SEE_BY_TIER[tier],
      biteUnits: BITE_BY_TIER[tier],
      canChase:  (tier === 3),

      touchDamage: 0.5,
      touchCooldown: 1.0,

      // Sprite
      spriteKey,

      update(dt){
        if (!dt || !isFinite(dt)) return;

        if (this.thinkCd > 0) this.thinkCd -= dt;
        if (this.biteCd  > 0) this.biteCd  -= dt;

        const P = G.player || G.hero;
        let dirX = 0, dirY = 0;

        // ¿Vemos al jugador?
        let sees = false;
        if (P){
          const dx = (P.x + P.w*0.5) - (this.x + this.w*0.5);
          const dy = (P.y + P.h*0.5) - (this.y + this.h*0.5);
          const d  = Math.hypot(dx,dy);
          if (d <= this.seeRadius){ sees = true; dirX = dx/(d||1); dirY = dy/(d||1); }
        }

        if (this.canChase && sees) {
          this.state = 'CHASE';
        } else if (this.state === 'CHASE' && (!this.canChase || !sees)) {
          this.state = 'FORAGE';
        }

        if (this.state !== 'CHASE') {
          // Deambular MUY lento: cambiar rumbo cada ~1.5–3.5 s
          if (this.thinkCd <= 0){
            this.thinkCd = 1.5 + Math.random()*2.0;
            const ang = Math.random()*Math.PI*2;
            this._dx = Math.cos(ang);
            this._dy = Math.sin(ang);
          }
          dirX = this._dx || 0.0001;
          dirY = this._dy || 0.0001;
        }

        // Velocidad real ultra-baja
        this.vx = dirX * this.moveSpeed;
        this.vy = dirY * this.moveSpeed;

        if (P && aabbOverlap(this, P)) {
          if (this.biteCd <= 0) {
            this.biteCd = 0.50;
            try {
              const px = (P.x + P.w*0.5) - (this.x + this.w*0.5);
              const py = (P.y + P.h*0.5) - (this.y + this.h*0.5);
              const d = len(px,py);
              const K = 30;
              P.vx = (P.vx||0) + (px/d)*K;
              P.vy = (P.vy||0) + (py/d)*K;
            } catch(_){}
          }
        }

        // Por seguridad, nunca salir del mapa (además de la colisión de Physics)
        const WPIX = (G.mapW||0) * TILE, HPIX = (G.mapH||0) * TILE;
        if (WPIX && HPIX){
          this.x = clamp(this.x, this.w*0.5, WPIX - this.w*0.5);
          this.y = clamp(this.y, this.h*0.5, HPIX - this.h*0.5);
        }
      },

      draw(ctx){
        if (W.Sprites?.draw) {
          W.Sprites.draw(ctx, this.spriteKey, this.x, this.y, { w:this.w, h:this.h });
        } else {
          // Fallback visible
          ctx.fillStyle = '#a0836f';
          ctx.fillRect(this.x - this.w/2, this.y - this.h/2, this.w, this.h);
        }
      }
    };

    ensureOnLists(e);
    try { W.Physics?.registerEntity?.(e); } catch(_){}
    if (window.PuppetAPI){
      const scale = (e.h || TILE) / 28;
      PuppetAPI.attach(e, { rig: 'rat', z: 5, scale });
    }
    return e;
  }

  // API pública para el juego
  (W.Entities ||= {}).Rat = (W.Entities.Rat || {});
  W.Entities.Rat.spawn = function (x, y, props) { return createRat(x, y, props || {}); };

  // API legacy / compat (usada por placement.api.js)
  W.RatsAPI = {
    spawn(x, y, props){ return createRat(x, y, props || {}); },
    spawnAtTiles(tx, ty, props){
      const t = TILE; return createRat(tx*t + t*0.5, ty*t + t*0.5, props || {});
    },
    registerSpawn(tx, ty, p){ return true; }
  };

})();