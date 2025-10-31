(() => {
  'use strict';

  const ArrowGuide = {
    init(state) {
      this.state = state;
    },
    targetResolver: null,
    setTargetResolver(fn) {
      this.targetResolver = fn;
    },
    update() {},
    draw(ctx, camera) {
      if (!ctx || !camera || !this.state) return;
      const target = this.targetResolver?.(this.state);
      const player = this.state.player;
      if (!target || !player) return;
      const dx = target.x - player.x;
      const dy = target.y - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 32) return;
      const angle = Math.atan2(dy, dx);
      const radius = 120;
      const screenX = camera.w * 0.5 + Math.cos(angle) * radius;
      const screenY = camera.h * 0.5 + Math.sin(angle) * radius;
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.rotate(angle);
      ctx.fillStyle = '#f1c40f';
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-12, -8);
      ctx.lineTo(-4, 0);
      ctx.lineTo(-12, 8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  };

  window.ArrowGuide = ArrowGuide;
})();
