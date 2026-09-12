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
const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination, "Supply a headless browser executable and output directory.");
const source = resolve(import.meta.dirname, "../.."), output = resolve(destination);
const execute = promisify(execFile), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = async args => (await execute("git", args, { cwd: source, windowsHide: true })).stdout.trim();
const commit = await git(["rev-parse", "HEAD"]), workingTreeStatus = await git(["status", "--short"]);
await mkdir(output, { recursive: true });
const entry = `
import { bootResearchUi } from './site/src/research/app.js';
import { NativeResearchRuntimeBridge } from './site/src/research/native-bridge.js';
import { BrowserResearchRuntimeBridge } from './site/src/research/runtime-bridge.js';
import { RESEARCH_UI_EVENTS } from './site/src/research/ui-contracts.js';
import { bootRunner } from './runner/src/app.js';
const errors=[]; addEventListener('error',e=>errors.push(e.message)); addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const program=new URL(location.href).searchParams.get('program'), calls=[];
try {
 let root;
 if(program.endsWith('planner')) {
  const surface=program==='browser-planner'?'browser':'tauri';
  document.body.innerHTML='<div id="research-app" data-research-surface="'+surface+'" data-research-program="planner"></div>';
  root=bootResearchUi({surface}); root.researchUi.openSetupSection('review');
  const invoke=async command=>{calls.push(command);switch(command){
   case 'research_desktop_identity':return {schema:'affect-research-desktop-identity',version:1,program:'planner'};
   case 'research_workspace_status':return {selected:false};
   case 'research_source_capabilities':return {repositoryAsset:{supported:true}};
   case 'research_input_capability':return {nativeAuthorityReady:false,supportedPresets:[]};
   case 'research_input_status':case 'research_input_cancel_setup':return {available:false,receipt:null,remainingDirections:[],capture:null};
   case 'research_native_media_stop':return {};
   case 'research_choose_workspace':throw new Error('Synthetic workspace rejection');
   case 'research_native_media_capability':return {schema:'affect-research-native-media-capability',version:2,backend:'gstreamer-gstplay',api:'gstplay',pinnedRuntimeVersion:'1.28.6',bindingsVersion:'0.25',target:'msvc-x86_64',runtimeInstallerSha256:'059251444d1267b486eba390b18d25fed87e10315e72f757ec6c7e912fa746b5',runtimeTreeManifestSha256:'51c27b6a25db1d86dea20cc108e88240fc340758b34ae1e497dd91d8de1b5566',defaultPlaybackMode:'nativeGstPlay',unqualifiedFallbackMode:'unqualifiedWebview',runtimeBundleState:'notStaged',runtimeIntegrityVerified:false,runtimeFileCount:null,runtimeByteLength:null,playerActorReady:false,qualifiedStartAvailable:false,qualifiedFormatMatrixReady:false,redistributionReviewReady:false,ambientRuntimeAllowed:false,requiredForQualifiedRun:true,rendererReceivesFilesystemPaths:false,reasonCode:'runtime-not-staged'};
   default:throw new Error('Planner requested a runtime command: '+command);
  }};
  if(surface==='tauri') {
   const bridge=await new NativeResearchRuntimeBridge(root,{invoke}).initialize();
   root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.selectWorkspaceRequest,{cancelable:true}));await bridge.operation;
   const status=root.querySelector('#planner-status');if(status.hidden||status.textContent!=='Synthetic workspace rejection'||root.querySelector('#research-announcer').textContent!=='Synthetic workspace rejection')throw new Error('Planner authoring error was not visibly announced');
   root.researchUi.openSetupSection('workspace');status.scrollIntoView({block:'start'});bridge.destroy();await Promise.resolve();
  }
  else {
   const forbidden=()=>{throw new Error('Planner invoked a participant runtime dependency');};
   const bridge=new BrowserResearchRuntimeBridge(root,{journal:new Proxy({},{get:()=>forbidden}),workerProbe:forbidden,leaseFactory:forbidden,storageProbe:forbidden,controllerFactory:forbidden});
   await bridge.initialize();await bridge.refreshParticipantStates();await bridge.refreshStorageReadiness();bridge.destroy();
  }
 } else {
  document.body.innerHTML='<div id="experiment-runner"></div>'; root=document.querySelector('#experiment-runner');
  const invoke=async command=>{calls.push(command);switch(command){
   case 'research_desktop_identity':return {schema:'affect-research-desktop-identity',version:1,program:'runner'};
   case 'research_package_protocol_capability':return {schema:'affect-research-native-package-protocol-capability',version:1,backend:'rust-gstplay',rustOwnedProtocol:true,packageV1CompilationReady:true,protocolPlanV2Ready:true,questionnaireDraftsReady:true,recoveryJournalReady:true,manifestV4Ready:true,nativeStartReady:false,reasonCode:'fixture-unqualified'};
   case 'research_native_media_capability':return {playerActorReady:false,qualifiedStartAvailable:false};
   case 'research_workspace_status':return {selected:false};
   case 'research_recorder_status':return {available:false,active:false,phase:'idle'};
   case 'research_input_cancel_setup':return {receipt:null,remainingDirections:[]};
   default:throw new Error('Unexpected native command '+command);
  }};
  const app=await bootRunner(root,{invoke});
  await app.adoptRecipe(new Uint8Array(await (await fetch('/test/fixtures/experiment-package-v1.canonical.json')).arrayBuffer()));
 }
 await new Promise(r=>setTimeout(r,650));
 const ids=[...root.querySelectorAll('[id]')].map(e=>e.id);
 const receipt={program,errors,calls,appError:root.querySelector('#runner-error:not([hidden])')?.textContent??'',heading:root.querySelector('h1')?.textContent,
  duplicateIds:ids.filter((id,i)=>ids.indexOf(id)!==i),
  pageOverflow:document.documentElement.scrollWidth-innerWidth,
  runButtons:root.querySelectorAll('[data-mode-button="run"],#start-experiment,#review-participant-chooser,#preflight-list').length,
  reviewTitle:root.querySelector('[data-setup-section="review"] .section-title')?.textContent,
  plannerError:root.querySelector('#planner-status:not([hidden])')?.textContent??'',
  plannerErrorVisible:(()=>{const status=root.querySelector('#planner-status:not([hidden])');if(!status)return false;const rect=status.getBoundingClientRect();return rect.height>0&&rect.top>=0&&rect.bottom<=innerHeight;})(),
  previewCount:root.querySelectorAll('.research-preview-stage').length,
  sections:root.querySelectorAll('[data-setup-section]').length,
  startDisabled:root.querySelector('#runner-launch')?.disabled,
  recipeLoaded:!!root.runner?.recipe,
  plannerEditors:root.querySelectorAll('[data-setup-section],#settings-form').length};
 const pre=document.createElement('pre'); pre.id='receipt'; pre.hidden=true; pre.textContent=JSON.stringify(receipt);document.body.append(pre);
} catch(error){const pre=document.createElement('pre');pre.id='receipt';pre.hidden=true;pre.textContent=JSON.stringify({program,errors:[...errors,String(error)]});document.body.append(pre);}
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: source, sourcefile: 'companion-audit-entry.js' }, bundle: true, format: 'esm', write: false, platform: 'browser', logLevel: 'silent', metafile: true });
const inputs = Object.fromEntries(await Promise.all(Object.keys(bundle.metafile.inputs).filter(path => path !== 'companion-audit-entry.js').map(async path => [path, hash(await readFile(join(source,path)))])));
for (const path of ['site/research.css', 'runner/runner.css', 'scripts/qualification/companion-boundary-audit.mjs']) inputs[path]=hash(await readFile(join(source,path)));
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="'+(url.searchParams.get('program').endsWith('planner')?'/site/research.css':'/runner/runner.css')+'"><script type="module" src="/runner/src/audit.js"></script>');return;}
 if(url.pathname==='/runner/src/audit.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 const file=resolve(source,'.'+decodeURIComponent(url.pathname)); assert.ok(file.startsWith(source+sep));
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const rows=[];
try {for(const program of ['planner','browser-planner','runner']){
 const profile=await mkdtemp(join(output,'profile-'));
 const {stdout}=await execute(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--window-size=1280,940','--force-prefers-reduced-motion','--force-device-scale-factor=1','--virtual-time-budget=5000',`--screenshot=${join(output,program+'.png')}`,'--dump-dom',`http://127.0.0.1:${server.address().port}/?program=${program}`],{windowsHide:true,timeout:30000,maxBuffer:4_000_000});
 await writeFile(join(output,program+'.html'),stdout);
 const raw=stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1]; assert.ok(raw,`No receipt for ${program}`);
 const row=JSON.parse(raw.replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));rows.push(row);
 assert.deepEqual(row.errors,[]);assert.equal(row.appError,'');assert.deepEqual(row.duplicateIds,[]);assert.ok(row.pageOverflow<=1);
 if(program.endsWith('planner')){assert.equal(row.runButtons,0);assert.equal(row.reviewTitle,'Review & Export');assert.ok(row.previewCount>=1);assert.ok(row.sections>=7);}
 else{assert.equal(row.startDisabled,true);assert.equal(row.recipeLoaded,true);assert.equal(row.plannerEditors,0);}
 if(program==='planner'){assert.equal(row.plannerError,'Synthetic workspace rejection');assert.equal(row.plannerErrorVisible,true);}
 row.screenshotSha256=hash(await readFile(join(output,program+'.png')));
 console.log(JSON.stringify(row));
}}finally{
 server.close();
 assert.equal(await git(['rev-parse','HEAD']),commit);
 for(const [path,digest] of Object.entries(inputs))assert.equal(hash(await readFile(join(source,path))),digest,path);
 await writeFile(join(output,'receipt.json'),JSON.stringify({source,commit,workingTreeStatus,browser,browserSha256:hash(await readFile(browser)),scope:'Headless frontend; synthetic native replies; visible Planner workspace error; no physical/native run',inputs,rows},null,2));
}
