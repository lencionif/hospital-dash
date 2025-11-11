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
    const mode = String(root.MapGen?.MAP_MODE || root.__MAP_MODE || cfg?.mode || 'normal').toLowerCase();
    if (mode === 'normal' && cfg?.forceAscii !== true) {
      return applyFromXML(cfg);
    }
    return applyFromAsciiLegacy(cfg);
  };

  function applyFromAsciiLegacy(cfg){
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

    registerSpawnerPlacements(cfg, G);
    for (const npc of spawnNPCPack(cfg, G)) add(npc);
    for (const enemy of spawnEnemiesPack(cfg, G)) add(enemy);
    for (const obj of spawnWorldObjects(cfg, G)) add(obj);

    try { root.Minimap?.refresh?.(); } catch (_) {}
    try { root.LOG?.event?.('PLACEMENT_SUMMARY', Placement.summarize()); } catch (_) {}

    return { applied: true };
  }

  function applyGlobals(globals, G){
    if (!globals || typeof globals !== 'object') return;
    if (Number.isFinite(globals.tileSize)) {
      root.TILE_SIZE = globals.tileSize;
    }
    G.globals = { ...(G.globals || {}), ...globals };
    if (typeof globals.defaultHero === 'string' && !G.selectedHero) {
      G.selectedHero = globals.defaultHero;
    }
  }

  function createFallbackRNG(seed){
    let state = 0;
    if (typeof seed === 'number' && Number.isFinite(seed)) {
      state = seed >>> 0;
    } else {
      state = hashSeed(String(seed || Date.now()));
    }
    return {
      rand(){
        state |= 0;
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      int(a, b){
        const min = Math.min(a, b);
        const max = Math.max(a, b);
        return min + Math.floor(this.rand() * (max - min + 1));
      },
      pick(arr){
        if (!Array.isArray(arr) || !arr.length) return null;
        return arr[Math.floor(this.rand() * arr.length)];
      },
      shuffle(arr){
        if (!Array.isArray(arr)) return arr;
        for (let i = arr.length - 1; i > 0; i--) {
          const j = this.int(0, i);
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      }
    };
  }

  function hashSeed(str){
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function buildXmlPlacementContext(grid, rng, rules, level, globals){
    const rooms = Array.isArray(grid.rooms) ? grid.rooms.map((room, idx) => ({
      ...room,
      id: room.id || `room_${idx + 1}`,
      idx,
      tag: room.tag || '',
      center: {
        tx: room.x + Math.floor(room.w / 2),
        ty: room.y + Math.floor(room.h / 2)
      }
    })) : [];

    const byTag = new Map();
    for (const room of rooms) {
      const tag = String(room.tag || '').toLowerCase();
      if (tag) byTag.set(tag, room);
      byTag.set(room.id.toLowerCase(), room);
      byTag.set(`room:${room.id.toLowerCase()}`, room);
    }
    if (grid.control) byTag.set('room:control', grid.control);
    if (grid.entrance) byTag.set('room:entrance', grid.entrance);
    if (grid.boss) byTag.set('bossroom', grid.boss);
    if (grid.boss) byTag.set('room:boss', grid.boss);

    const spawnTile = resolveSpawnTile(grid, level, rooms);

    return {
      grid,
      rng,
      rules,
      level,
      globals,
      rooms,
      byTag,
      occupancy: new Set(),
      spawnTile,
      bossEntrance: grid.bossEntrance || null,
      bossRoom: grid.boss || null,
      controlRoom: grid.control || null,
      entranceRoom: grid.entrance || null,
      uniqueNPCs: new Set(),
      lightPlacements: [],
      lightBrokenRate: Number(level?.lighting?.brokenLights) || 0,
      counters: { patient: 0, light: 0, elevator: 0 }
    };
  }

  function resolveSpawnTile(grid, level, rooms){
    if (Number.isFinite(level?.spawn?.tx) && Number.isFinite(level?.spawn?.ty)) {
      return { tx: level.spawn.tx, ty: level.spawn.ty };
    }
    const primary = grid.control || grid.entrance || rooms[0] || null;
    if (!primary) return { tx: 1, ty: 1 };
    return {
      tx: primary.x + Math.floor(primary.w / 2),
      ty: primary.y + Math.floor(primary.h / 2)
    };
  }

  function buildPlacementsFromRules(context){
    const placements = [];
    for (const rule of context.rules) {
      const type = String(rule?.type || '').toLowerCase();
      if (!type) continue;
      if (type === 'patient') {
        handlePatientRule(rule, context, placements);
      } else if (type === 'npc') {
        handleNpcRule(rule, context, placements);
      } else if (type === 'enemy') {
        handleEnemyRule(rule, context, placements);
      } else if (type === 'cart') {
        handleCartRule(rule, context, placements);
      } else if (type === 'door') {
        handleDoorRule(rule, context, placements);
      } else if (type === 'elevator') {
        handleElevatorRule(rule, context, placements);
      } else if (type === 'phone') {
        handlePhoneRule(rule, context, placements);
      } else if (type === 'light') {
        handleLightRule(rule, context, placements);
      }
    }
    finalizeLights(context);
    return placements;
  }

  function spawnAdditionalHeroes(extraCount, heroTile, context, cfg, G){
    const count = Math.max(0, extraCount | 0);
    if (!count) return;
    ensureGameCollections(G);
    const base = heroTile || context.spawnTile || { tx: Math.floor((cfg.width || 2) / 2), ty: Math.floor((cfg.height || 2) / 2) };
    for (let i = 0; i < count; i++) {
      const offset = findNearbyTile(context, context.controlRoom || context.entranceRoom || context.rooms[0], base, { radius: 3 });
      const tile = offset || base;
      const hero = spawnHero(tile.tx, tile.ty, cfg, G);
      if (!hero) continue;
      markOccupied(context, tile.tx, tile.ty);
      Placement._counts = Placement._counts || {};
      Placement._counts.HERO = (Placement._counts.HERO || 0) + 1;
      if (!G.entities.includes(hero)) G.entities.push(hero);
      if (!G.movers.includes(hero)) G.movers.push(hero);
    }
  }

  function applyLightingConfig(lighting, G){
    if (!lighting) return;
    G.lightingConfig = { ...(G.lightingConfig || {}), ...lighting };
    try { root.LightingSystem?.configure?.(G.lightingConfig); } catch (_) {}
  }

  function spawnPatientsFromXml(patients, pills, bells, cfg, G){
    if (!Array.isArray(patients) || !patients.length) return;
    ensurePatientCounters(G);
    const pillMap = new Map();
    for (const pill of pills || []) {
      const key = pill.patientId || pill.targetPatientId || pill.id;
      if (!key) continue;
      pillMap.set(key, pill);
    }
    const bellMap = new Map();
    for (const bell of bells || []) {
      const key = bell.patientId || bell.id;
      if (!key) continue;
      bellMap.set(key, bell);
    }
    for (const entry of patients) {
      const opts = {};
      if (entry.name) opts.name = entry.name;
      if (entry.id) opts.id = entry.id;
      const patient = spawnPatient(entry.tx, entry.ty, opts, cfg, G);
      if (!patient) continue;
      registerEntityForPlacement(G, patient);
      const pillEntry = pillMap.get(patient.id) || pillMap.get(entry.id || patient.id);
      if (pillEntry) {
        const pill = spawnPill(pillEntry.tx, pillEntry.ty, { patientId: patient.id }, cfg, G);
        if (pill) {
          pill.patientId = patient.id;
          pill.targetPatientId = patient.id;
          registerEntityForPlacement(G, pill);
          if (!G.pills.includes(pill)) G.pills.push(pill);
        }
      }
      const bellEntry = bellMap.get(patient.id) || bellMap.get(entry.id || patient.id);
      if (bellEntry) {
        const bell = spawnBell(bellEntry.tx, bellEntry.ty, { patientId: patient.id }, cfg, G);
        if (bell) {
          bell.patientId = patient.id;
          registerEntityForPlacement(G, bell);
        }
      }
    }
  }

  function handlePatientRule(rule, context, placements){
    const total = Number.isFinite(rule.count) ? Math.max(0, rule.count | 0) : context.rooms.length;
    const defaultRooms = context.rooms.filter((room) => room !== context.bossRoom && room !== context.controlRoom);
    const rooms = resolveRoomsForRule(context, rule, defaultRooms);
    const assignments = distributeCountAcrossRooms(context, rooms, rule, total);
    const names = parseNamesList(rule.names);
    for (const assign of assignments) {
      for (let i = 0; i < assign.count; i++) {
        const tile = randomTileInRoom(context, assign.room, { margin: 1 });
        if (!tile) continue;
        const patientId = `PAT_${String(context.level?.id || 'L')}_${++context.counters.patient}`;
        const name = names.length ? names[(context.counters.patient - 1) % names.length] : generateFallbackPatientName(context);
        placements.push({ type: 'patient', tx: tile.tx, ty: tile.ty, id: patientId, name });
        markOccupied(context, tile.tx, tile.ty);
        const pillTile = findNearbyTile(context, assign.room, tile, { radius: 2 });
        if (pillTile) {
          placements.push({ type: 'pill', tx: pillTile.tx, ty: pillTile.ty, patientId, targetPatientId: patientId });
          markOccupied(context, pillTile.tx, pillTile.ty);
        }
        const bellTile = findNearbyTile(context, assign.room, tile, { radius: 2 });
        if (bellTile) {
          placements.push({ type: 'bell', tx: bellTile.tx, ty: bellTile.ty, patientId });
          markOccupied(context, bellTile.tx, bellTile.ty);
        }
      }
    }
  }

  function handleNpcRule(rule, context, placements){
    const kind = String(rule.kind || rule.sub || '').toLowerCase() || 'npc';
    if (rule.unique && context.uniqueNPCs.has(kind)) return;
    const total = Number.isFinite(rule.count) ? Math.max(1, rule.count | 0) : 1;
    const defaultRooms = context.rooms.filter((room) => room !== context.bossRoom);
    const rooms = resolveRoomsForRule(context, rule, defaultRooms);
    const assignments = distributeCountAcrossRooms(context, rooms, rule, total);
    for (const assign of assignments) {
      for (let i = 0; i < assign.count; i++) {
        if (rule.unique && context.uniqueNPCs.has(kind)) break;
        const tile = randomTileInRoom(context, assign.room, { margin: 1 });
        if (!tile) continue;
        placements.push({
          type: 'npc',
          tx: tile.tx,
          ty: tile.ty,
          sub: kind,
          kind,
          unique: !!rule.unique,
          lightAlpha: Number(rule.lightAlpha) || context.globals?.defaultLightAlpha || 0.6
        });
        markOccupied(context, tile.tx, tile.ty);
        if (rule.unique) context.uniqueNPCs.add(kind);
      }
    }
  }

  function handleEnemyRule(rule, context, placements){
    const kind = String(rule.kind || rule.sub || '').toLowerCase() || 'enemy';
    const total = Number.isFinite(rule.count) ? Math.max(0, rule.count | 0) : context.rooms.length;
    const defaultRooms = context.rooms.filter((room) => room !== context.controlRoom);
    const rooms = resolveRoomsForRule(context, rule, defaultRooms);
    const assignments = distributeCountAcrossRooms(context, rooms, rule, total);
    for (const assign of assignments) {
      for (let i = 0; i < assign.count; i++) {
        const tile = randomTileInRoom(context, assign.room, { margin: 0 });
        if (!tile) continue;
        placements.push({
          type: 'enemy',
          tx: tile.tx,
          ty: tile.ty,
          sub: kind,
          difficulty: Number(rule.difficulty) || context.level?.difficulty || 1,
          speedScale: Number(rule.speedScale) || null,
          chaseRadius: Number(rule.chaseRadius) || null
        });
        markOccupied(context, tile.tx, tile.ty);
      }
    }
  }

  function handleCartRule(rule, context, placements){
    const kind = String(rule.kind || rule.sub || 'cart').toLowerCase();
    const total = Number.isFinite(rule.count) ? Math.max(0, rule.count | 0) : context.rooms.length;
    const defaultRooms = context.rooms.filter((room) => room !== context.bossRoom);
    const rooms = resolveRoomsForRule(context, rule, defaultRooms);
    const assignments = distributeCountAcrossRooms(context, rooms, rule, total);
    for (const assign of assignments) {
      for (let i = 0; i < assign.count; i++) {
        const tile = randomTileInRoom(context, assign.room, { margin: 1 });
        if (!tile) continue;
        placements.push({ type: 'cart', tx: tile.tx, ty: tile.ty, sub: kind });
        markOccupied(context, tile.tx, tile.ty);
      }
    }
  }

  function handleDoorRule(rule, context, placements){
    const tile = resolveDoorTile(rule, context);
    if (!tile) return;
    placements.push({
      type: 'door',
      tx: tile.tx,
      ty: tile.ty,
      sub: rule.kind || 'door',
      bossDoor: String(rule.kind || '').toLowerCase().includes('urgencias')
    });
    markOccupied(context, tile.tx, tile.ty);
  }

  function handleElevatorRule(rule, context, placements){
    const connections = parseConnections(rule.connect);
    if (!connections.length) return;
    const forbidIn = parseTagList(rule.forbidIn);
    const forbidTo = parseTagList(rule.forbidTo);
    const maxPairs = Number.isFinite(rule.count) ? Math.max(0, rule.count | 0) : connections.length;
    let pairsPlaced = 0;
    for (const conn of connections) {
      if (pairsPlaced >= maxPairs) break;
      const fromRoom = resolveRoomIdentifier(context, conn.from);
      const toRoom = resolveRoomIdentifier(context, conn.to);
      if (!fromRoom || !toRoom) continue;
      if (forbidIn.has(normalizeRoomTag(fromRoom))) continue;
      if (forbidTo.has(normalizeRoomTag(toRoom))) continue;
      if (fromRoom === context.bossRoom || toRoom === context.bossRoom) continue;
      const aTile = randomTileInRoom(context, fromRoom, { margin: 1 });
      const bTile = randomTileInRoom(context, toRoom, { margin: 1 });
      if (!aTile || !bTile) continue;
      const pairId = `EV${++context.counters.elevator}`;
      placements.push({ type: 'elevator', tx: aTile.tx, ty: aTile.ty, pairId, link: `${fromRoom.id}->${toRoom.id}` });
      placements.push({ type: 'elevator', tx: bTile.tx, ty: bTile.ty, pairId, link: `${fromRoom.id}->${toRoom.id}` });
      markOccupied(context, aTile.tx, aTile.ty);
      markOccupied(context, bTile.tx, bTile.ty);
      pairsPlaced++;
    }
  }

  function handlePhoneRule(rule, context, placements){
    const targetRoom = resolveRoomIdentifier(context, rule.at || 'room:control') || context.controlRoom || context.entranceRoom;
    if (!targetRoom) return;
    const tile = randomTileInRoom(context, targetRoom, { margin: 1 });
    if (!tile) return;
    placements.push({ type: 'phone', tx: tile.tx, ty: tile.ty });
    markOccupied(context, tile.tx, tile.ty);
  }

  function handleLightRule(rule, context, placements){
    const kind = String(rule.kind || 'normal').toLowerCase();
    const total = Number.isFinite(rule.count) ? Math.max(0, rule.count | 0) : context.rooms.length * Math.max(1, parsePerRoom(rule.perRoom).max || 1);
    const rooms = resolveRoomsForRule(context, rule, context.rooms);
    const assignments = distributeCountAcrossRooms(context, rooms, rule, total);
    for (const assign of assignments) {
      for (let i = 0; i < assign.count; i++) {
        const tile = randomTileInRoom(context, assign.room, { margin: 0 });
        if (!tile) continue;
        const placement = {
          type: 'light',
          tx: tile.tx,
          ty: tile.ty,
          sub: kind,
          kind,
          alpha: Number(rule.alpha) || context.globals?.defaultLightAlpha || 0.6
        };
        placements.push(placement);
        context.lightPlacements.push(placement);
        markOccupied(context, tile.tx, tile.ty);
      }
    }
  }

  function finalizeLights(context){
    const lights = context.lightPlacements || [];
    if (!lights.length) return;
    const brokenRate = Math.max(0, Math.min(1, context.lightBrokenRate || 0));
    if (brokenRate <= 0) return;
    const brokenCount = Math.floor(lights.length * brokenRate);
    if (brokenCount <= 0) return;
    const pool = context.rng.shuffle(lights.slice());
    for (let i = 0; i < brokenCount && i < pool.length; i++) {
      pool[i].broken = true;
    }
  }

  function parseNamesList(value){
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    return String(value).split(',').map((s) => s.trim()).filter(Boolean);
  }

  function generateFallbackPatientName(context){
    const pool = ['Dolores', 'Angustias', 'Raymunda', 'Constanza', 'Flor', 'Soledad'];
    return context.rng.pick(pool) || genFunnyName();
  }

  function resolveDoorTile(rule, context){
    const at = String(rule.at || '').toLowerCase();
    if (at === 'bossroomentrance' && context.bossEntrance) {
      return context.bossEntrance;
    }
    const room = resolveRoomIdentifier(context, at) || context.bossRoom || context.controlRoom;
    if (!room) return null;
    const tile = randomTileInRoom(context, room, { margin: 0 });
    return tile;
  }

  function parseConnections(value){
    if (!value) return [];
    return String(value).split(',').map((entry) => {
      const [from, to] = entry.split('->').map((s) => s.trim());
      return { from, to };
    }).filter((conn) => conn.from && conn.to);
  }

  function parseTagList(value){
    const set = new Set();
    if (!value) return set;
    const parts = Array.isArray(value) ? value : String(value).split(',');
    for (const item of parts) {
      if (!item) continue;
      set.add(item.toString().trim().toLowerCase());
    }
    return set;
  }

  function normalizeRoomTag(room){
    if (!room) return '';
    const tag = String(room.tag || '').toLowerCase();
    if (tag) return tag;
    return `room:${String(room.id || '').toLowerCase()}`;
  }

  function resolveRoomIdentifier(context, id){
    if (!id) return null;
    const key = String(id).toLowerCase();
    if (context.byTag.has(key)) return context.byTag.get(key);
    if (context.byTag.has(`room:${key}`)) return context.byTag.get(`room:${key}`);
    return null;
  }

  function resolveRoomsForRule(context, rule, defaults){
    if (!rule?.at) return defaults;
    const at = String(rule.at).toLowerCase();
    if (at === 'room:control') return context.controlRoom ? [context.controlRoom] : defaults;
    if (at === 'room:entrance') return context.entranceRoom ? [context.entranceRoom] : defaults;
    if (at === 'room:near_boss') {
      const room = findRoomNear(context, context.bossRoom);
      return room ? [room] : defaults;
    }
    if (context.byTag.has(at)) return [context.byTag.get(at)];
    if (context.byTag.has(`room:${at}`)) return [context.byTag.get(`room:${at}`)];
    return defaults;
  }

  function findRoomNear(context, target){
    if (!target) return null;
    let best = null;
    let bestDist = Infinity;
    for (const room of context.rooms) {
      if (room === target) continue;
      const dx = room.center.tx - target.center.tx;
      const dy = room.center.ty - target.center.ty;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = room;
      }
    }
    return best;
  }

  function distributeCountAcrossRooms(context, rooms, rule, total){
    if (!rooms.length) return [];
    const range = parsePerRoom(rule.perRoom, total);
    let remaining = Number.isFinite(total) ? Math.max(0, total | 0) : rooms.length * Math.max(range.max, range.min);
    const assignments = rooms.map(() => 0);
    const indices = rooms.map((_, idx) => idx);
    context.rng.shuffle(indices);
    const minPer = Math.max(0, range.min);
    for (const idx of indices) {
      if (remaining <= 0) break;
      const give = Math.min(minPer, remaining);
      assignments[idx] += give;
      remaining -= give;
    }
    while (remaining > 0) {
      let progressed = false;
      context.rng.shuffle(indices);
      for (const idx of indices) {
        const maxForRoom = Number.isFinite(range.max) ? range.max : remaining + assignments[idx];
        if (assignments[idx] >= maxForRoom) continue;
        assignments[idx] += 1;
        remaining -= 1;
        progressed = true;
        if (remaining <= 0) break;
      }
      if (!progressed) break;
    }
    return rooms.map((room, idx) => ({ room, count: assignments[idx] }));
  }

  function parsePerRoom(value, defaultCount){
    if (value == null) {
      const max = Number.isFinite(defaultCount) ? Math.max(1, Math.round(defaultCount)) : 1;
      return { min: 0, max };
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { min: Math.max(0, value | 0), max: Math.max(0, value | 0) };
    }
    const str = String(value).trim();
    if (str.includes('-')) {
      const [a, b] = str.split('-').map((s) => parseInt(s.trim(), 10));
      const min = Number.isFinite(a) ? Math.max(0, a) : 0;
      const max = Number.isFinite(b) ? Math.max(min, b) : min;
      return { min, max };
    }
    const num = parseInt(str, 10);
    if (Number.isFinite(num)) {
      const val = Math.max(0, num);
      return { min: val, max: val };
    }
    return { min: 0, max: Number.isFinite(defaultCount) ? Math.max(1, defaultCount) : 1 };
  }

  function randomTileInRoom(context, room, opts = {}){
    if (!room) return null;
    const margin = Math.max(0, opts.margin == null ? 0 : opts.margin);
    const tries = opts.tries || 40;
    for (let attempt = 0; attempt < tries; attempt++) {
      const tx = context.rng.int(room.x + margin, room.x + room.w - 1 - margin);
      const ty = context.rng.int(room.y + margin, room.y + room.h - 1 - margin);
      if (!isInsideRoom(room, tx, ty)) continue;
      if (!isFloor(context, tx, ty)) continue;
      if (isOccupied(context, tx, ty)) continue;
      return { tx, ty };
    }
    for (let attempt = 0; attempt < tries; attempt++) {
      const tx = context.rng.int(room.x, room.x + room.w - 1);
      const ty = context.rng.int(room.y, room.y + room.h - 1);
      if (!isFloor(context, tx, ty)) continue;
      if (isOccupied(context, tx, ty)) continue;
      return { tx, ty };
    }
    const fallback = { tx: room.x + Math.floor(room.w / 2), ty: room.y + Math.floor(room.h / 2) };
    if (isFloor(context, fallback.tx, fallback.ty)) return fallback;
    return null;
  }

  function findNearbyTile(context, room, origin, opts = {}){
    if (!room) return null;
    if (!origin) return randomTileInRoom(context, room, opts);
    const radius = Math.max(1, opts.radius || 2);
    for (let attempt = 0; attempt < 30; attempt++) {
      const tx = origin.tx + context.rng.int(-radius, radius);
      const ty = origin.ty + context.rng.int(-radius, radius);
      if (!isInsideRoom(room, tx, ty)) continue;
      if (!isFloor(context, tx, ty)) continue;
      if (isOccupied(context, tx, ty)) continue;
      return { tx, ty };
    }
    return randomTileInRoom(context, room, { margin: 0 });
  }

  function isInsideRoom(room, tx, ty){
    return tx >= room.x && tx < room.x + room.w && ty >= room.y && ty < room.y + room.h;
  }

  function isFloor(context, tx, ty){
    const map = context.grid?.map;
    if (!Array.isArray(map)) return true;
    return map[ty]?.[tx] === 0;
  }

  function isOccupied(context, tx, ty){
    return context.occupancy.has(`${tx},${ty}`);
  }

  function markOccupied(context, tx, ty){
    context.occupancy.add(`${tx},${ty}`);
  }

  async function applyFromXML(cfg = {}){
    const G = cfg?.G || root.G || (root.G = {});
    const levelId = cfg?.level || G.level || 1;
    if (typeof root.XMLRules?.load !== 'function' || typeof root.MapGen?.ensureGrid !== 'function') {
      return applyFromAsciiLegacy(cfg);
    }

    const data = await root.XMLRules.load(levelId);
    const { globals = {}, level = {}, rules = [] } = data || {};

    const grid = root.MapGen.ensureGrid({
      width: level.width,
      height: level.height,
      rooms: level.rooms,
      roomSizeMin: level.roomSizeMin,
      roomSizeMax: level.roomSizeMax,
      corridors: level.corridors !== false,
      seed: level.seed
    });

    const map = grid?.map;
    if (!Array.isArray(map) || !map.length) {
      return applyFromAsciiLegacy(cfg);
    }

    const baseCfg = {
      ...cfg,
      G,
      map,
      width: grid.width,
      height: grid.height,
      areas: {
        control: grid.control,
        boss: grid.boss,
        entrance: grid.entrance,
        rooms: grid.rooms
      }
    };

    if (!Placement.shouldRun(baseCfg)) {
      return { applied: false, reason: 'guard' };
    }

    applyGlobals(globals, G);

    const rng = (typeof root.MapGen?.createRNG === 'function')
      ? root.MapGen.createRNG(level.seed)
      : createFallbackRNG(level.seed);

    const context = buildXmlPlacementContext(grid, rng, rules, level, globals);
    const placements = buildPlacementsFromRules(context);

    // Hero spawn placement (first hero handled by legacy pipeline)
    const heroTile = context.spawnTile;
    if (heroTile) {
      markOccupied(context, heroTile.tx, heroTile.ty);
      placements.push({ type: 'hero', tx: heroTile.tx, ty: heroTile.ty, heroKey: globals.defaultHero || null });
    }

    const patientEntries = placements.filter((p) => p.type === 'patient');
    const pillEntries = placements.filter((p) => p.type === 'pill');
    const bellEntries = placements.filter((p) => p.type === 'bell');
    const otherPlacements = placements.filter((p) => !['patient', 'pill', 'bell'].includes(p.type));

    const legacyResult = applyFromAsciiLegacy({
      ...baseCfg,
      placements: otherPlacements
    });

    if (legacyResult?.applied && level.heroes > 1) {
      spawnAdditionalHeroes(level.heroes - 1, heroTile, context, baseCfg, G);
    }

    if (legacyResult?.applied) {
      spawnPatientsFromXml(patientEntries, pillEntries, bellEntries, baseCfg, G);
    }

    applyLightingConfig(level.lighting, G);
    G.levelRules = { globals, level, rules };
    G.__placementsApplied = true;

    try { root.LOG?.event?.('PLACEMENT_SUMMARY', Placement.summarize()); } catch (_) {}
    return legacyResult;
  }

  Placement.summarize = function summarize(){
    const counts = Placement._counts || {};
    let total = 0;
    for (const key of Object.keys(counts)) total += counts[key];
    return { countsPorTipo: { ...counts }, total };
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function registerEntityForPlacement(G, entity){
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
    Placement._counts = Placement._counts || {};
    Placement._counts[kindKey] = (Placement._counts[kindKey] || 0) + 1;
    try { root.AI?.register?.(entity); } catch (_) {}
  }

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

  function registerSpawnerPlacements(cfg, G){
    if (!root.SpawnerManager || typeof root.SpawnerManager.registerPoint !== 'function') return;
    const placements = getPlacements(cfg);
    if (!Array.isArray(placements) || !placements.length) return;
    for (const entry of placements) {
      if (!entry || !entry.type) continue;
      const type = String(entry.type || '').toLowerCase();
      if (!type.startsWith('spawn_')) continue;
      const { tx, ty } = normalizePlacementToTile(entry, cfg);
      try {
        if (type === 'spawn_animal') {
          const allowSet = new Set(['mosquito', 'rat']);
          if (Array.isArray(entry?.allows)) {
            for (const tag of entry.allows) allowSet.add(String(tag || '').toLowerCase());
          }
          const allows = Array.from(allowSet).filter(Boolean);
          const prefer = String(entry?.prefers || '').toLowerCase();
          const opts = { inTiles: true, allows };
          if (prefer && allows.includes(prefer)) opts.prefer = prefer;
          root.SpawnerManager.registerPoint('enemy', tx, ty, opts);
        } else {
          const payload = { ...entry, inTiles: true, x: tx, y: ty };
          if (typeof root.SpawnerManager.registerFromPlacement === 'function') {
            root.SpawnerManager.registerFromPlacement(payload);
          } else {
            const kind = type === 'spawn_staff' ? 'npc' : (type === 'spawn_cart' ? 'cart' : 'enemy');
            root.SpawnerManager.registerPoint(kind, tx, ty, { inTiles: true });
          }
        }
      } catch (err) {
        try {
          console.warn('[Placement] spawner registration failed', type, err);
        } catch (_) {}
      }
    }
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
        let idx = row.indexOf('S');
        if (idx >= 0) return { tx: idx, ty };
        idx = row.indexOf('s');
        if (idx >= 0) return { tx: idx, ty };
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

  function spawnFuriousFromPlacement(x, y, cfg, G){
    const tile = TILE_SIZE();
    const size = tile * 0.9;
    const px = x - size * 0.5;
    const py = y - size * 0.5;
    if (root.FuriousAPI?.spawnFromPatient) {
      const stub = {
        x: px,
        y: py,
        w: size,
        h: size,
        vx: 0,
        vy: 0,
        dead: false,
        kind: 'PATIENT'
      };
      try {
        if (Array.isArray(G?.entities)) G.entities.push(stub);
        if (Array.isArray(G?.patients)) G.patients.push(stub);
        const spawned = root.FuriousAPI.spawnFromPatient(stub, { skipCounters: true });
        if (spawned) return spawned;
      } catch (err) {
        try { console.warn('[Placement] FuriousAPI.spawnFromPatient', err); } catch (_) {}
      } finally {
        if (Array.isArray(G?.patients)) {
          const idx = G.patients.indexOf(stub);
          if (idx >= 0) G.patients.splice(idx, 1);
        }
        if (Array.isArray(G?.entities)) {
          const idx = G.entities.indexOf(stub);
          if (idx >= 0) G.entities.splice(idx, 1);
        }
      }
    }
    const furious = {
      kind: 'FURIOUS',
      x: px,
      y: py,
      w: size,
      h: size,
      vx: 0,
      vy: 0,
      solid: true,
      dynamic: true,
      pushable: true,
      rigOk: false
    };
    try {
      const puppet = root.Puppet?.bind?.(furious, 'patient_furiosa', { z: 0, scale: 1 })
        || root.PuppetAPI?.attach?.(furious, { rig: 'patient_furiosa', z: 0, scale: 1 });
      if (puppet) furious.rigOk = true;
    } catch (_) {}
    return furious;
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
        } else if (subtype.includes('furious')) {
          entity = spawnFuriousFromPlacement(world.x, world.y, cfg, G);
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
        const sub = String(entry?.sub || '').toLowerCase();
        const normalized = sub === 'urgencias' ? 'er'
          : (sub === 'medicinas' || sub === 'meds' ? 'med'
          : (sub === 'comida' || sub === 'food' ? 'food' : (sub || 'med')));
        const payload = { ...entry, sub: normalized };
        entity = root.Entities.Cart.spawn(normalized, world.x, world.y, payload);
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
      } else if (type === 'bell') {
        entity = spawnBell(tx, ty, entry || {}, cfg, G);
      } else if (type === 'hazard_wet') {
        if (root.HazardsAPI?.spawnWet) {
          entity = root.HazardsAPI.spawnWet(tx, ty, entry || {});
        } else {
          const size = TILE_SIZE() * 0.8;
          entity = {
            kind: 'HAZARD_WET',
            x: world.x + (TILE_SIZE() - size) * 0.5,
            y: world.y + (TILE_SIZE() - size) * 0.5,
            w: size,
            h: size,
            solid: false,
            dynamic: false,
            pushable: false,
            rigOk: false
          };
        }
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
