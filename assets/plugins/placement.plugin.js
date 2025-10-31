(() => {
  'use strict';

  const defaultDebug = {
    HERO: true,
    PATIENT: true,
    RAT: true,
    MOSQUITO: true,
    CART: true,
    DOOR: true,
    ELEVATOR: true,
    HAZARD: true,
    BOSS: true,
    PILL: true
  };

  const Placement = {
    init(state) {
      this.state = state;
      window.SPAWN_DEBUG = Object.assign({}, defaultDebug, window.SPAWN_DEBUG || {});
    },
    spawnFromMap(map) {
      if (!map || !this.state) return;
      const st = this.state;
      const debug = window.SPAWN_DEBUG;

      if (debug.HERO && map.spawns.hero) {
        Entities.create('hero', { state: st, x: map.spawns.hero.x, y: map.spawns.hero.y });
      }

      if (debug.PILL) {
        map.spawns.pills.forEach((pos) => {
          Entities.create('pill', { state: st, x: pos.x, y: pos.y, pillType: 'analitica' });
        });
      }

      if (debug.PATIENT) {
        map.spawns.patients.forEach((pos, index) => {
          Entities.create('patient', {
            state: st,
            x: pos.x,
            y: pos.y,
            requiredPill: index % 2 === 0 ? 'analitica' : 'zenidina'
          });
        });
      }

      if (debug.CART) {
        map.spawns.carts.forEach((pos, index) => {
          Entities.create('cart', {
            state: st,
            x: pos.x,
            y: pos.y,
            cartType: index === 0 ? 'emergency' : 'supply'
          });
        });
      }

      if (debug.RAT) {
        map.spawns.rats.forEach((pos) => {
          Entities.create('rat', { state: st, x: pos.x, y: pos.y });
        });
      }

      if (debug.MOSQUITO) {
        map.spawns.mosquitoes.forEach((pos) => {
          Entities.create('mosquito', { state: st, x: pos.x, y: pos.y });
        });
      }

      if (debug.DOOR) {
        map.spawns.doors.forEach((pos) => {
          Entities.create('door', { state: st, x: pos.x, y: pos.y, doorType: 'boss' });
        });
      }

      if (debug.ELEVATOR) {
        map.spawns.elevators.forEach((pos) => {
          Entities.create('elevator', { state: st, x: pos.x, y: pos.y });
        });
      }

      if (debug.HAZARD) {
        map.spawns.hazards.forEach((pos) => {
          Entities.create('hazard', { state: st, x: pos.x, y: pos.y });
        });
      }

      if (debug.BOSS && map.spawns.boss) {
        Entities.create('boss', { state: st, x: map.spawns.boss.x, y: map.spawns.boss.y });
      }
    }
  };

  window.Placement = Placement;
})();
