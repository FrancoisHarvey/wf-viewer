/* edit.js - édition par patchs + export fidèle (pur, sans DOM).
   Principe: le JSON d'origine (wf.root, jamais muté) et son texte brut (wf.rawText) sont conservés. Les opérations travaillent sur un clone
   (session.root). Un workflow non modifié s'exporte à l'identique octet pour octet (texte brut d'origine). Un workflow modifié est re-sérialisé
   dans le style détecté (indentation, EOL, BOM, saut de ligne final) et seuls les champs double-encodés réellement touchés sont ré-encodés,
   dans le style d'espacement de la valeur d'origine.
   AVERTISSEMENT: le format exigé par CoreView à l'import n'est pas vérifié; tout export est à valider par un import test. */
(function (root) {
  'use strict';
  var req = function (n) { return typeof require === 'function' ? require('./' + n + '.js') : root.WFV[n]; };
  var model = req('model'), refs = req('refs'), analysis = req('analysis'), inputsApi = req('inputs'), tt = req('i18n').t;

  var CATALOG_KEYS = ['inputSchema', 'successOutputSchema', 'failureOutputSchema', 'categoryId', 'categoryName', 'categoryIcon', 'categoryItemId', 'categoryItemName', 'categoryItemIcon', 'providerId', 'providerName', 'providerIcon', 'source', 'fragmentId'];
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var isObj = function (v) { return v && typeof v === 'object' && !Array.isArray(v); };

  // ---------- style / sérialisation ----------
  function detectStyle(rawText, rootObj) {
    var bom = rawText.charCodeAt(0) === 0xFEFF, body = bom ? rawText.slice(1) : rawText;
    var eol = body.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
    var trailing = /\r?\n$/.test(body) ? (/\r\n$/.test(body) ? '\r\n' : '\n') : '';
    var core = trailing ? body.slice(0, body.length - trailing.length) : body;
    var cands = [['compact', undefined], ['indent2', 2], ['indent4', 4], ['tab', '\t']];
    for (var i = 0; i < cands.length; i++) {
      var s = JSON.stringify(rootObj, null, cands[i][1]); if (eol === '\r\n') s = s.replace(/\n/g, '\r\n');
      if (s === core) return { name: cands[i][0], indent: cands[i][1], bom: bom, eol: eol, trailing: trailing, exact: true };
    }
    return { name: 'compact', indent: undefined, bom: bom, eol: eol, trailing: trailing, exact: false };
  }
  function serializeWith(style, rootObj) {
    var s = JSON.stringify(rootObj, null, style.indent); if (style.eol === '\r\n') s = s.replace(/\n/g, '\r\n');
    return (style.bom ? '﻿' : '') + s + style.trailing;
  }
  // Ré-encode un champ double-encodé dans le style d'espacement de la chaîne d'origine.
  function encodeLike(orig, obj) {
    if (typeof orig === 'string') {
      try {
        var o = JSON.parse(orig);
        if (JSON.stringify(o) === orig) return JSON.stringify(obj);
        for (var n = 1; n <= 4; n++) if (JSON.stringify(o, null, n) === orig) return JSON.stringify(obj, null, n);
        if (JSON.stringify(o, null, '\t') === orig) return JSON.stringify(obj, null, '\t');
      } catch (e) { /* style inconnu */ }
    }
    return JSON.stringify(obj);
  }

  // ---------- session ----------
  function dataOf(rootObj) { return rootObj && rootObj.data && typeof rootObj.data === 'object' && !Array.isArray(rootObj.data) && (rootObj.data.actions || rootObj.data.id) ? rootObj.data : rootObj; }
  function rebuild(s) {
    var wf = model.buildWorkflow(dataOf(s.root), s.file, s.rawText, s.root);
    wf.session = s; wf.dirty = isDirty(s); s.wf = wf; return wf;
  }
  function createSession(wf) {
    var s = { id: wf.id, file: wf.file, rawText: wf.rawText, base: JSON.stringify(wf.root), root: clone(wf.root), style: detectStyle(wf.rawText, wf.root), undo: [], redo: [], orig: wf, wf: wf };
    return s;
  }
  function isDirty(s) { return JSON.stringify(s.root) !== s.base; }
  // Exécute fn(d, rootCopy) sur un clone; commit si ok et si quelque chose a changé.
  function run(s, label, fn) {
    var before = JSON.stringify(s.root), copy = JSON.parse(before);
    var res = fn(dataOf(copy), copy);
    if (!res || !res.ok) return res || { ok: false, error: tt('edit.err.invalidOp') };
    var after = JSON.stringify(copy);
    if (after === before) { res.noop = true; return res; }
    s.undo.push({ snap: before, label: label }); if (s.undo.length > 200) s.undo.shift(); s.redo = [];
    s.root = copy; rebuild(s); res.label = label; return res;
  }
  function undo(s) { var e = s.undo.pop(); if (!e) return false; s.redo.push({ snap: JSON.stringify(s.root), label: e.label }); s.root = JSON.parse(e.snap); rebuild(s); return true; }
  function redo(s) { var e = s.redo.pop(); if (!e) return false; s.undo.push({ snap: JSON.stringify(s.root), label: e.label }); s.root = JSON.parse(e.snap); rebuild(s); return true; }
  // Essai à blanc: résultat + validation avant/après, sans toucher à la session.
  function trial(s, fn) {
    var copy = clone(s.root), d0 = dataOf(clone(s.root)), res = fn(dataOf(copy), copy);
    var before = validate(d0), after = res && res.ok ? validate(dataOf(copy)) : null;
    var keys = {}; before.broken.forEach(function (b) { keys[b.key] = 1; });
    return { res: res, before: before, after: after, newBroken: after ? after.broken.filter(function (b) { return !keys[b.key]; }) : [], data: copy };
  }
  // Texte à exporter. Non modifié => texte brut d'origine (octet pour octet).
  function exportText(s, opts) {
    opts = opts || {};
    if (!isDirty(s)) return s.rawText;
    var r = s.root;
    if (opts.touchVolatile) {
      r = clone(r); var d = dataOf(r), now = opts.now || new Date();
      if (typeof d.updatedAt === 'number') d.updatedAt = Math.floor(now.getTime() / 1000);
      if (typeof d.updatedDate === 'string') d.updatedDate = now.toISOString().replace(/\.\d+Z$/, 'Z');
    }
    return serializeWith(s.style, r);
  }

  // ---------- accès noeuds ----------
  function findNode(d, uid) {
    function rec(arr, container, owner) {
      for (var i = 0; i < arr.length; i++) {
        var n = arr[i]; if (n.uid === uid) return { node: n, arr: arr, idx: i, container: container, owner: owner };
        var b = ['trueBranch', 'falseBranch'];
        for (var k = 0; k < 2; k++) { var r = rec(n[b[k]] || [], b[k], n); if (r) return r; }
      }
      return null;
    }
    return rec(d.actions || [], 'actions', null) || rec(d.catchActions || [], 'catchActions', null);
  }
  function forEachNode(d, cb) {
    (function rec(arr, container) { arr.forEach(function (n) { cb(n, arr, container); rec(n.trueBranch || [], 'trueBranch'); rec(n.falseBranch || [], 'falseBranch'); }); })(d.actions || [], 'actions');
    (function rec(arr, container) { arr.forEach(function (n) { cb(n, arr, container); rec(n.trueBranch || [], 'trueBranch'); rec(n.falseBranch || [], 'falseBranch'); }); })(d.catchActions || [], 'catchActions');
  }
  function parseSettings(n) { if (typeof n.settings !== 'string') return null; try { var o = JSON.parse(n.settings); return isObj(o) ? o : null; } catch (e) { return null; } }
  function pathStr(p) { return p.reduce(function (a, k) { return typeof k === 'number' ? a + '[' + k + ']' : a ? a + '.' + k : k; }, ''); }
  function canParse(s) { try { JSON.parse(s); return true; } catch (e) { return false; } }
  function looksJson(s) { var t = s.trim(); return t.length > 1 && ((t[0] === '{' && t[t.length - 1] === '}') || (t[0] === '[' && t[t.length - 1] === ']')) && canParse(t); }
  function malformedCount(v) { var c = 0; refs.walkStrings(v, '', function (s) { refs.extractTokens(s).forEach(function (t) { if (t.malformed) c++; }); }); return c; }

  // ---------- (a) champs du workflow ----------
  function setWorkflowField(d, key, value) {
    if (['workflowName', 'description', 'status'].indexOf(key) < 0) return { ok: false, error: tt('edit.err.fieldNotEditable', { f: key }) };
    if (typeof value !== 'string') return { ok: false, error: tt('edit.err.stringExpected') };
    if (key === 'workflowName' && !value.trim()) return { ok: false, error: tt('edit.err.nameEmpty') };
    if (key === 'status' && ['Active', 'Inactive'].indexOf(value) < 0) return { ok: false, error: tt('edit.err.statusExpected') };
    d[key] = value; return { ok: true, warnings: [] };
  }
  function setNodeField(d, uid, key, value) {
    var f = findNode(d, uid); if (!f) return { ok: false, error: tt('edit.err.nodeNotFoundUid', { uid: uid }) };
    if (['name', 'customDescription', 'forceSkip'].indexOf(key) < 0) return { ok: false, error: tt('edit.err.fieldNotEditable', { f: key }) };
    if (key === 'forceSkip' && typeof value !== 'boolean') return { ok: false, error: tt('edit.err.boolExpected') };
    f.node[key] = value; return { ok: true, warnings: [] };
  }

  // ---------- (b) valeur de setting ----------
  function setSetting(d, uid, path, value) {
    var f = findNode(d, uid); if (!f) return { ok: false, error: tt('edit.err.nodeNotFoundUid', { uid: uid }) };
    var s = parseSettings(f.node); if (!s) return { ok: false, error: tt('edit.err.settingsInvalid') };
    if (!path || !path.length) return { ok: false, error: tt('edit.err.pathEmpty') };
    var cur = s;
    for (var i = 0; i < path.length - 1; i++) { cur = cur[path[i]]; if (cur === undefined || cur === null || typeof cur !== 'object') return { ok: false, error: tt('edit.err.pathMissing', { p: pathStr(path) }) }; }
    var last = path[path.length - 1], old = cur[last], warnings = [];
    if (typeof value === 'string' && malformedCount(value) > (typeof old === 'string' ? malformedCount(old) : 0)) return { ok: false, error: tt('edit.err.newBraces') };
    if (typeof old === 'string' && looksJson(old) && typeof value === 'string' && !canParse(value)) return { ok: false, error: tt('edit.err.jsonLost') };
    if (old !== undefined && old !== null && value !== null && typeof old !== typeof value) warnings.push(tt('edit.warn.typeChanged', { from: typeof old, to: typeof value }));
    refs.walkStrings(value, '', function (str) { refs.extractTokens(str).forEach(function (t) { if (t.kind === 'action' && !t.malformed && !findNode(d, t.uid)) warnings.push(tt('edit.warn.unknownUid', { uid: t.uid })); }); });
    cur[last] = value; f.node.settings = encodeLike(f.node.settings, s);
    return { ok: true, warnings: warnings };
  }

  // ---------- traitement générique des chaînes (rechercher/remplacer, fonctions, renommage) ----------
  function mapStrings(v, path, tf, out) {
    if (typeof v === 'string') { var nv = tf(v, path); if (nv !== v) out.push({ path: path, before: v, after: nv }); return nv; }
    if (Array.isArray(v)) return v.map(function (x, i) { return mapStrings(x, path.concat(i), tf, out); });
    if (isObj(v)) { var o = {}; Object.keys(v).forEach(function (k) { o[k] = mapStrings(v[k], path.concat(k), tf, out); }); return o; }
    return v;
  }
  // scopes: {settings, filters, names, targets, wfFilter}. Mute d. Retourne {changes, warnings}.
  function mapLeaves(d, tf0, scopes) {
    var changes = [], warnings = [];
    var tf = function (str, p) { var nv = tf0(str, p); if (nv !== str && looksJson(str) && !canParse(nv)) { warnings.push(tt('edit.warn.jsonInvalidated', { p: pathStr(p) })); return str; } return nv; };
    function note(uid, name, where, list) { list.forEach(function (c) { changes.push({ uid: uid, nodeName: name, where: where + (c.path.length ? (where ? '.' : '') + pathStr(c.path) : ''), before: c.before, after: c.after }); }); }
    forEachNode(d, function (n) {
      if (scopes.settings) { var s = parseSettings(n); if (s) { var out = []; var ns = mapStrings(s, [], tf, out); if (out.length) { n.settings = encodeLike(n.settings, ns); note(n.uid, n.name, 'settings', out); } } }
      if (scopes.filters && n.filter && typeof n.filter === 'object') { var o2 = []; var nf = mapStrings(n.filter, [], tf, o2); if (o2.length) { n.filter = nf; note(n.uid, n.name, 'filter', o2); } }
      if (scopes.names) ['name', 'customDescription'].forEach(function (k) { if (typeof n[k] === 'string') { var o3 = []; var nv = mapStrings(n[k], [], tf, o3); if (o3.length) { n[k] = nv; note(n.uid, n.name, k, o3); } } });
    });
    if (scopes.wfFilter && d.filter && typeof d.filter === 'object') { var o4 = []; var wf = mapStrings(d.filter, [], tf, o4); if (o4.length) { d.filter = wf; note(null, tt('edit.wfLabel'), 'filter', o4); } }
    if (scopes.targets && d.targetsConfig && Array.isArray(d.targetsConfig.targets)) d.targetsConfig.targets = d.targetsConfig.targets.map(function (t, i) {
      var p; try { p = JSON.parse(t); } catch (e) { return t; } var o5 = []; var np = mapStrings(p, [], tf, o5); if (!o5.length) return t; note(null, tt('edit.wfLabel'), 'targetsConfig.targets[' + i + ']', o5); return encodeLike(t, np);
    });
    return { changes: changes, warnings: warnings };
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // (c) rechercher/remplacer. opts: {find, replace, regex, caseSensitive, settings, filters, names, wfFilter, targets}
  function findReplace(d, opts) {
    if (!opts || !opts.find) return { ok: false, error: tt('edit.err.findEmpty') };
    var re; try { re = new RegExp(opts.regex ? opts.find : escapeRe(opts.find), 'g' + (opts.caseSensitive ? '' : 'i')); } catch (e) { return { ok: false, error: tt('edit.err.badRegex', { msg: e.message }) }; }
    var rep = opts.replace == null ? '' : String(opts.replace);
    var tf = function (str) { return str.replace(re, opts.regex ? rep : function () { return rep; }); };
    var scopes = { settings: opts.settings !== false, filters: opts.filters !== false, names: !!opts.names, wfFilter: opts.wfFilter !== false, targets: opts.targets !== false };
    var r = mapLeaves(d, tf, scopes);
    var mal = malformedCount(r.changes.map(function (c) { return c.after; })), mal0 = malformedCount(r.changes.map(function (c) { return c.before; }));
    if (mal > mal0) return { ok: false, error: tt('edit.err.replaceBraces'), changes: r.changes };
    return { ok: true, changes: r.changes, warnings: r.warnings };
  }
  // (d) fonction de token: {{input::..::label::removeSpaces(a,b)}} -> to(args)
  function replaceFunction(d, opts) {
    if (!opts || !/^\w+$/.test(opts.from || '') || !/^\w+$/.test(opts.to || '')) return { ok: false, error: tt('edit.err.fnNames') };
    var tf = function (str) {
      return str.indexOf('{{') < 0 ? str : str.replace(/\{\{([^{}]*)\}\}/g, function (all, inner) {
        var p = inner.split('::'), ch = false;
        for (var i = 3; i < p.length; i++) { var m = /^(\w+)\((.*)\)$/.exec(p[i]); if (m && m[1] === opts.from) { p[i] = opts.to + '(' + (opts.args != null ? opts.args : m[2]) + ')'; ch = true; } }
        return ch ? '{{' + p.join('::') + '}}' : all;
      });
    };
    var r = mapLeaves(d, tf, { settings: true, filters: true, wfFilter: true, targets: true });
    return { ok: true, changes: r.changes, warnings: r.warnings };
  }
  // (e) renommer un input partout
  function renameInput(d, oldName, newName) {
    var s; try { s = JSON.parse(d.inputSchema); } catch (e) { return { ok: false, error: tt('edit.err.schemaUnreadable') }; }
    if (!s || !s.properties || !Object.prototype.hasOwnProperty.call(s.properties, oldName)) return { ok: false, error: tt('edit.err.inputMissing', { name: oldName }) };
    if (!newName || newName === oldName) return { ok: false, error: tt('edit.err.newNameInvalid') };
    if (Object.prototype.hasOwnProperty.call(s.properties, newName)) return { ok: false, error: tt('edit.err.inputExists', { name: newName }) };
    var warnings = [];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) warnings.push(tt('edit.warn.namePattern'));
    var np = {}; Object.keys(s.properties).forEach(function (k) { var p = s.properties[k]; if (k === oldName) { np[newName] = isObj(p) && p.title === oldName ? Object.assign({}, p, { title: newName }) : p; } else np[k] = p; });
    s.properties = np; if (Array.isArray(s.required)) s.required = s.required.map(function (k) { return k === oldName ? newName : k; });
    d.inputSchema = encodeLike(d.inputSchema, s);
    var tf = function (str) {
      return str.indexOf('{{') < 0 ? str : str.replace(/\{\{([^{}]*)\}\}/g, function (all, inner) {
        var p = inner.split('::'); if (p[0] !== 'input' || p[1] !== 'input-stepUid' || p[2] !== oldName) return all;
        p[2] = newName; if (p[3] === oldName) p[3] = newName; return '{{' + p.join('::') + '}}';
      });
    };
    var r = mapLeaves(d, tf, { settings: true, filters: true, wfFilter: true, targets: true });
    return { ok: true, changes: r.changes, warnings: warnings.concat(r.warnings) };
  }

  // ---------- (d) remplacer le type d'une action ----------
  function dependentsOf(d, uids) {
    var set = {}; uids.forEach(function (u) { set[u] = 1; });
    var wf = model.buildWorkflow(d, 'x', '', null), out = [];
    model.allTokens(wf).forEach(function (o) { if (o.token.kind === 'action' && set[o.token.uid] && !(o.node && set[o.node.uid])) out.push({ node: o.node, uid: o.node ? o.node.uid : null, nodeName: o.node ? o.node.name : tt('edit.wfLabel'), where: o.where, token: o.token.raw, target: o.token.uid, path: o.token.path }); });
    return out;
  }
  // opts: {newId, mapping:{oldKey:newKey|null}, template: raw node example of the target type (optional), name}
  function replaceNodeType(d, uid, opts) {
    var f = findNode(d, uid); if (!f) return { ok: false, error: tt('edit.err.nodeNotFound') };
    var n = f.node, warnings = [];
    if (!opts || !opts.newId) return { ok: false, error: tt('edit.err.targetTypeMissing') };
    if (String(n.id).indexOf('item::') === 0 || String(opts.newId).indexOf('item::') === 0) return { ok: false, error: tt('edit.err.controlReplace') };
    var s = parseSettings(n); if (!s) return { ok: false, error: tt('edit.err.settingsUnreadable') };
    var tpl = opts.template && parseSettings(opts.template), tplKeys = tpl ? Object.keys(tpl) : null;
    var map = opts.mapping || {}, ns = {}, dropped = [], unknownTarget = [];
    Object.keys(s).forEach(function (k) {
      var t = Object.prototype.hasOwnProperty.call(map, k) ? map[k] : k;
      if (t === null || t === '') { dropped.push(k); return; }
      if (Object.prototype.hasOwnProperty.call(ns, t)) { warnings.push(tt('edit.warn.dupMapped', { key: t })); }
      ns[t] = s[k]; if (tplKeys && tplKeys.indexOf(t) < 0) unknownTarget.push(t);
    });
    if (dropped.length) warnings.push(tt('edit.warn.unmapped', { keys: dropped.join(', ') }));
    if (unknownTarget.length) warnings.push(tt('edit.warn.notInTemplate', { keys: unknownTarget.join(', ') }));
    var deps = dependentsOf(d, [uid]).filter(function (x) { return x.path; });
    if (deps.length) warnings.push(tt('edit.warn.outputRefs', { n: deps.length, uid: uid.slice(0, 8), paths: Array.from(new Set(deps.map(function (x) { return x.path; }))).slice(0, 6).join(', ') }));
    n.id = opts.newId; n.settings = encodeLike(n.settings, ns);
    if (opts.template) CATALOG_KEYS.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(opts.template, k)) n[k] = clone(opts.template[k]); });
    else warnings.push(tt('edit.warn.noTemplate'));
    if (opts.name != null) n.name = opts.name;
    return { ok: true, warnings: warnings, dropped: dropped };
  }

  // ---------- (f) opérations sur les nodes ----------
  function defaultUuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  // indices (dans arr) du node idx et de tous ses descendants à plat (parentUid)
  function blockIndices(arr, idx) {
    var uids = {}; uids[arr[idx].uid] = 1; var out = [idx], changed = true;
    while (changed) { changed = false; for (var i = 0; i < arr.length; i++) { if (out.indexOf(i) < 0 && arr[i].parentUid && uids[arr[i].parentUid]) { uids[arr[i].uid] = 1; out.push(i); changed = true; } } }
    return out.sort(function (a, b) { return a - b; });
  }
  function allUidsIn(node, acc) { acc = acc || []; acc.push(node.uid); ['trueBranch', 'falseBranch'].forEach(function (b) { (node[b] || []).forEach(function (c) { allUidsIn(c, acc); }); }); return acc; }

  function deleteNode(d, uid) {
    var f = findNode(d, uid); if (!f) return { ok: false, error: tt('edit.err.nodeNotFound') };
    var idxs = blockIndices(f.arr, f.idx), removed = idxs.map(function (i) { return f.arr[i]; }), gone = [];
    removed.forEach(function (r) { allUidsIn(r, gone); });
    for (var k = idxs.length - 1; k >= 0; k--) f.arr.splice(idxs[k], 1);
    var deps = dependentsOf(d, gone), warnings = [];
    if (deps.length) warnings.push(tt('edit.warn.deletedRefs', { n: deps.length }));
    return { ok: true, warnings: warnings, removed: gone.length, dependents: deps };
  }

  function replaceUidText(node, mapping) {
    function sub(str) { if (typeof str !== 'string' || str.indexOf('{{') < 0) return str; Object.keys(mapping).forEach(function (o) { str = str.split('::' + o + '::').join('::' + mapping[o] + '::'); }); return str; }
    (function rec(n) {
      if (typeof n.settings === 'string') n.settings = sub(n.settings);
      if (n.filter) n.filter = mapStrings(n.filter, [], sub, []);
      ['trueBranch', 'falseBranch'].forEach(function (b) { (n[b] || []).forEach(rec); });
    })(node);
  }
  function duplicateNode(d, uid, opts) {
    opts = opts || {}; var gen = opts.uuid || defaultUuid;
    var f = findNode(d, uid); if (!f) return { ok: false, error: tt('edit.err.nodeNotFound') };
    var idxs = blockIndices(f.arr, f.idx), mapping = {};
    var copies = idxs.map(function (i) { return clone(f.arr[i]); });
    copies.forEach(function (c) { allUidsIn(c, []).forEach(function (u) { if (!mapping[u]) mapping[u] = gen(); }); });
    (function renew(list) { list.forEach(function (n) { n.uid = mapping[n.uid]; if (n.parentUid && mapping[n.parentUid]) n.parentUid = mapping[n.parentUid]; renew(n.trueBranch || []); renew(n.falseBranch || []); }); })(copies);
    copies.forEach(function (c) { replaceUidText(c, mapping); });
    if (opts.suffix !== false) copies[0].name = (copies[0].name || '') + (opts.suffix || ' (copie)');
    f.arr.splice.apply(f.arr, [idxs[idxs.length - 1] + 1, 0].concat(copies));
    return { ok: true, newUid: copies[0].uid, uidMap: mapping, warnings: [] };
  }

  function removeBlock(arr, idx) { var idxs = blockIndices(arr, idx), blk = idxs.map(function (i) { return arr[i]; }); for (var k = idxs.length - 1; k >= 0; k--) arr.splice(idxs[k], 1); return blk; }
  function siblingsOf(arr, node) { return arr.filter(function (x) { return (x.parentUid || null) === (node.parentUid || null); }); }
  function moveNode(d, uid, dir) {
    var f = findNode(d, uid); if (!f) return { ok: false, error: tt('edit.err.nodeNotFound') };
    var sib = siblingsOf(f.arr, f.node), i = sib.indexOf(f.node), nb = sib[i + (dir === 'up' ? -1 : 1)];
    if (!nb) return { ok: false, error: dir === 'up' ? tt('edit.err.alreadyFirst') : tt('edit.err.alreadyLast') };
    var blk = removeBlock(f.arr, f.idx), at = f.arr.indexOf(nb);
    if (dir === 'down') { var nbIdx = blockIndices(f.arr, at); at = nbIdx[nbIdx.length - 1] + 1; }
    f.arr.splice.apply(f.arr, [at, 0].concat(blk));
    return { ok: true, warnings: [] };
  }
  // dest: {top:'actions'|'catchActions'} | {branch:'trueBranch'|'falseBranch', of: uid} | {childOf: uid (séquence)}
  function moveTo(d, uid, dest) {
    var f = findNode(d, uid); if (!f) return { ok: false, error: tt('edit.err.nodeNotFound') };
    var blkIdx = blockIndices(f.arr, f.idx), subtree = {}; blkIdx.forEach(function (i) { allUidsIn(f.arr[i], []).forEach(function (u) { subtree[u] = 1; }); });
    var target = null, parentUid = null, at = null;
    if (dest.top) target = { arr: dest.top === 'catchActions' ? (d.catchActions = d.catchActions || []) : d.actions };
    else if (dest.branch) { var o = findNode(d, dest.of); if (!o || o.node.id !== 'item::if-else') return { ok: false, error: tt('edit.err.destIf') }; target = { arr: (o.node[dest.branch] = o.node[dest.branch] || []) }; }
    else if (dest.childOf) {
      var sq = findNode(d, dest.childOf); if (!sq || sq.node.id !== 'item::sequence') return { ok: false, error: tt('edit.err.destSeq') };
      if (f.node.id === 'item::sequence') return { ok: false, error: tt('edit.err.seqInSeq') };
      target = { arr: sq.arr }; parentUid = sq.node.uid; at = 'seq';
    } else return { ok: false, error: tt('edit.err.destInvalid') };
    if (subtree[dest.of] || subtree[dest.childOf]) return { ok: false, error: tt('edit.err.moveSelf') };
    var blk = removeBlock(f.arr, f.idx);
    blk[0].parentUid = parentUid;
    if (at === 'seq') { var si = target.arr.findIndex(function (x) { return x.uid === parentUid; }); var bi = blockIndices(target.arr, si); target.arr.splice.apply(target.arr, [bi[bi.length - 1] + 1, 0].concat(blk)); }
    else target.arr.push.apply(target.arr, blk);
    return { ok: true, warnings: [] };
  }

  // ---------- validation ----------
  function validate(d) {
    var errors = [], warnings = [], wf = model.buildWorkflow(d, 'x', '', null), seen = {};
    wf.all.forEach(function (n) {
      if (!n.uid) errors.push(tt('edit.err.noUid', { path: n.path })); else if (seen[n.uid]) errors.push(tt('edit.err.dupUid', { uid: n.uid, path: n.path })); seen[n.uid] = 1;
      var pu = n.raw.parentUid;
      if (pu) { if (!n.parent || n.parent.uid !== pu) errors.push(tt('edit.err.parentMissing', { pu: pu, path: n.path })); else if (n.parent.id !== 'item::sequence') errors.push(tt('edit.err.parentNotSeq', { path: n.path })); }
      if (n.id === 'item::if-else' && (!Array.isArray(n.raw.trueBranch) || !Array.isArray(n.raw.falseBranch))) errors.push(tt('edit.err.ifElseBranches', { path: n.path }));
      if (n.id === 'item::sequence' && n.parent && n.parent.id === 'item::sequence') warnings.push(tt('edit.warn.nestedSeq', { path: n.path }));
      if (typeof n.raw.settings === 'string' && !parseSettings(n.raw)) errors.push(tt('edit.err.settingsAt', { path: n.path }));
    });
    var a = analysis.analyzeWorkflow(wf, new Map([[wf.id, wf]]));
    var broken = a.broken.map(function (b) { return { key: (b.node ? b.node.uid : 'wf') + '|' + b.token.raw + '|' + b.reason.replace(/\(.*\)/, ''), reason: b.reason, node: b.node ? b.node.name : tt('edit.wfLabel'), uid: b.node ? b.node.uid : null, where: b.where, token: b.token.raw }; });
    a.malformed.forEach(function (m) { warnings.push(tt('edit.warn.badToken', { token: m.token.raw })); });
    try { JSON.parse(JSON.stringify(d)); } catch (e) { errors.push(tt('edit.err.notSerializable')); }
    validateInputs(d, errors, warnings);
    return { errors: errors, warnings: warnings, broken: broken, nodeCount: wf.nodeCount };
  }


  // ---------- éditeur d'inputs (inputSchema.properties) ----------
  // Toutes les opérations ré-encodent inputSchema (double-encodé) UNIQUEMENT s'il change, dans le style d'espacement d'origine; ordre des clés et clés inconnues conservés.
  function schemaOf(d) {
    if (typeof d.inputSchema !== 'string') return { error: tt('edit.err.schemaMissing') };
    var s; try { s = JSON.parse(d.inputSchema); } catch (e) { return { error: tt('edit.err.schemaInvalid') }; }
    if (!isObj(s)) return { error: tt('edit.err.schemaUnexpected') };
    if (s.properties === undefined) s.properties = {}; if (!isObj(s.properties)) return { error: tt('edit.err.schemaPropsUnexpected') };
    return { s: s };
  }
  function saveSchema(d, s) { d.inputSchema = encodeLike(d.inputSchema, s); }
  function reorder(props, names) { var o = {}; names.forEach(function (k) { o[k] = props[k]; }); return o; }
  function countInputRefs(d, name) {
    var wf = model.buildWorkflow(d, 'x', '', null), c = 0;
    model.allTokens(wf).forEach(function (o) { var t = o.token; if (t.kind === 'input' && !t.malformed && t.stepUid === 'input-stepUid' && t.param === name) c++; });
    return c;
  }
  function withInput(d, name, fn) {
    var r = schemaOf(d); if (r.error) return { ok: false, error: r.error };
    if (!Object.prototype.hasOwnProperty.call(r.s.properties, name)) return { ok: false, error: tt('edit.err.inputMissing', { name: name }) };
    var res = fn(r.s, r.s.properties[name]); if (!res || !res.ok) return res || { ok: false, error: tt('edit.err.invalidOp') };
    saveSchema(d, r.s); return res;
  }
  function setRequired(s, name, on) {
    var req = Array.isArray(s.required) ? s.required.slice() : [], i = req.indexOf(name);
    if (on && i < 0) req.push(name); if (!on && i >= 0) req.splice(i, 1);
    if (Array.isArray(s.required) || req.length || on) s.required = req;
  }
  // opts: {name, kind, targetType, required, title, description, after, values, customList, dataSource, filterable}
  function addInput(d, o) {
    var r = schemaOf(d); if (r.error) return { ok: false, error: r.error }; o = o || {};
    var v = inputsApi.validateName(o.name, r.s.properties, null); if (v.error) return { ok: false, error: v.error };
    var np = inputsApi.newProp(o.kind || 'text', { title: o.title != null ? o.title : o.name, description: o.description, targetType: o.targetType, values: o.values, customList: o.customList, dataSource: o.dataSource, filterable: o.filterable });
    if (np.error) return { ok: false, error: np.error };
    var names = Object.keys(r.s.properties), at = o.after && names.indexOf(o.after) >= 0 ? names.indexOf(o.after) + 1 : names.length, props = Object.assign({}, r.s.properties); props[o.name] = np.prop;
    names.splice(at, 0, o.name); r.s.properties = reorder(props, names); if (o.required) setRequired(r.s, o.name, true); saveSchema(d, r.s);
    var w = v.warning ? [v.warning] : []; if (np.needs) w.push(tt('edit.warn.toComplete', { what: tt('edit.needs.' + np.needs) }));
    return { ok: true, warnings: w, needs: np.needs };
  }
  function deleteInput(d, name) {
    return withInput(d, name, function (s) {
      var refsN = countInputRefs(d, name), props = Object.assign({}, s.properties); delete props[name]; s.properties = props; setRequired(s, name, false);
      return { ok: true, warnings: refsN ? [tt('edit.warn.inputRefs', { n: refsN, name: name })] : [], references: refsN };
    });
  }
  function duplicateInput(d, name, newName) {
    return withInput(d, name, function (s, prop) {
      var nn = newName; if (!nn) { nn = name + tt('edit.copySuffix'); for (var i = 2; Object.keys(s.properties).some(function (k) { return k.toLowerCase() === nn.toLowerCase(); }); i++) nn = name + tt('edit.copySuffix') + i; }
      var v = inputsApi.validateName(nn, s.properties, null); if (v.error) return { ok: false, error: v.error };
      var cp = JSON.parse(JSON.stringify(prop)); if (cp.title === name) cp.title = nn;
      var names = Object.keys(s.properties), props = Object.assign({}, s.properties); props[nn] = cp; names.splice(names.indexOf(name) + 1, 0, nn); s.properties = reorder(props, names);
      if (Array.isArray(s.required) && s.required.indexOf(name) >= 0) setRequired(s, nn, true);
      return { ok: true, newName: nn, warnings: v.warning ? [v.warning] : [] };
    });
  }
  // spec: {dir:'up'|'down'} ou {to: index}
  function moveInput(d, name, spec) {
    return withInput(d, name, function (s) {
      var names = Object.keys(s.properties), i = names.indexOf(name), j = spec && spec.to != null ? spec.to : (spec && spec.dir === 'up' ? i - 1 : i + 1);
      if (j < 0 || j >= names.length) return { ok: false, error: spec && spec.dir === 'up' ? tt('edit.err.alreadyFirst') : tt('edit.err.alreadyLast') };
      names.splice(i, 1); names.splice(j, 0, name); s.properties = reorder(s.properties, names); return { ok: true, warnings: [] };
    });
  }
  // patch: {title, inputDescription, tooltip, required, default} (default/tooltip: undefined ou '' = supprimer la clé)
  function updateInput(d, name, patch) {
    return withInput(d, name, function (s, prop) {
      var np = Object.assign({}, prop), w = [];
      function put(key, val, after) {
        if (Object.prototype.hasOwnProperty.call(np, key)) { np[key] = val; return; }
        var out = {}, placed = false; Object.keys(np).forEach(function (k) { out[k] = np[k]; if (k === after) { out[key] = val; placed = true; } }); if (!placed) out[key] = val; np = out;
      }
      if (patch.title !== undefined) { if (typeof patch.title !== 'string') return { ok: false, error: tt('edit.err.titleString') }; put('title', patch.title, 'type'); }
      if (patch.inputDescription !== undefined) { if (typeof patch.inputDescription !== 'string') return { ok: false, error: tt('edit.err.descString') }; put('inputDescription', patch.inputDescription, 'title'); }
      if (Object.prototype.hasOwnProperty.call(patch, 'tooltip')) {
        if (patch.tooltip === undefined || patch.tooltip === '') delete np['x-cv-tooltip']; else { put('x-cv-tooltip', String(patch.tooltip), 'x-cv-password'); if (!np['x-cv-password']) w.push(tt('edit.warn.tooltip')); }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'default')) {
        if (patch.default === undefined) delete np.default; else { np.default = patch.default; w.push(tt('edit.warn.default')); }
      }
      s.properties[name] = np; if (patch.required !== undefined) setRequired(s, name, !!patch.required);
      return { ok: true, warnings: w };
    });
  }
  // kind: catégorie (inputs.SELECTABLE); opts: {targetType, values, customList, dataSource, filterable}
  function setInputKind(d, name, kind, opts) {
    return withInput(d, name, function (s, prop) {
      var c = inputsApi.convertProp(prop, kind, opts || {}); if (c.error) return { ok: false, error: c.error };
      s.properties[name] = c.prop; var w = c.lost.slice(); if (!c.certain) w.push(inputsApi.UNCERTAIN_NOTES[kind]); if (c.needs) w.push(tt('edit.warn.toComplete', { what: tt('edit.needs.' + c.needs) }));
      return { ok: true, warnings: w, lost: c.lost, needs: c.needs };
    });
  }
  function setInputEnum(d, name, values) {
    return withInput(d, name, function (s, prop) {
      if (!Array.isArray(values) || values.some(function (v) { return typeof v !== 'string'; })) return { ok: false, error: tt('edit.err.stringListExpected') };
      var w = [], dups = inputsApi.duplicatesOf(values); if (dups.length) w.push(tt('edit.warn.dupValues', { v: dups.slice(0, 5).join(', ') })); if (values.some(function (v) { return v === ''; })) return { ok: false, error: tt('edit.err.valueEmpty') };
      if (!values.length) w.push(tt('edit.warn.emptyList'));
      var np = Object.assign({}, prop); if (!Array.isArray(np.enum) && !Object.prototype.hasOwnProperty.call(np, 'enum')) { var out = {}; Object.keys(np).forEach(function (k) { out[k] = np[k]; if (k === 'inputTargetType') out.enum = values.slice(); }); if (!out.enum) out.enum = values.slice(); np = out; } else np.enum = values.slice();
      s.properties[name] = np; return { ok: true, warnings: w };
    });
  }
  // src: {dataSource, customList, filterable}
  function setInputSource(d, name, src) {
    return withInput(d, name, function (s, prop) {
      var np = Object.assign({}, prop);
      if (src.customList !== undefined) { if (!Object.prototype.hasOwnProperty.call(np, 'x-cv-custom-list')) return { ok: false, error: tt('edit.err.notCustomList') }; np['x-cv-custom-list'] = String(src.customList); }
      if (src.dataSource !== undefined) { if (!Object.prototype.hasOwnProperty.call(np, 'x-cv-data-source')) return { ok: false, error: tt('edit.err.notDataSource') }; np['x-cv-data-source'] = String(src.dataSource); }
      if (src.filterable !== undefined) np['x-cv-data-source-filterable'] = !!src.filterable;
      s.properties[name] = np; return { ok: true, warnings: [] };
    });
  }
  function setPasswordRules(d, name, rules) {
    return withInput(d, name, function (s, prop) {
      if (!prop['x-cv-password']) return { ok: false, error: tt('edit.err.notPassword') }; if (!isObj(rules)) return { ok: false, error: tt('edit.err.rulesObject') };
      var np = Object.assign({}, prop), had = Object.prototype.hasOwnProperty.call(np, 'passwordRules'); np.passwordRules = rules; s.properties[name] = np;
      return { ok: true, warnings: had ? [] : [tt('edit.warn.noRules')] };
    });
  }
  // Expert: remplace la propriété par un objet JSON validé (le nom ne change pas)
  function setInputProp(d, name, obj) {
    return withInput(d, name, function (s) {
      if (!isObj(obj)) return { ok: false, error: tt('edit.err.jsonObject') }; if (typeof obj.type !== 'string' && !Array.isArray(obj.type)) return { ok: false, error: tt('edit.err.typeRequired') };
      if (Object.prototype.hasOwnProperty.call(obj, 'enum') && !Array.isArray(obj.enum)) return { ok: false, error: tt('edit.err.enumArray') };
      s.properties[name] = obj; return { ok: true, warnings: [] };
    });
  }
  // items: [{name, prop, required}] ; mode: 'skip' | 'rename' | 'overwrite'. Retourne le détail par input.
  function copyInputs(d, items, mode) {
    var r = schemaOf(d); if (r.error) return { ok: false, error: r.error }; var report = [], props = Object.assign({}, r.s.properties), names = Object.keys(props);
    items.forEach(function (it) {
      var target = it.name, exists = names.some(function (k) { return k.toLowerCase() === target.toLowerCase(); });
      if (exists) {
        if (mode === 'skip') { report.push({ name: it.name, action: tt('edit.copy.skipped') }); return; }
        if (mode === 'overwrite') { var k = names.find(function (x) { return x.toLowerCase() === target.toLowerCase(); }); props[k] = JSON.parse(JSON.stringify(it.prop)); setRequired(r.s, k, !!it.required); report.push({ name: it.name, action: tt('edit.copy.overwritten') }); return; }
        var i = 2; while (names.some(function (x) { return x.toLowerCase() === (it.name + '_' + i).toLowerCase(); })) i++; target = it.name + '_' + i;
      }
      props[target] = JSON.parse(JSON.stringify(it.prop)); names.push(target); setRequired(r.s, target, !!it.required); report.push({ name: it.name, action: target === it.name ? tt('edit.copy.added') : tt('edit.copy.addedAs', { name: target }) });
    });
    r.s.properties = reorder(props, names.filter(function (k) { return Object.prototype.hasOwnProperty.call(props, k); })); saveSchema(d, r.s);
    return { ok: true, report: report, warnings: [] };
  }
  // Contrôles de l'éditeur d'inputs pour validate(): noms, required, formes.
  function validateInputs(d, errors, warnings) {
    if (typeof d.inputSchema !== 'string') return; var r = schemaOf(d); if (r.error) { errors.push(tt('edit.err.inputsPrefix', { msg: r.error })); return; }
    var names = Object.keys(r.s.properties), seen = {};
    names.forEach(function (k) {
      var low = k.toLowerCase(); if (seen[low]) errors.push(tt('edit.err.inputDup', { k: k, other: seen[low] })); seen[low] = k;
      if (k === '' || k !== k.trim() || /[{}]|::/.test(k)) errors.push(tt('edit.err.inputNameInvalid', { k: k })); else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) warnings.push(tt('edit.warn.inputNamePattern', { k: k }));
      var p = r.s.properties[k]; if (!isObj(p)) { errors.push(tt('edit.err.inputDef', { k: k })); return; }
      if (Object.prototype.hasOwnProperty.call(p, 'enum') && !Array.isArray(p.enum)) errors.push(tt('edit.err.inputEnum', { k: k }));
      if (Object.prototype.hasOwnProperty.call(p, 'x-cv-custom-list') && p['x-cv-custom-list'] === '') errors.push(tt('edit.err.inputList', { k: k }));
      if (Object.prototype.hasOwnProperty.call(p, 'x-cv-data-source') && p['x-cv-data-source'] === '') errors.push(tt('edit.err.inputSource', { k: k }));
      if (Array.isArray(p.enum) && !p.enum.length) warnings.push(tt('edit.warn.inputEmptyList', { k: k }));
    });
    (Array.isArray(r.s.required) ? r.s.required : []).forEach(function (k) { if (names.indexOf(k) < 0) errors.push(tt('edit.err.requiredMissing', { k: k })); });
  }

  var api = { createSession: createSession, run: run, trial: trial, undo: undo, redo: redo, isDirty: isDirty, exportText: exportText, detectStyle: detectStyle, serializeWith: serializeWith, encodeLike: encodeLike,
    dataOf: dataOf, findNode: findNode, forEachNode: forEachNode, validate: validate, dependentsOf: dependentsOf, CATALOG_KEYS: CATALOG_KEYS,
    setWorkflowField: setWorkflowField, setNodeField: setNodeField, setSetting: setSetting, findReplace: findReplace, replaceFunction: replaceFunction, renameInput: renameInput,
    replaceNodeType: replaceNodeType, addInput: addInput, deleteInput: deleteInput, duplicateInput: duplicateInput, moveInput: moveInput, updateInput: updateInput, setInputKind: setInputKind, setInputEnum: setInputEnum, setInputSource: setInputSource, setPasswordRules: setPasswordRules, setInputProp: setInputProp, copyInputs: copyInputs, countInputRefs: countInputRefs, schemaOf: schemaOf, deleteNode: deleteNode, duplicateNode: duplicateNode, moveNode: moveNode, moveTo: moveTo, mapLeaves: mapLeaves };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.edit = api; }
})(typeof self !== 'undefined' ? self : globalThis);
