import { bootResearchUi, initializeResearchUi, renderResearchUiMarkup } from "../../site/src/research/app.js";
import { preparePlannerSurface } from "../../site/src/research/planner-surface.js";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { parsePlannerRecipeV1 } from "../../site/src/research/planner-recipe.js";
import { RESEARCH_UI_EVENTS } from "../../site/src/research/ui-contracts.js";
import sample from "./planner-recipe-locations-current-v1.canonical.json";

const checks = [], errors = [];
const check = (name, condition) => { if (!condition) throw Error(name); checks.push(name); };
const wait = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (predicate, label) => { for (let i = 0; i < 300; i++) { if (predicate()) return; await wait(); } throw Error(label); };
addEventListener("error", event => errors.push(event.message));
addEventListener("unhandledrejection", event => errors.push(String(event.reason)));
let ui, root;
try {
  root = window.document.querySelector("main"); root.id = "research-app";
  root.dataset.researchSurface = "browser"; root.dataset.researchProgram = "planner";
  bootResearchUi(); ui = root.researchUi;
  const q = selector => root.querySelector(selector);
  await wait(150);
  check("fresh Planner has no loaded recipe or participant runtime controls", !ui.plannerRecipe && !ui.experimentPackage
    && !q("#start-experiment") && !q('[data-mode-panel="run"]'));
  const guard = { isCurrent: () => true };
  await ui.restoreStudyIdentity(sample.segments.P1.study, guard);
  await ui.restoreQuestionnaireRecipeContribution(sample.segments.P2, guard);
  await ui.restoreFeedbackContribution(sample.segments.P5, guard);
  ui.restorePlannerRecipePolicy(sample.policy, guard);
  ui.restorePlannerPresentationTarget(sample.presentationTarget, guard);
  const publish = app => app.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.stimuliCatalogued, { detail: {
    replace: true, items: sample.segments.P1.videoCatalogue.entries.map((entry, index) => ({
      stimulus: { stimulusId: `master-${index}`, title: entry.annotationId, source: {
        kind: "workspaceFile", relativePath: entry.sourceRelativePath, mimeType: "video/mp4",
        sha256: entry.sha256, byteLength: entry.byteLength, durationMs: entry.durationMs,
      } }, verified: true, displayGeometry: entry.geometry,
    })),
  } }));
  publish(root); await until(() => !ui.getWorkspaceContributionSnapshot().pending, "fresh P1 readiness");
  await ui.restoreStimulusVariantContent(sample.segments.P3, {
    savedWorkspaceContribution: sample.segments.P1,
    dependencies: { P1: ui.getWorkspaceContributionSnapshot() }, ...guard,
  });
  await ui.setStimulusOrderCatalogue(ui.getWorkspaceContributionSnapshot());
  await ui.restoreScreenLayoutContent(sample.segments.P4, {
    savedWorkspaceContribution: sample.segments.P1, savedFeedbackContribution: sample.segments.P5, ...guard,
  });
  ui.restoreXrLayoutSelection(sample.segments.P6, guard);
  const edit = (selector, value, type = "input") => {
    q(selector).value = value; q(selector).dispatchEvent(new Event(type, { bubbles: true }));
  };
  edit("#experiment-title", "Fresh assembled experiment");
  edit("#sampling-frequency", "111");
  const names = sample.segments.P1.videoCatalogue.entries.map(entry => entry.annotationId);
  const clipboard = new DataTransfer(); clipboard.setData("text/plain", `${names[0]}\tISI2\nISI1\t${names[1]}`);
  q('[data-order-row="0"][data-order-column="0"]').dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  edit('[data-isi-id="ISI2"]', "625", "change");
  edit('[data-layout-field="referencePolicy"]', "maximum-oriented-dimensions", "change");
  edit('[data-layout-field="offsetX"]', "5");
  edit("#color-idle-hex", "#123abc");
  edit("#preview-full-span-duration", "5500");
  await wait(150);
  const expectedFeedback = ui.getFeedbackContributionSnapshot().contribution;
  const confirm = async (section, app = root, controller = ui) => {
    if (controller.openSection !== section) controller.openSetupSection(section);
    const button = app.querySelector(`[data-confirm-section="${section}"]`);
    check(`${section} footer exists and is enabled`, button && !button.disabled);
    button.click();
    await until(() => button.getAttribute("aria-busy") === "false", `${section} confirmation completion`);
    await wait(50);
    check(`${section} confirms exact current owner`, controller.reviewedSetupSections.includes(section));
    check(`${section} circled check is visible`, !app.querySelector(`[data-section-review-check="${section}"]`).hidden);
  };
  for (const section of ["workspace", "questionnaires", "stimuli", "layout", "xr"]) await confirm(section);
  check("cycle automatically reaches Section 7", ui.openSection === "review");
  ui.openSetupSection("workspace"); ui.openSetupSection("workspace");
  check("chevron navigation keeps completed receipt", ui.reviewedSetupSections.includes("workspace")
    && q('[data-confirm-section="workspace"]').disabled);
  ui.openSetupSection("review");
  check("Preview is captured only at final save", !ui.getPlannerAcceptanceReview().entries.some(x => x.segment === "P5" && x.status === "accepted")
    && !q('[data-confirm-section="feedback"]'));
  const handle = { kind: "file", async createWritable() { return {
    async write(bytes) { const response = await fetch("/saved-file", { method: "POST", body: bytes }); if (!response.ok) throw Error("disk write"); },
    async close() {}, async abort() {},
  }; }, async getFile() {
    const bytes = new Uint8Array(await (await fetch("/saved-file")).arrayBuffer());
    return { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer };
  } };
  let picks = 0;
  window.showSaveFilePicker = options => { picks++; check("save suggests a named JSON", options.suggestedName.endsWith(".json")); return Promise.resolve(handle); };
  check("complete current design can save", !q("#package-generate").disabled);
  q("#package-generate").click();
  await until(() => q("#package-save-dialog").open, "prepared named-save dialog");
  check("dialog alone does not mark completion", picks === 0 && !ui.reviewedSetupSections.includes("review"));
  q("#package-save-choose").click(); check("picker opens in direct click", picks === 1);
  await until(() => ui.packageExportStatus.phase === "saved", "acknowledged final save");
  check("acknowledged save collapses final section and marks it complete", ui.openSection === null && ui.reviewedSetupSections.includes("review"));
  const firstBytes = new Uint8Array(await (await fetch("/saved-file")).arrayBuffer());
  const document = await parsePlannerRecipeV1(firstBytes);
  check("saved bytes are sole adopted document", document.canonicalSourceText === ui.plannerRecipeSourceText);
  check("fresh field edits and current Preview are fully saved", document.recipe.segments.P1.study.title === "Fresh assembled experiment"
    && document.recipe.policy.samplingFrequencyHz === 111 && canonicalJson(document.recipe.segments.P5) === canonicalJson(expectedFeedback));
  check("direct color and response controls change saved settings", document.recipe.segments.P5.visual.colors.idle === "#123abc"
    && document.recipe.segments.P5.response.fullSpanDurationMs === 5500);
  check("direct reference method and offset are saved", document.recipe.segments.P4.reference.source.policy === "maximum-oriented-dimensions"
    && document.recipe.segments.P4.feedback.offset.x === 5);
  check("pasted order and edited named ISI survive compilation", document.recipe.segments.P3.variants[0].entries[0].referenceId === names[0]
    && document.recipe.segments.P3.isiDefinitions.find(item => item.isiId === "ISI2").durationMs === 625);
  check("all six complete segments are present", Object.keys(document.recipe.segments).join(",") === "P1,P2,P3,P4,P5,P6");
  const reopened = window.document.createElement("section");
  reopened.innerHTML = renderResearchUiMarkup("browser"); preparePlannerSurface(reopened);
  root.hidden = true; window.document.body.append(reopened);
  const other = initializeResearchUi(reopened, { surface: "browser" });
  await wait(100);
  check("fresh controller completes strict editable Open", await other.restorePlannerRecipe(document.canonicalSourceText, guard));
  await wait(200);
  check("reopened source remains eligible after pending dependencies settle", other.canSaveUnchangedPlannerRecipe && other.getWorkspaceContributionSnapshot().pending);
  check("reopen restores complete questionnaire and feedback", canonicalJson(other.getQuestionnaireRecipeContributionSnapshot().contribution) === canonicalJson(document.recipe.segments.P2)
    && canonicalJson(other.getFeedbackContributionSnapshot().contribution) === canonicalJson(document.recipe.segments.P5));
  check("reopen restores target and exact policy", other.getSelectedPlannerTarget() === document.recipe.presentationTarget
    && canonicalJson(other.getPlannerRecipePolicy()) === canonicalJson(document.recipe.policy));
  check("reopen preserves editable pending order/layout without invented confirmation", other.getStimulusOrderSnapshot().pending && other.getScreenLayoutContributionSnapshot().pending
    && !other.reviewedSetupSections.includes("workspace") && reopened.querySelector("[data-order-row]"));
  const saving = other.savePlannerRecipe();
  await until(() => reopened.querySelector("#package-save-dialog").open, "unchanged copy save dialog");
  reopened.querySelector("#package-save-choose").click();
  check("unchanged pending copy is acknowledged", (await saving).status === "saved");
  check("copy is byte-identical", new TextDecoder().decode(await (await fetch("/saved-file")).arrayBuffer()) === document.canonicalSourceText);
  publish(reopened); await until(() => !other.getWorkspaceContributionSnapshot().pending, "exact media rebind");
  await other.setStimulusOrderCatalogue(other.getWorkspaceContributionSnapshot());
  await wait(150);
  check("exact rebind preserves full authored P1", canonicalJson(other.getWorkspaceContributionSnapshot().contribution) === canonicalJson(document.recipe.segments.P1));
  const sampling = reopened.querySelector("#sampling-frequency");
  sampling.value = "112"; sampling.dispatchEvent(new Event("input", { bubbles: true }));
  sampling.value = "111"; sampling.dispatchEvent(new Event("input", { bubbles: true }));
  check("edit and revert requires current composition after rebind", !other.canSaveUnchangedPlannerRecipe);
  for (const section of ["workspace", "questionnaires", "stimuli", "layout", "xr"]) await confirm(section, reopened, other);
  const reboundSave = other.savePlannerRecipe();
  await until(() => reopened.querySelector("#package-save-dialog").open, "rebound current compile dialog");
  reopened.querySelector("#package-save-choose").click();
  check("rebound current design saves through fresh capture", (await reboundSave).status === "saved");
  check("rebound compilation preserves exact complete source", other.plannerRecipeSourceText === document.canonicalSourceText);
  reopened.querySelector("[data-layout-reset]").click();
  check("layout reset immediately revokes unchanged source eligibility", !other.canSaveUnchangedPlannerRecipe
    && other.getScreenLayoutDraftDocument().draft.referencePolicy === null);
  let resetSaveRejected = false;
  try { await other.savePlannerRecipe(); } catch { resetSaveRejected = true; }
  check("reset design cannot silently save the old master", resetSaveRejected && !reopened.querySelector("#package-save-dialog").open);
  await other.restorePlannerRecipe(document.canonicalSourceText, guard);
  const resetColor = reopened.querySelector("[data-color-reset]");
  check("color reset control exists", resetColor);
  resetColor.click();
  check("color reset immediately revokes unchanged source eligibility", !other.canSaveUnchangedPlannerRecipe);
  let colorSaveRejected = false;
  try { await other.savePlannerRecipe(); } catch { colorSaveRejected = true; }
  check("reset colors cannot silently save the old master", colorSaveRejected && !reopened.querySelector("#package-save-dialog").open);
  other.destroy();
  reopened.remove(); root.hidden = false;
  ui.openSetupSection("review"); await wait(150); q("#package-generate").scrollIntoView({ block: "end" });
  check("no application errors", errors.length === 0);
  window.document.querySelector("#receipt").textContent = JSON.stringify({ passed: true, checks, errors, savedSource: document.canonicalSourceText });
} catch (error) {
  window.document.querySelector("#receipt").textContent = JSON.stringify({ passed: false, checks, errors, error: String(error), stack: error.stack,
    announcer: root?.querySelector("#research-announcer")?.textContent, exportStatus: ui?.packageExportStatus,
    contributions: ui?.getPlannerAcceptanceReview() });
}
