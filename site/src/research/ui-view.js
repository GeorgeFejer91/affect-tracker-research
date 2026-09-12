import { createDefaultResearchSettings } from "./contracts.js";
import { xrLayoutEditorMarkup } from "./xr-layout-view.js";
import { STIMULUS_INSPIRATION_GROUPS } from "./stimulus-inspiration.js";
import { SETUP_SECTIONS } from "./ui-contracts.js";
import { feedbackAppearanceMarkup, feedbackInputMarkup, feedbackAdvancedMarkup } from "./feedback-controls-view.js";
import { screenLayoutDraftMarkup } from "./screen-layout-view.js";

const DEFAULT_SETTINGS = createDefaultResearchSettings();
const DEFAULT_COLORS = DEFAULT_SETTINGS.visual.colors;
const EXPERIMENT_TEMPLATE_URL = new URL("../../experiment-template.json", import.meta.url).href;
const DEFAULT_LANGUAGE_SELECTION_TREE = Object.freeze({
  algorithmVersion: "language-tree-v1",
  rootNodeId: "language",
  languages: [Object.freeze({
    languageId: "en",
    languageTag: "en",
    label: "English",
    questionnaireModuleIds: Object.freeze([]),
  })],
  nodes: [Object.freeze({
    nodeId: "language",
    prompt: "Choose your language",
    options: [Object.freeze({
      optionId: "en",
      label: "English",
      target: Object.freeze({ kind: "language", languageId: "en" }),
    })],
  })],
});
export const DEFAULT_LANGUAGE_SELECTION_SOURCE = JSON.stringify(DEFAULT_LANGUAGE_SELECTION_TREE, null, 2);

export { COLOR_FIELDS, describeInputToken } from "./feedback-controls-view.js";

const SECTION_SUMMARIES = Object.freeze({
  xr: "Optional · WebXR screen",
  workspace: "Work folder, videos, project JSON",
  stimuli: "Externally ordered video protocol",
  layout: "Proposed layout · not exportable",
  questionnaires: "Languages, demographics, questionnaires",
  feedback: "Appearance, input and animation",
  review: "Resolve blocking checks",
});

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}


function previewOverlayMarkup({ includeFace = false } = {}) {
  const faceMarkup = includeFace ? `
      <svg data-preview-face class="preview-face" viewBox="0 0 200 200" aria-hidden="true" focusable="false" hidden>
        <ellipse data-preview-face-head class="preview-face-head" cx="100" cy="100" rx="65" ry="78"></ellipse>
        <path data-preview-face-brow="left" class="preview-face-brow" d="M55 72 Q72 62 87 72"></path>
        <path data-preview-face-brow="right" class="preview-face-brow" d="M113 72 Q128 62 145 72"></path>
        <ellipse data-preview-face-eye="left" class="preview-face-eye" cx="73" cy="91" rx="13" ry="9"></ellipse>
        <ellipse data-preview-face-eye="right" class="preview-face-eye" cx="127" cy="91" rx="13" ry="9"></ellipse>
        <circle data-preview-face-pupil="left" class="preview-face-pupil" cx="73" cy="91" r="5"></circle>
        <circle data-preview-face-pupil="right" class="preview-face-pupil" cx="127" cy="91" r="5"></circle>
        <path data-preview-face-mouth-shape class="preview-face-mouth-shape" d="M62 128 Q100 152 138 128 Q100 168 62 128 Z"></path>
        <path data-preview-face-mouth-line class="preview-face-mouth-line" d="M62 128 Q100 152 138 128"></path>
      </svg>` : "";
  return `
    <div
      class="preview-overlay"
      data-preview-overlay
      data-locked="false"
      aria-hidden="true"
    >
      <canvas class="preview-grid-canvas" data-preview-grid-canvas aria-hidden="true"></canvas>
      <svg data-preview-grid viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        ${includeFace ? '<path data-preview-tile-lines class="preview-tile-lines" fill="none" stroke="#f4f2ea" hidden></path><g data-preview-active-tile class="preview-active-tile" hidden><rect data-preview-tile-edge="contrast" class="preview-tile-contrast" fill="none" stroke="#111310" stroke-width="2"></rect><rect data-preview-tile-edge="highlight" class="preview-tile-highlight" fill="none" stroke="#ffffff" stroke-width="1"></rect></g>' : ""}
        <line data-preview-grid-line class="preview-grid-lines" x1="25" y1="0" x2="25" y2="100"></line>
        <line data-preview-grid-line class="preview-grid-lines" x1="50" y1="0" x2="50" y2="100"></line>
        <line data-preview-grid-line class="preview-grid-lines" x1="75" y1="0" x2="75" y2="100"></line>
        <line data-preview-grid-line class="preview-grid-lines" x1="0" y1="25" x2="100" y2="25"></line>
        <line data-preview-grid-line class="preview-grid-lines" x1="0" y1="50" x2="100" y2="50"></line>
        <line data-preview-grid-line class="preview-grid-lines" x1="0" y1="75" x2="100" y2="75"></line>
        <rect data-preview-grid-outline class="preview-grid-outline" x="0.5" y="0.5" width="99" height="99" fill="none"></rect>
        <circle data-preview-grid-cursor class="preview-grid-cursor" cx="50" cy="50" r="4"></circle>
      </svg>
      <svg data-preview-flubber class="preview-flubber" viewBox="-1.62 -1.62 3.24 3.24" aria-hidden="true" focusable="false">
        ${includeFace ? `<defs>
          <filter id="preview-studio-halo-fade" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">
            <feGaussianBlur data-preview-halo-blur stdDeviation="0.045"></feGaussianBlur>
            <feComponentTransfer><feFuncA data-preview-halo-falloff type="gamma" amplitude="1" exponent="1" offset="0"></feFuncA></feComponentTransfer>
          </filter>
        </defs>` : ""}
        <path data-preview-flubber-halo class="preview-flubber-halo"${includeFace ? ' filter="url(#preview-studio-halo-fade)"' : ""}></path>
        <path data-preview-flubber-base class="preview-flubber-base"></path>
        <path data-preview-flubber-outline class="preview-flubber-outline"></path>
      </svg>
      ${faceMarkup}
    </div>`;
}

function previewMarkup(label, { studio = false } = {}) {
  const escapedLabel = escapeAttribute(label);
  if (!studio) {
    return `
      <div class="research-preview-stage" role="img" aria-label="${escapedLabel}">
        ${previewOverlayMarkup()}
      </div>`;
  }

  return `
    <div class="research-preview-stage research-preview-studio" data-preview-variant="studio" role="group" aria-label="${escapedLabel}">
      <div class="preview-primary-stage" tabindex="0" role="group" aria-label="Selected feedback rendering and configured input preview" aria-describedby="preview-response-simulator-help">
        ${previewOverlayMarkup({ includeFace: true })}
        <p class="preview-mode-label">Previewing <span data-preview-mode-label>Flubber</span></p>
      </div>

      <section class="preview-affect-map" aria-labelledby="preview-affect-map-title">
        <div class="preview-subsection-heading">
          <h3 id="preview-affect-map-title">2D affect map</h3>
          <p>Choose an anchor to edit its color.</p>
        </div>
        <div class="preview-anchor-modes" role="group" aria-label="Color anchor placement">
          <label class="radio-field"><input type="radio" name="previewColorAnchors" value="axes" checked><span>Axes</span></label>
          <label class="radio-field"><input type="radio" name="previewColorAnchors" value="corners"><span>Corners</span></label>
          <span class="field-help">Placement is preview-only.</span>
        </div>
        <div class="preview-affect-map-layout">
          <button type="button" class="preview-color-anchor anchor-up" data-color-anchor="up" aria-haspopup="dialog" aria-controls="preview-color-dialog">
            <span class="preview-color-swatch" data-color-anchor-swatch="up" aria-hidden="true"></span><span data-color-anchor-label>High arousal</span>
          </button>
          <button type="button" class="preview-color-anchor anchor-left" data-color-anchor="left" aria-haspopup="dialog" aria-controls="preview-color-dialog">
            <span class="preview-color-swatch" data-color-anchor-swatch="left" aria-hidden="true"></span><span data-color-anchor-label>Negative valence</span>
          </button>
          <div class="preview-control-surface" tabindex="0" role="group" aria-label="Response simulator on the valence and arousal color field" aria-describedby="preview-response-simulator-help" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown">
            <canvas id="main-gradient-canvas" data-preview-control-canvas width="240" height="240" aria-hidden="true"></canvas>
            <svg data-preview-control-grid viewBox="0 0 100 100" aria-hidden="true" focusable="false">
              <path data-preview-tile-lines class="preview-tile-lines" fill="none" stroke="#f4f2ea"></path>
              <g data-preview-active-tile class="preview-active-tile"><rect data-preview-tile-edge="contrast" class="preview-tile-contrast" fill="none" stroke="#111310" stroke-width="2"></rect><rect data-preview-tile-edge="highlight" class="preview-tile-highlight" fill="none" stroke="#ffffff" stroke-width="1"></rect></g>
              <rect data-preview-control-outline x="0.5" y="0.5" width="99" height="99" fill="none"></rect>
              <circle data-preview-control-cursor cx="50" cy="50" r="4"></circle>
            </svg>
          </div>
          <button type="button" class="preview-color-anchor anchor-right" data-color-anchor="right" aria-haspopup="dialog" aria-controls="preview-color-dialog">
            <span class="preview-color-swatch" data-color-anchor-swatch="right" aria-hidden="true"></span><span data-color-anchor-label>Positive valence</span>
          </button>
          <button type="button" class="preview-color-anchor anchor-down" data-color-anchor="down" aria-haspopup="dialog" aria-controls="preview-color-dialog">
            <span class="preview-color-swatch" data-color-anchor-swatch="down" aria-hidden="true"></span><span data-color-anchor-label>Low arousal</span>
          </button>
        </div>
        <div class="preview-simulator-help">
          <p id="preview-response-simulator-help">Focus the map and use the arrow keys to try the selected response behavior.</p>
          <button id="preview-response-reset" type="button">Reset to neutral</button>
          <button id="preview-recolor" type="button">Recolor</button>
        </div>
        <output data-preview-tile-status class="field-help" role="status" aria-live="polite" aria-atomic="true"></output>
        <output data-preview-input-availability class="field-help" role="status" aria-live="polite"></output>
      </section>

      <div class="preview-controls-scroll" tabindex="0" role="region" aria-label="Flubber and Controls settings">
      ${feedbackAppearanceMarkup()}
      ${feedbackInputMarkup()}

      <details class="preview-response-settings inner-disclosure">
        <summary>Try response ideas · preview only</summary>
        <div class="disclosure-content">
        <div class="preview-subsection-heading"><h3 id="preview-response-title">Response control</h3></div>
        <div class="preview-segmented-control" role="group" aria-label="Response preview mode">
          <button type="button" data-response-preview-mode="continuous" aria-pressed="false">Continuous</button>
          <button type="button" data-response-preview-mode="stepwise" aria-pressed="true">Stepwise</button>
        </div>
        <div data-response-preview-panel="continuous" hidden>
          <label class="field"><span>Full-span duration</span><div class="range-field"><input id="preview-full-span-duration" type="range" min="250" max="15000" step="250" value="2000"><output for="preview-full-span-duration">2,000 ms</output></div></label>
          <p class="field-help">Draft preview only: the duration estimates how long a held control takes to travel from −1 to +1.</p>
        </div>
        <div data-response-preview-panel="stepwise">
          <fieldset class="check-group">
            <legend>Grid dimensions</legend>
            <label class="radio-field"><input type="radio" name="previewGridSizing" value="square" checked><span>Steps each side of zero</span></label>
            <label class="radio-field"><input type="radio" name="previewGridSizing" value="custom"><span>Custom grid (columns × rows)</span></label>
          </fieldset>
          <label class="field" data-preview-grid-square><span>Steps each side of zero</span><input id="preview-tile-count" data-preview-grid-input type="number" min="1" max="1000" step="1" value="10" aria-describedby="preview-tile-count-help"></label>
          <div class="field-grid" data-preview-grid-custom hidden>
            <label class="field"><span>Columns</span><input id="preview-tile-columns" data-preview-grid-input type="number" min="3" max="2001" step="2" value="21" disabled aria-describedby="preview-tile-count-help"></label>
            <label class="field"><span>Rows</span><input id="preview-tile-rows" data-preview-grid-input type="number" min="3" max="2001" step="2" value="21" disabled aria-describedby="preview-tile-count-help"></label>
          </div>
          <output id="preview-tile-count-help" class="field-help" role="status" aria-live="polite">21 × 21 tiles. 10 steps each side of zero; 1 creates 3 × 3, 2 creates 5 × 5.</output>
          <fieldset class="check-group">
            <legend>Hold rule</legend>
            <label class="radio-field"><input type="radio" name="previewHoldRule" value="separatePresses" checked><span>Require separate presses</span></label>
            <label class="radio-field"><input type="radio" name="previewHoldRule" value="repeatWhileHeld"><span>Repeat while held</span></label>
          </fieldset>
          <label class="field" data-preview-repeat-settings><span>Repeat delay</span><div class="range-field"><input id="preview-repeat-delay" type="range" min="500" max="5000" step="100" value="500"><output for="preview-repeat-delay">500 ms</output></div></label>
          <p class="field-help">Draft preview only: tiles and hold behavior are not saved with the experiment. The saved input step size is under Controls.</p>
        </div>
        </div>
      </details>

      ${feedbackAdvancedMarkup()}
      <div class="preview-coordinates preview-coordinate-receipt" aria-label="Current affect coordinates"><span>Valence</span><span data-preview-x>+0.000</span><span>Arousal</span><span data-preview-y>+0.000</span></div>
      <footer class="preview-footer">
        <div class="preview-metric"><span>Position</span><span data-preview-position>0.50, 0.50</span></div>
        <div class="preview-metric"><span>Input test</span><span id="preview-input-source">Arrow keys</span></div>
        <div class="preview-metric"><span>Sampling</span><span id="preview-sampling-rate">130 Hz</span></div>
      </footer>
      ${sectionConfirmationMarkup(SETUP_SECTIONS.find(({ id }) => id === "feedback"), SETUP_SECTIONS.findIndex(({ id }) => id === "feedback"))}
      </div>
    </div>`;
}

function folderIconMarkup() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3.75 6.75h6l1.5 2.25h9v8.25a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2V6.75Z"></path>
      <path d="M3.75 9h16.5"></path>
    </svg>`;
}

function stimulusInspirationMarkup() {
  const groups = STIMULUS_INSPIRATION_GROUPS.map((group) => `
    <section class="stimulus-inspiration-group" aria-labelledby="stimulus-inspiration-${group.id}">
      <header>
        <h3 id="stimulus-inspiration-${group.id}">${group.label}</h3>
        <p>${group.summary}</p>
      </header>
      <ul class="stimulus-inspiration-list">
        ${group.sources.map((source) => `<li>
          <div class="stimulus-source-heading">
            <div><strong>${source.name}</strong><span>${source.expandedName}</span></div>
            <span class="stimulus-availability">${source.availability}</span>
          </div>
          <p>${source.description}</p>
          <dl>
            <div><dt>Format</dt><dd>${source.duration}</dd></div>
            <div><dt>Ratings</dt><dd>${source.ratings}</dd></div>
          </dl>
          <div class="stimulus-source-links">
            <a href="${source.doiUrl}" target="_blank" rel="noopener noreferrer">DOI: ${source.doi}</a>
            <a href="${source.sourceUrl}" target="_blank" rel="noopener noreferrer">Official source<span class="sr-only"> for ${source.name}</span></a>
          </div>
        </li>`).join("")}
      </ul>
    </section>`).join("");

  return `
    <dialog id="stimulus-inspiration-dialog" aria-labelledby="stimulus-inspiration-title" aria-describedby="stimulus-inspiration-intro stimulus-inspiration-note">
      <div class="dialog-content stimulus-inspiration-content">
        <p class="context-label">Research source catalogue</p>
        <h2 id="stimulus-inspiration-title">Stimulus inspiration</h2>
        <p id="stimulus-inspiration-intro" class="stimulus-inspiration-intro">Open materials and academically useful comparison corpora for valence–arousal studies. Links open the original source; nothing is downloaded or added to this experiment.</p>
        <div class="stimulus-inspiration-groups">${groups}</div>
        <p id="stimulus-inspiration-note" class="stimulus-inspiration-note"><strong>Before choosing:</strong> induced or felt valence–arousal is the closest validation target for this tracker. Perceived or expressed emotion is complementary, not equivalent. Verify the exact version and licence, and revalidate anything edited, concatenated, translated, narrated, or synthesized.</p>
      </div>
      <form method="dialog" class="dialog-actions"><button id="stimulus-inspiration-close" type="submit" class="primary-action">Close catalogue</button></form>
    </dialog>`;
}

function workspaceSection() {
  const folderIcon = folderIconMarkup();
  return `
    <p class="section-lead">Choose one work directory. Videos, project JSON, outputs, and recovery stay inside it.</p>
    <div class="workspace-location-list" aria-label="Project locations">
      <section class="workspace-location-row" data-workspace-location="workspaceRoot" aria-labelledby="workspace-location-root-title">
        <div class="workspace-location-copy">
          <h3 id="workspace-location-root-title">Work directory</h3>
          <output id="workspace-root" data-state="warning">No work directory set</output>
        </div>
        <div class="workspace-location-actions">
          <button id="workspace-choose" type="button" class="primary-action">Set work directory</button>
          <button type="button" class="folder-icon-button" data-open-workspace-location="workspaceRoot" aria-label="Open work directory in File Explorer" title="Set the work directory before opening it" disabled>${folderIcon}</button>
          <button id="workspace-renew" type="button" hidden>Restore access</button>
        </div>
      </section>
      <section class="workspace-location-row" data-workspace-location="videoLibrary" aria-labelledby="workspace-location-video-title">
        <div class="workspace-location-copy">
          <h3 id="workspace-location-video-title">Video library</h3>
          <p><code>assets/stimuli/</code></p>
        </div>
        <div class="workspace-location-actions">
          <button type="button" class="folder-icon-button" data-open-workspace-location="videoLibrary" aria-label="Open video library in File Explorer" title="Set the work directory before opening it" disabled>${folderIcon}</button>
        </div>
      </section>
      <section class="workspace-location-row" data-workspace-location="experimentPackage" aria-labelledby="workspace-location-json-title">
        <div class="workspace-location-copy">
          <h3 id="workspace-location-json-title">Project JSON</h3>
          <p><code>experiment.package.json</code></p>
          <output id="package-file-status" data-state="warning">No project JSON loaded</output>
        </div>
        <div class="workspace-location-actions">
          <button id="package-load" type="button">Load JSON</button>
          <button type="button" class="folder-icon-button" data-open-workspace-location="experimentPackage" aria-label="Show project JSON in File Explorer" title="Set the work directory before opening it" disabled>${folderIcon}</button>
        </div>
      </section>
    </div>
    <div id="video-drop-zone" class="drop-zone" role="group" aria-describedby="video-drop-help" aria-label="Complete video import and drop area">
      <p>Drop complete video files or a folder here</p>
      <div class="button-row"><button id="stimulus-inspiration-open" type="button" class="inspiration-action pictographic-action" aria-label="Stimulus inspiration" title="Stimulus inspiration" aria-haspopup="dialog" aria-controls="stimulus-inspiration-dialog"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="8.5" cy="9" r="3"></circle><path d="M3.5 20c.5-3.7 2.2-5.5 5-5.5s4.5 1.8 5 5.5"></path><path class="inspiration-spark" d="M17.5 3v3M22 7.5h-3M20.7 4.3l-2.1 2.1M16.3 7.2l-1.8-1.8"></path></svg><span class="sr-only">Stimulus inspiration</span></button><button id="video-import" type="button" disabled>Add video files</button><button id="video-folder-import" type="button" disabled>Add video folder</button><button id="workspace-rescan" type="button" disabled>Rescan library</button></div>
      <p id="video-drop-help" class="field-help">Folders are scanned recursively. Affect Research does not create clips or change start and end times.</p>
    </div>
    <div class="table-scroll stimulus-library" aria-label="Stimulus library">
      <table>
        <thead><tr><th>Video</th><th>Source</th><th>Verification</th><th>Protocol use</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody id="stimulus-library-table"><tr><td colspan="5" class="empty-state">No complete videos have been imported.</td></tr></tbody>
      </table>
    </div>
    <div class="field-grid">
      <label class="field"><span>Experiment ID</span><input id="experiment-id" name="experimentId" required maxlength="128" pattern="[a-z0-9][a-z0-9_-]*" value="video-affect-study" aria-describedby="workspace-experiment-identity-help"></label>
      <label class="field"><span>Experiment title</span><input id="experiment-title" name="experimentTitle" required maxlength="200" value="Video Affect Study" aria-describedby="workspace-experiment-identity-help"></label>
      <p id="workspace-experiment-identity-help" class="field-help is-wide">Name this study here. Loading a project JSON replaces these values.</p>
    </div>
    <p id="workspace-status" class="status-text" role="status" aria-live="polite"></p>`;
}

function experimentCompatibilityMarkup() {
  return `
    <details id="review-legacy-files" class="inner-disclosure">
      <summary>Legacy experiment and settings compatibility</summary>
      <div class="disclosure-content authoring-tools">
        <section aria-labelledby="experiment-file-title">
          <div>
            <p class="context-label">External protocol authority</p>
            <h3 id="experiment-file-title">experiment.json</h3>
            <p class="field-help">Prepare randomization outside Affect Research. The file supplies every participant’s block order, complete-video order, and the ISI after each video. Array order is authoritative.</p>
          </div>
          <div class="button-row">
            <button id="experiment-load" type="button">Load experiment.json</button>
            <a id="experiment-template-download" class="button-link" href="${EXPERIMENT_TEMPLATE_URL}" download="experiment.json">Download template</a>
          </div>
          <output id="experiment-file-status" class="field-output" data-state="warning">No experiment.json loaded</output>
          <label class="field"><span>Legacy planned participant count</span><input id="participant-count" name="participantCount" type="number" min="1" max="100000" step="1" value="1" required readonly aria-describedby="participant-count-legacy-help"></label>
          <p id="participant-count-legacy-help" class="field-help">This is the imported v1 schedule count. Change it by editing and reloading experiment.json.</p>
        </section>
        <section aria-labelledby="legacy-settings-title">
          <div>
            <p class="context-label">Compatibility</p>
            <h3 id="legacy-settings-title">Legacy settings</h3>
          </div>
          <div class="button-row"><button id="settings-load" type="button">Load settings.json</button><button id="settings-save" type="button" disabled>Save settings.json</button></div>
        </section>
      </div>
    </details>`;
}

function stimuliSection() {
  return `
    <p class="section-lead">Inspect the externally authored protocol. Only freshly verified workspace videos can satisfy its paths; this screen does not edit or randomize the order.</p>
    <div class="condition-toolbar">
      <div>
        <h3>Declared blocks</h3>
        <p id="pool-mode-summary" class="field-help">Load experiment.json to inspect its blocks.</p>
      </div>
      <output class="field-output">external-order-v1</output>
    </div>
    <div id="condition-pools" class="condition-pools" aria-label="Externally declared experiment blocks"></div>
    <div id="coverage-message" class="coverage-message" role="status" aria-live="polite">Load experiment.json, select a workspace, and verify every referenced complete video.</div>
    <details class="inner-disclosure" open>
      <summary>Authoring contract</summary>
      <div class="disclosure-content">
        <p class="field-help"><code>schedules[].blocks[].videos[]</code> is executed exactly in array order. Every video row requires <code>stimulusId</code> and integer <code>isiAfterMs</code> (0–3,600,000). Even a final nonzero ISI is executed before post-block or post-session questionnaires.</p>
        <dl class="protocol-facts"><div><dt>Randomization</dt><dd>Completed before import</dd></div><div><dt>Runtime allocation</dt><dd>None</dd></div><div><dt>Recovery</dt><dd>Restarts the interrupted video or ISI from its safe boundary</dd></div></dl>
      </div>
    </details>
    <details class="inner-disclosure" open>
      <summary>Resolved participant preview</summary>
      <div class="disclosure-content">
        <div class="plan-toolbar">
          <div class="field-block"><span class="field-label">Resolved experiment plan hash</span><output id="plan-hash" class="hash-value">Pending experiment.json</output></div>
          <div class="button-row"><button id="plan-window-previous" type="button" disabled>Previous participants</button><button id="plan-window-next" type="button" disabled>Next participants</button><button id="assignment-plan-export" type="button" disabled>Export resolved-plan.csv</button></div>
        </div>
        <div class="table-scroll">
          <table><thead><tr><th>Participant</th><th>Block order</th><th>Complete-video order and ISI</th></tr></thead><tbody id="assignment-preview"><tr><td colspan="3" class="empty-state">The exact schedule appears after every referenced workspace video is verified.</td></tr></tbody></table>
        </div>
        <p id="plan-window-status" class="field-help">Showing 0 of 0 participants.</p>
      </div>
    </details>`;
}

function questionnairesSection() {
  return `
    <p class="section-lead">Add the questionnaires participants complete before the video task. Paste items, answer labels and recorded values together from Excel.</p>
    <div class="questionnaire-language-controls">
      <label class="field"><span>Add a language</span><select id="study-language-add"><option value="de">Deutsch · German</option></select></label>
      <button id="study-language-add-button" type="button">Add language</button>
    </div>
    <ul id="study-language-list" class="study-language-list"></ul>
    <p id="study-language-mode-note" class="field-help">Each questionnaire needs its own version in every selected language.</p>
    <div class="questionnaire-add-toolbar" aria-label="Add a pre-task questionnaire">
      <button id="questionnaire-add-blank" type="button" class="primary-action">Add questionnaire</button>
      <button id="questionnaire-prebuilt-open" type="button" aria-haspopup="dialog">Add prebuilt questionnaire asset</button>
    </div>
    <div id="questionnaire-sheet-list" class="questionnaire-sheet-list"></div>
    <output id="questionnaire-coverage-status" class="field-output" aria-live="polite">No questionnaires added.</output>
    <output id="questionnaire-import-status" class="field-help" aria-live="polite"></output>
    <p class="field-help">Participant details (age, gender and handedness) remain included before the task.</p>
    <input id="questionnaire-sheet-file" type="file" accept=".csv,.txt,.json" hidden>
    <dialog id="questionnaire-prebuilt-dialog" class="research-dialog questionnaire-prebuilt-dialog" aria-labelledby="questionnaire-prebuilt-title">
      <div class="dialog-heading"><h2 id="questionnaire-prebuilt-title">Prebuilt questionnaire assets</h2><button id="questionnaire-prebuilt-close" type="button">Back to questionnaires</button></div>
      <p>Choose each language version separately. Ready-to-use assets fill the item, answer-label and coding cells. Other selected study languages still need their matching version.</p>
      <div id="questionnaire-prebuilt-list"></div>
      <p id="questionnaire-prebuilt-status" role="status" aria-live="polite"></p>
    </dialog>
    <dialog id="questionnaire-sheet-copy" class="research-dialog questionnaire-sheet-copy" aria-labelledby="questionnaire-sheet-copy-title">
      <div class="dialog-heading"><h2 id="questionnaire-sheet-copy-title">Copy questionnaire table</h2><button type="button" data-sheet-copy-close>Close</button></div>
      <p>Press Ctrl+C, then paste into Excel. The selected text includes every item, answer label, code and required flag in the current table view.</p>
      <textarea id="questionnaire-sheet-copy-text" readonly rows="12" aria-label="Selected tab-delimited questionnaire table"></textarea>
    </dialog>
    <dialog id="questionnaire-sheet-preview" class="research-dialog questionnaire-sheet-preview" aria-labelledby="questionnaire-sheet-preview-title">
      <div class="dialog-heading"><h2 id="questionnaire-sheet-preview-title">Questionnaire preview</h2><button type="button" data-sheet-preview-close aria-label="Close questionnaire preview">Close</button></div>
      <div id="questionnaire-sheet-preview-content"></div>
    </dialog>`;
}

function lslSettingsMarkup() {
  return `
    <details id="review-lsl" class="inner-disclosure">
      <summary>LSL</summary>
      <div class="disclosure-content">
        <label class="check-field"><input id="lsl-enabled" type="checkbox"><span><strong>Enable LSL</strong><br><span class="field-help">Publishes the regular eight-channel state stream and irregular semantic marker stream in Windows Tauri.</span></span></label>
        <div class="field-grid spaced-field-grid">
          <label class="field"><span>State Stream</span><input id="lsl-state-stream" value="AffectResearch" maxlength="128"></label>
          <label class="field"><span>Stream Type</span><input id="lsl-stream-type" value="Affect" maxlength="128"></label>
          <label class="field"><span>Marker Stream</span><input id="lsl-marker-stream" value="AffectResearchMarkers" maxlength="128"></label>
          <label class="field"><span>Source ID</span><input id="lsl-source-id" value="affect-research" maxlength="128"></label>
        </div>
        <p id="lsl-capability" class="capability-note" role="status">Browser mode preserves these values but cannot start while LSL is enabled.</p>
      </div>
    </details>`;
}

function reviewSection() {
  return `
    <section class="package-finalization" aria-labelledby="package-finalization-title">
      <div><h3 id="package-finalization-title">Recipe file</h3><p>Includes questionnaires and settings. Keep videos in the project library.</p></div>
      <div class="button-row">
        <button id="package-generate" type="button" class="primary-action">Save recipe</button>
        <button id="package-edit" type="button" disabled>Edit recipe</button>
      </div>
    </section>
    <p id="package-save-status" role="status" aria-live="polite">Review the design, then save its recipe.</p>
    <ul id="package-contribution-issues" aria-label="Recipe issues by segment" hidden></ul>
    ${lslSettingsMarkup()}
    <div class="field-grid spaced-field-grid">
      <label class="field"><span>Sampling frequency</span><div class="range-field"><input id="sampling-frequency" name="samplingFrequency" type="number" min="1" max="240" step="1" value="130" required><output for="sampling-frequency">130 Hz</output></div></label>
      <p class="field-help">Continuous rating is always enabled during video playback.</p>
    </div>
    <fieldset id="output-format-group" class="check-group spaced-check-group" aria-describedby="output-format-help output-format-error">
      <legend>Rating output formats</legend>
      <label class="check-field"><input id="output-csv" type="checkbox" checked><span>CSV</span></label>
      <label class="check-field"><input id="output-tsv" type="checkbox"><span>TSV</span></label>
      <p id="output-format-help" class="field-help">Choose at least one. CSV and TSV contain the same records.</p>
      <p id="output-format-error" class="field-error" hidden>Select CSV, TSV, or both.</p>
    </fieldset>
    ${experimentCompatibilityMarkup()}
    <h3 class="review-checks-title">Before starting</h3>
    <ul id="preflight-list" class="preflight-list" aria-label="Experiment preflight checks"></ul>
    <details id="review-provenance" class="inner-disclosure">
      <summary>Schedule, playback & output details</summary>
      <div class="disclosure-content field-grid">
        <div class="field-block is-wide"><span class="field-label">Package reproduction matrix</span><output id="package-reproduction-status" class="field-output" data-state="warning">Not verified</output></div>
        <div class="field-block is-wide"><span class="field-label">Output location</span><output id="review-output-path" class="field-output path-value">outputs/&lt;experiment-id&gt;/&lt;participant-id&gt;/&lt;session-stem&gt;/</output></div>
        <div class="field-block"><span class="field-label">Settings hash</span><output id="settings-hash" class="field-output hash-value">Pending validated settings</output></div>
        <div class="field-block"><span class="field-label">Assignment plan hash</span><output id="review-plan-hash" class="field-output hash-value">Pending valid allocation</output></div>
        <div class="field-block"><span class="field-label">Estimated storage</span><output id="storage-estimate" class="field-output">Pending verified videos</output></div>
        <div class="field-block"><span class="field-label">Sampling capability</span><output id="timing-capability" class="field-output">Dedicated scheduler not yet verified</output></div>
        <label class="field is-wide tauri-only"><span>Native playback qualification</span><select id="native-playback-mode"><option value="nativeGstPlay" selected>GStreamer / GstPlay · qualification required</option><option value="unqualifiedWebview">WebView video · unqualified testing only</option></select><output id="native-media-capability" class="field-help">Native runtime capability has not been checked.</output></label>
      </div>
    </details>
    <details id="review-participant-chooser" class="inner-disclosure">
      <summary>Participant chooser</summary>
      <div class="disclosure-content">
        <p class="field-help">Availability and recovery are read from saved attempts.</p>
        <div class="participant-toolbar"><button id="participant-window-previous" type="button" disabled>Previous participants</button><output id="participant-window-status">Showing 1–24 of 24</output><button id="participant-window-next" type="button" disabled>Next participants</button></div>
        <div id="participant-grid" class="participant-grid" role="radiogroup" aria-label="Participant state chooser"></div>
        <fieldset id="attempt-disposition" class="check-group attempt-disposition" hidden>
          <legend>Attempt handling</legend>
          <label id="attempt-resume-option" class="radio-field"><input type="radio" name="attemptDisposition" value="resume-compatible" aria-describedby="attempt-disposition-note"><span><strong>Resume compatible partial</strong><br><span class="field-help">Verify the frozen settings and plan hashes, then restart at the last safe stimulus boundary.</span></span></label>
          <label id="attempt-new-option" class="radio-field"><input type="radio" name="attemptDisposition" value="new-attempt" aria-describedby="attempt-disposition-note"><span><strong>Start a new attempt</strong><br><span class="field-help">Keep all earlier evidence and allocate the next create-new attempt number.</span></span></label>
          <p id="attempt-disposition-note" class="field-help" role="status">Choose how to handle the selected participant's existing evidence.</p>
          <label id="participant-rerun-confirm-field" class="check-field" hidden><input id="participant-rerun-confirm" type="checkbox" aria-describedby="participant-rerun-warning"><span>I confirm this completed participant should receive a new attempt.</span></label>
        </fieldset>
        <p id="participant-rerun-warning" class="coverage-message" hidden role="status"></p>
        <p id="participant-active-warning" class="coverage-message" hidden role="status">This participant has an active lock. Finish or recover that active attempt before starting here.</p>
      </div>
    </details>
    <details id="review-participant-details" class="inner-disclosure">
      <summary>Participant details</summary>
      <div class="disclosure-content">
        <p class="field-help">Names are used only to derive an uppercase two-grapheme code. Raw names and any self-description are removed before Start and never enter files, logs, markers, or recovery state.</p>
        <div class="field-grid spaced-field-grid">
          <label class="field"><span>First name</span><input id="participant-first-name" required autocomplete="off" maxlength="120"></label>
          <label class="field"><span>Last name</span><input id="participant-last-name" required autocomplete="off" maxlength="120"></label>
          <label class="field"><span>Age</span><input id="participant-age" type="number" min="1" max="120" step="1" required></label>
          <label class="field"><span>Gender</span><select id="participant-gender" required><option value="">Select…</option><option value="W">Woman</option><option value="M">Man</option><option value="N">Non-binary</option><option value="S">Self-described</option><option value="X">Prefer not to say</option></select></label>
          <label class="field is-wide"><span>Handedness</span><select id="participant-handedness" required><option value="">Select…</option><option value="L">Left</option><option value="R">Right</option><option value="A">Ambidextrous</option></select></label>
          <div class="field-block is-wide"><span class="field-label">Derived participant code</span><output id="participant-code" class="field-output">Enter first and last name</output></div>
        </div>
      </div>
    </details>
    <section class="participant-language-readiness" aria-labelledby="participant-language-label">
      <div>
        <h3 id="participant-language-label">Participant language</h3>
        <output id="participant-language-status" class="field-output" data-state="warning" aria-live="polite">Choose a package language for this participant and attempt.</output>
        <p class="field-help">Choose a language before starting. A resumed attempt keeps its original language.</p>
      </div>
      <button id="choose-participant-language" type="button" disabled>Choose participant language</button>
    </section>
    <div class="start-bar">
      <p id="start-status" role="status" aria-live="polite">Resolve all blocking preflight items.</p>
      <button id="start-experiment" type="button" class="primary-action" disabled>Start experiment / session</button>
    </div>`;
}

const SECTION_CONTENT = Object.freeze({
  workspace: workspaceSection,
  layout: screenLayoutDraftMarkup,
  stimuli: stimuliSection,
  questionnaires: questionnairesSection,
  xr: xrLayoutEditorMarkup,
  review: reviewSection,
});

function sectionConfirmationMarkup(section, index) {
  const isLast = index === SETUP_SECTIONS.length - 1;
  return `
    <div class="setup-section-confirmation">
      <p id="setup-confirmation-status-${section.id}" data-section-confirmation-status="${section.id}">Not reviewed</p>
      <button
        class="setup-section-confirm-button"
        type="button"
        data-confirm-section="${section.id}"
        data-review-state="pending"
        aria-describedby="setup-confirmation-status-${section.id}"
      >${isLast ? "Confirm review" : "Confirm section"}</button>
    </div>`;
}

function feedbackNavigationMarkup(section, index) {
  return `<div class="feedback-navigation">
    <button type="button" id="setup-trigger-feedback" data-open-section="feedback" aria-controls="preview-title">
      <span class="section-number">${index + 1}</span><span>${section.label}</span>
      <span class="section-review-status" data-section-review-status="feedback"><span data-section-review-check="feedback" aria-hidden="true" hidden>✓</span></span>
      <span class="sr-only" data-feedback-nav-status>Not reviewed</span>
    </button>
    <span class="field-help" data-section-summary="feedback">${SECTION_SUMMARIES.feedback}</span>
  </div>`;
}

function accordionMarkup(section, index) {
  const expanded = index === 0;
  return `
    <section class="setup-accordion" data-setup-section="${section.id}" data-reviewed="false">
      <h2 class="setup-accordion-heading">
        <button
          class="setup-accordion-trigger"
          type="button"
          id="setup-trigger-${section.id}"
          aria-expanded="${expanded}"
          aria-controls="setup-panel-${section.id}"
          data-open-section="${section.id}"
        >
          <span class="section-number">${index + 1}</span>
          <span class="section-title">${section.label}</span>
          <span class="section-summary" data-section-summary="${section.id}">${SECTION_SUMMARIES[section.id]}</span>
          <span class="section-review-status" data-section-review-status="${section.id}"><span data-section-review-check="${section.id}" aria-hidden="true" hidden>✓</span><span class="sr-only" data-section-review-label="${section.id}">Not reviewed</span></span>
          <span class="section-chevron" aria-hidden="true">${expanded ? "−" : "+"}</span>
        </button>
      </h2>
      <div
        class="setup-accordion-panel"
        id="setup-panel-${section.id}"
        role="region"
        aria-labelledby="setup-trigger-${section.id}"
        data-motion-state="${expanded ? "open" : "closed"}"
        ${expanded ? "" : "aria-hidden=\"true\" hidden inert"}
      ><div class="setup-accordion-panel-clip"><div class="setup-accordion-panel-inner">${SECTION_CONTENT[section.id]()}${sectionConfirmationMarkup(section, index)}</div></div></div>
    </section>`;
}

export function renderResearchUiMarkup(surface = "browser") {
  const platformLabel = surface === "tauri" ? "Tauri desktop adapter" : "Desktop Chrome / Edge adapter";
  return `
    <div class="research-shell" data-research-mode="setup">
      <header class="app-bar">
        <div class="product-block"><span class="product-mark" aria-hidden="true"></span><h1>Affect Research</h1><p class="build-label">0.4.0-alpha.1</p></div>
        <nav class="mode-navigation" aria-label="Application mode">
          <button type="button" data-mode-button="setup" aria-current="page">Setting Up the Experiment</button>
          <button type="button" data-mode-button="run" disabled>Running the Experiment</button>
        </nav>
        <p class="surface-status">${platformLabel}</p>
      </header>
      <main>
        <section class="setup-mode" data-mode-panel="setup" aria-label="Setting Up the Experiment">
          <form id="research-settings-form" class="setup-layout" novalidate>
            <div class="setup-pane" id="setup-sections">
              <div class="setup-intro"><p>Review the design before creating a session.</p><output id="setup-progress" class="setup-progress">0 of ${SETUP_SECTIONS.length} reviewed · 0 ready</output></div>
              ${SETUP_SECTIONS.map((section, index) => section.id === "feedback" ? feedbackNavigationMarkup(section, index) : accordionMarkup(section, index)).join("")}
            </div>
            <div class="setup-resizer" data-setup-resizer role="separator" tabindex="0"
              aria-label="Resize sections and live preview" aria-orientation="vertical"
              aria-controls="setup-sections" aria-valuemin="0" aria-valuemax="100" aria-valuenow="63"
              aria-describedby="setup-resizer-help"
              title="Drag to resize. Arrow keys adjust; double-click resets.">
              <span id="setup-resizer-help" class="sr-only">Drag left or right to resize. Use Left and Right arrows, Shift for larger steps, Home or End for the limits, and Enter to reset. Escape cancels a drag.</span>
            </div>
            <aside class="preview-pane" data-setup-section="feedback" data-reviewed="false" aria-labelledby="preview-title">
              <header class="preview-header">
                <div><h2 id="preview-title" tabindex="-1">Flubber &amp; Controls</h2><p>Mode selection is preview-only.</p><span class="sr-only" data-section-review-label="feedback">Not reviewed</span></div>
                <div class="preview-segmented-control preview-feedback-modes" role="group" aria-label="Feedback preview mode; selection is not saved">
                  <button type="button" data-feedback-preview-mode="flubber" aria-pressed="true">Flubber</button>
                  <button type="button" data-feedback-preview-mode="grid" aria-pressed="false">2D Grid</button>
                  <button type="button" data-feedback-preview-mode="face" aria-pressed="false">Face</button>
                </div>
              </header>
              ${previewMarkup("Interactive live feedback settings preview", { studio: true })}
            </aside>
          </form>
        </section>
        <section class="run-mode" data-mode-panel="run" aria-label="Running the Experiment" hidden>
          <header class="run-header">
            <div class="run-identity"><strong id="run-participant">Participant —</strong><p id="run-session">Session not started</p></div>
            <div class="run-actions"><button id="run-pause" type="button" aria-pressed="false" hidden disabled>Pause</button><button id="run-stop-early" type="button" class="danger-action">Stop Early</button></div>
          </header>
          <section id="run-questionnaire-stage" class="run-questionnaire-stage" aria-labelledby="run-questionnaire-title" hidden>
            <header class="questionnaire-run-header">
              <div><p id="run-questionnaire-kicker" class="context-label">Questionnaire</p><h2 id="run-questionnaire-title">Form not started</h2></div>
              <p id="run-questionnaire-progress" role="status" aria-live="polite">0 of 0 answered</p>
            </header>
            <p id="run-questionnaire-instructions" class="questionnaire-instructions"></p>
            <form id="run-questionnaire-form" novalidate>
              <div id="run-questionnaire-items" class="questionnaire-items"></div>
              <p id="run-questionnaire-error" class="field-error" role="alert" hidden>Answer every required item before submitting.</p>
              <div class="questionnaire-navigation">
                <button id="run-questionnaire-previous" type="button">Previous</button>
                <button id="run-questionnaire-next" type="button">Next</button>
                <button id="run-questionnaire-submit" type="button" class="primary-action" hidden>Submit questionnaire</button>
              </div>
            </form>
          </section>
          <div class="run-stage">
            <section class="stimulus-stage" aria-label="Current complete stimulus">
              <div id="run-native-video-host" class="native-video-host" aria-label="Protocol-controlled native GstPlay stimulus surface" hidden></div>
              <video id="run-video" preload="metadata" playsinline aria-label="Protocol-controlled current stimulus video"></video>
              <p id="run-stimulus-placeholder" class="stimulus-placeholder">The preflighted complete video appears here after the run authority starts the attempt.</p>
              <div id="run-youtube-player" class="youtube-player-host run-youtube-player" aria-label="Experimental YouTube stimulus player" hidden></div>
            </section>
            <aside class="run-feedback-stage" aria-label="Configured adjacent visual feedback">
              ${previewMarkup("Run Grid and Flubber feedback")}
              <p id="run-feedback-placeholder" class="run-feedback-placeholder" hidden>Visual feedback is hidden by the protocol. Sampling continues.</p>
            </aside>
          </div>
          <footer class="run-footer">
            <div class="run-status-strip" aria-label="Session status">
              <p>Stimulus <span id="run-stimulus-status">Waiting</span></p><span class="status-separator" aria-hidden="true">|</span>
              <p>Timing <span id="run-timing-status">Stopped</span></p><span class="status-separator" aria-hidden="true">|</span>
              <p>Write / recovery <span id="run-write-status">Journal pending</span></p><span class="status-separator" aria-hidden="true">|</span>
              <p>LSL <span id="run-lsl-status">Off</span></p>
            </div>
            <p>Valence <span data-preview-x>+0.000</span> · Arousal <span data-preview-y>+0.000</span></p>
          </footer>
          <section id="run-transition" class="run-transition" hidden aria-live="polite">
            <h2>Between videos</h2>
            <p id="run-transition-message">Sampling is stopped and the rating is neutral.</p>
            <button id="run-continue" type="button" class="primary-action" hidden>Continue when ready</button>
          </section>
        </section>
      </main>
    </div>
    <input id="settings-file-input" type="file" accept="application/json,.json" hidden>
    <input id="experiment-file-input" type="file" accept="application/json,.json" hidden>
    <input id="video-file-input" type="file" accept="video/*" multiple hidden>
    <input id="video-folder-input" type="file" accept="video/*" webkitdirectory directory multiple hidden>
    ${stimulusInspirationMarkup()}
    <dialog id="binding-capture-dialog" aria-labelledby="binding-capture-title">
      <div class="dialog-content"><h2 id="binding-capture-title">Capture custom binding</h2><p id="binding-capture-instruction">Perform one keyboard, mouse, wheel, or gamepad action.</p><div id="binding-capture-receipt" class="capture-receipt" role="status" aria-live="polite">Waiting for an input edge…</div></div>
      <div class="dialog-actions"><button id="binding-capture-cancel" type="button">Cancel</button></div>
    </dialog>
    <dialog id="preview-color-dialog" aria-labelledby="preview-color-dialog-title" aria-describedby="preview-color-status">
      <div class="dialog-content">
        <h2 id="preview-color-dialog-title">Choose an affect color</h2>
        <div class="field-grid">
          <div id="preview-color-picker" class="field">
            <span>Color map</span>
            <canvas data-inline-color-map width="320" height="210" tabindex="0" role="group" aria-label="Color map"></canvas>
            <label class="field"><span>Hue</span><canvas data-inline-hue-strip width="360" height="16" aria-hidden="true"></canvas><input id="preview-color-hue" data-inline-color-hue type="range" min="0" max="360" step="1" value="0"></label>
            <output data-inline-color-status class="field-help"></output>
          </div>
          <label class="field"><span>Hex code</span><input id="preview-color-hex" value="${DEFAULT_COLORS.up}" minlength="7" maxlength="7" pattern="#[0-9A-Fa-f]{6}" required spellcheck="false" aria-describedby="preview-color-status"></label>
          <label class="field preview-color-label-field"><span>Custom axis label <span class="field-help">(optional)</span></span><input id="preview-color-label" maxlength="48" placeholder="High arousal" autocomplete="off" spellcheck="false" aria-describedby="preview-color-label-help"></label>
        </div>
        <p id="preview-color-label-help" class="field-help">Display alias for this setup session only. The saved valence/arousal axis identity does not change.</p>
        <p id="preview-color-status" class="status-text" role="status" aria-live="polite">Editing the selected directional anchor.</p>
        <p id="preview-color-error" class="field-error" role="alert" hidden>Enter a six-digit hexadecimal color.</p>
      </div>
      <div class="dialog-actions"><button id="preview-color-reset" type="button">Reset</button><button id="preview-color-cancel" type="button">Cancel</button><button id="preview-color-apply" type="button" class="primary-action">Apply color</button></div>
    </dialog>
    <dialog id="stop-early-dialog" aria-labelledby="stop-early-title">
      <div class="dialog-content"><h2 id="stop-early-title">Stop this attempt early?</h2><p>A controlled stop finalizes an explicitly partial result and cannot be resumed. Accepted samples and events are retained. Only an interrupted, recoverable attempt restarts its current video from the beginning.</p></div>
      <div class="dialog-actions"><button id="stop-early-cancel" type="button">Keep running</button><button id="stop-early-confirm" type="button" class="danger-action">Finalize partial result</button></div>
    </dialog>
    <dialog id="completion-dialog" aria-labelledby="completion-title">
      <div class="dialog-content"><h2 id="completion-title">Attempt receipt</h2><ul id="completion-receipt" class="receipt-list"></ul></div>
      <div class="dialog-actions"><button id="completion-return" type="button" class="primary-action">Return to Setup</button></div>
    </dialog>
    <dialog id="import-report-dialog" aria-labelledby="import-report-title">
      <div class="dialog-content"><h2 id="import-report-title">Legacy import report</h2><p>Every mapped, defaulted, and discarded field is listed. Storage was not migrated.</p><div class="table-scroll"><table><thead><tr><th>Status</th><th>Source</th><th>Research target</th><th>Decision</th></tr></thead><tbody id="import-report-body"></tbody></table></div></div>
      <div class="dialog-actions"><button id="import-report-close" type="button" class="primary-action">Close report</button></div>
    </dialog>
    <dialog id="participant-language-dialog" aria-labelledby="participant-language-title" aria-describedby="participant-language-context participant-language-error">
      <div class="dialog-content participant-language-dialog-content">
        <p id="participant-language-context" class="context-label">Participant P001 · new attempt</p>
        <h2 id="participant-language-title">Choose a language</h2>
        <p id="participant-language-breadcrumb" class="field-help">Start of language selection</p>
        <fieldset class="participant-language-fieldset">
          <legend id="participant-language-prompt">Choose a language</legend>
          <div id="participant-language-options" class="participant-language-options"></div>
        </fieldset>
        <p id="participant-language-error" class="field-error" role="alert" hidden></p>
      </div>
      <div class="dialog-actions participant-language-actions"><button id="participant-language-back" type="button" hidden>Back</button><button id="participant-language-cancel" type="button">Cancel</button></div>
    </dialog>
    <div id="research-announcer" class="sr-only" aria-live="polite" aria-atomic="true"></div>`;
}
