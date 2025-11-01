(function(){
  const API = window.PuppetAPI; if (!API) return;

  const TAU = Math.PI * 2;
  const Cache = Object.create(null);
  const IMG = (name) => `./assets/images/${name}`;

  function load(name){
    if (!Cache[name]){
      const img = new Image();
      img.src = IMG(name);
      Cache[name] = img;
    }
    return Cache[name];
  }

  function hasImage(img){
    return !!(img && img.complete && img.naturalWidth && img.naturalHeight);
  }

  function toScreen(cam, e){
    const zoom = cam.zoom || 1;
    const sx = (e.x - cam.x + cam.w * 0.5) * zoom + 0.5;
    const sy = (e.y - cam.y + cam.h * 0.5) * zoom + 0.5;
    const zscale = (e.puppet?.zscale || 1) * (e.puppet?.scale || 1) * zoom;
    return { sx, sy, sc: zscale };
  }

  function shadow(ctx, scale, radius = 12){
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000';
    ctx.scale(1, 0.35);
    ctx.beginPath();
    ctx.arc(0, 0, radius * scale, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const bob = (t, speed = 2, amp = 3) => Math.sin(t * speed) * amp;
  const pulse = (t, speed = 1) => (Math.sin(t * speed) + 1) * 0.5;

  function randomPhase(e, key){
    if (!e) return 0;
    const prop = `_rigPhase_${key}`;
    if (typeof e[prop] !== 'number') e[prop] = Math.random() * TAU;
    return e[prop];
  }

  function drawImageOrRect(ctx, img, x, y, w, h, fallback){
    if (hasImage(img)){
      ctx.drawImage(img, x, y, w, h);
    } else if (fallback){
      fallback();
    } else {
      ctx.fillStyle = '#ccc';
      ctx.fillRect(x, y, w, h);
    }
  }

  // ───────────────────────────────── HEROES ─────────────────────────────────
  const HERO_COMMON = {
    skin: '#edc2a3',
    eyes: '#2b2b2b'
  };

  function currentStateTag(e){
    if (!e) return '';
    if (typeof e.state === 'string') return e.state;
    if (typeof e.state === 'object' && e.state && typeof e.state.name === 'string') return e.state.name;
    if (typeof e.mode === 'string') return e.mode;
    if (typeof e.action === 'string') return e.action;
    if (typeof e.anim === 'string') return e.anim;
    return '';
  }

  function makeHeroRig(name, cfg){
    function createState(){
      return {
        phase: Math.random() * TAU,
        anim: cfg.animations.idle,
        animTime: 0,
        flip: false,
        lean: 0,
        bob: 0,
        stepA: 0,
        stepB: 0,
        hurtPhase: 0,
        dieProgress: 0,
        interactProgress: 0
      };
    }

    function resolveAnimation(st, e){
      const state = currentStateTag(e).toLowerCase();
      const speed = Math.hypot(e?.vx || 0, e?.vy || 0);
      const isDead = !!(e?.dead || (typeof e?.hp === 'number' && e.hp <= 0) || (typeof e?.health === 'number' && e.health <= 0));
      const isHurt = !isDead && ((typeof e?.invuln === 'number' && e.invuln > 0.05) || state.includes('hurt'));
      const wantsInteract = state.includes('interact') || state.includes('use');
      const wantsDodge = state.includes('dodge') || state.includes('evade') || e?.dodging;
      const wantsAttack = state.includes('attack') || state.includes('hit');

      if (isDead) return cfg.animations.die;
      if (isHurt && cfg.animations.hurt) return cfg.animations.hurt;
      if (wantsDodge && cfg.animations.dodge) return cfg.animations.dodge;
      if (wantsInteract && cfg.animations.interact) return cfg.animations.interact;
      if (wantsAttack && cfg.animations.attack) return cfg.animations.attack;
      if (speed > (cfg.thresholds.run || 180)) return cfg.animations.run;
      if (speed > (cfg.thresholds.walk || 25)) return cfg.animations.walk;
      return cfg.animations.idle;
    }

    function updateState(st, e, dt){
      const anim = resolveAnimation(st, e);
      if (st.anim !== anim){
        st.anim = anim;
        st.animTime = 0;
      } else {
        st.animTime += dt;
      }

      st.phase = (st.phase + dt * cfg.cycleSpeed) % TAU;
      st.flip = e?.flipX || (e?.dir && e.dir.x < 0);

      const meta = cfg.meta[st.anim] || cfg.meta.default;
      const bobSpeed = meta?.bobSpeed ?? cfg.meta.default.bobSpeed;
      const bobAmp = meta?.bobAmp ?? cfg.meta.default.bobAmp;
      st.bob = Math.sin(st.animTime * bobSpeed) * bobAmp;
      const stepSpeed = meta?.stepSpeed ?? 0;
      const stepAmp = meta?.stepAmp ?? 0;
      st.stepA = Math.sin(st.animTime * stepSpeed) * stepAmp;
      st.stepB = Math.sin(st.animTime * stepSpeed + Math.PI) * stepAmp;
      st.lean = meta?.lean ?? 0;

      if (st.anim === cfg.animations.hurt){
        st.hurtPhase = clamp(st.animTime / 0.3, 0, 1);
      } else {
        st.hurtPhase = Math.max(0, st.hurtPhase - dt * 2);
      }

      if (st.anim === cfg.animations.die){
        st.dieProgress = clamp(st.dieProgress + dt * 0.7, 0, 1);
      } else if (st.dieProgress < 1) {
        st.dieProgress = Math.max(0, st.dieProgress - dt);
      }

      if (st.anim === cfg.animations.interact){
        st.interactProgress = clamp(st.interactProgress + dt * 3, 0, 1);
      } else {
        st.interactProgress = Math.max(0, st.interactProgress - dt * 4);
      }
    }

    function drawLimb(ctx, x, y, length, thickness, angle, color){
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.fillRect(-thickness * 0.5, -length, thickness, length);
      ctx.restore();
    }

    function drawHero(ctx, st, s){
      const bodyH = cfg.body.height * s;
      const bodyW = cfg.body.width * s;
      const legLength = cfg.legs.length * s;
      const armLength = cfg.arms.length * s;
      const limbWidth = cfg.legs.width * s;
      const armWidth = cfg.arms.width * s;
      const headRadius = cfg.head.radius * s;
      const hipY = -legLength;
      const chestOffset = hipY - bodyH * 0.4;

      const lean = st.lean;
      const bobY = st.bob * s;

      // shadow first
      shadow(ctx, s, cfg.shadowRadius);

      ctx.save();
      ctx.translate(0, bobY);
      ctx.rotate(lean);

      // dying collapse
      if (st.dieProgress > 0){
        const fall = st.dieProgress;
        ctx.rotate(lerp(0, -Math.PI * 0.5, fall));
        ctx.translate(0, lerp(0, legLength * 0.3, fall));
      }

      // legs
      const rearLegPhase = st.stepB * 0.6 * s;
      const frontLegPhase = st.stepA * 0.6 * s;
      const legSpread = cfg.legs.spread * s;
      drawLimb(ctx, -legSpread, 0, legLength, limbWidth, -rearLegPhase * 0.2, cfg.colors.pantsDark);
      drawLimb(ctx, legSpread, 0, legLength, limbWidth, frontLegPhase * 0.2, cfg.colors.pants);

      // torso
      ctx.save();
      ctx.translate(0, hipY);
      ctx.fillStyle = cfg.colors.torso;
      ctx.beginPath();
      ctx.moveTo(-bodyW * 0.6, 0);
      ctx.quadraticCurveTo(-bodyW * 0.7, chestOffset * 0.35, -bodyW * 0.4, chestOffset);
      ctx.lineTo(bodyW * 0.4, chestOffset);
      ctx.quadraticCurveTo(bodyW * 0.7, chestOffset * 0.35, bodyW * 0.6, 0);
      ctx.closePath();
      ctx.fill();

      if (cfg.colors.accent){
        ctx.fillStyle = cfg.colors.accent;
        ctx.fillRect(-bodyW * 0.2, chestOffset * 0.6, bodyW * 0.4, Math.abs(chestOffset) * 0.35);
      }

      // belt / detail
      ctx.fillStyle = cfg.colors.detail;
      ctx.fillRect(-bodyW * 0.5, chestOffset * 0.3, bodyW, bodyH * 0.12);

      // arms
      const armSwing = st.stepA * 0.35;
      const offhandSwing = st.stepB * 0.35;
      const hurtLean = st.hurtPhase > 0 ? lerp(0, -0.6, st.hurtPhase) : 0;
      const interactReach = st.interactProgress;
      drawLimb(ctx, bodyW * 0.5, chestOffset * 0.2, armLength, armWidth, armSwing + hurtLean, cfg.colors.sleeve);
      drawLimb(ctx, -bodyW * 0.5, chestOffset * 0.2, armLength, armWidth, offhandSwing - interactReach * 0.8, cfg.colors.sleeve);

      // forearms / hands simple circles
      ctx.fillStyle = HERO_COMMON.skin;
      ctx.beginPath(); ctx.arc(bodyW * 0.5 + Math.sin(armSwing) * armWidth * 0.5, chestOffset * 0.2 - armLength, armWidth * 0.55, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(-bodyW * 0.5 + Math.sin(offhandSwing - interactReach * 0.5) * armWidth * 0.5, chestOffset * 0.2 - armLength - interactReach * armLength * 0.4, armWidth * 0.55, 0, TAU); ctx.fill();

      // head
      ctx.save();
      ctx.translate(0, chestOffset - headRadius * 1.2);
      ctx.fillStyle = HERO_COMMON.skin;
      ctx.beginPath(); ctx.ellipse(0, 0, headRadius * 1.05, headRadius * 1.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = cfg.colors.hair;
      ctx.beginPath(); ctx.ellipse(0, -headRadius * 0.9, headRadius * 1.1, headRadius * 0.7, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = HERO_COMMON.eyes;
      const eyeOffset = cfg.head.eyesOffset * s;
      const blink = st.anim === cfg.animations.sleep ? 0 : 1;
      ctx.beginPath(); ctx.ellipse(-eyeOffset, 0, headRadius * 0.22, headRadius * 0.35 * blink, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(eyeOffset, 0, headRadius * 0.22, headRadius * 0.35 * blink, 0, 0, TAU); ctx.fill();
      ctx.restore();

      ctx.restore();
    }

    API.registerRig(name, {
      create: createState,
      update(st, e, dt){ updateState(st, e, dt); },
      draw(ctx, cam, e, st){
        if (!st) return;
        const { sx, sy, sc } = toScreen(cam, e);
        const baseScale = (e.scale || 1) * sc;
        ctx.save();
        ctx.translate(sx, sy);
        if (st.flip) ctx.scale(-1, 1);
        drawHero(ctx, st, baseScale);
        ctx.restore();
      }
    });
  }

  makeHeroRig('hero_enrique', {
    cycleSpeed: 1.2,
    thresholds: { walk: 20, run: 140 },
    shadowRadius: 14,
    animations: {
      idle: 'idle_heavy',
      walk: 'walk_heavy',
      run: 'run_heavy',
      interact: 'interact',
      hurt: 'hurt',
      die: 'die'
    },
    meta: {
      default: { bobSpeed: 1.2, bobAmp: 1.6, stepSpeed: 0, stepAmp: 0, lean: 0 },
      idle_heavy: { bobSpeed: 1.2, bobAmp: 1.8 },
      walk_heavy: { bobSpeed: 3, bobAmp: 1.4, stepSpeed: 6, stepAmp: 12, lean: 0.08 },
      run_heavy: { bobSpeed: 4.5, bobAmp: 1.8, stepSpeed: 8, stepAmp: 16, lean: 0.18 },
      interact: { bobSpeed: 2, bobAmp: 0.6, stepSpeed: 0, stepAmp: 0, lean: 0.02 },
      hurt: { bobSpeed: 10, bobAmp: 0.5 },
      die: { bobSpeed: 0, bobAmp: 0 }
    },
    body: { width: 20, height: 34 },
    legs: { length: 18, width: 6, spread: 7 },
    arms: { length: 18, width: 5 },
    head: { radius: 6.2, eyesOffset: 3.2 },
    colors: {
      torso: '#2e3c5e',
      accent: '#f6d05b',
      detail: '#1f2a40',
      sleeve: '#2e3c5e',
      pants: '#1f2235',
      pantsDark: '#151729',
      hair: '#3a2d24'
    }
  });

  makeHeroRig('hero_roberto', {
    cycleSpeed: 1.6,
    thresholds: { walk: 18, run: 190 },
    shadowRadius: 13,
    animations: {
      idle: 'idle_relaxed',
      walk: 'walk_light',
      run: 'run_sprint',
      dodge: 'dodge_step',
      hurt: 'hurt',
      die: 'die'
    },
    meta: {
      default: { bobSpeed: 1.4, bobAmp: 1.1, stepSpeed: 0, stepAmp: 0, lean: 0 },
      idle_relaxed: { bobSpeed: 1.8, bobAmp: 1.3, lean: 0.03 },
      walk_light: { bobSpeed: 3.4, bobAmp: 1.6, stepSpeed: 8, stepAmp: 11, lean: 0.12 },
      run_sprint: { bobSpeed: 4.8, bobAmp: 1.9, stepSpeed: 11, stepAmp: 16, lean: 0.28 },
      dodge_step: { bobSpeed: 9, bobAmp: 0.4, stepSpeed: 14, stepAmp: 18, lean: 0.35 },
      hurt: { bobSpeed: 11, bobAmp: 0.4 },
      die: { bobSpeed: 0, bobAmp: 0 }
    },
    body: { width: 16, height: 32 },
    legs: { length: 17, width: 5, spread: 6.2 },
    arms: { length: 17, width: 4.5 },
    head: { radius: 5.6, eyesOffset: 2.8 },
    colors: {
      torso: '#2b4b5f',
      accent: '#f49d42',
      detail: '#1d3340',
      sleeve: '#2b4b5f',
      pants: '#1e2938',
      pantsDark: '#101620',
      hair: '#241c18'
    }
  });

  makeHeroRig('hero_francesco', {
    cycleSpeed: 1.4,
    thresholds: { walk: 20, run: 165 },
    shadowRadius: 13.5,
    animations: {
      idle: 'idle_focus',
      walk: 'walk_mid',
      run: 'run_mid',
      interact: 'interact',
      hurt: 'hurt',
      die: 'die'
    },
    meta: {
      default: { bobSpeed: 1.3, bobAmp: 1.2, stepSpeed: 0, stepAmp: 0, lean: 0 },
      idle_focus: { bobSpeed: 1.6, bobAmp: 1.1, lean: 0.04 },
      walk_mid: { bobSpeed: 3.1, bobAmp: 1.5, stepSpeed: 7, stepAmp: 12, lean: 0.1 },
      run_mid: { bobSpeed: 4.4, bobAmp: 1.7, stepSpeed: 9, stepAmp: 14, lean: 0.18 },
      interact: { bobSpeed: 2.5, bobAmp: 0.8, stepSpeed: 0, stepAmp: 0, lean: 0.05 },
      hurt: { bobSpeed: 10, bobAmp: 0.5 },
      die: { bobSpeed: 0, bobAmp: 0 }
    },
    body: { width: 18, height: 33 },
    legs: { length: 18, width: 5.5, spread: 6.5 },
    arms: { length: 18, width: 4.8 },
    head: { radius: 5.9, eyesOffset: 3 },
    colors: {
      torso: '#304e7b',
      accent: '#4f8bd4',
      detail: '#263c60',
      sleeve: '#304e7b',
      pants: '#22324b',
      pantsDark: '#141c2d',
      hair: '#2f2c2b'
    }
  });

  // ───────────────────────────────── ENEMIGOS ───────────────────────────────
  const RAT_META = {
    default: { stepSpeed: 0, stepAmp: 0, tailSpeed: 3, tailAmp: 0.3, bobSpeed: 0, bobAmp: 0, sniffSpeed: 2, sniffAmp: 0.2, lean: -0.1 },
    idle_sniff: { stepSpeed: 4, stepAmp: 0.6, tailSpeed: 3.4, tailAmp: 0.45, bobSpeed: 2, bobAmp: 0.3, sniffSpeed: 2.8, sniffAmp: 0.6, lean: -0.05 },
    scurry: { stepSpeed: 13, stepAmp: 2.4, tailSpeed: 9, tailAmp: 1.2, bobSpeed: 12, bobAmp: 0.7, sniffSpeed: 0, sniffAmp: 0, lean: -0.28 },
    attack_bite: { stepSpeed: 14, stepAmp: 1.6, tailSpeed: 10, tailAmp: 1.4, bobSpeed: 10, bobAmp: 0.6, sniffSpeed: 0, sniffAmp: 0.2, lean: -0.18, lunge: 1.1 },
    hit_react: { stepSpeed: 8, stepAmp: 0.6, tailSpeed: 7, tailAmp: 1.2, bobSpeed: 14, bobAmp: 0.9, sniffSpeed: 0, sniffAmp: 0, lean: 0.22 },
    die_collapse: { stepSpeed: 0, stepAmp: 0, tailSpeed: 2, tailAmp: 0.1, bobSpeed: 0, bobAmp: 0, sniffSpeed: 0, sniffAmp: 0, lean: -0.8 }
  };

  function ratInitialState(e){
    const hp = (typeof e?.hp === 'number') ? e.hp : (typeof e?.health === 'number' ? e.health : 1);
    return {
      phase: Math.random() * TAU,
      anim: 'idle_sniff',
      animTime: 0,
      attackTimer: 0,
      attackDuration: 0.28,
      hitTimer: 0,
      dieProgress: 0,
      stepA: 0,
      stepB: 0,
      tail: 0,
      sniff: 0,
      bodyBob: 0,
      lunge: 0,
      bite: 0,
      lean: -0.1,
      prevHp: hp
    };
  }

  function enemyCenter(e){
    const x = (e?.x || 0) + (e?.w || 0) * 0.5;
    const y = (e?.y || 0) + (e?.h || 0) * 0.5;
    return { x, y };
  }

  function dist(a, b){
    const dx = (a?.x || 0) - (b?.x || 0);
    const dy = (a?.y || 0) - (b?.y || 0);
    return Math.hypot(dx, dy);
  }

  API.registerRig('enemy_rat', {
    create: ratInitialState,
    update(st, e, dt){
      st.phase = (st.phase + dt * 5) % TAU;
      st.animTime += dt;
      st.hitTimer = Math.max(0, st.hitTimer - dt);
      st.attackTimer = Math.max(0, st.attackTimer - dt);

      const hp = (typeof e?.hp === 'number') ? e.hp : (typeof e?.health === 'number' ? e.health : st.prevHp);
      if (hp < st.prevHp - 0.01) st.hitTimer = 0.35;
      st.prevHp = hp;

      const player = window.G?.player;
      if (player && !e?.dead){
        const myCenter = enemyCenter(e);
        const plCenter = enemyCenter(player);
        const distance = dist(myCenter, plCenter);
        if (distance < 28){
          st.attackTimer = Math.max(st.attackTimer, st.attackDuration);
        }
      }

      const speed = Math.hypot(e?.vx || 0, e?.vy || 0);
      const stateName = currentStateTag(e).toLowerCase();

      let anim = st.anim;
      if (e?.dead || hp <= 0) anim = 'die_collapse';
      else if (st.hitTimer > 0) anim = 'hit_react';
      else if (stateName.includes('attack')) anim = 'attack_bite';
      else if (st.attackTimer > 0) anim = 'attack_bite';
      else if (speed > 32) anim = 'scurry';
      else anim = 'idle_sniff';

      if (anim !== st.anim){
        st.anim = anim;
        st.animTime = 0;
      }

      const meta = RAT_META[st.anim] || RAT_META.default;
      const stepSpeed = meta.stepSpeed || 0;
      const stepAmp = meta.stepAmp || 0;
      st.stepA = Math.sin(st.animTime * stepSpeed) * stepAmp;
      st.stepB = Math.sin(st.animTime * stepSpeed + Math.PI) * stepAmp;
      const tailSpeed = meta.tailSpeed || 0;
      const tailAmp = meta.tailAmp || 0;
      st.tail = Math.sin(st.animTime * tailSpeed + st.phase) * tailAmp;
      st.bodyBob = Math.sin(st.animTime * (meta.bobSpeed || 0) + st.phase * 0.3) * (meta.bobAmp || 0);
      st.sniff = Math.sin(st.animTime * (meta.sniffSpeed || 0)) * (meta.sniffAmp || 0);
      st.lean = meta.lean || 0;

      if (st.anim === 'attack_bite'){
        const progress = 1 - clamp(st.attackTimer / st.attackDuration, 0, 1);
        const biteCurve = progress < 0.5 ? progress * 2 : Math.max(0, 1 - (progress - 0.5) * 2);
        st.bite = biteCurve;
        st.lunge = Math.sin(progress * Math.PI) * (meta.lunge || 0);
      } else {
        st.bite = 0;
        st.lunge = 0;
      }

      if (st.anim === 'die_collapse'){
        st.dieProgress = clamp(st.dieProgress + dt * 1.6, 0, 1);
      } else {
        st.dieProgress = Math.max(0, st.dieProgress - dt * 0.6);
      }
    },
    draw(ctx, cam, e, st){
      if (!st) return;
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc * 0.9;
      ctx.save();
      ctx.translate(sx, sy);

      shadow(ctx, s * 0.85, 10);

      ctx.save();
      const bob = st.bodyBob * s;
      const deathLean = lerp(0, -1.1, st.dieProgress);
      const hurtKick = st.hitTimer > 0 ? Math.sin((0.35 - st.hitTimer) * 22) * 0.18 : 0;
      ctx.translate(0, -4 * s + bob - st.dieProgress * 4 * s);
      ctx.rotate(st.lean + deathLean + hurtKick);
      ctx.translate(st.lunge * 4 * s, 0);

      // Tail
      ctx.save();
      ctx.translate(-14 * s, -1 * s);
      ctx.rotate(st.tail * 0.25);
      ctx.strokeStyle = '#c48974';
      ctx.lineWidth = 2.2 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-10 * s, st.tail * 4 * s, -22 * s, st.tail * 7 * s);
      ctx.stroke();
      ctx.restore();

      // Body
      ctx.fillStyle = '#c9c3b5';
      ctx.beginPath();
      ctx.ellipse(0, 0, 15 * s, 8.5 * s, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#d8d4c9';
      ctx.beginPath();
      ctx.ellipse(1.5 * s, 2.2 * s, 10 * s, 5.2 * s, 0, 0, TAU);
      ctx.fill();

      // Legs
      ctx.fillStyle = '#f0ddd2';
      const lift = 2.1 * s;
      ctx.beginPath(); ctx.ellipse(7 * s, 7.5 * s - Math.max(0, st.stepA) * lift, 2.4 * s, 1.5 * s, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(3 * s, 7.8 * s - Math.max(0, st.stepB) * lift, 2.1 * s, 1.4 * s, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-4 * s, 7.8 * s - Math.max(0, st.stepB) * lift, 2.2 * s, 1.4 * s, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-8 * s, 7.5 * s - Math.max(0, st.stepA) * lift, 2.3 * s, 1.5 * s, 0, 0, TAU); ctx.fill();

      // Head
      const headX = 13.5 * s + st.lunge * 6 * s;
      const headY = -1.6 * s + st.sniff * s;
      const headR = 6 * s;
      ctx.fillStyle = '#c9c3b5';
      ctx.beginPath(); ctx.ellipse(headX, headY, headR, headR * 0.88, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#eab0b5';
      ctx.beginPath(); ctx.ellipse(headX - 4 * s, headY - 4.8 * s, 2.6 * s, 2.6 * s, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(headX + 4.6 * s, headY - 4.4 * s, 2.4 * s, 2.4 * s, 0, 0, TAU); ctx.fill();

      // Nose / bite
      const biteOpen = st.bite * 3 * s;
      ctx.fillStyle = '#d98c8f';
      ctx.beginPath();
      ctx.moveTo(headX + headR * 0.9, headY - biteOpen * 0.4);
      ctx.lineTo(headX + headR * 1.4, headY - biteOpen);
      ctx.lineTo(headX + headR * 1.4, headY + biteOpen);
      ctx.lineTo(headX + headR * 0.9, headY + biteOpen * 0.4);
      ctx.closePath();
      ctx.fill();

      // Eye
      ctx.fillStyle = '#2a2a2a';
      ctx.beginPath(); ctx.ellipse(headX + 1.6 * s, headY - 0.4 * s, 0.9 * s, 1.2 * s, 0, 0, TAU); ctx.fill();

      // Whiskers
      ctx.strokeStyle = '#5c5c5c';
      ctx.lineWidth = 1.1 * s;
      ctx.beginPath();
      ctx.moveTo(headX + 4.6 * s, headY - 0.8 * s);
      ctx.lineTo(headX + 10 * s, headY - 2.4 * s);
      ctx.moveTo(headX + 4.6 * s, headY - 0.2 * s);
      ctx.lineTo(headX + 10.5 * s, headY - 0.2 * s);
      ctx.moveTo(headX + 4.6 * s, headY + 0.4 * s);
      ctx.lineTo(headX + 10 * s, headY + 1.8 * s);
      ctx.stroke();

      ctx.restore();
      ctx.restore();
    }
  });

  const MOSQUITO_META = {
    default: { wingSpeed: 20, wingAmp: 0.8, bobSpeed: 6, bobAmp: 4, lean: 0 },
    hover: { wingSpeed: 22, wingAmp: 1.1, bobSpeed: 6, bobAmp: 5.2, lean: 0 },
    sting: { wingSpeed: 26, wingAmp: 1.4, bobSpeed: 12, bobAmp: 2.6, lean: 0.28 },
    hit_react: { wingSpeed: 32, wingAmp: 1.8, bobSpeed: 18, bobAmp: 1.6, lean: -0.35 },
    die_fall: { wingSpeed: 4, wingAmp: 0.5, bobSpeed: 2, bobAmp: 0, lean: 0 }
  };

  function mosquitoInitialState(){
    return {
      phase: Math.random() * TAU,
      anim: 'hover',
      animTime: 0,
      stingTimer: 0,
      stingDuration: 0.36,
      hitTimer: 0,
      dieProgress: 0,
      fallOffset: 0,
      spin: 0,
      wing: 0,
      bob: 0,
      lean: 0,
      stingReach: 0
    };
  }

  API.registerRig('enemy_mosquito', {
    create: mosquitoInitialState,
    update(st, e, dt){
      st.phase = (st.phase + dt * 6) % TAU;
      st.animTime += dt;
      st.hitTimer = Math.max(0, st.hitTimer - dt);
      st.stingTimer = Math.max(0, st.stingTimer - dt);

      const stateName = currentStateTag(e).toLowerCase();
      const speed = Math.hypot(e?.vx || 0, e?.vy || 0);
      const player = window.G?.player;
      if (player && !e?.dead){
        const myCenter = enemyCenter(e);
        const plCenter = enemyCenter(player);
        if (dist(myCenter, plCenter) < 36){
          st.stingTimer = Math.max(st.stingTimer, st.stingDuration);
        }
      }

      let anim = st.anim;
      if (e?.dead || (typeof e?.hp === 'number' && e.hp <= 0)) anim = 'die_fall';
      else if (st.hitTimer > 0 || stateName.includes('hit')) anim = 'hit_react';
      else if (stateName.includes('sting')) anim = 'sting';
      else if (st.stingTimer > 0 || speed > 70) anim = 'sting';
      else anim = 'hover';

      if (anim !== st.anim){
        st.anim = anim;
        st.animTime = 0;
      }

      const meta = MOSQUITO_META[st.anim] || MOSQUITO_META.default;
      st.wing = Math.sin(st.animTime * (meta.wingSpeed || 0) + st.phase) * (meta.wingAmp || 0);
      st.bob = Math.sin(st.animTime * (meta.bobSpeed || 0) + st.phase * 0.4) * (meta.bobAmp || 0);
      st.lean = meta.lean || 0;

      if (st.anim === 'sting'){
        const prog = 1 - clamp(st.stingTimer / st.stingDuration, 0, 1);
        st.stingReach = Math.sin(prog * Math.PI) * 6;
      } else {
        st.stingReach = 0;
      }

      if (st.anim === 'hit_react'){ st.hitTimer = Math.max(st.hitTimer, 0.2); }

      if (st.anim === 'die_fall'){
        st.dieProgress = clamp(st.dieProgress + dt * 1.2, 0, 1);
        st.fallOffset += dt * 30;
        st.spin += dt * 6;
      } else {
        st.dieProgress = Math.max(0, st.dieProgress - dt);
        st.fallOffset = Math.max(0, st.fallOffset - dt * 18);
        st.spin = Math.max(0, st.spin - dt * 4);
      }
    },
    draw(ctx, cam, e, st){
      if (!st) return;
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      ctx.save();
      ctx.translate(sx, sy - 8 * s + st.bob * s + st.fallOffset * s * 0.05);
      shadow(ctx, s * 0.7, 8);
      ctx.translate(0, -10 * s);

      const hitShake = st.hitTimer > 0 ? Math.sin((0.2 - st.hitTimer) * 50) * 0.15 : 0;
      ctx.rotate(st.lean + hitShake + st.spin * 0.4);

      // Body
      ctx.fillStyle = '#7a7a7a';
      ctx.beginPath();
      ctx.ellipse(-4 * s, 0, 5.8 * s, 3.2 * s, 0.2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#5d5d5d';
      ctx.beginPath();
      ctx.ellipse(2 * s, 0, 4.6 * s, 2.8 * s, -0.2, 0, TAU);
      ctx.fill();

      // Wings
      ctx.globalAlpha = 0.35 + 0.25 * Math.abs(st.wing);
      ctx.fillStyle = '#cfe8ff';
      ctx.beginPath();
      ctx.ellipse(-2.2 * s, -11 * s, 4.2 * s * (1 + st.wing * 0.25), 10 * s, -0.45, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(2.2 * s, -11 * s, 4.2 * s * (1 - st.wing * 0.25), 10 * s, 0.45, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Proboscis / sting
      const reach = (10 + st.stingReach) * s;
      ctx.strokeStyle = '#3b3b3b';
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath();
      ctx.moveTo(8 * s, 0);
      ctx.lineTo(8 * s + reach, st.stingReach * 0.2 * s);
      ctx.stroke();

      // Legs simple lines
      ctx.strokeStyle = 'rgba(60,60,60,0.8)';
      ctx.lineWidth = 1.1 * s;
      ctx.beginPath();
      ctx.moveTo(-3 * s, 2 * s);
      ctx.lineTo(-12 * s, 8 * s + st.wing * s);
      ctx.moveTo(0, 2 * s);
      ctx.lineTo(-8 * s, 10 * s - st.wing * s * 0.5);
      ctx.moveTo(3 * s, 2 * s);
      ctx.lineTo(6 * s, 8 * s);
      ctx.stroke();

      // Head
      ctx.fillStyle = '#545454';
      ctx.beginPath();
      ctx.ellipse(8 * s, -1 * s, 3.2 * s, 3.6 * s, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#2a2a2a';
      ctx.beginPath();
      ctx.ellipse(9.2 * s, -1.4 * s, 1.1 * s, 1.5 * s, 0, 0, TAU);
      ctx.fill();

      ctx.restore();
    }
  });

  // ─────────────────────────────── INFRAESTRUCTURA ─────────────────────────
  function doorProgress(e){
    const st = e.state || {};
    if (typeof st.openProgress === 'number') return clamp(st.openProgress, 0, 1);
    if (typeof e.open === 'number') return clamp(e.open, 0, 1);
    return e.open ? 1 : (st.open ? 1 : 0);
  }

  API.registerRig('door', {
    draw(ctx, cam, e){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const w = (e.w || 32) * s;
      const h = (e.h || 48) * s;
      const progress = doorProgress(e);
      const closed = load('puerta_cerrada.png');
      const opened = load('puerta_abiertas.png');
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      ctx.translate(0, -h * 0.5);
      if (hasImage(closed) || hasImage(opened)){
        ctx.globalAlpha = 1;
        if (hasImage(closed)){
          ctx.globalAlpha = 1 - progress;
          ctx.drawImage(closed, -w * 0.5, 0, w, h);
        }
        if (hasImage(opened)){
          ctx.globalAlpha = progress;
          ctx.drawImage(opened, -w * 0.5, 0, w, h);
        }
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = '#654321';
        ctx.fillRect(-w * 0.5, 0, w, h);
        ctx.fillStyle = '#b9b9b9';
        ctx.fillRect(-w * 0.45, h * 0.1 * (1 - progress), w * 0.9, h * (0.8 - 0.6 * progress));
      }
      ctx.restore();
    }
  });

  API.registerRig('elevator', {
    draw(ctx, cam, e){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const w = (e.w || 32) * s;
      const h = (e.h || 48) * s;
      const progress = doorProgress(e);
      const closed = load('ascensor_cerrado.png');
      const opened = load('ascensor_abierto.png');
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      ctx.translate(0, -h * 0.5);
      const slide = progress * 0.6;
      if (hasImage(closed) || hasImage(opened)){
        if (hasImage(closed)) ctx.drawImage(closed, -w * 0.5, 0, w, h);
        if (hasImage(opened)){
          const img = opened;
          const naturalW = img.naturalWidth || 2;
          const half = naturalW * 0.5;
          const naturalH = img.naturalHeight || 1;
          const leftDx = -w * 0.5 - slide * w * 0.5;
          const rightDx = slide * w * 0.5;
          ctx.drawImage(img, 0, 0, half, naturalH, leftDx, 0, w * 0.5, h);
          ctx.drawImage(img, half, 0, half, naturalH, rightDx, 0, w * 0.5, h);
        }
      } else {
        ctx.fillStyle = '#888';
        ctx.fillRect(-w * 0.5, 0, w, h);
        const leaf = w * 0.5;
        ctx.fillStyle = '#d9d9d9';
        ctx.fillRect(-leaf - slide * leaf, 0, leaf, h);
        ctx.fillRect(slide * leaf, 0, leaf, h);
      }
      ctx.restore();
    }
  });

  // ─────────────────────────────── CARROS ──────────────────────────────────
  function registerCart(name, imgName, opts){
    API.registerRig(`cart.${name}`, {
      draw(ctx, cam, e, t){
        const { sx, sy, sc } = toScreen(cam, e);
        const s = (e.scale || 1) * sc;
        const img = load(imgName);
        const w = (e.w || 32) * s;
        const h = (e.h || 42) * s;
        ctx.save();
        ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
        shadow(ctx, s, 14);
        ctx.translate(0, -h * 0.5 + (opts.offsetY || 0) * s);
        const phase = e.puppet?.data?.phase ?? randomPhase(e, name);
        const wobble = (opts.wobbleAmp || 0) * Math.sin(t * (opts.wobbleSpeed || 6) + phase);
        ctx.translate(0, wobble * s);
        drawImageOrRect(ctx, img, -w * 0.5, -h * 0.5, w, h, () => {
          ctx.fillStyle = '#b5b5b5';
          ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
        });
        if (opts.decor){ opts.decor(ctx, s, t, phase); }
        ctx.restore();
      }
    });
  }

  registerCart('emergency', 'carro_urgencias.png', {
    wobbleAmp: 1.5,
    wobbleSpeed: 8,
    decor(ctx, s, t){
      const blink = pulse(t, 8);
      ctx.save();
      ctx.translate(0, -18 * s);
      ctx.fillStyle = `rgba(255,64,64,${0.6 + 0.4 * blink})`;
      ctx.beginPath(); ctx.ellipse(-8 * s, 0, 5 * s, 3 * s, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = `rgba(64,160,255,${0.6 + 0.4 * (1 - blink)})`;
      ctx.beginPath(); ctx.ellipse(8 * s, 0, 5 * s, 3 * s, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  });

  registerCart('food', 'carro_comida.png', {
    wobbleAmp: 2.2,
    wobbleSpeed: 5,
    decor(ctx, s, t, phase){
      ctx.save();
      ctx.translate(0, -10 * s);
      const jitter = Math.sin(t * 12 + phase) * 0.8 * s;
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-10 * s, jitter, 20 * s, 3 * s);
      ctx.fillRect(-9 * s, -6 * s - jitter, 18 * s, 2.4 * s);
      ctx.restore();
    }
  });

  registerCart('meds', 'carro_medicinas.png', {
    wobbleAmp: 1.0,
    wobbleSpeed: 4.5,
    decor(ctx, s, t){
      const pulseV = 0.6 + 0.4 * pulse(t, 6);
      ctx.save();
      ctx.translate(0, -14 * s);
      ctx.fillStyle = `rgba(255,255,255,${pulseV})`;
      ctx.fillRect(-6 * s, -6 * s, 12 * s, 12 * s);
      ctx.fillStyle = `rgba(220,40,60,${pulseV})`;
      ctx.fillRect(-2 * s, -6 * s, 4 * s, 12 * s);
      ctx.fillRect(-6 * s, -2 * s, 12 * s, 4 * s);
      ctx.restore();
    }
  });

  // ─────────────────────────────── HAZARDS ──────────────────────────────────
  API.registerRig('hazard.fire', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const w = (e.w || 24) * s;
      const h = (e.h || 28) * s;
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      shadow(ctx, s, 8);
      ctx.translate(0, -h * 0.3);
      const flicker = 0.7 + 0.3 * Math.sin(t * 10 + randomPhase(e, 'fire'));
      const grad = ctx.createRadialGradient(0, 0, h * 0.1, 0, 0, h * 0.6);
      grad.addColorStop(0, `rgba(255,255,180,${0.9 * flicker})`);
      grad.addColorStop(0.4, `rgba(255,160,60,${0.8 * flicker})`);
      grad.addColorStop(1, 'rgba(120,30,10,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, -h * (0.4 + 0.1 * flicker));
      ctx.bezierCurveTo(w * 0.4, -h * 0.1, w * 0.3, h * 0.4, 0, h * 0.5);
      ctx.bezierCurveTo(-w * 0.3, h * 0.4, -w * 0.4, -h * 0.1, 0, -h * (0.4 + 0.1 * flicker));
      ctx.fill();
      ctx.restore();
    }
  });

  API.registerRig('hazard.water', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const w = (e.w || 26) * s;
      const h = (e.h || 26) * s;
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      shadow(ctx, s, 7);
      const ripple = 1 + 0.08 * Math.sin(t * 4 + randomPhase(e, 'water'));
      const grad = ctx.createRadialGradient(0, 0, h * 0.1, 0, 0, h * 0.6 * ripple);
      grad.addColorStop(0, 'rgba(150,200,255,0.6)');
      grad.addColorStop(0.7, 'rgba(90,140,220,0.4)');
      grad.addColorStop(1, 'rgba(90,140,220,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.ellipse(0, 0, w * 0.5 * ripple, h * 0.35 * ripple, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  });

  // ─────────────────────────────── LUCES ────────────────────────────────────
  API.registerRig('light', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const radius = (e.puppet?.data?.radius || 48) * (e.scale || 1) * (cam.zoom || 1);
      ctx.save();
      ctx.translate(sx, sy);
      const baseIntensity = e.puppet?.data?.intensity ?? 0.6;
      const flick = e.puppet?.data?.broken ? 0.3 + 0.7 * pulse(t, 12) : 1;
      const grad = ctx.createRadialGradient(0, 0, radius * 0.1, 0, 0, radius);
      grad.addColorStop(0, `rgba(255,255,200,${0.35 * baseIntensity * flick})`);
      grad.addColorStop(1, 'rgba(255,255,200,0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.fill();
      ctx.restore();
    }
  });

  // ─────────────────────────────── PACIENTES ───────────────────────────────
  function patientSkin(e){
    return e.puppet?.data?.skin || e.skin || 'paciente1.png';
  }

  API.registerRig('patient.std', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const img = load(patientSkin(e));
      const w = (e.w || 26) * s;
      const h = (e.h || 30) * s;
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      shadow(ctx, s, 10);
      const breath = (e.attended ? 0.2 : 0.5) * Math.sin(t * 1.6 + randomPhase(e, 'breath'));
      ctx.translate(0, -h * 0.45 + breath);
      drawImageOrRect(ctx, img, -w * 0.5, -h * 0.5, w, h, () => {
        ctx.fillStyle = '#d1c5b3';
        ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
      });
      ctx.restore();
    }
  });

  API.registerRig('patient.furiosa', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const img = load('paciente_furiosa.png');
      const w = (e.w || 26) * s;
      const h = (e.h || 30) * s;
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      shadow(ctx, s, 11);
      ctx.translate(0, -h * 0.45);
      ctx.rotate(Math.sin(t * 8) * 0.04);
      const jitter = Math.sin(t * 14 + randomPhase(e, 'fury')) * 2 * s;
      drawImageOrRect(ctx, img, -w * 0.5, -h * 0.5 + jitter, w, h, () => {
        ctx.fillStyle = '#ff6a6a';
        ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
      });
      ctx.restore();
    }
  });

  // ─────────────────────────────── ÍTEMS ───────────────────────────────────
  function registerPillRig(name){
    API.registerRig(`pill.${name}`, {
      draw(ctx, cam, e, t){
        const { sx, sy, sc } = toScreen(cam, e);
        const s = (e.scale || 1) * sc;
        const img = load(`pastilla_${name}.png`);
        const w = (e.w || 14) * s;
        const h = (e.h || 14) * s;
        ctx.save();
        ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
        const swing = Math.sin(t * 4 + randomPhase(e, `pill_${name}`)) * 0.25;
        ctx.rotate(swing);
        ctx.translate(0, -5 * s + Math.sin(t * 2) * 2 * s);
        drawImageOrRect(ctx, img, -w * 0.5, -h * 0.5, w, h, () => {
          ctx.fillStyle = '#fef2b8';
          ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
        });
        ctx.restore();
      }
    });
  }

  const pillVariants = [
    'analgesico', 'antibiotico', 'ansiolitico', 'antipsicotico', 'diuretico', 'anticoagulante', 'broncodilat',
    'analitica', 'azul', 'gaviscon', 'luzon', 'patoplast', 'tillaout', 'zenidina', 'final'
  ];
  pillVariants.forEach(registerPillRig);

  function registerSyringe(color, file){
    API.registerRig(`syringe.${color}`, {
      draw(ctx, cam, e, t){
        const { sx, sy, sc } = toScreen(cam, e);
        const s = (e.scale || 1) * sc;
        const img = load(file);
        const w = (e.w || 16) * s;
        const h = (e.h || 32) * s;
        ctx.save();
        ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
        shadow(ctx, s, 8);
        ctx.translate(0, -8 * s);
        ctx.rotate(Math.sin(t * 1.8 + randomPhase(e, `syringe_${color}`)) * 0.2);
        drawImageOrRect(ctx, img, -w * 0.5, -h * 0.5, w, h, () => {
          ctx.fillStyle = '#d0d6dc';
          ctx.fillRect(-w * 0.3, -h * 0.5, w * 0.6, h);
        });
        ctx.restore();
      }
    });
  }

  registerSyringe('red', 'jeringa_roja.png');
  registerSyringe('blue', 'jeringa_azul.png');
  registerSyringe('green', 'jeringa_verde.png');

  function registerDrip(color, file){
    API.registerRig(`drip.${color}`, {
      draw(ctx, cam, e, t){
        const { sx, sy, sc } = toScreen(cam, e);
        const s = (e.scale || 1) * sc;
        const img = load(file);
        const w = (e.w || 18) * s;
        const h = (e.h || 36) * s;
        ctx.save();
        ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
        shadow(ctx, s, 9);
        ctx.translate(0, -10 * s);
        drawImageOrRect(ctx, img, -w * 0.5, -h * 0.5, w, h, () => {
          ctx.fillStyle = '#dbe5f5';
          ctx.fillRect(-w * 0.3, -h * 0.5, w * 0.6, h);
        });
        const drop = pulse(t, 2 + color.length) * 12 * s;
        ctx.fillStyle = 'rgba(180,220,255,0.8)';
        ctx.beginPath(); ctx.ellipse(0, drop, 3 * s, 4 * s, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
    });
  }

  registerDrip('red', 'gotero_rojo.png');
  registerDrip('blue', 'gotero_azul.png');
  registerDrip('green', 'gotero_verde.png');

  API.registerRig('phone', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const img = load('telefono.png');
      const w = (e.w || 22) * s;
      const h = (e.h || 28) * s;
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      const vib = Math.sin(t * 25 + randomPhase(e, 'phone')) * 2 * s;
      ctx.translate(vib, -6 * s);
      drawImageOrRect(ctx, img, -w * 0.5, -h * 0.5, w, h, () => {
        ctx.fillStyle = '#2b2d42';
        ctx.fillRect(-w * 0.5, -h * 0.5, w, h);
        ctx.fillStyle = '#8d99ae';
        ctx.fillRect(-w * 0.3, -h * 0.3, w * 0.6, h * 0.6);
      });
      ctx.restore();
    }
  });

  API.registerRig('spawner', {
    draw(ctx, cam, e, t){
      const { sx, sy, sc } = toScreen(cam, e);
      const s = (e.scale || 1) * sc;
      const type = (e.type || e.sub || '').toLowerCase();
      let file = 'spawner_enemigos.png';
      if (type.includes('cart')) file = 'spawner_carros.png';
      else if (type.includes('npc')) file = 'spawner_npc.png';
      const img = load(file);
      const w = (e.w || 26) * s;
      const h = (e.h || 26) * s;
      ctx.save();
      ctx.translate(sx + (e.w || 0) * 0.5 * sc, sy + (e.h || 0) * 0.5 * sc);
      shadow(ctx, s, 9);
      const pulseR = 1 + 0.1 * Math.sin(t * 3 + randomPhase(e, 'spawner'));
      ctx.globalAlpha = 0.85;
      drawImageOrRect(ctx, img, -w * 0.5 * pulseR, -h * 0.5 * pulseR, w * pulseR, h * pulseR, () => {
        ctx.fillStyle = 'rgba(120,160,255,0.4)';
        ctx.beginPath(); ctx.arc(0, 0, w * 0.4 * pulseR, 0, TAU); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `rgba(120,200,255,${0.6 + 0.3 * pulse(t, 4)})`;
      ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.arc(0, 0, w * 0.35 * pulseR, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  });
})();
