import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultResearchSettings, createInputBindingPreset } from "../site/src/research/contracts.js";
import { canonicalJson } from "../site/src/research/canonical.js";
import { resolveFeedbackEnvelopeV1 } from "../site/src/research/feedback-envelope.js";
import { createFeedbackContributionSource, validateFeedbackContributionV1 } from "../site/src/research/feedback-contribution.js";

function configuration() {
  const value = createDefaultResearchSettings();
  return structuredClone({ input: value.input, visual: value.visual, mappings: value.advanced.mappings });
}

test("saved feedback contribution is closed, independently owned and preserves v1 bytes", () => {
  const value = configuration();
  const accepted = validateFeedbackContributionV1(value);
  assert.equal(canonicalJson(accepted), canonicalJson(value));
  value.visual.colors.up = "#010203";
  assert.notEqual(accepted.visual.colors.up, value.visual.colors.up);
  assert.throws(() => { accepted.visual.colors.up = "#aabbcc"; }, TypeError);
  for (const mutate of [
    (v) => { v.previewMode = "face"; },
    (v) => { v.envelope = {}; },
    (v) => { delete v.visual; },
    (v) => { v.input.holdDelayMs = 500; },
    (v) => { v.visual.flubber.haloWidth = 200; },
    (v) => { v.mappings.extra = {}; },
    (v) => { delete v.mappings.saturation; },
    (v) => { v.visual.colors.up = "invalid"; },
    (v) => { v.input.stepSize = NaN; },
  ]) {
    const invalid = configuration(); mutate(invalid);
    assert.throws(() => validateFeedbackContributionV1(invalid));
  }
});

test("one revision serves saved changes, pending invalidation, repair and immutable notifications", () => {
  let value = configuration();
  const source = createFeedbackContributionSource(() => value);
  const notifications = [];
  const initial = source.getSnapshot();
  const unsubscribe = source.subscribe((snapshot) => {
    assert.equal(source.getSnapshot(), snapshot, "notification reads are reentrant");
    notifications.push(snapshot);
  });
  assert.equal(source.getSnapshot(), initial);
  value.visual.colors.idle = "#010203";
  const edited = source.refresh();
  assert.equal(edited.revision, initial.revision + 1);
  value.input.stepSize = NaN;
  const invalid = source.refresh();
  assert.equal(invalid.revision, edited.revision + 1);
  assert.equal(invalid.pending, true);
  assert.equal(invalid.contribution, null);
  assert.equal(source.getLayoutSnapshot(1024).envelope, null);
  value.input.stepSize = -1;
  assert.equal(source.refresh(), invalid, "pending state never exports stale content");
  value.input.stepSize = 0.1;
  assert.equal(source.refresh().revision, invalid.revision + 1);
  assert.equal(notifications.length, 3);
  assert.equal(initial.contribution.visual.colors.idle, configuration().visual.colors.idle);
  unsubscribe();
  value.visual.transparency = 0.55;
  source.refresh();
  assert.equal(notifications.length, 3);
  source.destroy();
  assert.throws(() => source.refresh(), /closed/);
});

test("layout snapshots bind the complete saved envelope and explicit consumer CSS viewport", () => {
  const value = configuration();
  const source = createFeedbackContributionSource(() => value);
  for (const side of [180, 324, 1024]) {
    const result = source.getLayoutSnapshot(side);
    assert.equal(result.revision, source.getSnapshot().revision);
    assert.deepEqual(result.envelope, resolveFeedbackEnvelopeV1(value, side));
  }
  const previous = source.getLayoutSnapshot(1024);
  value.visual.colors.idle = "#010203";
  const recolored = source.getLayoutSnapshot(1024);
  assert.ok(recolored.revision > previous.revision);
  assert.equal(recolored.envelope.configurationKey, previous.envelope.configurationKey);
  value.mappings.projectionAmplitude.max = 1;
  const enlarged = source.getLayoutSnapshot(1024);
  assert.notEqual(enlarged.envelope.configurationKey, previous.envelope.configurationKey);
  assert.ok(enlarged.envelope.halfExtentCssPx >= previous.envelope.halfExtentCssPx);
  for (const side of [undefined, 0, -1, NaN, Infinity, "1024"]) {
    assert.throws(() => source.getLayoutSnapshot(side));
  }
});

test("read rejection and every input preset retain truthful pending and N/A semantics", () => {
  let unavailable = false;
  const value = configuration();
  const source = createFeedbackContributionSource(() => { if (unavailable) throw Error("Invalid editor number"); return value; });
  for (const preset of ["arrowKeys", "wasd", "ijkl", "numpad", "pointerGrid", "mouseButtonsWheel", "gamepadDpad", "gamepadLeftStick", "gamepadRightStick"]) {
    value.input = createInputBindingPreset(preset, 0.125);
    const accepted = source.refresh();
    assert.equal(accepted.pending, false);
    assert.equal(accepted.contribution.input.stepSize, value.input.kind === "digital" ? 0.125 : null);
  }
  unavailable = true;
  assert.equal(source.refresh().pending, true);
  unavailable = false;
  assert.equal(source.refresh().pending, false);
});
