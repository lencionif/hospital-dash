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
})();
