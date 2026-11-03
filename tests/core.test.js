// Modèle, refs, diff, analyse, inputs, natives. Données: ./fixtures (WFV_DATA pour changer).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./helpers.js');
const model = require('../src/model.js');
const refs = require('../src/refs.js');
const diff = require('../src/diff.js');
const analysis = require('../src/analysis.js');
const inputs = require('../src/inputs.js');
const natives = require('../src/natives.js');

const d = H.load();
const { workflows } = d;
const W1 = d.byName('Exemple - Onboarding'), W2 = d.byName('Exemple - Sous-flux licences'), W3 = d.byName('Exemple - Onboarding (copie)');

test('les fixtures se chargent sans erreur (7 workflows, 39 nodes)', () => {
  assert.deepStrictEqual(d.errors, []); assert.strictEqual(workflows.size, 7); assert.ok(W1 && W2 && W3);
  assert.strictEqual(d.all.reduce((a, w) => a + w.nodeCount, 0), 39);
  d.wfItems.forEach((it) => { const j = JSON.parse(it.text); assert.deepStrictEqual(Object.keys(j), ['data']); assert.strictEqual(Object.keys(j.data).length, 33); });
});

test('fichiers invalides tolérés', () => {
  const r = model.loadTexts([{ name: 'a.json', text: '{oops' }, { name: 'b.json', text: '{"data":{"x":1}}' }, { name: 'c.json', text: '[1]' }]);
  assert.strictEqual(r.workflows.size, 0); assert.strictEqual(r.errors.length, 3);
});

test('arbre normalisé: chaque node une seule fois, branches et catch comptés', () => {
  let actions = 0, catchN = 0, total = 0;
  workflows.forEach((w) => {
    actions += w.data.actions.length; catchN += w.data.catchActions.length; total += w.nodeCount;
    const seen = new Set(); (function walk(l) { l.forEach((n) => { assert.ok(!seen.has(n)); seen.add(n); walk(n.children); walk(n.trueBranch); walk(n.falseBranch); }); })(w.main.concat(w.catchList));
    assert.strictEqual(seen.size, w.nodeCount);
  });
  assert.strictEqual(catchN, 3 - 1 + 0 + (catchN - 2)); // W1 et W3 ont chacun un catch
  assert.strictEqual(catchN, 2); assert.strictEqual(total - actions - catchN, 6, 'branches imbriquées (3 dans W1 + 3 dans W3)');
});

test('séquences: enfants rattachés par parentUid', () => {
  const seq = W1.all.find((n) => n.kind === 'sequence'); assert.strictEqual(seq.children.length, 2); seq.children.forEach((c) => assert.strictEqual(c.raw.parentUid, seq.uid));
  assert.strictEqual(W1.main.length, 6, '8 actions à plat - 2 enfants de séquence'); W1.main.forEach((n) => assert.ok(!n.raw.parentUid || n.parent === null));
});

test('extraction des tokens: comptes et cohérence avec la regex brute', () => {
  let total = 0, mal = 0, input = 0, action = 0;
  workflows.forEach((w) => model.allTokens(w).forEach((o) => { total++; if (o.token.malformed) mal++; else if (o.token.kind === 'input') input++; else if (o.token.kind === 'action') action++; }));
  assert.deepStrictEqual({ total, mal, input, action }, { total: 34, mal: 2, input: 25, action: 7 });
  let raw = 0; d.wfItems.forEach((it) => { raw += (it.text.match(/\{\{[^{}]*\}\}/g) || []).length; }); assert.strictEqual(input + action, raw);
  const t = refs.extractTokens('x {{input::undefined::p::L::removeSpaces()}} {{action::u1::response[0}::L}} {{a');
  assert.strictEqual(t.length, 3); assert.strictEqual(t[0].system, true); assert.deepStrictEqual(t[0].fns[0], { name: 'removeSpaces', args: '' }); assert.ok(t[1].malformed && t[2].malformed);
  assert.strictEqual(refs.normalizeString('{{action::U1::p::L}}', (u) => (u === 'U1' ? 'Nom#1' : undefined)), '{{action::@Nom#1::p::L}}');
});

test('self-diff = 0 différence (bruit activé et désactivé) pour chaque fixture', () => {
  workflows.forEach((w) => [true, false].forEach((noise) => { const r = diff.diffWorkflows(w, w, { noise }); assert.strictEqual(r.total, 0, w.name); assert.strictEqual(r.summary.same, w.nodeCount); }));
});

test('diff d\'un workflow dupliqué et de son original', () => {
  assert.strictEqual(W3.duplicatedOfId, W1.id);
  const r = diff.diffWorkflows(W1, W3, { noise: true }), s = r.summary;
  assert.strictEqual(s.same + s.modified + s.removed, W1.nodeCount); assert.strictEqual(s.same + s.modified + s.added, W3.nodeCount);
  assert.strictEqual(s.added, 1); assert.strictEqual(s.removed, 0); assert.ok(s.modified >= 2, 'délai et courriel renommé');
  assert.ok(r.header.some((c) => c.path === 'workflowName') && r.header.some((c) => c.path === 'status'));
  assert.ok(diff.diffWorkflows(W1, W3, { noise: false }).total > r.total, 'le bruit (ids, dates…) ajoute des différences');
  const ic = r.inputs; assert.strictEqual(ic.summary.added, 1); assert.strictEqual(ic.summary.removed, 1); assert.ok(ic.summary.modified >= 2, 'enum Langue + requis DisplayName');
  const langue = ic.items.find((i) => i.name === 'Langue'), ec = langue.changes.find((c) => c.field === 'enum'); assert.deepStrictEqual(ec.added, ['ES']); assert.deepStrictEqual(ec.removed, []);
  assert.ok(ic.items.find((i) => i.name === 'DisplayName').changes.some((c) => c.field === 'required'));
});

test('normalisation des uid: copie avec uid régénérés = 0 diff (hors token mal formé)', () => {
  let text = W2.rawText; W2.all.forEach((n, i) => { text = text.split(n.uid).join('99999999-0000-4000-8000-' + String(i).padStart(12, '0')); });
  const copy = model.parseWorkflowText(text, 'copy.json').wf; assert.notStrictEqual(copy.all[0].uid, W2.all[0].uid);
  assert.strictEqual(diff.diffWorkflows(W2, copy).total, 0); assert.ok(diff.diffWorkflows(W2, copy, { noise: false }).total > 0);
});

test('diff de nodes: résumé natif avant/après', () => {
  const obj = JSON.parse(W1.rawText); const delay = obj.data.actions.find((n) => n.id === 'item::if-else').trueBranch.find((n) => n.id === 'item::delay'); delay.settings = JSON.stringify({ waitDuration: 99999 });
  const mod = model.parseWorkflowText(JSON.stringify(obj), 'm.json').wf, r = diff.diffWorkflows(W1, mod);
  const all = []; (function w(items) { items.forEach((i) => { all.push(i); Object.values(i.sub).forEach(w); }); })(r.main);
  const it = all.find((i) => i.status === 'modified' && i.descA && i.descA.label === 'Délai'); assert.ok(it && it.summaryChanged); assert.match(it.descB.summary, /27 h 46 min 39 s/);
  assert.ok(all.filter((i) => i !== it).every((i) => !i.summaryChanged));
});

test('diff d\'inputs typé: ajout / suppression / enum / requis (synthétique)', () => {
  const obj = JSON.parse(W1.rawText), sch = JSON.parse(obj.data.inputSchema);
  delete sch.properties.Quota; sch.properties.Nouveau = { type: 'boolean', title: 'Nouveau', inputDescription: 'neuf', inputTargetType: 'noTarget' };
  sch.properties.Langue.enum = ['EN', 'DE']; sch.required = ['UPN', 'ManagerEmail']; obj.data.inputSchema = JSON.stringify(sch);
  const mod = model.parseWorkflowText(JSON.stringify(obj), 'm.json').wf, r = diff.diffWorkflows(W1, mod), by = Object.fromEntries(r.inputs.items.map((i) => [i.name, i]));
  assert.strictEqual(by.Quota.status, 'removed'); assert.strictEqual(by.Nouveau.status, 'added'); assert.strictEqual(by.Nouveau.b.kind, 'boolean');
  const ec = by.Langue.changes.find((c) => c.field === 'enum'); assert.deepStrictEqual(ec.added, ['DE']); assert.deepStrictEqual(ec.removed, ['FR']);
  assert.ok(by.ManagerEmail.changes.some((c) => c.field === 'required' && c.after === true)); assert.ok(by.UPN.status === 'same');
  assert.ok(!r.header.some((c) => /^inputSchema\.(properties|required)/.test(c.path))); assert.ok(r.rawInputs.length > 0);
  assert.deepStrictEqual(diff.diffWorkflows(mod, mod).inputs.summary.modified, 0);
});

test('analyse: variables, fonctions, nested hors lot, références', () => {
  const a2 = analysis.analyzeWorkflow(W2, workflows); assert.strictEqual(a2.fns.removeSpaces.count, 1); assert.ok(a2.variables.UPN.count >= 3); assert.ok(a2.variables.Fantome);
  assert.deepStrictEqual(a2.broken, []); const a1 = analysis.analyzeWorkflow(W1, workflows); assert.strictEqual(a1.malformed.length, 1);
  const root = d.byName('Exemple - Appelant racine'); assert.strictEqual(analysis.analyzeWorkflow(root, workflows).nestedOut.length, 1);
  const g = analysis.buildGlobal(workflows); assert.ok(g.types.length >= 8 && g.vars.length > 0);
  const broken = model.parseWorkflowText(JSON.stringify({ data: Object.assign(JSON.parse(W2.rawText).data, {}) }), 'x').wf; // références: uid absent / défini après
  const o = JSON.parse(W2.rawText); const st = JSON.parse(o.data.actions[0].settings); st.z = '{{action::absent::response[0]::X}}'; st.y = '{{action::' + o.data.actions[1].uid + '::response[0]::X}}'; o.data.actions[0].settings = JSON.stringify(st);
  const bw = model.parseWorkflowText(JSON.stringify(o), 'b.json').wf, ab = analysis.analyzeWorkflow(bw, new Map([[bw.id, bw]])); assert.strictEqual(ab.broken.length, 2); assert.ok(broken);
});

test('inputs: classification des 10 catégories typées (W1)', () => {
  const r = inputs.parseInputs(W1), by = Object.fromEntries(r.inputs.map((i) => [i.name, i]));
  const expect = { UPN: 'text', Langue: 'enum', Confirmer: 'yesno', EnvoyerMail: 'boolean', Quota: 'integer', DateDebut: 'datetime', MotDePasse: 'password', ListePerso: 'customlist', Source: 'datasource', Cible: 'target' };
  Object.keys(expect).forEach((k) => assert.strictEqual(by[k].kind, expect[k], k));
  assert.ok(by.UPN.required && !by.DisplayName.required); assert.strictEqual(by.Source.filterable, true); assert.strictEqual(by.Cible.targetLabel, 'Utilisateur'); assert.ok(by.MotDePasse.passwordRules.minLength === 12);
  const c = (p, r2) => inputs.classify('x', p, r2);
  assert.strictEqual(c({ type: 'string', enum: 'oops' }).enumBad, true); assert.strictEqual(c(null).kind, 'text');
  const dd = c({ type: 'number', default: 3, inputDescription: { a: 1 } }, true); assert.ok(dd.hasDefault && dd.required && dd.kind === 'number' && typeof dd.description === 'object');
});

test('natives: chaque node natif a un résumé non vide; cas synthétiques', () => {
  const ctx = { wfName: (id) => (workflows.has(id) ? workflows.get(id).name : null) }; let n = 0, custom = 0;
  workflows.forEach((w) => w.all.forEach((x) => { const r = natives.describe(x, ctx); if (x.type === 'CustomManagementAction') { custom++; assert.strictEqual(r, null); return; } n++; assert.ok(r && r.known && r.summary.trim().length > 3, x.id); assert.ok(!/\[object|NaN/.test(r.summary)); }));
  assert.strictEqual(n + custom, 39); assert.strictEqual(custom, 7);
  const mk = (id, settings, extra) => model.parseWorkflowText(JSON.stringify({ data: { id: 'w', workflowName: 'w', actions: [Object.assign({ id, uid: 'u1', name: 'n', settings: JSON.stringify(settings), parentUid: null, trueBranch: [], falseBranch: [] }, extra || {})], catchActions: [] } }), 'x.json').wf.all[0];
  let r = natives.describe(mk('Generic|X.Y.SendEmailNotification', { to: ['a@example.com'], subject: 'S', body: '<div>Bonjour<br>monde</div><script>alert(1)</script>&amp;' })); assert.match(r.summary, /objet : « S »/); assert.strictEqual(r.src, 'user');
  const body = r.fields.find((f) => f.key === 'body'); assert.strictEqual(body.kind, 'html'); assert.strictEqual(body.text, 'Bonjour\nmonde\n&'); assert.ok(!/[<>]/.test(body.text));
  r = natives.describe(mk('Generic|X.Y.CheckIfMailboxExists', { mailbox: 'm@example.com', timeoutSeconds: '36000' })); assert.match(r.summary, /\(délai max 10 h\)/); assert.strictEqual(r.notes.length, 1);
  r = natives.describe(mk('item::delay', { waitDuration: 300 })); assert.match(r.summary, /5 min/);
  r = natives.describe(mk('item::if-else', {}, { filter: { conditions: [], conditionGroups: [{ conditions: [{ property: 'p', operator: 'IsNotEmpty', value: '', type: 'string' }, { property: 'q', operator: 'IsEqual', value: 'v', type: 'list' }] }] } })); assert.match(r.summary, /^Si p n'est pas vide \(\+1 autre/);
  r = natives.describe(mk('Management|Some.Brand.NewThingCommand', { foo: 'bar', ok: 'true' })); assert.strictEqual(r.known, false); assert.strictEqual(r.label, 'New Thing Command'); assert.strictEqual(r.fields.find((f) => f.key === 'ok').kind, 'bool');
  assert.strictEqual(natives.describe(mk('CustomManagementAction|abc', {})), null); assert.strictEqual(natives.opLabel('IsEqual'), 'égal à'); assert.strictEqual(natives.dur(3725), '1 h 2 min 5 s');
  assert.ok(Object.keys(natives.registry).filter((k) => natives.registry[k].src === 'name').length > 0);
});

test('compatibilité <script> classique: modules purs chargés sans require/module', () => {
  const ctx = { console }; ctx.self = ctx; vm.createContext(ctx);
  ['refs', 'model', 'analysis', 'diff', 'inputs', 'natives', 'scripts', 'labels', 'pshighlight', 'graph', 'lint', 'edit', 'version'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f + '.js'), 'utf8'), ctx, { filename: f + '.js' }));
  assert.deepStrictEqual(Object.keys(ctx.WFV).sort(), ['analysis', 'diff', 'edit', 'graph', 'inputs', 'labels', 'lint', 'model', 'natives', 'pshighlight', 'refs', 'scripts', 'version']);
  assert.strictEqual(ctx.WFV.version, require('../package.json').version);
});
