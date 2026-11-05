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
  const check = (name, cond, extra) => { checks.push([name, !!cond]); if (process.env.WFV_VERBOSE) console.log((cond ? 'ok   ' : 'ECHEC') + ' ' + name); if (!cond) problems.push('CHECK FAILED: ' + name + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); };
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
    // Les vérifications historiques (libellés français) s'exécutent avec un navigateur en français; la section i18n en fin de fichier teste les autres langues.
    const UA0 = await ev('navigator.userAgent'); await send('Emulation.setUserAgentOverride', { userAgent: UA0, acceptLanguage: 'fr-CA' });
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
    // ---- données de démonstration: depuis un état vide, bandeau, badge, visite guidée au clavier, confirmation, quitter
    const key = (k) => ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:' + JSON.stringify(k) + ',bubbles:true,cancelable:true}))');
    const dvis = () => ev('({banner:!document.getElementById("demoBanner").hidden,list:document.querySelectorAll("#list li").length,badges:document.querySelectorAll("#list .badge.demo").length,count:document.getElementById("demoCount").textContent,status:document.getElementById("status").textContent,welcome:!!document.getElementById("btnDemoWelcome"),hash:location.hash})');
    res.demo = {}; res.demo.empty = await dvis(); check('état vide: bouton démo visible (accueil et barre du haut), bandeau masqué', res.demo.empty.welcome && !res.demo.empty.banner && res.demo.empty.list === 0 && await ev('!!document.getElementById("btnDemo")&&document.getElementById("btnDemo").getClientRects().length>0'), res.demo.empty);
    await click('#btnDemoWelcome'); await sleep(1500); res.demo.loaded = await dvis(); await shot('demo-loaded.png');
    check('démo chargée: bandeau, 7 workflows marqués « démo », annonce, workflow ouvert', res.demo.loaded.banner && res.demo.loaded.list === 7 && res.demo.loaded.badges === 7 && /Données de démonstration chargées/.test(res.demo.loaded.status) && /^#wf=00000000-0000-4000-8000-000000000001/.test(res.demo.loaded.hash) && /7 workflow/.test(res.demo.loaded.count), res.demo.loaded);
    check('démo: scripts, custom actions et rapport PS7 indexés', await ev(S + '.store.counts().scripts===2&&' + S + '.store.counts().actions===3&&' + S + '.store.counts().ps7===2'));
    check('détail de l\'exemple: séquence, if-else, nested et custom action rendus', await ev('document.querySelectorAll("#main details.node").length===12&&!!document.querySelector("#main .k-custom")'));
    await click('#btnTour'); await sleep(500); const t1 = await ev('({open:!!document.getElementById("tour"),role:document.getElementById("tour").getAttribute("role"),focus:document.activeElement.id,step:document.getElementById("tourStep").textContent})'); await shot('demo-tour.png');
    check('visite guidée ouverte (dialog non modal, focus sur Suivant)', t1.open && t1.role === 'dialog' && t1.focus === 'tourNext' && /1 \/ 6/.test(t1.step), t1);
    await key('ArrowRight'); await sleep(400); await key('ArrowRight'); await sleep(700); const t2 = await ev('({step:document.getElementById("tourStep").textContent,hash:location.hash,target:!!document.querySelector(".tour-target")})');
    check('visite au clavier (→ → = comparaison du duplicata)', /3 \/ 6/.test(t2.step) && /tab=compare/.test(t2.hash) && t2.target, t2); await key('ArrowLeft'); await sleep(400);
    check('visite au clavier (←)', /2 \/ 6/.test(await ev('document.getElementById("tourStep").textContent')));
    await key('Escape'); await sleep(300); check('Échap ferme la visite et retire la mise en évidence', await ev('!document.getElementById("tour")&&!document.querySelector(".tour-target")'));
    await click('#btnTour'); await sleep(300); for (let i = 0; i < 6; i++) { await key('ArrowRight'); await sleep(300); } check('parcours complet jusqu\'à la fin ferme la visite', await ev('!document.getElementById("tour")'));
    await ev('window.confirm=()=>true'); await ev('window.WFV.editUi.exportDialog(' + S + '.wfs.get("' + ids(1) + '"))'); await sleep(300);
    check('export d\'un workflow démo: mention « exemple fictif »', await ev('(()=>{const n=document.getElementById("demoExportNote");return !!n&&/Exemple fictif/.test(n.textContent)&&n.getClientRects().length>0})()')); await ev('document.querySelector("dialog.editdlg").close()');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true }); await sleep(300); await click('#btnTour'); await sleep(500); await shot('demo-mobile.png');
    const moDemo = await ev('({doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,tourIn:(()=>{const r=document.getElementById("tour").getBoundingClientRect();return r.left>=0&&r.right<=window.innerWidth})()})'); check('mobile 390px: bandeau et bulle de visite sans débordement', moDemo.doc <= 0 && moDemo.tourIn, moDemo); await key('Escape'); await send('Emulation.clearDeviceMetricsOverride');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }); await click('#btnTour'); await sleep(400); await shot('demo-tour-light.png'); await key('Escape'); await send('Emulation.setEmulatedMedia', { features: [] });
    await click('#btnQuitDemo'); await sleep(500); res.demo.quit = await dvis(); check('quitter la démo: liste vidée, accueil rétabli, bandeau masqué', !res.demo.quit.banner && res.demo.quit.list === 0 && res.demo.quit.welcome && await ev(S + '.store.counts().scripts===0'), res.demo.quit);
    const tmpReal = fs.mkdtempSync(path.join(os.tmpdir(), 'wfv-real-')), realF = path.join(tmpReal, ids(900) + '.json'), rj = JSON.parse(fs.readFileSync(path.join(DATA, 'workflows', ids(5) + '.json'), 'utf8')); rj.data.id = ids(900); rj.data.workflowName = 'Mon vrai workflow (test)'; fs.writeFileSync(realF, JSON.stringify(rj));
    await setFiles('#inFiles', [realF]); await sleep(800); check('un workflow « réel » est chargé', (await dvis()).list === 1 && !(await dvis()).banner);
    await click('#btnDemo'); await sleep(400); const dlgBtns = await ev('["btnDemoReplace","btnDemoAdd"].map(i=>!!document.getElementById(i))'); check('confirmation: choix Remplacer / Ajouter quand des fichiers réels sont déjà chargés', dlgBtns[0] && dlgBtns[1] && (await dvis()).list === 1, dlgBtns);
    await click('#btnDemoAdd'); await sleep(1500); res.demo.added = await dvis(); check('« Ajouter »: 8 workflows (1 réel + 7 démo), 7 badges', res.demo.added.list === 8 && res.demo.added.badges === 7 && res.demo.added.banner, res.demo.added);
    await click('#btnQuitDemo'); await sleep(500); check('quitter la démo conserve le workflow réel', (await dvis()).list === 1 && !(await dvis()).banner);
    await click('#btnDemo'); await sleep(400); await click('#btnDemoReplace'); await sleep(1500); res.demo.replaced = await dvis(); check('« Remplacer »: le workflow réel est effacé, 7 démo', res.demo.replaced.list === 7 && res.demo.replaced.badges === 7, res.demo.replaced);
    fs.rmSync(tmpReal, { recursive: true, force: true }); await click('#btnQuitDemo'); await sleep(400);
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

    // ================= i18n (phase B1): détection, bascule manuelle, persistance, anglais =================
    // Les parties édition / éditeur d'inputs (edit-ui.js, inputs-ui.js) ne sont traduites qu'en phase B2: elles ne sont pas contrôlées ici.
    const UA = await ev('navigator.userAgent');
    const nav = async (langs, hashStr, keepStore) => {
      await send('Emulation.setUserAgentOverride', { userAgent: UA, acceptLanguage: langs });
      if (!keepStore) { await send('Page.navigate', { url }); await sleep(900); await ev('(()=>{try{localStorage.removeItem("wfv.lang");localStorage.removeItem("wfv.expert")}catch(e){}})()'); }
      await send('Page.navigate', { url: 'about:blank' }); await sleep(200); await send('Page.navigate', { url: url + (hashStr || '') }); await sleep(1500);
    };
    const probeLang = () => ev('({lang:document.documentElement.lang,open:document.getElementById("btnOpen").textContent,sel:document.getElementById("selLang").value,tabs:[...document.querySelectorAll("#tabs button")].map(b=>b.textContent).join("|"),title:document.title,nav:navigator.languages.join(","),foot:document.getElementById("about").innerText,ph:document.getElementById("q").placeholder,hash:location.hash})');
    res.i18n = {};
    await nav('en-US'); res.i18n.en = await probeLang();
    check('navigator.languages [en-US] -> anglais (html lang, bouton, onglets, titre, pied de page, placeholder)', res.i18n.en.lang === 'en' && res.i18n.en.open === 'Open folder…' && res.i18n.en.sel === 'en' && res.i18n.en.tabs === 'Detail|Compare|Analysis|Quality|Flow|Calls|Impact|Global' && /workflow viewer \(unofficial\)/.test(res.i18n.en.title) && /not affiliated with CoreView/.test(res.i18n.en.foot) && /Search/.test(res.i18n.en.ph), res.i18n.en);
    await nav('fr-CA,fr;q=0.9'); res.i18n.fr = await probeLang();
    check('navigator.languages [fr-CA] -> français', res.i18n.fr.lang === 'fr' && res.i18n.fr.open === 'Ouvrir dossier…' && res.i18n.fr.sel === 'fr' && res.i18n.fr.tabs === 'Détail|Comparer|Analyse|Qualité|Flux|Appels|Impact|Global' && /non affilié à CoreView/.test(res.i18n.fr.foot), res.i18n.fr);
    await nav('de-DE'); res.i18n.de = await probeLang(); check('navigator.languages [de-DE] -> anglais', res.i18n.de.lang === 'en' && res.i18n.de.open === 'Open folder…', res.i18n.de);
    await nav('en-US', '#lang=fr', true); check('hash #lang=fr prioritaire sur le navigateur (en-US)', (await probeLang()).lang === 'fr');
    // démo + visite guidée en anglais
    await nav('en-US'); await click('#btnDemoWelcome'); await sleep(1500);
    res.i18n.demo = await ev('({banner:document.getElementById("demoBanner").innerText,status:document.getElementById("status").textContent,badge:(document.querySelector("#list .badge.demo")||{}).textContent,count:document.getElementById("demoCount").textContent,tour:document.getElementById("btnTour").textContent,wf:document.getElementById("count").textContent})');
    check('démo en anglais: bandeau, annonce, pastille, compteur', /Demo data \(fictional\)/.test(res.i18n.demo.banner) && /Demo data loaded: 7 fictional workflows/.test(res.i18n.demo.status) && res.i18n.demo.badge === 'demo' && /7 fictional workflows/.test(res.i18n.demo.count) && res.i18n.demo.tour === 'Guided tour' && /7 \/ 7 workflows/.test(res.i18n.demo.wf), res.i18n.demo);
    await shot('en-demo-loaded.png');
    await click('#btnTour'); await sleep(500); const tourEn = await ev('({title:document.getElementById("tourTitle").textContent,text:document.getElementById("tourText").textContent,step:document.getElementById("tourStep").textContent,next:document.getElementById("tourNext").textContent,prev:document.getElementById("tourPrev").textContent,close:document.getElementById("tourClose").getAttribute("aria-label")})');
    check('visite guidée (étape 1) en anglais', tourEn.title === 'The workflow list' && /^On the left/.test(tourEn.text) && tourEn.step === 'Step 1 / 6' && tourEn.next === 'Next →' && /Close the guided tour/.test(tourEn.close), tourEn); await shot('en-tour.png');
    const titlesEn = []; for (let i = 0; i < 5; i++) { await key('ArrowRight'); await sleep(450); titlesEn.push(await ev('document.getElementById("tourTitle").textContent')); }
    check('6 étapes de la visite en anglais', titlesEn.join('|') === 'A workflow in detail|Compare a duplicate|The Quality tab|Basic or expert view|Editing and the input editor', titlesEn); await key('Escape'); await sleep(200);
    // onglets en anglais (aucune interface française hors édition)
    const WD = await wfId('Exemple - Onboarding'), WC = await wfId('Exemple - Onboarding (copie)');
    const FR_UI = /(Aucun[e]?\b|Chemin\b|Règles?\b|Appelé|Appelle\b|Détail|Tout replier|Tout déplier|Copier\b|Statut\b|Sévérité|Sélectionnez|Workflows chargés|Comparer avec|Valeurs\b|Qualité\b|Flux de|Usage global|Lecture seule|Cibles|Filtre du|Nom\b)/;
    const tabsExp = [['detail', '#wf=' + WD, /Workflow filter/], ['compare', '#wf=' + WD + '&cmp=' + WC + '&tab=compare', /Comparison/], ['analysis', '#wf=' + WD + '&tab=analysis', /Analysis:/], ['quality', '#wf=' + WD + '&tab=quality', /Quality/], ['flow', '#wf=' + WD + '&tab=flow', /Data flow/], ['calls', '#wf=' + WD + '&tab=calls', /Calls between workflows/], ['impact', '#tab=impact&act=' + ids(101), /Impact/], ['global', '#tab=global', /Global usage/]];
    for (const [k, hh, re] of tabsExp) {
      await hash(hh, 800); const txt = await ev('(()=>{const m=document.getElementById("main").cloneNode(true);m.querySelectorAll(".editbar, .tech, .tour").forEach(e=>e.remove());return m.innerText})()');
      const fr = (txt.match(FR_UI) || [])[0]; check('onglet ' + k + ' en anglais (titre attendu, aucun libellé d\'interface français)', re.test(txt) && !fr, { fr, head: txt.slice(0, 80) });
    }
    await hash('#wf=' + WD + '&tab=quality', 600); await shot('en-quality.png'); await hash('#wf=' + WD + '&cmp=' + WC + '&tab=compare', 700); await shot('en-compare.png');
    // bascule manuelle: sélection, onglet, comparaison, expert, scroll, session d'édition et historique conservés
    await click('#chkExpert'); await sleep(250); await hash('#wf=' + WD + '&cmp=' + WC + '&tab=compare&x=1', 700);
    await ev('document.getElementById("main").scrollTop=140'); await click('#btnEdit'); await sleep(300);
    await ev('window.WFV.editUi.infoDialog(' + S + '.wfs.get(' + JSON.stringify(WD) + '))'); await sleep(200); await ev('(()=>{const n=document.getElementById("inName");n.value="Nom édité (i18n)";n.dispatchEvent(new Event("input"))})()'); await click('#btnApplyInfo'); await sleep(400);
    await ev('document.querySelector("dialog.editdlg")&&document.querySelector("dialog.editdlg").open&&document.querySelector("dialog.editdlg").close()'); await sleep(200);
    await hash('#wf=' + WD + '&cmp=' + WC + '&tab=compare&x=1', 700); await ev('document.getElementById("main").scrollTop=140'); await sleep(100);
    const before = await ev('({sel:document.querySelector("#list li[aria-selected=true]").dataset.id,scroll:document.getElementById("main").scrollTop,undo:' + S + '.sessions.get(' + JSON.stringify(WD) + ').undo.length,dirty:' + S + '.wfs.get(' + JSON.stringify(WD) + ').dirty,name:' + S + '.wfs.get(' + JSON.stringify(WD) + ').name,checked:' + S + '.checked.length,filter:document.getElementById("q").value,n:document.querySelectorAll("#list li").length})');
    await ev('(()=>{const s=document.getElementById("selLang");s.value="fr";s.dispatchEvent(new Event("change",{bubbles:true}))})()'); await sleep(700);
    const after = await ev('({sel:document.querySelector("#list li[aria-selected=true]").dataset.id,scroll:document.getElementById("main").scrollTop,undo:' + S + '.sessions.get(' + JSON.stringify(WD) + ').undo.length,dirty:' + S + '.wfs.get(' + JSON.stringify(WD) + ').dirty,name:' + S + '.wfs.get(' + JSON.stringify(WD) + ').name,hash:location.hash,h1:document.querySelector("#main h1").textContent,tabs:document.querySelector("#tabs button[data-tab=compare]").textContent,expert:document.body.classList.contains("expert"),ls:localStorage.getItem("wfv.lang"),lang:document.documentElement.lang,status:document.getElementById("status").textContent,badge:(document.querySelector("#list .badge.mod")||{}).textContent,n:document.querySelectorAll("#list li").length,errs:document.querySelectorAll("#main .drow").length})');
    check('bascule EN -> FR sans rechargement: texte, html lang, hash lang=fr, localStorage, annonce', after.h1 === 'Comparaison' && after.tabs === 'Comparer' && after.lang === 'fr' && /lang=fr/.test(after.hash) && after.ls === 'fr' && /Langue : français/.test(after.status) && after.badge === '● modifié', after);
    check('bascule conserve: workflow sélectionné, comparaison, onglet, expert (x=1), défilement, workflows chargés', after.sel === before.sel && /wf=/.test(after.hash) && /cmp=/.test(after.hash) && /tab=compare/.test(after.hash) && /x=1/.test(after.hash) && after.expert && Math.abs(after.scroll - before.scroll) <= 2 && after.n === before.n && after.errs > 0, { before, after });
    check('bascule conserve la session d\'édition: modification, historique undo, nom modifié', after.undo === before.undo && after.undo >= 1 && after.dirty === true && after.name === before.name, { before, after });
    await ev('(()=>{const s=document.getElementById("selLang");s.value="en";s.dispatchEvent(new Event("change",{bubbles:true}))})()'); await sleep(600);
    const back = await ev('({h1:document.querySelector("#main h1").textContent,undo:' + S + '.sessions.get(' + JSON.stringify(WD) + ').undo.length,hash:location.hash,badge:(document.querySelector("#list .badge.mod")||{}).textContent})'); check('bascule retour FR -> EN', back.h1 === 'Comparison' && back.undo === before.undo && /lang=en/.test(back.hash) && back.badge === '● modified', back);
    // dialogue d'édition ouvert (modal, saisie en cours) lors d'un changement de langue programmatique: laissé intact (aucune perte de saisie)
    await hash('#wf=' + WD, 600); await ev('window.WFV.editUi.infoDialog(' + S + '.wfs.get(' + JSON.stringify(WD) + '))'); await sleep(200); await ev('(()=>{const n=document.getElementById("inName");n.value="Saisie en cours";n.dispatchEvent(new Event("input"))})()');
    await ev('window.WFV.app.setLang("fr")'); await sleep(500); check('dialogue d\'édition ouvert pendant le changement de langue: reste ouvert, saisie conservée', await ev('(()=>{const d=document.querySelector("dialog.editdlg");return !!d&&d.open&&document.getElementById("inName").value==="Saisie en cours"})()')); await ev('document.querySelector("dialog.editdlg").close()'); await ev('window.WFV.app.setLang("en")'); await sleep(300);
    // persistance après rechargement + priorité du hash
    await ev('(()=>{const s=' + S + '.sessions.get(' + JSON.stringify(WD) + ');let n=0;while(n++<50&&window.WFV.edit.undo(s));return s.undo.length})()'); await sleep(300); // plus de modification non exportée (sinon beforeunload à la navigation)
    await ev('(()=>{const s=document.getElementById("selLang");s.value="fr";s.dispatchEvent(new Event("change",{bubbles:true}))})()'); await sleep(300);
    await nav('en-US', '', true); const pers = await probeLang(); check('choix mémorisé (wfv.lang=fr) appliqué après rechargement malgré un navigateur en-US', pers.lang === 'fr' && pers.open === 'Ouvrir dossier…', pers);
    await nav('en-US', '#lang=en', true); check('hash #lang=en prioritaire sur le choix mémorisé (fr)', (await probeLang()).lang === 'en');
    await nav('fr-CA', '#tab=global&lang=en&x=1', true); const hs = await probeLang(); check('hash: lang=en conservé avec les autres paramètres (tab, x)', hs.lang === 'en' && /tab=global/.test(hs.hash) && /x=1/.test(hs.hash) && /lang=en/.test(hs.hash), hs);
    // mobile 390px en anglais + captures claire / sombre
    await nav('en-US'); await click('#btnDemoWelcome'); await sleep(1400); const WD2 = await wfId('Exemple - Onboarding'), WC2 = await wfId('Exemple - Onboarding (copie)');
    await hash('#wf=' + WD2, 700); await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }); await sleep(200); await shot('en-detail-light.png');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await sleep(200); await shot('en-detail-dark.png'); await send('Emulation.setEmulatedMedia', { features: [] });
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
    for (const [k, hh] of [['detail', '#wf=' + WD2], ['compare', '#wf=' + WD2 + '&cmp=' + WC2 + '&tab=compare'], ['quality', '#wf=' + WD2 + '&tab=quality'], ['flow', '#wf=' + WD2 + '&tab=flow'], ['calls', '#tab=calls'], ['impact', '#tab=impact&act=' + ids(101)], ['global', '#tab=global']]) {
      await hash(hh, 600); const o = await ev('({doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,main:document.getElementById("main").scrollWidth-document.getElementById("main").clientWidth,top:document.getElementById("topbar").scrollWidth-document.getElementById("topbar").clientWidth})'); check('mobile 390px anglais sans débordement: ' + k, o.doc <= 0 && o.main <= 0 && o.top <= 0, o); if (k === 'detail') await shot('en-mobile.png');
    }
    await click('#btnTour'); await sleep(400); await shot('en-mobile-tour.png'); const tIn = await ev('(()=>{const r=document.getElementById("tour").getBoundingClientRect();return r.left>=0&&r.right<=window.innerWidth&&document.documentElement.scrollWidth<=document.documentElement.clientWidth})()'); check('mobile 390px anglais: bulle de visite dans l\'écran', tIn); await key('Escape');
    await send('Emulation.clearDeviceMetricsOverride');

    // ================= i18n (phase B2): édition, éditeur d'inputs, export en anglais; bascule EN<->FR pendant l'édition =================
    {
      await nav('en-US'); await click('#btnDemoWelcome'); await sleep(1500);
      await ev('window.__blobs=[];const oc2=URL.createObjectURL;URL.createObjectURL=function(b){window.__blobs.push(b);return oc2.call(URL,b)};window.confirm=()=>true');
      const WE = await wfId('Exemple - Onboarding'), P = JSON.stringify(WE);
      // contrôle automatisé: aucun libellé d'interface français visible (valeurs de démo et noms fictifs exclus: seuls des mots d'interface sont cherchés)
      const FR_WORDS = /\b(Annuler|Rétablir|Appliquer|Fermer|Aperçu|Portée|Renommer|Supprimer|Dupliquer|Exporter|Valider|Ajouter|Remplacer|Édition|édition|Valeurs?|requis|optionnel|Règles?|Infobulle|Avancé|Détails|Copier|Déplacer|Monter|Descendre|Lecture seule|avertissements?|Confirmer|Rechercher|Éditeur|Nouveau|Sélectionner|Glisser|Quitter|Informations|inchangé|modifié|Cible)\b/;
      const visFr = () => ev('(()=>{const vis=(e)=>e.getClientRects().length>0;const roots=[document.getElementById("topbar"),document.getElementById("sidebar"),document.getElementById("main"),document.getElementById("about"),...document.querySelectorAll("dialog[open]")];const out=[];const US=[...window.WFV.app.S.wfs.values()].flatMap(w=>{let ip={};try{ip=JSON.parse(w.data.inputSchema).properties||{}}catch(e){}return [w.name,w.data.description,...w.all.flatMap(n=>[n.name,n.raw.customDescription]),...Object.entries(ip).flatMap(([k,p])=>[k,p&&p.title,p&&p.inputDescription])]}).filter(x=>typeof x==="string"&&x.length>2).sort((x,y)=>y.length-x.length);const strip=(t)=>{US.forEach(u=>{t=t.split(u).join("")});return t};const skip=(e)=>e.closest(".tech,.nname,.wflink,.nm,code,.mono,.kv,.pill,.chipv,.longstr,.str,[data-user],#list .nm,.dside");roots.filter(Boolean).forEach(r=>{const w=document.createTreeWalker(r,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const p=n.parentElement;if(!p||!vis(p)||skip(p)||/^(SCRIPT|STYLE)$/.test(p.tagName))continue;const t=n.nodeValue.trim();if(t)out.push(t)}r.querySelectorAll("[aria-label],[title],[placeholder]").forEach(e=>{if(vis(e)&&!skip(e))["aria-label","title","placeholder"].forEach(a=>{const v=e.getAttribute(a);if(v)out.push(v)})})});return out.map(strip)})()').then((a) => a.filter((t) => FR_WORDS.test(t)));
      const dlgOpen = () => ev('(()=>{const d=document.querySelector("dialog.editdlg[open]");return !!d})()');
      const closeDlg = () => ev('(()=>{const d=document.querySelector("dialog.editdlg");if(d&&d.open)d.close()})()');
      const eset = (sel, v) => ev('(()=>{const e=document.querySelector(' + JSON.stringify(sel) + ');e.value=' + JSON.stringify(v) + ';e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}))})()');
      const ebtn = (txt) => ev('(()=>{const b=[...document.querySelectorAll("dialog.editdlg[open] button")].find(b=>b.textContent.indexOf(' + JSON.stringify(txt) + ')>=0);if(!b)return false;b.click();return true})()');
      const eprops = () => ev('JSON.parse(' + S + '.wfs.get(' + P + ').data.inputSchema).properties');
      await hash('#wf=' + WE, 700); res.i18nEdit = {};
      const bar0 = await ev('document.querySelector(".editbar").innerText'); check('EN: barre d\'édition en lecture seule (Edit mode, avertissement d\'export)', /Edit mode/.test(bar0) && /Read-only until edit mode is enabled/.test(bar0) && /Export not verified on the CoreView side/.test(bar0), bar0);
      await click('#btnEdit'); await sleep(400);
      const bar1 = await ev('document.querySelector(".editbar").innerText'); check('EN: mode édition (Editing, Undo, Redo, Find/replace, Rename an input, Validate / Export, Exit editing)', /Editing/.test(bar1) && /Undo/.test(bar1) && /Redo/.test(bar1) && /Find\/replace/.test(bar1) && /Rename an input/.test(bar1) && /Validate \/ Export/.test(bar1) && /Exit editing/.test(bar1), bar1);
      check('EN: visite guidée, étape « Edit mode » = libellé réel du bouton', await ev('window.WFV.demoLogic.tourSteps({onb:"a",copy:"b"}).find(s=>s.id==="edit").text.indexOf("“Edit mode”")>=0'));
      await shot('en-edit-bar.png'); check('EN: écran de détail en mode édition sans libellé français visible', (await visFr()).length === 0, await visFr());
      // rechercher / remplacer avec aperçu
      await click('#btnSR'); await sleep(300); await eset('#inFind', 'UPN'); await eset('#inRepl', 'UPN_X'); await click('#btnPreview'); await sleep(300);
      const sr = await ev('({count:document.getElementById("prevCount").textContent,dlg:document.querySelector("dialog.editdlg").innerText.slice(0,300)})'); check('EN: rechercher/remplacer: aperçu', /occurrence\(s\) in \d+ workflow\(s\)/.test(sr.count) && /Find \/ replace/.test(sr.dlg) && /Scope/.test(sr.dlg), sr);
      await shot('en-dlg-search-dark.png'); check('EN: dialogue rechercher/remplacer sans libellé français', (await visFr()).length === 0, await visFr());
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }); await sleep(200); await shot('en-dlg-search-light.png'); await send('Emulation.setEmulatedMedia', { features: [] });
      await click('#btnApplyBulk'); await sleep(500); check('EN: remplacement appliqué (workflow modifié, annonce)', await ev('!!document.getElementById("dirtyBadge")&&/workflow\\(s\\) modified/.test(document.getElementById("status").textContent)'), await ev('document.getElementById("status").textContent'));
      // renommer un input avec aperçu
      await click('[data-in="DisplayName"][data-f="name"]'); await sleep(300); await eset('#inRenameNew', 'FullName'); await sleep(200);
      const rc = await ev('document.getElementById("renameCount").textContent'); check('EN: renommer un input: aperçu du nombre de références', /^\d+ settings\/filters\/targets values? contains? a reference that will be updated/.test(rc) || /reference that will be updated/.test(rc), rc);
      check('EN: dialogue de renommage sans libellé français', (await visFr()).length === 0, await visFr()); await click('#btnDoRename'); await sleep(500); check('EN: input renommé', 'FullName' in (await eprops()));
      // éditeur d'inputs: ajout d'un input liste
      res.i18nEdit.editor = await ev('document.getElementById("inputsEditor").innerText.slice(0,400)'); check('EN: éditeur d\'inputs en anglais (Input editor, Add an input…, Copy to another workflow…)', /Input editor/.test(res.i18nEdit.editor) && /Add an input…/.test(res.i18nEdit.editor) && /Copy to another workflow…/.test(res.i18nEdit.editor), res.i18nEdit.editor);
      await shot('en-inputs-editor-dark.png'); check('EN: éditeur d\'inputs sans libellé français visible', (await visFr()).length === 0, await visFr());
      await click('#btnAddInputOpen'); await sleep(250); await eset('#inAddName', 'NewList'); await eset('#selAddKind', 'enum'); await eset('#taAddValues', 'A\nB\nA'); await sleep(150);
      await shot('en-dlg-addinput-dark.png'); check('EN: dialogue d\'ajout d\'input sans libellé français', (await visFr()).length === 0, await visFr());
      const addTxt = await ev('document.querySelector("dialog.editdlg").innerText'); check('EN: dialogue d\'ajout (titre, champs, bouton)', /Add an input/.test(addTxt) && /Name \(used in/.test(addTxt) && /Add\s*$/m.test(addTxt) || /Add/.test(addTxt), addTxt.slice(0, 200));
      await click('#btnAddInput'); await sleep(500); let pr = await eprops(); check('EN: input liste ajouté (valeurs dédoublonnées)', pr.NewList && JSON.stringify(pr.NewList.enum) === '["A","B"]', pr.NewList);
      // valeurs de liste
      await click('[data-in="NewList"][data-f="enum"]'); await sleep(300); await eset('#taEnumPaste', 'C\nD'); await click('#btnEnumPaste'); await sleep(200);
      const en1 = await ev('document.getElementById("enumInfo").textContent'); check('EN: éditeur de valeurs (compteur en anglais)', /^4 values$/.test(en1), en1); await shot('en-dlg-enum.png');
      check('EN: éditeur de valeurs sans libellé français', (await visFr()).length === 0, await visFr()); await click('#btnEnumApply'); await sleep(500); pr = await eprops(); check('EN: 4 valeurs appliquées', pr.NewList.enum.length === 4);
      // changement de type avec avertissement
      await eset('select[data-in="Langue"][data-f="kind"]', 'text'); await sleep(400);
      const warnDlg = await ev('document.querySelector("dialog.editdlg[open]")&&document.querySelector("dialog.editdlg").innerText'); check('EN: changement de type avec perte: avertissement en anglais et bouton « Apply anyway »', /This operation produces warnings/.test(warnDlg || '') && /Apply anyway/.test(warnDlg || ''), warnDlg);
      check('EN: dialogue de confirmation sans libellé français', (await visFr()).length === 0, await visFr()); await ebtn('Apply anyway'); await sleep(500); pr = await eprops(); check('EN: Langue convertie en texte', pr.Langue && !('enum' in pr.Langue));
      // règles de mot de passe + JSON brut (expert) + copie
      await click('[data-in="MotDePasse"][data-f="rules"]'); await sleep(300); check('EN: dialogue des règles de mot de passe en anglais', /Password rules of/.test(await ev('document.querySelector("dialog.editdlg").innerText')) && (await visFr()).length === 0, await visFr()); await closeDlg();
      await click('#btnCopyInputs'); await sleep(300); check('EN: dialogue de copie vers un autre workflow en anglais', /Copy \d+ inputs? to another workflow/.test(await ev('document.querySelector("dialog.editdlg").innerText')) && (await visFr()).length === 0, await visFr()); await closeDlg();
      await click('#chkExpert'); await sleep(250); await click('#inputsEditor .tech'); await sleep(300); check('EN: JSON brut (expert) en anglais', /Raw JSON of input/.test(await ev('document.querySelector("dialog.editdlg").innerText')) && (await visFr()).length === 0, await visFr()); await closeDlg(); await click('#chkExpert'); await sleep(200);
      // validation / export / diff
      await click('#btnExport'); await sleep(400);
      const exTxt = await ev('document.querySelector("dialog.editdlg").innerText'); check('EN: validation + export: titre, validation, options, avertissement d\'export visible', /Validate \/ Export/.test(exTxt) && /Validation before export/.test(exTxt) && /Valid JSON, unique uids/.test(exTxt) && /Options \(unchecked by default\)/.test(exTxt) && /Export not verified on the CoreView side/.test(exTxt) && /View the full diff/.test(exTxt), exTxt.slice(0, 300));
      check('EN: avertissement d\'export visible (élément affiché)', await ev('[...document.querySelectorAll("dialog.editdlg .warnnote")].some(e=>e.getClientRects().length>0)'));
      await shot('en-dlg-export-dark.png'); await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }); await sleep(200); await shot('en-dlg-export-light.png'); await send('Emulation.setEmulatedMedia', { features: [] });
      check('EN: dialogue d\'export sans libellé français', (await visFr()).length === 0, await visFr());
      await click('#btnDoExport'); await sleep(400); const exportEn = await ev('(async()=>{const b=window.__blobs;return await b[b.length-1].text()})()');
      // bascule EN -> FR pendant l'édition: session, undo/redo, modifications, export identiques
      const stBefore = await ev('({undo:' + S + '.sessions.get(' + P + ').undo.length,dirty:' + S + '.wfs.get(' + P + ').dirty,editing:' + S + '.editing.has(' + P + '),inputs:Object.keys(JSON.parse(' + S + '.wfs.get(' + P + ').data.inputSchema).properties).length})');
      await ev('(()=>{const s=document.getElementById("selLang");s.value="fr";s.dispatchEvent(new Event("change",{bubbles:true}))})()'); await sleep(800);
      const stFr = await ev('({undo:' + S + '.sessions.get(' + P + ').undo.length,redo:' + S + '.sessions.get(' + P + ').redo.length,dirty:' + S + '.wfs.get(' + P + ').dirty,editing:' + S + '.editing.has(' + P + '),inputs:Object.keys(JSON.parse(' + S + '.wfs.get(' + P + ').data.inputSchema).properties).length,bar:document.querySelector(".editbar").innerText,editor:(document.getElementById("inputsEditor")||{innerText:""}).innerText.slice(0,200)})');
      check('bascule EN -> FR pendant l\'édition: session, undo, modifications conservés; barre et éditeur en français', stFr.undo === stBefore.undo && stFr.dirty && stFr.editing && stFr.inputs === stBefore.inputs && /Annuler/.test(stFr.bar) && /Éditeur d'inputs/.test(stFr.editor), { stBefore, stFr });
      await click('#btnExport'); await sleep(400); check('FR: dialogue d\'export en français (avertissement)', /Export non vérifié côté CoreView/.test(await ev('document.querySelector("dialog.editdlg").innerText'))); await click('#btnDoExport'); await sleep(400);
      const exportFr = await ev('(async()=>{const b=window.__blobs;return await b[b.length-1].text()})()'); check('export identique avant et après changement de langue (EN vs FR)', exportEn === exportFr && exportEn.length > 100);
      await ev('(()=>{const s=document.getElementById("selLang");s.value="en";s.dispatchEvent(new Event("change",{bubbles:true}))})()'); await sleep(700);
      // undo / redo intacts, annuler tout puis export identique à l'original
      const undoRedo = await ev('(()=>{const s=' + S + '.sessions.get(' + P + '),E=window.WFV.edit,n0=s.undo.length;E.undo(s);const a=s.undo.length,r=s.redo.length;E.redo(s);return {n0,a,r,back:s.undo.length}})()'); check('undo/redo intacts après changement de langue', undoRedo.a === undoRedo.n0 - 1 && undoRedo.r === 1 && undoRedo.back === undoRedo.n0, undoRedo);
      await ev('(()=>{const s=' + S + '.sessions.get(' + P + ');let n=0;while(n++<80&&window.WFV.edit.undo(s));})()'); await sleep(300); await ev('window.WFV.editUi.sync(' + P + ')'); await sleep(300);
      await click('#btnExport'); await sleep(300); await click('#btnDoExport'); await sleep(400);
      check('EN: annuler tout puis exporter = identique à l\'original (octet pour octet)', await ev('(async()=>{const b=window.__blobs,t=await b[b.length-1].text();return t===' + S + '.origs.get(' + P + ').rawText})()'));
      await ev('window.WFV.editUi.sync(' + P + ')'); await ev('document.querySelector("dialog.editdlg")&&document.querySelector("dialog.editdlg").open&&document.querySelector("dialog.editdlg").close()');
      // mobile 390px: dialogues en anglais sans débordement
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true }); await sleep(400);
      const mobProbe = () => ev('(()=>{const d=document.querySelector("dialog.editdlg[open]");const r=d.getBoundingClientRect();return {fits:r.left>=-1&&r.right<=window.innerWidth+1,doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,dlgOverflow:d.scrollWidth-d.clientWidth}})()');
      await hash('#wf=' + WE, 700); await click('#btnEdit'); await sleep(300);
      await click('#btnAddInputOpen'); await sleep(300); const m1 = await mobProbe(); check('mobile 390px anglais: dialogue d\'ajout d\'input sans débordement', m1.fits && m1.doc <= 0 && m1.dlgOverflow <= 1, m1); await shot('en-mobile-addinput.png'); await closeDlg();
      await click('#btnSR'); await sleep(300); const m2 = await mobProbe(); check('mobile 390px anglais: dialogue rechercher/remplacer sans débordement', m2.fits && m2.doc <= 0 && m2.dlgOverflow <= 1, m2); await shot('en-mobile-search.png'); await closeDlg();
      await click('#btnExport'); await sleep(300); const m3 = await mobProbe(); check('mobile 390px anglais: dialogue d\'export sans débordement', m3.fits && m3.doc <= 0 && m3.dlgOverflow <= 1, m3); await shot('en-mobile-export.png'); await closeDlg();
      const m4 = await ev('({doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,main:document.getElementById("main").scrollWidth-document.getElementById("main").clientWidth})'); check('mobile 390px anglais: éditeur d\'inputs sans débordement de page', m4.doc <= 0, m4); await shot('en-mobile-editor.png');
      await send('Emulation.clearDeviceMetricsOverride');
      await ev('(()=>{const s=' + S + '.sessions.get(' + P + ');let n=0;while(n++<80&&window.WFV.edit.undo(s));})()'); await sleep(200);
    }
  } catch (e) { problems.push('ERREUR TEST ' + e.message); }
  finally { try { ws && ws.close(); } catch (e) { /* */ } proc.kill(); if (server) server.close(); await sleep(300); try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* */ } }
  console.log(checks.map((c) => (c[1] ? 'ok   ' : 'ECHEC') + ' ' + c[0]).join('\n'));
  console.log(JSON.stringify({ navigateur: path.basename(browser), mode: process.env.WFV_SERVE ? 'http local' : 'file://', verifications: checks.length, echecs: checks.filter((c) => !c[1]).length, problemes: problems }, null, 1));
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.error('ECHEC', e); process.exit(2); });
