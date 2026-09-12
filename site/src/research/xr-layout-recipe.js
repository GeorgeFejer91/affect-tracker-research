import { validateWorkspaceContributionV1 } from "./workspace-contribution.js";
import { projectVideoDisplayGeometryV1 } from "./video-catalogue-contribution.js";
import { validateFeedbackContribution } from "./feedback-settings.js";
import { resolveFeedbackEnvelope } from "./feedback-layout.js";
import { XR_FEEDBACK_VIEWPORT_CSS_PX, resolveXrFeedbackFootprintV1 } from "./xr-layout-feedback.js";
import { XR_TARGET_REQUIREMENTS, XrLayoutError, resolveXrCatalogueV1, validateXrLayoutProfileV1 } from "./xr-layout.js";

/** P7's explicit optional-profile union; exclusion carries no hidden draft. */
export function validateXrLayoutSelection(selection) {
  if (!selection || Object.getPrototypeOf(selection) !== Object.prototype) {
    throw new XrLayoutError("profile", "fields", "XR selection must be explicitly included or excluded.");
  }
  const keys = Object.keys(selection).sort().join(",");
  if (selection.status === "excluded" && keys === "status") return { status: "excluded" };
  if (selection.status === "included" && keys === "profile,status") {
    return { status: "included", profile: validateXrLayoutProfileV1(selection.profile) };
  }
  throw new XrLayoutError("profile", "fields", "XR selection requires an included profile or explicit exclusion with no profile.");
}

function checkedProfile(profile, selectedTarget) {
  const validated = validateXrLayoutProfileV1(profile);
  if (selectedTarget !== validated.target) {
    throw new XrLayoutError("target", "unsupported-target", "Select the compatible WebXR VR target for this XR layout. A desktop target cannot use it.");
  }
  return validated;
}

/** Pure geometry from already validated owner projections. No session state. */
export function resolveXrLayoutContribution(profile, dependencies, selectedTarget) {
  const validated = checkedProfile(profile, selectedTarget);
  return { profile: validated, requirements: { ...XR_TARGET_REQUIREMENTS },
    videos: resolveXrCatalogueV1(validated, dependencies.catalogueGeometry),
    feedback: resolveXrFeedbackFootprintV1(validated, dependencies.feedbackEnvelope) };
}

/** Saved content is independently validatable without pretending that any
 * workspace is currently authorized, any file is present or any owner is ready.
 * P7 owns the surrounding recipe, selection union and canonical serialization. */
export async function resolveSavedXrLayoutContribution(profile, {
  workspaceContribution, feedbackContribution, selectedTarget,
}) {
  const validated = checkedProfile(profile, selectedTarget);
  const savedWorkspace = structuredClone(workspaceContribution);
  const savedFeedback = validateFeedbackContribution(feedbackContribution);
  const workspace = await validateWorkspaceContributionV1(savedWorkspace);
  const projection = await projectVideoDisplayGeometryV1(workspace.videoCatalogue);
  if (projection.videos.length === 0) {
    throw new XrLayoutError("dependencies", "media-missing", "The XR experiment layout requires at least one declared video.");
  }
  return resolveXrLayoutContribution(validated, {
    catalogueGeometry: projection.videos,
    feedbackEnvelope: resolveFeedbackEnvelope(savedFeedback, XR_FEEDBACK_VIEWPORT_CSS_PX),
  }, selectedTarget);
}
