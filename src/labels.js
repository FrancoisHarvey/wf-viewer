/* labels.js - helpers purs pour la "vue de base" (libellés lisibles) et l'état "vue expert" (hash / localStorage). */
(function (root) {
  'use strict';
  var refs = typeof require === 'function' ? require('./refs.js') : root.WFV.refs;
  var t18 = (typeof require === 'function' ? require('./i18n.js') : root.WFV.i18n).t;
  var GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

  // Remplace les tokens {{...}} et les GUID nus par des libellés lisibles (nom du node / de l'input, chemin). wf optionnel (résolution des uid).
  function humanize(str, wf) {
    if (typeof str !== 'string') return str;
    var s = str.replace(/\{\{([^{}]*)\}\}/g, function (all, inner) {
      var t = refs.parseInner(inner);
      if ((t.kind === 'input' && (!t.param || t.param === '…')) || (t.kind === 'action' && (!t.uid || t.uid === '…'))) return all; // gabarit de syntaxe (ex. {{input::…}} dans un message): laissé tel quel
      if (t.kind === 'action') { var n = wf && wf.uidMap && wf.uidMap[t.uid]; return t18('labels.q', { v: n ? (n.name || n.type) : t18('labels.unknownNode') }) + (t.path ? ' › ' + t.path : ''); }
      if (t.kind === 'input') return t.system ? t18('labels.sysVar', { name: t.param }) : t18('labels.input', { name: t.param });
      return all;
    });
    return s.replace(GUID, function (g) { var n = wf && wf.uidMap && wf.uidMap[g]; return n ? t18('labels.q', { v: n.name || n.type }) : g.slice(0, 8) + '…'; });
  }

  var FIELD = ['name', 'customDescription', 'id', 'forceSkip', 'filter', 'workflowName', 'description', 'status', 'targetsConfig', 'inputSchema', 'workflowConfig', 'notificationConfig'];
  var COND = ['property', 'operator', 'value', 'type'];
  var fld = function (k) { return t18('labels.field.' + k); }, cnd = function (k) { return COND.indexOf(k) >= 0 ? t18('labels.cond.' + k) : k; };
  // Chemin technique de diff (ex "settings.groupId", "filter.conditionGroups[0].conditions[1].value") -> libellé lisible.
  function readablePath(p) {
    p = String(p == null ? '' : p);
    if (p === '') return t18('labels.node');
    var m;
    if ((m = /^settings\.(.+)$/.exec(p))) return t18('labels.setting', { name: m[1].replace(/\./g, ' › ') });
    if ((m = /^filter\.conditionGroups\[(\d+)\]\.conditions\[(\d+)\](?:\.(\w+))?$/.exec(p))) return t18('labels.condGroup', { g: +m[1] + 1, n: +m[2] + 1 }) + (m[3] ? ' — ' + cnd(m[3]) : '');
    if ((m = /^filter\.conditionGroups\[(\d+)\](.*)$/.exec(p))) return t18('labels.condGroupOnly', { g: +m[1] + 1 }) + (m[2] ? ' ' + m[2] : '');
    if ((m = /^filter\.conditions\[(\d+)\](?:\.(\w+))?$/.exec(p))) return t18('labels.condN', { n: +m[1] + 1 }) + (m[2] ? ' — ' + cnd(m[2]) : '');
    if ((m = /^inputSchema\.properties\.([^.]+)(?:\.(.+))?$/.exec(p))) return t18('labels.input', { name: m[1] }).replace(/^./, function (c) { return c.toUpperCase(); }) + (m[2] ? ' — ' + m[2] : '');
    if ((m = /^targetsConfig\.targets\[(\d+)\](.*)$/.exec(p))) return t18('labels.targetN', { n: +m[1] + 1 }) + (m[2] ? ' ' + m[2].replace(/^\./, '› ') : '');
    var head = p.split(/[.\[]/)[0];
    if (FIELD.indexOf(head) >= 0) return fld(head) + (p.length > head.length ? ' › ' + p.slice(head.length).replace(/^\./, '') : '');
    return p;
  }

  // État expert: priorité au hash (x=1 / x=0), sinon valeur stockée ('1').
  function parseExpert(hash, stored) {
    var p = new URLSearchParams(String(hash || '').replace(/^#/, '')), x = p.get('x');
    if (x === '1') return true; if (x === '0') return false;
    return stored === '1' || stored === true;
  }
  function withExpertHash(hash, expert) {
    var p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    if (expert) p.set('x', '1'); else p.delete('x');
    return '#' + p.toString();
  }
  // Texte "dual": [raw, base] -> quel texte afficher selon le mode (helper testable)
  function pick(expert, rawText, baseText) { return expert ? rawText : baseText; }

  var api = { humanize: humanize, readablePath: readablePath, parseExpert: parseExpert, withExpertHash: withExpertHash, pick: pick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.labels = api; }
})(typeof self !== 'undefined' ? self : globalThis);
