(() => {
  'use strict';

  if (!window.Entities || typeof Entities.register !== 'function') {
    window.Entities = window.Entities || {};
    Entities.register = (type, factory) => {
      (Entities._pending = Entities._pending || []).push({ type, factory });
    };
  }

  Entities.register('rat', ({ state, x, y }) => {
    const entity = {
      type: 'rat',
      x,
      y,
      vx: 0,
      vy: 0,
      width: 20,
      height: 14,
      solid: true,
      movable: true,
      canPush: false,
      speed: 90,
      dirX: 1,
      dirY: 0,
      wanderTimer: 0,
      update(dt, world) {
        this.wanderTimer -= dt;
        if (this.wanderTimer <= 0) {
          const angle = Math.random() * Math.PI * 2;
          this.vx = Math.cos(angle) * this.speed;
          this.vy = Math.sin(angle) * this.speed;
          this.dirX = Math.sign(this.vx) || this.dirX;
          this.wanderTimer = 2 + Math.random() * 2;
        }
      }
    };

    state.entities.push(entity);
    entity.damageSource = true;
    PhysicsAPI.registerBody(entity, { solid: true, movable: true, canPush: false });
    PuppetAPI.attach(entity, {
      rig: 'rat',
      skin: 'raton.png',
      scale: 1,
      z: 4
    });
    DamageSystem?.registerSource?.(entity, { amount: 0.5, cooldown: 1.0 });
    return entity;
  });
})();
