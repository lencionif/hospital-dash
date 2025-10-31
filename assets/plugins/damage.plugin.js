(() => {
  'use strict';

  const INVULNERABILITY = 1.0;

  function aabb(entity) {
    const w = entity.width || 24;
    const h = entity.height || 24;
    return {
      minX: entity.x - w * 0.5,
      maxX: entity.x + w * 0.5,
      minY: entity.y - h * 0.5,
      maxY: entity.y + h * 0.5
    };
  }

  function overlaps(a, b) {
    return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
  }

  const DamageSystem = {
    init(state) {
      this.state = state;
      this.sources = new Set();
      this.cooldowns = new WeakMap();
      this.playerIFrames = 0;
    },
    registerSource(entity, options = {}) {
      const opts = {
        amount: options.amount ?? 0.5,
        cooldown: options.cooldown ?? 1.0
      };
      this.sources.add(entity);
      this.cooldowns.set(entity, { timer: 0, options: opts });
    },
    unregisterSource(entity) {
      this.sources.delete(entity);
      this.cooldowns.delete(entity);
    },
    update(dt) {
      const player = this.state.player;
      if (!player) return;
      this.playerIFrames = Math.max(0, this.playerIFrames - dt);
      const playerBox = aabb(player);
      this.sources.forEach((entity) => {
        if (entity.remove) return;
        const cooldown = this.cooldowns.get(entity);
        if (!cooldown) return;
        cooldown.timer = Math.max(0, cooldown.timer - dt);
        const targetBox = aabb(entity);
        if (!overlaps(playerBox, targetBox)) {
          return;
        }
        if (this.playerIFrames > 0) {
          return;
        }
        if (cooldown.timer > 0) {
          return;
        }
        this.applyDamage(player, cooldown.options.amount);
        cooldown.timer = cooldown.options.cooldown;
        this.playerIFrames = INVULNERABILITY;
      });
    },
    applyDamage(player, amount) {
      player.health = Math.max(0, player.health - amount);
      this.state.events.push({ type: 'damage', amount });
      if (player.health <= 0 && this.state.state === 'PLAYING') {
        this.state.state = 'GAMEOVER';
      }
    }
  };

  window.DamageSystem = DamageSystem;
})();
