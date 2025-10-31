(() => {
  'use strict';

  if (!window.Entities || typeof Entities.register !== 'function') {
    window.Entities = window.Entities || {};
    Entities.register = (type, factory) => {
      (Entities._pending = Entities._pending || []).push({ type, factory });
    };
  }

  const HERO_SPECS = {
    enrique: { speed: 140, push: 1.0, rig: 'biped', skin: 'enrique.png', scale: 1.0 },
    roberto: { speed: 165, push: 0.9, rig: 'biped', skin: 'roberto.png', scale: 1.0 },
    francesco: { speed: 150, push: 1.0, rig: 'biped', skin: 'francesco.png', scale: 1.05 }
  };

  Entities.register('hero', ({ state, x, y }) => {
    const heroKey = (state?.selectedHero || 'enrique').toLowerCase();
    const spec = HERO_SPECS[heroKey] || HERO_SPECS.enrique;

    const entity = {
      type: 'hero',
      kind: heroKey,
      x,
      y,
      vx: 0,
      vy: 0,
      width: 26,
      height: 30,
      dirX: 1,
      dirY: 0,
      speed: spec.speed,
      pushPower: spec.push,
      solid: true,
      movable: false,
      canPush: true,
      health: state.healthMax || 6,
      maxHealth: state.healthMax || 6,
      invulnerableFor: 0,
      carry: null,
      actionCooldown: 0,
      update(dt, world) {
        if (world.state !== 'PLAYING') {
          this.vx = this.vy = 0;
          return;
        }
        const input = world.input;
        const ax = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        const ay = (input.down ? 1 : 0) - (input.up ? 1 : 0);
        const length = Math.hypot(ax, ay) || 1;
        const moveSpeed = this.speed * (this.carry ? 0.92 : 1);
        this.vx = (ax / length) * moveSpeed;
        this.vy = (ay / length) * moveSpeed;
        if (Math.abs(this.vx) > 1 || Math.abs(this.vy) > 1) {
          this.dirX = this.vx;
          this.dirY = this.vy;
        }
        if (this.invulnerableFor > 0) {
          this.invulnerableFor = Math.max(0, this.invulnerableFor - dt);
        }
        this.actionCooldown = Math.max(0, this.actionCooldown - dt);
      },
      interact(target) {
        if (this.actionCooldown > 0) return false;
        if (target && typeof target.onInteract === 'function') {
          const used = target.onInteract(this);
          if (used) {
            this.actionCooldown = 0.2;
            return true;
          }
        }
        return false;
      }
    };

    state.entities.push(entity);
    state.player = entity;
    PhysicsAPI.registerBody(entity, { solid: true, movable: false, canPush: true });
    PuppetAPI.attach(entity, {
      rig: spec.rig,
      skin: spec.skin,
      scale: spec.scale || 1,
      z: 10
    });
    Gameflow?.registerHero?.(entity);
    return entity;
  });
})();
