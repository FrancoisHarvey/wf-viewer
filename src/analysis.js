/* analysis.js - analyse par workflow et globale (pur, sans DOM). */
(function (root) {
  'use strict';
  var model = typeof require === 'function' ? require('./model.js') : root.WFV.model;
  var t18 = (typeof require === 'function' ? require('./i18n.js') : root.WFV.i18n).t;

  var CONTROL_NO_OUTPUT = { 'item::sequence': 1, 'item::if-else': 1, 'item::stop': 1, 'item::stopv2': 1, 'item::delay': 1, 'item::vtenant-check': 1, 'item::owner-approval-timeout': 1 };

  function outputSchemaHasProps(n) {
    var s = model.parseJsonField(n.raw.successOutputSchema);
    return !!(s && s.properties && Object.keys(s.properties).length);
  }

  // map: Map id->wf (pour détecter les nested hors lot)
  function analyzeWorkflow(wf, map) {
    if (wf._analysis) return wf._analysis;
    var tokens = model.allTokens(wf);
    var variables = {}, fns = {}, referencedUids = {}, broken = [], malformed = [], nestedOut = [], nestedAll = [];
    tokens.forEach(function (o) {
      var t = o.token, loc = { node: o.node, where: o.where, token: t };
      if (t.malformed) { malformed.push(loc); return; }
      if (t.kind === 'input') {
        var key = t.system ? t18('analysis.system', { name: t.param }) : t.param;
        var v = variables[key] || (variables[key] = { param: t.param, system: !!t.system, count: 0, uses: [] });
        v.count++; v.uses.push(loc);
      }
      t.fns.forEach(function (f) { var e = fns[f.name] || (fns[f.name] = { name: f.name, count: 0, uses: [] }); e.count++; e.uses.push(loc); });
      if (t.kind === 'action') {
        var target = wf.uidMap[t.uid];
        if (!target) broken.push({ node: o.node, where: o.where, token: t, code: 'missing', reason: t18('analysis.reason.missing') });
        else {
          referencedUids[t.uid] = (referencedUids[t.uid] || 0) + 1;
          var uorder = o.node ? o.node.order : -1;
          if (target === o.node) broken.push({ node: o.node, where: o.where, token: t, code: 'self', reason: t18('analysis.reason.self') });
          else if (target.order > uorder) broken.push({ node: o.node, where: o.where, token: t, code: 'after', reason: t18('analysis.reason.after', { path: target.path }) });
        }
      }
    });
    var unreferenced = wf.all.filter(function (n) { return !referencedUids[n.uid] && !CONTROL_NO_OUTPUT[n.id]; })
      .map(function (n) { return { node: n, hasOutputSchema: outputSchemaHasProps(n) }; });
    wf.all.forEach(function (n) {
      var tid = model.nestedTarget(n);
      if (n.kind === 'nested') {
        nestedAll.push({ node: n, targetId: tid, inBatch: !!(tid && map && map.has(tid)) });
        if (!tid || (map && !map.has(tid))) nestedOut.push({ node: n, targetId: tid });
      }
    });
    wf._analysis = { variables: variables, fns: fns, unreferenced: unreferenced, broken: broken, malformed: malformed, nestedOut: nestedOut, nestedAll: nestedAll, tokenCount: tokens.length };
    return wf._analysis;
  }

  // Index global: types de nodes, variables, fonctions, workflows cibles nested.
  function buildGlobal(map) {
    var types = {}, vars = {}, fns = {}, nested = {};
    function bump(o, key, wfId, label) {
      var e = o[key] || (o[key] = { key: key, label: label || key, count: 0, wfIds: new Set() });
      e.count++; e.wfIds.add(wfId); return e;
    }
    map.forEach(function (wf) {
      wf.all.forEach(function (n) {
        var e = bump(types, n.id, wf.id, n.raw.categoryItemName || n.name);
        if (!e.label || e.label === n.id) e.label = n.raw.categoryItemName || n.name || n.id;
        var tid = model.nestedTarget(n); if (tid) bump(nested, tid, wf.id, map.has(tid) ? map.get(tid).name : 'hors lot');
      });
      var a = analyzeWorkflow(wf, map);
      Object.keys(a.variables).forEach(function (k) { var v = a.variables[k]; var e = bump(vars, k, wf.id, k); e.count += v.count - 1; });
      Object.keys(a.fns).forEach(function (k) { var v = a.fns[k]; var e = bump(fns, k, wf.id, k); e.count += v.count - 1; });
    });
    function arr(o) { return Object.keys(o).map(function (k) { return o[k]; }).sort(function (a, b) { return b.count - a.count || (a.label > b.label ? 1 : -1); }); }
    return { types: arr(types), vars: arr(vars), fns: arr(fns), nested: arr(nested) };
  }

  var api = { analyzeWorkflow: analyzeWorkflow, buildGlobal: buildGlobal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.analysis = api; }
})(typeof self !== 'undefined' ? self : globalThis);
