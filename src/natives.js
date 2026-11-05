/* natives.js - registre des actions natives (non CustomManagementAction): icône, libellé, résumé 1 ligne, champs formatés (pur, sans DOM).
   Libellés et résumés viennent du dictionnaire i18n (natives.label.<clé>, natives.sum.<clé>); chaque entrée fournit les variables du résumé.
   Chaque entrée porte `src`, l'origine de la description:
     'user' = confirmée par l'utilisateur ; 'data' = libellé/catalogue présent dans les données (categoryItemName, customDescription, schémas) ;
     'name' = DÉDUITE du seul nom du type/des clés de settings => à valider (badge "déduit du nom" dans l'UI).
   Les résumés sont des chaînes qui peuvent contenir des {{...}}: l'UI les rend en pastilles. */
(function (root) {
  'use strict';
  var model = typeof require === 'function' ? require('./model.js') : root.WFV.model;
  var t18 = (typeof require === 'function' ? require('./i18n.js') : root.WFV.i18n).t;

  var OPS = ['IsEqual', 'IsNotEqual', 'IsEmpty', 'IsNotEmpty', 'Contains', 'NotContains', 'StartsWith', 'IsGreaterThen'];
  var UNARY = { IsEmpty: 1, IsNotEmpty: 1 };
  function opLabel(op) { return OPS.indexOf(op) >= 0 ? t18('natives.op.' + op) : op; }

  // ---- helpers de valeurs ----
  function isBoolLike(v) { return v === true || v === false || v === 'true' || v === 'false'; }
  function yn(v) { return v === true || v === 'true' ? t18('natives.yes') : v === false || v === 'false' ? t18('natives.no') : str(v); }
  function str(v) {
    if (v === undefined || v === null || v === '') return '?';
    if (Array.isArray(v)) return v.length ? v.map(str).join(', ') : t18('natives.empty');
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
    return str(c.property) + ' ' + opLabel(c.operator) + (UNARY[c.operator] ? '' : ' ' + t18('natives.q', { v: str(c.value) }));
  }

  // ---- registre: E(icône, origine, variables du résumé) ----
  function E(icon, src, vars) { return { icon: icon, src: src, vars: vars }; }
  var U = function (s) { return { user: str(s.userPrincipalName) }; };
  var T = {
    'SendEmailNotification': E('✉', 'user', function (s) { return { to: str(s.to), bcc: count(s.bccAddresses) ? t18('natives.part.bcc', { v: str(s.bccAddresses) }) : '', subject: str(s.subject) }; }),
    'CheckIfMailboxExists': E('📬', 'user', function (s) { return { mailbox: str(s.mailbox), timeout: s.timeoutSeconds ? t18('natives.part.timeout', { v: dur(s.timeoutSeconds) }) : '' }; }),
    'RetrieveDataFromObject': E('🔎', 'data', function (s) { return { what: s.propertiesName ? t18('natives.part.props', { v: str(s.propertiesName) }) : t18('natives.part.someProps'), target: str(s.target), id: str(s.id) }; }),
    'SetTeamPolicy': E('☎', 'data', function (s) { return { type: str(s.typePolicy), policy: str(s.policyName), user: str(s.user) }; }),
    'AddSecurityGroupMember': E('➕', 'data', function (s) { return { member: str(s.member), group: str(s.securityGroupId) }; }),
    'RemoveSecurityGroupMember': E('➖', 'data', function (s) { return { member: str(s.member), group: str(s.securityGroupId) }; }),
    'AddDistributionGroupMember': E('➕', 'data', function (s) { return { member: str(s.member), group: str(s.groupId) }; }),
    'RemoveDistributionGroupMember': E('➖', 'name', function (s) { return { member: str(s.member), group: str(s.groupId) }; }),
    'ManageLicense': E('🪪', 'data', function (s) { return { user: str(s.userPrincipalName), n: count(s.selectedLicenses), loc: str(s.usageLocation) }; }),
    'AssignLicense': E('🪪', 'name', function (s) { return { user: str(s.userPrincipalName), n: count(s.selectedLicenses), loc: str(s.usageLocation) }; }),
    'RemoveAllLicenses': E('🪪', 'data', U),
    'UpdateSignInStatus': E('⛔', 'data', function (s) { return { user: str(s.userPrincipalName), v: yn(s.blockCredential) }; }),
    'RevokeUserSessions': E('🚪', 'name', U),
    'CreateHybridUserFlat': E('👤', 'name', function (s) { return { name: str(s.displayName), sam: str(s.samAccount), ou: str(s.organizationalUnit) }; }),
    'CreateOnPremisesUserFlat': E('👤', 'name', function (s) { return { name: str(s.displayName), ou: str(s.organizationalUnit) }; }),
    'CreateOnCloudUser': E('👤', 'data', function (s) { return { name: str(s.displayName), email: str(s.email) }; }),
    'SetLitigationHold': E('⚖', 'data', function (s) { return { user: str(s.userPrincipalName), v: yn(s.litigationHoldEnabled) }; }),
    'EditUserPropertiesForWorkflow': E('✎', 'data', function (s) { var ks = Object.keys(s).filter(function (k) { return k !== 'userPrincipalName'; }); return { n: ks.length, user: str(s.userPrincipalName), keys: ks.join(', ') }; }),
    'EnableDisableAccount': E('⏻', 'name', function (s) { return { user: str(s.userPrincipalName), v: yn(s.enabled) }; }),
    'BulkAddSharePointOwners': E('🗂', 'name', function (s) { return { owners: str(s.owners), target: str(s.target) }; }),
    'UnlockUser': E('🔓', 'name', U),
    'RemoveAllAuthenticationMethods': E('🔑', 'name', U),
    'ManageOnPremisesPassword': E('🔑', 'data', function (s) { return { user: str(s.userPrincipalName), force: s.forceChange !== undefined ? t18('natives.part.forceChange', { v: yn(s.forceChange) }) : '' }; }),
    'ManagePassword': E('🔑', 'data', function (s) { return { user: str(s.userPrincipalName), force: s.forceChange !== undefined ? t18('natives.part.forceChange', { v: yn(s.forceChange) }) : '', never: s.neverExpires !== undefined ? t18('natives.part.neverExpires', { v: yn(s.neverExpires) }) : '' }; }),
    'ResetSyncUserPassword': E('🔑', 'name', U),
    'MoveUserToOrganizationalUnit': E('📁', 'data', function (s) { return { user: str(s.userPrincipalName), ou: str(s.destinationOrganizationalUnit) }; }),
    'RemoveUser': E('🗑', 'data', U),
    'RemoveOnPremisesDistributionGroup': E('🗑', 'name', function (s) { return { group: str(s.distinguishedName) }; }),
    'RemoveDistributionGroup': E('🗑', 'name', function (s) { return { group: str(s.groupId) }; }),
    'RemoveOffice365Group': E('🗑', 'name', function (s) { return { group: str(s.groupId) }; }),
    'SetMultiFactorAuthState': E('🛡', 'name', function (s) { return { user: str(s.userPrincipalName), state: str(s.strongAuthenticationRequirementsState) }; }),
    'ResetMultiFactorAuthState': E('🛡', 'data', U),
    'AddTags': E('🏷', 'name', function (s) { return { tags: str(s.tags), user: str(s.userPrincipalName) }; }),
    'RemoveTags': E('🏷', 'name', function (s) { return { tags: str(s.tags), user: str(s.userPrincipalName) }; }),
    'CreateSecurityGroup': E('👥', 'data', function (s) { return { name: str(s.displayName) }; }),
    'UpdateSecurityGroup': E('👥', 'name', function (s) { return { group: str(s.groupId), desc: s.description ? t18('natives.part.desc', { v: str(s.description) }) : '' }; }),
    'CreateSharePointTeamModernSite': E('🗂', 'name', function (s) { return { title: str(s.title), privacy: str(s.privacy) }; }),
    'ResetPasscodeDeviceCommand': E('📱', 'name', function (s) { return { id: str(s.identifier) }; }),
    'SetCvDeviceTag': E('📱', 'name', function (s) { return { tag: str(s.cvDeviceTag), device: str(s.deviceId) }; }),
    'UnassignTeamsPhoneNumber': E('☎', 'name', U),
    'AddMailboxPermission': E('📬', 'data', function (s) { return { mailbox: str(s.mailbox), user: str(s.userPrincipalName), right: str(s.accessRight) }; }),
    'SetMailBoxCas': E('📬', 'data', function (s) { return { user: str(s.userPrincipalName), list: ['activeSync', 'ews', 'imap', 'mapi', 'owa', 'pop'].map(function (k) { return k + ' ' + yn(s[k]); }).join(', ') }; }),
    'item::if-else': E('⑂', 'data', function (s, n) {
      var cs = conditionsOf(n.raw.filter);
      return { head: cs.length ? t18('natives.part.ifHead', { cond: condText(cs[0]), more: cs.length > 1 ? t18('natives.part.ifMore', { n: cs.length - 1 }) : '' }) : t18('natives.part.ifNone'), t: n.trueBranch.length, f: n.falseBranch.length }; }),
    'item::sequence': E('▤', 'data', function (s, n) { var cs = conditionsOf(n.raw.filter); return { n: n.children.length, cond: cs.length ? t18('natives.part.seqCond', { c: condText(cs[0]) }) : '' }; }),
    'item::delay': E('⏱', 'user', function (s) { return { dur: dur(s.waitDuration), raw: str(s.waitDuration) }; }), // durée en SECONDES: confirmé par l'utilisateur
    'item::stop': E('⏹', 'data', function () { return {}; }),
    'item::stopv2': E('⏹', 'data', function (s) { return { status: str(s.finalStatus) }; }),
    'item::executenestedworkflow': E('↪', 'data', function (s, n, ctx) {
      var id = s.workflowId, nm = ctx && ctx.wfName && ctx.wfName(id), extra = Object.keys(s).filter(function (k) { return k !== 'workflowId' && k !== 'startAfterNDays'; });
      return { target: nm ? t18('natives.q', { v: nm }) : t18('natives.part.wfOut', { v: str(id) }), delay: Number(s.startAfterNDays) > 0 ? t18('natives.part.startAfter', { n: s.startAfterNDays }) : '', params: extra.length ? t18('natives.part.params', { v: extra.join(', ') }) : '' }; }),
    'item::vtenant-check': E('🛰', 'name', function (s) { return { target: str(s.target), id: str(s.id), fw: s.failWhenNotVerified !== undefined ? t18('natives.part.failWhen', { v: yn(s.failWhenNotVerified) }) : '' }; }),
    'item::owner-approval-timeout': E('✅', 'data', function (s) { return { email: str(s.email), subject: str(s.subject), dur: dur(s.customTimeoutSeconds) }; }),
    'http-request.get': E('🌐', 'data', function (s) { return { url: str(s.url) }; })
  };
  Object.keys(T).forEach(function (k) {
    var e = T[k]; e.key = k;
    Object.defineProperty(e, 'label', { get: function () { return t18('natives.label.' + k); }, enumerable: true });
    e.sum = function (s, n, ctx) { return t18('natives.sum.' + k, e.vars(s, n, ctx)); };
  });

  // ---- libellés/formats de champs (clés techniques -> libellé traduit) ----
  var LABEL_KEYS = ['userPrincipalName', 'user', 'member', 'owners', 'groupId', 'securityGroupId', 'to', 'bccAddresses', 'subject', 'body', 'mailbox', 'timeoutSeconds', 'customTimeoutSeconds', 'waitDuration', 'workflowId', 'startAfterNDays',
    'target', 'id', 'propertiesName', 'finalStatus', 'failWhenNotVerified', 'usageLocation', 'selectedLicenses', 'blockCredential', 'enabled', 'litigationHoldEnabled', 'forceChange', 'neverExpires', 'newPassword', 'password', 'firstName', 'lastName',
    'displayName', 'email', 'organizationalUnit', 'destinationOrganizationalUnit', 'tags', 'url', 'ensureSuccessStatusCode', 'contentType', 'typePolicy', 'policyName', 'accessRight', 'owner', 'description', 'domain', 'company', 'privacy',
    'strongAuthenticationRequirementsState', 'multiFactorAuthState', 'distinguishedName', 'title', 'alias', 'activeSync', 'ews', 'imap', 'mapi', 'owa', 'pop'];
  var LABELS = {}; LABEL_KEYS.forEach(function (k) { Object.defineProperty(LABELS, k, { get: function () { return t18('natives.field.' + k); }, enumerable: true }); });
  var DURATION_KEYS = { waitDuration: 1, timeoutSeconds: 1, customTimeoutSeconds: 1 };
  var LIST_KEYS = { to: 1, bccAddresses: 1, tags: 1, propertiesName: 1, owners: 1, selectedLicenses: 1 };
  var HIDE = { startAfterNDays: 0 };

  // kind: bool | duration | list | html | workflow | any
  function fieldsOf(shortKey, s) {
    return Object.keys(s).map(function (k) {
      var v = s[k], kind = 'any', text = null;
      if (k === 'workflowId' && shortKey === 'item::executenestedworkflow') kind = 'workflow';
      else if (k === 'body' && typeof v === 'string') { kind = 'html'; text = htmlToText(v); }
      else if (DURATION_KEYS[k] && (typeof v === 'number' || /^\d+$/.test(String(v)))) { kind = 'duration'; text = dur(v); }
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
      summary = (n.raw.customDescription || '') || (ks.length ? ks.join(' ; ') : t18('natives.generic', { label: genericLabel(n) }));
    }
    var notes = [];
    if (key === 'CheckIfMailboxExists') notes.push(t18('natives.note.mailbox'));
    return { native: true, known: known, key: key, icon: reg ? reg.icon : '⚙', label: reg ? reg.label : genericLabel(n), src: reg ? reg.src : 'name',
      summary: summary, fields: fieldsOf(key, s).filter(function (f) { return HIDE[f.key] === undefined || Number(f.value) > 0; }), outputs: outputsOf(n), notes: notes };
  }

  var api = { describe: describe, isNative: isNative, shortKey: shortKey, htmlToText: htmlToText, opLabel: opLabel, conditionsOf: conditionsOf, condText: condText, dur: dur, registry: T, knownKeys: LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WFV = root.WFV || {}; root.WFV.natives = api; }
})(typeof self !== 'undefined' ? self : globalThis);
