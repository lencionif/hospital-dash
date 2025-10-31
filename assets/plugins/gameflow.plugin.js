(() => {
  'use strict';

  const Gameflow = {
    init(state) {
      this.state = state;
      this.hero = null;
      this.boss = null;
      this.emergencyDoor = null;
      this.emergencyCart = null;
      this.patients = new Set();
      this.doors = new Set();
      this.carts = new Set();
      this.elevators = new Set();
      state.tasks = { totalPatients: 0, healed: 0 };
      ArrowGuide?.init?.(state);
      ArrowGuide?.setTargetResolver?.(() => this.getTarget());
    },
    registerHero(hero) {
      this.hero = hero;
    },
    registerPatient(patient) {
      this.patients.add(patient);
      if (this.state?.tasks) {
        const current = this.state.tasks.totalPatients || 0;
        this.state.tasks.totalPatients = Math.max(current, this.patients.size);
      }
    },
    registerDoor(door) {
      this.doors.add(door);
      if (door.doorType === 'boss') {
        this.emergencyDoor = door;
      }
    },
    registerCart(cart) {
      this.carts.add(cart);
      if (!this.emergencyCart && cart.cartType === 'emergency') {
        this.emergencyCart = cart;
      }
    },
    registerElevator(elevator) {
      this.elevators.add(elevator);
    },
    registerBoss(boss) {
      this.boss = boss;
    },
    onPillPicked(hero, pill) {
      ScoreAPI?.add?.(10, 'Píldora recogida');
    },
    patientHealed(patient) {
      if (this.patients.delete(patient)) {
        if (this.state?.tasks) {
          this.state.tasks.healed = (this.state.tasks.healed || 0) + 1;
        }
        ScoreAPI?.add?.(100, 'Paciente atendido');
      }
      if (this.patients.size === 0) {
        this.openDoors();
      }
    },
    openDoors() {
      this.doors.forEach((door) => door.open());
    },
    getTarget() {
      if (this.patients.size > 0) {
        return this.patients.values().next().value;
      }
      if (this.emergencyDoor && !this.emergencyDoor.isOpen) {
        return this.emergencyDoor;
      }
      return this.boss || null;
    },
    update(dt) {
      if (this.patients.size === 0 && this.emergencyDoor) {
        this.emergencyDoor.open();
      }
      if (this.state.win || this.state.state !== 'PLAYING') return;
      if (this.emergencyDoor?.isOpen && this.emergencyCart && this.boss) {
        const dist = Math.hypot(this.emergencyCart.x - this.boss.x, this.emergencyCart.y - this.boss.y);
        if (dist < 48) {
          this.triggerWin();
        }
      }
    },
    triggerWin() {
      if (this.state.win) return;
      this.state.win = true;
      this.state.state = 'COMPLETE';
      this.state.events.push({ type: 'win' });
    }
  };

  window.Gameflow = Gameflow;
})();
