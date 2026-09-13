import { surveyElements, surveyElementTitle } from "./surveyjs-builder.js";
import { questionnaireGridColumns, questionnaireGridRows } from "./questionnaire-sheet.js";
const escape = value => String(value ?? "").replace(/[&<>"']/gu, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function surveyBuilderMarkup(entry) {
  const json = entry.sheet.definition.surveyJson, elements = surveyElements(json);
  return `<section class="survey-builder-box" aria-label="Questionnaire element arrangement">
    <div class="survey-builder-heading"><strong>Questionnaire elements</strong><span>${elements.length} elements</span></div>
    <div class="survey-builder-elements" tabindex="0" role="region" aria-label="Arrange and edit added questionnaire elements">
      <ol>${elements.map(({ element, address, index, parent }) => {
        const encoded = escape(JSON.stringify(address)), list = address.slice(0, -1).reduce((value, key) => value[key], json);
        return `<li data-survey-address="${encoded}"><div class="survey-element-description"><label class="field"><span>${escape(element.name)} · ${escape(element.type)} · ${escape(parent)}</span><textarea rows="2" data-survey-title aria-label="Title for ${escape(element.name)}">${escape(surveyElementTitle(element, entry.sheet.language))}</textarea></label>${Array.isArray(element.choices) ? `<details class="survey-element-answers"><summary>Answer labels and codes</summary>${element.choices.map((choice, n) => {
            const id = typeof choice === "object" ? choice.value : choice;
            const label = typeof choice === "object" ? choice.text ?? id : choice;
            const text = typeof label === "object" ? label[entry.sheet.language] ?? label.default ?? id : label;
            return `<div><label>Answer ${n + 1}<input data-survey-choice="${n}" value="${escape(text)}" aria-label="Answer ${n + 1} for ${escape(element.name)}"></label><label>Code<input data-survey-code="${n}" inputmode="decimal" value="${escape(element.affectResearchResponseCodes?.[id] ?? "")}" aria-label="Code ${n + 1} for ${escape(element.name)}"></label></div>`;
          }).join("")}</details>` : ""}</div>
          <div class="survey-element-controls"><button type="button" data-survey-arrange="up" ${index === 0 ? "disabled" : ""} aria-label="Move ${escape(element.name)} up">↑</button><button type="button" data-survey-arrange="down" ${index === list.length - 1 ? "disabled" : ""} aria-label="Move ${escape(element.name)} down">↓</button>
          <label>Row<select data-survey-row aria-label="Row placement for ${escape(element.name)}"><option value="new" ${element.startWithNewLine !== false ? "selected" : ""}>New row</option><option value="beside" ${element.startWithNewLine === false ? "selected" : ""}>Beside previous</option></select></label>
          ${Array.isArray(json.pages) && address.length === 4 ? `<label>Page<select data-survey-page aria-label="Page for ${escape(element.name)}">${json.pages.map((p, n) => `<option value="${n}" ${address[1] === n ? "selected" : ""}>${n + 1}</option>`).join("")}</select></label>` : ""}
          <button type="button" data-survey-arrange="remove" aria-label="Remove ${escape(element.name)}">Remove</button></div></li>`;
      }).join("")}</ol>
    </div>
    <div class="sheet-actions"><button type="button" data-sheet-action="survey-add-choice">Add choice item</button><button type="button" data-sheet-action="survey-add-text">Add text field</button><button type="button" data-sheet-action="survey-add-number">Add number field</button><button type="button" data-sheet-action="survey-add-page">Add page</button><button type="button" data-sheet-action="survey-excel">Paste items from Excel</button></div>
    ${entry.builderPaste ? pasteMarkup(entry) : ""}
    <div class="survey-builder-footer"><button type="button" data-sheet-action="preview">Participant preview</button></div>
  </section>`;
}

function pasteMarkup(entry) {
  const sheet = entry.builderPaste, columns = questionnaireGridColumns(sheet, "labels-and-codes");
  return `<div class="survey-builder-paste"><p class="field-help">Paste an item table into a cell, then add the items to this questionnaire. Answer labels and numeric codes are retained.</p>
    <div class="sheet-table-scroll" tabindex="0" role="region" aria-label="Excel item import table"><table class="sheet-table"><thead><tr>${columns.map(name => `<th scope="col">${escape(name)}</th>`).join("")}</tr></thead><tbody>${questionnaireGridRows(sheet, "labels-and-codes").map((row, i) => `<tr>${row.map((value, col) => `<td><textarea rows="2" data-survey-paste-cell="${i}:${col}" aria-label="Imported item ${i + 1}, ${escape(columns[col])}">${escape(value)}</textarea></td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="sheet-actions"><button type="button" data-sheet-action="survey-append-items">Add pasted items</button><button type="button" data-sheet-action="survey-cancel-paste">Cancel paste</button></div></div>`;
}
