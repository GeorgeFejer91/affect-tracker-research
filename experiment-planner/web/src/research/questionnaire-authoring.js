import { sha256Hex } from "./canonical.js";
import {
  QUESTIONNAIRE_CSV_COLUMNS,
  QUESTIONNAIRE_CSV_FORMAT_VERSION,
  importQuestionnaireCsv,
} from "./questionnaires.js";

export { QUESTIONNAIRE_CSV_FORMAT_VERSION };
export const QUESTIONNAIRE_TXT_FORMAT_VERSION = "questionnaire-txt-v1";
export const QUESTIONNAIRE_JSON_FORMAT_VERSION = "questionnaire-json-v1";

const MAX_AUTHORING_BYTES = 4 * 1024 * 1024;
const MAX_AUTHORING_ROWS = 25_000;
const MAX_FIELD_CHARACTERS = 16_384;
const MAX_ITEMS = 1_024;
const MAX_OPTIONS_PER_ITEM = 64;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const FORBIDDEN_LOGICAL_NAME = /[\\/:\p{Cc}\p{Cf}]/u;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const ROOT_KEYS = Object.freeze([
  "format_version",
  "questionnaire_id",
  "questionnaire_version",
  "title",
  "language",
  "instructions",
  "attribution",
  "items",
]);
const ITEM_KEYS = Object.freeze(["item_id", "prompt", "required", "subscale", "options"]);
const OPTION_KEYS = Object.freeze(["option_id", "option_label", "score_value"]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const member of Object.values(value)) deepFreeze(member);
  return Object.freeze(value);
}

function cloneBytes(input) {
  if (typeof input === "string") return encoder.encode(input);
  if (input instanceof Uint8Array) return new Uint8Array(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
  }
  throw new TypeError("Questionnaire authoring input must be UTF-8 text or bytes.");
}

function logicalFilename(value) {
  if (typeof value !== "string") throw new TypeError("Questionnaire authoring logicalName must be text.");
  const normalized = value.trim().normalize("NFC");
  if (normalized !== value || normalized.length < 1 || normalized.length > 255
    || normalized === "." || normalized === ".." || FORBIDDEN_LOGICAL_NAME.test(normalized)) {
    throw new TypeError("Questionnaire authoring logicalName must be a canonical path-free filename.");
  }
  return normalized;
}

function normalizedMimeType(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new TypeError("Questionnaire authoring mimeType must be text.");
  const normalized = value.split(";", 1)[0].trim().toLowerCase();
  if (!normalized) throw new TypeError("Questionnaire authoring mimeType must not be blank.");
  return normalized;
}

function formatFromExtension(logicalName) {
  const extension = /\.([^.]+)$/u.exec(logicalName)?.[1]?.toLowerCase();
  if (extension === "csv") return QUESTIONNAIRE_CSV_FORMAT_VERSION;
  if (extension === "txt") return QUESTIONNAIRE_TXT_FORMAT_VERSION;
  if (extension === "json") return QUESTIONNAIRE_JSON_FORMAT_VERSION;
  return null;
}

function formatFromMimeType(mimeType) {
  if (mimeType === "text/csv" || mimeType === "application/csv"
    || mimeType === "application/vnd.ms-excel") return QUESTIONNAIRE_CSV_FORMAT_VERSION;
  if (mimeType === "text/plain" || mimeType === "text/tab-separated-values") {
    return QUESTIONNAIRE_TXT_FORMAT_VERSION;
  }
  if (mimeType === "application/json" || mimeType === "text/json" || mimeType?.endsWith("+json")) {
    return QUESTIONNAIRE_JSON_FORMAT_VERSION;
  }
  return null;
}

/** Resolve one supported authoring format without inspecting or guessing from file contents. */
export function detectQuestionnaireAuthoringFormat(logicalName, mimeType) {
  const filename = logicalFilename(logicalName);
  const normalizedMime = normalizedMimeType(mimeType);
  const extensionFormat = formatFromExtension(filename);
  const mimeFormat = formatFromMimeType(normalizedMime);
  if (extensionFormat && mimeFormat && extensionFormat !== mimeFormat) {
    throw new TypeError("Questionnaire authoring filename extension and MIME type disagree.");
  }
  const format = extensionFormat ?? mimeFormat;
  if (!format) {
    throw new TypeError("Questionnaire authoring format must be CSV, TXT, or JSON.");
  }
  return format;
}

function decodeAuthoringText(bytes, label) {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_AUTHORING_BYTES) {
    throw new RangeError(`${label} must contain 1–${MAX_AUTHORING_BYTES} bytes.`);
  }
  if (bytes.byteLength >= 2
    && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    throw new TypeError(`${label} must use UTF-8, not UTF-16.`);
  }
  const hasUtf8Bom = bytes.byteLength >= 3
    && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const text = decoder.decode(bytes.subarray(hasUtf8Bom ? 3 : 0));
  if (text.includes("\uFEFF")) throw new TypeError(`${label} may contain a BOM only at byte zero.`);
  return text;
}

function exactObject(value, path, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${path} must be an object.`);
  }
  const allowed = new Set(keys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${path} contains unknown field ${unknown}.`);
  const missing = keys.find((key) => !Object.hasOwn(value, key));
  if (missing) throw new TypeError(`${path} is missing required field ${missing}.`);
  return value;
}

// JSON.parse accepts duplicate keys, so scan the complete grammar before parsing.
function parseStrictJson(text) {
  let index = 0;
  const whitespace = /[\u0009\u000a\u000d\u0020]/u;
  const skip = () => { while (index < text.length && whitespace.test(text[index])) index += 1; };
  const syntax = (message) => { throw new SyntaxError(`${message} at character ${index}.`); };
  const stringToken = () => {
    if (text[index] !== '"') syntax("Expected a JSON string");
    const start = index++;
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        try { return JSON.parse(text.slice(start, index)); } catch { syntax("Invalid JSON string"); }
      }
      if (character === "\\") {
        index += 1;
        if (index >= text.length) syntax("Unterminated JSON escape");
        if (text[index] === "u") {
          if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(index + 1, index + 5))) syntax("Invalid Unicode escape");
          index += 4;
        } else if (!/["\\/bfnrt]/u.test(text[index])) syntax("Invalid JSON escape");
      } else if (character.charCodeAt(0) <= 0x1f) syntax("Unescaped control character");
      index += 1;
    }
    syntax("Unterminated JSON string");
  };
  const valueToken = () => {
    skip();
    if (text[index] === "{") {
      index += 1;
      skip();
      const keys = new Set();
      if (text[index] === "}") { index += 1; return; }
      while (index < text.length) {
        skip();
        const key = stringToken();
        if (keys.has(key)) throw new SyntaxError(`Duplicate JSON key ${JSON.stringify(key)}.`);
        keys.add(key);
        skip();
        if (text[index] !== ":") syntax("Expected ':' after object key");
        index += 1;
        valueToken();
        skip();
        if (text[index] === "}") { index += 1; return; }
        if (text[index] !== ",") syntax("Expected ',' or '}'");
        index += 1;
      }
      syntax("Unterminated JSON object");
    }
    if (text[index] === "[") {
      index += 1;
      skip();
      if (text[index] === "]") { index += 1; return; }
      while (index < text.length) {
        valueToken();
        skip();
        if (text[index] === "]") { index += 1; return; }
        if (text[index] !== ",") syntax("Expected ',' or ']'");
        index += 1;
      }
      syntax("Unterminated JSON array");
    }
    if (text[index] === '"') { stringToken(); return; }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, index)) { index += literal.length; return; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(index))?.[0];
    if (!number) syntax("Expected a JSON value");
    index += number.length;
  };
  valueToken();
  skip();
  if (index !== text.length) syntax("Unexpected trailing content");
  return JSON.parse(text);
}

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function canonicalCsvBytes(rows) {
  if (rows.length < 2 || rows.length - 1 > MAX_AUTHORING_ROWS) {
    throw new RangeError(`Questionnaire authoring input must contain 1–${MAX_AUTHORING_ROWS} option rows.`);
  }
  const lines = [];
  let byteLength = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== QUESTIONNAIRE_CSV_COLUMNS.length) {
      throw new TypeError(`Questionnaire authoring rows must contain exactly ${QUESTIONNAIRE_CSV_COLUMNS.length} columns.`);
    }
    for (const field of row) {
      if (typeof field !== "string") throw new TypeError("Questionnaire authoring tabular fields must be text.");
      if (field.length > MAX_FIELD_CHARACTERS) {
        throw new RangeError(`Questionnaire authoring fields may not exceed ${MAX_FIELD_CHARACTERS} characters.`);
      }
    }
    const line = `${row.map(csvCell).join(",")}\r\n`;
    byteLength += encoder.encode(line).byteLength;
    if (byteLength > MAX_AUTHORING_BYTES) {
      throw new RangeError(`Canonical Questionnaire CSV must not exceed ${MAX_AUTHORING_BYTES} bytes.`);
    }
    lines.push(line);
  }
  return encoder.encode(lines.join(""));
}

function rowsFromTxt(text) {
  if (/\r(?!\n)/u.test(text)) {
    throw new TypeError("Questionnaire TXT contains a bare carriage return.");
  }
  const records = text.split(/\r\n|\n/u);
  if (records.at(-1) === "") records.pop();
  if (records.length < 2 || records.length - 1 > MAX_AUTHORING_ROWS) {
    throw new RangeError(`Questionnaire TXT must contain a header and 1–${MAX_AUTHORING_ROWS} option rows.`);
  }
  const rows = records.map((record, index) => {
    const fields = record.split("\t");
    if (fields.length !== QUESTIONNAIRE_CSV_COLUMNS.length) {
      throw new TypeError(`Questionnaire TXT row ${index + 1} must contain exactly ${QUESTIONNAIRE_CSV_COLUMNS.length} tab-delimited columns.`);
    }
    if (fields.some((field) => field.length > MAX_FIELD_CHARACTERS)) {
      throw new RangeError(`Questionnaire TXT row ${index + 1} contains an oversized field.`);
    }
    return fields;
  });
  if (!rows[0].every((field, index) => field === QUESTIONNAIRE_CSV_COLUMNS[index])) {
    throw new TypeError(`Questionnaire TXT header must be exactly: ${QUESTIONNAIRE_CSV_COLUMNS.join("\\t")}.`);
  }
  return [
    [...QUESTIONNAIRE_CSV_COLUMNS],
    ...rows.slice(1).map((row, index) => {
      if (row[0] !== QUESTIONNAIRE_TXT_FORMAT_VERSION) {
        throw new TypeError(`Questionnaire TXT row ${index + 2}.format_version must be exactly ${QUESTIONNAIRE_TXT_FORMAT_VERSION}.`);
      }
      return [QUESTIONNAIRE_CSV_FORMAT_VERSION, ...row.slice(1)];
    }),
  ];
}

function textValue(value, path) {
  if (typeof value !== "string") throw new TypeError(`${path} must be text.`);
  return value;
}

function rowsFromJson(value) {
  const root = exactObject(value, "Questionnaire JSON", ROOT_KEYS);
  if (root.format_version !== QUESTIONNAIRE_JSON_FORMAT_VERSION) {
    throw new TypeError(`Questionnaire JSON format_version must be exactly ${QUESTIONNAIRE_JSON_FORMAT_VERSION}.`);
  }
  for (const key of [
    "questionnaire_id", "questionnaire_version", "title", "language", "instructions", "attribution",
  ]) textValue(root[key], `Questionnaire JSON.${key}`);
  if (!Array.isArray(root.items) || root.items.length < 1 || root.items.length > MAX_ITEMS) {
    throw new RangeError(`Questionnaire JSON.items must contain 1–${MAX_ITEMS} items.`);
  }
  const metadata = [
    QUESTIONNAIRE_CSV_FORMAT_VERSION,
    root.questionnaire_id,
    root.questionnaire_version,
    root.title,
    root.language,
    root.instructions,
    root.attribution,
  ];
  const rows = [[...QUESTIONNAIRE_CSV_COLUMNS]];
  for (let itemIndex = 0; itemIndex < root.items.length; itemIndex += 1) {
    const path = `Questionnaire JSON.items[${itemIndex}]`;
    const item = exactObject(root.items[itemIndex], path, ITEM_KEYS);
    textValue(item.item_id, `${path}.item_id`);
    textValue(item.prompt, `${path}.prompt`);
    if (typeof item.required !== "boolean") throw new TypeError(`${path}.required must be a boolean.`);
    if (item.subscale !== null) textValue(item.subscale, `${path}.subscale`);
    if (!Array.isArray(item.options) || item.options.length < 2
      || item.options.length > MAX_OPTIONS_PER_ITEM) {
      throw new RangeError(`${path}.options must contain 2–${MAX_OPTIONS_PER_ITEM} choices.`);
    }
    if (rows.length - 1 + item.options.length > MAX_AUTHORING_ROWS) {
      throw new RangeError(`Questionnaire JSON may not exceed ${MAX_AUTHORING_ROWS} option rows.`);
    }
    for (let optionIndex = 0; optionIndex < item.options.length; optionIndex += 1) {
      const optionPath = `${path}.options[${optionIndex}]`;
      const option = exactObject(item.options[optionIndex], optionPath, OPTION_KEYS);
      textValue(option.option_id, `${optionPath}.option_id`);
      textValue(option.option_label, `${optionPath}.option_label`);
      if (option.score_value !== null
        && (typeof option.score_value !== "number" || !Number.isFinite(option.score_value))) {
        throw new TypeError(`${optionPath}.score_value must be a finite number or null.`);
      }
      rows.push([
        ...metadata,
        item.item_id,
        item.prompt,
        item.required ? "true" : "false",
        item.subscale ?? "",
        option.option_id,
        option.option_label,
        option.score_value === null ? "" : String(Object.is(option.score_value, -0) ? 0 : option.score_value),
      ]);
    }
  }
  return rows;
}

function canonicalCsvLogicalName(logicalName) {
  return logicalName.replace(/\.[^.]+$/u, ".csv");
}

function validateSourceDocumentSha256(value) {
  if (value !== null && (typeof value !== "string" || !HASH_PATTERN.test(value))) {
    throw new TypeError("Questionnaire authoring sourceDocumentSha256 must be a lowercase SHA-256 digest or null.");
  }
  return value;
}

/** Convert a supported authoring document through the existing Questionnaire CSV v1 authority. */
export async function importQuestionnaireAuthoring(input, options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError("Questionnaire authoring options must be an object.");
  }
  const allowedOptions = new Set(["logicalName", "sourceKind", "sourceDocumentSha256"]);
  const unknown = Object.keys(options).find((key) => !allowedOptions.has(key));
  if (unknown) throw new TypeError(`Questionnaire authoring options contain unknown field ${unknown}.`);
  if (!Object.hasOwn(options, "logicalName")) {
    throw new TypeError("Questionnaire authoring options are missing required field logicalName.");
  }

  const logicalName = logicalFilename(options.logicalName);
  const sourceKind = options.sourceKind ?? "researcherCsv";
  const suppliedSourceDocumentSha256 = validateSourceDocumentSha256(
    options.sourceDocumentSha256 ?? null,
  );
  const formatVersion = detectQuestionnaireAuthoringFormat(logicalName);
  const originalBytes = cloneBytes(input);
  if (originalBytes.byteLength < 1 || originalBytes.byteLength > MAX_AUTHORING_BYTES) {
    throw new RangeError(`Questionnaire authoring input must contain 1–${MAX_AUTHORING_BYTES} bytes.`);
  }
  const originalSha256 = await sha256Hex(originalBytes);

  let canonicalBytes = originalBytes;
  let canonicalLogicalName = logicalName;
  let sourceDocumentSha256 = suppliedSourceDocumentSha256;
  if (formatVersion === QUESTIONNAIRE_TXT_FORMAT_VERSION) {
    const text = decodeAuthoringText(originalBytes, "Questionnaire TXT");
    canonicalBytes = canonicalCsvBytes(rowsFromTxt(text));
    canonicalLogicalName = canonicalCsvLogicalName(logicalName);
    sourceDocumentSha256 = originalSha256;
  } else if (formatVersion === QUESTIONNAIRE_JSON_FORMAT_VERSION) {
    const text = decodeAuthoringText(originalBytes, "Questionnaire JSON");
    canonicalBytes = canonicalCsvBytes(rowsFromJson(parseStrictJson(text)));
    canonicalLogicalName = canonicalCsvLogicalName(logicalName);
    sourceDocumentSha256 = originalSha256;
  }

  const imported = await importQuestionnaireCsv(canonicalBytes, {
    sourceKind,
    logicalName: canonicalLogicalName,
    sourceDocumentSha256,
  });
  const canonicalCsvSha256 = imported.sourceSha256;
  return deepFreeze({
    ...imported,
    authoringReceipt: {
      original: {
        formatVersion,
        logicalName,
        sha256: originalSha256,
        byteLength: originalBytes.byteLength,
      },
      canonicalCsv: {
        sha256: canonicalCsvSha256,
        byteLength: canonicalBytes.byteLength,
      },
    },
  });
}
