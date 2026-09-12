import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readRunnerRecipe, resolveRunnerSelection, runnerFeedbackState } from "../runner/src/recipe.js";
import { enumerateLanguageRoutesV1, compileExperimentPackageSelectionV1 } from "../site/src/research/experiment-package.js";
const fixture = new URL("./fixtures/experiment-package-v1.canonical.json", import.meta.url);

test("Runner reads unchanged Planner bytes and resolves every v1 participant and language", async () => {
  const bytes = await readFile(fixture), receipt = await readRunnerRecipe(bytes);
  assert.equal(receipt.canonicalSourceText, bytes.toString());
  for (const participantId of ["P001", "P002"]) for (const route of enumerateLanguageRoutesV1(receipt.package.languageSelection)) {
    const runner = await resolveRunnerSelection(receipt, participantId, route.optionIds);
    const expected = await compileExperimentPackageSelectionV1(receipt.package, { participantId, languageId: route.languageId, languageSelectionPath: route.optionIds });
    assert.deepEqual(runner.compiled, expected);
    assert.equal(runner.detail.protocolStepCount, expected.protocolPlan.steps.length);
    assert.equal(runner.detail.packageDefinitionSha256, receipt.package.integrity.packageDefinitionSha256);
  }
  await assert.rejects(resolveRunnerSelection(receipt, "P001", []), /language/u);
  await assert.rejects(resolveRunnerSelection(receipt, "P999", ["en"]));
});

test("Runner rejects unfinished authoring and damaged or future packages", async () => {
  for (const name of ["variant-design-v1.json", "xr-layout-v1.canonical.json", "planner-recipe-policy-v1.json"]) {
    await assert.rejects(readRunnerRecipe(await readFile(new URL(`./fixtures/${name}`, import.meta.url))));
  }
  const bytes = await readFile(fixture);
  const value = JSON.parse(bytes); value.version = 2;
  await assert.rejects(readRunnerRecipe(new TextEncoder().encode(JSON.stringify(value))));
  await assert.rejects(readRunnerRecipe(new TextEncoder().encode(bytes.toString().replace('"sizePercent":32', '"sizePercent":33'))));
});

test("Runner feedback projects saved values without simulator defaults", async () => {
  const { package: recipe } = await readRunnerRecipe(await readFile(fixture));
  const settings = structuredClone(recipe.settings);
  settings.visual.gridEnabled = false; settings.visual.flubberEnabled = false;
  const projected = runnerFeedbackState(settings, -0.8, 0.6);
  assert.equal(projected.gridVisible, false); assert.equal(projected.flubberVisible, false);
  assert.equal(projected.transparencyPercent, 37); assert.equal(projected.sizePercent, 32);
  assert.deepEqual(projected.position, { x: 0.17, y: 0.83 });
  assert.deepEqual(projected.colors, settings.visual.colors);
  assert.deepEqual(projected.flubber, settings.visual.flubber);
  assert.deepEqual(projected.grid, settings.visual.grid);
  assert.equal(projected.lockPosition, true);
  assert.equal(projected.displayMode, "legacy");
});

test("native Planner registry cannot start acquisition and Runner cannot author recipes", async () => {
  const lib = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const planner = lib.split("DesktopRole::Planner => builder.invoke_handler")[1].split("DesktopRole::Runner => builder.invoke_handler")[0];
  const runner = lib.split("DesktopRole::Runner => builder.invoke_handler")[1].split("    };")[0];
  assert.doesNotMatch(planner, /research_(?:start|resume|finish|recorder|lsl_readiness|package_(?:play|pause|run))/u);
  assert.doesNotMatch(runner, /research_(?:save_settings|save_experiment_package|store_questionnaire_asset|save_stimulus_order|import_library)/u);
  assert.match(lib, /if role == DesktopRole::Runner[\s\S]*?PackageProtocolRuntime::with_services/u);
  assert.doesNotMatch(lib, /ResearchRuntime::with_services/u);
});
