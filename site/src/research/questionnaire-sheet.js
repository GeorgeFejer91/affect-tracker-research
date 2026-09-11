import { importQuestionnaireAuthoring } from "./questionnaire-authoring.js";
import {
  QUESTIONNAIRE_CSV_COLUMNS,
  QUESTIONNAIRE_CSV_FORMAT_VERSION,
  validateQuestionnaireDefinitionV1,
  verifyQuestionnaireDefinitionV1,
} from "./questionnaires.js";

export const QUESTIONNAIRE_SHEET_LIMITS = Object.freeze({
  rows: 1024, options: 64, bytes: 4 * 1024 * 1024, scoreAbs: 1_000_000_000,
});
const encoder = new TextEncoder();
const states = new WeakMap();
const ID = /^[a-z0-9][a-z0-9_-]{0,127}$/u;
const LANGUAGE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function safeText(value, maximum, label) {
  if (typeof value !== "string" || value.length > maximum || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new TypeError(`${label} must be text of at most ${maximum} characters without control characters.`);
  }
  return value;
}

function identity(familyId, language) {
  if (typeof familyId !== "string" || !ID.test(familyId)) throw new TypeError("Questionnaire family must be a safe lowercase identifier.");
  if (typeof language !== "string" || language.length > 80 || !LANGUAGE.test(language) || language.toLowerCase() === "und") {
    throw new TypeError("Select an explicit questionnaire language.");
  }
}

function score(value) {
  if (value === null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!DECIMAL.test(trimmed)) throw new TypeError("Response codes must be decimal numbers or blank; formulas are not accepted.");
    value = Number(trimmed);
  }
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > QUESTIONNAIRE_SHEET_LIMITS.scoreAbs) {
    throw new RangeError("Response codes must be finite numbers between -1000000000 and 1000000000.");
  }
  return Object.is(value, -0) ? 0 : value;
}

function stateFor(sheet) {
  const state = states.get(sheet);
  if (!state) throw new TypeError("Use a questionnaire sheet created by the sheet editor.");
  return state;
}

function copy(sheet) {
  return { ...sheet, optionLabels: [...sheet.optionLabels], rows: sheet.rows.map((row) => ({
    ...row, options: row.options.map((option) => ({ ...option })),
  })) };
}

/** Copy a draft for Undo, including its provenance and untouched-row bookkeeping. */
export function cloneQuestionnaireSheet(sheet) {
  const state = stateFor(sheet);
  const cloned = copy(sheet);
  states.set(cloned, {
    ...state,
    authoringResult: state.authoringResult ? structuredClone(state.authoringResult) : null,
    placeholders: new Set(state.placeholders),
  });
  return cloned;
}

function snapshot(sheet) {
  const { modified: _modified, ...content } = sheet;
  return JSON.stringify(content);
}

function draftBounds(sheet) {
  identity(sheet.familyId, sheet.language);
  if (typeof sheet.questionnaireId !== "string" || !ID.test(sheet.questionnaireId)) throw new TypeError("Questionnaire ID must be a safe lowercase identifier.");
  integer(sheet.optionCount, 2, QUESTIONNAIRE_SHEET_LIMITS.options, "Response-option count");
  if (!Array.isArray(sheet.rows)) throw new TypeError("Questionnaire rows must be an array.");
  integer(sheet.rows.length, 0, QUESTIONNAIRE_SHEET_LIMITS.rows, "Item count");
  for (const [key, maximum] of [["title", 500], ["questionnaireVersion", 120], ["instructions", 8000], ["attribution", 12000]]) {
    safeText(sheet[key], maximum, key);
  }
  if (!Array.isArray(sheet.optionLabels) || sheet.optionLabels.length !== sheet.optionCount) throw new TypeError("Response labels must match the option count.");
  sheet.optionLabels.forEach((label) => { if (label !== null) safeText(label, 500, "Response label"); });
  const ids = new Set();
  for (const row of sheet.rows) {
    if (!row || typeof row.itemId !== "string" || !ID.test(row.itemId) || ids.has(row.itemId)) throw new TypeError("Every item must have a unique safe ID.");
    ids.add(row.itemId);
    safeText(row.prompt, 4000, "Item prompt");
    if (typeof row.required !== "boolean") throw new TypeError("Required must be a boolean.");
    if (row.subscale !== null) safeText(row.subscale, 300, "Subscale");
    if (!Array.isArray(row.options)) throw new TypeError("Item options must be an array.");
    integer(row.options.length, 2, sheet.optionCount, "Item response-option count");
    const optionIds = new Set();
    for (const option of row.options) {
      if (!option || typeof option.optionId !== "string" || !ID.test(option.optionId) || optionIds.has(option.optionId)) throw new TypeError("Each item's response options must have unique safe IDs.");
      optionIds.add(option.optionId);
      safeText(option.label, 500, "Response label");
      if (typeof option.scoreValue !== "number" && option.scoreValue !== null) throw new TypeError("Stored response codes must be numbers or null.");
      score(option.scoreValue);
    }
  }
  if (encoder.encode(snapshot(sheet)).byteLength > QUESTIONNAIRE_SHEET_LIMITS.bytes) throw new RangeError("Questionnaire sheet exceeds the 4 MiB limit.");
}

function commit(sheet, candidate, touchedIds = []) {
  draftBounds(candidate);
  const state = stateFor(sheet);
  if (snapshot(candidate) === snapshot(sheet)) return sheet;
  candidate.modified = true;
  Object.assign(sheet, candidate);
  touchedIds.forEach((id) => state.placeholders.delete(id));
  return sheet;
}

function nextId(existing, prefix) {
  let index = 1;
  while (existing.has(`${prefix}${String(index).padStart(3, "0")}`)) index += 1;
  return `${prefix}${String(index).padStart(3, "0")}`;
}

function blankRow(sheet, itemId) {
  return { itemId, prompt: "", required: true, subscale: null, options: Array.from({ length: sheet.optionCount }, (_, index) => ({
    optionId: `option-${index + 1}`, label: sheet.optionLabels[index] ?? String(index + 1), scoreValue: index + 1,
  })) };
}

/** Mutable Setup draft only; its extra fields never enter a definition or package. */
export function createQuestionnaireSheet({ familyId, language, title = familyId, optionCount = 5, rowCount = 5 } = {}) {
  identity(familyId, language);
  integer(optionCount, 2, QUESTIONNAIRE_SHEET_LIMITS.options, "Response-option count");
  integer(rowCount, 0, QUESTIONNAIRE_SHEET_LIMITS.rows, "Item count");
  const sheet = {
    familyId, language, questionnaireId: `${familyId}-${language.toLowerCase()}`, questionnaireVersion: "1", title,
    instructions: "Choose one answer for each item.", attribution: "Researcher-authored questionnaire.",
    optionCount, optionLabels: Array.from({ length: optionCount }, (_, index) => String(index + 1)), rows: [], modified: false,
  };
  sheet.rows = Array.from({ length: rowCount }, (_, index) => blankRow(sheet, `item-${String(index + 1).padStart(3, "0")}`));
  draftBounds(sheet);
  states.set(sheet, { original: null, originalSnapshot: null, placeholders: new Set(sheet.rows.map((row) => row.itemId)) });
  return sheet;
}

/** Preserve imported identities, wording, heterogeneous options, scores and source until an edit. */
export function sheetFromDefinition(value, { familyId = value?.questionnaireId, authoringResult = null } = {}) {
  const definition = validateQuestionnaireDefinitionV1(value);
  identity(familyId, definition.language);
  if (authoringResult && JSON.stringify(authoringResult.definition) !== JSON.stringify(value)) throw new TypeError("Authoring receipt does not belong to this definition.");
  const optionCount = Math.max(...definition.items.map((item) => item.options.length));
  const optionLabels = Array.from({ length: optionCount }, (_, index) => {
    const label = definition.items[0].options[index]?.label;
    return label !== undefined && definition.items.every((item) => item.options[index]?.label === label) ? label : null;
  });
  const sheet = {
    familyId, language: definition.language, questionnaireId: definition.questionnaireId,
    questionnaireVersion: definition.questionnaireVersion, title: definition.title,
    instructions: definition.instructions, attribution: definition.attribution, optionCount, optionLabels,
    rows: definition.items.map(({ order: _order, options, ...item }) => ({
      ...item, options: options.map(({ order: _optionOrder, ...option }) => ({ ...option })),
    })), modified: false,
  };
  draftBounds(sheet);
  states.set(sheet, { original: definition, authoringResult, originalSnapshot: snapshot(sheet), placeholders: new Set() });
  return sheet;
}

/** Parse an explicit TSV/CSV rectangle. There is no content-based delimiter guessing or formula evaluation. */
export function parseSheetTable(text, { delimiter = "\t", maxColumns = 65, maxRows = 1024 } = {}) {
  integer(maxColumns, 1, 130, "Table column limit");
  integer(maxRows, 1, 1025, "Table row limit");
  if (typeof text !== "string" || text.length > QUESTIONNAIRE_SHEET_LIMITS.bytes
    || encoder.encode(text).byteLength > QUESTIONNAIRE_SHEET_LIMITS.bytes) throw new RangeError("Pasted table exceeds the 4 MiB limit.");
  if (delimiter !== "\t" && delimiter !== ",") throw new TypeError("Choose a tab or comma delimiter.");
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  if (source.includes("\uFEFF")) throw new TypeError("A table BOM is allowed only at the start.");
  const records = [];
  let record = [], field = "", quoted = false, closed = false;
  const append = (value) => {
    field += value;
    if (field.length > 4000) throw new RangeError("Pasted cells may not exceed 4000 characters.");
  };
  const finishField = () => {
    record.push(field); field = ""; closed = false;
    if (record.length > maxColumns) throw new RangeError(`Pasted table exceeds ${maxColumns} columns.`);
  };
  const finishRecord = () => {
    finishField(); records.push(record); record = [];
    if (records.length > maxRows) throw new RangeError(`Pasted table exceeds ${maxRows} rows.`);
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { append('"'); index += 1; }
        else { quoted = false; closed = true; }
      } else if (character === "\r") {
        if (source[index + 1] !== "\n") throw new TypeError("Pasted table contains a bare carriage return.");
        append("\r\n"); index += 1;
      } else append(character);
    } else if (character === delimiter) finishField();
    else if (character === "\n") finishRecord();
    else if (character === "\r") {
      if (source[index + 1] !== "\n") throw new TypeError("Pasted table contains a bare carriage return.");
      finishRecord(); index += 1;
    } else if (closed) throw new TypeError("Pasted table has characters after a closing quote.");
    else if (character === '"') {
      if (field.length) throw new TypeError("Quoted table cells must begin with a quote.");
      quoted = true;
    } else append(character);
  }
  if (quoted) throw new TypeError("Pasted table has an unclosed quoted cell.");
  if (closed || field.length || record.length) finishRecord();
  if (!records.length) return [];
  if (records.some((row) => row.length !== records[0].length)) throw new TypeError("Pasted table must be rectangular; include blank cells for missing codes.");
  return records;
}

function editCell(candidate, row, column, value) {
  if (column === 0) candidate.rows[row].prompt = safeText(value, 4000, "Item prompt");
  else {
    const option = candidate.rows[row].options[column - 1];
    if (!option) throw new RangeError("This item has fewer response options; change its option count before pasting here.");
    option.scoreValue = score(value);
  }
}

export function applySheetPaste(sheet, text, { row = 0, column = 0, delimiter = "\t" } = {}) {
  stateFor(sheet);
  integer(row, 0, QUESTIONNAIRE_SHEET_LIMITS.rows - 1, "Starting row");
  integer(column, 0, sheet.optionCount, "Starting column");
  const records = parseSheetTable(text, { delimiter });
  if (!records.length) return sheet;
  if (row + records.length > QUESTIONNAIRE_SHEET_LIMITS.rows || column + records[0].length > sheet.optionCount + 1) {
    throw new RangeError("Pasted table does not fit the available item rows and response-code columns.");
  }
  const candidate = copy(sheet);
  const existing = new Set(candidate.rows.map((item) => item.itemId));
  while (candidate.rows.length < row + records.length) {
    const itemId = nextId(existing, "item-"); existing.add(itemId);
    candidate.rows.push(blankRow(candidate, itemId));
  }
  records.forEach((record, r) => record.forEach((cell, c) => editCell(candidate, row + r, column + c, cell)));
  return commit(sheet, candidate, records.map((_record, r) => candidate.rows[row + r].itemId));
}

export function setSheetCell(sheet, row, column, value) {
  stateFor(sheet);
  integer(row, 0, sheet.rows.length - 1, "Item row");
  integer(column, 0, sheet.optionCount, "Item column");
  const candidate = copy(sheet);
  editCell(candidate, row, column, value);
  return commit(sheet, candidate, [candidate.rows[row].itemId]);
}

export function setOptionCount(sheet, count) {
  stateFor(sheet);
  integer(count, 2, QUESTIONNAIRE_SHEET_LIMITS.options, "Response-option count");
  if (count === sheet.optionCount) return sheet;
  const candidate = copy(sheet);
  candidate.optionCount = count;
  candidate.optionLabels = Array.from({ length: count }, (_, index) => index < sheet.optionLabels.length ? sheet.optionLabels[index] : String(index + 1));
  for (const row of candidate.rows) {
    row.options = row.options.slice(0, count);
    const unscored = row.options.every((option) => option.scoreValue === null);
    const ids = new Set(row.options.map((option) => option.optionId));
    while (row.options.length < count) {
      const index = row.options.length;
      const optionId = nextId(ids, "option-"); ids.add(optionId);
      row.options.push({ optionId, label: candidate.optionLabels[index] ?? String(index + 1), scoreValue: unscored ? null : index + 1 });
    }
  }
  return commit(sheet, candidate);
}

/** Null leaves a heterogeneous column intact; text explicitly applies that label to every existing item. */
export function setOptionLabels(sheet, labels) {
  stateFor(sheet);
  if (!Array.isArray(labels) || labels.length !== sheet.optionCount) throw new TypeError("Response labels must match the option count.");
  const candidate = copy(sheet);
  candidate.optionLabels = [...labels];
  labels.forEach((label, index) => {
    if (label !== null) {
      safeText(label, 500, "Response label");
      candidate.rows.forEach((row) => { if (row.options[index]) row.options[index].label = label; });
    }
  });
  return commit(sheet, candidate);
}

export function appendSheetRows(sheet, count = 1) {
  stateFor(sheet);
  integer(count, 1, QUESTIONNAIRE_SHEET_LIMITS.rows, "Added row count");
  if (sheet.rows.length + count > QUESTIONNAIRE_SHEET_LIMITS.rows) throw new RangeError("A questionnaire may contain at most 1024 items.");
  const candidate = copy(sheet);
  const ids = new Set(candidate.rows.map((row) => row.itemId));
  const added = [];
  for (let i = 0; i < count; i += 1) {
    const id = nextId(ids, "item-"); ids.add(id); added.push(id);
    candidate.rows.push(blankRow(candidate, id));
  }
  commit(sheet, candidate);
  added.forEach((id) => stateFor(sheet).placeholders.add(id));
  return sheet;
}

export function removeSheetRow(sheet, row) {
  stateFor(sheet);
  integer(row, 0, sheet.rows.length - 1, "Item row");
  const candidate = copy(sheet);
  const [removed] = candidate.rows.splice(row, 1);
  return commit(sheet, candidate, [removed.itemId]);
}

export function reverseSheetRowCodes(sheet, row) {
  stateFor(sheet);
  integer(row, 0, sheet.rows.length - 1, "Item row");
  const candidate = copy(sheet);
  const values = candidate.rows[row].options.map((option) => option.scoreValue).reverse();
  candidate.rows[row].options.forEach((option, index) => { option.scoreValue = values[index]; });
  return commit(sheet, candidate, [candidate.rows[row].itemId]);
}

function csvCell(value) {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The visible spreadsheet is an authoring projection, never a new wire schema. */
export function questionnaireGridColumns(sheet, layout = "labels-and-codes") {
  if (!["labels-and-codes", "codes-only"].includes(layout)) throw new TypeError("Unknown table layout.");
  return ["Item", ...Array.from({ length: sheet.optionCount }, (_, i) => layout === "codes-only"
    ? [`Code ${i + 1}`] : [`Answer ${i + 1}`, `Code ${i + 1}`]).flat(), "Required"];
}

export function questionnaireGridRows(sheet, layout = "labels-and-codes") {
  questionnaireGridColumns(sheet, layout);
  return sheet.rows.map((row) => [row.prompt, ...Array.from({ length: sheet.optionCount }, (_, i) => {
    const option = row.options[i];
    return layout === "codes-only" ? [option?.scoreValue ?? ""] : [option?.label ?? "", option?.scoreValue ?? ""];
  }).flat(), row.required ? "true" : "false"]);
}

function refreshSharedLabels(sheet) {
  sheet.optionLabels = Array.from({ length: sheet.optionCount }, (_, i) => {
    const label = sheet.rows[0]?.options[i]?.label;
    return label !== undefined && sheet.rows.every((r) => r.options[i]?.label === label) ? label : null;
  });
}

function editGridCell(candidate, row, column, value, layout) {
  const last = questionnaireGridColumns(candidate, layout).length - 1;
  if (column === 0) candidate.rows[row].prompt = safeText(String(value), 4000, "Item prompt");
  else if (column === last) {
    if (!["true", "false"].includes(String(value).trim().toLowerCase())) throw new TypeError("Required must be true or false.");
    candidate.rows[row].required = String(value).trim().toLowerCase() === "true";
  } else if (layout === "codes-only") editCell(candidate, row, column, value);
  else {
    const option = candidate.rows[row].options[Math.floor((column - 1) / 2)];
    if (!option) throw new RangeError("This item has no answer in that column; change the option count first.");
    if (column % 2) option.label = safeText(String(value), 500, "Answer label");
    else option.scoreValue = score(value);
  }
}

export function setQuestionnaireGridCell(sheet, row, column, value, layout = "labels-and-codes") {
  stateFor(sheet);
  integer(row, 0, sheet.rows.length - 1, "Item row");
  integer(column, 0, questionnaireGridColumns(sheet, layout).length - 1, "Table column");
  const candidate = copy(sheet);
  editGridCell(candidate, row, column, value, layout);
  refreshSharedLabels(candidate);
  return commit(sheet, candidate, [candidate.rows[row].itemId]);
}

/** Headered tables replace all rows; headerless rectangles update only the focused range. */
export function applyQuestionnaireGridPaste(sheet, text, { row = 0, column = 0, delimiter = "\t", layout = "labels-and-codes" } = {}) {
  stateFor(sheet);
  integer(row, 0, 1023, "Starting row");
  integer(column, 0, questionnaireGridColumns(sheet, layout).length - 1, "Starting column");
  let records = parseSheetTable(text, { delimiter, maxColumns: 130, maxRows: 1025 });
  if (!records.length) return { sheet, layout };
  const header = records[0];
  const hasHeader = /^(?:Item|Questionnaire item|Question)$/iu.test(header[0])
    && /^(?:Answer|Code) 1$/u.test(header[1] ?? "");
  const candidate = cloneQuestionnaireSheet(sheet);
  if (hasHeader) {
    if (row !== 0 || column !== 0) throw new TypeError("Paste a table with headers into the first item cell.");
    layout = header[1] === "Code 1" ? "codes-only" : "labels-and-codes";
    const required = header.at(-1) === "Required";
    const count = (header.length - 1 - Number(required)) / (layout === "codes-only" ? 1 : 2);
    integer(count, 2, 64, "Header answer-option count");
    const expected = questionnaireGridColumns({ optionCount: count }, layout);
    if (!required) expected.pop();
    if (header.slice(1).some((cell, i) => cell !== expected[i + 1])) throw new TypeError("Use ordered Answer 1, Code 1… columns and an optional final Required column.");
    setOptionCount(candidate, count);
    records = records.slice(1);
    if (!records.length) throw new TypeError("The pasted table has headers but no items.");
    candidate.rows = candidate.rows.slice(0, records.length);
  }
  if (row + records.length > 1024 || column + records[0].length > questionnaireGridColumns(candidate, layout).length) {
    throw new RangeError("Pasted range does not fit. Include the table headers to set the answer count automatically.");
  }
  const ids = new Set(candidate.rows.map((r) => r.itemId));
  while (candidate.rows.length < row + records.length) {
    const id = nextId(ids, "item-"); ids.add(id); candidate.rows.push(blankRow(candidate, id));
  }
  records.forEach((record, r) => {
    if (hasHeader) {
      const options = candidate.rows[r].options;
      const optionIds = new Set(options.map((o) => o.optionId));
      while (options.length < candidate.optionCount) {
        const id = nextId(optionIds, "option-"); optionIds.add(id);
        options.push({ optionId: id, label: candidate.optionLabels[options.length] ?? String(options.length + 1), scoreValue: null });
      }
    }
    record.forEach((cell, c) => {
      try { editGridCell(candidate, row + r, column + c, cell, layout); }
      catch (error) { throw new TypeError(`Item ${row + r + 1}, ${questionnaireGridColumns(candidate, layout)[column + c]}: ${error.message}`); }
    });
    // A full labelled export pads heterogeneous short rows with empty pairs.
    if (hasHeader && layout === "labels-and-codes") {
      const options = candidate.rows[r].options;
      while (options.length > 2 && options.at(-1).label === "" && options.at(-1).scoreValue === null) options.pop();
    }
  });
  refreshSharedLabels(candidate);
  commit(sheet, candidate, records.map((_r, i) => candidate.rows[row + i].itemId));
  return { sheet, layout };
}

/** Bounded text for an explicit copy/download gesture. Never reads the clipboard. */
export function serializeQuestionnaireGrid(sheet, { layout = "labels-and-codes", delimiter = "\t", header = true, range = null } = {}) {
  draftBounds(sheet);
  if (!["\t", ","].includes(delimiter)) throw new TypeError("Choose a tab or comma delimiter.");
  const columns = questionnaireGridColumns(sheet, layout);
  let rows = questionnaireGridRows(sheet, layout);
  if (range) {
    const { top, bottom, left, right } = range;
    integer(top, 0, rows.length - 1, "Selection first row"); integer(bottom, top, rows.length - 1, "Selection last row");
    integer(left, 0, columns.length - 1, "Selection first column"); integer(right, left, columns.length - 1, "Selection last column");
    rows = rows.slice(top, bottom + 1).map((r) => r.slice(left, right + 1));
    if (header) rows.unshift(columns.slice(left, right + 1));
  } else if (header) rows.unshift(columns);
  const output = rows.map((record) => record.map((value) => {
    const text = String(value);
    // Numeric negatives are valid codes; text that Excel could execute is not exported.
    if (typeof value !== "number" && /^[\s]*[=+@-]/u.test(text)) throw new TypeError("Formula-like text cannot be copied to Excel safely. Remove its leading formula character first.");
    return text.includes(delimiter) || /["\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(delimiter)).join("\r\n") + "\r\n";
  if (encoder.encode(output).byteLength > QUESTIONNAIRE_SHEET_LIMITS.bytes) throw new RangeError("Export exceeds the 4 MiB table limit.");
  return output;
}

/** Compile only explicit item data through the existing canonical importer. No runner contract is extended. */
export async function sheetToAuthoring(sheet) {
  const state = stateFor(sheet);
  draftBounds(sheet);
  if (state.original && snapshot(sheet) === state.originalSnapshot) {
    const definition = await verifyQuestionnaireDefinitionV1(state.original);
    return {
      ...(state.authoringResult ?? {}), definition, definitionSha256: definition.definitionSha256,
      sourceSha256: definition.source.sha256, sourceBytes: null, unchanged: true,
    };
  }
  const rows = sheet.rows.filter((row) => row.prompt !== "" || !state.placeholders.has(row.itemId)
    || row.required !== true || row.subscale !== null
    || row.options.some((option, index) => option.scoreValue !== index + 1));
  if (!rows.length) throw new TypeError("Add at least one questionnaire item before saving.");
  const metadata = [QUESTIONNAIRE_CSV_FORMAT_VERSION, sheet.questionnaireId, sheet.questionnaireVersion,
    sheet.title, sheet.language, sheet.instructions, sheet.attribution];
  const lines = [QUESTIONNAIRE_CSV_COLUMNS.join(",")];
  let byteLength = encoder.encode(`${lines[0]}\r\n`).byteLength;
  let optionRows = 0;
  for (const row of rows) {
    if (!row.prompt.trim()) throw new TypeError("Every edited item row needs a prompt; delete empty rows you do not need.");
    for (const option of row.options) {
      optionRows += 1;
      if (optionRows > 25000) throw new RangeError("The canonical questionnaire format supports at most 25000 response-option rows.");
      const line = [...metadata, row.itemId, row.prompt, row.required, row.subscale,
        option.optionId, option.label, option.scoreValue].map(csvCell).join(",");
      byteLength += encoder.encode(`${line}\r\n`).byteLength;
      if (byteLength > QUESTIONNAIRE_SHEET_LIMITS.bytes) throw new RangeError("The canonical questionnaire source exceeds the 4 MiB limit.");
      lines.push(line);
    }
  }
  const sourceBytes = encoder.encode(`${lines.join("\r\n")}\r\n`);
  const imported = await importQuestionnaireAuthoring(sourceBytes, {
    logicalName: `${sheet.questionnaireId}.csv`, sourceKind: "researcherCsv",
    sourceDocumentSha256: state.original?.source.sourceDocumentSha256 ?? state.original?.source.sha256 ?? null,
  });
  return { ...imported, sourceBytes, unchanged: false };
}
