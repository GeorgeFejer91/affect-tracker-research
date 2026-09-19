import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readRunnerRecipe, resolveRunnerSelection, runnerMasterFeedbackState } from "../experiment-runner/src/recipe.js";
import { participantCatalogue, participantTimeline, participantPreviewTimeline } from "../experiment-runner/src/participants.js";
import { enumerateLanguageRoutesV1 } from "../experiment-planner/web/src/research/experiment-package.js";
import { reconstructPlannerRecipeSelectionV1 } from "../experiment-planner/web/src/research/planner-recipe.js";
import { assertMasterPlanParity, resolveMasterDesktopLayoutProjection } from "../experiment-runner/src/master-presentation.js";
const load = async name => readRunnerRecipe(await readFile(new URL(`./fixtures/${name}.canonical.json`, import.meta.url)));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const inside = (box, screen) => box.x >= -1e-8 && box.y >= -1e-8
  && box.x + box.width <= screen.width + 1e-8 && box.y + box.height <= screen.height + 1e-8;

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
test("Runner preview resolves the selected master version's participant-facing sequence", async () => {
  const receipt = await load("runner-master-v3-owner");
  const variantId = receipt.recipe.segments.P3.variants[1].variantId;
  const promptOnly = await participantPreviewTimeline(receipt, "P001", [], variantId);
  assert.equal(promptOnly.complete, false);
  assert.deepEqual(promptOnly.events.map(event => event.kind), ["language"]);
  const preview = await participantPreviewTimeline(receipt, "P001", ["both", "en"], variantId);
  assert.equal(preview.complete, true);
  assert.deepEqual(preview.events.map(event => event.kind), ["language", "questionnaire", "questionnaire", "video", "interval", "video", "interval", "questionnaire"]);
  assert.match(preview.sequence, /^Language > Demographics > Custom study > session2_portrait\.mp4 > ISI4 > session%5Fa_clip\.mp4 > ISI2 > Custom study$/u);
  assert.equal(preview.events.find(event => event.kind === "video").videoId, "session2_portrait.mp4");
  assert.deepEqual(preview.events.filter(event => event.kind === "video").map(event => event.videoRelativePath),
    ["assets/stimuli/session2/portrait.mp4", "assets/stimuli/session_a/clip.mp4"]);
});

test("Runner complete feedback projection preserves successor controls and rejects XR substitution", async () => {
  const receipt = await load("planner-recipe-locations-current-v1"), feedback = receipt.recipe.segments.P5;
  const state = runnerMasterFeedbackState(feedback, -0.8, 0.6);
  assert.equal(state.displayMode, "grid"); assert.equal(state.responseMode, "stepwise");
  assert.equal(state.gridVisible, feedback.visual.gridEnabled);
  assert.equal(state.flubberVisible, feedback.visual.flubberEnabled);
  assert.equal(state.tileCount, 31); assert.equal(state.tileRows, 15);
  assert.equal(state.flubber.haloSizePercent, 275.5); assert.equal(state.flubber.haloGradient, false);
  assert.equal(state.flubber.haloSteepness, 2.5); assert.equal(state.colorAnchorMode, "corners");
  assert.deepEqual(state.colors, feedback.visual.colors);
  const xr = await load("planner-recipe-xr-current-v1");
  const route = enumerateLanguageRoutesV1(xr.recipe.segments.P2.languageSelection)[0];
  await assert.rejects(resolveRunnerSelection(xr, "P001", route.optionIds, xr.recipe.segments.P3.variants[0].variantId), /XR/iu);
});

test("a smaller viewport preserves the authored arrangement under one uniform scale", async () => {
  const receipt = await load("planner-recipe-locations-current-v1");
  const plan = await resolveRunnerSelection(receipt, "P001", ["both", "en"], "variant-3");
  const exact = resolveMasterDesktopLayoutProjection(plan, { innerWidth: 1920, innerHeight: 1080 });
  assert.equal(exact.mode, "authored");
  assert.deepEqual(exact.reference, plan.selected.layout.geometry.reference);
  assert.deepEqual(exact.feedback, plan.selected.layout.geometry.feedback);

  const authored = plan.selected.layout.geometry;
  const fitted = resolveMasterDesktopLayoutProjection(plan, { innerWidth: 1536, innerHeight: 864 });
  assert.equal(fitted.mode, "uniform-fit");
  assert.ok(fitted.warnings.some(message => /saved target viewport/u.test(message)));
  assert.equal(inside(fitted.reference, fitted.actualViewport), true);
  assert.equal(inside(fitted.feedback, fitted.actualViewport), true);

  // One uniform scale: every authored distance and both box sizes keep their
  // ratios, and the authored side of the feedback box is unchanged.
  const ratio = fitted.reference.width / authored.reference.width;
  near(fitted.feedback.width / authored.feedback.width, ratio);
  near(fitted.reference.height / authored.reference.height, ratio);
  near(fitted.feedback.height / authored.feedback.height, ratio);
  near(fitted.feedback.cx - fitted.reference.cx, (authored.feedback.cx - authored.reference.cx) * ratio);
  near(fitted.feedback.cy - fitted.reference.cy, (authored.feedback.cy - authored.reference.cy) * ratio);
  assert.equal(Math.sign(fitted.feedback.cy - fitted.reference.cy), Math.sign(authored.feedback.cy - authored.reference.cy));
});

test("an authored side arrangement is never silently rearranged below the video", async () => {
  const receipt = await load("planner-recipe-locations-current-v1");
  // The resolved plan is frozen, so the alternative arrangement is authored on
  // a detached copy.
  const plan = structuredClone(await resolveRunnerSelection(receipt, "P001", ["both", "en"], "variant-3"));
  const geometry = plan.selected.layout.geometry;
  const reference = geometry.reference;
  geometry.feedback = {
    width: geometry.feedback.width, height: geometry.feedback.height,
    x: reference.x + reference.width + 40, y: reference.y,
    cx: reference.x + reference.width + 40 + geometry.feedback.width / 2,
    cy: reference.y + geometry.feedback.height / 2,
  };
  const authoredOffset = { x: geometry.feedback.cx - reference.cx, y: geometry.feedback.cy - reference.cy };
  const fitted = resolveMasterDesktopLayoutProjection(plan, { innerWidth: 1280, innerHeight: 720 });
  assert.equal(fitted.mode, "uniform-fit");
  const ratio = fitted.reference.width / reference.width;
  assert.ok(fitted.feedback.x >= fitted.reference.x + fitted.reference.width - 1e-6,
    "the feedback box stayed to the right of the video");
  assert.ok(fitted.feedback.y < fitted.reference.y + fitted.reference.height,
    "the feedback box was moved below the video instead of staying beside it");
  near(fitted.feedback.cx - fitted.reference.cx, authoredOffset.x * ratio);
  near(fitted.feedback.cy - fitted.reference.cy, authoredOffset.y * ratio);
});

test("a millimetre-calibrated layout reports incompatibility instead of rescaling physical size", async () => {
  const receipt = await load("planner-recipe-locations-current-v1");
  const plan = structuredClone(await resolveRunnerSelection(receipt, "P001", ["both", "en"], "variant-3"));
  plan.selected.layout.profile.units = "mm";
  assert.doesNotThrow(() => resolveMasterDesktopLayoutProjection(plan, { innerWidth: 1920, innerHeight: 1080 }));
  assert.throws(() => resolveMasterDesktopLayoutProjection(plan, { innerWidth: 1536, innerHeight: 864 }),
    (error) => error.name === "MasterLayoutIncompatibleError" && /physical size cannot be reproduced/u.test(error.message));
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
