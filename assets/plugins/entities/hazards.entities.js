(() => {
  'use strict';

  if (!window.Entities || typeof Entities.register !== 'function') {
    window.Entities = window.Entities || {};
    Entities.register = (type, factory) => {
      (Entities._pending = Entities._pending || []).push({ type, factory });
    };
  }

  Entities.register('hazard', ({ state, x, y }) => {
    const entity = {
      type: 'hazard',
      x,
      y,
      vx: 0,
      vy: 0,
      width: 24,
      height: 24,
      solid: false,
      movable: false,
      canPush: false,
      update() {}
    };

    state.entities.push(entity);
    entity.damageSource = true;
    PuppetAPI.attach(entity, {
      rig: 'sprite',
      skin: 'fuego.png',
      scale: 1,
      z: 3
    });
    DamageSystem?.registerSource?.(entity, { amount: 0.5, cooldown: 1.0 });
    return entity;
  });

  Entities.register('boss', ({ state, x, y }) => {
    const entity = {
      type: 'boss',
      x,
      y,
      vx: 0,
      vy: 0,
      width: 28,
      height: 36,
      solid: false,
      movable: false,
      canPush: false,
      update() {}
    };

    state.entities.push(entity);
    const puppet = PuppetAPI.attach(entity, {
      rig: 'sprite',
      skin: 'boss_nivel1.png',
      scale: 1.1,
      z: 4
    });
    entity.puppet = puppet;
    Gameflow?.registerBoss?.(entity);
    return entity;
  });
})();
