// === carts.entities.js ===
(function(){
  const ENT = (window.ENT ||= {});
  ENT.CART = 'cart';

  function makeCart(x, y){
    const e = {
      id: `cart_${Math.random().toString(36).slice(2,6)}`,
      kind: ENT.CART,
      x, y,
      w: 32,
      h: 32,
      vx: 0,
      vy: 0,
      solid: true,
      pushable: true,
      friction: 0.08,
      aiUpdate(dt, self){
        if (!self.pushTimer || self.pushTimer<=0){
          self.pushTimer = 2 + Math.random()*4;
          self.vx = (Math.random()>0.5?1:-1)*30;
          self.vy = (Math.random()>0.5?1:-1)*30;
        }
        self.pushTimer -= dt;
      },
      puppet: { rig:'biped', z:2, skin:'cart.png', scale:0.9 }
    };
    PuppetAPI.attach(e, e.puppet);
    return e;
  }

  window.CartsFactory = { makeCart };
})();
