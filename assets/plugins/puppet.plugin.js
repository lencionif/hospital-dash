// puppet.plugin.js - rig humano sencillo
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rigs = new Set();
  const headCache = new Map();

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function setHeroHead(rig, heroKey = 'enrique') {
    if (!rig?.parts?.head) return null;
    const key = (heroKey || 'enrique').toLowerCase();
    if (headCache.has(key)) {
      const cached = headCache.get(key);
      rig.parts.head.img = cached.front;
      rig.parts.head.imgBack = cached.back;
      return cached;
    }
    const front = new Image();
    const back = new Image();
    front.src = `assets/images/${key}.png`;
    back.src = `assets/images/${key}_back.png`;
    const store = { front, back };
    headCache.set(key, store);
    front.onload = () => { rig.parts.head.img = front; };
    back.onload = () => { rig.parts.head.imgBack = back; };
    return store;
  }

  function create(opts = {}) {
    const rig = {
      host: opts.host || null,
      scale: opts.scale || 1,
      rigName: opts.rig || 'human',
      debug: false,
      t: 0,
      walkSpeed: 6,
      armSwing: 12,
      footLift: 6,
      stepStride: 5,
      pushReach: 10,
      pushLean: 2,
      state: { moving: false, pushing: false, dir: 0, face: 'S' },
      parts: {
        head: { r: 12, img: null, imgBack: null, ox: 0, oy: -18 },
        body: { rx: 10, ry: 16, ox: 0, oy: 0 },
        armL: { rx: 4, ry: 12, ox: -10, oy: -2 },
        armR: { rx: 4, ry: 12, ox: 10, oy: -2 },
        legL: { rx: 6, ry: 6, ox: -6, oy: 16 },
        legR: { rx: 6, ry: 6, ox: 6, oy: 16 },
      }
    };
    rigs.add(rig);
    return rig;
  }

  function dirToFace(rad) {
    const a = ((rad % TAU) + TAU) % TAU;
    if (a > Math.PI * 0.25 && a <= Math.PI * 0.75) return 'S';
    if (a > Math.PI * 0.75 && a <= Math.PI * 1.25) return 'W';
    if (a > Math.PI * 1.25 && a <= Math.PI * 1.75) return 'N';
    return 'E';
  }

  function update(rig, dt = 0, hostState = {}) {
    if (!rig) return;
    rig.t += dt;
    const h = rig.host || {};
    const vx = h.vx || 0, vy = h.vy || 0;
    const speed = Math.hypot(vx, vy);

    rig.state.moving = (hostState.moving != null) ? !!hostState.moving : speed > 0.01;
    const pushingFlag = h.isPushing ?? h.pushing ?? (h.pushAnimT > 0);
    rig.state.pushing = (hostState.pushing != null) ? !!hostState.pushing : !!pushingFlag;

    const facingAngle = (typeof hostState.dir === 'number') ? hostState.dir
      : (typeof h.facingAngle === 'number' ? h.facingAngle
      : Math.atan2(vy, vx) || 0);
    rig.state.dir = facingAngle;

    if (typeof hostState.face === 'string') {
      rig.state.face = hostState.face.toUpperCase();
    } else if (typeof h.facing === 'string') {
      rig.state.face = h.facing.toUpperCase();
    } else {
      rig.state.face = dirToFace(facingAngle);
    }
  }

  function fillEllipse(ctx, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
    ctx.fill();
  }

  function drawHead(ctx, part, scale, face) {
    if (!part) return;
    const r = part.r * scale;
    const img = (face === 'N') ? (part.imgBack || part.img) : part.img;
    ctx.save();
    ctx.fillStyle = '#f3c89c';
    fillEllipse(ctx, r, r);
    ctx.clip();
    if (img && img.complete) {
      ctx.drawImage(img, -r, -r, r * 2, r * 2);
    }
    ctx.restore();
  }

  function draw(rig, ctx, camera) {
    if (!rig || !rig.host || !ctx) return;
    const h = rig.host;
    const cam = camera || { x: 0, y: 0, zoom: 1 };
    const s = (rig.scale || 1) * (cam.zoom || 1);
    const cx = (h.x + h.w * 0.5 - cam.x) * cam.zoom + ctx.canvas.width * 0.5;
    const cy = (h.y + h.h * 0.5 - cam.y) * cam.zoom + ctx.canvas.height * 0.5;

    const moving = rig.state.moving;
    const pushT = clamp(h.pushAnimT || 0, 0, 1);
    const pushing = pushT > 0 || rig.state.pushing;
    const phase = rig.t * (rig.walkSpeed || 6) * (moving ? 1 : 0);
    const stepL = Math.sin(phase);
    const stepR = Math.sin(phase + Math.PI);
    const stride = (rig.stepStride || 5) * s;
    const lift = (rig.footLift || 6) * s;
    const armSwing = (rig.armSwing || 12) * 0.02;

    let face = rig.state.face || 'S';
    const flipX = face === 'W' ? -1 : 1;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(flipX, 1);

    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = 'black';
    ctx.scale(1, 0.35);
    fillEllipse(ctx, 18 * s, 10 * s);
    ctx.restore();

    const reach = (rig.pushReach || 10) * pushT * s;
    const lean = (rig.pushLean || 2) * pushT * s;
    const forwardX = face === 'E' ? 1 : face === 'W' ? 1 : 0;
    const forwardY = face === 'S' ? 1 : face === 'N' ? -1 : 0;

    ctx.fillStyle = '#ececec';
    ctx.save();
    ctx.translate(rig.parts.body.ox * s + reach * forwardX, rig.parts.body.oy * s + reach * forwardY);
    fillEllipse(ctx, rig.parts.body.rx * s, rig.parts.body.ry * s);
    ctx.restore();

    const armAngle = pushing ? Math.atan2(forwardY || 0, forwardX || 1) * 0.2 : 0;
    ctx.fillStyle = '#f3c89c';

    ctx.save();
    ctx.translate(rig.parts.armL.ox * s + reach * forwardX, rig.parts.armL.oy * s + reach * forwardY);
    if (!pushing) ctx.rotate(-armSwing * stepL);
    else ctx.translate(lean, 0);
    fillEllipse(ctx, rig.parts.armL.rx * s, rig.parts.armL.ry * s);
    ctx.restore();

    ctx.save();
    ctx.translate(rig.parts.armR.ox * s + reach * forwardX, rig.parts.armR.oy * s + reach * forwardY);
    if (!pushing) ctx.rotate(armSwing * stepR);
    else ctx.translate(lean, 0);
    fillEllipse(ctx, rig.parts.armR.rx * s, rig.parts.armR.ry * s);
    ctx.restore();

    ctx.fillStyle = '#dcdcdc';
    const stepX_L = stride * stepL * (forwardX ? 1 : 0);
    const stepY_L = stride * stepL * (forwardY ? forwardY : 0);
    const stepX_R = stride * stepR * (forwardX ? 1 : 0);
    const stepY_R = stride * stepR * (forwardY ? forwardY : 0);

    ctx.save();
    ctx.translate(rig.parts.legL.ox * s + stepX_L, rig.parts.legL.oy * s + stepY_L - Math.max(0, stepL) * lift);
    fillEllipse(ctx, rig.parts.legL.rx * s, rig.parts.legL.ry * s);
    ctx.restore();

    ctx.save();
    ctx.translate(rig.parts.legR.ox * s + stepX_R, rig.parts.legR.oy * s + stepY_R - Math.max(0, stepR) * lift);
    fillEllipse(ctx, rig.parts.legR.rx * s, rig.parts.legR.ry * s);
    ctx.restore();

    ctx.save();
    ctx.translate(rig.parts.head.ox * s + reach * forwardX, rig.parts.head.oy * s + reach * forwardY - (moving ? 1.5 * s : 0));
    drawHead(ctx, rig.parts.head, s, face);
    ctx.restore();

    if (rig.debug) {
      ctx.strokeStyle = 'rgba(0,255,0,0.6)';
      ctx.beginPath(); ctx.moveTo(-20 * s, 0); ctx.lineTo(20 * s, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -30 * s); ctx.lineTo(0, 30 * s); ctx.stroke();
    }

    ctx.restore();
  }

  function attach(entity, opts = {}) {
    if (!entity) return null;
    const rig = create({ host: entity, scale: opts.scale || 1, rig: opts.rig || 'human' });
    entity.rig = rig;
    entity.puppetState = rig;
    entity.puppet = opts;
    return rig;
  }

  function detach(entity) {
    if (!entity?.rig) return;
    rigs.delete(entity.rig);
    delete entity.rig;
    delete entity.puppetState;
  }

  function toggleDebug() {
    const next = !PuppetAPI._debugFlag;
    PuppetAPI._debugFlag = next;
    rigs.forEach(r => r.debug = next);
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyJ') toggleDebug();
  });

  window.PuppetAPI = { create, update, draw, attach, detach, setHeroHead, toggleDebug };
})();
