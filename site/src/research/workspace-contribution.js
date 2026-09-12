import { canonicalJson } from "./canonical.js";
import { validateStudyIdentityV1 } from "./study-identity.js";
import {
  createVideoCatalogueContribution,
  createVideoCatalogueContributionV1,
  projectVideoDisplayGeometry,
  projectVideoDisplayGeometryV1,
  validateVideoCatalogueContribution,
  validateVideoCatalogueContributionV1,
} from "./video-catalogue-contribution.js";

export const WORKSPACE_CONTRIBUTION_SCHEMA = "affect-research-workspace-contribution";
export const WORKSPACE_CONTRIBUTION_VERSION = 1;
export const WORKSPACE_CONTRIBUTION_CURRENT_VERSION = 2;
export const WORKSPACE_RELATIVE_LAYOUT_V1 = Object.freeze({
  assetRoot: "assets",
  videoLibrary: "assets/stimuli",
  projectFile: "experiment.package.json",
});

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    throw new TypeError(`${label} has unexpected or missing fields.`);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function createWorkspaceContributionV1({ study, videoCatalogue } = {}) {
  const normalizedStudy = validateStudyIdentityV1(study);
  if (!videoCatalogue || typeof videoCatalogue !== "object" || Array.isArray(videoCatalogue)) {
    throw new TypeError("Workspace contribution requires one accepted video catalogue.");
  }
  return deepFreeze({
    schema: WORKSPACE_CONTRIBUTION_SCHEMA,
    version: WORKSPACE_CONTRIBUTION_VERSION,
    study: normalizedStudy,
    workspaceLayout: { ...WORKSPACE_RELATIVE_LAYOUT_V1 },
    videoCatalogue: structuredClone(videoCatalogue),
  });
}

export async function validateWorkspaceContributionV1(value) {
  exactObject(value, ["schema", "version", "study", "workspaceLayout", "videoCatalogue"], "Workspace contribution");
  if (value.schema !== WORKSPACE_CONTRIBUTION_SCHEMA || value.version !== WORKSPACE_CONTRIBUTION_VERSION) {
    throw new TypeError("Workspace contribution schema/version is unsupported.");
  }
  exactObject(value.workspaceLayout, ["assetRoot", "videoLibrary", "projectFile"], "Workspace relative layout");
  if (canonicalJson(value.workspaceLayout) !== canonicalJson(WORKSPACE_RELATIVE_LAYOUT_V1)) {
    throw new TypeError("Workspace relative layout is unsupported.");
  }
  const videoCatalogue = await validateVideoCatalogueContributionV1(value.videoCatalogue);
  const expected = createWorkspaceContributionV1({
    study: validateStudyIdentityV1(value.study),
    videoCatalogue,
  });
  if (canonicalJson(expected) !== canonicalJson(value)) {
    throw new TypeError("Workspace contribution is noncanonical.");
  }
  return expected;
}

export function createWorkspaceContribution({ study, videoCatalogue } = {}) {
  const normalizedStudy = validateStudyIdentityV1(study);
  if (!videoCatalogue || typeof videoCatalogue !== "object" || Array.isArray(videoCatalogue)
    || videoCatalogue.version !== 2) {
    throw new TypeError("Current workspace contribution requires one accepted v2 video catalogue.");
  }
  return deepFreeze({
    schema: WORKSPACE_CONTRIBUTION_SCHEMA,
    version: WORKSPACE_CONTRIBUTION_CURRENT_VERSION,
    study: normalizedStudy,
    workspaceLayout: { ...WORKSPACE_RELATIVE_LAYOUT_V1 },
    videoCatalogue: structuredClone(videoCatalogue),
  });
}

export async function validateWorkspaceContribution(value) {
  if (value?.schema !== WORKSPACE_CONTRIBUTION_SCHEMA) {
    throw new TypeError("Workspace contribution schema is unsupported.");
  }
  if (value.version === WORKSPACE_CONTRIBUTION_VERSION) return validateWorkspaceContributionV1(value);
  exactObject(value, ["schema", "version", "study", "workspaceLayout", "videoCatalogue"], "Workspace contribution");
  if (value.version !== WORKSPACE_CONTRIBUTION_CURRENT_VERSION) {
    throw new TypeError("Workspace contribution schema/version is unsupported.");
  }
  exactObject(value.workspaceLayout, ["assetRoot", "videoLibrary", "projectFile"], "Workspace relative layout");
  if (canonicalJson(value.workspaceLayout) !== canonicalJson(WORKSPACE_RELATIVE_LAYOUT_V1)) {
    throw new TypeError("Workspace relative layout is unsupported.");
  }
  const videoCatalogue = await validateVideoCatalogueContribution(value.videoCatalogue);
  if (videoCatalogue.version !== 2) {
    throw new TypeError("Workspace v2 must embed video catalogue v2.");
  }
  const expected = createWorkspaceContribution({
    study: validateStudyIdentityV1(value.study),
    videoCatalogue,
  });
  if (canonicalJson(expected) !== canonicalJson(value)) {
    throw new TypeError("Workspace contribution is noncanonical.");
  }
  return expected;
}

function validateSnapshotShape(value, label) {
  exactObject(value, ["revision", "enabled", "pending", "contribution", "dependencyRevisions"], `${label} snapshot`);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0
    || typeof value.enabled !== "boolean" || typeof value.pending !== "boolean"
    || !Array.isArray(value.dependencyRevisions)
    || value.dependencyRevisions.length !== 0) {
    throw new TypeError(`${label} snapshot is malformed.`);
  }
  return value;
}

/**
 * Restore only portable authored content. Physical directory permission and
 * file handles are deliberately absent and must be reacquired by the shell.
 */
export async function prepareWorkspaceContentRestoreV1(value) {
  const contribution = await validateWorkspaceContributionV1(value);
  return deepFreeze({
    study: structuredClone(contribution.study),
    workspaceLayout: structuredClone(contribution.workspaceLayout),
    videoDeclarations: contribution.videoCatalogue.entries.map((entry) => ({
      assetId: entry.assetId,
      annotationId: entry.annotationId,
      sourceRelativePath: entry.sourceRelativePath,
    })),
    requiresVideoLibraryRebind: true,
  });
}

export async function prepareWorkspaceContentRestore(value) {
  const contribution = await validateWorkspaceContribution(value);
  return deepFreeze({
    study: structuredClone(contribution.study),
    workspaceLayout: structuredClone(contribution.workspaceLayout),
    videoDeclarations: contribution.videoCatalogue.entries.map((entry) => ({
      assetId: entry.assetId,
      annotationId: entry.annotationId,
      sourceRelativePath: entry.sourceRelativePath,
    })),
    requiresVideoLibraryRebind: true,
  });
}

/**
 * A newly selected directory resolves restored declarations only when every
 * freshly hashed and decoder-probed entry is exactly the saved catalogue.
 */
export async function verifyWorkspaceRestoredVideoEntriesV1(value, entries) {
  const contribution = await validateWorkspaceContributionV1(value);
  const observed = await createVideoCatalogueContributionV1({
    revision: contribution.videoCatalogue.revision,
    entries,
  });
  if (canonicalJson(observed) !== canonicalJson(contribution.videoCatalogue)) {
    throw new TypeError("Selected workspace videos do not match the restored catalogue declarations.");
  }
  return contribution.videoCatalogue;
}

export async function verifyWorkspaceRestoredVideoEntries(value, entries) {
  const contribution = await validateWorkspaceContribution(value);
  const observed = contribution.videoCatalogue.version === 1
    ? await createVideoCatalogueContributionV1({
      revision: contribution.videoCatalogue.revision,
      entries,
    })
    : await createVideoCatalogueContribution({
      revision: contribution.videoCatalogue.revision,
      entries,
    });
  if (canonicalJson(observed) !== canonicalJson(contribution.videoCatalogue)) {
    throw new TypeError("Selected workspace videos do not match the restored catalogue declarations.");
  }
  return contribution.videoCatalogue;
}

/** Sync projection only for the P1 producer's own already-validated snapshot. */
export function projectVideoCatalogueSnapshotV1(workspaceSnapshot) {
  validateSnapshotShape(workspaceSnapshot, "Workspace");
  return Object.freeze({
    revision: workspaceSnapshot.revision,
    enabled: workspaceSnapshot.enabled,
    pending: workspaceSnapshot.pending,
    contribution: workspaceSnapshot.contribution?.videoCatalogue ?? null,
    dependencyRevisions: [],
  });
}

/** Public consumer projection: validates one registered P1 snapshot first. */
export async function projectWorkspaceVideoCatalogueSnapshotV1(workspaceSnapshot) {
  validateSnapshotShape(workspaceSnapshot, "Workspace");
  if (!workspaceSnapshot.enabled || workspaceSnapshot.pending || workspaceSnapshot.contribution === null) {
    return Object.freeze({
      revision: workspaceSnapshot.revision,
      enabled: workspaceSnapshot.enabled,
      pending: true,
      contribution: null,
      dependencyRevisions: [],
    });
  }
  const contribution = await validateWorkspaceContributionV1(workspaceSnapshot.contribution);
  return Object.freeze({
    revision: workspaceSnapshot.revision,
    enabled: true,
    pending: false,
    contribution: contribution.videoCatalogue,
    dependencyRevisions: [],
  });
}

/** P4/P6 projection with the same registered P1 owner revision. */
export async function projectWorkspaceVideoDisplayGeometryV1(workspaceSnapshot) {
  const projected = await projectWorkspaceVideoCatalogueSnapshotV1(workspaceSnapshot);
  if (!projected.enabled || projected.pending || !projected.contribution) {
    return Object.freeze({ revision: projected.revision, pending: true, videos: Object.freeze([]) });
  }
  const geometry = await projectVideoDisplayGeometryV1(projected.contribution);
  return Object.freeze({
    revision: projected.revision,
    pending: false,
    videos: geometry.videos,
  });
}

export async function projectWorkspaceVideoCatalogueSnapshot(workspaceSnapshot) {
  validateSnapshotShape(workspaceSnapshot, "Workspace");
  if (!workspaceSnapshot.enabled || workspaceSnapshot.pending || workspaceSnapshot.contribution === null) {
    return Object.freeze({
      revision: workspaceSnapshot.revision,
      enabled: workspaceSnapshot.enabled,
      pending: true,
      contribution: null,
      dependencyRevisions: [],
    });
  }
  const contribution = await validateWorkspaceContribution(workspaceSnapshot.contribution);
  return Object.freeze({
    revision: workspaceSnapshot.revision,
    enabled: true,
    pending: false,
    contribution: contribution.videoCatalogue,
    dependencyRevisions: [],
  });
}

export async function projectWorkspaceVideoDisplayGeometry(workspaceSnapshot) {
  const projected = await projectWorkspaceVideoCatalogueSnapshot(workspaceSnapshot);
  if (!projected.enabled || projected.pending || !projected.contribution) {
    return Object.freeze({ revision: projected.revision, pending: true, videos: Object.freeze([]) });
  }
  const geometry = await projectVideoDisplayGeometry(projected.contribution);
  return Object.freeze({ revision: projected.revision, pending: false, videos: geometry.videos });
}

/** One P1 revision domain for the composite registry and all catalogue consumers. */
export function createWorkspaceContributionProducerV1({
  getStudyIdentity,
  getVideoCatalogueSnapshot,
  onChange = () => {},
} = {}) {
  if (typeof getStudyIdentity !== "function" || typeof getVideoCatalogueSnapshot !== "function"
    || typeof onChange !== "function") {
    throw new TypeError("Workspace contribution producer inputs are malformed.");
  }
  const listeners = new Set([onChange]);
  let fingerprint = null;
  let revision = 0;
  let snapshot = null;
  let publishedSnapshot = null;

  function read() {
    let contribution = null;
    let pending = true;
    const videoSnapshot = getVideoCatalogueSnapshot();
    try {
      if (videoSnapshot.enabled && !videoSnapshot.pending && videoSnapshot.contribution) {
        contribution = createWorkspaceContributionV1({
          study: getStudyIdentity(),
          videoCatalogue: videoSnapshot.contribution,
        });
        pending = false;
      }
    } catch { /* An invalid owned input remains pending. */ }
    const nextFingerprint = canonicalJson({ pending, contribution });
    if (nextFingerprint !== fingerprint) {
      fingerprint = nextFingerprint;
      revision += 1;
    }
    snapshot = Object.freeze({ revision, enabled: true, pending, contribution, dependencyRevisions: [] });
    if (publishedSnapshot === null) publishedSnapshot = snapshot;
    return snapshot;
  }

  function changed() {
    const hadSnapshot = snapshot !== null;
    const next = read();
    if (!hadSnapshot || canonicalJson(publishedSnapshot) !== canonicalJson(next)) {
      publishedSnapshot = next;
      for (const listener of listeners) listener(next);
    }
    return next;
  }

  return Object.freeze({
    getSnapshot: read,
    getVideoCatalogueSnapshot: () => projectVideoCatalogueSnapshotV1(read()),
    changed,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Workspace contribution listener must be a function.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

export function createWorkspaceContributionProducer({
  getStudyIdentity,
  getVideoCatalogueSnapshot,
  onChange = () => {},
} = {}) {
  if (typeof getStudyIdentity !== "function" || typeof getVideoCatalogueSnapshot !== "function"
    || typeof onChange !== "function") {
    throw new TypeError("Workspace contribution producer inputs are malformed.");
  }
  const listeners = new Set([onChange]);
  let fingerprint = null;
  let revision = 0;
  let snapshot = null;
  let publishedSnapshot = null;

  function read() {
    let contribution = null;
    let pending = true;
    const videoSnapshot = getVideoCatalogueSnapshot();
    try {
      if (videoSnapshot.enabled && !videoSnapshot.pending && videoSnapshot.contribution) {
        contribution = videoSnapshot.contribution.version === 1
          ? createWorkspaceContributionV1({
            study: getStudyIdentity(), videoCatalogue: videoSnapshot.contribution,
          })
          : createWorkspaceContribution({
            study: getStudyIdentity(), videoCatalogue: videoSnapshot.contribution,
          });
        pending = false;
      }
    } catch { /* An invalid owned input remains pending. */ }
    const nextFingerprint = canonicalJson({ pending, contribution });
    if (nextFingerprint !== fingerprint) {
      fingerprint = nextFingerprint;
      revision += 1;
    }
    snapshot = Object.freeze({ revision, enabled: true, pending, contribution, dependencyRevisions: [] });
    if (publishedSnapshot === null) publishedSnapshot = snapshot;
    return snapshot;
  }

  function changed() {
    const hadSnapshot = snapshot !== null;
    const next = read();
    if (!hadSnapshot || canonicalJson(publishedSnapshot) !== canonicalJson(next)) {
      publishedSnapshot = next;
      for (const listener of listeners) listener(next);
    }
    return next;
  }

  return Object.freeze({
    getSnapshot: read,
    getVideoCatalogueSnapshot: () => projectVideoCatalogueSnapshotV1(read()),
    changed,
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Workspace contribution listener must be a function.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
