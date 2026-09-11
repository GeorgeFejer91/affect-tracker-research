import test from "node:test";
import assert from "node:assert/strict";
import { parsePreviewTileCount, previewTileGeometry, previewTileLines, snapPreviewCoordinate } from "../site/src/research/preview-tiles.js";
import { createPreviewResponseSimulator } from "../site/src/research/preview-response-simulator.js";

test("tile count accepts custom odd integers and rejects invalid intermediate input", () => {
  for (const count of [3, 5, 7, 21, 101, 2001]) assert.equal(parsePreviewTileCount(String(count)), count);
  for (const count of ["", " ", null, undefined, false, [], {}, Symbol(), 0, 1, 2, 4, 5.5, 2003, Infinity, NaN]) {
    assert.equal(parsePreviewTileCount(count), null);
  }
  assert.throws(() => previewTileLines(4), RangeError);
});

test("each odd grid has a central zero tile, equal sides, and bounded corner outlines", () => {
  for (const count of [3, 5, 21, 101, 2001]) {
    const center = previewTileGeometry(0, 0, count);
    assert.equal(center.column, (count - 1) / 2);
    assert.equal(center.row, (count - 1) / 2);
    assert.ok(Math.abs(center.x + center.width / 2 - 50) < 1e-10);
    assert.ok(Math.abs(center.y + center.height / 2 - 50) < 1e-10);
    for (const [x, y] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) {
      const tile = previewTileGeometry(x, y, count);
      assert.ok(tile.x >= 0 && tile.y >= 0);
      assert.ok(tile.x + tile.width <= 100 + 1e-10);
      assert.ok(tile.y + tile.height <= 100 + 1e-10);
      assert.equal(tile.column, x < 0 ? 0 : count - 1);
      assert.equal(tile.row, y > 0 ? 0 : count - 1);
    }
    assert.equal((previewTileLines(count).match(/M/g) ?? []).length, 2 * (count - 1));
  }
});

test("one arrow edge crosses one tile with exact neutral and symmetric endpoints", () => {
  for (const tileCount of [3, 5, 7, 21, 2001]) {
    const simulator = createPreviewResponseSimulator();
    simulator.configure({ tileCount });
    for (let index = 1; index <= (tileCount - 1) / 2; index += 1) {
      simulator.press("right");
      simulator.release("right");
      assert.equal(previewTileGeometry(simulator.snapshot().x, 0, tileCount).column, (tileCount - 1) / 2 + index);
    }
    assert.equal(simulator.snapshot().x, 1);
    for (let index = 1; index <= tileCount - 1; index += 1) {
      simulator.press("left");
      simulator.release("left");
      if (index === (tileCount - 1) / 2) assert.equal(simulator.snapshot().x, 0);
    }
    assert.equal(simulator.snapshot().x, -1);
    simulator.destroy();
  }
});

test("tile changes snap coordinates, cancel holds, and invalid drafts preserve accepted count", () => {
  const simulator = createPreviewResponseSimulator({ requestFrame: () => 1, cancelFrame() {} });
  simulator.configure({ tileCount: 21, holdRule: "repeatWhileHeld" });
  simulator.press("right");
  simulator.configure({ tileCount: 3 });
  assert.equal(simulator.snapshot().x, 0);
  assert.deepEqual(simulator.snapshot().heldDirections, []);
  for (const invalid of ["", 4, 5.2, -3, 2003, Infinity]) {
    simulator.configure({ tileCount: invalid });
    assert.equal(simulator.snapshot().tileCount, 3);
  }
  simulator.configure({ mode: "continuous" });
  simulator.setPoint({ x: 0.44, y: -0.8 });
  assert.equal(simulator.snapshot().x, 0.44);
  simulator.configure({ mode: "stepwise", tileCount: 5 });
  assert.equal(simulator.snapshot().x, 0.5);
  assert.equal(simulator.snapshot().y, -1);
  assert.equal(snapPreviewCoordinate(-0.25, 5), -0.5);
  assert.equal(snapPreviewCoordinate(0.25, 5), 0.5);
  simulator.reset();
  assert.equal(simulator.snapshot().x, 0);
  simulator.destroy();
});
