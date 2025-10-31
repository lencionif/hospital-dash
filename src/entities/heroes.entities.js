// === heroes.entities.js ===
(function(){
  const ENT = (window.ENT ||= {});
  ENT.HERO = 'hero';

  function makeBaseHero(key, stats){
    const e = {
      id: `hero_${key}_${Math.random().toString(36).slice(2,7)}`,
      kind: ENT.HERO,
      heroKey: key,
      x: stats.x || 64,
      y: stats.y || 64,
      w: 26,
      h: 32,
      vx: 0,
      vy: 0,
      speed: stats.speed || 140,
      solid: true,
      friction: 0.10,
      health: stats.health ?? 6,
      dir: 0,
      carry: null,
      aiUpdate: null,
      puppet: stats.puppet
    };
    PuppetAPI.attach(e, e.puppet);
    return e;
  }

  function makeEnrique(){
    return makeBaseHero('enrique', {
      speed: 150,
      puppet: { rig:'biped', z:5, skin:'enrique.png', scale:1.12 }
    });
  }

  function makeRoberto(){
    return makeBaseHero('roberto', {
      speed: 140,
      puppet: { rig:'biped', z:5, skin:'roberto.png', scale:0.96 }
    });
  }

  function makeFrancesco(){
    return makeBaseHero('francesco', {
      speed: 145,
      puppet: { rig:'biped', z:5, skin:'francesco.png', scale:0.98 }
    });
  }

  window.HeroesFactory = { makeEnrique, makeRoberto, makeFrancesco };
})();
