// Édition + export: round-trip octet pour octet sur les fixtures, puis chaque opération (a-f).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers.js');
const model = require('../src/model.js');
const diff = require('../src/diff.js');
const E = require('../src/edit.js');

const d = H.load(), { workflows, all } = d;
const W1 = d.byName('Exemple - Onboarding'), W2 = d.byName('Exemple - Sous-flux licences'), W3 = d.byName('Exemple - Onboarding (copie)'), W5 = d.byName('Exemple - Sans dépendance');
const sess = (wf) => E.createSession(wf);
const rt = (s) => JSON.parse(E.exportText(s));
const mk = (obj) => model.parseWorkflowText(JSON.stringify(obj), 'x.json').wf;
let seq = 0; const uuid = () => '00000000-0000-4000-8000-0000000f' + String(++seq).padStart(4, '0');
const byName = (wf, name) => wf.all.find((n) => n.name === name);
function nodeDiff(w0, w1) { const r = diff.diffWorkflows(w0, w1, { noise: false }), items = []; (function walk(l) { l.forEach((i) => { items.push(i); Object.values(i.sub).forEach(walk); }); })(r.main.concat(r.catchItems)); return { r, items, modified: items.filter((i) => i.status === 'modified'), added: items.filter((i) => i.status === 'added'), removed: items.filter((i) => i.status === 'removed') }; }

test('round-trip: exports non modifiés identiques octet pour octet (fixtures)', () => {
  let n = 0;
  d.wfItems.forEach((it) => {
    const wf = workflows.get(JSON.parse(it.text).data.id), s = sess(wf), out = Buffer.from(E.exportText(s), 'utf8');
    assert.ok(out.equals(d.buffers.get(it.name)), it.name); assert.strictEqual(E.isDirty(s), false); assert.ok(s.style.exact); assert.strictEqual(E.serializeWith(s.style, wf.root), wf.rawText); n++;
  });
  assert.strictEqual(n, 7);
});

test('round-trip: BOM / CRLF / indentation / saut de ligne final conservés (synthétique)', () => {
  const base = JSON.parse(W1.rawText);
  for (const [ind, eol, bom, tr] of [[2, '\r\n', true, '\r\n'], [4, '\n', false, '\n'], ['\t', '\n', true, ''], [undefined, '\n', true, '\n']]) {
    let t = JSON.stringify(base, null, ind); if (eol === '\r\n') t = t.replace(/\n/g, '\r\n'); t = (bom ? '﻿' : '') + t + tr;
    const wf = model.parseWorkflowText(t, 'a.json').wf, s = sess(wf); assert.strictEqual(E.exportText(s), t); assert.ok(s.style.exact);
    assert.ok(E.run(s, 'x', (dd) => E.setWorkflowField(dd, 'description', 'modifiée')).ok);
    const out = E.exportText(s); assert.strictEqual(out.charCodeAt(0) === 0xFEFF, bom); assert.strictEqual(out.endsWith(tr), true); assert.strictEqual(out.includes('\r\n'), eol === '\r\n');
    assert.strictEqual(out, t.replace(JSON.stringify(base.data.description), JSON.stringify('modifiée'))); assert.ok(E.undo(s) && E.exportText(s) === t);
  }
});

test('(a) nom / description / statut', () => {
  const s = sess(W1);
  assert.ok(E.run(s, 'nom', (dd) => E.setWorkflowField(dd, 'workflowName', 'Nouveau nom')).ok); assert.ok(E.run(s, 'desc', (dd) => E.setWorkflowField(dd, 'description', 'Nouvelle description')).ok);
  assert.ok(E.run(s, 'statut', (dd) => E.setWorkflowField(dd, 'status', 'Inactive')).ok);
  assert.strictEqual(E.run(s, 'x', (dd) => E.setWorkflowField(dd, 'status', 'Bizarre')).ok, false); assert.strictEqual(E.run(s, 'x', (dd) => E.setWorkflowField(dd, 'workflowName', '  ')).ok, false);
  const nd = nodeDiff(W1, mk(rt(s))); assert.deepStrictEqual(nd.r.header.map((c) => c.path).sort(), ['description', 'status', 'workflowName']); assert.strictEqual(nd.r.summary.modified + nd.r.summary.added + nd.r.summary.removed, 0);
  assert.strictEqual(diff.diffValues(W1.root, rt(s), '', []).length, 3); assert.strictEqual(s.wf.name, 'Nouveau nom');
});

test('(b) valeur de setting: texte, booléen, liste, JSON imbriqué, accolades mal formées, style conservé', () => {
  const node = byName(W1, 'Lire le compte'), s = sess(W1);
  assert.ok(E.run(s, 'set', (dd) => E.setSetting(dd, node.uid, ['target'], 'Mailbox')).ok);
  const out = rt(s), ch = diff.diffValues(W1.root, out, '', []); assert.strictEqual(ch.length, 1); assert.match(ch[0].path, /settings$/);
  assert.deepStrictEqual(diff.diffValues(JSON.parse(node.raw.settings), JSON.parse(E.findNode(E.dataOf(out), node.uid).node.settings), '', []).map((c) => c.path), ['target']);
  const nd = nodeDiff(W1, mk(out)); assert.strictEqual(nd.modified.length, 1); assert.strictEqual(nd.added.length + nd.removed.length, 0);
  assert.strictEqual(E.run(s, 'bad', (dd) => E.setSetting(dd, node.uid, ['target'], 'x {{input::a::b')).ok, false);
  const r = E.run(s, 'ref', (dd) => E.setSetting(dd, node.uid, ['target'], '{{action::deadbeef-0000-0000-0000-000000000000::response[0]::X}}')); assert.ok(r.ok); assert.ok(r.warnings.some((w) => /uid inconnu/.test(w)));
  const ctl = byName(W2, 'Contrôle'), sb = sess(W2); assert.strictEqual(model.nodeSettings(ctl).Verbose, true);
  assert.ok(E.run(sb, 'bool', (dd) => E.setSetting(dd, ctl.uid, ['Verbose'], false)).ok); assert.strictEqual(JSON.parse(E.findNode(E.dataOf(rt(sb)), ctl.uid).node.settings).Verbose, false);
  const sl = sess(W1); assert.ok(E.run(sl, 'list', (dd) => E.setSetting(dd, node.uid, ['propertiesName', 0], 'Licenses')).ok); assert.deepStrictEqual(JSON.parse(E.findNode(E.dataOf(rt(sl)), node.uid).node.settings).propertiesName, ['Licenses']);
  const synth = JSON.parse(W1.rawText), sn = E.findNode(synth.data, node.uid).node, st = JSON.parse(sn.settings); st.nested = '{"a":1}'; sn.settings = JSON.stringify(st);
  const ws = sess(mk(synth)); assert.strictEqual(E.run(ws, 'j', (dd) => E.setSetting(dd, node.uid, ['nested'], '{oops')).ok, false); assert.ok(E.run(ws, 'j', (dd) => E.setSetting(dd, node.uid, ['nested'], '{"a":2}')).ok);
  const sp = JSON.parse(W1.rawText), spn = E.findNode(sp.data, node.uid).node; spn.settings = JSON.stringify(JSON.parse(spn.settings), null, 2);
  const wsp = sess(mk(sp)); E.run(wsp, 'p', (dd) => E.setSetting(dd, node.uid, ['target'], 'Z')); assert.strictEqual(E.findNode(E.dataOf(rt(wsp)), node.uid).node.settings, JSON.stringify(Object.assign(JSON.parse(spn.settings), { target: 'Z' }), null, 2));
});

test('(c) rechercher/remplacer: aperçu = application, sur tous les workflows', () => {
  const needle = 'UPN', repl = 'ZZZ'; let touched = 0, leaves = 0;
  for (const wf of all) {
    const s = sess(wf); let expected = 0; const cnt = (v) => { if (typeof v === 'string') { if (v.includes(needle)) expected++; } else if (Array.isArray(v)) v.forEach(cnt); else if (v && typeof v === 'object') Object.values(v).forEach(cnt); };
    wf.all.forEach((n) => { cnt(model.nodeSettings(n)); cnt(n.raw.filter); }); cnt(wf.data.filter); (wf.data.targetsConfig.targets || []).forEach((t) => { try { cnt(JSON.parse(t)); } catch (e) { /* */ } });
    const opts = { find: needle, replace: repl, caseSensitive: true }, pre = E.trial(s, (dd) => E.findReplace(dd, opts)); assert.ok(pre.res.ok); assert.strictEqual(pre.res.changes.length, expected, wf.name);
    const r = E.run(s, 'fr', (dd) => E.findReplace(dd, opts)); assert.ok(r.ok);
    if (!expected) { assert.ok(r.noop); assert.strictEqual(E.exportText(s), wf.rawText); continue; }
    touched++; leaves += expected; const out = rt(s);
    assert.ok(diff.diffValues(wf.root, out, '', []).every((c) => /(\.settings|\.filter|^data\.filter|targetsConfig)/.test(c.path)), 'seuls settings/filtres/cibles changent'); assert.strictEqual(nodeDiff(wf, mk(out)).added.length, 0);
    assert.strictEqual(E.findReplace(E.dataOf(JSON.parse(JSON.stringify(out))), opts).changes.length, 0); assert.ok(E.undo(s)); assert.strictEqual(E.exportText(s), wf.rawText);
  }
  assert.ok(touched >= 4 && leaves >= 10); assert.strictEqual(E.run(sess(W2), 'x', (dd) => E.findReplace(dd, { find: '(', regex: true, replace: '' })).ok, false);
  const ci = E.trial(sess(W2), (dd) => E.findReplace(dd, { find: 'upn', replace: 'x', caseSensitive: false })); assert.ok(ci.res.changes.length > 0);
});

test('(d1) remplacer une action par une autre: mapping, exemple catalogue, avertissements', () => {
  const ADD = byName(W1, 'Ajouter au groupe d\'accueil'), tplNode = byName(W3, 'Retirer du groupe temporaire').raw, REM = tplNode.id, s = sess(W1);
  const pre = E.trial(s, (dd) => E.replaceNodeType(dd, ADD.uid, { newId: REM, template: tplNode, mapping: { securityGroupId: null } })); assert.ok(pre.res.ok); assert.ok(pre.res.warnings.some((x) => /non mappées/.test(x)));
  assert.ok(E.run(s, 'type', (dd) => E.replaceNodeType(dd, ADD.uid, { newId: REM, template: tplNode })).ok);
  const out = rt(s), nn = E.findNode(E.dataOf(out), ADD.uid).node;
  assert.strictEqual(nn.id, REM); assert.deepStrictEqual(JSON.parse(nn.settings), JSON.parse(ADD.raw.settings)); assert.strictEqual(nn.successOutputSchema, tplNode.successOutputSchema); assert.strictEqual(nn.categoryItemName, tplNode.categoryItemName);
  assert.ok(diff.diffValues(W1.root, out, '', []).every((c) => !/settings|uid|\.name|filter|parentUid/.test(c.path)), 'ni settings, ni uid, ni nom, ni filtre');
  assert.ok(E.trial(s, (dd) => E.replaceNodeType(dd, ADD.uid, { newId: 'CustomManagementAction|abc' })).res.warnings.some((x) => /catalogue/.test(x)));
  assert.strictEqual(E.replaceNodeType(E.dataOf(JSON.parse(JSON.stringify(W1.root))), W1.all.find((n) => n.kind === 'sequence').uid, { newId: REM }).ok, false);
  assert.ok(E.undo(s)); assert.strictEqual(E.exportText(s), W1.rawText);
});

test('(d2) remplacer une fonction de token: removeSpaces(...) -> truncate(...)', () => {
  const s = sess(W2), r = E.run(s, 'fn', (dd) => E.replaceFunction(dd, { from: 'removeSpaces', to: 'truncate' })); assert.ok(r.ok); assert.strictEqual(r.changes.length, 1);
  const txt = JSON.stringify(rt(s)); assert.ok(!/::removeSpaces\(/.test(txt)); assert.ok(/::truncate\(true,true,true\)/.test(txt));
  assert.ok(E.trial(s, (dd) => E.replaceFunction(dd, { from: 'truncate', to: 'uppercase', args: '' })).res.changes.every((c) => /uppercase\(\)/.test(c.after))); assert.strictEqual(E.replaceFunction({}, { from: 'a b', to: 'c' }).ok, false);
  assert.ok(E.undo(s)); assert.strictEqual(E.exportText(s), W2.rawText);
});

test('(e) renommer un input partout (inputSchema + références)', () => {
  let done = 0;
  for (const wf of all) {
    const names = Object.keys(JSON.parse(wf.data.inputSchema).properties || {}); if (!names.length) continue;
    const cnt = (nm, w) => w.all.reduce((c, n) => c + (JSON.stringify([model.nodeSettings(n), n.raw.filter]).match(new RegExp('\\{\\{input::input-stepUid::' + nm + '::', 'g')) || []).length, 0);
    const nm = names.find((k) => cnt(k, wf) > 0); if (!nm) continue;
    const used = cnt(nm, wf), s = sess(wf), nw = nm + '_RENOMME', before = E.validate(E.dataOf(JSON.parse(JSON.stringify(wf.root)))).broken.length;
    const r = E.run(s, 'rename', (dd) => E.renameInput(dd, nm, nw)); assert.ok(r.ok, r.error); const p1 = JSON.parse(s.wf.data.inputSchema);
    assert.deepStrictEqual(Object.keys(p1.properties), names.map((k) => (k === nm ? nw : k)), 'ordre conservé'); assert.strictEqual(cnt(nm, s.wf), 0); assert.strictEqual(cnt(nw, s.wf), used);
    assert.strictEqual(E.validate(E.dataOf(s.root)).broken.length, before); assert.deepStrictEqual(E.validate(E.dataOf(s.root)).errors, []);
    assert.strictEqual(E.run(s, 'x', (dd) => E.renameInput(dd, nw, names.find((k) => k !== nm) || 'zzz')).ok, names.length > 1 ? false : true);
    while (E.undo(s)); assert.strictEqual(E.exportText(s), wf.rawText); done++;
  }
  assert.ok(done >= 4);
});

test('(f1) supprimer un node: simple, séquence (références cassées), référencé', () => {
  const stop = byName(W1, 'Fin'), s = sess(W1); const r = E.run(s, 'del', (dd) => E.deleteNode(dd, stop.uid)); assert.ok(r.ok); assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(s.wf.nodeCount, W1.nodeCount - 1); const nd = nodeDiff(W1, mk(rt(s))); assert.strictEqual(nd.removed.length, 1); assert.strictEqual(nd.added.length, 0); assert.deepStrictEqual(E.validate(E.dataOf(s.root)).errors, []); assert.ok(E.undo(s)); assert.strictEqual(E.exportText(s), W1.rawText);
  const sq = W1.all.find((n) => n.kind === 'sequence'), s2 = sess(W1), t = E.trial(s2, (dd) => E.deleteNode(dd, sq.uid)); assert.ok(t.res.ok); assert.ok(t.res.warnings.length > 0); assert.ok(t.newBroken.length > 0, 'refs devenues cassées détectées');
  E.run(s2, 'del', (dd) => E.deleteNode(dd, sq.uid)); assert.strictEqual(s2.wf.nodeCount, W1.nodeCount - 3, 'séquence + 2 enfants'); assert.deepStrictEqual(E.validate(E.dataOf(s2.root)).errors, []);
  const s3 = sess(W1), ref = byName(W1, 'Vérifier l\'appartenance'), tr = E.trial(s3, (dd) => E.deleteNode(dd, ref.uid)); assert.ok(tr.newBroken.length > 0); assert.strictEqual(E.isDirty(s3), false, 'trial ne modifie pas la session');
});

test('(f2) dupliquer un node: uid uniques, références internes réécrites', () => {
  const sq = W1.all.find((n) => n.kind === 'sequence'), [c1, c2] = sq.children, s = sess(W1);
  assert.ok(E.run(s, 'dep', (dd) => E.setSetting(dd, c2.uid, ['groupIds'], '{{action::' + c1.uid + '::response[0]::X}}')).ok);
  const before = s.wf, r = E.run(s, 'dup', (dd) => E.duplicateNode(dd, sq.uid, { uuid })); assert.ok(r.ok); assert.strictEqual(s.wf.nodeCount, before.nodeCount + 3);
  assert.deepStrictEqual(E.validate(E.dataOf(s.root)).errors, []); assert.strictEqual(new Set(s.wf.all.map((n) => n.uid)).size, s.wf.all.length);
  const copy = s.wf.all.find((n) => n.uid === r.newUid); assert.strictEqual(copy.children.length, 2); assert.ok(copy.name.endsWith(' (copie)'));
  assert.strictEqual(model.nodeSettings(copy.children[1]).groupIds, '{{action::' + copy.children[0].uid + '::response[0]::X}}'); assert.strictEqual(s.wf.all.filter((n) => JSON.stringify(model.nodeSettings(n)).includes(c1.uid)).length, before.all.filter((n) => JSON.stringify(model.nodeSettings(n)).includes(c1.uid)).length, 'références vers l original conservées');
  const nd = nodeDiff(before, s.wf); assert.strictEqual(nd.removed.length, 0); assert.ok(nd.added.length >= 3);
  const s2 = sess(W2), n2 = byName(W2, 'Courriel de confirmation'), r2 = E.run(s2, 'dup', (dd) => E.duplicateNode(dd, n2.uid, { uuid, suffix: false })); assert.ok(r2.ok); assert.strictEqual(E.findNode(E.dataOf(s2.root), r2.newUid).node.settings, n2.raw.settings);
  assert.ok(E.undo(s2)); assert.strictEqual(E.exportText(s2), W2.rawText);
});

test('(f3) déplacer un node: haut/bas, séquence avec enfants, vers une branche / séquence', () => {
  const mid = W2.main[1], s = sess(W2), o0 = W2.data.actions.map((n) => n.uid);
  assert.ok(E.run(s, 'up', (dd) => E.moveNode(dd, mid.uid, 'up')).ok); assert.deepStrictEqual(s.wf.data.actions.map((n) => n.uid), [o0[1], o0[0], ...o0.slice(2)]);
  assert.ok(E.run(s, 'down', (dd) => E.moveNode(dd, mid.uid, 'down')).ok); assert.strictEqual(E.isDirty(s), false); assert.strictEqual(E.run(s, 'x', (dd) => E.moveNode(dd, W2.main[0].uid, 'up')).ok, false);
  const sq = W1.main.find((n) => n.kind === 'sequence'), s2 = sess(W1); assert.ok(E.run(s2, 'down', (dd) => E.moveNode(dd, sq.uid, 'down')).ok);
  const raw = s2.wf.data.actions, i0 = raw.findIndex((n) => n.uid === sq.uid); assert.ok(sq.children.every((c, k) => raw[i0 + 1 + k].parentUid === sq.uid)); assert.deepStrictEqual(E.validate(E.dataOf(s2.root)).errors, []); assert.strictEqual(s2.wf.nodeCount, W1.nodeCount);
  const iff = W1.main.find((n) => n.kind === 'if'), nested = byName(W1, 'Attribuer les licences'), s3 = sess(W1);
  assert.ok(E.run(s3, 'to', (dd) => E.moveTo(dd, nested.uid, { branch: 'trueBranch', of: iff.uid })).ok); assert.ok(s3.wf.uidMap[iff.uid].trueBranch.some((c) => c.uid === nested.uid)); assert.strictEqual(E.moveTo(E.dataOf(JSON.parse(JSON.stringify(W1.root))), iff.uid, { branch: 'trueBranch', of: iff.uid }).ok, false);
  const fin = byName(W1, 'Fin'), s4 = sess(W1); assert.ok(E.run(s4, 'in', (dd) => E.moveTo(dd, fin.uid, { childOf: sq.uid })).ok); assert.strictEqual(s4.wf.uidMap[fin.uid].parent.uid, sq.uid); assert.deepStrictEqual(E.validate(E.dataOf(s4.root)).errors, []);
});

test('undo/redo: retour à l\'original identique; redo rejoue; nouvelle action vide redo', () => {
  const s = sess(W1), n = byName(W1, 'Lire le compte');
  assert.ok(E.run(s, '1', (dd) => E.setWorkflowField(dd, 'workflowName', 'A')).ok); assert.ok(E.run(s, '2', (dd) => E.setSetting(dd, n.uid, ['target'], 'B')).ok);
  assert.ok(E.run(s, '3', (dd) => E.moveNode(dd, W1.main[1].uid, 'up')).ok); assert.ok(E.run(s, '4', (dd) => E.duplicateNode(dd, W1.main[0].uid, { uuid })).ok);
  const final = E.exportText(s); assert.strictEqual(s.undo.length, 4); while (E.undo(s)); assert.strictEqual(E.exportText(s), W1.rawText); assert.strictEqual(E.isDirty(s), false); assert.strictEqual(s.redo.length, 4);
  while (E.redo(s)); assert.strictEqual(E.exportText(s), final); E.undo(s); assert.ok(E.run(s, 'x', (dd) => E.setWorkflowField(dd, 'description', 'z')).ok); assert.strictEqual(s.redo.length, 0);
});

test('export: option volatile décochée par défaut', () => {
  const s = sess(W1); E.run(s, 'x', (dd) => E.setWorkflowField(dd, 'description', 'd'));
  const plain = JSON.parse(E.exportText(s)).data, vol = JSON.parse(E.exportText(s, { touchVolatile: true, now: new Date('2030-01-02T03:04:05.678Z') })).data;
  assert.strictEqual(plain.updatedAt, W1.data.updatedAt); assert.strictEqual(plain.updatedDate, W1.data.updatedDate); assert.strictEqual(vol.updatedDate, '2030-01-02T03:04:05Z'); assert.strictEqual(vol.updatedAt, Math.floor(Date.parse('2030-01-02T03:04:05.678Z') / 1000));
});

test('validation: uid dupliqué, parentUid orphelin, référence cassée', () => {
  const base = JSON.parse(W2.rawText), d1 = JSON.parse(JSON.stringify(base)).data; d1.actions[1].uid = d1.actions[0].uid; assert.ok(E.validate(d1).errors.some((e) => /dupliqué/.test(e)));
  const d2 = JSON.parse(JSON.stringify(base)).data; d2.actions[1].parentUid = 'inexistant'; assert.ok(E.validate(d2).errors.some((e) => /parentUid/.test(e)));
  const d3 = JSON.parse(JSON.stringify(base)).data, st = JSON.parse(d3.actions[0].settings); st.x = '{{action::inexistant::response[0]::Z}}'; d3.actions[0].settings = JSON.stringify(st); assert.ok(E.validate(d3).broken.length >= 1);
  assert.ok(W5 && E.validate(E.dataOf(JSON.parse(JSON.stringify(W5.root)))).errors.length === 0);
});
