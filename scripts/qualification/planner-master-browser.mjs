// Pure master codec in a real isolated headless browser; no foreground app/picker.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const [browser, folder] = process.argv.slice(2);
assert.ok(browser && folder, "Provide a browser executable and isolated evidence directory.");
const git = args => execFileSync("git", args, { encoding: "utf8" }).trim();
const commit = git(["rev-parse", "HEAD"]), dirty = git(["status", "--porcelain"]) !== "";
const hash = value => createHash("sha256").update(value).digest("hex");
const output = resolve(folder); await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, "profile-"));
const fixtures = await Promise.all(["planner-recipe-current-v1", "planner-recipe-locations-current-v1", "planner-recipe-xr-current-v1", "planner-recipe-deep-language-v1"].map(async name => ({
  name, source: await readFile(`test/fixtures/${name}.canonical.json`, "utf8"),
  matrix: JSON.parse(await readFile(`test/fixtures/${name}-reproduction.json`, "utf8")),
})));
const program = `import{parsePlannerRecipeV1,compilePlannerRecipeV1,serializePlannerRecipeV1,reproducePlannerRecipeV1,reconstructPlannerRecipeSelectionV1}from'./site/src/research/planner-recipe.js';
import{canonicalJson}from'./site/src/research/canonical.js';
(async()=>{const cases=[];let checks=0;const equal=(a,b)=>{if(a!==b)throw Error('Exact codec comparison failed');checks++};
try{for(const f of ${JSON.stringify(fixtures)}){const{recipe,canonicalSourceText}=await parsePlannerRecipeV1(new TextEncoder().encode(f.source));
equal(canonicalSourceText,f.source);equal(await serializePlannerRecipeV1(recipe),f.source);
const{integrity,...core}=recipe;equal(await serializePlannerRecipeV1(await compilePlannerRecipeV1(core)),f.source);
const matrix=await reproducePlannerRecipeV1(recipe);equal(canonicalJson(matrix),canonicalJson(f.matrix));
for(const{selectionSha256,...selector}of matrix.cases.filter(c=>c.presentationTarget===recipe.presentationTarget)){
const selected=await reconstructPlannerRecipeSelectionV1(recipe,selector);equal(canonicalJson(selected.feedback),canonicalJson(recipe.segments.P5));
equal(canonicalJson(selected.assets),canonicalJson(recipe.segments.P1.videoCatalogue.entries));
equal(canonicalJson(selected.layout.profile),canonicalJson(recipe.presentationTarget==='desktop-screen'?recipe.segments.P4:recipe.segments.P6.profile));}
cases.push({name:f.name,algorithm:integrity.algorithmVersion,definitionSha256:integrity.definitionSha256,reproductionSha256:integrity.reproductionSha256});}
document.getElementById('receipt').textContent=JSON.stringify({passed:true,userAgent:navigator.userAgent,checks,cases});
}catch(error){document.getElementById('receipt').textContent=JSON.stringify({passed:false,checks,error:error.message,stack:error.stack});}})();`;
const bundle = await build({ stdin: { contents: program, resolveDir: process.cwd() }, bundle: true,
  write: false, format: "iife", target: "chrome105", logLevel: "silent", metafile: true });
const sourceHashes = Object.fromEntries(await Promise.all(Object.keys(bundle.metafile.inputs).filter(p => p !== "<stdin>").map(async path => [path, hash(await readFile(path))])));
const html = `<!doctype html><meta charset="utf-8"><title>Planner codec verification</title><pre id="receipt">pending</pre><script>${bundle.outputFiles[0].text.replace(/<\/script/giu, "<\\/script")}</script>`;
const file = join(output, "fixture.html"); await writeFile(file, html);
const { stdout, stderr } = await promisify(execFile)(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, "--virtual-time-budget=20000", "--dump-dom", pathToFileURL(file).href],
  { windowsHide: true, timeout: 45000, maxBuffer: 4_000_000 });
await writeFile(join(output, "browser.log"), stderr);
const raw = stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1]; assert.ok(raw && raw !== "pending", "Browser codec did not complete.");
const receipt = JSON.parse(raw.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<"));
assert.equal(git(["rev-parse", "HEAD"]), commit, "Commit changed during browser verification.");
for (const [path, digest] of Object.entries(sourceHashes)) assert.equal(hash(await readFile(path)), digest, `${path} changed during verification`);
receipt.commit = commit;
receipt.dirty = dirty;
receipt.htmlSha256 = hash(html);
receipt.sourceSha256 = sourceHashes;
await writeFile(join(output, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
assert.equal(receipt.passed, true, receipt.error);
console.log(`${receipt.checks} codec assertions passed in ${receipt.userAgent}.`);
