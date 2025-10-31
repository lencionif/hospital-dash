(() => {
  'use strict';

  const AudioAPI = {
    init({ urls = {} } = {}) {
      this.cache = new Map();
      Object.entries(urls).forEach(([key, url]) => this.load(key, url));
    },
    load(key, url) {
      if (!key || !url) return null;
      const audio = new Audio(url);
      audio.preload = 'auto';
      this.cache.set(key, audio);
      return audio;
    },
    play(key, { loop = false, volume = 1 } = {}) {
      const base = this.cache.get(key);
      if (!base) return;
      const instance = base.cloneNode();
      instance.volume = volume;
      instance.loop = loop;
      instance.play().catch(() => {});
      return instance;
    },
    stop(instance) {
      if (!instance) return;
      instance.pause();
      instance.currentTime = 0;
    }
  };

  window.AudioAPI = AudioAPI;
})();
