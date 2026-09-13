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
const root=resolve(import.meta.dirname,'../..'),output=resolve(destination);
await mkdir(output);
const entry=String.raw`
import {bootRunner} from './runner/src/app.js';
import {readRunnerRecipe} from './runner/src/recipe.js';
const checks=[],errors=[],calls=[],check=(v,s)=>{if(!v)throw Error(s);checks.push(s);};
const tick=()=>new Promise(r=>setTimeout(r,50));
const until=async(f,s)=>{for(let i=0;i<100;i++){if(f())return;await tick();}throw Error('Timeout '+s);};
const bytes=new Uint8Array(await(await fetch('/test/fixtures/runner-master-v3-owner.canonical.json')).arrayBuffer());
const receipt=await readRunnerRecipe(bytes),ids=['recent-'+'a'.repeat(64),'recent-'+'b'.repeat(64)];
let entries=[],pending=null,next=0,cancel=false,invalid=false,missing=false,held=false,release,recording=false,app;
const root=document.createElement('div');document.body.append(root);const q=id=>root.querySelector('#'+id);
const load=async id=>{if(held)await new Promise(r=>release=r);if(missing&&id===ids[0])throw Error('Previous experiment missing. Load a new experiment.');pending=id;return{document:receipt,workspace:{selected:true,workspaceId:id,displayName:id===ids[0]?'Study one':'Study two'}};};
const invoke=async(command,args)=>{calls.push({command,args});switch(command){
 case 'research_desktop_identity':return{schema:'affect-research-desktop-identity',version:1,program:'runner'};
 case 'research_package_protocol_capability':return{schema:'affect-research-native-package-protocol-capability',version:1,backend:'rust-gstplay',rustOwnedProtocol:true,packageV1CompilationReady:true,protocolPlanV2Ready:true,questionnaireDraftsReady:true,recoveryJournalReady:true,manifestV4Ready:true,nativeStartReady:false,reasonCode:'not-qualified'};
 case 'research_native_media_capability':return{playerActorReady:false};
 case 'research_workspace_status':return{selected:false};
 case 'research_input_cancel_setup':return{};
 case 'research_recorder_status':return{available:true,active:recording,phase:recording?'recording':'idle'};
 case 'research_load_planner_recipe':return cancel?null:invalid?{document:{canonicalSourceText:'invalid'}}:load(ids[next]);
 case 'research_runner_selection':return{schema:'affect-runner-selection',version:1,packageSourceByteSha256:receipt.canonicalSourceByteSha256,participantId:args.participantId??'P001',outputDirectory:'outputs/test'};
 case 'research_runner_master_history':return{schema:'affect-runner-master-history',version:1,recipeSourceByteSha256:receipt.canonicalSourceByteSha256,participants:[]};
 case 'research_runner_variant_usage':return{schema:'affect-runner-variant-usage',version:1,basis:'xdf-file-names-v1',recipeSourceByteSha256:receipt.canonicalSourceByteSha256,usedParticipantIds:[],ignoredXdfFiles:0,variants:receipt.recipe.segments.P3.variants.map(v=>({variantId:v.variantId,recordingCount:0,participantCount:0}))};
 case 'research_runner_recent_experiments':
  if(args.action==='list')return{schema:'affect-runner-recent-experiments',version:1,entries:entries.map(id=>({id,basename:'experiment.json',folderName:id===ids[0]?'Study one':'Study two',available:!(missing&&id===ids[0])}))};
  if(args.action==='load')return load(args.entryId);break;
 case 'research_runner_previous_experiment':
  if(args.action==='load')return load(entries[0]);
  if(args.action==='confirm'){check(args.sourceSha256===receipt.canonicalSourceByteSha256,'confirmed exact source');entries=[pending,...entries.filter(id=>id!==pending)];return{available:true,basename:'experiment.json'};}
 }throw Error('Unexpected '+command);};
const choose=id=>{q('runner-recent-files').value=id;q('runner-recent-files').dispatchEvent(new Event('change',{bubbles:true}));};
try{
 app=await bootRunner(root,{invoke,pollMs:100});check(app.recipe===null&&q('runner-recent-files').disabled,'empty startup stays usable');check(q('runner-open').textContent==='Load new experiment','one new-file button');
 cancel=true;q('runner-open').click();await tick();check(entries.length===0&&app.recipe===null,'cancel preserves empty history');cancel=false;
 invalid=true;q('runner-open').click();await until(()=>!q('runner-error').hidden,'invalid JSON');check(entries.length===0,'rejected JSON not remembered');invalid=false;
 q('runner-open').click();await until(()=>entries.length===1&&!q('runner-recent-files').disabled,'first load');check(q('runner-participant').value==='P01','default participant accompanies loaded JSON');
 next=1;q('runner-open').click();await until(()=>entries.length===2&&!q('runner-open').disabled,'second load');check(entries[0]===ids[1],'accepted file moves to top');check(q('runner-recent-files').options[1].textContent.includes('Study two'),'same basenames distinguished by folder');
 const pickers=calls.filter(c=>c.command==='research_load_planner_recipe').length;
 app.destroy();app=await bootRunner(root,{invoke,pollMs:100});check(app.recipe.canonicalSourceByteSha256===receipt.canonicalSourceByteSha256,'startup automatically reads last JSON');check(q('runner-workspace-status').textContent==='Study two','autoload uses file project root');check(calls.filter(c=>c.command==='research_load_planner_recipe').length===pickers,'autoload opens no picker');
 held=true;choose(ids[0]);await until(()=>release,'pending recent file');check(q('runner-open').disabled&&q('runner-recent-files').disabled,'file controls lock during load');release();held=false;await until(()=>entries[0]===ids[0]&&!q('runner-open').disabled,'recent chosen');check(q('runner-workspace-status').textContent==='Study one','selected recent file sets project root');check(entries.length===2,'reload does not duplicate entries');
 missing=true;app.destroy();app=await bootRunner(root,{invoke,pollMs:100});check(app.recipe===null&&!q('runner-error').hidden,'missing startup file leaves launcher with error');check(!q('runner-open').disabled&&!q('runner-recent-files').disabled,'another file can be chosen');check([...q('runner-recent-files').options].some(o=>o.disabled&&o.textContent.includes('unavailable')),'missing history entry remains visible');
 choose(ids[1]);await until(()=>app.recipe&&!q('runner-open').disabled,'recover with other recent');check(q('runner-workspace-status').textContent==='Study two','recovered correct project');
 recording=true;await until(()=>q('runner-open').disabled,'recording guard');check(q('runner-recent-files').disabled,'recent list locks while recording');recording=false;await until(()=>!q('runner-open').disabled,'unlock');
 check(!calls.some(c=>/master_start|recorder_start/.test(c.command)),'autoload never starts a run or recorder');check(document.documentElement.scrollWidth<=innerWidth,'no horizontal overflow');check(q('runner-recent-files').getBoundingClientRect().right<=innerWidth,'recent dropdown fits');
 const snapshot=root.cloneNode(true);app.destroy();root.replaceWith(snapshot);
}catch(error){errors.push(String(error));app?.destroy();}
const result=document.createElement('pre');result.id='receipt';result.hidden=true;result.textContent=JSON.stringify({checks,errors,scope:'Production Runner with synthetic native recent-file service'});document.body.append(result);
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
try{
 for(const [name,size] of [['desktop','1280,1000'],['narrow','520,1000']]){
  const profile=await mkdtemp(join(output,'profile-'));
  const {stdout}=await execute(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,`--window-size=${size}`,'--force-device-scale-factor=1','--virtual-time-budget=12000',`--screenshot=${join(output,name+'.png')}`,'--dump-dom',`http://127.0.0.1:${server.address().port}/`],{windowsHide:true,timeout:45000,maxBuffer:4000000});
  await writeFile(join(output,name+'.html'),stdout);
  const raw=stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1];assert.ok(raw,'Missing receipt');
  const row=JSON.parse(raw.replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));rows.push({name,...row});console.log(JSON.stringify({name,checks:row.checks.length,errors:row.errors}));assert.deepEqual(row.errors,[]);
 }
}finally{server.close();await writeFile(join(output,'receipt.json'),JSON.stringify({root,rows},null,2));}
