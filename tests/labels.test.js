// Helpers de la vue de base / expert (libellés lisibles, état hash/localStorage).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('./helpers.js');
const model = require('../src/model.js');
const L = require('../src/labels.js');

const d = H.load(), { workflows } = d;
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test('humanize: tokens action/input et GUID nus', () => {
  const wf = d.byName('Exemple - Onboarding'), o = model.allTokens(wf).find((x) => x.token.kind === 'action' && !x.token.malformed), tn = wf.uidMap[o.token.uid];
  const h = L.humanize('Réf ' + o.token.raw + ' et ' + o.token.uid, wf);
  assert.ok(h.includes('«' + (tn.name || tn.type) + '»'), h); assert.ok(!GUID.test(h), 'plus aucun GUID: ' + h);
  assert.strictEqual(L.humanize('{{input::input-stepUid::Upn::Upn}}', wf), 'input « Upn »'); assert.strictEqual(L.humanize('{{input::undefined::Workflow_ExecutedBy::X}}', wf), 'variable système Workflow_ExecutedBy');
  assert.match(L.humanize('{{action::inconnu::response[0].X::L}}', wf), /node inconnu.*response\[0\]\.X/); assert.strictEqual(L.humanize('uid 11111111-2222-3333-4444-555555555555', null), 'uid 11111111…');
  assert.strictEqual(L.humanize('{{autre::x}}', wf), '{{autre::x}}'); assert.strictEqual(L.humanize(null), null);
});

test('humanize sur tous les tokens des fixtures: aucun GUID résiduel, aucune exception', () => {
  let n = 0, left = 0; workflows.forEach((w) => model.allTokens(w).forEach((o) => { const h = L.humanize(o.token.raw, w); n++; if (GUID.test(h)) left++; }));
  assert.strictEqual(n, 34); assert.strictEqual(left, 0);
});

test('readablePath: chemins de diff -> libellés', () => {
  assert.strictEqual(L.readablePath(''), 'Node'); assert.strictEqual(L.readablePath('name'), 'Nom'); assert.strictEqual(L.readablePath('id'), "Type d'action");
  assert.strictEqual(L.readablePath('settings.groupId'), 'Paramètre « groupId »'); assert.strictEqual(L.readablePath('settings.a.b'), 'Paramètre « a › b »');
  assert.strictEqual(L.readablePath('filter.conditionGroups[0].conditions[1].value'), 'Condition (groupe 1, n°2) — valeur'); assert.strictEqual(L.readablePath('filter.conditions[2].operator'), 'Condition n°3 — opérateur');
  assert.strictEqual(L.readablePath('workflowName'), 'Nom du workflow'); assert.strictEqual(L.readablePath('inputSchema.properties.Upn.type'), 'Input « Upn » — type');
  assert.strictEqual(L.readablePath('targetsConfig.targets[0].fields[1]'), 'Cible n°1 › fields[1]'); assert.strictEqual(L.readablePath('zzz.unknown'), 'zzz.unknown');
});

test('état expert: priorité au hash, sinon localStorage; x conservé/retiré dans le hash', () => {
  assert.strictEqual(L.parseExpert('#wf=1&x=1', '0'), true); assert.strictEqual(L.parseExpert('#wf=1&x=0', '1'), false); assert.strictEqual(L.parseExpert('#wf=1', '1'), true);
  assert.strictEqual(L.parseExpert('', null), false); assert.strictEqual(L.parseExpert('#', undefined), false); assert.strictEqual(L.parseExpert('#wf=1', '0'), false);
  assert.strictEqual(L.withExpertHash('#wf=a&tab=detail', true), '#wf=a&tab=detail&x=1'); assert.strictEqual(L.withExpertHash('#wf=a&x=1&tab=detail', false), '#wf=a&tab=detail');
  assert.strictEqual(L.withExpertHash('', true), '#x=1'); assert.strictEqual(L.withExpertHash('#x=1', false), '#'); assert.strictEqual(L.pick(true, 'raw', 'base'), 'raw'); assert.strictEqual(L.pick(false, 'raw', 'base'), 'base');
});

test('CSS: .tech / .base-only masquent selon body.expert (garde-fou)', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'style.css'), 'utf8');
  assert.match(css, /body:not\(\.expert\) \.tech \{ display: none !important; \}/); assert.match(css, /body\.expert \.base-only \{ display: none !important; \}/);
});
