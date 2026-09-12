// Isolated offscreen DOM/paint checks; no application runtime or user input.
// Usage: node scripts/qualification/xr-layout-background.mjs <browser.exe> <output>
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";
import { xrLayoutEditorMarkup } from "../../site/src/research/xr-layout-view.js";

const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination, "Provide a browser executable and isolated output directory.");
const output = resolve(destination);
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, "isolated-profile-"));
const css = await readFile(new URL("../../site/research.css", import.meta.url), "utf8");
const fixtureSource = await readFile(new URL("../../test/fixtures/xr-layout-v1.canonical.json", import.meta.url), "utf8");
const feedbackFixture = JSON.parse(await readFile(new URL("../../test/fixtures/xr-feedback-envelope-v1.json", import.meta.url), "utf8"));
const entry = `
import { createXrLayoutEditor } from './site/src/research/xr-layout-editor.js';
const source=${JSON.stringify(fixtureSource)};
const feedbackEnvelope=${JSON.stringify(feedbackFixture.cases[0].envelope)};
(async()=>{
 const host=document.querySelector('[data-xr-layout-editor]');
 const q=s=>host.querySelector(s), checks=[]; let changes=0;
 const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
 const editor=createXrLayoutEditor(host,{onChange:()=>changes++});
 const field=name=>q('[data-xr-field="'+name+'"]');
 const set=(name,value)=>{field(name).value=value;field(name).dispatchEvent(new Event('input',{bubbles:true}));};
 check('disabled profile starts inert',!editor.getSnapshot().enabled && field('video.distanceMetres').disabled);
 q('[data-xr-enabled]').checked=true;q('[data-xr-enabled]').dispatchEvent(new Event('change',{bubbles:true}));
 check('enabled geometry renders',!!q('svg') && !field('video.distanceMetres').disabled);
 const profileTools=q('[data-xr-action="accept"]').closest('details');
 check('standalone validation is inside collapsed Profile tools',!profileTools.open && !q('[data-xr-action="accept"]').checkVisibility());
 profileTools.open=true;q('[data-xr-action="accept"]').focus();
 check('opening tools exposes keyboard-accessible profile validation',document.activeElement===q('[data-xr-action="accept"]'));
 q('[data-xr-action="accept"]').click();
 check('accept returns current contribution',!editor.getSnapshot().pending && editor.getSnapshot().contribution.video.distanceMetres===2);
 profileTools.open=false;
 const accepted=JSON.stringify(editor.getSnapshot());
 const beforePaint=q('[data-xr-scene]').innerHTML;
 q('[data-xr-view="side"]').click();
 check('orbit changes only inspection',JSON.stringify(editor.getSnapshot())===accepted && beforePaint!==q('[data-xr-scene]').innerHTML);
 set('video.distanceMetres','');
 check('invalid input removes stale contribution',editor.getSnapshot().pending && editor.getSnapshot().contribution===null && q('[data-xr-action="export"]').disabled);
 check('invalid geometry is announced',!q('[data-xr-error]').hidden && field('video.distanceMetres').getAttribute('aria-invalid')==='true' && !q('svg'));
 set('video.distanceMetres','3');set('video.yawDegrees','25');
 check('tilt keeps geometry and disables inverse angle entry',!!q('svg') && q('[data-xr-action="angles"]').disabled);
 q('[data-xr-action="accept"]').click();
 editor.setDependencies({catalogueRevision:3,feedbackRevision:5,previewMedia:{displayWidth:1080,displayHeight:1920}});
 check('dependency change invalidates acceptance',editor.getSnapshot().pending && editor.getSnapshot().dependencyRevisions.length===2);
 editor.setDependencies({catalogueRevision:3,feedbackRevision:5,feedbackEnvelope,catalogueGeometry:[
  {assetId:'landscape',displayWidth:1920,displayHeight:1080},{assetId:'portrait',displayWidth:1080,displayHeight:1920}]});
 check('full P5 bound is drawn',!!q('.xr-feedback-envelope') && q('[data-xr-readout]').textContent.includes('Full feedback bound'));
 q('[data-xr-action="accept"]').click();const beforeSelect=JSON.stringify(editor.getSnapshot());
 q('[data-xr-media]').value='portrait';q('[data-xr-media]').dispatchEvent(new Event('change',{bubbles:true}));
 check('P1 preview selection keeps accepted profile',q('[data-xr-media]').options.length===3 && JSON.stringify(editor.getSnapshot())===beforeSelect && q('[data-xr-readout]').textContent.includes('0.380'));
 editor.setDependencies({catalogueRevision:3,feedbackRevision:5,feedbackEnvelope:{...feedbackEnvelope,configurationKey:'changed'},catalogueGeometry:[
  {assetId:'landscape',displayWidth:1920,displayHeight:1080},{assetId:'portrait',displayWidth:1080,displayHeight:1920}]});
 check('changed full envelope invalidates even a misreported upstream revision',editor.getSnapshot().pending);
 editor.loadProfile(source);
 check('reopen restores editable exact geometry',field('video.distanceMetres').value==='2' && !editor.getSnapshot().pending);
 const beforeBad=JSON.stringify(editor.getSnapshot());try{editor.loadProfile('{}');}catch{}
 check('failed reopen preserves prior state',JSON.stringify(editor.getSnapshot())===beforeBad);
 // A delayed selected-file read cannot replace an intervening authoring edit.
 let finishRead; const bytes=new TextEncoder().encode(source);
 Object.defineProperty(q('[data-xr-file]'),'files',{configurable:true,value:[{size:bytes.length,arrayBuffer:()=>new Promise(resolve=>finishRead=resolve)}]});
 q('[data-xr-file]').dispatchEvent(new Event('change',{bubbles:true}));
 set('video.distanceMetres','4');finishRead(bytes.buffer);await Promise.resolve();await Promise.resolve();
 check('stale selected file cannot overwrite edits',editor.getSnapshot().pending && field('video.distanceMetres').value==='4');
 editor.loadProfile(source);q('[data-xr-view="orbit"]').click();
 for(const width of [420,760]) {
  document.querySelector('#fixture').style.width=width+'px';
  check('reflow '+width,host.scrollWidth<=host.clientWidth+1 && [...host.querySelectorAll('input,button')].every(el=>el.hidden||el.getBoundingClientRect().right<=host.getBoundingClientRect().right+1));
 }
 field('video.widthMetres').focus();check('native form focus',document.activeElement===field('video.widthMetres'));
 document.querySelector('#fixture').style.width='760px';
 const count=changes;editor.destroy();set('video.distanceMetres','9');
 check('teardown removes handlers',changes===count && editor.getSnapshot().contribution.video.distanceMetres===2);
 field('video.distanceMetres').value='2';
 document.querySelector('#receipt').textContent=JSON.stringify({pass:true,checks,geometry:editor.getSnapshot().contribution});
})().catch(error=>document.querySelector('#receipt').textContent=JSON.stringify({pass:false,error:error.message}));`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd() }, bundle: true,
  platform: "browser", format: "iife", write: false, target: "chrome105" });
const file = join(output, "xr-layout.html");
await writeFile(file, `<!doctype html><html lang="en"><meta charset="utf-8"><title>P6 offscreen check</title>
<style>${css}
html,body{min-width:0;height:auto;overflow:auto}#fixture{padding:20px;width:760px;max-width:100%;margin:0 auto}#receipt{white-space:pre-wrap}
</style><main id="fixture">${xrLayoutEditorMarkup()}</main><pre id="receipt"></pre>
<script>${bundle.outputFiles[0].text}</script></html>`);
const { stdout } = await promisify(execFile)(browser, ["--headless=new", "--disable-gpu",
  "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`,
  "--window-size=1100,2100", "--virtual-time-budget=3000", `--screenshot=${join(output, "xr-layout.png")}`,
  "--dump-dom", pathToFileURL(file).href], { windowsHide: true, timeout: 45000, maxBuffer: 4_000_000 });
const raw = stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1];
assert.ok(raw, "No offscreen receipt produced.");
const receipt = JSON.parse(raw.replaceAll("&amp;", "&").replaceAll("&gt;", ">").replaceAll("&lt;", "<"));
await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
assert.equal(receipt.pass, true, JSON.stringify(receipt));
console.log(JSON.stringify({ pass: true, checks: receipt.checks.length, output }));
