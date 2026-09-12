import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readPlannerPolicyControls, restorePlannerPolicyControls, preparePlannerPolicyControls } from "../site/src/research/planner-policy-controls.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/planner-recipe-policy-v1.json", import.meta.url)));

test("prepared policy is detached and read-only, and rejects changed control identity or values", () => {
  const h = harness(), before = h.snapshot(), input = structuredClone(fixture);
  const prepared = preparePlannerPolicyControls(h.root, input, { isCurrent: () => true });
  input.participantCount = 77;
  assert.deepEqual(h.snapshot(), before);
  assert.deepEqual(prepared.commit(), fixture); assert.deepEqual(readPlannerPolicyControls(h.root), fixture);
  assert.throws(() => prepared.commit());
  for (const replace of [false, true]) {
    const next = preparePlannerPolicyControls(h.root, fixture, { isCurrent: () => true });
    if (replace) h.fields.set("participant-count", { value: h.fields.get("participant-count").value });
    else h.fields.get("participant-count").value = "12";
    assert.equal(next.isCurrent(), false); assert.throws(() => next.commit());
  }
});
function harness() {
  const fields = new Map([
    ["participant-count", { value: "42" }], ["sampling-frequency", { value: "100" }],
    ["output-csv", { checked: false }], ["output-tsv", { checked: true }],
    ["lsl-enabled", { checked: true }], ["lsl-state-stream", { value: "AuthoredState" }],
    ["lsl-stream-type", { value: "AuthoredAffect" }], ["lsl-marker-stream", { value: "AuthoredMarkers" }],
    ["lsl-source-id", { value: "authored-source" }],
  ]);
  const root = { querySelector: selector => fields.get(selector.slice(1)) };
  return { root, fields, snapshot: () => structuredClone([...fields]) };
}

test("fresh Planner policy captures every current control without an imported experiment", () => {
  const h = harness(), policy = readPlannerPolicyControls(h.root);
  assert.equal(policy.participantCount, 42);
  assert.equal(policy.samplingFrequencyHz, 100);
  assert.deepEqual(policy.output, { csv: false, tsv: true });
  assert.deepEqual(policy.lsl, { enabled: true, stateStream: "AuthoredState", streamType: "AuthoredAffect", markerStream: "AuthoredMarkers", sourceId: "authored-source" });
  assert.deepEqual(policy.playback, fixture.playback);
  h.fields.get("lsl-source-id").value = "new-source";
  assert.equal(policy.lsl.sourceId, "authored-source", "capture is detached");
  for (const id of ["participant-count", "sampling-frequency"]) {
    const prior = h.fields.get(id).value;
    for (const value of ["", "not a number", "-1", "1.5"]) {
      h.fields.get(id).value = value;
      assert.throws(() => readPlannerPolicyControls(h.root), `${id}: ${value}`);
    }
    h.fields.get(id).value = prior;
  }
});

test("policy restoration is exact and rejects invalid, stale or missing-control adoption before writes", () => {
  const h = harness();
  const normalized = restorePlannerPolicyControls(h.root, fixture, { isCurrent: () => true });
  assert.deepEqual(normalized, fixture);
  assert.deepEqual(readPlannerPolicyControls(h.root), fixture);
  const before = h.snapshot(), changed = { ...fixture, participantCount: 57 };
  assert.equal(restorePlannerPolicyControls(h.root, changed, { isCurrent: () => false }), false);
  assert.deepEqual(h.snapshot(), before);
  assert.throws(() => restorePlannerPolicyControls(h.root, changed), /guard/);
  assert.deepEqual(h.snapshot(), before);
  for (const invalid of [{ ...fixture, hiddenPolicy: true }, { ...fixture, samplingFrequencyHz: NaN },
    { ...fixture, playback: { ...fixture.playback, rate: 2 } }]) {
    assert.throws(() => restorePlannerPolicyControls(h.root, invalid, { isCurrent: () => true }));
    assert.deepEqual(h.snapshot(), before);
  }
  h.fields.delete("lsl-source-id");
  const missing = h.snapshot();
  assert.throws(() => restorePlannerPolicyControls(h.root, changed, { isCurrent: () => true }), /unavailable/);
  assert.deepEqual(h.snapshot(), missing);
  assert.throws(() => readPlannerPolicyControls(h.root), /unavailable/);
});
