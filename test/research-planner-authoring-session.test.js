import test from "node:test";
import assert from "node:assert/strict";
import { createPlannerAuthoringSession } from "../site/src/research/planner-authoring-session.js";
import { createPlannerPolicyCommandOwner } from "../site/src/research/planner-authoring-p7.js";
import { PLANNER_COMMAND_SCHEMA } from "../site/src/research/planner-authoring-contract.js";
import { readPlannerPolicyControls } from "../site/src/research/planner-policy-controls.js";

function harness() {
  const fields = new Map([
    ["participant-count", { value: "24" }], ["sampling-frequency", { value: "130" }],
    ["output-csv", { checked: true }], ["output-tsv", { checked: true }],
    ["lsl-enabled", { checked: false }], ["lsl-state-stream", { value: "AffectResearch" }],
    ["lsl-stream-type", { value: "Affect" }], ["lsl-marker-stream", { value: "AffectResearchMarkers" }],
    ["lsl-source-id", { value: "affect-research" }],
  ]);
  const root = { querySelector: selector => fields.get(selector.slice(1)) };
  let commits = 0;
  const owner = createPlannerPolicyCommandOwner({ root });
  const session = createPlannerAuthoringSession({ owners: [owner], onCommit() { commits++; } });
  const request = (action, expectedRevision = null, extra = {}) => ({ schema: PLANNER_COMMAND_SCHEMA,
    version: 1, sessionId: session.sessionId, requestId: crypto.randomUUID(), expectedRevision, action, ...extra });
  return { fields, root, owner, session, request, get commits() { return commits; } };
}

test("CLI policy catalogue and get use the exact existing UI-owned controls", async () => {
  const h = harness();
  const catalogue = await h.session.execute(h.request({ kind: "catalogue" }));
  assert.equal(catalogue.result.settings.length, 10);
  assert.equal(catalogue.result.settings.filter(setting => setting.writable).length, 9);
  h.fields.get("participant-count").value = "91";
  h.session.edited();
  const get = await h.session.execute(h.request({ kind: "get", field: "P7.participantCount" }));
  assert.equal(get.result.value, 91);
  assert.equal(get.revision, 1);
  const set = await h.session.execute(h.request({ kind: "set", field: "P7.participantCount", value: 42 }, 1));
  assert.equal(set.status, "applied");
  assert.equal(set.revision, 2);
  assert.equal(readPlannerPolicyControls(h.root).participantCount, 42);
  assert.equal(h.commits, 1);
});

test("every writable policy setting performs typed set/get/export-reader round trip", async () => {
  const h = harness();
  const values = [57, 200, false, true, true, "StudyState", "StudyAffect", "StudyMarkers", "study-2026"];
  for (const [index, setting] of h.owner.settings.filter(item => item.writable).entries()) {
    const response = await h.session.execute(h.request({ kind: "set", field: setting.id, value: values[index] }, h.session.revision));
    assert.equal(response.status, "applied", setting.id);
    assert.equal((await h.session.execute(h.request({ kind: "get", field: setting.id }))).result.value, values[index]);
  }
  assert.deepEqual(readPlannerPolicyControls(h.root).lsl, { enabled: true, stateStream: "StudyState", streamType: "StudyAffect", markerStream: "StudyMarkers", sourceId: "study-2026" });
});

test("batch syntax failure does not partially apply an earlier edit", async () => {
  const h = harness(), before = h.session.snapshot();
  const result = await h.session.execute(h.request({ kind: "apply", edits: [
    { kind: "set", field: "P7.participantCount", value: 13 },
    { kind: "set", field: "P7.samplingFrequencyHz", value: "200" },
  ] }, 0));
  assert.equal(result.issues[0].code, "invalid_value");
  assert.deepEqual(h.session.snapshot(), before);
  assert.equal(h.commits, 0);
});

test("incomplete cross-field policy stays visible without becoming ready", async () => {
  const h = harness();
  const result = await h.session.execute(h.request({ kind: "apply", edits: [
    { kind: "set", field: "P7.output.csv", value: false },
    { kind: "set", field: "P7.output.tsv", value: false },
  ] }, 0));
  assert.equal(result.status, "incomplete");
  assert.throws(() => readPlannerPolicyControls(h.root));
  assert.equal(h.session.snapshot().owners.P7.values["P7.output.tsv"], false);
  assert.equal(h.session.revision, 1);
});

test("invalid raw GUI edits and edit/revert still advance CAS revision", async () => {
  const h = harness();
  for (const text of ["", "invalid", "24"]) { h.fields.get("participant-count").value = text; h.session.edited(); }
  assert.equal(h.session.revision, 3);
  const result = await h.session.execute(h.request({ kind: "set", field: "P7.participantCount", value: 70 }, 0));
  assert.equal(result.issues[0].code, "stale_revision");
  assert.equal(h.fields.get("participant-count").value, "24");
  h.fields.get("participant-count").value = "not a number"; h.session.edited();
  const snapshot = h.session.snapshot();
  assert.equal(snapshot.owners.P7.values["P7.participantCount"], "not a number");
  assert.equal(snapshot.owners.P7.issues[0].code, "invalid_policy");
});

test("identical mutation retry does not repeat application and changed reuse rejects", async () => {
  const h = harness(), request = h.request({ kind: "set", field: "P7.participantCount", value: 81 }, 0);
  const first = await h.session.execute(request);
  assert.deepEqual(await h.session.execute(request), first);
  assert.equal(h.commits, 1);
  assert.equal((await h.session.execute({ ...request, action: { ...request.action, value: 82 } })).issues[0].code, "request_id_reused");
  assert.equal(h.fields.get("participant-count").value, "81");
});

test("unknown/derived/stale-session/malformed commands cannot mutate policy", async () => {
  const h = harness();
  const cases = [
    h.request({ kind: "set", field: "P7.unknown", value: 1 }, 0),
    h.request({ kind: "set", field: "P7.playback", value: {} }, 0),
    h.request({ kind: "set", field: "P7.participantCount", value: 1 }, 0, { sessionId: crypto.randomUUID() }),
    h.request({ kind: "set", field: "P7.participantCount", value: 1 }, null),
    h.request({ kind: "get", field: "P7.participantCount", unexpected: true }),
    h.request({ kind: "eval", code: "alert(1)" }),
    h.request({ kind: "set", field: "P7.participantCount", value: NaN }, 0),
  ];
  for (const request of cases) assert.equal((await h.session.execute(request)).status, "rejected");
  assert.equal(h.session.revision, 0);
  assert.equal(h.commits, 0);
});

for (const interruption of ["edit", "cancel", "destroy"]) test(`delayed staging cannot commit after ${interruption}`, async () => {
  const h = harness(); let release, applied = false;
  const gate = new Promise(resolve => { release = resolve; });
  h.session.registerOwner({ id: "P4", settings: [{ id: "P4.test", type: "integer", classification: "authored", writable: true }], operations: [],
    read: () => ({ values: { "P4.test": 0 }, issues: [] }), validate: () => [],
    async stage() { await gate; return { commit() { applied = true; } }; },
  });
  const request = h.request({ kind: "set", field: "P4.test", value: 1 }, 0);
  const pending = h.session.execute(request);
  if (interruption === "edit") h.session.edited();
  else if (interruption === "destroy") h.session.destroy();
  else assert.equal((await h.session.execute(h.request({ kind: "cancel", requestId: request.requestId }))).result.canceled, true);
  release();
  const result = await pending;
  assert.ok(["canceled", "rejected"].includes(result.status));
  assert.equal(applied, false);
});

test("observer or postcommit validation failure never reports a mutated edit rejected", async () => {
  for (const failure of ["observer", "validation", "projection"]) {
    let value = 1;
    const session = createPlannerAuthoringSession({ onCommit() { if (failure === "projection") throw Error("projection"); }, owners: [{
      id: "P7", settings: [{ id: "P7.value", type: "integer", classification: "authored", writable: true }], operations: [],
      read: () => ({ values: { "P7.value": value }, issues: [] }),
      validate() { if (failure === "validation") throw Error("validator"); return []; },
      async stage() { return { commit() { value = 2; } }; },
    }] });
    if (failure === "observer") session.subscribe(() => { throw Error("observer"); });
    const result = await session.execute({ schema: PLANNER_COMMAND_SCHEMA, version: 1, sessionId: session.sessionId,
      requestId: crypto.randomUUID(), expectedRevision: 0, action: { kind: "set", field: "P7.value", value: 2 } });
    assert.equal(value, 2); assert.equal(result.revision, 1); assert.equal(result.status, "incomplete");
    assert.equal(result.issues.length, 1);
  }
});

test("readback missing a registered setting is rejected as a non-JSON projection", async () => {
  const h = harness();
  h.session.registerOwner({ id: "P4", settings: [{ id: "P4.absent", type: "integer", classification: "derived", writable: false }],
    operations: [], read: () => ({ values: {}, issues: [] }), validate: () => [], stage: async () => ({ commit() {} }) });
  const result = await h.session.execute(h.request({ kind: "get", field: "P4.absent" }));
  assert.equal(result.status, "rejected");
  assert.equal(result.result, null);
});

test("every staged dependency guard is checked before the first owner commits", async () => {
  let dependency = 0, writes = 0;
  const owners = ["P4", "P6"].map(id => ({ id, settings: [{ id: `${id}.value`, type: "integer", classification: "authored", writable: true }], operations: [],
    read: () => ({ values: { [`${id}.value`]: 0 }, issues: [] }), validate: () => [],
    async stage() { const captured = dependency; if (id === "P6") dependency++; return { isCurrent: () => dependency === captured, commit() { writes++; } }; },
  }));
  const session = createPlannerAuthoringSession({ owners });
  const result = await session.execute({ schema: PLANNER_COMMAND_SCHEMA, version: 1, sessionId: session.sessionId,
    requestId: crypto.randomUUID(), expectedRevision: 0, action: { kind: "apply", edits: owners.map(owner => ({ kind: "set", field: `${owner.id}.value`, value: 1 })) } });
  assert.equal(result.issues[0].code, "stale_revision"); assert.equal(writes, 0); assert.equal(session.revision, 0);
});

test("P7 notifications run after every owner's state install and failures retain the applied result", async () => {
  const h = harness(); let otherValue = 0, observed = 0;
  const policy = createPlannerPolicyCommandOwner({ root: h.root, onCommit() {
    observed++; assert.equal(otherValue, 5); throw new Error("projection failure");
  } });
  const session = createPlannerAuthoringSession({ owners: [policy, {
    id: "P4", settings: [{ id: "P4.value", type: "integer", classification: "authored", writable: true }], operations: [],
    read: () => ({ values: { "P4.value": otherValue }, issues: [] }), validate: () => [],
    async stage() { return { commit() { otherValue = 5; } }; },
  }] });
  const request = h.request({ kind: "apply", edits: [
    { kind: "set", field: "P7.participantCount", value: 42 },
    { kind: "set", field: "P4.value", value: 5 },
  ] }, 0, { sessionId: session.sessionId });
  const result = await session.execute(request);
  assert.equal(result.status, "incomplete"); assert.equal(result.revision, 1);
  assert.equal(result.issues[0].code, "projection_failed");
  assert.deepEqual(result.result.updatedOwners, ["P7", "P4"]);
  assert.equal(otherValue, 5); assert.equal(observed, 1);
  assert.equal(h.fields.get("participant-count").value, "42");
  assert.deepEqual(await session.execute(request), result);
  assert.equal(observed, 1);
});

test("retained post-publication issues remain bounded and retryable", async () => {
  let value = 0;
  const session = createPlannerAuthoringSession({ owners: [{
    id: "P4", settings: [{ id: "P4.value", type: "integer", classification: "authored", writable: true }], operations: [],
    read: () => ({ values: { "P4.value": value }, issues: [] }),
    validate: () => Array.from({ length: 300 }, () => ({ owner: "P4", field: "x".repeat(1000), code: "x".repeat(1000), message: "\u0000".repeat(2000) })),
    async stage() { return { commit() { value++; } }; },
  }] });
  const request = { schema: PLANNER_COMMAND_SCHEMA, version: 1, sessionId: session.sessionId,
    requestId: crypto.randomUUID(), expectedRevision: 0, action: { kind: "set", field: "P4.value", value: 1 } };
  const result = await session.execute(request);
  assert.equal(result.status, "incomplete"); assert.equal(result.issues.length, 64);
  assert.equal(result.issues[0].message.length, 512); assert.equal(result.issues[0].field.length, 163);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 512 * 1024);
  assert.deepEqual(await session.execute(request), result); assert.equal(value, 1);
});
