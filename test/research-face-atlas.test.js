import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { faceAtlasBlend } from "../site/src/research/face-atlas.js";
import { faceAtlasCatalogue, faceAtlasPickerLabel } from "../site/src/research/face-atlas.js";
import { validateFeedbackContributionV3 } from "../site/src/research/feedback-settings.js";
import { readRunnerRecipe, resolveRunnerSelection, runnerMasterFeedbackState } from "../runner/src/recipe.js";
import { compilePlannerAssetDocument } from "../site/src/research/planner-recipe-assets.js";
import { compilePlannerRecipeV3 } from "../site/src/research/planner-recipe.js";
import { enumerateLanguageRoutesV1 } from "../site/src/research/experiment-package.js";

test("nine local Playground packs match declared byte identities", async () => {
  const root = new URL("../site/assets/affect-face/", import.meta.url);
  const catalogue = JSON.parse(await readFile(new URL("photo-atlas-packs-v1.json", root)));
  assert.equal(catalogue.packs.length, 9);
  assert.equal(new Set(faceAtlasCatalogue().packs.map(faceAtlasPickerLabel)).size, 9);
  for (const pack of catalogue.packs) {
    assert.equal(pack.gridSize, 21);
    const bytes = await readFile(new URL(pack.atlas, root));
    assert.equal(bytes.byteLength, pack.atlasBytes, pack.id);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), pack.atlasSha256, pack.id);
  }
});

test("photoreal atlas preserves exact corners and continuous bilinear midpoints", () => {
  assert.deepEqual(faceAtlasBlend(-1, 1), [{ column: 0, row: 0, weight: 1 }]);
  assert.deepEqual(faceAtlasBlend(1, -1), [{ column: 20, row: 20, weight: 1 }]);
  assert.deepEqual(faceAtlasBlend(0, 0), [{ column: 10, row: 10, weight: 1 }]);
  const midpoint = faceAtlasBlend(0.05, -0.05);
  assert.deepEqual(midpoint.map(({ column, row }) => [column, row]), [[10, 10], [11, 10], [10, 11], [11, 11]]);
  for (const tile of midpoint) assert.ok(Math.abs(tile.weight - 0.25) < 1e-12);
  assert.throws(() => faceAtlasBlend(Number.NaN, 0));
  assert.throws(() => faceAtlasBlend(1.1, 0));
});

test("all nine face selections survive strict P5 validation and Runner projection", async () => {
  const old = JSON.parse(await readFile(new URL("./fixtures/research-feedback-settings-v2.json", import.meta.url)));
  for (const pack of faceAtlasCatalogue().packs) {
    const selected = { ...old, version: 3, presentation: { ...old.presentation,
      renderer: "photo-face-matrix21", facePackId: pack.id, facePackSha256: pack.atlasSha256 } };
    const saved = validateFeedbackContributionV3(selected);
    assert.equal(saved.presentation.facePackId, pack.id);
    assert.equal(saved.presentation.facePackSha256, pack.atlasSha256);
    const run = runnerMasterFeedbackState(saved, 0.45, -0.65);
    assert.equal(run.displayMode, "photo-face");
    assert.equal(run.facePackId, pack.id);
    assert.equal(run.x, 0.45);
    assert.equal(run.y, -0.65);
    assert.throws(() => validateFeedbackContributionV3({ ...selected,
      presentation: { ...selected.presentation, facePackSha256: "0".repeat(64) } }));
  }
  assert.throws(() => validateFeedbackContributionV3({ ...old, version: 3,
    presentation: { ...old.presentation, renderer: "procedural-face" } }));
});

test("one complete Planner save passes exact Runner intake with its chosen face pack", async () => {
  const core = JSON.parse(await readFile(new URL("./fixtures/planner-recipe-v4-surveyjs.canonical.json", import.meta.url)));
  delete core.integrity;
  const pack = faceAtlasCatalogue().packs[6];
  core.segments.P5 = validateFeedbackContributionV3({ ...core.segments.P5, version: 3,
    presentation: { ...core.segments.P5.presentation, renderer: "photo-face-matrix21",
      facePackId: pack.id, facePackSha256: pack.atlasSha256 } });
  const saved = await compilePlannerAssetDocument(core);
  assert.equal(saved.recipe.version, 5);
  assert.equal(saved.recipe.segments.P5.presentation.facePackId, pack.id);
  const intake = await readRunnerRecipe(new TextEncoder().encode(saved.canonicalSourceText), saved.questionnaireAssets);
  const route = enumerateLanguageRoutesV1(intake.recipe.segments.P2.languageSelection)[0];
  const plan = await resolveRunnerSelection(intake, "P001", route.optionIds, intake.recipe.segments.P3.variants[0].variantId);
  assert.equal(plan.selected.feedback.presentation.renderer, "photo-face-matrix21");
  assert.equal(runnerMasterFeedbackState(plan.selected.feedback, -0.2, 0.8).facePackId, pack.id);
});

test("the older master generation cannot silently reinterpret a Face pack", async () => {
  const core = JSON.parse(await readFile(new URL("./fixtures/planner-recipe-v3-locations.canonical.json", import.meta.url)));
  delete core.integrity;
  const pack = faceAtlasCatalogue().packs[2];
  core.segments.P5 = validateFeedbackContributionV3({ ...core.segments.P5, version: 3,
    presentation: { ...core.segments.P5.presentation, renderer: "photo-face-matrix21",
      facePackId: pack.id, facePackSha256: pack.atlasSha256 } });
  await assert.rejects(() => compilePlannerRecipeV3(core), /feedback generation/u);
});
