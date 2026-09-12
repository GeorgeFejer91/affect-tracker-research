import { canonicalJson } from "./canonical.js";
import { validateStudyIdentityV1 } from "./study-identity.js";
import { validateVideoCatalogueContributionV1 } from "./video-catalogue-contribution.js";

export const WORKSPACE_CONTRIBUTION_SCHEMA = "affect-research-workspace-contribution";
export const WORKSPACE_CONTRIBUTION_VERSION = 1;
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
