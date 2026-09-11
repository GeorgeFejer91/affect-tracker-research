// Non-shipping headless UI checks; never attaches to or drives a user's browser.
// node scripts/qualification/screen-layout-draft.mjs <browser.exe> <output-directory>
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";

const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination, "Provide browser executable and isolated output directory.");
const repository = fileURLToPath(new URL("../..", import.meta.url));
const output = resolve(destination);
await mkdir(output, { recursive: true });
const css = await readFile(join(repository, "site/research.css"), "utf8");
const cases = [
  { id: "application", width: 1280, app: true },
  { id: "fixture-wide", width: 760 },
  { id: "fixture-narrow", width: 360 },
  { id: "fixture-forced-colors", width: 760, forcedColors: true },
];
const receipts = [];
for (const sample of cases) {
  const profile = await mkdtemp(join(output, `${sample.id}-profile-`));
  const { outputFiles } = await build({ stdin: { contents: `
import { screenLayoutDraftMarkup } from './site/src/research/screen-layout-view.js';
import { createScreenLayoutDraftEditor } from './site/src/research/screen-layout-editor.js';
import { renderResearchUiMarkup, initializeResearchUi } from './site/src/research/app.js';
const sample=${JSON.stringify(sample)};
const checks=[]; const failures=[];
const check=(name, pass)=>{checks.push({name,pass:Boolean(pass)});if(!pass)failures.push(name);};
const errors=[];
window.addEventListener('error', e=>errors.push(e.message));
window.addEventListener('unhandledrejection', e=>errors.push(String(e.reason)));
const host=document.querySelector('#research-app');
let ui=null; let editor=null;
const fixtures={media:[{id:'landscape',source:'synthetic',width:1920,height:1080},{id:'portrait',source:'synthetic',width:1080,height:1920}],envelope:{source:'synthetic',revision:'headless-v1',left:.6,right:.6,top:.6,bottom:.6,paddingCssPx:2}};
try {
 host.innerHTML=sample.app?renderResearchUiMarkup('browser'):screenLayoutDraftMarkup();
 if(sample.app){ ui=initializeResearchUi(host,{surface:'browser'});ui.openSetupSection('layout'); }
 else editor=createScreenLayoutDraftEditor(host.querySelector('[data-screen-layout-draft]'),{fixtures});
 const root=host.querySelector('[data-screen-layout-draft]');
 const field=name=>root.querySelector('[data-layout-field="'+name+'"]');
 const edit=(name,value,type='input')=>{ const e=field(name);if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event(type,{bubbles:true})); };
 const before=ui?JSON.stringify(ui.settings):null;
 const packageBefore=ui?.experimentPackageSourceText;
 check('explicit draft/export boundary',root.textContent.includes('not saved in the experiment package'));
 check('numeric controls have labels',[...root.querySelectorAll('[data-layout-field]')].every(e=>root.querySelector('label[for="'+e.id+'"]')||e.closest('label')));
 check('screen has accessible name',Boolean(root.querySelector('svg[role="img"] title')&&root.querySelector('svg[role="img"] desc')));
 edit('offsetX',10); const centre=root.querySelector('circle').getAttribute('cx');
 edit('offsetY',0);check('numeric edit updates projected centre',Number(root.querySelector('circle').getAttribute('cy'))===378);
 if(!sample.app){
   check('overlap is diagnosed',root.querySelector('[data-layout-errors]').textContent.includes('overlap'));
   const select=root.querySelector('[data-layout-video]');select.value='portrait';select.dispatchEvent(new Event('change',{bubbles:true}));
   check('mixed ratio retains feedback centre',root.querySelector('circle').getAttribute('cx')===centre);
   check('portrait contained without crop',Number(root.querySelector('.layout-video').getAttribute('width'))===364.5);
 }
 edit('offsetY',75);edit('screenWidth','');
 check('invalid draft clears stale diagram',!root.querySelector('svg'));
 check('invalid draft has field-level semantics',field('screenWidth').getAttribute('aria-invalid')==='true');
 field('screenWidth').dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
 check('shell validation does not overwrite draft errors',field('screenWidth').getAttribute('aria-invalid')==='true');
 edit('screenWidth',1920);edit('units','mm','change');
 check('uncalibrated conversion is rejected',field('units').value==='relative'&&root.querySelector('[data-layout-errors]').textContent.includes('measured'));
 edit('physicalWidth',480);edit('physicalHeight',270);edit('fullViewportMapping',true,'change');
 const originalCircle=root.querySelector('circle').outerHTML;
 edit('units','mm','change');
 check('calibrated unit conversion is accepted',field('units').value==='mm');
 check('unit conversion preserves diagram',root.querySelector('circle').outerHTML===originalCircle);
 edit('units','relative','change');
 check('round trip preserves diagram',root.querySelector('circle').outerHTML===originalCircle);
 check('converted field avoids floating-point display noise',field('referenceHeight').value==='60');
 check('no export action',[...root.querySelectorAll('button')].every(e=>e.type==='button'&&!/export|save/i.test(e.textContent)));
 if(ui){check('v1 settings unchanged',JSON.stringify(ui.settings)===before);check('package bytes unchanged',ui.experimentPackageSourceText===packageBefore);}
 const scene=root.querySelector('svg').getBoundingClientRect();
 check('diagram has visible dimensions',scene.width>100&&scene.height>20);
 check('editor reflows without horizontal overflow',root.scrollWidth<=root.clientWidth+1);
 if(!sample.app)check('fixture stays inside requested screenshot width',root.getBoundingClientRect().right<=sample.width+1);
 check('controls fit editor',[...root.querySelectorAll('input,select,button')].filter(e=>e.getBoundingClientRect().width>0).every(e=>{const a=e.getBoundingClientRect(),b=root.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1;}));
 field('offsetX').focus();check('numeric control can receive focus',document.activeElement===field('offsetX'));
 if(sample.forcedColors){check('forced colors active',matchMedia('(forced-colors: active)').matches);check('feedback stroke remains visible',getComputedStyle(root.querySelector('.layout-feedback')).stroke!=='none');}
 const beforeDestroy=root.querySelector('[data-layout-scene]').innerHTML;
 if(editor){editor.destroy();edit('offsetX',25);check('destroy removes editing listeners',root.querySelector('[data-layout-scene]').innerHTML===beforeDestroy);editor=createScreenLayoutDraftEditor(root,{fixtures});}
 check('no console/runtime errors',errors.length===0);
 document.querySelector('#p4-receipt').textContent=btoa(JSON.stringify({id:sample.id,checks,failures,errors,qualification:false,exportable:false}));
}catch(error){document.querySelector('#p4-receipt').textContent=btoa(JSON.stringify({id:sample.id,checks,failures:[String(error.stack)],errors}));}
`, resolveDir: repository, sourcefile: "p4-headless-fixture.js", loader: "js" }, bundle: true, format: "esm", write: false, logLevel: "silent" });
  const path = join(output, `${sample.id}.html`);
  const standalone = sample.app ? "" : `html,body,#research-app{min-width:0;height:auto;min-height:0}html,body{width:${sample.width}px}body{overflow:auto}#research-app{width:100%;max-width:720px;margin:auto;padding:16px}`;
  await writeFile(path, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>P4 non-shipping draft checks</title><style>${css}\n${standalone}</style></head><body><div id="research-app"></div><pre id="p4-receipt" hidden></pre><script type="module">${outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`);
  const { stdout } = await promisify(execFile)(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--force-prefers-reduced-motion", ...(sample.forcedColors ? ["--force-high-contrast"] : []), `--user-data-dir=${profile}`, `--window-size=${sample.width},1800`, "--virtual-time-budget=2500", `--screenshot=${join(output, `${sample.id}.png`)}`, "--dump-dom", pathToFileURL(path).href], { windowsHide: true, timeout: 30000, maxBuffer: 5_000_000 });
  const encoded = stdout.match(/<pre id="p4-receipt"[^>]*>([^<]+)<\/pre>/u)?.[1];
  assert.ok(encoded, `${sample.id}: no headless receipt`);
  const receipt = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  receipts.push(receipt);
  await writeFile(join(output, "receipt.json"), JSON.stringify(receipts, null, 2));
  assert.deepEqual(receipt.failures, [], `${sample.id}: ${receipt.failures.join(", ")}`);
}
console.log(JSON.stringify({ pass: true, scenarios: receipts.length, checks: receipts.reduce((n, r) => n + r.checks.length, 0), output, qualification: false }));
