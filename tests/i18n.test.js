// i18n: cohérence des dictionnaires fr/en, pluriels, détection de langue, absence de français codé en dur dans src/*.js, suivi de la langue active.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('./helpers.js'); // fixe aussi la langue 'fr' (voir helpers.js)
const I = require('../src/i18n.js');
const strlits = require('./_strlits.js');
const model = require('../src/model.js');
const L = require('../src/lint.js');
const G = require('../src/graph.js');
const N = require('../src/natives.js');
const LB = require('../src/labels.js');

const SRC = path.join(__dirname, '..', 'src');
const fr = I.dict.fr, en = I.dict.en;
const vars = (v) => { const out = new Set(); (typeof v === 'string' ? [v] : Object.values(v)).forEach((s) => { for (const m of s.matchAll(/\{(\w+)\}/g)) out.add(m[1]); }); return [...out].sort(); };
const variants = (v) => (typeof v === 'string' ? [v] : Object.values(v));
const withLang = (l, fn) => { const old = I.getLang(); I.setLang(l); try { return fn(); } finally { I.setLang(old); } };

test('(a) fr et en ont exactement les mêmes clés', () => {
  const kf = Object.keys(fr).sort(), ke = Object.keys(en).sort();
  assert.deepStrictEqual(kf.filter((k) => !(k in en)), [], 'clés absentes de en');
  assert.deepStrictEqual(ke.filter((k) => !(k in fr)), [], 'clés absentes de fr');
  assert.ok(kf.length > 400, 'dictionnaire non vide: ' + kf.length);
});

test('(b) mêmes variables {x} dans fr et en pour chaque clé', () => {
  const bad = Object.keys(fr).filter((k) => en[k] !== undefined && JSON.stringify(vars(fr[k])) !== JSON.stringify(vars(en[k])));
  assert.deepStrictEqual(bad.map((k) => k + ' fr=' + vars(fr[k]) + ' en=' + vars(en[k])), []);
});

test('(c) pluriels 0/1/2/5 valides dans les deux langues', () => {
  [['fr', ['0 node', '1 node', '2 nodes', '5 nodes']], ['en', ['0 nodes', '1 node', '2 nodes', '5 nodes']]].forEach(([l, exp]) => withLang(l, () => {
    assert.deepStrictEqual([0, 1, 2, 5].map((n) => I.t('n.nodes', { n })), exp, l);
    Object.keys(I.dict[l]).forEach((k) => {
      const e = I.dict[l][k]; if (typeof e === 'string') return;
      assert.ok(typeof e.other === 'string' && typeof e.one === 'string', l + ':' + k + ' doit avoir one et other');
      [0, 1, 2, 5].forEach((n) => { const s = I.t(k, { n, uid: 'u', paths: 'p', name: 'x' }); assert.ok(s && !/\{n\}/.test(s), l + ':' + k + ' n=' + n); });
    });
  }));
  assert.strictEqual(I.pluralCategory('fr', 0), 'one'); assert.strictEqual(I.pluralCategory('en', 0), 'other'); assert.strictEqual(I.pluralCategory('en', 1), 'one');
});

test('détection de langue (pure), résolution, abonnés', () => {
  assert.strictEqual(I.detectLang(['fr-CA', 'en']), 'fr'); assert.strictEqual(I.detectLang(['FR']), 'fr'); assert.strictEqual(I.detectLang(['en-US', 'fr']), 'en');
  assert.strictEqual(I.detectLang(['de']), 'en'); assert.strictEqual(I.detectLang([]), 'en'); assert.strictEqual(I.detectLang(undefined), 'en');
  assert.strictEqual(I.resolve('#lang=fr', 'en', ['en']), 'fr'); assert.strictEqual(I.resolve('', 'en', ['fr']), 'en'); assert.strictEqual(I.resolve('', null, ['fr-FR']), 'fr'); assert.strictEqual(I.resolve('#x=1', null, ['en']), 'en');
  const seen = [], off = I.onChange((l) => seen.push(l)); const old = I.getLang();
  I.setLang('en'); I.setLang('en'); I.setLang('xx'); I.setLang('fr'); off(); I.setLang('en'); I.setLang(old);
  assert.deepStrictEqual(seen, ['en', 'fr']); assert.strictEqual(I.getLang(), old);
  withLang('fr', () => assert.strictEqual(I.formatDate('2026-01-02T03:04:05Z'), '2026-01-02 03:04'));
  withLang('en', () => { assert.match(I.formatDate('2026-01-02T03:04:05Z'), /2026/); assert.notStrictEqual(I.formatDate('2026-01-02T03:04:05Z'), '2026-01-02 03:04'); assert.strictEqual(I.formatNumber(1234.5), '1,234.5'); });
  assert.notStrictEqual(withLang('fr', () => I.formatNumber(1234.5)), '1,234.5');
});

test('hash de langue: lang= ajouté/remplacé sans perdre les autres paramètres; détection du hash', () => {
  assert.strictEqual(I.withLangHash('#wf=a&tab=compare&cmp=b&x=1', 'en'), '#wf=a&tab=compare&cmp=b&x=1&lang=en');
  assert.strictEqual(I.withLangHash('#wf=a&lang=fr&x=1', 'en'), '#wf=a&lang=en&x=1');
  assert.strictEqual(I.withLangHash('', 'fr'), '#lang=fr'); assert.strictEqual(I.withLangHash(undefined, 'en'), '#lang=en');
  assert.strictEqual(I.hashHasLang('#wf=a&lang=en'), true); assert.strictEqual(I.hashHasLang('#wf=a&lang=de'), false); assert.strictEqual(I.hashHasLang(''), false);
  // priorité: hash > mémorisé > navigateur; valeurs invalides ignorées
  assert.strictEqual(I.resolve('#lang=de', 'fr', ['en']), 'fr'); assert.strictEqual(I.resolve('', 'de', ['fr']), 'fr'); assert.strictEqual(I.resolve('#lang=en', 'fr', ['fr']), 'en');
});

test('(f) t(): clé absente ou arguments inattendus ne lèvent pas', () => {
  ['fr', 'en'].forEach((l) => withLang(l, () => {
    assert.strictEqual(I.t('no.such.key'), 'no.such.key'); assert.strictEqual(I.t('no.such.key', { n: 2 }), 'no.such.key');
    assert.doesNotThrow(() => { I.t(undefined); I.t(null, { n: 1 }); I.t('n.nodes'); I.t('n.nodes', null); I.t('n.nodes', { n: 'abc' }); I.t(42); });
    assert.strictEqual(I.t('n.nodes', {}).includes('{n}'), true, 'variable absente laissée telle quelle');
  }));
});

test('(e) pas de valeur vide; identiques en/fr seulement si justifié (avertissement)', () => {
  const empty = []; const same = [];
  Object.keys(fr).forEach((k) => {
    variants(fr[k]).forEach((s, i) => { if (!s.trim()) empty.push('fr:' + k); });
    variants(en[k] || '').forEach((s) => { if (!s.trim()) empty.push('en:' + k); });
    if (JSON.stringify(fr[k]) === JSON.stringify(en[k])) same.push(k);
  });
  assert.deepStrictEqual(empty, [], 'valeurs vides');
  // identiques: normal pour noms propres, unités, sigles, étiquettes techniques; on signale (diagnostic) et on échoue si du français accentué fuit dans en.
  const leak = same.filter((k) => /[àâäçéèêëîïôöùûüœ«»]/i.test(JSON.stringify(en[k])));
  assert.deepStrictEqual(leak, [], 'français accentué dans en (identique à fr)');
  console.log('  i18n: ' + same.length + ' entrées identiques fr/en (noms propres, sigles, formats), ex.: ' + same.slice(0, 8).join(', '));
});

// ---------- (d) détecteur de français codé en dur ----------
// Fichiers d'interface NON traités: À VIDER EN PHASE B (le test devient alors strict pour tous les src/*.js).
// Fichiers d'interface non encore traités (vide depuis la fin de la phase B2). loader.js: aucun texte affichable.
const PHASE_B_PENDING = []; // vide: toute l'interface est traduite (le test (d) est strict pour tous les src/*.js)
// Fichiers entiers exemptés (justifié): dictionnaire fr (c'est le français) ; données de démo (workflows fictifs aux noms français, générés depuis fixtures/) ; mots-clés PowerShell.
const EXEMPT_FILES = { 'i18n-fr.js': 'dictionnaire français', 'i18n-en.js': 'dictionnaire anglais: contrôlé à part (accents, mots français) dans ce test', 'demo-data.js': 'données de démo fictives (noms français, générées depuis fixtures/)', 'pshighlight.js': 'mots-clés PowerShell (anglais), aucun texte affiché' };
// Littéraux exemptés (regex sur le texte du littéral), avec justification.
// [fichier, regex sur le littéral, justification]
const EXCEPTIONS = [
  ['inputs.js', /^(Oui|Non|OUI|NON)$/, 'formes de reconnaissance des listes Oui/Non présentes dans les fichiers de l\'utilisateur (donnée à reconnaître, pas du texte affiché)'],
];
const ACCENT = /[àâäçéèêëîïôöùûüœÀÂÉÈÊÎÔÙÛŒ«»]/;
const WORDS = /(^|[^a-zà-ÿ])(le|la|les|des|du|de|un|une|et|ou|est|sont|pas|sans|avec|pour|dans|sur|vers|aucun|aucune|ne|qui|que|ce|cette|oui|non|nom|valeur|manquant|inconnu|inconnue|erreur|ajout|ajouté|suppression|supprimé|texte|chemin|groupe|appelle|appelé|appelés|fichier|fichiers|déjà|tous|toutes|tout)($|[^a-zà-ÿ])/i;
const SINGLE = /^(oui|non|nom|vide|aucun|aucune|tous|tout|erreur|avertissement|supprimer|ajouter|annuler|fermer|enregistrer|exporter|importer|rechercher|appliquer|valeur|chemin|groupe|fichier|fichiers)$/i;
function frenchHits(file) {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8');
  return strlits(src).filter((x) => {
    const s = x.text; if (!s.trim()) return false;
    if (EXCEPTIONS.some(([f, re]) => f === file && re.test(s))) return false;
    return ACCENT.test(s) || SINGLE.test(s.trim()) || (/\s/.test(s.trim()) && WORDS.test(s));
  }).map((x) => file + ':' + x.line + ': ' + x.text.slice(0, 70));
}

test('(d) aucun littéral français codé en dur dans src/*.js (hors dictionnaire fr, démo, et PHASE_B_PENDING)', () => {
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'));
  const bad = [];
  files.forEach((f) => { if (EXEMPT_FILES[f] || PHASE_B_PENDING.includes(f)) return; bad.push(...frenchHits(f)); });
  assert.deepStrictEqual(bad, [], 'littéraux français à traduire (i18n)');
  // le dictionnaire en ne doit contenir aucun mot français courant sans accent
  const enBad = Object.keys(en).filter((k) => variants(en[k]).some((v) => /[àâäçéèêëîïôöùûüœ«»]/i.test(v) || /\b(le|la|les|des|du|une|est|pas|sans|avec|pour|dans|aucun|aucune|valeur|erreur|manquant)\b/i.test(v)));
  assert.deepStrictEqual(enBad, [], 'français dans le dictionnaire en');
});

test('(d2) PHASE_B_PENDING: état actuel (informatif) et garde-fou anti-oubli', () => {
  const files = fs.readdirSync(SRC);
  PHASE_B_PENDING.forEach((f) => assert.ok(files.includes(f), f + ' n\'existe plus: le retirer de PHASE_B_PENDING'));
  const counts = PHASE_B_PENDING.map((f) => f + '=' + frenchHits(f).length);
  console.log('  i18n phase B restante (littéraux français): ' + counts.join(', '));
  // un fichier de la liste sans aucun littéral français a été traité: il doit sortir de la liste (donc passer sous le contrôle strict)
  PHASE_B_PENDING.forEach((f) => assert.ok(frenchHits(f).length > 0, f + ' ne contient plus de français: le retirer de PHASE_B_PENDING'));
});

// ---------- (g) rapport Markdown et linter suivent la langue active ----------
const uid = (() => { let u = 0; return () => '00000000-0000-4000-8000-' + String(++u).padStart(12, '0'); })();
const mkNode = (id, name, settings, extra) => Object.assign({ id, uid: uid(), name, settings: JSON.stringify(settings || {}), inputSchema: '{}', filter: { conditions: [], conditionGroups: [] }, forceSkip: false, parentUid: null, successOutputSchema: '{}', failureOutputSchema: '{}', trueBranch: [], falseBranch: [] }, extra || {});
function synthWf() {
  const actions = [mkNode('item::sequence', 'S', {}), mkNode('item::if-else', 'I', {}),
    mkNode('Generic|X.Y.SendEmailNotification', 'M', { to: ['{{input::input-stepUid::ghost::ghost}}'], subject: '{{action::deadbeef-0000-0000-0000-000000000000::response[0]::X}}', body: '{{oops' }),
    mkNode('item::delay', 'D', { waitDuration: 300 })];
  const d = { id: 'w1', workflowName: 'WF', status: 'Active', inputSchema: JSON.stringify({ type: 'object', properties: {}, required: [] }), actions, catchActions: [] };
  return model.parseWorkflowText(JSON.stringify({ data: d }), 'w1.json').wf;
}
const FRENCH_IN_EN = /[àâäçéèêëîïôöùûüœ«»]|\b(le|la|les|des|du|une|est|pas|sans|avec|pour|dans|aucun|aucune|valeur|erreur|manquant|appelé|appelle)\b/i;

test('(g) messages et titres du linter suivent la langue active', () => {
  const wf = synthWf(), run = () => L.lintWorkflow(wf, { wfs: new Map([[wf.id, wf]]), store: null, cg: G.callGraph(new Map([[wf.id, wf]])) });
  const f = withLang('fr', run), e = withLang('en', run);
  assert.ok(f.length >= 4, 'plusieurs constats attendus: ' + f.length); assert.strictEqual(f.length, e.length);
  assert.deepStrictEqual(f.map((x) => x.rule), e.map((x) => x.rule)); assert.ok(f.every((x, i) => x.message !== e[i].message), 'messages identiques en/fr');
  e.forEach((x) => { assert.ok(!FRENCH_IN_EN.test(x.message), 'français dans un message en: ' + x.message); });
  assert.ok(f.some((x) => x.rule === 'seq-empty' && x.message === I.dict.fr['lint.msg.seqEmpty']));
  assert.strictEqual(withLang('en', () => L.RULES.length), 15);
  ['fr', 'en'].forEach((l) => withLang(l, () => L.RULES.forEach((r) => { assert.ok(r.title && r.title !== 'lint.title.' + r.id && !/^lint\./.test(r.title), l + ' titre ' + r.id); })));
  assert.notDeepStrictEqual(withLang('fr', () => L.RULES.map((r) => r.title)), withLang('en', () => L.RULES.map((r) => r.title)));
  withLang('en', () => L.RULES.forEach((r) => assert.ok(!FRENCH_IN_EN.test(r.title + ' ' + (r.help || '')), 'français dans titre en ' + r.id)));
});

test('(g) rapport Markdown d\'impact, natives et libellés suivent la langue active', () => {
  const { workflows, store } = H.load(), cg = G.callGraph(workflows);
  const ids = new Set(); workflows.forEach((w) => w.all.forEach((n) => { if (n.type === 'CustomManagementAction') ids.add(n.typeRef.toLowerCase()); }));
  const md = (l) => withLang(l, () => [...ids].map((g) => G.impactMarkdown(G.impactOfAction(workflows, store, g, cg))).join('\n'));
  const mf = md('fr'), me = md('en');
  assert.ok(mf.length > 200 && me.length > 200); assert.notStrictEqual(mf, me);
  const head = (s) => s.split('\n').filter((x) => /^#/.test(x)).map((x) => x.replace(/`[^`]*`/g, ''));
  // les titres du rapport (hors valeurs issues des données) sont traduits
  const frHeads = new Set(head(mf)), enHeads = head(me);
  assert.ok(enHeads.length && enHeads.some((h) => !frHeads.has(h)), 'titres du rapport traduits');
  const syn = synthWf();
  const nf = withLang('fr', () => syn.all.map((n) => N.describe(n, {}))), ne = withLang('en', () => syn.all.map((n) => N.describe(n, {})));
  const mail = (x) => x.find((r) => r && r.key === 'SendEmailNotification'), delay = (x) => x.find((r) => r && r.key === 'item::delay');
  assert.match(mail(nf).summary, /^Envoie un courriel à /); assert.match(mail(ne).summary, /^Sends an email to /);
  assert.strictEqual(mail(nf).label, 'Envoyer une notification par courriel'); assert.strictEqual(mail(ne).label, 'Send an email notification');
  assert.strictEqual(delay(nf).summary, 'Attend 5 min'); assert.strictEqual(delay(ne).summary, 'Waits 5 min');
  ne.filter(Boolean).forEach((r) => { assert.ok(!FRENCH_IN_EN.test(r.label + ' ' + r.summary + r.notes.join(' ') + r.fields.map((f) => f.label + (f.text || '')).join(' ')), 'français dans natives en: ' + r.key); });
  const rp = (l) => withLang(l, () => LB.readablePath('filter.conditionGroups[0].conditions[1].value'));
  assert.match(rp('fr'), /groupe 1, n°2/); assert.match(rp('en'), /group 1, #2/);
  assert.strictEqual(withLang('fr', () => LB.readablePath('settings.groupId')), 'Paramètre « groupId »'); assert.strictEqual(withLang('en', () => LB.readablePath('settings.groupId')), 'Setting “groupId”');
});

test('(h) non-régression fr: durée de l\'action item::delay (secondes, src user, aucune "unité supposée")', () => {
  const syn = synthWf(), d = (l, v) => withLang(l, () => N.dur(v));
  ['fr', 'en'].forEach((l) => { assert.strictEqual(d(l, 300), '5 min'); assert.strictEqual(d(l, 99999), '27 h 46 min 39 s'); });
  const r = withLang('fr', () => N.describe(syn.all.find((n) => n.id === 'item::delay'), {})); assert.strictEqual(r.src, 'user');
  assert.ok(!/suppos|assumed/i.test(JSON.stringify([r, withLang('en', () => N.describe(syn.all.find((n) => n.id === 'item::delay'), {}))])));
  // sources: aucune mention d'unité supposée dans le code ni les dictionnaires
  fs.readdirSync(SRC).filter((f) => f.endsWith('.js') && f !== 'demo-data.js').forEach((f) => assert.ok(!/unité supposée|assumed unit/i.test(fs.readFileSync(path.join(SRC, f), 'utf8')), f));
  // la formulation prudente de owner-approval-timeout n'est pas généralisée à 'user'
  assert.notStrictEqual(N.registry['item::owner-approval-timeout'].src, 'user');
});

test('(i) toutes les clés utilisées (src/*.js et data-i18n* de index.html) existent dans fr et en', () => {
  const used = new Map(); const add = (k, f) => { if (!used.has(k)) used.set(k, new Set()); used.get(k).add(f); };
  fs.readdirSync(SRC).filter((f) => f.endsWith('.js') && !/^i18n-|demo-data/.test(f)).forEach((f) => {
    const s = fs.readFileSync(path.join(SRC, f), 'utf8');
    for (const m of s.matchAll(/\b(?:t18|tt|T|I\.t|i18n\.t)\(\s*'([a-zA-Z][\w.:-]*)'/g)) add(m[1], f);
    for (const m of s.matchAll(/\bT\(\s*[^'(),]+\?\s*'([a-zA-Z][\w.]*)'\s*:\s*'([a-zA-Z][\w.]*)'/g)) { add(m[1], f); add(m[2], f); } // T(cond ? 'a' : 'b')
  });
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-title|-aria|-ph)?="([^"]+)"/g)) add(m[1], 'index.html');
  const missing = [];
  used.forEach((files, k) => {
    if (k.endsWith('.')) { if (!Object.keys(fr).some((x) => x.startsWith(k)) || !Object.keys(en).some((x) => x.startsWith(k))) missing.push(k + '* (' + [...files] + ')'); return; }
    if (!(k in fr) || !(k in en)) missing.push(k + ' (' + [...files] + ')');
  });
  assert.deepStrictEqual(missing, []);
  assert.ok(used.size > 300, 'clés utilisées: ' + used.size);
});

test('humanize: les gabarits de syntaxe {{input::…}} / {{action::…}} des messages restent tels quels (pas de « undefined » ni de {name})', () => {
  ['fr', 'en'].forEach((l) => withLang(l, () => {
    const out = LB.humanize('par {{input::…}} et {{action::…}}', null); assert.strictEqual(out, 'par {{input::…}} et {{action::…}}');
    const wf = synthWf(); const msgs = L.lintWorkflow(wf, { wfs: new Map([[wf.id, wf]]), store: null, cg: G.callGraph(new Map([[wf.id, wf]])) }).map((x) => LB.humanize(x.message, wf));
    assert.ok(msgs.every((m) => !/undefined|{name}/.test(m)), msgs.join(' | '));
  }));
});
