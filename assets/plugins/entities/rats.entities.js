// ./assets/plugins/entities/rats.entities.js
(function(){
  const SPEED = 45;
  const CHASE_RADIUS = 200;

  function resolveState(state){
    const g = window.G || (window.G = {});
    const target = (state && typeof state === 'object') ? state : g;
    if (!Array.isArray(target.entities)) target.entities = [];
    if (!Array.isArray(target.hostiles)) target.hostiles = [];
    if (!Array.isArray(target.movers)) target.movers = [];
    try { window.EntityGroups?.ensure?.(target); } catch (_) {}
    return target;
  }

  function attachPuppet(ent){
    try {
      const puppet = window.Puppet?.bind?.(ent, 'rat', { z: 0, scale: 1 })
        || window.PuppetAPI?.attach?.(ent, { rig: 'rat', z: 0, scale: 1 });
      ent.rigOk = ent.rigOk === true || !!puppet;
    } catch (_) {
      ent.rigOk = ent.rigOk === true;
    }
  }

  function ensureKind(state){
    const ent = state.ENT || window.ENT || {};
    return (ent.RAT != null) ? ent.RAT : 'RAT';
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

    const ent = {
      kind: ensureKind(state),
      kindName: 'RAT',
      x: Number(x) || 0,
      y: Number(y) || 0,
      w: 16,
      h: 10,
      vx: 0,
      vy: 0,
      hostile: true,
      seed: Math.random() * Math.PI * 2,
      ai: 'RAT',
      aiId: 'RAT'
    };

    ent.solid = true;
    ent.dynamic = true;
    ent.pushable = true;
    ent.mass = 0.45;
    ent.rest = 0.52;
    ent.restitution = 0.52;
    ent.mu = 0.02;

    try { window.AI?.attach?.(ent, 'RAT'); } catch (_) {}

    attachPuppet(ent);
    window.MovementSystem?.register?.(ent);
    ent.group = 'animal';
    state.entities.push(ent);
    state.hostiles.push(ent);
    state.movers.push(ent);
    try { window.EntityGroups?.assign?.(ent); } catch (_) {}
    try { window.EntityGroups?.register?.(ent, state); } catch (_) {}
    return ent;
  }

  function ai(ent, state, dt){
    state = resolveState(state);
    if (!ent || ent.dead) return;
    const player = state.player;
    if (!player){
      ent.vx = 0;
      ent.vy = 0;
      return;
    }

    const dx = (player.x + (player.w || 0) * 0.5) - (ent.x + ent.w * 0.5);
    const dy = (player.y + (player.h || 0) * 0.5) - (ent.y + ent.h * 0.5);
    const distSq = dx*dx + dy*dy;
    const chase = distSq <= CHASE_RADIUS * CHASE_RADIUS;

    const nextState = chase ? 'CHASE' : 'WANDER';
    if (ent._aiState !== nextState) {
      ent._aiState = nextState;
      try {
        window.LOG?.event?.('AI_STATE', {
          entity: ent.id || null,
          kind: 'RAT',
          state: nextState,
          distance: Math.sqrt(distSq) || 0,
        });
      } catch (_) {}
    }

    if (chase){
      const len = Math.hypot(dx, dy) || 1;
      ent.vx = (dx / len) * SPEED;
      ent.vy = (dy / len) * SPEED;
    } else {
      ent._t = (ent._t || 0) + dt;
      const wander = SPEED * 0.5;
      ent.vx = Math.cos(ent._t * 0.75 + (ent.seed || 0)) * wander;
      ent.vy = Math.sin(ent._t * 0.85 + (ent.seed || 0)) * wander;
    }

    ent.hostile = true;
  }

  window.Rats = { spawn, ai };

  const compat = {
    state: null,
    init(state){ this.state = resolveState(state); return this; },
    spawn(x, y, props){ return spawn(this.state || resolveState(), x, y, props); },
    spawnAtTiles(tx, ty, props){
      const s = this.state || resolveState();
      const tile = window.TILE_SIZE || window.TILE || 32;
      return spawn(s, tx * tile + tile * 0.5, ty * tile + tile * 0.5, props);
    },
    registerSpawn(){ return true; }
  };
  window.RatsAPI = compat;
})();
