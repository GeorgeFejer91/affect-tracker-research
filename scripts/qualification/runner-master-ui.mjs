// Isolated headless presentation evidence with explicit synthetic native replies.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
const [browser, destination, viewport="1938,1176"] = process.argv.slice(2);
assert.ok(browser && destination); const root=resolve(import.meta.dirname,"../.."),output=resolve(destination);
await mkdir(output);const execute=promisify(execFile);
const entry=String.raw`
import {bootRunner} from './runner/src/app.js';
import {resolveRunnerSelection} from './runner/src/recipe.js';
const mode=new URL(location.href).searchParams.get('case'),checks=[],calls=[],errors=[];
const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
const tick=()=>new Promise(r=>setTimeout(r,120));
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
let app,plan,status,fullscreen=false,receipt;
document.body.innerHTML='<div id="experiment-runner"></div>';const root=document.querySelector('#experiment-runner'),q=id=>root.querySelector('#'+id);
const click=async id=>{q(id).click();await tick();};
const selected=()=>resolveRunnerSelection(app.recipe,'P001',['both','en'],'variant-3');
const invoke=async(command,args)=>{calls.push(command);switch(command){
 case 'research_desktop_identity':return{schema:'affect-research-desktop-identity',version:1,program:'runner'};
 case 'research_package_protocol_capability':return{schema:'affect-research-native-package-protocol-capability',version:1,backend:'rust-gstplay',rustOwnedProtocol:true,packageV1CompilationReady:true,protocolPlanV2Ready:true,questionnaireDraftsReady:true,recoveryJournalReady:true,manifestV4Ready:true,nativeStartReady:true,reasonCode:'ready'};
 case 'research_native_media_capability':return{playerActorReady:true};
 case 'research_workspace_status':return{selected:true,workspaceId:'synthetic-workspace',displayName:'Synthetic UI test'};
 case 'research_runner_selection':return{schema:'affect-runner-selection',version:1,packageSourceByteSha256:app.recipe.canonicalSourceByteSha256,participantId:args.participantId??'P001',outputDirectory:'outputs/recipe-synthetic'};
 case 'research_runner_master_history':return{schema:'affect-runner-master-history',version:1,recipeSourceByteSha256:app.recipe.canonicalSourceByteSha256,participants:[{participantId:'P001',state:'used'}]};
 case 'research_recorder_status':return{available:false,active:false,phase:'idle'};
 case 'research_input_cancel_setup':return{};
 case 'research_input_set_region':return{runReady:true};
 case 'research_input_status':return{receipt:{receiptId:'synthetic-input'},remainingDirections:[]};
 case 'research_runner_fullscreen':fullscreen=args.fullscreen;return;
 case 'research_runner_master_plan':return selected();
 case 'research_runner_master_rescan':return{workspaceId:'synthetic-workspace',stimuli:[]};
 case 'research_runner_master_preflight':plan=await selected();return{schema:'affect-runner-master-preflight',version:1,recipeSourceByteSha256:plan.recipeSourceByteSha256,planIdentitySha256:plan.planIdentitySha256,nativeStartReady:true,reasons:[]};
 case 'research_runner_master_start':
  check(args.request.participant.participantId==='P001','canonical participant reaches master Start');
  check(!JSON.stringify(args.request.participant).includes('Alex'),'raw names do not reach native Start');
  receipt={schema:'affect-runner-master-attempt',version:1,runId:'run-00000000-0000-4000-8000-000000000001',attemptId:'attempt-synthetic',participantId:'P001',recipeSourceByteSha256:plan.recipeSourceByteSha256,planIdentitySha256:plan.planIdentitySha256};
  status={...receipt,schema:'affect-runner-master-status',active:true,position:1,stepCount:plan.steps.length,phase:'awaitingPresentation',answers:{},sampleCount:0,missedSlotCount:0,currentValence:0,currentArousal:0};return receipt;
 case 'research_runner_master_status':return structuredClone(status);
 case 'research_runner_master_action':{
  const action=args.action;
  if(action.type==='presented'){
   check(action.position===status.position,'presentation acknowledgement binds current occurrence');
   status.phase=plan.steps[status.position-1].kind==='questionnaire'?'questionnaire':plan.steps[status.position-1].kind==='video'?'playing':'interval';
  } else if(action.type==='draft'){status.answers=Object.fromEntries(action.answers.map(a=>[a.itemId,a.optionId]));}
  else if(action.type==='submit'){status.position=4;status.phase='awaitingPresentation';status.answers={};}
  else if(action.type==='stop'){status.active=false;status.phase='finished';status.result={status:'stopped',outputDirectory:'outputs/recipe-synthetic/P001/attempt-synthetic'};}
  return structuredClone(status);
 }
 default:throw Error('Unexpected command '+command);
}};
try{
 const win=new Proxy(window,{get(target,key){if(key==='requestAnimationFrame')return cb=>setTimeout(()=>cb(performance.now()),16);const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 app=await bootRunner(root,{invoke,windowObject:win,pollMs:250});
 const bytes=new Uint8Array(await(await fetch('/test/fixtures/planner-recipe-locations-current-v1.canonical.json')).arrayBuffer());await app.adoptRecipe(bytes);
 check(q('runner-participant').classList.contains('is-used'),'per-master used participant is red');check(q('runner-launch').disabled,'explicit variant required');
 q('runner-variant').value='variant-3';q('runner-variant').dispatchEvent(new Event('change'));await tick();check(!q('runner-launch').disabled,'saved variant permits preparation');
 if(mode==='sequence'){
  await click('runner-sequence-preview');root.querySelector('[data-language-option="both"]').click();await tick();root.querySelector('[data-language-option="en"]').click();await tick();await tick();
  check(q('runner-sequence-timeline').children.length===10,'full master sequence preview includes all ten occurrences');
  check(!calls.includes('research_runner_master_start'),'preview creates no native attempt');
 }else if(mode!=='launcher'){
  await click('runner-launch');check(fullscreen,'fullscreen requested before questionnaires');
  root.querySelector('[data-language-option="both"]').click();await tick();root.querySelector('[data-language-option="en"]').click();await tick();
  for(const[id,value]of[['runner-first','Alex'],['runner-last','Example'],['runner-age','30'],['runner-gender','X'],['runner-hand','R']])q(id).value=value;
  q('runner-rerun').checked=true;await click('runner-prepare');await tick();await tick();
  check(!q('runner-questionnaire').hidden,'master questionnaire is presented');
  check(q('runner-questionnaire-items').querySelectorAll('tbody tr').length===2,'complete P2 form rows render together');
  check(q('runner-questionnaire-next').hidden,'label repetition does not become pagination');
  check(q('runner-first').value===''&&q('runner-last').value==='','transient names cleared');
  if(mode==='video'){
   await click('runner-questionnaire-submit');await tick();check(!q('runner-questionnaire').hidden,'empty form cannot advance');
   const answerRows=q('runner-questionnaire-items').querySelectorAll('tbody tr');
   answerRows[0].querySelector('input').click();await tick();await click('runner-questionnaire-submit');await tick();
   check(!q('runner-questionnaire').hidden,'older optional item cannot be skipped');
   for(const row of answerRows)row.querySelector('input').click();await tick();await click('runner-questionnaire-submit');await tick();await tick();
   check(!q('runner-stage').hidden&&q('runner-questionnaire').hidden,'native projection selects video surface');
   check(innerWidth===1920&&innerHeight===1080,'actual headless viewport matches authored P4');
   const box=plan.selected.layout.geometry.feedback,observed=root.querySelector('.run-feedback-stage').getBoundingClientRect();
   for(const key of ['x','y','width','height'])check(Math.abs(box[key]-observed[key])<0.1,'saved feedback geometry '+key);
   check(root.querySelector('.research-preview-stage').dataset.previewVariant==='studio','complete P5 renderer active');
  }else if(mode==='stop'){
   await click('runner-stop');await click('runner-stop-confirm');await tick();await tick();check(!fullscreen&&!q('runner-launcher').hidden,'partial stop returns launcher');check(!q('runner-receipt').hidden,'partial output receipt visible');
  }
 }
 check(q('runner-error').hidden,'no unexpected app error');check(document.documentElement.scrollWidth<=innerWidth,'no horizontal overflow');
 const ids=[...root.querySelectorAll('[id]')].map(e=>e.id);check(new Set(ids).size===ids.length,'unique DOM identifiers');app.destroy();
}catch(e){errors.push(String(e));}
const result=document.createElement('pre');result.id='receipt';result.hidden=true;result.textContent=JSON.stringify({mode,checks,errors,viewport:[innerWidth,innerHeight],calls,scope:'Synthetic frontend projections only; no real run or native qualification'});document.body.append(result);
`;
const bundle=await build({stdin:{contents:entry,resolveDir:root,sourcefile:'master-ui-audit.js'},bundle:true,format:'esm',write:false,platform:'browser',logLevel:'silent'});
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1');if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/runner/runner.css"><script type="module" src="/runner/src/audit.js"></script>');return;}if(url.pathname==='/runner/src/audit.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}const path=resolve(root,'.'+decodeURIComponent(url.pathname));assert.ok(path.startsWith(root+sep));res.setHeader('Content-Type',({'.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(path)]??'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const rows=[];
try{for(const mode of ['launcher','sequence','questionnaire','video','stop']){
 const profile=await mkdtemp(join(output,'profile-'));
 const {stdout}=await execute(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,`--window-size=${viewport}`,'--force-device-scale-factor=1','--virtual-time-budget=10000',`--screenshot=${join(output,mode+'.png')}`,'--dump-dom',`http://127.0.0.1:${server.address().port}/?case=${mode}`],{windowsHide:true,timeout:45000,maxBuffer:4_000_000});
 await writeFile(join(output,mode+'.html'),stdout);const raw=stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1];assert.ok(raw,`Missing ${mode} receipt`);
 const row=JSON.parse(raw.replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));rows.push(row);console.log(JSON.stringify(row));assert.deepEqual(row.errors,[]);
}}finally{server.close();await writeFile(join(output,'receipt.json'),JSON.stringify({root,scope:'Synthetic native replies; headless frontend only',rows},null,2));}
