// === physics.plugin.js ===
(function(){
  const PhysicsAPI = {
    init(opts={}){
      this.tileSize = opts.tileSize || 32;
      this.solidTiles = opts.solidTiles || (()=>false);
    },
    update(dt, entities, world){
      if (!entities) return;
      for (const e of entities){
        if (!e || e.static || e.dead) continue;
        if (typeof e.vx !== 'number' || typeof e.vy !== 'number') continue;
        e.x += e.vx * dt;
        this.resolveTileCollisions(e);
        e.y += e.vy * dt;
        this.resolveTileCollisions(e);
        if (e.solid) this.resolveEntityCollisions(e, entities);
        if (e.friction){
          e.vx *= Math.pow(1 - e.friction, dt*60);
          e.vy *= Math.pow(1 - e.friction, dt*60);
        }
      }
    },
    resolveTileCollisions(e){
      const tile = this.tileSize;
      const hw = e.w*0.5;
      const hh = e.h*0.5;
      const left = Math.floor((e.x - hw)/tile);
      const right = Math.floor((e.x + hw)/tile);
      const top = Math.floor((e.y - hh)/tile);
      const bottom = Math.floor((e.y + hh)/tile);
      for (let ty=top; ty<=bottom; ty++){
        for (let tx=left; tx<=right; tx++){
          if (!this.solidTiles(tx, ty)) continue;
          const cellX = tx*tile + tile*0.5;
          const cellY = ty*tile + tile*0.5;
          const dx = e.x - cellX;
          const dy = e.y - cellY;
          const overlapX = (tile*0.5 + hw) - Math.abs(dx);
          const overlapY = (tile*0.5 + hh) - Math.abs(dy);
          if (overlapX <= 0 || overlapY <= 0) continue;
          if (overlapX < overlapY){
            e.x += Math.sign(dx) * overlapX;
            e.vx = 0;
          } else {
            e.y += Math.sign(dy) * overlapY;
            e.vy = 0;
          }
        }
      }
    },
    resolveEntityCollisions(subject, entities){
      for (const other of entities){
        if (!other || other === subject || other.dead) continue;
        if (!other.solid) continue;
        if (!aabbOverlap(subject, other)) continue;
        const dx = subject.x - other.x;
        const dy = subject.y - other.y;
        const overlapX = (subject.w + other.w)*0.5 - Math.abs(dx);
        const overlapY = (subject.h + other.h)*0.5 - Math.abs(dy);
        if (overlapX < overlapY){
          subject.x += Math.sign(dx) * overlapX;
          subject.vx = 0;
        } else {
          subject.y += Math.sign(dy) * overlapY;
          subject.vy = 0;
        }
      }
    }
  };

  function aabbOverlap(a,b){
    return Math.abs(a.x-b.x) < (a.w+b.w)*0.5 && Math.abs(a.y-b.y) < (a.h+b.h)*0.5;
  }

  window.PhysicsAPI = PhysicsAPI;
})();
