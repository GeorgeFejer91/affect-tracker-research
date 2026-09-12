import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readRunnerRecipe, resolveRunnerSelection, runnerMasterFeedbackState } from "../runner/src/recipe.js";
import { participantCatalogue, participantTimeline } from "../runner/src/participants.js";
import { enumerateLanguageRoutesV1 } from "../site/src/research/experiment-package.js";
import { reconstructPlannerRecipeSelectionV1 } from "../site/src/research/planner-recipe.js";
import { assertMasterPlanParity } from "../runner/src/master-presentation.js";
const load = async name => readRunnerRecipe(await readFile(new URL(`./fixtures/${name}.canonical.json`, import.meta.url)));

test("Runner preserves the complete master across every explicit variant/language selection", async () => {
  for (const name of ["planner-recipe-current-v1", "planner-recipe-locations-current-v1", "planner-recipe-deep-language-v1"]) {
    const receipt = await load(name), source = receipt.canonicalSourceText;
    assert.equal(receipt.package, undefined);
    for (const variant of receipt.recipe.segments.P3.variants) for (const route of enumerateLanguageRoutesV1(receipt.recipe.segments.P2.languageSelection)) {
      const plan = await resolveRunnerSelection(receipt, "P001", route.optionIds, variant.variantId);
      assert.deepEqual(plan.selected, await reconstructPlannerRecipeSelectionV1(receipt.recipe, plan.selector));
      const variants = plan.steps.filter(s => s.kind !== "questionnaire");
      assert.deepEqual(variants.map(s => s.entryId), variant.entries.map(e => e.entryId));
      assert.deepEqual(plan.selected.feedback, receipt.recipe.segments.P5);
      assert.deepEqual(plan.selected.policy, receipt.recipe.policy);
      assert.deepEqual(plan.selected.assets, receipt.recipe.segments.P1.videoCatalogue.entries);
      assert.equal(receipt.canonicalSourceText, source);
    }
  }
});

test("Runner does not infer allocation and distinguishes every repeated occurrence", async () => {
  const receipt = await load("planner-recipe-locations-current-v1");
  await assert.rejects(resolveRunnerSelection(receipt, "P001", ["both", "en"]), /variant|selection/iu);
  await assert.rejects(resolveRunnerSelection(receipt, "P001", [], "variant-3"), /language/iu);
  const a = await participantTimeline(receipt, "P001", ["both", "en"], "variant-3");
  const b = await participantTimeline(receipt, "P002", ["both", "en"], "variant-3");
  assert.deepEqual(a.events, b.events);
  assert.notEqual(a.selection.planIdentitySha256, b.selection.planIdentitySha256);
  assert.deepEqual(a.events.map(e => e.kind), ["questionnaire", "interval", "interval", "video", "video", "interval", "video", "interval", "interval", "questionnaire"]);
  assert.equal(a.events[1].durationMs, 0); assert.equal(a.events[8].durationMs, 0);
  assert.equal(a.events[0].payload.presentation.repeatLabelsEvery, 5);
  assert.notEqual(a.events[3].entryId, a.events[4].entryId);
  assert.equal(participantCatalogue(receipt).resolve("p100000"), "P100000");
});

test("Runner complete feedback projection preserves successor controls and rejects XR substitution", async () => {
  const receipt = await load("planner-recipe-locations-current-v1"), feedback = receipt.recipe.segments.P5;
  const state = runnerMasterFeedbackState(feedback, -0.8, 0.6);
  assert.equal(state.displayMode, "grid"); assert.equal(state.responseMode, "stepwise");
  assert.equal(state.tileCount, 31); assert.equal(state.tileRows, 15);
  assert.equal(state.flubber.haloSizePercent, 275.5); assert.equal(state.flubber.haloGradient, false);
  assert.equal(state.flubber.haloSteepness, 2.5); assert.equal(state.colorAnchorMode, "corners");
  assert.deepEqual(state.colors, feedback.visual.colors);
  const xr = await load("planner-recipe-xr-current-v1");
  const route = enumerateLanguageRoutesV1(xr.recipe.segments.P2.languageSelection)[0];
  await assert.rejects(resolveRunnerSelection(xr, "P001", route.optionIds, xr.recipe.segments.P3.variants[0].variantId), /XR/iu);
});

test("native correspondence checks all authored fields and tolerates only derived geometry", async () => {
  const receipt = await load("planner-recipe-locations-current-v1");
  const plan = await resolveRunnerSelection(receipt, "P001", ["both", "en"], "variant-3");
  const derived = structuredClone(plan); derived.selected.layout.geometry.reference.width += 1e-12;
  assert.doesNotThrow(() => assertMasterPlanParity(plan, derived));
  const authored = structuredClone(plan); authored.selected.feedback.visual.transparency += 1e-12;
  assert.throws(() => assertMasterPlanParity(plan, authored), /differs/iu);
  const missing = structuredClone(plan); missing.steps.pop();
  assert.throws(() => assertMasterPlanParity(plan, missing), /fields/iu);
});
