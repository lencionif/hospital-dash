// === rat.entities.js ===
(function(){
  const ENT = (window.ENT ||= {});
  ENT.RAT = 'rat';

  function makeRat(x, y){
    const e = {
      id: `rat_${Math.random().toString(36).slice(2,6)}`,
      kind: ENT.RAT,
      x, y,
      w: 26,
      h: 18,
      dir: 0,
      vx: 0,
      vy: 0,
      solid: true,
      speed: 90,
      health: 1,
      touchDamage: 0.5,
      touchCooldown: 0.9,
      _touchCD: 0,
      aiUpdate(dt, self){
        self.dir += dt*0.8;
        self.vx = Math.cos(self.dir) * self.speed;
        self.vy = Math.sin(self.dir) * self.speed;
      },
      puppet: { rig:'rat', skin:'raton.png', z:3 }
    };
    PuppetAPI.attach(e, e.puppet);
    return e;
  }

  window.RatFactory = { makeRat };
})();
