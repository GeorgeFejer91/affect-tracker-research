import { formDraft, formSheetFromDraft } from "./form-sheet.js";
const escape = value => String(value ?? "").replace(/[&<>"']/gu, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const input = (label, key, value, entry, attrs = "") => `<label class="field"><span>${escape(label)}</span><input data-form-field="${key}" value="${escape(entry.invalid.get(key) ?? value)}" ${attrs} ${entry.invalid.has(key) ? 'aria-invalid="true"' : ""}></label>`;
export function formEntryMarkup({ family, language, key, entry }, index, context, status) {
  const s = entry.sheet;
  return `<details class="questionnaire-sheet" data-sheet-key="${escape(key)}" ${entry.open ? "open" : ""}>
    <summary><span class="sheet-heading"><strong>${escape(s.title)}</strong><span>${escape(language.label)} · ${s.rows.length} fields</span></span><span class="sheet-save-state">${status}</span></summary>
    <fieldset class="sheet-body" ${context.locked || entry.busy ? "disabled" : ""}><legend class="sr-only">Edit ${escape(family.label)} in ${escape(language.label)}</legend>
    <p class="field-help">Text, whole years and single choices. Every field must be answered during the experiment.</p>
    <p class="sheet-error" role="status" aria-live="polite">${escape(entry.error)}</p>
    <div class="sheet-settings">${input("Form title", "title", s.title, entry, 'maxlength="500"')}${input("Form version", "questionnaireVersion", s.questionnaireVersion, entry, 'maxlength="120"')}</div>
    ${s.rows.map((item, row) => `<fieldset class="sheet-options-content"><legend>${item.order}. ${escape(item.itemId)}</legend>
      ${input("Participant prompt", `${row}:prompt`, item.prompt, entry, 'maxlength="8000"')}
      <div class="sheet-settings"><label class="field"><span>Answer type</span><select data-form-field="${row}:kind">${[["text", "Text"], ["integer", "Whole years"], ["singleChoice", "Single choice"]].map(([id, label]) => `<option value="${id}" ${item.response.kind === id ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label class="field"><span>Required source metadata</span><select data-form-field="${row}:required"><option value="true" ${item.required ? "selected" : ""}>Required</option><option value="false" ${!item.required ? "selected" : ""}>Optional metadata (Runner still requires an answer)</option></select></label></div>
      ${item.response.kind === "text" ? input("Maximum UTF-8 bytes", `${row}:maxUtf8Bytes`, item.response.maxUtf8Bytes, entry, 'inputmode="numeric"') : item.response.kind === "integer" ? `<div class="sheet-settings">${input("Minimum years", `${row}:min`, item.response.min, entry, 'inputmode="numeric"')}${input("Maximum years", `${row}:max`, item.response.max, entry, 'inputmode="numeric"')}</div>` : item.response.options.map((o, i) => `<div class="sheet-settings">${input("Option ID", `${row}:optionId:${i}`, o.optionId, entry, 'maxlength="128"')}${input("Participant label", `${row}:label:${i}`, o.label, entry, 'maxlength="2000"')}</div><div class="sheet-actions"><button type="button" data-form-option="up" data-row="${row}" data-option="${i}" ${i === 0 ? "disabled" : ""}>Move option up</button><button type="button" data-form-option="remove" data-row="${row}" data-option="${i}" ${item.response.options.length === 1 ? "disabled" : ""}>Remove option</button></div>`).join("") + `<button type="button" data-form-option="add" data-row="${row}" ${item.response.options.length >= 256 ? "disabled" : ""}>Add option</button>`}
      <div class="sheet-actions"><button type="button" data-form-move="${row}" data-direction="-1" ${row === 0 ? "disabled" : ""}>Move field up</button><button type="button" data-form-move="${row}" data-direction="1" ${row === s.rows.length - 1 ? "disabled" : ""}>Move field down</button></div>
    </fieldset>`).join("")}
    <details class="sheet-options"><summary>Source</summary><p class="field-help">Project-authored form; no psychometric validation or scoring is claimed.</p></details>
    <div class="sheet-actions"><button type="button" data-sheet-action="undo" ${entry.undo ? "" : "disabled"}>Undo edit</button><button type="button" data-sheet-action="preview">Preview</button><button type="button" data-sheet-action="save" class="primary-action" ${!entry.dirty ? "disabled" : ""}>Save form</button></div>
    <div class="sheet-family-actions"><button type="button" data-sheet-action="move-up" ${index < context.languages.length ? "disabled" : ""}>Move questionnaire up</button><button type="button" data-sheet-action="move-down" ${index >= (context.families.length - 1) * context.languages.length ? "disabled" : ""}>Move questionnaire down</button><button type="button" data-sheet-action="remove">Remove questionnaire (all languages)</button></div>
    </fieldset></details>`;
}
export function editFormField(entry, key, raw) {
  const d = formDraft(entry.sheet), parts = key.split(":"), row = Number(parts[0]), property = parts[1];
  if (parts.length === 1 && ["title", "questionnaireVersion"].includes(key)) d[key] = raw;
  else {
    const item = d.items[row];
    if (!item) throw new TypeError("Unknown form field.");
    if (property === "prompt") item.prompt = raw;
    else if (property === "required") {
      if (!["true", "false"].includes(raw)) throw new TypeError("Invalid required metadata.");
      item.required = raw === "true";
    } else if (property === "kind") {
      if (raw === "text") item.response = { kind: "text", maxUtf8Bytes: 1024 };
      else if (raw === "integer") item.response = { kind: "integer", min: 0, max: Number.MAX_SAFE_INTEGER, unit: "years" };
      else if (raw === "singleChoice") item.response = { kind: "singleChoice", options: [{ optionId: "option-1", order: 1, label: "Option 1" }] };
      else throw new TypeError("Unknown answer type.");
    } else if (["maxUtf8Bytes", "min", "max"].includes(property)) {
      if (!/^(0|[1-9][0-9]*)$/u.test(raw)) throw new TypeError("Enter a whole nonnegative number.");
      item.response[property] = Number(raw);
    } else if (["optionId", "label"].includes(property) && item.response.kind === "singleChoice") {
      const option = item.response.options[Number(parts[2])]; if (!option) throw new TypeError("Unknown option.");
      option[property] = raw;
    } else throw new TypeError("Unknown form control.");
  }
  entry.sheet = formSheetFromDraft(d);
}
export function moveFormField(entry, row, direction) {
  const d = formDraft(entry.sheet), to = row + direction;
  if (!Number.isInteger(row) || ![-1, 1].includes(direction) || row < 0 || to < 0 || row >= d.items.length || to >= d.items.length) throw new TypeError("Invalid field move.");
  [d.items[row], d.items[to]] = [d.items[to], d.items[row]];
  d.items.forEach((item, i) => { item.order = i + 1; }); entry.sheet = formSheetFromDraft(d);
}
export function changeFormOption(entry, row, action, index) {
  const d = formDraft(entry.sheet), response = d.items[row]?.response;
  if (response?.kind !== "singleChoice") throw new TypeError("Choose an existing single-choice field.");
  const options = response.options;
  if (action === "add") {
    let n = 1; while (options.some(o => o.optionId === `option-${n}`)) n++;
    options.push({ optionId: `option-${n}`, label: `Option ${n}`, order: options.length + 1 });
  } else if (Number.isInteger(index) && index >= 0 && index < options.length) {
    if (action === "remove") options.splice(index, 1);
    else if (action === "up" && index > 0) [options[index - 1], options[index]] = [options[index], options[index - 1]];
    else throw new TypeError("Invalid option action.");
  } else throw new TypeError("Unknown option.");
  options.forEach((o, i) => { o.order = i + 1; }); entry.sheet = formSheetFromDraft(d);
}
export function formPreviewMarkup(definition) {
  return `<p class="field-help">Design preview · answers here are not recorded.</p>${definition.items.map(item => `<fieldset class="sheet-options-content"><legend>${escape(item.prompt)} <span aria-label="Required">*</span></legend>${item.response.kind === "singleChoice" ? item.response.options.map(o => `<label><input type="radio" name="preview-${escape(item.itemId)}" value="${escape(o.optionId)}"> ${escape(o.label)}</label>`).join("") : `<input type="${item.response.kind === "integer" ? "number" : "text"}" aria-label="${escape(item.prompt)}" ${item.response.kind === "integer" ? `min="${item.response.min}" max="${item.response.max}" step="1"` : 'autocomplete="off"'}>`}</fieldset>`).join("")}`;
}
