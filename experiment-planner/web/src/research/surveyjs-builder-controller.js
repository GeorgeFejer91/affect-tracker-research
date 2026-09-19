import { surveyDraftFromDefinition, changeSurveyElement, surveyElements, appendSurveyElements, addSurveyPage } from "./surveyjs-builder.js";
import { sheetFromDefinition, sheetToAuthoring } from "./form-sheet.js";
import { createQuestionnaireSheet, cloneQuestionnaireSheet, applyQuestionnaireGridPaste, setQuestionnaireGridCell } from "./questionnaire-sheet.js";

/** Editing adapters only. Save still passes the existing revision fence and
 * native/browser asset store; preview still uses the participant renderer. */
export function createSurveyBuilderController({ render, markChanged, preserveUndo, refreshEntryState, revision, isCurrent }) {
  function install(entry, json) {
    const sheet = sheetFromDefinition({ ...entry.sheet.definition, surveyJson: json }, { familyId: entry.sheet.familyId });
    preserveUndo(entry); entry.sheet = sheet; entry.repeatLabels = 1; entry.error = ""; markChanged(entry);
  }
  function input(target, entry) {
    if (!target.matches("[data-survey-title], [data-survey-choice], [data-survey-code], [data-survey-row], [data-survey-page], [data-survey-paste-cell]")) return false;
    const key = target.dataset.surveyPasteCell ? `paste:${target.dataset.surveyPasteCell}` : `survey:${target.closest('[data-survey-address]')?.dataset.surveyAddress}:${target.hasAttribute("data-survey-title") ? "title" : target.hasAttribute("data-survey-choice") ? "choice" : "code"}:${target.dataset.surveyChoice ?? target.dataset.surveyCode ?? ""}`;
    try {
      if (target.hasAttribute("data-survey-paste-cell")) {
        const candidate = cloneQuestionnaireSheet(entry.builderPaste), [row, column] = target.dataset.surveyPasteCell.split(":").map(Number);
        setQuestionnaireGridCell(candidate, row, column, target.value, "labels-and-codes"); entry.builderPaste = candidate; markChanged(entry);
      } else {
        const address = JSON.parse(target.closest("[data-survey-address]").dataset.surveyAddress);
        const action = target.hasAttribute("data-survey-choice") ? "choice" : target.hasAttribute("data-survey-code") ? "code" : target.hasAttribute("data-survey-title") ? "title" : target.hasAttribute("data-survey-row") ? "row" : "page";
        const value = ["choice", "code"].includes(action) ? { index: Number(target.dataset.surveyChoice ?? target.dataset.surveyCode), text: target.value } : target.value;
        install(entry, changeSurveyElement(entry.sheet.definition.surveyJson, address, action, value));
      }
      entry.invalid.delete(key); target.removeAttribute("aria-invalid");
    } catch (error) { entry.invalid.set(key, target.value); entry.error = error.message; target.setAttribute("aria-invalid", "true"); markChanged(entry); }
    refreshEntryState(target, entry);
    if (target.hasAttribute("data-survey-page")) render();
    return true;
  }
  function paste(event, entry) {
    const cell = event.target.closest("[data-survey-paste-cell]");
    if (!cell || !entry?.builderPaste) return false;
    event.preventDefault(); event.stopPropagation();
    try {
      const candidate = cloneQuestionnaireSheet(entry.builderPaste), [row, column] = cell.dataset.surveyPasteCell.split(":").map(Number);
      applyQuestionnaireGridPaste(candidate, event.clipboardData.getData("text/plain"), { row, column, layout: "labels-and-codes" });
      entry.builderPaste = candidate; entry.error = ""; entry.invalid.clear(); markChanged(entry);
    } catch (error) { entry.error = error.message; }
    render(); return true;
  }
  function arrange(button, entry) {
    if (!button || !entry) return false;
    try {
      if (entry.invalid.size) throw new TypeError("Correct highlighted values before arranging elements.");
      const address = JSON.parse(button.closest("[data-survey-address]").dataset.surveyAddress);
      install(entry, changeSurveyElement(entry.sheet.definition.surveyJson, address, button.dataset.surveyArrange));
    } catch (error) { entry.error = error.message; }
    render(); return true;
  }
  async function action(entry, action) {
    if (!["survey-arrange", "survey-excel", "survey-append-items", "survey-cancel-paste", "survey-add-choice", "survey-add-text", "survey-add-number", "survey-add-page"].includes(action)) return false;
    const generation = revision();
    const current = () => { if (!isCurrent(entry) || revision() !== generation) throw new Error("The questionnaire changed during preparation. Try again."); };
    if (action === "survey-cancel-paste") { entry.builderPaste = null; entry.invalid.clear(); entry.error = ""; markChanged(entry); render(); return true; }
    if (entry.invalid.size || entry.rawOptionCount !== null) throw new TypeError("Correct highlighted cells before arranging elements.");
    if (action === "survey-arrange") {
      const compiled = await sheetToAuthoring(entry.sheet); current();
      preserveUndo(entry); entry.sheet = sheetFromDefinition(surveyDraftFromDefinition(compiled.definition, { repeatLabelsEvery: entry.repeatLabels }), { familyId: entry.sheet.familyId });
      entry.repeatLabels = 1; markChanged(entry);
    } else if (action === "survey-excel") {
      entry.builderPaste ??= createQuestionnaireSheet({ familyId: "pasted-items", language: entry.sheet.language, title: "Pasted items", optionCount: entry.sheet.familyId === "maia-2" ? 6 : 5, rowCount: 1 });
      markChanged(entry);
    } else if (action === "survey-append-items") {
      const compiled = await sheetToAuthoring(entry.builderPaste); current();
      const added = surveyDraftFromDefinition(compiled.definition);
      const existing = new Set(surveyElements(entry.sheet.definition.surveyJson).map(item => item.element.name));
      for (const [index, element] of added.surveyJson.elements.entries()) {
        const original = element.name; let serial = 1;
        while (existing.has(element.name)) element.name = `${original}-paste-${serial++}`;
        existing.add(element.name); added.surveyJson.affectResearch.items[index].elementName = element.name;
      }
      const json = appendSurveyElements(entry.sheet.definition.surveyJson, added.surveyJson.elements);
      // Preserve the source coding for appended items alongside their stable names.
      json.affectResearchSources = [...(json.affectResearchSources ?? []), added.surveyJson.affectResearch];
      install(entry, json); entry.builderPaste = null;
    } else if (action === "survey-add-page") install(entry, addSurveyPage(entry.sheet.definition.surveyJson));
    else {
      const existing = new Set(surveyElements(entry.sheet.definition.surveyJson).map(item => item.element.name));
      let number = 1; while (existing.has(`item-${number}`)) number++;
      const name = `item-${number}`, element = { name, title: "New question", isRequired: true,
        ...(action === "survey-add-choice" ? { type: "radiogroup", choices: [{ value: "option-1", text: "First answer" }, { value: "option-2", text: "Second answer" }] }
          : action === "survey-add-text" ? { type: "comment" } : { type: "text", inputType: "number" }) };
      install(entry, appendSurveyElements(entry.sheet.definition.surveyJson, [element]));
    }
    render(); return true;
  }
  return { input, paste, arrange, action };
}
