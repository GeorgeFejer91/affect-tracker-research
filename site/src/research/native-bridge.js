import { nativeInputRegionRequest } from "./input-region.js";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { INPUT_PRESET_OPTIONS, RESEARCH_UI_EVENTS } from "./ui-contracts.js";
import { probeVideoElement } from "./workspace.js";
import { completeQuestionnaireAssetStorageRequest } from "./questionnaire-storage-request.js";
import { completeExperimentPackageSaveRequest } from "./package-save-request.js";
import { completePlannerFileRequest, PLANNER_LOAD_REQUEST, PLANNER_SAVE_REQUEST } from "./planner-file-request.js";
import { bootPlannerAuthoringNative } from "./planner-authoring-native.js";

const STATUS_POLL_MS = 100;
const DECODE_PROBE_MS = 80;
const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const WORKSPACE_LOCATIONS = new Set(["workspaceRoot", "videoLibrary", "experimentPackage"]);
const QUESTIONNAIRE_ASSET_IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,127}$/u;
const QUESTIONNAIRE_ASSET_FORMATS = new Set(["csv", "txt", "json"]);

function nativeQuestionnaireAssetRequest(detail) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    throw new TypeError("Questionnaire asset storage requires a typed request.");
  }
  const allowedKeys = new Set(["familyId", "languageTag", "format", "sourceSha256", "bytes"]);
  const unknownKey = Object.keys(detail).find((key) => !allowedKeys.has(key));
  if (unknownKey) {
    throw new TypeError(`Questionnaire asset storage request contains unknown field ${unknownKey}.`);
  }
  if (!QUESTIONNAIRE_ASSET_IDENTIFIER.test(detail.familyId ?? "")
    || !QUESTIONNAIRE_ASSET_IDENTIFIER.test(detail.languageTag ?? "")) {
    throw new TypeError("Questionnaire asset folder identifiers must use canonical lowercase spelling.");
  }
  if (!QUESTIONNAIRE_ASSET_FORMATS.has(detail.format)) {
    throw new TypeError("Questionnaire source format must be csv, txt, or json.");
  }
  if (typeof detail.sourceSha256 !== "string" || !SHA256_PATTERN.test(detail.sourceSha256)) {
    throw new TypeError("Questionnaire source SHA-256 must be a lowercase digest.");
  }
  let bytes;
  if (detail.bytes instanceof Uint8Array) bytes = [...detail.bytes];
  else if (detail.bytes instanceof ArrayBuffer) bytes = [...new Uint8Array(detail.bytes.slice(0))];
  else if (ArrayBuffer.isView(detail.bytes)) {
    bytes = [...new Uint8Array(
      detail.bytes.buffer.slice(detail.bytes.byteOffset, detail.bytes.byteOffset + detail.bytes.byteLength),
    )];
  } else if (Array.isArray(detail.bytes)
    && detail.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    bytes = [...detail.bytes];
  } else {
    throw new TypeError("Questionnaire source content must be supplied as bytes.");
  }
  if (bytes.length < 1) {
    throw new RangeError("A questionnaire source must be nonempty.");
  }
  return Object.freeze({
    familyId: detail.familyId,
    languageTag: detail.languageTag,
    format: detail.format,
    sourceSha256: detail.sourceSha256,
    bytes: Object.freeze(bytes),
  });
}

export function nativeInputPresetAvailability(capability) {
  const supported = new Set(capability?.supportedPresets ?? []);
  return Object.freeze(Object.fromEntries(INPUT_PRESET_OPTIONS.map(({ id, contractId }) => [
    id,
    capability?.nativeAuthorityReady === true && supported.has(contractId),
  ])));
}

export function nativeInputBindingSupported(binding, capability) {
  if (capability?.nativeAuthorityReady !== true || !binding || typeof binding !== "object") return false;
  if (!(capability.supportedPresets ?? []).includes(binding.preset)) return false;
  if (binding.kind === "absolute") {
    return capability.supportsAbsolutePointer === true
      && binding.preset === "pointerGrid"
      && binding.axes?.x?.kind === "pointerAxis"
      && binding.axes?.y?.kind === "pointerAxis";
  }
  if (binding.kind === "analog") {
    return capability.supportsGamepad === true
      && ["gamepadLeftStick", "gamepadRightStick"].includes(binding.preset)
      && binding.axes?.x?.kind === "gamepadAxis"
      && binding.axes?.y?.kind === "gamepadAxis";
  }
  if (binding.kind !== "digital") return false;
  const directions = binding.directions ?? {};
  if (Object.keys(directions).length !== 4) return false;
  return ["up", "down", "left", "right"].every((direction) => {
    const token = directions[direction];
    if (token?.kind === "keyboard") return capability.supportsCustomKeyboard === true;
    if (token?.kind === "mouseButton") return capability.supportsCustomMouseButtons === true;
    if (token?.kind === "wheel") return capability.supportsCustomWheel === true;
    if (token?.kind === "gamepadButton") {
      return capability.supportsGamepad === true
        && capability.supportsCustomGamepadButtons === true;
    }
    return false;
  });
}

export { nativeInputRegionRequest } from "./input-region.js";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function messageOf(error) {
  if (error instanceof Error) return error.message;
  if (typeof error?.message === "string") return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}

function once(target, type, { timeoutMs = 15_000, failureTypes = ["error"] } = {}) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      target.removeEventListener(type, success);
      for (const failureType of failureTypes) target.removeEventListener(failureType, failure);
    };
    const success = (event) => { cleanup(); resolve(event); };
    const failure = () => { cleanup(); reject(new Error(`Native media failed before ${type}.`)); };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for native media ${type}.`));
    }, timeoutMs);
    target.addEventListener(type, success, { once: true });
    for (const failureType of failureTypes) target.addEventListener(failureType, failure, { once: true });
  });
}

function safeStimulusId(summary) {
  const suffix = String(summary.workspaceFileId ?? "")
    .replace(/[^A-Za-z0-9._-]/gu, "-")
    .slice(0, 110);
  if (!suffix) throw new TypeError("Native stimulus summary has no opaque workspace file ID.");
  return `workspace-${suffix}`;
}


export async function probeAndAttestNativeVideo({
  invoke,
  workspaceId,
  summary,
  videoFactory = () => document.createElement("video"),
  performanceNow = () => performance.now(),
  probeTimeoutMs = 15_000,
} = {}) {
  if (summary.decodeStatus === "attestedUnqualified"
    && summary.decodeBackend === "webviewVideoFrameCallback"
    && summary.decodeAttestation === "representativeFramesV1"
    && summary.source) return summary;
  const receipt = await invoke("research_workspace_media_url", {
    workspaceId,
    workspaceFileId: summary.workspaceFileId,
    sha256: summary.sha256,
    byteLength: summary.byteLength,
    mimeType: summary.mimeType,
  });
  const video = videoFactory();
  if (!video?.addEventListener || typeof video.play !== "function") {
    throw new TypeError("The native decode probe requires an HTML video element.");
  }
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = receipt.mediaUrl;
  try {
    const probe = await probeVideoElement(video, { timeoutMs: probeTimeoutMs });
    const restart = once(video, "seeked");
    video.currentTime = 0;
    await restart;
    const started = performanceNow();
    await video.play();
    await delay(DECODE_PROBE_MS);
    video.pause?.();
    const mutedPlaybackMs = Math.max(50, Math.min(5_000, performanceNow() - started));
    return invoke("research_attest_workspace_decode", {
      attestation: {
        attestationKind: "attestRepresentativeFramesV1",
        decodeBackend: "webviewVideoFrameCallback",
        workspaceId,
        mediaGrantId: receipt.mediaGrantId,
        workspaceFileId: summary.workspaceFileId,
        sha256: summary.sha256,
        byteLength: summary.byteLength,
        mimeType: summary.mimeType,
        observedDurationMs: probe.durationSeconds * 1_000,
        videoWidth: probe.videoWidth,
        videoHeight: probe.videoHeight,
        mutedPlaybackMs,
        decodedPositionsMs: probe.decodedPositionsSeconds.map((position) => position * 1_000),
      },
    });
  } catch (error) {
    await invoke("research_attest_workspace_decode", {
      attestation: {
        attestationKind: "revokeGrant",
        decodeBackend: "webviewVideoFrameCallback",
        workspaceId,
        mediaGrantId: receipt.mediaGrantId,
        workspaceFileId: summary.workspaceFileId,
        sha256: summary.sha256,
        byteLength: summary.byteLength,
        mimeType: summary.mimeType,
      },
    }).catch(() => {});
    throw error;
  } finally {
    video.pause?.();
    video.removeAttribute?.("src");
    video.load?.();
  }
}


export class NativeResearchRuntimeBridge {
  constructor(root, {
    invoke = tauriInvoke,
    windowObject = globalThis.window,
    setIntervalObject = globalThis.setInterval?.bind(globalThis),
    clearIntervalObject = globalThis.clearInterval?.bind(globalThis),
    videoFactory,
  } = {}) {
    if (!(root instanceof EventTarget) || root.dataset?.researchProgram !== "planner") {
      throw new TypeError("Experiment Planner requires its native authoring root.");
    }
    this.root = root;
    this.invoke = invoke;
    this.window = windowObject;
    this.setInterval = setIntervalObject;
    this.clearInterval = clearIntervalObject;
    this.videoFactory = videoFactory;
    this.plannerOnly = true;
    this.workspace = null;
    this.nativeInputCapability = null;
    this.catalog = new Map();
    this.workspacePublication = 0;
    this.destroyed = false;
    this.inputPollTimer = null;
    this.inputLayoutEpoch = 0;
    this.lastCaptureId = null;
    this.inputCaptureGeneration = 0;
    this.activeInputCaptureGeneration = null;
    this.inputCapturePending = false;
    this.listeners = [];
    this.operation = Promise.resolve();
  }

  async initialize() {
    return this.#initializePlanner();
  }


  async #initializePlanner() {
    const identity = await this.invoke("research_desktop_identity");
    if (identity?.program !== "planner" || identity.schema !== "affect-research-desktop-identity" || identity.version !== 1) {
      throw new Error("This authoring surface requires the Experiment Planner executable.");
    }
    if (identity.suite?.required && !identity.suite.complete) {
      throw new Error(`Experiment Planner requires the complete Planner/Runner suite (${identity.suite.issues.join(", ")}).`);
    }
    this.#bind();
    const [workspace, sources, input, inputStatus] = await Promise.all([
      this.invoke("research_workspace_status"), this.invoke("research_source_capabilities"),
      this.invoke("research_input_capability"),
      this.invoke("research_input_status"),
    ]);
    this.nativeInputCapability = input;
    this.#applyInputCapability();
    this.root.researchUi?.applyNativeInputStatus?.(inputStatus);
    this.#dispatch(RESEARCH_UI_EVENTS.capabilityStatus, {
      indexedDbReady: true, repositoryAssetsReady: sources?.repositoryAsset?.supported === true,
      nativeInputReady: input?.nativeAuthorityReady === true,
      timingWorkerReady: false, lslReady: false, manifestReady: false,
      manifestReason: "Participant execution and recording belong to Experiment Runner.",
    });
    this.#startInputPolling();
    await this.root.researchUi?.connectResearcherLocalPresets?.({
      readSource: request => this.invoke("research_read_local_questionnaire_preset", { request }),
      installSource: request => this.invoke("research_install_local_questionnaire_preset", { request }),
    });
    if (workspace?.selected) {
      try {
        await this.#adoptWorkspace(workspace, { rescan: true });
      } catch (error) {
        this.#showSetupError(error);
      }
    }
    this.root.researchUi?.connectPlannerNativeWorkspace?.(Object.freeze({
      getWorkspaceId: () => this.destroyed ? null : this.workspace?.workspaceId ?? null,
      prepareWorkspace: (receipt, options) => this.prepareWorkspace(receipt, options),
      prepareCatalogue: (receipt, options) => this.prepareCatalogue(receipt, options),
    }));
    return this;
  }


  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.workspacePublication += 1;
    this.authoringNative?.destroy();
    this.inputCaptureGeneration += 1;
    this.activeInputCaptureGeneration = null;
    this.inputCapturePending = false;
    for (const [target, type, listener, options] of this.listeners) {
      target?.removeEventListener(type, listener, options);
    }
    this.listeners = [];
    this.#stopInputPolling();
  }


  #bind() {
    this.#listen(this.root, RESEARCH_UI_EVENTS.stimulusAuthoringRequest, (event) => {
      event.preventDefault();
      const { operation, payload = {}, complete } = event.detail;
      const workspaceId = this.workspace?.workspaceId;
      this.#queue(async () => {
        try {
          this.#requireWorkspace();
          if (!workspaceId || workspaceId !== this.workspace.workspaceId) throw new Error("The workspace changed before video authoring began.");
          let receipt;
          if (operation === "confirm-library" || operation === "scan-library") {
            receipt = await this.invoke("research_video_library", { workspaceId, confirm: operation === "confirm-library" });
          } else if (operation === "save-order") {
            receipt = await this.invoke("research_save_stimulus_order", { workspaceId, document: payload.document });
          } else if (operation === "export-library") {
            if (!["csv", "xlsx"].includes(payload.format) || (Object.hasOwn(payload, "catalogue") && payload.catalogue?.version !== 2)) throw new TypeError("Unsupported catalogue export format or version.");
            const saved = payload.catalogue?.version === 2
              ? await this.invoke("research_export_video_catalogue", { workspaceId, catalogue: payload.catalogue, librarySha256: payload.librarySha256, format: payload.format })
              : await this.invoke("research_export_video_library", { workspaceId, librarySha256: payload.librarySha256, format: payload.format });
            if (!saved) throw new Error("Video library export cancelled.");
            receipt = { saved };
          } else throw new Error("Unknown video authoring operation.");
          if (workspaceId !== this.workspace?.workspaceId) throw new Error("The workspace changed during video authoring.");
          complete({ ok: true, receipt });
        } catch (error) { complete({ ok: false, message: messageOf(error) }); }
      });
    });
    this.#listen(this.root, RESEARCH_UI_EVENTS.selectWorkspaceRequest, (event) => {
      event.preventDefault();
      this.#queue(() => this.#chooseWorkspace());
    });
    this.#listen(this.root, RESEARCH_UI_EVENTS.openWorkspaceLocationRequest, (event) => {
      event.preventDefault();
      this.#queue(() => this.#openWorkspaceLocation(event.detail?.location));
    });
    this.#listen(this.root, RESEARCH_UI_EVENTS.rescanWorkspaceRequest, (event) => {
      event.preventDefault();
      this.#queue(() => this.#rescanWorkspace());
    });
    this.#listen(this.root, RESEARCH_UI_EVENTS.importVideosRequest, (event) => {
      event.preventDefault();
      const workspaceId = this.workspace?.workspaceId;
      this.#queue(() => this.#importStimuli(event.detail?.recursiveDirectory === true ? "folder" : "videos", workspaceId));
    });
    this.#listen(this.root, RESEARCH_UI_EVENTS.loadSettingsRequest, (event) => {
      event.preventDefault();
      this.#queue(() => this.#loadSettings());
    });
    this.#listen(this.root, RESEARCH_UI_EVENTS.loadExperimentRequest, (event) => {
      event.preventDefault();
      this.#queue(() => this.#loadExperiment());
    });
    this.#listen(this.root, RESEARCH_UI_EVENTS.loadExperimentPackageRequest, (event) => {
      event.preventDefault();
      this.#queue(() => this.#loadExperimentPackage());
    });
    this.#listen(this.root, "research:open-surveyjs-builder", event => {
      event.preventDefault();
      this.#queue(() => this.invoke("research_open_surveyjs_builder"));
    });
    this.#listen(this.root, PLANNER_LOAD_REQUEST, event => {
      event.preventDefault();
      // Selecting authored JSON never rescans or authorizes its media folders.
      this.#queue(() => completePlannerFileRequest(event.detail, () => this.invoke("research_load_planner_recipe")));
    });
    this.#listen(this.root, PLANNER_SAVE_REQUEST, event => {
      event.preventDefault();
      this.#queue(() => completePlannerFileRequest(event.detail, () => {
        if (!this.plannerOnly || typeof event.detail?.sourceText !== "string") throw new TypeError("Save a complete recipe from Experiment Planner.");
        return this.invoke("research_save_planner_recipe", { sourceText: event.detail.sourceText });
      }));
    });
    this.#listen(this.root, RESEARCH_UI_EVENTS.saveExperimentPackageRequest, (event) => {
      event.preventDefault();
      this.#queue(() => completeExperimentPackageSaveRequest(event.detail,
        (sourceText) => this.#saveExperimentPackage(sourceText)));
    });
    this.#listen(this.root, RESEARCH_UI_EVENTS.saveSettingsRequest, (event) => {
      event.preventDefault();
      this.#queue(() => this.#saveSettings(event.detail));
    });
    this.#listen(this.root, RESEARCH_UI_EVENTS.storeQuestionnaireAssetRequest, (event) => {
      event.preventDefault();
      this.#queue(() => completeQuestionnaireAssetStorageRequest(event.detail, (detail) => {
        const request = nativeQuestionnaireAssetRequest(detail);
        return this.#storeQuestionnaireAsset(request);
      }));
    });
    this.#listen(this.root, RESEARCH_UI_EVENTS.exportPlanRequest, (event) => {
      event.preventDefault();
      this.#queue(() => this.#exportPlan(event.detail));
    });

    this.#listen(this.root, RESEARCH_UI_EVENTS.startRequest, (event) => {
      event.preventDefault();
      this.#announce("Open the recipe in Experiment Runner.");
    });
    this.#listen(this.root, RESEARCH_UI_EVENTS.inputBindingChanged, (event) => {
      this.#queue(() => this.#beginNativeInputTest(event.detail?.binding));
    });
    this.#listen(this.root, RESEARCH_UI_EVENTS.inputCaptureRequest, (event) => {
      event.preventDefault();
      const generation = ++this.inputCaptureGeneration;
      this.activeInputCaptureGeneration = null;
      this.inputCapturePending = true;
      this.#queue(() => this.#beginNativeCapture(event.detail, generation));
    });
    this.#listen(this.root, RESEARCH_UI_EVENTS.inputCaptureCancel, () => {
      this.inputCaptureGeneration += 1;
      this.activeInputCaptureGeneration = null;
      this.inputCapturePending = false;
      this.#queue(() => this.invoke("research_input_cancel_setup"));
    });
    this.#listen(this.root, "focusin", (event) => {
      if (this.root.researchUi?.openSection !== "input") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("#binding-capture-dialog")) return;
      if (target?.closest(".input-test-grid")) {
        this.#queue(() => this.#beginNativeInputTest());
        return;
      }
      this.#queue(() => this.invoke("research_input_cancel_setup"));
    });
    this.#listen(this.window, "resize", () => {
      this.#queue(() => this.#refreshNativeInputRegion());
    });
    this.#listen(this.root, "change", (event) => {
      if (event.target?.id === "native-playback-mode" && this.workspace) {
        this.#queue(() => this.#rescanWorkspace());
      }
    });
  }


  #applyInputCapability(binding = this.root.researchUi?.inputBinding) {
    const availability = nativeInputPresetAvailability(this.nativeInputCapability);
    const select = this.root.querySelector?.("#input-preset");
    for (const option of select?.querySelectorAll?.("option") ?? []) {
      if (option.value === "custom") continue;
      const available = availability[option.value] === true;
      option.disabled = !available;
      option.title = available ? "" : "No safe native Tauri backend is available for this preset.";
    }
    const presetReady = nativeInputBindingSupported(binding, this.nativeInputCapability);
    this.#dispatch(RESEARCH_UI_EVENTS.capabilityStatus, {
      nativeInputReady: this.nativeInputCapability?.nativeAuthorityReady === true,
      nativeInputPresetReady: presetReady,
    });
    return presetReady;
  }

  async #setNativeInputRegion(selector, purpose) {
    const element = this.root.querySelector?.(selector);
    const region = nativeInputRegionRequest(
      element,
      purpose,
      ++this.inputLayoutEpoch,
      this.window,
    );
    return this.invoke("research_input_set_region", { region });
  }

  async #beginNativeInputTest(binding = this.root.researchUi?.inputBinding, captureGeneration = this.inputCaptureGeneration) {
    if (captureGeneration !== this.inputCaptureGeneration) return;
    if (!this.#applyInputCapability(binding)) {
      await this.invoke("research_input_cancel_setup");
      return;
    }
    const grid = this.root.querySelector?.(".input-test-grid");
    if (!grid || grid.getClientRects?.().length === 0) return;
    const activeElement = this.root.ownerDocument?.activeElement;
    if (activeElement !== grid && !grid.contains?.(activeElement)) {
      await this.invoke("research_input_cancel_setup");
      return;
    }
    await this.#setNativeInputRegion(".input-test-grid", "setupTest");
    if (captureGeneration !== this.inputCaptureGeneration) return;
    const status = await this.invoke("research_input_begin_test", { binding });
    if (captureGeneration === this.inputCaptureGeneration) this.root.researchUi?.applyNativeInputStatus?.(status);
  }

  async #beginNativeCapture(detail, generation) {
    if (generation !== this.inputCaptureGeneration) return;
    try {
      const binding = detail?.binding;
      if (!this.#applyInputCapability(binding)) {
        throw new Error("This binding cannot be captured by the safe native Tauri backend.");
      }
      await this.#setNativeInputRegion("#binding-capture-dialog .dialog-content", "setupCapture");
      if (generation !== this.inputCaptureGeneration) return;
      const status = await this.invoke("research_input_begin_capture", {
        binding,
        direction: detail.direction,
      });
      if (generation !== this.inputCaptureGeneration) return;
      this.inputCapturePending = false;
      this.activeInputCaptureGeneration = generation;
      this.root.researchUi?.applyNativeInputStatus?.(status);
    } catch (error) {
      if (generation !== this.inputCaptureGeneration) return;
      this.inputCapturePending = false;
      this.activeInputCaptureGeneration = null;
      this.root.researchUi?.failNativeCapture?.(messageOf(error));
      throw error;
    }
  }

  async #refreshNativeInputRegion() {
    if (this.root.researchUi?.openSection === "input") await this.#beginNativeInputTest();
  }


  async #pollNativeInputStatus() {
    if (this.inputCapturePending) return;
    const generation = this.inputCaptureGeneration;
    const activeGeneration = this.activeInputCaptureGeneration;
    let status;
    try {
      status = await this.invoke("research_input_status");
    } catch (error) {
      if (generation !== this.inputCaptureGeneration) return;
      throw error;
    }
    if (generation !== this.inputCaptureGeneration) return;
    if (activeGeneration !== this.activeInputCaptureGeneration) return;
    this.root.researchUi?.applyNativeInputStatus?.(status);
    if (activeGeneration === generation && status?.capture?.captureId && status.capture.captureId !== this.lastCaptureId) {
      this.lastCaptureId = status.capture.captureId;
      this.activeInputCaptureGeneration = null;
      if (this.root.researchUi?.applyNativeCapture?.(status.capture) === true) {
        // Serialize with begin/cancel so an accepted old result cannot start a
        // test after the user has already armed another capture.
        this.#queue(async () => {
          if (generation !== this.inputCaptureGeneration) return;
          await this.#beginNativeInputTest(status.capture.binding, generation);
        });
      }
    }
  }

  #startInputPolling() {
    this.#stopInputPolling();
    this.inputPollTimer = this.setInterval?.(() => {
      void this.#pollNativeInputStatus().catch((error) => this.#showSetupError(error));
    }, STATUS_POLL_MS);
  }

  #stopInputPolling() {
    if (this.inputPollTimer !== null) this.clearInterval?.(this.inputPollTimer);
    this.inputPollTimer = null;
  }


  #listen(target, type, listener, options) {
    target?.addEventListener(type, listener, options);
    this.listeners.push([target, type, listener, options]);
  }


  #queue(operation) {
    this.operation = this.operation.then(operation, operation).catch(error => this.#showSetupError(error));
    return this.operation;
  }


  async #chooseWorkspace() {
    const workspace = await this.invoke("research_choose_workspace");
    if (!workspace?.selected) return;
    await this.#adoptWorkspace(workspace, { rescan: true });
  }

  async #openWorkspaceLocation(location) {
    this.#requireWorkspace();
    if (!WORKSPACE_LOCATIONS.has(location)) {
      throw new Error("The requested project location is not part of the selected workspace.");
    }
    await this.invoke("research_open_workspace_location", {
      workspaceId: this.workspace.workspaceId,
      location,
    });
  }

  async #adoptWorkspace(workspace, { rescan = false } = {}) {
    const prepared = this.prepareWorkspace(workspace);
    prepared.commit();
    this.#dispatch(RESEARCH_UI_EVENTS.workspaceReady, prepared.projection);
    if (rescan) await this.#rescanWorkspace();
  }

  prepareWorkspace(receipt, { isCurrent = () => true } = {}) {
    if (typeof isCurrent !== "function" || receipt?.selected !== true
      || !RUN_ID_PATTERN.test(receipt?.workspaceId ?? "") || receipt.librariesReady !== true) {
      throw new Error("The selected native workspace did not initialize the Research libraries and fixed package asset tree.");
    }
    const workspace = Object.freeze(structuredClone(receipt));
    const priorWorkspace = this.workspace, priorCatalog = this.catalog, publication = this.workspacePublication;
    let committed = false;
    const current = () => !committed && !this.destroyed && isCurrent()
      && this.workspace === priorWorkspace && this.catalog === priorCatalog && this.workspacePublication === publication;
    if (!current()) throw new Error("Native workspace preparation is stale.");
    const projection = {
      surface: "tauri",
      label: workspace.displayName ?? "Windows Research workspace",
      directoryPermission: true,
      workspaceId: workspace.workspaceId,
    };
    return Object.freeze({
      isCurrent: current,
      get projection() { return structuredClone(projection); },
      commit: () => {
        if (!current()) throw new Error("Native workspace preparation is stale or already committed.");
        this.workspace = workspace;
        this.catalog = new Map();
        this.workspacePublication += 1;
        committed = true;
      },
    });
  }

  async #rescanWorkspace() {
    this.#requireWorkspace();
    await this.ensureMediaReady();
    const current = this.#catalogueCurrent();
    const result = await this.invoke("research_rescan_stimuli", { workspaceId: this.workspace.workspaceId });
    if (!current()) throw new Error("The workspace or catalogue changed during the native scan.");
    await this.#catalogue(result);
  }

  async #importStimuli(selectionKind, workspaceId) {
    this.#requireWorkspace();
    if (!workspaceId || workspaceId !== this.workspace.workspaceId) throw new Error("The workspace changed before video import began.");
    await this.ensureMediaReady();
    const current = this.#catalogueCurrent();
    const result = await this.invoke("research_import_stimuli", {
      workspaceId,
      selectionKind,
    });
    if (workspaceId !== this.workspace?.workspaceId) throw new Error("The workspace changed during video import.");
    if (!current()) throw new Error("The workspace or catalogue changed during video import.");
    if (result) await this.#catalogue(result);
  }

  async ensureMediaReady({ isCurrent = () => true, signal } = {}) {
    if (signal?.aborted || !isCurrent() || this.destroyed) {
      throw new Error("Planner media preparation was superseded.");
    }
  }

  #catalogueCurrent() {
    const workspace = this.workspace, catalog = this.catalog, publication = this.workspacePublication;
    const settingsSignature = JSON.stringify(this.root.researchUi?.settings?.stimuli ?? null);
    return () => !this.destroyed && this.workspace === workspace && this.catalog === catalog
      && this.workspacePublication === publication
      && JSON.stringify(this.root.researchUi?.settings?.stimuli ?? null) === settingsSignature;
  }

  async #catalogue(result, { settings = this.root.researchUi?.settings } = {}) {
    const current = this.#catalogueCurrent();
    try {
      const prepared = await this.prepareCatalogue(result, { settings, isCurrent: current, reportProgress: true });
      prepared.commit();
      this.#dispatch(RESEARCH_UI_EVENTS.stimuliCatalogued, prepared.projection);
    } catch (error) {
      // A failed current GUI scan withdraws prior readiness, never publishes a
      // partially verified catalogue. A stale scan cannot erase newer work.
      if (current()) {
        this.catalog = new Map();
        this.workspacePublication += 1;
        this.#dispatch(RESEARCH_UI_EVENTS.stimuliCatalogued, { items: [], replace: true });
      }
      throw error;
    }
  }

  async prepareCatalogue(result, { settings = this.root.researchUi?.settings, isCurrent = () => true, reportProgress = false } = {}) {
    if (typeof isCurrent !== "function" || !this.workspace
      || result?.workspaceId !== this.workspace.workspaceId || !Array.isArray(result.stimuli)) {
      throw new Error("Native stimulus scan returned an invalid workspace binding.");
    }
    const workspace = this.workspace;
    const baseCurrent = this.#catalogueCurrent();
    const selectedSettings = structuredClone(settings);
    let committed = false;
    const current = () => !committed && isCurrent() && baseCurrent();
    const check = () => { if (!current()) throw new Error("Native catalogue preparation is stale or already committed."); };
    check();
    const scannedStimuli = structuredClone(result.stimuli);
    const decodeQualification = "attestedUnqualified";
    const nextCatalog = new Map();
    const items = [];
    const failures = [];
    for (const scanned of scannedStimuli) {
      check();
      try {
        const summary = await probeAndAttestNativeVideo({
          invoke: this.invoke,
          workspaceId: workspace.workspaceId,
          summary: scanned,
          videoFactory: this.videoFactory,
        });
        check();
        const validHtml = summary.decodeStatus === "attestedUnqualified"
          && summary.decodeBackend === "webviewVideoFrameCallback"
          && summary.decodeAttestation === "representativeFramesV1";
        if (!validHtml || !summary.source) {
          throw new Error(summary.displayName + " did not produce HTML decode evidence.");
        }
        const existing = selectedSettings?.stimuli?.items?.find(({ source }) => (
          source.kind === "workspaceFile" && source.relativePath === summary.source.relativePath
        ));
        const stimulusId = existing?.stimulusId ?? safeStimulusId(summary);
        const stimulus = Object.freeze({
          stimulusId,
          title: existing?.title ?? summary.displayName,
          source: Object.freeze({ ...summary.source }),
        });
        if (nextCatalog.has(summary.workspaceFileId)) throw new Error("Native scan contains a duplicate video identity.");
        nextCatalog.set(summary.workspaceFileId, Object.freeze({ summary: Object.freeze(structuredClone(summary)), stimulus }));
        items.push(Object.freeze({
          stimulus,
          verified: true,
          decodeQualification,
          workspaceFileId: summary.workspaceFileId,
          displayGeometry: null,
        }));
      } catch (error) {
        check();
        failures.push(`${scanned.displayName}: ${messageOf(error)}`);
      }
    }
    check();
    if (failures.length > 0) throw new Error(`Native decode verification failed for ${failures.join("; ")}`);
    const projection = structuredClone({ items, replace: true });
    return Object.freeze({
      isCurrent: current,
      get projection() { return structuredClone(projection); },
      commit: () => {
        check();
        this.catalog = nextCatalog;
        this.workspacePublication += 1;
        committed = true;
      },
    });
  }

  async #loadSettings() {
    const receipt = await this.invoke("research_load_settings");
    if (!receipt) return;
    const payload = receipt.settings ?? receipt.legacySettings;
    if (!payload) throw new Error("Native settings import returned no compatible payload.");
    this.#dispatch(RESEARCH_UI_EVENTS.settingsLoaded, { settings: payload });
    if (this.workspace) await this.#rescanWorkspace();
  }

  async #loadExperiment() {
    const receipt = await this.invoke("research_load_experiment");
    if (!receipt) return;
    this.#dispatch(RESEARCH_UI_EVENTS.experimentLoaded, { receipt });
  }

  async #loadExperimentPackage() {
    const receipt = await this.invoke("research_load_experiment_package");
    if (!receipt) return;
    if (this.workspace) {
      const current = this.#catalogueCurrent();
      const result = await this.invoke("research_rescan_package_stimuli", {
        workspaceId: this.workspace.workspaceId,
        sourceText: receipt.canonicalSourceText,
      });
      if (!current()) throw new Error("The workspace or catalogue changed during the native package scan.");
      await this.#catalogue(result, { settings: receipt.package?.settings });
    }
    this.#dispatch(RESEARCH_UI_EVENTS.experimentPackageLoaded, { receipt });
  }

  async #saveExperimentPackage(sourceText) {
    if (typeof sourceText !== "string") {
      throw new TypeError("Native package save requires canonical experiment.package.json text.");
    }
    const receipt = await this.invoke("research_save_experiment_package", {
      sourceText,
    });
    // Saving a design does not depend on decoder/recovery readiness. The UI
    // validates this receipt before adopting it and requests readiness separately.
    return receipt;
  }

  async #saveSettings(detail) {
    this.#requireWorkspace();
    const receipt = await this.invoke("research_save_settings", {
      workspaceId: this.workspace.workspaceId,
      settings: detail.settings,
    });
    this.#announce(`${receipt.fileName} saved with hash ${receipt.settingsSha256}.`);
  }

  async #storeQuestionnaireAsset(request) {
    this.#requireWorkspace();
    const nativeRequest = {
      workspaceId: this.workspace.workspaceId,
      ...request,
    };
    const receipt = await this.invoke("research_store_questionnaire_asset", {
      request: nativeRequest,
    });
    const expectedPath = `assets/questionnaires/${request.familyId}/${request.languageTag}/${request.sourceSha256}.${request.format}`;
    if (!receipt
      || receipt.workspaceId !== this.workspace.workspaceId
      || receipt.familyId !== request.familyId
      || receipt.languageTag !== request.languageTag
      || receipt.relativePath !== expectedPath
      || receipt.sourceSha256 !== request.sourceSha256
      || receipt.byteLength !== request.bytes.length) {
      throw new Error("Native questionnaire asset storage returned an invalid workspace receipt.");
    }
    this.#announce(`Questionnaire source saved to ${receipt.relativePath}.`);
    return receipt;
  }

  async #exportPlan(detail) {
    this.#requireWorkspace();
    const receipt = await this.invoke("research_export_assignment_plan", {
      workspaceId: this.workspace.workspaceId,
      settings: detail.settings,
      assignmentPlan: detail.plan,
    });
    this.#announce(`${receipt.fileName} exported with ${receipt.rowCount} rows.`);
  }


  #requireWorkspace() {
    if (!this.workspace?.workspaceId) throw new Error("Select a native Research workspace first.");
  }

  #dispatch(type, detail) {
    this.root.dispatchEvent(new CustomEvent(type, { detail }));
  }

  #announce(message) {
    const announcer = this.root.querySelector?.("#research-announcer");
    if (announcer) announcer.textContent = message;
  }

  #showSetupError(error) {
    const message = messageOf(error);
    const status = this.root.querySelector?.(this.plannerOnly ? "#planner-status" : "#start-status");
    if (status) { status.textContent = message; status.hidden = false; status.scrollIntoView?.({ block: "nearest" }); }
    this.#announce(message);
  }


}

export async function bootNativeBridge(root) {
  if (!root?.matches?.('#research-app[data-research-surface="tauri"][data-research-program="planner"]')) {
    throw new Error("Experiment Planner native root is missing.");
  }
  if (!root.researchUi) throw new Error("Research UI must initialize before the native runtime.");
  const bridge = new NativeResearchRuntimeBridge(root);
  root.researchRuntime = bridge;
  await bridge.initialize();
  bridge.authoringNative = await bootPlannerAuthoringNative(root, tauriInvoke, guard => bridge.ensureMediaReady(guard));
  return bridge;
}
