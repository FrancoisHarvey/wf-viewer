// Chargement des données de test. Chemin configurable: WFV_DATA (défaut ./fixtures, jeu synthétique du dépôt).
'use strict';
const fs = require('fs');
const path = require('path');
const model = require('../src/model.js');
const S = require('../src/scripts.js');
require('../src/i18n.js').setLang('fr'); // les tests fixent explicitement la langue (pas de dépendance à l'environnement)

const DATA = process.env.WFV_DATA ? path.resolve(process.env.WFV_DATA) : path.join(__dirname, '..', 'fixtures');

function walk(dir, acc) {
  acc = acc || [];
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, acc); else acc.push(p); }
  return acc.sort();
}
const rel = (p) => path.relative(DATA, p).replace(/\\/g, '/');
const decode = (buf) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf); // conserve le BOM éventuel

function load() {
  const files = walk(DATA);
  const buffers = new Map(), wfItems = [], otherItems = [];
  for (const f of files) {
    const kind = S.classifyFile(rel(f)); if (!kind) continue;
    const buf = fs.readFileSync(f), item = { name: rel(f), text: decode(buf) };
    if (kind === 'workflow') { wfItems.push(item); buffers.set(item.name, buf); } else otherItems.push(item);
  }
  const { workflows, errors } = model.loadTexts(wfItems);
  const store = S.createStore(); const sum = store.ingest(otherItems);
  return { dir: DATA, wfItems, otherItems, buffers, workflows, errors, store, sum, all: [...workflows.values()], byName: (n) => [...workflows.values()].find((w) => w.name === n) };
}
module.exports = { DATA, load, walk, rel, decode };
