// filename: humans.entities.js
// Envoltorio ligero para crear entidades humanas usando HumanAI.attach().
(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const ENT = W.ENT || (W.ENT = {});
  const TILE = (typeof W.TILE_SIZE === 'number') ? W.TILE_SIZE : (typeof W.TILE === 'number' ? W.TILE : 32);
  const HumanAI = W.HumanAI;

  if (!HumanAI) {
    console.warn('[Humans] HumanAI no está disponible. El módulo no se inicializará.');
    return;
  }

  const ROLE_KIND = {
    celador: ENT.CELADOR ?? 401,
    guardia: ENT.GUARDIA ?? ENT.GUARD ?? 402,
    medico: ENT.MEDICO ?? ENT.DOCTOR ?? 403,
    enfermera: ENT.ENFERMERA ?? ENT.NURSE ?? 404,
    supervisora: ENT.SUPERVISORA ?? 405,
    jefe_servicio: ENT.JEFE_SERVICIO ?? 406,
    cleaner: ENT.CLEANER ?? 407,
    tcae: ENT.TCAE ?? 408,
    familiar: ENT.FAMILIAR ?? 409,
    paciente_especial: ENT.PATIENT ?? 410
  };

  const ROLE_PRESETS = {
    celador: {
      role: 'celador',
      skin: 'celador.png',
      canPatrol: true,
      canPush: true,
      pushImpulse: 160,
      canSeekItems: false,
      touchDamage: 0,
      detectionRadius: 9 * TILE,
      dialogueId: null,
      canTalk: false
    },
    guardia: {
      role: 'guardia',
      skin: 'guardia.png',
      canPatrol: true,
      canPush: false,
      canSeekItems: false,
      canUseDoors: true,
      dialogueId: 'guard_duty',
      canTalk: true,
      touchDamage: 0.5
    },
    medico: {
      role: 'medico',
      skin: 'medico.png',
      canPatrol: true,
      canSeekItems: true,
      ignoredItems: ['pill'],
      canTalk: true,
      dialogueId: 'doctor_default',
      touchDamage: 0,
      dialogueTitle: 'Dr. Il Divo',
      dialogueText: '¿Todo en orden?'
    },
    enfermera: {
      role: 'enfermera',
      skin: 'enfermera_sexy.png',
      canPatrol: true,
      canSeekItems: true,
      canTalk: true,
      dialogueId: 'nurse_help',
      touchDamage: 0,
      detectionRadius: 8 * TILE
    },
    supervisora: {
      role: 'supervisora',
      skin: 'supervisora.png',
      canPatrol: true,
      canTalk: true,
      dialogueId: 'supervisor_warning',
      touchDamage: 0.5,
      canSeekItems: false
    },
    jefe_servicio: {
      role: 'jefe_servicio',
      skin: 'jefe_servicio.png',
      canPatrol: false,
      canTalk: true,
      dialogueId: 'chief_briefing',
      dialogueTitle: 'Jefe de Servicio',
      dialogueText: 'Coordina bien al equipo, ¿de acuerdo?',
      touchDamage: 0
    },
    cleaner: {
      role: 'cleaner',
      skin: 'chica_limpieza.png',
      canPatrol: true,
      canSeekItems: false,
      touchDamage: 0,
      canPush: false,
      dialogueId: 'cleaner_busy',
      canTalk: true
    },
    tcae: {
      role: 'tcae',
      skin: 'TCAE.png',
      canPatrol: true,
      canSeekItems: true,
      canPush: true,
      touchDamage: 0.25,
      dialogueId: 'tcae_help',
      canTalk: true
    },
    familiar: {
      role: 'familiar',
      skin: 'familiar_molesto.png',
      canPatrol: false,
      canSeekItems: false,
      canTalk: true,
      dialogueId: 'relative_chat',
      touchDamage: 0
    },
    paciente_especial: {
      role: 'paciente_especial',
      skin: 'paciente_furiosa.png',
      canPatrol: false,
      canSeekItems: false,
      canPush: false,
      canTalk: false,
      touchDamage: 0.5,
      detectionRadius: 5 * TILE
    }
  };

  function ensureArrays() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.humans)) G.humans = [];
  }

  function addToWorld(ent) {
    ensureArrays();
    if (!G.entities.includes(ent)) G.entities.push(ent);
    if (!G.humans.includes(ent)) G.humans.push(ent);
    W.EntityGroups?.assign?.(ent);
    W.EntityGroups?.register?.(ent, G);
    return ent;
  }

  function toWorldCoords(x, y, inTiles) {
    if (!inTiles) return { x, y };
    return { x: x * TILE, y: y * TILE };
  }

  function makeEntity(role, x, y, opts = {}) {
    const preset = ROLE_PRESETS[role] || {};
    const aiCfg = Object.assign({}, preset, opts.ai || {});
    const size = opts.size || (TILE * 0.9);
    const coords = toWorldCoords(x, y, opts.inTiles);
    const ent = {
      id: opts.id || `${role}_${Math.random().toString(36).slice(2, 8)}`,
      kind: ROLE_KIND[role] ?? role,
      kindName: role,
      x: coords.x || 0,
      y: coords.y || 0,
      w: size,
      h: size,
      vx: 0,
      vy: 0,
      mu: opts.mu ?? 0.04,
      solid: true,
      dynamic: true,
      pushable: true,
      mass: 1.1,
      skin: opts.skin || preset.skin,
      color: opts.color || '#cbd5f5',
      group: 'human'
    };
    if (opts.displayName) ent.displayName = opts.displayName;
    HumanAI.attach(ent, aiCfg);
    return addToWorld(ent);
  }

  function spawn(role, x, y, opts = {}) {
    const key = String(role || '').toLowerCase();
    return makeEntity(key, x, y, opts);
  }

  function adopt(role, entity, opts = {}) {
    if (!entity) return null;
    const key = String(role || '').toLowerCase();
    const preset = ROLE_PRESETS[key] || {};
    const aiCfg = Object.assign({}, preset, opts.ai || {});
    entity.role = key;
    if (!entity.kind) entity.kind = ROLE_KIND[key] ?? key;
    HumanAI.attach(entity, aiCfg);
    return addToWorld(entity);
  }

  function update(dt) {
    HumanAI.updateAll(G, dt || 0);
  }

  const HumansAPI = {
    roles: ROLE_PRESETS,
    spawn,
    adopt,
    update,
    attach: HumanAI.attach,
    ensureRole(role, cfg) {
      ROLE_PRESETS[role] = Object.assign({}, ROLE_PRESETS[role] || {}, cfg || {});
    }
  };

  W.Entities = W.Entities || {};
  W.Entities.Humans = HumansAPI;
})(window);
