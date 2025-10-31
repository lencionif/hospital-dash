(() => {
  'use strict';

  if (!window.Entities || typeof Entities.register !== 'function') {
    window.Entities = window.Entities || {};
    Entities.register = (type, factory) => {
      (Entities._pending = Entities._pending || []).push({ type, factory });
    };
  }

  const PILL_SKINS = {
    analitica: 'pastilla_analitica.png',
    zenidina: 'pastilla_zenidina.png',
    gaviscon: 'pastilla_gaviscon.png'
  };

  Entities.register('pill', ({ state, x, y, pillType = 'analitica' }) => {
    const entity = {
      type: 'pill',
      pillType,
      x,
      y,
      vx: 0,
      vy: 0,
      width: 18,
      height: 18,
      solid: false,
      movable: false,
      canPush: false,
      onInteract(hero) {
        if (hero.carry) return false;
        hero.carry = { type: this.pillType };
        state.messages.push(`Recogida pastilla ${this.pillType}`);
        this.remove = true;
        Gameflow?.onPillPicked?.(hero, this);
        return true;
      },
      update() {}
    };

    state.entities.push(entity);
    PuppetAPI.attach(entity, {
      rig: 'sprite',
      skin: PILL_SKINS[pillType] || 'pastilla_analitica.png',
      scale: 0.9,
      z: 2
    });
    return entity;
  });

  Entities.register('patient', ({ state, x, y, requiredPill = 'analitica' }) => {
    const skins = ['paciente1.png', 'paciente2.png', 'paciente3.png', 'paciente4.png'];
    const skin = skins[Math.floor(Math.random() * skins.length)];
    const entity = {
      type: 'patient',
      x,
      y,
      vx: 0,
      vy: 0,
      width: 24,
      height: 28,
      solid: true,
      movable: false,
      canPush: false,
      requiredPill,
      healed: false,
      onInteract(hero) {
        if (this.healed) return false;
        if (!hero.carry) {
          state.messages.push('Necesitas una pastilla');
          return false;
        }
        if (hero.carry.type !== this.requiredPill) {
          state.messages.push('Pastilla incorrecta');
          return false;
        }
        hero.carry = null;
        this.healed = true;
        this.remove = true;
        Gameflow?.patientHealed?.(this);
        state.messages.push('Paciente atendido');
        return true;
      },
      update() {}
    };

    state.entities.push(entity);
    PhysicsAPI.registerBody(entity, { solid: true, movable: false, canPush: false });
    PuppetAPI.attach(entity, {
      rig: 'sprite',
      skin,
      scale: 1,
      z: 5
    });
    Gameflow?.registerPatient?.(entity);
    return entity;
  });
})();
