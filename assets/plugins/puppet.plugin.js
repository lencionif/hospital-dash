// puppet.plugin.js - Motor PuppetAPI con registro de rigs chibi
(() => {
  'use strict';

  const W = window;
  const TAU = Math.PI * 2;
  const rigs = new Set();
  const registry = new Map();
  const missingLogged = new Set();
  let auditDone = false;
  let lastAuditCounts = null;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ------------------------------------------------------------
  // Registro y ciclo de vida
  // ------------------------------------------------------------
  function registerRig(id, impl) {
    if (!id || !impl) return;
    registry.set(String(id), impl);
  }

  function createInstance(entity, opts = {}) {
    if (!entity || !opts.rig) return null;
    const rigId = String(opts.rig);
    const def = registry.get(rigId);
    if (!def) {
      if (!missingLogged.has(rigId)) {
        console.warn(`[RigError] No rig for kind="${entity.kind || entity.tag || rigId}"`);
        missingLogged.add(rigId);
      }
      return null;
    }
    const state = (typeof def.create === 'function') ? (def.create(entity, opts) || {}) : {};
    const inst = {
      id: rigId,
      host: entity,
      def,
      state,
      z: opts.z || 0,
      scale: opts.scale || 1,
      data: opts.data || {},
      t: 0,
    };
    rigs.add(inst);
    return inst;
  }

  function attach(entity, opts = {}) {
    if (!entity) return null;
    const inst = createInstance(entity, opts);
    if (!inst) return null;
    entity._rig = inst;
    entity.puppetState = inst.state;
    entity.puppet = Object.assign({}, opts, { rig: opts.rig });
    return inst;
  }

  function detach(entity) {
    if (!entity?._rig) return;
    rigs.delete(entity._rig);
    delete entity._rig;
    delete entity.puppetState;
  }

  // ------------------------------------------------------------
  // Auditoría ligera
  // ------------------------------------------------------------
  function auditRigsOnce() {
    if (auditDone) return;
    const list = W.G?.entities;
    if (!Array.isArray(list)) return;
    auditDone = true;
    let ok = 0, missing = 0;
    for (const e of list) {
      if (!e?.puppet || !e.puppet.rig) continue;
      if (registry.has(e.puppet.rig)) ok++; else missing++;
    }
    lastAuditCounts = { ok, missing };
    console.info(`[Puppet] Auditoría rigs: OK=${ok}, missing=${missing}`);
  }

  // ------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------
  function dirToFace(rad) {
    const a = ((rad % TAU) + TAU) % TAU;
    if (a > Math.PI * 0.25 && a <= Math.PI * 0.75) return 'S';
    if (a > Math.PI * 0.75 && a <= Math.PI * 1.25) return 'W';
    if (a > Math.PI * 1.25 && a <= Math.PI * 1.75) return 'N';
    return 'E';
  }

  function isCulled(host, camera) {
    if (!host) return true;
    if (host._culled === true) return true;
    const cam = camera || W.camera || { x: 0, y: 0, zoom: 1 };
    const cullingPx = W.G?.cullingPx || (W.G?.culling || 0) * (W.TILE_SIZE || W.TILE || 32);
    if (!cullingPx) return false;
    const dx = (host.x + host.w * 0.5) - cam.x;
    const dy = (host.y + host.h * 0.5) - cam.y;
    return (dx * dx + dy * dy) > (cullingPx * cullingPx);
  }

  // ------------------------------------------------------------
  // Ciclo
  // ------------------------------------------------------------
  function updateRig(inst, dt = 0) {
    if (!inst || !inst.def) return;
    if (isCulled(inst.host, W.camera)) return;
    inst.t += dt;
    try {
      inst.def.update?.(inst.state, inst.host, dt, inst);
    } catch (err) {
      console.warn('[Puppet] update rig error', inst.id, err);
    }
  }

  function update(target, dt) {
    auditRigsOnce();
    if (typeof target === 'number' && dt === undefined) {
      const delta = target;
      rigs.forEach(r => updateRig(r, delta));
      return;
    }
    if (!target) return;
    updateRig(target, dt || 0);
  }

  function draw(rig, ctx, camera) {
    if (!rig || !ctx || !rig.host) return;
    if (isCulled(rig.host, camera)) return;
    try {
      rig.def?.draw?.(ctx, camera || { x: 0, y: 0, zoom: 1 }, rig.host, rig.state, rig);
    } catch (err) {
      console.warn('[Puppet] draw rig error', rig.id, err);
    }
  }

  function toggleDebug() {
    const next = !W.PuppetAPI?._debugFlag;
    W.PuppetAPI._debugFlag = next;
    rigs.forEach(r => r.debug = next);
  }

  // Compatibilidad con rigs antiguos basados en cabezas PNG (ya no se usa)
  function setHeroHead() { return null; }

  W.addEventListener('keydown', (e) => {
    if (e.code === 'KeyJ') toggleDebug();
  });

  W.PuppetAPI = {
    registerRig,
    attach,
    detach,
    update,
    draw,
    dirToFace,
    setHeroHead,
    toggleDebug,
    _audit: () => lastAuditCounts,
    _registry: registry,
  };
})();
