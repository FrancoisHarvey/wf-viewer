// Linter, flux de données, graphe d'appels, impact: tests synthétiques (positif/négatif) + fixtures.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers.js');
const model = require('../src/model.js');
const S = require('../src/scripts.js');
const L = require('../src/lint.js');
const G = require('../src/graph.js');

const d = H.load(), { workflows, store } = d;
const G0 = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

// ---------- fabrique de workflows synthétiques ----------
let u = 0; const uid = () => '00000000-0000-4000-8000-' + String(++u).padStart(12, '0');
const out = (props) => JSON.stringify({ type: 'object', properties: props });
function node(id, name, settings, extra) {
  return Object.assign({ id, uid: uid(), name, settings: JSON.stringify(settings || {}), inputSchema: '{}', filter: { conditions: [], conditionGroups: [] }, forceSkip: false, parentUid: null, successOutputSchema: out({ isSuccessEvent: { type: 'boolean' } }), failureOutputSchema: null, customDescription: null, trueBranch: [], falseBranch: [] }, extra || {});
}
function wfOf(actions, opts) {
  opts = opts || {}; const id = opts.id || uid();
  const d = { id, workflowName: opts.name || 'WF ' + id.slice(-4), status: opts.status || 'Active', inputSchema: JSON.stringify({ type: 'object', properties: opts.inputs || {}, required: opts.required || [] }), targetsConfig: { targets: ['{}'] }, filter: null, actions, catchActions: opts.catchActions || [], parentWorkflowIds: opts.parents || [] };
  return model.parseWorkflowText(JSON.stringify({ data: d }), id + '.json').wf;
}
const tok = (kind, a, b) => (kind === 'in' ? '{{input::input-stepUid::' + a + '::' + a + '}}' : '{{action::' + a + '::' + b + '::X}}');
const lint = (wf, extraCtx, enabled) => L.lintWorkflow(wf, Object.assign({ wfs: new Map([[wf.id, wf]]), store: null, cg: G.callGraph(new Map([[wf.id, wf]])) }, extraCtx || {}), enabled);
const has = (issues, rule) => issues.filter((i) => i.rule === rule);

test('règle token-malformed: positif / négatif', () => {
  assert.strictEqual(has(lint(wfOf([node('Management|X.A', 'a', { v: '{{action::abc::response[0}::L}}' })])), 'token-malformed').length, 1);
  assert.strictEqual(has(lint(wfOf([node('Management|X.A', 'a', { v: '{{input::input-stepUid::p::p}}' })], { inputs: { p: {} } })), 'token-malformed').length, 0);
});
test('règle path-suspect: faute de frappe / casse / schéma; négatif', () => {
  const src = node('CustomManagementAction|g1', 'src', {}), ok = node('Management|X.B', 'b', { v: tok('ac', src.uid, 'response[0].Name') });
  assert.strictEqual(has(lint(wfOf([src, ok])), 'path-suspect').length, 0);
  const bad = node('Management|X.B', 'b', { v: tok('ac', src.uid, 'reponse[0].Name'), w: tok('ac', src.uid, 'Response[0].Name') });
  assert.strictEqual(has(lint(wfOf([src, bad])), 'path-suspect').length, 2);
  const nat = node('Management|X.Nat', 'nat', {}, { successOutputSchema: out({ propertiesValue: {}, isSuccessEvent: {} }) });
  assert.strictEqual(has(lint(wfOf([nat, node('Management|X.B', 'b', { v: tok('ac', nat.uid, 'propertiesValu.X') })])), 'path-suspect').length, 1);
  assert.strictEqual(has(lint(wfOf([nat, node('Management|X.B', 'b', { v: tok('ac', nat.uid, 'propertiesValue.X') })])), 'path-suspect').length, 0);
  assert.strictEqual(has(lint(wfOf([src, node('Management|X.B', 'b', { v: tok('ac', src.uid, 'response') })])), 'path-suspect')[0].severity, 'info');
});
test('règles ref-missing / ref-order', () => {
  const a = node('Management|X.A', 'a', {}), b = node('Management|X.B', 'b', {});
  assert.strictEqual(has(lint(wfOf([a, node('Management|X.C', 'c', { v: tok('ac', 'inexistant', 'response[0]') })])), 'ref-missing').length, 1);
  assert.strictEqual(has(lint(wfOf([a, node('Management|X.C', 'c', { v: tok('ac', a.uid, 'response[0]') })])), 'ref-missing').length, 0);
  b.settings = JSON.stringify({ v: tok('ac', 'LATER', 'response[0]') }); const later = node('Management|X.L', 'later', {}); later.uid = 'LATER';
  assert.strictEqual(has(lint(wfOf([b, later])), 'ref-order').length, 1);
  assert.strictEqual(has(lint(wfOf([later, b])), 'ref-order').length, 0);
});
test('règle output-unused: positif / négatif (effet de bord, contrôle exclus)', () => {
  const prod = node('Management|X.P', 'p', {}, { successOutputSchema: out({ response: {}, isSuccessEvent: {} }) });
  assert.strictEqual(has(lint(wfOf([prod])), 'output-unused').length, 1);
  assert.strictEqual(has(lint(wfOf([prod, node('Management|X.C', 'c', { v: tok('ac', prod.uid, 'response[0]') })])), 'output-unused').length, 0);
  assert.strictEqual(has(lint(wfOf([node('Management|X.SideEffect', 's', {})])), 'output-unused').length, 0);
  assert.strictEqual(has(lint(wfOf([node('item::delay', 'd', { waitDuration: 1 }, { successOutputSchema: out({ response: {} }) })])), 'output-unused').length, 0);
});
test('règles input-unused / input-undeclared', () => {
  const w1 = wfOf([node('Management|X.A', 'a', { v: tok('in', 'p') })], { inputs: { p: {}, q: {} }, required: ['q'] });
  const iss = has(lint(w1), 'input-unused'); assert.strictEqual(iss.length, 1); assert.strictEqual(iss[0].severity, 'warning'); assert.match(iss[0].message, /q/);
  const w2 = wfOf([node('Management|X.A', 'a', { v: tok('in', 'p') })], { inputs: { p: {}, q: {} } }); assert.strictEqual(has(lint(w2), 'input-unused')[0].severity, 'info');
  assert.strictEqual(has(lint(wfOf([node('Management|X.A', 'a', { v: tok('in', 'p') })], { inputs: { p: {} } })), 'input-unused').length, 0);
  assert.strictEqual(has(lint(wfOf([node('Management|X.A', 'a', { v: tok('in', 'zz') })], { inputs: { p: {} } })), 'input-undeclared').length, 1);
  assert.strictEqual(has(lint(wfOf([node('Management|X.A', 'a', { v: '{{input::undefined::Workflow_ExecutedBy::X}}' })], { inputs: {} })), 'input-undeclared').length, 0, 'variable système exclue');
});
test('règle nested-target: hors lot / manquant / présent', () => {
  const callee = wfOf([node('Management|X.A', 'a', {})]);
  const caller = wfOf([node('item::executenestedworkflow', 'n', { workflowId: callee.id })]);
  const m = new Map([[callee.id, callee], [caller.id, caller]]), ctx = { wfs: m, store: null, cg: G.callGraph(m) };
  assert.strictEqual(has(L.lintWorkflow(caller, ctx), 'nested-target').length, 0);
  const out1 = wfOf([node('item::executenestedworkflow', 'n', { workflowId: 'ailleurs' })]); assert.strictEqual(has(lint(out1), 'nested-target')[0].severity, 'warning');
  assert.strictEqual(has(lint(wfOf([node('item::executenestedworkflow', 'n', {})])), 'nested-target')[0].severity, 'error');
});
test('règles seq-empty / if-no-branch', () => {
  const seq = node('item::sequence', 's', {}); assert.strictEqual(has(lint(wfOf([seq])), 'seq-empty').length, 1);
  const kid = node('Management|X.A', 'a', {}, { parentUid: seq.uid }); assert.strictEqual(has(lint(wfOf([seq, kid])), 'seq-empty').length, 0);
  assert.strictEqual(has(lint(wfOf([node('item::if-else', 'i', {})])), 'if-no-branch').length, 1);
  assert.strictEqual(has(lint(wfOf([node('item::if-else', 'i', {}, { trueBranch: [node('Management|X.A', 'a', {})] })])), 'if-no-branch').length, 0);
});
test('règle nested-cycle: direct, indirect, sans cycle', () => {
  const a = wfOf([node('item::executenestedworkflow', 'n', { workflowId: 'B' })], { id: 'A' }), b = wfOf([node('item::executenestedworkflow', 'n', { workflowId: 'A' })], { id: 'B' });
  const m = new Map([['A', a], ['B', b]]), cg = G.callGraph(m); assert.strictEqual(cg.cycles.length, 1); assert.deepStrictEqual(cg.cycles[0].members.sort(), ['A', 'B']);
  assert.strictEqual(has(L.lintWorkflow(a, { wfs: m, cg }), 'nested-cycle').length, 1);
  const self = wfOf([node('item::executenestedworkflow', 'n', { workflowId: 'S' })], { id: 'S' }); const ms = new Map([['S', self]]); assert.strictEqual(G.callGraph(ms).cycles.length, 1);
  const c = wfOf([node('item::executenestedworkflow', 'n', { workflowId: 'D' })], { id: 'C' }), d = wfOf([node('Management|X.A', 'a', {})], { id: 'D' });
  const mn = new Map([['C', c], ['D', d]]); assert.strictEqual(G.callGraph(mn).cycles.length, 0); assert.strictEqual(has(L.lintWorkflow(c, { wfs: mn, cg: G.callGraph(mn) }), 'nested-cycle').length, 0);
  // 3 workflows A->B->C->A
  const x = ['X', 'Y', 'Z'].map((id, i) => wfOf([node('item::executenestedworkflow', 'n', { workflowId: ['Y', 'Z', 'X'][i] })], { id })); const m3 = new Map(x.map((w) => [w.id, w]));
  assert.strictEqual(G.callGraph(m3).cycles[0].members.length, 3);
});
test('règles scripts: ps7-status, script-missing, param-missing (positif/négatif)', () => {
  const st = S.createStore(); const g = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', g2 = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
  st.ingest([{ name: 'x/' + g + '.ps1', text: 'param ([Parameter(Mandatory=$true)][string]$Upn, [string]$Opt)\nWrite-Host $Upn' }, { name: 'r.csv', text: '"File","ActionName","ActionId","Status","Issues"\n"' + g + '.ps1","Mon action","' + g + '","Blocker","Remoting"\n"' + g2 + '.ps1","Autre","' + g2 + '","OK",""' }]);
  const n1 = node('CustomManagementAction|' + g, 'c1', { Opt: 'x' }), n2 = node('CustomManagementAction|' + g2, 'c2', {}), n3 = node('CustomManagementAction|' + g, 'c3', { Upn: 'u' });
  const iss = lint(wfOf([n1, n2, n3]), { store: st });
  assert.strictEqual(has(iss, 'ps7-status').length, 2, 'Blocker x2 nodes, OK exclu'); assert.strictEqual(has(iss, 'ps7-status')[0].severity, 'error');
  assert.strictEqual(has(iss, 'script-missing').length, 1); assert.strictEqual(has(iss, 'param-missing').length, 1); assert.match(has(iss, 'param-missing')[0].message, /\$Upn/);
  assert.strictEqual(has(lint(wfOf([n1, n2, n3])), 'script-missing').length, 0, 'sans scripts chargés: aucune alerte');
  assert.strictEqual(has(lint(wfOf([n3]), { store: st }), 'param-missing').length, 0);
});
test('règle native-key-unknown: positif / négatif', () => {
  const ok = node('Management|Example.Messages.Commands.Management.UnlockUser', 'u', { userPrincipalName: 'x' }), bad = node('Management|Example.Messages.Commands.Management.UnlockUser', 'u', { zzUnknown: 'x' });
  assert.strictEqual(has(lint(wfOf([ok])), 'native-key-unknown').length, 0); const r = has(lint(wfOf([bad])), 'native-key-unknown'); assert.strictEqual(r.length, 1); assert.strictEqual(r[0].severity, 'info');
});
test('règles activables / désactivables', () => {
  const w = wfOf([node('item::sequence', 's', {})]); assert.strictEqual(has(lint(w, null, { 'seq-empty': false }), 'seq-empty').length, 0); assert.strictEqual(has(lint(w, null, {}), 'seq-empty').length, 1);
  assert.ok(L.RULES.every((r) => r.id && r.severity && r.title && typeof r.check === 'function')); assert.strictEqual(new Set(L.RULES.map((r) => r.id)).size, L.RULES.length);
});

test('linter sur les fixtures: aucune exception, compteurs par règle (sans puis avec scripts/CSV)', () => {
  const exp = {
    plain: { sev: { error: 4, warning: 5, info: 18 }, rules: { 'token-malformed': 2, 'input-unused': 17, 'path-suspect': 1, 'input-undeclared': 1, 'output-unused': 1, 'nested-target': 1, 'seq-empty': 1, 'if-no-branch': 1, 'nested-cycle': 2 } },
    scripts: { sev: { error: 6, warning: 8, info: 21 }, rules: { 'param-missing': 2, 'token-malformed': 2, 'ps7-status': 3, 'input-unused': 17, 'script-missing': 3, 'path-suspect': 1, 'input-undeclared': 1, 'output-unused': 1, 'nested-target': 1, 'seq-empty': 1, 'if-no-branch': 1, 'nested-cycle': 2 } }
  };
  for (const [k, st] of [['plain', null], ['scripts', store]]) {
    const all = L.lintAll(L.buildContext(workflows, st)), sm = L.summarize(all);
    all.forEach((iss) => iss.forEach((i) => { assert.ok(i.rule && i.severity && i.message && !/Règle en échec/.test(i.message), i.message); }));
    assert.deepStrictEqual(sm.bySeverity, exp[k].sev); assert.deepStrictEqual(sm.byRule, exp[k].rules);
  }
  const ok = d.byName('Exemple - Appelant racine'); assert.strictEqual(L.counts(L.lintWorkflow(ok, L.buildContext(workflows, null))).error, 0);
});

test('flux de données: toutes les références action:: valides produisent une arête; inputs; layout borné', () => {
  let refs = 0, pairs = 0;
  workflows.forEach((w) => {
    const df = G.dataflow(w), have = new Set(df.edges.filter((e) => e.kind === 'action').map((e) => e.from + '>' + e.to)), want = new Set();
    model.allTokens(w).forEach((o) => { const t = o.token; if (t.kind === 'action' && !t.malformed && w.uidMap[t.uid]) { refs++; if (o.node && o.node.uid !== t.uid) want.add(t.uid + '>' + o.node.uid); } });
    assert.deepStrictEqual([...have].sort(), [...want].sort(), w.name); pairs += want.size;
    const lay = G.layout(w, 50); if (!lay.empty) { lay.edges.forEach((e) => assert.ok(lay.pos[e.from] && lay.pos[e.to])); assert.ok(lay.nodes.length <= 50); }
    df.edges.filter((e) => e.kind === 'input').forEach((e) => assert.ok(df.inputUsers[e.from.slice(3)].includes(e.to)));
  });
  assert.strictEqual(refs, 7); assert.strictEqual(pairs, 7);
  const w1 = d.byName('Exemple - Onboarding'), df = G.dataflow(w1), e = df.edges.find((x) => x.kind === 'action'); assert.ok(G.reach(df, e.from, 'down')[e.to]); assert.ok(G.reach(df, e.to, 'up')[e.from]);
  assert.strictEqual(G.layout(d.byName('Exemple - Sans dépendance')).empty, true);
  const seq = node('item::sequence', 's', {}), k1 = node('Management|X.A', 'k1', {}, { parentUid: seq.uid }), k2 = node('Management|X.B', 'k2', {}, { parentUid: seq.uid }); k2.settings = JSON.stringify({ v: tok('ac', k1.uid, 'response[0]') });
  const lw = G.layout(wfOf([seq, k1, k2])); assert.strictEqual(lw.groups.length, 1); assert.strictEqual(lw.groups[0].count, 2); assert.strictEqual(lw.edges.length, 1);
  // gros workflow synthétique: au plus 50 nodes affichés, sous-colonnes
  const hub = node('Management|X.Hub', 'hub', {}); const many = []; for (let i = 0; i < 80; i++) many.push(node('Management|X.C' + i, 'c' + i, { v: tok('ac', hub.uid, 'response[0]') }));
  const big = G.layout(wfOf([hub].concat(many)), 50); assert.ok(big.nodes.length <= 50); assert.ok(big.hidden >= 31);
});

test('graphe d\'appels des fixtures: arêtes, hors lot, cycle, racines, cohérence parentWorkflowIds', () => {
  const cg = G.callGraph(workflows);
  assert.strictEqual(cg.edges.length, 7); assert.strictEqual(cg.outOfLot.length, 1); assert.strictEqual(cg.distinctPairs, 7); assert.strictEqual(cg.cycles.length, 1);
  assert.deepStrictEqual(cg.cycles[0].members.map((id) => workflows.get(id).name).sort(), ['Exemple - Cycle A', 'Exemple - Cycle B']);
  assert.deepStrictEqual(cg.roots.map((id) => workflows.get(id).name).sort(), ['Exemple - Appelant racine', 'Exemple - Onboarding (copie)']); assert.strictEqual(cg.orphans.length, 1); assert.strictEqual(workflows.get(cg.orphans[0]).name, 'Exemple - Sans dépendance');
  assert.strictEqual(cg.maxDepth, 2); assert.strictEqual(cg.components.length, 2); assert.strictEqual(cg.missingInParent.length, 4); assert.strictEqual(cg.extraInParent.length, 0);
  workflows.forEach((w) => (w.data.parentWorkflowIds || []).forEach((p) => assert.ok(cg.inn[w.id] && cg.inn[w.id][p])));
  const root = d.byName('Exemple - Appelant racine'), t = G.tree(cg, root.id, 'down'); assert.strictEqual(t.children.length, 3); assert.ok(G.closure(cg, d.byName('Exemple - Sous-flux licences').id, 'up').length === 3);
  const a = wfOf([node('item::executenestedworkflow', 'n', { workflowId: 'B' })], { id: 'A' }), b = wfOf([node('item::executenestedworkflow', 'n', { workflowId: 'A' })], { id: 'B' });
  assert.strictEqual(G.tree(G.callGraph(new Map([['A', a], ['B', b]])), 'A', 'down').children[0].children[0].cyclic, true);
});

test('impact d\'une custom action: somme des nodes, transitif, Markdown, variables/fonctions', () => {
  const cg = G.callGraph(workflows), ids = new Set(); workflows.forEach((w) => w.all.forEach((n) => { if (n.type === 'CustomManagementAction') ids.add(n.typeRef.toLowerCase()); }));
  let sum = 0; ids.forEach((g) => { sum += G.impactOfAction(workflows, store, g, cg).uses.length; }); assert.strictEqual(ids.size, 4); assert.strictEqual(sum, 7);
  const im = G.impactOfAction(workflows, store, G0(101), cg); assert.strictEqual(im.uses.length, 3); assert.strictEqual(im.title, 'Exemple - Vérifier appartenance'); assert.strictEqual(im.report.Status, 'Risk'); assert.ok(im.hasScript);
  assert.deepStrictEqual(im.directWfs.map((w) => w.name).sort(), ['Exemple - Onboarding', 'Exemple - Onboarding (copie)', 'Exemple - Sous-flux licences']); assert.deepStrictEqual(im.indirect.map((x) => x.wf.name), ['Exemple - Appelant racine']);
  assert.strictEqual(im.active, 2); assert.match(G.impactMarkdown(im), /Exemple - Vérifier appartenance/);
  const g = 'cccccccc-1111-4111-8111-cccccccccccc', b = wfOf([node('CustomManagementAction|' + g, 'c', {})], { id: 'B', status: 'Inactive' }), a = wfOf([node('item::executenestedworkflow', 'n', { workflowId: 'B' })], { id: 'A' }), z = wfOf([node('item::executenestedworkflow', 'n', { workflowId: 'A' })], { id: 'Z' });
  const m = new Map([['A', a], ['B', b], ['Z', z]]), i2 = G.impactOfAction(m, null, g); assert.deepStrictEqual(i2.indirect.map((x) => x.wf.id).sort(), ['A', 'Z']); assert.deepStrictEqual(i2.indirect.find((x) => x.wf.id === 'Z').chain, ['Z', 'A', 'B']); assert.strictEqual(i2.active, 0);
  assert.match(G.impactMarkdown(i2), /Z → A → B/);
  assert.ok(G.impactOfToken(workflows, 'var', 'UPN').uses.length >= 10); assert.strictEqual(G.impactOfToken(workflows, 'fn', 'removeSpaces').uses.length, 1);
});
