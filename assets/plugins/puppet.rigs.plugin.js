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
})();
