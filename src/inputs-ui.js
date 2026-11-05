/* inputs-ui.js - éditeur tabulaire des inputs d'un workflow (inputSchema.properties), intégré à la section Inputs en mode édition.
   Toutes les modifications passent par le moteur d'édition (src/edit.js): clone, undo/redo, trial avec avertissements, validation, export fidèle.
   Aucune valeur n'est interprétée comme HTML (textContent), aucun style en ligne (CSP stricte). */
(function () {
  'use strict';
  const W = window.WFV, U = W.ui, EU = W.editUi, E = W.edit, I = W.inputs, model = W.model;
  const { S, h, hooks, add, short } = U;
  const kindLabel = (k) => (k === 'integer' ? 'Nombre entier' : k === 'target' ? 'Cible (utilisateur, boîte, groupe…)' : I.KINDS[k] ? I.KINDS[k].label : k);
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
    const tgt = h('select', { id: 'selAddTarget', class: 'hidden', 'aria-label': 'Type de cible' }, Object.keys(I.TARGET_TYPES).map((t) => h('option', { value: t, text: I.TARGET_TYPES[t] })));
    const req = h('input', { type: 'checkbox', id: 'chkAddReq' }), vals = h('textarea', { id: 'taAddValues', rows: 5, class: 'hidden', placeholder: 'Une valeur par ligne' });
    const src = h('input', { type: 'text', id: 'inAddSrc', class: 'hidden', autocomplete: 'off' }), filt = h('input', { type: 'checkbox', id: 'chkAddFilt', checked: true });
    const filtLbl = h('label', { class: 'hidden', id: 'lblAddFilt' }, filt, ' source filtrable');
    const note = h('div', { class: 'muted', id: 'addNote' }), msg = h('div', { class: 'errmsg', role: 'alert', id: 'addErr' });
    const dl = datalist('dlAddSrc', []);
    const refresh = () => {
      const k = kind.value; tgt.classList.toggle('hidden', k !== 'target'); vals.classList.toggle('hidden', k !== 'enum'); src.classList.toggle('hidden', k !== 'datasource' && k !== 'customlist'); filtLbl.classList.toggle('hidden', k !== 'datasource');
      if (k === 'datasource' || k === 'customlist') { src.setAttribute('aria-label', k === 'datasource' ? 'Source de données' : 'Identifiant de la liste personnalisée'); src.placeholder = k === 'datasource' ? 'source de données (suggestions: déjà vues)' : 'identifiant de liste (suggestions: déjà vus)'; dl.replaceChildren(...knownValues(k === 'datasource' ? 'x-cv-data-source' : 'x-cv-custom-list').map((v) => h('option', { value: v }))); src.setAttribute('list', 'dlAddSrc'); }
      note.textContent = I.CERTAINTY[k] === false ? 'ⓘ ' + I.UNCERTAIN_NOTES[k] : '';
      const v = I.validateName(name.value, props, null); msg.textContent = v.error || (v.warning ? '⚠ ' + v.warning : '');
    };
    [name, kind].forEach((c) => c.addEventListener('input', refresh)); refresh();
    EU.dialog('Ajouter un input', h('div', null, labelFor('Nom (utilisé dans les références {{input::…::nom::…}})', name), labelFor('Type', kind), tgt, h('label', null, req, ' requis'), vals, labelFor('Valeur', src), filtLbl, dl, note, msg),
      [{ text: 'Ajouter', primary: true, id: 'btnAddInput', onclick: (close) => {
        const k = kind.value; if ((k === 'datasource' || k === 'customlist') && !src.value.trim()) { msg.textContent = 'renseignez ' + (k === 'datasource' ? 'la source de données' : 'l\'identifiant de la liste'); return; }
        op(wf, 'Ajouter l\'input « ' + name.value + ' »', (dd) => E.addInput(dd, { name: name.value, kind: k, targetType: tgt.value, required: req.checked, after: after || null, values: k === 'enum' ? I.dedupe(I.parsePaste(vals.value)) : undefined, customList: k === 'customlist' ? src.value.trim() : undefined, dataSource: k === 'datasource' ? src.value.trim() : undefined, filterable: filt.checked }), { name: name.value, f: 'kind' }, { onError: (m) => { msg.textContent = m; }, after: () => close() });
      } }]);
  }

  // ---------- dialogue: renommer (essai à blanc via l'opération existante renameInput) ----------
  function renameDialog(wf, oldName) {
    const pr = I.parseInputs(wf), nn = h('input', { type: 'text', id: 'inRenameNew', value: oldName, autocomplete: 'off' }), prev = h('div', { id: 'renamePreview' }), err = h('div', { class: 'errmsg', role: 'alert' });
    const refresh = () => {
      const v = nn.value; prev.replaceChildren(); err.textContent = '';
      if (v === oldName) return; const val = I.validateName(v, pr.raw.properties, oldName); if (val.error) { err.textContent = val.error; return; }
      const t = E.trial(E.createSession(wf), (dd) => E.renameInput(dd, oldName, v)); if (!t.res.ok) { err.textContent = t.res.error; return; }
      prev.append(h('p', { id: 'renameCount', text: t.res.changes.length + ' valeur(s) de settings/filtres/cibles contiennent une référence qui sera mise à jour (inputSchema et « requis » aussi).' }));
      const warn = (t.res.warnings || []).concat(val.warning ? [val.warning] : []).concat(t.newBroken.map((b) => 'référence cassée: ' + b.token)); if (warn.length) prev.append(h('ul', { class: 'warnlist' }, warn.map((x) => h('li', { text: x }))));
    };
    nn.addEventListener('input', refresh);
    EU.dialog('Renommer l\'input « ' + oldName + ' »', h('div', null, labelFor('Nouveau nom', nn), prev, err), [{ text: 'Renommer', primary: true, id: 'btnDoRename', onclick: (close) => {
      if (nn.value === oldName) { close(); return; } const val = I.validateName(nn.value, pr.raw.properties, oldName); if (val.error) { err.textContent = val.error; return; }
      op(wf, 'Renommer l\'input « ' + oldName + ' » en « ' + nn.value + ' »', (dd) => E.renameInput(dd, oldName, nn.value), { name: nn.value, f: 'name' }, { onError: (m) => { err.textContent = m; }, after: () => close() });
    } }]);
    nn.select();
  }

  // ---------- dialogue: valeurs de liste (enum), rendu paresseux ----------
  function enumDialog(wf, name) {
    const prop = I.parseInputs(wf).raw.properties[name]; let vals = Array.isArray(prop.enum) ? prop.enum.slice() : [], limit = ENUM_PAGE;
    const q = h('input', { type: 'search', id: 'inEnumSearch', placeholder: 'Rechercher dans les valeurs…', 'aria-label': 'Rechercher dans les valeurs' }), listEl = h('div', { class: 'enumlist', id: 'enumList' }), info = h('div', { class: 'muted', id: 'enumInfo', role: 'status' });
    const paste = h('textarea', { id: 'taEnumPaste', rows: 4, placeholder: 'Coller plusieurs valeurs (une par ligne)', 'aria-label': 'Coller des valeurs' }), mode = h('select', { id: 'selPasteMode', 'aria-label': 'Mode de collage' }, h('option', { value: 'append', text: 'Ajouter à la fin' }), h('option', { value: 'replace', text: 'Remplacer la liste' }));
    const draw = () => {
      const f = q.value.toLowerCase(), idxs = []; for (let i = 0; i < vals.length; i++) if (!f || String(vals[i]).toLowerCase().includes(f)) idxs.push(i);
      const dups = I.duplicatesOf(vals); info.textContent = vals.length + ' valeur(s)' + (f ? ', ' + idxs.length + ' correspondante(s)' : '') + (dups.length ? ' — ' + dups.length + ' en double' : '');
      const frag = document.createDocumentFragment();
      idxs.slice(0, limit).forEach((i) => {
        const inp = h('input', { type: 'text', value: String(vals[i]), 'aria-label': 'Valeur ' + (i + 1), class: 'enumval' }); inp.addEventListener('change', () => { vals[i] = inp.value; });
        frag.append(h('div', { class: 'enumrow' }, h('span', { class: 'lno', text: String(i + 1) }), inp,
          h('button', { type: 'button', 'aria-label': 'Monter la valeur ' + (i + 1), text: '↑', disabled: i === 0 ? true : null, onclick: () => { vals = I.moveValue(vals, i, i - 1); draw(); } }),
          h('button', { type: 'button', 'aria-label': 'Descendre la valeur ' + (i + 1), text: '↓', disabled: i === vals.length - 1 ? true : null, onclick: () => { vals = I.moveValue(vals, i, i + 1); draw(); } }),
          h('button', { type: 'button', 'aria-label': 'Supprimer la valeur ' + (i + 1), text: '✕', onclick: () => { vals.splice(i, 1); draw(); } })));
      });
      if (idxs.length > limit) frag.append(h('button', { type: 'button', id: 'btnEnumMore', text: 'Afficher plus (' + (idxs.length - limit) + ' restantes)', onclick: () => { limit += ENUM_PAGE; draw(); } }));
      listEl.replaceChildren(frag);
    };
    q.addEventListener('input', () => { limit = ENUM_PAGE; draw(); });
    const bar = h('div', { class: 'toolbar' }, h('button', { type: 'button', id: 'btnEnumAdd', text: '＋ Ajouter une valeur', onclick: () => { vals.push(''); q.value = ''; limit = Math.max(limit, vals.length); draw(); const ins = listEl.querySelectorAll('.enumval'); if (ins.length) ins[ins.length - 1].focus(); } }),
      h('button', { type: 'button', id: 'btnEnumDedupe', text: 'Dédoublonner', onclick: () => { vals = I.dedupe(vals); draw(); } }), h('button', { type: 'button', id: 'btnEnumSortAsc', text: 'Trier A→Z', onclick: () => { vals = I.sortValues(vals); draw(); } }),
      h('button', { type: 'button', text: 'Trier Z→A', onclick: () => { vals = I.sortValues(vals, 'desc'); draw(); } }), h('button', { type: 'button', text: 'Retirer les valeurs vides', onclick: () => { vals = vals.filter((v) => String(v).trim() !== ''); draw(); } }));
    const pasteBtn = h('button', { type: 'button', id: 'btnEnumPaste', text: 'Appliquer le collage', onclick: () => { const nv = I.parsePaste(paste.value); vals = mode.value === 'replace' ? nv : vals.concat(nv); paste.value = ''; draw(); } });
    const err = h('div', { class: 'errmsg', role: 'alert' }); draw();
    EU.dialog('Valeurs de la liste « ' + name + ' »', h('div', null, h('p', { class: 'muted', text: 'Les modifications ne sont appliquées qu\'avec « Appliquer ». Rendu par pages de ' + ENUM_PAGE + ' valeurs.' }), bar, q, info, listEl, h('h3', { text: 'Coller des valeurs' }), paste, h('div', { class: 'toolbar' }, mode, pasteBtn), err),
      [{ text: 'Appliquer', primary: true, id: 'btnEnumApply', onclick: (close) => {
        if (vals.some((v) => String(v).trim() === '')) { err.textContent = 'une valeur est vide (utilisez « Retirer les valeurs vides »)'; return; }
        op(wf, 'Modifier les valeurs de « ' + name + ' » (' + vals.length + ')', (dd) => E.setInputEnum(dd, name, vals.map(String)), { name, f: 'enum' }, { onError: (m) => { err.textContent = m; }, after: () => close() });
      } }]);
  }

  // ---------- dialogue: règles de mot de passe ----------
  const BOOL_RULES = { specifyLength: 'Imposer une longueur', requireUppercase: 'Majuscule requise', requireLowercase: 'Minuscule requise', requiredigits: 'Chiffre requis', requireNumbers: 'Chiffre requis (variante « requireNumbers »)', requireSpecialChars: 'Caractère spécial requis', isEditable: 'Modifiable par l\'opérateur' };
  function rulesDialog(wf, name) {
    const prop = I.parseInputs(wf).raw.properties[name], rules = prop.passwordRules && typeof prop.passwordRules === 'object' ? JSON.parse(JSON.stringify(prop.passwordRules)) : I.defaultPasswordRules(), box = h('div', { id: 'rulesBox' });
    const controls = {}; const err = h('div', { class: 'errmsg', role: 'alert' });
    const draw = () => {
      box.replaceChildren(); Object.keys(rules).forEach((k) => {
        const v = rules[k];
        if (typeof v === 'boolean') { const c = h('input', { type: 'checkbox', checked: v ? true : null, 'aria-label': BOOL_RULES[k] || k }); c.addEventListener('change', () => { rules[k] = c.checked; }); box.append(h('label', { class: 'rule' }, c, ' ' + (BOOL_RULES[k] || k), h('small', { class: 'muted tech', text: ' (' + k + ')' }))); }
        else if (typeof v === 'number') { const c = h('input', { type: 'number', min: 0, value: String(v), 'aria-label': 'Longueur minimale', id: 'inRuleMin' }); c.addEventListener('change', () => { rules[k] = Number(c.value); }); box.append(labelFor(k === 'minLength' ? 'Longueur minimale' : k, c)); }
        else if (k === 'specialCharsConfig' && v && typeof v === 'object') {
          const u = h('input', { type: 'checkbox', checked: v.useDefaultChars ? true : null, 'aria-label': 'Utiliser les caractères spéciaux par défaut' }), cc = h('input', { type: 'text', value: String(v.customChars || ''), 'aria-label': 'Caractères spéciaux personnalisés' });
          u.addEventListener('change', () => { v.useDefaultChars = u.checked; }); cc.addEventListener('change', () => { v.customChars = cc.value; }); box.append(h('div', { class: 'fld' }, h('span', { text: 'Caractères spéciaux' }), h('label', null, u, ' utiliser ceux par défaut'), cc));
        } else box.append(h('div', { class: 'muted', text: 'Clé conservée telle quelle: ' + k }));
      });
      const missing = Object.keys(BOOL_RULES).filter((k) => !(k in rules)), sel = h('select', { 'aria-label': 'Ajouter une règle', id: 'selRuleAdd' }, h('option', { value: '', text: 'Ajouter une règle…' }), missing.map((k) => h('option', { value: k, text: BOOL_RULES[k] })));
      sel.addEventListener('change', () => { if (sel.value) { rules[sel.value] = true; draw(); } }); box.append(sel);
    }; draw();
    EU.dialog('Règles du mot de passe « ' + name + ' »', h('div', null, h('p', { class: 'muted', text: 'ⓘ ' + I.UNCERTAIN_NOTES.password }), box, err), [{ text: 'Appliquer', primary: true, id: 'btnRulesApply', onclick: (close) => {
      op(wf, 'Modifier les règles de « ' + name + ' »', (dd) => E.setPasswordRules(dd, name, rules), { name, f: 'rules' }, { onError: (m) => { err.textContent = m; }, after: () => close() });
    } }]);
  }

  // ---------- dialogue: JSON brut d'un input (expert) ----------
  function rawDialog(wf, name) {
    const prop = I.parseInputs(wf).raw.properties[name], ta = h('textarea', { id: 'taRawInput', rows: 14, class: 'mono', 'aria-label': 'JSON de l\'input' }), err = h('div', { class: 'errmsg', role: 'alert' });
    ta.value = JSON.stringify(prop, null, 2); let parsed = prop;
    const check = () => { try { parsed = JSON.parse(ta.value); err.textContent = ''; } catch (e) { parsed = undefined; err.textContent = 'JSON invalide: ' + e.message; } }; ta.addEventListener('input', check);
    EU.dialog('JSON brut de l\'input « ' + name + ' »', h('div', null, h('p', { class: 'muted', text: 'Édition avancée: la propriété remplace l\'ancienne telle quelle (le nom ne change pas).' }), ta, err), [{ text: 'Appliquer', primary: true, id: 'btnRawApply', onclick: (close) => {
      if (parsed === undefined) return; op(wf, 'Modifier le JSON de l\'input « ' + name + ' »', (dd) => E.setInputProp(dd, name, parsed), { name, f: 'kind' }, { onError: (m) => { err.textContent = m; }, after: () => close() });
    } }]);
  }

  // ---------- dialogue: valeur requise pour une source / une liste personnalisée ----------
  function valueDialog(wf, name, kind) {
    const isDs = kind === 'datasource', inp = h('input', { type: 'text', id: 'inKindValue', list: 'dlKindValue', autocomplete: 'off', 'aria-label': isDs ? 'Source de données' : 'Identifiant de liste' }), dl = datalist('dlKindValue', knownValues(isDs ? 'x-cv-data-source' : 'x-cv-custom-list')), err = h('div', { class: 'errmsg', role: 'alert' });
    EU.dialog(isDs ? 'Source de données' : 'Liste personnalisée', h('div', null, h('p', { class: 'muted', text: 'Saisissez une valeur ou choisissez-en une déjà vue dans les workflows chargés (aucun code n\'est inventé).' }), labelFor(isDs ? 'Source de données' : 'Identifiant de la liste', inp), dl, err), [{ text: 'Appliquer', primary: true, id: 'btnKindValue', onclick: (close) => {
      if (!inp.value.trim()) { err.textContent = 'valeur requise'; return; }
      op(wf, 'Convertir « ' + name + ' » en ' + kindLabel(kind), (dd) => E.setInputKind(dd, name, kind, isDs ? { dataSource: inp.value.trim() } : { customList: inp.value.trim() }), { name, f: 'kind' }, { onError: (m) => { err.textContent = m; }, after: () => close() });
    } }]);
  }

  // ---------- dialogue: copier des inputs vers un autre workflow ----------
  function copyDialog(wf) {
    const pr = I.parseInputs(wf), names = [...selOf(wf.id)].filter((n) => pr.raw.properties[n]); const list = names.length ? names : Object.keys(pr.raw.properties);
    const others = [...S.wfs.values()].filter((w) => w.id !== wf.id).sort((a, b) => a.name.localeCompare(b.name));
    if (!others.length) { U.setStatus('Aucun autre workflow chargé'); return; }
    const sel = h('select', { id: 'selCopyTarget', 'aria-label': 'Workflow cible' }, others.map((w) => h('option', { value: w.id, text: w.name }))), mode = h('select', { id: 'selCopyMode', 'aria-label': 'En cas de conflit de nom' }, h('option', { value: 'skip', text: 'Ignorer les inputs existants' }), h('option', { value: 'rename', text: 'Ajouter sous un autre nom' }), h('option', { value: 'overwrite', text: 'Écraser les inputs existants' }));
    const out = h('div', { id: 'copyPreview' }), items = () => list.map((n) => ({ name: n, prop: pr.raw.properties[n], required: pr.inputs.find((i) => i.name === n).required }));
    const refresh = () => { const t = E.trial(E.createSession(S.wfs.get(sel.value)), (dd) => E.copyInputs(dd, items(), mode.value)); out.replaceChildren(t.res.ok ? h('ul', { id: 'copyList' }, t.res.report.map((r) => h('li', { text: r.name + ' → ' + r.action }))) : h('div', { class: 'errmsg', text: t.res.error })); };
    [sel, mode].forEach((c) => c.addEventListener('change', refresh)); refresh();
    EU.dialog('Copier ' + list.length + ' input(s) vers un autre workflow', h('div', null, h('p', { class: 'muted', text: names.length ? 'Inputs cochés: ' + names.join(', ') : 'Aucun input coché: tous les inputs seront copiés.' }), labelFor('Workflow cible', sel), labelFor('Conflits de nom (insensible à la casse)', mode), h('h3', { text: 'Aperçu' }), out), [{ text: 'Copier', primary: true, id: 'btnDoCopy', onclick: (close) => {
      const target = S.wfs.get(sel.value); EU.apply(target.id, 'Copier ' + list.length + ' input(s) depuis « ' + wf.name + ' »', (dd) => E.copyInputs(dd, items(), mode.value), { after: () => { close(); U.setStatus('Inputs copiés vers « ' + target.name + ' » (workflow marqué modifié)'); } });
    } }]);
  }

  // ---------- changement de catégorie ----------
  function changeKind(wf, name, kind, selEl, oldKind) {
    if (selEl) selEl.value = oldKind; // l'affichage ne change qu'une fois l'opération appliquée
    if (kind === 'datasource' || kind === 'customlist') { const cur = I.parseInputs(wf).raw.properties[name]; if (!(kind === 'datasource' ? cur['x-cv-data-source'] : cur['x-cv-custom-list'])) { valueDialog(wf, name, kind); return; } }
    op(wf, 'Changer le type de « ' + name + ' » en ' + kindLabel(kind), (dd) => E.setInputKind(dd, name, kind, kind === 'target' ? { targetType: 'User' } : {}), { name, f: 'kind' }, { after: (r) => { if (r && r.needs === 'enum') enumDialog(S.wfs.get(wf.id), name); } });
  }

  // ---------- ligne de l'éditeur ----------
  function detailsCell(wf, i) {
    const nm = i.name, cell = h('td', { class: 'indet' });
    if (i.kind === 'enum') { cell.append(h('button', { type: 'button', class: 'btn-enum', 'aria-label': 'Modifier les valeurs de ' + nm, data: { in: nm, f: 'enum' }, text: 'Valeurs (' + (i.enumValues ? i.enumValues.length : 0) + ')…', onclick: () => enumDialog(S.wfs.get(wf.id), nm) }), h('span', { class: 'chips' }, (i.enumValues || []).slice(0, 4).map((v) => h('span', { class: 'chipv', text: String(v) })), i.enumValues && i.enumValues.length > 4 ? h('span', { class: 'muted', text: '…' }) : null)); }
    else if (i.kind === 'yesno') {
      const cur = JSON.stringify(i.enumValues), forms = I.YESNO_FORMS, s = h('select', { 'aria-label': 'Graphie Oui/Non de ' + nm, data: { in: nm, f: 'yn' } }, forms.map((f) => h('option', { value: JSON.stringify(f), selected: JSON.stringify(f) === cur ? true : null, text: f.join(' / ') })), forms.some((f) => JSON.stringify(f) === cur) ? null : h('option', { value: cur, selected: true, text: (i.enumValues || []).join(' / ') }));
      s.addEventListener('change', () => op(wf, 'Modifier les valeurs Oui/Non de « ' + nm + ' »', (dd) => E.setInputEnum(dd, nm, JSON.parse(s.value)), { name: nm, f: 'yn' })); cell.append(s);
    } else if (i.kind === 'customlist' || i.kind === 'datasource') {
      const isDs = i.kind === 'datasource', inp = h('input', { type: 'text', value: (isDs ? i.dataSource : i.customList) || '', list: isDs ? 'dlDataSource' : 'dlCustomList', 'aria-label': (isDs ? 'Source de données de ' : 'Liste personnalisée de ') + nm, data: { in: nm, f: 'src' }, autocomplete: 'off' });
      inp.addEventListener('change', () => { if (!inp.value.trim()) { U.setStatus('Valeur requise: modification ignorée'); inp.value = (isDs ? i.dataSource : i.customList) || ''; return; } op(wf, 'Modifier la ' + (isDs ? 'source' : 'liste') + ' de « ' + nm + ' »', (dd) => E.setInputSource(dd, nm, isDs ? { dataSource: inp.value.trim() } : { customList: inp.value.trim() }), { name: nm, f: 'src' }); });
      cell.append(inp);
      if (isDs) { const f = h('input', { type: 'checkbox', checked: i.filterable ? true : null, 'aria-label': 'Source filtrable pour ' + nm }); f.addEventListener('change', () => op(wf, 'Modifier « filtrable » de « ' + nm + ' »', (dd) => E.setInputSource(dd, nm, { filterable: f.checked }), { name: nm, f: 'src' })); cell.append(h('label', { class: 'inl' }, f, ' filtrable')); }
    } else if (i.kind === 'password') {
      const r = i.passwordRules; cell.append(h('button', { type: 'button', 'aria-label': 'Règles du mot de passe de ' + nm, data: { in: nm, f: 'rules' }, text: 'Règles…', onclick: () => rulesDialog(S.wfs.get(wf.id), nm) }), h('small', { class: 'muted', text: r ? ' ' + (r.minLength != null ? 'min ' + r.minLength + ' · ' : '') + Object.keys(r).filter((k) => r[k] === true).length + ' règle(s) actives' : ' aucune règle' }));
    } else if (i.kind === 'datetime') cell.append(h('small', { class: 'muted', text: 'Sélecteur date-heure' }));
    // avancé: infobulle, valeur par défaut, JSON brut (expert), note d'incertitude
    const adv = h('details', { class: 'adv' }, h('summary', { text: 'Avancé' })), tip = h('input', { type: 'text', value: i.tooltip || '', 'aria-label': 'Infobulle de ' + nm, data: { in: nm, f: 'tip' } }), def = h('input', { type: 'text', value: i.hasDefault ? String(i.defaultValue) : '', 'aria-label': 'Valeur par défaut de ' + nm, data: { in: nm, f: 'def' } });
    tip.addEventListener('change', () => op(wf, 'Modifier l\'infobulle de « ' + nm + ' »', (dd) => E.updateInput(dd, nm, { tooltip: tip.value }), { name: nm, f: 'tip' }));
    def.addEventListener('change', () => op(wf, 'Modifier la valeur par défaut de « ' + nm + ' »', (dd) => E.updateInput(dd, nm, { default: def.value === '' ? undefined : (i.kind === 'integer' && !isNaN(Number(def.value)) ? Number(def.value) : i.kind === 'boolean' ? def.value === 'true' : def.value) }), { name: nm, f: 'def' }));
    adv.append(labelFor('Infobulle', tip), labelFor('Valeur par défaut', def), h('small', { class: 'muted', text: 'ⓘ Infobulle et valeur par défaut : jamais observées hors mots de passe / jamais observées; effet à l\'import non vérifié.' }),
      h('button', { type: 'button', class: 'tech', text: 'JSON brut…', 'aria-label': 'Modifier le JSON brut de ' + nm, onclick: () => rawDialog(S.wfs.get(wf.id), nm) }));
    cell.append(adv); if (I.CERTAINTY[i.kind] === false) cell.append(h('div', { class: 'uncertain', title: I.UNCERTAIN_NOTES[i.kind], text: 'ⓘ forme partiellement déduite' }));
    return cell;
  }
  function row(wf, i, idx, total, state) {
    const nm = i.name, sel = selOf(wf.id), tr = h('tr', { class: 'inrow-edit', data: { name: nm } });
    const handle = h('button', { type: 'button', class: 'drag', 'aria-label': 'Glisser pour réordonner ' + nm + ' (ou boutons Monter / Descendre)', title: 'Glisser pour réordonner', text: '☰' });
    handle.addEventListener('mousedown', () => { tr.draggable = true; }); handle.addEventListener('mouseup', () => { tr.draggable = false; });
    tr.addEventListener('dragstart', (e) => { state.drag = nm; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', nm); } catch (x) { /* */ } tr.classList.add('dragging'); });
    tr.addEventListener('dragend', () => { tr.draggable = false; tr.classList.remove('dragging'); state.drag = null; });
    tr.addEventListener('dragover', (e) => { if (state.drag && state.drag !== nm) { e.preventDefault(); tr.classList.add('dragover'); } }); tr.addEventListener('dragleave', () => tr.classList.remove('dragover'));
    tr.addEventListener('drop', (e) => { e.preventDefault(); tr.classList.remove('dragover'); const from = state.drag; state.drag = null; if (from && from !== nm) op(wf, 'Déplacer l\'input « ' + from + ' »', (dd) => E.moveInput(dd, from, { to: idx }), { name: from, f: 'up' }); });
    const chk = h('input', { type: 'checkbox', checked: sel.has(nm) ? true : null, 'aria-label': 'Sélectionner ' + nm + ' pour la copie' }); chk.addEventListener('change', () => { if (chk.checked) sel.add(nm); else sel.delete(nm); });
    const up = h('button', { type: 'button', 'aria-label': 'Monter ' + nm, data: { in: nm, f: 'up' }, text: '↑', disabled: idx === 0 ? true : null, onclick: () => op(wf, 'Monter l\'input « ' + nm + ' »', (dd) => E.moveInput(dd, nm, { dir: 'up' }), { name: nm, f: 'up' }) });
    const down = h('button', { type: 'button', 'aria-label': 'Descendre ' + nm, data: { in: nm, f: 'down' }, text: '↓', disabled: idx === total - 1 ? true : null, onclick: () => op(wf, 'Descendre l\'input « ' + nm + ' »', (dd) => E.moveInput(dd, nm, { dir: 'down' }), { name: nm, f: 'down' }) });
    const kinds = I.SELECTABLE.indexOf(i.kind) >= 0 ? I.SELECTABLE : I.SELECTABLE.concat([i.kind]);
    const kindSel = h('select', { 'aria-label': 'Type de ' + nm, data: { in: nm, f: 'kind' } }, kinds.map((k) => h('option', { value: k, selected: k === i.kind ? true : null, text: kindLabel(k) + (I.SELECTABLE.indexOf(k) < 0 ? ' (non modifiable)' : '') })));
    kindSel.addEventListener('change', () => { if (I.SELECTABLE.indexOf(kindSel.value) >= 0) changeKind(wf, nm, kindSel.value, kindSel, i.kind); else kindSel.value = i.kind; });
    const tcell = h('td', null, kindSel);
    if (i.kind === 'target') { const ts = h('select', { 'aria-label': 'Type de cible de ' + nm, data: { in: nm, f: 'target' } }, Object.keys(I.TARGET_TYPES).map((t) => h('option', { value: t, selected: t === i.targetType ? true : null, text: I.TARGET_TYPES[t] })), I.TARGET_TYPES[i.targetType] ? null : h('option', { value: i.targetType, selected: true, text: i.targetType })); ts.addEventListener('change', () => op(wf, 'Changer la cible de « ' + nm + ' »', (dd) => E.setInputKind(dd, nm, 'target', { targetType: ts.value }), { name: nm, f: 'target' })); tcell.append(ts); }
    const req = h('input', { type: 'checkbox', checked: i.required ? true : null, 'aria-label': 'Requis: ' + nm, data: { in: nm, f: 'req' } }); req.addEventListener('change', () => op(wf, (req.checked ? 'Rendre requis' : 'Rendre optionnel') + ' l\'input « ' + nm + ' »', (dd) => E.updateInput(dd, nm, { required: req.checked }), { name: nm, f: 'req' }));
    const title = h('input', { type: 'text', value: i.title || '', 'aria-label': 'Titre de ' + nm, data: { in: nm, f: 'title' } }); title.addEventListener('change', () => op(wf, 'Modifier le titre de « ' + nm + ' »', (dd) => E.updateInput(dd, nm, { title: title.value }), { name: nm, f: 'title' }));
    const dstr = typeof i.description === 'string' ? i.description : '', desc = h('input', { type: 'text', value: dstr, 'aria-label': 'Description de ' + nm, data: { in: nm, f: 'desc' }, placeholder: i.description == null ? '(aucune)' : '' }); desc.addEventListener('change', () => op(wf, 'Modifier la description de « ' + nm + ' »', (dd) => E.updateInput(dd, nm, { inputDescription: desc.value }), { name: nm, f: 'desc' }));
    const used = usedBy(wf, nm);
    tr.append(h('td', { class: 'inctl' }, handle, up, down, chk),
      h('td', null, h('code', { text: nm }), h('div', { class: 'muted', text: used ? 'utilisé par ' + used + ' node(s)' : 'non utilisé' }), h('button', { type: 'button', class: 'linkbtn', 'aria-label': 'Renommer ' + nm, data: { in: nm, f: 'name' }, text: 'Renommer…', onclick: () => renameDialog(S.wfs.get(wf.id), nm) })),
      tcell, h('td', null, req), h('td', null, title), h('td', null, desc), detailsCell(wf, i),
      h('td', { class: 'inact' }, h('button', { type: 'button', 'aria-label': 'Dupliquer ' + nm, data: { in: nm, f: 'dup' }, text: '⧉', title: 'Dupliquer', onclick: () => op(wf, 'Dupliquer l\'input « ' + nm + ' »', (dd) => E.duplicateInput(dd, nm), { name: nm, f: 'dup' }) }),
        h('button', { type: 'button', 'aria-label': 'Supprimer ' + nm, data: { in: nm, f: 'del' }, text: '🗑', title: 'Supprimer', onclick: () => op(wf, 'Supprimer l\'input « ' + nm + ' »', (dd) => E.deleteInput(dd, nm), null) })));
    return tr;
  }

  function buildEditor(wf) {
    const pr = I.parseInputs(wf), box = h('div', { class: 'inputsEditor', id: 'inputsEditor' });
    if (!pr.ok || !pr.raw) { add(box, h('div', { class: 'errmsg', text: pr.ok ? 'Aucun inputSchema: ajoutez un input pour le créer n\'est pas supporté.' : 'inputSchema illisible: édition impossible.' })); return box; }
    const state = { drag: null }, n = pr.inputs.length;
    add(box, datalist('dlDataSource', knownValues('x-cv-data-source')), datalist('dlCustomList', knownValues('x-cv-custom-list')),
      h('div', { class: 'toolbar' }, h('strong', { text: '✎ Éditeur d\'inputs' }), h('button', { type: 'button', id: 'btnAddInputOpen', class: 'primary', text: '＋ Ajouter un input…', onclick: () => addDialog(S.wfs.get(wf.id)) }), h('button', { type: 'button', id: 'btnCopyInputs', text: 'Copier vers un autre workflow…', onclick: () => copyDialog(S.wfs.get(wf.id)) }),
        h('small', { class: 'muted', text: n + ' input(s) · chaque modification est annulable (Ctrl+Z) · cochez des lignes pour ne copier que celles-ci' })));
    if (!n) add(box, h('p', { class: 'muted', text: 'Aucun input.' }));
    else add(box, h('div', { class: 'gridwrap' }, h('table', { class: 'grid inputs-edit' }, h('caption', { class: 'visually-hidden', text: 'Inputs du workflow' }),
      h('thead', null, h('tr', null, ['Ordre / sélection', 'Nom', 'Type', 'Requis', 'Titre', 'Description', 'Détails', 'Actions'].map((t) => h('th', { scope: 'col', text: t })))), h('tbody', null, pr.inputs.map((i, idx) => row(wf, i, idx, n, state))))));
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
