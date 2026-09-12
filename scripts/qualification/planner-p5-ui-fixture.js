import { bootResearchUi } from "../../site/src/research/app.js";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { createPlannerAuthoringP5, P5_AUTHORING_SETTINGS } from "../../site/src/research/planner-authoring-p5.js";
import { createInputBindingPreset, INPUT_PRESET_IDS } from "../../site/src/research/contracts.js";
import { withCustomDigitalAction } from "../../site/src/research/input-controller.js";
import { MAPPING_FIELDS, UI_PRESET_IDS } from "../../site/src/research/ui-contracts.js";
import { PLANNER_COMMAND_SCHEMA } from "../../site/src/research/planner-authoring-contract.js";
import configured from "../../test/fixtures/research-feedback-settings-v2.json";

const direct = {
  "visual.transparency": "visual-transparency", "visual.hideFeedback": "visual-hide-feedback",
  "visual.flubber.showOutline": "flubber-outline-visible", "visual.flubber.outlineThickness": "flubber-outline-thickness",
  "visual.flubber.showHalo": "flubber-halo-visible", "visual.grid.lineThickness": "grid-line-thickness",
  "visual.grid.showOutline": "grid-outline-visible", "visual.grid.outlineThickness": "grid-outline-thickness",
  "visual.grid.cursorSize": "grid-cursor-size", "presentation.halo.widthPercent": "preview-halo-size",
  "presentation.halo.gradient": "preview-halo-gradient", "presentation.halo.steepness": "preview-halo-steepness",
  "response.grid.columns": "preview-tile-columns", "response.grid.rows": "preview-tile-rows",
  "response.fullSpanDurationMs": "preview-full-span-duration", "response.repeatDelayMs": "preview-repeat-delay",
};
const compatibility = { "input.stepSize": "input-step-size", "visual.gridEnabled": "visual-grid-visible",
  "visual.flubberEnabled": "visual-flubber-visible", "visual.sizePercent": "visual-size",
  "visual.overlayPosition.x": "visual-position-x", "visual.overlayPosition.y": "visual-position-y", "visual.lockPosition": "visual-lock-position" };
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const at = (object, path) => path.split(".").reduce((value, key) => value[key], object);
const set = (path, value) => ({ kind: "set", field: `P5.${path}`, value });
const operation = preset => ({ kind: "operation", owner: "P5", operation: "inputPreset", arguments: { preset } });
const assert = (pass, message) => { if (!pass) throw Error(message); };
// A bounded event-loop settlement also works under Chromium virtual time;
// requestAnimationFrame alone can be starved when its screenshot timer expires.
const frame = () => new Promise(resolve => setTimeout(resolve, 20));

function alternative(setting, before) {
  if (setting.id === "P5.input") return createInputBindingPreset("wasd", before.stepSize);
  if (setting.enum) return setting.enum.find(value => value !== before);
  if (setting.type === "boolean") return !before;
  if (setting.pattern) return "#123abc";
  if (setting.type === "string") return "Authored label Δ";
  if (setting.id.includes("response.grid.")) return 33;
  if (setting.id.startsWith("P5.mappings.") && setting.id.endsWith(".min")) return before === 0 ? 0.05 : 0;
  if (setting.id.startsWith("P5.mappings.") && setting.id.endsWith(".max")) return before === setting.maximum ? setting.maximum - 0.01 : setting.maximum;
  return before === setting.minimum ? setting.maximum : setting.minimum;
}

export async function checkP5Ui({ scene = "overview", runChecks = true, requireIntegrated = false } = {}) {
  const root = bootResearchUi(), ui = root.researchUi, q = selector => root.querySelector(selector);
  const rows = [], actions = [], checks = [];
  const saved = () => ui.getFeedbackContributionSnapshot().contribution;
  const note = (name, pass) => { checks.push({ name, pass: Boolean(pass) }); assert(pass, name); };
  assert(root.dataset.researchProgram === "planner", "Fixture must use actual Planner program role");
  const session = ui.plannerAuthoringSession, transcript = [];
  assert(!requireIntegrated || session?.execute, "Actual production command session is required; no fixture owner registration permitted");
  ui.openSetupSection("feedback");
  await frame();
  async function command(action, expectedRevision = ["set", "apply"].includes(action.kind) ? session.revision : null) {
    const request = { schema: PLANNER_COMMAND_SCHEMA, version: 1, sessionId: session.sessionId,
      requestId: crypto.randomUUID(), expectedRevision, action };
    const result = await session.execute(request); transcript.push({ request, result }); return result;
  }
  if (session && runChecks) {
    const catalogue = await command({ kind: "catalogue" });
    note("production session exposes exactly the complete P5 catalogue", catalogue.status === "ok"
      && equal(catalogue.result.settings.filter(setting => setting.id.startsWith("P5.")), P5_AUTHORING_SETTINGS));
    note("production session registers all seven actual owners", equal(Object.keys(session.snapshot().owners).sort(), ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]));
  }
  function configuredProjection() {
    const { rendering: r, response: s } = ui.getPreviewInspectionSnapshot();
    return { renderer: r.displayMode, responseMode: r.responseMode, anchors: r.colorAnchorMode,
      transparencyPercent: r.transparencyPercent, hideFeedback: r.hideFeedback, colors: r.colors, flubber: r.flubber, grid: r.grid,
      mappings: [r.frequency, r.edgeSmoothness, r.amplitude, r.pulseSynchrony, r.waveVariation, r.saturation],
      response: { mode: s.mode, columns: s.tileCount, rows: s.tileRows, duration: s.fullSpanDurationMs, holdRule: s.holdRule, repeatDelayMs: s.repeatDelayMs },
      preset: q("#input-preset").value, labels: ["up", "right", "down", "left"].map(direction => q(`[data-color-anchor="${direction}"]`).textContent.trim()) };
  }

  async function visible(selector) {
    const element = q(selector); assert(element, `Missing control ${selector}`);
    const details = []; let ancestor = element.parentElement;
    while (ancestor && ancestor !== root) { if (ancestor.matches("details") && !ancestor.open) details.unshift(ancestor); ancestor = ancestor.parentElement; }
    for (const detail of details) detail.querySelector(":scope > summary").click();
    element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    await frame();
    const r = element.getBoundingClientRect();
    assert(element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }) && r.width > 0 && r.height > 0,
      `Control is not rendered ${selector}`);
    assert(!element.disabled && element.type !== "hidden", `Control is disabled/hidden ${selector}`);
    assert(r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1,
      `Control is outside viewport ${selector}: ${JSON.stringify(r.toJSON())}`);
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (["auto", "scroll", "hidden", "clip"].includes(style.overflowY)) assert(r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1, `Control is clipped by ${parent.className}: ${selector}`);
    }
    actions.push({ selector, tag: element.tagName, type: element.type, label: element.getAttribute("aria-label") || element.labels?.[0]?.textContent.trim() || element.textContent.trim(),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height }, enabled: true, rendered: true, synthetic: true });
    return element;
  }
  async function click(selector) { (await visible(selector)).click(); await frame(); }
  async function edit(selector, value) {
    const control = await visible(selector);
    if (control.type === "checkbox") { if (control.checked !== value) control.click(); }
    else { control.focus(); control.value = String(value); control.dispatchEvent(new Event("input", { bubbles: true })); control.dispatchEvent(new Event("change", { bubbles: true })); }
    await frame();
  }
  async function restore(value) {
    for (const id of ["preview-color-cancel", "binding-capture-cancel"]) if (q(`#${id}`)?.closest("dialog")?.open) q(`#${id}`).click();
    assert(await ui.restoreFeedbackContribution(structuredClone(value), { isCurrent: () => true }) !== false, "Fixture seed restoration failed");
    assert(equal(saved(), value), "Fixture seed changed saved settings");
    await frame();
  }
  async function typed(before, edits, step = before.input.stepSize ?? 0.1) {
    // The typed owner is real; this detached editor hook is an explicitly labelled
    // oracle until Main's actual command surface is wired into the combined app.
    let draft = structuredClone(before);
    const adapter = createPlannerAuthoringP5({ readDraft: () => draft, readDigitalStep: () => step,
      prepareCommit: candidate => ({ commit() { draft = structuredClone(candidate); } }) });
    const stage = await adapter.stage(edits, { isCurrent: () => true });
    assert(stage.isCurrent(), "Typed oracle became stale"); stage.commit(); stage.afterCommit();
    return adapter.read().values["P5.contribution"];
  }
  async function operate(path, value) {
    if (direct[path]) return edit(`#${direct[path]}`, path === "visual.transparency" ? value * 100 : value);
    if (path === "input") return edit("#input-preset", UI_PRESET_IDS[value.preset]);
    if (path === "presentation.renderer") return click(`[data-feedback-preview-mode="${value === "procedural-face" ? "face" : value}"]`);
    if (path === "response.mode") return click(`[data-response-preview-mode="${value}"]`);
    if (path === "presentation.colorAnchors" || path === "response.holdRule") return click(`input[name="${path === "presentation.colorAnchors" ? "previewColorAnchors" : "previewHoldRule"}"][value="${value}"]`);
    if (path.startsWith("mappings.")) {
      const [, id, part] = path.split("."), spec = MAPPING_FIELDS.find(spec => spec.contractId === id);
      return edit(`[data-mapping="${spec.id}"] [data-mapping-${part === "drivenBy" ? "driver" : part}]`, value);
    }
    if (path.startsWith("visual.colors.")) {
      const direction = path.split(".").at(-1);
      if (!["up", "down", "left", "right"].includes(direction)) return edit(`#color-${direction}-hex`, value);
      await click(`[data-color-anchor="${direction}"]`); await edit("#preview-color-hex", value); return click("#preview-color-apply");
    }
    if (path.startsWith("presentation.labels.")) {
      const direction = path.split(".").at(-1);
      await click(`[data-color-anchor="${direction}"]`); await edit("#preview-color-label", value); return click("#preview-color-apply");
    }
    throw Error(`No real UI operation for ${path}`);
  }
  async function row(id, before, edits, action, detail = {}) {
    const actionStart = actions.length;
    try {
      await restore(before);
      const expected = await typed(before, edits);
      await action();
      const actual = saved();
      assert(equal(actual, expected), `Complete P5 mismatch for ${id}\nexpected:${canonicalJson(expected)}\nactual:${canonicalJson(actual)}`);
      const uiProjection = configuredProjection();
      const compatibilityPreserved = Object.keys(compatibility).every(path => path === "input.stepSize" ? true : equal(at(actual, path), at(before, path)));
      assert(compatibilityPreserved, `Compatibility values changed for ${id}`);
      let integrated = null;
      if (session) {
        const readAfterUi = await command({ kind: "get", field: "P5.contribution" });
        assert(readAfterUi.status === "ok" && equal(readAfterUi.result.value, actual), `Production command readback differs after UI edit: ${id}`);
        await restore(before);
        const revision = session.revision;
        const applied = await command({ kind: "apply", edits });
        assert(applied.status === "applied" && applied.revision === revision + 1, `Production edit did not apply once: ${id} ${canonicalJson(applied)}`);
        const readAfterCommand = await command({ kind: "get", field: "P5.contribution" });
        const commandSaved = saved(), commandProjection = configuredProjection();
        assert(readAfterCommand.status === "ok" && equal(readAfterCommand.result.value, expected) && equal(commandSaved, expected), `Production command P5 contribution differs: ${id}`);
        assert(equal(commandProjection, uiProjection), `Production command preview/control projection differs: ${id}\nUI:${canonicalJson(uiProjection)}\ncommand:${canonicalJson(commandProjection)}`);
        integrated = { beforeRevision: revision, applied, readAfterUi, readAfterCommand, commandSaved, uiProjection, commandProjection };
      }
      rows.push({ id, status: "verified", ...detail, actions: actions.slice(actionStart), expected, actual, compatibilityPreserved, integrated });
    } catch (error) { rows.push({ id, status: "unresolved", ...detail, actions: actions.slice(actionStart), error: error.stack }); }
  }

  if (runChecks) {
    for (const setting of P5_AUTHORING_SETTINGS.filter(setting => setting.writable)) {
      const path = setting.id.slice(3), before = structuredClone(configured);
      if (path.startsWith("presentation.labels.")) before.presentation.colorAnchors = path.split(".")[2];
      if (path === "presentation.halo.steepness") before.presentation.halo.gradient = true;
      if (path === "response.fullSpanDurationMs") before.response.mode = "continuous";
      if (path.startsWith("visual.flubber.") || path.startsWith("mappings.")) before.presentation.renderer = "flubber";
      const value = alternative(setting, at(before, path));
      await row(setting.id, before, [set(path, value)], () => operate(path, value), { kind: "setting", mode: {
        renderer: before.presentation.renderer, response: before.response.mode, anchors: before.presentation.colorAnchors, haloGradient: before.presentation.halo.gradient } });
    }
    for (const preset of INPUT_PRESET_IDS) {
      const before = structuredClone(configured);
      before.input = createInputBindingPreset(preset === "arrowKeys" ? "wasd" : "arrowKeys", 0.1);
      await row(`P5.inputPreset:${preset}`, before, [operation(preset)], () => edit("#input-preset", UI_PRESET_IDS[preset]), { kind: "operation" });
    }
    for (const renderer of ["flubber", "grid", "procedural-face"]) {
      const before = structuredClone(configured); before.presentation.renderer = renderer === "grid" ? "flubber" : "grid";
      await row(`P5.renderer:${renderer}`, before, [set("presentation.renderer", renderer)], () => operate("presentation.renderer", renderer), { kind: "transition" });
    }
    const custom = withCustomDigitalAction(configured.input, "up", { kind: "keyboard", code: "KeyQ" });
    await row("P5.input:custom-key-capture", configured, [set("input", custom)], async () => {
      await click("#preview-input-menu"); await click('[data-binding-capture-target="up"]');
      const area = await visible(".binding-capture-area"); area.focus();
      area.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ", key: "q", bubbles: true, cancelable: true }));
      area.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyQ", key: "q", bubbles: true, cancelable: true }));
      await click("#binding-capture-cancel");
    }, { kind: "capture", physicalInput: false });
    try {
      await restore(configured);
      note("all seven compatibility controls remain disabled in V2", Object.values(compatibility).every(id => q(`#${id}`).disabled));
      await edit("#preview-tile-columns", 8);
      note("even grid remains pending instead of exporting a previous valid value", saved() === null);
      await edit("#preview-tile-columns", 33);
      note("repaired grid saves exact current configuration", equal(saved(), await typed(configured, [set("response.grid.columns", 33)])));
      await restore(configured);
      await edit('[data-mapping="edge-smoothness"] [data-mapping-min]', "");
      note("blank numeric mapping remains pending", saved() === null);
      await edit("#visual-hide-feedback", true);
      note("unrelated UI edit preserves blank mapping and pending contribution", saved() === null && q("#mapping-edge-smoothness-min").value === "");
      await edit('[data-mapping="edge-smoothness"] [data-mapping-min]', 0);
      note("mapping recovery saves both edits", equal(saved(), await typed(configured, [set("visual.hideFeedback", true)])));
      await restore(configured);
      await click('[data-color-anchor="up"]'); await edit("#preview-color-label", "Unapplied dialog draft");
      note("unapplied label stays outside saved state", equal(saved(), configured));
      await click("#preview-color-cancel");
      note("canceled dialog leaves exact P5 state", equal(saved(), configured));
      const analog = structuredClone(configured); analog.input = createInputBindingPreset("pointerGrid", 0.1);
      await restore(analog); await edit("#input-preset", UI_PRESET_IDS.wasd);
      note("analog to digital preset reuses retained UI step", equal(saved(), { ...configured, input: createInputBindingPreset("wasd", 0.1) }));
      if (session) {
        await restore(configured);
        await edit('[data-mapping="edge-smoothness"] [data-mapping-min]', "");
        const pendingRevision = session.revision;
        const pendingEdit = await command({ kind: "apply", edits: [set("visual.hideFeedback", true)] });
        note("actual command preserves invalid GUI text and publishes incomplete once", pendingEdit.status === "incomplete" && pendingEdit.revision === pendingRevision + 1
          && saved() === null && q("#mapping-edge-smoothness-min").value === "" && q("#visual-hide-feedback").checked);
        await edit('[data-mapping="edge-smoothness"] [data-mapping-min]', 0);
        const repaired = await command({ kind: "get", field: "P5.contribution" });
        note("UI recovery after command edit has exact production command readback", repaired.status === "ok"
          && equal(repaired.result.value, await typed(configured, [set("visual.hideFeedback", true)])));
        const beforeReadonly = saved(), readonlyRevision = session.revision;
        for (const path of Object.keys(compatibility)) {
          const result = await command({ kind: "set", field: `P5.${path}`, value: at(beforeReadonly, path) });
          note(`production command rejects disabled compatibility setting ${path}`, result.status === "rejected" && result.revision === readonlyRevision && equal(saved(), beforeReadonly));
        }
      }
    } catch (error) { checks.push({ name: "pending, recovery and compatibility sequence", pass: false, error: error.stack }); }
  }

  await restore(configured);
  for (const detail of q(".preview-pane").querySelectorAll("details[open]")) detail.querySelector(":scope > summary").click();
  q(".preview-controls-scroll").scrollTop = 0;
  if (scene === "response") await visible("#preview-repeat-delay");
  if (scene === "advanced") await visible("#grid-cursor-size");
  if (scene === "mappings") await visible('[data-mapping="pulse-synchrony"] [data-mapping-max]');
  if (scene === "color") { await click('[data-color-anchor="up"]'); await edit("#preview-color-label", "A clearly readable applied or draft label Δ"); }
  if (scene === "input") await click("#preview-input-menu");
  await frame();
  const pane = q(".preview-pane"), overflow = pane.scrollWidth - pane.clientWidth;
  const fieldRows = rows.filter(row => row.kind === "setting");
  return { pass: rows.every(row => row.status === "verified") && checks.every(row => row.pass) && overflow <= 1,
    scene, program: root.dataset.researchProgram, viewport: { width: innerWidth, height: innerHeight },
    scope: "Production Planner controls/controller with synthetic DOM events; fixture restore used only for preconditions. No native media, real hardware or Runner claim.",
    integrated: Boolean(session), transcript,
    oracle: session ? "Actual registered seven-owner production command session compared in both directions with real UI edits, complete P5 contributions and configured preview projections. Detached typed P5 oracle provides an additional comparison."
      : "Actual typed P5 adapter with detached editor hooks; production command-surface comparison awaits combined integration.",
    writableSettingsExpected: P5_AUTHORING_SETTINGS.filter(setting => setting.writable).length,
    writableSettingsExercised: fieldRows.length, verified: fieldRows.filter(row => row.status === "verified").length,
    modeSpecificNotApplicable: 0, unresolved: fieldRows.filter(row => row.status === "unresolved").length,
    rows, checks, previewOverflow: overflow, sceneActions: actions.slice(-8) };
}
