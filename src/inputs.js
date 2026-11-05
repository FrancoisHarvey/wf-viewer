/* inputs.js - classification des inputs d'un workflow depuis inputSchema.properties (pur, sans DOM).
   Catégories déduites des 1361 propriétés des 310 fichiers (voir README): text, enum, yesno, boolean, integer, datetime,
   password, customlist, datasource, target. */
(function (root) {
  'use strict';
  var model = typeof require === 'function' ? require('./model.js') : root.WFV.model;

  var KINDS = {
    text: { icon: 'Aa', label: 'Texte' },
    enum: { icon: '▾', label: 'Liste de valeurs' },
    yesno: { icon: '✓✗', label: 'Oui / Non' },
    boolean: { icon: '◐', label: 'Booléen' },
    integer: { icon: '#', label: 'Nombre' },
    number: { icon: '#', label: 'Nombre' },
    datetime: { icon: '📅', label: 'Date-heure' },
    password: { icon: '🔒', label: 'Mot de passe' },
    customlist: { icon: '☰', label: 'Liste personnalisée' },
    datasource: { icon: '⛁', label: 'Source de données' },
    target: { icon: '◎', label: 'Cible' }
  };
  var YESNO = /^(oui|non|yes|no)$/i;
  var TARGETS = { User: 'Utilisateur', Mailbox: 'Boîte aux lettres', SecurityGroup: 'Groupe de sécurité', DistributionGroup: 'Groupe de distribution' };

  function classify(name, p, required) {
    p = p && typeof p === 'object' ? p : {};
    var type = Array.isArray(p.type) ? p.type.join('|') : p.type || '';
    var tt = p.inputTargetType;
    var en = Array.isArray(p.enum) ? p.enum : null;
    var kind;
    if (p['x-cv-password'] === true || p['x-cv-protected'] === true) kind = 'password';
    else if (p.format === 'date-time' || p.format === 'date' || (p['x-cv-ui'] && /date/i.test(String(p['x-cv-ui'])))) kind = 'datetime';
    else if (p['x-cv-custom-list']) kind = 'customlist';
    else if (p['x-cv-data-source']) kind = 'datasource';
    else if (tt && tt !== 'noTarget') kind = 'target';
    else if (en && en.length === 2 && en.every(function (v) { return YESNO.test(String(v)); })) kind = 'yesno';
    else if (en) kind = 'enum';
    else if (type === 'boolean') kind = 'boolean';
    else if (type === 'integer' || type === 'number') kind = type;
    else kind = 'text';
    var d = p.inputDescription;
    var rules = p.passwordRules && typeof p.passwordRules === 'object' ? p.passwordRules : null;
    return {
      name: name, kind: kind, kindLabel: KINDS[kind].label, icon: KINDS[kind].icon, type: type, title: p.title || '', required: !!required,
      description: typeof d === 'string' ? d : d == null ? '' : d, // objet possible (5 cas): rendu générique côté UI
      tooltip: p['x-cv-tooltip'] || '', protected: p['x-cv-protected'] === true, enumValues: en, enumBad: p.enum != null && !en,
      customList: p['x-cv-custom-list'] || null, dataSource: p['x-cv-data-source'] || null, filterable: p['x-cv-data-source-filterable'] === true,
      targetType: tt && tt !== 'noTarget' ? tt : null, targetLabel: tt && TARGETS[tt] ? TARGETS[tt] : tt && tt !== 'noTarget' ? tt : null,
      format: p.format || '', ui: p['x-cv-ui'] || '', passwordRules: rules, hasDefault: Object.prototype.hasOwnProperty.call(p, 'default'), defaultValue: p.default, raw: p
    };
  }

  // -> {ok, inputs:[...], error?, raw}
  function parseInputs(wf) {
    var s = model.parseJsonField(wf.data.inputSchema);
    if (!s) return { ok: true, inputs: [], raw: null };
    if (s.__parseError || !s.properties || typeof s.properties !== 'object') return { ok: false, inputs: [], error: s.__parseError || 'pas de properties', raw: s };
    var req = {}; (Array.isArray(s.required) ? s.required : []).forEach(function (k) { req[k] = true; });
    return { ok: true, raw: s, inputs: Object.keys(s.properties).map(function (k) { return classify(k, s.properties[k], req[k]); }), requiredMissing: Object.keys(req).filter(function (k) { return !(k in s.properties); }) };
  }

  // ---------- édition: formes de schéma par catégorie (dérivées de la STRUCTURE des exports observés, sans valeurs réelles) ----------
  // Formes observées (ordre des clés): type, title, inputDescription, inputTargetType, puis clés propres à la catégorie:
  //   text: -  | enum/yesno: enum[] | customlist: x-cv-custom-list | datasource: x-cv-data-source, x-cv-data-source-filterable
  //   integer/boolean: type seul | datetime: x-cv-ui, format | password: x-cv-protected, x-cv-password, x-cv-tooltip, passwordRules
  //   target: inputTargetType = User | Mailbox | SecurityGroup | DistributionGroup
  var SELECTABLE = ['text', 'enum', 'yesno', 'boolean', 'integer', 'datetime', 'password', 'customlist', 'datasource', 'target'];
  var TARGET_TYPES = { User: 'Utilisateur', Mailbox: 'Boîte aux lettres', SecurityGroup: 'Groupe de sécurité', DistributionGroup: 'Groupe de distribution' };
  var YESNO_FORMS = [['Non', 'Oui'], ['NON', 'OUI'], ['NO', 'YES']];
  var MANAGED = ['type', 'enum', 'format', 'x-cv-ui', 'x-cv-custom-list', 'x-cv-data-source', 'x-cv-data-source-filterable', 'x-cv-protected', 'x-cv-password', 'x-cv-tooltip', 'passwordRules', 'inputTargetType'];
  // Certitude des formes: false = déduction partielle (signalée dans l'UI)
  var CERTAINTY = { text: true, enum: true, yesno: false, boolean: true, integer: true, datetime: true, password: false, customlist: true, datasource: true, target: true };
  var UNCERTAIN_NOTES = {
    yesno: 'Aucun marqueur distinct dans le schéma: un « Oui / Non » est une liste de valeurs à 2 entrées; trois graphies existent dans les exports (Non/Oui, NON/OUI, NO/YES).',
    password: 'Deux variantes de règles de mot de passe existent (requiredigits ou requireNumbers, specifyLength optionnel): l\'éditeur conserve les clés présentes.'
  };
  function defaultPasswordRules() { return { specifyLength: true, minLength: 12, requireUppercase: true, requiredigits: true, requireSpecialChars: true, specialCharsConfig: { useDefaultChars: true, customChars: '' }, isEditable: true }; }
  function isYesNo(v) { return Array.isArray(v) && v.length === 2 && v.every(function (x) { return YESNO.test(String(x)); }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Clés managées voulues pour une catégorie (ordre canonique). opts: {targetType, values, customList, dataSource, filterable}
  function desiredKeys(kind, p, opts) {
    var d = [['type', kind === 'integer' ? 'integer' : kind === 'boolean' ? 'boolean' : 'string'], ['inputTargetType', kind === 'target' ? (opts.targetType || p.inputTargetType && p.inputTargetType !== 'noTarget' && p.inputTargetType || 'User') : 'noTarget']];
    if (kind === 'enum') d.push(['enum', Array.isArray(opts.values) ? opts.values.slice() : Array.isArray(p.enum) ? p.enum.slice() : []]);
    else if (kind === 'yesno') d.push(['enum', isYesNo(opts.values) ? opts.values.slice() : isYesNo(p.enum) ? p.enum.slice() : YESNO_FORMS[0].slice()]);
    else if (kind === 'datetime') { d.push(['x-cv-ui', 'DateTimePicker']); d.push(['format', 'date-time']); }
    else if (kind === 'customlist') d.push(['x-cv-custom-list', opts.customList != null ? opts.customList : p['x-cv-custom-list'] != null ? p['x-cv-custom-list'] : '']);
    else if (kind === 'datasource') { d.push(['x-cv-data-source', opts.dataSource != null ? opts.dataSource : p['x-cv-data-source'] != null ? p['x-cv-data-source'] : '']); d.push(['x-cv-data-source-filterable', opts.filterable != null ? !!opts.filterable : p['x-cv-data-source-filterable'] != null ? p['x-cv-data-source-filterable'] : true]); }
    else if (kind === 'password') { d.push(['x-cv-protected', true]); d.push(['x-cv-password', true]); d.push(['x-cv-tooltip', 'PasswordRules']); d.push(['passwordRules', p.passwordRules && typeof p.passwordRules === 'object' ? p.passwordRules : defaultPasswordRules()]); }
    return d;
  }
  // Convertit une propriété vers une catégorie: ajoute/retire les clés nécessaires, CONSERVE les clés inconnues et l'ordre existant.
  // -> {prop, lost:[messages], needs: 'enum'|'customList'|'dataSource'|null, certain}
  function convertProp(prop, kind, opts) {
    opts = opts || {}; var p = prop && typeof prop === 'object' && !Array.isArray(prop) ? prop : {}, lost = [], needs = null;
    if (SELECTABLE.indexOf(kind) < 0) return { error: 'catégorie inconnue: ' + kind };
    var want = desiredKeys(kind, p, opts), map = {}; want.forEach(function (w) { map[w[0]] = w[1]; });
    var oldKind = classify('x', p, false).kind;
    Object.keys(p).forEach(function (k) {
      if (MANAGED.indexOf(k) < 0) return;
      if (!Object.prototype.hasOwnProperty.call(map, k)) {
        if (k === 'enum') lost.push('Liste de valeurs supprimée (' + (Array.isArray(p.enum) ? p.enum.length : 0) + ' valeur(s))');
        else if (k === 'x-cv-custom-list') lost.push('Liste personnalisée supprimée'); else if (k === 'x-cv-data-source') lost.push('Source de données supprimée'); else if (k === 'x-cv-data-source-filterable') { /* suit la source */ }
        else if (k === 'passwordRules') lost.push('Règles de mot de passe supprimées'); else if (k === 'x-cv-protected' || k === 'x-cv-password') { /* suit le mot de passe */ } else if (k === 'x-cv-tooltip') lost.push('Tooltip supprimé');
        else if (k === 'format' || k === 'x-cv-ui') lost.push('Format de date supprimé');
      } else if (k === 'type' && p.type !== map.type) lost.push('Type JSON modifié (' + p.type + ' → ' + map.type + ')');
      else if (k === 'inputTargetType' && p[k] !== map[k] && p[k] !== undefined && p[k] !== 'noTarget') lost.push('Cible modifiée (' + p[k] + ' → ' + map[k] + ')');
      else if (k === 'enum' && JSON.stringify(p.enum) !== JSON.stringify(map.enum)) lost.push('Valeurs de la liste remplacées');
    });
    if (Object.prototype.hasOwnProperty.call(p, 'default') && (kind === 'integer' && typeof p.default !== 'number' || kind === 'boolean' && typeof p.default !== 'boolean' || (kind === 'enum' || kind === 'yesno') && Array.isArray(map.enum) && map.enum.indexOf(p.default) < 0)) lost.push('La valeur par défaut existante peut devenir incompatible');
    if (oldKind === kind && !lost.length && kind !== 'target') { /* inchangé */ }
    var out = {}, used = {};
    Object.keys(p).forEach(function (k) { if (MANAGED.indexOf(k) < 0) out[k] = p[k]; else if (Object.prototype.hasOwnProperty.call(map, k)) { out[k] = map[k]; used[k] = 1; } });
    want.forEach(function (w) { if (!used[w[0]]) out[w[0]] = w[1]; });
    if (kind === 'enum' && !out.enum.length) needs = 'enum'; if (kind === 'customlist' && out['x-cv-custom-list'] === '') needs = 'customList'; if (kind === 'datasource' && out['x-cv-data-source'] === '') needs = 'dataSource';
    return { prop: out, lost: lost, needs: needs, certain: CERTAINTY[kind] };
  }
  // Nouvelle propriété d'une catégorie (forme canonique observée).
  function newProp(kind, opts) {
    opts = opts || {}; return convertProp({ type: 'string', title: opts.title != null ? opts.title : '', inputDescription: opts.description || '', inputTargetType: 'noTarget' }, kind, opts);
  }

  // ---------- valeurs de liste (enum): fonctions pures ----------
  function parsePaste(text) { return String(text == null ? '' : text).split(/\r\n|\r|\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l !== ''; }); }
  function dedupe(values) { var seen = {}, out = []; values.forEach(function (v) { var k = String(v); if (!Object.prototype.hasOwnProperty.call(seen, k)) { seen[k] = 1; out.push(v); } }); return out; }
  function sortValues(values, dir) { var o = values.slice().sort(function (a, b) { return String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' }); }); return dir === 'desc' ? o.reverse() : o; }
  function moveValue(values, from, to) { var o = values.slice(); if (from < 0 || from >= o.length) return o; to = Math.max(0, Math.min(o.length - 1, to)); var v = o.splice(from, 1)[0]; o.splice(to, 0, v); return o; }
  function duplicatesOf(values) { var seen = {}, d = []; values.forEach(function (v) { var k = String(v); if (seen[k] && d.indexOf(k) < 0) d.push(k); seen[k] = 1; }); return d; }

  // Validation d'un nom d'input. Retourne {error, warning}. props: objet des propriétés; except: nom actuel (renommage).
  function validateName(name, props, except) {
    if (typeof name !== 'string' || name === '') return { error: 'le nom est vide' };
    if (name !== name.trim()) return { error: 'le nom ne doit pas commencer ni finir par un espace' };
    if (/[{}]|::/.test(name)) return { error: 'les caractères « { », « } » et « :: » sont interdits (ils cassent la syntaxe des références)' };
    var low = name.toLowerCase(), clash = Object.keys(props || {}).find(function (k) { return k !== except && k.toLowerCase() === low; });
    if (clash) return { error: clash === name ? 'un input « ' + name + ' » existe déjà' : 'collision (insensible à la casse) avec « ' + clash + ' »' };
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return { warning: 'le nom ne respecte pas [A-Za-z_][A-Za-z0-9_]* (compatibilité côté CoreView non vérifiée)' };
    return {};
  }

  var api = { classify: classify, parseInputs: parseInputs, KINDS: KINDS, SELECTABLE: SELECTABLE, TARGET_TYPES: TARGET_TYPES, YESNO_FORMS: YESNO_FORMS, CERTAINTY: CERTAINTY, UNCERTAIN_NOTES: UNCERTAIN_NOTES,
    convertProp: convertProp, newProp: newProp, defaultPasswordRules: defaultPasswordRules, parsePaste: parsePaste, dedupe: dedupe, sortValues: sortValues, moveValue: moveValue, duplicatesOf: duplicatesOf, validateName: validateName, isYesNo: isYesNo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.inputs = api; }
})(typeof self !== 'undefined' ? self : globalThis);
