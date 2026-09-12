import { canonicalJson, canonicalSha256 } from "./canonical.js";
import { indexVariantVideos } from "./variant-video-catalogue.js";
import { parseSheetTable } from "./questionnaire-sheet.js";
import { ORDER_LIMITS, validateVideoLibrary, validateStimulusOrderDocument } from "./stimulus-order.js";

// Successor Planner contract. Historical numeric/post-video authoring stays in stimulus-order.js.
export const VARIANT_SCHEMA = "affect-research-variant-design";
export const MARKER_CONTRACT = Object.freeze({
  schema: "affect-research-planned-markers", version: 1,
  vocabulary: ["sessionStart", "videoStart", "videoEnd", "isiStart", "isiEnd", "formStart", "formEnd", "pause", "resume", "interruption", "restart", "complete", "partial"],
  identity: "recipe-run-attempt-variant-entry-execution-v1",
  clock: "runner-observed-monotonic-v1", sequence: "strictly-increasing-per-run-v1",
  onset: "observed-media-lifecycle-not-qualified-visible-onset-v1",
  reconstruction: "embedded-codebook-paired-boundaries-no-gap-repair-v1",
});
export const ALLOCATION = Object.freeze({ kind: "runnerAssigned" });
const enc = new TextEncoder();
const clone = value => structuredClone(value);
export class VariantCellError extends TypeError {
  constructor(message, row, column, title) {
    super(`Event ${row + 1}, ${title}: ${message}`);
    this.row = row; this.column = column;
  }
}
export function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new TypeError(`${label}: unexpected or missing fields.`);
}
export function boundedInteger(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${label}: use an integer from ${min} to ${max}.`);
  return value;
}
const safeTitle = value => typeof value === "string" && value.trim() === value && value.length > 0 && enc.encode(value).length <= 120 && !/[\p{Cc}\p{Cf}]/u.test(value);
export function createVariantDraft() {
  return { columns: [{ variantId: "variant-1", title: "Variant 1" }], rows: Array.from({ length: 5 }, () => [""]),
    entryIds: Array.from({ length: 5 }, (_, r) => [`variant-1-entry-${r + 1}`]), isiDefinitions: [], nextIsiOrdinal: 1 };
}
export function validateVariantDraft(draft) {
  exactKeys(draft, ["columns", "rows", "entryIds", "isiDefinitions", "nextIsiOrdinal"], "Variant table");
  if (![draft.columns, draft.rows, draft.entryIds, draft.isiDefinitions].every(Array.isArray)) throw new TypeError("Variant table: arrays required.");
  boundedInteger(draft.columns.length, 1, 64, "Variant count");
  boundedInteger(draft.rows.length, 1, 1024, "Event count");
  boundedInteger(draft.rows.length * draft.columns.length, 1, 32000, "Cell count");
  boundedInteger(draft.nextIsiOrdinal, 1, 1000000, "Next ISI identity");
  if (draft.entryIds.length !== draft.rows.length || draft.isiDefinitions.length > 1024) throw new TypeError("Variant table bounds are invalid.");
  const columns = new Set(), titles = new Set(), entries = new Set(), intervals = new Set();
  for (const column of draft.columns) {
    exactKeys(column, ["variantId", "title"], "Variant");
    if (!/^variant-[1-9][0-9]{0,5}$/u.test(column.variantId) || columns.has(column.variantId) || !safeTitle(column.title) || titles.has(column.title)) throw new TypeError("Use distinct valid variant identities and names.");
    columns.add(column.variantId); titles.add(column.title);
  }
  draft.rows.forEach((row, r) => {
    if (!Array.isArray(row) || row.length !== draft.columns.length || !Array.isArray(draft.entryIds[r]) || draft.entryIds[r].length !== row.length) throw new TypeError("Every row needs one cell and identity per variant.");
    row.forEach((cell, c) => {
      const id = draft.entryIds[r][c], prefix = `${draft.columns[c].variantId}-entry-`;
      if (typeof cell !== "string" || enc.encode(cell).length > 160 || typeof id !== "string" || !id.startsWith(prefix) || !/^[1-9][0-9]{0,5}$/u.test(id.slice(prefix.length)) || entries.has(id)) throw new TypeError("Invalid cell or repeated occurrence identity.");
      entries.add(id);
    });
  });
  for (const isi of draft.isiDefinitions) {
    exactKeys(isi, ["isiId", "durationMs"], "ISI definition");
    if (!/^ISI[1-9][0-9]{0,5}$/u.test(isi.isiId) || intervals.has(isi.isiId) || Number(isi.isiId.slice(3)) >= draft.nextIsiOrdinal) throw new TypeError("ISI identities must be distinct and must not be renumbered.");
    boundedInteger(isi.durationMs, 0, 3600000, `${isi.isiId} duration (ms)`); intervals.add(isi.isiId);
  }
  return draft;
}
export function addIsiDurations(draft, source) {
  validateVariantDraft(draft);
  if (typeof source !== "string" || enc.encode(source).length > 16384 || !source.trim()) throw new TypeError("Enter comma-separated whole milliseconds.");
  const values = source.split(",").map(value => {
    const token = value.trim();
    if (!/^(0|[1-9][0-9]*)$/u.test(token)) throw new TypeError("Each ISI must be a whole number of milliseconds; empty values are not allowed.");
    return boundedInteger(Number(token), 0, 3600000, "ISI duration (ms)");
  });
  const next = clone(draft);
  for (const durationMs of values) next.isiDefinitions.push({ isiId: `ISI${next.nextIsiOrdinal++}`, durationMs });
  validateVariantDraft(next); return next;
}
export function editIsi(draft, isiId, durationMs) {
  const next = clone(draft), isi = next.isiDefinitions.find(item => item.isiId === isiId);
  if (!isi) throw new TypeError("Unknown ISI identity.");
  isi.durationMs = boundedInteger(durationMs, 0, 3600000, `${isiId} duration (ms)`);
  validateVariantDraft(next); return next;
}
export function removeIsi(draft, isiId) {
  if (draft.rows.some(row => row.includes(isiId))) throw new TypeError(`${isiId} is used in the table. Replace or remove its cells before deleting it.`);
  const next = clone(draft); next.isiDefinitions = next.isiDefinitions.filter(isi => isi.isiId !== isiId);
  validateVariantDraft(next); return next;
}
export function resolveVariantCell(cell, library, definitions) {
  if (!cell) return null;
  if (typeof cell !== "string") throw new TypeError("Enter a video annotation or ISI name.");
  const video = library?.videos.find(item => item.annotationId === cell);
  const isi = definitions.find(item => item.isiId === cell);
  if (video && isi) throw new TypeError(`Identity ${cell} collides between the video library and ISI dictionary.`);
  if (isi) return { kind: "isi", referenceId: isi.isiId, durationMs: isi.durationMs };
  if (video) return { kind: "video", referenceId: video.annotationId, durationMs: null };
  if (/^[+-]?(?:\d|\.)/u.test(cell)) throw new TypeError("Use an ISI name from the dictionary, not a numeric duration in the table.");
  throw new TypeError(`Unknown annotation: ${cell}. Choose a video or a defined ISI name.`);
}
export function addVariantRow(draft) {
  const next = clone(draft);
  next.rows.push(next.columns.map(() => ""));
  next.entryIds.push(next.columns.map(column => {
    const prefix = `${column.variantId}-entry-`;
    const max = Math.max(0, ...draft.entryIds.flat().filter(id => id.startsWith(prefix)).map(id => Number(id.slice(prefix.length))));
    return `${prefix}${max + 1}`;
  }));
  validateVariantDraft(next); return next;
}
export function addVariantColumn(draft) {
  const next = clone(draft); let n = 1;
  while (next.columns.some(column => column.variantId === `variant-${n}` || column.title === `Variant ${n}`)) n++;
  next.columns.push({ variantId: `variant-${n}`, title: `Variant ${n}` });
  next.rows.forEach(row => row.push("")); next.entryIds.forEach((row, r) => row.push(`variant-${n}-entry-${r + 1}`));
  validateVariantDraft(next); return next;
}
export function pasteVariantTable(draft, r, c, source, library) {
  validateVariantDraft(draft);
  boundedInteger(r, 0, draft.rows.length - 1, "Event position"); boundedInteger(c, 0, draft.columns.length - 1, "Variant position");
  if (typeof source !== "string" || enc.encode(source).length > ORDER_LIMITS.bytes) throw new TypeError("Paste must be at most 4 MiB.");
  const matrix = parseSheetTable(source, { delimiter: source.includes("\t") ? "\t" : "," });
  if (!matrix.length || matrix.some(row => row.length !== matrix[0].length)) throw new TypeError("Paste a rectangular block without column headings or the Event column.");
  let next = clone(draft);
  while (next.columns.length < c + matrix[0].length) next = addVariantColumn(next);
  while (next.rows.length < r + matrix.length) next = addVariantRow(next);
  matrix.forEach((row, dr) => row.forEach((cell, dc) => {
    const value = cell.trim();
    try { resolveVariantCell(value, library, next.isiDefinitions); }
    catch (error) { throw new VariantCellError(error.message, r + dr, c + dc, next.columns[c + dc].title); }
    next.rows[r + dr][c + dc] = value;
  }));
  validateVariantDraft(next); return next;
}
export function resolveVariantEntries(draft, library) {
  validateVariantDraft(draft);
  if (draft.isiDefinitions.some(isi => library.videos.some(video => video.annotationId === isi.isiId))) throw new TypeError("Video and ISI identities collide.");
  return draft.columns.map((column, c) => {
    let last = draft.rows.findLastIndex(row => row[c] !== "");
    if (last < 0) throw new VariantCellError("add at least one video.", 0, c, column.title);
    const entries = draft.rows.slice(0, last + 1).map((row, r) => {
      let cell;
      try { cell = resolveVariantCell(row[c], library, draft.isiDefinitions); }
      catch (error) { throw new VariantCellError(error.message, r, c, column.title); }
      if (!cell) throw new VariantCellError("fill or remove the interior blank.", r, c, column.title);
      return { entryId: draft.entryIds[r][c], kind: cell.kind, referenceId: cell.referenceId };
    });
    if (!entries.some(entry => entry.kind === "video")) throw new VariantCellError("add at least one video.", 0, c, column.title);
    return { ...column, entries };
  });
}
export async function createVariantDesign(draft, library) {
  await validateVideoLibrary(library);
  const variants = [];
  for (const variant of resolveVariantEntries(draft, library)) {
    const identities = variant.entries.map(entry => entry.kind === "isi"
      ? draft.isiDefinitions.find(isi => isi.isiId === entry.referenceId)
      : library.videos.find(video => video.annotationId === entry.referenceId));
    variants.push({ ...variant, versionSha256: await canonicalSha256({ ...variant, identities }) });
  }
  const value = { schema: VARIANT_SCHEMA, version: 1, librarySha256: library.integritySha256,
    isiDefinitions: clone(draft.isiDefinitions), variants, allocation: clone(ALLOCATION), markerContract: clone(MARKER_CONTRACT) };
  return { ...value, integritySha256: await canonicalSha256(value) };
}
export function variantDesignToDraft(value) {
  exactKeys(value, ["schema", "version", "librarySha256", "isiDefinitions", "variants", "allocation", "markerContract", "integritySha256"], "Variant contribution");
  if (!Array.isArray(value.variants) || !value.variants.length || value.variants.length > 64 || !Array.isArray(value.isiDefinitions)) throw new TypeError("Invalid variant contribution arrays.");
  value.variants.forEach(variant => {
    exactKeys(variant, ["variantId", "title", "entries", "versionSha256"], "Variant");
    if (!Array.isArray(variant.entries) || !variant.entries.length || variant.entries.length > 1024) throw new TypeError("Invalid variant entries.");
    variant.entries.forEach(entry => {
      exactKeys(entry, ["entryId", "kind", "referenceId"], "Planned entry");
      if (!["video", "isi"].includes(entry.kind)) throw new TypeError("Unknown planned entry kind.");
    });
  });
  const height = Math.max(...value.variants.map(variant => variant.entries.length));
  const draft = { columns: value.variants.map(({ variantId, title }) => ({ variantId, title })), rows: [], entryIds: [],
    isiDefinitions: clone(value.isiDefinitions), nextIsiOrdinal: Math.max(0, ...value.isiDefinitions.map(isi => Number(isi.isiId?.slice(3)))) + 1 };
  const nextIds = value.variants.map(variant => Math.max(0, ...variant.entries.map(entry => Number(entry.entryId?.split("-entry-")[1]))) + 1);
  for (let r = 0; r < height; r++) {
    draft.rows.push(value.variants.map(variant => variant.entries[r]?.referenceId ?? ""));
    draft.entryIds.push(value.variants.map((variant, c) => variant.entries[r]?.entryId ?? `${variant.variantId}-entry-${nextIds[c]++}`));
  }
  validateVariantDraft(draft); return draft;
}
export async function validateVariantDesign(value, library) {
  const expected = await createVariantDesign(variantDesignToDraft(value), library);
  if (canonicalJson(value) !== canonicalJson(expected)) throw new TypeError("Variant contribution integrity, allocation ownership or entry kinds do not match.");
  return expected;
}
export async function createVariantDocument(draft, library) {
  await validateVideoLibrary(library);
  const contribution = await createVariantDesign(draft, library);
  const value = { schema: "affect-research-stimulus-order", version: 2, librarySha256: library.integritySha256, draft: clone(draft), contribution };
  return { ...value, integritySha256: await canonicalSha256(value) };
}
export async function validateVariantDocument(value, library) {
  exactKeys(value, ["schema", "version", "librarySha256", "draft", "contribution", "integritySha256"], "Variant document");
  const expected = await createVariantDocument(value.draft, library);
  if (canonicalJson(value) !== canonicalJson(expected)) throw new TypeError("Variant document identity, references or integrity do not match.");
  return expected;
}
export async function validateStoredVariantDocument(value, library) {
  return value?.version === 1 ? validateStimulusOrderDocument(value, library) : validateVariantDocument(value, library);
}
export function migrateLegacyOrder(value) {
  const draft = createVariantDraft();
  draft.columns = clone(value.columns); draft.rows = clone(value.rows);
  draft.entryIds = draft.rows.map((row, r) => row.map((_, c) => `${draft.columns[c].variantId}-entry-${r + 1}`));
  const durations = new Map();
  draft.rows = draft.rows.map(row => row.map(cell => {
    if (!/^(0|[1-9][0-9]*)$/u.test(cell)) return cell;
    if (!durations.has(cell)) {
      const isiId = `ISI${draft.nextIsiOrdinal++}`; durations.set(cell, isiId);
      draft.isiDefinitions.push({ isiId, durationMs: Number(cell) });
    }
    return durations.get(cell);
  }));
  validateVariantDraft(draft); return draft;
}
/** Resolve planned boundaries. No clock reading, synthetic measured onset, or hidden intervals. */
export function compileVariantTimeline(contribution, variantId, videos) {
  const videoIndex = indexVariantVideos(videos);
  const variant = contribution.variants.find(item => item.variantId === variantId);
  if (!variant) throw new TypeError("Unknown variant.");
  let elapsed = 0;
  const events = [];
  for (const [position, entry] of variant.entries.entries()) {
    const durationMs = entry.kind === "isi" ? contribution.isiDefinitions.find(isi => isi.isiId === entry.referenceId)?.durationMs
      : videoIndex.get(entry.referenceId)?.durationMs;
    boundedInteger(durationMs, entry.kind === "video" ? 1 : 0, entry.kind === "video" ? Number.MAX_SAFE_INTEGER : 3600000, `${entry.referenceId} duration from ${entry.kind === "video" ? "Segment 1" : "the dictionary"}`);
    const base = { variantId, entryId: entry.entryId, kind: entry.kind, referenceId: entry.referenceId, position: position + 1 };
    events.push({ ...base, eventId: `${entry.entryId}-start`, eventType: `${entry.kind}Start`, plannedOffsetMs: elapsed });
    elapsed += durationMs; boundedInteger(elapsed, 0, Number.MAX_SAFE_INTEGER, "Planned duration");
    events.push({ ...base, eventId: `${entry.entryId}-end`, eventType: `${entry.kind}End`, plannedOffsetMs: elapsed });
  }
  return { variantId, versionSha256: variant.versionSha256, plannedDurationMs: elapsed, events };
}
function colorIndex(annotationId) {
  let hash = 2166136261;
  for (const byte of enc.encode(annotationId)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
}
// IDs already contain a uniformly distributed content digest. Use that identity
// directly: adding/removing/reordering catalogue entries cannot recolor a video.
// The hue range excludes the red reserved for ISIs; text remains authoritative
// because large catalogues inevitably contain perceptually similar colors.
export function videoColor(annotationId) {
  const match = /^video-([a-f0-9]{8})([a-f0-9]{8})$/u.exec(annotationId);
  const hueSeed = match ? Number.parseInt(match[1], 16) : colorIndex(annotationId);
  const toneSeed = match ? Number.parseInt(match[2], 16) : colorIndex(`tone:${annotationId}`);
  return `hsl(${(45 + hueSeed / 0xffffffff * 255).toFixed(6)} ${55 + toneSeed % 26}% ${70 + (toneSeed >>> 8) % 11}%)`;
}
export function videoColorMap(library) {
  return new Map(library.videos.map(video => [video.annotationId, videoColor(video.annotationId)]));
}
