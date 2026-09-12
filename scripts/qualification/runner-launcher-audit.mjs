// Isolated headless app boot. Native capability replies below are synthetic;
// this proves frontend composition, not hardware execution or qualification.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
const [browser, destination, viewport = '800,800'] = process.argv.slice(2);
assert.ok(browser && destination, "Supply a headless browser executable and output directory.");
const source = resolve(import.meta.dirname, "../.."), output = resolve(destination);
const execute = promisify(execFile), hash = bytes => createHash("sha256").update(bytes).digest("hex");
await mkdir(output, { recursive: true });
const entry = `
import { bootRunner } from './runner/src/app.js';
import { NativePackageProtocolAdapter } from './site/src/research/native-package-protocol.js';
const mode=new URL(location.href).searchParams.get('program');
const errors=[],calls=[],checks=[];let protocol,fullscreen=false,failFullscreen=mode==='fullscreen-error';
const check=(condition,label)=>{if(!condition)throw new Error(label);checks.push(label);};
const tick=()=>new Promise(r=>setTimeout(r,80));
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const initialize=NativePackageProtocolAdapter.prototype.initialize;
NativePackageProtocolAdapter.prototype.initialize=async function(){protocol=this;return initialize.call(this);};
// These overrides exist only in this isolated, non-shipping UI fixture.
NativePackageProtocolAdapter.prototype.refreshRecoveries=async()=>({recoveries:[]});
NativePackageProtocolAdapter.prototype.preflight=async()=>({nativeStartReady:true});
NativePackageProtocolAdapter.prototype.start=async function(detail){
 this.run={};this.onRunActivated();this.dispatch('affect-research:run-started',{participantId:'P001',attemptNumber:1});
 const definition=root.runner.selection.compiled.settings.questionnaires.definitions[0];
 this.dispatch('affect-research:questionnaire-status',{active:true,questionnaireId:definition.questionnaireId,answers:{},protocolStepPosition:1});
};
NativePackageProtocolAdapter.prototype.finish=async function(){this.run=null;this.onRunReleased();this.dispatch('affect-research:run-complete',{participant:'P001',status:'partial',attempt:1,receipt:'synthetic-only',files:'none'});await this.onRunTerminal();};
NativePackageProtocolAdapter.prototype.questionnaireDraft=async()=>{};
NativePackageProtocolAdapter.prototype.questionnaireSubmit=async function(){this.dispatch('affect-research:questionnaire-status',{active:false});this.dispatch('affect-research:run-status',{stimulus:'Synthetic video surface',timing:'No actual sampling',write:'No files',lsl:'No streams',paused:false,pauseAvailable:true,x:0,y:0});};
let root;
try{
 document.body.innerHTML='<div id="experiment-runner"></div>';root=document.querySelector('#experiment-runner');
 const q=id=>root.querySelector('#'+id),click=async id=>{q(id).click();await tick();};
 const invoke=async(command,args)=>{calls.push({command,args});switch(command){
 case 'research_desktop_identity':return {schema:'affect-research-desktop-identity',version:1,program:'runner'};
 case 'research_package_protocol_capability':return {schema:'affect-research-native-package-protocol-capability',version:1,backend:'rust-gstplay',rustOwnedProtocol:true,packageV1CompilationReady:true,protocolPlanV2Ready:true,questionnaireDraftsReady:true,recoveryJournalReady:true,manifestV4Ready:true,nativeStartReady:true,reasonCode:'ready'};
 case 'research_native_media_capability':return {playerActorReady:true};
 case 'research_workspace_status':return {selected:true,workspaceId:'synthetic-workspace',displayName:'Synthetic fixture (no files)'};
 case 'research_recorder_status':return {available:false,active:false,phase:'idle'};
 case 'research_input_cancel_setup':return {receipt:null,remainingDirections:[]};
 case 'research_input_status':return {receipt:{receiptId:'synthetic-input-receipt'},remainingDirections:[]};
 case 'research_input_set_region':return {runReady:true};
 case 'research_input_begin_test':return {};
 case 'research_rescan_package_stimuli':return {workspaceId:'synthetic-workspace',stimuli:[]};
 case 'research_runner_fullscreen':
  check(q('runner-launcher').hidden||args.fullscreen===false,'launcher hidden before fullscreen request');
  check(q('runner-preparation').hidden||args.fullscreen===false,'black transition before details');
  if(failFullscreen&&args.fullscreen)throw new Error('Synthetic fullscreen rejection');fullscreen=args.fullscreen;return;
 default:throw new Error('Unexpected command '+command);
 }};
 // Virtual-time Chrome does not advance compositor frames like wall-clock timers.
 const auditWindow=new Proxy(window,{get(target,key){if(key==='requestAnimationFrame')return callback=>setTimeout(()=>callback(performance.now()),16);const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
 const app=await bootRunner(root,{invoke,pollMs:50,windowObject:auditWindow});
 check(!q('runner-launcher').hidden && q('runner-participant-view').hidden,'minimal initial window');
 check(q('runner-launch').disabled,'cannot launch without file');
 if(mode!=='empty')await app.adoptRecipe(new Uint8Array(await(await fetch('/test/fixtures/experiment-package-v1.canonical.json')).arrayBuffer()));
 if(['professor','remote','controller','settings'].includes(mode)) {
  await click('runner-'+mode);check(q('runner-'+mode+'-dialog').open,'requested dialog opens');
  if(mode==='professor'||mode==='remote')check(q('runner-'+mode+'-dialog').querySelector('img').naturalWidth>0,'QR loads');
 } else if(mode==='override'){
  const original=app.recipe.canonicalSourceText;await click('runner-controller');q('runner-controller-preset').value='wasd';q('runner-controller-preset').dispatchEvent(new Event('change'));await click('runner-controller-apply');
  check(q('runner-controller-note').textContent.includes('Session override draft: WASD'),'override draft visible');
  check(app.recipe.canonicalSourceText===original,'override never rewrites source');check(!q('runner-start'),'no second Start screen');
  await click('runner-controller-reset');check(q('runner-controller-note').textContent.includes('Using the experiment'),'restore file binding');
 } else if(!['empty','launcher'].includes(mode)){
  await click('runner-launch');
  if(mode==='fullscreen-error'){
   check(!q('runner-launcher').hidden && q('runner-participant-view').hidden,'fullscreen rejection returns launcher');check(!q('runner-error').hidden,'fullscreen failure visible');
  } else {
   check(fullscreen&&!q('runner-preparation').hidden,'fullscreen precedes demographics');
   check(getComputedStyle(q('runner-participant-view')).backgroundColor==='rgb(0, 0, 0)','participant background black');
   check(q('runner-stage').hidden&&q('runner-questionnaire').hidden,'no stimulus in preparation');
   if(mode==='escape'){
    dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));await tick();check(!fullscreen&&!q('runner-launcher').hidden,'Escape returns to launcher before run');
   } else if(mode==='questionnaire'||mode==='stop'||mode==='video'){
    for(const[id,value]of [['runner-participant','P001'],['runner-first','Alex'],['runner-last','Example'],['runner-age','30'],['runner-gender','X'],['runner-hand','R']])q(id).value=value;
    root.querySelector('[data-language-option="en"]').click();await click('runner-prepare');await tick();check(!q('runner-start'),'no extra Begin experiment control');
    check(!q('runner-questionnaire').hidden&&q('runner-stage').hidden&&q('runner-preparation').hidden,'questionnaire alone on participant surface');
    check(q('runner-first').value===''&&q('runner-last').value==='','names cleared before activation');
    const inputs=q('runner-questionnaire-items').querySelectorAll('input');check(inputs.length>0,'recipe choices rendered');
    if(mode==='video'){
     for(let i=0;i<2;i++){q('runner-questionnaire-items').querySelector('input').click();await tick();if(i===0)await click('runner-questionnaire-next');}
     await click('runner-questionnaire-submit');check(q('runner-questionnaire').hidden&&!q('runner-stage').hidden&&fullscreen,'questionnaire submit advances to fullscreen video surface');
    }
    if(mode==='stop'){
     dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',cancelable:true}));await tick();check(q('runner-session-dialog').open&&fullscreen,'Escape opens controls, keeps active fullscreen');
     await click('runner-stop');await click('runner-stop-confirm');check(!fullscreen&&!q('runner-launcher').hidden,'terminal attempt returns to windowed launcher');
    }
   }
  }
 }
 await tick();await tick();
 check(document.documentElement.scrollWidth<=innerWidth,'no horizontal overflow');
 const ids=[...root.querySelectorAll('[id]')].map(e=>e.id);check(new Set(ids).size===ids.length,'unique IDs');
 if(mode!=='fullscreen-error')check(q('runner-error').hidden,'no unexpected app error');
 const receipt={mode,checks,errors,calls,scope:'Synthetic UI fixture only; no native acquisition, recording or physical fullscreen'};
 const pre=document.createElement('pre');pre.id='receipt';pre.hidden=true;pre.textContent=JSON.stringify(receipt);document.body.append(pre);
}catch(error){const pre=document.createElement('pre');pre.id='receipt';pre.hidden=true;pre.textContent=JSON.stringify({mode,checks,errors:[...errors,String(error)],calls});document.body.append(pre);}
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: source, sourcefile: 'companion-audit-entry.js' }, bundle: true, format: 'esm', write: false, platform: 'browser', logLevel: 'silent', metafile: true });
const inputs = Object.fromEntries(await Promise.all(Object.keys(bundle.metafile.inputs).filter(path => path !== 'companion-audit-entry.js').map(async path => [path, hash(await readFile(join(source,path)))])));
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="'+'/runner/runner.css'+'"><script type="module" src="/runner/src/audit.js"></script>');return;}
 if(url.pathname==='/runner/src/audit.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 const file=resolve(source,'.'+decodeURIComponent(url.pathname)); assert.ok(file.startsWith(source+sep));
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const rows=[];
try {for(const program of ['empty','launcher','professor','remote','controller','settings','override','demographics','fullscreen-error','escape','questionnaire','video','stop']){
 const profile=await mkdtemp(join(output,'profile-'));
 const {stdout}=await execute(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,`--window-size=${viewport}`,'--force-prefers-reduced-motion','--force-device-scale-factor=1','--virtual-time-budget=5000',`--screenshot=${join(output,program+'.png')}`,'--dump-dom',`http://127.0.0.1:${server.address().port}/?program=${program}`],{windowsHide:true,timeout:30000,maxBuffer:4_000_000});
 await writeFile(join(output,program+'.html'),stdout);
 const raw=stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1]; assert.ok(raw,`No receipt for ${program}`);
 const row=JSON.parse(raw.replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));rows.push(row);
 assert.deepEqual(row.errors,[]);
 console.log(JSON.stringify({mode:row.mode,checks:row.checks.length,errors:row.errors}));
}}finally{server.close();await writeFile(join(output,'receipt.json'),JSON.stringify({source,scope:'Headless frontend; synthetic native replies; no physical/native run',inputs,rows},null,2));}
