import { canonicalJson, canonicalSha256 } from "./canonical.js";

export const VIDEO_CATALOGUE_CONTRIBUTION_SCHEMA = "affect-research-video-catalogue-contribution";
export const VIDEO_CATALOGUE_CONTRIBUTION_VERSION = 1;
export const VIDEO_CATALOGUE_CONTRIBUTION_CURRENT_VERSION = 2;
export const VIDEO_LOCATION_ID_POLICY_V1 = "relative-path-reversible-v1";
export const VIDEO_LOCATION_ID_MAX_BYTES = 6_144;

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

function portablePath(value, label, prefix, { trimmedComponents = false } = {}) {
  safeText(value, label, 2_048);
  if (!value.startsWith(prefix) || value.split("/").some((part) => (
    !part || part === "." || part === ".." || (trimmedComponents && part !== part.trim())
      || /[<>:"\\|?*]/u.test(part) || /[. ]$/u.test(part)
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

function compareLocationIdentity(left, right) {
  return left.annotationId < right.annotationId ? -1
    : left.annotationId > right.annotationId ? 1
      : compareAssetIdentity(left, right);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeGeometry(value, label, { allowNative = false } = {}) {
  exactObject(value, [
    "status", "source", "displayWidthPx", "displayHeightPx", "displayAspect",
    "rotationDegrees", "pixelAspectRatio", "metadataInterpretation",
  ], label);
  if (value.status !== "verified") throw new TypeError(`${label} must be verified display geometry.`);
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
  if (value.source === "browser-decoder") {
    if (value.metadataInterpretation !== "decoder-oriented-display"
      || value.rotationDegrees !== null || value.pixelAspectRatio !== null) {
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
  if (!allowNative || value.source !== "native-gstplay-metadata"
    || value.metadataInterpretation !== "explicit-orientation-and-square-pixel-snapshot"
    || ![0, 90, 180, 270].includes(value.rotationDegrees)) {
    throw new TypeError(`${label} must use a supported verified geometry source.`);
  }
  exactObject(value.pixelAspectRatio, ["numerator", "denominator"], `${label}.pixelAspectRatio`);
  const pixelAspectRatio = {
    numerator: positiveInteger(value.pixelAspectRatio.numerator, `${label}.pixelAspectRatio.numerator`),
    denominator: positiveInteger(value.pixelAspectRatio.denominator, `${label}.pixelAspectRatio.denominator`),
  };
  if (greatestCommonDivisor(pixelAspectRatio.numerator, pixelAspectRatio.denominator) !== 1) {
    throw new TypeError(`${label}.pixelAspectRatio must be reduced.`);
  }
  return {
    status: "verified",
    source: "native-gstplay-metadata",
    displayWidthPx,
    displayHeightPx,
    displayAspect,
    rotationDegrees: value.rotationDegrees,
    pixelAspectRatio,
    metadataInterpretation: "explicit-orientation-and-square-pixel-snapshot",
  };
}

export function validateVideoDisplayGeometryV1(value) {
  return deepFreeze(normalizeGeometry(value, "Video display geometry"));
}

export function validateVideoDisplayGeometry(value) {
  return deepFreeze(normalizeGeometry(value, "Video display geometry", { allowNative: true }));
}

/**
 * Reversible location identity. Every relative path component, including the
 * filename extension, remains visible. `%` and the component delimiter `_`
 * are escaped before components are joined, so the mapping is injective.
 */
export function videoAnnotationIdFromRelativePathV1(value) {
  const path = portablePath(value, "Video source relative path", "stimuli/", { trimmedComponents: true });
  const annotationId = path.slice("stimuli/".length).split("/")
    .map((part, index) => {
      let encoded = part.replaceAll("%", "%25").replaceAll("_", "%5F");
      if (index === 0 && /^[=+@-]/u.test(encoded)) {
        encoded = `%${encoded.codePointAt(0).toString(16).toUpperCase().padStart(2, "0")}${encoded.slice(1)}`;
      }
      return encoded;
    })
    .join("_");
  return safeText(annotationId, "Video location ID", VIDEO_LOCATION_ID_MAX_BYTES);
}

export function videoRelativePathFromAnnotationIdV1(value) {
  const annotationId = safeText(value, "Video location ID", VIDEO_LOCATION_ID_MAX_BYTES);
  const parts = annotationId.split("_").map((encoded) => {
    let decoded = "";
    for (let index = 0; index < encoded.length; index += 1) {
      if (encoded[index] !== "%") {
        decoded += encoded[index];
        continue;
      }
      const escape = encoded.slice(index, index + 3);
      const decodedEscape = new Map([
        ["%25", "%"], ["%5F", "_"], ["%2B", "+"], ["%2D", "-"], ["%3D", "="], ["%40", "@"],
      ]).get(escape);
      if (decodedEscape === undefined) throw new TypeError("Video location ID contains a noncanonical escape.");
      decoded += decodedEscape;
      index += 2;
    }
    return decoded;
  });
  const path = portablePath(`stimuli/${parts.join("/")}`, "Video source relative path", "stimuli/");
  if (videoAnnotationIdFromRelativePathV1(path) !== annotationId) {
    throw new TypeError("Video location ID is not canonical.");
  }
  return path;
}

function normalizeEntry(value, index, { version = 1 } = {}) {
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
  const pathOptions = { trimmedComponents: version >= 2 };
  const sourceRelativePath = portablePath(value.sourceRelativePath, `${label}.sourceRelativePath`, "stimuli/", pathOptions);
  const packageRelativePath = portablePath(value.packageRelativePath, `${label}.packageRelativePath`, "assets/stimuli/", pathOptions);
  if (packageRelativePath !== `assets/${sourceRelativePath}`) {
    throw new TypeError(`${label} package and logical paths do not describe the same portable asset.`);
  }
  return {
    assetId: value.assetId,
    // A readable/editable name is deliberately separate from immutable identity.
    // Q04 still owns collision policy, so this producer does not silently suffix it.
    annotationId: version === 1
      ? safeText(value.annotationId, `${label}.annotationId`)
      : safeText(value.annotationId, `${label}.annotationId`, VIDEO_LOCATION_ID_MAX_BYTES),
    sourceRelativePath,
    packageRelativePath,
    sha256: value.sha256,
    byteLength: positiveInteger(value.byteLength, `${label}.byteLength`),
    durationMs: positiveInteger(value.durationMs, `${label}.durationMs`),
    geometry: normalizeGeometry(value.geometry, `${label}.geometry`, { allowNative: version >= 2 }),
  };
}

function normalizeEntryV2(value, index) {
  const entry = normalizeEntry(value, index, { version: 2 });
  const expected = videoAnnotationIdFromRelativePathV1(entry.sourceRelativePath);
  if (entry.annotationId !== expected
    || videoRelativePathFromAnnotationIdV1(entry.annotationId) !== entry.sourceRelativePath) {
    throw new TypeError(`Video catalogue entry ${index + 1}.annotationId must be the reversible relative-path identity.`);
  }
  return entry;
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

function normalizeCoreV2(value) {
  exactObject(value, ["schema", "version", "revision", "annotationPolicy", "entries"], "Video catalogue contribution core");
  if (value.schema !== VIDEO_CATALOGUE_CONTRIBUTION_SCHEMA
    || value.version !== VIDEO_CATALOGUE_CONTRIBUTION_CURRENT_VERSION
    || value.annotationPolicy !== VIDEO_LOCATION_ID_POLICY_V1) {
    throw new TypeError("Video catalogue contribution schema/version/policy is unsupported.");
  }
  const revision = positiveInteger(value.revision, "Video catalogue revision");
  if (!Array.isArray(value.entries) || value.entries.length < 1 || value.entries.length > 10_000) {
    throw new TypeError("Current video catalogue entries must be a bounded non-empty array.");
  }
  const entries = value.entries.map(normalizeEntryV2).sort(compareLocationIdentity);
  const locationIds = new Set();
  const packagePaths = new Set();
  const contentByAssetId = new Map();
  for (const entry of entries) {
    if (locationIds.has(entry.annotationId)) throw new TypeError("Video catalogue location identities must be unique.");
    if (packagePaths.has(entry.packageRelativePath)) throw new TypeError("Video catalogue package paths must be unique.");
    locationIds.add(entry.annotationId);
    packagePaths.add(entry.packageRelativePath);
    const content = canonicalJson({
      sha256: entry.sha256,
      byteLength: entry.byteLength,
      durationMs: entry.durationMs,
      geometry: entry.geometry,
    });
    const priorContent = contentByAssetId.get(entry.assetId);
    if (priorContent !== undefined && priorContent !== content) {
      throw new TypeError("Locations sharing one immutable asset identity must agree on content metadata.");
    }
    contentByAssetId.set(entry.assetId, content);
  }
  return {
    schema: VIDEO_CATALOGUE_CONTRIBUTION_SCHEMA,
    version: VIDEO_CATALOGUE_CONTRIBUTION_CURRENT_VERSION,
    revision,
    annotationPolicy: VIDEO_LOCATION_ID_POLICY_V1,
    entries,
  };
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

/** Current projection: the catalogue identity is derived, never hand-edited. */
export function workspaceStimuliToVideoCatalogueEntries(stimuli) {
  if (!Array.isArray(stimuli) || stimuli.length < 1 || stimuli.length > 10_000) {
    throw new TypeError("The video catalogue requires a bounded non-empty workspace list.");
  }
  return stimuli.map((stimulus, index) => {
    if (!stimulus || stimulus.source !== "workspace" || stimulus.verification !== "verified"
      || stimulus.contractSource?.kind !== "workspaceFile" || !stimulus.displayGeometry) {
      throw new TypeError(`Workspace video ${index + 1} is pending or unsupported.`);
    }
    const sourceRelativePath = stimulus.contractSource.relativePath;
    return normalizeEntryV2({
      assetId: assetIdFromSha256(stimulus.contractSource.sha256),
      annotationId: videoAnnotationIdFromRelativePathV1(sourceRelativePath),
      sourceRelativePath,
      packageRelativePath: `assets/${sourceRelativePath}`,
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

export async function createVideoCatalogueContribution({ revision, entries }) {
  const core = normalizeCoreV2({
    schema: VIDEO_CATALOGUE_CONTRIBUTION_SCHEMA,
    version: VIDEO_CATALOGUE_CONTRIBUTION_CURRENT_VERSION,
    revision,
    annotationPolicy: VIDEO_LOCATION_ID_POLICY_V1,
    entries,
  });
  return deepFreeze({ ...structuredClone(core), integritySha256: await canonicalSha256(core) });
}

export async function validateVideoCatalogueContribution(value) {
  if (value?.schema !== VIDEO_CATALOGUE_CONTRIBUTION_SCHEMA) {
    throw new TypeError("Video catalogue contribution schema is unsupported.");
  }
  if (value.version === VIDEO_CATALOGUE_CONTRIBUTION_VERSION) {
    return validateVideoCatalogueContributionV1(value);
  }
  exactObject(value, [
    "schema", "version", "revision", "annotationPolicy", "entries", "integritySha256",
  ], "Video catalogue contribution");
  if (typeof value.integritySha256 !== "string" || !SHA256.test(value.integritySha256)) {
    throw new TypeError("Video catalogue contribution integrity SHA-256 is invalid.");
  }
  const expected = await createVideoCatalogueContribution(value);
  if (canonicalJson(expected) !== canonicalJson(value)) {
    throw new TypeError("Video catalogue contribution is noncanonical or its integrity does not match.");
  }
  return expected;
}

export async function reviseVideoCatalogueContribution(previous, entries) {
  const prior = previous === null ? null : await validateVideoCatalogueContribution(previous);
  const nextRevision = prior ? prior.revision + 1 : 1;
  const candidate = await createVideoCatalogueContribution({ revision: nextRevision, entries });
  if (!prior) return candidate;
  return prior.version === VIDEO_CATALOGUE_CONTRIBUTION_CURRENT_VERSION
    && canonicalJson(prior.entries) === canonicalJson(candidate.entries) ? previous : candidate;
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

export async function projectVideoDisplayGeometry(value) {
  const catalogue = await validateVideoCatalogueContribution(value);
  const content = new Map();
  for (const entry of catalogue.entries) {
    if (!content.has(entry.assetId)) content.set(entry.assetId, Object.freeze({
      assetId: entry.assetId,
      displayWidth: entry.geometry.displayWidthPx,
      displayHeight: entry.geometry.displayHeightPx,
    }));
  }
  return Object.freeze({
    catalogueRevision: catalogue.revision,
    videos: Object.freeze([...content.values()]),
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

export async function projectVideoReferenceAliases(value) {
  const catalogue = await validateVideoCatalogueContribution(value);
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

/** New producer writes v2 while accepting exact historical v1 documents. */
export function createVideoCatalogueProducer({
  onChange = () => {},
  validateRestoredContribution = validateVideoCatalogueContribution,
} = {}) {
  if (typeof onChange !== "function" || typeof validateRestoredContribution !== "function") {
    throw new TypeError("Video catalogue producer inputs are malformed.");
  }
  const listeners = new Set([onChange]);
  let generation = 0;
  let lastAccepted = null;
  let snapshot = deepFreeze({
    revision: 0, enabled: true, pending: true, contribution: null, dependencyRevisions: [],
  });

  function publish(next, { notify = true } = {}) {
    if (canonicalJson(next) === canonicalJson(snapshot)) return snapshot;
    snapshot = deepFreeze(next);
    if (notify) for (const listener of listeners) listener(snapshot);
    return snapshot;
  }

  function withdraw({ notify = true } = {}) {
    generation += 1;
    return publish({
      ...snapshot,
      revision: snapshot.contribution === null ? snapshot.revision : snapshot.revision + 1,
      pending: true,
      contribution: null,
    }, { notify });
  }

  async function replaceEntries(entries) {
    const operation = ++generation;
    publish({ ...snapshot, pending: true });
    try {
      const contribution = await reviseVideoCatalogueContribution(lastAccepted, entries);
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

  async function preparePublication({ entries, restored = null }, { isCurrent }) {
    const previous = snapshot, operation = generation;
    let committed = false, projected = false, committedGeneration;
    const current = () => !committed && operation === generation && previous === snapshot && isCurrent();
    const contribution = restored === null
      ? await reviseVideoCatalogueContribution(lastAccepted, structuredClone(entries))
      : await validateRestoredContribution(structuredClone(restored));
    if (!current()) throw new Error("Video catalogue changed during preparation.");
    return Object.freeze({ isCurrent: current,
      commit() {
        if (!current()) throw new Error("Video catalogue changed before publication.");
        generation++;
        committedGeneration = generation;
        const changed = previous.contribution === null || canonicalJson(previous.contribution) !== canonicalJson(contribution);
        lastAccepted = contribution;
        publish({ ...previous, revision: previous.revision + (changed ? 1 : 0), pending: false, contribution }, { notify: false });
        committed = true;
      },
      afterCommit() {
        if (!committed) throw new Error("Publish the catalogue first.");
        if (projected || committedGeneration !== generation) return;
        projected = true; for (const listener of listeners) listener(snapshot);
      },
    });
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    preparePublication,
    replaceEntries,
    restoreContribution,
    withdraw,
    notifyChange() { for (const listener of listeners) listener(snapshot); },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Video catalogue listener must be a function.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
