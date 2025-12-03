// filename: familiar_molesto.entities.js
// Reexporta la plantilla base unificada para entidades.
(function (W) {
  'use strict';
  if (!W.EntitiesBase) {
    console.error('[familiar_molesto.entities] Falta entities.base.js antes de este script');
    return;
  }
  Object.assign(W, W.EntitiesBase);
})(window);
