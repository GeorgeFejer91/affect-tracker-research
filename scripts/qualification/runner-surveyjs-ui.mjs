// Actual production app and controls with synthetic native replies. No native
// acquisition, real participant, playback timing or XDF qualification evidence.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const [browser, destination, onlyCase, recipeVersion = "4"] = process.argv.slice(2);
assert.ok(browser && destination);
assert.ok(["2", "3", "4"].includes(recipeVersion));
assert.ok(onlyCase === undefined || onlyCase === "all" || /^(en|de)-(form|flow|stop|dispose)$/u.test(onlyCase));
const root = resolve(import.meta.dirname, "../.."), output = resolve(destination);
await mkdir(output);
const entry = String.raw`
import {bootRunner} from './runner/src/app.js';
import {resolveRunnerSelection} from './runner/src/recipe.js';
import {checkSurveyData} from './site/src/research/surveyjs-engine.js';
import {validateFormAnswers} from './site/src/research/form-definition.js';
import {validateQuestionnaireAnswers} from './site/src/research/questionnaires.js';
const params=new URL(location.href).searchParams,language=params.get('language'),mode=params.get('case'),masterVersion=Number(params.get('version'));
const checks=[],calls=[],errors=[],submissions=[];
const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
const tick=(ms=50)=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(predicate,label)=>{for(let i=0;i<100;i++){if(predicate())return;await tick();}throw Error('Timeout: '+label);};
addEventListener('error',event=>errors.push(event.message));
addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
document.body.innerHTML='<div id="experiment-runner"></div>';
const root=document.querySelector('#experiment-runner'),q=id=>root.querySelector('#'+id);
let app,plan,status,fullscreen=false,holdDraft=false,releaseDraft,holdPoll=false,releasePoll,rejectSubmit=false;
const selected=()=>resolveRunnerSelection(app.recipe,'P001',['both',language],'variant-1');
const commandCount=type=>calls.filter(call=>(call.args?.request?.action??call.args?.action)?.type===type).length;
const controls=()=>[...q('runner-questionnaire-items').querySelectorAll('input,textarea')];
const field=id=>q('runner-questionnaire-items').querySelector('[data-form-item="'+id+'"]');
const edit=(id,value,commit=false)=>{const input=field(id);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));if(commit)input.dispatchEvent(new Event('change',{bubbles:true}));return input;};
const change=async input=>{input.dispatchEvent(new Event('change',{bubbles:true}));await tick();await until(()=>!q('runner-questionnaire-submit').disabled,'draft acknowledgement');};
const choose=async(id,value)=>{q('runner-questionnaire-items').querySelector('[data-form-item="'+id+'"][value="'+value+'"]').click();await tick();await until(()=>!q('runner-questionnaire-submit').disabled,'choice acknowledgement');};
const invoke=async(command,args)=>{
 calls.push({command,args:structuredClone(args)});
 switch(command){
  case 'research_runner_recent_experiments':return{schema:'affect-runner-recent-experiments',version:1,entries:[]};
  case 'research_desktop_identity':return{schema:'affect-research-desktop-identity',version:1,program:'runner'};
  case 'research_package_protocol_capability':return{schema:'affect-research-native-package-protocol-capability',version:1,backend:'rust-gstplay',rustOwnedProtocol:true,packageV1CompilationReady:true,protocolPlanV2Ready:true,questionnaireDraftsReady:true,recoveryJournalReady:true,manifestV4Ready:true,nativeStartReady:true,reasonCode:'ready'};
  case 'research_native_media_capability':return{playerActorReady:calls.filter(call=>call.command==='research_native_media_capability').length>1,reasonCode:'native-runtime-verification-pending'};
  case 'research_workspace_status':return{selected:true,workspaceId:'synthetic-workspace',displayName:'Synthetic app verification'};
  case 'research_runner_selection':return{schema:'affect-runner-selection',version:1,packageSourceByteSha256:app.recipe.canonicalSourceByteSha256,participantId:args.participantId??'P001',outputDirectory:'outputs/recipe-synthetic'};
  case 'research_runner_variant_usage':return{schema:'affect-runner-variant-usage',version:1,basis:'xdf-file-names-v1',recipeSourceByteSha256:app.recipe.canonicalSourceByteSha256,ignoredXdfFiles:0,usedParticipantIds:[],variants:app.recipe.recipe.segments.P3.variants.map(v=>({variantId:v.variantId,recordingCount:0,participantCount:0}))};
  case 'research_runner_master_history':return{schema:'affect-runner-master-history',version:1,recipeSourceByteSha256:app.recipe.canonicalSourceByteSha256,participants:[]};
  case 'research_recorder_status':return{available:false,active:false,phase:'idle'};
  case 'research_input_cancel_setup':return{};
  case 'research_input_set_region':return{runReady:true};
  case 'research_input_status':return{receipt:{receiptId:'synthetic-input'},remainingDirections:[]};
  case 'research_runner_fullscreen':fullscreen=args.fullscreen;return;
  case 'research_runner_master_plan':return selected();
  case 'research_runner_master_rescan':return{workspaceId:'synthetic-workspace',stimuli:[]};
  case 'research_runner_master_preflight':plan=await selected();return{schema:'affect-runner-master-preflight',version:masterVersion,recipeSourceByteSha256:plan.recipeSourceByteSha256,planIdentitySha256:plan.planIdentitySha256,nativeStartReady:true,reasons:[]};
  case 'research_runner_master_start_v2':
  case 'research_runner_master_start_v3':
  case 'research_runner_master_start_v4':{
   check(command==='research_runner_master_start_v'+masterVersion,'exact Start version dispatch');
   check(fullscreen,'Start2 follows fullscreen acknowledgement');
   check(Object.keys(args.request).sort().join('|')===['version','workspaceId','sourceText','participantId','selector','rerunConfirmed','inputTestReceiptId'].sort().join('|'),'Start2 has exact participant-only fields');
   check(args.request.version===masterVersion&&args.request.participantId==='P001','Start2 retains canonical participant ID');
   check(args.request.sourceText===app.recipe.canonicalSourceText,'Start2 retains exact canonical source');
   const receipt={schema:'affect-runner-master-attempt',version:masterVersion,runId:'run-00000000-0000-4000-8000-000000000001',attemptId:'attempt-synthetic',participantId:'P001',recipeSourceByteSha256:plan.recipeSourceByteSha256,planIdentitySha256:plan.planIdentitySha256};
   status={...receipt,schema:'affect-runner-master-status',active:true,position:1,stepCount:plan.steps.length,phase:'awaitingPresentation',answers:{},sampleCount:0,missedSlotCount:0,currentValence:0,currentArousal:0};return receipt;
  }
  case 'research_runner_master_status':{
   const snapshot=structuredClone(status);
   if(holdPoll){holdPoll=false;await new Promise(resolve=>{releasePoll=resolve;});}
   return snapshot;
  }
  case 'research_runner_master_action_v2':
  case 'research_runner_master_action_v3':
  case 'research_runner_master_action_v4':{
   check(command==='research_runner_master_action_v'+masterVersion,'exact action version dispatch');
   if(masterVersion>=3)check(args.request.version===masterVersion&&args.request.runId===status.runId,'action3 exact envelope');
   const action=masterVersion>=3?args.request.action:args.action;
   if(action.type==='presented'){
    check(action.position===status.position,'presented acknowledgement binds current occurrence');
    const kind=plan.steps[status.position-1].kind;status.phase=kind==='questionnaire'?'questionnaire':kind==='video'?'playing':'interval';
    }else if(action.type==='surveyDraft'||action.type==='surveySubmit'){
    check(action.position===status.position,'SurveyJS answers bind the current occurrence');
    const d=plan.steps[status.position-1].payload.definition;
    const checked=checkSurveyData(d.surveyJson,{language:d.language,data:action.data,complete:action.type==='surveySubmit'});
    if(action.type==='surveySubmit'&&rejectSubmit){rejectSubmit=false;throw Error('Synthetic native submission rejected');}
    status.answers=checked.data;
    if(action.type==='surveySubmit'){submissions.push(structuredClone(action));status.position++;status.phase='awaitingPresentation';status.answers={};}
   }else if(action.type==='draft'||action.type==='submit'){
    check(action.position===status.position,'answers bind current occurrence');
    const definition=plan.steps[status.position-1].payload.definition;
    if(definition.schema==='affect-research-form-definition')validateFormAnswers(definition,action.answers,{allowPartial:action.type==='draft'});
    else{
     check(action.answers.every(row=>row.value.kind==='singleChoice'),'v2 Likert uses tagged choices');
     validateQuestionnaireAnswers(definition,Object.fromEntries(action.answers.map(row=>[row.itemId,row.value.optionId])),{allowPartial:action.type==='draft'});
    }
    if(action.type==='draft'&&holdDraft){holdDraft=false;await new Promise(resolve=>{releaseDraft=resolve;});}
    if(action.type==='submit'&&rejectSubmit){rejectSubmit=false;throw Error('Synthetic native submission rejected');}
    status.answers=Object.fromEntries(action.answers.map(row=>[row.itemId,row.value]));
    if(action.type==='submit'){submissions.push(structuredClone(action));status.position++;status.phase='awaitingPresentation';status.answers={};}
   }else if(action.type==='stop'){status.active=false;status.phase='finished';status.result={status:'stopped',outputDirectory:'outputs/recipe-synthetic/P001/attempt-synthetic'};}
   return structuredClone(status);
  }
  default:throw Error('Unexpected command '+command);
 }
};
try{
 const win=new Proxy(window,{get(target,key){if(key==='requestAnimationFrame')return callback=>setTimeout(()=>callback(performance.now()),16);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 app=await bootRunner(root,{invoke,windowObject:win,pollMs:250});
 await app.adoptRecipe(new Uint8Array(await(await fetch(masterVersion===4?'/test/fixtures/planner-recipe-v4-surveyjs.canonical.json':'/test/fixtures/runner-master-v'+masterVersion+'-owner.canonical.json')).arrayBuffer()));
 check(q('runner-recipe-status').textContent.includes('master v'+masterVersion),'launcher identifies master v2');
 check(!q('runner-test-region').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})),'input-test arrows cannot scroll and cancel the native test');
 check(q('runner-test-region').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})),'input-test keyboard escape remains available through Tab');
 q('runner-variant').value='variant-1';q('runner-variant').dispatchEvent(new Event('change'));
 q('runner-launch').click();await until(()=>fullscreen&&!q('runner-preparation').hidden,'fullscreen preparation');
 check(q('runner-demographics').hidden,'legacy demographics are absent for v2');
 check(q('runner-preparation-title').textContent==='Experiment language','preparation requests only experiment language');
 for(const option of ['both',language]){q('runner-language').querySelector('[data-language-option="'+option+'"]').click();await tick();}
 check(q('runner-prepare').hidden,'language selection advances without Continue');await until(()=>status?.phase==='questionnaire'&&!q('runner-questionnaire-submit').disabled,'typed form');

 check(!q('runner-questionnaire').hidden&&controls().length>0,'production Runner mounts SurveyJS controls');
 check(q('runner-questionnaire').lang===language,'SurveyJS language follows selected definition');
 const host=q('runner-questionnaire-items');
 const nav=pattern=>[...host.querySelectorAll('button,input[type="button"]')].find(b=>pattern.test((b.textContent||b.value).trim()));
 check(q('runner-questionnaire-submit').hidden,'SurveyJS owns navigation and completion');
 if(masterVersion<4){
   const name='  Fictitious Änne\n李 Example  ';
   const original=host.querySelector('textarea');check(!!original,'typed text uses SurveyJS comment input');
   const enter=(input,value)=>{input.focus();input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();};
   enter(original,name);original.focus();original.setSelectionRange(4,7);
   await until(()=>status.answers.fullName?.text===name,'native tagged text draft');await tick(300);
   check(original.isConnected&&document.activeElement===original&&original.selectionStart===4,'polling preserves exact text, focus and selection');
   const before=commandCount('submit');nav(/^(Next|Weiter)$/).click();await tick();
   check(commandCount('submit')===before,'missing typed answers cannot submit');
   q('runner-questionnaire-form').requestSubmit();await tick();check(commandCount('submit')===before,'outer form Enter cannot bypass SurveyJS navigation');
   enter(host.querySelector('input[type="number"]'),'0');
   const radios=[...host.querySelectorAll('input[type="radio"]')];
   const groups=[...new Set(radios.map(r=>r.name))];check(groups.length===2,'both typed choice questions render');
   if(params.get('keyboard')==='1'){
     radios[0].focus();check(document.activeElement===radios[0]&&!radios[0].checked,'focusing a choice does not answer it');
     check((await fetch('/trusted-arrow')).ok,'trusted browser key injection acknowledged');
     await until(()=>status.answers.gender!==undefined,'SurveyJS arrow keyboard choice');
     check(radios.slice(0,4).some(r=>r.checked),'SurveyJS handles arrow choice selection');
   }
   for(const group of groups)radios.filter(r=>r.name===group).at(-1).click();
   await until(()=>Object.keys(status.answers).length===4,'all typed answers drafted');
   check(status.answers.age.integer===0,'zero remains a tagged integer');
   if(mode==='flow'){
     rejectSubmit=true;nav(/^(Next|Weiter)$/).click();await until(()=>!q('runner-error').hidden,'native rejection shown');
     check(original.isConnected&&original.value===name,'rejection preserves editable answers');
     await until(()=>!host.inert,'correction enabled');nav(/^(Next|Weiter)$/).click();
     await until(()=>status.position===2&&status.phase==='questionnaire','next Likert occurrence');
     check(!original.isConnected,'prior text removed');
     check(submissions[0].answers.find(a=>a.itemId==='fullName').value.text===name,'native submit preserves whitespace and Unicode');
     const nextRadios=[...host.querySelectorAll('input[type="radio"]')];check(nextRadios.length>0&&!nextRadios.some(r=>r.checked),'Likert starts empty');
     for(const group of new Set(nextRadios.map(r=>r.name)))nextRadios.find(r=>r.name===group).click();
     await until(()=>Object.keys(status.answers).length===plan.steps[1].payload.definition.items.length,'Likert native drafts');
     check(Object.values(status.answers).every(a=>a.kind==='singleChoice'),'legacy codes retain tagged wire values');
     nav(/^(Next|Weiter)$/).click();await until(()=>status.position===3&&!q('runner-stage').hidden,'timed stage after both forms');
     check(submissions.length===2,'both legacy forms submit through their frozen contract');
   }
 }else{
 controls()[0].click();await until(()=>typeof status.answers.details==='boolean','SurveyJS draft stored');
 if(status.answers.details){
   await until(()=>nav(/^(Next|Weiter)$/),'SurveyJS navigation update');
   nav(/^(Next|Weiter)$/).click();await until(()=>host.querySelector('textarea'),'conditional page');
   await tick(100);
   const input=host.querySelector('textarea');input.focus();input.value='Fictitious Änne';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();input.focus();
   await until(()=>status.answers.explanation==='Fictitious Änne','typed text draft');
   await tick(250);check(input.isConnected&&document.activeElement===input,'polling preserves SurveyJS input focus');
   const choices=[...host.querySelectorAll('input[type="checkbox"]')];choices[0].click();choices[1].click();
   await until(()=>status.answers.choices?.length===2,'nested answer data drafted');
 }
 check(!q('runner-error').hidden===false,'draft did not report an error');
 if(mode==='flow'){
   rejectSubmit=true;nav(/^(Next|Weiter)$/).click();await until(()=>!q('runner-error').hidden,'native rejection shown');
   check(q('runner-error').textContent==='Synthetic native submission rejected','native rejection remains visible');
   await until(()=>!host.inert,'correction available');nav(/^(Next|Weiter)$/).click();
   await until(()=>status.position===2&&status.phase==='questionnaire','next occurrence');
   check(submissions.length===1&&submissions[0].data.details!==undefined,'full SurveyJS data reaches versioned submit');
   check(!controls().some(c=>c.checked),'new occurrence starts with no prior answers');
 }
 }
 if(mode==='dispose'){app.destroy();check(!host.children.length,'dispose removes SurveyJS controls');}
 else if(mode!=='form'){q('runner-stop').click();q('runner-stop-confirm').click();await until(()=>!fullscreen,'stop acknowledged');check(!host.children.length,'stop clears the survey');app.destroy();}
 check(q('runner-error').hidden,'no unresolved app error');
 check(!calls.some(call=>['research_runner_master_start','research_runner_master_action'].includes(call.command)),'v2 never uses legacy native ingress');
 check(document.documentElement.scrollWidth<=innerWidth,'no horizontal overflow');

 if(mode==='form'){
  // Chrome's command-line screenshot can resize the live viewport after its
  // dump-DOM receipt, correctly triggering Runner's fail-closed resize Stop.
  // Freeze the exact already-checked rendered DOM for visual inspection only.
  const snapshot=root.cloneNode(true);app.destroy();root.replaceWith(snapshot);window.scrollTo(0,0);
 }
}catch(error){errors.push(String(error));}
const result=document.createElement('pre');result.id='receipt';result.hidden=true;result.textContent=JSON.stringify({language,mode,masterVersion,checks,errors,questionnaireDom:q('runner-questionnaire-items').innerHTML,viewport:[innerWidth,innerHeight],calls,submissions,screenshotFrozenDom:mode==='form',scope:'Actual app module with synthetic native replies and fictitious answers only'});document.body.append(result);
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: root, sourcefile: "runner-surveyjs-audit.js" }, bundle: true, format: "esm", write: false, platform: "browser", logLevel: "silent" });
let debuggerReady;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/trusted-arrow") {
      const send = await debuggerReady;
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
      res.end("ok"); return;
    }
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/runner/runner.css"><script type="module" src="/runner/src/audit.js"></script>'); return; }
    if (url.pathname === "/runner/src/audit.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    const path = resolve(root, "." + decodeURIComponent(url.pathname)); assert.ok(path.startsWith(root + sep));
    res.setHeader("Content-Type", ({ ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" })[extname(path)] ?? "application/octet-stream"); res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const rows = [], execute = promisify(execFile);
async function connectDebugger(profile) {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch { await new Promise(done => setTimeout(done, 50)); }
  }
  assert.ok(port, "Headless debugger started");
  let target;
  for (let i = 0; i < 100; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = targets.find(t => t.type === "page" && t.url.includes("127.0.0.1")); if (target) break;
    await new Promise(done => setTimeout(done, 50));
  }
  assert.ok(target, "Owned test page is available");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  let id = 0; const pending = new Map();
  socket.onclose = () => { for (const waiter of pending.values()) waiter.reject(new Error("Owned debugger closed")); pending.clear(); };
  socket.onmessage = event => { const message = JSON.parse(event.data); const waiter = pending.get(message.id); if (!waiter) return; pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.done(message.result); };
  const send = (method, params) => new Promise((done, reject) => {
    const current = ++id, timer = setTimeout(() => { pending.delete(current); reject(new Error(`Debugger deadline: ${method}`)); }, 3000);
    pending.set(current, { done(value) { clearTimeout(timer); done(value); }, reject(error) { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id: current, method, params }));
  });
  return { send, close: () => socket.close() };
}
try {
  for (const language of ["en", "de"]) for (const mode of ["form", "flow", "stop", "dispose"]) {
    if (onlyCase !== undefined && onlyCase !== "all" && onlyCase !== `${language}-${mode}`) continue;
    const name = `${language}-${mode}`, profile = await mkdtemp(join(output, "profile-"));
    const keyboard = process.env.AFFECT_SURVEY_KEYBOARD === "1";
    let releaseDebugger; debuggerReady = new Promise(done => { releaseDebugger = done; });
    const running = execute(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", ...(keyboard ? ["--remote-debugging-port=0"] : ["--virtual-time-budget=15000", `--screenshot=${join(output, `${name}.png`)}`, "--dump-dom"]), `--user-data-dir=${profile}`, "--window-size=1938,1176", "--force-device-scale-factor=1", `http://127.0.0.1:${server.address().port}/?language=${language}&case=${mode}&version=${recipeVersion}&keyboard=${keyboard ? "1" : "0"}`], { windowsHide: true, timeout: 45000, maxBuffer: 4_000_000 });
    // Observe rejection immediately while the optional debugger connects.
    running.catch(() => {});
    let debug;
    if (keyboard) {
      try { debug = await connectDebugger(profile); releaseDebugger(debug.send); }
      catch (error) { running.child.kill(); throw error; }
    }
    let stdout;
    if (keyboard) {
      try {
        let finished = false;
        for (let i = 0; i < 200; i++) {
          const state = await debug.send("Runtime.evaluate", { expression: "!!document.getElementById('receipt')" });
          if (state.result.value) { finished = true; break; }
          await new Promise(done => setTimeout(done, 50));
        }
        assert.ok(finished, "Keyboard scenario finished");
        stdout = (await debug.send("Runtime.evaluate", { expression: "document.documentElement.outerHTML" })).result.value;
        const picture = await debug.send("Page.captureScreenshot", { format: "png" });
        await writeFile(join(output, `${name}.png`), Buffer.from(picture.data, "base64"));
        await debug.send("Browser.close", {}).catch(() => {});
        // Remote-debugging Chrome remains resident after dump-DOM on Windows.
        // This is our isolated headless process, after receipt and screenshot.
        running.child.kill();
        await running.catch(error => { if (!error.killed) throw error; });
      } catch (error) {
        // Chrome can exit naturally just after producing the final dump-DOM.
        // Preserve that complete receipt if the debugger closes concurrently.
        const completed = await running.catch(() => null);
        if (!completed?.stdout.includes('id="receipt"')) throw error;
        stdout = completed.stdout;
      } finally { debug?.close(); running.child.kill(); }
    } else ({ stdout } = await running);
    await writeFile(join(output, `${name}.html`), stdout);
    const raw = stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1]; assert.ok(raw, `Missing ${name} receipt`);
    const row = JSON.parse(raw.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">"));
    rows.push(row); console.log(JSON.stringify({ language, mode, checks: row.checks.length, errors: row.errors })); assert.deepEqual(row.errors, []);
  }
} finally { server.close(); await writeFile(join(output, "receipt.json"), JSON.stringify({ root, scope: "Synthetic native replies; production app frontend only", rows }, null, 2)); }
