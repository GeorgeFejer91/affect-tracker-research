import { runnerMarkup } from "./view.js";
import { readRunnerRecipe, resolveRunnerSelection, resolveLanguageSelectionTraversalStepV1, runnerFeedbackState } from "./recipe.js";
import { NativePackageProtocolAdapter } from "../../site/src/research/native-package-protocol.js";
import { NativeMediaController } from "../../site/src/research/native-media-controller.js";
import { attestNativeGstCatalogue } from "../../site/src/research/native-media-catalogue.js";
import { nativeInputRegionRequest } from "../../site/src/research/input-region.js";
import { createResearchPreview } from "../../site/src/research/preview.js";
import { deriveParticipantRecord } from "../../site/src/research/identity.js";
import { validateQuestionnaireAnswers } from "../../site/src/research/questionnaires.js";

const messageOf = (error) => error?.message ?? String(error);

export async function bootRunner(root, { invoke, windowObject = window, pollMs = 250 } = {}) {
  if (!(root instanceof HTMLElement) || typeof invoke !== "function") throw new TypeError("Runner needs its root and native adapter.");
  root.innerHTML = runnerMarkup(); root.setAttribute("aria-busy", "false");
  const identity = await invoke("research_desktop_identity");
  if (identity?.schema !== "affect-research-desktop-identity" || identity.version !== 1 || identity.program !== "runner") throw new Error("Open this interface with the Experiment Runner executable.");
  const query = (id) => root.querySelector(`#${id}`);
  const text = (id, value) => { query(id).textContent = value; };
  const value = (id) => query(id).value;
  const listeners = [];
  const listen = (element, event, fn) => { element.addEventListener(event, fn); listeners.push(() => element.removeEventListener(event, fn)); };
  let recipe = null, workspace = null, selection = null, path = [], inputReceipt = null;
  let preflight = null, revision = 0, regionEpoch = 0, destroyed = false, busy = false;
  let capability = null, mediaCapability = null, discovery = null, recorder = null, questionnaire = null;
  let queue = Promise.resolve(), polling = false, timer = null;
  const preview = createResearchPreview(root.querySelector(".research-preview-stage"), { initialState: { hideFeedback: true, lockPosition: true } });
  const media = new NativeMediaController({ invoke });
  const setRegion = (element, purpose) => invoke("research_input_set_region", { region: nativeInputRegionRequest(element, purpose, ++regionEpoch, windowObject) });
  const protocol = new NativePackageProtocolAdapter(root, {
    invoke, dispatch: project,
    prepareRunInput: async () => {
      const status = await setRegion(root.querySelector(".run-feedback-stage"), "runFeedback");
      if (!status.runReady) throw new Error("The participant feedback input region is unavailable.");
    },
    onRunActivated: () => { inputReceipt = null; renderControls(); },
    onRunReleased: () => { preflight = null; renderControls(); },
    onRunTerminal: async () => {
      if (recorder?.active) recorder = await invoke("research_recorder_stop");
      renderRecorder();
    },
  });
  // A terminal native status returns to preparation in this same Runner app.
  root.researchUi = { setMode: () => renderControls() };

  function fail(error) { text("runner-error", messageOf(error)); query("runner-error").hidden = false; }
  function action(operation) {
    queue = queue.then(async () => {
      if (destroyed) return;
      busy = true; query("runner-error").hidden = true; renderControls();
      try { await operation(); } catch (error) { if (!destroyed) fail(error); }
      finally { busy = false; if (!destroyed) renderControls(); }
    });
    return queue;
  }
  function invalidate() {
    revision += 1; preflight = null; selection = null; inputReceipt = null;
    text("runner-preflight", "Check the current participant, language and media before starting."); renderControls();
  }
  function destroy() {
    destroyed = true; revision += 1; windowObject.clearInterval(timer);
    listeners.forEach((remove) => remove()); protocol.destroy(); preview.destroy(); delete root.researchUi;
  }
  function renderControls() {
    const locked = busy || protocol.active || recorder?.active === true;
    for (const id of ["runner-open", "runner-folder", "runner-participant", "runner-attempt", "runner-language-reset", "runner-record-own", "runner-discover"]) query(id).disabled = locked;
    root.querySelectorAll("[data-language-option], [data-stream-key]").forEach((element) => { element.disabled = locked; });
    query("runner-language-reset").disabled ||= !recipe;
    query("runner-check").disabled = busy || protocol.active || !recipe || !workspace?.selected || !value("runner-participant") || !path.length;
    query("runner-test").disabled = busy || protocol.active || !selection || !preflight;
    const finalization = value("runner-attempt") === "finalize";
    query("runner-start").textContent = finalization ? "Finalize pending output" : "Start experiment";
    query("runner-start").disabled = busy || protocol.active || !selection || !preflight
      || (!finalization && (!capability?.nativeStartReady || !preflight.nativeStartReady || !inputReceipt));
    query("runner-stop").disabled = busy || !protocol.active;
    query("runner-record-start").disabled = busy || protocol.active || recorder?.active === true || !recipe || recorder?.available !== true;
    query("runner-record-stop").disabled = busy || recorder?.active !== true || protocol.active;
    query("runner-demographics").hidden = value("runner-attempt") !== "new-attempt";
  }
  function renderLanguage() {
    const host = query("runner-language"); host.replaceChildren();
    if (!recipe) return;
    const step = resolveLanguageSelectionTraversalStepV1(recipe.package.languageSelection, path);
    const prompt = document.createElement("p"); prompt.textContent = step.kind === "terminal" ? step.labels.join(" → ") : step.prompt; host.append(prompt);
    if (step.kind === "choice") for (const option of step.options) {
      const button = document.createElement("button"); button.type = "button"; button.dataset.languageOption = option.optionId; button.textContent = option.label;
      button.addEventListener("click", () => { if (busy || protocol.active || recorder?.active) return; path = [...path, option.optionId]; invalidate(); renderLanguage(); }); host.append(button);
    }
    renderControls();
  }
  async function adoptRecipe(bytes) {
    if (protocol.active || recorder?.active) throw new Error("Stop the current session and recorder before changing recipe.");
    const generation = ++revision;
    // Withdraw old readiness before parsing; a rejected new file cannot leave Start armed.
    selection = null; preflight = null; inputReceipt = null; renderControls();
    const candidate = await readRunnerRecipe(bytes);
    if (destroyed || generation !== revision) return false;
    recipe = candidate; path = [];
    text("runner-recipe-status", `${candidate.package.settings.experiment.title} · package v1`);
    const details = query("runner-recipe-details"); details.replaceChildren();
    for (const [label, detail] of [
      ["Package", candidate.package.packageId], ["SHA-256", candidate.canonicalSourceByteSha256],
      ["Videos", candidate.package.assets.stimuli.length], ["Sampling", `${candidate.package.settings.experiment.samplingFrequencyHz} Hz`],
      ["Layout", "Saved v1 normalized placement · adjacent feedback"],
    ]) { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = detail; details.append(dt, dd); }
    preview.update(runnerFeedbackState(candidate.package.settings));
    renderLanguage(); renderControls(); return true;
  }
  async function checkSession() {
    if (!recipe || !workspace?.selected) throw new Error("Open a recipe and select its project folder.");
    const generation = revision, currentRecipe = recipe, currentWorkspace = workspace;
    preflight = null; inputReceipt = null;
    const candidate = await resolveRunnerSelection(currentRecipe, value("runner-participant"), path);
    const listing = await protocol.refreshRecoveries(currentWorkspace.workspaceId, currentRecipe.canonicalSourceText);
    if (destroyed || generation !== revision) return;
    if (value("runner-attempt") === "finalize") {
      const recovery = listing.recoveries.find((item) => item.participantId === candidate.detail.participantId && item.finalizationPending);
      if (!recovery) throw new Error("No pending finalization exists for this participant and package.");
      selection = candidate; preflight = { nativeStartReady: false };
      text("runner-preflight", "Pending output can be finalized without starting acquisition."); return;
    }
    text("runner-preflight", "Verifying complete video files and native decode…");
    const scan = await invoke("research_rescan_package_stimuli", { workspaceId: currentWorkspace.workspaceId, sourceText: currentRecipe.canonicalSourceText });
    if (destroyed || generation !== revision) return;
    if (scan.workspaceId !== currentWorkspace.workspaceId) throw new Error("Media scan belongs to a different project folder.");
    if (!mediaCapability?.playerActorReady) throw new Error("Native video inspection is unavailable in this build. The recipe remains loaded.");
    const attested = await attestNativeGstCatalogue({ controller: media, workspaceId: currentWorkspace.workspaceId, stimuli: scan.stimuli, viewportHost: query("runner-stage") });
    if (attested.failures.length) throw new Error(`${attested.failures.length} video files could not be verified by the native decoder.`);
    const checked = await protocol.preflight(currentWorkspace.workspaceId, currentRecipe.canonicalSourceText, candidate.detail);
    if (destroyed || generation !== revision) return;
    selection = candidate; preflight = checked;
    text("runner-preflight", checked.nativeStartReady ? "Media and protocol verified. Test the configured input before Start." : "Recipe and media verified. Native playback qualification is still incomplete.");
  }
  function project(type, detail) {
    if (destroyed) return;
    if (type.endsWith(":run-started")) {
      text("runner-session", `${detail.participantId} · attempt ${detail.attemptNumber}`); query("runner-receipt").hidden = true;
      query("runner-test-region").hidden = true; query("runner-feedback-label").hidden = true;
    } else if (type.endsWith(":run-status")) {
      text("runner-stimulus", detail.transitionActive ? detail.transitionMessage : detail.stimulus);
      text("runner-timing", detail.timing); text("runner-write", detail.write); text("runner-lsl", detail.lsl ?? "LSL status unavailable");
      query("runner-pause").disabled = !detail.pauseAvailable; query("runner-pause").textContent = detail.paused ? "Resume" : "Pause";
      if (selection && Number.isFinite(detail.x) && Number.isFinite(detail.y)) preview.update(runnerFeedbackState(selection.compiled.settings, detail.x, detail.y));
    } else if (type.endsWith(":questionnaire-status")) renderQuestionnaire(detail);
    else if (type.endsWith(":run-complete")) {
      text("runner-session", `${detail.participant} · ${detail.status}`);
      text("runner-receipt", `Attempt ${detail.attempt}\nReceipt ${detail.receipt}\nFiles: ${detail.files}`); query("runner-receipt").hidden = false;
      if (recipe) preview.update(runnerFeedbackState(recipe.package.settings));
      query("runner-pause").disabled = true; renderQuestionnaire({ active: false });
    }
    renderControls();
  }
  function renderQuestionnaire(detail) {
    query("runner-questionnaire").hidden = detail.active === false; query("runner-stage").hidden = detail.active !== false;
    if (detail.active === false) { questionnaire = null; return; }
    const definitions = selection?.compiled.settings.questionnaires.definitions;
    const definition = definitions?.find((item) => item.questionnaireId === detail.questionnaireId);
    if (!definition) throw new Error("The native questionnaire is absent from the frozen recipe.");
    validateQuestionnaireAnswers(definition, detail.answers, { allowPartial: true });
    if (questionnaire?.position === detail.protocolStepPosition) return; // Preserve local focus and newer pending choices.
    questionnaire = { definition, position: detail.protocolStepPosition, answers: { ...detail.answers }, itemIndex: 0 };
    renderQuestionnaireItem();
  }
  function renderQuestionnaireItem() {
    const { definition, itemIndex } = questionnaire;
    text("runner-questionnaire-title", definition.title); text("runner-questionnaire-instructions", definition.instructions);
    text("runner-questionnaire-progress", `Item ${itemIndex + 1} of ${definition.items.length}`);
    const host = query("runner-questionnaire-items"); host.replaceChildren();
    for (const item of [definition.items[itemIndex]]) {
      const fieldset = document.createElement("fieldset"), legend = document.createElement("legend"); legend.textContent = `${item.order}. ${item.prompt}${item.required ? " (required)" : ""}`; fieldset.append(legend);
      for (const option of item.options) {
        const label = document.createElement("label"), input = document.createElement("input"), span = document.createElement("span");
        input.type = "radio"; input.name = `answer-${item.itemId}`; input.value = option.optionId; input.dataset.answerItem = item.itemId; input.checked = questionnaire.answers[item.itemId] === option.optionId;
        span.textContent = option.label; label.append(input, span); fieldset.append(label);
      } host.append(fieldset);
    }
    query("runner-questionnaire-previous").disabled = itemIndex === 0;
    query("runner-questionnaire-next").hidden = itemIndex === definition.items.length - 1;
    query("runner-questionnaire-submit").hidden = itemIndex !== definition.items.length - 1;
    host.querySelector("input:checked, input")?.focus();
  }
  function renderRecorder() {
    if (!recorder) return;
    text("runner-record-status", recorder.available === false ? "This build does not include LSL recording." : `${recorder.phase} · ${recorder.sampleCount ?? 0} samples${recorder.fileName ? ` · ${recorder.fileName}` : ""}${recorder.error ? ` · ${recorder.error}` : ""}`);
    renderControls();
  }
  listen(query("runner-open"), "click", () => action(async () => {
    const receipt = await invoke("research_load_experiment_package"); if (!receipt) return;
    await adoptRecipe(new TextEncoder().encode(receipt.canonicalSourceText));
    if (recipe?.canonicalSourceByteSha256 !== receipt.canonicalSourceByteSha256) { invalidate(); recipe = null; throw new Error("Native and frontend package bytes disagree."); }
  }));
  listen(query("runner-folder"), "click", () => action(async () => { invalidate(); workspace = await invoke("research_choose_workspace"); text("runner-workspace-status", workspace.selected ? workspace.displayName : "No project folder selected."); }));
  listen(query("runner-language-reset"), "click", () => { path = []; invalidate(); renderLanguage(); });
  listen(query("runner-participant"), "input", invalidate);
  listen(query("runner-attempt"), "change", invalidate);
  listen(query("runner-check"), "click", () => action(checkSession));
  listen(query("runner-test"), "click", () => action(async () => {
    query("runner-test-region").hidden = false; query("runner-test-region").scrollIntoView({ block: "center" }); query("runner-test-region").focus();
    await setRegion(query("runner-test-region"), "setupTest"); await invoke("research_input_begin_test", { binding: selection.compiled.settings.input });
  }));
  listen(query("runner-start"), "click", () => action(async () => {
    if (!selection || !preflight) throw new Error("Check the current selection first.");
    const disposition = value("runner-attempt");
    const participant = disposition === "new-attempt" ? deriveParticipantRecord({ firstName: value("runner-first"), lastName: value("runner-last"), age: Number(value("runner-age")), gender: value("runner-gender"), handedness: value("runner-hand") }) : null;
    query("runner-first").value = ""; query("runner-last").value = "";
    await protocol.start({ ...selection.detail, participant, inputTestReceiptId: inputReceipt?.receiptId,
      attemptDisposition: disposition, recoveryFinalizationOnly: disposition === "finalize", rerunConfirmed: query("runner-rerun").checked }, workspace.workspaceId);
  }));
  listen(query("runner-pause"), "click", () => action(() => protocol.togglePause()));
  listen(query("runner-stop"), "click", () => query("runner-stop-dialog").showModal());
  listen(query("runner-stop-cancel"), "click", () => query("runner-stop-dialog").close());
  listen(query("runner-stop-confirm"), "click", () => { query("runner-stop-dialog").close(); action(() => protocol.finish("stopEarly")); });
  listen(query("runner-questionnaire-form"), "change", (event) => {
    if (!questionnaire || !event.target.dataset.answerItem) return;
    questionnaire.answers[event.target.dataset.answerItem] = event.target.value;
    const detail = { protocolStepPosition: questionnaire.position, answers: { ...questionnaire.answers } };
    action(() => protocol.questionnaireDraft(detail));
  });
  listen(query("runner-questionnaire-form"), "submit", (event) => { event.preventDefault(); action(async () => {
    if (!questionnaire) return; validateQuestionnaireAnswers(questionnaire.definition, questionnaire.answers);
    await protocol.questionnaireSubmit({ protocolStepPosition: questionnaire.position, answers: { ...questionnaire.answers } });
  }); });
  listen(query("runner-questionnaire-previous"), "click", () => {
    if (questionnaire && !busy) { questionnaire.itemIndex = Math.max(0, questionnaire.itemIndex - 1); renderQuestionnaireItem(); }
  });
  listen(query("runner-questionnaire-next"), "click", () => {
    if (!questionnaire || busy) return;
    const item = questionnaire.definition.items[questionnaire.itemIndex];
    if (item.required && !Object.hasOwn(questionnaire.answers, item.itemId)) { fail(new Error("Choose a response before continuing.")); return; }
    questionnaire.itemIndex = Math.min(questionnaire.definition.items.length - 1, questionnaire.itemIndex + 1); renderQuestionnaireItem();
  });
  listen(query("runner-discover"), "click", () => action(async () => {
    discovery = await invoke("research_recorder_discover"); const host = query("runner-streams"); host.replaceChildren();
    for (const stream of discovery.streams) {
      const label = document.createElement("label"), input = document.createElement("input"), span = document.createElement("span"); label.className = "check-field"; input.type = "checkbox"; input.dataset.streamKey = stream.key;
      span.textContent = `${stream.name} · ${stream.streamType} · ${stream.channelCount} channels · ${stream.hostname}`; label.append(input, span); host.append(label);
    }
    if (!discovery.streams.length) host.textContent = "No external streams found. Start the source application, then search again.";
  }));
  listen(query("runner-record-start"), "click", () => action(async () => {
    const result = await invoke("research_recorder_start", { request: { experimentPackageSourceText: recipe.canonicalSourceText,
      recordOwn: query("runner-record-own").checked, discoveryRevision: discovery?.revision ?? null,
      streamKeys: [...root.querySelectorAll("[data-stream-key]:checked")].map((item) => item.dataset.streamKey) } });
    if (result) recorder = result; renderRecorder();
  }));
  listen(query("runner-record-stop"), "click", () => action(async () => { recorder = await invoke("research_recorder_stop"); renderRecorder(); }));
  listen(windowObject, "resize", () => action(async () => {
    if (protocol.active) { await setRegion(root.querySelector(".run-feedback-stage"), "runFeedback"); await protocol.resize(); }
    else { inputReceipt = null; await invoke("research_input_cancel_setup"); }
  }));
  listen(root.querySelector(".runner-sidebar"), "scroll", () => {
    if (busy || protocol.active || !selection || query("runner-test-region").hidden) return;
    revision += 1; inputReceipt = null;
    action(async () => { await invoke("research_input_cancel_setup"); text("runner-input-status", "The test region moved. Test the configured input again."); });
  });
  try {
    [capability, mediaCapability, workspace] = await Promise.all([protocol.initialize(), invoke("research_native_media_capability"), invoke("research_workspace_status")]);
  } catch (error) { destroy(); throw error; }
  text("runner-capability", capability.nativeStartReady ? "Native execution available" : `Native playback not qualified · ${capability.reasonCode}`);
  text("runner-workspace-status", workspace?.selected ? workspace.displayName : "No project folder selected.");
  try { recorder = await invoke("research_recorder_status"); renderRecorder(); } catch { text("runner-record-status", "Recorder is not included in this build."); }
  timer = windowObject.setInterval(async () => {
    if (destroyed || polling || busy) return; polling = true;
    try {
      if (!protocol.active && selection && !query("runner-test-region").hidden) {
        const generation = revision;
        const status = await invoke("research_input_status");
        if (destroyed || generation !== revision) return;
        inputReceipt = status.receipt; text("runner-input-status", inputReceipt ? "All directions tested. Input ready." : `Remaining: ${status.remainingDirections.join(", ")}`);
      }
      if (recorder?.available) { recorder = await invoke("research_recorder_status"); if (!destroyed) renderRecorder(); }
    } catch (error) { if (!destroyed) { inputReceipt = null; fail(error); } }
    finally { polling = false; if (!destroyed) renderControls(); }
  }, pollMs);
  renderControls();
  const controller = Object.freeze({ adoptRecipe, get recipe() { return recipe; }, get selection() { return selection; },
    destroy,
  });
  root.runner = controller; return controller;
}
