import { createXrLayoutEditor } from "../../site/src/research/xr-layout-editor.js";
import { xrLayoutEditorMarkup } from "../../site/src/research/xr-layout-view.js";
import { createDefaultXrLayoutProfile, serializeXrLayoutProfileV1 } from "../../site/src/research/xr-layout.js";
import { createPlannerAuthoringP6 } from "../../site/src/research/planner-authoring-p6.js";
import { createPlannerAuthoringSession } from "../../site/src/research/planner-authoring-session.js";
import { canonicalJson } from "../../site/src/research/canonical.js";
import envelope from "./xr-feedback-envelope-v1.json";

const checks = [], errors = [], parity = [];
window.addEventListener("error", event => errors.push(event.message));
window.addEventListener("unhandledrejection", event => errors.push(String(event.reason)));
const check = (name, condition) => { checks.push({ name, passed: Boolean(condition) }); if (!condition) throw new Error(name); };
const set = (field, value) => ({ kind: "set", field: `P6.${field}`, value });
const values = { enabled: false, "video.distanceMetres": 4.25, "video.azimuthDegrees": 12,
  "video.elevationDegrees": -9, "video.widthMetres": 1.7, "video.heightMetres": 0.85,
  "video.yawDegrees": 14, "video.pitchDegrees": -11, "video.rollDegrees": 24,
  "feedback.enabled": false, "feedback.offsetXMetres": 0.2, "feedback.offsetYMetres": -1.1,
  "feedback.diameterMetres": 0.35, "feedback.minimumGapMetres": 0.08 };

(async () => {
  const root = document.querySelector("main");
  root.className = "research-app";
  root.innerHTML = `<div class="setup-pane"><h1>VR screen layout · CLI/UI parity</h1>${xrLayoutEditorMarkup()}</div>`;
  const host = root.querySelector("[data-xr-layout-editor]"), q = selector => host.querySelector(selector);
  let session = null, publications = 0;
  const editor = createXrLayoutEditor(host, { onChange() { publications++; if (session && !session.publishing) session.edited(); } });
  const adapter = createPlannerAuthoringP6({ editor });
  session = createPlannerAuthoringSession({ owners: [adapter] });
  const execute = action => session.execute({ schema: "affect-research-planner-command", version: 1,
    sessionId: session.sessionId, requestId: crypto.randomUUID(), expectedRevision: session.revision, action });
  const baseline = serializeXrLayoutProfileV1(createDefaultXrLayoutProfile());
  function reset() {
    editor.loadProfile(baseline);
    editor.setDependencies({ catalogueRevision: 4, feedbackRevision: 6,
      catalogueGeometry: [{ assetId: "landscape", displayWidth: 1920, displayHeight: 1080 },
        { assetId: "portrait", displayWidth: 1080, displayHeight: 1920 }], feedbackEnvelope: envelope.cases[0].envelope });
  }
  function uiEdit(field, value) {
    const control = field === "enabled" ? q("[data-xr-enabled]") : q(`[data-xr-field="${field}"]`);
    if (control.type === "checkbox") control.checked = value; else control.value = String(value);
    control.dispatchEvent(new Event(field === "enabled" ? "change" : "input", { bubbles: true }));
  }
  function reveal(control) {
    for (let parent = control.parentElement; parent && parent !== host; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
    }
    return !control.disabled && control.getBoundingClientRect().width > 0 && control.getBoundingClientRect().height > 0;
  }
  const selection = () => editor.getSnapshot().enabled ? { status: "included", profile: editor.getDraft() } : { status: "excluded" };
  for (const [field, value] of Object.entries(values)) {
    reset();
    const result = await execute(set(field, value));
    check(`${field}: shared command applied`, result.status === "applied");
    const expectedProfile = serializeXrLayoutProfileV1(editor.getDraft()), expectedSelection = canonicalJson(selection());
    const control = field === "enabled" ? q("[data-xr-enabled]") : q(`[data-xr-field="${field}"]`);
    check(`${field}: command projects into actual UI control`, (control.type === "checkbox" ? control.checked : Number(control.value)) === value);
    reset();
    check(`${field}: actual UI control is reachable and enabled`, reveal(control));
    uiEdit(field, value);
    check(`${field}: actual UI event changes command readback`, adapter.read().values[`P6.${field}`] === value);
    check(`${field}: UI and command produce identical full P6 profile/selection`, serializeXrLayoutProfileV1(editor.getDraft()) === expectedProfile && canonicalJson(selection()) === expectedSelection);
    parity.push({ field: `P6.${field}`, value, profile: JSON.parse(expectedProfile), selection: JSON.parse(expectedSelection) });
  }
  reset();
  const operation = { kind: "operation", owner: "P6", operation: "setAngularSize", arguments: { widthDegrees: 30, heightDegrees: 20 } };
  const applied = await execute({ kind: "apply", edits: [set("feedback.enabled", false), set("video.distanceMetres", 4), operation] });
  check("angular operation applies through shared session", applied.status === "applied");
  const angularProfile = serializeXrLayoutProfileV1(editor.getDraft());
  reset(); uiEdit("feedback.enabled", false); uiEdit("video.distanceMetres", 4);
  check("angular operation is reachable through its actual UI disclosure", reveal(q('[data-xr-action="angles"]')));
  q('[data-xr-angle="width"]').value = "30"; q('[data-xr-angle="height"]').value = "20";
  q('[data-xr-action="angles"]').click();
  check("actual angular button and command produce identical physical profile", serializeXrLayoutProfileV1(editor.getDraft()) === angularProfile);
  parity.push({ operation: "setAngularSize", arguments: operation.arguments, profile: JSON.parse(angularProfile) });
  const beforeCamera = canonicalJson(editor.getSnapshot()), revision = session.revision;
  q('[data-xr-view="side"]').click();
  check("inspection camera updates transient readback", adapter.read().values["P6.inspection.camera"].yaw === 90);
  check("inspection camera changes neither profile nor authored revision", canonicalJson(editor.getSnapshot()) === beforeCamera && session.revision === revision);
  uiEdit("video.distanceMetres", "");
  check("empty actual number control remains an invalid string", adapter.read().values["P6.video.distanceMetres"] === ""
    && adapter.validate().some(issue => issue.field === "P6.video.distanceMetres") && !q("[data-xr-error]").hidden);
  check("typed command repairs the same invalid GUI draft", (await execute(set("video.distanceMetres", 4))).status === "applied"
    && q('[data-xr-field="video.distanceMetres"]').value === "4");
  const beforeStage = canonicalJson(editor.getAuthoringSnapshot()), beforeHtml = host.innerHTML, beforePublications = publications;
  const staged = await adapter.stage([set("video.distanceMetres", 7)], { isCurrent: () => true });
  check("actual owner staging leaves state, DOM and publication count untouched", canonicalJson(editor.getAuthoringSnapshot()) === beforeStage
    && host.innerHTML === beforeHtml && publications === beforePublications);
  uiEdit("video.distanceMetres", 9);
  check("new GUI edit expires staged command guard", !staged.isCurrent() && editor.getDraft().video.distanceMetres === 9);
  const cancelled = new AbortController();
  const pending = adapter.stage([set("video.distanceMetres", 7)], { isCurrent: () => true, signal: cancelled.signal });
  cancelled.abort();
  let rejected = false; try { await pending; } catch { rejected = true; }
  check("canceled actual owner stage preserves newer UI", rejected && editor.getDraft().video.distanceMetres === 9);
  const directStage = await adapter.stage([set("video.distanceMetres", 8)], { isCurrent: () => true });
  const oldDom = host.innerHTML, oldPublications = publications;
  directStage.commit();
  check("atomic commit installs state without DOM or observer calls", editor.getDraft().video.distanceMetres === 8
    && host.innerHTML === oldDom && publications === oldPublications);
  directStage.afterCommit();
  check("postcommit projection updates the actual control and observer", q('[data-xr-field="video.distanceMetres"]').value === "8"
    && publications === oldPublications + 1);
  directStage.afterCommit();
  check("postcommit projection is not published twice", publications === oldPublications + 1);
  check("no browser errors", errors.length === 0);
  document.querySelector("#receipt").textContent = JSON.stringify({ passed: true, checks, errors, parity, scope: "cli",
    sourceScope: "actual XR editor controls, P6 adapter and shared JS command session; synthetic typed geometry, no native CLI or media attestation" });
  session.destroy(); editor.destroy();
})().catch(error => { document.querySelector("#receipt").textContent = JSON.stringify({ passed: false, checks, errors, error: error.message, scope: "cli" }); });
