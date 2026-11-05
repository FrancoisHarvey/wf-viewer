/* version.js - constante unique de version, affichée dans le pied de page. */
(function (root) {
  'use strict';
  var VERSION = '0.2.0';
  if (typeof module !== 'undefined' && module.exports) module.exports = { version: VERSION };
  else { root.WFV = root.WFV || {}; root.WFV.version = VERSION; }
})(typeof self !== 'undefined' ? self : globalThis);
