// ./assets/plugins/entities/doors.entities.js
(function(){
  const TILE = window.TILE_SIZE || window.TILE || 32;
  const DOOR_ANIM_SECONDS = 0.5;
  const SOLID_THRESHOLD = 0.6;
  const OPEN_FLAG_THRESHOLD = 0.9;

  function resolveState(state){
    const g = window.G || (window.G = {});
    const target = (state && typeof state === 'object') ? state : g;
    if (!Array.isArray(target.entities)) target.entities = [];
    if (!Array.isArray(target.doors)) target.doors = [];
    ensureInteractBinding();
    return target;
  }

  function ensureKind(state){
    const ent = state.ENT || window.ENT || {};
    return (ent.DOOR != null) ? ent.DOOR : 'DOOR';
  }

  let interactBound = false;
  let interactHandler = null;

  function ensureInteractBinding(){
    if (interactBound) return;
    const G = window.G || (window.G = {});
    if (!Array.isArray(G.onInteract)) G.onInteract = [];
    interactHandler = (player) => toggleNearestDoor(player, { radius: TILE * 1.1 });
    G.onInteract.unshift(interactHandler);
    interactBound = true;
  }

  function isKind(e, key){
    if (!e) return false;
    const target = String(key).toUpperCase();
    if (typeof e.kind === 'string' && e.kind.toUpperCase() === target) return true;
    if (typeof e.kind === 'number' && (window.ENT?.[target] === e.kind)) return true;
    if (typeof e.kindName === 'string' && e.kindName.toUpperCase() === target) return true;
    if (typeof e.type === 'string' && e.type.toUpperCase() === target) return true;
    return false;
  }

  function attachPuppet(ent){
    try {
      const puppet = window.Puppet?.bind?.(ent, 'door', { z: 0, scale: 1 })
        || window.PuppetAPI?.attach?.(ent, { rig: 'door', z: 0, scale: 1 });
      ent.rigOk = ent.rigOk === true || !!puppet;
    } catch (_) {
      ent.rigOk = ent.rigOk === true;
    }
    if (!ent.state) ent.state = { open: false, openProgress: 0 };
  }

  function spawn(state, x, y, opts = {}){
    if (typeof state === 'number' || !state || !state.entities){
      opts = y || {};
      y = x;
      x = state;
      state = resolveState();
    } else {
      state = resolveState(state);
    }

    const door = {
      kind: ensureKind(state),
      kindName: 'DOOR',
      x: Number(x) || 0,
      y: Number(y) || 0,
      w: opts.w || TILE,
      h: opts.h || TILE,
      solid: !(opts.open),
      static: true,
      bossDoor: !!opts.bossDoor,
      isBossDoor: !!(opts.bossDoor || opts.isBossDoor || opts.tag === 'bossDoor'),
      locked: opts.locked != null ? !!opts.locked : !!(opts.bossDoor || opts.isBossDoor || opts.tag === 'bossDoor'),
      state: {
        open: !!opts.open,
        openProgress: opts.open ? 1 : 0,
        autoCloseTimer: 0,
        autoCloser: null,
        holdOpen: !!opts.open
      }
    };
    door.open = door.state.open;

    attachPuppet(door);
    window.MovementSystem?.register?.(door);
    state.entities.push(door);
    if (!state.doors.includes(door)) state.doors.push(door);
    return door;
  }

  function aabb(a,b){
    if (!a || !b) return false;
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function centerOf(ent){
    return {
      x: ent.x + (ent.w || TILE) * 0.5,
      y: ent.y + (ent.h || TILE) * 0.5
    };
  }

  function update(door, state, dt){
    if (!door || door._inactive) return;
    const st = door.state || (door.state = { open: false, openProgress: 0, autoCloseTimer: 0, autoCloser: null });
    const delta = Math.max(0, Number.isFinite(dt) ? dt : 0);
    if (st.autoCloseTimer > 0 && !door.bossDoor){
      const closer = st.autoCloser;
      if (closer && aabb(door, closer)){
        st.autoCloseTimer = Math.max(st.autoCloseTimer, 0.15);
      } else {
        st.autoCloseTimer = Math.max(0, st.autoCloseTimer - delta);
        if (st.autoCloseTimer === 0){
          st.autoCloser = null;
          st.open = false;
        }
      }
    }
    const speed = (delta <= 0) ? 0 : Math.min(1, delta / DOOR_ANIM_SECONDS);
    st.openProgress += st.open ? speed : -speed;
    if (st.openProgress < 0) st.openProgress = 0;
    if (st.openProgress > 1) st.openProgress = 1;
    door.open = st.openProgress >= OPEN_FLAG_THRESHOLD || !!st.holdOpen;
    door.solid = st.openProgress < SOLID_THRESHOLD && !door.open;
  }

  function gameflow(state){
    state = resolveState(state);
    const urgenciasOpen = !!(state.urgenciasOpen || (window.G && window.G.urgenciasOpen));
    const patientsAlive = (state.entities || []).some((ent) => isKind(ent, 'PATIENT') && !ent.dead);
    for (const ent of state.entities){
      if (!isKind(ent, 'DOOR')) continue;
      if (ent.bossDoor || ent.isBossDoor || ent.tag === 'bossDoor'){
        ent.locked = !urgenciasOpen && patientsAlive;
        ent.state = ent.state || { open: false, openProgress: 0 };
        if (urgenciasOpen && !ent.state.open){
          ent.state.open = true;
          ent.state.holdOpen = true;
          ent.open = true;
          ent.solid = false;
        }
        if (!urgenciasOpen && ent.state.open){
          ent.state.open = false;
          ent.state.holdOpen = false;
          ent.open = false;
          ent.solid = true;
        }
      }
    }
  }

  function playDoorSound(type, door, opts={}){
    if (opts.silent) return;
    try {
      const api = window.AudioAPI;
      if (!api || typeof api.play !== 'function') return;
      if (type === 'boss') api.play('boss_door', { volume: 0.9, tag: 'boss_door' });
      else api.play('door_open', { volume: type === 'close' ? 0.45 : 0.7, tag: 'door_toggle' });
    } catch (_) {}
  }

  function notifyLocked(door){
    try {
      const msg = door && (door.bossDoor || door.isBossDoor)
        ? 'La puerta está bloqueada electrónicamente.'
        : 'La puerta no responde.';
      window.DialogAPI?.system?.(msg, { ms: 2200 });
    } catch (_) { console.info('[Door]', 'locked'); }
  }

  function openDoor(door, opts={}){
    if (!door) return false;
    door.state = door.state || { open: false, openProgress: 0 };
    if (door.locked && !opts.ignoreLock) return false;
    if (door.state.open && door.open) {
      if (opts.autoCloseAfter) {
        door.state.autoCloseTimer = Math.max(door.state.autoCloseTimer || 0, opts.autoCloseAfter);
        door.state.autoCloser = opts.by || null;
      }
      return false;
    }
    door.state.open = true;
    door.state.holdOpen = !!opts.holdOpen;
    door.state.autoCloseTimer = opts.autoCloseAfter ? Math.max(door.state.autoCloseTimer || 0, opts.autoCloseAfter) : 0;
    door.state.autoCloser = opts.autoCloseAfter ? (opts.by || null) : null;
    door.open = true;
    door.solid = false;
    if (door.spriteKey) door.spriteKey = '--sprite-door-open';
    playDoorSound('open', door, opts);
    return true;
  }

  function closeDoor(door, opts={}){
    if (!door) return false;
    door.state = door.state || { open: false, openProgress: 0 };
    if (door.bossDoor) return false;
    door.state.open = false;
    door.state.holdOpen = false;
    door.state.autoCloseTimer = 0;
    door.state.autoCloser = null;
    door.open = false;
    door.solid = true;
    if (door.spriteKey) door.spriteKey = '--sprite-door-closed';
    playDoorSound('close', door, opts);
    return true;
  }

  function toggleDoor(door, opts={}){
    if (!door) return false;
    if (door.locked && !door.open){
      if (opts.feedback !== false) notifyLocked(door);
      return true;
    }
    return door.state?.open ? closeDoor(door, opts) : openDoor(door, opts);
  }

  function collectDoors(state){
    const target = resolveState(state);
    const set = new Set();
    const pushDoor = (door) => {
      if (!door) return;
      if (!(isKind(door, 'DOOR') || door.bossDoor || door.isBossDoor || door.tag === 'bossDoor')) return;
      set.add(door);
    };
    for (const d of target.doors || []) pushDoor(d);
    for (const e of target.entities || []) pushDoor(e);
    const G = window.G || {};
    for (const d of G.doors || []) pushDoor(d);
    return Array.from(set);
  }

  function findNearestDoor(entity, radius=TILE*1.1, opts={}){
    if (!entity) return null;
    const list = collectDoors(opts.state);
    const origin = centerOf(entity);
    const maxR2 = radius > 0 ? radius * radius : Infinity;
    let best = null;
    let bestD2 = Infinity;
    for (const door of list){
      if (!door) continue;
      if (opts.onlyClosed && door.open) continue;
      if (opts.excludeLocked && door.locked && !door.open) continue;
      const c = centerOf(door);
      const dx = c.x - origin.x;
      const dy = c.y - origin.y;
      const d2 = dx*dx + dy*dy;
      if (radius > 0 && d2 > maxR2) continue;
      if (d2 < bestD2){
        bestD2 = d2;
        best = door;
      }
    }
    return best;
  }

  function toggleNearestDoor(entity, opts={}){
    if (!entity) return false;
    const radius = opts.radius != null ? opts.radius : TILE * 1.1;
    const door = findNearestDoor(entity, radius, { state: opts.state });
    if (!door) return false;
    const toggled = toggleDoor(door, Object.assign({ by: entity, feedback: opts.feedback !== false }, opts));
    if (!toggled && (door.bossDoor || door.isBossDoor)) return true;
    return toggled;
  }

  function autoOpenNear(entity, radius=TILE*0.9, opts={}){
    const door = findNearestDoor(entity, radius, { excludeLocked: true, onlyClosed: true, state: opts.state });
    if (!door) return false;
    return openDoor(door, { by: entity, autoCloseAfter: opts.autoCloseAfter ?? 1.2, silent: true });
  }

  function openUrgencias(state){
    state = resolveState(state);
    let opened = false;
    let bossDoorRef = null;
    const maybeOpen = (door) => {
      if (!door) return;
      const isBoss = !!(door.bossDoor || door.isBossDoor || door.tag === 'bossDoor');
      if (!isBoss) return;
      door.state = door.state || { open: false, openProgress: 0 };
      if (!door.state.open || door.solid) opened = true;
      door.locked = false;
      door.state.open = true;
      door.state.holdOpen = true;
      door.state.openProgress = 1;
      door.state.autoCloseTimer = 0;
      door.state.autoCloser = null;
      door.open = true;
      door.solid = false;
      if (door.spriteKey) door.spriteKey = '--sprite-door-open';
      bossDoorRef = door;
    };
    if (Array.isArray(state.entities)) {
      for (const ent of state.entities) {
        if (isKind(ent, 'DOOR')) maybeOpen(ent);
      }
    }
    if (Array.isArray(state.doors)) {
      for (const ent of state.doors) {
        maybeOpen(ent);
      }
    }
    if (state.door && isKind(state.door, 'DOOR')) {
      maybeOpen(state.door);
    }
    if (opened) {
      state.urgenciasOpen = true;
      try {
        const G = window.G || null;
        if (G && typeof G === 'object') G.urgenciasOpen = true;
      } catch (_) {}
      try { window.GameFlowAPI?.notifyPatientCountersChanged?.(); } catch (_) {}
      playDoorSound('boss', bossDoorRef || {}, {});
      try { window.DialogAPI?.system?.('¡Urgencias abiertas! Dirígete a la salida.', { ms: 4200 }); } catch (_) {}
      try { window.ArrowGuide?.setTargetBossOrDoor?.(); } catch (_) {}
    }
    return opened;
  }

  window.Doors = { spawn, update, gameflow, open: openDoor, close: closeDoor, toggle: toggleDoor, openUrgencias };
  window.DoorsAPI = {
    toggleNearest: (entity, radius)=> toggleNearestDoor(entity, { radius }),
    autoOpenNear: (entity, radius, opts)=> autoOpenNear(entity, radius, opts || {}),
    findNearest: findNearestDoor,
    isLocked: (door) => !!(door && door.locked && !door.open),
    setLocked: (door, locked=true) => {
      if (!door) return false;
      door.locked = !!locked;
      if (locked) {
        door.state = door.state || { open: false, openProgress: 0 };
        door.state.open = false;
        door.state.holdOpen = false;
        door.open = false;
        door.solid = true;
      }
      return true;
    }
  };

  window.Entities = window.Entities || {};
  window.Entities.Door = {
    spawn(x, y, opts){ return spawn(resolveState(), x, y, opts); },
    open: openDoor,
    close: closeDoor,
    toggle: toggleDoor,
    tryOpen: openDoor,
    tryClose: closeDoor
  };
})();
