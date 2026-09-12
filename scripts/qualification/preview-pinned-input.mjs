// Offscreen component composition; never connects to the researcher's app/profile.
// node scripts/qualification/preview-pinned-input.mjs <edge.exe> <output-dir>
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { renderResearchUiMarkup } from "../../site/src/research/ui-view.js";

const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination);
const output = resolve(destination); await mkdir(output, { recursive: true });
const css = await readFile(new URL("../../site/research.css", import.meta.url), "utf8");
const pane = renderResearchUiMarkup("browser").match(/<aside class="preview-pane"[\s\S]*?<\/aside>/u)?.[0];
assert.ok(pane);
const bundle = await build({ write: false, bundle: true, format: "iife", stdin: {
  resolveDir: fileURLToPath(new URL("../../", import.meta.url)), contents: `
import {createPreviewLayout,MINIMUM_PREVIEW_CONTROLS_REM} from './site/src/research/preview-layout.js';
import {createPreviewInteraction} from './site/src/research/preview-interaction.js';
import {createPreviewResponseSimulator} from './site/src/research/preview-response-simulator.js';
import {createResearchPreview} from './site/src/research/preview.js';
import {createInputBindingPreset} from './site/src/research/contracts.js';
window.checkPreview=async()=>{
 const pane=document.querySelector('.preview-pane'),map=pane.querySelector('.preview-control-surface'),stage=pane.querySelector('.preview-primary-stage');
 const layout=createPreviewLayout(pane);
 const animationFrames=[], originalFrame=window.requestAnimationFrame;
 window.requestAnimationFrame=callback=>{animationFrames.push(callback);return 0;};
 const renderer=createResearchPreview(pane.querySelector('.research-preview-studio'),{initialState:{displayMode:'flubber',tileCount:3,tileRows:5}});
 window.requestAnimationFrame=originalFrame;
 const simulator=createPreviewResponseSimulator({onChange:s=>renderer.update({...s,responseMode:s.mode})});
 simulator.configure({tileCount:3,tileRows:5});
 const adapter=createPreviewInteraction({map,stage,simulator,getBinding:()=>createInputBindingPreset('wasd'),isEnabled:()=>true});
 map.focus();map.dispatchEvent(new KeyboardEvent('keydown',{key:'d',code:'KeyD',bubbles:true,cancelable:true}));
 map.dispatchEvent(new KeyboardEvent('keyup',{key:'d',code:'KeyD',bubbles:true}));
 const key=simulator.snapshot().x===1&&simulator.snapshot().heldDirections.length===0;
 simulator.reset();layout.refresh();
 animationFrames[0]?.(performance.now());
 const controls=pane.querySelector('.preview-controls-scroll'),header=pane.querySelector('.preview-header');
 const fallback=pane.classList.contains('preview-pane-scroll-all');
 const scroller=fallback?pane:controls;scroller.scrollTop=0;
 const before=[header,stage,map].map(e=>e.getBoundingClientRect().top),lowerBefore=controls.firstElementChild.getBoundingClientRect().top;
 scroller.scrollTop=250;
 const after=[header,stage,map].map(e=>e.getBoundingClientRect().top);
 const pinned=before.every((top,i)=>Math.abs(top-after[i])<1);
 const lowerMoved=controls.firstElementChild.getBoundingClientRect().top<lowerBefore;
 const box=pane.getBoundingClientRect();
 const fit=[header,stage,map,pane.querySelector('.preview-affect-map-layout'),controls].every(e=>{const b=e.getBoundingClientRect();return b.left>=box.left-1&&b.right<=box.right+1;});
 const height=controls.getBoundingClientRect().height;
 scroller.scrollTop=0;
 const flubber=!!pane.querySelector('[data-preview-flubber-base]')?.getAttribute('d');
 const receipt={fallback,pinned,lowerMoved,fit,key,flubber,controlsHeight:height,minimumControls:MINIMUM_PREVIEW_CONTROLS_REM*parseFloat(getComputedStyle(document.documentElement).fontSize),scrollHeight:scroller.scrollHeight,clientHeight:scroller.clientHeight};
 adapter.destroy();simulator.destroy();layout.destroy();renderer.destroy();
 document.getElementById('receipt').textContent=JSON.stringify(receipt);
};` } });
const cases = [{ name: "ample", width: 680, height: 1300 }, { name: "standard", width: 680, height: 1000 }, { name: "resized", width: 320, height: 1000 }, { name: "short", width: 520, height: 520 }, { name: "text-scale", width: 680, height: 800, font: 30 }];
const receipts = [];
for (const sample of cases) {
  const profile = await mkdtemp(join(output, "isolated-profile-"));
  const fixture = join(output, `${sample.name}.html`);
  await writeFile(fixture, `<!doctype html><meta charset="utf-8"><style>${css}\n:root{font-size:${sample.font ?? 15}px} .preview-pane{height:${sample.height - 30}px;width:${sample.width}px;margin:15px} #receipt{display:none}</style>${pane}<pre id="receipt">pending</pre><script>${bundle.outputFiles[0].text}\ncheckPreview().catch(error=>document.getElementById('receipt').textContent=JSON.stringify({error:error.message}));</script>`);
  const { stdout } = await promisify(execFile)(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--window-size=1200,${sample.height}`, "--virtual-time-budget=3000", `--screenshot=${join(output, `${sample.name}.png`)}`, "--dump-dom", pathToFileURL(fixture).href], { windowsHide: true, timeout: 30000, maxBuffer: 3_000_000 });
  const receipt = JSON.parse(stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1] ?? "null");
  receipts.push({ ...sample, ...receipt });
  assert.ok(receipt?.key && receipt.fit && receipt.flubber && receipt.lowerMoved && receipt.scrollHeight>receipt.clientHeight, JSON.stringify(receipts.at(-1)));
  assert.equal(receipt.fallback, sample.name !== "ample", JSON.stringify(receipts.at(-1)));
  if (!receipt.fallback) assert.ok(receipt.pinned && receipt.controlsHeight >= receipt.minimumControls, JSON.stringify(receipt));
}
await writeFile(join(output, "receipt.json"), JSON.stringify(receipts, null, 2));
console.log(JSON.stringify({ pass: true, cases: receipts.length, output }));
