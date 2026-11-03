/* pshighlight.js - tokenizer PowerShell maison (pur, sans DOM, sans dépendance).
   Garanties: ne lève jamais d'exception, termine toujours (chaque itération avance d'au moins 1 caractère),
   et la concaténation des tokens est exactement le texte source. Types: comment, string, hstring, variable, const, keyword, cmdlet,
   param, op, number, type, attr, plain. */
(function (root) {
  'use strict';
  var KW = {};
  ('function param if elseif else foreach for while do until switch try catch finally throw return break continue begin process end class using trap filter workflow in exit data dynamicparam enum hidden static from parallel inlinescript sequence default').split(' ').forEach(function (k) { KW[k] = 1; });
  var OPS = /-(?:[ci])?(?:eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|contains|notcontains|in|notin|replace|split|join)(?![\w-])|-(?:is|isnot|as|and|or|xor|not|band|bor|bxor|bnot|shl|shr|f)(?![\w-])/iy;
  var VAR = /\$(?:\{[^}\r\n]*\}?|[A-Za-z_]\w*(?::[A-Za-z_]\w*)?|[$?^])/y;
  var TYPE = /\[[A-Za-z_][\w.]*(?:\[[\],\s]*\])?(?:\s*,\s*[A-Za-z_][\w.]*)*\]/y;
  var ATTR = /\[(?:Parameter|CmdletBinding|Alias|Validate\w+|OutputType|Allow\w*|Cmdlet\w*)(?=\()/iy;
  var NUM = /(?:0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:kb|mb|gb|tb|pb|ul|l|d|u)?(?![\w])/iy;
  var WORD = /[A-Za-z_][\w]*(?:-[A-Za-z_]\w*)*/y;
  var PARAM = /-[A-Za-z_]\w*/y;
  var CMDLET = /^[A-Z][A-Za-z]*(?:-[A-Z][A-Za-z0-9]*)+$/;
  var CONSTS = { '$true': 1, '$false': 1, '$null': 1 };

  function at(re, s, i) { re.lastIndex = i; return re.exec(s); }
  function isSpace(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === undefined; }

  function tokenize(src, depth) {
    src = String(src == null ? '' : src); depth = depth || 0;
    var out = [], plain = '', i = 0, n = src.length;
    function flush() { if (plain) { out.push({ t: 'plain', s: plain }); plain = ''; } }
    function push(t, s) { if (!s) return; flush(); out.push({ t: t, s: s }); }
    while (i < n) {
      var c = src[i], m, j, e;
      if (c === '<' && src[i + 1] === '#') { e = src.indexOf('#>', i + 2); j = e < 0 ? n : e + 2; push('comment', src.slice(i, j)); i = j; continue; }
      if (c === '#') { e = src.indexOf('\n', i); j = e < 0 ? n : e; if (j > i && src[j - 1] === '\r') j--; push('comment', src.slice(i, j)); i = j; continue; }
      if (c === '@' && (src[i + 1] === "'" || src[i + 1] === '"')) { // here-string: ouverture suivie d'un saut de ligne, fermeture "\n'@" en début de ligne
        var q = src[i + 1], k = i + 2; while (src[k] === ' ' || src[k] === '\t') k++;
        if (src[k] === '\r' || src[k] === '\n') {
          var p = src.indexOf('\n' + q + '@', k); j = p < 0 ? n : p + 3; push('hstring', src.slice(i, j)); i = j; continue;
        }
      }
      if (c === "'") { j = i + 1; while (j < n) { if (src[j] === "'") { if (src[j + 1] === "'") { j += 2; continue; } j++; break; } j++; } push('string', src.slice(i, j)); i = j; continue; }
      if (c === '"') { i = dstring(src, i, out, push, depth, flush); continue; }
      if (c === '$') {
        if (src[i + 1] === '(') { push('op', '$('); i += 2; continue; }
        m = at(VAR, src, i); if (m) { push(CONSTS[m[0].toLowerCase()] ? 'const' : 'variable', m[0]); i += m[0].length; continue; }
      }
      if (c === '@') {
        if (src[i + 1] === '{' || src[i + 1] === '(') { push('op', '@' + src[i + 1]); i += 2; continue; }
        m = /@[A-Za-z_]\w*/y; m = at(m, src, i); if (m) { push('variable', m[0]); i += m[0].length; continue; }
      }
      if (c === '[') {
        m = at(ATTR, src, i); if (m) { push('attr', m[0]); i += m[0].length; continue; }
        m = at(TYPE, src, i); if (m) { push('type', m[0]); i += m[0].length; continue; }
      }
      var prev = src[i - 1];
      if (c === '-' && (isSpace(prev) || prev === '(' || prev === ',' || prev === ';' || prev === '{' || prev === '|')) {
        m = at(OPS, src, i); if (m) { push('op', m[0]); i += m[0].length; continue; }
        m = at(PARAM, src, i); if (m) { push('param', m[0]); i += m[0].length; continue; }
      }
      if (c >= '0' && c <= '9' && !/[\w.$]/.test(prev || ' ')) { m = at(NUM, src, i); if (m) { push('number', m[0]); i += m[0].length; continue; } }
      if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
        m = at(WORD, src, i);
        if (m) {
          var w = m[0], lw = w.toLowerCase();
          if (prev === '.' || prev === ':') { plain += w; i += w.length; continue; } // membre ou portée: texte
          if (CMDLET.test(w)) push('cmdlet', w);
          else if (KW[lw] && prev !== '-' && prev !== '$') push('keyword', w);
          else plain += w;
          i += w.length; continue;
        }
      }
      if (c === '|' || c === '&' || c === '=') { var op = c; while ((src[i + op.length] === c) && op.length < 2) op += c; push('op', op); i += op.length; continue; }
      plain += c; i++;
    }
    flush();
    return out;
  }

  // Chaîne "..." avec ` et "" comme échappements; $var et $( ) mis en évidence à l'intérieur. Retourne le nouvel index.
  function dstring(src, i, out, push, depth, flush) {
    var n = src.length, j = i + 1;
    while (j < n) { var ch = src[j]; if (ch === '`') { j += 2; continue; } if (ch === '"') { if (src[j + 1] === '"') { j += 2; continue; } j++; break; } j++; }
    if (j > n) j = n;
    var end = j, closed = src[end - 1] === '"' && end - 1 > i, inner = closed ? end - 1 : end, k = i, seg = '';
    while (k < inner) {
      var c = src[k];
      if (c === '`') { seg += src.slice(k, k + 2); k += 2; continue; }
      if (c === '$' && k + 1 < inner) {
        if (src[k + 1] === '(' && depth < 3) {
          var d = 1, e = k + 2; while (e < inner && d > 0) { if (src[e] === '(') d++; else if (src[e] === ')') d--; e++; }
          var close = d === 0 ? e - 1 : e; if (seg) { push('string', seg); seg = ''; } push('variable', '$(');
          var innerToks = tokenize(src.slice(k + 2, close), depth + 1); for (var t = 0; t < innerToks.length; t++) { flush(); out.push(innerToks[t]); }
          if (d === 0) push('variable', ')'); k = d === 0 ? e : close; continue;
        }
        var rx = /\$(?:\{[^}\r\n]*\}|[A-Za-z_]\w*(?::[A-Za-z_]\w*)?|[$?^])/y; rx.lastIndex = k; var mm = rx.exec(src);
        if (mm && k + mm[0].length <= inner) { if (seg) { push('string', seg); seg = ''; } push('variable', mm[0]); k += mm[0].length; continue; }
      }
      seg += c; k++;
    }
    if (closed) seg += '"';
    if (seg) push('string', seg);
    return end > i ? end : i + 1;
  }

  // Découpe les tokens par ligne. -> [{start, toks:[{t,s,o}]}] (o = offset dans la source; start = offset de début de ligne)
  function toLines(src, tokens) {
    var lines = [], cur = { start: 0, toks: [] }, pos = 0;
    tokens.forEach(function (tk) {
      var s = tk.s, off = 0, re = /\r\n|\r|\n/g, m;
      while ((m = re.exec(s))) {
        if (m.index > off) cur.toks.push({ t: tk.t, s: s.slice(off, m.index), o: pos + off });
        lines.push(cur); off = m.index + m[0].length; cur = { start: pos + off, toks: [] };
        if (m[0].length === 0) re.lastIndex++;
      }
      if (off < s.length) cur.toks.push({ t: tk.t, s: s.slice(off), o: pos + off });
      pos += s.length;
    });
    lines.push(cur); return lines;
  }

  // Occurrences (insensible à la casse) d'un terme: [[début, fin)]
  function findRanges(src, term, max) {
    var out = []; term = String(term || '').toLowerCase(); if (!term) return out; var low = String(src).toLowerCase(), i = -1; max = max || 3000;
    while (out.length < max && (i = low.indexOf(term, i + 1)) >= 0) out.push([i, i + term.length]);
    return out;
  }
  // Applique des plages à des tokens de ligne: sépare les tokens aux bornes et ajoute m:true sur les morceaux surlignés.
  function markTokens(toks, ranges) {
    if (!ranges || !ranges.length) return toks;
    var out = [];
    toks.forEach(function (tk) {
      var a = tk.o, b = tk.o + tk.s.length, cur = a;
      for (var r = 0; r < ranges.length; r++) {
        var rs = ranges[r][0], re = ranges[r][1]; if (re <= a || rs >= b) continue;
        var s1 = Math.max(rs, a), e1 = Math.min(re, b);
        if (s1 > cur) out.push({ t: tk.t, s: tk.s.slice(cur - a, s1 - a), o: cur });
        out.push({ t: tk.t, s: tk.s.slice(s1 - a, e1 - a), o: s1, m: true }); cur = e1;
      }
      if (cur < b) out.push({ t: tk.t, s: tk.s.slice(cur - a), o: cur });
    });
    return out;
  }

  var api = { tokenize: tokenize, toLines: toLines, findRanges: findRanges, markTokens: markTokens, KEYWORDS: KW };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.pshighlight = api; }
})(typeof self !== 'undefined' ? self : globalThis);
