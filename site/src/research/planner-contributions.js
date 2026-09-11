import { canonicalJson } from "./canonical.js";

export const PLANNER_SEGMENTS = Object.freeze(["P1", "P2", "P3", "P4", "P5", "P6"]);
export const PLANNER_SEGMENT_SECTIONS = Object.freeze({
  P1: "workspace", P2: "questionnaires", P3: "stimuli",
  P4: "layout", P5: "feedback", P6: "xr-layout",
});
const SNAPSHOT_KEYS = ["revision", "enabled", "pending", "contribution", "dependencyRevisions"];
const MAX_CONTRIBUTION_BYTES = 5 * 1024 * 1024;

/** Bind available producer APIs only after the complete UI controller exists.
 * P3/P6 are successor contributions: registering them deliberately supplies no
 * v1 inclusion adapter. P2 retains its exact existing package representation. */
export function registerAvailablePlannerContributions(controller) {
  const unregister = [];
  if (typeof controller.getQuestionnaireContributionSnapshot === "function") {
    unregister.push(controller.registerPlannerContribution("P2",
      () => controller.getQuestionnaireContributionSnapshot(), {
        validatePackageV1: (pkg, contribution) => canonicalJson(contribution) === canonicalJson({
          questionnaires: pkg.settings.questionnaires, languageSelection: pkg.languageSelection,
        }),
      }));
  }
  for (const [segment, getter] of [["P3", "getStimulusOrderSnapshot"], ["P6", "getXrLayoutContribution"]]) {
    if (typeof controller[getter] === "function") {
      unregister.push(controller.registerPlannerContribution(segment, () => controller[getter]()));
    }
  }
  return () => { for (const remove of unregister) remove(); };
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
  const notify = () => onChange();
  function read() {
    const snapshots = [];
    const issues = [];
    const issue = (segment, code, message) => issues.push(Object.freeze({ segment, code, message }));
    for (const segment of PLANNER_SEGMENTS) {
      const owner = owners.get(segment);
      if (!owner) continue;
      try {
        const snapshot = validatePlannerContributionSnapshot(owner.getSnapshot());
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
        if (typeof owner.validatePackageV1 !== "function") {
          issue(segment, "successor-required", `${segment}: this active contribution requires a successor recipe contract; v1 cannot include it.`);
        }
      } catch {
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
    return Object.freeze({ snapshots, issues: Object.freeze(issues), fingerprint: canonicalJson({ snapshots: active, issues }) });
  }
  return Object.freeze({
    register(segment, getSnapshot, { validatePackageV1 = null } = {}) {
      segmentId(segment);
      if (owners.has(segment) || typeof getSnapshot !== "function"
        || (validatePackageV1 !== null && typeof validatePackageV1 !== "function")) {
        throw new TypeError("Each Planner segment requires one contribution owner.");
      }
      const owner = { getSnapshot, validatePackageV1, previous: null };
      owners.set(segment, owner);
      notify();
      return () => { if (owners.get(segment) === owner) { owners.delete(segment); notify(); } };
    },
    changed(segment) { segmentId(segment); if (!owners.has(segment)) throw new TypeError("Planner owner is not registered."); notify(); },
    read,
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
