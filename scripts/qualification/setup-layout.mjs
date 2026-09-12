// Background-only real UI bootstrap and layout fixture. No desktop/browser input.
// Usage: node scripts/qualification/setup-layout.mjs <browser.exe> <output-dir>
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
const cases = [
  { name: "default", width: 1280, height: 900 },
  { name: "wide-preview", width: 1280, height: 900, sections: 432 },
  { name: "narrow-preview", width: 1280, height: 900, sections: 952 },
  { name: "compact", width: 800, height: 600 },
  { name: "limit", width: 760, height: 600 },
  { name: "stacked", width: 759, height: 700 },
  { name: "zoom-reflow", width: 640, height: 450 },
  { name: "narrow", width: 375, height: 700 },
];

function fixture(scenario) {
  return `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/site/research.css">
<div id="research-app" data-research-surface="browser"></div><script>
const errors=[];
addEventListener('error',event=>errors.push(event.message));
addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
console.error=(...args)=>errors.push(args.join(' '));
</script><script type="module">
import { bootResearchUi } from '/site/src/research/app.js';
const wait=()=>new Promise(resolve=>setTimeout(resolve,350));
try {
 const root=bootResearchUi(); const ui=root.researchUi;
 await wait();
 const settings=JSON.stringify(ui.settings);
 ui.setMode('run'); ui.setMode('setup');
 await wait();
 const form=root.querySelector('.setup-layout');
 const chosen=${JSON.stringify(scenario.sections ?? null)};
 if(chosen!==null) form.style.setProperty('--setup-sections-width',chosen+'px');
 await wait();
 const left=root.querySelector('.setup-pane'), grip=root.querySelector('[data-setup-resizer]'), right=root.querySelector('.preview-pane');
 const a=left.getBoundingClientRect(), b=grip.getBoundingClientRect(), c=right.getBoundingClientRect(), all=form.getBoundingClientRect();
 const stacked=innerWidth<760;
 const compactHeaders=left.clientWidth<=479;
 const headers=[...left.querySelectorAll('.setup-accordion-trigger')].map(trigger=>{
  const title=trigger.querySelector('.section-title'), summary=trigger.querySelector('.section-summary');
  const t=title.getBoundingClientRect(), s=summary.getBoundingClientRect(), h=trigger.getBoundingClientRect();
  return {title:title.textContent.trim(),separateRows:s.top>=t.bottom-1,
   titleLines:t.height/parseFloat(getComputedStyle(title).lineHeight),
   contained:t.left>=h.left&&t.right<=h.right&&s.left>=h.left&&s.right<=h.right&&s.bottom<=h.bottom,
   titleOverflow:title.scrollWidth-title.clientWidth,
   summaryOverflow:summary.scrollWidth-summary.clientWidth};
 });
 const receipt={name:${JSON.stringify(scenario.name)},viewport:innerWidth,stacked,
  sections:a.width,preview:c.width,divider:b.width,
  contained:stacked ? a.width<=innerWidth+1&&c.width<=innerWidth+1 : Math.abs(a.width+b.width+c.width-all.width)<1 && Math.abs(b.left-a.right)<1 && Math.abs(c.left-b.right)<1,
  minimums:stacked || (a.width>=431.9&&c.width>=319.9),
  verticalScroll:stacked || ['auto','scroll'].includes(getComputedStyle(left).overflowY),
  gripHidden:stacked ? b.width===0&&grip.tabIndex===-1 : b.width===8,
  settingsUnchanged:settings===JSON.stringify(ui.settings),
  sectionsOverflow:left.scrollWidth-left.clientWidth,
  previewOverflow:right.scrollWidth-right.clientWidth,
  compactHeaders,headers,
  errors};
 parent.postMessage(receipt,location.origin);
} catch(error) { parent.postMessage({name:${JSON.stringify(scenario.name)},errors:[String(error)]},location.origin); }
</script>`;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const scenario = cases.find(entry => entry.name === url.searchParams.get("case")) ?? cases[0];
    if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#121311}iframe{border:0;width:${scenario.width}px;height:${scenario.height}px}pre{display:none}</style>
<iframe src="/fixture?case=${scenario.name}" title="Isolated layout fixture"></iframe><pre id="receipt"></pre>
<script>addEventListener('message',event=>{if(event.origin===location.origin)document.querySelector('#receipt').textContent=JSON.stringify(event.data)});</script>`);
    } else if (url.pathname === "/fixture") {
      response.setHeader("Content-Type", "text/html"); response.end(fixture(scenario));
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
  for (const scenario of cases) {
    const profile = await mkdtemp(join(output, "isolated-profile-"));
    const { stdout } = await promisify(execFile)(browser, [
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      `--user-data-dir=${profile}`, "--window-size=1280,1000", "--virtual-time-budget=5000",
      `--screenshot=${join(output, scenario.name + ".png")}`, "--dump-dom",
      `http://127.0.0.1:${server.address().port}/?case=${scenario.name}`,
    ], { windowsHide: true, timeout: 30000, maxBuffer: 2_000_000 });
    const raw = stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1];
    assert.ok(raw, `No offscreen receipt: ${scenario.name}`);
    rows.push(JSON.parse(raw.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&gt;", ">").replaceAll("&lt;", "<")));
  }
  await writeFile(join(output, "receipt.json"), JSON.stringify(rows, null, 2));
  for (const row of rows) {
    assert.deepEqual(row.errors, [], JSON.stringify(row));
    assert.ok(row.contained && row.minimums && row.verticalScroll && row.gripHidden && row.settingsUnchanged && row.sectionsOverflow === 0 && row.previewOverflow === 0, JSON.stringify(row));
    assert.ok(row.headers.length>0 && row.headers.every(header=>header.contained && header.separateRows===row.compactHeaders &&
      (!row.compactHeaders || (header.titleLines<=1.05 && header.titleOverflow===0 && header.summaryOverflow===0))), JSON.stringify(row));
  }
  console.log(JSON.stringify({ pass: true, cases: rows.length, output, rows }));
} finally { server.close(); }
