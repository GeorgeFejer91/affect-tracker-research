// Pure master codec in a real isolated headless browser; no foreground app/picker.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFile, readdir, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { build } from "esbuild";

const [browser, folder] = process.argv.slice(2);
assert.ok(browser && folder, "Provide a browser executable and isolated evidence directory.");
const git = args => execFileSync("git", args, { encoding: "utf8" }).trim();
const commit = git(["rev-parse", "HEAD"]), dirty = git(["status", "--porcelain"]) !== "";
const hash = value => createHash("sha256").update(value).digest("hex");
const output = resolve(folder); await mkdir(output, { recursive: true });
assert.equal((await readdir(output)).length, 0, "Use a fresh empty evidence directory; preserve earlier receipts.");
const profile = await mkdtemp(join(output, "profile-"));
const harnessSha256 = hash(await readFile(new URL(import.meta.url)));
const receiptPath = `/receipt-${randomBytes(16).toString("hex")}`;
const fixtures = await Promise.all(["planner-recipe-current-v1", "planner-recipe-locations-current-v1", "planner-recipe-xr-current-v1", "planner-recipe-deep-language-v1"].map(async name => ({
  name, source: await readFile(`test/fixtures/${name}.canonical.json`, "utf8"),
  matrix: JSON.parse(await readFile(`test/fixtures/${name}-reproduction.json`, "utf8")),
})));
const program = `import{parsePlannerRecipeV1,compilePlannerRecipeV1,serializePlannerRecipeV1,reproducePlannerRecipeV1,reconstructPlannerRecipeSelectionV1}from'./site/src/research/planner-recipe.js';
import{canonicalJson}from'./site/src/research/canonical.js';
(async()=>{const cases=[];let checks=0;const equal=(a,b)=>{if(a!==b)throw Error('Exact codec comparison failed');checks++};
const report=async receipt=>{document.getElementById('receipt').textContent=JSON.stringify(receipt);await fetch(${JSON.stringify(receiptPath)},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(receipt)});};
try{for(const f of ${JSON.stringify(fixtures)}){const{recipe,canonicalSourceText}=await parsePlannerRecipeV1(new TextEncoder().encode(f.source));
equal(canonicalSourceText,f.source);equal(await serializePlannerRecipeV1(recipe),f.source);
const{integrity,...core}=recipe;equal(await serializePlannerRecipeV1(await compilePlannerRecipeV1(core)),f.source);
const matrix=await reproducePlannerRecipeV1(recipe);equal(canonicalJson(matrix),canonicalJson(f.matrix));
for(const{selectionSha256,...selector}of matrix.cases.filter(c=>c.presentationTarget===recipe.presentationTarget)){
const selected=await reconstructPlannerRecipeSelectionV1(recipe,selector);equal(canonicalJson(selected.feedback),canonicalJson(recipe.segments.P5));
equal(canonicalJson(selected.assets),canonicalJson(recipe.segments.P1.videoCatalogue.entries));
equal(canonicalJson(selected.layout.profile),canonicalJson(recipe.presentationTarget==='desktop-screen'?recipe.segments.P4:recipe.segments.P6.profile));}
cases.push({name:f.name,algorithm:integrity.algorithmVersion,definitionSha256:integrity.definitionSha256,reproductionSha256:integrity.reproductionSha256});}
await report({passed:true,userAgent:navigator.userAgent,checks,cases});
}catch(error){await report({passed:false,checks,error:error.message,stack:error.stack});}})();`;
const bundle = await build({ stdin: { contents: program, resolveDir: process.cwd() }, bundle: true,
  write: false, format: "iife", target: "chrome105", logLevel: "silent", metafile: true });
const sourcePaths = [...Object.keys(bundle.metafile.inputs).filter(p => p !== "<stdin>"),
  ...fixtures.flatMap(({ name }) => [`test/fixtures/${name}.canonical.json`, `test/fixtures/${name}-reproduction.json`])];
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(path))])));
const html = `<!doctype html><meta charset="utf-8"><title>Planner codec verification</title><pre id="receipt">pending</pre><script>${bundle.outputFiles[0].text.replace(/<\/script/giu, "<\\/script")}</script>`;
const file = join(output, "fixture.html"); await writeFile(file, html);
let reportReceipt, reportFailure, timer;
const received = new Promise((resolve, reject) => { reportReceipt = resolve; reportFailure = reject; });
const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html);
    } else if (request.method === "POST" && request.url === receiptPath) {
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; assert.ok(size <= 1024 * 1024); chunks.push(chunk); }
      const receipt = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(204); response.end(); reportReceipt(receipt);
    } else { response.writeHead(404); response.end(); }
  } catch (error) { response.writeHead(400); response.end(); reportFailure(error); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let receipt, launch;
try {
  timer = setTimeout(() => reportFailure(new Error("Browser did not deliver its codec receipt within 45 seconds.")), 45000);
  // Edge's launcher may exit before the browser. Its stdout/exit cannot own
  // the fixture server lifetime; wait for the actual page's bounded receipt.
  launch = promisify(execFile)(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=${profile}`, "--virtual-time-budget=20000", "--dump-dom", `http://127.0.0.1:${server.address().port}/`],
    { windowsHide: true, timeout: 45000, maxBuffer: 4_000_000 }).then(
    result => result, error => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? "", error: error.message }));
  receipt = await received;
} finally {
  clearTimeout(timer); server.close(); server.closeAllConnections();
  if (launch) {
    const result = await launch;
    await writeFile(join(output, "browser.log"), result.stderr);
    await writeFile(join(output, "launcher.json"), JSON.stringify({ stdoutLength: result.stdout.length, error: result.error ?? null }));
  }
}
assert.equal(git(["rev-parse", "HEAD"]), commit, "Commit changed during browser verification.");
for (const [path, digest] of Object.entries(sourceHashes)) assert.equal(hash(await readFile(path)), digest, `${path} changed during verification`);
assert.equal(hash(await readFile(new URL(import.meta.url))), harnessSha256, "Harness changed during verification.");
receipt.commit = commit;
receipt.dirty = dirty;
receipt.htmlSha256 = hash(html);
receipt.harnessSha256 = harnessSha256;
receipt.sourceSha256 = sourceHashes;
await writeFile(join(output, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
assert.equal(receipt.passed, true, receipt.error);
console.log(`${receipt.checks} codec assertions passed in ${receipt.userAgent}.`);
