// assets/plugins/damage.plugin.js
// Sistema de daño por contacto con i-frames y cooldown por atacante.
(function(global){
  'use strict';

  const DEFAULT_PLAYER_INVULN = 1.0; // segundos
  const DEFAULT_TOUCH_COOLDOWN = 1.0; // segundos

  function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

  function overlap(a, b){
    if (!a || !b) return false;
    const ax = a.x || 0, ay = a.y || 0;
    const aw = a.w || 0, ah = a.h || 0;
    const bx = b.x || 0, by = b.y || 0;
    const bw = b.w || 0, bh = b.h || 0;
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function resolvePlayer(){
    const G = global.G;
    if (G && G.player) return G.player;
    return null;
  }

  function ensurePlayerInvulnTimer(player){
    if (!player) return;
    const t = Number(player._touchInvuln) || 0;
    if (t < 0) player._touchInvuln = 0;
  }

  function applyDamageToPlayer(player, halves, meta){
    if (!player) return false;
    const G = global.G || (global.G = {});
    const amount = Math.max(0, Math.round(halves));
    if (!amount) return false;

    const source = meta?.attacker || meta?.source || null;
    const invuln = meta?.invuln ?? DEFAULT_PLAYER_INVULN;

    // Registra timers
    player._touchInvuln = invuln;
    if (typeof player.invuln === 'number') {
      player.invuln = Math.max(player.invuln || 0, invuln);
    } else {
      player.invuln = invuln;
    }

    // Ruta oficial: delegar en damagePlayer si existe
    if (typeof global.damagePlayer === 'function') {
      global.damagePlayer(source, amount, { ...meta, invuln });
      return true;
    }

    // Fallback directo contra G.health / hp
    const maxHalves = Math.max(0, Math.round((player.hpMax || player.hp || 3) * 2));
    const before = Number.isFinite(G.health) ? G.health : Math.round((player.hp || 3) * 2);
    const after = clamp(before - amount, 0, maxHalves || before);
    G.health = after;
    player.hp = Math.ceil(after / 2);
    if (after <= 0) {
      player.dead = true;
      if (typeof player.onDestroy === 'function') {
        try { player.onDestroy(); } catch(_){}
      }
    }
    return true;
  }

  function applyTouch(attacker, player){
    const target = player || resolvePlayer();
    if (!attacker || !target || target.dead) return false;

    if (!overlap(attacker, target)) {
      attacker._touching = false;
      return false;
    }

    attacker._touching = true;

    const cooldown = attacker.touchCooldown != null ? Number(attacker.touchCooldown) : DEFAULT_TOUCH_COOLDOWN;
    const timer = Math.max(0, Number(attacker._touchCooldownTimer) || 0);
    attacker._touchCooldownTimer = Math.max(0, timer);

    if (timer > 0) return false;

    ensurePlayerInvulnTimer(target);
    if ((target._touchInvuln || 0) > 0) return false;

    const halves = attacker.touchHalves != null
      ? Math.max(0, Number(attacker.touchHalves))
      : Math.max(1, Math.round(((attacker.touchDamage != null ? Number(attacker.touchDamage) : 0.5) || 0.5) * 2));

    const invuln = attacker.touchInvuln != null ? Number(attacker.touchInvuln) : DEFAULT_PLAYER_INVULN;

    const applied = applyDamageToPlayer(target, halves, { attacker, source: attacker, invuln, tag: 'touch', bypassInvuln: true });
    if (applied) {
      attacker._touchCooldownTimer = Math.max(cooldown, 0);
    }
    return applied;
  }

  function tickAttackers(dt, attackers, player){
    const list = Array.isArray(attackers) ? attackers : (Array.from(attackers || []));
    const target = player || resolvePlayer();
    if (!target) return;

    for (const a of list) {
      if (!a || a.dead) continue;
      if (a.touchDamage == null && a.touchHalves == null) {
        continue;
      }
      if (typeof a._touchCooldownTimer === 'number') {
        a._touchCooldownTimer = Math.max(0, a._touchCooldownTimer - dt);
      } else {
        a._touchCooldownTimer = 0;
      }
      applyTouch(a, target);
    }
  }

  function update(dt, player){
    const target = player || resolvePlayer();
    if (!target) return;
    target._touchInvuln = Math.max(0, (target._touchInvuln || 0) - dt);
  }

  const DamageAPI = {
    update,
    tickAttackers,
    applyTouch,
    applyDamage: applyDamageToPlayer,
  };

  global.DamageAPI = DamageAPI;
})(window);
