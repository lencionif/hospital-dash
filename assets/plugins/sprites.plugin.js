(() => {
  'use strict';

  const cache = new Map();
  const pending = new Map();
  let basePath = './assets/images/';
  let defaultTile = 32;

  function loadImage(name) {
    if (!name) return Promise.reject(new Error('Sprite name required'));
    if (cache.has(name)) return Promise.resolve(cache.get(name));
    if (pending.has(name)) return pending.get(name);

    const src = `${basePath}${name}`;
    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        cache.set(name, img);
        pending.delete(name);
        resolve(img);
      };
      img.onerror = (err) => {
        pending.delete(name);
        reject(new Error(`Failed to load sprite: ${src}`));
      };
      img.src = src;
    });

    pending.set(name, promise);
    return promise;
  }

  function ensureImage(name) {
    if (cache.has(name)) return cache.get(name);
    loadImage(name).catch(() => {});
    return cache.get(name);
  }

  const Sprites = {
    init(options = {}) {
      basePath = options.basePath || basePath;
      defaultTile = options.tile || defaultTile;
    },
    preload(list = []) {
      list.forEach(loadImage);
    },
    load: loadImage,
    get(name) {
      return ensureImage(name);
    },
    IMG(name) {
      return `${basePath}${name}`;
    },
    draw(ctx, name, x, y, options = {}) {
      const img = ensureImage(name);
      if (!img) return;
      const {
        width = img.width,
        height = img.height,
        anchorX = 0.5,
        anchorY = 0.5,
        scale = 1,
        opacity = 1,
        rotation = 0,
        flipX = false,
        flipY = false
      } = options;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.scale(flipX ? -scale : scale, flipY ? -scale : scale);
      ctx.globalAlpha = opacity;
      ctx.drawImage(
        img,
        0,
        0,
        width,
        height,
        -width * anchorX,
        -height * anchorY,
        width,
        height
      );
      ctx.restore();
    },
    tileSize() {
      return defaultTile;
    }
  };

  window.Sprites = Sprites;
  window.IMG = (name) => `${basePath}${name}`;
})();
