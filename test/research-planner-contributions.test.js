import test from "node:test";
import assert from "node:assert/strict";
import { createPlannerContributionRegistry, registerAvailablePlannerContributions, installPlannerContributions, validatePlannerContributionSnapshot } from "../site/src/research/planner-contributions.js";

const snapshot = (overrides = {}) => ({ revision: 0, enabled: true, pending: false,
  contribution: { accepted: "design" }, dependencyRevisions: [], ...overrides });
const included = { validatePackageV1: (pkg, contribution) => pkg.accepted === contribution.accepted };
const validated = { validateContribution: async () => true };

test("installed owners retain live getters and dispose subscriptions before producers exactly once", () => {
  const root = {}; let count = 1, callback; const events = [];
  const controller = Object.freeze({
    get count() { return count; },
    getFeedbackContributionSnapshot: () => snapshot(),
    registerPlannerContribution() { events.push("register"); return () => events.push("unregister"); },
    subscribeFeedbackChanges(listener) { callback = listener; return () => { events.push("unsubscribe"); listener(); }; },
    plannerContributionChanged() { events.push("changed"); },
    destroy() { events.push("destroy"); callback(); },
  });
  const installed = installPlannerContributions(root, controller);
  count = 2; assert.equal(installed.count, 2); assert.equal(root.researchUi, installed);
  callback(); installed.destroy(); installed.destroy(); callback();
  assert.deepEqual(events, ["register", "changed", "unsubscribe", "unregister", "destroy"]);
  assert.equal(root.researchUi, undefined);
});

test("failed registration releases prior owners and destroys the UI without leaking a root controller", () => {
  const root = {}; const events = [];
  const controller = Object.freeze({
    getQuestionnaireContributionSnapshot: () => snapshot(), getFeedbackContributionSnapshot: () => snapshot(),
    registerPlannerContribution(segment) {
      if (segment === "P5") throw new Error("registration failed");
      return () => events.push("unregister");
    },
    destroy() { events.push("destroy"); },
  });
  assert.throws(() => installPlannerContributions(root, controller), /registration failed/);
  assert.deepEqual(events, ["unregister", "destroy"]);
  assert.equal(root.researchUi, undefined);
});

test("confirmation requires owner validation and freezes a detached snapshot", async () => {
  const registry = createPlannerContributionRegistry();
  const value = snapshot();
  registry.register("P2", () => value, validated);
  assert.equal(registry.readAccepted({ requiredSegments: ["P2"] }).entries[0].status, "missing");
  const receipt = await registry.accept("P2");
  receipt.contribution.accepted = "caller edit";
  assert.equal(registry.assertAccepted({ requiredSegments: ["P2"] }).snapshots[0].contribution.accepted, "design");
  assert.throws(() => registry.assertAccepted(), /P1/);
  const unvalidated = createPlannerContributionRegistry();
  unvalidated.register("P2", () => value);
  await assert.rejects(unvalidated.accept("P2"), /validator is unavailable/);
});

test("an observed pending edit permanently expires acceptance until reconfirmed", async () => {
  const registry = createPlannerContributionRegistry();
  let value = snapshot();
  registry.register("P2", () => value, validated);
  await registry.accept("P2");
  value = snapshot({ pending: true });
  registry.changed("P2");
  value = snapshot();
  assert.equal(registry.readAccepted({ requiredSegments: ["P2"] }).entries[0].status, "stale");
  await registry.accept("P2");
  assert.equal(registry.readAccepted({ requiredSegments: ["P2"] }).entries[0].status, "accepted");
  registry.clearAcceptance();
  assert.throws(() => registry.assertAccepted({ requiredSegments: ["P2"] }), /confirm/);
});

test("dependency withdrawal, same-revision replacement and transitive invalidity expire accepted consumers", async () => {
  const registry = createPlannerContributionRegistry();
  let p1 = snapshot({ revision: 7 });
  let p3 = snapshot({ dependencyRevisions: [{ segment: "P1", revision: 7 }] });
  registry.register("P1", () => p1, validated);
  registry.register("P3", () => p3, validated);
  registry.register("P4", () => snapshot({ dependencyRevisions: [{ segment: "P3", revision: 0 }] }), validated);
  await registry.accept("P3");
  await registry.accept("P4");
  p1 = snapshot({ revision: 7, contribution: { accepted: "replacement" } });
  const invalid = registry.read({ format: "contributions" });
  assert.ok(invalid.issues.some(({ segment, code }) => segment === "P4" && code === "dependency-stale"));
  p1 = snapshot({ revision: 7 });
  assert.equal(registry.readAccepted({ requiredSegments: ["P3"] }).entries.find(({ segment }) => segment === "P3").status, "stale");
  await registry.accept("P3");
  p1 = snapshot({ revision: 8, enabled: false, contribution: null });
  registry.changed("P1");
  await assert.rejects(registry.accept("P3"), /dependency/);
  p3 = snapshot({ revision: 1, dependencyRevisions: [{ segment: "P1", revision: 8 }] });
  await assert.rejects(registry.accept("P3"), /dependency/);
});

test("optional exclusion is explicit and cannot hide a required or re-enabled owner", async () => {
  const registry = createPlannerContributionRegistry();
  let value = snapshot({ enabled: false, contribution: null });
  registry.register("P6", () => value, validated);
  assert.throws(() => registry.assertAccepted({ requiredSegments: [] }), /confirm/);
  await registry.accept("P6");
  assert.equal(registry.assertAccepted({ requiredSegments: [] }).entries[0].status, "excluded");
  value = snapshot({ revision: 1, enabled: false, pending: true, contribution: { preview: "unsaved" } });
  assert.equal(registry.assertAccepted({ requiredSegments: [] }).entries[0].status, "excluded");
  assert.throws(() => registry.assertAccepted({ requiredSegments: ["P6"] }), /current contribution/);
  value = snapshot({ revision: 2 });
  assert.throws(() => registry.assertAccepted({ requiredSegments: [] }), /current contribution/);
});

test("asynchronous confirmation rejects intervening edits, clears and replaced owners", async () => {
  for (const action of ["edit-revert", "clear", "unregister"]) {
    const registry = createPlannerContributionRegistry();
    let value = snapshot();
    let finish;
    const unregister = registry.register("P2", () => value, { validateContribution: () => new Promise((resolve) => { finish = resolve; }) });
    const pending = registry.accept("P2");
    if (action === "edit-revert") { value = snapshot({ pending: true }); registry.changed("P2"); value = snapshot(); }
    if (action === "clear") registry.clearAcceptance();
    if (action === "unregister") { unregister(); registry.register("P2", () => value, validated); }
    finish(true);
    await assert.rejects(pending, /changed during confirmation/);
    assert.throws(() => registry.assertAccepted({ requiredSegments: ["P2"] }), /confirm/);
  }
});

test("owner validation receives actual detached dependency snapshots and target", async () => {
  const registry = createPlannerContributionRegistry();
  const p1 = snapshot({ revision: 3 });
  registry.register("P1", () => p1, validated);
  registry.register("P6", () => snapshot({ dependencyRevisions: [{ segment: "P1", revision: 3 }] }), {
    validateContribution: async (value, context) => {
      assert.equal(context.selectedTarget, "webxr-immersive-vr");
      assert.equal(context.dependencies.P1.revision, 3);
      context.dependencies.P1.contribution.accepted = "must not change producer";
      return true;
    },
  });
  await registry.accept("P6", { selectedTarget: "webxr-immersive-vr" });
  assert.equal(p1.contribution.accepted, "design");
});

test("handoff metadata is closed, bounded, plain JSON with exact unique dependencies", () => {
  const original = snapshot();
  const checked = validatePlannerContributionSnapshot(original);
  checked.contribution.accepted = "different";
  assert.equal(original.contribution.accepted, "design");
  for (const invalid of [snapshot({ extra: 1 }), snapshot({ revision: -1 }), snapshot({ revision: 1.5 }),
    snapshot({ contribution: [] }), snapshot({ contribution: { value: Infinity } }),
    snapshot({ dependencyRevisions: [{ segment: "P7", revision: 0 }] }),
    snapshot({ dependencyRevisions: [{ segment: "P1", revision: 0 }, { segment: "P1", revision: 1 }] }),
    snapshot({ contribution: { data: "x".repeat(5 * 1024 * 1024) } })]) {
    assert.throws(() => validatePlannerContributionSnapshot(invalid));
  }
});

test("active successor contributions can never be silently omitted from a v1 recipe", async () => {
  const registry = createPlannerContributionRegistry();
  registry.register("P6", () => snapshot());
  assert.equal(registry.read().issues[0].code, "successor-required");
  await assert.rejects(registry.assertPackageV1({}), /successor recipe/);
});

test("a disabled preview does not alter the exported contribution fingerprint", () => {
  const registry = createPlannerContributionRegistry();
  const before = registry.read().fingerprint;
  let value = snapshot({ enabled: false });
  registry.register("P4", () => value);
  assert.equal(registry.read().fingerprint, before);
  value = snapshot({ enabled: false, revision: 1, pending: true, contribution: { preview: "changed" } });
  registry.changed("P4");
  assert.equal(registry.read().fingerprint, before);
  assert.equal(registry.read().issues.length, 0);
});

test("owner domain validation must prove the exact accepted content is included", async () => {
  const registry = createPlannerContributionRegistry();
  registry.register("P2", () => snapshot(), included);
  await registry.assertPackageV1({ accepted: "design" });
  await assert.rejects(registry.assertPackageV1({ accepted: "old design" }), /P2.*does not include/);
});

test("pending edits and invalid revision changes block acceptance", async () => {
  const registry = createPlannerContributionRegistry();
  let value = snapshot();
  registry.register("P2", () => value, included);
  await registry.assertPackageV1({ accepted: "design" });
  value = snapshot({ pending: true });
  assert.equal(registry.read().issues[0].code, "contribution-pending");
  value = snapshot({ contribution: { accepted: "changed without revision" } });
  assert.equal(registry.read().issues[0].code, "contribution-invalid");
  value = snapshot({ revision: 2 });
  assert.equal(registry.read().issues.length, 0);
  value = snapshot({ revision: 1 });
  assert.equal(registry.read().issues[0].code, "contribution-invalid");
});

test("missing, changed, pending, and cyclic dependencies route errors to their owners", () => {
  const registry = createPlannerContributionRegistry();
  let p1 = snapshot({ revision: 1 });
  const p4 = snapshot({ dependencyRevisions: [{ segment: "P1", revision: 1 }] });
  registry.register("P4", () => p4, included);
  assert.ok(registry.read().issues.some((issue) => issue.segment === "P4" && issue.code === "dependency-stale"));
  registry.register("P1", () => p1, included);
  assert.equal(registry.read().issues.length, 0);
  p1 = snapshot({ revision: 1, pending: true });
  assert.ok(registry.read().issues.some((issue) => issue.segment === "P4" && issue.code === "dependency-stale"));
  p1 = snapshot({ revision: 2 });
  assert.ok(registry.read().issues.some((issue) => issue.segment === "P4" && issue.code === "dependency-stale"));
  p1 = snapshot({ revision: 3, dependencyRevisions: [{ segment: "P4", revision: 0 }] });
  assert.ok(registry.read().issues.some((issue) => issue.code === "dependency-cycle"));
});

test("changes while owner validation is awaiting invalidate the candidate", async () => {
  const registry = createPlannerContributionRegistry();
  let value = snapshot();
  registry.register("P2", () => value, { validatePackageV1: async () => {
    await Promise.resolve();
    value = snapshot({ revision: 1 });
    return true;
  } });
  await assert.rejects(registry.assertPackageV1({}), /changed during validation/);
});

test("one owner per segment; removal and notifications update the shared review", () => {
  let notifications = 0;
  const registry = createPlannerContributionRegistry({ onChange: () => { notifications += 1; } });
  const unregister = registry.register("P3", () => snapshot());
  assert.throws(() => registry.register("P3", () => snapshot()), /one contribution owner/);
  registry.changed("P3");
  assert.equal(notifications, 2);
  unregister();
  unregister();
  assert.equal(notifications, 3);
  assert.equal(registry.read().issues.length, 0);
  assert.throws(() => registry.changed("P3"), /not registered/);
});

test("available P2 producer is bound to its full v1 package contents, with no projection loss", async () => {
  const registry = createPlannerContributionRegistry();
  const contribution = { questionnaires: { definitions: ["en", "de"], modules: ["both"] }, languageSelection: { nodes: ["root", "nested"] } };
  registerAvailablePlannerContributions({
    registerPlannerContribution: registry.register,
    getQuestionnaireContributionSnapshot: () => snapshot({ contribution }),
  });
  const pkg = { settings: { questionnaires: contribution.questionnaires }, languageSelection: contribution.languageSelection };
  await registry.assertPackageV1(pkg);
  await assert.rejects(registry.assertPackageV1({ ...pkg, settings: { questionnaires: { definitions: ["en"], modules: ["both"] } } }), /P2.*does not include/);
});

test("available P3 and P6 producers automatically prevent v1 omission", async () => {
  const registry = createPlannerContributionRegistry();
  const unregister = registerAvailablePlannerContributions({
    registerPlannerContribution: registry.register,
    getStimulusOrderSnapshot: () => snapshot(),
    getXrLayoutContribution: () => snapshot(),
  });
  assert.deepEqual(registry.read().issues.map(({ segment }) => segment), ["P3", "P6"]);
  await assert.rejects(registry.assertPackageV1({}), /successor/);
  unregister();
  assert.equal(registry.read().issues.length, 0);
});
