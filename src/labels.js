/* labels.js - helpers purs pour la "vue de base" (libellés lisibles) et l'état "vue expert" (hash / localStorage). */
(function (root) {
  'use strict';
  var refs = typeof require === 'function' ? require('./refs.js') : root.WFV.refs;
  var GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

  // Remplace les tokens {{...}} et les GUID nus par des libellés lisibles (nom du node / de l'input, chemin). wf optionnel (résolution des uid).
  function humanize(str, wf) {
    if (typeof str !== 'string') return str;
    var s = str.replace(/\{\{([^{}]*)\}\}/g, function (all, inner) {
      var t = refs.parseInner(inner);
      if (t.kind === 'action') { var n = wf && wf.uidMap && wf.uidMap[t.uid]; return '«' + (n ? (n.name || n.type) : 'node inconnu') + '»' + (t.path ? ' › ' + t.path : ''); }
      if (t.kind === 'input') return t.system ? 'variable système ' + t.param : 'input « ' + t.param + ' »';
      return all;
    });
    return s.replace(GUID, function (g) { var n = wf && wf.uidMap && wf.uidMap[g]; return n ? '«' + (n.name || n.type) + '»' : g.slice(0, 8) + '…'; });
  }

  var FIELD = { name: 'Nom', customDescription: 'Description', id: "Type d'action", forceSkip: 'Ignorer (forceSkip)', filter: "Condition d'exécution", workflowName: 'Nom du workflow', description: 'Description', status: 'Statut', targetsConfig: 'Cibles', inputSchema: 'Inputs', workflowConfig: 'Configuration', notificationConfig: 'Notifications' };
  var COND = { property: 'propriété', operator: 'opérateur', value: 'valeur', type: 'type' };
  // Chemin technique de diff (ex "settings.groupId", "filter.conditionGroups[0].conditions[1].value") -> libellé lisible.
  function readablePath(p) {
    p = String(p == null ? '' : p);
    if (p === '') return 'Node';
    var m;
    if ((m = /^settings\.(.+)$/.exec(p))) return 'Paramètre « ' + m[1].replace(/\./g, ' › ') + ' »';
    if ((m = /^filter\.conditionGroups\[(\d+)\]\.conditions\[(\d+)\](?:\.(\w+))?$/.exec(p))) return 'Condition (groupe ' + (+m[1] + 1) + ', n°' + (+m[2] + 1) + ')' + (m[3] ? ' — ' + (COND[m[3]] || m[3]) : '');
    if ((m = /^filter\.conditionGroups\[(\d+)\](.*)$/.exec(p))) return 'Condition (groupe ' + (+m[1] + 1) + ')' + (m[2] ? ' ' + m[2] : '');
    if ((m = /^filter\.conditions\[(\d+)\](?:\.(\w+))?$/.exec(p))) return 'Condition n°' + (+m[1] + 1) + (m[2] ? ' — ' + (COND[m[2]] || m[2]) : '');
    if ((m = /^inputSchema\.properties\.([^.]+)(?:\.(.+))?$/.exec(p))) return 'Input « ' + m[1] + ' »' + (m[2] ? ' — ' + m[2] : '');
    if ((m = /^targetsConfig\.targets\[(\d+)\](.*)$/.exec(p))) return 'Cible n°' + (+m[1] + 1) + (m[2] ? ' ' + m[2].replace(/^\./, '› ') : '');
    var head = p.split(/[.\[]/)[0];
    if (FIELD[head]) return FIELD[head] + (p.length > head.length ? ' › ' + p.slice(head.length).replace(/^\./, '') : '');
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
