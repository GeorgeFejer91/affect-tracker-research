import { canonicalJson } from "./canonical.js";
import { SURVEYJS_DEFINITION_SCHEMA, SURVEYJS_BUILDER_URL, importSurveyJson } from "./surveyjs-definition.js";
import { isSurveySheet, surveyEntryMarkup } from "./surveyjs-sheet.js";
import { renderSurveyQuestionnaire } from "./surveyjs-view.js";
import { createQuestionnairePresentationV3, validateQuestionnairePresentationV3 } from "./questionnaire-recipe-v2.js";
import { restoreQuestionnaireRecipeContent } from "./questionnaire-recipe-restoration.js";
import { questionnaireFamilyId } from "./questionnaire-assets.js";
import {
  createQuestionnaireSheet,
  applyQuestionnaireGridPaste, setQuestionnaireGridCell, setOptionCount,
  questionnaireGridColumns, questionnaireGridRows, serializeQuestionnaireGrid,
  appendSheetRows, removeSheetRow, reverseSheetRowCodes,
  replaceQuestionnaireSheetDraft,
} from "./questionnaire-sheet.js";
import { cloneQuestionnaireSheet, sheetFromDefinition, sheetToAuthoring, isFormSheet } from "./form-sheet.js";
import { demographicsFormDraft } from "./form-assets.js";
import { FORM_DEFINITION_SCHEMA } from "./form-definition.js";
import { createQuestionnairePresentationV2, validateQuestionnairePresentationV2 } from "./questionnaire-recipe-v2.js";
import { formEntryMarkup, editFormField, moveFormField, changeFormOption } from "./form-sheet-view.js";
import { prepareQuestionnaireSave } from "./questionnaire-save-preparation.js";
import { importQuestionnaireAuthoring } from "./questionnaire-authoring.js";
import { createQuestionnairePresentationV1, validateQuestionnairePresentationV1,
  QUESTIONNAIRE_LABEL_REPETITIONS } from "./questionnaire-recipe.js";

const escape = (value) => String(value ?? "").replace(/[&<>"']/gu, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const keyFor = (familyId, language) => `${familyId}/${language}`;

/** Section 2 presentation owner. Drafts never become run authority until saved. */
export function createQuestionnaireEditor({ root, onChange, onSave, onRemove, onMove, onAdoptImportedFamily }) {
  const container = root.querySelector("#questionnaire-sheet-list");
  const fileInput = root.querySelector("#questionnaire-sheet-file");
  const dialog = root.querySelector("#questionnaire-sheet-preview");
  const entries = new Map();
  let context = { families: [], languages: [], definitions: [], locked: false };
  let uploadKey = null;
  let fingerprint = "";
  let restoreGeneration = 0;
  let previewController = null;
  let surveyImportKey = null;
  dialog?.addEventListener("close", () => { previewController?.destroy(); previewController = null; });

  function makeEntry(family, language, restoredSheet = null) {
    const sheet = restoredSheet ?? (family.id === "demographics" ? sheetFromDefinition(demographicsFormDraft(language.languageTag), { familyId: family.id }) : createQuestionnaireSheet({ familyId: family.id, language: language.languageTag,
      title: family.label, optionCount: family.id === "maia-2" ? 6 : 5,
      rowCount: family.id === "tas-20" ? 20 : 5 }));
    return { sheet, dirty: true, pristine: true, busy: false, error: "", invalid: new Map(), open: false,
      repeatLabels: 1, rawOptionCount: null, optionsOpen: false, metadataOpen: false, metadataItem: 0, layout: "labels-and-codes", selection: null, presetToken: Symbol("questionnaire-slot"),
      sourceDefinitionHash: null, sourceBytes: null, authoringResult: null, undo: null };
  }

  function activeEntries() {
    return context.families.flatMap((family) => context.languages.map((language) => ({
      family, language, key: keyFor(family.id, language.languageTag),
      entry: entries.get(keyFor(family.id, language.languageTag)),
    })));
  }

  function sync(next) {
    restoreGeneration++;
    context = next;
    const activeKeys = new Set(next.families.flatMap((family) => next.languages
      .map((language) => keyFor(family.id, language.languageTag))));
    for (const key of entries.keys()) {
      if (!activeKeys.has(key)) entries.delete(key);
    }
    if (!activeKeys.has(uploadKey)) uploadKey = null;
    const nextFingerprint = JSON.stringify({ ...next, definitions: next.definitions.map((d) => d.definitionSha256) });
    for (const family of next.families) {
      for (const language of next.languages) {
        const key = keyFor(family.id, language.languageTag);
        const definition = next.definitions.find((d) => d.language === language.languageTag
          && next.familyForDefinition(d) === family.id);
        if (!entries.has(key)) {
          const entry = makeEntry(family, language);
          entry.open = entries.size === 0;
          entries.set(key, entry);
        }
        const entry = entries.get(key);
        if (definition && !entry.busy && (next.locked || entry.pristine || !entry.dirty)
          && entry.sourceDefinitionHash !== definition.definitionSha256) {
          entry.sheet = sheetFromDefinition(definition, { familyId: family.id });
          entry.sourceDefinitionHash = definition.definitionSha256;
          entry.dirty = false;
          entry.pristine = false;
          entry.error = "";
          entry.invalid.clear();
          entry.rawOptionCount = null;
        }
      }
    }
    if (nextFingerprint !== fingerprint) {
      fingerprint = nextFingerprint;
      render();
    }
  }

  function status(entry) {
    if (entry.busy) return "Saving…";
    if (entry.error || entry.invalid.size) return "Needs attention";
    if (entry.dirty) return entry.sheet.rows.some((row) => row.prompt.trim()) ? "Unsaved changes" : "Add items";
    return "Saved";
  }

  function rowMarkup(entry, row, index) {
    const columns = questionnaireGridColumns(entry.sheet, entry.layout);
    const values = questionnaireGridRows({ ...entry.sheet, rows: [row] }, entry.layout)[0];
    const cells = values.map((value, column) => {
      const key = `${index}:${column}`;
      const displayed = entry.invalid.has(key) ? entry.invalid.get(key) : value;
      const required = column === columns.length - 1;
      const label = column > 0 && !required && entry.layout === "labels-and-codes" && column % 2 === 1;
      const optionIndex = entry.layout === "codes-only" ? column - 1 : Math.floor((column - 1) / 2);
      if (column > 0 && !required && optionIndex >= row.options.length) return '<td aria-label="No option for this item">—</td>';
      return `<td class="${column === 0 ? "sheet-prompt-cell" : label ? "sheet-answer-cell" : "sheet-code-cell"}"><textarea rows="2" data-sheet-cell="${key}" aria-label="Item ${index + 1}, ${escape(columns[column])}" ${!label && column > 0 && !required ? 'inputmode="decimal"' : ""} ${entry.invalid.has(key) ? 'aria-invalid="true"' : ""}>${escape(displayed)}</textarea></td>`;
    }).join("");
    return `<tr><th scope="row">${index + 1}</th>
      ${cells}
      <td class="sheet-row-actions"><button type="button" data-sheet-action="reverse" data-row="${index}" aria-label="Reverse recorded values for item ${index + 1}" title="Reverse recorded values">⇄</button><button type="button" data-sheet-action="delete-row" data-row="${index}" aria-label="Delete item ${index + 1}" title="Delete item">×</button></td></tr>`;
  }

  function entryMarkup({ family, language, key, entry }, index) {
    if (isSurveySheet(entry.sheet)) return surveyEntryMarkup({ family, language, key, entry }, index, context, status(entry));
    if (isFormSheet(entry.sheet)) return formEntryMarkup({ family, language, key, entry }, index, context, status(entry));
    const sheet = entry.sheet;
    return `<details class="questionnaire-sheet" data-sheet-key="${escape(key)}" ${entry.open ? "open" : ""}>
      <summary><span class="sheet-heading"><strong>${escape(sheet.title || family.label)}</strong><span>${escape(language.label)} · ${sheet.rows.filter((r) => r.prompt.trim()).length} items</span></span><span class="sheet-save-state">${status(entry)}</span><svg class="sheet-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></summary>
      <fieldset class="sheet-body" ${context.locked || entry.busy ? "disabled" : ""}>
        <legend class="sr-only">Edit ${escape(family.label)} in ${escape(language.label)}</legend>
        <div class="sheet-settings">
          <label class="field"><span>Answer options</span><input type="number" min="2" max="64" step="1" data-sheet-option-count value="${escape(entry.rawOptionCount ?? sheet.optionCount)}"></label>
          <label class="field"><span>Table columns</span><select data-sheet-layout><option value="labels-and-codes" ${entry.layout === "labels-and-codes" ? "selected" : ""}>Items, answer labels and codes</option><option value="codes-only" ${entry.layout === "codes-only" ? "selected" : ""}>Items and codes only</option></select></label>
        </div>
        <p class="sheet-paste-help">Paste cells from Excel for a basic questionnaire, or import a complete SurveyJS form.</p>
        <div class="sheet-actions"><button type="button" data-sheet-action="survey-builder">Open SurveyJS builder</button><button type="button" data-sheet-action="survey-upload">Import SurveyJS JSON</button><button type="button" data-sheet-action="survey-paste">Paste SurveyJS JSON</button></div>
        <p class="sheet-error" role="status" aria-live="polite">${escape(entry.error)}</p>
        <div class="sheet-table-scroll" tabindex="0" role="region" aria-label="${escape(family.label)} ${escape(language.label)} questionnaire table">
          <table class="sheet-table"><thead><tr><th scope="col">#</th>${questionnaireGridColumns(sheet, entry.layout).map((label) => `<th scope="col">${escape(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Row actions</span></th></tr></thead><tbody>${sheet.rows.map((row, i) => rowMarkup(entry, row, i)).join("")}</tbody></table>
        </div>
        <div class="sheet-actions"><button type="button" data-sheet-action="add-row">Add row</button><button type="button" data-sheet-action="copy-table">Copy whole table</button><button type="button" data-sheet-action="upload">Import file</button><button type="button" data-sheet-action="template">Download table template</button><button type="button" data-sheet-action="undo" ${entry.undo ? "" : "disabled"}>Undo edit</button></div>
        <details class="sheet-options" ${entry.optionsOpen ? "open" : ""}><summary>Questionnaire settings &amp; paste help</summary><div class="sheet-options-content">
          <label class="field"><span>Questionnaire title</span><input type="text" data-sheet-meta="title" value="${escape(sheet.title)}" maxlength="500"></label>
          <label class="field"><span>Questionnaire version</span><input type="text" data-sheet-meta="questionnaireVersion" value="${escape(sheet.questionnaireVersion)}" maxlength="120"></label>
          <label class="field"><span>Instructions for participants</span><textarea data-sheet-meta="instructions" rows="2" maxlength="8000">${escape(sheet.instructions)}</textarea></label>
          <label class="field"><span>Answers for all items</span><select data-sheet-required-all><option value="" selected>No bulk change</option><option value="required">Required</option><option value="optional">Optional</option></select></label>
          <label class="field"><span>Repeat answer labels</span><select data-sheet-repeat><option value="1" ${entry.repeatLabels === 1 ? "selected" : ""}>Above every item</option><option value="5" ${entry.repeatLabels === 5 ? "selected" : ""}>Every 5 items</option><option value="10" ${entry.repeatLabels === 10 ? "selected" : ""}>Every 10 items</option></select></label>
          <p class="field-help">Included in the final recipe. Labels also repeat whenever the answer labels change between items.</p>
          <label class="field"><span>Source / attribution</span><textarea data-sheet-meta="attribution" rows="3" maxlength="12000">${escape(sheet.attribution)}</textarea></label>
          <p class="field-help">Files are kept in this questionnaire’s language folder inside the project’s assets folder.</p>
          <p class="sheet-paste-help">Paste headers into the first cell to replace the whole table and set its option count; without headers, only the pasted range changes. Required accepts true or false. Codes-only leaves answer labels unchanged. Shift-click or Shift+arrow selects a range; Ctrl+C copies it; Ctrl+A selects all cells.</p>
          <p class="sheet-paste-help">Replacement tables retain item identity and subscale only for unambiguous matches. New items receive new identities. The final recipe retains full metadata.</p>
          ${metadataMarkup(entry)}
        </div></details>
        <div class="sheet-footer"><span>Placement is set under questionnaire modules.</span><div class="sheet-actions"><button type="button" data-sheet-action="preview">Preview</button><button type="button" data-sheet-action="save" class="primary-action" ${!entry.dirty ? "disabled" : ""}>Save questionnaire</button></div></div>
        <div class="sheet-family-actions"><button type="button" data-sheet-action="move-up" ${index < context.languages.length ? "disabled" : ""}>Move questionnaire up</button><button type="button" data-sheet-action="move-down" ${index >= (context.families.length - 1) * context.languages.length ? "disabled" : ""}>Move questionnaire down</button><button type="button" data-sheet-action="remove">Remove questionnaire${context.languages.length > 1 ? " (all languages)" : ""}</button></div>
      </fieldset>
    </details>`;
  }

  function metadataMarkup(entry) {
    const rows = entry.sheet.rows;
    const index = Math.min(entry.metadataItem ?? 0, Math.max(0, rows.length - 1)), row = rows[index];
    if (!row) return '<p class="field-help">Add an item to edit its identity and subscale.</p>';
    return `<details class="sheet-options" data-sheet-metadata ${entry.metadataOpen ? "open" : ""}><summary>Item identities, subscales &amp; option order</summary><div class="sheet-options-content">
      <p class="field-help">These identifiers and subscales are researcher metadata, not participant labels. Editing an instrument creates a modified source; no total score is inferred.</p>
      <label class="field"><span>Item to edit</span><select data-sheet-metadata-item>${rows.map((item, i) => `<option value="${i}" ${i === index ? "selected" : ""}>${i + 1}: ${escape(item.itemId)}</option>`).join("")}</select></label>
      <label class="field"><span>Item ID</span><input type="text" data-sheet-item-meta="itemId" data-row="${index}" value="${escape(row.itemId)}" maxlength="128"></label>
      <label class="field"><span>Subscale (blank for none)</span><input type="text" data-sheet-item-meta="subscale" data-row="${index}" value="${escape(row.subscale)}" maxlength="300"></label>
      <div class="sheet-actions"><button type="button" data-sheet-action="item-up" data-row="${index}" ${index === 0 ? "disabled" : ""}>Move item up</button><button type="button" data-sheet-action="item-down" data-row="${index}" ${index === rows.length - 1 ? "disabled" : ""}>Move item down</button></div>
      <div class="sheet-table-scroll" tabindex="0" role="region" aria-label="Item option identities and order"><table class="sheet-table"><thead><tr><th>Option ID</th><th>Participant label</th><th>Option actions</th></tr></thead><tbody>${row.options.map((option, i) => `<tr><td><input type="text" data-sheet-option-id="${i}" data-row="${index}" maxlength="128" value="${escape(option.optionId)}" aria-label="Option ${i + 1} ID"></td><td>${escape(option.label)}</td><td><div class="sheet-actions"><button type="button" data-sheet-action="option-up" data-row="${index}" data-option="${i}" ${i === 0 ? "disabled" : ""}>Move up</button><button type="button" data-sheet-action="option-down" data-row="${index}" data-option="${i}" ${i === row.options.length - 1 ? "disabled" : ""}>Move down</button><button type="button" data-sheet-action="option-remove" data-row="${index}" data-option="${i}" ${row.options.length <= 2 ? "disabled" : ""}>Remove</button></div></td></tr>`).join("")}</tbody></table></div>
      <div class="sheet-actions"><button type="button" data-sheet-action="option-add" data-row="${index}" ${row.options.length >= entry.sheet.optionCount ? "disabled" : ""}>Add option to this item</button></div>
      </div></details>`;
  }

  function editMetadata(entry, change) {
    if (entry.invalid.size || entry.rawOptionCount !== null) throw new TypeError("Correct invalid cells and option count before changing identities or order.");
    const candidate = cloneQuestionnaireSheet(entry.sheet);
    change(candidate);
    const { modified: _modified, ...content } = candidate;
    replaceQuestionnaireSheetDraft(candidate, content);
    preserveUndo(entry); entry.sheet = candidate; entry.error = ""; markChanged(entry);
  }

  function render() {
    if (!container) return;
    const active = activeEntries();
    // A rebuilt table has new cells; never keep an invisible, stale paste target.
    active.forEach(({ entry }) => { entry.selection = null; });
    container.innerHTML = active.length ? active.map(entryMarkup).join("")
      : '<p class="empty-state">No questionnaires yet. Add a blank table or start with MAIA-2.</p>';
    container.querySelectorAll("details[data-sheet-key]").forEach((details) => {
      details.addEventListener("toggle", () => { const entry = entries.get(details.dataset.sheetKey); if (entry) entry.open = details.open; });
      const options = details.querySelector(".sheet-options");
      options?.addEventListener("toggle", () => { const entry = entries.get(details.dataset.sheetKey); if (entry) entry.optionsOpen = options.open; });
      const metadata = details.querySelector("[data-sheet-metadata]");
      metadata?.addEventListener("toggle", () => { const entry = entries.get(details.dataset.sheetKey); if (entry) entry.metadataOpen = metadata.open; });
    });
  }

  function refreshEntryState(element, entry) {
    const details = element.closest("[data-sheet-key]");
    if (!details) return;
    details.querySelector(".sheet-save-state").textContent = status(entry);
    details.querySelector(".sheet-error").textContent = entry.error;
    const save = details.querySelector('[data-sheet-action="save"]');
    save.disabled = entry.busy || !entry.dirty;
    details.querySelector('[data-sheet-action="undo"]').disabled = !entry.undo;
  }

  function markChanged(entry) {
    restoreGeneration++;
    entry.dirty = true;
    entry.pristine = false;
    entry.sheet.modified = true;
    onChange?.();
  }

  function preserveUndo(entry) {
    entry.undo = { sheet: cloneQuestionnaireSheet(entry.sheet), dirty: entry.dirty,
      sourceBytes: entry.sourceBytes, authoringResult: entry.authoringResult,
      sourceDefinitionHash: entry.sourceDefinitionHash, layout: entry.layout, pristine: entry.pristine,
      repeatLabels: entry.repeatLabels, rawOptionCount: entry.rawOptionCount };
  }

  async function save(key, operation = null) {
    const entry = entries.get(key);
    if (!entry || context.locked || entry.busy) {
      if (operation) throw new Error("The questionnaire is missing, locked or already saving.");
      return;
    }
    let sourceReceipt = null;
    try {
      if (entry.invalid.size) throw new TypeError("Correct the highlighted recorded values before saving.");
      if (entry.rawOptionCount !== null) throw new TypeError("Finish a valid answer-option count before saving.");
      restoreGeneration++;
      entry.busy = true;
      entry.error = "";
      render();
      const guard = operation ?? { signal: new AbortController().signal, isCurrent: () => true };
      const prepared = await prepareQuestionnaireSave({ readEntry: () => entries.get(key), isLocked: () => context.locked, busyExpected: true }, guard);
      sourceReceipt = await onSave(prepared.payload, operation ? { isCurrent: prepared.isCurrent, signal: operation.signal } : undefined);
      return prepared.commit(sourceReceipt);
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      if (operation) {
        if (sourceReceipt !== null && sourceReceipt !== undefined) error.sourceReceipt = sourceReceipt;
        throw error;
      }
    } finally {
      entry.busy = false;
      render();
      onChange?.();
    }
  }

  function loadDefinition(definition, { familyId, sourceBytes = null, authoringResult = null, onlyIfPristine = false, expectedPresetToken = null } = {}) {
    const key = keyFor(familyId, definition.language);
    const entry = entries.get(key);
    if (!entry || context.locked || entry.busy || (onlyIfPristine && !entry.pristine)
      || (expectedPresetToken !== null && expectedPresetToken !== entry.presetToken)) return false;
    const prepared = prepareLoadedDefinition(entry, definition, { familyId, sourceBytes, authoringResult });
    installLoadedDefinition(entry, prepared);
    render();
    onChange?.();
    return true;
  }

  function prepareLoadedDefinition(entry, definition, { familyId, sourceBytes, authoringResult }) {
    const candidate = { ...entry };
    preserveUndo(candidate);
    candidate.sheet = sheetFromDefinition(definition, { familyId, authoringResult });
    candidate.sourceBytes = sourceBytes; candidate.authoringResult = authoringResult;
    candidate.invalid = new Map(); candidate.rawOptionCount = null; candidate.error = "";
    candidate.dirty = true; candidate.pristine = false; candidate.open = true;
    return candidate;
  }

  function installLoadedDefinition(entry, prepared) {
    restoreGeneration++;
    Object.assign(entry, prepared);
  }

  async function preview(entry) {
    if (entry.invalid.size) throw new TypeError("Correct the recorded values before previewing.");
    if (entry.rawOptionCount !== null) throw new TypeError("Finish a valid answer-option count before previewing.");
    const { definition } = await sheetToAuthoring(entry.sheet);
    root.querySelector("#questionnaire-sheet-preview-title").textContent = `${definition.title} · ${definition.language}`;
    const body = root.querySelector("#questionnaire-sheet-preview-content");
    previewController?.destroy();
    previewController = renderSurveyQuestionnaire(body, definition, { preview: true, presentation: { repeatLabelsEvery: entry.repeatLabels } });
    dialog.showModal();
  }

  function handleFormInput(target, entry) {
    const key = target.dataset.formField;
    if (!key || !isFormSheet(entry.sheet)) return false;
    preserveUndo(entry);
    try {
      editFormField(entry, key, target.value); entry.invalid.delete(key); target.removeAttribute("aria-invalid");
      entry.error = entry.invalid.size ? "Correct the highlighted form fields." : "";
    } catch (error) { entry.invalid.set(key, target.value); entry.error = error.message; target.setAttribute("aria-invalid", "true"); }
    markChanged(entry); refreshEntryState(target, entry);
    if (key.endsWith(":kind")) render();
    return true;
  }
  container?.addEventListener("input", (event) => {
    restoreGeneration++;
    event.stopPropagation();
    const target = event.target;
    const entry = entries.get(target.closest("[data-sheet-key]")?.dataset.sheetKey);
    if (!entry || entry.busy || context.locked) return;
    if (target.matches("select")) return;
    if (handleFormInput(target, entry)) return;
    if (target.hasAttribute("data-sheet-option-count")) {
      preserveUndo(entry); entry.rawOptionCount = target.value;
      markChanged(entry); refreshEntryState(target, entry); return;
    }
    preserveUndo(entry);
    try {
      if (target.dataset.sheetCell) {
        const [row, column] = target.dataset.sheetCell.split(":").map(Number);
        entry.selection = { anchor: [row, column], end: [row, column] };
        paintSelection(target.closest("[data-sheet-key]"), entry);
        setQuestionnaireGridCell(entry.sheet, row, column, target.value, entry.layout);
        entry.invalid.delete(target.dataset.sheetCell);
        target.removeAttribute("aria-invalid");
      } else if (target.dataset.sheetMeta) entry.sheet[target.dataset.sheetMeta] = target.value;
      else return;
      entry.error = "";
    } catch (error) {
      if (target.dataset.sheetCell) { entry.invalid.set(target.dataset.sheetCell, target.value); target.setAttribute("aria-invalid", "true"); }
      entry.error = error.message;
    }
    markChanged(entry);
    refreshEntryState(target, entry);
  });

  container?.addEventListener("change", (event) => {
    restoreGeneration++;
    event.stopPropagation();
    const target = event.target;
    const entry = entries.get(target.closest("[data-sheet-key]")?.dataset.sheetKey);
    if (!entry || entry.busy || context.locked) return;
    if (target.matches("select") && handleFormInput(target, entry)) return;
    try {
      if (target.hasAttribute("data-sheet-metadata-item")) {
        entry.metadataItem = Number(target.value); render(); return;
      }
      if (target.hasAttribute("data-sheet-item-meta") || target.hasAttribute("data-sheet-option-id")) {
        editMetadata(entry, sheet => {
          const row = sheet.rows[Number(target.dataset.row)];
          if (target.hasAttribute("data-sheet-option-id")) row.options[Number(target.dataset.sheetOptionId)].optionId = target.value;
          else row[target.dataset.sheetItemMeta] = target.dataset.sheetItemMeta === "subscale" && target.value === "" ? null : target.value;
        });
        render(); return;
      }
      if (target.hasAttribute("data-sheet-repeat")) {
        const repeat = Number(target.value);
        if (!QUESTIONNAIRE_LABEL_REPETITIONS.includes(repeat)) throw new TypeError("Repeat answer labels every 1, 5 or 10 items.");
        if (repeat !== entry.repeatLabels) {
          preserveUndo(entry);
          entry.repeatLabels = repeat;
          entry.error = "";
          onChange?.(); // Presentation changes invalidate P7 acceptance, not scientific source content.
          refreshEntryState(target, entry);
        }
        return;
      }
      if (target.hasAttribute("data-sheet-layout")) {
        if (entry.invalid.size) throw new TypeError("Correct highlighted cells before changing table columns.");
        entry.layout = target.value; entry.selection = null; render(); return;
      }
      if (!target.matches("[data-sheet-option-count], [data-sheet-required-all]")) return;
      if (entry.invalid.size) throw new TypeError("Correct the highlighted recorded values first.");
      preserveUndo(entry);
      if (target.hasAttribute("data-sheet-option-count")) {
        entry.rawOptionCount = target.value;
        setOptionCount(entry.sheet, Number(target.value)); entry.rawOptionCount = null;
      }
      if (target.hasAttribute("data-sheet-required-all") && target.value) entry.sheet.rows.forEach((row) => { row.required = target.value === "required"; });
      entry.error = "";
      markChanged(entry);
    } catch (error) { entry.error = error.message; }
    render();
  });

  container?.addEventListener("paste", (event) => {
    restoreGeneration++;
    const target = event.target;
    if (!target.closest(".sheet-table-scroll") || target.closest("[data-sheet-metadata]")) return;
    event.preventDefault();
    event.stopPropagation();
    const entry = entries.get(target.closest("[data-sheet-key]").dataset.sheetKey);
    if (!entry || entry.busy || context.locked) return;
    const selected = entry.selection ? selectionRange(entry) : null;
    const [row, column] = selected ? [selected.top, selected.left] : target.dataset.sheetCell?.split(":").map(Number) ?? [0, 0];
    try {
      if (entry.invalid.size) throw new TypeError("Correct the highlighted recorded values before pasting a range.");
      preserveUndo(entry);
      // Only text supplied by this explicit paste gesture is consumed. Never read the ambient clipboard.
      const result = applyQuestionnaireGridPaste(entry.sheet, event.clipboardData.getData("text/plain"), { row, column, layout: entry.layout });
      entry.layout = result.layout; entry.selection = null;
      entry.error = "";
      markChanged(entry);
    } catch (error) { entry.error = error.message; }
    render();
    container.querySelector(`[data-sheet-key="${keyFor(entry.sheet.familyId, entry.sheet.language)}"] [data-sheet-cell="${row}:${column}"]`)?.focus();
  });

  function selectionRange(entry) {
    const { anchor, end } = entry.selection;
    return { top: Math.min(anchor[0], end[0]), bottom: Math.max(anchor[0], end[0]),
      left: Math.min(anchor[1], end[1]), right: Math.max(anchor[1], end[1]) };
  }

  function paintSelection(details, entry) {
    const range = entry.selection ? selectionRange(entry) : null;
    details.querySelectorAll("[data-sheet-cell]").forEach((cell) => {
      const [r, c] = cell.dataset.sheetCell.split(":").map(Number);
      cell.parentElement.classList.toggle("sheet-cell-selected", Boolean(range && r >= range.top && r <= range.bottom && c >= range.left && c <= range.right));
    });
  }

  container?.addEventListener("click", (event) => {
    const cell = event.target.closest("[data-sheet-cell]");
    if (!cell) return;
    const details = cell.closest("[data-sheet-key]");
    const entry = entries.get(details.dataset.sheetKey);
    const position = cell.dataset.sheetCell.split(":").map(Number);
    entry.selection = { anchor: event.shiftKey && entry.selection ? entry.selection.anchor : position, end: position };
    paintSelection(details, entry);
  });

  container?.addEventListener("keydown", (event) => {
    const cell = event.target.closest("[data-sheet-cell]");
    if (!cell) return;
    const details = cell.closest("[data-sheet-key]");
    const entry = entries.get(details.dataset.sheetKey);
    if (context.locked || entry.busy) return;
    const current = cell.dataset.sheetCell.split(":").map(Number);
    const last = questionnaireGridColumns(entry.sheet, entry.layout).length - 1;
    if (event.key === "Tab") {
      entry.selection = null;
      paintSelection(details, entry);
      return; // Keep normal browser focus navigation and its new paste origin.
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault(); event.stopPropagation();
      entry.selection = { anchor: [0, 0], end: [entry.sheet.rows.length - 1, last] };
    } else if (event.key === "Escape") entry.selection = null;
    else if (((event.shiftKey || event.altKey) && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key))
      || (event.key === "Enter" && !event.shiftKey)) {
      event.preventDefault(); event.stopPropagation();
      const from = event.shiftKey && entry.selection ? entry.selection.end : current;
      const next = [Math.max(0, Math.min(entry.sheet.rows.length - 1, from[0] + (event.key === "ArrowUp" ? -1 : ["ArrowDown", "Enter"].includes(event.key) ? 1 : 0))),
        Math.max(0, Math.min(last, from[1] + (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0)))];
      entry.selection = { anchor: event.shiftKey && entry.selection ? entry.selection.anchor : event.shiftKey ? current : next, end: next };
      details.querySelector(`[data-sheet-cell="${next.join(":")}"]`)?.focus();
    } else return;
    paintSelection(details, entry);
  });

  container?.addEventListener("copy", (event) => {
    const cell = event.target.closest("[data-sheet-cell]");
    if (!cell) return;
    const entry = entries.get(cell.closest("[data-sheet-key]").dataset.sheetKey);
    if (!entry.selection) return;
    const range = selectionRange(entry);
    const multipleCells = range.top !== range.bottom || range.left !== range.right;
    if (!multipleCells && cell.selectionStart !== cell.selectionEnd) return;
    event.preventDefault(); event.stopPropagation();
    try {
      if (entry.invalid.size) throw new TypeError("Correct highlighted cells before copying.");
      event.clipboardData.setData("text/plain", serializeQuestionnaireGrid(entry.sheet, {
        layout: entry.layout, header: false, range,
      }));
    } catch (error) { entry.error = error.message; refreshEntryState(cell, entry); }
  });

  container?.addEventListener("click", async (event) => {
    restoreGeneration++;
    const mover = event.target.closest("button[data-form-move], button[data-form-option]");
    if (mover) {
      event.stopPropagation();
      const entry = entries.get(mover.closest("[data-sheet-key]")?.dataset.sheetKey);
      if (!entry || entry.busy || context.locked) return;
      try {
        if (entry.invalid.size) throw new TypeError("Correct invalid fields before reordering.");
        preserveUndo(entry);
        if (mover.dataset.formOption) changeFormOption(entry, Number(mover.dataset.row), mover.dataset.formOption, Number(mover.dataset.option));
        else moveFormField(entry, Number(mover.dataset.formMove), Number(mover.dataset.direction));
        markChanged(entry);
      } catch (error) { entry.error = error.message; }
      render(); return;
    }
    const button = event.target.closest("button[data-sheet-action]");
    if (!button) return;
    event.stopPropagation();
    const key = button.closest("[data-sheet-key]").dataset.sheetKey;
    const entry = entries.get(key);
    if (!entry || entry.busy || context.locked) return;
    const action = button.dataset.sheetAction;
    try {
      if (action === "survey-builder") {
        const windowObject = root.ownerDocument?.defaultView ?? window;
        if (root.dispatchEvent(new CustomEvent("research:open-surveyjs-builder", { cancelable: true }))) windowObject.open(SURVEYJS_BUILDER_URL, "_blank", "noopener,noreferrer");
        return;
      }
      if (action === "survey-paste") {
        surveyImportKey = key;
        root.querySelector("#questionnaire-survey-json").value = "";
        root.querySelector("#questionnaire-survey-error").textContent = "";
        root.querySelector("#questionnaire-survey-import").showModal();
        root.querySelector("#questionnaire-survey-json").focus(); return;
      }
      if (action === "survey-upload") { uploadKey = key; fileInput.value = ""; fileInput.click(); return; }
      if (action === "survey-export" && isSurveySheet(entry.sheet)) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(entry.sheet.definition.surveyJson, null, 2)], { type: "application/json" }));
        const link = root.ownerDocument.createElement("a"); link.href = url; link.download = `${entry.sheet.questionnaireId}-surveyjs.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); return;
      }
      if (action === "save") { await save(key); return; }
      if (action === "preview") { await preview(entry); return; }
      if (action === "upload") { uploadKey = key; fileInput.value = ""; fileInput.click(); return; }
      if (action === "remove") { onRemove(entry.sheet.familyId); return; }
      if (action.startsWith("move-")) { onMove(entry.sheet.familyId, action === "move-up" ? -1 : 1); return; }
      if (action === "template") {
        const template = createQuestionnaireSheet({ familyId: entry.sheet.familyId, language: entry.sheet.language, optionCount: entry.sheet.optionCount, rowCount: 1 });
        template.rows[0].prompt = "Replace with your questionnaire item";
        const csv = serializeQuestionnaireGrid(template, { layout: entry.layout, delimiter: "," });
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = `${entry.sheet.familyId}-${entry.sheet.language}-table.csv`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); return;
      }
      if (action === "copy-table") {
        if (entry.invalid.size) throw new TypeError("Correct highlighted cells before copying.");
        const text = root.querySelector("#questionnaire-sheet-copy-text");
        text.value = serializeQuestionnaireGrid(entry.sheet, { layout: entry.layout });
        root.querySelector("#questionnaire-sheet-copy").showModal(); text.focus(); text.select(); return;
      }
      if (action === "undo" && entry.undo) {
        Object.assign(entry, entry.undo); entry.undo = null; entry.invalid.clear(); entry.error = "";
        render(); onChange?.(); return;
      }
      if (action.startsWith("item-") || action.startsWith("option-")) {
        const rowIndex = Number(button.dataset.row), optionIndex = Number(button.dataset.option);
        let selected = rowIndex;
        editMetadata(entry, sheet => {
          const row = sheet.rows[rowIndex];
          if (action === "option-add") {
            let suffix = 1; while (row.options.some(o => o.optionId === `option-${suffix}`)) suffix++;
            row.options.push({ optionId: `option-${suffix}`, label: String(row.options.length + 1), scoreValue: null });
          } else if (action === "option-remove") row.options.splice(optionIndex, 1);
          else {
            const list = action.startsWith("item-") ? sheet.rows : row.options;
            const index = action.startsWith("item-") ? rowIndex : optionIndex;
            const next = index + (action.endsWith("-up") ? -1 : 1);
            if (next < 0 || next >= list.length) throw new TypeError("This entry cannot move further.");
            [list[index], list[next]] = [list[next], list[index]];
            if (action.startsWith("item-")) selected = next;
          }
          sheet.optionLabels = Array.from({ length: sheet.optionCount }, (_, i) => sheet.rows.every(r => r.options[i]?.label === sheet.rows[0]?.options[i]?.label) ? sheet.rows[0]?.options[i]?.label ?? null : null);
        });
        entry.metadataItem = selected; render(); return;
      }
      if (entry.invalid.size) throw new TypeError("Correct the highlighted recorded values first.");
      preserveUndo(entry);
      if (action === "add-row") appendSheetRows(entry.sheet);
      if (action === "delete-row") removeSheetRow(entry.sheet, Number(button.dataset.row));
      if (action === "reverse") reverseSheetRowCodes(entry.sheet, Number(button.dataset.row));
      entry.error = "";
      markChanged(entry);
    } catch (error) { entry.error = error.message; }
    render();
  });

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files?.[0]; const entry = entries.get(uploadKey);
    if (!file || !entry || context.locked || entry.busy) return;
    const selectedKey = uploadKey;
    entry.busy = true;
    render();
    try {
      if (file.size > 4 * 1024 * 1024) throw new RangeError("Questionnaire files must be no larger than 4 MiB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (entries.get(selectedKey) !== entry || context.locked) throw new Error("The questionnaire table changed while opening the file. Import it again into the intended table.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (file.name.toLowerCase().endsWith(".json") || /^format_version[,\t]/u.test(text)) {
        const looksLikeSurvey = file.name.toLowerCase().endsWith(".json") && (() => { const json = JSON.parse(text); return !json.schema || json.schema === SURVEYJS_DEFINITION_SCHEMA; })();
        const imported = looksLikeSurvey ? await importSurveyJson(bytes, { questionnaireId: entry.sheet.questionnaireId, language: entry.sheet.language, basename: file.name })
          : await importQuestionnaireAuthoring(bytes, { logicalName: file.name });
        if (entries.get(selectedKey) !== entry || context.locked) throw new Error("The questionnaire table changed while importing. Import it again into the intended table.");
        if (imported.definition.language !== entry.sheet.language) throw new TypeError(`This table requires ${entry.sheet.language}; the file declares ${imported.definition.language}.`);
        const familyId = context.familyForDefinition(imported.definition);
        if (familyId !== entry.sheet.familyId) {
          const pristineFamily = [...entries.values()].filter(e => e.sheet.familyId === entry.sheet.familyId)
            .every(e => e.pristine && (!e.busy || e === entry));
          if (!pristineFamily || !onAdoptImportedFamily?.(entry.sheet.familyId, familyId)) {
            throw new TypeError("This file belongs to a different questionnaire. Import it into a new, empty questionnaire or its existing matching language table.");
          }
        }
        entry.busy = false;
        loadDefinition(imported.definition, { familyId, sourceBytes: bytes, authoringResult: imported });
      } else {
        const delimiter = file.name.toLowerCase().endsWith(".csv") ? "," : "\t";
        preserveUndo(entry);
        const result = applyQuestionnaireGridPaste(entry.sheet, text, { delimiter, layout: entry.layout });
        entry.layout = result.layout; entry.selection = null;
        entry.invalid.clear(); entry.error = ""; markChanged(entry);
      }
    } catch (error) { entry.error = error.message; }
    finally { if (entries.get(selectedKey) === entry) entry.busy = false; render(); }
  });

  root.querySelector("[data-survey-import-close]")?.addEventListener("click", () => root.querySelector("#questionnaire-survey-import").close());
  root.querySelector("#questionnaire-survey-apply")?.addEventListener("click", async () => {
    const key = surveyImportKey, entry = entries.get(key), generation = restoreGeneration;
    if (!entry || entry.busy || context.locked) return;
    try {
      const imported = await importSurveyJson(root.querySelector("#questionnaire-survey-json").value, { questionnaireId: entry.sheet.questionnaireId, language: entry.sheet.language });
      if (generation !== restoreGeneration || entries.get(key) !== entry || context.locked || entry.busy) throw new Error("The questionnaire changed while importing. Open the import again.");
      if (!loadDefinition(imported.definition, { familyId: entry.sheet.familyId, sourceBytes: imported.sourceBytes, authoringResult: imported })) throw new Error("The questionnaire could not be imported into this slot.");
      root.querySelector("#questionnaire-survey-import").close();
    } catch (error) { root.querySelector("#questionnaire-survey-error").textContent = error.message; }
  });

  root.querySelector("[data-sheet-preview-close]")?.addEventListener("click", () => dialog.close());
  root.querySelector("[data-sheet-copy-close]")?.addEventListener("click", () => root.querySelector("#questionnaire-sheet-copy").close());

  return Object.freeze({ sync, loadDefinition, save, reset() { previewController?.destroy(); previewController = null; dialog?.close(); restoreGeneration++; entries.clear(); fingerprint = ""; },
    async prepareAuthoringImport(imported, { familyId, language, sourceBytes, isCurrent, signal }) {
      if (typeof isCurrent !== "function" || !signal || !(sourceBytes instanceof Uint8Array))
        throw new TypeError("Questionnaire import needs exact source bytes and current-operation/cancellation guards.");
      const key = keyFor(familyId, language), entry = entries.get(key), oldContext = context;
      const generation = restoreGeneration, token = entry?.presetToken;
      const state = () => JSON.stringify({ context, entries: [...entries].map(([key, value]) =>
        [key, { ...value, invalid: [...value.invalid] }]) });
      const before = state();
      let committed = false, projected = false, committedGeneration;
      const current = () => {
        try { return !committed && !signal.aborted && isCurrent() && !context.locked
          && context === oldContext && generation === restoreGeneration
          && entries.get(key) === entry && entry?.presetToken === token && entry.pristine && !entry.busy
          && context.families.some(f => f.id === familyId) && context.languages.some(l => l.languageTag === language)
          && state() === before; }
        catch { return false; }
      };
      const check = () => { if (!current()) {
        const error = new Error("The questionnaire import slot changed or is no longer pristine.");
        error.code = signal.aborted ? "canceled" : "stale_revision"; throw error;
      } };
      check();
      const captured = structuredClone(imported), bytes = sourceBytes.slice();
      if (captured?.definition?.language !== language || questionnaireFamilyId(captured.definition) !== familyId)
        throw new TypeError("Imported questionnaire family or language differs from the requested slot.");
      // Reuse the importer to verify that the supplied result and original bytes
      // are one exact source, including TXT/JSON normalization receipts.
      const verified = captured.definition.schema === SURVEYJS_DEFINITION_SCHEMA
        ? await importSurveyJson(bytes, { questionnaireId: captured.definition.questionnaireId, language, basename: captured.definition.source.basename })
        : await importQuestionnaireAuthoring(bytes, {
        logicalName: captured.authoringReceipt?.original?.logicalName,
        sourceKind: captured.definition.source.kind,
        sourceDocumentSha256: captured.definition.source.sourceDocumentSha256,
      });
      const comparable = result => result.definition.schema === SURVEYJS_DEFINITION_SCHEMA
        ? { ...result, sourceBytes: Array.from(result.sourceBytes) } : result;
      if (canonicalJson(comparable(verified)) !== canonicalJson(comparable(captured))) throw new TypeError("Imported questionnaire result does not match its exact source bytes.");
      check();
      const prepared = prepareLoadedDefinition(entry, verified.definition, { familyId, sourceBytes: bytes, authoringResult: verified });
      check();
      return {
        questionnaireId: verified.definition.questionnaireId,
        isCurrent: current,
        commit() {
          check(); installLoadedDefinition(entry, prepared);
          committedGeneration = restoreGeneration; committed = true;
        },
        afterCommit() {
          if (!committed) throw new TypeError("Commit questionnaire import before its projection.");
          if (projected) return;
          projected = true;
          if (restoreGeneration !== committedGeneration) return;
          render(); onChange?.();
        },
      };
    },
    async prepareRestoreRecipe(contribution, { isCurrent, signal }) {
      if (typeof isCurrent !== "function" || !signal) throw new TypeError("Questionnaire restore needs current-operation and cancellation guards.");
      const generation = restoreGeneration, oldContext = context, slots = [...entries];
      const state = () => JSON.stringify({ context, entries: [...entries].map(([key, entry]) =>
        [key, { ...entry, invalid: [...entry.invalid] }]) });
      const before = state();
      let committed = false, projected = false;
      const current = () => {
        try { return !committed && !signal.aborted && isCurrent() && !context.locked
          && generation === restoreGeneration && context === oldContext
          && slots.every(([key, entry]) => entries.get(key) === entry && !entry.busy)
          && state() === before; }
        catch { return false; }
      };
      const check = () => { if (!current()) {
        const error = new Error("The questionnaire editor changed while reopening.");
        error.code = signal.aborted ? "canceled" : "stale_revision"; throw error;
      } };
      check();
      const restored = await restoreQuestionnaireRecipeContent(contribution);
      check();
      const { definitions, modules } = restored.contribution.questionnaires;
      const next = new Map();
      for (const family of restored.families) for (const language of restored.languages) {
        const definition = definitions.find(d => d.language === language.languageTag && questionnaireFamilyId(d) === family.id);
        if (!definition) throw new TypeError("Missing questionnaire family/language slot.");
        const sheet = sheetFromDefinition(definition, { familyId: family.id });
        const entry = makeEntry(family, language, sheet);
        const presentation = restored.presentation.definitions.find(p => p.questionnaireId === definition.questionnaireId);
        entry.repeatLabels = ["fields", "surveyjs"].includes(presentation.kind) ? 1 : presentation.repeatLabelsEvery;
        entry.sourceDefinitionHash = definition.definitionSha256;
        entry.dirty = false; entry.pristine = false; entry.open = next.size === 0;
        next.set(keyFor(family.id, language.languageTag), entry);
      }
      const nextContext = { ...context, families: restored.families, languages: restored.languages,
        definitions, modules, languageSelection: restored.contribution.languageSelection,
        familyForDefinition: questionnaireFamilyId, locked: false };
      check();
      let committedGeneration;
      return {
        get restored() { return structuredClone(restored); },
        isCurrent: current,
        commit() {
          check();
          entries.clear(); next.forEach((entry, key) => entries.set(key, entry));
          context = nextContext; fingerprint = ""; uploadKey = null;
          committedGeneration = ++restoreGeneration; committed = true;
        },
        afterCommit() {
          if (!committed) throw new TypeError("Commit questionnaire restoration before its projection.");
          if (projected) return;
          projected = true;
          if (restoreGeneration !== committedGeneration) return;
          render(); onChange?.();
        },
      };
    },
    prepareAuthoringQuestionnaireSave(questionnaireId, operation) {
      const slot = activeEntries().find(({ entry }) => entry.sheet.questionnaireId === questionnaireId);
      if (!slot) throw new TypeError("Unknown questionnaire identity.");
      return prepareQuestionnaireSave({ readEntry: () => entries.get(slot.key), isLocked: () => context.locked,
        afterCommit() { render(); onChange?.(); } }, operation);
    },
    /** Separate consequential action; the host supplies guarded native dispatch
     * and returns its real storage receipt through onSave. Never an atomic edit. */
    saveAuthoringQuestionnaire(questionnaireId, operation) {
      if (typeof operation?.isCurrent !== "function" || !operation.signal) throw new TypeError("Questionnaire save needs current-operation and cancellation guards.");
      const slot = activeEntries().find(({ entry }) => entry.sheet.questionnaireId === questionnaireId);
      if (!slot) throw new TypeError("Unknown questionnaire identity.");
      return save(slot.key, operation);
    },
    /** Detached typed snapshots retain sheet-owner provenance, not a second store. */
    readAuthoringEntries() {
      return activeEntries().map(({ entry }) => ({ sheet: cloneQuestionnaireSheet(entry.sheet),
        invalid: [...entry.invalid], layout: entry.layout, repeatLabels: entry.repeatLabels,
        dirty: entry.dirty, pristine: entry.pristine, busy: entry.busy, error: entry.error, rawOptionCount: entry.rawOptionCount ?? null }));
    },
    /** Owner adapter validates/prepares before the shared session's commit fence.
     * The returned projection has no async work, imports, native save or acceptance. */
    prepareAuthoringEntries(records, next) {
      const prepared = new Map();
      for (const record of records) {
        const key = keyFor(record.sheet.familyId, record.sheet.language);
        const previous = entries.get(key);
        const family = next.families.find(item => item.id === record.sheet.familyId);
        const language = next.languages.find(item => item.languageTag === record.sheet.language);
        if (!family || !language || prepared.has(key) || record.busy) throw new TypeError("Invalid questionnaire authoring slot.");
        const entry = previous ? { ...previous } : makeEntry(family, language);
        entry.sheet = cloneQuestionnaireSheet(record.sheet);
        entry.invalid = new Map(record.invalid);
        entry.repeatLabels = record.repeatLabels;
        entry.layout = record.layout;
        entry.dirty = record.dirty;
        entry.error = record.error;
        entry.rawOptionCount = record.rawOptionCount;
        entry.selection = null;
        if (record.dirty) { entry.pristine = record.pristine === true; entry.authoringResult = null; entry.sourceBytes = null; }
        prepared.set(key, entry);
      }
      if (prepared.size !== next.families.length * next.languages.length) throw new TypeError("Missing questionnaire authoring slot.");
      const projection = { ...context, families: structuredClone(next.families), languages: structuredClone(next.languages),
        definitions: structuredClone(next.definitions), locked: next.locked };
      return { commit() {
        restoreGeneration++;
        entries.clear(); prepared.forEach((entry, key) => entries.set(key, entry));
        context = projection; fingerprint = ""; uploadKey = null;
      }, afterCommit: render };
    },
    getPresentation(definitions) {
      const create = definitions.some(d => d.schema === SURVEYJS_DEFINITION_SCHEMA) ? createQuestionnairePresentationV3 : definitions.some(d => d.schema === FORM_DEFINITION_SCHEMA) ? createQuestionnairePresentationV2 : createQuestionnairePresentationV1;
      return create(definitions, definitions.map((definition) => {
        const entry = [...entries.values()].find(({ sheet }) => sheet.questionnaireId === definition.questionnaireId);
        if (!entry) throw new TypeError("Questionnaire presentation has no matching editable table.");
        return entry.repeatLabels;
      }));
    },
    restorePresentation(value, definitions) {
      const presentation = value.version === 3 ? validateQuestionnairePresentationV3(value, definitions) : value.version === 2 ? validateQuestionnairePresentationV2(value, definitions) : validateQuestionnairePresentationV1(value, definitions);
      const targets = presentation.definitions.map((record) => {
        const entry = [...entries.values()].find(({ sheet }) => sheet.questionnaireId === record.questionnaireId);
        if (!entry) throw new TypeError("Questionnaire presentation has no matching editable table.");
        return { entry, record };
      });
      restoreGeneration++;
      targets.forEach(({ entry, record }) => { entry.repeatLabels = ["fields", "surveyjs"].includes(record.kind) ? 1 : record.repeatLabelsEvery; });
      render();
    },
    presetToken(familyId, language) { return entries.get(keyFor(familyId, language))?.presetToken ?? null; },
    canLoadPreset(familyId, language) { const entry = entries.get(keyFor(familyId, language)); return Boolean(entry?.pristine && !entry.busy && !context.locked); },
    isPending(familyId, language) { const entry = entries.get(keyFor(familyId, language)); return Boolean(entry && (entry.dirty || entry.busy || entry.invalid.size)); },
    pendingKeys() { return activeEntries().filter(({ entry }) => entry.dirty || entry.busy || entry.invalid.size).map(({ key }) => key); },
    hasPresentationDraft() { return activeEntries().some(({ entry }) => entry.repeatLabels !== 1); },
  });
}
