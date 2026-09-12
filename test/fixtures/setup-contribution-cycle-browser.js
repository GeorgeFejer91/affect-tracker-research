import { bootResearchUi } from "../../site/src/research/app.js";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { RESEARCH_UI_EVENTS } from "../../site/src/research/ui-contracts.js";
import catalogue from "./research-video-catalogue-contribution-v1.json";
import variants from "./variant-workspace-binding-v1.json";
import legacyRecipe from "./experiment-package-v1.canonical.json";

// Actual controller and owner modules. Catalogue events are synthetic boundary
// receipts, not proof of file permissions, decoding, native persistence or Run.
const checks = [], errors = [];
const check = (name, value) => { if (!value) throw Error(name); checks.push(name); };
const wait = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const until = async predicate => {
  for (let i = 0; i < 150; i++) { if (predicate()) return; await wait(10); }
  throw Error("Controller state did not settle.");
};
addEventListener("error", event => errors.push(event.message));
addEventListener("unhandledrejection", event => errors.push(String(event.reason)));

(async () => {
  const root = document.querySelector("main"); root.id = "research-app"; root.dataset.researchSurface = "browser";
  bootResearchUi(); const ui = root.researchUi, q = selector => root.querySelector(selector);
  const initialPolicy = ui.getPlannerRecipePolicy();
  const authoredPolicy = { ...initialPolicy, participantCount: 42, samplingFrequencyHz: 100,
    output: { csv: false, tsv: true }, lsl: { enabled: true, stateStream: "AuthoredState",
      streamType: "AuthoredAffect", markerStream: "AuthoredMarkers", sourceId: "authored-source" } };
  ui.restorePlannerRecipePolicy(authoredPolicy, { isCurrent: () => true });
  check("fresh policy restores every authored field without importing an experiment",
    ui.experimentPackage === null && canonicalJson(ui.getPlannerRecipePolicy()) === canonicalJson(authoredPolicy));
  const stalePolicy = ui.restorePlannerRecipePolicy(initialPolicy, { isCurrent: () => false });
  check("stale policy restore preserves all current controls", stalePolicy === false
    && canonicalJson(ui.getPlannerRecipePolicy()) === canonicalJson(authoredPolicy));
  let invalidPolicyRejected = false;
  try { ui.restorePlannerRecipePolicy({ ...initialPolicy, samplingFrequencyHz: -1 }, { isCurrent: () => true }); }
  catch { invalidPolicyRejected = true; }
  check("invalid policy cannot partially restore controls", invalidPolicyRejected
    && canonicalJson(ui.getPlannerRecipePolicy()) === canonicalJson(authoredPolicy));
  ui.restorePlannerRecipePolicy(initialPolicy, { isCurrent: () => true });
  const source = `${canonicalJson(legacyRecipe)}\n`, bytes = new TextEncoder().encode(source);
  const handle = { kind: "file", getFile: async () => ({ size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer }) };
  // No legacy experiment document exists yet, so draft fingerprints are null.
  // A delayed file selection must not overwrite even invalid or reverted edits.
  await wait(100);
  for (const { edited, revert, label } of [
    { edited: "119", revert: false, label: "newer field edits" },
    { edited: "117", revert: true, label: "edit/revert intent" },
    { edited: "", revert: false, label: "invalid field edits" },
  ]) {
    let release;
    window.showOpenFilePicker = () => new Promise(resolve => { release = () => resolve([handle]); });
    q("#research-announcer").textContent = "";
    q("#package-load").click();
    const before = q("#sampling-frequency").value;
    q("#sampling-frequency").value = edited;
    q("#sampling-frequency").dispatchEvent(new Event("input", { bubbles: true }));
    if (revert) {
      q("#sampling-frequency").value = before;
      q("#sampling-frequency").dispatchEvent(new Event("input", { bubbles: true }));
    }
    release();
    await until(() => q("#research-announcer").textContent.includes("Newer edits were preserved"));
    check(`incomplete-draft file open preserves ${label}`,
      ui.experimentPackage === null && q("#sampling-frequency").value === (revert ? before : edited));
  }
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  let releaseParsing;
  crypto.subtle.digest = (algorithm, data) => {
    crypto.subtle.digest = originalDigest;
    return new Promise((resolve, reject) => { releaseParsing = () => originalDigest(algorithm, data).then(resolve, reject); });
  };
  window.showOpenFilePicker = () => Promise.resolve([handle]);
  q("#research-announcer").textContent = "";
  q("#package-load").click(); await until(() => releaseParsing);
  q("#experiment-title").value = "Keep my newer study title";
  q("#experiment-title").dispatchEvent(new Event("input", { bubbles: true }));
  releaseParsing(); await until(() => q("#research-announcer").textContent.includes("Newer edits were preserved"));
  check("edits during real asynchronous file validation prevent adoption", ui.experimentPackage === null
    && q("#experiment-title").value === "Keep my newer study title");
  const publish = (entries = catalogue.entries) => root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.stimuliCatalogued, { detail: {
    replace: true, items: entries.map((entry, index) => ({
      stimulus: { stimulusId: `cycle-${index}`, title: entry.annotationId, source: {
        kind: "workspaceFile", relativePath: entry.sourceRelativePath, mimeType: "video/mp4",
        sha256: entry.sha256, byteLength: entry.byteLength, durationMs: entry.durationMs,
      } }, verified: true, displayGeometry: entry.geometry,
    })),
  } }));
  const confirmation = section => q(`[data-confirm-section="${section}"]`);
  const accepted = section => ui.reviewedSetupSections.includes(section);
  const clickConfirm = async section => {
    if (ui.openSection !== section) ui.openSetupSection(section);
    confirmation(section).click();
    await until(() => confirmation(section).getAttribute("aria-busy") === "false");
    await wait();
  };
  publish(); await until(() => !ui.getWorkspaceContributionSnapshot().pending); await wait();
  check("ready preconfigured workspace still needs explicit confirmation", !accepted("workspace"));
  await clickConfirm("workspace");
  check("workspace confirmation advances to section 2", accepted("workspace") && ui.openSection === "questionnaires");
  check("confirmed workspace has a visible circled check", !q('[data-section-review-check="workspace"]').hidden);
  ui.openSetupSection("workspace"); ui.openSetupSection("workspace");
  check("navigation preserves confirmation without reconfirming", accepted("workspace") && confirmation("workspace").disabled);
  await clickConfirm("questionnaires");
  check("questionnaire confirmation advances to variants", accepted("questionnaires") && ui.openSection === "stimuli");
  const savedWorkspace = ui.getWorkspaceContributionSnapshot().contribution;
  await ui.restoreStimulusVariantContent(variants.contribution, {
    savedWorkspaceContribution: savedWorkspace, dependencies: { P1: ui.getWorkspaceContributionSnapshot() }, isCurrent: () => true,
  });
  await ui.setStimulusOrderCatalogue(ui.getWorkspaceContributionSnapshot());
  await clickConfirm("stimuli");
  check("one footer click prepares and accepts variants without sidecar storage", accepted("stimuli") && ui.openSection === "layout" && ui.workspace === null);
  await clickConfirm("layout");
  check("unapproved layout stays open without a false check", !accepted("layout") && ui.openSection === "layout");
  await clickConfirm("xr");
  check("explicit optional exclusion advances to final save", accepted("xr") && ui.openSection === "review");
  check("Preview has no independent confirmation", !confirmation("feedback") && !accepted("feedback"));
  check("final save is unique and unacknowledged", root.querySelectorAll("#package-generate").length === 1 && !accepted("review"));
  const setTarget = value => {
    q("#planner-presentation-target").value = value;
    q("#planner-presentation-target").dispatchEvent(new Event("change", { bubbles: true }));
  };
  const enableXr = value => {
    q("[data-xr-enabled]").checked = value;
    q("[data-xr-enabled]").dispatchEvent(new Event("change", { bubbles: true }));
  };
  enableXr(true); await ui.waitForXrLayoutDependencies(); await clickConfirm("xr");
  check("enabled XR cannot confirm an inferred target", !accepted("xr") && ui.openSection === "xr" && ui.getSelectedPlannerTarget() === null);
  setTarget("webxr-immersive-vr"); await clickConfirm("xr");
  check("one XR footer click prepares and accepts the explicitly selected target", accepted("xr") && ui.openSection === "review");
  setTarget("desktop-screen");
  check("target edits expire XR acceptance but retain questionnaire acceptance", !accepted("xr") && accepted("questionnaires"));
  await clickConfirm("xr");
  check("incompatible desktop target cannot accept enabled XR", !accepted("xr") && ui.openSection === "xr");
  enableXr(false); await clickConfirm("xr"); setTarget("");
  check("changing targets preserves an explicit disabled XR exclusion", accepted("xr") && ui.openSection === "review");
  q("#experiment-title").value = "Changed study";
  q("#experiment-title").dispatchEvent(new Event("input", { bubbles: true }));
  check("study change expires workspace and dependent variant confirmations", !accepted("workspace") && !accepted("stimuli"));

  // Delay the actual controller's first digest, not a reconstructed refresh
  // helper. Later operations still use the real digest and real producers.
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  const delayNextDigest = () => {
    let release, intercepted = false;
    crypto.subtle.digest = (algorithm, bytes) => {
      crypto.subtle.digest = digest; intercepted = true;
      return new Promise((resolve, reject) => { release = fail => fail ? reject(Error("stale verification failure")) : digest(algorithm, bytes).then(resolve, reject); });
    };
    return { get intercepted() { return intercepted; }, release: fail => release(fail) };
  };
  await ui.restoreWorkspaceContribution(savedWorkspace);
  await ui.restoreStimulusVariantContent(variants.contribution, {
    savedWorkspaceContribution: savedWorkspace, dependencies: { P1: ui.getWorkspaceContributionSnapshot() }, isCurrent: () => true,
  });
  check("saved authored table opens while real media stays unresolved", ui.getWorkspaceContributionSnapshot().pending
    && ui.getStimulusOrderSnapshot().pending && ui.getStimulusOrderSnapshot().contribution === null && !!q("[data-order-row]"));
  const lateMatch = delayNextDigest(); publish();
  check("actual restored-media verification is delayed", lateMatch.intercepted);
  publish([]); await wait(); lateMatch.release(false); await wait(100);
  check("late matching refresh cannot revive removed media", ui.getWorkspaceContributionSnapshot().pending && ui.getWorkspaceContributionSnapshot().contribution === null);
  const lateFailure = delayNextDigest(); publish();
  check("actual second restored-media verification is delayed", lateFailure.intercepted);
  publish(); await until(() => !ui.getWorkspaceContributionSnapshot().pending);
  const currentWorkspace = JSON.stringify(ui.getWorkspaceContributionSnapshot());
  lateFailure.release(true); await wait(100);
  check("stale verification failure preserves newer successful media rebind", JSON.stringify(ui.getWorkspaceContributionSnapshot()) === currentWorkspace);
  check("rebind preserves editable variant fields without auto-confirming", !!q("[data-order-row]") && !accepted("stimuli"));
  await clickConfirm("stimuli");
  check("restored variants confirm through the same footer cycle", accepted("stimuli") && ui.openSection === "layout");
  // Existing v1 files remain readable with all current producers connected.
  // A synthetic file handle verifies the controller seam, not an OS picker.
  let picks = 0;
  window.showOpenFilePicker = () => {
    picks += 1;
    return Promise.resolve([handle]);
  };
  q("#package-load").click();
  check("legacy recipe picker is requested directly by its click", picks === 1);
  await until(() => ui.experimentPackage && q("#research-announcer").textContent.startsWith("Loaded "));
  await wait(100);
  check("legacy file opens with exact source and restored saved controls", ui.experimentPackageSourceText === source
    && q("#experiment-title").value === legacyRecipe.settings.experiment.title
    && Number(q("#sampling-frequency").value) === legacyRecipe.settings.experiment.samplingFrequencyHz);
  check("legacy projection cannot bypass current contribution or save gates", q("#package-generate").disabled
    && !accepted("review") && ui.workspace === null);
  // Tear down a separate real controller with an outstanding picker so the
  // delayed response cannot adopt into its detached DOM after disposal.
  const { initializeResearchUi } = await import("../../site/src/research/app.js");
  const { renderResearchUiMarkup } = await import("../../site/src/research/ui-view.js");
  const detached = document.createElement("section");
  detached.innerHTML = renderResearchUiMarkup("browser");
  const disposedUi = initializeResearchUi(detached, { surface: "browser" });
  await wait(100);
  let releaseDisposed;
  window.showOpenFilePicker = () => new Promise(resolve => { releaseDisposed = () => resolve([handle]); });
  detached.querySelector("#package-load").click(); disposedUi.destroy(); releaseDisposed(); await wait(150);
  check("disposed controller cannot adopt a late selected file", disposedUi.experimentPackage === null && detached.researchUi === undefined);
  ui.openSetupSection("review"); await wait();
  q("#package-generate").scrollIntoView({ block: "end" });
  check("no controller errors", errors.length === 0);
  document.querySelector("#receipt").textContent = JSON.stringify({ passed: true, checks, errors,
    evidence: "Actual controller; synthetic media boundary; delayed real digest. No final master save or OS qualification." });
})().catch(error => { document.querySelector("#receipt").textContent = JSON.stringify({ passed: false, error: String(error.stack), checks, errors }); });
