import { validateVideoDisplayGeometry } from "./video-catalogue-contribution.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const WORKSPACE_FILE_PATTERN = /^(?:wf-[0-9a-f]{24}|pa-[0-9a-f]{64})$/u;
const STATES = new Set(["idle", "preparing", "paused", "playing", "buffering", "ended", "failed", "shuttingDown"]);
const STATUS_KEYS = Object.freeze([
  "actorReady", "audioStreamCount", "bufferingPercent", "durationMs", "generation",
  "mediaGrantId", "positionMs", "reasonCode", "schema", "sequence", "sessionId", "state",
  "version", "videoHeight", "videoWidth", "viewport", "warningCount", "workspaceFileId",
]);
const VIEWPORT_KEYS = Object.freeze(["heightPx", "layoutRevision", "leftPx", "topPx", "widthPx"]);
const PREPARE_KEYS = Object.freeze([
  "generation", "mediaGrantId", "schema", "sessionId", "state", "version", "workspaceFileId",
]);
const SCANNED_SUMMARY_KEYS = Object.freeze([
  "byteLength", "decodeAttestation", "decodeBackend", "decodeStatus", "decodedPositionsMs",
  "displayGeometry", "displayName", "durationMs", "mimeType", "sha256", "source", "workspaceFileId",
]);
const SOURCE_KEYS = Object.freeze([
  "byteLength", "durationMs", "kind", "mimeType", "relativePath", "sha256",
]);

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function nullable(value, predicate) {
  return value === null || predicate(value);
}

function finiteNonnegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function validateNativeMediaViewportPxV1(value) {
  if (!exactKeys(value, VIEWPORT_KEYS)
    || !Number.isSafeInteger(value.leftPx) || value.leftPx < 0
    || !Number.isSafeInteger(value.topPx) || value.topPx < 0
    || !positiveInteger(value.widthPx)
    || !positiveInteger(value.heightPx)
    || !Number.isSafeInteger(value.layoutRevision) || value.layoutRevision < 0) {
    throw new TypeError("Native media viewport receipt is malformed.");
  }
  return Object.freeze({ ...value });
}

export function validateNativeMediaStatusV1(value) {
  if (!exactKeys(value, STATUS_KEYS)
    || value.schema !== "affect-research-native-media-status"
    || value.version !== 1
    || value.actorReady !== true
    || !Number.isSafeInteger(value.sequence) || value.sequence < 1
    || !Number.isSafeInteger(value.generation) || value.generation < 0
    || !STATES.has(value.state)
    || !nullable(value.sessionId, (item) => typeof item === "string" && UUID_PATTERN.test(item))
    || !nullable(value.mediaGrantId, (item) => typeof item === "string" && UUID_PATTERN.test(item))
    || !nullable(value.workspaceFileId, (item) => typeof item === "string" && WORKSPACE_FILE_PATTERN.test(item))
    || !nullable(value.durationMs, finiteNonnegative)
    || !nullable(value.positionMs, finiteNonnegative)
    || !nullable(value.videoWidth, positiveInteger)
    || !nullable(value.videoHeight, positiveInteger)
    || !nullable(value.audioStreamCount, (item) => Number.isSafeInteger(item) && item >= 0)
    || !nullable(value.bufferingPercent, (item) => Number.isSafeInteger(item) && item >= 0 && item <= 100)
    || !Number.isSafeInteger(value.warningCount) || value.warningCount < 0
    || !nullable(value.reasonCode, (item) => typeof item === "string" && /^[a-z0-9-]{1,96}$/u.test(item))) {
    throw new TypeError("Native media status v1 is malformed.");
  }
  const viewport = validateNativeMediaViewportPxV1(value.viewport);
  const identityCount = [value.sessionId, value.mediaGrantId, value.workspaceFileId]
    .filter((item) => item !== null).length;
  const hasIdentity = identityCount === 3;
  if (identityCount !== 0 && identityCount !== 3
    || (["idle", "shuttingDown"].includes(value.state) && hasIdentity)
    || (!(["idle", "shuttingDown"].includes(value.state)) && !hasIdentity)
    || value.generation === 0 && (hasIdentity || value.state !== "idle")) {
    throw new TypeError("Native media status identity and lifecycle are inconsistent.");
  }
  return Object.freeze({ ...value, viewport });
}

export function validateNativeMediaPrepareReceiptV1(value) {
  if (!exactKeys(value, PREPARE_KEYS)
    || value.schema !== "affect-research-native-media-prepare-receipt"
    || value.version !== 1
    || value.state !== "preparing"
    || !positiveInteger(value.generation)
    || typeof value.sessionId !== "string" || !UUID_PATTERN.test(value.sessionId)
    || typeof value.mediaGrantId !== "string" || !UUID_PATTERN.test(value.mediaGrantId)
    || typeof value.workspaceFileId !== "string" || !WORKSPACE_FILE_PATTERN.test(value.workspaceFileId)) {
    throw new TypeError("Native media prepare receipt v1 is malformed.");
  }
  return Object.freeze({ ...value });
}

export function validateNativeDecodedStimulusSummaryV1(value) {
  let displayGeometry;
  try {
    displayGeometry = validateVideoDisplayGeometry(value?.displayGeometry);
  } catch {
    throw new TypeError("Native decoded stimulus summary is malformed.");
  }
  if (!exactKeys(value, SCANNED_SUMMARY_KEYS)
    || typeof value.workspaceFileId !== "string" || !WORKSPACE_FILE_PATTERN.test(value.workspaceFileId)
    || typeof value.displayName !== "string" || value.displayName.length < 1 || value.displayName.length > 512
    || typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256)
    || !positiveInteger(value.byteLength)
    || typeof value.mimeType !== "string" || value.mimeType.length < 1 || value.mimeType.length > 128
    || !finiteNonnegative(value.durationMs) || value.durationMs < 10
    || value.decodeStatus !== "attestedQualified"
    || value.decodeBackend !== "nativeGstPlay"
    || value.decodeAttestation !== "nativeDecodedSnapshotsV1"
    || !Array.isArray(value.decodedPositionsMs) || value.decodedPositionsMs.length !== 3
    || value.decodedPositionsMs.some((position) => !finiteNonnegative(position))
    || value.decodedPositionsMs.some((position, index) => index > 0 && position <= value.decodedPositionsMs[index - 1])
    || !exactKeys(value.source, SOURCE_KEYS)
    || value.source.kind !== "workspaceFile"
    || (value.workspaceFileId.startsWith("wf-")
      ? value.source.relativePath !== `stimuli/.workspace/${value.workspaceFileId}`
      : !/^stimuli\/(?!\.workspace\/)[^\\\u0000]+$/u.test(value.source.relativePath))
    || value.source.mimeType !== value.mimeType
    || value.source.sha256 !== value.sha256
    || value.source.byteLength !== value.byteLength
    || value.source.durationMs !== value.durationMs
    || displayGeometry.source !== "native-gstplay-metadata") {
    throw new TypeError("Native decoded stimulus summary is malformed.");
  }
  return Object.freeze({
    ...value,
    decodedPositionsMs: Object.freeze([...value.decodedPositionsMs]),
    displayGeometry,
    source: Object.freeze({ ...value.source }),
  });
}

export function nativeMediaViewportCssV1(host, layoutRevision) {
  const rect = host?.getBoundingClientRect?.();
  if (!rect || !Number.isSafeInteger(layoutRevision) || layoutRevision < 1) {
    throw new TypeError("Native media viewport requires a rendered host and positive layout revision.");
  }
  const values = [rect.left, rect.top, rect.width, rect.height];
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))
    || rect.left < 0 || rect.top < 0 || rect.width < 1 || rect.height < 1) {
    throw new TypeError("Native media host geometry is unavailable.");
  }
  return Object.freeze({
    leftCssPx: rect.left,
    topCssPx: rect.top,
    widthCssPx: rect.width,
    heightCssPx: rect.height,
    layoutRevision,
  });
}

export class NativeMediaController {
  constructor({ invoke, wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) } = {}) {
    if (typeof invoke !== "function" || typeof wait !== "function") {
      throw new TypeError("NativeMediaController requires invoke and wait functions.");
    }
    this.invoke = invoke;
    this.wait = wait;
    this.fence = null;
    this.layoutRevision = 0;
    this.lastStatus = null;
  }

  get activeFence() {
    return this.fence ? Object.freeze({ ...this.fence }) : null;
  }

  viewport(host) {
    return nativeMediaViewportCssV1(host, ++this.layoutRevision);
  }

  async prepare({ workspaceId, summary, host }) {
    if (typeof workspaceId !== "string" || !UUID_PATTERN.test(workspaceId)
      || !summary || typeof summary !== "object"
      || typeof summary.workspaceFileId !== "string" || !WORKSPACE_FILE_PATTERN.test(summary.workspaceFileId)
      || typeof summary.sha256 !== "string" || !SHA256_PATTERN.test(summary.sha256)
      || !positiveInteger(summary.byteLength)
      || typeof summary.mimeType !== "string" || summary.mimeType.length < 1 || summary.mimeType.length > 128) {
      throw new TypeError("Native media preparation requires one exact verified workspace stimulus.");
    }
    const receipt = validateNativeMediaPrepareReceiptV1(await this.invoke("research_native_media_prepare", {
      request: {
        workspaceId,
        workspaceFileId: summary.workspaceFileId,
        sha256: summary.sha256,
        byteLength: summary.byteLength,
        mimeType: summary.mimeType,
        viewport: this.viewport(host),
      },
    }));
    if (receipt.workspaceFileId !== summary.workspaceFileId) {
      throw new Error("Native media preparation returned a different workspace identity.");
    }
    this.fence = Object.freeze({ sessionId: receipt.sessionId, generation: receipt.generation });
    this.lastStatus = null;
    return receipt;
  }

  async status() {
    const status = validateNativeMediaStatusV1(await this.invoke("research_native_media_status"));
    if (this.fence && status.sessionId !== null
      && (status.sessionId !== this.fence.sessionId || status.generation !== this.fence.generation)) {
      throw new Error("Native media status crossed the active generation fence.");
    }
    this.lastStatus = status;
    return status;
  }

  async awaitPrepared({ attempts = 100, intervalMs = 25 } = {}) {
    return this.awaitState({ states: ["paused"], attempts, intervalMs, requirePreparedMedia: true });
  }

  async awaitState({ states, attempts = 200, intervalMs = 25, requirePreparedMedia = false } = {}) {
    if (!this.fence
      || !Array.isArray(states) || states.length < 1
      || states.some((state) => !STATES.has(state))
      || !positiveInteger(attempts) || !positiveInteger(intervalMs)
      || typeof requirePreparedMedia !== "boolean") {
      throw new TypeError("Native media preparation wait is malformed.");
    }
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const status = await this.status();
      if (states.includes(status.state)
        && (!requirePreparedMedia
          || (status.durationMs > 0 && status.videoWidth > 0 && status.videoHeight > 0))) {
        return status;
      }
      if (status.state === "failed") {
        throw new Error(`Native media operation failed (${status.reasonCode ?? "unknown"}).`);
      }
      await this.wait(intervalMs);
    }
    throw new Error(`Native media operation timed out waiting for ${states.join(" or ")}.`);
  }

  async setViewport(host) {
    return this.#control("research_native_media_set_viewport", {
      request: { fence: this.#requiredFence(), viewport: this.viewport(host) },
    });
  }

  async play() {
    return this.#control("research_native_media_play", { fence: this.#requiredFence() });
  }

  async attestDecode({ workspaceId, summary }) {
    const fence = this.#requiredFence();
    if (typeof workspaceId !== "string" || !UUID_PATTERN.test(workspaceId)
      || !summary || typeof summary !== "object"
      || typeof summary.workspaceFileId !== "string" || !WORKSPACE_FILE_PATTERN.test(summary.workspaceFileId)
      || typeof summary.sha256 !== "string" || !SHA256_PATTERN.test(summary.sha256)
      || !positiveInteger(summary.byteLength)
      || typeof summary.mimeType !== "string" || summary.mimeType.length < 1 || summary.mimeType.length > 128) {
      throw new TypeError("Native decode attestation requires one exact prepared workspace stimulus.");
    }
    const result = validateNativeDecodedStimulusSummaryV1(await this.invoke(
      "research_native_media_attest_decode",
      {
        request: {
          workspaceId,
          workspaceFileId: summary.workspaceFileId,
          sha256: summary.sha256,
          byteLength: summary.byteLength,
          mimeType: summary.mimeType,
          fence,
        },
      },
    ));
    if (result.workspaceFileId !== summary.workspaceFileId
      || result.sha256 !== summary.sha256
      || result.byteLength !== summary.byteLength
      || result.mimeType !== summary.mimeType) {
      throw new Error("Native decode attestation returned a different stimulus identity.");
    }
    return result;
  }

  async pause() {
    return this.#control("research_native_media_pause", { fence: this.#requiredFence() });
  }

  async stop() {
    if (!this.fence) return this.lastStatus;
    const fence = this.fence;
    try {
      return await this.#control("research_native_media_stop", { fence });
    } finally {
      this.fence = null;
    }
  }

  #requiredFence() {
    if (!this.fence) throw new Error("No native media generation is active.");
    return this.fence;
  }

  async #control(command, payload) {
    const status = validateNativeMediaStatusV1(await this.invoke(command, payload));
    if (this.fence && status.sessionId !== null
      && (status.sessionId !== this.fence.sessionId || status.generation !== this.fence.generation)) {
      throw new Error("Native media control returned a stale generation.");
    }
    this.lastStatus = status;
    return status;
  }
}
