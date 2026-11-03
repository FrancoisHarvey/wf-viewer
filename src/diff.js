/* diff.js - comparaison de deux workflows (pur, sans DOM).
   Alignement par LCS sur (id de type, name) à chaque niveau de l'arbre; settings comparés après JSON.parse. */
(function (root) {
  'use strict';
  var refs = typeof require === 'function' ? require('./refs.js') : root.WFV.refs;
  var model = typeof require === 'function' ? require('./model.js') : root.WFV.model;

  var HEADER_NOISE = ['id', 'companyId', 'owner', 'createdBy', 'updatedBy', 'createdDate', 'updatedDate', 'createdAt', 'updatedAt',
    'duplicatedOfId', 'isDuplicated', 'parentWorkflowIds', 'canEdit', 'isDraft', 'isPublished'];
  var NODE_NOISE_UID = ['uid', 'parentUid'];
  var NODE_NOISE_CATALOG = ['inputSchema', 'successOutputSchema', 'failureOutputSchema', 'categoryId', 'categoryName', 'categoryIcon',
    'categoryItemId', 'categoryItemName', 'categoryItemIcon', 'providerId', 'providerName', 'providerIcon', 'source', 'fragmentId'];

  // Libellé canonique stable d'un node: "<nom>#<k>" (k = n-ième node de même id+nom dans l'ordre d'exécution).
  function canonMap(wf) {
    if (wf._canon) return wf._canon;
    var seen = {}, map = {};
    wf.all.forEach(function (n) {
      var key = n.id + '|' + n.name; seen[key] = (seen[key] || 0) + 1;
      if (n.uid && !map[n.uid]) map[n.uid] = (n.name || n.type) + '#' + seen[key];
    });
    wf._canon = map; return map;
  }

  function normValue(v, canon) {
    var f = function (u) { return canon[u]; };
    if (typeof v === 'string') return refs.normalizeString(v, f);
    if (Array.isArray(v)) return v.map(function (x) { return normValue(x, canon); });
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = normValue(v[k], canon); }); return o; }
    return v;
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) { if (!Object.prototype.hasOwnProperty.call(b, ka[i]) || !deepEqual(a[ka[i]], b[ka[i]])) return false; }
    return true;
  }

  function diffValues(a, b, path, out) {
    if (deepEqual(a, b)) return out;
    var aa = Array.isArray(a), ba = Array.isArray(b);
    if (aa && ba) {
      for (var i = 0; i < Math.max(a.length, b.length); i++) {
        var p = path + '[' + i + ']';
        if (i >= a.length) out.push({ path: p, kind: 'added', after: b[i] });
        else if (i >= b.length) out.push({ path: p, kind: 'removed', before: a[i] });
        else diffValues(a[i], b[i], p, out);
      }
    } else if (a && b && typeof a === 'object' && typeof b === 'object' && !aa && !ba) {
      var keys = Object.keys(a); Object.keys(b).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
      keys.forEach(function (k) {
        var p2 = path ? path + '.' + k : k, ha = Object.prototype.hasOwnProperty.call(a, k), hb = Object.prototype.hasOwnProperty.call(b, k);
        if (!ha) out.push({ path: p2, kind: 'added', after: b[k] });
        else if (!hb) out.push({ path: p2, kind: 'removed', before: a[k] });
        else diffValues(a[k], b[k], p2, out);
      });
    } else out.push({ path: path, kind: 'changed', before: a, after: b });
    return out;
  }

  function nodeView(n, canon, noise) {
    var o = {}, raw = n.raw;
    Object.keys(raw).forEach(function (k) {
      if (k === 'trueBranch' || k === 'falseBranch') return;
      if (noise && (NODE_NOISE_UID.indexOf(k) >= 0 || NODE_NOISE_CATALOG.indexOf(k) >= 0)) return;
      var v = raw[k];
      if (k === 'settings' || k === 'inputSchema' || k === 'successOutputSchema' || k === 'failureOutputSchema') v = model.parseJsonField(v);
      o[k] = normValue(v, canon);
    });
    return o;
  }

  function lcsAlign(A, B, key) {
    var n = A.length, m = B.length, i, j, L = [];
    for (i = 0; i <= n; i++) { L.push(new Array(m + 1).fill(0)); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
      L[i][j] = key(A[i]) === key(B[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var out = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (key(A[i]) === key(B[j])) { out.push([A[i], B[j]]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { out.push([A[i], null]); i++; } else { out.push([null, B[j]]); j++; }
    }
    while (i < n) out.push([A[i++], null]);
    while (j < m) out.push([null, B[j++]]);
    // Appariement des trous: suites removed puis added adjacentes, même type d'id => "modifié (renommé)"
    var res = [], k = 0;
    while (k < out.length) {
      if (out[k][0] && !out[k][1] || !out[k][0] && out[k][1]) {
        var rem = [], add = [];
        while (k < out.length && (!out[k][0] || !out[k][1])) { if (out[k][0]) rem.push(out[k][0]); else add.push(out[k][1]); k++; }
        var used = {};
        rem.forEach(function (r) {
          var idx = -1; for (var q = 0; q < add.length; q++) if (!used[q] && add[q].id === r.id) { idx = q; break; }
          if (idx >= 0) { used[idx] = 1; res.push([r, add[idx]]); } else res.push([r, null]);
        });
        add.forEach(function (a, q) { if (!used[q]) res.push([null, a]); });
      } else { res.push(out[k]); k++; }
    }
    return res;
  }

  function diffLevel(listA, listB, ctx) {
    return lcsAlign(listA, listB, function (n) { return n.id + '\u0001' + n.name; }).map(function (pair) { return diffPair(pair[0], pair[1], ctx); });
  }

  function dep(n) { return typeof require === 'function' ? require('./' + n + '.js') : root.WFV[n]; }

  // Résumé natif d'un node (uid normalisés en "nom#k" pour éviter les faux diffs). null si node absent ou non natif.
  function describeNode(n, canon, ctx) {
    if (!n) return null;
    var d = dep('natives').describe(n, { wfName: ctx.wfName || null });
    if (!d) return null;
    var f = function (u) { return canon[u]; };
    return { icon: d.icon, label: d.label, src: d.src, summary: refs.normalizeString(d.summary, f), rawSummary: d.summary };
  }

  // ---- diff typé des inputs (appariés par nom de propriété) ----
  var INPUT_FIELDS = [['kindLabel', 'Type'], ['type', 'Type JSON'], ['required', 'Requis'], ['title', 'Titre'], ['description', 'Description'], ['tooltip', 'Tooltip'],
    ['customList', 'Liste personnalisée'], ['dataSource', 'Source de données'], ['filterable', 'Filtrable'], ['targetType', 'Cible'], ['format', 'Format'], ['ui', 'UI'],
    ['protected', 'Protégé'], ['passwordRules', 'Règles de mot de passe'], ['defaultValue', 'Valeur par défaut']];
  function diffInputs(pa, pb) {
    var ia = {}, ib = {}, names = [];
    pa.inputs.forEach(function (i) { ia[i.name] = i; names.push(i.name); });
    pb.inputs.forEach(function (i) { ib[i.name] = i; if (!ia[i.name]) names.push(i.name); });
    var items = [], sum = { added: 0, removed: 0, modified: 0, same: 0 };
    names.forEach(function (nm) {
      var a = ia[nm], b = ib[nm], it = { name: nm, a: a || null, b: b || null, status: 'same', changes: [] };
      if (!a || !b) it.status = a ? 'removed' : 'added';
      else {
        INPUT_FIELDS.forEach(function (f) { if (!deepEqual(a[f[0]], b[f[0]])) it.changes.push({ field: f[0], label: f[1], before: a[f[0]], after: b[f[0]] }); });
        var ea = a.enumValues || [], eb = b.enumValues || [];
        var added = eb.filter(function (v) { return ea.indexOf(v) < 0; }), removed = ea.filter(function (v) { return eb.indexOf(v) < 0; });
        if (added.length || removed.length) it.changes.push({ field: 'enum', label: 'Valeurs (enum)', added: added, removed: removed, before: a.enumValues, after: b.enumValues });
        else if ((a.enumValues && !b.enumValues) || (!a.enumValues && b.enumValues)) it.changes.push({ field: 'enum', label: 'Valeurs (enum)', added: [], removed: [], before: a.enumValues, after: b.enumValues });
        else if (!deepEqual(ea, eb)) it.changes.push({ field: 'enumOrder', label: 'Ordre des valeurs (enum)', before: ea, after: eb });
        if (it.changes.length) it.status = 'modified';
      }
      sum[it.status]++; items.push(it);
    });
    return { items: items, summary: sum, changed: sum.added + sum.removed + sum.modified };
  }

  function diffPair(a, b, ctx) {
    var item = { a: a, b: b, status: 'same', changes: [], sub: {}, hasDiff: false };
    item.descA = describeNode(a, ctx.canonA, ctx); item.descB = describeNode(b, ctx.canonB, ctx);
    if (!a || !b) {
      item.status = a ? 'removed' : 'added'; item.hasDiff = true;
    } else {
      var va = nodeView(a, ctx.canonA, ctx.noise), vb = nodeView(b, ctx.canonB, ctx.noise);
      item.changes = diffValues(va, vb, '', []);
      if (item.changes.length) item.status = 'modified';
      item.summaryChanged = !!(item.descA && item.descB && item.descA.summary !== item.descB.summary);
    }
    ['children', 'trueBranch', 'falseBranch'].forEach(function (k) {
      var la = a ? a[k] : [], lb = b ? b[k] : [];
      if (la.length || lb.length) { item.sub[k] = diffLevel(la, lb, ctx); }
    });
    if (item.status !== 'same') item.hasDiff = true;
    Object.keys(item.sub).forEach(function (k) { if (item.sub[k].some(function (x) { return x.hasDiff; })) item.hasDiff = true; });
    return item;
  }

  function headerView(wf, canon, noise, typedInputs) {
    var o = {};
    Object.keys(wf.data).forEach(function (k) {
      if (k === 'actions' || k === 'catchActions') return;
      if (noise && HEADER_NOISE.indexOf(k) >= 0) return;
      var v = wf.data[k];
      if (k === 'targetsConfig' && v && Array.isArray(v.targets)) v = { targets: v.targets.map(model.parseJsonField) };
      else if (typeof v === 'string') v = model.deepParse(v);
      if (k === 'inputSchema' && typedInputs) { v = model.parseJsonField(v); if (v && typeof v === 'object') { v = Object.assign({}, v); delete v.properties; delete v.required; } }
      o[k] = normValue(typeof v === 'string' ? v : model.deepParse(v), canon);
    });
    return o;
  }

  function countItems(items, s) {
    items.forEach(function (it) {
      s[it.status]++;
      Object.keys(it.sub).forEach(function (k) { countItems(it.sub[k], s); });
    });
    return s;
  }

  function diffWorkflows(wfA, wfB, opts) {
    opts = opts || {};
    var noise = opts.noise !== false;
    var ctx = { canonA: canonMap(wfA), canonB: canonMap(wfB), noise: noise, wfName: opts.wfName };
    var main = diffLevel(wfA.main, wfB.main, ctx), cat = diffLevel(wfA.catchList, wfB.catchList, ctx);
    var summary = countItems(cat, countItems(main, { added: 0, removed: 0, modified: 0, same: 0 }));
    var inp = dep('inputs'), pa = inp.parseInputs(wfA), pb = inp.parseInputs(wfB);
    var typed = pa.ok && pb.ok && !!pa.raw && !!pb.raw;
    var inputs = typed ? diffInputs(pa, pb) : null;
    var header = diffValues(headerView(wfA, ctx.canonA, noise, typed), headerView(wfB, ctx.canonB, noise, typed), '', []);
    // diff brut de inputSchema (toujours disponible, même quand le rendu typé est utilisé)
    var rawInputs = typed ? diffValues(pa.raw, pb.raw, '', []) : [];
    return { main: main, catchItems: cat, summary: summary, header: header, inputs: inputs, rawInputs: rawInputs,
      total: summary.added + summary.removed + summary.modified + header.length + (inputs ? inputs.changed : 0) };
  }

  var api = { diffInputs: diffInputs, diffWorkflows: diffWorkflows, diffValues: diffValues, canonMap: canonMap, lcsAlign: lcsAlign, HEADER_NOISE: HEADER_NOISE, NODE_NOISE_UID: NODE_NOISE_UID, NODE_NOISE_CATALOG: NODE_NOISE_CATALOG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.diff = api; }
})(typeof self !== 'undefined' ? self : globalThis);
