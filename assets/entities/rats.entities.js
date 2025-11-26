// filename: assets/entities/rats.entities.js
// Rata "modo caracol": IA + daño + dibujo integrados en la entidad.
// No mueve x/y directamente. SOLO fija vx/vy y deja a Physics/updateEntities el movimiento.
// Evita atravesar paredes, no usa linterna, y muerde con cooldown corto en cada contacto.
(function (W) {
  'use strict';
  const G   = (W.G ||= {});
  const ENT = (W.ENT ||= {});
  if (typeof ENT.RAT !== 'number') ENT.RAT = 6;
  const TILE = (W.TILE_SIZE || W.TILE || 32);

  // ===== Utiles =====
  const DBG = !!(W.DEBUG_RATS || W.DEBUG_FORCE_ASCII); // activa logs solo en debug
  function aabbOverlap(a,b){
    return Math.abs((a.x + (a.w||0)*0.5) - (b.x + (b.w||0)*0.5)) < ((a.w||0)+(b.w||0))*0.5 &&
           Math.abs((a.y + (a.h||0)*0.5) - (b.y + (b.h||0)*0.5)) < ((a.h||0)+(b.h||0))*0.5;
  }

  // ===== Dibujo "muñeco" propio (no depende de puppet.plugin.js) =====
  function drawRatPuppet(ctx, s, phase){
    // sombra
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = 'black';
    ctx.scale(1, 0.35);
    ctx.beginPath(); ctx.ellipse(0, 0, 14*s, 8*s, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // paleta
    const fur     = '#c9c3b5';
    const belly   = '#d8d4c9';
    const earIn   = '#eab0b5';
    const paw     = '#f0ddd2';
    const nose    = '#d98c8f';
    const eye     = '#2a2a2a';
    const tailCol = '#c48974';

    // cuerpo
    const bodyW = 16*s, bodyH = 9*s;
    ctx.fillStyle = fur;
    ctx.beginPath(); ctx.ellipse(0, 0, bodyW, bodyH, 0, 0, Math.PI*2); ctx.fill();

    // barriga
    ctx.fillStyle = belly;
    ctx.beginPath(); ctx.ellipse(0, 2*s, bodyW*0.6, bodyH*0.6, 0, 0, Math.PI*2); ctx.fill();

    // cola
    const wag = Math.sin(phase*2) * 6*s;
    ctx.strokeStyle = tailCol;
    ctx.lineWidth = 2.4*s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-bodyW*0.95, 1*s);
    ctx.quadraticCurveTo(-bodyW*1.2, wag*0.25, -bodyW*1.6, wag);
    ctx.stroke();

    // cabeza
    const headR = 6*s;
    const headX =  bodyW*0.9, headY = -bodyH*0.15;
    ctx.fillStyle = fur;
    ctx.beginPath(); ctx.arc(headX, headY, headR, 0, Math.PI*2); ctx.fill();

    // orejas
    const earR = 2.8*s, eOX = headX - 2.5*s, eOY = headY - 4.5*s;
    ctx.fillStyle = fur;   ctx.beginPath(); ctx.arc(eOX,     eOY,     earR, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = earIn; ctx.beginPath(); ctx.arc(eOX-0.4*s,eOY+0.2*s,earR*0.65,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = fur;   ctx.beginPath(); ctx.arc(eOX+5.0*s,eOY+0.4*s,earR, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = earIn; ctx.beginPath(); ctx.arc(eOX+5.0*s-0.4*s,eOY+0.6*s,earR*0.65,0,Math.PI*2); ctx.fill();

    // morro y nariz
    ctx.fillStyle = nose;
    ctx.beginPath();
    ctx.moveTo(headX + headR, headY);
    ctx.lineTo(headX + headR + 5*s, headY - 1.6*s);
    ctx.lineTo(headX + headR + 5*s, headY + 1.6*s);
    ctx.closePath(); ctx.fill();

    // ojo
    ctx.fillStyle = eye;
    ctx.beginPath(); ctx.arc(headX + 1.5*s, headY - 0.8*s, 0.9*s, 0, Math.PI*2); ctx.fill();

    // bigotes
    ctx.strokeStyle = '#6b6b6b';
    ctx.lineWidth = 1.1*s;
    const wx = headX + headR - 0.8*s, wy = headY;
    ctx.beginPath();
    ctx.moveTo(wx, wy); ctx.lineTo(wx + 6*s, wy - 2*s);
    ctx.moveTo(wx, wy); ctx.lineTo(wx + 6*s, wy);
    ctx.moveTo(wx, wy); ctx.lineTo(wx + 6*s, wy + 2*s);
    ctx.stroke();

    // patitas
    const stepA = Math.sin(phase);
    const stepB = Math.sin(phase + Math.PI);
    const lift  = 2.2*s;
    const bodyH2 = bodyH*0.9;

    // delanteras
    const fX = bodyW*0.35;
    ctx.fillStyle = paw;
    ctx.beginPath(); ctx.arc(+fX,       bodyH2 - Math.max(0, stepA)*lift, 1.9*s, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(+fX-3.6*s, bodyH2 - Math.max(0, stepB)*lift, 1.9*s, 0, Math.PI*2); ctx.fill();

    // traseras
    const bX = -bodyW*0.25;
    ctx.beginPath(); ctx.arc(bX,        bodyH2 - Math.max(0, stepB)*lift, 2.1*s, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(bX-3*s,    bodyH2 - Math.max(0, stepA)*lift, 2.1*s, 0, Math.PI*2); ctx.fill();
  }

  // ===== Stats por nivel =====
  function statsForTier(tier){
    const t = Math.max(1, Math.min(3, (tier|0) || (G.level|0) || 1));
    if (t === 1) return {speed: 5,   see: 80,  biteUnits: 1, chase:false}; // 0.5 corazón
    if (t === 2) return {speed: 8,   see: 120, biteUnits: 2, chase:false}; // 1 corazón
    return         {speed: 12,  see: 200, biteUnits: 3, chase:true };      // 1.5 corazones
  }

  // ===== Daño en medias unidades de corazón, con cooldown local =====
  function applyHalfHeartUnits(units){
    const P = G.player; if (!P) return;
    // 0.35s entre mordiscos para que quite sucesivamente medio, 1 o 1.5 corazones
    const now = (performance && performance.now ? performance.now() : Date.now());
    const cdMs = 350;
    P._rat_lastHit = P._rat_lastHit || 0;
    if ((now - P._rat_lastHit) < cdMs) return;
    P._rat_lastHit = now;

    if (typeof G.health === 'number') {
      const next = Math.max(0, G.health - units);
      G.health = next;
      if (typeof P.hp === 'number') P.hp = Math.ceil(next / 2);
    } else if (typeof P.hp === 'number') {
      P.hp = Math.max(0, P.hp - (units*0.5));
    }
    try { W.HUD?.invalidate?.(); } catch(_){}
    if (DBG) console.log('[rat bite]', units, 'half-hearts');
  }

  // ===== Crear Rata =====
  function spawnRat(x, y, opts){
    const tier  = (opts && opts.tier) ? (opts.tier|0) : ((G.level|0) || 1);
    const S     = statsForTier(tier);
    const e = {
      id: 'rat_' + Math.random().toString(36).slice(2,8),
      kind: ENT.RAT, kindName: 'rat', role: 'enemy',
      x: (x|0), y: (y|0),
      w: TILE*0.55, h: TILE*0.55,
      vx: 0, vy: 0,
      static: false, solid: true,
      hasLight: false, noLight: true,
      tier, S,
      _dirx: 0, _diry: 0,
      _think: 0,
      _biteCd: 0,
      // para pipelines de sprites que esperan una clave
      skin: 'raton', spriteKey: 'raton',
      // Dibujo interno opcional (si el motor llama a e.draw)
      draw(ctx){
        ctx.save();
        ctx.translate(this.x, this.y);
        const ang = Math.atan2(this.vy || this._diry, this.vx || this._dirx);
        ctx.rotate(ang);
        drawRatPuppet(ctx, 0.6, (performance.now?performance.now():Date.now())*0.005);
        ctx.restore();
      },
      // Rig SOLO de dibujo, por compatibilidad con tu bucle (no mueve la entidad)
      _rig: {
        draw: function(ctx, camera, ent){
          ctx.save();
          ctx.translate(ent.x, ent.y);
          const ang = Math.atan2(ent.vy || ent._diry, ent.vx || ent._dirx);
          ctx.rotate(ang);
          drawRatPuppet(ctx, 0.6, (performance.now?performance.now():Date.now())*0.005);
          ctx.restore();
        }
      },
      update(dt){
        if (!dt || !isFinite(dt)) return;
        if (this._think > 0) this._think -= dt;
        if (this._biteCd > 0) this._biteCd -= dt;

        // Dirección/estado
        const P = G.player;
        let dirx = this._dirx, diry = this._diry, sees = false;
        if (P){
          const dx = (P.x + (P.w||0)*0.5) - (this.x + this.w*0.5);
          const dy = (P.y + (P.h||0)*0.5) - (this.y + this.h*0.5);
          const d  = Math.hypot(dx,dy);
          if (d <= S.see){ sees = true; dirx = dx/(d||1); diry = dy/(d||1); }
        }
        if (!S.chase || !sees){
          if (this._think <= 0){
            this._think = 1.5 + Math.random()*2.0;
            const ang = Math.random() * Math.PI*2;
            dirx = Math.cos(ang); diry = Math.sin(ang);
          }
        }
        // normaliza y fija velocidad (NO mover x/y aquí)
        const len = Math.hypot(dirx, diry) || 1;
        this._dirx = dirx/len; this._diry = diry/len;
        const maxVel = S.speed; // px/seg bajos → "modo caracol"
        this.vx = this._dirx * maxVel;
        this.vy = this._diry * maxVel;

        // Daño por contacto con cooldown local (independiente de invuln global)
        if (P && aabbOverlap(this, P)){
          if (this._biteCd <= 0){
            this._biteCd = 0.35;
            applyHalfHeartUnits(S.biteUnits);
            // pequeño empujón para notar el golpe
            const dx2 = (P.x + (P.w||0)*0.5) - (this.x + this.w*0.5);
            const dy2 = (P.y + (P.h||0)*0.5) - (this.y + this.h*0.5);
            const dd  = Math.hypot(dx2,dy2) || 1;
            P.vx = (P.vx||0) + (dx2/dd)*25;
            P.vy = (P.vy||0) + (dy2/dd)*25;
          }
        }
        // El motor (Physics/updateEntities) integra x/y con vx/vy y resuelve colisiones.
      }
    };

    // Registro en listas conocidas
    (G.entities ||= []).push(e);
    (G.enemies  ||= []).push(e);
    (G.movers   ||= []).push(e);
    try { W.Physics?.registerEntity?.(e); } catch(_){}

    if (DBG) console.log('[rat spawn]', {id:e.id, tier:e.tier, S});
    return e;
  }

  // API pública esperada por placement.api.js
  (W.RatsAPI ||= {});
  W.RatsAPI.spawn = function(x,y,opts){ return spawnRat(x,y,opts||{}); };
  W.RatsAPI.spawnNowAtTile = function(tx,ty,opts){
    const t = TILE;
    return spawnRat(tx*t + t*0.5, ty*t + t*0.5, opts||{});
  };

  // acceso alternativo
  (W.Entities ||= {}).Rat = { spawn: W.RatsAPI.spawn };

})(this);