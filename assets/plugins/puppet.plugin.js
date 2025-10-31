// assets/plugins/puppet.plugin.js
// Motor de "muñecos" (Puppet) — gestiona rigs y dibujado ordenado.
(function(global){
  'use strict';

  const rigs = new Map();
  const instances = new Set();

  function registerRig(name, rig){
    if (!name || typeof name !== 'string') return;
    const key = name.toLowerCase();
    rigs.set(key, rig || {});
  }

  function _findRig(name){
    if (!name) return null;
    return rigs.get(String(name).toLowerCase()) || null;
  }

  function detach(entity){
    if (!entity) return;
    const inst = entity._puppet || entity._rig;
    if (inst) {
      instances.delete(inst);
    }
    delete entity._puppet;
    delete entity._rig;
  }

  function attach(entity, spec = {}){
    if (!entity || !spec.rig) return null;
    const rig = _findRig(spec.rig);
    if (!rig) {
      console.warn('[PuppetAPI] rig no registrado:', spec.rig);
      return null;
    }

    detach(entity);

    const state = (typeof rig.create === 'function') ? (rig.create(spec, entity) || {}) : {};
    if (state.t == null) state.t = 0;
    state.scale = state.scale != null ? state.scale : (spec.scale != null ? spec.scale : 1);

    const inst = {
      entity,
      spec: { ...spec },
      rig,
      state,
      alive: true,
    };

    instances.add(inst);
    entity._puppet = inst;
    entity._rig = inst;
    return inst;
  }

  function _cleanup(){
    for (const inst of Array.from(instances)){
      const e = inst.entity;
      if (!e || e.dead || inst.detached) {
        instances.delete(inst);
        if (e){ delete e._puppet; delete e._rig; }
      }
    }
  }

  function update(dt){
    const delta = Number(dt) || 0;
    for (const inst of Array.from(instances)){
      const e = inst.entity;
      if (!e || e.dead || inst.detached){
        instances.delete(inst);
        if (e){ delete e._puppet; delete e._rig; }
        continue;
      }
      if (typeof inst.rig.update === 'function'){
        try { inst.rig.update(delta, inst.state, e, inst.spec); }
        catch(err){ console.warn('[PuppetAPI.update] rig error', err); }
      }
    }
  }

  function _sortKey(inst){
    const e = inst.entity || {};
    const spec = inst.spec || {};
    const z = Number.isFinite(spec.z) ? spec.z : (Number.isFinite(e.z) ? e.z : 0);
    const y = (e.y || 0) + (e.h || 0);
    return { z, y };
  }

  function draw(ctx, camera){
    if (!ctx) return;
    const cam = camera || { x:0, y:0, zoom:1 };
    const viewW = ctx.canvas.width;
    const viewH = ctx.canvas.height;
    const zoom = cam.zoom || 1;

    const list = [];
    for (const inst of instances){
      const e = inst.entity;
      if (!e || e.dead) continue;
      list.push(inst);
    }

    list.sort((a,b) => {
      const ka = _sortKey(a);
      const kb = _sortKey(b);
      if (ka.z !== kb.z) return ka.z - kb.z;
      return ka.y - kb.y;
    });

    for (const inst of list){
      const e = inst.entity;
      const spec = inst.spec || {};
      const rig = inst.rig;
      if (!rig || typeof rig.draw !== 'function') continue;

      const worldX = (e.x || 0) + (e.w || 0) * 0.5;
      const worldY = (e.y || 0) + (e.h || 0);
      const screenX = (worldX - cam.x) * zoom + viewW * 0.5;
      const screenY = (worldY - cam.y) * zoom + viewH * 0.5;

      ctx.save();
      ctx.translate(screenX, screenY);
      try {
        rig.draw(ctx, cam, inst.state, e, spec);
      } catch(err){
        console.warn('[PuppetAPI.draw] rig error', err);
      }
      ctx.restore();
    }

    _cleanup();
  }

  function instancesArray(){ return Array.from(instances); }
  function hasRig(name){ return !!_findRig(name); }

  global.PuppetAPI = {
    registerRig,
    attach,
    detach,
    update,
    draw,
    getInstances: instancesArray,
    hasRig,
  };
})(window);
