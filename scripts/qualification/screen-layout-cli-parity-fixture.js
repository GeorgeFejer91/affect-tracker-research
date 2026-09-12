// Non-shipping actual browser fixture. P1 geometry is synthetic, not imported media.
import { bootResearchUi } from "/site/src/research/app.js";
import { RESEARCH_UI_EVENTS } from "/site/src/research/ui-contracts.js";
import { createScreenLayoutDraftEditor } from "/site/src/research/screen-layout-editor.js";
import { screenLayoutDraftMarkup } from "/site/src/research/screen-layout-view.js";
import { createPlannerAuthoringP4 } from "/site/src/research/planner-authoring-p4.js";
import { createPlannerAuthoringSession } from "/site/src/research/planner-authoring-session.js";
import { PLANNER_COMMAND_SCHEMA } from "/site/src/research/planner-authoring-contract.js";
import { projectWorkspaceVideoCatalogueSnapshot } from "/site/src/research/workspace-contribution.js";
import { projectVideoDisplayGeometry } from "/site/src/research/video-catalogue-contribution.js";
import { serializeDesktopLayoutContribution, parseDesktopLayoutContribution } from "/site/src/research/desktop-layout-contribution.js";
import { canonicalJson } from "/site/src/research/canonical.js";

const config = JSON.parse(document.getElementById("p4-test-config").textContent);
const checks = [], errors = [], correspondence = [], commands = [], exports = {};
const check = (name, pass, detail) => { checks.push({ name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) }); if (!pass) throw Error(name); };
const equal = (name, actual, expected) => check(name, canonicalJson(actual) === canonicalJson(expected), { actual, expected });
const wait = () => new Promise(resolve => setTimeout(resolve, 50));
const until = async (predicate, label) => { for (let i = 0; i < 160; i++) { if (predicate()) return; await wait(); } throw Error("Timed out: " + label); };
const near = (a, b) => typeof a === "number" ? Math.abs(a - b) < 1e-8 : a && typeof a === "object"
  ? Object.keys(a).length === Object.keys(b ?? {}).length && Object.keys(a).every(key => near(a[key], b[key])) : a === b;
const normalized = draft => Object.fromEntries(Object.entries(draft).map(([key, value]) => [key,
  typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : value]));
const set = (id, value) => ({ kind: "set", field: `P4.${id}`, value });
const operation = (id, args = {}) => ({ kind: "operation", owner: "P4", operation: id, arguments: args });
addEventListener("error", event => errors.push(event.message));
addEventListener("unhandledrejection", event => errors.push(String(event.reason)));
let integratedSession = false, app, ui, session, cliEditor, root, pane;
try {
  app = bootResearchUi(); ui = app.researchUi;
  check("actual separate Planner role is declared", app.dataset.researchProgram === "planner");
  ui.openSetupSection("layout");
  if (config.width < 1000) app.querySelector("[data-setup-resizer]").dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  root = app.querySelector("[data-screen-layout-draft]"); pane = app.querySelector(".setup-pane");
  const field = key => root.querySelector(`[data-layout-field="${key}"]`);
  const openLayout = () => {
    if (app.querySelector('[data-setup-section="layout"] .setup-accordion-trigger').getAttribute("aria-expanded") !== "true") ui.openSetupSection("layout");
  };
  const scrollPane = (element, centre = true) => {
    const rect = element.getBoundingClientRect(), bounds = pane.getBoundingClientRect();
    pane.scrollTop += rect.top - bounds.top - (centre ? (bounds.height - rect.height) / 2 : 16);
  };
  const projection = () => ui.getScreenLayoutProjection();
  const draft = () => ui.getScreenLayoutDraftDocument();
  const snapshot = () => ui.getScreenLayoutContributionSnapshot();
  const dependencies = () => ({ workspace: ui.getWorkspaceContributionSnapshot().contribution, feedback: ui.getFeedbackContributionSnapshot().contribution });
  const sendCatalogue = missing => app.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.stimuliCatalogued, { detail: { replace: true,
    items: config.catalogue.entries.map((entry, index) => ({ stimulus: { stimulusId: `explicit-synthetic-${index}`, title: entry.annotationId,
      source: { kind: "workspaceFile", relativePath: entry.sourceRelativePath, mimeType: "video/mp4", sha256: entry.sha256,
        byteLength: entry.byteLength, durationMs: entry.durationMs } }, verified: true, displayGeometry: missing ? null : entry.geometry })) } }));
  sendCatalogue(false);
  await until(() => !ui.getVideoCatalogueContributionSnapshot().pending, "synthetic catalogue owner");
  await ui.refreshScreenLayoutCatalogue();
  check("fresh actual Planner has no selected reference policy", draft().draft.referencePolicy === null);
  const initialDraft = draft();
  integratedSession = Boolean(ui.plannerAuthoringSession?.snapshot().owners.P4);
  check("required production registration is present", !config.requireIntegrated || integratedSession);
  if (integratedSession) session = ui.plannerAuthoringSession;
  else {
    // Development comparison only: an independent real owner with actual browser
    // DOM, sharing the same production P1/P5 snapshots. No DOM test doubles.
    const comparisonDocument = document.implementation.createHTMLDocument("P4 typed-owner comparison");
    comparisonDocument.body.innerHTML = screenLayoutDraftMarkup();
    cliEditor = createScreenLayoutDraftEditor(comparisonDocument.querySelector("[data-screen-layout-draft]"), { dependencies: {
      getCatalogueSnapshot: () => ui.getWorkspaceContributionSnapshot(), projectSnapshot: projectWorkspaceVideoCatalogueSnapshot,
      projectCatalogue: projectVideoDisplayGeometry, getFeedbackSnapshot: () => ui.getFeedbackContributionSnapshot(),
      getFeedbackLayoutSnapshot: side => ui.getFeedbackLayoutSnapshot(side),
    } });
    await cliEditor.refreshCatalogue();
    session = createPlannerAuthoringSession({ owners: [createPlannerAuthoringP4({ editor: cliEditor })] });
  }
  const command = async (action, expectedRevision) => {
    const request = { schema: PLANNER_COMMAND_SCHEMA, version: 1, sessionId: session.sessionId, requestId: crypto.randomUUID(),
      expectedRevision: expectedRevision ?? (["set", "apply"].includes(action.kind) ? session.revision : null), action };
    const response = await session.execute(request); commands.push({ request, response }); return response;
  };
  const apply = async edits => {
    const response = await command({ kind: "apply", edits });
    check("typed edit applied: " + edits.map(edit => edit.field ?? edit.operation).join(","), ["applied", "incomplete"].includes(response.status), response.issues);
  };
  const catalogue = (await command({ kind: "catalogue" })).result;
  const settings = catalogue.settings.filter(setting => setting.id.startsWith("P4.") && setting.writable);
  equal("complete authored registry", settings.length, 15);
  equal("both supported operations", catalogue.operations.filter(item => item.owner === "P4").map(item => item.id).sort(), ["clearCalibration", "convertUnits"]);
  const cliDraft = () => integratedSession ? draft() : cliEditor.getDraftDocument();
  const cliProjection = () => integratedSession ? projection() : cliEditor.projection;
  const cliPrepare = () => integratedSession ? ui.prepareScreenLayoutContribution() : cliEditor.prepareContribution();
  const readProjection = p => ({ geometry: p.geometry, videos: p.videos, referenceCandidates: p.referenceCandidates, profile: p.profile ?? null });
  const state = () => ({ draft: normalized(draft().draft), projection: readProjection(projection()) });
  const cliState = () => ({ draft: normalized(cliDraft().draft), projection: readProjection(cliProjection()) });
  const edit = (key, value, reach = false) => {
    openLayout();
    const control = field(key);
    for (const details of root.querySelectorAll("details")) if (details.contains(control)) details.open = true;
    if (reach) {
      scrollPane(control); control.focus({ preventScroll: true });
      const rect = control.getBoundingClientRect(), bounds = pane.getBoundingClientRect();
      check("rendered labelled reachable control: " + key, control.labels.length > 0 && rect.width > 0 && rect.height > 0
        && !control.disabled && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1
        && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1 && document.activeElement === control);
    }
    if (control.type === "checkbox") control.checked = value; else control.value = value ?? "";
    control.dispatchEvent(new Event(control.tagName === "SELECT" || control.type === "checkbox" ? "change" : "input", { bubbles: true }));
  };
  const encode = async contribution => {
    const bytes = await serializeDesktopLayoutContribution(contribution, dependencies());
    equal("strict exported P4 profile roundtrip", await parseDesktopLayoutContribution(bytes, dependencies()), contribution);
    return bytes;
  };
  const examples = [
    ["viewport.widthCssPx", 1600, "screenWidth"], ["viewport.heightCssPx", 900, "screenHeight"],
    ["calibration.activeWidthMm", 480, "physicalWidth"], ["calibration.activeHeightMm", 270, "physicalHeight"],
    ["calibration.fullViewportMapping", true, "fullViewportMapping"], ["reference.method", config.policy, "referencePolicy"],
    ["units", "mm", "units"], ["reference.maximumWidth", 230, "referenceWidth"], ["reference.maximumHeight", 120, "referenceHeight"],
    ["reference.centreX", 240, "referenceX"], ["reference.centreY", 80, "referenceY"], ["feedback.viewportSide", 4.25, "diameter"],
    ["feedback.offsetX", -6.5, "offsetX"], ["feedback.offsetY", 95, "offsetY"], ["feedback.minimumGap", 1.5, "gap"],
  ];
  equal("every writable setting is exercised", examples.map(([id]) => `P4.${id}`).sort(), settings.map(setting => setting.id).sort());
  const uiStates = [];
  for (const [id, value, key] of examples) {
    const setting = settings.find(setting => setting.id === `P4.${id}`);
    check("actual UI metadata correspondence: " + id, field(key).id === setting.uiControl);
    edit(key, value, true); uiStates.push(state());
  }
  const confirm = app.querySelector('[data-confirm-section="layout"]');
  scrollPane(confirm); confirm.click();
  await until(() => ui.getPlannerAcceptanceReview().entries.find(entry => entry.segment === "P4").status === "accepted", "actual Confirm section button");
  exports.ui = await encode(snapshot().contribution);
  const uiProfile = structuredClone(snapshot().contribution);
  check("actual UI confirmation accepts P4", !snapshot().pending);
  if (integratedSession) await ui.restoreScreenLayoutDraft(initialDraft);
  for (const [index, [id, value, key]] of examples.entries()) {
    await apply([set(id, value)]);
    equal("complete UI/CLI state parity: " + id, cliState(), uiStates[index]);
    const result = await command({ kind: "get", field: `P4.${id}` });
    equal("typed field readback: " + id, result.result.value, value);
    const setting = settings.find(setting => setting.id === `P4.${id}`);
    const saved = setting.jsonPath.split(".").slice(2).reduce((node, key) => node[key], uiProfile);
    equal("saved path parity: " + id, id === "calibration.fullViewportMapping" ? saved.mapping === "full-viewport" : saved, value);
    correspondence.push({ id: `P4.${id}`, uiControl: field(key).id, value, jsonPath: setting.jsonPath, savedValue: saved });
  }
  exports.cli = await encode((await cliPrepare()).contribution);
  equal("UI and typed CLI exported P4 bytes are identical", exports.cli, exports.ui);
  const paired = async (name, uiEdits, cliEdits, save = false) => {
    const before = draft();
    for (const [key, value] of uiEdits) edit(key, value);
    const expected = state();
    const bytes = save ? await encode((await ui.prepareScreenLayoutContribution()).contribution) : null;
    if (integratedSession) await ui.restoreScreenLayoutDraft(before);
    await apply(cliEdits); equal(name + " complete state parity", cliState(), expected);
    if (save) equal(name + " exported bytes parity", await encode((await cliPrepare()).contribution), bytes);
    return expected;
  };
  const beforeConversion = projection().geometry;
  await paired("convertUnits operation", [["units", "relative"]], [operation("convertUnits", { units: "relative" })], true);
  check("unit conversion preserves resolved geometry", near(projection().geometry, beforeConversion));
  correspondence.push({ operation: "convertUnits", arguments: { units: "relative" }, uiControls: ["layout-units"], completeProfileEqual: true });
  await paired("clearCalibration operation", [["physicalWidth", ""], ["physicalHeight", ""], ["fullViewportMapping", false]], [operation("clearCalibration")], true);
  check("clearing calibration saves null", (await cliPrepare()).contribution.calibration === null);
  correspondence.push({ operation: "clearCalibration", arguments: {}, uiControls: ["layout-physicalWidth", "layout-physicalHeight", "layout-fullViewportMapping"], completeProfileEqual: true });
  await paired("restore explicit calibration", [["physicalWidth", 480], ["physicalHeight", 270], ["fullViewportMapping", true]],
    [set("calibration.activeWidthMm", 480), set("calibration.activeHeightMm", 270), set("calibration.fullViewportMapping", true)]);
  await paired("ordered offset/conversion/offset", [["offsetX", 10], ["units", "mm"], ["offsetX", 8]],
    [set("feedback.offsetX", 10), operation("convertUnits", { units: "mm" }), set("feedback.offsetX", 8)], true);
  check("millimetre centre offset uses calibrated scale", Math.abs(projection().geometry.offset.x - 8 * 1600 / 480) < 1e-8);
  const stable = draft();
  edit("diameter", ""); check("actual invalid numeric input withdraws geometry", projection().geometry === null && !root.querySelector("svg") && snapshot().pending);
  await ui.restoreScreenLayoutDraft(stable);
  const beforeReject = cliState();
  const rejected = await command({ kind: "apply", edits: [set("feedback.offsetX", 100), set("geometry", {})] });
  check("read-only mixed batch rejects", rejected.status === "rejected"); equal("rejected batch preserves entire P4 draft", cliState(), beforeReject);
  const revision = session.revision; await apply([set("feedback.offsetX", 8)]);
  const stale = await command(set("feedback.offsetX", 7), revision);
  check("stale typed request rejects", stale.status === "rejected");
  const selected = root.querySelector("[data-layout-video]"), beforeInspect = state(), oldRevision = snapshot().revision;
  selected.value = selected.options[selected.options.length - 1].value; selected.dispatchEvent(new Event("change", { bubbles: true }));
  equal("video inspection preserves authored and derived layout", state(), beforeInspect);
  check("video inspection is transient", snapshot().revision === oldRevision);
  const selectedBounds = projection().videos.find(video => video.id === selected.value).bounds;
  const renderedVideo = root.querySelector(".layout-video");
  check("rendered video has exact selected contain bounds", renderedVideo !== null
    && ["x", "y", "width", "height"].every(key => Number(renderedVideo.getAttribute(key)) === selectedBounds[key]));
  const prepared = await ui.prepareScreenLayoutContribution();
  const p1Revision = ui.getWorkspaceContributionSnapshot().revision;
  const title = app.querySelector("#experiment-title"); title.value = "P4 synthetic dependency revision"; title.dispatchEvent(new Event("input", { bubbles: true }));
  await until(() => ui.getWorkspaceContributionSnapshot().revision > p1Revision && snapshot().revision > prepared.revision
    && projection().videos.length === config.catalogue.entries.length, "P1 invalidation and revalidation");
  check("P1 revision invalidates accepted P4 and binds current source", snapshot().pending && snapshot().dependencyRevisions.some(item => item.segment === "P1" && item.revision === ui.getWorkspaceContributionSnapshot().revision));
  const feedback = ui.getFeedbackContributionSnapshot().contribution;
  const invalidFeedback = app.querySelector("#input-step-size"); invalidFeedback.value = ""; invalidFeedback.dispatchEvent(new Event("input", { bubbles: true }));
  await until(() => ui.getFeedbackContributionSnapshot().pending, "P5 invalidation");
  check("pending P5 withdraws maximum bounds", projection().geometry.maximumFeedback === null && snapshot().pending);
  await ui.restoreFeedbackContribution(feedback);
  await until(() => projection().geometry.maximumFeedback !== null, "P5 recovery");
  sendCatalogue(true); await until(() => ui.getVideoCatalogueContributionSnapshot().pending && projection().videos.length === 0, "catalogue withdrawal");
  check("missing source geometry is not replaced by old reference", projection().geometry === null && projection().referenceCandidates === null);
  sendCatalogue(false); await until(() => projection().videos.length === config.catalogue.entries.length, "catalogue recovery");
  check("recovered source is derived from complete synthetic catalogue", projection().profile.reference.source.policy === config.policy && projection().referenceCandidates !== null);
  openLayout(); await ui.prepareScreenLayoutContribution();
  for (const details of root.querySelectorAll("details")) details.open = config.view === "controls" && details.classList.contains("layout-calibration");
  check("no pane horizontal overflow", pane.scrollWidth <= pane.clientWidth);
  const bounds = root.getBoundingClientRect();
  check("all displayed controls remain within editor", [...root.querySelectorAll("input,select,button")].filter(control => control.getBoundingClientRect().width > 0)
    .every(control => { const r = control.getBoundingClientRect(); return r.left >= bounds.left - 1 && r.right <= bounds.right + 1; }));
  const footer = app.querySelector('[data-confirm-section="layout"]'); scrollPane(footer);
  check("confirmation footer is reachable", footer.getBoundingClientRect().bottom <= pane.getBoundingClientRect().bottom + 1);
  window.scrollTo(0, 0);
  if (config.view === "controls") scrollPane(root.querySelector(".layout-calibration summary"), false);
  else if (config.view === "placement") scrollPane(field("referencePolicy").labels[0], false);
  else scrollPane(root.closest('[data-setup-section="layout"]'), false);
  await wait(); check("no runtime errors", errors.length === 0);
} catch (error) { errors.push(String(error.stack)); }
const receipt = { name: config.name, checks, errors, correspondence, commands, exports, integratedSession,
  userAgent: navigator.userAgent, paneWidth: pane?.clientWidth ?? null, viewport: { width: innerWidth, height: innerHeight },
  syntheticCatalogue: true, inputMechanism: "DOM events in an isolated headless browser; no physical/user desktop input",
  nativeCli: false, realMediaImport: false, finalProjection: ui?.getScreenLayoutProjection() ?? null };
await fetch(config.receiptPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(receipt) });
