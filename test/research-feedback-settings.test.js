import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { canonicalJson } from "../site/src/research/canonical.js";
import { createInputBindingPreset } from "../site/src/research/contracts.js";
import { validateFeedbackContributionV1, createFeedbackContributionSource } from "../site/src/research/feedback-contribution.js";
import { validateFeedbackContribution, validateFeedbackContributionV2, createFeedbackAuthoringSettingsV2 } from "../site/src/research/feedback-settings.js";
import { resolveFeedbackEnvelope, resolveFeedbackEnvelopeV2 } from "../site/src/research/feedback-layout.js";
const fixture = () => JSON.parse(readFileSync(new URL("./fixtures/research-feedback-settings-v2.json", import.meta.url), "utf8"));
const legacy = value => ({ input: value.input, visual: value.visual, mappings: value.mappings });

test("complete feedback preserves both generations and all configured values without implicit upgrades", () => {
  const value = fixture();
  const result = validateFeedbackContribution(value);
  assert.equal(canonicalJson(result), canonicalJson(value));
  assert.ok(Object.isFrozen(result.presentation.labels.axes) && Object.isFrozen(result.response.grid));
  assert.deepEqual(validateFeedbackContribution(legacy(value)), validateFeedbackContributionV1(legacy(value)));
  assert.throws(() => validateFeedbackContributionV1(value));
  const initialized = createFeedbackAuthoringSettingsV2(legacy(value));
  assert.equal(initialized.presentation.renderer, "flubber");
  assert.equal(initialized.response.grid.columns, 21);
  assert.notEqual(canonicalJson(initialized), canonicalJson(value), "explicit new-authoring choices are distinct from reading");
  for (const preset of ["arrowKeys", "wasd", "ijkl", "numpad", "pointerGrid", "mouseButtonsWheel", "gamepadDpad", "gamepadLeftStick", "gamepadRightStick"]) {
    const input = createInputBindingPreset(preset, 0.25);
    assert.deepEqual(validateFeedbackContributionV2({ ...value, input }).input, input);
  }
});

test("every required nested member rejects omission, additions, coercion and unsupported values", () => {
  const groups = [[], ["presentation"], ["presentation", "labels"], ["presentation", "labels", "axes"],
    ["presentation", "labels", "corners"], ["presentation", "halo"], ["response"], ["response", "grid"]];
  const at = (value, path) => path.reduce((object, key) => object[key], value);
  for (const path of groups) {
    for (const key of Object.keys(at(fixture(), path))) {
      const value = fixture(); delete at(value, path)[key];
      assert.throws(() => validateFeedbackContribution(value), `${path}.${key}`);
    }
    const value = fixture(); at(value, path).unknown = true;
    assert.throws(() => validateFeedbackContribution(value));
  }
  for (const [path, bad] of [
    [["version"], 1], [["version"], "2"], [["schema"], "other"],
    [["presentation", "renderer"], "photoatlas"], [["presentation", "colorAnchors"], "automatic"],
    [["presentation", "labels", "axes", "up"], ""], [["presentation", "labels", "axes", "up"], "x".repeat(49)],
    [["presentation", "labels", "axes", "up"], " x "], [["presentation", "labels", "corners", "left"], "x\ny"],
    [["presentation", "labels", "axes", "up"], "\ud800"],
    [["presentation", "halo", "widthPercent"], 10001], [["presentation", "halo", "widthPercent"], NaN],
    [["presentation", "halo", "widthPercent"], "150"], [["presentation", "halo", "gradient"], 1],
    [["presentation", "halo", "steepness"], 0], [["response", "grid", "columns"], 20],
    [["response", "grid", "rows"], 2003], [["response", "fullSpanDurationMs"], 249],
    [["response", "fullSpanDurationMs"], 250.5], [["response", "repeatDelayMs"], 5001],
    [["response", "holdRule"], "osRepeat"], [["response", "mode"], "default"],
  ]) {
    const value = fixture(); at(value, path.slice(0, -1))[path.at(-1)] = bad;
    assert.throws(() => validateFeedbackContribution(value), path.join("."));
  }
});

test("new settings share pending/revision state and legacy values cannot override V2 geometry", () => {
  const value = fixture();
  const source = createFeedbackContributionSource(() => value, { validate: validateFeedbackContribution, resolveEnvelope: resolveFeedbackEnvelope });
  const before = source.getSnapshot();
  value.response.grid.rows = 35;
  assert.ok(source.refresh().revision > before.revision);
  value.presentation.halo.widthPercent = 10001;
  assert.equal(source.refresh().pending, true);
  assert.equal(source.getLayoutSnapshot(1024).envelope, null);
  value.presentation.halo.widthPercent = 300;
  assert.equal(source.refresh().pending, false);
  const bound = source.getLayoutSnapshot(1024).envelope;
  value.visual.gridEnabled = !value.visual.gridEnabled;
  value.visual.flubberEnabled = !value.visual.flubberEnabled;
  value.visual.overlayPosition = { x: 0, y: 1 };
  value.visual.sizePercent = 100;
  value.input.stepSize = 0.9;
  assert.equal(source.getLayoutSnapshot(1024).envelope.halfExtentCssPx, bound.halfExtentCssPx);
  source.destroy();
});

test("V2 envelope covers selected output, full halo filter region, grid edges and procedural Face", () => {
  const value = fixture(); value.presentation.renderer = "flubber";
  value.presentation.halo.gradient = false; value.presentation.halo.widthPercent = 10000;
  value.visual.flubber.outlineThickness = 20;
  value.mappings.projectionAmplitude.max = 1; value.mappings.waveSizeVariation.max = 1;
  assert.ok(resolveFeedbackEnvelopeV2(value, 324).halfExtentCssPx >= 12300);
  value.presentation.halo.gradient = true;
  assert.ok(resolveFeedbackEnvelopeV2(value, 324).halfExtentCssPx >= 12900);
  value.presentation.renderer = "grid"; value.response.mode = "stepwise";
  value.visual.grid.lineThickness = 20; value.visual.grid.showOutline = false;
  assert.equal(resolveFeedbackEnvelopeV2(value, 100).halfExtentCssPx, 60);
  value.response.mode = "continuous"; value.visual.grid.cursorSize = 100;
  assert.equal(resolveFeedbackEnvelopeV2(value, 100).halfExtentCssPx, 160);
  value.presentation.renderer = "procedural-face";
  assert.equal(resolveFeedbackEnvelopeV2(value, 100).halfExtentCssPx, 50);
  value.visual.hideFeedback = true;
  assert.equal(resolveFeedbackEnvelopeV2(value, 100).halfExtentCssPx, 0);
});

test("two independent readers reproduce complete feedback and bounds without ambient defaults", () => {
  const script = `import {validateFeedbackContribution} from './site/src/research/feedback-settings.js';
    import {resolveFeedbackEnvelope} from './site/src/research/feedback-layout.js';
    import {canonicalJson} from './site/src/research/canonical.js';
    let data='';for await (const chunk of process.stdin)data+=chunk;
    Date.now=()=>{throw Error('clock');};Math.random=()=>{throw Error('random');};
    for(const key of ['localStorage','sessionStorage','navigator'])Object.defineProperty(globalThis,key,{get(){throw Error(key);}});
    const result=validateFeedbackContribution(JSON.parse(data));
    process.stdout.write(canonicalJson({configuration:result,envelope:resolveFeedbackEnvelope(result,1024)}));`;
  const run = () => spawnSync(process.execPath, ["--input-type=module", "-e", script], { input: canonicalJson(fixture()), encoding: "utf8" });
  const a = run(), b = run();
  assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr); assert.equal(a.stdout, b.stdout);
  assert.equal(canonicalJson(JSON.parse(a.stdout).configuration), canonicalJson(fixture()));
});
