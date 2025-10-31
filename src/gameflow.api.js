// === gameflow.api.js ===
(function(){
  const GameFlow = {
    init(){
      this.state = 'MENU';
      this.onAllPatientsHealed = null;
      this.targetPatients = 0;
      this.curedPatients = 0;
    },
    startRun(totalPatients){
      this.state = 'PLAYING';
      this.targetPatients = totalPatients;
      this.curedPatients = 0;
    },
    markPatientHealed(){
      this.curedPatients++;
      if (this.curedPatients >= this.targetPatients && typeof this.onAllPatientsHealed === 'function'){
        this.onAllPatientsHealed();
      }
    },
    setState(state){ this.state = state; },
    isPlaying(){ return this.state === 'PLAYING'; }
  };
  window.GameFlow = GameFlow;
})();
