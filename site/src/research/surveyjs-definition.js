import { canonicalJson, canonicalSha256, sha256Hex } from "./canonical.js";
import { exactFormObject, verifyP2Definition } from "./form-definition.js";
import { parseStrictJsonDocument } from "./external-experiment.js";
import { inspectSurveyJson, SURVEYJS_ENGINE_VERSION, SURVEYJS_COMPLETION_POLICY, SURVEYJS_MAX_BYTES } from "./surveyjs-engine.js";

export const SURVEYJS_DEFINITION_SCHEMA = "affect-research-surveyjs-definition";
export const SURVEYJS_BUILDER_URL = "https://surveyjs.io/create-free-survey";
const fields = ["schema", "version", "questionnaireId", "questionnaireVersion", "title", "language", "engineVersion", "completionPolicy", "source", "surveyJson", "definitionSha256"];
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
export function validateSurveyDefinition(value) {
  exactFormObject(value, fields, "SurveyJS definition");
  if (value.schema !== SURVEYJS_DEFINITION_SCHEMA || value.version !== 1 || value.engineVersion !== SURVEYJS_ENGINE_VERSION
    || value.completionPolicy !== SURVEYJS_COMPLETION_POLICY) throw new TypeError("Unsupported SurveyJS definition or engine version.");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value.questionnaireId)) throw new TypeError("Invalid questionnaire ID.");
  if (typeof value.language !== "string" || value.language.length > 80 || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(value.language) || value.language.toLowerCase() === "und") throw new TypeError("Choose an explicit questionnaire language.");
  for (const [key, max] of [["title", 500], ["questionnaireVersion", 120]]) if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > max) throw new TypeError(`Invalid SurveyJS ${key}.`);
  exactFormObject(value.source, ["kind", "basename", "sha256"], "SurveyJS source");
  if (value.source.kind !== "researcherJson" || typeof value.source.basename !== "string" || !value.source.basename || value.source.basename.length > 255 || /[/\\\u0000]/u.test(value.source.basename)
    || !hash(value.source.sha256) || !hash(value.definitionSha256)) throw new TypeError("Invalid SurveyJS source identity.");
  if (new TextEncoder().encode(canonicalJson(value)).length > SURVEYJS_MAX_BYTES) throw new RangeError("SurveyJS definition exceeds 4 MiB.");
  inspectSurveyJson(value.surveyJson);
  return structuredClone(value);
}
export async function verifySurveyDefinition(value) {
  const checked = validateSurveyDefinition(value);
  if (await canonicalSha256(checked, { omitRootKeys: ["definitionSha256"] }) !== checked.definitionSha256) throw new TypeError("SurveyJS definition hash does not match.");
  return checked;
}
export async function importSurveyJson(bytes, { questionnaireId, language, title, questionnaireVersion = "1", basename = "questionnaire.json" }) {
  const source = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes);
  if (source.length > SURVEYJS_MAX_BYTES) throw new RangeError("SurveyJS import exceeds 4 MiB.");
  const json = parseStrictJsonDocument(new TextDecoder("utf-8", { fatal: true }).decode(source));
  if (json.schema === SURVEYJS_DEFINITION_SCHEMA) {
    const definition = await verifySurveyDefinition(json);
    if (definition.language !== language || definition.questionnaireId !== questionnaireId) throw new TypeError("Imported questionnaire identity/language does not match this slot.");
    return { definition, sourceBytes: source, sourceFormat: "surveyJsDefinitionV1" };
  }
  inspectSurveyJson(json);
  const localizedTitle = typeof json.title === "string" ? json.title : json.title?.[language] ?? json.title?.default;
  const definition = validateSurveyDefinition({ schema: SURVEYJS_DEFINITION_SCHEMA, version: 1, questionnaireId, questionnaireVersion,
    title: title || localizedTitle || questionnaireId, language, engineVersion: SURVEYJS_ENGINE_VERSION, completionPolicy: SURVEYJS_COMPLETION_POLICY,
    source: { kind: "researcherJson", basename, sha256: await sha256Hex(source) }, surveyJson: json, definitionSha256: "0".repeat(64) });
  definition.definitionSha256 = await canonicalSha256(definition, { omitRootKeys: ["definitionSha256"] });
  return { definition, sourceBytes: source, sourceFormat: "surveyJsDefinitionV1" };
}
export async function verifySurveySupportedDefinition(value) {
  return value?.schema === SURVEYJS_DEFINITION_SCHEMA ? verifySurveyDefinition(value) : verifyP2Definition(value);
}
