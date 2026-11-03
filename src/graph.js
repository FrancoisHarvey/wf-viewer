/* graph.js - flux de données d'un workflow, graphe d'appels entre workflows, impact d'une custom action (pur, sans DOM). */
(function (root) {
  'use strict';
  var req = function (n) { return typeof require === 'function' ? require('./' + n + '.js') : root.WFV[n]; };
  var model = req('model'), analysis = req('analysis');

  // ================= 2. Flux de données d'un workflow =================
  // Arêtes: action::uid (producteur -> consommateur) et input (entrée du workflow -> consommateur).
  function dataflow(wf) {
    if (wf._dataflow) return wf._dataflow;
    var edges = {}, produces = {}, consumes = {}, inputUsers = {}, wfLevel = [];
    function key(a, b, kind) { return kind + '|' + a + '|' + b; }
    function add(from, to, kind, path, where) {
      var k = key(from, to, kind), e = edges[k];
      if (!e) e = edges[k] = { from: from, to: to, kind: kind, count: 0, paths: [], wheres: [] };
      e.count++; if (path && e.paths.indexOf(path) < 0) e.paths.push(path); if (where && e.wheres.indexOf(where) < 0) e.wheres.push(where);
    }
    model.allTokens(wf).forEach(function (o) {
      var t = o.token; if (t.malformed) return;
      var to = o.node ? o.node.uid : null;
      if (t.kind === 'action') {
        var src = wf.uidMap[t.uid]; if (!src) return; // référence cassée: pas d'arête
        if (to === null) { wfLevel.push({ from: t.uid, where: o.where }); return; }
        if (to === t.uid) return;
        add(t.uid, to, 'action', t.path, o.where);
      } else if (t.kind === 'input' && !t.system && t.stepUid === 'input-stepUid') {
        if (to === null) { wfLevel.push({ from: 'in:' + t.param, where: o.where }); return; }
        add('in:' + t.param, to, 'input', t.param, o.where);
      }
    });
    var list = Object.keys(edges).map(function (k) { return edges[k]; });
    list.forEach(function (e) {
      (produces[e.from] = produces[e.from] || []).push(e); (consumes[e.to] = consumes[e.to] || []).push(e);
      if (e.kind === 'input') (inputUsers[e.from.slice(3)] = inputUsers[e.from.slice(3)] || []).push(e.to);
    });
    wf._dataflow = { edges: list, produces: produces, consumes: consumes, inputUsers: inputUsers, wfLevel: wfLevel, actionEdges: list.filter(function (e) { return e.kind === 'action'; }).length };
    return wf._dataflow;
  }

  // Amont / aval (ensemble d'ids) à partir d'un id
  function reach(df, id, dir) {
    var seen = {}, stack = [id], map = dir === 'up' ? df.consumes : df.produces;
    while (stack.length) { var x = stack.pop(); (map[x] || []).forEach(function (e) { var n = dir === 'up' ? e.from : e.to; if (!seen[n]) { seen[n] = 1; stack.push(n); } }); }
    return seen;
  }

  function groupOf(tn) {
    var p = tn.parent; if (!p) return null;
    if (p.kind === 'sequence' && p.children.indexOf(tn) >= 0) return { id: 'seq:' + p.uid, label: 'Séquence « ' + (p.name || p.path) + ' »' };
    if (p.kind === 'if' || p.trueBranch.indexOf(tn) >= 0 || p.falseBranch.indexOf(tn) >= 0) return { id: 'br:' + p.uid + ':' + (p.trueBranch.indexOf(tn) >= 0 ? 'T' : 'F'), label: (p.trueBranch.indexOf(tn) >= 0 ? 'VRAI' : 'FAUX') + ' de « ' + (p.name || p.path) + ' »' };
    return null;
  }

  // Disposition en couches (coordonnées logiques). maxNodes: au plus N nodes affichés (les mieux connectés).
  function layout(wf, maxNodes, opts) {
    var df = dataflow(wf); maxNodes = maxNodes || 50; opts = opts || {};
    if (opts.noInputs) df = { edges: df.edges.filter(function (e) { return e.kind !== 'input'; }), produces: df.produces, consumes: df.consumes, inputUsers: df.inputUsers, wfLevel: df.wfLevel, actionEdges: df.actionEdges, full: df };
    if (!df.edges.length) return { empty: true, nodes: [], edges: [], groups: [], hidden: wf.all.length, df: df, width: 0, height: 0 };
    var deg = {}; df.edges.forEach(function (e) { deg[e.from] = (deg[e.from] || 0) + 1; deg[e.to] = (deg[e.to] || 0) + 1; });
    var ids = Object.keys(deg), hiddenConnected = 0;
    var nodeIds = ids.filter(function (i) { return i.slice(0, 3) === 'in:'; }), exec = ids.filter(function (i) { return i.slice(0, 3) !== 'in:'; });
    exec.sort(function (a, b) { return wf.uidMap[a].order - wf.uidMap[b].order; });
    var keep = exec;
    if (exec.length + nodeIds.length > maxNodes) {
      keep = exec.slice().sort(function (a, b) { return deg[b] - deg[a] || wf.uidMap[a].order - wf.uidMap[b].order; }).slice(0, Math.max(5, maxNodes - nodeIds.length));
      hiddenConnected = exec.length - keep.length; keep.sort(function (a, b) { return wf.uidMap[a].order - wf.uidMap[b].order; });
    }
    var show = {}; keep.concat(nodeIds).forEach(function (i) { show[i] = 1; });
    var edges = df.edges.filter(function (e) { return show[e.from] && show[e.to]; });
    // couches: entrées = 0; node = 1 + max(couche des producteurs)
    var layer = {}; nodeIds.forEach(function (i) { layer[i] = 0; });
    var guard = 0, changed = true;
    keep.forEach(function (i) { layer[i] = nodeIds.length ? 1 : 0; });
    while (changed && guard++ < 200) { changed = false; edges.forEach(function (e) { if (layer[e.from] + 1 > layer[e.to] && wf.uidMap[e.to].order >= (wf.uidMap[e.from] ? wf.uidMap[e.from].order : -1)) { layer[e.to] = layer[e.from] + 1; changed = true; } }); }
    var cols = {}; Object.keys(layer).forEach(function (i) { (cols[layer[i]] = cols[layer[i]] || []).push(i); });
    var W = 200, H = 42, GX = 70, GY = 18, nodes = [], pos = {}, maxRows = 0, ROWS = 14, colIdx = 0; // une couche de plus de ROWS nodes est répartie sur plusieurs sous-colonnes
    Object.keys(cols).map(Number).sort(function (a, b) { return a - b; }).forEach(function (c) {
      cols[c].sort(function (a, b) { var oa = a.slice(0, 3) === 'in:' ? -1 : wf.uidMap[a].order, ob = b.slice(0, 3) === 'in:' ? -1 : wf.uidMap[b].order; return oa - ob; });
      for (var s0 = 0; s0 < cols[c].length; s0 += ROWS) {
      var chunk = cols[c].slice(s0, s0 + ROWS); maxRows = Math.max(maxRows, chunk.length);
      chunk.forEach(function (id, r) {
        var isIn = id.slice(0, 3) === 'in:', tn = isIn ? null : wf.uidMap[id];
        var n = { id: id, kind: isIn ? 'input' : 'node', label: isIn ? id.slice(3) : (tn.name || tn.type), sub: isIn ? 'input' : tn.path, uid: isIn ? null : id, layer: c, x: colIdx * (W + GX), y: r * (H + GY), w: W, h: H, tn: tn };
        nodes.push(n); pos[id] = n;
      });
      colIdx++; }
    });
    var gmap = {};
    nodes.forEach(function (n) { if (!n.tn) return; var g = groupOf(n.tn); if (!g) return; (gmap[g.id] = gmap[g.id] || { id: g.id, label: g.label, members: [] }).members.push(n); });
    var groups = Object.keys(gmap).map(function (k) { var g = gmap[k], x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity; g.members.forEach(function (m) { x1 = Math.min(x1, m.x); y1 = Math.min(y1, m.y); x2 = Math.max(x2, m.x + m.w); y2 = Math.max(y2, m.y + m.h); }); return { id: g.id, label: g.label, x: x1 - 8, y: y1 - 16, w: x2 - x1 + 16, h: y2 - y1 + 24, count: g.members.length }; });
    var ncols = colIdx;
    return { empty: false, nodes: nodes, edges: edges.map(function (e) { return { from: e.from, to: e.to, kind: e.kind, count: e.count, paths: e.paths }; }), groups: groups, hidden: wf.all.length - keep.length, hiddenConnected: hiddenConnected, df: df, pos: pos, width: ncols * (W + GX) - GX, height: maxRows * (H + GY) };
  }

  // ================= 3. Graphe d'appels entre workflows =================
  function callGraph(map) {
    var edges = [], out = {}, inn = {};
    map.forEach(function (w) { w.all.forEach(function (n) { if (n.kind === 'nested') { var t = model.nestedTarget(n); edges.push({ from: w.id, to: t, uid: n.uid, nodeName: n.name, path: n.path, inLot: !!(t && map.has(t)) }); } }); });
    edges.forEach(function (e) { if (!e.to) return; (out[e.from] = out[e.from] || {})[e.to] = 1; (inn[e.to] = inn[e.to] || {})[e.from] = 1; });
    var ids = []; map.forEach(function (w) { ids.push(w.id); }); var isIn = function (i) { return map.has(i); };
    // Tarjan (itératif non nécessaire: petit graphe) sur les workflows du lot
    var index = 0, st = [], on = {}, idx = {}, low = {}, sccs = [];
    function strong(v) {
      idx[v] = low[v] = index++; st.push(v); on[v] = 1;
      Object.keys(out[v] || {}).filter(isIn).forEach(function (w) { if (idx[w] === undefined) { strong(w); low[v] = Math.min(low[v], low[w]); } else if (on[w]) low[v] = Math.min(low[v], idx[w]); });
      if (low[v] === idx[v]) { var c = [], x; do { x = st.pop(); on[x] = 0; c.push(x); } while (x !== v); sccs.push(c); }
    }
    ids.forEach(function (v) { if (idx[v] === undefined) strong(v); });
    var cycles = sccs.filter(function (c) { return c.length > 1 || (out[c[0]] && out[c[0]][c[0]]); }).map(function (c) { return cyclePath(c, out); });
    var inCycle = {}; cycles.forEach(function (c) { c.members.forEach(function (m) { inCycle[m] = c; }); });
    // couches (profondeur depuis les racines) sur le graphe condensé
    var comp = {}; sccs.forEach(function (c, i) { c.forEach(function (m) { comp[m] = i; }); });
    var memo = {};
    function depthFrom(v, seen) { // plus long chemin sortant (en nombre d'arêtes), cycles ignorés
      if (memo[v] !== undefined) return memo[v]; if (seen[comp[v]]) return 0; seen[comp[v]] = 1;
      var m = 0; Object.keys(out[v] || {}).forEach(function (w) { if (comp[w] === comp[v]) return; m = Math.max(m, 1 + depthFrom(w, seen)); });
      delete seen[comp[v]]; return memo[v] = m;
    }
    var involved = {}; edges.forEach(function (e) { involved[e.from] = 1; if (e.to) involved[e.to] = 1; });
    var depth = {}, maxDepth = 0; Object.keys(involved).forEach(function (v) { if (map.has(v)) { depth[v] = depthFrom(v, {}); maxDepth = Math.max(maxDepth, depth[v]); } });
    var roots = Object.keys(involved).filter(function (v) { return map.has(v) && !(inn[v] && Object.keys(inn[v]).length) && Object.keys(out[v] || {}).length; });
    var leaves = Object.keys(involved).filter(function (v) { return map.has(v) && Object.keys(inn[v] || {}).length && !Object.keys(out[v] || {}).filter(isIn).length; });
    var orphans = ids.filter(function (v) { return !involved[v]; });
    // composantes (non orientées)
    var seenC = {}, components = [];
    Object.keys(involved).forEach(function (v) { if (seenC[v] || !map.has(v)) return; var c = [], stack = [v]; seenC[v] = 1; while (stack.length) { var x = stack.pop(); c.push(x); Object.keys(out[x] || {}).concat(Object.keys(inn[x] || {})).forEach(function (y) { if (!seenC[y] && map.has(y)) { seenC[y] = 1; stack.push(y); } }); } components.push(c); });
    components.sort(function (a, b) { return b.length - a.length; });
    // cohérence nested <-> parentWorkflowIds (parentWorkflowIds d'un workflow = liste de ses appelants)
    var missingInParent = [], extraInParent = [];
    map.forEach(function (w) {
      var pw = Array.isArray(w.data.parentWorkflowIds) ? w.data.parentWorkflowIds : [], callers = Object.keys(inn[w.id] || {});
      callers.forEach(function (c) { if (pw.indexOf(c) < 0) missingInParent.push({ callee: w.id, caller: c }); });
      pw.forEach(function (p) { if (!(inn[w.id] && inn[w.id][p])) extraInParent.push({ callee: w.id, parent: p, inLot: map.has(p) }); });
    });
    return { edges: edges, out: out, inn: inn, cycles: cycles, inCycle: inCycle, depth: depth, maxDepth: maxDepth, roots: roots, leaves: leaves, orphans: orphans, components: components,
      outOfLot: edges.filter(function (e) { return !e.inLot; }), distinctPairs: Object.keys(edges.reduce(function (a, e) { a[e.from + '>' + e.to] = 1; return a; }, {})).length,
      involved: Object.keys(involved), missingInParent: missingInParent, extraInParent: extraInParent, ids: ids };
  }
  function cyclePath(members, out) { // un chemin de cycle représentatif
    var set = {}; members.forEach(function (m) { set[m] = 1; });
    var start = members[0], path = [start], seen = {}; seen[start] = 1; var cur = start;
    for (var i = 0; i < members.length + 1; i++) {
      var nxt = Object.keys(out[cur] || {}).filter(function (w) { return set[w]; });
      var back = nxt.indexOf(start) >= 0 && path.length > 0 && i > 0 ? start : null;
      if (back) { path.push(start); break; }
      var pick = nxt.filter(function (w) { return !seen[w]; })[0] || nxt[0]; if (!pick) break; if (seen[pick] && pick !== start) { path.push(pick); break; } path.push(pick); seen[pick] = 1; cur = pick; if (pick === start) break;
    }
    return { members: members, path: path };
  }
  // Arbre récursif des appelants (dir 'up') ou appelés (dir 'down'), protégé contre les cycles.
  function tree(cg, id, dir, maxDepth) {
    maxDepth = maxDepth || 12;
    function rec(v, trail, d) {
      var nb = Object.keys((dir === 'up' ? cg.inn : cg.out)[v] || {}), node = { id: v, children: [], cyclic: false, truncated: false };
      if (d >= maxDepth) { node.truncated = nb.length > 0; return node; }
      nb.forEach(function (w) { if (trail.indexOf(w) >= 0) node.children.push({ id: w, children: [], cyclic: true }); else node.children.push(rec(w, trail.concat(w), d + 1)); });
      return node;
    }
    return rec(id, [id], 0);
  }
  function closure(cg, id, dir) { var seen = {}, st = [id]; while (st.length) { var x = st.pop(); Object.keys((dir === 'up' ? cg.inn : cg.out)[x] || {}).forEach(function (y) { if (!seen[y] && y !== id) { seen[y] = 1; st.push(y); } }); } return Object.keys(seen); }

  // ================= 4. Impact =================
  function usageOfAction(map, guid) {
    guid = String(guid).toLowerCase(); var uses = [];
    map.forEach(function (w) { w.all.forEach(function (n) { if (n.type === 'CustomManagementAction' && n.typeRef.toLowerCase() === guid) uses.push({ wf: w, node: n }); }); });
    return uses;
  }
  // chaîne d'appel la plus courte (BFS) du workflow `start` (appelant transitif) vers un des `targets`
  function chainTo(cg, start, targetSet) {
    var prev = {}, q = [start], seen = {}; seen[start] = 1;
    while (q.length) { var x = q.shift(); if (targetSet[x] && x !== start) { var p = [x]; while (prev[p[0]] !== undefined) p.unshift(prev[p[0]]); return p; } Object.keys(cg.out[x] || {}).forEach(function (y) { if (!seen[y]) { seen[y] = 1; prev[y] = x; q.push(y); } }); }
    return null;
  }
  function impactOfAction(map, store, guid, cg) {
    cg = cg || callGraph(map); guid = String(guid).toLowerCase();
    var uses = usageOfAction(map, guid), direct = {}; uses.forEach(function (u) { direct[u.wf.id] = 1; });
    var indirect = {}; Object.keys(direct).forEach(function (id) { closure(cg, id, 'up').forEach(function (c) { if (!direct[c]) indirect[c] = 1; }); });
    var indirectList = Object.keys(indirect).filter(function (id) { return map.has(id); }).map(function (id) { return { wf: map.get(id), chain: chainTo(cg, id, direct) }; });
    var act = store ? store.action(guid) : null, rep = store ? store.report(guid) : null, sc = store ? store.script(guid) : null;
    return { kind: 'action', key: guid, title: act ? act.title : null, state: act ? act.state : null, action: act, report: rep, hasScript: !!sc, uses: uses, directWfs: Object.keys(direct).map(function (i) { return map.get(i); }), indirect: indirectList,
      active: uses.filter(function (u) { return u.wf.status === 'Active'; }).length };
  }
  function impactOfToken(map, kind, name) { // kind 'var' | 'fn'
    var uses = [], an = analysis;
    map.forEach(function (w) { var a = an.analyzeWorkflow(w, map); var bag = kind === 'var' ? a.variables : a.fns; var k = Object.keys(bag).filter(function (x) { return kind === 'var' ? (bag[x].param === name) : x === name; }); k.forEach(function (x) { bag[x].uses.forEach(function (u) { uses.push({ wf: w, node: u.node, where: u.where, token: u.token }); }); }); });
    var wfs = {}; uses.forEach(function (u) { wfs[u.wf.id] = u.wf; });
    return { kind: kind, key: name, uses: uses, directWfs: Object.keys(wfs).map(function (i) { return wfs[i]; }), indirect: [], title: (kind === 'var' ? 'Variable ' : 'Fonction ') + name };
  }
  function impactMarkdown(imp) {
    var L = [], esc = function (s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); };
    L.push('# Rapport d\'impact — ' + (imp.title || imp.key), '');
    L.push('- Clé: `' + imp.key + '`' + (imp.kind === 'action' ? '' : ' (' + (imp.kind === 'var' ? 'variable d\'input' : 'fonction de token') + ')'));
    if (imp.kind === 'action') {
      L.push('- État: ' + (imp.state || 'inconnu (liste customaction non chargée)'));
      L.push('- Rapport PS7: ' + (imp.report ? imp.report.Status + (imp.report.Issues ? ' — ' + esc(imp.report.Issues) : '') : 'non chargé'));
      L.push('- Script: ' + (imp.hasScript ? 'chargé' : 'non chargé'));
    }
    L.push('- Nodes concernés: ' + imp.uses.length + ' dans ' + imp.directWfs.length + ' workflow(s) (' + imp.directWfs.filter(function (w) { return w.status === 'Active'; }).length + ' actif(s))');
    L.push('- Workflows impactés indirectement (appel imbriqué): ' + imp.indirect.length, '');
    L.push('## Usages directs', '', '| Workflow | Statut | Node | Chemin | ID workflow |', '|---|---|---|---|---|');
    imp.uses.forEach(function (u) { L.push('| ' + esc(u.wf.name) + ' | ' + esc(u.wf.status) + ' | ' + esc(u.node ? (u.node.name || u.node.type) : '(workflow)') + ' | ' + esc(u.node ? u.node.path : u.where) + ' | `' + u.wf.id + '` |'); });
    L.push('', '## Impact transitif (via workflows imbriqués)', '');
    if (!imp.indirect.length) L.push('_Aucun_'); else { L.push('| Workflow | Statut | Chaîne d\'appel |', '|---|---|---|'); imp.indirect.forEach(function (x) { L.push('| ' + esc(x.wf.name) + ' | ' + esc(x.wf.status) + ' | ' + esc((x.chain || []).map(function (id) { return id; }).join(' → ')) + ' |'); }); }
    L.push('', '_Rapport généré par wf-viewer (lecture seule). Les statuts viennent des fichiers chargés._');
    return L.join('\n');
  }

  var api = { dataflow: dataflow, reach: reach, layout: layout, callGraph: callGraph, tree: tree, closure: closure, usageOfAction: usageOfAction, impactOfAction: impactOfAction, impactOfToken: impactOfToken, impactMarkdown: impactMarkdown, groupOf: groupOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.graph = api; }
})(typeof self !== 'undefined' ? self : globalThis);
