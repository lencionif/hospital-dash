// filename: familiar_molesto.entities.js
// FAMILIAR MOLESTO — “Il Divo: Hospital Dash!”
//
// • Pasea por pasillos y, a veces, se “planta” para BLOQUEAR el paso.
// • Al TOCAR al jugador (AABB o cercanía < contactR) dispara frase y aplica DEBUFF:
//   - Lentitud temporal, menor empuje y ligera “torpeza” de control.
//   - Reaplica con CD para no spammear.
// • Abre puertas cercanas (si DoorsAPI.autoOpenNear existe).
// • Puede morir aplastado por carros/objetos con alto impulso → Score.
//
// Contratos suaves con el motor: G, ENT, TILE_SIZE, moveWithCollisions(), DoorsAPI, DialogAPI, ScoreAPI.
// No necesita spawner.entities.js para poblar al inicio, pero el fallback del spawner lo soporta.

(function (W) {
  'use strict';

  const G = (W.G ||= {});
  const ENT = (G.ENT ||= { PLAYER: 1, DOOR: 8 }); // por si no estuviera
  const TILE = (W.TILE_SIZE || W.TILE || 32);

  // ======= Config por defecto =================================================
  const CFG = {
    size: { w: Math.floor(TILE * 0.85), h: Math.floor(TILE * 0.95) },
    speed: 55,            // px/s
    accel: 420,           // aceleración
    friction: 0.88,
    blockChance: 0.22,    // prob. de “plantarse” al entrar en pasillo estrecho
    blockMin: 2.0,        // s min bloqueando
    blockMax: 4.0,        // s máx bloqueando
    blockCooldown: 9.0,   // s antes de volver a bloquearse
    narrowProbeTiles: 0.7,// umbral ancho pasillo (tiles) para considerarlo estrecho
    turnProbePx: 14,      // look-ahead para girar si va a chocar

    // interacción “cuando toca”
    contactR: 36,         // radio para considerar “toque” (además de AABB)
    touchCD: 2.5,         // s de CD entre toques (por familiar)
    auraR: 80,            // si el jugador entra aquí, “pesa” (slows) un poco

    // debuffs al jugador
    debuff: {
      secs: 4.0,
      speedMul: 0.88,     // reduce velocidad
      pushMul: 0.85,      // reduce empuje
      controlLagMs: 60,   // simula torpeza (si tu input lo soporta)
      visionMul: 0.95     // opcional si tu HUD/luces lo leen
    },

    // aplastamiento
    crushSpeedThresh: 220, // si un objeto con esta velocidad contacta → muerte

    // fraseo
    lines: [
      "¿Cómo me conecto al wifi del hospital?",
      "Se me han caído las pastillas… ¿me las da otra vez?",
      "Mi primo trabaja en sanidad y dice que esto no se hace así.",
      "¿Esto lo cubre la Seguridad Social?",
      "Llevamos una hora esperando…",
      "¿Podemos charlar un momento? Es importante.",
      "¿Me puede tomar la tensión, por favor?",
      "¿Dónde está la supervisora? ¡Quiero hablar con ella!",
      "Yo de aquí no me muevo hasta que me escuchen.",
      "No entiendo por qué tarda tanto si solo hay cuatro habitaciones.",
      "¿Me señala la habitación de mi madre? Me lío con los pasillos.",
      "Es que… en la tele dijeron que esto se hace en cinco minutos."
    ],

    skin: "familiar_molesto", // clave del sprite
    color: "#f2b3a1",         // fallback
  };

  // ======= Utiles ============================================================
  const now = () => performance.now() / 1000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const len = (x, y) => Math.hypot(x, y);
  const aabb = (a, b) => (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);
  const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);

  function mapAt(tx, ty) { return (G.map && G.map[ty] && G.map[ty][tx]) || 0; }
  function isWallTile(tx, ty) { return mapAt(tx, ty) === 1; }
  function isWallRect(x, y, w, h) {
    const x0 = Math.floor(x / TILE), y0 = Math.floor(y / TILE);
    const x1 = Math.floor((x + w - 1) / TILE), y1 = Math.floor((y + h - 1) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (isWallTile(tx, ty)) return true;
    return false;
  }

  function pushEntity(e) {
    (G.entities ||= []).push(e);
    (G.npcs ||= []).push(e);
    try {
      const puppet = window.Puppet?.bind?.(e, 'npc_familiar_molesto', { z: 0, scale: 1, data: { skin: e.skin } })
        || window.PuppetAPI?.attach?.(e, { rig: 'npc_familiar_molesto', z: 0, scale: 1, data: { skin: e.skin } });
      e.rigOk = e.rigOk === true || !!puppet;
    } catch (_) {
      e.rigOk = e.rigOk === true;
    }
    return e;
  }

  function randomDir() {
    return Math.random() < 0.5 ? { x: Math.sign(Math.random() - 0.5), y: 0 } : { x: 0, y: Math.sign(Math.random() - 0.5) };
  }

  function freeSpotNear(x, y, tries = 8) {
    for (let i = 0; i < tries; i++) {
      const dx = (Math.random() * 2 - 1) * TILE * 2;
      const dy = (Math.random() * 2 - 1) * TILE * 2;
      const nx = x + dx, ny = y + dy;
      if (!isWallRect(nx, ny, CFG.size.w, CFG.size.h)) return { x: nx, y: ny };
    }
    return { x, y };
  }

  // ======= IA deambular / bloquear ==========================================
  function think(e) {
    const t = now();

    // ¿termina bloqueo?
    if (e.ai.blocking && t >= e.ai.blockEndAt) {
      e.ai.blocking = false;
      e.ai.cd = CFG.blockCooldown;
      e.vx *= 0.2; e.vy *= 0.2;
    }

    // si no bloquea, chance de plantarse si está en estrecho
    if (!e.ai.blocking && e.ai.cd <= 0) {
      if (isInNarrow(e)) {
        if (Math.random() < CFG.blockChance) {
          e.ai.blocking = true;
          e.ai.blockEndAt = t + (CFG.blockMin + Math.random() * (CFG.blockMax - CFG.blockMin));
          e.vx = 0; e.vy = 0;
        }
      }
    }

    // dirección para pasear
    if (!e.ai.blocking && t >= e.ai.nextTurnAt) {
      e.ai.nextTurnAt = t + (0.6 + Math.random() * 1.2);
      const dir = randomDir();
      e.ai.dx = dir.x; e.ai.dy = dir.y;
    }
  }

  function isInNarrow(e) {
    // mide el hueco libre lateral a su alrededor para considerar “pasillo”
    const tiles = CFG.narrowProbeTiles;
    const w = e.w, h = e.h;
    // chequea 4 sentidos simples: si choca cerca en ±X o ±Y
    const px = CFG.turnProbePx;
    const nearWall =
      isWallRect(e.x - px, e.y, w, h) ||
      isWallRect(e.x + px, e.y, w, h) ||
      isWallRect(e.x, e.y - px, w, h) ||
      isWallRect(e.x, e.y + px, w, h);
    // heurística barata: si “cerca de pared” y su bounding cabe justo en ~1 tile ancho
    const tileW = Math.max(1, Math.round((w / TILE) / tiles));
    return nearWall || tileW <= 1;
  }

  // ======= Toque/Frase + Debuff ==============================================
  function maybeTouchAndAnnoy(e) {
    const p = G.player;
    if (!p) return;

    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    const px = p.x + p.w / 2, py = p.y + p.h / 2;
    const d2 = dist2(cx, cy, px, py);
    const touch = (d2 <= CFG.contactR * CFG.contactR) || aabb(e, p);
    const t = now();

    // “aura” de pesadez cerca (aunque no toque)
    if (d2 <= CFG.auraR * CFG.auraR) applyLightAura(p);

    if (touch && t >= (e.ai.nextTouchAt || 0)) {
      e.ai.nextTouchAt = t + CFG.touchCD;

      // frase
      sayOneLine(e);

      // debuff sobre el jugador
      applyDebuffToPlayer(p);

      // pequeño empujón de “estorbo” (el familiar no daña, solo molesta)
      const nx = Math.sign(px - cx) || (Math.random() < 0.5 ? 1 : -1);
      const ny = Math.sign(py - cy) || (Math.random() < 0.5 ? 1 : -1);
      p.vx += nx * 15; p.vy += ny * 15;
    }
  }

  function sayOneLine(e) {
    const humorSoft = !!document.getElementById('opt-humor')?.checked;
    const lines = CFG.lines.slice();
    // si “humor suave” activado, recorta a las más neutras
    const filtered = humorSoft ? lines.filter((s, i) => i !== 1 && i !== 2) : lines;
    const line = filtered[(Math.random() * filtered.length) | 0];

    if (W.DialogAPI && typeof W.DialogAPI.open === 'function') {
      W.DialogAPI.open({
        title: 'Familiar Molesto',
        portraitCssVar: '--portrait-familiar',
        text: line,
        buttons: [{ id: 'ok', label: '...', action: () => W.DialogAPI.close() }],
        pauseGame: false
      });
    } else {
      console.log('[Familiar] ' + line);
    }
  }

  function applyDebuffToPlayer(p) {
    const t = now();
    p._tempBuffs ||= {};
    // Renueva “hasta cuándo” (se suman si ya están activos)
    const until = Math.max(t + CFG.debuff.secs, p._tempBuffs.familiarUntil || 0);
    p._tempBuffs.familiarUntil = until;
    p._tempBuffs.speedMul = Math.min(p._tempBuffs.speedMul || 1, CFG.debuff.speedMul);
    p._tempBuffs.pushMul = Math.min(p._tempBuffs.pushMul || 1, CFG.debuff.pushMul);
    p._tempBuffs.visionMul = Math.min(p._tempBuffs.visionMul || 1, CFG.debuff.visionMul);
    p._tempBuffs.inputLagMs = Math.max(p._tempBuffs.inputLagMs || 0, CFG.debuff.controlLagMs);

    // efecto inmediato ligero (por si el motor no lee _tempBuffs)
    p.vx *= 0.8; p.vy *= 0.8;

    // feedback sonoro
    try { W.AudioAPI?.play?.('fam_touch', { volume: 0.9 }); } catch (_) {}
  }

  function applyLightAura(p) {
    // simple: amortigua un pelín el movimiento si está cerca (sin tocar)
    p.vx *= 0.985; p.vy *= 0.985;
  }

  function updatePlayerDebuffDecay() {
    const p = G.player;
    if (!p || !p._tempBuffs) return;
    const t = now();
    if ((p._tempBuffs.familiarUntil || 0) < t) {
      // limpia efectos del familiar, mantén otros posibles buffs
      delete p._tempBuffs.speedMul;
      delete p._tempBuffs.pushMul;
      delete p._tempBuffs.visionMul;
      delete p._tempBuffs.inputLagMs;
      delete p._tempBuffs.familiarUntil;
    }
  }

  // ======= Movimiento y colisiones ==========================================
  function steer(e, dt) {
    if (e.ai.blocking) { e.vx = 0; e.vy = 0; return; }

    // velocidad objetivo por su dir actual
    const tvx = (e.ai.dx || 0) * CFG.speed;
    const tvy = (e.ai.dy || 0) * CFG.speed;

    e.vx += clamp(tvx - e.vx, -CFG.accel, CFG.accel) * dt;
    e.vy += clamp(tvy - e.vy, -CFG.accel, CFG.accel) * dt;

    // look-ahead para girar si choca
    const la = CFG.turnProbePx;
    const nx = e.x + (e.vx ? Math.sign(e.vx) : e.ai.dx || 0) * la;
    const ny = e.y + (e.vy ? Math.sign(e.vy) : e.ai.dy || 0) * la;
    if (isWallRect(nx, e.y, e.w, e.h)) { e.ai.dx = 0; e.ai.dy = (Math.random() < 0.5 ? 1 : -1); }
    if (isWallRect(e.x, ny, e.w, e.h)) { e.ai.dy = 0; e.ai.dx = (Math.random() < 0.5 ? 1 : -1); }

    // puertas automáticas
    try { W.DoorsAPI?.autoOpenNear?.(e, TILE * 0.8); } catch (_) {}

    // límite de velocidad y rozamiento
    const sp = len(e.vx, e.vy);
    if (sp > CFG.speed) { const k = CFG.speed / sp; e.vx *= k; e.vy *= k; }
  }

  function moveAndCollide(e, dt) {
    if (typeof W.moveWithCollisions === 'function') {
      W.moveWithCollisions(e);
    } else {
      const nx = e.x + e.vx * dt;
      const ny = e.y + e.vy * dt;
      if (!isWallRect(nx, e.y, e.w, e.h)) e.x = nx; else e.vx = 0;
      if (!isWallRect(e.x, ny, e.w, e.h)) e.y = ny; else e.vy = 0;
    }
    e.vx *= CFG.friction; e.vy *= CFG.friction;
  }

  // ======= Aplastamiento por objetos ========================================
  function checkCrush(e) {
    const all = (G.movers && G.movers.length ? G.movers : G.entities) || [];
    for (const o of all) {
      if (o === e || !o) continue;
      if (o.dead) continue;
      // si el objeto entra en AABB del familiar con velocidad alta → muere
      if (!aabb(e, o)) continue;
      const sp = len(o.vx || 0, o.vy || 0);
      if (sp >= CFG.crushSpeedThresh) {
        // “muere” (desaparece) y otorga puntos
        e.dead = true;
        try {
          if (W.ScoreAPI?.awardForDeath) W.ScoreAPI.awardForDeath(e, { by: 'crush', speed: sp });
          else if (W.ScoreAPI?.onNPCCrushed) W.ScoreAPI.onNPCCrushed('familiar', { speed: sp });
        } catch (_) {}
        return true;
      }
    }
    return false;
  }

  // ======= Ciclo de vida =====================================================
  function create(x, y, opts = {}) {
    // evita nacer dentro de pared
    const p0 = freeSpotNear(x, y, 10);
    const e = {
      id: 'FAM' + Math.floor(Math.random() * 1e7),
      kind: ENT.NPC || 'npc',
      role: 'familiar',
      x: p0.x, y: p0.y,
      w: CFG.size.w, h: CFG.size.h,
      vx: 0, vy: 0,
      solid: true, pushable: false,
      spriteKey: CFG.skin,
      skin: `${CFG.skin}.png`,
      color: CFG.color,
      // IA
      ai: {
        dx: (Math.random() < 0.5 ? 1 : -1),
        dy: 0,
        blocking: false,
        blockEndAt: 0,
        cd: 0,
        nextTurnAt: now() + 0.4 + Math.random() * 0.5,
        nextTouchAt: 0
      }
    };
    return pushEntity(e);
  }

  function updateOne(e, dt) {
    if (!e || e.dead) return;

    // temporizadores IA
    e.ai.cd = Math.max(0, e.ai.cd - dt);
    think(e);

    // maniobra/marcha
    steer(e, dt);

    // movimiento y colisión
    moveAndCollide(e, dt);

    // interacción con jugador
    maybeTouchAndAnnoy(e);

    // ¿aplastado?
    if (checkCrush(e)) return;

    // limpieza buff del jugador
    updatePlayerDebuffDecay();
  }

  function list() {
    return (G.entities || []).filter(e => e && !e.dead && (e.role === 'familiar' || e.spriteKey === CFG.skin));
  }

  function updateAll(dt) {
    for (const e of list()) updateOne(e, dt || 1 / 60);
  }

  // ======= Auto-hook opcional al bucle ======================================
  (function autoHook() {
    try {
      (G.systems ||= []).push({ id: 'familiar_ai', update: updateAll });
    } catch (_) {}
  })();

  // ======= API pública =======================================================
  W.Entities = (W.Entities || {});
  W.FamiliarAPI = W.Entities.Familiar = {
    spawn: create,
    updateAll,
    list
  };

})(this);