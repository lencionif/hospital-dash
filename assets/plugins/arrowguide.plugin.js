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
    _targetPoint: null,
    _mode: 'off',
    _pulse: 0,

    setEnabled(v) { this.enabled = !!v; },
    setTargetGetter(fn) { this._getter = (typeof fn === 'function') ? fn : null; },
    setTarget(entity) {
      if (!entity) return this.clearTarget();
      this._targetPoint = null;
      this._targetEid = entity.id || null;
      this._mode = entity.kind === (window.ENT?.BOSS) ? 'boss'
        : (entity.kind === (window.ENT?.CART) ? 'cart'
          : (entity.kind === (window.ENT?.DOOR) ? 'door' : 'patient'));
      return this;
    },
    pointToEntity(entity) { return this.setTarget(entity); },
    setTargetPoint(x, y, opts = {}) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return this.clearTarget();
      this._targetEid = null;
      this._targetPoint = { x, y, type: opts.type || 'custom' };
      this._mode = opts.type || 'custom';
      return this;
    },
    setTargetCoords(x, y, opts = {}) { return this.setTargetPoint(x, y, opts); },
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
      const door = findBossDoor(G);
      const boss = findBoss(G);
      const target = door && door.open ? door : boss || door;
      if (target) {
        this._mode = target.kind === (window.ENT?.BOSS) ? 'boss' : 'door';
        this._targetEid = target.id || null;
        this._targetPoint = null;
      } else {
        this.clearTarget();
      }
      return this;
    },
    clearTarget() {
      this._targetEid = null;
      this._targetPoint = null;
      this._mode = 'off';
      return this;
    },

    _computeDefault() {
      const G = window.G || {};
      if (!G.player) return null;
      const stats = G.stats || {};
      const patientsDone = ((stats.remainingPatients || 0) === 0) ||
        (window.PatientsAPI && typeof PatientsAPI.isAllDelivered === 'function' && PatientsAPI.isAllDelivered());

      if (this._targetPoint) {
        return { x: this._targetPoint.x, y: this._targetPoint.y, type: this._targetPoint.type || 'custom' };
      }

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

      if (patientsDone) {
        const cart = findEmergencyCart(G);
        const player = G.player;
        if (cart && !cart.dead && !cart.delivered) {
          const pushing = cart._grabbedBy === player || cart._pushedByEnt === player || closeTo(cart, player, 48);
          if (!pushing) {
            return { x: cart.x + cart.w * 0.5, y: cart.y + cart.h * 0.5, type: 'cart' };
          }
        }

        const door = findBossDoor(G);
        if (door && door.open) {
          return { x: door.x + door.w * 0.5, y: door.y + door.h * 0.5, type: 'door' };
        }

        const boss = findBoss(G);
        if (boss) {
          return { x: boss.x + boss.w * 0.5, y: boss.y + boss.h * 0.5, type: 'boss' };
        }
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
      const hue =
        point.type === 'boss' ? '#ff5d5d'
        : point.type === 'door' ? '#f6c744'
        : point.type === 'cart' ? '#2bcc8b'
        : '#2f81f7';

      const pulse = 0.75 + 0.25 * Math.sin(this._pulse * 4);
      ctx.save();
      ctx.translate(playerPos.x, playerPos.y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(rInner, 0);
      ctx.lineTo(rOuter, -8);
      ctx.lineTo(rOuter + 12, 0);
      ctx.lineTo(rOuter, 8);
      ctx.closePath();
      ctx.fillStyle = hue;
      ctx.globalAlpha = pulse;
      ctx.shadowColor = hue;
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.restore();

      if (!isOnScreen(targetPos, ctx.canvas)) {
        drawEdgeIndicator(ctx, hue, pulse, targetPos);
      }
    }
  };

  function findEntityById(G, eid) {
    if (!eid || !G) return null;
    if (typeof G.byId === 'function') {
      try { const e = G.byId(eid); if (e) return e; } catch (_) {}
    }
    return (G.entities || []).find(e => e && e.id === eid) || null;
  }

  function findEmergencyCart(G) {
    if (!G) return null;
    if (G.cart && !G.cart.dead) return G.cart;
    const entities = Array.isArray(G.entities) ? G.entities : [];
    return entities.find(e => e && e.kind === (window.ENT?.CART) && !e.dead && (e.cartType === 'er' || e.cart === 'urgencias' || e.tag === 'emergency')) || null;
  }

  function findBossDoor(G) {
    if (!G) return null;
    const entities = Array.isArray(G.entities) ? G.entities : [];
    return entities.find(e => e && e.kind === (window.ENT?.DOOR) && (e.bossDoor || e.bossGate || e.tag === 'bossDoor')) || null;
  }

  function findBoss(G) {
    if (!G) return null;
    if (G.boss && !G.boss.dead) return G.boss;
    const entities = Array.isArray(G.entities) ? G.entities : [];
    return entities.find(e => e && e.kind === (window.ENT?.BOSS) && !e.dead) || null;
  }

  function closeTo(a, b, dist) {
    if (!a || !b) return false;
    const ax = a.x + a.w * 0.5;
    const ay = a.y + a.h * 0.5;
    const bx = b.x + b.w * 0.5;
    const by = b.y + b.h * 0.5;
    const dx = ax - bx;
    const dy = ay - by;
    return (dx * dx + dy * dy) <= dist * dist;
  }

  function isOnScreen(pos, canvas) {
    if (!canvas || !pos) return true;
    return pos.x >= 0 && pos.y >= 0 && pos.x <= canvas.width && pos.y <= canvas.height;
  }

  function drawEdgeIndicator(ctx, color, alpha, targetPos) {
    if (!ctx || !ctx.canvas) return;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const cx = Math.min(Math.max(targetPos.x, 0), w);
    const cy = Math.min(Math.max(targetPos.y, 0), h);
    const padding = 18;
    const x = Math.max(padding, Math.min(cx, w - padding));
    const y = Math.max(padding, Math.min(cy, h - padding));
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3;
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
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