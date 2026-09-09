import { canonicalSha256, sha256Hex } from "./canonical.js";

export const QUESTIONNAIRE_CSV_FORMAT_VERSION = "questionnaire-csv-v1";
export const QUESTIONNAIRE_DEFINITION_SCHEMA = "affect-research-questionnaire-definition";
export const QUESTIONNAIRE_MODULE_SCHEMA = "affect-research-questionnaire-module";
export const QUESTIONNAIRE_RESPONSE_SCHEMA = "affect-research-questionnaire-response";

export const QUESTIONNAIRE_CSV_COLUMNS = Object.freeze([
  "format_version",
  "questionnaire_id",
  "questionnaire_version",
  "title",
  "language",
  "instructions",
  "attribution",
  "item_id",
  "prompt",
  "required",
  "subscale",
  "option_id",
  "option_label",
  "score_value",
]);

export const QUESTIONNAIRE_RESPONSE_COLUMNS = Object.freeze([
  "schema",
  "version",
  "sequence",
  "runId",
  "participantId",
  "attemptNumber",
  "settingsSha256",
  "assignmentPlanSha256",
  "protocolPlanSha256",
  "protocolStepPosition",
  "moduleId",
  "questionnaireId",
  "questionnaireVersion",
  "definitionSha256",
  "itemId",
  "itemOrder",
  "optionId",
  "optionOrder",
  "responseLabel",
  "scoreValue",
  "subscale",
  "status",
  "wallTimeUtc",
  "monotonicTimeNs",
  "responseLatencyMs",
]);

const MAX_CSV_BYTES = 4 * 1024 * 1024;
const MAX_CSV_ROWS = 25_000;
const MAX_FIELD_CHARACTERS = 16_384;
const MAX_ITEMS = 1_024;
const MAX_OPTIONS_PER_ITEM = 64;
const MAX_SCORE_ABS = 1_000_000_000;
const MAX_RESPONSE_LATENCY_MS = 24 * 60 * 60 * 1_000;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/u;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const PARTICIPANT_PATTERN = /^P\d{3,6}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MONOTONIC_NS_PATTERN = /^(0|[1-9]\d{0,29})$/u;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const FORBIDDEN_TEXT = /[\p{Cc}\p{Cf}]/u;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, path, required) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object.`);
  const allowed = new Set(required);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`${path} contains unknown field ${unknown[0]}.`);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  if (missing.length) throw new TypeError(`${path} is missing required field ${missing[0]}.`);
  return value;
}

function canonicalText(value, path, { minimum = 1, maximum = 500, nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string") throw new TypeError(`${path} must be text.`);
  const normalized = value.trim().normalize("NFC");
  if (normalized !== value || normalized.length < minimum || normalized.length > maximum
    || FORBIDDEN_TEXT.test(normalized)) {
    throw new RangeError(`${path} must contain ${minimum}–${maximum} canonical safe characters.`);
  }
  return normalized;
}

function identifier(value, path) {
  const normalized = canonicalText(value, path, { maximum: 128 });
  if (!ID_PATTERN.test(normalized)) throw new TypeError(`${path} must be a safe lowercase identifier.`);
  return normalized;
}

function sha256(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function logicalName(value, path) {
  const normalized = canonicalText(value, path, { maximum: 255 });
  if (normalized === "." || normalized === ".." || /[\\/:]/u.test(normalized)) {
    throw new TypeError(`${path} must be a path-free logical filename.`);
  }
  return normalized;
}

function safeInteger(value, path, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${path} must be an integer within ${minimum}–${maximum}.`);
  }
  return value;
}

function finiteNumber(value, path, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${path} must be finite and within ${minimum}–${maximum}.`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function nullableScore(value, path) {
  return value === null ? null : finiteNumber(value, path, -MAX_SCORE_ABS, MAX_SCORE_ABS);
}

function canonicalUtc(value, path) {
  const normalized = canonicalText(value, path, { maximum: 40 });
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new TypeError(`${path} must be a canonical UTC ISO-8601 timestamp.`);
  }
  return normalized;
}

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
  throw new TypeError("Questionnaire CSV input must be UTF-8 text or bytes.");
}

function decodedCsv(bytes) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CSV_BYTES) {
    throw new RangeError(`Questionnaire CSV must contain 1–${MAX_CSV_BYTES} bytes.`);
  }
  let start = 0;
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  if (bytes.byteLength >= 2
    && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    throw new TypeError("Questionnaire CSV must use UTF-8, not UTF-16.");
  }
  const output = decoder.decode(bytes.subarray(start));
  if (output.includes("\uFEFF")) throw new TypeError("Questionnaire CSV may contain a BOM only at byte zero.");
  return output;
}

/**
 * Parse an RFC 4180 CSV document. CRLF and LF records are accepted so the
 * authoring template remains portable through repositories with enforced LF.
 */
export function parseQuestionnaireCsvRecords(value) {
  if (typeof value !== "string") throw new TypeError("Questionnaire CSV parser input must be text.");
  let source = value.startsWith("\uFEFF") ? value.slice(1) : value;
  if (source.length > MAX_CSV_BYTES) throw new RangeError("Questionnaire CSV text exceeds the byte safety bound.");
  if (source.includes("\uFEFF")) throw new TypeError("Questionnaire CSV may contain a BOM only at the beginning.");

  const records = [];
  let record = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;

  const append = (character) => {
    field += character;
    if (field.length > MAX_FIELD_CHARACTERS) {
      throw new RangeError(`Questionnaire CSV fields may not exceed ${MAX_FIELD_CHARACTERS} characters.`);
    }
  };
  const finishField = () => {
    record.push(field);
    field = "";
    afterQuote = false;
    if (record.length > QUESTIONNAIRE_CSV_COLUMNS.length) {
      throw new RangeError(`Questionnaire CSV rows may not exceed ${QUESTIONNAIRE_CSV_COLUMNS.length} columns.`);
    }
  };
  const finishRecord = () => {
    finishField();
    records.push(record);
    record = [];
    if (records.length > MAX_CSV_ROWS + 1) {
      throw new RangeError(`Questionnaire CSV may not exceed ${MAX_CSV_ROWS} data rows.`);
    }
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          append('"');
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else if (character === "\r") {
        if (source[index + 1] !== "\n") throw new TypeError("Questionnaire CSV contains a bare carriage return.");
        append("\r\n");
        index += 1;
      } else {
        append(character);
      }
      continue;
    }

    if (afterQuote) {
      if (character === ",") {
        finishField();
      } else if (character === "\r") {
        if (source[index + 1] !== "\n") throw new TypeError("Questionnaire CSV contains a bare carriage return.");
        finishRecord();
        index += 1;
      } else if (character === "\n") {
        finishRecord();
      } else {
        throw new TypeError("Questionnaire CSV contains characters after a closing quote.");
      }
      continue;
    }

    if (character === '"') {
      if (field.length !== 0) throw new TypeError("Questionnaire CSV quotes must begin at the start of a field.");
      inQuotes = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\r") {
      if (source[index + 1] !== "\n") throw new TypeError("Questionnaire CSV contains a bare carriage return.");
      finishRecord();
      index += 1;
    } else if (character === "\n") {
      finishRecord();
    } else {
      append(character);
    }
  }

  if (inQuotes) throw new TypeError("Questionnaire CSV contains an unterminated quoted field.");
  if (afterQuote || field.length > 0 || record.length > 0) finishRecord();
  return records;
}

function parseRequired(value, path) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new TypeError(`${path} must be exactly true or false.`);
}

function parseScore(value, path) {
  if (value === "") return null;
  if (!DECIMAL_PATTERN.test(value)) throw new TypeError(`${path} must be a finite decimal number or blank.`);
  const parsed = Number(value);
  return finiteNumber(parsed, path, -MAX_SCORE_ABS, MAX_SCORE_ABS);
}

function rowMetadata(row) {
  return row.slice(0, 7);
}

function sameCells(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateLanguage(value, path) {
  const language = canonicalText(value, path, { maximum: 80 });
  if (!LANGUAGE_PATTERN.test(language)) throw new TypeError(`${path} must be a bounded language tag.`);
  return language;
}

function normalizeOption(value, path, expectedOrder) {
  exactObject(value, path, ["optionId", "order", "label", "scoreValue"]);
  return {
    optionId: identifier(value.optionId, `${path}.optionId`),
    order: safeInteger(value.order, `${path}.order`, expectedOrder, expectedOrder),
    label: canonicalText(value.label, `${path}.label`, { maximum: 500 }),
    scoreValue: nullableScore(value.scoreValue, `${path}.scoreValue`),
  };
}

function normalizeItem(value, path, expectedOrder) {
  exactObject(value, path, ["itemId", "order", "prompt", "required", "subscale", "options"]);
  if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > MAX_OPTIONS_PER_ITEM) {
    throw new RangeError(`${path}.options must contain 2–${MAX_OPTIONS_PER_ITEM} choices.`);
  }
  const optionIds = new Set();
  const options = value.options.map((option, index) => {
    const normalized = normalizeOption(option, `${path}.options[${index}]`, index + 1);
    if (optionIds.has(normalized.optionId)) throw new TypeError(`${path} contains duplicate option ID ${normalized.optionId}.`);
    optionIds.add(normalized.optionId);
    return normalized;
  });
  const scored = options.filter(({ scoreValue }) => scoreValue !== null).length;
  if (scored !== 0 && scored !== options.length) {
    throw new TypeError(`${path}.options must either all declare scoreValue or all leave it blank.`);
  }
  if (typeof value.required !== "boolean") throw new TypeError(`${path}.required must be a boolean.`);
  return {
    itemId: identifier(value.itemId, `${path}.itemId`),
    order: safeInteger(value.order, `${path}.order`, expectedOrder, expectedOrder),
    prompt: canonicalText(value.prompt, `${path}.prompt`, { maximum: 4_000 }),
    required: value.required,
    subscale: canonicalText(value.subscale, `${path}.subscale`, { maximum: 300, nullable: true }),
    options,
  };
}

/** Validate the closed, immutable QuestionnaireDefinitionV1 structure. */
export function validateQuestionnaireDefinitionV1(value) {
  exactObject(value, "QuestionnaireDefinitionV1", [
    "schema",
    "version",
    "questionnaireId",
    "questionnaireVersion",
    "title",
    "language",
    "instructions",
    "attribution",
    "source",
    "items",
    "definitionSha256",
  ]);
  if (value.schema !== QUESTIONNAIRE_DEFINITION_SCHEMA || value.version !== 1) {
    throw new TypeError("QuestionnaireDefinitionV1 has an unsupported schema or version.");
  }
  exactObject(value.source, "QuestionnaireDefinitionV1.source", [
    "kind",
    "logicalName",
    "sourceDocumentSha256",
    "formatVersion",
    "byteLength",
    "sha256",
  ]);
  if (value.source.kind !== "bundled" && value.source.kind !== "researcherCsv") {
    throw new TypeError("QuestionnaireDefinitionV1.source.kind must be bundled or researcherCsv.");
  }
  if (value.source.formatVersion !== QUESTIONNAIRE_CSV_FORMAT_VERSION) {
    throw new TypeError("QuestionnaireDefinitionV1.source.formatVersion is unsupported.");
  }
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > MAX_ITEMS) {
    throw new RangeError(`QuestionnaireDefinitionV1.items must contain 1–${MAX_ITEMS} items.`);
  }
  const itemIds = new Set();
  const items = value.items.map((item, index) => {
    const normalized = normalizeItem(item, `QuestionnaireDefinitionV1.items[${index}]`, index + 1);
    if (itemIds.has(normalized.itemId)) {
      throw new TypeError(`QuestionnaireDefinitionV1 contains duplicate item ID ${normalized.itemId}.`);
    }
    itemIds.add(normalized.itemId);
    return normalized;
  });
  const normalized = {
    schema: QUESTIONNAIRE_DEFINITION_SCHEMA,
    version: 1,
    questionnaireId: identifier(value.questionnaireId, "QuestionnaireDefinitionV1.questionnaireId"),
    questionnaireVersion: canonicalText(value.questionnaireVersion, "QuestionnaireDefinitionV1.questionnaireVersion", { maximum: 120 }),
    title: canonicalText(value.title, "QuestionnaireDefinitionV1.title", { maximum: 500 }),
    language: validateLanguage(value.language, "QuestionnaireDefinitionV1.language"),
    instructions: canonicalText(value.instructions, "QuestionnaireDefinitionV1.instructions", { maximum: 8_000 }),
    attribution: canonicalText(value.attribution, "QuestionnaireDefinitionV1.attribution", { maximum: 12_000 }),
    source: {
      kind: value.source.kind,
      logicalName: logicalName(value.source.logicalName, "QuestionnaireDefinitionV1.source.logicalName"),
      sourceDocumentSha256: sha256(
        value.source.sourceDocumentSha256,
        "QuestionnaireDefinitionV1.source.sourceDocumentSha256",
        { nullable: true },
      ),
      formatVersion: QUESTIONNAIRE_CSV_FORMAT_VERSION,
      byteLength: safeInteger(value.source.byteLength, "QuestionnaireDefinitionV1.source.byteLength", 1, MAX_CSV_BYTES),
      sha256: sha256(value.source.sha256, "QuestionnaireDefinitionV1.source.sha256"),
    },
    items,
    definitionSha256: sha256(value.definitionSha256, "QuestionnaireDefinitionV1.definitionSha256"),
  };
  return deepFreeze(normalized);
}

/** Recompute and enforce the definition's canonical self-hash. */
export async function verifyQuestionnaireDefinitionV1(value) {
  const definition = validateQuestionnaireDefinitionV1(value);
  const actual = await canonicalSha256(definition, { omitRootKeys: ["definitionSha256"] });
  if (actual !== definition.definitionSha256) {
    throw new TypeError("QuestionnaireDefinitionV1.definitionSha256 does not match its canonical content.");
  }
  return definition;
}

/** Import a bounded UTF-8 Questionnaire CSV v1 file into its immutable contract. */
export async function importQuestionnaireCsv(input, options = {}) {
  if (!isPlainObject(options)) throw new TypeError("Questionnaire CSV import options must be an object.");
  const unknownOptions = Object.keys(options).filter((key) => ![
    "sourceKind",
    "logicalName",
    "sourceDocumentSha256",
  ].includes(key));
  if (unknownOptions.length) {
    throw new TypeError(`Questionnaire CSV import options contain unknown field ${unknownOptions[0]}.`);
  }
  const sourceKind = options.sourceKind ?? "researcherCsv";
  if (sourceKind !== "bundled" && sourceKind !== "researcherCsv") {
    throw new TypeError("Questionnaire CSV sourceKind must be bundled or researcherCsv.");
  }
  const normalizedLogicalName = logicalName(options.logicalName ?? "questionnaire.csv", "Questionnaire CSV logicalName");
  const normalizedSourceDocumentSha256 = sha256(
    options.sourceDocumentSha256 ?? null,
    "Questionnaire CSV sourceDocumentSha256",
    { nullable: true },
  );
  const bytes = cloneBytes(input);
  const sourceText = decodedCsv(bytes);
  const records = parseQuestionnaireCsvRecords(sourceText);
  if (records.length < 3) throw new RangeError("Questionnaire CSV must contain a header and at least two option rows.");
  const [header, ...rows] = records;
  if (!sameCells(header, QUESTIONNAIRE_CSV_COLUMNS)) {
    throw new TypeError(`Questionnaire CSV header must be exactly: ${QUESTIONNAIRE_CSV_COLUMNS.join(",")}.`);
  }
  if (rows.length > MAX_CSV_ROWS) throw new RangeError(`Questionnaire CSV may not exceed ${MAX_CSV_ROWS} data rows.`);
  const metadata = rowMetadata(rows[0]);
  const seenItems = new Set();
  const items = [];
  let active = null;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const path = `Questionnaire CSV row ${rowIndex + 2}`;
    if (row.length !== QUESTIONNAIRE_CSV_COLUMNS.length) {
      throw new TypeError(`${path} must contain exactly ${QUESTIONNAIRE_CSV_COLUMNS.length} columns.`);
    }
    if (row[0] !== QUESTIONNAIRE_CSV_FORMAT_VERSION) {
      throw new TypeError(`${path}.format_version must be exactly ${QUESTIONNAIRE_CSV_FORMAT_VERSION}.`);
    }
    if (!sameCells(rowMetadata(row), metadata)) {
      throw new TypeError(`${path} changes questionnaire metadata within one definition.`);
    }

    const itemId = identifier(row[7], `${path}.item_id`);
    const prompt = canonicalText(row[8], `${path}.prompt`, { maximum: 4_000 });
    const required = parseRequired(row[9], `${path}.required`);
    const subscale = row[10] === "" ? null : canonicalText(row[10], `${path}.subscale`, { maximum: 300 });
    const optionId = identifier(row[11], `${path}.option_id`);
    const optionLabel = canonicalText(row[12], `${path}.option_label`, { maximum: 500 });
    const scoreValue = parseScore(row[13], `${path}.score_value`);

    if (!active || active.itemId !== itemId) {
      if (seenItems.has(itemId)) throw new TypeError(`${path} repeats noncontiguous item ID ${itemId}.`);
      if (items.length >= MAX_ITEMS) throw new RangeError(`Questionnaire CSV may not exceed ${MAX_ITEMS} items.`);
      seenItems.add(itemId);
      active = { itemId, order: items.length + 1, prompt, required, subscale, options: [], optionIds: new Set() };
      items.push(active);
    } else if (active.prompt !== prompt || active.required !== required || active.subscale !== subscale) {
      throw new TypeError(`${path} changes prompt, required, or subscale within item ${itemId}.`);
    }
    if (active.optionIds.has(optionId)) throw new TypeError(`${path} contains duplicate option ID ${optionId}.`);
    if (active.options.length >= MAX_OPTIONS_PER_ITEM) {
      throw new RangeError(`${path} exceeds ${MAX_OPTIONS_PER_ITEM} options for item ${itemId}.`);
    }
    active.optionIds.add(optionId);
    active.options.push({
      optionId,
      order: active.options.length + 1,
      label: optionLabel,
      scoreValue,
    });
  }

  const sourceSha256 = await sha256Hex(bytes);
  const source = {
    kind: sourceKind,
    logicalName: normalizedLogicalName,
    sourceDocumentSha256: normalizedSourceDocumentSha256,
    formatVersion: QUESTIONNAIRE_CSV_FORMAT_VERSION,
    byteLength: bytes.byteLength,
    sha256: sourceSha256,
  };
  const base = {
    schema: QUESTIONNAIRE_DEFINITION_SCHEMA,
    version: 1,
    questionnaireId: identifier(metadata[1], "Questionnaire CSV questionnaire_id"),
    questionnaireVersion: canonicalText(metadata[2], "Questionnaire CSV questionnaire_version", { maximum: 120 }),
    title: canonicalText(metadata[3], "Questionnaire CSV title", { maximum: 500 }),
    language: validateLanguage(metadata[4], "Questionnaire CSV language"),
    instructions: canonicalText(metadata[5], "Questionnaire CSV instructions", { maximum: 8_000 }),
    attribution: canonicalText(metadata[6], "Questionnaire CSV attribution", { maximum: 12_000 }),
    source,
    items: items.map(({ optionIds: _optionIds, ...item }) => item),
  };
  const definitionSha256 = await canonicalSha256(base);
  const definition = await verifyQuestionnaireDefinitionV1({ ...base, definitionSha256 });
  return deepFreeze({ definition, sourceSha256, definitionSha256 });
}

function escapedCell(value, delimiter) {
  let text;
  if (value === null || value === undefined) text = "";
  else if (typeof value === "boolean") text = value ? "true" : "false";
  else if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Tabular questionnaire output cannot contain a non-finite number.");
    text = String(Object.is(value, -0) ? 0 : value);
  } else text = String(value).normalize("NFC");
  return text.includes(delimiter) || /["\r\n]/u.test(text)
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

function serializeRows(columns, rows, delimiter) {
  return [columns, ...rows]
    .map((row) => row.map((value) => escapedCell(value, delimiter)).join(delimiter))
    .join("\r\n") + "\r\n";
}

/** Serialize an already verified definition into canonical authoring CSV. */
export async function questionnaireToCsv(value) {
  const definition = await verifyQuestionnaireDefinitionV1(value);
  const metadata = [
    QUESTIONNAIRE_CSV_FORMAT_VERSION,
    definition.questionnaireId,
    definition.questionnaireVersion,
    definition.title,
    definition.language,
    definition.instructions,
    definition.attribution,
  ];
  const rows = definition.items.flatMap((item) => item.options.map((option) => [
    ...metadata,
    item.itemId,
    item.prompt,
    item.required,
    item.subscale,
    option.optionId,
    option.label,
    option.scoreValue,
  ]));
  return serializeRows(QUESTIONNAIRE_CSV_COLUMNS, rows, ",");
}

export function validateQuestionnaireModuleV1(value, { poolIds = null, definition = null } = {}) {
  exactObject(value, "QuestionnaireModuleV1", [
    "schema",
    "version",
    "moduleId",
    "questionnaireId",
    "definitionSha256",
    "placement",
  ]);
  if (value.schema !== QUESTIONNAIRE_MODULE_SCHEMA || value.version !== 1) {
    throw new TypeError("QuestionnaireModuleV1 has an unsupported schema or version.");
  }
  exactObject(value.placement, "QuestionnaireModuleV1.placement", ["kind", "poolId"]);
  const placementKinds = ["beforeSession", "afterSession", "beforeBlock", "afterBlock"];
  if (!placementKinds.includes(value.placement.kind)) {
    throw new TypeError(`QuestionnaireModuleV1.placement.kind must be one of: ${placementKinds.join(", ")}.`);
  }
  const sessionPlacement = value.placement.kind === "beforeSession" || value.placement.kind === "afterSession";
  let poolId = null;
  if (sessionPlacement) {
    if (value.placement.poolId !== null) throw new TypeError("Session questionnaire placements require poolId null.");
  } else {
    poolId = identifier(value.placement.poolId, "QuestionnaireModuleV1.placement.poolId");
    if (poolIds !== null) {
      if (!Array.isArray(poolIds)) throw new TypeError("poolIds must be an array when supplied.");
      const normalizedPoolIds = poolIds.map((candidate, index) => identifier(candidate, `poolIds[${index}]`));
      if (new Set(normalizedPoolIds).size !== normalizedPoolIds.length) throw new TypeError("poolIds contains duplicate IDs.");
      if (!normalizedPoolIds.includes(poolId)) throw new TypeError(`Questionnaire placement references unknown pool ${poolId}.`);
    }
  }
  const normalized = {
    schema: QUESTIONNAIRE_MODULE_SCHEMA,
    version: 1,
    moduleId: identifier(value.moduleId, "QuestionnaireModuleV1.moduleId"),
    questionnaireId: identifier(value.questionnaireId, "QuestionnaireModuleV1.questionnaireId"),
    definitionSha256: sha256(value.definitionSha256, "QuestionnaireModuleV1.definitionSha256"),
    placement: { kind: value.placement.kind, poolId },
  };
  if (definition !== null) {
    const normalizedDefinition = validateQuestionnaireDefinitionV1(definition);
    if (normalized.questionnaireId !== normalizedDefinition.questionnaireId
      || normalized.definitionSha256 !== normalizedDefinition.definitionSha256) {
      throw new TypeError("QuestionnaireModuleV1 does not bind the supplied questionnaire definition.");
    }
  }
  return deepFreeze(normalized);
}

/** Block- and stimulus-aware module contract for externally authored protocols. */
export function validateQuestionnaireModuleV2(value, {
  blockIds = null,
  stimulusIds = null,
  definition = null,
} = {}) {
  exactObject(value, "QuestionnaireModuleV2", [
    "schema",
    "version",
    "moduleId",
    "questionnaireId",
    "definitionSha256",
    "placement",
  ]);
  if (value.schema !== QUESTIONNAIRE_MODULE_SCHEMA || value.version !== 2) {
    throw new TypeError("QuestionnaireModuleV2 has an unsupported schema or version.");
  }
  const placementKinds = [
    "beforeSession", "afterSession", "beforeBlock", "afterBlock", "afterStimulus",
  ];
  if (!placementKinds.includes(value.placement.kind)) {
    throw new TypeError(`QuestionnaireModuleV2.placement.kind must be one of: ${placementKinds.join(", ")}.`);
  }
  const sessionPlacement = value.placement.kind === "beforeSession"
    || value.placement.kind === "afterSession";
  const stimulusPlacement = value.placement.kind === "afterStimulus";
  let blockId = null;
  let stimulusId = null;
  let relativeToIsi = null;
  if (sessionPlacement) {
    exactObject(value.placement, "QuestionnaireModuleV2.placement", ["kind", "blockId"]);
    if (value.placement.blockId !== null) {
      throw new TypeError("Session questionnaire placements require blockId null.");
    }
  } else if (stimulusPlacement) {
    exactObject(value.placement, "QuestionnaireModuleV2.placement", [
      "kind", "blockId", "stimulusId", "relativeToIsi",
    ]);
    if (value.placement.blockId !== null) {
      throw new TypeError("Post-video questionnaire placements require blockId null.");
    }
    stimulusId = identifier(
      value.placement.stimulusId,
      "QuestionnaireModuleV2.placement.stimulusId",
    );
    if (!["before", "after"].includes(value.placement.relativeToIsi)) {
      throw new TypeError(
        "QuestionnaireModuleV2.placement.relativeToIsi must be before or after.",
      );
    }
    relativeToIsi = value.placement.relativeToIsi;
    if (stimulusIds !== null) {
      if (!Array.isArray(stimulusIds)) throw new TypeError("stimulusIds must be an array when supplied.");
      const normalizedStimulusIds = stimulusIds.map((candidate, index) => (
        identifier(candidate, `stimulusIds[${index}]`)
      ));
      if (new Set(normalizedStimulusIds).size !== normalizedStimulusIds.length) {
        throw new TypeError("stimulusIds contains duplicate IDs.");
      }
      if (!normalizedStimulusIds.includes(stimulusId)) {
        throw new TypeError(`Questionnaire placement references unknown stimulus ${stimulusId}.`);
      }
    }
  } else {
    exactObject(value.placement, "QuestionnaireModuleV2.placement", ["kind", "blockId"]);
    blockId = identifier(value.placement.blockId, "QuestionnaireModuleV2.placement.blockId");
    if (blockIds !== null) {
      if (!Array.isArray(blockIds)) throw new TypeError("blockIds must be an array when supplied.");
      const normalizedBlockIds = blockIds.map((candidate, index) => (
        identifier(candidate, `blockIds[${index}]`)
      ));
      if (new Set(normalizedBlockIds).size !== normalizedBlockIds.length) {
        throw new TypeError("blockIds contains duplicate IDs.");
      }
      if (!normalizedBlockIds.includes(blockId)) {
        throw new TypeError(`Questionnaire placement references unknown block ${blockId}.`);
      }
    }
  }
  const normalized = {
    schema: QUESTIONNAIRE_MODULE_SCHEMA,
    version: 2,
    moduleId: identifier(value.moduleId, "QuestionnaireModuleV2.moduleId"),
    questionnaireId: identifier(value.questionnaireId, "QuestionnaireModuleV2.questionnaireId"),
    definitionSha256: sha256(value.definitionSha256, "QuestionnaireModuleV2.definitionSha256"),
    placement: stimulusPlacement
      ? { kind: "afterStimulus", blockId: null, stimulusId, relativeToIsi }
      : { kind: value.placement.kind, blockId },
  };
  if (definition !== null) {
    const normalizedDefinition = validateQuestionnaireDefinitionV1(definition);
    if (normalized.questionnaireId !== normalizedDefinition.questionnaireId
      || normalized.definitionSha256 !== normalizedDefinition.definitionSha256) {
      throw new TypeError("QuestionnaireModuleV2 does not bind the supplied questionnaire definition.");
    }
  }
  return deepFreeze(normalized);
}

export function validateQuestionnaireAnswers(definitionValue, answersValue, { allowPartial = false } = {}) {
  const definition = validateQuestionnaireDefinitionV1(definitionValue);
  if (!isPlainObject(answersValue)) throw new TypeError("Questionnaire answers must be an object keyed by item ID.");
  if (typeof allowPartial !== "boolean") throw new TypeError("allowPartial must be a boolean.");
  const itemsById = new Map(definition.items.map((item) => [item.itemId, item]));
  for (const itemId of Object.keys(answersValue)) {
    if (!itemsById.has(itemId)) throw new TypeError(`Questionnaire answers contain unknown item ${itemId}.`);
  }
  const answers = [];
  const missingRequired = [];
  for (const item of definition.items) {
    if (!Object.hasOwn(answersValue, item.itemId) || answersValue[item.itemId] === null) {
      if (item.required) missingRequired.push(item.itemId);
      continue;
    }
    const optionId = identifier(answersValue[item.itemId], `Questionnaire answer ${item.itemId}`);
    const option = item.options.find((candidate) => candidate.optionId === optionId);
    if (!option) throw new TypeError(`Questionnaire answer ${item.itemId} must use one of its declared options.`);
    answers.push({
      itemId: item.itemId,
      itemOrder: item.order,
      optionId: option.optionId,
      optionOrder: option.order,
      responseLabel: option.label,
      scoreValue: option.scoreValue,
      subscale: item.subscale,
    });
  }
  if (missingRequired.length && !allowPartial) {
    throw new TypeError(`Questionnaire requires answers for: ${missingRequired.join(", ")}.`);
  }
  return deepFreeze({ complete: missingRequired.length === 0, missingRequired, answers });
}

export function validateQuestionnaireResponseV1(value) {
  exactObject(value, "QuestionnaireResponseV1", QUESTIONNAIRE_RESPONSE_COLUMNS);
  if (value.schema !== QUESTIONNAIRE_RESPONSE_SCHEMA || value.version !== 1) {
    throw new TypeError("QuestionnaireResponseV1 has an unsupported schema or version.");
  }
  if (typeof value.runId !== "string" || !UUID_PATTERN.test(value.runId)) {
    throw new TypeError("QuestionnaireResponseV1.runId must be a canonical UUID.");
  }
  if (typeof value.participantId !== "string" || !PARTICIPANT_PATTERN.test(value.participantId)) {
    throw new TypeError("QuestionnaireResponseV1.participantId must be a P-prefixed zero-padded ID.");
  }
  if (typeof value.monotonicTimeNs !== "string" || !MONOTONIC_NS_PATTERN.test(value.monotonicTimeNs)) {
    throw new TypeError("QuestionnaireResponseV1.monotonicTimeNs must be unsigned decimal nanoseconds.");
  }
  if (value.status !== "submitted" && value.status !== "draft") {
    throw new TypeError("QuestionnaireResponseV1.status must be submitted or draft.");
  }
  return deepFreeze({
    schema: QUESTIONNAIRE_RESPONSE_SCHEMA,
    version: 1,
    sequence: safeInteger(value.sequence, "QuestionnaireResponseV1.sequence", 1),
    runId: value.runId,
    participantId: value.participantId,
    attemptNumber: safeInteger(value.attemptNumber, "QuestionnaireResponseV1.attemptNumber", 1, 999_999),
    settingsSha256: sha256(value.settingsSha256, "QuestionnaireResponseV1.settingsSha256"),
    assignmentPlanSha256: sha256(value.assignmentPlanSha256, "QuestionnaireResponseV1.assignmentPlanSha256"),
    protocolPlanSha256: sha256(value.protocolPlanSha256, "QuestionnaireResponseV1.protocolPlanSha256"),
    protocolStepPosition: safeInteger(value.protocolStepPosition, "QuestionnaireResponseV1.protocolStepPosition", 1, 100_000),
    moduleId: identifier(value.moduleId, "QuestionnaireResponseV1.moduleId"),
    questionnaireId: identifier(value.questionnaireId, "QuestionnaireResponseV1.questionnaireId"),
    questionnaireVersion: canonicalText(value.questionnaireVersion, "QuestionnaireResponseV1.questionnaireVersion", { maximum: 120 }),
    definitionSha256: sha256(value.definitionSha256, "QuestionnaireResponseV1.definitionSha256"),
    itemId: identifier(value.itemId, "QuestionnaireResponseV1.itemId"),
    itemOrder: safeInteger(value.itemOrder, "QuestionnaireResponseV1.itemOrder", 1, MAX_ITEMS),
    optionId: identifier(value.optionId, "QuestionnaireResponseV1.optionId"),
    optionOrder: safeInteger(value.optionOrder, "QuestionnaireResponseV1.optionOrder", 1, MAX_OPTIONS_PER_ITEM),
    responseLabel: canonicalText(value.responseLabel, "QuestionnaireResponseV1.responseLabel", { maximum: 500 }),
    scoreValue: nullableScore(value.scoreValue, "QuestionnaireResponseV1.scoreValue"),
    subscale: canonicalText(value.subscale, "QuestionnaireResponseV1.subscale", { maximum: 300, nullable: true }),
    status: value.status,
    wallTimeUtc: canonicalUtc(value.wallTimeUtc, "QuestionnaireResponseV1.wallTimeUtc"),
    monotonicTimeNs: value.monotonicTimeNs,
    responseLatencyMs: finiteNumber(value.responseLatencyMs, "QuestionnaireResponseV1.responseLatencyMs", 0, MAX_RESPONSE_LATENCY_MS),
  });
}

/** Create one response while deriving option label and score from the verified definition. */
export async function createQuestionnaireResponseV1(value) {
  exactObject(value, "Questionnaire response creation input", [
    "definition",
    "module",
    "sequence",
    "runId",
    "participantId",
    "attemptNumber",
    "settingsSha256",
    "assignmentPlanSha256",
    "protocolPlanSha256",
    "protocolStepPosition",
    "itemId",
    "optionId",
    "status",
    "wallTimeUtc",
    "monotonicTimeNs",
    "responseLatencyMs",
  ]);
  const definition = await verifyQuestionnaireDefinitionV1(value.definition);
  const module = value.module?.version === 2
    ? validateQuestionnaireModuleV2(value.module, { definition })
    : validateQuestionnaireModuleV1(value.module, { definition });
  const itemId = identifier(value.itemId, "Questionnaire response creation input.itemId");
  const optionId = identifier(value.optionId, "Questionnaire response creation input.optionId");
  const item = definition.items.find((candidate) => candidate.itemId === itemId);
  if (!item) throw new TypeError(`Questionnaire definition has no item ${itemId}.`);
  const option = item.options.find((candidate) => candidate.optionId === optionId);
  if (!option) throw new TypeError(`Questionnaire item ${itemId} has no option ${optionId}.`);
  return validateQuestionnaireResponseV1({
    schema: QUESTIONNAIRE_RESPONSE_SCHEMA,
    version: 1,
    sequence: value.sequence,
    runId: value.runId,
    participantId: value.participantId,
    attemptNumber: value.attemptNumber,
    settingsSha256: value.settingsSha256,
    assignmentPlanSha256: value.assignmentPlanSha256,
    protocolPlanSha256: value.protocolPlanSha256,
    protocolStepPosition: value.protocolStepPosition,
    moduleId: module.moduleId,
    questionnaireId: definition.questionnaireId,
    questionnaireVersion: definition.questionnaireVersion,
    definitionSha256: definition.definitionSha256,
    itemId: item.itemId,
    itemOrder: item.order,
    optionId: option.optionId,
    optionOrder: option.order,
    responseLabel: option.label,
    scoreValue: option.scoreValue,
    subscale: item.subscale,
    status: value.status,
    wallTimeUtc: value.wallTimeUtc,
    monotonicTimeNs: value.monotonicTimeNs,
    responseLatencyMs: value.responseLatencyMs,
  });
}

function responseRow(response) {
  return QUESTIONNAIRE_RESPONSE_COLUMNS.map((column) => response[column]);
}

export function serializeQuestionnaireResponses(values, options = { format: "csv" }) {
  const format = typeof options === "string" ? options : options?.format;
  if (format !== "csv" && format !== "tsv") {
    throw new TypeError("Questionnaire response format must be csv or tsv.");
  }
  if (!Array.isArray(values)) throw new TypeError("Questionnaire responses must be an array.");
  const responses = values.map(validateQuestionnaireResponseV1);
  if (responses.length && responses[0].sequence !== 1) {
    throw new TypeError("Questionnaire response sequence must start at one.");
  }
  for (let index = 1; index < responses.length; index += 1) {
    const previous = responses[index - 1];
    const current = responses[index];
    if (current.sequence !== previous.sequence + 1) {
      throw new TypeError("Questionnaire response sequence must be contiguous and strictly increasing.");
    }
    for (const field of [
      "runId",
      "participantId",
      "attemptNumber",
      "settingsSha256",
      "assignmentPlanSha256",
      "protocolPlanSha256",
    ]) {
      if (current[field] !== previous[field]) {
        throw new TypeError(`Questionnaire response field ${field} changed within one output file.`);
      }
    }
    if (BigInt(current.monotonicTimeNs) < BigInt(previous.monotonicTimeNs)) {
      throw new TypeError("Questionnaire response monotonic time moved backwards.");
    }
  }
  return serializeRows(
    QUESTIONNAIRE_RESPONSE_COLUMNS,
    responses.map(responseRow),
    format === "csv" ? "," : "\t",
  );
}

export function questionnaireResponsesToCsv(values) {
  return serializeQuestionnaireResponses(values, { format: "csv" });
}

export function questionnaireResponsesToTsv(values) {
  return serializeQuestionnaireResponses(values, { format: "tsv" });
}
