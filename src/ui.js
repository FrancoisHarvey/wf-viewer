/* ui.js - interface (DOM). Toute valeur issue des JSON passe par textContent: jamais interprétée comme HTML. */
(function () {
  'use strict';
  const { refs, model, analysis, diff, loader } = window.WFV;
  const inputsApi = window.WFV.inputs, natives = window.WFV.natives, scriptsApi = window.WFV.scripts, labels = window.WFV.labels;
  const $ = (id) => document.getElementById(id);
  const I = window.WFV.i18n, T = I.t; // T = traduction (t est souvent utilisé comme variable locale)
  // Langue initiale: hash (#lang=fr|en) > choix mémorisé (wfv.lang) > navigateur (fr* -> français, sinon anglais)
  I.setLang(I.resolve(location.hash, lsGet('wfv.lang'), typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []));

  const hooks = {};
  const S = { demoIds: new Set(), demoStore: null, hl: lsGet('wfv.psHighlight') !== '0', codeViews: new Set(), scriptFind: '', expert: labels.parseExpert(location.hash, lsGet('wfv.expert')), store: scriptsApi.createStore(), wfs: new Map(), order: [], errors: [], callers: new Map(), global: null,
    q: '', status: '', sort: 'name', usage: null, checked: [], hlKey: null,
    cmp: { noise: true, onlyDiff: true, mode: 'side' }, gtab: 'types', gq: '', langInHash: I.hashHasLang(location.hash), statusFn: null };

  // ---------- helpers DOM ----------
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const k of Object.keys(props)) {
      const v = props[k]; if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'data') Object.assign(e.dataset, v);
      else if (k === 'style') e.style.cssText = v; // CSSOM (compatible CSP style-src 'self'), pas d'attribut style en ligne
      else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat(Infinity).forEach((c) => { if (c == null || c === false) return; e.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return e;
  }
  const add = (parent, ...kids) => { kids.flat(Infinity).forEach((k) => { if (k == null || k === false) return; parent.append(k.nodeType ? k : document.createTextNode(String(k))); }); return parent; };
  // Vue de base / expert: .tech = visible seulement en expert; .base-only = seulement en base (CSS globale sur body.expert)
  const dual = (rawText, baseText, cls) => h('span', { class: cls }, h('span', { class: 'tech', text: rawText }), h('span', { class: 'base-only', text: baseText }));
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } }
  const fmtDate = (s) => I.formatDate(s);
  // ---------- custom actions: titre, état, script PowerShell ----------
  const PS7_CLASS = { OK: 'add', Risk: 'mod', Blocker: 'del', Broken: 'del' };
  function ps7Badge(g) {
    const r = S.store.report(g); if (!r) return null;
    return h('span', { class: 'badge ' + (PS7_CLASS[r.Status] || ''), title: T('ui.ps7.title', { issues: r.Issues || T('ui.ps7.noIssues'), fix: r.SuggestedFix ? T('ui.ps7.fix', { v: r.SuggestedFix }) : '' }), text: 'PS7: ' + r.Status });
  }
  const fmtBytes = (b) => (b > 1024 ? (b / 1024).toFixed(1) + ' ' + T('ui.unit.kb') : b + ' ' + T('ui.unit.b'));
  // ---------- affichage de code PowerShell (coloration maison, DOM via createElement/textContent uniquement) ----------
  const PSH = window.WFV.pshighlight;
  function renderLine(parent, line, ranges, last) {
    const toks = ranges && ranges.length ? PSH.markTokens(line.toks, ranges) : line.toks;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'plain' && !t.m) parent.append(document.createTextNode(t.s));
      else { const sp = document.createElement('span'); sp.className = 'ps-' + t.t + (t.m ? ' hit' : ''); sp.textContent = t.s; parent.append(sp); }
    }
    if (!last) parent.append(document.createTextNode('\n'));
  }
  const CHUNK = 400;
  function codeView(text) {
    const n = text.split(/\r\n|\r|\n/).length;
    const gut = h('pre', { class: 'gutter', 'aria-hidden': 'true', text: Array.from({ length: n }, (_, i) => i + 1).join('\n') });
    const code = h('pre', { class: 'code ps', tabindex: 0 }), view = h('div', { class: 'codeview' }, gut, code);
    let gen = 0, lines = null; view.stats = {}; view.done = Promise.resolve();
    view.redraw = () => {
      const my = ++gen, t0 = performance.now(); code.replaceChildren();
      if (!S.hl) { code.textContent = text; view.stats = { mode: 'plain', ms: Math.round(performance.now() - t0) }; view.done = Promise.resolve(); return; }
      if (!lines) { const a = performance.now(); lines = PSH.toLines(text, PSH.tokenize(text)); view.stats.tokenizeMs = Math.round(performance.now() - a); }
      const ranges = PSH.findRanges(text, S.scriptFind || ''); let ri = 0, at = 0;
      const step = () => {
        if (my !== gen) return true;
        const frag = document.createDocumentFragment(), end = Math.min(lines.length, at + CHUNK);
        for (; at < end; at++) {
          const ln = lines[at], ls = ln.start, le = at + 1 < lines.length ? lines[at + 1].start : text.length + 1; while (ri < ranges.length && ranges[ri][1] <= ls) ri++;
          const rs = []; for (let k = ri; k < ranges.length && ranges[k][0] < le; k++) rs.push(ranges[k]);
          renderLine(frag, ln, rs, at === lines.length - 1);
        }
        code.append(frag); return at >= lines.length;
      };
      step();
      view.stats.firstMs = Math.round(performance.now() - t0);
      view.done = new Promise((res) => {
        const loop = () => { if (my !== gen) return res(); if (at >= lines.length) { view.stats.totalMs = Math.round(performance.now() - t0); view.stats.mode = 'highlight'; return res(view.stats); } step(); requestAnimationFrame(loop); };
        if (at >= lines.length) { view.stats.totalMs = view.stats.firstMs; view.stats.mode = 'highlight'; res(view.stats); } else requestAnimationFrame(loop);
      });
    };
    S.codeViews.add(view); view.redraw(); return view;
  }
  function redrawCode() { S.codeViews.forEach((v) => { if (v.isConnected) v.redraw(); else S.codeViews.delete(v); }); }
  function setHl(v) { S.hl = !!v; lsSet('wfv.psHighlight', S.hl ? '1' : '0'); redrawCode(); }
  function hlSwitch() { return h('label', { class: 'hlswitch', title: T('ui.hl.title') }, h('input', { type: 'checkbox', id: 'chkHl', checked: S.hl ? true : null, onchange: (e) => setHl(e.target.checked) }), ' ' + T('ui.hl.label')); }
  function termChip() { return S.scriptFind ? h('span', { class: 'badge' }, T('ui.hl.term', { v: short(S.scriptFind, 30) }) + ' ', h('button', { type: 'button', class: 'linkbtn', 'aria-label': T('ui.hl.remove'), text: '✕', onclick: () => { S.scriptFind = ''; redrawCode(); } })) : null; }
  // extraits (3 premières lignes contenant le terme) pour la recherche dans les scripts
  function excerptsFor(id, term) {
    const sc = S.store.script(id); if (!sc || !term) return null; const low = term.toLowerCase(), box = h('div', { class: 'excerpts' }); let shown = 0, idx = 0;
    const lines = sc.text.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length && shown < 3; i++) {
      if (lines[i].toLowerCase().indexOf(low) < 0) continue;
      const l = lines[i].length > 240 ? lines[i].slice(0, 240) + '…' : lines[i], ln = PSH.toLines(l, PSH.tokenize(l))[0], code = h('code', { class: 'ps excerpt' });
      renderLine(code, ln, PSH.findRanges(l, term), true); box.append(h('div', null, h('span', { class: 'lno', text: (i + 1) + ' ' }), code)); shown++;
    }
    return shown ? box : null;
  }
  function argsTable(n, a, wf) {
    const set = model.nodeSettings(n); const keys = Object.keys(set && typeof set === 'object' ? set : {}); const lk = {}; keys.forEach((k) => { lk[k.toLowerCase()] = k; });
    const pnames = {}; a.params.forEach((p) => { pnames[p.name.toLowerCase()] = p; });
    const rows = a.params.map((p) => {
      const k = lk[p.name.toLowerCase()], used = (a.vars[p.name.toLowerCase()] || 1) - 1;
      return h('tr', null, h('td', null, h('code', { text: '$' + p.name })), h('td', { text: p.type }), h('td', { text: p.mandatory ? T('ui.args.mandatory') : p.default ? T('ui.args.default', { v: p.default }) : T('ui.args.optional') }),
        h('td', null, k !== undefined ? renderValue(set[k], wf) : h('span', { class: p.mandatory ? 'badge warn' : 'muted', text: p.mandatory ? T('ui.args.missingMandatory') : T('ui.args.missing') })), h('td', { text: T('ui.args.uses', { n: used }) }));
    });
    keys.filter((k) => !pnames[k.toLowerCase()]).forEach((k) => {
      const used = a.vars[k.toLowerCase()] || 0;
      rows.push(h('tr', null, h('td', null, h('code', { text: k })), h('td'), h('td', null, h('span', { class: 'badge warn', text: T('ui.args.notInParam') })), h('td', null, renderValue(set[k], wf)), h('td', { text: used ? T('ui.args.referenced', { k: k, n: used }) : T('ui.args.unreferenced') })));
    });
    return h('table', { class: 'grid' }, h('thead', null, h('tr', null, [T('ui.args.h.param'), T('ui.args.h.type'), T('ui.args.h.status'), T('ui.args.h.value'), T('ui.args.h.usage')].map((t) => h('th', { text: t })))), h('tbody', null, rows));
  }
  function customBlock(n, summaryEl, body, wf) {
    const g = n.typeRef.toLowerCase(), act = S.store.action(g), sc = S.store.script(g), fx = S.store.fixes.get(g);
    const titleChip = h('span', { class: 'kind k-custom', title: n.id }, h('span', { 'aria-hidden': 'true', text: '★ ' }), act ? act.title : T('ui.customAction'));
    summaryEl.querySelector('.nname').after(titleChip);
    const badges = [act ? h('span', { class: 'badge ' + (act.state === 'Published' ? 'active' : 'inactive'), text: act.state }) : (S.store.actions.size ? h('span', { class: 'badge warn', title: T('ui.ca.guidMissing'), text: T('ui.ca.unknownTitle') }) : null),
      sc ? null : h('span', { class: 'badge warn', title: T('ui.ca.noPs1', { g: g }), text: T('ui.ca.scriptNotLoaded') }), ps7Badge(g), fx ? h('span', { class: 'badge', title: 'proposed-fixes/' + g + '.ps1', text: T('ui.ca.fixProposed') }) : null];
    badges.forEach((b) => { if (b) summaryEl.append(b); });
    const info = [];
    if (act) info.push([T('ui.ca.action'), act.title + (act.description ? ' — ' + act.description : '')], [T('ui.ca.versionTarget'), 'v' + act.version + ' · ' + (act.target || '—') + (act.usePowerShell7 ? ' · PowerShell 7' : '')], [T('ui.ca.modified'), fmtDate(act.lastModified) + (act.createdBy ? T('ui.ca.by', { v: act.createdBy }) : '')]);
    const rep = S.store.report(g); if (rep && rep.WorkflowCount) info.push([T('ui.ca.ps7Report'), T('ui.ca.usedIn', { n: rep.WorkflowCount })]);
    if (info.length) body.append(h('table', { class: 'kv' }, h('tbody', null, info.map((r) => h('tr', null, h('th', { text: r[0] }), h('td', { text: r[1] }))))));
    body.append(h('div', null, h('a', { href: '#tab=impact&act=' + g, text: T('ui.ca.impactLink') })));
    if (!sc) return;
    const a = S.store.analysis(g);
    const set = model.nodeSettings(n), keys = Object.keys(set && typeof set === 'object' ? set : {}).map((k) => k.toLowerCase());
    const missing = a.params.filter((p) => p.mandatory && keys.indexOf(p.name.toLowerCase()) < 0).length, extraK = keys.filter((k) => !a.params.some((p) => p.name.toLowerCase() === k)).length;
    const panel = h('details', { class: 'sub scriptpanel' }, h('summary', null, T('ui.ca.scriptSummary', { lines: a.lines, size: fmtBytes(a.bytes), params: a.params.length }),
      missing ? h('span', { class: 'badge warn', text: T('ui.ca.missingMandatory', { n: missing }) }) : null, extraK ? h('span', { class: 'badge warn', text: T('ui.ca.extraSettings', { n: extraK }) }) : null));
    panel.addEventListener('toggle', () => {
      if (!panel.open || panel.dataset.done) return; panel.dataset.done = '1';
      let showFix = false; const holder = h('div');
      const draw = () => holder.replaceChildren(codeView(showFix ? fx.text : sc.text));
      const bar = h('div', { class: 'toolbar' }, h('button', { type: 'button', text: T('ui.ca.copy'), onclick: (e) => { const t = showFix ? fx.text : sc.text; navigator.clipboard && navigator.clipboard.writeText(t).then(() => { e.target.textContent = T('ui.ca.copied'); setTimeout(() => { e.target.textContent = T('ui.ca.copy'); }, 1500); }).catch(() => {}); } }),
        fx ? h('button', { type: 'button', text: T('ui.ca.viewFix'), 'aria-pressed': 'false', onclick: (e) => { showFix = !showFix; e.target.setAttribute('aria-pressed', String(showFix)); e.target.textContent = showFix ? T('ui.ca.viewOriginal') : T('ui.ca.viewFix'); draw(); } }) : null,
        hlSwitch(), termChip(), h('small', { class: 'muted tech', text: sc.name }));
      panel.append(h('h3', { text: T('ui.ca.argsVsParam') }), argsTable(n, a, wf),
        h('button', { type: 'button', class: 'base-only', id: 'btnShowScript', 'aria-pressed': 'false', text: T('ui.ca.viewScript'), onclick: (e) => { const on = panel.classList.toggle('showscript'); e.target.setAttribute('aria-pressed', String(on)); e.target.textContent = on ? T('ui.ca.hideScript') : T('ui.ca.viewScript'); } }),
        h('div', { class: 'scriptcode tech' }, bar, holder)); draw();
    });
    body.append(panel);
  }

  const getWf = (id) => (id && id.indexOf('orig:') === 0 ? (S.origs && S.origs.get(id.slice(5))) : S.wfs.get(id));
  const wfName = (id) => (S.wfs.has(id) ? S.wfs.get(id).name : null);
  const short = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
  const cur = () => S.wfs.get(hashState().wf);

  // ---------- hash ----------
  function hashState() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    return { wf: p.get('wf') || '', cmp: p.get('cmp') || '', tab: p.get('tab') || 'detail', node: p.get('node') || '', act: p.get('act') || '', imp: p.get('imp') || '', x: p.get('x') || '' };
  }
  const hashLang = () => { const l = new URLSearchParams(location.hash.replace(/^#/, '')).get('lang'); return l === 'fr' || l === 'en' ? l : ''; };
  function setHash(patch, replace) {
    const st = Object.assign(hashState(), { node: '' }, patch);
    const p = new URLSearchParams(); ['wf', 'cmp', 'tab', 'node', 'act', 'imp'].forEach((k) => { if (st[k]) p.set(k, st[k]); }); if (S.expert) p.set('x', '1'); if (S.langInHash) p.set('lang', I.getLang());
    const hs = '#' + p.toString();
    if (hs === location.hash) { render(); return; }
    if (replace) { history.replaceState(null, '', hs); render(); } else location.hash = hs; // hashchange -> render
  }
  function setExpert(v, announce) {
    v = !!v; S.expert = v; document.body.classList.toggle('expert', v); const c = $('chkExpert'); if (c) c.checked = v; lsSet('wfv.expert', v ? '1' : '0');
    const nh = labels.withExpertHash(location.hash, v); if (nh !== location.hash.replace(/^$/, '#')) history.replaceState(null, '', nh);
    if (announce) setStatus(() => T(v ? 'ui.expert.on' : 'ui.expert.off'));
    if (hashState().tab === 'compare') render();
  }
  document.body.classList.toggle('expert', S.expert);
  window.addEventListener('hashchange', () => { const p = new URLSearchParams(location.hash.replace(/^#/, '')); const hl = hashLang(); if (hl) { S.langInHash = true; if (hl !== I.getLang()) I.setLang(hl); } if (p.has('x')) { const v = p.get('x') === '1'; if (v !== S.expert) { S.expert = v; document.body.classList.toggle('expert', v); const c = $('chkExpert'); if (c) c.checked = v; lsSet('wfv.expert', v ? '1' : '0'); } } render(); });
  const link = (patch, text, cls) => h('a', { href: '#' + new URLSearchParams(Object.assign({ tab: 'detail' }, patch)).toString(), class: cls, text });

  // ---------- chargement ----------
  // setStatus(texte | fonction): une fonction est réévaluée au changement de langue.
  function setStatus(t) { S.statusFn = typeof t === 'function' ? t : null; $('status').textContent = typeof t === 'function' ? t() : t; }
  function updateErrBtn() { const be = $('btnErrors'); be.hidden = !S.errors.length; be.textContent = T('ui.errBtn', { n: S.errors.length }); }
  async function ingest(items, opts) {
    opts = opts || {};
    setStatus(() => T('ui.status.analyzing')); await new Promise((r) => setTimeout(r, 0));
    const readErrors = items.filter((i) => i.readError).map((i) => ({ file: i.name, error: T('ui.err.read', { v: i.readError }) }));
    const t0 = performance.now();
    const ok = items.filter((i) => !i.readError);
    const other = ok.filter((i) => { const k = scriptsApi.classifyFile(i.name); return k && k !== 'workflow'; });
    const wfItems = ok.filter((i) => scriptsApi.classifyFile(i.name) === 'workflow');
    let extra = () => '', storeAdded = null;
    if (other.length) {
      const snap = opts.demo ? { scripts: new Set(S.store.scripts.keys()), fixes: new Set(S.store.fixes.keys()), actions: new Set(S.store.actions.keys()), ps7: new Set(S.store.ps7.keys()) } : null;
      const sm = S.store.ingest(other); S.global = null; if (snap) storeAdded = Object.fromEntries(Object.keys(snap).map((k) => [k, [...S.store[k].keys()].filter((x) => !snap[k].has(x))])); $('qScrWrap').hidden = !S.store.scripts.size;
      const ec = { scripts: S.store.scripts.size, actions: S.store.actions.size, ps7: S.store.ps7.size, errs: sm.errors.length }; extra = () => T('ui.status.extra', ec) + (ec.errs ? T('ui.status.extraErr', { n: ec.errs }) : '');
      readErrors.push(...sm.errors.map((e) => ({ file: e.file, error: e.error })));
    }
    if (!wfItems.length && other.length && S.wfs.size) { // chargement de scripts seul: on garde les workflows
      S.errors = S.errors.concat(readErrors); setStatus(() => T('ui.status.scriptsLoaded') + extra()); updateErrBtn(); render(); return;
    }
    if (!opts.merge && wfItems.length && S.sessions && [...S.sessions.values()].some((x) => x.wf.dirty) && !window.confirm(T('ui.confirm.discard'))) { setStatus(() => T('ui.status.cancelled')); return; }
    if (!opts.merge && wfItems.length && S.sessions) { S.sessions.clear(); S.origs.clear(); S.editing.clear(); }
    const r = model.loadTexts(wfItems);
    if (!opts.merge) { S.demoIds = new Set(); S.demoStore = null; } const bn = $('demoBanner'); if (bn) bn.hidden = !S.demoIds.size; // un chargement réel non fusionné efface le marquage démo
    S.wfs = opts.merge ? new Map([...S.wfs, ...r.workflows]) : r.workflows; S.errors = (opts.merge ? S.errors : []).concat(readErrors, r.errors);
    S.callers = model.buildCallers(S.wfs); S.global = null; S.usage = null; S.checked = [];
    S.order = [...S.wfs.values()];
    const ms = Math.round(performance.now() - t0), nW = S.wfs.size, nF = wfItems.length; setStatus(() => T('ui.status.loaded', { w: nW, f: nF, ms: ms }) + extra());
    updateErrBtn();
    const st = hashState(); if (st.wf && !S.wfs.has(st.wf)) location.hash = '';
    renderList(); render();
    return { ids: [...r.workflows.keys()], storeAdded };
  }
  const progress = (d, n) => setStatus(() => T('ui.status.reading', { d: d, n: n }));
  async function guarded(fn) { try { await ingest(await fn()); } catch (e) { if (e && e.name !== 'AbortError') setStatus(() => T('ui.status.error', { v: e.message })); } }
  $('btnOpen').onclick = () => {
    if (loader.hasDirectoryPicker) guarded(() => loader.pickDirectory(progress)).catch(() => {});
    else $('inDir').click();
  };
  $('btnOpenFiles').onclick = () => $('inFiles').click();
  $('inDir').onchange = (e) => guarded(() => loader.fromFileList(e.target.files, progress));
  $('inFiles').onchange = (e) => guarded(() => loader.fromFileList(e.target.files, progress));
  let dragN = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragN++; $('dropOverlay').hidden = false; });
  window.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('dropOverlay').hidden = true; } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); dragN = 0; $('dropOverlay').hidden = true; guarded(() => loader.fromDataTransfer(e.dataTransfer, progress)); });
  $('btnErrors').onclick = () => {
    $('dlgBody').replaceChildren(h('h2', { text: T('ui.errDlg.title') }), h('table', { class: 'grid' }, h('tr', null, h('th', { text: T('ui.errDlg.file') }), h('th', { text: T('ui.errDlg.error') })),
      S.errors.map((e) => h('tr', null, h('td', { text: e.file, class: 'mono' }), h('td', { text: e.error })))));
    $('dlg').showModal();
  };
  $('btnBack').onclick = () => history.back(); $('btnFwd').onclick = () => history.forward();

  // ---------- liste ----------
  function filtered() {
    const q = S.q.trim().toLowerCase();
    let l = S.order.filter((w) => (!S.status || w.status === S.status) && (!S.usage || S.usage.wfIds.has(w.id)) &&
      (!q || w.name.toLowerCase().includes(q) || w.id.toLowerCase().includes(q) || model.searchText(w).includes(q) || (S.qScr && scriptsApi.customIds(w).some((g) => S.store.lower(g).includes(q)))));
    const cmp = { name: (a, b) => I.compare(a.name, b.name), nodes: (a, b) => b.nodeCount - a.nodeCount || a.name.localeCompare(b.name),
      updated: (a, b) => String(b.updated || '').localeCompare(String(a.updated || '')) }[S.sort];
    return l.sort(cmp);
  }
  let shownIds = [];
  function renderList() {
    const l = filtered(); shownIds = l.map((w) => w.id); const sel = hashState().wf;
    $('count').textContent = T('ui.list.count', { n: l.length, total: S.order.length });
    $('list').replaceChildren(...l.map((w) => {
      const cb = h('input', { type: 'checkbox', 'aria-label': T('ui.list.checkCompare', { name: w.name }), checked: S.checked.includes(w.id) ? true : null,
        onclick: (e) => { e.stopPropagation(); toggleCheck(w.id, e.target.checked); } });
      return h('li', { role: 'option', 'aria-selected': w.id === sel ? 'true' : 'false', data: { id: w.id }, onclick: () => setHash({ wf: w.id, tab: hashState().tab === 'compare' ? 'detail' : hashState().tab }) },
        cb, h('div', null, h('div', { class: 'nm', text: w.name }),
          h('div', { class: 'meta muted' }, h('span', { text: T('n.nodes', { n: w.nodeCount }) + ' · ' + fmtDate(w.updated) + ' ' }), w.status === 'Inactive' ? h('span', { class: 'badge inactive', text: 'Inactive' }) : null, w.dirty ? h('span', { class: 'badge mod', title: T('ui.list.dirtyTitle'), text: T('ui.list.dirty') }) : null, S.demoIds.has(w.id) ? h('span', { class: 'badge demo', title: T('ui.list.demoTitle'), text: T('ui.list.demo') }) : null, hooks.listBadge ? hooks.listBadge(w) : null)));
    }));
    const chip = $('usageChip');
    chip.hidden = !S.usage; chip.replaceChildren();
    if (S.usage) chip.append(h('span', { text: T('ui.list.usage', { v: short(S.usage.label, 40) }) }), h('button', { type: 'button', text: '✕', 'aria-label': T('ui.list.removeUsage'), onclick: () => { S.usage = null; renderList(); } }));
    $('btnCompare').disabled = S.checked.length !== 2;
    const s = $('list').querySelector('[aria-selected=true]'); if (s) s.scrollIntoView({ block: 'nearest' });
  }
  function toggleCheck(id, on) {
    S.checked = S.checked.filter((x) => x !== id); if (on) S.checked.push(id); if (S.checked.length > 2) S.checked.shift();
    renderList();
  }
  $('btnCompare').onclick = () => setHash({ wf: S.checked[0], cmp: S.checked[1], tab: 'compare' });
  $('q').oninput = (e) => { S.q = e.target.value; renderList(); };
  $('qScr').onchange = (e) => { S.qScr = e.target.checked; renderList(); };
  $('fStatus').onchange = (e) => { S.status = e.target.value; renderList(); };
  $('fSort').onchange = (e) => { S.sort = e.target.value; renderList(); };
  document.addEventListener('keydown', (e) => {
    const t = e.target, tag = t.tagName;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return; // géré nativement par le navigateur (hash)
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey && !e.ctrlKey && (t === document.body || t === document || t.id === 'list' || (t.closest && t.closest('#list')) || t.id === 'q')) {
      if (!shownIds.length) return; e.preventDefault();
      const i = shownIds.indexOf(hashState().wf), n = Math.max(0, Math.min(shownIds.length - 1, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)));
      setHash({ wf: shownIds[n], tab: hashState().tab === 'compare' ? 'detail' : hashState().tab }, true);
    }
  });
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => setHash({ tab: b.dataset.tab }); });

  // ---------- rendu de valeurs ----------
  function highlightKey(key, container) {
    S.hlKey = S.hlKey === key ? null : key;
    document.querySelectorAll('.pill.hl').forEach((p) => p.classList.remove('hl'));
    if (S.hlKey) document.querySelectorAll('.pill').forEach((p) => { if (p.dataset.key === S.hlKey) p.classList.add('hl'); });
  }
  function jumpTo(uid) {
    const el = document.getElementById('n-' + uid); if (!el) return;
    for (let p = el; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function pill(t, wf, interactive) {
    const fn = t.fns.length ? ' ƒ' + t.fns.map((f) => f.name).join(',') : '';
    if (t.malformed) return h('span', { class: 'pill bad static', title: T('ui.pill.malformed', { reason: t.reason }), text: '⚠ ' + t.raw });
    if (t.kind === 'action') {
      const target = wf && wf.uidMap[t.uid];
      const label = (target ? (target.name || target.type) : 'uid?' + short(String(t.uid), 8)) + ' › ' + (t.path || '') + fn;
      return h('button', { type: 'button', class: 'pill action' + (target ? '' : ' bad') + (interactive ? '' : ' static'), data: { key: 'ac:' + t.uid }, title: t.raw + (target ? '' : T('ui.pill.uidMissing')),
        onclick: interactive ? () => (target ? jumpTo(t.uid) : null) : null, text: label });
    }
    if (t.kind === 'input') {
      return h('button', { type: 'button', class: 'pill input' + (t.system ? ' sys' : '') + (interactive ? '' : ' static'), data: { key: 'in:' + t.param }, title: t.raw + (t.system ? T('ui.pill.system') : ''),
        onclick: interactive ? () => highlightKey('in:' + t.param) : null, text: (t.system ? 'sys.' : '') + t.param + fn });
    }
    return h('span', { class: 'pill static', title: t.raw, text: t.raw });
  }
  function strNode(s, wf, interactive) {
    const segs = refs.splitText(s);
    const frag = segs.map((g) => (g.token ? pill(g.token, wf, interactive) : document.createTextNode(g.text)));
    const long = s.length > 140 || s.indexOf('\n') >= 0;
    return h('span', { class: long ? 'longstr' : 'str' }, frag);
  }
  function renderValue(v, wf, interactive) {
    if (interactive === undefined) interactive = true;
    if (v === null || v === undefined) return h('span', { class: 'muted', text: 'null' });
    if (typeof v === 'string') return v === '' ? h('span', { class: 'muted', text: '""' }) : strNode(v, wf, interactive);
    if (typeof v !== 'object') return h('code', { text: String(v) });
    if (v.__parseError) return h('div', null, h('span', { class: 'badge warn', text: T('ui.json.invalid', { v: v.__parseError }) }), h('pre', { class: 'json', text: String(v.raw) }));
    const keys = Array.isArray(v) ? v.map((_, i) => i) : Object.keys(v);
    if (!keys.length) return h('span', { class: 'muted', text: Array.isArray(v) ? '[]' : '{}' });
    return h('table', { class: 'kv' }, h('tbody', null, keys.map((k) => h('tr', null, h('th', { text: Array.isArray(v) ? '[' + k + ']' : k }), h('td', null, renderValue(v[k], wf, interactive))))));
  }
  const hasCond = (f) => f && typeof f === 'object' && ((f.conditions && f.conditions.length) || (f.conditionGroups && f.conditionGroups.length));
  function renderCond(c, wf) {
    if (c && typeof c === 'object' && 'property' in c) return h('span', { class: 'cond' }, renderValue(c.property, wf), h('span', { class: 'op', title: c.operator, text: natives.opLabel(c.operator) }), (c.operator === 'IsEmpty' || c.operator === 'IsNotEmpty') ? null : renderValue(c.value, wf), c.type ? h('small', { class: 'muted', text: ' (' + c.type + ')' }) : null);
    return h('span', { class: 'cond' }, renderValue(c, wf));
  }
  function renderFilter(f, wf) {
    if (!hasCond(f)) return h('span', { class: 'muted', text: T('ui.filter.none') });
    const rest = Object.assign({}, f); delete rest.conditions; delete rest.conditionGroups;
    return h('div', null,
      (f.conditions || []).map((c) => renderCond(c, wf)),
      (f.conditionGroups || []).map((g, i) => h('div', { class: 'cond' }, h('b', { text: T('ui.filter.group', { n: i + 1, op: g.operator ? ' [' + g.operator + ']' : '' }) }), (g.conditions || []).map((c) => h('div', { style: 'margin-left:14px' }, renderCond(c, wf))))),
      Object.keys(rest).length ? renderValue(rest, wf) : null);
  }

  // ---------- détail ----------
  function typeLabel(n) {
    if (natives.isNative(n)) { const nd = natives.describe(n, { wfName }); if (nd) return nd.icon + ' ' + nd.label; }
    return n.raw.categoryItemName ? n.raw.categoryItemName : n.id;
  }
  function nativeFields(nd, wf) {
    const val = (f) => {
      if (f.kind === 'bool') return h('span', { class: 'chipv yn ' + (f.value === true || f.value === 'true' ? 'y' : 'n'), text: (f.value === true || f.value === 'true' ? '✓ ' : '✗ ') + f.text });
      if (f.kind === 'duration') return h('span', { text: f.text });
      if (f.kind === 'list') return h('span', { class: 'chips' }, f.value.map((x) => (typeof x === 'string' ? h('span', { class: 'chipv' }, strNode(x, wf, true)) : renderValue(x, wf))));
      if (f.kind === 'workflow') return typeof f.value === 'string' && S.wfs.has(f.value) ? link({ wf: f.value }, '→ ' + S.wfs.get(f.value).name, 'wflink') : h('span', null, h('span', { class: 'badge warn', text: T('ui.outOfBatch') }), ' ', h('code', { text: String(f.value) }));
      if (f.kind === 'html') return h('div', null, h('div', { class: 'longstr', title: T('ui.node.htmlPreview') }, strNode(f.text, wf, true)),
        h('details', { class: 'rawj tech' }, h('summary', { text: T('ui.node.htmlRaw') }), h('pre', { class: 'json', text: String(f.value) })));
      return renderValue(f.value, wf);
    };
    return h('table', { class: 'kv' }, h('tbody', null, nd.fields.map((f) => h('tr', null, h('th', { title: f.key, text: f.label }), h('td', null, val(f))))));
  }
  function renderNode(n, wf) {
    const set = model.nodeSettings(n); const tid = model.nestedTarget(n);
    const d = h('details', { class: 'node kind-' + n.kind, id: 'n-' + n.uid, open: true });
    const nested = n.kind === 'nested' ? (tid ? (S.wfs.has(tid) ? link({ wf: tid }, '→ ' + S.wfs.get(tid).name, 'wflink') : h('span', { class: 'badge warn', title: tid, text: T('ui.node.outOfBatchId', { v: short(tid, 13) }) })) : h('span', { class: 'badge warn', text: T('ui.node.workflowIdMissing') })) : null;
    d.append(h('summary', null, h('span', { class: 'badge mono', text: n.path.replace(/^(actions|catchActions)/, (m) => (m === 'actions' ? 'A' : 'C')) }),
      h('span', { class: 'nname', text: n.name || T('ui.node.unnamed') }), h('span', { class: 'type tech', title: n.id, text: typeLabel(n) + (n.raw.providerName ? ' · ' + n.raw.providerName : '') }), nested,
      n.raw.forceSkip ? h('span', { class: 'badge warn', text: 'forceSkip' }) : null,
      hasCond(n.raw.filter) && n.kind !== 'if' ? h('span', { class: 'badge', text: T('ui.node.filter') }) : null,
      n.raw.customDescription ? h('span', { class: 'muted', text: '— ' + n.raw.customDescription }) : null));
    const body = h('div', { class: 'body' });
    const nd = natives.describe(n, { wfName });
    if (nd) {
      const sum = d.querySelector('summary'); sum.querySelector('.nname').after(h('span', { class: 'kind k-native', title: n.id }, h('span', { 'aria-hidden': 'true', text: nd.icon + ' ' }), nd.label));
      sum.querySelector('.type').textContent = n.raw.providerName || '';
      body.append(h('div', { class: 'nsum' }, strNode(nd.summary, wf, true), nd.src === 'name' ? h('span', { class: 'badge warn', title: T('ui.node.inferredTitle'), text: T('ui.node.inferred') }) : null));
      nd.notes.forEach((t) => body.append(h('div', { class: 'muted', text: 'ⓘ ' + t })));
    }
    if (n.type === 'CustomManagementAction') customBlock(n, d.querySelector('summary'), body, wf);
    body.append(h('div', { class: 'type mono tech', text: 'uid ' + n.uid + ' · id ' + n.id + (n.raw.parentUid ? ' · parentUid ' + n.raw.parentUid : '') }));
    if (hasCond(n.raw.filter)) body.append(h('h3', { text: T(n.kind === 'if' ? 'ui.node.condition' : 'ui.node.runFilter') }), renderFilter(n.raw.filter, wf));
    if (nd && nd.fields.length) body.append(h('h3', { text: T('ui.node.params') }), nativeFields(nd, wf));
    if (nd && nd.outputs.length) body.append(h('div', { class: 'outs' }, h('b', { text: T('ui.node.outputs') }), h('span', { class: 'chips' }, nd.outputs.slice(0, 14).map((o) => h('span', { class: 'chipv', text: o })), nd.outputs.length > 14 ? h('span', { class: 'muted', text: '… +' + (nd.outputs.length - 14) }) : null)));
    if (nd && set && Object.keys(set).length) body.append(h('details', { class: 'rawj tech raw-settings' }, h('summary', { text: T('ui.node.rawSettings') }), renderValue(set, wf)));
    else if (set && Object.keys(set).length) body.append(h('h3', { text: T('ui.node.settings') }), renderValue(set, wf));
    if (n.kind === 'sequence') body.append(h('details', { class: 'sub', open: true }, h('summary', { text: T('ui.node.sequence', { n: n.children.length }) }), n.children.map((c) => renderNode(c, wf))));
    else n.children.forEach((c) => body.append(renderNode(c, wf)));
    if (n.kind === 'if' || n.trueBranch.length || n.falseBranch.length) {
      body.append(h('details', { class: 'sub', open: true }, h('summary', { text: T('ui.node.trueBranch', { n: n.trueBranch.length }) }), n.trueBranch.map((c) => renderNode(c, wf))),
        h('details', { class: 'sub', open: true }, h('summary', { text: T('ui.node.falseBranch', { n: n.falseBranch.length }) }), n.falseBranch.map((c) => renderNode(c, wf))));
    }
    const sch = h('details', { class: 'schemas tech' }, h('summary', { text: T('ui.node.schemas') }));
    sch.addEventListener('toggle', () => {
      if (!sch.open || sch.dataset.done) return; sch.dataset.done = '1';
      const s = model.nodeSchemas(n);
      Object.keys(s).forEach((k) => sch.append(h('div', { class: 'type', text: k }), h('pre', { class: 'json', text: s[k] == null ? 'null' : JSON.stringify(s[k], null, 2) })));
    });
    body.append(sch); d.append(body);
    if (hooks.decorateNode) hooks.decorateNode(d, body, n, wf);
    return d;
  }

  const ENUM_MAX = 12;
  function chipList(vals, max) {
    const mk = (v) => h('span', { class: 'chipv', text: String(v) });
    const box = h('span', { class: 'chips' }, vals.slice(0, max).map(mk));
    if (vals.length > max) {
      const label = T('ui.chips.all', { n: vals.length });
      const more = h('button', { type: 'button', class: 'linkbtn', text: label, 'aria-expanded': 'false' });
      more.onclick = () => {
        const open = more.getAttribute('aria-expanded') === 'true';
        box.replaceChildren(...(open ? vals.slice(0, max) : vals).map(mk), more);
        more.setAttribute('aria-expanded', String(!open)); more.textContent = open ? label : T('ui.chips.less'); box.classList.toggle('scroll', !open);
      };
      box.append(more);
    }
    return box;
  }
  function ruleText(r) {
    const o = [];
    if (r.specifyLength) o.push(T('ui.rule.length', { n: r.minLength })); else if (r.minLength) o.push(T('ui.rule.min', { n: r.minLength }));
    if (r.requireUppercase) o.push(T('ui.rule.upper'));
    if (r.requireLowercase) o.push(T('ui.rule.lower'));
    if (r.requiredigits || r.requireNumbers) o.push(T('ui.rule.digit'));
    if (r.requireSpecialChars) o.push(T('ui.rule.special'));
    if (r.isEditable) o.push(T('ui.rule.editable'));
    return o;
  }
  function jsonDetails(label, getValue) {
    const d = h('details', { class: 'rawj tech' }, h('summary', { text: label }));
    d.addEventListener('toggle', () => { if (d.open && !d.dataset.done) { d.dataset.done = '1'; d.append(h('pre', { class: 'json', text: JSON.stringify(getValue(), null, 2) })); } });
    return d;
  }
  function inputRow(i, wf) {
    const isYes = (v) => /^(oui|yes)$/i.test(v);
    const det = h('div', { class: 'idet' });
    if (i.kind === 'yesno') det.append(h('span', { class: 'chips' }, i.enumValues.map((v) => h('span', { class: 'chipv yn ' + (isYes(v) ? 'y' : 'n'), text: (isYes(v) ? '✓ ' : '✗ ') + v }))));
    else if (i.enumValues) det.append(chipList(i.enumValues, ENUM_MAX));
    if (i.enumBad) det.append(h('span', { class: 'badge warn', text: T('ui.in.enumBad') }));
    if (i.kind === 'boolean') det.append(h('span', { class: 'chips' }, h('span', { class: 'chipv yn y', text: T('ui.in.true') }), h('span', { class: 'chipv yn n', text: T('ui.in.false') })));
    if (i.customList) det.append(h('div', null, T('ui.in.customList') + ' ', h('code', { text: i.customList })));
    if (i.dataSource) det.append(h('div', null, T('ui.in.source') + ' ', h('code', { text: i.dataSource }), ' ', h('span', { class: 'badge', text: T(i.filterable ? 'ui.in.filterable' : 'ui.in.notFilterable') })));
    if (i.targetLabel) det.append(h('div', null, T('ui.in.target') + ' ', h('span', { class: 'badge', text: i.targetLabel })));
    if (i.kind === 'datetime') det.append(h('div', { class: 'muted', text: [i.format, i.ui && String(i.ui)].filter(Boolean).join(' · ') }));
    if (i.kind === 'password') {
      det.append(h('div', null, h('span', { class: 'mask', 'aria-label': T('ui.in.masked'), text: '••••••••' }), ' ', h('span', { class: 'badge', text: T('ui.in.protected') })));
      if (i.passwordRules) det.append(h('div', null, T('ui.in.rules') + ' ', ruleText(i.passwordRules).map((t) => h('span', { class: 'chipv', text: t }))));
    }
    if (i.hasDefault) det.append(h('div', null, T('ui.in.default') + ' ', typeof i.defaultValue === 'string' ? h('code', { text: JSON.stringify(i.defaultValue) }) : renderValue(i.defaultValue, wf, false)));
    const desc = h('div', null, i.description === '' ? null : typeof i.description === 'string' ? h('div', { text: i.description }) : renderValue(i.description, wf, false),
      i.tooltip ? h('div', { class: 'muted', title: 'x-cv-tooltip' }, 'ⓘ ', i.tooltip) : null);
    return h('tr', { class: 'inrow', data: { kind: i.kind } },
      h('td', null, h('code', { text: i.name }), i.title && i.title !== i.name ? h('div', { class: 'muted', text: i.title }) : null),
      h('td', null, h('span', { class: 'kind k-' + i.kind }, h('span', { 'aria-hidden': 'true', text: i.icon + ' ' }), i.kindLabel), ' ', h('small', { class: 'muted', text: i.type })),
      h('td', null, i.required ? h('span', { class: 'badge req', title: T('ui.in.requiredTitle'), text: T('ui.in.required') }) : h('span', { class: 'muted', text: T('ui.in.optional') })),
      h('td', null, det, jsonDetails('JSON', () => i.raw)), h('td', null, desc));
  }
  function inputsTable(wf) {
    const r = inputsApi.parseInputs(wf);
    if (!r.ok) return h('div', null, h('span', { class: 'badge warn', text: T('ui.in.unreadable', { v: r.error }) }), renderValue(r.raw, wf, false));
    if (!r.inputs.length) return h('span', { class: 'muted', text: T('ui.in.none') });
    const counts = {}; r.inputs.forEach((i) => { counts[i.kind] = (counts[i.kind] || 0) + 1; });
    const summ = h('div', { class: 'chips' }, Object.keys(counts).map((k) => h('span', { class: 'kind k-' + k }, h('span', { 'aria-hidden': 'true', text: inputsApi.KINDS[k].icon + ' ' }), inputsApi.KINDS[k].label + ' × ' + counts[k])));
    return h('div', null, summ, h('table', { class: 'grid inputs' }, h('thead', null, h('tr', null, [T('ui.in.h.name'), T('ui.in.h.type'), T('ui.in.h.required'), T('ui.in.h.values'), T('ui.in.h.desc')].map((t) => h('th', { text: t })))),
      h('tbody', null, r.inputs.map((i) => inputRow(i, wf)))),
    r.requiredMissing && r.requiredMissing.length ? h('div', { class: 'badge warn', text: T('ui.in.requiredNoProp', { v: r.requiredMissing.join(', ') }) }) : null,
    jsonDetails(T('ui.in.rawSchema'), () => r.raw));
  }
  function callersBlock(wf) {
    const m = S.callers.get(wf.id); const rows = m ? [...m.values()] : [];
    const outs = []; wf.all.forEach((n) => { const t = model.nestedTarget(n); if (t) outs.push({ n, t }); });
    return h('div', null, h('h3', { text: T('ui.callers.by', { n: rows.length }) }),
      rows.length ? h('ul', null, rows.map((r) => h('li', null, S.wfs.has(r.id) ? link({ wf: r.id }, S.wfs.get(r.id).name, 'wflink') : h('span', { class: 'badge warn', text: T('ui.callers.out', { v: r.id }) }), h('small', { class: 'muted', text: T('ui.callers.via', { v: r.via.join(' + ') }) })))) : h('span', { class: 'muted', text: T('ui.callers.nobody') }),
      h('h3', { text: T('ui.callers.calls', { n: outs.length }) }),
      outs.length ? h('ul', null, outs.map((o) => h('li', null, S.wfs.has(o.t) ? link({ wf: o.t }, S.wfs.get(o.t).name, 'wflink') : h('span', { class: 'badge warn', text: T('ui.callers.out', { v: o.t }) }), h('small', { class: 'muted', text: T('ui.callers.from') }), h('a', { href: '#', text: o.n.name || o.n.path, onclick: (e) => { e.preventDefault(); jumpTo(o.n.uid); } })))) : h('span', { class: 'muted', text: T('ui.callers.none') }));
  }

  function renderDetail(wf) {
    const d = wf.data, root = h('div', { class: 'head' });
    const dupOf = wf.duplicatedOfId && S.wfs.has(wf.duplicatedOfId) ? S.wfs.get(wf.duplicatedOfId) : null;
    const dups = S.order.filter((w) => w.duplicatedOfId === wf.id);
    const sel = h('select', { 'aria-label': T('ui.det.compareWith'), onchange: (e) => { if (e.target.value) setHash({ wf: wf.id, cmp: e.target.value, tab: 'compare' }); } }, h('option', { value: '', text: T('ui.det.compareWithEllipsis') }),
      [dupOf].concat(dups).filter(Boolean).map((w) => h('option', { value: w.id, text: '★ ' + w.name + (w === dupOf ? T('ui.det.original') : T('ui.det.copy')) })),
      S.order.filter((w) => w !== wf).sort((a, b) => I.compare(a.name, b.name)).map((w) => h('option', { value: w.id, text: w.name })));
    add(root, h('div', { class: 'title' }, h('h1', { text: wf.name }), h('span', { class: 'badge ' + (wf.status === 'Inactive' ? 'inactive' : 'active'), text: wf.status || '?' }), h('span', { class: 'badge', text: T('n.nodes', { n: wf.nodeCount }) })),
      h('div', { class: 'toolbar' }, h('code', { class: 'tech', text: wf.id }), h('button', { type: 'button', text: T('ui.det.copyGuid'), onclick: () => navigator.clipboard && navigator.clipboard.writeText(wf.id).catch(() => {}) }), sel,
        h('button', { type: 'button', text: T('ui.det.collapseAll'), onclick: () => setAll(false) }), h('button', { type: 'button', text: T('ui.det.expandAll'), onclick: () => setAll(true) }),
        h('button', { type: 'button', text: T('ui.det.analysis'), onclick: () => setHash({ tab: 'analysis' }) })),
      wf.description ? h('p', { text: wf.description }) : null,
      h('table', { class: 'kv' }, h('tbody', null,
        [[T('ui.det.created'), fmtDate(d.createdDate) + (d.createdBy ? T('ui.ca.by', { v: d.createdBy }) : '')], [T('ui.det.modified'), fmtDate(d.updatedDate) + (d.updatedBy ? T('ui.ca.by', { v: d.updatedBy }) : '')], [T('ui.det.file'), wf.file], ['Event', d.eventName], [T('ui.det.timeout'), d.executionTimeoutSeconds], [T('ui.det.dupOf'), d.duplicatedOfId]]
          .filter((r) => r[1] !== undefined && r[1] !== null && r[1] !== '').map((r) => h('tr', null, h('th', { text: r[0] }), h('td', null, r[0] === T('ui.det.dupOf') && S.wfs.has(r[1]) ? link({ wf: r[1] }, S.wfs.get(r[1]).name, 'wflink') : String(r[1])))))));
    const tg = d.targetsConfig && Array.isArray(d.targetsConfig.targets) ? d.targetsConfig.targets.map(model.parseJsonField) : [];
    add(root, h('h2', { text: T('ui.det.targets') }), ...(tg.length ? tg.map((t) => renderValue(t, wf)) : [h('span', { class: 'muted', text: T('ui.det.noneF') })]),
      h('h2', { text: T('ui.det.wfFilter') }), renderFilter(d.filter, wf), h('h2', { text: 'Inputs' }), inputsTable(wf), callersBlock(wf));
    add(root, h('h2', { text: T('ui.det.actions', { n: wf.main.length }) }), h('div', { id: 'tree' }, wf.main.map((n) => renderNode(n, wf))));
    if (wf.catchList.length) add(root, h('h2', { text: 'catchActions (' + wf.catchList.length + ')' }), h('div', null, wf.catchList.map((n) => renderNode(n, wf))));
    if (hooks.decorateDetail) hooks.decorateDetail(root, wf);
    return root;
  }
  function setAll(open) { document.querySelectorAll('#main details.node, #main details.sub').forEach((d) => { d.open = open; }); }

  // ---------- comparaison ----------
  function fmtVal(v) { if (v === undefined) return '—'; if (typeof v === 'string') return v; return JSON.stringify(v, null, 1); }
  const cmpWf = { A: null, B: null };
  function sideLabel(n, d, wf) {
    if (!n) return h('div', { class: 'dside empty', text: '—' });
    return h('div', { class: 'dside' }, h('span', { class: 'nname', text: n.name || T('ui.node.unnamed') }), ' ',
      d ? h('span', { class: 'kind k-native', title: n.id }, h('span', { 'aria-hidden': 'true', text: d.icon + ' ' }), d.label) : h('span', { class: 'type', text: typeLabel(n) }), ' ', h('span', { class: 'type tech', text: n.path }),
      d ? h('div', { class: 'dsum' }, strNode(d.rawSummary, wf, false), d.src === 'name' ? h('span', { class: 'badge warn', title: T('ui.node.inferredShort'), text: T('ui.node.inferred') }) : null) : null);
  }
  function chgRow(c) {
    return h('div', { class: 'dchg' }, h('div', { class: 'path' }, dual(c.path || '(node)', labels.readablePath(c.path))),
      h('div', { class: 'before', text: c.kind === 'added' ? '—' : short(fmtVal(c.before), 4000) }), h('div', { class: 'after', text: c.kind === 'removed' ? '—' : short(fmtVal(c.after), 4000) }));
  }
  function renderDiffItems(items, onlyDiff) {
    const frag = document.createDocumentFragment();
    items.forEach((it) => {
      if (onlyDiff && !it.hasDiff) return;
      const row = h('div', { class: 'drow ' + it.status }, h('div', { class: 'dhead' }, sideLabel(it.a, it.descA, cmpWf.A), sideLabel(it.b, it.descB, cmpWf.B)));
      if (it.status === 'modified' && it.a && it.b && it.a.name !== it.b.name) row.append(h('div', { class: 'dchanges' }, h('span', { class: 'badge mod', text: T('ui.cmp.renamed') })));
      if (it.summaryChanged) row.append(h('div', { class: 'dchanges' }, h('div', { class: 'dchg' }, h('div', { class: 'path', text: T('ui.cmp.summary') }),
        h('div', { class: 'before' }, strNode(it.descA.rawSummary, cmpWf.A, false)), h('div', { class: 'after' }, strNode(it.descB.rawSummary, cmpWf.B, false)))));
      if (it.changes.length) row.append(h('details', { class: 'dchanges', open: true }, h('summary', { class: 'muted', text: T('ui.cmp.fieldByField', { n: it.changes.length }) }), it.changes.map(chgRow)));
      [['children', T('ui.cmp.seq')], ['trueBranch', T('ui.cmp.true')], ['falseBranch', T('ui.cmp.false')]].forEach(([k, lbl]) => {
        if (it.sub[k] && (!onlyDiff || it.sub[k].some((x) => x.hasDiff))) row.append(h('div', { class: 'dsub' }, h('small', { class: 'muted', text: lbl }), renderDiffItems(it.sub[k], onlyDiff)));
      });
      frag.append(row);
    });
    return frag;
  }

  // ---- diff typé des inputs ----
  const DIFF_CHIPS_MAX = 30;
  function diffChips(added, removed) {
    const all = removed.map((v) => ['n', v]).concat(added.map((v) => ['y', v]));
    const mk = ([t, v]) => h('span', { class: 'chipv yn ' + t, text: (t === 'y' ? '+ ' : '− ') + String(v) });
    const box = h('span', { class: 'chips' }, all.slice(0, DIFF_CHIPS_MAX).map(mk));
    if (all.length > DIFF_CHIPS_MAX) {
      const label = T('ui.chips.all', { n: all.length }); const more = h('button', { type: 'button', class: 'linkbtn', text: label, 'aria-expanded': 'false' });
      more.onclick = () => { const open = more.getAttribute('aria-expanded') === 'true'; box.replaceChildren(...(open ? all.slice(0, DIFF_CHIPS_MAX) : all).map(mk), more); more.setAttribute('aria-expanded', String(!open)); more.textContent = open ? label : T('ui.chips.less'); box.classList.toggle('scroll', !open); };
      box.append(more);
    }
    return box;
  }
  function inputBrief(i) {
    const bits = [h('span', { class: 'kind k-' + i.kind }, h('span', { 'aria-hidden': 'true', text: i.icon + ' ' }), i.kindLabel), ' ', i.required ? h('span', { class: 'badge req', text: T('ui.in.required') }) : h('span', { class: 'muted', text: T('ui.in.optional') })];
    if (i.enumValues) bits.push(' ', i.kind === 'yesno' ? h('span', { class: 'muted', text: i.enumValues.join(' / ') }) : h('span', { class: 'muted', text: T('ui.cmp.nValues', { n: i.enumValues.length }) }));
    if (i.customList) bits.push(' ', h('code', { text: T('ui.cmp.list', { v: short(i.customList, 13) }) }));
    if (i.dataSource) bits.push(' ', h('code', { text: T('ui.cmp.source', { v: i.dataSource }) }), i.filterable ? ' 🔍' : '');
    if (i.targetLabel) bits.push(' ', h('span', { class: 'badge', text: i.targetLabel }));
    if (i.description && typeof i.description === 'string') bits.push(h('div', { class: 'muted', text: i.description }));
    return h('div', null, bits);
  }
  function inputChangeVal(c, v) {
    if (v === undefined || v === null || v === '') return h('span', { class: 'muted', text: '—' });
    if (c.field === 'required' || c.field === 'filterable' || c.field === 'protected') return h('span', { text: v ? T('ui.cmp.yes') : T('ui.cmp.no') });
    return h('span', { text: typeof v === 'string' ? v : JSON.stringify(v) });
  }
  function renderInputsDiff(r) {
    const d = r.inputs, sm = d.summary;
    const root = h('div', { class: 'inputsdiff' }, h('div', { class: 'summary' }, h('span', { class: 'badge add', text: T('ui.cmp.added', { n: sm.added }) }), h('span', { class: 'badge del', text: T('ui.cmp.removed', { n: sm.removed }) }), h('span', { class: 'badge mod', text: T('ui.cmp.modified', { n: sm.modified }) }), h('span', { class: 'badge', text: T('ui.cmp.same', { n: sm.same }) })));
    d.items.forEach((it) => {
      if (S.cmp.onlyDiff && it.status === 'same') return;
      const label = T('ui.cmp.st.' + it.status);
      const row = h('div', { class: 'drow ' + it.status }, h('div', { class: 'dhead' },
        h('div', { class: 'dside' }, h('code', { text: it.name }), ' ', h('span', { class: 'badge ' + (it.status === 'added' ? 'add' : it.status === 'removed' ? 'del' : it.status === 'modified' ? 'mod' : ''), text: label })),
        h('div', { class: 'dside' }, it.b ? inputBrief(it.b) : it.a ? inputBrief(it.a) : null)));
      if (it.changes.length) row.append(h('div', { class: 'dchanges' }, it.changes.map((c) => {
        if (c.field === 'enum') return h('div', { class: 'dchg enumchg' }, h('div', { class: 'path', text: c.label }), h('div', { class: 'both' }, (c.added.length || c.removed.length) ? diffChips(c.added, c.removed) : h('span', { class: 'muted', text: T('ui.cmp.valuesChange', { a: c.before ? c.before.length : 0, b: c.after ? c.after.length : 0 }) })));
        return h('div', { class: 'dchg' }, h('div', { class: 'path', text: c.label }), h('div', { class: 'before' }, inputChangeVal(c, c.before)), h('div', { class: 'after' }, inputChangeVal(c, c.after)));
      })));
      add(root, row);
    });
    if (r.rawInputs.length) add(root, h('details', { class: 'dchanges tech' }, h('summary', { class: 'muted', text: T('ui.cmp.rawInputs', { n: r.rawInputs.length }) }), r.rawInputs.map(chgRow)));
    return root;
  }
  function renderCompare() {
    const st = hashState(), a = getWf(st.wf), b = getWf(st.cmp);
    const opts = [...S.order].sort((x, y) => I.compare(x.name, y.name));
    const mk = (val, key) => h('select', { 'aria-label': T('ui.cmp.workflowAB', { k: key }), onchange: (e) => setHash(key === 'A' ? { wf: e.target.value, tab: 'compare' } : { cmp: e.target.value, tab: 'compare' }) }, h('option', { value: '', text: T('ui.cmp.choose', { k: key }) }), opts.map((w) => h('option', { value: w.id, selected: w.id === val ? true : null, text: w.name })));
    const chk = (label, key, inv) => h('label', null, h('input', { type: 'checkbox', checked: S.cmp[key] ? true : null, onchange: (e) => { S.cmp[key] = e.target.checked; render(); } }), ' ' + label);
    const root = h('div', { class: S.cmp.mode === 'side' ? '' : 'unified' }, h('h1', { text: T('ui.cmp.title') }),
      h('div', { class: 'toolbar' }, 'A: ', mk(st.wf, 'A'), h('button', { type: 'button', text: '⇄', title: T('ui.cmp.swap'), onclick: () => setHash({ wf: st.cmp, cmp: st.wf, tab: 'compare' }) }), 'B: ', mk(st.cmp, 'B')),
      h('div', { class: 'toolbar' }, S.expert ? chk(T('ui.cmp.hideNoise'), 'noise') : h('span', { class: 'muted', id: 'noiseForced', text: T('ui.cmp.noiseForced') }), chk(T('ui.cmp.onlyDiff'), 'onlyDiff'),
        h('select', { 'aria-label': T('ui.cmp.mode'), onchange: (e) => { S.cmp.mode = e.target.value; render(); } }, h('option', { value: 'side', text: T('ui.cmp.side'), selected: S.cmp.mode === 'side' ? true : null }), h('option', { value: 'unified', text: T('ui.cmp.unified'), selected: S.cmp.mode === 'unified' ? true : null }))));
    if (!a || !b) { add(root, h('p', { class: 'muted', text: T('ui.cmp.choose2') })); return root; }
    const t0 = performance.now(); cmpWf.A = a; cmpWf.B = b; const r = diff.diffWorkflows(a, b, { noise: S.expert ? S.cmp.noise : true, wfName });
    const sm = r.summary;
    add(root, h('div', { class: 'dhead' }, h('div', null, h('b', { text: 'A: ' }), link({ wf: a.id }, a.name, 'wflink'), ' ', h('small', { class: 'muted', text: T('n.nodes', { n: a.nodeCount }) })), h('div', null, h('b', { text: 'B: ' }), link({ wf: b.id }, b.name, 'wflink'), ' ', h('small', { class: 'muted', text: T('n.nodes', { n: b.nodeCount }) }))),
      h('div', { class: 'summary' }, h('span', { class: 'badge add', text: T('ui.cmp.added', { n: sm.added }) }), h('span', { class: 'badge del', text: T('ui.cmp.removed', { n: sm.removed }) }), h('span', { class: 'badge mod', text: T('ui.cmp.modified', { n: sm.modified }) }), h('span', { class: 'badge', text: T('ui.cmp.same', { n: sm.same }) }), h('span', { class: 'badge', text: T('ui.cmp.headerDiffs', { n: r.header.length }) }), ...(r.inputs ? [h('span', { class: 'badge', text: T('ui.cmp.inputsChanged', { n: r.inputs.changed }) })] : []), h('small', { class: 'muted', text: Math.round(performance.now() - t0) + ' ms' })),
      h('p', { class: 'muted', text: T('ui.cmp.note') }),
      h('h2', { text: T('ui.cmp.header') }),
      r.header.length ? h('div', { class: 'drow modified' }, h('div', { class: 'dchanges' }, r.header.map((c) => h('div', { class: 'dchg' }, h('div', { class: 'path' }, dual(c.path, labels.readablePath(c.path))), h('div', { class: 'before', text: c.kind === 'added' ? '—' : short(fmtVal(c.before), 4000) }), h('div', { class: 'after', text: c.kind === 'removed' ? '—' : short(fmtVal(c.after), 4000) }))))) : h('p', { class: 'muted', text: T('ui.cmp.noHeaderDiff') }),
      ...(r.inputs ? [h('h2', { text: T('ui.cmp.inputs') }), renderInputsDiff(r)] : []),
      h('h2', { text: T('ui.cmp.actions') }), renderDiffItems(r.main, S.cmp.onlyDiff));
    if (r.catchItems.length) add(root, h('h2', { text: 'catchActions' }), renderDiffItems(r.catchItems, S.cmp.onlyDiff));
    if (S.cmp.onlyDiff && !r.total) add(root, h('p', { text: T('ui.cmp.noDiff') }));
    return root;
  }

  // ---------- analyse ----------
  function where(o, wf) {
    return o.node ? h('a', { href: '#' + new URLSearchParams({ wf: wf.id, tab: 'detail', node: o.node.uid }).toString() }, o.node.name || o.node.path, h('span', { class: 'tech', text: ' [' + o.node.path + '] ' + o.where })) : h('span', null, T('ui.wfLevel'), h('span', { class: 'tech', text: ' ' + o.where }));
  }
  function renderAnalysis(wf) {
    const a = analysis.analyzeWorkflow(wf, S.wfs); const root = h('div', null, h('h1', null, T('ui.an.title') + ' ', link({ wf: wf.id }, wf.name, 'wflink')), h('p', { class: 'muted', text: T('ui.an.tokens', { t: a.tokenCount, n: T('n.nodes', { n: wf.nodeCount }) }) }));
    const sect = (title, count, body) => add(root, h('h2', { text: title + ' (' + count + ')' }), body);
    const usesTable = (obj, kind) => { const keys = Object.keys(obj).sort((x, y) => obj[y].count - obj[x].count); return keys.length ? h('table', { class: 'grid' }, h('thead', null, h('tr', null, [T('ui.an.h.name'), T('ui.an.h.uses'), T('ui.an.h.places')].map((t) => h('th', { text: t })))),
      h('tbody', null, keys.map((k) => h('tr', null, h('td', null, h('code', { text: k })), h('td', { text: obj[k].count }), h('td', null, obj[k].uses.slice(0, 12).map((u, i) => h('div', null, where(u, wf))), obj[k].uses.length > 12 ? h('small', { class: 'muted', text: '… +' + (obj[k].uses.length - 12) }) : null))))) : h('span', { class: 'muted', text: T('ui.an.noneM') }); };
    sect(T('ui.an.vars'), Object.keys(a.variables).length, usesTable(a.variables));
    sect(T('ui.an.fns'), Object.keys(a.fns).length, usesTable(a.fns));
    sect(T('ui.an.broken'), a.broken.length, a.broken.length ? h('table', { class: 'grid' }, a.broken.map((b) => h('tr', null, h('td', { class: 'bad', text: b.reason }), h('td', null, where(b, wf)), h('td', null, dual(b.token.raw, labels.humanize(b.token.raw, wf), 'mono'))))) : h('span', { class: 'muted', text: T('ui.an.noneF') }));
    sect(T('ui.an.malformed'), a.malformed.length, a.malformed.length ? h('table', { class: 'grid' }, a.malformed.map((b) => h('tr', null, h('td', { text: b.token.reason }), h('td', null, where(b, wf)), h('td', null, h('code', { text: b.token.raw }))))) : h('span', { class: 'muted', text: T('ui.an.noneM') }));
    sect(T('ui.an.nestedOut'), a.nestedOut.length, a.nestedOut.length ? h('ul', null, a.nestedOut.map((o) => h('li', null, h('a', { href: '#' + new URLSearchParams({ wf: wf.id, tab: 'detail', node: o.node.uid }).toString(), text: o.node.name }), ' → ', h('code', { text: o.targetId || T('ui.an.wfIdMissing') })))) : h('span', { class: 'muted', text: T('ui.an.noneM') }));
    const withOut = a.unreferenced.filter((u) => u.hasOutputSchema);
    sect(T('ui.an.unref'), a.unreferenced.length, h('div', null, h('p', { class: 'muted', text: T('ui.an.unrefNote', { n: withOut.length }) }),
      h('table', { class: 'grid' }, h('thead', null, h('tr', null, [T('ui.an.h.node'), T('ui.an.h.type'), T('ui.an.h.outSchema')].map((t) => h('th', { text: t })))), h('tbody', null,
        withOut.concat(a.unreferenced.filter((u) => !u.hasOutputSchema)).map((u) => h('tr', null, h('td', null, h('a', { href: '#' + new URLSearchParams({ wf: wf.id, tab: 'detail', node: u.node.uid }).toString(), text: (u.node.name || '?') + ' [' + u.node.path + ']' })), h('td', { text: typeLabel(u.node) }), h('td', { text: T(u.hasOutputSchema ? 'ui.cmp.yesPlain' : 'ui.cmp.noPlain') })))))));
    return root;
  }

  // ---------- global ----------
  function renderGlobal() {
    if (!S.global) S.global = analysis.buildGlobal(S.wfs);
    const g = S.global; const tabs = { types: T('ui.gl.types'), custom: T('ui.gl.custom'), vars: T('ui.gl.vars'), fns: T('ui.gl.fns'), nested: T('ui.gl.nested'), scripts: T('ui.gl.scripts') };
    const titleOf = (t) => { const a = S.store.action(t.key.split('|')[1] || ''); return a ? a.title : t.label; };
    const decorate = (t) => (t.key.startsWith('CustomManagementAction|') ? Object.assign({}, t, { label: titleOf(t), key: t.key }) : t);
    g.custom = g.types.filter((t) => t.key.startsWith('CustomManagementAction|')).map(decorate);
    g.types = g.types.map(decorate);
    if (S.gtab === 'scripts') {
      const byId = {}; g.custom.forEach((t) => { byId[t.key.split('|')[1].toLowerCase()] = t; });
      g.scripts = scriptsApi.searchScripts(S.store, S.gq).map((r) => { const t = byId[r.id]; const a = S.store.action(r.id); return { key: r.id, label: (a ? a.title : r.id) + (t ? '' : T('ui.gl.unused')), count: r.count, wfIds: t ? t.wfIds : new Set(), excerpt: () => excerptsFor(r.id, S.gq) }; });
      S.scriptFind = S.gq;
    } else g.scripts = [];
    const rows = g[S.gtab].filter((r) => S.gtab === 'scripts' || !S.gq || (r.key + ' ' + r.label).toLowerCase().includes(S.gq.toLowerCase()));
    const root = h('div', null, h('h1', { text: T('ui.gl.title') }),
      h('div', { class: 'toolbar' }, Object.keys(tabs).map((k) => h('button', { type: 'button', 'aria-pressed': S.gtab === k ? 'true' : 'false', class: S.gtab === k ? 'primary' : '', text: tabs[k] + ' (' + g[k].length + ')', onclick: () => { S.gtab = k; render(); } })),
        h('input', { type: 'search', value: S.gq, placeholder: S.gtab === 'scripts' ? T('ui.gl.scriptSearch') : T('ui.gl.filter'), 'aria-label': T('ui.gl.filterLabel'), style: 'max-width:240px', oninput: (e) => { S.gq = e.target.value; clearTimeout(S._gt); S._gt = setTimeout(() => { render(); const i = document.querySelector('#main input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200); } })),
      h('p', { class: 'muted', text: S.gtab === 'scripts' ? (S.store.scripts.size ? T('ui.gl.scriptsHelp', { n: S.store.scripts.size }) : T('ui.gl.noScripts')) : T('ui.gl.help') }),
      h('table', { class: 'grid' }, h('thead', null, h('tr', null, [T('ui.gl.h.name'), T('ui.gl.h.uses'), T('ui.gl.h.wfs'), T('ui.gl.h.impact')].map((t) => h('th', { text: t })))),
        h('tbody', null, rows.slice(0, 600).map((r, ri) => h('tr', { class: 'click', tabindex: 0, 'aria-label': T('ui.gl.filterUsing', { v: r.label }), onclick: () => pick(r), onkeydown: (e) => { if (e.key === 'Enter') pick(r); } },
          h('td', null, r.label !== r.key ? h('div', { text: r.label }) : null, h('code', { class: r.label !== r.key ? 'tech' : '', title: r.key, text: r.key }), r.excerpt && ri < 60 ? r.excerpt() : null), h('td', { text: r.count }), h('td', { text: r.wfIds.size }), h('td', null, hooks.impactLink ? hooks.impactLink(S.gtab, r) : null)))))
    );
    if (rows.length > 600) add(root, h('p', { class: 'muted', text: T('ui.gl.more', { n: rows.length - 600 }) }));
    function pick(r) { const tk = S.gtab, rl = r.label; S.usage = { get label() { return T('ui.gl.' + tk) + ': ' + rl; }, wfIds: r.wfIds }; renderList(); const nw = r.wfIds.size; setStatus(() => T('ui.gl.using', { n: nw, v: short(rl, 50) })); }
    return root;
  }

  // ---------- routeur ----------
  function render() {
    if (S.expert && !new URLSearchParams(location.hash.replace(/^#/, '')).has('x')) history.replaceState(null, '', labels.withExpertHash(location.hash, true)); // garde x=1 dans l'URL partageable
    const st = hashState(), main = $('main');
    document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === st.tab)));
    document.querySelectorAll('#list li').forEach((li) => li.setAttribute('aria-selected', String(li.dataset.id === st.wf)));
    if (!S.wfs.size) return;
    const wf = S.wfs.get(st.wf);
    let view;
    try {
      if (hooks.views && hooks.views[st.tab]) view = hooks.views[st.tab](st, wf);
      else if (st.tab === 'global') view = renderGlobal();
      else if (st.tab === 'compare') view = renderCompare();
      else if (!wf) view = h('div', { id: 'welcome' }, h('h1', { text: T('ui.welcome.loaded', { n: S.wfs.size }) }), h('p', { text: T('ui.welcome.select') }));
      else view = st.tab === 'analysis' ? renderAnalysis(wf) : renderDetail(wf);
    } catch (e) { view = h('pre', { class: 'json', text: T('ui.renderError', { v: e && e.stack || e }) }); console.error(e); }
    const keepScroll = main.dataset.view === st.tab + ':' + st.wf;
    const top = main.scrollTop; main.replaceChildren(view); main.dataset.view = st.tab + ':' + st.wf;
    main.scrollTop = keepScroll ? top : 0;
    S.hlKey = null;
    if (st.node && st.tab === 'detail') setTimeout(() => jumpTo(st.node), 0);
    document.title = (wf && st.tab !== 'global' ? wf.name + ' – ' : '') + T('app.title');
  }
  // ---------- langue: textes statiques (data-i18n*), sélecteur, re-rendu sans rechargement ----------
  // Re-rendu seulement (vues, liste, statut, textes fixes): la sélection, l'onglet, le défilement, le mode expert, les filtres, les workflows chargés,
  // les sessions d'édition (modifications + historique undo/redo) ne sont pas touchés. Les dialogues d'édition (modaux, avec saisie en cours) ne sont pas reconstruits.
  function applyStatic() {
    document.documentElement.lang = I.getLang();
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = T(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => el.setAttribute('title', T(el.dataset.i18nTitle)));
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', T(el.dataset.i18nAria)));
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => el.setAttribute('placeholder', T(el.dataset.i18nPh)));
    const sel = $('selLang'); if (sel) sel.value = I.getLang();
    if (!S.wfs.size) document.title = T('app.title');
  }
  function refreshLang() {
    applyStatic(); S.global = null;
    if (S.statusFn) $('status').textContent = S.statusFn();
    const main = $('main'), open = [...main.querySelectorAll('details')].map((d) => d.open);
    if (S.wfs.size) { renderList(); updateErrBtn(); }
    render();
    const now = [...main.querySelectorAll('details')]; if (now.length === open.length) now.forEach((d, i) => { if (d.open !== open[i]) d.open = open[i]; });
  }
  function userSetLang(l) {
    if (l !== 'fr' && l !== 'en') return;
    S.langInHash = true; lsSet('wfv.lang', l); const nh = I.withLangHash(location.hash, l); if (nh !== location.hash) history.replaceState(null, '', nh);
    I.setLang(l); setStatus(() => T('ui.lang.status'));
  }
  I.onChange(refreshLang);
  const selLang = $('selLang'); if (selLang) selLang.addEventListener('change', (e) => userSetLang(e.target.value));
  applyStatic();
  render();
  const chk = $('chkExpert'); if (chk) { chk.checked = S.expert; chk.addEventListener('change', (e) => setExpert(e.target.checked, true)); }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'e' || e.ctrlKey || e.metaKey || e.altKey) return; const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    e.preventDefault(); setExpert(!S.expert, true);
  });
  const ver = $('appVersion'); if (ver) ver.textContent = window.WFV.version || '';
  window.WFV.app = { S, render, ingest, setExpert, setLang: userSetLang, refreshLang };
  window.WFV.ui = { ingest, codeView, setHl, dual, labels, setExpert, S, h, hooks, render, renderList, setHash, hashState, setStatus, strNode, renderValue, link, short, fmtDate, jumpTo, add, shownIds: () => shownIds, getWf, typeLabel, renderFilter }; // utile pour les tests navigateur
})();
