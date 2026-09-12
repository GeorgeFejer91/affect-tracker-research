// Background-only presentation fixture; no user profile, desktop input or app runtime.
// Usage: node scripts/qualification/accordion-confirm.mjs <edge.exe> <output-dir>
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { renderResearchUiMarkup } from "../../site/src/research/ui-view.js";
import { SETUP_SECTIONS } from "../../site/src/research/ui-contracts.js";

const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination, "Provide browser executable and isolated output directory.");
const output = resolve(destination);
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, "isolated-profile-"));
const css = await readFile(new URL("../../site/research.css", import.meta.url), "utf8");
const markup = renderResearchUiMarkup("browser");
const fixture = join(output, "confirmation.html");
await writeFile(fixture, `<!doctype html><meta charset="utf-8"><title>Offscreen confirmation check</title>
<style>${css}</style><div id="research-app">${markup}</div><pre id="receipt"></pre>
<script>
(async () => {
 const rows=[];
 for (const accordion of document.querySelectorAll('[data-setup-section]')) {
  const panel=accordion.querySelector('.setup-accordion-panel');
  if(!panel) continue; // P5 is captured only by the final Section 7 save.
  if(panel) { panel.hidden=false; panel.inert=false; panel.dataset.motionState='open'; }
  const inner=panel?.querySelector('.setup-accordion-panel-inner') ?? accordion.querySelector('.preview-controls-scroll');
  const footer=inner.lastElementChild;
  const button=footer.querySelector('[data-confirm-section], #package-generate');
  const animations=button.getAnimations({subtree:true});
  animations.forEach(animation=>{animation.pause();animation.currentTime=0;});
  const peak=getComputedStyle(button,'::after');
  const bright=Number(peak.opacity), shadows=peak.boxShadow;
  animations.forEach(animation=>{animation.currentTime=1100;});
  const dim=Number(getComputedStyle(button,'::after').opacity);
  const bounds=button.getBoundingClientRect(), foot=footer.getBoundingClientRect();
  rows.push({id:accordion.dataset.setupSection,footerLast:footer.classList.contains('setup-section-confirmation'),
   rightAligned:Math.abs(bounds.right-foot.right)<2,contained:bounds.left>=foot.left-1,
   breathing:bright>dim+.4,layered:shadows!=='none'});
  animations.forEach(animation=>{animation.currentTime=0;});
  if(panel && accordion.dataset.setupSection!=='workspace') { panel.hidden=true;panel.dataset.motionState='closed'; }
 }
 document.querySelector('#receipt').textContent=JSON.stringify(rows);
})().catch(error=>document.querySelector('#receipt').textContent='ERROR:'+error.message);
</script>`);
const { stdout } = await promisify(execFile)(browser, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--window-size=1280,900", "--virtual-time-budget=3000",
  `--screenshot=${join(output, "confirmation.png")}`, "--dump-dom", pathToFileURL(fixture).href,
], { windowsHide: true, timeout: 30000, maxBuffer: 2_000_000 });
const raw = stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1];
assert.ok(raw, "No offscreen receipt.");
const receipt = JSON.parse(raw);
await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
assert.equal(receipt.length, SETUP_SECTIONS.length - 1);
for (const row of receipt) assert.ok(row.footerLast && row.rightAligned && row.contained && row.breathing && row.layered, JSON.stringify(row));
console.log(JSON.stringify({ pass: true, sections: receipt.length, output }));
