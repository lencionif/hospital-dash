(() => {
  'use strict';

  const ScoreAPI = {
    init(state) {
      this.state = state;
      this.total = 0;
      this.breakdown = [];
    },
    add(points, label = 'Acción') {
      this.total += points;
      this.breakdown.push({ label, points });
      this.state.events.push({ type: 'score', points, label });
    },
    reset() {
      this.total = 0;
      this.breakdown = [];
    },
    getTotals() {
      return {
        total: this.total,
        breakdown: this.breakdown.slice()
      };
    }
  };

  window.ScoreAPI = ScoreAPI;
})();
