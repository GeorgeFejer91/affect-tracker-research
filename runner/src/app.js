import { runnerMarkup } from "./view.js";
import { readRunnerRecipe, resolveRunnerSelection, resolveLanguageSelectionTraversalStepV1, runnerFeedbackState, runnerLanguageTree, runnerInput, runnerMasterFeedbackState } from "./recipe.js";
import { NativePackageProtocolAdapter } from "../../site/src/research/native-package-protocol.js";
import { NativeMediaController } from "../../site/src/research/native-media-controller.js";
import { attestNativeGstCatalogue } from "../../site/src/research/native-media-catalogue.js";
import { nativeInputRegionRequest } from "../../site/src/research/input-region.js";
import { createResearchPreview } from "../../site/src/research/preview.js";
import { deriveParticipantRecord } from "../../site/src/research/identity.js";
import { validateQuestionnaireAnswers } from "../../site/src/research/questionnaires.js";
import { createRunnerPresentation } from "./presentation.js";
import { createRunnerControllerSettings } from "./controller-settings.js";
import { createParticipantPicker, participantLabel, participantTimeline } from "./participants.js";
import { assertMasterPlanParity, applyMasterDesktopLayout, clearMasterDesktopLayout, renderMasterQuestionnaire } from "./master-presentation.js";
import { NativeMasterProtocolAdapter } from "./master-protocol.js";
import { previewOverlayMarkup } from "../../site/src/research/feedback-surface.js";

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
  let queue = Promise.resolve(), retentionQueue = Promise.resolve(), polling = false, timer = null;
  let preview = createResearchPreview(root.querySelector(".research-preview-stage"), { initialState: { hideFeedback: true, lockPosition: true } });
  const media = new NativeMediaController({ invoke });
  const setRegion = (element, purpose) => invoke("research_input_set_region", { region: nativeInputRegionRequest(element, purpose, ++regionEpoch, windowObject) });
  const legacyProtocol = new NativePackageProtocolAdapter(root, {
    invoke, dispatch: project,
    prepareRunInput: async () => {
      const status = await setRegion(root.querySelector(".run-feedback-stage"), "runFeedback");
      if (!status.runReady) throw new Error("The participant feedback input region is unavailable.");
    },
    onRunActivated: () => { inputReceipt = null; presentation.showPage("run"); renderControls(); },
    onRunReleased: () => { preflight = null; renderControls(); },
    onRunTerminal: async () => {
      try {
        if (recorder?.active) recorder = await invoke("research_recorder_stop");
      } finally {
        renderRecorder();
        await presentation.leave();
        try { await refreshParticipantHistory(); } catch (error) { fail(error); }
      }
    },
  });
  let protocol = legacyProtocol;
  const masterProtocol = new NativeMasterProtocolAdapter({ invoke, windowObject, render: renderMaster, fail, terminal: async status => {
    preflight = null; inputReceipt = null; questionnaire = null;
    text("runner-receipt", status.result ? `Participant ${participantLabel(status.participantId)} · ${status.result.status}\n${status.result.outputDirectory}` : `Participant ${participantLabel(status.participantId)} · incomplete attempt\n${status.failureCode ?? "Native finalization unavailable"}`);
    query("runner-receipt").hidden = false;
    preview.update({hideFeedback:true}); clearMasterDesktopLayout(root);
    await presentation.leave(); await refreshParticipantHistory(); renderControls();
  } });
  const presentation = createRunnerPresentation(root, { invoke, windowObject, isActive: () => protocol.active });
  const controllerSettings = createRunnerControllerSettings(root, { onChange: () => invalidate() });
  const participantPicker = createParticipantPicker(root, { onChange: commit => {
    invalidate(); refreshTimeline();
    if (commit && participantPicker.participantId) retainParticipant().catch(fail);
  } });
  const participantId = () => {
    if (!participantPicker.participantId) throw new Error("Choose a participant number with a schedule in this JSON.");
    return participantPicker.participantId;
  };
  // A terminal native status returns to preparation in this same Runner app.
  root.researchUi = { setMode: () => renderControls() };

  function fail(error) {
    const dialog = [...root.querySelectorAll("dialog[open]")].at(-1);
    (dialog ?? query("runner-error-host")).append(query("runner-error"));
    text("runner-error", messageOf(error)); query("runner-error").hidden = false;
  }
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
    listeners.forEach((remove) => remove()); participantPicker.destroy(); controllerSettings.destroy(); legacyProtocol.destroy(); masterProtocol.destroy(); preview.destroy(); delete root.researchUi;
  }
  function renderControls() {
    const locked = busy || protocol.active || recorder?.active === true;
    for (const id of ["runner-open", "runner-folder", "runner-variant", "runner-attempt", "runner-record-own", "runner-discover"]) query(id).disabled = locked;
    root.querySelectorAll("[data-stream-key]").forEach(element => { element.disabled = locked; });
    // An armed recorder binds the recipe, then the attempt on activation. It
    // must not prevent the participant from completing the first form.
    query("runner-language-reset").disabled = busy || protocol.active;
    participantPicker.lock(busy || protocol.active || !recipe);
    root.querySelectorAll("[data-language-option]").forEach(element => { element.disabled = busy || protocol.active; });
    query("runner-language-reset").disabled ||= !recipe;
    query("runner-launch").disabled = busy || protocol.active || !recipe || !participantPicker.participantId;
    query("runner-launch").disabled ||= Boolean(recipe?.recipe && (!value("runner-variant") || recipe.recipe.presentationTarget !== "desktop-screen"));
    query("runner-sequence-preview").disabled = busy || protocol.active || !recipe || !participantPicker.participantId;
    query("runner-preview-language-reset").disabled = busy || protocol.active || !recipe;
    query("runner-prepare").disabled = busy || protocol.active || !recipe;
    for (const id of ["runner-professor", "runner-controller", "runner-remote", "runner-settings", "runner-preparation-settings", "runner-back"]) query(id).disabled = busy || protocol.active;
    query("runner-controller").disabled ||= recorder?.active === true;
    query("runner-check").disabled = busy || protocol.active || !recipe || !workspace?.selected || !value("runner-participant") || !path.length;
    query("runner-test").disabled = busy || protocol.active || !recipe || controllerSettings.overridden;
    query("runner-stop").disabled = busy || !protocol.active;
    query("runner-record-start").disabled = busy || protocol.active || recorder?.active === true || !recipe || !workspace?.selected || recorder?.available !== true;
    query("runner-record-stop").disabled = busy || recorder?.active !== true || protocol.active;
    query("runner-demographics").hidden = value("runner-attempt") !== "new-attempt";
  }
  function renderLanguage() {
    for (const id of ["runner-language", "runner-preview-language"]) {
    const host = query(id); host.replaceChildren();
    if (!recipe) return;
    const step = resolveLanguageSelectionTraversalStepV1(runnerLanguageTree(recipe), path);
    const prompt = document.createElement("p"); prompt.textContent = step.kind === "terminal" ? step.labels.join(" → ") : step.prompt; host.append(prompt);
    if (step.kind === "choice") for (const option of step.options) {
      const button = document.createElement("button"); button.type = "button"; button.dataset.languageOption = option.optionId; button.textContent = option.label;
      button.addEventListener("click", () => { if (busy || protocol.active) return; path = [...path, option.optionId]; invalidate(); renderLanguage(); refreshTimeline(); }); host.append(button);
    }
    }
    renderControls();
  }
  async function refreshTimeline() {
    const host = query("runner-sequence-timeline"); host.replaceChildren();
    if (!query("runner-sequence-dialog").open || !recipe) return;
    const generation = revision;
    text("runner-sequence-status", "Choose a language to preview the exact sequence.");
    if (resolveLanguageSelectionTraversalStepV1(runnerLanguageTree(recipe), path).kind !== "terminal") return;
    try {
      const timeline = await participantTimeline(recipe, participantId(), path, value("runner-variant"));
      if (destroyed || generation !== revision || !query("runner-sequence-dialog").open) return;
      text("runner-sequence-status", `${participantLabel(participantId())} · ${timeline.events.length} scheduled events. Demographics come first for a new attempt. Questionnaire durations depend on responses.`);
      for (const event of timeline.events) {
        const row = document.createElement("li"), title = document.createElement("strong"), detail = document.createElement("p");
        row.dataset.eventKind = event.kind; row.dataset.protocolPosition = event.protocolPosition;
        title.textContent = `${event.label} · ${event.title}`;
        detail.textContent = `${event.durationMs === null ? `${event.itemCount} items · Self-paced` : `${Number((event.durationMs / 1000).toFixed(3))} seconds`}${event.blockId ? ` · Block ${event.blockId}` : ""}${event.moduleId ? ` · ${event.moduleId}` : ""}`;
        row.append(title, detail); host.append(row);
      }
    } catch (error) { if (!destroyed && generation === revision) text("runner-sequence-status", messageOf(error)); }
  }
  async function selectionReceipt(id = null, currentRecipe = recipe, currentWorkspace = workspace) {
    if (!currentRecipe || !currentWorkspace?.selected) throw new Error("Select the experiment’s project folder to retain its participant number.");
    const result = await invoke("research_runner_selection", { workspaceId: currentWorkspace.workspaceId, sourceText: currentRecipe.canonicalSourceText, participantId: id });
    if (result?.schema !== "affect-runner-selection" || result.version !== 1 || result.packageSourceByteSha256 !== currentRecipe.canonicalSourceByteSha256 || (id !== null && result.participantId !== id)) throw new Error("Native participant receipt does not match this JSON and selection.");
    if (!destroyed && recipe === currentRecipe && workspace === currentWorkspace) text("runner-output-directory", `Experiment output folder: ${result.outputDirectory}`);
    return result;
  }
  function retainParticipant() {
    const id = participantId(), currentRecipe = recipe, currentWorkspace = workspace;
    retentionQueue = retentionQueue.catch(() => {}).then(() => destroyed ? null : selectionReceipt(id, currentRecipe, currentWorkspace));
    return retentionQueue;
  }
  async function refreshParticipantHistory(restore = false) {
    participantPicker.history(null);
    if (!recipe || !workspace?.selected) return;
    const generation = revision;
    const result = await selectionReceipt();
    if (destroyed || generation !== revision) return;
    if (restore) participantPicker.restore(result.participantId);
    if (recipe.recipe) {
      const listing = await invoke("research_runner_master_history", { workspaceId: workspace.workspaceId, sourceText: recipe.canonicalSourceText });
      if (destroyed || generation !== revision) return;
      if (listing?.schema !== "affect-runner-master-history" || listing.recipeSourceByteSha256 !== recipe.canonicalSourceByteSha256) throw new Error("Participant history belongs to another JSON.");
      participantPicker.history(listing.participants); renderControls(); return;
    }
    const listing = await protocol.refreshRecoveries(workspace.workspaceId, recipe.canonicalSourceText);
    if (destroyed || generation !== revision) return;
    participantPicker.history(listing.participants); renderControls();
  }
  async function adoptRecipe(bytes) {
    if (protocol.active || recorder?.active) throw new Error("Stop the current session and recorder before changing recipe.");
    const generation = ++revision;
    // Withdraw old readiness before parsing; a rejected new file cannot leave Start armed.
    selection = null; preflight = null; inputReceipt = null; recipe = null; path = [];
    participantPicker.clear(); text("runner-output-directory", ""); text("runner-recipe-status", "No experiment loaded"); renderControls();
    const candidate = await readRunnerRecipe(bytes);
    if (destroyed || generation !== revision) return false;
    recipe = candidate; path = [];
    participantPicker.adopt(candidate);
    const master = candidate.recipe;
    protocol = master ? masterProtocol : legacyProtocol;
    query("runner-attempt").value = "new-attempt";
    for (const option of query("runner-attempt").options) option.disabled = Boolean(master && option.value !== "new-attempt");
    preview.destroy(); const previewHost = root.querySelector(".research-preview-stage");
    previewHost.dataset.previewVariant = master ? "studio" : "run";
    previewHost.innerHTML = previewOverlayMarkup({includeFace:Boolean(master)});
    preview = createResearchPreview(previewHost,{initialState:{hideFeedback:true,lockPosition:true}});
    clearMasterDesktopLayout(root);
    root.querySelector(".stimulus-stage").hidden=false;root.querySelector(".run-feedback-stage").hidden=false;
    query("runner-questionnaire-submit").disabled=false;
    text("runner-recipe-status", master ? `${master.segments.P1.study.title} · master v1` : `${candidate.package.settings.experiment.title} · package v1`);
    query("runner-variant-field").hidden = !master;
    query("runner-variant").replaceChildren();
    const prompt = document.createElement("option"); prompt.value = ""; prompt.textContent = "Choose variant…"; query("runner-variant").append(prompt);
    if (master) for (const variant of master.segments.P3.variants) {
      const option = document.createElement("option"); option.value = variant.variantId; option.textContent = variant.title; query("runner-variant").append(option);
    }
    const details = query("runner-recipe-details"); details.replaceChildren();
    for (const [label, detail] of master ? [
      ["Recipe", master.recipeId], ["SHA-256", candidate.canonicalSourceByteSha256],
      ["Videos", master.segments.P1.videoCatalogue.entries.length], ["Sampling", `${master.policy.samplingFrequencyHz} Hz`],
      ["Layout", `${master.presentationTarget} · ${master.segments.P4.reference.source.policy} · ${master.segments.P4.units}`],
      ["Feedback", `${master.segments.P5.presentation.renderer} · ${master.segments.P5.response.mode}`],
    ] : [
      ["Package", candidate.package.packageId], ["SHA-256", candidate.canonicalSourceByteSha256],
      ["Videos", candidate.package.assets.stimuli.length], ["Sampling", `${candidate.package.settings.experiment.samplingFrequencyHz} Hz`],
      ["Layout", "Saved v1 normalized placement · adjacent feedback"],
    ]) { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = label; dd.textContent = detail; details.append(dt, dd); }
    preview.update(master ? { hideFeedback: true } : runnerFeedbackState(candidate.package.settings));
    controllerSettings.adopt(runnerInput(candidate));
    renderLanguage(); renderControls();
    try { await refreshParticipantHistory(true); } catch (error) { fail(error); }
    return true;
  }
  async function checkSession() {
    if (controllerSettings.overridden) throw new Error("Controller override execution is not connected yet. Restore the file settings in Set controller to run this recipe.");
    if (!recipe || !workspace?.selected) throw new Error("Open a recipe and select its project folder.");
    const generation = revision, currentRecipe = recipe, currentWorkspace = workspace;
    preflight = null; inputReceipt = null;
    const candidate = await resolveRunnerSelection(currentRecipe, participantId(), path, value("runner-variant"));
    if (currentRecipe.recipe) {
      const native = await invoke("research_runner_master_plan", { sourceText: currentRecipe.canonicalSourceText,
        participantId: participantId(), selector: candidate.selector });
      if (destroyed || generation !== revision) return;
      assertMasterPlanParity(candidate, native);
      selection = candidate;
      text("runner-preflight", `Master interpreted: ${native.steps.length} ordered events. Verifying media…`);
      const scan = await invoke("research_runner_master_rescan", { workspaceId: currentWorkspace.workspaceId, sourceText: currentRecipe.canonicalSourceText });
      if (destroyed || generation !== revision) return;
      if (scan.workspaceId !== currentWorkspace.workspaceId) throw new Error("Master media scan belongs to another workspace.");
      if (!mediaCapability?.playerActorReady) throw new Error("Master interpreted. Native video inspection is unavailable in this build.");
      const attested = await attestNativeGstCatalogue({ controller: media, workspaceId: currentWorkspace.workspaceId, stimuli: scan.stimuli,
        viewportHost: query("runner-settings-dialog").open ? query("runner-settings-dialog") : query("runner-preparation") });
      if (attested.failures.length) throw new Error(`${attested.failures.length} master video files could not be verified by the native decoder.`);
      const checked = await invoke("research_runner_master_preflight", { request: { workspaceId: currentWorkspace.workspaceId, sourceText: currentRecipe.canonicalSourceText,
        participantId: participantId(), selector: candidate.selector } });
      if (destroyed || generation !== revision) return;
      if (checked?.schema !== "affect-runner-master-preflight" || checked.planIdentitySha256 !== candidate.planIdentitySha256 || checked.recipeSourceByteSha256 !== candidate.recipeSourceByteSha256) throw new Error("Native master preflight does not bind this selection.");
      preflight = checked;
      text("runner-preflight", checked.nativeStartReady ? "Master and media verified. Test the configured input before Start." : `Master and media verified. ${checked.reasons.join(" · ")}`);
      return;
    }
    const listing = await protocol.refreshRecoveries(currentWorkspace.workspaceId, currentRecipe.canonicalSourceText);
    if (destroyed || generation !== revision) return;
    participantPicker.history(listing.participants);
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
    const attested = await attestNativeGstCatalogue({ controller: media, workspaceId: currentWorkspace.workspaceId, stimuli: scan.stimuli,
      viewportHost: query("runner-settings-dialog").open ? query("runner-settings-dialog") : query("runner-preparation") });
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
  async function renderMaster(status, plan) {
    if (!status.active) return;
    const step = plan.steps[status.position - 1];
    if (!step) throw new Error("Native master status references an absent occurrence.");
    text("runner-session", `${participantLabel(status.participantId)} · ${status.position}/${status.stepCount}`);
    text("runner-stimulus", step.kind === "video" ? step.payload.asset.annotationId : step.kind === "interval" ? "Interval" : step.payload.definition.title);
    text("runner-timing", `${status.sampleCount} samples · ${status.missedSlotCount} missed slots`);
    query("runner-pause").disabled = !["playing", "paused"].includes(status.phase); query("runner-pause").textContent = status.phase === "paused" ? "Resume" : "Pause";
    if (step.kind === "questionnaire") {
      presentation.showPage("questionnaire"); preview.update({hideFeedback:true});
      if (questionnaire?.position !== status.position) {
        questionnaire = {definition:step.payload.definition,position:status.position,answers:{...status.answers},master:true};
        text("runner-questionnaire-title", questionnaire.definition.title); text("runner-questionnaire-instructions", questionnaire.definition.instructions);
        text("runner-questionnaire-progress", `${questionnaire.definition.items.length} items · Answer every item to continue`);
        renderMasterQuestionnaire(query("runner-questionnaire-items"),questionnaire.definition,step.payload.presentation,questionnaire.answers);
        query("runner-questionnaire-previous").hidden=true; query("runner-questionnaire-next").hidden=true; query("runner-questionnaire-submit").hidden=false;
      }
      query("runner-questionnaire-submit").disabled=status.phase!=="questionnaire";
    } else {
      questionnaire=null; presentation.showPage("run");
      applyMasterDesktopLayout(root,plan,windowObject);
      root.querySelector(".stimulus-stage").hidden=step.kind!=="video";
      root.querySelector(".run-feedback-stage").hidden=step.kind!=="video";
      preview.update(step.kind === "video" ? runnerMasterFeedbackState(plan.selected.feedback,status.currentValence,status.currentArousal) : {...runnerMasterFeedbackState(plan.selected.feedback,status.currentValence,status.currentArousal),hideFeedback:true});
      if (step.kind === "video" && status.phase === "awaitingPresentation") {
        const ready=await setRegion(root.querySelector(".run-feedback-stage"),"runFeedback");
        if (!ready.runReady) throw new Error("Native participant input is not ready for this video.");
      }
    }
    renderControls();
  }
  function renderQuestionnaire(detail) {
    if (protocol.active) presentation.showPage(detail.active === false ? "run" : "questionnaire");
    else query("runner-questionnaire").hidden = true;
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
    query("runner-questionnaire-previous").hidden = false;
    const { definition, itemIndex } = questionnaire;
    text("runner-questionnaire-title", definition.title); text("runner-questionnaire-instructions", definition.instructions);
    text("runner-questionnaire-progress", `Item ${itemIndex + 1} of ${definition.items.length}`);
    const host = query("runner-questionnaire-items"); host.replaceChildren();
    for (const item of [definition.items[itemIndex]]) {
      const fieldset = document.createElement("fieldset"), legend = document.createElement("legend"); legend.textContent = `${item.order}. ${item.prompt} (required)`; fieldset.append(legend);
      for (const option of item.options) {
        const label = document.createElement("label"), input = document.createElement("input"), span = document.createElement("span");
        input.type = "radio"; input.name = `answer-${item.itemId}`; input.value = option.optionId; input.dataset.answerItem = item.itemId; input.checked = questionnaire.answers[item.itemId] === option.optionId; input.required = true;
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
  for (const [button, dialog] of [["runner-settings", "runner-settings-dialog"], ["runner-preparation-settings", "runner-settings-dialog"], ["runner-controller", "runner-controller-dialog"], ["runner-professor", "runner-professor-dialog"], ["runner-remote", "runner-remote-dialog"], ["runner-session-menu", "runner-session-dialog"]]) {
    listen(query(button), "click", () => query(dialog).showModal());
  }
  root.querySelectorAll("[data-close-dialog]").forEach(button => listen(button, "click", () => query(button.dataset.closeDialog).close()));
  root.querySelectorAll("dialog").forEach(dialog => listen(dialog, "close", () => {
    if (dialog.contains(query("runner-error"))) query("runner-error-host").append(query("runner-error"));
  }));
  listen(query("runner-launch"), "click", () => action(async () => {
    if (!recipe || protocol.active) throw new Error("Load an experiment file first.");
    await retainParticipant();
    text("runner-selected-participant", `Participant ${participantLabel(participantId())}`);
    invalidate(); await invoke("research_input_cancel_setup");
    await presentation.enter();
  }));
  const participantRecord = () => deriveParticipantRecord({ firstName: value("runner-first"), lastName: value("runner-last"), age: Number(value("runner-age")), gender: value("runner-gender"), handedness: value("runner-hand") });
  listen(query("runner-prepare"), "click", () => action(async () => {
    await resolveRunnerSelection(recipe, participantId(), path, value("runner-variant"));
    if (value("runner-attempt") === "new-attempt") participantRecord();
    await checkSession();
    await startAttempt();
  }));
  listen(query("runner-back"), "click", () => action(async () => {
    await presentation.leave(); invalidate(); query("runner-test-region").hidden = true;
    query("runner-first").value = ""; query("runner-last").value = "";
    await invoke("research_input_cancel_setup");
  }));
  listen(windowObject, "keydown", event => {
    if (event.key !== "Escape" || !presentation.active || root.querySelector("dialog[open]")) return;
    event.preventDefault();
    if (protocol.active) query("runner-session-dialog").showModal();
    else query("runner-back").click();
  });
  listen(query("runner-open"), "click", () => action(async () => {
    const loaded = await invoke("research_load_planner_recipe"); if (!loaded) return;
    const receipt = loaded.document;
    await adoptRecipe(new TextEncoder().encode(receipt.canonicalSourceText));
    if (recipe?.canonicalSourceByteSha256 !== receipt.canonicalSourceByteSha256) { invalidate(); recipe = null; throw new Error("Native and frontend package bytes disagree."); }
  }));
  listen(query("runner-folder"), "click", () => action(async () => { invalidate(); workspace = await invoke("research_choose_workspace"); text("runner-workspace-status", workspace.selected ? workspace.displayName : "No project folder selected."); text("runner-output-directory", ""); await refreshParticipantHistory(true); }));
  for (const id of ["runner-language-reset", "runner-preview-language-reset"]) listen(query(id), "click", () => { path = []; invalidate(); renderLanguage(); refreshTimeline(); });
  listen(query("runner-sequence-preview"), "click", () => { query("runner-sequence-dialog").showModal(); renderLanguage(); refreshTimeline(); });
  listen(query("runner-attempt"), "change", invalidate);
  listen(query("runner-variant"), "change", () => { invalidate(); refreshTimeline(); });
  listen(query("runner-check"), "click", () => action(checkSession));
  listen(query("runner-test"), "click", () => action(async () => {
    query("runner-test-region").hidden = false; query("runner-test-region").scrollIntoView({ block: "center" }); query("runner-test-region").focus();
    await setRegion(query("runner-test-region"), "setupTest"); await invoke("research_input_begin_test", { binding: runnerInput(recipe) });
  }));
  async function startAttempt() {
    if (!selection || !preflight) throw new Error("Check the current selection first.");
    if (!presentation.active) throw new Error("Enter fullscreen participant preparation first.");
    if (controllerSettings.overridden) throw new Error("Controller override execution is not connected yet.");
    const disposition = value("runner-attempt");
    if (recipe.recipe && disposition !== "new-attempt") throw new Error("Master recovery is not implemented. Start an explicitly confirmed new attempt; prior partial files remain retained.");
    if (disposition !== "finalize") {
      if (!capability?.nativeStartReady || !preflight.nativeStartReady) throw new Error("Native experiment playback is not qualified in this build.");
      const status = await invoke("research_input_status");
      inputReceipt = status.receipt;
      if (!inputReceipt) throw new Error("The configured input needs a fresh test. Open Session settings, test all four directions, then continue.");
    }
    const participant = disposition === "new-attempt" ? deriveParticipantRecord({ firstName: value("runner-first"), lastName: value("runner-last"), age: Number(value("runner-age")), gender: value("runner-gender"), handedness: value("runner-hand") }) : null;
    query("runner-first").value = ""; query("runner-last").value = "";
    if (recipe.recipe) {
      await masterProtocol.start(selection, {workspaceId:workspace.workspaceId,sourceText:recipe.canonicalSourceText,selector:selection.selector,
        participant:{participantId:participantId(),...participant},inputTestReceiptId:inputReceipt.receiptId,rerunConfirmed:query("runner-rerun").checked});
      inputReceipt=null; renderControls(); return;
    }
    await protocol.start({ ...selection.detail, participant, inputTestReceiptId: inputReceipt?.receiptId,
      attemptDisposition: disposition, recoveryFinalizationOnly: disposition === "finalize", rerunConfirmed: query("runner-rerun").checked }, workspace.workspaceId);
  }
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
    if (questionnaire.definition.items.some(item => !Object.hasOwn(questionnaire.answers, item.itemId) || questionnaire.answers[item.itemId] === null)) throw new Error("Answer every questionnaire item before continuing.");
    await protocol.questionnaireSubmit({ protocolStepPosition: questionnaire.position, answers: { ...questionnaire.answers } });
  }); });
  listen(query("runner-questionnaire-previous"), "click", () => {
    if (questionnaire && !busy) { questionnaire.itemIndex = Math.max(0, questionnaire.itemIndex - 1); renderQuestionnaireItem(); }
  });
  listen(query("runner-questionnaire-next"), "click", () => {
    if (!questionnaire || busy) return;
    const item = questionnaire.definition.items[questionnaire.itemIndex];
    if (!Object.hasOwn(questionnaire.answers, item.itemId) || questionnaire.answers[item.itemId] === null) { fail(new Error("Choose a response before continuing.")); return; }
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
    const result = await invoke("research_recorder_start", { workspaceId: workspace.workspaceId, request: { experimentPackageSourceText: recipe.canonicalSourceText,
      recordOwn: query("runner-record-own").checked, discoveryRevision: discovery?.revision ?? null,
      streamKeys: [...root.querySelectorAll("[data-stream-key]:checked")].map((item) => item.dataset.streamKey) } });
    if (result) recorder = result; renderRecorder();
  }));
  listen(query("runner-record-stop"), "click", () => action(async () => { recorder = await invoke("research_recorder_stop"); renderRecorder(); }));
  listen(windowObject, "resize", () => action(async () => {
    if (protocol.active) {
      // Questionnaires intentionally hide the feedback surface. Its region is
      // re-registered when the next native stimulus is prepared.
      if (!query("runner-stage").hidden) await setRegion(root.querySelector(".run-feedback-stage"), "runFeedback");
      await protocol.resize();
    }
    else { inputReceipt = null; await invoke("research_input_cancel_setup"); }
  }));
  listen(root.querySelector(".runner-sidebar"), "scroll", () => {
    if (busy || protocol.active || !recipe || query("runner-test-region").hidden) return;
    revision += 1; inputReceipt = null;
    action(async () => { await invoke("research_input_cancel_setup"); text("runner-input-status", "The test region moved. Test the configured input again."); });
  });
  try {
    [capability, mediaCapability, workspace] = await Promise.all([legacyProtocol.initialize(), invoke("research_native_media_capability"), invoke("research_workspace_status")]);
  } catch (error) { destroy(); throw error; }
  text("runner-capability", capability.nativeStartReady ? "Native execution available" : `Native playback not qualified · ${capability.reasonCode}`);
  text("runner-launch-status", capability.nativeStartReady ? "" : "Participant setup available · playback not yet qualified");
  text("runner-workspace-status", workspace?.selected ? workspace.displayName : "No project folder selected.");
  try { recorder = await invoke("research_recorder_status"); renderRecorder(); } catch { text("runner-record-status", "Recorder is not included in this build."); }
  timer = windowObject.setInterval(async () => {
    if (destroyed || polling || busy) return; polling = true;
    try {
      if (!protocol.active && recipe && !query("runner-test-region").hidden && query("runner-settings-dialog").open) {
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
