(() => {
  'use strict';

  if (!window.Entities || typeof Entities.register !== 'function') {
    window.Entities = window.Entities || {};
    Entities.register = (type, factory) => {
      (Entities._pending = Entities._pending || []).push({ type, factory });
    };
  }

  Entities.register('door', ({ state, x, y, doorType = 'generic' }) => {
    const entity = {
      type: 'door',
      doorType,
      x,
      y,
      vx: 0,
      vy: 0,
      width: 28,
      height: 32,
      solid: true,
      movable: false,
      canPush: false,
      isOpen: false,
      open() {
        if (this.isOpen) return;
        this.isOpen = true;
        this.solid = false;
        PhysicsAPI.setSolid?.(this, false);
        this.puppet.config.skin = 'puerta_abiertas.png';
      },
      close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.solid = true;
        PhysicsAPI.setSolid?.(this, true);
        this.puppet.config.skin = 'puerta_cerrada.png';
      },
      update() {}
    };

    state.entities.push(entity);
    PhysicsAPI.registerBody(entity, { solid: true, movable: false, canPush: false });
    const puppet = PuppetAPI.attach(entity, {
      rig: 'sprite',
      skin: 'puerta_cerrada.png',
      scale: 1,
      z: 3
    });
    entity.puppet = puppet;
    Gameflow?.registerDoor?.(entity);
    return entity;
  });
})();
