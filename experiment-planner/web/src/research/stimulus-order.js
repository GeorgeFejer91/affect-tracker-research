import { canonicalJson, canonicalSha256 } from "./canonical.js";
import { parseSheetTable } from "./questionnaire-sheet.js";

export const VIDEO_LIBRARY_FILE = "video-library.annotations.json";
export const STIMULUS_ORDER_FILE = "stimulus-order.design.json";
export const ORDER_LIMITS = Object.freeze({ rows: 1024, columns: 64, cells: 32000, videos: 10000, bytes: 4 * 1024 * 1024 });
const SHA = /^[a-f0-9]{64}$/u;
const ANNOTATION = /^video-[a-f0-9]{16}$/u;
const encoder = new TextEncoder();
const clone = (value) => structuredClone(value);
export const isLibraryVideoName = (value) => typeof value === "string" && /\.(mp4|m4v|mov|webm|ogv|avi|mkv)$/iu.test(value);
function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new TypeError(`${label} has unexpected or missing fields.`);
}
function text(value, max, label) {
  if (typeof value !== "string" || !value || encoder.encode(value).length > max || /[\p{Cc}\p{Cf}]/u.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
}
function path(value) {
  text(value, 2048, "Video path");
  if (!value.startsWith("assets/stimuli/") || value.split("/").length > 18
    || value.split("/").some((part) => !part || part === "." || part === ".." || /[<>:"\\|?*]/u.test(part) || /[. ]$/u.test(part))) throw new TypeError("Video path must stay inside assets/stimuli/.");
  return value;
}
export function ordinalCompare(a, b) {
  const left = encoder.encode(a), right = encoder.encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
}
export async function createVideoLibrary(entries) {
  if (!Array.isArray(entries) || entries.length > ORDER_LIMITS.videos) throw new RangeError("Video library exceeds 10000 videos.");
  const ids = new Set(), paths = new Set();
  const videos = [];
  for (const entry of [...entries].sort((a, b) => ordinalCompare(a.relativePath, b.relativePath))) {
    exact(entry, ["relativePath", "sha256", "byteLength"], "Video identity");
    path(entry.relativePath);
    if (!SHA.test(entry.sha256)) throw new TypeError("Video SHA-256 is invalid.");
    integer(entry.byteLength, 1, Number.MAX_SAFE_INTEGER, "Video byte length");
    const annotationId = `video-${(await canonicalSha256(entry)).slice(0, 16)}`;
    if (ids.has(annotationId) || paths.has(entry.relativePath)) throw new TypeError("Video identities or paths collide.");
    ids.add(annotationId); paths.add(entry.relativePath);
    videos.push({ annotationId, ...entry });
  }
  const value = { schema: "affect-research-video-library", version: 1, videos };
  return { ...value, integritySha256: await canonicalSha256(value) };
}
export async function validateVideoLibrary(value) {
  exact(value, ["schema", "version", "videos", "integritySha256"], "Video library");
  if (!Array.isArray(value.videos)) throw new TypeError("Video library must contain video identities.");
  const entries = value.videos.map((video) => {
    exact(video, ["annotationId", "relativePath", "sha256", "byteLength"], "Video annotation");
    const { annotationId, ...entry } = video;
    return entry;
  });
  const expected = await createVideoLibrary(entries);
  if (canonicalJson(expected) !== canonicalJson(value)) throw new TypeError("Video annotation identity or library fingerprint does not match.");
  return clone(expected);
}
export function createStimulusOrder() {
  return { columns: [{ variantId: "variant-1", title: "Variant 1" }], rows: Array.from({ length: 5 }, () => [""]) };
}
function bounds(draft) {
  exact(draft, ["columns", "rows"], "Presentation table");
  if (!Array.isArray(draft.columns) || !Array.isArray(draft.rows)) throw new TypeError("Presentation table is invalid.");
  integer(draft.columns.length, 1, ORDER_LIMITS.columns, "Variant count");
  integer(draft.rows.length, 1, ORDER_LIMITS.rows, "Event count");
  integer(draft.rows.length * draft.columns.length, 1, ORDER_LIMITS.cells, "Table cell count");
  const ids = new Set(), names = new Set();
  draft.columns.forEach((column) => {
    exact(column, ["variantId", "title"], "Variant");
    if (!/^variant-[1-9][0-9]{0,5}$/u.test(column.variantId) || ids.has(column.variantId)) throw new TypeError("Variant identity is invalid or repeated.");
    text(column.title, 120, "Variant name");
    if (column.title !== column.title.trim() || names.has(column.title)) throw new TypeError("Use distinct variant names without leading or trailing spaces.");
    ids.add(column.variantId); names.add(column.title);
  });
  draft.rows.forEach((row) => {
    if (!Array.isArray(row) || row.length !== draft.columns.length) throw new TypeError("Every event row must have one cell per variant.");
    row.forEach((cell) => { if (typeof cell !== "string" || cell.length > 80) throw new TypeError("A table cell must be a video annotation or an ISI in milliseconds."); });
  });
}
export function validateOrderCell(value, library) {
  if (value === "") return value;
  if (/^(0|[1-9][0-9]*)$/u.test(value)) { integer(Number(value), 0, 3600000, "ISI (ms)"); return value; }
  if (!ANNOTATION.test(value) || !library?.videos.some((video) => video.annotationId === value)) throw new TypeError("Use a video annotation from the library or a whole-number ISI from 0 to 3600000 ms.");
  return value;
}
export function setOrderCell(draft, row, column, value, library) {
  bounds(draft); integer(row, 0, draft.rows.length - 1, "Event position"); integer(column, 0, draft.columns.length - 1, "Variant position");
  const next = clone(draft);
  next.rows[row][column] = validateOrderCell(String(value).trim(), library);
  return next;
}
export function addOrderColumn(draft) {
  bounds(draft);
  const next = clone(draft);
  let n = 1;
  while (next.columns.some((column) => column.variantId === `variant-${n}` || column.title === `Variant ${n}`)) n++;
  next.columns.push({ variantId: `variant-${n}`, title: `Variant ${n}` });
  next.rows.forEach((row) => row.push(""));
  bounds(next); return next;
}
export function addOrderRow(draft) {
  const next = clone(draft); next.rows.push(next.columns.map(() => "")); bounds(next); return next;
}
export function pasteStimulusOrder(draft, startRow, startColumn, source, library) {
  bounds(draft); integer(startRow, 0, draft.rows.length - 1, "Event position"); integer(startColumn, 0, draft.columns.length - 1, "Variant position");
  if (typeof source !== "string" || encoder.encode(source).length > ORDER_LIMITS.bytes) throw new RangeError("Paste must be at most 4 MiB.");
  const matrix = parseSheetTable(source, { delimiter: source.includes("\t") ? "\t" : "," });
  if (!matrix.length || matrix.some((row) => row.length !== matrix[0].length)) throw new TypeError("Paste a rectangular block without headers or the Event column.");
  let next = clone(draft);
  while (next.columns.length < startColumn + matrix[0].length) next = addOrderColumn(next);
  while (next.rows.length < startRow + matrix.length) next = addOrderRow(next);
  for (const [r, cells] of matrix.entries()) for (const [c, cell] of cells.entries()) {
    try { next.rows[startRow + r][startColumn + c] = validateOrderCell(cell.trim(), library); }
    catch (error) { throw new TypeError(`Event ${startRow + r + 1}, ${next.columns[startColumn + c].title}: ${error.message}`); }
  }
  bounds(next); return next;
}
/** Authoring projection only. Participant allocation and version recording belong to the Runner. */
export function resolveStimulusVariants(draft, library) {
  bounds(draft);
  return draft.columns.map((column, c) => {
    const cells = draft.rows.map((row) => row[c]);
    let last = cells.length - 1;
    while (last >= 0 && cells[last] === "") last--;
    if (last < 0) throw new TypeError(`${column.title}: add at least one video.`);
    const videos = [], seen = new Set();
    let previousWasVideo = false;
    for (let r = 0; r <= last; r++) {
      const cell = cells[r], location = `Event ${r + 1}, ${column.title}`;
      try { validateOrderCell(cell, library); } catch (error) { throw new TypeError(`${location}: ${error.message}`); }
      if (!cell) throw new TypeError(`${location}: remove the gap or enter a video / ISI.`);
      if (ANNOTATION.test(cell)) {
        if (seen.has(cell)) throw new TypeError(`${location}: a video may occur only once in a variant.`);
        seen.add(cell); videos.push({ stimulusId: cell, isiAfterMs: 0 }); previousWasVideo = true;
      } else {
        if (!previousWasVideo) throw new TypeError(`${location}: an ISI must directly follow a video.`);
        videos.at(-1).isiAfterMs = Number(cell); previousWasVideo = false;
      }
    }
    return { ...column, videos };
  });
}
export async function createStimulusOrderDocument(draft, library) {
  const verified = await validateVideoLibrary(library);
  const resolved = resolveStimulusVariants(draft, verified);
  const variants = [];
  for (const variant of resolved) {
    // Bind exact video identities and ISIs; adding an unrelated library video
    // does not change an existing variant's version annotation.
    variants.push({ ...variant, versionSha256: await canonicalSha256(variant) });
  }
  const value = { schema: "affect-research-stimulus-order", version: 1, librarySha256: verified.integritySha256, ...clone(draft), variants };
  return { ...value, integritySha256: await canonicalSha256(value) };
}
export async function validateStimulusOrderDocument(value, library) {
  exact(value, ["schema", "version", "librarySha256", "columns", "rows", "variants", "integritySha256"], "Stimulus order");
  const expected = await createStimulusOrderDocument({ columns: value.columns, rows: value.rows }, library);
  if (canonicalJson(value) !== canonicalJson(expected)) throw new TypeError("The order belongs to a different library or its fingerprint is invalid. Confirm the current library and review the table.");
  return expected;
}
export function videoLibraryRows(library) {
  return [["Video annotation", "Filename", "Relative path", "SHA-256", "Bytes"], ...library.videos.map((video) => [
    video.annotationId, video.relativePath.split("/").at(-1), video.relativePath, video.sha256, video.byteLength,
  ])];
}
export function videoLibraryCsv(library) {
  return "\uFEFF" + videoLibraryRows(library).map((row) => row.map((value) => {
    const raw = String(value), safe = /^\s*[=+@-]/u.test(raw) ? `'${raw}` : raw;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n") + "\r\n";
}
