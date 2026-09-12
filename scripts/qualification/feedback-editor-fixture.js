// Non-shipping DOM fixture. No platform adapter, workspace, media, acquisition or IPC.
import { bootResearchUi } from "../../site/src/research/app.js";
import { MAPPING_FIELDS, RESEARCH_UI_EVENTS, SETUP_SECTIONS } from "../../site/src/research/ui-contracts.js";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { resolveFeedbackEnvelopeV1 } from "../../site/src/research/feedback-envelope.js";

export async function checkFeedbackEditor({ settings, experimentReceipt, surface, zoom = 1, screenshotState = "default" }) {
  const rows = [];
  const check = (name, condition, detail = null) => {
    rows.push({ name, pass: Boolean(condition), ...(detail === null ? {} : { detail }) });
    if (!condition) throw new Error(`${name}: ${JSON.stringify(detail)}`);
  };
  const root = document.querySelector("#research-app");
  root.dataset.researchSurface = surface;
  bootResearchUi({ surface });
  const ui = root.researchUi;
  const query = (selector) => root.querySelector(selector);
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const savedFeedback = (value) => ({ input: value.input, visual: value.visual, mappings: value.advanced.mappings });
  const settle = async (predicate) => {
    for (let retry = 0; retry < 100; retry += 1) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Settings did not settle: ${query("#plan-hash")?.textContent}`);
  };
  const catalogFixture = () => root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.stimuliCatalogued, {
    detail: { replace: true, items: settings.stimuli.items },
  }));
  const load = async (value) => {
    await ui.applySettings(value);
    // Synthetic catalogue data exists only inside this isolated presentation fixture.
    catalogFixture();
    await settle(() => Boolean(ui.settings));
  };
  const change = (id, value) => {
    const control = query(`#${id}`);
    if (control.type === "checkbox") control.checked = value;
    else control.value = String(value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const checkControlSeparation = (label) => {
    const controls = [...query('[data-setup-section="feedback"]').querySelectorAll("input, select, button")]
      .filter((element) => !element.closest("[hidden], details:not([open])"))
      .map((element) => ({ id: element.id || element.getAttribute("aria-label"), bounds: element.getBoundingClientRect(),
        scrollRegion: element.closest(".preview-controls-scroll") }))
      .filter(({ bounds }) => bounds.width > 0 && bounds.height > 0);
    const overlaps = [];
    for (let a = 0; a < controls.length; a += 1) for (let b = a + 1; b < controls.length; b += 1) {
      if (controls[a].scrollRegion !== controls[b].scrollRegion) continue;
      const first = controls[a].bounds, second = controls[b].bounds;
      if (Math.min(first.right, second.right) - Math.max(first.left, second.left) > 1
        && Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 1) {
        overlaps.push([controls[a].id, controls[b].id]);
      }
    }
    check(label, overlaps.length === 0, overlaps);
  };
  try {
    if (screenshotState === "empty") {
      ui.openSetupSection("feedback", { focus: true });
      check("empty real boot has no accepted experiment", ui.settings === null && ui.mode === "setup");
      ui.destroy();
      return { pass: true, surface, screenshotState, rows };
    }
    root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.experimentLoaded, { detail: experimentReceipt }));
    await settle(() => query("#experiment-file-status")?.dataset.state === "ready");
    await load(settings);
    check("saved settings load unchanged", same(savedFeedback(ui.settings), savedFeedback(settings)));
    const notifications = [];
    const unsubscribe = ui.subscribeFeedbackChanges((snapshot) => notifications.push(snapshot));
    const initialFeedback = ui.getFeedbackContributionSnapshot();
    check("P5 current saved contribution is independent of experiment compilation", !initialFeedback.pending
      && canonicalJson(initialFeedback.contribution) === canonicalJson(savedFeedback(settings)));
    check("P5 live bounds use the current saved configuration", canonicalJson(ui.getFeedbackLayoutSnapshot(1024).envelope)
      === canonicalJson(resolveFeedbackEnvelopeV1(savedFeedback(settings), 1024)));
    const pane = query('[data-setup-section="feedback"]');
    check("one persistent feedback owner", root.querySelectorAll('[data-setup-section="feedback"]').length === 1);
    for (const id of ["input", "visual", "advanced"]) {
      check(`old ${id} navigation removed`, !query(`[data-open-section="${id}"]`));
    }
    for (const section of SETUP_SECTIONS) {
      ui.openSetupSection(section.id);
      check(`feedback stays visible from ${section.id}`, !pane.hidden && !pane.inert && pane.getClientRects().length > 0);
    }
    query('[data-open-section="feedback"]').click();
    check("feedback navigation focuses its title", document.activeElement?.id === "preview-title");
    const settingsGroups = [...query(".preview-controls-scroll").children].filter((element) => element.matches("section, details"));
    check("advanced is the last settings group", settingsGroups.at(-1)?.id === "preview-advanced-settings");
    const savedIds = ["input-preset", "input-step-size", "visual-grid-visible", "visual-flubber-visible",
      "visual-hide-feedback", "visual-size", "visual-position-x", "visual-position-y", "visual-lock-position",
      "visual-transparency", "flubber-outline-visible", "flubber-outline-thickness", "flubber-halo-visible",
      "grid-line-thickness", "grid-outline-visible", "grid-outline-thickness", "grid-cursor-size",
      ...Object.keys(settings.visual.colors).flatMap((id) => [`color-${id}`, `color-${id}-hex`]),
      ...MAPPING_FIELDS.flatMap(({ id }) => ["min", "max", "driver", "reverse"].map((part) => `mapping-${id}-${part}`))];
    check("every saved control exists once inside P5", savedIds.every((id) => root.querySelectorAll(`#${id}`).length === 1 && pane.contains(query(`#${id}`))));
    check("LSL retains one value owner in Review", ["enabled", "state-stream", "stream-type", "marker-stream", "source-id"]
      .every((id) => root.querySelectorAll(`#lsl-${id}`).length === 1 && query("#setup-panel-review").contains(query(`#lsl-${id}`))));

    change("input-preset", "wasd");
    change("input-step-size", 0.125);
    change("visual-grid-visible", false);
    change("visual-hide-feedback", true);
    change("visual-transparency", 37);
    change("visual-size", 42);
    change("visual-position-x", 0.23);
    change("visual-position-y", 0.67);
    change("visual-lock-position", true);
    change("flubber-outline-thickness", 4.25);
    change("flubber-outline-visible", false);
    change("flubber-halo-visible", false);
    change("grid-line-thickness", 2.5);
    change("grid-outline-thickness", 3.75);
    change("grid-outline-visible", false);
    change("grid-cursor-size", 19);
    for (const id of Object.keys(settings.visual.colors)) {
      const anchor = query(`[data-color-anchor="${id}"]`);
      if (anchor) {
        anchor.click();
        change("preview-color-hex", "#123456");
        query("#preview-color-apply").click();
      } else change(`color-${id}-hex`, "#123456");
    }
    check("map anchors have one editing flow", ["up", "down", "left", "right"].every((id) =>
      query(`#color-${id}`).type === "hidden" && query(`#color-${id}-hex`).type === "hidden"
      && !query(`[data-color-reset="${id}"]`)) && pane.querySelectorAll(".color-row").length === 4);
    for (const { id } of MAPPING_FIELDS) {
      change(`mapping-${id}-min`, 0.2);
      change(`mapping-${id}-max`, 0.6);
      change(`mapping-${id}-driver`, "angle");
      change(`mapping-${id}-reverse`, true);
    }
    await settle(() => ui.settings?.visual?.grid?.cursorSize === 19);
    const edited = structuredClone(ui.settings);
    const editedFeedback = ui.getFeedbackContributionSnapshot();
    check("saved edits update one P5 contribution and dependency revision", editedFeedback.revision > initialFeedback.revision
      && notifications.length > 0 && canonicalJson(editedFeedback.contribution) === canonicalJson(savedFeedback(edited)));
    check("digital binding and step serialize", edited.input.preset === "wasd" && edited.input.stepSize === 0.125);
    check("appearance and existing layout serialize", !edited.visual.gridEnabled && edited.visual.flubberEnabled
      && edited.visual.hideFeedback && edited.visual.transparency === 0.37 && edited.visual.sizePercent === 42
      && same(edited.visual.overlayPosition, { x: 0.23, y: 0.67 }) && edited.visual.lockPosition);
    check("outline halo and grid serialize", same(edited.visual.flubber, { showOutline: false, outlineThickness: 4.25, showHalo: false })
      && same(edited.visual.grid, { lineThickness: 2.5, showOutline: false, outlineThickness: 3.75, cursorSize: 19 }));
    check("all colors serialize", Object.values(edited.visual.colors).every((color) => color === "#123456"));
    check("all six mappings serialize", Object.values(edited.advanced.mappings).every((mapping) => same(mapping, { min: 0.2, max: 0.6, drivenBy: "angle", reverse: true })));
    check("LSL settings preserved through relocation", same(edited.advanced.lsl, settings.advanced.lsl));
    change("preview-halo-size", 200);
    query('[data-feedback-preview-mode="face"]').click();
    await settle(() => Boolean(ui.settings));
    check("preview drafts do not enter saved feedback", same(savedFeedback(ui.settings), savedFeedback(edited)));
    check("temporary simulator choices do not advance P5 revision", ui.getFeedbackContributionSnapshot().revision === editedFeedback.revision);
    for (const [id, invalid, original] of [["input-step-size", "", "0.125"], ["mapping-projection-amplitude-min", "", "0.2"],
      ["visual-position-x", "", "0.23"], ["color-idle-hex", "invalid", "#123456"]]) {
      change(id, invalid);
      const pending = ui.getFeedbackContributionSnapshot();
      check(`${id} invalidates contribution and bounds without a fallback`, pending.pending && pending.contribution === null
        && ui.getFeedbackLayoutSnapshot(1024).envelope === null);
      await settle(() => ui.settings === null);
      change(id, original);
      check(`${id} repair advances revision`, !ui.getFeedbackContributionSnapshot().pending
        && ui.getFeedbackContributionSnapshot().revision > pending.revision);
    }
    await settle(() => Boolean(ui.settings));
    const beforeRestore = ui.getFeedbackContributionSnapshot();
    const rejected = structuredClone(beforeRestore.contribution);
    rejected.visual.flubber.haloWidth = 200;
    let rejectedRestore = false;
    try { await ui.restoreFeedbackContribution(rejected); } catch { rejectedRestore = true; }
    check("invalid restore rejects atomically", rejectedRestore && ui.getFeedbackContributionSnapshot() === beforeRestore);
    check("stale restore leaves saved controls unchanged", await ui.restoreFeedbackContribution(savedFeedback(settings), { isCurrent: () => false }) === false
      && ui.getFeedbackContributionSnapshot() === beforeRestore);
    const restored = await ui.restoreFeedbackContribution(savedFeedback(settings));
    check("valid restore commits every P5 field and reports actual revision", restored.revision > beforeRestore.revision
      && canonicalJson(restored.contribution) === canonicalJson(savedFeedback(settings))
      && canonicalJson(notifications.at(-1).contribution) === canonicalJson(savedFeedback(settings)));
    unsubscribe();
    await load(settings);
    await load(JSON.parse(JSON.stringify(edited)));
    check("edited feedback roundtrip", same(savedFeedback(ui.settings), savedFeedback(edited)));
    check("reloaded controls match edited values", query("#input-step-size").value === "0.125"
      && query("#grid-cursor-size").value === "19" && query("#color-up-hex").value === "#123456"
      && query("#mapping-projection-amplitude-driver").value === "angle");

    // Give unrelated required legacy fields valid fixture values before testing P5 focus.
    change("participant-first-name", "Fixture"); change("participant-last-name", "Only");
    change("participant-age", 30); change("participant-gender", "X"); change("participant-handedness", "R");
    const invalidColor = query("#color-idle-hex");
    change("color-idle-hex", "invalid");
    for (const details of pane.querySelectorAll("details")) details.open = false;
    query("#start-experiment").disabled = false; // Fixture only: exercise the blocked validation path.
    query("#start-experiment").click();
    await Promise.resolve();
    check("invalid saved field is focused and disclosed", document.activeElement === invalidColor
      && invalidColor.getClientRects().length > 0 && invalidColor.closest("details").open,
      { focus: document.activeElement?.id, invalid: [...root.querySelectorAll('[aria-invalid="true"]')].map((element) => element.id) });
    check("validation did not start a session", ui.mode === "setup");
    checkControlSeparation("invalid field and reset controls do not overlap");
    const errorRow = invalidColor.closest(".color-row");
    check("invalid color controls fit their row", [...errorRow.querySelectorAll("input,button")].every((element) => {
      const bounds = element.getBoundingClientRect(), row = errorRow.getBoundingClientRect();
      return bounds.left >= row.left - 1 && bounds.right <= row.right + 1;
    }));
    if (screenshotState === "error") {
      ui.destroy();
      return { pass: true, surface, screenshotState, rows };
    }
    await load(settings);
    query('[data-feedback-preview-mode="flubber"]').click();
    for (const details of pane.querySelectorAll("details")) details.open = true;
    const paneBounds = pane.getBoundingClientRect();
    const overflow = [...pane.querySelectorAll("input,select,button")].filter((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && (bounds.left < paneBounds.left - 1 || bounds.right > paneBounds.right + 1);
    }).map((element) => ({ id: element.id || element.getAttribute("aria-label") || element.textContent.trim(),
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
      paneLeft: paneBounds.left, paneRight: paneBounds.right }));
    check("expanded controls fit the editor width", overflow.length === 0, overflow);
    check("editor has no horizontal overflow", pane.scrollWidth <= pane.clientWidth + 1,
      { scroll: pane.scrollWidth, client: pane.clientWidth });
    checkControlSeparation("expanded controls do not overlap");
    query('[data-confirm-section="feedback"]').click();
    check("feedback confirmation is available and announced", ui.reviewedSetupSections.includes("feedback")
      && query('[data-feedback-nav-status]').textContent === "Reviewed");
    ui.openSetupSection("feedback", { focus: true });
    query("#preview-advanced-settings").open = screenshotState === "advanced";
    pane.scrollIntoView({ block: "start" });
    if (screenshotState === "controls") query("#input-preset").focus();
    if (screenshotState === "advanced") query("#visual-size").focus();
    if (screenshotState === "color" || screenshotState === "long-label") {
      query('[data-color-anchor="up"]').click();
      change("preview-color-label", "High arousal during the anticipated final stimulus — researcher preview label");
      if (screenshotState === "long-label") query("#preview-color-apply").click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      check("custom label keeps the preview width", pane.scrollWidth <= pane.clientWidth + 1);
    }
    ui.destroy();
    return { pass: true, surface, viewport: { width: innerWidth, height: innerHeight, presentationScale: zoom }, rows };
  } catch (error) {
    ui.destroy();
    return { pass: false, error: error.message, rows };
  }
}
