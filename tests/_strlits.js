'use strict';
// Extrait les littéraux de chaîne (', ", `) d'un source JS en ignorant commentaires et regex simples. Retourne [{line, text}].
var BS = String.fromCharCode(92);
module.exports = function strlits(src) {
  var out = [], i = 0, n = src.length, line = 1, prev = '';
  while (i < n) {
    var c = src[i], d = src[i + 1];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === '/' && /[=(,:;!&|?{}\[]$|return$|^$/.test(prev)) { // littéral regex
      i++; var cls = false;
      while (i < n && (src[i] !== '/' || cls) && src[i] !== '\n') { if (src[i] === BS) i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; i++; }
      i++; prev = 'x'; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      var q = c, s = '', l0 = line; i++;
      while (i < n && src[i] !== q) { if (src[i] === BS) { s += src[i] + src[i + 1]; i += 2; continue; } if (src[i] === '\n') line++; s += src[i++]; }
      i++; out.push({ line: l0, text: s }); prev = 'x'; continue;
    }
    if (!/\s/.test(c)) { prev = /\w/.test(c) ? (prev + c).slice(-8) : c; }
    i++;
  }
  return out;
};
