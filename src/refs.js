/* refs.js - extraction des références {{...}} (pur, sans DOM).
   Format UMD "classique": fonctionne via <script> (window.WFV.refs) et via require() sous node. */
(function (root) {
  'use strict';
  var t18 = (typeof require === 'function' ? require('./i18n.js') : root.WFV.i18n).t;
  var FN_RE = /^(\w+)\((.*)\)$/;

  function parseInner(inner) {
    var parts = inner.split('::');
    var kind = parts[0];
    var t = { kind: kind === 'input' || kind === 'action' ? kind : 'other', inner: inner, malformed: false, fns: [] };
    for (var i = 3; i < parts.length; i++) {
      var m = FN_RE.exec(parts[i]);
      if (m) t.fns.push({ name: m[1], args: m[2] });
    }
    if (t.kind === 'input') {
      t.stepUid = parts[1]; t.param = parts[2]; t.label = parts[3];
      t.system = parts[1] === 'undefined';
    } else if (t.kind === 'action') {
      t.uid = parts[1]; t.path = parts[2]; t.label = parts[3];
    }
    return t;
  }

  // Retourne la liste ordonnée de tokens (bien formés + malformés) trouvés dans str.
  function extractTokens(str) {
    var out = [];
    if (typeof str !== 'string' || str.indexOf('{{') < 0) return out;
    var re = /\{\{([^{}]*)\}\}/g, m, covered = [];
    while ((m = re.exec(str))) {
      var t = parseInner(m[1]); t.raw = m[0]; t.index = m.index; out.push(t);
      covered.push([m.index, m.index + m[0].length]);
    }
    // '{{' non couverts par un token valide => accolades mal formées
    var p = -1;
    while ((p = str.indexOf('{{', p + 1)) >= 0) {
      var inside = covered.some(function (c) { return p >= c[0] && p < c[1]; });
      if (inside) continue;
      var end = str.indexOf('}}', p);
      var raw = end >= 0 && end - p < 400 ? str.slice(p, end + 2) : str.slice(p, p + 80);
      var inner = raw.replace(/^\{\{/, '').replace(/\}\}$/, '');
      var mt = parseInner(inner); mt.raw = raw; mt.index = p; mt.malformed = true;
      mt.reasonKey = end < 0 ? 'refs.reason.unclosed' : 'refs.reason.unbalanced'; mt.reason = t18(mt.reasonKey);
      out.push(mt);
    }
    out.sort(function (a, b) { return a.index - b.index; });
    return out;
  }

  // Découpe un texte en segments {text} / {token} pour affichage.
  function splitText(str) {
    var toks = extractTokens(str), segs = [], pos = 0;
    toks.forEach(function (t) {
      if (t.index > pos) segs.push({ text: str.slice(pos, t.index) });
      segs.push({ token: t }); pos = t.index + t.raw.length;
    });
    if (pos < str.length) segs.push({ text: str.slice(pos) });
    return segs;
  }

  // Parcourt toutes les chaînes d'une valeur JSON (cb(str, path)).
  function walkStrings(v, path, cb) {
    if (typeof v === 'string') cb(v, path);
    else if (Array.isArray(v)) v.forEach(function (x, i) { walkStrings(x, path + '[' + i + ']', cb); });
    else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { walkStrings(v[k], path ? path + '.' + k : k, cb); });
  }

  // Remplace les uid (action::uid, input::uid) par un libellé canonique via canon(uid) -> string|undefined.
  function normalizeString(str, canon) {
    if (typeof str !== 'string' || str.indexOf('{{') < 0) return str;
    return str.replace(/\{\{([^{}]*)\}\}/g, function (all, inner) {
      var p = inner.split('::');
      if ((p[0] === 'action' || p[0] === 'input') && p.length > 1) {
        var c = canon(p[1]);
        if (c) { p[1] = '@' + c; return '{{' + p.join('::') + '}}'; }
      }
      return all;
    });
  }

  var api = { parseInner: parseInner, extractTokens: extractTokens, splitText: splitText, walkStrings: walkStrings, normalizeString: normalizeString };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.refs = api; }
})(typeof self !== 'undefined' ? self : globalThis);
