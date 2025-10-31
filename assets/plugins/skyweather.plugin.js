(() => {
  'use strict';

  const SkyWeather = {
    init() {
      this.time = 0;
    },
    update(dt) {
      this.time += dt;
    },
    getAmbientTint() {
      const alpha = 0.1 + 0.05 * Math.sin(this.time * 0.25);
      return `rgba(66, 135, 245, ${alpha.toFixed(3)})`;
    }
  };

  window.SkyWeather = SkyWeather;
})();
