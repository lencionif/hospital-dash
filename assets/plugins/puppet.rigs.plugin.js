// puppet.rigs.plugin.js - Definición de rigs chibi para Hospital Dash
(() => {
  'use strict';

  const W = window;
  const PuppetAPI = W.PuppetAPI;
  if (!PuppetAPI?.registerRig) return;

  const TILE = W.TILE_SIZE || W.TILE || 32;
  const TWO_PI = Math.PI * 2;

  const defaultCam = { x: 0, y: 0, zoom: 1 };

  function worldToScreen(e, camera, ctx) {
    const cam = camera || defaultCam;
    const zoom = cam.zoom || 1;
    const cx = (e.x + e.w * 0.5 - cam.x) * zoom + ctx.canvas.width * 0.5;
    const cy = (e.y + e.h * 0.5 - cam.y) * zoom + ctx.canvas.height * 0.5;
    return { cx, cy, zoom };
  }

  function resolveAction(e, fallback = 'idle') {
    if (!e) return fallback;
    const dead = e.dead || e.state === 'dead';
    const cause = e.deathCause || 'damage';
    if (dead || (e.state && e.state.startsWith('death_'))) {
      return e.state && e.state.startsWith('death_') ? e.state : `death_${cause}`;
    }
    if (e.state) return e.state;
    if (e.isEating) return 'eat';
    if (e.isAttacking || e.attackAnimT > 0 || e.attacking) return 'attack';
    if (e.isPushing || e.pushing || e.pushAnimT > 0) return 'push';
    const speed = Math.hypot(e.vx || 0, e.vy || 0);
    const isAnimal = e.group === 'animal';
    if (speed > 5) {
      const hv = Math.abs(e.vx || 0) >= Math.abs(e.vy || 0);
      if (isAnimal) return hv ? 'move_h' : 'move_v';
      return hv ? 'walk_h' : 'walk_v';
    }
    return fallback;
  }

  function resolveFacing(e) {
    if (!e) return 'S';
    if (e.facing) return String(e.facing).toUpperCase();
    if (typeof e.lookAngle === 'number') return PuppetAPI.dirToFace(e.lookAngle);
    if (typeof e.facingAngle === 'number') return PuppetAPI.dirToFace(e.facingAngle);
    return 'S';
  }

  function drawEllipse(ctx, rx, ry) { ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TWO_PI); ctx.fill(); }
  function drawRoundedRect(ctx, w, h, r) {
    const hw = w * 0.5, hh = h * 0.5, rr = Math.min(r, hw, hh);
    ctx.beginPath();
    ctx.moveTo(-hw + rr, -hh);
    ctx.lineTo(hw - rr, -hh);
    ctx.quadraticCurveTo(hw, -hh, hw, -hh + rr);
    ctx.lineTo(hw, hh - rr);
    ctx.quadraticCurveTo(hw, hh, hw - rr, hh);
    ctx.lineTo(-hw + rr, hh);
    ctx.quadraticCurveTo(-hw, hh, -hw, hh - rr);
    ctx.lineTo(-hw, -hh + rr);
    ctx.quadraticCurveTo(-hw, -hh, -hw + rr, -hh);
    ctx.fill();
  }

  function drawFace(ctx, palette, action, t, scale) {
    const eye = 2 * scale;
    const blink = (Math.sin(t * 3) > 0.6) ? 0.4 : 1;
    ctx.fillStyle = '#1b1b1b';
    ctx.save();
    ctx.translate(-5 * scale, -2 * scale);
    drawEllipse(ctx, eye, eye * blink);
    ctx.restore();
    ctx.save();
    ctx.translate(5 * scale, -2 * scale);
    drawEllipse(ctx, eye, eye * blink);
    ctx.restore();
    ctx.fillStyle = palette.mouth || '#b14c3b';
    if (action === 'talk') {
      const open = 3.5 * scale * (0.6 + 0.4 * Math.abs(Math.sin(t * 8)));
      drawRoundedRect(ctx, open, open * 0.7, 2 * scale);
    } else if (action === 'eat' || action === 'attack') {
      drawRoundedRect(ctx, 6 * scale, 4 * scale, 2 * scale);
    } else {
      drawRoundedRect(ctx, 6 * scale, 2 * scale, 1 * scale);
    }
  }

  // ------------------------------------------------------------
  // Rig chibi bípede (heroes, NPC, pacientes furiosos)
  // ------------------------------------------------------------
  function registerHumanoidRig(id, palette, opts = {}) {
    PuppetAPI.registerRig(id, {
      // Rig chibi para NPC / héroe bípede
      create() { return { t: Math.random() * TWO_PI, action: 'idle', face: 'S' }; },
      update(state, e, dt) {
        state.t += dt || 0;
        state.face = resolveFacing(e);
        state.moving = Math.hypot(e?.vx || 0, e?.vy || 0) > 6;
        state.action = resolveAction(e, 'idle');
        state.deathCause = e?.deathCause || 'damage';
      },
      draw(ctx, camera, e, state, rig) {
        const { cx, cy, zoom } = worldToScreen(e, camera, ctx);
        const skinKey = e?.puppet?.data?.skin || e?.skin || opts.defaultSkin;
        const pal = (opts.skinMap && skinKey && opts.skinMap[skinKey]) ? opts.skinMap[skinKey] : palette;
        const scale = (rig?.scale || 1) * zoom;
        const bodyW = 16 * scale;
        const bodyH = 18 * scale;
        const headScale = pal.headScale || opts.headScale || 1.15;
        const headR = 9 * scale * headScale;
        const legR = 5 * scale;
        const action = state.action || 'idle';
        const t = state.t || 0;
        const bob = Math.sin(t * 4) * (action === 'idle' ? 1.5 : 2.5) * scale;
        const walkPhase = t * 10;
        const step = Math.sin(walkPhase) * (action.startsWith('walk') ? 4 * scale : 0);
        const pushLean = action === 'push' ? 4 * scale : 0;
        const attackStretch = action === 'attack' ? 1.15 : 1;
        const dead = action.startsWith('death');

        ctx.save();
        ctx.translate(cx, cy + bob);
        ctx.scale(state.face === 'W' ? -1 : 1, 1);

        // sombra
        ctx.save();
        ctx.globalAlpha = dead ? 0.1 : 0.25;
        ctx.fillStyle = 'black';
        ctx.scale(1, 0.35);
        drawEllipse(ctx, 14 * scale, 8 * scale);
        ctx.restore();

        if (dead) {
          const flat = action.includes('crush');
          ctx.save();
          ctx.translate(0, flat ? 6 * scale : 0);
          ctx.rotate(flat ? 0 : 0.25);
          ctx.fillStyle = palette.fire || palette.body;
          ctx.globalAlpha = action.includes('fire') ? 0.6 : 0.9;
          drawRoundedRect(ctx, bodyW * 1.2, bodyH * 0.6, 6 * scale);
          ctx.restore();
          ctx.save();
          ctx.translate(0, -6 * scale);
          ctx.fillStyle = palette.head;
          ctx.globalAlpha = action.includes('fire') ? 0.6 : 0.9;
          drawEllipse(ctx, headR * 1.1, headR * (flat ? 0.5 : 0.8));
          ctx.restore();
          ctx.restore();
          return;
        }

        // piernas
        ctx.fillStyle = pal.legs;
        ctx.save();
        ctx.translate(-6 * scale, legR + step * 0.5);
        drawEllipse(ctx, legR, legR);
        ctx.restore();
        ctx.save();
        ctx.translate(6 * scale, legR - step * 0.5);
        drawEllipse(ctx, legR, legR);
        ctx.restore();

        // cuerpo
        ctx.save();
        ctx.translate(0, -2 * scale + pushLean * 0.5);
        ctx.fillStyle = pal.body;
        drawRoundedRect(ctx, bodyW, bodyH, 6 * scale);
        ctx.restore();

        // brazos
        ctx.fillStyle = pal.arms;
        const armSwing = Math.sin(walkPhase) * (action === 'attack' ? 6 : 3) * scale;
        ctx.save();
        ctx.translate(-(bodyW * 0.35 + pushLean), -4 * scale);
        ctx.rotate((action === 'push' ? -0.2 : 0) + (action.startsWith('walk') ? -armSwing * 0.05 : 0));
        drawRoundedRect(ctx, 5 * scale, 12 * scale * attackStretch, 3 * scale);
        ctx.restore();
        ctx.save();
        ctx.translate(bodyW * 0.35 + pushLean, -4 * scale);
        ctx.rotate((action === 'push' ? 0.2 : 0) + (action.startsWith('walk') ? armSwing * 0.05 : 0));
        drawRoundedRect(ctx, 5 * scale, 12 * scale * attackStretch, 3 * scale);
        ctx.restore();

        // cabeza
        ctx.save();
        ctx.translate(0, -bodyH * 0.6 - pushLean * 0.2);
        ctx.fillStyle = pal.head;
        drawEllipse(ctx, headR * 1.05, headR);
        drawFace(ctx, pal, action, t, scale);
        ctx.restore();

        if (action === 'eat') {
          ctx.save();
          ctx.translate(0, -headR * 0.2);
          ctx.fillStyle = pal.mouth || '#b14c3b';
          drawRoundedRect(ctx, 8 * scale, 5 * scale, 2 * scale);
          ctx.restore();
        }

        if (action.includes('fire')) {
          ctx.save();
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = pal.fire || '#ff944d';
          drawEllipse(ctx, headR * 1.4, bodyH);
          ctx.restore();
        }

        ctx.restore();
      }
    });
  }

  // ------------------------------------------------------------
  // Rig paciente en cama / cama boss
  // ------------------------------------------------------------
  function registerBedRig(id, palette) {
    PuppetAPI.registerRig(id, {
      // Rig chibi paciente en cama
      create() { return { t: Math.random() * TWO_PI, action: 'idle' }; },
      update(state, e, dt) {
        state.t += dt || 0;
        state.action = resolveAction(e, 'idle');
        state.deathCause = e?.deathCause || 'damage';
      },
      draw(ctx, camera, e, state, rig) {
        const { cx, cy, zoom } = worldToScreen(e, camera, ctx);
        const scale = (rig?.scale || 1) * zoom;
        const bedW = 28 * scale;
        const bedH = 16 * scale;
        const headR = 8 * scale;
        const action = state.action || 'idle';
        const t = state.t || 0;
        const bob = Math.sin(t * 2) * (action === 'idle' ? 1.5 : 0) * scale;

        ctx.save();
        ctx.translate(cx, cy + bob);

        // cama base
        ctx.fillStyle = palette.frame;
        drawRoundedRect(ctx, bedW, bedH, 4 * scale);
        ctx.fillStyle = palette.sheet;
        drawRoundedRect(ctx, bedW * 0.9, bedH * 0.75, 4 * scale);

        // paciente
        if (action.startsWith('death')) {
          const flat = action.includes('crush');
          ctx.save();
          ctx.globalAlpha = action.includes('fire') ? 0.6 : 0.9;
          ctx.translate(0, flat ? 4 * scale : 0);
          ctx.fillStyle = action.includes('fire') ? palette.fire : palette.body;
          drawRoundedRect(ctx, bedW * 0.7, headR * (flat ? 0.8 : 1.1), 4 * scale);
          ctx.restore();
        } else {
          ctx.save();
          ctx.translate(0, -bedH * 0.15);
          ctx.fillStyle = palette.body;
          drawRoundedRect(ctx, bedW * 0.6, headR * 1.1, 4 * scale);
          ctx.restore();
          ctx.save();
          ctx.translate(0, -bedH * 0.35);
          ctx.fillStyle = palette.head;
          drawEllipse(ctx, headR, headR * 0.95);
          drawFace(ctx, palette, action, t, scale);
          ctx.restore();
        }

        if (action.includes('fire')) {
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = palette.fire;
          drawEllipse(ctx, bedW * 0.5, bedH * 0.9);
          ctx.restore();
        }

        ctx.restore();
      }
    });
  }

  // ------------------------------------------------------------
  // Rig jefe limpiadoras desmayada (en suelo)
  // ------------------------------------------------------------
  PuppetAPI.registerRig('boss_cleaner', {
    // Rig chibi para boss nivel 2 en el suelo
    create() { return { t: Math.random() * TWO_PI, action: 'idle' }; },
    update(state, e, dt) {
      state.t += dt || 0;
      state.action = e?.state || (e?.dead ? `death_${e?.deathCause || 'damage'}` : 'idle');
    },
    draw(ctx, camera, e, state, rig) {
      const { cx, cy, zoom } = worldToScreen(e, camera, ctx);
      const scale = (rig?.scale || 1) * zoom;
      const action = state.action || 'idle';
      const t = state.t || 0;
      const baseW = 26 * scale;
      const baseH = 12 * scale;

      ctx.save();
      ctx.translate(cx, cy + Math.sin(t * 2) * scale * 0.8);
      ctx.save();
      ctx.globalAlpha = action.includes('fire') ? 0.6 : 0.9;
      ctx.fillStyle = '#cfc7ff';
      drawRoundedRect(ctx, baseW, baseH, 6 * scale);
      ctx.restore();

      ctx.save();
      ctx.translate(0, -2 * scale);
      ctx.fillStyle = '#f5c89b';
      drawEllipse(ctx, 10 * scale, action.includes('crush') ? 5 * scale : 8 * scale);
      ctx.restore();

      if (action === 'cured') {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#c2ffd5';
        drawEllipse(ctx, 18 * scale, 12 * scale);
        ctx.restore();
      }
      if (action.includes('fire')) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#ff9d57';
        drawEllipse(ctx, 18 * scale, 10 * scale);
        ctx.restore();
      }
      ctx.restore();
    }
  });

  // ------------------------------------------------------------
  // Rig boss piromana (en cama/foco)
  // ------------------------------------------------------------
  PuppetAPI.registerRig('boss_pyro', {
    // Rig chibi para boss piromana
    create() { return { t: Math.random() * TWO_PI, action: 'idle' }; },
    update(state, e, dt) {
      state.t += dt || 0;
      state.action = resolveAction(e, 'idle');
    },
    draw(ctx, camera, e, state, rig) {
      const { cx, cy, zoom } = worldToScreen(e, camera, ctx);
      const scale = (rig?.scale || 1) * zoom;
      const action = state.action || 'idle';
      const headR = 9 * scale;
      const bodyW = 18 * scale;
      const bodyH = 14 * scale;
      const t = state.t || 0;

      ctx.save();
      ctx.translate(cx, cy + Math.sin(t * 3) * (action === 'attack' ? 2 * scale : 1 * scale));

      ctx.fillStyle = '#2b1e1e';
      drawRoundedRect(ctx, bodyW * 1.4, bodyH * 1.2, 6 * scale);
      ctx.fillStyle = '#ffefe3';
      drawRoundedRect(ctx, bodyW, bodyH, 6 * scale);

      ctx.save();
      ctx.translate(0, -bodyH * 0.6);
      ctx.fillStyle = '#f5c89b';
      drawEllipse(ctx, headR, headR);
      drawFace(ctx, { mouth: '#7f1d1d' }, action, t, scale);
      ctx.restore();

      if (action === 'attack') {
        ctx.save();
        ctx.fillStyle = '#ff9d57';
        ctx.globalAlpha = 0.45;
        drawEllipse(ctx, bodyW, bodyH * 0.8);
        ctx.restore();
      }
      if (action.includes('fire')) {
        ctx.save();
        ctx.fillStyle = '#ff6b3a';
        ctx.globalAlpha = 0.6;
        drawEllipse(ctx, bodyW * 1.2, bodyH * 1.4);
        ctx.restore();
      }

      ctx.restore();
    }
  });

  // ------------------------------------------------------------
  // Rig mosquitos
  // ------------------------------------------------------------
  PuppetAPI.registerRig('enemy_mosquito', {
    // Rig chibi mosquito volador
    create() { return { t: Math.random() * TWO_PI, action: 'idle' }; },
    update(state, e, dt) {
      state.t += dt || 0;
      state.action = resolveAction(e, 'idle');
    },
    draw(ctx, camera, e, state, rig) {
      const { cx, cy, zoom } = worldToScreen(e, camera, ctx);
      const scale = (rig?.scale || 1) * zoom;
      const action = state.action || 'idle';
      const t = state.t || 0;
      const bob = Math.sin(t * 10) * 2 * scale;

      ctx.save();
      ctx.translate(cx, cy + bob);
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#d8f3ff';
      ctx.rotate(Math.sin(t * 12) * 0.1);
      drawEllipse(ctx, 10 * scale, 4 * scale);
      ctx.restore();

      ctx.fillStyle = '#5c4a7d';
      drawRoundedRect(ctx, 14 * scale, 8 * scale, 4 * scale);

      ctx.save();
      ctx.translate(6 * scale, 0);
      ctx.fillStyle = '#f5c89b';
      drawEllipse(ctx, 5 * scale, 5 * scale);
      ctx.restore();

      ctx.save();
      ctx.translate(6 * scale, 0);
      drawFace(ctx, { mouth: '#5c4a7d' }, action, t, scale);
      ctx.restore();

      if (action === 'attack' || action === 'eat') {
        ctx.save();
        ctx.fillStyle = '#b33a3a';
        drawRoundedRect(ctx, 8 * scale, 2 * scale, 1 * scale);
        ctx.restore();
      }

      if (action.includes('fire')) {
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#ff9d57';
        drawEllipse(ctx, 14 * scale, 10 * scale);
        ctx.restore();
      }

      ctx.restore();
    }
  });

  // ------------------------------------------------------------
  // Rig ratas
  // ------------------------------------------------------------
  PuppetAPI.registerRig('enemy_rat', {
    // Rig chibi rata correteando
    create() { return { t: Math.random() * TWO_PI, action: 'idle' }; },
    update(state, e, dt) {
      state.t += dt || 0;
      state.action = resolveAction(e, 'idle');
    },
    draw(ctx, camera, e, state, rig) {
      const { cx, cy, zoom } = worldToScreen(e, camera, ctx);
      const scale = (rig?.scale || 1) * zoom;
      const action = state.action || 'idle';
      const t = state.t || 0;
      const bob = Math.sin(t * 6) * (action.startsWith('move') ? 1.5 : 0.8) * scale;

      ctx.save();
      ctx.translate(cx, cy + bob);

      ctx.fillStyle = '#b07b4f';
      drawRoundedRect(ctx, 16 * scale, 10 * scale, 6 * scale);
      ctx.save();
      ctx.translate(-10 * scale, -2 * scale);
      ctx.fillStyle = '#f5c89b';
      drawEllipse(ctx, 5 * scale, 4 * scale);
      drawFace(ctx, { mouth: '#6b3b24' }, action, t, scale);
      ctx.restore();

      ctx.save();
      ctx.translate(10 * scale, 0);
      ctx.strokeStyle = '#d06a4b';
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(6 * scale, 2 * scale, 10 * scale, 0);
      ctx.stroke();
      ctx.restore();

      if (action === 'attack' || action === 'eat') {
        ctx.save();
        ctx.translate(-8 * scale, 2 * scale);
        ctx.fillStyle = '#6b3b24';
        drawRoundedRect(ctx, 6 * scale, 3 * scale, 1.5 * scale);
        ctx.restore();
      }

      if (action.includes('fire')) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#ff9d57';
        drawEllipse(ctx, 16 * scale, 10 * scale);
        ctx.restore();
      }

      ctx.restore();
    }
  });

  // ------------------------------------------------------------
  // Colores / skins para humanos
  // ------------------------------------------------------------
  const HERO_PALETTES = {
    hero_francesco: { body: '#a6c8ff', arms: '#f5c89b', head: '#f5c89b', legs: '#6c8ccf', fire: '#ff9d57' },
    hero_roberto: { body: '#ffd28f', arms: '#f5c89b', head: '#f5c89b', legs: '#e3a24f', fire: '#ff9d57' },
    hero_enrique: { body: '#c9ffd1', arms: '#f5c89b', head: '#f5c89b', legs: '#89c99b', fire: '#ff9d57' },
  };

  const FEMALE_SKINS = {
    nurse: { body: '#f0f8ff', arms: '#f5c89b', head: '#f5c89b', legs: '#d6e7ff', fire: '#ff9d57' },
    tcae: { body: '#e6f7ff', arms: '#f5c89b', head: '#f5c89b', legs: '#c7e1ff', fire: '#ff9d57' },
    cleaner: { body: '#d8f0c8', arms: '#f5c89b', head: '#f5c89b', legs: '#9ac088', fire: '#ff9d57' },
    doctor: { body: '#fff4e5', arms: '#f5c89b', head: '#f5c89b', legs: '#d9c2a1', fire: '#ff9d57' },
    supervisor: { body: '#ffe4f2', arms: '#f5c89b', head: '#f5c89b', legs: '#d7a3c4', fire: '#ff9d57' },
    visitor: { body: '#ffd8c2', arms: '#f5c89b', head: '#f5c89b', legs: '#d39671', fire: '#ff9d57' },
  };
  const MALE_SKINS = {
    guard: { body: '#1f2a44', arms: '#f0c99b', head: '#f0c99b', legs: '#121a29', fire: '#ff9d57', headScale: 1.05 },
    chief: { body: '#dce6ff', arms: '#f0c99b', head: '#f0c99b', legs: '#9fb3e6', fire: '#ff9d57' },
    orderly: { body: '#d7f7ff', arms: '#f0c99b', head: '#f0c99b', legs: '#9cc4cf', fire: '#ff9d57' },
  };

  const PATIENT_FURIOUS = { body: '#ffd9d9', arms: '#f5c89b', head: '#f5c89b', legs: '#d98a8a', fire: '#ff9d57' };

  // Registro de héroes
  registerHumanoidRig('hero_francesco', HERO_PALETTES.hero_francesco, { headScale: 1.1 });
  registerHumanoidRig('hero_roberto', HERO_PALETTES.hero_roberto, { headScale: 1.05 });
  registerHumanoidRig('hero_enrique', HERO_PALETTES.hero_enrique, { headScale: 1.1 });

  // NPC base
  registerHumanoidRig('npc_female_base', FEMALE_SKINS.nurse, { skinMap: FEMALE_SKINS, defaultSkin: 'nurse' });
  registerHumanoidRig('npc_male_base', MALE_SKINS.guard, { skinMap: MALE_SKINS, defaultSkin: 'guard' });

  // Paciente furioso
  registerHumanoidRig('patient_furious', PATIENT_FURIOUS);

  // Paciente hematológico y normal (en cama)
  registerBedRig('patient_bed', { frame: '#8a6f64', sheet: '#e7f7ff', head: '#f5c89b', body: '#f5c89b', fire: '#ff9d57' });
  registerBedRig('boss_hema', { frame: '#7c5f59', sheet: '#f7dde2', head: '#f5c89b', body: '#f0b4b4', fire: '#ff9d57' });

  // Nota: boss_cleaner y boss_pyro ya registrados arriba
})();
