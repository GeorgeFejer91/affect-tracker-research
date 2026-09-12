import { canonicalJson } from "./canonical.js";
import { validateQuestionnairePlannerContribution } from "./questionnaire-contribution.js";

export const PLANNER_SEGMENTS = Object.freeze(["P1", "P2", "P3", "P4", "P5", "P6"]);
export const PLANNER_SEGMENT_SECTIONS = Object.freeze({
  P1: "workspace", P2: "questionnaires", P3: "stimuli",
  P4: "layout", P5: "feedback", P6: "xr",
});
const SNAPSHOT_KEYS = ["revision", "enabled", "pending", "contribution", "dependencyRevisions"];
const MAX_CONTRIBUTION_BYTES = 5 * 1024 * 1024;

/** Bind available producer APIs only after the complete UI controller exists.
 * P3/P6 are successor contributions: registering them deliberately supplies no
 * v1 inclusion adapter. P2 retains its exact existing package representation. */
export function registerAvailablePlannerContributions(controller) {
  const unregister = [];
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    const failures = [];
    for (const remove of unregister.splice(0).reverse()) {
      try { remove(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Planner owner cleanup failed.");
  };
  try {
  if (typeof controller.getQuestionnaireContributionSnapshot === "function") {
    unregister.push(controller.registerPlannerContribution("P2",
      () => controller.getQuestionnaireContributionSnapshot(), {
        validateContribution: validateQuestionnairePlannerContribution,
        validatePackageV1: (pkg, contribution) => canonicalJson(contribution) === canonicalJson({
          questionnaires: pkg.settings.questionnaires, languageSelection: pkg.languageSelection,
        }),
      }));
  }
  for (const [segment, getter, validator, subscription] of [
    ["P1", "getWorkspaceContributionSnapshot", "validateWorkspaceContribution", "subscribeWorkspaceContributionChanges"],
    ["P3", "getStimulusOrderSnapshot", "validateStimulusVariantContribution"],
    ["P4", "getScreenLayoutContributionSnapshot", "validateScreenLayoutContribution"],
    ["P5", "getFeedbackContributionSnapshot", "validateFeedbackContribution", "subscribeFeedbackChanges"],
    ["P6", "getXrLayoutContribution", "validateXrLayoutContribution"],
  ]) {
    if (typeof controller[getter] === "function") {
      unregister.push(controller.registerPlannerContribution(segment, () => controller[getter](), {
        validateContribution: typeof controller[validator] === "function" ? async (value, context) => {
          const result = await controller[validator](value, context);
          if (result !== true && (!result || typeof result !== "object")) throw new TypeError(`${segment}: contribution validation failed.`);
          return true;
        } : null,
      }));
      if (subscription && typeof controller[subscription] === "function") {
        const remove = controller[subscription](() => { if (!disposed) controller.plannerContributionChanged(segment); });
        if (typeof remove !== "function") throw new TypeError(`${segment}: subscriptions must return an unsubscribe function.`);
        unregister.push(remove);
      }
    }
  }
  }
  catch (error) { try { cleanup(); } catch { /* Preserve initialization failure. */ } throw error; }
  return cleanup;
}

/** Preserve live getter descriptors while ensuring subscriptions are removed
 * before producer teardown. Failed initialization and repeated destroy are safe. */
export function installPlannerContributions(root, controller) {
  let cleanup = () => {};
  let disposed = false;
  const descriptors = Object.getOwnPropertyDescriptors(controller);
  descriptors.destroy = { enumerable: true, value() {
    if (disposed) return;
    disposed = true;
    try { cleanup(); } finally {
      try { controller.destroy(); } finally { if (root.researchUi === managed) delete root.researchUi; }
    }
  } };
  const managed = Object.freeze(Object.defineProperties({}, descriptors));
  root.researchUi = managed;
  try { cleanup = registerAvailablePlannerContributions(managed); }
  catch (error) { try { managed.destroy(); } catch { /* Preserve initialization failure. */ } throw error; }
  return managed;
}

function segmentId(segment) {
  if (!PLANNER_SEGMENTS.includes(segment)) throw new TypeError("Unknown Planner contribution owner.");
  return segment;
}

/** This internal handoff is not a serialized recipe or a validator for payload
 * semantics. Each producer retains its closed domain validator and restoration. */
export function validatePlannerContributionSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).length !== SNAPSHOT_KEYS.length
    || SNAPSHOT_KEYS.some((key) => !Object.hasOwn(input, key))
    || !Number.isSafeInteger(input.revision) || input.revision < 0
    || typeof input.enabled !== "boolean" || typeof input.pending !== "boolean"
    || !Array.isArray(input.dependencyRevisions) || input.dependencyRevisions.length > 5
    || (input.contribution !== null && (typeof input.contribution !== "object" || Array.isArray(input.contribution)))) {
    throw new TypeError("Invalid Planner contribution snapshot.");
  }
  const dependencies = new Set();
  for (const dependency of input.dependencyRevisions) {
    if (!dependency || Object.keys(dependency).length !== 2
      || !Object.hasOwn(dependency, "segment") || !Object.hasOwn(dependency, "revision")
      || !Number.isSafeInteger(dependency.revision) || dependency.revision < 0
      || dependencies.has(segmentId(dependency.segment))) {
      throw new TypeError("Invalid Planner dependency revision.");
    }
    dependencies.add(dependency.segment);
  }
  const serialized = canonicalJson(input);
  if (new TextEncoder().encode(serialized).byteLength > MAX_CONTRIBUTION_BYTES) {
    throw new RangeError("Planner contribution exceeds the bounded handoff size.");
  }
  return JSON.parse(serialized);
}

export function createPlannerContributionRegistry({ onChange = () => {} } = {}) {
  const owners = new Map();
  const accepted = new Map();
  const accepting = new Map();
  let acceptanceSequence = 0;
  const notify = () => onChange();
  // Exclusions bind the explicit disabled choice, not an optional preview's
  // unsaved camera/draft revisions. Enabled contributions bind every field.
  const identityOf = (snapshot) => snapshot.enabled ? canonicalJson(snapshot) : "excluded";
  function read({ format = "package-v1" } = {}) {
    const snapshots = [];
    const issues = [];
    const issue = (segment, code, message) => issues.push(Object.freeze({ segment, code, message }));
    for (const segment of PLANNER_SEGMENTS) {
      const owner = owners.get(segment);
      if (!owner) continue;
      try {
        const snapshot = validatePlannerContributionSnapshot(owner.getSnapshot());
        const observation = canonicalJson(snapshot);
        if (owner.observation !== observation) { owner.observation = observation; owner.epoch += 1; }
        const identity = canonicalJson({ enabled: snapshot.enabled, contribution: snapshot.contribution, dependencyRevisions: snapshot.dependencyRevisions });
        if (owner.previous && (snapshot.revision < owner.previous.revision
          || (snapshot.revision === owner.previous.revision && identity !== owner.previous.identity))) {
          throw new TypeError("Contribution revision did not advance.");
        }
        owner.previous = { revision: snapshot.revision, identity };
        snapshots.push({ segment, ...snapshot });
        if (!snapshot.enabled) continue;
        if (snapshot.pending || snapshot.contribution === null) {
          issue(segment, "contribution-pending", `${segment}: accept the current edits before exporting.`);
        }
        if (format === "package-v1" && typeof owner.validatePackageV1 !== "function") {
          issue(segment, "successor-required", `${segment}: this active contribution requires a successor recipe contract; v1 cannot include it.`);
        }
      } catch {
        owner.epoch += 1;
        issue(segment, "contribution-invalid", `${segment}: its contribution or revision is invalid. Reopen the owning editor.`);
      }
    }
    for (const snapshot of snapshots.filter(({ enabled }) => enabled)) {
      for (const dependency of snapshot.dependencyRevisions) {
        const producer = snapshots.find(({ segment }) => segment === dependency.segment);
        if (dependency.segment === snapshot.segment || !producer?.enabled || producer.pending
          || producer.contribution === null || producer.revision !== dependency.revision) {
          issue(snapshot.segment, "dependency-stale", `${snapshot.segment}: review its dependency on ${dependency.segment}; the accepted revision is unavailable or changed.`);
        }
      }
    }
    const active = snapshots.filter(({ enabled }) => enabled);
    const visiting = new Set();
    const visited = new Set();
    function visit(segment) {
      if (visiting.has(segment)) { issue(segment, "dependency-cycle", `${segment}: contribution dependencies contain a cycle.`); return; }
      if (visited.has(segment)) return;
      visiting.add(segment);
      for (const dependency of active.find((entry) => entry.segment === segment)?.dependencyRevisions ?? []) visit(dependency.segment);
      visiting.delete(segment);
      visited.add(segment);
    }
    for (const snapshot of active) visit(snapshot.segment);
    // An invalid upstream producer also invalidates all of its consumers,
    // including a transitive chain whose numeric revisions still match.
    for (let pass = 0; pass < PLANNER_SEGMENTS.length; pass += 1) {
      for (const snapshot of active) {
        if (issues.some((entry) => entry.segment === snapshot.segment && entry.code === "dependency-stale")) continue;
        const invalid = snapshot.dependencyRevisions.find(({ segment }) => issues.some((entry) => entry.segment === segment && entry.code !== "successor-required"));
        if (invalid) issue(snapshot.segment, "dependency-stale", `${snapshot.segment}: its dependency on ${invalid.segment} is invalid.`);
      }
    }
    for (const [segment, receipt] of accepted) {
      const snapshot = snapshots.find((entry) => entry.segment === segment);
      if (!snapshot || owners.get(segment) !== receipt.owner
        || identityOf(snapshot) !== receipt.identity
        || issues.some((entry) => entry.segment === segment && entry.code !== "successor-required")
        || receipt.dependencies.some(([dependency, identity]) => {
          const current = snapshots.find((entry) => entry.segment === dependency);
          return !current || identityOf(current) !== identity;
        })) receipt.stale = true;
    }
    return Object.freeze({ snapshots, issues: Object.freeze(issues), fingerprint: canonicalJson({ snapshots: active, issues }) });
  }
  function requiredIds(segments) {
    if (!Array.isArray(segments) || new Set(segments).size !== segments.length) throw new TypeError("Required Planner segments must be unique.");
    return segments.map(segmentId);
  }
  function readAccepted({ requiredSegments = PLANNER_SEGMENTS.slice(0, 5) } = {}) {
    const required = requiredIds(requiredSegments);
    const current = read({ format: "contributions" });
    const issues = [...current.issues];
    const entries = PLANNER_SEGMENTS.filter((segment) => required.includes(segment) || owners.has(segment)).map((segment) => {
      const snapshot = current.snapshots.find((entry) => entry.segment === segment);
      const receipt = accepted.get(segment);
      let status = "missing";
      if (issues.some((entry) => entry.segment === segment)) status = "invalid";
      else if (receipt?.stale) status = "stale";
      else if (receipt) status = snapshot.enabled ? "accepted" : "excluded";
      if (required.includes(segment) && snapshot?.enabled === false) status = "invalid";
      if (status !== "accepted" && status !== "excluded") issues.push({ segment, code: `acceptance-${status}`, message: `${segment}: ${status === "missing" ? "confirm its validated contribution" : "review and confirm its current contribution"} before saving.` });
      return { segment, status, revision: snapshot?.revision ?? null, acceptedRevision: receipt?.snapshot.revision ?? null };
    });
    const snapshots = entries.filter(({ status }) => status === "accepted").map(({ segment }) => structuredClone(accepted.get(segment).snapshot));
    return Object.freeze({ entries, snapshots, issues, fingerprint: canonicalJson({ entries, snapshots, issues }) });
  }
  function validationContext(current, snapshot, selectedTarget) {
    const dependencies = {};
    const collect = (entry) => {
      for (const { segment } of entry.dependencyRevisions) {
        if (Object.hasOwn(dependencies, segment)) continue;
        const dependency = current.snapshots.find((value) => value.segment === segment);
        if (!dependency) throw new TypeError(`${snapshot.segment}: a dependency is unavailable.`);
        const { segment: ownerId, ...value } = dependency;
        dependencies[ownerId] = structuredClone(value);
        collect(dependency);
      }
    };
    collect(snapshot);
    return { dependencies, selectedTarget };
  }
  return Object.freeze({
    register(segment, getSnapshot, { validatePackageV1 = null, validateContribution = null } = {}) {
      segmentId(segment);
      if (owners.has(segment) || typeof getSnapshot !== "function"
        || (validatePackageV1 !== null && typeof validatePackageV1 !== "function")
        || (validateContribution !== null && typeof validateContribution !== "function")) {
        throw new TypeError("Each Planner segment requires one contribution owner.");
      }
      const owner = { getSnapshot, validatePackageV1, validateContribution, previous: null, observation: null, epoch: 0 };
      owners.set(segment, owner);
      notify();
      return () => { if (owners.get(segment) === owner) { owners.delete(segment); if (accepted.has(segment)) accepted.get(segment).stale = true; accepting.delete(segment); notify(); } };
    },
    changed(segment) { segmentId(segment); if (!owners.has(segment)) throw new TypeError("Planner owner is not registered."); read({ format: "contributions" }); notify(); },
    read,
    readAccepted,
    async accept(segment, { selectedTarget = null } = {}) {
      segmentId(segment);
      const owner = owners.get(segment);
      if (!owner) throw new TypeError(`${segment}: its contribution owner is unavailable.`);
      const before = read({ format: "contributions" });
      const problem = before.issues.find((entry) => entry.segment === segment);
      if (problem) throw new TypeError(problem.message);
      const snapshot = before.snapshots.find((entry) => entry.segment === segment);
      const context = validationContext(before, snapshot, selectedTarget);
      const identity = identityOf(snapshot);
      const dependencies = Object.entries(context.dependencies).map(([id, value]) => [id, identityOf({ segment: id, ...value })]);
      const epochs = [[segment, owner.epoch], ...dependencies.map(([id]) => [id, owners.get(id).epoch])];
      const sequence = ++acceptanceSequence;
      accepting.set(segment, sequence);
      try {
        if (snapshot.enabled) {
          if (typeof owner.validateContribution !== "function") throw new TypeError(`${segment}: its domain validator is unavailable.`);
          if (await owner.validateContribution(structuredClone(snapshot.contribution), context) !== true) throw new TypeError(`${segment}: its contribution validation failed.`);
        }
        const after = read({ format: "contributions" });
        const latest = after.snapshots.find((entry) => entry.segment === segment);
        if (accepting.get(segment) !== sequence || owners.get(segment) !== owner || !latest
          || epochs.some(([id, epoch]) => owners.get(id)?.epoch !== epoch)
          || identityOf(latest) !== identity || after.issues.some((entry) => entry.segment === segment)
          || dependencies.some(([id, value]) => {
            const dependency = after.snapshots.find((entry) => entry.segment === id);
            return !dependency || identityOf(dependency) !== value;
          })) throw new TypeError(`${segment}: its contribution changed during confirmation.`);
        accepted.set(segment, { owner, snapshot: structuredClone(snapshot), identity, dependencies, stale: false });
        notify();
        return structuredClone(snapshot);
      } finally { if (accepting.get(segment) === sequence) accepting.delete(segment); }
    },
    clearAcceptance() { accepted.clear(); accepting.clear(); notify(); },
    invalidateAcceptance(segment) {
      segmentId(segment);
      const receipt = accepted.get(segment);
      if (receipt?.snapshot.enabled) receipt.stale = true;
      accepting.delete(segment);
      notify();
    },
    assertAccepted(options) {
      const review = readAccepted(options);
      if (review.issues.length) throw new TypeError(review.issues[0].message);
      return structuredClone(review);
    },
    async assertPackageV1(packageValue = null) {
      const before = read();
      if (before.issues.length) throw new TypeError(before.issues[0].message);
      if (packageValue !== null) {
        for (const snapshot of before.snapshots.filter(({ enabled }) => enabled)) {
          const accepted = await owners.get(snapshot.segment).validatePackageV1(packageValue, snapshot.contribution);
          if (accepted !== true) throw new TypeError(`${snapshot.segment}: the compiled package does not include its accepted contribution.`);
        }
      }
      if (read().fingerprint !== before.fingerprint) throw new TypeError("Planner contributions changed during validation.");
      return before.fingerprint;
    },
  });
}
