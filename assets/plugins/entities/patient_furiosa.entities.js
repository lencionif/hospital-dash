// filename: patient_furiosa.entities.js
// Reexporta la plantilla base unificada para entidades.
(function (W) {
  'use strict';
  if (!W.EntitiesBase) {
    console.error('[patient_furiosa.entities] Falta entities.base.js antes de este script');
    return;
  }
  Object.assign(W, W.EntitiesBase);
})(window);
