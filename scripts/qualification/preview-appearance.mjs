// Isolated background UI fixture. Never attaches to an existing app/profile.
// node scripts/qualification/preview-appearance.mjs <edge.exe> <output-dir>
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { build } from "esbuild";

const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination);
const output = resolve(destination);
await mkdir(output, { recursive: true });
const css = await readFile(new URL("../../site/research.css", import.meta.url), "utf8");
const bundle = await build({ write: false, bundle: true, format: "esm", stdin: {
  resolveDir: fileURLToPath(new URL("../../", import.meta.url)), contents: `
import {bootResearchUi} from './site/src/research/app.js';
window.checkAppearance=async()=>{
 const errors=[];window.addEventListener('error',event=>errors.push(event.message));
 const root=bootResearchUi(),q=selector=>root.querySelector(selector),receipts=[];
 const check=(name,pass)=>{receipts.push({name,pass:!!pass});if(!pass)throw Error(name);};
 const input=(id,value)=>{const element=q('#'+id);element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));};
 const colors=()=>['up','right','down','left'].map(id=>q('#color-'+id+'-hex').value);
 const pixels=()=>q('#main-gradient-canvas').getContext('2d').getImageData(0,0,72,72).data;
 const allGrey=()=>pixels().every((value,index)=>value===(index%4===3?255:183));
 q('#preview-response-reset').click();
 check('reset all saved anchor controls and entire axes field to grey',colors().every(c=>c==='#b7b7b7')&&q('#color-idle-hex').value==='#b7b7b7'&&allGrey());
 q('input[name=previewColorAnchors][value=corners]').click();
 check('corner mode keeps neutral field entirely grey',allGrey()&&q('.preview-affect-map').dataset.colorAnchorMode==='corners');
 check('corner labels move to corner layout',q('[data-color-anchor=up]').textContent.includes('Upper left')&&getComputedStyle(q('.preview-affect-map-layout')).gridTemplateAreas.includes('up . right'));
 const pane=q('.preview-pane');
 for(const width of [320,680]) {
  pane.style.width=width+'px';const bounds=pane.getBoundingClientRect();
  check('corner controls fit '+width+'px pane',[...pane.querySelectorAll('[data-color-anchor],.preview-control-surface,.preview-anchor-modes')].every(element=>{const box=element.getBoundingClientRect();return box.left>=bounds.left-1&&box.right<=bounds.right+1;}));
 }
 pane.style.removeProperty('width');
 q('#preview-recolor').click();
 check('recolor sets four valid distinct-from-grey anchor values',colors().every(c=>/^#[0-9a-f]{6}$/.test(c))&&colors().some(c=>c!=='#b7b7b7'));
 const pixelsNow=pixels(),rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
 for(const [id,offset] of [['up',0],['right',71*4],['down',(72*72-1)*4],['left',71*72*4]]) {
  check('painted '+id+' corner matches anchor',rgb(q('#color-'+id+'-hex').value).every((v,i)=>v===pixelsNow[offset+i]));
 }
 q('[data-color-anchor=up]').click();
 check('inline picker opens in the same dialog',q('#preview-color-dialog').open&&q('#preview-color-dialog-title').textContent.includes('Upper left')&&!q('#preview-color-dialog input[type=color]'));
 q('#preview-color-cancel').click();
 const halo=q('[data-preview-flubber-halo]'),falloff=q('[data-preview-halo-falloff]');
 input('preview-halo-size','350');
 const width=halo.style.strokeWidth;
 check('numeric width accepts values beyond old slider maximum',Number(width)===21);
 input('preview-halo-steepness','4');
 check('steepness changes alpha falloff without width or scale change',falloff.getAttribute('exponent')==='4'&&halo.style.strokeWidth===width&&halo.getAttribute('transform')==='scale(1)');
 q('#preview-halo-gradient').click();
 check('gradient off keeps solid contour halo',halo.getAttribute('filter')==='none'&&halo.style.strokeWidth===width&&q('#preview-halo-steepness').disabled);
 q('#preview-halo-gradient').click();
 check('gradient on restores outward fade',halo.getAttribute('filter')==='url(#preview-studio-halo-fade)'&&!q('#preview-halo-steepness').disabled);
 input('preview-halo-size','');
 check('invalid draft retains last accepted drawing',q('#preview-halo-size').getAttribute('aria-invalid')==='true'&&halo.style.strokeWidth===width);
 input('preview-halo-size','1e100');
 check('extreme finite width has visible rendering-cap feedback',q('#preview-halo-help').textContent.includes('rendered at 10000%')&&Number(halo.style.strokeWidth)===600);
 input('preview-halo-size','0');check('zero width hides halo',halo.hasAttribute('hidden'));
 input('preview-halo-size','150');input('preview-halo-steepness','1');
 q('#preview-response-reset').click();check('reset after recolor greys whole corner map',allGrey());
 q('input[name=previewColorAnchors][value=axes]').click();
 check('switch back restores axis identity',q('[data-color-anchor=up]').textContent.includes('High arousal'));
 q('input[name=previewColorAnchors][value=corners]').click();q('#preview-recolor').click();
 check('no runtime errors',errors.length===0);
 document.getElementById('receipt').textContent=JSON.stringify({pass:true,receipts});
};` } });
const fixture = join(output, "appearance.html");
await writeFile(fixture, `<!doctype html><meta charset="utf-8"><style>${css}\n#receipt{display:none}</style><div id="research-app" data-research-surface="browser"></div><pre id="receipt">pending</pre><script type="module">${bundle.outputFiles[0].text}\ncheckAppearance().catch(error=>document.getElementById('receipt').textContent=JSON.stringify({pass:false,error:error.stack}));</script>`);
const profile = await mkdtemp(join(output, "isolated-profile-"));
const { stdout } = await promisify(execFile)(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--window-size=1500,1100", "--virtual-time-budget=3000", `--screenshot=${join(output, "appearance.png")}`, "--dump-dom", pathToFileURL(fixture).href], { windowsHide: true, timeout: 30000, maxBuffer: 5_000_000 });
const receipt = JSON.parse(stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1] ?? "null");
await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
assert.ok(receipt?.pass, JSON.stringify(receipt));
console.log(JSON.stringify({ pass: true, checks: receipt.receipts.length, output }));
