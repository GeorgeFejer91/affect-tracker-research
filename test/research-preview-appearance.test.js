import test from "node:test";
import assert from "node:assert/strict";
import { affectPaletteColor } from "../site/src/math.js";
import { PREVIEW_GREY, PREVIEW_ANCHORS, parsePreviewNumber, randomPreviewAnchors, previewPaletteColor } from "../site/src/research/preview-appearance.js";

const colors = { up: "#ff0000", right: "#00ff00", down: "#0000ff", left: "#ffffff" };

test("numeric halo drafts reject empty/non-finite/negative values without an arbitrary input ceiling", () => {
  for (const value of ["", " ", NaN, Infinity, -Infinity, "Infinity", -1, null, undefined, {}, Symbol()]) {
    assert.equal(parsePreviewNumber(value), null);
  }
  for (const value of [0, 0.25, 240, 999, 1e300]) assert.equal(parsePreviewNumber(String(value)), value);
  assert.equal(parsePreviewNumber(0, 0.1), null);
});

test("Recolor explicitly generates one full RGB value for each anchor", () => {
  let calls = 0;
  assert.deepEqual(randomPreviewAnchors(bytes => {
    calls++; bytes.set([0, 1, 2, 255, 254, 253, 16, 32, 48, 128, 144, 160]); return bytes;
  }), { up: "#000102", right: "#fffefd", down: "#102030", left: "#8090a0" });
  assert.equal(calls, 1);
});

test("corner interpolation hits all four anchors and blends the center", () => {
  for (const [x, y, expected] of [[-1, 1, "255 0 0"], [1, 1, "0 255 0"], [1, -1, "0 0 255"], [-1, -1, "255 255 255"], [0, 0, "128 128 128"]]) {
    assert.equal(previewPaletteColor(x, y, colors, "corners"), `rgb(${expected})`);
  }
  assert.equal(previewPaletteColor(1, 1, colors, "corners", 0), "rgb(183 183 183)");
});

test("axes retain authoritative interpolation and neutral reset greys the entire map in either mode", () => {
  const grey = Object.fromEntries(PREVIEW_ANCHORS.map(id => [id, PREVIEW_GREY]));
  for (let x = -1; x <= 1; x += 0.25) for (let y = -1; y <= 1; y += 0.25) {
    assert.equal(previewPaletteColor(x, y, colors), affectPaletteColor(x, y, colors));
    for (const mode of ["axes", "corners"]) assert.equal(previewPaletteColor(x, y, grey, mode), "rgb(183 183 183)");
  }
});
