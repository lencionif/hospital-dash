// filename: spawner.entities.js
// Reexporta la plantilla base unificada para entidades.
(function (W) {
  'use strict';
  if (!W.EntitiesBase) {
    console.error('[spawner.entities] Falta entities.base.js antes de este script');
    return;
  }
  Object.assign(W, W.EntitiesBase);
})(window);
