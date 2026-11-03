// Scripts PowerShell, customaction*.raw.txt, CSV PS7: classification, indexation, couverture, parsers tolérants.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers.js');
const S = require('../src/scripts.js');

const d = H.load(), { store, workflows } = d;
const G = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

test('classification des fichiers', () => {
  assert.strictEqual(S.classifyFile('a/b/' + G(101) + '.ps1'), 'script'); assert.strictEqual(S.classifyFile('proposed-fixes/' + G(101) + '.ps1'), 'fix');
  assert.strictEqual(S.classifyFile('customaction.page2.raw.txt'), 'customactions'); assert.strictEqual(S.classifyFile('workflows.raw.txt'), null);
  assert.strictEqual(S.classifyFile('r.CSV'), 'csv'); assert.strictEqual(S.classifyFile('w.json'), 'workflow');
  assert.strictEqual(S.guidOf('x/' + G(101).toUpperCase() + '.ps1'), G(101));
});

test('indexation des fixtures: 2 scripts, 1 correctif, 3 custom actions (2 pages), 2 lignes PS7', () => {
  assert.deepStrictEqual(d.sum.errors, []); assert.deepStrictEqual(store.counts(), { scripts: 2, fixes: 1, actions: 3, ps7: 2 });
  assert.strictEqual(store.report(G(101)).Status, 'Risk'); assert.strictEqual(store.report(G(103)).Status, 'OK'); assert.strictEqual(store.action(G(102)).state, 'UnderReview');
  assert.strictEqual(store.script(G(101)).text.charCodeAt(0) === 0xFEFF, false);
});

test('couverture des nodes custom', () => {
  const c = S.coverage(store, workflows);
  assert.deepStrictEqual({ nodes: c.nodes, ids: c.ids, withScript: c.withScript, withTitle: c.withTitle, withReport: c.withReport, nodesWithScript: c.nodesWithScript, nodesWithTitle: c.nodesWithTitle }, { nodes: 7, ids: 4, withScript: 2, withTitle: 3, withReport: 2, nodesWithScript: 4, nodesWithTitle: 6 });
  assert.deepStrictEqual(c.missingScript.sort(), [G(102), G(104)]); assert.deepStrictEqual(c.missingTitle, [G(104)]);
});

test('analyse des scripts: param(), attributs obligatoires, variables', () => {
  const a = store.analysis(G(101)); assert.strictEqual(a.hasParam, true); assert.deepStrictEqual(a.params.map((p) => p.name), ['UserPrincipalName', 'groupIds', 'Mode']);
  assert.deepStrictEqual(a.params.map((p) => p.mandatory), [true, false, true]); assert.strictEqual(a.params[0].type, 'string'); assert.ok(a.vars.userprincipalname >= 3); assert.ok(a.lines > 30 && a.bytes > 500);
  assert.deepStrictEqual(store.analysis(G(103)).params.map((p) => p.name), ['Name']); assert.strictEqual(store.analysis(G(999)), null);
});

test('analyseur: cas synthétiques', () => {
  const a = S.analyzeScript('# c\nparam (\n  [Parameter(Mandatory=$true)][string]$UserPrincipalName,\n  [int]$N = 5,\n  $x\n)\n$y = $UserPrincipalName + "$N"');
  assert.deepStrictEqual(a.params.map((p) => p.name), ['UserPrincipalName', 'N', 'x']); assert.strictEqual(a.params[1].type, 'int'); assert.strictEqual(a.params[1].default, '5'); assert.strictEqual(a.params[0].mandatory, true);
  assert.strictEqual(a.vars.userprincipalname, 2); assert.strictEqual(S.analyzeScript('Write-Host 1').hasParam, false);
});

test('parsers tolérants (pages concaténées, page tronquée, CSV avec BOM et retours à la ligne)', () => {
  const page = '{"customActions":[{"id":"a","title":"A"}],"metadata":{}}';
  const r = S.parseCustomActions('﻿' + page + '\n' + page.replace('"a"', '"b"') + '\n{"customActions":[{"id":"c"');
  assert.deepStrictEqual(r.actions.map((a) => a.id), ['a', 'b']); assert.ok(r.errors.length >= 1); assert.strictEqual(S.parseCustomActions('pas du json').actions.length, 0);
  const c = S.parseCsv('﻿"A","B"\r\n"x,1","l1\nl2 ""q"""\r\n"y",""\r\n');
  assert.deepStrictEqual(c.header, ['A', 'B']); assert.strictEqual(c.rows.length, 2); assert.strictEqual(c.rows[0].B, 'l1\nl2 "q"'); assert.strictEqual(c.rows[0].A, 'x,1');
});

test('recherche dans les scripts', () => {
  const r = S.searchScripts(store, 'Get-MgUser'); assert.ok(r.length >= 1); assert.ok(r.every((x) => store.lower(x.id).includes('get-mguser')));
  assert.strictEqual(S.searchScripts(store, 'ZZZ_ABSENT').length, 0); assert.strictEqual(S.searchScripts(store, '').length, 0);
});
