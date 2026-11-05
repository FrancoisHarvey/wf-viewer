/* demo-logic.js - logique pure de la démo (testable sous node): détection des workflows de démo, confirmation, étapes de la visite guidée. */
(function (root) {
  'use strict';
  var T = (typeof require === 'function' ? require('./i18n.js') : root.WFV.i18n).t;
  var NAMES = { onb: 'Exemple - Onboarding', copy: 'Exemple - Onboarding (copie)' };

  // files: [{name, text}] (demo-data) -> {onb, copy, workflows:[{id,name}]}
  function findIds(files) {
    var out = { workflows: [] };
    (files || []).forEach(function (f) {
      if (!/\.json$/i.test(f.name)) return;
      try { var d = JSON.parse(f.text).data; if (d && d.id) { out.workflows.push({ id: d.id, name: d.workflowName }); if (d.workflowName === NAMES.onb) out.onb = d.id; if (d.workflowName === NAMES.copy) out.copy = d.id; } } catch (e) { /* fichier illisible: ignoré */ }
    });
    return out;
  }
  // Faut-il demander confirmation? (des workflows NON démo sont déjà chargés)
  function needsConfirm(existingIds, demoIds) {
    var n = 0; (existingIds || []).forEach(function (id) { if (!demoIds || !demoIds.has(id)) n++; }); return n > 0;
  }
  // Étapes de la visite guidée. hash: patch pour setHash; target: sélecteur CSS à mettre en évidence (peut ne pas exister).
  function tourSteps(ids) {
    return [
      { id: 'list', title: T('tour.list.title'), text: T('tour.list.text'), target: '#list', hash: { wf: ids.onb, tab: 'detail' } },
      { id: 'detail', title: T('tour.detail.title'), text: T('tour.detail.text'), target: '#main h1', hash: { wf: ids.onb, tab: 'detail' } },
      { id: 'compare', title: T('tour.compare.title'), text: T('tour.compare.text'), target: '#main .summary', hash: { wf: ids.onb, cmp: ids.copy, tab: 'compare' } },
      { id: 'quality', title: T('tour.quality.title'), text: T('tour.quality.text'), target: '#main table.grid', hash: { wf: ids.onb, tab: 'quality' } },
      { id: 'expert', title: T('tour.expert.title'), text: T('tour.expert.text'), target: '#expertWrap', hash: { wf: ids.onb, tab: 'detail' } },
      { id: 'edit', title: T('tour.edit.title'), text: T('tour.edit.text'), target: '#btnEdit', hash: { wf: ids.onb, tab: 'detail' } }
    ];
  }
  var api = { NAMES: NAMES, findIds: findIds, needsConfirm: needsConfirm, tourSteps: tourSteps };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.demoLogic = api; }
})(typeof self !== 'undefined' ? self : globalThis);
