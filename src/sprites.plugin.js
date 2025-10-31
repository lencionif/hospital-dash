// === sprites.plugin.js ===
(function(){
  const cache = new Map();
  const pending = new Map();
  let basePath = 'assets/images/';

  const Sprites = {
    init(opts={}){
      basePath = opts.basePath || basePath;
    },
    load(key, file){
      if (cache.has(key)) return cache.get(key);
      const img = new Image();
      img.src = `${basePath}${file}`;
      cache.set(key, img);
      return img;
    },
    ensure(key, file){
      if (cache.has(key)) return cache.get(key);
      const img = new Image();
      img.src = `${basePath}${file}`;
      cache.set(key, img);
      pending.set(img, false);
      img.onload = () => pending.set(img, true);
      return img;
    },
    ready(){
      for (const [img, loaded] of pending.entries()){
        if (!loaded) return false;
      }
      return true;
    },
    draw(ctx, key, x, y, opts={}){
      const img = cache.get(key);
      if (!img || !img.complete){ return false; }
      const w = opts.w || img.width;
      const h = opts.h || img.height;
      ctx.drawImage(img, x - w*0.5, y - h*0.5, w, h);
      return true;
    }
  };

  window.Sprites = Sprites;
})();
