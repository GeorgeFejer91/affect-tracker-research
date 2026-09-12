// Actual app, isolated headless process, synthetic catalogue event at the P1 boundary.
// node scripts/qualification/screen-layout-live.mjs <browser.exe> <output-dir>
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, extname, sep } from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { browserDisplayGeometry, assetIdFromSha256 } from "../../site/src/research/video-catalogue-contribution.js";
const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination);
const output = resolve(destination), site = resolve(import.meta.dirname, "../../site");
await mkdir(output, { recursive: true });
const catalogue = JSON.parse(await readFile(resolve(import.meta.dirname, "../../test/fixtures/research-video-catalogue-contribution-v1.json"), "utf8"));
catalogue.entries.push({ ...catalogue.entries[0], sha256: "c".repeat(64), assetId: assetIdFromSha256("c".repeat(64)),
  annotationId: "Portrait fixture", sourceRelativePath: "stimuli/portrait.mp4", packageRelativePath: "assets/stimuli/portrait.mp4",
  geometry: browserDisplayGeometry({ videoWidth: 1080, videoHeight: 1920 }) });
const cases = ["desktop-populated", "narrow-populated", "narrow-invalid", "desktop-unavailable", "desktop-controls", "narrow-controls"];
const served = new Map();
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const run = promisify(execFile);
const commit = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
const status = (await run("git", ["status", "--short"])).stdout;
function fixture(name) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><link rel="stylesheet" href="/site/research.css">
<div id="research-app" data-research-surface="browser"></div><script type="module">
import {bootResearchUi} from '/site/src/research/app.js';
import {RESEARCH_UI_EVENTS} from '/site/src/research/ui-contracts.js';
const fixture=${JSON.stringify(catalogue)}, name=${JSON.stringify(name)}, checks=[], errors=[];
const check=(name,pass)=>checks.push({name,pass:Boolean(pass)});
addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const wait=()=>new Promise(r=>setTimeout(r,100));
const until=async predicate=>{for(let i=0;i<60;i++){if(predicate())return;await wait();}throw Error('State did not settle');};
try {
 const app=bootResearchUi(),ui=app.researchUi;ui.openSetupSection('layout');await wait();
 if(name.startsWith('narrow'))app.querySelector('[data-setup-resizer]').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
 const root=app.querySelector('[data-screen-layout-draft]'),pane=app.querySelector('.setup-pane');
 const field=k=>root.querySelector('[data-layout-field="'+k+'"]');
 const edit=(el,value,type='input')=>{if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new Event(type,{bubbles:true}));};
 const p=()=>ui.getScreenLayoutProjection(),snap=()=>ui.getScreenLayoutContributionSnapshot();
 const send=(missing=false)=>app.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.stimuliCatalogued,{detail:{replace:true,items:fixture.entries.map((e,i)=>({
   stimulus:{stimulusId:'fixture-'+i,title:e.annotationId,source:{kind:'workspaceFile',relativePath:e.sourceRelativePath,mimeType:'video/mp4',sha256:e.sha256,byteLength:e.byteLength,durationMs:e.durationMs}},
   verified:true,displayGeometry:missing?null:e.geometry}))}}));
 check('P4 is registered once',ui.getPlannerContributionReview().snapshots.filter(s=>s.segment==='P4').length===1);
 check('empty library shows no invented video',p().videos.length===0);
 check('reference method has no selected default',field('referencePolicy').value===''&&ui.getScreenLayoutDraftDocument().draft.referencePolicy===null);
 let unselectedRejected=false;try{await ui.prepareScreenLayoutContribution();}catch{unselectedRejected=true;}
 check('unselected layout cannot prepare',unselectedRejected&&snap().pending);
 const policy=name.startsWith('narrow')?'maximum-oriented-dimensions':'largest-oriented-area';
 edit(field('referencePolicy'),policy,'change');
 const packageBefore=ui.experimentPackageSourceText;
 send();await until(()=>p().videos.length===fixture.entries.length);
 check('all verified P1 identities are rendered',p().videos.every(v=>fixture.entries.some(e=>e.assetId===v.id)));
 check('current P1 owner revision is bound',snap().dependencyRevisions.find(d=>d.segment==='P1').revision===ui.getVideoCatalogueContributionSnapshot().revision);
 const workspaceBefore=ui.getWorkspaceContributionSnapshot(),p4StudyBefore=snap().revision;
 edit(app.querySelector('#experiment-title'),'Revised layout study');
 await until(()=>snap().revision>p4StudyBefore&&p().videos.length===fixture.entries.length);
 const workspaceAfter=ui.getWorkspaceContributionSnapshot();
 check('study edit retains exact nested catalogue',JSON.stringify(workspaceBefore.contribution.videoCatalogue)===JSON.stringify(workspaceAfter.contribution.videoCatalogue));
 check('study edit binds the registered P1 revision',snap().dependencyRevisions.find(d=>d.segment==='P1').revision===workspaceAfter.revision&&ui.getPlannerContributionReview().snapshots.find(s=>s.segment==='P1').revision===workspaceAfter.revision);
 check('saved P5 maximum bounds are present',p().geometry.maximumFeedback.width>0);
 const selected=root.querySelector('[data-layout-video]'),beforeSelect=snap().revision,geometry=JSON.stringify(p().geometry);
 selected.value=selected.options[selected.options.length-1].value;selected.dispatchEvent(new Event('change',{bubbles:true}));
 check('video inspection does not revise or reposition layout',snap().revision===beforeSelect&&JSON.stringify(p().geometry)===geometry);
 const r=snap().revision;edit(field('offsetX'),10);
 check('numeric layout edit revises P4',snap().revision>r);
 check('fixed reference percentage offset',Math.abs(p().geometry.offset.x-p().geometry.reference.width*.1)<1e-8);
 const p5Before=ui.getFeedbackContributionSnapshot().revision,p4Before=snap().revision;
 edit(app.querySelector('#preview-halo-size'),200);await wait();
 check('temporary preview does not revise P4 or P5',snap().revision===p4Before&&ui.getFeedbackContributionSnapshot().revision===p5Before);
 edit(app.querySelector('#flubber-outline-thickness'),20);await wait();
 check('saved feedback edit revises dependent layout',snap().revision>p4Before&&ui.getFeedbackContributionSnapshot().revision>p5Before);
 const validFeedback=ui.getFeedbackContributionSnapshot().contribution;
 edit(app.querySelector('#input-step-size'),'');await wait();
 check('invalid saved feedback clears old bounds',ui.getFeedbackContributionSnapshot().pending&&p().geometry.maximumFeedback===null);
 await ui.restoreFeedbackContribution(validFeedback);await wait();
 check('feedback restore recalculates bounds',p().geometry.maximumFeedback!==null);
 const saved=ui.getScreenLayoutDraftDocument();edit(field('diameter'),'');
 check('invalid P4 edit clears old geometry',p().geometry===null&&!root.querySelector('svg'));
 await ui.restoreScreenLayoutDraft(saved);check('draft restores exact authoring fields',JSON.stringify(ui.getScreenLayoutDraftDocument())===JSON.stringify(saved));
 const stale=structuredClone(saved);stale.draft.offsetX=99;
 const restore=ui.restoreScreenLayoutDraft(stale);edit(field('offsetX'),12);
 let rejected=false;try{await restore;}catch{rejected=true;}check('interleaved restore rejects atomically',rejected&&field('offsetX').value==='12');
 await ui.restoreScreenLayoutDraft(saved);
 edit(field('physicalWidth'),480);edit(field('physicalHeight'),270);edit(field('fullViewportMapping'),true,'change');
 const beforeUnits=p().geometry;edit(field('units'),'mm','change');
 check('physical conversion preserves live bounds',Math.abs(p().geometry.maximumFeedback.width-beforeUnits.maximumFeedback.width)<1e-8);
 await ui.restoreScreenLayoutDraft(saved);
 send(true);await until(()=>p().videos.length===0);
 check('missing geometry withdraws whole catalogue',ui.getVideoCatalogueContributionSnapshot().pending&&p().videos.length===0);
 send();await until(()=>p().videos.length===fixture.entries.length);
 const ready=ui.getScreenLayoutDraftDocument();Object.assign(ready.draft,{referenceWidth:60,referenceHeight:45,referenceY:30,diameter:4,offsetX:0,offsetY:90,gap:1});
 await ui.restoreScreenLayoutDraft(ready);
 const prepared=await ui.prepareScreenLayoutContribution();
 check('real preparation returns explicit chosen policy',!prepared.pending&&prepared.contribution.reference.source.policy===policy);
 check('prepared dependency revisions match current registered owners',prepared.dependencyRevisions.every(d=>d.revision===ui.getPlannerContributionReview().snapshots.find(s=>s.segment===d.segment).revision));
 await ui.acceptPlannerContribution('P4');
 check('P7 accepts real validated P4 contribution',ui.getPlannerAcceptanceReview().entries.find(e=>e.segment==='P4').status==='accepted');
 const content=prepared.contribution,workspace=ui.getWorkspaceContributionSnapshot().contribution,feedback=ui.getFeedbackContributionSnapshot().contribution;
 const pure=await import('/site/src/research/desktop-layout-contribution.js');
 const bytes=await pure.serializeDesktopLayoutContribution(content,{workspace,feedback});
 const reread=await pure.parseDesktopLayoutContribution(bytes,{workspace,feedback});
 check('strict accepted layout roundtrip reproduces preview geometry',JSON.stringify((await pure.resolveDesktopLayoutContribution(reread,{workspace,feedback})).geometry)===JSON.stringify(p().geometry));
 edit(field('offsetX'),3);check('edit withdraws prepared contribution',snap().pending&&snap().contribution===null);
 await ui.restoreScreenLayoutContent(content,{savedWorkspaceContribution:workspace,savedFeedbackContribution:feedback});
 check('content restore is editable and pending',snap().pending&&field('referencePolicy').value===policy&&field('offsetX').value==='0');
 await ui.prepareScreenLayoutContribution();
 const restoreReady=await ui.restoreScreenLayoutContribution(content);
 check('ready restore returns exact accepted domain',!restoreReady.pending&&JSON.stringify(restoreReady.contribution)===JSON.stringify(content));
 edit(field('referencePolicy'),'','change');
 let refused=false;try{await ui.prepareScreenLayoutContribution();}catch{refused=true;}
 check('clearing method withdraws old geometry and acceptance',refused&&snap().pending&&p().geometry===null);
 await ui.restoreScreenLayoutDraft(ready);
 check('draft edits do not write package bytes',ui.experimentPackageSourceText===packageBefore);
 check('reference candidates use full oriented geometry',Boolean(p().referenceCandidates?.largestVideo));
 if(name.endsWith('invalid'))edit(field('diameter'),-1);
 if(name.endsWith('unavailable')){send(true);await until(()=>p().videos.length===0);}
 if(name.endsWith('populated')){
   edit(field('offsetY'),75);edit(field('diameter'),12);
   selected.value='asset-'+'c'.repeat(64);selected.dispatchEvent(new Event('change',{bubbles:true}));
   const video=root.querySelector('.layout-video');
   check('portrait uses oriented contain bounds',Number(video.getAttribute('width'))<Number(video.getAttribute('height')));
 }
 await wait();
 const visible=[...root.querySelectorAll('input,select,button,summary')].filter(e=>e.getBoundingClientRect().width>0&&(!e.closest('details:not([open])')||e.matches('details:not([open])>summary')));
 const bounds=root.getBoundingClientRect();
 check('labels are present',visible.every(e=>e.matches('button,summary')||e.labels?.length));
 check('controls remain inside editor',visible.every(e=>{const r=e.getBoundingClientRect();return r.left>=bounds.left-1&&r.right<=bounds.right+1;}));
 check('no pane horizontal overflow',pane.scrollWidth<=pane.clientWidth);
 check('invalid field border is visible',!name.endsWith('invalid')||getComputedStyle(field('diameter')).borderTopColor===getComputedStyle(root.querySelector('[data-layout-errors]')).color);
 field('offsetX').focus({preventScroll:true});check('numeric keyboard focus',document.activeElement===field('offsetX'));
 if(name.endsWith('invalid')){
   let invalidRejected=false;try{await ui.prepareScreenLayoutContribution();}catch{invalidRejected=true;}
   check('failed preparation focuses its invalid numeric field',invalidRejected&&document.activeElement===field('diameter'));
 }
 const section=root.closest('[data-setup-section]'),footer=section.querySelector('[data-confirm-section]');
 pane.scrollTop+=footer.getBoundingClientRect().bottom-pane.getBoundingClientRect().bottom+16;
 check('footer reachable',footer.getBoundingClientRect().bottom<=pane.getBoundingClientRect().bottom+1);
 if(!name.endsWith('invalid'))pane.scrollTop+=section.getBoundingClientRect().top-pane.getBoundingClientRect().top;
 if(name.endsWith('controls'))pane.scrollTop+=field('referencePolicy').labels[0].getBoundingClientRect().top-pane.getBoundingClientRect().top-16;
 await wait();check('no runtime errors',errors.length===0);
 const receipt={name,checks,errors,boot:'bootResearchUi',syntheticCatalogue:true,nativePlayback:false,acceptedLayoutVerified:true,paneWidth:pane.clientWidth,editorHeight:root.getBoundingClientRect().height,projection:p(),snapshot:snap()};
 parent.postMessage(receipt,location.origin);
}catch(error){parent.postMessage({name,checks,errors:[...errors,String(error.stack)]},location.origin);}
</script></html>`;
}
const server=createServer(async(request,response)=>{
  try {
    const url=new URL(request.url,'http://127.0.0.1'),name=cases.includes(url.searchParams.get('case'))?url.searchParams.get('case'):cases[0];
    if(url.pathname==='/'){
      response.setHeader('Content-Type','text/html');response.end('<!doctype html><html><style>html,body{margin:0;overflow:hidden}iframe{display:block;border:0;width:1280px;height:900px}pre{display:none}</style><iframe title="P4 live fit review" src="/fixture?case='+name+'"></iframe><pre id="receipt"></pre><script>addEventListener("message",e=>{if(e.origin===location.origin)document.querySelector("#receipt").textContent=JSON.stringify(e.data)});</script></html>');
    } else if(url.pathname==='/fixture'){response.setHeader('Content-Type','text/html');const html=fixture(name);served.set(name,hash(html));response.end(html);}
    else if(url.pathname.startsWith('/site/')){
      const file=resolve(site,'.'+decodeURIComponent(url.pathname.slice(5)));assert.ok(file.startsWith(site+sep));
      const bytes=await readFile(file);served.set(file,hash(bytes));
      response.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');response.end(bytes);
    }else{response.writeHead(404);response.end();}
  }catch(error){response.writeHead(500);response.end(String(error));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
  const rows=[];
  for(const name of cases){
    const profile=await mkdtemp(join(output,'isolated-profile-'));
    const {stdout,stderr}=await run(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--force-prefers-reduced-motion','--user-data-dir='+profile,'--window-size=1280,900','--virtual-time-budget=12000','--screenshot='+join(output,name+'.png'),'--dump-dom','http://127.0.0.1:'+server.address().port+'/?case='+name],{windowsHide:true,timeout:30000,maxBuffer:2_000_000});
    await writeFile(join(output,name+'.stderr.txt'),stderr);
    const raw=stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1];assert.ok(raw,'No receipt: '+name);
    rows.push(JSON.parse(raw.replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&gt;','>').replaceAll('&lt;','<')));
  }
  const screenshots=Object.fromEntries(await Promise.all(cases.map(async name=>[name,hash(await readFile(join(output,name+'.png')))])));
  await writeFile(join(output,'receipt.json'),JSON.stringify({commit,status,browser,sourceHashes:Object.fromEntries(served),screenshots,rows},null,2));
  for(const row of rows){assert.deepEqual(row.errors,[],row.name);assert.deepEqual(row.checks.filter(c=>!c.pass),[],row.name);}
  console.log(JSON.stringify({pass:true,scenarios:rows.length,checks:rows.reduce((s,r)=>s+r.checks.length,0),output}));
}finally{server.close();}
