import { resolveXrLayoutProfileV1 } from "./xr-layout.js";

const numericField = (id, label, value, min, max, step) => `
  <label class="field"><span>${label}</span><input data-xr-field="${id}" type="number"
    value="${value}" min="${min}" max="${max}" step="${step}" required></label>`;

export function xrLayoutEditorMarkup() {
  return `<div class="xr-layout-editor" data-xr-layout-editor>
    <h3>VR screen layout</h3>
    <label class="check-field"><input type="checkbox" data-xr-enabled><span>Design a screen for WebXR</span></label>
    <p class="field-help">A flat video screen fixed in virtual space. This authoring profile requires a future WebXR Runner.</p>
    <div data-xr-content hidden>
      <fieldset class="xr-profile-fields"><legend>Screen position</legend>
        <div class="field-grid">
          ${numericField("video.distanceMetres", "Distance from setup viewer (m)", 2, 0.1, 100, "any")}
          ${numericField("video.azimuthDegrees", "Centre azimuth (° right)", 0, -80, 80, "any")}
          ${numericField("video.elevationDegrees", "Centre elevation (° up)", 0, -80, 80, "any")}
        </div>
      </fieldset>
      <fieldset class="xr-profile-fields"><legend>Screen size</legend>
        <div class="field-grid">
          ${numericField("video.widthMetres", "Width (m)", 1.2, 0.001, 100, "any")}
          ${numericField("video.heightMetres", "Height (m)", 0.675, 0.001, 100, "any")}
        </div>
        <p class="field-help">Videos fit inside this fixed rectangle without cropping or stretching.</p>
        <details class="inner-disclosure"><summary>Enter angular size</summary>
          <div class="disclosure-content">
            <p class="field-help" data-xr-angular-help>Available when the screen is centred and untilted. Applying angles replaces the metre dimensions.</p>
            <div class="field-grid">
              <label class="field"><span>Angular width (°)</span><input data-xr-angle="width" type="number" min="0.1" max="150" step="any" value="33.398488"></label>
              <label class="field"><span>Angular height (°)</span><input data-xr-angle="height" type="number" min="0.1" max="150" step="any" value="19.156"><span class="field-help">Both measured at the setup viewpoint.</span></label>
            </div>
            <button type="button" data-xr-action="angles">Apply angular size</button>
          </div>
        </details>
      </fieldset>
      <fieldset class="xr-profile-fields"><legend>Screen tilt</legend>
        <div class="field-grid">
          ${numericField("video.yawDegrees", "Yaw (°)", 0, -80, 80, "any")}
          ${numericField("video.pitchDegrees", "Pitch (°)", 0, -80, 80, "any")}
          ${numericField("video.rollDegrees", "Roll (°)", 0, -180, 180, "any")}
        </div>
      </fieldset>
      <fieldset class="xr-profile-fields"><legend>Feedback footprint</legend>
        <label class="check-field"><input type="checkbox" data-xr-field="feedback.enabled" checked><span>Include adjacent feedback</span></label>
        <div class="field-grid">
          ${numericField("feedback.offsetXMetres", "Centre offset (m right of screen)", 0, -100, 100, "any")}
          ${numericField("feedback.offsetYMetres", "Centre offset (m above screen)", -0.65, -100, 100, "any")}
          ${numericField("feedback.diameterMetres", "Maximum footprint diameter (m)", 0.25, 0.001, 100, "any")}
          ${numericField("feedback.minimumGapMetres", "Minimum screen gap (m)", 0.02, 0, 10, "any")}
        </div>
        <p class="field-help">Offsets use the screen's local axes, including its tilt. The footprint reserves space for the complete animation; appearance comes from Flubber &amp; Controls.</p>
      </fieldset>
      <details class="inner-disclosure"><summary>Setup alignment</summary><div class="disclosure-content">
        <p>Head-forward at setup, with gravity defining up. Content stays fixed when the participant moves. Re-centering is between attempts; tracking loss stops the attempt.</p>
        <p class="field-help">No eye tracking or current headset pose is stored in this profile.</p>
      </div></details>
      <figure class="xr-layout-figure">
        <label class="field"><span>Inspect video fit</span><select data-xr-media disabled><option value="">Authored screen</option></select></label>
        <div data-xr-scene></div>
        <figcaption>3D inspection preview. Viewing angles refer to the initial setup viewpoint; this is not a headset field-of-view simulation.</figcaption>
      </figure>
      <div class="xr-view-controls" role="group" aria-label="Inspect the 3D layout">
        <button type="button" data-xr-view="front">Front</button><button type="button" data-xr-view="side">Side</button>
        <button type="button" data-xr-view="top">Top</button><button type="button" data-xr-view="orbit">Oblique</button>
        <label class="field"><span>Inspection yaw (°)</span><input type="range" data-xr-camera="yaw" min="-180" max="180" value="30"></label>
        <label class="field"><span>Inspection elevation (°)</span><input type="range" data-xr-camera="elevation" min="-90" max="90" value="20"></label>
      </div>
      <dl class="xr-geometry-readout" data-xr-readout></dl>
      <p class="field-error" data-xr-error role="alert" hidden></p>
      <p class="field-help" data-xr-dependencies>Library geometry and the feedback envelope must be bound by the master recipe before experiment export.</p>
      <div class="xr-profile-actions">
        <button type="button" data-xr-action="accept">Accept layout</button>
        <button type="button" data-xr-action="export">Download authoring profile</button>
        <label class="field"><span>Open authoring profile</span><input type="file" accept=".json,application/json" data-xr-file></label>
      </div>
      <p role="status" aria-live="polite" data-xr-status>Layout draft. Not included in desktop v1 packages.</p>
    </div>
  </div>`;
}

// Orthographic inspection is intentionally independent of the saved setup pose.
export function xrLayoutSceneSvg(profile, camera = { yaw: 30, elevation: 20 }, media = null, footprint = null) {
  if (!camera || !Number.isFinite(camera.yaw) || Math.abs(camera.yaw) > 180
      || !Number.isFinite(camera.elevation) || Math.abs(camera.elevation) > 90) {
    throw new RangeError("Inspection yaw/elevation must be within ±180°/±90°.");
  }
  const g = resolveXrLayoutProfileV1(profile, media);
  const yaw = camera.yaw * Math.PI / 180, elevation = camera.elevation * Math.PI / 180;
  const project = ([x, y, z]) => [x * Math.cos(yaw) - z * Math.sin(yaw),
    -(y * Math.cos(elevation) - (x * Math.sin(yaw) + z * Math.cos(yaw)) * Math.sin(elevation))];
  const axisLength = Math.min(0.4, profile.video.distanceMetres / 3);
  const origin = [0, 0, 0];
  const axisPoints = [[axisLength, 0, 0], [0, axisLength, 0], [0, 0, -axisLength]];
  const all = [origin, ...axisPoints, ...g.videoCorners, ...(profile.feedback.enabled ? g.feedbackBounds : [])].map(project);
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const factor = Math.min(520 / Math.max(maxX - minX, 0.01), 285 / Math.max(maxY - minY, 0.01));
  const p = (point) => { const [x, y] = project(point); return [(x - (minX + maxX) / 2) * factor + 320, (y - (minY + maxY) / 2) * factor + 182]; };
  const fmt = (value) => Number(value.toFixed(3));
  const points = (list) => list.map((v) => p(v).map(fmt).join(",")).join(" ");
  const line = (a, b, cls) => { const [x1, y1] = p(a), [x2, y2] = p(b); return `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" class="${cls}"/>`; };
  const textAt = (point, text) => { const [x, y] = p(point); return `<text x="${fmt(x + 8)}" y="${fmt(y - 8)}">${text}</text>`; };
  const radius = profile.feedback.diameterMetres / 2;
  const feedbackOutline = Array.from({ length: 64 }, (_, i) => {
    const angle = i * Math.PI / 32, local = [Math.cos(angle) * radius, Math.sin(angle) * radius, 0];
    return g.feedbackCentre.map((value, row) => value + g.rotation[row].reduce((sum, v, col) => sum + v * local[col], 0));
  });
  return `<svg viewBox="0 0 640 370" role="img" aria-label="World-fixed virtual screen, setup viewer, axes and adjacent feedback footprint">
    <polygon points="${points(g.videoCorners)}" class="xr-screen-frame"/>
    <polygon points="${points(g.fittedCorners)}" class="xr-video-plane"/>
    ${line(origin, g.videoCentre, "xr-distance-line")}
    ${axisPoints.map((point) => line(origin, point, "xr-axis-line")).join("")}
    ${axisPoints.map((point, i) => textAt(point, ["+x right", "+y up", "−z forward"][i])).join("")}
    ${profile.feedback.enabled ? `<polygon points="${points(feedbackOutline)}" class="xr-feedback-footprint"/>${line(g.videoCentre, g.feedbackCentre, "xr-offset-line")}` : ""}
    ${footprint?.visible ? `<polygon points="${points(footprint.bounds)}" class="xr-feedback-envelope"/>` : ""}
    ${textAt(g.videoCentre, "Screen centre")}${textAt(origin, "Setup viewer")}
  </svg>`;
}
