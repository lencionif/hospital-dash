(function(){
  const INVULN = 1.0; // i-frames jugador en s
  window.aabbOverlap = window.aabbOverlap || function(a,b){
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  };
  const DamageAPI = {
    update(dt, player){ if(player) player._hurtCD = Math.max(0, (player._hurtCD||0) - dt); },
    tickAttackers(dt, list){ for(const e of (list||[])) e._touchCD = Math.max(0, (e._touchCD||0) - dt); },
    applyTouch(attacker, player){
      if(!attacker||!player) return;
      if((attacker._touchCD||0)>0) return;
      if((player._hurtCD||0)>0) return;
      const dmg = attacker.touchDamage ?? 0.5;
      const halves = Math.max(1, Math.round(dmg * 2));
      if (typeof window.damagePlayer === 'function') {
        window.damagePlayer(attacker, halves);
      } else {
        const G = window.G || {};
        player.health = Math.max(0, (player.health ?? halves) - halves);
        if (typeof G.health === 'number') {
          G.health = Math.max(0, G.health - halves);
        }
      }
      player._hurtCD = INVULN;
      attacker._touchCD = attacker.touchCooldown ?? INVULN;
    }
  };
  window.DamageAPI = DamageAPI;
})();
