// filename: furious.plugin.js
// Paciente Furiosa: nace si expira un timbre. Persigue agresiva, empuja fuerte,
// daña por contacto, puede morir aplastada por carros.

(function(){
  const FuriousAPI = {
    G:null, TILE:32,
    cfg: {
      speed: 92,          // más lenta que jugador, pero imparable
      accel: 580,
      damage: 2,          // daño por toque
      touchCooldown: 0.7,
      crushImpulse: 170,  // si carro impacta ≥ => muere
      avoidLookAhead: 18, // evita pegarse a pared
      pushPower: 520,     // empuje que aplica a objetos/jugador
      chaseBias: 0.25,    // inercia de dirección
      offscreenMin: 200
    },
    live: new Set(),

    init(Gref, opts={}){
      this.G = Gref || window.G || (window.G={});
      this.TILE = (typeof window.TILE_SIZE!=='undefined') ? window.TILE_SIZE : 32;
      Object.assign(this.cfg, opts||{});
      if (!Array.isArray(this.G.hostiles)) this.G.hostiles = [];
      if (!Array.isArray(this.G.entities)) this.G.entities = [];
      try { window.EntityGroups?.ensure?.(this.G); } catch (_) {}
      return this;
    },

    // Convierte un paciente en furiosa
    spawnFromPatient(patient, opts = {}){
      if (!patient || patient.dead) return null;
      this.init(this.G || window.G || (window.G = {}));
      this._cleanupPatientArtifacts(patient);
      const G = this.G;
      const skipCounters = !!(opts.skipCounters || patient.__convertedViaPatientsAPI);
      if (!Array.isArray(G.entities)) G.entities = [];
      if (!Array.isArray(G.patients)) G.patients = [];
      if (!Array.isArray(G.movers)) G.movers = [];
      try { window.EntityGroups?.ensure?.(G); } catch (_) {}

      const px = patient.x;
      const py = patient.y;
      const pw = patient.w;
      const ph = patient.h;

      patient.dead = true;
      G.entities = G.entities.filter((x) => x !== patient);
      G.patients = G.patients.filter((x) => x !== patient);
      try { window.EntityGroups?.unregister?.(patient, G); } catch (_) {}
      G.movers = G.movers.filter((x) => x !== patient);
      if (G._patientsByKey instanceof Map && patient.keyName) {
        G._patientsByKey.delete(patient.keyName);
      }

      if (!skipCounters) {
        const stats = G.stats || (G.stats = {});
        stats.remainingPatients = Math.max(0, (stats.remainingPatients || 0) - 1);
        stats.activeFuriosas = (stats.activeFuriosas || 0) + 1;
        if (Number.isFinite(G.patientsPending)) {
          G.patientsPending = Math.max(0, (G.patientsPending | 0) - 1);
        } else if (typeof G.patientsPending !== 'number') {
          G.patientsPending = Math.max(0, stats.remainingPatients || 0);
        }
        if (Number.isFinite(G.patientsFurious)) {
          G.patientsFurious = (G.patientsFurious | 0) + 1;
        } else {
          G.patientsFurious = (G.patientsFurious | 0) + 1;
        }
      }

      delete patient.__convertedViaPatientsAPI;

      const ENT = G.ENT || {};
      const e = {
        kind: ENT.FURIOUS || 'furious',
        x: px,
        y: py,
        w: pw,
        h: ph,
        vx: 0,
        vy: 0,
        mass: 130,
        dynamic: true,
        solid: true,
        pushable: true,
        color: '#ff2f4f',
        t: 0,
        touchCD: 0,
        ai: { lastX: 0, lastY: 1 },
        aiId: 'FURIOUS',
        hostile: true,
        group: 'human'
      };
      try { window.AI?.attach?.(e, 'FURIOUS'); } catch (_) {}
      G.entities.push(e);
      G.hostiles.push(e);
      try { window.EntityGroups?.register?.(e, G); } catch (_) {}
      this.live.add(e);

      if (window.Physics && Physics.registerEntity) Physics.registerEntity(e);
      if (window.AudioAPI) AudioAPI.play('furious_spawn', { at: { x: e.x, y: e.y }, volume: 1.0 });

      if (window.LightingAPI) {
        const id = LightingAPI.addLight({ x: e.x + e.w / 2, y: e.y + e.h / 2, radius: this.TILE * 3.5, color: 'rgba(255,80,100,0.35)', owner: e });
        e._lightId = id;
      }
      if (!skipCounters) {
        try { window.GameFlowAPI?.notifyPatientCountersChanged?.(); } catch (_) {}
      }
      return e;
    },

    transformToFurious(patient) {
      if (!patient) return null;
      if (window.PatientsAPI && typeof window.PatientsAPI.toFurious === 'function') {
        try {
          const spawned = window.PatientsAPI.toFurious(patient);
          if (spawned) return spawned;
        } catch (err) {
          console.warn('[FuriousAPI] PatientsAPI.toFurious', err);
        }
      }
      return this.spawnFromPatient(patient, { skipCounters: false });
    },

    _cleanupPatientArtifacts(patient) {
      if (!patient) return;
      const G = this.G || window.G || {};
      const removeRefs = new Set();
      if (Array.isArray(G.pills)) {
        const keep = [];
        for (const pill of G.pills) {
          if (!pill) continue;
          const matchesId = patient.pillId && pill.id === patient.pillId;
          const matchesPatient = patient.id && (pill.patientId === patient.id || pill.forPatientId === patient.id);
          const matchesKey = patient.keyName && pill.pairName === patient.keyName;
          if (matchesId || matchesPatient || matchesKey) {
            removeRefs.add(pill);
            continue;
          }
          keep.push(pill);
        }
        G.pills = keep;
      }
      if (removeRefs.size) {
        if (Array.isArray(G.entities)) G.entities = G.entities.filter((ent) => !removeRefs.has(ent));
        if (Array.isArray(G.movers)) G.movers = G.movers.filter((ent) => !removeRefs.has(ent));
      }
      if (patient.keyName && G._patientsByKey instanceof Map) {
        G._patientsByKey.delete(patient.keyName);
      }
      if (patient.pillId) patient.pillId = null;
      if (G.carry && typeof G.carry === 'object') {
        const carry = G.carry;
        const samePatient = patient.id && (carry.patientId === patient.id || carry.forPatientId === patient.id);
        const sameKey = patient.keyName && carry.pairName === patient.keyName;
        const sameName = patient.name && carry.patientName === patient.name;
        if (samePatient || sameKey || sameName) {
          G.carry = null;
          if (G.player && G.player.carry === carry) G.player.carry = null;
          try { window.ArrowGuide?.clearTarget?.(); } catch (_) {}
        }
      }
    },

    // Llamar por frame
    update(dt){
      for (const e of [...this.live]) {
        if (!e || e.dead) { this.live.delete(e); continue; }
        this._updateOne(e, dt);
      }
    },

    onEnemyKilled(e){
      if (!e || !this.live.has(e)) return;
      // limpia luz y set
      if (e._lightId && window.LightingAPI){ try{ LightingAPI.removeLight?.(e._lightId); }catch(_){ } }
      this.live.delete(e);
      try { window.EntityGroups?.unregister?.(e, this.G); } catch (_) {}
      try { window.PatientsAPI?.onFuriosaNeutralized?.(e); } catch (_) {}
    },

    // ---------- Internos ----------
    _updateOne(e, dt){
      e.t += dt;
      if (e.touchCD>0) e.touchCD = Math.max(0, e.touchCD - dt);

      const G=this.G, p=G.player; if(!p) return;

      if (e._aiState !== 'CHASE') {
        e._aiState = 'CHASE';
        try {
          window.LOG?.event?.('AI_STATE', {
            entity: e.id || null,
            kind: 'FURIOUS',
            state: 'CHASE',
          });
        } catch (_) {}
      }

      // 1) Dirección hacia jugador (cardinal dominante con inercia)
      const cx = e.x + e.w/2, cy = e.y + e.h/2;
      const px = p.x + p.w/2, py = p.y + p.h/2;
      const dx = px - cx, dy = py - cy;

      let dirx = Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : 0;
      let diry = (dirx===0) ? Math.sign(dy) : 0;
      const b = this.cfg.chaseBias;
      dirx = (1-b)*dirx + b*(e.ai.lastX||0);
      diry = (1-b)*diry + b*(e.ai.lastY||0);
      if (Math.abs(dirx) > Math.abs(diry)) { dirx = Math.sign(dirx); diry = 0; }
      else { diry = Math.sign(diry); dirx = 0; }
      e.ai.lastX = dirx; e.ai.lastY = diry;

      // 2) Evitar pared con look-ahead
      const la = this.cfg.avoidLookAhead;
      if (this._hitWall(cx + dirx*la, cy + diry*la, e.w, e.h)) {
        // prueba el otro eje
        if (dirx!==0) { dirx=0; diry=Math.sign(dy)||1; }
        else { diry=0; dirx=Math.sign(dx)||1; }
      }

      // 3) Velocidad objetivo + aceleración
      const tvx = dirx * this.cfg.speed;
      const tvy = diry * this.cfg.speed;
      const ax  = clamp(tvx - (e.vx||0), -this.cfg.accel, this.cfg.accel);
      const ay  = clamp(tvy - (e.vy||0), -this.cfg.accel, this.cfg.accel);

      if (window.Physics && Physics.applyImpulse){
        Physics.applyImpulse(e, ax*dt*e.mass, ay*dt*e.mass);
      } else {
        e.vx = (e.vx||0) + ax*dt;
        e.vy = (e.vy||0) + ay*dt;
      }

      // 4) Daño por contacto + empuje al jugador
      if (AABB(e, p) && e.touchCD<=0){
        if (G.hurt) G.hurt(this.cfg.damage, { source:e });
        e.touchCD = this.cfg.touchCooldown;
        const ddx = (p.x+p.w/2) - (e.x+e.w/2);
        const ddy = (p.y+p.h/2) - (e.y+e.h/2);
        const n = Math.hypot(ddx, ddy) || 1;
        const fx = (ddx/n) * this.cfg.pushPower;
        const fy = (ddy/n) * this.cfg.pushPower;
        if (window.Physics && Physics.applyImpulse) Physics.applyImpulse(p, fx, fy);
        else { p.vx += fx*0.02; p.vy += fy*0.02; }
        if (window.AudioAPI) AudioAPI.play('hurt', { volume:0.9, throttleMs:120 });
      }

      // 5) Aplastamiento por carro
      const cart = this._cartHit(e);
      if (cart && this._relImpulse(e, cart) >= this.cfg.crushImpulse) {
        this._kill(e);
        return;
      }

      // 6) Actualiza luz si tiene
      if (e._lightId && window.LightingAPI){
        LightingAPI.updateLight(e._lightId, { x:e.x+e.w/2, y:e.y+e.h/2 });
      }
    },

    _kill(e){
      if (!e || e.dead) return;
      e.dead = true;
      if (e._lightId && window.LightingAPI){ try{ LightingAPI.removeLight?.(e._lightId); }catch(_){ } }
      this.G.hostiles = (this.G.hostiles||[]).filter(x => x !== e);
      this.G.entities= (this.G.entities||[]).filter(x => x !== e);
      this.live.delete(e);
      if (window.AudioAPI) AudioAPI.play('furious_die', { at:{x:e.x,y:e.y}, volume:1.0 });
      if (this.G.addScore) this.G.addScore(150);
      try { window.PatientsAPI?.onFuriosaNeutralized?.(e); } catch (_) {}
    },

    _hitWall(nx, ny, w, h){
      if (typeof window.isWallAt === 'function') return !!isWallAt(nx - w/2, ny - h/2, w, h);
      return false;
    },
    _cartHit(e){
      const ENT = this.G.ENT || {};
      for (const k of (this.G.entities||[])) {
        if (!k || k.dead) continue;
        if (!(k.kind===ENT.CART || k.kind===ENT.CART_FOOD || k.kind===ENT.CART_MED || k.kind===ENT.CART_URG)) continue;
        if (AABB(e, k)) return k;
      }
      return null;
    },
    _relImpulse(a,b){
      const ax=a.vx||0, ay=a.vy||0, bx=b.vx||0, by=b.vy||0;
      const rvx=ax-bx, rvy=ay-by, rel=Math.hypot(rvx,rvy);
      const ma=a.mass||120, mb=b.mass||120;
      const mred=(ma*mb)/(ma+mb);
      return rel*mred;
    }
  };

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  window.FuriousAPI = FuriousAPI;
})();