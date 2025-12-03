// assets/plugins/entities/visitor_annoying.entities.js
// TODO: Archivo no referenciado en index.html. Candidato a eliminación si se confirma que no se usa.
// Entidad "visitante molesto" con IA disruptiva y rig Puppet.
(function (W) {
  'use strict';

  const root = W || window;
  const G = root.G || (root.G = {});
  const ENT = (function ensureEnt(ns) {
    const e = ns || {};
    if (typeof e.VISITOR_ANNOYING === 'undefined') e.VISITOR_ANNOYING = 501;
    return e;
  })(root.ENT || (root.ENT = {}));

  const TILE = root.TILE_SIZE || root.TILE || 32;
  const HERO_Z = typeof root.HERO_Z === 'number' ? root.HERO_Z : 10;
  const HP_PER_HEART = root.HP_PER_HEART || 1;

  const CHAT_RADIUS = TILE * 4;
  const ATTACK_RADIUS = TILE * 1;
  const CONVERSATION_DIST = TILE * 1.05;
  const IDLE_WANDER_SPEED = 18;
  const APPROACH_SPEED = 46;

  const TALK_COOLDOWN_MIN = 5;
  const TALK_COOLDOWN_MAX = 8;
  const BACKGROUND_COOLDOWN = 10;
  const ATTACK_RECOIL_TIME = 0.65;

  const LINES_SOFT = [
    '¿Esto tardará mucho?',
    'En Google pone otra cosa…',
    '¿Puedo pasar antes que mi primo?',
    'No veo cafetera, ¿en serio?',
    '¿Hay WiFi gratis?',
    'Me aburro…',
  ];

  const LINES_AGGRO = [
    '¡Eh, escucha cuando hablo!',
    'Mira mi móvil, lo pone clarito.',
    '¿De verdad eres el héroe?',
    'Esto es un caos, ¿sabes?',
  ];

  function randRange(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] || arr[0]; }

  function gridToWorldCenter(tx, ty) {
    const size = typeof root.GridMath?.tileSize === 'function' ? root.GridMath.tileSize() : TILE;
    return { x: tx * size + size * 0.5, y: ty * size + size * 0.5 };
  }

  function ensureCollections() {
    if (!Array.isArray(G.entities)) G.entities = [];
    if (!Array.isArray(G.npcs)) G.npcs = [];
    if (!Array.isArray(G.movers)) G.movers = [];
  }

  function attachRig(e) {
    if (root.PuppetAPI?.attach) {
      try {
        const rig = root.PuppetAPI.attach(e, { rig: 'npc_visitor_annoying', z: HERO_Z, data: { skin: 'default' } });
        if (rig) e.rigOk = true;
      } catch (err) {
        e.rigOk = false;
      }
    }
  }

  function enqueueDialog(e, text, opts = {}) {
    if (!text) return;
    if (root.DialogAPI?.enqueue) {
      root.DialogAPI.enqueue(e, text, opts);
    } else if (root.DialogAPI?.showForEntity) {
      root.DialogAPI.showForEntity(e, text, opts);
    }
  }

  function applyConfusionDebuffs(player, source) {
    if (!player) return;
    if (root.DebuffAPI?.applyConfusion) {
      root.DebuffAPI.applyConfusion(player, { duration: 2.0, source });
    } else if (root.StatusAPI?.apply) {
      root.StatusAPI.apply(player, 'confused', 2.0, { source });
    }
    if (root.DebuffAPI?.applySlow) {
      root.DebuffAPI.applySlow(player, { duration: 1.5, factor: 0.6, source });
    }
  }

  function playTalkLine(e, aggressive = false) {
    const list = aggressive ? LINES_AGGRO : LINES_SOFT;
    enqueueDialog(e, pick(list), aggressive ? { priority: 'high' } : { priority: 'normal' });
  }

  function idleWander(e, dt) {
    e._wanderTimer -= dt;
    if (e._wanderTimer <= 0) {
      e._wanderTimer = randRange(1.5, 3.5);
      e._wanderDir = Math.random() * Math.PI * 2;
      if (Math.random() < 0.4) {
        e.vx = 0;
        e.vy = 0;
        return;
      }
    }
    if (!Number.isFinite(e._wanderDir)) e._wanderDir = Math.random() * Math.PI * 2;
    const speed = IDLE_WANDER_SPEED;
    e.vx = Math.cos(e._wanderDir) * speed;
    e.vy = Math.sin(e._wanderDir) * speed;
  }

  function approachPlayer(e, player) {
    const dx = (player?.x || 0) - e.x;
    const dy = (player?.y || 0) - e.y;
    const len = Math.hypot(dx, dy) || 1;
    const speed = APPROACH_SPEED;
    e.vx = (dx / len) * speed;
    e.vy = (dy / len) * speed;
    if (Math.abs(e.vx) > Math.abs(e.vy)) {
      e.state = 'walk_h';
    } else {
      e.state = 'walk_v';
    }
  }

  function updateIdleState(e) {
    if (Math.abs(e.vx) < 0.01 && Math.abs(e.vy) < 0.01) {
      e.state = e.state === 'talk' ? 'talk' : 'idle';
      return;
    }
    if (Math.abs(e.vx) > Math.abs(e.vy)) e.state = 'walk_h'; else e.state = 'walk_v';
  }

  function visitorAnnoyingAiUpdate(e, dt = 0) {
    if (!e || e.dead) {
      if (e?.dead && !e._notifiedSpawner && root.SpawnerAPI?.notifyDeath) {
        root.SpawnerAPI.notifyDeath({ entity: e, populationType: 'humans', templateId: 'visitor_annoying' });
        e._notifiedSpawner = true;
      }
      return;
    }
    if (e._culled) return;

    e._touchCD = Math.max(0, (e._touchCD || 0) - dt);
    e._talkCD = Math.max(0, (e._talkCD || 0) - dt);
    e._bgTalkCD = Math.max(0, (e._bgTalkCD || 0) - dt);
    if (e._attackTimer > 0) e._attackTimer = Math.max(0, e._attackTimer - dt);

    const player = G.player;
    const dx = player ? player.x - e.x : 9999;
    const dy = player ? player.y - e.y : 9999;
    const dist = Math.hypot(dx, dy);

    if (player && dist < CHAT_RADIUS && !e.mode) {
      e.mode = 'approach';
    }

    if (!player || dist > CHAT_RADIUS * 1.2) {
      e.mode = 'idle';
    }

    if (e.mode === 'idle') {
      idleWander(e, dt);
      if (e._bgTalkCD <= 0) {
        e._bgTalkCD = BACKGROUND_COOLDOWN + Math.random() * 4;
        playTalkLine(e, false);
        e.state = 'talk';
      }
      updateIdleState(e);
    } else if (e.mode === 'approach') {
      if (dist <= CONVERSATION_DIST) {
        e.mode = 'chatting';
        e.vx = 0; e.vy = 0;
        e.state = 'talk';
      } else {
        approachPlayer(e, player);
      }
    } else if (e.mode === 'chatting') {
      e.vx = 5 * Math.cos(e._wanderDir || 0);
      e.vy = 5 * Math.sin(e._wanderDir || 0);
      e.state = 'talk';
      if (e._talkCD <= 0) {
        e._talkCD = randRange(TALK_COOLDOWN_MIN, TALK_COOLDOWN_MAX);
        playTalkLine(e, false);
        if (root.StatusAPI?.apply) {
          root.StatusAPI.apply(player, 'confused', 1.5, { source: e });
        }
      }
      if (dist < ATTACK_RADIUS && e._touchCD <= 0) {
        e.mode = 'attack';
      }
      if (!player || dist > CHAT_RADIUS) {
        e.mode = 'idle';
      }
    }

    if (e.mode === 'attack') {
      e.vx = 0;
      e.vy = 0;
      e.state = 'attack';
      if (player && e._touchCD <= 0) {
        const overlap = !(e.x + e.w * 0.5 <= player.x - player.w * 0.5
          || e.x - e.w * 0.5 >= player.x + player.w * 0.5
          || e.y + e.h * 0.5 <= player.y - player.h * 0.5
          || e.y - e.h * 0.5 >= player.y + player.h * 0.5);
        if (overlap) {
          e._touchCD = e.touchCooldown;
          e._attackTimer = ATTACK_RECOIL_TIME;
          applyConfusionDebuffs(player, e);
          playTalkLine(e, true);
        }
      }
      if (e._attackTimer <= 0) {
        e.mode = dist <= CONVERSATION_DIST ? 'chatting' : 'approach';
      }
    }

    e.x += e.vx * dt;
    e.y += e.vy * dt;

    if (root.PuppetAPI?.update && e.rig) {
      root.PuppetAPI.update(e.rig, dt, { moving: Math.abs(e.vx) + Math.abs(e.vy) > 1, face: e.dir });
    }
  }

  function spawnVisitorAnnoying(x, y, opts = {}) {
    ensureCollections();
    const e = {
      id: root.genId ? root.genId() : `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: ENT.VISITOR_ANNOYING,
      kindName: 'visitor_annoying',
      populationType: 'humans',
      role: 'npc',
      group: 'human',
      x,
      y,
      w: 24,
      h: 24,
      vx: 0,
      vy: 0,
      dir: 0,
      solid: true,
      health: opts.health ?? 3 * HP_PER_HEART,
      maxHealth: opts.maxHealth ?? 3 * HP_PER_HEART,
      touchDamage: 0,
      touchCooldown: 0.9,
      _touchCD: 0,
      fireImmune: false,
      state: 'idle',
      deathCause: null,
      puppet: { rig: 'npc_visitor_annoying', z: HERO_Z, skin: 'default' },
      mode: 'idle',
      _wanderTimer: randRange(0.5, 1.5),
      _wanderDir: Math.random() * Math.PI * 2,
      _bgTalkCD: BACKGROUND_COOLDOWN * Math.random(),
      _talkCD: randRange(TALK_COOLDOWN_MIN, TALK_COOLDOWN_MAX),
      _attackTimer: 0,
      aiUpdate: visitorAnnoyingAiUpdate,
    };

    attachRig(e);

    G.entities.push(e);
    G.npcs.push(e);
    G.movers.push(e);
    return e;
  }

  function spawnVisitorAnnoyingAtTile(tx, ty, opts = {}) {
    const pos = gridToWorldCenter(tx, ty);
    return spawnVisitorAnnoying(pos.x, pos.y, opts);
  }

  root.Entities = root.Entities || {};
  root.Entities.VisitorAnnoying = { spawn: spawnVisitorAnnoying, spawnAtTile: spawnVisitorAnnoyingAtTile, spawnFromAscii: spawnVisitorAnnoyingAtTile, ai: visitorAnnoyingAiUpdate };
  root.Entities.spawnVisitorAnnoyingAtTile = spawnVisitorAnnoyingAtTile;
  root.Entities.spawnVisitorAnnoyingFromAscii = spawnVisitorAnnoyingAtTile;
})(window);
