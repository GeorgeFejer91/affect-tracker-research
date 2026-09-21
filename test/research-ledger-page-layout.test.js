import test from "node:test";
import assert from "node:assert/strict";
import { packLedgerPageItems } from "../experiment-planner/web/src/research/ledger-page-layout.js";
import { chooseLargestFittingSize } from "../experiment-planner/web/src/research/text-fit.js";

test("ledger page packing preserves item order and merges boxes when room grows", () => {
  const items = [2, 3, 4, 1];
  const pack = capacity => packLedgerPageItems(items, page => page.reduce((sum, value) => sum + value, 0) <= capacity);
  assert.deepEqual(pack(6), [[2, 3], [4, 1]]);
  assert.deepEqual(pack(10), [[2, 3, 4, 1]]);
  assert.deepEqual(pack(3), [[2], [3], [4], [1]], "an indivisible oversized box remains its own page");
});

test("bounded text fitting chooses the largest readable size and reports an explicit floor failure", () => {
  assert.deepEqual(chooseLargestFittingSize({ min: 12, preferred: 18, fits: size => size <= 15 }), { size: 15, state: "fit" });
  assert.deepEqual(chooseLargestFittingSize({ min: 12, preferred: 18, fits: () => false }), { size: 12, state: "no-fit" });
  assert.deepEqual(chooseLargestFittingSize({ min: 12, preferred: 18, fits: () => true }), { size: 18, state: "fit" });
});
