(function(){
  const API = window.PuppetAPI; if (!API) return;

  const TAU = Math.PI * 2;
  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const clamp255 = (v) => Math.max(0, Math.min(255, Number.isFinite(v) ? v | 0 : 0));
  function safeAlpha(a, def = 1) {
    return Number.isFinite(a) ? clamp01(a) : def;
  }
  function safeRGBA(r, g, b, a) {
    return `rgba(${clamp255(r)},${clamp255(g)},${clamp255(b)},${safeAlpha(a)})`;
  }
  function safeColorStop(grad, stop, color) {
    if (!grad) return;
    try {
      grad.addColorStop(clamp01(stop), color);
    } catch (_) {
      // ignore invalid stop
    }
  }
  function safeEllipse(ctx, cx, cy, rx, ry, rot = 0, start = 0, end = TAU) {
    if (!ctx) return false;
    rx = Math.abs(Number(rx));
    ry = Math.abs(Number(ry));
    if (!(rx > 0) || !(ry > 0)) return false;
    try {
      ctx.ellipse(cx, cy, rx, ry, rot, start, end);
      return true;
    } catch (_) {
      return false;
    }
  }
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
    if (safeEllipse(ctx, 0, -h * 0.28, w * 0.28, headH * 0.5, 0, 0, TAU)) ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-w * 0.22, -h * 0.08);
    ctx.quadraticCurveTo(0, headH * 0.25, w * 0.22, -h * 0.08);
    ctx.lineTo(w * 0.28, h * 0.26);
    ctx.quadraticCurveTo(0, h * 0.42, -w * 0.28, h * 0.26);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    if (safeEllipse(ctx, 0, h * 0.38, w * 0.22, h * 0.18, 0, 0, TAU)) ctx.fill();
    ctx.restore();
  }

  const BASE_TILE_UNITS = 32;

  function getTileSizePx(){
    return window.G?.TILE_SIZE || window.TILE_SIZE || window.TILE || BASE_TILE_UNITS;
  }

  function oneTileScale(opts = {}){
    const design = Math.max(4, Number(opts.designSize || opts.design || BASE_TILE_UNITS));
    const inner = clamp01(typeof opts.inner === 'number' ? opts.inner : 0.92);
    const tile = getTileSizePx();
    return (tile * inner) / design;
  }

  function applyOneTileScale(sc, opts = {}){
    const base = Number.isFinite(sc) ? sc : 1;
    return base * oneTileScale(opts);
  }

  function toScreen(_cam, e){
    const tile = window.G?.TILE_SIZE || window.TILE_SIZE || window.TILE || 32;
    const w = Number(e?.w);
    const h = Number(e?.h);
    const width = Number.isFinite(w) && w > 0 ? w : tile;
    const height = Number.isFinite(h) && h > 0 ? h : tile;
    const cx = (Number(e?.x) || 0) + width * 0.5;
    const cy = (Number(e?.y) || 0) + height * 0.5;
    const scale = (e?.puppet?.scale ?? 1) * (e?.puppet?.zscale ?? 1) * (e?.scale ?? 1);
    return [cx, cy, scale];
  }

  const nowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now());

  function isEntityCulled(e){
    if (!e) return false;
    if (e.hidden || e.disabled || e.skipRender || e.ignoreRender) return true;
    const flags = ['culled', '_culled', 'isCulled', '__culled', 'renderCull', 'offscreen'];
    for (const key of flags){
      if (e[key] === true) return true;
    }
    if (typeof e.alpha === 'number' && e.alpha <= 0) return true;
    return false;
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

  function getEntityName(e){
    return e?.displayName || e?.name || e?.label || e?.id || '';
  }

  function drawEntityNameTag(ctx, cam, e, opts = {}){
    const text = getEntityName(e);
    if (!ctx || !text) return;
    const canvas = ctx.canvas;
    const dpr = canvas && canvas.__hudDpr ? canvas.__hudDpr : (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1);
    const tile = window.G?.TILE_SIZE || window.TILE_SIZE || window.TILE || 32;
    const width = Number.isFinite(e?.w) && e.w > 0 ? e.w : tile;
    const offset = (opts.offsetY ?? e?.nameTagYOffset ?? 18);
    const scale = opts.scale ?? 1;
    const fontPx = Math.max(11, (opts.baseFontPx ?? 14) * scale);
    const worldX = (Number(e?.x) || 0) + width * 0.5;
    const worldY = (Number(e?.y) || 0) - offset * scale;
    const screenPoint = (typeof window.bridgeToScreen === 'function')
      ? window.bridgeToScreen(cam, canvas, worldX, worldY)
      : { x: worldX, y: worldY };
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const canvasWidth = canvas ? (canvas.width || 0) / dpr : 0;
    const canvasHeight = canvas ? (canvas.height || 0) / dpr : 0;
    const cssX = screenPoint.x / dpr;
    const cssY = screenPoint.y / dpr;
    const safeX = Math.max(24, Math.min(canvasWidth - 24, cssX));
    const safeY = Math.max(24, Math.min(canvasHeight - 24, cssY));
    ctx.font = `600 ${fontPx}px "IBM Plex Sans", "Inter", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(text);
    const paddingX = Math.max(8, metrics.width * 0.1);
    const paddingY = Math.max(4, fontPx * 0.35);
    ctx.fillStyle = 'rgba(12,16,24,0.82)';
    ctx.beginPath();
    const boxW = metrics.width + paddingX * 2;
    const boxH = fontPx + paddingY * 2;
    const radius = Math.min(18, boxH * 0.45);
    const left = safeX - boxW * 0.5;
    const top = safeY - boxH * 0.5;
    ctx.moveTo(left + radius, top);
    ctx.lineTo(left + boxW - radius, top);
    ctx.quadraticCurveTo(left + boxW, top, left + boxW, top + radius);
    ctx.lineTo(left + boxW, top + boxH - radius);
    ctx.quadraticCurveTo(left + boxW, top + boxH, left + boxW - radius, top + boxH);
    ctx.lineTo(left + radius, top + boxH);
    ctx.quadraticCurveTo(left, top + boxH, left, top + boxH - radius);
    ctx.lineTo(left, top + radius);
    ctx.quadraticCurveTo(left, top, left + radius, top);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(8,12,18,0.9)';
    ctx.lineWidth = Math.max(1, fontPx * 0.08);
    ctx.stroke();
    ctx.fillStyle = '#f4fbff';
    ctx.strokeStyle = 'rgba(8,12,18,0.9)';
    ctx.lineWidth = Math.max(2, fontPx * 0.18);
    ctx.strokeText(text, safeX, safeY);
    ctx.fillText(text, safeX, safeY);
    ctx.restore();
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
    const walkCycleBase = cfg.walkCycle ?? 6;
    const idleCycleBase = cfg.idleCycle ?? 2.2;
    const walkBobBase = cfg.walkBob ?? 3.4;
    const idleBobBase = cfg.idleBob ?? 1.2;
    return {
      phase: Math.random() * TAU,
      swayPhase: Math.random() * TAU,
      time: 0,
      bob: 0,
      sway: 0,
      lean: 0,
      erratic: 0,
      dir: 1,
      hip: 0,
      micro: 0,
      look: 0,
      headTilt: 0,
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
      stateFlip: null,
      walkCycleBase,
      idleCycleBase,
      walkBobBase,
      idleBobBase,
      walkCycleOverride: null,
      idleCycleOverride: null,
      walkBobOverride: null,
      idleBobOverride: null
    };
  }

  function updateWalkerState(st, e, dt, cfg){
    const vx = e?.vx ?? (e?.dirX ?? 0) * (cfg.speed ?? 0);
    const vy = e?.vy ?? (e?.dirY ?? 0) * (cfg.speed ?? 0);
    const speed = Math.hypot(vx, vy);
    const moving = speed > (cfg.walkThreshold ?? 16);
    const baseWalkCycle = st.walkCycleBase ?? (cfg.walkCycle ?? 6);
    const baseIdleCycle = st.idleCycleBase ?? (cfg.idleCycle ?? 2.2);
    const cycleOverride = moving ? st.walkCycleOverride : st.idleCycleOverride;
    const cycle = (cycleOverride != null) ? cycleOverride : (moving ? baseWalkCycle : baseIdleCycle);
    st.time += dt;
    st.phase = (st.phase + dt * cycle) % TAU;
    const baseWalkBob = st.walkBobBase ?? (cfg.walkBob ?? 3.4);
    const baseIdleBob = st.idleBobBase ?? (cfg.idleBob ?? 1.2);
    const bobOverride = moving ? st.walkBobOverride : st.idleBobOverride;
    const bobAmp = (bobOverride != null) ? bobOverride : (moving ? baseWalkBob : baseIdleBob);
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
    const patientKind = window.ENT?.PATIENT;
    const wantsName = cfg.showNameTag === true || e?.showNameTag === true || (cfg.showNameTag !== false && patientKind != null && e?.kind === patientKind);
    if (wantsName && (e?.displayName || e?.name || e?.label)){
      const tagScale = Math.max(0.7, Math.min(1.25, totalScale));
      drawEntityNameTag(ctx, cam, e, {
        scale: tagScale,
        offsetY: cfg.nameTagOffset ?? e?.nameTagYOffset ?? 18
      });
    }
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

  // ────────────────────── Procedural human rigs ─────────────────────
  const DEFAULT_HUMAN_COLORS = {
    body: '#f7f7f7',
    head: '#f5d2bd',
    limbs: '#1f2a3a',
    accent: '#5bc0ff',
    detail: '#111217'
  };

  function createHumanState(cfg){
    return {
      phase: Math.random() * TAU,
      idlePhase: Math.random() * TAU,
      time: 0,
      bob: 0,
      sway: 0,
      dir: 1,
      moving: false,
      speed: 0,
      armSwing: 0,
      legSwing: 0,
      lateral: 0,
      headTilt: 0,
      headTurn: 0,
      headTiltTarget: null,
      bodyLean: 0,
      walkCycleOverride: null,
      bobOverride: null,
      colorPulse: 0,
      zigzag: 0,
      shakeX: 0,
      shakeY: 0,
      hip: 0,
      bucketSwing: 0,
      anger: 0,
      blinkTimer: 1.2 + Math.random() * 2.4,
      blinkDur: 0,
      extra: {}
    };
  }

  function updateHumanState(st, e, dt, cfg){
    const vx = Number(e?.vx) || 0;
    const vy = Number(e?.vy) || 0;
    const speed = Math.hypot(vx, vy);
    const moving = speed > (cfg.walkThreshold ?? 6);
    st.time += dt;
    st.speed = speed;
    st.moving = moving;
    const cycleBase = moving ? (cfg.walkCycle ?? 6) : (cfg.idleCycle ?? 2.4);
    const cycle = st.walkCycleOverride ?? cycleBase;
    st.phase = (st.phase + dt * cycle) % TAU;
    const bobBase = moving ? (cfg.walkBob ?? 3) : (cfg.idleBob ?? 1);
    const bobAmp = st.bobOverride ?? bobBase;
    st.bob = Math.sin(st.phase) * bobAmp;
    const swayAmp = moving ? (cfg.swayAmp ?? 0.8) : (cfg.idleSwayAmp ?? 0.25);
    const swayFreq = cfg.swayFreq ?? 1.2;
    st.sway = Math.sin(st.phase * swayFreq) * swayAmp;
    st.armSwing = Math.sin(st.phase) * (moving ? 1 : 0.35);
    st.legSwing = Math.sin(st.phase + Math.PI * 0.5) * (moving ? 1 : 0.28);
    st.lateral = Math.sin(st.phase) * (moving ? (cfg.lateralAmp ?? 0.12) : (cfg.idleLateralAmp ?? 0.05));
    st.idlePhase = (st.idlePhase + dt * (cfg.idleCycle ?? 2)) % TAU;
    if (Math.abs(vx) > 2) st.dir = vx < 0 ? -1 : 1;
    else if (Math.abs(e?.dirX || 0) > 0.1) st.dir = e.dirX < 0 ? -1 : 1;
    const baseLean = moving ? (cfg.lean ?? 0) : (cfg.idleLean ?? 0);
    st.bodyLean += (baseLean - st.bodyLean) * Math.min(1, dt * 4.2);
    const baseTilt = moving ? (cfg.headTiltWalk ?? 0) : (cfg.headTiltIdle ?? 0);
    const desiredTilt = (st.headTiltTarget != null) ? st.headTiltTarget : baseTilt;
    st.headTilt += (desiredTilt - st.headTilt) * Math.min(1, dt * 5);
    st.headTiltTarget = null;
    st.headTurn += (0 - st.headTurn) * Math.min(1, dt * 4.5);
    st.walkCycleOverride = null;
    st.bobOverride = null;
    st.colorPulse = Math.max(0, st.colorPulse - dt * 0.4);
    st.shakeX *= Math.pow(0.4, dt * 6);
    st.shakeY *= Math.pow(0.4, dt * 6);
    st.hip *= Math.pow(0.4, dt * 6);
    st.bucketSwing *= Math.pow(0.5, dt * 4);
    st.zigzag *= Math.pow(0.4, dt * 5);
    st.blinkTimer -= dt;
    if (st.blinkTimer <= 0){
      st.blinkDur = 0.12 + Math.random() * 0.12;
      st.blinkTimer = 1.8 + Math.random() * 3.2;
    }
    if (st.blinkDur > 0) st.blinkDur = Math.max(0, st.blinkDur - dt);
    if (cfg.extraUpdate) cfg.extraUpdate(st, e, dt);
  }

  function drawHumanLimb(ctx, x, y, angle, length, width, color, alpha = 1){
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha *= alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, length);
    ctx.stroke();
    ctx.restore();
  }

  function drawHumanHead(ctx, st, helper, cfg){
    const { colors, dims, flip } = helper;
    ctx.save();
    ctx.translate(0, dims.headCenterY);
    ctx.rotate((cfg.headLean ?? 0) + st.headTilt + (st.lookTilt || 0));
    ctx.fillStyle = colors.head;
    ctx.beginPath();
    ctx.arc(0, 0, dims.headR, 0, TAU);
    ctx.fill();
    const lookDir = (flip < 0 ? -1 : 1);
    const look = (st.headTurn || 0) * dims.headR * 0.3 * lookDir;
    const eyeHeight = st.blinkDur > 0 ? Math.max(1, dims.eyeH * 0.3) : dims.eyeH;
    const eyeY = -dims.headR * 0.2;
    ctx.fillStyle = colors.detail;
    ctx.fillRect(-dims.eyeSpacing + look - dims.eyeW * 0.5, eyeY, dims.eyeW, eyeHeight);
    ctx.fillRect(dims.eyeSpacing + look - dims.eyeW * 0.5, eyeY, dims.eyeW, eyeHeight);
    ctx.globalAlpha = 0.7;
    ctx.fillRect(-dims.eyeSpacing + look - dims.eyeW * 0.5, eyeY + eyeHeight + 1 * (st.blinkDur > 0 ? -0.8 : 1), dims.eyeW, 1.5 * (st.blinkDur > 0 ? 0.4 : 1));
    ctx.globalAlpha = 1;
    const mouthY = dims.headR * 0.4;
    ctx.strokeStyle = colors.detail;
    ctx.lineWidth = dims.headR * 0.12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-dims.headR * 0.3 + look * 0.15, mouthY);
    ctx.lineTo(dims.headR * 0.3 + look * 0.15, mouthY + (st.moving ? 0 : Math.sin(st.idlePhase) * dims.headR * 0.05));
    ctx.stroke();
    if (cfg.onHeadDraw) cfg.onHeadDraw(ctx, st, helper, { look, eyeY, eyeHeight });
    ctx.restore();
  }

  function drawHumanRig(ctx, cam, e, st, cfg){
    if (!ctx || isEntityCulled(e)) return;
    const [cx, cy, sc] = toScreen(cam, e);
    const baseScale = sc * (cfg.scale ?? 1);
    const entityHeight = (cfg.entityHeight ?? cfg.totalHeight ?? e?.h ?? 48);
    const offsetY = (cfg.offsetY ?? -6) * baseScale;
    const colors = Object.assign({}, DEFAULT_HUMAN_COLORS, cfg.colors || {});
    const headR = (cfg.headRadius ?? 9) * baseScale;
    const torsoH = (cfg.torsoHeight ?? 30) * baseScale;
    const torsoW = (cfg.torsoWidth ?? 18) * baseScale;
    const legLength = (cfg.legLength ?? 22) * baseScale;
    const armLength = (cfg.armLength ?? 20) * baseScale;
    const armWidth = Math.max(1.5, (cfg.armWidth ?? 3) * baseScale);
    const legWidth = Math.max(2, (cfg.legWidth ?? 4) * baseScale);
    const neck = Math.max(1, (cfg.neckLength ?? 4) * baseScale);
    const dims = {
      headR,
      headCenterY: headR,
      torsoTop: headR + neck,
      torsoH,
      torsoW,
      torsoBottom: headR + neck + torsoH,
      legLength,
      armLength,
      armWidth,
      legWidth,
      eyeW: Math.max(1.5, headR * 0.35),
      eyeH: Math.max(1, headR * 0.24),
      eyeSpacing: Math.max(headR * 0.35, headR * 0.55),
      bucketOffsetY: headR + neck + torsoH * 0.2
    };
    dims.legOriginY = dims.torsoBottom - (cfg.legOriginOffset ?? 0);
    ctx.save();
    ctx.translate(cx, cy);
    drawShadow(ctx, cfg.shadowRadius ?? 12, baseScale, cfg.shadowFlatten ?? 0.3, cfg.shadowAlpha ?? 0.24);
    ctx.translate(0, -entityHeight * 0.5 * baseScale + offsetY + st.bob * baseScale * (cfg.bobMul ?? 0.35));
    ctx.translate(((st.lateral || 0) + (st.hip || 0) + (st.zigzag || 0) + (st.shakeX || 0)) * baseScale, (st.shakeY || 0) * baseScale);
    if (cfg.extraDraw) cfg.extraDraw(ctx, st, { stage: 'beforeFigure', scale: baseScale, colors, dims, entity: e, flip: 1 });
    ctx.save();
    const flipX = (cfg.flipWithDirection === false) ? 1 : (st.dir || 1);
    ctx.scale(flipX, 1);
    if (cfg.stepSquash){
      const squash = Math.max(0.55, 1 - Math.abs(st.legSwing) * cfg.stepSquash);
      ctx.scale(1, squash);
    }
    const helper = { scale: baseScale, colors, dims, flip: flipX, entity: e, config: cfg };
    if (cfg.extraDraw) cfg.extraDraw(ctx, st, helper, 'preBody');
    const legSpread = cfg.legSpread ?? (torsoW * 0.32);
    const armSpread = cfg.armSpread ?? (torsoW * 0.6);
    const legBase = cfg.legBaseAngle ?? 0.18;
    const armBase = cfg.armBaseAngle ?? -0.1;
    const legSwing = st.legSwing * (cfg.legSwing ?? 0.5);
    const armSwing = st.armSwing * (cfg.armSwing ?? 0.6);
    drawHumanLimb(ctx, -legSpread, dims.legOriginY, legBase - legSwing, legLength, legWidth, colors.limbs, 0.65);
    if (cfg.extraDraw) cfg.extraDraw(ctx, st, helper, 'afterBackLeg');
    drawHumanLimb(ctx, -armSpread, dims.torsoTop + torsoH * 0.15, armBase - armSwing, armLength, armWidth, colors.limbs, 0.7);
    if (cfg.extraDraw) cfg.extraDraw(ctx, st, helper, 'afterBackArm');
    ctx.save();
    ctx.translate(0, st.sway * (cfg.swayYOffset ?? 0.4));
    ctx.rotate((cfg.baseLean ?? 0) + st.bodyLean + (cfg.swayLeanMul ?? 0) * st.sway);
    ctx.fillStyle = colors.body;
    const torsoLeft = -torsoW * 0.5;
    ctx.fillRect(torsoLeft, dims.torsoTop, torsoW, torsoH);
    if (colors.accent){
      ctx.fillStyle = colors.accent;
      const stripeY = dims.torsoTop + torsoH * (cfg.accentStripePos ?? 0.45);
      ctx.fillRect(torsoLeft, stripeY, torsoW, Math.max(2, torsoH * 0.12));
    }
    ctx.lineWidth = Math.max(1, baseScale * 0.6);
    ctx.strokeStyle = colors.detail;
    ctx.globalAlpha = 0.2;
    ctx.strokeRect(torsoLeft, dims.torsoTop, torsoW, torsoH);
    ctx.globalAlpha = 1;
    if (cfg.extraDraw) cfg.extraDraw(ctx, st, helper, 'afterTorso');
    drawHumanHead(ctx, st, helper, cfg);
    ctx.restore();
    if (cfg.extraDraw) cfg.extraDraw(ctx, st, helper, 'afterHead');
    if (cfg.extraDraw) cfg.extraDraw(ctx, st, helper, 'beforeFrontArm');
    drawHumanLimb(ctx, armSpread, dims.torsoTop + torsoH * 0.15, armBase + armSwing, armLength, armWidth, colors.limbs, 1);
    if (cfg.extraDraw) cfg.extraDraw(ctx, st, helper, 'afterFrontArm');
    drawHumanLimb(ctx, legSpread, dims.legOriginY, legBase + legSwing, legLength, legWidth, colors.limbs, 1);
    if (cfg.extraDraw) cfg.extraDraw(ctx, st, helper, 'afterFrontLeg');
    ctx.restore();
    ctx.restore();
    if (cfg.showNameTag || (cfg.showNameTag !== false && e?.showNameTag)){
      const tagScale = Math.max(0.7, Math.min(1.25, baseScale));
      drawEntityNameTag(ctx, cam, e, { scale: tagScale, offsetY: cfg.nameTagOffset ?? e?.nameTagYOffset ?? 18 });
    }
  }

  function registerHumanRig(id, cfg){
    API.registerRig(id, {
      create(){
        return createHumanState(cfg);
      },
      update(st, e, dt){
        updateHumanState(st, e, dt, cfg);
      },
      draw(ctx, cam, e, st){
        drawHumanRig(ctx, cam, e, st, cfg);
      }
    });
  }


  function createEl(tag, className, parent){
    if (typeof document === 'undefined') return null;
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (parent) parent.appendChild(el);
    return el;
  }

  function ensureGameContainer(){
    if (typeof document === 'undefined') return null;
    return document.getElementById('game-container') || document.body || document.documentElement;
  }

  function insertHeroNode(node){
    if (!node) return;
    const container = ensureGameContainer();
    if (!container) return;
    const firstOverlay = container.querySelector('.overlay');
    if (firstOverlay) container.insertBefore(node, firstOverlay);
    else container.appendChild(node);
  }

  function buildHeroOverlay(hero, entity){
    if (typeof document === 'undefined'){
      return { hero, root: null, overlay: null, parts: null, miniCanvas: null, miniCtx: null, cleanup: null };
    }
    const root = createEl('div', `puppet-hero hero-${hero}`);
    root.dataset.hero = hero;
    const overlay = createEl('div', 'hero-overlay', root);
    const parts = {
      head: createEl('div', `hero-part hero-head ${hero}-cabeza`, overlay),
      torso: createEl('div', `hero-part hero-torso ${hero}-torso`, overlay),
      arms: {
        left: createEl('div', `hero-part hero-arm hero-arm-left ${hero}-brazo`, overlay),
        right: createEl('div', `hero-part hero-arm hero-arm-right ${hero}-brazo`, overlay)
      },
      legs: {
        left: createEl('div', `hero-part hero-leg hero-leg-left ${hero}-pierna`, overlay),
        right: createEl('div', `hero-part hero-leg hero-leg-right ${hero}-pierna`, overlay)
      },
      accessory: createEl('div', `hero-part hero-accessory ${hero}-accesorio`, overlay)
    };
    const miniHolder = createEl('div', 'hero-overlay-icon', overlay);
    const miniCanvas = createEl('canvas', `hero-mini-canvas ${hero}-mini-canvas`, miniHolder);
    if (miniCanvas){
      miniCanvas.width = 64;
      miniCanvas.height = 64;
    }
    insertHeroNode(root);
    let cleanup = null;
    if (entity){
      entity._destroyCbs = entity._destroyCbs || [];
      cleanup = () => { if (root && root.parentNode) root.parentNode.removeChild(root); };
      entity._destroyCbs.push(cleanup);
    }
    return {
      hero,
      root,
      overlay,
      parts,
      miniCanvas,
      miniCtx: miniCanvas ? miniCanvas.getContext('2d') : null,
      cleanup
    };
  }

  function paintHeroOverlayIcon(st, cfg){
    if (!st?.miniCtx) return;
    const ctx = st.miniCtx;
    const palette = cfg?.palette || {};
    ctx.clearRect(0, 0, 64, 64);
    ctx.save();
    ctx.translate(32, 34);
    ctx.fillStyle = palette.lantern || palette.accent || '#ffffff';
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.torso || '#556';
    drawRoundedRectPath(ctx, -10, -24, 20, 24, 6);
    ctx.fill();
    ctx.fillStyle = palette.belly || '#778';
    drawRoundedRectPath(ctx, -7, -15, 14, 12, 6);
    ctx.fill();
    ctx.fillStyle = palette.skin || '#f7d6b3';
    if (safeEllipse(ctx, 0, -30, 8 + st.jaw * 0.2, 9, 0, 0, TAU)) ctx.fill();
    ctx.restore();
  }

  function setCssVar(el, name, value){
    if (!el || !el.style) return;
    el.style.setProperty(name, value);
  }

  const HERO_DOM_POSE_DEFAULTS = {
    bob: 4,
    armSwing: 18,
    armReach: 6,
    armLift: 2.5,
    armOffset: 1.5,
    legSwing: 14,
    legLift: 2.6,
    lean: 6,
    pushLean: 8,
    attackLean: -5,
    talkLift: 4,
    pushLift: 1.5,
    eatLift: 3,
    hurtDrop: 4,
    accessoryBob: 2.4,
    accessoryLift: 4,
    accessoryAttackLift: 3,
    jaw: 2,
    headTilt: 3,
    hurtTilt: -2,
    pushReach: 8,
    attackReach: 10,
    attackLift: 3,
    talkArmLift: 1.8,
    verticalStride: 4,
    sideStride: 6,
    lanternShake: 1.6
  };

  function heroFaceAsset(hero, facing){
    const suffix = facing === 'back' ? '_back' : '';
    return `assets/images/${hero}${suffix}.png`;
  }

  const HERO_FACE_PRELOADED = new Set();

  function preloadHeroFaces(hero){
    if (!hero || HERO_FACE_PRELOADED.has(hero) || typeof Image === 'undefined') return;
    HERO_FACE_PRELOADED.add(hero);
    const faces = [heroFaceAsset(hero, 'front'), heroFaceAsset(hero, 'back')];
    faces.forEach((src) => {
      try {
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
      } catch (_) {}
    });
  }

  function buildHeroDom(hero, cfg = {}, entity){
    const overlay = buildHeroOverlay(hero, entity) || {};
    const head = overlay.parts?.head || null;
    let faceImg = null;
    if (typeof document !== 'undefined' && head){
      preloadHeroFaces(hero);
      head.classList.add('hero-head-has-face');
      head.innerHTML = '';
      faceImg = document.createElement('img');
      faceImg.className = 'hero-face hero-face-front';
      faceImg.alt = `${hero} face`;
      faceImg.draggable = false;
      faceImg.decoding = 'async';
      faceImg.loading = 'lazy';
      faceImg.src = heroFaceAsset(hero, 'front');
      head.appendChild(faceImg);
    }
    const state = {
      ...overlay,
      hero,
      faceImg,
      faceFrontSrc: heroFaceAsset(hero, 'front'),
      faceBackSrc: heroFaceAsset(hero, 'back'),
      currentFaceSrc: heroFaceAsset(hero, 'front'),
      faceState: 'front',
      orientation: 'down',
      dir: 1,
      action: 'idle',
      actionStart: nowMs(),
      actionElapsed: 0,
      breath: 0,
      breathPhase: Math.random() * TAU,
      time: 0,
      depthBias: cfg.depthBias ?? overlay.depthBias ?? 18,
      walkPhase: Math.random() * TAU,
      legSwing: 0,
      armSwing: 0,
      bob: 0,
      push: 0,
      attack: 0,
      talk: 0,
      eat: 0,
      hurt: 0,
      lean: 0,
      jaw: 0,
      deathProgress: 0,
      deathDrop: 0,
      deathTilt: 0,
      smoke: 0,
      sweat: 0
    };
    if (state.root){
      state.root.classList.add('hero-dom-ready', 'hero-dir-right', 'hero-state-idle');
    }
    paintHeroOverlayIcon(state, HERO_DRAW_PROFILE[hero] || {});
    return state;
  }

  function determineHeroFaceDirection(st, e, anim){
    const vx = Number(e?.vx) || 0;
    const vy = Number(e?.vy) || 0;
    const moving = Math.abs(vx) + Math.abs(vy) > 0.01;
    if (moving){
      if (Math.abs(vy) > Math.abs(vx)){
        return vy < 0 ? 'back' : 'front';
      }
      return vy < 0 && Math.abs(vy) > Math.abs(vx) * 0.4 ? 'back' : 'front';
    }
    const orientation = anim?.orientation || st.orientation || 'down';
    if (orientation === 'up') return 'back';
    return 'front';
  }

  function updateHeroDomFace(st, e, anim){
    if (!st?.faceImg) return;
    const facing = determineHeroFaceDirection(st, e, anim);
    const desiredSrc = facing === 'back'
      ? (st.faceBackSrc || st.faceFrontSrc)
      : (st.faceFrontSrc || st.currentFaceSrc);
    if (desiredSrc && st.currentFaceSrc !== desiredSrc){
      st.faceImg.src = desiredSrc;
      st.currentFaceSrc = desiredSrc;
    }
    st.faceImg.classList.toggle('hero-face-back', facing === 'back');
    st.faceImg.classList.toggle('hero-face-front', facing !== 'back');
    st.faceState = facing;
  }

  function updateHeroDomBreath(st, dt, cfg = {}){
    if (!st) return;
    const animCfg = cfg.anim || cfg;
    const speed = animCfg.breathSpeed ?? cfg.breathSpeed ?? 0.42;
    const amp = animCfg.breathAmp ?? cfg.breathAmp ?? 0.35;
    const easing = Math.min(1, dt ? dt * 5 : 0.2);
    st.breathPhase = (st.breathPhase + dt * speed * TAU) % TAU;
    const target = st.action === 'idle' ? Math.sin(st.breathPhase) * amp : 0;
    st.breath += (target - st.breath) * easing;
    const torso = st.parts?.torso;
    if (torso && torso.style){
      const scale = 1 + st.breath * 0.08;
      const offset = st.breath * (cfg.breathOffset ?? 1.4);
      torso.style.setProperty('--hero-breath-scale', scale.toFixed(4));
      torso.style.setProperty('--hero-breath-offset', `${offset.toFixed(2)}px`);
    }
  }

  function resolveHeroDomAnimCfg(hero, cfg = {}){
    if (cfg && cfg.anim) return cfg.anim;
    const profile = HERO_DRAW_PROFILE[hero];
    return profile?.anim || {};
  }

  function stepHeroDomAnimation(st, e, dt = 0, cfg = {}){
    if (!st) return;
    const animCfg = resolveHeroDomAnimCfg(st.hero, cfg);
    const action = st.action || 'idle';
    const blend = (speed) => Math.min(1, dt > 0 ? dt * speed : 1);
    const walkCycle = action === 'walk' ? (animCfg.walkCycle || 1) : (animCfg.idleCycle || 0.5);
    st.walkPhase = (st.walkPhase + dt * walkCycle * TAU) % TAU;
    const swingAmp = action === 'walk' ? (animCfg.walkSwing ?? 0.5) : (animCfg.idleSwing ?? 0.12);
    const armAmp = action === 'walk' ? (animCfg.armSwing ?? 0.48) : (animCfg.idleArmSwing ?? 0.18);
    const bobAmp = action === 'walk' ? (animCfg.walkBob ?? 2.2) : (animCfg.idleBob ?? 0.8);
    const legTarget = Math.sin(st.walkPhase) * swingAmp;
    const armTarget = Math.sin(st.walkPhase + Math.PI) * armAmp;
    const bobTarget = Math.sin(st.walkPhase * (action === 'walk' ? 2 : 1)) * bobAmp;
    st.legSwing += (legTarget - st.legSwing) * blend(9);
    st.armSwing += (armTarget - st.armSwing) * blend(8);
    st.bob += (bobTarget - st.bob) * blend(6);
    const attackTarget = action === 'attack' ? 1 : 0;
    st.attack += (attackTarget - st.attack) * blend(action === 'attack' ? 6 : 4);
    const pushTarget = action === 'push' ? 1 : 0;
    st.push += (pushTarget - st.push) * blend(5);
    const talkTarget = action === 'talk' ? 1 : 0;
    st.talk += (talkTarget - st.talk) * blend(6);
    const eatTarget = (action === 'eat' || action === 'powerup') ? 1 : 0;
    st.eat += (eatTarget - st.eat) * blend(5);
    const hurtTarget = action === 'hurt' ? 1 : 0;
    st.hurt += (hurtTarget - st.hurt) * blend(6);
    const leanTarget = (animCfg.pushLean ?? 0.2) * st.push + (animCfg.attackLean ?? -0.12) * st.attack;
    st.lean += (leanTarget - st.lean) * blend(5);
    const jawTarget = st.talk > 0 ? (0.4 + 0.4 * Math.sin(st.time * 8)) * st.talk : 0;
    const chew = st.eat * 0.6;
    st.jaw += ((jawTarget + chew) - st.jaw) * blend(7);
    if (action === 'dead'){
      st.deathProgress = Math.min(1, st.deathProgress + dt * 0.9);
    } else {
      st.deathProgress = Math.max(0, st.deathProgress - dt * 1.2);
    }
    const dropTarget = st.deathProgress * (cfg.deathDropPx ?? cfg.deathDrop ?? 10);
    st.deathDrop += (dropTarget - st.deathDrop) * blend(5);
    const tiltTarget = action === 'dead'
      ? (st.deathCause === 'crush' ? 0 : (st.deathCause === 'fire' ? 0.1 : 0.6))
      : 0;
    st.deathTilt += (tiltTarget - st.deathTilt) * blend(3);
    const smokeTarget = st.deathCause === 'fire' ? 1 : 0;
    st.smoke += (smokeTarget - st.smoke) * blend(1.8);
    const sweatTarget = (e?.hero === 'roberto' && (st.push > 0.15 || st.action === 'push')) ? 1 : 0;
    st.sweat = (st.sweat ?? 0) + (sweatTarget - (st.sweat ?? 0)) * blend(4);
  }

  function setArmPose(node, angle, offsetX, offsetY){
    if (!node) return;
    const safeAngle = Number.isFinite(angle) ? angle : 0;
    const safeX = Number.isFinite(offsetX) ? offsetX : 0;
    const safeY = Number.isFinite(offsetY) ? offsetY : 0;
    setCssVar(node, '--hero-arm-angle', `${safeAngle.toFixed(2)}deg`);
    setCssVar(node, '--hero-arm-offset-x', `${safeX.toFixed(2)}px`);
    setCssVar(node, '--hero-arm-offset-y', `${safeY.toFixed(2)}px`);
  }

  function setLegPose(node, angle, offsetY){
    if (!node) return;
    const safeAngle = Number.isFinite(angle) ? angle : 0;
    const safeY = Number.isFinite(offsetY) ? offsetY : 0;
    setCssVar(node, '--hero-leg-angle', `${safeAngle.toFixed(2)}deg`);
    setCssVar(node, '--hero-leg-offset-y', `${safeY.toFixed(2)}px`);
  }

  function applyHeroDomPose(st, cfg = {}){
    if (!st?.parts || !st.root) return;
    const pose = Object.assign({}, HERO_DOM_POSE_DEFAULTS, cfg.pose || {});
    const dir = st.dir || 1;
    const orientation = st.orientation || 'down';
    const bobPx = (pose.bob ?? 4) * st.bob;
    const dropPx = st.deathDrop || 0;
    const hurtDrop = (pose.hurtDrop ?? 4) * st.hurt;
    const talkLift = (pose.talkLift ?? 4) * st.talk;
    const eatLift = (pose.eatLift ?? 3) * st.eat;
    const pushLift = (pose.pushLift ?? 1.5) * st.push;
    const torsoOffset = bobPx - dropPx - hurtDrop + talkLift - eatLift + pushLift;
    setCssVar(st.parts.torso, '--hero-torso-offset-y', `${torsoOffset.toFixed(2)}px`);
    const leanDeg = (pose.lean ?? 6) * st.lean + (pose.pushLean ?? 8) * st.push + (pose.attackLean ?? -5) * st.attack;
    setCssVar(st.parts.torso, '--hero-torso-lean', `${leanDeg.toFixed(2)}deg`);
    const headOffset = bobPx * 0.35 - dropPx * 0.6 - hurtDrop * 0.5 + talkLift * 0.5 - eatLift * 0.25;
    setCssVar(st.parts.head, '--hero-head-offset-y', `${headOffset.toFixed(2)}px`);
    const headTilt = (pose.headTilt ?? 3) * st.talk + (pose.hurtTilt ?? -2) * st.hurt;
    setCssVar(st.parts.head, '--hero-head-tilt', `${headTilt.toFixed(2)}deg`);
    if (st.faceImg){
      setCssVar(st.faceImg, '--hero-face-offset-y', `${((pose.jaw ?? 2) * st.jaw).toFixed(2)}px`);
    }
    const swingScale = orientation === 'side' ? 1 : 0.55;
    const arms = st.parts.arms || {};
    const armFront = dir >= 0 ? arms.right : arms.left;
    const armBack = dir >= 0 ? arms.left : arms.right;
    const armSwing = (pose.armSwing ?? 18) * st.armSwing * swingScale;
    const reach = (pose.pushReach ?? 8) * st.push + (pose.attackReach ?? 10) * st.attack;
    const talkArmLift = (pose.talkArmLift ?? 1.8) * st.talk;
    const attackLift = (pose.attackLift ?? 3) * st.attack;
    const armOffset = (pose.armOffset ?? 1.5) * dir;
    setArmPose(armFront, armSwing + reach, armOffset, bobPx * 0.1 + talkArmLift + attackLift);
    setArmPose(armBack, -armSwing + reach * 0.2, -armOffset * 0.8, bobPx * 0.05 - talkArmLift * 0.5);
    const legs = st.parts.legs || {};
    const legFront = dir >= 0 ? legs.right : legs.left;
    const legBack = dir >= 0 ? legs.left : legs.right;
    const stridePhase = orientation === 'side'
      ? st.legSwing
      : Math.sin((st.walkPhase || 0) * 2) * 0.6;
    const strideAmount = (orientation === 'side'
      ? (pose.sideStride ?? pose.verticalStride ?? 4)
      : (pose.verticalStride ?? pose.sideStride ?? 4)) * stridePhase;
    const verticalSign = orientation === 'up' ? -1 : 1;
    const legSwingDeg = (pose.legSwing ?? 14) * stridePhase * swingScale * verticalSign;
    const legLift = (pose.legLift ?? 2.6) * Math.abs(stridePhase);
    setLegPose(legFront, legSwingDeg, bobPx * 0.25 - dropPx - hurtDrop + legLift + strideAmount * 0.12);
    setLegPose(legBack, -legSwingDeg, bobPx * 0.12 - dropPx * 0.5 - hurtDrop * 0.5 - legLift * 0.3 - strideAmount * 0.08);
    if (st.parts.accessory){
      const accessoryOffset = (pose.accessoryBob ?? 2.4) * Math.sin((st.walkPhase || 0) * 1.3 + dir)
        + (pose.accessoryLift ?? 4) * st.push
        + (pose.accessoryAttackLift ?? 3) * st.attack
        - dropPx * 0.15;
      setCssVar(st.parts.accessory, '--hero-accessory-offset-y', `${accessoryOffset.toFixed(2)}px`);
    }
    if (st.root){
      st.root.classList.toggle('hero-sweating', (st.sweat ?? 0) > 0.35 || st.root.classList.contains('hero-sweating') && (st.sweat ?? 0) > 0.2);
    }
  }

  function resolveHeroDomAnimCfg(hero, cfg = {}){
    if (cfg && cfg.anim) return cfg.anim;
    const profile = HERO_DRAW_PROFILE[hero];
    return profile?.anim || {};
  }

  function stepHeroDomAnimation(st, e, dt = 0, cfg = {}){
    if (!st) return;
    const animCfg = resolveHeroDomAnimCfg(st.hero, cfg);
    const action = st.action || 'idle';
    const blend = (speed) => Math.min(1, dt > 0 ? dt * speed : 1);
    const walkCycle = action === 'walk' ? (animCfg.walkCycle || 1) : (animCfg.idleCycle || 0.5);
    st.walkPhase = (st.walkPhase + dt * walkCycle * TAU) % TAU;
    const swingAmp = action === 'walk' ? (animCfg.walkSwing ?? 0.5) : (animCfg.idleSwing ?? 0.12);
    const armAmp = action === 'walk' ? (animCfg.armSwing ?? 0.48) : (animCfg.idleArmSwing ?? 0.18);
    const bobAmp = action === 'walk' ? (animCfg.walkBob ?? 2.2) : (animCfg.idleBob ?? 0.8);
    const legTarget = Math.sin(st.walkPhase) * swingAmp;
    const armTarget = Math.sin(st.walkPhase + Math.PI) * armAmp;
    const bobTarget = Math.sin(st.walkPhase * (action === 'walk' ? 2 : 1)) * bobAmp;
    st.legSwing += (legTarget - st.legSwing) * blend(9);
    st.armSwing += (armTarget - st.armSwing) * blend(8);
    st.bob += (bobTarget - st.bob) * blend(6);
    const attackTarget = action === 'attack' ? 1 : 0;
    st.attack += (attackTarget - st.attack) * blend(action === 'attack' ? 6 : 4);
    const pushTarget = action === 'push' ? 1 : 0;
    st.push += (pushTarget - st.push) * blend(5);
    const talkTarget = action === 'talk' ? 1 : 0;
    st.talk += (talkTarget - st.talk) * blend(6);
    const eatTarget = (action === 'eat' || action === 'powerup') ? 1 : 0;
    st.eat += (eatTarget - st.eat) * blend(5);
    const hurtTarget = action === 'hurt' ? 1 : 0;
    st.hurt += (hurtTarget - st.hurt) * blend(6);
    const leanTarget = (animCfg.pushLean ?? 0.2) * st.push + (animCfg.attackLean ?? -0.12) * st.attack;
    st.lean += (leanTarget - st.lean) * blend(5);
    const jawTarget = st.talk > 0 ? (0.4 + 0.4 * Math.sin(st.time * 8)) * st.talk : 0;
    const chew = st.eat * 0.6;
    st.jaw += ((jawTarget + chew) - st.jaw) * blend(7);
    if (action === 'dead'){
      st.deathProgress = Math.min(1, st.deathProgress + dt * 0.9);
    } else {
      st.deathProgress = Math.max(0, st.deathProgress - dt * 1.2);
    }
    const dropTarget = st.deathProgress * (cfg.deathDropPx ?? cfg.deathDrop ?? 10);
    st.deathDrop += (dropTarget - st.deathDrop) * blend(5);
    const tiltTarget = action === 'dead'
      ? (st.deathCause === 'crush' ? 0 : (st.deathCause === 'fire' ? 0.1 : 0.6))
      : 0;
    st.deathTilt += (tiltTarget - st.deathTilt) * blend(3);
    const smokeTarget = st.deathCause === 'fire' ? 1 : 0;
    st.smoke += (smokeTarget - st.smoke) * blend(1.8);
    const sweatTarget = (e?.hero === 'roberto' && (st.push > 0.15 || st.action === 'push')) ? 1 : 0;
    st.sweat = (st.sweat ?? 0) + (sweatTarget - (st.sweat ?? 0)) * blend(4);
  }

  function setArmPose(node, angle, offsetX, offsetY){
    if (!node) return;
    const safeAngle = Number.isFinite(angle) ? angle : 0;
    const safeX = Number.isFinite(offsetX) ? offsetX : 0;
    const safeY = Number.isFinite(offsetY) ? offsetY : 0;
    setCssVar(node, '--hero-arm-angle', `${safeAngle.toFixed(2)}deg`);
    setCssVar(node, '--hero-arm-offset-x', `${safeX.toFixed(2)}px`);
    setCssVar(node, '--hero-arm-offset-y', `${safeY.toFixed(2)}px`);
  }

  function setLegPose(node, angle, offsetY){
    if (!node) return;
    const safeAngle = Number.isFinite(angle) ? angle : 0;
    const safeY = Number.isFinite(offsetY) ? offsetY : 0;
    setCssVar(node, '--hero-leg-angle', `${safeAngle.toFixed(2)}deg`);
    setCssVar(node, '--hero-leg-offset-y', `${safeY.toFixed(2)}px`);
  }

  function applyHeroDomPose(st, cfg = {}){
    if (!st?.parts || !st.root) return;
    const pose = Object.assign({}, HERO_DOM_POSE_DEFAULTS, cfg.pose || {});
    const dir = st.dir || 1;
    const orientation = st.orientation || 'down';
    const bobPx = (pose.bob ?? 4) * st.bob;
    const dropPx = st.deathDrop || 0;
    const hurtDrop = (pose.hurtDrop ?? 4) * st.hurt;
    const talkLift = (pose.talkLift ?? 4) * st.talk;
    const eatLift = (pose.eatLift ?? 3) * st.eat;
    const pushLift = (pose.pushLift ?? 1.5) * st.push;
    const torsoOffset = bobPx - dropPx - hurtDrop + talkLift - eatLift + pushLift;
    setCssVar(st.parts.torso, '--hero-torso-offset-y', `${torsoOffset.toFixed(2)}px`);
    const leanDeg = (pose.lean ?? 6) * st.lean + (pose.pushLean ?? 8) * st.push + (pose.attackLean ?? -5) * st.attack;
    setCssVar(st.parts.torso, '--hero-torso-lean', `${leanDeg.toFixed(2)}deg`);
    const headOffset = bobPx * 0.35 - dropPx * 0.6 - hurtDrop * 0.5 + talkLift * 0.5 - eatLift * 0.25;
    setCssVar(st.parts.head, '--hero-head-offset-y', `${headOffset.toFixed(2)}px`);
    const headTilt = (pose.headTilt ?? 3) * st.talk + (pose.hurtTilt ?? -2) * st.hurt;
    setCssVar(st.parts.head, '--hero-head-tilt', `${headTilt.toFixed(2)}deg`);
    if (st.faceImg){
      setCssVar(st.faceImg, '--hero-face-offset-y', `${((pose.jaw ?? 2) * st.jaw).toFixed(2)}px`);
    }
    const swingScale = orientation === 'side' ? 1 : 0.55;
    const arms = st.parts.arms || {};
    const armFront = dir >= 0 ? arms.right : arms.left;
    const armBack = dir >= 0 ? arms.left : arms.right;
    const armSwing = (pose.armSwing ?? 18) * st.armSwing * swingScale;
    const reach = (pose.pushReach ?? 8) * st.push + (pose.attackReach ?? 10) * st.attack;
    const talkArmLift = (pose.talkArmLift ?? 1.8) * st.talk;
    const attackLift = (pose.attackLift ?? 3) * st.attack;
    const armOffset = (pose.armOffset ?? 1.5) * dir;
    setArmPose(armFront, armSwing + reach, armOffset, bobPx * 0.1 + talkArmLift + attackLift);
    setArmPose(armBack, -armSwing + reach * 0.2, -armOffset * 0.8, bobPx * 0.05 - talkArmLift * 0.5);
    const legs = st.parts.legs || {};
    const legFront = dir >= 0 ? legs.right : legs.left;
    const legBack = dir >= 0 ? legs.left : legs.right;
    const stridePhase = orientation === 'side'
      ? st.legSwing
      : Math.sin((st.walkPhase || 0) * 2) * 0.6;
    const strideAmount = (orientation === 'side'
      ? (pose.sideStride ?? pose.verticalStride ?? 4)
      : (pose.verticalStride ?? pose.sideStride ?? 4)) * stridePhase;
    const verticalSign = orientation === 'up' ? -1 : 1;
    const legSwingDeg = (pose.legSwing ?? 14) * stridePhase * swingScale * verticalSign;
    const legLift = (pose.legLift ?? 2.6) * Math.abs(stridePhase);
    setLegPose(legFront, legSwingDeg, bobPx * 0.25 - dropPx - hurtDrop + legLift + strideAmount * 0.12);
    setLegPose(legBack, -legSwingDeg, bobPx * 0.12 - dropPx * 0.5 - hurtDrop * 0.5 - legLift * 0.3 - strideAmount * 0.08);
    if (st.parts.accessory){
      const accessoryOffset = (pose.accessoryBob ?? 2.4) * Math.sin((st.walkPhase || 0) * 1.3 + dir)
        + (pose.accessoryLift ?? 4) * st.push
        + (pose.accessoryAttackLift ?? 3) * st.attack
        - dropPx * 0.15;
      setCssVar(st.parts.accessory, '--hero-accessory-offset-y', `${accessoryOffset.toFixed(2)}px`);
    }
    if (st.root){
      st.root.classList.toggle('hero-sweating', (st.sweat ?? 0) > 0.35 || st.root.classList.contains('hero-sweating') && (st.sweat ?? 0) > 0.2);
    }
  }

  function applyHeroDomState(st, e, dt = 0, cfg = {}){
    if (!st || !e) return;
    const culled = isEntityCulled(e);
    if (culled){
      if (!st.culled && st.root){
        st.root.classList.add('hero-culled');
        st.root.style.visibility = 'hidden';
      }
      st.culled = true;
      st.offscreen = true;
      return;
    }
    if (st.culled && st.root){
      st.root.classList.remove('hero-culled');
      st.root.style.visibility = '';
    }
    st.depthBias = cfg.depthBias ?? st.depthBias ?? 18;
    st.culled = false;
    st.offscreen = false;
    st.time = (st.time || 0) + dt;
    const anim = resolveHeroAnim(e);
    const heroKey = st.hero;
    st.orientation = anim?.orientation || st.orientation || 'down';
    const dir = anim?.dir ?? st.dir ?? 1;
    if (dir < 0){
      st.dir = -1;
      st.root?.classList.add('hero-dir-left');
      st.root?.classList.remove('hero-dir-right');
    } else {
      st.dir = 1;
      st.root?.classList.add('hero-dir-right');
      st.root?.classList.remove('hero-dir-left');
    }
    const action = anim?.action || 'idle';
    if (st.action !== action){
      if (st.action && st.root) st.root.classList.remove(`hero-state-${st.action}`);
      if (st.root) st.root.classList.add(`hero-state-${action}`);
      st.action = action;
      st.actionStart = nowMs();
      st.actionElapsed = 0;
    } else {
      st.actionElapsed = nowMs() - (st.actionStart || nowMs());
    }
    st.moving = !!(anim?.moving);
    st.deathCause = action === 'dead' ? (anim?.deathCause || e.deathCause || 'damage') : '';
    stepHeroDomAnimation(st, e, dt, cfg);
    updateHeroOverlayClasses(st, heroKey, action, st.deathCause, anim);
    updateHeroDomFace(st, e, anim);
    updateHeroDomBreath(st, dt, cfg);
    applyHeroDomPose(st, cfg);
  }

  function resolveCameraZoom(cam){
    const local = cam && Number.isFinite(cam.zoom) ? cam.zoom : null;
    if (Number.isFinite(local) && local > 0) return local;
    const globalCam = typeof window !== 'undefined' ? window.camera : null;
    const globalZoom = globalCam && Number.isFinite(globalCam.zoom) ? globalCam.zoom : null;
    if (Number.isFinite(globalZoom) && globalZoom > 0) return globalZoom;
    return 1;
  }

  function positionHeroDom(st, cam, e, cfg = {}){
    if (!st || !e) return;
    const [worldCX, worldCY, puppetScale] = toScreen(cam, e);
    const zoom = resolveCameraZoom(cam);
    const scale = Math.max(0.1, puppetScale * (cfg.scale ?? 1) * zoom);
    st.currentZoom = zoom;
    st.puppetScale = puppetScale;
    st.worldCenterX = worldCX;
    st.worldCenterY = worldCY;
    positionHeroOverlay(st, cam, e, worldCX, worldCY, scale, cfg);
    updateHeroFlashAnchor(st, e);
  }

  const HERO_ACTION_CLASS_MAP = (typeof window !== 'undefined' && window.HERO_ACTION_CLASS_MAP)
    ? window.HERO_ACTION_CLASS_MAP
    : {
      enrique: {
        idle: 'anim-enrique-idle',
        walk: 'anim-enrique-caminar',
      push: 'anim-enrique-empujar',
      attack: 'anim-enrique-atacar',
      talk: 'anim-enrique-hablar',
      eat: 'anim-enrique-comer',
      powerup: 'anim-enrique-comer',
      hurt: null,
      dead: null,
      default: 'anim-enrique-idle'
    },
    roberto: {
      idle: 'anim-roberto-idle',
      walk: 'anim-roberto-caminar',
      push: 'anim-roberto-empujar',
      attack: 'anim-roberto-atacar',
      talk: 'anim-roberto-hablar',
      eat: 'anim-roberto-comer',
      powerup: 'anim-roberto-comer',
      hurt: null,
      dead: null,
      default: 'anim-roberto-idle'
    },
    francesco: {
      idle: 'anim-francesco-idle',
      walk: 'anim-francesco-caminar',
      push: 'anim-francesco-empujar',
      attack: 'anim-francesco-atacar',
      talk: 'anim-francesco-hablar',
      eat: 'anim-francesco-comer',
      powerup: 'anim-francesco-comer',
      hurt: null,
        dead: null,
        default: 'anim-francesco-idle'
      }
    };
  if (typeof window !== 'undefined'){
    window.HERO_ACTION_CLASS_MAP = HERO_ACTION_CLASS_MAP;
  }

  const HERO_DEATH_CLASS_MAP = {
    enrique: {
      crush: 'anim-enrique-morir-aplastado',
      fire: 'anim-enrique-morir-fuego',
      default: 'anim-enrique-morir-dano'
    },
    roberto: {
      crush: 'anim-roberto-morir-aplastado',
      fire: 'anim-roberto-morir-fuego',
      default: 'anim-roberto-morir-dano'
    },
    francesco: {
      crush: 'anim-francesco-morir-aplastado',
      fire: 'anim-francesco-morir-fuego',
      default: 'anim-francesco-morir-dano'
    }
  };

  const DAMAGE_DEATH_ALIASES = {
    explosion: 'default',
    impact: 'default',
    damage: 'default',
    sting: 'default',
    bite: 'default',
    shock: 'default',
    poison: 'default',
    generic: 'default',
    slip: 'default'
  };

  function pickHeroActionClass(hero, action){
    const map = HERO_ACTION_CLASS_MAP[hero] || HERO_ACTION_CLASS_MAP.francesco;
    if (Object.prototype.hasOwnProperty.call(map, action)){
      return map[action];
    }
    return map.default || null;
  }

  function pickHeroDeathClass(hero, cause){
    const map = HERO_DEATH_CLASS_MAP[hero] || HERO_DEATH_CLASS_MAP.francesco;
    if (!cause) return null;
    const normalized = cause.toLowerCase();
    if (map[normalized]) return map[normalized];
    const alias = DAMAGE_DEATH_ALIASES[normalized] ? 'default' : normalized;
    return map[alias] || map.default || null;
  }

  const HERO_DRAW_PROFILE = {
    enrique: {
      scale: 0.96,
      depthBias: 20,
      shadowRadius: 14,
      deathDrop: 11,
      palette: {
        torso: '#1f2c44',
        belly: '#2f3a58',
        accent: '#ffb347',
        belt: '#c37a1d',
        skin: '#f5c79a',
        hair: '#3b2517',
        moustache: '#2d1a0e',
        arm: '#d6a271',
        armBack: '#c08d5f',
        glove: '#f4d873',
        leg: '#2c3350',
        legBack: '#1f2538',
        boot: '#121728',
        bootBack: '#0d101c',
        lantern: '#ffd34d',
        smoke: '#4a3622'
      },
      torso: { width: 20, height: 20 },
      belly: { width: 24, height: 16 },
      head: { radius: 7.4, offset: -18 },
      arm: { length: 17, width: 5.2, offset: 13 },
      leg: { length: 15, width: 5.2, spread: 6.5, foot: 3.4 },
      anim: {
        walkCycle: 1.0,
        idleCycle: 0.48,
        walkSwing: 0.55,
        idleSwing: 0.12,
        armSwing: 0.48,
        idleArmSwing: 0.16,
        walkBob: 2.4,
        idleBob: 1.2,
        breathSpeed: 0.35,
        breathAmp: 0.2,
        pushLean: 0.32,
        attackLean: -0.18,
        talkLift: 3.6,
        pushReach: 6,
        attackReach: 10,
        eatLift: 8
      }
    },
    roberto: {
      scale: 0.9,
      depthBias: 18,
      shadowRadius: 12,
      deathDrop: 8,
      palette: {
        torso: '#2d4b5e',
        belly: '#3d6780',
        accent: '#ff9f40',
        belt: '#e37222',
        skin: '#ffd9b0',
        hair: '#2b1b14',
        arm: '#f7cba4',
        armBack: '#e0b38b',
        glove: '#ffcc73',
        leg: '#2b3345',
        legBack: '#202734',
        boot: '#141823',
        bootBack: '#0c0f18',
        lantern: '#ff9f40',
        smoke: '#3d2d1f'
      },
      torso: { width: 17, height: 18 },
      belly: { width: 19, height: 14 },
      head: { radius: 6.4, offset: -16 },
      arm: { length: 15, width: 4.2, offset: 11 },
      leg: { length: 13, width: 4.2, spread: 5.2, foot: 3.0 },
      anim: {
        walkCycle: 1.25,
        idleCycle: 0.64,
        walkSwing: 0.75,
        idleSwing: 0.22,
        armSwing: 0.72,
        idleArmSwing: 0.26,
        walkBob: 3.1,
        idleBob: 1.5,
        breathSpeed: 0.55,
        breathAmp: 0.18,
        pushLean: 0.22,
        attackLean: -0.1,
        talkLift: 4.4,
        pushReach: 7,
        attackReach: 9,
        eatLift: 10
      }
    },
    francesco: {
      scale: 0.94,
      depthBias: 19,
      shadowRadius: 13,
      deathDrop: 9,
      palette: {
        torso: '#274357',
        belly: '#31526a',
        accent: '#66b3ff',
        belt: '#2f6fb0',
        skin: '#f0c6a0',
        hair: '#3a2b1d',
        arm: '#dcb28b',
        armBack: '#c69f7a',
        glove: '#b7d8ff',
        leg: '#243145',
        legBack: '#1b2535',
        boot: '#121926',
        bootBack: '#0c121a',
        lantern: '#66b3ff',
        smoke: '#2b3b4d'
      },
      torso: { width: 18, height: 18 },
      belly: { width: 20, height: 15 },
      head: { radius: 6.8, offset: -17 },
      arm: { length: 16, width: 4.6, offset: 12 },
      leg: { length: 14, width: 4.6, spread: 5.8, foot: 3.2 },
      anim: {
        walkCycle: 1.1,
        idleCycle: 0.55,
        walkSwing: 0.62,
        idleSwing: 0.18,
        armSwing: 0.58,
        idleArmSwing: 0.2,
        walkBob: 2.4,
        idleBob: 1.0,
        breathSpeed: 0.42,
        breathAmp: 0.2,
        pushLean: 0.26,
        attackLean: -0.15,
        talkLift: 3.2,
        pushReach: 6.5,
        attackReach: 9.5,
        eatLift: 8.5
      }
    }
  };

  function resolveHeroAnim(e){
    const heroAPI = window.Entities?.Hero;
    const anim = heroAPI?.getAnimationState?.(e);
    if (anim) return anim;
    const facing = (e?.facing || '').toUpperCase();
    const orientation = facing === 'N' ? 'up' : (facing === 'S' ? 'down' : 'side');
    const dir = facing === 'W' ? -1 : 1;
    const moving = !!(e && (Math.abs(e.vx || 0) + Math.abs(e.vy || 0) > 1));
    let action = 'idle';
    if (e?.dead) action = 'dead';
    else if (e?.isAttacking) action = 'attack';
    else if (e?.isPushing) action = 'push';
    else if (e?.isTalking) action = 'talk';
    else if (moving) action = 'walk';
    return { action, orientation, dir, moving, deathCause: e?.deathCause || null };
  }

  function updateHeroOverlayClasses(st, heroKey, action, deathCause, anim){
    if (!st?.root) return;
    if (st.orientationClass !== st.orientation){
      if (st.orientationClass) st.root.classList.remove(`hero-orientation-${st.orientationClass}`);
      st.root.classList.add(`hero-orientation-${st.orientation}`);
      st.orientationClass = st.orientation;
    }
    const actionClass = pickHeroActionClass(heroKey, action);
    if (actionClass !== st.heroActionClass){
      if (st.heroActionClass) st.root.classList.remove(st.heroActionClass);
      if (actionClass) st.root.classList.add(actionClass);
      st.heroActionClass = actionClass;
    }
    const deathClass = deathCause ? pickHeroDeathClass(heroKey, deathCause) : null;
    if (deathClass !== st.heroDeathClass){
      if (st.heroDeathClass) st.root.classList.remove(st.heroDeathClass);
      if (deathClass) st.root.classList.add(deathClass);
      st.heroDeathClass = deathClass;
    }
    st.root.classList.toggle('hero-is-talking', action === 'talk');
    st.root.classList.toggle('hero-is-pushing', action === 'push');
    st.root.classList.toggle('hero-is-attacking', action === 'attack');
    st.root.classList.toggle('hero-is-hurt', action === 'hurt');
    st.root.classList.toggle('hero-is-dead', action === 'dead');
    st.root.classList.toggle('hero-is-eating', action === 'eat' || action === 'powerup');
    st.root.classList.toggle('hero-sparking', !!anim?.sparkle);
    st.root.classList.toggle('hero-smoking', deathCause === 'fire');
    st.root.classList.toggle('hero-sweating', !!anim?.sweating);
    if (heroKey === 'roberto') updateRobertoIdleExtras(st, action);
    else if (st.idleExtraActive){
      st.idleExtraActive = false;
      st.root.classList.remove('anim-roberto-idle-extra');
    }
  }

  function positionHeroOverlay(st, cam, e, worldX, worldY, scale, cfg = {}){
    if (!st?.root) return;
    const projected = (typeof window.worldToScreen === 'function')
      ? window.worldToScreen(worldX, worldY, cam)
      : { sx: worldX, sy: worldY };
    const x = (projected && (projected.sx ?? projected.x)) ?? worldX;
    const y = (projected && (projected.sy ?? projected.y)) ?? worldY;
    const tile = window.G?.TILE_SIZE || window.TILE_SIZE || 32;
    const cfgOffset = Number(cfg.offsetY);
    const offsetY = Number.isFinite(cfgOffset)
      ? cfgOffset
      : (Number.isFinite(st.offsetY) ? st.offsetY : -(tile * 0.4));
    st.root.style.transform = `translate(${x}px, ${y + offsetY}px) scale(${scale})`;
    st.screenX = x;
    st.screenY = y + offsetY;
    st.worldCenterX = worldX;
    st.worldCenterY = worldY;
    st.renderScale = scale;
    st.offsetYApplied = offsetY;
    const depthBias = Number.isFinite(st.depthBias)
      ? st.depthBias
      : (Number.isFinite(cfg.depthBias) ? cfg.depthBias : 18);
    const depth = Math.max(0, (Number(e?.y) || 0) + depthBias);
    const baseZ = Number.isFinite(cfg.zIndexBase) ? cfg.zIndexBase : 12;
    const zIndex = Math.min(80, baseZ + depth * 0.04);
    st.root.style.zIndex = zIndex.toFixed(0);
  }

  function updateHeroFlashAnchor(st, e){
    if (!st || !e || !st.parts || !st.parts.arms || st.offscreen) return;
    if (typeof document === 'undefined') return;
    const arm = st.parts.arms.right || st.parts.arms.left;
    if (!arm || typeof arm.getBoundingClientRect !== 'function') return;
    const armRect = arm.getBoundingClientRect();
    const rootRect = st.root?.getBoundingClientRect?.();
    if (!armRect || !rootRect) return;
    const dir = st.dir || 1;
    const grabX = dir >= 0
      ? (armRect.right - armRect.width * 0.15)
      : (armRect.left + armRect.width * 0.15);
    const grabY = armRect.bottom - armRect.height * 0.18;
    const anchorScreenX = (typeof st.screenX === 'number')
      ? st.screenX
      : ((rootRect.left + rootRect.right) * 0.5);
    const anchorScreenY = (typeof st.screenY === 'number')
      ? st.screenY
      : ((rootRect.top + rootRect.bottom) * 0.5);
    const zoom = st.currentZoom || resolveCameraZoom(null) || 1;
    if (!(zoom > 0.0001)) return;
    const offsetX = (grabX - anchorScreenX) / zoom;
    const offsetY = (grabY - anchorScreenY) / zoom;
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return;
    const blend = 0.35;
    const prevX = Number.isFinite(st.flashOffsetX) ? st.flashOffsetX : (e.flashlightOffsetX || 0);
    const prevY = Number.isFinite(st.flashOffsetY) ? st.flashOffsetY : (e.flashlightOffsetY || 0);
    const smoothX = prevX + (offsetX - prevX) * blend;
    const smoothY = prevY + (offsetY - prevY) * blend;
    st.flashOffsetX = smoothX;
    st.flashOffsetY = smoothY;
    e.flashlightOffsetX = smoothX;
    e.flashlightOffsetY = smoothY;
    if (e._flashlightId && window.LightingAPI?.updateLight) {
      try { window.LightingAPI.updateLight(e._flashlightId, { offsetX: smoothX, offsetY: smoothY }); }
      catch (_) {}
    }
  }

  function updateHeroRigState(st, e, dt, cfg){
    if (!st || !e) return;
    const culled = isEntityCulled(e);
    if (culled){
      if (!st.culled && st.root){
        st.root.classList.add('hero-culled');
        st.root.style.visibility = 'hidden';
      }
      st.culled = true;
      st.offscreen = true;
      return;
    }
    if (st.culled && st.root){
      st.root.classList.remove('hero-culled');
      st.root.style.visibility = '';
    }
    st.culled = false;
    st.offscreen = false;
    st.time += dt;
    const anim = resolveHeroAnim(e);
    const heroKey = st.hero;
    let action = anim?.action || 'idle';
    st.orientation = anim?.orientation || st.orientation || 'down';
    const dir = anim?.dir ?? st.dir ?? 1;
    if (dir < 0){
      st.dir = -1;
      st.root?.classList.add('hero-dir-left');
      st.root?.classList.remove('hero-dir-right');
    } else {
      st.dir = 1;
      st.root?.classList.add('hero-dir-right');
      st.root?.classList.remove('hero-dir-left');
    }
    if (st.action !== action){
      if (st.action && st.root) st.root.classList.remove(`hero-state-${st.action}`);
      if (st.root) st.root.classList.add(`hero-state-${action}`);
      st.action = action;
      st.actionStart = nowMs();
      st.actionElapsed = 0;
    } else {
      st.actionElapsed = nowMs() - (st.actionStart || nowMs());
    }
    st.moving = !!(anim?.moving);
    const animCfg = cfg.anim || {};
    const walkCycle = action === 'walk' ? (animCfg.walkCycle || 1) : (animCfg.idleCycle || 0.5);
    st.walkPhase = (st.walkPhase + dt * walkCycle * TAU) % TAU;
    const swingAmp = action === 'walk' ? (animCfg.walkSwing ?? 0.5) : (animCfg.idleSwing ?? 0.12);
    const armAmp = action === 'walk' ? (animCfg.armSwing ?? 0.48) : (animCfg.idleArmSwing ?? 0.18);
    const bobAmp = action === 'walk' ? (animCfg.walkBob ?? 2.2) : (animCfg.idleBob ?? 0.8);
    const legSwing = Math.sin(st.walkPhase) * swingAmp;
    const armSwing = Math.sin(st.walkPhase + Math.PI) * armAmp;
    const bob = Math.sin(st.walkPhase * (action === 'walk' ? 2 : 1)) * bobAmp;
    st.legSwing += (legSwing - st.legSwing) * Math.min(1, dt * 9);
    st.armSwing += (armSwing - st.armSwing) * Math.min(1, dt * 9);
    st.bob += (bob - st.bob) * Math.min(1, dt * 6);
    st.breathPhase = (st.breathPhase + dt * (animCfg.breathSpeed ?? 0.5) * TAU) % TAU;
    const breath = Math.sin(st.breathPhase) * (animCfg.breathAmp ?? 0.9);
    st.breath += (breath - st.breath) * Math.min(1, dt * 4);
    const targetAttack = action === 'attack' ? 1 : 0;
    st.attack += (targetAttack - st.attack) * Math.min(1, dt * (action === 'attack' ? 6 : 4));
    const targetPush = action === 'push' ? 1 : 0;
    st.push += (targetPush - st.push) * Math.min(1, dt * 5);
    const targetTalk = action === 'talk' ? 1 : 0;
    st.talk += (targetTalk - st.talk) * Math.min(1, dt * 6);
    const targetEat = (action === 'eat' || action === 'powerup') ? 1 : 0;
    st.eat += (targetEat - st.eat) * Math.min(1, dt * 5);
    const targetHurt = action === 'hurt' ? 1 : 0;
    st.hurt += (targetHurt - st.hurt) * Math.min(1, dt * 6);
    const leanTarget = (animCfg.pushLean ?? 0.2) * st.push + (animCfg.attackLean ?? -0.12) * st.attack;
    st.lean += (leanTarget - st.lean) * Math.min(1, dt * 6);
    const jawTarget = st.talk > 0 ? (0.4 + 0.4 * Math.sin(st.time * 8)) * st.talk : 0;
    const chew = st.eat * 0.6;
    st.jaw += ((jawTarget + chew) - st.jaw) * Math.min(1, dt * 7);
    if (action === 'dead'){
      st.deathProgress = Math.min(1, st.deathProgress + dt * 0.9);
    } else {
      st.deathProgress = Math.max(0, st.deathProgress - dt * 1.2);
    }
    st.deathCause = action === 'dead' ? (anim?.deathCause || e.deathCause || 'damage') : '';
    const dropTarget = st.deathProgress * (cfg.deathDrop ?? 9);
    st.deathDrop += (dropTarget - st.deathDrop) * Math.min(1, dt * 5);
    const tiltTarget = action === 'dead' ? (st.deathCause === 'crush' ? 0 : (st.deathCause === 'fire' ? 0.1 : 0.6)) : 0;
    st.deathTilt += (tiltTarget - st.deathTilt) * Math.min(1, dt * 3);
    const smokeTarget = st.deathCause === 'fire' ? 1 : 0;
    st.smoke += (smokeTarget - st.smoke) * Math.min(1, dt * 1.8);
    updateHeroOverlayClasses(st, heroKey, action, st.deathCause, anim);
    paintHeroOverlayIcon(st, cfg);
  }

  function drawRoundedRectPath(ctx, x, y, w, h, r){
    const radius = Math.max(0, Math.min(r || 0, Math.min(Math.abs(w), Math.abs(h)) * 0.5));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function drawHeroLeg(ctx, offsetX, swing, cfg, palette, front){
    const leg = cfg.leg || {};
    const length = leg.length ?? 14;
    const width = leg.width ?? 4.4;
    const foot = leg.foot ?? 3.2;
    ctx.save();
    ctx.translate(offsetX, 0);
    ctx.rotate(swing * 0.2);
    ctx.fillStyle = front ? (palette.leg || '#2c3450') : (palette.legBack || palette.leg || '#1c2235');
    drawRoundedRectPath(ctx, -width * 0.5, -2, width, length + 2, width * 0.45);
    ctx.fill();
    ctx.fillStyle = front ? (palette.boot || '#111822') : (palette.bootBack || palette.boot || '#0c1119');
    drawRoundedRectPath(ctx, -width * 0.8, length - 1, width * 1.6, foot, foot * 0.5);
    ctx.fill();
    ctx.restore();
  }

  function drawHeroArm(ctx, st, cfg, palette, front){
    const arm = cfg.arm || {};
    const length = arm.length ?? 16;
    const width = arm.width ?? 4.5;
    const offset = arm.offset ?? 12;
    const baseY = -((cfg.torso?.height ?? 16) * 0.5) + 4;
    const talkLift = front ? 0 : st.talk * (cfg.anim?.talkLift ?? 4);
    const pushReach = st.push * (cfg.anim?.pushReach ?? 6);
    const attackReach = front ? st.attack * (cfg.anim?.attackReach ?? 9) : 0;
    const eatLift = front ? st.eat * (cfg.anim?.eatLift ?? 8) : 0;
    const swing = front ? st.armSwing : -st.armSwing;
    const offsetX = front ? offset : -offset;
    ctx.save();
    ctx.translate(offsetX, baseY + st.breath * 0.3);
    ctx.rotate(swing * 0.4 + (-pushReach * 0.02) + (-attackReach * 0.03) - eatLift * 0.02 + talkLift * 0.05);
    ctx.fillStyle = front ? (palette.arm || palette.skin || '#f7d6b3') : (palette.armBack || palette.arm || palette.skin || '#f7d6b3');
    drawRoundedRectPath(ctx, -width * 0.5, -1, width, length + 2, width * 0.5);
    ctx.fill();
    ctx.fillStyle = palette.glove || '#f4d873';
    drawRoundedRectPath(ctx, -width * 0.7, length - 2, width * 1.4, 4.2, 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHeroHead(ctx, st, cfg, palette){
    const head = cfg.head || {};
    const radius = head.radius ?? 6.5;
    const offset = head.offset ?? -17;
    ctx.save();
    ctx.translate(0, offset + st.breath * 0.4);
    ctx.rotate(st.deathTilt * 0.08);
    ctx.fillStyle = palette.skin || '#f7d6b3';
    if (safeEllipse(ctx, 0, 0, radius, radius * 1.1, 0, 0, TAU)) ctx.fill();
    if (palette.hair){
      ctx.fillStyle = palette.hair;
      if (safeEllipse(ctx, 0, -radius * 0.4, radius * 1.15, radius * 0.75, 0, 0, TAU)) ctx.fill();
    }
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(-radius * 0.5, -radius * 0.1, radius * 0.25, 1.2);
    ctx.fillRect(radius * 0.25, -radius * 0.1, radius * 0.25, 1.2);
    ctx.fillStyle = '#2a2a2a';
    drawRoundedRectPath(ctx, -radius * 0.4, radius * 0.2, radius * 0.8, 1.6 + st.jaw * 1.2, 0.8);
    ctx.fill();
    if (st.hero === 'enrique'){
      ctx.fillStyle = palette.moustache || palette.hair || '#2d1a0e';
      drawRoundedRectPath(ctx, -radius * 0.55, 0, radius * 1.1, 1.6, 0.8);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawHeroFigure(ctx, st, cfg){
    const palette = cfg.palette || {};
    const leg = cfg.leg || {};
    const spread = leg.spread ?? 6;
    drawHeroLeg(ctx, -spread, st.legSwing * -0.7 - st.push * 0.1, cfg, palette, false);
    drawHeroLeg(ctx, spread, st.legSwing + st.push * 0.2, cfg, palette, true);
    ctx.save();
    ctx.translate(0, -4 + st.breath * 0.4);
    ctx.rotate(st.lean * 0.25);
    ctx.fillStyle = palette.torso || '#2f3b5a';
    const torso = cfg.torso || {};
    drawRoundedRectPath(ctx, -torso.width * 0.5, -torso.height, torso.width, torso.height + 4, 6);
    ctx.fill();
    ctx.fillStyle = palette.belly || '#3d4a68';
    const belly = cfg.belly || {};
    drawRoundedRectPath(ctx, -belly.width * 0.5, -belly.height * 0.4, belly.width, belly.height, 8);
    ctx.fill();
    ctx.fillStyle = palette.accent || '#f5b85a';
    ctx.fillRect(-torso.width * 0.45, -torso.height * 0.35, torso.width * 0.9, 3);
    ctx.restore();
    drawHeroArm(ctx, st, cfg, palette, false);
    drawHeroArm(ctx, st, cfg, palette, true);
    drawHeroHead(ctx, st, cfg, palette);
    if (st.hero === 'francesco' && st.talk > 0.3){
      ctx.save();
      ctx.translate(0, (cfg.head?.offset ?? -17) - 10);
      ctx.strokeStyle = palette.accent || '#66b3ff';
      ctx.globalAlpha = 0.5 * st.talk;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-4, -8);
      ctx.lineTo(4, -12);
      ctx.stroke();
      ctx.restore();
    }
    if (st.hero === 'roberto' && st.idleExtraActive){
      ctx.save();
      ctx.translate(0, (cfg.head?.offset ?? -16) - 8);
      ctx.strokeStyle = palette.accent || '#ff9f40';
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(0, -10, 4 + 2 * Math.sin(st.time * 6), -0.6, 0.6);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawHeroCorpse(ctx, st, cfg){
    const palette = cfg.palette || {};
    const cause = st.deathCause || 'damage';
    ctx.save();
    if (cause === 'crush'){
      ctx.scale(1.2, 0.35 + 0.25 * (1 - Math.min(1, st.deathProgress)));
    } else if (cause === 'fire'){
      ctx.scale(1, 1 - 0.3 * st.deathProgress);
    } else {
      ctx.rotate(-0.6 * st.deathProgress);
    }
    ctx.fillStyle = palette.torso || '#343b4f';
    drawRoundedRectPath(ctx, -12, -6, 24, 14, 6);
    ctx.fill();
    ctx.fillStyle = palette.skin || '#f7d6b3';
    if (safeEllipse(ctx, 0, -13, 7, 8, 0, 0, TAU)) ctx.fill();
    ctx.fillStyle = palette.leg || '#1e2436';
    drawRoundedRectPath(ctx, -10, 6, 8, 4, 2);
    drawRoundedRectPath(ctx, 2, 6, 8, 4, 2);
    ctx.fill();
    if (cause === 'fire'){
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = palette.smoke || 'rgba(60,60,60,0.5)';
      for (let i = 0; i < 3; i++){
        const r = 6 + i * 4;
        if (safeEllipse(ctx, -4 + i * 4, -18 - i * 4 - st.time * 2 % 4, r, r * 0.8, 0, 0, TAU)) ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawHeroRig(ctx, cam, e, st, cfg){
    if (!ctx || !e || !st || st.offscreen) return;
    const [cx, cy, sc] = toScreen(cam, e);
    const tile = window.G?.TILE_SIZE || window.TILE_SIZE || 32;
    const scale = sc * (cfg.scale ?? 1);
    ctx.save();
    ctx.translate(cx, cy + st.deathDrop * 0.2);
    const shadowAlpha = 0.24 * (1 - Math.min(1, st.deathProgress * 0.9));
    drawShadow(ctx, cfg.shadowRadius ?? (tile * 0.35), scale, st.deathCause === 'crush' ? 0.18 : 0.28, shadowAlpha);
    ctx.translate(0, -tile * 0.35 + st.bob * 0.4);
    ctx.scale(scale, scale);
    if (st.deathCause){
      drawHeroCorpse(ctx, st, cfg);
    } else {
      drawHeroFigure(ctx, st, cfg);
    }
    ctx.restore();
    positionHeroOverlay(st, cam, e, cx, cy, scale, cfg);
  }

  function registerHeroRig(hero, cfg){
    API.registerRig(`hero_${hero}`, {
      create(entity){
        const overlay = buildHeroOverlay(hero, entity);
        const state = {
          hero,
          root: overlay.root,
          overlay: overlay.overlay,
          parts: overlay.parts,
          miniCanvas: overlay.miniCanvas,
          miniCtx: overlay.miniCtx,
          cleanup: overlay.cleanup,
          action: 'idle',
          orientation: 'down',
          orientationClass: null,
          dir: 1,
          time: 0,
          walkPhase: Math.random() * TAU,
          breathPhase: Math.random() * TAU,
          breath: 0,
          bob: 0,
          lean: 0,
          legSwing: 0,
          armSwing: 0,
          talk: 0,
          eat: 0,
          push: 0,
          attack: 0,
          hurt: 0,
          jaw: 0,
          deathProgress: 0,
          deathCause: '',
          deathTilt: 0,
          deathDrop: 0,
          smoke: 0,
          heroActionClass: null,
          heroDeathClass: null,
          actionStart: nowMs(),
          actionElapsed: 0,
          culled: false,
          offscreen: false,
          depthBias: cfg.depthBias ?? 18,
          idleExtraActive: false,
          idleExtraUntil: 0,
          idleExtraCooldown: 0
        };
        paintHeroOverlayIcon(state, cfg);
        return state;
      },
      update(st, e, dt){
        updateHeroRigState(st, e, dt, cfg);
      },
      draw(ctx2, cam, e, st){
        drawHeroRig(ctx2, cam, e, st, cfg);
      },
      dispose(st, entity){
        if (!st) return;
        if (typeof st.cleanup === 'function'){
          try { st.cleanup(); } catch (_) {}
        }
        if (entity && Array.isArray(entity._destroyCbs) && st.cleanup){
          entity._destroyCbs = entity._destroyCbs.filter((fn) => fn !== st.cleanup);
        }
        st.cleanup = null;
      }
    });
  }

  for (const [hero, cfg] of Object.entries(HERO_DRAW_PROFILE)){
    registerHeroRig(hero, cfg);
  }

  try {
    if (window.DEBUG_COLLISIONS && typeof console !== 'undefined' && typeof console.debug === 'function'){
      console.debug('[RIG_INIT] HERO_ACTION_CLASS_MAP keys:', Object.keys(HERO_ACTION_CLASS_MAP));
      console.debug('[RIG_INIT] Rigs de héroes registrados correctamente');
    }
  } catch (_) {}

  let heroRigDiagnosticsDone = false;
  function logHeroRigDiagnostics(){
    if (heroRigDiagnosticsDone) return;
    heroRigDiagnosticsDone = true;
    if (typeof window === 'undefined') return;
    const registry = window.Puppet?.RIGS || {};
    if (window.DEBUG_COLLISIONS){
      for (const hero of Object.keys(HERO_DRAW_PROFILE)){
        const id = `hero_${hero}`;
        if (registry && registry[id]){
          try {
            console.log(`[HeroRig] rig "${id}" listo para usarse.`);
          } catch (_) {}
        } else {
          try {
            console.warn(`[HeroRig] rig "${id}" no está registrado, se usará fallback si se solicita.`);
          } catch (_) {}
        }
      }
    }
  }

  if (typeof document !== 'undefined'){
    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', logHeroRigDiagnostics, { once: true });
    } else {
      logHeroRigDiagnostics();
    }
  } else {
    logHeroRigDiagnostics();
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

  const HERO_DOM_CONFIG = {
    enrique: {
      scale: 1.08,
      height: 100,
      width: 62,
      walkDuration: 1.05,
      idleDuration: 3.3,
      attackDuration: 0.78,
      pushDuration: 1.05,
      talkDuration: 0.6,
      offsetY: -16,
      depthBias: 20,
      deathDropPx: 12,
      lanternColor: '#ffd34d',
      lanternGlow: 'rgba(255,211,77,0.55)',
      anim: HERO_DRAW_PROFILE.enrique?.anim,
      pose: {
        bob: 4.8,
        armSwing: 20,
        armReach: 8,
        armLift: 3.5,
        armOffset: 1.6,
        legSwing: 16,
        legLift: 3.6,
        lean: 7,
        pushLean: 12,
        attackLean: -7,
        talkLift: 5,
        eatLift: 4,
        hurtDrop: 6,
        accessoryBob: 3.2,
        accessoryLift: 5,
        accessoryAttackLift: 3.5,
        jaw: 2.8,
        headTilt: 3.2,
        pushReach: 9,
        attackReach: 12,
        attackLift: 3.2,
        talkArmLift: 2.2,
        verticalStride: 4.2,
        sideStride: 7.2
      }
    },
    roberto: {
      scale: 1.0,
      height: 90,
      width: 56,
      walkDuration: 0.82,
      idleDuration: 2.4,
      attackDuration: 0.48,
      pushDuration: 0.9,
      talkDuration: 0.42,
      offsetY: -14,
      depthBias: 18,
      deathDropPx: 9,
      lanternColor: '#ff9f40',
      lanternGlow: 'rgba(255,159,64,0.52)',
      anim: HERO_DRAW_PROFILE.roberto?.anim,
      pose: {
        bob: 3.6,
        armSwing: 26,
        armReach: 7,
        armLift: 2.8,
        armOffset: 1.4,
        legSwing: 18,
        legLift: 3.1,
        lean: 5,
        pushLean: 7,
        attackLean: -4,
        talkLift: 3.6,
        eatLift: 2.4,
        hurtDrop: 4,
        accessoryBob: 2.3,
        accessoryLift: 4,
        accessoryAttackLift: 2.5,
        jaw: 1.8,
        headTilt: 2.4,
        pushReach: 8,
        attackReach: 11,
        attackLift: 2.4,
        talkArmLift: 2.0,
        verticalStride: 4.8,
        sideStride: 7.8
      }
    },
    francesco: {
      scale: 1.02,
      height: 96,
      width: 58,
      walkDuration: 0.92,
      idleDuration: 2.8,
      attackDuration: 0.58,
      pushDuration: 0.98,
      talkDuration: 0.5,
      offsetY: -15,
      depthBias: 19,
      deathDropPx: 11,
      lanternColor: '#66b3ff',
      lanternGlow: 'rgba(102,179,255,0.52)',
      anim: HERO_DRAW_PROFILE.francesco?.anim,
      pose: {
        bob: 4.2,
        armSwing: 22,
        armReach: 7,
        armLift: 3.1,
        armOffset: 1.5,
        legSwing: 15,
        legLift: 3.0,
        lean: 6,
        pushLean: 9,
        attackLean: -6,
        talkLift: 4.2,
        eatLift: 3.2,
        hurtDrop: 5,
        accessoryBob: 2.7,
        accessoryLift: 4.5,
        accessoryAttackLift: 3,
        jaw: 2.1,
        headTilt: 2.8,
        pushReach: 8.5,
        attackReach: 11.5,
        attackLift: 2.8,
        talkArmLift: 2.1,
        verticalStride: 4.4,
        sideStride: 7
      }
    }
  };

  // duplicate legacy definitions trimmed; single source of truth above

  function updateRobertoIdleExtras(st, action){
    const now = nowMs();
    if (action !== 'idle'){
      if (st.idleExtraActive){
        st.idleExtraActive = false;
        st.root.classList.remove('anim-roberto-idle-extra');
      }
      st.idleExtraUntil = 0;
      return;
    }
    const readyForNew = now > (st.idleExtraCooldown || 0);
    if (!st.idleExtraActive && readyForNew && st.actionElapsed > 5500){
      st.idleExtraActive = true;
      st.idleExtraUntil = now + 1800 + Math.random() * 700;
      st.idleExtraCooldown = st.idleExtraUntil + 4000;
      st.root.classList.add('anim-roberto-idle-extra');
    }
    if (st.idleExtraActive && now > st.idleExtraUntil){
      st.idleExtraActive = false;
      st.root.classList.remove('anim-roberto-idle-extra');
    }
  }

  function registerHeroDomRig(hero, cfg){
    API.registerRig(`hero_${hero}`, {
      create(entity){
        const state = buildHeroDom(hero, cfg, entity);
        applyHeroDomState(state, entity, 0, cfg);
        return state;
      },
      update(state, entity, dt){
        applyHeroDomState(state, entity, dt || 0, cfg);
      },
      draw(ctx, cam, entity, state){
        positionHeroDom(state, cam, entity, cfg);
      },
      dispose(state, entity){
        if (!state) return;
        if (typeof state.cleanup === 'function'){
          try { state.cleanup(); } catch (_) {}
        }
        if (entity && Array.isArray(entity._destroyCbs) && state.cleanup){
          entity._destroyCbs = entity._destroyCbs.filter((fn) => fn !== state.cleanup);
        }
        state.cleanup = null;
      }
    });
  }

  for (const [hero, cfg] of Object.entries(HERO_DOM_CONFIG)){
    registerHeroDomRig(hero, cfg);
  }

  let heroDomDiagnosticsDone = false;
  function logHeroDomRigDiagnostics(){
    if (heroDomDiagnosticsDone) return;
    heroDomDiagnosticsDone = true;
    if (typeof window === 'undefined') return;
    const registry = window.Puppet?.RIGS || {};
    if (window.DEBUG_COLLISIONS){
      for (const hero of Object.keys(HERO_DOM_CONFIG)){
        const id = `hero_${hero}`;
        if (registry && registry[id]){
          try {
            console.log(`[HeroRig] rig "${id}" listo para usarse.`);
          } catch (_) {}
        } else {
          try {
            console.warn(`[HeroRig] rig "${id}" no está registrado, se usará fallback si se solicita.`);
          } catch (_) {}
        }
      }
      try {
        console.info('[HeroRig] Rigs DOM con caras personalizadas activos; no se requiere fallback.');
      } catch (_) {}
      try {
        console.info('[RIG_TEST] Héroes: rigs cargados y animaciones funcionando correctamente; sin fallback.');
      } catch (_) {}
    }
  }

  if (typeof document !== 'undefined'){
    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', logHeroDomRigDiagnostics, { once: true });
    } else {
      logHeroDomRigDiagnostics();
    }
  } else {
    logHeroDomRigDiagnostics();
  }

  // ───────────────────────────── NPCs ──────────────────────────────
  registerHumanRig('npc_celador', {
    totalHeight: 66,
    entityHeight: 64,
    torsoWidth: 22,
    torsoHeight: 34,
    legLength: 20,
    armLength: 22,
    armWidth: 4,
    legWidth: 5.5,
    walkCycle: 5.4,
    walkBob: 2.6,
    idleBob: 1.0,
    swayAmp: 0.4,
    lean: 0.05,
    stepSquash: 0.12,
    shadowRadius: 13,
    offsetY: -5,
    colors: {
      body: '#7c8596',
      accent: '#515b6d',
      head: '#f1cfb6',
      limbs: '#232933',
      detail: '#171c23'
    },
    extraUpdate(st){
      st.headTiltTarget = -0.02;
      const lean = st.moving ? 0.08 : 0.03;
      st.bodyLean += (lean - st.bodyLean) * 0.12;
      st.hip = Math.sin(st.phase) * 0.05;
    },
    extraDraw(ctx, st, helper, stage){
      if (stage === 'afterTorso'){
        const { dims } = helper;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        const pocketH = dims.torsoH * 0.25;
        const pocketW = dims.torsoW * 0.32;
        ctx.fillRect(-dims.torsoW * 0.45, dims.torsoTop + dims.torsoH * 0.2, pocketW, pocketH);
        ctx.fillRect(dims.torsoW * 0.13, dims.torsoTop + dims.torsoH * 0.2, pocketW, pocketH);
        ctx.restore();
      }
    }
  });

  registerHumanRig('npc_chica_limpieza', {
    totalHeight: 64,
    entityHeight: 62,
    torsoWidth: 18,
    torsoHeight: 32,
    legLength: 22,
    armLength: 21,
    walkCycle: 7.4,
    walkBob: 3.2,
    idleBob: 1.2,
    swayAmp: 1.0,
    lean: 0.08,
    shadowRadius: 11,
    offsetY: -4,
    colors: {
      body: '#a8d8cf',
      accent: '#4f8a7b',
      head: '#f5d4c3',
      limbs: '#274c4a',
      detail: '#123033'
    },
    extraUpdate(st){
      st.bucketSwing = Math.sin(st.phase) * 0.25;
      const tilt = st.moving ? -0.04 : -0.08;
      st.headTiltTarget = tilt;
    },
    extraDraw(ctx, st, helper, stage){
      if (stage === 'afterTorso'){
        const { dims } = helper;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(-dims.torsoW * 0.3, dims.torsoTop + dims.torsoH * 0.15, dims.torsoW * 0.25, dims.torsoH * 0.2);
        ctx.restore();
      }
      if (stage === 'beforeFrontArm'){
        const { scale, dims, flip } = helper;
        ctx.save();
        const offsetX = (dims.torsoW * 0.75 + 4 * scale) * (flip < 0 ? -1 : 1);
        ctx.translate(offsetX, dims.bucketOffsetY + dims.armLength * 0.4);
        ctx.rotate(-0.25 + st.bucketSwing * 0.2);
        const bucketW = 12 * scale;
        const bucketH = 14 * scale;
        ctx.fillStyle = '#2e4e89';
        ctx.fillRect(-bucketW * 0.5, -bucketH * 0.3, bucketW, bucketH);
        ctx.strokeStyle = '#cbe6ff';
        ctx.lineWidth = 1.4 * scale;
        ctx.strokeRect(-bucketW * 0.5, -bucketH * 0.3, bucketW, bucketH);
        ctx.beginPath();
        ctx.moveTo(-bucketW * 0.35, -bucketH * 0.3);
        ctx.lineTo(bucketW * 0.35, -bucketH * 0.3);
        ctx.stroke();
        ctx.restore();
      }
    }
  });

  registerHumanRig('npc_guardia', {
    totalHeight: 66,
    entityHeight: 64,
    torsoWidth: 20,
    torsoHeight: 34,
    legLength: 22,
    armLength: 22,
    walkCycle: 6.0,
    walkBob: 2.2,
    idleBob: 0.9,
    swayAmp: 0.4,
    lean: 0.06,
    shadowRadius: 13,
    offsetY: -5,
    colors: {
      body: '#2a3442',
      accent: '#445d73',
      head: '#f2cfb4',
      limbs: '#111a26',
      detail: '#05080d'
    },
    extraUpdate(st){
      const tilt = st.moving ? 0.01 : 0.03 * Math.sin(st.time * 0.8);
      st.headTiltTarget = tilt;
    },
    extraDraw(ctx, st, helper, stage){
      if (stage === 'afterTorso'){
        const { dims } = helper;
        ctx.save();
        ctx.fillStyle = '#5d7cad';
        ctx.fillRect(-dims.torsoW * 0.15, dims.torsoTop + dims.torsoH * 0.35, dims.torsoW * 0.3, dims.torsoH * 0.2);
        ctx.restore();
      }
      if (stage === 'afterHead'){
        const { dims, scale } = helper;
        ctx.save();
        const brimY = dims.headCenterY - dims.headR - scale * 2.3;
        ctx.fillStyle = '#121a25';
        ctx.fillRect(-dims.headR * 0.95, brimY, dims.headR * 1.9, scale * 2);
        ctx.fillStyle = '#3b4c63';
        ctx.fillRect(-dims.headR * 0.6, brimY - scale * 1.8, dims.headR * 1.2, scale * 1.4);
        ctx.restore();
      }
    }
  });

  registerHumanRig('npc_medico', {
    totalHeight: 62,
    entityHeight: 60,
    torsoWidth: 18,
    torsoHeight: 30,
    legLength: 22,
    armLength: 21,
    walkCycle: 6.4,
    walkBob: 2.8,
    idleBob: 1.0,
    swayAmp: 0.5,
    lean: 0.05,
    shadowRadius: 12,
    offsetY: -4,
    colors: {
      body: '#f8feff',
      accent: '#8adffc',
      head: '#f4cfba',
      limbs: '#1d3342',
      detail: '#0a1117'
    },
    extraUpdate(st){
      const tilt = st.moving ? 0.02 * Math.sin(st.phase * 0.6) : 0.14 * Math.sin(st.time * 0.45);
      st.headTiltTarget = tilt;
      if (!st.moving){
        const look = Math.sin(st.time * 0.6) * 0.15;
        st.headTurn += (look - st.headTurn) * 0.18;
      }
    },
    extraDraw(ctx, st, helper, stage){
      if (stage === 'afterTorso'){
        const { dims, scale } = helper;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(-dims.torsoW * 0.15, dims.torsoTop + dims.torsoH * 0.1, dims.torsoW * 0.3, dims.torsoH * 0.25);
        ctx.strokeStyle = '#6bb0c8';
        ctx.lineWidth = 1.2 * scale;
        ctx.beginPath();
        ctx.arc(-dims.torsoW * 0.3, dims.torsoTop + dims.torsoH * 0.2, 3.5 * scale, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(-dims.torsoW * 0.05, dims.torsoTop + dims.torsoH * 0.4, 4 * scale, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
  });

  registerHumanRig('npc_supervisora', {
    totalHeight: 60,
    entityHeight: 58,
    torsoWidth: 18,
    torsoHeight: 30,
    legLength: 20,
    armLength: 20,
    walkCycle: 6.1,
    walkBob: 2.0,
    idleBob: 0.5,
    swayAmp: 0.7,
    scale: 0.98,
    shadowRadius: 11,
    offsetY: -3,
    colors: {
      body: '#c7b9ff',
      accent: '#8a78d7',
      head: '#f5d2c4',
      limbs: '#2a2135',
      detail: '#120c19'
    },
    extraUpdate(st, e, dt){
      const target = e?.dialogTarget || e?.talkTarget || e?.target;
      let desired = 0;
      if (target && typeof target.x === 'number'){
        const targetX = (target.x || 0) + (target.w || 0) * 0.5;
        const selfX = (e?.x || 0) + (e?.w || 0) * 0.5;
        desired = Math.max(-0.35, Math.min(0.35, (targetX - selfX) * 0.0015));
      }
      st.headTurn += (desired - st.headTurn) * Math.min(1, dt * 6);
      st.headTiltTarget = st.moving ? 0.02 : 0.05 * Math.sin(st.time * 0.8);
    },
    extraDraw(ctx, st, helper, stage){
      if (stage === 'afterTorso'){
        const { dims } = helper;
        ctx.save();
        ctx.fillStyle = '#fefefe';
        ctx.beginPath();
        ctx.moveTo(-dims.torsoW * 0.45, dims.torsoTop + 3);
        ctx.lineTo(0, dims.torsoTop + dims.torsoH * 0.3);
        ctx.lineTo(dims.torsoW * 0.45, dims.torsoTop + 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  });

  registerHumanRig('npc_tcae', {
    totalHeight: 60,
    entityHeight: 58,
    torsoWidth: 18,
    torsoHeight: 28,
    legLength: 22,
    armLength: 20,
    walkCycle: 6.3,
    walkBob: 2.7,
    idleBob: 1.1,
    swayAmp: 0.6,
    lean: 0.04,
    shadowRadius: 12,
    offsetY: -4,
    colors: {
      body: '#cfe6ff',
      accent: '#5aa4ff',
      head: '#f4cfb8',
      limbs: '#25354a',
      detail: '#101b24'
    },
    extraDraw(ctx, st, helper, stage){
      if (stage === 'afterTorso'){
        const { dims, scale } = helper;
        ctx.save();
        ctx.strokeStyle = '#7fc0ff';
        ctx.lineWidth = 1.2 * scale;
        ctx.strokeRect(-dims.torsoW * 0.4, dims.torsoTop + dims.torsoH * 0.35, dims.torsoW * 0.25, dims.torsoH * 0.2);
        ctx.restore();
      }
    }
  });

  registerHumanRig('npc_enfermera_sexy', {
    totalHeight: 66,
    entityHeight: 64,
    torsoWidth: 14,
    torsoHeight: 34,
    legLength: 28,
    armLength: 24,
    walkCycle: 7.6,
    walkBob: 3.4,
    idleBob: 1.2,
    swayAmp: 1.3,
    lateralAmp: 0.35,
    lean: 0.09,
    shadowRadius: 12,
    offsetY: -4,
    colors: {
      body: '#ff5fa2',
      accent: '#ffbbdd',
      head: '#f4c4c0',
      limbs: '#2a1424',
      detail: '#210714'
    },
    extraUpdate(st){
      st.hip = Math.sin(st.phase * 1.4) * 0.3;
      st.headTiltTarget = 0.1 * Math.sin(st.phase * 0.6);
      st.headTurn += (Math.sin(st.phase * 0.8) * 0.2 - st.headTurn) * 0.12;
    },
    extraDraw(ctx, st, helper, stage){
      if (stage === 'afterTorso'){
        const { dims } = helper;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(-dims.torsoW * 0.3, dims.torsoTop + dims.torsoH * 0.2, dims.torsoW * 0.6, dims.torsoH * 0.3);
        ctx.restore();
      }
    }
  });

  registerHumanRig('npc_familiar_molesto', {
    totalHeight: 60,
    entityHeight: 58,
    torsoWidth: 18,
    torsoHeight: 30,
    legLength: 20,
    armLength: 20,
    walkCycle: 6.8,
    walkBob: 2.9,
    idleBob: 1.3,
    swayAmp: 0.9,
    shadowRadius: 11,
    offsetY: -5,
    colors: {
      body: '#9b9b85',
      accent: '#c7c091',
      head: '#f0d6b9',
      limbs: '#3b3a2c',
      detail: '#19160f'
    },
    extraUpdate(st, e, dt){
      st._errTimer = (st._errTimer || 0) - dt;
      if (st._errTimer <= 0){
        st._errTimer = 1.4 + Math.random() * 1.8;
        st._errCycle = 6.8 + (Math.random() - 0.5) * 1.0;
      }
      if (st.moving){
        st.walkCycleOverride = st._errCycle || 6.8;
        st.bobOverride = 2.9 * (1 + Math.sin(st.time * 4.2) * 0.1);
        st.zigzag = Math.sin(st.time * 6.3 + st.phase) * 0.5;
      } else {
        st.walkCycleOverride = null;
        st.bobOverride = null;
        st.shakeX = Math.sin(st.time * 9.5) * 0.25;
        st.shakeY = Math.sin(st.time * 11.2) * 0.18;
        st.headTurn += (Math.sin(st.time * 3.4) * 0.35 - st.headTurn) * 0.22;
      }
    },
    extraDraw(ctx, st, helper, stage){
      if (stage === 'afterTorso'){
        const { dims } = helper;
        ctx.save();
        ctx.strokeStyle = 'rgba(90,80,60,0.8)';
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(-dims.torsoW * 0.35, dims.torsoTop + dims.torsoH * 0.45, dims.torsoW * 0.3, dims.torsoH * 0.18);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  });

  registerHumanRig('npc_generic_human', {
    totalHeight: 60,
    entityHeight: 58,
    torsoWidth: 18,
    torsoHeight: 30,
    legLength: 20,
    armLength: 20,
    walkCycle: 6.2,
    walkBob: 2.6,
    idleBob: 1.0,
    swayAmp: 0.5,
    shadowRadius: 11,
    offsetY: -4,
    colors: {
      body: '#6d7a8e',
      accent: '#8895a9',
      head: '#f5d1bb',
      limbs: '#2a3543',
      detail: '#11161c'
    }
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
      if (safeEllipse(ctx, 0, 6 * s, 12 * s + st.belly, 8 * s + st.belly * 0.8, 0, 0, TAU)) ctx.fill();
      ctx.restore();
    },
    shadowRadius: 14,
    offsetY: -6,
    states: makeNPCStates('jefe_servicio.png'),
    resolveState: resolveNPCState
  });

  // legacy rigs pending refactor below

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
        const attended = !!(e?.attended || e?.delivered || e?.dead || e?.hidden);
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
          if (safeEllipse(ctx, 0, 0, w * 0.25, h * 0.18, 0, 0, TAU)) ctx.fill();
          ctx.restore();
        }
        if (fade >= 0.99){
          try { e.rigOk = true; e._disappeared = true; } catch (_) {}
        }
        if (!attended){
          const tagScale = Math.max(0.7, Math.min(1.2, totalScale));
          drawEntityNameTag(ctx, cam, e, {
            scale: tagScale,
            offsetY: cfg.nameTagOffset ?? e?.nameTagYOffset ?? 22
          });
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
    offsetY: -6,
    showNameTag: true
  });

  registerHumanRig('patient_furiosa', {
    totalHeight: 62,
    entityHeight: 60,
    torsoWidth: 18,
    torsoHeight: 30,
    legLength: 22,
    armLength: 21,
    walkCycle: 8.0,
    walkBob: 3.5,
    idleBob: 1.4,
    swayAmp: 0.9,
    lean: 0.18,
    shadowRadius: 12,
    offsetY: -5,
    showNameTag: true,
    colors: {
      body: '#e0372f',
      accent: '#ff7c68',
      head: '#f0b4a6',
      limbs: '#4a0f12',
      detail: '#1a0406'
    },
    extraUpdate(st){
      const enraged = st.speed > 45;
      if (enraged){
        st.colorPulse = 0.4 + 0.3 * (0.5 + 0.5 * Math.sin(st.time * 6));
      }
      if (!st.moving){
        st.shakeX = Math.sin(st.time * 13) * 0.22;
        st.shakeY = Math.sin(st.time * 17) * 0.18;
      }
      st.headTiltTarget = st.moving ? 0.05 * Math.sin(st.phase * 0.8) : 0.02 * Math.sin(st.time * 5);
    },
    extraDraw(ctx, st, helper, stage){
      if (stage === 'afterTorso' && st.colorPulse > 0){
        const { dims } = helper;
        ctx.save();
        ctx.globalAlpha = Math.min(0.75, st.colorPulse);
        ctx.fillStyle = 'rgba(255,64,64,1)';
        ctx.fillRect(-dims.torsoW * 0.5, dims.torsoTop, dims.torsoW, dims.torsoH);
        ctx.restore();
      }
    },
    onHeadDraw(ctx, st, helper){
      const { dims, colors } = helper;
      ctx.save();
      ctx.strokeStyle = colors.detail;
      ctx.lineWidth = dims.headR * 0.18;
      const browY = -dims.headR * 0.25;
      ctx.beginPath();
      ctx.moveTo(-dims.eyeSpacing, browY + dims.headR * 0.05);
      ctx.lineTo(-dims.eyeSpacing * 0.2, browY - dims.headR * 0.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(dims.eyeSpacing, browY + dims.headR * 0.05);
      ctx.lineTo(dims.eyeSpacing * 0.2, browY - dims.headR * 0.1);
      ctx.stroke();
      const mouthY = dims.headR * 0.45;
      ctx.beginPath();
      ctx.moveTo(-dims.headR * 0.35, mouthY + dims.headR * 0.15);
      ctx.lineTo(dims.headR * 0.35, mouthY - dims.headR * 0.05);
      ctx.stroke();
      ctx.restore();
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
        const s = applyOneTileScale(sc, { designSize: 48, inner: 0.94 });
        ctx.save();
        ctx.translate(cx, cy + st.bob * 0.35 * s);
        drawShadow(ctx, 10, s, 0.28, 0.22);
        ctx.translate(0, -4 * s);
        // Paleta inspirada en assets/images/raton.png: pelaje gris y orejas rosadas.
        ctx.fillStyle = '#7f7869';
        ctx.beginPath();
        if (safeEllipse(ctx, -4 * s, 4 * s, 12 * s, 7 * s, 0, 0, TAU)) ctx.fill();
        ctx.fillStyle = '#9f9484';
        ctx.beginPath();
        if (safeEllipse(ctx, 4 * s, 5 * s, 9 * s, 6 * s, 0, 0, TAU)) ctx.fill();
        ctx.save();
        ctx.strokeStyle = '#c37c6b';
        ctx.lineWidth = 2.2 * s;
        ctx.beginPath();
        ctx.moveTo(-14 * s, 4 * s);
        ctx.quadraticCurveTo(-22 * s, 4 * s + st.tail * 8 * s, -28 * s, 10 * s);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#c3b9aa';
        ctx.beginPath();
        if (safeEllipse(ctx, 12 * s + st.lunge * 2 * s, 2 * s, 6.8 * s, 5.4 * s, 0, 0, TAU)) ctx.fill();
        ctx.fillStyle = '#f7a6b5';
        ctx.beginPath();
        if (safeEllipse(ctx, 15 * s, -1.6 * s, 2.6 * s, 2.6 * s, 0, 0, TAU)) ctx.fill();
        ctx.fillStyle = '#27272b';
        ctx.beginPath();
        if (safeEllipse(ctx, 9.8 * s, -0.5 * s, 1.2 * s, 1.6 * s, 0, 0, TAU)) ctx.fill();
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
        wingAmp: 0,
        sting: 0,
        drop: 0,
        dropSpeed: 0,
        rotation: 0
      };
    },
    update(st, e, dt){
      const speed = Math.hypot(e?.vx || 0, e?.vy || 0);
      const dead = !!(e?.dead);
      const attacking = !dead && speed >= 24;
      st.time += dt;
      const wingSpeed = attacking ? 28 : 22;
      const desiredAmp = dead ? 0 : (attacking ? 1.2 : 0.9);
      st.phase = (st.phase + dt * wingSpeed) % TAU;
      st.wingAmp += (desiredAmp - st.wingAmp) * Math.min(1, dt * (dead ? 8 : 6));
      if (st.wingAmp < 0) st.wingAmp = 0;
      st.wing = Math.sin(st.phase) * st.wingAmp;
      const bobFreq = attacking ? 9 : 6;
      const bobAmp = attacking ? 1.6 : 3.8;
      const targetBob = Math.sin(st.time * bobFreq) * bobAmp;
      st.bob += (targetBob - st.bob) * Math.min(1, dt * 6);
      if (attacking) st.sting = Math.min(1.4, st.sting + dt * 5.2);
      else st.sting = Math.max(0, st.sting - dt * 3.4);
      if (dead){
        st.dropSpeed = Math.min(st.dropSpeed + dt * 320, 520);
        st.drop = Math.min(st.drop + st.dropSpeed * dt, 48);
        st.rotation = Math.min(st.rotation + dt * 4.4, 1.2);
      } else {
        st.dropSpeed = Math.max(0, st.dropSpeed - dt * 260);
        st.drop = Math.max(0, st.drop - dt * 90);
        if (st.drop < 0.2) st.drop = 0;
        st.rotation *= Math.max(0, 1 - dt * 6);
      }
    },
    draw(ctx, cam, e, st){
      const [cx, cy, sc] = toScreen(cam, e);
      const s = applyOneTileScale(sc, { designSize: 44, inner: 0.9 });
      ctx.save();
      ctx.translate(cx, cy + st.drop);
      const shadowAlpha = 0.2 * Math.max(0.1, 1 - Math.min(st.drop / 48, 1));
      drawShadow(ctx, 8, s, 0.28, shadowAlpha);
      ctx.translate(0, -8 * s + st.bob * 0.25 * s);
      ctx.rotate((st.drop > 0.5 ? st.rotation : st.sting * 0.1));
      ctx.globalAlpha = 0.3 + Math.abs(st.wing) * 0.4;
      // Tonos extraídos de assets/images/mosquito.png: alas azuladas y cuerpo oscuro.
      ctx.fillStyle = '#d2f3ff';
      ctx.beginPath();
      if (safeEllipse(ctx, -4.5 * s, -6 * s, 5 * s * (1 + st.wing * 0.3), 11 * s, -0.45, 0, TAU)) ctx.fill();
      ctx.beginPath();
      if (safeEllipse(ctx, 4.5 * s, -6 * s, 5 * s * (1 - st.wing * 0.3), 11 * s, 0.45, 0, TAU)) ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#646464';
      ctx.beginPath();
      if (safeEllipse(ctx, -3 * s, 0, 6 * s, 3.5 * s, 0.2, 0, TAU)) ctx.fill();
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath();
      if (safeEllipse(ctx, 6 * s, -1.6 * s, 3 * s, 3.4 * s, 0, 0, TAU)) ctx.fill();
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
    if (typeof st.openProgress === 'number') return clamp01(st.openProgress);
    if (typeof e?.openProgress === 'number') return clamp01(e.openProgress);
    if (typeof st.open === 'number') return clamp01(st.open);
    if (typeof e?.open === 'number') return clamp01(e.open);
    const open = (typeof st.open === 'boolean') ? st.open : ((typeof e?.open === 'boolean') ? e.open : false);
    return open ? 1 : 0;
  }

  function resolveDoorTarget(e){
    const st = e?.state || {};
    if (typeof st.targetOpen === 'number') return clamp01(st.targetOpen);
    if (typeof st.openProgress === 'number') return clamp01(st.openProgress);
    if (typeof st.open === 'number') return clamp01(st.open);
    if (typeof st.open === 'boolean') return st.open ? 1 : 0;
    if (typeof e?.openProgress === 'number') return clamp01(e.openProgress);
    if (typeof e?.open === 'number') return clamp01(e.open);
    if (typeof e?.holdOpen === 'boolean' && e.holdOpen) return 1;
    return (typeof e?.open === 'boolean' ? e.open : false) ? 1 : 0;
  }

  // Paleta derivada de assets/images/puerta_cerrada.png y puerta_abiertas.png
  const DOOR_PALETTE = {
    frame: '#dbe7f4',
    crown: '#5ad1cf',
    panel: '#4ea7b9',
    glass: '#9fe6dc',
    stripe: '#f6fbff',
    handle: '#ffe9c7',
    shadow: '#0b1b1c'
  };

  const doorRig = {
    create(e){
      const initial = doorProgress(e);
      return {
        openProgress: initial,
        target: initial,
        phase: Math.random() * TAU,
        handlePulse: 0,
        fade: 1
      };
    },
    update(st, e, dt){
      if (!st) return;
      const target = resolveDoorTarget(e);
      st.target = target;
      if (!Number.isFinite(st.openProgress)) st.openProgress = doorProgress(e);
      const speed = Math.max(0.5, Number(e?.openSpeed) || 6);
      if (st.openProgress < target) st.openProgress = Math.min(target, st.openProgress + speed * dt);
      else if (st.openProgress > target) st.openProgress = Math.max(target, st.openProgress - speed * dt);
      st.phase = (st.phase + dt * 6) % TAU;
      st.handlePulse = 0.6 + 0.4 * Math.sin(st.phase);
      st.fade = clamp01(Number(e?.alpha) ?? 1);
    },
    draw(ctx, cam, e, st){
      const [cx, cy, sc] = toScreen(cam, e);
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(sc)){
        const tile = window.G?.TILE_SIZE || 32;
        ctx.fillStyle = '#6c5a45';
        ctx.fillRect(Number(e?.x) || 0, Number(e?.y) || 0, e?.w || tile, e?.h || tile);
        return;
      }
      const unit = applyOneTileScale(sc, { designSize: BASE_TILE_UNITS, inner: 0.96 });
      const w = BASE_TILE_UNITS * unit;
      const h = BASE_TILE_UNITS * unit;
      const progress = clamp01(st?.openProgress ?? doorProgress(e));
      const fade = clamp01(st?.fade ?? 1);
      ctx.save();
      ctx.translate(cx, cy + h * 0.08);
      drawShadow(ctx, BASE_TILE_UNITS * 0.3, unit, 0.24, 0.2 * fade);
      ctx.translate(0, -h * 0.52);
      const frameW = w * 0.94;
      const frameH = h * 0.94;
      ctx.fillStyle = DOOR_PALETTE.shadow;
      ctx.fillRect(-frameW * 0.55, -h * 0.08, frameW * 1.1, frameH + h * 0.18);
      ctx.fillStyle = DOOR_PALETTE.frame;
      ctx.fillRect(-frameW * 0.5, 0, frameW, frameH);
      ctx.fillStyle = DOOR_PALETTE.crown;
      ctx.fillRect(-frameW * 0.5, -frameH * 0.08, frameW, frameH * 0.16);
      const panelH = frameH * 0.88;
      const basePanelW = frameW * 0.42;
      const shrink = Math.max(frameW * 0.08, basePanelW * (1 - 0.7 * progress));
      const slide = frameW * 0.12 * progress;
      const handlePulse = 0.35 + 0.25 * (st?.handlePulse ?? 0.8);
      const drawPanel = (dir) => {
        ctx.save();
        const offsetX = dir * (slide + shrink * 0.5 + frameW * 0.02);
        ctx.translate(offsetX, frameH * 0.05);
        ctx.fillStyle = DOOR_PALETTE.panel;
        ctx.fillRect(-shrink * 0.5, 0, shrink, panelH);
        ctx.strokeStyle = 'rgba(5,24,29,0.28)';
        ctx.lineWidth = Math.max(1.5, 2 * sc);
        ctx.beginPath();
        ctx.moveTo(-shrink * 0.5 + 2 * sc, panelH * 0.2);
        ctx.lineTo(-shrink * 0.5 + 2 * sc, panelH * 0.8);
        ctx.moveTo(shrink * 0.5 - 2 * sc, panelH * 0.2);
        ctx.lineTo(shrink * 0.5 - 2 * sc, panelH * 0.8);
        ctx.stroke();
        ctx.fillStyle = DOOR_PALETTE.stripe;
        ctx.globalAlpha = 0.6 - progress * 0.2;
        ctx.fillRect(-shrink * 0.42, panelH * 0.15, shrink * 0.84, panelH * 0.1);
        ctx.globalAlpha = 1;
        ctx.fillStyle = DOOR_PALETTE.handle;
        const handleW = Math.max(2.5 * sc, shrink * 0.08);
        const handleH = Math.max(4 * sc, panelH * 0.08);
        ctx.globalAlpha = fade * (0.5 + 0.5 * handlePulse);
        ctx.fillRect(dir * shrink * 0.12 - handleW * 0.5, panelH * 0.52, handleW, handleH);
        ctx.restore();
      };
      ctx.globalAlpha = fade;
      drawPanel(-1);
      drawPanel(1);
      ctx.globalAlpha = Math.max(0.15, 0.4 * (1 - progress)) * fade;
      ctx.fillStyle = 'rgba(11,17,22,0.25)';
      ctx.fillRect(-frameW * 0.5, 0, frameW, frameH);
      if (progress > 0){
        ctx.globalAlpha = 0.3 * progress * fade;
        const lightGrad = ctx.createLinearGradient(-frameW * 0.3, frameH * 0.5, frameW * 0.3, frameH * 0.5);
        safeColorStop(lightGrad, 0, `${DOOR_PALETTE.glass}00`);
        safeColorStop(lightGrad, 0.5, `${DOOR_PALETTE.glass}cc`);
        safeColorStop(lightGrad, 1, `${DOOR_PALETTE.glass}00`);
        ctx.fillStyle = lightGrad;
        ctx.fillRect(-frameW * 0.5, 0, frameW, frameH);
      }
      ctx.restore();
    }
  };

  API.registerRig('door', doorRig);
  API.registerRig('door_urgencias', doorRig);

  const elevatorRig = {
    create(e){
      const initial = doorProgress(e);
      return {
        openProgress: initial,
        target: initial,
        phase: Math.random() * TAU
      };
    },
    update(st, e, dt){
      if (!st) return;
      const target = resolveDoorTarget(e);
      st.target = target;
      if (!Number.isFinite(st.openProgress)) st.openProgress = doorProgress(e);
      const speed = Math.max(0.5, Number(e?.openSpeed) || 5);
      if (st.openProgress < target) st.openProgress = Math.min(target, st.openProgress + speed * dt);
      else if (st.openProgress > target) st.openProgress = Math.max(target, st.openProgress - speed * dt);
      st.phase = (st.phase + dt * 2.4) % TAU;
    },
    draw(ctx, cam, e, st){
      const [cx, cy, sc] = toScreen(cam, e);
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(sc)){
        const tile = window.G?.TILE_SIZE || 32;
        ctx.fillStyle = '#90969e';
        ctx.fillRect(Number(e?.x) || 0, Number(e?.y) || 0, e?.w || tile, e?.h || tile);
        return;
      }
      const w = Math.max(20, (e.w || 48) * sc);
      const h = Math.max(30, (e.h || 64) * sc);
      const progress = clamp01(st?.openProgress ?? doorProgress(e));
      ctx.save();
      ctx.translate(cx, cy + h * 0.08);
      const elevatorShadowRadius = Math.max(10, (e.w || 48) * 0.28);
      drawShadow(ctx, elevatorShadowRadius, sc, 0.24, 0.2);
      ctx.translate(0, -h * 0.6);
      const shaftW = w * 0.88;
      const shaftH = h * 0.94;
      ctx.fillStyle = '#1f232a';
      ctx.fillRect(-shaftW * 0.58, -h * 0.08, shaftW * 1.16, shaftH + h * 0.16);
      ctx.fillStyle = '#444a55';
      ctx.fillRect(-shaftW * 0.5, 0, shaftW, shaftH);
      ctx.fillStyle = '#2a3038';
      ctx.fillRect(-shaftW * 0.5, -shaftH * 0.08, shaftW, shaftH * 0.12);
      ctx.fillStyle = 'rgba(10,15,30,0.5)';
      ctx.fillRect(-shaftW * 0.48, shaftH * 0.05, shaftW * 0.96, shaftH * 0.75);
      const cabH = shaftH * 0.86;
      const cabW = shaftW * 0.4;
      const slide = shaftW * 0.22 * progress;
      const glow = 0.3 + 0.2 * Math.sin((st?.phase ?? 0) * 2 + progress * 2);
      const drawPanel = (dir) => {
        ctx.save();
        const offsetX = dir * (slide + cabW * 0.5 + shaftW * 0.02);
        ctx.translate(offsetX, shaftH * 0.05);
        ctx.fillStyle = '#aeb5c2';
        ctx.fillRect(-cabW * 0.5, 0, cabW, cabH);
        const inset = cabW * 0.15;
        ctx.fillStyle = '#cfd5df';
        ctx.fillRect(-cabW * 0.5 + inset, cabH * 0.08, cabW - inset * 2, cabH * 0.2);
        ctx.fillStyle = '#8f96a4';
        ctx.fillRect(-cabW * 0.5 + inset, cabH * 0.35, cabW - inset * 2, cabH * 0.56);
        ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.2 * (1 - progress)})`;
        ctx.fillRect(-cabW * 0.5, 0, cabW, cabH);
        ctx.restore();
      };
      ctx.globalAlpha = 1;
      drawPanel(-1);
      drawPanel(1);
      if (progress > 0){
        const innerGlow = ctx.createLinearGradient(0, cabH * 0.4, 0, cabH);
        safeColorStop(innerGlow, 0, `rgba(255,255,230,${0.05 + 0.25 * progress})`);
        safeColorStop(innerGlow, 1, `rgba(255,210,140,${0.1 * progress})`);
        ctx.fillStyle = innerGlow;
        ctx.fillRect(-shaftW * 0.35, shaftH * 0.08, shaftW * 0.7, cabH * 0.7);
      }
      ctx.globalAlpha = Math.max(0.18, 0.35 * (1 - progress));
      ctx.strokeStyle = `rgba(240,250,255,${0.4 + 0.3 * glow})`;
      ctx.lineWidth = 2.5 * sc;
      ctx.strokeRect(-shaftW * 0.45, -shaftH * 0.02, shaftW * 0.9, shaftH * 1.02);
      ctx.restore();
    }
  };

  API.registerRig('elevator', elevatorRig);

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
      ctx.beginPath();
      if (safeEllipse(ctx, -8 * s, 0, 5 * s, 3 * s, 0, 0, TAU)) ctx.fill();
      ctx.fillStyle = `rgba(70,140,255,${0.6 + 0.4 * (1 - pulse)})`;
      ctx.beginPath();
      if (safeEllipse(ctx, 8 * s, 0, 5 * s, 3 * s, 0, 0, TAU)) ctx.fill();
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
    create(){
      return {
        phase: Math.random() * TAU,
        pulse: 1,
        intensity: 1,
        scale: 1
      };
    },
    update(st, e, dt){
      if (!st) return;
      st.phase = (st.phase + dt * 10) % TAU;
      st.pulse = 0.7 + 0.3 * Math.sin(st.phase);
      const alive = !e?.dead;
      if (alive){
        st.intensity = Math.min(1, (st.intensity ?? 1) + dt * 3);
      } else {
        st.intensity = Math.max(0, (st.intensity ?? 0) - dt * 2.5);
      }
      st.scale = 0.9 + 0.15 * Math.sin(st.phase * 0.5);
    },
    draw(ctx, cam, e, st){
      if (!st || (st.intensity ?? 0) <= 0){
        return;
      }
      const [cx, cy, sc] = toScreen(cam, e);
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(sc)){
        const tile = window.G?.TILE_SIZE || 32;
        ctx.fillStyle = 'rgba(255,140,40,0.8)';
        ctx.fillRect(Number(e?.x) || 0, Number(e?.y) || 0, e?.w || tile, e?.h || tile);
        return;
      }
      const size = Math.max(e?.w || 20, e?.h || 30) * sc * 0.8 * (st.scale ?? 1);
      ctx.save();
      ctx.translate(cx, cy + size * 0.3);
      drawShadow(ctx, size * 0.35, 1, 0.26, 0.22 * (st.intensity ?? 1));
      ctx.translate(0, -size * 0.7);
      const intensity = clamp01(st.intensity ?? 1);
      const pulse = st.pulse ?? 1;
      ctx.globalAlpha = intensity;
      ctx.fillStyle = `rgba(255,160,60,${0.7 * intensity})`;
      ctx.beginPath();
      ctx.moveTo(0, -size * (0.6 + 0.15 * pulse));
      ctx.bezierCurveTo(size * 0.3, -size * 0.1, size * 0.25, size * 0.4, 0, size * 0.55);
      ctx.bezierCurveTo(-size * 0.25, size * 0.4, -size * 0.3, -size * 0.1, 0, -size * (0.6 + 0.15 * pulse));
      ctx.fill();
      ctx.fillStyle = `rgba(255,230,180,${0.45 * intensity})`;
      ctx.beginPath();
      ctx.moveTo(0, -size * (0.3 + 0.08 * pulse));
      ctx.bezierCurveTo(size * 0.18, -size * 0.04, size * 0.14, size * 0.2, 0, size * 0.32);
      ctx.bezierCurveTo(-size * 0.14, size * 0.2, -size * 0.18, -size * 0.04, 0, -size * (0.3 + 0.08 * pulse));
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  });

  API.registerRig('hazard_water', {
    create(){
      return {
        phase: Math.random() * TAU,
        ripple: 1,
        alpha: 1,
        size: 1
      };
    },
    update(st, e, dt){
      if (!st) return;
      st.phase = (st.phase + dt * 4) % TAU;
      st.ripple = 1 + 0.08 * Math.sin(st.phase);
      if (e?.dead){
        st.alpha = Math.max(0, (st.alpha ?? 1) - dt * 1.5);
        st.size = Math.max(0, (st.size ?? 1) - dt * 0.8);
      } else {
        st.alpha = Math.min(1, (st.alpha ?? 1) + dt * 0.5);
        st.size = Math.min(1, (st.size ?? 1) + dt * 0.5);
      }
    },
    draw(ctx, cam, e, st){
      const alpha = clamp01(st?.alpha ?? 1);
      if (alpha <= 0) return;
      const [cx, cy, sc] = toScreen(cam, e);
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(sc)){
        const tile = window.G?.TILE_SIZE || 32;
        ctx.fillStyle = 'rgba(110,160,230,0.45)';
        ctx.fillRect(Number(e?.x) || 0, Number(e?.y) || 0, e?.w || tile, e?.h || tile);
        return;
      }
      const baseW = Math.max(18, (e.w || 24) * sc) * (st?.size ?? 1);
      const baseH = Math.max(12, (e.h || 24) * sc) * (st?.size ?? 1);
      const ripple = st?.ripple ?? 1;
      ctx.save();
      ctx.translate(cx, cy);
      drawShadow(ctx, baseW * 0.32, 1, 0.2, 0.14 * alpha);
      ctx.fillStyle = `rgba(110,160,230,${0.45 * alpha})`;
      ctx.beginPath();
      const rx = baseW * 0.5 * ripple;
      const ry = baseH * 0.35 * ripple;
      if (safeEllipse(ctx, 0, 0, rx, ry, 0, 0, TAU)) ctx.fill();
      ctx.fillStyle = `rgba(200,230,255,${0.3 * alpha})`;
      ctx.beginPath();
      if (safeEllipse(ctx, -baseW * 0.15, -baseH * 0.1, rx * 0.5, ry * 0.5, 0, 0, TAU)) ctx.fill();
      ctx.restore();
    }
  });

  API.registerRig('explosion', {
    create(){
      return { time: 0, scale: 1, alpha: 1 };
    },
    update(st, e, dt){
      if (!st) return;
      st.time += dt;
      if (st.time <= 0.2){
        st.scale = 1 + 4 * st.time;
        st.alpha = Math.max(0, 1 - st.time / 0.2);
      } else {
        st.alpha = 0;
        if (e) e.dead = true;
      }
    },
    draw(ctx, cam, e, st){
      if (!st || (st.alpha ?? 0) <= 0) return;
      const [cx, cy, sc] = toScreen(cam, e);
      if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(sc)){
        const tile = window.G?.TILE_SIZE || 32;
        ctx.fillStyle = 'rgba(255,200,80,0.6)';
        ctx.fillRect(Number(e?.x) || 0, Number(e?.y) || 0, e?.w || tile, e?.h || tile);
        return;
      }
      const radius = Math.max(12, (Math.max(e?.w || 16, e?.h || 16) * 0.6 + 6) * sc * (st.scale ?? 1));
      ctx.save();
      ctx.translate(cx, cy);
      const grad = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius);
      safeColorStop(grad, 0, `rgba(255,255,210,${0.8 * st.alpha})`);
      safeColorStop(grad, 0.4, `rgba(255,200,90,${0.6 * st.alpha})`);
      safeColorStop(grad, 1, `rgba(255,120,40,0)`);
      ctx.globalAlpha = st.alpha;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
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
      if (safeEllipse(ctx, 0, st.drop, 3 * total, 4.5 * total, 0, 0, TAU)) ctx.fill();
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
      safeColorStop(grad, 0, safeRGBA(255, 255, 210, 0.45 * st.intensity * st.flick));
      safeColorStop(grad, 1, safeRGBA(255, 255, 210, 0));
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

  try {
    if (window.DEBUG_COLLISIONS) {
      console.info('[BOOT_CHECK] puppet.rigs.plugin.js OK – HERO_ACTION_CLASS_MAP definido una única vez, juego arrancando sin errores de sintaxis');
    }
  } catch (_) {}
})();
