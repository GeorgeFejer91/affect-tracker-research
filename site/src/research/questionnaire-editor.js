import {
  createQuestionnaireSheet, cloneQuestionnaireSheet, sheetFromDefinition, sheetToAuthoring,
  applyQuestionnaireGridPaste, setQuestionnaireGridCell, setOptionCount,
  questionnaireGridColumns, questionnaireGridRows, serializeQuestionnaireGrid,
  appendSheetRows, removeSheetRow, reverseSheetRowCodes,
} from "./questionnaire-sheet.js";
import { importQuestionnaireAuthoring } from "./questionnaire-authoring.js";
import { createQuestionnairePresentationV1, validateQuestionnairePresentationV1,
  QUESTIONNAIRE_LABEL_REPETITIONS, questionnairePresentationGroups } from "./questionnaire-recipe.js";

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

  function makeEntry(family, language) {
    const sheet = createQuestionnaireSheet({ familyId: family.id, language: language.languageTag,
      title: family.label, optionCount: family.id === "maia-2" ? 6 : 5,
      rowCount: family.id === "tas-20" ? 20 : 5 });
    return { sheet, dirty: true, pristine: true, busy: false, error: "", invalid: new Map(), open: false,
      repeatLabels: 1, rawOptionCount: null, optionsOpen: false, layout: "labels-and-codes", selection: null, presetToken: Symbol("questionnaire-slot"),
      sourceDefinitionHash: null, sourceBytes: null, authoringResult: null, undo: null };
  }

  function activeEntries() {
    return context.families.flatMap((family) => context.languages.map((language) => ({
      family, language, key: keyFor(family.id, language.languageTag),
      entry: entries.get(keyFor(family.id, language.languageTag)),
    })));
  }

  function sync(next) {
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
    const sheet = entry.sheet;
    return `<details class="questionnaire-sheet" data-sheet-key="${escape(key)}" ${entry.open ? "open" : ""}>
      <summary><span class="sheet-heading"><strong>${escape(sheet.title || family.label)}</strong><span>${escape(language.label)} · ${sheet.rows.filter((r) => r.prompt.trim()).length} items</span></span><span class="sheet-save-state">${status(entry)}</span><svg class="sheet-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></summary>
      <fieldset class="sheet-body" ${context.locked || entry.busy ? "disabled" : ""}>
        <legend class="sr-only">Edit ${escape(family.label)} in ${escape(language.label)}</legend>
        <div class="sheet-settings">
          <label class="field"><span>Answer options</span><input type="number" min="2" max="64" step="1" data-sheet-option-count value="${escape(entry.rawOptionCount ?? sheet.optionCount)}"></label>
          <label class="field"><span>Table columns</span><select data-sheet-layout><option value="labels-and-codes" ${entry.layout === "labels-and-codes" ? "selected" : ""}>Items, answer labels and codes</option><option value="codes-only" ${entry.layout === "codes-only" ? "selected" : ""}>Items and codes only</option></select></label>
        </div>
        <p class="sheet-paste-help">Paste cells from Excel. Answers are participant labels; codes are recorded values. One answer per item.</p>
        <p class="sheet-error" role="status" aria-live="polite">${escape(entry.error)}</p>
        <div class="sheet-table-scroll" tabindex="0" role="region" aria-label="${escape(family.label)} ${escape(language.label)} questionnaire table">
          <table class="sheet-table"><thead><tr><th scope="col">#</th>${questionnaireGridColumns(sheet, entry.layout).map((label) => `<th scope="col">${escape(label)}</th>`).join("")}<th scope="col"><span class="sr-only">Row actions</span></th></tr></thead><tbody>${sheet.rows.map((row, i) => rowMarkup(entry, row, i)).join("")}</tbody></table>
        </div>
        <div class="sheet-actions"><button type="button" data-sheet-action="add-row">Add row</button><button type="button" data-sheet-action="copy-table">Copy whole table</button><button type="button" data-sheet-action="upload">Import file</button><button type="button" data-sheet-action="template">Download table template</button><button type="button" data-sheet-action="undo" ${entry.undo ? "" : "disabled"}>Undo edit</button></div>
        <details class="sheet-options" ${entry.optionsOpen ? "open" : ""}><summary>Questionnaire settings &amp; paste help</summary><div class="sheet-options-content">
          <label class="field"><span>Questionnaire title</span><input type="text" data-sheet-meta="title" value="${escape(sheet.title)}" maxlength="500"></label>
          <label class="field"><span>Instructions for participants</span><textarea data-sheet-meta="instructions" rows="2" maxlength="8000">${escape(sheet.instructions)}</textarea></label>
          <label class="field"><span>Answers for all items</span><select data-sheet-required-all><option value="" selected>No bulk change</option><option value="required">Required</option><option value="optional">Optional</option></select></label>
          <label class="field"><span>Repeat answer labels</span><select data-sheet-repeat><option value="1" ${entry.repeatLabels === 1 ? "selected" : ""}>Above every item</option><option value="5" ${entry.repeatLabels === 5 ? "selected" : ""}>Every 5 items</option><option value="10" ${entry.repeatLabels === 10 ? "selected" : ""}>Every 10 items</option></select></label>
          <p class="field-help">Included in the final recipe. Labels also repeat whenever the answer labels change between items.</p>
          <label class="field"><span>Source / attribution</span><textarea data-sheet-meta="attribution" rows="3" maxlength="12000">${escape(sheet.attribution)}</textarea></label>
          <p class="field-help">Files are kept in this questionnaire’s language folder inside the project’s assets folder.</p>
          <p class="sheet-paste-help">Paste headers into the first cell to replace the whole table and set its option count; without headers, only the pasted range changes. Required accepts true or false. Codes-only leaves answer labels unchanged. Shift-click or Shift+arrow selects a range; Ctrl+C copies it; Ctrl+A selects all cells.</p>
          <p class="sheet-paste-help">Replacement tables retain item identity and subscale only for unambiguous matches. New items receive new identities. The final recipe retains full metadata.</p>
        </div></details>
        <div class="sheet-footer"><span>Before the video task</span><div class="sheet-actions"><button type="button" data-sheet-action="preview">Preview</button><button type="button" data-sheet-action="save" class="primary-action" ${!entry.dirty ? "disabled" : ""}>Save questionnaire</button></div></div>
        <div class="sheet-family-actions"><button type="button" data-sheet-action="move-up" ${index < context.languages.length ? "disabled" : ""}>Move questionnaire up</button><button type="button" data-sheet-action="move-down" ${index >= (context.families.length - 1) * context.languages.length ? "disabled" : ""}>Move questionnaire down</button><button type="button" data-sheet-action="remove">Remove questionnaire${context.languages.length > 1 ? " (all languages)" : ""}</button></div>
      </fieldset>
    </details>`;
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
      options.addEventListener("toggle", () => { const entry = entries.get(details.dataset.sheetKey); if (entry) entry.optionsOpen = options.open; });
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

  async function save(key) {
    const entry = entries.get(key);
    if (!entry || context.locked || entry.busy) return;
    try {
      if (entry.invalid.size) throw new TypeError("Correct the highlighted recorded values before saving.");
      if (entry.rawOptionCount !== null) throw new TypeError("Finish a valid answer-option count before saving.");
      entry.busy = true;
      entry.error = "";
      render();
      const result = await sheetToAuthoring(entry.sheet);
      if (entries.get(key) !== entry || context.locked) throw new Error("The questionnaire table changed while preparing its save.");
      const bytes = result.sourceBytes ?? entry.sourceBytes;
      await onSave({ familyId: entry.sheet.familyId, language: entry.sheet.language,
        definition: result.definition, sourceBytes: bytes,
        expectedPresetToken: entry.presetToken,
        authoringReceipt: result.authoringReceipt ?? entry.authoringResult?.authoringReceipt });
      entry.sourceDefinitionHash = result.definition.definitionSha256;
      entry.sheet = sheetFromDefinition(result.definition, { familyId: entry.sheet.familyId, authoringResult: result });
      entry.sourceBytes = bytes;
      entry.dirty = false;
      entry.undo = null;
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
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
    preserveUndo(entry);
    entry.sheet = sheetFromDefinition(definition, { familyId, authoringResult });
    entry.sourceBytes = sourceBytes;
    entry.authoringResult = authoringResult;
    entry.invalid.clear();
    entry.rawOptionCount = null;
    entry.error = "";
    entry.dirty = true;
    entry.pristine = false;
    entry.open = true;
    render();
    onChange?.();
    return true;
  }

  async function preview(entry) {
    if (entry.invalid.size) throw new TypeError("Correct the recorded values before previewing.");
    if (entry.rawOptionCount !== null) throw new TypeError("Finish a valid answer-option count before previewing.");
    const { definition } = await sheetToAuthoring(entry.sheet);
    root.querySelector("#questionnaire-sheet-preview-title").textContent = `${definition.title} · ${definition.language}`;
    const body = root.querySelector("#questionnaire-sheet-preview-content");
    const chunks = [];
    for (const { start, end } of questionnairePresentationGroups(definition, entry.repeatLabels)) {
      const items = definition.items.slice(start, end);
      chunks.push(`<div class="sheet-table-scroll"><table class="sheet-preview-table"><thead><tr><th scope="col">Item</th>${items[0].options.map((o) => `<th scope="col">${escape(o.label)}</th>`).join("")}</tr></thead><tbody>${items.map((item, index) => `<tr><th scope="row">${start + index + 1}. ${escape(item.prompt)}${item.required ? ' <span aria-label="Required">*</span>' : ""}</th>${item.options.map((option) => `<td><input type="radio" name="preview-${escape(item.itemId)}" aria-label="${escape(item.prompt)} — ${escape(option.label)}"></td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
    }
    body.innerHTML = `<p>${escape(definition.instructions)}</p><p class="field-help">Design preview · answers here are not recorded.</p>${chunks.join("")}`;
    dialog.showModal();
  }

  container?.addEventListener("input", (event) => {
    event.stopPropagation();
    const target = event.target;
    const entry = entries.get(target.closest("[data-sheet-key]")?.dataset.sheetKey);
    if (!entry || entry.busy || context.locked) return;
    if (target.matches("select")) return;
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
    event.stopPropagation();
    const target = event.target;
    const entry = entries.get(target.closest("[data-sheet-key]")?.dataset.sheetKey);
    if (!entry || entry.busy || context.locked) return;
    try {
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
    const target = event.target;
    if (!target.closest(".sheet-table-scroll")) return;
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
    const button = event.target.closest("button[data-sheet-action]");
    if (!button) return;
    event.stopPropagation();
    const key = button.closest("[data-sheet-key]").dataset.sheetKey;
    const entry = entries.get(key);
    if (!entry || entry.busy || context.locked) return;
    const action = button.dataset.sheetAction;
    try {
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
        const imported = await importQuestionnaireAuthoring(bytes, { logicalName: file.name });
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

  root.querySelector("[data-sheet-preview-close]")?.addEventListener("click", () => dialog.close());
  root.querySelector("[data-sheet-copy-close]")?.addEventListener("click", () => root.querySelector("#questionnaire-sheet-copy").close());

  return Object.freeze({ sync, loadDefinition, save, reset() { entries.clear(); fingerprint = ""; },
    /** Detached typed snapshots retain sheet-owner provenance, not a second store. */
    readAuthoringEntries() {
      return activeEntries().map(({ entry }) => ({ sheet: cloneQuestionnaireSheet(entry.sheet),
        invalid: [...entry.invalid], layout: entry.layout, repeatLabels: entry.repeatLabels,
        dirty: entry.dirty, busy: entry.busy, error: entry.error, rawOptionCount: entry.rawOptionCount ?? null }));
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
        if (record.dirty) { entry.pristine = false; entry.authoringResult = null; entry.sourceBytes = null; }
        prepared.set(key, entry);
      }
      if (prepared.size !== next.families.length * next.languages.length) throw new TypeError("Missing questionnaire authoring slot.");
      const projection = { ...context, families: structuredClone(next.families), languages: structuredClone(next.languages),
        definitions: structuredClone(next.definitions), locked: next.locked };
      return () => {
        entries.clear(); prepared.forEach((entry, key) => entries.set(key, entry));
        context = projection; fingerprint = ""; uploadKey = null;
        render();
      };
    },
    getPresentation(definitions) {
      return createQuestionnairePresentationV1(definitions, definitions.map((definition) => {
        const entry = [...entries.values()].find(({ sheet }) => sheet.questionnaireId === definition.questionnaireId);
        if (!entry) throw new TypeError("Questionnaire presentation has no matching editable table.");
        return entry.repeatLabels;
      }));
    },
    restorePresentation(value, definitions) {
      const presentation = validateQuestionnairePresentationV1(value, definitions);
      const targets = presentation.definitions.map((record) => {
        const entry = [...entries.values()].find(({ sheet }) => sheet.questionnaireId === record.questionnaireId);
        if (!entry) throw new TypeError("Questionnaire presentation has no matching editable table.");
        return { entry, record };
      });
      targets.forEach(({ entry, record }) => { entry.repeatLabels = record.repeatLabelsEvery; });
      render();
    },
    presetToken(familyId, language) { return entries.get(keyFor(familyId, language))?.presetToken ?? null; },
    canLoadPreset(familyId, language) { const entry = entries.get(keyFor(familyId, language)); return Boolean(entry?.pristine && !entry.busy && !context.locked); },
    isPending(familyId, language) { const entry = entries.get(keyFor(familyId, language)); return Boolean(entry && (entry.dirty || entry.busy || entry.invalid.size)); },
    pendingKeys() { return activeEntries().filter(({ entry }) => entry.dirty || entry.busy || entry.invalid.size).map(({ key }) => key); },
    hasPresentationDraft() { return activeEntries().some(({ entry }) => entry.repeatLabels !== 1); },
  });
}
