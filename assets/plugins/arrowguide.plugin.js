// filename: arrowguide.plugin.js
// Flecha guía dinámica para Il Divo: Hospital Dash!
// - Dibuja una flecha suave directamente sobre el héroe apuntando al objetivo activo.
// - Calcula objetivos por prioridad (pastilla -> paciente -> carro -> boss) y colorea según tipo.
// - Se integra con el canvas HUD y escala igual que los rigs (zoom + escala de puppet).

(function(){
  'use strict';

  const TAU = Math.PI * 2;
  const COLORS = {
    pill: '#f8e825',
    patient: '#00ff66',
    cart: '#55ccff',
    boss: '#ff3333',
    door: '#55ccff',
    custom: '#f8e825'
  };
  const LERP_SPEED = 0.2;
  const MIN_LEN_FACTOR = 0.7;
  const MAX_LEN_FACTOR = 2.4;
  const THICKNESS_FACTOR = 0.35;
  const HEAD_BASE_MULT = 1.55;
  const HEAD_WIDTH_RATIO = 0.72;

  const ArrowGuide = {
    enabled: true,
    _getter: null,
    _targetEid: null,
    _targetPoint: null,
    _mode: 'off',
    _pulse: 0,
    _angle: 0,
    _hasAngle: false,

    setEnabled(v){ this.enabled = !!v; return this; },
    reset(){
      this._getter = null;
      this._targetEid = null;
      this._targetPoint = null;
      this._mode = 'off';
      this._hasAngle = false;
      return this;
    },
    setTargetGetter(fn){ this._getter = (typeof fn === 'function') ? fn : null; return this; },
    setTarget(entity){
      if (!entity) return this.clearTarget();
      this._targetPoint = null;
      this._targetEid = entity.id || null;
      this._mode = resolveTargetType(entity) || 'custom';
      return this;
    },
    pointToEntity(entity){ return this.setTarget(entity); },
    setTargetPoint(x, y, opts = {}){
      if (!Number.isFinite(x) || !Number.isFinite(y)) return this.clearTarget();
      this._targetEid = null;
      this._targetPoint = { x, y, type: opts.type || 'custom' };
      this._mode = this._targetPoint.type;
      return this;
    },
    setTargetCoords(x, y, opts = {}){ return this.setTargetPoint(x, y, opts); },
    setTargetByEntityId(eid){
      if (!eid) return this.clearTarget();
      const G = window.G || {};
      const entity = findEntityById(G, eid);
      return this.setTarget(entity || null);
    },
    setTargetByKeyName(keyName){
      if (!keyName) return this.clearTarget();
      let entity = null;
      if (window.PatientsAPI?.findByKeyName) {
        try { entity = window.PatientsAPI.findByKeyName(keyName); }
        catch (_) { entity = null; }
      }
      if (!entity && Array.isArray(window.G?.patients)) {
        entity = window.G.patients.find(p => p && p.keyName === keyName) || null;
      }
      if (!entity) return this.clearTarget();
      return this.setTarget(entity);
    },
    setTargetBossOrDoor(){
      const G = window.G || {};
      const door = findBossDoor(G);
      const boss = findBoss(G);
      const target = boss || door || null;
      if (target){
        this._mode = resolveTargetType(target);
        this._targetEid = target.id || null;
        this._targetPoint = null;
      } else {
        this.clearTarget();
      }
      return this;
    },
    clearTarget(){
      this._targetEid = null;
      this._targetPoint = null;
      this._mode = 'off';
      this._hasAngle = false;
      return this;
    },

    _resolveManualTarget(G){
      if (this._targetPoint){
        return { x: this._targetPoint.x, y: this._targetPoint.y, type: this._targetPoint.type || 'custom' };
      }
      if (this._targetEid){
        const ent = findEntityById(G, this._targetEid);
        if (ent){
          const c = centerPoint(ent);
          return { x: c.x, y: c.y, type: this._mode || resolveTargetType(ent) || 'custom' };
        }
      }
      return null;
    },

    _computeDefault(G){
      const hero = G?.player;
      if (!hero) return null;
      const heroCenter = centerPoint(hero);
      const manual = this._resolveManualTarget(G);
      if (manual) return manual;

      const directive = window.ObjectiveSystem?.getArrowTarget?.(G);
      if (directive) return directive;

      const carry = resolveCarry(G, hero);
      const pendingCount = countPendingPatients(G);
      const flow = getGameFlowState();
      const finalPhase = pendingCount <= 0 ? isFinalPhaseActive(flow, G) : false;

      if (!carry){
        const pill = closestMedicine(G, heroCenter);
        if (pill) return pill;
      }

      if (carry){
        const assigned = resolvePatientForCarry(G, carry);
        if (assigned){
          const c = centerPoint(assigned);
          return { x: c.x, y: c.y, type: 'patient' };
        }
      }

      if (pendingCount <= 0){
        if (finalPhase){
          const boss = findBoss(G);
          if (boss){
            const c = centerPoint(boss);
            return { x: c.x, y: c.y, type: 'boss' };
          }
        }
        const cart = findEmergencyCart(G);
        if (cart){
          const c = centerPoint(cart);
          return { x: c.x, y: c.y, type: 'cart' };
        }
        const boss = findBoss(G);
        if (boss){
          const c = centerPoint(boss);
          return { x: c.x, y: c.y, type: 'boss' };
        }
        const door = findBossDoor(G);
        if (door){
          const c = centerPoint(door);
          return { x: c.x, y: c.y, type: 'door' };
        }
      }

      return null;
    },

    update(dt){
      if (!Number.isFinite(dt)) dt = 0;
      this._pulse = (this._pulse + dt * 2.2) % TAU;
    },

    draw(ctx, camera, Gref){
      if (!this.enabled) return;
      const ctxRef = ctx;
      const canvas = ctxRef?.canvas;
      if (!ctxRef || !canvas) return;
      const G = Gref || window.G || {};
      const hero = G.player;
      if (!hero) return;

      const target = this._getter ? this._getter(G) : this._computeDefault(G);
      if (!target) { this._hasAngle = false; return; }

      const heroCenter = centerPoint(hero);
      const dx = (target.x ?? heroCenter.x) - heroCenter.x;
      const dy = (target.y ?? heroCenter.y) - heroCenter.y;
      const dist = Math.hypot(dx, dy);
      const heroRadius = Math.max(heroRadiusPx(hero), 8);
      const maxLenWorld = heroRadius * MAX_LEN_FACTOR;
      const minLenWorld = heroRadius * MIN_LEN_FACTOR;
      const worldLength = clamp(Math.min(dist, maxLenWorld), minLenWorld, maxLenWorld);
      const angleTarget = (dist > 0.0001) ? Math.atan2(dy, dx) : this._angle;
      const prev = this._hasAngle ? this._angle : angleTarget;
      this._angle = lerpAngle(prev, angleTarget, LERP_SPEED);
      this._hasAngle = true;

      const dpr = canvas.__hudDpr || (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
      const screenHero = toScreen(camera, canvas, heroCenter.x, heroCenter.y);
      const scale = resolveHeroScale(hero, camera);
      const lengthPx = worldLength * scale;
      const thickness = Math.max(3, heroRadius * THICKNESS_FACTOR * scale);
      const headSize = Math.max(HEAD_BASE_MULT * thickness, 12 * scale);
      const headWidth = headSize * HEAD_WIDTH_RATIO;
      if (!Number.isFinite(lengthPx) || lengthPx <= 0) return;

      const color = target.color || colorForType(target.type);
      const alpha = 0.95;
      const glow = Math.max(6, 8 * scale);

      ctxRef.save();
      ctxRef.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctxRef.translate(screenHero.x, screenHero.y);
      ctxRef.rotate(this._angle);
      ctxRef.fillStyle = color;
      ctxRef.globalAlpha = alpha;
      ctxRef.shadowColor = color;
      ctxRef.shadowBlur = glow;

      const bodyLength = Math.max(2, lengthPx - headSize);
      ctxRef.fillRect(0, -thickness * 0.5, bodyLength, thickness);
      ctxRef.beginPath();
      ctxRef.moveTo(bodyLength, -headWidth * 0.5);
      ctxRef.lineTo(bodyLength + headSize, 0);
      ctxRef.lineTo(bodyLength, headWidth * 0.5);
      ctxRef.closePath();
      ctxRef.fill();
      ctxRef.restore();
    }
  };

  function colorForType(type){
    if (!type) return COLORS.custom;
    const key = String(type).toLowerCase();
    if (key === 'door') return COLORS.cart;
    return COLORS[key] || COLORS.custom;
  }

  function heroRadiusPx(hero){
    const w = Math.max(8, Number(hero?.w) || 0);
    const h = Math.max(8, Number(hero?.h) || 0);
    return Math.max(w, h) * 0.5;
  }

  function resolveHeroScale(hero, camera){
    const zoom = Number.isFinite(camera?.zoom) && camera.zoom > 0 ? camera.zoom : 1;
    const puppetScale = (hero?.puppet?.scale ?? 1) * (hero?.puppet?.zscale ?? 1);
    const entScale = hero?.scale ?? 1;
    const rigScale = Number.isFinite(hero?.puppet?.state?.renderScale)
      ? hero.puppet.state.renderScale
      : 1;
    return clamp(zoom * puppetScale * entScale * rigScale, 0.35, 4);
  }

  function lerpAngle(prev, next, t){
    if (!Number.isFinite(prev)) prev = next;
    if (!Number.isFinite(next)) next = prev;
    const diff = normalizeAngle(next - prev);
    return prev + diff * clamp(t, 0, 1);
  }

  function normalizeAngle(a){
    if (!Number.isFinite(a)) return 0;
    while (a > Math.PI) a -= TAU;
    while (a <= -Math.PI) a += TAU;
    return a;
  }

  function clamp(v, min, max){
    if (!Number.isFinite(v)) return min;
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }

  function centerPoint(entity){
    if (!entity) return { x: 0, y: 0 };
    const w = Number(entity.w) || 0;
    const h = Number(entity.h) || 0;
    return { x: (Number(entity.x) || 0) + w * 0.5, y: (Number(entity.y) || 0) + h * 0.5 };
  }

  function distanceSq(ax, ay, bx, by){
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function closestMedicine(G, origin){
    let best = null;
    let bestD = Infinity;
    for (const pill of listActivePills(G)){
      const c = centerPoint(pill);
      const d2 = distanceSq(origin.x, origin.y, c.x, c.y);
      if (d2 < bestD){
        bestD = d2;
        best = { x: c.x, y: c.y, type: 'pill' };
      }
    }
    return best;
  }

  function resolveCarry(G, heroRef){
    const hero = heroRef || G?.player;
    if (hero?.currentPill) return hero.currentPill;
    if (hero?.inventory?.medicine) return hero.inventory.medicine;
    if (hero?.carry) return hero.carry;
    if (G?.carry) return G.carry;
    if (G?.currentPill) return G.currentPill;
    return null;
  }

  function resolvePatientForCarry(G, carry){
    if (!carry) return null;
    const byId = carry.targetPatientId ?? carry.forPatientId ?? carry.patientId;
    if (byId != null){
      const viaId = findPatientById(G, byId);
      if (viaId && !viaId.dead && !viaId.delivered) return viaId;
    }
    const key = carry.pairName || carry.patientKey;
    if (key){
      const viaKey = findPatientByKey(G, key);
      if (viaKey && !viaKey.dead && !viaKey.delivered) return viaKey;
    }
    if (carry.patientName){
      const patient = findPatientByName(G, carry.patientName);
      if (patient && !patient.dead && !patient.delivered) return patient;
    }
    return null;
  }

  function countPendingPatients(G){
    if (!G) return 0;
    const stats = G.stats || {};
    if (Number.isFinite(stats.remainingPatients)){
      const furious = Number.isFinite(stats.activeFuriosas) ? stats.activeFuriosas : 0;
      return Math.max(0, (stats.remainingPatients | 0) + (furious | 0));
    }
    if (Number.isFinite(G.patientsPending)){
      return Math.max(0, G.patientsPending | 0);
    }
    return listPendingPatients(G).length;
  }

  function listPendingPatients(G){
    const patients = Array.isArray(G?.patients) ? G.patients : [];
    return patients.filter(p => p && !p.dead && !p.attended && !p.delivered && !p.hidden);
  }

  function findEntityById(G, eid){
    if (!eid || !G) return null;
    if (typeof G.byId === 'function'){
      try {
        const ent = G.byId(eid);
        if (ent) return ent;
      } catch (_) {}
    }
    return (Array.isArray(G.entities) ? G.entities.find(e => e && e.id === eid) : null) || null;
  }

  function listActivePills(G){
    const pool = new Set();
    if (Array.isArray(G?.pills)){
      for (const pill of G.pills){
        if (pillIsActive(pill)) pool.add(pill);
      }
    }
    if (Array.isArray(G?.entities)){
      const kind = window.ENT?.PILL;
      for (const ent of G.entities){
        if (!pillIsActive(ent)) continue;
        if (kind != null && ent.kind !== kind) continue;
        pool.add(ent);
      }
    }
    return [...pool];
  }

  function pillIsActive(pill){
    if (!pill) return false;
    if (pill.dead || pill.collected || pill.disabled || pill.deactivated) return false;
    if (pill.hidden || pill.inactive) return false;
    return true;
  }

  function findPatientById(G, id){
    if (!id) return null;
    const viaEntity = findEntityById(G, id);
    if (viaEntity && viaEntity.kind === window.ENT?.PATIENT) return viaEntity;
    const patients = Array.isArray(G?.patients) ? G.patients : [];
    return patients.find((p) => p && p.id === id) || null;
  }

  function findPatientByKey(G, key){
    if (!key) return null;
    if (G?._patientsByKey instanceof Map && G._patientsByKey.has(key)){
      return G._patientsByKey.get(key) || null;
    }
    const patients = Array.isArray(G?.patients) ? G.patients : [];
    return patients.find((p) => p && p.keyName === key) || null;
  }

  function findPatientByName(G, name){
    if (!name) return null;
    const patients = Array.isArray(G?.patients) ? G.patients : [];
    return patients.find((p) => p && (p.name === name || p.displayName === name)) || null;
  }

  function findEmergencyCart(G){
    if (!G) return null;
    if (G.cart && !G.cart.dead) return G.cart;
    const entities = Array.isArray(G.entities) ? G.entities : [];
    return entities.find(e => e && e.kind === window.ENT?.CART && !e.dead && (e.cartType === 'er' || e.cart === 'urgencias' || e.tag === 'emergency')) || null;
  }

  function findBossDoor(G){
    if (!G) return null;
    const entities = Array.isArray(G.entities) ? G.entities : [];
    return entities.find(e => e && e.kind === window.ENT?.DOOR && (e.bossDoor || e.isBossDoor || e.tag === 'bossDoor')) || null;
  }

  function findBoss(G){
    if (!G) return null;
    if (G.boss && !G.boss.dead) return G.boss;
    const entities = Array.isArray(G.entities) ? G.entities : [];
    return entities.find(e => e && e.kind === window.ENT?.BOSS && !e.dead) || null;
  }

  function resolveTargetType(entity){
    if (!entity) return 'custom';
    const kind = entity.kind;
    const ENT = window.ENT || {};
    if (kind === ENT.BOSS) return 'boss';
    if (kind === ENT.CART) return 'cart';
    if (kind === ENT.DOOR) return 'door';
    if (kind === ENT.PATIENT) return 'patient';
    if (kind === ENT.PILL) return 'pill';
    return entity.type || entity.tag || 'custom';
  }

  function getGameFlowState(){
    try { return window.GameFlowAPI?.getState?.() || null; }
    catch (_) { return null; }
  }

  function isFinalPhaseActive(flow, G){
    if (flow?.finalDelivered || flow?.victory) return true;
    if (flow?.bossDoorOpened && (G?.cart?.delivered || G?.cart?.finalPillGiven)) return true;
    if (G?.cart?.delivered) return true;
    if (G?.boss?.finalPillGiven) return true;
    return false;
  }

  function toScreen(camera, canvas, x, y){
    const cam = camera || { x: 0, y: 0, zoom: 1 };
    const zoom = cam.zoom || 1;
    const dpr = canvas && canvas.__hudDpr ? canvas.__hudDpr : (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1);
    if (typeof window.bridgeToScreen === 'function'){
      const pt = window.bridgeToScreen(cam, canvas, x, y) || { x, y };
      return { x: pt.x / dpr, y: pt.y / dpr };
    }
    const width = canvas ? (canvas.width || 0) / dpr : 0;
    const height = canvas ? (canvas.height || 0) / dpr : 0;
    const cx = width * 0.5;
    const cy = height * 0.5;
    return {
      x: (x - cam.x) * zoom + cx,
      y: (y - cam.y) * zoom + cy
    };
  }

  window.ArrowGuide = ArrowGuide;
})();
