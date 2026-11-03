/* edit-ui.js - interface d'édition / export (DOM). Toute valeur affichée passe par textContent.
   AVERTISSEMENT: le format exigé par CoreView à l'import n'est pas vérifié. Tout export est à valider par un import test. */
(function () {
  'use strict';
  const U = window.WFV.ui, E = window.WFV.edit, model = window.WFV.model, refs = window.WFV.refs, diffApi = window.WFV.diff, natives = window.WFV.natives;
  const { S, h, hooks, short, add } = U;
  S.sessions = new Map(); S.origs = new Map(); S.editing = new Set();
  const WARN = '⚠ Export non vérifié côté CoreView : à valider par un import test avant tout usage en production.';

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
    if (!dlg) { dlg = h('dialog', { class: 'editdlg', 'aria-label': 'Édition' }); document.body.append(dlg); }
    const close = () => { try { dlg.close(); } catch (e) { /* déjà fermé */ } };
    const foot = h('div', { class: 'dlgfoot' }, (actions || []).map((a) => h('button', { type: 'button', class: a.primary ? 'primary' : '', id: a.id, text: a.text, onclick: () => a.onclick(close) })), h('button', { type: 'button', text: 'Fermer', onclick: close }));
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
    if (!t.res || !t.res.ok) { toast('Refusé: ' + ((t.res && t.res.error) || 'opération invalide')); if (opts.onError) opts.onError((t.res && t.res.error) || 'opération invalide'); return false; }
    const lines = (t.res.warnings || []).slice();
    t.newBroken.forEach((b) => lines.push('référence cassée: ' + b.token + ' dans « ' + b.node + ' » (' + b.reason + ')'));
    const v = t.after; if (v && v.errors.length) { toast('Refusé: ' + v.errors[0]); if (opts.onError) opts.onError(v.errors.join(' ; ')); return false; }
    const doIt = () => { const r = E.run(s, label, fn); if (!r.ok) { toast('Refusé: ' + r.error); return; } sync(wfId); toast(label + (r.noop ? ' (aucun changement)' : ' — appliqué')); if (opts.after) opts.after(r); };
    if (lines.length && !opts.noConfirm) {
      dialog('Confirmer: ' + label, h('div', null, h('p', { text: 'Cette opération produit des avertissements :' }), listBox(lines.slice(0, 40)), lines.length > 40 ? h('p', { class: 'muted', text: '… +' + (lines.length - 40) }) : null),
        [{ text: 'Appliquer quand même', primary: true, onclick: (close) => { close(); doIt(); } }]);
    } else doIt();
    return true;
  }

  // ---------- barre d'édition (en-tête du détail) ----------
  function dirtyOf(id) { const s = S.sessions.get(id); return !!(s && E.isDirty(s)); }
  function editBar(wf) {
    const editing = S.editing.has(wf.id), s = S.sessions.get(wf.id), dirty = dirtyOf(wf.id);
    const bar = h('div', { class: 'editbar' + (editing ? ' on' : '') });
    if (!editing) {
      add(bar, h('button', { type: 'button', id: 'btnEdit', text: '✎ Mode édition', onclick: () => { ensureSession(wf); S.editing.add(wf.id); U.render(); } }),
        dirty ? h('span', { class: 'badge mod', text: '● modifié' }) : null, dirty ? h('button', { type: 'button', text: 'Exporter…', onclick: () => exportDialog(wf) }) : null,
        h('small', { class: 'muted', text: ' Lecture seule tant que le mode édition n\'est pas activé. ' }), h('small', { class: 'warnnote', text: WARN }));
      return bar;
    }
    add(bar, h('strong', { text: '✎ Édition' }), dirty ? h('span', { class: 'badge mod', id: 'dirtyBadge', text: '● modifié' }) : h('span', { class: 'badge', text: 'inchangé' }),
      h('button', { type: 'button', id: 'btnUndo', text: '↶ Annuler', disabled: s && s.undo.length ? null : true, title: s && s.undo.length ? 'Annuler: ' + s.undo[s.undo.length - 1].label + ' (Ctrl+Z)' : 'Rien à annuler', onclick: () => doUndo(wf.id) }),
      h('button', { type: 'button', id: 'btnRedo', text: '↷ Rétablir', disabled: s && s.redo.length ? null : true, title: 'Ctrl+Y / Ctrl+Maj+Z', onclick: () => doRedo(wf.id) }),
      h('button', { type: 'button', text: 'Infos…', onclick: () => infoDialog(wf) }),
      h('button', { type: 'button', id: 'btnSR', text: 'Rechercher/remplacer…', onclick: () => searchDialog(wf) }),
      h('button', { type: 'button', text: 'Renommer un input…', onclick: () => renameInputDialog(wf) }),
      h('button', { type: 'button', id: 'btnExport', class: 'primary', text: 'Valider / Exporter…', onclick: () => exportDialog(wf) }),
      h('button', { type: 'button', text: 'Quitter l\'édition', onclick: () => { S.editing.delete(wf.id); U.render(); } }),
      h('div', null, h('small', { class: 'warnnote', text: WARN })));
    return bar;
  }
  function doUndo(id) { const s = S.sessions.get(id); if (s && E.undo(s)) { sync(id); toast('Annulé'); } }
  function doRedo(id) { const s = S.sessions.get(id); if (s && E.redo(s)) { sync(id); toast('Rétabli'); } }
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
    dialog('Informations du workflow', h('div', null, field('Nom', name), field('Description', desc), field('Statut', st), err), [{ text: 'Appliquer', primary: true, id: 'btnApplyInfo', onclick: (close) => {
      const ok = apply(wf.id, 'Modifier nom/description/statut', (d) => {
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
      if (kind === 'num') { const x = Number(raw); return raw === '' || isNaN(x) ? { ok: false, error: 'nombre invalide' } : { ok: true, value: x }; }
      if (kind === 'list') return { ok: true, value: raw.split('\n').filter((l) => l !== '').map((l) => (typeof v[0] === 'number' && l.trim() !== '' && !isNaN(Number(l)) ? Number(l) : l)) };
      if (kind === 'json') { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: 'JSON invalide: ' + e.message }; } }
      return { ok: true, value: raw };
    };
    const refresh = () => {
      const p = parse(); err.textContent = p.ok ? '' : p.error; live.replaceChildren();
      const strs = []; if (p.ok) refs.walkStrings(p.value, '', (s) => strs.push(s));
      const toks = strs.flatMap((s) => refs.extractTokens(s)); if (toks.length) live.append(h('div', { class: 'muted', text: toks.length + ' référence(s) {{…}} :' }), h('div', null, toks.map((t) => (t.malformed ? h('span', { class: 'pill bad static', title: t.reason, text: '⚠ ' + t.raw }) : h('span', { class: 'pill ' + (t.kind === 'action' ? 'action' : 'input') + ' static', text: t.kind === 'action' ? (wf.uidMap[t.uid] ? (wf.uidMap[t.uid].name + ' › ' + (t.path || '')) : 'uid inconnu › ' + (t.path || '')) : (t.param || t.raw) })))));
    };
    inp.addEventListener('input', refresh); refresh();
    dialog('Modifier le setting « ' + key + ' »  —  ' + (n.name || n.path), h('div', null, h('small', { class: 'muted', text: 'Type: ' + kind + (kind === 'list' ? ' (une valeur par ligne)' : '') + '. Les pastilles {{…}} s\'éditent en texte brut ; la syntaxe est validée.' }), inp, live, err), [{ text: 'Appliquer', primary: true, id: 'btnApplyLeaf', onclick: (close) => {
      const p = parse(); if (!p.ok) { err.textContent = p.error; return; }
      apply(wf.id, 'Modifier ' + key + ' (' + (n.name || n.path) + ')', (d) => E.setSetting(d, n.uid, [key], p.value), { onError: (m) => { err.textContent = m; }, after: () => close() });
    } }]);
  }
  function settingsEditor(n, wf) {
    const set = model.nodeSettings(n); const keys = Object.keys(set && typeof set === 'object' ? set : {});
    const d = h('details', { class: 'sub seteditor' }, h('summary', { text: '✎ Éditer les settings (' + keys.length + ')' }));
    d.append(h('table', { class: 'grid' }, h('tbody', null, keys.map((k) => {
      const v = set[k], kind = leafKind(v);
      return h('tr', null, h('td', null, h('code', { text: k })), h('td', { text: kind }), h('td', { class: 'mono clip', text: short(typeof v === 'string' ? v : JSON.stringify(v), 160) }), h('td', null, h('button', { type: 'button', class: 'editleaf', 'aria-label': 'Modifier ' + k, text: '✎', onclick: () => leafDialog(n, wf, k, v) })));
    }))));
    return d;
  }

  // ---------- (f) actions sur les nodes ----------
  function destinations(wf, n) {
    const bad = new Set(); (function mark(x) { bad.add(x.uid); x.children.forEach(mark); x.trueBranch.forEach(mark); x.falseBranch.forEach(mark); })(n);
    const out = [{ label: 'Racine — actions', dest: { top: 'actions' } }, { label: 'Racine — catchActions', dest: { top: 'catchActions' } }];
    wf.all.forEach((x) => {
      if (bad.has(x.uid)) return;
      if (x.kind === 'sequence' && n.kind !== 'sequence') out.push({ label: 'Dans la séquence « ' + (x.name || x.path) + ' »', dest: { childOf: x.uid } });
      if (x.kind === 'if') { out.push({ label: 'Branche VRAI de « ' + (x.name || x.path) + ' »', dest: { branch: 'trueBranch', of: x.uid } }, { label: 'Branche FAUX de « ' + (x.name || x.path) + ' »', dest: { branch: 'falseBranch', of: x.uid } }); }
    });
    return out;
  }
  function nodeNameDialog(n, wf) {
    const nm = h('input', { type: 'text', id: 'inNodeName', value: n.raw.name || '' }), cd = h('input', { type: 'text', id: 'inNodeDesc', value: n.raw.customDescription || '' }), fs = h('input', { type: 'checkbox', checked: n.raw.forceSkip ? true : null });
    const err = h('div', { class: 'errmsg', role: 'alert' });
    dialog('Node: nom / description / forceSkip', h('div', null, field('Nom', nm), field('Description personnalisée', cd), h('label', null, fs, ' forceSkip (ignorer ce node)'), err), [{ text: 'Appliquer', primary: true, onclick: (close) => {
      apply(wf.id, 'Modifier le node « ' + (n.name || n.path) + ' »', (d) => {
        for (const [k, v] of [['name', nm.value], ['customDescription', cd.value === '' && n.raw.customDescription == null ? null : cd.value], ['forceSkip', fs.checked]]) { const cur = E.findNode(d, n.uid).node[k]; if (cur === v || (cur == null && v == null)) continue; const r = E.setNodeField(d, n.uid, k, v); if (!r.ok) return r; }
        return { ok: true, warnings: [] };
      }, { onError: (m) => { err.textContent = m; }, after: () => close() });
    } }]);
  }
  function moveDialog(n, wf) {
    const ds = destinations(wf, n), sel = h('select', { id: 'selDest' }, ds.map((d, i) => h('option', { value: i, text: d.label })));
    dialog('Déplacer « ' + (n.name || n.path) + ' » vers…', h('div', null, field('Destination', sel), h('small', { class: 'muted', text: 'Le node (et ses enfants/branches) est placé à la fin de la destination.' })), [{ text: 'Déplacer', primary: true, onclick: (close) => { apply(wf.id, 'Déplacer « ' + (n.name || n.path) + ' »', (d) => E.moveTo(d, n.uid, ds[Number(sel.value)].dest), { after: () => close() }); } }]);
  }
  function allTypes(excludeId) {
    const m = new Map(); S.wfs.forEach((w) => w.all.forEach((x) => { if (x.id.indexOf('item::') === 0) return; if (!m.has(x.id)) m.set(x.id, x); }));
    return m;
  }
  function replaceActionDialog(n, wf) {
    const types = allTypes(); const dl = h('datalist', { id: 'typesList' }, [...types.keys()].sort().map((id) => h('option', { value: id, label: (types.get(id).raw.categoryItemName || types.get(id).name || '') })));
    const target = h('input', { type: 'text', id: 'inNewType', list: 'typesList', placeholder: 'ex: Management|…RemoveSecurityGroupMember', value: '' });
    const set = model.nodeSettings(n) || {}, keys = Object.keys(set);
    const mapInputs = {}; const mapBox = h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['Clé actuelle', 'Clé du type cible (vide = supprimer)'].map((t) => h('th', { text: t })))),
      h('tbody', null, keys.map((k) => { const i = h('input', { type: 'text', value: k, 'aria-label': 'clé cible pour ' + k }); mapInputs[k] = i; return h('tr', null, h('td', null, h('code', { text: k })), h('td', null, i)); })));
    const info = h('div', { class: 'muted' }), warn = h('div', { class: 'warnlist' }), err = h('div', { class: 'errmsg', role: 'alert' });
    const build = () => {
      const id = target.value.trim(), tpl = types.get(id); const mapping = {}; keys.forEach((k) => { const v = mapInputs[k].value.trim(); if (v !== k) mapping[k] = v === '' ? null : v; });
      return { id, tpl: tpl ? tpl.raw : null, mapping };
    };
    const refresh = () => {
      const b = build(); info.textContent = b.tpl ? '✓ exemple trouvé dans le lot (catalogue copié depuis un node du même type)' : (b.id ? '⚠ aucun node de ce type dans le lot : le catalogue ne sera pas mis à jour' : '');
      warn.replaceChildren(); if (!b.id) return;
      const t = E.trial(ensureTemp(wf), (d) => E.replaceNodeType(d, n.uid, { newId: b.id, template: b.tpl, mapping: b.mapping })); err.textContent = t.res.ok ? '' : t.res.error;
      if (t.res.ok) { warn.append(...(t.res.warnings || []).map((w) => h('div', { text: '⚠ ' + w })), ...t.newBroken.map((x) => h('div', { text: '⚠ référence cassée: ' + x.token }))); }
    };
    [target, ...Object.values(mapInputs)].forEach((i) => i.addEventListener('input', refresh));
    dialog('Remplacer l\'action « ' + (n.name || n.path) + ' »', h('div', null, dl, h('p', { class: 'muted', text: 'Type actuel: ' + n.id }), field('Nouveau type (id complet)', target), info, h('h3', { text: 'Mapping des settings' }), mapBox, warn, err), [{ text: 'Remplacer', primary: true, id: 'btnApplyType', onclick: (close) => {
      const b = build(); if (!b.id) { err.textContent = 'type cible manquant'; return; }
      apply(wf.id, 'Remplacer le type de « ' + (n.name || n.path) + ' »', (d) => E.replaceNodeType(d, n.uid, { newId: b.id, template: b.tpl, mapping: b.mapping }), { onError: (m) => { err.textContent = m; }, after: () => close() });
    } }]);
  }
  // session temporaire pour les aperçus (n'altère jamais la session réelle)
  function ensureTemp(wf) { return E.createSession(wf); }

  hooks.decorateNode = (d, body, n, wf) => {
    if (!S.editing.has(wf.id)) return;
    const mk = (text, title, fn, id) => h('button', { type: 'button', class: 'nodebtn', title, 'aria-label': title, id, text, onclick: (e) => { e.stopPropagation(); fn(); } });
    const bar = h('div', { class: 'nodeactions' }, mk('✎ Nom', 'Renommer / description / forceSkip', () => nodeNameDialog(n, wf)),
      mk('↑', 'Monter', () => apply(wf.id, 'Monter « ' + (n.name || n.path) + ' »', (dd) => E.moveNode(dd, n.uid, 'up'))), mk('↓', 'Descendre', () => apply(wf.id, 'Descendre « ' + (n.name || n.path) + ' »', (dd) => E.moveNode(dd, n.uid, 'down'))),
      mk('→ Déplacer…', 'Déplacer vers une séquence / branche / racine', () => moveDialog(n, wf)),
      mk('⧉ Dupliquer', 'Dupliquer (nouveaux uid)', () => apply(wf.id, 'Dupliquer « ' + (n.name || n.path) + ' »', (dd) => E.duplicateNode(dd, n.uid), { noConfirm: false }), 'dup-' + n.uid),
      mk('🗑 Supprimer', 'Supprimer (avec ses enfants/branches)', () => apply(wf.id, 'Supprimer « ' + (n.name || n.path) + ' »', (dd) => E.deleteNode(dd, n.uid)), 'del-' + n.uid),
      n.id.indexOf('item::') === 0 ? null : mk('⇄ Remplacer l\'action…', 'Changer le type du node', () => replaceActionDialog(n, wf)));
    const first = body.firstChild; body.insertBefore(bar, first);
    const set = model.nodeSettings(n); if (set && Object.keys(set).length) body.insertBefore(settingsEditor(n, wf), first.nextSibling);
  };

  // ---------- (c)(d)(e) opérations en masse avec aperçu ----------
  function targetsFor(scope, wf) {
    if (scope === 'checked') return S.checked.map((id) => S.wfs.get(id)).filter(Boolean);
    if (scope === 'listed') return U.shownIds().map((id) => S.wfs.get(id)).filter(Boolean);
    return [wf];
  }
  const scopeSelect = (wf) => h('select', { id: 'selScope', 'aria-label': 'Portée' }, h('option', { value: 'current', text: 'Workflow courant' }), h('option', { value: 'checked', text: 'Workflows cochés (' + S.checked.length + ')' }), h('option', { value: 'listed', text: 'Tous les workflows de la liste filtrée (' + U.shownIds().length + ')' }));
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
    return h('div', null, h('div', { class: 'summary' }, h('span', { class: 'badge mod', id: 'prevCount', text: p.total + ' occurrence(s) dans ' + p.wfCount + ' workflow(s)' })),
      p.errs.length ? h('div', { class: 'warnlist' }, p.errs.slice(0, 8).map((e) => h('div', { text: '⚠ ' + e }))) : null,
      h('div', { class: 'scrollbox' }, h('table', { class: 'grid' }, h('thead', null, h('tr', null, ['Workflow', 'Node', 'Où', 'Avant', 'Après'].map((t) => h('th', { text: t })))),
        h('tbody', null, p.rows.slice(0, 200).map((r) => h('tr', null, h('td', { text: r.wf.name }), h('td', { text: r.c.nodeName || '' }), h('td', { class: 'mono', text: r.c.where }), h('td', { class: 'before mono', text: short(r.c.before, 300) }), h('td', { class: 'after mono', text: short(r.c.after, 300) })))))),
      p.rows.length > 200 ? h('small', { class: 'muted', text: '… ' + (p.rows.length - 200) + ' lignes non affichées' }) : null);
  }
  function applyBulk(targets, label, makeFn, close) {
    const ids = [];
    targets.forEach((w) => { const s = ensureSession(S.wfs.get(w.id)); const r = E.run(s, label, makeFn()); if (r.ok && !r.noop) ids.push(w.id); });
    if (ids.length) sync(ids); else U.render();
    toast(label + ' — ' + ids.length + ' workflow(s) modifié(s)'); close();
  }
  function bulkDialog(title, wf, formEl, makeFn, label, extraActions) {
    const out = h('div', { id: 'bulkOut' }), scope = scopeSelect(wf);
    const run = () => { const p = bulkPreview(targetsFor(scope.value, wf), makeFn); out.replaceChildren(previewTable(p)); return p; };
    dialog(title, h('div', null, formEl, field('Portée', scope), out), [{ text: 'Aperçu', id: 'btnPreview', onclick: run }, { text: 'Appliquer', primary: true, id: 'btnApplyBulk', onclick: (close) => {
      const p = run(); if (!p.total) { toast('Aucune occurrence'); return; }
      const targets = targetsFor(scope.value, wf); if (targets.length > 1 && !window.confirm('Appliquer ' + p.total + ' remplacement(s) dans ' + p.wfCount + ' workflow(s) ?')) return;
      applyBulk(targets, label, makeFn, close);
    } }].concat(extraActions || []));
    return { run, scope };
  }
  function searchDialog(wf) {
    const find = h('input', { type: 'text', id: 'inFind' }), rep = h('input', { type: 'text', id: 'inRepl' }), rx = h('input', { type: 'checkbox' }), cs = h('input', { type: 'checkbox' });
    const sSet = h('input', { type: 'checkbox', checked: true }), sFil = h('input', { type: 'checkbox', checked: true }), sNam = h('input', { type: 'checkbox' });
    const fnFrom = h('input', { type: 'text', id: 'inFnFrom', placeholder: 'removeSpaces' }), fnTo = h('input', { type: 'text', id: 'inFnTo', placeholder: 'truncate' }), fnArgs = h('input', { type: 'text', id: 'inFnArgs', placeholder: '(vide = conserver les arguments)' });
    const mode = h('select', { id: 'selMode' }, h('option', { value: 'text', text: 'Texte / regex dans les settings et filtres' }), h('option', { value: 'fn', text: 'Fonction de token : removeSpaces(…) → truncate(…)' }));
    const textForm = h('div', { id: 'formText' }, field('Rechercher', find), field('Remplacer par', rep), h('label', null, rx, ' expression régulière (le remplacement accepte $1…)'), h('label', null, cs, ' respecter la casse'), h('div', { class: 'row' }, h('label', null, sSet, ' settings'), h('label', null, sFil, ' filtres'), h('label', null, sNam, ' noms/descriptions des nodes')));
    const fnForm = h('div', { id: 'formFn', hidden: true }, field('Fonction actuelle', fnFrom), field('Nouvelle fonction', fnTo), field('Arguments de remplacement', fnArgs, 'Laisser vide pour conserver les arguments d\'origine'));
    mode.onchange = () => { textForm.hidden = mode.value !== 'text'; fnForm.hidden = mode.value !== 'fn'; };
    const makeFn = () => (mode.value === 'text'
      ? (d) => E.findReplace(d, { find: find.value, replace: rep.value, regex: rx.checked, caseSensitive: cs.checked, settings: sSet.checked, filters: sFil.checked, names: sNam.checked })
      : (d) => E.replaceFunction(d, { from: fnFrom.value.trim(), to: fnTo.value.trim(), args: fnArgs.value === '' ? null : fnArgs.value }));
    bulkDialog('Rechercher / remplacer (structuré)', wf, h('div', null, field('Mode', mode), textForm, fnForm), makeFn, 'Rechercher/remplacer');
  }
  function renameInputDialog(wf) {
    const props = Object.keys((model.parseJsonField(wf.data.inputSchema) || {}).properties || {});
    const sel = h('select', { id: 'selInput' }, props.map((p) => h('option', { value: p, text: p }))), nn = h('input', { type: 'text', id: 'inNewInput' });
    bulkDialog('Renommer un input partout', wf, h('div', null, field('Input à renommer', sel), field('Nouveau nom', nn), h('small', { class: 'muted', text: 'Met à jour inputSchema (propriétés, required, titre identique) et toutes les références {{input::input-stepUid::nom::…}} des settings, filtres et cibles.' })),
      () => (d) => E.renameInput(d, sel.value, nn.value.trim()), 'Renommer l\'input');
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
      h('p', { class: 'warnnote', text: WARN }),
      h('p', null, h('b', { text: cur.name }), ' — ', dirty ? h('span', { class: 'badge mod', text: '● modifié' }) : h('span', { class: 'badge', text: 'inchangé (l\'export sera identique octet pour octet au fichier d\'origine)' })),
      h('div', { class: 'summary' }, h('span', { class: 'badge add', text: sm.added + ' node(s) ajouté(s)' }), h('span', { class: 'badge del', text: sm.removed + ' supprimé(s)' }), h('span', { class: 'badge mod', text: sm.modified + ' modifié(s)' }), h('span', { class: 'badge', text: dres.header.length + ' diff. d\'en-tête' }), dres.inputs ? h('span', { class: 'badge', text: dres.inputs.changed + ' input(s)' }) : null),
      h('button', { type: 'button', id: 'btnFullDiff', text: 'Voir le diff complet (original → modifié)', onclick: () => { dlg.close(); U.setHash({ wf: 'orig:' + wf.id, cmp: wf.id, tab: 'compare' }); } }),
      h('h3', { text: 'Validation avant export' }),
      v.errors.length ? h('div', null, h('b', { class: 'bad', text: v.errors.length + ' erreur(s) bloquante(s)' }), listBox(v.errors.slice(0, 20), 'errlist')) : h('div', { id: 'valOk', text: '✓ JSON valide, uid uniques, séquences/branches cohérentes' }),
      h('div', { text: v.broken.length ? '⚠ ' + v.broken.length + ' référence(s) {{action::…}} cassée(s) (dont celles déjà présentes à l\'origine)' : '✓ toutes les références {{action::…}} sont résolues' }),
      v.broken.length ? listBox(v.broken.slice(0, 10).map((b) => b.node + ': ' + b.token + ' (' + b.reason + ')')) : null,
      listBox(v.warnings.slice(0, 10)),
      s.style.exact ? h('div', { class: 'muted', text: 'Style du fichier détecté et reproduit : ' + s.style.name + (s.style.bom ? ' + BOM' : '') + (s.style.eol === '\r\n' ? ', CRLF' : ', LF') + (s.style.trailing ? ', saut de ligne final' : ', sans saut de ligne final') }) : h('div', { class: 'warnlist', text: '⚠ Le style du fichier d\'origine n\'a pas pu être reproduit à l\'identique (re-sérialisation compacte).' }),
      h('h3', { text: 'Options (décochées par défaut)' }),
      h('label', null, optVol, ' mettre à jour updatedAt / updatedDate (champs volatils)'), h('br'),
      h('label', null, optForce, ' exporter malgré les erreurs de validation'), h('br'),
      h('label', null, optPicker, ' choisir l\'emplacement (File System Access, si disponible)'), h('br'),
      h('label', null, optSuffix, ' ajouter le suffixe « .modifié » au nom de fichier'));
    const doExport = async (wfs, close) => {
      for (const w of wfs) {
        const ss = S.sessions.get(w.id); const vv = E.validate(E.dataOf(ss.root));
        if (vv.errors.length && !optForce.checked) { toast('Export bloqué pour ' + w.name + ' (erreurs de validation)'); continue; }
        const text = E.exportText(ss, { touchVolatile: optVol.checked }); let name = baseName(ss.file); if (optSuffix.checked) name = name.replace(/\.json$/i, '') + '.modifié.json';
        try { if (optPicker.checked) await saveAs(name, text); else download(name, text); toast('Exporté: ' + name + ' (' + text.length + ' car.) — à valider par un import test'); } catch (e) { if (e.name !== 'AbortError') toast('Erreur d\'export: ' + e.message); }
      }
      close();
    };
    dialog('Valider / Exporter', body, [{ text: 'Exporter ce workflow (.json)', primary: true, id: 'btnDoExport', onclick: (close) => doExport([cur], close) }].concat(dirtyAll.length > 1 ? [{ text: 'Exporter les ' + dirtyAll.length + ' workflows modifiés', id: 'btnExportAll', onclick: (close) => doExport(dirtyAll.map((id) => S.wfs.get(id)), close) }] : []));
  }

  window.WFV.editUi = { ensureSession, apply, sync, exportDialog, searchDialog, infoDialog, doUndo, doRedo, download };
  // bandeau d'avertissement global dans la barre du haut quand des modifications existent
  U.render();
})();
