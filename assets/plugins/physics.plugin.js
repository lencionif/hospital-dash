// physics.plugin.js
(() => {
  'use strict';

  const MASS = {
    HERO: 1.0,
    CART: 3.5,
    RAT: 0.5,
    MOSQUITO: 0.2,
    NPC: 1.1,
    PILL: 0.1
  };

  const PHYS = {
    restitution: 0.32,
    friction: 0.028,
    slideFriction: 0.012,
    cartRestitution: 0.94,
    cartSlideMu: 0.006,
    cartPushBoost: 2.4,
    cartPushMassFactor: 0.18,
    cartMinSpeed: 380,
    cartMaxSpeed: 1080,
    crushImpulse: 420,
    hurtImpulse: 45,
    explodeImpulse: 170,
    fireImpulse: 240,
    fireMinMass: 2.5,
    fireCooldown: 0.6,
    fireTTL: 6.0,
    fireExtraTTL: 4.0,
    fireDamage: 0.5,
    fireTick: 0.4,
    slipCrashSpeed: 120,
    shakeImpulse: 105,
    shakeDuration: 0.55,
    shakeMax: 18,
    slowMoImpulse: 160,
    slowMoScale: 0.45,
    slowMoDuration: 0.75,
    slowMoRelease: 0.55,
    ragdollImpulse: 140,
    ragdollDuration: 1.1,
    ragdollCooldown: 0.65,
    cartProfiles: {
      er:   { mass: 1.0, restitution: 0.98, mu: 0.003,  slideFriction: 0.0035, drag: 0.010, vmax: 24 },
      med:  { mass: 1.4, restitution: 0.9,  mu: 0.008,  slideFriction: 0.0085, drag: 0.014, vmax: 19 },
      food: { mass: 1.9, restitution: 0.78, mu: 0.014, slideFriction: 0.015,  drag: 0.020, vmax: 16 }
    },
    bedProfiles: {
      bed:         { mass: 2.0, restitution: 0.45, friction: 0.88, vmax: 7 },
      bed_patient: { mass: 2.0, restitution: 0.35, friction: 0.88, vmax: 7 }
    },
    pushMultipliers: {
      base: 1.25,
      enrique: 2.2,
      roberto: 1.65,
      francesco: 1.45,
      syringeRed: 2.2
    }
  };

  const DEFAULTS = { ...PHYS };

  function createPhysics(options = {}) {
    const CFG = Object.assign({}, DEFAULTS, options || {});
    let G = null;
    let TILE = window.TILE_SIZE || 32;
    let lastFireSpawn = -Infinity;
    let loggedSummary = false;

    const clamp = (v, min, max) => (v < min ? min : (v > max ? max : v));
    const isDebugPhysics = () => {
      try {
        if (window.DEBUG_PUSH || window.DEBUG_FORCE_ASCII) return true;
        return typeof window.location?.search === 'string' && window.location.search.includes('map=debug');
      } catch (_) {
        return false;
      }
    };

    const nowSeconds = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? (performance.now() / 1000)
      : (Date.now() / 1000);

    function isCartEntity(ent){
      if (!ent) return false;
      const ENT = (typeof window !== 'undefined' && window.ENT) ? window.ENT : null;
      if (ent.kind === 5) return true;
      if (ENT && typeof ENT.CART === 'number' && ent.kind === ENT.CART) return true;
      if (ent.cartType || ent._tag === 'cart' || ent.type === 'cart') return true;
      const tag = (ent.tag || '').toString().toLowerCase();
      if (tag.includes('cart') || tag.includes('carro')) return true;
      const rig = (ent.rigName || ent.puppet?.rigName || '').toString().toLowerCase();
      if (rig.includes('cart')) return true;
      const kindName = (ent.kindName || ent.kind || '').toString().toLowerCase();
      return kindName.includes('cart') || kindName.includes('carro');
    }

    function resolveRestitution(ent){
      if (!ent) return 0;
      let base = 0;
      if (Number.isFinite(ent.rest)) base = Math.max(base, ent.rest);
      if (Number.isFinite(ent.restitution)) base = Math.max(base, ent.restitution);
      if (isCartEntity(ent)){
        const desired = CFG.cartRestitution ?? DEFAULTS.cartRestitution ?? 0;
        if (desired > base){
          base = desired;
          ent.rest = desired;
          if (!Number.isFinite(ent.restitution) || ent.restitution < desired) ent.restitution = desired;
        }
      }
      return base;
    }

    const updateTileSize = () => {
      TILE = window.TILE_SIZE || TILE;
    };

    const AABB = (a, b) =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

    const nearAABB = (a, b, m = 10) =>
      a.x < b.x + b.w + m && a.x + a.w > b.x - m &&
      a.y < b.y + b.h + m && a.y + a.h > b.y - m;

    function isWall(px, py, w, h){
      if (typeof window.isWallAt === 'function') return window.isWallAt(px, py, w, h);
      const x1 = Math.floor(px / TILE);
      const y1 = Math.floor(py / TILE);
      const x2 = Math.floor((px + w) / TILE);
      const y2 = Math.floor((py + h) / TILE);
      if (!G || !G.map || x1 < 0 || y1 < 0 || x2 >= G.mapW || y2 >= G.mapH) return true;
      return G.map[y1][x1] === 1 || G.map[y1][x2] === 1 || G.map[y2][x1] === 1 || G.map[y2][x2] === 1;
    }

    function resolveOverlapPush(e, o){
      const ax1 = e.x, ay1 = e.y, ax2 = e.x + e.w, ay2 = e.y + e.h;
      const bx1 = o.x, by1 = o.y, bx2 = o.x + o.w, by2 = o.y + o.h;
      const overlapX = (ax2 - bx1 < bx2 - ax1) ? ax2 - bx1 : -(bx2 - ax1);
      const overlapY = (ay2 - by1 < by2 - ay1) ? ay2 - by1 : -(by2 - ay1);
      if (Math.abs(overlapX) < Math.abs(overlapY)){
        e.x -= overlapX;
        if (e.pushable && o.pushable){ const t = e.vx; e.vx = o.vx; o.vx = t; } else { e.vx = 0; }
      } else {
        e.y -= overlapY;
        if (e.pushable && o.pushable){ const t = e.vy; e.vy = o.vy; o.vy = t; } else { e.vy = 0; }
      }
    }

    function clampOutOfWalls(e){
      let tries = 12;
      const STEP = 1.0;
      while (tries-- > 0 && isWall(e.x, e.y, e.w, e.h)){
        if (!isWall(e.x + STEP, e.y, e.w, e.h)){ e.x += STEP; continue; }
        if (!isWall(e.x - STEP, e.y, e.w, e.h)){ e.x -= STEP; continue; }
        if (!isWall(e.x, e.y + STEP, e.w, e.h)){ e.y += STEP; continue; }
        if (!isWall(e.x, e.y - STEP, e.w, e.h)){ e.y -= STEP; continue; }
        if (!isFinite(e._clampGrow)) e._clampGrow = 1;
        e._clampGrow = Math.min(e._clampGrow + 0.5, TILE * 0.5);
        const g = e._clampGrow;
        e.x += (Math.random() < 0.5 ? -g : g);
        e.y += (Math.random() < 0.5 ? -g : g);
      }
      if (!isWall(e.x, e.y, e.w, e.h)) { e._lastSafeX = e.x; e._lastSafeY = e.y; }
    }

    function snapInsideMap(e){
      if (!G || !e) return;
      const inBounds = (tx, ty) => tx >= 0 && ty >= 0 && tx < G.mapW && ty < G.mapH;
      if (inBounds(Math.floor(e.x / TILE), Math.floor(e.y / TILE)) &&
          !isWall(e.x, e.y, e.w, e.h)) return;
      if (typeof e._lastSafeX === 'number' && typeof e._lastSafeY === 'number'){
        e.x = e._lastSafeX; e.y = e._lastSafeY; e.vx = e.vy = 0;
        if (!isWall(e.x, e.y, e.w, e.h)) return;
      }
      const cx = Math.max(0, Math.min(G.mapW - 1, Math.floor(e.x / TILE)));
      const cy = Math.max(0, Math.min(G.mapH - 1, Math.floor(e.y / TILE)));
      for (let r = 0; r < 6; r++){
        for (let dy = -r; dy <= r; dy++){
          for (let dx = -r; dx <= r; dx++){
            const tx = cx + dx, ty = cy + dy;
            if (!inBounds(tx, ty)) continue;
            if (G.map[ty][tx] === 0){ e.x = tx * TILE + 2; e.y = ty * TILE + 2; e.vx = e.vy = 0; return; }
          }
        }
      }
    }

    function cartImpactDamage(a, b){
      const cart = (a && a.kind === 5) ? a : (b && b.kind === 5 ? b : null);
      if (!cart) return;
      const other = (cart === a) ? b : a;
      const spdC = Math.hypot(cart.vx || 0, cart.vy || 0);
      const rel = Math.hypot((cart.vx || 0) - (other.vx || 0), (cart.vy || 0) - (other.vy || 0));
      const nearW = isWall(other.x - 1, other.y - 1, other.w + 2, other.h + 2);
      const MIN_ENEMY_KILL_SPEED = 6;
      const MIN_PLAYER_HURT_SPEED = 22;
      if (spdC <= 0.01 && rel <= 0.01 && !nearW) return;
      if (G && other === G.player){
        if (spdC > MIN_PLAYER_HURT_SPEED || rel > MIN_PLAYER_HURT_SPEED){
          if (rel > 360) { window.damagePlayer?.(cart, 6); return; }
          if (rel > 240) { window.damagePlayer?.(cart, 2); return; }
          if (rel > 120) { window.damagePlayer?.(cart, 1); return; }
        }
        return;
      }
      if (other.static) return;
      if (spdC > MIN_ENEMY_KILL_SPEED || rel > MIN_ENEMY_KILL_SPEED || nearW){
        const meta = {
          via: 'cart',
          impactSpeed: Math.max(spdC, rel),
          killerTag: (cart._lastPushedBy || null),
          killerId:  (cart._lastPushedId || null),
          killerRef: (cart._pushedByEnt || cart._grabbedBy || null)
        };
        window.killEntityGeneric ? window.killEntityGeneric(other, meta) : (other.dead = true);
      }
    }

    function inverseMass(e){
      if (!e) return 0;
      if (e.invMass != null) return e.invMass;
      const mass = e.mass != null ? e.mass : 1;
      return 1 / Math.max(0.0001, mass);
    }

    function massOf(e){
      if (!e) return 0;
      if (typeof e.mass === 'number' && Number.isFinite(e.mass)) return e.mass;
      if (G && e === G.player) return MASS.HERO;
      if (isCartEntity(e)) return MASS.CART;
      const ENT = (typeof window !== 'undefined' && window.ENT) ? window.ENT : null;
      if (ENT && typeof e.kind === 'number'){
        if (ENT.PLAYER != null && e.kind === ENT.PLAYER) return MASS.HERO;
        if (ENT.CART != null && e.kind === ENT.CART) return MASS.CART;
        if (ENT.NPC != null && e.kind === ENT.NPC) return MASS.NPC;
      }
      const kindName = (e.kindName || e.kind || e.type || e.role || '').toString().toLowerCase();
      if (kindName.includes('npc')) return MASS.NPC;
      if (kindName.includes('cart') || kindName.includes('carro')) return MASS.CART;
      if (kindName.includes('mosquito')) return MASS.MOSQUITO;
      if (kindName.includes('rat') || kindName.includes('rata')) return MASS.RAT;
      if (kindName.includes('pill') || kindName.includes('pastilla')) return MASS.PILL;
      const inv = inverseMass(e);
      if (!isFinite(inv) || inv <= 0) return e && e.static ? Infinity : 0;
      return 1 / inv;
    }

    function maybeSpawnImpactFire(x, y, impulse, meta = {}){
      const fireAPI = window.FireAPI || window.Entities?.Fire;
      if (!fireAPI) return;
      const spawnImpact = typeof fireAPI.spawnImpact === 'function' ? fireAPI.spawnImpact : null;
      const spawn = typeof fireAPI.spawn === 'function' ? fireAPI.spawn : null;
      if (!spawnImpact && !spawn) return;
      const minImpulse = CFG.fireImpulse ?? DEFAULTS.fireImpulse ?? 0;
      if (!(impulse >= minImpulse)) return;
      const cooldown = CFG.fireCooldown ?? DEFAULTS.fireCooldown ?? 0;
      const now = nowSeconds();
      if (cooldown > 0 && now - lastFireSpawn < cooldown) return;
      lastFireSpawn = now;
      if (spawnImpact){
        spawnImpact.call(fireAPI, x, y, impulse, Object.assign({ threshold: minImpulse }, meta));
        return;
      }
      if (spawn){
        const base = Math.max(minImpulse, 1);
        const extraRatio = Math.max(0, (impulse - minImpulse) / base);
        const ttl = (meta.ttl ?? (CFG.fireTTL ?? DEFAULTS.fireTTL ?? 4)) +
          (CFG.fireExtraTTL ?? DEFAULTS.fireExtraTTL ?? 0) * Math.min(extraRatio, 3);
        const damage = meta.damage ?? ((CFG.fireDamage ?? DEFAULTS.fireDamage ?? 0.5) * (1 + Math.min(extraRatio, 2) * 0.5));
        const tick = meta.tick ?? (CFG.fireTick ?? DEFAULTS.fireTick ?? 0.4);
        spawn.call(fireAPI, x, y, Object.assign({}, meta, { ttl, damage, tick, impulse }));
      }
    }

    function handleSlipImpact(e, axis, speed, contactX, contactY){
      if (!e || !G) return;
      if (!(e._wetSlipTimer > 0)) return;
      const threshold = CFG.slipCrashSpeed ?? DEFAULTS.slipCrashSpeed ?? 120;
      if (!(speed >= threshold)) return;
      if (G.player && e === G.player){
        const src = { x: (contactX ?? (e.x + e.w * 0.5)) - 8, y: (contactY ?? (e.y + e.h * 0.5)) - 8, w: 16, h: 16 };
        try { window.damagePlayer?.(src, 1); }
        catch (_) { window.damagePlayer?.(e, 1); }
      }
      try { window.AudioAPI?.play?.('slip_bump', { at: { x: contactX ?? (e.x + e.w * 0.5), y: contactY ?? (e.y + e.h * 0.5) }, volume: 0.6 }); }
      catch (_) {}
      try {
        window.LOG?.debug?.(`[Hazards] Golpe por resbalón eje ${axis} v=${speed.toFixed(1)}`);
      } catch (_) {}
      e._wetSlipTimer = 0;
      e.vx *= 0.2;
      e.vy *= 0.2;
    }

    function notifyImpactEffects(x, y, impulse, meta = {}){
      if (!(impulse > 0)) return;
      const fx = window.CineFX;
      if (!fx || typeof fx.onPhysicsImpact !== 'function') return;
      const payload = Object.assign({
        x,
        y,
        impulse,
        impact: impulse
      }, meta || {});
      try {
        fx.onPhysicsImpact(payload);
      } catch (err){
        if (window.DEBUG_FORCE_ASCII) console.warn('[Physics] CineFX impact error', err);
      }
    }

    function applyImpulse(e, ix, iy){
      if (!e || e.static) return;
      const limit = (CFG.crushImpulse ?? DEFAULTS.crushImpulse) / Math.max(1, e.mass || 1);
      const mag = Math.hypot(ix, iy);
      let fx = ix;
      let fy = iy;
      if (mag > limit && mag > 0){
        const scale = limit / mag;
        fx *= scale;
        fy *= scale;
      }
      e.vx = (e.vx || 0) + fx;
      e.vy = (e.vy || 0) + fy;
    }

    function moveWithCollisions(e, dt){
      if (!e) return;
      const sub = 4;
      const wantsSlide = (e.slide != null) ? !!e.slide : isCartEntity(e);
      const muSource = (e.mu != null) ? e.mu : (wantsSlide ? (CFG.cartSlideMu ?? 0) : 0);
      const mu = clamp(muSource, 0, 0.95);
      const baseFrictionValue = (typeof e._frictionOverride === 'number')
        ? clamp(e._frictionOverride, 0, 0.95)
        : (typeof e.friction === 'number'
          ? clamp(e.friction, 0, 0.95)
          : (CFG.friction ?? 0.02));
      const base = 1 - baseFrictionValue;
      const fr = base * (1 - mu);
      const wr = Math.max(CFG.restitution, resolveRestitution(e));
      const slideFrictionValue = (typeof e._slideFrictionOverride === 'number')
        ? clamp(e._slideFrictionOverride, 0.001, 0.95)
        : (typeof e.slideFriction === 'number'
          ? clamp(e.slideFriction, 0.001, 0.95)
          : ((CFG.slideFriction ?? CFG.friction) ?? 0.02));
      const slideCoef = 1 - slideFrictionValue;
      const entMass = massOf(e);
      const minFireMass = CFG.fireMinMass ?? DEFAULTS.fireMinMass ?? 0;
      const allowFireSpawn = !e.static && (Number.isFinite(entMass) ? entMass : minFireMass) >= minFireMass;
      let nx = e.x, ny = e.y;
      for (let i = 0; i < sub; i++){
        const vxStep = e.vx || 0;
        const vyStep = e.vy || 0;
        const sx = vxStep / sub;
        const sy = vyStep / sub;
        const pad = (G && e === G.player) ? 6 : 4;
        const cw = Math.max(2, (e.w - pad * 2));
        const ch = Math.max(2, (e.h - pad * 2));
        const tryX = nx + sx;
        if (!isWall(tryX + pad, ny + pad, cw, ch)){
          nx = tryX;
        } else {
          const absVx = Math.abs(vxStep);
          const massFactor = Number.isFinite(entMass) ? Math.max(entMass, 1) : Math.max(minFireMass, 1);
          if (allowFireSpawn && absVx > 0.01){
            const contactX = vxStep > 0 ? nx + e.w : nx;
            const contactY = ny + e.h * 0.5;
            maybeSpawnImpactFire(contactX, contactY, absVx * massFactor, {
              type: 'wall',
              axis: 'x',
              normal: { x: vxStep > 0 ? 1 : -1, y: 0 },
              entity: e
            });
          }
          if (absVx > 0.01){
            const contactX = vxStep > 0 ? nx + e.w : nx;
            const contactY = ny + e.h * 0.5;
            notifyImpactEffects(contactX, contactY, absVx * massFactor, {
              type: 'wall',
              axis: 'x',
              normal: { x: vxStep > 0 ? 1 : -1, y: 0 },
              entity: e,
              masses: [entMass],
              velocity: { vx: vxStep, vy: vyStep || 0 }
            });
            handleSlipImpact(e, 'x', Math.abs(vxStep), contactX, contactY);
          }
          const v = -(e.vx || 0) * wr;
          e.vx = (Math.abs(v) < 0.001) ? 0 : v;
          const s = Math.sign(e.vx || 1);
          if (!isWall(nx + s, ny, e.w, e.h)) nx += s;
        }
        const tryY = ny + sy;
        if (!isWall(nx + pad, tryY + pad, cw, ch)){
          ny = tryY;
        } else {
          const absVy = Math.abs(vyStep);
          const massFactor = Number.isFinite(entMass) ? Math.max(entMass, 1) : Math.max(minFireMass, 1);
          if (allowFireSpawn && absVy > 0.01){
            const contactY = vyStep > 0 ? ny + e.h : ny;
            const contactX = nx + e.w * 0.5;
            maybeSpawnImpactFire(contactX, contactY, absVy * massFactor, {
              type: 'wall',
              axis: 'y',
              normal: { x: 0, y: vyStep > 0 ? 1 : -1 },
              entity: e
            });
          }
          if (absVy > 0.01){
            const contactY = vyStep > 0 ? ny + e.h : ny;
            const contactX = nx + e.w * 0.5;
            notifyImpactEffects(contactX, contactY, absVy * massFactor, {
              type: 'wall',
              axis: 'y',
              normal: { x: 0, y: vyStep > 0 ? 1 : -1 },
              entity: e,
              masses: [entMass],
              velocity: { vx: vxStep || 0, vy: vyStep }
            });
            handleSlipImpact(e, 'y', Math.abs(vyStep), contactX, contactY);
          }
          const v = -(e.vy || 0) * wr;
          e.vy = (Math.abs(v) < 0.001) ? 0 : v;
          const s = Math.sign(e.vy || 1);
          if (!isWall(nx, ny + s, e.w, e.h)) ny += s;
        }
      }
      e.x = nx; e.y = ny;
      if (!isWall(e.x, e.y, e.w, e.h)) { e._lastSafeX = e.x; e._lastSafeY = e.y; }
      const damping = wantsSlide ? slideCoef : fr;
      if (wantsSlide && (typeof e.mu !== 'number' || e.mu > mu) && mu !== 0){
        e.mu = mu;
      }
      e.vx *= damping;
      e.vy *= damping;
      if (isWall(e.x, e.y, e.w, e.h)){
        clampOutOfWalls(e);
        if (isWall(e.x, e.y, e.w, e.h)) snapInsideMap(e);
      }
      if (Math.abs(e.vx) < 0.001) e.vx = 0;
      if (Math.abs(e.vy) < 0.001) e.vy = 0;
    }

    function collideWithTiles(e){
      moveWithCollisions(e);
    }

    function resolveAgainstSolids(e){
      if (!G) return;
      for (const o of G.entities){
        if (o === e || !o.solid || o.dead) continue;
        if (!nearAABB(e, o, 2)) continue;
        cartImpactDamage(e, o);
        if (!AABB(e, o)) continue;
        resolveOverlapPush(e, o);
        clampOutOfWalls(e);
        snapInsideMap(e);
      }
      snapInsideMap(e);
    }

    function resolveEntityPairs(dt){
      if (!G) return;
      const dyn = G.entities.filter(e =>
        e && !e.static && !e.dead && (e.solid || e.pushable || e.dynamic ||
          ((Math.abs(e.vx || 0) + Math.abs(e.vy || 0)) > 0))
      );
      for (let i = 0; i < dyn.length; i++){
        for (let k = i + 1; k < dyn.length; k++){
          const a = dyn[i], b = dyn[k];
          if (!nearAABB(a, b, 2)) continue;
          cartImpactDamage(a, b);
          if (!AABB(a, b)) continue;
          const ax = a.x + a.w * 0.5, ay = a.y + a.h * 0.5;
          const bx = b.x + b.w * 0.5, by = b.y + b.h * 0.5;
          const penX = (a.w * 0.5 + b.w * 0.5) - Math.abs(ax - bx);
          const penY = (a.h * 0.5 + b.h * 0.5) - Math.abs(ay - by);
          if (penX <= 0 || penY <= 0) continue;
          let nx = 0, ny = 0;
          if (penX < penY){ nx = (ax < bx ? -1 : 1); }
          else            { ny = (ay < by ? -1 : 1); }
          const invA = inverseMass(a);
          const invB = inverseMass(b);
          const invSum = invA + invB;
          if (invSum === 0) continue;
          const pen = (penX < penY ? penX : penY);
          const SLOP = 0.001;
          const MAX_PUSH = TILE * 0.45;
          const corr = (pen + SLOP) / invSum;
          const corrA = Math.min(corr * invA, MAX_PUSH);
          const corrB = Math.min(corr * invB, MAX_PUSH);
          a.x += nx * corrA; a.y += ny * corrA;
          b.x -= nx * corrB; b.y -= ny * corrB;
          const rvx = (a.vx || 0) - (b.vx || 0);
          const rvy = (a.vy || 0) - (b.vy || 0);
          const relativeSpeed = Math.hypot(rvx, rvy);
          if (typeof window.LogCollision === 'function' && G && (a === G.player || b === G.player)) {
            const other = a === G.player ? b : a;
            try {
              window.LogCollision('HERO_HIT_ENTITY', {
                otherId: other?.id || null,
                otherKind: other?.kindName || other?.kind || other?._tag || null,
                relativeSpeed: Number.isFinite(relativeSpeed) ? Number(relativeSpeed.toFixed(2)) : relativeSpeed,
              });
            } catch (_) {}
          }
          const velN = rvx * nx + rvy * ny;
          if (velN < 0){
            const rest = Math.max(CFG.restitution, resolveRestitution(a), resolveRestitution(b));
            let j = -(1 + rest) * velN / invSum;
            j = Math.max(-1200, Math.min(1200, j));
            const ix = j * nx, iy = j * ny;
            a.vx += ix * invA; a.vy += iy * invA;
            b.vx -= ix * invB; b.vy -= iy * invB;
            const impact = Math.abs(j);
            if (impact > 0){
              const minMass = CFG.fireMinMass ?? DEFAULTS.fireMinMass ?? 0;
              const massA = a.static ? 0 : massOf(a);
              const massB = b.static ? 0 : massOf(b);
              const heavy = Math.max(
                Number.isFinite(massA) ? massA : 0,
                Number.isFinite(massB) ? massB : 0
              );
              const contactX = (ax + bx) * 0.5;
              const contactY = (ay + by) * 0.5;
              const axis = Math.abs(nx) > Math.abs(ny) ? 'x' : 'y';
              if (heavy >= minMass){
                maybeSpawnImpactFire(contactX, contactY, impact, {
                  type: 'entity',
                  axis,
                  normal: { x: nx, y: ny },
                  entities: [a, b]
                });
              }
              notifyImpactEffects(contactX, contactY, impact, {
                type: 'entity',
                axis,
                normal: { x: nx, y: ny },
                entities: [a, b],
                masses: [massA, massB],
                relativeSpeed,
                velocity: {
                  ax: a.vx || 0,
                  ay: a.vy || 0,
                  bx: b.vx || 0,
                  by: b.vy || 0
                }
              });
            }
          }
          if (isWall(a.x, a.y, a.w, a.h)) snapInsideMap(a);
          if (isWall(b.x, b.y, b.w, b.h)) snapInsideMap(b);
          if (!isWall(a.x, a.y, a.w, a.h)) { a._lastSafeX = a.x; a._lastSafeY = a.y; }
          if (!isWall(b.x, b.y, b.w, b.h)) { b._lastSafeX = b.x; b._lastSafeY = b.y; }
        }
      }
    }

    function tick(dt){
      if (!G) return;
      for (const e of G.entities){
        if (!e || e.dead || e.static) continue;
        if (!(e.solid || e.pushable || e.dynamic) && Math.abs(e.vx || 0) + Math.abs(e.vy || 0) <= 0) continue;
        collideWithTiles(e);
        e.vx = clamp(e.vx || 0, -2000, 2000);
        e.vy = clamp(e.vy || 0, -2000, 2000);
        resolveAgainstSolids(e);
        if (typeof e._wetSlipTimer === 'number'){
          e._wetSlipTimer = Math.max(0, e._wetSlipTimer - dt);
        }
      }
      resolveEntityPairs(dt);
    }

    function bindGame(game){
      G = game || null;
      updateTileSize();
      try {
        window.CineFX?.configure?.({
          shakeThreshold: CFG.shakeImpulse ?? DEFAULTS.shakeImpulse,
          shakeDuration: CFG.shakeDuration ?? DEFAULTS.shakeDuration,
          shakeMax: CFG.shakeMax ?? DEFAULTS.shakeMax,
          slowMoThreshold: CFG.slowMoImpulse ?? DEFAULTS.slowMoImpulse,
          slowMoScale: CFG.slowMoScale ?? DEFAULTS.slowMoScale,
          slowMoDuration: CFG.slowMoDuration ?? DEFAULTS.slowMoDuration,
          slowMoRelease: CFG.slowMoRelease ?? DEFAULTS.slowMoRelease,
          ragdollImpulse: CFG.ragdollImpulse ?? DEFAULTS.ragdollImpulse,
          ragdollDuration: CFG.ragdollDuration ?? DEFAULTS.ragdollDuration,
          ragdollCooldown: CFG.ragdollCooldown ?? DEFAULTS.ragdollCooldown
        });
      } catch (err){
        if (window.DEBUG_FORCE_ASCII) console.warn('[Physics] CineFX configure', err);
      }
      if (!loggedSummary && isDebugPhysics()){
        const carts = Array.isArray(G?.entities) ? G.entities.filter((it) => isCartEntity(it)).length : 0;
        const pushables = Array.isArray(G?.entities) ? G.entities.filter((it) => it?.pushable).length : 0;
        console.debug('[PHYSICS_CHECK] carts', { count: carts, profile: CFG.cartProfiles });
        console.debug('[PHYSICS_CHECK] collisionLayers', {
          totalEntities: Array.isArray(G?.entities) ? G.entities.length : 0,
          pushable: pushables,
          restitution: CFG.restitution,
          cartRestitution: CFG.cartRestitution,
          cartMinSpeed: CFG.cartMinSpeed,
          cartMaxSpeed: CFG.cartMaxSpeed
        });
        loggedSummary = true;
      }
      return api;
    }

    const api = {
      MASS,
      DEFAULTS,
      bindGame,
      applyImpulse,
      collideWithTiles,
      moveWithCollisions,
      resolveAgainstSolids,
      resolveEntityPairs,
      snapInsideMap,
      tick,
      step: tick
    };

    return api;
  }

  function init(options = {}){
    const api = createPhysics(options);
    api.init = init;
    api.MASS = MASS;
    api.DEFAULTS = DEFAULTS;
    api.PHYS = PHYS;
    window.Physics = api;
    return api;
  }

  window.Physics = { MASS, PHYS, DEFAULTS, init };
})();
