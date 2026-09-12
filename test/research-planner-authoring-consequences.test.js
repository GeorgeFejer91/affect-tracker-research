import test from "node:test";
import assert from "node:assert/strict";
import { createPlannerAuthoringSession } from "../site/src/research/planner-authoring-session.js";
import { PLANNER_COMMAND_SCHEMA, commandFailure } from "../site/src/research/planner-authoring-contract.js";

// Owner doubles exercise the production coordinator; these are not file/media
// or native transport qualification receipts.
function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function descriptor(id = "saveRecipe", keys = ["directory"]) {
  return { id, arguments: { type: "object", additionalProperties: false,
    required: keys, properties: Object.fromEntries(keys.map(key => [key, { type: "string" }])) } };
}
function harness({ prepare, validate = () => [], onBeforeCommit, onCommit, descriptors = [descriptor()] } = {}) {
  let value = 0, preparations = 0, dispatches = 0;
  const owner = { id: "P7", settings: [{ id: "P7.value", type: "integer", classification: "authored", writable: true }],
    operations: [{ id: "saveRecipe", consequential: true, atomic: false }],
    consequences: descriptors,
    read: () => ({ values: { "P7.value": value }, issues: [] }), validate,
    async stage(edits) { return { commit() { value = edits[0].value; } }; },
    async prepareConsequence(operation, args, context) {
      preparations++;
      const prepared = prepare ? await prepare({ operation, args, context, set(value_) { value = value_; } }) : {
        dispatch({ publish }) { publish(() => { value++; }); return { confirmed: true }; },
      };
      return { ...prepared, async dispatch(context_) { dispatches++; return prepared.dispatch(context_); } };
    },
  };
  const session = createPlannerAuthoringSession({ owners: [owner], onBeforeCommit, onCommit });
  const request = (action = { kind: "perform", operation: "saveRecipe", arguments: { directory: "D:/study" } }, expectedRevision = session.revision) => ({
    schema: PLANNER_COMMAND_SCHEMA, version: 1, sessionId: session.sessionId,
    requestId: crypto.randomUUID(), expectedRevision, action,
  });
  return { owner, session, request, get value() { return value; }, get preparations() { return preparations; }, get dispatches() { return dispatches; } };
}
const firstIssue = result => result.issues[0]?.code;

test("perform requires CAS, a registered name, exact object arguments, and cannot be batched", async () => {
  const h = harness();
  const cases = [
    h.request(undefined, null),
    h.request({ kind: "perform", operation: "unknown", arguments: {} }),
    h.request({ kind: "perform", operation: "P7.saveRecipe", arguments: {} }),
    h.request({ kind: "perform", operation: "saveRecipe", arguments: [] }),
    h.request({ kind: "perform", operation: "saveRecipe", arguments: {} }),
    h.request({ kind: "perform", operation: "saveRecipe", arguments: { directory: "D:/study", extra: 1 } }),
    h.request({ kind: "perform", operation: "saveRecipe", arguments: { directory: "D:/study" }, owner: "P7" }),
    h.request({ kind: "apply", edits: [{ kind: "perform", operation: "saveRecipe", arguments: {} }] }),
    h.request({ kind: "apply", edits: [{ kind: "operation", owner: "P7", operation: "saveRecipe", arguments: {} }] }),
  ];
  for (const request of cases) assert.equal((await h.session.execute(request)).status, "rejected");
  assert.equal(h.preparations, 0); assert.equal(h.dispatches, 0); assert.equal(h.session.revision, 0);
});

test("closed arguments cannot disguise missing keys with a comma-joined property name", async () => {
  const h = harness({ descriptors: [descriptor("saveRecipe", ["directory", "name"])] });
  const result = await h.session.execute(h.request({ kind: "perform", operation: "saveRecipe", arguments: { "directory,name": "D:/study" } }));
  assert.equal(firstIssue(result), "malformed_command"); assert.equal(h.preparations, 0);
});

test("old owners keep their catalogue shape; public consequences and internal operations stay separate", async () => {
  const h = harness();
  const result = await h.session.execute(h.request({ kind: "catalogue" }, null));
  assert.equal(result.result.consequences[0].owner, "P7");
  assert.equal(result.result.consequences[0].id, "saveRecipe");
  assert.equal(result.result.operations[0].id, "saveRecipe");
  result.result.consequences[0].arguments.required.push("bad");
  assert.equal((await h.session.execute(h.request())).status, "applied");
  const { consequences, prepareConsequence, ...oldOwner } = h.owner;
  const old = createPlannerAuthoringSession({ owners: [oldOwner] });
  const catalogue = await old.execute({ ...h.request({ kind: "catalogue" }, null), sessionId: old.sessionId });
  assert.deepEqual(Object.keys(catalogue.result).sort(), ["operations", "settings"]);
});

test("registration rejects duplicate global names and incomplete argument metadata before partial registration", () => {
  const h = harness();
  const other = { ...h.owner, id: "P6", settings: [], read: () => ({ values: {}, issues: [] }) };
  assert.throws(() => h.session.registerOwner(other), /globally unique/);
  assert.deepEqual(Object.keys(h.session.snapshot().owners), ["P7"]);
  for (const bad of [
    [descriptor(), descriptor()],
    [{ ...descriptor(), arguments: { ...descriptor().arguments, additionalProperties: true } }],
    [descriptor("saveRecipe", ["directory", "directory"])],
    [{ ...descriptor(), arguments: { ...descriptor().arguments, required: ["directory,name"] } }],
  ]) assert.throws(() => harness({ descriptors: bad }));
  assert.throws(() => createPlannerAuthoringSession({ owners: [{ ...h.owner, prepareConsequence: undefined }] }));
});

test("domain validation stays with read-only owner preparation", async () => {
  const h = harness({ prepare({ args, context }) {
    assert.equal(context.read("P7").values["P7.value"], 0);
    assert.equal(context.read().revision, 0);
    if (typeof args.directory !== "string") commandFailure("invalid_value", "Directory must be a string.", "P7");
  } });
  const result = await h.session.execute(h.request({ kind: "perform", operation: "saveRecipe", arguments: { directory: 7 } }));
  assert.equal(firstIssue(result), "invalid_value"); assert.equal(result.status, "rejected");
  assert.equal(h.dispatches, 0); assert.equal(h.session.revision, 0);
});

test("acknowledged effects publish exactly once and exact retries return detached results without redispatch", async () => {
  let receipt, dispatchContext;
  const h = harness({ prepare({ set }) { return { dispatch(context) {
    dispatchContext = context;
    assert.equal(h.session.revision, 0);
    context.recordEffect({ state: "possiblyChanged" });
    receipt = { state: "saved", basename: "recipe_timestamp.json", sha256: "a".repeat(64) };
    context.recordEffect(receipt);
    assert.equal(h.session.revision, 0);
    context.publish(() => set(5));
    assert.equal(context.isCurrent(), true); assert.equal(h.session.revision, 1);
    return { basename: receipt.basename };
  } }; } });
  const request = h.request(), result = await h.session.execute(request);
  assert.equal(result.status, "applied"); assert.equal(result.result.published, true);
  assert.equal(h.session.snapshot().owners.P7.values["P7.value"], 5);
  assert.deepEqual(result.result.updatedOwners, ["P7"]);
  receipt.basename = "mutated";
  const expected = structuredClone(result); result.result.effect.basename = "caller mutation";
  assert.deepEqual(await h.session.execute(request), expected); assert.equal(h.dispatches, 1);
  assert.equal(firstIssue(await h.session.execute({ ...request, expectedRevision: 1 })), "request_id_reused");
  assert.equal(dispatchContext.isCurrent(), false);
  assert.throws(() => dispatchContext.recordEffect({ state: "late" }), error => error.code === "operation_closed");
});

test("preparation permits readback; dispatch blocks reads while catalogue and cancellation remain available", async () => {
  const preparing = gate(), prepared = gate(), dispatched = gate(), finish = gate();
  const h = harness({ async prepare() {
    preparing.resolve(); await prepared.promise;
    return { async dispatch({ publish }) { dispatched.resolve(); await finish.promise; publish(() => {}); } };
  } });
  const request = h.request(), pending = h.session.execute(request);
  await preparing.promise;
  assert.equal((await h.session.execute(h.request({ kind: "get", field: "P7.value" }, null))).status, "ok");
  assert.equal(h.session.snapshot().revision, 0);
  prepared.resolve(); await dispatched.promise;
  for (const action of [{ kind: "get", field: "P7.value" }, { kind: "snapshot" }, { kind: "validate", owner: null }]) {
    assert.equal(firstIssue(await h.session.execute(h.request(action, null))), "busy");
  }
  assert.throws(() => h.session.snapshot(), error => error.code === "busy");
  assert.equal((await h.session.execute(h.request({ kind: "catalogue" }, null))).status, "ok");
  assert.equal(firstIssue(await h.session.execute(h.request({ kind: "set", field: "P7.value", value: 1 }))), "busy");
  assert.equal((await h.session.execute(h.request({ kind: "cancel", requestId: crypto.randomUUID() }, null))).result.canceled, false);
  finish.resolve(); assert.equal((await pending).status, "applied");
});

for (const change of ["cancel", "edit", "dependencies", "destroy", "lifetime", "owner"]) {
  test(`pre-effect ${change} prevents dispatch and cannot claim adoption`, async () => {
    const waiting = gate(), release = gate(); let ownerCurrent = true;
    const lifetime = new AbortController();
    const h = harness({ async prepare() { waiting.resolve(); await release.promise; return {
      isCurrent: () => ownerCurrent, dispatch({ publish }) { publish(() => {}); },
    }; } });
    const request = h.request(), pending = h.session.execute(request, { signal: lifetime.signal }); await waiting.promise;
    if (change === "cancel") await h.session.execute(h.request({ kind: "cancel", requestId: request.requestId }, null));
    if (change === "edit") h.session.edited();
    if (change === "dependencies") h.session.dependenciesChanged();
    if (change === "destroy") h.session.destroy();
    if (change === "lifetime") lifetime.abort();
    if (change === "owner") ownerCurrent = false;
    release.resolve(); const result = await pending;
    assert.ok(["rejected", "canceled"].includes(result.status));
    assert.equal(result.result.published, false); assert.equal(result.result.effect, null);
    assert.equal(h.dispatches, 0); assert.equal(h.session.revision, change === "edit" ? 1 : 0);
  });
}

for (const change of ["cancel", "edit", "dependencies", "destroy", "lifetime", "owner"]) {
  test(`late native acknowledgement survives ${change} without adopting a stale result`, async () => {
    const started = gate(), release = gate(); let ownerCurrent = true;
    const lifetime = new AbortController();
    const h = harness({ prepare() { return { isCurrent: () => ownerCurrent, async dispatch({ recordEffect, publish }) {
      recordEffect({ state: "possiblyChanged" }); started.resolve(); await release.promise;
      recordEffect({ state: "saved", basename: "retained.json" }); publish(() => {});
    } }; } });
    const request = h.request(), pending = h.session.execute(request, { signal: lifetime.signal }); await started.promise;
    if (change === "cancel") await h.session.execute(h.request({ kind: "cancel", requestId: request.requestId }, null));
    if (change === "edit") h.session.edited();
    if (change === "dependencies") h.session.dependenciesChanged();
    if (change === "destroy") h.session.destroy();
    if (change === "lifetime") lifetime.abort();
    if (change === "owner") ownerCurrent = false;
    release.resolve(); const result = await pending;
    assert.equal(result.status, "incomplete"); assert.equal(result.result.published, false);
    assert.deepEqual(result.result.effect, { state: "saved", basename: "retained.json" });
    assert.equal(h.session.revision, change === "edit" ? 1 : 0);
    if (change !== "destroy") assert.deepEqual(await h.session.execute(request), result);
    else assert.equal(firstIssue(await h.session.execute(request)), "session_closed");
    assert.equal(h.dispatches, 1);
  });
}

test("identical in-flight retries and changed-ID reuse never redispatch", async () => {
  const started = gate(), release = gate();
  const h = harness({ async prepare() { started.resolve(); await release.promise; return { dispatch({ publish }) { publish(() => {}); } }; } });
  const request = h.request(), pending = h.session.execute(request); await started.promise;
  assert.equal(firstIssue(await h.session.execute(request)), "request_in_flight");
  assert.equal(firstIssue(await h.session.execute({ ...request, action: { ...request.action, arguments: { directory: "D:/other" } } })), "request_id_reused");
  release.resolve(); const result = await pending;
  assert.deepEqual(await h.session.execute(request), result); assert.equal(h.preparations, 1); assert.equal(h.dispatches, 1);
});

test("dispatch guard observes owner-only drift before native effects and follows successful own adoption", async () => {
  for (const drift of [false, true]) {
    const started = gate(), release = gate(); let ownerCurrent = true, effects = 0;
    const h = harness({ prepare() { return { isCurrent: () => ownerCurrent, async dispatch({ isCurrent, recordEffect, publish }) {
      started.resolve(); await release.promise;
      if (!isCurrent()) commandFailure("stale_revision", "Owner changed before native effect.");
      recordEffect({ state: "possiblyChanged" }); effects++;
      recordEffect({ state: "saved" });
      publish(() => { ownerCurrent = false; });
      assert.equal(isCurrent(), true, "own adoption must follow the new revision");
    } }; } });
    const pending = h.session.execute(h.request()); await started.promise;
    if (drift) ownerCurrent = false;
    release.resolve(); const result = await pending;
    assert.equal(result.status, drift ? "rejected" : "applied");
    assert.equal(effects, drift ? 0 : 1); assert.equal(result.result.published, !drift);
  }
});

test("cancellation after publication retains the applied revision and exact effect receipt", async () => {
  const published = gate(), release = gate();
  const h = harness({ prepare({ set }) { return { async dispatch({ publish, recordEffect }) {
    recordEffect({ state: "saved", basename: "final.json" }); publish(() => set(9));
    published.resolve(); await release.promise; return { final: true };
  } }; } });
  const request = h.request(), pending = h.session.execute(request); await published.promise;
  await h.session.execute(h.request({ kind: "cancel", requestId: request.requestId }, null));
  release.resolve(); const result = await pending;
  assert.equal(result.status, "incomplete"); assert.equal(result.result.published, true);
  assert.equal(result.result.effect.basename, "final.json"); assert.deepEqual(result.result.result, { final: true });
  assert.equal(result.revision, 1); assert.equal(h.value, 9);
  assert.deepEqual(await h.session.execute(request), result); assert.equal(h.dispatches, 1);
});

test("failure before effect is rejected and retryable; failure after effect retains an incomplete receipt", async () => {
  for (const withEffect of [false, true]) {
    const h = harness({ prepare() { return { dispatch({ recordEffect }) {
      if (withEffect) recordEffect({ state: "possiblyChanged" });
      throw Error("dispatch failed");
    } }; } });
    const request = h.request(), result = await h.session.execute(request);
    assert.equal(result.status, withEffect ? "incomplete" : "rejected");
    assert.equal(result.result.published, false); assert.equal(result.revision, 0);
    assert.deepEqual(await h.session.execute(request), result); assert.equal(h.dispatches, 1);
  }
});

test("dispatch without publication is incomplete, pure confirmations may publish without an effect", async () => {
  const broken = harness({ prepare() { return { dispatch() { return { prepared: true }; } }; } });
  const request = broken.request(), result = await broken.session.execute(request);
  assert.equal(result.status, "incomplete"); assert.equal(firstIssue(result), "missing_publication");
  assert.equal(result.result.published, false); assert.equal(broken.session.revision, 0);
  assert.deepEqual(await broken.session.execute(request), result);
  const pure = harness(); const applied = await pure.session.execute(pure.request());
  assert.equal(applied.status, "applied"); assert.equal(applied.result.effect, null);
});

test("publication protocol failures retain adoption and prevent a second revision", async () => {
  for (const failure of ["double", "throw", "async", "thenable", "rejection", "before"]) {
    const h = harness({ onBeforeCommit() { if (failure === "before") throw Error("before"); }, prepare({ set }) {
      return { dispatch({ recordEffect, publish }) {
        recordEffect({ state: "saved" });
        if (failure === "async") { publish(async () => set(1)); return; }
        publish(() => {
          set(1); if (failure === "throw") throw Error("install");
          if (failure === "thenable") return Promise.resolve();
          if (failure === "rejection") return Promise.reject(Error("invalid async install"));
        });
        if (failure === "double") publish(() => set(2));
      } };
    } });
    const result = await h.session.execute(h.request());
    assert.equal(result.status, "incomplete", failure);
    assert.equal(result.result.effect.state, "saved");
    assert.equal(h.session.revision, ["async", "before"].includes(failure) ? 0 : 1);
    assert.equal(h.value, ["async", "before"].includes(failure) ? 0 : 1);
  }
});

test("projection, observer and validation failures cannot erase successful adoption", async () => {
  for (const failure of ["projection", "shared", "observer", "validation"]) {
    const h = harness({
      onCommit() { if (failure === "shared") throw Error("shared"); },
      validate() { if (failure === "validation") throw Error("validation"); return []; },
      prepare({ set }) { return { dispatch({ publish }) { publish(() => set(7), () => { if (failure === "projection") throw Error("projection"); }); } }; },
    });
    if (failure === "observer") h.session.subscribe(() => { throw Error("observer"); });
    const result = await h.session.execute(h.request());
    assert.equal(result.status, "incomplete"); assert.equal(result.result.published, true);
    assert.equal(h.value, 7); assert.equal(h.session.revision, 1);
  }
});

test("reentrant rejected reads do not release the synchronous publication lock", async () => {
  const queries = [];
  const h = harness({ prepare() { return { dispatch({ publish }) { publish(() => {
    for (let i = 0; i < 2; i++) {
      queries.push(h.session.execute(h.request({ kind: "catalogue" }, null)));
      assert.equal(h.session.publishing, true);
      assert.throws(() => h.session.snapshot(), error => error.code === "busy");
    }
  }); } }; } });
  assert.equal((await h.session.execute(h.request())).status, "applied");
  for (const query of await Promise.all(queries)) assert.equal(firstIssue(query), "busy");
  assert.equal(h.session.publishing, false);
});

test("oversized acknowledgement retains the prior possiblyChanged receipt; oversized results retain adoption", async () => {
  for (const failure of ["effect", "result"]) {
    const h = harness({ prepare() { return { dispatch({ recordEffect, publish }) {
      recordEffect({ state: "possiblyChanged" });
      if (failure === "effect") recordEffect({ state: "saved", large: "é".repeat(64 * 1024) });
      publish(() => {}); return "x".repeat(64 * 1024);
    } }; } });
    const result = await h.session.execute(h.request());
    assert.equal(firstIssue(result), "result_limit"); assert.equal(result.status, "incomplete");
    assert.deepEqual(result.result.effect, { state: "possiblyChanged" });
    assert.equal(result.result.published, failure === "result");
  }
});

test("escaped maximum issues and two compact receipts fit the reserved result budget", async () => {
  const h = harness({
    validate: () => Array.from({ length: 100 }, () => ({ owner: "P7", field: "\u0000".repeat(200), code: "\u0000".repeat(100), message: "\u0000".repeat(600) })),
    prepare() { return { dispatch({ recordEffect, publish }) {
      recordEffect({ receipt: "x".repeat(65500) }); publish(() => {}); return "x".repeat(65500);
    } }; },
  });
  const request = h.request(), result = await h.session.execute(request);
  assert.equal(result.status, "incomplete"); assert.equal(result.issues.length, 64);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 512 * 1024);
  assert.deepEqual(await h.session.execute(request), result); assert.equal(h.dispatches, 1);
});

test("retry admission rejects before effects and retains exact previous outcomes without eviction", async () => {
  const h = harness();
  // The nested fingerprint must be counted with its own escaping. A request
  // below the 16 MiB input limit can still exceed the 8 MiB retry capacity.
  const huge = h.request({ kind: "perform", operation: "saveRecipe", arguments: { directory: "\u0000".repeat(1250000) } });
  assert.equal(firstIssue(await h.session.execute(huge)), "session_capacity");
  assert.equal(h.dispatches, 0);
  const first = h.request(), firstResult = await h.session.execute(first);
  for (let index = 1; index < 1024; index++) assert.equal((await h.session.execute(h.request())).status, "applied");
  assert.equal(firstIssue(await h.session.execute(h.request())), "session_capacity");
  assert.equal(h.dispatches, 1024); assert.deepEqual(await h.session.execute(first), firstResult);
});
