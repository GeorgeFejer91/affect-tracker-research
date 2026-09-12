import test from "node:test";
import assert from "node:assert/strict";
import { createPlannerContributionRegistry } from "../site/src/research/planner-contributions.js";

const snapshot = (overrides = {}) => ({ revision: 0, enabled: true, pending: false,
  contribution: { accepted: "design" }, dependencyRevisions: [], ...overrides });

function harness({ validator = async () => true, segment = "P3", excluded = false } = {}) {
  const events = [], controller = new AbortController();
  let live = snapshot({ revision: 3, pending: true, contribution: null,
    dependencyRevisions: [{ segment: "P1", revision: 7 }] });
  let future = snapshot({ revision: 4, contribution: { accepted: "future" },
    dependencyRevisions: [{ segment: "P1", revision: 7 }] });
  if (excluded) live = future = snapshot({ revision: 3, enabled: false, pending: true, contribution: null });
  let dependency = snapshot({ revision: 7 }), ownerCommitted = false, ownerCurrent = true, hostCurrent = true;
  const registry = createPlannerContributionRegistry({ onChange: () => events.push("registry-project") });
  const registerDependency = () => registry.register("P1", () => dependency, { validateContribution: async () => true });
  let removeDependency = registerDependency();
  registry.register(segment, () => live, { validateContribution: validator });
  const candidate = {
    get snapshot() { return structuredClone(future); },
    isCurrent() { return ownerCurrent && !ownerCommitted; },
    commit() { events.push("owner-state"); ownerCommitted = true; live = structuredClone(future); },
    afterCommit() { events.push("owner-project"); },
  };
  events.length = 0;
  return { events, controller, registry, candidate, segment,
    get live() { return structuredClone(live); }, get future() { return structuredClone(future); },
    setLive(value) { live = value; }, setFuture(value) { future = value; },
    setDependency(value) { dependency = value; },
    replaceDependency() { removeDependency(); removeDependency = registerDependency(); registry.read({ format: "contributions" }); },
    invalidateOwner() { ownerCurrent = false; }, invalidateHost() { hostCurrent = false; },
    prepare() { return registry.prepareAcceptance(segment, { preparedOwner: candidate,
      signal: controller.signal, isCurrent: () => hostCurrent, selectedTarget: "desktop-screen" }); },
  };
}

test("future contribution is validated without owner acceptance, observation or projection", async () => {
  let observed;
  const h = harness({ validator: async (value, context) => { observed = { value, context }; return true; } });
  const before = h.registry.readAccepted({ requiredSegments: ["P3"] });
  const generation = h.registry.getAcceptanceGeneration(), original = h.live;
  const prepared = await h.prepare();
  assert.deepEqual(observed.value, h.future.contribution);
  assert.equal(observed.context.dependencies.P1.revision, 7);
  assert.equal(observed.context.selectedTarget, "desktop-screen");
  observed.context.dependencies.P1.contribution.accepted = "detached change";
  assert.deepEqual(h.live, original);
  assert.deepEqual(h.registry.readAccepted({ requiredSegments: ["P3"] }), before);
  assert.equal(h.registry.getAcceptanceGeneration(), generation);
  assert.deepEqual(h.events, []);
  const detached = prepared.snapshot; detached.contribution.accepted = "caller change";
  assert.equal(prepared.snapshot.contribution.accepted, "future");
  assert.equal(prepared.isCurrent(), true);
  const committed = prepared.commit();
  assert.equal(committed?.then, undefined);
  assert.deepEqual(committed, { segment: "P3", ...h.live });
  assert.deepEqual(h.live, h.future);
  assert.deepEqual(h.events, ["owner-state"]);
  assert.equal(h.registry.getAcceptanceGeneration(), generation + 1);
  assert.deepEqual(prepared.commit(), committed);
  prepared.afterCommit(); prepared.afterCommit();
  assert.deepEqual(h.events, ["owner-state", "owner-project", "registry-project"]);
  assert.equal(h.registry.readAccepted().entries.find(x => x.segment === "P3").status, "accepted");
});

test("future dependency and domain failures never invoke owner commit", async () => {
  for (const kind of ["domain", "missing", "cycle", "revision", "pending"]) {
    const h = harness({ validator: async () => kind !== "domain" });
    const future = h.future;
    if (kind === "missing") future.dependencyRevisions = [{ segment: "P5", revision: 7 }];
    if (kind === "cycle") future.dependencyRevisions = [{ segment: "P3", revision: 4 }];
    if (kind === "revision") future.revision = 3; // Changed content requires an advanced revision.
    if (kind === "pending") future.pending = true;
    h.setFuture(future);
    await assert.rejects(h.prepare());
    assert.deepEqual(h.events, []);
    assert.equal(h.live.pending, true);
  }
});

test("prepared owners reject abort, original-state drift, dependency replacement and substitution", async () => {
  for (const kind of ["abort", "host", "owner", "live", "dependency", "replace-dependency", "clear", "snapshot", "getter", "commit", "afterCommit"]) {
    const h = harness(), prepared = await h.prepare();
    if (kind === "abort") h.controller.abort();
    if (kind === "host") h.invalidateHost();
    if (kind === "owner") h.invalidateOwner();
    if (kind === "live") h.setLive({ ...h.live, revision: 5 });
    if (kind === "dependency") h.setDependency(snapshot({ revision: 8 }));
    if (kind === "replace-dependency") h.replaceDependency();
    if (kind === "clear") h.registry.clearAcceptance({ notify: false });
    if (kind === "snapshot") h.setFuture({ ...h.future, contribution: { accepted: "substitute" } });
    if (kind === "getter") Object.defineProperty(h.candidate, "snapshot", { get: () => h.future });
    if (kind === "commit" || kind === "afterCommit") h.candidate[kind] = () => {};
    assert.equal(prepared.isCurrent(), false, kind);
    assert.throws(() => prepared.commit(), undefined, kind);
    assert.ok(!h.events.includes("owner-state"), kind);
    assert.ok(!h.events.includes("owner-project"), kind);
  }
});

test("substitution while authoritative validation awaits rejects the detached candidate", async () => {
  let finish;
  const h = harness({ validator: () => new Promise(resolve => { finish = resolve; }) });
  const pending = h.prepare();
  h.setFuture({ ...h.future, contribution: { accepted: "substituted while awaiting" } });
  finish(true);
  await assert.rejects(pending, /changed during confirmation/);
  assert.deepEqual(h.events, []);
  assert.equal(h.live.pending, true);
});

test("bad owner commits cannot install acceptance or be retried after possible mutation", async () => {
  for (const kind of ["mismatch", "throws", "async-result", "dependency", "abort", "candidate"]) {
    const h = harness();
    let calls = 0;
    h.candidate.commit = () => {
      calls++;
      h.setLive(h.future);
      if (kind === "mismatch") h.setLive({ ...h.future, contribution: { accepted: "wrong" } });
      if (kind === "throws") throw new Error("Owner install failed");
      if (kind === "async-result") return Promise.resolve();
      if (kind === "dependency") h.setDependency(snapshot({ revision: 8 }));
      if (kind === "abort") h.controller.abort();
      if (kind === "candidate") h.setFuture({ ...h.future, revision: 99 });
    };
    const prepared = await h.prepare(), generation = h.registry.getAcceptanceGeneration();
    assert.throws(() => prepared.commit(), undefined, kind);
    assert.equal(h.registry.getAcceptanceGeneration(), generation);
    assert.throws(() => prepared.commit(), undefined, kind);
    assert.equal(calls, 1);
    assert.throws(() => prepared.afterCommit());
    assert.notEqual(h.registry.readAccepted().entries.find(x => x.segment === "P3").status, "accepted");
  }
});

test("owner projection failure retains acceptance and still attempts registry projection once", async () => {
  const h = harness();
  h.candidate.afterCommit = () => { h.events.push("owner-project"); throw new Error("Renderer unavailable"); };
  const prepared = await h.prepare(); prepared.commit();
  assert.throws(() => prepared.afterCommit(), /Renderer unavailable/);
  prepared.afterCommit();
  assert.deepEqual(h.events, ["owner-state", "owner-project", "registry-project"]);
  assert.equal(h.registry.readAccepted().entries.find(x => x.segment === "P3").status, "accepted");
});

test("explicit P6 exclusion keeps the exact disabled owner snapshot", async () => {
  const h = harness({ segment: "P6", excluded: true, validator: () => { throw new Error("Disabled profile must not be compiled"); } });
  const original = h.live, prepared = await h.prepare();
  prepared.commit(); prepared.afterCommit();
  assert.deepEqual(h.live, original);
  assert.equal(h.registry.readAccepted({ requiredSegments: [] }).entries.find(x => x.segment === "P6").status, "excluded");
});

test("both projection errors remain visible without replaying committed owner state", async () => {
  let live = snapshot({ pending: true }), failNotify = false, projections = 0;
  const future = snapshot();
  const registry = createPlannerContributionRegistry({ onChange() { if (failNotify) throw new Error("registry observer"); } });
  registry.register("P3", () => live, { validateContribution: async () => true });
  const preparedOwner = { get snapshot() { return structuredClone(future); }, isCurrent: () => true,
    commit() { live = future; }, afterCommit() { projections++; throw new Error("owner renderer"); } };
  const prepared = await registry.prepareAcceptance("P3", { preparedOwner });
  prepared.commit(); failNotify = true;
  assert.throws(() => prepared.afterCommit(), error => error instanceof AggregateError
    && error.errors.map(item => item.message).join(";") === "owner renderer;registry observer");
  prepared.afterCommit(); assert.equal(projections, 1);
  assert.equal(registry.readAccepted().entries.find(entry => entry.segment === "P3").status, "accepted");
});
