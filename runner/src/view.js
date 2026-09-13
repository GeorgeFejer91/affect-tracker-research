import { previewOverlayMarkup } from "../../site/src/research/feedback-surface.js";
const professorQr = new URL("../assets/professor-qr.svg", import.meta.url).href;
const controllerQr = new URL("../assets/controller-qr.svg", import.meta.url).href;
const professorWidget = new URL("../assets/professor-widget.svg", import.meta.url).href;
const inputWidget = new URL("../assets/input-widget.svg", import.meta.url).href;
const remoteWidget = new URL("../assets/remote-widget.svg", import.meta.url).href;
const symbol = new URL("../assets/runner-symbol.svg", import.meta.url).href;

export function runnerMarkup() {
  return `<div class="runner-shell">
    <main id="runner-launcher" class="runner-launcher">
      <header class="runner-header"><img src="${symbol}" width="36" height="36" alt=""><h1>Experiment Runner</h1></header>
      <div class="runner-load-actions"><button id="runner-open">Load experiment file</button><button id="runner-load-previous" disabled>Load previous experiment</button></div>
      <p id="runner-recipe-status" role="status">No experiment loaded</p>
      <label id="runner-variant-field" class="field" hidden>Experiment variant<select id="runner-variant"><option value="">Choose variant…</option></select></label>
      <div class="runner-participant-picker">
        <label for="runner-participant">Participant number</label>
        <div class="runner-participant-row"><div class="runner-combobox">
          <div class="runner-number-input"><input id="runner-participant" role="combobox" aria-autocomplete="none" aria-expanded="false" aria-controls="runner-participant-list" aria-describedby="runner-participant-status" placeholder="P01" maxlength="7" autocomplete="off" spellcheck="false"><button id="runner-participant-arrow" aria-label="Choose participant number" aria-expanded="false" aria-controls="runner-participant-list">▾</button></div>
          <div id="runner-participant-list" role="listbox" aria-label="Participant numbers" hidden></div>
        </div><button id="runner-sequence-preview" aria-haspopup="dialog" disabled>Preview sequence</button></div>
        <p id="runner-participant-status" role="status">Load an experiment first.</p>
      </div>
      <button id="runner-launch" class="primary-action runner-launch-action" disabled><img src="${symbol}" width="64" height="64" alt=""><span>Start experiment</span></button>
      <div class="runner-tools">
        <button id="runner-professor" aria-haspopup="dialog"><img src="${professorWidget}" width="64" height="64" alt=""><span>Absent-minded professor</span></button>
        <button id="runner-controller" aria-haspopup="dialog"><img src="${inputWidget}" width="64" height="64" alt=""><span>Set controller</span></button>
        <button id="runner-remote" aria-haspopup="dialog"><img src="${remoteWidget}" width="64" height="64" alt=""><span>Remote controller connection</span></button>
      </div>
      <button id="runner-settings" class="runner-text-button" aria-haspopup="dialog">Session &amp; recording settings</button>
      <p id="runner-launch-status" role="status"></p>
      <pre id="runner-receipt" hidden></pre>
    </main>
    <main id="runner-participant-view" class="runner-presentation" hidden>
      <section id="runner-preparation" class="runner-participant-page" aria-labelledby="runner-preparation-title">
        <div id="runner-participant-details">
          <h1 id="runner-preparation-title" tabindex="-1">Participant details</h1>
          <p id="runner-selected-participant"></p>
          <div id="runner-language"><p>Load an experiment to choose your language.</p></div>
          <button id="runner-language-reset" class="runner-text-button" disabled>Change language</button>
          <fieldset id="runner-demographics"><legend>About you</legend><div class="runner-fields">
            <label class="field">First name<input id="runner-first" maxlength="120" autocomplete="off"></label>
            <label class="field">Last name<input id="runner-last" maxlength="120" autocomplete="off"></label>
            <label class="field">Age<input id="runner-age" type="number" min="1" max="120" step="1"></label>
            <label class="field">Gender<select id="runner-gender"><option value="">Choose…</option><option value="W">Woman</option><option value="M">Man</option><option value="N">Non-binary</option><option value="S">Self-described</option><option value="X">Prefer not to say</option></select></label>
            <label class="field">Handedness<select id="runner-hand"><option value="">Choose…</option><option value="L">Left</option><option value="R">Right</option><option value="A">Ambidextrous</option></select></label>
          </div><p>Names are used to derive a two-character participant code, then cleared before acquisition.</p></fieldset>
          <button id="runner-prepare" class="primary-action">Continue</button>
        </div>
        <button id="runner-back" class="runner-text-button">Back to launcher</button><button id="runner-preparation-settings" class="runner-text-button">Session settings</button>
      </section>
      <section id="runner-stage" class="run-stage" hidden><section class="stimulus-stage" aria-label="Video"><div id="run-native-video-host" class="native-video-host" hidden></div><p id="run-stimulus-placeholder"></p></section>
        <aside class="run-feedback-stage" aria-label="Recipe feedback"><div class="research-preview-stage" data-preview-variant="run">${previewOverlayMarkup()}</div><p id="runner-feedback-label" hidden>Feedback follows the recipe</p></aside></section>
      <section id="runner-questionnaire" class="runner-participant-page" hidden><h2 id="runner-questionnaire-title"></h2><p id="runner-questionnaire-instructions"></p><p id="runner-questionnaire-progress"></p><p id="runner-questionnaire-keyboard"></p><form id="runner-questionnaire-form" aria-describedby="runner-questionnaire-keyboard"><div id="runner-questionnaire-items"></div><div class="button-row"><button type="button" id="runner-questionnaire-previous">Previous</button><button type="button" id="runner-questionnaire-next">Next</button><button type="submit" id="runner-questionnaire-submit" class="primary-action">Submit responses</button></div></form></section>
      <button id="runner-session-menu" class="runner-session-menu" aria-haspopup="dialog" hidden>Session controls</button>
    </main>
    <div id="runner-error-host"><p id="runner-error" role="alert" hidden></p></div>
    <dialog id="runner-sequence-dialog" class="runner-dialog" aria-labelledby="runner-sequence-title"><header class="runner-dialog-header"><h2 id="runner-sequence-title">Experiment sequence</h2><button data-close-dialog="runner-sequence-dialog">Done</button></header><div id="runner-preview-language"></div><button id="runner-preview-language-reset" class="runner-text-button">Change language</button><p id="runner-sequence-status" role="status"></p><ol id="runner-sequence-timeline"></ol></dialog>
    <dialog id="runner-settings-dialog" class="runner-dialog runner-sidebar" aria-labelledby="runner-settings-title">
      <header class="runner-dialog-header"><h2 id="runner-settings-title">Session &amp; recording</h2><button data-close-dialog="runner-settings-dialog">Done</button></header>
      <section><h3>Experiment files</h3><button id="runner-folder">Choose project folder</button><p id="runner-workspace-status">No project folder selected.</p><p id="runner-output-directory"></p><details><summary>Experiment details</summary><dl id="runner-recipe-details"></dl></details></section>
      <section><h3>Readiness</h3><label class="check-field"><input id="runner-validation" type="checkbox"><span>Local validation session — recordings are permanently unqualified</span></label><output id="runner-capability" role="status">Checking native capabilities…</output><p id="runner-preflight" role="status">Checks run automatically before the first questionnaire.</p><button id="runner-check" disabled>Check media &amp; session</button><button id="runner-test" disabled>Test configured input</button><div id="runner-test-region" tabindex="0" role="group" aria-label="Test all four configured input directions" hidden><p id="runner-input-status" role="status">Focus here and test all four directions.</p></div></section><section><h3>Attempt</h3><label class="field">Action<select id="runner-attempt"><option value="new-attempt">New attempt</option><option value="resume-compatible">Resume interrupted attempt</option><option value="finalize">Finalize pending output</option></select></label><label class="check-field"><input id="runner-rerun" type="checkbox"><span>Confirm a new attempt for a completed participant</span></label></section>
      <section><h3>Stream recording</h3><label class="check-field"><input id="runner-record-own" type="checkbox" checked><span>Record this experiment's affect and marker streams</span></label><button id="runner-discover">Find external LSL streams</button><div id="runner-streams"><p>No stream discovery requested.</p></div><div class="button-row"><button id="runner-record-start" disabled>Record XDF in experiment folder</button><button id="runner-record-stop" disabled>Stop recording</button></div><p id="runner-record-status" role="status">Recorder stopped.</p></section>
    </dialog>
    <dialog id="runner-controller-dialog" class="runner-dialog" aria-labelledby="runner-controller-title"><header class="runner-dialog-header"><h2 id="runner-controller-title">Set controller</h2><button data-close-dialog="runner-controller-dialog">Done</button></header><p id="runner-controller-status">Load an experiment to see its configured input.</p><label class="field">Controller preset<select id="runner-controller-preset"></select></label><label class="field">Digital step size<input id="runner-controller-step" type="number" min="0.001" max="1" step="0.001" value="0.1"></label><div class="button-row"><button id="runner-controller-apply">Keep override draft</button><button id="runner-controller-reset">Use settings from file</button></div><p id="runner-controller-note" role="status"></p></dialog>
    <dialog id="runner-professor-dialog" class="runner-dialog" aria-labelledby="runner-professor-title"><header class="runner-dialog-header"><h2 id="runner-professor-title">Absent-minded professor</h2><button data-close-dialog="runner-professor-dialog">Done</button></header><p>Browser access to the whole Runner.</p><img class="runner-qr" src="${professorQr}" width="264" height="264" alt="Preview QR for the planned professor browser companion"><p class="runner-qr-status">Preview only — remote access is not connected yet.</p><p class="runner-qr-address">Reserved address, not live:<br>https://GeorgeFejer91.github.io/affect-tracker-research/runner/professor/</p></dialog>
    <dialog id="runner-remote-dialog" class="runner-dialog" aria-labelledby="runner-remote-title"><header class="runner-dialog-header"><h2 id="runner-remote-title">Remote controller connection</h2><button data-close-dialog="runner-remote-dialog">Done</button></header><p>A fullscreen 2D affect pad for your phone or tablet.</p><img class="runner-qr" src="${controllerQr}" width="264" height="264" alt="Preview QR for the planned phone and tablet affect controller"><p class="runner-qr-status">Preview only — the affect pad is not connected yet.</p><p class="runner-qr-address">Reserved address, not live:<br>https://GeorgeFejer91.github.io/affect-tracker-research/runner/controller/</p></dialog>
    <dialog id="runner-session-dialog" class="runner-dialog" aria-labelledby="runner-session-title"><header class="runner-dialog-header"><h2 id="runner-session-title">Session controls</h2><button data-close-dialog="runner-session-dialog">Return to experiment</button></header><p id="runner-session">No active session</p><div class="button-row"><button id="runner-pause" disabled>Pause</button><button id="runner-stop" disabled>Stop attempt</button></div><div class="runner-run-status"><p id="runner-stimulus">Waiting for a recipe</p><p id="runner-timing">Sampling stopped</p><p id="runner-write">No attempt records created</p><p id="runner-lsl">LSL output stopped</p></div></dialog>
    <dialog id="runner-stop-dialog" class="runner-dialog" aria-labelledby="runner-stop-title"><h2 id="runner-stop-title">Stop this attempt?</h2><p>This finalizes a partial result. A controlled stop cannot be resumed.</p><div class="button-row"><button id="runner-stop-cancel">Keep running</button><button id="runner-stop-confirm">Finalize partial result</button></div></dialog>
  </div>`;
}
