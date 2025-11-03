// ./assets/plugins/entities/mosquito.entities.js
(function(){
  const SPEED = 49;
  const WANDER_SPEED = 26;
  const CHASE_RADIUS = 240;
  const TAU = Math.PI * 2;

  function resolveState(state){
    const g = window.G || (window.G = {});
    const target = (state && typeof state === 'object') ? state : g;
    if (!Array.isArray(target.entities)) target.entities = [];
    if (!Array.isArray(target.enemies)) target.enemies = [];
    if (!Array.isArray(target.movers)) target.movers = [];
    return target;
  }

  function attachPuppet(ent){
    try {
      const puppet = window.Puppet?.bind?.(ent, 'mosquito', { z: 0, scale: 1 })
        || window.PuppetAPI?.attach?.(ent, { rig: 'mosquito', z: 0, scale: 1 });
      ent.rigOk = ent.rigOk === true || !!puppet;
    } catch (_) {
      ent.rigOk = ent.rigOk === true;
    }
  }

  function ensureKind(state){
    const ent = state.ENT || window.ENT || {};
    return (ent.MOSQUITO != null) ? ent.MOSQUITO : 'MOSQUITO';
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
      kindName: 'MOSQUITO',
      x: Number(x) || 0,
      y: Number(y) || 0,
      w: 12,
      h: 8,
      vx: 0,
      vy: 0,
      hostile: true,
      _t: 0,
      ai: 'MOSQUITO',
      aiId: 'MOSQUITO'
    };

    ent._spawnX = ent.x;
    ent._spawnY = ent.y;
    ent._wanderTimer = 0;
    ent._wanderDir = Math.random() * TAU;

    try { window.AI?.attach?.(ent, 'MOSQUITO'); } catch (_) {}

    attachPuppet(ent);
    window.MovementSystem?.register?.(ent);
    state.entities.push(ent);
    state.enemies.push(ent);
    state.movers.push(ent);
    return ent;
  }

  function ai(ent, state, dt){
    state = resolveState(state);
    if (!ent || ent.dead) return;
    const player = state.player;
    const cx = ent.x + ent.w * 0.5;
    const cy = ent.y + ent.h * 0.5;
    const px = player ? (player.x + (player.w || 0) * 0.5) : cx;
    const py = player ? (player.y + (player.h || 0) * 0.5) : cy;
    const dx = px - cx;
    const dy = py - cy;
    const dist = Math.hypot(dx, dy);

    ent._t = (ent._t || 0) + dt;

    if (!player || dist > CHASE_RADIUS){
      ent.hostile = dist <= CHASE_RADIUS;
      ent._aiState = 'WANDER';
      ent._wanderTimer = (ent._wanderTimer || 0) - dt;
      if (ent._wanderTimer <= 0){
        ent._wanderTimer = 0.8 + Math.random() * 1.6;
        const homeDx = (ent._spawnX || ent.x) - cx;
        const homeDy = (ent._spawnY || ent.y) - cy;
        const bias = Math.atan2(homeDy, homeDx);
        const jitter = (Math.random() - 0.5) * Math.PI * 0.6;
        ent._wanderDir = isFinite(bias) ? bias + jitter : Math.random() * TAU;
      }
      const sway = Math.sin(ent._t * 2.6) * 0.4;
      const dir = ent._wanderDir + sway * 0.2;
      ent.vx = Math.cos(dir) * WANDER_SPEED;
      ent.vy = Math.sin(dir) * WANDER_SPEED;
      return;
    }

    const ux = dist > 0 ? dx / dist : 0;
    const uy = dist > 0 ? dy / dist : 0;

    if (ent._aiState !== 'CHASE') {
      ent._aiState = 'CHASE';
      try {
        window.LOG?.event?.('AI_STATE', {
          entity: ent.id || null,
          kind: 'MOSQUITO',
          state: 'CHASE',
        });
      } catch (_) {}
    }

    const sway = Math.sin(ent._t * 5.8);
    const sway2 = Math.cos(ent._t * 6.6);

    ent.vx = (ux + 0.4 * sway) * SPEED;
    ent.vy = (uy + 0.4 * sway2) * SPEED;
    ent.hostile = true;
  }

  window.Mosquitos = { spawn, ai };

  const compat = {
    state: null,
    init(state){ this.state = resolveState(state); return this; },
    spawn(x, y, props){ return spawn(this.state || resolveState(), x, y, props); },
    spawnAtTiles(tx, ty, props){
      const s = this.state || resolveState();
      const tile = window.TILE_SIZE || window.TILE || 32;
      return spawn(s, tx * tile + tile * 0.5, ty * tile + tile * 0.5, props);
    },
    registerSpawn(){ return true; },
    populateAtStart(){},
    onEnemyKilled(){},
    update(){},
  };
  window.MosquitoAPI = compat;
})();
