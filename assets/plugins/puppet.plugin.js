// ./assets/plugins/puppet.plugin.js
(function(){
  const PuppetNS = window.Puppet || (window.Puppet = {});
  const registry = PuppetNS.RIGS = PuppetNS.RIGS || Object.create(null);
  const rigs = new Map();
  const puppets = [];
  let needsSort = false;
  const missingRigWarnings = new Set();
  let activityLog = new WeakMap();
  const fallbackErrorLabels = new Set();
  const rigCheckTargets = new Set(['door', 'door_urgencias', 'elevator', 'hazard_fire', 'hazard_water']);
  const rigOptionalKinds = new Set(['bell', 'timbre', 'hud', 'decor']);
  const rigOptionalSprites = new Set(['timbre_apagado.png', 'timbre_encendido.png']);
  const rigAuditSummary = { printed: false };
  let lastActivitySummary = '';
  const debugStatus = { rigs: false, lights: false, activity: false, successAnnounced: false };
  const rigAuditState = { lastTime: 0, lastCount: 0 };
  const RESET_EVENT = 'reset';

  function shouldLogDebug(){
    if (typeof window === 'undefined') return false;
    if (window.DEBUG_FORCE_ASCII) return true;
    try {
      const search = typeof window.location === 'object' ? (window.location.search || '') : '';
      if (!search) return false;
      const params = new URLSearchParams(search);
      if (params.has('rigdebug') || params.has('rigs') || params.get('debug') === 'rigs') return true;
    } catch (_) {}
    return false;
  }

  const getNow = () => (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();

  function getTileSize(){
    const size = window.G?.TILE_SIZE ?? window.TILE_SIZE ?? window.TILE ?? 32;
    const num = Number(size);
    return Number.isFinite(num) && num > 0 ? num : 32;
  }

  function resolveCullingRadiusTiles(){
    const raw = Number(window.G?.cullingRadiusTiles ?? window.G?.culling);
    return Number.isFinite(raw) && raw > 0 ? raw : 20;
  }

  function resolveCullingRadiusPx(){
    const G = window.G || {};
    const px = Number(G.cullingRadiusPx);
    if (Number.isFinite(px) && px > 0) return px;
    const tiles = resolveCullingRadiusTiles();
    const tile = getTileSize();
    const computed = Math.max(1, tiles * tile);
    G.cullingRadiusPx = computed;
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

  function computeCullingContext(hero){
    const base = computeHeroInfo(hero);
    const radius = Math.max(1, resolveCullingRadiusPx());
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

  function withinCullingRadius(entity, heroInfo, details){
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
    const logActivity = shouldLogDebug() || window.DEBUG_PUPPET_ACTIVITY;
    for (const ent of entities){
      if (!ent) continue;
      let active = true;
      let distanceSq = null;
      if (heroInfo?.hero && ent !== heroInfo.hero){
        if (isEntityAlwaysActive(ent, now)) {
          active = true;
        } else {
          distInfo.distanceSq = null;
          active = withinCullingRadius(ent, heroInfo, distInfo);
          if (distInfo.distanceSq != null) distanceSq = distInfo.distanceSq;
        }
      }
      ent._inactive = !active;
      if (active) activeCount++; else inactiveCount++;
      const prev = activityLog.get(ent);
      if (prev !== active){
        activityLog.set(ent, active);
      }
    }
    const summaryKey = `${activeCount}|${inactiveCount}`;
    if (logActivity && summaryKey !== lastActivitySummary){
      lastActivitySummary = summaryKey;
      const radiusPx = heroInfo?.radius ? Math.round(heroInfo.radius) : 0;
      const tileSize = getTileSize();
      const radiusTiles = radiusPx > 0 && tileSize > 0 ? radiusPx / tileSize : resolveCullingRadiusTiles();
      try {
        console.log(`[Puppet] Radio visual ≈ ${radiusTiles.toFixed(1)} tiles (~${radiusPx}px). Activos: ${activeCount}, Inactivos: ${inactiveCount}.`);
      } catch (_) {}
      debugStatus.activity = true;
      maybeReportIntegrationSuccess();
    }
  }

  function normalizeLookupKey(value){
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
  }

  const RIG_NAME_LOOKUP = {
    kind: {
      hero: (ent) => {
        const key = normalizeLookupKey(ent?.hero || ent?.heroKey || ent?.key || ent?.id || '');
        if (key) return `hero_${key}`;
        return null;
      },
      familiar: 'npc_familiar_molesto',
      familiar_molesto: 'npc_familiar_molesto',
      cleaner: 'npc_limpiadora',
      medic: 'npc_medico',
      medico: 'npc_medico',
      enfermera: 'npc_enfermera_enamoradiza',
      supervisora: 'npc_supervisora',
      jefe_servicio: 'npc_jefe_servicio',
      furiosa: 'patient_furiosa',
      patient: 'patient_bed',
      cart: (ent) => {
        const type = normalizeLookupKey(ent?.cartType || 'med');
        if (type === 'er') return 'cart_emergency';
        if (type === 'food') return 'cart_food';
        return 'cart_meds';
      },
      door: 'door',
      door_urgencias: 'door_urgencias',
      elevator: 'elevator',
      light: 'light',
      phone: 'phone',
      hazard_fire: 'hazard_fire',
      hazard_water: 'hazard_water',
      pill: 'pill',
      mosquito: 'mosquito',
      rat: 'rat'
    },
    role: {
      hero: (ent) => {
        const key = normalizeLookupKey(ent?.hero || ent?.heroKey || ent?.key || '');
        return key ? `hero_${key}` : null;
      },
      follower: (ent) => {
        const key = normalizeLookupKey(ent?.hero || ent?.heroKey || ent?.key || '');
        return key ? `hero_${key}` : null;
      },
      medico: 'npc_medico',
      enfermera: 'npc_enfermera_enamoradiza',
      supervisora: 'npc_supervisora',
      jefe_servicio: 'npc_jefe_servicio',
      familiar: 'npc_familiar_molesto',
      furiosa: 'patient_furiosa',
      cleaner: 'npc_limpiadora'
    },
    spriteKey: {
      timbre_apagado: null,
      timbre_encendido: null,
      medico: 'npc_medico',
      medico_png: 'npc_medico',
      'medico.png': 'npc_medico',
      supervisora: 'npc_supervisora',
      supervisora_png: 'npc_supervisora',
      'supervisora.png': 'npc_supervisora',
      enfermera_sexy: 'npc_enfermera_enamoradiza',
      enfermera: 'npc_enfermera_enamoradiza',
      enfermera_png: 'npc_enfermera_enamoradiza',
      'enfermera_sexy.png': 'npc_enfermera_enamoradiza',
      paciente_furiosa: 'patient_furiosa',
      paciente_furiosa_png: 'patient_furiosa',
      'paciente_furiosa.png': 'patient_furiosa',
      familiar_molesto: 'npc_familiar_molesto',
      familiar_molesto_png: 'npc_familiar_molesto',
      'familiar_molesto.png': 'npc_familiar_molesto',
      jefe_servicio: 'npc_jefe_servicio',
      jefe_servicio_png: 'npc_jefe_servicio',
      'jefe_servicio.png': 'npc_jefe_servicio',
      chica_limpieza: 'npc_limpiadora',
      chica_limpieza_png: 'npc_limpiadora',
      'chica_limpieza.png': 'npc_limpiadora'
    }
  };

  function isRigOptional(ent){
    const kind = normalizeLookupKey(ent?.kind || ent?.kindName || ent?.type || ent?.tag);
    if (rigOptionalKinds.has(kind)) return true;
    const sprite = normalizeLookupKey(ent?.spriteKey || ent?._spriteIdle || ent?._spriteRinging || ent?.skin);
    if (!sprite) return false;
    const clean = sprite.replace(/\.png$/i, '');
    return rigOptionalSprites.has(sprite) || rigOptionalSprites.has(`${clean}.png`);
  }

  function resolveMappedRig(ent){
    if (!ent || typeof ent !== 'object') return null;
    const kinds = [ent.kind, ent.kindName, ent.type, ent.entityType, ent.tag, ent.role, ent.sub];
    for (const raw of kinds){
      const key = normalizeLookupKey(raw);
      if (!key) continue;
      const entry = RIG_NAME_LOOKUP.kind[key];
      if (typeof entry === 'function'){
        const rig = entry(ent);
        if (rig) return rig;
      } else if (typeof entry === 'string'){
        return entry;
      }
    }
    const role = normalizeLookupKey(ent.role || ent.sub || ent.tag);
    if (role){
      const entry = RIG_NAME_LOOKUP.role[role];
      if (typeof entry === 'function'){
        const rig = entry(ent);
        if (rig) return rig;
      } else if (typeof entry === 'string'){
        return entry;
      }
    }
    const spriteRaw = normalizeLookupKey(ent.spriteKey || ent._spriteIdle || ent._spriteRinging || ent.skin);
    if (spriteRaw){
      const clean = spriteRaw.replace(/\.png$/i, '');
      const entry = RIG_NAME_LOOKUP.spriteKey[spriteRaw] ?? RIG_NAME_LOOKUP.spriteKey[clean];
      if (typeof entry === 'string') return entry;
      if (entry === null) return null;
    }
    return null;
  }

  function resolveRigName(name, entity){
    const key = typeof name === 'string' ? name : null;
    if (key && (registry[key] || rigs.get(key))) return key;
    const mapped = resolveMappedRig(entity);
    if (mapped && (registry[mapped] || rigs.get(mapped))) return mapped;
    if (key && !missingRigWarnings.has(key)){
      missingRigWarnings.add(key);
      if (!isRigOptional(entity)){
        try {
          console.error(`[RigError] No se encontró rig para kind=${entity?.kind || entity?.kindName || 'desconocido'} / spriteKey=${entity?.spriteKey || entity?.skin || 'none'}`);
        } catch (_) {}
      }
    }
    return 'default';
  }

  function registerRig(name, rig){
    if (!name || !rig){
      try { console.warn('[Puppet] Registro de rig inválido', { name, hasRig: !!rig }); } catch (_) {}
      return;
    }
    try {
      rigs.set(name, rig);
      registry[name] = rig;
    } catch (err){
      try { console.error(`[Puppet] No se pudo registrar rig '${name}'`, err); } catch (_) {}
    }
  }

  function cleanupPuppet(puppet){
    if (!puppet) return;
    const entity = puppet.entity;
    try {
      const rig = rigs.get(puppet.rigName) || registry[puppet.rigName];
      if (rig && typeof rig.dispose === 'function'){
        try {
          rig.dispose(puppet.state, entity, puppet);
        } catch (err){
          console.warn('[Puppet] rig.dispose', puppet.rigName, err);
        }
      }
    } catch (err){
      console.warn('[Puppet] cleanup error', err);
    }
    if (entity){
      if (entity.puppet === puppet) delete entity.puppet;
      if (entity.rigName === puppet.rigName) delete entity.rigName;
      entity.rigOk = false;
    }
  }

  function detach(entity){
    if (!entity || !entity.puppet) return;
    const puppet = entity.puppet;
    const idx = puppets.indexOf(puppet);
    if (idx >= 0) puppets.splice(idx, 1);
    cleanupPuppet(puppet);
  }

  function attach(entity, opts={}){
    if (!entity) return null;
    detach(entity);
    const requestedRig = opts.rig || opts.name || entity.rigName;
    const resolvedRig = resolveRigName(requestedRig, entity);
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
    entity.puppet = puppet;
    if (entity) {
      entity.rigName = puppet.rigName;
      entity.rigOk = puppet.rigName && puppet.rigName !== 'default';
      if (!entity.rigOk && isRigOptional(entity)) entity.rigOk = true;
      if (puppet.rigName === 'default' && requestedRig && requestedRig !== 'default'){
        const label = describeEntity(entity);
        const kind = entity?.kind ?? entity?.kindName ?? entity?.tag ?? 'desconocido';
        const key = `${label}|${kind}`;
        if (!fallbackErrorLabels.has(key)){
          fallbackErrorLabels.add(key);
          try {
            console.error(`[Puppet] ERROR: Entidad '${label}' (kind=${kind}) está usando rig fallback 'default'. Revisa la asociación de rigs.`);
          } catch (_) {}
        }
      }
    }
    puppets.push(puppet);
    needsSort = true;
    return puppet;
  }

  function bind(entity, rigName, opts={}){
    if (!entity) return null;
    const name = resolveRigName(rigName, entity);
    if (name === 'default' && rigName && rigName !== 'default'){
      const label = describeEntity(entity);
      if (!isRigOptional(entity)){
        try {
          console.error(`[RigError] No se encontró rig para kind=${entity?.kind || entity?.kindName || 'desconocido'} / spriteKey=${entity?.spriteKey || entity?.skin || 'none'}`);
        } catch (_) {}
      }
      entity.rigOk = false;
    }
    const puppet = attach(entity, { ...opts, rig: name });
    const rig = registry[name];
    try {
      if (rig && typeof rig.create === 'function') {
        puppet.state = rig.create(entity, opts) || puppet.state || { e: entity };
      }
      entity.rigOk = puppet.rigName && puppet.rigName !== 'default';
      if (!entity.rigOk && isRigOptional(entity)) entity.rigOk = true;
    } catch (err) {
      const label = describeEntity(entity);
      try {
        console.error(`[Puppet.bind] Error al inicializar rig '${rigName}' para ${label || 'entidad'}; se usará fallback 'default'.`, err);
      } catch (_) {}
      debugStatus.rigs = false;
      debugStatus.successAnnounced = false;
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
      entity.rigOk = false;
      const kind = entity?.kind ?? entity?.kindName ?? 'desconocido';
      const key = `${label}|${kind}`;
      if (!fallbackErrorLabels.has(key)){
        fallbackErrorLabels.add(key);
        try {
          console.error(`[Puppet] ERROR: Entidad '${label}' (kind=${kind}) está usando rig fallback 'default'. Revisa la asociación de rigs.`);
        } catch (_) {}
      }
      try {
        console.warn(`[Puppet.bind] Fallback aplicado a ${label || 'entidad'} (${entity.rigName}).`);
      } catch (_) {}
    }
    if (rigCheckTargets.has(name)){
      const label = describeEntity(entity) || entity?.kind || entity?.tag || 'Entidad';
      const status = name === 'default' ? '⚠️' : '✔';
      try {
        console.info(`[RigCheck] ${label} -> rigName=${name} ${status}`);
      } catch (_) {}
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
      const previous = puppet.rigName;
      puppet.rigName = 'default';
      rig = rigs.get('default') || registry.default;
      if (!rig) return null;
      if (previous && previous !== 'default'){
        const label = describeEntity(puppet.entity);
        const kind = puppet.entity?.kind ?? puppet.entity?.kindName ?? 'desconocido';
        const key = `${label}|${kind}`;
        if (!fallbackErrorLabels.has(key)){
          fallbackErrorLabels.add(key);
          try {
            console.error(`[Puppet] ERROR: Entidad '${label}' (kind=${kind}) está usando rig fallback 'default'. Revisa la asociación de rigs.`);
          } catch (_) {}
        }
      }
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

  function describeEntity(ent, idx){
    if (!ent) return idx != null ? `entity@${idx}` : 'entidad-desconocida';
    return ent.name || ent.displayName || ent.label || ent.id || ent.kindName || ent.kind || (idx != null ? `entity@${idx}` : 'entidad');
  }

  function gatherRigCandidates(ent){
    const out = [];
    if (!ent || typeof ent !== 'object') return out;
    const push = (value) => {
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (!trimmed || trimmed.toLowerCase() === 'default') return;
      if (!out.includes(trimmed)) out.push(trimmed);
    };
    push(ent.expectedRig);
    push(ent.desiredRig);
    push(ent.desiredRigName);
    push(ent.rigNameWanted);
    push(ent.rigWanted);
    push(ent.preferredRig);
    const direct = typeof ent.rigName === 'string' ? ent.rigName.trim() : '';
    if (direct && direct.toLowerCase() !== 'default') push(direct);
    const possibilities = [ent.kind, ent.kindName, ent.type, ent.entityType];
    for (const name of possibilities){
      if (typeof name !== 'string') continue;
      push(name);
      const lower = name.toLowerCase();
      push(lower);
      const camel = lower.replace(/[^a-z0-9]+([a-z0-9])/g, (_, c) => c.toUpperCase());
      push(camel);
    }
    return out;
  }

  function attemptAutoRig(ent, label){
    if (!ent) return false;
    const attempts = ent.__rigAuditAttempts || (ent.__rigAuditAttempts = Object.create(null));
    const candidates = gatherRigCandidates(ent);
    for (const candidate of candidates){
      if (!candidate || attempts[candidate]) continue;
      attempts[candidate] = true;
      const available = registry[candidate] || rigs.get(candidate);
      const fallback = (!available && candidate) ? (registry[candidate.toLowerCase?.()] || rigs.get(candidate.toLowerCase?.())) : null;
      const rigName = available ? candidate : (fallback ? candidate.toLowerCase() : null);
      if (!rigName) continue;
      try {
        console.warn(`[Puppet] Reasignando rig '${rigName}' a ${label}.`);
        const puppet = bind(ent, rigName, ent.puppet?.data ? { data: ent.puppet.data } : {});
        if (puppet && puppet.rigName === rigName){
          ent.rigOk = true;
          return true;
        }
      } catch (err){
        try { console.error(`[Puppet] Error al reasignar rig '${rigName}' a ${label}.`, err); } catch (_) {}
      }
    }
    return false;
  }

  function maybeReportIntegrationSuccess(){
    if (debugStatus.successAnnounced) return;
    if (!debugStatus.rigs || !debugStatus.lights || !debugStatus.activity) return;
    debugStatus.successAnnounced = true;
    try {
      console.log('[Debug] All animations and systems integrated successfully. Rigs: OK, Lights: OK, Off-screen optimization: OK.');
    } catch (_) {}
  }

  function auditRigs(force = false){
    const entities = window.G?.entities;
    if (!Array.isArray(entities) || entities.length === 0) return;
    const now = getNow();
    const count = entities.filter(Boolean).length;
    if (!force){
      const interval = 3500;
      if (now - rigAuditState.lastTime < interval && count === rigAuditState.lastCount) return;
    }
    rigAuditState.lastTime = now;
    rigAuditState.lastCount = count;
    const messages = [];
    let fallbackCount = 0;
    let okCount = 0;
    for (let i = 0; i < entities.length; i++){
      const ent = entities[i];
      if (!ent) continue;
      const label = describeEntity(ent, i);
      let rigName = (ent.rigName || ent.puppet?.rigName || '').toString();
      let ok = ent.rigOk === true && rigName && rigName !== 'default';
      if (!ok){
        const fixed = attemptAutoRig(ent, label);
        if (fixed){
          rigName = (ent.rigName || ent.puppet?.rigName || rigName).toString();
          ok = ent.rigOk === true && rigName && rigName !== 'default';
        }
      }
      if (!ok && !isRigOptional(ent)) fallbackCount++;
      else if (ok) okCount++;
      messages.push(`[Debug] Rigs check: ${label} -> rig=${rigName || 'none'} ${ok ? '✔' : '⚠️'}`);
    }
    if (!rigAuditSummary.printed){
      rigAuditSummary.printed = true;
      try {
        console.info(`[Puppet] Auditoría de rigs: ${okCount} OK, ${fallbackCount} sin rig`);
      } catch (_) {}
    }
    if (!messages.length) return;
    const debugLogging = shouldLogDebug();
    if (!debugLogging && fallbackCount === 0){
      debugStatus.rigs = true;
      maybeReportIntegrationSuccess();
      return;
    }
    if (!debugLogging && fallbackCount > 0){
      debugStatus.rigs = false;
      debugStatus.successAnnounced = false;
      return;
    }
    try {
      for (const msg of messages) console.log(msg);
    } catch (_) {}
    if (fallbackCount === 0){
      debugStatus.rigs = true;
      maybeReportIntegrationSuccess();
    } else {
      debugStatus.rigs = false;
      debugStatus.successAnnounced = false;
    }
  }

  function markLightsReady(){
    debugStatus.lights = true;
    maybeReportIntegrationSuccess();
  }

  function resetAll(opts = {}){
    const reason = opts.reason || RESET_EVENT;
    const countBefore = puppets.length;
    if (shouldLogDebug() || opts.log){
      try { console.log(`[Puppet] Reset(${reason}) antes: ${countBefore} rigs activos.`); } catch (_) {}
    }
    while (puppets.length){
      const puppet = puppets.pop();
      cleanupPuppet(puppet);
    }
    needsSort = false;
    activityLog = new WeakMap();
    rigAuditSummary.printed = false;
    if (opts.clearWarnings !== false) missingRigWarnings.clear();
    if (opts.resetFallbacks !== false) fallbackErrorLabels.clear();
    if (shouldLogDebug() || opts.log){
      try { console.log(`[Puppet] Reset(${reason}) después: ${puppets.length} rigs activos.`); } catch (_) {}
    }
    return countBefore;
  }

  function getActiveCount(){
    return puppets.length;
  }

  function debugListAll(reason = 'manual'){
    if (!shouldLogDebug()) return;
    const entities = window.G?.entities;
    if (!Array.isArray(entities)) return;
    try { console.groupCollapsed(`[Debug] Auditoría de rigs (${reason})`); } catch (_) {}
    for (let i = 0; i < entities.length; i++){
      const ent = entities[i];
      if (!ent) continue;
      const label = describeEntity(ent, i);
      const rigName = ent.rigName || ent.puppet?.rigName || 'default';
      const kind = ent.kind ?? ent.kindName ?? ent.tag ?? '—';
      const ok = ent.rigOk === true && rigName && rigName !== 'default';
      try { console.log(`[Debug] Entidad ${label} kind=${kind} rig=${rigName} rigOk=${ok}`); } catch (_) {}
    }
    try { console.groupEnd(); } catch (_) {}
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

  PuppetNS.__debugStatus = debugStatus;
  PuppetNS.__notifyLightsReady = markLightsReady;

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
    const context = computeCullingContext(hero);
    if (window.G) {
      if (hero) {
        window.G.__cullingInfo = {
          radiusTiles: resolveCullingRadiusTiles(),
          radiusPx: context.radius,
          radiusSq: context.radiusSq,
          hx: context.hx,
          hy: context.hy,
          timestamp: context.now
        };
      } else {
        window.G.__cullingInfo = null;
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
    auditRigs();
  }

  function drawAll(ctx, cam){
    if (!ctx) return;
    sortPuppets();
    const camera = ensureCamera(ctx, cam);
    const G = window.G || {};
    const player = G.player || null;
    const tileSize = getTileSize();
    const radiusValue = Number(G.cullingRadiusTiles);
    const baseRadius = Number.isFinite(radiusValue) && radiusValue > 0 ? radiusValue : 20;
    const entityRadius = Math.max(0, Math.ceil(baseRadius)) + 1;
    const applyCull = !!player && !G.isDebugMap && tileSize > 0;
    const playerX = player ? (Number(player.x) || 0) : 0;
    const playerY = player ? (Number(player.y) || 0) : 0;

    ctx.save();
    try {
      if (typeof window.applyWorldCamera === 'function') {
        window.applyWorldCamera(ctx);
      }
      for (const puppet of puppets){
        if (!puppet || !puppet.entity || puppet.entity._inactive) continue;
        if (applyCull && puppet.entity !== player) {
          const ex = Number(puppet.entity.x) || 0;
          const ey = Number(puppet.entity.y) || 0;
          const distTiles = Math.max(Math.abs((ex - playerX) / tileSize), Math.abs((ey - playerY) / tileSize));
          if (distTiles > entityRadius) continue;
        }
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
    reset: resetAll,
    getActiveCount,
    debugListAll,
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
  PuppetNS.reset = resetAll;
})();
