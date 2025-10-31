// === skyweather.plugin.js ===
(function(){
  const MODES = ['day', 'fog', 'storm'];
  const SkyWeather = {
    init(canvas){
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.mode = 'day';
      this.t = 0;
      this.lightningT = 0;
    },
    cycleMode(){
      const idx = MODES.indexOf(this.mode);
      this.mode = MODES[(idx+1)%MODES.length];
    },
    update(dt){
      this.t += dt;
      if (this.mode === 'storm'){
        this.lightningT -= dt;
        if (this.lightningT <= 0){
          this.lightningT = 8 + Math.random()*6;
          this.flash();
        }
      }
    },
    flash(){
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
      setTimeout(()=>{
        ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
      }, 80);
    },
    getAmbient(){
      switch(this.mode){
        case 'fog': return { darkness: 0.65, tint: 'rgba(90,120,155,0.35)' };
        case 'storm': return { darkness: 0.75, tint: 'rgba(40,40,60,0.55)' };
        default: return { darkness: 0.35, tint: 'rgba(255,255,240,0.12)' };
      }
    }
  };
  window.SkyWeather = SkyWeather;
})();
