// ./assets/plugins/puppet.plugin.js
(function(){
  const PuppetNS = window.Puppet || (window.Puppet = {});
  const registry = PuppetNS.RIGS = PuppetNS.RIGS || Object.create(null);
  const rigs = new Map();
  const puppets = [];
  let needsSort = false;
  const missingRigWarnings = new Set();
  const activityLog = new WeakMap();
  let lastActivitySummary = '';

  const getNow = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();

  function getTileSize(){
    const size = window.G?.TILE_SIZE ?? window.TILE_SIZE ?? window.TILE ?? 32;
    const num = Number(size);
    return Number.isFinite(num) && num > 0 ? num : 32;
  }

  function resolveVisualRadiusTiles(){
    const raw = Number(window.G?.visualRadiusTiles);
    return Number.isFinite(raw) && raw > 0 ? raw : 8;
  }

  function resolveVisualRadiusPx(){
    const G = window.G || {};
    const px = Number(G.visualRadiusPx);
    if (Number.isFinite(px) && px > 0) return px;
    const tiles = resolveVisualRadiusTiles();
    const tile = getTileSize();
    const computed = Math.max(1, tiles * tile);
    G.visualRadiusPx = computed;
    return computed;
  }

  function computeHeroInfo(hero){
    if (!hero) return null;
    const tile = getTileSize();
    const w = Number(hero.w);
    const h = Number(hero.h);
    const hw = Number.isFinite(w) && w > 0 ? w : tile;
    const hh = Number.isFinite(h) && h > 0 ? h : tile;
    const hx = (Number(hero.x) || 0) + hw * 0.5;
    const hy = (Number(hero.y) || 0) + hh * 0.5;
    return { hero, hx, hy };
  }

  function computeVisualContext(hero){
    const base = computeHeroInfo(hero);
    const radius = Math.max(1, resolveVisualRadiusPx());
    const radiusSq = radius * radius;
    const now = getNow();
    if (!base) return { hero: null, hx: 0, hy: 0, radius, radiusSq, now };
    return { ...base, radius, radiusSq, now };
  }

  function isEntityAlwaysActive(ent, now){
    if (!ent) return false;
    if (ent._alwaysUpdate === true) return true;
    const awakeUntil = Number(ent._alwaysUpdateUntil);
    return Number.isFinite(awakeUntil) && awakeUntil > now;
  }

  function withinVisualRadius(entity, heroInfo, details){
    if (!entity) return false;
    if (!heroInfo || !heroInfo.hero) return true;
    if (entity === heroInfo.hero) return true;
    const tile = getTileSize();
    const w = Number(entity.w);
    const h = Number(entity.h);
    const width = Number.isFinite(w) && w > 0 ? w : tile;
    const height = Number.isFinite(h) && h > 0 ? h : tile;
    const ex = (Number(entity.x) || 0) + width * 0.5;
    const ey = (Number(entity.y) || 0) + height * 0.5;
    const dx = ex - heroInfo.hx;
    const dy = ey - heroInfo.hy;
    const distSq = (dx * dx + dy * dy);
    if (details && typeof details === 'object') details.distanceSq = distSq;
    return distSq <= heroInfo.radiusSq;
  }

  function refreshEntityActivity(heroInfo){
    const entities = window.G?.entities;
    if (!Array.isArray(entities)) return;
    const now = heroInfo?.now ?? getNow();
    let activeCount = 0;
    let inactiveCount = 0;
    const distInfo = {};
    for (const ent of entities){
      if (!ent) continue;
      let active = true;
      let distanceSq = null;
      if (heroInfo?.hero && ent !== heroInfo.hero){
        if (isEntityAlwaysActive(ent, now)) {
          active = true;
        } else {
          distInfo.distanceSq = null;
          active = withinVisualRadius(ent, heroInfo, distInfo);
          if (distInfo.distanceSq != null) distanceSq = distInfo.distanceSq;
        }
      }
      ent._inactive = !active;
      if (active) activeCount++; else inactiveCount++;
      const prev = activityLog.get(ent);
      if (prev !== active){
        activityLog.set(ent, active);
        const label = ent.name || ent.id || ent.tag || ent.kindName || ent.rigName || `entity@${entities.indexOf(ent)}`;
        let extra = '';
        if (distanceSq != null && heroInfo?.hero && ent !== heroInfo.hero){
          extra = ` (dist≈${Math.sqrt(distanceSq).toFixed(1)}px)`;
        }
        try {
          console.log(`[Puppet] ${active ? 'Activando' : 'Desactivando'} ${label}${extra}`);
        } catch (_) {}
      }
    }
    const summaryKey = `${activeCount}|${inactiveCount}`;
    if (summaryKey !== lastActivitySummary){
      lastActivitySummary = summaryKey;
      const radiusPx = heroInfo?.radius ? Math.round(heroInfo.radius) : 0;
      try {
        console.log(`[Puppet] Actividad: ${activeCount} activos, ${inactiveCount} inactivos (radio ${radiusPx}px).`);
      } catch (_) {}
    }
  }

  function resolveRigName(name){
    const key = typeof name === 'string' ? name : null;
    if (key && registry[key]) return key;
    if (key && !missingRigWarnings.has(key)){
      missingRigWarnings.add(key);
      try {
        console.warn(`[Puppet] rig "${key}" no registrado, usando fallback 'default'.`);
      } catch (_) {}
    }
    return 'default';
  }

  function registerRig(name, rig){
    if (!name || !rig) return;
    rigs.set(name, rig);
    registry[name] = rig;
  }

  function detach(entity){
    if (!entity || !entity.puppet) return;
    const puppet = entity.puppet;
    const idx = puppets.indexOf(puppet);
    if (idx >= 0) puppets.splice(idx, 1);
    if (puppet && typeof puppet.dispose === 'function'){
      try { puppet.dispose(); } catch (_) {}
    }
    delete entity.puppet;
    entity.rigOk = false;
  }

  function attach(entity, opts={}){
    if (!entity) return null;
    detach(entity);
    const resolvedRig = resolveRigName(opts.rig || opts.name || entity.rigName);
    const puppet = {
      entity,
      rigName: resolvedRig,
      scale: opts.scale ?? 1,
      z: opts.z ?? 0,
      zscale: opts.zscale ?? 1,
      data: opts.data || {},
      state: null,
      time: 0
    };
    puppet.dispose = function(){
      const rig = rigs.get(puppet.rigName) || registry[puppet.rigName];
      if (rig && typeof rig.dispose === 'function'){
        try { rig.dispose(puppet.state, puppet.entity); } catch (_) {}
      }
    };
    entity.puppet = puppet;
    if (entity) {
      entity.rigName = puppet.rigName;
      entity.rigOk = true;
    }
    puppets.push(puppet);
    needsSort = true;
    return puppet;
  }

  function bind(entity, rigName, opts={}){
    if (!entity) return null;
    const name = resolveRigName(rigName);
    const puppet = attach(entity, { ...opts, rig: name });
    const rig = registry[name];
    try {
      if (rig && typeof rig.create === 'function') {
        puppet.state = rig.create(entity, opts) || puppet.state || { e: entity };
      }
      entity.rigOk = true;
    } catch (err) {
      console.warn('[Puppet.bind] rig failed, using default', rigName, err);
      const fallbackName = 'default';
      puppet.rigName = fallbackName;
      entity.rigName = fallbackName;
      const fallback = registry[fallbackName];
      try {
        if (fallback && typeof fallback.create === 'function') {
          puppet.state = fallback.create(entity, opts) || { e: entity };
        } else {
          puppet.state = { e: entity };
        }
      } catch (_) {
        puppet.state = { e: entity };
      }
      entity.rigOk = true;
    }
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
    let rig = rigs.get(puppet.rigName);
    if (!rig) {
      puppet.rigName = 'default';
      rig = rigs.get('default') || registry.default;
      if (!rig) return null;
    }
    if (!puppet.state){
      if (typeof rig.create === 'function'){
        try {
          puppet.state = rig.create(puppet.entity) || {};
        } catch (err){
          console.warn('[PuppetAPI] rig.create', puppet.rigName, err);
          if (puppet.rigName !== 'default'){
            puppet.rigName = 'default';
            const fallback = rigs.get('default') || registry.default;
            if (fallback && typeof fallback.create === 'function'){
              try {
                puppet.state = fallback.create(puppet.entity) || {};
                rig = fallback;
              } catch (err2){
                console.warn('[PuppetAPI] default rig.create', err2);
                puppet.state = { e: puppet.entity };
                rig = fallback || rig;
              }
            } else {
              puppet.state = { e: puppet.entity };
              rig = fallback || rig;
            }
          } else {
            puppet.state = { e: puppet.entity };
          }
        }
      } else if (puppet.data && typeof puppet.data === 'object'){
        puppet.state = puppet.data;
      } else {
        puppet.state = {};
      }
    }
    return puppet.state;
  }

  if (!registry.default){
    const defaultRig = {
      create(e){ return { e }; },
      update(){},
      draw(ctx, _cam, entity, state){
        const target = entity || state?.e;
        if (!ctx || !target) return;
        const tile = getTileSize();
        const w = Number(target.w);
        const h = Number(target.h);
        const width = Number.isFinite(w) && w > 0 ? w : tile;
        const height = Number.isFinite(h) && h > 0 ? h : tile;
        const cx = (Number(target.x) || 0) + width * 0.5;
        const cy = (Number(target.y) || 0) + height * 0.5;
        const radius = Math.max(2, Math.min(width, height) * 0.25);
        ctx.save();
        ctx.fillStyle = target.teamColor || target.color || '#ccc';
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      },
      dispose(){}
    };
    registerRig('default', defaultRig);
  }

  function shouldUpdatePuppet(puppet, info, now, tileSize){
    if (!puppet || !puppet.entity) return false;
    if (!info) return true;
    const ent = puppet.entity;
    if (ent === (window.G?.player)) return true;
    if (ent._alwaysUpdate === true) return true;
    const awakeUntil = Number(ent._alwaysUpdateUntil);
    if (Number.isFinite(awakeUntil) && awakeUntil > now) return true;
    const w = Number.isFinite(ent.w) ? ent.w : tileSize;
    const h = Number.isFinite(ent.h) ? ent.h : tileSize;
    const ex = (Number(ent.x) || 0) + w * 0.5;
    const ey = (Number(ent.y) || 0) + h * 0.5;
    const dx = ex - info.hx;
    const dy = ey - info.hy;
    return (dx * dx + dy * dy) <= info.radiusSq;
  }

  function updateAll(state, dt){
    sortPuppets();
    const hero = window.G?.hero || window.G?.player || null;
    const context = computeVisualContext(hero);
    if (window.G) {
      if (hero) {
        window.G.__visualRadiusInfo = {
          radiusTiles: resolveVisualRadiusTiles(),
          radiusPx: context.radius,
          radiusSq: context.radiusSq,
          hx: context.hx,
          hy: context.hy,
          timestamp: context.now
        };
      } else {
        window.G.__visualRadiusInfo = null;
      }
    }
    refreshEntityActivity(context);
    for (const puppet of puppets){
      if (!puppet || !puppet.entity) continue;
      if (puppet.entity._inactive) continue;
      puppet.time += dt;
      const rig = rigs.get(puppet.rigName) || registry[puppet.rigName];
      if (!rig) continue;
      const rigState = ensureRigState(puppet);
      if (!rigState) continue;
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
    ctx.save();
    try {
      if (typeof window.applyWorldCamera === 'function') {
        window.applyWorldCamera(ctx);
      }
      for (const puppet of puppets){
        if (!puppet || !puppet.entity || puppet.entity._inactive) continue;
        drawOne(puppet, ctx, camera);
      }
    } finally {
      ctx.restore();
    }
  }

  function drawOne(puppet, ctx, cam){
    if (!puppet || !puppet.entity) return;
    if (puppet.entity._inactive) return;
    const rig = rigs.get(puppet.rigName) || registry[puppet.rigName];
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
    if (puppet.entity && puppet.entity._inactive) return;
    puppet.time += dt;
    const rig = rigs.get(puppet.rigName) || registry[puppet.rigName];
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
  PuppetNS.bind = bind;
  PuppetNS.detach = detach;
})();
