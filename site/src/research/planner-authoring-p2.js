import { canonicalJson } from "./canonical.js";
import { commandFailure, PlannerCommandError } from "./planner-authoring-contract.js";
import { createFlatLanguageSelectionV1, validateLanguageSelectionTreeV1 } from "./experiment-package.js";
import { analyzeQuestionnaireLanguageCoverage } from "./questionnaire-assets.js";
import { validateQuestionnaireModuleV2 } from "./questionnaires.js";
import { createQuestionnaireSheet, cloneQuestionnaireSheet, replaceQuestionnaireSheetDraft,
  questionnaireGridColumns, setQuestionnaireGridCell, setOptionCount, sheetToAuthoring } from "./questionnaire-sheet.js";

const DRAFT_KEYS = ["familyId", "language", "questionnaireId", "questionnaireVersion", "title", "instructions", "attribution", "optionCount", "items"];
const ITEM_KEYS = ["itemId", "prompt", "required", "subscale", "options"];
const OPTION_KEYS = ["optionId", "label", "scoreValue"];
const clone = structuredClone;
const issue = (field, code, message) => ({ owner: "P2", field, code, message: String(message).slice(0, 512) });
function exact(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw new TypeError("Questionnaire command has missing or unknown fields.");
}
function list(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${label} exceeds its list bound.`);
  return value;
}
function json(value, depth = 0) {
  if (depth > 32) throw new TypeError("Questionnaire command is too deeply nested.");
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach(item => json(item, depth + 1)); return; }
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) throw new TypeError("Unsupported questionnaire object key.");
      json(item, depth + 1);
    }
    return;
  }
  throw new TypeError("Questionnaire commands require finite JSON values.");
}
function rawCell(value) {
  if (typeof value === "string" && value.length <= 4000) return value;
  throw new TypeError("Invalid draft cells must be bounded raw text.");
}
function draft(record) {
  const { sheet } = record;
  const value = Object.fromEntries(DRAFT_KEYS.filter(key => key !== "items").map(key => [key, sheet[key]]));
  value.items = clone(sheet.rows);
  if (record.rawOptionCount !== null) value.optionCount = record.rawOptionCount;
  for (const [key, raw] of record.invalid) {
    const [rowIndex, column] = key.split(":").map(Number), row = value.items[rowIndex];
    if (!row) continue;
    if (column === 0) row.prompt = raw;
    else if (column === questionnaireGridColumns(sheet, record.layout).length - 1) row.required = raw;
    else {
      const option = row.options[record.layout === "codes-only" ? column - 1 : Math.floor((column - 1) / 2)];
      if (option) option[record.layout === "codes-only" || column % 2 === 0 ? "scoreValue" : "label"] = raw;
    }
  }
  return value;
}
function makeRecord(family, language, optionCount = 5, rowCount = 0) {
  return { sheet: createQuestionnaireSheet({ familyId: family.id, language: language.languageTag,
    title: family.label, optionCount, rowCount }), invalid: [], layout: "labels-and-codes", repeatLabels: 1,
    dirty: true, busy: false, error: "", rawOptionCount: null };
}
function findRecord(records, id) {
  const found = records.find(record => record.sheet.questionnaireId === id);
  if (!found) throw new TypeError(`Unknown questionnaire identity ${id}.`);
  return found;
}
function ordered(values, ids, key) {
  if (!Array.isArray(ids) || ids.length !== values.length || new Set(ids).size !== ids.length) throw new TypeError("Reordering requires every resource ID exactly once.");
  return ids.map(id => {
    const value = values.find(entry => entry[key] === id);
    if (!value) throw new TypeError("Unknown resource in reorder operation.");
    return value;
  });
}

// Preserve weak-map provenance by cloning the actual owner sheet, then invoking
// its normal bounded mutation path. Raw invalid codes remain separate UI drafts.
function replaceDraft(record, value) {
  exact(value, DRAFT_KEYS); list(value.items, 1024, "Items");
  const original = value;
  value = clone(value);
  let rawOptionCount = null;
  if (typeof value.optionCount === "string") {
    const raw = rawCell(value.optionCount), parsed = Number(raw);
    if (raw.trim() && Number.isSafeInteger(parsed) && parsed >= 2 && parsed <= 64) value.optionCount = parsed;
    else { rawOptionCount = raw; value.optionCount = record.sheet.optionCount; }
  }
  if (!Number.isSafeInteger(value.optionCount) || value.optionCount < 2 || value.optionCount > 64) {
    throw new TypeError("Answer-option count must be an integer from 2 to 64.");
  }
  const raw = [], rows = value.items.map((item, rowIndex) => {
    exact(item, ITEM_KEYS); list(item.options, 64, "Options");
    const previous = record.sheet.rows.find(row => row.itemId === item.itemId);
    const row = clone(item);
    if (typeof row.required !== "boolean") {
      raw.push([rowIndex, "required", rawCell(row.required)]); row.required = previous?.required ?? true;
    }
    row.options = item.options.map((option, index) => {
      exact(option, OPTION_KEYS);
      const result = clone(option);
      if (typeof result.scoreValue === "string") {
        raw.push([rowIndex, index, rawCell(result.scoreValue)]);
        result.scoreValue = previous?.options.find(o => o.optionId === option.optionId)?.scoreValue ?? null;
      }
      return result;
    });
    return row;
  });
  const { items: _items, ...metadata } = value;
  const candidate = cloneQuestionnaireSheet(record.sheet);
  const labels = Array.from({ length: value.optionCount }, (_, index) => {
    const label = rows[0]?.options[index]?.label;
    return label !== undefined && rows.every(row => row.options[index]?.label === label) ? label : null;
  });
  replaceQuestionnaireSheetDraft(candidate, { ...metadata, rows, optionLabels: labels });
  const invalid = [];
  for (const [row, option, text] of raw) {
    const column = option === "required" ? questionnaireGridColumns(candidate).length - 1 : 2 + option * 2;
    try { setQuestionnaireGridCell(candidate, row, column, text); }
    catch { invalid.push([`${row}:${column}`, text]); }
  }
  const changed = canonicalJson(draft(record)) !== canonicalJson(original);
  record.sheet = candidate; record.invalid = invalid; record.layout = "labels-and-codes";
  record.rawOptionCount = rawOptionCount;
  record.dirty ||= changed; record.error = "";
}

const settings = Object.freeze([
  ["questionnaires", "Questionnaire drafts", "Array of complete draft definitions with stable family/questionnaire/item/option IDs; numeric codes may retain invalid raw text."],
  ["languages", "Selected languages", "Array of exact {languageId,languageTag,label}; each family gets one editable slot per language."],
  ["modules", "Ordered questionnaire modules", "Array of existing QuestionnaireModuleV2, in authored order; hashes reference accepted definitions."],
  ["languageSelection", "Language routing", "Exact LanguageSelectionTreeV1 or null for the owner's flat-language projection; no automatic participant selection."],
  ["presentation", "Answer label repetition", "Array of exact {questionnaireId,repeatLabelsEvery:1|5|10}, one per draft in order. This is not pagination."],
].map(([id, label, description]) => Object.freeze({ id: `P2.${id}`, label, description, type: "json", classification: "authored", writable: true }))
  .concat(["acceptedDefinitions", "coverage"].map(id => Object.freeze({ id: `P2.${id}`, label: id,
    type: "json", classification: "derived", writable: false }))));
const operationShapes = {
  addQuestionnaire: ["familyId", "title", "optionCount", "rowCount"],
  removeQuestionnaire: ["familyId"],
  updateQuestionnaire: ["questionnaireId", "changes"],
  addItem: ["questionnaireId", "item", "beforeItemId"],
  setItem: ["questionnaireId", "itemId", "item"],
  removeItem: ["questionnaireId", "itemId"],
  reorderItems: ["questionnaireId", "itemIds"],
  setOption: ["questionnaireId", "itemId", "optionId", "label", "scoreValue"],
  reorderOptions: ["questionnaireId", "itemId", "optionIds"],
  reorderModules: ["moduleIds"],
};
const argumentTypes = {
  familyId: "string: questionnaire family identity", questionnaireId: "string: questionnaire identity",
  title: "string: questionnaire title", optionCount: "integer: 2..64", rowCount: "integer: 0..1024",
  changes: "nonempty object: questionnaireVersion?, title?, instructions?, attribution?, optionCount?; no other keys",
  item: "exact object: {itemId:string,prompt:string,required:boolean|string,subscale:string|null,options:Option[]}",
  beforeItemId: "string|null: existing item identity, or null to append", itemId: "string: existing item identity",
  itemIds: "string[]: every existing item identity exactly once", optionId: "string: existing option identity",
  label: "string: participant-visible answer label", scoreValue: "number|null|string: recorded value, or invalid raw draft text",
  optionIds: "string[]: every existing option identity exactly once", moduleIds: "string[]: every existing module identity exactly once",
};

/** Adapter over existing editor/app state. No retained drafts, file IO or compiler. */
export function createPlannerAuthoringP2({ editor, readContext, commitContext, onCommit = () => {} }) {
  if (typeof editor?.readAuthoringEntries !== "function" || typeof editor?.prepareAuthoringEntries !== "function"
    || typeof readContext !== "function" || typeof commitContext !== "function") throw new TypeError("P2 requires its actual editor and context projection hooks.");
  const capture = () => ({ context: clone(readContext()), records: editor.readAuthoringEntries() });
  const fingerprint = ({ context, records }) => canonicalJson({ context, records: records.map(record => ({ ...record, sheet: draft(record) })) });
  function coverage(context) {
    return analyzeQuestionnaireLanguageCoverage({ definitions: context.definitions, modules: context.modules,
      languages: context.languages, requestedFamilyIds: context.families.map(family => family.id) });
  }
  function issuesFor({ context, records }) {
    const issues = [];
    if (context.locked) issues.push(issue("P2.questionnaires", "locked", "Questionnaire editor is locked."));
    for (const record of records) {
      if (record.busy) issues.push(issue("P2.questionnaires", "busy", `${record.sheet.questionnaireId} is being saved.`));
      if (record.invalid.length || record.error || record.rawOptionCount !== null) issues.push(issue("P2.questionnaires", "invalid_draft", `${record.sheet.questionnaireId}: ${record.error || "Correct invalid raw cells or option count."}`));
      else if (record.dirty) issues.push(issue("P2.questionnaires", "unsaved_draft", `${record.sheet.questionnaireId} needs questionnaire preparation/save.`));
    }
    try { if (!coverage(context).complete) issues.push(issue("P2.languages", "missing_language_asset", "Supply every questionnaire in every selected language.")); }
    catch (error) { issues.push(issue("P2.modules", "invalid_reference", error.message)); }
    try {
      const tree = context.languageSelection === null ? null : validateLanguageSelectionTreeV1(context.languageSelection);
      if (tree) {
        if (canonicalJson(tree.languages.map(({ questionnaireModuleIds: _ids, ...language }) => language)) !== canonicalJson(context.languages)) throw new TypeError("Routing languages must match the selected language roster and order.");
        const mapped = new Set();
        for (const language of tree.languages) for (const id of language.questionnaireModuleIds) {
          const module = context.modules.find(m => m.moduleId === id);
          const definition = context.definitions.find(d => d.questionnaireId === module?.questionnaireId);
          if (!definition || definition.language !== language.languageTag) throw new TypeError("Language route references an unknown or incompatible questionnaire module.");
          mapped.add(id);
        }
        if (context.modules.some(m => !mapped.has(m.moduleId))) throw new TypeError("Every module needs an explicit language mapping.");
      }
      context.modules.forEach(module => validateQuestionnaireModuleV2(module));
      if (context.modules.some(m => !["beforeSession", "afterSession"].includes(m.placement.kind))) issues.push(issue("P2.modules", "unsupported_placement", "The current master supports before/after-session questionnaires only."));
    } catch (error) { issues.push(issue("P2.languageSelection", "invalid_route", error.message)); }
    return issues;
  }
  function reconcile(state) {
    const { context } = state;
    const tree = createFlatLanguageSelectionV1(context.languages);
    context.languages = tree.languages.map(({ questionnaireModuleIds: _ids, ...language }) => language);
    if (context.families.length * context.languages.length > 256) throw new TypeError("Questionnaire catalogue exceeds 256 language slots.");
    state.records = context.families.flatMap(family => context.languages.map(language => state.records.find(record =>
      record.sheet.familyId === family.id && record.sheet.language === language.languageTag) ?? makeRecord(family, language)));
    const ids = new Set(state.records.map(record => record.sheet.questionnaireId));
    context.definitions = context.definitions.filter(definition => ids.has(definition.questionnaireId));
    context.modules = context.modules.filter(module => ids.has(module.questionnaireId));
  }
  function set(state, field, value) {
    const { context } = state;
    if (field === "P2.languages") {
      list(value, 64, "Languages").forEach(language => exact(language, ["languageId", "languageTag", "label"]));
      context.languages = clone(value); reconcile(state);
    } else if (field === "P2.languageSelection") {
      context.languageSelection = value === null ? null : clone(validateLanguageSelectionTreeV1(value));
    } else if (field === "P2.modules") {
      context.modules = list(value, 1024, "Modules").map(module => clone(validateQuestionnaireModuleV2(module)));
      if (new Set(context.modules.map(module => module.moduleId)).size !== context.modules.length) throw new TypeError("Module IDs must be unique.");
    } else if (field === "P2.presentation") {
      if (!Array.isArray(value) || value.length !== state.records.length) throw new TypeError("Presentation needs one entry per draft.");
      value.forEach((entry, index) => {
        exact(entry, ["questionnaireId", "repeatLabelsEvery"]);
        if (entry.questionnaireId !== state.records[index].sheet.questionnaireId || ![1, 5, 10].includes(entry.repeatLabelsEvery)) throw new TypeError("Invalid presentation identity/order/repetition.");
        state.records[index].repeatLabels = entry.repeatLabelsEvery;
      });
    } else if (field === "P2.questionnaires") {
      list(value, 256, "Questionnaires");
      const previous = state.records, ids = new Set(), slots = new Set();
      context.families = [];
      state.records = value.map(content => {
        exact(content, DRAFT_KEYS);
        const slot = `${content.familyId}/${content.language}`;
        if (ids.has(content.questionnaireId) || slots.has(slot)) throw new TypeError("Questionnaire identities and language slots must be unique.");
        ids.add(content.questionnaireId); slots.add(slot);
        if (!context.languages.some(language => language.languageTag === content.language)) throw new TypeError("Questionnaire language is not selected.");
        let family = context.families.find(entry => entry.id === content.familyId);
        if (!family) { family = { id: content.familyId, label: content.title }; context.families.push(family); }
        const existing = previous.find(record => record.sheet.familyId === content.familyId && record.sheet.language === content.language);
        const record = existing ?? makeRecord(family, { languageTag: content.language }, content.optionCount);
        replaceDraft(record, content); return record;
      });
      reconcile(state);
    } else throw new TypeError("Unknown or read-only P2 setting.");
  }
  function operation(state, name, args) {
    const keys = operationShapes[name];
    if (!keys) throw new TypeError("Unknown questionnaire operation.");
    exact(args, keys);
    if (name === "addQuestionnaire") {
      if (state.context.families.some(family => family.id === args.familyId)) throw new TypeError("Questionnaire family already exists.");
      const family = { id: args.familyId, label: args.title };
      state.records.push(...state.context.languages.map(language => makeRecord(family, language, args.optionCount, args.rowCount)));
      state.context.families.push(family); reconcile(state); return;
    }
    if (name === "removeQuestionnaire") {
      if (!state.context.families.some(family => family.id === args.familyId)) throw new TypeError("Unknown questionnaire family.");
      state.context.families = state.context.families.filter(family => family.id !== args.familyId); reconcile(state); return;
    }
    if (name === "reorderModules") { state.context.modules = ordered(state.context.modules, args.moduleIds, "moduleId"); return; }
    const record = findRecord(state.records, args.questionnaireId), content = draft(record);
    if (name === "updateQuestionnaire") {
      const allowed = ["questionnaireVersion", "title", "instructions", "attribution", "optionCount"];
      if (!args.changes || typeof args.changes !== "object" || Array.isArray(args.changes)
        || !Object.keys(args.changes).length || Object.keys(args.changes).some(key => !allowed.includes(key))) throw new TypeError("Unknown questionnaire metadata field.");
      if (Object.hasOwn(args.changes, "optionCount")) {
        if (record.invalid.length) throw new TypeError("Correct raw cells before changing the option count.");
        if (args.changes.optionCount !== record.sheet.optionCount) record.dirty = true;
        setOptionCount(record.sheet, args.changes.optionCount);
        Object.assign(content, draft(record));
      }
      Object.assign(content, args.changes);
    } else if (name === "reorderItems") content.items = ordered(content.items, args.itemIds, "itemId");
    else if (name === "addItem") {
      exact(args.item, ITEM_KEYS);
      const index = args.beforeItemId === null ? content.items.length : content.items.findIndex(item => item.itemId === args.beforeItemId);
      if (index < 0) throw new TypeError("Unknown insertion item.");
      content.items.splice(index, 0, clone(args.item));
    } else {
      const index = content.items.findIndex(item => item.itemId === args.itemId);
      if (index < 0) throw new TypeError("Unknown questionnaire item.");
      if (name === "removeItem") content.items.splice(index, 1);
      else if (name === "setItem") {
        exact(args.item, ITEM_KEYS);
        if (args.item.itemId !== args.itemId) throw new TypeError("Item replacement must retain its resource ID.");
        content.items[index] = clone(args.item);
      } else if (name === "reorderOptions") content.items[index].options = ordered(content.items[index].options, args.optionIds, "optionId");
      else if (name === "setOption") {
        const option = content.items[index].options.find(item => item.optionId === args.optionId);
        if (!option) throw new TypeError("Unknown questionnaire option.");
        option.label = args.label; option.scoreValue = args.scoreValue;
      }
    }
    replaceDraft(record, content);
  }
  return Object.freeze({ id: "P2", settings,
    operations: Object.freeze(Object.entries(operationShapes).map(([id, argumentsKeys]) => Object.freeze({ id,
      argumentsKeys, argumentsSchema: { type: "object", additionalProperties: false, required: argumentsKeys,
        properties: Object.fromEntries(argumentsKeys.map(key => [key, { description: argumentTypes[key] }])) },
      description: "Closed typed questionnaire draft operation; no source import or file write. Option is {optionId:string,label:string,scoreValue:number|null|string}." }))),
    read() {
      const state = capture(); let currentCoverage = null;
      try { currentCoverage = coverage(state.context); } catch { /* Report issues, not a fabricated complete result. */ }
      return { values: { "P2.questionnaires": state.records.map(draft), "P2.languages": state.context.languages,
        "P2.modules": state.context.modules, "P2.languageSelection": state.context.languageSelection,
        "P2.presentation": state.records.map(record => ({ questionnaireId: record.sheet.questionnaireId, repeatLabelsEvery: record.repeatLabels })),
        "P2.acceptedDefinitions": state.context.definitions, "P2.coverage": currentCoverage }, issues: issuesFor(state) };
    },
    validate() { return issuesFor(capture()); },
    async stage(edits, { isCurrent, signal }) {
      try {
      const state = capture(), before = fingerprint(state);
      const current = () => !signal.aborted && isCurrent() && fingerprint(capture()) === before;
      if (state.context.locked || state.records.some(record => record.busy)) throw new TypeError("Questionnaire editor is locked or saving.");
      if (!current()) commandFailure(signal.aborted ? "canceled" : "stale_revision", "Questionnaire staging is stale or cancelled.", "P2.questionnaires");
      json(edits); list(edits, 256, "Edits");
      if (!edits.length || new TextEncoder().encode(canonicalJson(edits)).byteLength > 16 * 1024 * 1024) throw new TypeError("Questionnaire edit batch is empty or oversized.");
      const detached = clone(edits);
      for (const edit of detached) {
        if (edit.kind === "set") { exact(edit, ["kind", "field", "value"]); set(state, edit.field, edit.value); }
        else if (edit.kind === "operation") {
          exact(edit, ["kind", "owner", "operation", "arguments"]);
          if (edit.owner !== "P2") throw new TypeError("Wrong questionnaire operation owner.");
          operation(state, edit.operation, edit.arguments);
        } else throw new TypeError("Unknown questionnaire edit kind.");
      }
      if (state.records.length > 256) throw new TypeError("Questionnaire draft catalogue exceeds 256 slots.");
      for (const record of state.records) {
        if (!record.invalid.length && record.rawOptionCount === null) {
          try { await sheetToAuthoring(record.sheet); record.error = ""; }
          catch (error) { record.error = String(error.message); }
        }
        if (!current()) commandFailure(signal.aborted ? "canceled" : "stale_revision", "Questionnaire staging was superseded; no drafts were changed.", "P2.questionnaires");
      }
      const project = editor.prepareAuthoringEntries(state.records, state.context);
      let committed = false;
      return { isCurrent: () => !committed && current(), commit() {
        if (committed) return;
        committed = true; commitContext(state.context); project.commit();
      }, afterCommit() { project.afterCommit(); onCommit(); } };
      } catch (error) {
        if (error instanceof PlannerCommandError) throw error;
        commandFailure("invalid_value", String(error.message).slice(0, 512), "P2.questionnaires");
      }
    },
  });
}
