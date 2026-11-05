// Test navigateur sans dépendance: pilote Edge/Chrome local en headless via CDP (WebSocket natif, Node >= 22).
// Usage: node tests/browser-smoke.js [chemin-navigateur]   (ou WFV_BROWSER=...). WFV_DATA = dossier de données (défaut ./fixtures).
// WFV_SERVE=1 : sert l'application via un petit serveur HTTP local 127.0.0.1 (sinon file://). WFV_OUT = dossier de captures (optionnel).
// Sort avec le code 0 et un message SKIP si aucun navigateur n'est trouvé. Échoue sur toute erreur console, exception ou violation CSP.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const DATA = process.env.WFV_DATA ? path.resolve(process.env.WFV_DATA) : path.join(__dirname, '..', 'fixtures');
const APP = path.resolve(__dirname, '..');
const OUT = process.env.WFV_OUT || ''; if (OUT) fs.mkdirSync(OUT, { recursive: true });
const candidates = [process.argv[2], process.env.WFV_BROWSER, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'].filter(Boolean);
const browser = candidates.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
if (!browser) { console.log('SKIP: aucun navigateur Chromium/Edge trouvé (passez le chemin en argument ou WFV_BROWSER).'); process.exit(0); }
if (typeof WebSocket === 'undefined') { console.log('SKIP: WebSocket natif indisponible (Node >= 22 requis).'); process.exit(0); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 500);
const ids = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

(async () => {
  let server = null, url = 'file:///' + path.join(APP, 'index.html').replace(/\\/g, '/');
  if (process.env.WFV_SERVE) {
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
    server = http.createServer((req, res) => { const p = path.join(APP, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html')); if (!p.startsWith(APP) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
    await new Promise((r) => server.listen(0, '127.0.0.1', r)); url = 'http://127.0.0.1:' + server.address().port + '/index.html';
  }
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'wfv-prof-'));
  const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + port, '--user-data-dir=' + prof, '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
  let expectCsp = false; let ws, id = 0; const pend = new Map(), problems = [], res = {}, checks = [];
  const check = (name, cond, extra) => { checks.push([name, !!cond]); if (!cond) problems.push('CHECK FAILED: ' + name + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); };
  try {
    let targets; for (let i = 0; i < 60; i++) { try { targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); if (targets.find((t) => t.type === 'page')) break; } catch (e) { /* attente */ } await sleep(200); }
    ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
    ws.onmessage = (m) => { const d = JSON.parse(m.data);
      if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
      else if (d.method === 'Runtime.exceptionThrown') problems.push('EXC ' + JSON.stringify(d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text));
      else if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) !expectCsp && problems.push('CONSOLE.' + d.params.type + ' ' + d.params.args.map((a) => a.value || a.description).join(' '));
      else if (d.method === 'Log.entryAdded' && ['error', 'warning'].includes(d.params.entry.level) && !(expectCsp && /Content Security Policy|Refused/.test(d.params.entry.text))) problems.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || '')); };
    const send = (method, params) => new Promise((rs, rj) => { const i = ++id; pend.set(i, (d) => (d.error ? rj(new Error(method + ': ' + d.error.message)) : rs(d.result))); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description) + ' <= ' + expr.slice(0, 120)); return r.result.value; };
    const click = (sel) => ev('(()=>{const e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)return false;e.click();return true})()');
    const shot = async (name) => { if (!OUT) return; const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64')); };
    const hash = async (h, ms) => { await ev('location.hash=' + JSON.stringify(h)); await sleep(ms || 500); };
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable'); await send('DOM.enable');
    await send('Page.navigate', { url }); await sleep(1500);
    const doc = await send('DOM.getDocument', { depth: 1 });
    const setFiles = async (sel, files) => { const n = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel }); await send('DOM.setFileInputFiles', { nodeId: n.nodeId, files }); };
    const S = 'window.WFV.app.S';
    const wfId = (name) => ev(S + '.wfs.size&&[...' + S + '.wfs.values()].find(w=>w.name===' + JSON.stringify(name) + ').id');

    // ---- page, CSP, version, chargement des fixtures
    res.page = await ev('({modules:Object.keys(window.WFV).sort().join(","),csp:!!document.querySelector("meta[http-equiv=Content-Security-Policy]"),referrer:(document.querySelector("meta[name=referrer]")||{}).content,version:document.getElementById("appVersion").textContent,footer:document.getElementById("about").innerText.length>60,title:document.title})');
    check('CSP + referrer + version + pied de page', res.page.csp && res.page.referrer === 'no-referrer' && res.page.version === require('../package.json').version && res.page.footer, res.page);
    expectCsp = true; res.cspEffective = await ev('(async()=>{window.__x=0;const s=document.createElement("script");s.textContent="window.__x=1";document.head.append(s);const d=document.createElement("div");d.setAttribute("style","color:red");document.body.append(d);let net="ok";try{await fetch("http://127.0.0.1:1/x");}catch(e){net="bloqué"}d.remove();s.remove();return {inlineScript:window.__x===0,fetch:net}})()'); await sleep(300); expectCsp = false;
    check('CSP effective: script inline et requêtes réseau bloqués', res.cspEffective.inlineScript && res.cspEffective.fetch === 'bloqué', res.cspEffective);
    await setFiles('#inDir', [DATA]); await sleep(2500);
    res.load = await ev('({status:document.getElementById("status").textContent,list:document.querySelectorAll("#list li").length,scripts:' + S + '.store.counts()})');
    check('7 workflows chargés depuis le dossier fixtures + scripts indexés', res.load.list === 7 && res.load.scripts.scripts === 2 && res.load.scripts.actions === 3, res.load);
    const W1 = await wfId('Exemple - Onboarding'), W3 = await wfId('Exemple - Onboarding (copie)'), W2 = await wfId('Exemple - Sous-flux licences');

    // ---- détail, HTML hostile non interprété
    await hash('#wf=' + W1); res.detail = await ev('({nodes:document.querySelectorAll("#main details.node").length,pills:document.querySelectorAll("#main .pill").length,xss:window.__fixture_xss===undefined,scripts:document.querySelectorAll("#main script, #main img, #main iframe").length,inputsRows:document.querySelectorAll("#main tr.inrow").length})');
    check('détail W1: 12 nodes, inputs typés, aucun HTML injecté', res.detail.nodes === 12 && res.detail.inputsRows === 12 && res.detail.xss && res.detail.scripts === 0, res.detail); await shot('detail-base.png');

    // ---- vue de base / expert (état, hash, raccourci, persistance)
    const probe = () => ev('(()=>{const m=document.getElementById("main"),vis=(e)=>e.getClientRects().length>0,G=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;return {expert:document.body.classList.contains("expert"),chk:document.getElementById("chkExpert").checked,guids:(m.innerText.match(G)||[]).length,techVisible:[...m.querySelectorAll(".tech")].filter(vis).length,rawSettings:[...m.querySelectorAll(".raw-settings")].filter(vis).length,hash:location.hash,ls:localStorage.getItem("wfv.expert")}})()');
    const base = await probe(); await click('#chkExpert'); await sleep(300); const exp = await probe(); await shot('detail-expert.png');
    check('base: rien de technique visible; expert: GUID, JSON bruts et hash x=1', !base.expert && base.techVisible === 0 && base.rawSettings === 0 && exp.expert && exp.techVisible > 0 && exp.guids > base.guids && /x=1/.test(exp.hash) && exp.ls === '1', { base, exp });
    await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"e",bubbles:true}))'); await sleep(200); check('raccourci E', !(await probe()).expert);
    await ev('(()=>{const q=document.getElementById("q");q.focus();q.dispatchEvent(new KeyboardEvent("keydown",{key:"e",bubbles:true}))})()'); await sleep(150); check('raccourci E ignoré dans un champ', !(await probe()).expert);

    // ---- comparaison, qualité, flux, appels, impact
    await hash('#wf=' + W1 + '&cmp=' + W3 + '&tab=compare', 700);
    res.compare = await ev('({noiseForced:!!document.getElementById("noiseForced"),rows:document.querySelectorAll("#main .drow").length,summary:document.querySelector("#main .summary").textContent})');
    check('comparaison en base (bruit forcé) avec différences', res.compare.noiseForced && res.compare.rows > 3, res.compare); await shot('compare-base.png');
    await hash('#wf=' + W1 + '&tab=quality'); res.quality = await ev('({rows:document.querySelectorAll("#main tbody tr").length,badges:document.querySelectorAll("#list .badge.sev-error,#list .badge.sev-warning").length})');
    check('qualité: alertes listées + badges latéraux', res.quality.rows >= 5 && res.quality.badges >= 3, res.quality);
    await hash('#tab=quality'); check('qualité globale', await ev('document.querySelectorAll("#main table.grid").length>=2'));
    await hash('#wf=' + W1 + '&tab=flow', 800); res.flow = await ev('({nodes:document.querySelectorAll("#main svg.graph .gnode").length,edges:document.querySelectorAll("#main svg.graph .gedge").length})');
    await ev('document.querySelectorAll("#main svg.graph .gnode")[1].dispatchEvent(new Event("mouseenter"))'); check('flux: SVG, arêtes, surbrillance', res.flow.nodes > 3 && res.flow.edges > 3 && await ev('document.querySelectorAll("#main svg.graph .hl-self").length===1'), res.flow); await shot('flow.png');
    await hash('#wf=' + W1 + '&tab=calls', 800); res.calls = await ev('({nodes:document.querySelectorAll("#main svg.graph .gnode").length,summary:document.querySelector("#main .summary").textContent})');
    check('appels: 7 workflows impliqués (dont 1 hors lot), 1 cycle', res.calls.nodes === 7 && /1 cycle/.test(res.calls.summary), res.calls);
    await ev('window.__blobs=[];const oc=URL.createObjectURL;URL.createObjectURL=function(b){window.__blobs.push(b);return oc.call(URL,b)};window.confirm=()=>true');
    await hash('#tab=impact&act=' + ids(101), 700); await click('#btnImpMd'); await sleep(300);
    res.impact = await ev('(async()=>{const b=window.__blobs;if(!b.length)return null;const t=await b[b.length-1].text();return {len:t.length,head:t.slice(0,32)}})()');
    check('impact: export Markdown (Blob)', res.impact && /Rapport d/.test(res.impact.head), res.impact);

    // ---- édition + export (identité après annulation)
    await hash('#wf=' + W2); await click('#btnEdit'); await sleep(300);
    await ev('window.WFV.editUi.infoDialog(' + S + '.wfs.get(' + JSON.stringify(W2) + '))'); await sleep(200);
    await ev('(()=>{const n=document.getElementById("inName");n.value="Nom édité (smoke)";n.dispatchEvent(new Event("input"))})()'); await click('#btnApplyInfo'); await sleep(400);
    await click('#btnSR'); await sleep(200); await ev('(()=>{document.getElementById("inFind").value="UPN";document.getElementById("inRepl").value="UPN_X"})()'); await click('#btnPreview'); await sleep(300);
    res.edit = { preview: await ev('document.getElementById("prevCount").textContent') }; check('rechercher/remplacer: aperçu non vide', !/^0 /.test(res.edit.preview), res.edit); await click('#btnApplyBulk'); await sleep(500);
    check('indicateur modifié + avertissement d\'export visible', await ev('!!document.getElementById("dirtyBadge")&&[...document.querySelectorAll(".editbar .warnnote")].some(e=>e.getClientRects().length>0)'));
    await click('#btnExport'); await sleep(400); await click('#btnDoExport'); await sleep(400);
    res.edit.export = await ev('(async()=>{const b=window.__blobs,t=await b[b.length-1].text();let ok=true;try{JSON.parse(t)}catch(e){ok=false}return {ok,renamed:JSON.parse(t).data.workflowName,raw:' + S + '.origs.get(' + JSON.stringify(W2) + ').rawText===t}})()');
    check('export modifié: JSON valide, nom modifié, différent de l\'original', res.edit.export.ok && res.edit.export.renamed === 'Nom édité (smoke)' && !res.edit.export.raw, res.edit.export);
    await ev('(()=>{const s=' + S + '.sessions.get(' + JSON.stringify(W2) + ');while(s.undo.length)document.dispatchEvent(new KeyboardEvent("keydown",{key:"z",ctrlKey:true,bubbles:true}))})()'); await sleep(400);
    await click('#btnExport'); await sleep(300); await click('#btnDoExport'); await sleep(400);
    check('annuler tout puis exporter = identique à l\'original', await ev('(async()=>{const b=window.__blobs,t=await b[b.length-1].text();return t===' + S + '.origs.get(' + JSON.stringify(W2) + ').rawText})()'));

    // ---- éditeur d'inputs: ajout, renommage avec propagation, type, enum (gros), ordre, undo, diff, export, JSON brut (expert)
    await hash('#wf=' + W1); await click('#btnEdit'); await sleep(400);
    const set = (sel, v) => ev('(()=>{const e=document.querySelector(' + JSON.stringify(sel) + ');e.value=' + JSON.stringify(v) + ';e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}))})()');
    const props = () => ev('JSON.parse(' + S + '.wfs.get(' + JSON.stringify(W1) + ').data.inputSchema).properties');
    const btnText = (txt) => ev('(()=>{const b=[...document.querySelectorAll("dialog.editdlg[open] button")].find(b=>b.textContent.indexOf(' + JSON.stringify(txt) + ')>=0);if(!b)return false;b.click();return true})()');
    res.inputsEd = await ev('({editor:!!document.getElementById("inputsEditor"),rows:document.querySelectorAll("#inputsEditor tr.inrow-edit").length,roHidden:[...document.querySelectorAll("#main table.inputs")].every(t=>t.closest("[hidden]"))})');
    check('éditeur d\'inputs affiché en édition (12 lignes), tableau en lecture seule masqué', res.inputsEd.editor && res.inputsEd.rows === 12 && res.inputsEd.roHidden, res.inputsEd); await shot('inputs-editor.png');
    await click('#btnAddInputOpen'); await sleep(200); await set('#inAddName', 'NouvelInput'); await set('#selAddKind', 'enum'); await set('#taAddValues', 'A\nB\nA'); await click('#btnAddInput'); await sleep(500);
    let pr = await props(); check('ajout d\'un input liste (valeurs dédoublonnées)', pr.NouvelInput && JSON.stringify(pr.NouvelInput.enum) === '["A","B"]' && Object.keys(pr).length === 13, pr.NouvelInput);
    await click('[data-in="UPN"][data-f="name"]'); await sleep(200); await set('#inRenameNew', 'Identifiant'); await sleep(200);
    const cnt = await ev('document.getElementById("renameCount").textContent'); check('aperçu du renommage (nombre de références)', /^[1-9]\d* valeur/.test(cnt), cnt); await click('#btnDoRename'); await sleep(500);
    pr = await props(); const raw = await ev('JSON.stringify(' + S + '.wfs.get(' + JSON.stringify(W1) + ').data.actions)');
    check('renommage propagé (schéma + références, plus aucune ancienne référence)', 'Identifiant' in pr && !('UPN' in pr) && /input-stepUid::Identifiant::/.test(raw) && !/input-stepUid::UPN::/.test(raw) && JSON.parse(await ev('JSON.stringify(JSON.parse(' + S + '.wfs.get(' + JSON.stringify(W1) + ').data.inputSchema).required)')).includes('Identifiant'));
    await set('select[data-in="Langue"][data-f="kind"]', 'text'); await sleep(400); const confirmShown = await ev('!!document.querySelector("dialog.editdlg[open]")');
    check('changement de type avec perte: avertissement affiché avant application', confirmShown); await btnText('Appliquer quand même'); await sleep(500); pr = await props();
    check('Langue convertie en texte (enum retiré)', pr.Langue && !('enum' in pr.Langue) && pr.Langue.type === 'string', pr.Langue);
    await click('[data-in="NouvelInput"][data-f="enum"]'); await sleep(300);
    await set('#taEnumPaste', Array.from({ length: 1500 }, (_, i) => 'Valeur ' + String(i).padStart(4, '0')).join('\n')); const t0 = Date.now(); await click('#btnEnumPaste'); await sleep(200); const ms = Date.now() - t0;
    res.enum = await ev('({rows:document.querySelectorAll("#enumList .enumrow").length,more:!!document.getElementById("btnEnumMore"),info:document.getElementById("enumInfo").textContent})');
    check('gros enum (1502 valeurs): rendu paresseux (100 lignes) et recherche', res.enum.rows === 100 && res.enum.more && /1502/.test(res.enum.info) && ms < 3000, { res: res.enum, ms });
    await set('#inEnumSearch', 'Valeur 0749'); await sleep(200); check('recherche dans les valeurs', await ev('document.querySelectorAll("#enumList .enumrow").length') === 1);
    await set('#inEnumSearch', ''); await click('#btnEnumApply'); await sleep(600); pr = await props(); check('1502 valeurs appliquées', pr.NouvelInput.enum.length === 1502 && pr.NouvelInput.enum[0] === 'A');
    await click('[data-in="DisplayName"][data-f="up"]'); await sleep(400); pr = await props(); check('réordonner (monter)', Object.keys(pr)[0] === 'DisplayName');
    await set('input[data-in="DisplayName"][data-f="title"]', 'Nom complet'); await sleep(400); check('titre édité en ligne', (await props()).DisplayName.title === 'Nom complet');
    await ev('document.querySelector("#inputsEditor .inrow-edit select[data-f=target]")&&0'); await shot('inputs-editor-edited.png');
    const dirtyDiff = await ev('(()=>{const o=' + S + '.origs.get(' + JSON.stringify(W1) + '),c=' + S + '.wfs.get(' + JSON.stringify(W1) + '),r=window.WFV.diff.diffWorkflows(o,c);return {inputs:r.inputs.summary,nodes:r.summary.added+r.summary.removed}})()');
    check('diff original → modifié: 2 ajoutés (nouvel input + renommé), 1 supprimé (ancien nom), modifiés, nodes inchangés', dirtyDiff.inputs.added === 2 && dirtyDiff.inputs.removed === 1 && dirtyDiff.inputs.modified >= 2 && dirtyDiff.nodes === 0, dirtyDiff);
    await click('#btnExport'); await sleep(400); check('validation d\'export sans erreur après édition d\'inputs', await ev('!!document.getElementById("valOk")')); await click('#btnDoExport'); await sleep(400);
    check('export des inputs modifiés: JSON valide', await ev('(async()=>{const b=window.__blobs,t=await b[b.length-1].text();return !!JSON.parse(t).data.inputSchema&&JSON.parse(JSON.parse(t).data.inputSchema).properties.NouvelInput.enum.length===1502})()'));
    await click('#chkExpert'); await sleep(300); await click('#inputsEditor .tech'); await sleep(300);
    check('expert: JSON brut de l\'input éditable', await ev('!!document.getElementById("taRawInput")')); await ev('document.getElementById("taRawInput").value="{oops";document.getElementById("taRawInput").dispatchEvent(new Event("input"))'); check('JSON brut invalide signalé', /invalide/.test(await ev('document.querySelector("dialog.editdlg[open] .errmsg").textContent')));
    await ev('document.querySelector("dialog.editdlg").close()'); await click('#chkExpert'); await sleep(200);
    await ev('(()=>{const s=' + S + '.sessions.get(' + JSON.stringify(W1) + ');while(s.undo.length)document.dispatchEvent(new KeyboardEvent("keydown",{key:"z",ctrlKey:true,bubbles:true}))})()'); await sleep(500);
    check('annuler tout: workflow identique à l\'original', await ev(S + '.wfs.get(' + JSON.stringify(W1) + ').dirty===false&&Object.keys(JSON.parse(' + S + '.wfs.get(' + JSON.stringify(W1) + ').data.inputSchema).properties).length===12'));
    await click('#btnExport'); await sleep(300); await click('#btnDoExport'); await sleep(400);
    check('export après annulation = octet pour octet', await ev('(async()=>{const b=window.__blobs,t=await b[b.length-1].text();return t===' + S + '.origs.get(' + JSON.stringify(W1) + ').rawText})()'));
    await click('#btnCopyInputs'); await sleep(300); res.copy = await ev('document.getElementById("copyList")&&document.getElementById("copyList").children.length'); check('copie vers un autre workflow: aperçu', res.copy > 0, res.copy); await ev('document.querySelector("dialog.editdlg").close()');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }); await sleep(200); await shot('inputs-editor-light.png'); await send('Emulation.setEmulatedMedia', { features: [] });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true }); await sleep(400); const mo = await ev('({doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,main:document.getElementById("main").scrollWidth-document.getElementById("main").clientWidth})'); check('mobile: éditeur d\'inputs sans débordement', mo.doc <= 0 && mo.main <= 0, mo);
    await click('#btnAddInputOpen'); await sleep(300); const dw = await ev('(()=>{const d=document.querySelector("dialog.editdlg");return d.getBoundingClientRect().width<=window.innerWidth+1})()'); check('mobile: dialogue d\'ajout dans l\'écran', dw); await ev('document.querySelector("dialog.editdlg").close()'); await send('Emulation.clearDeviceMetricsOverride');
    await click('#btnEdit') ; await hash('#tab=global');

    // ---- scripts PowerShell: coloration, bascule, HTML hostile
    await hash('#wf=' + W1); await ev('(()=>{const p=[...document.querySelectorAll("#main .scriptpanel")][0];p.open=true;p.scrollIntoView()})()'); await sleep(500); await click('#btnShowScript'); await sleep(300);
    res.ps = await ev('(()=>{const c=document.querySelector("#main .scriptpanel .code"),k={};c.querySelectorAll("span").forEach(s=>{k[s.className.split(" ")[0]]=1});return {kinds:Object.keys(k).sort(),nonSpan:[...c.querySelectorAll("*")].filter(e=>e.tagName!=="SPAN").length,visible:c.getClientRects().length>0}})()');
    check('coloration: types de tokens présents, aucune balise injectée', res.ps.visible && res.ps.nonSpan === 0 && ['ps-comment', 'ps-hstring', 'ps-keyword', 'ps-variable', 'ps-cmdlet', 'ps-string', 'ps-param'].every((k) => res.ps.kinds.includes(k)), res.ps); await shot('script.png');
    await click('#chkHl'); await sleep(200); const off = await ev('document.querySelectorAll("#main .scriptpanel .code span").length'); await click('#chkHl'); await sleep(300); const on = await ev('document.querySelectorAll("#main .scriptpanel .code span").length');
    check('case Coloration (0 span désactivée, > 0 activée)', off === 0 && on > 20, { off, on });
    const hostile = '# </pre><script>window.__pwn=1</script><img src=x onerror="window.__pwn=2">\n$h = @{ a = "<svg onload=window.__pwn=3>" }\n$s = @"\n</pre><script>window.__pwn=4</script>\n"@\nWrite-Host "<b>x</b> $($h.a)"\n';
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wfv-hostile-')), hf = path.join(tmp, ids(101) + '.ps1'); fs.writeFileSync(hf, hostile);
    await setFiles('#inFiles', [hf]); await sleep(700); await hash('#tab=global'); await hash('#wf=' + W1, 700);
    await ev('(()=>{const p=[...document.querySelectorAll("#main .scriptpanel")][0];p.open=true})()'); await sleep(400); await click('#btnShowScript'); await sleep(300);
    res.hostile = await ev('(()=>{const c=document.querySelector("#main .scriptpanel .code");return {pwn:window.__pwn===undefined,same:c.textContent===' + JSON.stringify(hostile) + ',nonSpan:[...c.querySelectorAll("*")].filter(e=>e.tagName!=="SPAN").length,injected:document.querySelectorAll("#main .scriptpanel script,#main .scriptpanel img,#main .scriptpanel iframe,#main .scriptpanel svg,#main .scriptpanel b").length}})()');
    check('script hostile: texte identique, rien d\'injecté, aucun JS exécuté', res.hostile.pwn && res.hostile.same && res.hostile.nonSpan === 0 && res.hostile.injected === 0, res.hostile); fs.rmSync(tmp, { recursive: true, force: true });

    // ---- mobile 390px: pas de débordement horizontal
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
    for (const [k, hh] of [['detail', '#wf=' + W1], ['compare', '#wf=' + W1 + '&cmp=' + W3 + '&tab=compare'], ['quality', '#tab=quality'], ['flow', '#wf=' + W1 + '&tab=flow'], ['calls', '#tab=calls'], ['impact', '#tab=impact&act=' + ids(101)]]) {
      await hash(hh, 600); const o = await ev('({doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,main:document.getElementById("main").scrollWidth-document.getElementById("main").clientWidth})'); check('mobile sans débordement: ' + k, o.doc <= 0 && o.main <= 0, o);
    }
    await send('Emulation.clearDeviceMetricsOverride');

    // ---- persistance après rechargement + lien partagé
    await hash('#tab=global'); await click('#chkExpert'); await sleep(200); await send('Page.reload'); await sleep(1200);
    res.reload = await ev('({expert:document.body.classList.contains("expert"),chk:document.getElementById("chkExpert").checked,ls:localStorage.getItem("wfv.expert")})'); check('expert persisté après rechargement', res.reload.expert && res.reload.chk && res.reload.ls === '1', res.reload);
    await ev('location.hash="#tab=global&x=0"'); await sleep(300); check('x=0 du hash prioritaire', !(await ev('document.body.classList.contains("expert")')));
    check('aucune requête réseau (ressources chargées = fichiers locaux uniquement)', await ev('performance.getEntriesByType("resource").every(r=>/^(file|http:\\/\\/127\\.0\\.0\\.1)/.test(r.name))'));
  } catch (e) { problems.push('ERREUR TEST ' + e.message); }
  finally { try { ws && ws.close(); } catch (e) { /* */ } proc.kill(); if (server) server.close(); await sleep(300); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* */ } }
  console.log(checks.map((c) => (c[1] ? 'ok   ' : 'ECHEC') + ' ' + c[0]).join('\n'));
  console.log(JSON.stringify({ navigateur: path.basename(browser), mode: process.env.WFV_SERVE ? 'http local' : 'file://', verifications: checks.length, echecs: checks.filter((c) => !c[1]).length, problemes: problems }, null, 1));
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('ECHEC', e); process.exit(2); });
