/* demo-logic.js - logique pure de la démo (testable sous node): détection des workflows de démo, confirmation, étapes de la visite guidée. */
(function (root) {
  'use strict';
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
      { id: 'list', title: 'La liste des workflows', text: 'À gauche: recherche (nom, identifiant, texte des settings), filtre de statut et tri. Les pastilles « démo » marquent les exemples fictifs; ⚠/✖ résument la qualité. Flèches ↑/↓ pour parcourir.', target: '#list', hash: { wf: ids.onb, tab: 'detail' } },
      { id: 'detail', title: 'Le détail d\'un workflow', text: 'Nom, statut, cibles, inputs typés et arbre des nodes: séquence, condition avec branches vrai/faux, appel d\'un sous-flux, custom action avec son script PowerShell coloré. Les pastilles {{…}} sont cliquables.', target: '#main h1', hash: { wf: ids.onb, tab: 'detail' } },
      { id: 'compare', title: 'Comparer un duplicata', text: 'Cet exemple est comparé à sa copie légèrement modifiée: nodes ajoutés ou modifiés, inputs (valeur de liste ajoutée, requis changé) et résumés avant/après, sans le bruit technique.', target: '#main .summary', hash: { wf: ids.onb, cmp: ids.copy, tab: 'compare' } },
      { id: 'quality', title: 'L\'onglet Qualité', text: 'Le linter signale des éléments suspects: ici notamment un token {{…}} mal formé volontairement placé dans l\'exemple, un input inutilisé, un appel imbriqué hors lot. Chaque ligne mène au node concerné.', target: '#main table.grid', hash: { wf: ids.onb, tab: 'quality' } },
      { id: 'expert', title: 'Vue de base ou vue expert', text: 'La vue de base masque identifiants, JSON bruts et schémas techniques. Cochez « Vue expert » (ou touche E) pour tout afficher, par exemple les settings bruts de chaque node.', target: '#expertWrap', hash: { wf: ids.onb, tab: 'detail' } },
      { id: 'edit', title: 'Édition et éditeur d\'inputs', text: 'Le « Mode édition » ouvre l\'éditeur d\'inputs (ajout, renommage avec propagation, changement de type, valeurs de liste) et les opérations sur les nodes. Tout est annulable (Ctrl+Z). L\'export de cet exemple fictif reste possible pour tester.', target: '#btnEdit', hash: { wf: ids.onb, tab: 'detail' } }
    ];
  }
  var api = { NAMES: NAMES, findIds: findIds, needsConfirm: needsConfirm, tourSteps: tourSteps };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.demoLogic = api; }
})(typeof self !== 'undefined' ? self : globalThis);
