// Optional, off-screen SVG paint check. Never attaches to a user's browser.
// Usage: node scripts/qualification/preview-tile-paint.mjs <edge.exe> <output-dir>
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { renderResearchUiMarkup } from "../../site/src/research/ui-view.js";
import { previewTileGeometry, previewTileLines } from "../../site/src/research/preview-tiles.js";

const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination, "Provide a browser executable and an isolated output directory.");
const output = resolve(destination);
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, "isolated-profile-"));
const svg = renderResearchUiMarkup("browser").match(/<svg data-preview-control-grid[\s\S]*?<\/svg>/u)?.[0];
assert.ok(svg);
const cases = [3, 9, 21].flatMap(count => [180, 360].map(size => ({
  count, size, path: previewTileLines(count),
  tile: previewTileGeometry(count === 21 ? 1 : 0, count === 21 ? -1 : 0, count),
})));
const html = `<!doctype html><meta charset="utf-8"><title>Off-screen tile paint regression</title>
<style>body{background:#151714;color:white;font:14px sans-serif}main{display:flex;flex-wrap:wrap;gap:20px}svg{background:#477367}</style>
<main></main><pre id="receipt">pending</pre><script>
const cases=${JSON.stringify(cases)};
const source=${JSON.stringify(svg)};
(async () => {
 const receipts=[];
 for (const sample of cases) {
  const section=document.createElement('section');
  section.innerHTML='<p>'+sample.count+' tiles / '+sample.size+'px, no tile CSS</p>'+source;
  document.querySelector('main').append(section);
  const svg=section.querySelector('svg');
  svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
  svg.setAttribute('width',sample.size); svg.setAttribute('height',sample.size);
  svg.querySelector('[data-preview-control-cursor]').remove();
  svg.querySelector('[data-preview-control-outline]').remove();
  const lines=svg.querySelector('[data-preview-tile-lines]');
  lines.setAttribute('d',sample.path); lines.setAttribute('stroke-width',Math.min(.4,8/sample.count));
  const stroke=Math.min(1.1,sample.tile.width*.12);
  for (const rect of svg.querySelectorAll('[data-preview-active-tile] rect')) {
   rect.setAttribute('x',sample.tile.x+stroke); rect.setAttribute('y',sample.tile.y+stroke);
   rect.setAttribute('width',sample.tile.width-2*stroke); rect.setAttribute('height',sample.tile.height-2*stroke);
   rect.setAttribute('stroke-width',stroke*(rect.dataset.previewTileEdge==='contrast'?2:1));
  }
  const image=new Image();
  image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));
  await image.decode();
  const canvas=document.createElement('canvas'); canvas.width=canvas.height=sample.size;
  const context=canvas.getContext('2d'); context.drawImage(image,0,0);
  const pixels=context.getImageData(0,0,sample.size,sample.size).data;
  const alpha=(x,y)=>pixels[(Math.floor(y)*sample.size+Math.floor(x))*4+3];
  const centerX=(sample.tile.x+sample.tile.width/2)*sample.size/100;
  const centerY=(sample.tile.y+sample.tile.height/2)*sample.size/100;
  let gridInk=0;
  const boundary=sample.size/sample.count;
  for(let x=Math.floor(boundary)-1;x<=Math.ceil(boundary)+1;x++) gridInk+=alpha(x,boundary/2);
  let outlineInk=0;
  const edgeX=(sample.tile.x+stroke)*sample.size/100;
  for(let x=Math.max(0,Math.floor(edgeX)-1);x<=Math.ceil(edgeX)+1;x++) outlineInk+=alpha(x,centerY);
  receipts.push({count:sample.count,size:sample.size,gridVisible:gridInk>0,outlineVisible:outlineInk>0,interiorTransparent:alpha(centerX,centerY)===0});
 }
 document.getElementById('receipt').textContent=JSON.stringify(receipts);
})().catch(error=>document.getElementById('receipt').textContent='ERROR:'+error.message);
</script>`;
const fixture = join(output, "tile-paint.html");
await writeFile(fixture, html);
const { stdout } = await promisify(execFile)(browser, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--window-size=1200,1000", "--virtual-time-budget=4000",
  `--screenshot=${join(output, "tile-paint.png")}`, "--dump-dom", pathToFileURL(fixture).href,
], { windowsHide: true, timeout: 30000, maxBuffer: 2_000_000 });
const raw = stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1];
assert.ok(raw && raw !== "pending", "Background browser did not finish the paint receipt.");
const receipt = JSON.parse(raw);
await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
assert.equal(receipt.length, cases.length);
for (const result of receipt) {
  assert.ok(result.gridVisible && result.outlineVisible && result.interiorTransparent, JSON.stringify(result));
}
console.log(JSON.stringify({ pass: true, cases: receipt.length, output }));
