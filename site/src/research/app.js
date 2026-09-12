import { canonicalJson, canonicalSha256, sha256Hex } from "./canonical.js";
import {
  PARTICIPANT_STATUS_LABELS,
  createDefaultResearchSettings,
  createInputBindingPreset,
  importPortableSettingsV1,
  validateInputBindingV1,
  validateResearchSettingsV1,
  validateStimulusV1,
} from "./contracts.js";
import {
  EXTERNAL_ORDER_ALGORITHM_VERSION,
  parseExperimentDefinitionV1,
  resolveExternalExperimentPlanV1,
  serializeExperimentDefinitionV1,
  validateExperimentDefinitionV1,
} from "./external-experiment.js";
import {
  deriveParticipantRecord,
  participantCode,
  participantIds as createParticipantIds,
} from "./identity.js";
import {
  evaluateFlubberMappings,
} from "./mappings.js";
import { ResearchInputController, withCustomDigitalAction } from "./input-controller.js";
import { createResearchPreview, drawAffectField } from "./preview.js";
import { createPreviewResponseSimulator } from "./preview-response-simulator.js";
import { DEFAULT_PREVIEW_TILE_COUNT, parsePreviewTileCount } from "./preview-tiles.js";
import { setSetupAccordionPanelExpanded } from "./setup-accordion-motion.js";
import {
  QUESTIONNAIRE_MODULE_SCHEMA,
  validateQuestionnaireAnswers,
  validateQuestionnaireDefinitionV1,
} from "./questionnaires.js";
import {
  importQuestionnaireAuthoring,
} from "./questionnaire-authoring.js";
import {
  DEFAULT_STUDY_LANGUAGES,
  STUDY_LANGUAGE_OPTIONS,
  analyzeQuestionnaireLanguageCoverage,
  createCoveredFlatLanguageSelectionV1,
  questionnaireFamilyId,
  updateQuestionnaireDefinitionReferences,
} from "./questionnaire-assets.js";
import { QUESTIONNAIRE_INSPIRATION_CATALOGUE } from "./questionnaire-inspiration.js";
import { createQuestionnaireEditor } from "./questionnaire-editor.js";
import { restoreQuestionnaireAuthoring, reconcileQuestionnaireModuleMappings } from "./questionnaire-contribution.js";
import { PREBUILT_QUESTIONNAIRE_ASSETS, prebuiltQuestionnaireAvailability } from "./questionnaire-prebuilt.js";
import { requestQuestionnaireAssetStorage } from "./questionnaire-storage-request.js";
import { requestExperimentPackageSave } from "./package-save-request.js";
import { createPackageExportController } from "./package-export-controller.js";
import { createPlannerContributionRegistry, registerAvailablePlannerContributions, PLANNER_SEGMENT_SECTIONS } from "./planner-contributions.js";
import {
  applyLegacySettingsV1ToResearchSettingsV3,
  QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
  resolveProtocolPlanV2,
  validateQuestionnaireModuleV2,
  validateResearchSettingsV3,
} from "./external-protocol.js";
import {
  EXPERIMENT_PACKAGE_FILE_NAME,
  compileExperimentPackageSelectionV1,
  createExperimentPackageV1,
  enumerateLanguageRoutesV1,
  parseExperimentPackageV1,
  resolveLanguageSelectionTraversalStepV1,
  serializeExperimentPackageV1,
  validateExperimentPackageRecoveryBindingV1,
  verifySameRealmPackageReproductionV1,
} from "./experiment-package.js";
import { externalExperimentPlanToCsv } from "./tabular.js";
import {
  BrowserResearchWorkspace,
  isSupportedVideoName,
  normalizeWorkspaceRelativePath,
  parseStrictJson,
  parseExperimentalYouTubeUrl,
  probeVideoFile,
  sha256Blob,
} from "./workspace.js";
import {
  YOUTUBE_PREFLIGHT_MAX_AGE_MS,
  YouTubeIframePlayerAdapter,
  isFreshYouTubePreflight,
} from "./youtube-player.js";
import {
  ATTEMPT_DISPOSITIONS,
  CONTRACT_PRESET_IDS,
  INPUT_PRESET_OPTIONS,
  MAPPING_FIELDS,
  RESEARCH_MODES,
  RESEARCH_UI_EVENTS,
  SETUP_SECTIONS,
  UI_PRESET_IDS,
  applySetupSectionConfirmation,
  estimateResearchStorageUse,
  nextOpenSetupSection,
  normalizeAttemptDisposition,
  normalizeResearchMode,
  normalizeSetupSection,
} from "./ui-contracts.js";
import {
  COLOR_FIELDS,
  describeInputToken,
  renderResearchUiMarkup,
} from "./ui-view.js";

export { renderResearchUiMarkup };

export {
  ATTEMPT_DISPOSITIONS,
  INPUT_PRESET_OPTIONS,
  MAPPING_FIELDS,
  RESEARCH_MODES,
  RESEARCH_UI_EVENTS,
  SETUP_SECTIONS,
  UI_PRESET_IDS,
  applySetupSectionConfirmation,
  estimateResearchStorageUse,
  nextOpenSetupSection,
  normalizeAttemptDisposition,
  normalizeResearchMode,
  normalizeSetupSection,
} from "./ui-contracts.js";

const DEFAULT_SETTINGS = createDefaultResearchSettings();
const MAIA_2_DE_URL = new URL("../../questionnaires/maia-2-de.csv", import.meta.url).href;
const BUNDLED_QUESTIONNAIRES = Object.freeze({
  "maia-2-de": Object.freeze({ url: MAIA_2_DE_URL, logicalName: "maia-2-de.csv" }),
  "maia-2-en": Object.freeze({ url: new URL("../../questionnaires/maia-2-en.csv", import.meta.url).href, logicalName: "maia-2-en.csv" }),
  "ssq-six-item-en": Object.freeze({ url: new URL("../../questionnaires/ssq-six-item-en.csv", import.meta.url).href, logicalName: "ssq-six-item-en.csv" }),
  "vr-exp-en": Object.freeze({ url: new URL("../../questionnaires/vr-exp-en.csv", import.meta.url).href, logicalName: "vr-exp-en.csv" }),
});
const QUESTIONNAIRE_FAMILY_LABELS = Object.freeze({
  "maia-2": "MAIA-2",
  "tas-20": "TAS-20",
  "phencon-long": "PhenCon · full",
  "phencon-short": "Custom PhenCon short adaptation — not standardized",
});
const PRESET_BUNDLED_ASSETS = Object.freeze({
  "maia-2": Object.freeze(["maia-2-en", "maia-2-de"]),
  "tas-20": Object.freeze([]),
  "phencon-long": Object.freeze([]),
  "phencon-short": Object.freeze([]),
});
const SPECIFICATION_SOURCE_SHA256 = "7402c80c6da71d4a11543676acdf0a7640cdb842d55afc10dde6ad3d4978fdbe";
export function bootResearchUi({ surface: requestedSurface } = {}) {
  const mount = document.querySelector("#research-app");
  if (!(mount instanceof HTMLElement)) return null;
  const declaredSurface = mount.dataset.researchSurface === "tauri" ? "tauri" : "browser";
  const surface = requestedSurface ?? declaredSurface;
  if (surface !== declaredSurface) throw new Error("Research surface does not match its entry module.");
  mount.innerHTML = renderResearchUiMarkup(surface);
  mount.setAttribute("aria-busy", "false");
  initializeResearchUi(mount, { surface });
  return mount;
}

export function initializeResearchUi(root, { surface = "browser" } = {}) {
  const shell = root.querySelector(".research-shell");
  if (!(shell instanceof HTMLElement)) throw new Error("Research shell is missing");
  const controller = createUiController(root, { surface });
  root.researchUi = controller;
  registerAvailablePlannerContributions(controller);
  return controller;
}

// Interaction and projection code is kept below the declarative instrument so
// importing this module for contract tests never requires a DOM.
function createUiController(root, { surface }) {
  return createInteractionController(root, { surface });
}

function createInteractionController(root, { surface }) {
  // Implemented in the following section of this module.
  return bindResearchInteractions(root, { surface });
}

function bindResearchInteractions(root, { surface }) {
  const shell = root.querySelector(".research-shell");
  const announcer = root.querySelector("#research-announcer");
  let openSection = "workspace";
  let readySetupSectionCount = 0;
  const reviewedSetupSections = new Set();
  let mode = "setup";
  let selectedParticipant = "P001";
  let inputPoint = { x: 0, y: 0 };
  let previewDesignPoint = { x: 0, y: 0 };
  let previewResponseSimulator = null;
  let feedbackPreviewMode = "flubber";
  let responsePreviewMode = "stepwise";
  let previewColorAnchor = null;
  let previewColorDraft = null;
  let previewColorLabelDraft = null;
  let previewColorRefreshFrame = null;
  const previewAxisLabels = new Map(COLOR_FIELDS
    .filter(({ axisLabel }) => typeof axisLabel === "string")
    .map(({ id, axisLabel }) => [id, axisLabel]));
  let inputBinding = structuredClone(DEFAULT_SETTINGS.input);
  let inputController = null;
  let gamepadCaptureFrame = null;
  let inputTestPassed = false;
  let nativeInputReceiptId = null;
  let nativeCaptureDirection = null;
  let nativeInputLastSequence = 0;
  let lastInputActive = false;
  let ratingInputEnabled = false;
  let outputFormatsTouched = false;
  let participantWindowStart = 0;
  let participantTileWindowStart = 0;
  let dispositionContextKey = "";
  let workspace = null;
  let experimentDocument = null;
  let experimentPackageDocument = null;
  let editablePackageDefaults = null;
  let packageIsStale = false;
  let packageLoadGeneration = 0;
  let observedPackageDraft = null;
  let observedContributions = canonicalJson({ snapshots: [], issues: [] });
  let packageContributionFingerprint = null;
  const packageExport = createPackageExportController({ onChange: () => renderPackageExportReview() });
  const plannerContributions = createPlannerContributionRegistry({ onChange: () => {
    const next = plannerContributions.read().fingerprint;
    if (next === observedContributions) return;
    observedContributions = next;
    packageExport.invalidate();
    if (experimentPackageDocument) {
      packageIsStale = true;
      packageReproductionReceipt = null;
    }
    clearParticipantLanguageSelection();
    schedulePlanRefresh();
  } });
  let browserPackageRoot = null;
  let packageAssetClosureSha256 = null;
  let packageReproductionReceipt = null;
  let compiledPackageSelection = null;
  let selectedLanguageId = null;
  let selectedLanguageSelectionPath = null;
  let selectedLanguageContextKey = null;
  let languageTraversalPath = [];
  let languageSelectionGeneration = 0;
  let languageSelectionBusy = false;
  let studyLanguages = DEFAULT_STUDY_LANGUAGES.map((language) => ({ ...language }));
  let languageEditorLocked = false;
  let loadedLanguageSelection = null;
  let pendingQuestionnaireUpload = null;
  const requestedQuestionnaireFamilies = [];
  const questionnaireAuthoringReceipts = new Map();
  let plan = null;
  let protocolPlan = null;
  let planError = null;
  let planRefresh = 0;
  let settingsSnapshot = null;
  let settingsHash = null;
  let protocolSettingsSnapshot = null;
  let protocolSettingsHash = null;
  let activeQuestionnaire = null;
  let gradientFingerprint = "";
  let youtubePreflightAdapter = null;
  let storageReadiness = null;
  let nativeMediaCapability = null;
  const capabilities = {
    directoryPermission: false,
    indexedDbReady: false,
    timingWorkerReady: false,
    lslReady: false,
    manifestReady: false,
    storageReady: false,
    repositoryAssetsReady: surface === "browser",
    nativePlaybackReady: surface === "browser",
    nativeInputReady: surface === "browser",
    nativeInputPresetReady: surface === "browser",
  };

  function resetInputTest({ notify = true } = {}) {
    inputTestPassed = false;
    nativeInputReceiptId = null;
    if (surface === "tauri" && notify) {
      root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.inputBindingChanged, {
        bubbles: true,
        detail: Object.freeze({ binding: structuredClone(inputBinding) }),
      }));
    }
  }
  let manifestReadinessMessage = "Output manifests have not been scanned.";
  // Retained only as an inert compatibility collection for historical dialog
  // handlers. Active v1 Research planning is owned by experimentDocument.blocks.
  const pools = [];
  const stimuli = [];
  const questionnaireDefinitions = [];
  const questionnaireModules = [];
  let questionnaireContributionRevision = 0;
  let questionnaireContributionFingerprint = null;
  const questionnaireEditor = createQuestionnaireEditor({
    root,
    onChange: () => {
      questionnaireContributionRevision += 1;
      root.researchUi?.plannerContributionChanged?.("P2");
      schedulePlanRefresh();
    },
    onSave: saveEditedQuestionnaire,
    onRemove: removeQuestionnaireFamily,
    onMove: moveQuestionnaireFamily,
  });
  const participantStates = new Map();
  const participantRecoverability = new Map();
  const participantFinalizationPending = new Map();
  const participantFinalizationBindings = new Map();
  const participantRecoveryBindings = new Map();
  const touchedValidationControls = new WeakSet();

  const setupPreview = createResearchPreview(root.querySelector(".preview-pane"), {
    onPositionChange(position) {
      setInputValue("visual-position-x", position.x.toFixed(2));
      setInputValue("visual-position-y", position.y.toFixed(2));
      refreshProjection();
      schedulePlanRefresh();
    },
  });
  // The Run projection owns both the adjacent feedback stage and the visible
  // coordinate receipt in the footer.
  const runPreview = createResearchPreview(root.querySelector('[data-mode-panel="run"]'), {
    initialState: { lockPosition: true },
  });
  previewResponseSimulator = createPreviewResponseSimulator({
    onChange(point) {
      previewDesignPoint = { x: point.x, y: point.y };
      projectDesignPreview();
    },
  });
  configurePreviewResponseSimulator();

  function query(selector) {
    return root.querySelector(selector);
  }

  function value(id, fallback = "") {
    const element = query(`#${id}`);
    return element instanceof HTMLInputElement
      || element instanceof HTMLSelectElement
      || element instanceof HTMLTextAreaElement
      ? element.value
      : fallback;
  }

  function numberValue(id, fallback = 0) {
    const parsed = Number(value(id));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function checked(id) {
    const element = query(`#${id}`);
    return element instanceof HTMLInputElement && element.checked;
  }

  function setInputValue(id, nextValue) {
    const element = query(`#${id}`);
    if (element instanceof HTMLInputElement
      || element instanceof HTMLSelectElement
      || element instanceof HTMLTextAreaElement) {
      element.value = String(nextValue);
    }
  }

  function setChecked(id, nextValue) {
    const element = query(`#${id}`);
    if (element instanceof HTMLInputElement) element.checked = Boolean(nextValue);
  }

  function isValidationControl(element) {
    return element instanceof HTMLInputElement
      || element instanceof HTMLSelectElement
      || element instanceof HTMLTextAreaElement;
  }

  function validationMessage(control) {
    if (control.validity.valueMissing) return "This field is required.";
    if (control.validity.rangeUnderflow) return `Enter a value of at least ${control.min}.`;
    if (control.validity.rangeOverflow) return `Enter a value no greater than ${control.max}.`;
    if (control.validity.stepMismatch) return `Enter a value using increments of ${control.step}.`;
    if (control.validity.patternMismatch) return "Enter a value in the required format.";
    if (control.validity.tooLong) return `Use no more than ${control.maxLength} characters.`;
    if (control.validity.tooShort) return `Use at least ${control.minLength} characters.`;
    if (control.validity.badInput || control.validity.typeMismatch) return "Enter a valid value.";
    return control.validationMessage || "Correct this field before starting.";
  }

  function setErrorReference(control, errorId, enabled) {
    const ids = new Set((control.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(Boolean));
    if (enabled) ids.add(errorId);
    else ids.delete(errorId);
    if (ids.size > 0) control.setAttribute("aria-describedby", [...ids].join(" "));
    else control.removeAttribute("aria-describedby");
  }

  function syncControlValidation(control, { force = false } = {}) {
    // This draft has its own inline feedback and cannot block experiment Start.
    if (control?.id === "preview-tile-count") return true;
    if (!isValidationControl(control) || !control.id || !control.willValidate || control.disabled) return true;
    const inactive = control.closest("#fixed-duration-field[hidden], #jitter-durations-field[hidden]") !== null;
    const invalid = !inactive && !control.checkValidity();
    const errorId = `${control.id}-error`;
    let error = query(`#${errorId}`);
    if (!invalid) {
      control.removeAttribute("aria-invalid");
      control.removeAttribute("aria-errormessage");
      setErrorReference(control, errorId, false);
      if (error instanceof HTMLElement) error.hidden = true;
      return true;
    }
    if (!force && !touchedValidationControls.has(control)) return false;
    if (!(error instanceof HTMLElement)) {
      error = document.createElement("span");
      error.id = errorId;
      error.className = "field-error";
      (control.closest(".field") ?? control.parentElement)?.append(error);
    }
    error.textContent = validationMessage(control);
    error.hidden = false;
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-errormessage", errorId);
    setErrorReference(control, errorId, true);
    return false;
  }

  function syncOutputFormatValidation({ force = false } = {}) {
    const valid = checked("output-csv") || checked("output-tsv");
    const group = query("#output-format-group");
    const error = query("#output-format-error");
    if (group instanceof HTMLElement) {
      if (valid) group.removeAttribute("aria-invalid");
      else if (force || outputFormatsTouched) group.setAttribute("aria-invalid", "true");
    }
    if (error instanceof HTMLElement) error.hidden = valid || (!force && !outputFormatsTouched);
    return valid;
  }

  function syncFieldValidation({ force = false } = {}) {
    let valid = true;
    root.querySelectorAll("input, select, textarea").forEach((control) => {
      if (!syncControlValidation(control, { force })) valid = false;
    });
    return syncOutputFormatValidation({ force }) && valid;
  }

  function announce(message) {
    if (announcer instanceof HTMLElement) announcer.textContent = String(message);
  }

  function setMode(nextMode) {
    mode = normalizeResearchMode(nextMode);
    if (mode !== "setup") previewResponseSimulator?.releaseAll();
    shell.dataset.researchMode = mode;
    root.querySelectorAll("[data-mode-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-mode-panel") !== mode;
    });
    root.querySelectorAll("[data-mode-button]").forEach((button) => {
      const active = button.getAttribute("data-mode-button") === mode;
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    announce(mode === "run" ? "Running the Experiment mode" : "Setting Up the Experiment mode");
  }

  function renderSetupReviewState() {
    for (const { id } of SETUP_SECTIONS) {
      const reviewed = reviewedSetupSections.has(id);
      const section = query(`[data-setup-section="${id}"]`);
      const checkmark = query(`[data-section-review-check="${id}"]`);
      const reviewLabel = query(`[data-section-review-label="${id}"]`);
      const confirmation = query(`[data-section-confirmation-status="${id}"]`);
      const button = query(`[data-confirm-section="${id}"]`);
      if (section instanceof HTMLElement) section.dataset.reviewed = String(reviewed);
      if (checkmark instanceof HTMLElement) checkmark.hidden = !reviewed;
      if (reviewLabel instanceof HTMLElement) reviewLabel.textContent = reviewed ? "Reviewed" : "Not reviewed";
      if (confirmation instanceof HTMLElement) confirmation.textContent = reviewed
        ? "Reviewed for this setup session. Use the section header to open or close it."
        : "Not reviewed yet. Confirm once to mark this section reviewed.";
      if (button instanceof HTMLButtonElement) {
        button.disabled = reviewed;
        button.dataset.reviewState = reviewed ? "reviewed" : "pending";
        button.textContent = reviewed
          ? "Reviewed"
          : id === SETUP_SECTIONS[SETUP_SECTIONS.length - 1].id ? "Confirm review" : "Confirm section";
      }
    }
    const progress = query("#setup-progress");
    if (progress) {
      progress.textContent = `${reviewedSetupSections.size} of ${SETUP_SECTIONS.length} reviewed · ${readySetupSectionCount} ready`;
    }
  }

  function openSetupSection(sectionId, { focus = false } = {}) {
    openSection = sectionId === null ? null : nextOpenSetupSection(openSection, sectionId);
    const panelChanges = [];
    let focusTarget = null;
    root.querySelectorAll("[data-setup-section]").forEach((section) => {
      const isOpen = section.getAttribute("data-setup-section") === openSection;
      const trigger = section.querySelector(".setup-accordion-trigger");
      const panel = section.querySelector(".setup-accordion-panel");
      const wasOpen = trigger instanceof HTMLButtonElement
        ? trigger.getAttribute("aria-expanded") === "true"
        : panel instanceof HTMLElement && !panel.hidden;
      if (trigger instanceof HTMLButtonElement) {
        trigger.setAttribute("aria-expanded", String(isOpen));
        const chevron = trigger.querySelector(".section-chevron");
        if (chevron) chevron.textContent = isOpen ? "−" : "+";
        if (isOpen && focus) focusTarget = trigger;
      }
      if (panel instanceof HTMLElement && wasOpen !== isOpen) {
        panelChanges.push([panel, isOpen]);
      }
    });
    focusTarget?.focus();
    panelChanges.forEach(([panel, isOpen]) => setSetupAccordionPanelExpanded(panel, isOpen));
    if (surface === "tauri" && openSection === "input") {
      queueMicrotask(() => root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.inputBindingChanged, {
        bubbles: true,
        detail: Object.freeze({ binding: structuredClone(inputBinding) }),
      })));
    }
  }

  function confirmSetupSection(sectionId) {
    const transition = applySetupSectionConfirmation(reviewedSetupSections, sectionId);
    reviewedSetupSections.clear();
    transition.reviewedSectionIds.forEach((id) => reviewedSetupSections.add(id));
    const current = SETUP_SECTIONS.find(({ id }) => id === sectionId);
    if (transition.nextSectionId) {
      const next = SETUP_SECTIONS.find(({ id }) => id === transition.nextSectionId);
      openSetupSection(transition.nextSectionId, { focus: true });
      renderSetupReviewState();
      announce(`${current?.label ?? "Setup section"} reviewed. ${next?.label ?? "The next section"} opened.`);
      return;
    }
    query(`#setup-trigger-${sectionId}`)?.focus();
    openSetupSection(null);
    renderSetupReviewState();
    announce(reviewedSetupSections.size === SETUP_SECTIONS.length
      ? `${current?.label ?? "Setup section"} reviewed. All eight setup sections have been reviewed.`
      : `${current?.label ?? "Setup section"} reviewed. There is no next setup section.`);
  }

  function colorValues() {
    return Object.fromEntries(COLOR_FIELDS.map(({ id, value: fallback }) => {
      const current = value(`color-${id}-hex`, fallback).trim().toLowerCase();
      return [id, /^#[0-9a-f]{6}$/.test(current) ? current : fallback];
    }));
  }

  function openPreviewColorDialog(anchorId) {
    const definition = COLOR_FIELDS.find(({ id }) => id === anchorId);
    const dialog = query("#preview-color-dialog");
    const picker = query("#preview-color-picker");
    const hex = query("#preview-color-hex");
    const label = query("#preview-color-label");
    const title = query("#preview-color-dialog-title");
    if (!definition || !(dialog instanceof HTMLDialogElement)
      || !(picker instanceof HTMLInputElement) || !(hex instanceof HTMLInputElement)
      || !(label instanceof HTMLInputElement) || !definition.axisLabel) return;
    previewColorAnchor = definition.id;
    previewColorDraft = colorValues()[definition.id];
    const currentLabel = previewAxisLabels.get(definition.id) ?? definition.axisLabel;
    previewColorLabelDraft = currentLabel;
    picker.value = previewColorDraft;
    hex.value = previewColorDraft;
    label.value = currentLabel === definition.axisLabel ? "" : currentLabel;
    label.placeholder = definition.axisLabel;
    if (title) title.textContent = `${definition.label} color`;
    const status = query("#preview-color-status");
    const error = query("#preview-color-error");
    if (status) {
      status.textContent = "Choose a color and, if useful, add a custom display label.";
      delete status.dataset.state;
    }
    if (error instanceof HTMLElement) error.hidden = true;
    hex.removeAttribute("aria-invalid");
    hex.removeAttribute("aria-errormessage");
    setErrorReference(hex, "preview-color-error", false);
    const apply = query("#preview-color-apply");
    if (apply instanceof HTMLButtonElement) apply.disabled = false;
    dialog.showModal();
    queueMicrotask(() => hex.focus());
  }

  function paintPreviewColorDraft() {
    const colors = colorValues();
    if (previewColorAnchor && previewColorDraft) colors[previewColorAnchor] = previewColorDraft;
    const nextGradientFingerprint = [colors.up, colors.down, colors.left, colors.right].join(":");
    if (nextGradientFingerprint !== gradientFingerprint) {
      gradientFingerprint = nextGradientFingerprint;
      const canvas = query("#main-gradient-canvas");
      if (canvas instanceof HTMLCanvasElement) drawAffectField(canvas, colors);
    }
    setupPreview.update({ colors });
  }

  function schedulePreviewColorPaint() {
    if (previewColorRefreshFrame !== null) return;
    previewColorRefreshFrame = requestAnimationFrame(() => {
      previewColorRefreshFrame = null;
      paintPreviewColorDraft();
    });
  }

  function cancelPreviewColorPaint() {
    if (previewColorRefreshFrame === null) return;
    cancelAnimationFrame(previewColorRefreshFrame);
    previewColorRefreshFrame = null;
  }

  function setPreviewColorLabelDraft(nextValue) {
    const definition = COLOR_FIELDS.find(({ id }) => id === previewColorAnchor);
    if (!definition?.axisLabel) return;
    const normalized = String(nextValue ?? "").trim().replace(/\s+/gu, " ");
    previewColorLabelDraft = normalized || definition.axisLabel;
  }

  function renderPreviewAxisLabel(anchorId, label) {
    root.querySelectorAll(`[data-color-anchor="${anchorId}"]`).forEach((anchor) => {
      const output = anchor.querySelector("[data-color-anchor-label]");
      if (output) output.textContent = label;
      anchor.setAttribute("aria-label", `${label}. Edit anchor color.`);
    });
  }

  function setPreviewColorDraft(nextValue, { synchronizeHex = false } = {}) {
    const normalized = String(nextValue ?? "").trim().toLowerCase();
    const valid = /^#[0-9a-f]{6}$/u.test(normalized);
    const picker = query("#preview-color-picker");
    const hex = query("#preview-color-hex");
    const status = query("#preview-color-status");
    const error = query("#preview-color-error");
    const apply = query("#preview-color-apply");
    previewColorDraft = valid ? normalized : null;
    if (valid && picker instanceof HTMLInputElement) picker.value = normalized;
    if (synchronizeHex && hex instanceof HTMLInputElement) hex.value = normalized;
    if (status) {
      status.textContent = valid
        ? "Valid color. Apply to keep it, or Cancel to restore the current setting."
        : "Enter a complete value such as #f2c94c.";
      status.dataset.state = valid ? "ready" : "warning";
    }
    if (error instanceof HTMLElement) error.hidden = valid;
    if (hex instanceof HTMLInputElement) {
      if (valid) {
        hex.removeAttribute("aria-invalid");
        hex.removeAttribute("aria-errormessage");
        setErrorReference(hex, "preview-color-error", false);
      } else {
        hex.setAttribute("aria-invalid", "true");
        hex.setAttribute("aria-errormessage", "preview-color-error");
        setErrorReference(hex, "preview-color-error", true);
      }
    }
    if (apply instanceof HTMLButtonElement) apply.disabled = !valid;
    schedulePreviewColorPaint();
  }

  function dismissPreviewColorDialog({ apply = false } = {}) {
    const anchorId = previewColorAnchor;
    const draft = previewColorDraft;
    const labelDraft = previewColorLabelDraft;
    cancelPreviewColorPaint();
    previewColorAnchor = null;
    previewColorDraft = null;
    previewColorLabelDraft = null;
    if (apply && anchorId && draft) {
      const definition = COLOR_FIELDS.find(({ id }) => id === anchorId);
      const axisLabel = labelDraft || definition?.axisLabel;
      setInputValue(`color-${anchorId}`, draft);
      setInputValue(`color-${anchorId}-hex`, draft);
      if (axisLabel) {
        previewAxisLabels.set(anchorId, axisLabel);
        renderPreviewAxisLabel(anchorId, axisLabel);
      }
      schedulePlanRefresh();
      announce(`${axisLabel ?? definition?.label ?? "Preview"} color and display label updated.`);
    }
    closeDialog("preview-color-dialog");
    refreshProjection();
  }

  function isPreviewOnlyControl(target) {
    return target instanceof HTMLInputElement && (
      ["preview-halo-size", "preview-tile-count", "preview-full-span-duration", "preview-repeat-delay"].includes(target.id)
      || target.name === "previewHoldRule"
    );
  }

  function isPreviewResponseControl(target) {
    return target instanceof HTMLInputElement && (
      ["preview-tile-count", "preview-full-span-duration", "preview-repeat-delay"].includes(target.id)
      || target.name === "previewHoldRule"
    );
  }

  function configurePreviewResponseSimulator() {
    previewResponseSimulator?.configure({
      mode: responsePreviewMode,
      fullSpanDurationMs: numberValue("preview-full-span-duration", 2_000),
      tileCount: value("preview-tile-count"),
      holdRule: query('input[name="previewHoldRule"]:checked')?.value ?? "separatePresses",
      repeatDelayMs: numberValue("preview-repeat-delay", 500),
    });
  }

  function driverValue(driver, x, y) {
    if (driver === "x-axis") return (x + 1) / 2;
    if (driver === "y-axis") return (y + 1) / 2;
    if (driver === "radius") return Math.min(1, Math.hypot(x, y));
    if (Math.abs(x) < 0.000001 && Math.abs(y) < 0.000001) return 0;
    const angle = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
    return angle / 360;
  }

  function mappingValues(x, y, { render = true } = {}) {
    const mappings = Object.fromEntries(MAPPING_FIELDS.map((spec) => {
      const disclosure = query(`[data-mapping="${spec.id}"]`);
      if (!(disclosure instanceof HTMLElement)) return [spec.contractId, {
        min: spec.min,
        max: spec.max,
        drivenBy: spec.driver,
        reverse: spec.reverse,
      }];
      const minimum = Number(disclosure.querySelector("[data-mapping-min]")?.value);
      const maximum = Number(disclosure.querySelector("[data-mapping-max]")?.value);
      const driver = disclosure.querySelector("[data-mapping-driver]")?.value ?? spec.driver;
      const reverse = disclosure.querySelector("[data-mapping-reverse]")?.checked === true;
      return [spec.contractId, { min: minimum, max: maximum, drivenBy: driver, reverse }];
    }));
    let values;
    try {
      values = evaluateFlubberMappings(mappings, { x, y });
    } catch {
      values = evaluateFlubberMappings(DEFAULT_SETTINGS.advanced.mappings, { x, y });
    }
    if (!render) return values;
    for (const spec of MAPPING_FIELDS) {
      const disclosure = query(`[data-mapping="${spec.id}"]`);
      if (!(disclosure instanceof HTMLElement)) continue;
      const mapping = mappings[spec.contractId];
      const raw = driverValue(mapping.drivenBy, x, y);
      const t = mapping.reverse ? 1 - raw : raw;
      const result = values[spec.contractId];
      const output = disclosure.querySelector("[data-mapping-output]");
      const meter = disclosure.querySelector("[data-mapping-meter]");
      if (output) output.textContent = `${result.toFixed(3)}${spec.unit ? ` ${spec.unit}` : ""}`;
      if (meter instanceof HTMLElement) meter.style.setProperty("--mapping-progress", `${Math.max(0, Math.min(100, t * 100))}%`);
    }
    return values;
  }

  function previewState({ locked = false, design = false } = {}) {
    const point = design ? previewDesignPoint : inputPoint;
    const mappings = mappingValues(point.x, point.y, { render: design });
    const colors = colorValues();
    if (design && previewColorAnchor && previewColorDraft) colors[previewColorAnchor] = previewColorDraft;
    return {
      x: point.x,
      y: point.y,
      gridVisible: checked("visual-grid-visible"),
      flubberVisible: checked("visual-flubber-visible"),
      hideFeedback: checked("visual-hide-feedback"),
      sizePercent: numberValue("visual-size", 42),
      transparencyPercent: numberValue("visual-transparency", 0),
      position: { x: numberValue("visual-position-x", 0.5), y: numberValue("visual-position-y", 0.5) },
      lockPosition: locked || checked("visual-lock-position"),
      ...(design ? {
        displayMode: feedbackPreviewMode,
        responseMode: responsePreviewMode,
        tileCount: previewResponseSimulator?.snapshot().tileCount ?? DEFAULT_PREVIEW_TILE_COUNT,
      } : {}),
      colors,
      flubber: {
        showOutline: checked("flubber-outline-visible"),
        outlineThickness: numberValue("flubber-outline-thickness", 2),
        showHalo: checked("flubber-halo-visible"),
        ...(design ? { haloSizePercent: numberValue("preview-halo-size", 150) } : {}),
      },
      grid: {
        lineThickness: numberValue("grid-line-thickness", 1),
        showOutline: checked("grid-outline-visible"),
        outlineThickness: numberValue("grid-outline-thickness", 1.5),
        cursorSize: numberValue("grid-cursor-size", 4),
      },
      frequency: mappings.oscillationFrequency,
      edgeSmoothness: mappings.edgeSmoothness,
      amplitude: mappings.projectionAmplitude,
      pulseSynchrony: mappings.pulseSynchrony,
      waveVariation: mappings.waveSizeVariation,
      saturation: mappings.saturation,
    };
  }

  function refreshRangeOutputs() {
    const formatDuration = (duration) => duration >= 1000
      ? `${(duration / 1000).toFixed(duration % 1000 === 0 ? 0 : 1)} s`
      : `${Math.round(duration)} ms`;
    const fields = [
      ["sampling-frequency", (v) => `${Math.round(v)} Hz`],
      ["visual-size", (v) => `${Math.round(v)}%`],
      ["visual-transparency", (v) => `${Math.round(v)}%`],
      ["flubber-outline-thickness", (v) => v.toFixed(2)],
      ["grid-line-thickness", (v) => v.toFixed(2)],
      ["grid-outline-thickness", (v) => v.toFixed(2)],
      ["grid-cursor-size", (v) => v.toFixed(1)],
      ["preview-halo-size", (v) => `${Math.round(v)}%`],
      ["preview-full-span-duration", formatDuration],
      ["preview-repeat-delay", formatDuration],
    ];
    for (const [id, format] of fields) {
      const input = query(`#${id}`);
      const output = input?.parentElement?.querySelector("output");
      if (output) output.textContent = format(numberValue(id));
    }
    const sampling = query("#preview-sampling-rate");
    if (sampling) sampling.textContent = `${Math.round(numberValue("sampling-frequency", 130))} Hz`;
  }

  function renderPreviewDesignControls() {
    const tileInput = query("#preview-tile-count");
    const tileHelp = query("#preview-tile-count-help");
    const tileCount = previewResponseSimulator?.snapshot().tileCount ?? DEFAULT_PREVIEW_TILE_COUNT;
    const validTileCount = parsePreviewTileCount(tileInput?.value) !== null;
    tileInput?.setAttribute("aria-invalid", String(!validTileCount));
    if (tileHelp) tileHelp.textContent = validTileCount
      ? `Odd number, 3–2001. ${tileCount} × ${tileCount} tiles: ${(tileCount - 1) / 2} steps each side of zero.`
      : `Enter an odd whole number from 3 to 2001. Preview remains at ${tileCount} × ${tileCount}.`;
    root.querySelectorAll("[data-feedback-preview-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-feedback-preview-mode") === feedbackPreviewMode));
    });
    root.querySelectorAll("[data-response-preview-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-response-preview-mode") === responsePreviewMode));
    });
    root.querySelectorAll("[data-response-preview-panel]").forEach((panel) => {
      if (panel instanceof HTMLElement) {
        panel.hidden = panel.getAttribute("data-response-preview-panel") !== responsePreviewMode;
      }
    });
    const repeatSettings = query("[data-preview-repeat-settings]");
    const repeatSelected = query('input[name="previewHoldRule"]:checked')?.value === "repeatWhileHeld";
    if (repeatSettings instanceof HTMLElement) repeatSettings.hidden = !repeatSelected;
    const modeLabel = query("[data-preview-mode-label]");
    if (modeLabel) {
      modeLabel.textContent = feedbackPreviewMode === "grid"
        ? "2D Grid"
        : feedbackPreviewMode === "face" ? "Responsive Face" : "Classic Flubber";
    }
    const simulatorHelp = query("#preview-response-simulator-help");
    if (simulatorHelp) {
      simulatorHelp.textContent = responsePreviewMode === "continuous"
        ? "Focus the map and hold the arrow keys to preview full-span travel time. Opposing directions cancel."
        : "Focus the map and use the arrow keys to move one outlined tile at a time.";
    }
  }

  function projectDesignPreview() {
    const projected = previewState({ design: true });
    const nextGradientFingerprint = [projected.colors.up, projected.colors.down, projected.colors.left, projected.colors.right].join(":");
    if (nextGradientFingerprint !== gradientFingerprint) {
      gradientFingerprint = nextGradientFingerprint;
      const canvas = query("#main-gradient-canvas");
      if (canvas instanceof HTMLCanvasElement) drawAffectField(canvas, projected.colors);
    }
    setupPreview.update(projected);
  }

  function refreshDesignPreview() {
    refreshRangeOutputs();
    renderPreviewDesignControls();
    projectDesignPreview();
  }

  function refreshProjection({ designAlreadyProjected = false } = {}) {
    if (!designAlreadyProjected) refreshDesignPreview();
    runPreview.update(previewState({ locked: true }));
    renderExperimentConditionalFields();
    renderInputPreset();
    renderReview();
  }

  function renderExperimentConditionalFields() {
    const selected = query('input[name="transitionMode"]:checked')?.value ?? "fixed";
    const fixed = query("#fixed-duration-field");
    const jitter = query("#jitter-durations-field");
    if (fixed instanceof HTMLElement) fixed.hidden = selected !== "fixed";
    if (jitter instanceof HTMLElement) jitter.hidden = selected !== "jitter";
  }

  function selectedPreset() {
    if (value("input-preset") === "custom") {
      return { id: "custom", contractId: "custom", label: "Custom binding", digital: true };
    }
    return INPUT_PRESET_OPTIONS.find(({ id }) => id === value("input-preset")) ?? INPUT_PRESET_OPTIONS[0];
  }

  function renderBindings() {
    const directionTokens = inputBinding.kind === "digital"
      ? inputBinding.directions
      : {
        up: inputBinding.axes.y,
        down: inputBinding.axes.y,
        left: inputBinding.axes.x,
        right: inputBinding.axes.x,
      };
    root.querySelectorAll("[data-binding-value]").forEach((output) => {
      const direction = output.getAttribute("data-binding-value");
      const suffix = inputBinding.kind === "digital" ? "" : direction === "up" || direction === "right" ? " +" : " −";
      output.textContent = `${describeInputToken(directionTokens[direction])}${suffix}`;
    });
    root.querySelectorAll("[data-binding-direction]").forEach((button) => {
      if (button instanceof HTMLButtonElement) button.disabled = inputBinding.kind !== "digital";
    });
  }

  function renderInputPreset() {
    const preset = selectedPreset();
    const step = query("#input-step-size");
    const applicability = query("#input-step-applicability");
    if (step instanceof HTMLInputElement) step.disabled = !preset.digital;
    if (applicability) applicability.textContent = preset.digital
      ? "Applies to digital edge-triggered presses."
      : "N/A for this continuous / absolute input.";
    const previewInput = query("#preview-input-source");
    if (previewInput) previewInput.textContent = preset.label;
    const summary = query('[data-section-summary="input"]');
    if (summary) summary.textContent = preset.digital ? `${preset.label} · step ${numberValue("input-step-size", 0.1)}` : `${preset.label} · Step Size N/A`;
  }

  function resetBindingsToPreset() {
    const selected = selectedPreset();
    if (selected.contractId === "custom") return;
    inputBinding = structuredClone(createInputBindingPreset(
      selected.contractId,
      selected.digital ? Math.max(0.001, Math.min(1, numberValue("input-step-size", 0.1))) : 0.1,
    ));
    resetInputTest();
    inputController?.setBinding(inputBinding);
    renderBindings();
    schedulePlanRefresh();
    announce(`${selectedPreset().label} bindings restored.`);
  }

  function participantIds() {
    const total = Math.max(1, Math.min(100000, Math.trunc(numberValue("participant-count", 1))));
    return [...createParticipantIds(total)];
  }

  function selectedParticipantState() {
    return participantStates.get(selectedParticipant) ?? "available";
  }

  function selectedAttemptDisposition() {
    const requested = query('input[name="attemptDisposition"]:checked')?.value;
    return normalizeAttemptDisposition(selectedParticipantState(), requested);
  }

  function selectedPendingFinalization() {
    if (surface !== "tauri"
      || selectedParticipantState() !== "partial"
      || selectedAttemptDisposition() !== "resume-compatible"
      || participantFinalizationPending.get(selectedParticipant) !== true) return null;
    const binding = participantFinalizationBindings.get(selectedParticipant);
    const playbackMode = value("native-playback-mode", "nativeGstPlay");
    const protocolContract = experimentPackageDocument
      ? "manifestV4"
      : protocolSettingsSnapshot?.version === 3
        || (protocolSettingsSnapshot?.questionnaires?.modules?.length ?? 0) > 0
        ? "manifestV3"
        : "manifestV2";
    const expectedSettingsSha256 = protocolContract === "manifestV2" ? settingsHash : protocolSettingsHash;
    if (!binding || !settingsSnapshot || !settingsHash || !plan
      || !protocolSettingsSnapshot || !protocolSettingsHash || !protocolPlan
      || binding.protocolContract !== protocolContract
      || binding.settingsSha256 !== expectedSettingsSha256
      || binding.assignmentPlanSha256 !== plan.planHashSha256
      || plan.settingsSha256 !== settingsHash
      || protocolPlan.settingsSha256 !== protocolSettingsHash
      || protocolPlan.assignmentPlanSha256 !== plan.planHashSha256
      || protocolPlan.participantId !== selectedParticipant
      || binding.playbackMode !== playbackMode
      || !["completed", "partial"].includes(binding.completionStatus)) return null;
    return binding;
  }

  function renderAttemptDisposition() {
    const state = selectedParticipantState();
    const recoverable = participantRecoverability.get(selectedParticipant) === true;
    const finalizationPending = participantFinalizationPending.get(selectedParticipant) === true;
    const contextKey = `${selectedParticipant}:${state}:${recoverable}:${finalizationPending}`;
    const fieldset = query("#attempt-disposition");
    const resumeOption = query("#attempt-resume-option");
    const resume = query('input[name="attemptDisposition"][value="resume-compatible"]');
    const startNew = query('input[name="attemptDisposition"][value="new-attempt"]');
    const note = query("#attempt-disposition-note");
    const warning = query("#participant-rerun-warning");
    const activeWarning = query("#participant-active-warning");
    const confirmationField = query("#participant-rerun-confirm-field");
    const confirmation = query("#participant-rerun-confirm");
    if (!(fieldset instanceof HTMLFieldSetElement)
      || !(resume instanceof HTMLInputElement)
      || !(startNew instanceof HTMLInputElement)
      || !(confirmation instanceof HTMLInputElement)) return;

    if (contextKey !== dispositionContextKey) {
      resume.checked = state === "partial" && recoverable;
      startNew.checked = state !== "partial" || !recoverable;
      confirmation.checked = false;
      dispositionContextKey = contextKey;
    }

    fieldset.hidden = state !== "partial" && state !== "complete";
    resume.disabled = state !== "partial" || !recoverable;
    if (resumeOption instanceof HTMLElement) resumeOption.hidden = state !== "partial" || !recoverable;
    if (state === "complete") startNew.checked = true;
    if (confirmationField instanceof HTMLElement) confirmationField.hidden = state !== "complete";
    confirmation.disabled = state !== "complete";
    if (activeWarning instanceof HTMLElement) activeWarning.hidden = state !== "active";

    const disposition = selectedAttemptDisposition();
    const resumesExistingAttempt = state === "partial"
      && recoverable
      && disposition === "resume-compatible";
    for (const id of [
      "participant-first-name", "participant-last-name", "participant-age",
      "participant-gender", "participant-handedness",
    ]) {
      const control = query(`#${id}`);
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
        control.disabled = resumesExistingAttempt || state === "active";
      }
    }
    if (note) {
      note.textContent = state === "partial" && recoverable && disposition === "resume-compatible"
        ? finalizationPending
          ? "A durable terminal intent is pending. With the exact frozen settings and plan selected, this action only reconciles output files; it does not start media, input, timing, or LSL."
          : "Compatibility is checked against the current settings and assignment-plan hashes at Start. Recovery resumes only at a safe boundary."
        : state === "partial"
          ? recoverable
            ? "The recoverable partial remains intact; this choice creates a separate attempt with the next number."
            : "This controlled partial is finalized and cannot resume; Start creates a separately numbered attempt."
          : "Completed evidence remains immutable; only a separately numbered new attempt is allowed.";
    }
    if (warning instanceof HTMLElement) {
      warning.hidden = !(state === "complete" || (state === "partial" && disposition === "new-attempt"));
      warning.textContent = state === "complete"
        ? "This participant is Complete. Confirm the deliberate rerun below; the earlier run is never overwritten."
        : recoverable
          ? "Starting a new attempt leaves the recoverable partial untouched and uses the next attempt number."
          : "The controlled partial remains immutable; a new attempt uses the next attempt number.";
    }
  }

  function renderParticipantGrid() {
    const grid = query("#participant-grid");
    if (!(grid instanceof HTMLElement)) return;
    const ids = participantIds();
    if (!ids.includes(selectedParticipant)) {
      selectedParticipant = ids[0];
      participantTileWindowStart = 0;
    }
    const maximumStart = Math.floor((ids.length - 1) / 60) * 60;
    const start = Math.max(0, Math.min(maximumStart, participantTileWindowStart));
    participantTileWindowStart = start;
    const visible = ids.slice(start, start + 60);
    grid.replaceChildren(...visible.map((id) => {
      const state = participantStates.get(id) ?? "available";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "participant-tile";
      button.dataset.participantId = id;
      button.dataset.participantState = state;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-checked", String(id === selectedParticipant));
      button.tabIndex = id === selectedParticipant ? 0 : -1;
      const strong = document.createElement("strong");
      strong.textContent = id;
      const status = document.createElement("span");
      status.className = "participant-state";
      status.textContent = PARTICIPANT_STATUS_LABELS[state];
      button.append(strong, status);
      return button;
    }));
    renderAttemptDisposition();
    const previous = query("#participant-window-previous");
    const next = query("#participant-window-next");
    const status = query("#participant-window-status");
    if (previous instanceof HTMLButtonElement) previous.disabled = start === 0;
    if (next instanceof HTMLButtonElement) next.disabled = start + visible.length >= ids.length;
    if (status) status.textContent = `Showing ${start + 1}–${start + visible.length} of ${ids.length}`;
  }

  function deriveNameCode() {
    const first = value("participant-first-name").trim();
    const last = value("participant-last-name").trim();
    if (!first || !last) return "";
    try {
      return participantCode(first, last);
    } catch {
      return "";
    }
  }

  function renderNameCode() {
    const output = query("#participant-code");
    if (!output) return;
    const code = deriveNameCode();
    output.textContent = code || "Enter first and last name";
    output.dataset.state = code ? "ready" : "warning";
  }

  function protocolBlockIds() {
    return experimentDocument?.definition.blocks.map(({ blockId }) => blockId) ?? [];
  }

  function resolvedStimuliFromUi() {
    if (!experimentDocument) throw new TypeError("Load a valid experiment.json first.");
    return experimentDocument.definition.stimuli.map((reference) => {
      const matches = stimuli.filter((stimulus) => (
        stimulus.contractSource?.kind === "workspaceFile"
        && stimulus.contractSource.relativePath === reference.relativePath
      ));
      if (matches.length !== 1 || matches[0].verification !== "verified") {
        throw new TypeError(`${reference.relativePath} must resolve to one freshly verified workspace video.`);
      }
      return validateStimulusV1({
        stimulusId: reference.stimulusId,
        title: reference.title,
        source: structuredClone(matches[0].contractSource),
      });
    });
  }

  function mappingsFromUi() {
    return Object.fromEntries(MAPPING_FIELDS.map((spec) => {
      const disclosure = query(`[data-mapping="${spec.id}"]`);
      return [spec.contractId, {
        min: Number(disclosure?.querySelector("[data-mapping-min]")?.value),
        max: Number(disclosure?.querySelector("[data-mapping-max]")?.value),
        drivenBy: disclosure?.querySelector("[data-mapping-driver]")?.value ?? spec.driver,
        reverse: disclosure?.querySelector("[data-mapping-reverse]")?.checked === true,
      }];
    }));
  }

  function synchronizedInputBinding() {
    if (inputBinding.kind !== "digital") return inputBinding;
    const stepSize = numberValue("input-step-size", 0.1);
    if (stepSize !== inputBinding.stepSize) {
      inputBinding = structuredClone(validateInputBindingV1({ ...inputBinding, stepSize }));
      inputController?.setBinding(inputBinding);
    }
    return inputBinding;
  }

  function researchSettingsDraft({ verifySources = true } = {}) {
    if (!experimentDocument) throw new TypeError("Load a valid experiment.json first.");
    return {
      schema: DEFAULT_SETTINGS.schema,
      version: 3,
      experiment: {
        id: value("experiment-id"),
        title: value("experiment-title"),
        participantCount: numberValue("participant-count"),
        samplingFrequencyHz: numberValue("sampling-frequency"),
      },
      stimuli: { items: verifySources ? resolvedStimuliFromUi() : experimentDocument.definition.stimuli.map((reference) => ({
        ...reference,
        sources: stimuli.filter((stimulus) => stimulus.contractSource?.kind === "workspaceFile"
          && stimulus.contractSource.relativePath === reference.relativePath)
          .map((stimulus) => structuredClone(stimulus.contractSource)),
      })) },
      input: structuredClone(verifySources ? synchronizedInputBinding()
        : inputBinding.kind === "digital" ? { ...inputBinding, stepSize: numberValue("input-step-size", 0.1) } : inputBinding),
      visual: {
        gridEnabled: checked("visual-grid-visible"),
        flubberEnabled: checked("visual-flubber-visible"),
        sizePercent: numberValue("visual-size"),
        transparency: numberValue("visual-transparency") / 100,
        hideFeedback: checked("visual-hide-feedback"),
        overlayPosition: {
          x: numberValue("visual-position-x"),
          y: numberValue("visual-position-y"),
        },
        lockPosition: checked("visual-lock-position"),
        flubber: {
          showOutline: checked("flubber-outline-visible"),
          outlineThickness: numberValue("flubber-outline-thickness"),
          showHalo: checked("flubber-halo-visible"),
        },
        grid: {
          lineThickness: numberValue("grid-line-thickness"),
          showOutline: checked("grid-outline-visible"),
          outlineThickness: numberValue("grid-outline-thickness"),
          cursorSize: numberValue("grid-cursor-size"),
        },
        colors: colorValues(),
      },
      advanced: {
        lsl: {
          enabled: checked("lsl-enabled"),
          stateStream: value("lsl-state-stream"),
          streamType: value("lsl-stream-type"),
          markerStream: value("lsl-marker-stream"),
          sourceId: value("lsl-source-id"),
        },
        mappings: mappingsFromUi(),
      },
      output: { csv: checked("output-csv"), tsv: checked("output-tsv") },
      questionnaires: {
        algorithmVersion: QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
        definitions: questionnaireDefinitions.map((definition) => structuredClone(definition)),
        modules: questionnaireModules.map((module) => structuredClone(module)),
      },
      externalProtocol: {
        algorithmVersion: EXTERNAL_ORDER_ALGORITHM_VERSION,
        sourceByteSha256: experimentDocument.sourceByteSha256,
        definitionSha256: experimentDocument.definitionSha256,
        definition: structuredClone(experimentDocument.definition),
      },
    };
  }

  async function researchSettingsFromUi() {
    return validateResearchSettingsV3(researchSettingsDraft());
  }

  function packageDraftFingerprint() {
    try {
      // A loaded design still has editable settings while media verification is
      // pending. Fingerprinting reads its declared sources without requiring a
      // decoder receipt; compilation retains the strict source verifier above.
      const settings = researchSettingsDraft({ verifySources: false });
      // Package construction canonicalizes the imported experiment document.
      // Its whitespace/source-byte hash may change without any design edit;
      // retain the full definition and its semantic hash in this comparison.
      delete settings.externalProtocol.sourceByteSha256;
      return canonicalJson({ settings, languageSelection: languageTreeFromUi() });
    } catch {
      return null; // Invalid/pending edits cannot match an accepted compilation.
    }
  }

  function observePackageDraft() {
    const current = packageDraftFingerprint();
    if (current === observedPackageDraft) return;
    observedPackageDraft = current;
    packageExport.invalidate();
    if (experimentPackageDocument) {
      packageIsStale = true;
      packageReproductionReceipt = null;
      clearParticipantLanguageSelection();
    }
  }

  async function protocolSettingsFromUi(baseSettings = null) {
    return baseSettings ? validateResearchSettingsV3(baseSettings) : researchSettingsFromUi();
  }

  async function applyResearchSettings(settings, {
    preserveVerifiedStimuli = false,
    guard = null,
    packageProjection = false,
  } = {}) {
    const normalized = await validateResearchSettingsV3(settings);
    if (typeof guard === "function" && !guard()) return false;
    if (packageProjection) questionnaireEditor.reset();
    const preservedSourceText = experimentDocument
      && experimentDocument.sourceByteSha256 === normalized.externalProtocol.sourceByteSha256
      && experimentDocument.definitionSha256 === normalized.externalProtocol.definitionSha256
      ? experimentDocument.sourceText
      : null;
    experimentDocument = Object.freeze({
      definition: structuredClone(normalized.externalProtocol.definition),
      sourceText: packageProjection
        ? serializeExperimentDefinitionV1(normalized.externalProtocol.definition)
        : preservedSourceText,
      sourceByteSha256: normalized.externalProtocol.sourceByteSha256,
      definitionSha256: normalized.externalProtocol.definitionSha256,
    });
    setInputValue("experiment-id", normalized.experiment.id);
    setInputValue("experiment-title", normalized.experiment.title);
    setInputValue("participant-count", normalized.experiment.participantCount);
    setInputValue("sampling-frequency", normalized.experiment.samplingFrequencyHz);
    const previousStimuli = new Map(stimuli.map((stimulus) => [stimulus.id, stimulus]));
    stimuli.splice(0, stimuli.length, ...normalized.stimuli.items.map((item) => {
      const previous = previousStimuli.get(item.stimulusId);
      const mayPreserve = preserveVerifiedStimuli
        && previous?.verification === "verified"
        && canonicalJson(previous.contractSource) === canonicalJson(item.source);
      return {
        id: item.stimulusId,
        title: item.title,
        source: "workspace",
        location: item.source.relativePath,
        poolId: null,
        verification: mayPreserve ? "verified" : "pending",
        contractSource: structuredClone(item.source),
        packageAssetPath: mayPreserve ? previous.packageAssetPath : null,
        decodeQualification: mayPreserve ? previous.decodeQualification : undefined,
        file: mayPreserve ? previous.file : undefined,
        youtubePreflight: null,
      };
    }));
    inputBinding = structuredClone(normalized.input);
    resetInputTest();
    setInputValue("input-preset", UI_PRESET_IDS[inputBinding.preset] ?? "custom");
    if (inputBinding.kind === "digital") setInputValue("input-step-size", inputBinding.stepSize);
    inputController?.setBinding(inputBinding);
    setChecked("visual-grid-visible", normalized.visual.gridEnabled);
    setChecked("visual-flubber-visible", normalized.visual.flubberEnabled);
    setInputValue("visual-size", normalized.visual.sizePercent);
    setInputValue("visual-transparency", normalized.visual.transparency * 100);
    setChecked("visual-hide-feedback", normalized.visual.hideFeedback);
    setChecked("visual-lock-position", normalized.visual.lockPosition);
    setInputValue("visual-position-x", normalized.visual.overlayPosition.x);
    setInputValue("visual-position-y", normalized.visual.overlayPosition.y);
    setChecked("flubber-outline-visible", normalized.visual.flubber.showOutline);
    setInputValue("flubber-outline-thickness", normalized.visual.flubber.outlineThickness);
    setChecked("flubber-halo-visible", normalized.visual.flubber.showHalo);
    setInputValue("grid-line-thickness", normalized.visual.grid.lineThickness);
    setChecked("grid-outline-visible", normalized.visual.grid.showOutline);
    setInputValue("grid-outline-thickness", normalized.visual.grid.outlineThickness);
    setInputValue("grid-cursor-size", normalized.visual.grid.cursorSize);
    for (const [id, color] of Object.entries(normalized.visual.colors)) {
      setInputValue(`color-${id}`, color);
      setInputValue(`color-${id}-hex`, color);
    }
    setChecked("lsl-enabled", normalized.advanced.lsl.enabled);
    setInputValue("lsl-state-stream", normalized.advanced.lsl.stateStream);
    setInputValue("lsl-stream-type", normalized.advanced.lsl.streamType);
    setInputValue("lsl-marker-stream", normalized.advanced.lsl.markerStream);
    setInputValue("lsl-source-id", normalized.advanced.lsl.sourceId);
    for (const spec of MAPPING_FIELDS) {
      const disclosure = query(`[data-mapping="${spec.id}"]`);
      const mapping = normalized.advanced.mappings[spec.contractId];
      if (!(disclosure instanceof HTMLElement)) continue;
      disclosure.querySelector("[data-mapping-min]").value = String(mapping.min);
      disclosure.querySelector("[data-mapping-max]").value = String(mapping.max);
      disclosure.querySelector("[data-mapping-driver]").value = mapping.drivenBy;
      disclosure.querySelector("[data-mapping-reverse]").checked = mapping.reverse;
    }
    setChecked("output-csv", normalized.output.csv);
    setChecked("output-tsv", normalized.output.tsv);
    questionnaireDefinitions.splice(
      0,
      questionnaireDefinitions.length,
      ...normalized.questionnaires.definitions.map((definition) => structuredClone(definition)),
    );
    questionnaireModules.splice(
      0,
      questionnaireModules.length,
      ...normalized.questionnaires.modules.map((module) => structuredClone(module)),
    );
    questionnaireAuthoringReceipts.clear();
    if (!languageEditorLocked) {
      requestedQuestionnaireFamilies.splice(0, requestedQuestionnaireFamilies.length);
      for (const module of questionnaireModules) {
        const definition = questionnaireDefinition(module.questionnaireId);
        if (definition) requestQuestionnaireFamily(familyIdForDefinition(definition));
      }
    }
    const normalizedParticipantIds = createParticipantIds(normalized.experiment.participantCount);
    selectedParticipant = normalizedParticipantIds.includes(selectedParticipant)
      ? selectedParticipant
      : normalizedParticipantIds[0];
    participantWindowStart = 0;
    participantTileWindowStart = 0;
    settingsSnapshot = normalized;
    settingsHash = null;
    protocolSettingsSnapshot = null;
    protocolSettingsHash = null;
    plan = null;
    protocolPlan = null;
    compiledPackageSelection = null;
    renderPools();
    renderQuestionnaires();
    renderBindings();
    refreshProjection();
    if (packageProjection) observedPackageDraft = packageDraftFingerprint();
    schedulePlanRefresh();
    const fileStatus = query("#experiment-file-status");
    if (fileStatus) {
      fileStatus.dataset.state = "ready";
      fileStatus.textContent = `${normalized.experiment.id} · ${normalized.experiment.participantCount} participants · definition ${normalized.externalProtocol.definitionSha256}`;
    }
    return true;
  }

  function packageAssetsVerified() {
    if (!experimentPackageDocument) return false;
    if (surface === "browser" && (
      browserPackageRoot !== workspace
      || packageAssetClosureSha256
        !== experimentPackageDocument.package.integrity.assetManifestSha256
    )) return false;
    return experimentPackageDocument.package.assets.stimuli.every((asset) => {
      const logicalPath = asset.relativePath.slice("assets/".length);
      return stimuli.some((stimulus) => (
        stimulus.id === asset.stimulusId
        && stimulus.location === logicalPath
        && stimulus.packageAssetPath === asset.relativePath
        && stimulus.verification === "verified"
        && stimulus.contractSource?.sha256 === asset.sha256
        && stimulus.contractSource?.byteLength === asset.byteLength
        && stimulus.contractSource?.durationMs === asset.durationMs
      ));
    });
  }

  function preflightItems() {
    const pendingFinalization = selectedPendingFinalization();
    if (pendingFinalization) {
      const workspaceReady = capabilities.directoryPermission;
      const manifestsReady = capabilities.manifestReady;
      return [
        { id: "workspace", result: workspaceReady ? "pass" : "block", label: "Workspace", message: workspaceReady ? "Owned libraries ready" : "Reauthorize the exact parent workspace" },
        { id: "experiment", result: "pass", label: "Frozen protocol", message: `Settings ${pendingFinalization.settingsSha256}` },
        { id: "stimuli", result: "warning", label: "Stimuli", message: "Not opened for reload-only finalization" },
        { id: "plan", result: "pass", label: "Frozen plan", message: `external-order-v1 ${pendingFinalization.assignmentPlanSha256}` },
        { id: "input", result: "warning", label: "Input", message: "Not acquired for reload-only finalization" },
        { id: "output", result: "pass", label: "Output", message: `Retry durable ${pendingFinalization.completionStatus} output materialization` },
        { id: "participant", result: "pass", label: "Participant", message: `${selectedParticipant} · attempt ${pendingFinalization.attemptNumber} · no transient demographics required` },
        { id: "recovery", result: manifestsReady ? "pass" : "block", label: "Recovery & manifests", message: manifestsReady ? "Pending native terminal intent is readable" : manifestReadinessMessage },
        { id: "storage", result: "warning", label: "Storage", message: "The durable retry will fail closed if output materialization is unavailable" },
        { id: "timing", result: "warning", label: "Timing", message: "Scheduler is not started for reload-only finalization" },
        { id: "playback", result: "warning", label: "Playback", message: "Player is not started for reload-only finalization" },
        { id: "lsl", result: "warning", label: "LSL", message: "Outlets are not started for reload-only finalization" },
      ];
    }
    const experimentValid = Boolean(experimentDocument)
      && /^[a-z0-9][a-z0-9_-]{0,127}$/.test(value("experiment-id"))
      && value("experiment-title").trim().length > 0
      && Number.isInteger(numberValue("participant-count"))
      && numberValue("participant-count") >= 1;
    const sampleRate = numberValue("sampling-frequency");
    const samplingValid = Number.isInteger(sampleRate) && sampleRate >= 1 && sampleRate <= 240;
    let participantRecord = null;
    try {
      participantRecord = deriveParticipantRecord({
        firstName: value("participant-first-name"),
        lastName: value("participant-last-name"),
        age: numberValue("participant-age"),
        gender: value("participant-gender"),
        handedness: value("participant-handedness"),
      });
    } catch {
      participantRecord = null;
    }
    const participantState = selectedParticipantState();
    const attemptDisposition = selectedAttemptDisposition();
    const rerunConfirmed = participantState === "partial" && attemptDisposition === "new-attempt"
      ? true
      : participantState === "complete" && checked("participant-rerun-confirm");
    const attemptStateValid = participantState !== "active"
      && (participantState !== "complete" || rerunConfirmed);
    const resumesExistingAttempt = participantState === "partial"
      && participantRecoverability.get(selectedParticipant) === true
      && attemptDisposition === "resume-compatible";
    const participantValid = Boolean(selectedParticipant
      && attemptStateValid
      && (resumesExistingAttempt || participantRecord));
    const outputValid = checked("output-csv") || checked("output-tsv");
    const lslValid = !checked("lsl-enabled") || (surface === "tauri" && capabilities.lslReady);
    const questionnaireCoverage = questionnaireLanguageCoverage();
    const workspaceReady = capabilities.directoryPermission;
    const storageEstimate = estimateResearchStorageUse(settingsSnapshot, plan);
    const storageReady = Boolean(storageEstimate
      && capabilities.storageReady
      && storageReadiness?.sufficient === true
      && storageReadiness?.writeReady !== false
      && storageReadiness.requiredBytes === storageEstimate.requiredBytes);
    const referencedStimuli = experimentDocument?.definition.stimuli ?? [];
    const stimuliReady = referencedStimuli.length > 0 && referencedStimuli.every((reference) => (
      stimuli.filter((stimulus) => stimulus.location === reference.relativePath
        && stimulus.source === "workspace" && stimulus.verification === "verified").length === 1
    ));
    const hasUnqualifiedDesktopDecode = surface === "tauri" && stimuli
      .filter(({ source }) => source === "workspace")
      .some(({ decodeQualification }) => decodeQualification === "attestedUnqualified");
    const hasQualifiedNativeDecode = surface === "tauri" && stimuli
      .filter(({ source }) => source === "workspace")
      .every(({ decodeQualification }) => decodeQualification === "attestedQualified");
    const packageAssetsReady = packageAssetsVerified();
    const packageReady = Boolean(
      experimentPackageDocument
      && !packageIsStale
      && !packageExport.snapshot().busy
      && plannerContributions.read().issues.length === 0
      && packageContributionFingerprint === plannerContributions.read().fingerprint
      && packageReproductionReceipt?.byteIdenticalReexport === true
      && packageReproductionReceipt.sameRealmDeterminismVerified === true
      && packageAssetsReady,
    );
    const languageReady = Boolean(
      compiledPackageSelection
      && selectedPackageRoute()
      && selectedLanguageContextKey === participantLanguageContextKey(),
    );
    const playbackMode = value("native-playback-mode", "nativeGstPlay");
    const playbackReady = surface !== "tauri"
      || playbackMode === "unqualifiedWebview"
      || capabilities.nativePlaybackReady;
    const poolCapacity = analyzeLocalCapacity();
    let bindingValid = false;
    try {
      validateInputBindingV1(synchronizedInputBinding());
      bindingValid = true;
    } catch {
      bindingValid = false;
    }
    return [
      { id: "workspace", result: workspaceReady ? "pass" : "block", label: "Workspace", message: workspaceReady ? "Owned libraries ready" : "Select and authorize one parent workspace" },
      { id: "experiment", result: experimentValid && samplingValid ? "pass" : "block", label: "Protocol", message: experimentValid && samplingValid ? `Continuous rating at ${sampleRate} Hz` : "Complete identity, participant count, and a 1–240 Hz integer rate" },
      {
        id: "package",
        result: packageReady ? "pass" : "block",
        label: "Recipe",
        message: packageReady
          ? `${packageReproductionReceipt.caseCount} deterministic cases verified; fixed assets match ${experimentPackageDocument.package.integrity.assetManifestSha256}`
          : packageIsStale ? "Design changed. Edit and save the recipe again."
            : packageExport.snapshot().busy ? "Wait for the recipe save to finish."
              : plannerContributions.read().issues[0]?.message
                ?? (experimentPackageDocument ? "Rescan the project videos before starting." : "Save or load a recipe before starting."),
      },
      {
        id: "language",
        result: languageReady ? "pass" : "block",
        label: "Participant language",
        message: languageReady
          ? `${compiledPackageSelection.languageTag} · ${selectedPackageRoute().labels.join(" › ")}`
          : selectedAttemptDisposition() === "resume-compatible"
            ? "Restore the saved language for this attempt"
            : "Choose a language for this participant",
      },
      {
        id: "stimuli",
        result: stimuliReady && poolCapacity.valid ? "pass" : "block",
        label: "Stimuli",
        message: stimuliReady && poolCapacity.valid
          ? hasQualifiedNativeDecode
            ? `${stimuli.length} complete video${stimuli.length === 1 ? "" : "s"} covered, byte-bound, and decoded by native GstPlay`
            : hasUnqualifiedDesktopDecode
              ? `${stimuli.length} complete video${stimuli.length === 1 ? "" : "s"} covered and byte-bound; representative WebView frames attested (unqualified playback)`
              : `${referencedStimuli.length} referenced complete video${referencedStimuli.length === 1 ? "" : "s"} resolved and byte-verified`
          : poolCapacity.message,
      },
      {
        id: "plan",
        result: plan && settingsHash
          && (surface !== "tauri" || (experimentPackageDocument && capabilities.manifestReady))
          ? "pass" : "block",
        label: "External protocol",
        message: surface === "tauri" && plan && experimentPackageDocument && capabilities.manifestReady
          ? `Rust compiled external-order-v1 ${plan.planHashSha256} from the exact package`
          : plan
            ? `external-order-v1 ${plan.planHashSha256}`
            : (planError ?? "Load and resolve a valid experiment.json"),
      },
      {
        id: "questionnaires",
        result: protocolSettingsSnapshot && protocolSettingsHash && protocolPlan
          && questionnaireCoverage.complete ? "pass" : "block",
        label: "Languages & questionnaire assets",
        message: !questionnaireCoverage.complete
          ? `Supply ${questionnaireCoverage.missing.map(({ familyId, label }) => `${questionnaireFamilyLabel(familyId)} in ${label}`).join("; ")}`
          : protocolPlan
          ? questionnaireModules.length === 0
            ? `${studyLanguages.length} language${studyLanguages.length === 1 ? "" : "s"}; demographics ready; video-only protocol frozen as ${protocolPlan.protocolPlanHashSha256}`
            : `${questionnaireCoverage.familyRows.length} module${questionnaireCoverage.familyRows.length === 1 ? "" : "s"} complete across ${studyLanguages.length} language${studyLanguages.length === 1 ? "" : "s"}`
          : (planError ?? "Validate the session and block hooks"),
      },
      {
        id: "input",
        result: bindingValid && inputTestPassed && capabilities.nativeInputReady && capabilities.nativeInputPresetReady ? "pass" : "block",
        label: "Input",
        message: !bindingValid
          ? "Resolve binding conflicts"
          : !capabilities.nativeInputReady
            ? "The native input authority is unavailable"
            : !capabilities.nativeInputPresetReady
              ? `${selectedPreset().label} has no safe native Tauri backend`
              : inputTestPassed
                ? `${selectedPreset().label} binding and ${surface === "tauri" ? "fresh native" : "live"} input test passed`
                : surface === "tauri"
                  ? `Exercise every direction in a fresh ${selectedPreset().label} native input test`
                  : `Perform a live ${selectedPreset().label} input test`,
      },
      { id: "output", result: outputValid ? "pass" : "block", label: "Output", message: outputValid ? [checked("output-csv") && "CSV", checked("output-tsv") && "TSV"].filter(Boolean).join(" + ") : "Select CSV, TSV, or both" },
      {
        id: "participant",
        result: participantValid ? "pass" : "block",
        label: "Participant",
        message: participantValid
          ? resumesExistingAttempt
            ? `${selectedParticipant} · resume exact durable attempt without re-entering demographics`
            : `${selectedParticipant} · privacy-safe code ${participantRecord.participantCode} · new attempt`
          : participantState === "active"
            ? "The selected participant is Active and locked"
            : participantState === "complete" && !rerunConfirmed
              ? "Confirm the deliberate new attempt for this Complete participant"
              : "Choose a participant and complete required transient details",
      },
      {
        id: "recovery",
        result: (surface === "tauri" || capabilities.indexedDbReady) && capabilities.manifestReady ? "pass" : "block",
        label: "Recovery & manifests",
        message: !(surface === "tauri" || capabilities.indexedDbReady)
          ? "The authoritative recovery journal is unavailable"
          : capabilities.manifestReady
            ? `${surface === "tauri" ? "Native" : "IndexedDB"} recovery journal and output manifests are readable`
            : manifestReadinessMessage,
      },
      {
        id: "storage",
        result: storageReady ? "pass" : "block",
        label: "Storage",
        message: storageReady
          ? `${(storageEstimate.requiredBytes / (1024 * 1024)).toFixed(1)} MiB required; ${(storageReadiness.availableBytes / (1024 * 1024)).toFixed(1)} MiB available${storageReadiness.persisted === false ? " (browser persistence not granted)" : ""}`
          : storageEstimate
            ? "Output and recovery capacity has not passed a current write/quota probe"
            : "Resolve the assignment plan before checking storage capacity",
      },
      { id: "timing", result: capabilities.timingWorkerReady ? "pass" : "block", label: "Timing", message: capabilities.timingWorkerReady ? `${surface === "tauri" ? "Native scheduler available; installed-hardware qualification pending" : "Worker scheduler available; browser timing qualification pending"}` : "Timing authority has not reported ready" },
      ...(surface === "tauri" ? [{
        id: "playback",
        result: playbackReady ? (playbackMode === "unqualifiedWebview" ? "warning" : "pass") : "block",
        label: "Playback",
        message: playbackMode === "unqualifiedWebview"
          ? "Explicit unqualified WebView fallback selected; this attempt cannot qualify the Windows media path"
          : capabilities.nativePlaybackReady
            ? `Pinned native player ${nativeMediaCapability?.pinnedRuntimeVersion ?? "runtime"} is ready`
            : `Qualified native player unavailable (${nativeMediaCapability?.reasonCode ?? "capability not reported"})`,
      }] : []),
      { id: "lsl", result: lslValid ? "pass" : "block", label: "LSL", message: lslValid ? (checked("lsl-enabled") ? "Windows outbound streams ready" : "Disabled") : surface === "browser" ? "Browser builds cannot start with LSL enabled" : "Windows LSL outlet readiness has not passed" },
    ];
  }

  function renderPreflight() {
    const list = query("#preflight-list");
    if (!(list instanceof HTMLElement)) return;
    const items = preflightItems();
    // Group only the repeated missing-document explanation. Underlying gates,
    // their count, and Start/recovery decisions remain independent and intact.
    const awaitingExperiment = !experimentDocument ? items.filter((item) =>
      ["stimuli", "plan", "questionnaires"].includes(item.id) && item.result === "block" && /experiment\.json/u.test(item.message)) : [];
    const displayItems = awaitingExperiment.length > 1 ? items.flatMap((item) => {
      if (!awaitingExperiment.includes(item)) return [item];
      return item !== awaitingExperiment[0] ? [] : [{ ...item,
        id: awaitingExperiment.map(({ id }) => id).join(" "),
        label: awaitingExperiment.map(({ id }) => ({ stimuli: "Videos", plan: "Schedule", questionnaires: "Questionnaires" })[id]).join(" / "),
        message: "Load an experiment in Legacy compatibility.", reveal: "review-legacy-files" }];
    }) : items;
    const repeatedMessages = new Map();
    for (const item of displayItems) {
      const key = `${item.result}:${item.message}`;
      if (!repeatedMessages.has(key)) repeatedMessages.set(key, []);
      repeatedMessages.get(key).push(item);
    }
    const compactItems = [...repeatedMessages.values()].map((group) => group.length === 1 ? group[0] : ({
      ...group[0], id: group.map(({ id }) => id).join(" "), label: group.map(({ label }) => label).join(" / "),
      ...(/terminal language route/u.test(group[0].message)
        ? { message: "Choose the participant's language to prepare the schedule.", reveal: "choose-participant-language" } : {}),
    }));
    const revealTargets = { experiment: "sampling-frequency", package: "package-finalization-title",
      language: "choose-participant-language", participant: selectedParticipantState() === "available" ? "review-participant-details" : "review-participant-chooser",
      storage: "review-provenance", timing: "review-provenance", playback: "review-provenance", output: "output-format-group" };
    list.replaceChildren(...compactItems.map((item) => {
      const row = document.createElement("li");
      row.dataset.result = item.result;
      row.dataset.preflightIds = item.id;
      const result = document.createElement("span");
      result.className = "preflight-result";
      result.setAttribute("role", "img");
      result.textContent = item.result === "pass" ? "✓" : "!";
      result.setAttribute("aria-label", item.result === "pass" ? "Pass" : item.result === "warning" ? "Review" : "Blocking");
      const reveal = item.reveal ?? (item.result === "block" ? revealTargets[item.id] : null);
      const message = document.createElement(reveal ? "button" : "span");
      if (reveal) { message.type = "button"; message.dataset.reviewReveal = reveal; }
      message.textContent = `${item.label}: ${item.message}`;
      row.append(result, message);
      return row;
    }));
    const blocking = items.filter(({ result }) => result === "block");
    const start = query("#start-experiment");
    const status = query("#start-status");
    const pendingFinalization = selectedPendingFinalization();
    if (start instanceof HTMLButtonElement) {
      start.disabled = blocking.length > 0;
      start.textContent = pendingFinalization
        ? `Finalize pending ${pendingFinalization.completionStatus} attempt`
        : "Start experiment / session";
    }
    if (status) status.textContent = blocking.length === 0
      ? pendingFinalization
        ? "Ready to reconcile the durable terminal intent without starting acquisition or playback."
        : "All blocking checks pass. Start will freeze this attempt."
      : `${blocking.length} blocking preflight item${blocking.length === 1 ? "" : "s"} remain.`;
    const pass = (id) => items.some((item) => item.id === id && item.result !== "block");
    const readySections = [
      pass("workspace"),
      pass("questionnaires") || selectedPendingFinalization(),
      pass("stimuli") && pass("plan"),
      pass("experiment"),
      pass("input"),
      Boolean(protocolSettingsSnapshot) || selectedPendingFinalization(),
      pass("timing") && pass("lsl") && (surface !== "tauri" || pass("playback")),
      items.every(({ result }) => result !== "block"),
    ].filter(Boolean).length;
    readySetupSectionCount = readySections;
    renderSetupReviewState();
  }

  function analyzeLocalCapacity() {
    if (!experimentDocument) {
      return { valid: false, message: "Load a valid experiment.json before resolving videos." };
    }
    const problems = experimentDocument.definition.stimuli.flatMap((reference) => {
      const matches = stimuli.filter((stimulus) => stimulus.source === "workspace"
        && stimulus.location === reference.relativePath);
      if (matches.length === 0) return [`Missing ${reference.relativePath}`];
      if (matches.length > 1) return [`Ambiguous duplicate catalogue path ${reference.relativePath}`];
      if (matches[0].verification !== "verified") return [`Verification pending for ${reference.relativePath}`];
      return [];
    });
    return problems.length === 0
      ? {
        valid: true,
        message: `${experimentDocument.definition.stimuli.length} referenced complete video${experimentDocument.definition.stimuli.length === 1 ? "" : "s"} resolve exactly. External participant order and ISI values are frozen.`,
      }
      : { valid: false, message: problems.join(". ") };
  }

  function renderCoverage() {
    const result = analyzeLocalCapacity();
    const message = query("#coverage-message");
    if (message instanceof HTMLElement) {
      message.dataset.state = result.valid ? "ready" : "warning";
      message.textContent = result.message;
    }
  }

  function questionnaireDefinition(questionnaireId) {
    return questionnaireDefinitions.find((definition) => definition.questionnaireId === questionnaireId) ?? null;
  }

  function familyIdForDefinition(definition) {
    return questionnaireFamilyId({
      questionnaireId: definition.questionnaireId,
      language: definition.language,
    });
  }

  function questionnaireFamilyLabel(familyId) {
    if (QUESTIONNAIRE_FAMILY_LABELS[familyId]) return QUESTIONNAIRE_FAMILY_LABELS[familyId];
    const definition = questionnaireDefinitions.find((candidate) => (
      familyIdForDefinition(candidate) === familyId
    ));
    if (definition) return definition.title;
    const catalogueFamilyId = {
      "phencon-long": "phenomenological-control-scale-10",
      "phencon-short": "phencon-short-adaptation",
    }[familyId] ?? familyId;
    return QUESTIONNAIRE_INSPIRATION_CATALOGUE.find(({ id }) => id === catalogueFamilyId)?.shortName
      ?? familyId.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  }

  function coverageSource() {
    if (languageEditorLocked && experimentPackageDocument) {
      return {
        definitions: experimentPackageDocument.package.settings.questionnaires.definitions,
        modules: experimentPackageDocument.package.settings.questionnaires.modules,
      };
    }
    return { definitions: questionnaireDefinitions, modules: questionnaireModules };
  }

  function questionnaireLanguageCoverage() {
    const source = coverageSource();
    return analyzeQuestionnaireLanguageCoverage({
      definitions: source.definitions,
      modules: languageEditorLocked ? source.modules : source.modules.filter((module) => {
        const definition = source.definitions.find(({ questionnaireId }) => questionnaireId === module.questionnaireId);
        return definition && !questionnaireEditor.isPending(familyIdForDefinition(definition), definition.language);
      }),
      languages: studyLanguages,
      requestedFamilyIds: requestedQuestionnaireFamilies,
    });
  }

  function requestQuestionnaireFamily(familyId) {
    if (!requestedQuestionnaireFamilies.includes(familyId)) {
      requestedQuestionnaireFamilies.push(familyId);
    }
  }

  function familyIsIncluded(familyId) {
    return requestedQuestionnaireFamilies.includes(familyId)
      || questionnaireModules.some((module) => {
        const definition = questionnaireDefinition(module.questionnaireId);
        return definition && familyIdForDefinition(definition) === familyId;
      });
  }

  function questionnaireModuleGroups() {
    const groups = [];
    const byFamily = new Map();
    for (const module of questionnaireModules) {
      const definition = questionnaireDefinition(module.questionnaireId);
      const familyId = definition ? familyIdForDefinition(definition) : module.questionnaireId;
      let group = byFamily.get(familyId);
      if (!group) {
        group = { familyId, modules: [] };
        byFamily.set(familyId, group);
        groups.push(group);
      }
      group.modules.push(module);
    }
    return groups;
  }

  function renderStudyLanguages() {
    const list = query("#study-language-list");
    if (list instanceof HTMLElement) {
      list.replaceChildren(...studyLanguages.map((language) => {
        const item = document.createElement("li");
        const identity = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = language.label;
        const tag = document.createElement("small");
        tag.textContent = language.languageTag;
        identity.append(title, tag);
        if (languageEditorLocked || studyLanguages.length === 1) {
          const state = document.createElement("span");
          state.className = "asset-state";
          state.dataset.state = "ready";
          state.textContent = languageEditorLocked ? "Package-owned" : "Required";
          item.append(identity, state);
        } else {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Remove";
          remove.dataset.studyLanguageRemove = language.languageId;
          remove.setAttribute("aria-label", `Remove ${language.label}`);
          item.append(identity, remove);
        }
        return item;
      }));
    }
    const select = query("#study-language-add");
    const add = query("#study-language-add-button");
    const selectedIds = new Set(studyLanguages.map(({ languageId }) => languageId));
    const available = STUDY_LANGUAGE_OPTIONS.filter(({ languageId }) => !selectedIds.has(languageId));
    if (select instanceof HTMLSelectElement) {
      select.replaceChildren(...available.map((language) => {
        const option = document.createElement("option");
        option.value = language.languageId;
        option.textContent = `${language.label} · ${language.languageTag}`;
        return option;
      }));
      select.disabled = languageEditorLocked || available.length === 0;
    }
    if (add instanceof HTMLButtonElement) add.disabled = languageEditorLocked || available.length === 0;
    const note = query("#study-language-mode-note");
    if (note) note.textContent = languageEditorLocked
      ? "These choices belong to the loaded project package. Load an experiment definition to author a different language set."
      : `${studyLanguages.length} language${studyLanguages.length === 1 ? "" : "s"} selected. Add and save each questionnaire in every language.`;
  }

  function renderQuestionnaireCoverage() {
    const coverage = questionnaireLanguageCoverage();
    const head = query("#questionnaire-coverage-head");
    const body = query("#questionnaire-coverage-body");
    const status = query("#questionnaire-coverage-status");
    if (head instanceof HTMLElement) {
      const row = document.createElement("tr");
      for (const label of ["Module", ...studyLanguages.map(({ label }) => label), "Actions"]) {
        const cell = document.createElement("th");
        cell.textContent = label;
        row.append(cell);
      }
      head.replaceChildren(row);
    }
    if (body instanceof HTMLElement) {
      if (coverage.familyRows.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = studyLanguages.length + 2;
        cell.className = "empty-state";
        cell.textContent = "Include a module to check its language assets.";
        row.append(cell);
        body.replaceChildren(row);
      } else {
        body.replaceChildren(...coverage.familyRows.map((family) => {
          const row = document.createElement("tr");
          row.dataset.questionnaireCoverageFamily = family.familyId;
          const identity = document.createElement("th");
          identity.scope = "row";
          const title = document.createElement("strong");
          title.textContent = questionnaireFamilyLabel(family.familyId);
          const detail = document.createElement("small");
          detail.textContent = family.complete ? "All selected languages ready" : "Translation required";
          identity.append(title, detail);
          row.append(identity);
          for (const language of family.languages) {
            const cell = document.createElement("td");
            const state = document.createElement("span");
            state.className = "asset-state";
            state.dataset.state = language.covered ? "ready" : "missing";
            state.textContent = language.covered ? "Ready" : "Missing";
            cell.append(state);
            if (!language.covered && !languageEditorLocked) {
              const upload = document.createElement("button");
              upload.type = "button";
              upload.textContent = "Upload file";
              upload.dataset.questionnaireUploadFamily = family.familyId;
              upload.dataset.questionnaireUploadLanguage = language.languageTag;
              upload.setAttribute("aria-label", `Upload ${questionnaireFamilyLabel(family.familyId)} in ${language.label}`);
              cell.append(upload);
            }
            row.append(cell);
          }
          const actions = document.createElement("td");
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Remove module";
          remove.dataset.questionnaireRemoveFamily = family.familyId;
          remove.disabled = languageEditorLocked;
          actions.append(remove);
          row.append(actions);
          return row;
        }));
      }
    }
    if (status) {
      status.dataset.state = coverage.complete ? "ready" : "error";
      status.textContent = coverage.familyRows.length === 0
        ? "No questionnaire modules included."
        : coverage.complete
          ? `${coverage.familyRows.length} module${coverage.familyRows.length === 1 ? "" : "s"} complete in every selected language.`
          : `${coverage.missing.length} required language asset${coverage.missing.length === 1 ? " is" : "s are"} missing.`;
    }
    root.querySelectorAll("[data-questionnaire-preset]").forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      const included = familyIsIncluded(button.dataset.questionnairePreset);
      button.textContent = `${included ? "Added" : "Add"} ${questionnaireFamilyLabel(button.dataset.questionnairePreset)}`;
      button.disabled = languageEditorLocked || included;
    });
  }

  function renderQuestionnaireDefinitions() {
    const container = query("#questionnaire-definition-list");
    if (!(container instanceof HTMLElement)) return;
    if (questionnaireDefinitions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No questionnaire definitions added.";
      container.replaceChildren(empty);
      return;
    }
    container.replaceChildren(...questionnaireDefinitions.map((definition) => {
      const article = document.createElement("article");
      article.className = "questionnaire-definition";
      article.dataset.questionnaireId = definition.questionnaireId;
      const heading = document.createElement("div");
      heading.className = "questionnaire-definition-heading";
      const identity = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = definition.title;
      const metadata = document.createElement("p");
      const language = STUDY_LANGUAGE_OPTIONS.find(({ languageTag }) => languageTag === definition.language);
      const receipt = questionnaireAuthoringReceipts.get(definition.questionnaireId);
      const format = receipt?.original?.formatVersion
        ?.replace("questionnaire-", "")
        .replace("-v1", "")
        .toUpperCase();
      metadata.textContent = `${definition.items.length} items · ${language?.label ?? definition.language}${format ? ` · ${format} upload` : ""}`;
      identity.append(title, metadata);
      const actions = document.createElement("div");
      actions.className = "button-row";
      for (const [label, action] of [["Preview", "preview"], ["Add to sequence", "add-module"], ["Remove", "remove-definition"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.dataset.questionnaireAction = action;
        button.dataset.questionnaireId = definition.questionnaireId;
        if (action === "remove-definition") {
          button.disabled = questionnaireModules.some(({ questionnaireId }) => questionnaireId === definition.questionnaireId);
          button.title = button.disabled ? "Remove its protocol modules first." : "Remove this unused definition.";
        }
        actions.append(button);
      }
      heading.append(identity, actions);
      const readiness = document.createElement("p");
      readiness.className = "questionnaire-metadata";
      readiness.textContent = "Validated and ready for language coverage.";
      article.append(heading, readiness);
      return article;
    }));
  }

  function renderQuestionnaireModules() {
    const list = query("#questionnaire-module-list");
    if (!(list instanceof HTMLElement)) return;
    if (questionnaireModules.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "Add a validated definition to place it in the protocol.";
      list.replaceChildren(empty);
      return;
    }
    const groups = questionnaireModuleGroups();
    list.replaceChildren(...groups.map((group, index) => {
      const module = group.modules[0];
      const definition = questionnaireDefinition(module.questionnaireId);
      const item = document.createElement("li");
      item.className = "questionnaire-module";
      item.dataset.moduleId = module.moduleId;
      item.dataset.questionnaireFamily = group.familyId;
      const heading = document.createElement("div");
      heading.className = "questionnaire-module-heading";
      const identity = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = questionnaireFamilyLabel(group.familyId);
      const metadata = document.createElement("p");
      const languages = group.modules.map((candidate) => questionnaireDefinition(candidate.questionnaireId)?.language)
        .filter(Boolean)
        .map((tag) => STUDY_LANGUAGE_OPTIONS.find(({ languageTag }) => languageTag === tag)?.label ?? tag);
      metadata.textContent = `Sequence ${index + 1} · ${languages.join(" + ")} asset${languages.length === 1 ? "" : "s"}`;
      identity.append(title, metadata);
      const order = document.createElement("div");
      order.className = "button-row";
      for (const [label, direction] of [["Move up", "up"], ["Move down", "down"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.dataset.questionnaireMoveFamily = direction;
        button.dataset.questionnaireFamily = group.familyId;
        button.disabled = direction === "up" ? index === 0 : index === groups.length - 1;
        order.append(button);
      }
      heading.append(identity, order);

      const controls = document.createElement("div");
      controls.className = "questionnaire-module-controls";
      const placementLabel = document.createElement("label");
      placementLabel.className = "field";
      const placementText = document.createElement("span");
      placementText.textContent = "Placement";
      const placementSelect = document.createElement("select");
      placementSelect.dataset.questionnairePlacement = module.moduleId;
      for (const [value, label] of [["beforeSession", "Before session"], ["afterSession", "After session"], ["beforeBlock", "Before block"], ["afterBlock", "After block"], ["afterStimulus", "After a video"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = module.placement.kind === value;
        placementSelect.append(option);
      }
      placementLabel.append(placementText, placementSelect);

      const poolLabel = document.createElement("label");
      poolLabel.className = "field";
      const poolText = document.createElement("span");
      poolText.textContent = "Block";
      const poolSelect = document.createElement("select");
      poolSelect.dataset.questionnaireBlock = module.moduleId;
      const usesBlock = module.placement.kind === "beforeBlock" || module.placement.kind === "afterBlock";
      poolSelect.disabled = !usesBlock;
      for (const block of experimentDocument?.definition.blocks ?? []) {
        const option = document.createElement("option");
        option.value = block.blockId;
        option.textContent = block.label;
        option.selected = module.placement.blockId === block.blockId;
        poolSelect.append(option);
      }
      poolLabel.append(poolText, poolSelect);

      const stimulusLabel = document.createElement("label");
      stimulusLabel.className = "field";
      const stimulusText = document.createElement("span");
      stimulusText.textContent = "Video";
      const stimulusSelect = document.createElement("select");
      stimulusSelect.dataset.questionnaireStimulus = module.moduleId;
      const usesStimulus = module.placement.kind === "afterStimulus";
      stimulusSelect.disabled = !usesStimulus;
      for (const stimulus of experimentDocument?.definition.stimuli ?? []) {
        const option = document.createElement("option");
        option.value = stimulus.stimulusId;
        option.textContent = stimulus.title;
        option.selected = module.placement.stimulusId === stimulus.stimulusId;
        stimulusSelect.append(option);
      }
      stimulusLabel.append(stimulusText, stimulusSelect);

      const isiLabel = document.createElement("label");
      isiLabel.className = "field";
      const isiText = document.createElement("span");
      isiText.textContent = "Relative to ISI";
      const isiSelect = document.createElement("select");
      isiSelect.dataset.questionnaireIsi = module.moduleId;
      isiSelect.disabled = !usesStimulus;
      for (const [value, label] of [["before", "Before ISI"], ["after", "After ISI"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = module.placement.relativeToIsi === value;
        isiSelect.append(option);
      }
      isiLabel.append(isiText, isiSelect);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove module";
      remove.dataset.questionnaireRemoveFamily = group.familyId;
      controls.append(placementLabel, poolLabel, stimulusLabel, isiLabel, remove);
      item.append(heading, controls);
      return item;
    }));
  }

  function renderProtocolPreview() {
    const hash = query("#protocol-plan-hash");
    const summary = query("#protocol-step-summary");
    const list = query("#protocol-sequence-preview");
    if (!(list instanceof HTMLElement)) return;
    if (!protocolPlan) {
      if (hash) hash.textContent = planError ?? "Pending valid questionnaire sequence";
      if (summary) summary.textContent = "No participant protocol is resolved.";
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "The selected participant’s ordered forms and videos appear after planning succeeds.";
      list.replaceChildren(empty);
      return;
    }
    if (hash) hash.textContent = protocolPlan.protocolPlanHashSha256;
    const previewLanguage = studyLanguages.find(({ languageId }) => languageId === selectedLanguageId)
      ?? studyLanguages[0];
    const previewSteps = protocolPlan.steps.filter((step) => {
      if (step.kind !== "questionnaire") return true;
      const definition = questionnaireDefinition(step.questionnaireId);
      return !definition || definition.language === "und" || definition.language === previewLanguage.languageTag;
    });
    const forms = previewSteps.filter(({ kind }) => kind === "questionnaire").length;
    const videos = previewSteps.filter(({ kind }) => kind === "stimulus").length;
    const intervals = previewSteps.filter(({ kind }) => kind === "interval").length;
    if (summary) summary.textContent = `${selectedParticipant} · ${previewLanguage.label} preview · ${forms} questionnaire step${forms === 1 ? "" : "s"} · ${videos} video${videos === 1 ? "" : "s"} · ${intervals} explicit ISI step${intervals === 1 ? "" : "s"}`;
    list.replaceChildren(...previewSteps.map((step) => {
      const item = document.createElement("li");
      const text = document.createElement("span");
      if (step.kind === "questionnaire") {
        const definition = questionnaireDefinition(step.questionnaireId);
        const placement = {
          beforeSession: "Before session",
          afterSession: "After session",
          beforeBlock: "Before block",
          afterBlock: "After block",
          afterStimulus: step.relativeToIsi === "before" ? "After video · before ISI" : "After video · after ISI",
        }[step.placement];
        const block = step.blockId
          ? experimentDocument?.definition.blocks.find(({ blockId }) => blockId === step.blockId)?.label ?? step.blockId
          : null;
        const stimulus = step.stimulusId
          ? experimentDocument?.definition.stimuli.find(({ stimulusId }) => stimulusId === step.stimulusId)?.title ?? step.stimulusId
          : null;
        text.textContent = `${placement}${block ? ` · ${block}` : ""}${stimulus ? ` · ${stimulus}` : ""} · ${definition?.title ?? step.questionnaireId}`;
      } else if (step.kind === "interval") {
        text.textContent = `ISI · ${(step.durationMs / 1_000).toFixed(3)} s after ${step.stimulusId}`;
      } else {
        const stimulus = stimuli.find(({ id }) => id === step.stimulusId);
        const block = experimentDocument?.definition.blocks.find(({ blockId }) => blockId === step.blockId)?.label ?? step.blockId;
        text.textContent = `Video · ${block} · ${stimulus?.title ?? step.stimulusId}`;
      }
      item.append(text);
      return item;
    }));
  }

  function renderQuestionnaires() {
    renderStudyLanguages();
    const source = coverageSource();
    questionnaireEditor.sync({
      families: requestedQuestionnaireFamilies.map((id) => ({ id, label: questionnaireFamilyLabel(id) })),
      languages: studyLanguages,
      definitions: source.definitions,
      familyForDefinition: familyIdForDefinition,
      locked: languageEditorLocked,
    });
    renderQuestionnaireCoverage();
    renderProtocolPreview();
    const add = query("#questionnaire-add-blank");
    if (add) add.disabled = languageEditorLocked;
    const prebuilt = query("#questionnaire-prebuilt-open");
    if (prebuilt) prebuilt.disabled = languageEditorLocked;
    const summary = query('[data-section-summary="questionnaires"]');
    if (summary) {
      const coverage = questionnaireLanguageCoverage();
      summary.textContent = coverage.familyRows.length === 0
        ? `${studyLanguages.length} language${studyLanguages.length === 1 ? "" : "s"} · demographics ready`
        : `${studyLanguages.length} language${studyLanguages.length === 1 ? "" : "s"} · ${coverage.familyRows.length} module${coverage.familyRows.length === 1 ? "" : "s"} · ${coverage.complete ? "ready" : "assets missing"}`;
    }
  }

  function nextQuestionnaireModuleId(questionnaireId) {
    const prefix = `${questionnaireId.slice(0, 104)}-module`;
    for (let number = 1; number <= 9_999; number += 1) {
      const candidate = `${prefix}-${String(number).padStart(2, "0")}`;
      if (!questionnaireModules.some(({ moduleId }) => moduleId === candidate)) return candidate;
    }
    throw new RangeError(`No module identifier remains available for ${questionnaireId}.`);
  }

  function addQuestionnaireModule(definition) {
    const familyId = familyIdForDefinition(definition);
    const familyIndexes = questionnaireModules
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => {
        const candidateDefinition = questionnaireDefinition(candidate.questionnaireId);
        return candidateDefinition && familyIdForDefinition(candidateDefinition) === familyId;
      });
    const placement = familyIndexes[0]?.candidate.placement
      ? structuredClone(familyIndexes[0].candidate.placement)
      : { kind: "beforeSession", blockId: null };
    const module = validateQuestionnaireModuleV2({
      schema: QUESTIONNAIRE_MODULE_SCHEMA,
      version: 2,
      moduleId: nextQuestionnaireModuleId(definition.questionnaireId),
      questionnaireId: definition.questionnaireId,
      definitionSha256: definition.definitionSha256,
      placement,
    }, {
      definition,
      blockIds: protocolBlockIds(),
      stimulusIds: experimentDocument?.definition.stimuli.map(({ stimulusId }) => stimulusId) ?? [],
    });
    const insertAt = familyIndexes.length
      ? familyIndexes.at(-1).index + 1
      : questionnaireModules.length;
    questionnaireModules.splice(insertAt, 0, structuredClone(module));
    renderQuestionnaires();
    schedulePlanRefresh();
    announce(`${definition.title} added to the questionnaire sequence. Choose another hook if needed.`);
  }

  function questionnaireImportStatus(message, state = "neutral") {
    const output = query("#questionnaire-import-status");
    if (!output) return;
    output.textContent = message;
    output.dataset.state = state;
  }

  async function storeQuestionnaireSource(bytes, definition, authoringReceipt) {
    if (!capabilities.directoryPermission) {
      throw new Error("Select the parent work directory before adding questionnaire assets.");
    }
    const familyId = familyIdForDefinition(definition);
    const format = {
      "questionnaire-csv-v1": "csv",
      "questionnaire-txt-v1": "txt",
      "questionnaire-json-v1": "json",
    }[authoringReceipt.original.formatVersion];
    if (!format) throw new TypeError("Questionnaire source format is unsupported.");
    const payload = {
      familyId,
      languageTag: definition.language,
      format,
      sourceSha256: authoringReceipt.original.sha256,
      bytes: new Uint8Array(bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes),
    };
    if (surface === "browser") {
      if (!workspace || typeof workspace.saveQuestionnaireAsset !== "function") {
        throw new Error("The browser questionnaire asset store is not available.");
      }
      return workspace.saveQuestionnaireAsset(payload);
    }
    return requestQuestionnaireAssetStorage(root, payload);
  }

  async function saveEditedQuestionnaire({ familyId, language, definition, sourceBytes, authoringReceipt, expectedPresetToken }) {
    if (languageEditorLocked || mode !== "setup") throw new Error("This experiment is locked for editing.");
    if (questionnaireEditor.presetToken(familyId, language) !== expectedPresetToken
      || !requestedQuestionnaireFamilies.includes(familyId)
      || !studyLanguages.some(({ languageTag }) => languageTag === language)) {
      throw new Error("This questionnaire or language is no longer included.");
    }
    validateQuestionnaireDefinitionV1(definition);
    if (definition.language !== language || familyIdForDefinition(definition) !== familyId) {
      throw new TypeError("The edited questionnaire does not match its language table.");
    }
    if (sourceBytes && authoringReceipt) await storeQuestionnaireSource(sourceBytes, definition, authoringReceipt);
    else if (!questionnaireDefinition(definition.questionnaireId)) throw new Error("The questionnaire source is missing; import or edit the table and save again.");
    // A storage receipt cannot adopt an asset into a slot removed while saving.
    if (languageEditorLocked || questionnaireEditor.presetToken(familyId, language) !== expectedPresetToken
      || !requestedQuestionnaireFamilies.includes(familyId)
      || !studyLanguages.some(({ languageTag }) => languageTag === language)) {
      throw new Error("The setup changed while saving. The source is retained; the questionnaire was not added.");
    }
    const existingIndex = questionnaireDefinitions.findIndex(({ questionnaireId }) => questionnaireId === definition.questionnaireId);
    if (existingIndex < 0) questionnaireDefinitions.push(structuredClone(definition));
    else questionnaireDefinitions[existingIndex] = structuredClone(definition);
    if (authoringReceipt) questionnaireAuthoringReceipts.set(definition.questionnaireId, authoringReceipt);
    if (questionnaireModules.some(({ questionnaireId }) => questionnaireId === definition.questionnaireId)) {
      questionnaireModules.splice(0, questionnaireModules.length,
        ...updateQuestionnaireDefinitionReferences(questionnaireModules, definition));
    } else addQuestionnaireModule(definition);
    announce(`${definition.title} in ${language} saved. Existing protocol placements were preserved.`);
  }

  function addBlankQuestionnaire() {
    if (languageEditorLocked) return;
    let number = 1;
    while (requestedQuestionnaireFamilies.includes(`questionnaire-${number}`)) number += 1;
    requestQuestionnaireFamily(`questionnaire-${number}`);
    renderQuestionnaires();
    schedulePlanRefresh();
  }

  function moveQuestionnaireFamily(familyId, direction) {
    if (languageEditorLocked) return;
    const index = requestedQuestionnaireFamilies.indexOf(familyId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= requestedQuestionnaireFamilies.length) return;
    [requestedQuestionnaireFamilies[index], requestedQuestionnaireFamilies[next]]
      = [requestedQuestionnaireFamilies[next], requestedQuestionnaireFamilies[index]];
    questionnaireModules.sort((a, b) => requestedQuestionnaireFamilies.indexOf(familyIdForDefinition(questionnaireDefinition(a.questionnaireId)))
      - requestedQuestionnaireFamilies.indexOf(familyIdForDefinition(questionnaireDefinition(b.questionnaireId))));
    if (loadedLanguageSelection) {
      const order = questionnaireModules.map(m => m.moduleId);
      loadedLanguageSelection.languages.forEach(language => {
        language.questionnaireModuleIds.sort((a,b) => order.indexOf(a) - order.indexOf(b));
      });
    }
    renderQuestionnaires();
    schedulePlanRefresh();
  }

  async function importQuestionnaireBytes(input, {
    sourceKind = "researcherCsv",
    logicalName = "questionnaire.csv",
    sourceDocumentSha256 = null,
    addModule = true,
    expectedFamilyId = null,
    expectedLanguageTag = null,
  } = {}) {
    questionnaireImportStatus(`Validating ${logicalName}…`);
    const imported = await importQuestionnaireAuthoring(input, {
      sourceKind,
      logicalName,
      sourceDocumentSha256,
    });
    const familyId = familyIdForDefinition(imported.definition);
    if (expectedFamilyId && familyId !== expectedFamilyId) {
      throw new TypeError(
        `This slot expects ${questionnaireFamilyLabel(expectedFamilyId)}, but the file identifies the ${questionnaireFamilyLabel(familyId)} module.`,
      );
    }
    if (expectedLanguageTag && imported.definition.language !== expectedLanguageTag) {
      const expectedLanguage = STUDY_LANGUAGE_OPTIONS.find(({ languageTag }) => languageTag === expectedLanguageTag)?.label
        ?? expectedLanguageTag;
      throw new TypeError(
        `This slot expects ${expectedLanguage} (${expectedLanguageTag}), but the file declares ${imported.definition.language}.`,
      );
    }
    if (imported.definition.language === "und") {
      throw new TypeError("Questionnaire assets must declare the exact participant language; und cannot satisfy language coverage.");
    }
    if (!studyLanguages.some(({ languageTag }) => languageTag === imported.definition.language)) {
      throw new TypeError(
        `Add ${imported.definition.language} to Study languages before uploading this questionnaire asset.`,
      );
    }
    const existing = questionnaireDefinition(imported.definition.questionnaireId);
    if (existing && existing.definitionSha256 !== imported.definition.definitionSha256) {
      throw new TypeError(
        `${imported.definition.questionnaireId} is already loaded with a different definition hash. Remove its modules and definition before replacing it.`,
      );
    }
    await storeQuestionnaireSource(input, imported.definition, imported.authoringReceipt);
    if (!existing) questionnaireDefinitions.push(structuredClone(imported.definition));
    const definition = existing ?? imported.definition;
    questionnaireAuthoringReceipts.set(definition.questionnaireId, imported.authoringReceipt);
    requestQuestionnaireFamily(familyId);
    if (addModule && !questionnaireModules.some(({ questionnaireId }) => questionnaireId === definition.questionnaireId)) {
      addQuestionnaireModule(definition);
    }
    else {
      renderQuestionnaires();
      schedulePlanRefresh();
    }
    questionnaireImportStatus(
      `${definition.title} · ${definition.language} is ready in its module asset folder.`,
      "ready",
    );
    if (existing) announce(`${definition.title} was already validated; its source asset was verified without creating a duplicate.`);
    return definition;
  }

  async function importBundledQuestionnaire(assetId, { familyId = null, languageTag = null } = {}) {
    const bundled = BUNDLED_QUESTIONNAIRES[assetId];
    if (!bundled) throw new TypeError(`Bundled questionnaire asset ${assetId} is unavailable.`);
    const response = await fetch(bundled.url);
    if (!response.ok) throw new Error(`Bundled questionnaire could not be read (${response.status}).`);
    return importQuestionnaireBytes(await response.arrayBuffer(), {
      sourceKind: "bundled",
      logicalName: bundled.logicalName,
      sourceDocumentSha256: assetId === "maia-2-de" ? SPECIFICATION_SOURCE_SHA256 : null,
      expectedFamilyId: familyId,
      expectedLanguageTag: languageTag,
    });
  }

  function renderPrebuiltQuestionnaires() {
    const list = query("#questionnaire-prebuilt-list");
    if (!list) return;
    list.replaceChildren(...PREBUILT_QUESTIONNAIRE_ASSETS.map((asset) => {
      const row = document.createElement("section"); row.className = "questionnaire-prebuilt-row";
      const heading = document.createElement("h3"); heading.textContent = `${asset.title} · ${asset.languageLabel}`;
      const description = document.createElement("p"); description.textContent = asset.description;
      const state = prebuiltQuestionnaireAvailability(asset, {
        languages: studyLanguages.map((l) => l.languageTag), locked: languageEditorLocked,
        occupied: familyIsIncluded(asset.familyId) && !questionnaireEditor.canLoadPreset(asset.familyId, asset.language),
      });
      const button = document.createElement("button"); button.type = "button";
      button.dataset.questionnairePrebuiltAsset = asset.id; button.textContent = state.label; button.disabled = state.disabled;
      row.append(heading, description, button); return row;
    }));
  }

  async function addPrebuiltQuestionnaire(assetId) {
    const asset = PREBUILT_QUESTIONNAIRE_ASSETS.find((a) => a.id === assetId);
    if (!asset || !asset.ready || languageEditorLocked || !studyLanguages.some((l) => l.languageTag === asset.language)) return;
    const status = query("#questionnaire-prebuilt-status");
    status.textContent = `Adding ${asset.title} · ${asset.languageLabel}…`;
    root.querySelectorAll("[data-questionnaire-prebuilt-asset]").forEach((button) => { button.disabled = true; });
    await prepareQuestionnairePreset(asset.familyId, asset.language);
    status.textContent = query("#questionnaire-import-status").textContent;
    renderPrebuiltQuestionnaires();
  }

  async function prepareQuestionnairePreset(familyId, selectedLanguage = null) {
    if (languageEditorLocked) return;
    requestQuestionnaireFamily(familyId);
    renderQuestionnaires();
    if (familyId !== "maia-2") {
      questionnaireImportStatus("Paste your authorized TAS-20 items into each language table.");
      schedulePlanRefresh();
      return;
    }
    try {
      let loadedCount = 0;
      for (const language of studyLanguages) {
        if (selectedLanguage && language.languageTag !== selectedLanguage) continue;
        const assetId = `maia-2-${language.languageTag}`;
        const bundled = BUNDLED_QUESTIONNAIRES[assetId];
        if (!bundled || questionnaireDefinition(assetId)
          || !questionnaireEditor.canLoadPreset(familyId, language.languageTag)) continue;
        const expectedPresetToken = questionnaireEditor.presetToken(familyId, language.languageTag);
        const response = await fetch(bundled.url);
        if (!response.ok) throw new Error("The MAIA-2 asset could not be opened.");
        const bytes = new Uint8Array(await response.arrayBuffer());
        const imported = await importQuestionnaireAuthoring(bytes, {
          sourceKind: "bundled",
          logicalName: bundled.logicalName,
          sourceDocumentSha256: assetId === "maia-2-de" ? SPECIFICATION_SOURCE_SHA256 : null,
        });
        const loaded = questionnaireEditor.loadDefinition(imported.definition, {
          familyId, sourceBytes: bytes, authoringResult: imported, onlyIfPristine: true, expectedPresetToken,
        });
        if (loaded) loadedCount += 1;
        if (loaded && capabilities.directoryPermission) await questionnaireEditor.save(`${familyId}/${language.languageTag}`);
      }
      questionnaireImportStatus(loadedCount
        ? "Selected MAIA-2 version loaded with answer labels and codes. Review its table; each selected study language needs a saved version."
        : "No table was replaced. The selected version is already present or its table changed while loading.");
    } catch (error) {
      questionnaireImportStatus(error instanceof Error ? error.message : String(error), "error");
    }
    schedulePlanRefresh();
  }

  function removeQuestionnaireFamily(familyId) {
    if (languageEditorLocked) return;
    const questionnaireIds = new Set(questionnaireDefinitions
      .filter((definition) => familyIdForDefinition(definition) === familyId)
      .map(({ questionnaireId }) => questionnaireId));
    for (let index = questionnaireModules.length - 1; index >= 0; index -= 1) {
      if (questionnaireIds.has(questionnaireModules[index].questionnaireId)) questionnaireModules.splice(index, 1);
    }
    for (let index = questionnaireDefinitions.length - 1; index >= 0; index -= 1) {
      if (!questionnaireIds.has(questionnaireDefinitions[index].questionnaireId)) continue;
      questionnaireAuthoringReceipts.delete(questionnaireDefinitions[index].questionnaireId);
      questionnaireDefinitions.splice(index, 1);
    }
    const requestedIndex = requestedQuestionnaireFamilies.indexOf(familyId);
    if (requestedIndex >= 0) requestedQuestionnaireFamilies.splice(requestedIndex, 1);
    renderQuestionnaires();
    schedulePlanRefresh();
    announce(`${questionnaireFamilyLabel(familyId)} was removed from this setup. Stored source files were retained in the workspace.`);
  }

  function addStudyLanguage() {
    if (languageEditorLocked) return;
    const languageId = value("study-language-add");
    const language = STUDY_LANGUAGE_OPTIONS.find((candidate) => candidate.languageId === languageId);
    if (!language || studyLanguages.some((candidate) => candidate.languageId === language.languageId)) return;
    if (loadedLanguageSelection?.nodes.length > 1) {
      announce("This recipe has nested language choices. Its questionnaires remain editable; changing that language routing requires a dedicated routing editor.");
      return;
    }
    loadedLanguageSelection = null;
    studyLanguages.push({ ...language });
    clearParticipantLanguageSelection();
    renderQuestionnaires();
    schedulePlanRefresh();
    announce(`${language.label} added. Every included questionnaire now requires a matching ${language.languageTag} asset.`);
  }

  function removeStudyLanguage(languageId) {
    if (languageEditorLocked || studyLanguages.length === 1) return;
    const index = studyLanguages.findIndex((language) => language.languageId === languageId);
    if (index < 0) return;
    if (loadedLanguageSelection?.nodes.length > 1) {
      announce("This recipe has nested language choices. Its questionnaires remain editable; changing that language routing requires a dedicated routing editor.");
      return;
    }
    loadedLanguageSelection = null;
    const [removed] = studyLanguages.splice(index, 1);
    const removedIds = new Set(questionnaireDefinitions.filter(d => d.language === removed.languageTag).map(d => d.questionnaireId));
    for (let i = questionnaireModules.length - 1; i >= 0; i -= 1) {
      if (removedIds.has(questionnaireModules[i].questionnaireId)) questionnaireModules.splice(i, 1);
    }
    for (let i = questionnaireDefinitions.length - 1; i >= 0; i -= 1) {
      if (removedIds.has(questionnaireDefinitions[i].questionnaireId)) {
        questionnaireAuthoringReceipts.delete(questionnaireDefinitions[i].questionnaireId);
        questionnaireDefinitions.splice(i, 1);
      }
    }
    clearParticipantLanguageSelection();
    renderQuestionnaires();
    schedulePlanRefresh();
    announce(`${removed.label} and its questionnaire variants removed from this setup. Stored source files were retained in the workspace.`);
  }

  function requestQuestionnaireUpload({ familyId = null, languageTag = null } = {}) {
    if (languageEditorLocked) {
      announce("Questionnaire assets are frozen by the loaded project package.");
      return;
    }
    pendingQuestionnaireUpload = familyId ? { familyId, languageTag } : null;
    query("#questionnaire-file-input")?.click();
  }

  function filterQuestionnaireInspiration() {
    const search = value("questionnaire-inspiration-search").trim().toLowerCase();
    const domain = value("questionnaire-inspiration-domain", "all");
    let visible = 0;
    root.querySelectorAll("[data-inspiration-entry]").forEach((entry) => {
      if (!(entry instanceof HTMLElement)) return;
      const matches = (domain === "all" || entry.dataset.inspirationDomain === domain)
        && (!search || entry.dataset.inspirationSearch?.includes(search));
      entry.hidden = !matches;
      if (matches) visible += 1;
    });
    const empty = query("#questionnaire-inspiration-empty");
    if (empty instanceof HTMLElement) empty.hidden = visible > 0;
  }

  function openQuestionnaireInspiration() {
    filterQuestionnaireInspiration();
    const dialog = query("#questionnaire-inspiration-dialog");
    if (dialog instanceof HTMLDialogElement) dialog.showModal();
  }

  function showQuestionnairePreview(definition) {
    const title = query("#questionnaire-preview-title");
    const instructions = query("#questionnaire-preview-instructions");
    const attribution = query("#questionnaire-preview-attribution");
    const items = query("#questionnaire-preview-items");
    if (title) title.textContent = definition.title;
    if (instructions) instructions.textContent = definition.instructions;
    if (attribution) attribution.textContent = definition.attribution;
    if (items instanceof HTMLElement) {
      items.replaceChildren(...definition.items.map((item) => {
        const article = document.createElement("article");
        article.className = "questionnaire-preview-item";
        const heading = document.createElement("h3");
        heading.textContent = `${item.order}. ${item.prompt}`;
        const options = document.createElement("p");
        options.className = "questionnaire-preview-options";
        options.textContent = item.options.map(({ label }) => label).join(" · ");
        article.append(heading, options);
        return article;
      }));
    }
    const dialog = query("#questionnaire-preview-dialog");
    if (dialog instanceof HTMLDialogElement) dialog.showModal();
  }

  function updateQuestionnaireModule(moduleId, placement) {
    const index = questionnaireModules.findIndex((module) => module.moduleId === moduleId);
    if (index < 0) return;
    const current = questionnaireModules[index];
    const definition = questionnaireDefinition(current.questionnaireId);
    if (!definition) throw new TypeError(`Questionnaire module ${moduleId} has no definition.`);
    const familyId = familyIdForDefinition(definition);
    for (let candidateIndex = 0; candidateIndex < questionnaireModules.length; candidateIndex += 1) {
      const candidate = questionnaireModules[candidateIndex];
      const candidateDefinition = questionnaireDefinition(candidate.questionnaireId);
      if (!candidateDefinition || familyIdForDefinition(candidateDefinition) !== familyId) continue;
      questionnaireModules[candidateIndex] = structuredClone(validateQuestionnaireModuleV2({
        ...candidate,
        placement,
      }, {
        definition: candidateDefinition,
        blockIds: protocolBlockIds(),
        stimulusIds: experimentDocument?.definition.stimuli.map(({ stimulusId }) => stimulusId) ?? [],
      }));
    }
    renderQuestionnaires();
    schedulePlanRefresh();
  }

  function renderReview() {
    renderNameCode();
    renderParticipantGrid();
    renderCoverage();
    renderParticipantLanguageReadiness();
    renderPreflight();
    const experimentId = value("experiment-id", "<experiment-id>") || "<experiment-id>";
    const path = query("#review-output-path");
    if (path) path.textContent = `outputs/${experimentId}/${selectedParticipant}/<session-stem>/`;
    const hash = query("#settings-hash");
    if (hash) hash.textContent = protocolSettingsHash ?? planError ?? "Pending validated settings";
    const storage = query("#storage-estimate");
    if (storage) {
      const estimate = estimateResearchStorageUse(settingsSnapshot, plan);
      if (!estimate) {
        storage.textContent = "Pending verified videos";
      } else {
        const capacity = storageReadiness?.requiredBytes === estimate.requiredBytes
          ? ` · ${(storageReadiness.availableBytes / (1024 * 1024)).toFixed(1)} MiB available${storageReadiness.persisted === false ? " · best-effort browser persistence" : ""}`
          : " · write/quota probe pending";
        storage.textContent = `${(estimate.requiredBytes / (1024 * 1024)).toFixed(1)} MiB estimated for ${estimate.sampleRows.toLocaleString()} rating rows${capacity}`;
      }
    }
    const timing = query("#timing-capability");
    if (timing) timing.textContent = capabilities.timingWorkerReady
      ? surface === "tauri"
        ? "Native timing authority available · installed-hardware qualification pending"
        : "Dedicated worker timing authority available · browser qualification pending"
      : "Timing authority not ready";
    const lsl = query("#lsl-capability");
    if (lsl) lsl.textContent = surface === "tauri"
      ? "Windows Tauri will verify the outbound regular and marker outlets during preflight."
      : "Browser mode preserves these values but cannot start while LSL is enabled.";
  }

  function renderPools() {
    const container = query("#condition-pools");
    if (!(container instanceof HTMLElement)) return;
    const blocks = experimentDocument?.definition.blocks ?? [];
    if (blocks.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Load experiment.json to inspect its declared blocks.";
      container.replaceChildren(empty);
      renderStimulusLibrary();
      renderCoverage();
      return;
    }
    container.replaceChildren(...blocks.map((block) => {
      const section = document.createElement("section");
      section.className = "condition-pool";
      section.dataset.blockId = block.blockId;
      const heading = document.createElement("div");
      heading.className = "condition-pool-header";
      const identity = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = block.label;
      const metadata = document.createElement("p");
      const schedules = experimentDocument.definition.schedules;
      const counts = schedules.map((schedule) => (
        schedule.blocks.find(({ blockId }) => blockId === block.blockId)?.videos.length ?? 0
      ));
      metadata.textContent = `${block.blockId} · ${Math.min(...counts)}–${Math.max(...counts)} videos per participant`;
      identity.append(title, metadata);
      const authority = document.createElement("output");
      authority.className = "field-output";
      authority.textContent = "Read-only";
      heading.append(identity, authority);
      const list = document.createElement("ul");
      list.className = "condition-video-list";
      const usedIds = [...new Set(schedules.flatMap((schedule) => (
        schedule.blocks.find(({ blockId }) => blockId === block.blockId)?.videos.map(({ stimulusId }) => stimulusId) ?? []
      )))];
      for (const stimulusId of usedIds) {
        const row = document.createElement("li");
        const reference = experimentDocument.definition.stimuli.find((item) => item.stimulusId === stimulusId);
        const name = document.createElement("span");
        name.textContent = reference?.title ?? stimulusId;
        const use = document.createElement("span");
        use.className = "stimulus-source";
        const exposure = schedules.reduce((sum, schedule) => sum + (
          schedule.blocks.find(({ blockId }) => blockId === block.blockId)?.videos.filter((video) => video.stimulusId === stimulusId).length ?? 0
        ), 0);
        use.textContent = `${exposure} scheduled exposure${exposure === 1 ? "" : "s"}`;
        row.append(name, use);
        list.append(row);
      }
      section.append(heading, list);
      return section;
    }));
    const summary = query("#pool-mode-summary");
    if (summary) summary.textContent = `${blocks.length} externally declared block${blocks.length === 1 ? "" : "s"} · order may differ by participant.`;
    renderStimulusLibrary();
    renderCoverage();
  }

  function renderStimulusLibrary() {
    const table = query("#stimulus-library-table");
    if (!(table instanceof HTMLElement)) return;
    if (stimuli.length === 0) {
      table.innerHTML = '<tr><td colspan="5" class="empty-state">No complete videos have been imported.</td></tr>';
      return;
    }
    table.replaceChildren(...stimuli.map((stimulus) => {
      const row = document.createElement("tr");
      const title = document.createElement("td");
      title.textContent = stimulus.title;
      const source = document.createElement("td");
      source.textContent = stimulus.source === "youtube" ? "Experimental YouTube" : stimulus.source === "repository" ? "Repository asset" : "Workspace file";
      const verification = document.createElement("td");
      const youtubeFresh = stimulus.source === "youtube" && isFreshYouTubePreflight(
        stimulus.youtubePreflight,
        stimulus.contractSource,
        { maximumAgeMs: YOUTUBE_PREFLIGHT_MAX_AGE_MS },
      );
      verification.textContent = stimulus.source === "youtube"
        ? stimulus.verification === "failed"
          ? `Player preflight failed: ${stimulus.error}`
          : youtubeFresh
            ? `Player operational · ${stimulus.contractSource.observedTitle} · ${(stimulus.contractSource.observedDurationMs / 1_000).toFixed(1)} s · unverified / noncanonical`
            : "Fresh visible-player preflight required · unverified / noncanonical"
        : stimulus.verification === "verified"
          ? stimulus.decodeQualification === "attestedQualified"
            ? "Hash + native GstPlay snapshots attested · qualified decode"
            : stimulus.decodeQualification === "attestedUnqualified"
            ? "Hash + representative WebView frames attested · unqualified playback"
            : "Hash, duration, decode verified"
          : stimulus.verification === "failed" ? `Failed: ${stimulus.error}` : "Verification pending";
      const poolCell = document.createElement("td");
      const reference = experimentDocument?.definition.stimuli.find(({ relativePath }) => (
        relativePath === stimulus.location
      ));
      const useCount = reference ? experimentDocument.definition.schedules.reduce((sum, schedule) => (
        sum + schedule.blocks.reduce((blockSum, block) => (
          blockSum + block.videos.filter(({ stimulusId }) => stimulusId === reference.stimulusId).length
        ), 0)
      ), 0) : 0;
      poolCell.textContent = reference
        ? `${reference.stimulusId} · ${useCount} scheduled`
        : "Not referenced";
      const actionCell = document.createElement("td");
      actionCell.className = "stimulus-actions";
      if (stimulus.source === "youtube") {
        const preflight = document.createElement("button");
        preflight.type = "button";
        preflight.dataset.youtubePreflight = stimulus.id;
        preflight.textContent = youtubeFresh ? "Preflight again" : "Preflight";
        preflight.setAttribute("aria-label", `Run visible YouTube player preflight for ${stimulus.title}`);
        actionCell.append(preflight);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.stimulusRemove = stimulus.id;
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${stimulus.title}`);
      actionCell.append(remove);
      row.append(title, source, verification, poolCell, actionCell);
      return row;
    }));
  }

  function addStimulus({ title, source, location, file = null }) {
    const normalizedTitle = String(title || file?.name || "Untitled video").trim().slice(0, 120);
    const duplicate = stimuli.some((stimulus) => stimulus.source === source && stimulus.location === location);
    if (duplicate) {
      announce(`${normalizedTitle} is already in the stimulus library.`);
      return null;
    }
    const baseId = normalizedTitle.toLowerCase().normalize("NFKD")
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 80) || "video";
    let id = baseId;
    let suffix = 2;
    while (stimuli.some((stimulus) => stimulus.id === id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    const stimulus = {
      id,
      title: normalizedTitle,
      source,
      location: String(location ?? file?.webkitRelativePath ?? file?.name ?? ""),
      file,
      poolId: null,
      verification: source === "youtube" ? "unverified" : file ? "pending" : "pending",
      contractSource: null,
      youtubePreflight: null,
    };
    if (source === "youtube") {
      try {
        const parsed = parseExperimentalYouTubeUrl(stimulus.location);
        stimulus.location = parsed.url;
        stimulus.contractSource = {
          kind: "youtube",
          url: parsed.url,
          videoId: parsed.videoId,
          observedTitle: normalizedTitle,
          observedDurationMs: null,
        };
      } catch (error) {
        stimulus.verification = "failed";
        stimulus.error = error instanceof Error ? error.message : String(error);
      }
    }
    stimuli.push(stimulus);
    renderPools();
    schedulePlanRefresh();
    announce(`${normalizedTitle} added to the workspace catalogue.`);
    return stimulus;
  }

  async function verifyLocalFile(stimulus, { relativePath = stimulus.location } = {}) {
    if (!(stimulus.file instanceof Blob)) return;
    try {
      const probe = await probeVideoFile(stimulus.file);
      const digest = await sha256Blob(stimulus.file);
      const expected = stimulus.contractSource;
      if (expected && expected.kind !== "youtube"
        && (expected.sha256 !== digest
          || expected.byteLength !== stimulus.file.size
          || Math.abs(expected.durationMs - Math.round(probe.durationSeconds * 1_000)) > Math.max(250, expected.durationMs * 0.005))) {
        throw new Error("The current file does not match the hash, size, or duration frozen in settings.");
      }
      stimulus.durationSeconds = probe.durationSeconds;
      stimulus.byteLength = stimulus.file.size;
      stimulus.sha256 = digest;
      stimulus.verification = probe.decodeVerified ? "verified" : "failed";
      stimulus.contractSource = {
        kind: stimulus.source === "repository" ? "repositoryAsset" : "workspaceFile",
        relativePath,
        mimeType: stimulus.file.type || "application/octet-stream",
        sha256: digest,
        byteLength: stimulus.file.size,
        durationMs: Math.round(probe.durationSeconds * 1_000),
      };
    } catch (error) {
      stimulus.verification = "failed";
      stimulus.error = error instanceof Error ? error.message : String(error);
    }
    renderPools();
    schedulePlanRefresh();
  }

  async function verifyRepositoryStimulus(stimulus) {
    try {
      const relativePath = normalizeWorkspaceRelativePath(stimulus.location, "repository asset path");
      stimulus.location = relativePath;
      const response = await fetch(new URL(relativePath, document.baseURI), { cache: "no-store" });
      if (!response.ok) throw new Error(`Repository asset returned HTTP ${response.status}.`);
      stimulus.file = await response.blob();
      await verifyLocalFile(stimulus, { relativePath });
    } catch (error) {
      stimulus.verification = "failed";
      stimulus.error = error instanceof Error ? error.message : String(error);
      renderPools();
      schedulePlanRefresh();
    }
  }

  async function preflightYouTubeStimulus(stimulus) {
    if (!stimulus || stimulus.source !== "youtube") return;
    const panel = query("#youtube-preflight-panel");
    const host = query("#youtube-preflight-player");
    const status = query("#youtube-preflight-status");
    if (surface !== "browser") {
      announce("Experimental YouTube remains blocked in Windows Tauri until its CSP and referrer boundary is qualified.");
      return;
    }
    if (!(host instanceof HTMLElement)) throw new Error("The YouTube preflight player is unavailable.");
    if (panel instanceof HTMLElement) panel.hidden = false;
    if (status) {
      status.dataset.state = "pending";
      status.textContent = `Loading the official YouTube player for ${stimulus.title}…`;
    }
    stimulus.youtubePreflight = null;
    stimulus.verification = "unverified";
    renderStimulusLibrary();
    schedulePlanRefresh();
    try {
      youtubePreflightAdapter?.destroy();
      host.replaceChildren();
      youtubePreflightAdapter = new YouTubeIframePlayerAdapter(host, { origin: window.location.origin });
      const result = await youtubePreflightAdapter.preflight({
        videoId: stimulus.contractSource.videoId,
        url: stimulus.contractSource.url,
      });
      stimulus.contractSource = {
        kind: "youtube",
        url: result.url,
        videoId: result.videoId,
        observedTitle: result.observedTitle,
        observedDurationMs: result.observedDurationMs,
      };
      stimulus.youtubePreflight = result;
      stimulus.verification = "youtube-operational";
      delete stimulus.error;
      if (status) {
        status.dataset.state = "ready";
        status.textContent = `${result.observedTitle} · ${(result.observedDurationMs / 1_000).toFixed(1)} s · player operational. This URL remains unverified, noncanonical, and excluded from qualification.`;
      }
      announce(`${stimulus.title} passed the fresh browser player preflight and remains excluded from qualification.`);
    } catch (error) {
      stimulus.youtubePreflight = null;
      stimulus.verification = "failed";
      stimulus.error = error instanceof Error ? error.message : String(error);
      if (status) {
        status.dataset.state = "error";
        status.textContent = stimulus.error;
      }
      announce(`YouTube preflight failed: ${stimulus.error}`);
    }
    renderPools();
    schedulePlanRefresh();
  }

  function schedulePlanRefresh() {
    observePackageDraft();
    renderPackageReceipt();
    planRefresh += 1;
    const generation = planRefresh;
    settingsSnapshot = null;
    settingsHash = null;
    protocolSettingsSnapshot = null;
    protocolSettingsHash = null;
    plan = null;
    protocolPlan = null;
    planError = "Revalidating the current protocol…";
    capabilities.manifestReady = false;
    manifestReadinessMessage = "Output manifests are being rescanned against the current protocol.";
    renderPlanPreview();
    renderQuestionnaires();
    renderReview();
    queueMicrotask(async () => {
      if (generation !== planRefresh) return;
      try {
        const settings = await researchSettingsFromUi();
        const sha256 = await canonicalSha256(settings);
        const resolved = await resolveExternalExperimentPlanV1(
          experimentDocument,
          settings.stimuli.items,
          sha256,
        );
        const protocolSettings = settings;
        const protocolSha256 = sha256;
        const resolvedProtocol = await resolveProtocolPlanV2(
          settings,
          resolved,
          selectedParticipant,
        );
        let packageSelection = null;
        if (experimentPackageDocument) {
          const route = selectedPackageRoute();
          if (!route) throw new TypeError("Select one terminal language route from the package tree.");
          packageSelection = await compileExperimentPackageSelectionV1(
            experimentPackageDocument.package,
            {
              languageId: route.languageId,
              languageSelectionPath: route.optionIds,
              participantId: selectedParticipant,
            },
          );
          if (canonicalJson(packageSelection.settings) !== canonicalJson(settings)
            || packageSelection.settingsSha256 !== sha256
            || packageSelection.experimentPlan.planHashSha256 !== resolved.planHashSha256
            || packageSelection.protocolPlan.protocolPlanHashSha256
              !== resolvedProtocol.protocolPlanHashSha256) {
            throw new TypeError(
              "The current controls no longer match the loaded package. Generate a new package before Start.",
            );
          }
        }
        if (generation !== planRefresh) return;
        settingsSnapshot = settings;
        settingsHash = sha256;
        protocolSettingsSnapshot = protocolSettings;
        protocolSettingsHash = protocolSha256;
        plan = resolved;
        protocolPlan = resolvedProtocol;
        compiledPackageSelection = packageSelection;
        planError = null;
        if (resolved) {
          root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.planReady, {
            bubbles: true,
            detail: Object.freeze({
              settings,
              settingsSha256: sha256,
              plan: resolved,
              protocolSettings,
              protocolSettingsSha256: protocolSha256,
              protocolPlan: resolvedProtocol,
            }),
          }));
        }
      } catch (error) {
        if (generation !== planRefresh) return;
        settingsSnapshot = null;
        settingsHash = null;
        protocolSettingsSnapshot = null;
        protocolSettingsHash = null;
        plan = null;
        protocolPlan = null;
        planError = error instanceof Error ? error.message : String(error);
      }
      renderPlanPreview();
      renderQuestionnaires();
      renderReview();
    });
  }

  function renderPlanPreview() {
    const table = query("#assignment-preview");
    const hash = query("#plan-hash");
    const reviewHash = query("#review-plan-hash");
    const status = query("#plan-window-status");
    const previous = query("#plan-window-previous");
    const next = query("#plan-window-next");
    const exportButton = query("#assignment-plan-export");
    if (!(table instanceof HTMLElement)) return;
    if (!plan) {
      table.innerHTML = '<tr><td colspan="3" class="empty-state">The exact schedule appears after experiment.json and every referenced workspace video pass validation.</td></tr>';
      if (hash) hash.textContent = planError ?? "Pending valid allocation";
      if (reviewHash) reviewHash.textContent = planError ?? "Pending valid allocation";
      if (status) status.textContent = "Showing 0 of 0 participants.";
      if (previous instanceof HTMLButtonElement) previous.disabled = true;
      if (next instanceof HTMLButtonElement) next.disabled = true;
      if (exportButton instanceof HTMLButtonElement) exportButton.disabled = true;
      return;
    }
    const maximumStart = Math.floor((plan.assignments.length - 1) / 40) * 40;
    const start = Math.max(0, Math.min(maximumStart, participantWindowStart));
    participantWindowStart = start;
    const visible = plan.assignments.slice(start, start + 40);
    table.replaceChildren(...visible.map((assignment) => {
      const row = document.createElement("tr");
      const participant = document.createElement("td");
      participant.textContent = assignment.participantId;
      const order = document.createElement("td");
      order.textContent = assignment.blockOrder.map((blockId) => (
        experimentDocument?.definition.blocks.find((block) => block.blockId === blockId)?.label ?? blockId
      )).join(" → ");
      const videos = document.createElement("td");
      videos.textContent = assignment.slots.map(({ stimulusId, isiAfterMs }) => {
        const stimulus = plan.stimuli.find((item) => item.stimulusId === stimulusId);
        return `${stimulus?.title ?? stimulusId} → ISI ${(isiAfterMs / 1_000).toFixed(3)} s`;
      }).join("; ");
      row.append(participant, order, videos);
      return row;
    }));
    if (hash) hash.textContent = plan.planHashSha256;
    if (reviewHash) reviewHash.textContent = plan.planHashSha256;
    if (status) status.textContent = `Showing ${start + 1}–${start + visible.length} of ${plan.assignments.length} participants.`;
    if (previous instanceof HTMLButtonElement) previous.disabled = start === 0;
    if (next instanceof HTMLButtonElement) next.disabled = start + visible.length >= plan.assignments.length;
    if (exportButton instanceof HTMLButtonElement) exportButton.disabled = false;
  }

  async function exportAssignmentPlan() {
    if (!plan || !settingsSnapshot) return;
    let csv;
    try {
      csv = await externalExperimentPlanToCsv(plan);
    } catch (error) {
      announce(`Assignment plan export failed: ${error.message}`);
      return;
    }
    if (surface === "tauri") {
      root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.exportPlanRequest, {
        bubbles: true,
        detail: Object.freeze({
          experimentId: settingsSnapshot.experiment.id,
          filename: "resolved-experiment-plan.csv",
          csv,
          planHashSha256: plan.planHashSha256,
        }),
      }));
      return;
    }
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "resolved-experiment-plan.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function selectWorkspace() {
    if (surface === "tauri") {
      const event = new CustomEvent(RESEARCH_UI_EVENTS.selectWorkspaceRequest, { bubbles: true, cancelable: true });
      root.dispatchEvent(event);
      if (!event.defaultPrevented) announce("The Windows workspace adapter is not connected yet.");
      return;
    }
    if (!window.isSecureContext || typeof window.showDirectoryPicker !== "function") {
      const status = query("#workspace-status");
      if (status) {
        status.dataset.state = "error";
        status.textContent = "A secure desktop Chrome or Edge context with File System Access is required.";
      }
      announce("Workspace selection is unavailable in this browser context.");
      return;
    }
    try {
      workspace = await BrowserResearchWorkspace.choose({ windowObject: window });
      browserPackageRoot = null;
      packageAssetClosureSha256 = null;
      capabilities.directoryPermission = true;
      const output = query("#workspace-root");
      if (output) {
        output.textContent = workspace.rootHandle.name;
        output.dataset.state = "ready";
      }
      const status = query("#workspace-status");
      if (status) {
        status.dataset.state = "ready";
        status.textContent = "Work directory ready. Project locations are available.";
      }
      for (const id of ["workspace-rescan", "settings-save", "stimulus-add-workspace", "video-import", "video-folder-import"]) {
        const button = query(`#${id}`);
        if (button instanceof HTMLButtonElement) button.disabled = false;
      }
      capabilities.manifestReady = false;
      manifestReadinessMessage = "Output manifests are being scanned for the selected workspace.";
      root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.workspaceReady, {
        bubbles: true,
        detail: Object.freeze({ surface: "browser", label: workspace.rootHandle.name, directoryPermission: true }),
      }));
      announce(`Workspace ${workspace.rootHandle.name} selected.`);
      refreshProjection();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      announce(error instanceof Error ? error.message : String(error));
    }
  }

  function openWorkspaceLocation(location) {
    if (!["workspaceRoot", "videoLibrary", "experimentPackage"].includes(location)) {
      announce("The requested project location is not available.");
      return;
    }
    if (surface !== "tauri") {
      announce("Opening project locations in File Explorer is available in the Windows desktop app.");
      return;
    }
    const event = new CustomEvent(RESEARCH_UI_EVENTS.openWorkspaceLocationRequest, {
      bubbles: true,
      cancelable: true,
      detail: Object.freeze({ location }),
    });
    root.dispatchEvent(event);
    if (!event.defaultPrevented) announce("The Windows folder adapter is not connected yet.");
  }

  function refreshWorkspaceLocationButtons() {
    const canOpen = surface === "tauri" && capabilities.directoryPermission;
    root.querySelectorAll("[data-open-workspace-location]").forEach((button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      button.disabled = !canOpen;
      button.title = canOpen
        ? button.getAttribute("aria-label") ?? "Open in File Explorer"
        : surface === "tauri"
          ? "Set the work directory before opening it"
          : "Available in the Windows desktop app";
    });
  }

  async function renewWorkspacePermission() {
    if (surface === "tauri") {
      selectWorkspace();
      return;
    }
    if (!workspace) return;
    try {
      await workspace.renewPermission();
      capabilities.directoryPermission = true;
      query("#workspace-renew")?.setAttribute("hidden", "");
      capabilities.manifestReady = false;
      manifestReadinessMessage = "Output manifests are being scanned after permission renewal.";
      root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.workspaceReady, {
        bubbles: true,
        detail: Object.freeze({ surface: "browser", label: workspace.rootHandle.name, directoryPermission: true }),
      }));
      announce("Workspace permission renewed.");
      refreshProjection();
    } catch (error) {
      capabilities.directoryPermission = false;
      announce(error instanceof Error ? error.message : String(error));
      refreshProjection();
    }
  }

  async function requestWorkspaceRescan() {
    if (surface === "tauri") {
      root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.rescanWorkspaceRequest, { bubbles: true }));
      return;
    }
    if (!workspace) return;
    const status = query("#workspace-status");
    try {
      if (experimentPackageDocument) {
        if (status) status.textContent = "Scanning fixed assets/stimuli/ package media recursively…";
        const rootAttestation = await workspace.attestExperimentPackageRoot(
          experimentPackageDocument.canonicalSourceText,
        );
        const catalogue = rootAttestation.assets;
        browserPackageRoot = workspace;
        packageAssetClosureSha256 = rootAttestation.assetManifestSha256;
        const byPath = new Map(catalogue.map((entry) => [
          entry.packagePath,
          entry,
        ]));
        for (const asset of experimentPackageDocument.package.assets.stimuli) {
          const logicalPath = asset.relativePath.slice("assets/".length);
          const stimulus = stimuli.find(({ source, location }) => (
            source === "workspace" && location === logicalPath
          ));
          const entry = byPath.get(asset.relativePath);
          if (!stimulus) continue;
          if (!entry) {
            stimulus.file = null;
            stimulus.packageAssetPath = null;
            stimulus.verification = "failed";
            stimulus.error = `Missing fixed package asset ${asset.relativePath}.`;
            continue;
          }
          stimulus.file = await entry.fileHandle.getFile();
          stimulus.packageAssetPath = asset.relativePath;
          await verifyLocalFile(stimulus, { relativePath: logicalPath });
        }
        renderPools();
        schedulePlanRefresh();
        if (status) {
          status.dataset.state = "ready";
          status.textContent = `Package scan complete. ${catalogue.length} complete video file${catalogue.length === 1 ? "" : "s"} found under assets/stimuli/.`;
        }
        announce("Fixed package asset rescan complete.");
        return;
      }
      if (status) status.textContent = "Scanning stimuli/ recursively…";
      const catalogue = await workspace.rescanVideos();
      const seenLocations = new Set();
      for (const entry of catalogue) {
        const location = `stimuli/${entry.relativePath}`;
        seenLocations.add(location);
        const file = await entry.fileHandle.getFile();
        let stimulus = stimuli.find(({ source, location: existingLocation }) => source === "workspace" && existingLocation === location);
        if (stimulus) stimulus.file = file;
        else stimulus = addStimulus({ title: entry.name, source: "workspace", location, file });
        if (stimulus) await verifyLocalFile(stimulus, { relativePath: location });
      }
      for (let index = stimuli.length - 1; index >= 0; index -= 1) {
        if (stimuli[index].source === "workspace" && !seenLocations.has(stimuli[index].location)) {
          stimuli.splice(index, 1);
        }
      }
      renderPools();
      schedulePlanRefresh();
      if (status) {
        status.dataset.state = "ready";
        status.textContent = `Rescan complete. ${catalogue.length} complete video file${catalogue.length === 1 ? "" : "s"} found.`;
      }
      announce("Workspace rescan complete.");
    } catch (error) {
      packageAssetClosureSha256 = null;
      if (error?.code === "permission-required") {
        capabilities.directoryPermission = false;
        const renew = query("#workspace-renew");
        if (renew instanceof HTMLButtonElement) renew.hidden = false;
      }
      if (status) {
        status.dataset.state = "error";
        status.textContent = error instanceof Error ? error.message : String(error);
      }
      refreshProjection();
    }
  }

  async function requestSettingsSave() {
    try {
      const settings = await protocolSettingsFromUi();
      const sha256 = await canonicalSha256(settings);
      if (surface === "tauri") {
        const event = new CustomEvent(RESEARCH_UI_EVENTS.saveSettingsRequest, {
          bubbles: true,
          cancelable: true,
          detail: Object.freeze({ settings, settingsSha256: sha256, canonicalJson: canonicalJson(settings) }),
        });
        root.dispatchEvent(event);
        if (!event.defaultPrevented) throw new Error("The Windows settings adapter is not connected.");
      } else {
        if (!workspace) throw new Error("Select a workspace before saving settings.");
        await workspace.saveSettings(settings);
      }
      announce(`${settings.experiment.id}.settings.json saved with hash ${sha256}.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : String(error));
    }
  }

  function requestSettingsLoad() {
    if (surface === "tauri") {
      const event = new CustomEvent(RESEARCH_UI_EVENTS.loadSettingsRequest, { bubbles: true, cancelable: true });
      root.dispatchEvent(event);
      if (!event.defaultPrevented) announce("The Windows settings adapter is not connected.");
      return;
    }
    query("#settings-file-input")?.click();
  }

  function languageTreeFromUi() {
    if (languageEditorLocked && loadedLanguageSelection) return loadedLanguageSelection;
    const pending = questionnaireEditor.pendingKeys();
    if (pending.length) throw new TypeError(`Save the questionnaire tables first: ${pending.join(", ")}.`);
    if (questionnaireEditor.hasPresentationDraft()) {
      throw new TypeError("Repeated label headers are a design preview. Return each preview to ‘Above every item’ before building with the current experiment format.");
    }
    const flat = createCoveredFlatLanguageSelectionV1({
      definitions: questionnaireDefinitions,
      modules: questionnaireModules,
      languages: studyLanguages,
      requestedFamilyIds: requestedQuestionnaireFamilies,
    });
    return loadedLanguageSelection
      ? reconcileQuestionnaireModuleMappings(loadedLanguageSelection, questionnaireDefinitions, questionnaireModules)
      : flat;
  }

  /** P2 accepted-data handoff. Pending edits are never misreported as accepted. */
  function getQuestionnaireContributionSnapshot() {
    let contribution = null;
    let pending = !languageEditorLocked && (questionnaireEditor.pendingKeys().length > 0 || questionnaireEditor.hasPresentationDraft());
    try {
      // Participant route projection replaces the UI settings subset, not P2's
      // complete frozen contribution. Never serialize that subset as the study.
      const source = coverageSource();
      contribution = {
        questionnaires: { algorithmVersion: QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
          definitions: structuredClone(source.definitions), modules: structuredClone(source.modules) },
        languageSelection: structuredClone(languageTreeFromUi()),
      };
    } catch { pending = true; }
    const fingerprint = canonicalJson({ contribution, pending, studyLanguages, requestedQuestionnaireFamilies });
    if (fingerprint !== questionnaireContributionFingerprint) {
      questionnaireContributionFingerprint = fingerprint;
      questionnaireContributionRevision += 1;
    }
    return { revision: questionnaireContributionRevision, enabled: true, pending,
      contribution, dependencyRevisions: [] };
  }

  /** P7 calls after validated recipe settings are applied; no source file is needed. */
  async function restoreQuestionnaireContribution(contribution, { isCurrent = () => true } = {}) {
    const restored = await restoreQuestionnaireAuthoring(contribution);
    if (!isCurrent() || mode !== "setup") throw new Error("Questionnaire restoration was superseded; no tables were replaced.");
    questionnaireEditor.reset();
    questionnaireDefinitions.splice(0, questionnaireDefinitions.length, ...restored.contribution.questionnaires.definitions);
    questionnaireModules.splice(0, questionnaireModules.length, ...restored.contribution.questionnaires.modules);
    questionnaireAuthoringReceipts.clear();
    studyLanguages = restored.languages;
    requestedQuestionnaireFamilies.splice(0, requestedQuestionnaireFamilies.length, ...restored.families.map(f => f.id));
    loadedLanguageSelection = restored.contribution.languageSelection;
    languageEditorLocked = false;
    questionnaireContributionRevision += 1;
    clearParticipantLanguageSelection();
    renderQuestionnaires();
    return getQuestionnaireContributionSnapshot();
  }

  function packageRoutes() {
    return experimentPackageDocument
      ? enumerateLanguageRoutesV1(experimentPackageDocument.package.languageSelection)
      : [];
  }

  function participantLanguageContextKey() {
    if (!experimentPackageDocument) return null;
    const disposition = selectedAttemptDisposition();
    const recoveryBinding = participantRecoveryBindings.get(selectedParticipant);
    return canonicalJson({
      packageId: experimentPackageDocument.package.packageId,
      canonicalSourceByteSha256: experimentPackageDocument.canonicalSourceByteSha256,
      packageDefinitionSha256: experimentPackageDocument.package.integrity.packageDefinitionSha256,
      participantId: selectedParticipant,
      participantState: selectedParticipantState(),
      disposition,
      attemptIdentity: disposition === "resume-compatible"
        ? recoveryBinding?.attemptNumber ?? "missing-recovery-binding"
        : "new-attempt",
    });
  }

  function clearParticipantLanguageSelection({ close = true } = {}) {
    languageSelectionGeneration += 1;
    languageSelectionBusy = false;
    selectedLanguageId = null;
    selectedLanguageSelectionPath = null;
    selectedLanguageContextKey = null;
    languageTraversalPath = [];
    compiledPackageSelection = null;
    if (close) closeDialog("participant-language-dialog");
  }

  function synchronizeParticipantLanguageContext() {
    const contextKey = participantLanguageContextKey();
    if (!experimentPackageDocument) {
      if (selectedLanguageId || selectedLanguageContextKey) clearParticipantLanguageSelection();
      return null;
    }
    if (selectedLanguageContextKey !== null && selectedLanguageContextKey !== contextKey) {
      clearParticipantLanguageSelection();
    }
    return contextKey;
  }

  function selectedPackageRoute() {
    return packageRoutes().find((route) => (
      route.languageId === selectedLanguageId
      && canonicalJson(route.optionIds) === canonicalJson(selectedLanguageSelectionPath)
    )) ?? null;
  }

  function renderPackageLanguageRoutes() {
    renderStudyLanguages();
    renderQuestionnaireCoverage();
  }

  function renderPackageReceipt() {
    renderPackageLanguageRoutes();
    const status = query("#package-file-status");
    const reproduction = query("#package-reproduction-status");
    if (status) {
      if (experimentPackageDocument && packageReproductionReceipt && !packageIsStale) {
        status.dataset.state = "ready";
        status.textContent = `${experimentPackageDocument.package.packageId} · ${experimentPackageDocument.package.integrity.packageDefinitionSha256}`;
      } else {
        status.dataset.state = "warning";
        status.textContent = packageIsStale ? "Recipe changed · save the current design" : "No project JSON loaded";
      }
    }
    if (reproduction) {
      if (packageReproductionReceipt) {
        reproduction.dataset.state = "ready";
        reproduction.textContent = `Local deterministic projection · ${packageReproductionReceipt.caseCount} participant × language cases · canonical re-export matched`;
      } else {
        reproduction.dataset.state = "warning";
        reproduction.textContent = "Not verified";
      }
    }
    renderPackageExportReview();
  }

  function renderPackageExportReview() {
    const state = packageExport.snapshot();
    const review = plannerContributions.read();
    const output = query("#package-save-status");
    const messages = {
      editing: packageIsStale ? "The current design has changes to save." : "Review the design, then save its recipe.",
      compiling: "Validating the current design…",
      saving: "Waiting for the file writer. Finish or cancel the save dialog.",
      saved: "Recipe saved. The writer confirmed its exact bytes and hash.",
      cancelled: "Save cancelled. The design is still editable; try again when ready.",
      changed: "The design changed during export. Newer edits remain here; save them again.",
      error: "Save was not confirmed. The design remains available to retry.",
    };
    if (output) {
      output.textContent = messages[state.phase];
      output.dataset.state = state.phase === "saved" && !packageIsStale ? "ready" : "warning";
    }
    for (const id of ["package-generate", "package-edit", "package-load"]) {
      const button = query(`#${id}`);
      if (!button) continue;
      button.disabled = mode !== "setup" || state.busy
        || (id === "package-generate" && ((languageEditorLocked && packageIsStale) || review.issues.length > 0))
        || (id === "package-edit" && !experimentPackageDocument);
    }
    const list = query("#package-contribution-issues");
    if (list) {
      list.replaceChildren(...review.issues.map(({ segment, code, message }) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.plannerSegment = segment;
        const label = { P1: "Workspace", P2: "Questionnaires", P3: "Stimulus order", P4: "Screen layout", P5: "Flubber & controls", P6: "VR screen layout" }[segment];
        button.textContent = code === "successor-required"
          ? `${label}: these settings cannot be saved in the current recipe format.`
          : message.replace(`${segment}:`, `${label}:`);
        item.append(button);
        return item;
      }));
      list.hidden = review.issues.length === 0;
    }
  }

  const LANGUAGE_DEPENDENT_PREFLIGHT_IDS = new Set([
    "language", "plan", "questionnaires", "storage",
  ]);

  function languageChoicePrerequisiteBlockers() {
    return preflightItems().filter(({ id, result }) => (
      result === "block" && !LANGUAGE_DEPENDENT_PREFLIGHT_IDS.has(id)
    ));
  }

  function setParticipantLanguageError(message) {
    const error = query("#participant-language-error");
    if (error instanceof HTMLElement) {
      error.hidden = !message;
      error.textContent = message ? String(message) : "";
    }
  }

  function renderParticipantLanguageDialog({ focus = false } = {}) {
    if (!experimentPackageDocument) return;
    const step = resolveLanguageSelectionTraversalStepV1(
      experimentPackageDocument.package.languageSelection,
      languageTraversalPath,
    );
    if (step.kind !== "choice") return;
    const context = query("#participant-language-context");
    const title = query("#participant-language-title");
    const breadcrumb = query("#participant-language-breadcrumb");
    const prompt = query("#participant-language-prompt");
    const options = query("#participant-language-options");
    const back = query("#participant-language-back");
    const recovery = participantRecoveryBindings.get(selectedParticipant);
    if (context) context.textContent = selectedAttemptDisposition() === "resume-compatible" && recovery
      ? `${selectedParticipant} · recover attempt ${recovery.attemptNumber}`
      : `${selectedParticipant} · new attempt`;
    if (title) title.textContent = "Choose participant language";
    if (breadcrumb) breadcrumb.textContent = step.labels.length > 0
      ? step.labels.join(" › ")
      : "Start of package language selection";
    if (prompt) prompt.textContent = step.prompt;
    if (options instanceof HTMLElement) {
      options.replaceChildren(...step.options.map((option, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.languageOption = option.optionId;
        button.textContent = option.label;
        button.disabled = languageSelectionBusy;
        if (index === 0 && focus) queueMicrotask(() => button.focus());
        return button;
      }));
    }
    if (back instanceof HTMLButtonElement) {
      back.hidden = languageTraversalPath.length === 0;
      back.disabled = languageSelectionBusy;
    }
  }

  function openParticipantLanguageDialog() {
    const contextKey = synchronizeParticipantLanguageContext();
    if (!experimentPackageDocument || contextKey === null || languageSelectionBusy) return;
    if (selectedAttemptDisposition() === "resume-compatible") {
      announce("A compatible recovery restores its frozen package language and cannot be rerouted.");
      return;
    }
    const blockers = languageChoicePrerequisiteBlockers();
    if (blockers.length > 0) {
      announce(`Language selection is waiting for ${blockers.map(({ label }) => label).join(", ")}.`);
      return;
    }
    languageTraversalPath = [];
    setParticipantLanguageError("");
    renderParticipantLanguageDialog();
    const dialog = query("#participant-language-dialog");
    if (dialog instanceof HTMLDialogElement) {
      dialog.showModal();
      renderParticipantLanguageDialog({ focus: true });
    }
  }

  async function chooseParticipantLanguageOption(optionId) {
    if (!experimentPackageDocument || languageSelectionBusy) return;
    try {
      const nextPath = [...languageTraversalPath, optionId];
      const step = resolveLanguageSelectionTraversalStepV1(
        experimentPackageDocument.package.languageSelection,
        nextPath,
      );
      languageTraversalPath = nextPath;
      setParticipantLanguageError("");
      if (step.kind === "choice") {
        renderParticipantLanguageDialog({ focus: true });
        return;
      }
      renderParticipantLanguageDialog();
      const activated = await activatePackageRoute(step, {
        contextKey: participantLanguageContextKey(),
      });
      if (!activated) return;
      closeDialog("participant-language-dialog");
      announce(`${step.languageLabel} (${step.languageTag}) is frozen for ${selectedParticipant}'s next attempt.`);
    } catch (error) {
      clearParticipantLanguageSelection({ close: false });
      setParticipantLanguageError(error instanceof Error ? error.message : String(error));
      renderParticipantLanguageDialog({ focus: true });
      renderReview();
    }
  }

  async function restoreRecoveryLanguage(binding, contextKey) {
    try {
      const { binding: normalized, terminal } = validateRecoveryLanguageBinding(binding);
      const activated = await activatePackageRoute(terminal, {
        contextKey,
        expectedRecoveryBinding: normalized,
      });
      if (activated) {
        announce(`${terminal.languageLabel} restored from recoverable attempt ${normalized.attemptNumber}.`);
      }
    } catch (error) {
      clearParticipantLanguageSelection();
      const status = query("#participant-language-status");
      if (status) {
        status.dataset.state = "error";
        status.textContent = error instanceof Error ? error.message : String(error);
      }
      announce(`Recovery language restore failed closed: ${error instanceof Error ? error.message : String(error)}`);
      renderPreflight();
    }
  }

  function renderParticipantLanguageReadiness() {
    const status = query("#participant-language-status");
    const choose = query("#choose-participant-language");
    if (!(choose instanceof HTMLButtonElement) || !status) return;
    const contextKey = synchronizeParticipantLanguageContext();
    const route = selectedPackageRoute();
    const disposition = selectedAttemptDisposition();
    choose.textContent = route ? "Change participant language" : "Choose participant language";
    if (!experimentPackageDocument || contextKey === null) {
      choose.disabled = true;
      status.dataset.state = "warning";
      status.textContent = `Load or generate ${EXPERIMENT_PACKAGE_FILE_NAME} first.`;
      return;
    }
    if (route && compiledPackageSelection && selectedLanguageContextKey === contextKey) {
      choose.disabled = disposition === "resume-compatible"
        || languageChoicePrerequisiteBlockers().length > 0;
      status.dataset.state = "ready";
      status.textContent = `${route.languageLabel} (${route.languageTag}) · ${route.labels.join(" › ")}`;
      return;
    }
    if (languageSelectionBusy) {
      choose.disabled = true;
      status.dataset.state = "warning";
      status.textContent = disposition === "resume-compatible"
        ? "Restoring the exact language route from the recoverable attempt…"
        : "Validating the selected language route…";
      return;
    }
    if (disposition === "resume-compatible") {
      choose.disabled = true;
      const binding = participantRecoveryBindings.get(selectedParticipant);
      if (!binding) {
        status.dataset.state = "error";
        status.textContent = "This partial attempt has no package language recovery binding. Choose Start a new attempt.";
        return;
      }
      try {
        validateRecoveryLanguageBinding(binding);
        languageSelectionBusy = true;
        status.dataset.state = "warning";
        status.textContent = `Restoring attempt ${binding.attemptNumber}'s frozen language route…`;
        queueMicrotask(() => restoreRecoveryLanguage(binding, contextKey));
      } catch (error) {
        status.dataset.state = "error";
        status.textContent = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    const blockers = languageChoicePrerequisiteBlockers();
    choose.disabled = blockers.length > 0;
    status.dataset.state = blockers.length > 0 ? "warning" : "ready";
    status.textContent = blockers.length > 0
      ? `Complete ${blockers.map(({ label }) => label).join(", ")} before handing language choice to the participant.`
      : "Ready for the participant to follow the package-owned language tree.";
  }

  function validateRecoveryLanguageBinding(binding) {
    const normalized = validateExperimentPackageRecoveryBindingV1(binding);
    if (!experimentPackageDocument
      || normalized.participantId !== selectedParticipant
      || normalized.disposition !== "resume-compatible"
      || normalized.packageId !== experimentPackageDocument.package.packageId
      || normalized.canonicalSourceByteSha256
        !== experimentPackageDocument.canonicalSourceByteSha256
      || normalized.packageDefinitionSha256
        !== experimentPackageDocument.package.integrity.packageDefinitionSha256) {
      throw new TypeError(
        "The recoverable attempt is bound to a different participant or experiment package.",
      );
    }
    const terminal = resolveLanguageSelectionTraversalStepV1(
      experimentPackageDocument.package.languageSelection,
      normalized.languageSelectionPath,
    );
    if (terminal.kind !== "terminal" || terminal.languageId !== normalized.languageId) {
      throw new TypeError("The recoverable attempt has a stale or invalid language route.");
    }
    return Object.freeze({ binding: normalized, terminal });
  }

  async function activatePackageRoute(route, {
    contextKey = participantLanguageContextKey(),
    expectedRecoveryBinding = null,
  } = {}) {
    if (!experimentPackageDocument || !route) {
      throw new TypeError("Choose a terminal language route from a validated package.");
    }
    const terminal = resolveLanguageSelectionTraversalStepV1(
      experimentPackageDocument.package.languageSelection,
      route.optionIds,
    );
    if (terminal.kind !== "terminal" || terminal.languageId !== route.languageId) {
      throw new TypeError("The language route does not resolve to the declared terminal language.");
    }
    const generation = ++languageSelectionGeneration;
    languageSelectionBusy = true;
    const participantId = experimentPackageDocument.package.settings.externalProtocol
      .definition.schedules.some((schedule) => schedule.participantId === selectedParticipant)
      ? selectedParticipant
      : experimentPackageDocument.package.settings.externalProtocol.definition.schedules[0].participantId;
    const compiled = await compileExperimentPackageSelectionV1(experimentPackageDocument.package, {
      languageId: terminal.languageId,
      languageSelectionPath: terminal.optionIds,
      participantId,
    });
    if (expectedRecoveryBinding
      && compiled.assignmentSha256 !== expectedRecoveryBinding.assignmentSha256) {
      throw new TypeError(
        "The recoverable attempt assignment does not match this package, participant, and language route.",
      );
    }
    const stillCurrent = () => generation === languageSelectionGeneration
      && contextKey !== null
      && contextKey === participantLanguageContextKey();
    if (!stillCurrent()) return false;
    selectedParticipant = participantId;
    selectedLanguageId = terminal.languageId;
    selectedLanguageSelectionPath = [...terminal.optionIds];
    selectedLanguageContextKey = contextKey;
    compiledPackageSelection = compiled;
    experimentDocument = Object.freeze({
      definition: structuredClone(compiled.experimentDocument.definition),
      sourceText: compiled.experimentDocument.sourceText,
      sourceByteSha256: compiled.experimentDocument.sourceByteSha256,
      definitionSha256: compiled.experimentDocument.definitionSha256,
    });
    const applied = await applyResearchSettings(compiled.settings, {
      preserveVerifiedStimuli: true,
      guard: stillCurrent,
      packageProjection: true,
    });
    if (!applied || !stillCurrent()) return false;
    compiledPackageSelection = compiled;
    languageSelectionBusy = false;
    renderPackageReceipt();
    renderReview();
    return true;
  }

  async function applyExperimentPackageReceipt(receipt, { rootWorkspace = null, guard = null } = {}) {
    const generation = ++packageLoadGeneration;
    const parsed = await parseExperimentPackageV1(new TextEncoder().encode(
      receipt?.canonicalSourceText ?? receipt?.sourceText ?? receipt,
    ));
    const reproduction = await verifySameRealmPackageReproductionV1(parsed.package);
    const current = () => generation === packageLoadGeneration && (!guard || guard());
    if (!current()) return false;
    if (!guard) packageExport.invalidate();
    packageReproductionReceipt = reproduction;
    experimentPackageDocument = parsed;
    editablePackageDefaults = { experimentId: parsed.package.settings.experiment.id,
      packageId: parsed.package.packageId, playback: structuredClone(parsed.package.playback) };
    packageIsStale = false;
    browserPackageRoot = surface === "browser" ? rootWorkspace : null;
    packageAssetClosureSha256 = null;
    clearParticipantLanguageSelection();
    loadedLanguageSelection = structuredClone(parsed.package.languageSelection);
    languageEditorLocked = true;
    studyLanguages = parsed.package.languageSelection.languages.map((language) => ({
      languageId: language.languageId,
      languageTag: language.languageTag,
      label: language.label,
    }));
    requestedQuestionnaireFamilies.splice(0, requestedQuestionnaireFamilies.length);
    for (const module of parsed.package.settings.questionnaires.modules) {
      const definition = parsed.package.settings.questionnaires.definitions.find((candidate) => (
        candidate.questionnaireId === module.questionnaireId
      ));
      if (definition) requestQuestionnaireFamily(familyIdForDefinition(definition));
    }
    if (!await applyResearchSettings(parsed.package.settings, {
      preserveVerifiedStimuli: true, packageProjection: true, guard: current,
    })) return false;
    packageContributionFingerprint = plannerContributions.read().fingerprint;
    observedContributions = packageContributionFingerprint;
    renderPackageReceipt();
    root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.setupSettingsReady, {
      bubbles: true,
      detail: Object.freeze({ settings: parsed.package.settings }),
    }));
    announce(`Loaded ${parsed.package.packageId}. Its complete ${packageReproductionReceipt.caseCount}-case protocol matrix and canonical re-export passed the local deterministic check. No language was selected; the participant must traverse the package tree before Start.`);
    if (workspace) void requestWorkspaceRescan().catch((error) => {
      announce(`Recipe loaded; workspace verification still needs attention: ${error instanceof Error ? error.message : String(error)}`);
    });
    return true;
  }

  function requestExperimentPackageLoad() {
    if (packageExport.snapshot().busy || mode !== "setup") return;
    if (surface === "tauri") {
      const event = new CustomEvent(RESEARCH_UI_EVENTS.loadExperimentPackageRequest, {
        bubbles: true,
        cancelable: true,
      });
      root.dispatchEvent(event);
      if (!event.defaultPrevented) announce("The native experiment package adapter is not connected.");
      return;
    }
    if (!workspace) {
      announce(`Select the package root before loading ${EXPERIMENT_PACKAGE_FILE_NAME}.`);
      return;
    }
    void workspace.loadExperimentPackage()
      .then((receipt) => applyExperimentPackageReceipt(receipt, { rootWorkspace: workspace }))
      .catch((error) => {
        announce(`Experiment package load failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  async function generateExperimentPackage({ reexport = false } = {}) {
    observePackageDraft();
    const draft = observedPackageDraft;
    const contributionFingerprint = plannerContributions.read().fingerprint;
    const currentWorkspace = workspace;
    try {
      const result = await packageExport.save({
        isCurrent: () => mode === "setup" && currentWorkspace === workspace
          && packageDraftFingerprint() === draft
          && plannerContributions.read().fingerprint === contributionFingerprint,
        compile: async () => {
          await plannerContributions.assertPackageV1();
          if (reexport) {
            if (!experimentPackageDocument || packageIsStale) throw new Error("Open an unchanged recipe before re-exporting.");
            await plannerContributions.assertPackageV1(experimentPackageDocument.package);
            return experimentPackageDocument;
          }
          if (languageEditorLocked) throw new Error("Choose Edit recipe before revising the loaded design.");
          const settings = await researchSettingsFromUi();
          const languageSelection = languageTreeFromUi();
          const retained = editablePackageDefaults?.experimentId === settings.experiment.id ? editablePackageDefaults : null;
          const packageValue = await createExperimentPackageV1({
            packageId: retained?.packageId ?? `${settings.experiment.id.slice(0, 119)}-package`,
            ...(retained ? { playback: retained.playback } : {}), languageSelection, settings,
          });
          await plannerContributions.assertPackageV1(packageValue);
          const sourceText = await serializeExperimentPackageV1(packageValue);
          return parseExperimentPackageV1(new TextEncoder().encode(sourceText));
        },
        write: async (parsed) => {
          if (surface === "tauri") return requestExperimentPackageSave(root, parsed);
          if (!currentWorkspace) throw new Error("Select the package root before saving the recipe.");
          const sourceText = parsed.canonicalSourceText;
          const persisted = await workspace.saveExperimentPackage(sourceText);
          if (persisted.canonicalSourceText !== sourceText
            || persisted.canonicalSourceByteSha256 !== parsed.canonicalSourceByteSha256) {
            throw new Error("The browser writer did not confirm the exact recipe bytes.");
          }
          return persisted;
        },
        adopt: async (parsed, guard) => {
          if (!reexport) return applyExperimentPackageReceipt(parsed, { rootWorkspace: currentWorkspace, guard });
          return true;
        },
      });
      if (result.status === "saved") announce(`${EXPERIMENT_PACKAGE_FILE_NAME} saved. Its exact canonical bytes were acknowledged.`);
      else if (result.status === "cancelled") announce("Save cancelled. Your design is still available.");
      else if (result.status !== "busy") announce("The design changed during export. Newer edits were preserved; save the current design again.");
    } catch (error) {
      announce(`Recipe export failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    renderPackageReceipt();
    renderReview();
  }

  async function editExperimentPackage() {
    if (!experimentPackageDocument || packageExport.snapshot().busy || mode !== "setup") return;
    const restore = root.researchUi?.restoreQuestionnaireContribution;
    if (typeof restore !== "function") {
      announce("Editable recipe restoration requires the questionnaire contribution adapter. The loaded recipe is preserved.");
      return;
    }
    const original = experimentPackageDocument;
    const generation = ++packageLoadGeneration;
    const draft = packageDraftFingerprint();
    const isCurrent = () => generation === packageLoadGeneration
      && experimentPackageDocument === original && packageDraftFingerprint() === draft
      && mode === "setup" && !packageExport.snapshot().busy;
    try {
      // P2 restores full definitions/modules and the exact tree, never a grid-only
      // projection or the currently selected participant-language subset.
      const restored = await restore({
        questionnaires: structuredClone(original.package.settings.questionnaires),
        languageSelection: structuredClone(original.package.languageSelection),
      }, { isCurrent });
      if (restored === false || generation !== packageLoadGeneration || experimentPackageDocument !== original) return;
      experimentPackageDocument = null;
      packageContributionFingerprint = null;
      packageIsStale = false;
      packageReproductionReceipt = null;
      packageAssetClosureSha256 = null;
      languageEditorLocked = false;
      clearParticipantLanguageSelection();
      packageExport.invalidate();
      renderPackageReceipt();
      schedulePlanRefresh();
      announce("Recipe opened for editing. Save a new snapshot when the changes are ready.");
    } catch (error) {
      announce(`Recipe editing could not be opened: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function applyExperimentDocument(receipt) {
    if (!receipt?.definition || typeof receipt.sourceText !== "string"
      || !receipt.sourceByteSha256 || !receipt.definitionSha256) {
      throw new TypeError("Experiment import returned no strict ExperimentDefinitionV1 receipt.");
    }
    const definition = validateExperimentDefinitionV1(receipt.definition);
    experimentPackageDocument = null;
    editablePackageDefaults = null;
    browserPackageRoot = null;
    packageAssetClosureSha256 = null;
    packageReproductionReceipt = null;
    loadedLanguageSelection = null;
    languageEditorLocked = false;
    clearParticipantLanguageSelection();
    const sourceByteSha256 = String(receipt.sourceByteSha256);
    const definitionSha256 = String(receipt.definitionSha256);
    const replacesDefinition = experimentDocument?.definitionSha256 !== definitionSha256;
    if (!/^[a-f0-9]{64}$/u.test(sourceByteSha256)
      || !/^[a-f0-9]{64}$/u.test(definitionSha256)
      || await sha256Hex(new TextEncoder().encode(receipt.sourceText)) !== sourceByteSha256
      || await canonicalSha256(definition) !== definitionSha256) {
      throw new TypeError("Experiment import hashes do not bind the validated definition.");
    }
    experimentDocument = Object.freeze({
      definition: structuredClone(definition),
      sourceText: receipt.sourceText,
      sourceByteSha256,
      definitionSha256,
    });
    setInputValue("experiment-id", experimentDocument.definition.experimentId);
    setInputValue("experiment-title", experimentDocument.definition.title);
    setInputValue("participant-count", experimentDocument.definition.schedules.length);
    selectedParticipant = experimentDocument.definition.schedules[0].participantId;
    participantWindowStart = 0;
    participantTileWindowStart = 0;
    if (replacesDefinition) {
      questionnaireModules.splice(0, questionnaireModules.length);
      requestedQuestionnaireFamilies.splice(0, requestedQuestionnaireFamilies.length);
    }
    const status = query("#experiment-file-status");
    if (status) {
      status.dataset.state = "ready";
      status.textContent = `${experimentDocument.definition.experimentId} · ${experimentDocument.definition.schedules.length} participants · ${experimentDocument.definition.blocks.length} blocks · definition ${experimentDocument.definitionSha256}`;
    }
    renderPools();
    renderQuestionnaires();
    renderParticipantGrid();
    renderPackageReceipt();
    schedulePlanRefresh();
    announce(`Loaded ${experimentDocument.definition.experimentId} experiment.json. Exact external order and ISI values are now read-only.`);
  }

  function requestExperimentLoad() {
    if (surface === "tauri") {
      const event = new CustomEvent(RESEARCH_UI_EVENTS.loadExperimentRequest, {
        bubbles: true,
        cancelable: true,
      });
      root.dispatchEvent(event);
      if (!event.defaultPrevented) announce("The native experiment.json adapter is not connected.");
      return;
    }
    query("#experiment-file-input")?.click();
  }

  function showImportReport(report) {
    const body = query("#import-report-body");
    if (!(body instanceof HTMLElement)) return;
    body.replaceChildren(...report.map((entry) => {
      const row = document.createElement("tr");
      for (const value of [entry.status, entry.sourcePath ?? "—", entry.targetPath ?? "—", entry.message]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }));
    const dialog = query("#import-report-dialog");
    if (dialog instanceof HTMLDialogElement) dialog.showModal();
  }

  async function loadSettingsPayload(payload, { report = null } = {}) {
    let settings;
    let protocolSettings = null;
    let importReport = report;
    if (payload?.schema === DEFAULT_SETTINGS.schema) {
      if (payload.version !== 3) {
        throw new TypeError("This active Research instrument loads ResearchSettingsV3. Historical V1/V2 settings remain readable by their archived contract tools but cannot restore external order.");
      }
      protocolSettings = await validateResearchSettingsV3(payload);
      settings = protocolSettings;
    } else {
      if (!experimentDocument) {
        throw new TypeError("Load experiment.json before importing portable settings so external video order and ISIs remain authoritative.");
      }
      const imported = importPortableSettingsV1(payload);
      settings = await applyLegacySettingsV1ToResearchSettingsV3(
        imported.settings,
        await researchSettingsFromUi(),
      );
      protocolSettings = settings;
      importReport = [
        ...imported.report,
        {
          status: "mapped",
          sourcePath: null,
          targetPath: "externalProtocol",
          message: "Kept experiment identity, video order, block order, and ISIs from the loaded experiment.json.",
        },
      ];
    }
    await applyResearchSettings(settings);
    renderQuestionnaires();
    if (importReport?.length) showImportReport(importReport);
    announce(`Loaded ${settings.experiment.id}.settings.json. Workspace videos require fresh verification.`);
  }

  function requestVideoImport({ directory = false } = {}) {
    if (surface === "tauri") {
      root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.importVideosRequest, {
        bubbles: true,
        detail: Object.freeze({ recursiveDirectory: directory }),
      }));
      return;
    }
    query(directory ? "#video-folder-input" : "#video-file-input")?.click();
  }

  async function ingestBrowserFiles(fileList) {
    const files = [...(fileList ?? [])].filter((file) => isSupportedVideoName(file.name));
    if (!files.length) {
      announce("No supported complete-video files were selected.");
      return;
    }
    if (!workspace) {
      announce("Select a workspace before importing complete videos.");
      return;
    }
    try {
      const importedPaths = await workspace.importVideoFiles(files);
      for (let index = 0; index < files.length; index += 1) {
        const relativePath = `stimuli/${importedPaths[index]}`;
        const stimulus = addStimulus({
          title: files[index].name.replaceAll("\\", "/").split("/").at(-1),
          source: "workspace",
          location: relativePath,
          file: files[index],
        });
        if (stimulus) await verifyLocalFile(stimulus, { relativePath });
      }
      announce(`${files.length} complete video file${files.length === 1 ? "" : "s"} imported and verified.`);
    } catch (error) {
      announce(error instanceof Error ? error.message : String(error));
    }
  }

  function openStimulusDialog(source) {
    const dialog = query("#stimulus-dialog");
    const sourceSelect = query("#stimulus-source");
    if (sourceSelect instanceof HTMLSelectElement) sourceSelect.value = source;
    updateStimulusDialogSource();
    if (dialog instanceof HTMLDialogElement) dialog.showModal();
  }

  function updateStimulusDialogSource() {
    const source = value("stimulus-source", "workspace");
    const label = query("#stimulus-location-label");
    const help = query("#stimulus-dialog-help");
    if (label) label.textContent = source === "youtube" ? "YouTube URL" : source === "repository" ? "Repository asset path" : "Workspace catalogue item";
    if (help) help.textContent = source === "youtube"
      ? "This source is explicitly unverified and noncanonical; no byte hash is claimed."
      : source === "repository"
        ? "Repository media is only for small demos beneath GitHub's regular-file limit. Hash, size, duration, and decode are verified before Start."
        : "Complete-file duration, byte identity, and decode verification are required before Start.";
  }

  function updateInputPoint(x, y, receipt, { fromInput = false, inputActive = false, source = null } = {}) {
    inputPoint = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
    const simulatorOwnsDesignProjection = mode === "setup" && previewResponseSimulator !== null;
    if (simulatorOwnsDesignProjection) previewResponseSimulator.setPoint(inputPoint);
    if (fromInput && surface !== "tauri") inputTestPassed = true;
    const grid = query(".input-test-grid");
    if (grid instanceof HTMLElement) {
      grid.style.setProperty("--input-left", `${((inputPoint.x + 1) / 2) * 100}%`);
      grid.style.setProperty("--input-top", `${((1 - inputPoint.y) / 2) * 100}%`);
    }
    const xOutput = query("#input-test-x");
    const yOutput = query("#input-test-y");
    if (xOutput) xOutput.textContent = `${inputPoint.x >= 0 ? "+" : ""}${inputPoint.x.toFixed(3)}`;
    if (yOutput) yOutput.textContent = `${inputPoint.y >= 0 ? "+" : ""}${inputPoint.y.toFixed(3)}`;
    const status = query("#input-test-status");
    if (status && receipt) {
      status.textContent = receipt;
      status.dataset.state = "ready";
    }
    root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.inputTestState, {
      bubbles: true,
      detail: Object.freeze({
        x: inputPoint.x,
        y: inputPoint.y,
        inputActive: Boolean(inputActive),
        source,
        passed: inputTestPassed,
      }),
    }));
    refreshProjection({ designAlreadyProjected: simulatorOwnsDesignProjection });
  }

  function applyNativeInputStatus(status) {
    if (surface !== "tauri" || !status) return;
    const observation = status.lastInput;
    if (mode === "setup" && Number.isInteger(observation?.sequence)
      && observation.sequence > nativeInputLastSequence) {
      nativeInputLastSequence = observation.sequence;
      if (inputBinding.kind !== "digital"
        && Number.isFinite(observation.x)
        && Number.isFinite(observation.y)) {
        updateInputPoint(
          observation.x,
          observation.y,
          `Native ${observation.detail} accepted.`,
          { inputActive: observation.inputActive, source: observation.detail },
        );
      } else if (observation.applyStep === true && inputBinding.kind === "digital") {
        const step = inputBinding.stepSize;
        const delta = {
          up: [0, step], down: [0, -step], left: [-step, 0], right: [step, 0],
        }[observation.direction] ?? [0, 0];
        updateInputPoint(
          inputPoint.x + delta[0],
          inputPoint.y + delta[1],
          `Native ${observation.direction} edge accepted.`,
          { inputActive: observation.inputActive, source: observation.detail },
        );
      }
    }
    nativeInputReceiptId = status.receipt?.receiptId ?? null;
    inputTestPassed = Boolean(nativeInputReceiptId);
    const output = query("#input-test-status");
    if (output && mode === "setup") {
      if (status.receipt) {
        output.textContent = `Native test passed for device epoch ${status.receipt.deviceEpoch}.`;
        output.dataset.state = "ready";
      } else if (Array.isArray(status.remainingDirections)) {
        output.textContent = status.remainingDirections.length
          ? `Native test: exercise ${status.remainingDirections.join(", ")}.`
          : "Run a fresh native input test.";
        output.dataset.state = "warning";
      }
    }
    renderReview();
  }

  function beginBindingCapture(direction) {
    const receipt = query("#binding-capture-receipt");
    if (surface === "tauri") {
      nativeCaptureDirection = direction;
      inputController.cancelCapture();
      root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.inputCaptureRequest, {
        bubbles: true,
        detail: Object.freeze({ direction, binding: structuredClone(inputBinding) }),
      }));
      return;
    }
    const complete = (result) => {
      if (!result.ok) {
        if (receipt) {
          receipt.textContent = result.error instanceof Error ? result.error.message : "That action cannot be assigned.";
          receipt.dataset.state = "error";
        }
        return;
      }
      inputBinding = structuredClone(result.binding);
      resetInputTest({ notify: false });
      inputController.setBinding(inputBinding);
      inputController.cancelCapture();
      if (gamepadCaptureFrame !== null) cancelAnimationFrame(gamepadCaptureFrame);
      gamepadCaptureFrame = null;
      setInputValue("input-preset", "custom");
      renderBindings();
      schedulePlanRefresh();
      if (receipt) {
        receipt.textContent = `${describeInputToken(result.action)} assigned to ${result.direction}.`;
        receipt.dataset.state = "ready";
      }
      setTimeout(() => {
        closeDialog("binding-capture-dialog");
        refreshProjection();
      }, 180);
    };
    inputController.beginCapture(direction, complete);
    const previous = new Map();
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      pad.buttons.forEach((button, index) => previous.set(`${pad.index}:${index}`, button.pressed));
    }
    const pollGamepadCapture = () => {
      gamepadCaptureFrame = null;
      if (inputController.captureDirection !== direction) return;
      for (const pad of navigator.getGamepads?.() ?? []) {
        if (!pad) continue;
        for (let index = 0; index < pad.buttons.length; index += 1) {
          const key = `${pad.index}:${index}`;
          const pressed = pad.buttons[index].pressed;
          if (pressed && previous.get(key) === false) {
            previous.set(key, true);
            try {
              const binding = withCustomDigitalAction(inputBinding, direction, { kind: "gamepadButton", button: index });
              complete({ ok: true, direction, action: { kind: "gamepadButton", button: index }, binding });
            } catch (error) {
              complete({ ok: false, direction, action: { kind: "gamepadButton", button: index }, error });
              gamepadCaptureFrame = requestAnimationFrame(pollGamepadCapture);
            }
            return;
          }
          previous.set(key, pressed);
        }
      }
      gamepadCaptureFrame = requestAnimationFrame(pollGamepadCapture);
    };
    gamepadCaptureFrame = requestAnimationFrame(pollGamepadCapture);
  }

  function routeCaptureEvent(event) {
    if (event.type === "keydown") return inputController.handleKeyDown(event);
    if (event.type === "mousedown") return inputController.handleMouseDown(event);
    if (event.type === "wheel") return inputController.handleWheel(event);
    return false;
  }

  function cancelBindingCapture() {
    inputController.cancelCapture();
    if (gamepadCaptureFrame !== null) cancelAnimationFrame(gamepadCaptureFrame);
    gamepadCaptureFrame = null;
    if (surface === "tauri" && nativeCaptureDirection) {
      nativeCaptureDirection = null;
      root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.inputCaptureCancel, { bubbles: true }));
    }
  }

  function applyNativeCapture(result) {
    if (surface !== "tauri" || !result?.binding || !result?.action) return false;
    inputBinding = structuredClone(validateInputBindingV1(result.binding));
    resetInputTest({ notify: false });
    nativeCaptureDirection = null;
    inputController.setBinding(inputBinding);
    setInputValue("input-preset", "custom");
    renderBindings();
    schedulePlanRefresh();
    const receipt = query("#binding-capture-receipt");
    if (receipt) {
      receipt.textContent = `${describeInputToken(result.action)} assigned to ${result.direction} by native capture.`;
      receipt.dataset.state = "ready";
    }
    closeDialog("binding-capture-dialog");
    refreshProjection();
    return true;
  }

  function closeDialog(id) {
    const dialog = query(`#${id}`);
    if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
  }

  const previewColorDialog = query("#preview-color-dialog");
  if (previewColorDialog instanceof HTMLDialogElement) {
    previewColorDialog.addEventListener("close", () => {
      if (!previewColorAnchor) return;
      cancelPreviewColorPaint();
      previewColorAnchor = null;
      previewColorDraft = null;
      previewColorLabelDraft = null;
      refreshProjection();
    });
  }

  function renderRunQuestionnaire({ focus = false } = {}) {
    const stage = query("#run-questionnaire-stage");
    const runStage = query(".run-stage");
    if (!(stage instanceof HTMLElement) || !(runStage instanceof HTMLElement)) return;
    if (!activeQuestionnaire) {
      stage.hidden = true;
      runStage.hidden = false;
      return;
    }
    const { definition, module, answers, itemIndex } = activeQuestionnaire;
    const item = definition.items[itemIndex];
    stage.hidden = false;
    runStage.hidden = true;
    const transition = query("#run-transition");
    if (transition instanceof HTMLElement) transition.hidden = true;
    const kicker = query("#run-questionnaire-kicker");
    const title = query("#run-questionnaire-title");
    const instructions = query("#run-questionnaire-instructions");
    const progress = query("#run-questionnaire-progress");
    if (kicker) kicker.textContent = `${module.placement.kind.replace(/([A-Z])/gu, " $1").toLowerCase()} · form ${itemIndex + 1} of ${definition.items.length}`;
    if (title) title.textContent = definition.title;
    if (instructions) instructions.textContent = definition.instructions;
    const checkedCount = definition.items.filter(({ itemId }) => Object.hasOwn(answers, itemId)).length;
    if (progress) progress.textContent = `${checkedCount} of ${definition.items.length} answered`;

    const container = query("#run-questionnaire-items");
    if (container instanceof HTMLElement) {
      const fieldset = document.createElement("fieldset");
      fieldset.className = "questionnaire-item";
      fieldset.dataset.questionnaireItem = item.itemId;
      fieldset.tabIndex = -1;
      const legend = document.createElement("legend");
      legend.textContent = `${item.order}. ${item.prompt}${item.required ? " (required)" : ""}`;
      fieldset.append(legend);
      for (const option of item.options) {
        const label = document.createElement("label");
        label.className = "questionnaire-option";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = `questionnaire-${module.moduleId}-${item.itemId}`;
        input.value = option.optionId;
        input.dataset.questionnaireAnswer = item.itemId;
        input.checked = answers[item.itemId] === option.optionId;
        const text = document.createElement("span");
        text.textContent = option.label;
        label.append(input, text);
        fieldset.append(label);
      }
      container.replaceChildren(fieldset);
    }
    const previous = query("#run-questionnaire-previous");
    const next = query("#run-questionnaire-next");
    const submit = query("#run-questionnaire-submit");
    if (previous instanceof HTMLButtonElement) previous.disabled = itemIndex === 0;
    if (next instanceof HTMLButtonElement) next.hidden = itemIndex === definition.items.length - 1;
    if (submit instanceof HTMLButtonElement) submit.hidden = itemIndex !== definition.items.length - 1;
    const error = query("#run-questionnaire-error");
    if (error instanceof HTMLElement) error.hidden = true;
    if (focus) queueMicrotask(() => container?.querySelector("input:checked, input, fieldset")?.focus());
  }

  function showRunQuestionnaire(detail) {
    if (detail?.active === false) {
      activeQuestionnaire = null;
      renderRunQuestionnaire();
      return;
    }
    const moduleId = detail?.moduleId;
    const module = questionnaireModules.find((candidate) => candidate.moduleId === moduleId);
    const definition = module ? questionnaireDefinition(module.questionnaireId) : null;
    if (!module || !definition) throw new TypeError(`Run requested unknown questionnaire module ${moduleId ?? "(missing)"}.`);
    validateQuestionnaireDefinitionV1(definition);
    const answers = detail?.answers && typeof detail.answers === "object" && !Array.isArray(detail.answers)
      ? { ...detail.answers }
      : activeQuestionnaire?.module.moduleId === moduleId
        ? { ...activeQuestionnaire.answers }
        : {};
    validateQuestionnaireAnswers(definition, answers, { allowPartial: true });
    const requestedIndex = Number.isSafeInteger(detail?.itemIndex) ? detail.itemIndex : 0;
    activeQuestionnaire = {
      module: structuredClone(module),
      definition: structuredClone(definition),
      answers,
      itemIndex: Math.max(0, Math.min(definition.items.length - 1, requestedIndex)),
      protocolStepPosition: detail?.protocolStepPosition,
    };
    renderRunQuestionnaire({ focus: true });
  }

  function currentQuestionnaireItemIsReady() {
    if (!activeQuestionnaire) return false;
    const item = activeQuestionnaire.definition.items[activeQuestionnaire.itemIndex];
    const ready = !item.required || Object.hasOwn(activeQuestionnaire.answers, item.itemId);
    const error = query("#run-questionnaire-error");
    if (error instanceof HTMLElement) {
      error.hidden = ready;
      error.textContent = ready ? "" : "Choose one response before continuing.";
    }
    if (!ready) query(`[data-questionnaire-item="${item.itemId}"]`)?.focus();
    return ready;
  }

  function dispatchQuestionnaireAnswers(eventName) {
    if (!activeQuestionnaire) return false;
    const validation = validateQuestionnaireAnswers(
      activeQuestionnaire.definition,
      activeQuestionnaire.answers,
      { allowPartial: eventName === RESEARCH_UI_EVENTS.questionnaireDraftRequest },
    );
    const event = new CustomEvent(eventName, {
      bubbles: true,
      cancelable: true,
      detail: Object.freeze({
        moduleId: activeQuestionnaire.module.moduleId,
        questionnaireId: activeQuestionnaire.definition.questionnaireId,
        definitionSha256: activeQuestionnaire.definition.definitionSha256,
        protocolStepPosition: activeQuestionnaire.protocolStepPosition,
        answers: Object.freeze({ ...activeQuestionnaire.answers }),
        complete: validation.complete,
      }),
    });
    root.dispatchEvent(event);
    return event.defaultPrevented;
  }

  const inputTestGrid = query(".input-test-grid");
  inputController = new ResearchInputController({
    binding: inputBinding,
    onState(snapshot) {
      if (Math.abs(snapshot.x - inputPoint.x) < 0.0005
        && Math.abs(snapshot.y - inputPoint.y) < 0.0005
        && snapshot.inputActive === lastInputActive) return;
      lastInputActive = snapshot.inputActive;
      const fromInput = snapshot.inputActive === true;
      const receipt = snapshot.source
        ? `${snapshot.inputKind} input received from ${snapshot.source}.`
        : null;
      updateInputPoint(snapshot.x, snapshot.y, receipt, {
        fromInput,
        inputActive: snapshot.inputActive,
        source: snapshot.source,
      });
    },
    onInputEdge(edge) {
      if (edge.active) announce(`${edge.direction} input edge accepted; operating-system repeat is ignored.`);
      root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.inputEdge, {
        bubbles: true,
        detail: Object.freeze({ ...edge, x: inputController.state.x, y: inputController.state.y, mode }),
      }));
    },
  });
  if (inputTestGrid instanceof HTMLElement) inputController.attach(inputTestGrid);

  const previewControlSurface = query(".preview-control-surface");
  const previewDirectionByKey = Object.freeze({
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
  });
  const previewSimulatorHandlers = {
    keydown(event) {
      const direction = previewDirectionByKey[event.key];
      if (!direction || event.altKey || event.ctrlKey || event.metaKey) return;
      previewResponseSimulator?.press(direction);
      event.preventDefault();
    },
    keyup(event) {
      const direction = previewDirectionByKey[event.key];
      if (!direction) return;
      previewResponseSimulator?.release(direction);
      event.preventDefault();
    },
    blur() {
      previewResponseSimulator?.releaseAll();
    },
  };
  if (previewControlSurface instanceof HTMLElement) {
    for (const [type, handler] of Object.entries(previewSimulatorHandlers)) {
      previewControlSurface.addEventListener(type, handler);
    }
  }
  const releasePreviewResponse = () => previewResponseSimulator?.releaseAll();
  window.addEventListener("blur", releasePreviewResponse);

  const runInputHandlers = {
    keydown(event) {
      if (surface !== "tauri" && mode === "run" && ratingInputEnabled && !activeQuestionnaire) {
        inputController.handleKeyDown(event);
      }
    },
    keyup(event) {
      if (surface !== "tauri" && mode === "run") inputController.handleKeyUp(event);
    },
    mousedown(event) {
      if (surface !== "tauri" && mode === "run" && ratingInputEnabled && !activeQuestionnaire
        && event.target instanceof Element && event.target.closest(".run-stage")) {
        inputController.handleMouseDown(event);
      }
    },
    mouseup(event) {
      if (surface !== "tauri" && mode === "run") inputController.handleMouseUp(event);
    },
    wheel(event) {
      if (surface !== "tauri" && mode === "run" && ratingInputEnabled && !activeQuestionnaire
        && event.target instanceof Element && event.target.closest(".run-stage")) {
        inputController.handleWheel(event);
      }
    },
  };
  for (const [type, handler] of Object.entries(runInputHandlers)) {
    window.addEventListener(type, handler, type === "wheel" ? { passive: false } : undefined);
  }
  const runFeedbackStage = query(".run-feedback-stage");
  const handleRunPointer = (event) => {
    if (surface === "tauri" || mode !== "run" || !ratingInputEnabled || activeQuestionnaire
      || !(runFeedbackStage instanceof HTMLElement)) return;
    inputController.handlePointer(event, runFeedbackStage.getBoundingClientRect());
  };
  runFeedbackStage?.addEventListener("pointerdown", handleRunPointer);
  runFeedbackStage?.addEventListener("pointermove", handleRunPointer);
  runFeedbackStage?.addEventListener("pointerup", handleRunPointer);
  runFeedbackStage?.addEventListener("pointercancel", handleRunPointer);
  runFeedbackStage?.addEventListener("lostpointercapture", handleRunPointer);

  function requestStart() {
    const blocking = preflightItems().filter(({ result }) => result === "block");
    const pendingFinalization = selectedPendingFinalization();
    if (pendingFinalization) {
      if (blocking.length > 0) {
        openSetupSection("review");
        announce("Finalization reconciliation is blocked. Reauthorize the workspace and recovery manifest.");
        return;
      }
      const event = new CustomEvent(RESEARCH_UI_EVENTS.startRequest, {
        bubbles: true,
        cancelable: true,
        detail: Object.freeze({
          participantId: selectedParticipant,
          attemptDisposition: "resume-compatible",
          recoveryFinalizationOnly: true,
          pendingFinalizationAttemptNumber: pendingFinalization.attemptNumber,
          pendingFinalizationCompletionStatus: pendingFinalization.completionStatus,
          pendingFinalizationProtocolContract: pendingFinalization.protocolContract,
          settings: settingsSnapshot,
          resolvedPlan: plan,
          settingsSha256: settingsHash,
          researchSettings: protocolSettingsSnapshot,
          researchSettingsSha256: protocolSettingsHash,
          resolvedProtocolPlan: protocolPlan,
          experimentPackageSourceText: experimentPackageDocument?.canonicalSourceText ?? null,
          experimentPackageSourceByteSha256: experimentPackageDocument?.canonicalSourceByteSha256 ?? null,
          experimentPackageDefinitionSha256: experimentPackageDocument?.package.integrity.packageDefinitionSha256 ?? null,
          experimentPackageId: experimentPackageDocument?.package.packageId ?? null,
          selectedLanguageId,
          languageSelectionPath: selectedLanguageSelectionPath
            ? Object.freeze([...selectedLanguageSelectionPath])
            : null,
          packageAssignmentSha256: compiledPackageSelection?.assignmentSha256 ?? null,
          playbackMode: value("native-playback-mode", "nativeGstPlay"),
        }),
      });
      root.dispatchEvent(event);
      if (!event.defaultPrevented) {
        announce("Finalization reconciliation is waiting for the authoritative native adapter.");
      }
      return;
    }
    const fieldsValid = syncFieldValidation({ force: true });
    if (blocking.length > 0 || !fieldsValid) {
      const invalid = query('[aria-invalid="true"]:not(#preview-tile-count)');
      const sectionId = invalid?.closest("[data-setup-section]")?.getAttribute("data-setup-section") ?? "review";
      openSetupSection(sectionId);
      const focusTarget = isValidationControl(invalid)
        ? invalid
        : invalid?.querySelector?.("input, select, textarea, button");
      queueMicrotask(() => focusTarget?.focus());
      announce("Start blocked. Resolve the preflight list.");
      return;
    }
    const participantState = selectedParticipantState();
    const attemptDisposition = selectedAttemptDisposition();
    const resumesExistingAttempt = participantState === "partial"
      && participantRecoverability.get(selectedParticipant) === true
      && attemptDisposition === "resume-compatible";
    const participant = resumesExistingAttempt ? null : deriveParticipantRecord({
      firstName: value("participant-first-name"),
      lastName: value("participant-last-name"),
      age: numberValue("participant-age"),
      gender: value("participant-gender"),
      handedness: value("participant-handedness"),
    });
    const rerunConfirmed = participantState === "partial" && attemptDisposition === "new-attempt"
      ? true
      : participantState === "complete" && checked("participant-rerun-confirm");
    const settings = settingsSnapshot;
    const resolvedPlan = plan;
    const researchSettings = protocolSettingsSnapshot;
    const resolvedProtocolPlan = protocolPlan;
    const preflight = Object.freeze({
      inputTestPassed,
      nativeInputReceiptId: surface === "tauri" ? nativeInputReceiptId : null,
      verifiedStimulusIds: Object.freeze((experimentDocument?.definition.stimuli ?? [])
        .filter((reference) => stimuli.some((stimulus) => (
          stimulus.source === "workspace"
          && stimulus.location === reference.relativePath
          && stimulus.verification === "verified"
        )))
        .map(({ stimulusId }) => stimulusId)),
      directoryPermission: capabilities.directoryPermission,
      indexedDbReady: capabilities.indexedDbReady,
      timingWorkerReady: capabilities.timingWorkerReady,
      lslReady: !settings.advanced.lsl.enabled || capabilities.lslReady,
      manifestReady: capabilities.manifestReady,
      storageReady: capabilities.storageReady
        && storageReadiness?.sufficient === true
        && storageReadiness?.writeReady !== false,
      protocolPlanReady: Boolean(researchSettings && protocolSettingsHash && resolvedProtocolPlan),
      packageReady: Boolean(
        experimentPackageDocument
        && packageReproductionReceipt?.byteIdenticalReexport === true
        && packageReproductionReceipt.sameRealmDeterminismVerified === true
        && packageAssetsVerified()
        && compiledPackageSelection
        && selectedLanguageContextKey === participantLanguageContextKey(),
      ),
    });
    const detail = {
      participantId: selectedParticipant,
      participant,
      attemptDisposition,
      rerunConfirmed,
      settings,
      resolvedPlan,
      settingsSha256: settingsHash,
      researchSettings,
      researchSettingsSha256: protocolSettingsHash,
      resolvedProtocolPlan,
      experimentSourceText: experimentDocument?.sourceText ?? null,
      experimentPackageSourceText: experimentPackageDocument?.canonicalSourceText ?? null,
      experimentPackageSourceByteSha256: experimentPackageDocument?.canonicalSourceByteSha256 ?? null,
      experimentPackageDefinitionSha256: experimentPackageDocument?.package.integrity.packageDefinitionSha256 ?? null,
      experimentPackageId: experimentPackageDocument?.package.packageId ?? null,
      selectedLanguageId,
      languageSelectionPath: selectedLanguageSelectionPath
        ? Object.freeze([...selectedLanguageSelectionPath])
        : null,
      packageAssignmentSha256: compiledPackageSelection?.assignmentSha256 ?? null,
      packageAssetBindings: Object.freeze((compiledPackageSelection?.assetBindings ?? [])
        .map((binding) => Object.freeze({ ...binding }))),
      preflight,
      outputFormats: { csv: checked("output-csv"), tsv: checked("output-tsv") },
      preview: Object.freeze(previewState({ locked: true })),
      ...(surface === "tauri" ? {
        playbackMode: value("native-playback-mode", "nativeGstPlay"),
        inputTestReceiptId: nativeInputReceiptId,
      } : {}),
    };
    youtubePreflightAdapter?.destroy();
    youtubePreflightAdapter = null;
    const youtubePanel = query("#youtube-preflight-panel");
    if (youtubePanel instanceof HTMLElement) youtubePanel.hidden = true;
    setInputValue("participant-first-name", "");
    setInputValue("participant-last-name", "");
    const event = new CustomEvent(RESEARCH_UI_EVENTS.startRequest, {
      bubbles: true,
      cancelable: true,
      detail: Object.freeze(detail),
    });
    root.dispatchEvent(event);
    if (!event.defaultPrevented) {
      clearParticipantLanguageSelection();
      schedulePlanRefresh();
      announce("Start is waiting for the authoritative workspace and run adapter.");
      const status = query("#start-status");
      if (status) status.textContent = "Authoritative run adapter is not connected; no session was started.";
    }
  }

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!(target instanceof HTMLButtonElement)) return;
    if (["flubber", "grid", "face"].includes(target.dataset.feedbackPreviewMode)) {
      feedbackPreviewMode = target.dataset.feedbackPreviewMode;
      refreshProjection();
      announce(`${feedbackPreviewMode === "grid" ? "2D Grid" : feedbackPreviewMode === "face" ? "Responsive Face" : "Classic Flubber"} selected in the design preview.`);
      return;
    }
    if (["continuous", "stepwise"].includes(target.dataset.responsePreviewMode)) {
      responsePreviewMode = target.dataset.responsePreviewMode;
      configurePreviewResponseSimulator();
      refreshProjection();
      announce(`${responsePreviewMode === "continuous" ? "Continuous" : "Stepwise"} response design selected.`);
      return;
    }
    if (target.dataset.previewFocus) {
      const destination = target.dataset.previewFocus === "advanced"
        ? query("#preview-advanced-settings")
        : query("#visual-size");
      if (destination instanceof HTMLDetailsElement) {
        destination.open = true;
        destination.scrollIntoView({ behavior: "smooth", block: "start" });
        destination.querySelector("summary")?.focus();
      } else if (destination instanceof HTMLElement) {
        destination.scrollIntoView({ behavior: "smooth", block: "center" });
        destination.focus();
      }
      return;
    }
    if (target.id === "preview-color-reset" && previewColorAnchor) {
      const definition = COLOR_FIELDS.find(({ id }) => id === previewColorAnchor);
      if (definition) {
        setPreviewColorDraft(definition.value, { synchronizeHex: true });
        setPreviewColorLabelDraft("");
        const label = query("#preview-color-label");
        if (label instanceof HTMLInputElement) label.value = "";
      }
      return;
    }
    if (target.id === "preview-color-cancel") {
      dismissPreviewColorDialog();
      return;
    }
    if (target.id === "preview-color-apply") {
      dismissPreviewColorDialog({ apply: true });
      return;
    }
    if (target.id === "preview-response-reset") {
      previewResponseSimulator?.reset();
      announce("The response design preview returned to neutral.");
      query(".preview-control-surface")?.focus();
      return;
    }
    if (target.dataset.modeButton && target.dataset.modeButton !== mode) {
      announce(mode === "run"
        ? "Complete the attempt or use Stop Early before returning to Setup."
        : "Running mode becomes available only after an attempt starts.");
    }
    if (target.dataset.confirmSection) {
      confirmSetupSection(target.dataset.confirmSection);
      return;
    }
    if (target.dataset.openSection) openSetupSection(target.dataset.openSection);
    if (target.id === "workspace-choose") selectWorkspace();
    if (target.dataset.openWorkspaceLocation) openWorkspaceLocation(target.dataset.openWorkspaceLocation);
    if (target.id === "stimulus-inspiration-open") {
      const dialog = query("#stimulus-inspiration-dialog");
      if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
    }
    if (target.id === "video-import") requestVideoImport();
    if (target.id === "video-folder-import") requestVideoImport({ directory: true });
    if (target.id === "package-load") requestExperimentPackageLoad();
    if (target.dataset.reviewReveal) {
      const destination = query(`#${target.dataset.reviewReveal}`);
      if (destination) {
        const disclosure = destination instanceof HTMLDetailsElement ? destination : destination.closest("details");
        if (disclosure) disclosure.open = true;
        let focusTarget = destination.matches("button,input,select") ? destination
          : destination.querySelector("button:not([disabled]),input:not([disabled]),select:not([disabled])") ?? destination;
        if (focusTarget.matches(":disabled")) focusTarget = destination.closest("section") ?? destination.parentElement;
        if (!focusTarget.matches("button,input,select")) focusTarget.tabIndex = -1;
        focusTarget.focus();
        destination.scrollIntoView({ block: "nearest" });
      }
    }
    if (target.id === "package-generate") void generateExperimentPackage({ reexport: languageEditorLocked });
    if (target.id === "package-edit") void editExperimentPackage();
    if (target.dataset.plannerSegment) {
      const section = PLANNER_SEGMENT_SECTIONS[target.dataset.plannerSegment];
      if (SETUP_SECTIONS.some(({ id }) => id === section)) openSetupSection(section, { focus: true });
      else announce(`${target.dataset.plannerSegment} has no accepted editor in this build. Its active contribution blocks export.`);
    }
    if (target.id === "choose-participant-language") openParticipantLanguageDialog();
    if (target.dataset.languageOption) void chooseParticipantLanguageOption(target.dataset.languageOption);
    if (target.id === "participant-language-back" && !languageSelectionBusy) {
      languageTraversalPath = languageTraversalPath.slice(0, -1);
      setParticipantLanguageError("");
      renderParticipantLanguageDialog({ focus: true });
    }
    if (target.id === "participant-language-cancel") {
      clearParticipantLanguageSelection();
      schedulePlanRefresh();
      announce("Participant language selection cancelled; Start remains blocked.");
    }
    if (target.id === "experiment-load") requestExperimentLoad();
    if (target.id === "settings-load") requestSettingsLoad();
    if (target.id === "settings-save") requestSettingsSave();
    if (target.id === "workspace-renew") renewWorkspacePermission();
    if (target.id === "workspace-rescan") requestWorkspaceRescan();
    if (target.id === "stimulus-add-workspace") requestVideoImport();
    if (target.id === "stimulus-add-repository") openStimulusDialog("repository");
    if (target.id === "stimulus-add-youtube") openStimulusDialog("youtube");
    if (target.id === "study-language-add-button") addStudyLanguage();
    if (target.dataset.studyLanguageRemove) removeStudyLanguage(target.dataset.studyLanguageRemove);
    if (target.id === "questionnaire-add-blank") addBlankQuestionnaire();
    if (target.id === "questionnaire-import") requestQuestionnaireUpload();
    if (target.dataset.questionnaireUploadFamily) {
      requestQuestionnaireUpload({
        familyId: target.dataset.questionnaireUploadFamily,
        languageTag: target.dataset.questionnaireUploadLanguage,
      });
    }
    if (target.id === "questionnaire-prebuilt-open") {
      renderPrebuiltQuestionnaires(); query("#questionnaire-prebuilt-dialog").showModal();
    }
    if (target.id === "questionnaire-prebuilt-close") closeDialog("questionnaire-prebuilt-dialog");
    if (target.dataset.questionnairePrebuiltAsset) void addPrebuiltQuestionnaire(target.dataset.questionnairePrebuiltAsset);
    if (target.id === "questionnaire-inspiration") openQuestionnaireInspiration();
    if (target.id === "questionnaire-inspiration-close") closeDialog("questionnaire-inspiration-dialog");
    if (target.dataset.questionnaireInspirationPrepare) {
      closeDialog("questionnaire-inspiration-dialog");
      void prepareQuestionnairePreset(target.dataset.questionnaireInspirationPrepare);
    }
    if (target.dataset.questionnaireRemoveFamily) removeQuestionnaireFamily(target.dataset.questionnaireRemoveFamily);
    if (target.dataset.bundledQuestionnaire) {
      void importBundledQuestionnaire(target.dataset.bundledQuestionnaire)
        .catch((error) => announce(`Questionnaire import failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    if (target.dataset.questionnaireAction) {
      const definition = questionnaireDefinition(target.dataset.questionnaireId);
      if (definition && target.dataset.questionnaireAction === "preview") showQuestionnairePreview(definition);
      if (definition && target.dataset.questionnaireAction === "add-module") addQuestionnaireModule(definition);
      if (definition && target.dataset.questionnaireAction === "remove-definition") {
        const index = questionnaireDefinitions.findIndex(({ questionnaireId }) => questionnaireId === definition.questionnaireId);
        if (index >= 0 && !questionnaireModules.some(({ questionnaireId }) => questionnaireId === definition.questionnaireId)) {
          questionnaireDefinitions.splice(index, 1);
          renderQuestionnaires();
          schedulePlanRefresh();
          announce(`${definition.title} removed from the validated definition library.`);
        }
      }
    }
    if (target.dataset.questionnaireMoveFamily) {
      const groups = questionnaireModuleGroups();
      const index = groups.findIndex(({ familyId }) => familyId === target.dataset.questionnaireFamily);
      const nextIndex = target.dataset.questionnaireMoveFamily === "up" ? index - 1 : index + 1;
      if (index >= 0 && nextIndex >= 0 && nextIndex < groups.length) {
        [groups[index], groups[nextIndex]] = [groups[nextIndex], groups[index]];
        questionnaireModules.splice(0, questionnaireModules.length, ...groups.flatMap(({ modules }) => modules));
        renderQuestionnaires();
        schedulePlanRefresh();
      }
    }
    if (target.id === "questionnaire-preview-close") closeDialog("questionnaire-preview-dialog");
    if (target.id === "condition-add") {
      const index = pools.length + 1;
      pools.push({ id: `condition-${index}-${Date.now()}`, label: `Condition ${index}`, videosPerParticipant: 1 });
      renderPools();
      schedulePlanRefresh();
    }
    if (target.matches("[data-pool-remove]")) {
      const section = target.closest("[data-pool-id]");
      const poolId = section?.getAttribute("data-pool-id");
      const index = pools.findIndex(({ id }) => id === poolId);
      if (index > -1 && pools.length > 1) {
        const [removed] = pools.splice(index, 1);
        for (const stimulus of stimuli) if (stimulus.poolId === removed.id) stimulus.poolId = pools[0].id;
        for (const module of questionnaireModules) {
          if (module.placement.poolId === removed.id) {
            module.placement = { kind: module.placement.kind, poolId: pools[0].id };
          }
        }
        renderPools();
        renderQuestionnaires();
        schedulePlanRefresh();
      }
    }
    if (target.dataset.bindingDirection) {
      const direction = target.dataset.bindingDirection;
      const title = query("#binding-capture-title");
      const receipt = query("#binding-capture-receipt");
      if (title) title.textContent = `Capture ${target.querySelector("span")?.textContent ?? direction}`;
      if (receipt) {
        receipt.textContent = "Waiting for an input edge…";
        delete receipt.dataset.state;
      }
      query("#binding-capture-dialog")?.showModal();
      beginBindingCapture(direction);
    }
    if (target.id === "binding-reset") resetBindingsToPreset();
    if (target.id === "binding-capture-cancel") {
      cancelBindingCapture();
      closeDialog("binding-capture-dialog");
    }
    if (target.id === "input-test-reset") {
      resetInputTest();
      inputController.resetNeutral("input-test-reset");
      updateInputPoint(0, 0, "Input test reset to neutral.");
    }
    if (target.dataset.colorReset) {
      const definition = COLOR_FIELDS.find(({ id }) => id === target.dataset.colorReset);
      if (definition) {
        setInputValue(`color-${definition.id}`, definition.value);
        setInputValue(`color-${definition.id}-hex`, definition.value);
        refreshProjection();
        schedulePlanRefresh();
      }
    }
    if (target.dataset.colorAnchor) openPreviewColorDialog(target.dataset.colorAnchor);
    if (target.id === "stimulus-dialog-cancel") closeDialog("stimulus-dialog");
    if (target.id === "stimulus-dialog-add") {
      const source = value("stimulus-source", "workspace");
      const stimulus = addStimulus({ title: value("stimulus-title") || value("stimulus-location"), source, location: value("stimulus-location") });
      if (stimulus && pools.some(({ id }) => id === value("stimulus-condition"))) {
        stimulus.poolId = value("stimulus-condition");
        renderPools();
        schedulePlanRefresh();
      }
      if (stimulus?.source === "repository") verifyRepositoryStimulus(stimulus);
      if (stimulus?.verification !== "failed") closeDialog("stimulus-dialog");
    }
    if (target.dataset.youtubePreflight) {
      const stimulus = stimuli.find(({ id }) => id === target.dataset.youtubePreflight);
      if (stimulus) void preflightYouTubeStimulus(stimulus);
    }
    if (target.dataset.stimulusRemove) {
      const index = stimuli.findIndex(({ id }) => id === target.dataset.stimulusRemove);
      if (index >= 0) {
        const [removed] = stimuli.splice(index, 1);
        renderPools();
        schedulePlanRefresh();
        announce(`${removed.title} removed from the protocol.`);
      }
    }
    if (target.id === "plan-window-previous") {
      participantWindowStart = Math.max(0, participantWindowStart - 40);
      renderPlanPreview();
    }
    if (target.id === "plan-window-next") {
      participantWindowStart += 40;
      renderPlanPreview();
    }
    if (target.id === "participant-window-previous") {
      clearParticipantLanguageSelection();
      participantTileWindowStart = Math.max(0, participantTileWindowStart - 60);
      selectedParticipant = participantIds()[participantTileWindowStart];
      renderReview();
      schedulePlanRefresh();
      queueMicrotask(() => query(`[data-participant-id="${selectedParticipant}"]`)?.focus());
    }
    if (target.id === "participant-window-next") {
      clearParticipantLanguageSelection();
      participantTileWindowStart += 60;
      const ids = participantIds();
      selectedParticipant = ids[Math.min(participantTileWindowStart, ids.length - 1)];
      renderReview();
      schedulePlanRefresh();
      queueMicrotask(() => query(`[data-participant-id="${selectedParticipant}"]`)?.focus());
    }
    if (target.id === "assignment-plan-export") void exportAssignmentPlan();
    if (target.dataset.participantId) {
      if (target.dataset.participantId !== selectedParticipant) clearParticipantLanguageSelection();
      selectedParticipant = target.dataset.participantId;
      renderReview();
      schedulePlanRefresh();
      queueMicrotask(() => query(`[data-participant-id="${selectedParticipant}"]`)?.focus());
    }
    if (target.id === "start-experiment") requestStart();
    if (target.id === "run-questionnaire-previous" && activeQuestionnaire) {
      activeQuestionnaire.itemIndex = Math.max(0, activeQuestionnaire.itemIndex - 1);
      renderRunQuestionnaire({ focus: true });
    }
    if (target.id === "run-questionnaire-next" && activeQuestionnaire && currentQuestionnaireItemIsReady()) {
      activeQuestionnaire.itemIndex = Math.min(
        activeQuestionnaire.definition.items.length - 1,
        activeQuestionnaire.itemIndex + 1,
      );
      renderRunQuestionnaire({ focus: true });
    }
    if (target.id === "run-questionnaire-submit" && activeQuestionnaire) {
      try {
        validateQuestionnaireAnswers(activeQuestionnaire.definition, activeQuestionnaire.answers);
        if (!dispatchQuestionnaireAnswers(RESEARCH_UI_EVENTS.questionnaireSubmitRequest)) {
          announce("Questionnaire submission is waiting for the authoritative run adapter.");
        }
      } catch {
        const error = query("#run-questionnaire-error");
        if (error instanceof HTMLElement) {
          error.hidden = false;
          error.textContent = "Answer every required item before submitting.";
        }
      }
    }
    if (target.id === "run-pause") root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.pauseRequest, { bubbles: true }));
    if (target.id === "run-stop-early") query("#stop-early-dialog")?.showModal();
    if (target.id === "stop-early-cancel") closeDialog("stop-early-dialog");
    if (target.id === "stop-early-confirm") {
      closeDialog("stop-early-dialog");
      root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.stopEarlyRequest, { bubbles: true }));
    }
    if (target.id === "completion-return") {
      closeDialog("completion-dialog");
      setMode("setup");
      openSetupSection("review", { focus: true });
      resetInputTest();
    }
    if (target.id === "import-report-close") closeDialog("import-report-dialog");
    if (target.id === "run-continue") root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.continueRequest, { bubbles: true }));
  });

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.id === "questionnaire-inspiration-search") {
      filterQuestionnaireInspiration();
      return;
    }
    if (target instanceof HTMLInputElement && target.id === "preview-color-picker") {
      setPreviewColorDraft(target.value, { synchronizeHex: true });
      return;
    }
    if (target instanceof HTMLInputElement && target.id === "preview-color-hex") {
      setPreviewColorDraft(target.value);
      return;
    }
    if (target instanceof HTMLInputElement && target.id === "preview-color-label") {
      setPreviewColorLabelDraft(target.value);
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.questionnaireAnswer && activeQuestionnaire) {
      activeQuestionnaire.answers[target.dataset.questionnaireAnswer] = target.value;
      dispatchQuestionnaireAnswers(RESEARCH_UI_EVENTS.questionnaireDraftRequest);
      renderRunQuestionnaire();
      return;
    }
    // Selects dispatch `input` before `change`. These controls are rendered
    // from questionnaireModules, so refreshing here would replace the select
    // before the change handler can commit its new value. The change handler
    // updates the module and schedules the single required refresh.
    if (target instanceof HTMLSelectElement
      && (target.dataset.questionnairePlacement || target.dataset.questionnaireBlock)) return;
    if (target instanceof HTMLInputElement && target.type === "color") {
      setInputValue(`${target.id}-hex`, target.value.toLowerCase());
    } else if (target instanceof HTMLInputElement && target.id.endsWith("-hex")) {
      const colorInput = query(`#${target.id.slice(0, -4)}`);
      if (colorInput instanceof HTMLInputElement && /^#[0-9a-f]{6}$/i.test(target.value)) colorInput.value = target.value;
    }
    if (target instanceof HTMLInputElement && ["participant-first-name", "participant-last-name"].includes(target.id)) renderNameCode();
    if (target instanceof HTMLInputElement && target.id === "input-step-size" && inputBinding.kind === "digital") {
      try {
        inputBinding = structuredClone(validateInputBindingV1({ ...inputBinding, stepSize: Number(target.value) }));
        inputController.setBinding(inputBinding);
        resetInputTest();
      } catch {
        // Native HTML validation and the blocking preflight expose the invalid interim value.
      }
    }
    if (isPreviewResponseControl(target)) configurePreviewResponseSimulator();
    if (isPreviewOnlyControl(target)) {
      refreshProjection();
      return;
    }
    if (isValidationControl(target) && touchedValidationControls.has(target)) {
      syncControlValidation(target);
    }
    if (target instanceof Element && target.closest("#research-settings-form")) {
      refreshProjection();
      schedulePlanRefresh();
    }
  });

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.id === "questionnaire-inspiration-domain") {
      filterQuestionnaireInspiration();
      return;
    }
    if (isPreviewResponseControl(target)) configurePreviewResponseSimulator();
    if (isPreviewOnlyControl(target)) {
      refreshProjection();
      return;
    }
    if (target instanceof HTMLInputElement && ["output-csv", "output-tsv"].includes(target.id)) {
      outputFormatsTouched = true;
      syncOutputFormatValidation();
    }
    if (target instanceof HTMLSelectElement && target.id === "input-preset") {
      resetBindingsToPreset();
      inputController.resetNeutral("preset-change");
    }
    if (target instanceof HTMLInputElement && target.name === "attemptDisposition") {
      clearParticipantLanguageSelection();
    }
    if (target instanceof HTMLSelectElement && target.id === "stimulus-source") updateStimulusDialogSource();
    if (target instanceof HTMLSelectElement && target.dataset.questionnairePlacement) {
      const current = questionnaireModules.find(({ moduleId }) => moduleId === target.dataset.questionnairePlacement);
      if (current) {
        const usesBlock = target.value === "beforeBlock" || target.value === "afterBlock";
        const usesStimulus = target.value === "afterStimulus";
        updateQuestionnaireModule(current.moduleId, usesStimulus ? {
          kind: "afterStimulus",
          blockId: null,
          stimulusId: current.placement.stimulusId
            ?? experimentDocument?.definition.stimuli[0]?.stimulusId,
          relativeToIsi: current.placement.relativeToIsi ?? "before",
        } : {
          kind: target.value,
          blockId: usesBlock ? (current.placement.blockId ?? protocolBlockIds()[0]) : null,
        });
      }
    }
    if (target instanceof HTMLSelectElement && target.dataset.questionnaireBlock) {
      const current = questionnaireModules.find(({ moduleId }) => moduleId === target.dataset.questionnaireBlock);
      if (current && (current.placement.kind === "beforeBlock" || current.placement.kind === "afterBlock")) {
        updateQuestionnaireModule(current.moduleId, { kind: current.placement.kind, blockId: target.value });
      }
    }
    if (target instanceof HTMLSelectElement && target.dataset.questionnaireStimulus) {
      const current = questionnaireModules.find(({ moduleId }) => moduleId === target.dataset.questionnaireStimulus);
      if (current?.placement.kind === "afterStimulus") {
        updateQuestionnaireModule(current.moduleId, {
          ...current.placement,
          stimulusId: target.value,
        });
      }
    }
    if (target instanceof HTMLSelectElement && target.dataset.questionnaireIsi) {
      const current = questionnaireModules.find(({ moduleId }) => moduleId === target.dataset.questionnaireIsi);
      if (current?.placement.kind === "afterStimulus") {
        updateQuestionnaireModule(current.moduleId, {
          ...current.placement,
          relativeToIsi: target.value,
        });
      }
    }
    if (target instanceof HTMLSelectElement && target.dataset.stimulusPool) {
      const stimulus = stimuli.find(({ id }) => id === target.dataset.stimulusPool);
      if (stimulus) stimulus.poolId = target.value;
      renderPools();
    }
    if (target instanceof HTMLInputElement && target.matches("[data-pool-label]")) {
      const pool = pools.find(({ id }) => id === target.closest("[data-pool-id]")?.getAttribute("data-pool-id"));
      if (pool) pool.label = target.value.trim() || pool.label;
      renderPools();
    }
    if (target instanceof HTMLInputElement && target.matches("[data-pool-count]")) {
      const pool = pools.find(({ id }) => id === target.closest("[data-pool-id]")?.getAttribute("data-pool-id"));
      if (pool) pool.videosPerParticipant = Math.max(1, Math.trunc(Number(target.value) || 1));
      renderPools();
    }
    if (isValidationControl(target)) syncControlValidation(target);
    if (target instanceof Element && target.closest("#research-settings-form")) {
      refreshProjection();
      schedulePlanRefresh();
    }
  });

  root.addEventListener("focusout", (event) => {
    const control = event.target;
    if (!isValidationControl(control)) return;
    touchedValidationControls.add(control);
    syncControlValidation(control);
  });

  root.addEventListener("keydown", (event) => {
    if (inputController.captureDirection || nativeCaptureDirection) {
      if (event.key === "Escape") {
        cancelBindingCapture();
        closeDialog("binding-capture-dialog");
      } else if (surface !== "tauri") routeCaptureEvent(event);
      return;
    }
    const tile = event.target instanceof Element ? event.target.closest("[data-participant-id]") : null;
    if (tile instanceof HTMLButtonElement
      && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
      const ids = participantIds();
      const current = ids.indexOf(tile.dataset.participantId);
      const columns = matchMedia("(max-width: 1050px)").matches ? 3 : 5;
      const deltas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns, PageUp: -60, PageDown: 60 };
      const requested = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : current + deltas[event.key];
      const nextIndex = Math.max(0, Math.min(ids.length - 1, requested));
      selectedParticipant = ids[nextIndex];
      participantTileWindowStart = Math.floor(nextIndex / 60) * 60;
      renderReview();
      schedulePlanRefresh();
      queueMicrotask(() => query(`[data-participant-id="${selectedParticipant}"]`)?.focus());
      event.preventDefault();
    }
  });

  root.addEventListener("mousedown", (event) => {
    if (inputController.captureDirection && !event.target.closest("#binding-capture-cancel")) routeCaptureEvent(event);
  });
  root.addEventListener("wheel", (event) => {
    if (inputController.captureDirection) routeCaptureEvent(event);
  }, { passive: false });

  const dropZone = query("#video-drop-zone");
  for (const type of ["dragenter", "dragover"]) dropZone?.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.dataset.dragActive = "true";
  });
  for (const type of ["dragleave", "drop"]) dropZone?.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.dataset.dragActive = "false";
  });
  async function filesFromDroppedEntries(dataTransfer) {
    const items = [...(dataTransfer?.items ?? [])];
    const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
    if (!entries.length) return [...(dataTransfer?.files ?? [])];
    const files = [];
    async function visit(entry, prefix = "") {
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        const relativeName = `${prefix}${file.name}`;
        files.push(new File([file], relativeName, { type: file.type, lastModified: file.lastModified }));
        return;
      }
      if (!entry.isDirectory) return;
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        for (const child of batch) await visit(child, `${prefix}${entry.name}/`);
      } while (batch.length > 0);
    }
    for (const entry of entries) await visit(entry);
    return files;
  }
  dropZone?.addEventListener("drop", async (event) => {
    if (surface === "tauri") {
      announce("Use the Windows import control so the native workspace authority owns every selected path.");
      return;
    }
    try {
      await ingestBrowserFiles(await filesFromDroppedEntries(event.dataTransfer));
    } catch (error) {
      announce(error instanceof Error ? error.message : String(error));
    }
  });
  query("#video-file-input")?.addEventListener("change", async (event) => {
    await ingestBrowserFiles(event.target.files);
    event.target.value = "";
  });

  query("#video-folder-input")?.addEventListener("change", async (event) => {
    await ingestBrowserFiles(event.target.files);
    event.target.value = "";
  });

  query("#questionnaire-file-input")?.addEventListener("change", async (event) => {
    const [file] = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!file) return;
    const expected = pendingQuestionnaireUpload;
    pendingQuestionnaireUpload = null;
    try {
      const bytes = await file.arrayBuffer();
      await importQuestionnaireBytes(bytes, {
        sourceKind: "researcherCsv",
        logicalName: file.name,
        expectedFamilyId: expected?.familyId ?? null,
        expectedLanguageTag: expected?.languageTag ?? null,
      });
    } catch (error) {
      questionnaireImportStatus(error instanceof Error ? error.message : String(error), "error");
      announce(`Questionnaire import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  query("#questionnaire-inspiration-dialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog("questionnaire-inspiration-dialog");
  });

  query("#participant-language-dialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    clearParticipantLanguageSelection();
    schedulePlanRefresh();
    announce("Participant language selection cancelled; Start remains blocked.");
  });

  query("#settings-file-input")?.addEventListener("change", async (event) => {
    const [file] = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!file) return;
    try {
      const maximumBytes = 5 * 1024 * 1024;
      if (file.size < 1 || file.size > maximumBytes) {
        throw new RangeError(`Settings JSON must contain between 1 byte and ${maximumBytes} bytes.`);
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      await loadSettingsPayload(parseStrictJson(text, { maximumBytes }));
    } catch (error) {
      announce(`Settings import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  query("#experiment-file-input")?.addEventListener("change", async (event) => {
    const [file] = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!file) return;
    try {
      await applyExperimentDocument(await parseExperimentDefinitionV1(await file.arrayBuffer()));
    } catch (error) {
      announce(`Experiment import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  root.addEventListener(RESEARCH_UI_EVENTS.settingsLoaded, async (event) => {
    try {
      await loadSettingsPayload(event.detail?.settings ?? event.detail, { report: event.detail?.report ?? null });
    } catch (error) {
      announce(error instanceof Error ? error.message : String(error));
    }
  });

  root.addEventListener(RESEARCH_UI_EVENTS.experimentLoaded, async (event) => {
    try {
      await applyExperimentDocument(event.detail?.receipt ?? event.detail);
    } catch (error) {
      announce(`Experiment import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  root.addEventListener(RESEARCH_UI_EVENTS.experimentPackageLoaded, async (event) => {
    try {
      await applyExperimentPackageReceipt(event.detail?.receipt ?? event.detail);
    } catch (error) {
      announce(`Experiment package import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  root.addEventListener(RESEARCH_UI_EVENTS.capabilityStatus, (event) => {
    for (const key of Object.keys(capabilities)) {
      if (typeof event.detail?.[key] === "boolean") capabilities[key] = event.detail[key];
    }
    if (event.detail?.storageReadiness && typeof event.detail.storageReadiness === "object") {
      storageReadiness = Object.freeze({ ...event.detail.storageReadiness });
    }
    if (event.detail?.nativeMediaCapability && typeof event.detail.nativeMediaCapability === "object") {
      nativeMediaCapability = Object.freeze({ ...event.detail.nativeMediaCapability });
      const output = query("#native-media-capability");
      if (output) {
        output.textContent = nativeMediaCapability.qualifiedStartAvailable
          ? `Pinned ${nativeMediaCapability.backend} ${nativeMediaCapability.pinnedRuntimeVersion} ready for qualified playback.`
          : `Unavailable: ${nativeMediaCapability.reasonCode}. The fallback is explicitly unqualified.`;
      }
    }
    if (typeof event.detail?.manifestReason === "string" && event.detail.manifestReason.trim()) {
      manifestReadinessMessage = event.detail.manifestReason.trim();
    } else if (typeof event.detail?.manifestError === "string" && event.detail.manifestError.trim()) {
      manifestReadinessMessage = `Output manifests are corrupt or unreadable: ${event.detail.manifestError.trim()}`;
    } else if (capabilities.manifestReady) {
      manifestReadinessMessage = "Output manifests are readable.";
    } else if (event.detail?.manifestReady === false) {
      manifestReadinessMessage = "Output manifests have not passed the readability scan.";
    }
    const renew = query("#workspace-renew");
    const workspaceSelected = surface === "tauri"
      ? root.dataset.nativeWorkspaceReady === "true"
      : Boolean(workspace);
    if (renew instanceof HTMLButtonElement) renew.hidden = capabilities.directoryPermission || !workspaceSelected;
    refreshWorkspaceLocationButtons();
    refreshProjection();
  });

  root.addEventListener(RESEARCH_UI_EVENTS.stimuliCatalogued, (event) => {
    try {
      const entries = Array.isArray(event.detail?.items) ? event.detail.items : [];
      if (event.detail?.replace === true) {
        for (let index = stimuli.length - 1; index >= 0; index -= 1) {
          if (stimuli[index].source === "workspace") stimuli.splice(index, 1);
        }
      }
      for (const entry of entries) {
        const item = validateStimulusV1(entry.stimulus ?? entry);
        const existing = stimuli.find(({ id }) => id === item.stimulusId);
        const poolId = null;
        const next = {
          id: item.stimulusId,
          title: item.title,
          source: item.source.kind === "workspaceFile" ? "workspace" : item.source.kind === "repositoryAsset" ? "repository" : "youtube",
          location: item.source.relativePath ?? item.source.url,
          poolId,
          verification: item.source.kind === "youtube" ? "unverified" : entry.verified === false ? "pending" : "verified",
          decodeQualification: item.source.kind === "youtube"
            ? "unverifiedNoncanonical"
            : entry.decodeQualification ?? existing?.decodeQualification ?? "verified",
          contractSource: structuredClone(item.source),
          youtubePreflight: null,
        };
        if (existing) Object.assign(existing, next);
        else stimuli.push(next);
      }
      renderPools();
      schedulePlanRefresh();
    } catch (error) {
      announce(error instanceof Error ? error.message : String(error));
    }
  });

  root.addEventListener(RESEARCH_UI_EVENTS.runStarted, (event) => {
    const detail = event.detail ?? {};
    const runModeButton = query('[data-mode-button="run"]');
    if (runModeButton instanceof HTMLButtonElement) runModeButton.disabled = false;
    const participant = query("#run-participant");
    const session = query("#run-session");
    if (participant) participant.textContent = detail.participantId ?? selectedParticipant;
    if (session) session.textContent = detail.sessionStem ?? "Attempt active";
    runPreview.update(previewState({ locked: true }));
    ratingInputEnabled = false;
    clearParticipantLanguageSelection();
    setMode("run");
    query("#run-stop-early")?.focus();
  });

  root.addEventListener(RESEARCH_UI_EVENTS.questionnaireStatus, (event) => {
    try {
      if (event.detail?.active !== false) ratingInputEnabled = false;
      showRunQuestionnaire(event.detail ?? {});
    } catch (error) {
      announce(`Questionnaire stage failed closed: ${error instanceof Error ? error.message : String(error)}`);
      root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.stopEarlyRequest, {
        bubbles: true,
        detail: Object.freeze({ reason: "questionnaire-stage-invalid" }),
      }));
    }
  });

  root.addEventListener(RESEARCH_UI_EVENTS.runStatus, (event) => {
    const detail = event.detail ?? {};
    if (typeof detail.ratingInputActive === "boolean") ratingInputEnabled = detail.ratingInputActive;
    for (const [key, selector] of Object.entries({ stimulus: "#run-stimulus-status", timing: "#run-timing-status", write: "#run-write-status", lsl: "#run-lsl-status" })) {
      const output = query(selector);
      if (output && detail[key] !== undefined) output.textContent = String(detail[key]);
    }
    if (Number.isFinite(detail.x) && Number.isFinite(detail.y)) {
      inputPoint = { x: detail.x, y: detail.y };
      runPreview.update(previewState({ locked: true }));
    }
    const pause = query("#run-pause");
    if (pause instanceof HTMLButtonElement) {
      if (typeof detail.pauseAvailable === "boolean") {
        pause.hidden = !detail.pauseAvailable;
        pause.disabled = !detail.pauseAvailable;
      }
      if (typeof detail.paused === "boolean") {
        pause.textContent = detail.paused ? "Resume" : "Pause";
        pause.setAttribute("aria-pressed", String(detail.paused));
      }
      if (pause.hidden) {
        pause.textContent = "Pause";
        pause.setAttribute("aria-pressed", "false");
      }
    }
    const transition = query("#run-transition");
    if (transition instanceof HTMLElement && typeof detail.transitionActive === "boolean") {
      const transitionWasHidden = transition.hidden;
      transition.hidden = !detail.transitionActive;
      const message = query("#run-transition-message");
      if (message && detail.transitionMessage) message.textContent = String(detail.transitionMessage);
      const proceed = query("#run-continue");
      if (proceed instanceof HTMLButtonElement) {
        const proceedWasHidden = proceed.hidden;
        proceed.hidden = detail.transitionMode !== "continueWhenReady";
        if (!transition.hidden && !proceed.hidden && (transitionWasHidden || proceedWasHidden)) {
          queueMicrotask(() => proceed.focus());
        }
      }
    }
    const video = query("#run-video");
    if (video instanceof HTMLVideoElement && typeof detail.stimulus === "string" && detail.stimulus.trim()) {
      video.setAttribute("aria-label", `Protocol-controlled stimulus: ${detail.stimulus.trim()}`);
    }
    if (video instanceof HTMLVideoElement && typeof detail.videoUrl === "string" && detail.videoUrl) {
      if (video.src !== detail.videoUrl) video.src = detail.videoUrl;
      video.hidden = false;
      const placeholder = query("#run-stimulus-placeholder");
      if (placeholder instanceof HTMLElement) placeholder.hidden = true;
    }
  });

  root.addEventListener(RESEARCH_UI_EVENTS.runComplete, (event) => {
    ratingInputEnabled = false;
    clearParticipantLanguageSelection();
    activeQuestionnaire = null;
    renderRunQuestionnaire();
    const receipt = query("#completion-receipt");
    if (receipt instanceof HTMLElement) {
      const entries = Object.entries(event.detail ?? {});
      receipt.replaceChildren(...entries.map(([label, value]) => {
        const item = document.createElement("li");
        item.textContent = `${label}: ${value}`;
        return item;
      }));
    }
    query("#completion-dialog")?.showModal();
  });

  root.addEventListener(RESEARCH_UI_EVENTS.startRejected, (event) => {
    clearParticipantLanguageSelection();
    schedulePlanRefresh();
    announce(`Start was rejected before activation: ${event.detail?.message ?? "authoritative adapter rejection"}. Choose the participant language again after resolving the blocker.`);
  });

  root.addEventListener(RESEARCH_UI_EVENTS.participantStates, (event) => {
    participantStates.clear();
    participantRecoverability.clear();
    participantFinalizationPending.clear();
    participantFinalizationBindings.clear();
    participantRecoveryBindings.clear();
    for (const [id, state] of Object.entries(event.detail ?? {})) {
      if (["available", "active", "partial", "complete"].includes(state)) participantStates.set(id, state);
    }
    for (const [id, recoverable] of Object.entries(event.detail?.__recoverable ?? {})) {
      if (typeof recoverable === "boolean") participantRecoverability.set(id, recoverable);
    }
    for (const [id, pending] of Object.entries(event.detail?.__finalizationPending ?? {})) {
      if (typeof pending === "boolean") participantFinalizationPending.set(id, pending);
    }
    for (const [id, binding] of Object.entries(event.detail?.__finalizationBinding ?? {})) {
      if (binding && typeof binding === "object"
        && /^[0-9a-f]{64}$/u.test(binding.settingsSha256 ?? "")
        && /^[0-9a-f]{64}$/u.test(binding.assignmentPlanSha256 ?? "")
        && ["nativeGstPlay", "nativeLibvlc", "unqualifiedWebview"].includes(binding.playbackMode)
        && ["manifestV2", "manifestV3", "manifestV4"].includes(binding.protocolContract)
        && ["completed", "partial"].includes(binding.completionStatus)
        && Number.isSafeInteger(binding.attemptNumber) && binding.attemptNumber > 0) {
        participantFinalizationBindings.set(id, Object.freeze({ ...binding }));
      }
    }
    for (const [id, binding] of Object.entries(event.detail?.__recoveryBinding ?? {})) {
      try {
        const normalized = validateExperimentPackageRecoveryBindingV1(binding);
        if (normalized.participantId !== id) {
          throw new TypeError("Recovery binding participant identity does not match its projection key.");
        }
        participantRecoveryBindings.set(id, normalized);
      } catch (error) {
        participantRecoverability.set(id, false);
        announce(`A malformed package recovery binding for ${id} was rejected: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    renderReview();
  });

  root.addEventListener(RESEARCH_UI_EVENTS.workspaceReady, (event) => {
    root.dataset.nativeWorkspaceReady = "true";
    capabilities.directoryPermission = event.detail?.directoryPermission !== false;
    const output = query("#workspace-root");
    if (output) {
      output.textContent = event.detail?.label ?? (event.detail?.surface === "browser" ? "Browser workspace ready" : "Windows workspace ready");
      output.dataset.state = "ready";
    }
    const status = query("#workspace-status");
    if (status) {
      status.dataset.state = "ready";
      status.textContent = "Work directory ready. Project locations are available.";
    }
    for (const id of ["workspace-rescan", "settings-save", "stimulus-add-workspace", "video-import", "video-folder-import"]) {
      const button = query(`#${id}`);
      if (button instanceof HTMLButtonElement) button.disabled = false;
    }
    refreshWorkspaceLocationButtons();
    refreshProjection();
  });

  root.querySelectorAll("[data-open-section]").forEach((button) => button.addEventListener("keydown", (event) => {
    const index = SETUP_SECTIONS.findIndex(({ id }) => id === button.dataset.openSection);
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const requested = event.key === "Home" ? 0 : event.key === "End" ? SETUP_SECTIONS.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + SETUP_SECTIONS.length) % SETUP_SECTIONS.length;
    openSetupSection(SETUP_SECTIONS[requested].id, { focus: true });
    event.preventDefault();
  }));

  renderPools();
  renderQuestionnaires();
  renderBindings();
  renderParticipantGrid();
  renderPackageReceipt();
  renderSetupReviewState();
  refreshProjection();
  schedulePlanRefresh();

  return Object.freeze({
    get mode() { return mode; },
    get openSection() { return openSection; },
    get reviewedSetupSections() { return Object.freeze([...reviewedSetupSections]); },
    get workspace() { return workspace; },
    get settings() { return settingsSnapshot; },
    get plan() { return plan; },
    get experimentPackage() { return experimentPackageDocument?.package ?? null; },
    get experimentPackageSourceText() { return experimentPackageDocument?.canonicalSourceText ?? null; },
    get experimentPackageSelection() {
      if (!experimentPackageDocument || !compiledPackageSelection
        || compiledPackageSelection.assignment?.participantId !== selectedParticipant
        || !selectedLanguageId || !selectedLanguageSelectionPath) return null;
      const steps = compiledPackageSelection.protocolPlan.steps;
      return Object.freeze({
        participantId: selectedParticipant,
        selectedLanguageId,
        languageSelectionPath: Object.freeze([...selectedLanguageSelectionPath]),
        packageSourceByteSha256: experimentPackageDocument.canonicalSourceByteSha256,
        packageDefinitionSha256: experimentPackageDocument.package.integrity.packageDefinitionSha256,
        settingsSha256: compiledPackageSelection.settingsSha256,
        assignmentPlanSha256: compiledPackageSelection.experimentPlan.planHashSha256,
        assignmentSha256: compiledPackageSelection.assignmentSha256,
        protocolPlanSha256: compiledPackageSelection.protocolPlan.protocolPlanHashSha256,
        assetBindingCount: compiledPackageSelection.assetBindings.length,
        protocolStepCount: steps.length,
        stimulusStepCount: steps.filter(({ kind }) => kind === "stimulus").length,
        questionnaireStepCount: steps.filter(({ kind }) => kind === "questionnaire").length,
      });
    },
    get packageReproductionReceipt() { return packageReproductionReceipt; },
    get packageExportStatus() { return packageExport.snapshot(); },
    registerPlannerContribution(segment, getSnapshot, options) {
      return plannerContributions.register(segment, getSnapshot, options);
    },
    plannerContributionChanged(segment) { plannerContributions.changed(segment); },
    getPlannerContributionReview() { return plannerContributions.read(); },
    acceptPlannerContribution(segment, options) { return plannerContributions.accept(segment, options); },
    getPlannerAcceptanceReview(options) { return plannerContributions.readAccepted(options); },
    getQuestionnaireContributionSnapshot,
    restoreQuestionnaireContribution,
    get storageEstimate() { return estimateResearchStorageUse(settingsSnapshot, plan); },
    get inputController() { return inputController; },
    get inputBinding() { return structuredClone(inputBinding); },
    get nativeInputReceiptId() { return nativeInputReceiptId; },
    getYouTubePreflight(stimulusId) {
      const record = stimuli.find(({ id }) => id === stimulusId)?.youtubePreflight;
      return record ? structuredClone(record) : null;
    },
    setMode,
    openSetupSection,
    getValidatedSetup() {
      return Object.freeze({
        settings: settingsSnapshot,
        settingsSha256: settingsHash,
        resolvedPlan: plan,
      });
    },
    applySettings(settings, options) {
      return loadSettingsPayload(settings, options);
    },
    setCapabilities(next) {
      root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.capabilityStatus, { detail: next }));
    },
    setAffect(x, y, receipt = "Authoritative input received.") { updateInputPoint(x, y, receipt); },
    applyNativeInputStatus,
    applyNativeCapture,
    resetAffect(reason = "safe-boundary") {
      inputController.resetNeutral(reason);
      return Object.freeze({ x: inputController.state.x, y: inputController.state.y, inputActive: inputController.state.inputActive });
    },
    setParticipantStates(states) {
      root.dispatchEvent(new CustomEvent(RESEARCH_UI_EVENTS.participantStates, { detail: states }));
    },
    destroy() {
      packageExport.destroy();
      youtubePreflightAdapter?.destroy();
      youtubePreflightAdapter = null;
      setupPreview.destroy();
      runPreview.destroy();
      previewResponseSimulator?.destroy();
      previewResponseSimulator = null;
      inputController.detach();
      cancelBindingCapture();
      if (previewControlSurface instanceof HTMLElement) {
        for (const [type, handler] of Object.entries(previewSimulatorHandlers)) {
          previewControlSurface.removeEventListener(type, handler);
        }
      }
      window.removeEventListener("blur", releasePreviewResponse);
      for (const [type, handler] of Object.entries(runInputHandlers)) window.removeEventListener(type, handler);
      runFeedbackStage?.removeEventListener("pointerdown", handleRunPointer);
      runFeedbackStage?.removeEventListener("pointermove", handleRunPointer);
      runFeedbackStage?.removeEventListener("pointerup", handleRunPointer);
      runFeedbackStage?.removeEventListener("pointercancel", handleRunPointer);
      runFeedbackStage?.removeEventListener("lostpointercapture", handleRunPointer);
    },
  });
}
