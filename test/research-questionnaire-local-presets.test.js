import test from "node:test";
import assert from "node:assert/strict";
import { RESEARCHER_LOCAL_QUESTIONNAIRE_PRESETS, verifyResearcherLocalQuestionnaireSource,
  createResearcherLocalQuestionnairePresets, mergeQuestionnairePresetChoices,
  researcherLocalQuestionnaireAvailability } from "../site/src/research/questionnaire-local-presets.js";
import { PREBUILT_QUESTIONNAIRE_ASSETS } from "../site/src/research/questionnaire-prebuilt.js";
import { createQuestionnaireSheet, sheetToAuthoring } from "../site/src/research/questionnaire-sheet.js";
import { createQuestionnaireEditor } from "../site/src/research/questionnaire-editor.js";
const local = RESEARCHER_LOCAL_QUESTIONNAIRE_PRESETS[0];
const guard = () => ({ isCurrent: () => true, signal: new AbortController().signal });
async function synthetic() {
  const sheet = createQuestionnaireSheet({ familyId: "synthetic-local", language: "de", rowCount: 20, optionCount: 5 });
  sheet.rows.forEach((row, index) => { row.prompt = `Synthetic item ${index + 1}`; });
  const result = await sheetToAuthoring(sheet), definition = result.definition;
  const asset = { ...local, id: "synthetic-local-de", familyId: "synthetic-local", questionnaireId: definition.questionnaireId,
    questionnaireVersion: definition.questionnaireVersion, logicalName: definition.source.logicalName,
    sourceSha256: definition.source.sha256, definitionSha256: definition.definitionSha256, byteLength: result.sourceBytes.length };
  return { asset, source: { bytes: Array.from(result.sourceBytes), receipt: { presetId: asset.id, familyId: asset.familyId,
    languageTag: asset.language, logicalName: asset.logicalName, sourceSha256: asset.sourceSha256, byteLength: asset.byteLength,
    usageScope: "researcherLocal", publicReuseVerified: false } }, definition };
}
test("local registry is metadata-only and never promotes the public TAS preload", () => {
  assert.equal(local.publicReuseVerified, false); assert.equal(local.usageScope, "researcherLocal");
  assert.equal(local.byteLength, 124978); assert.equal(local.itemCount, 20); assert.equal(local.optionCount, 5);
  assert.ok(!Object.hasOwn(local, "items") && !Object.hasOwn(local, "bytes") && !Object.hasOwn(local, "url"));
  assert.ok(PREBUILT_QUESTIONNAIRE_ASSETS.filter(a => a.familyId === "tas-20").every(a => !a.ready));
  const ready = { ...local, ready: true };
  const choices = mergeQuestionnairePresetChoices(PREBUILT_QUESTIONNAIRE_ASSETS, [ready]);
  assert.ok(choices.includes(ready)); assert.ok(!choices.some(a => a.id === "tas-20-de"));
  assert.ok(PREBUILT_QUESTIONNAIRE_ASSETS.some(a => a.id === "tas-20-de" && !a.ready));
  assert.equal(researcherLocalQuestionnaireAvailability(ready, { languages: ["en"] }).disabled, true);
  assert.equal(researcherLocalQuestionnaireAvailability(ready, { languages: ["de"] }).disabled, false);
  assert.equal(researcherLocalQuestionnaireAvailability(ready, { languages: ["de"], occupied: true }).disabled, true);
});
test("pure local verifier preserves source bytes, metadata and caller isolation", async () => {
  const { asset, source, definition } = await synthetic();
  const pending = verifyResearcherLocalQuestionnaireSource(asset, source);
  source.bytes[0] = 0; source.receipt.logicalName = "caller-mutated.csv";
  const loaded = await pending;
  assert.deepEqual(loaded.authoringResult.definition, definition);
  assert.equal(loaded.receipt.logicalName, asset.logicalName);
  assert.equal(loaded.sourceBytes[0], "f".charCodeAt(0));
  assert.equal(loaded.authoringResult.definition.source.kind, "researcherCsv");
});
test("local verifier rejects mismatched receipts, bytes, content version and nonlocal claims", async () => {
  const { asset, source } = await synthetic();
  for (const mutate of [
    value => { value.receipt.path = "private-path"; },
    value => { value.receipt.presetId = "other"; },
    value => { value.receipt.languageTag = "en"; },
    value => { value.receipt.publicReuseVerified = true; },
    value => { value.receipt.usageScope = "bundled"; },
    value => { value.receipt.sourceSha256 = "0".repeat(64); },
    value => { value.bytes[0] ^= 1; }, value => { value.bytes.pop(); },
    value => { value.bytes[0] = 256; }, value => { value.bytes = "not bytes"; },
  ]) {
    const value = structuredClone(source); mutate(value);
    await assert.rejects(verifyResearcherLocalQuestionnaireSource(asset, value));
  }
  await assert.rejects(verifyResearcherLocalQuestionnaireSource({ ...asset, definitionSha256: "0".repeat(64) }, source));
  await assert.rejects(verifyResearcherLocalQuestionnaireSource({ ...asset, itemCount: 19 }, source));
});
test("browser never reads native sources and native absence differs from corrupt source", async () => {
  let reads = 0;
  const browser = createResearcherLocalQuestionnairePresets({ surface: "browser", readSource: () => { reads++; } });
  assert.deepEqual(await browser.inspect(guard()), []);
  await assert.rejects(browser.load(local.id, guard()), /native/u); assert.equal(reads, 0);
  const native = createResearcherLocalQuestionnairePresets({ surface: "tauri", readSource: async () => { reads++; return null; } });
  assert.equal((await native.inspect(guard()))[0].state, "notInstalled");
  await assert.rejects(native.load("../unknown", guard()), /Unknown/u); assert.equal(reads, 1);
  await assert.rejects(native.load(local.id, guard()), /not installed/u);
  const corrupt = createResearcherLocalQuestionnairePresets({ surface: "tauri", readSource: async () => ({ invalid: true }) });
  const choice = (await corrupt.inspect(guard()))[0]; assert.equal(choice.ready, false); assert.equal(choice.state, "unavailable");
});
test("native-source preparation fences cancellation and teardown without cached ready data", async () => {
  for (const cancel of ["signal", "destroy"]) {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const scope = new AbortController(); let suppliedGuard;
    const owner = createResearcherLocalQuestionnairePresets({ surface: "tauri", readSource: async (_request, current) => { suppliedGuard = current; await gate; return null; } });
    const pending = owner.inspect({ signal: scope.signal, isCurrent: () => true });
    if (cancel === "signal") scope.abort(); else owner.destroy();
    assert.equal(suppliedGuard.isCurrent(), false); assert.equal(suppliedGuard.signal.aborted, true);
    release(); await assert.rejects(pending, error => error.code === "canceled");
  }
});
test("local load requires an empty selected-language slot and cannot outlive slot removal", async () => {
  const editor = createQuestionnaireEditor({ root: { querySelector: () => null } });
  const context = { languages: ["de"], locked: false };
  editor.sync({ families: [{ id: "tas-20", label: "TAS-20" }], languages: [{ languageTag: "de", label: "Deutsch" }],
    definitions: [], locked: false, familyForDefinition: () => "tas-20" });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const owner = createResearcherLocalQuestionnairePresets({ surface: "tauri", readSource: async () => { await gate; return null; } });
  const pending = owner.loadIntoEditor(local.id, { editor, readContext: () => context }, guard());
  editor.reset(); release(); await assert.rejects(pending, error => error.code === "stale_revision");
  await assert.rejects(owner.loadIntoEditor(local.id, { editor, readContext: () => context }, guard()), /empty questionnaire/u);
  context.languages = ["en"];
  await assert.rejects(owner.loadIntoEditor(local.id, { editor, readContext: () => context }, guard()), /preset language/u);
});
