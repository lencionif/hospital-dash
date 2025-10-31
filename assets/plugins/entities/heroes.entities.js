// filename: heroes.entities.js
// Héroes para “Il Divo: Hospital Dash!”
//
// Francesco: linterna AZUL, 4 corazones, equilibrado, +visión
// Enrique:   linterna AMARILLA, 5 corazones, +fuerza, peor visión
// Roberto:   linterna NARANJA, 3 corazones, +velocidad, visión media
//
// Mantiene compat con tu motor: usa window.G/ENT/TILE_SIZE, LightingAPI y FogAPI si existen.
// Llamada de poblamiento: placement.plugin -> Entities.Hero.spawnPlayer(x,y,p)

(function () {
  'use strict';

  // ===== Helpers básicos / entorno =========================================================
  const W = window;
  const G = W.G || (W.G = {});
  const ENT = (function () {
    const e = W.ENT || {};
    if (typeof e.PLAYER === 'undefined') e.PLAYER = 1;
    if (typeof e.WALL   === 'undefined') e.WALL   = 31;
    if (typeof e.DOOR   === 'undefined') e.DOOR   = 30;
    return e;
  })();
  const TILE = (typeof W.TILE_SIZE !== 'undefined') ? W.TILE_SIZE : (W.TILE || 32);

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pushUnique(arr, x){ if (!Array.isArray(arr)) return; if (!arr.includes(x)) arr.push(x); }
  function aabb(a,b){ return a.x<a.bx && a.bx>b.x && a.y<a.by && a.by>b.y; }
  function rectFrom(e){ return { x:e.x, y:e.y, bx:e.x+e.w, by:e.y+e.h }; }

  // ===== Config balanceada por personaje ===================================================
  const MAX_HEARTS_LIMIT = 7; // por HUD
  const CFG = {
    // Visión base (en tiles, para Fog/luces internas)
    visionTiles: {
      enrique:   2,   // peor visión
      roberto:   4,   // media
      francesco: 6,   // mejor
    },
    // Corazones iniciales
    hearts: {
      enrique:   5,
      roberto:   3,
      francesco: 4,
    },
    // Stats: velocidad / aceleración / empuje / masa
    stats: {
      // Enrique: fuerte y lento
      enrique:   { maxSpeed: 145, accel: 700, push: 520, mass: 110 },
      // Roberto: rápido y más frágil
      roberto:   { maxSpeed: 205, accel: 900, push: 320, mass:  85 },
      // Francesco: equilibrado
      francesco: { maxSpeed: 175, accel: 800, push: 420, mass:  95 },
    },
    // Linterna por héroe (color + radios)
    light: {
      colors: {
        // AMARILLO para Enrique (antes era rojo)
        enrique:   'rgba(255, 215,  64, 0.55)', // #FFD740 aprox
        // NARANJA para Roberto (antes era verde)
        roberto:   'rgba(255, 150,  60, 0.55)',
        // AZUL para Francesco (igual que venía)
        francesco: 'rgba( 80, 120, 255, 0.55)',
      },
      // Radios “interior/exterior” en tiles (se escalan con visión del héroe)
      innerTiles: 3.6,
      outerTiles: 7.0,
      coneDeg: 80,       // si LightingAPI usa linterna cónica
      intensity: 0.95
    }
  };

  // ===== Núcleo de entidad jugador =========================================================
  function createPlayer(x, y, heroKey) {
    const key = (heroKey || 'francesco').toLowerCase();
    const stats = CFG.stats[key] || CFG.stats.francesco;
    const hearts = clamp(CFG.hearts[key] || 4, 1, MAX_HEARTS_LIMIT);

    const w = Math.round(TILE * 0.82), h = Math.round(TILE * 0.82);
    const p = {
      kind: ENT.PLAYER,
      tag: 'player',
      hero: key,
      x: Math.round(x), y: Math.round(y),
      w, h,
      vx: 0, vy: 0,
      ax: 0, ay: 0,
      // vida
      hp: hearts,
      hpMax: hearts,
      // físicas / empuje
      maxSpeed: stats.maxSpeed,
      accel: stats.accel,
      push: stats.push,
      mass: stats.mass,
      // estado
      dir: { x: 1, y: 0 },
      pushing: false,
      sprint: 1.0,
      // render / sprite
      spriteKey: key,     // sprites.plugin: "enrique.png", "roberto.png", "francesco.png"
      // orientación + giro suave de linterna/FOW
      facing: 'S',
      lookAngle: Math.PI / 2,  // 90º hacia abajo (sur)
      turnSpeed: 6.0,          // radianes/segundo (~143º/s) -> ajustable
      _facingHold: 0,          // anti-parpadeo de cardinales
      _flashlightId: null,
      _fogRange: null,
      _lastHitAt: 0,
      _destroyCbs: [],
      // util
      onDestroy(){ for(const fn of this._destroyCbs) try{ fn(); }catch(e){}; this._destroyCbs.length=0; },
    };
    return p;
  }

  function ensureOnArrays(e) {
    pushUnique(G.entities || (G.entities=[]), e);
    pushUnique(G.movers   || (G.movers=[]),   e);
    G.player = e;
  }

  // ===== Linterna y visión (Fog) ===========================================================
  function attachFlashlight(e) {
    // Colores por héroe
    const color = CFG.light.colors[e.hero] || CFG.light.colors.francesco;
    const scale = (CFG.visionTiles[e.hero] || CFG.visionTiles.francesco) / 4; // base 4=medio
    const inner = (CFG.light.innerTiles * TILE) * scale;
    const outer = (CFG.light.outerTiles * TILE) * scale;
    // Guarda en el jugador para que el motor pueda usarlos:
    e._visionTiles = (CFG.visionTiles[e.hero] || CFG.visionTiles.francesco);
    e._flashInner  = inner;
    e._flashOuter  = outer;

    // LightingAPI con linterna cónica (si existe)
    if (W.LightingAPI && typeof W.LightingAPI.addLight === 'function') {
      const id = W.LightingAPI.addLight({
        owner: e, type: 'player',
        color, intensity: CFG.light.intensity,
        radius: outer, innerRadius: inner,
        coneDeg: CFG.light.coneDeg
      });
      e._flashlightId = id;
      e._destroyCbs.push(() => { try { W.LightingAPI.removeLight(id); } catch(_){} });
    }

    // Fog-of-War (si existe, prioriza API de tu core)
    const vt = (CFG.visionTiles[e.hero] || CFG.visionTiles.francesco);
    if (W.FogAPI && typeof W.FogAPI.setPlayerVisionTiles === 'function') {
      try { W.FogAPI.setPlayerVisionTiles(vt); } catch(_){}
    } else {
      // Fallback: usa escala global si la manejas en el core
      G.visionScale = vt / 4; // 1.0 = visión media (4 tiles)
    }
  }

  // ===== Daño / curación ===========================================================
  function applyDamage(e, amount, source) {
    if (!e || e.dead) return;
    const t = Date.now();
    if (t - (e._lastHitAt||0) < 250) return; // i-frames cortos
    e._lastHitAt = t;

    e.hp = clamp(e.hp - Math.max(0, amount|0), 0, e.hpMax);
    if (e.hp <= 0) { e.dead = true; try{ e.onDestroy(); }catch(_){}; }
  }
  function heal(e, amount) {
    if (!e || e.dead) return;
    e.hp = clamp(e.hp + Math.max(0, amount||0), 0, e.hpMax);
  }

  // ===== API pública =======================================================================
  const Hero = {
    // Lee selección desde p.sub / p.skin o desde G.selectedHero
    resolveKey(p) {
      window.G = window.G || {};
      const q = new URLSearchParams(location.search);
      const qs = (q.get('hero') || '').toLowerCase();
      const k = (p?.skin || p?.sub || qs || G.selectedHero || 'francesco').toLowerCase();
      G.selectedHero = k; // persistimos la selección para el resto del motor
      return k;
    },

    // Punto de entrada del poblamiento (lo llama placement.plugin)
    // -> crea el jugador con la skin/stats adecuadas y lo inserta en G.entities
    spawnPlayer(x, y, p = {}) {
      const key = this.resolveKey(p);
      const e = createPlayer(x, y, key); G.selectedHero = key; window.selectedHeroKey = key; e.spriteKey = key;
      window.G = window.G || {};
      G.selectedHero = key;
      ensureOnArrays(e);
      attachFlashlight(e);
      try { console.log(`%cHERO spawn => ${key}`, 'color:#9cc2ff;font-weight:bold'); } catch(_){}
      return e;
    },

    // Seguidor opcional (compat con placement: type=follower, sub=...)
    spawnFollower(sub, x, y, p = {}) {
      const key = (sub || p.sub || 'francesco').toLowerCase();
      const e = createPlayer(x, y, key);
      e.tag = 'follower';
      e.hp = 1; e.hpMax = 1;
      ensureOnArrays(e);
      attachFlashlight(e);
      return e;
    },

    // Exponer utilidades (por si otras entidades las usan)
    applyDamage, heal,
  };

  W.Entities = W.Entities || {};
  W.Entities.Hero = Hero;
})();