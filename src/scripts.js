/* scripts.js - index en mémoire des scripts PowerShell des custom actions, de la liste customaction*.raw.txt et des rapports PS7 CSV (pur, sans DOM).
   Les scripts sont stockés bruts; l'analyse (param(), variables) est faite à la demande et mise en cache. */
(function (root) {
  'use strict';
  var t18 = (typeof require === 'function' ? require('./i18n.js') : root.WFV.i18n).t;
  var GUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  function guidOf(name) { var m = GUID_RE.exec(String(name).split('/').pop()); return m ? m[1].toLowerCase() : null; }

  // -> 'workflow' | 'script' | 'fix' | 'customactions' | 'csv' | null
  function classifyFile(name) {
    var n = String(name), base = n.split('/').pop();
    if (/\.json$/i.test(base)) return 'workflow';
    if (/\.ps1$/i.test(base)) return /(^|\/)proposed-fixes\//i.test(n) ? 'fix' : 'script';
    if (/customaction.*\.raw\.txt$/i.test(base)) return 'customactions';
    if (/\.csv$/i.test(base)) return 'csv';
    return null;
  }

  // Découpe un texte en valeurs JSON de premier niveau consécutives (pages concaténées), sensible aux chaînes.
  function splitJsonValues(text) {
    var out = [], i = 0, n = text.length;
    while (i < n) {
      while (i < n && /[\s,]/.test(text[i])) i++;
      if (i >= n) break;
      var open = text[i]; if (open !== '{' && open !== '[') { i++; continue; }
      var depth = 0, inStr = false, start = i;
      for (; i < n; i++) {
        var c = text[i];
        if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; }
        else if (c === '"') inStr = true;
        else if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') { depth--; if (depth === 0) { i++; break; } }
      }
      out.push(text.slice(start, i));
    }
    return out;
  }

  // Parse tolérant: un objet, un tableau, ou plusieurs pages concaténées. -> {actions:[], errors:[], pages:n}
  function parseCustomActions(text) {
    var res = { actions: [], errors: [], pages: 0 };
    text = String(text || '').replace(/^﻿/, '');
    var chunks = [];
    try { chunks = [JSON.parse(text)]; } catch (e) {
      splitJsonValues(text).forEach(function (c) { try { chunks.push(JSON.parse(c)); } catch (e2) { res.errors.push(t18('scripts.err.chunk', { msg: e2.message.slice(0, 80) })); } });
    }
    chunks.forEach(function (j) {
      var list = Array.isArray(j) ? j : j && Array.isArray(j.customActions) ? j.customActions : j && j.id && j.title ? [j] : null;
      if (!list) { res.errors.push(t18('scripts.err.noList')); return; }
      res.pages++; list.forEach(function (a) { if (a && typeof a === 'object' && a.id) res.actions.push(a); });
    });
    return res;
  }

  // CSV RFC4180 (BOM, guillemets doublés, retours à la ligne dans les champs). -> {header:[], rows:[{col:val}]}
  function parseCsv(text) {
    text = String(text || '').replace(/^﻿/, '');
    var rows = [], row = [], f = '', q = false, i = 0, n = text.length, started = false;
    for (; i < n; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') { q = true; started = true; }
      else if (c === ',') { row.push(f); f = ''; started = true; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; if (started || f) { row.push(f); rows.push(row); } row = []; f = ''; started = false; }
      else { f += c; started = true; }
    }
    if (started || f) { row.push(f); rows.push(row); }
    var header = rows.shift() || [];
    return { header: header, rows: rows.map(function (r) { var o = {}; header.forEach(function (h, k) { o[h] = r[k] === undefined ? '' : r[k]; }); return o; }) };
  }

  function utf8Len(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return s.length; } }

  // Analyse d'un script: lignes, taille, paramètres param(...), variables référencées (comptes, clés en minuscules).
  function analyzeScript(text) {
    var lines = text.split(/\r\n|\r|\n/).length, params = [], hasParam = false;
    var m = /(^|[\s;{])param\s*\(/i.exec(text);
    if (m) {
      hasParam = true; var i = m.index + m[0].length, depth = 1, q = null, start = i, segs = [], d2 = 0;
      for (; i < text.length && depth > 0; i++) {
        var c = text[i];
        if (q) { if (c === q) q = null; continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        if (c === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
        if (c === '(') depth++; else if (c === ')') { depth--; if (depth === 0) break; }
        else if (c === '[') d2++; else if (c === ']') d2--;
        else if (c === ',' && depth === 1 && d2 === 0) { segs.push(text.slice(start, i)); start = i + 1; }
      }
      segs.push(text.slice(start, i));
      segs.forEach(function (s) {
        var clean = s.replace(/#[^\n]*/g, ''), groups = clean.match(/\[[^\]]*\]/g) || [], bare = clean.replace(/\[[^\]]*\]/g, ' ');
        var nm = /\$([A-Za-z_]\w*)/.exec(bare); if (!nm) return;
        var typeG = groups.filter(function (g) { return !/^\[\s*(Parameter|Validate|Alias|Allow|Cmdlet|ArgumentCompleter)/i.test(g); });
        var def = /=\s*([\s\S]+)$/.exec(bare.slice(nm.index + nm[0].length));
        var gj = groups.join(' '), mand = /Mandatory\s*(=\s*\$true)?\s*[,)]/i.test(gj) && !/Mandatory\s*=\s*\$false/i.test(gj);
        params.push({ name: nm[1], type: typeG.length ? typeG[typeG.length - 1].slice(1, -1).trim() : '', mandatory: mand, default: def ? def[1].trim() : null });
      });
    }
    var vars = {}, re = /\$([A-Za-z_]\w*)/g, v;
    while ((v = re.exec(text))) { var k = v[1].toLowerCase(); vars[k] = (vars[k] || 0) + 1; }
    return { lines: lines, bytes: utf8Len(text), hasParam: hasParam, params: params, vars: vars };
  }

  function createStore() {
    var st = { scripts: new Map(), fixes: new Map(), actions: new Map(), ps7: new Map(), errors: [], _lower: new Map(), _an: new Map() };
    st.counts = function () { return { scripts: st.scripts.size, fixes: st.fixes.size, actions: st.actions.size, ps7: st.ps7.size }; };
    st.isEmpty = function () { return !st.scripts.size && !st.actions.size && !st.ps7.size; };
    // items: [{name,text}] déjà classés ou non. Retourne un résumé {scripts, fixes, actions, ps7, errors, ignored}
    st.ingest = function (items) {
      var sum = { scripts: 0, fixes: 0, actions: 0, ps7: 0, errors: [], ignored: 0 };
      items.forEach(function (it) {
        var kind = classifyFile(it.name);
        if (kind === 'script' || kind === 'fix') {
          var g = guidOf(it.name); if (!g) { sum.ignored++; return; }
          (kind === 'script' ? st.scripts : st.fixes).set(g, { name: it.name, text: it.text.replace(/^﻿/, '') });
          st._lower.delete(g); st._an.delete(g); sum[kind === 'script' ? 'scripts' : 'fixes']++;
        } else if (kind === 'customactions') {
          var r = parseCustomActions(it.text);
          r.actions.forEach(function (a) { st.actions.set(String(a.id).toLowerCase(), a); sum.actions++; });
          r.errors.forEach(function (e) { sum.errors.push({ file: it.name, error: e }); });
        } else if (kind === 'csv') {
          var c = parseCsv(it.text);
          if (c.header.indexOf('Status') < 0 || (c.header.indexOf('File') < 0 && c.header.indexOf('ActionId') < 0)) { sum.ignored++; return; }
          c.rows.forEach(function (row) {
            var id = (guidOf(row.ActionId || '') || guidOf(row.File || '')); if (!id) return;
            var prev = st.ps7.get(id) || {}; Object.keys(row).forEach(function (k) { if (row[k] !== '' || prev[k] === undefined) prev[k] = row[k]; }); st.ps7.set(id, prev); sum.ps7++;
          });
        } else sum.ignored++;
      });
      sum.errors.forEach(function (e) { st.errors.push(e); });
      return sum;
    };
    st.script = function (g) { return st.scripts.get(String(g).toLowerCase()) || null; };
    st.action = function (g) { return st.actions.get(String(g).toLowerCase()) || null; };
    st.report = function (g) { return st.ps7.get(String(g).toLowerCase()) || null; };
    st.lower = function (g) { g = String(g).toLowerCase(); var s = st.scripts.get(g); if (!s) return ''; var l = st._lower.get(g); if (l === undefined) { l = s.text.toLowerCase(); st._lower.set(g, l); } return l; };
    st.analysis = function (g) { g = String(g).toLowerCase(); var s = st.scripts.get(g); if (!s) return null; var a = st._an.get(g); if (!a) { a = analyzeScript(s.text); st._an.set(g, a); } return a; };
    return st;
  }

  // Couverture: ids/nodes custom des workflows (Map id->wf) vs store.
  function coverage(store, wfMap) {
    var cnt = {}, nodes = 0;
    wfMap.forEach(function (wf) { wf.all.forEach(function (n) { if (n.type === 'CustomManagementAction') { nodes++; var g = n.typeRef.toLowerCase(); cnt[g] = (cnt[g] || 0) + 1; } }); });
    var ids = Object.keys(cnt), r = { nodes: nodes, ids: ids.length, withScript: 0, withTitle: 0, withReport: 0, nodesWithScript: 0, nodesWithTitle: 0, missingScript: [], missingTitle: [] };
    ids.forEach(function (g) {
      if (store.scripts.has(g)) { r.withScript++; r.nodesWithScript += cnt[g]; } else r.missingScript.push(g);
      if (store.actions.has(g)) { r.withTitle++; r.nodesWithTitle += cnt[g]; } else r.missingTitle.push(g);
      if (store.ps7.has(g)) r.withReport++;
    });
    return r;
  }

  // IDs custom d'un workflow (cache)
  function customIds(wf) {
    if (!wf._customIds) { var s = {}; wf.all.forEach(function (n) { if (n.type === 'CustomManagementAction') s[n.typeRef.toLowerCase()] = 1; }); wf._customIds = Object.keys(s); }
    return wf._customIds;
  }

  // Recherche (insensible à la casse) dans le texte des scripts -> [{id, count}]
  function searchScripts(store, q) {
    q = String(q || '').toLowerCase(); var out = []; if (!q) return out;
    store.scripts.forEach(function (_, g) { var t = store.lower(g), c = 0, i = -1; while ((i = t.indexOf(q, i + 1)) >= 0) c++; if (c) out.push({ id: g, count: c }); });
    return out.sort(function (a, b) { return b.count - a.count; });
  }

  var api = { guidOf: guidOf, classifyFile: classifyFile, splitJsonValues: splitJsonValues, parseCustomActions: parseCustomActions, parseCsv: parseCsv, analyzeScript: analyzeScript, createStore: createStore, coverage: coverage, customIds: customIds, searchScripts: searchScripts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.scripts = api; }
})(typeof self !== 'undefined' ? self : globalThis);
