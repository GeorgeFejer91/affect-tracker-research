const CATALOGUE_PHASES = new Set(["bridgePreparation", "appProjection"]);
const ERROR_CODES = new Set(["native_media_unavailable", "invalid_research_contract", "forbidden_operation", "workspace_required"]);
const MESSAGES = new Map([
  ["Native catalogue preparation is stale or already committed.", "catalogue-stale"],
]);

/** Fixed, path-free diagnostics: never forward arbitrary exception text. */
export class NativeCatalogueFailure extends Error {
  constructor(phase, error) {
    const knownPhase = CATALOGUE_PHASES.has(phase) ? phase : "bridgePreparation";
    const message = typeof error?.message === "string" ? error.message : "";
    const reason = MESSAGES.get(message) ?? (ERROR_CODES.has(error?.code) ? error.code : "owner-error");
    super(`Video catalogue failed at ${knownPhase} (${reason}). The native effect receipt is retained; do not repeat the import blindly.`);
  }
}
