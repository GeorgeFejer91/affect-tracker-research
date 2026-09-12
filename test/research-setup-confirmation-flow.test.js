import test from "node:test";
import assert from "node:assert/strict";
import { createPlannerContributionRegistry } from "../site/src/research/planner-contributions.js";
import { createSetupConfirmationFlow, SETUP_CONFIRMATION_ORDER } from "../site/src/research/setup-confirmation-flow.js";

function fixture() {
  const registry = createPlannerContributionRegistry();
  const values = {};
  for (const segment of ["P1", "P2", "P3", "P4", "P5", "P6"]) {
    values[segment] = { revision: 0, enabled: segment !== "P6", pending: false,
      contribution: segment === "P6" ? null : { value: segment }, dependencyRevisions: [] };
    registry.register(segment, () => values[segment], { validateContribution: async () => true });
  }
  const flow = createSetupConfirmationFlow({
    acceptContribution: (segment) => registry.accept(segment), readAcceptance: () => registry.readAccepted(),
  });
  return { registry, values, flow };
}

test("preconfigured values still require explicit confirmation, advancing past live preview to final save", async () => {
  const { registry, flow } = fixture();
  assert.ok(flow.read().every(({ confirmed }) => !confirmed));
  for (const [index, id] of SETUP_CONFIRMATION_ORDER.entries()) {
    assert.deepEqual(await flow.confirm(id), { status: "confirmed",
      nextSectionId: SETUP_CONFIRMATION_ORDER[index + 1] ?? "review" });
  }
  assert.equal(flow.read().find(({ id }) => id === "xr").status, "excluded");
  assert.equal(registry.readAccepted().entries.find(({ segment }) => segment === "P5").status, "missing");
  await assert.rejects(flow.confirm("feedback"), /final save/);
  await assert.rejects(flow.confirm("review"), /final save/);
});

test("reopening a confirmed section is read-only; real edits and dependency changes expire its check", async () => {
  const { registry, values, flow } = fixture();
  values.P3.dependencyRevisions = [{ segment: "P1", revision: 0 }];
  await flow.confirm("workspace");
  await flow.confirm("stimuli");
  assert.deepEqual(await flow.confirm("workspace"), { status: "unchanged" });
  assert.ok(flow.read().find(({ id }) => id === "workspace").confirmed);
  values.P1.revision += 1;
  values.P1.contribution.value = "changed";
  registry.changed("P1");
  assert.equal(flow.read().find(({ id }) => id === "workspace").confirmed, false);
  assert.equal(flow.read().find(({ id }) => id === "stimuli").confirmed, false);
});

test("validation failure keeps the section open and never synthesizes a check", async () => {
  const { values, flow } = fixture();
  values.P2.pending = true;
  const result = await flow.confirm("questionnaires");
  assert.equal(result.status, "error");
  assert.equal(result.nextSectionId, undefined);
  assert.match(flow.read().find(({ id }) => id === "questionnaires").error, /edits/);
  values.P2.pending = false;
  assert.equal((await flow.confirm("questionnaires")).status, "confirmed");
  assert.equal(flow.read().find(({ id }) => id === "questionnaires").error, null);
});

test("pending confirmation blocks duplicate clicks, detects a stale receipt, and teardown suppresses notifications", async () => {
  let finish;
  let status = "missing";
  let notifications = 0;
  const flow = createSetupConfirmationFlow({
    acceptContribution: () => new Promise((resolve) => { finish = resolve; }),
    readAcceptance: () => ({ entries: [{ segment: "P1", status }] }),
    onChange: () => { notifications += 1; },
  });
  const first = flow.confirm("workspace");
  assert.equal(flow.read()[0].busy, true);
  assert.deepEqual(await flow.confirm("workspace"), { status: "busy" });
  finish();
  assert.equal((await first).status, "error");
  assert.equal(flow.read()[0].confirmed, false);
  const second = flow.confirm("workspace");
  const beforeDestroy = notifications;
  flow.destroy();
  status = "accepted";
  finish();
  assert.deepEqual(await second, { status: "disposed" });
  assert.equal(notifications, beforeDestroy);
});
