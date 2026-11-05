/* demo-ui.js - chargement des données de démonstration (embarquées dans src/demo-data.js), bandeau, quitter la démo, visite guidée.
   Les données passent par le chemin de chargement existant (loader.fromFileList puis ingest): mêmes validations, mêmes index, texte brut conservé.
   Aucune requête réseau, textContent uniquement, aucun style en ligne. */
(function () {
  'use strict';
  const W = window.WFV, U = W.ui, EU = W.editUi, DL = W.demoLogic, loader = W.loader;
  const { S, h } = U;
  const I = W.i18n, T = I.t;
  const $ = (id) => document.getElementById(id);
  const welcomeClone = $('welcome') ? $('welcome').cloneNode(true) : null;
  const ids = DL.findIds(W.demo ? W.demo.files : []);

  function mkFile(f) { // File avec chemin relatif (comme un sélecteur de dossier): passe par loader.fromFileList
    const file = new File([f.text], f.name.split('/').pop(), { type: 'text/plain' });
    Object.defineProperty(file, 'webkitRelativePath', { value: 'demo/' + f.name });
    return file;
  }
  function updateBanner() {
    const b = $('demoBanner'); if (!b) return; const n = S.demoIds.size; b.hidden = !n;
    if (n) $('demoCount').textContent = T('demo.count', { n: n });
  }
  async function load(merge) {
    if (!W.demo || !W.demo.files.length) { U.setStatus(() => T('demo.unavailable')); return; }
    const items = await loader.fromFileList(W.demo.files.map(mkFile));
    const res = await U.ingest(items, { merge: !!merge, demo: true });
    if (!res) return; // chargement annulé (modifications non exportées conservées)
    S.demoIds = new Set(merge ? [...S.demoIds, ...res.ids] : res.ids); S.demoStore = res.storeAdded || S.demoStore; updateBanner(); U.renderList();
    if (ids.onb && S.wfs.has(ids.onb)) U.setHash({ wf: ids.onb, tab: 'detail' });
    const nl = res.ids.length; U.setStatus(() => T('demo.loaded', { n: nl }));
    const t = $('btnTour'); if (t) t.focus({ preventScroll: true });
  }
  function onDemoClick() {
    const real = [...S.wfs.keys()];
    if (!DL.needsConfirm(real, S.demoIds)) { load(false); return; }
    EU.dialog(T('demo.dlg.title'), h('div', null, h('p', { text: T('demo.dlg.real', { n: real.filter((i) => !S.demoIds.has(i)).length }) }), h('p', { class: 'muted', text: T('demo.dlg.note') })),
      [{ text: T('demo.dlg.replace'), id: 'btnDemoReplace', onclick: (close) => { close(); load(false); } }, { text: T('demo.dlg.add'), primary: true, id: 'btnDemoAdd', onclick: (close) => { close(); load(true); } }]);
  }
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-demo-load]'); if (b) { e.preventDefault(); onDemoClick(); } });

  // ---------- quitter la démo ----------
  function removeDemo() {
    S.demoIds.forEach((id) => { S.wfs.delete(id); if (S.sessions) { S.sessions.delete(id); S.origs.delete(id); S.editing.delete(id); } });
    S.checked = S.checked.filter((id) => !S.demoIds.has(id));
    const d = S.demoStore; if (d) { ['scripts', 'fixes', 'actions', 'ps7'].forEach((k) => (d[k] || []).forEach((key) => { S.store[k].delete(key); S.store._lower.delete(key); S.store._an.delete(key); })); }
    const hs = U.hashState(); S.demoIds = new Set(); S.demoStore = null; closeTour();
    S.order = [...S.wfs.values()]; S.callers = W.model.buildCallers(S.wfs); S.global = null; S.usage = null; $('qScrWrap').hidden = !S.store.scripts.size;
    if (!S.wfs.size) { if (welcomeClone) { $('main').replaceChildren(welcomeClone.cloneNode(true)); if (W.app && W.app.refreshLang) W.app.refreshLang(); } $('main').dataset.view = ''; history.replaceState(null, '', location.pathname + location.search); } else if (hs.wf && !S.wfs.has(hs.wf)) U.setHash({ wf: '', cmp: '', tab: 'detail' });
    updateBanner(); U.renderList(); if (S.wfs.size) U.render();
    const kept = S.wfs.size > 0; U.setStatus(() => T('demo.removed') + T(kept ? 'demo.removedKept' : 'demo.removedDot'));
    const o = $('btnOpen'); if (o) o.focus({ preventScroll: true });
  }
  function quit() {
    const dirty = [...S.demoIds].filter((id) => S.wfs.get(id) && S.wfs.get(id).dirty).length;
    if (!dirty) { removeDemo(); return; }
    EU.dialog(T('demo.quit'), h('p', { text: T('demo.dlg.dirty', { n: dirty }) }), [{ text: T('demo.quit'), primary: true, id: 'btnQuitDemoConfirm', onclick: (close) => { close(); removeDemo(); } }]);
  }

  // ---------- visite guidée (non bloquante, clavier: ←/→, Échap) ----------
  let bubble = null, cur = -1, steps = [], lastTarget = null;
  function clearTarget() { if (lastTarget) lastTarget.classList.remove('tour-target'); lastTarget = null; }
  function closeTour() { clearTarget(); cur = -1; if (bubble) { bubble.remove(); bubble = null; } document.removeEventListener('keydown', onKey, true); const t = $('btnTour'); if (t && S.demoIds.size) t.focus({ preventScroll: true }); }
  function onKey(e) {
    if (!bubble) return; const tag = e.target && e.target.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTour(); } else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); go(cur + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(cur - 1); }
  }
  function go(i) {
    if (i < 0) return; if (i >= steps.length) { closeTour(); return; }
    cur = i; const st = steps[i]; clearTarget();
    const patch = Object.assign({ cmp: '' }, st.hash); if (st.hash) U.setHash(patch);
    draw(); setTimeout(() => { const t = st.target && document.querySelector(st.target); if (t) { t.classList.add('tour-target'); lastTarget = t; try { t.scrollIntoView({ block: 'nearest' }); } catch (e) { /* */ } } }, 250);
  }
  function draw() {
    const st = steps[cur], last = cur === steps.length - 1;
    const next = h('button', { type: 'button', class: 'primary', id: 'tourNext', text: T(last ? 'tour.finish' : 'tour.next'), onclick: () => go(cur + 1) });
    const box = h('div', { class: 'tour', id: 'tour', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'tourTitle', 'aria-describedby': 'tourText', tabindex: '-1' },
      h('div', { class: 'tourhead' }, h('h3', { id: 'tourTitle', text: st.title }), h('button', { type: 'button', 'aria-label': T('tour.close'), id: 'tourClose', text: '✕', onclick: closeTour })),
      h('p', { id: 'tourText', text: st.text }), h('div', { class: 'tourfoot' }, h('span', { class: 'muted', id: 'tourStep', text: T('tour.step', { i: cur + 1, n: steps.length }) }),
        h('button', { type: 'button', id: 'tourPrev', text: T('tour.prev'), disabled: cur === 0 ? true : null, onclick: () => go(cur - 1) }), next),
      h('small', { class: 'muted', text: T('tour.hint') }));
    if (bubble) bubble.replaceWith(box); else document.body.append(box); bubble = box; next.focus({ preventScroll: true });
  }
  function startTour() {
    if (!S.demoIds.size) { U.setStatus(() => T('demo.loadFirst')); return; } if (!ids.onb || !S.wfs.has(ids.onb)) return;
    steps = DL.tourSteps(ids); document.removeEventListener('keydown', onKey, true); document.addEventListener('keydown', onKey, true); go(0);
  }
  // changement de langue: bandeau + carte de la visite (étapes recalculées, même étape)
  I.onChange(() => { updateBanner(); if (bubble && cur >= 0) { steps = DL.tourSteps(ids); draw(); } });
  const tb = $('btnTour'); if (tb) tb.addEventListener('click', startTour); const qb = $('btnQuitDemo'); if (qb) qb.addEventListener('click', quit);
  W.demoUi = { load, quit, startTour, closeTour, onDemoClick };
})();
