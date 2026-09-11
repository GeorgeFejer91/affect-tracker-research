import test from "node:test";
import assert from "node:assert/strict";
import { createPlannerContributionRegistry, registerAvailablePlannerContributions, validatePlannerContributionSnapshot } from "../site/src/research/planner-contributions.js";

const snapshot = (overrides = {}) => ({ revision: 0, enabled: true, pending: false,
  contribution: { accepted: "design" }, dependencyRevisions: [], ...overrides });
const included = { validatePackageV1: (pkg, contribution) => pkg.accepted === contribution.accepted };

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
