// Isolated DOM contract check; never connects to an existing app or native adapter.
// node scripts/qualification/setup-retained-settings.mjs <browser.exe> <output-dir>
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { build } from "esbuild";

const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination, "Provide a browser executable and isolated output directory.");
const output = resolve(destination);
await mkdir(output, { recursive: true });
const source = `
import fixture from './test/fixtures/experiment-package-v1.canonical.json';
import { initializeResearchUi } from './site/src/research/app.js';
import { renderResearchUiMarkup } from './site/src/research/ui-view.js';
import { SETUP_SECTIONS, MAPPING_FIELDS } from './site/src/research/ui-contracts.js';
import { canonicalJson } from './site/src/research/canonical.js';
import { createExperimentPackageV1, serializeExperimentPackageV1 } from './site/src/research/experiment-package.js';
const results=[], errors=[];
addEventListener('error',event=>errors.push(event.message));
addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
const check=(name,pass)=>{results.push({name,pass:!!pass});if(!pass)throw Error(name);};
const wait=()=>new Promise(resolve=>setTimeout(resolve,150));
(async()=>{
 const settings=structuredClone(fixture.settings);
 settings.experiment.samplingFrequencyHz=173;
 settings.input.stepSize=.17;
 settings.visual.sizePercent=43;settings.visual.transparency=.61;
 settings.visual.overlayPosition={x:.23,y:.71};settings.visual.lockPosition=true;
 settings.visual.gridEnabled=false;settings.visual.flubberEnabled=true;
 settings.visual.flubber={showOutline:false,outlineThickness:3.5,showHalo:false};
 settings.visual.grid={lineThickness:2.25,showOutline:false,outlineThickness:4.5,cursorSize:11};
 Object.keys(settings.visual.colors).forEach((key,i)=>{settings.visual.colors[key]='#'+(0x213141+i*0x10101).toString(16);});
 settings.advanced.lsl={enabled:true,stateStream:'RetainedState',streamType:'RetainedType',markerStream:'RetainedMarkers',sourceId:'retained-source'};
 Object.values(settings.advanced.mappings).forEach(mapping=>{
  const width=mapping.max-mapping.min;
  mapping.min+=width*.2;mapping.max-=width*.1;mapping.reverse=!mapping.reverse;
 });
 settings.output={csv:false,tsv:true};
 const expected=await serializeExperimentPackageV1(await createExperimentPackageV1({...fixture,settings}));
 for(const surface of ['browser','tauri']){
  const root=document.createElement('section');document.body.append(root);
  root.innerHTML=renderResearchUiMarkup(surface);
  const app=initializeResearchUi(root,{surface});
  const ids=[...root.querySelectorAll('[id]')].map(el=>el.id);
  check(surface+' unique DOM IDs',new Set(ids).size===ids.length);
  for(const element of root.querySelectorAll('[aria-controls],[aria-labelledby],[aria-describedby]')){
   for(const attr of ['aria-controls','aria-labelledby','aria-describedby']){
    for(const id of (element.getAttribute(attr)||'').split(/\\s+/).filter(Boolean)){
     if(!root.querySelector('[id="'+CSS.escape(id)+'"]'))throw Error(surface+' missing ARIA target '+id);
    }
   }
  }
  check(surface+' all ARIA references resolve',true);
  await app.applySettings(settings);await wait();
  // Settings intake correctly invalidates media verification. Independently read
  // the retained DOM controls; do not fabricate a decoder/readiness receipt.
  const control=id=>{const element=root.querySelector('[id="'+id+'"]');if(!element)throw Error('Missing retained control '+id);return element;};
  const readControls=()=>{
   const value=id=>control(id).value,number=id=>Number(value(id)),checked=id=>control(id).checked;
   const actual=structuredClone(settings);
   actual.experiment={id:value('experiment-id'),title:value('experiment-title'),participantCount:number('participant-count'),samplingFrequencyHz:number('sampling-frequency')};
   actual.input=app.inputBinding;
   actual.input.stepSize=number('input-step-size');
   actual.visual={gridEnabled:checked('visual-grid-visible'),flubberEnabled:checked('visual-flubber-visible'),sizePercent:number('visual-size'),transparency:number('visual-transparency')/100,
    hideFeedback:checked('visual-hide-feedback'),lockPosition:checked('visual-lock-position'),overlayPosition:{x:number('visual-position-x'),y:number('visual-position-y')},
    flubber:{showOutline:checked('flubber-outline-visible'),outlineThickness:number('flubber-outline-thickness'),showHalo:checked('flubber-halo-visible')},
    grid:{lineThickness:number('grid-line-thickness'),showOutline:checked('grid-outline-visible'),outlineThickness:number('grid-outline-thickness'),cursorSize:number('grid-cursor-size')},
    colors:Object.fromEntries(Object.keys(settings.visual.colors).map(id=>[id,value('color-'+id)]))};
   actual.advanced.lsl={enabled:checked('lsl-enabled'),stateStream:value('lsl-state-stream'),streamType:value('lsl-stream-type'),markerStream:value('lsl-marker-stream'),sourceId:value('lsl-source-id')};
   actual.advanced.mappings=Object.fromEntries(MAPPING_FIELDS.map(spec=>{
    const block=root.querySelector('[data-mapping="'+spec.id+'"]');
    return [spec.contractId,{min:Number(block.querySelector('[data-mapping-min]').value),max:Number(block.querySelector('[data-mapping-max]').value),drivenBy:block.querySelector('[data-mapping-driver]').value,reverse:block.querySelector('[data-mapping-reverse]').checked}];
   }));
   actual.output={csv:checked('output-csv'),tsv:checked('output-tsv')};return actual;
  };
  check(surface+' nondefault settings survive retained-control projection',canonicalJson(readControls())===canonicalJson(settings));
  check(surface+' physical input receipt is not inferred',app.nativeInputReceiptId===null);
  for(const {id} of SETUP_SECTIONS){
   root.querySelector('[data-open-section="'+id+'"]').click();
   root.querySelector('[data-confirm-section="'+id+'"]').click();
   check(surface+' confirms '+id,app.reviewedSetupSections.includes(id));
  }
  const first=SETUP_SECTIONS[0].id;
  root.querySelector('[data-open-section="'+first+'"]').click();
  root.querySelector('[data-open-section="'+first+'"]').click();
  check(surface+' toggling retains reviewed state',app.reviewedSetupSections.length===SETUP_SECTIONS.length);
  check(surface+' confirmation does not mutate retained controls',canonicalJson(readControls())===canonicalJson(settings));
  const bytes=await serializeExperimentPackageV1(await createExperimentPackageV1({...fixture,settings:readControls()}));
  check(surface+' canonical recipe bytes unchanged after retained-control projection',bytes===expected);
  await wait();app.destroy();root.remove();
 }
 check('no background UI errors',errors.length===0);
 document.querySelector('#receipt').textContent=JSON.stringify({pass:true,checks:results.length,results,errors});
})().catch(error=>{document.querySelector('#receipt').textContent=JSON.stringify({pass:false,error:String(error.stack),results,errors});});
`;
const bundle = await build({ write: false, bundle: true, format: "iife", stdin: { contents: source, resolveDir: process.cwd() },
  define: { "import.meta.url": JSON.stringify(pathToFileURL(resolve("site/src/research/ui-view.js")).href) }, logLevel: "silent" });
const css = await readFile("site/research.css", "utf8");
const fixturePath = join(output, "retained-settings.html");
await writeFile(fixturePath, `<!doctype html><meta charset="utf-8"><style>${css}</style><pre id="receipt">pending</pre><script>${bundle.outputFiles[0].text.replace(/<\/script/giu, "<\\/script")}</script>`);
const profile = await mkdtemp(join(output, "isolated-profile-"));
const { stdout } = await promisify(execFile)(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--window-size=1280,900", "--virtual-time-budget=15000", "--dump-dom", pathToFileURL(fixturePath).href],
{ windowsHide: true, timeout: 45000, maxBuffer: 4_000_000 });
const raw = stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1];
assert.ok(raw && raw !== "pending", "Fixture did not finish.");
const receipt = JSON.parse(raw.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<"));
await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
assert.equal(receipt.pass, true, JSON.stringify(receipt));
console.log(JSON.stringify({ pass: true, checks: receipt.checks, output }));
