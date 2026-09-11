import { createDefaultResearchSettings } from "./contracts.js";
import { INPUT_PRESET_OPTIONS, MAPPING_FIELDS } from "./ui-contracts.js";

const DEFAULT_SETTINGS = createDefaultResearchSettings();
const DEFAULT_COLORS = DEFAULT_SETTINGS.visual.colors;

export const COLOR_FIELDS = Object.freeze([
  Object.freeze({ id: "up", label: "High arousal anchor", axisLabel: "High arousal", value: DEFAULT_COLORS.up }),
  Object.freeze({ id: "down", label: "Low arousal anchor", axisLabel: "Low arousal", value: DEFAULT_COLORS.down }),
  Object.freeze({ id: "left", label: "Negative valence anchor", axisLabel: "Negative valence", value: DEFAULT_COLORS.left }),
  Object.freeze({ id: "right", label: "Positive valence anchor", axisLabel: "Positive valence", value: DEFAULT_COLORS.right }),
  Object.freeze({ id: "idle", label: "Idle color", value: DEFAULT_COLORS.idle }),
  Object.freeze({ id: "outline", label: "Outline color", value: DEFAULT_COLORS.outline }),
  Object.freeze({ id: "halo", label: "Halo color", value: DEFAULT_COLORS.halo }),
  Object.freeze({ id: "cursor", label: "Cursor color", value: DEFAULT_COLORS.cursor }),
]);

export function describeInputToken(token) {
  if (token.kind === "keyboard") return token.code;
  if (token.kind === "wheel") return `Wheel ${token.direction}`;
  if (token.kind === "mouseButton") return `Mouse button ${token.button}`;
  if (token.kind === "gamepadButton") return `Gamepad button ${token.button}`;
  if (token.kind === "pointerAxis") return `Pointer ${token.axis.toUpperCase()}${token.invert ? " reversed" : ""}`;
  if (token.kind === "gamepadAxis") return `Gamepad axis ${token.index}${token.invert ? " reversed" : ""}`;
  return "Unassigned";
}

function escapeAttribute(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function feedbackInputMarkup() {
  const options = `${INPUT_PRESET_OPTIONS.map(({ id, label }) => `<option value="${id}">${label}</option>`).join("")}<option value="custom" hidden>Custom binding</option>`;
  const directions = [
    ["up", "Increase arousal"],
    ["down", "Decrease arousal"],
    ["left", "Decrease valence"],
    ["right", "Increase valence"],
  ].map(([id, label]) => `
    <button class="binding-button" type="button" data-binding-direction="${id}" aria-haspopup="dialog">
      <span>${label}</span><output data-binding-value="${id}">${describeInputToken(DEFAULT_SETTINGS.input.directions[id])}</output>
    </button>`).join("");
  return `
    <section id="feedback-input-settings" class="feedback-input-settings" aria-labelledby="feedback-input-title">
    <h3 id="feedback-input-title">Controls</h3>
    <p class="field-help">Saved device and bindings. Digital input moves once per physical press and ignores operating-system repeat.</p>
    <div class="field-grid">
      <label class="field"><span>Input device</span><select id="input-preset">${options}</select></label>
      <label class="field"><span>Saved input step size</span><input id="input-step-size" type="number" min="0.001" max="1" step="0.001" value="0.1" required><output id="input-step-applicability" class="field-help">Applies to digital edge-triggered presses.</output></label>
    </div>
    <details class="inner-disclosure" open>
      <summary>Custom bindings</summary>
      <div class="disclosure-content">
        <p class="field-help">Select a direction, then perform the keyboard, mouse, wheel, or gamepad action. A captured action cannot be assigned twice.</p>
        <div id="binding-grid" class="binding-grid">${directions}</div>
        <button id="binding-reset" type="button" class="section-actions">Restore selected preset</button>
      </div>
    </details>
    <details class="inner-disclosure" open>
      <summary>Live input test</summary>
      <div class="disclosure-content">
        <div id="input-test" class="input-test" role="group" aria-label="Live input test">
          <div class="input-test-grid" tabindex="0" role="group" aria-label="Input test surface; focus here and use the configured input device" aria-describedby="input-test-status"><span class="input-test-cursor" aria-hidden="true"></span></div>
          <div>
            <p><strong>Input receipt</strong></p>
            <p id="input-test-status" class="status-text" role="status" aria-live="polite">Focus this test and use the selected device.</p>
            <p>Valence <span id="input-test-x">+0.000</span> · Arousal <span id="input-test-y">+0.000</span></p>
            <button id="input-test-reset" type="button">Reset test to neutral</button>
          </div>
        </div>
      </div>
    </details>
    </section>`;
}

function colorRows() {
  return COLOR_FIELDS.map(({ id, label, value }) => `
    <div class="color-row" data-color-row="${id}">
      <label for="color-${id}">${label}</label>
      <input id="color-${id}" type="color" value="${value}" aria-label="${label} color wheel">
      <input id="color-${id}-hex" value="${value}" minlength="7" maxlength="7" pattern="#[0-9A-Fa-f]{6}" required spellcheck="false" aria-label="${label} hexadecimal value">
      <button type="button" data-color-reset="${id}" aria-label="Reset ${escapeAttribute(label)}">Reset</button>
    </div>`).join("");
}

function mappingDisclosure(mapping) {
  const step = mapping.allowedMax > 1 ? 0.1 : 0.01;
  const escapedLabel = escapeAttribute(mapping.label);
  const unitSuffix = mapping.unit ? ` (${escapeAttribute(mapping.unit)})` : "";
  return `
    <details class="inner-disclosure mapping-disclosure" data-mapping="${mapping.id}">
      <summary>${mapping.label}</summary>
      <div class="disclosure-content mapping-grid">
        <label class="field"><span>Min${mapping.unit ? ` (${mapping.unit})` : ""}</span><input id="mapping-${mapping.id}-min" data-mapping-min aria-label="${escapedLabel} minimum${unitSuffix}" type="number" min="${mapping.allowedMin}" max="${mapping.allowedMax}" step="${step}" value="${mapping.min}" required></label>
        <label class="field"><span>Max${mapping.unit ? ` (${mapping.unit})` : ""}</span><input id="mapping-${mapping.id}-max" data-mapping-max aria-label="${escapedLabel} maximum${unitSuffix}" type="number" min="${mapping.allowedMin}" max="${mapping.allowedMax}" step="${step}" value="${mapping.max}" required></label>
        <label class="field"><span>Driven By</span><select id="mapping-${mapping.id}-driver" data-mapping-driver aria-label="${escapedLabel} driven by"><option value="x-axis"${mapping.driver === "x-axis" ? " selected" : ""}>x-axis</option><option value="y-axis"${mapping.driver === "y-axis" ? " selected" : ""}>y-axis</option><option value="angle"${mapping.driver === "angle" ? " selected" : ""}>angle</option><option value="radius"${mapping.driver === "radius" ? " selected" : ""}>radius</option></select></label>
        <label class="check-field"><input id="mapping-${mapping.id}-reverse" data-mapping-reverse aria-label="Reverse ${escapedLabel}" type="checkbox"${mapping.reverse ? " checked" : ""}><span>Reverse</span></label>
        <div class="mapping-output"><span>Live preview <span data-mapping-output>0.000${mapping.unit ? ` ${mapping.unit}` : ""}</span></span><span class="mapping-meter" aria-hidden="true"><span data-mapping-meter></span></span></div>
        <p class="field-help is-wide">Allowed output ${mapping.allowedMin}–${mapping.allowedMax}${mapping.unit ? ` ${mapping.unit}` : ""}.</p>
      </div>
    </details>`;
}

export function feedbackAppearanceMarkup() {
  return `
      <section id="preview-quick-appearance" class="preview-quick-appearance" aria-labelledby="preview-appearance-title">
        <div class="preview-subsection-heading"><h3 id="preview-appearance-title">Appearance</h3></div>
        <p class="field-help">Visibility and transparency are saved. Halo width and fade are preview-only.</p>
        <div class="field-grid">
          <label class="check-field"><input id="visual-grid-visible" type="checkbox" checked><span><strong>Grid</strong><br><span class="field-help">Show the valence–arousal field.</span></span></label>
          <label class="check-field"><input id="visual-flubber-visible" type="checkbox" checked><span><strong>Flubber</strong><br><span class="field-help">Show the procedural affect form.</span></span></label>
          <label class="check-field"><input id="visual-hide-feedback" type="checkbox"><span><strong>Hide Visual Feedback</strong><br><span class="field-help">Acquisition continues while Grid and Flubber are hidden.</span></span></label>
          <label class="field"><span>Transparency</span><div class="range-field"><input id="visual-transparency" type="range" min="0" max="100" step="1" value="${DEFAULT_SETTINGS.visual.transparency * 100}"><output for="visual-transparency">${DEFAULT_SETTINGS.visual.transparency * 100}%</output></div></label>
          <label class="check-field"><input id="flubber-halo-visible" type="checkbox" checked><span><strong>Show Halo</strong><br><span class="field-help">The halo stays centered behind Flubber.</span></span></label>
          <label class="field"><span>Halo width (%)</span><input id="preview-halo-size" data-preview-appearance-input type="number" min="0" step="any" value="150" aria-describedby="preview-halo-help"><output id="preview-halo-help" class="field-help">Preview-only width. Follows the outline and fades to transparent outward.</output></label>
          <label class="check-field"><input id="preview-halo-gradient" type="checkbox" checked><span>Fade halo outward</span></label>
          <label class="field"><span>Gradient steepness</span><input id="preview-halo-steepness" data-preview-appearance-input type="number" min="0.1" max="10" step="0.1" value="1" aria-describedby="preview-halo-steepness-help"><output id="preview-halo-steepness-help" class="field-help">1 = normal; higher values fade faster. Does not change halo width.</output></label>
        </div>
      </section>

`;
}

export function feedbackAdvancedMarkup() {
  return `
      <details id="preview-advanced-settings" class="inner-disclosure preview-advanced-settings">
        <summary>Advanced</summary>
        <div class="disclosure-content">
          <p class="field-help">Saved rendering details and animation mappings. Animation frequency is separate from the acquisition sampling rate.</p>
          <section aria-labelledby="preview-visibility-title">
            <h3 id="preview-visibility-title">Existing package layout</h3>
            <p class="field-help">Normalized layout for current packages. Screen and spatial layouts have their own editor.</p>
            <div class="field-grid">
              <label class="field"><span>Size (% of stage)</span><div class="range-field"><input id="visual-size" type="number" min="5" max="100" step="1" value="${DEFAULT_SETTINGS.visual.sizePercent}" required><output for="visual-size">${DEFAULT_SETTINGS.visual.sizePercent}%</output></div></label>
              <label class="check-field"><input id="visual-lock-position" type="checkbox"><span><strong>Lock position</strong><br><span class="field-help">The sole control for disabling drag. Forced on during Run.</span></span></label>
              <label class="field"><span>Normalized horizontal position</span><input id="visual-position-x" type="number" min="0" max="1" step="0.01" value="${DEFAULT_SETTINGS.visual.overlayPosition.x}" required></label>
              <label class="field"><span>Normalized vertical position</span><input id="visual-position-y" type="number" min="0" max="1" step="0.01" value="${DEFAULT_SETTINGS.visual.overlayPosition.y}" required></label>
            </div>
          </section>
          <details class="inner-disclosure" open>
            <summary>Flubber outline</summary>
            <div class="disclosure-content field-grid">
              <label class="check-field"><input id="flubber-outline-visible" type="checkbox" checked><span>Show Outline</span></label>
              <label class="field"><span>Outline Thickness</span><div class="range-field"><input id="flubber-outline-thickness" type="range" min="0" max="20" step="0.25" value="${DEFAULT_SETTINGS.visual.flubber.outlineThickness}"><output for="flubber-outline-thickness">${DEFAULT_SETTINGS.visual.flubber.outlineThickness.toFixed(2)}</output></div></label>
            </div>
          </details>
          <details class="inner-disclosure">
            <summary>Grid appearance</summary>
            <div class="disclosure-content field-grid">
              <label class="field"><span>Grid Line Thickness</span><div class="range-field"><input id="grid-line-thickness" type="range" min="0.25" max="20" step="0.25" value="${DEFAULT_SETTINGS.visual.grid.lineThickness}"><output for="grid-line-thickness">${DEFAULT_SETTINGS.visual.grid.lineThickness.toFixed(2)}</output></div></label>
              <label class="check-field"><input id="grid-outline-visible" type="checkbox" checked><span>Show Outline</span></label>
              <label class="field"><span>Outline Thickness</span><div class="range-field"><input id="grid-outline-thickness" type="range" min="0" max="20" step="0.25" value="${DEFAULT_SETTINGS.visual.grid.outlineThickness}"><output for="grid-outline-thickness">${DEFAULT_SETTINGS.visual.grid.outlineThickness.toFixed(2)}</output></div></label>
              <label class="field"><span>Cursor Size</span><div class="range-field"><input id="grid-cursor-size" type="range" min="2" max="100" step="1" value="${DEFAULT_SETTINGS.visual.grid.cursorSize}"><output for="grid-cursor-size">${DEFAULT_SETTINGS.visual.grid.cursorSize.toFixed(1)}</output></div></label>
            </div>
          </details>
          <details class="inner-disclosure">
            <summary>Color &amp; Gradient</summary>
            <div class="disclosure-content">
              <p class="field-help">The directional controls around the 2D map select its four anchors. This list also owns idle, outline, halo, and cursor colors.</p>
              <div class="color-list">${colorRows()}</div>
            </div>
          </details>
          <section aria-labelledby="preview-mapping-title">
            <h3 id="preview-mapping-title" class="mapping-title">Flubber–Affect Mapping</h3>
            <p class="field-help">x-axis and y-axis normalize from [−1, 1], radius from [0, 1], and angle from [0°, 360°). Neutral angle is zero. Reverse changes t to 1−t before interpolation.</p>
            ${MAPPING_FIELDS.map(mappingDisclosure).join("")}
          </section>
        </div>
      </details>`;
}
