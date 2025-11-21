// filename: familiar_molesto.entities.js
// VISITANTE MOLESTO — “Il Divo: Hospital Dash!”
// IA ligera con diálogos molestos, confusión al héroe y rig 1 tile.
(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const ENT = W.ENT || (W.ENT = {});
  const Entities = W.Entities || (W.Entities = {});
  const TILE = W.TILE_SIZE || W.TILE || 32;

  if (typeof Entities.define !== 'function') {
    Entities.define = function define(name, factory) {
      this[name] = factory;
      return factory;
    };
  }

  ENT.FAMILIAR = ENT.FAMILIAR ?? 'familiar_molesto';

  const FAMILIAR_QUESTIONS = [
    "¿Cuándo se va a repartir la comida?",
    "¿Y para los acompañantes no dan nada de comer?",
    "¿A mi familiar cuándo lo vais a ver? Que lleva rato así.",
    "¿Aún no le habéis hecho la glucemia?",
    "¿La glucemia cuándo se la hacéis exactamente? Pero dígame la hora.",
    "¿Está seguro de que es la pastilla correcta, enfermero?",
    "¿Eso que le pone en la vía qué es? ¿No le hará daño, no?",
    "¿El médico cuándo pasa? Es que nunca coincide que yo esté.",
    "¿Y el médico de antes, el joven, no puede venir él mejor?",
    "¿Podemos ver el tratamiento de mi familiar? Pero todo, todo.",
    "¿No le podéis poner algo más fuerte para el dolor?",
    "¿No le podéis quitar ya ese suero? Que le molesta.",
    "¿La habitación individual no nos la podéis conseguir? Es que él está muy delicado.",
    "¿No lo podéis subir ya a planta? Aquí en urgencias lleva horas.",
    "¿La clave del wifi cuál es? Que no llega bien la cobertura.",
    "¿Puedo ver… sabe usted dónde está el baño?",
    "¿Está aquí Fulano / Fulanito? Es que me han dicho que estaba por esta zona.",
    "¿No le vais a tomar la tensión otra vez? La última vez estaba alta.",
    "¿Eso que pita no será de mi familiar, verdad? ¿No será grave?",
    "¿No podéis bajar un poco la luz / subir la luz / apagar esa luz?",
    "¿Por qué tardáis tanto si solo es sacar sangre?",
    "¿No le podéis cambiar ya el pañal otra vez? Que a mí me da cosa.",
    "¿No podéis venir a girarlo un poquito más? Que así no está cómodo?",
    "¿Y no le dais algo para que duerma? Porque yo también estoy cansado.",
    "¿Cada cuánto rato vais a entrar? Es para saber.",
    "¿No podéis dejar la puerta abierta / cerrada? Es que así no me gusta.",
    "¿Eso que habéis escrito en el ordenador qué es? ¿Puedo verlo?",
    "¿Por qué le ponéis esa dosis? A él siempre le han puesto menos.",
    "¿Le vais a pinchar otra vez? Es que ya lleva muchos pinchazos hoy, ¿eh?",
    "¿No le podéis cambiar la cama otra vez? Es que se le arruga la sábana.",
    "¿Quién es el responsable de aquí? Que quiero hablar con el responsable.",
    "¿No podéis hacerle otra prueba más por si acaso?",
    "¿Va a tardar mucho el resultado? Porque ya llevamos todo el día esperando.",
    "¿Le vais a dar el alta hoy, sí o no? Que tenemos cosas que hacer.",
    "¿Y si lo llevamos a otro hospital no sería mejor?",
    "¿No le podéis poner la tele gratis? Bastante tenemos ya con estar aquí.",
    "¿No le dais un poco de agua? Tiene sed.",
    "¿Por qué le pincháis ahí y no en otro sitio?",
    "¿Le podéis mirar otra vez, por favor? Que lo veo raro.",
    "¿Tenéis mantas? ¿Y otra? ¿Y otra más? Tiene frío."
  ];

  function pickRandomFamiliarQuestionKey() {
    const idx = (Math.random() * FAMILIAR_QUESTIONS.length) | 0;
    return FAMILIAR_QUESTIONS[idx];
  }

  function debugLog(tag, data) {
    if (W.DEBUG || W.DEBUG_FAMILIAR) {
      try { console.debug(tag, data); } catch (_) { /* noop */ }
    }
  }

  function getHero() {
    const hero = G.player;
    return hero && !hero.dead ? hero : null;
  }

  function distanceBetween(a, b) {
    if (!a || !b) return Infinity;
    const ax = a.x + a.w * 0.5;
    const ay = a.y + a.h * 0.5;
    const bx = b.x + b.w * 0.5;
    const by = b.y + b.h * 0.5;
    return Math.hypot(ax - bx, ay - by);
  }

  function setFamiliarWalkAnim(ent) {
    if (!ent || !ent.puppetState) return;
    if (Math.abs(ent.vx) > Math.abs(ent.vy)) {
      ent.puppetState.anim = 'walk_side';
    } else if (ent.vy < 0) {
      ent.puppetState.anim = 'walk_up';
    } else {
      ent.puppetState.anim = 'walk_down';
    }
  }

  function ensureArrays() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.movers)) G.movers = [];
  }

  function attachRig(ent) {
    if (!ent) return;
    try {
      const puppet = W.Puppet?.bind?.(ent, 'npc_familiar_molesto', { z: 0, scale: 1, data: { skin: ent.skin } })
        || W.PuppetAPI?.attach?.(ent, { rig: 'npc_familiar_molesto', z: 0, scale: 1, data: { skin: ent.skin } });
      if (puppet) ent.rigOk = true;
    } catch (_) {
      ent.rigOk = ent.rigOk || true;
    }
  }

  function ensureStatus(hero) {
    if (!hero) return null;
    if (!hero.status) hero.status = {};
    if (!hero.status.confusedUntil) hero.status.confusedUntil = 0;
    if (hero.status.confused == null) hero.status.confused = false;
    return hero.status;
  }

  function applyConfuseToHero(hero, duration, meta) {
    if (!hero) return;
    if (W.Entities?.Hero?.applyConfuse) {
      W.Entities.Hero.applyConfuse(hero, duration, meta);
      return;
    }
    const status = ensureStatus(hero);
    const now = (performance?.now ? performance.now() : Date.now()) / 1000;
    const span = Math.max(0, Number(duration) || 0);
    status.confused = true;
    status.confusedUntil = Math.max(status.confusedUntil || 0, now + span);
    status.confusedSource = meta?.source || meta?.attacker || 'familiar_molesto';
  }

  function createBaseFamiliar(pos, opts = {}) {
    const p = pos || {};
    const x = (typeof p.x === 'number') ? p.x : (Array.isArray(p) ? p[0] : p);
    const y = (typeof p.y === 'number') ? p.y : (Array.isArray(p) ? p[1] : 0);
    const base = (typeof Entities.createBaseHuman === 'function')
      ? Entities.createBaseHuman(pos, opts)
      : {
          x: x || 0,
          y: y || 0,
          w: TILE * 0.9,
          h: TILE * 0.95,
          vx: 0,
          vy: 0,
          solid: true,
          dynamic: true,
          pushable: true,
          mu: 0.08,
          rest: 0.3,
          puppetState: { anim: 'idle' },
        };
    return base;
  }

  function createFamiliarMolesto(pos, opts = {}) {
    const ent = createBaseFamiliar(pos, opts);
    ent.id = ent.id || `FAM_${Math.random().toString(36).slice(2, 8)}`;
    ent.kind = 'familiar_molesto';
    ent.kindName = 'familiar_molesto';
    ent.role = 'npc_familiar_molesto';
    ent.moveSpeed = opts.moveSpeed ?? 0.9;
    ent.hp = opts.hp ?? 20;
    ent.confuseChance = opts.confuseChance ?? 0.35;
    ent.confuseTime = opts.confuseTime ?? 3.0;
    ent.rambleCooldown = opts.rambleCooldown ?? 6.0;
    ent.detectRadius = opts.detectRadius ?? 4.0; // tiles
    ent.ai = {
      state: 'wander',
      wanderTimer: 0,
      rambleTimer: 0,
      cooldownTimer: 0,
      talkTimer: 0,
      targetHeroId: null,
    };
    ent.skin = ent.skin || 'familiar_molesto.png';
    ent.puppetState = ent.puppetState || { anim: 'idle' };
    attachRig(ent);
    ensureArrays();
    if (!G.entities.includes(ent)) G.entities.push(ent);
    if (!G.movers.includes(ent)) G.movers.push(ent);
    ent.group = ent.group || 'human';
    try { W.EntityGroups?.assign?.(ent); } catch (_) {}
    try { W.EntityGroups?.register?.(ent, G); } catch (_) {}
    return ent;
  }

  function updateFamiliarWander(ent, dt) {
    const ai = ent.ai;
    ai.wanderTimer -= dt;
    if (ai.wanderTimer <= 0) {
      const angle = Math.random() * Math.PI * 2;
      const speed = ent.moveSpeed * TILE * 0.5;
      ent.vx = Math.cos(angle) * speed;
      ent.vy = Math.sin(angle) * speed;
      ai.wanderTimer = 1.5 + Math.random() * 2.0;
    }
    setFamiliarWalkAnim(ent);
  }

  function startFamiliarDialog(ent, hero) {
    const ai = ent.ai;
    ai.state = 'talk';
    ai.rambleTimer = ent.rambleCooldown;
    ai.talkTimer = 2.4;
    const key = pickRandomFamiliarQuestionKey();
    const payload = { npcId: ent.id, heroId: hero?.id };
    const started = !!W.NarrativeAPI?.startDialog?.('familiar_molesto', key, payload);
    const onClose = () => {
      if (typeof resumeGame === 'function') resumeGame();
      onFamiliarDialogEnd(ent, hero);
    };
    if (typeof pauseGame === 'function') pauseGame();
    if (!started) {
      if (W.DialogAPI?.open) {
        W.DialogAPI.open({
          title: 'Visitante molesto',
          portraitCssVar: '--portrait-familiar',
          text: key,
          buttons: [{ id: 'ok', label: 'Continuar', action: () => W.DialogAPI.close?.() }],
          onClose,
        });
      } else {
        try { console.log('[FamiliarMolesto]', key); } catch (_) {}
        setTimeout(onClose, 1600);
      }
    } else {
      setTimeout(onClose, 1800);
    }
    ent.vx = ent.vy = 0;
    ent.puppetState.anim = 'talk';
    if (hero && W.Entities?.Hero?.setTalking) {
      try { W.Entities.Hero.setTalking(hero, true); } catch (_) {}
    }
    debugLog('[FAMILIAR_TALK_START]', { id: ent.id, dialogKey: key });
  }

  function onFamiliarDialogEnd(ent, hero) {
    const ai = ent.ai;
    if (!ai || ai.state !== 'talk') return;
    if (Math.random() < ent.confuseChance && hero) {
      applyConfuseToHero(hero, ent.confuseTime, { source: 'familiar_molesto' });
      debugLog('[FAMILIAR_CONFUSE_HERO]', { id: ent.id, heroId: hero.id });
    }
    ai.state = 'cooldown';
    ai.cooldownTimer = 2.5;
    ai.talkTimer = 0;
    ent.vx = ent.vy = 0;
    ent.puppetState.anim = 'idle';
    if (hero && W.Entities?.Hero?.setTalking) {
      try { W.Entities.Hero.setTalking(hero, false); } catch (_) {}
    }
    debugLog('[FAMILIAR_TALK_END]', { id: ent.id });
  }

  function updateFamiliarFollow(ent, hero, dt) {
    if (!hero) {
      ent.ai.state = 'wander';
      ent.ai.targetHeroId = null;
      return;
    }
    const dx = hero.x - ent.x;
    const dy = hero.y - ent.y;
    const dist = Math.hypot(dx, dy) || 1;
    const desiredDist = 1.1 * TILE;
    const speed = ent.moveSpeed * TILE;
    if (dist > desiredDist) {
      ent.vx = (dx / dist) * speed;
      ent.vy = (dy / dist) * speed;
      setFamiliarWalkAnim(ent);
    } else {
      ent.vx = ent.vy = 0;
      ent.puppetState.anim = 'idle';
      if (ent.ai.rambleTimer <= 0) {
        startFamiliarDialog(ent, hero);
      }
    }
  }

  function updateFamiliarTalk(ent, hero, dt) {
    const ai = ent.ai;
    ai.talkTimer -= dt;
    ent.vx = ent.vy = 0;
    ent.puppetState.anim = 'talk';
    if (ai.talkTimer <= 0) {
      onFamiliarDialogEnd(ent, hero);
    }
  }

  function updateFamiliarCooldown(ent, dt) {
    const ai = ent.ai;
    ai.cooldownTimer -= dt;
    ent.vx = ent.vy = 0;
    ent.puppetState.anim = 'idle';
    if (ai.cooldownTimer <= 0) ai.state = 'wander';
  }

  function tickMovement(ent, dt) {
    const nx = ent.x + (ent.vx || 0) * dt;
    const ny = ent.y + (ent.vy || 0) * dt;
    if (typeof W.moveWithCollisions === 'function') {
      W.moveWithCollisions(ent);
    } else {
      ent.x = nx;
      ent.y = ny;
    }
    ent.vx *= 0.9;
    ent.vy *= 0.9;
  }

  function updateFamiliarMolesto(ent, dt) {
    const ai = ent.ai;
    if (!ai || ent.dead || ai.state === 'dead') return;
    const hero = getHero();
    ai.wanderTimer -= dt;
    ai.rambleTimer -= dt;

    const detect = ent.detectRadius * TILE;
    if (!hero) {
      ai.state = 'wander';
    } else {
      const dist = distanceBetween(ent, hero);
      if (dist < detect && ai.state !== 'talk' && ai.state !== 'cooldown') {
        ai.state = 'follow';
        ai.targetHeroId = hero.id;
      } else if (dist > detect * 1.5 && ai.state === 'follow') {
        ai.state = 'wander';
        ai.targetHeroId = null;
      }
    }

    switch (ai.state) {
      case 'wander':
        updateFamiliarWander(ent, dt);
        break;
      case 'follow':
        updateFamiliarFollow(ent, hero, dt);
        break;
      case 'talk':
        updateFamiliarTalk(ent, hero, dt);
        break;
      case 'cooldown':
        updateFamiliarCooldown(ent, dt);
        break;
      case 'dead':
        ent.puppetState.anim = 'die_hit';
        ent.vx = ent.vy = 0;
        break;
    }

    tickMovement(ent, dt);
    debugLog('[FAMILIAR_STATE]', { id: ent.id, state: ai.state });
  }

  function updateAll(dt = 1 / 60) {
    if (!Array.isArray(G.entities)) return;
    for (const ent of G.entities) {
      if (!ent || ent.dead) continue;
      if (ent.kind === 'familiar_molesto' || ent.role === 'npc_familiar_molesto') {
        updateFamiliarMolesto(ent, dt);
      }
    }
  }

  Entities.define('familiar_molesto', createFamiliarMolesto);

  const FamiliarMolestoAPI = {
    create: createFamiliarMolesto,
    spawn: (x, y, opts) => createFamiliarMolesto({ x, y }, opts),
    update: updateFamiliarMolesto,
    updateAll,
    list() {
      return (G.entities || []).filter((e) => e && !e.dead && (e.kind === 'familiar_molesto' || e.role === 'npc_familiar_molesto'));
    },
  };

  W.Entities.FamiliarMolesto = FamiliarMolestoAPI;
  W.FamiliarMolestoAPI = FamiliarMolestoAPI;

  try {
    (G.systems ||= []).push({ id: 'familiar_molesto_ai', update: updateAll });
  } catch (_) {}

  W.Entities.NPC = W.Entities.NPC || {};
  (function registerNPCSpawn() {
    const prev = W.Entities.NPC.spawn;
    W.Entities.NPC.spawn = function npcSpawn(sub, x, y, payload) {
      const key = String(sub || '').toLowerCase();
      if (key === 'familiar_molesto' || key === 'familiar' || key === 'visitante') {
        return createFamiliarMolesto({ x, y }, payload);
      }
      if (typeof prev === 'function') return prev.call(this, sub, x, y, payload);
      return null;
    };
  })();
})(this);
