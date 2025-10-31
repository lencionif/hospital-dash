(() => {
  'use strict';

  if (!window.Entities || typeof Entities.register !== 'function') {
    window.Entities = window.Entities || {};
    Entities.register = (type, factory) => {
      (Entities._pending = Entities._pending || []).push({ type, factory });
    };
  }

  Entities.register('mosquito', ({ state, x, y }) => {
    const entity = {
      type: 'mosquito',
      x,
      y,
      vx: 0,
      vy: 0,
      width: 18,
      height: 14,
      solid: true,
      movable: true,
      canPush: false,
      speed: 110,
      dirX: 1,
      dirY: 0,
      hover: 0,
      update(dt, world) {
        this.hover += dt;
        const player = world.player;
        if (player) {
          const dx = player.x - this.x;
          const dy = player.y - this.y;
          const dist = Math.hypot(dx, dy) || 1;
          const chase = this.speed;
          this.vx = (dx / dist) * chase + Math.cos(this.hover * 6) * 20;
          this.vy = (dy / dist) * chase + Math.sin(this.hover * 4) * 15;
          this.dirX = Math.sign(this.vx) || this.dirX;
        }
      }
    };

    state.entities.push(entity);
    entity.damageSource = true;
    PhysicsAPI.registerBody(entity, { solid: true, movable: true, canPush: false });
    PuppetAPI.attach(entity, {
      rig: 'mosquito',
      skin: 'mosquito.png',
      scale: 0.9,
      z: 6
    });
    DamageSystem?.registerSource?.(entity, { amount: 0.5, cooldown: 1.0 });
    return entity;
  });
})();
