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

  const getPhysicsDefaults = () => (window.Physics && window.Physics.DEFAULTS)
    ? window.Physics.DEFAULTS
    : { hurtImpulse: 45 };

  function knockback(target, from, power = getPhysicsDefaults().hurtImpulse){
    if (!target || !from || !window.Physics || typeof window.Physics.applyImpulse !== 'function') return;
    const dx = (target.x + target.w * 0.5) - (from.x + from.w * 0.5);
    const dy = (target.y + target.h * 0.5) - (from.y + from.h * 0.5);
    const L = Math.hypot(dx, dy) || 1;
    const scale = (power != null ? power : getPhysicsDefaults().hurtImpulse) / Math.max(1, (target.mass || 1));
    window.Physics.applyImpulse(target, (dx / L) * scale, (dy / L) * scale);
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

  function preparePlayerState(state){
    const player = state && state.player;
    if (!player) return;
    if (typeof player.health !== 'number'){
      const halves = (typeof state.health === 'number')
        ? state.health
        : (typeof player.hp === 'number') ? player.hp * 2 : 0;
      player.health = halves * 0.5;
    }
    if (typeof player.invulnUntil !== 'number') player.invulnUntil = 0;
  }

  function applyDamageToPlayer(state, amount, meta = {}){
    if (!state || typeof amount !== 'number') return false;
    const player = state.player;
    if (!player) return false;
    const now = getNow();
    if (!meta.ignoreInvuln && typeof player.invulnUntil === 'number' && now < player.invulnUntil) return false;

    const base = (typeof player.health === 'number')
      ? player.health
      : (typeof player.hp === 'number')
        ? player.hp
        : (typeof state.health === 'number') ? state.health * 0.5 : 0;

    const newHealth = Math.max(0, base - amount);
    player.health = newHealth;
    if (typeof player.hp === 'number') player.hp = Math.max(0, newHealth);
    state.health = Math.max(0, Math.round(newHealth * 2));

    const invuln = (typeof meta.invuln === 'number') ? Math.max(0, meta.invuln) : 1.0;
    player.invulnUntil = now + invuln;
    if (typeof player.invuln === 'number') player.invuln = Math.max(player.invuln, invuln);
    else player.invuln = invuln;

    try {
      const heroAPI = window.Entities?.Hero;
      heroAPI?.notifyDamage?.(player, meta);
      if (newHealth <= 0) {
        heroAPI?.setDeathCause?.(player, meta.source || meta.attacker || null);
      }
    } catch(err){ if (window.DEBUG_FORCE_ASCII) console.warn('[Damage] notify hero anim error', err); }

    if (meta.knockbackFrom){
      knockback(player, meta.knockbackFrom, meta.knockbackPower);
    }

    try {
      window.LOG?.event?.('HIT', {
        attacker: meta.attackerId || meta.attacker?.id || meta.source || 'UNKNOWN',
        target: player.id || 'PLAYER',
        amount,
        source: meta.source || (meta.attacker?.kindName || meta.attacker?.kind || 'unknown')
      });
    } catch (_) {}

    if (typeof meta.onDamage === 'function'){
      try { meta.onDamage(); } catch (_) {}
    }

    return true;
  }

  Damage.update = function(state, dt){
    state = ensureState(state);
    const player = state.player;
    if (!player) return;

    preparePlayerState(state);

    const entities = Array.isArray(state.entities) ? state.entities : [];
    const now = getNow();

    if (window.FireAPI?.update){
      try { window.FireAPI.update(dt); }
      catch (err) {
        if (window.DEBUG_FORCE_ASCII) console.warn('[Fire] update error', err);
      }
    }

    for (const ent of entities){
      if (!ent || ent.dead) continue;
      if (!isHostile(ent)) continue;
      if (!aabb(player, ent)) continue;

      const key = getId(ent);
      const nextHit = cooldownById.get(key) || 0;
      if (now < nextHit) continue;
      const applied = applyDamageToPlayer(state, 0.5, {
        attacker: ent,
        attackerId: ent.id || key,
        source: ent.kindName || ent.kind || 'enemy',
        invuln: 1.0,
        knockbackFrom: ent
      });
      if (!applied) continue;
      cooldownById.set(key, now + 1.0);
      if (typeof window.LogCollision === 'function') {
        try {
          window.LogCollision('HERO_DAMAGE', {
            source: ent.kindName || ent.kind || key,
            hp: Number.isFinite(player.health) ? Number(player.health.toFixed(2)) : player.health,
          });
        } catch (_) {}
      }
    }

    const fires = window.FireAPI?.getActive?.();
    if (Array.isArray(fires) && fires.length){
      for (const fire of fires){
        if (!fire || fire.dead) continue;
        if (!aabb(player, fire)){
          fire._damageTimer = 0;
          continue;
        }
        const tick = typeof fire.tick === 'number' ? Math.max(0.05, fire.tick) : 0.4;
        fire._damageTimer = (fire._damageTimer || 0) + dt;
        if (fire._damageTimer < tick) continue;
        const amount = typeof fire.damage === 'number'
          ? fire.damage
          : (typeof fire.dps === 'number' ? fire.dps * tick : 0.5);
        const invuln = (typeof fire.invuln === 'number') ? Math.max(0, fire.invuln) : Math.max(0.2, tick * 0.75);
        const applied = applyDamageToPlayer(state, amount, {
          attacker: fire,
          attackerId: fire.id || 'FIRE',
          source: 'fire',
          invuln
        });
        if (applied){
          fire._damageTimer -= tick;
        } else {
          fire._damageTimer = tick; // intenta de nuevo al acabar la invulnerabilidad
        }
      }
    }
  };

  window.DamageSystem = Damage;
})();
