import { commandFailure, exactCommandKeys, validateCommandJson, validateSettingValue } from "./planner-authoring-contract.js";
import { addIsiDurations, addVariantColumn, addVariantRow, compileVariantTimeline, createVariantDraft,
  editIsi, pasteVariantTable, removeIsi, resolveVariantEntries, validateVariantDraft } from "./variant-design.js";
import { validateVariantCatalogueLibrary } from "./variant-video-catalogue.js";

const clone = value => structuredClone(value);
const enc = new TextEncoder();
const invalid = (message, field = "P3.draft") => commandFailure("invalid_value", message, field);
const string = (maxLength, description) => ({ type: "string", maxLength, description });
const variantId = string(14, "Existing stable variant identity.");
const entryId = string(27, "Existing occurrence identity; row operations accept any occurrence in that row.");
const isiId = string(9, "Existing stable ISI identity.");
const before = descriptor => ({ ...descriptor, nullable: true, description: `${descriptor.description} Null appends.` });
const duration = { type: "integer", minimum: 0, maximum: 3600000, unit: "ms" };
const title = string(120, "Variant title; empty or duplicate titles remain incomplete drafts.");
const operation = (id, label, properties) => ({ id, label,
  arguments: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } });
const OPERATIONS = [
  operation("isi.add", "Add a named ISI", { durationMs: duration }),
  operation("isi.setDuration", "Edit an ISI duration", { isiId, durationMs: duration }),
  operation("isi.remove", "Remove an unused ISI", { isiId }),
  operation("isi.move", "Reorder the ISI dictionary", { isiId, beforeIsiId: before(isiId) }),
  operation("variant.add", "Add a variant", { title, beforeVariantId: before(variantId) }),
  operation("variant.rename", "Rename a variant", { variantId, title }),
  operation("variant.remove", "Remove a variant", { variantId }),
  operation("variant.move", "Reorder variants", { variantId, beforeVariantId: before(variantId) }),
  operation("row.add", "Insert an empty event row", { beforeEntryId: before(entryId) }),
  operation("row.remove", "Remove an event row", { entryId }),
  operation("row.move", "Reorder event rows with their occurrence identities", { entryId, beforeEntryId: before(entryId) }),
  operation("cell.set", "Edit a video or ISI reference", { entryId, referenceId: string(6144, "Exact video annotation, ISI name or empty draft cell. Maximum 6144 UTF-8 bytes.") }),
  operation("table.paste", "Paste spreadsheet cells at an occurrence", { entryId, text: string(4 * 1024 * 1024, "Spreadsheet text, parsed by the existing P3 clipboard validator.") }),
  operation("table.reset", "Reset the table and named ISIs", {}),
];
const readOnly = (id, label, classification = "derived") => ({ id: `P3.${id}`, label, type: "json", classification, writable: false });
const SETTINGS = [
  { id: "P3.draft", label: "Exact editable variant draft", type: "json", classification: "authored", writable: false,
    description: "Readback fields: columns [{variantId,title}], rectangular rows of raw reference strings, matching entryIds, isiDefinitions [{isiId,durationMs}], nextIsiOrdinal. Edit through stable-ID operations. Identity allocation and exact raw recovery remain editor-owned; raw invalid duration text or null is returned with an issue." },
  readOnly("isiDefinitions", "Ordered named ISIs; edit by ISI identity", "authored"),
  readOnly("variants", "Ordered variants; edit by variant identity", "authored"),
  readOnly("rows", "Ordered event cells; edit by occurrence identity", "authored"),
  readOnly("videoAnnotations", "P1 video annotations available to this draft"),
  readOnly("contribution", "Current prepared variant contribution, or null"),
  readOnly("timelines", "Current planned timelines, or null"),
  readOnly("markerContract", "Current planned marker contract, or null"),
  readOnly("legacyConversionRequired", "Historical design awaiting explicit conversion", "compatibility"),
];

function boundedText(value, maxBytes, label) {
  if (typeof value !== "string" || enc.encode(value).length > maxBytes) invalid(`${label} requires a string of at most ${maxBytes} UTF-8 bytes.`);
}

// Reuse the model's structural/identity bounds while admitting unconfirmed raw
// scalar edits. These placeholders validate shape only and never leave this helper.
function structuralDraft(draft) {
  validateCommandJson(draft);
  exactCommandKeys(draft, ["columns", "rows", "entryIds", "isiDefinitions", "nextIsiOrdinal"]);
  if (!Array.isArray(draft.columns) || !Array.isArray(draft.isiDefinitions)) invalid("Variant columns and ISIs must be arrays.");
  const shape = clone(draft);
  const titles = new Set();
  shape.columns.forEach((column, index) => {
    exactCommandKeys(column, ["variantId", "title"]);
    boundedText(column.title, 120, "Variant title");
    // Preserve names reserved by the existing add-column allocator, even when
    // another raw title is empty or duplicated and cannot yet be confirmed.
    column.title = /^Variant [1-9][0-9]*$/u.test(column.title) && !titles.has(column.title) ? column.title : `Draft ${index + 1}`;
    titles.add(column.title);
  });
  shape.isiDefinitions.forEach(isi => {
    exactCommandKeys(isi, ["isiId", "durationMs"]);
    if (isi.durationMs !== null && typeof isi.durationMs !== "number") boundedText(isi.durationMs, 128, "Raw ISI duration");
    isi.durationMs = 0;
  });
  validateVariantDraft(shape);
  return shape;
}

/** Internal owner recovery only; never a public command or saved recipe reader. */
export function validateVariantAuthoringDraft(draft) {
  structuralDraft(draft);
  return clone(draft);
}

function restoreRawScalars(next, previous) {
  for (const column of next.columns) {
    const original = previous.columns.find(item => item.variantId === column.variantId);
    if (original) column.title = original.title;
  }
  for (const isi of next.isiDefinitions) {
    const original = previous.isiDefinitions.find(item => item.isiId === isi.isiId);
    if (original) isi.durationMs = original.durationMs;
  }
  return next;
}
function indexBy(list, key, id, field) {
  const index = list.findIndex(item => item[key] === id);
  if (index < 0) commandFailure("unknown_resource", `Unknown ${key}: ${id}.`, field);
  return index;
}
function occurrence(draft, id) {
  for (let r = 0; r < draft.entryIds.length; r++) {
    const c = draft.entryIds[r].indexOf(id);
    if (c >= 0) return { r, c };
  }
  commandFailure("unknown_resource", `Unknown occurrence: ${id}.`, "P3.rows");
}
function move(list, from, beforeIndex) {
  if (from === beforeIndex) return;
  const [item] = list.splice(from, 1);
  list.splice(beforeIndex > from ? beforeIndex - 1 : beforeIndex, 0, item);
}
function checkArguments(descriptor, args) {
  validateCommandJson(args);
  exactCommandKeys(args, descriptor.arguments.required);
  for (const [key, field] of Object.entries(descriptor.arguments.properties)) {
    if (field.nullable && args[key] === null) continue;
    validateSettingValue({ ...field, id: `P3.${descriptor.id}.${key}`, classification: "authored", writable: true }, args[key]);
    if (field.type === "string") boundedText(args[key], field.maxLength, key);
  }
}

export function applyVariantAuthoringOperation(input, name, args, library) {
  let draft = clone(input);
  const descriptor = OPERATIONS.find(item => item.id === name);
  if (!descriptor) commandFailure("unknown_operation", "Unknown variant operation.", "P3");
  checkArguments(descriptor, args);
  switch (name) {
    case "isi.add": {
      const generated = addIsiDurations(structuralDraft(draft), String(args.durationMs));
      draft.isiDefinitions.push(generated.isiDefinitions.at(-1));
      draft.nextIsiOrdinal = generated.nextIsiOrdinal;
      break;
    }
    case "isi.setDuration": {
      const i = indexBy(draft.isiDefinitions, "isiId", args.isiId, "P3.isiDefinitions");
      editIsi(structuralDraft(draft), args.isiId, args.durationMs);
      draft.isiDefinitions[i].durationMs = args.durationMs;
      break;
    }
    case "isi.remove":
      indexBy(draft.isiDefinitions, "isiId", args.isiId, "P3.isiDefinitions");
      draft = restoreRawScalars(removeIsi(structuralDraft(draft), args.isiId), draft);
      break;
    case "isi.move": {
      const i = indexBy(draft.isiDefinitions, "isiId", args.isiId, "P3.isiDefinitions");
      const target = args.beforeIsiId === null ? draft.isiDefinitions.length : indexBy(draft.isiDefinitions, "isiId", args.beforeIsiId, "P3.isiDefinitions");
      move(draft.isiDefinitions, i, target);
      break;
    }
    case "variant.add": {
      const target = args.beforeVariantId === null ? draft.columns.length : indexBy(draft.columns, "variantId", args.beforeVariantId, "P3.variants");
      draft = restoreRawScalars(addVariantColumn(structuralDraft(draft)), draft);
      const added = draft.columns.at(-1);
      added.title = args.title;
      const from = draft.columns.length - 1;
      move(draft.columns, from, target); draft.rows.forEach(row => move(row, from, target)); draft.entryIds.forEach(row => move(row, from, target));
      break;
    }
    case "variant.rename":
      draft.columns[indexBy(draft.columns, "variantId", args.variantId, "P3.variants")].title = args.title;
      break;
    case "variant.remove": {
      const c = indexBy(draft.columns, "variantId", args.variantId, "P3.variants");
      if (draft.columns.length === 1) invalid("Keep at least one variant.", "P3.variants");
      draft.columns.splice(c, 1); draft.rows.forEach(row => row.splice(c, 1)); draft.entryIds.forEach(row => row.splice(c, 1));
      break;
    }
    case "variant.move": {
      const c = indexBy(draft.columns, "variantId", args.variantId, "P3.variants");
      const target = args.beforeVariantId === null ? draft.columns.length : indexBy(draft.columns, "variantId", args.beforeVariantId, "P3.variants");
      move(draft.columns, c, target); draft.rows.forEach(row => move(row, c, target)); draft.entryIds.forEach(row => move(row, c, target));
      break;
    }
    case "row.add": {
      const target = args.beforeEntryId === null ? draft.rows.length : occurrence(draft, args.beforeEntryId).r;
      draft = restoreRawScalars(addVariantRow(structuralDraft(draft)), draft);
      move(draft.rows, draft.rows.length - 1, target); move(draft.entryIds, draft.entryIds.length - 1, target);
      break;
    }
    case "row.remove": {
      const { r } = occurrence(draft, args.entryId);
      if (draft.rows.length === 1) invalid("Keep at least one event row.", "P3.rows");
      draft.rows.splice(r, 1); draft.entryIds.splice(r, 1);
      break;
    }
    case "row.move": {
      const { r } = occurrence(draft, args.entryId);
      const target = args.beforeEntryId === null ? draft.rows.length : occurrence(draft, args.beforeEntryId).r;
      move(draft.rows, r, target); move(draft.entryIds, r, target);
      break;
    }
    case "cell.set": {
      const { r, c } = occurrence(draft, args.entryId);
      draft.rows[r][c] = args.referenceId;
      break;
    }
    case "table.paste": {
      if (!library) commandFailure("dependency_unavailable", "Confirm the Segment 1 video catalogue before pasting references.", "P3.rows");
      const { r, c } = occurrence(draft, args.entryId);
      draft = restoreRawScalars(pasteVariantTable(structuralDraft(draft), r, c, args.text, library), draft);
      break;
    }
    case "table.reset": draft = createVariantDraft(); break;
    default: commandFailure("unknown_operation", "Unknown variant operation.", "P3");
  }
  structuralDraft(draft);
  return draft;
}

function issue(error, draft, code = "invalid_variant_draft") {
  const c = error.column, r = error.row;
  const field = /^ISI[1-9][0-9]* duration/u.test(error.message) ? "P3.isiDefinitions"
    : Number.isInteger(r) ? "P3.rows" : "P3.draft";
  return { owner: "P3", field, code, message: String(error.message).slice(0, 512),
    ...(Number.isInteger(r) && Number.isInteger(c) ? { entryId: draft.entryIds[r]?.[c] ?? null, variantId: draft.columns[c]?.variantId ?? null } : {}) };
}
function issuesFor(capture) {
  if (capture.destroyed) return [{ owner: "P3", field: null, code: "owner_unavailable", message: "The variant editor is closed." }];
  if (capture.legacy) return [{ owner: "P3", field: "P3.legacyConversionRequired", code: "legacy_conversion_required", message: "Convert the historical design explicitly before editing variants." }];
  const issues = [];
  try { validateVariantDraft(capture.draft); }
  catch (error) { issues.push(issue(error, capture.draft)); }
  if (!capture.library) issues.push({ owner: "P3", field: "P3.videoAnnotations", code: "dependency_unavailable", message: "Confirm the video catalogue in Segment 1 before confirming variants." });
  else {
    if (!issues.length) try { resolveVariantEntries(capture.draft, capture.library); } catch (error) { issues.push(issue(error, capture.draft)); }
    try { validateVariantCatalogueLibrary(capture.catalogue, capture.library); }
    catch (error) { issues.push(issue(error, capture.draft, "dependency_unavailable")); }
  }
  if (capture.busy) issues.push({ owner: "P3", field: null, code: "owner_busy", message: "The variant editor has an operation in progress." });
  return issues;
}

/** Typed commands over the sole P3 editor. Atomic commit only projects state;
 * integration calls editor.publishAuthoringDraft() after all owners commit. */
export function createPlannerVariantCommandOwner({ editor }) {
  if (!["captureAuthoringDraft", "stageAuthoringDraft", "publishAuthoringDraft"].every(name => typeof editor?.[name] === "function")) throw new TypeError("The P3 editor authoring hooks are required.");
  return Object.freeze({
    id: "P3", settings: clone(SETTINGS), operations: clone(OPERATIONS),
    read() {
      const capture = editor.captureAuthoringDraft(), { draft, contribution } = capture;
      const issues = issuesFor(capture);
      let timelines = null;
      if (contribution && !issues.length) {
        try { timelines = contribution.variants.map(variant => compileVariantTimeline(contribution, variant.variantId, capture.catalogue.videos)); }
        catch (error) { issues.push(issue(error, draft, "invalid_timeline")); }
      }
      return { values: {
        "P3.draft": draft, "P3.isiDefinitions": clone(draft.isiDefinitions), "P3.variants": clone(draft.columns),
        "P3.rows": draft.rows.map((row, r) => row.map((referenceId, c) => ({ entryId: draft.entryIds[r][c], variantId: draft.columns[c].variantId, referenceId }))),
        "P3.videoAnnotations": (capture.library?.videos ?? []).map(video => video.annotationId),
        "P3.contribution": contribution, "P3.timelines": timelines,
        "P3.markerContract": contribution?.markerContract ?? null,
        "P3.legacyConversionRequired": Boolean(capture.legacy),
      }, issues };
    },
    validate() { return issuesFor(editor.captureAuthoringDraft()); },
    async stage(edits, { isCurrent = () => true, signal } = {}) {
      if (signal?.aborted) commandFailure("canceled", "Variant edits were canceled.", "P3");
      if (!isCurrent()) commandFailure("stale_revision", "Variant edits are no longer current.", "P3");
      const capture = editor.captureAuthoringDraft();
      if (capture.destroyed || capture.busy || capture.legacy) commandFailure("owner_unavailable", "The variant editor is unavailable, busy or awaiting legacy conversion.", "P3");
      try {
        const staged = editor.stageAuthoringDraft(({ draft, library }) => {
          if (!Array.isArray(edits) || !edits.length || edits.length > 256) invalid("A variant batch requires 1–256 edits.");
          for (const edit of edits) {
            validateCommandJson(edit);
            if (edit.kind === "set") {
              exactCommandKeys(edit, ["kind", "field", "value"]);
              const setting = SETTINGS.find(item => item.id === edit.field);
              if (!setting) commandFailure("unknown_setting", "Unknown variant setting.", edit.field);
              validateSettingValue(setting, edit.value);
              commandFailure("read_only", "Edit variant resources through their registered operations.", edit.field);
            } else if (edit.kind === "operation") {
              exactCommandKeys(edit, ["kind", "owner", "operation", "arguments"]);
              if (edit.owner !== "P3") commandFailure("unknown_owner", "This adapter edits P3 only.", "P3");
              draft = applyVariantAuthoringOperation(draft, edit.operation, edit.arguments, library);
            } else commandFailure("unknown_action", "Unknown variant edit.", "P3");
          }
          return draft;
        }, { isCurrent, signal });
        return { ...staged, afterCommit: () => editor.publishAuthoringDraft() };
      } catch (error) {
        if (error.code) throw error;
        commandFailure("invalid_value", String(error.message).slice(0, 512), "P3.draft");
      }
    },
  });
}
