import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { createResearchPreview, normalizePreviewState } from "../site/src/research/preview.js";
import { COLOR_FIELDS, renderResearchUiMarkup } from "../site/src/research/ui-view.js";

const markup = renderResearchUiMarkup("browser");
const appSource = readFileSync(new URL("../site/src/research/app.js", import.meta.url), "utf8");
const previewSource = readFileSync(new URL("../site/src/research/preview.js", import.meta.url), "utf8");
const nativeBridgeSource = readFileSync(new URL("../site/src/research/native-bridge.js", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../site/research.css", import.meta.url), "utf8");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${escapeRegExp(name)}="([^"]*)"`, "u"))?.[1] ?? null;
}

function inputTag(source, id) {
  const match = source.match(new RegExp(`<input\\b[^>]*\\bid="${escapeRegExp(id)}"[^>]*>`, "u"));
  assert.ok(match, `missing input #${id}`);
  return match[0];
}

function assertAttributes(tag, expected) {
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(attribute(tag, name), value, `${name} on ${tag}`);
  }
}

function countId(source, id) {
  return count(source, new RegExp(`\\bid="${escapeRegExp(id)}"`, "gu"));
}

function idsIn(source) {
  return [...source.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]);
}

const setupMarkup = between(
  markup,
  '<section class="setup-mode"',
  '<section class="run-mode"',
);
const runMarkup = between(markup, '<section class="run-mode"', "</main>");
const studioMarkup = between(
  setupMarkup,
  '<div class="research-preview-stage research-preview-studio"',
  '<div class="preview-coordinates preview-coordinate-receipt"',
);

test("Setup offers exactly three ordered feedback modes with one selected", () => {
  const buttons = [...setupMarkup.matchAll(
    /<button\b[^>]*\bdata-feedback-preview-mode="([^"]+)"[^>]*>[\s\S]*?<\/button>/gu,
  )].map((match) => ({
    mode: match[1],
    pressed: attribute(match[0], "aria-pressed"),
    label: match[0].replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim(),
  }));

  assert.deepEqual(buttons, [
    { mode: "flubber", pressed: "true", label: "Flubber" },
    { mode: "grid", pressed: "false", label: "2D Grid" },
    { mode: "face", pressed: "false", label: "Face" },
  ]);
  assert.equal(buttons.filter(({ pressed }) => pressed === "true").length, 1);
  assert.equal(count(runMarkup, /\bdata-feedback-preview-mode=/gu), 0);
});

test("the Setup studio nests its output stage before the affect map", () => {
  const primaryIndex = studioMarkup.indexOf('<div class="preview-primary-stage"');
  const affectMapIndex = studioMarkup.indexOf('<section class="preview-affect-map"');
  assert.ok(primaryIndex > 0);
  assert.ok(affectMapIndex > primaryIndex);
  assert.match(
    studioMarkup,
    /data-preview-variant="studio"[\s\S]*?<div class="preview-primary-stage"[^>]*>[\s\S]*?<section class="preview-affect-map"/u,
  );

  const primaryMarkup = studioMarkup.slice(primaryIndex, affectMapIndex);
  const gridCanvasIndex = primaryMarkup.indexOf("data-preview-grid-canvas");
  const gridSvgIndex = primaryMarkup.indexOf("<svg data-preview-grid ");
  const flubberIndex = primaryMarkup.indexOf("<svg data-preview-flubber ");
  assert.ok(gridCanvasIndex >= 0 && gridSvgIndex > gridCanvasIndex);
  assert.ok(flubberIndex > gridSvgIndex, "Flubber follows the grid in the absolute SVG stack");
});

test("the procedural Face is confined to the Setup studio and wired to affect coordinates", () => {
  const faceRoot = /<svg\s+data-preview-face(?=\s)/gu;
  assert.equal(count(setupMarkup, faceRoot), 1);
  assert.equal(count(runMarkup, faceRoot), 0);
  assert.match(previewSource, /import \{ createResponsiveFaceGeometry \} from "\.\/responsive-face\.js";/u);
  assert.match(
    previewSource,
    /createResponsiveFaceGeometry\(\{\s*valence:\s*state\.x,\s*arousal:\s*state\.y\s*\}\)/u,
  );
  assert.match(previewSource, /faceMouthShape\.setAttribute\("d", geometry\.mouth\.shape\.d\)/u);
  assert.match(
    previewSource,
    /function setElementHidden\([\s\S]*?element\.toggleAttribute\("hidden", hidden\)/u,
    "SVG feedback modes must reflect visibility through the hidden attribute rather than an SVG expando",
  );
});

test("the affect map has four exact directional anchors and one complete color dialog", () => {
  const anchors = [...studioMarkup.matchAll(
    /<button\b[^>]*\bdata-color-anchor="([^"]+)"[^>]*>[\s\S]*?<\/button>/gu,
  )];
  assert.deepEqual(anchors.map((match) => match[1]), ["up", "left", "right", "down"]);
  for (const anchor of anchors) {
    assert.equal(attribute(anchor[0], "aria-haspopup"), "dialog");
    assert.equal(attribute(anchor[0], "aria-controls"), "preview-color-dialog");
  }

  assert.equal(count(markup, /<dialog\s+id="preview-color-dialog"/gu), 1);
  const dialog = between(markup, '<dialog id="preview-color-dialog"', '<dialog id="stop-early-dialog"');
  assert.doesNotMatch(dialog, /type="color"/u);
  assert.match(dialog, /<canvas data-inline-color-map[^>]*tabindex="0"/u);
  assertAttributes(inputTag(dialog, "preview-color-hue"), { type: "range", min: "0", max: "360", step: "1" });
  assert.match(appSource, /inlineColorPicker\.setColor\(previewColorDraft\)/u);
  assert.match(appSource, /inlineColorPicker\.destroy\(\)/u);
  assertAttributes(inputTag(dialog, "preview-color-hex"), {
    minlength: "7",
    maxlength: "7",
    pattern: "#[0-9A-Fa-f]{6}",
    "aria-describedby": "preview-color-status",
  });
  assert.equal(attribute(dialog.match(/<dialog\b[^>]*>/u)?.[0] ?? "", "aria-describedby"), "preview-color-status");
  assertAttributes(inputTag(dialog, "preview-color-label"), {
    maxlength: "48",
    placeholder: "High arousal",
    autocomplete: "off",
  });
  assert.match(dialog, /Applied display labels are saved/u);
  assert.match(appSource, /function schedulePreviewColorPaint\(\)[\s\S]*requestAnimationFrame/u);
  assert.match(appSource, /setupPreview\.update\(\{ colors, colorAnchorMode: previewColorMode\(\) \}\)/u);
  assert.match(appSource, /hex\.setAttribute\("aria-invalid", "true"\)/u);
  assert.match(appSource, /hex\.setAttribute\("aria-errormessage", "preview-color-error"\)/u);
  assert.match(appSource, /setErrorReference\(hex, "preview-color-error", valid \? false : true\)|setErrorReference\(hex, "preview-color-error", true\)/u);
  for (const id of ["preview-color-reset", "preview-color-cancel", "preview-color-apply"]) {
    assert.equal(countId(dialog, id), 1);
  }

  const simulatorSurface = studioMarkup.match(/<div\b[^>]*\bclass="preview-control-surface"[^>]*>/u)?.[0];
  assert.ok(simulatorSurface);
  assertAttributes(simulatorSurface, {
    tabindex: "0",
    role: "group",
    "aria-describedby": "preview-response-simulator-help",
    "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown",
  });
  assert.equal(countId(studioMarkup, "preview-response-reset"), 1);
});

test("continuous and stepwise response controls retain their exact timing contracts", () => {
  const modes = [...studioMarkup.matchAll(
    /<button\b[^>]*\bdata-response-preview-mode="([^"]+)"[^>]*>[\s\S]*?<\/button>/gu,
  )].map((match) => ({ mode: match[1], pressed: attribute(match[0], "aria-pressed") }));
  assert.deepEqual(modes, [
    { mode: "continuous", pressed: "false" },
    { mode: "stepwise", pressed: "true" },
  ]);

  assertAttributes(inputTag(studioMarkup, "preview-full-span-duration"), {
    type: "range",
    min: "250",
    max: "15000",
    step: "250",
    value: "2000",
  });
  assertAttributes(inputTag(studioMarkup, "preview-repeat-delay"), {
    type: "range",
    min: "500",
    max: "5000",
    step: "100",
    value: "500",
  });

  const holdRules = [...studioMarkup.matchAll(/<input\b[^>]*\bname="previewHoldRule"[^>]*>/gu)];
  assert.deepEqual(holdRules.map((match) => ({
    value: attribute(match[0], "value"),
    checked: /\schecked(?:\s|>)/u.test(match[0]),
  })), [
    { value: "separatePresses", checked: true },
    { value: "repeatWhileHeld", checked: false },
  ]);
});

test("Stepwise owns grid dimensions and retains the legacy step field for compatibility", () => {
  assert.equal(countId(markup, "input-step-size"), 1);
  const stepwisePanel = between(
    studioMarkup,
    '<div data-response-preview-panel="stepwise">',
    '<details id="preview-advanced-settings"',
  );
  assertAttributes(inputTag(stepwisePanel, "preview-tile-count"), {
    type: "number", min: "1", max: "1000", step: "1", value: "10",
  });
  for (const id of ["preview-tile-columns", "preview-tile-rows"]) {
    assertAttributes(inputTag(stepwisePanel, id), { type: "number", min: "3", max: "2001", step: "2", value: "21" });
  }
  assert.match(stepwisePanel, /name="previewGridSizing" value="custom"/u);
  assert.equal(countId(stepwisePanel, "input-step-size"), 0);
  const validation = between(appSource, "function syncControlValidation(", "function syncOutputFormatValidation(");
  assert.match(validation, /control\?\.hasAttribute\("data-preview-grid-input"\).*data-preview-appearance-input.*return true;/u);
  assert.match(appSource, /\[aria-invalid="true"\]:not\(\[data-preview-grid-input\]\)/u);
  assertAttributes(inputTag(studioMarkup.slice(studioMarkup.indexOf('<section id="feedback-input-settings"')), "input-step-size"), {
    type: "number",
    min: "0.001",
    max: "1",
    step: "0.001",
    value: "0.1",
  });
});

test("halo and transparency controls expose their bounded appearance contract", () => {
  const haloVisible = inputTag(studioMarkup, "flubber-halo-visible");
  assert.match(haloVisible, /\schecked(?:\s|>)/u);
  assert.match(studioMarkup, /The halo stays centered behind Flubber\./u);
  assertAttributes(inputTag(studioMarkup, "preview-halo-size"), {
    type: "number",
    min: "0",
    step: "any",
    value: "150",
  });
  assert.equal(attribute(inputTag(studioMarkup, "preview-halo-size"), "max"), "10000");
  assertAttributes(inputTag(studioMarkup, "preview-halo-gradient"), { type: "checkbox" });
  assertAttributes(inputTag(studioMarkup, "preview-halo-steepness"), { type: "number", min: "0.1", max: "10", value: "1" });
  assertAttributes(inputTag(studioMarkup, "visual-transparency"), {
    type: "range",
    min: "0",
    max: "100",
    step: "1",
  });
});

test("both tiled previews carry visible, hollow SVG paint without relying on CSS", () => {
  const lines = [...studioMarkup.matchAll(/<path\b[^>]*data-preview-tile-lines[^>]*>/gu)];
  assert.equal(lines.length, 2);
  for (const [tag] of lines) assertAttributes(tag, { fill: "none", stroke: "#f4f2ea" });
  const edges = [...studioMarkup.matchAll(/<rect\b[^>]*data-preview-tile-edge="(contrast|highlight)"[^>]*>/gu)];
  assert.equal(edges.length, 4);
  for (const [tag, edge] of edges) assertAttributes(tag, {
    fill: "none", stroke: edge === "contrast" ? "#111310" : "#ffffff",
    "stroke-width": edge === "contrast" ? "2" : "1",
  });
  assert.doesNotMatch(runMarkup, /data-preview-tile-edge/u);
});

test("only the Setup halo fades behind the exact fill and outline", () => {
  assert.equal(count(markup, /id="preview-studio-halo-fade"/gu), 1);
  assert.match(studioMarkup, /<feGaussianBlur data-preview-halo-blur/u);
  assert.match(studioMarkup, /Halo width/u);
  assert.match(studioMarkup, /Fade halo outward/u);
  const halo = studioMarkup.indexOf('<path data-preview-flubber-halo');
  assert.ok(halo < studioMarkup.indexOf('<path data-preview-flubber-base'));
  assert.ok(halo < studioMarkup.indexOf('<path data-preview-flubber-outline'));
  assert.match(studioMarkup, /filter="url\(#preview-studio-halo-fade\)"/u);
  assert.equal(count(markup, /filter="url\(#preview-studio-halo-fade\)"/gu), 1);
});

test("animated studio halo stays on the boundary at every width; legacy rendering is unchanged", () => {
  class Element {
    attributes = new Map();
    style = { setProperty() {} };
    dataset = {};
    children = new Map();
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    toggleAttribute(name, on) { if (on) this.attributes.set(name, ""); else this.attributes.delete(name); }
    querySelector(selector) { return this.children.get(selector) ?? null; }
    querySelectorAll(selector) { return this.children.get(selector) ?? []; }
    addEventListener() {}
    removeEventListener() {}
    matches() { return true; }
  }
  class Html extends Element {}
  class Svg extends Element {}
  class Path extends Svg {}
  class Canvas extends Html { getContext() { return null; } }
  let frame;
  let reducedMotion = false;
  const globals = {
    HTMLElement: Html, SVGElement: Svg, SVGPathElement: Path, HTMLCanvasElement: Canvas,
    requestAnimationFrame: (callback) => { frame = callback; return 1; },
    cancelAnimationFrame() {}, matchMedia: () => ({ matches: reducedMotion }),
  };
  const originals = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true });
    for (const studio of [true, false]) {
      const root = new Html();
      if (studio) root.setAttribute("data-preview-variant", "studio");
      for (const [name, Type] of Object.entries({
        overlay: Html, "grid-canvas": Canvas, grid: Svg, "grid-cursor": Svg,
        flubber: Svg, "flubber-base": Path, "flubber-outline": Path, "flubber-halo": Path,
        "halo-blur": Svg, "halo-falloff": Svg,
      })) root.children.set(`[data-preview-${name}]`, new Type());
      const tilePath = new Path();
      const tile = new Svg();
      const rectangles = [new Svg(), new Svg()];
      rectangles[0].setAttribute("data-preview-tile-edge", "contrast");
      rectangles[1].setAttribute("data-preview-tile-edge", "highlight");
      tile.children.set("rect", rectangles);
      root.children.set("[data-preview-tile-lines]", [tilePath]);
      root.children.set("[data-preview-active-tile]", [tile]);
      const controlCursor = new Svg();
      root.children.set("[data-preview-control-grid]", new Svg());
      root.children.set("[data-preview-control-cursor]", controlCursor);
      const preview = createResearchPreview(root);
      const halo = root.querySelector("[data-preview-flubber-halo]");
      const outline = root.querySelector("[data-preview-flubber-outline]");
      const base = root.querySelector("[data-preview-flubber-base]");
      for (const haloSizePercent of [100, 150, 240]) {
        for (const outlineThickness of [0, 2, 20]) {
          for (const [x, y] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
            for (reducedMotion of [false, true]) {
              preview.update({ x, y, sizePercent: haloSizePercent === 100 ? 5 : 100, flubber: { haloSizePercent, outlineThickness } });
              frame(performance.now() + 100);
              assert.equal(halo.getAttribute("d"), outline.getAttribute("d"));
              assert.equal(halo.getAttribute("d"), base.getAttribute("d"));
              assert.ok(halo.getAttribute("d").length > 100);
              assert.equal(halo.getAttribute("transform"), `scale(${studio ? 1 : haloSizePercent / 100})`);
              assert.equal(Number(halo.style.strokeWidth), Math.max(1, outlineThickness * 3) * (studio ? haloSizePercent / 100 : 1));
              assert.equal(root.querySelector("[data-preview-halo-blur]").getAttribute("stdDeviation"), studio ? String(0.03 * haloSizePercent / 100) : null);
            }
          }
        }
      }
      preview.update({ flubber: { showHalo: false } });
      assert.equal(halo.getAttribute("hidden"), "");
      preview.update({ flubber: { showHalo: true } });
      assert.equal(halo.getAttribute("hidden"), null);
      if (studio) {
        for (const haloGradient of [false, true]) {
          for (const haloSteepness of [0.1, 1, 10]) {
            preview.update({ flubber: { haloSizePercent: 350, haloGradient, haloSteepness, outlineThickness: 2 } });
            assert.equal(halo.getAttribute("filter"), haloGradient ? "url(#preview-studio-halo-fade)" : "none");
            assert.equal(root.querySelector("[data-preview-halo-falloff]").getAttribute("exponent"), String(haloSteepness));
            assert.equal(Number(halo.style.strokeWidth), 21);
            assert.equal(halo.getAttribute("transform"), "scale(1)");
          }
        }
        preview.update({ flubber: { haloSizePercent: 0 } });
        assert.equal(halo.getAttribute("hidden"), "");
        for (const [tileCount, tileRows] of [[3, 3], [5, 5], [21, 21], [2001, 2001], [3, 5], [5, 3], [3, 2001], [2001, 3]]) {
          for (const sizePercent of [5, 100]) {
            preview.update({ x: 0, y: 0, tileCount, tileRows, sizePercent, responseMode: "stepwise" });
            assert.equal(controlCursor.getAttribute("hidden"), "");
            assert.equal(root.querySelector("[data-preview-grid-cursor]").getAttribute("hidden"), "");
            assert.equal(tile.getAttribute("hidden"), null);
            assert.equal((tilePath.getAttribute("d").match(/M/g) ?? []).length, tileCount + tileRows - 2);
            assert.ok(Math.abs(Number(rectangles[0].getAttribute("x")) + Number(rectangles[0].getAttribute("width")) / 2 - 50) < 1e-10);
            assert.equal(rectangles[0].getAttribute("x"), rectangles[1].getAttribute("x"));
            assert.equal(Number(rectangles[0].getAttribute("stroke-width")), Number(rectangles[1].getAttribute("stroke-width")) * 2);
            assert.ok(Math.abs(Number(rectangles[0].getAttribute("y")) + Number(rectangles[0].getAttribute("height")) / 2 - 50) < 1e-10);
            assert.ok(Number(rectangles[0].getAttribute("height")) > 0);
            assert.ok(Number(rectangles[0].getAttribute("width")) > 0);
            assert.equal(Number(tilePath.getAttribute("stroke-width")), Math.min(0.4, 8 / Math.max(tileCount, tileRows)));
          }
        }
        preview.update({ responseMode: "continuous" });
        assert.equal(tile.getAttribute("hidden"), "");
        assert.equal(tilePath.getAttribute("hidden"), "");
        assert.equal(controlCursor.getAttribute("hidden"), null);
      }
      preview.destroy();
    }
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("advanced preview settings retain every detailed visual control and six unique mappings", () => {
  const advancedStart = studioMarkup.indexOf('<details id="preview-advanced-settings"');
  assert.ok(advancedStart >= 0);
  const advanced = studioMarkup.slice(advancedStart);
  const advancedVisualIds = [
    "visual-lock-position",
    "visual-position-x",
    "visual-position-y",
    "flubber-outline-visible",
    "flubber-outline-thickness",
    "grid-line-thickness",
    "grid-outline-visible",
    "grid-outline-thickness",
    "grid-cursor-size",
    ...COLOR_FIELDS.flatMap(({ id }) => [`color-${id}`, `color-${id}-hex`]),
  ];
  for (const id of advancedVisualIds) assert.equal(countId(advanced, id), 1, id);

  for (const id of ["visual-size", "visual-transparency", "flubber-halo-visible", "visual-grid-visible", "visual-flubber-visible", "visual-hide-feedback"]) {
    assert.equal(countId(studioMarkup, id), 1, id);
  }

  const mappings = [...advanced.matchAll(/\bdata-mapping="([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(mappings, [
    "oscillation-frequency",
    "edge-smoothness",
    "projection-amplitude",
    "pulse-synchrony",
    "wave-size-variation",
    "saturation",
  ]);
  assert.equal(new Set(mappings).size, 6);
  const advancedIds = idsIn(advanced);
  assert.equal(new Set(advancedIds).size, advancedIds.length);
});

test("the application projects successor settings to Setup and invalidates saved contributions on edits", () => {
  const previewStateSource = between(appSource, "function previewState(", "function refreshRangeOutputs(");
  assert.match(
    previewStateSource,
    /\.\.\.\(design \? \{\s*displayMode:\s*feedbackSettingsVersion === 2 \? feedbackPreviewMode : "legacy",\s*responseMode:\s*responsePreviewMode,\s*tileCount:[^\n]+\s*tileRows:[^\n]+\s*colorAnchorMode: previewColorMode\(\),\s*\} : \{\}\)/u,
  );
  assert.match(
    previewStateSource,
    /\.\.\.\(design \? \{ haloSizePercent: previewHaloDraft\.width,\s*haloGradient: checked\("preview-halo-gradient"\), haloSteepness: previewHaloDraft\.steepness \} : \{\}\)/u,
  );
  assert.match(previewStateSource, /const point = design \? previewDesignPoint : inputPoint/u);
  assert.doesNotMatch(
    previewStateSource,
    /displayMode:\s*design \?|responseMode:\s*design \?|haloSizePercent:\s*design \?/u,
    "successor keys cannot be silently projected into the historical Run boundary",
  );

  const designProjectionSource = between(appSource, "function projectDesignPreview(", "function refreshDesignPreview(");
  assert.match(
    designProjectionSource,
    /const projected = previewState\(\{ design: true \}\);[\s\S]*setupPreview\.update\(projected\);/u,
  );
  const projectionSource = between(appSource, "function refreshProjection(", "function renderExperimentConditionalFields(");
  assert.match(projectionSource, /refreshDesignPreview\(\);[\s\S]*runPreview\.update\(previewState\(\{ locked: true \}\)\);/u);
  assert.match(projectionSource, /designAlreadyProjected/gu);
  assert.match(appSource, /refreshProjection\(\{ designAlreadyProjected: simulatorOwnsDesignProjection \}\)/u);

  const previewOnlySource = between(appSource, "function isFeedbackBehaviorControl(", "function driverValue(");
  for (const id of ["preview-halo-size", "preview-tile-count", "preview-tile-columns", "preview-tile-rows", "preview-full-span-duration", "preview-repeat-delay"]) {
    assert.match(previewOnlySource, new RegExp(`"${id}"`, "u"));
  }
  assert.match(previewOnlySource, /target\.name === "previewHoldRule"/u);
  assert.match(previewOnlySource, /target\.name === "previewGridSizing"/u);
  assert.doesNotMatch(previewOnlySource, /schedulePlanRefresh/u);
  assert.equal(count(
    appSource,
    /if \(isFeedbackBehaviorControl\(target\)\) \{\s*refreshProjection\(\);\s*schedulePlanRefresh\(\);\s*return;\s*\}/gu,
  ), 2);
  assert.match(appSource, /createPreviewResponseSimulator\(\{[\s\S]*?previewDesignPoint = \{ x: point\.x, y: point\.y \};[\s\S]*?projectDesignPreview\(\)/u);
  assert.match(
    appSource,
    /previewResponseSimulator\?\.configure\(\{[\s\S]*?mode: responsePreviewMode,[\s\S]*?fullSpanDurationMs:[\s\S]*?\.\.\.\(dimensions \?\? \{\}\),[\s\S]*?holdRule:[\s\S]*?repeatDelayMs:/u,
  );
  assert.match(appSource, /createPreviewInteraction\(\{[\s\S]*?simulator: previewResponseSimulator, getBinding: \(\) => inputBinding,[\s\S]*?isEnabled: \(\) => mode === "setup"/u);
  assert.match(appSource, /previewInteraction\?\.destroy\(\)/u);
  assert.match(appSource, /previewResponseSimulator\?\.reset\(\)/u);
  assert.match(appSource, /previewResponseSimulator\?\.destroy\(\)/u);
});

test("desktop media probes stay bounded to the primary renderer instead of the scrolling editor", () => {
  assert.equal(count(nativeBridgeSource, /"\.preview-pane \.preview-primary-stage"/gu), 2);
  assert.doesNotMatch(nativeBridgeSource, /"\.preview-pane \.research-preview-stage"/u);
});

test("native Setup input testing is confined to the explicitly focused test surface", () => {
  assert.match(
    nativeBridgeSource,
    /this\.#listen\(this\.root, "focusin",[\s\S]*?target\?\.closest\("\.input-test-grid"\)[\s\S]*?#beginNativeInputTest\(\)[\s\S]*?research_input_cancel_setup/u,
  );
  assert.match(
    nativeBridgeSource,
    /const activeElement = this\.root\.ownerDocument\?\.activeElement;[\s\S]*?activeElement !== grid[\s\S]*?research_input_cancel_setup/u,
  );
  assert.match(nativeBridgeSource, /target\?\.closest\("#binding-capture-dialog"\)/u);
});

test("primary-stage positioning remains pointer-owned without a renderer-local keydown handler", () => {
  assert.doesNotMatch(previewSource, /\bkeydown\b/iu);
  assert.doesNotMatch(previewSource, /addEventListener\(\s*["']key/iu);
  assert.match(previewSource, /overlay\.addEventListener\("pointerdown", onPointerDown\)/u);
});

test("preview CSS has responsive and forced-color coverage without gradients or shadows", () => {
  const compactDesktop = between(cssSource, "@media (max-width: 1050px)", "@media (max-width: 759px)");
  assert.match(compactDesktop, /\.preview-header\s*\{/u);
  assert.match(compactDesktop, /\.preview-feedback-modes\s*\{/u);
  assert.match(compactDesktop, /\.preview-affect-map-layout\s*\{/u);
  const compactPane = between(cssSource, "@container preview-pane (max-width: 36rem)", "@container preview-pane (max-width: 24rem)");
  assert.match(compactPane, /\.preview-advanced-settings \.mapping-grid/u);

  const compactPhone = between(cssSource, "@media (max-width: 479px)", "@media (prefers-reduced-motion: reduce)");
  assert.match(compactPhone, /\.preview-affect-map-layout\s*\{/u);
  assert.match(compactPhone, /\.preview-color-anchor\s*\{/u);

  const forcedColors = cssSource.slice(cssSource.indexOf("@media (forced-colors: active)"));
  assert.match(forcedColors, /\.preview-control-surface canvas/u);
  assert.match(forcedColors, /\.preview-color-swatch/u);
  assert.match(forcedColors, /forced-color-adjust:\s*none/u);

  assert.doesNotMatch(cssSource, /(?:linear|radial|conic|repeating-linear|repeating-radial)-gradient\s*\(/iu);
  // Only the separately owned, user-requested confirmation edge may glow.
  const withoutConfirmationGlow = cssSource.replace(/[^{}]*\.setup-section-confirm-button\[data-review-state="pending"\]::after\s*\{[^{}]*\}/gu, "");
  assert.doesNotMatch(withoutConfirmationGlow, /(?:box-shadow|text-shadow)\s*:|drop-shadow\s*\(/iu);
});

test("preview normalization accepts modes and bounds halo size and transparency", () => {
  for (const displayMode of ["legacy", "flubber", "grid", "face"]) {
    assert.equal(normalizePreviewState({ displayMode }).displayMode, displayMode);
  }
  for (const responseMode of ["continuous", "stepwise"]) {
    assert.equal(normalizePreviewState({ responseMode }).responseMode, responseMode);
  }

  assert.equal(normalizePreviewState({ flubber: { haloSizePercent: -1 } }).flubber.haloSizePercent, 0);
  assert.equal(normalizePreviewState({ flubber: { haloSizePercent: 999 } }).flubber.haloSizePercent, 999);
  assert.equal(normalizePreviewState({ flubber: { haloSizePercent: 1e300 } }).flubber.haloSizePercent, 10000);
  assert.equal(normalizePreviewState({ flubber: { haloSizePercent: "175" } }).flubber.haloSizePercent, 175);
  assert.equal(normalizePreviewState({ transparencyPercent: -1 }).transparencyPercent, 0);
  assert.equal(normalizePreviewState({ transparencyPercent: 999 }).transparencyPercent, 100);

  const fallbacks = normalizePreviewState({
    displayMode: "unknown",
    responseMode: "unknown",
    flubber: { haloSizePercent: Number.NaN },
  });
  assert.equal(fallbacks.displayMode, "legacy");
  assert.equal(fallbacks.responseMode, "stepwise");
  assert.equal(fallbacks.flubber.haloSizePercent, 100);
});
