// Actual production app and controls with synthetic native replies. No native
// acquisition, real participant, playback timing or XDF qualification evidence.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const [browser, destination, onlyCase, recipeVersion = "2"] = process.argv.slice(2);
assert.ok(browser && destination);
assert.ok(["2", "3"].includes(recipeVersion));
assert.ok(onlyCase === undefined || onlyCase === "all" || /^(en|de)-(form|flow|stop|dispose)$/u.test(onlyCase));
const root = resolve(import.meta.dirname, "../.."), output = resolve(destination);
await mkdir(output);
const entry = String.raw`
import {bootRunner} from './runner/src/app.js';
import {resolveRunnerSelection} from './runner/src/recipe.js';
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
const commandCount=type=>calls.filter(call=>call.command==='research_runner_master_action_v2'&&call.args.action.type===type).length;
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
  case 'research_runner_master_start_v3':{
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
  case 'research_runner_master_action_v3':{
   check(command==='research_runner_master_action_v'+masterVersion,'exact action version dispatch');
   if(masterVersion===3)check(args.request.version===3&&args.request.runId===status.runId,'action3 exact envelope');
   const action=masterVersion===3?args.request.action:args.action;
   if(action.type==='presented'){
    check(action.position===status.position,'presented acknowledgement binds current occurrence');
    const kind=plan.steps[status.position-1].kind;status.phase=kind==='questionnaire'?'questionnaire':kind==='video'?'playing':'interval';
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
 await app.adoptRecipe(new Uint8Array(await(await fetch('/test/fixtures/runner-master-v'+masterVersion+'-owner.canonical.json')).arrayBuffer()));
 check(q('runner-recipe-status').textContent.includes('master v'+masterVersion),'launcher identifies master v2');
 q('runner-variant').value='variant-1';q('runner-variant').dispatchEvent(new Event('change'));
 q('runner-launch').click();await until(()=>fullscreen&&!q('runner-preparation').hidden,'fullscreen preparation');
 check(q('runner-demographics').hidden,'legacy demographics are absent for v2');
 check(q('runner-preparation-title').textContent==='Experiment language','preparation requests only experiment language');
 for(const option of ['both',language]){q('runner-language').querySelector('[data-language-option="'+option+'"]').click();await tick();}
 check(q('runner-prepare').hidden,'language selection advances without Continue');await until(()=>status?.phase==='questionnaire'&&!q('runner-questionnaire-submit').disabled,'typed form');
 check(!q('runner-questionnaire').hidden&&controls().length===10,'production app mounts typed demographic controls');
 check(q('runner-questionnaire').lang===language,'form language follows exact selected definition');
 check(q('runner-questionnaire-instructions').textContent===(language==='de'?'Beantworten Sie alle Fragen, um fortzufahren.':'Answer every item to continue.'),'typed instructions are localized');
 check(!q('runner-questionnaire-instructions').textContent.includes('undefined'),'typed form has no missing legacy instructions');
 check(q('runner-first').value===''&&q('runner-age').value==='','legacy fields need no input');

 const press=async(key,extra={})=>{document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));await tick();await until(()=>!q('runner-questionnaire-submit').disabled,'keyboard draft acknowledged');};
 check(document.activeElement===field('fullName'),'first field receives focus without clicking');
 edit('fullName','Synthetic Keyboard Test');await press('Enter');check(document.activeElement===field('age'),'Enter advances text after draft');
 edit('age','30');await press('Enter');check(document.activeElement.dataset.formItem==='gender','Enter advances age');
 check(!field('gender').checked,'focus alone does not choose');
 await press('End');check(document.activeElement.value==='preferNotToSay','End selects last choice');
 await press('ArrowLeft');check(document.activeElement.value==='other','arrow changes choice');
 await press('ArrowRight');await press('Enter');check(document.activeElement.dataset.formItem==='handedness','Enter advances choice');
 await press('Home');await press('Enter');check(document.activeElement===q('runner-questionnaire-submit'),'last field focuses explicit submit');
 check(status.answers.fullName.text==='Synthetic Keyboard Test'&&status.answers.age.integer===30,'keyboard answers reached native draft');
 q('runner-questionnaire-form').requestSubmit();await until(()=>status.position===2&&!q('runner-questionnaire-submit').disabled,'Likert transition');
 const host=q('runner-questionnaire-items'),rows=[...host.querySelectorAll('tbody tr')];
 check(document.activeElement===rows[0].querySelector('input'),'next questionnaire focuses first response');
 for(const [index,row] of rows.entries()){
  await press('Home');await press('ArrowRight');await press('Enter');
  check(row.querySelectorAll('input')[1].checked,'keyboard retains authored option for row '+index);
  if(index+1<rows.length)check(document.activeElement===rows[index+1].querySelector('input'),'Enter advances to next row '+index);
 }
 check(document.activeElement===q('runner-questionnaire-submit'),'Likert ends at submit without submitting automatically');
 check(!q('runner-error').hidden===false,'no keyboard error');
 const rect=q('runner-questionnaire').getBoundingClientRect();
 check(Math.abs(rect.left+rect.width/2-innerWidth/2)<2,'questionnaire column centered');
 check([...q('runner-questionnaire').querySelectorAll('button')].filter(b=>b.getClientRects().length).length===1,'single visible Next action');
 check(q('runner-questionnaire-submit').textContent===(language==='de'?'Weiter':'Next'),'localized Next label');
 const snapshot=root.cloneNode(true);app.destroy();root.replaceWith(snapshot);
}catch(error){errors.push(String(error));app?.destroy();}
const result=document.createElement('pre');result.id='receipt';result.hidden=true;result.textContent=JSON.stringify({language,mode,checks,errors,scope:'Production app keyboard handlers with synthetic native replies; not an actual execution'});document.body.append(result);
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: root, sourcefile: "runner-app-v2-audit.js" }, bundle: true, format: "esm", write: false, platform: "browser", logLevel: "silent" });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/runner/runner.css"><script type="module" src="/runner/src/audit.js"></script>'); return; }
    if (url.pathname === "/runner/src/audit.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    const path = resolve(root, "." + decodeURIComponent(url.pathname)); assert.ok(path.startsWith(root + sep));
    res.setHeader("Content-Type", ({ ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" })[extname(path)] ?? "application/octet-stream"); res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const rows = [], execute = promisify(execFile);
try {
  for (const language of ["en", "de"]) for (const mode of ["form", "flow", "stop", "dispose"]) {
    if (onlyCase !== undefined && onlyCase !== "all" && onlyCase !== `${language}-${mode}`) continue;
    const name = `${language}-${mode}`, profile = await mkdtemp(join(output, "profile-"));
    const { stdout } = await execute(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--window-size=1938,1176", "--force-device-scale-factor=1", "--virtual-time-budget=15000", `--screenshot=${join(output, `${name}.png`)}`, "--dump-dom", `http://127.0.0.1:${server.address().port}/?language=${language}&case=${mode}&version=${recipeVersion}`], { windowsHide: true, timeout: 45000, maxBuffer: 4_000_000 });
    await writeFile(join(output, `${name}.html`), stdout);
    const raw = stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1]; assert.ok(raw, `Missing ${name} receipt`);
    const row = JSON.parse(raw.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">"));
    rows.push(row); console.log(JSON.stringify({ language, mode, checks: row.checks.length, errors: row.errors })); assert.deepEqual(row.errors, []);
  }
} finally { server.close(); await writeFile(join(output, "receipt.json"), JSON.stringify({ root, scope: "Synthetic native replies; production app frontend only", rows }, null, 2)); }
