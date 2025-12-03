// puppet.rigs.plugin.js - rigs adicionales para PuppetAPI (mosquito chibi)
(function () {
  'use strict';

  const W = typeof window !== 'undefined' ? window : globalThis;
  const PuppetAPI = W.PuppetAPI;
  if (!PuppetAPI || typeof PuppetAPI.registerRig !== 'function') return;

  const TAU = Math.PI * 2;

  function baseCoords(ctx, host, camera) {
    const cam = camera || { x: 0, y: 0, zoom: 1 };
    const canvas = ctx?.canvas || { width: 0, height: 0 };
    const x = (host.x + (host.w || 0) * 0.5 - cam.x) * cam.zoom + canvas.width * 0.5;
    const y = (host.y + (host.h || 0) * 0.5 - cam.y) * cam.zoom + canvas.height * 0.5;
    return { x, y, cam };
  }

  function drawEllipse(ctx, rx, ry, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawWing(ctx, rx, ry, angle, alpha) {
    ctx.save();
    ctx.rotate(angle);
    drawEllipse(ctx, rx, ry, '#fff7d1', alpha);
    ctx.restore();
  }

  // Rig chibi para Limpiadora top-down.
  PuppetAPI.registerRig('npc_cleaner', {
    create(host) {
      return { t: 0, walk: 0, attack: 0, squash: 0, anim: host?.state || 'idle', flip: 1 };
    },
    update(st, host, dt = 0) {
      if (!st || !host) return;
      st.t += dt;
      const dead = host.dead;
      st.anim = dead ? `death_${host.deathCause || 'damage'}` : (host.state || 'idle');
      const moving = Math.abs(host.vx || 0) + Math.abs(host.vy || 0) > 0.1;
      st.walk += dt * (moving ? 7 : 3);
      st.attack = st.anim === 'attack'
        ? Math.min(1, (st.attack || 0) + dt * 5)
        : Math.max(0, (st.attack || 0) - dt * 6);
      if (!dead) {
        const faceAxis = Math.abs(host.vx || 0) >= Math.abs(host.vy || 0)
          ? (Math.sign(host.vx || st.flip || 1) || 1)
          : (host.vy < 0 ? -1 : 1);
        st.flip = faceAxis >= 0 ? 1 : -1;
      }
      st.squash = dead && host.deathCause === 'crush' ? 0.5 : 1;
    },
    draw(ctx, camera, host, st) {
      if (!ctx || !host || host._culled) return;
      const { x, y, cam } = baseCoords(ctx, host, camera);
      const zoom = (cam.zoom || 1) * (host.puppet?.scale || 1);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(zoom, zoom);

      const anim = st?.anim || 'idle';
      const dead = anim.startsWith('death_');
      const crush = dead && host.deathCause === 'crush';
      const fire = dead && host.deathCause === 'fire';
      const bob = Math.sin((st?.t || 0) * (anim.startsWith('walk') ? 6 : 3)) * (dead ? 0 : 0.7);
      const flip = st?.flip || 1;
      const attackPush = (st?.attack || 0) * 6 * flip;

      // sombra
      ctx.save();
      ctx.scale(1, st?.squash || 1);
      drawEllipse(ctx, 9, 3.2, 'rgba(0,0,0,0.22)');
      ctx.restore();

      ctx.translate(0, -2 + bob);
      ctx.scale(flip, st?.squash || 1);

      // piernas
      ctx.save();
      const step = Math.sin((st?.walk || 0) * 1.4) * (anim.startsWith('walk') ? 2.8 : 0.8);
      ctx.fillStyle = fire ? '#2d2d2d' : '#ffbfa4';
      ctx.beginPath();
      ctx.roundRect(-7 + step, 6, 4, 6, 2);
      ctx.roundRect(3 - step, 6, 4, 6, 2);
      ctx.fill();
      ctx.restore();

      // zuecos
      ctx.save();
      ctx.fillStyle = fire ? '#3a3a3a' : '#ff5f7a';
      ctx.beginPath();
      ctx.roundRect(-8, 10, 6, 4, 2);
      ctx.roundRect(2, 10, 6, 4, 2);
      ctx.fill();
      ctx.restore();

      // cubo
      ctx.save();
      ctx.translate(11, 5 + (anim === 'walk_v' ? Math.sin((st?.walk || 0) * 1.2) : 0));
      ctx.scale(flip, 1);
      ctx.fillStyle = fire ? '#2c2c2c' : '#4bb5ff';
      ctx.beginPath();
      ctx.roundRect(-4, -3, 8, 8, 2);
      ctx.fill();
      ctx.strokeStyle = fire ? '#1a1a1a' : '#2c7fb8';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();

      // cuerpo
      ctx.save();
      const tilt = anim.startsWith('walk') ? Math.sin((st?.walk || 0) * 0.6) * 0.05 : 0;
      ctx.rotate(tilt - (anim === 'attack' ? 0.05 * flip : 0));
      ctx.fillStyle = fire ? '#3c3c3c' : '#f7f7ff';
      ctx.beginPath();
      ctx.roundRect(-8, -2, 16, 14, 6);
      ctx.fill();
      ctx.fillStyle = fire ? '#2a2a2a' : '#e3e8ff';
      ctx.roundRect(-7, 3, 14, 8, 5);
      ctx.fill();
      ctx.restore();

      // brazos
      ctx.save();
      ctx.fillStyle = fire ? '#2f2f2f' : '#ffbfa4';
      const swing = anim.startsWith('walk') ? Math.sin((st?.walk || 0) * 1.6) * 3 : Math.sin((st?.t || 0) * 10) * 1.2;
      ctx.beginPath();
      ctx.roundRect(-11 + swing, -1, 4, 8, 2);
      ctx.roundRect(7 - swing, -1, 4, 8, 2);
      ctx.fill();
      ctx.restore();

      // mocho
      ctx.save();
      ctx.translate(-9, -4);
      ctx.rotate(-0.4 + attackPush * 0.02);
      ctx.fillStyle = fire ? '#3b3b3b' : '#c19a6b';
      ctx.fillRect(-1, -1, 14, 2);
      ctx.translate(14, 0);
      ctx.fillStyle = fire ? '#2a2a2a' : '#9bb7d3';
      ctx.beginPath();
      ctx.ellipse(0, 0, 6 + attackPush * 0.1, 3, 0, 0, TAU);
      ctx.fill();
      ctx.restore();

      // cabeza
      ctx.save();
      const headBob = anim === 'idle' ? Math.sin((st?.t || 0) * 3.5) * 0.8 : 0;
      ctx.translate(0, -8 + headBob);
      ctx.scale(1, crush ? 0.6 : 1);
      ctx.fillStyle = fire ? '#2a211b' : '#ffcbad';
      ctx.beginPath();
      ctx.arc(0, 0, 8.5, 0, TAU);
      ctx.fill();
      ctx.restore();

      // pelo
      ctx.save();
      ctx.translate(-1, -9 + headBob);
      ctx.fillStyle = fire ? '#16110f' : '#6b402a';
      ctx.beginPath();
      ctx.ellipse(1, 0, 10, 6, 0.08, 0, TAU);
      ctx.fill();
      ctx.restore();

      // ojos y boca
      ctx.save();
      ctx.translate(0, -8 + headBob);
      ctx.scale(1, crush ? 0.7 : 1);
      const eyeOpen = anim === 'attack' ? 2.3 : 1.7;
      ctx.fillStyle = fire ? '#f6f6f6' : '#181818';
      ctx.beginPath();
      ctx.ellipse(-3.5, -1, eyeOpen, 2.2, 0, 0, TAU);
      ctx.ellipse(3.5, -1, eyeOpen, 2.2, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = fire ? '#f0f0f0' : '#a53131';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (anim === 'attack') ctx.arc(0, 3.5, 2.6, 0, Math.PI);
      else if (anim === 'eat') ctx.arc(0, 3.2, 2.4, 0, Math.PI * 1.1);
      else ctx.arc(0, 3.5, 2.1, 0, Math.PI);
      ctx.stroke();
      ctx.restore();

      // humo muerte fuego
      if (fire) {
        ctx.save();
        ctx.translate(0, -18 + Math.sin((st?.t || 0) * 4) * -1.2);
        ctx.globalAlpha = 0.5;
        drawEllipse(ctx, 2.2, 4.5, 'rgba(60,60,60,0.8)');
        ctx.restore();
      }

      ctx.restore();
    }
  });

  // ---------------------------------------------------------------------------
  // Rigs de puertas de hospital (normales y de urgencias)
  // ---------------------------------------------------------------------------
  function mixColorHex(a, b, t) {
    const lerp = (x, y) => Math.round(x + (y - x) * t);
    const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
    const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
    return `#${lerp(pa[0], pb[0]).toString(16).padStart(2, '0')}${lerp(pa[1], pb[1]).toString(16).padStart(2, '0')}${lerp(pa[2], pb[2]).toString(16).padStart(2, '0')}`;
  }

  function drawRoundRect(ctx, x, y, w, h, r, fill = true, stroke = false) {
    const radius = Math.max(0, Math.min(r, Math.min(w, h) * 0.5));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
  }

  function registerDoorRig(key, isUrgentRig = false) {
    PuppetAPI.registerRig(key, {
      create() {
        return { t: 0, openT: 0, burnT: 0, hitFlash: 0 };
      },
      update(st, e, dt = 0) {
        st.t += dt;
        const targetOpen = (e.aiState === 'open' || e.aiState === 'opening') ? 1 : 0;
        st.openT += (targetOpen - st.openT) * Math.min(1, dt * 6);
        const targetBurn = (e.aiState === 'burning' || e.aiState === 'burnt') ? 1 : 0;
        st.burnT += (targetBurn - st.burnT) * Math.min(1, dt * 2);
        if (e.state === 'hit') {
          st.hitFlash = 0.2;
          e.state = 'idle';
        }
        if (st.hitFlash > 0) st.hitFlash = Math.max(0, st.hitFlash - dt);
      },
      draw(ctx, cam, e, st) {
        if (!ctx || !e) return;
        const camera = cam || { x: 0, y: 0, zoom: 1 };
        const screen = (typeof toScreen === 'function') ? toScreen(camera, e) : {
          x: (e.x - camera.x) * (camera.zoom || 1) + (ctx.canvas?.width || 0) * 0.5,
          y: (e.y - camera.y) * (camera.zoom || 1) + (ctx.canvas?.height || 0) * 0.5
        };

        ctx.save();
        ctx.translate(screen.x, screen.y);
        ctx.scale(camera.zoom || 1, camera.zoom || 1);

        const bob = Math.sin(st.t * 2) * 0.3;
        const w = e.w;
        const h = e.h + 4;
        const frame = 3;

        ctx.save();
        ctx.translate(0, bob);

        ctx.fillStyle = '#8b5a2b';
        drawRoundRect(ctx, -w / 2 - frame, -h / 2 - frame, w + frame * 2, h + frame * 2, 4, true, false);

        const baseColor = e.isUrgent || isUrgentRig ? '#c62828' : '#1565c0';
        const doorColor = mixColorHex(baseColor, '#2b2b2b', st.burnT || 0);
        ctx.fillStyle = doorColor;
        const openFrac = st.openT || 0;
        const doorWidth = w * (1 - 0.75 * openFrac);
        drawRoundRect(ctx, -doorWidth / 2, -h / 2, doorWidth, h, 3, true, false);

        ctx.fillStyle = '#0d47a1';
        drawRoundRect(ctx, -doorWidth / 3, -h / 3, doorWidth * 0.65, h * 0.25, 2, true, false);

        if (e.isUrgent || isUrgentRig) {
          ctx.save();
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.beginPath();
          ctx.rect(-4, -4, 8, 2);
          ctx.rect(-1, -7, 2, 14);
          ctx.fill();
          ctx.restore();
        }

        if (st.hitFlash > 0) {
          ctx.globalAlpha = st.hitFlash / 0.2;
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          drawRoundRect(ctx, -doorWidth / 2, -h / 2, doorWidth, h, 3, true, false);
        }

        ctx.restore();
        ctx.restore();
      }
    });
  }

  registerDoorRig('door_hospital', false);
  registerDoorRig('door_hospital_urgent', true);

  PuppetAPI.registerRig('cart_food_pinball', {
    create() {
      return { t: 0, bounce: 0, squash: 0, flash: 0 };
    },
    update(state, e, dt) {
      if (!state || !e) return;
      state.t += dt;
      const speed = Math.hypot(e.vx || 0, e.vy || 0);
      if (e.dead) {
        state.bounce = 0;
      } else if (speed > 5) {
        state.bounce = Math.sin(state.t * 10) * 1.5;
      } else {
        state.bounce = Math.sin(state.t * 4) * 0.5;
      }
    },
    draw(ctx, cam, e, state) {
      if (!ctx || !e) return;
      const camera = cam || { x: 0, y: 0, zoom: 1 };
      const canvas = ctx.canvas || { width: 0, height: 0 };
      const x = (e.x - camera.x) * camera.zoom + canvas.width * 0.5;
      const y = (e.y - camera.y) * camera.zoom + canvas.height * 0.5;

      ctx.save();
      ctx.translate(x, y + (state?.bounce || 0));
      ctx.scale(camera.zoom, camera.zoom);

      const radius = Math.min(e.w || 24, e.h || 24) * 0.5;

      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.ellipse(0, radius * 0.9, radius * 1.1, radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.globalAlpha = 1;

      const gradient = ctx.createRadialGradient(-radius * 0.3, -radius * 0.4, radius * 0.2, 0, 0, radius);
      gradient.addColorStop(0, '#ffe8a0');
      gradient.addColorStop(0.4, '#f0b46a');
      gradient.addColorStop(1, '#aa6b39');
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.fillStyle = '#d9e7ff';
      ctx.fillRect(-radius * 0.6, -radius * 0.1, radius * 1.2, radius * 0.4);

      ctx.beginPath();
      ctx.arc(-radius * 0.25, 0, radius * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = '#ffdd99';
      ctx.fill();

      ctx.fillStyle = '#7dc3ff';
      ctx.fillRect(radius * 0.1, -radius * 0.35, radius * 0.25, radius * 0.6);

      ctx.restore();
    },
  });

  // Rig chibi para charco de agua.
  PuppetAPI.registerRig('hazard_puddle', {
    create() {
      return { t: 0 };
    },
    update(st, host, dt = 0) {
      if (!st || !host) return;
      st.t += dt;
    },
    draw(ctx, camera, host, st) {
      if (!ctx || !host || host._culled) return;
      const { x, y, cam } = baseCoords(ctx, host, camera);
      const zoom = (cam.zoom || 1) * (host.puppet?.scale || 1);
      const t = st?.t || 0;
      ctx.save();
      ctx.translate(x, y + Math.sin(t * 2) * 0.2);
      ctx.scale(zoom, zoom);

      const ripple = 1 + Math.sin(t * 3) * 0.05;
      const wave = (ang, baseR) => baseR + Math.sin(t * 4 + ang) * 1.2;

      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = 'rgba(70, 200, 230, 0.65)';
      ctx.beginPath();
      ctx.moveTo(-12 * ripple, 0);
      ctx.quadraticCurveTo(-wave(0, 8), -wave(1, 6), 0, -10 * ripple);
      ctx.quadraticCurveTo(wave(2, 9), -wave(3, 5), 12 * ripple, 0);
      ctx.quadraticCurveTo(wave(4, 9), wave(5, 6), 0, 10 * ripple);
      ctx.quadraticCurveTo(-wave(6, 8), wave(7, 5), -12 * ripple, 0);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = 'rgba(50, 170, 210, 0.6)';
      ctx.beginPath();
      ctx.moveTo(-7 * ripple, 0);
      ctx.quadraticCurveTo(0, -6 * ripple, 7 * ripple, 0);
      ctx.quadraticCurveTo(0, 6 * ripple, -7 * ripple, 0);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(4, -3, 2.4, 1.4, 0, 0, TAU);
      ctx.fill();
      ctx.restore();

      ctx.restore();
    }
  });

  PuppetAPI.registerRig('cart_meds_pinball', {
    create(e) {
      return { t: 0, bounce: 0, squash: 0, hitFlashT: 0, lastSpeed: 0 };
    },
    update(state, e, dt) {
      if (!state || !e) return;
      state.t += dt;
      const speed = Math.hypot(e.vx || 0, e.vy || 0);
      state.lastSpeed = speed;
      state.bounce = Math.sin(state.t * 6) * (speed > 10 ? 2.5 : 1.0);
      const speedNorm = Math.min(speed / (e.physics?.maxSpeed || 1), 1);
      state.squash = speedNorm * 0.2;
      if (state.hitFlashT > 0) {
        state.hitFlashT = Math.max(0, state.hitFlashT - dt * 4);
      }
    },
    draw(ctx, cam, e, state) {
      if (!ctx || !cam || !e || !state) return;
      const scr = (typeof toScreen === 'function') ? toScreen(cam, e) : {
        x: (e.x - cam.x) * cam.zoom + (ctx.canvas?.width || 0) * 0.5,
        y: (e.y - cam.y) * cam.zoom + (ctx.canvas?.height || 0) * 0.5,
      };
      const radius = 12;

      ctx.save();
      ctx.translate(scr.x, scr.y + state.bounce);
      ctx.scale(cam.zoom, cam.zoom);

      const sx = 1 + state.squash;
      const sy = 1 - state.squash;
      ctx.scale(sx, sy);

      const isHit = state.hitFlashT > 0;
      const baseColor = isHit ? '#ffffff' : '#f5e3b2';

      const grd = ctx.createRadialGradient(0, -radius * 0.4, radius * 0.2, 0, 0, radius);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.4, baseColor);
      grd.addColorStop(1, '#b4935a');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#c8a46d';
      ctx.fillRect(-8, -4, 16, 8);
      ctx.fillStyle = '#3c3f46';
      ctx.fillRect(-6, -3, 12, 6);

      ctx.fillStyle = '#00c2ff';
      ctx.fillRect(-2, -3, 4, 6);
      ctx.fillRect(-4, -1, 8, 2);

      ctx.globalAlpha = 0.35;
      ctx.scale(1, 0.4);
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(0, radius * 2.1, radius * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });

  PuppetAPI.registerRig('cart_emergency_pinball', {
    create(e) {
      return { t: 0, bounce: 0, squash: 0, hitFlash: 0, lastState: e?.state || 'idle' };
    },
    update(st, e, dt) {
      st.t += dt;
      const moving = Math.abs(e?.vx || 0) + Math.abs(e?.vy || 0) > 5;
      e.state = e?.dead ? 'dead' : (moving ? 'move' : 'idle');
      if (e.state === 'move') {
        const speed = Math.min(Math.hypot(e.vx || 0, e.vy || 0), e.cartPhysics?.maxSpeed || e.maxSpeed || 1);
        st.squash = 0.06 + speed / ((e.cartPhysics?.maxSpeed || 1) * 20);
        st.bounce = Math.sin(st.t * 12) * 1.2;
      } else {
        st.squash *= 0.8;
        st.bounce = Math.sin(st.t * 4) * 0.8;
      }
      if (st.hitFlash > 0) st.hitFlash -= dt;
      st.lastState = e.state;
    },
    draw(ctx, cam, e, st) {
      if (!ctx || !cam || !e || !st) return;
      const scr = (typeof toScreen === 'function') ? toScreen(cam, e) : {
        x: (e.x - cam.x) * (cam.zoom || 1) + (ctx.canvas?.width || 0) * 0.5,
        y: (e.y - cam.y) * (cam.zoom || 1) + (ctx.canvas?.height || 0) * 0.5,
      };
      ctx.save();
      ctx.translate(scr.x, scr.y + st.bounce);
      ctx.scale(cam.zoom || 1, cam.zoom || 1);
      const r = 12;
      const sx = 1 + (st.squash || 0);
      const sy = 1 - (st.squash || 0);
      ctx.scale(sx, sy);

      const grad = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
      if (st.hitFlash > 0) {
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(1, '#ff6666');
      } else {
        grad.addColorStop(0, '#fffbf0');
        grad.addColorStop(0.5, '#ff3333');
        grad.addColorStop(1, '#661111');
      }

      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#440000';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-4, -1, 8, 2);
      ctx.fillRect(-1, -4, 2, 8);

      ctx.restore();
    },
  });

  // [HospitalDash] Chibi rig for furious patient (biped aggressive).
  PuppetAPI.registerRig('patient_furious', {
    create(host) {
      return { t: 0, step: 0, anim: 'idle', phase: 0, eatTimer: 0, animDone: false, flip: 1 };
    },
    update(st, host, dt = 0) {
      if (!st || !host) return;
      st.t += dt;
      const dead = host.dead;
      st.anim = dead ? `death_${host.deathCause || 'damage'}` : (host.state || 'idle');
      if (st.anim === 'attack') st.attackPush = Math.min(1, (st.attackPush || 0) + dt * 4);
      else st.attackPush = Math.max(0, (st.attackPush || 0) - dt * 6);
      const moving = st.anim.startsWith('walk');
      st.step += dt * (moving ? 8 : 4.5);
      if (st.anim === 'eat') {
        st.eatTimer += dt;
        if (st.eatTimer > 1.0) { st.animDone = true; host._eatDone = true; }
      } else { st.eatTimer = 0; }
      if (dead) {
        st.phase = Math.min(1, (st.phase || 0) + dt * 6);
        return;
      }
      const faceAxis = Math.abs(host.vx || 0) >= Math.abs(host.vy || 0)
        ? (Math.sign(host.vx || st.flip || 1) || 1)
        : (host.vy < 0 ? -2 : 2);
      st.flip = Math.sign(faceAxis === 0 ? (st.flip || 1) : (faceAxis === -2 ? st.flip || -1 : faceAxis)) || 1;
    },
    draw(ctx, camera, host, st) {
      if (!ctx || !host || host._culled) return;
      const { x, y, cam } = baseCoords(ctx, host, camera);
      const zoom = (cam.zoom || 1) * (host.puppet?.scale || host.rig?.scale || 1);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(zoom, zoom);

      const anim = st?.anim || 'idle';
      const dead = anim.startsWith('death_');
      const flip = st?.flip || 1;
      const bob = Math.sin((st?.step || 0) * 0.8) * (anim.startsWith('walk') ? 0.8 : 0.4);
      const squash = dead && anim === 'death_crush' ? 0.4 : 1;

      // Sombra
      ctx.save();
      ctx.scale(1, squash);
      drawEllipse(ctx, 8.5, 3.2, 'rgba(0,0,0,0.25)');
      ctx.restore();

      ctx.save();
      ctx.translate(0, -2 + bob);
      ctx.scale(flip, 1);

      // Piernas
      ctx.save();
      const legStep = Math.sin((st?.step || 0) * 1.6) * 2.5;
      const legSpread = anim.startsWith('walk') ? legStep : 0.5;
      ctx.fillStyle = dead && anim === 'death_fire' ? '#2a2a2a' : '#f4c8ad';
      ctx.beginPath();
      ctx.roundRect(-6 + legSpread, 7, 5, 5, 2);
      ctx.roundRect(1 - legSpread, 7, 5, 5, 2);
      ctx.fill();
      ctx.restore();

      // Cuerpo
      ctx.save();
      const tilt = anim === 'attack' ? -0.1 * flip : 0;
      ctx.rotate(tilt);
      ctx.translate(0, dead ? 2 : 0);
      const bodySquash = anim === 'idle' ? 1 + Math.sin((st?.t || 0) * 14) * 0.03 : 1;
      ctx.scale(1, bodySquash * squash);
      ctx.fillStyle = dead && anim === 'death_fire' ? '#1d1d1d' : '#f8f8ff';
      ctx.beginPath();
      ctx.roundRect(-8, -1, 16, 12, 6);
      ctx.fill();
      ctx.fillStyle = dead && anim === 'death_fire' ? '#2b2b2b' : '#e0e0f7';
      ctx.beginPath();
      ctx.roundRect(-7, 3, 14, 8, 5);
      ctx.fill();
      ctx.restore();

      // Brazos
      ctx.save();
      ctx.fillStyle = dead && anim === 'death_fire' ? '#2a2a2a' : '#f4c8ad';
      const armSwing = anim.startsWith('walk') ? Math.sin((st?.step || 0) * 1.8) * 3.2 : Math.sin((st?.t || 0) * 18) * 1.4;
      const attackPush = (st?.attackPush || 0) * 4;
      ctx.beginPath();
      ctx.roundRect(-10 + armSwing - attackPush, 0 - attackPush, 4, 7 + attackPush, 2.2);
      ctx.roundRect(6 - armSwing + attackPush, 0 - attackPush, 4, 7 + attackPush, 2.2);
      ctx.fill();
      ctx.restore();

      // Cabeza
      ctx.save();
      const headShake = anim === 'idle' ? Math.sin((st?.t || 0) * 18) * 0.8 : 0;
      const headPush = anim === 'attack' ? 1.1 : 0;
      ctx.translate(headShake + headPush, -8 - (dead ? -2 : 0));
      ctx.scale(1, squash * 1.02);
      const faceDark = dead && anim === 'death_fire';
      ctx.fillStyle = faceDark ? '#20150f' : '#f4c8ad';
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, TAU);
      ctx.fill();

      // Pelo
      ctx.save();
      ctx.translate(-1, -1);
      ctx.fillStyle = faceDark ? '#0f0c0b' : '#4a2d1d';
      ctx.beginPath();
      ctx.ellipse(1, -1.5, 10, 7, 0, 0, TAU);
      ctx.fill();
      ctx.restore();

      // Ojos y cejas
      const eyeOpen = anim === 'attack' ? 2.2 : 1.6;
      ctx.fillStyle = faceDark ? '#f7f7f7' : '#0f0f0f';
      ctx.beginPath();
      ctx.ellipse(-3.5, -1, eyeOpen, 2.2, 0, 0, TAU);
      ctx.ellipse(3.5, -1, eyeOpen, 2.2, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = faceDark ? '#f7f7f7' : '#2c0a0a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-6, -4.5);
      ctx.lineTo(-1.5, -2.8);
      ctx.moveTo(6, -4.5);
      ctx.lineTo(1.5, -2.8);
      ctx.stroke();

      // Mejillas y boca
      if (!faceDark && anim !== 'death_damage' && anim !== 'death_crush') {
        ctx.fillStyle = anim === 'eat' ? '#ffc2c2' : '#ff8080';
        ctx.beginPath();
        ctx.arc(-4.5, 2.8, 1.6, 0, TAU);
        ctx.arc(4.5, 2.8, 1.6, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = faceDark ? '#f7f7f7' : '#a12424';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (anim === 'attack') {
        ctx.arc(0, 4, 3.4, 0, Math.PI);
      } else if (anim === 'eat') {
        ctx.arc(0, 3.5, 2.4, 0, Math.PI * 1.1);
      } else {
        ctx.arc(0, 3.8, 2.1, 0, Math.PI);
      }
      ctx.stroke();

      // Ojos en espiral / fuego
      if (dead && anim === 'death_damage') {
        ctx.strokeStyle = '#3a1f1f';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(-4, -0.5); ctx.quadraticCurveTo(-2, -3.5, 0, -1); ctx.quadraticCurveTo(2, 1.5, 4, -0.5);
        ctx.moveTo(-4, 2.5); ctx.quadraticCurveTo(-1, 0, 2, 3); ctx.quadraticCurveTo(1.5, 4.5, -1.5, 4);
        ctx.stroke();
      } else if (dead && anim === 'death_fire') {
        ctx.fillStyle = 'rgba(60,60,60,0.8)';
        ctx.beginPath();
        ctx.moveTo(-4, -8); ctx.quadraticCurveTo(-1, -10, 2, -7); ctx.quadraticCurveTo(5, -4, 2, -1); ctx.quadraticCurveTo(-2, 2, -3, 6);
        ctx.fill();
      }
      ctx.restore();

      // Humo pequeño para muerte por fuego
      if (dead && anim === 'death_fire') {
        ctx.save();
        ctx.translate(0, -18 - Math.sin((st?.t || 0) * 5) * 1.5);
        ctx.globalAlpha = 0.5;
        drawEllipse(ctx, 2.5, 4, '#3b3b3b');
        ctx.restore();
      }

      ctx.restore();
    }
  });

  // Rig chibi para Boss Pyromana (nivel 3)
  PuppetAPI.registerRig('boss_pyro', {
    create(host) {
      return {
        t: 0,
        blinkT: 2 + Math.random() * 3,
        blink: 0,
        bob: 0,
        flamePulse: 0,
        anim: host?.state || 'idle',
        deathProgress: 0,
      };
    },
    update(st, host, dt = 0) {
      if (!st || !host) return;
      st.t += dt;
      st.bob = Math.sin(st.t * 2.4) * 0.6;
      st.flamePulse = 0.7 + Math.sin(st.t * 6) * 0.3;
      st.blinkT -= dt;
      if (st.blinkT <= 0) { st.blink = 1; st.blinkT = 3 + Math.random() * 3; }
      st.blink = Math.max(0, st.blink - dt * 6);

      const moving = Math.abs(host.vx || 0) + Math.abs(host.vy || 0) > 1;
      const walkAnim = moving ? ((Math.abs(host.vx || 0) > Math.abs(host.vy || 0)) ? 'walk_h' : 'walk_v') : 'idle';
      let anim = walkAnim;
      if (host.dead) anim = `death_${host.deathCause || 'damage'}`;
      else if (host.state === 'attack') anim = 'attack';
      else if (host.state === 'eat') anim = 'eat';
      else if (!moving) anim = host.state || 'idle';
      st.anim = anim;
      if (host.dead) st.deathProgress = Math.min(1, (st.deathProgress || 0) + dt * 1.2);
      else st.deathProgress = 0;
    },
    draw(ctx, camera, host, st) {
      if (!ctx || !host || host._culled) return;
      const { x, y, cam } = baseCoords(ctx, host, camera);
      const zoom = (cam.zoom || 1) * (host.puppet?.scale || host.rig?.scale || 1);
      ctx.save();
      ctx.translate(x, y + (st?.bob || 0));
      ctx.scale(zoom, zoom);

      const anim = st?.anim || 'idle';
      const dead = anim.startsWith('death_');
      const crush = dead && host.deathCause === 'crush';
      const fireDeath = dead && host.deathCause === 'fire';
      const damageDeath = dead && host.deathCause === 'damage';
      const tilt = (anim.startsWith('walk') ? Math.sin((st?.t || 0) * 6) * 4 : 0) * (anim === 'walk_h' ? 1 : 0);
      const flameScale = anim === 'attack' ? 1.25 : 1;
      const bodySquashY = crush ? 0.4 : 1;
      const bodySquashX = crush ? 1.2 : 1;

      // Cama básica
      ctx.save();
      ctx.scale(bodySquashX, bodySquashY);
      ctx.fillStyle = '#f0f4ff';
      ctx.strokeStyle = '#c8d2e8';
      roundRect(ctx, -12, -6, 24, 14, 5, true, true);
      ctx.restore();

      // Halo curada
      if (anim === 'cured') {
        ctx.save();
        const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 16);
        halo.addColorStop(0, 'rgba(120,220,200,0.55)');
        halo.addColorStop(1, 'rgba(120,220,200,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.ellipse(0, 2, 15, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Cuerpo
      ctx.save();
      ctx.rotate((tilt * Math.PI) / 180);
      ctx.fillStyle = '#ffeae6';
      ctx.strokeStyle = '#e55a5a';
      roundRect(ctx, -8, -12, 16, 18, 6, true, true);
      ctx.restore();

      // Cabeza
      ctx.save();
      ctx.translate(0, -14);
      ctx.fillStyle = '#ffd7c2';
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      // Ojos
      const blink = 1 - (st?.blink || 0);
      ctx.fillStyle = '#231f20';
      ctx.beginPath();
      ctx.ellipse(-3, 0.5, 1.4, 2 * blink, 0, 0, Math.PI * 2);
      ctx.ellipse(3, 0.5, 1.4, 2 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
      // Pupilas locas
      ctx.fillStyle = '#ff6b35';
      ctx.beginPath();
      ctx.arc(-3, -0.2, 0.7, 0, Math.PI * 2);
      ctx.arc(3, -0.2, 0.7, 0, Math.PI * 2);
      ctx.fill();
      // Boca
      ctx.strokeStyle = '#b23c3c';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-3, 3.5);
      ctx.quadraticCurveTo(0, 5 + (anim === 'eat' ? -1 : 0), 3, 3.5);
      ctx.stroke();
      // Pelo
      ctx.fillStyle = '#2b1b1b';
      ctx.beginPath();
      ctx.moveTo(-8, -4);
      ctx.quadraticCurveTo(0, -10, 8, -4);
      ctx.quadraticCurveTo(2, -6, -8, -4);
      ctx.fill();
      ctx.restore();

      // Brazos simples
      ctx.save();
      ctx.strokeStyle = '#f6b1a8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-7, -6);
      ctx.lineTo(-10, -2 + (anim === 'attack' ? -2 : 0));
      ctx.moveTo(7, -6);
      ctx.lineTo(10, -2 + (anim === 'eat' ? 2 : 0));
      ctx.stroke();
      ctx.restore();

      // Llama flotante / mechero
      ctx.save();
      ctx.translate(10, -4 + (anim === 'attack' ? -2 : 0));
      const grd = ctx.createLinearGradient(0, -6, 0, 6);
      grd.addColorStop(0, 'rgba(255, 215, 120, 0.95)');
      grd.addColorStop(1, 'rgba(255, 120, 50, 0.8)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(0, -6 * flameScale);
      ctx.quadraticCurveTo(3, 0, 0, 6 * flameScale);
      ctx.quadraticCurveTo(-3, 0, 0, -6 * flameScale);
      ctx.fill();
      ctx.strokeStyle = 'rgba(80,40,10,0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      // Llamas alrededor
      const flameSlots = [
        { x: -10, y: -8 },
        { x: 10, y: -8 },
        { x: -8, y: 8 },
        { x: 8, y: 8 },
      ];
      for (const f of flameSlots) {
        ctx.save();
        ctx.translate(f.x, f.y + (anim === 'idle' ? Math.sin((st?.t || 0) * 4 + f.x) * 0.6 : 0));
        const s = (flameScale * (st?.flamePulse || 1)) * (dead ? 0.6 : 1);
        const grad = ctx.createRadialGradient(0, -2 * s, 1, 0, 0, 8 * s);
        grad.addColorStop(0, fireDeath ? 'rgba(70,70,70,0.9)' : 'rgba(255,230,150,0.95)');
        grad.addColorStop(1, fireDeath ? 'rgba(90,60,20,0.4)' : 'rgba(255,120,40,0.7)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, -6 * s);
        ctx.quadraticCurveTo(4 * s, 0, 0, 7 * s);
        ctx.quadraticCurveTo(-4 * s, 0, 0, -6 * s);
        ctx.fill();
        ctx.restore();
      }

      // Siluetas de muerte fuego/humo
      if (dead) {
        ctx.save();
        if (fireDeath) {
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = 'rgba(30,30,30,0.8)';
          ctx.beginPath();
          ctx.ellipse(0, -6, 10, 12, 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (damageDeath) {
          ctx.strokeStyle = '#f4d742';
          ctx.lineWidth = 1.4;
          for (let i = 0; i < 4; i++) {
            const ang = (st?.t || 0) * 5 + i * (Math.PI / 2);
            ctx.beginPath();
            ctx.moveTo(Math.cos(ang) * 4, Math.sin(ang) * 4 - 10);
            ctx.lineTo(Math.cos(ang) * 7, Math.sin(ang) * 7 - 10);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      ctx.restore();
    },
  });
  // -------------------------------------------------------------------------
  // Rig: boss_cleaner (Jefa de limpiadoras desmayada, chibi top-down)
  // -------------------------------------------------------------------------
  PuppetAPI.registerRig('boss_cleaner', {
    create(host) {
      return {
        t: 0,
        step: 0,
        anim: 'idle',
        blink: 0,
        eyeOpen: 1,
        mopSwing: 0,
        halo: 0,
        wobble: 0,
      };
    },
    update(st, host, dt = 0) {
      if (!st || !host) return;
      st.t += dt;
      const dead = host.dead;
      st.anim = dead ? `death_${host.deathCause || 'damage'}` : (host.state || 'idle');
      const moving = st.anim.startsWith('walk');
      st.step += dt * (moving ? 4 : 2.2);
      st.wobble = moving ? Math.sin(st.step) * 1.5 : Math.sin(st.t * 2.4) * 0.6;
      st.mopSwing = st.anim === 'attack'
        ? Math.min(1, (st.mopSwing || 0) + dt * 6)
        : Math.max(0, (st.mopSwing || 0) - dt * 4);
      st.halo = st.anim === 'talk' || st.anim === 'cured'
        ? Math.min(1, (st.halo || 0) + dt * 3)
        : Math.max(0, (st.halo || 0) - dt * 2);

      st.blink = st.blink || (2.5 + Math.random() * 2);
      st.blink -= dt;
      if (st.blink <= 0) {
        st.eyeOpen = Math.max(0, (st.eyeOpen || 1) - dt * 18);
        if (st.eyeOpen <= 0.1) {
          st.blink = 2 + Math.random() * 2;
          st.eyeOpen = 1;
        }
      } else {
        st.eyeOpen = Math.min(1, (st.eyeOpen || 1) + dt * 5);
      }
    },
    draw(ctx, camera, host, st) {
      if (!ctx || !host || host._culled) return;
      const { x, y, cam } = baseCoords(ctx, host, camera);
      const zoom = (cam.zoom || 1) * (host.puppet?.scale || host.rig?.scale || 1);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(zoom, zoom);

      const anim = st?.anim || 'idle';
      const dead = anim.startsWith('death_');
      const crush = dead && anim === 'death_crush';
      const fire = dead && anim === 'death_fire';
      const bob = Math.sin((st?.t || 0) * 2.2) * (dead ? 0 : 0.8);
      const squashY = crush ? 0.5 : 1;
      const squashX = crush ? 1.25 : 1;

      // Charco de agua
      ctx.save();
      ctx.scale(1, squashY);
      ctx.fillStyle = fire ? '#5c6a75' : 'rgba(35,200,215,0.55)';
      drawEllipse(ctx, 13, 7.5, ctx.fillStyle);
      drawEllipse(ctx, 9, 5, fire ? '#4a555f' : 'rgba(55,220,235,0.35)');
      ctx.restore();

      // Sombra
      ctx.save();
      ctx.scale(1, squashY);
      drawEllipse(ctx, 9, 3, 'rgba(0,0,0,0.2)');
      ctx.restore();

      ctx.save();
      ctx.translate(0, -1 + bob);
      ctx.scale(squashX, squashY);

      // Señal de suelo mojado
      ctx.save();
      ctx.translate(-10, 6);
      ctx.rotate(-0.2);
      ctx.fillStyle = fire ? '#4d4d4d' : '#f5c400';
      ctx.beginPath();
      ctx.moveTo(-3, 6); ctx.lineTo(3, 6); ctx.lineTo(0, -6); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = fire ? '#222' : '#181818';
      ctx.fillRect(-1, 0, 2, 3);
      ctx.restore();

      // Cubo y pulverizador
      ctx.save();
      ctx.translate(10, 5);
      ctx.fillStyle = fire ? '#3a3a3a' : '#f6d541';
      ctx.beginPath();
      ctx.roundRect(-3.5, -2.5, 7, 6, 1.5);
      ctx.fill();
      ctx.fillStyle = fire ? '#1f1f1f' : '#5aa3ff';
      ctx.roundRect(-8, -4, 4, 5, 1.2);
      ctx.fill();
      ctx.restore();

      // Mocho
      ctx.save();
      const swing = (st?.mopSwing || 0) * 0.9;
      ctx.translate(8, -2);
      ctx.rotate(-0.6 + swing);
      ctx.fillStyle = fire ? '#2b2b2b' : '#caa074';
      ctx.fillRect(-1, -1, 10, 2);
      ctx.translate(10, 0);
      ctx.fillStyle = fire ? '#1b1b1b' : '#8d96a7';
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Halo de curación
      if (st?.halo > 0) {
        ctx.save();
        ctx.globalAlpha = 0.35 * st.halo;
        drawEllipse(ctx, 15, 10, 'rgba(120,210,255,0.9)');
        ctx.globalAlpha = 0.2 * st.halo;
        ctx.strokeStyle = 'rgba(110,255,210,0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, -3, 12, 8, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }

      // Cuerpo
      ctx.save();
      ctx.translate(0, 4);
      const bodySquash = anim === 'idle' ? 1 + Math.sin((st?.t || 0) * 2.5) * 0.05 : 1;
      ctx.scale(1, bodySquash);
      ctx.fillStyle = fire ? '#3a3a3a' : '#f6f7fb';
      ctx.beginPath();
      ctx.roundRect(-8, -3, 16, 12, 6);
      ctx.fill();
      ctx.fillStyle = fire ? '#2b2b2b' : '#e3e9ff';
      ctx.roundRect(-7, 1, 14, 7, 5);
      ctx.fill();
      ctx.restore();

      // Brazos
      ctx.save();
      ctx.translate(0, 2 + st.wobble * 0.2);
      ctx.fillStyle = fire ? '#2c2c2c' : '#58a3ff';
      const armSwing = Math.sin((st?.step || 0) * 1.6) * (anim.startsWith('walk') ? 1.6 : 0.5);
      ctx.roundRect(-10 + armSwing, -1, 4, 7, 2);
      ctx.roundRect(6 - armSwing, -1, 4, 7, 2);
      ctx.fill();
      ctx.restore();

      // Piernas y zuecos
      ctx.save();
      ctx.translate(0, 8 + st.wobble * 0.1);
      ctx.fillStyle = fire ? '#1f1f1f' : '#ff88b5';
      const legDrag = anim.startsWith('walk') ? Math.sin((st?.step || 0) * 1.4) * 1.5 : 0.4;
      ctx.roundRect(-6 + legDrag, -1, 5, 4, 2);
      ctx.roundRect(1 - legDrag, -1, 5, 4, 2);
      ctx.fill();
      ctx.restore();

      // Cabeza
      ctx.save();
      ctx.translate(0, -4 + st.wobble * 0.2);
      ctx.scale(1, crush ? 0.75 : 1);
      ctx.fillStyle = fire ? '#2b1d17' : '#f4c8ad';
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, TAU);
      ctx.fill();

      // Pelo y coleta
      ctx.save();
      ctx.translate(-1, -3);
      ctx.fillStyle = fire ? '#19110c' : '#5a3524';
      ctx.beginPath();
      ctx.ellipse(1, 1, 10, 7, 0, 0, TAU);
      ctx.fill();
      ctx.translate(7, -3);
      ctx.rotate(0.6);
      ctx.fillStyle = fire ? '#120c08' : '#6d412c';
      ctx.beginPath();
      ctx.ellipse(0, 0, 5, 3, 0, 0, TAU);
      ctx.fill();
      ctx.restore();

      // Ojos y boca
      ctx.save();
      const eyeScale = (st?.eyeOpen ?? 1) * (anim === 'death_damage' ? 0.4 : 1);
      ctx.fillStyle = fire ? '#f7f7f7' : '#0f0f0f';
      ctx.beginPath();
      ctx.ellipse(-3.5, -1, 1.6, 1.2 * eyeScale, 0, 0, TAU);
      ctx.ellipse(3.5, -1, 1.6, 1.2 * eyeScale, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = fire ? '#f7f7f7' : '#b02b2b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (anim === 'attack') ctx.arc(0, 3.5, 3, 0, Math.PI);
      else if (anim === 'eat') ctx.arc(0, 3, 2.4, 0, Math.PI * 1.1);
      else ctx.arc(0, 3.2, 2.1, 0, Math.PI);
      ctx.stroke();
      ctx.restore();

      // Mejillas
      if (!dead && !fire) {
        ctx.fillStyle = anim === 'eat' ? '#ffb7c0' : '#ff9aa8';
        drawEllipse(ctx, 2, 1.2, ctx.fillStyle);
        ctx.save();
        ctx.translate(5, 1);
        drawEllipse(ctx, 2, 1.2, ctx.fillStyle);
        ctx.restore();
      }

      // Ojos especiales muerte
      if (dead && anim === 'death_damage') {
        ctx.strokeStyle = '#2b1b1b';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(-4, -1); ctx.quadraticCurveTo(-1, -4, 1, -1); ctx.quadraticCurveTo(3, 2, -1, 2);
        ctx.moveTo(4, -1); ctx.quadraticCurveTo(1, -4, -1, -1); ctx.quadraticCurveTo(-3, 2, 1, 2);
        ctx.stroke();
      } else if (dead && anim === 'death_fire') {
        ctx.fillStyle = 'rgba(50,50,50,0.8)';
        ctx.beginPath();
        ctx.moveTo(-3, -8); ctx.quadraticCurveTo(-1, -11, 2, -8); ctx.quadraticCurveTo(5, -4, 2, -2); ctx.quadraticCurveTo(-2, 1, -3, 5);
        ctx.fill();
      }

      ctx.restore();

      // Partículas muerte
      if (dead) {
        if (anim === 'death_fire') {
          ctx.save();
          ctx.globalAlpha = 0.6;
          drawEllipse(ctx, 11, 6, '#2f2f2f');
          ctx.fillStyle = 'rgba(80,80,80,0.5)';
          ctx.fillRect(-2, -18, 3, 8);
          ctx.fillRect(3, -15, 2, 6);
          ctx.restore();
        } else if (anim === 'death_damage') {
          ctx.save();
          ctx.strokeStyle = '#f4d742';
          ctx.lineWidth = 1.2;
          for (let i = 0; i < 4; i++) {
            const ang = st.t * 4 + i * (Math.PI / 2);
            ctx.beginPath();
            ctx.moveTo(Math.cos(ang) * 6, Math.sin(ang) * 6 - 12);
            ctx.lineTo(Math.cos(ang) * 10, Math.sin(ang) * 10 - 12);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      ctx.restore();
    },
  });

  // Rig chibi para Boss Hematológica en cama (tile único 32x32 aprox.)
  PuppetAPI.registerRig('boss_hema', {
    create(host) {
      return {
        t: 0,
        blinkT: 2 + Math.random() * 3,
        blinkPhase: 0,
        shakeT: 0,
        deathProgress: 0,
        mouthT: 0,
        headBob: 0,
      };
    },
    update(state, host, dt = 0) {
      if (!state || !host) return;
      state.t += dt;
      state.mouthT += dt * (host.state === 'talk' ? 6 : 2);
      state.headBob = host.state === 'talk' ? Math.sin(state.t * 6) * 0.6 : 0;
      const anim = host.dead ? `death_${host.deathCause || 'damage'}` : (host.state || 'idle');
      state.anim = anim;

      state.blinkT -= dt;
      if (state.blinkT <= 0) {
        state.blinkPhase = 1;
        state.blinkT = 3 + Math.random() * 3;
      }
      state.blinkPhase = Math.max(0, state.blinkPhase - dt * 6);

      if (host.bossActive) state.shakeT = Math.min(1, (state.shakeT || 0) + dt * 2.5);
      else state.shakeT = Math.max(0, (state.shakeT || 0) - dt * 1.5);

      if (host.dead) {
        state.deathProgress = Math.min(1, (state.deathProgress || 0) + dt * 1.4);
      } else {
        state.deathProgress = 0;
      }
    },
    draw(ctx, camera, host, state) {
      if (!ctx || !host || host._culled) return;
      const { x, y, cam } = baseCoords(ctx, host, camera);
      const zoom = (cam.zoom || 1) * (host.puppet?.scale || host.rig?.scale || 1);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(zoom, zoom);

      const anim = state?.anim || 'idle';
      const dead = anim.startsWith('death_');
      const crush = dead && host.deathCause === 'crush';
      const fire = dead && host.deathCause === 'fire';
      const damage = dead && host.deathCause === 'damage';
      const bob = Math.sin((state?.t || 0) * 2.2) * (anim === 'idle' ? 1.2 : 0.6);
      const shake = (state?.shakeT || 0) * (host.bossActive ? 1 : 0) * 1.1;
      const shakeX = shake ? Math.sin((state?.t || 0) * 24) * shake : 0;
      const shakeY = shake ? Math.cos((state?.t || 0) * 26) * shake : 0;
      const walkTilt = anim.startsWith('walk') ? Math.sin((state?.t || 0) * 6) * 1.2 : 0;
      const bedScaleY = crush ? 0.35 : (fire ? 0.95 : 1);
      const bedScaleX = crush ? 1.1 : 1;

      if (anim === 'cured') {
        ctx.save();
        ctx.globalAlpha = 0.35;
        const halo = ctx.createRadialGradient(0, 0, 6, 0, 0, 16);
        halo.addColorStop(0, 'rgba(120, 230, 210, 0.75)');
        halo.addColorStop(1, 'rgba(80, 150, 180, 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.ellipse(0, 4, 18, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.translate(shakeX + walkTilt * 0.2, shakeY);

      // Sombra
      ctx.save();
      ctx.scale(bedScaleX, bedScaleY);
      drawEllipse(ctx, 10.5, 4, 'rgba(0,0,0,0.25)');
      ctx.restore();

      // Cama base
      ctx.save();
      ctx.scale(bedScaleX, bedScaleY);
      ctx.fillStyle = '#9fbcc9';
      ctx.beginPath();
      ctx.roundRect(-12, -6, 24, 14, 4);
      ctx.fill();
      ctx.fillStyle = '#c8e4f0';
      ctx.beginPath();
      ctx.roundRect(-11, -5, 22, 12, 4);
      ctx.fill();
      ctx.fillStyle = '#62b8c4';
      ctx.beginPath();
      ctx.roundRect(-11, 0, 22, 8, 3);
      ctx.fill();
      ctx.restore();

      // Pie de suero
      ctx.save();
      ctx.translate(13 + shakeX * 0.2, -8 + shakeY * 0.2);
      ctx.strokeStyle = '#6a7c8a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, -14);
      ctx.moveTo(-3, -12); ctx.lineTo(3, -12);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(-1.5, -2, 3, 2);
      // Bolsas
      const bag = (color) => {
        ctx.beginPath();
        ctx.roundRect(-3.5, -11, 7, 8, 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.stroke();
      };
      ctx.save();
      ctx.translate(-5, -10);
      bag('rgba(230,70,70,0.75)');
      ctx.restore();
      ctx.save();
      ctx.translate(5, -10);
      bag('rgba(70,170,230,0.75)');
      ctx.restore();
      ctx.restore();

      // Colchón y sábana
      ctx.save();
      ctx.translate(0, -2 + bob * 0.4);
      ctx.scale(bedScaleX, bedScaleY);
      ctx.fillStyle = '#f7f9fb';
      ctx.beginPath();
      ctx.roundRect(-10, -6, 20, 12, 4);
      ctx.fill();
      ctx.fillStyle = '#8ed3d6';
      ctx.beginPath();
      ctx.roundRect(-10, 0, 20, 7, 3);
      ctx.fill();
      ctx.restore();

      // Paciente
      ctx.save();
      ctx.translate(0, -5 + bob);
      ctx.scale(crush ? 1.05 : 1, crush ? 0.55 : 1);

      // Cuerpo bajo sábana
      ctx.save();
      ctx.fillStyle = '#f8fbff';
      ctx.beginPath();
      ctx.roundRect(-8, 2, 16, 7, 3);
      ctx.fill();
      ctx.fillStyle = '#bde3e8';
      ctx.beginPath();
      ctx.roundRect(-7, 3, 14, 6, 3);
      ctx.fill();
      ctx.restore();

      // Brazos
      ctx.save();
      const armColor = fire ? '#d6b6a0' : '#f0c9b4';
      ctx.fillStyle = damage ? '#f3d9d0' : armColor;
      ctx.beginPath();
      ctx.roundRect(-9, 4, 4, 5, 2);
      ctx.roundRect(5, 4, 4, 5, 2);
      ctx.fill();
      ctx.restore();

      // Cabeza
      ctx.save();
      ctx.translate(0, -4 + (state?.headBob || 0));
      ctx.scale(1, crush ? 0.7 : 1);
      const faceColor = fire ? '#d1a88f' : '#f2cbb6';
      const paleFace = damage ? '#f1ded6' : faceColor;
      ctx.fillStyle = paleFace;
      ctx.beginPath();
      ctx.arc(0, 0, 7.5, 0, Math.PI * 2);
      ctx.fill();

      // Pelo
      ctx.save();
      ctx.fillStyle = fire ? '#5a3a2e' : '#3b2a26';
      ctx.beginPath();
      ctx.ellipse(0, -2, 9, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Ojos
      const eyeOpen = Math.max(0, 2.2 - (state?.blinkPhase || 0) * 2.2);
      ctx.fillStyle = '#0d0d0d';
      ctx.beginPath();
      ctx.ellipse(-3, -1, eyeOpen, 1.6, 0, 0, Math.PI * 2);
      ctx.ellipse(3, -1, eyeOpen, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Boca
      ctx.strokeStyle = '#a25454';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (anim === 'talk') {
        const mouth = 1 + Math.sin(state?.mouthT || 0) * 1.2;
        ctx.ellipse(0, 3.5, 2, mouth * 0.6, 0, 0, Math.PI * 2);
      } else if (anim === 'eat') {
        ctx.arc(0, 3.6, 2.4, 0, Math.PI * 1.05);
      } else if (dead && damage) {
        ctx.moveTo(-2, 4); ctx.lineTo(2, 4);
      } else {
        ctx.arc(0, 3.8, 2, 0, Math.PI);
      }
      ctx.stroke();

      // Muertes especiales en ojos
      if (dead) {
        if (damage) {
          ctx.strokeStyle = '#5a2d2d';
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(-4, -2); ctx.lineTo(-2, 1); ctx.lineTo(0, -2); ctx.lineTo(2, 1); ctx.lineTo(4, -2);
          ctx.stroke();
        } else if (fire) {
          ctx.fillStyle = 'rgba(50,50,50,0.6)';
          ctx.beginPath();
          ctx.arc(0, -4, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
      ctx.restore();

      // Overlay de fuego
      if (fire) {
        ctx.save();
        ctx.globalAlpha = 0.35 + (state?.deathProgress || 0) * 0.4;
        ctx.fillStyle = 'rgba(240,120,60,0.8)';
        ctx.beginPath();
        ctx.ellipse(0, -8, 10, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Humo para fuego
      if (fire) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#555';
        for (let i = 0; i < 2; i++) {
          const t = (state?.t || 0) + i * 0.6;
          const rise = Math.sin(t) * 2 + i * 5;
          ctx.beginPath();
          ctx.ellipse(-4 + i * 4, -16 - rise, 3 + i, 4 + i, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Brillo de curación
      if (anim === 'eat') {
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = 'rgba(140, 240, 220, 0.8)';
        ctx.beginPath();
        ctx.ellipse(0, -2, 8, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
    },
  });

  // Rig chibi para paciente tumbada en cama compacta (32x32 máx).
  PuppetAPI.registerRig('patient_bed', {
    create(host) {
      return { t: 0, step: 0, anim: 'idle', breath: 0, headSwing: 0, inertiaX: 0, inertiaY: 0 };
    },
    update(state, host, dt = 0) {
      if (!state || !host) return;
      state.t += dt;
      state.anim = host?.dead
        ? `death_${host.deathCause || 'damage'}`
        : (host.state || 'idle');
      const moving = state.anim.startsWith('walk');
      state.step += dt * (moving ? 7 : 4);
      state.breath = Math.sin(state.t * 2.1) * 0.5;
      state.headSwing = Math.sin(state.t * 1.4) * 0.3;
      state.inertiaX = moving && Math.abs(host.vx || 0) > Math.abs(host.vy || 0)
        ? -Math.sign(host.vx || 0) * 1.2
        : state.inertiaX * 0.9;
      state.inertiaY = moving && Math.abs(host.vy || 0) >= Math.abs(host.vx || 0)
        ? -Math.sign(host.vy || 0) * 1.2
        : state.inertiaY * 0.9;
    },
    draw(ctx, camera, host, state) {
      if (!ctx || !host || host._culled) return;
      const { x, y, cam } = baseCoords(ctx, host, camera);
      const zoom = (cam.zoom || 1) * (host.puppet?.scale || host.rig?.scale || 1);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(zoom, zoom);

      const anim = state?.anim || 'idle';
      const dead = anim.startsWith('death_');

      // Sombra
      ctx.save();
      const crushScale = anim === 'death_crush' ? 0.4 : 1;
      ctx.scale(1, crushScale);
      drawEllipse(ctx, 9, 3.6, 'rgba(0,0,0,0.25)');
      ctx.restore();

      // Base cama
      ctx.save();
      const squishY = anim === 'death_crush' ? 0.55 : 1;
      ctx.scale(1, squishY);
      ctx.fillStyle = '#d1dbe7';
      ctx.beginPath();
      ctx.roundRect(-12, -9, 24, 18, 5);
      ctx.fill();
      ctx.fillStyle = '#93b6d8';
      ctx.beginPath();
      ctx.roundRect(-11, -8, 22, 16, 4);
      ctx.fill();
      ctx.restore();

      // Colchón y manta
      const inertiaX = state?.inertiaX || 0;
      const inertiaY = state?.inertiaY || 0;
      ctx.save();
      ctx.translate(0, -1 + (anim === 'walk_v' ? inertiaY * 0.3 : 0));
      ctx.fillStyle = dead && anim === 'death_fire' ? '#3a414a' : '#bfe3e0';
      ctx.beginPath();
      ctx.roundRect(-11, -7, 22, 14, 4);
      ctx.fill();
      ctx.fillStyle = dead ? '#4b5b64' : '#6eb3b7';
      ctx.beginPath();
      ctx.moveTo(-11, -1);
      ctx.lineTo(-11, 6);
      ctx.quadraticCurveTo(-4 + inertiaX, 8 + inertiaY, 0, 7 + inertiaY * 0.6);
      ctx.quadraticCurveTo(4 + inertiaX, 8 + inertiaY, 11, 5);
      ctx.lineTo(11, -1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Almohada
      ctx.save();
      ctx.translate(0, -6 + inertiaY * 0.4);
      const pillowSquash = anim === 'death_damage' ? 0.85 : 1;
      ctx.scale(1, pillowSquash);
      ctx.fillStyle = dead && anim === 'death_fire' ? '#1f242b' : '#f2f7ff';
      ctx.beginPath();
      ctx.roundRect(-9, -5, 18, 10, 4);
      ctx.fill();
      ctx.restore();

      // Cuerpo bajo manta
      ctx.save();
      ctx.translate(0, 0.5 + (state?.breath || 0));
      ctx.fillStyle = dead && anim === 'death_fire' ? '#2f2f2f' : '#ffffff';
      ctx.beginPath();
      ctx.roundRect(-7, -1, 14, 7, 3);
      ctx.fill();
      ctx.restore();

      // Cabeza y expresión
      ctx.save();
      ctx.translate(0, -7 + (state?.breath || 0) * 0.4 + (anim === 'attack' ? -1 : 0));
      ctx.rotate((state?.headSwing || 0) * 0.2);
      const faceDark = dead && anim === 'death_fire';
      ctx.fillStyle = faceDark ? '#2e1f1a' : '#f4c8ad';
      ctx.beginPath();
      ctx.arc(0, 0, anim === 'death_crush' ? 5.5 : 6.5, 0, TAU);
      ctx.fill();

      // Pelo
      ctx.save();
      ctx.translate(-1, 1);
      ctx.fillStyle = faceDark ? '#1b120f' : '#6b4a2f';
      ctx.beginPath();
      ctx.ellipse(0, 2, 9, 6, 0, 0, TAU);
      ctx.fill();
      ctx.restore();

      // Ojos
      ctx.fillStyle = faceDark ? '#fafafa' : '#2e2e2e';
      ctx.beginPath();
      const eyeOffset = anim === 'attack' ? 2.4 : 2.0;
      ctx.arc(-eyeOffset, -0.5, 0.8, 0, TAU);
      ctx.arc(eyeOffset, -0.5, 0.8, 0, TAU);
      ctx.fill();

      // Mejillas y boca
      if (anim !== 'death_damage' && anim !== 'death_crush' && anim !== 'death_fire') {
        if (anim === 'attack') {
          ctx.fillStyle = '#ff6b6b';
          ctx.beginPath();
          ctx.arc(-4, 1.5, 1.4, 0, TAU);
          ctx.arc(4, 1.5, 1.4, 0, TAU);
          ctx.fill();
        }
        ctx.strokeStyle = faceDark ? '#ffffff' : '#a33';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        const mouthOpen = anim === 'attack' ? 2.6 : anim === 'talk' ? 1.8 : 1.4;
        ctx.arc(0, 2.5, mouthOpen, 0, Math.PI);
        ctx.stroke();
      } else if (anim === 'death_fire') {
        ctx.strokeStyle = '#fafafa';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-3, 0);
        ctx.lineTo(-1, -2);
        ctx.moveTo(3, 0);
        ctx.lineTo(1, -2);
        ctx.stroke();
      }
      ctx.restore();

      // Mano comiendo
      if (anim === 'eat') {
        ctx.save();
        ctx.translate(6, 1);
        ctx.fillStyle = '#f4c8ad';
        drawEllipse(ctx, 2.5, 1.4, ctx.fillStyle);
        ctx.fillStyle = '#ffd166';
        drawEllipse(ctx, -1.5, -1, 0.8, 0.8);
        ctx.restore();

        ctx.save();
        ctx.translate(-8, -6);
        ctx.fillStyle = 'rgba(255,170,200,0.9)';
        drawEllipse(ctx, 1.5, 1.5, ctx.fillStyle);
        ctx.translate(3, -3);
        drawEllipse(ctx, 1.1, 1.1, ctx.fillStyle);
        ctx.restore();
      }

      // Humo muerte por fuego
      if (anim === 'death_fire') {
        ctx.save();
        ctx.translate(0, -11);
        ctx.fillStyle = 'rgba(80,80,80,0.7)';
        drawEllipse(ctx, 2.5, 1.6, ctx.fillStyle);
        ctx.translate(1, -3);
        drawEllipse(ctx, 2.0, 1.2, ctx.fillStyle);
        ctx.translate(-2, -3);
        drawEllipse(ctx, 1.6, 1.0, ctx.fillStyle);
        ctx.restore();
      }

      ctx.restore();
    }
  });

  // Rig chibi para el celador barrigón (canvas shapes, sin sprites externos).
  PuppetAPI.registerRig('npc_celador', {
    create(host) {
      return { rigName: 'npc_celador', host, t: 0, step: 0, idleBob: 0, pushSquash: 1, deathTimer: 0 };
    },
    update(state, host, dt = 0) {
      if (!state || !host) return;
      state.t += dt;
      const mvx = Math.abs(host.vx || 0);
      const mvy = Math.abs(host.vy || 0);
      let anim = 'idle';
      if (host.dead) {
        anim = `death_${host.deathCause || 'damage'}`;
        state.deathTimer += dt;
      } else if (host.isPushing || host.state === 'push') {
        anim = 'push';
      } else if (host.state === 'attack') {
        anim = 'attack';
      } else if (host.state === 'eat') {
        anim = 'eat';
      } else if (mvx > mvy && (mvx > 1 || host.state === 'walk_h')) {
        anim = 'walk_h';
      } else if (mvy >= mvx && (mvy > 1 || host.state === 'walk_v')) {
        anim = 'walk_v';
      }
      state.anim = anim;
      state.step += dt * (anim.startsWith('walk') ? 9 : 6);
      state.idleBob = Math.sin(state.t * 2.2) * 0.8;
      state.pushSquash = anim === 'push' ? 1 + Math.sin(state.t * 10) * 0.08 : 1;
    },
    draw(ctx, camera, host, state) {
      if (!ctx || !host || host._culled) return;
      const { x, y, cam } = baseCoords(ctx, host, camera);
      const zoom = (cam.zoom || 1) * (host.puppet?.scale || host.rig?.scale || 1);
      ctx.save();
      ctx.translate(x, y + (state?.idleBob || 0) * zoom * 0.6);
      if (state?.anim === 'death_crush') ctx.scale(1.05, 0.35);
      if (state?.anim === 'death_damage') ctx.rotate(-0.18);
      const flip = (host.vx || host.dir || 0) < 0 ? -1 : 1;
      ctx.scale(zoom * flip, zoom);

      // Sombra
      ctx.save();
      ctx.translate(0, 12);
      drawEllipse(ctx, 9, 4, 'rgba(0,0,0,0.25)');
      ctx.restore();

      // Cuerpo y barriga
      ctx.save();
      const lean = state?.anim === 'push' ? -0.15 : state?.anim === 'attack' ? -0.08 : -0.02;
      ctx.rotate(lean);
      ctx.scale(1, state?.pushSquash || 1);
      ctx.fillStyle = '#f3f6ff';
      ctx.beginPath();
      ctx.roundRect(-11, -4, 22, 18, 7);
      ctx.fill();
      ctx.fillStyle = '#dfe6ff';
      ctx.beginPath();
      ctx.roundRect(-10, 4, 20, 8, 4);
      ctx.fill();
      ctx.restore();

      // Brazos sencillos
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#f3c4a1';
      const armSwing = Math.sin(state?.step || 0) * 4;
      const pushReach = state?.anim === 'push' ? 6 : 0;
      ctx.beginPath();
      ctx.moveTo(-10, -2);
      ctx.lineTo(-14 - pushReach, 6 + armSwing * 0.3);
      ctx.moveTo(10, -2);
      ctx.lineTo(14 + pushReach, 6 - armSwing * 0.5 - (state?.anim === 'eat' ? 6 : 0));
      ctx.stroke();
      ctx.restore();

      // Piernas
      ctx.save();
      ctx.translate(0, 8);
      const step = Math.sin(state?.step || 0) * 3;
      ctx.fillStyle = '#e7ecff';
      ctx.beginPath();
      ctx.roundRect(-9 + step, -1, 7, 10, 3);
      ctx.roundRect(2 - step, -1, 7, 10, 3);
      ctx.fill();
      ctx.fillStyle = '#cfd7ff';
      ctx.roundRect(-9 + step, 6, 8, 3, 2);
      ctx.roundRect(2 - step, 6, 8, 3, 2);
      ctx.restore();

      // Cabeza grande
      ctx.save();
      ctx.translate(0, -11 + (state?.anim === 'talk' ? Math.sin(state.t * 6) : 0));
      drawEllipse(ctx, 9.5, 8.5, '#f7c9a8');
      ctx.fillStyle = '#d8a077';
      ctx.fillRect(-5, -3, 10, 2);
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath();
      ctx.arc(-3, -2.5, 1.4, 0, TAU);
      ctx.arc(3, -2.5, 1.4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#5a4634';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-5, -5); ctx.lineTo(0, -7);
      ctx.moveTo(2, -6); ctx.lineTo(5, -7.5);
      ctx.stroke();
      ctx.strokeStyle = '#a33';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const mouth = state?.anim === 'eat' ? 2.4 : state?.anim === 'attack' ? 2.0 : 1.6;
      ctx.arc(0, 2, mouth, 0, Math.PI);
      ctx.stroke();
      ctx.restore();

      // Bocadillo/vaso fantasma al comer
      if (state?.anim === 'eat') {
        ctx.save();
        ctx.translate(12, -8);
        ctx.fillStyle = '#f8f8f8';
        ctx.beginPath();
        ctx.roundRect(-3, -3, 6, 6, 2);
        ctx.fill();
        ctx.fillStyle = '#d0d7ff';
        drawEllipse(ctx, 3, 1.3, '#d0d7ff');
        ctx.restore();
      }

      // Poses de muerte
      if (host.dead) {
        if (host.deathCause === 'fire') {
          ctx.save();
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = '#2c2c2c';
          ctx.beginPath();
          ctx.roundRect(-11, -14, 22, 26, 6);
          ctx.fill();
          ctx.fillStyle = '#ff9800';
          ctx.beginPath();
          ctx.moveTo(0, -16); ctx.lineTo(-3, -8); ctx.lineTo(3, -8);
          ctx.fill();
          ctx.restore();
        } else if (host.deathCause === 'crush') {
          ctx.save();
          ctx.globalAlpha = 0.8;
          ctx.scale(1.1, 0.4);
          drawEllipse(ctx, 11, 9, '#f0f2f5');
          ctx.restore();
        }
      }

      ctx.restore();
    },
  });

  // Rig chibi para el guardia de seguridad hostil.
  PuppetAPI.registerRig('npc_guard', {
    create(e) {
      return { t: 0, walkPhase: 0, bob: 0, flip: 1 };
    },
    update(st, e, dt) {
      st.t += dt;
      if (e.dead) {
        e.state = 'dead';
      } else if (Math.abs(e.vx) > Math.abs(e.vy) && Math.abs(e.vx) > 1) {
        e.state = 'walk_h';
        st.flip = e.vx >= 0 ? 1 : -1;
      } else if (Math.abs(e.vy) > 1) {
        e.state = 'walk_v';
      } else if (e.isAttacking) {
        e.state = 'attack';
      } else if (e.isEating) {
        e.state = 'eat';
      } else if (e.isPushing) {
        e.state = 'push';
      } else if (e.isTalking) {
        e.state = 'talk';
      } else {
        e.state = 'idle';
      }
      st.walkPhase += dt * (e.state === 'walk_h' || e.state === 'walk_v' ? 8 : 0);
      st.bob = Math.sin(st.t * 4) * (e.state === 'idle' ? 1.5 : 0.5);
    },
    draw(ctx, cam, e, st) {
      if (e._culled) return;
      const toScreen = (camera, host) => {
        const camUse = camera || { x: 0, y: 0, zoom: 1, scale: camera?.zoom };
        const canvas = ctx?.canvas || { width: 0, height: 0 };
        return {
          x: (host.x - camUse.x) * (camUse.zoom || camUse.scale || 1) + canvas.width * 0.5,
          y: (host.y - camUse.y) * (camUse.zoom || camUse.scale || 1) + canvas.height * 0.5,
          scale: camUse.zoom || camUse.scale || 1,
        };
      };
      const s = cam?.scale || cam?.zoom || 1;
      const screen = toScreen(cam, e);
      const cx = screen.x;
      const cy = screen.y + st.bob;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(st.flip * s, s);

      const bodyW = 18;
      const bodyH = 22;
      const headR = 9;

      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.ellipse(0, bodyH * 0.6, bodyW * 0.7, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.globalAlpha = 1;

      const legOffset = Math.sin(st.walkPhase) * 2;
      ctx.fillStyle = '#222';
      ctx.fillRect(-6 + legOffset, 6, 5, 10);
      ctx.fillRect(1 - legOffset, 6, 5, 10);

      ctx.fillStyle = '#333';
      ctx.fillRect(-bodyW / 2, -2, bodyW, bodyH);

      ctx.fillStyle = '#111';
      ctx.fillRect(-bodyW / 2, 5, bodyW, 3);

      ctx.fillStyle = '#f4d03f';
      ctx.fillRect(-bodyW / 2 + 2, -1, 10, 4);

      ctx.save();
      let armAngle = 0;
      if (e.state === 'attack') armAngle = -0.7;
      ctx.translate(bodyW / 2 - 2, 0);
      ctx.rotate(armAngle);
      ctx.fillStyle = '#333';
      ctx.fillRect(0, -2, 7, 4);
      ctx.fillStyle = '#111';
      ctx.fillRect(6, -1, 6, 2);
      ctx.restore();

      ctx.save();
      let armAngleL = 0;
      if (e.isPushing) armAngleL = 0.6;
      ctx.translate(-bodyW / 2 + 2, 0);
      ctx.rotate(armAngleL);
      ctx.fillStyle = '#333';
      ctx.fillRect(-7, -2, 7, 4);
      ctx.restore();

      ctx.beginPath();
      ctx.arc(0, -headR - 4, headR, 0, Math.PI * 2);
      ctx.fillStyle = '#f5c08a';
      ctx.fill();

      ctx.fillStyle = '#000';
      ctx.fillRect(-4, -headR - 4, 3, 2);
      ctx.fillRect(1, -headR - 4, 3, 2);
      ctx.beginPath();
      ctx.moveTo(-4, -headR + 1);
      ctx.lineTo(4, -headR + 1);
      ctx.strokeStyle = '#a45';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      if (e.state === 'talk') {
        ctx.ellipse(0, -headR + 4, 2.5, 3, 0, 0, Math.PI * 2);
      } else if (e.state === 'attack') {
        ctx.moveTo(-3, -headR + 4);
        ctx.lineTo(3, -headR + 5);
      } else {
        ctx.moveTo(-3, -headR + 4);
        ctx.quadraticCurveTo(0, -headR + 6, 3, -headR + 4);
      }
      ctx.strokeStyle = '#733';
      ctx.stroke();

      if (e.dead) {
        ctx.globalAlpha = 0.8;
        if (e.deathCause === 'crush') {
          ctx.setTransform(1, 0, 0, 0.3, cx, cy + 6);
        } else if (e.deathCause === 'fire') {
          ctx.globalCompositeOperation = 'multiply';
        } else {
          ctx.rotate(-0.2);
        }
      }
      ctx.restore();
    },
  });

  // Rig chibi para el jefe de servicio: barriga prominente y bata blanca.
  PuppetAPI.registerRig('npc_jefe_servicio', {
    create(host) {
      return { rigName: 'npc_jefe_servicio', host, t: 0, anim: 'idle', breath: 0, step: 0, talk: 0, deathT: 0 };
    },
    update(state, host, dt = 0) {
      if (!state || !host) return;
      state.t += dt;
      const mvx = Math.abs(host.vx || 0);
      const mvy = Math.abs(host.vy || 0);
      let anim = 'idle';
      if (host.dead) {
        anim = `death_${host.deathCause || 'damage'}`;
        state.deathT += dt;
      } else if (host.isTalking) {
        anim = 'talk';
      } else if (host.isPushing) {
        anim = 'push';
      } else if (host.isAttacking) {
        anim = 'attack';
      } else if (host.isEating) {
        anim = 'eat';
      } else if (mvx > 1 || mvy > 1) {
        anim = mvx > mvy ? 'walk_h' : 'walk_v';
      }
      state.anim = anim;
      state.breath = Math.sin(state.t * 2.2) * 1.4; // idle breathing
      state.step = Math.sin(state.t * (anim.startsWith('walk') ? 8 : 4)); // paso de piernas/brazos
      state.talk = Math.abs(Math.sin(state.t * 6)) * (anim === 'talk' ? 1 : 0); // boca charlando
    },
    draw(ctx, camera, host, state) {
      if (!ctx || !host || host._culled) return;
      const { x, y, cam } = baseCoords(ctx, host, camera);
      const z = (cam.zoom || 1) * (host.puppet?.scale || host.rig?.scale || 1);
      ctx.save();
      ctx.translate(x, y + (state?.breath || 0) * 0.15);
      if (state?.anim === 'death_crush') ctx.scale(1.15, 0.35); // death by crush
      if (state?.anim === 'death_damage') ctx.rotate(-0.5); // death by damage
      const flip = (host.vx || host.dir || 0) < 0 ? -1 : 1;
      ctx.scale(z * flip, z);

      // Sombra base
      ctx.save();
      ctx.translate(0, 12);
      drawEllipse(ctx, 10, 4, 'rgba(0,0,0,0.25)');
      ctx.restore();

      // Cuerpo redondo con bata
      ctx.save();
      const bellyScale = 1 + (state?.breath || 0) * 0.015;
      ctx.scale(bellyScale, bellyScale);
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath();
      ctx.roundRect(-10, -6, 20, 20, 6);
      ctx.fill();
      ctx.fillStyle = '#8cb6ff'; // pijama azul
      ctx.beginPath();
      ctx.roundRect(-9, 2, 18, 10, 4);
      ctx.fill();
      ctx.fillStyle = '#d84315';
      ctx.fillRect(-3, 2, 2, 6); // cruz pequeña
      ctx.restore();

      // Barriga sobresaliente
      ctx.save();
      ctx.translate(0, 4 + (state?.breath || 0) * 0.2);
      drawEllipse(ctx, 11, 7, '#f7d7c4');
      ctx.restore();

      // Piernas y pies simples
      ctx.save();
      ctx.translate(0, 10);
      const step = state?.step || 0;
      ctx.fillStyle = '#8cb6ff';
      ctx.beginPath();
      ctx.roundRect(-8 + step * 0.6, -2, 6, 8, 2);
      ctx.roundRect(2 - step * 0.6, -2, 6, 8, 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.roundRect(-8 + step * 0.6, 4, 7, 3, 2);
      ctx.roundRect(2 - step * 0.6, 4, 7, 3, 2);
      ctx.restore();

      // Brazos
      ctx.save();
      ctx.translate(0, 0);
      ctx.strokeStyle = '#f7d7c4';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const pushLean = state?.anim === 'push' ? 6 : 0;
      ctx.moveTo(-9, -2);
      ctx.lineTo(-14 - pushLean, 4 + step * 0.4);
      ctx.moveTo(9, -2);
      const forward = state?.anim === 'attack' ? 16 : (state?.anim === 'eat' ? 4 : 10);
      ctx.lineTo(12 + forward, 2 + (state?.anim === 'eat' ? -4 : 0));
      ctx.stroke();
      ctx.restore();

      // Cabeza grande
      ctx.save();
      ctx.translate(0, -10 + (state?.anim === 'talk' ? Math.sin(state.t * 6) : 0)); // talk bounce
      drawEllipse(ctx, 10, 9, '#f7d7c4');
      ctx.fillStyle = '#d49b76';
      ctx.fillRect(-5, -2, 10, 2);
      // Pelo escaso
      ctx.strokeStyle = '#4a3b30';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-6, -5); ctx.lineTo(-1, -7);
      ctx.moveTo(2, -6); ctx.lineTo(6, -8);
      ctx.stroke();
      // Ojos
      ctx.fillStyle = '#2e2e2e';
      ctx.beginPath();
      ctx.arc(-3, -2.5, 1.6, 0, TAU); ctx.arc(3, -2.5, 1.6, 0, TAU);
      ctx.fill();
      // Boca / hablar / comer
      ctx.strokeStyle = '#a33';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const mouthOpen = state?.anim === 'talk' ? 3 + state.talk : state?.anim === 'eat' ? 2.5 : 1.8;
      ctx.arc(0, 2, mouthOpen, 0, Math.PI);
      ctx.stroke();
      ctx.restore();

      // Yogur en mano
      ctx.save();
      const handY = state?.anim === 'eat' ? -6 : -2;
      ctx.translate(12 + (state?.anim === 'attack' ? 4 : 0), handY);
      ctx.fillStyle = '#fafafa';
      ctx.beginPath();
      ctx.roundRect(-3, -3, 6, 6, 2);
      ctx.fill();
      ctx.fillStyle = '#ffb3c1';
      drawEllipse(ctx, 2.5, 1.4, '#ffb3c1');
      ctx.restore();

      // Muertes específicas
      if (host.dead) {
        if (host.deathCause === 'fire') {
          ctx.save();
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = '#2b2b2b';
          ctx.beginPath();
          ctx.roundRect(-12, -14, 24, 28, 6);
          ctx.fill();
          ctx.fillStyle = '#ff9800';
          ctx.beginPath();
          ctx.moveTo(0, -18); ctx.lineTo(-2, -12); ctx.lineTo(2, -12); ctx.fill();
          ctx.restore();
        }
      }

      ctx.restore();
    },
  });

  // Rig específico para la TCAE despistada (no comparte implementación con otros NPC humanos).
  PuppetAPI.registerRig('npc_tcae', {
    create(host) {
      return { t: 0, walkPhase: 0, bob: 0, mouthPhase: 0, pushPhase: 0, deathT: 0, host };
    },
    update(st, e, dt) {
      if (!st || !e || e._culled) return;
      st.t += dt;
      const mvx = Math.abs(e.vx || 0);
      const mvy = Math.abs(e.vy || 0);
      const movingH = mvx > mvy && mvx > 0.01;
      const movingV = mvy > mvx && mvy > 0.01;

      if (e.dead) {
        st.deathT += dt;
        return;
      }
      if (e.state === 'talk') st.mouthPhase += dt * 8;
      if (e.state === 'push') st.pushPhase += dt * 10;

      if (movingH || movingV) {
        st.walkPhase += dt * 10;
        st.bob = Math.sin(st.walkPhase) * 1.5;
      } else {
        st.walkPhase = 0;
        st.bob = Math.sin(st.t * 2) * 0.5;
      }
    },
    draw(ctx, cam, e, st) {
      if (!ctx || !e || e._culled) return;
      const { x, y, cam: camera } = baseCoords(ctx, e, cam);
      const scale = (camera?.zoom || 1) * (e.puppet?.scale || 1);

      ctx.save();
      ctx.translate(x, y + (st?.bob || 0));
      ctx.scale(scale, scale);

      const bodyW = 18;
      const bodyH = 18;

      // Piernas
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-bodyW * 0.35, 2, bodyW * 0.3, bodyH * 0.6);
      ctx.fillRect(bodyW * 0.05, 2, bodyW * 0.3, bodyH * 0.6);

      // Zuecos rosas
      ctx.fillStyle = '#f26ba8';
      ctx.beginPath();
      ctx.roundRect(-bodyW * 0.4, bodyH * 0.6, bodyW * 0.35, 5, 2);
      ctx.roundRect(bodyW * 0.05, bodyH * 0.6, bodyW * 0.35, 5, 2);
      ctx.fill();

      // Torso
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath();
      ctx.roundRect(-bodyW * 0.5, -bodyH * 0.1, bodyW, bodyH * 0.8, 6);
      ctx.fill();

      // Cabeza
      ctx.fillStyle = '#f2b48f';
      ctx.beginPath();
      ctx.arc(0, -bodyH * 0.4, bodyW * 0.55, 0, TAU);
      ctx.fill();

      // Pelo rizado
      ctx.fillStyle = '#3a2618';
      ctx.beginPath();
      ctx.arc(-6, -bodyH * 0.5, 8, 0, TAU);
      ctx.arc(6, -bodyH * 0.55, 8, 0, TAU);
      ctx.arc(0, -bodyH * 0.65, 9, 0, TAU);
      ctx.fill();

      // Ojos
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-4, -bodyH * 0.45, 3, 0, TAU);
      ctx.arc(4, -bodyH * 0.45, 3, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#3b2a20';
      ctx.beginPath();
      ctx.arc(-4, -bodyH * 0.45, 1.6, 0, TAU);
      ctx.arc(4, -bodyH * 0.45, 1.6, 0, TAU);
      ctx.fill();

      // Boca
      ctx.fillStyle = '#d46b5b';
      const mouthOpen = e.state === 'talk' ? (Math.sin(st?.mouthPhase || 0) * 0.5 + 0.5) : 0.4;
      ctx.beginPath();
      ctx.ellipse(0, -bodyH * 0.35, 3.5, 2 * mouthOpen, 0, 0, TAU);
      ctx.fill();

      // Efectos de muerte
      if (e.dead) {
        ctx.globalAlpha = 0.8;
        if (e.deathCause === 'crush') {
          ctx.rotate(0.1);
          ctx.scale(1.2, 0.3);
        } else if (e.deathCause === 'fire') {
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(-bodyW * 0.6, -bodyH * 0.6, bodyW * 1.2, bodyH * 1.2);
        }
      }

      ctx.restore();
    },
  });

  // Pequeño proyectil de yogur bomba.
  PuppetAPI.registerRig('projectile_yogurt', {
    create(host) {
      return { rigName: 'projectile_yogurt', host, t: 0 };
    },
    update(state, host, dt = 0) {
      if (!state || !host) return;
      state.t += dt;
    },
    draw(ctx, camera, host, state) {
      if (!ctx || !host || host._culled) return;
      const { x, y, cam } = baseCoords(ctx, host, camera);
      const z = (cam.zoom || 1) * (host.puppet?.scale || 1);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(z, z);
      ctx.rotate(host.dir || 0);
      ctx.fillStyle = '#ffffff';
      drawEllipse(ctx, 4, 3, '#ffffff');
      ctx.fillStyle = '#ffb3c1';
      drawEllipse(ctx, 3, 2, '#ffb3c1', 0.8);
      ctx.restore();
    }
  });

  PuppetAPI.registerRig('enemy_mosquito', {
    create(host) {
      return {
        rigName: 'enemy_mosquito',
        host,
        t: 0,
        bob: 0,
        flap: 0,
        anim: 'idle',
        debug: false,
        deathT: 0,
      };
    },
    update(state, host, dt = 0) {
      if (!state || !host) return;
      state.t += dt;
      const speed = Math.hypot(host.vx || 0, host.vy || 0);
      const moving = speed > 6;
      let anim = 'idle';
      if (host.dead) {
        const cause = host.deathCause || 'damage';
        anim = `death_${cause}`;
        state.deathT += dt;
      } else if (host.isAttacking) {
        anim = 'attack';
      } else if (host.isEating) {
        anim = 'eat';
      } else if (moving) {
        anim = Math.abs(host.vx) >= Math.abs(host.vy) ? 'move_h' : 'move_v';
      }
      state.anim = anim;
      state.bob = Math.sin(state.t * 4) * 2;
      state.flap = Math.sin(state.t * (anim.startsWith('move') ? 18 : 12));
      state.shake = host.isAttacking ? Math.sin(state.t * 30) * 1.5 : 0;
      state.scalePulse = anim === 'eat' ? 1.06 + Math.sin(state.t * 6) * 0.04 : 1;
    },
    draw(ctx, cam, host, state) {
      if (!ctx || !host || host._culled) return;
      const { x, y, cam: camera } = baseCoords(ctx, host, cam);
      const zoom = (camera.zoom || 1) * (host.puppet?.scale || host.rig?.scale || 1);
      ctx.save();
      ctx.translate(x, y + (state?.bob || 0));
      ctx.scale(zoom, zoom);

      if (state?.anim?.startsWith('death_crush')) ctx.scale(1.2, 0.6);
      if (state?.anim?.startsWith('death_damage')) ctx.rotate(0.6);

      const flip = (host.vx || 0) < 0 ? -1 : 1;
      ctx.scale(flip, 1);

      // Alas semitransparentes
      const wingAlpha = 0.5 + 0.25 * Math.sin((state?.flap || 0) * 2);
      drawWing(ctx, 14, 6, -0.6 + (state?.flap || 0) * 0.05, wingAlpha);
      drawWing(ctx, 14, 6, 0.2 - (state?.flap || 0) * 0.05, wingAlpha);

      // Cuerpo con franjas
      ctx.save();
      ctx.translate(state?.shake || 0, 0);
      const bodyScale = state?.scalePulse || 1;
      ctx.scale(bodyScale, bodyScale);
      drawEllipse(ctx, 9, 6, '#f7b733');
      drawEllipse(ctx, 11, 8, '#fbc02d');
      drawEllipse(ctx, 12, 9, '#fdd835');
      ctx.save();
      ctx.fillStyle = '#8d4b1f';
      ctx.beginPath();
      ctx.ellipse(0, 0, 12, 9, 0, -0.2, Math.PI * 0.2);
      ctx.fill();
      ctx.restore();

      // Cabeza
      ctx.save();
      ctx.translate(-8, -6);
      drawEllipse(ctx, 9, 8, '#ffe0b2');
      ctx.save();
      ctx.translate(-4, -2);
      drawEllipse(ctx, 4, 5, '#ffffff');
      ctx.fillStyle = '#3c2f2f';
      drawEllipse(ctx, 2, 3, '#3c2f2f');
      ctx.restore();
      ctx.save();
      ctx.translate(4, -2);
      drawEllipse(ctx, 4, 5, '#ffffff');
      drawEllipse(ctx, 2, 3, '#3c2f2f');
      ctx.restore();
      ctx.restore();

      // Trompa/aguijón
      ctx.save();
      ctx.translate(10, 0);
      ctx.rotate(0.1);
      ctx.fillStyle = '#c0581c';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(14, -2);
      ctx.lineTo(14, 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Patas simplificadas
      ctx.save();
      ctx.strokeStyle = '#6d4c41';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-6, 6);
      ctx.lineTo(-12, 10);
      ctx.moveTo(-2, 8);
      ctx.lineTo(-10, 14);
      ctx.stroke();
      ctx.restore();

      // Humo en muerte por fuego
      if (state?.anim === 'death_fire') {
        ctx.save();
        ctx.translate(0, -12);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#6d4c41';
        ctx.beginPath();
        ctx.moveTo(-2, 0); ctx.lineTo(0, -6); ctx.lineTo(2, 0);
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
    }
    });
  // Rig chibi para enemy_rat (cuerpo 1 tile, cabeza grande, cola expresiva)
  PuppetAPI.registerRig('enemy_rat', {
    create(host) {
      return {
        rigName: 'enemy_rat',
        host,
        t: 0,
        anim: 'idle',
        bob: 0,
        nose: 0,
        tail: 0,
        shake: 0,
        deathT: 0,
      };
    },
    update(state, host, dt = 0) {
      if (!state || !host) return;
      state.t += dt;
      const speed = Math.hypot(host.vx || 0, host.vy || 0);
      const moving = speed > 6;
      let anim = 'idle';
      if (host.dead) {
        const cause = host.deathCause || 'damage';
        anim = `death_${cause}`;
        state.deathT += dt;
      } else if (host.isAttacking) {
        anim = 'attack';
      } else if (host.isEating) {
        anim = 'eat';
      } else if (moving) {
        anim = Math.abs(host.vx) >= Math.abs(host.vy) ? 'move_h' : 'move_v';
      }
      state.anim = anim;
      state.bob = Math.sin(state.t * 3.6) * 1.5;
      state.nose = Math.sin(state.t * 2.8) * (anim === 'idle' ? 1.8 : 1.0);
      state.tail = Math.sin(state.t * (anim.startsWith('move') ? 6 : 3));
      state.shake = anim === 'attack' ? Math.sin(state.t * 26) * 1.8 : 0;
      state.stretch = anim.startsWith('move') ? 1 + Math.sin(state.t * 6) * 0.04 : 1;
      state.squash = anim === 'eat' ? 1.05 + Math.sin(state.t * 10) * 0.05 : 1;
    },
    draw(ctx, cam, host, state) {
      if (!ctx || !host || host._culled) return;
      const { x, y, cam: camera } = baseCoords(ctx, host, cam);
      const zoom = (camera.zoom || 1) * (host.puppet?.scale || host.rig?.scale || 1);
      ctx.save();
      ctx.translate(x, y + (state?.bob || 0));
      ctx.scale(zoom, zoom);

      const anim = state?.anim || 'idle';
      const darken = anim === 'death_fire';

      const flip = (host.vx || 0) < 0 ? -1 : 1;
      ctx.scale(flip, 1);
      if (state?.anim?.startsWith('death_crush')) ctx.scale(1.2, 0.5);
      if (state?.anim === 'death_damage') ctx.rotate(0.9);

      const stretch = state?.stretch || 1;
      const squash = state?.squash || 1;

      // Cola
      ctx.save();
      ctx.translate(-10, 6);
      ctx.rotate(-0.3 + (state?.tail || 0) * 0.15 + (state?.anim?.startsWith('move') ? 0.1 * flip : 0));
      ctx.strokeStyle = '#d7877f';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-8, -4, -14, 2);
      ctx.quadraticCurveTo(-20, 6, -14, 10);
      ctx.stroke();
      ctx.restore();

      // Patas (sencillas)
      const legY = 10;
      ctx.save();
      ctx.fillStyle = '#8b5a3c';
      const step = Math.sin((state?.t || 0) * 10);
      const moveAnim = state?.anim?.startsWith('move');
      const front = moveAnim ? step * 2 : 0;
      const back = moveAnim ? -step * 2 : 0;
      ctx.beginPath();
      ctx.ellipse(-6 + back, legY, 4, 5, 0, 0, Math.PI * 2);
      ctx.ellipse(6 + front, legY, 4, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Cuerpo
      ctx.save();
      ctx.translate(state?.shake || 0, 0);
      ctx.scale(stretch, squash);
      ctx.fillStyle = darken ? '#5d4634' : '#b4845f';
      ctx.beginPath();
      ctx.ellipse(0, 0, 11, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = darken ? '#715943' : '#c59c7a';
      ctx.beginPath();
      ctx.ellipse(0, 2, 10, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Cabeza
      ctx.save();
      ctx.translate(8, -4 + (state?.nose || 0) * 0.2);
      ctx.scale(1.1, 1.05);
      ctx.fillStyle = darken ? '#6a5440' : '#c49a75';
      ctx.beginPath();
      ctx.ellipse(0, 0, 12, 11, 0, 0, Math.PI * 2);
      ctx.fill();

      // Orejas
      ctx.save();
      ctx.fillStyle = '#f4b7a7';
      ctx.beginPath();
      ctx.ellipse(-6, -10, 5, 7, 0, 0, Math.PI * 2);
      ctx.ellipse(8, -10, 5, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#a36e53';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();

      // Cara
      ctx.save();
      ctx.translate(0, state?.nose || 0);
      // Ojos
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(-3, -3, 4, 5, 0, 0, Math.PI * 2);
      ctx.ellipse(5, -3, 4, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2c1f1b';
      ctx.beginPath();
      ctx.ellipse(-3 + (state?.anim === 'attack' ? 1 : 0), -3, 2, 3, 0, 0, Math.PI * 2);
      ctx.ellipse(5 + (state?.anim === 'attack' ? 1 : 0), -3, 2, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Nariz y bigotes
      ctx.fillStyle = '#d66d6d';
      ctx.beginPath();
      ctx.ellipse(10, 2, 3, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.moveTo(7, 2); ctx.lineTo(12, 0);
      ctx.moveTo(7, 4); ctx.lineTo(12, 5);
      ctx.stroke();

      // Boca
      ctx.strokeStyle = '#7a4d35';
      ctx.lineWidth = 1.4;
      if (state?.anim === 'attack') {
        ctx.beginPath();
        ctx.moveTo(6, 5);
        ctx.lineTo(10, 7);
        ctx.lineTo(14, 5);
        ctx.stroke();
      } else if (state?.anim === 'eat') {
        const chew = Math.sin((state?.t || 0) * 16) * 1.5;
        ctx.beginPath();
        ctx.moveTo(6, 5 + chew);
        ctx.lineTo(12, 6 - chew);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(6, 5);
        ctx.quadraticCurveTo(10, 7, 12, 5);
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();

      // Muertes especiales
      if (state?.anim === 'death_fire') {
        ctx.save();
        ctx.translate(0, -12);
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = '#b33b2e';
        ctx.beginPath();
        ctx.moveTo(-2, 0); ctx.lineTo(-1, -8); ctx.lineTo(2, 0);
        ctx.moveTo(4, -2); ctx.lineTo(6, -12); ctx.lineTo(8, -2);
        ctx.stroke();
        ctx.restore();
      } else if (state?.anim === 'death_damage') {
        ctx.save();
        ctx.translate(0, -8);
        ctx.fillStyle = '#e57373';
        ctx.beginPath();
        ctx.moveTo(-3, -3); ctx.lineTo(-1, 0); ctx.lineTo(-3, 3); ctx.lineTo(-5, 0); ctx.closePath();
        ctx.moveTo(5, -3); ctx.lineTo(7, 0); ctx.lineTo(5, 3); ctx.lineTo(3, 0); ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
    }
  });

  // Rig chibi enfermera sexy (idle/walk/talk/attack/deaths)
  PuppetAPI.registerRig('npc_nurse_sexy', {
    create(host) {
      return {
        rigName: 'npc_nurse_sexy',
        t: 0,
        anim: 'idle',
        phaseWalk: 0,
        bounceIdle: 0,
        mouthOpen: 0,
        talkT: 0,
        deathProgress: 0,
        flipX: false,
      };
    },
    update(st, e, dt = 0) {
      if (!st || !e) return;
      st.t += dt;
      const moving = Math.hypot(e.vx || 0, e.vy || 0) > 4;
      st.flipX = (e.vx || 0) < 0;
      let anim = e.state || 'idle';
      if (e.dead) {
        anim = `death_${e.deathCause || 'damage'}`;
        st.deathProgress = Math.min(1, st.deathProgress + dt * 0.8);
      } else if (anim === 'idle' && moving) {
        anim = Math.abs(e.vx) > Math.abs(e.vy) ? 'walk_h' : 'walk_v';
      }
      st.anim = anim;
      st.phaseWalk += dt * 7 * (moving ? 1 : 0);
      st.bounceIdle = Math.sin(st.t * 3) * 0.8;
      st.mouthOpen = anim === 'talk' ? 0.4 + 0.2 * Math.sin(st.t * 6) : 0.12;
      st.talkT = anim === 'talk' ? (st.talkT + dt) : Math.max(0, st.talkT - dt);
    },
    draw(ctx, cam, e, st) {
      if (!ctx || !e || e._culled) return;
      const { x, y, cam: camera } = baseCoords(ctx, e, cam);
      const zoom = (camera.zoom || 1) * (e.puppet?.scale || e.rig?.scale || 1);
      ctx.save();
      ctx.translate(x, y + (st?.bounceIdle || 0));
      ctx.scale(zoom, zoom);
      if (st?.flipX) ctx.scale(-1, 1);
      if (st?.anim?.startsWith('death_damage')) ctx.rotate(0.6);
      if (st?.anim?.startsWith('death_crush')) ctx.scale(1.1, 0.45);

      const walkSwing = Math.sin(st?.phaseWalk || 0);
      const attackKick = st?.anim === 'attack' ? 1.5 : 0;
      const darken = st?.anim === 'death_fire';
      const baseColor = darken ? '#b3b3b3' : '#ffffff';

      // Piernas (zuecos rojos)
      ctx.save();
      ctx.translate(0, 10);
      ctx.fillStyle = '#f44336';
      ctx.beginPath();
      ctx.ellipse(-5 + walkSwing * 1.5, 2, 4, 5, 0, 0, Math.PI * 2);
      ctx.ellipse(5 - walkSwing * 1.5, 2, 4, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Bata / cuerpo
      ctx.save();
      ctx.translate(0, 2 - (st?.anim === 'attack' ? 1.5 : 0));
      ctx.scale(1 + attackKick * 0.02, 1);
      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.ellipse(0, 2, 10, 10, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = darken ? '#9e9e9e' : '#ffd1dc';
      ctx.beginPath();
      ctx.ellipse(0, -2, 8, 6, 0, 0, TAU);
      ctx.fill();
      ctx.restore();

      // Brazos
      ctx.save();
      ctx.strokeStyle = darken ? '#777' : '#ffb3c1';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-8, -2 + walkSwing * 1.2);
      ctx.lineTo(-12, 2 + walkSwing * 1.2);
      ctx.moveTo(8, -2 - walkSwing * 1.2);
      ctx.lineTo(12 + attackKick * 1.5, -6 - attackKick * 0.5);
      ctx.stroke();
      ctx.restore();

      // Cabeza
      ctx.save();
      ctx.translate(0, -10);
      ctx.fillStyle = darken ? '#b0a79f' : '#ffdec2';
      ctx.beginPath();
      ctx.ellipse(0, 0, 11, 10, 0, 0, TAU);
      ctx.fill();

      // Pelo
      ctx.fillStyle = darken ? '#6d5f54' : '#6b4b33';
      ctx.beginPath();
      ctx.ellipse(-6, 4, 9, 10, 0.5, 0, TAU);
      ctx.fill();

      // Ojos
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(-4, -2, 3.5, 4, 0, 0, TAU);
      ctx.ellipse(4, -2, 3.5, 4, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#3c2f2f';
      ctx.beginPath();
      ctx.ellipse(-4 + walkSwing * 0.4, -2, 1.5, 2.2, 0, 0, TAU);
      ctx.ellipse(4 + walkSwing * -0.4, -2, 1.5, 2.2, 0, 0, TAU);
      ctx.fill();

      // Boca
      ctx.strokeStyle = '#a23c3c';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const mouth = st?.mouthOpen || 0.12;
      ctx.arc(0, 3, 2 + mouth * 3, 0, Math.PI, false);
      ctx.stroke();
      ctx.restore();

      // Gorro con cruz roja
      ctx.save();
      ctx.translate(0, -20);
      ctx.fillStyle = darken ? '#8a8a8a' : '#ffffff';
      ctx.beginPath();
      ctx.roundRect(-8, -4, 16, 8, 3);
      ctx.fill();
      ctx.fillStyle = '#e53935';
      ctx.fillRect(-2, -3, 4, 6);
      ctx.fillRect(-5, -1, 10, 2);
      ctx.restore();

      // Humo muerte fuego
      if (st?.anim === 'death_fire') {
        ctx.save();
        ctx.translate(0, -26);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#5d5d5d';
        ctx.beginPath();
        ctx.moveTo(-2, 0); ctx.lineTo(0, -6); ctx.lineTo(2, 0);
        ctx.fill();
        ctx.restore();
      }

      ctx.restore();
    }
  });

  // Rig simple para jeringa disparada por enfermera sexy
  PuppetAPI.registerRig('proj_nurse_syringe', {
    create() { return { t: 0 }; },
    update(st, e, dt = 0) { st.t += dt; },
    draw(ctx, cam, e, st) {
      if (!ctx || !e || e._culled) return;
      const { x, y, cam: camera } = baseCoords(ctx, e, cam);
      const zoom = (camera.zoom || 1) * (e.puppet?.scale || 1);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(zoom, zoom);
      ctx.rotate(e.dir || 0);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#e53935';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(-5, -2, 10, 4, 1.5);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(5, 0); ctx.lineTo(9, 0); ctx.lineTo(7, -2); ctx.closePath();
      ctx.fillStyle = '#c62828';
      ctx.fill();
      ctx.restore();
    }
  });
  // Comentario: se registran rigs chibi del jefe de servicio y su yogur bomba.

// Añadido rig chibi del jefe de servicio y proyectil de yogur.

  // Rig chibi para la supervisora (caricaturesca, 1 tile aprox)
  PuppetAPI.registerRig('npc_supervisora', {
    create(host) {
      return { t: 0, walkPhase: 0, bob: 0, mouthPhase: 0, visualState: 'idle' };
    },
    update(st, e, dt = 0) {
      if (!st || !e || e._culled) return;
      st.t += dt;
      let visualState = 'idle';
      if (e.dead) visualState = `death_${e.deathCause || 'damage'}`;
      else {
        const movingH = Math.abs(e.vx || 0) > Math.abs(e.vy || 0) && Math.abs(e.vx || 0) > 1;
        const movingV = Math.abs(e.vy || 0) >= Math.abs(e.vx || 0) && Math.abs(e.vy || 0) > 1;
        if (e.state === 'attack') visualState = 'attack';
        else if (e.state === 'eat') visualState = 'eat';
        else if (e.state === 'talk') visualState = movingH || movingV ? (movingH ? 'walk_h' : 'walk_v') : 'talk';
        else if (movingH) visualState = 'walk_h';
        else if (movingV) visualState = 'walk_v';
      }
      st.visualState = visualState;
      st.walkPhase += dt * ((visualState === 'walk_h' || visualState === 'walk_v') ? 10 : 4);
      st.bob = Math.sin(st.walkPhase) * (visualState.startsWith('walk') ? 2 : 1);
      st.mouthPhase += dt * (e.state === 'talk' ? 12 : 4);
    },
    draw(ctx, cam, e, st) {
      if (!ctx || !st || !e || e._culled) return;
      const toScreen = (camera, host) => {
        const camUse = camera || { x: 0, y: 0, zoom: 1 };
        const canvas = ctx.canvas || { width: 0, height: 0 };
        return {
          x: (host.x - camUse.x) * camUse.zoom + canvas.width * 0.5,
          y: (host.y - camUse.y) * camUse.zoom + canvas.height * 0.5,
          zoom: camUse.zoom || 1,
        };
      };
      const screen = toScreen(cam, e);
      const size = 24 * screen.zoom;
      const half = size / 2;
      const bobY = (st.bob || 0) * screen.zoom;
      ctx.save();
      ctx.translate(screen.x, screen.y + bobY);

      // sombra
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.ellipse(0, half * 0.7, half * 0.8, half * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.globalAlpha = 1;

      // cuerpo bata
      ctx.fillStyle = '#f5f5ff';
      ctx.beginPath();
      ctx.roundRect(-half * 0.6, -half * 0.3, half * 1.2, half * 1.1, half * 0.3);
      ctx.fill();

      // cabeza
      ctx.fillStyle = '#ffd9a3';
      ctx.beginPath();
      ctx.roundRect(-half * 0.7, -half * 1.2, half * 1.4, half * 1.0, half * 0.6);
      ctx.fill();

      // pelo
      ctx.fillStyle = '#f5c84d';
      ctx.beginPath();
      ctx.roundRect(-half * 0.8, -half * 1.3, half * 1.6, half * 0.7, half * 0.5);
      ctx.fill();

      // ojos
      ctx.fillStyle = '#3b2a2a';
      const eyeOffsetX = half * 0.25;
      const eyeOffsetY = -half * 0.9;
      ctx.beginPath();
      ctx.arc(-eyeOffsetX, eyeOffsetY, half * 0.12, 0, Math.PI * 2);
      ctx.arc(eyeOffsetX, eyeOffsetY, half * 0.12, 0, Math.PI * 2);
      ctx.fill();

      // boca
      const mouthOpen = (e.state === 'talk') ? (0.1 + 0.05 * Math.sin(st.mouthPhase || 0)) : 0.05;
      ctx.fillStyle = '#b55555';
      ctx.beginPath();
      ctx.ellipse(0, -half * 0.6, half * 0.25, half * mouthOpen, 0, 0, Math.PI * 2);
      ctx.fill();

      // brazos
      ctx.lineWidth = 2 * screen.zoom;
      ctx.strokeStyle = '#ffd9a3';
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (st.visualState === 'attack') {
        ctx.moveTo(half * 0.3, -half * 0.2);
        ctx.lineTo(half * 0.9, -half * 0.4);
        ctx.moveTo(-half * 0.3, -half * 0.2);
        ctx.lineTo(-half * 0.7, -half * 0.1);
      } else {
        ctx.moveTo(half * 0.4, -half * 0.1);
        ctx.lineTo(half * 0.2, half * 0.3);
        ctx.moveTo(-half * 0.4, -half * 0.1);
        ctx.lineTo(-half * 0.2, half * 0.3);
      }
      ctx.stroke();

      // piernas
      ctx.strokeStyle = '#f5f5ff';
      ctx.beginPath();
      const legStep = Math.sin(st.walkPhase || 0) * (st.visualState?.startsWith('walk') ? half * 0.2 : 0);
      ctx.moveTo(-half * 0.2, half * 0.4);
      ctx.lineTo(-half * 0.2 + legStep, half * 0.9);
      ctx.moveTo(half * 0.2, half * 0.4);
      ctx.lineTo(half * 0.2 - legStep, half * 0.9);
      ctx.stroke();

      // zapatos
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.roundRect(-half * 0.45, half * 0.8, half * 0.4, half * 0.25, half * 0.1);
      ctx.roundRect(half * 0.05, half * 0.8, half * 0.4, half * 0.25, half * 0.1);
      ctx.fill();

      // overlay muerte
      if (st.visualState && st.visualState.startsWith('death_')) {
        ctx.globalAlpha = 0.5;
        if (st.visualState === 'death_fire') ctx.fillStyle = 'rgba(255,80,0,0.6)';
        else if (st.visualState === 'death_crush') { ctx.fillStyle = 'rgba(200,200,200,0.7)'; ctx.scale(1.1, 0.3); }
        else ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.roundRect(-half, -half * 1.4, half * 2, half * 2.4, half * 0.4);
        ctx.fill();
      }
      ctx.restore();
    }
  });

  // Rig simple para avión de papel
  PuppetAPI.registerRig('hazard_paper_plane', {
    create(host) { return { t: 0 }; },
    update(st, host, dt = 0) { if (!st || !host || host._culled) return; st.t += dt; },
    draw(ctx, cam, host, st) {
      if (!ctx || !host || host._culled) return;
      const camUse = cam || { x: 0, y: 0, zoom: 1 };
      const canvas = ctx.canvas || { width: 0, height: 0 };
      const x = (host.x - camUse.x) * camUse.zoom + canvas.width * 0.5;
      const y = (host.y - camUse.y) * camUse.zoom + canvas.height * 0.5;
      const size = 14 * (camUse.zoom || 1);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(host.dir || Math.sin(st.t * 2) * 0.05);
      ctx.beginPath();
      ctx.moveTo(-size * 0.4, size * 0.2);
      ctx.lineTo(size * 0.6, 0);
      ctx.lineTo(-size * 0.4, -size * 0.2);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#7fb3ff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  });

  // Rig plano para la nota en el suelo
  PuppetAPI.registerRig('hazard_paper_note', {
    create(host) { return { t: 0 }; },
    update(st, host, dt = 0) { if (!st || !host || host._culled) return; st.t += dt; },
    draw(ctx, cam, host, st) {
      if (!ctx || !host || host._culled) return;
      const camUse = cam || { x: 0, y: 0, zoom: 1 };
      const canvas = ctx.canvas || { width: 0, height: 0 };
      const x = (host.x - camUse.x) * camUse.zoom + canvas.width * 0.5;
      const y = (host.y - camUse.y) * camUse.zoom + canvas.height * 0.5;
      const size = 12 * (camUse.zoom || 1);
      ctx.save();
      ctx.translate(x, y + Math.sin(st.t * 2) * 1.5);
      ctx.rotate(Math.sin(st.t * 1.5) * 0.1);
      ctx.fillStyle = '#f7f3e9';
      ctx.strokeStyle = '#c1b8a1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-size * 0.5, -size * 0.3, size, size * 0.6, 3);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  });

  // Rig 'npc_medica': chibi doctor hostile, animaciones completas.
  PuppetAPI.registerRig('npc_medica', {
    create(e) {
      return { t: 0, walkPhase: 0, talkPhase: 0, squash: 0, flicker: 0 };
    },
    update(st, e, dt) {
      if (e?._culled) return;
      st.t += dt;
      if (e.dead) {
        st.squash = Math.min(1, st.squash + dt * 3);
        return;
      }
      const moving = Math.abs(e.vx) + Math.abs(e.vy) > 1;
      if (moving) {
        st.walkPhase += dt * 8;
      } else {
        st.walkPhase = 0;
      }
      if (e.state === 'talk') {
        st.talkPhase += dt * 10;
      } else {
        st.talkPhase = 0;
      }
      st.squash = 0.05 * Math.sin(st.t * 2);
    },
    draw(ctx, cam, e, st) {
      if (!ctx || !cam || !e || e._culled) return;
      const { x, y } = toScreen(cam, e);
      const z = cam.zoom || 1;
      ctx.save();
      ctx.translate(x, y);
      const baseScale = 0.75 * z;
      const scaleY = baseScale * (1 - st.squash);
      const scaleX = baseScale * (1 + st.squash * 0.5);
      ctx.scale(scaleX, scaleY);
      const bodyW = 18;
      const bodyH = 18;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.ellipse(0, bodyH * 0.6, bodyW * 0.8, 4, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.globalAlpha = 1;
      const legOffset = Math.sin(st.walkPhase) * 2;
      ctx.fillStyle = '#f2a66a';
      ctx.beginPath();
      ctx.roundRect(-7 + legOffset, 6, 6, 10, 3);
      ctx.roundRect(1 - legOffset, 6, 6, 10, 3);
      ctx.fill();
      ctx.fillStyle = '#ff4f9a';
      ctx.beginPath();
      ctx.roundRect(-8 + legOffset, 14, 8, 4, 2);
      ctx.roundRect(0 - legOffset, 14, 8, 4, 2);
      ctx.fill();
      ctx.fillStyle = '#f9f9ff';
      ctx.beginPath();
      ctx.roundRect(-9, -4, 18, 14, 6);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = '#f6b27c';
      ctx.arc(0, -9, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#7a4b2d';
      ctx.beginPath();
      ctx.arc(-2, -11, 11, Math.PI * 0.1, Math.PI * 1.1);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(8, -5, 6, 8, Math.PI / 6, 0, Math.PI * 2);
      ctx.fill();
      const eyeBlink = (Math.sin(st.t * 4) > 0.9) ? 0.2 : 1;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(-4, -9, 3, 3 * eyeBlink, 0, 0, Math.PI * 2);
      ctx.ellipse(4, -9, 3, 3 * eyeBlink, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2b1b17';
      ctx.beginPath();
      ctx.arc(-4, -9, 1.5, 0, Math.PI * 2);
      ctx.arc(4, -9, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c45a3b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (e.state === 'talk' || e.state === 'attack') {
        const open = 1 + 1.5 * Math.abs(Math.sin(st.talkPhase));
        ctx.arc(0, -4, open, 0, Math.PI);
      } else {
        ctx.arc(0, -5, 2.5, 0, Math.PI);
      }
      ctx.stroke();
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-4, -2);
      ctx.lineTo(-6, 2);
      ctx.moveTo(4, -2);
      ctx.lineTo(6, 2);
      ctx.stroke();
      ctx.fillStyle = '#ff5aa5';
      ctx.beginPath();
      ctx.arc(0, 1, 2.2, 0, Math.PI * 2);
      ctx.fill();
      if (e.dead) {
        if (e.deathCause === 'crush') {
          ctx.restore();
          ctx.save();
          ctx.translate(x, y + 6 * z);
          ctx.scale(z, z * 0.3);
          ctx.fillStyle = '#f6b27c';
          ctx.beginPath();
          ctx.roundRect(-10, -4, 20, 8, 4);
          ctx.fill();
        } else if (e.deathCause === 'fire') {
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = '#333';
          ctx.beginPath();
          ctx.arc(0, -6, 8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    },
  });
  // Comentario: rigs actualizados para jefe de servicio y proyectil.

  // Rig chibi para "visitante molesto" (estética chibi 24x24 px aprox.)
  PuppetAPI.registerRig('npc_visitor_annoying', {
    create(host) {
      return { rigName: 'npc_visitor_annoying', host, walkT: 0, idleT: 0, gumT: 0, gumScale: 0.6, anim: 'idle', deathT: 0 };
    },
    update(state, host, dt = 0) {
      if (!state || !host) return;
      state.walkT += dt;
      state.idleT += dt;
      state.gumT += dt;
      state.gumScale = 0.55 + Math.max(0, Math.sin(state.gumT * 2.4)) * 0.22;
      let anim = 'idle';
      if (host.dead) {
        anim = `death_${host.deathCause || 'damage'}`;
        state.deathT += dt;
      } else if (host.state === 'talk') {
        anim = 'talk';
      } else if (host.state === 'attack') {
        anim = 'attack';
      } else if (host.state === 'eat') {
        anim = 'eat';
      } else {
        const mvx = Math.abs(host.vx || 0);
        const mvy = Math.abs(host.vy || 0);
        if (mvx > mvy && (mvx > 1 || host.state === 'walk_h')) anim = 'walk_h';
        else if (mvy >= mvx && (mvy > 1 || host.state === 'walk_v')) anim = 'walk_v';
      }
      state.anim = anim;
    },
    draw(ctx, camera, host, state) {
      if (!ctx || !host || host._culled) return;
      const { x, y, cam } = baseCoords(ctx, host, camera);
      const zoom = (cam.zoom || 1) * (host.puppet?.scale || host.rig?.scale || 1);
      const flip = (host.vx || host.dir || 0) < 0 ? -1 : 1;
      const bob = state.anim === 'idle' ? Math.sin(state.idleT * 2) * 1 : 0;
      const sway = Math.sin(state.walkT * 8) * (state.anim.startsWith('walk') ? 2 : 0);

      ctx.save();
      ctx.translate(x, y + bob);
      if (state.anim === 'death_crush') ctx.scale(1.05, 0.35);
      ctx.scale(zoom * flip, zoom);

      // Sombra
      ctx.save();
      ctx.translate(0, 12);
      drawEllipse(ctx, 8, 3.5, 'rgba(0,0,0,0.25)');
      ctx.restore();

      // Piernas y tacones
      ctx.save();
      ctx.translate(0, 6 + sway * 0.15);
      const step = Math.sin(state.walkT * 10) * (state.anim.startsWith('walk') ? 3 : 0);
      ctx.fillStyle = '#1c1c1c';
      ctx.beginPath();
      ctx.roundRect(-6 + step, -2, 6, 10, 3);
      ctx.roundRect(0 - step, -2, 6, 10, 3);
      ctx.fill();
      ctx.fillStyle = '#e53935';
      ctx.beginPath();
      ctx.roundRect(-6 + step, 6, 6, 3, 1.5);
      ctx.roundRect(0 - step, 6, 6, 3, 1.5);
      ctx.fill();
      ctx.restore();

      // Cuerpo y chaqueta
      ctx.save();
      const lean = state.anim === 'attack' ? -0.18 : state.anim === 'talk' ? -0.06 : -0.02;
      ctx.translate(0, -2 + sway * 0.1);
      ctx.rotate(lean);
      ctx.fillStyle = '#c62828';
      ctx.beginPath();
      ctx.roundRect(-8, -8, 16, 16, 5);
      ctx.fill();
      ctx.fillStyle = '#1e88e5';
      ctx.beginPath();
      ctx.roundRect(-6, -6, 12, 12, 4);
      ctx.fill();
      ctx.restore();

      // Brazos (izquierdo cruzado, derecho con móvil)
      ctx.save();
      ctx.translate(0, -2 + sway * 0.1);
      ctx.lineCap = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#f6c9a5';
      ctx.beginPath();
      ctx.moveTo(-6, -2);
      ctx.lineTo(-10, 2);
      ctx.moveTo(7, -3);
      ctx.lineTo(12 + (state.anim === 'attack' ? 4 : 0), -6);
      ctx.stroke();
      // Móvil
      ctx.save();
      ctx.translate(12 + (state.anim === 'attack' ? 4 : 0), -8);
      ctx.rotate(-0.15);
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.roundRect(-2, -4, 6, 10, 1.5);
      ctx.fill();
      ctx.restore();
      ctx.restore();

      // Cabeza y pelo
      ctx.save();
      ctx.translate(0, -14 + sway * 0.05 + (state.anim === 'talk' ? Math.sin(state.idleT * 6) : 0));
      ctx.fillStyle = '#6b3a1f';
      drawEllipse(ctx, 9, 8, '#6b3a1f');
      ctx.save();
      ctx.translate(0, -2);
      drawEllipse(ctx, 8, 7, '#7a4a2d');
      ctx.restore();
      // Gafas en la frente
      ctx.save();
      ctx.translate(-2, -7);
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath();
      ctx.roundRect(-5, -2, 6, 4, 1.5);
      ctx.roundRect(2, -2, 6, 4, 1.5);
      ctx.fill();
      ctx.strokeStyle = '#4a4a4a';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-5, 0); ctx.lineTo(8, 0);
      ctx.stroke();
      ctx.restore();
      // Pendiente
      ctx.fillStyle = '#f9c22c';
      ctx.beginPath();
      ctx.arc(8, 0, 1.2, 0, TAU);
      ctx.fill();
      // Cara
      ctx.fillStyle = '#f7c9a8';
      drawEllipse(ctx, 8, 7.5, '#f7c9a8');
      ctx.fillStyle = '#2c2c2c';
      ctx.beginPath();
      ctx.arc(-2.5, -1.5, 1.1, 0, TAU);
      ctx.arc(2.5, -1.5, 1.1, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#5a3b2a';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(-4, -4); ctx.lineTo(-1, -5.5);
      ctx.moveTo(1, -5.5); ctx.lineTo(4, -4.5);
      ctx.stroke();
      // Boca / chicle
      ctx.save();
      ctx.translate(0, 3.5);
      ctx.strokeStyle = '#b23c17';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      if (state.anim === 'talk') {
        ctx.moveTo(-2, 0); ctx.lineTo(2, 0);
      } else {
        ctx.arc(0, 0, 2, 0, Math.PI);
      }
      ctx.stroke();
      ctx.fillStyle = '#ff7eb6';
      const gum = state.anim === 'attack' ? state.gumScale * 10 : state.gumScale * 8;
      drawEllipse(ctx, gum * 0.6, gum * 0.55, '#ff7eb6', state.anim === 'talk' ? 0.9 : 1);
      ctx.restore();
      ctx.restore();

      // Bandolera
      ctx.save();
      ctx.translate(0, -2 + sway * 0.1);
      ctx.strokeStyle = '#2b2b2b';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-6, -10); ctx.lineTo(6, 10);
      ctx.stroke();
      ctx.restore();

      // Muertes especiales
      if (host.dead) {
        if (host.deathCause === 'fire') {
          ctx.save();
          ctx.globalAlpha = 0.85;
          drawEllipse(ctx, 11, 7, '#2c2c2c');
          ctx.strokeStyle = '#ff9800';
          ctx.beginPath();
          ctx.moveTo(-4, -10); ctx.lineTo(-1, -4); ctx.lineTo(2, -9); ctx.lineTo(5, -3);
          ctx.stroke();
          ctx.restore();
        } else if (host.deathCause === 'crush') {
          ctx.save();
          ctx.globalAlpha = 0.8;
          ctx.scale(1.2, 0.45);
          drawEllipse(ctx, 12, 8, '#c0392b');
          ctx.restore();
        }
      }

      ctx.restore();
    },
  });

})();
