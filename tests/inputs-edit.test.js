// Éditeur d'inputs: formes par catégorie, conversions, renommage avec propagation, enum, clés inconnues, undo/redo, export fidèle, validation, diff.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('./helpers.js');
const model = require('../src/model.js');
const diff = require('../src/diff.js');
const inputsApi = require('../src/inputs.js');
const E = require('../src/edit.js');

const d = H.load(), { workflows } = d;
const W1 = d.byName('Exemple - Onboarding'), W2 = d.byName('Exemple - Sous-flux licences');
const sess = (wf) => E.createSession(wf);
const props = (s) => JSON.parse(E.dataOf(s.root).inputSchema).properties;
const schema = (s) => JSON.parse(E.dataOf(s.root).inputSchema);
const run = (s, fn) => E.run(s, 'op', fn);
const kindOf = (s, name) => inputsApi.classify(name, props(s)[name], false).kind;
const KINDS = inputsApi.SELECTABLE;

test('formes de schéma: chaque catégorie crée la forme observée (clés et ordre), classifiée correctement', () => {
  const expectKeys = {
    text: ['type', 'title', 'inputDescription', 'inputTargetType'], enum: ['type', 'title', 'inputDescription', 'inputTargetType', 'enum'], yesno: ['type', 'title', 'inputDescription', 'inputTargetType', 'enum'],
    boolean: ['type', 'title', 'inputDescription', 'inputTargetType'], integer: ['type', 'title', 'inputDescription', 'inputTargetType'], datetime: ['type', 'title', 'inputDescription', 'inputTargetType', 'x-cv-ui', 'format'],
    password: ['type', 'title', 'inputDescription', 'inputTargetType', 'x-cv-protected', 'x-cv-password', 'x-cv-tooltip', 'passwordRules'], customlist: ['type', 'title', 'inputDescription', 'inputTargetType', 'x-cv-custom-list'],
    datasource: ['type', 'title', 'inputDescription', 'inputTargetType', 'x-cv-data-source', 'x-cv-data-source-filterable'], target: ['type', 'title', 'inputDescription', 'inputTargetType']
  };
  KINDS.forEach((k) => {
    const r = inputsApi.newProp(k, { title: 'T', values: k === 'enum' ? ['a', 'b'] : undefined, customList: 'LIST', dataSource: 'src' });
    assert.deepStrictEqual(Object.keys(r.prop), expectKeys[k], k); assert.strictEqual(inputsApi.classify('x', r.prop, false).kind, k, k);
  });
  assert.strictEqual(inputsApi.newProp('target', { targetType: 'Mailbox' }).prop.inputTargetType, 'Mailbox'); assert.deepStrictEqual(inputsApi.newProp('yesno').prop.enum, ['Non', 'Oui']);
  assert.strictEqual(inputsApi.newProp('integer').prop.type, 'integer'); assert.strictEqual(inputsApi.newProp('boolean').prop.type, 'boolean'); assert.strictEqual(inputsApi.newProp('password').prop.passwordRules.minLength, 12);
  assert.strictEqual(inputsApi.CERTAINTY.yesno, false); assert.strictEqual(inputsApi.CERTAINTY.password, false); assert.ok(inputsApi.UNCERTAIN_NOTES.yesno);
  assert.ok(inputsApi.convertProp({}, 'nimporte').error);
});

test('conversions entre catégories: clés ajoutées/retirées, clés inconnues et ordre conservés, pertes signalées', () => {
  const base = { type: 'string', title: 'T', zzz: { a: 1 }, inputDescription: 'D', inputTargetType: 'noTarget', 'x-future': true, enum: ['a', 'b', 'c'] };
  let r = inputsApi.convertProp(base, 'password'); assert.strictEqual(r.prop.zzz.a, 1); assert.strictEqual(r.prop['x-future'], true); assert.ok(!('enum' in r.prop)); assert.ok(r.lost.some((m) => /3 valeur/.test(m)));
  assert.deepStrictEqual(Object.keys(r.prop).slice(0, 5), ['type', 'title', 'zzz', 'inputDescription', 'inputTargetType'], 'ordre existant conservé'); assert.strictEqual(r.prop['x-cv-password'], true);
  r = inputsApi.convertProp(r.prop, 'text'); assert.ok(!('x-cv-protected' in r.prop) && !('passwordRules' in r.prop) && !('x-cv-tooltip' in r.prop)); assert.ok(r.lost.some((m) => /Règles de mot de passe/.test(m))); assert.strictEqual(r.prop['x-future'], true);
  r = inputsApi.convertProp(base, 'integer'); assert.strictEqual(r.prop.type, 'integer'); assert.ok(r.lost.some((m) => /Type JSON/.test(m)));
  r = inputsApi.convertProp(base, 'target', { targetType: 'SecurityGroup' }); assert.strictEqual(r.prop.inputTargetType, 'SecurityGroup'); assert.ok(!('enum' in r.prop));
  r = inputsApi.convertProp(base, 'yesno'); assert.deepStrictEqual(r.prop.enum, ['Non', 'Oui']); assert.ok(r.lost.some((m) => /remplacées/.test(m)));
  r = inputsApi.convertProp({ type: 'string', title: 'T', enum: ['Oui', 'Non'] }, 'enum'); assert.deepStrictEqual(r.prop.enum, ['Oui', 'Non'], 'une paire oui/non existante est conservée'); assert.deepStrictEqual(r.lost, []);
  r = inputsApi.convertProp({ type: 'string', title: 'T' }, 'datasource', { dataSource: 'src' }); assert.strictEqual(r.prop['x-cv-data-source-filterable'], true); assert.strictEqual(r.needs, null);
  r = inputsApi.convertProp({ type: 'string', title: 'T' }, 'datasource'); assert.strictEqual(r.needs, 'dataSource'); r = inputsApi.convertProp({ type: 'string', title: 'T' }, 'customlist'); assert.strictEqual(r.needs, 'customList'); r = inputsApi.convertProp({ type: 'string', title: 'T' }, 'enum'); assert.strictEqual(r.needs, 'enum');
  r = inputsApi.convertProp({ type: 'string', title: 'T', default: 'x' }, 'integer'); assert.ok(r.lost.some((m) => /par défaut/.test(m)));
  // aller-retour complet par toutes les catégories sans perdre les clés inconnues
  let p = { type: 'string', title: 'T', inputDescription: '', inputTargetType: 'noTarget', 'x-inconnu': [1, 2] };
  KINDS.concat(['text']).forEach((k) => { p = inputsApi.convertProp(p, k, { values: ['a'], customList: 'L', dataSource: 'S', targetType: 'User' }).prop; assert.deepStrictEqual(p['x-inconnu'], [1, 2]); assert.strictEqual(inputsApi.classify('x', p, false).kind, k === 'yesno' ? 'yesno' : k, k); });
});

test('ajout d\'un input de chaque catégorie, puis suppression: export fidèle, undo/redo, diff limité', () => {
  const s = sess(W2), before = Object.keys(props(s));
  KINDS.forEach((k) => assert.ok(run(s, (dd) => E.addInput(dd, { name: 'N_' + k, kind: k, required: k === 'text', values: ['x', 'y'], customList: 'LIST', dataSource: 'SRC', targetType: 'Mailbox' })).ok, k));
  assert.deepStrictEqual(Object.keys(props(s)), before.concat(KINDS.map((k) => 'N_' + k))); KINDS.forEach((k) => assert.strictEqual(kindOf(s, 'N_' + k), k));
  assert.ok(schema(s).required.includes('N_text') && !schema(s).required.includes('N_enum'));
  const r = diff.diffWorkflows(W2, s.wf); assert.strictEqual(r.inputs.summary.added, KINDS.length); assert.strictEqual(r.inputs.summary.removed + r.inputs.summary.modified, 1 - 1 + (r.inputs.summary.modified), 'seuls des ajouts (et required modifié le cas échéant)'); assert.strictEqual(r.summary.added + r.summary.removed + r.summary.modified, 0, 'aucun node touché');
  KINDS.forEach((k) => assert.ok(run(s, (dd) => E.deleteInput(dd, 'N_' + k)).ok)); assert.deepStrictEqual(Object.keys(props(s)), before); assert.deepStrictEqual(schema(s).required, JSON.parse(W2.data.inputSchema).required);
  while (E.undo(s)); assert.strictEqual(E.exportText(s), W2.rawText); assert.strictEqual(E.isDirty(s), false);
  while (E.redo(s)); assert.deepStrictEqual(Object.keys(props(s)), before);
  assert.ok(E.run(s, 'x', (dd) => E.addInput(dd, { name: 'Zed' })).ok); assert.strictEqual(s.redo.length, 0);
});

test('suppression d\'un input utilisé: avertissement avec le nombre de références; trial sans effet', () => {
  const s = sess(W1), t = E.trial(s, (dd) => E.deleteInput(dd, 'UPN')); assert.ok(t.res.ok); assert.ok(t.res.references >= 3); assert.match(t.res.warnings[0], /référence/); assert.strictEqual(E.isDirty(s), false);
  assert.ok(t.after.warnings.length >= 0); assert.strictEqual(E.deleteInput(E.dataOf(JSON.parse(JSON.stringify(W1.root))), 'Inconnu').ok, false);
});

test('conversion d\'un input existant via le moteur: avertissements, undo/redo, diff ne montre que cet input', () => {
  const s = sess(W1), t = E.trial(s, (dd) => E.setInputKind(dd, 'Langue', 'text')); assert.ok(t.res.ok); assert.ok(t.res.warnings.some((w) => /2 valeur/.test(w)));
  assert.ok(run(s, (dd) => E.setInputKind(dd, 'Langue', 'text')).ok); assert.strictEqual(kindOf(s, 'Langue'), 'text'); const dr = diff.diffWorkflows(W1, s.wf);
  assert.strictEqual(dr.inputs.summary.modified, 1); assert.strictEqual(dr.inputs.items.find((i) => i.name === 'Langue').status, 'modified'); assert.strictEqual(dr.summary.added + dr.summary.removed + dr.summary.modified, 0);
  assert.ok(run(s, (dd) => E.setInputKind(dd, 'MotDePasse', 'datetime')).ok); assert.ok(!('passwordRules' in props(s).MotDePasse)); assert.ok(E.undo(s)); assert.strictEqual(kindOf(s, 'MotDePasse'), 'password');
  const r2 = E.run(s, 'x', (dd) => E.setInputKind(dd, 'Cible', 'password')); assert.ok(r2.warnings.some((w) => /Deux variantes/.test(w)), 'incertitude signalée');
  while (E.undo(s)); assert.strictEqual(E.exportText(s), W1.rawText);
});

test('renommage avec propagation (opération existante renameInput): références, required, ordre, aucun input cassé', () => {
  const s = sess(W1), names = Object.keys(props(s)), cnt = (wf, n) => wf.all.reduce((c, nd) => c + (JSON.stringify([model.nodeSettings(nd), nd.raw.filter]).match(new RegExp('\\{\\{input::input-stepUid::' + n + '::', 'g')) || []).length, 0);
  const used = cnt(W1, 'UPN'), t = E.trial(s, (dd) => E.renameInput(dd, 'UPN', 'Identifiant')); assert.ok(t.res.ok); assert.ok(t.res.changes.length >= 1); assert.strictEqual(E.isDirty(s), false);
  assert.ok(run(s, (dd) => E.renameInput(dd, 'UPN', 'Identifiant')).ok); assert.deepStrictEqual(Object.keys(props(s)), names.map((k) => (k === 'UPN' ? 'Identifiant' : k))); assert.ok(schema(s).required.includes('Identifiant') && !schema(s).required.includes('UPN'));
  assert.strictEqual(cnt(s.wf, 'UPN'), 0); assert.strictEqual(cnt(s.wf, 'Identifiant'), used); assert.deepStrictEqual(E.validate(E.dataOf(s.root)).errors, []);
  const lint = require('../src/lint.js'), ctx = lint.buildContext(new Map([[s.wf.id, s.wf]]), null); assert.strictEqual(lint.lintWorkflow(s.wf, ctx).filter((i) => i.rule === 'input-undeclared').length, 0, 'aucune référence cassée après renommage');
  // collisions / noms invalides
  assert.strictEqual(E.run(s, 'x', (dd) => E.renameInput(dd, 'Identifiant', 'DisplayName')).ok, false); assert.strictEqual(inputsApi.validateName('displayname', props(s), null).error.includes('collision'), true);
  assert.ok(inputsApi.validateName('a b', {}, null).warning); assert.ok(inputsApi.validateName('a::b', {}, null).error); assert.ok(inputsApi.validateName(' x', {}, null).error); assert.ok(inputsApi.validateName('', {}, null).error);
  while (E.undo(s)); assert.strictEqual(E.exportText(s), W1.rawText);
});

test('édition des champs: titre, description, tooltip, requis, défaut; clés inconnues conservées', () => {
  const o = JSON.parse(W1.rawText), sch = JSON.parse(o.data.inputSchema); sch.properties.DisplayName['x-inconnu'] = { k: [1] }; o.data.inputSchema = JSON.stringify(sch);
  const wf = model.parseWorkflowText(JSON.stringify(o), 'x.json').wf, s = sess(wf);
  assert.ok(run(s, (dd) => E.updateInput(dd, 'DisplayName', { title: 'Nom affiché', inputDescription: 'Texte', required: true })).ok);
  let p = props(s).DisplayName; assert.strictEqual(p.title, 'Nom affiché'); assert.strictEqual(p.inputDescription, 'Texte'); assert.deepStrictEqual(p['x-inconnu'], { k: [1] }); assert.ok(schema(s).required.includes('DisplayName'));
  assert.ok(run(s, (dd) => E.updateInput(dd, 'DisplayName', { required: false })).ok); assert.ok(!schema(s).required.includes('DisplayName'));
  const w = E.run(s, 'x', (dd) => E.updateInput(dd, 'DisplayName', { default: 'abc', tooltip: 'Aide' })); assert.ok(w.warnings.length === 2); assert.strictEqual(props(s).DisplayName.default, 'abc');
  assert.ok(run(s, (dd) => E.updateInput(dd, 'DisplayName', { default: undefined, tooltip: '' })).ok); assert.ok(!('default' in props(s).DisplayName) && !('x-cv-tooltip' in props(s).DisplayName));
  assert.strictEqual(E.run(s, 'x', (dd) => E.updateInput(dd, 'DisplayName', { title: 5 })).ok, false); assert.strictEqual(E.run(s, 'x', (dd) => E.updateInput(dd, 'Inconnu', { title: 'x' })).ok, false);
  // propriété sans inputDescription (variante ancienne): la clé est insérée après title
  const sch2 = JSON.parse(o.data.inputSchema); delete sch2.properties.DisplayName.inputDescription; o.data.inputSchema = JSON.stringify(sch2); const s2 = sess(model.parseWorkflowText(JSON.stringify(o), 'y.json').wf);
  run(s2, (dd) => E.updateInput(dd, 'DisplayName', { inputDescription: 'N' })); assert.deepStrictEqual(Object.keys(props(s2).DisplayName).slice(0, 3), ['type', 'title', 'inputDescription']);
});

test('réordonner (haut/bas/vers un index), dupliquer', () => {
  const s = sess(W1), n0 = Object.keys(props(s));
  assert.ok(run(s, (dd) => E.moveInput(dd, 'DisplayName', { dir: 'up' })).ok); assert.deepStrictEqual(Object.keys(props(s)).slice(0, 2), ['DisplayName', 'UPN']); assert.strictEqual(E.run(s, 'x', (dd) => E.moveInput(dd, 'DisplayName', { dir: 'up' })).ok, false);
  assert.ok(run(s, (dd) => E.moveInput(dd, 'UPN', { to: n0.length - 1 })).ok); assert.strictEqual(Object.keys(props(s)).pop(), 'UPN'); assert.strictEqual(E.run(s, 'x', (dd) => E.moveInput(dd, 'UPN', { dir: 'down' })).ok, false);
  const r = run(s, (dd) => E.duplicateInput(dd, 'Langue')); assert.ok(r.ok); const names = Object.keys(props(s)); assert.strictEqual(names[names.indexOf('Langue') + 1], 'Langue_copie'); assert.deepStrictEqual(props(s).Langue_copie.enum, ['FR', 'EN']); assert.strictEqual(props(s).Langue_copie.title, 'Langue_copie');
  assert.ok(run(s, (dd) => E.duplicateInput(dd, 'UPN')).ok); assert.ok(schema(s).required.includes('UPN_copie')); assert.ok(run(s, (dd) => E.duplicateInput(dd, 'Langue')).ok); assert.ok('Langue_copie2' in props(s));
  assert.strictEqual(E.run(s, 'x', (dd) => E.duplicateInput(dd, 'Langue', 'UPN')).ok, false);
  while (E.undo(s)); assert.strictEqual(E.exportText(s), W1.rawText);
});

test('enum: ajout, suppression, renommage, ordre, collage, dédoublonnage, tri; gros enum (1500 valeurs)', () => {
  const s = sess(W1); let vals = ['FR', 'EN'];
  vals = vals.concat(inputsApi.parsePaste('ES\r\n  DE  \n\nES\nIT')); assert.deepStrictEqual(vals, ['FR', 'EN', 'ES', 'DE', 'ES', 'IT']);
  const t = E.trial(s, (dd) => E.setInputEnum(dd, 'Langue', vals)); assert.ok(t.res.warnings.some((w) => /double/.test(w)));
  vals = inputsApi.dedupe(vals); assert.deepStrictEqual(vals, ['FR', 'EN', 'ES', 'DE', 'IT']); assert.ok(run(s, (dd) => E.setInputEnum(dd, 'Langue', vals)).ok); assert.deepStrictEqual(props(s).Langue.enum, vals);
  vals = inputsApi.sortValues(vals); assert.deepStrictEqual(vals, ['DE', 'EN', 'ES', 'FR', 'IT']); assert.deepStrictEqual(inputsApi.sortValues(vals, 'desc')[0], 'IT'); vals = inputsApi.moveValue(vals, 0, 4); assert.strictEqual(vals[4], 'DE'); vals[0] = 'ENG'; vals.splice(1, 1);
  assert.ok(run(s, (dd) => E.setInputEnum(dd, 'Langue', vals)).ok); assert.deepStrictEqual(props(s).Langue.enum, vals);
  assert.strictEqual(E.run(s, 'x', (dd) => E.setInputEnum(dd, 'Langue', ['a', ''])).ok, false); assert.strictEqual(E.run(s, 'x', (dd) => E.setInputEnum(dd, 'Langue', 'oops')).ok, false);
  const big = Array.from({ length: 1500 }, (_, i) => 'Valeur ' + String(i).padStart(4, '0')), t0 = Date.now(); assert.ok(run(s, (dd) => E.setInputEnum(dd, 'Langue', big)).ok); assert.strictEqual(props(s).Langue.enum.length, 1500); assert.ok(Date.now() - t0 < 2000);
  assert.strictEqual(inputsApi.sortValues(big.slice().reverse())[0], 'Valeur 0000'); assert.deepStrictEqual(inputsApi.duplicatesOf(['a', 'b', 'a', 'a']), ['a']);
  assert.ok(run(s, (dd) => E.setInputEnum(dd, 'Cible', ['u1'])).ok, 'une propriété sans enum peut recevoir une liste'); assert.ok(Array.isArray(props(s).Cible.enum));
  while (E.undo(s)); assert.strictEqual(E.exportText(s), W1.rawText);
});

test('source de données, liste personnalisée, règles de mot de passe', () => {
  const s = sess(W1);
  assert.ok(run(s, (dd) => E.setInputSource(dd, 'Source', { dataSource: 'autre-source', filterable: false })).ok); assert.strictEqual(props(s).Source['x-cv-data-source'], 'autre-source'); assert.strictEqual(props(s).Source['x-cv-data-source-filterable'], false);
  assert.ok(run(s, (dd) => E.setInputSource(dd, 'ListePerso', { customList: 'NOUVELLE' })).ok); assert.strictEqual(props(s).ListePerso['x-cv-custom-list'], 'NOUVELLE'); assert.strictEqual(E.run(s, 'x', (dd) => E.setInputSource(dd, 'UPN', { customList: 'x' })).ok, false);
  const rules = Object.assign({}, props(s).MotDePasse.passwordRules, { minLength: 14, requireUppercase: false, 'x-future': 1 }); assert.ok(run(s, (dd) => E.setPasswordRules(dd, 'MotDePasse', rules)).ok); assert.deepStrictEqual(props(s).MotDePasse.passwordRules, rules);
  assert.strictEqual(E.run(s, 'x', (dd) => E.setPasswordRules(dd, 'UPN', rules)).ok, false); assert.strictEqual(E.run(s, 'x', (dd) => E.setPasswordRules(dd, 'MotDePasse', 'x')).ok, false);
  const s2 = sess(W1); assert.ok(run(s2, (dd) => E.setInputKind(dd, 'UPN', 'datasource', { dataSource: 'src' })).ok); assert.strictEqual(props(s2).UPN['x-cv-data-source-filterable'], true);
});

test('expert: remplacement du JSON brut d\'un input (validé)', () => {
  const s = sess(W1), np = Object.assign({}, props(s).DisplayName, { 'x-extra': 1 }); assert.ok(run(s, (dd) => E.setInputProp(dd, 'DisplayName', np)).ok); assert.strictEqual(props(s).DisplayName['x-extra'], 1);
  assert.strictEqual(E.run(s, 'x', (dd) => E.setInputProp(dd, 'DisplayName', { title: 'sans type' })).ok, false); assert.strictEqual(E.run(s, 'x', (dd) => E.setInputProp(dd, 'DisplayName', { type: 'string', enum: 'x' })).ok, false); assert.strictEqual(E.run(s, 'x', (dd) => E.setInputProp(dd, 'DisplayName', [1])).ok, false);
});

test('clés inconnues, ordre et style d\'espacement de inputSchema conservés (champ ré-encodé seulement s\'il change)', () => {
  const o = JSON.parse(W1.rawText), sch = JSON.parse(o.data.inputSchema); sch.$extra = { a: 1 }; sch.properties.UPN['x-cv-inconnu'] = 'v'; o.data.inputSchema = JSON.stringify(sch, null, 2);
  const wf = model.parseWorkflowText(JSON.stringify(o), 'x.json').wf, s = sess(wf);
  assert.ok(run(s, (dd) => E.updateInput(dd, 'DisplayName', { title: 'T2' })).ok); const out = JSON.parse(E.exportText(s)).data;
  assert.strictEqual(out.inputSchema, JSON.stringify(Object.assign(JSON.parse(o.data.inputSchema), {}, { properties: Object.assign({}, sch.properties, { DisplayName: Object.assign({}, sch.properties.DisplayName, { title: 'T2' }) }) }), null, 2), 'style indenté conservé');
  assert.deepStrictEqual(JSON.parse(out.inputSchema).$extra, { a: 1 }); assert.strictEqual(JSON.parse(out.inputSchema).properties.UPN['x-cv-inconnu'], 'v');
  const s0 = sess(W1); assert.ok(run(s0, (dd) => E.updateInput(dd, 'DisplayName', { title: 'DisplayName' })).ok === true); // no-op: rien ne change, export identique
  assert.strictEqual(E.exportText(s0), W1.rawText); assert.strictEqual(E.isDirty(s0), false);
  const other = JSON.parse(E.exportText(sess(W1))); assert.ok(other.data.actions.length > 0);
  const s3 = sess(W1); run(s3, (dd) => E.updateInput(dd, 'DisplayName', { title: 'X' })); const exp = JSON.parse(E.exportText(s3)); const ch = diff.diffValues(W1.root, exp, '', []); assert.strictEqual(ch.length, 1); assert.strictEqual(ch[0].path, 'data.inputSchema');
});

test('export non modifié identique octet pour octet; validation d\'export: nom dupliqué / invalide / required orphelin / source vide', () => {
  workflows.forEach((w) => { const s = sess(w); assert.strictEqual(E.exportText(s), w.rawText); });
  const base = JSON.parse(W1.rawText), mk = (fn) => { const o = JSON.parse(JSON.stringify(base)), sch = JSON.parse(o.data.inputSchema); fn(sch); o.data.inputSchema = JSON.stringify(sch); return E.validate(E.dataOf(o)); };
  assert.ok(mk((s) => { s.properties.upn = JSON.parse(JSON.stringify(s.properties.UPN)); }).errors.some((e) => /en double/.test(e)), 'collision insensible à la casse');
  assert.ok(mk((s) => { s.properties['a::b'] = { type: 'string', title: 'x' }; }).errors.some((e) => /invalide/.test(e))); assert.ok(mk((s) => { s.properties[' x'] = { type: 'string', title: 'x' }; }).errors.some((e) => /invalide/.test(e)));
  assert.ok(mk((s) => { s.properties.Mon_Nom = { type: 'string', title: 'x' }; s.properties['avec espace'] = { type: 'string', title: 'x' }; }).warnings.some((w) => /hors/.test(w)));
  assert.ok(mk((s) => { s.required.push('Fantome'); }).errors.some((e) => /required/.test(e))); assert.ok(mk((s) => { s.properties.Source['x-cv-data-source'] = ''; }).errors.some((e) => /source de données non renseignée/.test(e)));
  assert.ok(mk((s) => { s.properties.ListePerso['x-cv-custom-list'] = ''; }).errors.some((e) => /liste personnalisée non renseignée/.test(e))); assert.ok(mk((s) => { s.properties.Langue.enum = 'x'; }).errors.some((e) => /enum non-tableau/.test(e)));
  assert.deepStrictEqual(E.validate(E.dataOf(JSON.parse(JSON.stringify(base)))).errors, []);
});

test('copier des inputs vers un autre workflow: ignorer / renommer / écraser', () => {
  const src = inputsApi.parseInputs(W1), items = ['UPN', 'Langue', 'Quota'].map((n) => ({ name: n, prop: src.raw.properties[n], required: src.inputs.find((i) => i.name === n).required }));
  const s = sess(W2), before = Object.keys(props(s));
  let r = E.trial(s, (dd) => E.copyInputs(dd, items, 'skip')); assert.deepStrictEqual(r.res.report.map((x) => x.action), ['ignoré (existe déjà)', 'ajouté', 'ajouté']);
  r = E.trial(s, (dd) => E.copyInputs(dd, items, 'rename')); assert.strictEqual(r.res.report[0].action, 'ajouté sous le nom UPN_2');
  assert.ok(run(s, (dd) => E.copyInputs(dd, items, 'overwrite')).ok); assert.deepStrictEqual(Object.keys(props(s)), before.concat(['Langue', 'Quota'])); assert.deepStrictEqual(props(s).UPN, src.raw.properties.UPN); assert.deepStrictEqual(props(s).Langue.enum, ['FR', 'EN']);
  assert.ok(E.undo(s)); assert.strictEqual(E.exportText(s), W2.rawText);
  const mixed = [{ name: 'upn', prop: src.raw.properties.UPN, required: true }]; assert.strictEqual(E.trial(sess(W2), (dd) => E.copyInputs(dd, mixed, 'skip')).res.report[0].action, 'ignoré (existe déjà)', 'conflit insensible à la casse');
});

test('ajout: noms invalides ou en collision refusés; position après un input donné', () => {
  const s = sess(W1); assert.strictEqual(E.run(s, 'x', (dd) => E.addInput(dd, { name: 'UPN' })).ok, false); assert.strictEqual(E.run(s, 'x', (dd) => E.addInput(dd, { name: 'upn' })).ok, false); assert.strictEqual(E.run(s, 'x', (dd) => E.addInput(dd, { name: '' })).ok, false); assert.strictEqual(E.run(s, 'x', (dd) => E.addInput(dd, { name: 'a{b' })).ok, false);
  const r = run(s, (dd) => E.addInput(dd, { name: 'Apres', kind: 'datasource', after: 'UPN' })); assert.ok(r.ok); assert.ok(r.warnings.some((w) => /à compléter/.test(w))); assert.strictEqual(Object.keys(props(s))[1], 'Apres');
  assert.ok(E.validate(E.dataOf(s.root)).errors.some((e) => /source de données non renseignée/.test(e)), 'source vide bloque la validation');
  assert.ok(run(s, (dd) => E.setInputSource(dd, 'Apres', { dataSource: 'ma-source' })).ok); assert.deepStrictEqual(E.validate(E.dataOf(s.root)).errors, []);
  const w = run(s, (dd) => E.addInput(dd, { name: 'Avec espace' })); assert.ok(w.warnings.some((x) => /respecte pas/.test(x)));
});
