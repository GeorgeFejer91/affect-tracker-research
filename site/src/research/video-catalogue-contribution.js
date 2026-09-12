import { canonicalJson, canonicalSha256 } from "./canonical.js";

export const VIDEO_CATALOGUE_CONTRIBUTION_SCHEMA = "affect-research-video-catalogue-contribution";
export const VIDEO_CATALOGUE_CONTRIBUTION_VERSION = 1;

const SHA256 = /^[a-f0-9]{64}$/u;
const ASSET_ID = /^asset-[a-f0-9]{64}$/u;
const encoder = new TextEncoder();

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    throw new TypeError(`${label} has unexpected or missing fields.`);
  }
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} must be a positive integer.`);
  return value;
}

function safeText(value, label, maximumBytes = 200) {
  if (typeof value !== "string" || value !== value.trim() || value !== value.normalize("NFC")
    || !value || encoder.encode(value).length > maximumBytes || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new TypeError(`${label} must be bounded, trimmed NFC text without control characters.`);
  }
  return value;
}

function portablePath(value, label, prefix) {
  safeText(value, label, 2_048);
  if (!value.startsWith(prefix) || value.split("/").some((part) => (
    !part || part === "." || part === ".." || /[<>:"\\|?*]/u.test(part) || /[. ]$/u.test(part)
  ))) throw new TypeError(`${label} must remain beneath ${prefix}.`);
  return value;
}

function greatestCommonDivisor(left, right) {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function compareAssetIdentity(left, right) {
  return left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeGeometry(value, label) {
  exactObject(value, [
    "status", "source", "displayWidthPx", "displayHeightPx", "displayAspect",
    "rotationDegrees", "pixelAspectRatio", "metadataInterpretation",
  ], label);
  if (value.status !== "verified" || value.source !== "browser-decoder"
    || value.metadataInterpretation !== "decoder-oriented-display") {
    throw new TypeError(`${label} must be verified decoder-oriented browser display geometry.`);
  }
  const displayWidthPx = positiveInteger(value.displayWidthPx, `${label}.displayWidthPx`);
  const displayHeightPx = positiveInteger(value.displayHeightPx, `${label}.displayHeightPx`);
  exactObject(value.displayAspect, ["numerator", "denominator"], `${label}.displayAspect`);
  const divisor = greatestCommonDivisor(displayWidthPx, displayHeightPx);
  const displayAspect = {
    numerator: positiveInteger(value.displayAspect.numerator, `${label}.displayAspect.numerator`),
    denominator: positiveInteger(value.displayAspect.denominator, `${label}.displayAspect.denominator`),
  };
  if (displayAspect.numerator !== displayWidthPx / divisor
    || displayAspect.denominator !== displayHeightPx / divisor) {
    throw new TypeError(`${label}.displayAspect must be the reduced ratio of the oriented display dimensions.`);
  }
  if (value.rotationDegrees !== null || value.pixelAspectRatio !== null) {
    throw new TypeError(`${label} cannot invent encoded rotation or pixel-aspect metadata not exposed by the browser decoder.`);
  }
  return {
    status: "verified",
    source: "browser-decoder",
    displayWidthPx,
    displayHeightPx,
    displayAspect,
    rotationDegrees: null,
    pixelAspectRatio: null,
    metadataInterpretation: "decoder-oriented-display",
  };
}

function normalizeEntry(value, index) {
  const label = `Video catalogue entry ${index + 1}`;
  exactObject(value, [
    "assetId", "annotationId", "sourceRelativePath", "packageRelativePath",
    "sha256", "byteLength", "durationMs", "geometry",
  ], label);
  if (typeof value.assetId !== "string" || !ASSET_ID.test(value.assetId)) {
    throw new TypeError(`${label}.assetId is not an immutable content identity.`);
  }
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)
    || value.assetId !== assetIdFromSha256(value.sha256)) {
    throw new TypeError(`${label}.assetId must bind the complete SHA-256 identity.`);
  }
  const sourceRelativePath = portablePath(value.sourceRelativePath, `${label}.sourceRelativePath`, "stimuli/");
  const packageRelativePath = portablePath(value.packageRelativePath, `${label}.packageRelativePath`, "assets/stimuli/");
  if (packageRelativePath !== `assets/${sourceRelativePath}`) {
    throw new TypeError(`${label} package and logical paths do not describe the same portable asset.`);
  }
  return {
    assetId: value.assetId,
    // A readable/editable name is deliberately separate from immutable identity.
    // Q04 still owns collision policy, so this producer does not silently suffix it.
    annotationId: safeText(value.annotationId, `${label}.annotationId`),
    sourceRelativePath,
    packageRelativePath,
    sha256: value.sha256,
    byteLength: positiveInteger(value.byteLength, `${label}.byteLength`),
    durationMs: positiveInteger(value.durationMs, `${label}.durationMs`),
    geometry: normalizeGeometry(value.geometry, `${label}.geometry`),
  };
}

function normalizeCore(value) {
  exactObject(value, ["schema", "version", "revision", "entries"], "Video catalogue contribution core");
  if (value.schema !== VIDEO_CATALOGUE_CONTRIBUTION_SCHEMA
    || value.version !== VIDEO_CATALOGUE_CONTRIBUTION_VERSION) {
    throw new TypeError("Video catalogue contribution schema/version is unsupported.");
  }
  const revision = positiveInteger(value.revision, "Video catalogue revision");
  if (!Array.isArray(value.entries) || value.entries.length > 10_000) {
    throw new TypeError("Video catalogue entries must be a bounded array.");
  }
  const entries = value.entries.map(normalizeEntry)
    .sort(compareAssetIdentity);
  const assetIds = new Set();
  const packagePaths = new Set();
  for (const entry of entries) {
    if (assetIds.has(entry.assetId)) throw new TypeError("Video catalogue asset identities must be unique.");
    if (packagePaths.has(entry.packageRelativePath)) throw new TypeError("Video catalogue package paths must be unique.");
    assetIds.add(entry.assetId);
    packagePaths.add(entry.packageRelativePath);
  }
  return { schema: VIDEO_CATALOGUE_CONTRIBUTION_SCHEMA, version: 1, revision, entries };
}

export function assetIdFromSha256(sha256) {
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) throw new TypeError("Video SHA-256 is invalid.");
  return `asset-${sha256}`;
}

export function browserDisplayGeometry({ videoWidth, videoHeight } = {}) {
  const displayWidthPx = positiveInteger(videoWidth, "Browser display width");
  const displayHeightPx = positiveInteger(videoHeight, "Browser display height");
  const divisor = greatestCommonDivisor(displayWidthPx, displayHeightPx);
  return {
    status: "verified",
    source: "browser-decoder",
    displayWidthPx,
    displayHeightPx,
    displayAspect: { numerator: displayWidthPx / divisor, denominator: displayHeightPx / divisor },
    rotationDegrees: null,
    pixelAspectRatio: null,
    metadataInterpretation: "decoder-oriented-display",
  };
}

/** Project the current P1 UI records without ever dropping unsupported rows. */
export function workspaceStimuliToVideoCatalogueEntriesV1(stimuli) {
  if (!Array.isArray(stimuli) || stimuli.length < 1 || stimuli.length > 10_000) {
    throw new TypeError("The video catalogue requires a bounded non-empty workspace list.");
  }
  return stimuli.map((stimulus, index) => {
    if (!stimulus || stimulus.source !== "workspace" || stimulus.verification !== "verified"
      || stimulus.contractSource?.kind !== "workspaceFile" || !stimulus.displayGeometry) {
      throw new TypeError(`Workspace video ${index + 1} is pending or unsupported.`);
    }
    return normalizeEntry({
      assetId: assetIdFromSha256(stimulus.contractSource.sha256),
      annotationId: stimulus.title,
      sourceRelativePath: stimulus.contractSource.relativePath,
      packageRelativePath: `assets/${stimulus.contractSource.relativePath}`,
      sha256: stimulus.contractSource.sha256,
      byteLength: stimulus.contractSource.byteLength,
      durationMs: stimulus.contractSource.durationMs,
      geometry: stimulus.displayGeometry,
    }, index);
  });
}

export async function createVideoCatalogueContributionV1({ revision, entries }) {
  const core = normalizeCore({
    schema: VIDEO_CATALOGUE_CONTRIBUTION_SCHEMA,
    version: VIDEO_CATALOGUE_CONTRIBUTION_VERSION,
    revision,
    entries,
  });
  return deepFreeze({ ...structuredClone(core), integritySha256: await canonicalSha256(core) });
}

export async function validateVideoCatalogueContributionV1(value) {
  exactObject(value, ["schema", "version", "revision", "entries", "integritySha256"], "Video catalogue contribution");
  if (typeof value.integritySha256 !== "string" || !SHA256.test(value.integritySha256)) {
    throw new TypeError("Video catalogue contribution integrity SHA-256 is invalid.");
  }
  const expected = await createVideoCatalogueContributionV1(value);
  if (canonicalJson(expected) !== canonicalJson(value)) {
    throw new TypeError("Video catalogue contribution is noncanonical or its integrity does not match.");
  }
  return expected;
}

export async function reviseVideoCatalogueContributionV1(previous, entries) {
  const prior = previous === null ? null : await validateVideoCatalogueContributionV1(previous);
  const nextRevision = prior ? prior.revision + 1 : 1;
  const candidate = await createVideoCatalogueContributionV1({ revision: nextRevision, entries });
  if (!prior) return candidate;
  const priorEntries = canonicalJson(prior.entries);
  return priorEntries === canonicalJson(candidate.entries) ? previous : candidate;
}

export async function projectVideoDisplayGeometryV1(value) {
  const catalogue = await validateVideoCatalogueContributionV1(value);
  return Object.freeze({
    catalogueRevision: catalogue.revision,
    videos: Object.freeze(catalogue.entries.map((entry) => Object.freeze({
      assetId: entry.assetId,
      displayWidth: entry.geometry.displayWidthPx,
      displayHeight: entry.geometry.displayHeightPx,
    }))),
  });
}

/**
 * P3 boundary projection. Accepted recipes persist assetId; annotationId is only
 * a user-facing lookup alias and consumers must reject an ambiguous alias.
 */
export async function projectVideoReferenceAliasesV1(value) {
  const catalogue = await validateVideoCatalogueContributionV1(value);
  return deepFreeze({
    catalogueRevision: catalogue.revision,
    references: catalogue.entries.map(({ assetId, annotationId }) => ({ assetId, annotationId })),
  });
}

/**
 * Stateful boundary used by P7 and by revision-bound P3/P4/P6 consumers.
 * Replace is last-write-wins; an invalid or explicitly withdrawn catalogue is
 * represented as pending with a null contribution, never as a shortened list.
 */
export function createVideoCatalogueProducerV1({
  onChange = () => {},
  validateRestoredContribution = validateVideoCatalogueContributionV1,
} = {}) {
  if (typeof onChange !== "function" || typeof validateRestoredContribution !== "function") {
    throw new TypeError("Video catalogue producer inputs are malformed.");
  }
  const listeners = new Set([onChange]);
  let generation = 0;
  let lastAccepted = null;
  let snapshot = deepFreeze({
    revision: 0,
    enabled: true,
    pending: true,
    contribution: null,
    dependencyRevisions: [],
  });

  function publish(next) {
    if (canonicalJson(next) === canonicalJson(snapshot)) return snapshot;
    snapshot = deepFreeze(next);
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  }

  function withdraw() {
    generation += 1;
    return publish({
      ...snapshot,
      revision: snapshot.contribution === null ? snapshot.revision : snapshot.revision + 1,
      pending: true,
      contribution: null,
    });
  }

  async function replaceEntries(entries) {
    const operation = ++generation;
    publish({ ...snapshot, pending: true });
    try {
      const contribution = await reviseVideoCatalogueContributionV1(lastAccepted, entries);
      if (operation !== generation) return snapshot;
      const identityChanged = snapshot.contribution === null
        || canonicalJson(snapshot.contribution) !== canonicalJson(contribution);
      lastAccepted = contribution;
      return publish({
        ...snapshot,
        revision: identityChanged ? snapshot.revision + 1 : snapshot.revision,
        pending: false,
        contribution,
      });
    } catch (error) {
      if (operation === generation) withdraw();
      throw error;
    }
  }

  async function restoreContribution(value, { isCurrent = () => true } = {}) {
    if (typeof isCurrent !== "function") throw new TypeError("Video catalogue restore guard must be a function.");
    const operation = ++generation;
    const contribution = await validateRestoredContribution(value);
    if (operation !== generation || !isCurrent()) return snapshot;
    publish({ ...snapshot, pending: true });
    const identityChanged = snapshot.contribution === null
      || canonicalJson(snapshot.contribution) !== canonicalJson(contribution);
    lastAccepted = contribution;
    return publish({
      ...snapshot,
      revision: identityChanged ? snapshot.revision + 1 : snapshot.revision,
      pending: false,
      contribution,
    });
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    replaceEntries,
    restoreContribution,
    withdraw,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Video catalogue listener must be a function.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
