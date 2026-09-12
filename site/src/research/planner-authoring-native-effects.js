import { canonicalJson } from "./canonical.js";
import { commandFailure, exactCommandKeys, validateCommandJson } from "./planner-authoring-contract.js";

const FIELDS = Object.freeze({
  selectWorkspace: ["grantId"], importVideos: ["grantId", "workspaceId"],
  importVideoFolder: ["grantId", "workspaceId"], rescanVideoLibrary: ["workspaceId"],
  readQuestionnaire: ["grantId"], storeQuestionnaire: ["workspaceId", "questionnaireId", "familyId", "languageTag", "format", "sourceSha256", "bytesHex"],
  writeRecipe: ["grantId", "sourceText"], readRecipe: ["grantId"],
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const PUBLIC_OPERATIONS = Object.freeze({ readQuestionnaire: "importQuestionnaire", storeQuestionnaire: "saveQuestionnaire",
  writeRecipe: "saveRecipe", readRecipe: "openRecipe" });

/** Fixed native RPC transport only. Native owns original-request/grant/CAS
 * authorization, source validation, filesystem effects and retained receipts. */
export function createPlannerNativeEffects({ invoke, sessionId }) {
  if (typeof invoke !== "function" || !UUID.test(sessionId)) throw new TypeError("Native effects require the owned session.");
  let disposed = false;
  return Object.freeze({
    async execute(context, action, { isCurrent, signal, recordEffect }) {
      exactCommandKeys(context, ["sessionId", "requestId", "expectedRevision"]);
      if (context.sessionId !== sessionId || !UUID.test(context.requestId)
        || !Number.isSafeInteger(context.expectedRevision) || context.expectedRevision < 0) {
        commandFailure("stale_session", "Native effect identity does not match this command.");
      }
      if (!Object.hasOwn(FIELDS, action?.type)) commandFailure("unknown_operation", "Native effect is not registered.");
      exactCommandKeys(action, ["type", ...FIELDS[action.type]]);
      validateCommandJson(action);
      if (Object.hasOwn(action, "grantId") && !UUID.test(action.grantId)) commandFailure("invalid_grant", "Native selection requires an opaque grant identity.");
      if (typeof isCurrent !== "function" || typeof recordEffect !== "function") throw new TypeError("Native effects require command guards and receipt retention.");
      const request = structuredClone({ context, action });
      if (new TextEncoder().encode(canonicalJson({ request })).byteLength + 1 > MAX_FRAME_BYTES) commandFailure("request_limit", "Native effect exceeds the encoded transport limit.");
      if (disposed || signal?.aborted || !isCurrent()) commandFailure("canceled", "The command ended before native dispatch.");
      // A rejected/lost RPC is not proof that a write did not occur. The native
      // ledger supplies a more precise receipt when its acknowledgement arrives.
      recordEffect({ operation: action.type, stage: "dispatching", outcome: "unknown" });
      const result = await invoke("research_planner_authoring_effect", { request });
      exactCommandKeys(result, ["schema", "version", "operation", "effect", "payload", "error", "superseded"]);
      if (result.schema !== "affect-research-planner-native-result" || result.version !== 1
        || result.operation !== (PUBLIC_OPERATIONS[action.type] ?? action.type)) {
        commandFailure("native_protocol", "Native effect returned an invalid acknowledgement.");
      }
      validateCommandJson(result);
      // Record even after cancellation/disposal. Neither condition erases an
      // actual acknowledged write; only adoption of its result is forbidden.
      if (result.effect !== null) recordEffect(result.effect);
      if (result.error !== null) commandFailure(typeof result.error.code === "string" ? result.error.code : "native_failed", "Native operation failed; inspect its retained receipt.");
      if (disposed || signal?.aborted || result.superseded !== null || !isCurrent()) commandFailure("stale_revision", "Native operation completed after the command changed; its receipt is retained.");
      return structuredClone(result.payload);
    },
    destroy() { disposed = true; },
  });
}
