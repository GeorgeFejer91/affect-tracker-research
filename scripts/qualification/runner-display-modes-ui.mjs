// Synthetic renderer evidence for the three saved master5 feedback choices.
// This does not simulate native playback, sampling, LSL, or XDF output.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination, "Usage: node runner-display-modes-ui.mjs CHROME EXCLUSIVE_OUTPUT_DIR");
const projectRoot = resolve(import.meta.dirname, "../..");
const output = resolve(destination);
await mkdir(output);
const source = String.raw`
import { createResearchPreview } from './site/src/research/preview.js';
import { previewOverlayMarkup } from './site/src/research/feedback-surface.js';
import { runnerMasterFeedbackState } from './runner/src/recipe.js';
const checks = [], errors = [];
const check = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
addEventListener('error', event => errors.push(event.message));
addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
try {
  const recipe = await (await fetch('/test/fixtures/planner-recipe-v5.canonical.json')).json();
  check(recipe.version === 5, 'current master5 fixture');
  for (const renderer of ['flubber', 'grid', 'face']) {
    const feedback = structuredClone(recipe.segments.P5);
    feedback.presentation.renderer = renderer;
    const card = document.createElement('section');
    card.className = 'mode-card';
    card.innerHTML = '<h2></h2><div class="research-preview-stage" data-preview-variant="studio"></div>';
    card.querySelector('h2').textContent = renderer;
    document.querySelector('main').append(card);
    const stage = card.querySelector('.research-preview-stage');
    stage.innerHTML = previewOverlayMarkup({includeFace:true});
    const preview = createResearchPreview(stage, {initialState:{hideFeedback:true,lockPosition:true}});
    const state = runnerMasterFeedbackState(feedback, 0.7, -0.4);
    check(state.displayMode === renderer, renderer + ' is carried from saved P5 renderer');
    preview.update(state);
    const overlay = stage.querySelector('[data-preview-overlay]');
    const visible = ['flubber','grid','face'].filter(name => {
      const node = stage.querySelector('[data-preview-' + name + ']');
      return node && !node.hasAttribute('hidden') && getComputedStyle(node).display !== 'none';
    });
    check(!overlay.hidden, renderer + ' feedback visible');
    check(visible.length === 1 && visible[0] === renderer, renderer + ' is the only displayed renderer');
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  check((document.querySelector('.mode-card [data-preview-flubber-base]').getAttribute('d') ?? '').length > 100, 'Flubber path is drawn');
  check(document.querySelector('.mode-card:last-child [data-preview-face-mouth-shape]')?.getAttribute('d')?.length > 10, 'face expression is drawn');
  check(document.documentElement.scrollWidth <= innerWidth, 'no horizontal overflow');
} catch (error) { errors.push(String(error)); }
const receipt = document.createElement('pre'); receipt.id = 'receipt'; receipt.hidden = true;
receipt.textContent = JSON.stringify({checks, errors, viewport:[innerWidth,innerHeight],scope:'Synthetic master5 frontend renderer only'});
document.body.append(receipt);
`;
const built = await build({ stdin: { contents: source, resolveDir: projectRoot, sourcefile: "runner-display-modes-fixture.js" }, bundle: true, format: "esm", platform: "browser", write: false });
const bundle = built.outputFiles[0].text;
const css = await readFile(join(projectRoot, "site/research.css"), "utf8");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}\nbody{margin:0;background:#111310;color:#f2f2ee;font:16px system-ui}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;padding:24px}.mode-card{min-width:0}.mode-card h2{font-size:18px;text-transform:capitalize}.mode-card .research-preview-stage{width:100%;height:min(34vw,500px);min-height:0;border:1px solid #474b43}.mode-card .research-preview-stage::after{display:none}@media(max-width:760px){main{grid-template-columns:1fr}.mode-card .research-preview-stage{height:70vw}}</style><main></main><script type="module" src="/bundle.js"></script></html>`;
const serve = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); return; }
    if (path === "/bundle.js") { response.setHeader("Content-Type", "application/javascript"); response.end(bundle); return; }
    const file = resolve(projectRoot, `.${decodeURIComponent(path)}`);
    if (!file.startsWith(projectRoot + sep)) { response.writeHead(403).end(); return; }
    response.setHeader("Content-Type", extname(file) === ".json" ? "application/json" : "application/octet-stream");
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => serve.listen(0, "127.0.0.1", resolve));
try {
  const profile = await mkdtemp(join(output, "chrome-"));
  const { stdout } = await promisify(execFile)(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--window-size=1600,760", "--force-device-scale-factor=1", "--virtual-time-budget=5000", `--screenshot=${join(output, "three-modes.png")}`, "--dump-dom", `http://127.0.0.1:${serve.address().port}/`], { windowsHide: true, timeout: 30000, maxBuffer: 4_000_000 });
  await writeFile(join(output, "three-modes.html"), stdout);
  const raw = stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1];
  assert.ok(raw, "Renderer receipt missing");
  const receipt = JSON.parse(raw.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">"));
  await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  assert.deepEqual(receipt.errors, []);
  console.log(JSON.stringify(receipt));
} finally { serve.close(); }
