import { SCREEN_LAYOUT_DRAFT_FIELDS } from "./screen-layout-draft.js";

function field(key, unit, min = null) {
  return `<label for="layout-${key}">${SCREEN_LAYOUT_DRAFT_FIELDS[key]} <span data-layout-unit="${key}">${unit}</span>
    <input id="layout-${key}" data-layout-field="${key}" type="number" step="any" ${min === null ? "" : `min="${min}"`} aria-describedby="layout-field-errors"></label>`;
}

export function screenLayoutDraftMarkup() {
  return `<div id="screen-layout-editor" class="screen-layout-draft" data-screen-layout-draft>
    <p class="field-help"><strong>Design draft.</strong> These proposed screen settings are not saved in the experiment package or applied during Run.</p>
    <div class="layout-miniature" data-layout-scene></div>
    <p class="layout-legend">Solid border: design viewport · dashed frame: fixed reference · circle: nominal Flubber · crosses: geometric centres</p>
    <output data-layout-readout class="layout-readout"></output>
    <fieldset><legend>Design viewport</legend><div class="layout-fields">
      ${field("screenWidth", "(CSS px)", 1)}${field("screenHeight", "(CSS px)", 1)}
    </div><p class="field-help">Intended full-screen rendering area, not a detected monitor. Initial values are editable examples.</p></fieldset>
    <details class="layout-calibration"><summary>Physical measurements and mapping</summary>
      <div class="layout-fields">${field("physicalWidth", "(mm)", 1)}${field("physicalHeight", "(mm)", 1)}</div>
      <label class="layout-check"><input id="layout-fullViewportMapping" data-layout-field="fullViewportMapping" type="checkbox" aria-describedby="layout-field-errors"> The design viewport covers the measured active display</label>
      <p class="field-help">Enter measured active width and height. CSS pixels alone do not establish physical size. This draft conversion requires matching display and viewport aspect ratios.</p>
    </details>
    <label for="layout-units">Geometry units<select id="layout-units" data-layout-field="units"><option value="relative">Relative percentages</option><option value="mm">Millimetres</option></select></label>
    <fieldset><legend>Fixed reference frame</legend><div class="layout-fields">
      ${field("referenceWidth", "(% viewport width)", 0.001)}${field("referenceHeight", "(% viewport height)", 0.001)}
      ${field("referenceX", "(% viewport width)")}${field("referenceY", "(% viewport height)")}
    </div></fieldset>
    <fieldset><legend>Flubber size and centre offsets</legend><div class="layout-fields">
      ${field("diameter", "(% shorter reference side)", 0.001)}${field("gap", "(% shorter reference side)", 0)}
      ${field("offsetX", "(% reference width)")}${field("offsetY", "(% reference height)")}
    </div></fieldset>
    <p class="field-help">Proposed conventions: contain each full video without cropping; +X right, +Y down; use a stable Flubber design centre. These Q08 choices await confirmation. Percentage offsets always use the same reference frame.</p>
    <div data-layout-fixture-controls hidden><label for="layout-video">Synthetic display-geometry fixture<select id="layout-video" data-layout-video></select></label></div>
    <output data-layout-status role="status" aria-live="polite" class="layout-status"></output>
    <ul id="layout-field-errors" data-layout-errors class="layout-errors"></ul>
    <p class="field-help" data-layout-dependencies>Video display geometry and maximum animation bounds are unavailable. The circle shows nominal size only; fit is not verified.</p>
    <button type="button" data-layout-reset>Reset layout draft</button>
  </div>`;
}

const rounded = value => Number(value.toFixed(3));
const rectAttributes = r => `x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"`;

export function screenLayoutSceneMarkup(projection, selectedVideoId = null) {
  const g = projection.geometry;
  if (!g) return '<p class="layout-empty">Correct the numeric fields to show the draft geometry.</p>';
  const video = projection.videos.find(item => item.id === selectedVideoId) ?? projection.videos[0];
  const marker = (x, y) => `<path d="M ${x - 12} ${y} h 24 M ${x} ${y - 12} v 24" class="layout-centre"/>`;
  return `<svg viewBox="0 0 ${g.screen.width} ${g.screen.height}" role="img" aria-labelledby="layout-scene-title layout-scene-desc" preserveAspectRatio="xMidYMid meet">
    <title id="layout-scene-title">Whole-screen layout draft</title>
    <desc id="layout-scene-desc">Proposed layout in a ${g.screen.width} by ${g.screen.height} design viewport. Video centre ${rounded(g.reference.cx)}, ${rounded(g.reference.cy)}. Flubber centre ${rounded(g.feedback.cx)}, ${rounded(g.feedback.cy)}. ${video ? "Synthetic video geometry is shown." : "Actual video geometry and maximum animation bounds are not verified."}</desc>
    <rect x="0" y="0" width="${g.screen.width}" height="${g.screen.height}" class="layout-screen"/>
    <rect ${rectAttributes(g.reference)} class="layout-reference"/>
    ${video ? `<rect ${rectAttributes(video.bounds)} class="layout-video"/>` : ""}
    <line x1="${g.reference.cx}" y1="${g.reference.cy}" x2="${g.feedback.cx}" y2="${g.feedback.cy}" class="layout-offset"/>
    ${g.maximumFeedback ? `<rect ${rectAttributes(g.maximumFeedback)} class="layout-maximum"/>` : ""}
    <circle cx="${g.feedback.cx}" cy="${g.feedback.cy}" r="${g.feedback.width / 2}" class="layout-feedback"/>
    ${marker(g.reference.cx, g.reference.cy)}${marker(g.feedback.cx, g.feedback.cy)}
  </svg>`;
}
