// Isolated headless Planner renderer; synthetic P1 geometry, no native transport.
// node scripts/qualification/screen-layout-cli-parity.mjs <browser.exe> <new-output-dir> [source-root] [--require-integrated] [--allow-dirty]
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join, extname, sep } from "node:path";
import { promisify } from "node:util";

const args = process.argv.slice(2), positional = args.filter(arg => !arg.startsWith("--"));
const [browser, folder, sourceArg] = positional;
assert.ok(browser && folder, "Provide a browser executable and fresh output directory.");
assert.ok(args.filter(arg => arg.startsWith("--")).every(arg => ["--require-integrated", "--allow-dirty"].includes(arg)));
const source = resolve(sourceArg ?? resolve(import.meta.dirname, "../..")), output = resolve(folder);
const requireIntegrated = args.includes("--require-integrated"), allowDirty = args.includes("--allow-dirty");
const run = promisify(execFile), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = async argv => (await run("git", argv, { cwd: source, windowsHide: true })).stdout.trim();
const commit = await git(["rev-parse", "HEAD"]), status = await git(["status", "--short"]);
assert.ok(allowDirty || !status, "Freeze a clean source checkout, or explicitly label a development run --allow-dirty.");
await mkdir(output); // Preserve every earlier receipt, including failed attempts.
const fixturePath = resolve(import.meta.dirname, "screen-layout-cli-parity-fixture.js");
const fixtureBytes = await readFile(fixturePath), harnessBytes = await readFile(new URL(import.meta.url));
const cataloguePath = join(source, "test/fixtures/research-video-catalogue-contribution-v1.json");
const catalogueBytes = await readFile(cataloguePath), catalogue = JSON.parse(catalogueBytes);
const cases = [
  { name: "wide-overview", width: 1440, policy: "largest-oriented-area", view: "overview" },
  { name: "wide-controls", width: 1440, policy: "largest-oriented-area", view: "controls" },
  { name: "wide-placement", width: 1440, policy: "largest-oriented-area", view: "placement" },
  { name: "narrow-overview", width: 820, policy: "maximum-oriented-dimensions", view: "overview" },
  { name: "narrow-controls", width: 820, policy: "maximum-oriented-dimensions", view: "controls" },
  { name: "narrow-placement", width: 820, policy: "maximum-oriented-dimensions", view: "placement" },
];
const served = new Map(), rows = [], token = randomUUID(), receipts = new Map();
// Edge's launcher can exit before its isolated headless child. Keep the server
// alive until both the HTTP completion receipt and complete PNG have arrived.
async function waitForCapture(name) {
  const deadline = Date.now() + 55000;
  while (Date.now() < deadline) {
    const bytes = await readFile(join(output, name + ".png")).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (receipts.has(name) && bytes?.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
      && bytes.subarray(-12).toString("hex") === "0000000049454e44ae426082") return receipts.get(name);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("No completed HTTP receipt and PNG: " + name);
}
const fixture = scenario => `<!doctype html><html lang="en"><meta charset="utf-8"><link rel="stylesheet" href="/site/research.css">
<div id="research-app" data-research-surface="browser" data-research-program="planner"></div>
<script id="p4-test-config" type="application/json">${JSON.stringify({ ...scenario, catalogue, requireIntegrated, receiptPath: `/receipt/${token}/${scenario.name}` })}</script>
<script type="module" src="/p4-fixture.js"></script></html>`;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const scenario = cases.find(item => item.name === url.searchParams.get("case")) ?? cases[0];
    if (request.method === "POST" && url.pathname.startsWith(`/receipt/${token}/`)) {
      const name = url.pathname.slice(`/receipt/${token}/`.length);
      assert.ok(cases.some(item => item.name === name) && !receipts.has(name));
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; assert.ok(size <= 8 * 1024 * 1024); chunks.push(chunk); }
      const row = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.equal(row.name, name); receipts.set(name, row); response.end("recorded");
    } else if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><html><meta charset="utf-8"><style>html,body{margin:0;background:#111;color:#eee;font:12px system-ui}p{margin:0;padding:4px 12px;height:20px;box-sizing:border-box}iframe{display:block;border:0;width:${scenario.width}px;height:900px}</style><p>P4 qualification · synthetic catalogue geometry · ${scenario.name} · no native media/CLI claim</p><iframe title="Rendered Planner P4" src="/fixture?case=${scenario.name}"></iframe></html>`);
    } else if (url.pathname === "/fixture") {
      const html = fixture(scenario); served.set(`fixture:${scenario.name}`, hash(html));
      response.setHeader("Content-Type", "text/html"); response.end(html);
    } else if (url.pathname === "/p4-fixture.js") {
      response.setHeader("Content-Type", "text/javascript"); response.end(fixtureBytes);
    } else if (url.pathname.startsWith("/site/")) {
      const file = resolve(source, "." + decodeURIComponent(url.pathname));
      assert.ok(file.startsWith(join(source, "site") + sep));
      const bytes = await readFile(file), digest = hash(bytes);
      assert.ok(!served.has(file) || served.get(file) === digest, "Served source changed during this run.");
      served.set(file, digest);
      response.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" })[extname(file)] ?? "application/octet-stream");
      response.end(bytes);
    } else { response.writeHead(404); response.end(); }
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let fatal = null;
try {
  for (const scenario of cases) {
    const profile = await mkdtemp(join(output, "isolated-profile-"));
    const result = await run(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--force-prefers-reduced-motion", `--user-data-dir=${profile}`, `--window-size=${scenario.width},1000`,
      "--virtual-time-budget=25000", `--screenshot=${join(output, scenario.name + ".png")}`,
      `http://127.0.0.1:${server.address().port}/?case=${scenario.name}`], { windowsHide: true, timeout: 60000, maxBuffer: 2_000_000 });
    await writeFile(join(output, scenario.name + ".stderr.txt"), result.stderr);
    const row = await waitForCapture(scenario.name);
    rows.push(row);
    for (const [key, bytes] of Object.entries(row.exports ?? {})) await writeFile(join(output, `${scenario.name}-${key}.p4.json`), bytes);
    assert.deepEqual(row.errors, [], scenario.name);
    assert.deepEqual(row.checks.filter(check => !check.pass), [], scenario.name);
    console.log(JSON.stringify({ scenario: scenario.name, checks: row.checks.length, integrated: row.integratedSession }));
  }
  assert.equal(await git(["rev-parse", "HEAD"]), commit, "Source commit changed.");
  assert.equal(await git(["status", "--short"]), status, "Source working tree changed.");
  for (const [file, digest] of served) if (!file.startsWith("fixture:")) assert.equal(hash(await readFile(file)), digest, "Served file changed: " + file);
} catch (error) { fatal = String(error.stack); }
finally {
  const screenshots = {};
  for (const scenario of cases) try { screenshots[scenario.name] = hash(await readFile(join(output, scenario.name + ".png"))); } catch { /* failed run may have no image */ }
  await writeFile(join(output, "receipt.json"), JSON.stringify({ pass: !fatal, fatal, source, commit, status, browser,
    browserSha256: hash(await readFile(browser)), requireIntegrated, harnessSha256: hash(harnessBytes), fixtureSha256: hash(fixtureBytes),
    catalogueFixtureSha256: hash(catalogueBytes), syntheticCatalogue: true, nativeCli: false, realMediaImport: false,
    sourceHashes: Object.fromEntries(served), screenshots, rows }, null, 2));
  server.close();
}
if (fatal) throw new Error(fatal);
console.log(JSON.stringify({ pass: true, scenarios: rows.length, checks: rows.reduce((sum, row) => sum + row.checks.length, 0), output }));
