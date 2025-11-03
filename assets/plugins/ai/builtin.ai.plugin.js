// filename: builtin.ai.plugin.js
// Registra las IA disponibles en el proyecto y activa sus actualizaciones.
(function (W) {
  'use strict';

  const AI = W.AI;
  if (!AI) return;

  const log = W.LOG || null;

  function system(name, fn) {
    if (typeof fn !== 'function') {
      log?.warn?.('[AI] system missing handler', { name });
      return;
    }
    AI.registerSystem(name, (G, dt) => fn(dt, G));
  }

  function entity(name, fn) {
    if (typeof fn !== 'function') {
      log?.warn?.('[AI] entity missing handler', { name });
      return;
    }
    AI.register(name, (ent, G, dt) => fn(ent, dt, G));
  }

  // Enemigos básicos
  entity('RAT', (ent, dt, G) => W.Rats?.ai?.(ent, G, dt));
  entity('MOSQUITO', (ent, dt, G) => W.Mosquitos?.ai?.(ent, G, dt));
  system('FURIOUS', (dt) => W.FuriousAPI?.update?.(dt));

  // NPCs de apoyo y personal sanitario
  system('MEDIC', (dt) => W.MedicoAPI?.update?.(dt));
  system('JEFESERVICIO', (dt) => W.JefeServicioAPI?.update?.(dt));
  system('SUPERVISORA', (dt) => W.SupervisoraAPI?.update?.(dt));
  system('NURSE', (dt) => W.Entities?.NurseSexy?.update?.(dt));
  system('FAMILIAR', (dt) => W.FamiliarAPI?.updateAll?.(dt));
  system('CLEANER', (dt) => W.CleanerAPI?.updateAll?.(dt));
  system('TCAE', (dt) => W.TCAEAPI?.update?.(dt));

  // Guardia y celador (requieren listas internas)
  system('GUARDIA', (dt, G) => {
    const handler = W.Entities?.Guardia?.updateAll;
    if (typeof handler === 'function') handler(dt || 1 / 60, G);
  });
  entity('CELADOR', (ent, dt, G) => W.Entities?.Celador?.update?.(ent, dt, G?.entities));

  // Ascensores
  system('ELEVATOR', (dt) => W.Entities?.Elevator?.update?.(dt));

  // IA principal del juego → resumen en logs
  try {
    const summary = AI.summarize();
    log?.info?.('[AI] activated', summary);
  } catch (err) {
    log?.warn?.('[AI] summarize error', err);
  }
})(window);
