// filename: objects.entities.js
// API de OBJETOS (power-ups, comida, monedas/bolsas) para “Il Divo: Hospital Dash!”
// Integración suave con tu engine actual: usa window.G/ENT/TILE_SIZE/moveWithCollisions si existen.
// Incluye: gestión de pickups, magnetismo (gotero verde), escudo 1 golpe (gotero azul),
// onda separadora (gotero rojo), jeringas (roja fuerza / azul velocidad / verde visión),
// comidas valencianas que curan, monedas/bolsas que dan puntos, tablas de drop y utilidades.

(function () {
  // ---------- Utilidades / entorno ----------
  const Items = {
    _G: null,
    _list: [],
    _pool: [],
    _cfg: null,
    _wrappedDamage: false,
    TYPES: {
      COIN: 'coin',
      BAG: 'bag',
      // Comidas
      FOOD_CREMAET: 'food-cremaet',
      FOOD_BOCADILLO: 'food-bocadillo',
      FOOD_BRAVAS: 'food-bravas',
      FOOD_OREJAS: 'food-orejas',
      FOOD_RABO: 'food-rabodetoro',
      FOOD_CALAMARES: 'food-calamares',
      FOOD_MORRO: 'food-morro',
      // Jeringas (buffs temporales)
      SYRINGE_RED: 'syringe-red',
      SYRINGE_BLUE: 'syringe-blue',
      SYRINGE_GREEN: 'syringe-green',
      // Goteros
      DRIP_RED: 'drip-red',     // Onda separadora instantánea
      DRIP_BLUE: 'drip-blue',   // Escudo (1 golpe)
      DRIP_GREEN: 'drip-green', // Imán de monedas
    },
  };

  function G() { return Items._G || window.G || (window.G = {}); }
  const ENT = (function () {
    const e = window.ENT || {};
    if (typeof e.ITEM === 'undefined') e.ITEM = 902;
    if (typeof e.PLAYER === 'undefined') e.PLAYER = 1;
    if (typeof e.ENEMY === 'undefined') e.ENEMY = 10;
    if (typeof e.NPC === 'undefined') e.NPC = 20;
    if (typeof e.WALL === 'undefined') e.WALL = 31;
    if (typeof e.DOOR === 'undefined') e.DOOR = 30;
    return e;
  })();
  const TILE = typeof window.TILE_SIZE !== 'undefined' ? window.TILE_SIZE : (window.TILE || 32);

  function aabbRect(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }
  function AABB(a, b) {
    if (typeof window.AABB === 'function') return window.AABB(a, b);
    return aabbRect(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h);
  }
  function isWallAt(x, y, w, h) {
    if (typeof window.isWallAt === 'function') return window.isWallAt(x, y, w, h);
    const map = G().map || [];
    const tx1 = Math.floor(x / TILE), ty1 = Math.floor(y / TILE);
    const tx2 = Math.floor((x + w - 1) / TILE), ty2 = Math.floor((y + h - 1) / TILE);
    for (let ty = ty1; ty <= ty2; ty++) {
      for (let tx = tx1; tx <= tx2; tx++) { if (map[ty]?.[tx] === 1) return true; }
    }
    return false;
  }
  function moveWithCollisions(e) {
    if (typeof window.moveWithCollisions === 'function') return window.moveWithCollisions(e);
    const sub = 2;
    for (let i = 0; i < sub; i++) {
      const sx = (e.vx || 0) / sub;
      const sy = (e.vy || 0) / sub;
      let nx = e.x + sx;
      if (isWallAt(nx, e.y, e.w, e.h)) { nx = e.x; e.vx = 0; }
      let ny = e.y + sy;
      if (isWallAt(nx, ny, e.w, e.h)) { ny = e.y; e.vy = 0; }
      e.x = nx; e.y = ny;
    }
    const f = Items._cfg.itemFriction;
    e.vx *= f; e.vy *= f;
    if (Math.abs(e.vx) < 0.01) e.vx = 0;
    if (Math.abs(e.vy) < 0.01) e.vy = 0;
  }
  function len(vx, vy) { return Math.hypot(vx || 0, vy || 0); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function randInt(a, b) { return (a|0) + Math.floor(Math.random() * ((b|0) - (a|0) + 1)); }
  function randChoice(arr) { return arr[(Math.random() * arr.length) | 0]; }

  // ---------- Config por defecto (se puede sobreescribir con BALANCE.items) ----------
  function resolveConfig() {
    const B = (G().BALANCE && G().BALANCE.items) ? G().BALANCE.items : null;
    return {
      // dimensiones y física básica de los items
      size: TILE * 0.6,
      itemSpeedCap: (B && B.itemSpeedCap) || 6,
      itemFriction: (B && B.itemFriction) || 0.90,
      bobAmplitude: (B && B.bobAmplitude) || 2,
      bobSpeed: (B && B.bobSpeed) || 2.2,
      // puntuación
      coinValue: (B && B.coinValue) || 1,
      bagValue: (B && B.bagValue) || 10,
      // curación
      heal: {
        'food-cremaet': (B && B.heal?.['food-cremaet']) || 0.5,
        'food-bocadillo': (B && B.heal?.['food-bocadillo']) || 1,
        'food-bravas': (B && B.heal?.['food-bravas']) || 0.5,
        'food-orejas': (B && B.heal?.['food-orejas']) || 1,
        'food-rabodetoro': (B && B.heal?.['food-rabodetoro']) || 1.5,
        'food-calamares': (B && B.heal?.['food-calamares']) || 1,
        'food-morro': (B && B.heal?.['food-morro']) || 1,
      },
      // power-ups: duraciones y magnitudes
      powerups: {
        'syringe-red':    { dur: (B && B.powerups?.['syringe-red']?.dur) || 12, pushMul: (B && B.powerups?.['syringe-red']?.pushMul) || 1.6 },
        'syringe-blue':   { dur: (B && B.powerups?.['syringe-blue']?.dur) || 12, speedMul:(B && B.powerups?.['syringe-blue']?.speedMul)|| 1.4 },
        'syringe-green':  { dur: (B && B.powerups?.['syringe-green']?.dur)|| 14, vision:  (B && B.powerups?.['syringe-green']?.vision) || 1.5 },
        'drip-green':     { dur: (B && B.powerups?.['drip-green']?.dur)     || 16, magnetRadius: (B && B.powerups?.['drip-green']?.magnetRadius) || (TILE*8), magnetAccel: 0.65 },
        'drip-blue':      { hits: (B && B.powerups?.['drip-blue']?.hits)    || 1 },
        'drip-red':       { radius: (B && B.powerups?.['drip-red']?.radius) || (TILE*5), force: (B && B.powerups?.['drip-red']?.force) || 8 },
      },
      pickupRadius: (B && B.pickupRadius) || (TILE * 0.65),
      // droptables
      drops: {
        common: [
          { k: 'coin', w: 40 }, { k: 'coin', w: 40 }, { k: 'bag', w: 10 },
          { k: 'food-bocadillo', w: 15 }, { k: 'food-bravas', w: 15 }, { k: 'food-cremaet', w: 15 },
        ],
        rare: [
          { k: 'syringe-red', w: 6 }, { k: 'syringe-blue', w: 6 }, { k: 'syringe-green', w: 6 },
          { k: 'drip-green', w: 5 }, { k: 'drip-blue', w: 5 }, { k: 'drip-red', w: 5 },
          { k: 'bag', w: 10 },
        ]
      },
      sfx: { pickup: 'pickup', coin: 'coin', power: 'power', eat: 'eat', shield: 'shield', wave: 'wave' },
    };
  }

  // ---------- API público ----------
  Items.init = function (Gref) {
    Items._G = Gref || window.G || (window.G = {});
    Items._cfg = resolveConfig();
    Items._list.length = 0;
    wrapDamagePlayerIfNeeded();
  };

  Items.update = function (dt) {
    const g = G();
    const cfg = Items._cfg || resolveConfig();
    const player = g.player;
    const movers = g.movers || g.entities || [];
    const list = Items._list;

    // Bob visual + movimiento (magnet) + colisiones suaves
    for (const it of list) {
      if (it._remove) continue;
      // Bobbing visual (se usa como offset en el renderer del engine si lo tenéis;
      // si no, queda listo por si lo queréis usar)
      it.bobT += dt * cfg.bobSpeed;
      if (it.bobT > Math.PI * 2) it.bobT -= Math.PI * 2;
      it.bob = Math.sin(it.bobT) * cfg.bobAmplitude;

      // Magnetismo activo hacia el jugador (solo monedas/bolsas por diseño)
      const magnetActive = (g.powerup && g.powerup.type === 'drip-green' && g.powerup.t > 0);
      const isMagnetizable = (it.itemType === Items.TYPES.COIN || it.itemType === Items.TYPES.BAG);
      if (magnetActive && player && isMagnetizable) {
        const mp = cfg.powerups['drip-green'];
        const cx = it.x + it.w * 0.5, cy = it.y + it.h * 0.5;
        const px = player.x + player.w * 0.5, py = player.y + player.h * 0.5;
        const dx = px - cx, dy = py - cy; const d = Math.hypot(dx, dy);
        if (d < (mp.magnetRadius || TILE * 8)) {
          const ax = (dx / (d || 1)) * (mp.magnetAccel || 0.6);
          const ay = (dy / (d || 1)) * (mp.magnetAccel || 0.6);
          it.vx = clamp((it.vx || 0) + ax, -cfg.itemSpeedCap, cfg.itemSpeedCap);
          it.vy = clamp((it.vy || 0) + ay, -cfg.itemSpeedCap, cfg.itemSpeedCap);
        }
      }

      // Mover con colisiones suaves
      moveWithCollisions(it);
    }

    // Pickups: si el jugador toca, se recoge
    if (player) {
      for (const it of list) {
        if (it._remove) continue;
        const pr = cfg.pickupRadius;
        const icx = it.x + it.w * 0.5, icy = it.y + it.h * 0.5;
        const pcx = player.x + player.w * 0.5, pcy = player.y + player.h * 0.5;
        const closeEnough = Math.hypot(icx - pcx, icy - pcy) <= pr + Math.max(it.w, it.h) * 0.25;
        if (closeEnough && AABB(player, it)) {
          applyPickup(it, player);
          markRemove(it);
        }
      }
    }

    // Limpieza diferida
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (!it._remove) continue;
      list.splice(i, 1);
      removeFromArray(movers, it);
      removeFromArray(g.entities, it);
      Items._pool.push(it);
    }

    // Ticking del power-up activo (UI/HUD lo puede leer de g.powerup)
    tickPowerUp(dt);
  };

  // Spawners
  Items.spawn = function (kind, x, y, opts = {}) {
    const cfg = Items._cfg || resolveConfig();
    const it = Items._pool.pop() || {};
    it.kind = ENT.ITEM;
    it.itemType = kind;
    it.spriteKey = spriteKeyFor(kind);
    it.x = Math.round(x);
    it.y = Math.round(y);
    it.w = Math.round(opts.w || cfg.size);
    it.h = Math.round(opts.h || cfg.size);
    it.vx = opts.vx || 0;
    it.vy = opts.vy || 0;
    it.bobT = Math.random() * Math.PI * 2;
    it.bob = 0;
    it._remove = false;
    it.static = false;
    it.pushable = false;
    const k = String(kind || '').toLowerCase();
    let rigName = null;
    const rigData = {};
    if (k.startsWith('syringe-')) {
      rigName = 'syringe';
      const color = k.split('-')[1] || '';
      const map = { red: 'jeringa_roja.png', blue: 'jeringa_azul.png', green: 'jeringa_verde.png' };
      rigData.skin = map[color] || `jeringa_${color}.png`;
    } else if (k.startsWith('drip-')) {
      rigName = 'drip';
      const color = k.split('-')[1] || '';
      const map = { red: 'gotero_rojo.png', blue: 'gotero_azul.png', green: 'gotero_verde.png' };
      rigData.skin = map[color] || `gotero_${color}.png`;
    } else if (k.startsWith('pill-')) {
      rigName = 'pill';
      const name = k.split('-')[1] || '';
      rigData.skin = `pastilla_${name}.png`;
    } else if (k === 'pill_final') {
      rigName = 'pill';
      rigData.skin = 'pastilla_final.png';
    } else if (k === 'phone' || k === 'telefono') {
      rigName = 'phone';
    }
    if (rigName) {
      try {
        const puppet = window.Puppet?.bind?.(it, rigName, { z: 0, scale: 1, data: rigData })
          || window.PuppetAPI?.attach?.(it, { rig: rigName, z: 0, scale: 1, data: rigData });
        if (puppet) {
          it.puppet = puppet;
          it.rig = puppet;
        }
        it.rigOk = it.rigOk === true || !!puppet;
      } catch (_) {
        it.rigOk = it.rigOk === true;
      }
    }
    // Inserción al engine
    const g = G();
    (g.entities || (g.entities = [])).push(it);
    (g.movers || (g.movers = [])).push(it);
    Items._list.push(it);
    return it;
  };

  Items.dropFrom = function (entity, quality = 'common', n = 1) {
    const g = G();
    const cfg = Items._cfg || resolveConfig();
    const table = (cfg.drops && cfg.drops[quality]) ? cfg.drops[quality] : cfg.drops.common;
    const cx = entity.x + entity.w * 0.5, cy = entity.y + entity.h * 0.5;
    for (let i = 0; i < n; i++) {
      const k = weightedPick(table);
      Items.spawn(k, cx + randInt(-8, 8), cy + randInt(-8, 8), { vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2 });
    }
  };

  Items.spawnRandom = function (x, y) {
    const cfg = Items._cfg || resolveConfig();
    const all = [
      Items.TYPES.COIN, Items.TYPES.BAG,
      Items.TYPES.FOOD_CREMAET, Items.TYPES.FOOD_BOCADILLO, Items.TYPES.FOOD_BRAVAS,
      Items.TYPES.FOOD_OREJAS, Items.TYPES.FOOD_RABO, Items.TYPES.FOOD_CALAMARES, Items.TYPES.FOOD_MORRO,
      Items.TYPES.SYRINGE_RED, Items.TYPES.SYRINGE_BLUE, Items.TYPES.SYRINGE_GREEN,
      Items.TYPES.DRIP_RED, Items.TYPES.DRIP_BLUE, Items.TYPES.DRIP_GREEN
    ];
    return Items.spawn(randChoice(all), x, y);
  };

  // ---------- Aplicación de efectos ----------
  function applyPickup(it, player) {
    const cfg = Items._cfg || resolveConfig();
    const k = it.itemType;
    // Monedas / bolsa
    if (k === Items.TYPES.COIN) { addScore(cfg.coinValue); sfx(cfg.sfx.coin, 0.7); return; }
    if (k === Items.TYPES.BAG)  { addScore(cfg.bagValue);  sfx(cfg.sfx.coin, 1.0); return; }

    // Comidas
    if (k.startsWith('food-')) {
      const heal = cfg.heal[k] || 1;
      healPlayer(heal);
      sfx(cfg.sfx.eat, 0.9);
      return;
    }

    // Jeringas
    if (k === Items.TYPES.SYRINGE_RED) {
      const p = cfg.powerups['syringe-red']; setPowerUp('syringe-red', p.dur, { pushMul: p.pushMul }); sfx(cfg.sfx.power, 1.0); return;
    }
    if (k === Items.TYPES.SYRINGE_BLUE) {
      const p = cfg.powerups['syringe-blue']; setPowerUp('syringe-blue', p.dur, { speedMul: p.speedMul }); sfx(cfg.sfx.power, 1.0); return;
    }
    if (k === Items.TYPES.SYRINGE_GREEN) {
      const p = cfg.powerups['syringe-green']; setPowerUp('syringe-green', p.dur, { vision: p.vision }); sfx(cfg.sfx.power, 1.0); return;
    }

    // Goteros
    if (k === Items.TYPES.DRIP_GREEN) {
      const p = cfg.powerups['drip-green']; setPowerUp('drip-green', p.dur, { magnetRadius: p.magnetRadius, magnetAccel: p.magnetAccel }); sfx(cfg.sfx.power, 1.0); return;
    }
    if (k === Items.TYPES.DRIP_BLUE) {
      const p = cfg.powerups['drip-blue']; giveShield(p.hits || 1); sfx(cfg.sfx.shield, 1.0); return;
    }
    if (k === Items.TYPES.DRIP_RED) {
      const p = cfg.powerups['drip-red']; emitWave(player.x + player.w*0.5, player.y + player.h*0.5, p.radius, p.force); sfx(cfg.sfx.wave, 1.0); return;
    }
  }

  function setPowerUp(type, duration, params = {}) {
    const g = G();
    // Reemplaza sin stack (diseño)
    g.powerup = { type, t: duration, params };
    // Adaptadores de stats temporales (el engine puede leer estos multiplicadores)
    const phys = window.Physics || null;
    const physCfg = phys ? (phys.PHYS || phys.DEFAULTS || {}) : {};
    const pushCfg = physCfg.pushMultipliers || {};
    const syringeMul = Number.isFinite(pushCfg.syringeRed) ? pushCfg.syringeRed : (params.pushMul || 1.6);
    g.pushMultiplier = (type === 'syringe-red') ? syringeMul : 1;
    g.speedMultiplier = (type === 'syringe-blue') ? (params.speedMul || 1.4) : 1;
    g.visionScale = (type === 'syringe-green') ? (params.vision || 1.5) : (g.visionScale || 1);
    // HUD opcional
    if (typeof g.setPowerupUI === 'function') g.setPowerupUI(type, duration);
  }

  function tickPowerUp(dt) {
    const g = G();
    if (!g.powerup) return;
    g.powerup.t -= dt;
    if (g.powerup.t <= 0) {
      // Expira: restaurar multiplicadores
      g.pushMultiplier = 1;
      g.speedMultiplier = 1;
      // La visión vuelve al baseline si el engine lo maneja
      // (no forzamos valor por si otro sistema ya lo controla)
      g.powerup = null;
      if (typeof g.clearPowerupUI === 'function') g.clearPowerupUI();
    } else {
      if (typeof g.updatePowerupUI === 'function') g.updatePowerupUI(g.powerup.type, g.powerup.t);
    }
  }

  function giveShield(hits) {
    const g = G();
    if (!g.player) return;
    g.player.shield = (g.player.shield || 0) + Math.max(1, hits|0);
    wrapDamagePlayerIfNeeded();
  }

  function emitWave(cx, cy, radius, force) {
    const g = G();
    const ents = g.entities || [];
    for (const e of ents) {
      if (!e || e.static) continue;
      if (e.kind === ENT.WALL || e.kind === ENT.DOOR) continue;
      // Sólo empujar empujables o enemigos/NPCs/camas/carros/…
      const pushable = e.pushable || e.kind === ENT.ENEMY || e.kind === ENT.NPC || e._tag === 'cart';
      if (!pushable) continue;
      const ex = e.x + e.w * 0.5, ey = e.y + e.h * 0.5;
      const dx = ex - cx, dy = ey - cy;
      const d = Math.hypot(dx, dy);
      if (d > radius || d === 0) continue;
      const k = 1 - (d / radius);
      const f = (force || 8) * (0.5 + k * 0.5);
      e.vx = (dx / d) * f;
      e.vy = (dy / d) * f;
    }
  }

  function addScore(v) {
    const g = G();
    g.score = (g.score || 0) + (v|0);
    if (typeof g.onScoreChange === 'function') g.onScoreChange(g.score);
  }

  function healPlayer(amountHearts) {
    const g = G(); if (!g.player) return;
    // Si el engine provee API de curación, úsala
    if (typeof g.healPlayer === 'function') { g.healPlayer(amountHearts); return; }
    // Fallback: hp basado en medios corazones (hp steps de 0.5)
    const maxHp = g.player.maxHp || 3;
    const cur = g.player.hp || maxHp;
    g.player.hp = clamp(cur + amountHearts, 0, maxHp);
    if (typeof g.updateHeartsUI === 'function') g.updateHeartsUI(g.player.hp, maxHp);
  }

  // ---------- Creación y utilidades de drop ----------
  function weightedPick(table) {
    let total = 0; for (const t of table) total += t.w || 1;
    let r = Math.random() * total;
    for (const t of table) { r -= (t.w || 1); if (r <= 0) return t.k; }
    return table[table.length - 1].k;
  }

  function spriteKeyFor(kind) {
    // Intenta usar el mismo nombre como clave de sprite para el SpriteManager.
    // Si no existe sprite, vuestro renderer cae a fallback geométrico sin romper.
    return kind;
  }

  function markRemove(it) { it._remove = true; }

  function removeFromArray(arr, item) {
    if (!arr) return;
    const i = arr.indexOf(item);
    if (i >= 0) arr.splice(i, 1);
  }

  // ---------- Audio helper ----------
  function sfx(name, gain = 1) {
    const g = G();
    const A = g.Audio || window.Audio;
    if (!A || !A.play) return;
    try { A.play(name, { gain }); } catch (_) {}
  }

  // ---------- Hook de daño para ESCUDO ----------
  function wrapDamagePlayerIfNeeded() {
    const g = G();
    if (Items._wrappedDamage) return;
    if (typeof g.damagePlayer !== 'function') return;
    const orig = g.damagePlayer;
    g.damagePlayer = function (dmg) {
      // Escudo 1 golpe: consume antes de aplicar daño real
      if (g.player && g.player.shield && g.player.shield > 0) {
        g.player.shield -= 1;
        sfx(Items._cfg.sfx.shield, 0.8);
        if (typeof g.flashShieldUI === 'function') g.flashShieldUI();
        return; // daño absorbido
      }
      return orig.call(g, dmg);
    };
    Items._wrappedDamage = true;
  }

  // ---------- Export ----------
  window.Items = Items;

  // ---------- Auto-init suave ----------
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => { if (!Items._cfg) Items.init(window.G); }, 0);
  } else {
    document.addEventListener('DOMContentLoaded', () => { if (!Items._cfg) Items.init(window.G); });
  }
})();
window.Entities = window.Entities || {};
window.ObjectsAPI = window.ObjectsAPI || {
  spawnPhone: (x,y,p)=> window.spawnPhone?.(x,y,p),
  spawnPill:  (sub,x,y,p)=> window.spawnPill?.(sub,x,y,p),
  spawnBell:  (x,y,p)=> window.spawnBell?.(x,y,p),
  spawnItem:  (sub,x,y,p)=> window.spawnItem?.(sub,x,y,p),
};
window.Entities.Objects = {
  spawnPhone: (x,y,p)=> ObjectsAPI.spawnPhone?.(x,y,p),
  spawnPill: (sub,x,y,p)=> ObjectsAPI.spawnPill?.(sub,x,y,p),
  spawnBell: (x,y,p)=> ObjectsAPI.spawnBell?.(x,y,p),
  spawnItem: (sub,x,y,p)=> ObjectsAPI.spawnItem?.(sub,x,y,p),
};