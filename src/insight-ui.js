/* insight-ui.js - vues "comprendre et déboguer": Qualité (linter), Flux de données, Appels entre workflows, Impact. Tout texte via textContent. */
(function () {
  'use strict';
  const W = window.WFV, U = W.ui, G = W.graph, L = W.lint, model = W.model;
  const { S, h, hooks, add, short } = U;
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs, ...kids) => {
    const e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => { if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]); });
    kids.flat().forEach((c) => { if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  };
  const href = (o) => '#' + new URLSearchParams(o).toString();
  const wfLink = (id, tab, text, cls) => h('a', { href: href({ wf: id, tab: tab || 'detail' }), class: cls, text: text });
  const nodeLink = (wfId, uid, text, tech) => h('a', { href: href({ wf: wfId, tab: 'detail', node: uid }) }, text, tech ? h('span', { class: 'tech', text: tech }) : null);
  const statusBadge = (w) => h('span', { class: 'badge ' + (w.status === 'Inactive' ? 'inactive' : 'active'), text: w.status || '?' });
  const wfNameOf = (id) => (S.wfs.has(id) ? S.wfs.get(id).name : null);

  // ---------- règles: persistance localStorage (try/catch) ----------
  const LS_KEY = 'wfv.lint.rules';
  function loadRules() { try { const v = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
  function saveRules(r) { try { localStorage.setItem(LS_KEY, JSON.stringify(r)); } catch (e) { /* stockage indisponible */ } }
  const Q = { enabled: loadRules(), sev: { error: true, warning: true, info: true }, ruleFilter: '', min: 'info', page: 0, ctxSig: null, ctx: null, cache: new Map(), cacheSig: '' };

  // ---------- contexte partagé (invalidé par rechargement, scripts, édition, règles) ----------
  function signature() {
    const st = S.store; let sig = st.scripts.size + ':' + st.actions.size + ':' + st.ps7.size + '|' + S.wfs.size + '|' + JSON.stringify(Q.enabled);
    S.wfs.forEach((w) => { if (w.dirty && w.session) sig += '|' + w.id + ':' + JSON.stringify(w.session.root).length; });
    return sig;
  }
  function ctx() {
    const sig = signature();
    if (Q.ctxSig !== sig) { Q.ctx = L.buildContext(S.wfs, S.store.scripts.size || S.store.ps7.size ? S.store : null); Q.ctxSig = sig; Q.cache = new Map(); Q.all = null; }
    return Q.ctx;
  }
  function issuesOf(w) { const c = ctx(); let r = Q.cache.get(w.id); if (!r || r.wf !== w) { r = { wf: w, issues: L.lintWorkflow(w, c, Q.enabled) }; Q.cache.set(w.id, r); } return r.issues; }
  function allIssues() { ctx(); const m = new Map(); S.wfs.forEach((w) => m.set(w.id, issuesOf(w))); return m; }
  const SEVTXT = { error: '✖ erreur', warning: '⚠ avertissement', info: 'ℹ info' };
  const sevBadge = (s) => h('span', { class: 'badge sev-' + s, text: SEVTXT[s] });

  hooks.listBadge = (w) => {
    if (!S.wfs.size) return null; let c; try { c = L.counts(issuesOf(w)); } catch (e) { return null; }
    if (!c.error && !c.warning) return null;
    return h('span', { class: 'badge ' + (c.error ? 'sev-error' : 'sev-warning'), title: 'Qualité: ' + c.error + ' erreur(s), ' + c.warning + ' avertissement(s), ' + c.info + ' info', text: (c.error ? '✖' + c.error : '⚠' + c.warning) });
  };

  // ================= 1. QUALITÉ =================
  function rulesPanel() {
    const d = h('details', { class: 'sub' }, h('summary', { text: 'Règles (' + L.RULES.filter((r) => Q.enabled[r.id] !== false).length + '/' + L.RULES.length + ' activées)' }));
    d.append(h('div', { class: 'rules' }, L.RULES.map((r) => h('label', { class: 'rule' }, h('input', { type: 'checkbox', checked: Q.enabled[r.id] !== false ? true : null, onchange: (e) => { Q.enabled[r.id] = e.target.checked; saveRules(Q.enabled); S.global = null; U.renderList(); U.render(); } }),
      ' ', sevBadge(r.severity), ' ', h('code', { text: r.id }), ' — ' + r.title))), h('small', { class: 'muted', text: 'Les règles signalent des éléments suspects d\'après les conventions observées dans les données; ce n\'est pas une validation CoreView. Préférences conservées dans ce navigateur (localStorage).' }));
    return d;
  }
  function sevFilters() {
    return h('div', { class: 'toolbar' }, ['error', 'warning', 'info'].map((s) => h('label', null, h('input', { type: 'checkbox', checked: Q.sev[s] ? true : null, onchange: (e) => { Q.sev[s] = e.target.checked; U.render(); } }), ' ', sevBadge(s))));
  }
  function qualityView(st, wf) {
    const root = h('div', null, h('h1', { text: 'Qualité' }));
    const mode = st.wf && wf ? 'wf' : 'all';
    if (mode === 'wf') {
      const issues = issuesOf(wf), c = L.counts(issues), shown = issues.filter((i) => Q.sev[i.severity] && (!Q.ruleFilter || i.rule === Q.ruleFilter));
      add(root, h('h2', null, wfLink(wf.id, 'detail', wf.name, 'wflink'), ' ', statusBadge(wf)), h('div', { class: 'summary' }, h('span', { class: 'badge sev-error', text: c.error + ' erreur(s)' }), h('span', { class: 'badge sev-warning', text: c.warning + ' avertissement(s)' }), h('span', { class: 'badge sev-info', text: c.info + ' info' })),
        sevFilters(), rulesPanel(),
        h('button', { type: 'button', text: 'Voir tous les workflows →', onclick: () => U.setHash({ wf: '', tab: 'quality' }) }));
      if (!shown.length) add(root, h('p', { class: 'okmsg', text: issues.length ? 'Aucune alerte avec ces filtres.' : '✓ Aucune alerte pour ce workflow (avec les règles activées).' }));
      else add(root, h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['Sévérité', 'Règle', 'Message', 'Emplacement'].map((t) => h('th', { text: t })))),
        h('tbody', null, shown.map((i) => h('tr', null, h('td', null, sevBadge(i.severity)), h('td', null, h('code', { text: i.rule })), h('td', null, U.dual(i.message, U.labels.humanize(i.message, wf))),
          h('td', null, i.uid ? nodeLink(wf.id, i.uid, i.nodeName, ' [' + i.path + ']') : h('span', null, '(workflow)', h('span', { class: 'tech', text: ' ' + i.where })), i.where && i.uid ? h('div', { class: 'muted mono tech', text: i.where }) : null))))));
      return root;
    }
    const all = allIssues(), sm = L.summarize(all);
    add(root, h('div', { class: 'summary' }, h('span', { class: 'badge sev-error', text: sm.bySeverity.error + ' erreur(s)' }), h('span', { class: 'badge sev-warning', text: sm.bySeverity.warning + ' avertissement(s)' }), h('span', { class: 'badge sev-info', text: sm.bySeverity.info + ' info' }),
      h('span', { class: 'badge', text: sm.perWf.filter((x) => !x.counts.total).length + ' workflow(s) sans alerte / ' + S.wfs.size })), sevFilters(), rulesPanel());
    const ruleRows = L.RULES.map((r) => ({ r, n: sm.byRule[r.id] || 0, wfs: [...all.values()].filter((is) => is.some((i) => i.rule === r.id)).length })).filter((x) => Q.enabled[x.r.id] !== false).sort((a, b) => b.n - a.n);
    add(root, h('h2', { text: 'Règles les plus déclenchées' }), h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['Règle', 'Sévérité', 'Alertes', 'Workflows'].map((t) => h('th', { text: t })))),
      h('tbody', null, ruleRows.map((x) => h('tr', { class: 'click', tabindex: 0, onclick: () => { Q.ruleFilter = Q.ruleFilter === x.r.id ? '' : x.r.id; Q.page = 0; U.render(); }, onkeydown: (e) => { if (e.key === 'Enter') { Q.ruleFilter = Q.ruleFilter === x.r.id ? '' : x.r.id; Q.page = 0; U.render(); } } },
        h('td', null, h('code', { text: x.r.id }), ' ' + x.r.title), h('td', null, sevBadge(x.r.severity)), h('td', { text: x.n }), h('td', { text: x.wfs }))))),
      Q.ruleFilter ? h('p', null, 'Filtre de règle: ', h('code', { text: Q.ruleFilter }), ' ', h('button', { type: 'button', text: '✕', onclick: () => { Q.ruleFilter = ''; U.render(); } })) : h('p', { class: 'muted', text: 'Cliquez une règle pour filtrer la liste.' }));
    const rows = [...S.wfs.values()].map((w) => { const is = all.get(w.id).filter((i) => Q.sev[i.severity] && (!Q.ruleFilter || i.rule === Q.ruleFilter)); return { w, c: L.counts(is) }; }).filter((x) => x.c.total).sort((a, b) => b.c.error - a.c.error || b.c.warning - a.c.warning || b.c.info - a.c.info || a.w.name.localeCompare(b.w.name));
    const PAGE = 50, pages = Math.max(1, Math.ceil(rows.length / PAGE)); Q.page = Math.min(Q.page, pages - 1);
    add(root, h('h2', { text: 'Workflows les plus problématiques (' + rows.length + ')' }), h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['Workflow', 'Statut', '✖', '⚠', 'ℹ'].map((t) => h('th', { text: t })))),
      h('tbody', null, rows.slice(Q.page * PAGE, Q.page * PAGE + PAGE).map((x) => h('tr', null, h('td', null, wfLink(x.w.id, 'quality', x.w.name)), h('td', null, statusBadge(x.w)), h('td', { text: x.c.error }), h('td', { text: x.c.warning }), h('td', { text: x.c.info }))))),
      pages > 1 ? h('div', { class: 'toolbar' }, h('button', { type: 'button', text: '◀', disabled: Q.page ? null : true, onclick: () => { Q.page--; U.render(); } }), h('span', { text: 'page ' + (Q.page + 1) + '/' + pages }), h('button', { type: 'button', text: '▶', disabled: Q.page < pages - 1 ? null : true, onclick: () => { Q.page++; U.render(); } })) : null);
    return root;
  }

  // ================= 2. FLUX DE DONNÉES =================
  function zoomPan(box, svg, bounds, first) {
    const vb = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }, apply = () => svg.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
    const fitTo = (b) => { const r = box.getBoundingClientRect(), k = Math.max(b.w / Math.max(r.width, 1), b.h / Math.max(r.height, 1)); vb.w = r.width * k; vb.h = r.height * k; vb.x = b.x - (vb.w - b.w) / 2; vb.y = b.y - (vb.h - b.h) / 2; apply(); };
    const fit = () => fitTo(first || bounds);
    const zoom = (f, cx, cy) => { const r = svg.getBoundingClientRect(); const px = cx == null ? 0.5 : (cx - r.left) / r.width, py = cy == null ? 0.5 : (cy - r.top) / r.height; const nx = vb.x + vb.w * px, ny = vb.y + vb.h * py; vb.w *= f; vb.h *= f; vb.x = nx - vb.w * px; vb.y = ny - vb.h * py; apply(); };
    svg.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); }, { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('.gnode')) return; drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y }; svg.setPointerCapture(e.pointerId); box.classList.add('grabbing'); });
    svg.addEventListener('pointermove', (e) => { if (!drag) return; const r = svg.getBoundingClientRect(); vb.x = drag.vx - (e.clientX - drag.x) * vb.w / r.width; vb.y = drag.vy - (e.clientY - drag.y) * vb.h / r.height; apply(); });
    const end = () => { drag = null; box.classList.remove('grabbing'); }; svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
    requestAnimationFrame(fit);
    return h('div', { class: 'toolbar zoombar' }, h('button', { type: 'button', 'aria-label': 'Zoom avant', text: '＋', onclick: () => zoom(1 / 1.25) }), h('button', { type: 'button', 'aria-label': 'Zoom arrière', text: '－', onclick: () => zoom(1.25) }), h('button', { type: 'button', text: first ? 'Composante principale' : 'Ajuster', onclick: fit }), first ? h('button', { type: 'button', text: 'Tout voir', onclick: () => fitTo(bounds) }) : null, h('small', { class: 'muted', text: 'Molette = zoom, glisser = déplacer, survol/focus = surligner amont/aval, clic/Entrée = ouvrir' }));
  }
  function bezier(a, b) { const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, dx = Math.max(30, (x2 - x1) / 2); return 'M' + x1 + ',' + y1 + ' C' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2; }
  function defs() { return sv('defs', null, sv('marker', { id: 'arrow', markerWidth: 9, markerHeight: 9, refX: 8, refY: 4.5, orient: 'auto', markerUnits: 'userSpaceOnUse' }, sv('path', { d: 'M0,0 L9,4.5 L0,9 z', class: 'arrowhead' }))); }
  // Surbrillance amont/aval générique: reachFn(id,dir)->{set}
  function bindHighlight(svg, nodesEls, edgesEls, up, down) {
    const clear = () => { svg.classList.remove('hl-on'); svg.querySelectorAll('.hl,.hl-self').forEach((e) => e.classList.remove('hl', 'hl-self')); };
    const on = (id) => { clear(); svg.classList.add('hl-on'); const U1 = up(id), D1 = down(id); nodesEls.forEach((el, k) => { if (k === id) el.classList.add('hl-self'); else if (U1[k] || D1[k]) el.classList.add('hl'); });
      const inUp = (x) => x === id || U1[x], inDn = (x) => x === id || D1[x];
      edgesEls.forEach((e) => { if ((inUp(e.from) && inUp(e.to)) || (inDn(e.from) && inDn(e.to))) e.el.classList.add('hl'); }); };
    nodesEls.forEach((el, id) => { el.addEventListener('mouseenter', () => on(id)); el.addEventListener('mouseleave', clear); el.addEventListener('focus', () => on(id)); el.addEventListener('blur', clear); });
  }

  function flowView(st, wf) {
    const root = h('div', null, h('h1', { text: 'Flux de données' }));
    if (!wf) { add(root, h('p', { class: 'muted', text: 'Sélectionnez un workflow dans la liste.' })); return root; }
    const nIn = Object.keys(G.dataflow(wf).inputUsers).length; if (Q.flowInputs == null || Q.flowWf !== wf.id) { Q.flowInputs = nIn <= 12; Q.flowWf = wf.id; }
    const lay = G.layout(wf, 50, { noInputs: !Q.flowInputs }), df = lay.df;
    add(root, h('h2', null, wfLink(wf.id, 'detail', wf.name, 'wflink'), ' ', statusBadge(wf), ' ', h('span', { class: 'badge', text: wf.nodeCount + ' nodes' })));
    if (lay.empty) { add(root, h('label', null, h('input', { type: 'checkbox', checked: Q.flowInputs ? true : null, onchange: (e) => { Q.flowInputs = e.target.checked; U.render(); } }), ' afficher les inputs'), h('p', { class: 'okmsg', text: 'Aucune dépendance détectée entre nodes' + (Q.flowInputs ? ' (ni depuis les inputs)' : ' (inputs masqués)') + ' : aucune référence {{action::…}}' + (Q.flowInputs ? ' ni {{input::…}} vers un node' : '') + '.' })); return root; }
    const bad = analysisBroken(wf);
    add(root, h('label', null, h('input', { type: 'checkbox', id: 'chkInputs', checked: Q.flowInputs ? true : null, onchange: (e) => { Q.flowInputs = e.target.checked; U.render(); } }), ' afficher les inputs du workflow (' + nIn + ')'),
      h('div', { class: 'summary' }, h('span', { class: 'badge', text: lay.nodes.filter((n) => n.kind === 'node').length + ' nodes affichés' }), h('span', { class: 'badge', text: lay.nodes.filter((n) => n.kind === 'input').length + ' inputs' }), h('span', { class: 'badge', text: lay.edges.length + ' arêtes' }),
      lay.hidden ? h('span', { class: 'badge warn', title: 'Nodes sans dépendance ou au-delà de 50 (les mieux connectés sont conservés)', text: lay.hidden + ' node(s) non affichés' }) : null, bad ? h('span', { class: 'badge sev-error', text: bad + ' référence(s) cassée(s) sans arête' }) : null),
      h('div', { class: 'legend muted' }, h('span', { text: '━━ référence {{action::…}} (producteur → consommateur)   ' }), h('span', { text: '╌╌ input du workflow   ' }), h('span', { text: '▭ pointillé = séquence / branche (VRAI/FAUX)' })));
    const svg = sv('svg', { class: 'graph', role: 'img', 'aria-label': 'Graphe des dépendances du workflow ' + wf.name }, defs(), sv('title', null, 'Dépendances de données de ' + wf.name));
    const box = h('div', { class: 'flowbox' }, svg);
    lay.groups.forEach((g) => svg.append(sv('g', { class: 'ggroup' }, sv('rect', { x: g.x, y: g.y, width: g.w, height: g.h, rx: 8 }), sv('text', { x: g.x + 6, y: g.y + 11, class: 'ggroup-label' }, g.label))));
    const edgeEls = lay.edges.map((e) => { const p = sv('path', { d: bezier(lay.pos[e.from], lay.pos[e.to]), class: 'gedge ' + e.kind, 'marker-end': 'url(#arrow)' }, sv('title', null, (e.kind === 'input' ? 'input ' : '') + e.paths.join(', ') + (e.count > 1 ? ' (×' + e.count + ')' : ''))); svg.append(p); return { from: e.from, to: e.to, el: p }; });
    const nodeEls = new Map();
    lay.nodes.forEach((n) => {
      const label = short(n.label, 26), g = sv('g', { class: 'gnode ' + n.kind, tabindex: 0, role: 'link', 'aria-label': (n.kind === 'input' ? 'Input ' : 'Node ') + n.label + (n.tn ? ', ' + n.sub : '') }, sv('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: n.kind === 'input' ? 20 : 6 }),
        sv('text', { x: n.x + 8, y: n.y + 17 }, (n.kind === 'input' ? '⇥ ' : '') + label), sv('text', { x: n.x + 8, y: n.y + 32, class: 'sub' }, n.kind === 'input' ? 'input du workflow' : [short(n.tn.raw.categoryItemName || n.tn.type, 26), sv('tspan', { class: 'tech' }, ' · ' + n.sub)]), sv('title', null, n.label + (n.tn ? ' — ' + n.tn.id : '')));
      const open = () => { if (n.uid) U.setHash({ wf: wf.id, tab: 'detail', node: n.uid }); };
      g.addEventListener('click', open); g.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); }); svg.append(g); nodeEls.set(n.id, g);
    });
    bindHighlight(svg, nodeEls, edgeEls, (id) => G.reach(df, id, 'up'), (id) => G.reach(df, id, 'down'));
    const bounds = { x: -20, y: -30, w: lay.width + 40, h: lay.height + 60 };
    add(root, zoomPan(box, svg, bounds), box);
    if (st.node && nodeEls.get(st.node)) setTimeout(() => nodeEls.get(st.node).dispatchEvent(new Event('mouseenter')), 50);
    const list = h('details', { class: 'sub' }, h('summary', { text: 'Liste textuelle des dépendances (' + lay.edges.length + ')' }));
    list.append(h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['Producteur', '→', 'Consommateur', 'Chemins / paramètre'].map((t) => h('th', { text: t })))),
      h('tbody', null, lay.edges.map((e) => h('tr', null, h('td', { text: lay.pos[e.from].label + (e.kind === 'input' ? ' (input)' : '') }), h('td', { text: '→' }), h('td', null, lay.pos[e.to].uid ? nodeLink(wf.id, lay.pos[e.to].uid, lay.pos[e.to].label) : lay.pos[e.to].label), h('td', { class: 'mono', text: e.paths.join(', ') + (e.count > 1 ? ' (×' + e.count + ')' : '') }))))));
    add(root, list);
    return root;
  }
  function analysisBroken(wf) { return W.analysis.analyzeWorkflow(wf, S.wfs).broken.length; }

  // 'Consomme de' / 'Produit pour' dans la carte du node + 'utilisé par' pour les inputs
  function depsBlock(n, wf) {
    const df = G.dataflow(wf), cons = df.consumes[n.uid] || [], prod = df.produces[n.uid] || [];
    if (!cons.length && !prod.length) return null;
    const nameOf = (id) => (id.slice(0, 3) === 'in:' ? null : wf.uidMap[id]);
    const item = (e, key) => { const id = e[key], tn = nameOf(id); return h('li', null, tn ? h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); U.jumpTo(tn.uid); } }, tn.name || tn.type, h('span', { class: 'tech', text: ' [' + tn.path + ']' })) : h('span', { class: 'pill input static', text: 'input ' + id.slice(3) }), h('small', { class: 'muted', text: ' ' + e.paths.join(', ') + (e.count > 1 ? ' ×' + e.count : '') })); };
    return h('div', { class: 'deps' }, cons.length ? h('div', null, h('b', { text: 'Consomme de (' + cons.length + ') : ' }), h('ul', null, cons.map((e) => item(e, 'from')))) : null, prod.length ? h('div', null, h('b', { text: 'Produit pour (' + prod.length + ') : ' }), h('ul', null, prod.map((e) => item(e, 'to')))) : null,
      h('a', { href: href({ wf: wf.id, tab: 'flow', node: n.uid }), text: 'Voir dans le flux →' }));
  }
  const prevNode = hooks.decorateNode;
  hooks.decorateNode = (d, body, n, wf) => {
    if (prevNode) prevNode(d, body, n, wf);
    const b = depsBlock(n, wf); if (!b) return; const sch = body.querySelector(':scope > details.schemas'); if (sch) body.insertBefore(b, sch); else body.append(b);
  };
  const prevDetail = hooks.decorateDetail;
  hooks.decorateDetail = (root, wf) => {
    if (prevDetail) prevDetail(root, wf);
    const df = G.dataflow(wf);
    root.querySelectorAll('table.inputs tr.inrow').forEach((tr) => {
      const code = tr.querySelector('td code'); if (!code) return; const users = [...new Set(df.inputUsers[code.textContent] || [])], cell = tr.children[3];
      cell.append(users.length ? h('div', { class: 'deps' }, h('b', { text: 'Utilisé par (' + users.length + ') : ' }), users.flatMap((u, i) => [i ? ' · ' : '', h('a', { href: '#', text: wf.uidMap[u].name || wf.uidMap[u].type, onclick: (ev) => { ev.preventDefault(); U.jumpTo(u); } })])) : h('div', { class: 'muted', text: 'non utilisé par un node' }));
    });
    const tb = root.querySelector('.toolbar'); if (tb) tb.append(h('a', { href: href({ wf: wf.id, tab: 'flow' }), text: 'Flux de données', class: 'btnlink' }), h('a', { href: href({ wf: wf.id, tab: 'quality' }), text: 'Qualité', class: 'btnlink' }), h('a', { href: href({ wf: wf.id, tab: 'calls' }), text: 'Appels', class: 'btnlink' }));
  };

  // ================= 3. GRAPHE D'APPELS =================
  let cgCache = { sig: '', cg: null };
  function callGraph() { const sig = signature(); if (cgCache.sig !== sig) cgCache = { sig, cg: G.callGraph(S.wfs) }; return cgCache.cg; }
  function treeList(cg, node, dir) {
    const name = wfNameOf(node.id), li = h('li', null, name ? wfLink(node.id, 'calls', name) : h('span', { class: 'badge warn', title: node.id }, 'hors lot', h('span', { class: 'tech', text: ' ' + short(node.id, 12) })),
      node.cyclic ? h('span', { class: 'badge sev-error', text: '↻ cycle' }) : null, node.truncated ? h('span', { class: 'muted', text: ' …' }) : null, S.wfs.has(node.id) ? [' ', statusBadge(S.wfs.get(node.id))] : null);
    if (node.children.length) li.append(h('ul', { class: 'tree' }, node.children.map((c) => treeList(cg, c, dir)))); return li;
  }
  function callsGlobal(cg) {
    // disposition: composantes empilées; colonnes = profondeur (plus long chemin depuis les racines)
    const layer = {}; cg.involved.forEach((v) => { layer[v] = 0; });
    for (let it = 0; it < 30; it++) { let ch = false; cg.edges.forEach((e) => { if (!e.to || (cg.inCycle[e.from] && cg.inCycle[e.from] === cg.inCycle[e.to])) return; if (layer[e.to] < layer[e.from] + 1) { layer[e.to] = layer[e.from] + 1; ch = true; } }); if (!ch) break; }
    const W0 = 220, H0 = 34, GX = 60, GY = 12, pos = {}; let y0 = 0, firstB = null; const comps = cg.components.slice();
    const outs = cg.edges.filter((e) => !e.inLot).map((e) => e.to); const oc = {}; cg.edges.forEach((e) => { if (!e.inLot && e.to) { (oc[e.from] = oc[e.from] || []).push(e.to); } });
    comps.forEach((c) => {
      const members = c.concat([].concat(...c.map((v) => oc[v] || []))); const uniq = [...new Set(members)], cols = {};
      uniq.forEach((v) => { if (!(v in layer)) layer[v] = 0; const base = S.wfs.has(v) ? layer[v] : Math.max(...cg.edges.filter((e) => e.to === v).map((e) => layer[e.from] + 1)); layer[v] = base; (cols[layer[v]] = cols[layer[v]] || []).push(v); });
      let rows = 0; Object.keys(cols).forEach((k) => { cols[k].sort((a, b) => (wfNameOf(a) || a).localeCompare(wfNameOf(b) || b)); rows = Math.max(rows, cols[k].length); cols[k].forEach((v, r) => { pos[v] = { x: Number(k) * (W0 + GX), y: y0 + r * (H0 + GY), w: W0, h: H0, out: !S.wfs.has(v) }; }); });
      y0 += rows * (H0 + GY) + 26; if (!firstB) { const mx = Math.max(...Object.keys(cols).map(Number)); firstB = { x: -20, y: -20, w: (mx + 1) * (W0 + GX) - GX + 40, h: rows * (H0 + GY) + 20 }; }
    });
    const svg = sv('svg', { class: 'graph', role: 'img', 'aria-label': 'Graphe des appels entre workflows' }, defs(), sv('title', null, 'Appels entre workflows (nested)'));
    const pairs = {}; cg.edges.forEach((e) => { if (e.to && pos[e.from] && pos[e.to]) { const k = e.from + '>' + e.to; pairs[k] = pairs[k] || { from: e.from, to: e.to, n: 0 }; pairs[k].n++; } });
    const edgeEls = Object.values(pairs).map((e) => { const p = sv('path', { d: bezier(pos[e.from], pos[e.to]), class: 'gedge action', 'marker-end': 'url(#arrow)' }, sv('title', null, (wfNameOf(e.from) || e.from) + ' → ' + (wfNameOf(e.to) || e.to) + (e.n > 1 ? ' (×' + e.n + ')' : ''))); svg.append(p); return { from: e.from, to: e.to, el: p }; });
    const nodeEls = new Map(); let maxX = 0;
    Object.keys(pos).forEach((v) => {
      const p = pos[v], w = S.wfs.get(v); maxX = Math.max(maxX, p.x + p.w);
      const g = sv('g', { class: 'gnode node' + (p.out ? ' out' : '') + (w && w.status === 'Inactive' ? ' inactive' : ''), tabindex: 0, role: 'link', 'aria-label': (w ? w.name : 'workflow hors lot ' + v) + (w && w.status === 'Inactive' ? ' (inactif)' : '') },
        sv('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 6 }), sv('text', { x: p.x + 8, y: p.y + 15 }, short(w ? w.name : '(hors lot)', 30)), sv('text', { x: p.x + 8, y: p.y + 28, class: 'sub' }, w ? (w.status === 'Inactive' ? 'inactif · ' : '') + w.nodeCount + ' nodes' : ['hors lot', sv('tspan', { class: 'tech' }, ' · ' + short(v, 22))]), sv('title', null, (w ? w.name : v) + (cg.inCycle[v] ? ' — dans un cycle' : '')));
      const open = () => { if (w) U.setHash({ wf: v, tab: 'calls' }); }; g.addEventListener('click', open); g.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); }); svg.append(g); nodeEls.set(v, g);
    });
    const up = (id) => { const o = {}; G.closure(cg, id, 'up').forEach((x) => { o[x] = 1; }); return o; }, down = (id) => { const o = {}; G.closure(cg, id, 'down').forEach((x) => { o[x] = 1; }); return o; };
    bindHighlight(svg, nodeEls, edgeEls, up, down);
    const box = h('div', { class: 'flowbox' }, svg);
    return { box, bar: zoomPan(box, svg, { x: -20, y: -20, w: maxX + 40, h: Math.max(y0, 60) + 20 }, firstB) };
  }
  function callsView(st, wf) {
    const cg = callGraph(), root = h('div', null, h('h1', { text: 'Appels entre workflows' }));
    add(root, h('div', { class: 'summary' }, h('span', { class: 'badge', text: cg.edges.length + ' appels (' + cg.distinctPairs + ' paires distinctes)' }), h('span', { class: 'badge ' + (cg.outOfLot.length ? 'warn' : ''), text: cg.outOfLot.length + ' hors lot' }), h('span', { class: 'badge ' + (cg.cycles.length ? 'sev-error' : ''), text: cg.cycles.length + ' cycle(s)' }),
      h('span', { class: 'badge', text: cg.roots.length + ' racines' }), h('span', { class: 'badge', text: cg.leaves.length + ' feuilles' }), h('span', { class: 'badge', text: 'profondeur max ' + cg.maxDepth }), h('span', { class: 'badge', text: cg.components.length + ' composante(s)' }), h('span', { class: 'badge', text: cg.orphans.length + ' sans appel ni appelant' })));
    if (wf) {
      const up = G.tree(cg, wf.id, 'up'), down = G.tree(cg, wf.id, 'down'), role = [];
      if (cg.inCycle[wf.id]) role.push('dans un cycle'); if (cg.roots.indexOf(wf.id) >= 0) role.push('racine (appelle sans être appelé)'); if (cg.leaves.indexOf(wf.id) >= 0) role.push('feuille (appelé, n\'appelle pas)'); if (cg.orphans.indexOf(wf.id) >= 0) role.push('orphelin (ni appelant ni appelé)');
      const outs = cg.edges.filter((e) => e.from === wf.id && !e.inLot);
      add(root, h('h2', null, wfLink(wf.id, 'detail', wf.name, 'wflink'), ' ', statusBadge(wf), ' ', role.map((r) => h('span', { class: 'badge', text: r }))),
        h('div', { class: 'cols2' }, h('div', null, h('h3', { text: 'Appelants (récursif, ' + G.closure(cg, wf.id, 'up').length + ')' }), up.children.length ? h('ul', { class: 'tree' }, up.children.map((c) => treeList(cg, c, 'up'))) : h('p', { class: 'muted', text: 'Aucun appelant' })),
          h('div', null, h('h3', { text: 'Appelés (récursif, ' + G.closure(cg, wf.id, 'down').length + ')' }), down.children.length ? h('ul', { class: 'tree' }, down.children.map((c) => treeList(cg, c, 'down'))) : h('p', { class: 'muted', text: 'Aucun appelé' }))),
        outs.length ? h('p', null, h('b', { text: 'Appels hors lot : ' }), outs.map((e) => h('span', null, U.dual(e.to || '(workflowId manquant)', '(workflow hors lot)', 'mono'), ' '))) : null,
        cg.inCycle[wf.id] ? h('p', { class: 'bad', text: 'Cycle : ' + cg.inCycle[wf.id].path.map((i) => wfNameOf(i) || i).join(' → ') }) : null);
      const miss = cg.missingInParent.filter((m) => m.callee === wf.id);
      if (miss.length) add(root, h('p', { class: 'warnnote', text: '⚠ parentWorkflowIds de ce workflow ne liste pas ' + miss.length + ' appelant(s) pourtant présents via nested : ' + miss.map((m) => wfNameOf(m.caller) || m.caller).join(', ') }));
    }
    const g = callsGlobal(cg); add(root, h('h2', { text: 'Vue globale (workflows impliqués dans au moins un appel)' }), g.bar, g.box);
    add(root, h('h2', { text: 'Cohérence nested ↔ parentWorkflowIds' }), h('p', { text: 'Interprétation retenue : parentWorkflowIds d\'un workflow liste ses appelants. ' + (cg.extraInParent.length ? cg.extraInParent.length + ' entrée(s) parentWorkflowIds sans appel nested correspondant.' : 'Toutes les entrées parentWorkflowIds correspondent à un appel nested.') + ' ' + cg.missingInParent.length + ' appel(s) nested absent(s) de parentWorkflowIds du workflow appelé.' }));
    if (cg.missingInParent.length) add(root, h('details', { class: 'sub' }, h('summary', { text: 'Appels nested absents de parentWorkflowIds (' + cg.missingInParent.length + ')' }), h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['Appelant', 'Appelé'].map((t) => h('th', { text: t })))), h('tbody', null, cg.missingInParent.map((m) => h('tr', null, h('td', null, wfLink(m.caller, 'calls', wfNameOf(m.caller) || m.caller)), h('td', null, wfLink(m.callee, 'calls', wfNameOf(m.callee) || m.callee))))))));
    if (cg.extraInParent.length) add(root, h('details', { class: 'sub', open: true }, h('summary', { text: 'parentWorkflowIds sans appel nested (' + cg.extraInParent.length + ')' }), h('ul', null, cg.extraInParent.map((m) => h('li', null, (wfNameOf(m.callee) || m.callee) + ' ← ' + (wfNameOf(m.parent) || m.parent + (m.inLot ? '' : ' (hors lot)')))))));
    if (cg.cycles.length) add(root, h('h3', { text: 'Cycles' }), h('ul', null, cg.cycles.map((c) => h('li', { class: 'bad', text: c.path.map((i) => wfNameOf(i) || i).join(' → ') }))));
    add(root, h('details', { class: 'sub' }, h('summary', { text: 'Racines (' + cg.roots.length + ') / orphelins (' + cg.orphans.length + ')' }), h('div', { class: 'cols2' }, h('ul', null, cg.roots.map((id) => h('li', null, wfLink(id, 'calls', wfNameOf(id) || id)))), h('ul', null, cg.orphans.slice(0, 400).map((id) => h('li', null, wfLink(id, 'calls', wfNameOf(id) || id)))))));
    return root;
  }

  // ================= 4. IMPACT =================
  let actUsage = { sig: '', map: null };
  function usageMap() {
    const sig = signature(); if (actUsage.sig === sig) return actUsage.map; const m = {};
    S.wfs.forEach((w) => w.all.forEach((n) => { if (n.type === 'CustomManagementAction') { const g = n.typeRef.toLowerCase(); (m[g] = m[g] || { n: 0, wfs: new Set() }).n++; m[g].wfs.add(w.id); } }));
    actUsage = { sig, map: m }; return m;
  }
  const ps7Badge = (r) => (r ? h('span', { class: 'badge ' + ({ OK: 'add', Risk: 'mod', Blocker: 'del', Broken: 'del' }[r.Status] || ''), title: r.Issues || '', text: 'PS7: ' + r.Status }) : h('span', { class: 'muted', text: 'PS7: non chargé' }));
  function impactView(st) {
    const root = h('div', null, h('h1', { text: 'Impact' })), cg = callGraph();
    let imp = null;
    if (st.act) imp = G.impactOfAction(S.wfs, S.store, st.act, cg);
    else if (/^(var|fn):/.test(st.imp)) imp = G.impactOfToken(S.wfs, st.imp.slice(0, 3), st.imp.slice(4));
    if (!imp) {
      const um = usageMap(), rows = Object.keys(um).map((g) => ({ g, n: um[g].n, w: um[g].wfs.size, a: S.store.action(g), r: S.store.report(g) })).sort((a, b) => b.n - a.n);
      const q = h('input', { type: 'search', placeholder: 'Filtrer par titre ou GUID…', 'aria-label': 'Filtrer', style: 'max-width:320px' }); const tbody = h('tbody');
      const draw = () => { const f = q.value.toLowerCase(); tbody.replaceChildren(...rows.filter((r) => !f || r.g.includes(f) || (r.a && r.a.title.toLowerCase().includes(f))).slice(0, 300).map((r) => h('tr', null, h('td', null, h('a', { href: href({ tab: 'impact', act: r.g }), text: r.a ? r.a.title : r.g }), r.a ? h('div', { class: 'muted mono tech', text: r.g }) : null), h('td', { text: r.n }), h('td', { text: r.w }), h('td', null, ps7Badge(r.r))))); }; q.addEventListener('input', draw); draw();
      const bag = (kind) => { const g = W.analysis.buildGlobal(S.wfs); return (kind === 'var' ? g.vars : g.fns).slice(0, 40); };
      add(root, h('p', { class: 'muted', text: 'Choisissez une custom action (' + rows.length + ' dans le lot), une variable ou une fonction pour voir les workflows impactés.' }), q,
        h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['Custom action', 'Nodes', 'Workflows', 'PS7'].map((t) => h('th', { text: t })))), tbody),
        h('h3', { text: 'Variables (top 40)' }), h('div', { class: 'chips' }, bag('var').map((r) => h('a', { class: 'chipv', href: href({ tab: 'impact', imp: 'var:' + r.key }), text: r.key + ' ×' + r.count }))),
        h('h3', { text: 'Fonctions' }), h('div', { class: 'chips' }, bag('fn').map((r) => h('a', { class: 'chipv', href: href({ tab: 'impact', imp: 'fn:' + r.key }), text: r.key + ' ×' + r.count }))));
      return root;
    }
    add(root, h('h2', null, imp.title || imp.key, ' ', imp.kind === 'action' ? [imp.state ? h('span', { class: 'badge ' + (imp.state === 'Published' ? 'active' : 'inactive'), text: imp.state }) : h('span', { class: 'badge', text: 'état inconnu' }), ' ', ps7Badge(imp.report), ' ', h('span', { class: 'badge' + (imp.hasScript ? '' : ' warn'), text: imp.hasScript ? 'script chargé' : 'script non chargé' })] : null),
      h('div', { class: 'toolbar' }, h('button', { type: 'button', id: 'btnImpMd', class: 'primary', text: 'Exporter le rapport (Markdown)', onclick: () => W.editUi.download('impact-' + String(imp.title || imp.key).replace(/[^\w.-]+/g, '_').slice(0, 60) + '.md', G.impactMarkdown(imp)) }), h('a', { class: 'btnlink', href: href({ tab: 'impact' }), text: '← Choisir une autre cible' })),
      h('div', { class: 'summary' }, h('span', { class: 'badge', text: imp.uses.length + ' node(s)' }), h('span', { class: 'badge', text: imp.directWfs.length + ' workflow(s) directs' }), h('span', { class: 'badge', text: imp.directWfs.filter((w) => w.status === 'Active').length + ' actif(s)' }), h('span', { class: 'badge ' + (imp.indirect.length ? 'mod' : ''), text: imp.indirect.length + ' indirect(s) via nested' })));
    if (imp.kind === 'action' && imp.action) add(root, h('p', { class: 'muted', text: (imp.action.description || '') + ' — v' + imp.action.version + ' · cible ' + (imp.action.target || '—') + ' · modifiée ' + String(imp.action.lastModified || '').slice(0, 10) + ' par ' + (imp.action.createdBy || '?') }));
    add(root, h('h3', { text: 'Usages directs' }), h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['Workflow', 'Statut', 'Node', 'Chemin'].map((t) => h('th', { class: t === 'Chemin' ? 'tech' : '', text: t })))),
      h('tbody', null, imp.uses.slice(0, 500).map((u) => h('tr', null, h('td', null, wfLink(u.wf.id, 'detail', u.wf.name)), h('td', null, statusBadge(u.wf)), h('td', null, u.node ? nodeLink(u.wf.id, u.node.uid, u.node.name || u.node.type) : '(workflow)'), h('td', { class: 'mono tech', text: u.node ? u.node.path : u.where }))))),
      h('h3', { text: 'Impact transitif (workflows qui appellent ceux-ci via nested)' }),
      imp.indirect.length ? h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['Workflow', 'Statut', 'Chaîne d\'appel'].map((t) => h('th', { text: t })))), h('tbody', null, imp.indirect.map((x) => h('tr', null, h('td', null, wfLink(x.wf.id, 'calls', x.wf.name)), h('td', null, statusBadge(x.wf)), h('td', null, (x.chain || []).map((id, i) => [i ? ' → ' : '', wfLink(id, 'calls', wfNameOf(id) || id)]))))))
        : h('p', { class: 'muted', text: 'Aucun workflow n\'appelle les workflows concernés.' }));
    return root;
  }
  hooks.impactLink = (tab, r) => {
    if (tab === 'custom' || (tab === 'types' && String(r.key).indexOf('CustomManagementAction|') === 0)) return h('a', { href: href({ tab: 'impact', act: r.key.split('|')[1] }), text: 'Impact →' });
    if (tab === 'vars') return h('a', { href: href({ tab: 'impact', imp: 'var:' + r.key.replace(/^\(système\) /, '') }), text: 'Impact →' });
    if (tab === 'fns') return h('a', { href: href({ tab: 'impact', imp: 'fn:' + r.key }), text: 'Impact →' });
    if (tab === 'scripts') return h('a', { href: href({ tab: 'impact', act: r.key }), text: 'Impact →' });
    return null;
  };

  hooks.views = Object.assign(hooks.views || {}, { quality: qualityView, flow: flowView, calls: callsView, impact: impactView });
  W.insight = { ctx, issuesOf, callGraph, Q };
  U.render();
})();
