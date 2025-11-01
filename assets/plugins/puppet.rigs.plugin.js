(function(){
  const API = window.PuppetAPI; if (!API) return;

  const TAU = Math.PI * 2;
  const Cache = Object.create(null);
  const Missing = new Set();

  const IMG_PATH = (name) => `./assets/images/${name}`;

  function load(name){
    if (!name) return null;
    if (!Cache[name]){
      const img = new Image();
      img.src = IMG_PATH(name);
      Cache[name] = img;
    }
    return Cache[name];
  }

  function hasImage(img){
    return !!(img && img.complete && img.naturalWidth && img.naturalHeight);
  }

  function logMissing(name){
    if (!name || Missing.has(name)) return;
    Missing.add(name);
    console.warn(`[puppet.rigs] missing sprite: ${name}`);
  }

  function toScreen(cam, e){
    const zoom = cam?.zoom ?? 1;
    const cw = cam?.w ?? 0;
    const ch = cam?.h ?? 0;
    const cx = ((e.x + (e.w || 0) * 0.5) - (cam?.x ?? 0)) * zoom + cw * 0.5;
    const cy = ((e.y + (e.h || 0) * 0.5) - (cam?.y ?? 0)) * zoom + ch * 0.5;
    const scale = zoom * (e.puppet?.scale ?? 1) * (e.puppet?.zscale ?? 1) * (e.scale ?? 1);
    return [cx, cy, scale];
  }

  function drawShadow(ctx, radius, scale = 1, flatten = 0.32, alpha = 0.22){
    if (!radius) return;
    ctx.save();
    ctx.scale(1, flatten);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(0, 0, radius * scale, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function parseTint(value, fallbackAlpha = 0.35){
    if (!value) return null;
    if (typeof value === 'string') return { color: value, alpha: fallbackAlpha };
    if (typeof value === 'number') return { color: `rgba(255,255,255,1)`, alpha: value };
    if (typeof value === 'object'){
      const color = value.color || value.c || value.fill || '#ffffff';
      const alpha = (typeof value.alpha === 'number') ? value.alpha : (typeof value.a === 'number' ? value.a : fallbackAlpha);
      return { color, alpha };
    }
    return null;
  }

  function drawSprite(ctx, skin, w, h, fallbackColor, tint){
    const img = skin ? load(skin) : null;
    if (img && hasImage(img)){
      ctx.drawImage(img, -w * 0.5, -h * 0.5, w, h);
    } else {
      if (skin) logMissing(skin);
      ctx.fillStyle = fallbackColor || '#b5b5b5';
      ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
    }
    if (tint){
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = tint.alpha;
      ctx.fillStyle = tint.color;
      ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
      ctx.restore();
    }
  }

  function baseWalkerState(e, cfg){
    const data = e?.puppet?.data || {};
    const tint = parseTint(data.tint || cfg.tint);
    const scale = (typeof data.scale === 'number' ? data.scale : (cfg.scale ?? 1));
    const skin = data.skin || e.skin || cfg.skin;
    return {
      phase: Math.random() * TAU,
      swayPhase: Math.random() * TAU,
      time: 0,
      bob: 0,
      sway: 0,
      lean: 0,
      erratic: 0,
      dir: 1,
      tint,
      scale,
      skin
    };
  }

  function updateWalkerState(st, e, dt, cfg){
    const vx = e?.vx ?? (e?.dirX ?? 0) * (cfg.speed ?? 0);
    const vy = e?.vy ?? (e?.dirY ?? 0) * (cfg.speed ?? 0);
    const speed = Math.hypot(vx, vy);
    const moving = speed > (cfg.walkThreshold ?? 16);
    const cycle = moving ? (cfg.walkCycle ?? 6) : (cfg.idleCycle ?? 2.2);
    st.time += dt;
    st.phase = (st.phase + dt * cycle) % TAU;
    const bobAmp = moving ? (cfg.walkBob ?? 3.4) : (cfg.idleBob ?? 1.2);
    st.bob = Math.sin(st.phase) * bobAmp * st.scale;
    const swayFreq = cfg.swayFreq ?? 1.5;
    const swayAmp = moving ? (cfg.swayAmp ?? 0.8) : (cfg.idleSwayAmp ?? 0.3);
    st.sway = Math.sin(st.phase * swayFreq + st.swayPhase) * swayAmp * st.scale;
    const leanTarget = moving ? (cfg.lean ?? 0) : (cfg.idleLean ?? 0);
    st.lean += (leanTarget - st.lean) * Math.min(1, dt * 6);
    if (cfg.erratic){
      st.erratic += (Math.sin(st.time * cfg.erratic.speed + st.swayPhase) * cfg.erratic.amp - st.erratic) * Math.min(1, dt * 5);
    }
    if (cfg.hipSway){
      const hip = cfg.hipSway;
      st.hip = Math.sin(st.phase * hip.freq + st.swayPhase) * hip.amp * st.scale;
    }
    if (cfg.microTurn){
      st.micro = Math.sin(st.time * cfg.microTurn.speed + st.swayPhase) * cfg.microTurn.amp;
    }
    if (cfg.lookAround){
      st.look = Math.sin(st.time * cfg.lookAround.speed + st.swayPhase) * cfg.lookAround.amp;
    }
    if (cfg.headTilt){
      st.headTilt = Math.sin(st.phase * cfg.headTilt.freq + st.swayPhase) * cfg.headTilt.amp;
    }
    if (cfg.extraUpdate) cfg.extraUpdate(st, e, dt, speed, moving);
    if (cfg.faceFromVelocity !== false){
      if (Math.abs(vx) > 2) st.dir = vx < 0 ? -1 : 1;
      else if (e?.dirX) st.dir = e.dirX < 0 ? -1 : 1;
    }
  }

  function drawWalker(ctx, cam, e, st, cfg){
    const [cx, cy, sc] = toScreen(cam, e);
    const totalScale = sc * (cfg.spriteScale ?? 1) * st.scale;
    const w = (cfg.spriteWidth ?? (e.w || 32)) * totalScale;
    const h = (cfg.spriteHeight ?? (e.h || 48)) * totalScale;
    ctx.save();
    ctx.translate(cx, cy);
    drawShadow(ctx, cfg.shadowRadius ?? (Math.max(w, h) * 0.18), totalScale, cfg.shadowFlatten ?? 0.32, cfg.shadowAlpha ?? 0.22);
    ctx.translate(0, -h * 0.5 + (cfg.offsetY ?? 0) * totalScale + st.bob + (cfg.hover ?? 0));
    if (cfg.applyLean !== false) ctx.rotate(st.lean + (st.erratic || 0) + (st.micro || 0));
    ctx.translate(st.sway + (st.hip || 0), 0);
    ctx.scale(st.dir < 0 ? -1 : 1, 1);
    drawSprite(ctx, st.skin || cfg.skin, w, h, cfg.fallbackColor || '#bcbec7', st.tint);
    if (cfg.overlay) cfg.overlay(ctx, totalScale, st, e);
    ctx.restore();
  }

  function registerWalkerRig(id, cfg){
    API.registerRig(id, {
      create(e){
        return baseWalkerState(e, cfg);
      },
      update(st, e, dt){
        updateWalkerState(st, e, dt, cfg);
      },
      draw(ctx, cam, e, st){
        drawWalker(ctx, cam, e, st, cfg);
      }
    });
  }

  // ───────────────────────────── HEROES ─────────────────────────────
  registerWalkerRig('hero_enrique', {
    skin: 'enrique.png',
    scale: 1.1,
    walkCycle: 6.5,
    walkBob: 4.6,
    idleBob: 1.6,
    swayFreq: 1.1,
    swayAmp: 0.6,
    lean: 0.18,
    shadowRadius: 14,
    offsetY: -6
  });

  registerWalkerRig('hero_roberto', {
    skin: 'roberto.png',
    scale: 0.975,
    walkCycle: 7.8,
    walkBob: 3.1,
    idleBob: 1.1,
    swayFreq: 1.8,
    swayAmp: 1.1,
    lean: 0.1,
    shadowRadius: 13,
    offsetY: -4
  });

  registerWalkerRig('hero_francesco', {
    skin: 'francesco.png',
    scale: 1.0,
    walkCycle: 6.8,
    walkBob: 3.6,
    idleBob: 1.3,
    swayFreq: 1.5,
    swayAmp: 0.8,
    lean: 0.12,
    shadowRadius: 13,
    offsetY: -5
  });

  // ───────────────────────────── NPCs ──────────────────────────────
  registerWalkerRig('npc_celador', {
    skin: 'celador.png',
    walkCycle: 5.4,
    walkBob: 2.6,
    idleBob: 1.0,
    swayAmp: 0.4,
    lean: 0.05,
    shadowRadius: 12,
    offsetY: -5
  });

  registerWalkerRig('npc_chica_limpieza', {
    skin: 'chica_limpieza.png',
    walkCycle: 7.4,
    walkBob: 3.2,
    idleBob: 1.2,
    swayFreq: 2.0,
    swayAmp: 1.2,
    lean: 0.08,
    shadowRadius: 11,
    offsetY: -4
  });

  registerWalkerRig('npc_guardia', {
    skin: 'guardia.png',
    walkCycle: 6.0,
    walkBob: 2.2,
    idleBob: 0.9,
    swayAmp: 0.4,
    lean: 0.06,
    shadowRadius: 13,
    offsetY: -5
  });

  registerWalkerRig('npc_medico', {
    skin: 'medico.png',
    walkCycle: 6.4,
    walkBob: 2.8,
    idleBob: 1.0,
    swayFreq: 1.6,
    swayAmp: 0.5,
    headTilt: { freq: 1.3, amp: 0.04 },
    shadowRadius: 12,
    offsetY: -4
  });

  registerWalkerRig('npc_supervisora', {
    skin: 'supervisora.png',
    scale: 0.98,
    walkCycle: 6.1,
    walkBob: 2.0,
    idleBob: 0.9,
    swayAmp: 0.7,
    hipSway: { freq: 1.8, amp: 1.1 },
    lean: 0.05,
    shadowRadius: 12,
    offsetY: -4
  });

  registerWalkerRig('npc_tcae', {
    skin: 'TCAE.png',
    walkCycle: 6.3,
    walkBob: 2.7,
    idleBob: 1.1,
    swayAmp: 0.6,
    lean: 0.06,
    shadowRadius: 12,
    offsetY: -4
  });

  registerWalkerRig('npc_jefe_servicio', {
    skin: 'jefe_servicio.png',
    scale: 1.08,
    walkCycle: 5.0,
    walkBob: 2.4,
    idleBob: 1.1,
    swayAmp: 0.5,
    lean: 0.04,
    extraUpdate(st){
      st.belly = Math.sin(st.phase * 2) * 1.2 * st.scale;
    },
    overlay(ctx, s, st){
      if (!st.belly) return;
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(0, 6 * s, 12 * s + st.belly, 8 * s + st.belly * 0.8, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    },
    shadowRadius: 14,
    offsetY: -6
  });

  registerWalkerRig('npc_enfermera_sexy', {
    skin: 'enfermera_sexy.png',
    walkCycle: 7.6,
    walkBob: 3.4,
    idleBob: 1.2,
    swayAmp: 1.3,
    hipSway: { freq: 1.6, amp: 1.5 },
    lean: 0.09,
    shadowRadius: 12,
    offsetY: -4
  });

  registerWalkerRig('npc_familiar_molesto', {
    skin: 'familiar_molesto.png',
    walkCycle: 6.8,
    walkBob: 2.9,
    idleBob: 1.0,
    swayAmp: 0.9,
    erratic: { speed: 3.2, amp: 0.08 },
    microTurn: { speed: 2.3, amp: 0.1 },
    shadowRadius: 11,
    offsetY: -5
  });

  // ───────────────────────────── PACIENTES ──────────────────────────
  function registerBedRig(id, cfg){
    API.registerRig(id, {
      create(e){
        const data = e?.puppet?.data || {};
        const skin = data.skin || e.skin || cfg.skin;
        const tint = parseTint(data.tint || cfg.tint, cfg.tintAlpha ?? 0.45);
        return {
          phase: Math.random() * TAU,
          time: 0,
          skin,
          tint,
          scale: (typeof data.scale === 'number') ? data.scale : (cfg.scale ?? 1)
        };
      },
      update(st, e, dt){
        st.time += dt;
        st.phase = (st.phase + dt * (cfg.speed ?? 1.4)) % TAU;
        st.offset = Math.sin(st.phase) * (cfg.amp ?? 2) * st.scale;
      },
      draw(ctx, cam, e, st){
        const [cx, cy, sc] = toScreen(cam, e);
        const totalScale = sc * st.scale;
        const w = (cfg.spriteWidth ?? (e.w || 32)) * totalScale;
        const h = (cfg.spriteHeight ?? (e.h || 48)) * totalScale;
        ctx.save();
        ctx.translate(cx, cy);
        drawShadow(ctx, cfg.shadowRadius ?? (w * 0.35), totalScale, 0.28, cfg.shadowAlpha ?? 0.25);
        ctx.translate(0, -h * 0.5 + (cfg.offsetY ?? 0) * totalScale + st.offset);
        drawSprite(ctx, st.skin || cfg.skin, w, h, cfg.fallbackColor || '#d8d0c8', st.tint);
        ctx.restore();
      }
    });
  }

  registerBedRig('patient_bed', {
    skin: 'paciente1.png',
    spriteHeight: 42,
    amp: 1.6,
    speed: 1.6,
    shadowRadius: 14,
    offsetY: -6
  });

  registerWalkerRig('patient_furiosa', {
    skin: 'paciente_furiosa.png',
    tint: { color: 'rgba(255,64,64,1)', alpha: 0.18 },
    walkCycle: 8.0,
    walkBob: 3.5,
    idleBob: 1.4,
    swayAmp: 0.9,
    lean: 0.18,
    shadowRadius: 12,
    offsetY: -5
  });

  // ───────────────────────────── ENEMIGOS ───────────────────────────
  function makeRatRig(){
    return {
      create(){
        return {
          phase: Math.random() * TAU,
          time: 0,
          tail: 0,
          bob: 0,
          lunge: 0,
          bite: 0
        };
      },
      update(st, e, dt){
        const speed = Math.hypot(e?.vx || 0, e?.vy || 0);
        const moving = speed > 20;
        const cycle = moving ? 7.5 : 3.0;
        st.time += dt;
        st.phase = (st.phase + dt * cycle) % TAU;
        st.bob = Math.sin(st.phase) * (moving ? 3 : 1.5);
        st.tail = Math.sin(st.phase * (moving ? 3.5 : 2.1)) * (moving ? 0.8 : 0.4);
        if (moving) st.lunge += (0.6 - st.lunge) * Math.min(1, dt * 4);
        else st.lunge *= Math.max(0, 1 - dt * 5);
        if (st.bite > 0) st.bite = Math.max(0, st.bite - dt * 3);
      },
      draw(ctx, cam, e, st){
        const [cx, cy, sc] = toScreen(cam, e);
        const s = sc * 0.9;
        ctx.save();
        ctx.translate(cx, cy + st.bob * 0.4 * s);
        drawShadow(ctx, 10, s, 0.28, 0.22);
        ctx.translate(0, -6 * s);
        ctx.fillStyle = '#9c9182';
        ctx.beginPath();
        ctx.ellipse(-4 * s, 4 * s, 12 * s, 7 * s, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#b8aea0';
        ctx.beginPath();
        ctx.ellipse(4 * s, 5 * s, 9 * s, 6 * s, 0, 0, TAU);
        ctx.fill();
        ctx.save();
        ctx.strokeStyle = '#8a6151';
        ctx.lineWidth = 2.2 * s;
        ctx.beginPath();
        ctx.moveTo(-14 * s, 4 * s);
        ctx.quadraticCurveTo(-22 * s, 4 * s + st.tail * 8 * s, -28 * s, 10 * s);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#cfc4b6';
        ctx.beginPath();
        ctx.ellipse(12 * s + st.lunge * 2 * s, 2 * s, 6.8 * s, 5.4 * s, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#f3b1bb';
        ctx.beginPath();
        ctx.ellipse(15 * s, -1.6 * s, 2.6 * s, 2.6 * s, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#2a2a2a';
        ctx.beginPath();
        ctx.ellipse(9.8 * s, -0.5 * s, 1.2 * s, 1.6 * s, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    };
  }

  const ratRig = makeRatRig();
  API.registerRig('rat', ratRig);
  API.registerRig('enemy_rat', ratRig);

  const mosquitoRig = {
    create(){
      return {
        phase: Math.random() * TAU,
        time: 0,
        bob: 0,
        wing: 0,
        sting: 0,
        fall: 0
      };
    },
    update(st, e, dt){
      const speed = Math.hypot(e?.vx || 0, e?.vy || 0);
      st.time += dt;
      const hover = speed < 24;
      const wingSpeed = hover ? 22 : 28;
      st.phase = (st.phase + dt * wingSpeed) % TAU;
      st.wing = Math.sin(st.phase) * (hover ? 0.9 : 1.2);
      st.bob = Math.sin(st.time * (hover ? 6 : 8)) * (hover ? 4 : 2);
      if (hover) st.sting *= Math.max(0, 1 - dt * 3);
      else st.sting = Math.min(1.2, st.sting + dt * 4);
      if (e?.dead) st.fall = Math.min(1, st.fall + dt * 1.2);
      else st.fall = Math.max(0, st.fall - dt * 2);
    },
    draw(ctx, cam, e, st){
      const [cx, cy, sc] = toScreen(cam, e);
      const s = sc * 0.8;
      ctx.save();
      ctx.translate(cx, cy - 10 * s + st.bob * s - st.fall * 6 * s);
      drawShadow(ctx, 8, s, 0.28, 0.2);
      ctx.translate(0, -4 * s);
      ctx.rotate(st.sting * 0.1);
      ctx.globalAlpha = 0.3 + Math.abs(st.wing) * 0.4;
      ctx.fillStyle = '#d2f3ff';
      ctx.beginPath();
      ctx.ellipse(-4.5 * s, -6 * s, 5 * s * (1 + st.wing * 0.3), 11 * s, -0.45, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(4.5 * s, -6 * s, 5 * s * (1 - st.wing * 0.3), 11 * s, 0.45, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#646464';
      ctx.beginPath();
      ctx.ellipse(-3 * s, 0, 6 * s, 3.5 * s, 0.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath();
      ctx.ellipse(6 * s, -1.6 * s, 3 * s, 3.4 * s, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#2f2f2f';
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.moveTo(6 * s, -1 * s);
      ctx.lineTo(6 * s + 10 * s + st.sting * 5 * s, -1 * s + st.sting * 1.8 * s);
      ctx.stroke();
      ctx.restore();
    }
  };
  API.registerRig('mosquito', mosquitoRig);
  API.registerRig('enemy_mosquito', mosquitoRig);

  // ───────────────────────────── BOSS ───────────────────────────────
  registerBedRig('boss1_bed', {
    skin: 'boss_nivel1.png',
    spriteWidth: 48,
    spriteHeight: 54,
    amp: 2.6,
    speed: 1.2,
    shadowRadius: 18,
    offsetY: -8
  });

  registerBedRig('boss2_fainted', {
    skin: 'boss_nivel2.png',
    spriteWidth: 52,
    spriteHeight: 52,
    amp: 0.8,
    speed: 1.8,
    shadowRadius: 16,
    offsetY: -6,
    tint: { color: '#6fb5ff', alpha: 0.18 }
  });

  API.registerRig('boss3_pyro', {
    create(e){
      const data = e?.puppet?.data || {};
      return {
        phase: Math.random() * TAU,
        time: 0,
        skin: data.skin || e.skin || 'boss_nivel3.png',
        scale: (typeof data.scale === 'number') ? data.scale : 1,
        tint: parseTint(data.tint)
      };
    },
    update(st, e, dt){
      st.time += dt;
      st.phase = (st.phase + dt * 2.6) % TAU;
      st.pulse = 0.65 + 0.35 * Math.sin(st.phase * 1.7);
    },
    draw(ctx, cam, e, st){
      const [cx, cy, sc] = toScreen(cam, e);
      const total = sc * st.scale;
      const w = (e.w || 40) * total;
      const h = (e.h || 48) * total;
      ctx.save();
      ctx.translate(cx, cy);
      drawShadow(ctx, 15, total, 0.28, 0.24);
      ctx.translate(0, -h * 0.5 - 4 * total);
      drawSprite(ctx, st.skin, w, h, '#ffbca3', st.tint);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.35 * st.pulse;
      ctx.fillStyle = 'rgba(255,120,40,1)';
      ctx.beginPath();
      ctx.ellipse(0, h * 0.1, (w + 26 * total) * st.pulse, (h + 30 * total) * 0.6, 0, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }
  });

  // ───────────────────────────── INFRA ──────────────────────────────
  function doorProgress(e){
    const st = e?.state || {};
    if (typeof st.openProgress === 'number') return Math.max(0, Math.min(1, st.openProgress));
    if (typeof e.open === 'number') return Math.max(0, Math.min(1, e.open));
    return e.open ? 1 : 0;
  }

  API.registerRig('door', {
    create(){ return { }; },
    update(){},
    draw(ctx, cam, e){
      const [cx, cy, sc] = toScreen(cam, e);
      const w = (e.w || 32) * sc;
      const h = (e.h || 48) * sc;
      const progress = doorProgress(e);
      const closed = load('puerta_cerrada.png');
      const opened = load('puerta_abiertas.png');
      ctx.save();
      ctx.translate(cx - w * 0.5, cy - h * 0.5);
      if (hasImage(closed)){
        ctx.globalAlpha = 1 - progress;
        ctx.drawImage(closed, 0, 0, w, h);
      } else {
        logMissing('puerta_cerrada.png');
        ctx.fillStyle = '#5b4c3a';
        ctx.fillRect(0, 0, w, h);
      }
      if (hasImage(opened)){
        ctx.globalAlpha = progress;
        ctx.drawImage(opened, 0, 0, w, h);
      } else {
        logMissing('puerta_abiertas.png');
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  });

  API.registerRig('elevator', {
    create(){ return {}; },
    update(){},
    draw(ctx, cam, e){
      const [cx, cy, sc] = toScreen(cam, e);
      const w = (e.w || 48) * sc;
      const h = (e.h || 64) * sc;
      const progress = doorProgress(e);
      const closed = load('ascensor_cerrado.png');
      const opened = load('ascensor_abierto.png');
      ctx.save();
      ctx.translate(cx - w * 0.5, cy - h * 0.5);
      if (hasImage(closed)){
        ctx.globalAlpha = 1 - progress;
        ctx.drawImage(closed, 0, 0, w, h);
      } else {
        logMissing('ascensor_cerrado.png');
        ctx.fillStyle = '#8d9298';
        ctx.fillRect(0, 0, w, h);
      }
      if (hasImage(opened)){
        ctx.globalAlpha = progress;
        ctx.drawImage(opened, 0, 0, w, h);
      } else {
        logMissing('ascensor_abierto.png');
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  });

  // ───────────────────────────── CARROS ─────────────────────────────
  function registerCart(name, skin, cfg){
    const rig = {
      create(e){
        const data = e?.puppet?.data || {};
        return {
          phase: Math.random() * TAU,
          time: 0,
          skin: data.skin || e.skin || skin,
          scale: (typeof data.scale === 'number') ? data.scale : 1
        };
      },
      update(st, e, dt){
        st.time += dt;
        st.phase = (st.phase + dt * (cfg.wobbleSpeed ?? 6)) % TAU;
        st.wobble = Math.sin(st.phase + (e?.id?.length || 0)) * (cfg.wobbleAmp ?? 1.2);
      },
      draw(ctx, cam, e, st){
        const [cx, cy, sc] = toScreen(cam, e);
        const total = sc * st.scale;
        const w = (cfg.spriteWidth ?? (e.w || 40)) * total;
        const h = (cfg.spriteHeight ?? (e.h || 48)) * total;
        ctx.save();
        ctx.translate(cx, cy);
        drawShadow(ctx, cfg.shadowRadius ?? 14, total, 0.32, 0.22);
        ctx.translate(0, -h * 0.5 + (cfg.offsetY ?? 0) * total + st.wobble * total);
        drawSprite(ctx, st.skin || skin, w, h, '#c5c5c5');
        if (cfg.decor) cfg.decor(ctx, total, st);
        ctx.restore();
      }
    };
    API.registerRig(`cart_${name}`, rig);
    API.registerRig(`cart.${name}`, rig);
  }

  registerCart('emergency', 'carro_urgencias.png', {
    wobbleAmp: 0.8,
    wobbleSpeed: 8,
    decor(ctx, s, st){
      const pulse = 0.5 + 0.5 * Math.sin(st.time * 8);
      ctx.save();
      ctx.translate(0, -16 * s);
      ctx.fillStyle = `rgba(255,80,70,${0.5 + 0.4 * pulse})`;
      ctx.beginPath(); ctx.ellipse(-8 * s, 0, 5 * s, 3 * s, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(70,140,255,${0.6 + 0.4 * (1 - pulse)})`;
      ctx.beginPath(); ctx.ellipse(8 * s, 0, 5 * s, 3 * s, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  });

  registerCart('food', 'carro_comida.png', {
    wobbleAmp: 1.2,
    wobbleSpeed: 5,
    decor(ctx, s, st){
      ctx.save();
      ctx.translate(0, -12 * s);
      const jitter = Math.sin(st.time * 12) * 0.8 * s;
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(-10 * s, jitter, 20 * s, 3 * s);
      ctx.fillRect(-9 * s, -6 * s - jitter, 18 * s, 2.4 * s);
      ctx.restore();
    }
  });

  registerCart('meds', 'carro_medicinas.png', {
    wobbleAmp: 0.9,
    wobbleSpeed: 4.5,
    decor(ctx, s, st){
      const p = 0.5 + 0.5 * Math.sin(st.time * 6);
      ctx.save();
      ctx.translate(0, -14 * s);
      ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.4 * p})`;
      ctx.fillRect(-6 * s, -6 * s, 12 * s, 12 * s);
      ctx.fillStyle = `rgba(220,40,60,${0.6 + 0.3 * p})`;
      ctx.fillRect(-2 * s, -6 * s, 4 * s, 12 * s);
      ctx.fillRect(-6 * s, -2 * s, 12 * s, 4 * s);
      ctx.restore();
    }
  });

  // ───────────────────────────── HAZARDS ────────────────────────────
  API.registerRig('hazard_fire', {
    create(){ return { phase: Math.random() * TAU, time: 0 }; },
    update(st, e, dt){
      st.time += dt;
      st.phase = (st.phase + dt * 10) % TAU;
      st.pulse = 0.7 + 0.3 * Math.sin(st.phase + (e?.id?.length || 0));
    },
    draw(ctx, cam, e, st){
      const [cx, cy, sc] = toScreen(cam, e);
      const w = (e.w || 24) * sc;
      const h = (e.h || 32) * sc;
      ctx.save();
      ctx.translate(cx, cy + h * 0.2);
      drawShadow(ctx, 8, sc, 0.28, 0.2);
      ctx.translate(0, -h * 0.6);
      ctx.fillStyle = `rgba(255,180,60,${0.6 + 0.3 * st.pulse})`;
      ctx.beginPath();
      ctx.moveTo(0, -h * (0.6 + 0.1 * st.pulse));
      ctx.bezierCurveTo(w * 0.3, -h * 0.1, w * 0.25, h * 0.4, 0, h * 0.5);
      ctx.bezierCurveTo(-w * 0.25, h * 0.4, -w * 0.3, -h * 0.1, 0, -h * (0.6 + 0.1 * st.pulse));
      ctx.fill();
      ctx.restore();
    }
  });

  API.registerRig('hazard_water', {
    create(){ return { phase: Math.random() * TAU, time: 0 }; },
    update(st, e, dt){
      st.time += dt;
      st.phase = (st.phase + dt * 4) % TAU;
      st.ripple = 1 + 0.08 * Math.sin(st.phase + (e?.id?.length || 0));
    },
    draw(ctx, cam, e, st){
      const [cx, cy, sc] = toScreen(cam, e);
      const w = (e.w || 24) * sc;
      const h = (e.h || 24) * sc;
      ctx.save();
      ctx.translate(cx, cy);
      drawShadow(ctx, 7, sc, 0.22, 0.18);
      ctx.fillStyle = 'rgba(110,160,230,0.45)';
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.5 * st.ripple, h * 0.35 * st.ripple, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  });

  // ───────────────────────────── ÍTEMS ──────────────────────────────
  API.registerRig('pill', {
    create(e){
      const data = e?.puppet?.data || {};
      return {
        phase: Math.random() * TAU,
        skin: data.skin || e.skin || 'pastilla_generic.png',
        scale: (typeof data.scale === 'number') ? data.scale : 1,
        tint: parseTint(data.tint, 0.4)
      };
    },
    update(st, e, dt){
      st.phase = (st.phase + dt * 2.8) % TAU;
      st.bob = Math.sin(st.phase) * 6 * st.scale;
      st.spin = Math.sin(st.phase * 0.5) * 0.18;
    },
    draw(ctx, cam, e, st){
      const [cx, cy, sc] = toScreen(cam, e);
      const total = sc * st.scale;
      const w = (e.w || 16) * total;
      const h = (e.h || 16) * total;
      ctx.save();
      ctx.translate(cx, cy + st.bob * total * 0.2);
      ctx.rotate(st.spin);
      ctx.translate(0, -6 * total);
      drawSprite(ctx, st.skin, w, h, '#f4e4ba', st.tint);
      ctx.restore();
    }
  });

  API.registerRig('syringe', {
    create(e){
      const data = e?.puppet?.data || {};
      return {
        phase: Math.random() * TAU,
        skin: data.skin || e.skin || 'jeringa_roja.png',
        scale: (typeof data.scale === 'number') ? data.scale : 1,
        tint: parseTint(data.tint, 0.4)
      };
    },
    update(st, e, dt){
      st.phase = (st.phase + dt * 1.4) % TAU;
      st.swing = Math.sin(st.phase) * 0.25;
    },
    draw(ctx, cam, e, st){
      const [cx, cy, sc] = toScreen(cam, e);
      const total = sc * st.scale;
      const w = (e.w || 18) * total;
      const h = (e.h || 32) * total;
      ctx.save();
      ctx.translate(cx, cy - 10 * total);
      ctx.rotate(st.swing);
      drawSprite(ctx, st.skin, w, h, '#d3d8dd', st.tint);
      ctx.restore();
    }
  });

  API.registerRig('drip', {
    create(e){
      const data = e?.puppet?.data || {};
      return {
        phase: Math.random() * TAU,
        skin: data.skin || e.skin || 'gotero_azul.png',
        scale: (typeof data.scale === 'number') ? data.scale : 1,
        tint: parseTint(data.tint, 0.4)
      };
    },
    update(st, e, dt){
      st.phase = (st.phase + dt * 1.5) % TAU;
      st.swing = Math.sin(st.phase) * 0.12;
      st.drop = Math.abs(Math.sin(st.phase * 0.6)) * 12 * st.scale;
    },
    draw(ctx, cam, e, st){
      const [cx, cy, sc] = toScreen(cam, e);
      const total = sc * st.scale;
      const w = (e.w || 22) * total;
      const h = (e.h || 44) * total;
      ctx.save();
      ctx.translate(cx, cy - 12 * total);
      ctx.rotate(st.swing);
      drawSprite(ctx, st.skin, w, h, '#d7e4f6', st.tint);
      ctx.fillStyle = 'rgba(170,210,255,0.8)';
      ctx.beginPath();
      ctx.ellipse(0, st.drop, 3 * total, 4.5 * total, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  });

  API.registerRig('phone', {
    create(){ return { phase: Math.random() * TAU }; },
    update(st, e, dt){
      st.phase = (st.phase + dt * 12) % TAU;
      st.vib = Math.sin(st.phase) * 2.5;
      st.scale = 1 + Math.sin(st.phase * 0.5) * 0.05;
    },
    draw(ctx, cam, e, st){
      const [cx, cy, sc] = toScreen(cam, e);
      const total = sc * st.scale;
      const w = (e.w || 20) * total;
      const h = (e.h || 30) * total;
      const img = load('telefono.png');
      ctx.save();
      ctx.translate(cx + st.vib * total, cy - 8 * total);
      if (hasImage(img)){
        ctx.drawImage(img, -w * 0.5, -h * 0.5, w, h);
      } else {
        logMissing('telefono.png');
        ctx.fillStyle = '#2c2f48';
        ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
      }
      ctx.restore();
    }
  });

  API.registerRig('light', {
    create(e){
      const data = e?.puppet?.data || {};
      return {
        radius: data.radius ?? 48,
        intensity: data.intensity ?? 0.6,
        broken: !!data.broken,
        phase: Math.random() * TAU
      };
    },
    update(st, e, dt){
      st.phase = (st.phase + dt * 4) % TAU;
      st.flick = st.broken ? (0.3 + 0.7 * Math.max(0, Math.sin(st.phase * 8))) : 1;
    },
    draw(ctx, cam, e, st){
      const [cx, cy, sc] = toScreen(cam, e);
      const radius = st.radius * sc;
      ctx.save();
      ctx.translate(cx, cy);
      const grad = ctx.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius);
      grad.addColorStop(0, `rgba(255,255,210,${0.45 * st.intensity * st.flick})`);
      grad.addColorStop(1, 'rgba(255,255,210,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.fill();
      ctx.restore();
    }
  });

  function registerSpawnerRig(type, skin){
    API.registerRig(`spawner_${type}`, {
      create(){ return { phase: Math.random() * TAU }; },
      update(st, e, dt){
        st.phase = (st.phase + dt * 3) % TAU;
        st.pulse = 0.65 + 0.35 * Math.sin(st.phase + (e?.id?.length || 0));
      },
      draw(ctx, cam, e, st){
        const [cx, cy, sc] = toScreen(cam, e);
        const w = (e.w || 28) * sc;
        const h = (e.h || 28) * sc;
        ctx.save();
        ctx.translate(cx, cy);
        drawShadow(ctx, 9, sc, 0.3, 0.18);
        ctx.translate(0, -h * 0.5);
        drawSprite(ctx, skin, w * st.pulse, h * st.pulse, '#94b7ff');
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = 'rgba(130,190,255,0.7)';
        ctx.lineWidth = 2 * sc;
        ctx.beginPath();
        ctx.arc(0, h * 0.5, w * 0.35 * st.pulse, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  registerSpawnerRig('enemy', 'spawner_enemigos.png');
  registerSpawnerRig('npc', 'spawner_npc.png');
  registerSpawnerRig('cart', 'spawner_carros.png');
})();
