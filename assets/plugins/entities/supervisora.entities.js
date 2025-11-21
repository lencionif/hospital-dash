// filename: supervisora.entities.js
// Supervisora “papelitos negativos”: patrulla, deja notas y lanza acertijos.
// -------------------------------------------------------------------------
// • kind: 'npc_supervisora' con rig dedicado en Puppet.
// • IA con estados: patrol → talk → cooldown → dead.
// • Patrulla puntos concretos del hospital usando pathfinding en tiles.
// • Cada cierto tiempo deja un papelito “uff” negativo (item_uff_note).
// • Si choca con el héroe abre un diálogo con acertijos de enfermería.
// • Toda la animación cabe en 1 tile gracias al rig vectorial npc_supervisora.

(function (W) {
  'use strict';

  const G = W.G || (W.G = {});
  const ENT = (function ensureENT() {
    const e = W.ENT || (W.ENT = {});
    e.SUPERVISORA = e.SUPERVISORA || 'npc_supervisora';
    e.PLAYER = e.PLAYER || 1;
    return e;
  })();

  if (!W.Dialog && W.DialogAPI) W.Dialog = W.DialogAPI;

  const TILE = (typeof W.TILE_SIZE === 'number') ? W.TILE_SIZE : (W.TILE || 32);
  const DEBUG = () => !!(W.DEBUG_SUPERVISOR || W.DEBUG_AI || W.DEBUG_FORCE_ASCII);

  const CFG_DEFAULTS = {
    speed: 78,
    waitMin: 1.0,
    waitMax: 2.0,
    repathTime: 1.1,
    dropMin: 8,
    dropMax: 14,
    noteTTL: 26,
    penaltyScore: 25,
    patrolPoints: [
      { x: 11, y: 4, label: 'control de enfermería' },
      { x: 17, y: 4, label: 'pasillo central' },
      { x: 20, y: 9, label: 'habitación conflictiva' },
      { x: 14, y: 12, label: 'zona pacientes' },
      { x: 7, y: 8, label: 'retén de material' }
    ]
  };

  const supervisorRiddles = [
    {
      key: 'sup_riddle_1',
      ask: 'Paciente politrauma: ¿qué orden sigues en la valoración primaria?',
      hint: 'Piensa en las siglas del ATLS.',
      options: ['A-B-C-D-E', 'C-A-B-D-E', 'A-C-B-E-D'],
      correctIndex: 0
    },
    {
      key: 'sup_riddle_2',
      ask: 'Un drenaje torácico burbujea sin parar. ¿Qué compruebas primero?',
      hint: 'La causa suele estar muy cerca del paciente.',
      options: ['Sutura de inserción', 'Frasco colector', 'Presión negativa'],
      correctIndex: 0
    },
    {
      key: 'sup_riddle_3',
      ask: 'Paciente con riesgo de úlcera por presión en talones. ¿Qué haces?',
      hint: 'La descarga mecánica es prioritaria.',
      options: ['Cambiar apósito', 'Colocar taloneras y elevar talones', 'Aumentar analgesia'],
      correctIndex: 1
    },
    {
      key: 'sup_riddle_4',
      ask: '¿Cuál es la escala de valoración del dolor recomendada en críticos intubados?',
      hint: 'Sus siglas terminan en "T" (Tool).',
      options: ['Glasgow', 'BPS', 'Escala EVA'],
      correctIndex: 1
    }
  ];

  const SupervisoraSystem = {
    cfg: Object.assign({}, CFG_DEFAULTS),
    list: [],
    notes: [],
    init(opts = {}) {
      Object.assign(this.cfg, opts || {});
      if (!Array.isArray(G.entities)) G.entities = [];
      if (!G.systems) G.systems = [];
      if (!this._registeredSystem) {
        try { W.AI?.registerSystem?.('SUPERVISORA', (_state, dt) => this.update(dt)); }
        catch (_) {}
        G.systems.push({ id: 'npc_supervisora', update: (dt) => this.update(dt) });
        this._registeredSystem = true;
      }
      return this;
    },
    spawn(x, y, props = {}) {
      const ent = createSupervisorEntity(x, y, props, this.cfg);
      this.list.push(ent);
      return ent;
    },
    update(dt = 0) {
      this.list = this.list.filter((e) => e && !e._removed);
      for (const ent of this.list) {
        try { updateSupervisor(ent, dt, this.cfg); }
        catch (err) { if (DEBUG()) console.warn('[SUPERVISOR] update error', err); }
      }
      updateNotes(dt, this.notes, this.cfg);
    }
  };

  function createSupervisorEntity(x, y, props, cfg) {
    const w = Math.round(TILE * 0.86);
    const h = Math.round(TILE * 0.94);
    const isTile = props?.tile === true;
    const px = isTile ? Math.round(x * TILE + TILE * 0.5 - w * 0.5) : Math.round(x);
    const py = isTile ? Math.round(y * TILE + TILE * 0.5 - h * 0.5) : Math.round(y);
    const ent = {
      id: props?.id || `supervisora_${Math.random().toString(36).slice(2)}`,
      kind: 'npc_supervisora',
      name: 'Supervisora',
      x: px,
      y: py,
      w,
      h,
      vx: 0,
      vy: 0,
      solid: true,
      pushable: false,
      dynamic: true,
      mass: 120,
      friction: 0.82,
      restitution: 0.05,
      mu: 0.18,
      skin: 'supervisora.png',
      anim: 'idle',
      npcAnim: 'idle',
      flashLight: false,
      group: 'human',
      ai: {
        state: 'patrol',
        dir: 'down',
        patrolIndex: 0,
        patrolRoute: buildPatrolRoute(props?.patrolPoints || cfg.patrolPoints),
        path: null,
        pathIndex: 0,
        pathGoal: null,
        repathTimer: 0,
        waitTimer: rand(cfg.waitMin, cfg.waitMax),
        dropTimer: rand(cfg.dropMin, cfg.dropMax),
        extraTimer: 0,
        cooldownTimer: 0,
        riddleIndex: 0,
        talkCooldown: 0,
        dialogActive: false,
        props: props || {}
      },
      onInteract(player) {
        startSupervisorDialogFromInteract(ent, player);
      }
    };

    if (!Array.isArray(G.entities)) G.entities = [];
    G.entities.push(ent);
    try { W.EntityGroups?.assign?.(ent); } catch (_) {}
    try { W.EntityGroups?.register?.(ent, G); } catch (_) {}
    try { W.AI?.attach?.(ent, 'SUPERVISORA'); } catch (_) {}
    try { W.MovementSystem?.register?.(ent); } catch (_) {}
    try {
      const puppet = W.Puppet?.bind?.(ent, 'npc_supervisora', { z: 0, scale: 1 })
        || W.PuppetAPI?.attach?.(ent, { rig: 'npc_supervisora', z: 0, scale: 1 });
      ent.puppet = puppet || ent.puppet;
      ent.rigOk = !!puppet;
    } catch (_) { ent.rigOk = false; }

    return ent;
  }

  function startSupervisorDialogFromInteract(ent, player) {
    if (!ent || !player) return;
    if (!rectsOverlap(ent, player)) return;
    const ai = ent.ai;
    if (!ai || ai.state === 'talk' || ai.state === 'dead' || ai.talkCooldown > 0) return;
    ai.state = 'talk';
    ai.talkCooldown = 12;
    ai.dialogActive = true;
    ent.vx = 0; ent.vy = 0;
    player.vx *= 0.2; player.vy *= 0.2;
    startSupervisorRiddleDialog(ent, player);
  }

  function updateSupervisor(ent, dt, cfg) {
    if (!ent) return;
    const ai = ent.ai || (ent.ai = {});
    ai.talkCooldown = Math.max(0, (ai.talkCooldown || 0) - dt);
    ai.cooldownTimer = Math.max(0, (ai.cooldownTimer || 0) - dt);
    ai.dropTimer = Math.max(0, (ai.dropTimer || 0) - dt);
    ai.extraTimer = Math.max(0, (ai.extraTimer || 0) - dt);
    if (ent.dead) {
      ai.state = 'dead';
      const cause = ent.deathCause || ent.lastDamageCause || ent.lastDamageKind || ent.deathBy || ent._deathCause || '';
      const anim = (cause && String(cause).includes('fire')) ? 'die_fire'
        : (cause && (String(cause).includes('crush') || String(cause).includes('aplast'))) ? 'die_crush'
        : 'die_hit';
      setAnim(ent, anim);
      ent.vx *= 0.8; ent.vy *= 0.8;
      return;
    }

    if (ai.state === 'talk') {
      setAnim(ent, 'talk');
      ent.isTalking = true;
      ent.vx *= 0.2; ent.vy *= 0.2;
      return;
    }

    if (ai.state === 'cooldown') {
      setAnim(ent, ai.extraTimer > 0 ? 'extra' : 'idle');
      ent.vx *= 0.6; ent.vy *= 0.6;
      if (ai.cooldownTimer <= 0) ai.state = 'patrol';
      return;
    }

    if (ai.state !== 'patrol') ai.state = 'patrol';

    updatePatrol(ent, dt, cfg);
    if (ai.dropTimer <= 0) {
      dropSupervisorNote(ent, cfg);
      ai.dropTimer = cfg.dropMin + Math.random() * (cfg.dropMax - cfg.dropMin);
    }

    const hero = G.player;
    if (hero && !hero.dead) {
      if (rectsOverlap(ent, hero) && ai.state === 'patrol' && ai.talkCooldown <= 0) {
        if (ai.state !== 'talk') {
          ai.state = 'talk';
          ai.dialogActive = true;
          ai.talkCooldown = 12;
          ent.vx = 0; ent.vy = 0;
          startSupervisorRiddleDialog(ent, hero);
        }
      }
    }
  }

  function updatePatrol(ent, dt, cfg) {
    const ai = ent.ai || (ent.ai = {});
    if (!Array.isArray(ai.patrolRoute) || !ai.patrolRoute.length) {
      ai.patrolRoute = buildPatrolRoute(cfg.patrolPoints);
      ai.patrolIndex = 0;
    }
    if (ai.waitTimer > 0) {
      ai.waitTimer = Math.max(0, ai.waitTimer - dt);
      ent.vx *= 0.4; ent.vy *= 0.4;
      setAnim(ent, ai.extraTimer > 0 ? 'extra' : 'idle');
      return;
    }

    const route = ai.patrolRoute;
    const idx = ai.patrolIndex % route.length;
    const target = route[idx];
    const c = center(ent);
    const here = { x: toTile(c.x), y: toTile(c.y) };
    ai.repathTimer = Math.max(0, (ai.repathTimer || 0) - dt);
    if (!ai.path || !ai.pathGoal || ai.pathGoal.x !== target.x || ai.pathGoal.y !== target.y || ai.repathTimer <= 0) {
      ai.path = bfsPath(here, target);
      ai.pathIndex = 0;
      ai.pathGoal = { x: target.x, y: target.y };
      ai.repathTimer = cfg.repathTime;
      // console.debug('[SUPERVISOR] patrol target', { id: ent.id, index: ai.patrolIndex });
    }

    const moved = moveAlongPath(ent, cfg.speed, dt);
    if (!moved) {
      const gx = target.x * TILE + TILE * 0.5;
      const gy = target.y * TILE + TILE * 0.5;
      const dx = gx - c.x;
      const dy = gy - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist < TILE * 0.3) {
        ai.patrolIndex = (ai.patrolIndex + 1) % route.length;
        ai.waitTimer = rand(cfg.waitMin, cfg.waitMax);
        ai.path = null;
      } else if (dist > 1) {
        const s = cfg.speed / (dist || 1);
        ent.vx = dx * s;
        ent.vy = dy * s;
      }
    }

    applyAnimFromVelocity(ent);
  }

  function moveAlongPath(ent, speed, dt) {
    const ai = ent.ai;
    if (!ai?.path || ai.pathIndex >= ai.path.length) return false;
    const step = ai.path[ai.pathIndex];
    const gx = step.x * TILE + TILE * 0.5;
    const gy = step.y * TILE + TILE * 0.5;
    const c = center(ent);
    const dx = gx - c.x;
    const dy = gy - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) {
      ai.pathIndex++;
      return ai.pathIndex < ai.path.length;
    }
    const inv = speed / (dist || 1);
    ent.vx = dx * inv;
    ent.vy = dy * inv;
    return true;
  }

  function dropSupervisorNote(ent, cfg) {
    const ai = ent.ai;
    if (DEBUG()) console.debug('[SUPERVISOR] drop note', { id: ent.id, x: ent.x|0, y: ent.y|0 });
    if (ai) ai.extraTimer = 0.6;
    setAnim(ent, 'extra');
    const note = spawnGameEntity('item_uff_note', {
      x: Math.round(ent.x + ent.w * 0.5),
      y: Math.round(ent.y + ent.h * 0.6),
      supervisorId: ent.id,
      ttl: cfg.noteTTL
    });
    if (note) {
      note.ttl = note.ttl ?? cfg.noteTTL;
      SupervisoraSystem.notes.push(note);
      if (!Array.isArray(G.entities)) G.entities = [];
      if (!G.entities.includes(note)) G.entities.push(note);
    }
  }

  function updateNotes(dt, notes, cfg) {
    if (!Array.isArray(notes) || !notes.length) return;
    const hero = G.player;
    for (let i = notes.length - 1; i >= 0; i--) {
      const note = notes[i];
      if (!note) { notes.splice(i, 1); continue; }
      note.ttl = (note.ttl ?? cfg.noteTTL) - dt;
      if (note.ttl <= 0 || note.dead) {
        removeNote(note);
        notes.splice(i, 1);
        continue;
      }
      if (hero && !hero.dead && rectsOverlap(note, hero)) {
        onNotePickup(note, hero, cfg);
        removeNote(note);
        notes.splice(i, 1);
      }
    }
  }

  function onNotePickup(note, hero, cfg) {
    W.HUD?.showFloatingMessage?.(hero, 'Has recibido una nota negativa de la supervisora', 1.8);
    if (typeof G.score === 'number') G.score = Math.max(0, G.score - (cfg.penaltyScore || 0));
    try { W.AudioAPI?.play?.('paper_pick', { volume: 0.45 }); } catch (_) {}
  }

  function removeNote(note) {
    if (!note) return;
    note.dead = true;
    const idx = G.entities ? G.entities.indexOf(note) : -1;
    if (idx >= 0) G.entities.splice(idx, 1);
    try { W.detachEntityRig?.(note); } catch (_) {}
    try { W.PuppetAPI?.detach?.(note); } catch (_) {}
  }

  function spawnGameEntity(kind, props) {
    if (typeof W.spawnEntity === 'function') {
      return W.spawnEntity(kind, props);
    }
    if (typeof W.Entities?.spawnEntity === 'function') {
      return W.Entities.spawnEntity(kind, props);
    }
    if (kind === 'item_uff_note') {
      const size = TILE * 0.4;
      return {
        id: `uff_note_${Math.random().toString(36).slice(2)}`,
        kind: 'item_uff_note',
        x: Math.round((props?.x || 0) - size * 0.5),
        y: Math.round((props?.y || 0) - size * 0.4),
        w: size,
        h: size * 0.6,
        ttl: props?.ttl ?? CFG_DEFAULTS.noteTTL,
        color: '#f8f3d8',
        supervisorId: props?.supervisorId || null,
        solid: false,
        static: true
      };
    }
    return null;
  }

  function startSupervisorRiddleDialog(ent, hero) {
    const ai = ent.ai || (ent.ai = {});
    const riddle = supervisorRiddles[ai.riddleIndex % supervisorRiddles.length];
    ai.riddleIndex = (ai.riddleIndex + 1) % supervisorRiddles.length;
    ai.dialogActive = true;
    ent.isTalking = true;
    if (hero) hero.isTalking = true;
    setAnim(ent, 'talk');
    if (DEBUG()) console.debug('[SUPERVISOR] start riddle', { heroId: hero?.id || 'hero' });

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      ai.dialogActive = false;
      ent.isTalking = false;
      if (hero && hero.isTalking) hero.isTalking = false;
      ai.cooldownTimer = Math.max(ai.cooldownTimer || 0, 1.2);
      ai.state = 'cooldown';
      onSupervisorDialogEnd(ent, hero);
    };
    const resolve = (correct) => {
      if (correct) {
        W.DialogAPI?.system?.('Respuesta impecable.', { ms: 1200 });
      } else {
        W.DialogAPI?.system?.('La supervisora anota tu error…', { ms: 1400 });
        if (typeof G.score === 'number') G.score = Math.max(0, G.score - 10);
      }
      finish();
    };

    if (!riddle) { finish(); return; }

    if (W.DialogAPI?.openRiddle) {
      W.DialogAPI.openRiddle({
        title: 'Supervisora',
        ask: riddle.ask,
        answers: [riddle.options[riddle.correctIndex]],
        hints: [riddle.hint],
        portraitCssVar: '--sprite-supervisora',
        allowEsc: false,
        onSuccess: () => resolve(true),
        onFail: () => resolve(false)
      });
      return;
    }

    const opened = W.DialogUtils?.openRiddleDialog?.({
      id: riddle.key,
      title: 'Supervisora',
      ask: riddle.ask,
      hint: riddle.hint,
      options: riddle.options,
      correctIndex: riddle.correctIndex,
      portraitCssVar: '--sprite-supervisora',
      onSuccess: () => resolve(true),
      onFail: () => resolve(false),
      onClose: finish
    });

    if (!opened) {
      finish(false);
    }
  }

  function onSupervisorDialogEnd(ent, hero) {
    if (!ent || ent.kind !== 'npc_supervisora') return;
    const ai = ent.ai || (ent.ai = {});
    ai.state = 'cooldown';
    ai.cooldownTimer = Math.max(ai.cooldownTimer || 0, 1.0);
    ent.isTalking = false;
    if (hero && hero.isTalking) hero.isTalking = false;
    setAnim(ent, 'idle');
    if (DEBUG()) console.debug('[SUPERVISOR] end riddle');
  }

  function applyAnimFromVelocity(ent) {
    const ai = ent.ai || {};
    if (ai.extraTimer > 0) {
      setAnim(ent, 'extra');
      return;
    }
    const spd = Math.hypot(ent.vx || 0, ent.vy || 0);
    if (ai.state === 'patrol' && spd > 1) {
      if (Math.abs(ent.vx) > Math.abs(ent.vy)) {
        ai.dir = ent.vx >= 0 ? 'right' : 'left';
        setAnim(ent, 'walk_side');
      } else if (ent.vy < 0) {
        ai.dir = 'up';
        setAnim(ent, 'walk_up');
      } else {
        ai.dir = 'down';
        setAnim(ent, 'walk_down');
      }
    } else {
      setAnim(ent, 'idle');
    }
  }

  function setAnim(ent, anim) {
    if (!anim || !ent) return;
    ent.anim = anim;
    ent.npcAnim = anim;
    if (ent.puppet?.state) ent.puppet.state.anim = anim;
  }

  function buildPatrolRoute(points) {
    if (!Array.isArray(points) || !points.length) return [ { x: 0, y: 0 } ];
    return points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  }

  function bfsPath(start, goal) {
    const grid = getGrid();
    const H = grid.length;
    const Wd = grid[0]?.length || 0;
    if (!H || !Wd) return null;
    const sx = clamp(start.x|0, 0, Wd - 1);
    const sy = clamp(start.y|0, 0, H - 1);
    const gx = clamp(goal.x|0, 0, Wd - 1);
    const gy = clamp(goal.y|0, 0, H - 1);
    const passable = (x, y) => grid[y] && grid[y][x] === 0;
    if (!passable(gx, gy)) return null;
    const queue = [[sx, sy]];
    const prev = new Map();
    const visited = new Set([`${sx},${sy}`]);
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    while (queue.length) {
      const [cx, cy] = queue.shift();
      if (cx === gx && cy === gy) break;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= Wd || ny >= H) continue;
        if (!passable(nx, ny)) continue;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        visited.add(key);
        prev.set(key, `${cx},${cy}`);
        queue.push([nx, ny]);
      }
    }
    const path = [];
    let key = `${gx},${gy}`;
    if (!prev.has(key) && !(sx === gx && sy === gy)) return null;
    path.unshift({ x: gx, y: gy });
    while (prev.has(key)) {
      const from = prev.get(key);
      const [fx, fy] = from.split(',').map(Number);
      path.unshift({ x: fx, y: fy });
      key = from;
    }
    return path;
  }

  function center(ent) {
    return { x: (ent.x || 0) + (ent.w || TILE) * 0.5, y: (ent.y || 0) + (ent.h || TILE) * 0.5 };
  }

  function rectsOverlap(a, b) {
    return a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function getGrid() {
    return G.collisionGrid || G.map || [];
  }

  function toTile(px) {
    return Math.max(0, Math.floor(px / TILE));
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function clamp(v, min, max) {
    return v < min ? min : (v > max ? max : v);
  }

  W.SupervisoraAPI = SupervisoraSystem;
  W.Entities = W.Entities || {};
  W.Entities.SupervisoraAPI = SupervisoraSystem;
  SupervisoraSystem.init();

})(this);
