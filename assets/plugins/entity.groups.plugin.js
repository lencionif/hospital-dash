(function(){
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const HUMAN = 'human';
  const ANIMAL = 'animal';
  const OBJECT = 'object';
  const SPAWNER = 'spawners';

  const HUMAN_TYPES = new Set([
    'PLAYER',
    'HERO',
    'PATIENT',
    'FURIOUS',
    'MEDICO',
    'MEDIC',
    'DOCTOR',
    'JEFESERVICIO',
    'JEFE_SERVICIO',
    'SUPERVISORA',
    'SUPERVISOR',
    'CLEANER',
    'CELADOR',
    'TCAE',
    'GUARDIA',
    'GUARD',
    'FAMILIAR',
    'FAMILIAR_MOLESTO',
    'ENFERMERA_SEXY',
    'BOSS',
    'BOSS_PATIENT',
    'HERO_ENRIQUE',
    'HERO_ROBERTO',
    'HERO_FRANCESCO',
    'NPC',
    'CHIEF',
    'NURSE'
  ]);

  const ANIMAL_TYPES = new Set([
    'MOSQUITO',
    'RAT',
    'RATA',
    'ANIMAL',
    'ANIMAL_SPAWNER',
    'MOSQUITO_SPAWNER',
    'RAT_SPAWNER'
  ]);

  const OBJECT_TYPES = new Set([
    'OBJECT',
    'ITEM',
    'CART',
    'CART_FOOD',
    'CARRO',
    'BELL',
    'PILL',
    'DOOR',
    'ELEVATOR',
    'LIGHT',
    'HAZARD',
    'FIRE',
    'PHONE',
    'SPAWNER',
    'SPAWNER_ANIMALS',
    'SPAWNER_HUMANS',
    'SPAWNER_CARTS',
    'HAZARD_WET',
    'HAZARD_FIRE'
  ]);

  const SPAWNER_TYPES = new Set([
    'SPAWNER',
    'SPAWNER_ANIMALS',
    'SPAWNER_HUMANS',
    'SPAWNER_CARTS'
  ]);

  function normalizeKind(entity){
    if (!entity) return '';
    if (typeof entity.group === 'string' && entity.group) return entity.group;
    if (typeof entity.kind === 'string') return entity.kind.toUpperCase();
    if (typeof entity.type === 'string') return entity.type.toUpperCase();
    if (typeof entity.tag === 'string') return entity.tag.toUpperCase();
    if (typeof entity.role === 'string') return entity.role.toUpperCase();
    if (typeof entity.aiId === 'string') return entity.aiId.toUpperCase();
    return '';
  }

  function ensureCollections(G){
    if (!G || typeof G !== 'object') return;
    if (!Array.isArray(G.humans)) G.humans = [];
    if (!Array.isArray(G.animals)) G.animals = [];
    if (!Array.isArray(G.objects)) G.objects = [];
    if (!Array.isArray(G.spawners)) G.spawners = [];
    if (!Array.isArray(G.hostiles)) G.hostiles = [];
  }

  function assignGroup(entity){
    if (!entity || typeof entity !== 'object') return entity;
    if (typeof entity.group === 'string' && entity.group) return entity;
    const kind = normalizeKind(entity);
    if (SPAWNER_TYPES.has(kind)) {
      entity.group = SPAWNER;
    } else
    if (HUMAN_TYPES.has(kind)) {
      entity.group = HUMAN;
    } else if (ANIMAL_TYPES.has(kind)) {
      entity.group = ANIMAL;
    } else if (OBJECT_TYPES.has(kind)) {
      entity.group = OBJECT;
    } else if (entity.hostile === true) {
      entity.group = HUMAN;
    }
    return entity;
  }

  function registerEntity(entity, G){
    if (!entity || !G) return;
    ensureCollections(G);
    assignGroup(entity);
    const listForGroup =
      entity.group === HUMAN ? G.humans :
      entity.group === ANIMAL ? G.animals :
      entity.group === OBJECT ? G.objects :
      entity.group === SPAWNER ? G.spawners : null;
    if (listForGroup && !listForGroup.includes(entity)) listForGroup.push(entity);
    if (entity.hostile === true && !G.hostiles.includes(entity)) {
      G.hostiles.push(entity);
    }
  }

  function unregisterEntity(entity, G){
    if (!entity || !G) return;
    if (Array.isArray(G.humans)) G.humans = G.humans.filter((x) => x !== entity);
    if (Array.isArray(G.animals)) G.animals = G.animals.filter((x) => x !== entity);
    if (Array.isArray(G.objects)) G.objects = G.objects.filter((x) => x !== entity);
    if (Array.isArray(G.spawners)) G.spawners = G.spawners.filter((x) => x !== entity);
    if (Array.isArray(G.hostiles)) G.hostiles = G.hostiles.filter((x) => x !== entity);
  }

  root.EntityGroups = {
    HUMAN,
    ANIMAL,
    OBJECT,
    SPAWNER,
    HUMAN_TYPES,
    ANIMAL_TYPES,
    OBJECT_TYPES,
    assign: assignGroup,
    register: registerEntity,
    unregister: unregisterEntity,
    ensure: ensureCollections
  };
})();
