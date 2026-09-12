// Fresh headless Planner, actual controllers, disk-backed file adapter. No OS UI.
// node scripts/qualification/planner-master.mjs <browser.exe> <new-output-dir>
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
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
  define: { "import.meta.url": JSON.stringify("http://127.0.0.1/site/src/research/ui-view.js") } });
const sourceHashes = {};
for (const file of [...Object.keys(bundle.metafile.inputs), "site/research.css"]) sourceHashes[file] = hash(await readFile(file));
const savedFile = join(output, "fresh-confirmed-recipe.json");
const html = `<!doctype html><meta charset="utf-8"><title>Complete Planner cycle</title><style>${await readFile("site/research.css", "utf8")}</style><main></main><pre id="receipt" hidden>pending</pre><script type="module">${bundle.outputFiles[0].text.replace(/<\/script/giu, "<\\/script")}</script>`;
await writeFile(join(output, "fixture.html"), html);
const server = createServer(async (request, response) => {
  try {
    if (request.url === "/saved-file") {
      if (request.method === "POST") { const chunks = []; for await (const chunk of request) chunks.push(chunk); await writeFile(savedFile, Buffer.concat(chunks)); response.end("ok"); }
      else response.end(await readFile(savedFile));
    } else { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); }
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  const profile = await mkdtemp(join(output, "isolated-profile-")), screenshot = join(output, "final-review.png");
  const { stdout, stderr } = await run(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--force-prefers-reduced-motion", `--user-data-dir=${profile}`, "--window-size=1280,1000", `--screenshot=${screenshot}`,
    "--virtual-time-budget=30000", "--dump-dom", `http://127.0.0.1:${server.address().port}`], { windowsHide: true, timeout: 55000, maxBuffer: 8_000_000 });
  await writeFile(join(output, "browser.log"), stderr);
  const raw = stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1];
  assert.ok(raw && raw !== "pending", "The actual app produced no finished receipt.");
  const receipt = JSON.parse(raw.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<"));
  assert.equal(await git(["rev-parse", "HEAD"]), commit);
  for (const [file, digest] of Object.entries(sourceHashes)) assert.equal(hash(await readFile(file)), digest, file);
  Object.assign(receipt, { commit, status, sourceHashes, screenshotSha256: hash(await readFile(screenshot)),
    limitation: "Synthetic media boundary and disk-backed picker adapter; not physical decoding, OS picker, native installed or Runner evidence." });
  await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  assert.equal(receipt.passed, true, JSON.stringify({ checks: receipt.checks, errors: receipt.errors, error: receipt.error, announcer: receipt.announcer }));
  console.log(JSON.stringify({ passed: true, checks: receipt.checks.length, output }));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
