// Independent native/JS content correspondence. This does not execute an experiment.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { readRunnerRecipe, resolveRunnerSelection } from "../../runner/src/recipe.js";
import { assertMasterPlanParity } from "../../runner/src/master-presentation.js";
import { enumerateLanguageRoutesV1 } from "../../site/src/research/experiment-package.js";
const [executableArg, outputArg, artifactArg] = process.argv.slice(2);
assert.ok(executableArg && outputArg, "Supply the native runner_master_plan executable and a new evidence directory, optionally an exact produced master.");
const executable = resolve(executableArg), output = resolve(outputArg), root = resolve(import.meta.dirname, "../..");
await mkdir(output); // Existing evidence is never overwritten.
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sources = artifactArg ? [resolve(artifactArg)] : ["planner-recipe-current-v1", "planner-recipe-locations-current-v1", "planner-recipe-deep-language-v1"].map(name => join(root, `test/fixtures/${name}.canonical.json`));
const results = [];
for (const path of sources) {
  const bytes = await readFile(path), receipt = await readRunnerRecipe(bytes);
  for (const variant of receipt.recipe.segments.P3.variants) for (const route of enumerateLanguageRoutesV1(receipt.recipe.segments.P2.languageSelection)) {
    const expected = await resolveRunnerSelection(receipt, "P001", route.optionIds, variant.variantId);
    const request = { sourceText: bytes.toString("utf8"), participantId: "P001", selector: expected.selector };
    const child = spawnSync(executable, [], { input: JSON.stringify(request), encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
    assert.equal(child.status, 0, child.stderr || String(child.error));
    const actual = JSON.parse(child.stdout); assertMasterPlanParity(expected, actual);
    const stem = `selection-${results.length + 1}`;
    await writeFile(join(output, `${stem}.native.json`), child.stdout, { flag: "wx" });
    await writeFile(join(output, `${stem}.browser.json`), JSON.stringify(expected), { flag: "wx" });
    results.push({ path, sourceSha256: hash(bytes), selector: expected.selector, participantId: "P001", planIdentitySha256: actual.planIdentitySha256, stepCount: actual.steps.length,
      nativeProjectionSha256: hash(child.stdout), browserProjectionSha256: hash(JSON.stringify(expected)) });
  }
}
const git = args => spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).stdout.trim();
const result = { schema: "affect-runner-master-software-correspondence", version: 1, claim: "complete interpretation only; no session execution, media, input, LSL or recording qualification",
  commit: git(["rev-parse", "HEAD"]), dirty: Boolean(git(["status", "--porcelain"])), executable, executableSha256: hash(await readFile(executable)),
  harnessSha256: hash(await readFile(import.meta.filename)), results };
await writeFile(join(output, "receipt.json"), JSON.stringify(result, null, 2), { flag: "wx" });
console.log(`${results.length} complete native/JS Runner selections agree; content correspondence only.`);
