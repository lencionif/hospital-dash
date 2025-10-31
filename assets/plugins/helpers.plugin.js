// assets/plugins/helpers.plugin.js
// Utilidades globales mínimas
(function(global){
  'use strict';

  if (!global.IMG) {
    global.IMG = function IMG(name){
      return `./assets/images/${name}`;
    };
  }
})(window);
