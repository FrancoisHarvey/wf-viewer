/* inputs-ui.js - éditeur tabulaire des inputs d'un workflow (inputSchema.properties), intégré à la section Inputs en mode édition.
   Toutes les modifications passent par le moteur d'édition (src/edit.js): clone, undo/redo, trial avec avertissements, validation, export fidèle.
   Aucune valeur n'est interprétée comme HTML (textContent), aucun style en ligne (CSP stricte). */
(function () {
  'use strict';
  const W = window.WFV, U = W.ui, EU = W.editUi, E = W.edit, I = W.inputs, model = W.model;
  const { S, h, hooks, add, short } = U;
  const T = W.i18n.t;
  const kindLabel = (k) => (k === 'integer' ? T('iu.kind.integer') : k === 'target' ? T('iu.kind.target') : I.KINDS[k] ? I.KINDS[k].label : k);
  const selected = new Map(); // wfId -> Set(noms cochés)
  const selOf = (id) => { if (!selected.has(id)) selected.set(id, new Set()); return selected.get(id); };
  const ENUM_PAGE = 100;

  // valeurs déjà vues dans les workflows chargés (suggestions; jamais inventées)
  function knownValues(key) {
    const out = new Set(); S.wfs.forEach((w) => { const r = I.parseInputs(w); if (r.ok && r.raw) Object.values(r.raw.properties || {}).forEach((p) => { if (p && typeof p[key] === 'string' && p[key]) out.add(p[key]); }); });
    return [...out].sort();
  }
  const datalist = (id, values) => h('datalist', { id }, values.map((v) => h('option', { value: v })));

  // applique une opération; mémorise le contrôle à re-focaliser après le nouveau rendu
  function op(wf, label, fn, refocus, opts) { if (refocus) S.inRefocus = refocus; return EU.apply(wf.id, label, fn, opts); }
  const usedBy = (wf, name) => { const df = W.graph.dataflow(wf); return (df.inputUsers[name] || []).length; };
  const labelFor = (text, ctrl) => h('label', { class: 'fld' }, h('span', { text }), ctrl);

  // ---------- dialogue: ajouter un input ----------
  function addDialog(wf, after) {
    const pr = I.parseInputs(wf), props = pr.raw ? pr.raw.properties : {};
    const name = h('input', { type: 'text', id: 'inAddName', autocomplete: 'off' }), kind = h('select', { id: 'selAddKind' }, I.SELECTABLE.map((k) => h('option', { value: k, text: kindLabel(k) })));
    const tgt = h('select', { id: 'selAddTarget', class: 'hidden', 'aria-label': T('iu.add.targetType') }, Object.keys(I.TARGET_TYPES).map((t) => h('option', { value: t, text: I.TARGET_TYPES[t] })));
    const req = h('input', { type: 'checkbox', id: 'chkAddReq' }), vals = h('textarea', { id: 'taAddValues', rows: 5, class: 'hidden', placeholder: T('iu.add.onePerLine') });
    const src = h('input', { type: 'text', id: 'inAddSrc', class: 'hidden', autocomplete: 'off' }), filt = h('input', { type: 'checkbox', id: 'chkAddFilt', checked: true });
    const filtLbl = h('label', { class: 'hidden', id: 'lblAddFilt' }, filt, ' ' + T('iu.add.filterable'));
    const note = h('div', { class: 'muted', id: 'addNote' }), msg = h('div', { class: 'errmsg', role: 'alert', id: 'addErr' });
    const dl = datalist('dlAddSrc', []);
    const refresh = () => {
      const k = kind.value; tgt.classList.toggle('hidden', k !== 'target'); vals.classList.toggle('hidden', k !== 'enum'); src.classList.toggle('hidden', k !== 'datasource' && k !== 'customlist'); filtLbl.classList.toggle('hidden', k !== 'datasource');
      if (k === 'datasource' || k === 'customlist') { src.setAttribute('aria-label', T(k === 'datasource' ? 'iu.add.srcAria' : 'iu.add.listAria')); src.placeholder = T(k === 'datasource' ? 'iu.add.srcPh' : 'iu.add.listPh'); dl.replaceChildren(...knownValues(k === 'datasource' ? 'x-cv-data-source' : 'x-cv-custom-list').map((v) => h('option', { value: v }))); src.setAttribute('list', 'dlAddSrc'); }
      note.textContent = I.CERTAINTY[k] === false ? 'ⓘ ' + I.UNCERTAIN_NOTES[k] : '';
      const v = I.validateName(name.value, props, null); msg.textContent = v.error || (v.warning ? '⚠ ' + v.warning : '');
    };
    [name, kind].forEach((c) => c.addEventListener('input', refresh)); refresh();
    EU.dialog(T('iu.add.title'), h('div', null, labelFor(T('iu.add.name'), name), labelFor(T('ui.in.h.type'), kind), tgt, h('label', null, req, ' ' + T('iu.required')), vals, labelFor(T('iu.add.value'), src), filtLbl, dl, note, msg),
      [{ text: T('iu.add.btn'), primary: true, id: 'btnAddInput', onclick: (close) => {
        const k = kind.value; if ((k === 'datasource' || k === 'customlist') && !src.value.trim()) { msg.textContent = T(k === 'datasource' ? 'iu.add.fillSrc' : 'iu.add.fillList'); return; }
        op(wf, T('iu.add.label', { v: name.value }), (dd) => E.addInput(dd, { name: name.value, kind: k, targetType: tgt.value, required: req.checked, after: after || null, values: k === 'enum' ? I.dedupe(I.parsePaste(vals.value)) : undefined, customList: k === 'customlist' ? src.value.trim() : undefined, dataSource: k === 'datasource' ? src.value.trim() : undefined, filterable: filt.checked }), { name: name.value, f: 'kind' }, { onError: (m) => { msg.textContent = m; }, after: () => close() });
      } }]);
  }

  // ---------- dialogue: renommer (essai à blanc via l'opération existante renameInput) ----------
  function renameDialog(wf, oldName) {
    const pr = I.parseInputs(wf), nn = h('input', { type: 'text', id: 'inRenameNew', value: oldName, autocomplete: 'off' }), prev = h('div', { id: 'renamePreview' }), err = h('div', { class: 'errmsg', role: 'alert' });
    const refresh = () => {
      const v = nn.value; prev.replaceChildren(); err.textContent = '';
      if (v === oldName) return; const val = I.validateName(v, pr.raw.properties, oldName); if (val.error) { err.textContent = val.error; return; }
      const t = E.trial(E.createSession(wf), (dd) => E.renameInput(dd, oldName, v)); if (!t.res.ok) { err.textContent = t.res.error; return; }
      prev.append(h('p', { id: 'renameCount', text: T('iu.ren.count', { n: t.res.changes.length }) }));
      const warn = (t.res.warnings || []).concat(val.warning ? [val.warning] : []).concat(t.newBroken.map((b) => T('eu.brokenRefShort', { v: b.token }))); if (warn.length) prev.append(h('ul', { class: 'warnlist' }, warn.map((x) => h('li', { text: x }))));
    };
    nn.addEventListener('input', refresh);
    EU.dialog(T('iu.ren.title', { v: oldName }), h('div', null, labelFor(T('eu.ri.newName'), nn), prev, err), [{ text: T('iu.ren.btn'), primary: true, id: 'btnDoRename', onclick: (close) => {
      if (nn.value === oldName) { close(); return; } const val = I.validateName(nn.value, pr.raw.properties, oldName); if (val.error) { err.textContent = val.error; return; }
      op(wf, T('iu.ren.label', { a: oldName, b: nn.value }), (dd) => E.renameInput(dd, oldName, nn.value), { name: nn.value, f: 'name' }, { onError: (m) => { err.textContent = m; }, after: () => close() });
    } }]);
    nn.select();
  }

  // ---------- dialogue: valeurs de liste (enum), rendu paresseux ----------
  function enumDialog(wf, name) {
    const prop = I.parseInputs(wf).raw.properties[name]; let vals = Array.isArray(prop.enum) ? prop.enum.slice() : [], limit = ENUM_PAGE;
    const q = h('input', { type: 'search', id: 'inEnumSearch', placeholder: T('iu.enum.search'), 'aria-label': T('iu.enum.searchAria') }), listEl = h('div', { class: 'enumlist', id: 'enumList' }), info = h('div', { class: 'muted', id: 'enumInfo', role: 'status' });
    const paste = h('textarea', { id: 'taEnumPaste', rows: 4, placeholder: T('iu.enum.pastePh'), 'aria-label': T('iu.enum.pasteAria') }), mode = h('select', { id: 'selPasteMode', 'aria-label': T('iu.enum.pasteMode') }, h('option', { value: 'append', text: T('iu.enum.append') }), h('option', { value: 'replace', text: T('iu.enum.replaceList') }));
    const draw = () => {
      const f = q.value.toLowerCase(), idxs = []; for (let i = 0; i < vals.length; i++) if (!f || String(vals[i]).toLowerCase().includes(f)) idxs.push(i);
      const dups = I.duplicatesOf(vals); info.textContent = T('iu.enum.count', { n: vals.length }) + (f ? T('iu.enum.matching', { n: idxs.length }) : '') + (dups.length ? T('iu.enum.dups', { n: dups.length }) : '');
      const frag = document.createDocumentFragment();
      idxs.slice(0, limit).forEach((i) => {
        const inp = h('input', { type: 'text', value: String(vals[i]), 'aria-label': T('iu.enum.valueN', { n: i + 1 }), class: 'enumval' }); inp.addEventListener('change', () => { vals[i] = inp.value; });
        frag.append(h('div', { class: 'enumrow' }, h('span', { class: 'lno', text: String(i + 1) }), inp,
          h('button', { type: 'button', 'aria-label': T('iu.enum.upN', { n: i + 1 }), text: '↑', disabled: i === 0 ? true : null, onclick: () => { vals = I.moveValue(vals, i, i - 1); draw(); } }),
          h('button', { type: 'button', 'aria-label': T('iu.enum.downN', { n: i + 1 }), text: '↓', disabled: i === vals.length - 1 ? true : null, onclick: () => { vals = I.moveValue(vals, i, i + 1); draw(); } }),
          h('button', { type: 'button', 'aria-label': T('iu.enum.delN', { n: i + 1 }), text: '✕', onclick: () => { vals.splice(i, 1); draw(); } })));
      });
      if (idxs.length > limit) frag.append(h('button', { type: 'button', id: 'btnEnumMore', text: T('iu.enum.more', { n: idxs.length - limit }), onclick: () => { limit += ENUM_PAGE; draw(); } }));
      listEl.replaceChildren(frag);
    };
    q.addEventListener('input', () => { limit = ENUM_PAGE; draw(); });
    const bar = h('div', { class: 'toolbar' }, h('button', { type: 'button', id: 'btnEnumAdd', text: T('iu.enum.add'), onclick: () => { vals.push(''); q.value = ''; limit = Math.max(limit, vals.length); draw(); const ins = listEl.querySelectorAll('.enumval'); if (ins.length) ins[ins.length - 1].focus(); } }),
      h('button', { type: 'button', id: 'btnEnumDedupe', text: T('iu.enum.dedupe'), onclick: () => { vals = I.dedupe(vals); draw(); } }), h('button', { type: 'button', id: 'btnEnumSortAsc', text: T('iu.enum.sortAsc'), onclick: () => { vals = I.sortValues(vals); draw(); } }),
      h('button', { type: 'button', text: T('iu.enum.sortDesc'), onclick: () => { vals = I.sortValues(vals, 'desc'); draw(); } }), h('button', { type: 'button', text: T('iu.enum.removeEmpty'), onclick: () => { vals = vals.filter((v) => String(v).trim() !== ''); draw(); } }));
    const pasteBtn = h('button', { type: 'button', id: 'btnEnumPaste', text: T('iu.enum.applyPaste'), onclick: () => { const nv = I.parsePaste(paste.value); vals = mode.value === 'replace' ? nv : vals.concat(nv); paste.value = ''; draw(); } });
    const err = h('div', { class: 'errmsg', role: 'alert' }); draw();
    EU.dialog(T('iu.enum.title', { v: name }), h('div', null, h('p', { class: 'muted', text: T('iu.enum.note', { n: ENUM_PAGE }) }), bar, q, info, listEl, h('h3', { text: T('iu.enum.pasteTitle') }), paste, h('div', { class: 'toolbar' }, mode, pasteBtn), err),
      [{ text: T('eu.apply'), primary: true, id: 'btnEnumApply', onclick: (close) => {
        if (vals.some((v) => String(v).trim() === '')) { err.textContent = T('iu.enum.emptyErr'); return; }
        op(wf, T('iu.enum.label', { v: name, n: vals.length }), (dd) => E.setInputEnum(dd, name, vals.map(String)), { name, f: 'enum' }, { onError: (m) => { err.textContent = m; }, after: () => close() });
      } }]);
  }

  // ---------- dialogue: règles de mot de passe ----------
  const BOOL_RULES = {}; ['specifyLength', 'requireUppercase', 'requireLowercase', 'requiredigits', 'requireNumbers', 'requireSpecialChars', 'isEditable'].forEach((k) => Object.defineProperty(BOOL_RULES, k, { get: () => T('iu.rule.' + k), enumerable: true }));
  function rulesDialog(wf, name) {
    const prop = I.parseInputs(wf).raw.properties[name], rules = prop.passwordRules && typeof prop.passwordRules === 'object' ? JSON.parse(JSON.stringify(prop.passwordRules)) : I.defaultPasswordRules(), box = h('div', { id: 'rulesBox' });
    const controls = {}; const err = h('div', { class: 'errmsg', role: 'alert' });
    const draw = () => {
      box.replaceChildren(); Object.keys(rules).forEach((k) => {
        const v = rules[k];
        if (typeof v === 'boolean') { const c = h('input', { type: 'checkbox', checked: v ? true : null, 'aria-label': BOOL_RULES[k] || k }); c.addEventListener('change', () => { rules[k] = c.checked; }); box.append(h('label', { class: 'rule' }, c, ' ' + (BOOL_RULES[k] || k), h('small', { class: 'muted tech', text: ' (' + k + ')' }))); }
        else if (typeof v === 'number') { const c = h('input', { type: 'number', min: 0, value: String(v), 'aria-label': T('iu.rule.minLength'), id: 'inRuleMin' }); c.addEventListener('change', () => { rules[k] = Number(c.value); }); box.append(labelFor(k === 'minLength' ? T('iu.rule.minLength') : k, c)); }
        else if (k === 'specialCharsConfig' && v && typeof v === 'object') {
          const u = h('input', { type: 'checkbox', checked: v.useDefaultChars ? true : null, 'aria-label': T('iu.rule.useDefaultAria') }), cc = h('input', { type: 'text', value: String(v.customChars || ''), 'aria-label': T('iu.rule.customAria') });
          u.addEventListener('change', () => { v.useDefaultChars = u.checked; }); cc.addEventListener('change', () => { v.customChars = cc.value; }); box.append(h('div', { class: 'fld' }, h('span', { text: T('iu.rule.special') }), h('label', null, u, ' ' + T('iu.rule.useDefault')), cc));
        } else box.append(h('div', { class: 'muted', text: T('iu.rule.kept', { k: k }) }));
      });
      const missing = Object.keys(BOOL_RULES).filter((k) => !(k in rules)), sel = h('select', { 'aria-label': T('iu.rule.addAria'), id: 'selRuleAdd' }, h('option', { value: '', text: T('iu.rule.add') }), missing.map((k) => h('option', { value: k, text: BOOL_RULES[k] })));
      sel.addEventListener('change', () => { if (sel.value) { rules[sel.value] = true; draw(); } }); box.append(sel);
    }; draw();
    EU.dialog(T('iu.rule.title', { v: name }), h('div', null, h('p', { class: 'muted', text: 'ⓘ ' + I.UNCERTAIN_NOTES.password }), box, err), [{ text: T('eu.apply'), primary: true, id: 'btnRulesApply', onclick: (close) => {
      op(wf, T('iu.rule.label', { v: name }), (dd) => E.setPasswordRules(dd, name, rules), { name, f: 'rules' }, { onError: (m) => { err.textContent = m; }, after: () => close() });
    } }]);
  }

  // ---------- dialogue: JSON brut d'un input (expert) ----------
  function rawDialog(wf, name) {
    const prop = I.parseInputs(wf).raw.properties[name], ta = h('textarea', { id: 'taRawInput', rows: 14, class: 'mono', 'aria-label': T('iu.raw.aria') }), err = h('div', { class: 'errmsg', role: 'alert' });
    ta.value = JSON.stringify(prop, null, 2); let parsed = prop;
    const check = () => { try { parsed = JSON.parse(ta.value); err.textContent = ''; } catch (e) { parsed = undefined; err.textContent = T('ui.json.invalid', { v: e.message }); } }; ta.addEventListener('input', check);
    EU.dialog(T('iu.raw.title', { v: name }), h('div', null, h('p', { class: 'muted', text: T('iu.raw.note') }), ta, err), [{ text: T('eu.apply'), primary: true, id: 'btnRawApply', onclick: (close) => {
      if (parsed === undefined) return; op(wf, T('iu.raw.label', { v: name }), (dd) => E.setInputProp(dd, name, parsed), { name, f: 'kind' }, { onError: (m) => { err.textContent = m; }, after: () => close() });
    } }]);
  }

  // ---------- dialogue: valeur requise pour une source / une liste personnalisée ----------
  function valueDialog(wf, name, kind) {
    const isDs = kind === 'datasource', inp = h('input', { type: 'text', id: 'inKindValue', list: 'dlKindValue', autocomplete: 'off', 'aria-label': T(isDs ? 'iu.add.srcAria' : 'iu.val.listAria') }), dl = datalist('dlKindValue', knownValues(isDs ? 'x-cv-data-source' : 'x-cv-custom-list')), err = h('div', { class: 'errmsg', role: 'alert' });
    EU.dialog(T(isDs ? 'iu.add.srcAria' : 'ui.in.customList').replace(/ ?:$/, ''), h('div', null, h('p', { class: 'muted', text: T('iu.val.note') }), labelFor(T(isDs ? 'iu.add.srcAria' : 'iu.add.listAria'), inp), dl, err), [{ text: T('eu.apply'), primary: true, id: 'btnKindValue', onclick: (close) => {
      if (!inp.value.trim()) { err.textContent = T('iu.val.required'); return; }
      op(wf, T('iu.val.convert', { v: name, k: kindLabel(kind) }), (dd) => E.setInputKind(dd, name, kind, isDs ? { dataSource: inp.value.trim() } : { customList: inp.value.trim() }), { name, f: 'kind' }, { onError: (m) => { err.textContent = m; }, after: () => close() });
    } }]);
  }

  // ---------- dialogue: copier des inputs vers un autre workflow ----------
  function copyDialog(wf) {
    const pr = I.parseInputs(wf), names = [...selOf(wf.id)].filter((n) => pr.raw.properties[n]); const list = names.length ? names : Object.keys(pr.raw.properties);
    const others = [...S.wfs.values()].filter((w) => w.id !== wf.id).sort((a, b) => W.i18n.compare(a.name, b.name));
    if (!others.length) { U.setStatus(T('iu.copy.noOther')); return; }
    const sel = h('select', { id: 'selCopyTarget', 'aria-label': T('iu.copy.target') }, others.map((w) => h('option', { value: w.id, text: w.name }))), mode = h('select', { id: 'selCopyMode', 'aria-label': T('iu.copy.conflictAria') }, h('option', { value: 'skip', text: T('iu.copy.skip') }), h('option', { value: 'rename', text: T('iu.copy.rename') }), h('option', { value: 'overwrite', text: T('iu.copy.overwrite') }));
    const out = h('div', { id: 'copyPreview' }), items = () => list.map((n) => ({ name: n, prop: pr.raw.properties[n], required: pr.inputs.find((i) => i.name === n).required }));
    const refresh = () => { const t = E.trial(E.createSession(S.wfs.get(sel.value)), (dd) => E.copyInputs(dd, items(), mode.value)); out.replaceChildren(t.res.ok ? h('ul', { id: 'copyList' }, t.res.report.map((r) => h('li', { text: r.name + ' → ' + r.action }))) : h('div', { class: 'errmsg', text: t.res.error })); };
    [sel, mode].forEach((c) => c.addEventListener('change', refresh)); refresh();
    EU.dialog(T('iu.copy.title', { n: list.length }), h('div', null, h('p', { class: 'muted', text: names.length ? T('iu.copy.checked', { v: names.join(', ') }) : T('iu.copy.noneChecked') }), labelFor(T('iu.copy.target'), sel), labelFor(T('iu.copy.conflicts'), mode), h('h3', { text: T('eu.bulk.preview') }), out), [{ text: T('iu.copy.btn'), primary: true, id: 'btnDoCopy', onclick: (close) => {
      const target = S.wfs.get(sel.value); EU.apply(target.id, T('iu.copy.label', { n: list.length, v: wf.name }), (dd) => E.copyInputs(dd, items(), mode.value), { after: () => { close(); U.setStatus(() => T('iu.copy.done', { v: target.name })); } });
    } }]);
  }

  // ---------- changement de catégorie ----------
  function changeKind(wf, name, kind, selEl, oldKind) {
    if (selEl) selEl.value = oldKind; // l'affichage ne change qu'une fois l'opération appliquée
    if (kind === 'datasource' || kind === 'customlist') { const cur = I.parseInputs(wf).raw.properties[name]; if (!(kind === 'datasource' ? cur['x-cv-data-source'] : cur['x-cv-custom-list'])) { valueDialog(wf, name, kind); return; } }
    op(wf, T('iu.kind.change', { v: name, k: kindLabel(kind) }), (dd) => E.setInputKind(dd, name, kind, kind === 'target' ? { targetType: 'User' } : {}), { name, f: 'kind' }, { after: (r) => { if (r && r.needs === 'enum') enumDialog(S.wfs.get(wf.id), name); } });
  }

  // ---------- ligne de l'éditeur ----------
  function detailsCell(wf, i) {
    const nm = i.name, cell = h('td', { class: 'indet' });
    if (i.kind === 'enum') { cell.append(h('button', { type: 'button', class: 'btn-enum', 'aria-label': T('iu.row.editValues', { v: nm }), data: { in: nm, f: 'enum' }, text: T('iu.row.values', { n: i.enumValues ? i.enumValues.length : 0 }), onclick: () => enumDialog(S.wfs.get(wf.id), nm) }), h('span', { class: 'chips' }, (i.enumValues || []).slice(0, 4).map((v) => h('span', { class: 'chipv', text: String(v) })), i.enumValues && i.enumValues.length > 4 ? h('span', { class: 'muted', text: '…' }) : null)); }
    else if (i.kind === 'yesno') {
      const cur = JSON.stringify(i.enumValues), forms = I.YESNO_FORMS, s = h('select', { 'aria-label': T('iu.row.yesnoAria', { v: nm }), data: { in: nm, f: 'yn' } }, forms.map((f) => h('option', { value: JSON.stringify(f), selected: JSON.stringify(f) === cur ? true : null, text: f.join(' / ') })), forms.some((f) => JSON.stringify(f) === cur) ? null : h('option', { value: cur, selected: true, text: (i.enumValues || []).join(' / ') }));
      s.addEventListener('change', () => op(wf, T('iu.row.yesnoLabel', { v: nm }), (dd) => E.setInputEnum(dd, nm, JSON.parse(s.value)), { name: nm, f: 'yn' })); cell.append(s);
    } else if (i.kind === 'customlist' || i.kind === 'datasource') {
      const isDs = i.kind === 'datasource', inp = h('input', { type: 'text', value: (isDs ? i.dataSource : i.customList) || '', list: isDs ? 'dlDataSource' : 'dlCustomList', 'aria-label': T(isDs ? 'iu.row.srcOf' : 'iu.row.listOf', { v: nm }), data: { in: nm, f: 'src' }, autocomplete: 'off' });
      inp.addEventListener('change', () => { if (!inp.value.trim()) { U.setStatus(() => T('iu.row.valueRequired')); inp.value = (isDs ? i.dataSource : i.customList) || ''; return; } op(wf, T(isDs ? 'iu.row.srcLabel' : 'iu.row.listLabel', { v: nm }), (dd) => E.setInputSource(dd, nm, isDs ? { dataSource: inp.value.trim() } : { customList: inp.value.trim() }), { name: nm, f: 'src' }); });
      cell.append(inp);
      if (isDs) { const f = h('input', { type: 'checkbox', checked: i.filterable ? true : null, 'aria-label': T('iu.row.filterableAria', { v: nm }) }); f.addEventListener('change', () => op(wf, T('iu.row.filterableLabel', { v: nm }), (dd) => E.setInputSource(dd, nm, { filterable: f.checked }), { name: nm, f: 'src' })); cell.append(h('label', { class: 'inl' }, f, ' ' + T('iu.row.filterable'))); }
    } else if (i.kind === 'password') {
      const r = i.passwordRules; cell.append(h('button', { type: 'button', 'aria-label': T('iu.row.rulesAria', { v: nm }), data: { in: nm, f: 'rules' }, text: T('iu.row.rules'), onclick: () => rulesDialog(S.wfs.get(wf.id), nm) }), h('small', { class: 'muted', text: r ? ' ' + (r.minLength != null ? T('ui.rule.min', { n: r.minLength }) + ' · ' : '') + T('iu.row.activeRules', { n: Object.keys(r).filter((k) => r[k] === true).length }) : T('iu.row.noRules') }));
    } else if (i.kind === 'datetime') cell.append(h('small', { class: 'muted', text: T('iu.row.datePicker') }));
    // avancé: infobulle, valeur par défaut, JSON brut (expert), note d'incertitude
    const adv = h('details', { class: 'adv' }, h('summary', { text: T('iu.row.advanced') })), tip = h('input', { type: 'text', value: i.tooltip || '', 'aria-label': T('iu.row.tooltipAria', { v: nm }), data: { in: nm, f: 'tip' } }), def = h('input', { type: 'text', value: i.hasDefault ? String(i.defaultValue) : '', 'aria-label': T('iu.row.defaultAria', { v: nm }), data: { in: nm, f: 'def' } });
    tip.addEventListener('change', () => op(wf, T('iu.row.tooltipLabel', { v: nm }), (dd) => E.updateInput(dd, nm, { tooltip: tip.value }), { name: nm, f: 'tip' }));
    def.addEventListener('change', () => op(wf, T('iu.row.defaultLabel', { v: nm }), (dd) => E.updateInput(dd, nm, { default: def.value === '' ? undefined : (i.kind === 'integer' && !isNaN(Number(def.value)) ? Number(def.value) : i.kind === 'boolean' ? def.value === 'true' : def.value) }), { name: nm, f: 'def' }));
    adv.append(labelFor(T('iu.row.tooltip'), tip), labelFor(T('iu.row.default'), def), h('small', { class: 'muted', text: T('iu.row.advNote') }),
      h('button', { type: 'button', class: 'tech', text: T('iu.row.rawJson'), 'aria-label': T('iu.row.rawJsonAria', { v: nm }), onclick: () => rawDialog(S.wfs.get(wf.id), nm) }));
    cell.append(adv); if (I.CERTAINTY[i.kind] === false) cell.append(h('div', { class: 'uncertain', title: I.UNCERTAIN_NOTES[i.kind], text: T('iu.row.uncertain') }));
    return cell;
  }
  function row(wf, i, idx, total, state) {
    const nm = i.name, sel = selOf(wf.id), tr = h('tr', { class: 'inrow-edit', data: { name: nm } });
    const handle = h('button', { type: 'button', class: 'drag', 'aria-label': T('iu.row.dragAria', { v: nm }), title: T('iu.row.drag'), text: '☰' });
    handle.addEventListener('mousedown', () => { tr.draggable = true; }); handle.addEventListener('mouseup', () => { tr.draggable = false; });
    tr.addEventListener('dragstart', (e) => { state.drag = nm; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', nm); } catch (x) { /* */ } tr.classList.add('dragging'); });
    tr.addEventListener('dragend', () => { tr.draggable = false; tr.classList.remove('dragging'); state.drag = null; });
    tr.addEventListener('dragover', (e) => { if (state.drag && state.drag !== nm) { e.preventDefault(); tr.classList.add('dragover'); } }); tr.addEventListener('dragleave', () => tr.classList.remove('dragover'));
    tr.addEventListener('drop', (e) => { e.preventDefault(); tr.classList.remove('dragover'); const from = state.drag; state.drag = null; if (from && from !== nm) op(wf, T('iu.row.moveLabel', { v: from }), (dd) => E.moveInput(dd, from, { to: idx }), { name: from, f: 'up' }); });
    const chk = h('input', { type: 'checkbox', checked: sel.has(nm) ? true : null, 'aria-label': T('iu.row.selectAria', { v: nm }) }); chk.addEventListener('change', () => { if (chk.checked) sel.add(nm); else sel.delete(nm); });
    const up = h('button', { type: 'button', 'aria-label': T('iu.row.upAria', { v: nm }), data: { in: nm, f: 'up' }, text: '↑', disabled: idx === 0 ? true : null, onclick: () => op(wf, T('iu.row.upLabel', { v: nm }), (dd) => E.moveInput(dd, nm, { dir: 'up' }), { name: nm, f: 'up' }) });
    const down = h('button', { type: 'button', 'aria-label': T('iu.row.downAria', { v: nm }), data: { in: nm, f: 'down' }, text: '↓', disabled: idx === total - 1 ? true : null, onclick: () => op(wf, T('iu.row.downLabel', { v: nm }), (dd) => E.moveInput(dd, nm, { dir: 'down' }), { name: nm, f: 'down' }) });
    const kinds = I.SELECTABLE.indexOf(i.kind) >= 0 ? I.SELECTABLE : I.SELECTABLE.concat([i.kind]);
    const kindSel = h('select', { 'aria-label': T('iu.row.typeOf', { v: nm }), data: { in: nm, f: 'kind' } }, kinds.map((k) => h('option', { value: k, selected: k === i.kind ? true : null, text: kindLabel(k) + (I.SELECTABLE.indexOf(k) < 0 ? T('iu.row.notEditable') : '') })));
    kindSel.addEventListener('change', () => { if (I.SELECTABLE.indexOf(kindSel.value) >= 0) changeKind(wf, nm, kindSel.value, kindSel, i.kind); else kindSel.value = i.kind; });
    const tcell = h('td', null, kindSel);
    if (i.kind === 'target') { const ts = h('select', { 'aria-label': T('iu.row.targetOf', { v: nm }), data: { in: nm, f: 'target' } }, Object.keys(I.TARGET_TYPES).map((t) => h('option', { value: t, selected: t === i.targetType ? true : null, text: I.TARGET_TYPES[t] })), I.TARGET_TYPES[i.targetType] ? null : h('option', { value: i.targetType, selected: true, text: i.targetType })); ts.addEventListener('change', () => op(wf, T('iu.row.targetLabel', { v: nm }), (dd) => E.setInputKind(dd, nm, 'target', { targetType: ts.value }), { name: nm, f: 'target' })); tcell.append(ts); }
    const req = h('input', { type: 'checkbox', checked: i.required ? true : null, 'aria-label': T('iu.row.requiredAria', { v: nm }), data: { in: nm, f: 'req' } }); req.addEventListener('change', () => op(wf, T(req.checked ? 'iu.row.makeRequired' : 'iu.row.makeOptional', { v: nm }), (dd) => E.updateInput(dd, nm, { required: req.checked }), { name: nm, f: 'req' }));
    const title = h('input', { type: 'text', value: i.title || '', 'aria-label': T('iu.row.titleOf', { v: nm }), data: { in: nm, f: 'title' } }); title.addEventListener('change', () => op(wf, T('iu.row.titleLabel', { v: nm }), (dd) => E.updateInput(dd, nm, { title: title.value }), { name: nm, f: 'title' }));
    const dstr = typeof i.description === 'string' ? i.description : '', desc = h('input', { type: 'text', value: dstr, 'aria-label': T('iu.row.descOf', { v: nm }), data: { in: nm, f: 'desc' }, placeholder: i.description == null ? T('ui.det.noneF') : '' }); desc.addEventListener('change', () => op(wf, T('iu.row.descLabel', { v: nm }), (dd) => E.updateInput(dd, nm, { inputDescription: desc.value }), { name: nm, f: 'desc' }));
    const used = usedBy(wf, nm);
    tr.append(h('td', { class: 'inctl' }, handle, up, down, chk),
      h('td', null, h('code', { text: nm }), h('div', { class: 'muted', text: used ? T('iu.row.usedBy', { n: used }) : T('iu.row.notUsed') }), h('button', { type: 'button', class: 'linkbtn', 'aria-label': T('iu.row.renameAria', { v: nm }), data: { in: nm, f: 'name' }, text: T('iu.row.rename'), onclick: () => renameDialog(S.wfs.get(wf.id), nm) })),
      tcell, h('td', null, req), h('td', null, title), h('td', null, desc), detailsCell(wf, i),
      h('td', { class: 'inact' }, h('button', { type: 'button', 'aria-label': T('iu.row.dupAria', { v: nm }), data: { in: nm, f: 'dup' }, text: '⧉', title: T('iu.row.dup'), onclick: () => op(wf, T('iu.row.dupLabel', { v: nm }), (dd) => E.duplicateInput(dd, nm), { name: nm, f: 'dup' }) }),
        h('button', { type: 'button', 'aria-label': T('iu.row.delAria', { v: nm }), data: { in: nm, f: 'del' }, text: '🗑', title: T('iu.row.del'), onclick: () => op(wf, T('iu.row.delLabel', { v: nm }), (dd) => E.deleteInput(dd, nm), null) })));
    return tr;
  }

  function buildEditor(wf) {
    const pr = I.parseInputs(wf), box = h('div', { class: 'inputsEditor', id: 'inputsEditor' });
    if (!pr.ok || !pr.raw) { add(box, h('div', { class: 'errmsg', text: T(pr.ok ? 'iu.ed.noSchema' : 'iu.ed.unreadable') })); return box; }
    const state = { drag: null }, n = pr.inputs.length;
    add(box, datalist('dlDataSource', knownValues('x-cv-data-source')), datalist('dlCustomList', knownValues('x-cv-custom-list')),
      h('div', { class: 'toolbar' }, h('strong', { text: T('iu.ed.title') }), h('button', { type: 'button', id: 'btnAddInputOpen', class: 'primary', text: T('iu.ed.add'), onclick: () => addDialog(S.wfs.get(wf.id)) }), h('button', { type: 'button', id: 'btnCopyInputs', text: T('iu.ed.copy'), onclick: () => copyDialog(S.wfs.get(wf.id)) }),
        h('small', { class: 'muted', text: T('iu.ed.help', { n: n }) })));
    if (!n) add(box, h('p', { class: 'muted', text: T('iu.ed.none') }));
    else add(box, h('div', { class: 'gridwrap' }, h('table', { class: 'grid inputs-edit' }, h('caption', { class: 'visually-hidden', text: T('iu.ed.caption') }),
      h('thead', null, h('tr', null, [T('iu.ed.h.order'), T('ui.in.h.name'), T('ui.in.h.type'), T('ui.in.h.required'), T('iu.ed.h.title'), T('ui.in.h.desc'), T('iu.ed.h.details'), T('iu.ed.h.actions')].map((t) => h('th', { scope: 'col', text: t })))), h('tbody', null, pr.inputs.map((i, idx) => row(wf, i, idx, n, state))))));
    return box;
  }

  const prev = hooks.decorateDetail;
  hooks.decorateDetail = (root, wf) => {
    if (prev) prev(root, wf);
    if (!S.editing.has(wf.id)) return;
    const h2 = [...root.querySelectorAll('h2')].find((x) => x.textContent === 'Inputs'); if (!h2) return;
    const ro = h2.nextElementSibling; if (ro) ro.hidden = true; // tableau en lecture seule remplacé par l'éditeur
    h2.after(buildEditor(wf));
    const rf = S.inRefocus; S.inRefocus = null;
    if (rf) setTimeout(() => { const el = root.querySelector('[data-in="' + String(rf.name).replace(/["\\]/g, '') + '"][data-f="' + rf.f + '"]'); if (el) el.focus(); }, 0);
  };
  W.inputsUi = { addDialog, renameDialog, enumDialog, rulesDialog, rawDialog, copyDialog, buildEditor, knownValues };
})();
