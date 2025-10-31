// assets/plugins/puppet.rigs.plugin.js
// Conjunto de rigs para PuppetAPI.
(function(global){
  'use strict';

  if (!global.PuppetAPI) {
    console.warn('[puppet.rigs] PuppetAPI no encontrado');
    return;
  }

  const imageCache = new Map();
  function loadImage(name){
    if (!name) return null;
    const key = name.toLowerCase();
    if (imageCache.has(key)) return imageCache.get(key);
    const img = new Image();
    img.src = IMG(name);
    imageCache.set(key, img);
    return img;
  }

  function lerp(a,b,t){ return a + (b-a)*t; }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  function entityScale(entity, spec, base = 32){
    if (!entity) return (spec?.scale ?? 1);
    if (spec && spec.scale != null) return spec.scale;
    if (entity.h) return entity.h / base;
    return 1;
  }

  function resolveFacing(entity){
    const f = (entity && (entity.facing || entity.face || entity.dir)) || 'S';
    if (typeof f === 'string') return f.toUpperCase();
    if (typeof f === 'number') {
      const ang = ((f % (Math.PI*2)) + Math.PI*2) % (Math.PI*2);
      if (ang > Math.PI*0.25 && ang <= Math.PI*0.75) return 'S';
      if (ang > Math.PI*0.75 && ang <= Math.PI*1.25) return 'W';
      if (ang > Math.PI*1.25 && ang <= Math.PI*1.75) return 'N';
      return 'E';
    }
    return 'S';
  }

  function velocityPhase(entity){
    if (!entity) return 0;
    return Math.hypot(entity.vx||0, entity.vy||0);
  }

  function baseShadow(ctx, radiusX = 16, radiusY = 8){
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = 'black';
    ctx.scale(1, 0.35);
    ctx.beginPath();
    ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  function drawRatPuppet(ctx, s, phase){
    ctx.save();
    ctx.translate(0, -6*s);
    // sombra
    baseShadow(ctx, 14*s, 8*s);

    const fur='#c9c3b5', belly='#d8d4c9', earIn='#eab0b5', paw='#f0ddd2', nose='#d98c8f', eye='#2a2a2a', tailCol='#c48974';

    // cuerpo
    ctx.fillStyle=fur; ctx.beginPath(); ctx.ellipse(0,0,16*s,9*s,0,0,Math.PI*2); ctx.fill();

    // barriga
    ctx.fillStyle=belly; ctx.beginPath(); ctx.ellipse(0, 2*s, 16*s*0.6, 9*s*0.6, 0, 0, Math.PI*2); ctx.fill();

    // cola
    const wag = Math.sin(phase*2) * 6*s;
    ctx.strokeStyle=tailCol; ctx.lineWidth=2.4*s; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(-16*s*0.95, 1*s);
    ctx.quadraticCurveTo(-16*s*1.2, wag*0.25, -16*s*1.6, wag); ctx.stroke();

    // cabeza
    const headR=6*s; const headX=16*s*0.9, headY=-9*s*0.15;
    ctx.fillStyle=fur; ctx.beginPath(); ctx.arc(headX, headY, headR, 0, Math.PI*2); ctx.fill();

    // orejas
    const earR=2.8*s, eOX=headX-2.5*s, eOY=headY-4.5*s;
    ctx.fillStyle=fur; ctx.beginPath(); ctx.arc(eOX, eOY, earR, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle=earIn; ctx.beginPath(); ctx.arc(eOX-0.4*s,eOY+0.2*s,earR*0.65,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=fur; ctx.beginPath(); ctx.arc(eOX+5.0*s,eOY+0.4*s,earR, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle=earIn; ctx.beginPath(); ctx.arc(eOX+5.0*s-0.4*s,eOY+0.6*s,earR*0.65,0, Math.PI*2); ctx.fill();

    // morro y nariz
    ctx.fillStyle=nose; ctx.beginPath();
    ctx.moveTo(headX + headR, headY);
    ctx.lineTo(headX + headR + 5*s, headY - 1.6*s);
    ctx.lineTo(headX + headR + 5*s, headY + 1.6*s);
    ctx.closePath(); ctx.fill();

    // ojo
    ctx.fillStyle=eye; ctx.beginPath(); ctx.arc(headX + 1.5*s, headY - 0.8*s, 0.9*s, 0, Math.PI*2); ctx.fill();

    // bigotes
    ctx.strokeStyle='#6b6b6b'; ctx.lineWidth=1.1*s;
    const wx=headX + headR - 0.8*s, wy=headY;
    ctx.beginPath();
    ctx.moveTo(wx,wy); ctx.lineTo(wx + 6*s, wy - 2*s);
    ctx.moveTo(wx,wy); ctx.lineTo(wx + 6*s, wy);
    ctx.moveTo(wx,wy); ctx.lineTo(wx + 6*s, wy + 2*s);
    ctx.stroke();

    // patitas
    const stepA=Math.sin(phase), stepB=Math.sin(phase + Math.PI);
    const lift=2.2*s, bodyH2=9*s*0.9;
    const fX=16*s*0.35;
    ctx.fillStyle=paw;
    ctx.beginPath(); ctx.arc(+fX,          bodyH2 - Math.max(0, stepA)*lift, 1.9*s, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(+fX-3.6*s,    bodyH2 - Math.max(0, stepB)*lift, 1.9*s, 0, Math.PI*2); ctx.fill();
    const bX=-16*s*0.25;
    ctx.beginPath(); ctx.arc(bX,           bodyH2 - Math.max(0, stepB)*lift, 2.1*s, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(bX-3*s,       bodyH2 - Math.max(0, stepA)*lift, 2.1*s, 0, Math.PI*2); ctx.fill();

    ctx.restore();
  }

  function applyScale(ctx, cam, entity, spec, base){
    const scale = entityScale(entity, spec, base) * (cam.zoom || 1);
    ctx.scale(scale, scale);
    return scale;
  }

  // --- Rig: biped (héroes/NPC) ---
  global.PuppetAPI.registerRig('biped', {
    create(spec){
      return { t:0, skin: spec.skin || null, breathing:0, phase:0 };
    },
    update(dt, st, e){
      st.t += dt;
      st.speed = velocityPhase(e);
      st.face = resolveFacing(e);
      if (st.skin !== (e.skin || e.spriteKey)) st.skin = e.skin || e.spriteKey || st.skin;
    },
    draw(ctx, cam, st, e, spec){
      const scale = applyScale(ctx, cam, e, spec, 32);
      const skin = st.skin;
      const moving = st.speed > 5;
      const phase = st.t * (moving ? 8 : 2);
      const bob = moving ? Math.sin(phase) * 1.6 : Math.sin(st.t * 2) * 0.8;
      const face = st.face || 'S';
      const flip = (face === 'W') ? -1 : 1;

      ctx.save();
      baseShadow(ctx, 12, 7);
      ctx.restore();

      ctx.scale(flip, 1);
      ctx.translate(0, -18);

      const img = skin ? loadImage(skin.endsWith('.png') ? skin : `${skin}.png`) : null;
      if (img && img.complete && img.naturalWidth){
        const iw = img.width, ih = img.height;
        const factor = 0.9;
        ctx.save();
        ctx.translate(-iw*0.5*factor, -ih*factor + 4 + bob);
        ctx.drawImage(img, 0, 0, iw*factor, ih*factor);
        ctx.restore();
      } else {
        const bodyColor = '#2b6cb0';
        const skinColor = '#f5d0a0';
        const limbColor = '#244a73';

        // torso
        ctx.fillStyle = bodyColor;
        ctx.save();
        ctx.translate(0, bob);
        ctx.beginPath(); ctx.ellipse(0, 6, 8, 10, 0, 0, Math.PI*2); ctx.fill();
        ctx.restore();

        // cabeza
        ctx.fillStyle = skinColor;
        ctx.save();
        ctx.translate(0, -10 + bob*0.3);
        ctx.beginPath(); ctx.ellipse(0, 0, 7, 7, 0, 0, Math.PI*2); ctx.fill();
        ctx.restore();

        // brazos
        ctx.fillStyle = limbColor;
        const armPhase = Math.sin(phase + Math.PI) * 4;
        ctx.save();
        ctx.translate(6, 2 + bob*0.5);
        ctx.rotate(armPhase * 0.03);
        ctx.fillRect(-2, 0, 4, 12);
        ctx.restore();

        ctx.save();
        ctx.translate(-6, 2 + bob*0.5);
        ctx.rotate(-armPhase * 0.03);
        ctx.fillRect(-2, 0, 4, 12);
        ctx.restore();

        // piernas
        const legPhase = Math.sin(phase) * 4;
        ctx.save();
        ctx.translate(3, 18);
        ctx.rotate(legPhase * 0.02);
        ctx.fillRect(-2, 0, 4, 12);
        ctx.restore();

        ctx.save();
        ctx.translate(-3, 18);
        ctx.rotate(-legPhase * 0.02);
        ctx.fillRect(-2, 0, 4, 12);
        ctx.restore();
      }
    }
  });

  // --- Rig: rat ---
  global.PuppetAPI.registerRig('rat', {
    create(){ return { t:0 }; },
    update(dt, st, e){ st.t += dt; st.speed = velocityPhase(e); },
    draw(ctx, cam, st, e, spec){
      applyScale(ctx, cam, e, spec, 28);
      const phase = st.t * 6 + (e.vx||0)*0.002 + (e.vy||0)*0.002;
      const dir = (e && e.vx < 0) ? -1 : 1;
      ctx.scale(dir, 1);
      drawRatPuppet(ctx, 1, phase);
    }
  });

  // --- Rig: mosquito ---
  global.PuppetAPI.registerRig('mosquito', {
    create(){ return { t:0 }; },
    update(dt, st, e){ st.t += dt; st.speed = velocityPhase(e); },
    draw(ctx, cam, st, e, spec){
      applyScale(ctx, cam, e, spec, 24);
      const flutter = Math.sin(st.t * 30) * 0.5 + 0.5;
      const pulse = Math.sin(st.t * 4) * 1.5;

      baseShadow(ctx, 8, 5);

      // cuerpo
      ctx.fillStyle = '#30343f';
      ctx.save();
      ctx.translate(0, -12 + pulse);
      ctx.beginPath(); ctx.ellipse(0, 0, 6, 10, 0, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      // alas
      ctx.save();
      ctx.globalAlpha = 0.35 + flutter*0.35;
      ctx.fillStyle = '#e5f1ff';
      ctx.scale(1 + flutter*0.15, 1);
      ctx.rotate(0.15);
      ctx.beginPath(); ctx.ellipse(6, -20, 8, 16, 0, 0, Math.PI*2); ctx.fill();
      ctx.rotate(-0.3);
      ctx.beginPath(); ctx.ellipse(-6, -20, 8, 16, 0, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      // cabeza
      ctx.fillStyle = '#1e2129';
      ctx.beginPath(); ctx.ellipse(0, -20 + pulse*0.2, 4, 4, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#f5f7ff';
      ctx.beginPath(); ctx.arc(-1.5, -21, 1.2, 0, Math.PI*2); ctx.arc(1.5, -21, 1.2, 0, Math.PI*2); ctx.fill();
    }
  });

  // --- Rig: patient ---
  global.PuppetAPI.registerRig('patient', {
    create(){ return { t:0 }; },
    update(dt, st, e){ st.t += dt; st.attended = !!e.attended; },
    draw(ctx, cam, st, e, spec){
      applyScale(ctx, cam, e, spec, 32);
      const breath = Math.sin(st.t * 2) * (st.attended ? 0 : 1.5);
      const fade = st.attended ? 0.35 : 1;

      baseShadow(ctx, 18, 9);

      ctx.globalAlpha = fade;
      // cama
      ctx.fillStyle = '#90a4ae';
      ctx.fillRect(-20, -18, 40, 8);
      ctx.fillStyle = '#b0bec5';
      ctx.fillRect(-20, -40, 40, 22);

      // almohada
      ctx.fillStyle = '#eceff1';
      ctx.fillRect(-18, -44, 36, 10);

      // paciente
      ctx.fillStyle = '#f8d9c4';
      ctx.beginPath(); ctx.ellipse(0, -36 + breath*0.2, 10, 6, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#4fc3f7';
      ctx.fillRect(-14, -32, 28, 18 + breath*0.2);
    }
  });

  // --- Rig: door ---
  global.PuppetAPI.registerRig('door', {
    create(){ return { t:0, open:0 }; },
    update(dt, st, e){
      st.t += dt;
      const target = e.open ? 1 : 0;
      st.open = lerp(st.open, target, clamp(dt*6, 0, 1));
      st.isBoss = !!e.isBossDoor;
    },
    draw(ctx, cam, st, e, spec){
      applyScale(ctx, cam, e, spec, 32);
      baseShadow(ctx, 14, 7);
      ctx.translate(0, -32);
      const width = 24;
      const height = 32;
      const openPx = st.open * width * 0.6;
      const frameColor = st.isBoss ? '#8b2f3c' : '#4b5563';
      const panelColor = st.isBoss ? '#d9777c' : '#9ca3af';

      // marco
      ctx.fillStyle = frameColor;
      ctx.fillRect(-width*0.5 - 3, 0, width + 6, height);

      // paneles abiertos
      ctx.fillStyle = panelColor;
      ctx.fillRect(-width*0.5, 0, width*0.5 - openPx, height);
      ctx.fillRect(openPx, 0, width*0.5, height);
    }
  });

  // --- Rig: elevator ---
  global.PuppetAPI.registerRig('elevator', {
    create(){ return { t:0, open:0 }; },
    update(dt, st, e){
      st.t += dt;
      const target = (e.active && !e.locked) ? 1 : 0;
      st.open = lerp(st.open, target, clamp(dt*5, 0, 1));
    },
    draw(ctx, cam, st, e, spec){
      applyScale(ctx, cam, e, spec, 32);
      baseShadow(ctx, 14, 7);
      ctx.translate(0, -30);
      const width = 26;
      const height = 30;
      const openPx = st.open * width * 0.5;

      ctx.fillStyle = '#2f3a4a';
      ctx.fillRect(-width*0.5-2, -2, width+4, height+4);

      ctx.fillStyle = '#4f6075';
      ctx.fillRect(-width*0.5, 0, width*0.5 - openPx, height);
      ctx.fillRect(openPx, 0, width*0.5, height);

      ctx.fillStyle = '#cbd5f5';
      ctx.fillRect(-6, 6, 12, 12);
    }
  });

  // --- Rig: cart ---
  global.PuppetAPI.registerRig('cart', {
    create(){ return { t:0 }; },
    update(dt, st, e){ st.t += dt; st.speed = velocityPhase(e); },
    draw(ctx, cam, st, e, spec){
      applyScale(ctx, cam, e, spec, 32);
      const wobble = Math.sin(st.t * 4) * Math.min(1, st.speed / 60) * 2;

      baseShadow(ctx, 18, 9);
      ctx.rotate(wobble * Math.PI / 180);

      ctx.fillStyle = '#b08968';
      ctx.fillRect(-20, -16, 40, 18);
      ctx.fillStyle = '#d2b48c';
      ctx.fillRect(-18, -28, 36, 12);

      ctx.fillStyle = '#654321';
      ctx.fillRect(12, -30, 6, 14);

      ctx.fillStyle = '#2f2f2f';
      ctx.beginPath(); ctx.ellipse(-12, 2, 6, 6, 0, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(12, 2, 6, 6, 0, 0, Math.PI*2); ctx.fill();
    }
  });

  // --- Rig: hazard ---
  global.PuppetAPI.registerRig('hazard', {
    create(){ return { t:0 }; },
    update(dt, st, e){ st.t += dt; st.kind = e.kind; },
    draw(ctx, cam, st, e, spec){
      applyScale(ctx, cam, e, spec, 32);
      if (String(st.kind || '').toLowerCase().includes('fire')){
        const flicker = 0.8 + Math.sin(st.t * 8) * 0.2;
        ctx.globalAlpha = 0.9;
        baseShadow(ctx, 12, 7);
        ctx.translate(0, -10);
        ctx.fillStyle = `rgba(255,140,60,${flicker})`;
        ctx.beginPath(); ctx.moveTo(0, -18);
        ctx.quadraticCurveTo(-10, -4, 0, 4);
        ctx.quadraticCurveTo(10, -4, 0, -18);
        ctx.fill();
      } else {
        const wave = Math.sin(st.t * 3) * 2;
        baseShadow(ctx, 14, 8);
        ctx.translate(0, -6);
        ctx.fillStyle = 'rgba(120,180,255,0.55)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 16, 10 + wave, 0, 0, Math.PI*2);
        ctx.fill();
      }
    }
  });

  // --- Rig: pill ---
  global.PuppetAPI.registerRig('pill', {
    create(){ return { t:0 }; },
    update(dt, st){ st.t += dt; },
    draw(ctx, cam, st, e, spec){
      applyScale(ctx, cam, e, spec, 16);
      const spin = Math.sin(st.t * 2) * 0.5;
      baseShadow(ctx, 8, 4);
      ctx.rotate(spin * 0.2);
      ctx.translate(0, -10 + Math.sin(st.t * 4) * 2);
      ctx.fillStyle = '#d32f2f';
      ctx.beginPath(); ctx.ellipse(-6, 0, 6, 10, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath(); ctx.ellipse(6, 0, 6, 10, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-1, -10, 2, 20);
    }
  });

  // --- Rig: boss ---
  global.PuppetAPI.registerRig('boss', {
    create(spec, e){
      const skin = spec.skin || e?.skin || 'boss_nivel1.png';
      return { t:0, skin };
    },
    update(dt, st){ st.t += dt; },
    draw(ctx, cam, st, e, spec){
      applyScale(ctx, cam, e, spec, 64);
      baseShadow(ctx, 32, 18);
      ctx.translate(0, -48);
      const img = st.skin ? loadImage(st.skin.endsWith('.png') ? st.skin : `${st.skin}.png`) : null;
      if (img && img.complete && img.naturalWidth){
        const w = img.width;
        const h = img.height;
        ctx.drawImage(img, -w*0.5, -h + 12, w, h);
      } else {
        ctx.fillStyle = '#4b0f1f';
        ctx.beginPath(); ctx.ellipse(0, 0, 40, 36, 0, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#f9d71c';
        ctx.beginPath(); ctx.arc(-12, -10, 6, 0, Math.PI*2); ctx.arc(12, -10, 6, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = '#8b0000';
        ctx.fillRect(-18, 10, 36, 12);
      }
    }
  });

})(window);
