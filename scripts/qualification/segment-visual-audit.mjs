// Actual app screenshots in fresh headless browser profiles; no desktop input.
// Usage: node scripts/qualification/segment-visual-audit.mjs <browser.exe> <output-dir> [source-root] [section-ids]
// This is an observation harness, not a backend or visual-quality certification.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const [browser, destination, sourceArgument, selectedArgument] = process.argv.slice(2);
assert.ok(browser && destination, "Provide a browser executable and output directory.");
const execute = promisify(execFile);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const harnessSha256 = sha256(await readFile(new URL(import.meta.url)));
const source = resolve(sourceArgument ?? join(import.meta.dirname, "../.."));
const output = resolve(destination);
const site = join(source, "site");
await mkdir(output, { recursive: true });
assert.equal((await readdir(output)).length, 0, "Use a fresh empty output directory; preserve earlier receipts.");
const git = async (...args) => (await execute("git", ["-C", source, ...args], { windowsHide: true })).stdout.trim();
const sourceCommit = await git("rev-parse", "HEAD");
const sourceChanges = await git("status", "--porcelain", "--", "site");
assert.equal(sourceChanges, "", "Capture only a clean application source snapshot.");
const { SETUP_SECTIONS } = await import(pathToFileURL(join(site, "src/research/ui-contracts.js")));
const sections = SETUP_SECTIONS.filter(({ id }) => !selectedArgument || selectedArgument.split(",").includes(id));
assert.ok(sections.length, "No requested sections exist in this source.");
const viewports = [{ name: "desktop", width: 1280, height: 900 }, { name: "narrow-pane", width: 800, height: 700 }];
const captureReceipts = new Map();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForCapture(name, screenshot) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const capture = captureReceipts.get(name);
    const png = await readFile(screenshot).catch(() => null);
    // The launcher can exit before the browser; require a complete fresh PNG.
    if (capture && png?.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
      && png.subarray(-12).toString("hex") === "0000000049454e44ae426082") return capture;
    await delay(100);
  }
  throw new Error(`No page receipt and complete PNG within 30 seconds: ${name}`);
}

function fixture(scenario) {
  return `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/site/research.css">
<div id="research-app" data-research-surface="browser"></div><pre id="receipt" hidden></pre>
<script>const errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));console.error=(...a)=>errors.push(a.join(' '));</script>
<script type="module">
import { bootResearchUi } from '/site/src/research/app.js';
const scenario=${JSON.stringify(scenario)};
const wait=()=>new Promise(resolve=>setTimeout(resolve,500));
try {
 const root=bootResearchUi(); const ui=root.researchUi; await wait();
 if(ui.openSection!==scenario.section) ui.openSetupSection(scenario.section);
 await wait();
 const section=root.querySelector('[data-setup-section="'+scenario.section+'"]');
 const persistent=section.matches('.preview-pane');
 const settings=section.querySelector('.preview-controls-scroll');
 const settingsScrolls=settings&&['auto','scroll'].includes(getComputedStyle(settings).overflowY)&&settings.scrollHeight>settings.clientHeight+1;
 const pane=persistent?(settingsScrolls?settings:section):root.querySelector('.setup-pane');
 const top=persistent?0:section.getBoundingClientRect().top-pane.getBoundingClientRect().top+pane.scrollTop;
 pane.scrollTop=top+scenario.page*Math.max(200,pane.clientHeight-80);
 await wait();
 const rect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
 const shown=element=>element.checkVisibility()&&getComputedStyle(element).visibility!=='hidden';
 const ids=Array.from(root.querySelectorAll('[id]'),e=>e.id);
 const controls=Array.from(section.querySelectorAll('button,input,select,textarea,summary')).filter(shown).map(e=>({
  tag:e.tagName.toLowerCase(),id:e.id,type:e.getAttribute('type'),text:(e.innerText||e.getAttribute('aria-label')||e.labels?.[0]?.innerText||'').trim(),
  disabled:!!e.disabled,rect:rect(e),fontSize:getComputedStyle(e).fontSize,
 }));
 const bounds=pane.getBoundingClientRect();
 const visibleControls=controls.filter(e=>e.rect.y+e.rect.height>bounds.top&&e.rect.y<bounds.bottom);
 const overflowing=Array.from(section.querySelectorAll('*')).filter(shown).filter(e=>{
  const r=e.getBoundingClientRect();return r.width>0&&(r.left<bounds.left-1||r.right>bounds.right+1);
 }).slice(0,30).map(e=>({tag:e.tagName,id:e.id,className:String(e.className),rect:rect(e)}));
 const receipt={...scenario,sourceCommit:${JSON.stringify(sourceCommit)},dataState:'Actual app default state; no synthetic media or accepted contributions injected',
  openSection:ui.openSection,panelMotion:persistent?'persistent':section.querySelector('.setup-accordion-panel').dataset.motionState,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
  viewport:{width:innerWidth,height:innerHeight},pane:rect(pane),sectionRect:rect(section),
  sectionHeight:persistent?pane.scrollHeight:section.getBoundingClientRect().height,pageStride:Math.max(200,pane.clientHeight-80),scrollTop:pane.scrollTop,scrollSurface:persistent?(settingsScrolls?'preview-settings':'preview-pane'):'setup-pane',
  sectionsOverflow:root.querySelector('.setup-pane').scrollWidth-root.querySelector('.setup-pane').clientWidth,previewOverflow:root.querySelector('.preview-pane').scrollWidth-root.querySelector('.preview-pane').clientWidth,
  duplicateIds:ids.filter((id,i)=>ids.indexOf(id)!==i),controls,visibleControls,overflowing,errors};
 parent.postMessage(receipt,location.origin);
}catch(error){parent.postMessage({...scenario,errors:[String(error)]},location.origin);}
</script>`;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/capture-receipt" && request.method === "POST") {
      const chunks = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; assert.ok(bytes <= 3000000); chunks.push(chunk); }
      const capture = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const name = `${capture.receipt.name}-${capture.receipt.section}-${capture.receipt.page + 1}`;
      captureReceipts.set(name, capture);
      response.writeHead(204); response.end();
    } else if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      const scenario = JSON.parse(url.searchParams.get("case"));
      const viewport = viewports.find(entry => entry.name === scenario.name);
      response.end(`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#121311}iframe{border:0;width:${viewport.width}px;height:${viewport.height}px}pre{display:none}</style>
<iframe src="/fixture?case=${encodeURIComponent(JSON.stringify(scenario))}" title="Actual app visual audit"></iframe><pre id="receipt" hidden></pre>
<script>addEventListener('message',e=>{if(e.origin!==location.origin)return;document.querySelector('#receipt').textContent=JSON.stringify(e.data);fetch('/capture-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({receipt:e.data,html:document.documentElement.outerHTML})});});</script>`);
    } else if (url.pathname === "/fixture") {
      response.setHeader("Content-Type", "text/html");
      response.end(fixture(JSON.parse(url.searchParams.get("case"))));
    } else if (url.pathname.startsWith("/site/")) {
      const file = resolve(site, "." + decodeURIComponent(url.pathname.slice(5)));
      assert.ok(file.startsWith(site + sep));
      response.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".csv": "text/csv" })[extname(file)] ?? "application/octet-stream");
      response.end(await readFile(file));
    } else { response.writeHead(404); response.end(); }
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const rows = [];
try {
  for (const viewport of viewports) {
    for (const section of sections) {
      let pages = 1;
      for (let page = 0; page < pages; page += 1) {
        const scenario = { name: viewport.name, section: section.id, label: section.label, page };
        const name = `${viewport.name}-${section.id}-${page + 1}`;
        const screenshot = join(output, name + ".png");
        const previous = await stat(screenshot).catch(error => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        assert.equal(previous, null, `Use a fresh output directory; screenshot already exists: ${name}`);
        const profile = await mkdtemp(join(output, "isolated-profile-"));
        const { stdout, stderr } = await execute(browser, [
          "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
          `--user-data-dir=${profile}`, "--window-size=1280,1000", "--force-prefers-reduced-motion",
          "--force-device-scale-factor=1", "--virtual-time-budget=4000", `--screenshot=${join(output, name + ".png")}`,
          "--dump-dom", `http://127.0.0.1:${server.address().port}/?case=${encodeURIComponent(JSON.stringify(scenario))}`,
        ], { windowsHide: true, timeout: 30000, maxBuffer: 3_000_000 });
        const captured = await waitForCapture(name, screenshot);
        await writeFile(join(output, name + ".html"), captured.html);
        await writeFile(join(output, name + ".launcher.json"), JSON.stringify({stdoutLength:stdout.length,stderrLength:stderr.length}));
        const row = captured.receipt;
        assert.equal(row.sourceCommit, sourceCommit, `Wrong source receipt: ${name}`);
        assert.equal(row.openSection, section.id, `Wrong active section: ${name}`);
        assert.equal(row.panelMotion, section.id === "feedback" && row.scrollSurface?.startsWith("preview-") ? "persistent" : "open", `Unsettled panel: ${name}`);
        assert.equal(row.reducedMotion, true, "Static capture requires the actual reduced-motion app path.");
        rows.push({ screenshot, screenshotSha256: sha256(await readFile(screenshot)), ...row });
        if (page === 0 && row.sectionHeight) pages = Math.max(1, Math.ceil((row.sectionHeight - 80) / row.pageStride));
        console.log(JSON.stringify({ name, pages, errors: row.errors, overflow: [row.sectionsOverflow, row.previewOverflow] }));
      }
    }
  }
} finally {
  server.close();
  const finalCommit = await git("rev-parse", "HEAD");
  const finalChanges = await git("status", "--porcelain", "--", "site");
  const stableSource = finalCommit === sourceCommit && finalChanges === sourceChanges;
  await writeFile(join(output, "receipt.json"), JSON.stringify({ source, sourceCommit, stableSource, harnessSha256, browser, sections, viewports, rows }, null, 2));
  assert.ok(stableSource, "Application source changed during capture; discard this receipt.");
}
console.log(JSON.stringify({ sourceCommit, screenshots: rows.length, output, runtimeErrors: rows.filter(row => row.errors.length).length }));
