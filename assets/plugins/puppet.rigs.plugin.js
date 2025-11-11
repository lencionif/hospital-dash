(function(){
  const API = window.PuppetAPI; if (!API) return;

  const TAU = Math.PI * 2;
  const Cache = Object.create(null);
  const Missing = new Set();

  const IMG_PATH = (name) => `./assets/images/${name}`;
  const PNG_EXT = /\.(png|jpg|jpeg|gif)$/i;

  function normalizeSkinAsset(value){
    if (!value) return value;
    if (typeof value === 'string'){
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (PNG_EXT.test(trimmed)) return trimmed;
      return `${trimmed}.png`;
    }
    if (Array.isArray(value)) return value.map(normalizeSkinAsset);
    if (typeof value === 'object'){
      const out = {};
      for (const key of Object.keys(value)) out[key] = normalizeSkinAsset(value[key]);
      return out;
    }
    return value;
  }

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
    if (!name || Missing.has(name)) return false;
    Missing.add(name);
    return false;
  }

  function drawSilhouette(ctx, w, h, color){
    ctx.save();
    ctx.fillStyle = color || '#455264';
    const headH = h * 0.32;
    ctx.beginPath();
    ctx.ellipse(0, -h * 0.28, w * 0.28, headH * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-w * 0.22, -h * 0.08);
    ctx.quadraticCurveTo(0, headH * 0.25, w * 0.22, -h * 0.08);
    ctx.lineTo(w * 0.28, h * 0.26);
    ctx.quadraticCurveTo(0, h * 0.42, -w * 0.28, h * 0.26);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, h * 0.38, w * 0.22, h * 0.18, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
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
    const normalizedSkin = typeof skin === 'string' ? normalizeSkinAsset(skin) : skin;
    const img = (typeof normalizedSkin === 'string') ? load(normalizedSkin) : null;
    if (img && hasImage(img)){
      ctx.drawImage(img, -w * 0.5, -h * 0.5, w, h);
    } else {
      if (typeof normalizedSkin === 'string') logMissing(normalizedSkin);
      drawSilhouette(ctx, w, h, fallbackColor || '#566074');
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

  function normalizeStateResult(res){
    if (!res) return null;
    if (typeof res === 'string') return { state: res };
    if (typeof res === 'object') return { ...res };
    return null;
  }

  function resolveOrientation(e, st, cfg){
    const vx = e?.vx ?? e?.dirX ?? 0;
    const vy = e?.vy ?? e?.dirY ?? 0;
    const bias = cfg?.orientationBias ?? 0.72;
    const threshold = cfg?.orientationThreshold ?? 8;
    let orientation = st.orientation || 'down';
    const speed = Math.hypot(vx, vy);
    if (speed > threshold){
      if (Math.abs(vx) > Math.abs(vy) * bias){
        orientation = 'side';
        if (Math.abs(vx) > 0.5) st.dir = vx < 0 ? -1 : 1;
      } else {
        orientation = vy < 0 ? 'up' : 'down';
      }
    } else if (typeof e?.lookAngle === 'number' || typeof e?.facingAngle === 'number'){
      const ang = (typeof e.lookAngle === 'number') ? e.lookAngle : e.facingAngle;
      const norm = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (norm > Math.PI * 0.25 && norm < Math.PI * 0.75) orientation = 'down';
      else if (norm > Math.PI * 1.25 && norm < Math.PI * 1.75) orientation = 'up';
      else {
        orientation = 'side';
        st.dir = (norm <= Math.PI * 0.25 || norm >= Math.PI * 1.75) ? 1 : -1;
      }
    } else if (typeof e?.facing === 'string'){
      const f = e.facing.toUpperCase();
      if (f.startsWith('N') || f === 'UP') orientation = 'up';
      else if (f.startsWith('S') || f === 'DOWN') orientation = 'down';
      else if (f.startsWith('W')) { orientation = 'side'; st.dir = -1; }
      else if (f.startsWith('E')) { orientation = 'side'; st.dir = 1; }
    }
    st.orientation = orientation;
    return orientation;
  }

  function pickStateInfo(cfg, st){
    const states = cfg?.states || null;
    if (!states) return null;
    const ori = st.orientation || 'down';
    let key = st.state || cfg.initialState || 'idle';
    let info = states[key];
    if (!info && ori){
      info = states[`${key}_${ori}`] || states[`${key}${ori[0].toUpperCase() + ori.slice(1)}`];
    }
    if (!info && states.default) info = states.default;
    return info || null;
  }

  function baseWalkerState(e, cfg){
    const data = e?.puppet?.data || {};
    const tint = parseTint(data.tint || cfg.tint);
    const scale = (typeof data.scale === 'number' ? data.scale : (cfg.scale ?? 1));
    const skin = normalizeSkinAsset(data.skin || e.skin || cfg.skin);
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
      skin,
      state: cfg.initialState || 'idle',
      stateTime: 0,
      orientation: 'down',
      stateTint: null,
      stateScale: 1,
      stateBob: 1,
      stateSkin: null,
      stateFlip: null
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
    st.moving = moving;
    st.speed = speed;
    st.stateTint = null;
    st.stateScale = 1;
    st.stateBob = 1;
    st.stateSkin = null;
    st.stateFlip = null;
    if (cfg.extraUpdate) cfg.extraUpdate(st, e, dt, speed, moving);
    if (cfg.faceFromVelocity !== false){
      if (Math.abs(vx) > 2) st.dir = vx < 0 ? -1 : 1;
      else if (e?.dirX) st.dir = e.dirX < 0 ? -1 : 1;
    }
    const orientation = resolveOrientation(e, st, cfg);
    let desired = st.state || cfg.initialState || 'idle';
    const result = normalizeStateResult(cfg.resolveState ? cfg.resolveState(st, e, dt, { speed, moving, orientation }) : null);
    if (result){
      if (result.orientation) st.orientation = result.orientation;
      if (typeof result.dir === 'number') st.dir = result.dir < 0 ? -1 : 1;
      if (result.tint) st.stateTint = parseTint(result.tint, result.tintAlpha ?? cfg.tintAlpha ?? 0.35);
      if (result.scale != null) st.stateScale = result.scale;
      if (result.bobMul != null) st.stateBob = result.bobMul;
      if (result.skin) st.stateSkin = result.skin;
      if (result.flip != null) st.stateFlip = result.flip;
      if (result.state) desired = result.state;
    } else if (cfg.states){
      if (moving){
        if (st.orientation === 'up') desired = 'walk_up';
        else if (st.orientation === 'side') desired = 'walk_side';
        else desired = 'walk_down';
      } else {
        desired = 'idle';
      }
    }
    if (cfg.stateFallback) {
      const alt = cfg.stateFallback(st, desired, e);
      if (alt) desired = alt;
    }
    if (desired !== st.state){
      st.state = desired;
      st.stateTime = 0;
      if (cfg.onStateChange) cfg.onStateChange(st, e, desired);
    } else {
      st.stateTime += dt;
    }
  }

  function drawWalker(ctx, cam, e, st, cfg){
    const [cx, cy, sc] = toScreen(cam, e);
    const stateInfo = pickStateInfo(cfg, st) || {};
    const scaleMul = (stateInfo.scale ?? 1) * (st.stateScale ?? 1);
    const baseW = stateInfo.spriteWidth ?? cfg.spriteWidth ?? (e.w || 32);
    const baseH = stateInfo.spriteHeight ?? cfg.spriteHeight ?? (e.h || 48);
    const totalScale = sc * (cfg.spriteScale ?? 1) * st.scale * scaleMul;
    const w = baseW * totalScale;
    const h = baseH * totalScale;
    const bobMul = (stateInfo.bobMul ?? 1) * (st.stateBob ?? 1);
    const offsetY = ((cfg.offsetY ?? 0) + (stateInfo.offsetY ?? 0)) * totalScale;
    const tint = stateInfo.tint ? parseTint(stateInfo.tint, stateInfo.tintAlpha ?? cfg.tintAlpha ?? 0.35)
                                : (st.stateTint || st.tint);
    let skin = st.stateSkin || stateInfo.skin || st.skin || cfg.skin;
    if (skin && typeof skin === 'object' && !Array.isArray(skin)){
      const ori = st.orientation || 'down';
      skin = skin[ori] || skin[`${ori}_${st.dir < 0 ? 'left' : 'right'}`] || skin.default || skin.down || skin.side || st.skin || cfg.skin;
    }
    skin = normalizeSkinAsset(skin);
    const flipOverride = (st.stateFlip != null) ? st.stateFlip : stateInfo.flip;
    const shadowRadius = stateInfo.shadowRadius ?? cfg.shadowRadius ?? (Math.max(baseW, baseH) * 0.18);
    const shadowFlattenBase = stateInfo.shadowFlatten ?? cfg.shadowFlatten ?? 0.32;
    const shadowAlphaBase = stateInfo.shadowAlpha ?? cfg.shadowAlpha ?? 0.22;
    const isRagdoll = stateInfo.ragdoll === true || !!(e && (e.ragdolling || e.ragdoll || (e._ragdollTimer > 0)));
    const ragAngle = isRagdoll ? (e?._ragdollAngle || 0) : 0;
    const allowLean = (stateInfo.applyLean != null) ? !!stateInfo.applyLean : (cfg.applyLean !== false);
    const shadowFlatten = isRagdoll
      ? (stateInfo.ragdollShadowFlatten ?? Math.min(0.22, shadowFlattenBase * 0.55))
      : shadowFlattenBase;
    const shadowAlpha = isRagdoll
      ? (stateInfo.ragdollShadowAlpha ?? Math.min(0.5, shadowAlphaBase + 0.12))
      : shadowAlphaBase;
    ctx.save();
    ctx.translate(cx, cy);
    drawShadow(ctx, shadowRadius, totalScale, shadowFlatten, shadowAlpha);
    if (isRagdoll){
      const ragOffset = (stateInfo.ragdollOffsetY ?? (h * 0.25)) * (stateInfo.ragdollScaleY ?? 0.6);
      ctx.translate(0, ragOffset);
      ctx.rotate(ragAngle);
      ctx.translate(0, -h * 0.45);
    } else {
      ctx.translate(0, -h * 0.5 + offsetY + st.bob * bobMul + (cfg.hover ?? 0));
      if (allowLean){
        ctx.rotate((st.lean || 0) + (st.erratic || 0) + (st.micro || 0) + (stateInfo.lean || 0));
      }
      ctx.translate((st.sway + (st.hip || 0)) * (stateInfo.swayMul ?? 1), stateInfo.offsetX ?? 0);
    }
    const flip = flipOverride != null ? !!flipOverride : (st.dir < 0);
    const scaleY = isRagdoll ? (stateInfo.ragdollScaleY ?? 0.62) : 1;
    ctx.scale(flip ? -1 : 1, scaleY);
    drawSprite(ctx, skin, w, h, cfg.fallbackColor || stateInfo.fallbackColor || '#bcbec7', tint);
    if (cfg.overlay) cfg.overlay(ctx, totalScale, st, e);
    if (stateInfo.overlay) stateInfo.overlay(ctx, totalScale, st, e);
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

  function resolveHeroState(st, e){
    let orientation = st.orientation || 'down';
    const pushing = e?.pushing === true || (typeof e?.pushAnimT === 'number' && e.pushAnimT > 0.05) || e?.state === 'pushing';
    const attacking = (e?.attackTimer || 0) > 0 || e?.isAttacking === true;
    const hurt = (e?.invuln || 0) > 0 && (Date.now() - (e?._lastHitAt || 0) < 1200);
    if (hurt) return { state: 'hurt', orientation, bobMul: 0.35 };
    if (e?.isTalking) return { state: 'talk', orientation };
    if (attacking) return { state: 'attack', orientation, bobMul: 0.5 };
    if (pushing && (st.moving || (e?.pushAnimT || 0) > 0.01)){
      if (orientation === 'up') orientation = 'down';
      return { state: 'push', orientation, bobMul: 0.45 };
    }
    if (st.moving){
      if (orientation === 'up') return 'walk_up';
      if (orientation === 'side') return { state: 'walk_side', dir: st.dir, orientation };
      return 'walk_down';
    }
    return { state: 'idle', orientation, bobMul: 0.7 };
  }

  function makeHeroStates(front, back){
    const frontSkin = normalizeSkinAsset(front) || normalizeSkinAsset(back);
    const backSkin = normalizeSkinAsset(back) || frontSkin;
    return {
      idle: {
        skin: { down: frontSkin, up: backSkin, side: frontSkin },
        bobMul: 0.7
      },
      walk_down: {
        skin: frontSkin,
        bobMul: 1.0
      },
      walk_up: {
        skin: backSkin,
        bobMul: 0.9
      },
      walk_side: {
        skin: frontSkin,
        bobMul: 1.05
      },
      push: {
        skin: { down: frontSkin, up: backSkin, side: frontSkin },
        bobMul: 0.4,
        offsetY: -2
      },
      attack: {
        skin: frontSkin,
        tint: { color: 'rgba(255,214,120,1)', alpha: 0.24 },
        bobMul: 0.55
      },
        talk: {
          skin: { down: frontSkin, up: backSkin, side: frontSkin },
          bobMul: 0.5,
          tint: { color: 'rgba(230,240,255,1)', alpha: 0.18 }
        },
        hurt: {
          skin: { down: frontSkin, up: backSkin, side: frontSkin },
          bobMul: 0.35,
          tint: { color: 'rgba(255,120,120,1)', alpha: 0.35 }
        }
      };
  }

  function makeNPCStates(front, back){
    const frontSkin = normalizeSkinAsset(front) || normalizeSkinAsset(back);
    const backSkin = normalizeSkinAsset(back) || frontSkin;
    return {
      idle: { skin: { down: frontSkin, up: backSkin, side: frontSkin }, bobMul: 0.75 },
      walk_down: { skin: frontSkin, bobMul: 0.95 },
      walk_up: { skin: backSkin, bobMul: 0.9 },
      walk_side: { skin: frontSkin, bobMul: 1.0 },
      talk: { skin: { down: frontSkin, up: backSkin, side: frontSkin }, bobMul: 0.5, tint: { color: 'rgba(240,250,255,1)', alpha: 0.18 } },
      push: { skin: { down: frontSkin, up: backSkin, side: frontSkin }, bobMul: 0.42, tint: { color: 'rgba(180,255,220,1)', alpha: 0.12 } },
      hurt: { skin: { down: frontSkin, up: backSkin, side: frontSkin }, bobMul: 0.4, tint: { color: 'rgba(255,120,120,1)', alpha: 0.3 } },
      ragdoll: {
        skin: { down: frontSkin, up: frontSkin, side: frontSkin },
        bobMul: 0,
        ragdoll: true,
        offsetY: 18,
        ragdollOffsetY: 22,
        ragdollScaleY: 0.6,
        shadowFlatten: 0.2,
        shadowAlpha: 0.34,
        applyLean: false,
        tint: { color: 'rgba(255,255,255,1)', alpha: 0.12 }
      }
    };
  }

  function resolveNPCState(st, e){
    const orientation = st.orientation || 'down';
    if ((e?._ragdollTimer || 0) > 0 || e?.ragdolling || e?.ragdoll) {
      return { state: 'ragdoll', orientation, applyLean: false };
    }
    if ((e?.invuln || 0) > 0 && (Date.now() - (e?._lastHitAt || 0) < 1200)) {
      return { state: 'hurt', orientation };
    }
    if (e?.isTalking) return { state: 'talk', orientation };
    if (st.moving){
      if (orientation === 'up') return 'walk_up';
      if (orientation === 'side') return { state: 'walk_side', dir: st.dir };
      return 'walk_down';
    }
    return { state: 'idle', orientation };
  }

  const HERO_ANIM_SPEED = 1.35;
  const HERO_RIGS = {
    enrique: {
      front: 'enrique',
      back: 'enrique_back',
      scale: 1.08,
      spriteWidth: 42,
      spriteHeight: 66,
      spriteScale: 1.05,
      walkCycle: 11.1,
      idleCycle: 3.3,
      walkBob: 4.6,
      idleBob: 1.9,
      swayFreq: 1.1,
      swayAmp: 0.6,
      lean: 0.18,
      shadowRadius: 15,
      offsetY: -8
    },
    roberto: {
      front: 'roberto',
      back: 'roberto_back',
      scale: 1.0,
      spriteWidth: 40,
      spriteHeight: 64,
      spriteScale: 1.0,
      walkCycle: 13.2,
      idleCycle: 3.2,
      walkBob: 3.5,
      idleBob: 1.4,
      swayFreq: 1.8,
      swayAmp: 1.1,
      lean: 0.12,
      shadowRadius: 14,
      offsetY: -6
    },
    francesco: {
      front: 'francesco',
      back: 'francesco_back',
      scale: 1.02,
      spriteWidth: 40,
      spriteHeight: 66,
      spriteScale: 1.02,
      walkCycle: 11.6,
      idleCycle: 3.1,
      walkBob: 3.9,
      idleBob: 1.6,
      swayFreq: 1.5,
      swayAmp: 0.85,
      lean: 0.14,
      shadowRadius: 14,
      offsetY: -7
    }
  };

  for (const [hero, cfg] of Object.entries(HERO_RIGS)){
    const { front, back, walkCycle, idleCycle, ...rest } = cfg;
    registerWalkerRig(`hero_${hero}`, {
      ...rest,
      skin: normalizeSkinAsset(front),
      walkCycle: (walkCycle ?? 9) * HERO_ANIM_SPEED,
      idleCycle: (idleCycle ?? 3) * HERO_ANIM_SPEED,
      states: makeHeroStates(front, back),
      resolveState: resolveHeroState
    });
  }

  // ───────────────────────────── NPCs ──────────────────────────────
  registerWalkerRig('npc_celador', {
    skin: 'celador.png',
    walkCycle: 5.4,
    walkBob: 2.6,
    idleBob: 1.0,
    swayAmp: 0.4,
    lean: 0.05,
    shadowRadius: 12,
    offsetY: -5,
    states: Object.assign(makeNPCStates('celador.png'), {
      push: { skin: { down: 'celador.png', side: 'celador.png' }, bobMul: 0.45, tint: { color: 'rgba(120,255,210,1)', alpha: 0.16 } }
    }),
    resolveState(st, e){
      if (e?.mode === 'PUSH') return { state: 'push', orientation: st.orientation === 'up' ? 'down' : st.orientation };
      return resolveNPCState(st, e);
    }
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
    offsetY: -4,
    states: makeNPCStates('chica_limpieza.png'),
    resolveState: resolveNPCState
  });

  registerWalkerRig('npc_guardia', {
    skin: 'guardia.png',
    walkCycle: 6.0,
    walkBob: 2.2,
    idleBob: 0.9,
    swayAmp: 0.4,
    lean: 0.06,
    shadowRadius: 13,
    offsetY: -5,
    states: makeNPCStates('guardia.png'),
    resolveState: resolveNPCState
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
    offsetY: -4,
    states: makeNPCStates('medico.png'),
    resolveState: resolveNPCState
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
    offsetY: -4,
    states: makeNPCStates('supervisora.png'),
    resolveState: resolveNPCState
  });

  registerWalkerRig('npc_tcae', {
    skin: 'TCAE.png',
    walkCycle: 6.3,
    walkBob: 2.7,
    idleBob: 1.1,
    swayAmp: 0.6,
    lean: 0.06,
    shadowRadius: 12,
    offsetY: -4,
    states: makeNPCStates('TCAE.png'),
    resolveState: resolveNPCState
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
    offsetY: -6,
    states: makeNPCStates('jefe_servicio.png'),
    resolveState: resolveNPCState
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
    offsetY: -4,
    states: makeNPCStates('enfermera_sexy.png'),
    resolveState: resolveNPCState
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
    offsetY: -5,
    states: makeNPCStates('familiar_molesto.png'),
    resolveState: resolveNPCState
  });

  // ───────────────────────────── PACIENTES ──────────────────────────
  function registerBedRig(id, cfg){
    API.registerRig(id, {
      create(e){
        const data = e?.puppet?.data || {};
        const skin = normalizeSkinAsset(data.skin || e.skin || cfg.skin);
        const tint = parseTint(data.tint || cfg.tint, cfg.tintAlpha ?? 0.45);
        return {
          phase: Math.random() * TAU,
          time: 0,
          skin,
          tint,
          scale: (typeof data.scale === 'number') ? data.scale : (cfg.scale ?? 1),
          state: 'idle_bed',
          rawState: 'idle_bed',
          stateTime: 0,
          fade: 0
        };
      },
      update(st, e, dt){
        st.time += dt;
        st.phase = (st.phase + dt * (cfg.speed ?? 1.4)) % TAU;
        st.offset = Math.sin(st.phase) * (cfg.amp ?? 2) * st.scale;
        const attended = !!(e?.attended || e?.delivered || e?.dead || e?.hidden);
        const ringing = !!e?.ringing;
        let next = 'idle_bed';
        if (attended) next = 'disappear_on_cure';
        else if (ringing) next = 'pain';
        if (cfg.stateMap) {
          st.rawState = next;
          next = cfg.stateMap[next] || next;
        } else {
          st.rawState = next;
        }
        if (next !== st.state){
          st.state = next;
          st.stateTime = 0;
        } else {
          st.stateTime += dt;
        }
        if ((st.rawState || st.state) === 'disappear_on_cure'){
          const fadeDur = cfg.disappearMs ? cfg.disappearMs / 1000 : 0.65;
          st.fade = Math.min(1, st.fade + dt / Math.max(0.01, fadeDur));
        } else {
          st.fade = Math.max(0, st.fade - dt * 0.8);
        }
      },
      draw(ctx, cam, e, st){
        const [cx, cy, sc] = toScreen(cam, e);
        const stateInfo = cfg.states ? (cfg.states[st.state] || cfg.states.default) : null;
        const baseW = stateInfo?.spriteWidth ?? cfg.spriteWidth ?? (e.w || 32);
        const baseH = stateInfo?.spriteHeight ?? cfg.spriteHeight ?? (e.h || 48);
        const scaleMul = stateInfo?.scale ?? 1;
        const totalScale = sc * st.scale * scaleMul;
        const w = baseW * totalScale;
        const h = baseH * totalScale;
        ctx.save();
        ctx.translate(cx, cy);
        const fade = Math.max(0, Math.min(1, st.fade || 0));
        const shadowRadius = stateInfo?.shadowRadius ?? cfg.shadowRadius ?? (Math.max(baseW, baseH) * 0.35);
        const shadowFlatten = stateInfo?.shadowFlatten ?? cfg.shadowFlatten ?? 0.28;
        const shadowAlpha = (stateInfo?.shadowAlpha ?? cfg.shadowAlpha ?? 0.25) * (1 - fade * 0.7);
        drawShadow(ctx, shadowRadius, totalScale, shadowFlatten, shadowAlpha);
        const offsetY = ((cfg.offsetY ?? 0) + (stateInfo?.offsetY ?? 0)) * totalScale + st.offset;
        ctx.translate(0, -h * 0.5 + offsetY);
        const baseTint = st.tint;
        let tint = baseTint;
        const raw = st.rawState || st.state;
        if (raw === 'pain'){
          tint = parseTint({ color: 'rgba(255,120,120,1)', alpha: 0.35 });
        } else if (stateInfo?.tint) {
          tint = parseTint(stateInfo.tint, stateInfo.tintAlpha ?? 0.35);
        }
        const skin = stateInfo?.skin || st.skin || cfg.skin;
        ctx.globalAlpha = 1 - fade;
        drawSprite(ctx, skin, w, h, stateInfo?.fallbackColor || cfg.fallbackColor || '#d8d0c8', tint);
        ctx.restore();
        if (raw === 'pain' && fade < 0.95){
          ctx.save();
          ctx.translate(cx, cy - h * 0.6);
          ctx.globalAlpha = 0.4 + 0.4 * Math.sin(st.time * 8);
          ctx.fillStyle = 'rgba(255,80,80,1)';
          ctx.beginPath();
          ctx.ellipse(0, 0, w * 0.25, h * 0.18, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
        if (fade >= 0.99){
          try { e.rigOk = true; e._disappeared = true; } catch (_) {}
        }
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
    offsetY: -5,
    states: {
      idle: { skin: { down: 'paciente_furiosa.png', up: 'paciente_furiosa.png', side: 'paciente_furiosa.png' }, bobMul: 0.9 },
      walk_down: { skin: 'paciente_furiosa.png', bobMul: 1.1 },
      walk_up: { skin: 'paciente_furiosa.png', bobMul: 1.05 },
      walk_side: { skin: 'paciente_furiosa.png', bobMul: 1.2 },
      attack: { skin: 'paciente_furiosa.png', tint: { color: 'rgba(255,80,80,1)', alpha: 0.32 }, bobMul: 1.3 },
      hurt: { skin: 'paciente_furiosa.png', tint: { color: 'rgba(255,200,200,1)', alpha: 0.28 }, bobMul: 0.4 },
      down: { skin: 'paciente_furiosa.png', tint: { color: 'rgba(40,20,20,1)', alpha: 0.55 }, scale: 0.9, shadowAlpha: 0.12, bobMul: 0 }
    },
    resolveState(st, e){
      if (e?.dead) return { state: 'down', orientation: 'down', bobMul: 0 };
      const cd = e?.touchCD || 0;
      if (cd > 0.45) return { state: 'attack', orientation: st.orientation };
      if (cd > 0.05) return { state: 'hurt', orientation: st.orientation };
      if (st.moving){
        if (st.orientation === 'up') return 'walk_up';
        if (st.orientation === 'side') return { state: 'walk_side', dir: st.dir };
        return 'walk_down';
      }
      return { state: 'idle', orientation: st.orientation };
    }
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
    offsetY: -8,
    stateMap: { idle_bed: 'bed_idle', pain: 'bed_alert', disappear_on_cure: 'disappear_on_cure' },
    states: {
      bed_idle: { tint: { color: 'rgba(255,245,235,1)', alpha: 0.18 } },
      bed_alert: { tint: { color: 'rgba(255,120,120,1)', alpha: 0.32 }, offsetY: -2 },
      disappear_on_cure: { tint: { color: 'rgba(210,255,220,1)', alpha: 0.28 } }
    }
  });

  registerBedRig('boss2_fainted', {
    skin: 'boss_nivel2.png',
    spriteWidth: 52,
    spriteHeight: 52,
    amp: 0.8,
    speed: 1.8,
    shadowRadius: 16,
    offsetY: -6,
    tint: { color: '#6fb5ff', alpha: 0.18 },
    stateMap: { idle_bed: 'fainted_floor', pain: 'recover', disappear_on_cure: 'recover' },
    states: {
      fainted_floor: { tint: { color: 'rgba(111,181,255,1)', alpha: 0.22 }, offsetY: -3 },
      recover: { tint: { color: 'rgba(255,214,102,1)', alpha: 0.24 }, offsetY: -4, scale: 1.02 }
    }
  });

  registerWalkerRig('boss3_pyro', {
    skin: 'boss_nivel3.png',
    scale: 1.08,
    spriteWidth: 40,
    spriteHeight: 64,
    walkCycle: 9.6,
    idleCycle: 2.8,
    walkBob: 3.4,
    idleBob: 1.2,
    swayAmp: 0.9,
    lean: 0.08,
    offsetY: -6,
    shadowRadius: 15,
    tint: { color: 'rgba(255,130,90,1)', alpha: 0.16 },
    states: {
      idle: { skin: { down: 'boss_nivel3.png', up: 'boss_nivel3.png', side: 'boss_nivel3.png' }, bobMul: 0.85 },
      walk_down: { skin: 'boss_nivel3.png', bobMul: 1.12 },
      walk_up: { skin: 'boss_nivel3.png', bobMul: 1.05 },
      walk_side: { skin: 'boss_nivel3.png', bobMul: 1.15 },
      ignite: { skin: 'boss_nivel3.png', tint: { color: 'rgba(255,150,70,1)', alpha: 0.36 }, bobMul: 0.25, scale: 1.05 },
      attack: { skin: 'boss_nivel3.png', tint: { color: 'rgba(255,210,140,1)', alpha: 0.28 }, bobMul: 0.32 }
    },
    resolveState(st, e, dt){
      const ignite = Math.max(0, e?._igniteTimer || 0);
      if (ignite > 0){
        const state = ignite > 0.35 ? 'ignite' : 'attack';
        return { state, orientation: st.orientation };
      }
      if (st.moving){
        if (st.orientation === 'up') return 'walk_up';
        if (st.orientation === 'side') return { state: 'walk_side', dir: st.dir };
        return 'walk_down';
      }
      return { state: 'idle', orientation: st.orientation };
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
    const defaultSkin = normalizeSkinAsset(skin);
    const rig = {
      create(e){
        const data = e?.puppet?.data || {};
        return {
          phase: Math.random() * TAU,
          time: 0,
          skin: normalizeSkinAsset(data.skin || e.skin || defaultSkin),
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
        drawSprite(ctx, st.skin || defaultSkin, w, h, '#c5c5c5');
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
        skin: normalizeSkinAsset(data.skin || e.skin || 'pastilla_generic'),
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
        skin: normalizeSkinAsset(data.skin || e.skin || 'jeringa_roja'),
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
        skin: normalizeSkinAsset(data.skin || e.skin || 'gotero_azul'),
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
    const defaultSkin = normalizeSkinAsset(skin);
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
        drawSprite(ctx, defaultSkin, w * st.pulse, h * st.pulse, '#94b7ff');
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
