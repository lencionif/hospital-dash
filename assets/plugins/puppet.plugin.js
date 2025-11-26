// puppet.plugin.js
(function(){
  const TAU = Math.PI * 2;

  function lerp(a,b,t){ return a + (b-a)*t; }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  // Un rig minimal con jerarquía y piezas
  function create(opts={}){
    const rig = {
      // vínculo con la entidad del juego (jugador)
      host: opts.host || null,      // {x,y,w,h,vx,vy,facing}
      scale: opts.scale || 1,
      kind: opts.kind || 'human',
      // parámetros de animación
      t: 0,
        walkSpeed: 6,          // pasos/seg para el ciclo
        stride: 12,            // (legacy) no lo usamos para rotar
        armSwing: 12,          // swing suave de brazos
        pushBoost: 0.6,        // brazos más abiertos al empujar
        footLift: 6,           // ↑ elevación pie en E/W
        stepStride: 5,         // → zancada en E/W
        // variantes para caminar en N/S (más marcado)
        footLiftNS: 8,         // ↑ elevación pie en N/S
        stepStrideNS: 7,       // → zancada en N/S
        armPumpNS: 5,          // bombeo vertical de brazos en N/S (px)
        pushReach: 10,         // cuánto estiran los brazos al empujar
        pushLean:  2,          // inclinación torso/cabeza al empujar

        // estado
        state: { moving:false, pushing:false, dir:0 },
        // piezas (puedes añadir img más tarde)
        parts: {
        head:  { r:12,  img:null, imgBack:null, ox:0,  oy:-16 },
        body:  { rx:10, ry:16, img:null, ox:0,  oy:0 },
        // articulación en hombro; el óvalo baja desde ahí
        armL:  { rx:4,  ry:12, img:null, ox:-10, oy:-2 },
        armR:  { rx:4,  ry:12, img:null, ox: 10, oy:-2 },
        // pies como círculos (rx=ry)
        legL:  { rx:6,  ry:6,  img:null, ox:-6,  oy:16 },
        legR:  { rx:6,  ry:6,  img:null, ox: 6,  oy:16 },
        },
      debug:false,  // Key: J para alternar
    };
    _PUSH_ME: // marcador mental
    _pushRig(rig);
    return rig;
  }

  function update(rig, dt, hostState){
    rig.t += dt;

    // Si no nos pasan estado explícito, lo deducimos del host
    const h = rig.host || {};
    const s = hostState || {};

    const speed = Math.hypot(h.vx||0, h.vy||0);

    // ¿se mueve?
    rig.state.moving = (s.moving != null) ? !!s.moving : (speed > 0.01);

    // ¿empujando?
    const pushingFlag = (h.isPushing ?? h.pushing ?? (h.pushAnimT > 0));
    rig.state.pushing = (s.pushing != null) ? !!s.pushing : !!pushingFlag;

    // dirección (rad)
    let dir = (typeof s.dir === 'number') ? s.dir
          : (typeof h.facingAngle === 'number' ? h.facingAngle
          : (Math.atan2(h.vy||0, h.vx||0) || 0));
    rig.state.dir = dir;

    // cara (E/W/N/S)
    rig.state.face = (typeof s.face === 'string')
      ? s.face.toUpperCase()
      : _dirToFace(dir);
  }

  function setHeroHead(rig, heroKey){
    // Carga 'assets/images/<hero>.png' (frente) y 'assets/images/<hero>_back.png' (espalda)
    if (!rig?.parts?.head) return;
    const front = new Image();
    const back  = new Image();
    front.src = `assets/images/${heroKey}.png`;
    back.src  = `assets/images/${heroKey}_back.png`;
    front.onload = () => { rig.parts.head.img = front; };
    back.onload  = () => { rig.parts.head.imgBack = back; };
  }

  const _ALL_RIGS = [];
  const _pushRig = (r) => { if (r && !_ALL_RIGS.includes(r)) _ALL_RIGS.push(r); };

  function toggleDebug(){
    const on = !_ALL_RIGS._dbg;
    _ALL_RIGS._dbg = on;
    _ALL_RIGS.forEach(r => r.debug = on);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyJ') toggleDebug();
  });

  function _dirToFace(rad){
    const TAU = Math.PI*2;
    const a = (rad % TAU + TAU) % TAU;
    // E(−π/4..π/4)  S(π/4..3π/4)  W(3π/4..5π/4)  N(5π/4..7π/4)
    if (a > Math.PI*0.25 && a <= Math.PI*0.75)  return 'S';
    if (a > Math.PI*0.75 && a <= Math.PI*1.25) return 'W';
    if (a > Math.PI*1.25 && a <= Math.PI*1.75) return 'N';
    return 'E';
  }

  // Dibuja una elipse (o círculo) en el Canvas local
  function fillEllipse(ctx, rx, ry){
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
    ctx.fill();
  }

    function draw(rig, ctx, camera){
    if (!rig || !rig.host || !ctx) return;

    const h = rig.host;
    const cam = camera || {x:0,y:0,zoom:1};
    const s = (rig.scale||1) * (cam.zoom||1);

    // base (cadera) en el centro de la AABB del player
    const cx = (h.x + h.w*0.5 - cam.x) * cam.zoom + ctx.canvas.width *0.5;
    const cy = (h.y + h.h*0.5 - cam.y) * cam.zoom + ctx.canvas.height*0.5;

    // movimiento/idle
    const speed = Math.hypot(h.vx||0, h.vy||0);
    const moving = speed > 0.01 || rig.state.moving;
    rig.t += 1/60; // ritmo estable aunque dt varíe (nuestro loop es fixed-step)
    const phase = rig.t * (rig.walkSpeed || 6) * (moving ? 1 : 0);

    // respiración en idle (sube/baja torso/cabeza)
    const breath = moving ? 0 : Math.sin(rig.t * 2.6) * 1.2 * s;
    // Progreso de empuje (usa el temporizador del host y/o el flag del rig)
    const pushT   = Math.max(0, Math.min(1, (h.pushAnimT || 0)));
    const pushK   = pushT * (2 - pushT);           // ease-out suave (0..1)
    const reach   = (rig.pushReach || 10) * pushK * s;  // desplazamiento “hacia delante”
    const lean    = (rig.pushLean  ||  2) * pushK * s;  // pequeña inclinación del torso/cabeza


    // Dirección cardinal: si no hay facing, derivamos de vx/vy cuando se mueve.
    const faceFromHost = (h.facing || rig.state.face || null);
    let card = (typeof faceFromHost === 'string')
      ? faceFromHost.toUpperCase()
      : (moving ? _dirToFace(Math.atan2(h.vy||0, h.vx||0) || 0) : 'S');
    // lateral = flipX, sin rotación del cuerpo
    const walkBobNS = (moving && (card==='N' || card==='S')) ? Math.sin(phase) * 1.2 * s : 0;


    // colores
    const skin  = '#f3c89c';
    const cloth = '#ececec';
    const shoes = '#dcdcdc';

    let pushingNow = pushT > 0 || !!rig.state.pushing;

    // helpers de pies (paso con circulitos)
    const stepK  = Math.sin(phase);
    const stepKL = stepK;                // pie izq
    const stepKR = Math.sin(phase+Math.PI); // pie der
    const liftBase = (card==='N' || card==='S') ? (rig.footLiftNS || 8) : (rig.footLift || 6);
    const lift     = liftBase * (pushingNow ? 0.9 : 1.0) * s;
    const stride   = ((card==='N' || card==='S') ? (rig.stepStrideNS || 7) : (rig.stepStride || 5))
                  * (pushingNow ? 0.35 : 1.0) * s;

    // flip horizontal SOLO cuando mira al Oeste (W)
    const flipX = (card === 'W') ? -1 : 1;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(flipX, 1); // ...nunca giramos el cuerpo "de lado" o "boca abajo"

    // NUEVO: rama para ratas
    if (rig.kind === 'rat') {
      drawRat(rig, ctx, s, card, phase);
      ctx.restore();
      return; // ya dibujamos la rata, no seguimos con el humano
    }

    // sombra elíptica
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = 'black';
    ctx.scale(1, 0.35);
    ctx.beginPath(); ctx.ellipse(0, 0, 18*s, 10*s, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // CUERPO
    ctx.fillStyle = cloth;
    ctx.save();
    let bodyOffX = 0, bodyOffY = 0;
    if (pushingNow){
      if (card === 'S') bodyOffY =  lean;
      if (card === 'N') bodyOffY = -lean;
      if (card === 'E' || card === 'W') bodyOffX =  lean; // flipX ya espeja para W
    }
    ctx.translate(rig.parts.body.ox*s + bodyOffX, rig.parts.body.oy*s + breath*0.5 + bodyOffY + walkBobNS);
    ctx.beginPath(); ctx.ellipse(0, 0, rig.parts.body.rx*s, rig.parts.body.ry*s, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // CABEZA (frente vs. espalda recortada en círculo)
    ctx.save();
    let headOffX = 0, headOffY = 0;
    if (pushingNow){
      if (card === 'S') headOffY =  lean;
      if (card === 'N') headOffY = -lean;
      if (card === 'E' || card === 'W') headOffX =  lean;
    }
    ctx.translate(rig.parts.head.ox*s + headOffX, rig.parts.head.oy*s + breath + headOffY);
    const R = rig.parts.head.r*s;
    const imgFront = rig.parts.head.img || null;
    const imgBack  = rig.parts.head.imgBack || rig.parts.head.backImg || null;
    const showBack = (card === 'N');
    const useImg   = showBack ? imgBack : imgFront;

    ctx.beginPath(); ctx.arc(0,0,R,0,Math.PI*2); ctx.clip();
    if (useImg) { ctx.drawImage(useImg, -R, -R, R*2, R*2); }
    else { ctx.fillStyle = skin; ctx.fill(); }
    ctx.restore();

    // BRAZOS (empuje realista + manos; vertical en N/S, horizontal en E/W)
    const armSwing = (rig.armSwing||12) * Math.sin(phase + Math.PI);
    const pushExtra = pushingNow ? (rig.pushBoost || 0.6) : 0;

    // vector "hacia delante" ya volcado por flipX
    let ax = 0, ay = 0;
    if (card === 'S') ay =  1; else if (card === 'N') ay = -1; else ax = 1;

    // pequeño “bombeo” y alcance al empujar
    const handBop = Math.sin(rig.t * 12) * 1.5 * s * pushExtra;
    const reachX  = ((rig.pushReach||10) * pushExtra + handBop) * ax;
    const reachY  = ((rig.pushReach||10) * pushExtra + handBop) * ay;
    // ángulo del brazo cuando empuja (lateral = horizontal; N/S = vertical)
    const armAngle = pushingNow ? ((ax !== 0) ? -Math.PI/2 : 0) : 0;

    // ----- BRAZO IZQ -----
    ctx.fillStyle = skin;
    ctx.save();
    ctx.translate((rig.parts.armL.ox*s) + reachX, (rig.parts.armL.oy*s) + reachY);
    if (!pushingNow){
      if (card === 'N' || card === 'S'){
        const pump = (rig.armPumpNS || 5) * Math.sin(phase + Math.PI) * (card==='S'? 1:-1) * s;
        ctx.translate(0, pump); // N/S: bombeo vertical
      } else {
        ctx.rotate(-armSwing * 0.03);   // E/W: péndulo por rotación
      }
    } else {
      ctx.rotate(armAngle);             // empuje
    }
    ctx.translate(0, rig.parts.armL.ry*s*0.5 * (pushingNow && ay !== 0 ? ay : 1));
    ctx.beginPath(); ctx.ellipse(0, 0, rig.parts.armL.rx*s, rig.parts.armL.ry*s, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -rig.parts.armL.ry*s*0.5, 3*s, 0, Math.PI*2); ctx.fill();
    // mano visible cuando empuja
    if (pushingNow){ ctx.beginPath(); ctx.arc(0, rig.parts.armL.ry*s*0.95 * (ay || 1), 3.6*s, 0, Math.PI*2); ctx.fill(); }
    ctx.restore();

    // ----- BRAZO DER -----
    ctx.save();
    ctx.translate((rig.parts.armR.ox*s) + reachX, (rig.parts.armR.oy*s) + reachY);
    if (!pushingNow){
      if (card === 'N' || card === 'S'){
        const pump = (rig.armPumpNS || 5) * Math.sin(phase) * (card==='S'? 1:-1) * s;
        ctx.translate(0, pump); // N/S: bombeo vertical
      } else {
        ctx.rotate(armSwing * 0.03);    // E/W: péndulo por rotación
      }
    } else {
      ctx.rotate(armAngle);             // empuje
    }
    ctx.translate(0, rig.parts.armR.ry*s*0.5 * (pushingNow && ay !== 0 ? ay : 1));
    ctx.beginPath(); ctx.ellipse(0, 0, rig.parts.armR.rx*s, rig.parts.armR.ry*s, 0, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -rig.parts.armR.ry*s*0.5, 3*s, 0, Math.PI*2); ctx.fill();
    if (pushingNow){ ctx.beginPath(); ctx.arc(0, rig.parts.armR.ry*s*0.95 * (ay || 1), 3.6*s, 0, Math.PI*2); ctx.fill(); }
    ctx.restore();

    // PIES (circulitos con paso) — E/W en X, N/S en Y
    ctx.fillStyle = shoes;

    // vector “hacia delante” tras el flipX
    ax = 0, ay = 0;
    if (card === 'S') ay =  1;        // abajo (se acerca)
    else if (card === 'N') ay = -1;   // arriba (se aleja)
    else ax = 1;                      // lateral (E o W) → +X tras flip

    // IZQ
    ctx.save();
    const stepX_L = (ax !== 0) ? (stride * stepKL)      : 0;         // paso lateral
    const stepY_L = (ay !== 0) ? (stride * stepKL * ay) : 0;         // paso frente/espalda
    const footLX  = rig.parts.legL.ox*s + stepX_L;
    const footLY  = rig.parts.legL.oy*s + stepY_L - Math.max(0, stepKL)*lift;
    ctx.translate(footLX, footLY);
    ctx.beginPath(); ctx.arc(0, 0, rig.parts.legL.rx*s, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // DER
    ctx.save();
    const stepX_R = (ax !== 0) ? (stride * stepKR)      : 0;
    const stepY_R = (ay !== 0) ? (stride * stepKR * ay) : 0;
    const footRX  = rig.parts.legR.ox*s + stepX_R;
    const footRY  = rig.parts.legR.oy*s + stepY_R - Math.max(0, stepKR)*lift;
    ctx.translate(footRX, footRY);
    ctx.beginPath(); ctx.arc(0, 0, rig.parts.legR.rx*s, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    // DEBUG HUESOS
    if (rig.debug){
        ctx.strokeStyle='rgba(0,255,0,0.6)';
        ctx.beginPath(); ctx.moveTo(-20*s,0); ctx.lineTo(20*s,0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0,-30*s); ctx.lineTo(0,30*s); ctx.stroke();
    }

    ctx.restore();
    }

// API pública
window.PuppetAPI = { create, update, draw, setHeroHead, toggleDebug };
})();