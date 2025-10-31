// === hazards.entities.js ===
(function(){
  const ENT = (window.ENT ||= {});
  ENT.HAZARD = 'hazard';

  function makeFire(x, y){
    const e = {
      id: `hazard_${Math.random().toString(36).slice(2,6)}`,
      kind: ENT.HAZARD,
      x, y,
      w: 24,
      h: 24,
      solid: false,
      touchDamage: 0.5,
      touchCooldown: 0.8,
      aiUpdate(dt, self){ self.t = (self.t||0) + dt; },
      puppet: { rig:'biped', z:2, skin:'fire.png', scale:0.7 }
    };
    PuppetAPI.attach(e, e.puppet);
    return e;
  }

  window.HazardFactory = { makeFire };
})();
