// === damage.api.js ===
(function(){
  const INVULN = 1.0;
  const DamageAPI = {
    update(dt, player){
      if (!player) return;
      player._hurtCD = Math.max(0, (player._hurtCD||0) - dt);
    },
    tickAttackers(dt, list){
      for (const e of (list||[])){
        e._touchCD = Math.max(0, (e._touchCD||0) - dt);
      }
    },
    applyTouch(attacker, player){
      if (!attacker || !player) return;
      if ((attacker._touchCD||0) > 0) return;
      if ((player._hurtCD||0) > 0) return;
      const dmg = attacker.touchDamage ?? 0.5;
      player.health = Math.max(0, player.health - dmg);
      player._hurtCD = INVULN;
      attacker._touchCD = attacker.touchCooldown ?? INVULN;
    }
  };
  window.DamageAPI = DamageAPI;
})();
