import {
  INPUT_PRESET_IDS,
  INPUT_PRESETS,
} from "./contracts.js";
import { FLUBBER_MAPPING_SPECS } from "./mappings.js";

export const UI_PRESET_IDS = Object.freeze({
  arrowKeys: "arrow-keys",
  wasd: "wasd",
  ijkl: "ijkl",
  numpad: "numpad",
  pointerGrid: "pointer-grid",
  mouseButtonsWheel: "mouse-wheel",
  gamepadDpad: "gamepad-dpad",
  gamepadLeftStick: "gamepad-left-stick",
  gamepadRightStick: "gamepad-right-stick",
});

export const CONTRACT_PRESET_IDS = Object.freeze(Object.fromEntries(
  Object.entries(UI_PRESET_IDS).map(([contractId, uiId]) => [uiId, contractId]),
));

export const SETUP_SECTIONS = Object.freeze([
  Object.freeze({ id: "workspace", label: "Workspace & Libraries" }),
  Object.freeze({ id: "questionnaires", label: "Languages & Study Assets" }),
  Object.freeze({ id: "stimuli", label: "Stimulus Presentation Order" }),
  Object.freeze({ id: "experiment", label: "Experiment" }),
  Object.freeze({ id: "input", label: "Controller / Input Device" }),
  Object.freeze({ id: "visual", label: "Visual Feedback" }),
  Object.freeze({ id: "advanced", label: "Advanced" }),
  Object.freeze({ id: "review", label: "Review & Start" }),
]);

export const RESEARCH_MODES = Object.freeze(["setup", "run"]);
export const ATTEMPT_DISPOSITIONS = Object.freeze(["resume-compatible", "new-attempt"]);

export const RESEARCH_UI_EVENTS = Object.freeze({
  stimulusAuthoringRequest: "affect-research:stimulus-authoring-request",
  videoLibraryChanged: "affect-research:video-library-changed",
  selectWorkspaceRequest: "affect-research:select-workspace",
  openWorkspaceLocationRequest: "affect-research:open-workspace-location",
  rescanWorkspaceRequest: "affect-research:rescan-workspace",
  importVideosRequest: "affect-research:import-videos-request",
  loadSettingsRequest: "affect-research:load-settings-request",
  loadExperimentRequest: "affect-research:load-experiment-request",
  loadExperimentPackageRequest: "affect-research:load-experiment-package-request",
  saveExperimentPackageRequest: "affect-research:save-experiment-package-request",
  saveSettingsRequest: "affect-research:save-settings-request",
  exportPlanRequest: "affect-research:export-plan-request",
  importQuestionnaireRequest: "affect-research:import-questionnaire-request",
  storeQuestionnaireAssetRequest: "affect-research:store-questionnaire-asset-request",
  questionnaireDraftRequest: "affect-research:questionnaire-draft-request",
  questionnaireSubmitRequest: "affect-research:questionnaire-submit-request",
  planReady: "affect-research:plan-ready",
  setupSettingsReady: "affect-research:setup-settings-ready",
  inputTestState: "affect-research:input-test-state",
  inputEdge: "affect-research:input-edge",
  inputBindingChanged: "affect-research:input-binding-changed",
  inputTestReset: "affect-research:input-test-reset",
  inputCaptureRequest: "affect-research:input-capture-request",
  inputCaptureCancel: "affect-research:input-capture-cancel",
  startRequest: "affect-research:start-request",
  startRejected: "affect-research:start-rejected",
  pauseRequest: "affect-research:pause-request",
  stopEarlyRequest: "affect-research:stop-early-request",
  continueRequest: "affect-research:continue-request",
  settingsLoaded: "affect-research:settings-loaded",
  experimentLoaded: "affect-research:experiment-loaded",
  experimentPackageLoaded: "affect-research:experiment-package-loaded",
  capabilityStatus: "affect-research:capability-status",
  workspaceReady: "affect-research:workspace-ready",
  stimuliCatalogued: "affect-research:stimuli-catalogued",
  participantStates: "affect-research:participant-states",
  runStarted: "affect-research:run-started",
  runStatus: "affect-research:run-status",
  questionnaireStatus: "affect-research:questionnaire-status",
  runComplete: "affect-research:run-complete",
});

export const INPUT_PRESET_OPTIONS = Object.freeze(INPUT_PRESET_IDS.map((contractId) => Object.freeze({
  id: UI_PRESET_IDS[contractId],
  contractId,
  label: INPUT_PRESETS[contractId].label,
  digital: INPUT_PRESETS[contractId].kind === "digital",
})));

export const MAPPING_FIELDS = Object.freeze(Object.entries(FLUBBER_MAPPING_SPECS).map(([contractId, spec]) => Object.freeze({
  contractId,
  id: contractId.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`),
  label: spec.label,
  unit: spec.unit,
  allowedMin: spec.allowedMin,
  allowedMax: spec.allowedMax,
  min: spec.defaultMin,
  max: spec.defaultMax,
  driver: spec.defaultDriver,
  reverse: spec.defaultReverse,
})));

export function normalizeSetupSection(sectionId) {
  return SETUP_SECTIONS.some(({ id }) => id === sectionId) ? sectionId : SETUP_SECTIONS[0].id;
}

export function nextOpenSetupSection(currentSectionId, requestedSectionId) {
  const requested = normalizeSetupSection(requestedSectionId);
  return requested === currentSectionId ? null : requested;
}

export function applySetupSectionConfirmation(reviewedSectionIds = [], sectionId) {
  const sectionIndex = SETUP_SECTIONS.findIndex(({ id }) => id === sectionId);
  if (sectionIndex < 0) throw new RangeError("Unknown Setup section confirmation.");
  const reviewed = new Set(reviewedSectionIds);
  reviewed.add(sectionId);
  return Object.freeze({
    reviewedSectionIds: Object.freeze(SETUP_SECTIONS
      .map(({ id }) => id)
      .filter((id) => reviewed.has(id))),
    nextSectionId: SETUP_SECTIONS[sectionIndex + 1]?.id ?? null,
  });
}

export function normalizeResearchMode(mode) {
  return RESEARCH_MODES.includes(mode) ? mode : "setup";
}

export function estimateResearchStorageUse(settings, resolvedPlan) {
  if (!settings || !resolvedPlan) return null;
  const durations = new Map(settings.stimuli.items.map(({ stimulusId, source }) => [
    stimulusId,
    source.durationMs ?? source.observedDurationMs ?? 0,
  ]));
  const sampleRows = resolvedPlan.assignments.reduce((sum, assignment) => sum + assignment.slots.reduce(
    (slotSum, slot) => slotSum + Math.ceil(
      (Math.max(0, durations.get(slot.stimulusId) ?? 0) / 1_000)
      * settings.experiment.samplingFrequencyHz,
    ),
    0,
  ), 0);
  const formatCount = Number(settings.output.csv) + Number(settings.output.tsv);
  // Reserve for the authoritative journal as well as selected tabular exports.
  // The multiplier covers record/index overhead, timing events, frozen
  // snapshots/manifests, and a 25% write/finalization margin.
  const journalBytes = sampleRows * 1_024;
  const tabularBytes = sampleRows * 512 * formatCount;
  const attemptOverheadBytes = resolvedPlan.assignments.length * 64 * 1_024;
  const subtotalBytes = journalBytes + tabularBytes + attemptOverheadBytes;
  const requiredBytes = Math.ceil(subtotalBytes * 1.25);
  if (!Number.isSafeInteger(sampleRows) || !Number.isSafeInteger(requiredBytes)) {
    throw new RangeError("The resolved experiment exceeds the safe storage-estimation range.");
  }
  return Object.freeze({ sampleRows, requiredBytes, estimationVersion: "conservative-v1" });
}

export function normalizeAttemptDisposition(participantState, requestedDisposition) {
  return participantState === "partial" && requestedDisposition === "resume-compatible"
    ? "resume-compatible"
    : "new-attempt";
}
