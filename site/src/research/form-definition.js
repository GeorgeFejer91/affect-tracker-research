import { canonicalJson, canonicalSha256 } from "./canonical.js";
import { QUESTIONNAIRE_DEFINITION_SCHEMA, verifyQuestionnaireDefinitionV1 } from "./questionnaires.js";

export const FORM_DEFINITION_SCHEMA = "affect-research-form-definition";
const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const SPACE_ONLY = /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/u;
const encoder = new TextEncoder();
export function exactFormObject(value, fields, label = "Form") {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== fields.length
    || fields.some(key => !Object.hasOwn(value, key))) throw new TypeError(`${label} has missing or unknown fields.`);
}
function text(value, maximum, label) {
  if (typeof value !== "string" || !value.isWellFormed() || !value.length || [...value].length > maximum) throw new TypeError(`${label} needs bounded Unicode text.`);
}
function identifier(value) { if (typeof value !== "string" || !ID.test(value)) throw new TypeError("Invalid form identifier."); }
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < min || value > max) throw new TypeError("Form number must be an integer within its declared bounds.");
}
function ordered(values, min, max, idKey, validate) {
  if (!Array.isArray(values) || values.length < min || values.length > max) throw new TypeError("Form list exceeds its bounds.");
  const seen = new Set();
  values.forEach((value, index) => {
    validate(value); identifier(value[idKey]);
    if (seen.has(value[idKey]) || value.order !== index + 1) throw new TypeError("Form identities must be unique and orders must match their array positions.");
    seen.add(value[idKey]);
  });
}
export function validateFormItemV1(item) {
  exactFormObject(item, ["itemId", "order", "prompt", "required", "response"], "Form item");
  identifier(item.itemId); integer(item.order, 1, 256); text(item.prompt, 8000, "Prompt");
  if (typeof item.required !== "boolean") throw new TypeError("Required metadata must be boolean.");
  const r = item.response;
  if (r?.kind === "text") {
    exactFormObject(r, ["kind", "maxUtf8Bytes"]); integer(r.maxUtf8Bytes, 1, 1024);
  } else if (r?.kind === "integer") {
    exactFormObject(r, ["kind", "min", "max", "unit"]);
    integer(r.min, 0, Number.MAX_SAFE_INTEGER); integer(r.max, r.min, Number.MAX_SAFE_INTEGER);
    if (r.unit !== "years") throw new TypeError("Unsupported integer unit.");
  } else if (r?.kind === "singleChoice") {
    exactFormObject(r, ["kind", "options"]);
    ordered(r.options, 1, 256, "optionId", option => {
      exactFormObject(option, ["optionId", "order", "label"]); text(option.label, 2000, "Option label");
    });
  } else throw new TypeError("Unsupported form response kind.");
  return structuredClone(item);
}
/** Strict shape validation; use verifyFormDefinitionV1 at an intake boundary. */
export function validateFormDefinitionV1(value) {
  exactFormObject(value, ["schema", "version", "questionnaireId", "questionnaireVersion", "title", "language", "provenance", "items", "definitionSha256"]);
  if (value.schema !== FORM_DEFINITION_SCHEMA || value.version !== 1) throw new TypeError("Unsupported form definition schema/version.");
  identifier(value.questionnaireId); text(value.questionnaireVersion, 120, "Form version"); text(value.title, 500, "Form title");
  if (typeof value.language !== "string" || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(value.language) || value.language === "und") throw new TypeError("Form needs an explicit language tag.");
  const p = value.provenance;
  exactFormObject(p, ["kind", "sourceId", "sourceVersion", "validationStatus"], "Form provenance");
  if (p.kind !== "projectAuthored" || p.validationStatus !== "notValidated") throw new TypeError("Unsupported form provenance.");
  identifier(p.sourceId); text(p.sourceVersion, 120, "Source version");
  ordered(value.items, 1, 256, "itemId", validateFormItemV1);
  if (typeof value.definitionSha256 !== "string" || !HASH.test(value.definitionSha256)) throw new TypeError("Form requires a lowercase definition SHA-256.");
  if (encoder.encode(canonicalJson(value)).length > 4 * 1024 * 1024) throw new TypeError("Form exceeds 4 MiB.");
  return structuredClone(value);
}
export async function verifyFormDefinitionV1(value) {
  const result = validateFormDefinitionV1(value);
  if (await canonicalSha256(result, { omitRootKeys: ["definitionSha256"] }) !== result.definitionSha256) throw new TypeError("Form definition hash does not match.");
  return result;
}
export async function createFormDefinitionV1(core) {
  exactFormObject(core, ["schema", "version", "questionnaireId", "questionnaireVersion", "title", "language", "provenance", "items"]);
  const value = validateFormDefinitionV1({ ...structuredClone(core), definitionSha256: "0".repeat(64) });
  value.definitionSha256 = await canonicalSha256(value, { omitRootKeys: ["definitionSha256"] });
  return value;
}
export async function verifyP2Definition(value) {
  if (value?.schema === FORM_DEFINITION_SCHEMA && value.version === 1) return verifyFormDefinitionV1(value);
  if (value?.schema === QUESTIONNAIRE_DEFINITION_SCHEMA && value.version === 1) return verifyQuestionnaireDefinitionV1(value);
  throw new TypeError("Unsupported P2 definition schema/version.");
}
/** Client validation has no latency, submission or native storage authority. */
export function validateFormAnswers(definition, answers, { allowPartial = false } = {}) {
  const d = validateFormDefinitionV1(definition);
  if (!Array.isArray(answers) || answers.length > d.items.length) throw new TypeError("Invalid form answer count.");
  const byId = new Map();
  for (const answer of answers) {
    exactFormObject(answer, ["itemId", "value"], "Form answer");
    const item = d.items.find(i => i.itemId === answer.itemId), v = answer.value;
    if (!item || byId.has(answer.itemId) || v?.kind !== item.response.kind) throw new TypeError("Unknown, duplicate or incorrectly typed form answer.");
    if (v.kind === "text") {
      exactFormObject(v, ["kind", "text"]);
      if (typeof v.text !== "string" || !v.text.isWellFormed() || encoder.encode(v.text).length > item.response.maxUtf8Bytes) throw new TypeError("Text answer must contain valid Unicode within the UTF-8 byte limit.");
    } else if (v.kind === "integer") {
      exactFormObject(v, ["kind", "integer"]); integer(v.integer, item.response.min, item.response.max);
    } else {
      exactFormObject(v, ["kind", "optionId"]);
      if (!item.response.options.some(o => o.optionId === v.optionId)) throw new TypeError("Unknown form option.");
    }
    byId.set(answer.itemId, structuredClone(answer));
  }
  const missingRequired = d.items.filter(i => !byId.has(i.itemId)
    || (i.response.kind === "text" && SPACE_ONLY.test(byId.get(i.itemId).value.text))).map(i => i.itemId);
  if (!allowPartial && missingRequired.length) throw new TypeError("Answer every displayed form item before submitting.");
  return { complete: !missingRequired.length, missingRequired, answers: d.items.flatMap(i => byId.has(i.itemId) ? [byId.get(i.itemId)] : []) };
}
