import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalJson, canonicalSha256 } from "../site/src/research/canonical.js";
import { parseSupportedPlannerRecipe, parsePlannerRecipeV4 } from "../site/src/research/planner-recipe.js";
import { externalizePlannerRecipe, parsePlannerRecipeV5, compilePlannerAssetDocument } from "../site/src/research/planner-recipe-assets.js";
import { plannerRecipeTransportText } from "../site/src/research/planner-recipe-transport.js";
import { preparePlannerRecipeReopen } from "../site/src/research/planner-recipe-restore.js";
import { resolveRunnerSelection } from "../runner/src/recipe.js";
import { informationFixture, frameRecords } from "./fixtures/runner-information-fixture.js";
import { inspectInformationStream } from "../runner/src/information-stream.js";

const encoder = new TextEncoder(), source = readFileSync(new URL("./fixtures/planner-recipe-v4-surveyjs.canonical.json", import.meta.url));
const historical = await parseSupportedPlannerRecipe(source), document = await externalizePlannerRecipe(historical);

test("checked-in native fixtures bind exact manifest, asset bytes and every JS plan", async () => {
  assert.equal(document.canonicalSourceText, readFileSync(new URL("./fixtures/planner-recipe-v5.canonical.json", import.meta.url), "utf8"));
  assert.equal(plannerRecipeTransportText(document), readFileSync(new URL("./fixtures/planner-recipe-v5.bundle.json", import.meta.url), "utf8"));
  const plans = [];
  for (const language of ["en", "de"]) for (const variant of document.recipe.segments.P3.variants) plans.push(await resolveRunnerSelection(document, "P001", ["both", language], variant.variantId));
  assert.equal(`${canonicalJson(plans)}\n`, readFileSync(new URL("./fixtures/planner-recipe-v5.plans.json", import.meta.url), "utf8"));
});

test("recorded startup5 reconstructs SurveyJS responses without external files and rejects incomplete snapshots", async () => {
  const fixture = await informationFixture({ surveyJs: true, manifestAssets: true });
  const result = await inspectInformationStream(await frameRecords(fixture.records, fixture.context));
  assert.equal(result.status, "complete", JSON.stringify(result.issues));
  assert.deepEqual(result.plan, fixture.plan);
  assert.equal(result.startup.version, 5);
  for (const mutate of [startup => { delete startup.questionnaireAssets; }, startup => { startup.questionnaireAssets.pop(); }, startup => { startup.questionnaireAssets[0].sourceText += " "; }]) {
    const records = structuredClone(fixture.records); mutate(records[0].value);
    await assert.rejects(inspectInformationStream(await frameRecords(records, fixture.context)));
  }
});
const bytes = value => encoder.encode(`${canonicalJson(value)}\n`);
async function seal(manifest) {
  for (const key of Object.keys(manifest.segments)) manifest.integrity.segmentSha256[key] = await canonicalSha256(manifest.segments[key]);
  manifest.integrity.definitionSha256 = await canonicalSha256(manifest, { omitRootKeys: ["integrity"] }); return manifest;
}

test("manifest5 externalizes native SurveyJS data and freezes all metadata, identities and ordered routes", async () => {
  assert.equal(document.recipe.version, 5); assert.equal(document.recipe.segments.P2.version, 4);
  assert.equal(document.recipe.segments.P2.questionnaires.definitions, undefined);
  assert.equal(document.canonicalSourceText.includes('"surveyJson"'), false);
  assert.deepEqual(document.resolvedRecipe, historical.recipe);
  for (let i = 0; i < document.questionnaireAssets.length; i++) {
    assert.deepEqual(JSON.parse(document.questionnaireAssets[i].sourceText), historical.recipe.segments.P2.questionnaires.definitions[i].surveyJson);
  }
  const reopened = await parseSupportedPlannerRecipe(encoder.encode(plannerRecipeTransportText(document)));
  assert.equal(reopened.canonicalSourceText, document.canonicalSourceText);
  for (const language of ["en", "de"]) for (const variant of document.recipe.segments.P3.variants) {
    const old = await resolveRunnerSelection(historical, "P001", ["both", language], variant.variantId);
    const current = await resolveRunnerSelection(reopened, "P001", ["both", language], variant.variantId);
    assert.equal(current.version, 5); assert.equal(current.algorithmVersion, "master-sequence-v5");
    assert.deepEqual(current.steps, old.steps); assert.deepEqual(current.selected, old.selected);
    assert.notEqual(current.planIdentitySha256, old.planIdentitySha256);
    assert.equal(current.recipeSourceByteSha256, document.canonicalSourceByteSha256);
  }
  await assert.rejects(parsePlannerRecipeV4(bytes(document.recipe)));
  assert.equal((await parsePlannerRecipeV4(source)).canonicalSourceText, source.toString());
});

test("missing, extra, reordered, altered and unsafe questionnaire resources reject before adoption", async () => {
  const assets = structuredClone(document.questionnaireAssets);
  await assert.rejects(parsePlannerRecipeV5(bytes(document.recipe)));
  await assert.rejects(parsePlannerRecipeV5(bytes(document.recipe), assets.slice(1)));
  await assert.rejects(parsePlannerRecipeV5(bytes(document.recipe), [...assets, assets[0]]));
  await assert.rejects(parsePlannerRecipeV5(bytes(document.recipe), [...assets].reverse()));
  assets[0].sourceText = assets[0].sourceText.replace("Provide details?", "Changed details?");
  await assert.rejects(parsePlannerRecipeV5(bytes(document.recipe), assets));
  for (const path of ["../survey.json", "/survey.json", "C:/survey.json", "assets/questionnaires/../survey.json", "https://example.com/survey.json", "assets\\questionnaires\\survey.json"]) {
    const manifest = structuredClone(document.recipe); manifest.segments.P2.questionnaires.assets[0].relativePath = path;
    await assert.rejects(parsePlannerRecipeV5(bytes(await seal(manifest)), document.questionnaireAssets));
  }
  for (const mutation of [m => {m.unexpected = true;}, m => {m.segments.P2.questionnaires.definitions = [];}, m => {m.segments.P2.questionnaires.assets[0].metadata.engineVersion = "999";}, m => {m.segments.P2.languageSelection.languages[0].questionnaireModuleIds.reverse();}]) {
    const manifest = structuredClone(document.recipe); mutation(manifest);
    await assert.rejects(parsePlannerRecipeV5(bytes(await seal(manifest)), document.questionnaireAssets));
  }
});

test("fresh non-SurveyJS authoring also uses files while unchanged historical sources stay readable", async () => {
  const old = await parseSupportedPlannerRecipe(readFileSync(new URL("./fixtures/planner-recipe-v3-locations.canonical.json", import.meta.url)));
  const { integrity, ...core } = structuredClone(old.recipe);
  const saved = await compilePlannerAssetDocument(core);
  assert.equal(saved.recipe.version, 5);
  assert.deepEqual(saved.resolvedRecipe.segments.P2.questionnaires.definitions, old.recipe.segments.P2.questionnaires.definitions);
  assert(saved.recipe.segments.P2.questionnaires.assets.every(a => a.format === "questionnaire-definition"));
  const reopened = await preparePlannerRecipeReopen(plannerRecipeTransportText(saved), { isCurrent: () => true, parseDocument: parseSupportedPlannerRecipe });
  const seen = {};
  await reopened.apply(Object.fromEntries(["begin", "P1", "P2", "P5", "P3", "P4", "P6", "policy", "presentationTarget"].map(key => [key, key === "begin" ? () => {} : value => { seen[key] = value; return true; }])));
  assert.deepEqual(seen.P2, saved.resolvedRecipe.segments.P2);
});

test("two clean independent processes reconstruct every variant/language from the same read-only file tree", () => {
  const root = mkdtempSync(join(tmpdir(), "affect-manifest-"));
  try {
    writeFileSync(join(root, "experiment.json"), document.canonicalSourceText);
    for (const asset of document.questionnaireAssets) { const path = join(root, asset.relativePath); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, asset.sourceText); }
    const results = [1, 2].map(() => {
      const child = spawnSync(process.execPath, ["test/fixtures/questionnaire-manifest-instance.js", root], { cwd: new URL("..", import.meta.url), encoding: "utf8", windowsHide: true });
      assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout);
    });
    assert.deepEqual(results[0], results[1]); assert.equal(results[0].source, document.canonicalSourceText);
    assert.equal(results[0].cases.length, document.recipe.segments.P3.variants.length * 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
