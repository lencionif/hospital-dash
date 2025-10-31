// === arrowguide.plugin.js ===
(function(){
  const ArrowGuide = {
    init(canvas){
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.target = null;
      this.active = true;
    },
    setTarget(entity){ this.target = entity || null; },
    setActive(v){ this.active = !!v; },
    draw(camera, player){
      if (!this.active || !player || !this.target) return;
      const ctx = this.ctx;
      const zoom = camera.zoom || 1;
      const px = (player.x - camera.x)*zoom + this.canvas.width*0.5;
      const py = (player.y - camera.y)*zoom + this.canvas.height*0.5;
      const tx = (this.target.x - camera.x)*zoom + this.canvas.width*0.5;
      const ty = (this.target.y - camera.y)*zoom + this.canvas.height*0.5;
      const angle = Math.atan2(ty - py, tx - px);
      const dist = Math.hypot(tx - px, ty - py);
      const clampDist = Math.min(dist, 180);
      const fx = px + Math.cos(angle) * clampDist;
      const fy = py + Math.sin(angle) * clampDist;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 180, 60, 0.9)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      ctx.translate(fx, fy);
      ctx.rotate(angle);
      ctx.fillStyle = 'rgba(255, 140, 0, 0.95)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-18, 10);
      ctx.lineTo(-18, -10);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  };
  window.ArrowGuide = ArrowGuide;
})();
