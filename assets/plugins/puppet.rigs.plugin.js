(function(){
  const API = window.PuppetAPI; if (!API) return;

  const TAU = Math.PI * 2;
  const Cache = Object.create(null);
  const IMG = (name) => `./assets/images/${name}`;

  function load(name){
    if (!Cache[name]){
      const img = new Image();
      img.src = IMG(name);
      Cache[name] = img;
    }
    return Cache[name];
  }

  function hasImage(img){
    return !!(img && img.complete && img.naturalWidth && img.naturalHeight);
  }

  function toScreen(cam, e){
    const zoom = cam.zoom || 1;
    const sx = (e.x - cam.x + cam.w * 0.5) * zoom + 0.5;
    const sy = (e.y - cam.y + cam.h * 0.5) * zoom + 0.5;
    const zscale = (e.puppet?.zscale || 1) * (e.puppet?.scale || 1) * zoom;
    return { sx, sy, sc: zscale };
  }

  function shadow(ctx, scale, radius = 12){
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000';
    ctx.scale(1, 0.35);
    ctx.beginPath();
    ctx.arc(0, 0, radius * scale, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const bob = (t, speed = 2, amp = 3) => Math.sin(t * speed) * amp;
  const pulse = (t, speed = 1) => (Math.sin(t * speed) + 1) * 0.5;

  function randomPhase(e, key){
    if (!e) return 0;
    const prop = `_rigPhase_${key}`;
    if (typeof e[prop] !== 'number') e[prop] = Math.random() * TAU;
    return e[prop];
  }

  function drawImageOrRect(ctx, img, x, y, w, h, fallback){
    if (hasImage(img)){
      ctx.drawImage(img, x, y, w, h);
    } else if (fallback){
      fallback();
    } else {
      ctx.fillStyle = '#ccc';
      ctx.fillRect(x, y, w, h);
    }
  }

  // ───────────────────────────────── HEROES ─────────────────────────────────
  function registerHero(key, cfg){
    API.registerRig(`hero.${key}`, {
      draw(ctx, cam, e, t){
        const { sx, sy, sc } = toScreen(cam, e);
        const s = (e.scale || 1) * sc;
        ctx.save();
        ctx.translate(sx, sy);
        shadow(ctx, s, 12);
        const bobY = bob(t + (cfg.phaseOffset || 0), cfg.stepSpeed, cfg.stepAmp);
        const lean = (cfg.lean || 0) * Math.sin(t * cfg.stepSpeed * 0.5);
        const img = load(cfg.image);
        const w = (cfg.width || 24) * s;
        const h = (cfg.height || 36) * s;
        ctx.save();
        ctx.translate(0, bobY);
        ctx.rotate(lean);
        drawImageOrRect(ctx, img, -w * 0.5, -h, w, h, () => {
          ctx.fillStyle = cfg.fallback || '#d0c0b0';
          ctx.fillRect(-w * 0.5, -h, w, h);
          ctx.fillStyle = '#614c3b';
          ctx.fillRect(-w * 0.2, -h * 0.8, w * 0.4, h * 0.4);
        });
        ctx.restore();
        ctx.restore();
      }
    });
  }

  registerHero('enrique', {
    image: 'enrique.png',
    stepSpeed: 1.6,
    stepAmp: 2.6,
    lean: 0.08,
    fallback: '#cda884'
  });
  registerHero('roberto', {
    image: 'roberto.png',
    stepSpeed: 2.4,
    stepAmp: 3.6,
    lean: 0.12,
    fallback: '#d8b28f'
  });
  registerHero('francesco', {
    image: 'francesco.png',
    stepSpeed: 1.9,
    stepAmp: 2.2,
    lean: 0.06,
    fallback: '#c4d0ef'
  });

  // ───────────────────────────────── ENEMIGOS ───────────────────────────────
  function drawRat(ctx, t, scale){
    ctx.save();
    shadow(ctx, scale, 11);
    ctx.fillStyle = '#c9c3b5';
    ctx.beginPath();
    ctx.ellipse(0, 0, 16 * scale, 9 * scale, 0, 0, TAU);
    ctx.fill();

    ctx.fillStyle = '#d8d4c9';
    ctx.beginPath();
    ctx.ellipse(0, 2 * scale, 9.6 * scale, 5.4 * scale, 0, 0, TAU);
    ctx.fill();

    const wag = Math.sin(t * 6) * 6 * scale;
    ctx.strokeStyle = '#c48974';
    ctx.lineWidth = 2.4 * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-15 * scale, 1 * scale);
    ctx.quadraticCurveTo(-20 * scale, wag * 0.25, -26 * scale, wag);
    ctx.stroke();

    const headR = 6 * scale;
    const headX = 14 * scale;
    const headY = -1.3 * scale;
    ctx.fillStyle = '#c9c3b5';
    ctx.beginPath(); ctx.arc(headX, headY, headR, 0, TAU); ctx.fill();
    ctx.fillStyle = '#eab0b5';
    ctx.beginPath(); ctx.arc(headX - 4 * scale, headY - 5 * scale, 2.8 * scale, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(headX + 5 * scale, headY - 4 * scale, 2.6 * scale, 0, TAU); ctx.fill();

    ctx.fillStyle = '#d98c8f';
    ctx.beginPath();
    ctx.moveTo(headX + headR, headY);
    ctx.lineTo(headX + headR + 5 * scale, headY - 1.6 * scale);
    ctx.lineTo(headX + headR + 5 * scale, headY + 1.6 * scale);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#2a2a2a';
    ctx.beginPath(); ctx.arc(headX + 1.5 * scale, headY - 0.8 * scale, 0.9 * scale, 0, TAU); ctx.fill();

    ctx.strokeStyle = '#5c5c5c';
    ctx.lineWidth = 1.1 * scale;
    ctx.beginPath();
    ctx.moveTo(headX + 5 * scale, headY);
    ctx.lineTo(headX + 11 * scale, headY - 2 * scale);
    ctx.moveTo(headX + 5 * scale, headY);
    ctx.lineTo(headX + 11 * scale, headY);
    ctx.moveTo(headX + 5 * scale, headY);
    ctx.lineTo(headX + 11 * scale, headY + 2 * scale);
    ctx.stroke();

    const stepA = Math.sin(t * 3);
    const stepB = Math.sin(t * 3 + Math.PI);
    ctx.fillStyle = '#f0ddd2';
    const pawLift = 2.2 * scale;
    const bodyH = 8.1 * scale;
    ctx.beginPath(); ctx.arc(5.6 * scale, bodyH - Math.max(0, stepA) * pawLift, 1.9 * scale, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(2 * scale, bodyH - Math.max(0, stepB) * pawLift, 1.9 * scale, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-4.5 * scale, bodyH - Math.max(0, stepB) * pawLift, 2.1 * scale, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-8 * scale, bodyH - Math.max(0, stepA) * pawLift, 2.1 * scale, 0, TAU); ctx.fill();
    ctx.restore();
  }

  API.registerRig('rat', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc * 0.8;
      ctx.save();
      ctx.translate(sx, sy);
      drawRat(ctx, t, s);
      ctx.restore();
    }
  });

  API.registerRig('mosquito', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      ctx.save();
      ctx.translate(sx, sy - 6 * s);
      shadow(ctx, s, 9);
      ctx.translate(0, -6 * s);
      ctx.fillStyle = '#3b3b3b';
      ctx.beginPath(); ctx.ellipse(0, 0, 6 * s, 4 * s, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#7a7a7a';
      ctx.beginPath(); ctx.ellipse(-6 * s, 0, 5 * s, 3 * s, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#444'; ctx.lineWidth = 1.5 * s;
      ctx.beginPath(); ctx.moveTo(6 * s, 0); ctx.lineTo(12 * s, 1.2 * s); ctx.stroke();
      const flap = 0.6 + pulse(t, 24) * 0.7;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#cfe8ff';
      ctx.beginPath(); ctx.ellipse(-2 * s, -10 * s, 4 * flap * s, 10 * s, -0.35, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse( 2 * s, -10 * s, 4 * flap * s, 10 * s,  0.35, 0, TAU); ctx.fill();
      ctx.restore();
    }
  });

  // ─────────────────────────────── INFRAESTRUCTURA ─────────────────────────
  function doorProgress(e){
    const st = e.state || {};
    if (typeof st.openProgress === 'number') return clamp(st.openProgress, 0, 1);
    if (typeof e.open === 'number') return clamp(e.open, 0, 1);
    return e.open ? 1 : (st.open ? 1 : 0);
  }

  API.registerRig('door', {
    draw(ctx, cam, e){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const w = (e.w || 32) * s;
      const h = (e.h || 48) * s;
      const progress = doorProgress(e);
      const closed = load('puerta_cerrada.png');
      const opened = load('puerta_abiertas.png');
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      ctx.translate(0, -h * 0.5);
      if (hasImage(closed) || hasImage(opened)){
        ctx.globalAlpha = 1;
        if (hasImage(closed)){
          ctx.globalAlpha = 1 - progress;
          ctx.drawImage(closed, -w * 0.5, 0, w, h);
        }
        if (hasImage(opened)){
          ctx.globalAlpha = progress;
          ctx.drawImage(opened, -w * 0.5, 0, w, h);
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = '#654321';
        ctx.fillRect(-w * 0.5, 0, w, h);
        ctx.fillStyle = '#b9b9b9';
        ctx.fillRect(-w * 0.45, h * 0.1 * (1 - progress), w * 0.9, h * (0.8 - 0.6 * progress));
      }
      ctx.restore();
    }
  });

  API.registerRig('elevator', {
    draw(ctx, cam, e){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const w = (e.w || 32) * s;
      const h = (e.h || 48) * s;
      const progress = doorProgress(e);
      const closed = load('ascensor_cerrado.png');
      const opened = load('ascensor_abierto.png');
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      ctx.translate(0, -h * 0.5);
      const slide = progress * 0.6;
      if (hasImage(closed) || hasImage(opened)){
        if (hasImage(closed)) ctx.drawImage(closed, -w * 0.5, 0, w, h);
        if (hasImage(opened)){
          const img = opened;
          const naturalW = img.naturalWidth || 2;
          const half = naturalW * 0.5;
          const naturalH = img.naturalHeight || 1;
          const leftDx = -w * 0.5 - slide * w * 0.5;
          const rightDx = slide * w * 0.5;
          ctx.drawImage(img, 0, 0, half, naturalH, leftDx, 0, w * 0.5, h);
          ctx.drawImage(img, half, 0, half, naturalH, rightDx, 0, w * 0.5, h);
        }
      } else {
        ctx.fillStyle = '#888';
        ctx.fillRect(-w * 0.5, 0, w, h);
        const leaf = w * 0.5;
        ctx.fillStyle = '#d9d9d9';
        ctx.fillRect(-leaf - slide * leaf, 0, leaf, h);
        ctx.fillRect(slide * leaf, 0, leaf, h);
      }
      ctx.restore();
    }
  });

  // ─────────────────────────────── CARROS ──────────────────────────────────
  function registerCart(name, imgName, opts){
    API.registerRig(`cart.${name}`, {
      draw(ctx, cam, e, t){
        const { sx, sy, sc } = toScreen(cam, e);
        const s = (e.scale || 1) * sc;
        const img = load(imgName);
        const w = (e.w || 32) * s;
        const h = (e.h || 42) * s;
        ctx.save();
        ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
        shadow(ctx, s, 14);
        ctx.translate(0, -h * 0.5 + (opts.offsetY || 0) * s);
        const phase = e.puppet?.data?.phase ?? randomPhase(e, name);
        const wobble = (opts.wobbleAmp || 0) * Math.sin(t * (opts.wobbleSpeed || 6) + phase);
        ctx.translate(0, wobble * s);
        drawImageOrRect(ctx, img, -w * 0.5, -h * 0.5, w, h, () => {
          ctx.fillStyle = '#b5b5b5';
          ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
        });
        if (opts.decor){ opts.decor(ctx, s, t, phase); }
        ctx.restore();
      }
    });
  }

  registerCart('emergency', 'carro_urgencias.png', {
    wobbleAmp: 1.5,
    wobbleSpeed: 8,
    decor(ctx, s, t){
      const blink = pulse(t, 8);
      ctx.save();
      ctx.translate(0, -18 * s);
      ctx.fillStyle = `rgba(255,64,64,${0.6 + 0.4 * blink})`;
      ctx.beginPath(); ctx.ellipse(-8 * s, 0, 5 * s, 3 * s, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(64,160,255,${0.6 + 0.4 * (1 - blink)})`;
      ctx.beginPath(); ctx.ellipse(8 * s, 0, 5 * s, 3 * s, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  });

  registerCart('food', 'carro_comida.png', {
    wobbleAmp: 2.2,
    wobbleSpeed: 5,
    decor(ctx, s, t, phase){
      ctx.save();
      ctx.translate(0, -10 * s);
      const jitter = Math.sin(t * 12 + phase) * 0.8 * s;
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-10 * s, jitter, 20 * s, 3 * s);
      ctx.fillRect(-9 * s, -6 * s - jitter, 18 * s, 2.4 * s);
      ctx.restore();
    }
  });

  registerCart('meds', 'carro_medicinas.png', {
    wobbleAmp: 1.0,
    wobbleSpeed: 4.5,
    decor(ctx, s, t){
      const pulseV = 0.6 + 0.4 * pulse(t, 6);
      ctx.save();
      ctx.translate(0, -14 * s);
      ctx.fillStyle = `rgba(255,255,255,${pulseV})`;
      ctx.fillRect(-6 * s, -6 * s, 12 * s, 12 * s);
      ctx.fillStyle = `rgba(220,40,60,${pulseV})`;
      ctx.fillRect(-2 * s, -6 * s, 4 * s, 12 * s);
      ctx.fillRect(-6 * s, -2 * s, 12 * s, 4 * s);
      ctx.restore();
    }
  });

  // ─────────────────────────────── HAZARDS ──────────────────────────────────
  API.registerRig('hazard.fire', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const w = (e.w || 24) * s;
      const h = (e.h || 28) * s;
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      shadow(ctx, s, 8);
      ctx.translate(0, -h * 0.3);
      const flicker = 0.7 + 0.3 * Math.sin(t * 10 + randomPhase(e, 'fire'));
      const grad = ctx.createRadialGradient(0, 0, h * 0.1, 0, 0, h * 0.6);
      grad.addColorStop(0, `rgba(255,255,180,${0.9 * flicker})`);
      grad.addColorStop(0.4, `rgba(255,160,60,${0.8 * flicker})`);
      grad.addColorStop(1, 'rgba(120,30,10,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, -h * (0.4 + 0.1 * flicker));
      ctx.bezierCurveTo(w * 0.4, -h * 0.1, w * 0.3, h * 0.4, 0, h * 0.5);
      ctx.bezierCurveTo(-w * 0.3, h * 0.4, -w * 0.4, -h * 0.1, 0, -h * (0.4 + 0.1 * flicker));
      ctx.fill();
      ctx.restore();
    }
  });

  API.registerRig('hazard.water', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const w = (e.w || 26) * s;
      const h = (e.h || 26) * s;
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      shadow(ctx, s, 7);
      const ripple = 1 + 0.08 * Math.sin(t * 4 + randomPhase(e, 'water'));
      const grad = ctx.createRadialGradient(0, 0, h * 0.1, 0, 0, h * 0.6 * ripple);
      grad.addColorStop(0, 'rgba(150,200,255,0.6)');
      grad.addColorStop(0.7, 'rgba(90,140,220,0.4)');
      grad.addColorStop(1, 'rgba(90,140,220,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.ellipse(0, 0, w * 0.5 * ripple, h * 0.35 * ripple, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  });

  // ─────────────────────────────── LUCES ────────────────────────────────────
  API.registerRig('light', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const radius = (e.puppet?.data?.radius || 48) * (e.scale || 1) * (cam.zoom || 1);
      ctx.save();
      ctx.translate(sx, sy);
      const baseIntensity = e.puppet?.data?.intensity ?? 0.6;
      const flick = e.puppet?.data?.broken ? 0.3 + 0.7 * pulse(t, 12) : 1;
      const grad = ctx.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius);
      grad.addColorStop(0, `rgba(255,255,200,${0.35 * baseIntensity * flick})`);
      grad.addColorStop(1, 'rgba(255,255,200,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.fill();
      ctx.restore();
    }
  });

  // ─────────────────────────────── PACIENTES ───────────────────────────────
  function patientSkin(e){
    return e.puppet?.data?.skin || e.skin || 'paciente1.png';
  }

  API.registerRig('patient.std', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const img = load(patientSkin(e));
      const w = (e.w || 26) * s;
      const h = (e.h || 30) * s;
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      shadow(ctx, s, 10);
      const breath = (e.attended ? 0.2 : 0.5) * Math.sin(t * 1.6 + randomPhase(e, 'breath'));
      ctx.translate(0, -h * 0.45 + breath);
      drawImageOrRect(ctx, img, -w * 0.5, -h * 0.5, w, h, () => {
        ctx.fillStyle = '#d1c5b3';
        ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
      });
      ctx.restore();
    }
  });

  API.registerRig('patient.furiosa', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const img = load('paciente_furiosa.png');
      const w = (e.w || 26) * s;
      const h = (e.h || 30) * s;
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      shadow(ctx, s, 11);
      ctx.translate(0, -h * 0.45);
      ctx.rotate(Math.sin(t * 8) * 0.04);
      const jitter = Math.sin(t * 14 + randomPhase(e, 'fury')) * 2 * s;
      drawImageOrRect(ctx, img, -w * 0.5, -h * 0.5 + jitter, w, h, () => {
        ctx.fillStyle = '#ff6a6a';
        ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
      });
      ctx.restore();
    }
  });

  // ─────────────────────────────── ÍTEMS ───────────────────────────────────
  function registerPillRig(name){
    API.registerRig(`pill.${name}`, {
      draw(ctx, cam, e, t){
        const { sx, sy, sc } = toScreen(cam, e);
        const s = (e.scale || 1) * sc;
        const img = load(`pastilla_${name}.png`);
        const w = (e.w || 14) * s;
        const h = (e.h || 14) * s;
        ctx.save();
        ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
        const swing = Math.sin(t * 4 + randomPhase(e, `pill_${name}`)) * 0.25;
        ctx.rotate(swing);
        ctx.translate(0, -5 * s + Math.sin(t * 2) * 2 * s);
        drawImageOrRect(ctx, img, -w * 0.5, -h * 0.5, w, h, () => {
          ctx.fillStyle = '#fef2b8';
          ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
        });
        ctx.restore();
      }
    });
  }

  const pillVariants = [
    'analgesico', 'antibiotico', 'ansiolitico', 'antipsicotico', 'diuretico', 'anticoagulante', 'broncodilat',
    'analitica', 'azul', 'gaviscon', 'luzon', 'patoplast', 'tillaout', 'zenidina', 'final'
  ];
  pillVariants.forEach(registerPillRig);

  function registerSyringe(color, file){
    API.registerRig(`syringe.${color}`, {
      draw(ctx, cam, e, t){
        const { sx, sy, sc } = toScreen(cam, e);
        const s = (e.scale || 1) * sc;
        const img = load(file);
        const w = (e.w || 16) * s;
        const h = (e.h || 32) * s;
        ctx.save();
        ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
        shadow(ctx, s, 8);
        ctx.translate(0, -8 * s);
        ctx.rotate(Math.sin(t * 1.8 + randomPhase(e, `syringe_${color}`)) * 0.2);
        drawImageOrRect(ctx, img, -w * 0.5, -h * 0.5, w, h, () => {
          ctx.fillStyle = '#d0d6dc';
          ctx.fillRect(-w * 0.3, -h * 0.5, w * 0.6, h);
        });
        ctx.restore();
      }
    });
  }

  registerSyringe('red', 'jeringa_roja.png');
  registerSyringe('blue', 'jeringa_azul.png');
  registerSyringe('green', 'jeringa_verde.png');

  function registerDrip(color, file){
    API.registerRig(`drip.${color}`, {
      draw(ctx, cam, e, t){
        const { sx, sy, sc } = toScreen(cam, e);
        const s = (e.scale || 1) * sc;
        const img = load(file);
        const w = (e.w || 18) * s;
        const h = (e.h || 36) * s;
        ctx.save();
        ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
        shadow(ctx, s, 9);
        ctx.translate(0, -10 * s);
        drawImageOrRect(ctx, img, -w * 0.5, -h * 0.5, w, h, () => {
          ctx.fillStyle = '#dbe5f5';
          ctx.fillRect(-w * 0.3, -h * 0.5, w * 0.6, h);
        });
        const drop = pulse(t, 2 + color.length) * 12 * s;
        ctx.fillStyle = 'rgba(180,220,255,0.8)';
        ctx.beginPath(); ctx.ellipse(0, drop, 3 * s, 4 * s, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
    });
  }

  registerDrip('red', 'gotero_rojo.png');
  registerDrip('blue', 'gotero_azul.png');
  registerDrip('green', 'gotero_verde.png');

  API.registerRig('phone', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const img = load('telefono.png');
      const w = (e.w || 22) * s;
      const h = (e.h || 28) * s;
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      const vib = Math.sin(t * 25 + randomPhase(e, 'phone')) * 2 * s;
      ctx.translate(vib, -6 * s);
      drawImageOrRect(ctx, img, -w * 0.5, -h * 0.5, w, h, () => {
        ctx.fillStyle = '#2b2d42';
        ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
        ctx.fillStyle = '#8d99ae';
        ctx.fillRect(-w * 0.3, -h * 0.3, w * 0.6, h * 0.6);
      });
      ctx.restore();
    }
  });

  API.registerRig('spawner', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const type = (e.type || e.sub || '').toLowerCase();
      let file = 'spawner_enemigos.png';
      if (type.includes('cart')) file = 'spawner_carros.png';
      else if (type.includes('npc')) file = 'spawner_npc.png';
      const img = load(file);
      const w = (e.w || 26) * s;
      const h = (e.h || 26) * s;
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      shadow(ctx, s, 9);
      const pulseR = 1 + 0.1 * Math.sin(t * 3 + randomPhase(e, 'spawner'));
      ctx.globalAlpha = 0.85;
      drawImageOrRect(ctx, img, -w * 0.5 * pulseR, -h * 0.5 * pulseR, w * pulseR, h * pulseR, () => {
        ctx.fillStyle = 'rgba(120,160,255,0.4)';
        ctx.beginPath(); ctx.arc(0, 0, w * 0.4 * pulseR, 0, TAU); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `rgba(120,200,255,${0.6 + 0.3 * pulse(t, 4)})`;
      ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.arc(0, 0, w * 0.35 * pulseR, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  });
})();
