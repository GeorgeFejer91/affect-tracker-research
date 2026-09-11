// Isolated, off-screen component receipt; never controls the user's browser.
// Usage: node scripts/qualification/inline-color-picker.mjs <edge.exe> <output-dir>
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { renderResearchUiMarkup } from "../../site/src/research/ui-view.js";

const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination);
const output = resolve(destination);
await mkdir(output, { recursive: true });
const source = (await readFile(new URL("../../site/src/research/inline-color-picker.js", import.meta.url), "utf8")).replace(/^export /gmu, "");
const css = await readFile(new URL("../../site/research.css", import.meta.url), "utf8");
const dialog = renderResearchUiMarkup("browser").match(/<dialog id="preview-color-dialog"[\s\S]*?<\/dialog>/u)?.[0];
assert.ok(dialog);
const receipts = [];
for (const width of [760, 1000]) {
  const profile = await mkdtemp(join(output, "isolated-profile-"));
  const fixture = join(output, `picker-${width}.html`);
  await writeFile(fixture, `<!doctype html><meta charset="utf-8"><style>${css}</style>${dialog}<pre id="receipt">pending</pre><script>
${source}
try {
 const dialog=document.querySelector('dialog'); dialog.showModal();
 const root=document.getElementById('preview-color-picker');
 const map=root.querySelector('canvas'); const hue=root.querySelector('input');
 const hex=document.getElementById('preview-color-hex'); let changes=0;
 const picker=createInlineColorPicker(root,{onChange:color=>{changes++;hex.value=color;picker.setColor(color);}});
 picker.setColor('#2f80ed');hex.value='#2f80ed';
 const ctx=map.getContext('2d'), pixel=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);
 const top=pixel(1,1), bottom=pixel(160,208), blue=pixel(318,1);
 const paint=top.slice(0,3).every(x=>x>245)&&bottom.slice(0,3).every(x=>x<5)&&blue[2]>240;
 hue.value='120'; hue.dispatchEvent(new Event('input',{bubbles:true}));
 const key=new KeyboardEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true,cancelable:true});map.dispatchEvent(key);
 const input=changes===2&&key.defaultPrevented&&/^#[0-9a-f]{6}$/.test(hex.value);
 picker.setColor('#2f80ed');hex.value='#2f80ed';
 const rect=map.getBoundingClientRect(), box=dialog.getBoundingClientRect();
 const fits=rect.width>100&&rect.left>=box.left&&rect.right<=box.right&&dialog.scrollWidth<=dialog.clientWidth+1&&box.left>=0&&box.right<=innerWidth;
 picker.destroy();map.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown'}));
 document.getElementById('receipt').textContent=JSON.stringify({width:${width},paint,input,fits,cleanup:changes===2,nativePicker:!!dialog.querySelector('input[type=color]')});
} catch(error) {document.getElementById('receipt').textContent=JSON.stringify({error:error.message});}
</script>`);
  const { stdout } = await promisify(execFile)(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--window-size=${width},900`, "--virtual-time-budget=3000", `--screenshot=${join(output, `picker-${width}.png`)}`, "--dump-dom", pathToFileURL(fixture).href], { windowsHide: true, timeout: 30000, maxBuffer: 2_000_000 });
  const receipt = JSON.parse(stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1] ?? "null");
  receipts.push(receipt);
  assert.ok(receipt?.paint && receipt.input && receipt.fits && receipt.cleanup && !receipt.nativePicker, JSON.stringify(receipt));
}
await writeFile(join(output, "receipt.json"), JSON.stringify(receipts, null, 2));
console.log(JSON.stringify({ pass: true, cases: receipts.length, output }));
