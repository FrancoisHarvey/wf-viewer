#!/usr/bin/env node
/* Génère le jeu de fixtures SYNTHÉTIQUE (aucune donnée réelle). Usage: node tools/gen-fixtures.js
   Reproduit la STRUCTURE du format (enveloppe {"data":{...}}, nodes, settings double-encodés, JSON compact) avec des valeurs inventées. */
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'fixtures');
const guid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const COMPANY = '00000000000040008000000000000999';
const WF = { onb: guid(1), lic: guid(2), copy: guid(3), root: guid(4), solo: guid(5), cycA: guid(6), cycB: guid(7) };
const CA = { check: guid(101), noscript: guid(102), name: guid(103), unknown: guid(104) };
const OUT_OF_LOT = guid(999);
const ID = {
  mail: 'Generic|Example.Messages.Commands.Notifications.SendEmailNotification',
  retrieve: 'Generic|Example.Messages.Commands.WorkflowIntegration.RetrieveDataFromObject',
  addGroup: 'Management|Example.Messages.Commands.Management.AddSecurityGroupMember',
  removeGroup: 'Management|Example.Messages.Commands.Management.RemoveSecurityGroupMember',
  license: 'Management|Example.Messages.Commands.Management.ManageLicense'
};
const cat = (id, name, extra) => Object.assign({ source: 0, fragmentId: 'example-platform', categoryId: 'Example::Action', categoryName: 'Exemple', categoryIcon: 'Contact', categoryItemId: id, categoryItemName: name, categoryItemIcon: 'fa fa-example', providerId: 'Example', providerName: 'Exemple', providerIcon: 'ExampleLogo' }, extra || {});
const schema = (title, props) => JSON.stringify({ $schema: 'http://json-schema.org/draft-04/schema#', title, type: 'object', additionalProperties: false, properties: props });
const OK_OUT = schema('ActionCompleted', { isSuccessEvent: { type: ['boolean', 'null'] } });
const FAIL_OUT = schema('ActionFailed', { isSuccessEvent: { type: ['boolean', 'null'] } });
const emptyFilter = () => ({ conditions: [], conditionGroups: [] });
const cond = (property, operator, value, type) => ({ property, operator, value, type: type || 'string' });
// nœud: mêmes clés, même ordre que le format réel
function node(o) {
  return {
    id: o.id, uid: o.uid, name: o.name, settings: JSON.stringify(o.settings || {}), inputSchema: o.inputSchema || JSON.stringify({ type: 'object', properties: {} }), filter: o.filter || emptyFilter(), forceSkip: !!o.forceSkip, parentUid: o.parentUid || null,
    successOutputSchema: o.success || OK_OUT, failureOutputSchema: o.failure === undefined ? FAIL_OUT : o.failure, source: o.cat.source, fragmentId: o.cat.fragmentId, categoryId: o.cat.categoryId, categoryName: o.cat.categoryName, categoryIcon: o.cat.categoryIcon,
    categoryItemId: o.cat.categoryItemId, categoryItemName: o.cat.categoryItemName, categoryItemIcon: o.cat.categoryItemIcon, providerId: o.cat.providerId, providerName: o.cat.providerName, providerIcon: o.cat.providerIcon,
    customDescription: o.desc || null, trueBranch: o.trueBranch || [], falseBranch: o.falseBranch || []
  };
}
const N = {
  seq: (uid, name, filter) => node({ id: 'item::sequence', uid, name, filter, cat: cat('item::sequence', 'Séquence', { categoryId: 'Miscellaneous::Action', categoryName: 'Miscellaneous', categoryIcon: 'List', categoryItemIcon: 'List', providerId: null, providerName: null, providerIcon: null }) }),
  iff: (uid, name, filter, t, f) => node({ id: 'item::if-else', uid, name, filter, trueBranch: t, falseBranch: f, cat: cat('item::if-else', 'Condition', { categoryId: 'Miscellaneous::Action', categoryName: 'Miscellaneous', providerId: null, providerName: null, providerIcon: null }) }),
  delay: (uid, name, secs) => node({ id: 'item::delay', uid, name, settings: { waitDuration: secs }, cat: cat('item::delay', 'Delay', { categoryId: 'Miscellaneous::Action', categoryName: 'Autres', providerId: null, providerName: null, providerIcon: null }) }),
  stop: (uid, name, status, desc) => node({ id: 'item::stopv2', uid, name, settings: { finalStatus: status }, desc, cat: cat('item::stopv2', 'Stop', { categoryId: 'Miscellaneous::Action', categoryName: 'Miscellaneous', providerId: null, providerName: null, providerIcon: null }) }),
  nested: (uid, name, target, extra, filter) => node({ id: 'item::executenestedworkflow', uid, name, filter, settings: Object.assign({ workflowId: target, startAfterNDays: 0 }, extra || {}), cat: cat('item::executenestedworkflow', 'Exécuter un sous-flux', { categoryId: 'Miscellaneous::Action', categoryName: 'Miscellaneous', providerId: null, providerName: null, providerIcon: null }) }),
  mail: (uid, name, s, extra) => node(Object.assign({ id: ID.mail, uid, name, settings: s, cat: cat(ID.mail, 'Envoyer un e-mail', { categoryId: 'Notifications::Action', categoryName: 'Courriel' }) }, extra || {})),
  retrieve: (uid, name, s, parentUid) => node({ id: ID.retrieve, uid, name, settings: s, parentUid, success: schema('RetrieveCompleted', { isSuccessEvent: { type: ['boolean', 'null'] }, target: { type: 'string' }, propertiesValue: { type: 'object' }, 'propertiesValue.Alias': { type: 'string' }, id: { type: 'string' } }), cat: cat(ID.retrieve, 'Lire des données d\'un objet', { categoryName: 'Autres' }) }),
  group: (id, uid, name, s) => node({ id, uid, name, settings: s, cat: cat(id, id === ID.addGroup ? 'Ajouter au groupe' : 'Retirer du groupe', { categoryName: 'Groupe' }) }),
  license: (uid, name, s) => node({ id: ID.license, uid, name, settings: s, cat: cat(ID.license, 'Gérer les licences', { categoryName: 'Utilisateur' }) }),
  custom: (guidCa, uid, name, s, parentUid, filter, title) => node({ id: 'CustomManagementAction|' + guidCa, uid, name, settings: s, parentUid, filter, success: schema('CustomActionExecutionCompletedEvent', { isSuccessEvent: { type: ['boolean', 'null'] } }), failure: schema('CustomActionExecutionFailedEvent', { isSuccessEvent: { type: ['boolean', 'null'] } }),
    cat: cat('CustomManagementAction|' + guidCa, title || name, { source: 1, categoryId: 'CustomAction::Action', categoryName: 'Actions personnalisées', categoryIcon: 'ms-Icon ms-Icon--SetAction', categoryItemIcon: 'ms-Icon ms-Icon--SetAction', providerId: 'Example::Platform', providerName: null, providerIcon: null }) })
};
const IN = (nm) => '{{input::input-stepUid::' + nm + '::' + nm + '}}';
const REF = (uid, p, label) => '{{action::' + uid + '::' + p + '::' + (label || 'X') + '}}';
const uidOf = (w, n) => guid(1000 + w * 100 + n);

// inputSchema: une propriété de chaque catégorie typée
function inputs(extra, required) {
  const p = {
    UPN: { type: 'string', title: 'UPN', inputDescription: 'Identifiant de l\'utilisateur', inputTargetType: 'noTarget' },
    DisplayName: { type: 'string', title: 'DisplayName', inputDescription: '', inputTargetType: 'noTarget' },
    ManagerEmail: { type: 'string', title: 'ManagerEmail', inputDescription: 'Courriel du gestionnaire', inputTargetType: 'noTarget' },
    Langue: { type: 'string', title: 'Langue', inputDescription: '', inputTargetType: 'noTarget', enum: ['FR', 'EN'] },
    Confirmer: { type: 'string', title: 'Confirmer', inputDescription: '', inputTargetType: 'noTarget', enum: ['Non', 'Oui'] },
    EnvoyerMail: { type: 'boolean', title: 'EnvoyerMail', inputDescription: '', inputTargetType: 'noTarget' },
    Quota: { type: 'integer', title: 'Quota', inputDescription: '', inputTargetType: 'noTarget' },
    DateDebut: { type: 'string', title: 'DateDebut', inputDescription: '', inputTargetType: 'noTarget', format: 'date-time', 'x-cv-ui': 'DateTimePicker' },
    MotDePasse: { type: 'string', title: 'MotDePasse', inputDescription: '', inputTargetType: 'noTarget', 'x-cv-protected': true, 'x-cv-password': true, 'x-cv-tooltip': 'PasswordRules', passwordRules: { specifyLength: true, minLength: 12, requireUppercase: true, requiredigits: true, requireSpecialChars: true, isEditable: true } },
    ListePerso: { type: 'string', title: 'ListePerso', inputDescription: '', inputTargetType: 'noTarget', 'x-cv-custom-list': guid(201) },
    Source: { type: 'string', title: 'Source', inputDescription: '', inputTargetType: 'noTarget', 'x-cv-data-source': 'example-source', 'x-cv-data-source-filterable': true },
    Cible: { type: 'string', title: 'Cible', inputDescription: '', inputTargetType: 'User' }
  };
  Object.assign(p, extra || {});
  return JSON.stringify({ type: 'object', properties: p, required: required || ['UPN'] });
}
const simpleInputs = (names, req) => JSON.stringify({ type: 'object', properties: Object.fromEntries(names.map((n) => [n, { type: 'string', title: n, inputDescription: '', inputTargetType: 'noTarget' }])), required: req || [] });

// enveloppe: mêmes 33 clés, même ordre que le format réel
function workflow(o) {
  const t = '2026-01-01T00:00:00Z';
  return { data: {
    owner: 'owner@example.com', inputSchema: o.inputSchema, eventName: null, targetsConfig: { targets: [JSON.stringify(o.target || {})] }, filter: o.filter === undefined ? null : o.filter, status: o.status || 'Active', updatedAt: 1767225600, createdAt: 1767139200, executionTimeoutSeconds: null,
    workflowConfig: null, notificationConfig: null, isDraft: false, isPublished: true, canEdit: true, id: o.id, companyId: COMPANY, workflowName: o.name, description: o.description === undefined ? null : o.description, inputData: {}, actions: o.actions, catchActions: o.catchActions || [],
    associatedCustomPolicyIds: [], duplicatedOfId: o.duplicatedOfId || null, isDuplicated: !!o.duplicatedOfId, parentWorkflowIds: o.parents || [], createdBy: 'author@example.com', createdDate: t, updatedBy: 'editor@example.com', updatedDate: '2026-01-02T10:30:00.000Z',
    canRunInHighPriority: false, shouldAlwaysRunInHighPriority: false, shouldTrim: false, virtualTenants: []
  } };
}

// ---------- W1: Onboarding ----------
function onboarding() {
  const u = (n) => uidOf(1, n);
  const retrieve = N.retrieve(u(2), 'Lire le compte', { id: IN('UPN'), target: 'User', propertiesName: ['Alias'] }, u(1));
  const check = N.custom(CA.check, u(3), 'Vérifier l\'appartenance', { UserPrincipalName: IN('UPN'), groupIds: guid(301) + ',' + guid(302) }, u(1), undefined, 'Exemple - Vérifier appartenance');
  const seq = N.seq(u(1), 'Préparation');
  const welcome = N.mail(u(5), 'Courriel de bienvenue', { to: [IN('ManagerEmail'), 'rh@example.com'], bccAddresses: ['archive@example.com'], subject: 'Bienvenue ' + IN('DisplayName'), body: '<div>Bonjour ' + IN('DisplayName') + ',</div><div><b>Votre compte</b> ' + REF(u(2), 'propertiesValue.Alias', 'Alias') + ' est prêt.</div><script>window.__fixture_xss = 1</script>' }, { filter: { conditions: [], conditionGroups: [{ conditions: [cond(IN('EnvoyerMail'), 'IsEqual', 'true', 'boolean')] }] } });
  const pause = N.delay(u(6), 'Attendre la synchronisation', 300);
  const addGroup = N.group(ID.addGroup, u(7), 'Ajouter au groupe d\'accueil', { securityGroupId: guid(303), member: REF(u(3), 'response[0].UserPrincipalName', 'UPN') });
  const ifNode = N.iff(u(4), 'Compte existant ?', { conditions: [], conditionGroups: [{ conditions: [cond(REF(u(3), 'response[0].Member', 'Member'), 'IsEqual', 'Oui'), cond(IN('Langue'), 'IsNotEmpty', '')] }] }, [welcome, pause], [addGroup]);
  const nested = N.nested(u(8), 'Attribuer les licences', WF.lic, { UPN: IN('UPN'), Region: 'CA' });
  const bad = N.mail(u(9), 'Courriel avec token mal formé', { to: ['rh@example.com'], subject: 'Erreur', body: 'Résultat : {{action::' + u(3) + '::response[0}::Member}}' });
  const stop = N.stop(u(10), 'Fin', 'Succeeded', 'Terminé normalement');
  const unknownCa = N.custom(CA.noscript, u(11), 'Action sans script', { Mode: 'test' }, undefined, undefined, 'Exemple - Action sans script');
  const failMail = N.mail(u(12), 'Alerte en cas d\'échec', { to: ['admin@example.com'], subject: 'Échec du flux', body: '<div>Une erreur est survenue.</div>' });
  return workflow({ id: WF.onb, name: 'Exemple - Onboarding', description: 'Flux fictif de démonstration: crée un accès et notifie.', inputSchema: inputs(), target: { targetOption: 'User', fields: [] },
    actions: [seq, retrieve, check, ifNode, nested, bad, unknownCa, stop], catchActions: [failMail], parents: [WF.root] });
}
// ---------- W2: Licences (sous-flux) ----------
function licences() {
  const u = (n) => uidOf(2, n);
  const getUser = N.retrieve(u(1), 'Lire les propriétés', { id: IN('UPN'), target: 'User', propertiesName: ['Alias'] });
  const norm = N.custom(CA.name, u(2), 'Normaliser le nom', { Name: IN('UPN') }, undefined, undefined, 'Exemple - Normaliser nom');
  const lic = N.license(u(3), 'Assigner la licence', { userPrincipalName: '{{input::input-stepUid::UPN::UPN::removeSpaces(true,true,true)}}', usageLocation: 'CA', selectedLicenses: ['SKU_BASE', 'SKU_BASE|0', 'SKU_PLUS'] });
  const typo = N.mail(u(4), 'Courriel de confirmation', { to: [IN('Fantome')], subject: 'Licence ' + REF(u(2), 'reponse[0].Name', 'Name'), body: 'Terminé' });
  const unk = N.custom(CA.unknown, u(5), 'Action inconnue', { x: '1' }, undefined, undefined, 'Action inconnue');
  const flag = N.custom(CA.check, u(6), 'Contrôle', { UserPrincipalName: IN('UPN'), Mode: 'strict', Verbose: true }, undefined, undefined, 'Exemple - Vérifier appartenance');
  return workflow({ id: WF.lic, name: 'Exemple - Sous-flux licences', description: 'Sous-flux appelé par l\'onboarding.', inputSchema: simpleInputs(['UPN', 'Region', 'Inutilise'], ['UPN']), actions: [getUser, norm, lic, typo, unk, flag], parents: [WF.root] });
}
// ---------- W3: copie légèrement différente de W1 ----------
function copyOfOnboarding() {
  const w = JSON.parse(JSON.stringify(onboarding()));
  const d = w.data; d.id = WF.copy; d.workflowName = 'Exemple - Onboarding (copie)'; d.status = 'Inactive'; d.duplicatedOfId = WF.onb; d.isDuplicated = true; d.parentWorkflowIds = []; d.description = 'Copie modifiée pour tester la comparaison.';
  const sch = JSON.parse(d.inputSchema); sch.properties.Langue.enum = ['FR', 'EN', 'ES']; sch.required = ['UPN', 'DisplayName']; sch.properties.Commentaire = { type: 'string', title: 'Commentaire', inputDescription: '', inputTargetType: 'noTarget' }; delete sch.properties.Quota; d.inputSchema = JSON.stringify(sch);
  const ifN = d.actions.find((n) => n.id === 'item::if-else'); const delay = ifN.trueBranch.find((n) => n.id === 'item::delay'); delay.settings = JSON.stringify({ waitDuration: 600 });
  const mail = ifN.trueBranch.find((n) => n.name === 'Courriel de bienvenue'); mail.name = 'Courriel d\'accueil'; const ms = JSON.parse(mail.settings); ms.subject = 'Accueil ' + IN('DisplayName'); mail.settings = JSON.stringify(ms);
  d.actions.push(N.group(ID.removeGroup, uidOf(3, 20), 'Retirer du groupe temporaire', { securityGroupId: guid(304), member: IN('UPN') }));
  return w;
}
// ---------- W4: appelant racine ----------
function root() {
  const u = (n) => uidOf(4, n);
  return workflow({ id: WF.root, name: 'Exemple - Appelant racine', description: 'Appelle les autres flux.', inputSchema: simpleInputs(['UPN'], ['UPN']),
    actions: [N.nested(u(1), 'Lancer l\'onboarding', WF.onb, { UPN: IN('UPN') }), N.nested(u(2), 'Lancer les licences', WF.lic, { UPN: IN('UPN') }), N.nested(u(3), 'Flux externe', OUT_OF_LOT, { UPN: IN('UPN') })] });
}
// ---------- W5: sans dépendance (séquence vide, if sans branche) ----------
function solo() {
  const u = (n) => uidOf(5, n);
  return workflow({ id: WF.solo, name: 'Exemple - Sans dépendance', description: null, inputSchema: simpleInputs(['Parametre'], []), actions: [N.seq(u(1), 'Séquence vide'), N.iff(u(2), 'Condition sans branche', emptyFilter(), [], []), N.stop(u(3), 'Arrêt', 'Stopped')] });
}
// ---------- W6/W7: cycle ----------
const cycA = () => workflow({ id: WF.cycA, name: 'Exemple - Cycle A', inputSchema: simpleInputs([], []), actions: [N.nested(uidOf(6, 1), 'Appeler B', WF.cycB)] });
const cycB = () => workflow({ id: WF.cycB, name: 'Exemple - Cycle B', inputSchema: simpleInputs([], []), actions: [N.nested(uidOf(7, 1), 'Appeler A', WF.cycA)] });

const flows = [onboarding(), licences(), copyOfOnboarding(), root(), solo(), cycA(), cycB()];
fs.mkdirSync(path.join(OUT, 'workflows'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'scripts'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'proposed-fixes'), { recursive: true });
flows.forEach((w) => fs.writeFileSync(path.join(OUT, 'workflows', w.data.id + '.json'), JSON.stringify(w)));

// ---------- scripts PowerShell fictifs ----------
const ps1 = `<#
  Exemple fictif: vérifie l'appartenance à des groupes.
#>
param (
    [Parameter(Mandatory=$true)][string]$UserPrincipalName,
    [string]$groupIds,  # liste séparée par des virgules
    [Parameter(Mandatory=$true)][string]$Mode
)

# Variables d'environnement et constantes
$IsSucces = $false
$Message = ""
$config = @{
    Server  = 'example.invalid'
    Port    = 8443
    Retries = 3
    Tags    = @('a', 'b')
}

$template = @"
<html><body>
<h1>Rapport pour $UserPrincipalName</h1>
<p>Mode : $($Mode.ToUpper())</p>
<script>alert('exemple inoffensif')</script>
</body></html>
"@

function Get-ExampleMember {
    param ([string]$Id, [string]$Upn)
    try {
        $result = Get-MgUser -UserId $Upn -ErrorAction Stop
        foreach ($g in ($Id -split ',')) {
            if ($g.Trim() -eq '' -or $g -notmatch '^[0-9a-f-]+$') { continue }
            Write-Host "Groupe $g : $($result.DisplayName)"
        }
        return $true
    }
    catch {
        Write-Error "Erreur: $($_.Exception.Message)"
        return $false
    }
}

$ok = Get-ExampleMember -Id $groupIds -Upn $UserPrincipalName
$retour = [pscustomobject]@{ membreDUnDesGroupes = if ($ok) { 'Oui' } else { 'Non' }; Count = 0x10 }
$retour | ConvertTo-Json
`;
const ps1small = `param ([string]$Name)

$clean = $Name.Trim().ToLower() -replace '\\s+', '-'
Write-Output "Nom normalisé : $clean"
`;
const ps1fix = `# PROPOSITION FICTIVE - exemple de correctif
param ([Parameter(Mandatory=$true)][string]$UserPrincipalName, [string]$groupIds, [Parameter(Mandatory=$true)][string]$Mode)
$user = Get-MgUser -UserId $UserPrincipalName
Write-Output $user.Id
`;
fs.writeFileSync(path.join(OUT, 'scripts', CA.check + '.ps1'), ps1);
fs.writeFileSync(path.join(OUT, 'scripts', CA.name + '.ps1'), ps1small);
fs.writeFileSync(path.join(OUT, 'proposed-fixes', CA.check + '.ps1'), ps1fix);

// ---------- liste de custom actions (2 pages) + CSV PS7 ----------
const action = (id, title, state, extra) => Object.assign({ id, title, description: 'Action fictive ' + title, companyId: COMPANY, scriptUri: 'https://example.invalid/customactions/' + id + '.ps1', state, lastModified: '2026-01-02T08:00:00.0000000Z', createdBy: 'author@example.com', target: 'User', tags: [], vars: [], params: [{ name: 'UserPrincipalName', type: 'string', isDefault: false }], powershellChannels: [], columns: { UserPrincipalName: '' }, rejectReasons: [], version: 3, md5Sum: '', usePowerShell7: false }, extra || {});
const meta = (n) => ({ pageNumber: n, pageSize: 2, pageCount: 2, totalCount: 3, links: [] });
fs.writeFileSync(path.join(OUT, 'customaction.raw.txt'), JSON.stringify({ customActions: [action(CA.check, 'Exemple - Vérifier appartenance', 'Published'), action(CA.noscript, 'Exemple - Action sans script', 'UnderReview')], configs: {}, metadata: meta(1), savedReportInfo: null }, null, 4));
fs.writeFileSync(path.join(OUT, 'customaction.page2.raw.txt'), JSON.stringify({ customActions: [action(CA.name, 'Exemple - Normaliser nom', 'Published', { params: [{ name: 'Name', type: 'string', isDefault: false }] })], configs: {}, metadata: meta(2), savedReportInfo: null }));
const header = ['File', 'ActionName', 'ActionId', 'Status', 'Issues', 'Lines', 'Modules', 'Description', 'SuggestedFix', 'State', 'Version', 'Target', 'LastModified', 'CreatedBy', 'UsePowerShell7', 'Tags', 'UsedInWorkflows', 'WorkflowCount', 'WorkflowNames', 'ActiveWorkflowCount'];
const row = (id, name, status, issues, fix) => [id + '.ps1', name, id, status, issues, '', 'Example.Module', 'Params: UserPrincipalName', fix, 'Published', '3', 'User', '2026-01-02 08:00:00', 'author@example.com', 'False', '', '', '2', 'Exemple - Onboarding', '1'];
const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const csv = '﻿' + [header, row(CA.check, 'Exemple - Vérifier appartenance', 'Risk', 'Remoting: Invoke-Command', 'Utiliser une session locale'), row(CA.name, 'Exemple - Normaliser nom', 'OK', '(info) sortie JSON légèrement différente', '')].map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
fs.writeFileSync(path.join(OUT, 'ps7-compat-report.csv'), csv);
console.log('fixtures générées:', flows.length, 'workflows,', 3, 'scripts,', 'customaction x2, csv');
