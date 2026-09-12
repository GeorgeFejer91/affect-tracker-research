// Full application boot in a fresh offscreen browser. No native adapter,
// filesystem picker, media playback, or Run is invoked.
// Usage: node scripts/qualification/xr-layout-boot.mjs <browser.exe> <output>
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

// Keep capture widths away from the 759px layout breakpoint: Chromium's CLI
// screenshot can remove its window-frame inset while capturing.
const [browser, destination, widthList = "1440,820"] = process.argv.slice(2);
assert.ok(browser && destination, "Provide browser executable and output directory.");
const widths = widthList.split(",").map(Number);
assert.ok(widths.length <= 3 && widths.every(width => Number.isInteger(width) && width >= 320 && width <= 2560));
const output = resolve(destination);
await mkdir(output, { recursive: true });
const source = await readFile("test/fixtures/xr-layout-v1.canonical.json", "utf8");
const { cases } = JSON.parse(await readFile("test/fixtures/xr-feedback-envelope-v1.json", "utf8"));
const css = await readFile("site/research.css", "utf8");
const entry = `import { bootResearchUi } from './site/src/research/app.js';
const checks=[];const check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name);};
(async()=>{
 const params=new URL(location.href).searchParams, state=params.get('state');
 const root=bootResearchUi(),ui=root.researchUi, q=s=>root.querySelector(s);
 check('actual UI controller booted',!!ui&&ui.mode==='setup');
 q('[data-open-section="xr"]').click();
 check('independent XR section opens',ui.openSection==='xr'&&q('#setup-trigger-xr').getAttribute('aria-expanded')==='true');
 check('one editor and confirmation',root.querySelectorAll('[data-xr-layout-editor]').length===1&&root.querySelectorAll('[data-confirm-section="xr"]').length===1);
 check('XR section summary is defined',q('[data-section-summary="xr"]').textContent!=='undefined');
 if(state!=='empty'){
  ui.setXrLayoutDependencies({catalogueRevision:3,feedbackRevision:5,feedbackEnvelope:${JSON.stringify(cases[0].envelope)},catalogueGeometry:[
   {assetId:'landscape',displayWidth:1920,displayHeight:1080},{assetId:'portrait',displayWidth:1080,displayHeight:1920}]});
  ui.restoreXrLayoutProfile(${JSON.stringify(source)});
  q('[data-xr-media]').value='portrait';q('[data-xr-media]').dispatchEvent(new Event('change',{bubbles:true}));
  check('accepted actual contribution and bound preview',!ui.getXrLayoutContribution().pending&&!!q('.xr-feedback-envelope'));
 }
 if(state==='error'){
  q('[data-xr-field="video.distanceMetres"]').value='';
  q('[data-xr-field="video.distanceMetres"]').dispatchEvent(new Event('input',{bubbles:true}));
  check('invalid edit blocks accepted contribution',ui.getXrLayoutContribution().pending&&ui.getXrLayoutContribution().contribution===null);
  check('error is visible and announced',!q('[data-xr-error]').hidden&&q('[data-xr-error]').getAttribute('role')==='alert');
 }
 await new Promise(resolve=>setTimeout(resolve,500));
 const host=q('[data-xr-layout-editor]');
 const visible=[...host.querySelectorAll('input,select,button')].filter(el=>el.getClientRects().length);
 check('visible controls stay within editor',visible.every(el=>el.getBoundingClientRect().right<=host.getBoundingClientRect().right+1));
 check('native input controls have labels',visible.filter(el=>el.matches('input,select')).every(el=>el.closest('label')));
 check('editor horizontal reflow',host.scrollWidth<=host.clientWidth+1);
 const target=state==='error'?q('[data-xr-error]'):params.get('view')==='scene'?q('[data-xr-scene]'):host;
 check('accordion settled',q('#setup-panel-xr').dataset.motionState==='open');
 const pane=q('.setup-pane');
 pane.scrollTop+=target.getBoundingClientRect().top-pane.getBoundingClientRect().top;
 window.scrollTo(0,0);
 await new Promise(resolve=>setTimeout(resolve,500));
 document.querySelector('#receipt').textContent=JSON.stringify({passed:true,state,width:innerWidth,editorWidth:host.clientWidth,checks});
})().catch(error=>document.querySelector('#receipt').textContent=JSON.stringify({passed:false,error:error.message}));`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd() }, bundle: true,
  write: false, format: "iife", target: "chrome105", logLevel: "silent",
  define: { "import.meta.url": JSON.stringify(pathToFileURL(resolve("site/src/research/app.js")).href) } });
const file = join(output, "boot.html");
await writeFile(file, `<!doctype html><html lang="en"><meta charset="utf-8"><title>P6 full boot offscreen</title><style>${css}#receipt{display:none}</style><div id="research-app" data-research-surface="browser"></div><pre id="receipt"></pre><script>${bundle.outputFiles[0].text.replace(/<\/script/giu, "<\\/script")}</script></html>`);
for (const width of widths) for (const [state, view] of [["empty", "controls"], ["populated", "controls"], ["populated", "scene"], ["error", "controls"]]) {
  const name = `${width}-${state}-${view}`;
  const profile = await mkdtemp(join(output, "isolated-profile-"));
  const { stdout, stderr } = await promisify(execFile)(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--run-all-compositor-stages-before-draw", "--force-device-scale-factor=1", "--force-prefers-reduced-motion",
    `--user-data-dir=${profile}`, `--window-size=${width},1000`, "--virtual-time-budget=4000",
    `--screenshot=${join(output, `${name}.png`)}`, "--dump-dom", `${pathToFileURL(file).href}?state=${state}&view=${view}`],
  { windowsHide: true, timeout: 45000, maxBuffer: 6_000_000 });
  await writeFile(join(output, `${name}.browser.log`), stderr);
  const raw = stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1];
  assert.ok(raw, `No boot receipt: ${name}`);
  const receipt = JSON.parse(raw.replaceAll("&amp;", "&").replaceAll("&gt;", ">").replaceAll("&lt;", "<"));
  await writeFile(join(output, `${name}.json`), JSON.stringify(receipt, null, 2));
  assert.equal(receipt.passed, true, `${name}: ${JSON.stringify(receipt)}`);
  console.log(JSON.stringify({name,...receipt}));
}
