// Author the requested mock solely through an actual production CLI process.
// No editor/compiler imports, source substitution, fake acceptance or retries.
// Configuration supplies local source paths and expected hashes; nothing here
// writes a master recipe. Only the production saveRecipe command does that.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runPlannerCli } from "./planner-cli-driver.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const languages = [{ languageId: "en", languageTag: "en", label: "English" },
  { languageId: "de", languageTag: "de", label: "Deutsch" }];
const families = ["demographics", "maia-2", "tas-20"];
const requiredConsequences = ["selectWorkspace", "importVideos", "importVideoFolder", "rescanVideoLibrary",
  "importQuestionnaire", "saveQuestionnaire", "confirmSegment", "saveRecipe", "openRecipe"];
const op = (owner, operation, args = {}) => ({ kind: "operation", owner, operation, arguments: args });
const set = (field, value) => ({ kind: "set", field, value });
const apply = edits => ({ kind: "apply", edits });
const perform = (operation, args) => ({ kind: "perform", operation, arguments: args });
const get = field => ({ kind: "get", field });

/** Actual successful native effects may leave unrelated authoring drafts open.
 * Only the observed domain-readiness issues below may accompany publication. */
export function assertPublishedConsequence({request, response}) {
  const operation = request.action.operation;
  const allowed = operation === "selectWorkspace" ? [["P1", "P1.media.catalogue", "media_pending"]]
    : ["importQuestionnaire", "saveQuestionnaire"].includes(operation)
      ? [["P2", "P2.questionnaires", "unsaved_draft"], ["P2", "P2.languages", "missing_language_asset"],
        // Import fills the initially empty language slots in sequence. All
        // imports must finish before saving; invalid drafts are never allowed
        // on save or confirmation and cannot pass final artifact comparison.
        ...(operation === "importQuestionnaire" ? [["P2", "P2.questionnaires", "invalid_draft"]] : [])] : [];
  assert.ok(["applied", "incomplete"].includes(response.status));
  assert.equal(response.result?.operation, operation);
  assert.equal(response.result.published, true, "Native result was not adopted");
  assert.equal(response.status, response.issues.length ? "incomplete" : "applied");
  for (const issue of response.issues) assert.ok(allowed.some(([owner,field,code]) => issue.owner === owner && issue.field === field && issue.code === code),
    `Unexpected ${operation} issue: ${issue.code}`);
  if (operation === "confirmSegment") {
    assert.equal(response.result.result?.confirmed, true);
    assert.equal(response.result.result.segment, request.action.arguments.segment);
    return;
  }
  const effect = response.result.effect;
  assert.equal(effect?.operation, operation, "Wrong native acknowledgement operation");
  assert.equal(effect.requestId, request.requestId, "Wrong native acknowledgement request");
  assert.equal(effect.stage, "completed");
  assert.equal(effect.outcome, "acknowledged", "Native effect has no successful acknowledgement");
  assert.equal(typeof effect.possiblyChanged, "boolean");
  assert.ok(effect.receipt && typeof effect.receipt === "object" && !Array.isArray(effect.receipt));
  if (operation === "openRecipe") assert.equal(response.result.progress?.finished, true);
}

// Read only exposed owner fields. This observes settled bindings; subsequent
// mutations still use the production revision/dependency guards and may reject.
export function mockBindingsReady(response, { requireLayout = false } = {}) {
  assert.equal(response.status, "ok");
  const owners = response.result.owners;
  const p1 = owners.P1.values, p3 = owners.P3.values, p4 = owners.P4.values;
  if (p1["P1.media.ready"] !== true) return false;
  const entries = p1["P1.media.catalogue"]?.entries;
  if (!Array.isArray(entries) || entries.length !== 1) return false;
  if (owners.P1.issues.length || owners.P3.issues.some(issue => ["dependency_unavailable", "owner_busy"].includes(issue.code))) return false;
  if (JSON.stringify(p3["P3.videoAnnotations"]) !== JSON.stringify(entries.map(entry => entry.annotationId))) return false;
  const reference = p4["P4.reference.candidates"]?.largestVideo, entry = entries[0];
  if (!reference || reference.assetId !== entry.assetId || reference.width !== entry.geometry?.displayWidthPx
    || reference.height !== entry.geometry?.displayHeightPx) return false;
  if (owners.P4.issues.some(issue => /^catalogue-|^feedback-unavailable$/u.test(issue.code))) return false;
  if (requireLayout && (owners.P4.issues.length || !p4["P4.geometry"] || p4["P4.videoFits"]?.length !== 1
    || p4["P4.videoFits"][0].id !== entry.assetId)) return false;
  if (owners.P6.values["P6.enabled"]) {
    const revision = p1["P1.workspace.snapshot"]?.revision;
    if (!owners.P6.values["P6.dependencies"]?.some(value => value.segment === "P1" && value.revision === revision)
      || owners.P6.issues.some(issue => issue.code === "dependency_pending")) return false;
  }
  return true;
}

async function fileHash(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}
function objects(value) {
  if (!value || typeof value !== "object") return [];
  return [value, ...Object.values(value).flatMap(objects)];
}
function savedFile(result, directory) {
  assert.equal(result.status, "applied", "Save must be adopted and acknowledged, not incomplete");
  assert.equal(result.result.operation, "saveRecipe");
  assert.equal(result.result.published, true);
  const nodes = objects(result.result);
  const names = [...new Set(nodes.map(node => node.basename).filter(name => typeof name === "string"))];
  assert.equal(names.length, 1, "Save must return exactly one actual basename");
  const basename = names[0];
  assert.match(basename, /^mock-dictator-recipe_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}Z(?:_\d{3})?\.json$/u);
  const receipts = nodes.filter(node => node.schema === "affect-research-planner-recipe-save-receipt");
  assert.ok(receipts.length, "Missing exact native save acknowledgement");
  assert.ok(receipts.every(receipt => JSON.stringify(receipt) === JSON.stringify(receipts[0])));
  return { path: join(directory, basename), basename, receipt: receipts[0] };
}

/** Compare saved authoring semantics with the exact inputs/returned identities.
 * Native save/Runner readers separately validate schemas and derived integrity. */
export function assertMockRecipe(recipe, expected, participantCount) {
  assert.equal(recipe.recipeId, "mock-dictator-recipe");
  assert.equal(recipe.version, 2, "Mixed typed demographics require master v2");
  assert.equal(recipe.presentationTarget, "desktop-screen");
  assert.deepEqual(Object.keys(recipe.segments).sort(), ["P1", "P2", "P3", "P4", "P5", "P6"]);
  const { P1, P2, P3, P4, P5, P6 } = recipe.segments;
  assert.equal(P1.study.id, "mock-dictator");
  assert.equal(P1.study.title, "Bilingual MAIA-2 / TAS-20 and Great Dictator mock");
  assert.deepEqual(P1.workspaceLayout, expected.workspaceLayout);
  assert.deepEqual(P1.videoCatalogue.entries, [expected.video]);
  assert.deepEqual(P2.questionnaires.definitions, expected.definitions);
  assert.deepEqual(P2.questionnaires.modules, expected.modules);
  assert.deepEqual(P2.languageSelection, expected.languageTree);
  assert.deepEqual(P3.isiDefinitions, expected.isiDefinitions);
  assert.equal(P3.variants.length, 1);
  assert.equal(P3.variants[0].variantId, expected.variant.variantId);
  assert.equal(P3.variants[0].title, "V1");
  assert.deepEqual(P3.variants[0].entries, expected.variant.entries);
  assert.equal(P3.allocation.kind, "runnerAssigned");
  assert.equal(P4.units, "relative"); assert.equal(P4.target, "desktop-screen"); assert.equal(P4.fit, "contain");
  assert.deepEqual(P4.viewport, { widthCssPx: 1920, heightCssPx: 1080, compatibility: "exact" });
  assert.equal(P4.calibration, null);
  assert.deepEqual(P4.reference.box, { width: 60, height: 60 });
  assert.deepEqual(P4.reference.centre, { x: 50, y: 35 });
  assert.equal(P4.reference.source.policy, "largest-oriented-area");
  assert.equal(P4.reference.source.assetId, expected.video.assetId);
  assert.deepEqual(P4.feedback, { minimumGap: 3, offset: { x: 0, y: 75 }, origin: "design-centre", overlayViewportSide: 24 });
  assert.deepEqual(P5, expected.feedback);
  assert.deepEqual(P6, { status: "excluded" });
  assert.deepEqual(recipe.policy, { ...expected.policy, participantCount });
}

function comparableRecipe(recipe) {
  const result = structuredClone(recipe);
  delete result.integrity;
  result.policy.participantCount = 0;
  // Rescanning produces fresh catalogue revisions and their derived hashes.
  // All content, identities, order and authored fields remain compared.
  delete result.segments.P1.videoCatalogue.revision;
  delete result.segments.P3.integritySha256;
  delete result.segments.P3.librarySha256;
  for (const variant of result.segments.P3.variants) delete variant.versionSha256;
  return result;
}

export async function authorMockExperiment(config) {
  assert.match(config.expectedCommit, /^[a-f0-9]{40}$/u);
  assert.match(config.expectedExecutableSha256, /^[a-f0-9]{64}$/u);
  for (const key of ["executable", "workspace", "evidenceDirectory", "scratchDirectory"]) assert.ok(isAbsolute(config[key]), key);
  assert.equal(await fileHash(config.executable), config.expectedExecutableSha256, "Wrong executable");
  assert.deepEqual((await readdir(config.workspace)), [], "From-scratch authoring requires a new empty work directory");
  const sources = [config.video, ...config.questionnaires];
  assert.equal(config.questionnaires.length, 4);
  assert.deepEqual(config.questionnaires.map(source => `${source.familyId}/${source.language}`).sort(),
    ["maia-2/de", "maia-2/en", "tas-20/de", "tas-20/en"]);
  const sourceEvidence = [];
  for (const source of sources) {
    assert.ok(isAbsolute(source.path)); assert.match(source.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(await fileHash(source.path), source.sha256, `Source changed: ${source.path}`);
    sourceEvidence.push({ ...source, byteLength: (await stat(source.path)).size });
  }
  await mkdir(config.scratchDirectory); // Exclusive process-scoped temporary root.
  const previousTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP };
  process.env.TEMP = config.scratchDirectory; process.env.TMP = config.scratchDirectory;
  let catalogue, initial, annotationId, lastSnapshot;
  const expected = {};
  const saves = [], sourceSaveResults = [], steps = [];
  const step = (action, expectStatus, checkResponse) => steps.push({ action, ...(expectStatus ? { expectStatus } : {}), ...(checkResponse ? { checkResponse } : {}) });
  const readSnapshot = check => {
    step({ kind: "snapshot" }, "ok");
    return context => { lastSnapshot = context.lastResponse.result; return check(lastSnapshot, context); };
  };
  const checkedPerform = (operation, args) => step(perform(operation, args), undefined, assertPublishedConsequence);
  const settleBindings = requireLayout => steps.push({ action: {kind:"snapshot"}, expectStatus:"ok",
    until: response => mockBindingsReady(response, {requireLayout}), maxQueries:100, queryIntervalMs:50 });
  step({ kind: "catalogue" }, "ok");
  step(({ ready, lastResponse }) => {
    assert.equal(ready.buildCommit, config.expectedCommit);
    catalogue = lastResponse.result;
    assert.deepEqual(catalogue.consequences.map(item => item.id).filter(id => requiredConsequences.includes(id)).sort(), requiredConsequences.toSorted());
    assert.ok(catalogue.operations.some(item => item.owner === "P2" && item.id === "addDemographics"));
    return { kind: "snapshot" };
  }, "ok");
  step(({ lastResponse }) => {
    initial = lastResponse.result;
    assert.equal(initial.owners.P1.values["P1.workspace.selected"], false);
    assert.deepEqual(initial.owners.P2.values["P2.questionnaires"], []);
    expected.workspaceLayout = initial.owners.P1.values["P1.workspace.layout"];
    expected.policy = { schema: "affect-research-planner-recipe-policy", version: 1,
      participantCount: 1, samplingFrequencyHz: 130, output: { csv: true, tsv: true },
      lsl: { enabled: true, stateStream: "AffectResearch", streamType: "Affect", markerStream: "AffectResearchMarkers", sourceId: "mock-dictator" },
      playback: initial.owners.P7.values["P7.playback"] };
    return perform("selectWorkspace", { directory: config.workspace });
  }, undefined, assertPublishedConsequence);
  step(apply([
    set("P1.study.id", "mock-dictator"), set("P1.study.title", "Bilingual MAIA-2 / TAS-20 and Great Dictator mock"),
    set("P2.languages", languages), set("P7.participantCount", 1), set("P7.presentationTarget", "desktop-screen"),
    set("P7.samplingFrequencyHz", 130), set("P7.output.csv", true), set("P7.output.tsv", true),
    set("P7.lsl.enabled", true), set("P7.lsl.stateStream", "AffectResearch"), set("P7.lsl.streamType", "Affect"),
    set("P7.lsl.markerStream", "AffectResearchMarkers"), set("P7.lsl.sourceId", "mock-dictator"),
  ]));
  checkedPerform("importVideos", { paths: [config.video.path] });
  settleBindings(false);
  step(get("P1.media.catalogue"), "ok");
  step(({ lastResponse }) => {
    const library = lastResponse.result.value;
    assert.equal(library.entries.length, 1);
    const video = library.entries[0];
    expected.video = structuredClone(video);
    // Identity comes from the real import; never encode a guessed video ID.
    annotationId = video.annotationId;
    assert.equal(typeof annotationId, "string");
    assert.ok(video.durationMs > 0 && video.geometry);
    assert.ok(JSON.stringify(video).includes(config.video.sha256), "Catalogue must bind the actual video bytes");
    return apply([op("P2", "addDemographics"),
      op("P2", "addQuestionnaire", { familyId: "maia-2", title: "MAIA-2", optionCount: 6, rowCount: 0 }),
      op("P2", "addQuestionnaire", { familyId: "tas-20", title: "TAS-20", optionCount: 5, rowCount: 0 })]);
  });
  for (const source of config.questionnaires) {
    checkedPerform("importQuestionnaire", { path: source.path, familyId: source.familyId, language: source.language });
  }
  for (const familyId of families) for (const language of ["en", "de"]) {
    step(get("P2.questionnaires"), "ok");
    step(({ lastResponse }) => {
      const matches = lastResponse.result.value.filter(draft => draft.familyId === familyId && draft.language === language);
      assert.equal(matches.length, 1);
      return perform("saveQuestionnaire", { questionnaireId: matches[0].questionnaireId });
    }, undefined, assertPublishedConsequence);
    step(({ lastResponse }) => { sourceSaveResults.push(lastResponse); return get("P2.modules"); }, "ok");
  }
  step(readSnapshot(snapshot => {
    const p2 = snapshot.owners.P2.values;
    const definitions = p2["P2.acceptedDefinitions"];
    assert.equal(definitions.length, 6);
    for (const source of config.questionnaires) {
      const draft = p2["P2.questionnaires"].find(draft => draft.familyId === source.familyId && draft.language === source.language);
      const definition = definitions.find(definition => definition.questionnaireId === draft?.questionnaireId);
      assert.ok(definition && definition.language === source.language);
      assert.equal(definition.source.sha256, source.sha256, "Imported definition must identify the selected source bytes");
      assert.equal(definition.items.length, source.familyId === "maia-2" ? 37 : 20);
    }
    for (const language of ["en", "de"]) {
      const definition = definitions.find(definition => definition.questionnaireId === `demographics-${language}`);
      assert.equal(definition?.schema, "affect-research-form-definition");
      assert.deepEqual(definition.items.map(item => item.itemId), ["fullName", "age", "gender", "handedness"]);
      assert.equal(definition.definitionSha256, language === "en"
        ? "0e2432c8ab25ae487679e8326b32ae9695b4d92b778077396129a7a5a5f32c76"
        : "96dbcaae0a354dc828ab92708d0aeecda4cf4d048de102609224be62ae7ab117");
    }
    expected.definitions = structuredClone(definitions);
    const ordered = languages.flatMap(language => families.map(family => {
      const draft = p2["P2.questionnaires"].find(draft => draft.familyId === family && draft.language === language.languageTag);
      const matches = p2["P2.modules"].filter(module => module.questionnaireId === draft.questionnaireId);
      assert.equal(matches.length, 1); assert.equal(matches[0].placement.kind, "beforeSession");
      return matches[0];
    }));
    assert.equal(ordered.length, p2["P2.modules"].length);
    const tree = { algorithmVersion: "language-tree-v1", rootNodeId: "language",
      nodes: [{ nodeId: "language", prompt: "Choose your language / Sprache wählen", options: languages.map(language => ({
        optionId: language.languageId, label: language.label, target: { kind: "language", languageId: language.languageId },
      })) }], languages: languages.map((language, index) => ({ ...language, questionnaireModuleIds: ordered.slice(index * 3, index * 3 + 3).map(module => module.moduleId) })) };
    expected.modules = structuredClone(ordered); expected.languageTree = structuredClone(tree);
    const edits = [set("P2.modules", ordered), set("P2.languageSelection", tree), op("P3", "table.reset"),
      op("P3", "isi.add", { durationMs: 1750 }), op("P3", "isi.add", { durationMs: 3213 }),
      set("P4.units", "relative"), set("P4.viewport.widthCssPx", 1920), set("P4.viewport.heightCssPx", 1080),
      set("P4.reference.method", "largest-oriented-area"), set("P4.reference.maximumWidth", 60), set("P4.reference.maximumHeight", 60),
      set("P4.reference.centreX", 50), set("P4.reference.centreY", 35), set("P4.feedback.viewportSide", 24),
      set("P4.feedback.offsetX", 0), set("P4.feedback.offsetY", 75), set("P4.feedback.minimumGap", 3), set("P6.enabled", false)];
    if (snapshot.owners.P5.values["P5.generation"] === 1) edits.push(op("P5", "initializeV2"));
    edits.push(op("P5", "inputPreset", { preset: "arrowKeys" }), set("P5.visual.hideFeedback", false), set("P5.presentation.renderer", "flubber"));
    return apply(edits);
  }));
  step(get("P3.draft"), "ok");
  step(({ lastResponse }) => {
    const draft = lastResponse.result.value;
    assert.equal(draft.columns.length, 1);
    assert.deepEqual(draft.isiDefinitions.map(isi => isi.durationMs), [1750, 3213]);
    expected.isiDefinitions = structuredClone(draft.isiDefinitions);
    expected.variant = { variantId: draft.columns[0].variantId, entries: [
      { entryId: draft.entryIds[0][0], kind: "isi", referenceId: draft.isiDefinitions[0].isiId },
      { entryId: draft.entryIds[1][0], kind: "video", referenceId: annotationId, assetId: expected.video.assetId },
      { entryId: draft.entryIds[2][0], kind: "isi", referenceId: draft.isiDefinitions[1].isiId },
    ] };
    return apply([op("P3", "variant.rename", { variantId: draft.columns[0].variantId, title: "V1" }),
      op("P3", "table.paste", { entryId: draft.entryIds[0][0],
        text: [draft.isiDefinitions[0].isiId, annotationId, draft.isiDefinitions[1].isiId].join("\n") })]);
  });
  step(readSnapshot(snapshot => {
    expected.feedback = snapshot.owners.P5.values["P5.contribution"];
    assert.equal(expected.feedback?.presentation.renderer, "flubber");
    assert.equal(expected.feedback.input.preset, "arrowKeys");
    assert.equal(expected.feedback.visual.hideFeedback, false);
    return { kind: "validate", owner: null };
  }), "ok");
  settleBindings(true);
  for (const segment of ["P1", "P2", "P3", "P4", "P6"]) checkedPerform("confirmSegment", { segment });
  // P5 Live Preview is captured by final Save, as in the existing GUI.
  checkedPerform("saveRecipe", { directory: config.workspace });
  step(({ lastResponse }) => {
    saves.push(savedFile(lastResponse, config.workspace));
    return perform("openRecipe", { path: saves[0].path });
  }, "applied", assertPublishedConsequence);
  step(set("P7.participantCount", 2), "applied");
  checkedPerform("rescanVideoLibrary", {});
  settleBindings(true);
  for (const segment of ["P1", "P2", "P3", "P4", "P6"]) checkedPerform("confirmSegment", { segment });
  checkedPerform("saveRecipe", { directory: config.workspace });
  step(({ lastResponse }) => {
    saves.push(savedFile(lastResponse, config.workspace));
    assert.notEqual(saves[1].basename, saves[0].basename);
    return { kind: "snapshot" };
  }, "ok");
  step(({ lastResponse }) => { lastSnapshot = lastResponse.result; return { kind: "validate", owner: null }; }, "ok");
  let receipt;
  try {
    receipt = await runPlannerCli({ executable: config.executable, steps, outputDirectory: config.evidenceDirectory });
  } finally {
    for (const key of ["TEMP", "TMP"]) {
      if (previousTemp[key] === undefined) delete process.env[key]; else process.env[key] = previousTemp[key];
    }
  }
  const inputReceipt = { schema: "affect-mock-cli-source-inputs", version: 1, sources: sourceEvidence,
    buildCommit: config.expectedCommit, executableSha256: config.expectedExecutableSha256,
    scriptSha256: sha(await readFile(new URL(import.meta.url))), generatedMasterBy: "production CLI saveRecipe only" };
  await writeFile(join(config.evidenceDirectory, "source-inputs.json"), JSON.stringify(inputReceipt, null, 2), { flag: "wx" });
  if (catalogue) await writeFile(join(config.evidenceDirectory, "catalogue.json"), JSON.stringify(catalogue, null, 2), { flag: "wx" });
  assert.ok(receipt.passed, receipt.failure);
  assert.equal(receipt.executableSha256, config.expectedExecutableSha256, "Executable changed between preflight and driver launch");
  assert.equal(saves.length, 2);
  const artifacts = [], recipes = [];
  for (const [index, saved] of saves.entries()) {
    const bytes = await readFile(saved.path), recipe = JSON.parse(bytes.toString("utf8"));
    assert.equal(sha(bytes), saved.receipt.canonicalSourceByteSha256);
    assert.equal(bytes.length, saved.receipt.byteLength);
    assertMockRecipe(recipe, expected, index + 1);
    recipes.push(recipe);
    artifacts.push({ ...saved, sha256: sha(bytes), byteLength: bytes.length });
  }
  assert.deepEqual(comparableRecipe(recipes[1]), comparableRecipe(recipes[0]), "Reopen/edit/resave changed more than participantCount and allowed derived integrity/revision metadata");
  await writeFile(join(config.evidenceDirectory, "mock-authoring-review.json"), JSON.stringify({
    schema: "affect-production-cli-mock-authoring-review", version: 1, passed: true,
    buildCommit: receipt.ready.buildCommit, executableSha256: receipt.executableSha256,
    transcriptSha256: receipt.transcriptSha256, artifacts, annotationId, sourceSaveResults,
    finalSnapshot: lastSnapshot,
    limits: ["Production CLI authoring/export/reopen only; Runner execution, rendered participant panels and XDF reconstruction are separate required checks."],
  }, null, 2), { flag: "wx" });
  return { receipt, artifacts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [configuration, ...extra] = process.argv.slice(2);
    assert.ok(configuration && !extra.length, "Usage: node planner-mock-experiment.mjs <local-source-and-build-config.json>");
    console.log(JSON.stringify(await authorMockExperiment(JSON.parse(await readFile(configuration, "utf8")))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
