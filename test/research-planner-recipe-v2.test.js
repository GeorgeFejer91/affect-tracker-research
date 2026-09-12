import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalJson } from "../site/src/research/canonical.js";
import { plannerRecipeV2Fixture } from "./fixtures/planner-recipe-v2-fixture.js";
import { compilePlannerRecipeV2, validatePlannerRecipeV2, parsePlannerRecipeV2, parsePlannerRecipeV1,
  parseSupportedPlannerRecipe, serializePlannerRecipeV2, serializePlannerRecipeV1 } from "../site/src/research/planner-recipe.js";

const fixture = await plannerRecipeV2Fixture();
test("explicit master2 reconstructs exact mixed EN/DE forms without altering other owners", async () => {
  const { recipe, reproduction, selections } = fixture;
  assert.equal(recipe.version, 2); assert.equal(recipe.integrity.algorithmVersion, "planner-recipe-reproduction-v3");
  assert.equal(reproduction.algorithmVersion, "planner-recipe-reproduction-v3");
  const legacy = JSON.parse(await readFile(new URL("./fixtures/planner-recipe-current-v1.canonical.json", import.meta.url), "utf8"));
  for (const id of ["P1", "P3", "P4", "P5", "P6"]) assert.deepEqual(recipe.segments[id], legacy.segments[id]);
  assert.equal(selections.length, reproduction.caseCount);
  for (const selection of selections) {
    assert.equal(selection.version, 2);
    assert.equal(selection.questionnaires.beforeSession[0].presentation.kind, "fields");
    assert.equal(selection.questionnaires.beforeSession[1].presentation.kind, "likert");
    assert.equal(selection.questionnaires.beforeSession[0].definition.language, selection.language.languageTag);
  }
});
test("versioned parsers reject cross-version input and preserve canonical legacy bytes", async () => {
  const source = await serializePlannerRecipeV2(fixture.recipe), bytes = new TextEncoder().encode(source);
  assert.equal((await parsePlannerRecipeV2(bytes)).canonicalSourceText, source);
  assert.equal((await parseSupportedPlannerRecipe(bytes)).recipe.version, 2);
  await assert.rejects(parsePlannerRecipeV1(bytes));
  const legacy = new Uint8Array(await readFile(new URL("./fixtures/planner-recipe-current-v1.canonical.json", import.meta.url)));
  assert.equal(await serializePlannerRecipeV1((await parseSupportedPlannerRecipe(legacy)).recipe), new TextDecoder().decode(legacy));
  await assert.rejects(parsePlannerRecipeV2(legacy));
});
test("master2 rejects legacy P2, algorithm confusion, owner drift and altered typed hashes", async () => {
  for (const mutate of [r => r.version = 1, r => r.integrity.algorithmVersion = "planner-recipe-reproduction-v2",
    r => r.segments.P2.version = 1, r => r.segments.P2.questionnaires.definitions.at(-1).items[0].prompt = "Changed",
    r => r.segments.P2.presentation.definitions.at(-1).kind = "likert", r => r.segments.P5.opacity = 0.7]) {
    const recipe = structuredClone(fixture.recipe); mutate(recipe);
    await assert.rejects(validatePlannerRecipeV2(recipe));
  }
  const { integrity, ...core } = structuredClone(fixture.recipe);
  assert.equal(canonicalJson(await compilePlannerRecipeV2(core)), canonicalJson(fixture.recipe));
});
