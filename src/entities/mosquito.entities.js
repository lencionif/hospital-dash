// === mosquito.entities.js ===
(function(){
  const ENT = (window.ENT ||= {});
  ENT.MOSQUITO = 'mosquito';

  function makeMosquito(x, y){
    const e = {
      id: `mos_${Math.random().toString(36).slice(2,6)}`,
      kind: ENT.MOSQUITO,
      x, y,
      w: 20,
      h: 14,
      dir: 0,
      vx: 0,
      vy: 0,
      solid: false,
      speed: 120,
      health: 1,
      touchDamage: 0.5,
      touchCooldown: 0.6,
      _touchCD: 0,
      aiUpdate(dt, self){
        self.dir += (Math.random()-0.5)*1.5;
        self.vx = Math.cos(self.dir)*self.speed;
        self.vy = Math.sin(self.dir)*self.speed;
      },
      puppet: { rig:'mosquito', z:4 }
    };
    PuppetAPI.attach(e, e.puppet);
    return e;
  }

  window.MosquitoFactory = { makeMosquito };
})();
