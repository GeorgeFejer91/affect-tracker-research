import { canonicalJson } from "./canonical.js";
import { validatePlannerContributionSnapshot } from "./planner-contributions.js";
import { resolveFeedbackEnvelope } from "./feedback-layout.js";
import { validateFeedbackContribution } from "./feedback-settings.js";
import { XR_FEEDBACK_VIEWPORT_CSS_PX } from "./xr-layout-feedback.js";
import { XrLayoutError, validateXrLayoutProfileV1 } from "./xr-layout.js";
import { resolveXrLayoutContribution, validateXrLayoutSelection } from "./xr-layout-recipe.js";
export { resolveXrLayoutContribution } from "./xr-layout-recipe.js";

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
  const feedback = validateFeedbackContribution(p5.contribution);
  const feedbackEnvelope = resolveFeedbackEnvelope(feedback, XR_FEEDBACK_VIEWPORT_CSS_PX);
  const projection = await projectCatalogue(p1);
  if (!projection || projection.revision !== p1.revision || projection.pending !== false
    || !Array.isArray(projection.videos) || projection.videos.length === 0) {
    throw new XrLayoutError("dependencies", "media-missing", "Add and verify at least one video before accepting the XR experiment layout.");
  }
  return { catalogueRevision: p1.revision, feedbackRevision: p5.revision,
    catalogueGeometry: structuredClone(projection.videos), feedbackEnvelope };
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

  async function prepare({ isCurrent = () => true } = {}) {
    if (disposed || !isCurrent()) throw stale();
    if (!editor.getSnapshot().enabled) return editor.getSnapshot();
    // Domain preparation is separate from P7 session acceptance and file save.
    // The master target is independently required by the P7 validator.
    const profile = editor.getDraft();
    return commit(profile, { selectedTarget: profile.target, isCurrent }, false);
  }

  function prepareRestoreSelection(selection, { isCurrent } = {}) {
    if (typeof isCurrent !== "function") throw new TypeError("XR selection restore requires a current-request guard.");
    const captured = validateXrLayoutSelection(selection);
    if (disposed || !isCurrent()) throw stale();
    const dependencyKey = key(read()), capturedGeneration = generation;
    const current = () => !disposed && isCurrent() && generation === capturedGeneration && key(read()) === dependencyKey;
    // Reopening authored content needs no ready media. Do not refresh here:
    // refresh mutates dependency state and publishes projections.
    const candidate = editor.prepareRestoreSelection(captured, { isCurrent: current });
    return Object.freeze({
      isCurrent: () => current() && candidate.isCurrent(),
      commit() {
        if (!current() || !candidate.isCurrent()) throw stale();
        return candidate.commit();
      },
      afterCommit() {
        if (!current()) throw stale();
        return candidate.afterCommit();
      },
    });
  }

  async function prepareConfirmation({ isCurrent, signal } = {}) {
    if (typeof isCurrent !== "function") throw new TypeError("XR confirmation requires a current-request guard.");
    const captured = read(), dependencyKey = key(captured), capturedGeneration = generation;
    const ownerRevision = editor.getSnapshot().revision;
    const current = () => !disposed && !signal?.aborted && isCurrent()
      && generation === capturedGeneration && key(read()) === dependencyKey;
    if (!current()) throw stale();
    if (editor.getSnapshot().enabled) {
      const profile = editor.getDraft();
      const resolved = await resolveXrLayoutDependencies(captured, projectCatalogue);
      resolveXrLayoutContribution(profile, resolved, profile.target);
      const bound = editor.getAuthoringSnapshot();
      if (key(bound.dependencyRevisions) !== key([
        { segment: "P1", revision: resolved.catalogueRevision },
        { segment: "P5", revision: resolved.feedbackRevision },
      ]) || key(bound.catalogueGeometry) !== key(resolved.catalogueGeometry)
        || key(bound.feedbackEnvelope) !== key(resolved.feedbackEnvelope)) throw stale();
    }
    // Unlike GUI prepare(), never refresh/mutate producers or the editor here.
    if (!current() || editor.getSnapshot().revision !== ownerRevision) throw stale();
    const candidate = editor.prepareConfirmation({ isCurrent: current, signal });
    return Object.freeze({
      get snapshot() { return candidate.snapshot; },
      isCurrent: candidate.isCurrent,
      commit: candidate.commit,
      afterCommit: candidate.afterCommit,
    });
  }

  return Object.freeze({
    refresh,
    getStatus: () => structuredClone(status),
    validate,
    prepare,
    prepareConfirmation,
    accept: prepare,
    prepareRestoreSelection,
    restoreDraft(profile, { isCurrent = () => true } = {}) {
      const capturedProfile = validateXrLayoutProfileV1(profile);
      if (disposed || !isCurrent()) throw stale();
      return editor.restoreDraft(capturedProfile);
    },
    restoreSelection(selection, { isCurrent } = {}) {
      const candidate = prepareRestoreSelection(selection, { isCurrent });
      const snapshot = candidate.commit(); candidate.afterCommit(); return snapshot;
    },
    restore(profile, options = {}) { return commit(profile, options, true); },
    destroy() {
      disposed = true; generation += 1;
      for (const remove of unsubscribe) remove();
    },
  });
}
