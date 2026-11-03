/* natives.js - registre des actions natives (non CustomManagementAction): icône, libellé FR, résumé 1 ligne, champs formatés (pur, sans DOM).
   Chaque entrée porte `src`, l'origine de la description:
     'user' = confirmée par l'utilisateur ; 'data' = libellé/catalogue présent dans les données (categoryItemName, customDescription, schémas) ;
     'name' = DÉDUITE du seul nom du type/des clés de settings => à valider (affichée "déduit du nom" dans l'UI).
   Les résumés sont des chaînes qui peuvent contenir des {{...}}: l'UI les rend en pastilles. */
(function (root) {
  'use strict';
  var model = typeof require === 'function' ? require('./model.js') : root.WFV.model;

  var OPS = { IsEqual: 'égal à', IsNotEqual: 'différent de', IsEmpty: 'est vide', IsNotEmpty: "n'est pas vide", Contains: 'contient', NotContains: 'ne contient pas', StartsWith: 'commence par', IsGreaterThen: 'supérieur à' };
  var UNARY = { IsEmpty: 1, IsNotEmpty: 1 };
  function opLabel(op) { return OPS[op] || op; }

  // ---- helpers de valeurs ----
  function isBoolLike(v) { return v === true || v === false || v === 'true' || v === 'false'; }
  function yn(v) { return v === true || v === 'true' ? 'oui' : v === false || v === 'false' ? 'non' : str(v); }
  function str(v) {
    if (v === undefined || v === null || v === '') return '?';
    if (Array.isArray(v)) return v.length ? v.map(str).join(', ') : '(vide)';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  function dur(v) {
    var n = typeof v === 'number' ? v : /^\d+$/.test(String(v)) ? Number(v) : NaN;
    if (isNaN(n)) return str(v);
    var h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), s = n % 60, o = [];
    if (h) o.push(h + ' h'); if (m) o.push(m + ' min'); if (s || !o.length) o.push(s + ' s');
    return o.join(' ');
  }
  function count(v) { return Array.isArray(v) ? v.length : v ? 1 : 0; }
  function htmlToText(s) { // texte brut d'un HTML, sans jamais l'interpréter
    if (typeof s !== 'string') return '';
    return s.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function conditionsOf(f) {
    var out = []; if (!f || typeof f !== 'object') return out;
    (f.conditions || []).forEach(function (c) { out.push(c); });
    (f.conditionGroups || []).forEach(function (g) { (g.conditions || []).forEach(function (c) { out.push(c); }); });
    return out;
  }
  function condText(c) {
    if (!c || typeof c !== 'object') return str(c);
    return str(c.property) + ' ' + opLabel(c.operator) + (UNARY[c.operator] ? '' : ' « ' + str(c.value) + ' »');
  }

  // ---- registre ----
  function E(icon, label, src, sum) { return { icon: icon, label: label, src: src, sum: sum }; }
  var T = {
    'SendEmailNotification': E('✉', 'Envoyer une notification par courriel', 'user', function (s) {
      return 'Envoie un courriel à ' + str(s.to) + (count(s.bccAddresses) ? ' (cci : ' + str(s.bccAddresses) + ')' : '') + ' — objet : « ' + str(s.subject) + ' »'; }),
    'CheckIfMailboxExists': E('📬', 'Vérifier si la boîte aux lettres existe', 'user', function (s) {
      return 'Vérifie si la boîte aux lettres ' + str(s.mailbox) + ' existe' + (s.timeoutSeconds ? ' (délai max ' + dur(s.timeoutSeconds) + ')' : ''); }),
    'RetrieveDataFromObject': E('🔎', 'Lire des propriétés d\'un objet', 'data', function (s) {
      return 'Lit ' + (s.propertiesName ? 'les propriétés ' + str(s.propertiesName) : 'des propriétés') + ' de l\'objet ' + str(s.target) + ' ' + str(s.id); }),
    'SetTeamPolicy': E('☎', 'Gérer une stratégie Teams', 'data', function (s) {
      return 'Applique la stratégie Teams ' + str(s.typePolicy) + ' = ' + str(s.policyName) + ' à ' + str(s.user); }),
    'AddSecurityGroupMember': E('➕', 'Ajouter au groupe de sécurité', 'data', function (s) { return 'Ajoute ' + str(s.member) + ' au groupe de sécurité ' + str(s.securityGroupId); }),
    'RemoveSecurityGroupMember': E('➖', 'Retirer du groupe de sécurité', 'data', function (s) { return 'Retire ' + str(s.member) + ' du groupe de sécurité ' + str(s.securityGroupId); }),
    'AddDistributionGroupMember': E('➕', 'Ajouter au groupe de distribution', 'data', function (s) { return 'Ajoute ' + str(s.member) + ' au groupe de distribution ' + str(s.groupId); }),
    'RemoveDistributionGroupMember': E('➖', 'Retirer du groupe de distribution', 'name', function (s) { return 'Retire ' + str(s.member) + ' du groupe de distribution ' + str(s.groupId); }),
    'ManageLicense': E('🪪', 'Gérer les licences', 'data', function (s) {
      return 'Gère les licences de ' + str(s.userPrincipalName) + ' (' + count(s.selectedLicenses) + ' entrée(s) de licence sélectionnée(s), emplacement ' + str(s.usageLocation) + ')'; }),
    'AssignLicense': E('🪪', 'Assigner des licences', 'name', function (s) { return 'Assigne ' + count(s.selectedLicenses) + ' entrée(s) de licence à ' + str(s.userPrincipalName) + ' (emplacement ' + str(s.usageLocation) + ')'; }),
    'RemoveAllLicenses': E('🪪', 'Supprimer toutes les licences', 'data', function (s) { return 'Supprime toutes les licences de ' + str(s.userPrincipalName); }),
    'UpdateSignInStatus': E('⛔', 'Bloquer / débloquer la connexion', 'data', function (s) { return 'Définit l\'état de connexion de ' + str(s.userPrincipalName) + ' (blockCredential : ' + yn(s.blockCredential) + ')'; }),
    'RevokeUserSessions': E('🚪', 'Révoquer les sessions utilisateur', 'name', function (s) { return 'Révoque les sessions de ' + str(s.userPrincipalName); }),
    'CreateHybridUserFlat': E('👤', 'Créer un utilisateur (on-premises)', 'name', function (s) { return 'Crée l\'utilisateur ' + str(s.displayName) + ' (' + str(s.samAccount) + ') dans l\'OU ' + str(s.organizationalUnit); }),
    'CreateOnPremisesUserFlat': E('👤', 'Créer un utilisateur (on-premises)', 'name', function (s) { return 'Crée l\'utilisateur ' + str(s.displayName) + ' dans l\'OU ' + str(s.organizationalUnit); }),
    'CreateOnCloudUser': E('👤', 'Créer un utilisateur (cloud)', 'data', function (s) { return 'Crée l\'utilisateur cloud ' + str(s.displayName) + ' (' + str(s.email) + ')'; }),
    'SetLitigationHold': E('⚖', 'Gérer la conservation pour litige', 'data', function (s) { return 'Gère la conservation pour litige de ' + str(s.userPrincipalName) + ' (activée : ' + yn(s.litigationHoldEnabled) + ')'; }),
    'EditUserPropertiesForWorkflow': E('✎', 'Modifier les propriétés utilisateur', 'data', function (s) {
      var ks = Object.keys(s).filter(function (k) { return k !== 'userPrincipalName'; }); return 'Modifie ' + ks.length + ' propriété(s) de ' + str(s.userPrincipalName) + ' : ' + ks.join(', '); }),
    'EnableDisableAccount': E('⏻', 'Activer / désactiver le compte', 'name', function (s) { return 'Définit l\'état du compte de ' + str(s.userPrincipalName) + ' (enabled : ' + yn(s.enabled) + ')'; }),
    'BulkAddSharePointOwners': E('🗂', 'Ajouter des propriétaires SharePoint', 'name', function (s) { return 'Ajoute ' + str(s.owners) + ' comme propriétaire(s) de ' + str(s.target); }),
    'UnlockUser': E('🔓', 'Déverrouiller l\'utilisateur', 'name', function (s) { return 'Déverrouille le compte de ' + str(s.userPrincipalName); }),
    'RemoveAllAuthenticationMethods': E('🔑', 'Supprimer les méthodes d\'authentification', 'name', function (s) { return 'Supprime toutes les méthodes d\'authentification de ' + str(s.userPrincipalName); }),
    'ManageOnPremisesPassword': E('🔑', 'Gérer le mot de passe local', 'data', function (s) { return 'Gère le mot de passe local de ' + str(s.userPrincipalName) + (s.forceChange !== undefined ? ' (changement forcé : ' + yn(s.forceChange) + ')' : ''); }),
    'ManagePassword': E('🔑', 'Gérer le mot de passe', 'data', function (s) { return 'Gère le mot de passe de ' + str(s.userPrincipalName) + (s.forceChange !== undefined ? ' (changement forcé : ' + yn(s.forceChange) + ')' : '') + (s.neverExpires !== undefined ? ' (n\'expire jamais : ' + yn(s.neverExpires) + ')' : ''); }),
    'ResetSyncUserPassword': E('🔑', 'Réinitialiser le mot de passe (utilisateur synchronisé)', 'name', function (s) { return 'Réinitialise le mot de passe de ' + str(s.userPrincipalName); }),
    'MoveUserToOrganizationalUnit': E('📁', 'Déplacer vers une unité d\'organisation', 'data', function (s) { return 'Déplace ' + str(s.userPrincipalName) + ' vers l\'OU ' + str(s.destinationOrganizationalUnit); }),
    'RemoveUser': E('🗑', 'Supprimer l\'utilisateur', 'data', function (s) { return 'Supprime l\'utilisateur ' + str(s.userPrincipalName); }),
    'RemoveOnPremisesDistributionGroup': E('🗑', 'Supprimer un groupe de distribution (on-premises)', 'name', function (s) { return 'Supprime le groupe de distribution ' + str(s.distinguishedName); }),
    'RemoveDistributionGroup': E('🗑', 'Supprimer un groupe de distribution', 'name', function (s) { return 'Supprime le groupe de distribution ' + str(s.groupId); }),
    'RemoveOffice365Group': E('🗑', 'Supprimer un groupe Microsoft 365', 'name', function (s) { return 'Supprime le groupe Microsoft 365 ' + str(s.groupId); }),
    'SetMultiFactorAuthState': E('🛡', 'Définir l\'état MFA', 'name', function (s) { return 'Définit l\'état MFA de ' + str(s.userPrincipalName) + ' : ' + str(s.strongAuthenticationRequirementsState); }),
    'ResetMultiFactorAuthState': E('🛡', 'Réinitialiser le MFA', 'data', function (s) { return 'Réinitialise le MFA de ' + str(s.userPrincipalName); }),
    'AddTags': E('🏷', 'Ajouter des tags', 'name', function (s) { return 'Ajoute le(s) tag(s) ' + str(s.tags) + ' à ' + str(s.userPrincipalName); }),
    'RemoveTags': E('🏷', 'Retirer des tags', 'name', function (s) { return 'Retire le(s) tag(s) ' + str(s.tags) + ' de ' + str(s.userPrincipalName); }),
    'CreateSecurityGroup': E('👥', 'Créer un groupe de sécurité', 'data', function (s) { return 'Crée le groupe de sécurité ' + str(s.displayName); }),
    'UpdateSecurityGroup': E('👥', 'Mettre à jour un groupe de sécurité', 'name', function (s) { return 'Met à jour le groupe de sécurité ' + str(s.groupId) + (s.description ? ' (description : ' + str(s.description) + ')' : ''); }),
    'CreateSharePointTeamModernSite': E('🗂', 'Créer un site d\'équipe SharePoint', 'name', function (s) { return 'Crée le site d\'équipe SharePoint ' + str(s.title) + ' (confidentialité : ' + str(s.privacy) + ')'; }),
    'ResetPasscodeDeviceCommand': E('📱', 'Réinitialiser le code d\'accès d\'un appareil géré', 'name', function (s) { return 'Réinitialise le code d\'accès de l\'appareil géré ' + str(s.identifier); }),
    'SetCvDeviceTag': E('📱', 'Définir un tag d\'appareil CoreView', 'name', function (s) { return 'Définit le tag d\'appareil ' + str(s.cvDeviceTag) + ' sur ' + str(s.deviceId); }),
    'UnassignTeamsPhoneNumber': E('☎', 'Retirer le numéro de téléphone Teams', 'name', function (s) { return 'Retire le numéro de téléphone Teams de ' + str(s.userPrincipalName); }),
    'AddMailboxPermission': E('📬', 'Ajouter une autorisation de boîte aux lettres', 'data', function (s) { return 'Ajoute une autorisation sur la boîte ' + str(s.mailbox) + ' pour ' + str(s.userPrincipalName) + ' (droit : ' + str(s.accessRight) + ')'; }),
    'SetMailBoxCas': E('📬', 'Gérer les services de la boîte aux lettres', 'data', function (s) {
      var on = ['activeSync', 'ews', 'imap', 'mapi', 'owa', 'pop'].map(function (k) { return k + ' ' + yn(s[k]); }); return 'Définit les services de ' + str(s.userPrincipalName) + ' : ' + on.join(', '); }),
    'item::if-else': E('⑂', 'Condition (si / sinon)', 'data', function (s, n) {
      var cs = conditionsOf(n.raw.filter);
      return (cs.length ? 'Si ' + condText(cs[0]) + (cs.length > 1 ? ' (+' + (cs.length - 1) + ' autre(s) condition(s))' : '') : 'Condition sans critère') + ' — branche VRAI : ' + n.trueBranch.length + ' action(s), FAUX : ' + n.falseBranch.length; }),
    'item::sequence': E('▤', 'Séquence d\'actions', 'data', function (s, n) { return 'Regroupe ' + n.children.length + ' action(s)' + (conditionsOf(n.raw.filter).length ? ' — exécutées si ' + condText(conditionsOf(n.raw.filter)[0]) : ''); }),
    'item::delay': E('⏱', 'Délai', 'data', function (s) { return 'Attend ' + dur(s.waitDuration) + ' (valeur ' + str(s.waitDuration) + ', unité supposée : secondes)'; }),
    'item::stop': E('⏹', 'Arrêter le flux', 'data', function () { return 'Arrête le flux'; }),
    'item::stopv2': E('⏹', 'Arrêter le flux (statut final)', 'data', function (s) { return 'Arrête le flux avec le statut final « ' + str(s.finalStatus) + ' »'; }),
    'item::executenestedworkflow': E('↪', 'Exécuter un workflow imbriqué', 'data', function (s, n, ctx) {
      var id = s.workflowId, nm = ctx && ctx.wfName && ctx.wfName(id);
      var extra = Object.keys(s).filter(function (k) { return k !== 'workflowId' && k !== 'startAfterNDays'; });
      return 'Exécute le workflow ' + (nm ? '« ' + nm + ' »' : str(id) + ' (hors lot)') + (Number(s.startAfterNDays) > 0 ? ', démarrage après ' + s.startAfterNDays + ' jour(s)' : '') + (extra.length ? ' — paramètres : ' + extra.join(', ') : ''); }),
    'item::vtenant-check': E('🛰', 'V-Tenant scan', 'name', function (s) { return 'V-Tenant scan de ' + str(s.target) + ' ' + str(s.id) + (s.failWhenNotVerified !== undefined ? ' (failWhenNotVerified : ' + yn(s.failWhenNotVerified) + ')' : ''); }),
    'item::owner-approval-timeout': E('✅', 'Demander une approbation (avec délai)', 'data', function (s) {
      return 'Demande une approbation par courriel à ' + str(s.email) + ' — objet : « ' + str(s.subject) + ' », délai ' + dur(s.customTimeoutSeconds); }),
    'http-request.get': E('🌐', 'Requête HTTP GET', 'data', function (s) { return 'GET ' + str(s.url); })
  };

  // ---- libellés/formats de champs ----
  var LABELS = { userPrincipalName: 'Utilisateur (UPN)', user: 'Utilisateur', member: 'Membre', owners: 'Propriétaires', groupId: 'Groupe (id)', securityGroupId: 'Groupe de sécurité (id)',
    to: 'Destinataires', bccAddresses: 'Cci', subject: 'Objet', body: 'Corps', mailbox: 'Boîte aux lettres', timeoutSeconds: 'Délai max', customTimeoutSeconds: 'Délai max', waitDuration: 'Durée',
    workflowId: 'Workflow', startAfterNDays: 'Démarrage après (jours)', target: 'Cible', id: 'Identifiant', propertiesName: 'Propriétés lues', finalStatus: 'Statut final', failWhenNotVerified: 'Échec si non vérifié',
    usageLocation: 'Emplacement d\'utilisation', selectedLicenses: 'Licences sélectionnées', blockCredential: 'Blocage des identifiants', enabled: 'Activé', litigationHoldEnabled: 'Conservation pour litige activée',
    forceChange: 'Changement forcé', neverExpires: 'N\'expire jamais', newPassword: 'Nouveau mot de passe', password: 'Mot de passe', firstName: 'Prénom', lastName: 'Nom', displayName: 'Nom affiché', email: 'Courriel',
    organizationalUnit: 'OU', destinationOrganizationalUnit: 'OU de destination', tags: 'Tags', url: 'URL', ensureSuccessStatusCode: 'Exiger un code HTTP de succès', contentType: 'Type de contenu',
    typePolicy: 'Type de stratégie', policyName: 'Stratégie', accessRight: 'Droit d\'accès', owner: 'Propriétaire', description: 'Description', domain: 'Domaine', company: 'Société', privacy: 'Confidentialité',
    strongAuthenticationRequirementsState: 'État MFA', multiFactorAuthState: 'État MFA', distinguishedName: 'DN', title: 'Titre', alias: 'Alias', activeSync: 'ActiveSync', ews: 'EWS', imap: 'IMAP', mapi: 'MAPI', owa: 'OWA', pop: 'POP' };
  var DURATION_KEYS = { waitDuration: 1, timeoutSeconds: 1, customTimeoutSeconds: 1 };
  var LIST_KEYS = { to: 1, bccAddresses: 1, tags: 1, propertiesName: 1, owners: 1, selectedLicenses: 1 };
  var HIDE = { startAfterNDays: 0 };

  // kind: bool | duration | list | html | workflow | any
  function fieldsOf(shortKey, s) {
    return Object.keys(s).map(function (k) {
      var v = s[k], kind = 'any', text = null;
      if (k === 'workflowId' && shortKey === 'item::executenestedworkflow') kind = 'workflow';
      else if (k === 'body' && typeof v === 'string') { kind = 'html'; text = htmlToText(v); }
      else if (DURATION_KEYS[k] && (typeof v === 'number' || /^\d+$/.test(String(v)))) { kind = 'duration'; text = dur(v) + (k === 'waitDuration' ? ' (unité supposée : secondes)' : ''); }
      else if (isBoolLike(v)) { kind = 'bool'; text = yn(v); }
      else if (Array.isArray(v) && (LIST_KEYS[k] || v.every(function (x) { return typeof x === 'string'; }))) kind = 'list';
      return { key: k, label: LABELS[k] || k, value: v, kind: kind, text: text };
    });
  }

  function genericLabel(n) {
    var id = n.id, seg = id.indexOf('|') >= 0 ? id.slice(id.indexOf('|') + 1) : id;
    seg = seg.split('.').pop().replace(/^item::/, '');
    return seg.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
  }
  function shortKey(n) {
    if (n.id.indexOf('|') < 0) return n.id; // item::*, http-request.get
    return n.id.slice(n.id.indexOf('|') + 1).split('.').pop();
  }
  function isNative(n) { return n.type !== 'CustomManagementAction'; }

  function outputsOf(n) {
    var s = model.parseJsonField(n.raw.successOutputSchema);
    if (!s || !s.properties || typeof s.properties !== 'object') return [];
    return Object.keys(s.properties);
  }

  // ctx: {wfName(id)->string|null}. Retourne null pour les nodes non natifs.
  function describe(n, ctx) {
    if (!isNative(n)) return null;
    var key = shortKey(n), reg = T[key], s = model.nodeSettings(n);
    s = s && typeof s === 'object' && !s.__parseError ? s : {};
    var summary, known = !!reg;
    if (reg) { try { summary = reg.sum(s, n, ctx); } catch (e) { summary = null; } }
    if (!summary) {
      var ks = Object.keys(s).slice(0, 4).map(function (k) { return k + ' = ' + str(s[k]); });
      summary = (n.raw.customDescription || '') || (ks.length ? ks.join(' ; ') : 'Action native ' + genericLabel(n));
    }
    var notes = [];
    if (key === 'CheckIfMailboxExists') notes.push("D'après l'utilisateur : sert à attendre la fin de création de la boîte aux lettres.");
    return { native: true, known: known, key: key, icon: reg ? reg.icon : '⚙', label: reg ? reg.label : genericLabel(n), src: reg ? reg.src : 'name',
      summary: summary, fields: fieldsOf(key, s).filter(function (f) { return HIDE[f.key] === undefined || Number(f.value) > 0; }), outputs: outputsOf(n), notes: notes };
  }

  var api = { describe: describe, isNative: isNative, shortKey: shortKey, htmlToText: htmlToText, opLabel: opLabel, conditionsOf: conditionsOf, condText: condText, dur: dur, registry: T, knownKeys: LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.natives = api; }
})(typeof self !== 'undefined' ? self : globalThis);
