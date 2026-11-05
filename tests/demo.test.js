// Données de démonstration embarquées (src/demo-data.js): fraîcheur, équivalence avec le chargement depuis disque, confirmation, visite guidée, absence de données réelles.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('./helpers.js');
const model = require('../src/model.js');
const S = require('../src/scripts.js');
const DL = require('../src/demo-logic.js');
const build = require('../tools/build-demo.js');
const demo = require('../src/demo-data.js');

const norm = (s) => s.replace(/\r\n/g, '\n');

test('src/demo-data.js est à jour par rapport à fixtures/', () => {
  const expected = build.buildModule(build.collect()), actual = fs.readFileSync(build.OUT, 'utf8');
  assert.ok(norm(actual) === norm(expected), "src/demo-data.js n'est plus à jour par rapport à fixtures/ : lancez `npm run build:demo`");
});

test('taille raisonnable du module démo (< 200 Ko)', () => {
  const size = fs.statSync(build.OUT).size; console.log('  demo-data.js:', (size / 1024).toFixed(1) + ' Ko,', demo.count, 'fichiers'); assert.ok(size < 200 * 1024, 'trop gros pour un <script> synchrone: charger paresseusement');
});

test('le chargement démo donne le même résultat que le chargement des fixtures depuis le disque', () => {
  const d = H.load();
  assert.strictEqual(demo.count, demo.files.length); assert.deepStrictEqual(demo.files.map((f) => f.name).sort(), [...d.wfItems, ...d.otherItems].map((f) => f.name).sort());
  // mêmes classifications que le loader (classifyFile) avec le préfixe de dossier ajouté par le sélecteur
  const items = demo.files.map((f) => ({ name: 'demo/' + f.name, text: f.text })), wfItems = items.filter((i) => S.classifyFile(i.name) === 'workflow'), other = items.filter((i) => { const k = S.classifyFile(i.name); return k && k !== 'workflow'; });
  assert.strictEqual(wfItems.length + other.length, demo.count);
  const r = model.loadTexts(wfItems); assert.deepStrictEqual(r.errors, []); assert.strictEqual(r.workflows.size, d.workflows.size);
  d.workflows.forEach((w, id) => { const x = r.workflows.get(id); assert.ok(x, id); assert.strictEqual(x.name, w.name); assert.strictEqual(x.rawText, w.rawText, 'texte brut d\'origine conservé (export fidèle)'); assert.strictEqual(x.nodeCount, w.nodeCount); });
  const store = S.createStore(), sum = store.ingest(other); assert.deepStrictEqual(sum.errors, []); assert.deepStrictEqual(store.counts(), d.store.counts());
  [...d.store.scripts.keys()].forEach((k) => assert.strictEqual(store.script(k).text, d.store.script(k).text)); assert.deepStrictEqual([...store.ps7.keys()].sort(), [...d.store.ps7.keys()].sort()); assert.deepStrictEqual([...store.actions.keys()].sort(), [...d.store.actions.keys()].sort());
  assert.strictEqual(demo.files.find((f) => /\.csv$/.test(f.name)).text.charCodeAt(0), 0xFEFF, 'BOM du CSV conservé');
});

test('confirmation avant mélange: seulement si des workflows non démo sont chargés', () => {
  const demoIds = new Set(['d1', 'd2']);
  assert.strictEqual(DL.needsConfirm([], demoIds), false); assert.strictEqual(DL.needsConfirm(['d1', 'd2'], demoIds), false); assert.strictEqual(DL.needsConfirm(['d1', 'real'], demoIds), true); assert.strictEqual(DL.needsConfirm(['real'], new Set()), true); assert.strictEqual(DL.needsConfirm(['x'], null), true);
});

test('visite guidée: étapes cohérentes avec les données de démo', () => {
  const ids = DL.findIds(demo.files); assert.strictEqual(ids.workflows.length, 7); assert.ok(ids.onb && ids.copy && ids.onb !== ids.copy);
  const steps = DL.tourSteps(ids); assert.ok(steps.length >= 3 && steps.length <= 6); const valid = new Set(ids.workflows.map((w) => w.id));
  steps.forEach((s) => { assert.ok(s.title && s.text && s.target, s.id); assert.ok(valid.has(s.hash.wf), s.id); assert.ok(['detail', 'compare', 'quality', 'analysis', 'flow', 'calls', 'impact', 'global'].includes(s.hash.tab)); if (s.hash.tab === 'compare') assert.ok(valid.has(s.hash.cmp)); });
  assert.ok(steps.some((s) => s.id === 'compare') && steps.some((s) => s.id === 'quality') && steps.some((s) => s.id === 'expert') && steps.some((s) => s.id === 'edit'));
  assert.deepStrictEqual(DL.findIds([{ name: 'x.json', text: '{oops' }, { name: 'a.txt', text: '' }]).workflows, []);
});

test('le module démo ne contient que des données fictives (GUID synthétiques, e-mails example.com, URL .invalid)', () => {
  const src = fs.readFileSync(build.OUT, 'utf8'), text = demo.files.map((f) => f.text).join('\n');
  (text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || []).forEach((g) => assert.ok(/^00000000-0000-4000-8000-/.test(g) || /^[a-f]{8}-1111-4111-8111/i.test(g), 'GUID non synthétique: ' + g.slice(0, 8)));
  (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).forEach((e) => assert.ok(/@example\.com$/.test(e), 'e-mail non fictif'));
  (text.match(/https?:\/\/[^\s"'\<>)]+/g) || []).forEach((u) => assert.ok(/^http:\/\/json-schema\.org\//.test(u) || /^https:\/\/example\.invalid\//.test(u), 'URL inattendue: ' + u.slice(0, 20)));
  assert.ok(!/[A-Za-z]:(\\|\/)+(Users|dev)/i.test(src), 'chemin local dans le module démo'); assert.match(src, /AUTO-GÉNÉRÉ/);
});
