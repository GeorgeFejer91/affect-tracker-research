import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { plannerRecipeFilename } from "../site/src/research/planner-recipe-filename.js";

const fixtures = JSON.parse(await readFile(new URL("./fixtures/planner-recipe-filenames.json", import.meta.url), "utf8"));

test("native/browser version names share UTC millisecond fixtures", () => {
  for (const fixture of fixtures) {
    assert.equal(plannerRecipeFilename(fixture.recipeId, { now: new Date(fixture.unixMilliseconds) }), fixture.filename);
  }
  assert.equal(plannerRecipeFilename("a", { now: new Date("2024-03-01T01:59:59.123+02:00") }),
    "a_2024-02-29_23-59-59-123Z.json");
});

test("filename never accepts path syntax, repaired IDs or invalid dates", () => {
  for (const id of ["", "../recipe", "a/b", "a\\b", "C:recipe", "a.json", "a ", "UPPER", "ä", "_a", "a".repeat(129), null]) {
    assert.throws(() => plannerRecipeFilename(id));
  }
  for (const now of [new Date(NaN), new Date("+010000-01-01T00:00:00Z"), new Date("0000-01-01T00:00:00Z"), 0, "2024-01-01"]) {
    assert.throws(() => plannerRecipeFilename("a", { now }));
  }
  assert.ok(plannerRecipeFilename("a".repeat(128)).endsWith("Z.json"));
});
