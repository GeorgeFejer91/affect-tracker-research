// Isolated actual-UI/shared-session parity, never foreground desktop control.
// node scripts/qualification/p2-typed-rendered.mjs <browser.exe> <new-output-dir> [width] [populated|actions|invalid]
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, join, extname, relative, sep } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const [browser, destination, width = "1280", mode = "populated"] = process.argv.slice(2);
assert.ok(browser && destination); assert.ok(["800", "1280"].includes(width)); assert.ok(["populated", "actions", "invalid"].includes(mode));
const output = resolve(destination); await mkdir(output, { recursive: true });
assert.equal((await readdir(output)).length, 0, "Use a new evidence directory.");
const run = promisify(execFile), hash = value => createHash("sha256").update(value).digest("hex");
const git = async args => (await run("git", args, { windowsHide: true })).stdout.trim();
const commit = await git(["rev-parse", "HEAD"]), status = await git(["status", "--short"]);
const bundle = await build({ entryPoints: ["test/fixtures/p2-typed-browser.js"], bundle: true, write: false, format: "esm", target: "chrome120", metafile: true, logLevel: "silent",
  banner: { js: "const __plannerModuleUrl = new URL('/site/src/research/ui-view.js', location.href).href;" }, define: { "import.meta.url": "__plannerModuleUrl" } });
const sourceHashes = {};
for (const file of [...Object.keys(bundle.metafile.inputs), "site/research.css"]) sourceHashes[file] = hash(await readFile(file));
const source = resolve(), harnessSha256 = hash(await readFile(new URL(import.meta.url))), failures = [];
let receipt;
const html = `<!doctype html><meta charset="utf-8"><title>P2 typed form UI and CLI parity</title><link rel="stylesheet" href="/site/research.css"><main></main><pre id="receipt" hidden></pre>
<script>const node=document.querySelector('#receipt');const observer=new MutationObserver(()=>{if(!node.textContent)return;observer.disconnect();fetch('/receipt',{method:'POST',body:node.textContent});});observer.observe(node,{childList:true,characterData:true,subtree:true});</script>
<script type="module">${bundle.outputFiles[0].text.replace(/<\/script/giu, "<\\/script")}</script>`;
await writeFile(join(output, "fixture.html"), html);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  try {
    if (pathname === "/receipt" && request.method === "POST") {
      const chunks = []; let length = 0;
      for await (const chunk of request) { length += chunk.length; assert.ok(length <= 4 * 1024 * 1024); chunks.push(chunk); }
      receipt = JSON.parse(Buffer.concat(chunks).toString("utf8")); response.writeHead(204); response.end();
    } else if (pathname.startsWith("/site/") && request.method === "GET") {
      const file = resolve(source, "." + decodeURIComponent(pathname)); assert.ok(file.startsWith(join(source, "site") + sep));
      const bytes = await readFile(file); sourceHashes[relative(source, file).split(sep).join("/")] = hash(bytes);
      response.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".csv": "text/csv" })[extname(file)] ?? "application/octet-stream"); response.end(bytes);
    } else if (pathname === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); }
    else { response.writeHead(404); response.end(); }
  } catch (error) { failures.push({ pathname, message: String(error) }); response.writeHead(500); response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const profile = await mkdtemp(join(output, "isolated-profile-")), screenshot = join(output, "p2.png");
  const { stdout, stderr } = await run(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--force-prefers-reduced-motion",
    `--user-data-dir=${profile}`, `--window-size=${width},1000`, `--screenshot=${screenshot}`, "--virtual-time-budget=20000", "--dump-dom",
    `http://127.0.0.1:${server.address().port}/?mode=${mode}`], { windowsHide: true, timeout: 55000, maxBuffer: 8_000_000 });
  await writeFile(join(output, "browser.log"), stderr); await writeFile(join(output, "launcher.json"), JSON.stringify({ stdoutLength: stdout.length, stderrLength: stderr.length }));
  const deadline = Date.now() + 55000;
  let png;
  while (Date.now() < deadline) {
    png = await readFile(screenshot).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (receipt && png?.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" && png.subarray(-12).toString("hex") === "0000000049454e44ae426082") break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(receipt && png, "No completed page receipt and PNG.");
  assert.equal(await git(["rev-parse", "HEAD"]), commit); assert.equal(await git(["status", "--short"]), status);
  for (const [file, digest] of Object.entries(sourceHashes)) assert.equal(hash(await readFile(file)), digest, file);
  Object.assign(receipt, { commit, status, sourceHashes, failures, harnessSha256, fixtureHtmlSha256: hash(html), browser, browserSha256: hash(await readFile(browser)), screenshotSha256: hash(png) });
  await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  assert.deepEqual(failures, []); assert.equal(receipt.passed, true, JSON.stringify(receipt));
  console.log(JSON.stringify({ passed: true, checks: receipt.cases.length, output }));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
