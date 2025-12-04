// filename: medico.entities.js
// TODO: Archivo no referenciado en index.html. Candidato a eliminación si se confirma que no se usa.
// Reexporta la plantilla base unificada para entidades.
(function (W) {
  'use strict';
  if (!W.EntitiesBase) {
    console.error('[medico.entities] Falta entities.base.js antes de este script');
    return;
  }
  Object.assign(W, W.EntitiesBase);
})(window);
