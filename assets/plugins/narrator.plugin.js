// filename: narrator.plugin.js
// Narrador épico/cómico para "Il Divo: Hospital Dash!".
// - Gestiona mensajes contextuales con cooldown, prioridad y cola ligera.
// - Permite habilitar/deshabilitar desde el menú de opciones.
// - Se integra con eventos del juego (campanas, pacientes, carro, etc.).

(function () {
  'use strict';

  const DEFAULT_DURATION = 2800; // ms
  const DEFAULT_COOLDOWN = 4200; // ms
  const IDLE_HINT_DELAY = 52000; // ms

  const Narrator = {
    enabled: true,
    cooldownMs: DEFAULT_COOLDOWN,
    durationMs: DEFAULT_DURATION,
    _lastAt: 0,
    _lastProgressAt: 0,
    _lastIdleHintAt: 0,
    _root: null,
    _textNode: null,
    _hideTimer: null,
    _queue: [],
    _lastLineByKey: Object.create(null),

    init(opts = {}) {
      if (this._root) return this;
      const container = resolveContainer(opts.container);
      const root = document.createElement('div');
      root.id = 'narrator-banner';
      root.setAttribute('role', 'status');
      root.setAttribute('aria-live', 'polite');
      root.setAttribute('aria-atomic', 'true');
      root.dataset.visible = 'false';
      root.className = 'narrator-hidden';
      root.style.pointerEvents = 'none';

      const inner = document.createElement('span');
      inner.className = 'narrator-line';
      root.appendChild(inner);

      (container || document.body).appendChild(root);

      this._root = root;
      this._textNode = inner;
      this.enabled = opts.enabled != null ? !!opts.enabled : this.enabled;
      this.cooldownMs = Number.isFinite(opts.cooldownMs) ? opts.cooldownMs : this.cooldownMs;
      this.durationMs = Number.isFinite(opts.durationMs) ? opts.durationMs : this.durationMs;
      this._lastAt = 0;
      this._lastProgressAt = this._now();
      return this;
    },

    setEnabled(flag) {
      this.enabled = !!flag;
      if (!this.enabled) {
        this._clearCurrent();
        this._queue.length = 0;
      }
      return this;
    },

    toggle() {
      return this.setEnabled(!this.enabled);
    },

    say(key, data = {}, opts = {}) {
      const explicitText = (typeof key === 'string' && !LINES[key]) ? key : null;
      const lineKey = explicitText ? null : key;
      const line = explicitText || pickLine(lineKey, data);
      if (!line) return false;

      const now = this._now();
      const minWait = Number.isFinite(opts.minCooldownMs) ? opts.minCooldownMs : this.cooldownMs;
      const bypass = !!opts.force;
      const allowEvenIfDisabled = !!opts.forceEnabled;
      const duration = Number.isFinite(opts.durationMs) ? opts.durationMs : this.durationMs;
      const countsAsProgress = opts.progress !== false;

      const payload = { text: line, key: lineKey, duration, progress: countsAsProgress };
      if (!this.enabled && !allowEvenIfDisabled) {
        // Guarda como último progreso para evitar recordatorios constantes
        if (countsAsProgress) this._lastProgressAt = now;
        return false;
      }

      if (!bypass && now - this._lastAt < minWait) {
        if (opts.priority === 'high') {
          this._queue.unshift(payload);
        } else if (opts.queue !== false) {
          this._queue.push(payload);
        }
        return false;
      }

      this._display(payload);
      return true;
    },

    progress() {
      this._lastProgressAt = this._now();
    },

    tick(dt, G) {
      if (!this.enabled) return;
      const now = this._now();
      if (G && G.state && G.state !== 'PLAYING') {
        this._lastIdleHintAt = now;
        return;
      }
      if (now - this._lastProgressAt >= IDLE_HINT_DELAY && now - this._lastIdleHintAt >= IDLE_HINT_DELAY) {
        const remaining = Number.isFinite(G?.stats?.remainingPatients) ? G.stats.remainingPatients : null;
        const furious = Number.isFinite(G?.stats?.activeFuriosas) ? G.stats.activeFuriosas : null;
        const data = { remaining, furious };
        if (this.say('idle_hint', data, { priority: 'high', progress: false, minCooldownMs: 0 })) {
          this._lastIdleHintAt = now;
          this._lastProgressAt = now;
        }
      }
    },

    _display(msg) {
      const now = this._now();
      this._lastAt = now;
      if (msg.progress !== false) this._lastProgressAt = now;
      if (!this._root) this.init();
      if (!this._root || !this._textNode) return;

      this._textNode.textContent = msg.text;
      this._root.dataset.visible = 'true';
      this._root.classList.remove('narrator-hidden');
      this._root.classList.add('narrator-visible');
      clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => this._clearCurrent(), msg.duration);

      if (msg.key) {
        this._lastLineByKey[msg.key] = msg.text;
      }
    },

    _clearCurrent() {
      if (!this._root) return;
      this._root.dataset.visible = 'false';
      this._root.classList.remove('narrator-visible');
      this._root.classList.add('narrator-hidden');
      if (this._queue.length) {
        const next = this._queue.shift();
        if (next) {
          const wait = Math.max(120, this.cooldownMs * 0.25);
          setTimeout(() => this._display(next), wait);
        }
      }
    },

    _now() {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
      }
      return Date.now();
    }
  };

  function resolveContainer(candidate) {
    if (candidate && candidate instanceof HTMLElement) return candidate;
    const byId = (typeof candidate === 'string') ? document.getElementById(candidate) : null;
    if (byId) return byId;
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) return gameContainer;
    return document.body;
  }

  function pickLine(key, data) {
    if (!key) return null;
    const poolRaw = LINES[key];
    if (!Array.isArray(poolRaw) || poolRaw.length === 0) return null;
    const preferSoft = isHumorSoftMode();
    const pool = poolRaw
      .map(normalizeLine)
      .filter((entry) => {
        if (!entry.text) return false;
        if (!entry.tone || entry.tone === 'all') return true;
        if (preferSoft) {
          return entry.tone !== 'bold';
        }
        return true;
      });
    if (!pool.length) {
      pool.push(...poolRaw.map(normalizeLine));
    }
    const cacheKey = key;
    const last = Narrator._lastLineByKey[cacheKey] || null;
    const candidates = last
      ? pool.filter((entry) => entry.text !== last)
      : pool.slice();
    const selected = (candidates.length ? candidates : pool)[Math.floor(Math.random() * (candidates.length ? candidates.length : pool.length))];
    if (!selected) return null;
    return formatLine(selected.text, data);
  }

  function normalizeLine(entry) {
    if (typeof entry === 'string') {
      return { text: entry, tone: 'all' };
    }
    if (!entry || typeof entry.text !== 'string') return { text: '', tone: 'all' };
    return { text: entry.text, tone: entry.tone || 'all' };
  }

  function formatLine(text, data = {}) {
    if (!text) return '';
    return text.replace(/\{(\w+)\}/g, (match, key) => {
      const value = resolveDataKey(key, data);
      return (value != null && value !== '') ? String(value) : match;
    });
  }

  function resolveDataKey(key, data) {
    const value = data[key];
    if (value != null) return value;
    switch (key) {
      case 'patient':
      case 'patientName':
        return data.patientName || data.name || data.displayName || data.label || 'el paciente';
      case 'bell':
        return data.bell || data.bellId || '#?';
      case 'enemy':
        return data.enemy || data.enemyName || data.displayName || 'ese enemigo';
      case 'level':
        return data.level != null ? data.level : '';
      case 'remaining':
        return Number.isFinite(data.remaining) ? data.remaining : '???';
      case 'furious':
        return Number.isFinite(data.furious) ? data.furious : 0;
      default:
        return data[key];
    }
  }

  function isHumorSoftMode() {
    try {
      return !!document.getElementById('opt-humor')?.checked;
    } catch (_) {
      return false;
    }
  }

  const LINES = {
    level_start: [
      { text: '¡Así comienza la misión! Enfermeras contra el caos... ¿Podrá nuestro héroe salvar el día?' },
      { text: 'Turno {level}: el hospital contiene la respiración. ¡Hora de repartir pastillas y gloria!' },
      { text: 'En directo desde el ala de urgencias: ¡{level}º turno y un héroe con bata al ataque!' }
    ],
    bell_ring: [
      { text: '¡Atención! El paciente {patient} reclama auxilio con voz de campana.', tone: 'all' },
      { text: '¡Bling! {patient} acaba de pulsar el botón del pánico. ¿Responderás?', tone: 'all' },
      { text: '{patient} suena la alarma como si fuera un espectáculo de luces. ¡Vamos allá!', tone: 'bold' }
    ],
    bell_off: [
      { text: 'Timbre silenciado: {patient} vuelve a la calma... por ahora.' },
      { text: 'Hazaña sonora: campana apagada, hospital en paz.' },
      { text: '¡Click! El botón de {patient} ha quedado domado.' }
    ],
    patient_furious: [
      { text: '¡Oh no! {patient} ha entrado en modo furia. ¡Prepara el plan B!', tone: 'all' },
      { text: '{patient} se ha convertido en tormenta con bata. ¡Contención inmediata!', tone: 'bold' },
      { text: 'Los indicadores se disparan: {patient} requiere mano firme y humor infinito.', tone: 'all' }
    ],
    patient_cured: [
      { text: 'Paciente estabilizado: {patient}. ¡Uno menos en la lista!', tone: 'all' },
      { text: '{patient} agradece tu pulso épico. ¡Seguimos!', tone: 'all' },
      { text: '¡Victoria médica! {patient} vuelve a sonreír.', tone: 'bold' }
    ],
    slip: [
      { text: '¡Ups! Ese charco casi te lanza a patinaje artístico.' },
      { text: 'Aviso de seguridad: el suelo mojado también hace memes.' },
      { text: 'Anota: la gravedad sigue funcionando en este hospital.', tone: 'all' }
    ],
    enemy_fire: [
      { text: '¡Impactante! {enemy} quedó bien tostado.', tone: 'bold' },
      { text: '¡Fuego purificador! Adiós, {enemy}.', tone: 'all' },
      { text: '{enemy} aprendió por las malas que el fuego no es spa.', tone: 'all' }
    ],
    cart_push: [
      { text: '¡Empujando el carro de la salvación! Mantén el ritmo.', tone: 'all' },
      { text: '¡Vamos! Ese carro de urgencias rueda con estilo heroico.', tone: 'bold' },
      { text: 'El carro responde a tu llamado. ¡Rumor de hazaña épica!', tone: 'all' }
    ],
    door_open: [
      { text: '¡Las puertas de Urgencias se abren! Camino despejado.', tone: 'all' },
      { text: '¡Puerta final activada! La gloria huele a desinfectante.', tone: 'bold' },
      { text: 'Alerta narrativa: el portal del destino está listo.', tone: 'all' }
    ],
    final_delivery: [
      { text: '¡Entrega crítica realizada! {patient} vuelve de la cornisa.', tone: 'all' },
      { text: 'Carro en posición: ¡heroísmo completado!', tone: 'bold' },
      { text: 'Misiones médicas: 100%. {patient} está a salvo.', tone: 'all' }
    ],
    hematologic_timer: [
      { text: '¡Queda poco personal! Atiende a la paciente hematológica antes de que el reloj llegue a cero.', tone: 'all' },
      { text: 'La paciente hematológica espera. ¡Cronómetro activo!', tone: 'all' }
    ],
    hematologic_cured: [
      { text: 'Paciente hematológica estabilizada. Ahora lleva el carro de urgencias.', tone: 'all' },
      { text: 'Respira tranquila: está estable. Falta el carro.', tone: 'all' }
    ],
    hematologic_cart_hint: [
      { text: 'Acerca el carro de urgencias a la cama para completar la misión.', tone: 'all' }
    ],
    hematologic_saved: [
      { text: '¡Paciente hematológica salvada! Victoria asegurada.', tone: 'all' }
    ],
    hematologic_fail: [
      { text: 'El tiempo se agotó para la paciente hematológica...', tone: 'all' }
    ],
    level_complete: [
      { text: 'Misión cumplida: todos a salvo... por ahora. ¡Victoria épica!', tone: 'all' },
      { text: '¡Turno terminado con matrícula heroica! El hospital aplaude.', tone: 'bold' },
      { text: 'Narrador confirma: la leyenda continúa más allá de estas paredes.', tone: 'all' }
    ],
    idle_hint: [
      { text: 'El tiempo corre... quedan {remaining} pacientes y {furious} furiosas vigilando.', tone: 'all' },
      { text: 'Recordatorio amistoso: aún faltan {remaining} almas por salvar.', tone: 'all' },
      { text: 'El hospital murmura impaciente. ¡A la acción!', tone: 'bold' }
    ]
  };

  window.Narrator = Narrator;
  window.NarratorAPI = Narrator;
})();
