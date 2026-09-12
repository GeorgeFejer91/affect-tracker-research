import { canonicalJson } from "./canonical.js";
import { validatePlannerContributionSnapshot } from "./planner-contributions.js";
import { resolveFeedbackEnvelopeV1 } from "./feedback-envelope.js";
import { validateInputBindingV1 } from "./contracts.js";
import { XR_FEEDBACK_VIEWPORT_CSS_PX, resolveXrFeedbackFootprintV1 } from "./xr-layout-feedback.js";
import { XR_TARGET_REQUIREMENTS, XrLayoutError, resolveXrCatalogueV1, validateXrLayoutProfileV1 } from "./xr-layout.js";

const EMPTY_DEPENDENCIES = Object.freeze({ catalogueRevision: null, feedbackRevision: null,
  catalogueGeometry: null, feedbackEnvelope: null });
const stale = () => new XrLayoutError("profile", "stale", "The video library, feedback or XR layout changed. Review the current layout again.");

function readySnapshot(value, segment) {
  let snapshot;
  try { snapshot = validatePlannerContributionSnapshot(value); }
  catch { throw new XrLayoutError("dependencies", "dependency-invalid", `Connect valid ${segment} settings before accepting the XR experiment layout.`); }
  if (!snapshot.enabled || snapshot.pending || snapshot.contribution === null) {
    throw new XrLayoutError("dependencies", "dependency-pending", `Finish the ${segment === "P1" ? "video library" : "feedback settings"} before accepting the XR experiment layout.`);
  }
  return snapshot;
}

/** The projector is P1's validator/projection, supplied once by composition.
 * It is never loaded from recipe data. Owner revisions and payload revisions
 * are distinct: dependencies always bind the former. */
export async function resolveXrLayoutDependencies(dependencies, projectCatalogue) {
  if (!dependencies || Object.keys(dependencies).sort().join(",") !== "P1,P5") {
    throw new XrLayoutError("dependencies", "dependency-missing", "The XR layout needs the current video library and feedback settings.");
  }
  if (typeof projectCatalogue !== "function") throw new TypeError("P1's geometry projector is required.");
  const p1 = readySnapshot(dependencies.P1, "P1"), p5 = readySnapshot(dependencies.P5, "P5");
  const feedback = p5.contribution;
  if (Object.keys(feedback).sort().join(",") !== "input,mappings,visual") throw new TypeError("P5 must supply its complete saved feedback contribution.");
  validateInputBindingV1(feedback.input);
  const feedbackEnvelope = resolveFeedbackEnvelopeV1(feedback, XR_FEEDBACK_VIEWPORT_CSS_PX);
  const projection = await projectCatalogue(p1.contribution);
  if (!projection || !Array.isArray(projection.videos) || projection.videos.length === 0) {
    throw new XrLayoutError("dependencies", "media-missing", "Add and verify at least one video before accepting the XR experiment layout.");
  }
  return { catalogueRevision: p1.revision, feedbackRevision: p5.revision,
    catalogueGeometry: structuredClone(projection.videos), feedbackEnvelope };
}

export function resolveXrLayoutContribution(profile, dependencies, selectedTarget) {
  const validated = validateXrLayoutProfileV1(profile);
  if (selectedTarget !== validated.target) {
    throw new XrLayoutError("target", "unsupported-target", "Select the compatible WebXR VR target for this XR layout. A desktop target cannot use it.");
  }
  return { profile: validated, requirements: { ...XR_TARGET_REQUIREMENTS },
    videos: resolveXrCatalogueV1(validated, dependencies.catalogueGeometry),
    feedback: resolveXrFeedbackFootprintV1(validated, dependencies.feedbackEnvelope) };
}

/** One P6 consumer of the two live producers. Subscription callbacks withdraw
 * accepted bounds synchronously, before any asynchronous catalogue validation.
 * No animation policy, catalogue authority or package persistence lives here. */
export function createXrLayoutAuthoring({ editor, getDependencies, subscribe, projectCatalogue }) {
  if (!editor || typeof getDependencies !== "function" || typeof projectCatalogue !== "function"
    || !Array.isArray(subscribe) || subscribe.some((fn) => typeof fn !== "function")) {
    throw new TypeError("P6 authoring requires its editor and explicit producer interfaces.");
  }
  let disposed = false, generation = 0, identity = null, operation = Promise.resolve();
  let status = { pending: true, issue: null };
  const read = () => structuredClone(getDependencies());
  const key = (value) => canonicalJson(value);
  function refresh() {
    if (disposed) return Promise.resolve();
    let dependencies, nextIdentity;
    try { dependencies = read(); nextIdentity = key(dependencies); }
    catch { dependencies = { P1: null, P5: null }; nextIdentity = "unavailable"; }
    if (nextIdentity === identity) return operation;
    identity = nextIdentity;
    const current = ++generation;
    status = { pending: true, issue: null };
    editor.setDependencies(EMPTY_DEPENDENCIES);
    operation = (async () => {
      try {
        const resolved = await resolveXrLayoutDependencies(dependencies, projectCatalogue);
        if (disposed || current !== generation) return;
        if (key(read()) !== nextIdentity) { identity = null; return refresh(); }
        editor.setDependencies(resolved);
        status = { pending: false, issue: null };
      } catch (error) {
        if (!disposed && current === generation) {
          status = { pending: true, issue: error instanceof XrLayoutError ? error.message
            : "The video or feedback settings could not be verified. Review their source settings." };
        }
      }
    })();
    return operation;
  }
  const unsubscribe = subscribe.map((listen) => listen(() => { void refresh(); }));
  void refresh();

  async function validate(profile, { dependencies = read(), selectedTarget } = {}) {
    if (disposed) throw stale();
    const capturedProfile = validateXrLayoutProfileV1(profile);
    const resolved = await resolveXrLayoutDependencies(dependencies, projectCatalogue);
    resolveXrLayoutContribution(capturedProfile, resolved, selectedTarget);
    return true;
  }

  async function commit(profile, { isCurrent = () => true, dependencies, selectedTarget }, restore) {
    const capturedProfile = validateXrLayoutProfileV1(profile);
    const ownerRevision = editor.getSnapshot().revision;
    await refresh();
    if (disposed || !isCurrent() || editor.getSnapshot().revision !== ownerRevision) throw stale();
    const captured = dependencies === undefined ? read() : structuredClone(dependencies);
    const dependencyKey = key(captured);
    if (key(read()) !== dependencyKey) throw stale();
    const resolved = await resolveXrLayoutDependencies(captured, projectCatalogue);
    resolveXrLayoutContribution(capturedProfile, resolved, selectedTarget);
    if (disposed || !isCurrent() || editor.getSnapshot().revision !== ownerRevision
      || key(read()) !== dependencyKey) throw stale();
    return restore ? editor.restoreContribution(capturedProfile, resolved) : editor.acceptLayout();
  }

  return Object.freeze({
    refresh,
    getStatus: () => structuredClone(status),
    validate,
    async accept() {
      if (disposed) throw stale();
      if (!editor.getSnapshot().enabled) return editor.getSnapshot();
      // Enabling the explicitly labelled WebXR profile selects its local target;
      // P7 separately validates the master recipe's selected target.
      const profile = editor.getDraft();
      return commit(profile, { selectedTarget: profile.target }, false);
    },
    restore(profile, options = {}) { return commit(profile, options, true); },
    destroy() {
      disposed = true; generation += 1;
      for (const remove of unsubscribe) remove();
    },
  });
}
