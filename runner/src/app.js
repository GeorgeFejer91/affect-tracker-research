import { runnerMarkup } from "./view.js";
import { createRunnerHtmlVideoPlayer } from "./html-video-player.js";
import { plannerRecipeTransportText } from "../../site/src/research/planner-recipe-transport.js";
import { readRunnerRecipe, resolveRunnerSelection, resolveLanguageSelectionTraversalStepV1, runnerFeedbackState, runnerLanguageTree, runnerInput, runnerMasterFeedbackState } from "./recipe.js";
import { NativePackageProtocolAdapter } from "../../site/src/research/native-package-protocol.js";
import { NativeMediaController } from "../../site/src/research/native-media-controller.js";
import { attestNativeGstCatalogue } from "../../site/src/research/native-media-catalogue.js";
import { attestMasterMedia } from "./master-media.js";
import { nativeInputRegionRequest } from "../../site/src/research/input-region.js";
import { createResearchPreview } from "../../site/src/research/preview.js";
import { deriveParticipantRecord } from "../../site/src/research/identity.js";
import { validateQuestionnaireAnswers } from "../../site/src/research/questionnaires.js";
import { createRunnerPresentation } from "./presentation.js";
import { createQuestionnaireKeyboard } from "./questionnaire-keyboard.js";
import { createRunnerControllerSettings } from "./controller-settings.js";
import { createRecentFiles } from "./recent-files.js";
import { createVariantPicker, nextParticipant } from "./variant-picker.js";
import { createParticipantPicker, participantLabel, participantPreviewTimeline } from "./participants.js";
import { assertMasterPlanParity, applyMasterDesktopLayout, clearMasterDesktopLayout, renderMasterQuestionnaire } from "./master-presentation.js";
import { surveyRandomSeed } from "../../site/src/research/surveyjs-engine.js";
import { NativeMasterProtocolAdapter } from "./master-protocol.js";
import { previewOverlayMarkup } from "../../site/src/research/feedback-surface.js";
import { browserAffectState, browserRunCsv } from "./browser-csv.js";

const messageOf = (error) => error?.message ?? String(error);
const downloadText = (windowObject, fileName, text, type = "text/csv;charset=utf-8") => {
  const blob = new Blob([text], { type });
  const url = windowObject.URL.createObjectURL(blob);
  const anchor = windowObject.document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  windowObject.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  windowObject.setTimeout(() => windowObject.URL.revokeObjectURL(url), 1000);
};
const safeName = (value) => String(value ?? "run").replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 96) || "run";

export async function bootRunner(root, { invoke, windowObject = window, pollMs = 250, subscribeAbort = () => () => {} } = {}) {
  if (!(root instanceof HTMLElement) || typeof invoke !== "function") throw new TypeError("Runner needs its root and native adapter.");
  root.innerHTML = runnerMarkup(); root.setAttribute("aria-busy", "false");
  const identity = await invoke("research_desktop_identity");
  if (identity?.schema !== "affect-research-desktop-identity" || identity.version !== 1 || identity.program !== "runner") throw new Error("Open this interface with the Experiment Runner executable.");
  const browserMode = identity.platform === "browser";
  const query = (id) => root.querySelector(`#${id}`);
  const text = (id, value) => { query(id).textContent = value; };
  const value = (id) => query(id).value;
  const now = () => windowObject.performance?.now?.() ?? Date.now();
  const animationFrame = () => new Promise(resolve => windowObject.requestAnimationFrame(resolve));
  const listeners = [];
  const listen = (element, event, fn, options) => { element.addEventListener(event, fn, options); listeners.push(() => element.removeEventListener(event, fn, options)); };
  let recipe = null, workspace = null, selection = null, path = [], inputReceipt = null;
  let preflight = null, revision = 0, regionEpoch = 0, destroyed = false, busy = false;
  let capability = null, mediaCapability = null, discovery = null, recorder = null, questionnaire = null;
  let recentExperiments = null, participantManual = false;
  let focusAfterAction = null;
  let setupScrollQuietUntil = 0;
  let questionnairePreview = null, validationPreview = null;
  let browserAttempt = null;
  let abortPending = false, actionEpoch = 0;
  let queue = Promise.resolve(), retentionQueue = Promise.resolve(), polling = false, timer = null, validationStepTimer = null;
  let validationPlaybackEpoch = 0;
  let preview = createResearchPreview(root.querySelector(".research-preview-stage"), { initialState: { hideFeedback: true, lockPosition: true } });
  const validationVideo = createRunnerHtmlVideoPlayer(query("run-native-video-host"), {
    invoke, windowObject,
    onEnded: () => {
      const attempt = browserAttempt;
      if (!destroyed && attempt?.active && attempt.steps[attempt.index]?.kind === "video") {
        action(() => showBrowserRunStep(attempt.index + 1));
        return;
      }
      const current = validationPreview;
      if (!destroyed && current?.steps[current.index]?.kind === "video") action(() => showValidationPreview(current.index + 1));
    },
  });
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
    if (destroyed) return;
    preflight = null; inputReceipt = null; clearQuestionnaire();
    text("runner-receipt", status.result ? `Participant ${participantLabel(status.participantId)} · ${status.result.status}\n${status.result.outputDirectory}` : `Participant ${participantLabel(status.participantId)} · incomplete attempt\n${status.failureCode ?? "Native finalization unavailable"}`);
    query("runner-receipt").hidden = false;
    preview.update({hideFeedback:true}); clearMasterDesktopLayout(root);
    await presentation.leave(); participantManual = false; variantPicker.reset(); await refreshParticipantHistory(); renderControls();
  } });
  const presentation = createRunnerPresentation(root, { invoke, windowObject, isActive: () => protocol.active });
  const questionnaireKeyboard = createQuestionnaireKeyboard(query("runner-questionnaire-form"), {
    items: query("runner-questionnaire-items"), next: query("runner-questionnaire-next"), submit: query("runner-questionnaire-submit"),
    ready: () => !destroyed && !busy && !!questionnaire && (!questionnaire.master || masterProtocol.status?.phase === "questionnaire"),
    commit: commitQuestionnaireDraft,
  });
  const controllerSettings = createRunnerControllerSettings(root, { onChange: () => invalidate(), windowObject });
  const recentFiles = createRecentFiles(root, { onSelect: id => action(() => loadExperiment(id)) });
  const variantPicker = createVariantPicker(root, { onChange: () => { invalidate(); refreshTimeline(); } });
  const participantPicker = createParticipantPicker(root, { onChange: commit => {
    participantManual = true; variantPicker.participant(participantPicker.participantId);
    invalidate(); refreshTimeline();
    if (commit && participantPicker.participantId) retainParticipant().catch(fail);
  } });
  const participantId = () => {
    if (!participantPicker.participantId) throw new Error("Choose a participant number with a schedule in this JSON.");
    return participantPicker.participantId;
  };
  function questionnaireParticipantCopy(definition) {
    const german = definition.language?.toLowerCase().startsWith("de");
    const form = definition.schema === "affect-research-form-definition";
    if (form) return {
      title: german ? "Bitte machen Sie die folgenden Angaben" : "Please provide the following information",
      instructions: german ? "Füllen Sie die erforderlichen Felder aus und wählen Sie dann Weiter." : "Fill in the required fields, then choose Next.",
    };
    return {
      title: german ? "Bitte beantworten Sie die folgenden Fragen" : "Please answer the following questions",
      instructions: german ? "Wählen Sie bei jeder Aussage die Antwort, die am besten passt. Sie können eine Antwort vor dem Fortfahren ändern." : "For each item, choose the response that fits best. You can change an answer before continuing.",
    };
  }
  function renderQuestionnaireParticipantCopy(definition) {
    const copy = questionnaireParticipantCopy(definition);
    text("runner-questionnaire-title", copy.title);
    text("runner-questionnaire-instructions", copy.instructions);
    query("runner-questionnaire").dataset.sourceTitle = definition.title ?? "";
  }
  // A terminal native status returns to preparation in this same Runner app.
  root.researchUi = { setMode: () => renderControls() };

  function fail(error) {
    const dialog = [...root.querySelectorAll("dialog[open]")].at(-1);
    (dialog ?? query("runner-error-host")).append(query("runner-error"));
    text("runner-error", messageOf(error)); query("runner-error").hidden = false;
  }
  function action(operation) {
    const epoch = actionEpoch;
    queue = queue.then(async () => {
      if (destroyed || epoch !== actionEpoch) return;
      busy = true; query("runner-error").hidden = true; renderControls();
      try { await operation(); } catch (error) { if (!destroyed) fail(error); }
      finally { busy = false; if (!destroyed) { renderControls(); focusAfterAction?.focus(); focusAfterAction = null; } }
    });
    return queue;
  }
  function requestAbort() {
    if (destroyed || abortPending || (!presentation.active && !presentation.entering)) return;
    abortPending = true;
    actionEpoch += 1; // Discard queued form/navigation actions from the aborted presentation.
    // Revoke pending preparation but retain the active frozen selection until
    // its adapter has processed the terminal status (including legacy forms).
    revision += 1; preflight = null; inputReceipt = null; renderControls();
    action(async () => {
      try {
        if (browserAttempt?.active) {
          await finishBrowserAttempt("partial");
          return;
        }
        if (protocol.active) await protocol.finish("stopEarly");
        if (!protocol.active) {
          if (recorder?.active) { recorder = await invoke("research_recorder_stop"); renderRecorder(); }
          await invoke("research_input_cancel_setup");
          clearQuestionnaire(); clearValidationPlayback(); questionnairePreview = null; validationPreview = null;
          selection = null;
          query("runner-test-region").hidden = true;
          query("runner-first").value = ""; query("runner-last").value = "";
          await presentation.leave();
        }
      } finally { abortPending = false; }
    });
  }
  listeners.push(subscribeAbort(requestAbort));
  function invalidate() {
    revision += 1; preflight = null; selection = null; inputReceipt = null;
    questionnairePreview = null; validationPreview = null;
    clearValidationPlayback();
    text("runner-preflight", "Check the current participant, language and media before starting."); renderControls();
  }
  function clearQuestionnaire() {
    questionnaireKeyboard.reset();
    questionnaire?.presenter?.destroy();
    questionnaire = null;
  }
  function clearValidationTimer() {
    if (validationStepTimer !== null) {
      windowObject.clearTimeout(validationStepTimer);
      validationStepTimer = null;
    }
  }
  function clearValidationPlayback() {
    validationPlaybackEpoch += 1;
    clearValidationTimer();
    validationVideo.stop();
  }
  function scheduleValidationStepAdvance(index, durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    const epoch = validationPlaybackEpoch;
    validationStepTimer = windowObject.setTimeout(() => {
      validationStepTimer = null;
      if (destroyed || epoch !== validationPlaybackEpoch || validationPreview?.index !== index) return;
      action(() => showValidationPreview(index + 1));
    }, durationMs);
  }
  function browserRecord(row) {
    const attempt = browserAttempt;
    if (!attempt?.active) return;
    const affect = browserAffectState({
      currentValence: Number.isFinite(row.valence) ? row.valence : attempt.x,
      currentArousal: Number.isFinite(row.arousal) ? row.arousal : attempt.y,
      targetValence: Number.isFinite(row.target_valence) ? row.target_valence : (Number.isFinite(row.valence) ? row.valence : attempt.x),
      targetArousal: Number.isFinite(row.target_arousal) ? row.target_arousal : (Number.isFinite(row.arousal) ? row.arousal : attempt.y),
      animationActive: row.animation_active ?? attempt.animationActive,
      inputActive: row.input_active ?? attempt.inputActive,
    });
    attempt.rows.push({
      row_type: row.row_type ?? "event",
      run_id: attempt.runId,
      participant_id: attempt.participantId,
      variant_id: attempt.selector.variantId,
      language_id: attempt.selector.languageId,
      recipe_sha256: attempt.recipeSha256,
      plan_sha256: attempt.planSha256,
      protocol_step_position: row.protocol_step_position ?? attempt.steps[attempt.index]?.position ?? "",
      step_kind: row.step_kind ?? attempt.steps[attempt.index]?.kind ?? "",
      step_label: row.step_label ?? (attempt.steps[attempt.index] ? stepTitle(attempt.steps[attempt.index]) : ""),
      source_code: row.source_code ?? attempt.steps[attempt.index]?.sourceCode ?? "",
      relative_path: row.relative_path ?? attempt.steps[attempt.index]?.payload?.asset?.packageRelativePath ?? "",
      event_type: row.event_type ?? "",
      sequence: attempt.rows.length + 1,
      iso_time: new Date().toISOString(),
      elapsed_ms: Math.round(now() - attempt.startedAtMs),
      media_time_ms: row.media_time_ms ?? "",
      valence: Number.isFinite(row.valence) ? row.valence : attempt.x,
      arousal: Number.isFinite(row.arousal) ? row.arousal : attempt.y,
      ...affect,
      questionnaire_id: row.questionnaire_id ?? "",
      module_id: row.module_id ?? "",
      item_id: row.item_id ?? "",
      answer_value: row.answer_value ?? "",
      payload_json: row.payload_json ?? "",
    });
  }
  function browserStartupPayload(attempt) {
    return {
      schema: "affect-runner-browser-startup",
      version: 1,
      recipeSourceText: plannerRecipeTransportText(recipe),
      recipeSourceByteSha256: attempt.recipeSha256,
      planIdentitySha256: attempt.planSha256,
      participantId: attempt.participantId,
      selector: attempt.selector,
      planVersion: attempt.plan.version,
      stepCount: attempt.steps.length,
      questionnaireAssetCount: recipe?.questionnaireAssets?.length ?? 0,
      platform: "browser-csv",
      lslUnavailable: true,
    };
  }
  function browserOutcomePayload(attempt, status) {
    return {
      schema: "affect-runner-browser-outcome",
      version: 1,
      protocolOutcome: status === "complete" ? "completed" : "partial",
      failureCode: status === "complete" ? null : "browser-stop-early",
      recipeSourceByteSha256: attempt.recipeSha256,
      planIdentitySha256: attempt.planSha256,
      participantId: attempt.participantId,
      selector: attempt.selector,
      rowCountBeforeOutcome: attempt.rows.length,
      completedStepCount: status === "complete" ? attempt.steps.length : Math.max(0, Math.min(attempt.index, attempt.steps.length)),
      lslUnavailable: true,
      recordingFinalization: "browser-csv-downloaded",
    };
  }
  function browserStopSampling() {
    const attempt = browserAttempt;
    if (!attempt) return;
    if (attempt.sampleTimer !== null) windowObject.clearInterval(attempt.sampleTimer);
    if (attempt.stepTimer !== null) windowObject.clearTimeout(attempt.stepTimer);
    attempt.sampleTimer = null;
    attempt.stepTimer = null;
    if (attempt.pointerMove) root.querySelector(".run-feedback-stage")?.removeEventListener("pointermove", attempt.pointerMove);
    if (attempt.pointerDown) root.querySelector(".run-feedback-stage")?.removeEventListener("pointerdown", attempt.pointerDown);
    if (attempt.keyDown) windowObject.removeEventListener("keydown", attempt.keyDown, true);
    attempt.pointerMove = null;
    attempt.pointerDown = null;
    attempt.keyDown = null;
  }
  function browserStartSampling(step) {
    const attempt = browserAttempt;
    if (!attempt?.active) return;
    browserStopSampling();
    const feedbackStage = root.querySelector(".run-feedback-stage");
    const setFromPoint = (event) => {
      const bounds = feedbackStage.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      attempt.x = Math.max(-1, Math.min(1, ((event.clientX - bounds.left) / bounds.width) * 2 - 1));
      attempt.y = Math.max(-1, Math.min(1, 1 - ((event.clientY - bounds.top) / bounds.height) * 2));
      attempt.inputActive = true;
      preview.update(runnerMasterFeedbackState(attempt.plan.selected.feedback, attempt.x, attempt.y));
    };
    attempt.pointerMove = setFromPoint;
    attempt.pointerDown = setFromPoint;
    attempt.keyDown = (event) => {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
      const delta = event.shiftKey ? 0.2 : 0.08;
      if (event.key === "Home") { attempt.x = 0; attempt.y = 0; }
      if (event.key === "ArrowLeft") attempt.x = Math.max(-1, attempt.x - delta);
      if (event.key === "ArrowRight") attempt.x = Math.min(1, attempt.x + delta);
      if (event.key === "ArrowDown") attempt.y = Math.max(-1, attempt.y - delta);
      if (event.key === "ArrowUp") attempt.y = Math.min(1, attempt.y + delta);
      attempt.inputActive = event.key !== "Home";
      preview.update(runnerMasterFeedbackState(attempt.plan.selected.feedback, attempt.x, attempt.y));
      event.preventDefault();
    };
    feedbackStage?.addEventListener("pointermove", attempt.pointerMove);
    feedbackStage?.addEventListener("pointerdown", attempt.pointerDown);
    windowObject.addEventListener("keydown", attempt.keyDown, true);
    const sampleMs = Math.max(8, Math.round(1000 / Math.max(1, Math.min(120, Number(recipe?.recipe?.policy?.samplingFrequencyHz ?? 30)))));
    const sample = () => browserRecord({
      row_type: "sample",
      event_type: "affectSample",
      protocol_step_position: step.position,
      step_kind: step.kind,
      step_label: stepTitle(step),
      source_code: step.sourceCode,
      relative_path: step.payload.asset?.packageRelativePath ?? "",
      media_time_ms: validationVideo.video ? Math.round(validationVideo.video.currentTime * 1000) : "",
      valence: attempt.x,
      arousal: attempt.y,
      target_valence: attempt.x,
      target_arousal: attempt.y,
      animation_active: attempt.animationActive,
      input_active: attempt.inputActive,
    });
    sample();
    attempt.sampleTimer = windowObject.setInterval(sample, sampleMs);
  }
  async function finishBrowserAttempt(status = "complete") {
    const attempt = browserAttempt;
    if (!attempt) return;
    browserStopSampling();
    validationVideo.stop();
    browserRecord({ row_type: "event", event_type: status === "complete" ? "runComplete" : "runPartial", payload_json: browserOutcomePayload(attempt, status) });
    attempt.active = false;
    const csv = browserRunCsv(attempt.rows);
    const fileName = `${safeName(recipe?.recipe?.segments?.P1?.study?.title)}_${attempt.participantId}_${safeName(attempt.selector.variantId)}_${status}.csv`;
    downloadText(windowObject, fileName, csv);
    text("runner-session", `${participantLabel(attempt.participantId)} · ${status}`);
    text("runner-receipt", `Browser CSV downloaded\n${fileName}\nRows: ${attempt.rows.length}`);
    query("runner-receipt").hidden = false;
    text("runner-write", "Browser CSV downloaded");
    text("runner-lsl", "Browser run uses CSV instead of LSL/XDF");
    preview.update({ hideFeedback: true });
    clearQuestionnaire();
    clearMasterDesktopLayout(root);
    participantManual = false;
    variantPicker.reset();
    renderControls();
    browserAttempt = null;
    try { await presentation.leave(); } catch { /* Already outside the participant view. */ }
  }
  async function submitBrowserQuestionnaire(current) {
    if (!browserAttempt?.active || questionnaire !== current) return;
    const detail = questionnaireDetail(current, false);
    const step = browserAttempt.steps[browserAttempt.index];
    const answers = detail.surveyjs ? detail.data : detail.answers;
    for (const [itemId, answer] of Object.entries(answers ?? {})) {
      browserRecord({
        row_type: "questionnaire",
        event_type: "questionnaireAnswer",
        protocol_step_position: step.position,
        step_kind: step.kind,
        step_label: stepTitle(step),
        questionnaire_id: step.payload.definition.questionnaireId,
        module_id: step.payload.module?.moduleId ?? "",
        item_id: itemId,
        answer_value: typeof answer === "object" ? JSON.stringify(answer) : answer,
        payload_json: detail,
      });
    }
    browserRecord({
      row_type: "event",
      event_type: "questionnaireCompleted",
      protocol_step_position: step.position,
      step_kind: step.kind,
      step_label: stepTitle(step),
      questionnaire_id: step.payload.definition.questionnaireId,
      module_id: step.payload.module?.moduleId ?? "",
    });
    await showBrowserRunStep(browserAttempt.index + 1);
  }
  async function showBrowserRunStep(index = 0) {
    const attempt = browserAttempt;
    if (!attempt?.active) return;
    if (index >= attempt.steps.length) {
      await finishBrowserAttempt("complete");
      return;
    }
    attempt.index = Math.max(0, Math.min(attempt.steps.length - 1, index));
    const step = attempt.steps[attempt.index];
    browserStopSampling();
    validationPlaybackEpoch += 1;
    const playbackEpoch = validationPlaybackEpoch;
    clearQuestionnaire();
    const title = stepTitle(step);
    text("runner-session", `${participantLabel(attempt.participantId)} · browser step ${attempt.index + 1}/${attempt.steps.length}`);
    text("runner-stimulus", title);
    text("runner-write", "Browser CSV journal active");
    text("runner-lsl", "Browser run records CSV rows instead of emitting LSL/XDF");
    query("runner-pause").disabled = true;
    browserRecord({ row_type: "event", event_type: `${step.kind}Started`, protocol_step_position: step.position, step_kind: step.kind, step_label: title });
    if (step.kind === "questionnaire") {
      validationVideo.stop();
      presentation.showPage("questionnaire");
      preview.update({ hideFeedback: true });
      questionnaire = { definition: step.payload.definition, position: step.position, answers: {}, master: false, browserRun: true, version: attempt.plan.version };
      query("runner-questionnaire").lang = questionnaire.definition.language;
      renderQuestionnaireParticipantCopy(questionnaire.definition);
      text("runner-questionnaire-keyboard", questionnaire.definition.language.startsWith("de") ? "Tab: navigieren · Pfeiltasten: Antwort wählen" : "Tab: navigate · Arrow keys: choose");
      const current = questionnaire;
      questionnaire.presenter = renderMasterQuestionnaire(query("runner-questionnaire-items"), questionnaire.definition, step.payload.presentation, questionnaire.answers, {
        version: attempt.plan.version,
        randomSeed: surveyRandomSeed(attempt.plan.planIdentitySha256, step.position),
        onChange: () => { if (questionnaire === current && current.presenter) text("runner-questionnaire-progress", current.presenter.progress().text); },
        onComplete: () => action(() => submitBrowserQuestionnaire(current)),
      });
      text("runner-questionnaire-submit", questionnaire.definition.language.startsWith("de") ? "Weiter" : "Next");
      if (questionnaire.presenter) text("runner-questionnaire-progress", questionnaire.presenter.progress().text);
      query("runner-questionnaire-previous").hidden = true;
      query("runner-questionnaire-next").hidden = true;
      query("runner-questionnaire-submit").hidden = Boolean(questionnaire.presenter?.usesSurveyJS);
    } else {
      presentation.showPage("run");
      const stage = root.querySelector(".stimulus-stage"), feedback = root.querySelector(".run-feedback-stage");
      clearMasterDesktopLayout(root);
      applyMasterDesktopLayout(root, attempt.plan, windowObject);
      stage.hidden = false;
      feedback.hidden = false;
      query("run-stimulus-placeholder").textContent = "";
      preview.update(step.kind === "interval"
        ? { ...runnerMasterFeedbackState(attempt.plan.selected.feedback, 0, 0), hideFeedback: false, lockPosition: true }
        : runnerMasterFeedbackState(attempt.plan.selected.feedback, attempt.x, attempt.y));
      text("runner-timing", step.kind === "interval"
        ? `Browser CSV run · waiting ${Number((step.durationMs / 1000).toFixed(3))} s`
        : `Browser CSV run · loading ${Number((step.durationMs / 1000).toFixed(3))} s video`);
      if (step.kind === "interval") {
        validationVideo.stop();
        attempt.x = 0;
        attempt.y = 0;
        attempt.stepTimer = windowObject.setTimeout(() => {
          if (!destroyed && browserAttempt === attempt && attempt.active && attempt.index === index) action(() => showBrowserRunStep(index + 1));
        }, step.durationMs);
      } else if (step.kind === "video") {
        const result = await validationVideo.playStep({
          workspaceId: workspace.workspaceId,
          sourceText: plannerRecipeTransportText(recipe),
          participantId: attempt.participantId,
          selector: attempt.selector,
          step,
        });
        if (destroyed || playbackEpoch !== validationPlaybackEpoch || browserAttempt !== attempt || attempt.index !== index || !result) return;
        text("runner-timing", `Browser CSV run · playing ${Number((step.durationMs / 1000).toFixed(3))} s video`);
        browserStartSampling(step);
        attempt.stepTimer = windowObject.setTimeout(() => {
          if (!destroyed && browserAttempt === attempt && attempt.active && attempt.index === index) action(() => showBrowserRunStep(index + 1));
        }, step.durationMs);
      }
    }
    renderControls();
  }
  async function startBrowserAttempt() {
    if (!browserMode) return false;
    if (!recipe?.recipe) throw new Error("Browser Runner currently supports Planner master JSON versions 3-5.");
    if (![3, 4, 5].includes(recipe.recipe.version)) throw new Error("Browser Runner currently supports Planner master JSON versions 3-5.");
    if (!presentation.active) throw new Error("Enter participant preparation first.");
    if (!workspace?.selected && recipe.recipe.segments.P3.variants.some(variant => variant.entries.some(entry => entry.kind === "video"))) {
      throw new Error("Open Session settings and choose the experiment project folder before browser video playback.");
    }
    const plan = await resolveRunnerSelection(recipe, participantId(), path, value("runner-variant"));
    selection = plan;
    const runId = windowObject.crypto?.randomUUID?.() ?? `browser-${Date.now().toString(16)}`;
    browserAttempt = {
      active: true,
      runId,
      participantId: participantId(),
      selector: plan.selector,
      recipeSha256: recipe.canonicalSourceByteSha256,
      planSha256: plan.planIdentitySha256,
      plan,
      steps: plan.steps,
      index: 0,
      rows: [],
      startedAtMs: now(),
      x: 0,
      y: 0,
      sampleTimer: null,
      stepTimer: null,
      animationActive: Boolean(plan.selected.feedback?.visual?.flubberEnabled),
      inputActive: false,
      pointerMove: null,
      pointerDown: null,
      keyDown: null,
    };
    browserRecord({ row_type: "event", event_type: "runStarted", protocol_step_position: 0, step_kind: "run", step_label: "Browser run started", payload_json: browserStartupPayload(browserAttempt) });
    await showBrowserRunStep(0);
    return true;
  }
  async function prepareInputTestRegion() {
    const region = query("runner-test-region");
    region.hidden = false;
    setupScrollQuietUntil = now() + 1500;
    region.scrollIntoView({ block: "center", behavior: "instant" });
    await animationFrame();
    await animationFrame();
    try { region.focus({ preventScroll: true }); } catch { region.focus(); }
    await animationFrame();
    await animationFrame();
  }
  function questionnaireDetail(current, allowPartial) {
    if (current.presenter) {
      const result = current.presenter.read({ allowPartial });
      if (result.surveyjs) return { protocolStepPosition: current.position, ...result };
      current.answers = Object.fromEntries(result.answers.map(row => [row.itemId, row.value]));
      text("runner-questionnaire-progress", current.presenter.progress().text);
    } else {
      const choices = [2, 3, 4, 5].includes(current.version) ? Object.fromEntries(Object.entries(current.answers).map(([id, answer]) => {
        if (answer?.kind !== "singleChoice") throw new Error("This questionnaire requires a declared choice.");
        return [id, answer.optionId];
      })) : current.answers;
      validateQuestionnaireAnswers(current.definition, choices, { allowPartial });
      if (!allowPartial && current.definition.items.some(item => !Object.hasOwn(choices, item.itemId) || choices[item.itemId] === null)) throw new Error("Answer every questionnaire item before continuing.");
    }
    return { protocolStepPosition: current.position, answers: structuredClone(current.answers) };
  }
  function firstTerminalLanguagePath(tree, nodeId = tree?.rootNodeId, prefix = []) {
    const node = tree?.nodes?.find(item => item.nodeId === nodeId);
    if (!node) return null;
    for (const option of node.options ?? []) {
      if (option.target?.kind === "language") return [...prefix, option.optionId];
      if (option.target?.kind === "node") {
        const path = firstTerminalLanguagePath(tree, option.target.nodeId, [...prefix, option.optionId]);
        if (path) return path;
      }
    }
    return null;
  }
  function currentLanguagePath() {
    if (!recipe) return [];
    try {
      if (resolveLanguageSelectionTraversalStepV1(runnerLanguageTree(recipe), path).kind === "terminal") return path;
    } catch { /* fall through to the first terminal route */ }
    const terminal = firstTerminalLanguagePath(runnerLanguageTree(recipe));
    if (!terminal) throw new Error("The experiment JSON has no complete language route.");
    return terminal;
  }
  function selectedVariantId() {
    if (!recipe?.recipe) return "";
    const selected = value("runner-variant");
    if (selected) return selected;
    const first = recipe.recipe.segments.P3.variants[0]?.variantId;
    if (!first) throw new Error("The experiment JSON has no counterbalance version.");
    query("runner-variant").value = first;
    return first;
  }
  async function ensureResolvedPreviewPlan() {
    if (protocol.active) throw new Error("Stop the active recorded attempt before using hidden validation traversal.");
    if (!recipe) await loadExperiment(true);
    if (!recipe?.recipe) throw new Error("Load a master experiment JSON first.");
    if (!participantPicker.participantId) {
      try { await refreshParticipantHistory(true); } catch { /* fall back to the first canonical participant */ }
      if (!participantPicker.participantId) participantPicker.restore("P001");
      participantManual = false;
      variantPicker.participant(participantPicker.participantId);
    }
    path = currentLanguagePath();
    renderLanguage(); refreshTimeline();
    const plan = await resolveRunnerSelection(recipe, participantId(), path, selectedVariantId());
    selection = plan;
    return plan;
  }
  async function ensurePreviewPlan() {
    const plan = await ensureResolvedPreviewPlan();
    const steps = plan.steps.filter(step => step.kind === "questionnaire");
    if (!steps.length) throw new Error("This experiment has no questionnaire steps to preview.");
    return { plan, steps };
  }
  async function ensureValidationPlan() {
    const plan = await ensureResolvedPreviewPlan();
    if (!plan.steps.length) throw new Error("This experiment has no runnable steps.");
    return { plan, steps: plan.steps };
  }
  async function showQuestionnairePreview(index = 0) {
    const previewPlan = questionnairePreview?.plan ? questionnairePreview : await ensurePreviewPlan();
    const nextIndex = Math.max(0, Math.min(previewPlan.steps.length - 1, index));
    questionnairePreview = { ...previewPlan, index: nextIndex };
    const step = questionnairePreview.steps[nextIndex];
    if (!presentation.active) await presentation.enter();
    clearQuestionnaire();
    clearValidationPlayback();
    presentation.showPage("questionnaire"); preview.update({ hideFeedback: true });
    text("runner-session", `${participantLabel(participantId())} · questionnaire ${nextIndex + 1}/${questionnairePreview.steps.length}`);
    text("runner-stimulus", step.payload.definition.title);
    text("runner-timing", "Validation preview");
    text("runner-write", "No recording");
    text("runner-lsl", "No LSL markers emitted");
    query("runner-pause").disabled = true;
    questionnaire = { definition: step.payload.definition, position: step.position, answers: {}, master: false, preview: true, version: questionnairePreview.plan.version };
    query("runner-questionnaire").lang = questionnaire.definition.language;
    renderQuestionnaireParticipantCopy(questionnaire.definition);
    text("runner-questionnaire-keyboard", questionnaire.definition.language.startsWith("de") ? "Tab: navigieren · Pfeiltasten: Antwort wählen" : "Tab: navigate · Arrow keys: choose");
    const current = questionnaire;
    questionnaire.presenter = renderMasterQuestionnaire(query("runner-questionnaire-items"), questionnaire.definition, step.payload.presentation, questionnaire.answers, {
      version: questionnairePreview.plan.version,
      randomSeed: surveyRandomSeed(questionnairePreview.plan.planIdentitySha256, step.position),
      onChange: () => { if (questionnaire === current && current.presenter) text("runner-questionnaire-progress", current.presenter.progress().text); },
      onComplete: () => action(() => showQuestionnairePreview(nextIndex + 1)),
    });
    text("runner-questionnaire-submit", questionnaire.definition.language.startsWith("de") ? "Weiter" : "Next");
    if (questionnaire.presenter) text("runner-questionnaire-progress", questionnaire.presenter.progress().text);
    query("runner-questionnaire-previous").hidden = true;
    query("runner-questionnaire-next").hidden = true;
    query("runner-questionnaire-submit").hidden = true;
    renderControls();
  }
  function stepTitle(step) {
    return step.kind === "questionnaire" ? step.payload.definition.title : step.kind === "interval"
      ? step.payload.definition.isiId : step.payload.entry?.referenceId ?? step.payload.asset.annotationId ?? step.payload.asset.sourceRelativePath ?? "Video";
  }
  function stepLabel(step) {
    return step.kind === "questionnaire" ? "questionnaire" : step.kind === "interval" ? "ISI" : "video";
  }
  function stepDetail(step) {
    const duration = Number.isFinite(step.durationMs) ? `${Number((step.durationMs / 1000).toFixed(3))} s` : "self-paced";
    if (step.kind === "questionnaire") return `${step.payload.definition.items?.length ?? 0} items · ${duration}`;
    if (step.kind === "interval") return `${step.payload.definition.isiId} · ${duration}`;
    const asset = step.payload.asset;
    return `${asset.annotationId ?? step.payload.entry?.referenceId ?? "video"} · ${duration}`;
  }
  function validationNeutralFeedbackState() {
    return { ...runnerMasterFeedbackState(validationPreview.plan.selected.feedback, 0, 0), hideFeedback: false, lockPosition: true };
  }
  function moveQuestionnairePage(delta) {
    const presenter = questionnaire?.presenter, model = presenter?.model;
    if (!model || typeof model.currentPageNo !== "number") return false;
    fillVisibleQuestionnairePage();
    const count = Number(model.visiblePageCount ?? model.visiblePages?.length ?? model.pages?.length ?? 1);
    const next = Math.max(0, Math.min(Math.max(0, count - 1), model.currentPageNo + delta));
    if (next === model.currentPageNo) return false;
    model.currentPageNo = next;
    if (presenter.progress) text("runner-questionnaire-progress", presenter.progress().text);
    query("runner-questionnaire").scrollTo({ top: 0, behavior: "auto" });
    return true;
  }
  async function showValidationPreview(index = 0) {
    const previewPlan = validationPreview?.plan ? validationPreview : await ensureValidationPlan();
    const nextIndex = Math.max(0, Math.min(previewPlan.steps.length - 1, index));
    validationPreview = { ...previewPlan, index: nextIndex };
    const step = validationPreview.steps[nextIndex];
    if (!presentation.active) await presentation.enter();
    clearQuestionnaire();
    validationPlaybackEpoch += 1;
    const playbackEpoch = validationPlaybackEpoch;
    clearValidationTimer();
    const title = stepTitle(step);
    text("runner-session", `${participantLabel(participantId())} · validation step ${nextIndex + 1}/${validationPreview.steps.length}`);
    text("runner-stimulus", title);
    text("runner-timing", step.kind === "interval"
      ? `Hidden validation traversal · waiting ${Number((step.durationMs / 1000).toFixed(3))} s`
      : step.kind === "video"
        ? `Hidden validation traversal · loading ${Number((step.durationMs / 1000).toFixed(3))} s video`
        : "Hidden validation traversal");
    text("runner-write", "No recording");
    text("runner-lsl", "No LSL markers emitted");
    query("runner-pause").disabled = true;
    if (step.kind === "questionnaire") {
      validationVideo.stop();
      presentation.showPage("questionnaire"); preview.update({ hideFeedback: true });
      questionnaire = { definition: step.payload.definition, position: step.position, answers: {}, master: false, preview: true, validationPreview: true, version: validationPreview.plan.version };
      query("runner-questionnaire").lang = questionnaire.definition.language;
      renderQuestionnaireParticipantCopy(questionnaire.definition);
      text("runner-questionnaire-keyboard", questionnaire.definition.language.startsWith("de") ? "Tab: navigieren · Pfeiltasten: Antwort wählen" : "Tab: navigate · Arrow keys: choose");
      const current = questionnaire;
      questionnaire.presenter = renderMasterQuestionnaire(query("runner-questionnaire-items"), questionnaire.definition, step.payload.presentation, questionnaire.answers, {
        version: validationPreview.plan.version,
        randomSeed: surveyRandomSeed(validationPreview.plan.planIdentitySha256, step.position),
        onChange: () => { if (questionnaire === current && current.presenter) text("runner-questionnaire-progress", current.presenter.progress().text); },
        onComplete: () => action(() => showValidationPreview(nextIndex + 1)),
      });
      text("runner-questionnaire-submit", questionnaire.definition.language.startsWith("de") ? "Weiter" : "Next");
      if (questionnaire.presenter) text("runner-questionnaire-progress", questionnaire.presenter.progress().text);
      query("runner-questionnaire-previous").hidden = true;
      query("runner-questionnaire-next").hidden = true;
      query("runner-questionnaire-submit").hidden = true;
    } else {
      presentation.showPage("run");
      const stage = root.querySelector(".stimulus-stage"), feedback = root.querySelector(".run-feedback-stage");
      clearMasterDesktopLayout(root);
      applyMasterDesktopLayout(root, validationPreview.plan, windowObject);
      stage.hidden = false;
      feedback.hidden = false;
      query("run-stimulus-placeholder").textContent = "";
      preview.update(validationNeutralFeedbackState());
      if (step.kind === "interval") {
        validationVideo.stop();
        feedback.hidden = false;
        query("run-stimulus-placeholder").textContent = "";
        scheduleValidationStepAdvance(nextIndex, step.durationMs);
      } else if (step.kind === "video") {
        const result = await validationVideo.playStep({
          workspaceId: workspace.workspaceId,
          sourceText: plannerRecipeTransportText(recipe),
          participantId: participantId(),
          selector: validationPreview.plan.selector,
          step,
        });
        if (destroyed || playbackEpoch !== validationPlaybackEpoch || validationPreview?.index !== nextIndex || !result) return;
        query("run-stimulus-placeholder").textContent = "";
        text("runner-timing", `Hidden validation traversal · playing ${Number((step.durationMs / 1000).toFixed(3))} s video`);
        scheduleValidationStepAdvance(nextIndex, step.durationMs);
      }
    }
    renderControls();
  }
  async function traverseValidationPreview(delta) {
    if (delta > 0 && moveQuestionnairePage(1)) return;
    if (delta < 0 && moveQuestionnairePage(-1)) return;
    const base = validationPreview?.index ?? (delta > 0 ? -1 : 0);
    await showValidationPreview(base + delta);
  }
  function sampleSurveyValue(question) {
    const choice = (question.visibleChoices ?? question.choices ?? question.rateValues ?? [])
      .find(item => item?.value !== undefined && item.value !== "none" && item.value !== "other");
    const value = choice?.value ?? choice ?? "synthetic";
    switch (question.getType?.()) {
      case "text": return question.inputType === "number" ? 30 : "Synthetic Keyboard Test";
      case "comment": return "Synthetic validation response";
      case "checkbox": return [value];
      case "boolean": return true;
      case "multipletext": return Object.fromEntries((question.items ?? []).map(item => [item.name, item.inputType === "number" ? 30 : "Synthetic Keyboard Test"]));
      default: return value;
    }
  }
  function fillVisibleQuestionnairePage() {
    const model = questionnaire?.presenter?.model;
    if (!model) return;
    const pageQuestions = model.currentPage?.questions ?? model.getAllQuestions(false, false, true);
    for (const question of pageQuestions) {
      if (!question.isVisible || question.isReadOnly) continue;
      question.value = sampleSurveyValue(question);
    }
    questionnaire?.presenter?.focusFirstUnanswered?.();
    if (questionnaire?.presenter) text("runner-questionnaire-progress", questionnaire.presenter.progress().text);
  }
  function destroy() {
    destroyed = true; revision += 1; windowObject.clearInterval(timer); clearValidationTimer(); validationVideo.destroy();
    clearQuestionnaire();
    questionnaireKeyboard.destroy();
    listeners.forEach((remove) => remove()); participantPicker.destroy(); variantPicker.destroy(); recentFiles.destroy(); controllerSettings.destroy(); legacyProtocol.destroy(); masterProtocol.destroy(); preview.destroy(); delete root.researchUi;
  }
  function renderControls() {
    const activeBrowserRun = browserAttempt?.active === true;
    const locked = busy || protocol.active || activeBrowserRun || recorder?.active === true;
    for (const id of ["runner-open", "runner-folder", "runner-variant", "runner-attempt", "runner-record-own", "runner-discover"]) query(id).disabled = locked;
    query("runner-validation").disabled = locked || ![3, 4, 5].includes(recipe?.recipe?.version);
    recentFiles.lock(locked);
    root.querySelectorAll("[data-stream-key]").forEach(element => { element.disabled = locked; });
    // An armed recorder binds the recipe, then the attempt on activation. It
    // must not prevent the participant from completing the first form.
    query("runner-language-reset").disabled = busy || protocol.active;
    participantPicker.lock(busy || protocol.active || recorder?.active === true || !recipe);
    variantPicker.lock(locked || !recipe);
    root.querySelectorAll("[data-language-option]").forEach(element => { element.disabled = busy || protocol.active; });
    query("runner-language-reset").disabled ||= !recipe;
    query("runner-launch").disabled = busy || protocol.active || !recipe || !participantPicker.participantId;
    query("runner-launch").disabled ||= Boolean(recipe?.recipe && (!value("runner-variant") || recipe.recipe.presentationTarget !== "desktop-screen"));
    query("runner-sequence-preview").disabled = busy || protocol.active || !recipe || !participantPicker.participantId;
    query("runner-preview-language-reset").disabled = busy || protocol.active || !recipe;
    query("runner-prepare").disabled = busy || protocol.active || !recipe;
    query("runner-prepare").hidden = [2, 3, 4, 5].includes(recipe?.recipe?.version);
    for (const id of ["runner-professor", "runner-controller", "runner-remote", "runner-settings", "runner-preparation-settings", "runner-back"]) query(id).disabled = busy || protocol.active;
    query("runner-controller").disabled ||= recorder?.active === true;
    query("runner-check").disabled = busy || protocol.active || !recipe || !workspace?.selected || !value("runner-participant") || !path.length;
    query("runner-test").disabled = busy || protocol.active || !recipe || controllerSettings.overridden;
    query("runner-stop").disabled = busy || (!protocol.active && !activeBrowserRun);
    query("runner-record-start").disabled = busy || protocol.active || recorder?.active === true || !recipe || !workspace?.selected || recorder?.available !== true;
    query("runner-record-start").disabled ||= Boolean(recipe?.recipe && (!participantPicker.participantId || !value("runner-variant")));
    query("runner-record-stop").disabled = busy || recorder?.active !== true || protocol.active;
    if (browserMode) {
      query("runner-record-start").disabled = true;
      query("runner-record-stop").disabled = true;
      query("runner-discover").disabled = true;
      query("runner-record-own").disabled = true;
    }
    query("runner-demographics").hidden = [2, 3, 4, 5].includes(recipe?.recipe?.version) || value("runner-attempt") !== "new-attempt";
    if (questionnaire) {
      const disabled = busy || (questionnaire.master && masterProtocol.status?.phase !== "questionnaire");
      questionnaire.presenter?.setDisabled(disabled);
      if (!questionnaire.presenter?.usesSurveyJS) query("runner-questionnaire-items").querySelectorAll("input,textarea").forEach(input => { input.disabled = disabled; });
      query("runner-questionnaire-submit").disabled = disabled;
      query("runner-questionnaire-next").disabled = disabled;
      query("runner-questionnaire-previous").disabled = disabled || questionnaire.itemIndex === 0;
      if (!disabled) questionnaireKeyboard.focusInitial();
    }
  }
  function renderLanguage() {
    const choosingInPreparation = query("runner-language").contains(document.activeElement);
    for (const id of ["runner-language", "runner-preview-language"]) {
    const host = query(id); host.replaceChildren();
    if (!recipe) return;
    const step = resolveLanguageSelectionTraversalStepV1(runnerLanguageTree(recipe), path);
    const prompt = document.createElement("p"); prompt.textContent = step.kind === "terminal" ? step.labels.join(" → ") : step.prompt; host.append(prompt);
    if (step.kind === "choice") for (const option of step.options) {
      const button = document.createElement("button"); button.type = "button"; button.dataset.languageOption = option.optionId; button.textContent = option.label;
      button.addEventListener("click", () => { if (busy || protocol.active) return; path = [...path, option.optionId]; invalidate(); renderLanguage(); refreshTimeline(); if (id === "runner-language" && presentation.active && [2, 3, 4, 5].includes(recipe.recipe?.version) && resolveLanguageSelectionTraversalStepV1(runnerLanguageTree(recipe), path).kind === "terminal") prepareAttempt(); }); host.append(button);
    }
    }
    renderControls();
    if (choosingInPreparation) (query("runner-language").querySelector("button") ?? query("runner-prepare")).focus();
  }
  async function refreshTimeline() {
    const host = query("runner-sequence-timeline"); host.replaceChildren();
    if (!query("runner-sequence-dialog").open || !recipe) return;
    const generation = revision;
    try {
      const timeline = await participantPreviewTimeline(recipe, participantId(), path, value("runner-variant"));
      if (destroyed || generation !== revision || !query("runner-sequence-dialog").open) return;
      const version = recipe.recipe ? recipe.recipe.segments.P3.variants.find(item => item.variantId === value("runner-variant")) : null;
      text("runner-sequence-status", timeline.complete
        ? `${participantLabel(participantId())}${version ? ` · ${version.title}` : ""} · ${timeline.events.length - 1} scheduled events. ${timeline.sequence}. Questionnaire durations depend on responses.`
        : `${participantLabel(participantId())}${version ? ` · ${version.title}` : ""} · ${timeline.sequence}. Choose a language to preview the selected version's remaining events.`);
      for (const event of timeline.events) {
        const row = document.createElement("li"), title = document.createElement("strong"), detail = document.createElement("p");
        row.dataset.eventKind = event.kind; row.dataset.protocolPosition = event.protocolPosition ?? "";
        title.textContent = `${event.label} · ${event.title}`;
        if (event.videoRelativePath) {
          const link = document.createElement("a");
          link.href = "#runner-sequence-timeline";
          link.textContent = event.title;
          link.title = `Show in File Explorer: ${event.videoRelativePath}`;
          link.setAttribute("aria-label", `Show ${event.title} in File Explorer`);
          link.addEventListener("click", click => {
            click.preventDefault();
            if (destroyed || generation !== revision || busy || protocol.active) return;
            action(async () => {
              if (!workspace?.selected) throw new Error("Select the experiment's project folder to locate this video.");
              await invoke("research_runner_reveal_video", { workspaceId: workspace.workspaceId, relativePath: event.videoRelativePath });
            });
          });
          title.replaceChildren(`${event.label} · `, link);
        }
        detail.textContent = event.kind === "language" ? event.detail
          : `${event.durationMs === null ? `${event.itemCount} items · Self-paced` : `${Number((event.durationMs / 1000).toFixed(3))} seconds`}${event.blockId ? ` · Block ${event.blockId}` : ""}${event.moduleId ? ` · ${event.moduleId}` : ""}${event.videoId ? ` · ${event.videoId}` : ""}`;
        row.append(title, detail); host.append(row);
      }
    } catch (error) { if (!destroyed && generation === revision) text("runner-sequence-status", messageOf(error)); }
  }
  async function selectionReceipt(id = null, currentRecipe = recipe, currentWorkspace = workspace) {
    if (!currentRecipe || !currentWorkspace?.selected) throw new Error("Select the experiment’s project folder to retain its participant number.");
    const result = await invoke("research_runner_selection", { workspaceId: currentWorkspace.workspaceId, sourceText: plannerRecipeTransportText(currentRecipe), participantId: id });
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
    participantPicker.history(null); variantPicker.history(null);
    if (!recipe || !workspace?.selected) return;
    const generation = revision;
    const result = await selectionReceipt();
    if (destroyed || generation !== revision) return;
    if (restore && !recipe.recipe) participantPicker.restore(result.participantId);
    if (recipe.recipe) {
      const listing = await invoke("research_runner_master_history", { workspaceId: workspace.workspaceId, sourceText: plannerRecipeTransportText(recipe) });
      if (destroyed || generation !== revision) return;
      if (listing?.schema !== "affect-runner-master-history" || listing.recipeSourceByteSha256 !== recipe.canonicalSourceByteSha256) throw new Error("Participant history belongs to another JSON.");
      const usage = await invoke("research_runner_variant_usage", { workspaceId: workspace.workspaceId, sourceText: plannerRecipeTransportText(recipe) });
      if (destroyed || generation !== revision) return;
      // Validate the entire inventory before it can select either field.
      variantPicker.history(usage);
      if (restore || !participantManual) {
        participantPicker.restore(nextParticipant(usage.usedParticipantIds));
        participantManual = false;
      }
      variantPicker.participant(participantPicker.participantId);
      participantPicker.history([...listing.participants, ...usage.usedParticipantIds.map(participantId => ({ participantId, state: "used" }))]);
      if (participantPicker.participantId) retainParticipant().catch(fail);
      renderControls(); return;
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
    questionnairePreview = null; validationPreview = null;
    clearQuestionnaire(); clearValidationPlayback();
    participantManual = false; variantPicker.adopt(null); participantPicker.clear(); text("runner-output-directory", ""); text("runner-recipe-status", "No experiment loaded"); renderControls();
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
    text("runner-recipe-status", master ? `${master.segments.P1.study.title} · master v${master.version}` : `${candidate.package.settings.experiment.title} · package v1`);
    text("runner-preparation-title", [2, 3, 4, 5].includes(master?.version) ? "Experiment language" : "Participant details");
    variantPicker.adopt(candidate);
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
  async function requireNativeMediaReady(generation) {
    const current = await invoke("research_native_media_capability");
    if (destroyed || generation !== revision) return false;
    mediaCapability = current;
    if (!current?.playerActorReady) {
      const reason = current?.reasonCode ?? "native-capability-unavailable";
      if (["native-runtime-verification-pending", "native-gstplay-startup-pending"].includes(reason)) {
        throw new Error("Native video support is still starting. Wait a moment, then press Continue again.");
      }
      throw new Error(`Native video inspection is not ready (${reason}). The experiment remains loaded.`);
    }
    return true;
  }
  async function checkSession() {
    if (controllerSettings.overridden) throw new Error("Controller override execution is not connected yet. Restore the file settings in Set controller to run this recipe.");
    if (!recipe || !workspace?.selected) throw new Error("Open a recipe and select its project folder.");
    const generation = revision, currentRecipe = recipe, currentWorkspace = workspace;
    preflight = null; inputReceipt = null;
    const candidate = await resolveRunnerSelection(currentRecipe, participantId(), path, value("runner-variant"));
    if (currentRecipe.recipe) {
      const native = await invoke("research_runner_master_plan", { sourceText: plannerRecipeTransportText(currentRecipe),
        participantId: participantId(), selector: candidate.selector });
      if (destroyed || generation !== revision) return;
      assertMasterPlanParity(candidate, native);
      selection = candidate;
      text("runner-preflight", `Master interpreted: ${native.steps.length} ordered events. Verifying media…`);
      const scan = await invoke("research_runner_master_rescan", { workspaceId: currentWorkspace.workspaceId, sourceText: plannerRecipeTransportText(currentRecipe) });
      if (destroyed || generation !== revision) return;
      if (scan.workspaceId !== currentWorkspace.workspaceId) throw new Error("Master media scan belongs to another workspace.");
      if (!await requireNativeMediaReady(generation)) return;
      const attested = await attestMasterMedia({ recipe: currentRecipe.recipe, controller: media, workspaceId: currentWorkspace.workspaceId, stimuli: scan.stimuli,
        viewportHost: query("runner-settings-dialog").open ? query("runner-settings-dialog") : query("runner-preparation") });
      if (attested.failures.length) throw new Error(`${attested.failures.length} master video files could not be verified by the native decoder.`);
      const validation = query("runner-validation").checked;
      const preflightResponse = await invoke(validation ? "research_runner_master_validation_preflight" : "research_runner_master_preflight", { request: { workspaceId: currentWorkspace.workspaceId, sourceText: plannerRecipeTransportText(currentRecipe),
        participantId: participantId(), selector: candidate.selector } });
      if (destroyed || generation !== revision) return;
      if (validation && (preflightResponse.schema !== "affect-runner-validation-preflight" || preflightResponse.version !== 1)) throw new Error("Invalid validation preflight receipt.");
      const checked = validation ? preflightResponse.result : preflightResponse;
      if (checked?.schema !== "affect-runner-master-preflight" || checked.version !== candidate.version || checked.planIdentitySha256 !== candidate.planIdentitySha256 || checked.recipeSourceByteSha256 !== candidate.recipeSourceByteSha256) throw new Error("Native master preflight does not bind this selection.");
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
    const scan = await invoke("research_rescan_package_stimuli", { workspaceId: currentWorkspace.workspaceId, sourceText: plannerRecipeTransportText(currentRecipe) });
    if (destroyed || generation !== revision) return;
    if (scan.workspaceId !== currentWorkspace.workspaceId) throw new Error("Media scan belongs to a different project folder.");
    if (!await requireNativeMediaReady(generation)) return;
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
    if (destroyed || !status.active) return;
    const step = plan.steps[status.position - 1];
    if (!step) throw new Error("Native master status references an absent occurrence.");
    text("runner-session", `${participantLabel(status.participantId)} · ${status.position}/${status.stepCount}`);
    text("runner-stimulus", step.kind === "video" ? step.payload.asset.annotationId : step.kind === "interval" ? "Interval" : step.payload.definition.title);
    text("runner-timing", `${status.sampleCount} samples · ${status.missedSlotCount} missed slots`);
    query("runner-pause").disabled = !["playing", "paused"].includes(status.phase); query("runner-pause").textContent = status.phase === "paused" ? "Resume" : "Pause";
    if (step.kind === "questionnaire") {
      presentation.showPage("questionnaire"); preview.update({hideFeedback:true});
      if (questionnaire?.position !== status.position) {
        clearQuestionnaire();
        questionnaire = {definition:step.payload.definition,position:status.position,answers:structuredClone(status.answers),master:true,version:plan.version};
        query("runner-questionnaire").lang = questionnaire.definition.language;
        renderQuestionnaireParticipantCopy(questionnaire.definition);
        text("runner-questionnaire-keyboard", questionnaire.definition.language.startsWith("de") ? "Tab: navigieren · Pfeiltasten: Antwort wählen" : "Tab: navigate · Arrow keys: choose");
        const current = questionnaire;
        questionnaire.presenter = renderMasterQuestionnaire(query("runner-questionnaire-items"),questionnaire.definition,step.payload.presentation,questionnaire.answers, {
          version: plan.version,
          randomSeed: surveyRandomSeed(plan.planIdentitySha256, status.position),
          onChange: () => { if (questionnaire === current && current.presenter) { text("runner-questionnaire-progress", current.presenter.progress().text); current.draftPending = true; void flushSurveyDraft(current).catch(fail); } },
          onComplete: () => action(async () => {
            if (questionnaire !== current) return;
            await flushSurveyDraft(current);
            await protocol.questionnaireSubmit(questionnaireDetail(current, false));
          }),
        });
        text("runner-questionnaire-submit", questionnaire.definition.language.startsWith("de") ? "Weiter" : "Next");
        if (questionnaire.presenter) text("runner-questionnaire-progress", questionnaire.presenter.progress().text);
        query("runner-questionnaire-previous").hidden=true; query("runner-questionnaire-next").hidden=true; query("runner-questionnaire-submit").hidden=true;
      }
      query("runner-questionnaire-submit").disabled=status.phase!=="questionnaire";
    } else {
      clearQuestionnaire(); presentation.showPage("run");
      applyMasterDesktopLayout(root,plan,windowObject);
      const videoStep = step.kind === "video";
      root.querySelector(".stimulus-stage").hidden=!videoStep;
      root.querySelector(".run-feedback-stage").hidden=!videoStep;
      query("run-native-video-host").hidden=!videoStep;
      query("run-stimulus-placeholder").textContent = videoStep ? "" : "";
      preview.update(videoStep ? runnerMasterFeedbackState(plan.selected.feedback,status.currentValence,status.currentArousal) : {...runnerMasterFeedbackState(plan.selected.feedback,status.currentValence,status.currentArousal),hideFeedback:true});
      if (videoStep && status.phase === "awaitingPresentation") {
        const ready=await setRegion(root.querySelector(".run-feedback-stage"),"runFeedback");
        if (!ready.runReady) throw new Error("Native participant input is not ready for this video.");
      }
    }
    renderControls();
  }
  function renderQuestionnaire(detail) {
    if (protocol.active) presentation.showPage(detail.active === false ? "run" : "questionnaire");
    else query("runner-questionnaire").hidden = true;
    if (detail.active === false) { clearQuestionnaire(); return; }
    const definitions = selection?.compiled.settings.questionnaires.definitions;
    const definition = definitions?.find((item) => item.questionnaireId === detail.questionnaireId);
    if (!definition) throw new Error("The native questionnaire is absent from the frozen recipe.");
    validateQuestionnaireAnswers(definition, detail.answers, { allowPartial: true });
    if (questionnaire?.position === detail.protocolStepPosition) return; // Preserve local focus and newer pending choices.
    clearQuestionnaire();
    questionnaire = { definition, position: detail.protocolStepPosition, answers: { ...detail.answers }, itemIndex: 0 };
    renderQuestionnaireItem();
  }
  function renderQuestionnaireItem() {
    text("runner-questionnaire-submit", "Next");
    query("runner-questionnaire-previous").hidden = false;
    const { definition, itemIndex } = questionnaire;
    renderQuestionnaireParticipantCopy(definition);
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
    if ([2, 3, 4, 5].includes(recipe.recipe?.version)) { path = []; renderLanguage(); }
    await presentation.enter();
  }));
  const participantRecord = () => deriveParticipantRecord({ firstName: value("runner-first"), lastName: value("runner-last"), age: Number(value("runner-age")), gender: value("runner-gender"), handedness: value("runner-hand") });
  const prepareAttempt = () => action(async () => {
    await resolveRunnerSelection(recipe, participantId(), path, value("runner-variant"));
    if (browserMode && recipe?.recipe) {
      await startBrowserAttempt();
      return;
    }
    if (![2, 3, 4, 5].includes(recipe.recipe?.version) && value("runner-attempt") === "new-attempt") participantRecord();
    await checkSession();
    await startAttempt();
  });
  listen(query("runner-prepare"), "click", prepareAttempt);
  listen(query("runner-back"), "click", () => action(async () => {
    await presentation.leave(); invalidate(); query("runner-test-region").hidden = true;
    query("runner-first").value = ""; query("runner-last").value = "";
    await invoke("research_input_cancel_setup");
  }));
  listen(windowObject, "keydown", event => {
    if (event.key === "Escape" && event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey
      && !event.isComposing && (presentation.active || presentation.entering)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) requestAbort();
      return;
    }
  }, true);
  listen(windowObject, "keydown", event => {
    if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey && !event.repeat && !event.isComposing) {
      const key = event.key.toLowerCase();
      if (["n", "b"].includes(key)) {
        event.preventDefault();
        action(() => traverseValidationPreview(key === "n" ? 1 : -1));
        return;
      }
    }
    if (event.ctrlKey && event.altKey && event.shiftKey && !event.repeat && !event.isComposing) {
      const key = event.key.toLowerCase();
      if (["q", "n", "p", "f"].includes(key)) {
        event.preventDefault();
        if (key === "q") action(async () => {
          questionnairePreview = null;
          const previewPlan = await ensurePreviewPlan();
          questionnairePreview = { ...previewPlan, index: 0 };
          await showQuestionnairePreview(0);
        });
        else if (key === "n") action(() => showQuestionnairePreview((questionnairePreview?.index ?? -1) + 1));
        else if (key === "p") action(() => showQuestionnairePreview((questionnairePreview?.index ?? 1) - 1));
        else if (key === "f") fillVisibleQuestionnairePage();
        return;
      }
    }
    if (event.key !== "Escape" || event.altKey || event.ctrlKey || event.shiftKey || event.metaKey || event.repeat || event.isComposing || !presentation.active || root.querySelector("dialog[open]")) return;
    event.preventDefault();
    if (protocol.active) query("runner-session-dialog").showModal();
    else query("runner-back").click();
  });
  async function refreshRecentFiles() {
    const listing = await invoke("research_runner_recent_experiments", { action: "list" });
    if (destroyed) return;
    recentFiles.render(listing); recentExperiments = listing;
  }
  async function loadExperiment(previous = false) {
    if (protocol.active || recorder?.active) throw new Error("Finish the active session or recording before loading an experiment.");
    const loaded = typeof previous === "string" ? await invoke("research_runner_recent_experiments", { action: "load", entryId: previous })
      : previous ? await invoke("research_runner_previous_experiment", { action: "load" }) : await invoke("research_load_planner_recipe");
    if (!loaded) return;
    const receipt = loaded.document;
    workspace = loaded.workspace ?? await invoke("research_workspace_status");
    text("runner-workspace-status", workspace?.selected ? workspace.displayName : "No project folder selected.");
    const adopted = await adoptRecipe(new TextEncoder().encode(plannerRecipeTransportText(receipt)));
    if (destroyed || adopted === false) return;
    if (recipe?.canonicalSourceByteSha256 !== receipt.canonicalSourceByteSha256) { invalidate(); recipe = null; throw new Error("Native and frontend package bytes disagree."); }
    try { await invoke("research_runner_previous_experiment", { action: "confirm", sourceSha256: receipt.canonicalSourceByteSha256 }); await refreshRecentFiles(); }
    catch { throw new Error("Experiment loaded, but its recent-file history could not be saved."); }
    focusAfterAction = query("runner-variant-field").hidden ? query("runner-participant") : query("runner-variant-button");
  }
  listen(query("runner-open"), "click", () => action(() => loadExperiment()));
  listen(query("runner-folder"), "click", () => action(async () => { invalidate(); workspace = await invoke("research_choose_workspace"); text("runner-workspace-status", workspace.selected ? workspace.displayName : "No project folder selected."); text("runner-output-directory", ""); await refreshParticipantHistory(true); }));
  for (const id of ["runner-language-reset", "runner-preview-language-reset"]) listen(query(id), "click", () => { path = []; invalidate(); renderLanguage(); refreshTimeline(); });
  listen(query("runner-sequence-preview"), "click", () => { query("runner-sequence-dialog").showModal(); renderLanguage(); refreshTimeline(); });
  listen(query("runner-attempt"), "change", invalidate);
  listen(query("runner-check"), "click", () => action(checkSession));
  listen(query("runner-test"), "click", () => action(async () => {
    await prepareInputTestRegion();
    await setRegion(query("runner-test-region"), "setupTest"); await invoke("research_input_begin_test", { binding: runnerInput(recipe) });
  }));
  listen(query("runner-test-region"), "keydown", event => {
    // Native hooks observe the physical key. Do not let its browser scroll
    // default move the registered region and cancel that same test.
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) event.preventDefault();
  });
  listen(query("runner-validation"), "change", () => { invalidate(); renderControls(); });
  async function startAttempt() {
    if (abortPending) return;
    if (!selection || !preflight) throw new Error("Check the current selection first.");
    if (!presentation.active) throw new Error("Enter fullscreen participant preparation first.");
    if (controllerSettings.overridden) throw new Error("Controller override execution is not connected yet.");
    const disposition = value("runner-attempt");
    if (recipe.recipe && disposition !== "new-attempt") throw new Error("Master recovery is not implemented. Start an explicitly confirmed new attempt; prior partial files remain retained.");
    if (disposition !== "finalize") {
      if ((!query("runner-validation").checked && !capability?.nativeStartReady) || !preflight.nativeStartReady) throw new Error("Native experiment playback is not qualified in this build.");
      const status = await invoke("research_input_status");
      inputReceipt = status.receipt;
      if (!inputReceipt) throw new Error("The configured input needs a fresh test. Open Session settings, test all four directions, then continue.");
    }
    if (abortPending) return;
    const participant = ![2, 3, 4, 5].includes(recipe.recipe?.version) && disposition === "new-attempt" ? participantRecord() : null;
    query("runner-first").value = ""; query("runner-last").value = "";
    if (recipe.recipe) {
      const request = {workspaceId:workspace.workspaceId,sourceText:plannerRecipeTransportText(recipe),selector:selection.selector,
        inputTestReceiptId:inputReceipt.receiptId,rerunConfirmed:query("runner-rerun").checked};
      if ([2, 3, 4, 5].includes(selection.version)) Object.assign(request, {version:selection.version,participantId:participantId()});
      else request.participant = {participantId:participantId(),...participant};
      await masterProtocol.start(selection, request, {validation:query("runner-validation").checked});
      inputReceipt=null; renderControls(); return;
    }
    await protocol.start({ ...selection.detail, participant, inputTestReceiptId: inputReceipt?.receiptId,
      attemptDisposition: disposition, recoveryFinalizationOnly: disposition === "finalize", rerunConfirmed: query("runner-rerun").checked }, workspace.workspaceId);
  }
  listen(query("runner-pause"), "click", () => action(() => protocol.togglePause()));
  listen(query("runner-stop"), "click", () => query("runner-stop-dialog").showModal());
  listen(query("runner-stop-cancel"), "click", () => query("runner-stop-dialog").close());
  listen(query("runner-stop-confirm"), "click", () => { query("runner-stop-dialog").close(); action(() => browserAttempt?.active ? finishBrowserAttempt("partial") : protocol.finish("stopEarly")); });
  async function commitQuestionnaireDraft(target) {
    const current = questionnaire;
    if (!current || busy || (!target.dataset.answerItem && !target.dataset.formItem)) return false;
    if (!current.presenter) current.answers[target.dataset.answerItem] = [2, 3, 4, 5].includes(current.version)
      ? {kind:"singleChoice",optionId:target.value} : target.value;
    if (browserAttempt?.active) return true;
    let accepted = false;
    await action(async () => {
      if (questionnaire !== current) return;
      const detail = questionnaireDetail(current, true);
      await protocol.questionnaireDraft(detail);
      accepted = questionnaire === current;
    });
    return accepted;
  }
  async function flushSurveyDraft(current) {
    if (current.draftPromise) return current.draftPromise;
    current.draftPromise = (async () => {
      while (current.draftPending && questionnaire === current && protocol.active) {
        if (masterProtocol.status?.phase !== "questionnaire") return;
        current.draftPending = false;
        await protocol.questionnaireDraft(questionnaireDetail(current, true));
      }
    })();
    try { await current.draftPromise; } finally { current.draftPromise = null; }
  }
  listen(query("runner-questionnaire-form"), "change", event => { void commitQuestionnaireDraft(event.target); });
  listen(query("runner-questionnaire-form"), "input", () => {
    if (questionnaire?.presenter) text("runner-questionnaire-progress", questionnaire.presenter.progress().text);
  });
  listen(query("runner-questionnaire-form"), "submit", (event) => {
    event.preventDefault(); const current = questionnaire;
    if (!current || busy) return;
    if (current.presenter?.usesSurveyJS) return; // SurveyJS owns Enter, page navigation and completion.
    action(async () => {
      if (questionnaire !== current) return;
      if (browserAttempt?.active) {
        await submitBrowserQuestionnaire(current);
        return;
      }
      await protocol.questionnaireSubmit(questionnaireDetail(current, false));
    });
  });
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
    const recording = { experimentPackageSourceText: plannerRecipeTransportText(recipe),
      recordOwn: query("runner-record-own").checked, discoveryRevision: discovery?.revision ?? null,
      streamKeys: [...root.querySelectorAll("[data-stream-key]:checked")].map((item) => item.dataset.streamKey) };
    const result = await invoke(recipe.recipe ? "research_recorder_start_v2" : "research_recorder_start", { workspaceId: workspace.workspaceId,
      request: recipe.recipe ? { version: 2, participantId: participantId(), variantId: value("runner-variant"), recording } : recording });
    if (result) recorder = result; renderRecorder();
  }));
  listen(query("runner-record-stop"), "click", () => action(async () => { recorder = await invoke("research_recorder_stop"); participantManual = false; variantPicker.reset(); await refreshParticipantHistory(); renderRecorder(); }));
  listen(windowObject, "resize", () => action(async () => {
    if (protocol.active) {
      // Questionnaires intentionally hide the feedback surface. Its region is
      // re-registered when the next native stimulus is prepared.
      await protocol.resize();
      if (!query("runner-stage").hidden) await setRegion(root.querySelector(".run-feedback-stage"), "runFeedback");
    }
    else { inputReceipt = null; await invoke("research_input_cancel_setup"); }
  }));
  listen(root.querySelector(".runner-sidebar"), "scroll", () => {
    if (busy || protocol.active || !recipe || query("runner-test-region").hidden) return;
    if (now() < setupScrollQuietUntil) return;
    revision += 1; inputReceipt = null;
    action(async () => { await invoke("research_input_cancel_setup"); text("runner-input-status", "The test region moved. Test the configured input again."); });
  });
  try {
    [capability, mediaCapability, workspace] = await Promise.all([legacyProtocol.initialize(), invoke("research_native_media_capability"), invoke("research_workspace_status")]);
  } catch (error) { destroy(); throw error; }
  text("runner-capability", browserMode ? "Browser execution available · CSV download replaces LSL/XDF"
    : capability.nativeStartReady ? "Native execution available" : `Native playback not qualified · ${capability.reasonCode}`);
  text("runner-launch-status", browserMode ? "Runs in this browser with local video access and CSV export."
    : capability.nativeStartReady ? "" : "Participant setup available · playback not yet qualified");
  text("runner-workspace-status", workspace?.selected ? workspace.displayName : "No project folder selected.");
  try { await refreshRecentFiles(); } catch (error) { fail(error); }
  try { recorder = await invoke("research_recorder_status"); renderRecorder(); } catch { text("runner-record-status", "Recorder is not included in this build."); }
  timer = windowObject.setInterval(async () => {
    if (destroyed || polling || busy) return; polling = true;
    try {
      if (!protocol.active && recipe && !query("runner-test-region").hidden && query("runner-settings-dialog").open) {
        const generation = revision;
        const status = await invoke("research_input_status");
        if (destroyed || generation !== revision) return;
        inputReceipt = status.receipt; text("runner-input-status", inputReceipt ? "All directions tested. Input ready." : status.phase === "idle" ? "Input test stopped. Select Test configured input again." : `Remaining: ${status.remainingDirections.join(", ")}`);
      }
      if (recorder?.available) { recorder = await invoke("research_recorder_status"); if (!destroyed) renderRecorder(); }
    } catch (error) { if (!destroyed) { inputReceipt = null; fail(error); } }
    finally { polling = false; if (!destroyed) renderControls(); }
  }, pollMs);
  renderControls();
  const controller = Object.freeze({ adoptRecipe, get recipe() { return recipe; }, get selection() { return selection; },
    destroy,
  });
  root.runner = controller;
  if (recentExperiments?.entries.length && !protocol.active && !recorder?.active) await action(() => loadExperiment(true));
  if (!recipe) query("runner-open").focus();
  return controller;
}
