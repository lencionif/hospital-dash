// ./assets/plugins/entities/doors.entities.js
// Reescritura 2025-11: sistema de puertas unificado.
// - Puertas normales siempre abribles.
// - Puerta de urgencias (bossDoor) bloqueada hasta curar todos los pacientes.
// - Lógica separada openNormalDoor / openBossDoor y handler onHeroInteractDoor().
// - Implementación reescrita desde cero, eliminando la lógica anterior de puertas.
(function () {
  'use strict';

  const W = typeof window !== 'undefined' ? window : globalThis;
  const ENT = (W && (W.ENT || (W.G && W.G.ENT))) || {};
  const TILE = W.TILE_SIZE || W.TILE || 32;
  const DEBUG_DOORS = false;
  const INTERACT_RADIUS = TILE * 1.5;
  const OPEN_SPEED = 1 / 0.5; // abrir/cerrar en ~0.5s
  const DOOR_INTERACT_TAG = '_doorInteractHook';

  function logDebug(...args) {
    if (!DEBUG_DOORS) return;
    console.debug('[DOOR]', ...args);
  }

  function resolveState(state) {
    const G = state?.G || W.G || (W.G = {});
    const target = state || G;
    if (!Array.isArray(target.entities)) target.entities = [];
    if (!Array.isArray(target.doors)) target.doors = [];
    const hooks = Array.isArray(target.onInteract)
      ? target.onInteract
      : Array.isArray(G.onInteract)
        ? G.onInteract
        : [];
    if (!Array.isArray(target.onInteract)) target.onInteract = hooks;
    if (!Array.isArray(G.onInteract)) G.onInteract = hooks;
    if (!hooks.some(fn => fn && fn[DOOR_INTERACT_TAG])) {
      const handler = (hero) => {
        const door = findNearestDoor(hero, INTERACT_RADIUS, target);
        if (!door) return false;
        return onHeroInteractDoor(hero, door);
      };
      handler[DOOR_INTERACT_TAG] = true;
      hooks.push(handler);
    }
    return target;
  }

  function ensureRig(door) {
    try {
      const rig = door.kindName === 'door_urgencias' || door.doorType === 'door_urgencias' ? 'door_urgencias' : 'door';
      const puppet = W.Puppet?.bind?.(door, rig, { z: 0, scale: 1 })
        || W.PuppetAPI?.attach?.(door, { rig, z: 0, scale: 1 });
      if (puppet) door.rig = puppet;
      door.rigOk = !!puppet;
    } catch (_) {
      door.rigOk = door.rigOk === true;
    }
  }

  function createDoor(x, y, opts = {}) {
    const state = resolveState(opts.state);
    const bossDoorFlag = !!(opts.bossDoor || opts.isBossDoor || opts.tag === 'bossDoor' || String(opts.kind || '').toLowerCase() === 'urgencias');
    const doorKindName = bossDoorFlag ? 'door_urgencias' : 'door';
    const door = {
      id: opts.id || `door_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      kind: Number.isFinite(ENT?.DOOR) ? ENT.DOOR : 'door',
      kindName: doorKindName,
      doorType: doorKindName,
      bossDoor: bossDoorFlag,
      x: Number(x) || 0,
      y: Number(y) || 0,
      w: opts.w || opts.width || TILE,
      h: opts.h || opts.height || TILE,
      width: opts.w || opts.width || TILE,
      height: opts.h || opts.height || TILE,
      static: true,
      isOpen: !!opts.open,
      isLocked: bossDoorFlag ? true : false,
      spriteKey: opts.spriteKey || null,
      state: {
        openProgress: opts.open ? 1 : 0,
      }
    };
    door.open = door.isOpen;
    door.locked = door.isLocked;
    door.solid = !door.isOpen;
    ensureRig(door);
    try { W.MovementSystem?.register?.(door); } catch (_) {}

    state.entities.push(door);
    if (!state.doors.includes(door)) state.doors.push(door);
    logDebug('create', { kind: door.kind, bossDoor: door.bossDoor, x: door.x, y: door.y });
    return door;
  }

  function syncFlags(door) {
    if (!door) return;
    door.open = !!door.isOpen;
    door.locked = !!door.isLocked;
    door.solid = !door.isOpen;
  }

  function setOpenState(door, open) {
    if (!door) return;
    door.isOpen = !!open;
    syncFlags(door);
  }

  function canOpenBossDoor() {
    try {
      if (W.ObjectiveFlowAPI?.canOpenBossDoor) return !!W.ObjectiveFlowAPI.canOpenBossDoor();
      if (W.ObjectiveSystem?.canOpenBossDoor) return !!W.ObjectiveSystem.canOpenBossDoor();
      const stats = W.G?.stats || {};
      const remaining = Number(stats.remainingPatients) || 0;
      const furious = Number(stats.activeFuriosas) || 0;
      return remaining + furious <= 0;
    } catch (_) {
      return true;
    }
  }

  function openNormalDoor(door) {
    if (!door) return false;
    door.isLocked = false;
    setOpenState(door, true);
    return true;
  }

  function openBossDoor(door) {
    if (!door) return false;
    if (!canOpenBossDoor()) {
      door.isLocked = true;
      syncFlags(door);
      if (!door._lastLockWarn || Date.now() - door._lastLockWarn > 300) {
        console.warn('[URGENT] Boss door locked: patients remain.');
        door._lastLockWarn = Date.now();
      }
      return false;
    }
    door.isLocked = false;
    setOpenState(door, true);
    return true;
  }

  function closeDoor(door) {
    if (!door || door.bossDoor) return false;
    setOpenState(door, false);
    return true;
  }

  function update(door, _state, dt) {
    if (!door || door._inactive) return;
    const delta = Math.max(0, Number(dt) || 0);
    const target = door.isOpen ? 1 : 0;
    const prog = door.state?.openProgress ?? 0;
    const next = prog + (target - prog) * Math.min(1, delta * OPEN_SPEED);
    door.state.openProgress = Math.max(0, Math.min(1, next));
    door.solid = door.state.openProgress < 0.6 && !door.isOpen;
    door.open = door.state.openProgress >= 0.9 || door.isOpen;
  }

  function distanceSq(a, b) {
    const dx = (a?.x || 0) - (b?.x || 0);
    const dy = (a?.y || 0) - (b?.y || 0);
    return dx * dx + dy * dy;
  }

  function onHeroInteractDoor(hero, door) {
    if (!hero || !door) return false;
    const distOk = distanceSq({ x: door.x, y: door.y }, { x: hero.x, y: hero.y }) <= (INTERACT_RADIUS * INTERACT_RADIUS);
    if (!distOk) return false;
    const isBoss = door.bossDoor || door.kindName === 'door_urgencias' || door.doorType === 'door_urgencias';
    return isBoss ? openBossDoor(door) : openNormalDoor(door);
  }

  function openUrgencias(state) {
    const target = resolveState(state);
    let opened = false;
    for (const door of target.entities || []) {
      if (!door || !door.bossDoor) continue;
      if (openBossDoor(door)) opened = true;
    }
    return opened;
  }

  function setLocked(door, locked = true) {
    if (!door) return false;
    door.isLocked = !!locked;
    if (locked) setOpenState(door, false);
    else syncFlags(door);
    return true;
  }

  function findNearestDoor(entity, radius = TILE * 1.1, state) {
    const target = resolveState(state);
    const list = Array.isArray(target.entities) ? target.entities : [];
    const origin = { x: entity?.x || 0, y: entity?.y || 0 };
    const maxR2 = radius * radius;
    let best = null;
    let bestD2 = Infinity;
    for (const door of list) {
      const kindId = Number.isFinite(ENT?.DOOR) ? ENT.DOOR : null;
      const namedKind = door.kindName || door.doorType || door.kind;
      const isDoorEntity = door?.bossDoor
        || (kindId != null && door.kind === kindId)
        || namedKind === 'door'
        || namedKind === 'door_urgencias';
      if (!isDoorEntity) continue;
      const d2 = distanceSq(origin, door);
      if (d2 > maxR2) continue;
      if (d2 < bestD2) { bestD2 = d2; best = door; }
    }
    return best;
  }

  function autoOpenNear(entity, radius = TILE * 0.9, opts = {}) {
    const door = findNearestDoor(entity, radius, opts.state);
    if (!door || door.isLocked || door.bossDoor) return false;
    return openNormalDoor(door);
  }

  function openDoorGeneric(door) {
    if (!door) return false;
    const isBoss = door.bossDoor || door.kindName === 'door_urgencias' || door.doorType === 'door_urgencias';
    return isBoss
      ? openBossDoor(door)
      : openNormalDoor(door);
  }

  function toggleDoor(door) {
    if (!door) return false;
    if (door.isOpen && !door.bossDoor) return closeDoor(door);
    return openDoorGeneric(door);
  }

  function gameflow(state) {
    const target = resolveState(state);
    const locked = !canOpenBossDoor();
    for (const door of target.entities || []) {
      if (!door || !door.bossDoor) continue;
      door.isLocked = locked;
      syncFlags(door);
    }
  }

  W.Doors = {
    spawn: createDoor,
    update,
    open: openDoorGeneric,
    openNormalDoor,
    openBossDoor,
    toggle: toggleDoor,
    close: closeDoor,
    openUrgencias,
    canOpenBossDoor,
    onHeroInteractDoor,
    gameflow,
  };

  W.DoorAPI = {
    spawn: createDoor,
    update,
    open: openDoorGeneric,
    openNormalDoor,
    openBossDoor,
    toggle: toggleDoor,
    closeDoor,
    openUrgencias,
    canOpenBossDoor,
    onHeroInteractDoor,
    setLocked,
    findNearestDoor,
    autoOpenNear,
    gameflow,
  };

  W.DoorsAPI = W.DoorAPI; // compatibilidad ligera

  W.Entities = W.Entities || {};
  W.Entities.Door = { spawn: (x, y, opts) => createDoor(x, y, opts || {}) };
})();
