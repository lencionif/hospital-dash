// === doors.entities.js ===
(function(){
  const ENT = (window.ENT ||= {});
  ENT.DOOR = 'door';

  function makeDoor(x, y, opts={}){
    const e = {
      id: `door_${Math.random().toString(36).slice(2,6)}`,
      kind: ENT.DOOR,
      x, y,
      w: opts.w || 32,
      h: opts.h || 48,
      solid: true,
      open: false,
      aiUpdate(dt){},
      puppet: { rig:'biped', z:2, skin:'door.png', scale:0.8 }
    };
    PuppetAPI.attach(e, e.puppet);
    return e;
  }

  window.DoorFactory = { makeDoor };
})();
