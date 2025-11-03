// filename: assets/entities/jefe_servicio.entities.js
// “Jefe de Servicio”: NPC único con acertijos (recompensas/castigos),
// patrulla ligera y utilidades de compatibilidad con tu motor.
// Integra con: Dialog, ScoreAPI, Physics, DoorsAPI, G.effects.

/* global Physics, DoorsAPI */
(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const TILE = (typeof W.TILE_SIZE !== 'undefined') ? W.TILE_SIZE : (W.TILE || 32);

  // ---------------------------------------------------------------------------
  // CONFIGURACIÓN
  // ---------------------------------------------------------------------------
  const CFG = {
    speed: 1.45,                // px/s cap en update
    mass: 1.0,
    friction: 0.15,
    restitution: 0.05,
    interactRadius: TILE * 1.2, // distancia para lanzar acertijo
    cooldownRiddleSec: 18,      // enfriamiento entre acertijos por jugador
    pauseAfterDialogSec: 1.0,   // pausa de IA tras abrir diálogo
    patrolJitter: 0.35,         // cuánto “serpentea” al patrullar
    sprite: 'jefe_servicio.png' // opcional si tu renderer lo usa
  };

  // Banco de acertijos. Cada uno tiene recompensa y penalización.
  // Las recompensas/penalizaciones usan el mismo formato que los médicos para
  // que compartan el gestor de efectos.
  const RIDDLES = [
    {
      id: 'triaje',
      title: 'Triaje de Urgencias',
      text: 'Paciente con dolor torácico súbito + diaforesis. ¿Prioridad?',
      options: ['Baja', 'Diferida', 'Alta', 'No urgente'],
      correctIndex: 2,
      reward:  { healHalves: 4, secs: 16, speedMul: 1.18, pushMul: 1.20, visionDelta: +1, points: 150 },
      penalty: { dmgHalves: 3, secs: 14, speedMul: 0.75, pushMul: 0.85, visionDelta: -1 }
    },
    {
      id: 'asepsia',
      title: 'Asepsia',
      text: '¿Qué medida NO es una técnica de barrera?',
      options: ['Guantes estériles', 'Mascarilla', 'Lavado de manos', 'Antitérmico oral'],
      correctIndex: 3,
      reward:  { healHalves: 4, secs: 17, speedMul: 1.15, pushMul: 1.25, visionDelta: +1, points: 120 },
      penalty: { dmgHalves: 3, secs: 12, speedMul: 0.78, pushMul: 0.82, visionDelta: -1 }
    },
    {
      id: 'electrolitos',
      title: 'Electrolitos',
      text: 'Hiponatremia severa sintomática. ¿La estrategia más adecuada?',
      options: [
        'Restringir agua y observar',
        'Bolo de salino hipertónico controlado',
        'Aumentar agua libre',
        'Diurético de asa + más agua libre'
      ],
      correctIndex: 1,
      reward:  { healHalves: 4, secs: 18, speedMul: 1.18, pushMul: 1.22, visionDelta: +1, points: 180 },
      penalty: { dmgHalves: 3, secs: 14, speedMul: 0.75, pushMul: 0.80, visionDelta: -1 }
    },
    {
      id: 'antibioticos',
      title: 'Antibióticos',
      text: '¿Cuándo desescalar antibiótico en infección nosocomial?',
      options: [
        'Nunca se desescala',
        'Siempre a las 24h',
        'Tras cultivo y estabilidad clínica',
        'Cuando se termina el suero'
      ],
      correctIndex: 2,
      reward:  { healHalves: 2, secs: 14, speedMul: 1.12, pushMul: 1.15, visionDelta: +0, points: 100 },
      penalty: { dmgHalves: 2, secs: 10, speedMul: 0.82, pushMul: 0.86, visionDelta: -0 }
    },
    {
      id: 'trombo',
      title: 'Tromboembolismo',
      text: 'Paciente con TVP masiva + disnea. ¿Actuación inicial?',
      options: ['Analgesia y reposo', 'Anticoagulación inmediata', 'Alta y revisión', 'Sólo medias compresivas'],
      correctIndex: 1,
      reward:  { healHalves: 3, secs: 15, speedMul: 1.10, pushMul: 1.12, visionDelta: +1, points: 130 },
      penalty: { dmgHalves: 2, secs: 12, speedMul: 0.84, pushMul: 0.88, visionDelta: -1 }
    }
  ];

  // ---------------------------------------------------------------------------
  // EFECTOS (compartidos con Médicos). Guardamos en G.effects[playerId]
  // ---------------------------------------------------------------------------
  if (!G.effects) G.effects = Object.create(null);

  function applyTimedEffect(player, fx) {
    // Estructura: { until, speedMul, pushMul, visionDelta, healHalves/dmgHalves }
    const now = (G.timeSec || 0);
    const key = player.id || 'player';
    const list = (G.effects[key] = G.effects[key] || []);
    const until = now + (fx.secs || 10);

    const eff = {
      until,
      speedMul: fx.speedMul || 1.0,
      pushMul:  fx.pushMul  || 1.0,
      visionDelta: fx.visionDelta || 0,
      healHalves: fx.healHalves || 0,
      dmgHalves:  fx.dmgHalves  || 0
    };
    list.push(eff);

    // efectos inmediatos de vida y puntos
    if (fx.healHalves && player.hp != null) {
      player.hp = Math.min(player.maxHp || player.hp, player.hp + fx.healHalves);
    }
    if (fx.dmgHalves && player.hp != null) {
      player.hp = Math.max(0, player.hp - fx.dmgHalves);
    }
    if (fx.points && typeof G.score === 'number') {
      G.score += fx.points;
    }
  }

  function getCompositeMultipliersFor(player) {
    const now = (G.timeSec || 0);
    const key = player.id || 'player';
    const list = G.effects[key] || [];
    // Limpia expirados
    for (let i = list.length - 1; i >= 0; --i) {
      if (list[i].until <= now) list.splice(i, 1);
    }
    // Calcula acumulados
    let speedMul = 1.0, pushMul = 1.0, visionDelta = 0;
    for (const e of list) {
      speedMul *= e.speedMul || 1.0;
      pushMul  *= e.pushMul || 1.0;
      visionDelta += e.visionDelta || 0;
    }
    return { speedMul, pushMul, visionDelta };
  }

  // Exponer utilidades (opcional)
  W.EffectsAPI = W.EffectsAPI || {};
  W.EffectsAPI.applyTimedEffect = applyTimedEffect;
  W.EffectsAPI.getCompositeMultipliersFor = getCompositeMultipliersFor;

  // ---------------------------------------------------------------------------
  // LÓGICA DE NPC: JEFE DE SERVICIO
  // ---------------------------------------------------------------------------
  const Chief = {
    list: [],
    lastRiddleForPlayer: Object.create(null), // idJugador -> timeSec

    create(x, y, p = {}) {
      const e = {
        kind: 'chief',
        x, y, w: TILE * 0.95, h: TILE * 0.95,
        vx: 0, vy: 0,
        mass: CFG.mass,
        friction: CFG.friction,
        restitution: CFG.restitution,
        solid: true,
        dynamic: true,
        pushable: true,
        color: '#ffb347',
        sprite: CFG.sprite,
        skin: 'jefe_servicio.png',
        ai: {
          state: 'patrol',
          pause: 0,
          dirX: 0, dirY: 0,
          target: null
        },
        // tag por si tu renderer necesita distinguir
        npc: 'jefe_servicio',
        aiId: 'JEFESERVICIO'
      };

      // Registro global
      G.entities = G.entities || [];
      G.npcs = G.npcs || [];
      G.entities.push(e);
      G.npcs.push(e);
      try { W.AI?.attach?.(e, 'JEFESERVICIO'); } catch (_) {}
      try {
        const puppet = window.Puppet?.bind?.(e, 'npc_jefe_servicio', { z: 0, scale: 1, data: { skin: e.skin } })
          || window.PuppetAPI?.attach?.(e, { rig: 'npc_jefe_servicio', z: 0, scale: 1, data: { skin: e.skin } });
        e.rigOk = e.rigOk === true || !!puppet;
      } catch (_) {
        e.rigOk = e.rigOk === true;
      }

      // Registrar en física si existe
      if (W.Physics && Physics.registerEntity) Physics.registerEntity(e);

      Chief.list.push(e);
      return e;
    },

    spawn(x, y, p = {}) {
      return Chief.create(x, y, p);
    },

    ensureOneIfMissing() {
      if (Chief.list.length) return;
      // Cerca del último paciente si existe
      const ps = (G.patients || []).filter(p => !p.dead);
      const base = ps[ps.length - 1];
      const x = base ? base.x - 2 * TILE : 6 * TILE;
      const y = base ? base.y            : 6 * TILE;
      Chief.spawn(x, y, {});
    },

    update(dt) {
      // avanza reloj global si lo usas
      G.timeSec = (G.timeSec || 0) + dt;

      for (const e of Chief.list) {
        if (!e || e.dead) continue;

        // pausa temporal (p. ej., tras dialog)
        if (e.ai.pause > 0) {
          e.ai.pause -= dt;
          e.vx *= 0.9; e.vy *= 0.9;
        } else {
          this._patrol(e, dt);
        }

        // limitador de velocidad
        const spd = Math.hypot(e.vx, e.vy);
        if (spd > CFG.speed) {
          const s = CFG.speed / spd;
          e.vx *= s; e.vy *= s;
        }

        // Auto-abrir puertas cercanas para no atascarse (si tu DoorsAPI lo soporta)
        if (W.DoorsAPI && DoorsAPI.autoOpenNear) {
          DoorsAPI.autoOpenNear(e, TILE * 0.9);
        }

        // Interacción con jugadores cercanos
        this._maybeOfferRiddle(e);
      }
    },

    // Patrulla “perezosa”: busca el pasillo más cercano (si tu mapa lo indica),
    // o se desplaza con jitter dentro del área actual.
    _patrol(e, dt) {
      // Genera una dirección pseudoaleatoria persistente
      if (!e.ai.target || Math.random() < 0.01) {
        const jitter = CFG.patrolJitter;
        const angle = Math.random() * Math.PI * 2;
        e.ai.dirX = Math.cos(angle) * (1 + (Math.random() - 0.5) * jitter);
        e.ai.dirY = Math.sin(angle) * (1 + (Math.random() - 0.5) * jitter);
      }
      e.vx += e.ai.dirX * 0.3;
      e.vy += e.ai.dirY * 0.3;
    },

    _maybeOfferRiddle(e) {
      if (!G.player) return;
      const p = G.player;

      const dx = (p.x + (p.w || TILE) * 0.5) - (e.x + e.w * 0.5);
      const dy = (p.y + (p.h || TILE) * 0.5) - (e.y + e.h * 0.5);
      if ((dx * dx + dy * dy) > (CFG.interactRadius * CFG.interactRadius)) return;

      const pid = p.id || 'player';
      const last = Chief.lastRiddleForPlayer[pid] || -9999;
      if ((G.timeSec - last) < CFG.cooldownRiddleSec) return;

      Chief.lastRiddleForPlayer[pid] = G.timeSec;
      e.ai.pause = CFG.pauseAfterDialogSec;

      // Elige acertijo al azar (sin repetir demasiado)
      const r = RIDDLES[(Math.random() * RIDDLES.length) | 0];
      Chief._openRiddleDialog(e, p, r);
    },

    _openRiddleDialog(e, player, riddle) {
      const setTalking = (active) => {
        if (e) e.isTalking = !!active;
        if (player) player.isTalking = !!active;
      };
      setTalking(true);

      const onChoice = (index) => {
        if (index === riddle.correctIndex) {
          applyTimedEffect(player, riddle.reward || {});
          if (W.ScoreAPI && typeof ScoreAPI.add === 'function') {
            ScoreAPI.add(riddle.reward?.points || 100);
          }
        } else {
          applyTimedEffect(player, riddle.penalty || {});
        }
      };

      const finish = (idx) => {
        setTalking(false);
        onChoice(idx);
      };

      // Si hay sistema de diálogos, úsalo; si no, aplica directos
      if (W.Dialog && typeof Dialog.open === 'function') {
        Dialog.open({
          portrait: 'jefe_servicio.png',
          title: riddle.title,
          text: riddle.text,
          options: riddle.options,
          correctIndex: riddle.correctIndex,
          onAnswer: (optIndex) => finish(optIndex),
          onClose: () => setTalking(false)
        });
      } else {
        // Fallback sin UI: 50% acierto
        const fakeIndex = Math.random() < 0.5 ? riddle.correctIndex : 0;
        finish(fakeIndex);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // INTEGRACIÓN CON EL BUCLE DEL JUEGO
  // ---------------------------------------------------------------------------
  // Asegura que se actualiza desde tu game loop si existe G.onTick
  (function ensureUpdateHook() {
    G._hooks = G._hooks || {};
    if (!G._hooks.jefeServicioUpdate) {
      G._hooks.jefeServicioUpdate = true;
      // Si ya tienes un scheduler central, engánchate ahí.
      const prevTick = G.onTick;
      G.onTick = function onTickPatched(dt) {
        if (typeof prevTick === 'function') prevTick(dt);
        Chief.update(dt || 0.016);
      };
    }
  })();

  // ---------------------------------------------------------------------------
  // EXPOSICIÓN PÚBLICA (dos nombres para máxima compatibilidad)
  // ---------------------------------------------------------------------------
  // Lo que usa el spawner (fallback): W.JefeServicioAPI.spawn(x,y,p)
  const PublicAPI = {
    spawn: (x, y, p) => Chief.spawn(x, y, p),
    ensureOneIfMissing: () => Chief.ensureOneIfMissing(),
    update: (dt) => Chief.update(dt),
    _applyTimedEffect: applyTimedEffect,
    _getCompositeMultipliersFor: getCompositeMultipliersFor
  };

  W.JefeServicioAPI = PublicAPI;

  // Alias opcional por si algún código busca Entities.JefeServicio
  W.Entities = W.Entities || {};
  W.Entities.JefeServicio = { spawn: PublicAPI.spawn };

})(this);