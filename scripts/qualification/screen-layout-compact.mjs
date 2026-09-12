// Actual bootResearchUi screenshots in isolated headless browser profiles.
// node scripts/qualification/screen-layout-compact.mjs <browser.exe> <output-dir>
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination, "Provide browser executable and isolated output directory.");
const output = resolve(destination);
await mkdir(output, { recursive: true });
const site = resolve(import.meta.dirname, "../../site");
const cases = ["desktop", "narrow"].flatMap(pane => [
  {state:"unavailable",position:"top"}, {state:"unavailable",position:"middle"}, {state:"unavailable",position:"bottom"},
  {state:"populated",position:"middle"}, {state:"portrait",position:"top"}, {state:"error",position:"bottom"},
].map(sample => ({ name: `${pane}-${sample.state}-${sample.position}`, pane, ...sample })));

function fixture(sample) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><link rel="stylesheet" href="/site/research.css">
<div id="research-app" data-research-surface="browser"></div><script type="module">
import { bootResearchUi } from '/site/src/research/app.js';
import { RESEARCH_UI_EVENTS } from '/site/src/research/ui-contracts.js';
import { browserDisplayGeometry } from '/site/src/research/video-catalogue-contribution.js';
const sample=${JSON.stringify(sample)}, errors=[], checks=[];
addEventListener('error',e=>errors.push(e.message));
addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const check=(name,pass)=>checks.push({name,pass:Boolean(pass)});
const wait=()=>new Promise(resolve=>setTimeout(resolve,350));
try {
 const app=bootResearchUi(), ui=app.researchUi;
 if(sample.state==='portrait')app.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.stimuliCatalogued,{detail:{replace:true,items:[{
   stimulus:{stimulusId:'portrait',title:'Portrait fixture',source:{kind:'workspaceFile',relativePath:'stimuli/portrait.mp4',mimeType:'video/mp4',sha256:'a'.repeat(64),byteLength:1024,durationMs:1000}},
   verified:true,displayGeometry:browserDisplayGeometry({videoWidth:1080,videoHeight:1920})
 }]}}));
 ui.openSetupSection('layout'); await wait();
 if(sample.pane==='narrow')app.querySelector('[data-setup-resizer]').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));
 const root=app.querySelector('[data-screen-layout-draft]'), pane=app.querySelector('.setup-pane');
 const field=name=>root.querySelector('[data-layout-field="'+name+'"]');
 const edit=(name,value,type='input')=>{const control=field(name);if(control.type==='checkbox')control.checked=value;else control.value=value;control.dispatchEvent(new Event(type,{bubbles:true}));};
 const settings=JSON.stringify(ui.settings), packageText=ui.experimentPackageSourceText;
 if(sample.state==='populated') {
   root.querySelector('.layout-calibration').open=true;
   edit('physicalWidth',480);edit('physicalHeight',270);edit('fullViewportMapping',true,'change');
   edit('offsetX',10);edit('units','mm','change');
   check('populated calibrated fields',field('units').value==='mm'&&field('offsetX').value==='28.8');
 } else if(sample.state==='error') {
   edit('screenWidth',''); edit('diameter',-1);
   check('invalid fields remain visible',field('screenWidth').getAttribute('aria-invalid')==='true'&&field('diameter').getAttribute('aria-invalid')==='true');
   check('invalid geometry is not reused',!root.querySelector('svg'));
   check('invalid border remains visible',getComputedStyle(field('diameter')).borderTopColor===getComputedStyle(root.querySelector('[data-layout-errors]')).color);
 }
 await wait();
 const visible=[...root.querySelectorAll('input,select,button,summary')].filter(e=>e.getBoundingClientRect().width>0&&(!e.closest('details:not([open])')||e.matches('details:not([open])>summary')));
 const bounds=root.getBoundingClientRect(), section=root.closest('[data-setup-section]');
 check('all controls named',visible.every(e=>e.tagName==='SUMMARY'||e.tagName==='BUTTON'||e.labels?.length>0));
 check('minimum control targets',visible.every(e=>e.matches('input[type="checkbox"]')?e.closest('label').getBoundingClientRect().height>=24:e.getBoundingClientRect().height>=24));
 check('no horizontal control clipping',visible.every(e=>{const r=e.getBoundingClientRect();return r.left>=bounds.left-1&&r.right<=bounds.right+1;}));
 check('no pane overflow',pane.scrollWidth<=pane.clientWidth);
 check('dimensions and offsets retain paired rows',[['screenWidth','screenHeight'],['referenceWidth','referenceHeight'],['referenceX','referenceY'],['diameter','gap'],['offsetX','offsetY']].every(([a,b])=>Math.abs(field(a).getBoundingClientRect().top-field(b).getBoundingClientRect().top)<1));
 check('readable control text',visible.every(e=>parseFloat(getComputedStyle(e).fontSize)>=12));
 check('exactly one draft reset',root.querySelectorAll('[data-layout-reset]').length===1);
 check('draft boundary visible',root.textContent.includes('not saved in the experiment package'));
 check('media source is explicit',root.querySelector('[data-layout-dependencies]').textContent.includes(sample.state==='portrait'?'verified video display':'required to check every video'));
 check('package and settings unchanged',settings===JSON.stringify(ui.settings)&&packageText===ui.experimentPackageSourceText);
 field('offsetX').focus({preventScroll:true});check('keyboard focus retained',document.activeElement===field('offsetX'));
 const footer=section.querySelector('[data-confirm-section]');
 pane.scrollTop+=footer.getBoundingClientRect().bottom-pane.getBoundingClientRect().bottom+16;
 const f=footer.getBoundingClientRect(), p=pane.getBoundingClientRect();
 check('confirmation footer reachable',f.top>=p.top-1&&f.bottom<=p.bottom+1);
 if(sample.position==='top')pane.scrollTop+=section.getBoundingClientRect().top-pane.getBoundingClientRect().top;
 else if(sample.position==='middle')pane.scrollTop+=root.querySelector('.layout-calibration').getBoundingClientRect().top-pane.getBoundingClientRect().top;
 await wait();
 check('no runtime errors',errors.length===0);
 parent.postMessage({name:sample.name,checks,errors,boot:'bootResearchUi',syntheticGeometry:sample.state==='portrait',paneWidth:pane.clientWidth,paneOuterWidth:pane.getBoundingClientRect().width,editorWidth:root.clientWidth,editorHeight:root.getBoundingClientRect().height,visibleControls:visible.length,qualification:false,exportable:false},location.origin);
} catch(error){parent.postMessage({name:sample.name,checks,errors:[String(error.stack)]},location.origin);}
</script></html>`;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const sample = cases.find(entry => entry.name === url.searchParams.get("case")) ?? cases[0];
    if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}iframe{display:block;border:0;width:1280px;height:900px}pre{display:none}</style><iframe src="/fixture?case=${sample.name}" title="P4 application review"></iframe><pre id="receipt"></pre><script>addEventListener('message',event=>{if(event.origin===location.origin)document.querySelector('#receipt').textContent=JSON.stringify(event.data)});</script></html>`);
    } else if (url.pathname === "/fixture") {
      response.setHeader("Content-Type", "text/html"); response.end(fixture(sample));
    } else if (url.pathname.startsWith("/site/")) {
      const file = resolve(site, "." + decodeURIComponent(url.pathname.slice(5)));
      assert.ok(file.startsWith(site + sep));
      response.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" })[extname(file)] ?? "application/octet-stream");
      response.end(await readFile(file));
    } else { response.writeHead(404); response.end(); }
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const rows = [];
  for (const sample of cases) {
    const profile = await mkdtemp(join(output, "isolated-profile-"));
    const { stdout } = await promisify(execFile)(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--force-prefers-reduced-motion", `--user-data-dir=${profile}`, "--window-size=1280,900", "--virtual-time-budget=5000", `--screenshot=${join(output, sample.name + ".png")}`, "--dump-dom", `http://127.0.0.1:${server.address().port}/?case=${sample.name}`], { windowsHide: true, timeout: 30000, maxBuffer: 2_000_000 });
    const raw = stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1];
    assert.ok(raw, `No application receipt: ${sample.name}`);
    rows.push(JSON.parse(raw.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&gt;", ">").replaceAll("&lt;", "<")));
  }
  await writeFile(join(output, "receipt.json"), JSON.stringify(rows, null, 2));
  for (const row of rows) {
    assert.deepEqual(row.errors, [], row.name);
    assert.deepEqual(row.checks.filter(check => !check.pass), [], row.name);
  }
  console.log(JSON.stringify({pass:true,scenarios:rows.length,checks:rows.reduce((sum,row)=>sum+row.checks.length,0),output,heights:rows.map(({name,editorHeight,paneWidth})=>({name,editorHeight,paneWidth}))}));
} finally { server.close(); }
