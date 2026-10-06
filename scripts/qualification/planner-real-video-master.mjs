// One production Planner CLI save for the installed Runner's local validation path.
// No master JSON, video metadata or media receipt is synthesized here.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validatePlannerAssetManifest } from "../../site/src/research/planner-recipe-assets.js";
import { readRunnerRecipe, resolveRunnerSelection } from "../../runner/src/recipe.js";
import { runPlannerCli } from "./planner-cli-driver.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const op = (owner, operation, args = {}) => ({ kind: "operation", owner, operation, arguments: args });
const set = (field, value) => ({ kind: "set", field, value });
const apply = edits => ({ kind: "apply", edits });
const perform = (operation, args) => ({ kind: "perform", operation, arguments: args });

async function main() {
  const [cliArg, workspaceArg, evidenceArg, videoArg, widthArg, heightArg] = process.argv.slice(2);
  assert.ok(cliArg && workspaceArg && evidenceArg && videoArg && widthArg && heightArg,
    "Usage: node planner-real-video-master.mjs <installed-CLI> <empty-workspace> <new-evidence-dir> <real-MP4> <CSS-width> <CSS-height>");
  const [executable, workspace, evidence, video] = [cliArg, workspaceArg, evidenceArg, videoArg].map(path => resolve(path));
  assert.ok([executable, workspace, evidence, video].every(isAbsolute));
  const width = Number(widthArg), height = Number(heightArg);
  assert.ok(Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0,
    "Supply positive integer fullscreen CSS width and height.");
  assert.deepEqual(await readdir(workspace), [], "Use a fresh, empty workspace.");
  const [cliBytes, videoBytes] = await Promise.all([readFile(executable), readFile(video)]);
  const videoSha256 = sha(videoBytes);
  let annotationId, catalogueEntry, saveResult, sourceCommit;
  const steps = [];
  const step = (action, expectStatus, checkResponse) => steps.push({ action, ...(expectStatus ? { expectStatus } : {}), ...(checkResponse ? { checkResponse } : {}) });
  const settling = requireLayout => steps.push({ action: { kind: "snapshot" }, expectStatus: "ok", maxQueries: 100,
    queryIntervalMs: 50, until(response) {
      const { P1, P3, P4 } = response.result.owners;
      const entry = P1.values["P1.media.catalogue"]?.entries?.[0];
      return P1.values["P1.media.ready"] === true && entry && P1.values["P1.media.catalogue"].entries.length === 1
        && P3.values["P3.videoAnnotations"]?.includes(entry.annotationId)
        && P4.values["P4.reference.candidates"]?.largestVideo?.assetId === entry.assetId
        && (!requireLayout || (P4.values["P4.geometry"] && P4.values["P4.videoFits"]?.length === 1));
    } });
  step({ kind: "snapshot" }, "ok", ({ response }) => {
    assert.equal(response.result.owners.P1.values["P1.workspace.selected"], false);
  });
  step(perform("selectWorkspace", { directory: workspace }));
  step(apply([
    set("P1.study.id", "real-video-validation"), set("P1.study.title", "Synthetic local video validation"),
    set("P2.languages", [{ languageId: "en", languageTag: "en", label: "English" }]),
    set("P7.participantCount", 1), set("P7.presentationTarget", "desktop-screen"),
    set("P7.samplingFrequencyHz", 60), set("P7.output.csv", true), set("P7.output.tsv", true),
    set("P7.lsl.enabled", true), set("P7.lsl.sourceId", "real-video-validation"),
  ]));
  step(perform("importVideos", { paths: [video] }));
  settling(false);
  step({ kind: "get", field: "P1.media.catalogue" }, "ok", ({ response }) => {
    assert.equal(response.result.value.entries.length, 1);
    catalogueEntry = response.result.value.entries[0];
    annotationId = catalogueEntry.annotationId;
    assert.ok(catalogueEntry.durationMs > 0 && catalogueEntry.geometry);
    assert.ok(JSON.stringify(catalogueEntry).includes(videoSha256), "Actual import does not bind source bytes.");
  });
  step(apply([op("P2", "addDemographics")]));
  step({ kind: "get", field: "P2.questionnaires" }, "ok");
  step(({ lastResponse }) => {
    assert.equal(lastResponse.result.value.length, 1);
    return perform("saveQuestionnaire", { questionnaireId: lastResponse.result.value[0].questionnaireId });
  });
  step(apply([op("P3", "table.reset")]));
  step(apply([
    set("P4.units", "relative"), set("P4.viewport.widthCssPx", width), set("P4.viewport.heightCssPx", height),
    set("P4.reference.method", "largest-oriented-area"),
    set("P4.reference.maximumWidth", 60), set("P4.reference.maximumHeight", 60),
    set("P4.reference.centreX", 50), set("P4.reference.centreY", 35),
    set("P4.feedback.viewportSide", 12), set("P4.feedback.centreX", 50),
    set("P4.feedback.centreY", 75), set("P4.feedback.minimumGap", 3),
  ]));
  step(set("P6.enabled", false));
  step({ kind: "snapshot" }, "ok");
  step(({ lastResponse }) => apply([
    ...(lastResponse.result.owners.P5.values["P5.generation"] === 1 ? [op("P5", "initializeV2")] : []),
    op("P5", "inputPreset", { preset: "arrowKeys" }),
  ]));
  step({ kind: "snapshot" }, "ok");
  step(({ lastResponse }) => {
    const modules = lastResponse.result.owners.P2.values["P2.modules"];
    assert.equal(modules.length, 1);
    const tree = { algorithmVersion: "language-tree-v1", rootNodeId: "language",
      nodes: [{ nodeId: "language", prompt: "Choose your language", options: [
        { optionId: "en", label: "English", target: { kind: "language", languageId: "en" } }] }],
      languages: [{ languageId: "en", languageTag: "en", label: "English", questionnaireModuleIds: [modules[0].moduleId] }] };
    return set("P2.languageSelection", tree);
  });
  step({ kind: "get", field: "P3.draft" }, "ok");
  step(({ lastResponse }) => {
    const draft = lastResponse.result.value;
    assert.equal(draft.columns.length, 1);
    assert.ok(draft.entryIds.length >= 1);
    return apply([op("P3", "cell.set", { entryId: draft.entryIds[0][0], referenceId: annotationId }),
      ...draft.entryIds.slice(1).map(row => op("P3", "row.remove", { entryId: row[0] }))]);
  });
  settling(true);
  for (const segment of ["P1", "P2", "P3", "P4", "P6"]) step(perform("confirmSegment", { segment }));
  step(perform("saveRecipe", { directory: workspace }), "applied", ({ response }) => { saveResult = response; });
  const receipt = await runPlannerCli({ executable, steps, outputDirectory: evidence });
  assert.equal(receipt.passed, true, receipt.failure);
  sourceCommit = receipt.ready.buildCommit;
  const savedNames = (await readdir(workspace)).filter(name => /^real-video-validation-recipe_.*\.json$/u.test(name));
  assert.equal(savedNames.length, 1, "Expected exactly one production CLI saved master.");
  const recipePath = join(workspace, savedNames[0]);
  const recipeBytes = await readFile(recipePath), recipe = JSON.parse(recipeBytes);
  assert.equal(recipe.version, 5);
  assert.equal(recipe.segments.P1.videoCatalogue.entries.length, 1);
  assert.equal(recipe.segments.P3.variants.length, 1);
  assert.equal(recipe.segments.P3.variants[0].entries.length, 1);
  assert.equal(recipe.segments.P3.variants[0].entries[0].kind, "video");
  assert.equal(recipe.policy.lsl.enabled, true);
  assert.equal(recipe.policy.samplingFrequencyHz, 60);
  assert.equal(recipe.segments.P4.viewport.widthCssPx, width);
  assert.equal(recipe.segments.P4.viewport.heightCssPx, height);
  assert.ok(JSON.stringify(saveResult).includes(sha(recipeBytes)), "Native save receipt does not bind saved bytes.");
  await validatePlannerAssetManifest(recipe);
  assert.equal(sha(await readFile(join(workspace, catalogueEntry.packageRelativePath))), videoSha256,
    "Imported workspace media changed after save.");
  const assets = await Promise.all(recipe.segments.P2.questionnaires.assets.map(async ref => ({
    relativePath: ref.relativePath, sourceText: await readFile(join(workspace, ref.relativePath), "utf8"),
  })));
  const parsed = await readRunnerRecipe(recipeBytes, assets);
  const plan = await resolveRunnerSelection(parsed, "P001", ["en"], recipe.segments.P3.variants[0].variantId);
  assert.deepEqual(plan.steps.map(step => step.kind), ["questionnaire", "video"]);
  assert.equal(plan.steps[1].payload.asset.sha256, videoSha256);
  const strictRead = { schema: "affect-planner-real-video-strict-runner-read", version: 1,
    sourceSha256: sha(recipeBytes), recipeVersion: parsed.recipe.version, assetCount: assets.length,
    planIdentitySha256: plan.planIdentitySha256, selector: plan.selector,
    steps: plan.steps.map(step => ({ position: step.position, kind: step.kind,
      entryId: step.entryId, durationMs: step.durationMs, assetSha256: step.payload?.asset?.sha256 ?? null })) };
  await writeFile(join(evidence, "strict-runner-read.json"), `${JSON.stringify(strictRead, null, 2)}\n`, { flag: "wx" });
  await writeFile(join(evidence, "master-review.json"), `${JSON.stringify({
    schema: "affect-planner-real-video-master-review", version: 1, status: "planner-save-only",
    sourceCommit, cli: { path: executable, sha256: sha(cliBytes), byteLength: cliBytes.length },
    sourceVideo: { path: video, sha256: videoSha256, byteLength: (await stat(video)).size },
    importedCatalogueEntry: catalogueEntry, master: { path: recipePath, sha256: sha(recipeBytes), byteLength: recipeBytes.length },
    transcriptSha256: receipt.transcriptSha256, planIdentitySha256: plan.planIdentitySha256, syntheticParticipantOnly: true,
    limit: "No Runner playback, LSL/XDF or installed qualification is established by this Planner save.",
  }, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ master: recipePath, sha256: sha(recipeBytes), evidence, sourceCommit }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
