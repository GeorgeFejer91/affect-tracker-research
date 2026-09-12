import { canonicalJson } from "./canonical.js";

export const PLANNER_COMMAND_SCHEMA = "affect-research-planner-command";
export const PLANNER_RESULT_SCHEMA = "affect-research-planner-command-result";
export const PLANNER_COMMAND_MAX_BYTES = 16 * 1024 * 1024;
export const PLANNER_COMMAND_MAX_EDITS = 256;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const FIELD = /^P[1-7]\.[A-Za-z][A-Za-z0-9_.-]{0,159}$/u;

export class PlannerCommandError extends Error {
  constructor(code, message, field = null) { super(message); this.code = code; this.field = field; }
}
export function commandFailure(code, message, field = null) { throw new PlannerCommandError(code, message, field); }
export function exactCommandKeys(value, keys) {
  const actual = value && typeof value === "object" ? Object.keys(value).sort() : [];
  const expected = [...keys].sort();
  if (!value || typeof value !== "object" || Array.isArray(value)
    || actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    commandFailure("malformed_command", "Command fields are missing or unknown.");
  }
}
export function validateCommandJson(value, depth = 0) {
  if (depth > 64) commandFailure("limit_exceeded", "Command JSON exceeds the nesting limit.");
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach(item => validateCommandJson(item, depth + 1)); return; }
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) commandFailure("malformed_command", "Unsupported object key.");
      validateCommandJson(item, depth + 1);
    }
    return;
  }
  commandFailure("malformed_command", "Commands require finite JSON values.");
}
export function commandOwner(value) {
  if (!/^P[1-7]$/u.test(value ?? "")) commandFailure("unknown_owner", "Unknown Planner owner.");
  return value;
}
export function commandField(value) {
  if (typeof value !== "string" || !FIELD.test(value)) commandFailure("unknown_setting", "Unknown Planner setting.");
  return value;
}
export function commandConsequence(value) {
  if (typeof value !== "string" || !/^[a-z][a-zA-Z0-9.-]{0,79}$/u.test(value)) {
    commandFailure("unknown_operation", "Unknown consequential operation.");
  }
  return value;
}
export function validatePlannerEdit(edit) {
  if (edit?.kind === "set") {
    exactCommandKeys(edit, ["kind", "field", "value"]); commandField(edit.field);
  } else if (edit?.kind === "operation") {
    exactCommandKeys(edit, ["kind", "owner", "operation", "arguments"]); commandOwner(edit.owner);
    if (!/^[a-z][a-zA-Z0-9.-]{0,79}$/u.test(edit.operation ?? "")) commandFailure("unknown_operation", "Unknown owner operation.");
  } else commandFailure("unknown_action", "Unknown Planner edit.");
  return edit;
}
export function validatePlannerCommand(value) {
  validateCommandJson(value);
  if (new TextEncoder().encode(canonicalJson(value)).byteLength > PLANNER_COMMAND_MAX_BYTES) commandFailure("limit_exceeded", "Command exceeds 16 MiB.");
  exactCommandKeys(value, ["schema", "version", "sessionId", "requestId", "expectedRevision", "action"]);
  if (value.schema !== PLANNER_COMMAND_SCHEMA || value.version !== 1) commandFailure("unsupported_version", "Unsupported Planner command version.");
  if (!UUID.test(value.sessionId ?? "") || !UUID.test(value.requestId ?? "")) commandFailure("malformed_command", "Command identity must be a UUID.");
  if (value.expectedRevision !== null && (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0)) commandFailure("malformed_command", "Invalid expected revision.");
  const action = value.action;
  switch (action?.kind) {
    case "catalogue": case "snapshot": exactCommandKeys(action, ["kind"]); break;
    case "get": exactCommandKeys(action, ["kind", "field"]); commandField(action.field); break;
    case "validate": exactCommandKeys(action, ["kind", "owner"]); if (action.owner !== null) commandOwner(action.owner); break;
    case "set": validatePlannerEdit(action); break;
    case "apply":
      exactCommandKeys(action, ["kind", "edits"]);
      if (!Array.isArray(action.edits) || action.edits.length < 1 || action.edits.length > PLANNER_COMMAND_MAX_EDITS) commandFailure("limit_exceeded", "A batch requires 1–256 edits.");
      action.edits.forEach(validatePlannerEdit); break;
    case "perform":
      exactCommandKeys(action, ["kind", "operation", "arguments"]);
      commandConsequence(action.operation);
      if (!action.arguments || typeof action.arguments !== "object" || Array.isArray(action.arguments)) {
        commandFailure("malformed_command", "Consequential arguments require an object.");
      }
      break;
    case "cancel":
      exactCommandKeys(action, ["kind", "requestId"]);
      if (!UUID.test(action.requestId ?? "")) commandFailure("malformed_command", "Cancellation requires a request UUID.");
      break;
    default: commandFailure("unknown_action", "Unknown Planner command action.");
  }
  if (["set", "apply", "perform"].includes(action.kind) && value.expectedRevision === null) commandFailure("revision_required", "Authored changes require an expected revision.");
  return structuredClone(value);
}

export function validateSettingValue(setting, value) {
  if (!setting.writable || setting.classification === "derived") commandFailure("read_only", "This setting is derived or read-only.", setting.id);
  const validType = setting.type === "json" || (setting.type === "integer" ? Number.isSafeInteger(value)
    : setting.type === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === setting.type);
  if (!validType) commandFailure("invalid_value", `Setting requires ${setting.type}.`, setting.id);
  if ((typeof value === "number" && ((setting.minimum !== undefined && value < setting.minimum) || (setting.maximum !== undefined && value > setting.maximum)))
    || (typeof value === "string" && setting.maxLength !== undefined && [...value].length > setting.maxLength)
    || (setting.enum && !setting.enum.includes(value))) commandFailure("invalid_value", "Setting is outside its declared range.", setting.id);
  validateCommandJson(value);
}
