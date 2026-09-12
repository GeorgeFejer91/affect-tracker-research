// Fresh-profile headless P5-only qualification; never attach to a user window.
// node scripts/qualification/planner-p5-ui.mjs <browser.exe> <fresh-output-dir> [overview,response,advanced,mappings,color,input]
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve, extname, sep } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const [browser, destination, selected = "overview,response,advanced,mappings,color,input", integratedArgument = ""] = process.argv.slice(2);
assert.ok(browser && destination, "Supply browser executable and fresh output directory");
assert.ok(["", "--require-integrated"].includes(integratedArgument), "Unknown integration requirement");
const scenes = selected.split(",");
assert.ok(scenes.every(scene => ["overview", "response", "advanced", "mappings", "color", "input"].includes(scene)));
const source = resolve(import.meta.dirname, "../.."), output = resolve(destination), site = join(source, "site");
await mkdir(output, { recursive: true }); assert.equal((await readdir(output)).length, 0, "Preserve previous evidence; use an empty output directory");
const run = promisify(execFile), hash = data => createHash("sha256").update(data).digest("hex");
const git = async (...args) => (await run("git", args, { cwd: source, windowsHide: true })).stdout.trim();
assert.equal(await git("status", "--porcelain", "--", "site"), "", "Require clean application source, including untracked files");
const provenance = { commit: await git("rev-parse", "HEAD"), applicationTree: await git("rev-parse", "HEAD:site"),
  browserSha256: hash(await readFile(browser)), harnessSha256: hash(await readFile(new URL(import.meta.url))),
  fixtureSha256: hash(await readFile(new URL("./planner-p5-ui-fixture.js", import.meta.url))) };
const bundle = await build({ write: false, bundle: true, format: "esm", stdin: { resolveDir: import.meta.dirname,
  contents: `import {checkP5Ui} from './planner-p5-ui-fixture.js'; const errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason))); const args=JSON.parse(new URL(location.href).searchParams.get('case'));checkP5Ui(args).then(receipt=>parent.postMessage({...receipt,errors},location.origin)).catch(error=>parent.postMessage({pass:false,error:error.stack,errors},location.origin));` } });
provenance.bundleSha256 = hash(bundle.outputFiles[0].contents);
const receipts = new Map();
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/receipt" && request.method === "POST") {
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; assert.ok(size < 5_000_000); chunks.push(chunk); }
      const capture = JSON.parse(Buffer.concat(chunks)); receipts.set(capture.name, capture);
      response.writeHead(204); response.end();
    } else if (url.pathname === "/") {
      const args = JSON.parse(url.searchParams.get("case")), name = `${args.width}-${args.scene}`;
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0}iframe{border:0;width:${args.width}px;height:1000px}</style><iframe src="/fixture?case=${encodeURIComponent(JSON.stringify(args))}" title="Actual P5 Planner UI"></iframe><script>addEventListener('message',e=>{if(e.origin!==location.origin)return;fetch('/receipt',{method:'POST',body:JSON.stringify({name:${JSON.stringify(name)},receipt:e.data,html:document.documentElement.outerHTML})});});</script>`);
    } else if (url.pathname === "/fixture") {
      response.setHeader("Content-Type", "text/html");
      response.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/site/research.css"><div id="research-app" data-research-surface="browser" data-research-program="planner"></div><script type="module" src="/bundle.js"></script>');
    } else if (url.pathname === "/bundle.js") {
      response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text);
    } else if (url.pathname.startsWith("/site/")) {
      const file = resolve(site, "." + decodeURIComponent(url.pathname.slice(5))); assert.ok(file.startsWith(site + sep));
      response.setHeader("Content-Type", ({ ".css": "text/css", ".svg": "image/svg+xml", ".js": "text/javascript" })[extname(file)] ?? "application/octet-stream");
      response.end(await readFile(file));
    } else { response.writeHead(404); response.end(); }
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const summary = [];
try {
  for (const width of [1280, 800]) for (const scene of scenes) {
    const name = `${width}-${scene}`, screenshot = join(output, `${name}.png`), profile = await mkdtemp(join(output, "profile-"));
    const args = { width, scene, runChecks: scene === "overview", requireIntegrated: integratedArgument === "--require-integrated" };
    const launcher = await run(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      `--user-data-dir=${profile}`, "--window-size=1280,1100", "--force-prefers-reduced-motion", "--force-device-scale-factor=1",
      "--virtual-time-budget=20000", `--screenshot=${screenshot}`, "--dump-dom", `http://127.0.0.1:${server.address().port}/?case=${encodeURIComponent(JSON.stringify(args))}`],
    { windowsHide: true, timeout: 60000, maxBuffer: 3_000_000 });
    await writeFile(join(output, `${name}.launcher.json`), JSON.stringify({ stdout: launcher.stdout, stderr: launcher.stderr }));
    const deadline = Date.now() + 30000; let capture, png;
    while (Date.now() < deadline) {
      capture = receipts.get(name); png = await readFile(screenshot).catch(() => null);
      if (capture && png?.subarray(-12).toString("hex") === "0000000049454e44ae426082") break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(capture && png, `Missing page/PNG receipt ${name}; launcher stderr bytes=${launcher.stderr.length}`);
    const receipt = { ...capture.receipt, provenance: { ...provenance, htmlSha256: hash(capture.html), screenshotSha256: hash(png) } };
    await writeFile(join(output, `${name}.html`), capture.html);
    await writeFile(join(output, `${name}.json`), JSON.stringify(receipt, null, 2));
    const row = { name, pass: receipt.pass && !receipt.errors?.length, integrated: receipt.integrated, verified: receipt.verified, unresolved: receipt.unresolved,
      errors: receipt.error ?? receipt.errors, failures: receipt.rows?.filter(row => row.status !== "verified").map(row => ({ id: row.id, error: row.error })) };
    summary.push(row); console.log(JSON.stringify(row));
  }
  await writeFile(join(output, "summary.json"), JSON.stringify({ provenance, summary }, null, 2));
  assert.ok(summary.every(row => row.pass), "One or more P5 UI checks failed; inspect individual receipts");
} finally { await new Promise(resolve => server.close(resolve)); }
