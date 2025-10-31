(() => {
  'use strict';

  if (!window.Entities || typeof Entities.register !== 'function') {
    window.Entities = window.Entities || {};
    Entities.register = (type, factory) => {
      (Entities._pending = Entities._pending || []).push({ type, factory });
    };
  }

  Entities.register('elevator', ({ state, x, y }) => {
    const entity = {
      type: 'elevator',
      x,
      y,
      vx: 0,
      vy: 0,
      width: 30,
      height: 30,
      solid: false,
      movable: false,
      canPush: false,
      opened: false,
      update() {}
    };

    state.entities.push(entity);
    PuppetAPI.attach(entity, {
      rig: 'sprite',
      skin: 'ascensor_cerrado.png',
      scale: 1,
      z: 1
    });
    Gameflow?.registerElevator?.(entity);
    return entity;
  });
})();
