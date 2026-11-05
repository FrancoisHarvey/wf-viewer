/* model.js - parsing des fichiers workflow + normalisation en arbre (pur, sans DOM). */
(function (root) {
  'use strict';
  var refs = typeof require === 'function' ? require('./refs.js') : root.WFV.refs;
  var t18 = (typeof require === 'function' ? require('./i18n.js') : root.WFV.i18n).t;

  function tryParse(s) {
    if (typeof s !== 'string') return { ok: false, error: 'non-string' };
    try { return { ok: true, v: JSON.parse(s) }; } catch (e) { return { ok: false, error: e.message }; }
  }

  // Parse récursivement les chaînes qui contiennent elles-mêmes du JSON (double encodage).
  function deepParse(v, depth) {
    depth = depth || 0;
    if (typeof v === 'string') {
      var t = v.trim();
      if (depth < 6 && t.length > 1 && ((t[0] === '{' && t[t.length - 1] === '}') || (t[0] === '[' && t[t.length - 1] === ']'))) {
        var p = tryParse(t);
        if (p.ok && p.v && typeof p.v === 'object') return deepParse(p.v, depth + 1);
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(function (x) { return deepParse(x, depth + 1); });
    if (v && typeof v === 'object') {
      var o = {}; Object.keys(v).forEach(function (k) { o[k] = deepParse(v[k], depth + 1); }); return o;
    }
    return v;
  }

  function parseJsonField(s) { // string JSON -> valeur parsée en profondeur; si échec {__parseError, raw}
    if (s == null) return null;
    if (typeof s !== 'string') return deepParse(s);
    var p = tryParse(s);
    return p.ok ? deepParse(p.v) : { __parseError: p.error, raw: s };
  }

  function kindOf(id) {
    if (id === 'item::sequence') return 'sequence';
    if (id === 'item::if-else') return 'if';
    if (id === 'item::executenestedworkflow') return 'nested';
    return 'normal';
  }

  function makeNode(raw, path, section) {
    var id = String(raw.id == null ? '' : raw.id);
    var bar = id.indexOf('|');
    return {
      uid: raw.uid, id: id, type: bar >= 0 ? id.slice(0, bar) : id, typeRef: bar >= 0 ? id.slice(bar + 1) : '',
      name: raw.name || '', kind: kindOf(id), raw: raw, path: path, section: section,
      children: [], trueBranch: [], falseBranch: [], parent: null, order: -1
    };
  }

  // Construit les nœuds d'une liste plate (actions[], ou une branche). Les enfants de séquence (parentUid) sont rattachés.
  function buildList(rawList, pathOf, section, parent) {
    var nodes = (rawList || []).map(function (r, i) { return makeNode(r, pathOf(i), section); });
    var byUid = {}; nodes.forEach(function (n) { if (n.uid && !byUid[n.uid]) byUid[n.uid] = n; });
    var top = [];
    nodes.forEach(function (n) {
      var pu = n.raw.parentUid, p = pu && pu !== 'null' ? byUid[pu] : null;
      if (p && p !== n) { n.parent = p; p.children.push(n); } else { n.parent = parent || null; top.push(n); }
    });
    nodes.forEach(function (n) {
      n.trueBranch = buildList(n.raw.trueBranch, function (i) { return n.path + '.trueBranch[' + i + ']'; }, section, n);
      n.falseBranch = buildList(n.raw.falseBranch, function (i) { return n.path + '.falseBranch[' + i + ']'; }, section, n);
    });
    return top;
  }

  function flatten(list, out) { // ordre d'exécution: nœud, enfants, true, false
    list.forEach(function (n) {
      out.push(n); flatten(n.children, out); flatten(n.trueBranch, out); flatten(n.falseBranch, out);
    });
    return out;
  }

  function nodeSettings(n) { // lazy + cache
    if (n._settings === undefined) n._settings = parseJsonField(n.raw.settings) || {};
    return n._settings;
  }
  function nodeSchemas(n) {
    return { inputSchema: parseJsonField(n.raw.inputSchema), successOutputSchema: parseJsonField(n.raw.successOutputSchema), failureOutputSchema: parseJsonField(n.raw.failureOutputSchema) };
  }
  function nestedTarget(n) {
    if (n.kind !== 'nested') return null;
    var s = nodeSettings(n);
    return s && typeof s.workflowId === 'string' ? s.workflowId : null;
  }

  // text: contenu du fichier. Retourne {ok:true, wf} ou {ok:false, error}.
  function parseWorkflowText(text, fileName) {
    var p = tryParse(typeof text === 'string' ? text.replace(/^﻿/, '') : text);
    if (!p.ok) return { ok: false, key: 'model.err.json', vars: { msg: p.error }, error: t18('model.err.json', { msg: p.error }), file: fileName };
    var d = p.v && p.v.data && typeof p.v.data === 'object' ? p.v.data : p.v;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, key: 'model.err.structure', error: t18('model.err.structure'), file: fileName };
    if (!d.id || !Array.isArray(d.actions)) return { ok: false, key: 'model.err.notWorkflow', error: t18('model.err.notWorkflow'), file: fileName };
    return { ok: true, wf: buildWorkflow(d, fileName, text, p.v) };
  }

  // Construit l'objet workflow (arbre normalisé) depuis l'objet JSON `d` (= contenu de data). rawText/root conservés pour l'export.
  function buildWorkflow(d, fileName, rawText, root) {
    var main = buildList(d.actions, function (i) { return 'actions[' + i + ']'; }, 'actions', null);
    var catchList = buildList(d.catchActions || [], function (i) { return 'catchActions[' + i + ']'; }, 'catch', null);
    var all = flatten(main, []); flatten(catchList, all);
    all.forEach(function (n, i) { n.order = i; });
    var uidMap = {}; all.forEach(function (n) { if (n.uid && !uidMap[n.uid]) uidMap[n.uid] = n; });
    return {
      id: d.id, file: fileName, rawText: rawText, root: root, name: d.workflowName || t18('model.noName'), description: d.description || '',
      status: d.status || '', data: d, main: main, catchList: catchList, all: all, uidMap: uidMap,
      nodeCount: all.length, updated: d.updatedDate || null, created: d.createdDate || null,
      duplicatedOfId: d.duplicatedOfId || null
    };
  }

  // Texte de recherche (settings + filtre + noms), calculé à la demande.
  function searchText(wf) {
    if (wf._search === undefined) {
      var parts = [wf.name, wf.id, wf.description];
      wf.all.forEach(function (n) {
        parts.push(n.name, n.id, n.raw.customDescription || '');
        var s = n.raw.settings; if (typeof s === 'string') parts.push(s);
        if (n.raw.filter) parts.push(JSON.stringify(n.raw.filter));
      });
      wf._search = parts.join('\n').toLowerCase();
    }
    return wf._search;
  }

  function loadTexts(items) { // items: [{name,text}] -> {workflows: Map, errors: [{file,error}]}
    var map = new Map(), errors = [];
    items.forEach(function (it) {
      var r = parseWorkflowText(it.text, it.name);
      if (!r.ok) { errors.push({ file: it.name, error: r.error, key: r.key, vars: r.vars }); return; }
      if (map.has(r.wf.id)) errors.push({ file: it.name, key: 'model.err.dup', vars: { file: map.get(r.wf.id).file }, error: t18('model.err.dup', { file: map.get(r.wf.id).file }) });
      else map.set(r.wf.id, r.wf);
    });
    return { workflows: map, errors: errors };
  }

  // Index inverse "appelé par": nested + parentWorkflowIds
  function buildCallers(map) {
    var callers = new Map();
    function add(target, caller, via) {
      if (!callers.has(target)) callers.set(target, new Map());
      var m = callers.get(target); var e = m.get(caller) || { id: caller, via: [] };
      if (e.via.indexOf(via) < 0) e.via.push(via); m.set(caller, e);
    }
    map.forEach(function (wf) {
      wf.all.forEach(function (n) { var t = nestedTarget(n); if (t) add(t, wf.id, 'nested'); });
      (Array.isArray(wf.data.parentWorkflowIds) ? wf.data.parentWorkflowIds : []).forEach(function (p) { add(wf.id, p, 'parentWorkflowIds'); });
    });
    return callers;
  }

  // Toutes les occurrences de tokens d'un workflow (cache). {node, where, token}
  function allTokens(wf) {
    if (wf._tokens) return wf._tokens;
    var out = [];
    function scan(node, v, base) { refs.walkStrings(v, base, function (s, where) { refs.extractTokens(s).forEach(function (t) { out.push({ node: node, where: where, token: t }); }); }); }
    wf.all.forEach(function (n) {
      scan(n, nodeSettings(n), 'settings');
      scan(n, n.raw.filter, 'filter');
    });
    scan(null, wf.data.filter, 'filter');
    var tc = wf.data.targetsConfig && wf.data.targetsConfig.targets;
    if (Array.isArray(tc)) scan(null, tc.map(parseJsonField), 'targetsConfig');
    wf._tokens = out; return out;
  }

  var api = { tryParse: tryParse, deepParse: deepParse, parseJsonField: parseJsonField, parseWorkflowText: parseWorkflowText, buildWorkflow: buildWorkflow, loadTexts: loadTexts,
    nodeSettings: nodeSettings, nodeSchemas: nodeSchemas, nestedTarget: nestedTarget, searchText: searchText, buildCallers: buildCallers, allTokens: allTokens };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.model = api; }
})(typeof self !== 'undefined' ? self : globalThis);
