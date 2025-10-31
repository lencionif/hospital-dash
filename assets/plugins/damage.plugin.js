(function(){
  const Damage = {};
  const COOLDOWNS = new WeakMap();
  const IF_FRAMES_MS = 1000;
  const TICK_MS = 1000;
  const DMG_HEARTS = 0.5; // medio corazón

  function ensureState(state){
    const g = window.G || (window.G = {});
    if (!state || typeof state !== 'object') return g;
    return state;
  }

  function toMs(dt){
    const n = Number.isFinite(dt) ? dt : 0;
    return n > 0 ? n * 1000 : 0;
  }

  function aabb(a, b){
    if (!a || !b) return false;
    return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
  }

  Damage.update = function(state, dt){
    state = ensureState(state);
    const player = state.player;
    if (!player) return;

    const dtMs = toMs(dt);
    if (player.iframes != null){
      player.iframes = Math.max(0, player.iframes - dtMs);
    }

    const entities = Array.isArray(state.entities) ? state.entities : [];
    for (const ent of entities){
      if (!ent || ent.dead) continue;
      if (!ent.kind || !ent.hostile) continue;
      if (!aabb(ent, player)) continue;

      let cd = COOLDOWNS.get(ent) || 0;
      cd = Math.max(0, cd - dtMs);

      const hasIFrames = player.iframes && player.iframes > 0;
      if (cd === 0 && !hasIFrames){
        const halves = Math.max(1, Math.round(DMG_HEARTS * 2));
        if (typeof window.damagePlayer === 'function'){
          window.damagePlayer(ent, halves);
        } else {
          if (typeof player.hp === 'number'){
            player.hp = Math.max(0, player.hp - DMG_HEARTS);
          }
          if (typeof state.health === 'number'){
            state.health = Math.max(0, state.health - halves);
          }
        }

        COOLDOWNS.set(ent, TICK_MS);
        player.iframes = IF_FRAMES_MS;
        if (typeof player.invuln === 'number'){
          player.invuln = Math.max(player.invuln, IF_FRAMES_MS / 1000);
        } else {
          player.invuln = IF_FRAMES_MS / 1000;
        }

        if (!Array.isArray(state.events)) state.events = [];
        state.events.push({ type: 'HIT', from: ent });
      } else {
        COOLDOWNS.set(ent, cd);
      }
    }
  };

  window.DamageSystem = Damage;
})();
