import { canonicalJson, sha256Hex } from "./canonical.js";
import { inspectSurveyJson, SURVEYJS_ENGINE_VERSION, SURVEYJS_COMPLETION_POLICY } from "./surveyjs-engine.js";
import { SURVEYJS_DEFINITION_SCHEMA } from "./surveyjs-definition.js";
import { legacySurveyPresentation } from "./surveyjs-legacy-presentation.js";

/** Conversion is explicit authoring, never historical-file migration. Source
 * identity/coding remain in the raw JSON alongside standard SurveyJS elements. */
export function surveyDraftFromDefinition(definition, { repeatLabelsEvery = 1 } = {}) {
  if (definition.schema === SURVEYJS_DEFINITION_SCHEMA) return structuredClone(definition);
  const json = legacySurveyPresentation(definition, { repeatLabelsEvery }).json;
  for (const element of json.elements) {
    const item = definition.items.find(item => item.itemId === element.name);
    if (item?.options) element.affectResearchResponseCodes = Object.fromEntries(item.options.map(option => [option.optionId, option.scoreValue]));
    if (item?.response?.kind === "text") element.affectResearchUtf8Limit = item.response.maxUtf8Bytes;
  }
  json.affectResearch = { schema: "affect-research-survey-instrument", version: 1,
    sourceDefinitionSha256: definition.definitionSha256,
    questionnaireId: definition.questionnaireId, questionnaireVersion: definition.questionnaireVersion,
    provenance: structuredClone(definition.provenance ?? null), source: structuredClone(definition.source ?? null),
    items: definition.items.map(item => ({ itemId: item.itemId, originalOrder: item.order,
      prompt: item.prompt, subscale: item.subscale ?? null, required: item.required,
      ...(item.response ? { response: structuredClone(item.response) } : { options: structuredClone(item.options) }) })) };
  return { schema: SURVEYJS_DEFINITION_SCHEMA, version: 1, questionnaireId: definition.questionnaireId,
    questionnaireVersion: definition.questionnaireVersion, title: definition.title, language: definition.language,
    engineVersion: SURVEYJS_ENGINE_VERSION, completionPolicy: SURVEYJS_COMPLETION_POLICY,
    source: { kind: "researcherJson", basename: `${definition.questionnaireId}.survey.json`, sha256: "0".repeat(64) },
    surveyJson: json, definitionSha256: "0".repeat(64) };
}

export async function refreshSurveySource(definition) {
  const value = structuredClone(definition);
  value.source = { kind: "researcherJson", basename: `${value.questionnaireId}.survey.json`,
    sha256: await sha256Hex(new TextEncoder().encode(`${canonicalJson(value.surveyJson)}\n`)) };
  return value;
}

export function surveyElements(json) {
  const result = [];
  function visit(list, page, parent, path) {
    (list ?? []).forEach((element, index) => {
      const address = [...path, index];
      result.push({ element, page, parent, index, address, depth: (address.length - 1) / 2 });
      if (Array.isArray(element.elements)) visit(element.elements, page, element.name, [...address, "elements"]);
    });
  }
  if (Array.isArray(json.pages)) json.pages.forEach((page, index) => visit(page.elements, index, page.name ?? `page-${index + 1}`, ["pages", index, "elements"]));
  else visit(json.elements, 0, "questionnaire", ["elements"]);
  return result;
}

const at = (root, path) => path.reduce((value, key) => value?.[key], root);
export function changeSurveyElement(json, address, action, value) {
  const next = structuredClone(json), list = at(next, address.slice(0, -1)), index = address.at(-1), item = list?.[index];
  if (!item || !Array.isArray(list)) throw new TypeError("Select an existing questionnaire element.");
  if (action === "up" || action === "down") {
    const destination = index + (action === "up" ? -1 : 1);
    if (destination < 0 || destination >= list.length) throw new TypeError("This element cannot move further in its page or panel.");
    [list[index], list[destination]] = [list[destination], list[index]];
  } else if (action === "remove") list.splice(index, 1);
  else if (action === "title") {
    if (typeof value !== "string" || !value.trim() || value.length > 8000) throw new TypeError("Enter an element title.");
    // Editing the active translation never discards other imported translations.
    if (item.title && typeof item.title === "object") item.title[next.locale ?? "default"] = value;
    else item.title = value;
  } else if (action === "choice") {
    const choice = item.choices?.[value.index];
    if (choice === undefined || typeof value.text !== "string" || !value.text.trim()) throw new TypeError("Enter an answer label.");
    const selected = choice && typeof choice === "object" ? choice : { value: choice };
    if (selected.text && typeof selected.text === "object") selected.text[next.locale ?? "default"] = value.text;
    else selected.text = value.text;
    item.choices[value.index] = selected;
  } else if (action === "code") {
    const choice = item.choices?.[value.index];
    const code = value.text.trim() === "" ? null : Number(value.text);
    if (choice === undefined || code !== null && (!Number.isFinite(code) || Math.abs(code) > 1e9)) throw new TypeError("Response codes must be finite numbers or blank.");
    (item.affectResearchResponseCodes ??= {})[typeof choice === "object" ? choice.value : choice] = code;
  } else if (action === "row") item.startWithNewLine = value !== "beside";
  else if (action === "page") {
    if (!Array.isArray(next.pages) || address.length !== 4 || address[0] !== "pages") throw new TypeError("Move a top-level element between pages.");
    const page = next.pages[Number(value)];
    if (!page) throw new TypeError("Select an existing page.");
    if (Number(value) !== address[1]) { list.splice(index, 1); (page.elements ??= []).push(item); }
  } else throw new TypeError("Unknown questionnaire arrangement action.");
  inspectSurveyJson(next); return next;
}

export function appendSurveyElements(json, elements, { page = 0 } = {}) {
  const next = structuredClone(json);
  const existing = new Set(surveyElements(next).map(item => item.element.name));
  const added = structuredClone(elements);
  // Do not rename imported identifiers: conditions/calculations may refer to them.
  for (const { element } of surveyElements({ elements: added })) {
    if (existing.has(element.name)) throw new TypeError(`An element named ${element.name} is already present. Choose distinct item IDs before adding it.`);
    existing.add(element.name);
  }
  if (Array.isArray(next.pages)) {
    if (!next.pages[page]) throw new TypeError("Select an existing page.");
    (next.pages[page].elements ??= []).push(...added);
  } else (next.elements ??= []).push(...added);
  inspectSurveyJson(next); return next;
}

export function addSurveyPage(json) {
  const next = structuredClone(json);
  if (!Array.isArray(next.pages)) { next.pages = [{ name: "page-1", elements: next.elements ?? [] }]; delete next.elements; }
  let number = next.pages.length + 1;
  while (next.pages.some(page => page.name === `page-${number}`)) number++;
  next.pages.push({ name: `page-${number}`, elements: [] });
  inspectSurveyJson(next); return next;
}

export const surveyElementTitle = (element, language) => typeof element.title === "string" ? element.title : element.title?.[language] ?? element.title?.default ?? element.name;
