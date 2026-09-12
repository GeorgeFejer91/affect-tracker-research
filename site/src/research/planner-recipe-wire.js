import { canonicalJson } from "./canonical.js";
import { parseStrictJsonDocument } from "./external-experiment.js";
import { validateLanguageSelectionTreeV1 } from "./experiment-package.js";
import { validatePlannerRecipePolicyV1 } from "./planner-recipe-policy.js";
import { PlannerRecipeIssue } from "./planner-recipe-questionnaires.js";

export const PLANNER_RECIPE_SCHEMA = "affect-research-planner-recipe";
export const PLANNER_RECIPE_VERSION = 1;
export const PLANNER_RECIPE_INTEGRITY_ALGORITHM = "planner-recipe-reproduction-v1";
export const PLANNER_RECIPE_SEGMENTS = Object.freeze(["P1", "P2", "P3", "P4", "P5", "P6"]);
export const MAX_PLANNER_RECIPE_BYTES = 16 * 1024 * 1024;
export const MAX_PLANNER_RECIPE_CASES = 25_000;
export const MAX_PLANNER_RECIPE_DEPTH = 64;
const CORE_KEYS = ["schema", "version", "recipeId", "presentationTarget", "policy", "segments"];
const HASH = /^[a-f0-9]{64}$/u;
const encoder = new TextEncoder();

export function exactRecipeObject(value, fields, label) {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
    throw new TypeError(`${label} contains missing or unknown fields.`);
  }
  return value;
}

export function freezeRecipeValue(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeRecipeValue(child);
    Object.freeze(value);
  }
  return value;
}

/** Bound depth before calling the recursive strict JSON/key scanner. */
function assertDepth(text) {
  let depth = 0, quoted = false, escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "{" || character === "[") {
      if (++depth > MAX_PLANNER_RECIPE_DEPTH) throw new RangeError("Planner recipe JSON is nested too deeply.");
    } else if (character === "}" || character === "]") depth -= 1;
  }
}

/** Syntax/canonical transport check only. The public reader must additionally
 * validate every owner, cross-reference and reproduction hash before adoption. */
export function readPlannerRecipeJsonBytes(input) {
  if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > MAX_PLANNER_RECIPE_BYTES) {
    throw new RangeError("A Planner recipe must contain between 1 byte and 16 MiB of UTF-8 JSON.");
  }
  const bytes = input.slice();
  const sourceText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assertDepth(sourceText);
  const value = parseStrictJsonDocument(sourceText);
  const canonicalSourceText = `${canonicalJson(value)}\n`;
  const canonicalBytes = encoder.encode(canonicalSourceText);
  if (canonicalBytes.byteLength !== bytes.byteLength || bytes.some((byte, index) => byte !== canonicalBytes[index])) {
    throw new TypeError("A Planner recipe requires exact canonical UTF-8 JSON with one trailing LF.");
  }
  return { value, canonicalSourceText };
}

/** Validate the complete root and inclusion choices before any domain work.
 * Segment payload validation remains exclusively with its domain owner. */
export function validatePlannerRecipeStructureV1(value, { integrity = true } = {}) {
  exactRecipeObject(value, integrity ? [...CORE_KEYS, "integrity"] : CORE_KEYS, "Planner recipe");
  if (value.schema !== PLANNER_RECIPE_SCHEMA || value.version !== PLANNER_RECIPE_VERSION) {
    throw new TypeError("Unsupported Planner recipe schema or version.");
  }
  if (typeof value.recipeId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(value.recipeId)) {
    throw new TypeError("Planner recipe ID must contain 1–128 lowercase letters, digits, underscores or hyphens.");
  }
  if (!["desktop-screen", "webxr-immersive-vr"].includes(value.presentationTarget)) {
    throw new PlannerRecipeIssue("P7", "presentationTarget", "target-required", "Choose an explicit presentation target.");
  }
  validatePlannerRecipePolicyV1(value.policy);
  exactRecipeObject(value.segments, PLANNER_RECIPE_SEGMENTS, "Planner recipe segments");
  for (const segment of PLANNER_RECIPE_SEGMENTS) {
    const payload = value.segments[segment];
    if (!payload || typeof payload !== "object" || Object.getPrototypeOf(payload) !== Object.prototype) {
      throw new PlannerRecipeIssue(segment, `segments.${segment}`, "contribution-missing", "The recipe requires this section's complete accepted content.");
    }
  }
  const selection = value.segments.P6;
  if (selection.status === "excluded") exactRecipeObject(selection, ["status"], "Excluded XR layout");
  else if (selection.status === "included") {
    exactRecipeObject(selection, ["status", "profile"], "Included XR layout");
    if (!selection.profile || typeof selection.profile !== "object" || Array.isArray(selection.profile)) {
      throw new PlannerRecipeIssue("P6", "segments.P6.profile", "profile-missing", "Include the complete XR layout profile.");
    }
  } else throw new PlannerRecipeIssue("P6", "segments.P6.status", "selection-required", "Explicitly include or exclude the XR layout.");
  if ((selection.status === "included") !== (value.presentationTarget === "webxr-immersive-vr")) {
    throw new PlannerRecipeIssue("P6", "presentationTarget", "target-mismatch", "XR inclusion must match the explicit presentation target.");
  }
  if (integrity) {
    exactRecipeObject(value.integrity, ["algorithmVersion", "definitionSha256", "segmentSha256", "reproductionSha256"], "Planner recipe integrity");
    if (value.integrity.algorithmVersion !== PLANNER_RECIPE_INTEGRITY_ALGORITHM) throw new TypeError("Unsupported Planner recipe integrity algorithm.");
    exactRecipeObject(value.integrity.segmentSha256, PLANNER_RECIPE_SEGMENTS, "Planner segment hashes");
    for (const digest of [value.integrity.definitionSha256, value.integrity.reproductionSha256, ...Object.values(value.integrity.segmentSha256)]) {
      if (typeof digest !== "string" || !HASH.test(digest)) throw new TypeError("Planner recipe integrity requires complete lowercase SHA-256 values.");
    }
  }
  return value;
}

/** Count terminal paths in the owner's strict rooted language tree before
 * route/matrix allocation; do not infer a language from the current UI. */
export function boundPlannerRecipeMatrix(languageSelection, variantCount, presentationCount) {
  if (!Number.isSafeInteger(variantCount) || variantCount < 1 || variantCount > 64
    || !Number.isSafeInteger(presentationCount) || presentationCount < 1 || presentationCount > 2) {
    throw new RangeError("Planner reproduction requires 1–64 variants and 1–2 authored presentation profiles.");
  }
  const tree = validateLanguageSelectionTreeV1(languageSelection);
  const nodes = new Map(tree.nodes.map(node => [node.nodeId, node])), counts = new Map();
  const maximum = Math.floor(MAX_PLANNER_RECIPE_CASES / variantCount / presentationCount);
  const count = id => {
    if (counts.has(id)) return counts.get(id);
    let total = 0;
    for (const option of nodes.get(id).options) {
      total += option.target.kind === "language" ? 1 : count(option.target.nodeId);
      if (total > maximum) throw new RangeError(`Planner variant × language path × presentation matrix exceeds ${MAX_PLANNER_RECIPE_CASES} cases.`);
    }
    counts.set(id, total);
    return total;
  };
  const routeCount = count(tree.rootNodeId);
  return Object.freeze({ routeCount, variantCount, presentationCount, caseCount: routeCount * variantCount * presentationCount });
}
