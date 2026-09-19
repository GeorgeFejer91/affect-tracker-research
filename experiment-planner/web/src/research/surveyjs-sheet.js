import { canonicalJson, canonicalSha256, sha256Hex } from "./canonical.js";
import { SURVEYJS_DEFINITION_SCHEMA, validateSurveyDefinition, verifySurveyDefinition } from "./surveyjs-definition.js";
import { inspectSurveyJson } from "./surveyjs-engine.js";
import { questionnaireFamilyId } from "./questionnaire-assets.js";
import { refreshSurveySource } from "./surveyjs-builder.js";
import { surveyBuilderMarkup } from "./surveyjs-builder-view.js";

export const isSurveySheet = sheet => sheet?.kind === "surveyjs";
export function surveySheetFromDefinition(definition, { familyId } = {}) {
  const d = validateSurveyDefinition(definition);
  const summary = inspectSurveyJson(d.surveyJson);
  return { kind: "surveyjs", familyId, questionnaireId: d.questionnaireId, questionnaireVersion: d.questionnaireVersion,
    language: d.language, title: d.title, definition: d, summary, rows: [{ prompt: d.title }], modified: false };
}
export async function surveySheetToAuthoring(sheet) {
  let definition = { ...structuredClone(sheet.definition), title: sheet.title, questionnaireVersion: sheet.questionnaireVersion };
  if (sheet.modified || definition.source.sha256 === "0".repeat(64)) {
    if (sheet.title !== sheet.definition.title) {
      if (definition.surveyJson.title && typeof definition.surveyJson.title === "object") definition.surveyJson.title[sheet.language] = sheet.title;
      else definition.surveyJson.title = sheet.title;
    }
    definition = await refreshSurveySource(definition);
  }
  definition.definitionSha256 = await canonicalSha256(definition, { omitRootKeys: ["definitionSha256"] });
  await verifySurveyDefinition(definition);
  return { definition, sourceBytes: new TextEncoder().encode(`${canonicalJson(definition)}\n`), sourceFormat: "surveyJsDefinitionV1" };
}
export async function prepareSurveySourceStorage(sourceBytes, definition) {
  const checked = await verifySurveyDefinition(definition);
  const expected = new TextEncoder().encode(`${canonicalJson(checked)}\n`);
  if (!(sourceBytes instanceof Uint8Array) || sourceBytes.length !== expected.length || sourceBytes.some((v, i) => v !== expected[i])) throw new TypeError("SurveyJS storage requires the exact wrapped questionnaire JSON.");
  const bytes = new TextEncoder().encode(`${canonicalJson(checked.surveyJson)}\n`);
  return { familyId: questionnaireFamilyId(checked),
    languageTag: checked.language, format: "json", sourceSha256: await sha256Hex(bytes), bytes };
}

const escape = value => String(value ?? "").replace(/[&<>"']/gu, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function surveyEntryMarkup({ family, language, key, entry }, index, context, status) {
  const s = entry.sheet;
  return `<details class="questionnaire-sheet" data-sheet-key="${escape(key)}" ${entry.open ? "open" : ""}>
    <summary><span class="sheet-heading"><strong>${escape(s.title)}</strong><span>${escape(language.label)} · ${s.summary.questionCount} questions · SurveyJS</span></span><span class="sheet-save-state">${escape(status)}</span></summary>
    <fieldset class="sheet-body" ${context.locked || entry.busy ? "disabled" : ""}><legend class="sr-only">${escape(family.label)} in ${escape(language.label)}</legend>
    <p class="field-help">${s.summary.pageCount} pages · ${s.summary.questionTypes.map(escape).join(", ")}. Saved as a SurveyJS file in the questionnaire assets folder.</p>
    <p class="sheet-error" role="status" aria-live="polite">${escape(entry.error)}</p>
    <div class="sheet-settings"><label class="field"><span>Questionnaire title</span><input data-sheet-meta="title" value="${escape(s.title)}" maxlength="500"></label><label class="field"><span>Questionnaire version</span><input data-sheet-meta="questionnaireVersion" value="${escape(s.questionnaireVersion)}" maxlength="120"></label></div>
    ${surveyBuilderMarkup(entry)}
    <div class="sheet-actions"><button type="button" data-sheet-action="upload">Import replacement JSON</button><button type="button" data-sheet-action="survey-paste">Paste SurveyJS JSON</button><button type="button" data-sheet-action="survey-export">Download SurveyJS JSON</button><button type="button" data-sheet-action="undo" ${entry.undo ? "" : "disabled"}>Undo edit</button></div>
    <details class="sheet-options"><summary>Advanced import details</summary><p class="field-help">Source: ${escape(s.definition.source.basename)}</p><button type="button" data-sheet-action="survey-builder">Open full SurveyJS builder</button>${s.summary.warnings.map(w => `<p class="field-help">${escape(w.message)}</p>`).join("")}</details>
    <div class="sheet-actions"><button type="button" data-sheet-action="save" class="primary-action" ${!entry.dirty ? "disabled" : ""}>Save questionnaire</button></div>
    <div class="sheet-family-actions"><button type="button" data-sheet-action="move-up" ${index < context.languages.length ? "disabled" : ""}>Move questionnaire up</button><button type="button" data-sheet-action="move-down" ${index >= (context.families.length - 1) * context.languages.length ? "disabled" : ""}>Move questionnaire down</button><button type="button" data-sheet-action="remove">Remove questionnaire (all languages)</button></div>
    </fieldset></details>`;
}
