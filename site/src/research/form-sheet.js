import { canonicalJson } from "./canonical.js";
import { FORM_DEFINITION_SCHEMA, createFormDefinitionV1, validateFormDefinitionV1, exactFormObject } from "./form-definition.js";
import { cloneQuestionnaireSheet as cloneLegacy, sheetFromDefinition as fromLegacy, sheetToAuthoring as toLegacy } from "./questionnaire-sheet.js";

export const isFormSheet = sheet => sheet?.kind === "form";
export function formDraft(sheet, invalid = []) {
  const value = { kind: "form", familyId: sheet.familyId, language: sheet.language, questionnaireId: sheet.questionnaireId,
    questionnaireVersion: sheet.questionnaireVersion, title: sheet.title, provenance: structuredClone(sheet.provenance), items: structuredClone(sheet.rows) };
  for (const [key, raw] of invalid) {
    const [row, property, option] = key.split(":"), item = value.items[Number(row)];
    if (["title", "questionnaireVersion"].includes(key)) value[key] = raw;
    else if (item && ["prompt", "required"].includes(property)) item[property] = raw;
    else if (item && ["maxUtf8Bytes", "min", "max"].includes(property)) item.response[property] = raw;
    else if (item?.response.options?.[Number(option)] && ["optionId", "label"].includes(property)) item.response.options[Number(option)][property] = raw;
  }
  return value;
}
export function formSheetFromDraft(value) {
  exactFormObject(value, ["kind", "familyId", "language", "questionnaireId", "questionnaireVersion", "title", "provenance", "items"], "Form draft");
  if (value.kind !== "form" || typeof value.familyId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(value.familyId)) throw new TypeError("Invalid form family.");
  const { kind, familyId, items, ...metadata } = structuredClone(value);
  validateFormDefinitionV1({ schema: FORM_DEFINITION_SCHEMA, version: 1, ...metadata, items, definitionSha256: "0".repeat(64) });
  return { kind, familyId, ...metadata, rows: items, modified: true };
}
export function sheetFromDefinition(definition, options = {}) {
  if (definition.schema !== FORM_DEFINITION_SCHEMA) return fromLegacy(definition, options);
  const d = validateFormDefinitionV1(definition);
  return formSheetFromDraft({ kind: "form", familyId: options.familyId, language: d.language, questionnaireId: d.questionnaireId,
    questionnaireVersion: d.questionnaireVersion, title: d.title, provenance: d.provenance, items: d.items });
}
export function cloneQuestionnaireSheet(sheet) { return isFormSheet(sheet) ? structuredClone(sheet) : cloneLegacy(sheet); }
export async function sheetToAuthoring(sheet) {
  if (!isFormSheet(sheet)) return toLegacy(sheet);
  const { kind, familyId, items, ...metadata } = formDraft(formSheetFromDraft(formDraft(sheet)));
  const definition = await createFormDefinitionV1({ schema: FORM_DEFINITION_SCHEMA, version: 1, ...metadata, items });
  return { definition, sourceBytes: new TextEncoder().encode(`${canonicalJson(definition)}\n`), sourceFormat: "formDefinitionV1" };
}
/** Same bounded mutation used by CLI and actual editor fields. */
export function replaceFormDraft(record, value) {
  const sheet = formSheetFromDraft(value);
  record.dirty ||= canonicalJson(formDraft(record.sheet)) !== canonicalJson(value);
  record.sheet = sheet; record.error = ""; record.invalid = []; record.rawOptionCount = null;
}
