(function(){
  'use strict';

  const Damage = {};
  const cooldownById = new Map();
  let autoId = 1;

  function ensureState(state){
    if (state && typeof state === 'object') return state;
    if (!window.G) window.G = {};
    return window.G;
  }

  function getNow(){
    return performance.now() / 1000;
  }

  function getId(ent){
    if (!ent) return null;
    if (ent.id != null) return ent.id;
    if (!ent.__damageAutoId){
      ent.__damageAutoId = `auto-${autoId++}`;
    }
    return ent.__damageAutoId;
  }

  function isHostile(ent){
    if (!ent) return false;
    if (ent.hostile === true) return true;
    const kind = (ent.kindName || ent.kind || '').toString().toLowerCase();
    return kind.includes('rat') || kind.includes('mosquito');
  }

  function aabb(a, b){
    if (!a || !b) return false;
    return !(
      a.x + a.w <= b.x ||
      a.x >= b.x + b.w ||
      a.y + a.h <= b.y ||
      a.y >= b.y + b.h
    );
  }

  Damage.update = function(state, dt){
    state = ensureState(state);
    const player = state.player;
    if (!player) return;

    if (typeof player.health !== 'number'){
      const halves = typeof state.health === 'number' ? state.health : (typeof player.hp === 'number' ? player.hp * 2 : 0);
      player.health = halves * 0.5;
    }
    if (typeof player.invulnUntil !== 'number') player.invulnUntil = 0;

    const entities = Array.isArray(state.entities) ? state.entities : [];
    const now = getNow();

    for (const ent of entities){
      if (!ent || ent.dead) continue;
      if (!isHostile(ent)) continue;
      if (!aabb(player, ent)) continue;

      const key = getId(ent);
      const nextHit = cooldownById.get(key) || 0;
      if (now < nextHit) continue;
      if (now < player.invulnUntil) continue;

      const base = (typeof player.health === 'number')
        ? player.health
        : (typeof player.hp === 'number') ? player.hp : ((typeof state.health === 'number') ? state.health * 0.5 : 0);
      const newHealth = Math.max(0, base - 0.5);
      player.health = newHealth;
      if (typeof player.hp === 'number'){
        player.hp = Math.max(0, newHealth);
      }
      state.health = Math.max(0, Math.round(newHealth * 2));
      cooldownById.set(key, now + 1.0);
      player.invulnUntil = now + 1.0;
      if (typeof player.invuln === 'number'){
        player.invuln = Math.max(player.invuln, 1.0);
      } else {
        player.invuln = 1.0;
      }

      if (ent && typeof ent.x === 'number'){
        const px = (player.x || 0) + (player.w || 0) * 0.5;
        const py = (player.y || 0) + (player.h || 0) * 0.5;
        const ex = (ent.x || 0) + (ent.w || 0) * 0.5;
        const ey = (ent.y || 0) + (ent.h || 0) * 0.5;
        const dx = px - ex;
        const dy = py - ey;
        const len = Math.hypot(dx, dy) || 1;
        const force = 140;
        player.vx = (player.vx || 0) + (dx / len) * force;
        player.vy = (player.vy || 0) + (dy / len) * force;
      }

      window.LOG?.event?.('HIT', {
        attacker: ent.id || key,
        target: player.id || 'PLAYER',
        amount: 0.5,
      });

      if (window.DEBUG_FORCE_ASCII){
        console.log('[Damage] hit by', ent.kindName || ent.kind || key, 'hp=', player.health.toFixed(2));
      }
    }
  };

  window.DamageSystem = Damage;
})();
