// Runs the real Planner restore API. No replacement validator/controller or Runner.
import { bootResearchUi } from "../../site/src/research/app.js";
import { canonicalJson } from "../../site/src/research/canonical.js";
import { evaluateFlubberMappings } from "../../site/src/research/mappings.js";
import { PREVIEW_GREY } from "../../site/src/research/preview-appearance.js";
import configured from "../../test/fixtures/research-feedback-settings-v2.json";

export async function checkPreviewFeedbackRestore() {
  const root = bootResearchUi(), ui = root.researchUi, q = selector => root.querySelector(selector);
  const rows = [];
  const check = (name, pass) => { rows.push({ name, pass: Boolean(pass) }); if (!pass) throw Error(name); };
  const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
  const state = () => ui.getPreviewInspectionSnapshot();
  const saved = () => ui.getFeedbackContributionSnapshot().contribution;
  const key = (code, type = "keydown") => q(".preview-primary-stage").dispatchEvent(
    new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }));
  const change = (id, value) => {
    const field = q(`#${id}`); field.value = String(value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const restore = async value => {
    const result = await ui.restoreFeedbackContribution(structuredClone(value), { isCurrent: () => true });
    check("real restore succeeds", result !== false);
    check("all saved fields round trip exactly", equal(saved(), value));
  };
  const clocked = callback => {
    // Controlled adapter-time evidence, not a browser/device latency claim.
    const request = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame;
    const descriptor = Object.getOwnPropertyDescriptor(performance, "now");
    let now = 1000, id = 0; const pending = new Map();
    globalThis.requestAnimationFrame = fn => { pending.set(++id, fn); return id; };
    globalThis.cancelAnimationFrame = key => pending.delete(key);
    Object.defineProperty(performance, "now", { configurable: true, value: () => now });
    try {
      callback(delta => { now += delta; const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn(now)); });
    } finally {
      ui.resetPreviewInspection();
      globalThis.requestAnimationFrame = request; globalThis.cancelAnimationFrame = cancel;
      if (descriptor) Object.defineProperty(performance, "now", descriptor); else delete performance.now;
    }
  };
  const inspect = value => {
    const { rendering: r, response: s } = state(), p = value.presentation, v = value.visual;
    check("selected renderer restored", r.displayMode === (p.renderer === "procedural-face" ? "face" : p.renderer));
    check("palette placement and all colors restored", r.colorAnchorMode === p.colorAnchors && equal(r.colors, v.colors));
    check("V2 inspection framing is fixed; legacy geometry stays compatibility-only", equal(r.position, { x: 0.5, y: 0.5 })
      && r.sizePercent === 42 && r.lockPosition === true);
    check("active visibility and transparency restored", r.transparencyPercent === v.transparency * 100
      && r.hideFeedback === v.hideFeedback);
    check("all halo and outline settings restored", equal(r.flubber, { ...v.flubber,
      haloSizePercent: p.halo.widthPercent, haloGradient: p.halo.gradient, haloSteepness: p.halo.steepness }));
    check("all grid appearance settings restored", equal(r.grid, v.grid));
    check("response mode and independent dimensions restored", r.responseMode === value.response.mode
      && s.mode === value.response.mode && s.tileCount === value.response.grid.columns
      && s.tileRows === value.response.grid.rows && r.tileCount === s.tileCount && r.tileRows === s.tileRows);
    check("response duration, hold and repeat settings restored", s.fullSpanDurationMs === value.response.fullSpanDurationMs
      && s.holdRule === value.response.holdRule && s.repeatDelayMs === value.response.repeatDelayMs);
    check("restore starts neutral without held input", r.x === 0 && r.y === 0 && s.heldDirections.length === 0);
    const mapped = evaluateFlubberMappings(value.mappings, { x: r.x, y: r.y });
    check("all six mappings reach renderer", equal([r.frequency, r.edgeSmoothness, r.amplitude,
      r.pulseSynchrony, r.waveVariation, r.saturation], [mapped.oscillationFrequency, mapped.edgeSmoothness,
      mapped.projectionAmplitude, mapped.pulseSynchrony, mapped.waveSizeVariation, mapped.saturation]));
    check("restored labels appear on active anchors", ["up", "right", "down", "left"].every(direction =>
      q(`[data-color-anchor="${direction}"]`).textContent.includes(p.labels[p.colorAnchors][direction])));
  };

  await restore(configured); inspect(configured);
  q(".preview-primary-stage").focus();
  clocked(advance => {
    key("ArrowRight"); advance(899);
    check("configured repeat waits its full interval", Math.abs(state().rendering.x - 2 / 30) < 1e-9);
    advance(1);
    check("configured repeat moves one tile at interval", Math.abs(state().rendering.x - 4 / 30) < 1e-9);
    key("ArrowRight", "keyup"); advance(900);
    check("key release stops scheduled repeats", Math.abs(state().rendering.x - 4 / 30) < 1e-9);
  });
  q(".preview-primary-stage").focus(); key("ArrowRight"); key("ArrowUp");
  check("configured rectangular grid determines keyboard steps", Math.abs(state().rendering.x - 2 / 30) < 1e-9
    && Math.abs(state().rendering.y - 2 / 14) < 1e-9);
  check("inspection movement is not serialized", equal(saved(), configured));
  q('[data-color-anchor="up"]').click(); change("preview-color-hex", "#123456");
  change("preview-color-label", "Discard this draft");
  await restore(configured); inspect(configured);
  check("real restore discards unapplied palette dialog", !q("#preview-color-dialog").open);
  q(".preview-primary-stage").focus(); key("ArrowRight");
  check("restored binding accepts same key without stale keyup", Math.abs(state().rendering.x - 2 / 30) < 1e-9);
  await restore(configured);
  q("#preview-input-menu").click(); q('[data-binding-capture-target="left"]').click();
  await restore(configured);
  q(".binding-capture-area").dispatchEvent(new KeyboardEvent("keydown", { code: "KeyJ", key: "j", bubbles: true }));
  check("real restore cancels capture without changing bindings", !q("#binding-capture-dialog").open && equal(saved(), configured));

  for (const renderer of ["flubber", "procedural-face", "grid"]) {
    const next = structuredClone(configured);
    next.presentation.renderer = renderer; next.presentation.colorAnchors = "axes";
    next.presentation.halo = { widthPercent: 187.5, gradient: true, steepness: 3.25 };
    next.response.mode = "continuous"; next.response.holdRule = "separatePresses";
    next.response.fullSpanDurationMs = 4321; next.response.repeatDelayMs = 987;
    next.visual.transparency = 0.073125;
    next.visual.grid.lineThickness = 3.75374; next.visual.grid.cursorSize = 23.27;
    next.visual.flubber.outlineThickness = 2.237;
    next.visual.colors.up = "#a12345"; next.visual.colors.left = "#321abc";
    // New selected renderer is authoritative even if both compatibility flags are off.
    next.visual.gridEnabled = false; next.visual.flubberEnabled = false;
    await restore(next); inspect(next);
    if (renderer === "flubber") {
      q(".preview-primary-stage").focus();
      clocked(advance => {
        key("ArrowRight"); advance(next.response.fullSpanDurationMs / 4);
        check("saved continuous duration drives actual preview input adapter", Math.abs(state().rendering.x - 0.5) < 1e-9);
        key("ArrowLeft"); advance(500);
        check("opposing held directions cancel continuous movement", Math.abs(state().rendering.x - 0.5) < 1e-9);
      });
    }
    const selector = renderer === "procedural-face" ? "[data-preview-face]"
      : renderer === "flubber" ? "[data-preview-flubber]" : "[data-preview-grid]";
    check(`${renderer} selected output is visible`, !q(`.preview-primary-stage ${selector}`).hasAttribute("hidden"));
    check("tile path width uses configured CSS pixels", [...root.querySelectorAll("[data-preview-tile-lines]")]
      .every(path => Number(path.style.strokeWidth) === next.visual.grid.lineThickness && path.getAttribute("vector-effect") === "non-scaling-stroke"));
  }

  const beforeInvalid = canonicalJson(saved()), beforeInspection = canonicalJson(state());
  for (const mutate of [value => { value.response.grid.columns = 4; },
    value => { value.presentation.halo.widthPercent = 10001; },
    value => { delete value.presentation.labels; }, value => { value.presentation.extra = true; }]) {
    const invalid = structuredClone(configured); mutate(invalid); let rejected = false;
    try { await ui.restoreFeedbackContribution(invalid); } catch { rejected = true; }
    check("invalid restore rejects atomically", rejected && canonicalJson(saved()) === beforeInvalid
      && canonicalJson(state()) === beforeInspection);
  }
  const stale = await ui.restoreFeedbackContribution(structuredClone(configured), { isCurrent: () => false });
  check("stale restore preserves configuration and inspection", stale === false
    && canonicalJson(saved()) === beforeInvalid && canonicalJson(state()) === beforeInspection);

  const legacy = { input: configured.input, visual: configured.visual, mappings: configured.mappings };
  await restore(legacy);
  check("legacy restore does not silently invent successor fields", !Object.hasOwn(saved(), "presentation")
    && !Object.hasOwn(saved(), "response") && !Object.hasOwn(saved(), "version"));
  check("legacy unavailable successor controls disabled", q('[data-feedback-preview-mode="face"]').disabled
    && q("#preview-halo-size").disabled && !q("#feedback-upgrade-v2").hidden);
  const converted = await ui.initializeFeedbackAuthoringV2({ isCurrent: () => true });
  check("explicit conversion creates current authoring without changing retained values", converted !== false
    && saved().version === 2 && equal(saved().visual, legacy.visual) && equal(saved().input, legacy.input)
    && equal(saved().mappings, legacy.mappings) && !q('[data-feedback-preview-mode="face"]').disabled);
  await restore(configured);
  const originalRevision = ui.getFeedbackContributionSnapshot().revision;
  change("preview-tile-columns", 3); change("preview-tile-rows", 5);
  check("grid edits update saved dimensions and feedback revision", equal(saved().response.grid, { columns: 3, rows: 5 })
    && ui.getFeedbackContributionSnapshot().revision > originalRevision);
  change("preview-tile-columns", 4);
  check("invalid grid edit is pending instead of saving cached dimensions", ui.getFeedbackContributionSnapshot().pending
    && ui.getFeedbackContributionSnapshot().contribution === null);
  change("preview-tile-columns", 3);
  check("valid grid edit recovers contribution", !ui.getFeedbackContributionSnapshot().pending
    && saved().response.grid.columns === 3);
  q("#preview-response-reset").click();
  check("neutral action saves grey for every anchor and idle", ["up", "right", "down", "left", "idle"]
    .every(direction => saved().visual.colors[direction] === PREVIEW_GREY));
  q("#preview-recolor").click();
  const recolored = structuredClone(saved());
  check("recolor saves valid colors rather than random-generator state", ["up", "right", "down", "left"]
    .every(direction => /^#[0-9a-f]{6}$/u.test(recolored.visual.colors[direction]))
    && Object.keys(recolored).sort().join() === Object.keys(configured).sort().join());
  await restore(recolored); inspect(recolored);
  // End on a nondefault visible current renderer for source-bound screenshots.
  await restore(configured); inspect(configured);
  ui.destroy();
  const closedControls = [...root.querySelectorAll("input")].map(input => [input.id, input.value, input.checked]);
  const afterClose = structuredClone(configured); afterClose.presentation.halo.widthPercent = 50;
  check("closed Planner refuses restore without mutating controls", await ui.restoreFeedbackContribution(afterClose) === false
    && equal(closedControls, [...root.querySelectorAll("input")].map(input => [input.id, input.value, input.checked])));
  return { pass: true, rows, scope: "Actual Planner restore and rendering; synthetic input, no physical or Runner qualification" };
}
