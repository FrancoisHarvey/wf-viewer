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

  var api = { classify: classify, parseInputs: parseInputs, KINDS: KINDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.inputs = api; }
})(typeof self !== 'undefined' ? self : globalThis);
