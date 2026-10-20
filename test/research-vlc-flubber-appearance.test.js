import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultResearchSettings } from "../site/src/research/contracts.js";
import { createFeedbackAuthoringSettingsV2 } from "../site/src/research/feedback-settings.js";
import { createDefaultFlubberMappings } from "../site/src/research/mappings.js";
import { createVlcFlubberAppearance, validateVlcFlubberAppearance } from "../site/src/research/vlc-flubber-appearance.js";

test("Flubber appearance export contains validated visual and animation settings only", () => {
  const defaults = createDefaultResearchSettings();
  const feedback = createFeedbackAuthoringSettingsV2({
    input: defaults.input, visual: defaults.visual, mappings: createDefaultFlubberMappings(),
  });
  const appearance = createVlcFlubberAppearance(feedback);
  assert.equal(appearance.schema, "vlc-flubber-appearance/v1");
  assert.deepEqual(Object.keys(appearance), ["schema", "visual", "presentation", "mappings"]);
  assert.equal(appearance.visual.colors.up, defaults.visual.colors.up);
  assert.deepEqual(Object.keys(appearance.visual), ["transparency", "flubber", "colors"]);
  assert.deepEqual(Object.keys(appearance.presentation), ["colorAnchors", "halo"]);
  assert.equal(appearance.mappings.oscillationFrequency.drivenBy, "y-axis");
  assert.equal("input" in appearance, false);
  assert.equal("response" in appearance, false);
  assert.deepEqual(validateVlcFlubberAppearance(JSON.parse(JSON.stringify(appearance))), appearance);
});

test("appearance export requires the Flubber preview", () => {
  const defaults = createDefaultResearchSettings();
  const feedback = createFeedbackAuthoringSettingsV2({
    input: defaults.input, visual: defaults.visual, mappings: createDefaultFlubberMappings(),
  });
  assert.throws(() => createVlcFlubberAppearance({
    ...feedback, presentation: { ...feedback.presentation, renderer: "grid" },
  }), /Select Classic Flubber/);
});

test("appearance export does not depend on input or response validation", () => {
  const defaults = createDefaultResearchSettings();
  const feedback = createFeedbackAuthoringSettingsV2({
    input: defaults.input, visual: defaults.visual, mappings: createDefaultFlubberMappings(),
  });
  const appearance = createVlcFlubberAppearance({ ...feedback, input: null, response: { grid: { columns: 2 } } });
  assert.equal(appearance.schema, "vlc-flubber-appearance/v1");
});

test("appearance reader rejects unknown fields and invalid colors or mappings", () => {
  const defaults = createDefaultResearchSettings();
  const feedback = createFeedbackAuthoringSettingsV2({
    input: defaults.input, visual: defaults.visual, mappings: createDefaultFlubberMappings(),
  });
  const appearance = createVlcFlubberAppearance(feedback);
  assert.throws(() => validateVlcFlubberAppearance({ ...appearance, input: {} }), /requires exactly/);
  assert.throws(() => validateVlcFlubberAppearance({ ...appearance,
    visual: { ...appearance.visual, colors: { ...appearance.visual.colors, up: "red" } },
  }), /six-digit hex/);
  assert.throws(() => validateVlcFlubberAppearance({ ...appearance,
    mappings: { ...appearance.mappings, saturation: { ...appearance.mappings.saturation, min: -1 } },
  }), /within 0–1/);
});
