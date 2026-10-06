import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { prepareVlcMasterIntake, startVlcMaster } from "../experiments/vlc-flubber/master-intake.js";
import { readRunnerRecipe, resolveRunnerSelection } from "../runner/src/recipe.js";
import { enumerateLanguageRoutesV1 } from "../site/src/research/experiment-package.js";

const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url));

test("VLC intake keeps the exact standard Runner selection for master1–5 and cannot Start", async () => {
  for (const name of [
    "planner-recipe-current-v1.canonical.json",
    "planner-recipe-v2-mixed.canonical.json",
    "runner-master-v3-owner.canonical.json",
    "planner-recipe-v4-surveyjs.canonical.json",
    "planner-recipe-v5.bundle.json",
  ]) {
    const bundle = name.endsWith(".bundle.json") ? JSON.parse(await fixture(name)) : null;
    const bytes = bundle ? Buffer.from(bundle.recipeSourceText) : await fixture(name);
    const assets = bundle?.questionnaireAssets;
    const receipt = await readRunnerRecipe(bytes, assets);
    const route = enumerateLanguageRoutesV1(receipt.recipe.segments.P2.languageSelection)[0];
    const variantId = receipt.recipe.segments.P3.variants[0].variantId;
    const selected = await prepareVlcMasterIntake(bytes, "P001", route.optionIds, variantId, assets);
    const standard = await resolveRunnerSelection(receipt, "P001", route.optionIds, variantId);
    assert.deepEqual(selected.plan, standard, name);
    assert.equal(selected.plan.recipeSourceByteSha256, createHash("sha256").update(bytes).digest("hex"), name);
    assert.equal(selected.sourceText, bytes.toString(), name);
    assert.equal(selected.canStart, false);
    assert.throws(startVlcMaster, /not implemented/u);
  }
});

test("VLC intake rejects sidequest schemas, damaged masters and unsupported selections", async () => {
  const bytes = await fixture("planner-recipe-current-v1.canonical.json");
  const receipt = await readRunnerRecipe(bytes);
  const route = enumerateLanguageRoutesV1(receipt.recipe.segments.P2.languageSelection)[0];
  const variantId = receipt.recipe.segments.P3.variants[0].variantId;
  await assert.rejects(prepareVlcMasterIntake(Buffer.from('{"schema":"flubbercorder-experiment/v1"}\n'), "P001", route.optionIds, variantId));
  await assert.rejects(prepareVlcMasterIntake(await fixture("experiment-package-v1.canonical.json"), "P001", route.optionIds, variantId), /Planner master/u);
  await assert.rejects(prepareVlcMasterIntake(Buffer.from(bytes.toString().replace('"version":1', '"version":6')), "P001", route.optionIds, variantId));
  await assert.rejects(prepareVlcMasterIntake(bytes, "P000", route.optionIds, variantId), /participant/u);
  await assert.rejects(prepareVlcMasterIntake(bytes, "P001", [], variantId), /language/u);
  await assert.rejects(prepareVlcMasterIntake(bytes, "P001", route.optionIds, "missing-variant"), /variant/u);
  const bundle = JSON.parse(await fixture("planner-recipe-v5.bundle.json"));
  await assert.rejects(prepareVlcMasterIntake(Buffer.from(bundle.recipeSourceText), "P001", route.optionIds, variantId), /asset|questionnaire/iu);
});
