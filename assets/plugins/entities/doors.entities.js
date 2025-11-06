// ./assets/plugins/entities/doors.entities.js
(function(){
  const TILE = window.TILE_SIZE || window.TILE || 32;

  function resolveState(state){
    const g = window.G || (window.G = {});
    const target = (state && typeof state === 'object') ? state : g;
    if (!Array.isArray(target.entities)) target.entities = [];
    if (!Array.isArray(target.doors)) target.doors = [];
    return target;
  }

  function ensureKind(state){
    const ent = state.ENT || window.ENT || {};
    return (ent.DOOR != null) ? ent.DOOR : 'DOOR';
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
      state: {
        open: !!opts.open,
        openProgress: opts.open ? 1 : 0
      }
    };
    door.open = door.state.open;

    attachPuppet(door);
    window.MovementSystem?.register?.(door);
    state.entities.push(door);
    if (!state.doors.includes(door)) state.doors.push(door);
    return door;
  }

  function update(door, state, dt){
    if (!door) return;
    const st = door.state || (door.state = { open: false, openProgress: 0 });
    const dtMs = Math.max(0, (Number.isFinite(dt) ? dt : 0) * 1000);
    const speed = 0.005 * dtMs;
    st.openProgress += st.open ? speed : -speed;
    if (st.openProgress < 0) st.openProgress = 0;
    if (st.openProgress > 1) st.openProgress = 1;
    door.open = !!st.open;
    door.solid = !door.open;
  }

  function gameflow(state){
    state = resolveState(state);
    const patientsAlive = (state.entities || []).some((ent) => isKind(ent, 'PATIENT') && !ent.dead);
    for (const ent of state.entities){
      if (!isKind(ent, 'DOOR')) continue;
      if (ent.bossDoor){
        ent.state = ent.state || { open: false, openProgress: 0 };
        ent.state.open = !patientsAlive;
        ent.open = ent.state.open;
        ent.solid = !ent.open;
      }
    }
  }

  function openDoor(door){
    if (!door) return false;
    door.state = door.state || { open: false, openProgress: 0 };
    door.state.open = true;
    door.open = true;
    door.solid = false;
    return true;
  }

  function closeDoor(door){
    if (!door) return false;
    door.state = door.state || { open: false, openProgress: 0 };
    if (door.bossDoor) return false;
    door.state.open = false;
    door.open = false;
    door.solid = true;
    return true;
  }

  function toggleDoor(door){
    if (!door) return false;
    return door.state?.open ? closeDoor(door) : openDoor(door);
  }

  function openUrgencias(state){
    state = resolveState(state);
    let opened = false;
    const maybeOpen = (door) => {
      if (!door) return;
      const isBoss = !!(door.bossDoor || door.isBossDoor || door.tag === 'bossDoor');
      if (!isBoss) return;
      door.state = door.state || { open: false, openProgress: 0 };
      if (!door.state.open || door.solid) {
        opened = true;
      }
      door.state.open = true;
      door.state.openProgress = 1;
      door.open = true;
      door.solid = false;
      if (door.spriteKey) door.spriteKey = '--sprite-door-open';
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
    }
    return opened;
  }

  window.Doors = { spawn, update, gameflow, open: openDoor, close: closeDoor, toggle: toggleDoor, openUrgencias };

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
