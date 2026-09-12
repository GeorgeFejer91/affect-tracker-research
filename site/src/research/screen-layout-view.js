import { SCREEN_LAYOUT_DRAFT_FIELDS } from "./screen-layout-draft.js";

function field(key, unit, min = null) {
  return `<label for="layout-${key}"><span>${SCREEN_LAYOUT_DRAFT_FIELDS[key]} <span data-layout-unit="${key}">${unit}</span></span>
    <input id="layout-${key}" data-layout-field="${key}" type="number" step="any" ${min === null ? "" : `min="${min}"`} aria-describedby="layout-field-errors"></label>`;
}

export function screenLayoutDraftMarkup() {
  return `<div id="screen-layout-editor" class="screen-layout-draft" data-screen-layout-draft>
    <p class="field-help">Define one fixed reference for all videos. Confirm this section to include its validated layout in the experiment recipe.</p>
    <div class="layout-miniature" data-layout-scene></div>
    <p class="field-help" data-layout-dependencies>Video display geometry and maximum animation bounds are unavailable. The feedback square shows its drawing viewport; fit is not verified.</p>
    <p class="layout-legend">Border: screen · dashed frame: reference · filled rectangle: video · dotted frame: maximum animation · solid square: feedback viewport · crosses: centres</p>
    <output data-layout-readout class="layout-readout"></output>
    <fieldset><legend>Design viewport</legend><div class="layout-fields">
      ${field("screenWidth", "(CSS px)", 1)}${field("screenHeight", "(CSS px)", 1)}
    </div><p class="field-help">Full-screen rendering area. Initial values are editable examples.</p></fieldset>
    <details class="layout-calibration"><summary>Physical measurements and mapping</summary>
      <div class="layout-fields">${field("physicalWidth", "(mm)", 1)}${field("physicalHeight", "(mm)", 1)}</div>
      <label class="layout-check"><input id="layout-fullViewportMapping" data-layout-field="fullViewportMapping" type="checkbox" aria-describedby="layout-field-errors"> The design viewport covers the measured active display</label>
      <p class="field-help">Enter measured active width and height. CSS pixels alone do not establish physical size. Conversion requires matching display and viewport aspect ratios.</p>
    </details>
    <label for="layout-units" class="layout-units">Geometry units<select id="layout-units" data-layout-field="units"><option value="relative">Relative percentages</option><option value="mm">Millimetres</option></select></label>
    <label for="layout-referencePolicy" class="layout-units">Reference method<select id="layout-referencePolicy" data-layout-field="referencePolicy" aria-describedby="layout-reference-help layout-field-errors"><option value="">Choose a reference method</option><option value="largest-oriented-area">Largest oriented video by pixel area</option><option value="maximum-oriented-dimensions">Combined maximum-width/height envelope</option></select></label>
    <p id="layout-reference-help" class="field-help">Pixel area selects an actual video by oriented width × height. The combined envelope uses the largest width and height across the library; it may not match any single video.</p>
    <fieldset><legend>Fixed reference frame</legend><div class="layout-fields">
      ${field("referenceWidth", "(% viewport width)", 0.001)}${field("referenceHeight", "(% viewport height)", 0.001)}
      ${field("referenceX", "(% viewport width)")}${field("referenceY", "(% viewport height)")}
    </div></fieldset>
    <fieldset><legend>Feedback size and centre offsets</legend><div class="layout-fields">
      ${field("diameter", "(% shorter reference side)", 0.001)}${field("gap", "(% shorter reference side)", 0)}
      ${field("offsetX", "(% reference width)")}${field("offsetY", "(% reference height)")}
    </div><p class="field-help">Size sets the square drawing viewport. The dotted frame includes the full saved animation and halo bounds.</p></fieldset>
    <details class="layout-conventions"><summary>Layout conventions</summary><p class="field-help">Contain the selected reference within the maximum width and height, then contain each full video without cropping. +X points right, +Y down. Feedback uses a fixed design centre. Percentage offsets always use the same fitted reference frame.</p></details>
    <div data-layout-fixture-controls hidden><label for="layout-video"><span data-layout-video-label>Inspect video fit</span><select id="layout-video" data-layout-video></select></label></div>
    <output data-layout-status role="status" aria-live="polite" class="layout-status"></output>
    <ul id="layout-field-errors" data-layout-errors class="layout-errors"></ul>
    <button type="button" data-layout-reset>Reset layout</button>
  </div>`;
}

const rounded = value => Number(value.toFixed(3));
const rectAttributes = r => `x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"`;

export function screenLayoutSceneMarkup(projection, selectedVideoId = null) {
  const g = projection.geometry;
  if (!g) return projection.issues.some(i => i.code === "reference-policy-required")
    ? '<p class="layout-empty">Choose a reference method to show the layout.</p>'
    : '<p class="layout-empty">Complete the layout fields and video library to show geometry.</p>';
  const video = projection.videos.find(item => item.id === selectedVideoId) ?? projection.videos[0];
  const marker = (x, y) => `<path d="M ${x - 12} ${y} h 24 M ${x} ${y - 12} v 24" class="layout-centre"/>`;
  return `<svg viewBox="0 0 ${g.screen.width} ${g.screen.height}" role="img" aria-labelledby="layout-scene-title layout-scene-desc" preserveAspectRatio="xMidYMid meet">
    <title id="layout-scene-title">Whole-screen layout</title>
    <desc id="layout-scene-desc">Layout in a ${g.screen.width} by ${g.screen.height} design viewport. Video centre ${rounded(g.reference.cx)}, ${rounded(g.reference.cy)}. Feedback centre ${rounded(g.feedback.cx)}, ${rounded(g.feedback.cy)}. ${video ? projection.inputKind === "live" ? "Verified video display geometry is shown in the fixed reference." : "Synthetic video geometry is shown." : "Actual video geometry and maximum animation bounds are not verified."}</desc>
    <rect x="0" y="0" width="${g.screen.width}" height="${g.screen.height}" class="layout-screen"/>
    ${video ? `<rect ${rectAttributes(video.bounds)} class="layout-video"/>` : ""}
    <rect ${rectAttributes(g.reference)} class="layout-reference"/>
    <line x1="${g.reference.cx}" y1="${g.reference.cy}" x2="${g.feedback.cx}" y2="${g.feedback.cy}" class="layout-offset"/>
    ${g.maximumFeedback ? `<rect ${rectAttributes(g.maximumFeedback)} class="layout-maximum"/>` : ""}
    <rect ${rectAttributes(g.feedback)} class="layout-feedback"/>
    ${marker(g.reference.cx, g.reference.cy)}${marker(g.feedback.cx, g.feedback.cy)}
  </svg>`;
}
