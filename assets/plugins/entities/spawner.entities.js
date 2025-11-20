// filename: spawner.manager.js
// Gestor de re-spawns (enemigos, NPC y carros) SOLO tras muertes.
// - No puebla al inicio. Registra puntos de spawn y repone bajas con cooldown por punto.
// - Si mueren varias unidades (p.ej., 5 mosquitos y 2 ratas) reparte aleatorio entre spawners del tipo.
// - Cada spawner crea de una en una y entra en cooldown (default 180 s).
// - Si no hay spawners del tipo, las muertes quedan en cola global hasta que aparezcan.
//
// API principal:
//   SpawnerManager.init(G?)                           // opcional (autodetecta G)
//   SpawnerManager.registerPoint(type, x, y, opts?)   // registra punto (px por defecto; opts.inTiles para tiles)
//   SpawnerManager.reportDeath(type, sub, n=1)        // reportar muertes (type: 'enemy'|'npc'|'cart')
//   SpawnerManager.update(dt)                         // llama en tu bucle (o deja que se autoenganche)
//
// Atajos útiles de registro desde placements (opcionales):
//   SpawnerManager.registerFromPlacement({type:'spawn_animal', x,y, ...})
//
// Integración de muertes: en tus APIs de entidades, cuando muera alguien, llama a:
//   SpawnerManager.reportDeath('enemy','mosquito'|'rat')
//   SpawnerManager.reportDeath('npc','tcae'|'medico'|'supervisora'|'guardia'|...)
//   SpawnerManager.reportDeath('cart','food'|'med'|'er')

(function (W) {
  'use strict';
  const getGame = () => (W.G || (W.G = {}));
  const TILE = (typeof W.TILE_SIZE === 'number' ? W.TILE_SIZE : (typeof W.TILE === 'number' ? W.TILE : 32));
  const nowSec = () => (W.performance && performance.now ? performance.now() / 1000 : Date.now() / 1000);

  // ------------------ Estado interno ------------------
  const S = {
    spawners: { enemy: [], npc: [], cart: [] },   // por familia
    pending:  { enemy: [], npc: [], cart: [] },   // cola global si no hay puntos (array de subs)
    rng: Math.random,
    autoUpdateHooked: false
  };

  // ------------------ Utilidades ------------------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function randPick(arr) { return arr[(S.rng() * arr.length) | 0]; }
  function randRange(a, b) { return a + S.rng() * (b - a); }

  function ensureSystemsAutoUpdate() {
    if (S.autoUpdateHooked) return;
    // Se engancha de forma suave a tu bucle si usas G.systems
    const game = getGame();
    if (game && Array.isArray(game.systems)) {
      game.systems.push({ id: 'spawner_manager', update: (dt) => SpawnerManager.update(dt) });
      S.autoUpdateHooked = true;
    } else {
      // Fallback: pequeño ticker si no tienes systems (no interfiere si no hay juego corriendo)
      S._lastTick = nowSec();
      function tick() {
        try {
          const t = nowSec();
          const dt = clamp(t - (S._lastTick || t), 0, 0.25);
          S._lastTick = t;
          SpawnerManager.update(dt);
        } catch (_) {}
        W.requestAnimationFrame(tick);
      }
      W.requestAnimationFrame(tick);
      S.autoUpdateHooked = true;
    }
  }

  function worldFromTiles(tx, ty) {
    return { x: tx * TILE + TILE * 0.5 - (TILE * 0.5), y: ty * TILE + TILE * 0.5 - (TILE * 0.5) };
  }

  function isWallRect(x, y, w, h) {
    if (typeof W.isWallAt === 'function') return !!W.isWallAt(x, y, w, h);
    // Fallback con G.map (1 = muro)
    const tx1 = Math.floor(x / TILE), ty1 = Math.floor(y / TILE);
    const tx2 = Math.floor((x + w - 1) / TILE), ty2 = Math.floor((y + h - 1) / TILE);
    const map = getGame().map || [];
    for (let ty = ty1; ty <= ty2; ty++) {
      for (let tx = tx1; tx <= tx2; tx++) {
        if (map[ty] && map[ty][tx] === 1) return true;
      }
    }
    return false;
  }

  function findFreeSpotNear(x, y, radiusTiles = 3, w = TILE * 0.9, h = TILE * 0.9) {
    for (let k = 0; k < 80; k++) {
      const ang = randRange(0, Math.PI * 2);
      const r = (1 + ((S.rng() * radiusTiles) | 0)) * TILE;
      const nx = x + Math.cos(ang) * r;
      const ny = y + Math.sin(ang) * r;
      if (!isWallRect(nx, ny, w, h)) return { x: nx, y: ny };
    }
    return { x, y };
  }

  function findFreeTileForPushable(tx, ty, radiusTiles){
    if (!W.Placement || typeof W.Placement.findNearestFreeTile !== 'function') return null;
    const game = getGame();
    if (!game) return null;
    return W.Placement.findNearestFreeTile(game, tx, ty, null, { maxRadius: Math.max(0, radiusTiles | 0) });
  }

  function logCartRelocation(fromTx, fromTy, toTx, toTy){
    if (fromTx === toTx && fromTy === toTy) return;
    try {
      console.info(`Spawner: reubicado carro de (${fromTx},${fromTy}) a (${toTx},${toTy}) por espacio ocupado.`);
    } catch (_) {}
  }

  function sumQueue(qMap) {
    let s = 0;
    qMap.forEach(v => s += (v | 0));
    return s;
  }

  function decQueue(qMap, sub) {
    const v = (qMap.get(sub) | 0);
    if (v > 1) qMap.set(sub, v - 1);
    else qMap.delete(sub);
  }

  // ------------------ Spawners ------------------
  function makeSpawner(type, x, y, opts) {
    const t = (type + '').toLowerCase();
    const allows = new Set(Array.isArray(opts?.allows) ? opts.allows.map(s => (s + '').toLowerCase()) : []);
    return {
      id: 'SP_' + Math.random().toString(36).slice(2),
      type: t,                              // 'enemy' | 'npc' | 'cart'
      x: x | 0, y: y | 0,
      inTiles: !!opts?.inTiles,             // si se registró con tiles
      cooldownSec: Number.isFinite(opts?.cooldownSec) ? Math.max(1, opts.cooldownSec) : 180,
      nextAvailableAt: 0,
      queue: new Map(),                     // sub -> count pendiente
      allows,                               // vacío = acepta cualquier sub
      radiusPx: Number.isFinite(opts?.radiusPx) ? opts.radiusPx : TILE * 1.0,
      meta: opts || {}
    };
  }

  function canAccept(sp, sub) {
    if (!sp) return false;
    if (!sp.allows || sp.allows.size === 0) return true;
    return sp.allows.has((sub + '').toLowerCase());
  }

  function assignOneDeathToRandomSpawner(type, sub) {
    const list = S.spawners[type] || [];
    const cands = list.filter(sp => canAccept(sp, sub));
    if (!cands.length) {
      S.pending[type].push((sub + '').toLowerCase());
      return false;
    }
    const key = (sub + '').toLowerCase();
    const preferred = cands.filter((sp) => String(sp.meta?.prefer || '').toLowerCase() === key);
    const pool = preferred.length ? preferred : cands;
    const sp = randPick(pool);
    sp.queue.set(key, (sp.queue.get(key) | 0) + 1);
    return true;
  }

  function drainGlobalPendingIfAny(type) {
    const list = S.spawners[type] || [];
    if (!list.length) return;
    const pend = S.pending[type];
    for (let i = pend.length - 1; i >= 0; i--) {
      const sub = pend[i];
      const ok = assignOneDeathToRandomSpawner(type, sub);
      if (ok) pend.splice(i, 1);
    }
  }

  // ------------------ Creación de entidades (por familia/sub) ------------------
  const Spawn = {
    enemy(sub, x, y, payload) {
      const s = (sub + '').toLowerCase();
      if (s === 'mosquito' && W.MosquitoAPI?.spawn) return W.MosquitoAPI.spawn(x, y, payload);
      if (s === 'rat'       && W.RatsAPI?.spawn)     return W.RatsAPI.spawn(x, y, payload);

      // Fallback genérico si tuvieras un factory central
      if (W.Entities?.Enemy?.spawn) return W.Entities.Enemy.spawn(s, x, y, payload);
      if (W.Entities?.Spawner?.spawn) return W.Entities.Spawner.spawn(s, x, y, payload); // último recurso
      console.warn('[SpawnerManager] No hay spawn para enemy:', sub);
      return null;
    },

    npc(sub, x, y, payload) {
      const s = (sub + '').toLowerCase();
      // Factoría central si existe
      if (W.Entities?.NPC?.spawn) return W.Entities.NPC.spawn(s, x, y, payload);

      // Específicas ya presentes en tu proyecto
      if (s === 'tcae'         && W.Entities?.TCAE?.spawn)         return W.Entities.TCAE.spawn({ tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) });
      if (s === 'medico'       && W.MedicoAPI?.registerMedicEntity) { const e = { x, y, w: TILE * 0.9, h: TILE * 0.9 }; W.MedicoAPI.registerMedicEntity(e); return e; }
      if (s === 'supervisora'  && W.Entities?.SupervisoraAPI?.spawn) return W.Entities.SupervisoraAPI.spawn(x, y);
      if (s === 'guardia'      && W.Entities?.Guardia?.spawn)       return W.Entities.Guardia.spawn({ tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) });
      if (s === 'familiar'     && W.FamiliarAPI?.registerFamiliarEntity) { const e = { x, y, w: TILE * 0.95, h: TILE * 0.95 }; W.FamiliarAPI.registerFamiliarEntity(e); return e; }
      if ((s === 'enfermera_enamoradiza' || s === 'enfermera_sexy') && W.EnfermeraSexyAPI?.spawnEnfermera) {
        return W.EnfermeraSexyAPI.spawnEnfermera(Math.floor(x / TILE), Math.floor(y / TILE), {});
      }

      console.warn('[SpawnerManager] No hay spawn para npc:', sub);
      return null;
    },

    cart(sub, x, y, payload) {
      const k = (sub + '').toLowerCase();
      if (W.Entities?.Cart?.spawn) return W.Entities.Cart.spawn(k, x, y, payload);
      if (W.CartsAPI?.spawn) return W.CartsAPI.spawn({ type: k, x, y, ...(payload || {}) });
      console.warn('[SpawnerManager] No hay spawn para cart:', sub);
      return null;
    }
  };

  function spawnOneForSpawner(sp) {
    // Elegir qué sub generar (ponderado por cuántos haya en cola)
    const entries = Array.from(sp.queue.entries()); // [[sub,count],...]
    if (!entries.length) return false;
    const total = entries.reduce((a, [, c]) => a + c, 0);
    let pick = S.rng() * total;
    let pickedSub = entries[0][0];
    for (const [sub, cnt] of entries) {
      if ((pick -= cnt) <= 0) { pickedSub = sub; break; }
    }

    // Elegir posición (radio alrededor del punto, evitando paredes)
    const baseX = sp.inTiles ? worldFromTiles(sp.x, sp.y).x : sp.x;
    const baseY = sp.inTiles ? worldFromTiles(sp.x, sp.y).y : sp.y;
    const baseTx = Math.round(baseX / TILE);
    const baseTy = Math.round(baseY / TILE);
    const radiusTiles = clamp(Math.round((sp.radiusPx || TILE) / TILE), 1, 8);
    let pos = null;

    if (sp.type === 'cart') {
      const freeTile = findFreeTileForPushable(baseTx, baseTy, radiusTiles);
      if (freeTile) {
        pos = { x: freeTile.tx * TILE, y: freeTile.ty * TILE };
        logCartRelocation(baseTx, baseTy, freeTile.tx, freeTile.ty);
      } else {
        try {
          console.warn(`[SpawnerManager] No se encontró casilla libre para carro cerca de (${baseTx},${baseTy}). Se usará la posición original.`);
        } catch (_) {}
      }
    }

    if (!pos) {
      pos = findFreeSpotNear(baseX, baseY, radiusTiles);
    }

    if (sp.type === 'cart' && W.Placement?.isTileOccupiedByPushable) {
      const game = getGame();
      if (game) {
        const tx = Math.round(pos.x / TILE);
        const ty = Math.round(pos.y / TILE);
        if (W.Placement.isTileOccupiedByPushable(game, tx, ty, {})) {
          const fallback = findFreeTileForPushable(tx, ty, radiusTiles + 1);
          if (fallback) {
            logCartRelocation(tx, ty, fallback.tx, fallback.ty);
            pos = { x: fallback.tx * TILE, y: fallback.ty * TILE };
          } else {
            try {
              console.warn(`[SpawnerManager] No fue posible reubicar un carro desde (${tx},${ty}) a una casilla libre cercana.`);
            } catch (_) {}
          }
        }
      }
    }

    // Crear
    let ent = null;
    if (sp.type === 'enemy') ent = Spawn.enemy(pickedSub, pos.x, pos.y, { spawnerId: sp.id, sub: pickedSub });
    else if (sp.type === 'npc') ent = Spawn.npc(pickedSub, pos.x, pos.y, { spawnerId: sp.id, sub: pickedSub });
    else if (sp.type === 'cart') ent = Spawn.cart(pickedSub, pos.x, pos.y, { spawnerId: sp.id, sub: pickedSub });

    if (ent) {
      decQueue(sp.queue, pickedSub);
      sp.nextAvailableAt = nowSec() + sp.cooldownSec;
      const game = getGame();
      if (game.entities && !game.entities.includes(ent)) game.entities.push(ent);
      return true;
    } else {
      // Si falló el spawn, deja la cola como estaba y reintenta más tarde
      return false;
    }
  }

  // ------------------ API público ------------------
  const SpawnerManager = {
    init(Gref) {
      if (Gref) W.G = Gref;
      ensureSystemsAutoUpdate();
      return this;
    },

    // Registra un punto de spawn
    // type: 'enemy' | 'npc' | 'cart'
    // x,y: coords (px por defecto). opts: { inTiles, allows:[sub...], cooldownSec:180, radiusPx:TILE*1 }
    registerPoint(type, x, y, opts = {}) {
      const t = (type + '').toLowerCase();
      if (!S.spawners[t]) S.spawners[t] = [];
      const sp = makeSpawner(t, x, y, opts);
      S.spawners[t].push(sp);
      // si había cola global sin punto, intenta drenar
      drainGlobalPendingIfAny(t);
      return sp;
    },

    // Atajo desde placements 'spawn_*' (por comodidad; no crea nada al inicio):
    registerFromPlacement(p) {
      if (!p || !p.type) return null;
      const T = (p.type + '').toLowerCase();
      const inTiles = !!p.inTiles; // si tu placement venía en tiles
      const px = inTiles ? p.x : (p.x | 0);
      const py = inTiles ? p.y : (p.y | 0);
      if (T === 'spawn_mosquito') return this.registerPoint('enemy', px, py, { inTiles, allows: ['mosquito'] });
      if (T === 'spawn_rat')      return this.registerPoint('enemy', px, py, { inTiles, allows: ['rat'] });
      if (T === 'spawn_animal') {
        const base = Array.isArray(p.allows) && p.allows.length
          ? p.allows.map((s) => String(s || '').toLowerCase()).filter(Boolean)
          : ['mosquito', 'rat'];
        const allowSet = new Set(base);
        allowSet.add('mosquito');
        allowSet.add('rat');
        const allows = Array.from(allowSet);
        const preferRaw = String(p.prefers || p.prefer || '').toLowerCase();
        const opts = { inTiles, allows };
        if (preferRaw && allows.includes(preferRaw)) opts.prefer = preferRaw;
        return this.registerPoint('enemy', px, py, opts);
      }
      if (T === 'spawn_staff')    return this.registerPoint('npc',   px, py, { inTiles }); // admite varios subs
      if (T === 'spawn_cart')     return this.registerPoint('cart',  px, py, { inTiles }); // admite food/med/er
      return null;
    },

    // Reportar muertes:
    // type: 'enemy'|'npc'|'cart' ; sub: p.ej. 'mosquito','rat','tcae','medico','guardia','food','med','er'
    reportDeath(type, sub, n = 1) {
      const t = (type + '').toLowerCase();
      const count = Math.max(1, n | 0);
      for (let i = 0; i < count; i++) assignOneDeathToRandomSpawner(t, sub);
    },

    // Bucle de actualización: intenta crear 1 por spawner si tiene cola y cooldown cumplido
    update(dt) {
      const now = nowSec();
      // Enemigos
      for (const sp of S.spawners.enemy) {
        if (sumQueue(sp.queue) > 0 && now >= sp.nextAvailableAt) spawnOneForSpawner(sp);
      }
      // NPCs
      for (const sp of S.spawners.npc) {
        if (sumQueue(sp.queue) > 0 && now >= sp.nextAvailableAt) spawnOneForSpawner(sp);
      }
      // Carros
      for (const sp of S.spawners.cart) {
        if (sumQueue(sp.queue) > 0 && now >= sp.nextAvailableAt) spawnOneForSpawner(sp);
      }
    },

    // Depuración
    debugSummary() {
      const toObj = (sp) => ({
        id: sp.id, type: sp.type, x: sp.x, y: sp.y, inTiles: sp.inTiles,
        cooldownSec: sp.cooldownSec, nextIn: Math.max(0, sp.nextAvailableAt - nowSec()).toFixed(1),
        queue: Object.fromEntries(sp.queue.entries()),
        allows: Array.from(sp.allows)
      });
      return {
        enemy: S.spawners.enemy.map(toObj),
        npc:   S.spawners.npc.map(toObj),
        cart:  S.spawners.cart.map(toObj),
        pending: {
          enemy: S.pending.enemy.slice(),
          npc:   S.pending.npc.slice(),
          cart:  S.pending.cart.slice()
        }
      };
    }
  };

  // Export
  W.SpawnerManager = SpawnerManager;

  // Auto-init suave
  SpawnerManager.init(G);

})(this);