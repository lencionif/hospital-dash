(() => {
  'use strict';

  if (!window.Entities || typeof Entities.register !== 'function') {
    window.Entities = window.Entities || {};
    Entities.register = (type, factory) => {
      (Entities._pending = Entities._pending || []).push({ type, factory });
    };
  }

  const CART_SKINS = {
    emergency: 'carro_urgencias.png',
    supply: 'carro_medicinas.png',
    food: 'carro_comida.png'
  };

  Entities.register('cart', ({ state, x, y, cartType = 'supply' }) => {
    const entity = {
      type: 'cart',
      cartType,
      x,
      y,
      vx: 0,
      vy: 0,
      width: 26,
      height: 26,
      solid: true,
      movable: true,
      canPush: false,
      inertia: 0.82,
      update(dt) {
        this.vx *= this.inertia;
        this.vy *= this.inertia;
      }
    };

    state.entities.push(entity);
    PhysicsAPI.registerBody(entity, { solid: true, movable: true, canPush: false, weight: 1 });
    const puppet = PuppetAPI.attach(entity, {
      rig: 'sprite',
      skin: CART_SKINS[cartType] || CART_SKINS.supply,
      scale: 1,
      z: 2
    });
    entity.puppet = puppet;
    Gameflow?.registerCart?.(entity);
    return entity;
  });
})();
