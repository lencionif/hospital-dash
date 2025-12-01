// assets/plugins/entities/hazards.entities.js
// Papelitos y aviones de papel usados por la supervisora.
(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.PAPER_PLANE === 'undefined') e.PAPER_PLANE = 21;
    if (typeof e.PAPER_NOTE === 'undefined') e.PAPER_NOTE = 22;
    return e;
  })(root.ENT || (root.ENT = {}));

  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 5;

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
  }

  function paperNoteAiUpdate(e, dt = 0) {
    if (!e || e.dead) return;
    if (e._culled) return;
    const hero = G.player;
    if (!hero) return;
    const AABB = root.AABB || ((a, b) => a && b && Math.abs(a.x - b.x) * 2 < (a.w + b.w) && Math.abs(a.y - b.y) * 2 < (a.h + b.h));
    if (AABB(e, hero)) {
      hero.status = hero.status || {};
      const timerKey = 'supervisorDebuffTimer';
      hero.status[timerKey] = { t: 4, type: e.debuffType || 'controls' };
      if (e.touchDamage && root.DamageAPI?.applyTouch) root.DamageAPI.applyTouch(e, hero);
      e._dead = true;
    }
  }

  function spawnPaperNote(x, y, opts = {}) {
    ensureCollections();
    const e = {
      id: root.genId ? root.genId() : `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.PAPER_NOTE,
      kindName: 'paper_note',
      x,
      y,
      w: 16,
      h: 16,
      solid: false,
      debuffType: opts.debuffType || 'hud',
      touchDamage: opts.touchDamage ?? 0,
      touchCooldown: 0,
      _touchCD: 0,
      dead: false,
      puppet: { rig: 'hazard_paper_note', z: HERO_Z, skin: 'default' },
      aiUpdate: paperNoteAiUpdate,
      update(dt) { paperNoteAiUpdate(this, dt); },
    };
    try { root.PuppetAPI?.attach?.(e, e.puppet); } catch (_) {}
    return e;
  }

  function paperPlaneAiUpdate(e, dt = 0) {
    if (!e || e.dead) return;
    if (e._culled) return;
    const hero = G.player;
    if (e.homingTime > 0 && hero) {
      e.homingTime -= dt;
      const dx = hero.x - e.x;
      const dy = hero.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      e.vx = (dx / dist) * e.speed;
      e.vy = (dy / dist) * e.speed;
      e.dir = Math.atan2(dy, dx);
    }
    e.x += (e.vx || 0) * dt;
    e.y += (e.vy || 0) * dt;
    e.life -= dt;
    const AABB = root.AABB || ((a, b) => a && b && Math.abs(a.x - b.x) * 2 < (a.w + b.w) && Math.abs(a.y - b.y) * 2 < (a.h + b.h));
    if (hero && AABB(e, hero)) {
      if (root.DamageAPI?.applyTouch) root.DamageAPI.applyTouch(e, hero);
      e._dead = true;
    }
    if (e.life <= 0) e._dead = true;
  }

  function spawnPaperPlane(shooter, target) {
    ensureCollections();
    const e = {
      id: root.genId ? root.genId() : `plane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.PAPER_PLANE,
      kindName: 'paper_plane',
      x: shooter?.x || 0,
      y: (shooter?.y || 0) - 8,
      w: 12,
      h: 12,
      dir: 0,
      vx: 0,
      vy: 0,
      solid: false,
      health: 1,
      touchDamage: 0.5,
      touchCooldown: 0.9,
      _touchCD: 0,
      homingTime: 1.2,
      life: 3.0,
      speed: 90,
      puppet: { rig: 'hazard_paper_plane', z: HERO_Z, skin: 'default' },
      aiUpdate: paperPlaneAiUpdate,
      update(dt) { paperPlaneAiUpdate(this, dt); },
    };
    try { root.PuppetAPI?.attach?.(e, e.puppet); } catch (_) {}
    return e;
  }

  root.Entities = root.Entities || {};
  root.Entities.PaperNote = { spawn: spawnPaperNote, aiUpdate: paperNoteAiUpdate };
  root.Entities.PaperPlane = { spawn: spawnPaperPlane, aiUpdate: paperPlaneAiUpdate };
})(window);
