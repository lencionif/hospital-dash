// === puppet.api.js ===
(function(){
  const RIGS = Object.create(null);
  const ATTACHED = new Map();

  const PuppetAPI = {
    attach(entity, spec){
      if (!entity || !spec || !spec.rig) return false;
      const rig = RIGS[spec.rig];
      if (!rig) { console.warn('Puppet rig no registrado:', spec.rig); return false; }
      ATTACHED.set(entity.id, { e: entity, spec, rigState: rig.create(spec) });
      return true;
    },
    detach(entity){ if (!entity) return; ATTACHED.delete(entity.id); },
    update(dt){
      for (const { e, spec, rigState } of ATTACHED.values()){
        const rig = RIGS[spec.rig];
        if (rig && rig.update) rig.update(dt, rigState, e);
      }
    },
    draw(ctx, camera){
      const items = [];
      for (const val of ATTACHED.values()){
        const { e, spec, rigState } = val;
        items.push({ z: spec.z||0, e, spec, rigState });
      }
      items.sort((a,b)=> (a.z-b.z) || (a.e.y - b.e.y));
      for (const it of items){
        const rig = RIGS[it.spec.rig];
        rig && rig.draw && rig.draw(ctx, camera, it.rigState, it.e, it.spec);
      }
    },
    registerRig(id, impl){ RIGS[id] = impl; },
    has(entity){ return ATTACHED.has(entity.id); }
  };

  // Rigs básicos ---------------------------------------------------
  function worldToScreen(camera, ctx, e){
    const sc = camera.zoom||1;
    const sx = (e.x - camera.x)*sc + ctx.canvas.width*0.5;
    const sy = (e.y - camera.y)*sc + ctx.canvas.height*0.5;
    return { sx, sy, sc };
  }

  PuppetAPI.registerRig('biped', {
    create:(spec)=>({ t:0, skin: spec.skin||'enrique.png' }),
    update(dt, st, e){ st.t += dt; },
    draw(ctx, cam, st, e, spec){
      const { sx, sy, sc } = worldToScreen(cam, ctx, { x:e.x, y:e.y });
      ctx.save();
      ctx.translate(sx, sy);
      const scale = (spec.scale||1) * sc;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.ellipse(0, e.h*0.35*scale, e.w*0.45*scale, e.h*0.20*scale, 0, 0, Math.PI*2);
      ctx.fillStyle='#000';
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f0eadc';
      ctx.beginPath();
      ctx.arc(0, -e.h*0.2*scale, e.w*0.28*scale, 0, Math.PI*2);
      ctx.fill();
      ctx.fillRect(-e.w*0.25*scale, -e.h*0.1*scale, e.w*0.5*scale, e.h*0.6*scale);
      ctx.restore();
    }
  });

  PuppetAPI.registerRig('rat', {
    create:(spec)=>({ t:0 }),
    update(dt, st){ st.t += dt; },
    draw(ctx, cam, st, e, spec){
      const { sx, sy, sc } = worldToScreen(cam, ctx, { x:e.x, y:e.y });
      const scale = (spec.scale||1) * sc;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.fillStyle = '#b47e5f';
      ctx.beginPath();
      ctx.ellipse(0, 0, e.w*0.45*scale, e.h*0.3*scale, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle='#8a5a3c';
      ctx.lineWidth=2*scale;
      ctx.beginPath();
      ctx.moveTo(-e.w*0.2*scale, e.h*0.1*scale);
      ctx.quadraticCurveTo(-e.w*0.5*scale, e.h*0.1*scale, -e.w*0.6*scale, 0);
      ctx.stroke();
      ctx.restore();
    }
  });

  PuppetAPI.registerRig('mosquito', {
    create:(spec)=>({ t:0 }),
    update(dt, st){ st.t += dt; },
    draw(ctx, cam, st, e, spec){
      const { sx, sy, sc } = worldToScreen(cam, ctx, { x:e.x, y:e.y });
      const scale = (spec.scale||1) * sc;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.fillStyle='#333';
      ctx.beginPath();
      ctx.ellipse(0,0,e.w*0.25*scale,e.h*0.20*scale,0,0,Math.PI*2);
      ctx.fill();
      ctx.globalAlpha=0.6;
      ctx.fillStyle='#9fd2ff';
      ctx.beginPath();
      ctx.ellipse(-e.w*0.18*scale,-e.h*0.12*scale,e.w*0.20*scale,e.h*0.12*scale,0,0,Math.PI*2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(+e.w*0.18*scale,-e.h*0.12*scale,e.w*0.20*scale,e.h*0.12*scale,0,0,Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  });

  window.PuppetAPI = PuppetAPI;
})();
