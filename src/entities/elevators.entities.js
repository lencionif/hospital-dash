// === elevators.entities.js ===
(function(){
  const ENT = (window.ENT ||= {});
  ENT.ELEVATOR = 'elevator';

  function makeElevator(x, y, opts={}){
    const e = {
      id: `elev_${Math.random().toString(36).slice(2,6)}`,
      kind: ENT.ELEVATOR,
      x, y,
      w: 32,
      h: 48,
      solid: true,
      pairId: opts.pairId || null,
      cooldown: 0,
      aiUpdate(dt){ this.cooldown = Math.max(0, this.cooldown - dt); },
      puppet: { rig:'biped', z:2, skin:'elevator.png', scale:0.85 }
    };
    PuppetAPI.attach(e, e.puppet);
    return e;
  }

  window.ElevatorFactory = { makeElevator };
})();
