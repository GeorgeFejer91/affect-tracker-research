import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "../site/src/research/canonical.js";
import { createPlannerContributionRegistry } from "../site/src/research/planner-contributions.js";
import { capturePlannerRecipeInputV1 } from "../site/src/research/planner-recipe-capture.js";
import { readPlannerRecipeJsonBytes, validatePlannerRecipeStructureV1, boundPlannerRecipeMatrix, PLANNER_RECIPE_SEGMENTS,
  MAX_PLANNER_RECIPE_BYTES, MAX_PLANNER_RECIPE_DEPTH } from "../site/src/research/planner-recipe-wire.js";

const policy = JSON.parse(await readFile(new URL("./fixtures/planner-recipe-policy-v1.json", import.meta.url), "utf8"));
const legacy = JSON.parse(await readFile(new URL("./fixtures/experiment-package-v1.canonical.json", import.meta.url), "utf8"));
const bytes = text => new TextEncoder().encode(text);
// Shape/capture fixtures deliberately do not claim domain-valid master payloads.
const core = () => ({ schema: "affect-research-planner-recipe", version: 1, recipeId: "wire-test",
  presentationTarget: "desktop-screen", policy: structuredClone(policy),
  segments: { P1: {}, P2: {}, P3: {}, P4: {}, P5: {}, P6: { status: "excluded" } } });

test("recipe transport rejects duplicate keys, malformed UTF-8, non-finite, noncanonical and deep JSON", () => {
  const source = `${canonicalJson(core())}\n`;
  assert.deepEqual(readPlannerRecipeJsonBytes(bytes(source)).value, core());
  const hostile = [source.trimEnd(), `${source}\n`, ` ${source}`, source.replace('"version":1}', '"version":1.0}'),
    '{"a":1,"a":2}\n', '{"a":{"b":1,"b":2}}\n', '{"a":1e999}\n', '{"a":NaN}\n', '"unterminated',
    "[".repeat(MAX_PLANNER_RECIPE_DEPTH + 1) + "0" + "]".repeat(MAX_PLANNER_RECIPE_DEPTH + 1) + "\n"];
  for (const text of hostile) assert.throws(() => readPlannerRecipeJsonBytes(bytes(text)));
  for (const input of [new Uint8Array(), new Uint8Array([0xff]), new Uint8Array(MAX_PLANNER_RECIPE_BYTES + 1), source]) {
    assert.throws(() => readPlannerRecipeJsonBytes(input));
  }
  const quotedBrackets = `${canonicalJson({ text: '[{\\"'.repeat(100) })}\n`;
  assert.equal(readPlannerRecipeJsonBytes(bytes(quotedBrackets)).canonicalSourceText, quotedBrackets);
});

test("successor root requires every owner, explicit target and closed XR selection", () => {
  assert.equal(validatePlannerRecipeStructureV1(core(), { integrity: false }).segments.P6.status, "excluded");
  for (const segment of PLANNER_RECIPE_SEGMENTS) {
    const missing = core(); delete missing.segments[segment];
    assert.throws(() => validatePlannerRecipeStructureV1(missing, { integrity: false }));
    const pending = core(); pending.segments[segment] = null;
    assert.throws(() => validatePlannerRecipeStructureV1(pending, { integrity: false }));
  }
  for (const target of [undefined, null, "", "tauri", "webxr-immersive-vr"]) {
    const input = core(); input.presentationTarget = target;
    assert.throws(() => validatePlannerRecipeStructureV1(input, { integrity: false }));
  }
  for (const selection of [{}, { status: "excluded", profile: {} }, { status: "included" }, { status: "included", profile: null }]) {
    const input = core(); input.segments.P6 = selection;
    assert.throws(() => validatePlannerRecipeStructureV1(input, { integrity: false }));
  }
  const active = core(); active.segments.P6 = { status: "included", profile: {} };
  assert.throws(() => validatePlannerRecipeStructureV1(active, { integrity: false }), /match/u);
  active.presentationTarget = "webxr-immersive-vr";
  validatePlannerRecipeStructureV1(active, { integrity: false }); // P6's domain reader must validate the profile next.
  const extra = core(); extra.requiredCapabilities = [];
  assert.throws(() => validatePlannerRecipeStructureV1(extra, { integrity: false }), /unknown/u);
  const unsafePolicy = core(); unsafePolicy.policy.playback.audio.muted = true;
  assert.throws(() => validatePlannerRecipeStructureV1(unsafePolicy, { integrity: false }), /playback/u);
});

test("matrix bounds precede allocation and preserve the validated language routes", () => {
  assert.deepEqual(boundPlannerRecipeMatrix(legacy.languageSelection, 64, 2), { routeCount: 2, variantCount: 64, presentationCount: 2, caseCount: 256 });
  for (const [variants, presentations] of [[0, 1], [65, 1], [1, 0], [1, 3], [1.5, 1], [Infinity, 1]]) {
    assert.throws(() => boundPlannerRecipeMatrix(legacy.languageSelection, variants, presentations));
  }
  const cycle = structuredClone(legacy.languageSelection);
  cycle.nodes[0].options[0].target = { kind: "node", nodeId: cycle.rootNodeId };
  assert.throws(() => boundPlannerRecipeMatrix(cycle, 1, 1));
});

test("accepted capture is detached, omits session receipts and expires on actual owner edits", async () => {
  const registry = createPlannerContributionRegistry(), live = {};
  for (const segment of PLANNER_RECIPE_SEGMENTS) {
    live[segment] = { revision: 1, enabled: segment !== "P6", pending: false,
      contribution: segment === "P6" ? null : { ownerField: segment }, dependencyRevisions: [] };
    registry.register(segment, () => live[segment], { validateContribution: async () => true });
    await registry.accept(segment);
  }
  const options = { recipeId: "snapshot-test", presentationTarget: "desktop-screen", policy: structuredClone(policy), isCurrent: () => true };
  const captured = capturePlannerRecipeInputV1(registry, options);
  assert.deepEqual(captured.input.segments.P6, { status: "excluded" });
  assert.deepEqual(captured.input.segments.P1, { ownerField: "P1" });
  assert.equal(captured.isCurrent(), true);
  options.policy.samplingFrequencyHz = 200;
  assert.equal(captured.input.policy.samplingFrequencyHz, policy.samplingFrequencyHz);
  assert.throws(() => { captured.input.segments.P1.ownerField = "changed"; });
  live.P1 = { ...live.P1, revision: 2, contribution: { ownerField: "new" } }; registry.changed("P1");
  assert.equal(captured.isCurrent(), false);
  assert.throws(() => capturePlannerRecipeInputV1(registry, options));
});

test("capture cannot infer an optional exclusion when the XR owner was never accepted", async () => {
  const registry = createPlannerContributionRegistry();
  for (const segment of PLANNER_RECIPE_SEGMENTS.slice(0, 5)) {
    registry.register(segment, () => ({ revision: 1, enabled: true, pending: false, contribution: {}, dependencyRevisions: [] }), { validateContribution: async () => true });
    await registry.accept(segment);
  }
  assert.throws(() => capturePlannerRecipeInputV1(registry, { recipeId: "test", presentationTarget: "desktop-screen", policy, isCurrent: () => true }), /Confirm/u);
});

test("capture lifetime requires caller epochs and cannot resurrect after clear/reaccept between probes", async () => {
  const registry = createPlannerContributionRegistry();
  for (const segment of PLANNER_RECIPE_SEGMENTS) registry.register(segment,
    () => ({ revision: 1, enabled: segment !== "P6", pending: false, contribution: segment === "P6" ? null : {}, dependencyRevisions: [] }),
    { validateContribution: async () => true });
  const acceptAll = async () => { for (const segment of PLANNER_RECIPE_SEGMENTS) await registry.accept(segment); };
  await acceptAll();
  const options = { recipeId: "lifetime-test", presentationTarget: "desktop-screen", policy };
  assert.throws(() => capturePlannerRecipeInputV1(registry, options), /guard/u);
  for (const action of ["recipeId", "policy", "target", "edit-revert", "new-operation", "teardown"]) {
    let epoch = 1;
    const initial = epoch;
    const capture = capturePlannerRecipeInputV1(registry, { ...options, isCurrent: () => epoch === initial });
    assert.equal(capture.isCurrent(), true);
    epoch += 1; // The caller increments for each listed event, including reverts.
    assert.equal(capture.isCurrent(), false, action);
    epoch = initial; // Even a broken caller cannot revive an observed stale capture.
    assert.equal(capture.isCurrent(), false, action);
  }
  const unobserved = capturePlannerRecipeInputV1(registry, { ...options, isCurrent: () => true });
  registry.clearAcceptance();
  await acceptAll();
  assert.equal(unobserved.isCurrent(), false, "same values reaccepted without probing the cleared state must still expire the old capture");
});
