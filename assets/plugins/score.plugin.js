/* filename: score.plugin.js
   Sistema de Puntuación — “Il Divo: Hospital Dash!”
   ----------------------------------------------------
   ✔ Suma puntos por:
     • Enemigos/NPC aplastados por el jugador (carros/camas/impacto)
     • Monedas y bolsas de dinero
     • Nivel completado rápidamente (bono por tiempo ahorrado)

   ✔ Resta puntos por:
     • Pacientes muertos (penalización fuerte)

   ✔ API pública (window.ScoreAPI):
     init(G?, opts?)
     startLevel(level?, t0Sec?)
     addScore(pts, reason?, meta?)            // uso general
     onEnemyCrushed(kind, meta?)              // 'mosquito','rat','furious', etc.
     onNPCCrushed(kind, meta?)                // 'celador','tcae','limpiadora','nurse','supervisora','jefe','medico'...
     onPickupCoin(count=1, meta?)
     onPickupBag(count=1,  meta?)
     onPatientDied(count=1, meta?)
     onLevelComplete(tEndSec?) -> summary     // calcula bono tiempo y cierra nivel
     getTotals() -> { total, level, levelScore, elapsedSec, breakdown, stats }
     on(event, fn) / off(event, fn)           // 'change','level_end'
     setConfig(partialCfg)

   ✔ No depende de DOM; opcionalmente emite CustomEvent('score_changed')
   ✔ No toca HUD; pero llama a G.addScore si existe (o lo define)
   ---------------------------------------------------- */

(function (W) {
  'use strict';

  const DEFAULT_CFG = {
    points: {
      enemy: {
        mosquito: 50,
        rat: 40,
        furious: 80,
        generic: 40,
      },
      npc: {
        celador: 20,
        tcae: 20,
        limpiadora: 15,
        nurse: 25,
        supervisora: 35,
        jefe: 45,
        medico: 35,
        generic: 20,
      },
      coin: 5, // ya no lo usamos para la puntuación final, pero lo dejamos por compat
      bag:  25,
    },
    penalties: {
      patientDeath: 300,
      teamKill: 0,
    },
    timeBonus: {
      parSec: { 1: 900, 2: 1500, 3: 2100 },
      perSecond: 2,
      maxBonus:  4000,
      clampZero: true,
    },
    impactBonus: { enabled:true, scale: 1/400, maxExtra: 0.75 },

    // === NUEVO: rangos y valores por defecto ===
    scoreRanges: {
      defaultKill: [100, 500],   // muerte de entidad sin scoreValue
      coin:        [100, 500],   // monedas
      bag:         [500, 2000],  // bolsa de dinero
      food:        10,           // comida
      powerup:     20            // power-up
    }
  };

  const evBus = new Map(); // 'change','level_end'
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

  const STATE = {
    cfg: deepClone(DEFAULT_CFG),
    total: 0,
    level: 1,
    t0Sec: 0,
    tEndSec: 0,
    levelScore: 0,
    breakdown: [],      // [{pts, reason, meta}]
    stats: {
      coins: 0,
      bags: 0,
      enemyCrush: 0,
      npcCrush: 0,
      patientDeaths: 0,
      elapsedSec: 0,
    }
  };

  function deepClone(o){ return JSON.parse(JSON.stringify(o||{})); }

  // === NUEVO: utils para puntuaciones directas desde la entidad ===
  function randInt(min, max) { return (Math.random() * (max - min + 1) + min) | 0; }

  function getEntityKindName(e){
      if (!e) return 'entity';
      // intenta deducir un nombre amigable
      if (e.kindName) return e.kindName;
      if (typeof e.kind === 'string') return e.kind;
      if (typeof e.role === 'string') return e.role;
      return 'entity';
    }

    function classifyVictim(e){
    const W = window, ENT = (W.ENT||{});
    const kstr = String(e?.kindName || e?.role || e?.kind || '').toLowerCase();
    const tag  = String(e?.tag||'').toLowerCase();

    // Paciente
    if (kstr.includes('patient') || e?.requiredPillName || e?.kind===ENT.PATIENT) 
      return {cat:'patient', key:'patient'};

    // Héroe/jugador (coop)
    if (e?.kind===ENT.PLAYER || tag==='player' || tag==='follower') 
      return {cat:'player', key:(tag==='follower'?'hero':'player')};

    // Enemigos conocidos
    if (kstr.includes('mosquito') || e?.kind===ENT.MOSQUITO) return {cat:'enemy', key:'mosquito'};
    if (kstr.includes('rat')      || e?.kind===ENT.RAT)      return {cat:'enemy', key:'rat'};
    if (kstr.includes('furious')  || kstr.includes('furiosa')) return {cat:'enemy', key:'furious'};

    // NPCs conocidos
    if (kstr.includes('celador')  || e?.kind===ENT.CELADOR)  return {cat:'npc', key:'celador'};
    if (kstr.includes('tcae'))                                return {cat:'npc', key:'tcae'};
    if (kstr.includes('limpi'))                               return {cat:'npc', key:'limpiadora'};
    if (kstr.includes('nurse')||kstr.includes('enfer'))       return {cat:'npc', key:'nurse'};
    if (kstr.includes('supervi'))                              return {cat:'npc', key:'supervisora'};
    if (kstr.includes('jefe'))                                 return {cat:'npc', key:'jefe'};
    if (kstr.includes('medic'))                                return {cat:'npc', key:'medico'};

    // Fallbacks
    if (typeof e?.kind === 'number' && (e.kind===ENT.MOSQUITO||e.kind===ENT.RAT)) return {cat:'enemy', key:'generic'};
    return {cat:'npc', key:'generic'};
  }

  // decide cuántos puntos dar por entidad o tipo de recogida
  function valueFromEntityOrType(e, fallbackType, cfg, count=1){
    // 1) si la entidad trae "scoreValue" (numérico), úsalo
    if (e && Number.isFinite(e.scoreValue)) return (e.scoreValue|0);

    // 2) según tipo “fallback” aplica rangos por defecto
    const R = cfg.scoreRanges;
    switch ((fallbackType||'').toLowerCase()){
      case 'coin':    return randInt(R.coin[0], R.coin[1]) * Math.max(1, count|0);
      case 'bag':     return randInt(R.bag[0],  R.bag[1])  * Math.max(1, count|0);
      case 'food':    return (R.food|0)        * Math.max(1, count|0);
      case 'powerup': return (R.powerup|0)     * Math.max(1, count|0);
      case 'kill':    // muerte genérica
      default:
        return randInt(R.defaultKill[0], R.defaultKill[1]);
    }
  }

  function emit(ev, payload){
    const set = evBus.get(ev);
    if (set) for (const fn of set) { try { fn(payload); } catch(e){} }
    // También como CustomEvent para quien prefiera escucharlo en window
    try { W.dispatchEvent(new CustomEvent('score_'+ev, { detail: payload })); } catch(e){}
  }

  // ---- Núcleo de suma/resta ----
  function _apply(pts, reason, meta){
    pts = (pts|0);
    STATE.levelScore += pts;
    STATE.total      += pts;
    const entry = { pts, reason: reason||'score', meta: meta||null };
    STATE.breakdown.push(entry);
    emit('change', getTotals());
    // También expón un hook sencillo para HUD externo (opcional)
    if (W.G){
      if (!W.G.addScore) {
        W.G.addScore = function(n){ /* retrocompatibilidad */ };
      }
      try { W.G.addScore(pts); } catch(e){}
      W.G._hudDirty = true;
    }
    return entry;
  }

  // ---- Multiplicador por impacto ----
  function impactMultiplier(meta){
    const cfg = STATE.cfg.impactBonus;
    if (!cfg.enabled || !meta || typeof meta.impactSpeed!=='number') return 1;
    // extra = min(impact*scale, maxExtra)
    const extra = Math.min(meta.impactSpeed * cfg.scale, cfg.maxExtra);
    return 1 + Math.max(0, extra);
  }

  // ---- API pública ----
  const API = {
    init(G, opts){
      if (opts) this.setConfig(opts);
      if (G && !G.addScore){
        G.addScore = (n)=>{}; // retro-compat HUD
      }
      return this;
    },

    setConfig(partialCfg){
      function merge(dst, src){
        for (const k in src){
          if (src[k] && typeof src[k]==='object' && !Array.isArray(src[k])){
            if (!dst[k]) dst[k] = {};
            merge(dst[k], src[k]);
          } else {
            dst[k] = src[k];
          }
        }
      }
      merge(STATE.cfg, partialCfg||{});
      emit('change', getTotals());
      return this;
    },

    startLevel(level, t0Sec){
      STATE.level = (level|0)||1;
      STATE.t0Sec = typeof t0Sec==='number' ? t0Sec : (W.G?.nowSec?.() ?? (performance.now()/1000));
      STATE.tEndSec = 0;
      STATE.levelScore = 0;
      STATE.breakdown.length = 0;
      STATE.stats.coins = 0;
      STATE.stats.bags = 0;
      STATE.stats.enemyCrush = 0;
      STATE.stats.npcCrush = 0;
      STATE.stats.patientDeaths = 0;
      STATE.stats.elapsedSec = 0;
      emit('change', getTotals());
      return this;
    },

    addScore(pts, reason, meta){ return _apply(pts, reason, meta); },

    // --- EXISTENTE: compat (puedes seguir llamándolos si quieres) ---
    onEnemyCrushed(kind='generic', meta){
      const base = STATE.cfg.points.enemy[kind] ?? STATE.cfg.points.enemy.generic;
      const mult = impactMultiplier(meta);
      const pts  = Math.round(base * mult);
      STATE.stats.enemyCrush++;
      return _apply(pts, `enemy_crushed:${kind}`, meta);
    },

    onNPCCrushed(kind='generic', meta){
      const base = STATE.cfg.points.npc[kind] ?? STATE.cfg.points.npc.generic;
      const mult = impactMultiplier(meta);
      const pts  = Math.round(base * mult);
      STATE.stats.npcCrush++;
      return _apply(pts, `npc_crushed:${kind}`, meta);
    },

    onPickupCoin(count=1, meta){
      count = Math.max(1, count|0);
      const pts = (STATE.cfg.scoreRanges && STATE.cfg.scoreRanges.coin)
        ? randInt(STATE.cfg.scoreRanges.coin[0], STATE.cfg.scoreRanges.coin[1]) * count
        : STATE.cfg.points.coin * count;
      STATE.stats.coins += count;
      return _apply(pts, `coin_x${count}`, meta);
    },

    onPickupBag(count=1, meta){
      count = Math.max(1, count|0);
      const pts = (STATE.cfg.scoreRanges && STATE.cfg.scoreRanges.bag)
        ? randInt(STATE.cfg.scoreRanges.bag[0], STATE.cfg.scoreRanges.bag[1]) * count
        : STATE.cfg.points.bag * count;
      STATE.stats.bags += count;
      return _apply(pts, `bag_x${count}`, meta);
    },

    onPatientDied(count=1, meta){
      count = Math.max(1, count|0);
      const pen = -Math.abs(STATE.cfg.penalties.patientDeath) * count;
      STATE.stats.patientDeaths += count;
      return _apply(pen, `patient_dead_x${count}`, meta);
    },

    onLevelComplete(tEndSec){
      STATE.tEndSec = typeof tEndSec==='number' ? tEndSec : (W.G?.nowSec?.() ?? (performance.now()/1000));
      const elapsed = Math.max(0, STATE.tEndSec - STATE.t0Sec);
      STATE.stats.elapsedSec = elapsed;

      const tb = computeTimeBonus(STATE.level, elapsed, STATE.cfg.timeBonus);
      const entry = (tb>0 || !STATE.cfg.timeBonus.clampZero) ? _apply(tb, 'time_bonus', { elapsed }) : null;

      const summary = getTotals();
      emit('level_end', summary);
      return summary;
    },

    getTotals: getTotals,

    on(ev, fn){ if(!evBus.has(ev)) evBus.set(ev, new Set()); evBus.get(ev).add(fn); return this; },
    off(ev, fn){ evBus.get(ev)?.delete(fn); return this; },

    // === NUEVO: API “para tontos” que puntúa leyendo la entidad ===
    awardForDeath(e, meta){
      const info = classifyVictim(e);                 // {cat:'enemy'|'npc'|'patient'|'player', key:...}
      const m = Object.assign({ id:e?.id||null }, meta||{});
      // killerTag opcional: 'PLAYER' | 'HERO' | 'CELADOR' | ...
      const killer = String(m.killerTag||'').toUpperCase();
      // 1) Pacientes: penalización dura y fin
      if (info.cat === 'patient'){
        return this.onPatientDied(1, m);
      }
      // 2) Team-kill (jugador/compañero muertos): no sumes; penaliza si config
      if (info.cat === 'player'){
        const pen = -Math.abs(STATE.cfg.penalties.teamKill||0);
        return pen ? _apply(pen, 'team_kill', m) : { pts:0, reason:'team_kill', meta:m };
      }
      // 3) Enemigos: usa tabla por tipo + multiplicador por impacto
      if (info.cat === 'enemy'){
        return this.onEnemyCrushed(info.key, m);
      }
      // 4) NPCs: idem
      return this.onNPCCrushed(info.key, m);
    },

    awardForPickup(type, e, count=1, meta){
      const t = (type||'').toLowerCase();
      const pts = valueFromEntityOrType(e, t, STATE.cfg, count);
      // actualiza stats básicas si es dinero
      if (t==='coin') STATE.stats.coins += Math.max(1, count|0);
      if (t==='bag')  STATE.stats.bags  += Math.max(1, count|0);
      return _apply(pts, `pickup:${t}_x${count}`, Object.assign({ id:e?.id||null }, meta||{}));
    }
  };

  function getTotals(){
    return {
      total: STATE.total,
      level: STATE.level,
      levelScore: STATE.levelScore,
      elapsedSec: STATE.stats.elapsedSec,
      breakdown: STATE.breakdown.slice(-20), // últimos 20 eventos (para HUD)
      stats: deepClone(STATE.stats),
      cfg: deepClone(STATE.cfg),
    };
  }

  function computeTimeBonus(level, elapsedSec, cfgTB){
    const par = cfgTB.parSec[level] ?? cfgTB.parSec[1];
    const saved = par - elapsedSec;
    if (saved <= 0) return cfgTB.clampZero ? 0 : Math.max(-cfgTB.maxBonus, Math.round(saved * cfgTB.perSecond));
    const bonus = Math.round(saved * cfgTB.perSecond);
    return clamp(bonus, 0, cfgTB.maxBonus);
  }

  // Exponer global
  W.ScoreAPI = API;

})(this);