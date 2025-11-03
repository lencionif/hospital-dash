// ./assets/plugins/puppet.plugin.js
(function(){
  const rigs = new Map();
  const puppets = [];
  let needsSort = false;

  function registerRig(name, rig){
    if (!name || !rig) return;
    rigs.set(name, rig);
  }

  function detach(entity){
    if (!entity || !entity.puppet) return;
    const idx = puppets.indexOf(entity.puppet);
    if (idx >= 0) puppets.splice(idx, 1);
    delete entity.puppet;
  }

  function attach(entity, opts={}){
    if (!entity) return null;
    detach(entity);
    const puppet = {
      entity,
      rigName: opts.rig || opts.name || null,
      scale: opts.scale ?? 1,
      z: opts.z ?? 0,
      zscale: opts.zscale ?? 1,
      data: opts.data || {},
      state: null,
      time: 0
    };
    entity.puppet = puppet;
    puppets.push(puppet);
    needsSort = true;
    return puppet;
  }

  function bind(entity, rigName, opts={}){
    if (!entity) return null;
    const puppet = attach(entity, { ...opts, rig: rigName });
    if (entity) entity.rigOk = !!puppet;
    return puppet;
  }

  function sortPuppets(){
    if (!needsSort) return;
    puppets.sort((a, b) => {
      if (a.z !== b.z) return a.z - b.z;
      const ay = a.entity?.y ?? 0;
      const by = b.entity?.y ?? 0;
      return ay - by;
    });
    needsSort = false;
  }

  function ensureCamera(ctx, cam){
    if (cam) return { ...cam, w: cam.w ?? ctx?.canvas?.width ?? 0, h: cam.h ?? ctx?.canvas?.height ?? 0 };
    const w = ctx?.canvas?.width ?? 0;
    const h = ctx?.canvas?.height ?? 0;
    return { x:0, y:0, w, h, zoom:1 };
  }

  function ensureRigState(puppet){
    if (!puppet) return null;
    const rig = rigs.get(puppet.rigName);
    if (!rig) return null;
    if (!puppet.state){
      if (typeof rig.create === 'function'){
        try {
          puppet.state = rig.create(puppet.entity) || {};
        } catch (err){
          console.warn('[PuppetAPI] rig.create', puppet.rigName, err);
          puppet.state = {};
        }
      } else if (puppet.data && typeof puppet.data === 'object'){
        puppet.state = puppet.data;
      } else {
        puppet.state = {};
      }
    }
    return puppet.state;
  }

  function updateAll(state, dt){
    sortPuppets();
    for (const puppet of puppets){
      puppet.time += dt;
      const rig = rigs.get(puppet.rigName);
      if (!rig) continue;
      const rigState = ensureRigState(puppet);
      if (typeof rig.update === 'function'){
        try {
          if (typeof rig.create === 'function' && rig.update.length >= 3){
            rig.update(rigState, puppet.entity, dt);
          } else {
            rig.update(puppet, state, dt);
          }
        } catch (err) {
          console.warn('[PuppetAPI] rig.update', puppet.rigName, err);
        }
      }
    }
  }

  function drawAll(ctx, cam){
    if (!ctx) return;
    sortPuppets();
    const camera = ensureCamera(ctx, cam);
    for (const puppet of puppets){
      drawOne(puppet, ctx, camera);
    }
  }

  function drawOne(puppet, ctx, cam){
    if (!puppet || !puppet.entity) return;
    const rig = rigs.get(puppet.rigName);
    if (!rig || typeof rig.draw !== 'function') return;
    try {
      const state = ensureRigState(puppet);
      const camera = cam || ensureCamera(ctx);
      if (typeof rig.create === 'function'){
        rig.draw(ctx, camera, puppet.entity, state, puppet.time);
      } else if (rig.draw.length >= 4){
        rig.draw(ctx, camera, puppet.entity, puppet.time);
      } else {
        rig.draw(ctx, camera, puppet.entity);
      }
    } catch (err) {
      console.warn('[PuppetAPI] rig.draw', err);
    }
  }

  function updateOne(puppet, dt, state){
    if (!puppet) return;
    puppet.time += dt;
    const rig = rigs.get(puppet.rigName);
    if (!rig) return;
    const rigState = ensureRigState(puppet);
    if (typeof rig.update === 'function'){
      try {
        if (typeof rig.create === 'function' && rig.update.length >= 3){
          rig.update(rigState, puppet.entity, dt);
        } else {
          rig.update(puppet, state, dt);
        }
      } catch (err) {
        console.warn('[PuppetAPI] rig.update', puppet.rigName, err);
      }
    }
  }

  function create(opts={}){
    if (!opts.host) return null;
    const puppet = attach(opts.host, { rig: opts.rig || 'biped', scale: opts.scale, z: opts.z ?? 0 });
    return puppet;
  }

  function setHeroHead(puppet, heroKey){
    const e = puppet?.entity;
    if (!e) return;
    e.spec = e.spec || {};
    if (heroKey) e.spec.skin = `${heroKey}.png`;
  }

  function toggleDebug(){ /* noop placeholder para compat */ }

  window.PuppetAPI = {
    registerRig,
    attach,
    bind,
    detach,
    updateAll,
    drawAll,
    draw: drawOne,
    update: updateOne,
    create,
    setHeroHead,
    toggleDebug
  };
  window.Puppet = window.Puppet || {};
  window.Puppet.bind = bind;
})();
