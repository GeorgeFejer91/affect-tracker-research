import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { compilePlannerRecipeV1, serializePlannerRecipeV1, parsePlannerRecipeV1,
  reproducePlannerRecipeV1, reconstructPlannerRecipeSelectionV1 } from "../../site/src/research/planner-recipe.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const output = resolve(process.argv[2] ?? "D:/GitHub/.affect-checks/p7-master-native-parity");
const executable = resolve(process.argv[3] ?? join(root, "src-tauri/target/debug/examples/planner-recipe-check.exe"));
const load = async name => JSON.parse(await readFile(join(root, "test/fixtures", `${name}.json`), "utf8"));
const source = async name => readFile(join(root, "test/fixtures", `${name}.canonical.json`), "utf8");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
await mkdir(output, { recursive: true });
const cases = [];
for (const name of ["planner-recipe-current-v1", "planner-recipe-locations-current-v1", "planner-recipe-xr-current-v1", "planner-recipe-deep-language-v1"])
  cases.push({ name, source: await source(name) });
const layout = await load("desktop-layout-candidates-v1");
const { integrity: _integrity, ...base } = JSON.parse(cases[0].source);
for (const [i, candidate] of layout.cases.entries()) {
  const core = structuredClone(base); core.segments.P4 = candidate.profile;
  cases.push({ name: `desktop-policy-units-${i}`, source: await serializePlannerRecipeV1(await compilePlannerRecipeV1(core)) });
}
for (const renderer of ["flubber", "grid", "procedural-face"]) {
  const core = structuredClone(base); core.segments.P5.presentation.renderer = renderer;
  cases.push({ name: `renderer-${renderer}`, source: await serializePlannerRecipeV1(await compilePlannerRecipeV1(core)) });
}

const receipt = { schema: "affect-research-planner-parity-evidence", version: 1,
  commit: git(["rev-parse", "HEAD"]), dirty: git(["status", "--porcelain"]) !== "",
  nodeVersion: process.version,
  nativeExecutableSha256: hash(await readFile(executable)), algorithm: "planner-recipe-reproduction-v2",
  geometryComparison: "absolute-numeric-leaf-error-less-than-1e-10; exact shape and nonnumeric leaves",
  cases: [] };
const sourcePaths = execFileSync("rg", ["--files", "site/src/research", "src-tauri/src", "src-tauri/examples"],
  { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/u).filter(path => /\.(?:js|rs)$/u.test(path));
sourcePaths.push("src-tauri/Cargo.toml", "src-tauri/Cargo.lock");
receipt.sourceSha256 = Object.fromEntries(await Promise.all(sourcePaths.sort().map(async path => [path, hash(await readFile(join(root, path)))])));
let maximumDifference = 0;
function geometry(a, b, path = "layout") {
  if (typeof a === "number" && typeof b === "number") {
    assert.ok(Number.isFinite(a) && Number.isFinite(b), path);
    const delta = Math.abs(a - b); maximumDifference = Math.max(maximumDifference, delta);
    assert.ok(delta < 1e-10, `${path}: ${a} differs from ${b}`); return;
  }
  if (!a || !b || typeof a !== "object" || typeof b !== "object") { assert.equal(a, b, path); return; }
  assert.equal(Array.isArray(a), Array.isArray(b), path);
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), path);
  for (const key of Object.keys(a)) geometry(a[key], b[key], `${path}.${key}`);
}
for (const item of cases) {
  const path = join(output, `${item.name}.json`); await writeFile(path, item.source);
  const native = JSON.parse(execFileSync(executable, [path], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
  const js = await parsePlannerRecipeV1(new TextEncoder().encode(item.source));
  assert.equal(canonicalJson(native.document), canonicalJson(js));
  const matrix = await reproducePlannerRecipeV1(js.recipe);
  assert.equal(canonicalJson(native.matrix), canonicalJson(matrix));
  let count = 0;
  for (const row of matrix.cases.filter(row => row.presentationTarget === js.recipe.presentationTarget)) {
    const { selectionSha256: _selectionHash, ...selector } = row;
    const selected = await reconstructPlannerRecipeSelectionV1(js.recipe, selector);
    const observed = native.selections[count++];
    const { layout: a, ...nativeContent } = observed;
    const { layout: b, ...jsContent } = selected;
    assert.equal(canonicalJson(nativeContent), canonicalJson(jsContent));
    assert.equal(canonicalJson(a.profile), canonicalJson(b.profile));
    geometry(a, b);
  }
  assert.equal(native.selections.length, count);
  receipt.cases.push({ name: item.name, canonicalSourceByteSha256: js.canonicalSourceByteSha256,
    definitionSha256: js.recipe.integrity.definitionSha256, reproductionSha256: js.recipe.integrity.reproductionSha256,
    selectedCases: count, matrixCases: matrix.caseCount });
}
receipt.maximumDerivedNumericDifference = maximumDifference;
assert.equal(git(["rev-parse", "HEAD"]), receipt.commit, "Source commit changed during qualification.");
for (const [path, expected] of Object.entries(receipt.sourceSha256)) assert.equal(hash(await readFile(join(root, path))), expected, `${path} changed during qualification`);
await writeFile(join(output, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`${receipt.cases.length} independent native/JS master cases passed; maximum derived numeric difference ${maximumDifference}.`);
