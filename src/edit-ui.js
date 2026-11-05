/* edit-ui.js - interface d'édition / export (DOM). Toute valeur affichée passe par textContent.
   AVERTISSEMENT: le format exigé par CoreView à l'import n'est pas vérifié. Tout export est à valider par un import test. */
(function () {
  'use strict';
  const U = window.WFV.ui, E = window.WFV.edit, model = window.WFV.model, refs = window.WFV.refs, diffApi = window.WFV.diff, natives = window.WFV.natives;
  const { S, h, hooks, short, add } = U;
  const I = window.WFV.i18n, T = I.t;
  S.sessions = new Map(); S.origs = new Map(); S.editing = new Set();

  // ---------- infrastructure ----------
  function ensureSession(wf) {
    let s = S.sessions.get(wf.id);
    if (!s) { s = E.createSession(wf); S.sessions.set(wf.id, s); S.origs.set(wf.id, wf); }
    return s;
  }
  const curWf = (id) => S.wfs.get(id);
  function sync(ids) {
    (Array.isArray(ids) ? ids : [ids]).forEach((id) => { const s = S.sessions.get(id); if (s) S.wfs.set(id, s.wf); });
    S.order = [...S.wfs.values()]; S.callers = model.buildCallers(S.wfs); S.global = null;
    U.renderList(); U.render();
  }
  const toast = (t) => U.setStatus(t);

  // dialogue modal générique
  let dlg = null;
  function dialog(title, body, actions, opts) {
    if (!dlg) { dlg = h('dialog', { class: 'editdlg', 'aria-label': T('eu.dlg.aria') }); document.body.append(dlg); }
    const close = () => { try { dlg.close(); } catch (e) { /* déjà fermé */ } };
    const foot = h('div', { class: 'dlgfoot' }, (actions || []).map((a) => h('button', { type: 'button', class: a.primary ? 'primary' : '', id: a.id, text: a.text, onclick: () => a.onclick(close) })), h('button', { type: 'button', text: T('dlg.close'), onclick: close }));
    dlg.replaceChildren(h('h2', { text: title }), body, foot);
    if (!dlg.open) dlg.showModal();
    return close;
  }
  const field = (label, input, hint) => h('label', { class: 'fld' }, h('span', { text: label }), input, hint ? h('small', { class: 'muted', text: hint }) : null);
  const listBox = (items, cls) => (items.length ? h('ul', { class: cls || 'warnlist' }, items.map((t) => h('li', { text: t }))) : null);

  // Applique une opération à un workflow: essai à blanc, confirmation si avertissements/références cassées, puis commit.
  function apply(wfId, label, fn, opts) {
    opts = opts || {};
    const wf = curWf(wfId), s = ensureSession(wf);
    const t = E.trial(s, fn);
    if (!t.res || !t.res.ok) { toast(T('eu.refused', { v: (t.res && t.res.error) || T('edit.err.invalidOp') })); if (opts.onError) opts.onError((t.res && t.res.error) || T('edit.err.invalidOp')); return false; }
    const lines = (t.res.warnings || []).slice();
    t.newBroken.forEach((b) => lines.push(T('eu.brokenRef', { token: b.token, node: b.node, reason: b.reason })));
    const v = t.after; if (v && v.errors.length) { toast(T('eu.refused', { v: v.errors[0] })); if (opts.onError) opts.onError(v.errors.join(' ; ')); return false; }
    const doIt = () => { const r = E.run(s, label, fn); if (!r.ok) { toast(T('eu.refused', { v: r.error })); return; } sync(wfId); toast(label + T(r.noop ? 'eu.noChange' : 'eu.applied')); if (opts.after) opts.after(r); };
    if (lines.length && !opts.noConfirm) {
      dialog(T('eu.confirm', { v: label }), h('div', null, h('p', { text: T('eu.warnings') }), listBox(lines.slice(0, 40)), lines.length > 40 ? h('p', { class: 'muted', text: '… +' + (lines.length - 40) }) : null),
        [{ text: T('eu.applyAnyway'), primary: true, onclick: (close) => { close(); doIt(); } }]);
    } else doIt();
    return true;
  }

  // ---------- barre d'édition (en-tête du détail) ----------
  function dirtyOf(id) { const s = S.sessions.get(id); return !!(s && E.isDirty(s)); }
  function editBar(wf) {
    const editing = S.editing.has(wf.id), s = S.sessions.get(wf.id), dirty = dirtyOf(wf.id);
    const bar = h('div', { class: 'editbar' + (editing ? ' on' : '') });
    if (!editing) {
      add(bar, h('button', { type: 'button', id: 'btnEdit', text: T('eu.bar.editMode'), onclick: () => { ensureSession(wf); S.editing.add(wf.id); U.render(); } }),
        dirty ? h('span', { class: 'badge mod', text: T('ui.list.dirty') }) : null, dirty ? h('button', { type: 'button', text: T('eu.bar.export'), onclick: () => exportDialog(wf) }) : null,
        h('small', { class: 'muted', text: T('eu.bar.readonly') }), h('small', { class: 'warnnote', text: T('eu.warn') }));
      return bar;
    }
    add(bar, h('strong', { text: T('eu.bar.editing') }), dirty ? h('span', { class: 'badge mod', id: 'dirtyBadge', text: T('ui.list.dirty') }) : h('span', { class: 'badge', text: T('eu.bar.unchanged') }),
      h('button', { type: 'button', id: 'btnUndo', text: T('eu.bar.undo'), disabled: s && s.undo.length ? null : true, title: s && s.undo.length ? T('eu.bar.undoTitle', { v: s.undo[s.undo.length - 1].label }) : T('eu.bar.nothingUndo'), onclick: () => doUndo(wf.id) }),
      h('button', { type: 'button', id: 'btnRedo', text: T('eu.bar.redo'), disabled: s && s.redo.length ? null : true, title: T('eu.bar.redoTitle'), onclick: () => doRedo(wf.id) }),
      h('button', { type: 'button', text: T('eu.bar.info'), onclick: () => infoDialog(wf) }),
      h('button', { type: 'button', id: 'btnSR', text: T('eu.bar.sr'), onclick: () => searchDialog(wf) }),
      h('button', { type: 'button', text: T('eu.bar.renameInput'), onclick: () => renameInputDialog(wf) }),
      h('button', { type: 'button', id: 'btnExport', class: 'primary', text: T('eu.bar.validateExport'), onclick: () => exportDialog(wf) }),
      h('button', { type: 'button', text: T('eu.bar.quit'), onclick: () => { S.editing.delete(wf.id); U.render(); } }),
      h('div', null, h('small', { class: 'warnnote', text: T('eu.warn') })));
    return bar;
  }
  function doUndo(id) { const s = S.sessions.get(id); if (s && E.undo(s)) { sync(id); toast(T('eu.undone')); } }
  function doRedo(id) { const s = S.sessions.get(id); if (s && E.redo(s)) { sync(id); toast(T('eu.redone')); } }
  hooks.decorateDetail = (root, wf) => { const tb = root.querySelector('.toolbar'); if (tb) tb.after(editBar(wf)); };
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const t = e.target, tag = t && t.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    const id = U.hashState().wf, k = e.key.toLowerCase();
    if (!id || !S.editing.has(id) || U.hashState().tab !== 'detail') return;
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(id); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(id); }
  });
  window.addEventListener('beforeunload', (e) => { if ([...S.sessions.keys()].some(dirtyOf)) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- (a) infos du workflow ----------
  function infoDialog(wf) {
    const name = h('input', { type: 'text', id: 'inName', value: wf.data.workflowName || '' }), desc = h('textarea', { id: 'inDesc', rows: 4, text: wf.data.description || '' });
    const st = h('select', { id: 'inStatus' }, ['Active', 'Inactive'].map((v) => h('option', { value: v, selected: wf.data.status === v ? true : null, text: v })));
    const err = h('div', { class: 'errmsg', role: 'alert' });
    dialog(T('eu.info.title'), h('div', null, field(T('eu.f.name'), name), field(T('eu.f.desc'), desc), field(T('eu.f.status'), st), err), [{ text: T('eu.apply'), primary: true, id: 'btnApplyInfo', onclick: (close) => {
      const ok = apply(wf.id, T('eu.info.label'), (d) => {
        for (const [k, v] of [['workflowName', name.value], ['description', desc.value], ['status', st.value]]) { if (d[k] === v || (d[k] == null && v === '')) continue; const r = E.setWorkflowField(d, k, v); if (!r.ok) return r; }
        return { ok: true, warnings: [] };
      }, { onError: (m) => { err.textContent = m; } });
      if (ok) close();
    } }]);
  }

  // ---------- (b) édition d'une valeur de setting ----------
  function leafKind(v) { if (typeof v === 'boolean') return 'bool'; if (typeof v === 'number') return 'num'; if (typeof v === 'string') return 'str'; if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) return 'list'; if (v === null) return 'null'; return 'json'; }
  function leafDialog(n, wf, key, v) {
    const kind = leafKind(v); let inp;
    if (kind === 'bool') inp = h('select', { id: 'inLeaf' }, [true, false].map((b) => h('option', { value: String(b), selected: b === v ? true : null, text: String(b) })));
    else if (kind === 'num') inp = h('input', { type: 'number', id: 'inLeaf', value: String(v), step: 'any' });
    else if (kind === 'list') inp = h('textarea', { id: 'inLeaf', rows: Math.min(14, v.length + 2), text: v.join('\n') });
    else if (kind === 'json') inp = h('textarea', { id: 'inLeaf', rows: 10, class: 'mono', text: JSON.stringify(v, null, 2) });
    else inp = h('textarea', { id: 'inLeaf', rows: kind === 'str' && String(v).length > 120 ? 10 : 3, class: 'mono', text: v === null ? '' : String(v) });
    const live = h('div', { class: 'live' }), err = h('div', { class: 'errmsg', role: 'alert' });
    const parse = () => {
      const raw = inp.value;
      if (kind === 'bool') return { ok: true, value: raw === 'true' };
      if (kind === 'num') { const x = Number(raw); return raw === '' || isNaN(x) ? { ok: false, error: T('eu.leaf.badNumber') } : { ok: true, value: x }; }
      if (kind === 'list') return { ok: true, value: raw.split('\n').filter((l) => l !== '').map((l) => (typeof v[0] === 'number' && l.trim() !== '' && !isNaN(Number(l)) ? Number(l) : l)) };
      if (kind === 'json') { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: T('ui.json.invalid', { v: e.message }) }; } }
      return { ok: true, value: raw };
    };
    const refresh = () => {
      const p = parse(); err.textContent = p.ok ? '' : p.error; live.replaceChildren();
      const strs = []; if (p.ok) refs.walkStrings(p.value, '', (s) => strs.push(s));
      const toks = strs.flatMap((s) => refs.extractTokens(s)); if (toks.length) live.append(h('div', { class: 'muted', text: T('eu.leaf.refs', { n: toks.length }) }), h('div', null, toks.map((t) => (t.malformed ? h('span', { class: 'pill bad static', title: t.reason, text: '⚠ ' + t.raw }) : h('span', { class: 'pill ' + (t.kind === 'action' ? 'action' : 'input') + ' static', text: t.kind === 'action' ? (wf.uidMap[t.uid] ? (wf.uidMap[t.uid].name + ' › ' + (t.path || '')) : T('eu.leaf.unknownUid') + ' › ' + (t.path || '')) : (t.param || t.raw) })))));
    };
    inp.addEventListener('input', refresh); refresh();
    dialog(T('eu.leaf.title', { key: key, node: n.name || n.path }), h('div', null, h('small', { class: 'muted', text: T('eu.leaf.hint', { kind: kind, list: kind === 'list' ? T('eu.leaf.perLine') : '' }) }), inp, live, err), [{ text: T('eu.apply'), primary: true, id: 'btnApplyLeaf', onclick: (close) => {
      const p = parse(); if (!p.ok) { err.textContent = p.error; return; }
      apply(wf.id, T('eu.leaf.label', { key: key, node: n.name || n.path }), (d) => E.setSetting(d, n.uid, [key], p.value), { onError: (m) => { err.textContent = m; }, after: () => close() });
    } }]);
  }
  function settingsEditor(n, wf) {
    const set = model.nodeSettings(n); const keys = Object.keys(set && typeof set === 'object' ? set : {});
    const d = h('details', { class: 'sub seteditor' }, h('summary', { text: T('eu.set.edit', { n: keys.length }) }));
    d.append(h('table', { class: 'grid' }, h('tbody', null, keys.map((k) => {
      const v = set[k], kind = leafKind(v);
      return h('tr', null, h('td', null, h('code', { text: k })), h('td', { text: kind }), h('td', { class: 'mono clip', text: short(typeof v === 'string' ? v : JSON.stringify(v), 160) }), h('td', null, h('button', { type: 'button', class: 'editleaf', 'aria-label': T('eu.set.modify', { k: k }), text: '✎', onclick: () => leafDialog(n, wf, k, v) })));
    }))));
    return d;
  }

  // ---------- (f) actions sur les nodes ----------
  function destinations(wf, n) {
    const bad = new Set(); (function mark(x) { bad.add(x.uid); x.children.forEach(mark); x.trueBranch.forEach(mark); x.falseBranch.forEach(mark); })(n);
    const out = [{ label: T('eu.dest.actions'), dest: { top: 'actions' } }, { label: T('eu.dest.catch'), dest: { top: 'catchActions' } }];
    wf.all.forEach((x) => {
      if (bad.has(x.uid)) return;
      if (x.kind === 'sequence' && n.kind !== 'sequence') out.push({ label: T('eu.dest.inSeq', { v: x.name || x.path }), dest: { childOf: x.uid } });
      if (x.kind === 'if') { out.push({ label: T('eu.dest.true', { v: x.name || x.path }), dest: { branch: 'trueBranch', of: x.uid } }, { label: T('eu.dest.false', { v: x.name || x.path }), dest: { branch: 'falseBranch', of: x.uid } }); }
    });
    return out;
  }
  function nodeNameDialog(n, wf) {
    const nm = h('input', { type: 'text', id: 'inNodeName', value: n.raw.name || '' }), cd = h('input', { type: 'text', id: 'inNodeDesc', value: n.raw.customDescription || '' }), fs = h('input', { type: 'checkbox', checked: n.raw.forceSkip ? true : null });
    const err = h('div', { class: 'errmsg', role: 'alert' });
    dialog(T('eu.node.title'), h('div', null, field(T('eu.f.name'), nm), field(T('eu.node.customDesc'), cd), h('label', null, fs, ' ' + T('eu.node.forceSkip')), err), [{ text: T('eu.apply'), primary: true, onclick: (close) => {
      apply(wf.id, T('eu.node.label', { v: n.name || n.path }), (d) => {
        for (const [k, v] of [['name', nm.value], ['customDescription', cd.value === '' && n.raw.customDescription == null ? null : cd.value], ['forceSkip', fs.checked]]) { const cur = E.findNode(d, n.uid).node[k]; if (cur === v || (cur == null && v == null)) continue; const r = E.setNodeField(d, n.uid, k, v); if (!r.ok) return r; }
        return { ok: true, warnings: [] };
      }, { onError: (m) => { err.textContent = m; }, after: () => close() });
    } }]);
  }
  function moveDialog(n, wf) {
    const ds = destinations(wf, n), sel = h('select', { id: 'selDest' }, ds.map((d, i) => h('option', { value: i, text: d.label })));
    dialog(T('eu.move.title', { v: n.name || n.path }), h('div', null, field(T('eu.move.dest'), sel), h('small', { class: 'muted', text: T('eu.move.hint') })), [{ text: T('eu.move.btn'), primary: true, onclick: (close) => { apply(wf.id, T('eu.move.label', { v: n.name || n.path }), (d) => E.moveTo(d, n.uid, ds[Number(sel.value)].dest), { after: () => close() }); } }]);
  }
  function allTypes(excludeId) {
    const m = new Map(); S.wfs.forEach((w) => w.all.forEach((x) => { if (x.id.indexOf('item::') === 0) return; if (!m.has(x.id)) m.set(x.id, x); }));
    return m;
  }
  function replaceActionDialog(n, wf) {
    const types = allTypes(); const dl = h('datalist', { id: 'typesList' }, [...types.keys()].sort().map((id) => h('option', { value: id, label: (types.get(id).raw.categoryItemName || types.get(id).name || '') })));
    const target = h('input', { type: 'text', id: 'inNewType', list: 'typesList', placeholder: T('eu.rep.placeholder'), value: '' });
    const set = model.nodeSettings(n) || {}, keys = Object.keys(set);
    const mapInputs = {}; const mapBox = h('table', { class: 'grid' }, h('thead', null, h('tr', null, [T('eu.rep.curKey'), T('eu.rep.targetKey')].map((t) => h('th', { text: t })))),
      h('tbody', null, keys.map((k) => { const i = h('input', { type: 'text', value: k, 'aria-label': T('eu.rep.keyFor', { k: k }) }); mapInputs[k] = i; return h('tr', null, h('td', null, h('code', { text: k })), h('td', null, i)); })));
    const info = h('div', { class: 'muted' }), warn = h('div', { class: 'warnlist' }), err = h('div', { class: 'errmsg', role: 'alert' });
    const build = () => {
      const id = target.value.trim(), tpl = types.get(id); const mapping = {}; keys.forEach((k) => { const v = mapInputs[k].value.trim(); if (v !== k) mapping[k] = v === '' ? null : v; });
      return { id, tpl: tpl ? tpl.raw : null, mapping };
    };
    const refresh = () => {
      const b = build(); info.textContent = b.tpl ? T('eu.rep.found') : (b.id ? T('eu.rep.notFound') : '');
      warn.replaceChildren(); if (!b.id) return;
      const t = E.trial(ensureTemp(wf), (d) => E.replaceNodeType(d, n.uid, { newId: b.id, template: b.tpl, mapping: b.mapping })); err.textContent = t.res.ok ? '' : t.res.error;
      if (t.res.ok) { warn.append(...(t.res.warnings || []).map((w) => h('div', { text: '⚠ ' + w })), ...t.newBroken.map((x) => h('div', { text: '⚠ ' + T('eu.brokenRefShort', { v: x.token }) }))); }
    };
    [target, ...Object.values(mapInputs)].forEach((i) => i.addEventListener('input', refresh));
    dialog(T('eu.rep.title', { v: n.name || n.path }), h('div', null, dl, h('p', { class: 'muted', text: T('eu.rep.current', { v: n.id }) }), field(T('eu.rep.newType'), target), info, h('h3', { text: T('eu.rep.mapping') }), mapBox, warn, err), [{ text: T('eu.rep.btn'), primary: true, id: 'btnApplyType', onclick: (close) => {
      const b = build(); if (!b.id) { err.textContent = T('edit.err.targetTypeMissing'); return; }
      apply(wf.id, T('eu.rep.label', { v: n.name || n.path }), (d) => E.replaceNodeType(d, n.uid, { newId: b.id, template: b.tpl, mapping: b.mapping }), { onError: (m) => { err.textContent = m; }, after: () => close() });
    } }]);
  }
  // session temporaire pour les aperçus (n'altère jamais la session réelle)
  function ensureTemp(wf) { return E.createSession(wf); }

  hooks.decorateNode = (d, body, n, wf) => {
    if (!S.editing.has(wf.id)) return;
    const mk = (text, title, fn, id) => h('button', { type: 'button', class: 'nodebtn', title, 'aria-label': title, id, text, onclick: (e) => { e.stopPropagation(); fn(); } });
    const bar = h('div', { class: 'nodeactions' }, mk(T('eu.nb.name'), T('eu.nb.nameTitle'), () => nodeNameDialog(n, wf)),
      mk('↑', T('eu.nb.up'), () => apply(wf.id, T('eu.nb.upLabel', { v: n.name || n.path }), (dd) => E.moveNode(dd, n.uid, 'up'))), mk('↓', T('eu.nb.down'), () => apply(wf.id, T('eu.nb.downLabel', { v: n.name || n.path }), (dd) => E.moveNode(dd, n.uid, 'down'))),
      mk(T('eu.nb.move'), T('eu.nb.moveTitle'), () => moveDialog(n, wf)),
      mk(T('eu.nb.dup'), T('eu.nb.dupTitle'), () => apply(wf.id, T('eu.nb.dupLabel', { v: n.name || n.path }), (dd) => E.duplicateNode(dd, n.uid), { noConfirm: false }), 'dup-' + n.uid),
      mk(T('eu.nb.del'), T('eu.nb.delTitle'), () => apply(wf.id, T('eu.nb.delLabel', { v: n.name || n.path }), (dd) => E.deleteNode(dd, n.uid)), 'del-' + n.uid),
      n.id.indexOf('item::') === 0 ? null : mk(T('eu.nb.replace'), T('eu.nb.replaceTitle'), () => replaceActionDialog(n, wf)));
    const first = body.firstChild; body.insertBefore(bar, first);
    const set = model.nodeSettings(n); if (set && Object.keys(set).length) body.insertBefore(settingsEditor(n, wf), first.nextSibling);
  };

  // ---------- (c)(d)(e) opérations en masse avec aperçu ----------
  function targetsFor(scope, wf) {
    if (scope === 'checked') return S.checked.map((id) => S.wfs.get(id)).filter(Boolean);
    if (scope === 'listed') return U.shownIds().map((id) => S.wfs.get(id)).filter(Boolean);
    return [wf];
  }
  const scopeSelect = (wf) => h('select', { id: 'selScope', 'aria-label': T('eu.scope') }, h('option', { value: 'current', text: T('eu.scope.current') }), h('option', { value: 'checked', text: T('eu.scope.checked', { n: S.checked.length }) }), h('option', { value: 'listed', text: T('eu.scope.listed', { n: U.shownIds().length }) }));
  // makeFn() -> fonction (d)=>résultat; preview: tableau; retourne {total, byWf}
  function bulkPreview(targets, makeFn) {
    const rows = []; let total = 0, wfCount = 0; const errs = [];
    targets.forEach((w) => {
      const t = E.trial(ensureTemp(w), makeFn()); if (!t.res || !t.res.ok) { errs.push(w.name + ': ' + ((t.res && t.res.error) || '?')); return; }
      const ch = t.res.changes || []; if (ch.length) { wfCount++; total += ch.length; ch.forEach((c) => rows.push({ wf: w, c })); }
      (t.res.warnings || []).forEach((x) => errs.push(w.name + ': ' + x));
    });
    return { rows, total, wfCount, errs };
  }
  function previewTable(p) {
    return h('div', null, h('div', { class: 'summary' }, h('span', { class: 'badge mod', id: 'prevCount', text: T('eu.prev.count', { n: p.total, w: p.wfCount }) })),
      p.errs.length ? h('div', { class: 'warnlist' }, p.errs.slice(0, 8).map((e) => h('div', { text: '⚠ ' + e }))) : null,
      h('div', { class: 'scrollbox' }, h('table', { class: 'grid' }, h('thead', null, h('tr', null, [T('ins.q.h.wf'), 'Node', T('eu.prev.where'), T('eu.prev.before'), T('eu.prev.after')].map((t) => h('th', { text: t })))),
        h('tbody', null, p.rows.slice(0, 200).map((r) => h('tr', null, h('td', { text: r.wf.name }), h('td', { text: r.c.nodeName || '' }), h('td', { class: 'mono', text: r.c.where }), h('td', { class: 'before mono', text: short(r.c.before, 300) }), h('td', { class: 'after mono', text: short(r.c.after, 300) })))))),
      p.rows.length > 200 ? h('small', { class: 'muted', text: T('eu.prev.more', { n: p.rows.length - 200 }) }) : null);
  }
  function applyBulk(targets, label, makeFn, close) {
    const ids = [];
    targets.forEach((w) => { const s = ensureSession(S.wfs.get(w.id)); const r = E.run(s, label, makeFn()); if (r.ok && !r.noop) ids.push(w.id); });
    if (ids.length) sync(ids); else U.render();
    toast(T('eu.bulk.done', { label: label, n: ids.length })); close();
  }
  function bulkDialog(title, wf, formEl, makeFn, label, extraActions) {
    const out = h('div', { id: 'bulkOut' }), scope = scopeSelect(wf);
    const run = () => { const p = bulkPreview(targetsFor(scope.value, wf), makeFn); out.replaceChildren(previewTable(p)); return p; };
    dialog(title, h('div', null, formEl, field(T('eu.scope.label'), scope), out), [{ text: T('eu.bulk.preview'), id: 'btnPreview', onclick: run }, { text: T('eu.apply'), primary: true, id: 'btnApplyBulk', onclick: (close) => {
      const p = run(); if (!p.total) { toast(T('eu.bulk.none')); return; }
      const targets = targetsFor(scope.value, wf); if (targets.length > 1 && !window.confirm(T('eu.bulk.confirm', { n: p.total, w: p.wfCount }))) return;
      applyBulk(targets, label, makeFn, close);
    } }].concat(extraActions || []));
    return { run, scope };
  }
  function searchDialog(wf) {
    const find = h('input', { type: 'text', id: 'inFind' }), rep = h('input', { type: 'text', id: 'inRepl' }), rx = h('input', { type: 'checkbox' }), cs = h('input', { type: 'checkbox' });
    const sSet = h('input', { type: 'checkbox', checked: true }), sFil = h('input', { type: 'checkbox', checked: true }), sNam = h('input', { type: 'checkbox' });
    const fnFrom = h('input', { type: 'text', id: 'inFnFrom', placeholder: 'removeSpaces' }), fnTo = h('input', { type: 'text', id: 'inFnTo', placeholder: 'truncate' }), fnArgs = h('input', { type: 'text', id: 'inFnArgs', placeholder: T('eu.sr.argsPh') });
    const mode = h('select', { id: 'selMode' }, h('option', { value: 'text', text: T('eu.sr.modeText') }), h('option', { value: 'fn', text: T('eu.sr.modeFn') }));
    const textForm = h('div', { id: 'formText' }, field(T('eu.sr.find'), find), field(T('eu.sr.replaceWith'), rep), h('label', null, rx, ' ' + T('eu.sr.regex')), h('label', null, cs, ' ' + T('eu.sr.case')), h('div', { class: 'row' }, h('label', null, sSet, ' ' + T('eu.sr.settings')), h('label', null, sFil, ' ' + T('eu.sr.filters')), h('label', null, sNam, ' ' + T('eu.sr.names'))));
    const fnForm = h('div', { id: 'formFn', hidden: true }, field(T('eu.sr.fnCur'), fnFrom), field(T('eu.sr.fnNew'), fnTo), field(T('eu.sr.fnArgs'), fnArgs, T('eu.sr.fnArgsHint')));
    mode.onchange = () => { textForm.hidden = mode.value !== 'text'; fnForm.hidden = mode.value !== 'fn'; };
    const makeFn = () => (mode.value === 'text'
      ? (d) => E.findReplace(d, { find: find.value, replace: rep.value, regex: rx.checked, caseSensitive: cs.checked, settings: sSet.checked, filters: sFil.checked, names: sNam.checked })
      : (d) => E.replaceFunction(d, { from: fnFrom.value.trim(), to: fnTo.value.trim(), args: fnArgs.value === '' ? null : fnArgs.value }));
    bulkDialog(T('eu.sr.title'), wf, h('div', null, field(T('eu.sr.mode'), mode), textForm, fnForm), makeFn, T('eu.bar.sr').replace(/…$/, ''));
  }
  function renameInputDialog(wf) {
    const props = Object.keys((model.parseJsonField(wf.data.inputSchema) || {}).properties || {});
    const sel = h('select', { id: 'selInput' }, props.map((p) => h('option', { value: p, text: p }))), nn = h('input', { type: 'text', id: 'inNewInput' });
    bulkDialog(T('eu.ri.title'), wf, h('div', null, field(T('eu.ri.input'), sel), field(T('eu.ri.newName'), nn), h('small', { class: 'muted', text: T('eu.ri.hint') })),
      () => (d) => E.renameInput(d, sel.value, nn.value.trim()), T('eu.ri.label'));
  }

  // ---------- export ----------
  function baseName(f) { return String(f || 'workflow.json').split('/').pop(); }
  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function saveAs(name, text) {
    if (window.showSaveFilePicker) { const fh = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] }); const w = await fh.createWritable(); await w.write(new Blob([text])); await w.close(); } else download(name, text);
  }
  function exportDialog(wf) {
    const s = ensureSession(S.wfs.get(wf.id)), cur = S.wfs.get(wf.id), orig = S.origs.get(wf.id);
    const d = E.dataOf(s.root), v = E.validate(d), dirty = E.isDirty(s);
    const dres = diffApi.diffWorkflows(orig, cur, { noise: false });
    const sm = dres.summary;
    const optVol = h('input', { type: 'checkbox', id: 'optVolatile' }), optForce = h('input', { type: 'checkbox', id: 'optForce' }), optPicker = h('input', { type: 'checkbox', id: 'optPicker' }), optSuffix = h('input', { type: 'checkbox', id: 'optSuffix' });
    const dirtyAll = [...S.sessions.keys()].filter(dirtyOf);
    const body = h('div', null,
      h('p', { class: 'warnnote', text: T('eu.warn') }),
      S.demoIds && S.demoIds.has(wf.id) ? h('p', { class: 'warnnote', id: 'demoExportNote', text: T('eu.exp.demoNote') }) : null,
      h('p', null, h('b', { text: cur.name }), ' — ', dirty ? h('span', { class: 'badge mod', text: T('ui.list.dirty') }) : h('span', { class: 'badge', text: T('eu.exp.unchanged') })),
      h('div', { class: 'summary' }, h('span', { class: 'badge add', text: T('eu.exp.nodesAdded', { n: sm.added }) }), h('span', { class: 'badge del', text: T('ui.cmp.removed', { n: sm.removed }) }), h('span', { class: 'badge mod', text: T('ui.cmp.modified', { n: sm.modified }) }), h('span', { class: 'badge', text: T('ui.cmp.headerDiffs', { n: dres.header.length }) }), dres.inputs ? h('span', { class: 'badge', text: T('n.inputs', { n: dres.inputs.changed }) }) : null),
      h('button', { type: 'button', id: 'btnFullDiff', text: T('eu.exp.fullDiff'), onclick: () => { dlg.close(); U.setHash({ wf: 'orig:' + wf.id, cmp: wf.id, tab: 'compare' }); } }),
      h('h3', { text: T('eu.exp.validation') }),
      v.errors.length ? h('div', null, h('b', { class: 'bad', text: T('eu.exp.blocking', { n: v.errors.length }) }), listBox(v.errors.slice(0, 20), 'errlist')) : h('div', { id: 'valOk', text: T('eu.exp.valOk') }),
      h('div', { text: v.broken.length ? T('eu.exp.brokenRefs', { n: v.broken.length }) : T('eu.exp.allResolved') }),
      v.broken.length ? listBox(v.broken.slice(0, 10).map((b) => b.node + ': ' + b.token + ' (' + b.reason + ')')) : null,
      listBox(v.warnings.slice(0, 10)),
      s.style.exact ? h('div', { class: 'muted', text: T('eu.exp.style', { name: s.style.name, bom: s.style.bom ? ' + BOM' : '', eol: s.style.eol === '\r\n' ? ', CRLF' : ', LF', nl: T(s.style.trailing ? 'eu.exp.nlFinal' : 'eu.exp.nlNone') }) }) : h('div', { class: 'warnlist', text: T('eu.exp.noStyle') }),
      h('h3', { text: T('eu.exp.options') }),
      h('label', null, optVol, ' ' + T('eu.exp.optVolatile')), h('br'),
      h('label', null, optForce, ' ' + T('eu.exp.optForce')), h('br'),
      h('label', null, optPicker, ' ' + T('eu.exp.optPicker')), h('br'),
      h('label', null, optSuffix, ' ' + T('eu.exp.optSuffix')));
    const doExport = async (wfs, close) => {
      for (const w of wfs) {
        const ss = S.sessions.get(w.id); const vv = E.validate(E.dataOf(ss.root));
        if (vv.errors.length && !optForce.checked) { toast(T('eu.exp.blocked', { v: w.name })); continue; }
        const text = E.exportText(ss, { touchVolatile: optVol.checked }); let name = baseName(ss.file); if (optSuffix.checked) name = name.replace(/\.json$/i, '') + T('eu.exp.suffix') + '.json';
        try { if (optPicker.checked) await saveAs(name, text); else download(name, text); toast(T('eu.exp.exported', { name: name, n: text.length })); } catch (e) { if (e.name !== 'AbortError') toast(T('eu.exp.error', { v: e.message })); }
      }
      close();
    };
    dialog(T('eu.bar.validateExport').replace(/…$/, ''), body, [{ text: T('eu.exp.btn'), primary: true, id: 'btnDoExport', onclick: (close) => doExport([cur], close) }].concat(dirtyAll.length > 1 ? [{ text: T('eu.exp.btnAll', { n: dirtyAll.length }), id: 'btnExportAll', onclick: (close) => doExport(dirtyAll.map((id) => S.wfs.get(id)), close) }] : []));
  }

  window.WFV.editUi = { ensureSession, apply, sync, exportDialog, searchDialog, infoDialog, doUndo, doRedo, download, dialog, field, listBox, toast, ensureTemp };
  // bandeau d'avertissement global dans la barre du haut quand des modifications existent
  U.render();
})();
