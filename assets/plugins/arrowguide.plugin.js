// filename: arrowguide.plugin.js
// Flecha direccional tipo GTA alrededor del protagonista.
// - Apunta al paciente correcto si llevas su pastilla.
// - Cuando no quedan pacientes, apunta al Boss.
// - Se dibuja sobre el mundo y bajo el HUD (llámala justo antes de drawHUD()).

(function () {
  const ArrowGuide = {
    enabled: true,
    _getter: null,
    _targetEid: null,
    _mode: 'off',
    _pulse: 0,

    setEnabled(v) { this.enabled = !!v; },
    setTargetGetter(fn) { this._getter = (typeof fn === 'function') ? fn : null; },
    setTarget(entity) {
      if (!entity) return this.clearTarget();
      this._targetEid = entity.id || null;
      this._mode = entity.kind === (window.ENT?.BOSS) ? 'boss' : 'patient';
      return this;
    },
    setTargetByEntityId(eid) {
      if (!eid) return this.clearTarget();
      const G = window.G || {};
      const entity = findEntityById(G, eid);
      return this.setTarget(entity || null);
    },
    setTargetByKeyName(keyName) {
      if (!keyName) return this.clearTarget();
      let entity = null;
      if (window.PatientsAPI && typeof PatientsAPI.findByKeyName === 'function') {
        entity = PatientsAPI.findByKeyName(keyName);
      }
      if (!entity && Array.isArray(window.G?.patients)) {
        entity = window.G.patients.find(p => p && p.keyName === keyName);
      }
      if (!entity) {
        this.clearTarget();
        return null;
      }
      this.setTarget(entity);
      return entity;
    },
    setTargetBossOrDoor() {
      const G = window.G || {};
      const door = (G.entities || []).find(e => e && e.kind === (window.ENT?.DOOR) && (e.bossDoor || e.bossGate || e.tag === 'bossDoor'));
      const boss = G.boss || (G.entities || []).find(e => e && e.kind === (window.ENT?.BOSS));
      const target = door && door.open ? door : boss || door;
      if (target) {
        this._mode = target.kind === (window.ENT?.BOSS) ? 'boss' : 'door';
        this._targetEid = target.id || null;
      } else {
        this.clearTarget();
      }
      return this;
    },
    clearTarget() {
      this._targetEid = null;
      this._mode = 'off';
      return this;
    },

    _computeDefault() {
      const G = window.G || {};
      if (!G.player) return null;
      const stats = G.stats || {};
      const patientsDone = ((stats.remainingPatients || 0) === 0) ||
        (window.PatientsAPI && typeof PatientsAPI.isAllDelivered === 'function' && PatientsAPI.isAllDelivered());

      if (this._targetEid) {
        const ent = findEntityById(G, this._targetEid);
        if (ent) {
          return { x: ent.x + ent.w * 0.5, y: ent.y + ent.h * 0.5, type: this._mode === 'boss' ? 'boss' : 'patient' };
        }
      }

      if (G.carry && !patientsDone) {
        const key = G.carry.pairName || G.carry.pillKey;
        if (key) {
          const ent = this.setTargetByKeyName(key);
          if (ent) return this._computeDefault();
        }
        if (Array.isArray(G.patients)) {
          const found = G.patients.find(p => p && p.name === G.carry.patientName);
          if (found) return { x: found.x + found.w * 0.5, y: found.y + found.h * 0.5, type: 'patient' };
        }
      }

      if (!patientsDone && Array.isArray(G.patients) && G.patients.length) {
        const px = G.player.x + G.player.w * 0.5;
        const py = G.player.y + G.player.h * 0.5;
        let best = null;
        let bestD = Infinity;
        for (const pat of G.patients) {
          if (!pat || pat.attended || pat.dead) continue;
          const cx = pat.x + pat.w * 0.5;
          const cy = pat.y + pat.h * 0.5;
          const dx = cx - px;
          const dy = cy - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD) {
            bestD = d2;
            best = { x: cx, y: cy, type: 'patient' };
          }
        }
        if (best) return best;
      }

      const door = (G.entities || []).find(e => e && e.kind === (window.ENT?.DOOR) && (e.bossDoor || e.bossGate || e.tag === 'bossDoor'));
      if (patientsDone && door && door.open) {
        return { x: door.x + door.w * 0.5, y: door.y + door.h * 0.5, type: 'boss' };
      }
      if (patientsDone && G.boss) {
        return { x: G.boss.x + G.boss.w * 0.5, y: G.boss.y + G.boss.h * 0.5, type: 'boss' };
      }
      return null;
    },

    update(dt) {
      this._pulse += (dt || 0);
    },

    draw(ctx, camera, Gref) {
      if (!this.enabled) return;
      const G = Gref || window.G || {};
      const player = G.player;
      if (!ctx || !player) return;

      const point = this._getter ? this._getter() : this._computeDefault();
      if (!point) return;

      const cam = camera || { x: 0, y: 0, zoom: 1 };
      const playerPos = toScreen(cam, ctx.canvas, player.x + player.w * 0.5, player.y + player.h * 0.5);
      const targetPos = toScreen(cam, ctx.canvas, point.x, point.y);
      const ang = Math.atan2(targetPos.y - playerPos.y, targetPos.x - playerPos.x);

      const rOuter = 40;
      const rInner = 24;
      const col = (point.type === 'boss') ? '#ff5d5d' : '#2f81f7';

      ctx.save();
      ctx.translate(playerPos.x, playerPos.y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(rInner, 0);
      ctx.lineTo(rOuter, -8);
      ctx.lineTo(rOuter + 12, 0);
      ctx.lineTo(rOuter, 8);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.restore();
    }
  };

  function findEntityById(G, eid) {
    if (!eid || !G) return null;
    if (typeof G.byId === 'function') {
      try { const e = G.byId(eid); if (e) return e; } catch (_) {}
    }
    return (G.entities || []).find(e => e && e.id === eid) || null;
  }

  function toScreen(camera, canvas, x, y) {
    const cam = camera || { x: 0, y: 0, zoom: 1 };
    const zoom = cam.zoom || 1;
    const cx = canvas ? canvas.width * 0.5 : 0;
    const cy = canvas ? canvas.height * 0.5 : 0;
    return {
      x: (x - cam.x) * zoom + cx,
      y: (y - cam.y) * zoom + cy
    };
  }

  window.ArrowGuide = ArrowGuide;
})();