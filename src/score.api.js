// === score.api.js ===
(function(){
  const ScoreAPI = {
    init(){ this.reset(); },
    reset(){
      this.score = 0;
      this.deliveries = 0;
      this.alarms = 0;
    },
    addPoints(p){ this.score += p|0; },
    recordDelivery(){ this.deliveries++; this.addPoints(150); },
    ringAlarm(){ this.alarms++; },
  };
  window.ScoreAPI = ScoreAPI;
})();
