import { bootResearchUi } from "../../site/src/research/app.js";
import { RESEARCH_UI_EVENTS } from "../../site/src/research/ui-contracts.js";
import { serializeXrLayoutProfileV1 } from "../../site/src/research/xr-layout.js";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { resolveSavedXrLayoutContribution } from "../../site/src/research/xr-layout-recipe.js";
import catalogue from "./research-video-catalogue-contribution-v1.json";
import savedXr from "./xr-layout-recipe-v1.json";

// Synthetic typed catalogue events exercise real application producers. No
// directory picker, decoder, WebXR session, native adapter or Run is invoked.
const checks = [], errors = [];
let layout = null;
window.addEventListener("error", (event) => errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));
const check = (name, pass) => { if (!pass) throw new Error(name); checks.push(name); };
const waitFor = async (predicate) => {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("The real producer did not settle.");
};
const rejected = async (action) => { try { await action(); return false; } catch { return true; } };

(async () => {
  const root = document.querySelector("main"); root.id = "research-app"; root.dataset.researchSurface = "browser";
  bootResearchUi(); const ui = root.researchUi, q = (selector) => root.querySelector(selector);
  const change = (selector, value) => {
    const field = q(selector); field.value = value; field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const enable = (value) => { q("[data-xr-enabled]").checked = value; q("[data-xr-enabled]").dispatchEvent(new Event("change", { bubbles: true })); };
  const publish = (missingGeometry = false) => root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.stimuliCatalogued, { detail: {
    replace: true, items: catalogue.entries.map((entry, index) => ({
      stimulus: { stimulusId: `video-${index}`, title: entry.annotationId, source: {
        kind: "workspaceFile", relativePath: entry.sourceRelativePath, mimeType: "video/mp4",
        sha256: entry.sha256, byteLength: entry.byteLength, durationMs: entry.durationMs,
      } }, verified: true, displayGeometry: missingGeometry && index === 1 ? null : entry.geometry,
    })),
  } }));
  const dependencies = () => ({ P1: ui.getWorkspaceContributionSnapshot(), P5: ui.getFeedbackContributionSnapshot() });
  await ui.waitForXrLayoutDependencies();
  check("disabled XR survives unavailable catalogue", !ui.getXrLayoutContribution().enabled && ui.getXrLayoutDependencyStatus().pending);
  publish(); await waitFor(() => !ui.getVideoCatalogueContributionSnapshot().pending); await ui.waitForXrLayoutDependencies();
  check("actual P1 and P5 connect automatically", !ui.getXrLayoutDependencyStatus().pending);
  enable(true); ui.openSetupSection("xr"); await ui.prepareXrLayoutContribution({ isCurrent: () => true });
  let accepted = ui.getXrLayoutContribution();
  check("accepted profile binds actual owner revisions", accepted.dependencyRevisions[0].revision === dependencies().P1.revision
    && accepted.dependencyRevisions[1].revision === dependencies().P5.revision && !accepted.pending);
  check("real media catalogue populates inspection", q("[data-xr-media]").options.length === 3);
  check("actual P5 full envelope renders", !!q(".xr-feedback-envelope"));
  await ui.acceptPlannerContribution("P1"); await ui.acceptPlannerContribution("P5");
  await ui.acceptPlannerContribution("P6", { selectedTarget: "webxr-immersive-vr" });
  check("P7 accepts validated live P6", ui.getPlannerAcceptanceReview({ required: ["P1", "P5", "P6"] }).entries.find((item) => item.segment === "P6").status === "accepted");
  const catalogueRevision = dependencies().P1.contribution.videoCatalogue.revision;
  change("#experiment-title", "XR geometry study");
  check("study-only edit withdraws P6 and P7 acceptance", ui.getXrLayoutContribution().pending
    && ui.getPlannerAcceptanceReview().entries.find((item) => item.segment === "P6").status !== "accepted");
  await ui.waitForXrLayoutDependencies(); accepted = await ui.prepareXrLayoutContribution();
  check("P6 binds registered workspace revision without revising nested catalogue", accepted.dependencyRevisions[0].revision === dependencies().P1.revision
    && dependencies().P1.contribution.videoCatalogue.revision === catalogueRevision);
  await ui.acceptPlannerContribution("P1"); await ui.acceptPlannerContribution("P6", { selectedTarget: "webxr-immersive-vr" });
  q("[data-xr-media]").value = catalogue.entries[1].assetId; q("[data-xr-media]").dispatchEvent(new Event("change", { bubbles: true }));
  check("portrait fit uses P1 geometry", q("[data-xr-readout]").textContent.includes("0.380"));
  q('[data-xr-view="side"]').click();
  check("camera and inspected asset preserve accepted revision", ui.getXrLayoutContribution().revision === accepted.revision);
  change('[data-xr-field="video.distanceMetres"]', "3");
  check("XR edits withdraw contribution and P7 acceptance", ui.getXrLayoutContribution().pending
    && ui.getPlannerAcceptanceReview().entries.find((item) => item.segment === "P6").status !== "accepted");
  await ui.acceptXrLayoutContribution(); accepted = ui.getXrLayoutContribution();
  const savedFeedback = dependencies().P5;
  change("#grid-cursor-size", "35");
  check("saved feedback changes withdraw XR immediately", ui.getXrLayoutContribution().pending);
  await ui.waitForXrLayoutDependencies(); await ui.acceptXrLayoutContribution();
  check("feedback revision is rebound", ui.getXrLayoutContribution().dependencyRevisions[1].revision === dependencies().P5.revision);
  change("#color-idle-hex", "invalid"); await ui.waitForXrLayoutDependencies();
  check("invalid feedback clears painted bound", dependencies().P5.pending && ui.getXrLayoutDependencyStatus().pending && !q(".xr-feedback-envelope"));
  check("invalid feedback prevents experiment-layout acceptance", await rejected(() => ui.acceptXrLayoutContribution()));
  await ui.restoreFeedbackContribution(savedFeedback.contribution); await ui.waitForXrLayoutDependencies(); await ui.acceptXrLayoutContribution();
  const feedbackRevision = dependencies().P5.revision, xrRevision = ui.getXrLayoutContribution().revision;
  change("#preview-halo-size", "250");
  check("saved V2 halo invalidates P5 and XR", dependencies().P5.revision > feedbackRevision
    && ui.getXrLayoutContribution().revision > xrRevision && ui.getXrLayoutContribution().pending);
  await ui.waitForXrLayoutDependencies(); await ui.prepareXrLayoutContribution();
  const beforeFullRestore = ui.getXrLayoutContribution().contribution;
  for (const renderer of ["flubber", "grid", "procedural-face"]) {
    const desired = structuredClone(savedXr.feedbackV2); desired.presentation.renderer = renderer;
    desired.presentation.halo.gradient = true;
    await ui.restoreFeedbackContribution(desired, { isCurrent: () => true });
    check(`${renderer} complete saved feedback restores without losing fields`, canonicalJson(dependencies().P5.contribution) === canonicalJson(desired));
    check(`${renderer} restore withdraws XR preparation`, ui.getXrLayoutContribution().pending);
    await ui.waitForXrLayoutDependencies(); const prepared = await ui.prepareXrLayoutContribution();
    const current = dependencies();
    const resolved = await resolveSavedXrLayoutContribution(prepared.contribution, {
      workspaceContribution: current.P1.contribution, feedbackContribution: current.P5.contribution,
      selectedTarget: "webxr-immersive-vr",
    });
    check(`${renderer} XR binds the complete live P5 envelope`, prepared.dependencyRevisions[1].revision === current.P5.revision
      && resolved.feedback.configurationKey === ui.getFeedbackLayoutSnapshot(1024).envelope.configurationKey
      && canonicalJson(prepared.contribution) === canonicalJson(beforeFullRestore));
  }
  await ui.restoreFeedbackContribution(savedFeedback.contribution); await ui.waitForXrLayoutDependencies(); await ui.prepareXrLayoutContribution();
  publish(true); await waitFor(() => dependencies().P1.pending); await ui.waitForXrLayoutDependencies();
  check("one unsupported video withdraws all geometry", ui.getXrLayoutDependencyStatus().pending && q("[data-xr-media]").options.length === 1);
  check("missing geometry cannot be accepted", await rejected(() => ui.acceptXrLayoutContribution()));
  const draftOnly = ui.restoreXrLayoutDraft(accepted.contribution, { isCurrent: () => true });
  check("saved XR draft reopens with unresolved media without accepting it", draftOnly.enabled && draftOnly.pending
    && draftOnly.contribution === null && q('[data-xr-field="video.distanceMetres"]').value === String(accepted.contribution.video.distanceMetres));
  check("draft-only reopen still requires verified live media", await rejected(() => ui.prepareXrLayoutContribution()));
  publish(); await waitFor(() => !dependencies().P1.pending); await ui.waitForXrLayoutDependencies();
  const restored = await ui.restoreXrLayoutContribution(accepted.contribution, { dependencies: dependencies(), selectedTarget: "webxr-immersive-vr" });
  check("reopen preserves exact canonical profile", serializeXrLayoutProfileV1(restored.contribution) === serializeXrLayoutProfileV1(accepted.contribution));
  const beforeRejected = JSON.stringify(ui.getXrLayoutContribution());
  check("desktop target cannot restore active XR", await rejected(() => ui.restoreXrLayoutContribution(accepted.contribution, { dependencies: dependencies(), selectedTarget: "desktop" })));
  check("cancelled restore is rejected", await rejected(() => ui.restoreXrLayoutContribution(accepted.contribution, { selectedTarget: "webxr-immersive-vr", isCurrent: () => false })));
  check("rejected restores leave editor intact", JSON.stringify(ui.getXrLayoutContribution()) === beforeRejected);
  check("P7 refuses absent selected XR target", await rejected(() => ui.acceptPlannerContribution("P6")));
  enable(false); await ui.acceptPlannerContribution("P6");
  check("explicitly excluded XR adds no desktop issue", ui.getPlannerContributionReview().issues.every((issue) => issue.segment !== "P6")
    && ui.getPlannerAcceptanceReview().entries.find((item) => item.segment === "P6").status === "excluded");
  const completeProfile = savedXr.profiles[0];
  ui.restoreXrLayoutSelection({ status: "included", profile: completeProfile }, { isCurrent: () => true });
  check("included master selection renders every authored spatial field as a pending draft", q("[data-xr-enabled]").checked
    && ui.getXrLayoutContribution().pending && [...q("[data-xr-layout-editor]").querySelectorAll("[data-xr-field]")].every((field) => {
      const [group, key] = field.dataset.xrField.split(".");
      return (field.type === "checkbox" ? field.checked : Number(field.value)) === completeProfile[group][key];
    }));
  await ui.prepareXrLayoutContribution();
  check("prepared master profile preserves complete canonical content", serializeXrLayoutProfileV1(ui.getXrLayoutContribution().contribution) === serializeXrLayoutProfileV1(completeProfile));
  change("#planner-presentation-target", "webxr-immersive-vr");
  await ui.acceptPlannerContribution("P6", { selectedTarget: ui.getSelectedPlannerTarget() });
  change("#planner-presentation-target", "desktop-screen");
  check("explicit desktop target expires XR acceptance", ui.getPlannerAcceptanceReview().entries.find((item) => item.segment === "P6").status !== "accepted");
  check("included XR cannot be accepted for selected desktop target", await rejected(() => ui.acceptPlannerContribution("P6", { selectedTarget: ui.getSelectedPlannerTarget() })));
  ui.restoreXrLayoutSelection({ status: "excluded" }, { isCurrent: () => true });
  check("excluded master clears prior document state and disables XR", !q("[data-xr-enabled]").checked && !ui.getXrLayoutContribution().enabled
    && ui.getXrLayoutContribution().contribution === null && q('[data-xr-field="video.distanceMetres"]').value === "2");
  enable(true); check("reenabling excluded master requires fresh preparation", ui.getXrLayoutContribution().pending);
  ui.restoreXrLayoutSelection({ status: "included", profile: completeProfile }, { isCurrent: () => true });
  change("#planner-presentation-target", "webxr-immersive-vr");
  await ui.prepareXrLayoutContribution(); q('[data-xr-view="orbit"]').click();
  await new Promise((done) => setTimeout(done, 100));
  check("no browser errors", errors.length === 0);
  const pane = q(".setup-pane");
  layout = { pane: { clientWidth: pane.clientWidth, scrollWidth: pane.scrollWidth },
    overflowing: [...pane.querySelectorAll("*")].filter((element) => element.getBoundingClientRect().width
      && element.getBoundingClientRect().right > pane.getBoundingClientRect().left + pane.clientWidth + 1)
      .map((element) => ({ tag: element.tagName, id: element.id, className: element.className,
        right: element.getBoundingClientRect().right })).slice(0, 20) };
  pane.scrollTop += q("[data-xr-scene]").getBoundingClientRect().top - pane.getBoundingClientRect().top - 20;
  check("XR pane does not overflow horizontally", pane.scrollWidth <= pane.clientWidth + 1);
  document.querySelector("#receipt").textContent = JSON.stringify({ passed: true, checks, errors,
    layout, sourceScope: "synthetic catalogue through actual P1/P5/P6/P7 application owners", profile: ui.getXrLayoutContribution().contribution });
  ui.destroy(); await ui.waitForXrLayoutDependencies();
})().catch((error) => { document.querySelector("#receipt").textContent = JSON.stringify({ passed: false, error: error.message, checks, errors, layout }); });
