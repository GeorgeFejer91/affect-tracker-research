const CATALOGUE_PHASES = new Set(["prepare", "awaitPrepared", "attestDecode", "stop", "bridgePreparation", "appProjection"]);
const NATIVE_REASONS = ["html-video-command-timeout", "html-video-duration-unavailable",
  "html-video-video-width-unavailable", "html-video-video-height-unavailable",
  "html-video-display-metadata-unavailable", "html-video-display-metadata-stale",
  "html-video-seek-timeout", "html-video-snapshot-unavailable",
  "html-video-snapshot-not-square-pixel", "html-video-orientation-missing",
  "html-video-orientation-unsupported", "html-video-metadata-inconsistent",
  "native-media-shutdown-pending", "html-video-actor-unavailable",
  "html-video-command-overload", "html-video-signal-overload",
  "html-video-channel-disconnected", "html-video-actor-exited"];
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
