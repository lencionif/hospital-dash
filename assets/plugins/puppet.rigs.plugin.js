(function(){
  const PuppetAPI = window.PuppetAPI;
  if (!PuppetAPI) return;
  const Images = {};
  const IMG = n => `./assets/images/${n}`;
  function load(n){ if(!Images[n]){ const im=new Image(); im.src=IMG(n); Images[n]=im; } return Images[n]; }
  function toScreen(cam, ctx, e){
    const sc = cam.zoom||1;
    const sx = (e.x + e.w*0.5 - cam.x)*sc + ctx.canvas.width*0.5;
    const sy = (e.y + e.h*0.5 - cam.y)*sc + ctx.canvas.height*0.5;
    const s  = sc * (e.puppet?.scale||1);
    return {sx, sy, s};
  }

  // Héroe básico (bipedEx)
  PuppetAPI.registerRig('bipedEx',{
    create:()=>({t:0}), update(dt,st){st.t+=dt;},
    draw(ctx,cam,st,e,spec){
      const {sx,sy,s}=toScreen(cam,ctx,e);
      const skin = load(spec?.skin || 'enrique.png');
      const bob = Math.sin(st.t*2.2)*2*s;
      ctx.save(); ctx.translate(sx,sy - bob);
      if(skin.complete) ctx.drawImage(skin,-e.w*0.5*s,-e.h*0.9*s,e.w*s,e.h*1.2*s);
      else { ctx.fillStyle='#ccc'; ctx.fillRect(-10, -18, 20, 36); }
      ctx.restore();
    }
  });

  // ===== Dibujo "muñeco" de rata =====
  function drawRatPuppet(ctx, s, phase){
    ctx.save();
    const wiggle = Math.sin(phase) * 4 * s;
    const tailWave = Math.sin(phase * 1.6) * 8 * s;

    // cola
    ctx.save();
    ctx.translate(-26 * s, 8 * s);
    ctx.rotate(0.2 + wiggle * 0.01);
    ctx.strokeStyle = '#d8a49c';
    ctx.lineWidth = 4 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-14 * s, -6 * s + tailWave, -32 * s, 10 * s - tailWave);
    ctx.stroke();
    ctx.restore();

    // cuerpo principal
    ctx.fillStyle = '#6d665f';
    ctx.beginPath();
    ctx.ellipse(0, 0, 28 * s, 18 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // barriga clara
    ctx.fillStyle = '#8b847c';
    ctx.beginPath();
    ctx.ellipse(4 * s, 6 * s, 16 * s, 10 * s, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // cabeza
    ctx.save();
    ctx.translate(24 * s, -4 * s);
    ctx.rotate(-0.1 + wiggle * 0.004);
    ctx.fillStyle = '#6d665f';
    ctx.beginPath();
    ctx.ellipse(0, 0, 16 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // hocico rosado
    ctx.fillStyle = '#d8a49c';
    ctx.beginPath();
    ctx.ellipse(14 * s, 0, 6 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // orejas
    ctx.fillStyle = '#7a7370';
    ctx.beginPath();
    ctx.ellipse(-4 * s, -12 * s, 7 * s, 10 * s, 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(6 * s, -12 * s, 7 * s, 10 * s, -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d89cb5';
    ctx.beginPath();
    ctx.ellipse(-4 * s, -12 * s, 4 * s, 6 * s, 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(6 * s, -12 * s, 4 * s, 6 * s, -0.1, 0, Math.PI * 2);
    ctx.fill();

    // ojos
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(6 * s, -2 * s, 2.4 * s, 0, Math.PI * 2);
    ctx.arc(0, -2 * s, 2.4 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(6.8 * s, -2.4 * s, 0.9 * s, 0, Math.PI * 2);
    ctx.arc(0.8 * s, -2.4 * s, 0.9 * s, 0, Math.PI * 2);
    ctx.fill();

    // bigotes
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    ctx.moveTo(10 * s, 0);
    ctx.lineTo(18 * s, -4 * s);
    ctx.moveTo(10 * s, 0);
    ctx.lineTo(18 * s, 4 * s);
    ctx.moveTo(10 * s, 0);
    ctx.lineTo(18 * s, 0);
    ctx.stroke();

    ctx.restore(); // fin cabeza

    // patas
    ctx.fillStyle = '#514a43';
    const walk = Math.sin(phase * 0.6);
    for (let i = -1; i <= 1; i += 2) {
      ctx.save();
      ctx.translate(-10 * s * i, 14 * s);
      ctx.rotate(walk * 0.12 * i);
      ctx.fillRect(-3 * s, 0, 6 * s, 10 * s);
      ctx.fillStyle = '#d8a49c';
      ctx.fillRect(-3 * s, 10 * s, 6 * s, 4 * s);
      ctx.restore();
      ctx.fillStyle = '#514a43';
    }

    ctx.restore();
  }
  PuppetAPI.registerRig('rat',{
    create:()=>({t:0}), update(d,st){st.t+=d;},
    draw(ctx,cam,st,e){ const {sx,sy,s}=toScreen(cam,ctx,e); ctx.save(); ctx.translate(sx,sy); drawRatPuppet(ctx,s*0.9, st.t*6); ctx.restore(); }
  });

  // Mosquito (alas)
  PuppetAPI.registerRig('mosquito',{
    create:()=>({t:0}), update(d,st){st.t+=d;},
    draw(ctx,cam,st,e){
      const {sx,sy,s}=toScreen(cam,ctx,e);
      const flap=Math.sin(st.t*28)*0.35+0.65;
      ctx.save(); ctx.translate(sx,sy);
      ctx.fillStyle='#333'; ctx.beginPath(); ctx.ellipse(0,0,e.w*0.25*s,e.h*0.20*s,0,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha=0.6; ctx.save(); ctx.scale(flap,1); ctx.fillStyle='#9fd2ff';
      ctx.beginPath(); ctx.ellipse(-e.w*0.18*s,-e.h*0.12*s,e.w*0.20*s,e.h*0.12*s,0,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(+e.w*0.18*s,-e.h*0.12*s,e.w*0.20*s,e.h*0.12*s,0,0,Math.PI*2); ctx.fill();
      ctx.restore(); ctx.globalAlpha=1; ctx.restore();
    }
  });

  // Puerta
  PuppetAPI.registerRig('door',{
    create:()=>({}), update(){},
    draw(ctx,cam,st,e){
      const {sx,sy,s}=toScreen(cam,ctx,e);
      const ratio = e.openRatio ?? (e.open?1:0);
      const skin = (ratio>0.5) ? load('puerta_abiertas.png') : load('puerta_cerrada.png');
      ctx.save(); ctx.translate(sx,sy);
      if(skin.complete) ctx.drawImage(skin,-e.w*0.5*s,-e.h*0.9*s,e.w*s,e.h*1.1*s);
      ctx.restore();
    }
  });

  // QA auditoría mínima
  window.auditPuppets = function(list){
    let want={HERO:0,RAT:0,MOSQUITO:0,DOOR:0}, ok={HERO:0,RAT:0,MOSQUITO:0,DOOR:0};
    for(const e of list){
      if(e.kind in want) want[e.kind]++;
      if(e.puppet) ok[e.kind]++;
    }
    console.log('PUPPET_AUDIT',{want,ok});
    if(ok.HERO&&ok.RAT&&ok.MOSQUITO&&(ok.DOOR||want.DOOR===0)) console.log('PUPPET_ALL_OK');
  };
})();
