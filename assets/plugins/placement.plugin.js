(function(){
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Placement = root.Placement = root.Placement || {};
  Placement._counts = null;

  const TILE_SIZE = () => root.TILE_SIZE || root.TILE || 32;

  Placement.shouldRun = function shouldRun(cfg){
    const G = cfg?.G || root.G;
    if (!G || !cfg?.map || !cfg?.width || !cfg?.height) return false;
    if (G.__placementsApplied === true) return false;
    return true;
  };

  Placement.applyFromAsciiMap = function applyFromAsciiMap(cfg){
    const G = cfg?.G || root.G || (root.G = {});
    if (!Placement.shouldRun({ ...cfg, G })) {
      return { applied: false, reason: 'guard' };
    }

    ensureGameCollections(G);
    G.__placementsApplied = true;
    G._lastLevelCfg = cfg;
    Placement._counts = {};

    const add = (entity) => {
      if (!entity) return;
      ensureGameCollections(G);
      if (Array.isArray(G.entities) && !G.entities.includes(entity)) {
        G.entities.push(entity);
      }
      if (!entity.static && (entity.dynamic || entity.pushable || entity.vx || entity.vy)) {
        if (Array.isArray(G.movers) && !G.movers.includes(entity)) {
          G.movers.push(entity);
        }
      }
      const kindKey = resolveKind(entity);
      Placement._counts[kindKey] = (Placement._counts[kindKey] || 0) + 1;
      try { root.AI?.register?.(entity); } catch (_) {}
      return entity;
    };

    ensurePatientCounters(G);

    const heroPos = findHeroPosFromAsciiOrCenter(cfg, G);
    const hero = spawnHero(heroPos.tx, heroPos.ty, cfg, G);
    root.Puppet?.bind?.(hero, hero.key || 'hero_enrique');
    hero.rigOk = true;
    add(hero);
    G.player = hero;

    const patientSpots = listPatientSpots(cfg, G);
    if (cfg?.mode === 'debug' && patientSpots.length === 0) {
      patientSpots.push({ tx: heroPos.tx + 4, ty: heroPos.ty });
    }

    for (const spot of patientSpots) {
      const patient = spawnPatient(spot.tx, spot.ty, { name: genFunnyName() }, cfg, G);
      if (!patient) continue;
      add(patient);
      const pill = spawnPill(spot.tx + 1, spot.ty, {
        patientId: patient.id,
        code: pillCodeFromName(patient.name)
      }, cfg, G);
      if (pill) {
        pill.patientId = pill.patientId || patient.id;
        add(pill);
        if (!G.pills.includes(pill)) G.pills.push(pill);
      }
      const bell = spawnBell(spot.tx, spot.ty - 1, { patientId: patient.id }, cfg, G);
      if (bell) {
        bell.patientId = bell.patientId || patient.id;
        add(bell);
      }
      const counters = (typeof root.patientsSnapshot === 'function') ? root.patientsSnapshot() : null;
      if (counters) {
        G.patients.total = counters.total | 0;
        G.patients.pending = counters.pending | 0;
      } else {
        G.patients.total = (G.patients.total | 0) + 1;
        G.patients.pending = (G.patients.pending | 0) + 1;
      }
    }

    for (const npc of spawnNPCPack(cfg, G)) add(npc);
    for (const enemy of spawnEnemiesPack(cfg, G)) add(enemy);
    for (const obj of spawnWorldObjects(cfg, G)) add(obj);

    try { root.Minimap?.refresh?.(); } catch (_) {}
    try { root.LOG?.event?.('PLACEMENT_SUMMARY', Placement.summarize()); } catch (_) {}

    return { applied: true };
  };

  Placement.summarize = function summarize(){
    const counts = Placement._counts || {};
    let total = 0;
    for (const key of Object.keys(counts)) total += counts[key];
    return { countsPorTipo: { ...counts }, total };
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function ensureGameCollections(G){
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.movers)) G.movers = [];
    if (!Array.isArray(G.pills)) G.pills = [];
    if (!Array.isArray(G.npcs)) G.npcs = [];
    if (!Array.isArray(G.patients)) G.patients = [];
    if (typeof G.patients.total !== 'number') {
      G.patients.total = 0;
      G.patients.pending = 0;
      G.patients.cured = 0;
      G.patients.furious = 0;
    }
  }

  function ensurePatientCounters(G){
    ensureGameCollections(G);
    if (typeof G.patients.total !== 'number') G.patients.total = 0;
    if (typeof G.patients.pending !== 'number') G.patients.pending = 0;
    if (typeof G.patients.cured !== 'number') G.patients.cured = 0;
    if (typeof G.patients.furious !== 'number') G.patients.furious = 0;
  }

  function resolveKind(entity){
    if (!entity) return 'UNKNOWN';
    if (typeof entity.kind === 'string') return entity.kind;
    if (entity.kind != null) return String(entity.kind);
    if (typeof entity.type === 'string') return entity.type.toUpperCase();
    if (typeof entity.kindName === 'string') return entity.kindName.toUpperCase();
    return 'UNKNOWN';
  }

  function getPlacements(cfg){
    if (Array.isArray(cfg?.placements) && cfg.placements.length) return cfg.placements;
    if (Array.isArray(cfg?.G?.mapgenPlacements) && cfg.G.mapgenPlacements.length) {
      return cfg.G.mapgenPlacements;
    }
    if (Array.isArray(root.G?.mapgenPlacements) && root.G.mapgenPlacements.length) {
      return root.G.mapgenPlacements;
    }
    return [];
  }

  function parseAsciiRows(cfg){
    const raw = cfg?.asciiMap || cfg?.ascii || '';
    if (!raw) return null;
    return String(raw)
      .replace(/\r/g, '')
      .split('\n')
      .map((row) => row.trimEnd());
  }

  function findHeroPosFromAsciiOrCenter(cfg, G){
    const placements = getPlacements(cfg);
    const byType = placements.find((p) => {
      const type = String(p?.type || '').toLowerCase();
      return type === 'player' || type === 'hero' || type === 'start';
    });
    if (byType) {
      return normalizePlacementToTile(byType, cfg);
    }

    const rows = parseAsciiRows(cfg);
    if (rows) {
      for (let ty = 0; ty < rows.length; ty++) {
        const row = rows[ty];
        const idx = row.indexOf('H');
        if (idx >= 0) {
          return { tx: idx, ty };
        }
      }
    }

    const ctrl = cfg?.areas?.control || G?.areas?.control;
    if (ctrl) {
      return {
        tx: Math.floor(ctrl.x + ctrl.w * 0.5),
        ty: Math.floor(ctrl.y + ctrl.h * 0.5)
      };
    }

    const width = cfg?.width || G?.mapW || rows?.[0]?.length || 0;
    const height = cfg?.height || G?.mapH || rows?.length || 0;
    return {
      tx: Math.floor(width / 2),
      ty: Math.floor(height / 2)
    };
  }

  function listPatientSpots(cfg, G){
    const spots = [];
    const placements = getPlacements(cfg);
    for (const entry of placements) {
      const type = String(entry?.type || '').toLowerCase();
      if (type === 'patient') {
        spots.push(normalizePlacementToTile(entry, cfg));
      }
    }
    if (spots.length) return spots;
    const rows = parseAsciiRows(cfg);
    if (rows) {
      for (let ty = 0; ty < rows.length; ty++) {
        const row = rows[ty];
        for (let tx = 0; tx < row.length; tx++) {
          const c = row[tx];
          if (c === 'p' || c === 'P') {
            spots.push({ tx, ty });
          }
        }
      }
    }
    return spots;
  }

  function normalizePlacementToTile(p, cfg){
    const tile = TILE_SIZE();
    if (typeof p.tx === 'number' && typeof p.ty === 'number') {
      return { tx: p.tx, ty: p.ty };
    }
    if (p?._units && String(p._units).toLowerCase().startsWith('tile')) {
      return { tx: Math.floor(p.x), ty: Math.floor(p.y) };
    }
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      return {
        tx: Math.round(p.x / tile),
        ty: Math.round(p.y / tile)
      };
    }
    if (Array.isArray(p.pos) && p.pos.length >= 2) {
      return {
        tx: Math.round(p.pos[0]),
        ty: Math.round(p.pos[1])
      };
    }
    return { tx: 0, ty: 0 };
  }

  function toWorld(tx, ty){
    const tile = TILE_SIZE();
    return {
      x: tx * tile,
      y: ty * tile
    };
  }

  function spawnHero(tx, ty, cfg, G){
    const tile = TILE_SIZE();
    const world = toWorld(tx, ty);
    const px = world.x + tile * 0.5;
    const py = world.y + tile * 0.5;
    const heroKey = G?.selectedHero || cfg?.heroKey || root.selectedHeroKey;
    const opts = heroKey ? { skin: heroKey } : {};
    const hero = root.Entities?.Hero?.spawnPlayer?.(px, py, opts)
      || root.Entities?.Hero?.spawn?.(px, py, opts)
      || {
        kind: 'HERO',
        x: px,
        y: py,
        w: tile * 0.8,
        h: tile * 0.85,
        key: heroKey || 'hero_enrique',
        rigOk: false
      };
    if (hero && !hero.rigOk) hero.rigOk = true;
    return hero;
  }

  function spawnPatient(tx, ty, opts, cfg, G){
    const tile = TILE_SIZE();
    const world = toWorld(tx, ty);
    const patient = root.Entities?.Patient?.spawn?.(world.x, world.y, opts || {})
      || root.PatientsAPI?.createPatient?.(world.x, world.y, opts || {})
      || {
        kind: 'PATIENT',
        x: world.x,
        y: world.y,
        w: tile * 0.9,
        h: tile * 0.75,
        id: cryptoRand(),
        name: opts?.name || genFunnyName(),
        state: 'idle_bed',
        rigOk: true
      };
    if (!patient.id) patient.id = cryptoRand();
    patient.state = patient.state || 'idle_bed';
    patient.rigOk = patient.rigOk === true || true;
    ensurePatientCounters(G);
    if (!G.patients.includes(patient)) G.patients.push(patient);
    return patient;
  }

  function spawnPill(tx, ty, opts, cfg, G){
    const tile = TILE_SIZE();
    const world = toWorld(tx, ty);
    const payload = { ...opts, patientId: opts?.patientId, _units: 'px' };
    const pill = root.Entities?.Objects?.spawnPill?.('pill', world.x + tile * 0.25, world.y + tile * 0.25, payload)
      || root.PatientsAPI?.createPillForPatient?.(findPatientById(G, opts?.patientId), 'near')
      || {
        kind: 'PILL',
        x: world.x + tile * 0.25,
        y: world.y + tile * 0.25,
        w: tile * 0.5,
        h: tile * 0.5,
        patientId: opts?.patientId,
        rigOk: true
      };
    pill.kind = pill.kind || 'PILL';
    pill.rigOk = pill.rigOk === true || true;
    return pill;
  }

  function spawnBell(tx, ty, opts, cfg, G){
    const tile = TILE_SIZE();
    const world = toWorld(tx, ty);
    const payload = { ...opts, _units: 'px' };
    const bell = root.BellsAPI?.spawnBell?.(world.x + tile * 0.1, world.y + tile * 0.1, payload)
      || root.spawnBell?.(world.x + tile * 0.1, world.y + tile * 0.1, payload)
      || {
        kind: 'BELL',
        x: world.x + tile * 0.1,
        y: world.y + tile * 0.1,
        w: tile * 0.6,
        h: tile * 0.6,
        patientId: opts?.patientId,
        rigOk: true,
        ringing: false
      };
    if (bell) {
      bell.kind = bell.kind || 'BELL';
      bell.rigOk = bell.rigOk === true || true;
      bell.on = bell.on || false;
    }
    return bell;
  }

  function spawnNPCPack(cfg, G){
    const out = [];
    for (const entry of getPlacements(cfg)) {
      const type = String(entry?.type || '').toLowerCase();
      if (type !== 'npc' && type !== 'npc_unique' && type !== 'staff') continue;
      const { tx, ty } = normalizePlacementToTile(entry, cfg);
      const world = toWorld(tx, ty);
      const sub = String(entry?.sub || entry?.npc || entry?.name || '').toLowerCase();
      const payload = { ...entry, _units: 'px' };
      let npc = null;
      if (root.Entities?.NPC?.spawn) {
        npc = root.Entities.NPC.spawn(sub, world.x, world.y, payload);
      }
      if (!npc) {
        npc = spawnNPCBySubtype(sub, world.x, world.y, payload);
      }
      if (!npc) {
        npc = {
          kind: 'NPC',
          x: world.x,
          y: world.y,
          w: TILE_SIZE() * 0.85,
          h: TILE_SIZE(),
          sub,
          rigOk: false
        };
      }
      npc.rigOk = npc.rigOk === true || true;
      out.push(npc);
      if (Array.isArray(G.npcs) && !G.npcs.includes(npc)) G.npcs.push(npc);
    }
    return out;
  }

  function spawnNPCBySubtype(sub, x, y, payload){
    if (!sub) return null;
    if (sub.includes('guard') && root.Entities?.Guardia?.spawn) return root.Entities.Guardia.spawn({ tx: Math.round(x / TILE_SIZE()), ty: Math.round(y / TILE_SIZE()) });
    if (sub.includes('jefe') && root.Entities?.JefeServicio?.spawn) return root.Entities.JefeServicio.spawn(x, y, payload);
    if (sub.includes('supervisor') && root.Entities?.SupervisoraAPI?.spawn) return root.Entities.SupervisoraAPI.spawn(x, y, payload);
    if (sub.includes('celador') && root.Entities?.Celador?.spawn) return root.Entities.Celador.spawn(x, y, payload);
    if (sub.includes('medico') && root.MedicoAPI?.spawn) return root.MedicoAPI.spawn(x, y, payload);
    if (sub.includes('familiar') && root.Entities?.FamiliarMolesto?.spawn) return root.Entities.FamiliarMolesto.spawn(x, y, payload);
    if (sub.includes('tcae') && root.Entities?.TCAE?.spawn) return root.Entities.TCAE.spawn({ tx: Math.round(x / TILE_SIZE()), ty: Math.round(y / TILE_SIZE()) });
    if (sub.includes('limpieza') && root.Entities?.Cleaner?.spawn) return root.Entities.Cleaner.spawn(x, y, payload);
    if (sub.includes('enfermera') && root.Entities?.NurseSexy?.spawn) return root.Entities.NurseSexy.spawn(x, y, payload);
    return null;
  }

  function spawnEnemiesPack(cfg, G){
    const out = [];
    for (const entry of getPlacements(cfg)) {
      const type = String(entry?.type || '').toLowerCase();
      const subtype = String(entry?.sub || '').toLowerCase();
      const { tx, ty } = normalizePlacementToTile(entry, cfg);
      const world = toWorld(tx, ty);
      let entity = null;
      if (type === 'enemy' || type === 'spawner') {
        if (subtype.includes('mosquito') && root.MosquitoAPI?.spawn) {
          entity = root.MosquitoAPI.spawn(world.x, world.y, { _units: 'px' });
        } else if (subtype.includes('rat') && root.RatsAPI?.spawn) {
          entity = root.RatsAPI.spawn(world.x, world.y, { _units: 'px' });
        }
      }
      if (!entity && type === 'mosquito' && root.MosquitoAPI?.spawn) {
        entity = root.MosquitoAPI.spawn(world.x, world.y, { _units: 'px' });
      }
      if (!entity && type === 'rat' && root.RatsAPI?.spawn) {
        entity = root.RatsAPI.spawn(world.x, world.y, { _units: 'px' });
      }
      if (entity) {
        entity.rigOk = entity.rigOk === true || true;
        out.push(entity);
      }
    }
    return out;
  }

  function spawnWorldObjects(cfg, G){
    const out = [];
    for (const entry of getPlacements(cfg)) {
      const type = String(entry?.type || '').toLowerCase();
      const { tx, ty } = normalizePlacementToTile(entry, cfg);
      const world = toWorld(tx, ty);
      let entity = null;
      if (type === 'cart' && root.Entities?.Cart?.spawn) {
        entity = root.Entities.Cart.spawn(entry?.sub || 'med', world.x, world.y, entry || {});
      } else if (type === 'door' && root.Entities?.Door?.spawn) {
        entity = root.Entities.Door.spawn(world.x, world.y, entry || {});
      } else if (type === 'elevator' && root.Entities?.Elevator?.spawn) {
        entity = root.Entities.Elevator.spawn(world.x, world.y, entry || {});
      } else if (type === 'light' && root.Entities?.Light?.spawn) {
        const light = root.Entities.Light.spawn(world.x + TILE_SIZE() * 0.5, world.y + TILE_SIZE() * 0.5, entry || {});
        if (light) {
          light.isBroken = !!entry?.broken;
          entity = light;
        }
      } else if (type === 'boss_light' && root.Entities?.BossLight) {
        const light = root.Entities.spawnFromPlacement_BossLight?.({ ...entry, x: world.x, y: world.y })
          || root.Entities.BossLight.spawn?.(world.x, world.y, entry || {});
        if (light) entity = light;
      } else if (type === 'phone') {
        entity = root.PhoneAPI?.spawnPhone?.(world.x, world.y, entry || {})
          || root.spawnPhone?.(world.x, world.y, entry || {});
      }
      if (entity) {
        entity.rigOk = entity.rigOk === true || true;
        out.push(entity);
      }
    }
    return out;
  }

  function findPatientById(G, id){
    if (!id) return null;
    if (Array.isArray(G?.patients)) {
      return G.patients.find((p) => p && p.id === id) || null;
    }
    return null;
  }

  function genFunnyName(){
    const pool = ['Dolores Barriga', 'Ana Lgésica', 'Tomás Tico'];
    return pool[(Math.random() * pool.length) | 0];
  }

  function pillCodeFromName(){
    return 'DOLORITINA';
  }

  function cryptoRand(){
    try {
      return root.crypto?.getRandomValues(new Uint32Array(1))[0];
    } catch (_) {
      return (Math.random() * 1e9) | 0;
    }
  }

  Placement.applyPlacementsFromMapGen = Placement.applyFromAsciiMap;
})();
