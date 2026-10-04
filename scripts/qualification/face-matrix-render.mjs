import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination, "Usage: node face-matrix-render.mjs BROWSER OUTPUT_DIR");
const root = resolve(import.meta.dirname, "../..");
const output = resolve(destination);
await mkdir(output, { recursive: true });
const source = String.raw`
import { faceAtlasCatalogue, drawFaceAtlas } from './site/src/research/face-atlas.js';
const checks = [], errors = [];
addEventListener('error', event => errors.push(event.message));
addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
addEventListener('load', () => {
try {
  const packs = faceAtlasCatalogue().packs;
  if (packs.length !== 9) throw new Error('Expected nine selectable packs');
  const picker = document.querySelector('select');
  for (const pack of packs) {
    const option = document.createElement('option'); option.value = pack.id; option.textContent = pack.label;
    picker.append(option);
    const card = document.createElement('article');
    card.innerHTML = '<canvas width="240" height="240"></canvas><p></p>';
    card.querySelector('p').textContent = pack.label;
    document.querySelector('main').append(card);
    const image = document.querySelector('img[data-pack-id="' + pack.id + '"]');
    if (image.naturalWidth !== 3360) throw new Error(pack.id + ' failed to decode');
    const canvas = card.querySelector('canvas'), context = canvas.getContext('2d');
    drawFaceAtlas(context, image, 0.25, -0.35, canvas.width);
    if (context.getImageData(120, 120, 1, 1).data[3] === 0) throw new Error(pack.id + ' is blank');
    picker.value = pack.id;
    if (picker.value !== pack.id) throw new Error(pack.id + ' cannot be selected');
    checks.push(pack.id + ' verified, selected, and painted');
  }
  picker.value = packs[0].id;
  if (document.documentElement.scrollWidth > innerWidth) throw new Error('Horizontal overflow');
} catch (error) { errors.push(String(error)); }
const receipt = document.createElement('pre'); receipt.id = 'receipt'; receipt.hidden = true;
receipt.textContent = JSON.stringify({checks,errors}); document.body.append(receipt);
});
`;
const built = await build({ stdin: { contents: source, resolveDir: root, sourcefile: "face-matrix-fixture.js" },
  bundle: true, format: "esm", platform: "browser", write: false });
const catalogue = JSON.parse(await readFile(resolve(root, "site/assets/affect-face/photo-atlas-packs-v1.json")));
const images = catalogue.packs.map(pack => `<img hidden data-pack-id="${pack.id}" src="/assets/affect-face/${pack.atlas}">`).join("");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:24px;background:#171917;color:#f5f5f1;font:16px Arial,sans-serif}header{display:flex;align-items:center;gap:16px;margin-bottom:20px}h1{font-size:24px;margin:0}select{font:inherit;padding:10px;min-width:190px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}article{min-width:0;background:#252924;padding:12px;border:1px solid #454b42}canvas{display:block;width:100%;aspect-ratio:1;object-fit:contain}p{margin:10px 0 0}@media(max-width:700px){main{grid-template-columns:1fr 1fr}}</style><header><h1>21 × 21 face packs</h1><label>Portrait <select></select></label></header><main></main>${images}<script type="module" src="/fixture.js"></script></html>`;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end(html); return; }
    if (url.pathname === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(built.outputFiles[0].text); return; }
    if (!url.pathname.startsWith("/assets/")) { response.writeHead(404).end(); return; }
    const path = resolve(root, "site", `.${url.pathname}`);
    if (!path.startsWith(resolve(root, "site/assets") + sep)) { response.writeHead(403).end(); return; }
    response.setHeader("Content-Type", "image/webp"); response.end(await readFile(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise(ready => server.listen(0, "127.0.0.1", ready));
try {
  const profile = await mkdtemp(join(output, "browser-"));
  const { stdout } = await promisify(execFile)(browser, ["--headless=new", "--disable-gpu", "--no-first-run",
    "--no-default-browser-check", `--user-data-dir=${profile}`, "--window-size=1100,1450",
    "--force-device-scale-factor=1", "--virtual-time-budget=18000",
    `--screenshot=${join(output, "nine-face-packs.png")}`, "--dump-dom", `http://127.0.0.1:${server.address().port}/`],
  { windowsHide: true, timeout: 45000, maxBuffer: 3_000_000 });
  await writeFile(join(output, "dom.html"), stdout);
  const raw = stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1];
  assert.ok(raw, "Browser receipt missing");
  const receipt = JSON.parse(raw.replaceAll("&quot;", '"').replaceAll("&amp;", "&"));
  await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  assert.deepEqual(receipt.errors, []);
  assert.equal(receipt.checks.length, 9);
  console.log(JSON.stringify(receipt));
} finally { server.close(); }
