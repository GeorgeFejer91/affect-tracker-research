import {
  createQuestionnaireSheet, cloneQuestionnaireSheet, sheetFromDefinition, sheetToAuthoring,
  applySheetPaste, setSheetCell, setOptionCount, setOptionLabels,
  appendSheetRows, removeSheetRow, reverseSheetRowCodes,
} from "./questionnaire-sheet.js";
import { importQuestionnaireAuthoring } from "./questionnaire-authoring.js";

const escape = (value) => String(value ?? "").replace(/[&<>"']/gu, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const keyFor = (familyId, language) => `${familyId}/${language}`;

/** Section 2 presentation owner. Drafts never become run authority until saved. */
export function createQuestionnaireEditor({ root, onChange, onSave, onRemove, onMove }) {
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
      repeatLabels: 1, sourceDefinitionHash: null, sourceBytes: null, authoringResult: null, undo: null };
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
    const promptKey = `${index}:0`;
    const prompt = entry.invalid.has(promptKey) ? entry.invalid.get(promptKey) : row.prompt;
    const codeCells = row.options.map((option, column) => {
      const cell = `${index}:${column + 1}`;
      const displayed = entry.invalid.has(cell) ? entry.invalid.get(cell) : option.scoreValue ?? "";
      return `<td><input type="text" inputmode="decimal" data-sheet-cell="${index}:${column + 1}"
        aria-label="Item ${index + 1}, recorded value ${column + 1}" value="${escape(displayed)}"
        ${entry.invalid.has(cell) ? 'aria-invalid="true"' : ""}></td>`;
    }).join("");
    return `<tr><th scope="row">${index + 1}</th>
      <td class="sheet-prompt-cell"><textarea rows="2" data-sheet-cell="${index}:0" aria-label="Item ${index + 1} text" ${entry.invalid.has(promptKey) ? 'aria-invalid="true"' : ""}>${escape(prompt)}</textarea></td>
      ${codeCells}${Array.from({ length: entry.sheet.optionCount - row.options.length }, () => '<td aria-label="No option for this item">—</td>').join("")}<td><input type="checkbox" data-sheet-required="${index}" aria-label="Require an answer to item ${index + 1}" ${row.required ? "checked" : ""}></td>
      <td class="sheet-row-actions"><button type="button" data-sheet-action="reverse" data-row="${index}" aria-label="Reverse recorded values for item ${index + 1}" title="Reverse recorded values">⇄</button><button type="button" data-sheet-action="delete-row" data-row="${index}" aria-label="Delete item ${index + 1}" title="Delete item">×</button></td></tr>`;
  }

  function entryMarkup({ family, language, key, entry }, index) {
    const sheet = entry.sheet;
    const labels = Array.from({ length: sheet.optionCount }, (_, i) => `<label class="field"><span>Option ${i + 1}</span><input type="text" data-sheet-label="${i}" aria-label="Displayed label for option ${i + 1}" value="${escape(sheet.optionLabels[i])}" placeholder="${sheet.optionLabels[i] === null ? "Labels vary by item" : "Answer label"}"></label>`).join("");
    return `<details class="questionnaire-sheet" data-sheet-key="${escape(key)}" ${entry.open ? "open" : ""}>
      <summary><span class="sheet-heading"><strong>${escape(sheet.title || family.label)}</strong><span>${escape(language.label)} · ${sheet.rows.filter((r) => r.prompt.trim()).length} items</span></span><span class="sheet-save-state">${status(entry)}</span><svg class="sheet-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></summary>
      <fieldset class="sheet-body" ${context.locked || entry.busy ? "disabled" : ""}>
        <legend class="sr-only">Edit ${escape(family.label)} in ${escape(language.label)}</legend>
        <div class="sheet-settings"><label class="field sheet-title-field"><span>Questionnaire title</span><input type="text" data-sheet-meta="title" value="${escape(sheet.title)}" maxlength="500"></label>
          <label class="field"><span>Answer options</span><input type="number" min="2" max="64" step="1" data-sheet-option-count value="${sheet.optionCount}"></label>
          <label class="field"><span>Answers</span><select data-sheet-required-all><option value="" selected>Set for all items…</option><option value="required">Required</option><option value="optional">Optional</option></select></label></div>
        <label class="field"><span>Instructions for participants</span><textarea data-sheet-meta="instructions" rows="2" maxlength="8000">${escape(sheet.instructions)}</textarea></label>
        <div class="sheet-labels-heading"><strong>Displayed answer labels</strong><span>One answer per item</span></div>
        <div class="sheet-labels">${labels}</div>
        <p class="sheet-paste-help">Paste from Excel into any cell. First column: item text. Following columns: recorded values, including reverse coding. Participants see the labels above.</p>
        <div class="sheet-table-scroll" tabindex="0" role="region" aria-label="${escape(family.label)} ${escape(language.label)} questionnaire table">
          <table class="sheet-table"><thead><tr><th scope="col">#</th><th scope="col">Questionnaire item</th>${Array.from({length: sheet.optionCount}, (_, i) => `<th scope="col">Code ${i + 1}</th>`).join("")}<th scope="col">Required</th><th scope="col"><span class="sr-only">Row actions</span></th></tr></thead><tbody>${sheet.rows.map((row, i) => rowMarkup(entry, row, i)).join("")}</tbody></table>
        </div>
        <div class="sheet-actions"><button type="button" data-sheet-action="add-row">Add row</button><button type="button" data-sheet-action="upload">Import file</button><button type="button" data-sheet-action="template">Download table template</button><button type="button" data-sheet-action="undo" ${entry.undo ? "" : "disabled"}>Undo edit</button></div>
        <details class="sheet-options"><summary>Display and source details</summary><div class="sheet-options-content">
          <label class="field"><span>Repeat answer labels in preview</span><select data-sheet-repeat><option value="1" ${entry.repeatLabels === 1 ? "selected" : ""}>Above every item</option><option value="5" ${entry.repeatLabels === 5 ? "selected" : ""}>Every 5 items</option><option value="10" ${entry.repeatLabels === 10 ? "selected" : ""}>Every 10 items</option></select></label>
          <p class="field-help">Label spacing previews the questionnaire design here. Saving this setting into the finished experiment is planned with the runner work.</p>
          <label class="field"><span>Source / attribution</span><textarea data-sheet-meta="attribution" rows="3" maxlength="12000">${escape(sheet.attribution)}</textarea></label>
          <p class="field-help">Files are kept in this questionnaire’s language folder inside the project’s assets folder.</p>
        </div></details>
        <p class="sheet-error" role="status" aria-live="polite">${escape(entry.error)}</p>
        <div class="sheet-footer"><span>Before the video task</span><div class="sheet-actions"><button type="button" data-sheet-action="preview">Preview</button><button type="button" data-sheet-action="save" class="primary-action" ${!entry.dirty ? "disabled" : ""}>Save questionnaire</button></div></div>
        <div class="sheet-family-actions"><button type="button" data-sheet-action="move-up" ${index < context.languages.length ? "disabled" : ""}>Move questionnaire up</button><button type="button" data-sheet-action="move-down" ${index >= (context.families.length - 1) * context.languages.length ? "disabled" : ""}>Move questionnaire down</button><button type="button" data-sheet-action="remove">Remove questionnaire${context.languages.length > 1 ? " (all languages)" : ""}</button></div>
      </fieldset>
    </details>`;
  }

  function render() {
    if (!container) return;
    const active = activeEntries();
    container.innerHTML = active.length ? active.map(entryMarkup).join("")
      : '<p class="empty-state">No questionnaires yet. Add a blank table or start with MAIA-2.</p>';
    container.querySelectorAll("details[data-sheet-key]").forEach((details) => {
      details.addEventListener("toggle", () => { const entry = entries.get(details.dataset.sheetKey); if (entry) entry.open = details.open; });
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
      sourceDefinitionHash: entry.sourceDefinitionHash };
  }

  async function save(key) {
    const entry = entries.get(key);
    if (!entry || context.locked || entry.busy) return;
    try {
      if (entry.invalid.size) throw new TypeError("Correct the highlighted recorded values before saving.");
      entry.busy = true;
      entry.error = "";
      render();
      const result = await sheetToAuthoring(entry.sheet);
      const bytes = result.sourceBytes ?? entry.sourceBytes;
      await onSave({ familyId: entry.sheet.familyId, language: entry.sheet.language,
        definition: result.definition, sourceBytes: bytes,
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

  function loadDefinition(definition, { familyId, sourceBytes = null, authoringResult = null, onlyIfPristine = false } = {}) {
    const key = keyFor(familyId, definition.language);
    const entry = entries.get(key);
    if (!entry || context.locked || entry.busy || (onlyIfPristine && !entry.pristine)) return false;
    preserveUndo(entry);
    entry.sheet = sheetFromDefinition(definition, { familyId, authoringResult });
    entry.sourceBytes = sourceBytes;
    entry.authoringResult = authoringResult;
    entry.invalid.clear();
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
    const { definition } = await sheetToAuthoring(entry.sheet);
    root.querySelector("#questionnaire-sheet-preview-title").textContent = `${definition.title} · ${definition.language}`;
    const body = root.querySelector("#questionnaire-sheet-preview-content");
    const chunks = [];
    const sameLabels = (a, b) => a.options.length === b.options.length && a.options.every((o, i) => o.label === b.options[i].label);
    for (let start = 0; start < definition.items.length;) {
      let end = start + 1;
      while (end < definition.items.length && end < start + entry.repeatLabels
        && sameLabels(definition.items[start], definition.items[end])) end += 1;
      const items = definition.items.slice(start, end);
      chunks.push(`<div class="sheet-table-scroll"><table class="sheet-preview-table"><thead><tr><th scope="col">Item</th>${items[0].options.map((o) => `<th scope="col">${escape(o.label)}</th>`).join("")}</tr></thead><tbody>${items.map((item, index) => `<tr><th scope="row">${start + index + 1}. ${escape(item.prompt)}${item.required ? ' <span aria-label="Required">*</span>' : ""}</th>${item.options.map((option) => `<td><input type="radio" name="preview-${escape(item.itemId)}" aria-label="${escape(item.prompt)} — ${escape(option.label)}"></td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      start = end;
    }
    body.innerHTML = `<p>${escape(definition.instructions)}</p><p class="field-help">Design preview · answers here are not recorded.</p>${chunks.join("")}`;
    dialog.showModal();
  }

  container?.addEventListener("input", (event) => {
    event.stopPropagation();
    const target = event.target;
    const entry = entries.get(target.closest("[data-sheet-key]")?.dataset.sheetKey);
    if (!entry || entry.busy || context.locked) return;
    if (target.matches("[data-sheet-option-count], [data-sheet-label], select")) return;
    preserveUndo(entry);
    try {
      if (target.dataset.sheetCell) {
        const [row, column] = target.dataset.sheetCell.split(":").map(Number);
        setSheetCell(entry.sheet, row, column, target.value);
        entry.invalid.delete(target.dataset.sheetCell);
        target.removeAttribute("aria-invalid");
      } else if (target.dataset.sheetMeta) entry.sheet[target.dataset.sheetMeta] = target.value;
      else if (target.dataset.sheetRequired !== undefined) entry.sheet.rows[Number(target.dataset.sheetRequired)].required = target.checked;
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
      if (target.hasAttribute("data-sheet-repeat")) { entry.repeatLabels = Number(target.value); return; }
      if (!target.matches("[data-sheet-option-count], [data-sheet-label], [data-sheet-required-all]")) return;
      if (entry.invalid.size) throw new TypeError("Correct the highlighted recorded values first.");
      preserveUndo(entry);
      if (target.hasAttribute("data-sheet-option-count")) setOptionCount(entry.sheet, Number(target.value));
      if (target.dataset.sheetLabel !== undefined) {
        const labels = [...entry.sheet.optionLabels];
        labels[Number(target.dataset.sheetLabel)] = target.value;
        setOptionLabels(entry.sheet, labels);
      }
      if (target.hasAttribute("data-sheet-required-all") && target.value) entry.sheet.rows.forEach((row) => { row.required = target.value === "required"; });
      entry.error = "";
      markChanged(entry);
    } catch (error) { entry.error = error.message; }
    render();
  });

  container?.addEventListener("paste", (event) => {
    const target = event.target;
    if (!target.dataset.sheetCell) return;
    event.preventDefault();
    event.stopPropagation();
    const entry = entries.get(target.closest("[data-sheet-key]").dataset.sheetKey);
    if (!entry || entry.busy || context.locked) return;
    const [row, column] = target.dataset.sheetCell.split(":").map(Number);
    try {
      if (entry.invalid.size) throw new TypeError("Correct the highlighted recorded values before pasting a range.");
      preserveUndo(entry);
      // Only text supplied by this explicit paste gesture is consumed. Never read the ambient clipboard.
      applySheetPaste(entry.sheet, event.clipboardData.getData("text/plain"), { row, column });
      entry.error = "";
      markChanged(entry);
    } catch (error) { entry.error = error.message; }
    render();
    container.querySelector(`[data-sheet-key="${keyFor(entry.sheet.familyId, entry.sheet.language)}"] [data-sheet-cell="${row}:${column}"]`)?.focus();
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
        const csv = ["Item", ...entry.sheet.optionLabels.map((_, i) => `Code ${i + 1}`)].join(",") + "\r\n"
          + ["Replace with your questionnaire item", ...entry.sheet.optionLabels.map((_, i) => String(i + 1))].join(",") + "\r\n";
        const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = `${entry.sheet.familyId}-${entry.sheet.language}-table.csv`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); return;
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
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (file.name.toLowerCase().endsWith(".json") || /^format_version[,\t]/u.test(text)) {
        const imported = await importQuestionnaireAuthoring(bytes, { logicalName: file.name });
        if (imported.definition.language !== entry.sheet.language) throw new TypeError(`This table requires ${entry.sheet.language}; the file declares ${imported.definition.language}.`);
        if (context.familyForDefinition(imported.definition) !== entry.sheet.familyId) throw new TypeError("This file belongs to a different questionnaire. Add its questionnaire first.");
        entry.busy = false;
        loadDefinition(imported.definition, { familyId: entry.sheet.familyId, sourceBytes: bytes, authoringResult: imported });
      } else {
        const delimiter = file.name.toLowerCase().endsWith(".csv") ? "," : "\t";
        let body = text;
        const header = body.split(/\r?\n/u, 1)[0];
        if (/^(?:Item|Questionnaire item|Question)(?:,|\t)Code 1(?:,|\t)/iu.test(header)) body = body.slice(header.length).replace(/^\r?\n/u, "");
        preserveUndo(entry);
        applySheetPaste(entry.sheet, body, { row: 0, column: 0, delimiter });
        entry.invalid.clear(); entry.error = ""; markChanged(entry);
      }
    } catch (error) { entry.error = error.message; }
    finally { if (entries.get(selectedKey) === entry) entry.busy = false; render(); }
  });

  root.querySelector("[data-sheet-preview-close]")?.addEventListener("click", () => dialog.close());

  return Object.freeze({ sync, loadDefinition, save, reset() { entries.clear(); fingerprint = ""; },
    canLoadPreset(familyId, language) { const entry = entries.get(keyFor(familyId, language)); return Boolean(entry?.pristine && !entry.busy && !context.locked); },
    isPending(familyId, language) { const entry = entries.get(keyFor(familyId, language)); return Boolean(entry && (entry.dirty || entry.busy || entry.invalid.size)); },
    pendingKeys() { return activeEntries().filter(({ entry }) => entry.dirty || entry.busy || entry.invalid.size).map(({ key }) => key); },
    hasPresentationDraft() { return activeEntries().some(({ entry }) => entry.repeatLabels !== 1); },
  });
}
