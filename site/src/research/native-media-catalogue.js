/**
 * Sequential native decode qualification for one freshly scanned workspace.
 *
 * This module deliberately knows nothing about UI state, experiment planning,
 * paths, or Tauri window handles. It composes the typed native-media controller
 * into one bounded catalogue operation and guarantees an attempted actor stop
 * after every stimulus.
 */
const CATALOGUE_PHASES = new Set(["prepare", "awaitPrepared", "attestDecode", "stop", "bridgePreparation", "appProjection"]);
const NATIVE_REASONS = ["native-gstplay-command-timeout", "native-gstplay-duration-unavailable",
  "native-gstplay-video-width-unavailable", "native-gstplay-video-height-unavailable",
  "native-gstplay-display-metadata-unavailable", "native-gstplay-display-metadata-stale",
  "native-gstplay-seek-timeout", "native-gstplay-snapshot-unavailable",
  "native-display-snapshot-not-square-pixel", "native-display-orientation-missing",
  "native-display-orientation-unsupported", "native-display-metadata-inconsistent",
  "native-media-shutdown-pending", "native-gstplay-actor-unavailable",
  "native-gstplay-command-overload", "native-gstplay-signal-overload",
  "native-gstplay-channel-disconnected", "native-gstplay-actor-exited"];
const ERROR_CODES = new Set(["native_media_unavailable", "invalid_research_contract", "forbidden_operation", "workspace_required"]);
const MESSAGES = new Map([
  ["Native media host geometry is unavailable.", "viewport-unavailable"],
  ["Native media prepare receipt v1 is malformed.", "prepare-receipt-invalid"],
  ["Native media status v1 is malformed.", "status-invalid"],
  ["Native decoded stimulus summary is malformed.", "decoded-summary-invalid"],
  ["Native media operation timed out waiting for paused.", "paused-timeout"],
  ["Native catalogue preparation is stale or already committed.", "catalogue-stale"],
]);

/** Fixed, path-free diagnostics: never forward arbitrary exception text. */
export class NativeCatalogueFailure extends Error {
  constructor(phase, error) {
    const knownPhase = CATALOGUE_PHASES.has(phase) ? phase : "bridgePreparation";
    const message = typeof error?.message === "string" ? error.message : "";
    const reason = NATIVE_REASONS.find(value => message.includes(`(${value})`))
      ?? MESSAGES.get(message) ?? (ERROR_CODES.has(error?.code) ? error.code : "owner-error");
    super(`Video catalogue failed at ${knownPhase} (${reason}). The native effect receipt is retained; do not repeat the import blindly.`);
  }
}

export async function attestNativeGstCatalogue(options) {
  return attestCatalogue(options, "attestDecode");
}

export async function attestNativeGstCatalogueV2(options) {
  return attestCatalogue(options, "attestDecodeV2");
}

async function attestCatalogue({
  controller,
  workspaceId,
  stimuli,
  viewportHost,
  onProgress = () => {},
} = {}, attestMethod) {
  if (!controller
    || typeof controller.prepare !== "function"
    || typeof controller.awaitPrepared !== "function"
    || typeof controller[attestMethod] !== "function"
    || typeof controller.stop !== "function"
    || typeof workspaceId !== "string"
    || !Array.isArray(stimuli)
    || !viewportHost?.getBoundingClientRect
    || typeof onProgress !== "function") {
    throw new TypeError("Native GstPlay catalogue qualification inputs are malformed.");
  }

  const qualified = [];
  const failures = [];
  for (let index = 0; index < stimuli.length; index += 1) {
    const scanned = stimuli[index];
    onProgress(Object.freeze({ index, total: stimuli.length, scanned }));
    let operationError = null;
    let phase = "prepare";
    try {
      await controller.prepare({ workspaceId, summary: scanned, host: viewportHost });
      phase = "awaitPrepared";
      await controller.awaitPrepared({ attempts: 600, intervalMs: 25 });
      phase = "attestDecode";
      qualified.push(await controller[attestMethod]({ workspaceId, summary: scanned }));
    } catch (error) {
      operationError = error;
      failures.push(Object.freeze({ scanned, error, phase }));
    } finally {
      try {
        await controller.stop();
      } catch (stopError) {
        if (!operationError) failures.push(Object.freeze({ scanned, error: stopError, phase: "stop" }));
      }
    }
  }
  onProgress(Object.freeze({ index: stimuli.length, total: stimuli.length, scanned: null }));
  return Object.freeze({
    qualified: Object.freeze(qualified),
    failures: Object.freeze(failures),
  });
}
