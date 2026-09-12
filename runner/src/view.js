import { previewOverlayMarkup } from "../../site/src/research/feedback-surface.js";
const symbol = new URL("../assets/runner-symbol.svg", import.meta.url).href;

export function runnerMarkup() {
  return `<div class="runner-shell">
    <header class="runner-header"><img src="${symbol}" width="42" height="42" alt=""><div><h1>Experiment Runner</h1><p>Desktop companion</p></div><output id="runner-capability" role="status">Checking native capabilities…</output></header>
    <main class="runner-workspace">
      <aside class="runner-sidebar" aria-label="Session preparation">
        <section><h2>Experiment</h2><div class="button-row"><button id="runner-open">Open recipe</button><button id="runner-folder">Choose project folder</button></div>
          <p id="runner-recipe-status">Open the JSON exported by Experiment Planner.</p><p id="runner-workspace-status">No project folder selected.</p>
          <details><summary>Recipe details</summary><dl id="runner-recipe-details"></dl></details>
        </section>
        <section><h2>Participant</h2><label class="field">Participant ID<input id="runner-participant" placeholder="P001" pattern="P[0-9]{3,6}" maxlength="7" autocomplete="off"></label>
          <div id="runner-language"><p>Open a recipe to choose the participant's language.</p></div>
          <button id="runner-language-reset" disabled>Change language</button>
          <label class="field">Attempt<select id="runner-attempt"><option value="new-attempt">New attempt</option><option value="resume-compatible">Resume interrupted attempt</option><option value="finalize">Finalize pending output</option></select></label>
          <label class="check-field"><input id="runner-rerun" type="checkbox"><span>Confirm a new attempt for a completed participant</span></label>
          <details id="runner-demographics"><summary>New participant details</summary><div class="runner-fields">
            <label class="field">First name<input id="runner-first" maxlength="120" autocomplete="off"></label><label class="field">Last name<input id="runner-last" maxlength="120" autocomplete="off"></label>
            <label class="field">Age<input id="runner-age" type="number" min="1" max="120" step="1"></label>
            <label class="field">Gender<select id="runner-gender"><option value="">Choose…</option><option value="W">Woman</option><option value="M">Man</option><option value="N">Non-binary</option><option value="S">Self-described</option><option value="X">Prefer not to say</option></select></label>
            <label class="field">Handedness<select id="runner-hand"><option value="">Choose…</option><option value="L">Left</option><option value="R">Right</option><option value="A">Ambidextrous</option></select></label>
          </div><p>Names are used only to derive the saved two-character code and are cleared before Start.</p></details>
          <button id="runner-check" disabled>Check media &amp; session</button><p id="runner-preflight" role="status">Choose a recipe, project folder, participant and language.</p>
          <button id="runner-test" disabled>Test configured input</button><div id="runner-test-region" tabindex="0" role="group" aria-label="Test all four configured input directions" hidden><p id="runner-input-status" role="status">Focus here and test all four directions.</p></div>
          <button id="runner-start" class="primary-action" disabled>Start experiment</button>
        </section>
        <section><h2>Stream recording</h2><p>Record to XDF. These choices belong to this Runner session.</p>
          <label class="check-field"><input id="runner-record-own" type="checkbox" checked><span>Record this experiment's affect and marker streams</span></label>
          <button id="runner-discover">Find external LSL streams</button><div id="runner-streams"><p>No stream discovery requested.</p></div>
          <div class="button-row"><button id="runner-record-start" disabled>Choose XDF file &amp; record</button><button id="runner-record-stop" disabled>Stop recording</button></div>
          <p id="runner-record-status" role="status">Recorder stopped.</p>
        </section>
      </aside>
      <section class="runner-presentation" aria-label="Experiment presentation">
        <header class="runner-session-bar"><p id="runner-session">No active session</p><div class="button-row"><button id="runner-pause" disabled>Pause</button><button id="runner-stop" disabled>Stop attempt</button></div></header>
        <div id="runner-stage" class="run-stage"><section class="stimulus-stage" aria-label="Video"><div id="run-native-video-host" class="native-video-host" hidden></div><p id="run-stimulus-placeholder">The experiment's video appears here when the session starts.</p></section>
          <aside class="run-feedback-stage" aria-label="Recipe feedback"><div class="research-preview-stage" data-preview-variant="run">${previewOverlayMarkup()}</div><p id="runner-feedback-label">Feedback follows the recipe</p></aside></div>
        <section id="runner-questionnaire" hidden><h2 id="runner-questionnaire-title"></h2><p id="runner-questionnaire-instructions"></p><p id="runner-questionnaire-progress"></p><form id="runner-questionnaire-form"><div id="runner-questionnaire-items"></div><div class="button-row"><button type="button" id="runner-questionnaire-previous">Previous</button><button type="button" id="runner-questionnaire-next">Next</button><button type="submit" id="runner-questionnaire-submit" class="primary-action">Submit responses</button></div></form></section>
        <footer class="runner-run-status"><p id="runner-stimulus">Waiting for a recipe</p><p id="runner-timing">Sampling stopped</p><p id="runner-write">No attempt records created</p><p id="runner-lsl">LSL output stopped</p></footer>
        <p id="runner-error" role="alert" hidden></p><pre id="runner-receipt" hidden></pre>
      </section>
    </main>
    <dialog id="runner-stop-dialog"><h2>Stop this attempt?</h2><p>This finalizes a partial result. A controlled stop cannot be resumed.</p><div class="button-row"><button id="runner-stop-cancel">Keep running</button><button id="runner-stop-confirm">Finalize partial result</button></div></dialog>
  </div>`;
}
