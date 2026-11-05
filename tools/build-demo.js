#!/usr/bin/env node
/* Génère src/demo-data.js depuis fixtures/ (données ENTIÈREMENT fictives). Usage: node tools/build-demo.js  (ou npm run build:demo)
   Le module embarque les fichiers {name, text} (classification identique à celle du loader) pour que la page puisse charger une démo
   sans fetch ni fichier (CSP stricte, déploiement Pages sans fixtures/). Exporte aussi collect() et buildModule() pour le test de fraîcheur. */
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../src/scripts.js');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(ROOT, 'fixtures');
const OUT = path.join(ROOT, 'src', 'demo-data.js');

function walk(dir, acc) { acc = acc || []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, acc); else acc.push(p); } return acc.sort(); }
// -> [{name, text}] (noms relatifs à fixtures/, séparateur /, texte brut avec BOM éventuel conservé)
function collect(dir) {
  dir = dir || FIXTURES; const dec = new TextDecoder('utf-8', { ignoreBOM: true });
  return walk(dir).map((f) => ({ name: path.relative(dir, f).split(path.sep).join('/'), buf: fs.readFileSync(f) })).filter((x) => S.classifyFile(x.name)).map((x) => ({ name: x.name, text: dec.decode(x.buf) }));
}
function buildModule(files) {
  return '/* AUTO-GÉNÉRÉ par tools/build-demo.js à partir de fixtures/ — NE PAS MODIFIER À LA MAIN (npm run build:demo).\n   Données de démonstration ENTIÈREMENT FICTIVES (aucune donnée réelle). */\n(function (root) {\n  \'use strict\';\n  var FILES = [\n'
    + files.map((f) => '    ' + JSON.stringify(f)).join(',\n')
    + '\n  ];\n  var api = { files: FILES, count: FILES.length };\n  if (typeof module !== \'undefined\' && module.exports) module.exports = api;\n  else { root.WFV = root.WFV || {}; root.WFV.demo = api; }\n})(typeof self !== \'undefined\' ? self : globalThis);\n';
}
if (require.main === module) {
  const files = collect(), out = buildModule(files); fs.writeFileSync(OUT, out);
  console.log('src/demo-data.js généré:', files.length, 'fichiers,', Buffer.byteLength(out) + ' octets (' + (Buffer.byteLength(out) / 1024).toFixed(1) + ' Ko)');
}
module.exports = { collect, buildModule, OUT, FIXTURES };
