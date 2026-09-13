// Actual production app and controls with synthetic native replies. No native
// acquisition, real participant, playback timing or XDF qualification evidence.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const [browser,destination]=process.argv.slice(2);
assert.ok(browser&&destination);
const root=resolve(import.meta.dirname,"../.."),output=resolve(destination);await mkdir(output);
const entry=String.raw`
import {bootRunner} from './runner/src/app.js';
const root=document.createElement('div');document.body.append(root);
const q=id=>root.querySelector('#'+id),checks=[],errors=[],calls=[];
const check=(v,s)=>{if(!v)throw Error(s);checks.push(s);};
const tick=()=>new Promise(r=>setTimeout(r,50));
const until=async(f,s)=>{for(let i=0;i<100;i++){if(f())return;await tick();}throw Error(s);};
let app,files=[],active=false,lastName=null,failInventory=false;
const counts=()=>app.recipe.recipe.segments.P3.variants.map((v,i)=>({variantId:v.variantId,recordingCount:files.filter(f=>f.v===i+1).length,participantCount:new Set(files.filter(f=>f.v===i+1).map(f=>f.p)).size}));
const invoke=async(command,args)=>{calls.push({command,args});switch(command){
 case 'research_desktop_identity':return{schema:'affect-research-desktop-identity',version:1,program:'runner'};
 case 'research_package_protocol_capability':return{schema:'affect-research-native-package-protocol-capability',version:1,backend:'rust-gstplay',rustOwnedProtocol:true,packageV1CompilationReady:true,protocolPlanV2Ready:true,questionnaireDraftsReady:true,recoveryJournalReady:true,manifestV4Ready:true,nativeStartReady:true,reasonCode:'ready'};
 case 'research_native_media_capability':return{playerActorReady:false};
 case 'research_workspace_status':case 'research_choose_workspace':return{selected:true,workspaceId:'workspace',displayName:'Test experiment'};
 case 'research_runner_previous':return{available:false};
 case 'research_runner_selection':return{schema:'affect-runner-selection',version:1,packageSourceByteSha256:app.recipe.canonicalSourceByteSha256,participantId:args.participantId??'P001',outputDirectory:'outputs/recipe-test'};
 case 'research_runner_master_history':return{schema:'affect-runner-master-history',version:1,recipeSourceByteSha256:app.recipe.canonicalSourceByteSha256,participants:[]};
 case 'research_runner_variant_usage':if(failInventory)throw Error('Inventory unavailable');return{schema:'affect-runner-variant-usage',version:1,basis:'xdf-file-names-v1',recipeSourceByteSha256:app.recipe.canonicalSourceByteSha256,variants:counts(),usedParticipantIds:[...new Set(files.map(f=>f.p))],ignoredXdfFiles:0};
 case 'research_recorder_status':return{available:true,active,phase:active?'awaiting-experiment':'idle',fileName:lastName};
 case 'research_recorder_start_v2':{
  check(args.request.version===2,'explicit naming request version');check(args.request.participantId==='P001','manual participant used in recording');check(args.request.variantId==='variant-3','manual version used in recording');
  files.push({p:'P001',v:1});active=true;lastName='P01_V1_20260913T143052123Z.xdf';return{available:true,active,phase:'awaiting-experiment',fileName:lastName};}
 case 'research_recorder_stop':active=false;return{available:true,active,phase:'completed',fileName:lastName};
 default:throw Error('Unexpected '+command);
}};
try{
 app=await bootRunner(root,{invoke,pollMs:60000});
 const bytes=new Uint8Array(await(await fetch('/test/fixtures/runner-master-v3-owner.canonical.json')).arrayBuffer());
 await app.adoptRecipe(bytes);await tick();
 check(q('runner-participant').value==='P01','empty data prefills P01');check(q('runner-variant').value==='variant-3','empty data prefills first saved version');check(!q('runner-launch').disabled,'no explicit version selection needed');
 files=[{p:'P001',v:1},{p:'P001',v:1},{p:'P003',v:2}];await app.adoptRecipe(bytes);await tick();
 check(q('runner-participant').value==='P02','participant fills first unused XDF number');check(q('runner-variant').value==='variant-2','least-used version across all participants');
 q('runner-variant-button').click();check(!q('runner-variant-popup').hidden,'arrow opens frequency chart');
 check(q('runner-variant-options').textContent.includes('2 XDF · 1 participant'),'repeat XDFs and unique participants distinguished');
 check(q('runner-version-0').style.getPropertyValue('--version-color')!==q('runner-version-2').style.getPropertyValue('--version-color'),'color reflects unequal frequency');
 const key=k=>q('runner-variant-button').dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}));
 key('Home');key('Enter');check(q('runner-variant').value==='variant-3','keyboard manual version override');check(q('runner-variant-popup').hidden,'selection closes menu');
 q('runner-participant').value='P01';q('runner-participant').dispatchEvent(new Event('input',{bubbles:true}));q('runner-participant').dispatchEvent(new Event('blur'));await tick();
 q('runner-variant-button').click();key('Home');key('Enter');check(q('runner-participant').value==='P01','experimenter can repeat used participant');
 q('runner-settings').click();await tick();q('runner-record-start').click();await until(()=>active&&!q('runner-record-stop').disabled,'recorder armed');
 check(q('runner-participant').disabled&&q('runner-variant-button').disabled,'armed filename locks selectors');
 q('runner-record-stop').click();await until(()=>!active&&q('runner-participant').value==='P02','stopped file refreshes defaults');
 check(q('runner-variant').value==='variant-2','stopped XDF counts toward distribution');check(!q('runner-participant').disabled,'manual overrides available after recording');
 root.querySelector('[data-close-dialog="runner-settings-dialog"]').click();await tick();
 failInventory=true;await app.adoptRecipe(bytes);await tick();check(q('runner-variant').value==='','missing inventory does not invent least-used counts');check(q('runner-variant-status').textContent.includes('unavailable'),'unavailable inventory explained');
 q('runner-variant-button').click();key('End');key('Enter');check(q('runner-variant').value==='variant-2','manual version still available without inventory');
 failInventory=false;files=[];await app.adoptRecipe(bytes);await tick();check(q('runner-participant').value==='P01'&&q('runner-variant').value==='variant-3','new inventory clears prior manual selection');
 files=[{p:'P001',v:1},{p:'P001',v:1},{p:'P003',v:2}];await app.adoptRecipe(bytes);await tick();if(!new URL(location.href).searchParams.has('closed'))q('runner-variant-button').click();
 check(document.documentElement.scrollWidth<=innerWidth,'no horizontal overflow');check(q('runner-variant-popup').hidden||q('runner-variant-popup').getBoundingClientRect().right<=innerWidth,'menu contained in viewport');
 const snapshot=root.cloneNode(true);app.destroy();root.replaceWith(snapshot);
}catch(error){errors.push(String(error));app?.destroy();}
const receipt=document.createElement('pre');receipt.id='receipt';receipt.hidden=true;receipt.textContent=JSON.stringify({checks,errors,calls,viewport:[innerWidth,innerHeight],scope:'Production Runner UI with synthetic native inventory/recorder'});document.body.append(receipt);
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
const rows=[],execute=promisify(execFile);
try{for(const {width,closed} of [{width:900,closed:false},{width:600,closed:false},{width:900,closed:true}]){
 const name=`usage-${width}${closed?"-closed":""}`;
 const profile=await mkdtemp(join(output,'profile-'));
 const {stdout}=await execute(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,`--window-size=${width},1100`,'--force-device-scale-factor=1','--virtual-time-budget=18000',`--screenshot=${join(output,`${name}.png`)}`,'--dump-dom',`http://127.0.0.1:${server.address().port}/${closed?"?closed=1":""}`],{windowsHide:true,timeout:45000,maxBuffer:4000000});
 await writeFile(join(output,`${name}.html`),stdout);
 const raw=stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1];assert.ok(raw,'Missing receipt');
 const row=JSON.parse(raw.replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));rows.push(row);console.log(JSON.stringify({width,checks:row.checks.length,errors:row.errors}));assert.deepEqual(row.errors,[]);
}}finally{server.close();await writeFile(join(output,'receipt.json'),JSON.stringify({rows},null,2));}
