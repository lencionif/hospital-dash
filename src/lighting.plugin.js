// === lighting.plugin.js ===
(function(){
  const LightingAPI = {
    init({ canvas, fogCanvas }){
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.fogCanvas = fogCanvas;
      this.fogCtx = fogCanvas.getContext('2d');
      this.enabled = true;
      this.radius = 160;
      this.softness = 0.65;
      this.flashlight = true;
    },
    setEnabled(v){ this.enabled = !!v; },
    setRadius(r){ this.radius = r; },
    setSoftness(s){ this.softness = s; },
    toggleFlashlight(){ this.flashlight = !this.flashlight; },
    drawFog(camera, player){
      if (!this.enabled){
        this.fogCtx.clearRect(0,0,this.fogCanvas.width,this.fogCanvas.height);
        return;
      }
      const ctx = this.fogCtx;
      ctx.clearRect(0,0,this.fogCanvas.width,this.fogCanvas.height);
      ctx.fillStyle = 'rgba(7,9,11,0.92)';
      ctx.fillRect(0,0,this.fogCanvas.width,this.fogCanvas.height);
      if (!player) return;
      const zoom = camera.zoom || 1;
      const px = (player.x - camera.x)*zoom + this.fogCanvas.width*0.5;
      const py = (player.y - camera.y)*zoom + this.fogCanvas.height*0.5;
      const radius = (this.radius||160) * zoom;
      const gradient = ctx.createRadialGradient(px, py, radius*0.1, px, py, radius);
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(this.softness, 'rgba(0,0,0,0.2)');
      gradient.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI*2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      if (this.flashlight){
        const angle = player.dir || 0;
        const cone = ctx.createRadialGradient(px, py, radius*0.2, px, py, radius*1.25);
        cone.addColorStop(0, 'rgba(0,0,0,0)');
        cone.addColorStop(1, 'rgba(0,0,0,0.8)');
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.moveTo(0,0);
        ctx.lineTo(radius*1.2, radius*0.4);
        ctx.arc(0,0,radius*1.2, Math.atan2(radius*0.4, radius*1.2), -Math.atan2(radius*0.4, radius*1.2), true);
        ctx.closePath();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = cone;
        ctx.fill();
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  };
  window.LightingAPI = LightingAPI;
})();
