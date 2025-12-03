/* ============================================================================
 * PLANTILLA BASE PROFESIONAL PARA TODAS LAS ENTIDADES DEL JUEGO
 * ---------------------------------------------------------------------------
 * Válida para:
 *  - Héroes (si quieres unificarlos)
 *  - NPC humanos
 *  - Animales (ratas, mosquitos…)
 *  - Carros (comida, medicinas, urgencias…)
 *  - Puertas
 *  - Ascensores
 *  - Hazards de suelo (fuego, charcos, trampas…)
 *
 * Contrato común + hooks de IA, físicas, diálogo, daño, audio y Puppet/rig.
 * Solo hay que ajustar por entidad:
 *   - kind (ENT.XXX)
 *   - flags (solid, isFloorTile, isTriggerOnly, isHazard…)
 *   - parámetros de IA
 *   - callbacks específicos (onInteract, onCrush, onUseElevator, etc.)
 *   - rig / skin
 * ==========================================================================*/

// ---------------------------------------------------------------------------
// 1. Constantes de apoyo
// ---------------------------------------------------------------------------

const TILE_SIZE  = 32;
const ENTITY_W   = 24;   // caja de colisión compacta dentro del tile
const ENTITY_H   = 24;

const DIR_UP     = 0;
const DIR_RIGHT  = 1;
const DIR_DOWN   = 2;
const DIR_LEFT   = 3;

// z del héroe (mismo plano visual que héroes, NPC y enemigos)
const HERO_Z = window.HERO_Z || 10;

// Vida interna en “corazones” (1.0 = 1 corazón)
const HP_PER_HEART = window.HP_PER_HEART || 1;

// ---------------------------------------------------------------------------
// 2. Fábrica genérica de entidades
// ---------------------------------------------------------------------------
/**
 * Crea una entidad de juego (física, pisable, interactiva o hazard).
 *
 * @param {Object} cfg
 *  Obligatorio:
 *    kind    : ENT.X (tipo lógico)
 *    x, y    : posición en píxeles (centro del tile)
 *    rig     : nombre del rig de PuppetAPI
 *
 *  Recomendado:
 *    role            : etiqueta de rol (“hero”, “npc”, “animal”, “cart”,
 *                      “door”, “elevator”, “hazard_fire”, “hazard_water”…)
 *    populationType  : etiqueta para SpawnerAPI (“animals”, “humans”,
 *                      “carts”, “hazards”, “none”)
 *    group           : grupo de EntityGroupsAPI (“players”, “npcs”,
 *                      “animals”, “carts”, “doors”, “hazards”…)
 *
 *  Flags típicos:
 *    solid        : true = bloquea movimiento (puertas, carros, paredes
 *                   con colisión propia). false = pisable (hazards suelo).
 *    isFloorTile  : true => se dibuja/considera como casilla de suelo
 *                   con efecto (charcos, fuego).
 *    isTriggerOnly: true => no tiene colisión física, sirve solo de trigger
 *                   (spawners, triggers de boss, timbres fantasma…).
 *
 *  Vida y daño:
 *    hearts       : vida inicial en corazones (float). Equivalente a hp.
 *    maxHearts    : máximo de corazones (si falta, = hearts).
 *    health       : si prefieres en “hp” explícitos (interno a DamageAPI).
 *    maxHealth    : idem.
 *    touchDamage  : daño de contacto en corazones.
 *    fireImmune   : inmune a daño de fuego.
 *
 *  IA:
 *    ai.enabled       : true/false (por defecto true)
 *    ai.mode          : 'idle' | 'patrol' | 'chase' | 'staticDoor' | ...
 *    ai.speed         : px/s
 *    ai.sightRadius   : radio detección héroe
 *    ai.patrolPoints  : array [{x,y}, ...]
 *    aiUpdate         : función custom si quieres sobreescribir la base.
 *
 *  Interacción:
 *    onInteract   : callback cuando el héroe pulsa acción sobre e
 *    onUse        : alias genérico (puertas, ascensores)
 *    onCrush      : cuando esta entidad aplasta a otra o es aplastada
 *    onEnterTile  : cuando el jugador entra en su tile (hazards, triggers)
 *    onLeaveTile  : cuando el jugador sale de su tile
 *
 *  Audio:
 *    audioProfile : { hit, death, step, talk, eat, attack, use, open, close }
 *
 *  Render:
 *    puppet.z     : capa visual (por defecto HERO_Z)
 *    puppet.skin  : spriteKey / variante si el rig la usa
 */
function createGameEntity(cfg) {
  const hearts      = cfg.hearts ?? (cfg.health !== undefined
                        ? cfg.health / HP_PER_HEART
                        : 1);
  const maxHearts   = cfg.maxHearts ?? hearts;
  const maxHealth   = cfg.maxHealth ?? (maxHearts * HP_PER_HEART);
  const health      = cfg.health    ?? (hearts * HP_PER_HEART);

  const e = {
    // Identidad
    id: genId(),
    kind: cfg.kind,
    role: cfg.role || 'generic',            // p.ej. 'cart', 'door', 'npc'
    populationType: cfg.populationType || 'none',

    // Transformación y física
    x: cfg.x,
    y: cfg.y,
    w: cfg.w || ENTITY_W,
    h: cfg.h || ENTITY_H,
    vx: 0,
    vy: 0,
    dir: cfg.dir ?? DIR_DOWN,

    // Colisión / flags
    solid: cfg.solid !== undefined ? cfg.solid : true,
    isFloorTile: !!cfg.isFloorTile,
    isTriggerOnly: !!cfg.isTriggerOnly,
    isHazard: !!cfg.isHazard,              // fuego, charco, trampa…
    collisionLayer: cfg.collisionLayer || 'default',
    collisionMask: cfg.collisionMask || 'default',

    // Vida y daño (unificados en “health” interno)
    maxHealth,
    health,
    hearts:  health / HP_PER_HEART,
    maxHearts: maxHealth / HP_PER_HEART,
    dead: false,
    deathCause: null,                       // 'damage' | 'fire' | 'crush' | 'script'

    touchDamage: cfg.touchDamage || 0,
    touchCooldown: cfg.touchCooldown ?? 0.9,
    _touchCD: 0,
    fireImmune: !!cfg.fireImmune,

    // Estado de animación
    state: 'idle',      // idle | walk_h | walk_v | attack | eat | talk | push | dead | custom
    facing: 'down',     // up | down | left | right
    isMoving: false,
    isAttacking: false,
    isEating: false,
    isTalking: false,
    isPushing: false,

    // IA genérica (se puede desactivar totally)
    ai: {
      enabled: cfg.ai?.enabled !== false,
      mode: cfg.ai?.mode || 'idle',
      patrolPoints: cfg.ai?.patrolPoints || null,
      patrolIndex: 0,
      patrolWait: cfg.ai?.patrolWait ?? 0.5,
      _patrolTimer: 0,
      sightRadius: cfg.ai?.sightRadius ?? 160,
      loseSightTime: cfg.ai?.loseSightTime ?? 2,
      _loseSightTimer: 0,
      speed: cfg.ai?.speed ?? 40,
      // Extra hooks para puertas/ascensores/hazards:
      data: cfg.ai?.data || null,
    },

    // Diálogo
    dialog: {
      enabled: !!cfg.dialog?.enabled,
      autoChatter: cfg.dialog?.autoChatter || false,
      autoChatterCooldown: cfg.dialog?.autoChatterCooldown || 4,
      _autoChatterTimer: 0,
      lines: cfg.dialog?.lines || [],
      currentLineIndex: 0,
    },

    // Integración con otros sistemas
    scoreOnDeath: cfg.scoreOnDeath || 0,
    scoreOnUse: cfg.scoreOnUse || 0,      // puertas, ascensores, curas, etc.
    audioProfile: {
      hit:    cfg.audioProfile?.hit    || 'sfx_hit',
      death:  cfg.audioProfile?.death  || 'sfx_death',
      step:   cfg.audioProfile?.step   || 'sfx_step',
      talk:   cfg.audioProfile?.talk   || 'sfx_talk',
      eat:    cfg.audioProfile?.eat    || 'sfx_eat',
      attack: cfg.audioProfile?.attack || 'sfx_attack',
      use:    cfg.audioProfile?.use    || 'sfx_use',
      open:   cfg.audioProfile?.open   || 'door_open',
      close:  cfg.audioProfile?.close  || 'door_close',
    },

    // Puppet / rig
    puppet: {
      rig: cfg.rig,                            // OBLIGATORIO
      z: cfg.z !== undefined ? cfg.z : HERO_Z, // mismo plano que héroe
      skin: cfg.skin || 'default',
    },

    // Sprites opcionales (si algún rig los usa)
    spriteId: cfg.spriteId || null,
    spriteKey: cfg.spriteKey || null,

    // Hooks genéricos de lógica
    aiUpdate: cfg.aiUpdate || baseAiUpdate,
    physicsUpdate: cfg.physicsUpdate || basePhysicsUpdate,
    onDamage: cfg.onDamage || baseOnDamage,
    onDeath: cfg.onDeath || baseOnDeath,
    onAttackHit: cfg.onAttackHit || baseOnAttackHit,
    onEat: cfg.onEat || baseOnEat,
    onTalk: cfg.onTalk || baseOnTalk,
    onInteract: cfg.onInteract || null,          // acción del héroe (puertas, ascensor…)
    onUse: cfg.onUse || null,                    // alias genérico
    onCrush: cfg.onCrush || null,                // carros aplastando
    onEnterTile: cfg.onEnterTile || null,        // hazards/trigger
    onLeaveTile: cfg.onLeaveTile || null,

    // Gestión de borrado / culling
    removeMe: false,
    _culled: false,
    rigOk: true,                                 // Puppet audit

    // Campo de usuario extra para lógicas específicas
    data: cfg.data || {},
  };

  // Adjuntar Puppet
  if (window.PuppetAPI && e.puppet && e.puppet.rig) {
    try {
      PuppetAPI.attach(e, e.puppet);
    } catch (err) {
      e.rigOk = false;
      if (window.DEBUG_RIGS) {
        console.error('[RigError] Fallo al adjuntar rig a entidad', e.kind, err);
      }
    }
  } else {
    e.rigOk = false;
    if (window.DEBUG_RIGS) {
      console.warn('[RigWarn] Entidad sin rig adjunto', e.kind, e);
    }
  }

  // Registrar grupo lógico
  if (window.EntityGroupsAPI && EntityGroupsAPI.add) {
    EntityGroupsAPI.add(e, cfg.group || 'generic');
  }

  // Insertar en la lista global
  if (window.G && G.entities) {
    G.entities.push(e);
  }

  return e;
}

// Alias para compatibilidad con plantillas anteriores
const createPhysicalEntity = createGameEntity;

// ---------------------------------------------------------------------------
// 3. IA genérica: idle / patrulla / persecución
// ---------------------------------------------------------------------------

/**
 * IA genérica que sirve para:
 *  - Humanos hostiles / neutrales
 *  - Animales (con pequeños ajustes en speed y sightRadius)
 *  - Algunos carros con “vida propia”, si se quisiera
 *
 * Puertas, ascensores y hazards normalmente usarán una aiUpdate custom,
 * pero pueden seguir reutilizando partes de esta lógica si interesa.
 */
function baseAiUpdate(e, dt) {
  if (e.dead || !e.ai?.enabled) {
    if (e.dead) e.state = 'dead';
    return;
  }

  const player = G && G.player;
  if (!player) {
    aiIdle(e, dt);
    return;
  }

  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const distSq = dx * dx + dy * dy;
  const sightSq = e.ai.sightRadius * e.ai.sightRadius;

  const seesPlayer = distSq <= sightSq;

  // Cambio de modo
  if (seesPlayer) {
    e.ai.mode = 'chase';
    e.ai._loseSightTimer = 0;
  } else if (e.ai.mode === 'chase') {
    e.ai._loseSightTimer += dt;
    if (e.ai._loseSightTimer >= e.ai.loseSightTime) {
      e.ai.mode = e.ai.patrolPoints ? 'patrol' : 'idle';
    }
  } else if (e.ai.mode === 'idle' && e.ai.patrolPoints) {
    e.ai.mode = 'patrol';
  }

  switch (e.ai.mode) {
    case 'chase':
      aiChasePlayer(e, dt, dx, dy, Math.sqrt(distSq));
      break;
    case 'patrol':
      aiPatrol(e, dt);
      break;
    case 'idle':
    default:
      aiIdle(e, dt);
      break;
  }

  // Diálogo automático
  if (e.dialog.enabled && e.dialog.autoChatter) {
    e.dialog._autoChatterTimer -= dt;
    if (e.dialog._autoChatterTimer <= 0) {
      e.dialog._autoChatterTimer = e.dialog.autoChatterCooldown;
      triggerDialog(e);
    }
  }

  // Ataque por contacto (enemigos / carros hostiles / hazards densos)
  handleTouchAttack(e, player, dt);
}

// --- Subrutinas IA base -----------------------------------------------------

function aiIdle(e, dt) {
  e.vx = 0;
  e.vy = 0;
  e.isMoving = false;
  if (e.state !== 'idle' && e.state !== 'talk') {
    e.state = 'idle';
  }
}

function aiPatrol(e, dt) {
  const pts = e.ai.patrolPoints;
  if (!pts || !pts.length) {
    aiIdle(e, dt);
    return;
  }

  const target = pts[e.ai.patrolIndex];
  const dx = target.x - e.x;
  const dy = target.y - e.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 4) {
    e.ai._patrolTimer += dt;
    e.vx = 0;
    e.vy = 0;
    e.isMoving = false;
    e.state = 'idle';
    if (e.ai._patrolTimer >= e.ai.patrolWait) {
      e.ai._patrolTimer = 0;
      e.ai.patrolIndex = (e.ai.patrolIndex + 1) % pts.length;
    }
    return;
  }

  const speed = e.ai.speed;
  e.vx = (dx / dist) * speed;
  e.vy = (dy / dist) * speed;
  e.isMoving = true;

  updateWalkStateFromVelocity(e);
}

function aiChasePlayer(e, dt, dx, dy, dist) {
  const speed = e.ai.speed;

  if (dist > 0) {
    e.vx = (dx / dist) * speed;
    e.vy = (dy / dist) * speed;
    e.isMoving = true;
  } else {
    e.vx = 0;
    e.vy = 0;
    e.isMoving = false;
  }

  // Si estamos muy cerca, ralentizar para golpear
  if (dist < 20) {
    e.vx *= 0.3;
    e.vy *= 0.3;
    e.isAttacking = true;
    e.state = 'attack';
  } else {
    e.isAttacking = false;
    updateWalkStateFromVelocity(e);
  }
}

/**
 * Determina animación de paseo (horizontal/vertical) + facing.
 * Es común para héroes, NPC, animales, carros con rig propio, etc.
 */
function updateWalkStateFromVelocity(e) {
  if (Math.abs(e.vx) < 0.01 && Math.abs(e.vy) < 0.01) {
    e.isMoving = false;
    if (!e.isAttacking && !e.isTalking && !e.isEating && !e.dead) {
      e.state = 'idle';
    }
    return;
  }

  e.isMoving = true;

  if (Math.abs(e.vx) > Math.abs(e.vy)) {
    e.state = 'walk_h';
    e.facing = e.vx >= 0 ? 'right' : 'left';
  } else {
    e.state = 'walk_v';
    e.facing = e.vy >= 0 ? 'down' : 'up';
  }
}

// ---------------------------------------------------------------------------
// 4. Física base: integración con PhysicsAPI
// ---------------------------------------------------------------------------

/**
 * Física por defecto: delega en PhysicsAPI.moveEntity(e, dt)
 * que es quien resuelve colisiones y rebotes (carros tipo pinball).
 * Si no existe PhysicsAPI, hace un fallback simple x += vx*dt, y += vy*dt.
 */
function basePhysicsUpdate(e, dt) {
  if (e.dead || e.isTriggerOnly) return;

  if (window.PhysicsAPI && PhysicsAPI.moveEntity) {
    PhysicsAPI.moveEntity(e, dt);
  } else {
    e.x += e.vx * dt;
    e.y += e.vy * dt;
  }
}

// ---------------------------------------------------------------------------
// 5. Ataque por contacto + DamageAPI
// ---------------------------------------------------------------------------

/**
 * Comprueba solapamiento AABB contra el jugador y aplica daño de contacto
 * usando DamageAPI.applyTouch cuando corresponde.
 */
function handleTouchAttack(e, player, dt) {
  if (!e.touchDamage || e.dead || !player || player.dead) return;

  if (e._touchCD > 0) {
    e._touchCD -= dt;
    return;
  }

  if (overlap(e, player)) {
    e._touchCD = e.touchCooldown;

    if (window.DamageAPI && DamageAPI.applyTouch) {
      DamageAPI.applyTouch(e, player);
    } else {
      // Fallback mínimo (no recomendado, pero evita crasheos)
      player.health = Math.max(0, player.health - e.touchDamage * HP_PER_HEART);
    }

    playEntityAudio(e, 'attack');
    if (e.onAttackHit) e.onAttackHit(e, player);
  }
}

// ---------------------------------------------------------------------------
// 6. Daño y muertes (daño directo, fuego, aplastamiento…)
// ---------------------------------------------------------------------------

/**
 * Llamada desde DamageAPI o lógica de hazards cuando esta entidad recibe daño.
 *
 * @param {Object} e      Entidad
 * @param {Number} amount Daño en “hp” internos (no en corazones)
 * @param {String} cause  'damage' | 'fire' | 'crush' | 'script'
 */
function baseOnDamage(e, amount, cause) {
  if (e.dead) return;

  if (cause === 'fire' && e.fireImmune) {
    return;
  }

  e.health -= amount;
  e.hearts = e.health / HP_PER_HEART;

  if (e.health <= 0) {
    e.health = 0;
    e.hearts = 0;
    e.deathCause = cause || 'damage';
    baseOnDeath(e);
  } else {
    playEntityAudio(e, 'hit');
    // Podríamos añadir animación de “hit flash” via rig
  }
}

/**
 * Muerte unificada para cualquier entidad: humanos, animales, carros,
 * puertas quemadas, etc. Respeta deathCause.
 */
function baseOnDeath(e) {
  if (e.dead) return;

  e.dead = true;
  e.vx = 0;
  e.vy = 0;
  e.isMoving = false;
  e.state = 'dead';

  // Score
  if (e.scoreOnDeath && window.ScoreAPI && ScoreAPI.add) {
    ScoreAPI.add(e.scoreOnDeath, 'kill', e);
  }

  playEntityAudio(e, 'death');

  // Si hay lógica específica (carro que explota, puerta quemada, boss curado...)
  if (typeof e.onDeath === 'function' && e.onDeath !== baseOnDeath) {
    // Evitar recursión si se ha sobrescrito
    e.onDeath(e);
  }
}

// ---------------------------------------------------------------------------
// 7. Comer / drenar vida (mosquitos, ratas, pacientes furiosos…)
// ---------------------------------------------------------------------------

function baseOnEat(e, target) {
  if (e.dead) return;
  e.isEating = true;
  e.state = 'eat';

  if (target && !target.dead && window.DamageAPI && DamageAPI.applySpecial) {
    DamageAPI.applySpecial(e, target, { type: 'eat' });
  }

  // Curación ligera opcional
  e.health = Math.min(e.maxHealth, e.health + 0.2 * HP_PER_HEART);
  e.hearts = e.health / HP_PER_HEART;

  playEntityAudio(e, 'eat');
}

// ---------------------------------------------------------------------------
// 8. Ataque cuerpo a cuerpo con éxito (hook para FX)
// ---------------------------------------------------------------------------

function baseOnAttackHit(e, target) {
  // Aquí se pueden lanzar partículas, chispas, etc.
  // target ya ha recibido daño por DamageAPI.
}

// ---------------------------------------------------------------------------
// 9. Diálogo genérico
// ---------------------------------------------------------------------------

function baseOnTalk(e) {
  if (!e.dialog.enabled || !e.dialog.lines.length) return;
  triggerDialog(e);
}

function triggerDialog(e) {
  const lineId = e.dialog.lines[e.dialog.currentLineIndex % e.dialog.lines.length];
  e.dialog.currentLineIndex++;

  e.state = 'talk';
  e.isTalking = true;

  if (window.DialogAPI && DialogAPI.showForEntity) {
    DialogAPI.showForEntity(e, lineId);
  }

  playEntityAudio(e, 'talk');
}

// ---------------------------------------------------------------------------
// 10. Audio utilitario
// ---------------------------------------------------------------------------

function playEntityAudio(e, key) {
  const id = e.audioProfile?.[key];
  if (!id || !window.AudioAPI || !AudioAPI.play) return;
  AudioAPI.play(id, { x: e.x, y: e.y });
}

/* ============================================================================
 * NOTAS DE USO
 * ----------------------------------------------------------------------------
 * 1) Carros tipo pinball (comida, medicinas, urgencias):
 *
 *    function createCartFood(x, y) {
 *      return createGameEntity({
 *        kind: ENT.CART_FOOD,
 *        role: 'cart',
 *        populationType: 'carts',
 *        group: 'carts',
 *        x, y,
 *        rig: 'cart_food_pinball',
 *        solid: true,
 *        touchDamage: 1.0,   // 1 corazón
 *        hearts: 4,
 *        data: {
 *          cartType: 'medium',
 *          bounceMax: 4,
 *        },
 *        ai: { enabled: false }, // se mueven solo por física
 *      });
 *    }
 *
 * 2) Puertas:
 *
 *    function createDoorNormal(x, y) {
 *      return createGameEntity({
 *        kind: ENT.DOOR_NORMAL,
 *        role: 'door',
 *        populationType: 'none',
 *        group: 'doors',
 *        x, y,
 *        rig: 'door_hospital',
 *        solid: true,
 *        hearts: 3,
 *        audioProfile: { open: 'door_open', close: 'door_close' },
 *        ai: { enabled: false },
 *        onInteract(e, hero) { openDoorNormal(e, hero); },
 *      });
 *    }
 *
 * 3) Hazards de suelo (fuego, charco):
 *
 *    function createWaterPuddle(x, y) {
 *      return createGameEntity({
 *        kind: ENT.WATER_PUDDLE,
 *        role: 'hazard_water',
 *        populationType: 'hazards',
 *        group: 'hazards',
 *        x, y,
 *        rig: 'puddle_wet',
 *        solid: false,
 *        isFloorTile: true,
 *        isHazard: true,
 *        touchDamage: 0,      // daño 0, pero resbalón en physics.plugin.js
 *        ai: { enabled: false },
 *      });
 *    }
 *
 * 4) Humanos / animales:
 *
 *    function createRat(x, y) {
 *      return createGameEntity({
 *        kind: ENT.RAT,
 *        role: 'animal',
 *        populationType: 'animals',
 *        group: 'animals',
 *        x, y,
 *        rig: 'enemy_rat',
 *        solid: true,
 *        hearts: 1,
 *        touchDamage: 0.5,
 *        ai: {
 *          enabled: true,
 *          speed: 80,
 *          sightRadius: 200,
 *        },
 *      });
 *    }
 *
 * 5) Loop principal (pseudo):
 *      for (const e of G.entitiesActivas) {
 *        e.aiUpdate(e, dt);
 *        e.physicsUpdate(e, dt);
 *      }
 *      PuppetAPI.update(dt);
 *      PuppetAPI.draw(ctx, cam);
 * ==========================================================================*/

// ---------------------------------------------------------------------------
// Implementación real de la Limpiadora y sus charcos (hazard de agua)
// ---------------------------------------------------------------------------
(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.CLEANER === 'undefined') e.CLEANER = 'CLEANER';
    if (typeof e.PUDDLE === 'undefined') e.PUDDLE = 'PUDDLE';
    return e;
  })(root.ENT || (root.ENT = {}));

  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 10;
  const HP_PER_HEART = root.HP_PER_HEART || 1;
  const TILE = root.TILE_SIZE || root.TILE || 32;
  const DEBUG_CLEANER = !!root.DEBUG_CLEANER;

  const overlap = root.overlap || ((a, b) => a && b && Math.abs(a.x - b.x) * 2 < (a.w + b.w) && Math.abs(a.y - b.y) * 2 < (a.h + b.h));

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.npcs)) G.npcs = [];
    if (!Array.isArray(G.hazards)) G.hazards = [];
    if (!Array.isArray(G.movers)) G.movers = [];
  }

  function gridToWorldCenter(tx, ty) {
    return { x: tx * TILE + TILE * 0.5, y: ty * TILE + TILE * 0.5 };
  }

  function attachRig(e) {
    if (!root.PuppetAPI?.attach) return;
    try {
      const rig = root.PuppetAPI.attach(e, e.puppet);
      if (rig) e.rigOk = true;
    } catch (err) {
      e.rigOk = false;
      if (root.DEBUG_RIGS || DEBUG_CLEANER) console.warn('[CleanerRig] attach failed', err);
    }
  }

  function spawnPuddle(x, y, opts = {}) {
    ensureCollections();
    const e = {
      id: root.genId ? root.genId() : `puddle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.PUDDLE,
      x,
      y,
      w: 32,
      h: 32,
      dir: 0,
      vx: 0,
      vy: 0,
      solid: false,
      health: Infinity,
      frictionFactor: opts.frictionFactor ?? 0.2,
      slipChance: opts.slipChance ?? 0.7,
      ttl: opts.ttl ?? 40,
      puppet: { rig: 'hazard_puddle', z: HERO_Z, skin: 'default' },
      aiUpdate: puddleAiUpdate,
      update(dt) { puddleAiUpdate(dt, this); },
      _fireCheck: 0,
    };

    attachRig(e);
    G.entities.push(e);
    G.hazards.push(e);
    return e;
  }

  function spawnPuddleAtTile(tx, ty, opts = {}) {
    const pos = gridToWorldCenter(tx, ty);
    return spawnPuddle(pos.x, pos.y, opts);
  }

  function handleSlipImpact(hero, puddle, dt) {
    if (!hero.slipping) return;
    hero._slipTimer = Math.max(0, (hero._slipTimer || 0) - dt);
    if (hero._slipTimer <= 0) hero.slipping = false;
    if (hero._slipCooldown) hero._slipCooldown = Math.max(0, hero._slipCooldown - dt);
    if (hero._slipImpactLock) hero._slipImpactLock = Math.max(0, hero._slipImpactLock - dt);

    const speed = Math.hypot(hero.vx || 0, hero.vy || 0);
    const prev = hero._slipPrevSpeed || speed;
    if (!hero._slipImpactLock && prev > 80 && speed < prev * 0.35) {
      try { root.DamageAPI?.applyTouch?.(puddle, hero); } catch (_) {}
      hero._slipImpactLock = 0.5;
    }
    hero._slipPrevSpeed = speed;
  }

  function puddleAiUpdate(dt, e) {
    if (!e || e.dead) return;
    e.ttl -= dt;
    if (e.ttl <= 0) { e.dead = true; e._remove = true; return; }

    const hero = G.player;
    if (hero && !hero.dead) {
      const touching = overlap(e, hero);
      if (touching) {
        hero._frictionOverrideTag = 'puddle';
        hero._frictionOverride = Math.min(hero._frictionOverride ?? 1, e.frictionFactor || 0.2);
        hero._puddleFrictionTimer = 0.25;
        if (!hero.slipping && (!hero._slipCooldown || hero._slipCooldown <= 0) && Math.random() < e.slipChance) {
          const boost = 1.2 + Math.random() * 0.6;
          hero.slipping = true;
          hero._slipTimer = 0.9;
          hero._slipCooldown = 0.6;
          hero.vx = hero.vx ? hero.vx * boost : (Math.random() - 0.5) * 90;
          hero.vy = hero.vy ? hero.vy * boost : (Math.random() - 0.5) * 90;
          hero._slipPrevSpeed = Math.hypot(hero.vx, hero.vy);
          if (DEBUG_CLEANER) console.log('[PUDDLE] slipping hero', { boost });
        }
      }

      if (hero._puddleFrictionTimer) {
        hero._puddleFrictionTimer = Math.max(0, hero._puddleFrictionTimer - dt);
        if (hero._puddleFrictionTimer <= 0 && hero._frictionOverrideTag === 'puddle') {
          delete hero._frictionOverride;
          delete hero._frictionOverrideTag;
        }
      }

      handleSlipImpact(hero, e, dt);
    }

    if (Array.isArray(G.movers)) {
      for (const m of G.movers) {
        if (!m || m.dead || m === hero) continue;
        if (overlap(e, m)) {
          m._frictionOverride = Math.min(m._frictionOverride ?? 1, e.frictionFactor || 0.2);
        }
      }
    }

    e._fireCheck -= dt;
    if (e._fireCheck <= 0) {
      e._fireCheck = 0.5;
      const tx = Math.floor(e.x / TILE);
      const ty = Math.floor(e.y / TILE);
      if (root.FireAPI?.extinguishAtTile) {
        try { root.FireAPI.extinguishAtTile(tx, ty, { reason: 'water_puddle' }); } catch (_) {}
        e.ttl = Math.max(e.ttl - 0.4, 5);
      }
    }
  }

  function updateWalkState(e) {
    if (Math.abs(e.vx || 0) > Math.abs(e.vy || 0)) e.state = 'walk_h';
    else if (Math.abs(e.vy || 0) > 0.01) e.state = 'walk_v';
    else e.state = 'idle';
  }

  function cleanerOnDamage(e, amount, cause) {
    if (e.dead) return;
    e.health -= amount;
    if (e.health <= 0) {
      e.health = 0;
      e.dead = true;
      e.deathCause = cause || 'damage';
      e.vx = e.vy = 0;
      e.state = 'dead';
      try { root.SpawnerAPI?.notifyDeath?.({ entity: e, populationType: 'humans', template: 'cleaner' }); } catch (_) {}
    }
  }

  function spawnCleaner(x, y, opts = {}) {
    ensureCollections();
    const health = (opts.hearts ?? 3) * HP_PER_HEART;
    const e = {
      id: root.genId ? root.genId() : `cleaner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.CLEANER,
      x,
      y,
      w: 24,
      h: 24,
      dir: 0,
      vx: 0,
      vy: 0,
      solid: true,
      health,
      maxHealth: health,
      touchDamage: opts.touchDamage ?? 0.5,
      touchCooldown: opts.touchCooldown ?? 0.9,
      _touchCD: 0,
      fireImmune: false,
      populationType: 'humans',
      aiId: 'CLEANER',
      state: 'idle',
      puppet: { rig: 'npc_cleaner', z: HERO_Z, skin: 'default' },
      aiUpdate: cleanerAiUpdate,
      update(dt) { cleanerAiUpdate(dt, this); },
      onDamage: cleanerOnDamage,
      maxPuddlesPerRoom: opts.maxPuddlesPerRoom ?? 8,
      _puddles: [],
    };

    attachRig(e);
    G.entities.push(e);
    G.npcs.push(e);
    if (DEBUG_CLEANER) console.log('[Cleaner] spawn', { x, y });
    return e;
  }

  function spawnCleanerAtTile(tx, ty, opts = {}) {
    const pos = gridToWorldCenter(tx, ty);
    return spawnCleaner(pos.x, pos.y, opts);
  }

  function cleanerAiUpdate(dt, e) {
    if (!e || e.dead) return;
    if (e._touchCD > 0) e._touchCD -= dt;
    const player = G.player;
    if (player && overlap(e, player)) {
      e.state = 'attack';
      if (root.DamageAPI?.applyTouch) root.DamageAPI.applyTouch(e, player);
    }

    e._puddleCD = (e._puddleCD ?? 0.6) - dt;
    if (e._puddleCD <= 0) {
      e._puddles = (e._puddles || []).filter((p) => p && !p.dead && !p._remove);
      if (e._puddles.length < e.maxPuddlesPerRoom) {
        const puddle = spawnPuddle(e.x, e.y, { frictionFactor: 0.18 + Math.random() * 0.05, slipChance: 0.65 + Math.random() * 0.1 });
        e._puddles.push(puddle);
        if (DEBUG_CLEANER) console.log('[Cleaner] puddle spawned', { x: e.x, y: e.y });
      }
      e._puddleCD = 1 + Math.random() * 0.4;
    }

    const target = e._patrolTarget || choosePatrolTarget(e);
    const dx = target.x - e.x;
    const dy = target.y - e.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = optsSpeed(e) * (player && Math.hypot(player.x - e.x, player.y - e.y) < TILE * 3 ? 1.1 : 1);

    if (dist < 6) {
      e.vx = 0; e.vy = 0;
      e._patrolTimer = (e._patrolTimer || 0) - dt;
      if (e._patrolTimer <= 0) {
        e._patrolTarget = null;
        e._patrolTimer = 0.5 + Math.random();
      }
      if (e.state !== 'attack') e.state = 'idle';
    } else {
      e.vx = (dx / dist) * speed;
      e.vy = (dy / dist) * speed;
      if (Math.abs(e.vx) < 2 && Math.abs(e.vy) < 2) e.state = 'idle';
      else updateWalkState(e);
    }

    if (e.rig) root.PuppetAPI?.update?.(e.rig, dt);
  }

  function optsSpeed(e) {
    return e.speed || 60;
  }

  function choosePatrolTarget(e) {
    const tx = Math.floor(e.x / TILE);
    const ty = Math.floor(e.y / TILE);
    const rx = (Math.random() * 7 - 3) | 0;
    const ry = (Math.random() * 7 - 3) | 0;
    const pos = gridToWorldCenter(tx + rx, ty + ry);
    e._patrolTarget = { x: pos.x, y: pos.y };
    return e._patrolTarget;
  }

  const CleanerAPI = {
    spawn: spawnCleaner,
    spawnAtTile: spawnCleanerAtTile,
    spawnFromAscii(tx, ty, opts = {}) { return spawnCleanerAtTile(tx, ty, opts); },
    aiUpdate: cleanerAiUpdate,
    updateAll(dt = 0) {
      if (!Array.isArray(G.entities)) return;
      for (const e of G.entities) {
        if (e && e.kind === ENT.CLEANER) cleanerAiUpdate(dt, e);
        if (e && e.kind === ENT.PUDDLE) puddleAiUpdate(dt, e);
      }
    },
  };

  root.Entities = root.Entities || {};
  root.Entities.Cleaner = CleanerAPI;
  root.Entities.spawnCleaner = spawnCleaner;
  root.Entities.spawnCleanerAtTile = spawnCleanerAtTile;
  root.Entities.spawnCleanerFromAscii = (tx, ty, def) => spawnCleanerAtTile(tx, ty, def || {});
  root.Entities.Puddles = {
    spawn: spawnPuddle,
    spawnAtTile: spawnPuddleAtTile,
    spawnFromAscii(tx, ty, def) { return spawnPuddleAtTile(tx, ty, def || {}); },
  };
  root.spawnPuddle = spawnPuddle;
  root.spawnCleaner = spawnCleaner;
})(window);