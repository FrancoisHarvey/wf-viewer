// Tokenizer PowerShell: catégories, here-strings, robustesse (fuzz), round-trip sur les scripts des fixtures.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const H = require('./helpers.js');
const P = require('../src/pshighlight.js');

const join = (toks) => toks.map((t) => t.s).join('');
const has = (src, type, s) => P.tokenize(src).some((t) => t.t === type && (s === undefined || t.s === s));

test('catégories de tokens (cas synthétiques)', () => {
  assert.ok(has('# commentaire\nGet-Item', 'comment', '# commentaire')); assert.ok(has('a <# bloc\nmulti #> b', 'comment', '<# bloc\nmulti #>'));
  assert.ok(has("$x = 'it''s'", 'string', "'it''s'")); assert.ok(P.tokenize('$x = "a`"b"').some((t) => t.t === 'string'));
  assert.ok(has('$a = $env:USERNAME', 'variable', '$env:USERNAME')); assert.ok(has('$_ | foo', 'variable', '$_')); assert.ok(has('${my var} = 1', 'variable', '${my var}')); assert.ok(has('$script:x = 1', 'variable', '$script:x'));
  assert.ok(has('if ($true) {}', 'keyword', 'if')); assert.ok(has('if ($true) {}', 'const', '$true'));
  ['function', 'param', 'elseif', 'foreach', 'try', 'catch', 'finally', 'throw', 'return', 'switch', 'while', 'do'].forEach((k) => assert.ok(has(k + ' x', 'keyword', k), k));
  assert.ok(has('Get-ChildItem -Path x', 'cmdlet', 'Get-ChildItem')); assert.ok(has('Out-Null', 'cmdlet'));
  assert.ok(has('Get-Item -Name x -ErrorAction Stop', 'param', '-Name')); assert.ok(has('Get-Item -Name x -ErrorAction Stop', 'param', '-ErrorAction'));
  ['-eq', '-ne', '-like', '-match', '-and', '-or', '-not', '-contains', '-in', '-is', '-as', '-replace', '-split', '-join', '-f', '-notmatch', '-ceq'].forEach((o) => assert.ok(has('$a ' + o + ' $b', 'op', o), o));
  assert.ok(has('a | b', 'op', '|')); assert.ok(has('a && b', 'op', '&&')); assert.ok(has('$n = 42', 'number', '42')); assert.ok(has('$n = 3.14', 'number', '3.14')); assert.ok(has('$n = 0xFF', 'number', '0xFF')); assert.ok(has('$n = 10mb', 'number', '10mb'));
  assert.ok(has('[string]$x', 'type', '[string]')); assert.ok(has('[string[]]$x', 'type', '[string[]]')); assert.ok(has('[Parameter(Mandatory=$true)]', 'attr', '[Parameter')); assert.ok(has('[CmdletBinding()]', 'attr', '[CmdletBinding'));
  assert.ok(has('Foo @params', 'variable', '@params')); assert.ok(has('$h = @{ a = 1 }', 'op', '@{'));
});

test('faux positifs évités: membres, nombres dans les identifiants, commentaires, chaînes', () => {
  assert.ok(!has('$x.End', 'keyword')); assert.ok(!has('abc123', 'number')); assert.ok(has('$a -eq -1', 'op', '-eq')); assert.ok(!has('# if else function', 'keyword')); assert.ok(!has('"if else"', 'keyword'));
});

test('chaînes doubles: variables et sous-expressions; chaînes simples littérales', () => {
  const t = P.tokenize('"Bonjour $name, $($user.Name) ${x} fin"');
  ['$name', '$(', '${x}', '$user'].forEach((v) => assert.ok(t.some((x) => x.t === 'variable' && x.s === v), v)); assert.strictEqual(join(t), '"Bonjour $name, $($user.Name) ${x} fin"');
  assert.ok(P.tokenize("'$notvar'").every((x) => x.t === 'string'));
});

test('here-strings multi-lignes et chaînes non terminées', () => {
  const src = "$a = @'\nligne1 $x\n# pas un commentaire\n'@\n$b = 1", t = P.tokenize(src), hs = t.find((x) => x.t === 'hstring');
  assert.strictEqual(hs.s, "@'\nligne1 $x\n# pas un commentaire\n'@"); assert.strictEqual(join(t), src); assert.ok(has('$a = @"\nx\n"@', 'hstring'));
  const un = "$x = @'\nnon fermé\nsuite"; assert.strictEqual(P.tokenize(un).find((x) => x.t === 'hstring').s, un.slice(5));
  ['$x = "non terminé $y', "'abc", '<# jamais fermé'].forEach((s) => assert.strictEqual(join(P.tokenize(s)), s)); assert.ok(has('x\r\n# c\r\ny', 'comment', '# c'));
});

test('toLines / markTokens / findRanges', () => {
  const src = 'Get-Item $a\r\n"x" # y\nz', lines = P.toLines(src, P.tokenize(src));
  assert.strictEqual(lines.length, 3); assert.strictEqual(lines[2].start, src.indexOf('z')); assert.ok(lines.every((l) => l.toks.every((t) => src.substr(t.o, t.s.length) === t.s)));
  const r = P.findRanges(src, 'item'); assert.deepStrictEqual(r, [[4, 8]]); const marked = P.markTokens(lines[0].toks, r); assert.strictEqual(marked.map((t) => t.s).join(''), 'Get-Item $a'); assert.ok(marked.some((t) => t.m));
  assert.deepStrictEqual(P.findRanges(src, ''), []);
});

test('fuzz: entrées aléatoires, jamais d\'exception, texte conservé, terminaison', () => {
  const alphabet = ['$', '"', "'", '`', '@', '#', '<', '>', '\n', '\r', '{', '}', '(', ')', '[', ']', '-', ' ', 'a', 'Z', '1', ';', '|', '=', ':', '.', ',', 'é', '\u0000', '😀', 'if', 'Get-X', '@"', "@'", '<#', '#>', '$(', '-eq', '${'];
  let seed = 12345; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }, t0 = Date.now();
  for (let k = 0; k < 4000; k++) { let s = ''; const len = Math.floor(rnd() * 60); for (let i = 0; i < len; i++) s += alphabet[Math.floor(rnd() * alphabet.length)]; const toks = P.tokenize(s); assert.strictEqual(join(toks), s, JSON.stringify(s)); P.toLines(s, toks); }
  for (const bad of [null, undefined, 42, {}, [], '']) assert.strictEqual(typeof join(P.tokenize(bad)), 'string');
  const big = '"$('.repeat(2000) + '@\'\n'.repeat(500); assert.strictEqual(join(P.tokenize(big)), big); assert.ok(Date.now() - t0 < 20000);
});

test('round-trip + robustesse sur les scripts des fixtures (entiers, tronqués à plusieurs longueurs)', () => {
  const files = H.walk(H.DATA).filter((f) => f.endsWith('.ps1')); assert.ok(files.length >= 3);
  files.forEach((f) => {
    const text = H.decode(fs.readFileSync(f)).replace(/^﻿/, ''), toks = P.tokenize(text); assert.strictEqual(join(toks), text, f);
    for (let cut = 0; cut <= text.length; cut += 7) { const part = text.slice(0, cut); assert.strictEqual(join(P.tokenize(part)), part); }
    assert.ok(P.toLines(text, toks).length >= 1);
  });
  const main = H.decode(fs.readFileSync(H.walk(H.DATA).find((f) => /scripts[\\/].*0101\.ps1$/.test(f)))); const kinds = new Set(P.tokenize(main).map((t) => t.t));
  ['comment', 'string', 'hstring', 'variable', 'keyword', 'cmdlet', 'param', 'op', 'number', 'type', 'attr', 'const'].forEach((k) => assert.ok(kinds.has(k), 'le script de démonstration contient: ' + k));
});

test('palette: contraste WCAG AA (>= 4.5:1) sur le fond du code, thèmes clair et sombre', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'style.css'), 'utf8');
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const light = css.match(/:root \{ --ps-comment[^}]*\}/)[0], dark = css.match(/prefers-color-scheme: dark\) \{ :root \{ --ps-comment[^}]*\}/)[0];
  const grab = (blk) => Object.fromEntries([...blk.matchAll(/--(ps-[\w-]+): (#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  for (const [name, vars, bg] of [['clair', grab(light), '#eef0f4'], ['sombre', grab(dark), '#252a33']]) {
    Object.keys(vars).filter((k) => !/hit/.test(k)).forEach((k) => assert.ok(ratio(vars[k], bg) >= 4.5, name + ' ' + k)); assert.ok(ratio(vars['ps-hit-fg'], vars['ps-hit-bg']) >= 4.5, name + ' surlignage');
  }
});
