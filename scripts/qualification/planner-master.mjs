// Fresh headless Planner, actual controllers, disk-backed file adapter. No OS UI.
// node scripts/qualification/planner-master.mjs <browser.exe> <new-output-dir>
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join, extname, relative, sep } from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { build } from "esbuild";
const [browser, destination] = process.argv.slice(2); assert.ok(browser && destination);
const output = resolve(destination); await mkdir(output, { recursive: true });
assert.equal((await readdir(output)).length, 0, "Use a new evidence directory.");
const run = promisify(execFile), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = async args => (await run("git", args, { windowsHide: true })).stdout.trim();
const commit = await git(["rev-parse", "HEAD"]), status = await git(["status", "--short"]);
const bundle = await build({ entryPoints: ["test/fixtures/planner-master-browser.js"], bundle: true, write: false,
  format: "esm", target: "chrome120", metafile: true, logLevel: "silent",
  banner: { js: "const __plannerModuleUrl = new URL('/site/src/research/ui-view.js', location.href).href;" },
  define: { "import.meta.url": "__plannerModuleUrl" } });
const sourceHashes = {};
for (const file of [...Object.keys(bundle.metafile.inputs), "site/research.css"]) sourceHashes[file] = hash(await readFile(file));
const source = resolve(), resourceFailures = [];
const savedFiles = new Map();
const harnessSha256 = hash(await readFile(new URL(import.meta.url)));
let completedReceipt = null;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForCapture(screenshot) {
  const deadline = Date.now() + 55000;
  while (Date.now() < deadline) {
    const bytes = await readFile(screenshot).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (completedReceipt && bytes?.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
      && bytes.subarray(-12).toString("hex") === "0000000049454e44ae426082") return completedReceipt;
    await delay(100);
  }
  throw Error("The actual app produced no finished HTTP receipt and complete PNG.");
}
const reportScript = `const receiptNode=document.querySelector('#receipt');
const observer=new MutationObserver(()=>{
  const text=receiptNode.textContent;
  if(!text||text==='pending')return;
  observer.disconnect();
  fetch('/capture-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:text});
});
observer.observe(receiptNode,{childList:true,characterData:true,subtree:true});`;
const html = `<!doctype html><meta charset="utf-8"><title>Complete Planner cycle</title><link rel="stylesheet" href="/site/research.css"><main></main><pre id="receipt" hidden>pending</pre><script>${reportScript}</script><script type="module">${bundle.outputFiles[0].text.replace(/<\/script/giu, "<\\/script")}</script>`;
await writeFile(join(output, "fixture.html"), html);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  try {
    if (request.url === "/capture-receipt" && request.method === "POST") {
      const chunks = []; let length = 0;
      for await (const chunk of request) {
        length += chunk.length; assert.ok(length <= 20 * 1024 * 1024, "Receipt exceeds its bound.");
        chunks.push(chunk);
      }
      completedReceipt = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(204); response.end();
    } else if (pathname === "/select-save-file" && request.method === "POST") {
      assert.ok(savedFiles.size < 8, "Too many test file selections.");
      for (const selected of savedFiles.values()) {
        if (selected.sha256) assert.equal(hash(await readFile(selected.path)), selected.sha256, "A prior version changed.");
      }
      const id = savedFiles.size + 1;
      const path = join(output, id === 1 ? "fresh-confirmed-recipe.json" : `fresh-confirmed-recipe-${id}.json`);
      await writeFile(path, new Uint8Array(), { flag: "wx" });
      savedFiles.set(id, { path, sha256: null });
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ id }));
    } else if (pathname === "/saved-file") {
      const id = Number(new URL(request.url, "http://127.0.0.1").searchParams.get("id") ?? savedFiles.size);
      const selected = savedFiles.get(id); assert.ok(selected, "Select a new test destination first.");
      if (request.method === "POST") {
        assert.equal(selected.sha256, null, "Each save requires a new selected destination.");
        assert.equal((await readFile(selected.path)).length, 0, "The selected destination must be empty.");
        const chunks = []; let length = 0;
        for await (const chunk of request) { length += chunk.length; assert.ok(length <= 16 * 1024 * 1024); chunks.push(chunk); }
        const bytes = Buffer.concat(chunks); assert.ok(bytes.length > 0);
        await writeFile(selected.path, bytes); selected.sha256 = hash(bytes); response.end("ok");
      } else response.end(await readFile(selected.path));
    } else if (pathname.startsWith("/site/") && request.method === "GET") {
      const file = resolve(source, "." + decodeURIComponent(pathname));
      assert.ok(file.startsWith(join(source, "site") + sep), "Static resource escaped the site root.");
      const bytes = await readFile(file);
      sourceHashes[relative(source, file).split(sep).join("/")] = hash(bytes);
      response.setHeader("Content-Type", ({ ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".csv": "text/csv" })[extname(file)] ?? "application/octet-stream");
      response.end(bytes);
    } else if (pathname === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); }
    else { response.writeHead(404); response.end(); }
  } catch (error) {
    if (pathname.startsWith("/site/")) resourceFailures.push({ pathname, message: String(error) });
    response.writeHead(500); response.end(String(error));
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const profile = await mkdtemp(join(output, "isolated-profile-")), screenshot = join(output, "final-review.png");
  const { stdout, stderr } = await run(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--force-prefers-reduced-motion", `--user-data-dir=${profile}`, "--window-size=1280,1000", `--screenshot=${screenshot}`,
    "--virtual-time-budget=30000", "--dump-dom", `http://127.0.0.1:${server.address().port}`], { windowsHide: true, timeout: 55000, maxBuffer: 8_000_000 });
  await writeFile(join(output, "browser.log"), stderr);
  await writeFile(join(output, "launcher.json"), JSON.stringify({ stdoutLength: stdout.length, stderrLength: stderr.length }));
  const receipt = await waitForCapture(screenshot);
  receipt.savedFiles = [];
  for (const selected of savedFiles.values()) {
    const bytes = await readFile(selected.path);
    assert.equal(hash(bytes), selected.sha256, "A saved version changed before the final receipt.");
    receipt.savedFiles.push({ basename: relative(output, selected.path), sha256: selected.sha256, byteLength: bytes.length });
  }
  assert.equal(await git(["rev-parse", "HEAD"]), commit);
  for (const [file, digest] of Object.entries(sourceHashes)) assert.equal(hash(await readFile(file)), digest, file);
  Object.assign(receipt, { commit, status, sourceHashes, resourceFailures, harnessSha256, fixtureHtmlSha256: hash(html), browser, browserSha256: hash(await readFile(browser)), screenshotSha256: hash(await readFile(screenshot)),
    limitation: "Synthetic media boundary and disk-backed picker adapter; not physical decoding, OS picker, native installed or Runner evidence." });
  await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  assert.deepEqual(resourceFailures, [], "Actual Planner resources failed to load.");
  assert.equal(receipt.passed, true, JSON.stringify({ checks: receipt.checks, errors: receipt.errors, error: receipt.error, announcer: receipt.announcer }));
  console.log(JSON.stringify({ passed: true, checks: receipt.checks.length, output }));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
