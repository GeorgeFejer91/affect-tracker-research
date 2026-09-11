import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultResearchSettings } from "../site/src/research/contracts.js";
import { deriveFeedbackEnvelopeV1, resolveFeedbackEnvelopeV1 } from "../site/src/research/feedback-envelope.js";
import { MAPPING_DRIVERS, evaluateFlubberMappings } from "../site/src/research/mappings.js";
import { buildFlubberPath, createProfiles, createProjectionOffsets, FLUBBER_BASE_SHAPES } from "../site/src/math.js";

function configuration() {
  const settings = createDefaultResearchSettings();
  return structuredClone({ visual: settings.visual, mappings: settings.advanced.mappings });
}

test("feedback bounds require complete valid saved configuration and explicit CSS pixel scale", () => {
  const config = configuration();
  for (const size of [undefined, null, "100", 0, -1, Infinity, NaN]) {
    assert.throws(() => resolveFeedbackEnvelopeV1(config, size));
  }
  for (const mutate of [
    (value) => { delete value.mappings.saturation; },
    (value) => { value.mappings.unknown = {}; },
    (value) => { value.mappings.projectionAmplitude.max = 1.01; },
    (value) => { value.mappings.waveSizeVariation.min = NaN; },
    (value) => { value.mappings.saturation.drivenBy = "unknown"; },
    (value) => { value.visual.flubber.outlineThickness = -1; },
    (value) => { value.visual.grid.cursorSize = 101; },
    (value) => { value.visual.flubber.haloSizePercent = 200; },
  ]) {
    const invalid = structuredClone(config);
    mutate(invalid);
    assert.throws(() => deriveFeedbackEnvelopeV1(invalid));
  }
});

test("style and mappings invalidate the envelope key while placement and colors have no geometry authority", () => {
  const config = configuration();
  const before = deriveFeedbackEnvelopeV1(config);
  assert.equal(before.algorithmVersion, "feedback-envelope-v1");
  assert.equal(before.origin, "design-centre");
  assert.ok(Object.isFrozen(before) && Object.isFrozen(before.flubber) && Object.isFrozen(before.grid));
  for (const mutate of [
    (value) => { value.visual.grid.cursorSize += 1; },
    (value) => { value.visual.flubber.outlineThickness += 1; },
    (value) => { value.visual.flubber.showHalo = false; },
    (value) => { value.mappings.waveSizeVariation.max = 1; },
    (value) => { value.mappings.projectionAmplitude.drivenBy = "angle"; },
    (value) => { value.mappings.saturation.reverse = true; },
  ]) {
    const edited = structuredClone(config);
    mutate(edited);
    assert.notEqual(deriveFeedbackEnvelopeV1(edited).configurationKey, before.configurationKey);
  }
  const moved = structuredClone(config);
  moved.visual.overlayPosition = { x: 0, y: 1 };
  moved.visual.sizePercent = 99;
  moved.visual.lockPosition = true;
  moved.visual.transparency = 1;
  moved.visual.colors.up = "#010203";
  assert.deepEqual(deriveFeedbackEnvelopeV1(moved), before);
  assert.deepEqual(deriveFeedbackEnvelopeV1(JSON.parse(JSON.stringify(config))), before);
});

test("feedback bounds account for edge cursors, non-scaling strokes, visibility and the full animated extent", () => {
  const config = configuration();
  config.visual.gridEnabled = false;
  config.visual.flubber.outlineThickness = 20;
  config.mappings.projectionAmplitude.max = 1;
  config.mappings.waveSizeVariation.max = 1;
  const flubber = resolveFeedbackEnvelopeV1(config, 324);
  assert.equal(flubber.overlaySideCssPx, 324);
  assert.ok(flubber.halfExtentCssPx >= 300 + 120, "maximum deformation plus conservative miter allowance");
  assert.ok(flubber.halfExtentCssPx < 421);
  config.visual.flubber.showHalo = false;
  assert.ok(resolveFeedbackEnvelopeV1(config, 324).halfExtentCssPx < flubber.halfExtentCssPx);
  config.visual.flubberEnabled = false;
  config.visual.gridEnabled = true;
  config.visual.grid.cursorSize = 100;
  config.visual.grid.showOutline = false;
  config.visual.grid.lineThickness = 0.25;
  assert.equal(resolveFeedbackEnvelopeV1(config, 100).halfExtentCssPx, 150.75);
  assert.equal(resolveFeedbackEnvelopeV1(config, 200).halfExtentCssPx, 300.75);
  config.visual.hideFeedback = true;
  assert.equal(resolveFeedbackEnvelopeV1(config, 200).halfExtentCssPx, 0);
  config.visual.hideFeedback = false;
  config.visual.gridEnabled = false;
  assert.equal(resolveFeedbackEnvelopeV1(config, 200).halfExtentCssPx, 0);
});

test("the envelope contains actual renderer paths across mapping extrema, phases, base shapes and reduced motion", () => {
  const profiles = createProfiles();
  const offsets = createProjectionOffsets("p5-envelope-regression");
  // Include deterministic limiting disorder values as well as seeded values.
  offsets.amplitudes[0] = 1;
  offsets.amplitudes[1] = -1;
  for (const drivenBy of MAPPING_DRIVERS) for (const reverse of [false, true]) {
    const config = configuration();
    for (const [id, mapping] of Object.entries(config.mappings)) {
      Object.assign(mapping, { min: 0, max: id === "oscillationFrequency" ? 10 : 1, drivenBy, reverse });
    }
    const bound = deriveFeedbackEnvelopeV1(config).flubber.halfExtentAtUnitWidth * 3.24;
    for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) {
      const mapping = evaluateFlubberMappings(config.mappings, { x, y });
      for (const baseShape of FLUBBER_BASE_SHAPES) for (const reducedMotion of [false, true]) {
        for (let index = 0; index < 8; index += 1) {
          const { path } = buildFlubberPath({ profiles, offsets, x, y, baseShape, reducedMotion,
            phase: index * Math.PI / 4,
            projectionAmplitude: mapping.projectionAmplitude, edgeSmoothness: mapping.edgeSmoothness,
            pulseSynchrony: mapping.pulseSynchrony, amplitudeVariation: mapping.waveSizeVariation });
          const coordinates = path.match(/-?\d+\.\d+/gu).map(Number);
          assert.ok(coordinates.every((coordinate) => Math.abs(coordinate) <= bound),
            `${drivenBy}/${reverse}/${x},${y}/${baseShape}/${reducedMotion}/${index}`);
        }
      }
    }
  }
});
