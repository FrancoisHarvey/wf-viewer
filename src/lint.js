/* lint.js - linter de workflow (pur, sans DOM). Les règles signalent des éléments SUSPECTS d'après les données et les conventions observées;
   aucune sémantique CoreView non vérifiée n'est affirmée. */
(function (root) {
  'use strict';
  var req = function (n) { return typeof require === 'function' ? require('./' + n + '.js') : root.WFV[n]; };
  var model = req('model'), analysis = req('analysis'), natives = req('natives'), graph = req('graph'), scripts = req('scripts');

  var SEV = { error: 3, warning: 2, info: 1 };
  var CONTROL = { 'item::sequence': 1, 'item::if-else': 1, 'item::stop': 1, 'item::stopv2': 1, 'item::delay': 1 };

  function lev(a, b) { // distance d'édition (petites chaînes)
    var m = a.length, n = b.length, d = [], i, j; for (i = 0; i <= m; i++) { d[i] = [i]; } for (j = 1; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function mk(rule, sev, msg, node, where) { return { rule: rule, severity: sev, message: msg, uid: node ? node.uid : null, nodeName: node ? (node.name || node.type) : '(workflow)', path: node ? node.path : '', where: where || '' }; }
  function nodeOutputs(n) { var s = model.parseJsonField(n.raw.successOutputSchema); return s && s.properties ? Object.keys(s.properties) : []; }
  function declaredInputs(wf) { var s = model.parseJsonField(wf.data.inputSchema); return s && s.properties && typeof s.properties === 'object' ? Object.keys(s.properties) : []; }

  // ctx: {wfs: Map, store (scripts store, optionnel), cg (callGraph)}
  var RULES = [
    { id: 'token-malformed', severity: 'error', title: 'Token {{…}} mal formé', check: function (wf, ctx, out) {
      model.allTokens(wf).forEach(function (o) { if (o.token.malformed) out.push(mk('token-malformed', 'error', 'Token mal formé (accolades déséquilibrées, suspect): ' + o.token.raw, o.node, o.where)); }); } },
    { id: 'path-suspect', severity: 'warning', title: 'Chemin de sortie suspect', check: function (wf, ctx, out) {
      model.allTokens(wf).forEach(function (o) {
        var t = o.token; if (t.kind !== 'action' || t.malformed) return; var tg = wf.uidMap[t.uid]; if (!tg) return;
        var path = String(t.path || ''), seg = path.split(/[\[.]/)[0], isCustom = tg.type === 'CustomManagementAction', keys = nodeOutputs(tg);
        var known = isCustom ? keys.concat(['response']) : keys;
        if (known.indexOf(seg) >= 0) { if (isCustom && path === 'response') out.push(mk('path-suspect', 'info', '« response » sans index [n] (suspect): ' + t.raw, o.node, o.where)); return; }
        var best = null; known.forEach(function (k) { var dist = lev(seg.toLowerCase(), k.toLowerCase()); if (dist <= 2 && (best === null || dist < best.d)) best = { k: k, d: dist }; });
        if (best) out.push(mk('path-suspect', 'warning', 'Chemin de sortie probablement fautif (suspect): « ' + seg + ' » ressemble à « ' + best.k + ' » dans ' + t.raw, o.node, o.where));
        else if (!isCustom && keys.length) out.push(mk('path-suspect', 'warning', 'Segment « ' + seg + ' » absent du schéma de sortie du node source (' + keys.slice(0, 5).join(', ') + ') — suspect', o.node, o.where));
      }); } },
    { id: 'ref-missing', severity: 'error', title: 'Référence action:: vers un uid absent', check: function (wf, ctx, out) {
      analysis.analyzeWorkflow(wf, ctx.wfs).broken.forEach(function (b) { if (/absent/.test(b.reason)) out.push(mk('ref-missing', 'error', 'Référence vers un uid inexistant dans ce workflow: ' + b.token.raw, b.node, b.where)); }); } },
    { id: 'ref-order', severity: 'error', title: 'Référence action:: définie après son usage', check: function (wf, ctx, out) {
      analysis.analyzeWorkflow(wf, ctx.wfs).broken.forEach(function (b) { if (!/absent/.test(b.reason)) out.push(mk('ref-order', 'error', 'Référence suspecte (' + b.reason + '): ' + b.token.raw, b.node, b.where)); }); } },
    { id: 'output-unused', severity: 'info', title: 'Sortie jamais référencée', check: function (wf, ctx, out) {
      analysis.analyzeWorkflow(wf, ctx.wfs).unreferenced.forEach(function (u) {
        var keys = nodeOutputs(u.node).filter(function (k) { return k !== 'isSuccessEvent'; });
        if (CONTROL[u.node.id] || u.node.kind === 'nested' || !keys.length) return; // contrôle / effet de bord seul (isSuccessEvent)
        out.push(mk('output-unused', 'info', 'Le node produit (' + keys.slice(0, 4).join(', ') + ') mais aucune référence {{action::…}} ne l\'utilise', u.node));
      }); } },
    { id: 'input-unused', severity: 'warning', title: 'Input déclaré jamais utilisé', check: function (wf, ctx, out) {
      var used = {}; model.allTokens(wf).forEach(function (o) { if (o.token.kind === 'input' && o.token.stepUid === 'input-stepUid') used[o.token.param] = 1; });
      var sch = model.parseJsonField(wf.data.inputSchema) || {}, req = {}; (Array.isArray(sch.required) ? sch.required : []).forEach(function (k) { req[k] = 1; });
      // requis non utilisé = avertissement; optionnel non utilisé = info (réglage anti-bruit: 101 des 130 cas des données sont des inputs optionnels)
      declaredInputs(wf).forEach(function (k) { if (!used[k]) out.push(mk('input-unused', req[k] ? 'warning' : 'info', 'Input ' + (req[k] ? 'requis ' : 'optionnel ') + '« ' + k + ' » déclaré mais jamais référencé par {{input::…}}', null, 'inputSchema.properties.' + k)); }); } },
    { id: 'input-undeclared', severity: 'warning', title: 'Input référencé mais non déclaré', check: function (wf, ctx, out) {
      var decl = {}; declaredInputs(wf).forEach(function (k) { decl[k] = 1; });
      model.allTokens(wf).forEach(function (o) { var t = o.token; if (t.kind === 'input' && !t.system && t.stepUid === 'input-stepUid' && !decl[t.param]) out.push(mk('input-undeclared', 'warning', 'Input « ' + t.param + ' » référencé mais absent d\'inputSchema (suspect)', o.node, o.where)); }); } },
    { id: 'nested-target', severity: 'warning', title: 'Workflow imbriqué hors lot / introuvable', check: function (wf, ctx, out) {
      wf.all.forEach(function (n) { if (n.kind !== 'nested') return; var t = model.nestedTarget(n);
        if (!t) out.push(mk('nested-target', 'error', 'workflowId manquant dans les settings du workflow imbriqué', n)); else if (!ctx.wfs.has(t)) out.push(mk('nested-target', 'warning', 'Workflow imbriqué hors du lot chargé: ' + t, n)); }); } },
    { id: 'seq-empty', severity: 'warning', title: 'Séquence vide', check: function (wf, ctx, out) { wf.all.forEach(function (n) { if (n.kind === 'sequence' && !n.children.length) out.push(mk('seq-empty', 'warning', 'Séquence sans action', n)); }); } },
    { id: 'if-no-branch', severity: 'warning', title: 'if-else sans branche', check: function (wf, ctx, out) { wf.all.forEach(function (n) { if (n.kind === 'if' && !n.trueBranch.length && !n.falseBranch.length) out.push(mk('if-no-branch', 'warning', 'Condition (if-else) dont les deux branches sont vides', n)); }); } },
    { id: 'nested-cycle', severity: 'error', title: 'Appel imbriqué cyclique', check: function (wf, ctx, out) {
      var c = ctx.cg && ctx.cg.inCycle[wf.id]; if (!c) return;
      wf.all.forEach(function (n) { var t = n.kind === 'nested' && model.nestedTarget(n); if (t && c.members.indexOf(t) >= 0) out.push(mk('nested-cycle', 'error', 'Appel cyclique (direct ou indirect) vers « ' + (ctx.wfs.get(t) ? ctx.wfs.get(t).name : t) + ' »', n)); }); } },
    { id: 'ps7-status', severity: 'warning', title: 'Script custom signalé PS7 Blocker/Broken/Risk', check: function (wf, ctx, out) {
      if (!ctx.store || !ctx.store.ps7.size) return;
      wf.all.forEach(function (n) { if (n.type !== 'CustomManagementAction') return; var r = ctx.store.report(n.typeRef); if (!r || r.Status === 'OK') return;
        out.push(mk('ps7-status', r.Status === 'Risk' ? 'warning' : 'error', 'Le rapport PS7 chargé classe le script « ' + (r.ActionName || n.name) + ' » : ' + r.Status + (r.Issues ? ' — ' + String(r.Issues).slice(0, 160) : ''), n)); }); } },
    { id: 'script-missing', severity: 'info', title: 'Script PowerShell non chargé', check: function (wf, ctx, out) {
      if (!ctx.store || !ctx.store.scripts.size) return;
      wf.all.forEach(function (n) { if (n.type === 'CustomManagementAction' && !ctx.store.script(n.typeRef)) out.push(mk('script-missing', 'info', 'Aucun script chargé pour la custom action ' + n.typeRef, n)); }); } },
    { id: 'param-missing', severity: 'error', title: 'Paramètre obligatoire du script non fourni', check: function (wf, ctx, out) {
      if (!ctx.store || !ctx.store.scripts.size) return;
      wf.all.forEach(function (n) { if (n.type !== 'CustomManagementAction') return; var a = ctx.store.analysis(n.typeRef); if (!a) return;
        var keys = Object.keys(model.nodeSettings(n) || {}).map(function (k) { return k.toLowerCase(); });
        a.params.forEach(function (p) { if (p.mandatory && keys.indexOf(p.name.toLowerCase()) < 0) out.push(mk('param-missing', 'error', 'Paramètre obligatoire $' + p.name + ' du script absent des settings du node (suspect)', n)); }); }); } },
    { id: 'native-key-unknown', severity: 'info', title: 'Clé de settings inconnue (action native)', check: function (wf, ctx, out) {
      wf.all.forEach(function (n) {
        if (!natives.isNative(n) || n.kind !== 'normal' || /EditUserPropertiesForWorkflow|SetMailBoxCas/.test(n.id)) return;
        var cat = model.parseJsonField(n.raw.inputSchema), props = cat && cat.properties ? cat.properties : {}, s = model.nodeSettings(n) || {};
        Object.keys(s).forEach(function (k) { if (!natives.knownKeys[k] && !Object.prototype.hasOwnProperty.call(props, k)) out.push(mk('native-key-unknown', 'info', 'Clé « ' + k + ' » inconnue du registre natives et du schéma catalogue du node', n)); });
      }); } }
  ];

  function buildContext(wfs, store) { return { wfs: wfs, store: store || null, cg: graph.callGraph(wfs) }; }
  function lintWorkflow(wf, ctx, enabled) {
    var out = [];
    RULES.forEach(function (r) { if (enabled && enabled[r.id] === false) return; try { r.check(wf, ctx, out); } catch (e) { out.push({ rule: r.id, severity: 'info', message: 'Règle en échec (' + e.message + ')', uid: null, nodeName: '', path: '', where: '' }); } });
    out.sort(function (a, b) { return SEV[b.severity] - SEV[a.severity] || (a.path < b.path ? -1 : 1); });
    return out;
  }
  function lintAll(ctx, enabled) { var res = new Map(); ctx.wfs.forEach(function (w) { res.set(w.id, lintWorkflow(w, ctx, enabled)); }); return res; }
  function counts(issues) { var c = { error: 0, warning: 0, info: 0, total: issues.length }; issues.forEach(function (i) { c[i.severity]++; }); return c; }
  function summarize(all) { // -> {byRule:{id:n}, bySeverity, perWf:[{wf,counts}]}
    var byRule = {}, bySev = { error: 0, warning: 0, info: 0 }, per = [];
    all.forEach(function (issues, id) { issues.forEach(function (i) { byRule[i.rule] = (byRule[i.rule] || 0) + 1; bySev[i.severity]++; }); per.push({ id: id, counts: counts(issues) }); });
    return { byRule: byRule, bySeverity: bySev, perWf: per };
  }

  var api = { RULES: RULES, SEV: SEV, buildContext: buildContext, lintWorkflow: lintWorkflow, lintAll: lintAll, counts: counts, summarize: summarize, lev: lev };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.lint = api; }
})(typeof self !== 'undefined' ? self : globalThis);
