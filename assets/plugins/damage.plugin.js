(() => {
  'use strict';

  const W = window;
  const Damage = W.Damage || (W.Damage = {});
  const cooldownById = new Map();
  let autoId = 1;

  function ensureState(state){
    if (state && typeof state === 'object') return state;
    if (!W.G) W.G = {};
    return W.G;
  }

  function getNow(){
    return performance.now() / 1000;
  }

  const getPhysicsDefaults = () => (W.Physics && W.Physics.DEFAULTS)
    ? W.Physics.DEFAULTS
    : { hurtImpulse: 45 };

  function knockback(target, from, power = getPhysicsDefaults().hurtImpulse){
    if (!target || !from || !W.Physics || typeof W.Physics.applyImpulse !== 'function') return;
    const dx = (target.x + target.w * 0.5) - (from.x + from.w * 0.5);
    const dy = (target.y + target.h * 0.5) - (from.y + from.h * 0.5);
    const L = Math.hypot(dx, dy) || 1;
    const scale = (power != null ? power : getPhysicsDefaults().hurtImpulse) / Math.max(1, (target.mass || 1));
    W.Physics.applyImpulse(target, (dx / L) * scale, (dy / L) * scale);
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
    if (typeof state.healthMax !== 'number' && typeof player.hpMax === 'number') {
      state.healthMax = Math.round(player.hpMax * 2);
    }
  }

  function heroHearts(state){
    const player = state?.player;
    if (!player) return { current: 0, max: 0 };
    const current = (typeof player.health === 'number')
      ? player.health
      : (typeof player.hp === 'number')
        ? player.hp
        : (typeof state.health === 'number') ? state.health * 0.5 : 0;
    const max = (typeof player.hpMax === 'number')
      ? player.hpMax
      : (typeof state.healthMax === 'number') ? state.healthMax * 0.5 : Math.max(current, 3);
    return { current, max };
  }

  function syncHeroHealth(state, hearts){
    const player = state?.player;
    if (!player) return;
    const safe = Math.max(0, hearts);
    player.health = safe;
    if (typeof player.hp === 'number') player.hp = Math.max(0, Math.min(player.hpMax ?? safe, safe));
    const halves = Math.max(0, Math.round(safe * 2));
    state.health = halves;
    state.hearts = halves;
    if (typeof state.healthMax !== 'number' && typeof player.hpMax === 'number') {
      state.healthMax = Math.round(player.hpMax * 2);
    }
  }

  function updateHud(state){
    try { W.HUD?.render?.(null, null, state); } catch (_) {}
  }

  function logHeroDamage(amount, source, meta = {}){
    const payload = {
      amount,
      source: meta.source || source || meta.attacker?.kindName || meta.attacker?.kind || 'unknown',
      x: meta.x ?? meta.attacker?.x ?? null,
      y: meta.y ?? meta.attacker?.y ?? null,
    };
    try { W.LogCollision?.('HERO_DAMAGE', payload); } catch (_) {}
    try { W.LOG?.event?.('HIT', { attacker: payload.source, target: 'PLAYER', amount }); } catch (_) {}
  }

  Damage.applyToHero = function(amount, source, meta = {}){
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const state = ensureState(meta.state || W.G);
    const player = state.player;
    if (!player) return false;
    preparePlayerState(state);

    const now = getNow();
    const ignoreInvuln = meta.ignoreInvuln === true;
    if (!ignoreInvuln) {
      if (typeof player.invulnUntil === 'number' && now < player.invulnUntil) return false;
      if (typeof player.invuln === 'number' && player.invuln > 0) return false;
    }

    const { current } = heroHearts(state);
    const newHealth = Math.max(0, current - amount);
    syncHeroHealth(state, newHealth);

    const invuln = (typeof meta.invuln === 'number') ? Math.max(0, meta.invuln) : 1.0;
    player.invulnUntil = now + invuln;
    player.invuln = Math.max(player.invuln || 0, invuln);

    if (meta.knockbackFrom){
      knockback(player, meta.knockbackFrom, meta.knockbackPower);
    }

    try { W.Entities?.Hero?.notifyDamage?.(player, meta); } catch (err) {
      if (W.DEBUG_FORCE_ASCII) console.warn('[Damage] notify hero anim error', err);
    }

    try { W.CineFX?.addScreenShake?.(6, 0.35, { decay: 2.0 }); } catch (_) {}
    try { W.AudioAPI?.play?.('hurt', { volume: 0.9, throttleMs: 120 }); } catch (_) {}

    logHeroDamage(amount, source, meta);
    updateHud(state);

    if (newHealth <= 0){
      player.dead = true;
      state._gameOverReason = meta.reason || source || meta.source || 'health_depleted';
      try { W.Entities?.Hero?.setDeathCause?.(player, meta.source || meta.attacker || null); } catch (_) {}
      try { W.CineFX?.triggerSlowMo?.({ scale: 0.35, duration: 0.9, force: true }); } catch (_) {}
      try { W.AudioAPI?.play?.('hero_dead', { volume: 1.0, throttleMs: 300 }); } catch (_) {}
      try { W.MusicManager?.stop?.({ fadeTime: 1.5 }); } catch (_) {}
      try { W.GameFlowAPI?.notifyHeroDeath?.({ reason: state._gameOverReason }); }
      catch (_) { try { W.GameFlowAPI?.notifyHeroDeath?.(); } catch (_) {} }
    }

    if (typeof meta.onDamage === 'function'){
      try { meta.onDamage(); } catch (_) {}
    }

    return true;
  };

  Damage.applyToEntity = function(entity, amount, source, meta = {}){
    if (!entity || entity.dead || !Number.isFinite(amount) || amount <= 0) return false;
    const state = ensureState(meta.state || W.G);
    const base = (typeof entity.health === 'number')
      ? entity.health
      : (typeof entity.hp === 'number') ? entity.hp : 0;
    const newHp = Math.max(0, base - amount);
    if (typeof entity.health === 'number') entity.health = newHp;
    if (typeof entity.hp === 'number') entity.hp = newHp;
    if (newHp <= 0) entity.dead = true;

    if (meta.knockbackFrom) knockback(entity, meta.knockbackFrom, meta.knockbackPower);

    try {
      W.LOG?.event?.('HIT', {
        attacker: meta.attacker?.id || meta.attacker?.kindName || source || 'UNKNOWN',
        target: entity.id || entity.kindName || 'ENTITY',
        amount,
        source: source || meta.source || meta.attacker?.kindName || meta.attacker?.kind || 'unknown'
      });
    } catch (_) {}

    if (newHp <= 0 && typeof meta.onDeath === 'function') {
      try { meta.onDeath(entity, meta); } catch (_) {}
    }
    return true;
  };

  Damage.update = function(state, dt){
    state = ensureState(state);
    const player = state.player;
    if (!player) return;

    preparePlayerState(state);

    const entities = Array.isArray(state.entities) ? state.entities : [];
    const now = getNow();

    if (W.FireAPI?.update && !W.__FIRE_HOOKED){
      try { W.FireAPI.update(dt); }
      catch (err) {
        if (W.DEBUG_FORCE_ASCII) console.warn('[Fire] update error', err);
      }
    }

    for (const ent of entities){
      if (!ent || ent.dead) continue;
      if (!isHostile(ent)) continue;
      if (!aabb(player, ent)) continue;

      const key = getId(ent);
      const nextHit = cooldownById.get(key) || 0;
      if (now < nextHit) continue;
      const applied = Damage.applyToHero(0.5, ent.kindName || ent.kind || 'enemy', {
        attacker: ent,
        attackerId: ent.id || key,
        source: ent.kindName || ent.kind || 'enemy',
        invuln: 1.0,
        knockbackFrom: ent
      });
      if (!applied) continue;
      cooldownById.set(key, now + 1.0);
    }

    const fires = W.FireAPI?.getActive?.();
    if (Array.isArray(fires) && fires.length){
      for (const fire of fires){
        if (!fire || fire.dead) continue;
        if (ENT?.FIRE_HAZARD && fire.kind === ENT.FIRE_HAZARD) continue;
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
        const applied = Damage.applyToHero(amount, 'fire', {
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

  W.damagePlayer = function(src, amount = 1){
    const inferredSource = (src && typeof src === 'object') ? (src.kindName || src.kind || 'generic') : 'generic';
    const meta = src && typeof src === 'object' ? {
      attacker: src,
      source: inferredSource,
      x: src.x,
      y: src.y,
      knockbackFrom: src
    } : {};
    return Damage.applyToHero(amount, inferredSource, meta);
  };

  W.DamageSystem = Damage;
})();
