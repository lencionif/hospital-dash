// filename: narrator.plugin.js
// Narrador épico/cómico para "Il Divo: Hospital Dash!".
// - Gestiona mensajes contextuales con cooldown, prioridad y cola ligera.
// - Permite habilitar/deshabilitar desde el menú de opciones.
// - Se integra con eventos del juego (campanas, pacientes, carro, etc.).

(function (W) {
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
    _currentUntil: 0,
    _queue: [],
    _lastLineByKey: Object.create(null),
    _lastEvent: null,
    levelId: null,

    init(opts = {}) {
      this.enabled = opts.enabled != null ? !!opts.enabled : this.enabled;
      this.cooldownMs = Number.isFinite(opts.cooldownMs) ? opts.cooldownMs : this.cooldownMs;
      this.durationMs = Number.isFinite(opts.durationMs) ? opts.durationMs : this.durationMs;
      this.levelId = opts.levelId ?? opts.level ?? this.levelId;
      this._queue.length = 0;
      this._lastAt = 0;
      this._lastProgressAt = this._now();
      this._lastIdleHintAt = 0;
      this._currentUntil = 0;
      this._lastEvent = null;
      return this;
    },

    setEnabled(flag) {
      this.enabled = !!flag;
      if (!this.enabled) {
        this._queue.length = 0;
        this._currentUntil = 0;
      }
      return this;
    },

    toggle() {
      return this.setEnabled(!this.enabled);
    },

    say(key, dataOrOpts = {}, maybeOpts = {}) {
      const opts = selectOpts(dataOrOpts, maybeOpts);
      const data = opts === dataOrOpts ? {} : (dataOrOpts || {});
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

      this._display(payload, opts);
      return true;
    },

    onEvent(eventName, payload = {}) {
      this._lastEvent = { name: eventName, payload, at: this._now() };
      switch (eventName) {
        case 'LEVEL_START':
          this.init({ levelId: payload.levelId ?? payload.level });
          this.say('level_start', payload, { priority: 'high', minCooldownMs: 0 });
          this.progress();
          break;
        case 'BOSS_DOOR_OPEN':
          this.say('door_open', payload, { priority: 'high' });
          this.progress();
          break;
        case 'OBJECTIVE_COMPLETED':
          this.say('objective_completed', payload, { priority: 'high', minCooldownMs: 0 });
          this.progress();
          break;
        case 'HERO_DIED':
          this.say('hero_died', payload, { priority: 'high', minCooldownMs: 0, force: true, progress: false });
          break;
        default:
          if (payload?.text) {
            this.say(payload.text, payload, { priority: 'high' });
          }
      }
    },

    update(dt, G) {
      const now = this._now();
      this._consumeQueue(now);
      if (!this.enabled) return;
      if (this._currentUntil > 0 && now >= this._currentUntil) {
        this._currentUntil = 0;
      }
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

    progress() {
      this._lastProgressAt = this._now();
    },

    _consumeQueue(now) {
      if (!this.enabled) return;
      if (this._currentUntil > now) return;
      if (now - this._lastAt < this.cooldownMs * 0.5) return;
      if (!this._queue.length) return;
      const next = this._queue.shift();
      if (!next) return;
      this._display(next, {});
    },

    _display(msg, opts = {}) {
      const now = this._now();
      this._lastAt = now;
      this._currentUntil = now + msg.duration;
      if (msg.progress !== false) this._lastProgressAt = now;

      try {
        W.DialogAPI?.system?.(msg.text, { ms: msg.duration });
      } catch (_) {
        /* no-op */
      }

      if (opts.pauseGame === true && typeof W.GameFlowAPI?.pauseGame === 'function') {
        try { W.GameFlowAPI.pauseGame(); } catch (_) {}
      }
      if (opts.pauseGame === false && typeof W.GameFlowAPI?.resumeGame === 'function') {
        try { W.GameFlowAPI.resumeGame(); } catch (_) {}
      }

      if (msg.key) {
        this._lastLineByKey[msg.key] = msg.text;
      }
    },

    _now() {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
      }
      return Date.now();
    }
  };

  function selectOpts(maybeData, maybeOpts) {
    const looksLikeOpts = (obj) => obj && typeof obj === 'object' && (
      'priority' in obj || 'durationMs' in obj || 'minCooldownMs' in obj || 'force' in obj || 'queue' in obj || 'progress' in obj || 'forceEnabled' in obj || 'pauseGame' in obj
    );
    if (arguments.length >= 2 && arguments[1] && Object.keys(maybeOpts || {}).length) return maybeOpts || {};
    if (looksLikeOpts(maybeData) && Object.keys(maybeData).length && !looksLikeOpts(maybeOpts)) return maybeData || {};
    return maybeOpts || {};
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
      case 'objective':
        return data.objective || data.id || 'objetivo principal';
      case 'remaining':
        return Number.isFinite(data.remaining) ? data.remaining : '???';
      case 'furious':
        return Number.isFinite(data.furious) ? data.furious : 0;
      case 'reason':
        return data.reason || 'un misterioso accidente';
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
    objective_completed: [
      { text: 'Objetivo completado: {objective}. El camino sigue abierto.' },
      { text: '¡Objetivo {objective} tachado! Sigamos salvando vidas.' },
      { text: 'Marca de progreso desbloqueada. Objetivo {objective} listo.' }
    ],
    level_complete: [
      { text: 'Misión cumplida: todos a salvo... por ahora. ¡Victoria épica!', tone: 'all' },
      { text: '¡Turno terminado con matrícula heroica! El hospital aplaude.', tone: 'bold' },
      { text: 'Narrador confirma: la leyenda continúa más allá de estas paredes.', tone: 'all' }
    ],
    hero_died: [
      { text: 'El héroe ha caído ({reason}). El turno termina con sabor amargo.', tone: 'all' },
      { text: 'Narrador en shock: derrota por {reason}. ¡Reorganiza y vuelve al quirófano!', tone: 'bold' },
      { text: 'Fin del servicio por {reason}. Tocará pedir refuerzos.', tone: 'all' }
    ],
    idle_hint: [
      { text: 'El tiempo corre... quedan {remaining} pacientes y {furious} furiosas vigilando.', tone: 'all' },
      { text: 'Recordatorio amistoso: aún faltan {remaining} almas por salvar.', tone: 'all' },
      { text: 'El hospital murmura impaciente. ¡A la acción!', tone: 'bold' }
    ]
  };

  window.Narrator = Narrator;
  window.NarratorAPI = Narrator;
})(window);
