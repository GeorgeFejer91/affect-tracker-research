import { Model, Version, lintSurvey } from "./vendor/surveyjs-core.js";

export const SURVEYJS_ENGINE_VERSION = "3.0.4";
export const SURVEYJS_COMPLETION_POLICY = "allVisibleQuestions";
export const SURVEYJS_MAX_BYTES = 4 * 1024 * 1024;
const passive = new Set(["html", "image", "expression"]);
const hostProperties = new Set(["choicesByUrl", "navigateToUrl", "navigateToUrlOnCondition", "surveyId", "surveyPostId", "postId", "clientId"]);
const inspected = new Map(); // Bounded, successful definitions only; no answers.
const cloneJson = value => JSON.parse(JSON.stringify(value));
const utf8Length = text => { let bytes = 0; for (const char of text) { const code = char.codePointAt(0); bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; } return bytes; };

/** The same DOM-free SurveyJS code is bundled for the browser and Rust host. */
export function inspectSurveyJson(json) {
  if (Version !== SURVEYJS_ENGINE_VERSION) throw new Error("SurveyJS engine version mismatch.");
  if (!json || Array.isArray(json) || typeof json !== "object") throw new TypeError("Import a SurveyJS questionnaire JSON object.");
  const cacheKey = JSON.stringify(json);
  if (cacheKey.length > SURVEYJS_MAX_BYTES || utf8Length(cacheKey) > SURVEYJS_MAX_BYTES) throw new RangeError("SurveyJS JSON exceeds 4 MiB.");
  if (inspected.has(cacheKey)) return cloneJson(inspected.get(cacheKey));
  let nodes = 0;
  function visit(value, path, depth) {
    if (++nodes > 100000 || depth > 48) throw new RangeError("SurveyJS JSON exceeds the structure limit.");
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new TypeError(`${path}.${key}: unsupported JSON key.`);
      if (key === "name" && ["__proto__", "prototype", "constructor"].includes(child)) throw new TypeError(`${path}.name is reserved.`);
      if (key === "storeDataAsText" && child === false) throw new TypeError(`${path}.storeDataAsText=false requires an external upload service. Use embedded file data.`);
      if (hostProperties.has(key) && child != null && child !== "" && child !== false) {
        throw new TypeError(`${path}.${key} requires an external SurveyJS service. Import a self-contained questionnaire.`);
      }
      visit(child, `${path}.${key}`, depth + 1);
    }
  }
  visit(json, "surveyJson", 0);
  const result = lintSurvey(json);
  const errors = result.findings.filter(f => f.severity === "error");
  if (errors.length) throw new TypeError(errors.slice(0, 8).map(f => `${f.path}: ${f.message}`).join("\n"));
  const model = new Model(json);
  try {
    if (model.jsonErrors?.length) throw new TypeError(model.jsonErrors.map(e => e.message ?? e.text ?? String(e)).join("\n"));
    if (!model.getAllQuestions().length) throw new TypeError("The SurveyJS JSON contains no questions.");
    if (model.getAllQuestions(false, false, true).length > 2048) throw new RangeError("A questionnaire may contain at most 2048 questions.");
    const summary = { questionCount: model.getAllQuestions().length, pageCount: model.pages.length,
      questionTypes: [...new Set(model.getAllQuestions(false, false, true).map(q => q.getType()))],
      warnings: result.findings.filter(f => f.severity !== "error").map(f => ({ path: f.path, message: f.message })) };
    if (inspected.size === 4) inspected.delete(inspected.keys().next().value);
    inspected.set(cacheKey, summary);
    return cloneJson(summary);
  } finally { model.dispose(); }
}

export function applySurveyCompletionPolicy(model) {
  function required(question) {
    if (!passive.has(question.getType()) && !question.readOnly) { question.requiredIf = ""; question.isRequired = true; }
    // SurveyJS performs nested cell/panel validation itself.
    if (question.columns) for (const column of question.columns) if (!column.readOnly) column.isRequired = true;
    if (question.items && question.getType() === "multipletext") for (const item of question.items) item.isRequired = true;
    if (question.getType() === "matrix") question.isAllRowRequired = true;
  }
  for (const question of model.getAllQuestions(false, false, true)) required(question);
  model.onDynamicPanelAdded.add(() => { for (const q of model.getAllQuestions(false, false, true)) required(q); });
  model.onValidateQuestion.add((_, options) => {
    const q = options.question;
    if (!passive.has(q.getType()) && !q.readOnly && q.isVisibleInSurvey && (q.isEmpty() || typeof options.value === "string" && !options.value.trim())) options.error = model.locale === "de" ? "Bitte beantworten Sie diese Frage." : "Please answer this question.";
  });
}

export function surveyRandomSeed(planIdentitySha256, position) { return ((Number.parseInt(planIdentitySha256.slice(0, 8), 16) ^ position) >>> 0) || 1; }
export function createSurveyModel(json, { language = "en", data = {}, randomSeed = 1 } = {}) {
  if (!Number.isSafeInteger(randomSeed) || randomSeed < 1 || randomSeed > 0xffffffff) throw new TypeError("Invalid SurveyJS random seed.");
  const model = new Model();
  model.randomSeed = randomSeed;
  model.fromJSON(json);
  model.locale = language;
  applySurveyCompletionPolicy(model);
  model.data = data;
  return model;
}

export function checkSurveyData(json, options = {}) {
  const evaluatedAtUnixMs = options.evaluatedAtUnixMs ?? Date.now();
  if (!Number.isSafeInteger(evaluatedAtUnixMs) || evaluatedAtUnixMs < 0 || evaluatedAtUnixMs > 8640000000000000) throw new TypeError("Invalid SurveyJS evaluation time.");
  const SystemDate = globalThis.Date;
  function EvaluationDate(...args) { return new.target ? Reflect.construct(SystemDate, args.length ? args : [evaluatedAtUnixMs], new.target) : new SystemDate(evaluatedAtUnixMs).toString(); }
  Object.setPrototypeOf(EvaluationDate, SystemDate); EvaluationDate.prototype = SystemDate.prototype; EvaluationDate.now = () => evaluatedAtUnixMs;
  globalThis.Date = EvaluationDate;
  try { return { ...checkSurveyDataAt(json, options), evaluatedAtUnixMs }; } finally { globalThis.Date = SystemDate; }
}
function checkSurveyDataAt(json, { language = "en", data = {}, complete = false, randomSeed = 1 } = {}) {
  inspectSurveyJson(json);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new TypeError("SurveyJS answers must be an object.");
  let nodes = 0;
  const checkData = (v, depth) => {
    if (++nodes > 100000 || depth > 48) throw new RangeError("SurveyJS answers exceed the structure limit.");
    if (v && typeof v === "object") for (const [key, value] of Object.entries(v)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new TypeError("SurveyJS answers contain a reserved property.");
      checkData(value, depth + 1);
    }
  };
  checkData(data, 0);
  if (utf8Length(JSON.stringify(data)) > SURVEYJS_MAX_BYTES) throw new RangeError("SurveyJS answers exceed 4 MiB.");
  const model = createSurveyModel(json, { language, data, randomSeed });
  try {
    const before = JSON.stringify(model.data);
    model.clearIncorrectValues(true);
    if (JSON.stringify(model.data) !== before) throw new TypeError("SurveyJS answers contain unknown questions or unsupported values.");
    const valid = model.validate(false, false);
    const questions = model.getAllQuestions(false, false, true);
    const errors = questions.flatMap(q => q.errors.map(e => ({ name: q.name, message: e.getText() })));
    if (complete && !valid) throw new TypeError(errors.map(e => `${e.name}: ${e.message}`).join("\n") || "Complete the visible questionnaire before submitting.");
    const visibleQuestionNames = questions.filter(q => q.isVisibleInSurvey).map(q => q.name);
    if (complete && valid) model.doComplete();
    return { valid, data: model.data, pageCount: model.pages.length, visibleQuestionNames, errors };
  } finally { model.dispose(); }
}

/** Existing instruments retain their exact definition, IDs, labels and coding. */
export function surveyJsonFromQuestionnaire(definition) {
  const typed = definition.schema === "affect-research-form-definition";
  return { title: definition.title, locale: definition.language,
    description: definition.instructions ?? "", showQuestionNumbers: "on", showCompletePage: false,
    elements: definition.items.map(item => {
      const response = item.response;
      if (typed && response.kind === "text") return { type: "comment", name: item.itemId, title: item.prompt, isRequired: true, maxLength: response.maxUtf8Bytes };
      if (typed && response.kind === "integer") return { type: "text", inputType: "number", name: item.itemId, title: item.prompt, isRequired: true,
        min: response.min, max: response.max, step: 1, validators: [{ type: "expression", expression: `{${item.itemId}} % 1 = 0` }] };
      return { type: "radiogroup", name: item.itemId, title: item.prompt, isRequired: true,
        choices: (typed ? response.options : item.options).map(o => ({ value: o.optionId, text: o.label })) };
    }) };
}
