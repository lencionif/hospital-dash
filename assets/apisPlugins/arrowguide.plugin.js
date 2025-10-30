// filename: arrowguide.plugin.js
// Flecha direccional tipo GTA alrededor del protagonista.
// - Apunta al paciente correcto si llevas su pastilla.
// - Cuando no quedan pacientes, apunta al Boss.
// - Se dibuja sobre el mundo y bajo el HUD (llámala justo antes de drawHUD()).

(function () {
  const ArrowGuide = {
    enabled: true,
    _getter: null,       // función externa opcional que devuelve {x,y,type:'patient'|'boss'}
    _pulse: 0,

    setEnabled(v){ this.enabled = !!v; },
    setTargetGetter(fn){ this._getter = (typeof fn === 'function') ? fn : null; },

    // Fallback auto: usa PatientsAPI/G.carry/G.boss si no se pasó un getter
    _computeDefault(){
      const G = window.G || {};
      if (!G.player) return null;

      const patientsDone =
        (window.PatientsAPI && typeof PatientsAPI.isAllDelivered === 'function')
          ? !!PatientsAPI.isAllDelivered()
          : (Array.isArray(G.patients) ? G.patients.length === 0 : false);

      // 1) Si llevas algo que identifique paciente, apúntale
      if (G.carry && !patientsDone) {
        // Preferente: API de pacientes
        if (window.PatientsAPI && typeof PatientsAPI.getPatients === 'function') {
          const list = PatientsAPI.getPatients().filter(p => !p.attended);
          const byId  = G.carry.forPatientId ? list.find(p => p.id === G.carry.forPatientId) : null;
          const byKey = G.carry.pillKey      ? list.find(p => p.requiredPillKey === G.carry.pillKey) : null;
          const byNm  = G.carry.patientName  ? list.find(p => p.name === G.carry.patientName) : null;
          const m = byId || byKey || byNm;
          if (m) return { x: m.x + m.w*0.5, y: m.y + m.h*0.5, type: 'patient' };
        }
        // Fallback ASCII (G.patients + patientName)
        if (Array.isArray(G.patients) && G.carry.patientName) {
          const m = G.patients.find(p => p.name === G.carry.patientName);
          if (m) return { x: m.x + m.w*0.5, y: m.y + m.h*0.5, type: 'patient' };
        }
      }

      // 1.5) Si NO llevas pastilla todavía, apunta al paciente más cercano
      if (!patientsDone && Array.isArray(G.patients) && G.patients.length) {
        const px = G.player.x + G.player.w*0.5, py = G.player.y + G.player.h*0.5;
        let best = null, bestD = 1e9;
        for (const m of G.patients) {
          if (!m || m.dead) continue;
          const cx = m.x + m.w*0.5, cy = m.y + m.h*0.5;
          const dx = cx - px, dy = cy - py;
          const d2 = dx*dx + dy*dy;
          if (d2 < bestD) { bestD = d2; best = { x: cx, y: cy, type: 'patient' }; }
        }
        if (best) return best;
      }

      // 2) Si ya no quedan pacientes → Boss
      if (patientsDone && G.boss) {
        return { x: G.boss.x + G.boss.w*0.5, y: G.boss.y + G.boss.h*0.5, type: 'boss' };
      }
      return null;
    },

    update(dt){
      this._pulse += (dt||0);
    },

    draw(ctx, camera, Gref){
      if (!this.enabled) return;
      const G = Gref || window.G || {};
      const p = G.player;
      if (!ctx || !p) return;

      const t = this._getter ? this._getter() : this._computeDefault();

      // Si NO hay objetivo, no dibujamos nada (y el HUD mostrará “Objetivo: ninguno”)
      if (!t) { return; }

      const w = ctx.canvas.width,  h = ctx.canvas.height;
      const cam = camera || { x:0, y:0, zoom:1 };
      const z = cam.zoom || 1;

      const px = (p.x + p.w*0.5 - cam.x) * z + w*0.5;
      const py = (p.y + p.h*0.5 - cam.y) * z + h*0.5;
      const tx = (t.x           - cam.x) * z + w*0.5;
      const ty = (t.y           - cam.y) * z + h*0.5;

      const ang = Math.atan2(ty - py, tx - px);

      // Ring + punta
      const rOuter = 40, rInner = 24;
      const col = (t.type === 'boss') ? '#ff5d5d' : '#2f81f7';

      ctx.save();
      ctx.translate(px, py);

      // (sin anillo alrededor del jugador)

      // punta
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(rInner, 0);
      ctx.lineTo(rOuter, -8);
      ctx.lineTo(rOuter + 12, 0);
      ctx.lineTo(rOuter, 8);
      ctx.closePath();
      ctx.fillStyle  = col;
      ctx.shadowColor = col;
      ctx.shadowBlur  = 10;
      ctx.fill();

      ctx.restore();
    }
  };

  window.ArrowGuide = ArrowGuide;
})();