// === patients.entities.js ===
(function(){
  const ENT = (window.ENT ||= {});
  ENT.PATIENT = 'patient';

  function makePatient(x, y, sequence){
    const e = {
      id: `patient_${Math.random().toString(36).slice(2,7)}`,
      kind: ENT.PATIENT,
      x, y,
      w: 28,
      h: 28,
      vx: 0,
      vy: 0,
      solid: true,
      sequence: sequence || ['pill', 'iv'],
      progress: 0,
      satisfied: false,
      aiUpdate(dt){
        if (this.satisfied) return;
        this.animT = (this.animT||0) + dt;
      },
      puppet: { rig:'biped', z:3, skin:'patient.png', scale:0.9 }
    };
    PuppetAPI.attach(e, e.puppet);
    return e;
  }

  window.PatientsFactory = { makePatient };
})();
