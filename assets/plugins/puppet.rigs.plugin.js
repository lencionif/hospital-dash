(function () {
  const PuppetAPI = window.PuppetAPI; if (!PuppetAPI) return;

  const IMG = (name) => `./assets/images/${name}`;
  const Images = {};
  function load(n){ if(!Images[n]){ const im=new Image(); im.src=IMG(n); Images[n]=im; } return Images[n]; }

  function toScreen(cam, e){
    const s = cam.zoom||1;
    const sx = (e.x - cam.x + cam.w*0.5) * s + 0.5;
    const sy = (e.y - cam.y + cam.h*0.5) * s + 0.5;
    const sc = (e.puppet?.zscale||1) * (e.puppet?.scale||1) * s;
    return {sx, sy, sc};
  }

  // ---------- RIG BÁSICO HUMANO (BIPED) ----------
  PuppetAPI.registerRig('biped', {
    draw(ctx, cam, e, t){
      const {sx, sy, sc} = toScreen(cam, e);
      ctx.save(); ctx.translate(sx, sy); ctx.scale(sc, sc);
      ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
      ctx.scale(1, 0.35); ctx.beginPath(); ctx.ellipse(0, 0, 14, 8, 0, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      ctx.save(); ctx.translate(sx, sy);
      const skin = e.spec?.skin || 'enrique.png';
      const bob = Math.sin(t*6) * 2;
      const im = load(skin);
      const w = 32, h = 32;
      ctx.drawImage(im, -w*0.5, -h - 8 + bob, w, h);
      ctx.restore();
    }
  });

  function drawRatPuppet(ctx, phase, s){
    ctx.save();
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
    ctx.scale(1, 0.35);
    ctx.beginPath(); ctx.ellipse(0, 0, 14*s, 8*s, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    const fur='#c9c3b5', belly='#d8d4c9', earIn='#eab0b5', paw='#f0ddd2', nose='#d98c8f', eye='#2a2a2a', tailCol='#c48974';

    const bodyW = 16*s, bodyH = 9*s;
    ctx.fillStyle = fur; ctx.beginPath(); ctx.ellipse(0, 0, bodyW, bodyH, 0, 0, Math.PI*2); ctx.fill();

    ctx.fillStyle = belly; ctx.beginPath(); ctx.ellipse(0, 2*s, bodyW*0.6, bodyH*0.6, 0, 0, Math.PI*2); ctx.fill();

    const wag = Math.sin(phase*2) * 6*s;
    ctx.strokeStyle = tailCol; ctx.lineWidth = 2.4*s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-bodyW*0.95, 1*s);
    ctx.quadraticCurveTo(-bodyW*1.2, wag*0.25, -bodyW*1.6, wag);
    ctx.stroke();

    const headR = 6*s, headX = bodyW*0.9, headY = -bodyH*0.15;
    ctx.fillStyle = fur; ctx.beginPath(); ctx.arc(headX, headY, headR, 0, Math.PI*2); ctx.fill();

    const earR = 2.8*s, eOX = headX - 2.5*s, eOY = headY - 4.5*s;
    ctx.fillStyle = fur; ctx.beginPath(); ctx.arc(eOX, eOY, earR, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = earIn; ctx.beginPath(); ctx.arc(eOX-0.4*s,eOY+0.2*s,earR*0.65,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = fur; ctx.beginPath(); ctx.arc(eOX+5*s,eOY+0.4*s,earR,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = earIn; ctx.beginPath(); ctx.arc(eOX+5*s-0.4*s,eOY+0.6*s,earR*0.65,0,Math.PI*2); ctx.fill();

    ctx.fillStyle = nose; ctx.beginPath();
    ctx.moveTo(headX+headR, headY);
    ctx.lineTo(headX+headR+5*s, headY-1.6*s);
    ctx.lineTo(headX+headR+5*s, headY+1.6*s);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = eye; ctx.beginPath(); ctx.arc(headX + 1.5*s, headY - 0.8*s, 0.9*s, 0, Math.PI*2); ctx.fill();

    ctx.strokeStyle = '#6b6b6b'; ctx.lineWidth = 1.1*s;
    const wx = headX + headR - 0.8*s, wy = headY;
    ctx.beginPath();
    ctx.moveTo(wx, wy); ctx.lineTo(wx + 6*s, wy - 2*s);
    ctx.moveTo(wx, wy); ctx.lineTo(wx + 6*s, wy);
    ctx.moveTo(wx, wy); ctx.lineTo(wx + 6*s, wy + 2*s);
    ctx.stroke();

    const stepA = Math.sin(phase), stepB = Math.sin(phase + Math.PI), lift = 2.2*s, bodyH2 = bodyH*0.9;
    const fX = bodyW*0.35;
    ctx.fillStyle = paw;
    ctx.beginPath(); ctx.arc(+fX, bodyH2 - Math.max(0, stepA)*lift, 1.9*s, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(+fX-3.6*s, bodyH2 - Math.max(0, stepB)*lift, 1.9*s, 0, Math.PI*2); ctx.fill();
    const bX = -bodyW*0.25;
    ctx.beginPath(); ctx.arc(bX, bodyH2 - Math.max(0, stepB)*lift, 2.1*s, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(bX-3*s, bodyH2 - Math.max(0, stepA)*lift, 2.1*s, 0, Math.PI*2); ctx.fill();
  }

  PuppetAPI.registerRig('rat', {
    draw(ctx, cam, e, t){
      const {sx, sy, sc} = toScreen(cam, e);
      ctx.save(); ctx.translate(sx, sy); drawRatPuppet(ctx, t*6, sc*0.8); ctx.restore();
    }
  });

  PuppetAPI.registerRig('mosquito', {
    draw(ctx, cam, e, t){
      const {sx, sy, sc} = toScreen(cam, e);
      ctx.save(); ctx.translate(sx, sy); ctx.scale(sc, sc);
      ctx.save(); ctx.globalAlpha=.25; ctx.fillStyle='#000'; ctx.scale(1, .28);
      ctx.beginPath(); ctx.ellipse(0, 0, 10, 6, 0, 0, Math.PI*2); ctx.fill(); ctx.restore();

      ctx.fillStyle='#3b3b3b'; ctx.beginPath(); ctx.ellipse(0, -4, 6, 4, 0, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle='#7a7a7a'; ctx.beginPath(); ctx.ellipse(-6, -4, 5, 3, 0, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle='#444'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(6,-4); ctx.lineTo(12,-3); ctx.stroke();
      const flap = Math.sin(t*24)*0.6 + 1.2;
      ctx.globalAlpha=0.35;
      ctx.fillStyle='#cfe8ff';
      ctx.beginPath(); ctx.ellipse(-2,-10, 4*flap, 10, -0.3, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse( 2,-10, 4*flap, 10, +0.3, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  });

  PuppetAPI.registerRig('door', {
    draw(ctx, cam, e){
      const {sx, sy, sc} = toScreen(cam, e);
      const progress = e.state?.openProgress || 0;
      ctx.save(); ctx.translate(sx, sy); ctx.scale(sc, sc);
      ctx.fillStyle='#654321'; ctx.fillRect(-16, -32, 32, 32);
      ctx.fillStyle='#b9b9b9';
      const h = 28 * (1 - progress);
      ctx.fillRect(-14, -30, 28, h);
      ctx.restore();
    }
  });
})();
