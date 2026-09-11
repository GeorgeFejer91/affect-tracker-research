import test from "node:test";
import assert from "node:assert/strict";

import * as responsiveFace from "../site/src/research/responsive-face.js";

const { createResponsiveFaceGeometry } = responsiveFace;

function numericLeaves(value) {
  if (typeof value === "number") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(numericLeaves);
}

function assertFinitePath(d) {
  assert.equal(typeof d, "string");
  assert.doesNotMatch(d, /NaN|Infinity|undefined|null/);
  const coordinates = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  assert.ok(coordinates.length > 0, `expected path coordinates in ${d}`);
  assert.ok(coordinates.every(Number.isFinite));
  assert.ok(coordinates.every((coordinate) => coordinate >= 0 && coordinate <= 200));
}

test("the module exposes one procedural geometry entry point", () => {
  assert.deepEqual(Object.keys(responsiveFace), ["createResponsiveFaceGeometry"]);
  assert.equal(typeof createResponsiveFaceGeometry, "function");
});

test("responsive face geometry is deterministic and deeply stable", () => {
  const first = createResponsiveFaceGeometry({ valence: 0.375, arousal: -0.25 });
  const second = createResponsiveFaceGeometry({ valence: 0.375, arousal: -0.25 });

  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.affect));
  assert.ok(Object.isFrozen(first.eyes.left));
  assert.ok(Object.isFrozen(first.brows.right));
  assert.ok(Object.isFrozen(first.mouth.shape));
});

test("inputs clamp to the normalized affect range and non-finite values become neutral", () => {
  assert.deepEqual(
    createResponsiveFaceGeometry({ valence: 20, arousal: -20 }).affect,
    { valence: 1, arousal: -1 },
  );
  assert.deepEqual(
    createResponsiveFaceGeometry({ valence: -20, arousal: 20 }).affect,
    { valence: -1, arousal: 1 },
  );
  assert.deepEqual(
    createResponsiveFaceGeometry({ valence: Number.NaN, arousal: Number.POSITIVE_INFINITY }).affect,
    { valence: 0, arousal: 0 },
  );
  assert.deepEqual(
    createResponsiveFaceGeometry({ valence: Symbol("invalid"), arousal: undefined }).affect,
    { valence: 0, arousal: 0 },
  );
  assert.deepEqual(createResponsiveFaceGeometry(null).affect, { valence: 0, arousal: 0 });
});

test("neutral affect produces the centered baseline face", () => {
  const neutral = createResponsiveFaceGeometry({ valence: 0, arousal: 0 });

  assert.equal(neutral.viewBox, "0 0 200 200");
  assert.deepEqual(neutral.affect, { valence: 0, arousal: 0 });
  assert.deepEqual(neutral.face, { cx: 100, cy: 100, rx: 78, ry: 88 });
  assert.equal(neutral.eyes.openness, 8);
  assert.equal(neutral.eyes.left.ry, 8);
  assert.equal(neutral.eyes.right.ry, 8);
  assert.equal(neutral.brows.lift, 8);
  assert.equal(neutral.mouth.curvature, 0);
  assert.equal(neutral.mouth.opening, 10);
  assert.equal(neutral.mouth.controlY, 130);
});

test("valence bends the mouth toward distinct positive and negative expressions", () => {
  const negative = createResponsiveFaceGeometry({ valence: -1, arousal: 0 });
  const neutral = createResponsiveFaceGeometry({ valence: 0, arousal: 0 });
  const positive = createResponsiveFaceGeometry({ valence: 1, arousal: 0 });

  assert.equal(negative.mouth.curvature, -24);
  assert.equal(neutral.mouth.curvature, 0);
  assert.equal(positive.mouth.curvature, 24);
  assert.ok(negative.mouth.controlY < neutral.mouth.controlY);
  assert.ok(positive.mouth.controlY > neutral.mouth.controlY);
  assert.notEqual(negative.mouth.center.d, positive.mouth.center.d);
  assert.deepEqual(negative.eyes, positive.eyes);
  assert.deepEqual(negative.brows, positive.brows);
  assert.equal(negative.mouth.opening, positive.mouth.opening);
});

test("arousal opens the eyes and mouth and raises the brows monotonically", () => {
  const low = createResponsiveFaceGeometry({ valence: 0, arousal: -1 });
  const neutral = createResponsiveFaceGeometry({ valence: 0, arousal: 0 });
  const high = createResponsiveFaceGeometry({ valence: 0, arousal: 1 });

  assert.deepEqual(
    [low.eyes.openness, neutral.eyes.openness, high.eyes.openness],
    [2, 8, 14],
  );
  assert.deepEqual(
    [low.mouth.opening, neutral.mouth.opening, high.mouth.opening],
    [0, 10, 20],
  );
  assert.deepEqual(
    [low.brows.lift, neutral.brows.lift, high.brows.lift],
    [0, 8, 16],
  );
  assert.notEqual(low.brows.left.d, high.brows.left.d);
  assert.notEqual(low.mouth.shape.d, high.mouth.shape.d);
  assert.equal(low.mouth.curvature, high.mouth.curvature);
});

test("every numeric field and SVG path remains finite and inside the view box", () => {
  const cases = [
    {},
    { valence: -1, arousal: -1 },
    { valence: 1, arousal: 1 },
    { valence: 0.271828, arousal: -0.314159 },
    { valence: Number.NEGATIVE_INFINITY, arousal: Number.NaN },
  ];

  for (const input of cases) {
    const geometry = createResponsiveFaceGeometry(input);
    assert.ok(numericLeaves(geometry).every(Number.isFinite));
    assertFinitePath(geometry.brows.left.d);
    assertFinitePath(geometry.brows.right.d);
    assertFinitePath(geometry.mouth.center.d);
    assertFinitePath(geometry.mouth.shape.d);
  }
});
