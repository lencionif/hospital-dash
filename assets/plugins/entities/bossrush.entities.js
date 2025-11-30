// boss_timer.entities.js
// Activa un boss con cuenta atrás de 5 minutos cuando no quedan pacientes
// y detiene el cronómetro al acercar el carro de urgencias al boss.

(function (W) {
  'use strict';

  const G    = W.G || (W.G = {});
  const TILE = (W.TILE_SIZE || W.TILE || 32);

  const LEN2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };
  const CENTER = (e) => ({ x: e.x + e.w * 0.5, y: e.y + e.h * 0.5 });

  // ---------------------------------------------------------------------------
  // HUD sencillo para el cronómetro del Boss
  // ---------------------------------------------------------------------------
  const BossHUD = {
    el: null,
    ensure() {
      if (typeof document === 'undefined') return;
      if (this.el && this.el.parentNode) return;
      const hud  = document.getElementById('hud') || document.querySelector('.hud');
      if (!hud) return;
      const left = hud.querySelector('.hud-left') || hud;

      let el = document.getElementById('bossTimer');
      if (!el) {
        el = document.createElement('div');
        el.id = 'bossTimer';
        el.className = 'pill';
        el.textContent = '⏱️ 05:00';
        left.appendChild(el);
      }
      this.el = el;
    },
    set(sec) {
      this.ensure();
      if (!this.el) return;
      const s = Math.max(0, sec | 0);
      const m = Math.floor(s / 60);
      const r = s % 60;
      this.el.textContent =
        `⏱️ ${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
      this.el.style.borderColor = (s <= 20 ? '#ff6b6b' : '#2b3347');
      this.el.style.color       = (s <= 20 ? '#ffd5d5' : '#cfe0ff');
    },
    hide() { if (this.el) this.el.style.display = 'none'; },
    show() { if (this.el) this.el.style.display = '';  }
  };

  // ---------------------------------------------------------------------------
  // GAME OVER al morir / expirar el Boss
  // ---------------------------------------------------------------------------
  function triggerGameOver(reason = 'boss_dead') {
    G.state = 'GAMEOVER';

    if (W.Audio?.duck) {
      try { W.Audio.duck(true); } catch (e) {}
    }

    if (typeof document !== 'undefined') {
      const el1 = document.getElementById('game-over-screen');
      const el2 = document.getElementById('screen-gameover');
      if (el1 && el1.classList) el1.classList.remove('hidden');
      if (el2 && el2.classList) el2.classList.remove('hidden');
    }

    if (W.ScoreAPI?.onPatientDied) {
      try { W.ScoreAPI.onPatientDied(1, { who: 'boss', reason }); } catch (e) {}
    }
  }

  // ---------------------------------------------------------------------------
  // Lógica de fase de Boss + cronómetro
  // ---------------------------------------------------------------------------
  const BossPhase = {
    active: false,
    timeLeft: 300,        // 5 minutos
    rescueTiles: 2.0,     // distancia en tiles para considerar “curado” al acercar el carro
    start(boss) {
      if (!boss) return;
      this.active = true;
      this.timeLeft = 300;
      BossHUD.show();
      BossHUD.set(this.timeLeft);
    },
    stop() {
      this.active = false;
      BossHUD.hide();
    },
    tick(dt, boss) {
      if (!this.active || !boss || boss.dead) return;

      // Avanza el cronómetro
      this.timeLeft -= dt;
      BossHUD.set(this.timeLeft);

      // Tiempo agotado → el boss muere y es GAME OVER
      if (this.timeLeft <= 0) {
        boss.dead = true;
        triggerGameOver('timeout');
        this.stop();
        return;
      }

      // Comprobar si el carro de urgencias está suficientemente cerca del boss
      const cart = G.cart; // referencia global al carro de urgencias
      if (cart && !cart.dead) {
        const bc  = CENTER(boss);
        const cc  = CENTER(cart);
        const rad = this.rescueTiles * TILE;
        if (LEN2(bc.x, bc.y, cc.x, cc.y) <= rad * rad) {
          // Objetivo cumplido: se detiene el cronómetro (el resto de lógica de curar boss va aparte)
          this.stop();
        }
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Contador de pacientes “normales” (no Boss) aún vivos
  // ---------------------------------------------------------------------------
  function countNormalPatientsAlive() {
    const arr = G.patients || [];
    let c = 0;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (!p || p.dead) continue;
      if (!p.isBoss && !p.delivered) c++;
    }
    return c;
  }

  // ---------------------------------------------------------------------------
  // Helper: adjuntar comportamiento de Boss + cronómetro a una entidad ya creada
  // ---------------------------------------------------------------------------
  function attachBossTimerBehaviour(boss) {
    if (!boss) return;

    boss.isBoss = true;

    // Respetamos update previo si existiera
    const prevUpdate = boss.update || function () {};

    boss.update = function bossWithTimerUpdate(dt) {
      // Arranca el cronómetro cuando no queden pacientes normales
      if (!BossPhase.active && countNormalPatientsAlive() === 0) {
        BossPhase.start(this);
      }

      // Tick del cronómetro (incluye check de carro de urgencias)
      BossPhase.tick(dt, this);

      // Lógica propia del boss (animaciones, etc.)
      prevUpdate.call(this, dt);
    };
  }

  // ---------------------------------------------------------------------------
  // API pública mínima
  // ---------------------------------------------------------------------------
  const BossTimerAPI = {
    BossPhase,
    attachBossTimerBehaviour,
    countNormalPatientsAlive
  };

  W.BossTimerAPI = BossTimerAPI;

})(this);
