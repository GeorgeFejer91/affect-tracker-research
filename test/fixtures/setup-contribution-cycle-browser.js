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
  const source = `${canonicalJson(legacyRecipe)}\n`, bytes = new TextEncoder().encode(source);
  let picks = 0;
  window.showOpenFilePicker = () => {
    picks += 1;
    return Promise.resolve([{ kind: "file", getFile: async () => ({ size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer }) }]);
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
  ui.openSetupSection("review"); await wait();
  q("#package-generate").scrollIntoView({ block: "end" });
  check("no controller errors", errors.length === 0);
  document.querySelector("#receipt").textContent = JSON.stringify({ passed: true, checks, errors,
    evidence: "Actual controller; synthetic media boundary; delayed real digest. No final master save or OS qualification." });
})().catch(error => { document.querySelector("#receipt").textContent = JSON.stringify({ passed: false, error: String(error.stack), checks, errors }); });
