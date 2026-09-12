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
const checks=[],errors=[],calls=[];
const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,50));
const until=async(fn,label)=>{for(let i=0;i<80;i++){if(fn())return;await tick();}throw Error('Timeout: '+label);};
const bytes=new Uint8Array(await(await fetch('/test/fixtures/runner-master-v3-owner.canonical.json')).arrayBuffer());
const documentReceipt=await readRunnerRecipe(bytes),loaded={document:documentReceipt};
let remembered=false,cancel=false,invalid=false,missing=false,held=false,release,recording=false,app;
const root=document.createElement('div');document.body.append(root);
const q=id=>root.querySelector('#'+id);
const invoke=async(command,args)=>{
 calls.push({command,args});
 switch(command){
 case 'research_desktop_identity':return{schema:'affect-research-desktop-identity',version:1,program:'runner'};
 case 'research_package_protocol_capability':return{schema:'affect-research-native-package-protocol-capability',version:1,backend:'rust-gstplay',rustOwnedProtocol:true,packageV1CompilationReady:true,protocolPlanV2Ready:true,questionnaireDraftsReady:true,recoveryJournalReady:true,manifestV4Ready:true,nativeStartReady:false,reasonCode:'not-qualified'};
 case 'research_native_media_capability':return{playerActorReady:true};
 case 'research_workspace_status':return{selected:false};
 case 'research_input_cancel_setup':return{};
 case 'research_recorder_status':return{available:true,active:recording,phase:recording?'recording':'idle'};
 case 'research_load_planner_recipe':return cancel?null:invalid?{document:{canonicalSourceText:'invalid'}}:loaded;
 case 'research_runner_previous_experiment':
  if(args.action==='status')return{available:remembered,basename:remembered?'experiment.json':null};
  if(args.action==='confirm'){check(args.sourceSha256===documentReceipt.canonicalSourceByteSha256,'confirmation binds source');remembered=true;return{available:true,basename:'experiment.json'};}
  if(args.action==='load'){if(held)await new Promise(resolve=>{release=resolve;});if(missing)throw Error('Previous experiment missing. Use Load experiment file.');return loaded;}
 }
 throw Error('Unexpected command '+command);
};
try{
 app=await bootRunner(root,{invoke,pollMs:100});
 check(q('runner-load-previous').disabled,'first launch disabled');
 cancel=true;q('runner-open').click();await tick();check(!remembered&&app.recipe===null,'cancel does not remember');cancel=false;
 invalid=true;q('runner-open').click();await until(()=>!q('runner-error').hidden,'invalid rejected');check(!remembered,'invalid does not remember');invalid=false;
 q('runner-open').click();await until(()=>!q('runner-load-previous').disabled,'successful load');
 check(app.recipe.canonicalSourceByteSha256===documentReceipt.canonicalSourceByteSha256,'picker loads exact source');
 app.destroy();app=await bootRunner(root,{invoke,pollMs:100});
 check(!q('runner-load-previous').disabled&&q('runner-load-previous').title==='Reload experiment.json','restart restores shortcut');
 const pickers=calls.filter(x=>x.command==='research_load_planner_recipe').length;
 held=true;q('runner-load-previous').click();await until(()=>release,'held read');
 check(q('runner-load-previous').disabled&&q('runner-open').disabled,'both buttons lock while reading');
 release();held=false;await until(()=>!q('runner-load-previous').disabled,'reload complete');
 check(app.recipe.canonicalSourceByteSha256===documentReceipt.canonicalSourceByteSha256,'reload passes frontend reader');
 check(calls.filter(x=>x.command==='research_load_planner_recipe').length===pickers,'reload skips picker');
 check(!calls.some(x=>/start/.test(x.command)),'load never starts experiment');
 missing=true;q('runner-load-previous').click();await until(()=>!q('runner-error').hidden,'missing error');
 check(q('runner-error').textContent.includes('missing'),'missing error visible');
 check(app.recipe.canonicalSourceByteSha256===documentReceipt.canonicalSourceByteSha256,'missing preserves loaded recipe');missing=false;
 recording=true;await until(()=>q('runner-load-previous').disabled,'recording lock');check(q('runner-open').disabled,'both buttons lock during recording');
 recording=false;await until(()=>!q('runner-load-previous').disabled,'recording unlock');
 q('runner-load-previous').click();await tick();await until(()=>q('runner-error').hidden&&!q('runner-load-previous').disabled,'final view');
 check(document.documentElement.scrollWidth<=innerWidth,'no horizontal overflow');
 check(q('runner-load-previous').getBoundingClientRect().right<=innerWidth,'shortcut fits viewport');
 const snapshot=root.cloneNode(true);app.destroy();root.replaceWith(snapshot);
}catch(error){errors.push(String(error));app?.destroy();}
const result=document.createElement('pre');result.id='receipt';result.hidden=true;result.textContent=JSON.stringify({checks,errors,scope:'Production frontend with synthetic native transport only'});document.body.append(result);
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
