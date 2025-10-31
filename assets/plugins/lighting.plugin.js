(() => {
  'use strict';

  const LightingAPI = {
    init({ containerId = 'game-container' } = {}) {
      const container = document.getElementById(containerId);
      if (!container) return;
      let canvas = container.querySelector('#lightingCanvas');
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'lightingCanvas';
        container.appendChild(canvas);
      }
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.enabled = false;
      this.resize();
      window.addEventListener('resize', () => this.resize());
    },
    resize() {
      if (!this.canvas) return;
      const rect = this.canvas.parentElement.getBoundingClientRect();
      this.canvas.width = rect.width;
      this.canvas.height = rect.height;
    },
    setEnabled(flag) {
      this.enabled = !!flag;
      if (!flag && this.ctx) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    },
    setGlobalAmbient(value) {
      this.ambient = value;
    },
    update(state) {
      if (!this.enabled || !this.ctx) return;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.85, Math.max(0, 1 - (this.ambient || 0.3)))})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      if (state?.player) {
        const radius = 150;
        const gradient = ctx.createRadialGradient(
          this.canvas.width * 0.5,
          this.canvas.height * 0.5,
          radius * 0.3,
          this.canvas.width * 0.5,
          this.canvas.height * 0.5,
          radius
        );
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(this.canvas.width * 0.5, this.canvas.height * 0.5, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  };

  window.LightingAPI = LightingAPI;
})();
