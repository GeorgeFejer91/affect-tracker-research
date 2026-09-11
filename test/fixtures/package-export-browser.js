import { bootResearchUi } from "../../site/src/research/app.js";
import { canonicalJson, sha256Hex } from "../../site/src/research/canonical.js";
import { createExperimentPackageV1, parseExperimentPackageV1 } from "../../site/src/research/experiment-package.js";
import { importQuestionnaireAuthoring } from "../../site/src/research/questionnaire-authoring.js";
import english from "../../site/questionnaires/maia-2-en.csv";
import german from "../../site/questionnaires/maia-2-de.csv";
import { RESEARCH_UI_EVENTS } from "../../site/src/research/ui-contracts.js";
import packageFixture from "./experiment-package-v1.canonical.json";

// Synthetic adapter in an isolated headless process. It never opens a picker,
// writes a recipe, starts a Run, or connects to the native application.
const cases = [];
const check = (name, condition) => { if (!condition) throw new Error(name); cases.push(name); };
const root = document.querySelector("main");
root.id = "research-app";
root.dataset.researchSurface = "tauri";
bootResearchUi();
const ui = root.researchUi;
const query = (selector) => root.querySelector(selector);
const waitFor = async (predicate) => {
  for (let count = 0; count < 200; count += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`UI did not settle: ${query("#research-announcer")?.textContent}`);
};
const change = (selector, value) => {
  query(selector).value = value;
  query(selector).dispatchEvent(new Event("input", { bubbles: true }));
  query(selector).dispatchEvent(new Event("change", { bubbles: true }));
};

(async () => {
  const definitions = [];
  for (const [language, source] of [["en", english], ["de", german]]) definitions.push((await importQuestionnaireAuthoring(source,
    { logicalName: `maia-2-${language}.csv`, sourceKind: "bundled" })).definition);
  const modules = definitions.map((definition) => ({ schema: "affect-research-questionnaire-module", version: 2,
    moduleId: definition.questionnaireId, questionnaireId: definition.questionnaireId, definitionSha256: definition.definitionSha256,
    placement: { kind: "beforeSession", blockId: null } }));
  const languageSelection = structuredClone(packageFixture.languageSelection);
  for (const language of languageSelection.languages) language.questionnaireModuleIds = [modules.find((module) => module.questionnaireId.endsWith(language.languageTag)).moduleId];
  languageSelection.rootNodeId = "family";
  languageSelection.nodes.unshift({ nodeId: "family", prompt: "Select a language group", options: [
    { optionId: "both", label: "English / Deutsch", target: { kind: "node", nodeId: "language" } },
  ] });
  const master = await createExperimentPackageV1({ packageId: "reopened-master", playback: packageFixture.playback,
    settings: { ...packageFixture.settings, questionnaires: { ...packageFixture.settings.questionnaires, definitions, modules } }, languageSelection });
  const parsed = await parseExperimentPackageV1(new TextEncoder().encode(`${canonicalJson(master)}\n`));
  const acknowledge = {
    schema: "affect-research-experiment-package-save-receipt", version: 1,
    packageId: parsed.package.packageId,
    packageDefinitionSha256: parsed.package.integrity.packageDefinitionSha256,
    canonicalSourceByteSha256: parsed.canonicalSourceByteSha256,
    byteLength: new TextEncoder().encode(parsed.canonicalSourceText).byteLength,
  };
  const load = async () => {
    root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.experimentPackageLoaded, { detail: { receipt: parsed } }));
    await waitFor(() => ui.experimentPackage && !query("#package-reexport").disabled);
  };
  await load();
  check("recipe load preserves its exact canonical text", ui.experimentPackageSourceText === parsed.canonicalSourceText);
  check("recipe load does not choose a participant language", ui.experimentPackageSelection === null);
  check("sampling, formats and reproduction appear once in Review", ["sampling-frequency", "output-csv", "output-tsv", "package-reproduction-status"].every((id) =>
    root.querySelectorAll(`#${id}`).length === 1 && query(`#${id}`).closest('[data-setup-section="review"]')));
  let request;
  let writes = 0;
  root.addEventListener(RESEARCH_UI_EVENTS.saveExperimentPackageRequest, (event) => {
    event.preventDefault(); request = event.detail; writes += 1;
  });
  query("#package-reexport").click();
  await waitFor(() => request);
  check("delayed native write shows waiting and retains its source", ui.packageExportStatus.phase === "saving"
    && request.sourceText === parsed.canonicalSourceText && ui.packageExportStatus.saved === null);
  check("duplicate save and recipe load are disabled during writing", query("#package-reexport").disabled && query("#package-load").disabled);
  query("#package-reexport").click();
  check("duplicate click does not invoke another writer", writes === 1);
  request.complete({ status: "cancelled" });
  await waitFor(() => !ui.packageExportStatus.busy);
  check("cancellation leaves loaded recipe available for retry", ui.packageExportStatus.phase === "cancelled" && !query("#package-reexport").disabled);
  request = null;
  query("#package-reexport").click();
  await waitFor(() => request);
  request.complete({ status: "saved", receipt: acknowledge });
  await waitFor(() => !ui.packageExportStatus.busy);
  check("validated acknowledgement makes exact re-export saved", ui.packageExportStatus.phase === "saved"
    && ui.packageExportStatus.saved.sourceText === parsed.canonicalSourceText);
  request = null;
  query("#package-reexport").click();
  await waitFor(() => request);
  change("#sampling-frequency", "120");
  check("sampling edit immediately invalidates the loaded receipt", query("#package-file-status").dataset.state === "warning"
    && ui.packageReproductionReceipt === null);
  request.complete({ status: "saved", receipt: acknowledge });
  await waitFor(() => !ui.packageExportStatus.busy);
  check("acknowledged old write preserves newer sampling and requires new export", query("#sampling-frequency").value === "120"
    && ui.packageExportStatus.phase === "changed" && query("#package-reexport").disabled);
  check("stale recipe cannot start", query("#start-experiment").disabled);
  await load();
  check("intentional reopen restores the saved sampling value", Number(query("#sampling-frequency").value) === parsed.package.settings.experiment.samplingFrequencyHz);
  let contribution = { revision: 0, enabled: false, pending: false, contribution: { preview: true }, dependencyRevisions: [] };
  const unregister = ui.registerPlannerContribution("P6", () => contribution);
  check("disabled optional XR draft leaves v1 available", !query("#package-reexport").disabled);
  contribution = { ...contribution, enabled: true, revision: 1 };
  ui.plannerContributionChanged("P6");
  check("active unsupported XR blocks export and Start with a routed issue", query("#package-reexport").disabled
    && query("#start-experiment").disabled && query('[data-planner-segment="P6"]')?.textContent.includes("successor"));
  unregister();
  await load();
  const originalP2 = ui.getQuestionnaireContributionSnapshot();
  check("locked questionnaire contribution includes both language definitions and exact nested tree",
    canonicalJson(originalP2.contribution) === canonicalJson({ questionnaires: parsed.package.settings.questionnaires, languageSelection }));
  query("#package-edit").click();
  await waitFor(() => ui.experimentPackage === null);
  check("Edit recipe restores full editable forms and nested language structure",
    !ui.getQuestionnaireContributionSnapshot().pending && !query('[data-sheet-cell="0:0"]').closest("fieldset").disabled
    && canonicalJson(ui.getQuestionnaireContributionSnapshot().contribution.languageSelection) === canonicalJson(languageSelection));
  const prettyExperiment = `${JSON.stringify(parsed.package.settings.externalProtocol.definition, null, 2)}\n`;
  await ui.applySettings({ ...parsed.package.settings, externalProtocol: { ...parsed.package.settings.externalProtocol,
    sourceByteSha256: await sha256Hex(prettyExperiment) } });
  root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.workspaceReady, { detail: { label: "Synthetic fixture workspace", directoryPermission: true } }));
  root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.stimuliCatalogued, { detail: { replace: true,
    items: parsed.package.settings.stimuli.items.map((stimulus) => ({ stimulus, verified: true })) } }));
  root.addEventListener(RESEARCH_UI_EVENTS.storeQuestionnaireAssetRequest, (event) => {
    event.preventDefault();
    const value = event.detail.request;
    event.detail.complete({ ok: true, receipt: { familyId: value.familyId, languageTag: value.languageTag,
      sourceSha256: value.sourceSha256, byteLength: value.bytes.length } });
  });
  const englishPrompt = '[data-sheet-key="maia-2/en"] [data-sheet-cell="0:0"]';
  change(englishPrompt, "Synthetic fixture wording edit");
  check("pending questionnaire wording blocks master export", ui.getQuestionnaireContributionSnapshot().pending && query("#package-generate").disabled);
  query('[data-sheet-key="maia-2/en"] [data-sheet-action="save"]').click();
  await waitFor(() => !ui.getQuestionnaireContributionSnapshot().pending);
  change("#sampling-frequency", "111");
  request = null;
  query("#package-generate").click();
  await waitFor(() => request);
  const revised = await parseExperimentPackageV1(new TextEncoder().encode(request.sourceText));
  check("revised master retains package identity, playback, full German form and nested route",
    revised.package.packageId === parsed.package.packageId && canonicalJson(revised.package.playback) === canonicalJson(parsed.package.playback)
    && canonicalJson(revised.package.settings.questionnaires.definitions.find((definition) => definition.language === "de")) === canonicalJson(definitions[1])
    && canonicalJson(revised.package.languageSelection) === canonicalJson(languageSelection));
  check("revised master includes accepted wording and sampling with fresh integrity",
    revised.package.settings.experiment.samplingFrequencyHz === 111
    && revised.package.settings.questionnaires.definitions.find((definition) => definition.language === "en").items[0].prompt === "Synthetic fixture wording edit"
    && revised.canonicalSourceByteSha256 !== parsed.canonicalSourceByteSha256);
  check("revised master is not adopted before persistence", ui.experimentPackage === null);
  request.complete({ status: "saved", receipt: { ...acknowledge, packageDefinitionSha256: revised.package.integrity.packageDefinitionSha256,
    canonicalSourceByteSha256: revised.canonicalSourceByteSha256, byteLength: new TextEncoder().encode(revised.canonicalSourceText).byteLength } });
  await waitFor(() => !ui.packageExportStatus.busy);
  check("acknowledged revised master becomes loaded even when experiment source formatting was canonicalized", ui.packageExportStatus.phase === "saved" && ui.experimentPackageSourceText === revised.canonicalSourceText);
  query("#package-edit").click();
  await waitFor(() => ui.experimentPackage === null);
  change(englishPrompt, "Unsaved draft must not survive explicit reopen");
  root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.experimentPackageLoaded, { detail: { receipt: revised } }));
  await waitFor(() => ui.experimentPackage !== null && !query("#package-reexport").disabled);
  check("explicit reopen discards old table drafts even when the accepted definition hash is unchanged", query(englishPrompt).value === "Synthetic fixture wording edit");
  ui.openSetupSection("review");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const panel = query('[data-setup-section="review"]');
  const bounds = panel.getBoundingClientRect();
  check("finalization controls fit Review horizontally", [...panel.querySelectorAll(".package-finalization button")].every((button) => {
    const rect = button.getBoundingClientRect();
    return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && button.scrollWidth <= button.clientWidth + 2;
  }));
  document.querySelector("#receipt").textContent = JSON.stringify({ passed: true, cases });
})().catch((error) => {
  document.querySelector("#receipt").textContent = JSON.stringify({ passed: false, cases, error: error.stack });
  ui.destroy();
});
