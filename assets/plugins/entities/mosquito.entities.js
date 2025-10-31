// ./assets/plugins/entities/mosquito.entities.js
(function(){
  const SPEED = 70;

  function resolveState(state){
    const g = window.G || (window.G = {});
    const target = (state && typeof state === 'object') ? state : g;
    if (!Array.isArray(target.entities)) target.entities = [];
    if (!Array.isArray(target.enemies)) target.enemies = [];
    if (!Array.isArray(target.movers)) target.movers = [];
    return target;
  }

  function attachPuppet(ent){
    try { window.PuppetAPI?.attach?.(ent, { rig: 'mosquito', z: 2, scale: 1.0 }); } catch (_) {}
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
      ai: 'MOSQUITO'
    };

    attachPuppet(ent);
    state.entities.push(ent);
    state.enemies.push(ent);
    state.movers.push(ent);
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
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    ent._t = (ent._t || 0) + dt;
    const sway = Math.sin(ent._t * 6.0);
    const sway2 = Math.cos(ent._t * 7.4);

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
