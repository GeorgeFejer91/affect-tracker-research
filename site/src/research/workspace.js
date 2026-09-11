import { canonicalJson, canonicalSha256 } from "./canonical.js";
import {
  validateResearchEventV1,
  validateResearchRunManifestV2,
  validateResearchSampleV1,
  validateResearchSettingsV1,
} from "./contracts.js";
import {
  validateResearchSettingsV2,
  validateResolvedProtocolPlanV1,
} from "./protocol-plan.js";
import {
  validateResearchSettingsV3,
  validateResolvedProtocolPlanV2,
} from "./external-protocol.js";
import {
  EXPERIMENT_PACKAGE_FILE_NAME,
  MAX_EXPERIMENT_PACKAGE_BYTES,
  compileExperimentPackageSelectionV1,
  enumerateLanguageRoutesV1,
  parseExperimentPackageV1,
  validateExperimentPackageV1,
  validateExperimentPackageRunBindingV1,
} from "./experiment-package.js";
import {
  parseExperimentDefinitionV1,
  validateResolvedExperimentPlanV1,
} from "./external-experiment.js";
import {
  QUESTIONNAIRE_RESPONSE_COLUMNS,
  questionnaireToCsv,
  serializeQuestionnaireResponses,
  validateQuestionnaireResponseV1,
} from "./questionnaires.js";
import {
  RESEARCH_SAMPLE_COLUMNS,
  serializeRatings,
} from "./tabular.js";
import {
  validateResearchEventV2,
  validateResearchRunManifestV3,
  validateResearchRunManifestV4,
} from "./protocol-records.js";

export const RESEARCH_STORAGE_NAMESPACE = "affect-research/v1";
export const RESEARCH_WORKSPACE_IDENTITY_FILE = "workspace.identity.json";
export const RESEARCH_WORKSPACE_DIRECTORIES = Object.freeze([
  "stimuli",
  "settings",
  "outputs",
  "recovery",
]);
export const RESEARCH_PACKAGE_ASSET_DIRECTORY = "assets/stimuli";
export const RESEARCH_QUESTIONNAIRE_ASSET_DIRECTORY = "assets/questionnaires";

export const VIDEO_FILE_EXTENSIONS = Object.freeze([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".ogv",
]);

const UNSAFE_SEGMENT = /[<>:"/\\|?*\u0000-\u001f]/u;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const WORKSPACE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const MAX_SCAN_DEPTH = 32;
const MAX_SCAN_ENTRIES = 10_000;
const MAX_SETTINGS_SNAPSHOT_BYTES = 5 * 1024 * 1024;
const MAX_EXPERIMENT_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_QUESTIONNAIRE_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_EXPERIMENT_PLAN_SNAPSHOT_BYTES = 256 * 1024 * 1024;
const MAX_PROTOCOL_PLAN_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_EVENT_LOG_BYTES = 256 * 1024 * 1024;
const MAX_TABULAR_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_ATTESTED_EVENT_RECORDS = 5_000_000;
const MAX_ATTESTED_TABLE_ROWS = 5_000_000;
const QUESTIONNAIRE_ASSET_IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,127}$/u;
const QUESTIONNAIRE_ASSET_FORMATS = new Set(["csv", "txt", "json"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ATTEMPT_ARTIFACT_NAMES = Object.freeze([
  "settings.snapshot.json",
  "experiment.json",
  "experiment-plan.snapshot.json",
  "experiment.package.json",
  "protocol-plan.snapshot.json",
  "events.jsonl",
  "ratings.csv",
  "ratings.tsv",
  "questionnaire-responses.csv",
  "questionnaire-responses.tsv",
]);

export class ResearchWorkspaceError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "ResearchWorkspaceError";
    this.code = code;
  }
}

export function parseStrictJson(text, { maximumBytes = 5 * 1024 * 1024 } = {}) {
  if (typeof text !== "string") fail("settings-json", "Settings JSON must be UTF-8 text.");
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength < 1 || byteLength > maximumBytes) {
    fail("settings-size", `Settings JSON must contain between 1 byte and ${maximumBytes} bytes.`);
  }
  let index = 0;
  const whitespace = /[\u0009\u000a\u000d\u0020]/u;
  const skipWhitespace = () => {
    while (index < text.length && whitespace.test(text[index])) index += 1;
  };
  const syntax = (message) => fail("settings-json", `${message} at character ${index}.`);
  const parseStringToken = () => {
    if (text[index] !== '"') syntax("Expected a JSON string");
    const start = index;
    index += 1;
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index));
        } catch (error) {
          fail("settings-json", "Settings contains an invalid JSON string.", { cause: error });
        }
      }
      if (character === "\\") {
        index += 1;
        if (index >= text.length) syntax("Unterminated JSON escape");
        if (text[index] === "u") {
          const digits = text.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(digits)) syntax("Invalid JSON Unicode escape");
          index += 4;
        } else if (!/["\\/bfnrt]/u.test(text[index])) syntax("Invalid JSON escape");
      } else if (character.charCodeAt(0) <= 0x1f) syntax("Unescaped control character in JSON string");
      index += 1;
    }
    syntax("Unterminated JSON string");
  };
  const parseValue = () => {
    skipWhitespace();
    const character = text[index];
    if (character === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[index] === "}") { index += 1; return; }
      while (index < text.length) {
        skipWhitespace();
        const key = parseStringToken();
        if (keys.has(key)) fail("duplicate-json-key", `Settings JSON contains duplicate object key ${JSON.stringify(key)}.`);
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ":") syntax("Expected ':' after JSON object key");
        index += 1;
        parseValue();
        skipWhitespace();
        if (text[index] === "}") { index += 1; return; }
        if (text[index] !== ",") syntax("Expected ',' or '}' in JSON object");
        index += 1;
      }
      syntax("Unterminated JSON object");
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      if (text[index] === "]") { index += 1; return; }
      while (index < text.length) {
        parseValue();
        skipWhitespace();
        if (text[index] === "]") { index += 1; return; }
        if (text[index] !== ",") syntax("Expected ',' or ']' in JSON array");
        index += 1;
      }
      syntax("Unterminated JSON array");
    }
    if (character === '"') { parseStringToken(); return; }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, index)) { index += literal.length; return; }
    }
    const remainder = text.slice(index);
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(remainder)?.[0];
    if (!number) syntax("Expected a JSON value");
    index += number.length;
  };
  parseValue();
  skipWhitespace();
  if (index !== text.length) syntax("Unexpected content after JSON value");
  try {
    return JSON.parse(text);
  } catch (error) {
    fail("settings-json", "Settings file is not valid JSON.", { cause: error });
  }
}

function fail(code, message, options) {
  throw new ResearchWorkspaceError(code, message, options);
}

export function assertSafeWorkspaceSegment(value, label = "path segment") {
  if (typeof value !== "string" || value.length < 1 || value.length > 240
    || value === "." || value === ".." || UNSAFE_SEGMENT.test(value)) {
    fail("unsafe-segment", `${label} contains an unsafe or unsupported path component.`);
  }
  return value;
}

function canonicalQuestionnaireAssetIdentifier(value, label) {
  if (typeof value !== "string" || !QUESTIONNAIRE_ASSET_IDENTIFIER.test(value)) {
    fail("questionnaire-asset-identifier", `${label} must be a canonical lowercase identifier.`);
  }
  return value;
}

function questionnaireSourceBytes(value) {
  let bytes;
  if (value instanceof Uint8Array) bytes = new Uint8Array(value);
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value.slice(0));
  else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  } else {
    fail("questionnaire-asset-bytes", "Questionnaire source content must be supplied as bytes.");
  }
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_QUESTIONNAIRE_SOURCE_BYTES) {
    fail("questionnaire-asset-size", "A questionnaire source must contain 1 byte–5 MiB.");
  }
  return bytes;
}

export function normalizeWorkspaceRelativePath(value, label = "relative path") {
  if (typeof value !== "string") fail("unsafe-path", `${label} must be text.`);
  if (/^[\\/]/u.test(value)) fail("unsafe-path", `${label} must be relative.`);
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.length > 32) {
    fail("unsafe-path", `${label} must contain between 1 and 32 segments.`);
  }
  for (const part of parts) {
    assertSafeWorkspaceSegment(part, label);
    let decoded = part;
    for (let pass = 0; pass < 3 && /%[0-9a-f]{2}/iu.test(decoded); pass += 1) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        fail("unsafe-path", `${label} contains invalid percent encoding.`);
      }
      if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")
        || UNSAFE_SEGMENT.test(decoded)) {
        fail("unsafe-path", `${label} contains an encoded unsafe path component.`);
      }
    }
  }
  return parts.join("/");
}

export function isSupportedVideoName(name) {
  if (typeof name !== "string") return false;
  const lower = name.toLowerCase();
  return VIDEO_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function parseExperimentalYouTubeUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("youtube-url", "YouTube source must be a valid HTTPS URL.");
  }
  if (url.protocol !== "https:") fail("youtube-url", "YouTube source must use HTTPS.");

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = "";
  if (hostname === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
  } else if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(hostname)) {
    if (url.pathname === "/watch") videoId = url.searchParams.get("v") ?? "";
    else {
      const parts = url.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(parts[0])) videoId = parts[1] ?? "";
    }
  } else {
    fail("youtube-url", "Only youtube.com, youtube-nocookie.com, or youtu.be URLs are accepted.");
  }

  if (!YOUTUBE_ID.test(videoId)) fail("youtube-url", "YouTube URL does not contain a valid video ID.");
  return Object.freeze({
    sourceKind: "youtube-experimental",
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    verification: "unverified-noncanonical",
    sha256: null,
  });
}

export async function sha256Blob(blob, cryptoObject = globalThis.crypto) {
  if (!(blob instanceof Blob) || blob.size < 1) fail("empty-file", "Video file is empty.");
  if (!cryptoObject?.subtle?.digest) fail("hash-unavailable", "SHA-256 is unavailable in this context.");
  const digest = await cryptoObject.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function probeVideoElement(video, { timeoutMs = 15_000 } = {}) {
  if (!video || typeof video.addEventListener !== "function") {
    fail("decode-unavailable", "Video decode preflight could not create a media element.");
  }
  const waitForEvent = (type, message) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new ResearchWorkspaceError("decode-timeout", message));
    }, timeoutMs);
    const loaded = (event) => { cleanup(); resolve(event); };
    const errored = () => {
      cleanup();
      reject(new ResearchWorkspaceError("decode-failed", "The browser could not decode the selected complete video."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(type, loaded);
      video.removeEventListener("error", errored);
    };
    video.addEventListener(type, loaded, { once: true });
    video.addEventListener("error", errored, { once: true });
  });
  const waitForDecodedFrame = (expectedPosition, durationSeconds) => new Promise((resolve, reject) => {
    if (typeof video.requestVideoFrameCallback !== "function") {
      reject(new ResearchWorkspaceError(
        "decode-unavailable",
        "Decoded-frame verification requires desktop Chrome or Edge video frame callbacks.",
      ));
      return;
    }
    let callbackId = null;
    let settled = false;
    const toleranceSeconds = Math.max(0.05, Math.min(0.5, durationSeconds * 0.02));
    const cleanup = () => {
      if (callbackId !== null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(callbackId);
      }
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      settled = true;
      cleanup();
      reject(new ResearchWorkspaceError(
        "decode-timeout",
        "A representative video frame was not decoded before the preflight deadline.",
      ));
    }, timeoutMs);
    const requestFrame = () => {
      callbackId = video.requestVideoFrameCallback((_now, metadata) => {
        if (settled) return;
        const mediaTime = Number(metadata?.mediaTime);
        if (Number.isFinite(mediaTime) && Math.abs(mediaTime - expectedPosition) <= toleranceSeconds) {
          settled = true;
          cleanup();
          resolve(mediaTime);
          return;
        }
        requestFrame();
      });
    };
    requestFrame();
  });

  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  const metadata = waitForEvent(
    "loadedmetadata",
    "Video metadata did not become available before the preflight deadline.",
  );
  video.load?.();
  await metadata;
  const durationSeconds = Number(video.duration);
  const videoWidth = Number(video.videoWidth);
  const videoHeight = Number(video.videoHeight);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    fail("invalid-duration", "Video duration must be finite and positive.");
  }
  if (!Number.isInteger(videoWidth) || videoWidth <= 0
    || !Number.isInteger(videoHeight) || videoHeight <= 0) {
    fail("decode-failed", "Video metadata must include positive integer frame dimensions.");
  }
  const candidates = [
    Math.min(durationSeconds * 0.1, 0.25),
    durationSeconds * 0.5,
    Math.max(0, durationSeconds - Math.min(0.25, durationSeconds * 0.1)),
  ];
  const decodedPositionsSeconds = [];
  for (const position of candidates) {
    const bounded = Math.max(0, Math.min(durationSeconds, position));
    if (decodedPositionsSeconds.some((existing) => Math.abs(existing - bounded) < 0.001)) continue;
    const seeked = waitForEvent(
      "seeked",
      "A representative video position could not be decoded before the preflight deadline.",
    );
    video.currentTime = bounded;
    // Subscribe in the same task that initiated the seek, before yielding to
    // either the seek event or compositor, so the target frame cannot race us.
    const decodedFrame = waitForDecodedFrame(bounded, durationSeconds);
    await Promise.all([seeked, decodedFrame]);
    decodedPositionsSeconds.push(bounded);
  }
  if (decodedPositionsSeconds.length !== 3) {
    fail("decode-failed", "The complete video did not expose distinct near-start, midpoint, and near-end frames.");
  }
  return Object.freeze({
    durationSeconds,
    videoWidth,
    videoHeight,
    decodeVerified: true,
    decodedPositionsSeconds: Object.freeze(decodedPositionsSeconds),
  });
}

export async function probeVideoFile(file, {
  createObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL),
  revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL),
  createVideo = () => globalThis.document?.createElement?.("video"),
  timeoutMs = 15_000,
} = {}) {
  if (!(file instanceof Blob) || file.size < 1) fail("empty-file", "Video file is empty.");
  if (!createObjectURL || !revokeObjectURL || !createVideo) {
    fail("decode-unavailable", "Video decode preflight is unavailable in this context.");
  }
  const video = createVideo();
  if (!video || typeof video.addEventListener !== "function") {
    fail("decode-unavailable", "Video decode preflight could not create a media element.");
  }

  const objectUrl = createObjectURL(file);
  try {
    video.src = objectUrl;
    return await probeVideoElement(video, { timeoutMs });
  } finally {
    video.pause?.();
    video.removeAttribute?.("src");
    video.load?.();
    revokeObjectURL(objectUrl);
  }
}

async function permissionState(handle, mode) {
  if (typeof handle?.queryPermission !== "function") return "granted";
  return handle.queryPermission({ mode });
}

async function ensurePermission(handle, mode, { request = false } = {}) {
  let state = await permissionState(handle, mode);
  if (state !== "granted" && request && typeof handle?.requestPermission === "function") {
    state = await handle.requestPermission({ mode });
  }
  if (state !== "granted") {
    fail("permission-required", `Workspace ${mode} permission requires a fresh user action.`);
  }
  return true;
}

async function getChildDirectory(parent, name, { create = false } = {}) {
  assertSafeWorkspaceSegment(name, "directory name");
  return parent.getDirectoryHandle(name, { create });
}

async function getNestedDirectory(parent, segments, { create = false } = {}) {
  let current = parent;
  for (const segment of segments) current = await getChildDirectory(current, segment, { create });
  return current;
}

async function fileExists(directory, name) {
  try {
    await directory.getFileHandle(name, { create: false });
    return true;
  } catch (error) {
    if (error?.name === "NotFoundError") return false;
    throw error;
  }
}

async function writeNewFile(directory, name, body) {
  assertSafeWorkspaceSegment(name, "file name");
  if (await fileExists(directory, name)) {
    fail("already-exists", `${name} already exists; Research never overwrites attempt evidence.`);
  }
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable({ keepExistingData: false });
  try {
    await writable.write(body);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort?.();
    } catch {
      // The write failure remains the authoritative error.
    }
    throw error;
  }
  return handle;
}

async function replaceFile(directory, name, body) {
  assertSafeWorkspaceSegment(name, "file name");
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable({ keepExistingData: false });
  try {
    await writable.write(body);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort?.();
    } catch {
      // The write failure remains the authoritative error.
    }
    throw error;
  }
  return handle;
}

async function writeIdempotentAttemptFile(directory, name, body) {
  assertSafeWorkspaceSegment(name, "file name");
  if (typeof body !== "string") fail("artifacts", `${name} must be serialized UTF-8 text.`);
  if (!(await fileExists(directory, name))) return writeNewFile(directory, name, body);
  const handle = await directory.getFileHandle(name, { create: false });
  const existing = await handle.getFile();
  if (await existing.text() === body) return handle;
  fail("artifact-conflict", `${name} already exists with different bytes; Research never rewrites attempt evidence.`);
}

function newWorkspaceId(cryptoObject) {
  if (typeof cryptoObject?.randomUUID === "function") return cryptoObject.randomUUID().toLowerCase();
  const bytes = new Uint8Array(16);
  cryptoObject?.getRandomValues?.(bytes);
  if (bytes.every((byte) => byte === 0)) fail("workspace-identity", "Secure workspace identity generation is unavailable.");
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function* walkVideos(directory, prefix = "", state = { entries: 0 }, depth = 0) {
  if (depth > MAX_SCAN_DEPTH) {
    fail("scan-depth", `Stimulus discovery exceeds the supported ${MAX_SCAN_DEPTH}-directory depth.`);
  }
  for await (const [name, handle] of directory.entries()) {
    state.entries += 1;
    if (state.entries > MAX_SCAN_ENTRIES) {
      fail("scan-capacity", `Stimulus discovery exceeds the supported ${MAX_SCAN_ENTRIES.toLocaleString("en")}-entry workspace scan.`);
    }
    const safeName = assertSafeWorkspaceSegment(name, "workspace entry");
    const relativePath = prefix ? `${prefix}/${safeName}` : safeName;
    if (handle.kind === "directory") yield* walkVideos(handle, relativePath, state, depth + 1);
    else if (handle.kind === "file" && isSupportedVideoName(safeName)) {
      const file = await handle.getFile();
      yield Object.freeze({
        sourceKind: "workspace-file",
        relativePath,
        name: safeName,
        byteLength: file.size,
        lastModified: file.lastModified,
        mediaType: file.type || "application/octet-stream",
        fileHandle: handle,
      });
    }
  }
}

async function* walkPackageFiles(directory, prefix = "", state = { entries: 0 }, depth = 0) {
  if (depth > MAX_SCAN_DEPTH) {
    fail("scan-depth", `Package asset verification exceeds the supported ${MAX_SCAN_DEPTH}-directory depth.`);
  }
  for await (const [name, handle] of directory.entries()) {
    state.entries += 1;
    if (state.entries > MAX_SCAN_ENTRIES) {
      fail(
        "scan-capacity",
        `Package asset verification exceeds the supported ${MAX_SCAN_ENTRIES.toLocaleString("en")}-entry scan.`,
      );
    }
    const safeName = assertSafeWorkspaceSegment(name, "package asset entry");
    if (typeof handle?.name === "string" && handle.name !== safeName) {
      fail("package-asset-unverifiable", `Package asset handle name does not match ${safeName}.`);
    }
    const relativePath = prefix ? `${prefix}/${safeName}` : safeName;
    if (handle?.kind === "directory") {
      yield* walkPackageFiles(handle, relativePath, state, depth + 1);
      continue;
    }
    if (handle?.kind !== "file" || typeof handle.getFile !== "function") {
      fail("package-asset-unverifiable", `Package asset ${relativePath} is not a verifiable file.`);
    }
    let file;
    try {
      file = await handle.getFile();
    } catch (error) {
      fail("package-asset-unverifiable", `Package asset ${relativePath} could not be read.`, { cause: error });
    }
    if (!(file instanceof Blob)) {
      fail("package-asset-unverifiable", `Package asset ${relativePath} did not resolve to file bytes.`);
    }
    yield Object.freeze({
      relativePath,
      name: safeName,
      byteLength: file.size,
      lastModified: file.lastModified,
      mediaType: file.type || "application/octet-stream",
      fileHandle: handle,
      file,
    });
  }
}

async function readBoundedJsonFile(handle, label, { maximumBytes = 4 * 1024 * 1024 } = {}) {
  const file = await handle.getFile();
  if (file.size < 1 || file.size > maximumBytes) {
    fail("invalid-json-file", `${label} must contain between 1 byte and ${maximumBytes} bytes.`);
  }
  try {
    return parseStrictJson(await file.text(), { maximumBytes });
  } catch (error) {
    fail(error?.code ?? "invalid-json-file", `${label} is not valid JSON under the strict parser.`, { cause: error });
  }
}

function parseDelimitedTable(text, delimiter, label, {
  columns = RESEARCH_SAMPLE_COLUMNS,
  maximumRows = Number.MAX_SAFE_INTEGER,
} = {}) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"' && cell.length === 0) quoted = true;
    else if (character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (character === "\r" && text[index + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      if (rows.length > maximumRows + 1) {
        fail("artifact-table", `${label} exceeds the supported ${maximumRows} data rows.`);
      }
      row = [];
      cell = "";
      index += 1;
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      if (rows.length > maximumRows + 1) {
        fail("artifact-table", `${label} exceeds the supported ${maximumRows} data rows.`);
      }
      row = [];
      cell = "";
    } else cell += character;
  }
  if (quoted) fail("artifact-table", `${label} ends inside a quoted field.`);
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  if (rows.length > maximumRows + 1) {
    fail("artifact-table", `${label} exceeds the supported ${maximumRows} data rows.`);
  }
  if (rows.length < 1 || rows[0].join("\u0000") !== columns.join("\u0000")) {
    fail("artifact-table", `${label} does not use its exact canonical columns.`);
  }
  if (rows.some((candidate) => candidate.length !== columns.length)) {
    fail("artifact-table", `${label} contains a row with a noncanonical column count.`);
  }
  return rows;
}

function unsignedIntegerCell(value, label, { nullable = false } = {}) {
  if (nullable && value === "") return null;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    fail("artifact-table-record", `${label} must be a canonical unsigned integer.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    fail("artifact-table-record", `${label} exceeds the supported safe-integer range.`);
  }
  return number;
}

function finiteNumberCell(value, label, { nullable = false } = {}) {
  if (nullable && value === "") return null;
  if (typeof value !== "string" || value.length < 1) {
    fail("artifact-table-record", `${label} must be a canonical finite number.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    fail("artifact-table-record", `${label} must be a canonical finite number.`);
  }
  return number;
}

function booleanCell(value, label) {
  if (value === "true") return true;
  if (value === "false") return false;
  fail("artifact-table-record", `${label} must be true or false.`);
}

function rowCells(columns, row) {
  return Object.fromEntries(columns.map((name, index) => [name, row[index]]));
}

function ratingRecordFromRow(row, label) {
  const cell = rowCells(RESEARCH_SAMPLE_COLUMNS, row);
  try {
    return validateResearchSampleV1({
      schema: cell.schema,
      version: unsignedIntegerCell(cell.version, `${label}.version`),
      sequence: unsignedIntegerCell(cell.sequence, `${label}.sequence`),
      runId: cell.runId,
      participantId: cell.participantId,
      attemptNumber: unsignedIntegerCell(cell.attemptNumber, `${label}.attemptNumber`),
      settingsSha256: cell.settingsSha256,
      assignmentPlanSha256: cell.assignmentPlanSha256,
      stimulusPosition: unsignedIntegerCell(cell.stimulusPosition, `${label}.stimulusPosition`),
      stimulusIdentity: {
        kind: cell.stimulusKind,
        stimulusId: cell.stimulusId,
        sha256: cell.stimulusSha256 === "" ? null : cell.stimulusSha256,
        byteLength: unsignedIntegerCell(
          cell.stimulusByteLength,
          `${label}.stimulusByteLength`,
          { nullable: true },
        ),
        durationMs: finiteNumberCell(cell.stimulusDurationMs, `${label}.stimulusDurationMs`),
        url: cell.stimulusUrl === "" ? null : cell.stimulusUrl,
        videoId: cell.stimulusVideoId === "" ? null : cell.stimulusVideoId,
      },
      wallTimeUtc: cell.wallTimeUtc,
      monotonicTimeNs: cell.monotonicTimeNs,
      lslTimeSeconds: finiteNumberCell(cell.lslTimeSeconds, `${label}.lslTimeSeconds`, { nullable: true }),
      sampleRateHz: unsignedIntegerCell(cell.sampleRateHz, `${label}.sampleRateHz`),
      scheduledElapsedMs: finiteNumberCell(cell.scheduledElapsedMs, `${label}.scheduledElapsedMs`),
      observedElapsedMs: finiteNumberCell(cell.observedElapsedMs, `${label}.observedElapsedMs`),
      schedulerLatenessMs: finiteNumberCell(cell.schedulerLatenessMs, `${label}.schedulerLatenessMs`),
      schedulerJitterMs: finiteNumberCell(cell.schedulerJitterMs, `${label}.schedulerJitterMs`),
      stateAnchorAgeMs: finiteNumberCell(cell.stateAnchorAgeMs, `${label}.stateAnchorAgeMs`),
      missedSlotsBefore: unsignedIntegerCell(cell.missedSlotsBefore, `${label}.missedSlotsBefore`),
      mediaTimeMs: finiteNumberCell(cell.mediaTimeMs, `${label}.mediaTimeMs`),
      currentValence: finiteNumberCell(cell.currentValence, `${label}.currentValence`),
      currentArousal: finiteNumberCell(cell.currentArousal, `${label}.currentArousal`),
      targetValence: finiteNumberCell(cell.targetValence, `${label}.targetValence`),
      targetArousal: finiteNumberCell(cell.targetArousal, `${label}.targetArousal`),
      radius: finiteNumberCell(cell.radius, `${label}.radius`),
      angleDegrees: finiteNumberCell(cell.angleDegrees, `${label}.angleDegrees`),
      oscillationFrequency: finiteNumberCell(cell.oscillationFrequency, `${label}.oscillationFrequency`),
      edgeSmoothness: finiteNumberCell(cell.edgeSmoothness, `${label}.edgeSmoothness`),
      projectionAmplitude: finiteNumberCell(cell.projectionAmplitude, `${label}.projectionAmplitude`),
      pulseSynchrony: finiteNumberCell(cell.pulseSynchrony, `${label}.pulseSynchrony`),
      waveSizeVariation: finiteNumberCell(cell.waveSizeVariation, `${label}.waveSizeVariation`),
      saturation: finiteNumberCell(cell.saturation, `${label}.saturation`),
      animationActive: booleanCell(cell.animationActive, `${label}.animationActive`),
      inputActive: booleanCell(cell.inputActive, `${label}.inputActive`),
      inputKind: cell.inputKind,
      feedbackVisible: booleanCell(cell.feedbackVisible, `${label}.feedbackVisible`),
    });
  } catch (error) {
    if (error instanceof ResearchWorkspaceError) throw error;
    fail("artifact-sample-record", `${label} is not a strict ResearchSampleV1 record.`, { cause: error });
  }
}

function questionnaireRecordFromRow(row, label) {
  const cell = rowCells(QUESTIONNAIRE_RESPONSE_COLUMNS, row);
  try {
    return validateQuestionnaireResponseV1({
      schema: cell.schema,
      version: unsignedIntegerCell(cell.version, `${label}.version`),
      sequence: unsignedIntegerCell(cell.sequence, `${label}.sequence`),
      runId: cell.runId,
      participantId: cell.participantId,
      attemptNumber: unsignedIntegerCell(cell.attemptNumber, `${label}.attemptNumber`),
      settingsSha256: cell.settingsSha256,
      assignmentPlanSha256: cell.assignmentPlanSha256,
      protocolPlanSha256: cell.protocolPlanSha256,
      protocolStepPosition: unsignedIntegerCell(
        cell.protocolStepPosition,
        `${label}.protocolStepPosition`,
      ),
      moduleId: cell.moduleId,
      questionnaireId: cell.questionnaireId,
      questionnaireVersion: cell.questionnaireVersion,
      definitionSha256: cell.definitionSha256,
      itemId: cell.itemId,
      itemOrder: unsignedIntegerCell(cell.itemOrder, `${label}.itemOrder`),
      optionId: cell.optionId,
      optionOrder: unsignedIntegerCell(cell.optionOrder, `${label}.optionOrder`),
      responseLabel: cell.responseLabel,
      scoreValue: finiteNumberCell(cell.scoreValue, `${label}.scoreValue`, { nullable: true }),
      subscale: cell.subscale === "" ? null : cell.subscale,
      status: cell.status,
      wallTimeUtc: cell.wallTimeUtc,
      monotonicTimeNs: cell.monotonicTimeNs,
      responseLatencyMs: finiteNumberCell(cell.responseLatencyMs, `${label}.responseLatencyMs`),
    });
  } catch (error) {
    if (error instanceof ResearchWorkspaceError) throw error;
    fail(
      "artifact-questionnaire-record",
      `${label} is not a strict QuestionnaireResponseV1 record.`,
      { cause: error },
    );
  }
}

function attestRatingRows(rows, manifest, label) {
  const column = Object.fromEntries(RESEARCH_SAMPLE_COLUMNS.map((name, index) => [name, index]));
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const position = Number(row[column.stimulusPosition]);
    const stimulus = manifest.stimuli[position - 1];
    if (row[column.sequence] !== String(index)
      || row[column.runId] !== manifest.runId
      || row[column.participantId] !== manifest.participantId
      || row[column.attemptNumber] !== String(manifest.attemptNumber)
      || row[column.settingsSha256] !== manifest.settingsSha256
      || row[column.assignmentPlanSha256] !== manifest.assignmentPlanSha256
      || row[column.sampleRateHz] !== String(manifest.timing.sampleRateHz)
      || !stimulus
      || row[column.stimulusId] !== stimulus.stimulusId
      || row[column.stimulusKind] !== stimulus.kind
      || row[column.stimulusSha256] !== (stimulus.sha256 ?? "")
      || row[column.stimulusByteLength] !== (stimulus.byteLength === null ? "" : String(stimulus.byteLength))
      || row[column.stimulusDurationMs] !== String(stimulus.durationMs)
      || row[column.stimulusUrl] !== (stimulus.url ?? "")
      || row[column.stimulusVideoId] !== (stimulus.videoId ?? "")) {
      fail("artifact-sample-binding", `${label} row ${index} is not canonically bound to this run and stimulus position.`);
    }
  }
}

async function attestManifestArtifacts(sessionDirectory, manifest) {
  const expectedNames = Object.freeze({
    settings: "settings.snapshot.json",
    events: "events.jsonl",
    csv: "ratings.csv",
    tsv: "ratings.tsv",
  });
  const tables = new Map();
  for (const output of manifest.outputs) {
    if (output.fileName !== expectedNames[output.kind]) {
      fail("artifact-name", `Manifest ${output.kind} output must be ${expectedNames[output.kind]}.`);
    }
    const handle = await sessionDirectory.getFileHandle(output.fileName, { create: false });
    const file = await handle.getFile();
    if (file.size !== output.byteLength) {
      fail("artifact-size", `${output.fileName} byte length does not match its manifest receipt.`);
    }
    if (await sha256Blob(file) !== output.sha256) {
      fail("artifact-hash", `${output.fileName} SHA-256 does not match its manifest receipt.`);
    }
    if (output.kind === "settings") {
      const settings = validateResearchSettingsV1(parseStrictJson(await file.text(), { maximumBytes: 5 * 1024 * 1024 }));
      const settingsHash = await sha256Blob(new Blob([canonicalJson(settings)]));
      if (settingsHash !== manifest.settingsSha256) {
        fail("artifact-settings-hash", "Frozen settings do not match the settings hash bound by the manifest.");
      }
    } else if (output.kind === "events") {
      const records = (await file.text()).split(/\r?\n/u).filter((line) => line.length > 0);
      if (records.length !== manifest.timing.eventCount) {
        fail("artifact-event-count", "events.jsonl record count does not match the manifest.");
      }
      let gapEventCount = 0;
      let missedSlotCount = 0;
      records.forEach((line, index) => {
        const event = validateResearchEventV1(parseStrictJson(line, { maximumBytes: 256 * 1024 }));
        if (event.sequence !== index + 1 || event.runId !== manifest.runId
          || event.settingsSha256 !== manifest.settingsSha256
          || event.assignmentPlanSha256 !== manifest.assignmentPlanSha256) {
          fail("artifact-event-binding", `events.jsonl record ${index + 1} is not bound to this run in canonical order.`);
        }
        if (event.type === "timingGap") {
          gapEventCount += 1;
          missedSlotCount += event.missedSlotCount;
        }
      });
      if (gapEventCount !== manifest.timing.gapEventCount
        || missedSlotCount !== manifest.timing.missedSlotCount) {
        fail("artifact-gap-count", "events.jsonl timing-gap totals do not match the manifest.");
      }
    } else {
      const rows = parseDelimitedTable(await file.text(), output.kind === "csv" ? "," : "\t", output.fileName);
      if (rows.length - 1 !== output.rowCount) {
        fail("artifact-row-count", `${output.fileName} row count does not match its manifest receipt.`);
      }
      attestRatingRows(rows, manifest, output.fileName);
      tables.set(output.kind, rows);
    }
  }
  if (tables.has("csv") && tables.has("tsv")) {
    const csv = tables.get("csv");
    const tsv = tables.get("tsv");
    if (csv.length !== tsv.length || csv.some((row, index) => row.join("\u0000") !== tsv[index].join("\u0000"))) {
      fail("artifact-table-parity", "CSV and TSV outputs are not semantic projections of the same canonical samples.");
    }
  }
}

const MANIFEST_V3_ARTIFACT_NAMES = Object.freeze({
  settings: "settings.snapshot.json",
  experimentSource: "experiment.json",
  experimentPlan: "experiment-plan.snapshot.json",
  experimentPackage: "experiment.package.json",
  protocolPlan: "protocol-plan.snapshot.json",
  events: "events.jsonl",
  ratingsCsv: "ratings.csv",
  ratingsTsv: "ratings.tsv",
  questionnaireCsv: "questionnaire-responses.csv",
  questionnaireTsv: "questionnaire-responses.tsv",
});

function maximumArtifactBytes(kind) {
  if (kind === "settings") return MAX_SETTINGS_SNAPSHOT_BYTES;
  if (kind === "experimentSource") return MAX_EXPERIMENT_SOURCE_BYTES;
  if (kind === "experimentPlan") return MAX_EXPERIMENT_PLAN_SNAPSHOT_BYTES;
  if (kind === "experimentPackage") return MAX_EXPERIMENT_PACKAGE_BYTES;
  if (kind === "protocolPlan") return MAX_PROTOCOL_PLAN_SNAPSHOT_BYTES;
  if (kind === "events") return MAX_EVENT_LOG_BYTES;
  return MAX_TABULAR_ARTIFACT_BYTES;
}

async function readAttestedTextArtifact(sessionDirectory, output) {
  let handle;
  try {
    handle = await sessionDirectory.getFileHandle(output.fileName, { create: false });
  } catch (error) {
    if (error?.name === "NotFoundError") {
      fail("artifact-missing", `${output.fileName} is declared by the manifest but is missing.`);
    }
    throw error;
  }
  const file = await handle.getFile();
  const maximumBytes = maximumArtifactBytes(output.kind);
  if (file.size !== output.byteLength) {
    fail("artifact-size", `${output.fileName} byte length does not match its manifest receipt.`);
  }
  if (file.size < 1 || file.size > maximumBytes) {
    fail(
      "artifact-size-bound",
      `${output.fileName} must contain between 1 byte and ${maximumBytes} bytes.`,
    );
  }
  if (await sha256Blob(file) !== output.sha256) {
    fail("artifact-hash", `${output.fileName} SHA-256 does not match its manifest receipt.`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch (error) {
    fail("artifact-encoding", `${output.fileName} must be valid UTF-8 text.`, { cause: error });
  }
}

async function attestManifestV3ArtifactClosure(sessionDirectory, manifest) {
  const expected = new Set(["manifest.json"]);
  for (const output of manifest.outputs) {
    const canonicalName = MANIFEST_V3_ARTIFACT_NAMES[output.kind];
    if (output.fileName !== canonicalName) {
      fail("artifact-name", `Manifest ${output.kind} output must be ${canonicalName}.`);
    }
    if (expected.has(output.fileName)) {
      fail("artifact-name", `Manifest output file ${output.fileName} is declared more than once.`);
    }
    expected.add(output.fileName);
  }
  for await (const [name, handle] of sessionDirectory.entries()) {
    let safeName;
    try {
      safeName = assertSafeWorkspaceSegment(name, "attempt artifact name");
    } catch (error) {
      fail("artifact-extra", "The attempt directory contains an unsafe artifact name.", { cause: error });
    }
    if (handle.kind !== "file" || !expected.has(safeName)) {
      fail("artifact-extra", `The finalized attempt contains undeclared artifact ${safeName}.`);
    }
    expected.delete(safeName);
  }
  if (expected.size > 0) {
    fail("artifact-missing", `The finalized attempt is missing ${[...expected].join(", ")}.`);
  }
}

function settingsStimulusIdentity(stimulus) {
  const source = stimulus.source;
  return source.kind === "youtube"
    ? {
      kind: source.kind,
      stimulusId: stimulus.stimulusId,
      sha256: null,
      byteLength: null,
      durationMs: source.observedDurationMs,
      url: source.url,
      videoId: source.videoId,
    }
    : {
      kind: source.kind,
      stimulusId: stimulus.stimulusId,
      sha256: source.sha256,
      byteLength: source.byteLength,
      durationMs: source.durationMs,
      url: null,
      videoId: null,
    };
}

function attestManifestV3ProtocolBindings(settings, protocolPlan, manifest) {
  if (settings.experiment.id !== manifest.experimentId
    || settings.experiment.samplingFrequencyHz !== manifest.timing.sampleRateHz
    || protocolPlan.settingsSha256 !== manifest.settingsSha256
    || protocolPlan.assignmentPlanSha256 !== manifest.assignmentPlanSha256
    || protocolPlan.protocolPlanHashSha256 !== manifest.protocolPlanSha256
    || protocolPlan.participantId !== manifest.participantId
    || protocolPlan.steps.length !== manifest.protocol.protocolStepCount) {
    fail(
      "artifact-protocol-binding",
      "Frozen settings, protocol plan, participant, or manifest hashes do not describe one attempt.",
    );
  }

  const expectedKinds = new Set(["settings", "protocolPlan", "events"]);
  if (settings.version === 3) {
    expectedKinds.add("experimentSource");
    expectedKinds.add("experimentPlan");
  }
  if (settings.output.csv) {
    expectedKinds.add("ratingsCsv");
    expectedKinds.add("questionnaireCsv");
  }
  if (settings.output.tsv) {
    expectedKinds.add("ratingsTsv");
    expectedKinds.add("questionnaireTsv");
  }
  const observedKinds = new Set(manifest.outputs.map(({ kind }) => kind));
  if (manifest.version === 4 || observedKinds.has("experimentPackage")) {
    expectedKinds.add("experimentPackage");
  }
  if (expectedKinds.size !== observedKinds.size
    || [...expectedKinds].some((kind) => !observedKinds.has(kind))) {
    fail(
      "artifact-output-selection",
      "Manifest outputs do not exactly match the frozen CSV and TSV selections.",
    );
  }

  const expectedDefinitions = settings.questionnaires.definitions.map((definition) => ({
    questionnaireId: definition.questionnaireId,
    definitionSha256: definition.definitionSha256,
  }));
  if (canonicalJson(expectedDefinitions)
    !== canonicalJson(manifest.protocol.questionnaireDefinitions)) {
    fail(
      "artifact-questionnaire-binding",
      "Manifest questionnaire definitions do not match the frozen settings.",
    );
  }

  const questionnaireSteps = protocolPlan.steps.filter(({ kind }) => kind === "questionnaire");
  if (questionnaireSteps.length !== manifest.protocol.questionnaireModules.length) {
    fail(
      "artifact-questionnaire-binding",
      "Manifest questionnaire modules do not match the resolved protocol.",
    );
  }
  questionnaireSteps.forEach((step, index) => {
    const receipt = manifest.protocol.questionnaireModules[index];
    if (receipt.protocolStepPosition !== step.protocolPosition
      || receipt.moduleId !== step.moduleId
      || receipt.questionnaireId !== step.questionnaireId
      || receipt.definitionSha256 !== step.definitionSha256) {
      fail(
        "artifact-questionnaire-binding",
        `Manifest questionnaire module ${index + 1} does not match its protocol step.`,
      );
    }
    if (step.protocolPosition <= manifest.protocol.safeProtocolStepPosition) {
      if (receipt.status !== "submitted") {
        fail(
          "artifact-questionnaire-status",
          `Questionnaire ${step.moduleId} precedes the safe boundary but is not submitted.`,
        );
      }
    } else if (receipt.status === "submitted") {
      fail(
        "artifact-questionnaire-status",
        `Questionnaire ${step.moduleId} is submitted beyond the safe boundary.`,
      );
    }
    if (receipt.status === "draft"
      && step.protocolPosition !== manifest.protocol.safeProtocolStepPosition + 1) {
      fail(
        "artifact-questionnaire-status",
        `Questionnaire ${step.moduleId} draft is not the active safe-boundary step.`,
      );
    }
  });

  const stimulusSteps = protocolPlan.steps.filter(({ kind }) => kind === "stimulus");
  if (stimulusSteps.length !== manifest.stimuli.length) {
    fail("artifact-stimulus-binding", "Manifest stimuli do not match the resolved protocol.");
  }
  const settingsByStimulus = new Map(settings.stimuli.items.map((stimulus) => [
    stimulus.stimulusId,
    settingsStimulusIdentity(stimulus),
  ]));
  stimulusSteps.forEach((step, index) => {
    const identity = manifest.stimuli[index];
    const settingsIdentity = settingsByStimulus.get(step.stimulusId);
    if (step.stimulusPosition !== index + 1
      || identity.stimulusId !== step.stimulusId
      || !settingsIdentity
      || canonicalJson(identity) !== canonicalJson(settingsIdentity)) {
      fail(
        "artifact-stimulus-binding",
        `Manifest stimulus ${index + 1} does not match its frozen protocol and settings identity.`,
      );
    }
  });
}

function attestManifestV3RatingTable(text, output, manifest) {
  const format = output.kind === "ratingsCsv" ? "csv" : "tsv";
  const rows = parseDelimitedTable(text, format === "csv" ? "," : "\t", output.fileName, {
    maximumRows: MAX_ATTESTED_TABLE_ROWS,
  });
  if (rows.length - 1 !== output.rowCount) {
    fail("artifact-row-count", `${output.fileName} row count does not match its manifest receipt.`);
  }
  const records = rows.slice(1).map((row, index) => (
    ratingRecordFromRow(row, `${output.fileName} row ${index + 1}`)
  ));
  let canonical;
  try {
    canonical = serializeRatings(records, { format });
  } catch (error) {
    fail(
      "artifact-sample-record",
      `${output.fileName} is not a canonical ordered ResearchSampleV1 table.`,
      { cause: error },
    );
  }
  if (canonical !== text) {
    fail(
      "artifact-table-canonical",
      `${output.fileName} is not the exact canonical ${format.toUpperCase()} projection.`,
    );
  }
  records.forEach((record, index) => {
    const stimulus = manifest.stimuli[record.stimulusPosition - 1];
    if (record.sequence !== index + 1
      || record.runId !== manifest.runId
      || record.participantId !== manifest.participantId
      || record.attemptNumber !== manifest.attemptNumber
      || record.settingsSha256 !== manifest.settingsSha256
      || record.assignmentPlanSha256 !== manifest.assignmentPlanSha256
      || record.sampleRateHz !== manifest.timing.sampleRateHz
      || !stimulus
      || canonicalJson(record.stimulusIdentity) !== canonicalJson(stimulus)) {
      fail(
        "artifact-sample-binding",
        `${output.fileName} row ${index + 1} is not bound to this run and exact stimulus identity.`,
      );
    }
  });
  return { records, rows };
}

function attestManifestV3EventLog(text, manifest, protocolPlan) {
  const expectedTextForEmptyLog = "\n";
  const lines = text.split("\n");
  if (lines.at(-1) !== "") {
    fail("artifact-event-canonical", "events.jsonl must end with one canonical LF record boundary.");
  }
  lines.pop();
  if (lines.length === 1 && lines[0] === "" && text === expectedTextForEmptyLog) lines.pop();
  if (lines.length > MAX_ATTESTED_EVENT_RECORDS) {
    fail(
      "artifact-event-count",
      `events.jsonl exceeds the supported ${MAX_ATTESTED_EVENT_RECORDS} records.`,
    );
  }
  if (lines.some((line) => line.length < 1 || line.includes("\r"))) {
    fail("artifact-event-canonical", "events.jsonl contains a blank or non-LF record boundary.");
  }
  if (lines.length !== manifest.timing.eventCount) {
    fail("artifact-event-count", "events.jsonl record count does not match the manifest.");
  }

  const events = lines.map((line, index) => {
    let event;
    try {
      event = validateResearchEventV2(parseStrictJson(line, { maximumBytes: 256 * 1024 }));
    } catch (error) {
      fail(
        "artifact-event-record",
        `events.jsonl record ${index + 1} is not a strict ResearchEventV2 record.`,
        { cause: error },
      );
    }
    if (line !== canonicalJson(event)) {
      fail(
        "artifact-event-canonical",
        `events.jsonl record ${index + 1} is not canonical JSON.`,
      );
    }
    if (event.sequence !== index + 1
      || event.runId !== manifest.runId
      || event.participantId !== manifest.participantId
      || event.attemptNumber !== manifest.attemptNumber
      || event.settingsSha256 !== manifest.settingsSha256
      || event.assignmentPlanSha256 !== manifest.assignmentPlanSha256
      || event.protocolPlanSha256 !== manifest.protocolPlanSha256) {
      fail(
        "artifact-event-binding",
        `events.jsonl record ${index + 1} is not bound to this protocol attempt.`,
      );
    }
    if (event.protocolStepPosition !== null) {
      const step = protocolPlan.steps[event.protocolStepPosition - 1];
      if (!step) {
        fail(
          "artifact-event-binding",
          `events.jsonl record ${index + 1} references an unknown protocol step.`,
        );
      }
      if (event.type.startsWith("questionnaire")
        && (step.kind !== "questionnaire"
          || event.moduleId !== step.moduleId
          || event.questionnaireId !== step.questionnaireId
          || event.definitionSha256 !== step.definitionSha256)) {
        fail(
          "artifact-event-binding",
          `events.jsonl questionnaire record ${index + 1} does not match its frozen step.`,
        );
      }
    }
    if (event.stimulusIdentity !== null) {
      const stimulus = manifest.stimuli[event.stimulusPosition - 1];
      const step = protocolPlan.steps.find(({ kind, stimulusPosition }) => (
        kind === "stimulus" && stimulusPosition === event.stimulusPosition
      ));
      if (!stimulus || !step || step.stimulusId !== stimulus.stimulusId
        || canonicalJson(event.stimulusIdentity) !== canonicalJson(stimulus)
        || event.protocolStepPosition !== step.protocolPosition) {
        fail(
          "artifact-event-binding",
          `events.jsonl stimulus record ${index + 1} does not match its frozen protocol step.`,
        );
      }
    }
    return event;
  });

  const gapEvents = events.filter(({ type }) => type === "timingGap");
  const missedSlotCount = gapEvents.reduce((sum, event) => sum + event.missedSlotCount, 0);
  if (gapEvents.length !== manifest.timing.gapEventCount
    || missedSlotCount !== manifest.timing.missedSlotCount) {
    fail("artifact-gap-count", "events.jsonl timing-gap totals do not match the manifest.");
  }
  const completedQuestionnaireSteps = events
    .filter(({ type }) => type === "questionnaireCompleted")
    .map(({ protocolStepPosition }) => protocolStepPosition);
  if (new Set(completedQuestionnaireSteps).size !== completedQuestionnaireSteps.length) {
    fail("artifact-questionnaire-status", "A questionnaire step has multiple completion events.");
  }
  const submittedSteps = manifest.protocol.questionnaireModules
    .filter(({ status }) => status === "submitted")
    .map(({ protocolStepPosition }) => protocolStepPosition);
  if (canonicalJson(completedQuestionnaireSteps) !== canonicalJson(submittedSteps)) {
    fail(
      "artifact-questionnaire-status",
      "Questionnaire completion events do not match submitted module receipts.",
    );
  }
  return events;
}

function attestQuestionnaireRecord(record, manifest, protocolPlan, settings, label) {
  if (record.runId !== manifest.runId
    || record.participantId !== manifest.participantId
    || record.attemptNumber !== manifest.attemptNumber
    || record.settingsSha256 !== manifest.settingsSha256
    || record.assignmentPlanSha256 !== manifest.assignmentPlanSha256
    || record.protocolPlanSha256 !== manifest.protocolPlanSha256) {
    fail("artifact-questionnaire-binding", `${label} is not bound to this protocol attempt.`);
  }
  const step = protocolPlan.steps[record.protocolStepPosition - 1];
  const receipt = manifest.protocol.questionnaireModules.find(({ protocolStepPosition }) => (
    protocolStepPosition === record.protocolStepPosition
  ));
  const definition = settings.questionnaires.definitions.find(({ questionnaireId }) => (
    questionnaireId === record.questionnaireId
  ));
  const item = definition?.items.find(({ itemId }) => itemId === record.itemId);
  const option = item?.options.find(({ optionId }) => optionId === record.optionId);
  if (!step || step.kind !== "questionnaire" || !receipt || !definition || !item || !option
    || record.moduleId !== step.moduleId
    || record.questionnaireId !== step.questionnaireId
    || record.definitionSha256 !== step.definitionSha256
    || record.questionnaireVersion !== definition.questionnaireVersion
    || record.definitionSha256 !== definition.definitionSha256
    || record.itemOrder !== item.order
    || record.optionOrder !== option.order
    || record.responseLabel !== option.label
    || record.scoreValue !== option.scoreValue
    || record.subscale !== item.subscale
    || record.status !== receipt.status) {
    fail(
      "artifact-questionnaire-binding",
      `${label} does not match its frozen module, item, option, score, or status.`,
    );
  }
}

function attestManifestV3QuestionnaireTable(text, output, manifest, protocolPlan, settings) {
  const format = output.kind === "questionnaireCsv" ? "csv" : "tsv";
  const rows = parseDelimitedTable(text, format === "csv" ? "," : "\t", output.fileName, {
    columns: QUESTIONNAIRE_RESPONSE_COLUMNS,
    maximumRows: MAX_ATTESTED_TABLE_ROWS,
  });
  if (rows.length - 1 !== output.rowCount) {
    fail("artifact-row-count", `${output.fileName} row count does not match its manifest receipt.`);
  }
  const records = rows.slice(1).map((row, index) => (
    questionnaireRecordFromRow(row, `${output.fileName} row ${index + 1}`)
  ));
  let canonical;
  try {
    canonical = serializeQuestionnaireResponses(records, { format });
  } catch (error) {
    fail(
      "artifact-questionnaire-record",
      `${output.fileName} is not a canonical ordered QuestionnaireResponseV1 table.`,
      { cause: error },
    );
  }
  if (canonical !== text) {
    fail(
      "artifact-table-canonical",
      `${output.fileName} is not the exact canonical ${format.toUpperCase()} projection.`,
    );
  }
  const seenItems = new Set();
  records.forEach((record, index) => {
    attestQuestionnaireRecord(
      record,
      manifest,
      protocolPlan,
      settings,
      `${output.fileName} row ${index + 1}`,
    );
    const key = `${record.protocolStepPosition}\u0000${record.itemId}`;
    if (seenItems.has(key)) {
      fail(
        "artifact-questionnaire-binding",
        `${output.fileName} repeats item ${record.itemId} for one questionnaire step.`,
      );
    }
    seenItems.add(key);
  });

  for (const receipt of manifest.protocol.questionnaireModules) {
    const moduleRows = records.filter(({ protocolStepPosition }) => (
      protocolStepPosition === receipt.protocolStepPosition
    ));
    if (moduleRows.length !== receipt.responseCount) {
      fail(
        "artifact-questionnaire-count",
        `Questionnaire ${receipt.moduleId} row count does not match its manifest receipt.`,
      );
    }
    if (receipt.status === "submitted") {
      const definition = settings.questionnaires.definitions.find(({ questionnaireId }) => (
        questionnaireId === receipt.questionnaireId
      ));
      const answered = new Set(moduleRows.map(({ itemId }) => itemId));
      if (definition.items.some((item) => item.required && !answered.has(item.itemId))) {
        fail(
          "artifact-questionnaire-count",
          `Submitted questionnaire ${receipt.moduleId} omits a required item.`,
        );
      }
    }
  }
  return { records, rows };
}

function sameTableRows(left, right) {
  return left.length === right.length
    && left.every((row, index) => (
      row.length === right[index].length
      && row.every((cell, cellIndex) => cell === right[index][cellIndex])
    ));
}

async function attestManifestV3Artifacts(sessionDirectory, manifest) {
  await attestManifestV3ArtifactClosure(sessionDirectory, manifest);
  const outputs = new Map(manifest.outputs.map((output) => [output.kind, output]));
  const texts = new Map();
  for (const output of manifest.outputs) {
    texts.set(output.kind, await readAttestedTextArtifact(sessionDirectory, output));
  }

  let settings;
  try {
    const parsedSettings = parseStrictJson(texts.get("settings"), {
      maximumBytes: MAX_SETTINGS_SNAPSHOT_BYTES,
    });
    settings = parsedSettings?.version === 3
      ? await validateResearchSettingsV3(parsedSettings)
      : await validateResearchSettingsV2(parsedSettings);
  } catch (error) {
    fail(
      "artifact-settings-record",
      "Frozen settings are not a strict questionnaire-aware Research settings snapshot.",
      { cause: error },
    );
  }
  if (texts.get("settings") !== `${canonicalJson(settings)}\n`) {
    fail("artifact-settings-canonical", "Frozen settings are not canonical JSON followed by one LF.");
  }
  if (await canonicalSha256(settings) !== manifest.settingsSha256) {
    fail("artifact-settings-hash", "Frozen settings do not match the settings hash bound by the manifest.");
  }

  let experimentPlan = null;
  if (settings.version === 3) {
    if (!outputs.has("experimentSource") || !outputs.has("experimentPlan")) {
      fail(
        "artifact-output-selection",
        "External-order attempts require exact experiment.json and resolved experiment-plan snapshots.",
      );
    }
    let parsedExperiment;
    try {
      parsedExperiment = await parseExperimentDefinitionV1(
        new TextEncoder().encode(texts.get("experimentSource")),
      );
    } catch (error) {
      fail(
        "artifact-experiment-source",
        "Frozen experiment.json is not the exact strict external protocol source.",
        { cause: error },
      );
    }
    if (parsedExperiment.sourceByteSha256 !== settings.externalProtocol.sourceByteSha256
      || parsedExperiment.definitionSha256 !== settings.externalProtocol.definitionSha256
      || canonicalJson(parsedExperiment.definition)
        !== canonicalJson(settings.externalProtocol.definition)) {
      fail(
        "artifact-experiment-binding",
        "Frozen experiment.json bytes do not bind the frozen external settings.",
      );
    }
    try {
      experimentPlan = await validateResolvedExperimentPlanV1(parseStrictJson(
        texts.get("experimentPlan"),
        { maximumBytes: MAX_EXPERIMENT_PLAN_SNAPSHOT_BYTES },
      ));
    } catch (error) {
      fail(
        "artifact-experiment-plan",
        "Frozen resolved experiment plan is not a strict ResolvedExperimentPlanV1 snapshot.",
        { cause: error },
      );
    }
    if (texts.get("experimentPlan") !== `${canonicalJson(experimentPlan)}\n`
      || experimentPlan.planHashSha256 !== manifest.assignmentPlanSha256
      || experimentPlan.settingsSha256 !== manifest.settingsSha256
      || experimentPlan.sourceByteSha256 !== parsedExperiment.sourceByteSha256
      || experimentPlan.definitionSha256 !== parsedExperiment.definitionSha256) {
      fail(
        "artifact-experiment-plan-binding",
        "Frozen resolved experiment plan does not bind the manifest, settings, and source bytes.",
      );
    }
  }

  let protocolPlan;
  try {
    const parsedProtocolPlan = parseStrictJson(texts.get("protocolPlan"), {
      maximumBytes: MAX_PROTOCOL_PLAN_SNAPSHOT_BYTES,
    });
    protocolPlan = parsedProtocolPlan?.version === 2
      ? await validateResolvedProtocolPlanV2(parsedProtocolPlan, settings.version === 3
        ? { settingsV3: settings, resolvedExperimentPlanV1: experimentPlan }
        : undefined)
      : await validateResolvedProtocolPlanV1(parsedProtocolPlan);
  } catch (error) {
    fail(
      "artifact-protocol-record",
      "Frozen protocol plan is not a strict supported protocol-plan snapshot.",
      { cause: error },
    );
  }
  if (texts.get("protocolPlan") !== `${canonicalJson(protocolPlan)}\n`) {
    fail(
      "artifact-protocol-canonical",
      "Frozen protocol plan is not canonical JSON followed by one LF.",
    );
  }
  attestManifestV3ProtocolBindings(settings, protocolPlan, manifest);

  if (outputs.has("experimentPackage")) {
    let parsedPackage;
    try {
      parsedPackage = await parseExperimentPackageV1(
        new TextEncoder().encode(texts.get("experimentPackage")),
      );
    } catch (error) {
      fail(
        "artifact-experiment-package",
        "Frozen experiment.package.json is not a strict portable package.",
        { cause: error },
      );
    }
    if (parsedPackage.sourceText !== parsedPackage.canonicalSourceText
      || parsedPackage.sourceByteSha256 !== parsedPackage.canonicalSourceByteSha256) {
      fail(
        "artifact-experiment-package-canonical",
        "Frozen experiment.package.json is not canonical JSON followed by one LF.",
      );
    }
    if (manifest.version === 4) {
      const receipt = manifest.experimentPackage;
      let compiled;
      try {
        compiled = await compileExperimentPackageSelectionV1(parsedPackage.package, {
          languageId: receipt.languageId,
          languageSelectionPath: receipt.languageSelectionPath,
          participantId: manifest.participantId,
        });
        await validateExperimentPackageRunBindingV1({
          schema: "affect-research-experiment-package-run-binding",
          version: 1,
          sourceText: texts.get("experimentPackage"),
          sourceByteSha256: receipt.canonicalSourceByteSha256,
          packageDefinitionSha256: receipt.packageDefinitionSha256,
          packageId: receipt.packageId,
          languageId: receipt.languageId,
          languageSelectionPath: receipt.languageSelectionPath,
          assignmentSha256: receipt.assignmentSha256,
          assetBindings: compiled.assetBindings,
        }, {
          settings,
          experimentPlan,
          protocolPlan,
          participantId: manifest.participantId,
        });
      } catch (error) {
        fail(
          "artifact-experiment-package-binding",
          "Frozen experiment.package.json does not reproduce the exact V4 package run binding.",
          { cause: error },
        );
      }
      if (compiled.assignmentSha256 !== receipt.assignmentSha256
        || await canonicalSha256(compiled.assetBindings) !== receipt.assetBindingsSha256) {
        fail(
          "artifact-experiment-package-binding",
          "Frozen experiment.package.json assignment or asset bindings do not match the V4 manifest hashes.",
        );
      }
    } else {
      let matchedSelection = false;
      for (const route of enumerateLanguageRoutesV1(parsedPackage.package.languageSelection)) {
        try {
          const compiled = await compileExperimentPackageSelectionV1(parsedPackage.package, {
            languageId: route.languageId,
            languageSelectionPath: route.optionIds,
            participantId: manifest.participantId,
          });
          if (canonicalJson(compiled.settings) === canonicalJson(settings)
            && canonicalJson(compiled.experimentPlan) === canonicalJson(experimentPlan)
            && canonicalJson(compiled.protocolPlan) === canonicalJson(protocolPlan)) {
            matchedSelection = true;
            break;
          }
        } catch {
          // A historical V3 route that does not resolve this participant cannot bind the attempt.
        }
      }
      if (!matchedSelection) {
        fail(
          "artifact-experiment-package-binding",
          "Frozen experiment.package.json cannot reproduce this participant's settings and protocol plans.",
        );
      }
    }
  }

  const ratingTables = new Map();
  for (const kind of ["ratingsCsv", "ratingsTsv"]) {
    if (!outputs.has(kind)) continue;
    ratingTables.set(
      kind,
      attestManifestV3RatingTable(texts.get(kind), outputs.get(kind), manifest),
    );
  }
  if (ratingTables.has("ratingsCsv") && ratingTables.has("ratingsTsv")
    && !sameTableRows(ratingTables.get("ratingsCsv").rows, ratingTables.get("ratingsTsv").rows)) {
    fail(
      "artifact-table-parity",
      "Ratings CSV and TSV are not semantic projections of the same canonical samples.",
    );
  }
  const canonicalRatings = ratingTables.values().next().value?.records ?? [];
  if (canonicalRatings.length !== manifest.timing.sampleCount) {
    fail("artifact-row-count", "Canonical rating row count does not match the manifest timing summary.");
  }

  const questionnaireTables = new Map();
  for (const kind of ["questionnaireCsv", "questionnaireTsv"]) {
    if (!outputs.has(kind)) continue;
    questionnaireTables.set(
      kind,
      attestManifestV3QuestionnaireTable(
        texts.get(kind),
        outputs.get(kind),
        manifest,
        protocolPlan,
        settings,
      ),
    );
  }
  if (questionnaireTables.has("questionnaireCsv")
    && questionnaireTables.has("questionnaireTsv")
    && !sameTableRows(
      questionnaireTables.get("questionnaireCsv").rows,
      questionnaireTables.get("questionnaireTsv").rows,
    )) {
    fail(
      "artifact-table-parity",
      "Questionnaire CSV and TSV are not semantic projections of the same canonical responses.",
    );
  }
  const questionnaireResponses = questionnaireTables.values().next().value?.records ?? [];
  const submitted = questionnaireResponses.filter(({ status }) => status === "submitted");
  const drafts = questionnaireResponses.filter(({ status }) => status === "draft");
  if (submitted.length !== manifest.protocol.submittedResponseCount
    || drafts.length !== manifest.protocol.draftResponseCount
    || await canonicalSha256(submitted) !== manifest.protocol.submittedResponsesSha256
    || await canonicalSha256(drafts) !== manifest.protocol.draftResponsesSha256) {
    fail(
      "artifact-questionnaire-hash",
      "Canonical questionnaire response counts or status-specific hashes do not match the manifest.",
    );
  }

  attestManifestV3EventLog(texts.get("events"), manifest, protocolPlan);
}

export class BrowserResearchWorkspace {
  constructor(rootHandle, { cryptoObject = globalThis.crypto } = {}) {
    if (!rootHandle || rootHandle.kind !== "directory") {
      fail("invalid-root", "Research workspace requires a directory handle.");
    }
    this.rootHandle = rootHandle;
    this.cryptoObject = cryptoObject;
    this.directories = new Map();
    this.packageStimuliDirectory = null;
    this.questionnaireAssetsDirectory = null;
    this.workspaceId = null;
  }

  static async choose({
    windowObject = globalThis.window,
    pickerOptions = { id: "affect-research-workspace", mode: "readwrite" },
  } = {}) {
    if (!windowObject?.isSecureContext) {
      fail("secure-context-required", "Workspace selection requires a secure browser context.");
    }
    if (typeof windowObject.showDirectoryPicker !== "function") {
      fail("unsupported-browser", "This browser does not provide the File System Access directory picker.");
    }
    const handle = await windowObject.showDirectoryPicker(pickerOptions);
    const workspace = new BrowserResearchWorkspace(handle);
    await workspace.initialize({ requestPermission: true });
    return workspace;
  }

  async initialize({ requestPermission = false } = {}) {
    await ensurePermission(this.rootHandle, "readwrite", { request: requestPermission });
    for (const name of RESEARCH_WORKSPACE_DIRECTORIES) {
      this.directories.set(name, await getChildDirectory(this.rootHandle, name, { create: true }));
    }
    const assets = await getChildDirectory(this.rootHandle, "assets", { create: true });
    this.packageStimuliDirectory = await getChildDirectory(assets, "stimuli", { create: true });
    this.questionnaireAssetsDirectory = await getChildDirectory(assets, "questionnaires", { create: true });
    this.workspaceId = await this.#loadOrCreateWorkspaceIdentity();
    return this;
  }

  async renewPermission() {
    return ensurePermission(this.rootHandle, "readwrite", { request: true });
  }

  async rescanVideos() {
    await ensurePermission(this.rootHandle, "read", { request: false });
    const stimuli = this.#directory("stimuli");
    const videos = [];
    for await (const video of walkVideos(stimuli)) videos.push(video);
    videos.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
    return Object.freeze(videos);
  }

  async rescanPackageVideos() {
    await ensurePermission(this.rootHandle, "read", { request: false });
    if (!this.packageStimuliDirectory) {
      fail("package-assets-unavailable", "The fixed assets/stimuli package folder is unavailable.");
    }
    const videos = [];
    for await (const video of walkVideos(this.packageStimuliDirectory)) videos.push(video);
    videos.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
    return Object.freeze(videos);
  }

  async loadExperimentPackage() {
    await ensurePermission(this.rootHandle, "read", { request: false });
    let handle;
    try {
      handle = await this.rootHandle.getFileHandle(EXPERIMENT_PACKAGE_FILE_NAME, { create: false });
    } catch (error) {
      if (error?.name === "NotFoundError") {
        fail(
          "package-root-missing",
          `The selected package root does not contain ${EXPERIMENT_PACKAGE_FILE_NAME}.`,
          { cause: error },
        );
      }
      throw error;
    }
    let file;
    try {
      file = await handle.getFile();
    } catch (error) {
      fail("package-root-unverifiable", `${EXPERIMENT_PACKAGE_FILE_NAME} could not be read.`, { cause: error });
    }
    if (!(file instanceof Blob) || file.size < 1 || file.size > MAX_EXPERIMENT_PACKAGE_BYTES) {
      fail(
        "package-root-size",
        `${EXPERIMENT_PACKAGE_FILE_NAME} must contain 1–${MAX_EXPERIMENT_PACKAGE_BYTES} canonical UTF-8 bytes.`,
      );
    }
    try {
      return await parseExperimentPackageV1(await file.arrayBuffer());
    } catch (error) {
      fail(
        error?.code ?? "package-root-invalid",
        `The selected root ${EXPERIMENT_PACKAGE_FILE_NAME} is not a canonical ExperimentPackageV1.`,
        { cause: error },
      );
    }
  }

  async saveExperimentPackage(sourceText) {
    await ensurePermission(this.rootHandle, "readwrite", { request: false });
    if (typeof sourceText !== "string") {
      fail("package-root-invalid", `${EXPERIMENT_PACKAGE_FILE_NAME} must be canonical UTF-8 text.`);
    }
    let expected;
    try {
      expected = await parseExperimentPackageV1(new TextEncoder().encode(sourceText));
    } catch (error) {
      fail(
        "package-root-invalid",
        `Only canonical ExperimentPackageV1 bytes can be written as ${EXPERIMENT_PACKAGE_FILE_NAME}.`,
        { cause: error },
      );
    }
    await replaceFile(this.rootHandle, EXPERIMENT_PACKAGE_FILE_NAME, sourceText);
    const observed = await this.loadExperimentPackage();
    if (observed.sourceText !== expected.sourceText
      || observed.sourceByteSha256 !== expected.sourceByteSha256) {
      fail("package-root-write", `${EXPERIMENT_PACKAGE_FILE_NAME} changed while it was written.`);
    }
    return observed;
  }

  async verifyExperimentPackageAssetClosure(packageInput) {
    await ensurePermission(this.rootHandle, "read", { request: false });
    if (!this.packageStimuliDirectory) {
      fail("package-assets-unavailable", "The fixed assets/stimuli package folder is unavailable.");
    }
    const packageValue = await validateExperimentPackageV1(packageInput?.package ?? packageInput);
    const expectedByPath = new Map(packageValue.assets.stimuli.map((asset) => [asset.relativePath, asset]));
    const observedByPath = new Map();
    for await (const entry of walkPackageFiles(this.packageStimuliDirectory)) {
      const packagePath = `${RESEARCH_PACKAGE_ASSET_DIRECTORY}/${entry.relativePath}`;
      const expected = expectedByPath.get(packagePath);
      if (!expected) {
        fail("package-asset-extra", `Undeclared package asset ${packagePath} must be removed before Start.`);
      }
      let observedSha256;
      try {
        observedSha256 = await sha256Blob(entry.file, this.cryptoObject);
      } catch (error) {
        fail("package-asset-unverifiable", `Package asset ${packagePath} could not be hashed.`, { cause: error });
      }
      if (entry.byteLength !== expected.byteLength || observedSha256 !== expected.sha256) {
        fail("package-asset-mismatch", `Package asset ${packagePath} does not match its declared bytes.`);
      }
      observedByPath.set(packagePath, Object.freeze({
        sourceKind: "workspace-file",
        relativePath: entry.relativePath,
        packagePath,
        stimulusId: expected.stimulusId,
        name: entry.name,
        byteLength: entry.byteLength,
        lastModified: entry.lastModified,
        mediaType: entry.mediaType,
        sha256: observedSha256,
        durationMs: expected.durationMs,
        fileHandle: entry.fileHandle,
      }));
    }
    const missing = packageValue.assets.stimuli
      .filter(({ relativePath }) => !observedByPath.has(relativePath))
      .map(({ relativePath }) => relativePath);
    if (missing.length > 0) {
      fail("package-asset-missing", `Missing declared package asset${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
    }
    const assets = packageValue.assets.stimuli.map(({ relativePath }) => observedByPath.get(relativePath));
    const assetBindings = packageValue.assets.stimuli.map((asset) => Object.freeze({
      stimulusId: asset.stimulusId,
      logicalPath: asset.relativePath.slice("assets/".length),
      packagePath: asset.relativePath,
      sha256: asset.sha256,
      byteLength: asset.byteLength,
      durationMs: asset.durationMs,
    }));
    return Object.freeze({
      assetManifestSha256: packageValue.integrity.assetManifestSha256,
      assetBindings: Object.freeze(assetBindings),
      assets: Object.freeze(assets),
    });
  }

  async attestExperimentPackageRoot(expectedSourceText = null) {
    const packageDocument = await this.loadExperimentPackage();
    if (expectedSourceText !== null && packageDocument.sourceText !== expectedSourceText) {
      fail(
        "package-root-mismatch",
        `The selected root ${EXPERIMENT_PACKAGE_FILE_NAME} is not the package currently shown in Setup.`,
      );
    }
    const closure = await this.verifyExperimentPackageAssetClosure(packageDocument.package);
    return Object.freeze({ packageDocument, ...closure });
  }

  async openStimulusFile(relativePath) {
    await ensurePermission(this.rootHandle, "read", { request: false });
    const normalized = normalizeWorkspaceRelativePath(relativePath, "stimulus path");
    const parts = normalized.split("/");
    if (parts[0] === "stimuli") parts.shift();
    const fileName = parts.pop();
    if (!fileName || !isSupportedVideoName(fileName)) {
      fail("unsupported-video", "The selected workspace stimulus is not a supported complete-video file.");
    }
    const directory = await getNestedDirectory(this.#directory("stimuli"), parts, { create: false });
    const handle = await directory.getFileHandle(fileName, { create: false });
    return handle.getFile();
  }

  async openPackageStimulusFile(relativePath) {
    await ensurePermission(this.rootHandle, "read", { request: false });
    const normalized = normalizeWorkspaceRelativePath(relativePath, "package stimulus path");
    const parts = normalized.split("/");
    if (parts[0] !== "assets" || parts[1] !== "stimuli") {
      fail("unsafe-package-path", "Package stimuli must be beneath assets/stimuli/.");
    }
    parts.splice(0, 2);
    const fileName = parts.pop();
    if (!fileName || !isSupportedVideoName(fileName)) {
      fail("unsupported-video", "The package stimulus is not a supported complete-video file.");
    }
    if (!this.packageStimuliDirectory) {
      fail("package-assets-unavailable", "The fixed assets/stimuli package folder is unavailable.");
    }
    const directory = await getNestedDirectory(this.packageStimuliDirectory, parts, { create: false });
    const handle = await directory.getFileHandle(fileName, { create: false });
    return handle.getFile();
  }

  async listRunManifests(experimentId) {
    await ensurePermission(this.rootHandle, "read", { request: false });
    const safeExperimentId = assertSafeWorkspaceSegment(experimentId, "experiment ID");
    let experimentDirectory;
    try {
      experimentDirectory = await getChildDirectory(this.#directory("outputs"), safeExperimentId, { create: false });
    } catch (error) {
      if (error?.name === "NotFoundError") {
        return Object.freeze({ manifests: Object.freeze([]), issues: Object.freeze([]) });
      }
      throw error;
    }

    const manifests = [];
    const issues = [];
    for await (const [participantDirectoryName, participantDirectory] of experimentDirectory.entries()) {
      if (participantDirectory.kind !== "directory") continue;
      let safeParticipantDirectory;
      try {
        safeParticipantDirectory = assertSafeWorkspaceSegment(participantDirectoryName, "participant output directory");
      } catch (error) {
        issues.push(Object.freeze({ code: "invalid-participant-directory", message: error.message }));
        continue;
      }
      for await (const [sessionDirectoryName, sessionDirectory] of participantDirectory.entries()) {
        if (sessionDirectory.kind !== "directory") continue;
        let manifestHandle;
        let manifestFound = false;
        try {
          assertSafeWorkspaceSegment(sessionDirectoryName, "session output directory");
          manifestHandle = await sessionDirectory.getFileHandle("manifest.json", { create: false });
          manifestFound = true;
          const manifestValue = await readBoundedJsonFile(
            manifestHandle,
            `${safeParticipantDirectory}/${sessionDirectoryName}/manifest.json`,
          );
          const manifest = manifestValue?.version === 4
            ? validateResearchRunManifestV4(manifestValue)
            : manifestValue?.version === 3
              ? validateResearchRunManifestV3(manifestValue)
              : validateResearchRunManifestV2(manifestValue);
          if (manifest.experimentId !== safeExperimentId
            || manifest.participantId !== safeParticipantDirectory
            || manifest.sessionStem !== sessionDirectoryName) {
            throw new TypeError("Manifest identity does not match its curated output directory.");
          }
          if (manifest.version === 3 || manifest.version === 4) {
            await attestManifestV3Artifacts(sessionDirectory, manifest);
          } else {
            await attestManifestArtifacts(sessionDirectory, manifest);
          }
          manifests.push(manifest);
        } catch (error) {
          if (error?.name === "NotFoundError" && !manifestFound) continue;
          issues.push(Object.freeze({
            code: error?.name === "NotFoundError"
              ? "artifact-missing"
              : error?.code ?? "invalid-manifest",
            participantId: safeParticipantDirectory,
            sessionStem: sessionDirectoryName,
            message: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    }
    manifests.sort((left, right) => left.timing.startedAt.localeCompare(right.timing.startedAt));
    return Object.freeze({
      manifests: Object.freeze(manifests),
      issues: Object.freeze(issues),
    });
  }

  async importVideoFiles(files) {
    await ensurePermission(this.rootHandle, "readwrite", { request: false });
    if (!this.packageStimuliDirectory) {
      fail("package-assets-unavailable", "The fixed assets/stimuli package folder is unavailable.");
    }
    const imported = [];
    for (const file of Array.from(files ?? [])) {
      if (!(file instanceof Blob) || !isSupportedVideoName(file.name)) {
        fail("unsupported-video", "Every imported item must be a supported complete-video file.");
      }
      const suggested = file.webkitRelativePath || file.name;
      const relativePath = normalizeWorkspaceRelativePath(suggested, "import path");
      const parts = relativePath.split("/");
      const fileName = parts.pop();
      const directory = await getNestedDirectory(this.packageStimuliDirectory, parts, { create: true });
      await writeNewFile(directory, fileName, file);
      imported.push(relativePath);
    }
    return Object.freeze(imported);
  }

  async saveQuestionnaireAsset({
    familyId,
    languageTag,
    format,
    sourceSha256,
    bytes: source,
  } = {}) {
    const safeFamilyId = canonicalQuestionnaireAssetIdentifier(familyId, "Questionnaire family ID");
    const safeLanguageTag = canonicalQuestionnaireAssetIdentifier(languageTag, "Questionnaire language tag");
    if (!QUESTIONNAIRE_ASSET_FORMATS.has(format)) {
      fail("questionnaire-asset-format", "Questionnaire source format must be csv, txt, or json.");
    }
    if (typeof sourceSha256 !== "string" || !SHA256_PATTERN.test(sourceSha256)) {
      fail("questionnaire-asset-hash", "Questionnaire source SHA-256 must be a lowercase digest.");
    }
    const bytes = questionnaireSourceBytes(source);
    await ensurePermission(this.rootHandle, "readwrite", { request: false });
    if (!this.workspaceId || !this.questionnaireAssetsDirectory) {
      fail("not-initialized", "Initialize the workspace before storing questionnaire assets.");
    }
    const sourceBlob = new Blob([bytes]);
    const observedSha256 = await sha256Blob(sourceBlob, this.cryptoObject);
    if (observedSha256 !== sourceSha256) {
      fail("questionnaire-asset-hash", "Questionnaire source bytes do not match their declared SHA-256.");
    }

    const familyDirectory = await getChildDirectory(
      this.questionnaireAssetsDirectory,
      safeFamilyId,
      { create: true },
    );
    const languageDirectory = await getChildDirectory(
      familyDirectory,
      safeLanguageTag,
      { create: true },
    );
    const fileName = `${sourceSha256}.${format}`;
    let handle;
    if (await fileExists(languageDirectory, fileName)) {
      handle = await languageDirectory.getFileHandle(fileName, { create: false });
    } else {
      handle = await writeNewFile(languageDirectory, fileName, bytes);
    }
    const stored = await handle.getFile();
    if (stored.size !== bytes.byteLength
      || await sha256Blob(stored, this.cryptoObject) !== sourceSha256) {
      fail(
        "questionnaire-asset-collision",
        "Stored questionnaire source bytes do not match their content-addressed filename.",
      );
    }
    return Object.freeze({
      workspaceId: this.workspaceId,
      familyId: safeFamilyId,
      languageTag: safeLanguageTag,
      relativePath: `${RESEARCH_QUESTIONNAIRE_ASSET_DIRECTORY}/${safeFamilyId}/${safeLanguageTag}/${fileName}`,
      sourceSha256,
      byteLength: bytes.byteLength,
    });
  }

  async loadSettingsFile(file) {
    if (!(file instanceof Blob)) fail("settings-file", "Choose a settings.json file.");
    if (file.size < 1 || file.size > 5 * 1024 * 1024) {
      fail("settings-size", "Settings file must contain between 1 byte and 5 MiB.");
    }
    let parsed;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      parsed = parseStrictJson(text);
    } catch (error) {
      if (error instanceof ResearchWorkspaceError) throw error;
      fail("settings-json", "Settings file is not valid JSON.", { cause: error });
    }
    if (parsed?.version === 3) return validateResearchSettingsV3(parsed);
    return parsed?.version === 2
      ? validateResearchSettingsV2(parsed)
      : validateResearchSettingsV1(parsed);
  }

  async saveSettings(settings) {
    await ensurePermission(this.rootHandle, "readwrite", { request: false });
    const normalized = settings?.version === 3
      ? await validateResearchSettingsV3(settings)
      : settings?.version === 2
        ? await validateResearchSettingsV2(settings)
        : validateResearchSettingsV1(settings);
    const experimentId = assertSafeWorkspaceSegment(normalized.experiment.id, "experiment ID");
    const name = `${experimentId}.settings.json`;
    const directory = this.#directory("settings");
    if ((normalized.version === 2 || normalized.version === 3)
      && normalized.questionnaires.definitions.length > 0) {
      const questionnaireDirectory = await directory.getDirectoryHandle("questionnaires", { create: true });
      for (const definition of normalized.questionnaires.definitions) {
        const definitionName = `${definition.questionnaireId}.${definition.definitionSha256}.csv`;
        const definitionText = await questionnaireToCsv(definition);
        if (await fileExists(questionnaireDirectory, definitionName)) {
          const existing = await questionnaireDirectory.getFileHandle(definitionName, { create: false });
          const existingText = await (await existing.getFile()).text();
          if (existingText !== definitionText) {
            fail("questionnaire-definition-collision", `Stored questionnaire ${definitionName} does not match its frozen definition.`);
          }
        } else {
          await writeNewFile(questionnaireDirectory, definitionName, definitionText);
        }
      }
    }
    const text = `${canonicalJson(normalized)}\n`;
    if (await fileExists(directory, name)) {
      const handle = await directory.getFileHandle(name, { create: false });
      const writable = await handle.createWritable({ keepExistingData: false });
      try {
        await writable.write(text);
        await writable.close();
      } catch (error) {
        await writable.abort?.().catch?.(() => {});
        throw error;
      }
      return handle;
    }
    return writeNewFile(directory, name, text);
  }

  async probeOutputWriteReadiness() {
    await ensurePermission(this.rootHandle, "readwrite", { request: false });
    const outputs = this.#directory("outputs");
    if (typeof outputs.removeEntry !== "function") {
      fail("output-write-probe", "The selected workspace cannot remove its temporary output write probe.");
    }
    const name = `.affect-research-write-probe-${newWorkspaceId(this.cryptoObject)}.tmp`;
    const body = `${RESEARCH_STORAGE_NAMESPACE}\n`;
    let created = false;
    try {
      const handle = await writeNewFile(outputs, name, body);
      created = true;
      const observed = await (await handle.getFile()).text();
      if (observed !== body) fail("output-write-probe", "The selected workspace changed the output write probe bytes.");
      return Object.freeze({ writeReady: true });
    } catch (error) {
      if (error instanceof ResearchWorkspaceError) throw error;
      fail("output-write-probe", "The selected workspace failed a create, write, sync, and read output probe.", { cause: error });
    } finally {
      if (created) {
        try {
          await outputs.removeEntry(name);
        } catch (error) {
          fail("output-write-probe-cleanup", "The selected workspace could not remove its temporary output write probe.", { cause: error });
        }
      }
    }
  }

  async createAttemptDirectory({ experimentId, participantId, sessionStem }) {
    await ensurePermission(this.rootHandle, "readwrite", { request: false });
    const segments = [experimentId, participantId, sessionStem]
      .map((value, index) => assertSafeWorkspaceSegment(value, ["experiment ID", "participant ID", "session stem"][index]));
    let current = this.#directory("outputs");
    current = await getChildDirectory(current, segments[0], { create: true });
    current = await getChildDirectory(current, segments[1], { create: true });
    try {
      await getChildDirectory(current, segments[2], { create: false });
      fail("attempt-exists", `Attempt directory ${segments[2]} already exists.`);
    } catch (error) {
      if (error instanceof ResearchWorkspaceError) throw error;
      if (error?.name !== "NotFoundError") throw error;
    }
    return getChildDirectory(current, segments[2], { create: true });
  }

  async openAttemptDirectory({ experimentId, participantId, sessionStem }) {
    await ensurePermission(this.rootHandle, "readwrite", { request: false });
    const segments = [experimentId, participantId, sessionStem]
      .map((value, index) => assertSafeWorkspaceSegment(value, ["experiment ID", "participant ID", "session stem"][index]));
    return getNestedDirectory(this.#directory("outputs"), segments, { create: false });
  }

  async writeAttemptArtifacts(directory, artifacts) {
    await ensurePermission(this.rootHandle, "readwrite", { request: false });
    if (!directory || directory.kind !== "directory") fail("attempt-directory", "Attempt directory is invalid.");
    if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) {
      fail("artifacts", "Attempt artifacts must be a name-to-content object.");
    }
    const written = [];
    for (const [name, body] of Object.entries(artifacts)) {
      await writeIdempotentAttemptFile(directory, name, body);
      written.push(name);
    }
    return Object.freeze(written);
  }

  async quarantineIncompleteAttemptArtifacts(directory) {
    await ensurePermission(this.rootHandle, "readwrite", { request: false });
    if (!directory || directory.kind !== "directory" || typeof directory.removeEntry !== "function") {
      fail("attempt-directory", "Incomplete attempt quarantine requires a removable curated attempt directory.");
    }
    if (await fileExists(directory, "manifest.json")) {
      fail("attempt-finalized", "An attempt with a manifest is immutable and cannot be quarantined for retry.");
    }
    const recovery = this.#directory("recovery");
    const quarantineId = newWorkspaceId(this.cryptoObject);
    const receipts = [];
    for (const artifactName of ATTEMPT_ARTIFACT_NAMES) {
      if (!(await fileExists(directory, artifactName))) continue;
      const source = await directory.getFileHandle(artifactName, { create: false });
      const file = await source.getFile();
      const quarantineName = `incomplete-${quarantineId}-${artifactName}`;
      const preserved = await writeNewFile(recovery, quarantineName, file);
      const preservedFile = await preserved.getFile();
      if (preservedFile.size !== file.size
        || (file.size > 0 && await sha256Blob(preservedFile) !== await sha256Blob(file))) {
        fail("quarantine-verification", `Could not verify the preserved ${artifactName} bytes.`);
      }
      await directory.removeEntry(artifactName);
      receipts.push(Object.freeze({ artifactName, quarantineName, byteLength: file.size }));
    }
    return Object.freeze(receipts);
  }

  async writeRecoveryJournal(name, body) {
    await ensurePermission(this.rootHandle, "readwrite", { request: false });
    return writeNewFile(this.#directory("recovery"), assertSafeWorkspaceSegment(name, "recovery file"), body);
  }

  async #loadOrCreateWorkspaceIdentity() {
    const settings = this.#directory("settings");
    try {
      const handle = await settings.getFileHandle(RESEARCH_WORKSPACE_IDENTITY_FILE, { create: false });
      const file = await handle.getFile();
      if (file.size < 1 || file.size > 16 * 1024) fail("workspace-identity", "Workspace identity file has an invalid size.");
      const identity = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()), {
        maximumBytes: 16 * 1024,
      });
      if (!identity || typeof identity !== "object" || Array.isArray(identity)
        || Object.keys(identity).sort().join(",") !== "schema,version,workspaceId"
        || identity.schema !== "affect-research-workspace-identity"
        || identity.version !== 1
        || !WORKSPACE_ID.test(identity.workspaceId)) {
        fail("workspace-identity", "Workspace identity file violates its strict v1 contract.");
      }
      return identity.workspaceId;
    } catch (error) {
      if (error instanceof ResearchWorkspaceError) throw error;
      if (error?.name !== "NotFoundError") {
        fail("workspace-identity", "Workspace identity file could not be read.", { cause: error });
      }
    }
    const workspaceId = newWorkspaceId(this.cryptoObject);
    await writeNewFile(settings, RESEARCH_WORKSPACE_IDENTITY_FILE, `${canonicalJson({
      schema: "affect-research-workspace-identity",
      version: 1,
      workspaceId,
    })}\n`);
    return workspaceId;
  }

  #directory(name) {
    const directory = this.directories.get(name);
    if (!directory) fail("not-initialized", "Initialize the workspace before using its libraries.");
    return directory;
  }
}
