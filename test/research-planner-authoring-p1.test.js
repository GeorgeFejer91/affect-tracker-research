import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPlannerWorkspaceCommandOwner, P1_PLANNER_OPERATIONS } from "../site/src/research/planner-authoring-p1.js";
import { createPlannerAuthoringSession } from "../site/src/research/planner-authoring-session.js";
import { PLANNER_COMMAND_SCHEMA } from "../site/src/research/planner-authoring-contract.js";
import { createStudyIdentityV1 } from "../site/src/research/study-identity.js";
import { renderResearchUiMarkup } from "../site/src/research/ui-view.js";
import { createWorkspaceContribution } from "../site/src/research/workspace-contribution.js";

const fixtureUrl = new URL("./fixtures/research-video-catalogue-contribution-v2.json", import.meta.url);
const WORKSPACE_GRANT = "10000000-0000-4000-8000-000000000001";
const VIDEO_GRANT = "10000000-0000-4000-8000-000000000002";
const FOLDER_GRANT = "10000000-0000-4000-8000-000000000003";

async function harness({ selected = true } = {}) {
  const catalogue = JSON.parse(await readFile(fixtureUrl, "utf8"));
  let draft = { id: "video-affect-study", title: "Video Affect Study" };
  let snapshot = {
    revision: 12,
    enabled: true,
    pending: false,
    contribution: createWorkspaceContribution({ study: createStudyIdentityV1(draft), videoCatalogue: catalogue }),
    dependencyRevisions: [],
  };
  let commits = 0;
  let publications = 0;
  const operations = [];
  const owner = createPlannerWorkspaceCommandOwner({
    readStudyDraft: () => ({ ...draft }),
    commitStudyDraft(value) {
      draft = structuredClone(value);
      commits += 1;
    },
    afterCommitStudyDraft() {
      try {
        snapshot = {
          ...snapshot,
          revision: snapshot.revision + 1,
          pending: false,
          contribution: createWorkspaceContribution({ study: createStudyIdentityV1(draft), videoCatalogue: catalogue }),
        };
      } catch {
        snapshot = { ...snapshot, revision: snapshot.revision + 1, pending: true, contribution: null };
      }
      publications += 1;
    },
    readWorkspaceSelection: () => ({ selected, label: selected ? "Affect Research" : null }),
    getWorkspaceContributionSnapshot: () => structuredClone(snapshot),
    async performWorkspaceOperation(operation, args) {
      operations.push({ operation, args: structuredClone(args) });
      return { operation, completed: true, sequence: operations.length };
    },
  });
  const session = createPlannerAuthoringSession({ owners: [owner] });
  const request = (action, expectedRevision = null) => ({
    schema: PLANNER_COMMAND_SCHEMA,
    version: 1,
    sessionId: session.sessionId,
    requestId: crypto.randomUUID(),
    expectedRevision,
    action,
  });
  return {
    catalogue, owner, session, request, operations,
    get draft() { return structuredClone(draft); },
    get snapshot() { return structuredClone(snapshot); },
    set snapshot(value) { snapshot = structuredClone(value); },
    set draft(value) { draft = structuredClone(value); },
    get commits() { return commits; },
    get publications() { return publications; },
  };
}

test("CLI P1 catalogue exposes two authored fields, read-only media facts, and closed consequential operations", async () => {
  const h = await harness();
  const response = await h.session.execute(h.request({ kind: "catalogue" }));
  const p1 = response.result.settings.filter(setting => setting.id.startsWith("P1."));
  assert.deepEqual(p1.filter(setting => setting.writable).map(setting => setting.id), ["P1.study.id", "P1.study.title"]);
  assert.ok(p1.filter(setting => setting.classification === "derived").every(setting => !setting.writable));
  assert.deepEqual(response.result.operations.map(({ owner, id }) => [owner, id]), [
    ["P1", "selectWorkspace"], ["P1", "importVideos"], ["P1", "rescanVideoLibrary"],
  ]);
  assert.ok(P1_PLANNER_OPERATIONS.every(operation => operation.consequential && !operation.atomic));
  assert.deepEqual(p1.slice(0, 2).map(({ uiControl, recipePath }) => [uiControl, recipePath]), [
    ["#experiment-id", "segments.P1.study.id"], ["#experiment-title", "segments.P1.study.title"],
  ]);
  assert.deepEqual(response.result.operations.map(({ uiControl, recipeOutcome }) => [uiControl, recipeOutcome]), [
    ["#workspace-choose", "segments.P1 is regenerated after the native grant is adopted and media is freshly verified; no absolute path is serialized."],
    [{ videos: "#video-import", folder: "#video-folder-import" }, "Freshly verified locations replace segments.P1.videoCatalogue.entries; hashes, duration, and oriented geometry stay derived."],
    ["#workspace-rescan", "The current authorized directory is re-enumerated and segments.P1.videoCatalogue is replaced only after exact fresh verification."],
  ]);
});

test("every documented P1 CLI setting and operation maps to an existing Planner UI surface and JSON outcome", async () => {
  const h = await harness();
  const markup = renderResearchUiMarkup("tauri");
  const catalogue = (await h.session.execute(h.request({ kind: "catalogue" }))).result;
  const selectors = catalogue.settings.map(setting => setting.uiControl)
    .concat(catalogue.operations.flatMap(operation => typeof operation.uiControl === "string"
      ? [operation.uiControl] : Object.values(operation.uiControl)));
  for (const selector of selectors) {
    if (selector.startsWith("#")) assert.match(markup, new RegExp(`id=["']${selector.slice(1)}["']`, "u"), selector);
    else assert.match(markup, new RegExp(`class=["'][^"']*${selector.slice(1)}[^"']*["']`, "u"), selector);
  }
  for (const { recipePath } of catalogue.settings.filter(setting => setting.recipePath !== null)) {
    assert.ok(recipePath === "segments.P1" || recipePath.startsWith("segments.P1."), recipePath);
  }
  assert.match(markup, /id="workspace-choose"[^>]*>Set work directory</u);
  assert.match(markup, /id="video-import"[^>]*>Add video files</u);
  assert.match(markup, /id="video-folder-import"[^>]*>Add video folder</u);
  assert.match(markup, /id="workspace-rescan"[^>]*>Rescan library</u);
});

test("every writable P1 setting performs typed set/get/readback against the sole study draft", async () => {
  const h = await harness();
  for (const [field, value] of [["P1.study.id", "updated-study"], ["P1.study.title", "Updated study title"]]) {
    const set = await h.session.execute(h.request({ kind: "set", field, value }, h.session.revision));
    assert.equal(set.status, "applied", field);
    assert.equal((await h.session.execute(h.request({ kind: "get", field }))).result.value, value);
  }
  assert.deepEqual(h.draft, { id: "updated-study", title: "Updated study title" });
  assert.deepEqual(h.snapshot.contribution.study, createStudyIdentityV1(h.draft));
  assert.equal(h.commits, 2);
});

test("P1 batch stages one detached candidate and publishes only after every owner can commit", async () => {
  const h = await harness();
  const staged = h.owner.stage([
    { kind: "set", field: "P1.study.title", value: "Detached title" },
    { kind: "set", field: "P1.study.id", value: "detached-id" },
  ], { isCurrent: () => true, signal: { aborted: false } });
  assert.deepEqual(h.draft, { id: "video-affect-study", title: "Video Affect Study" });
  const candidate = await staged;
  assert.deepEqual(h.draft, { id: "video-affect-study", title: "Video Affect Study" });
  candidate.commit();
  assert.deepEqual(h.draft, { id: "detached-id", title: "Detached title" });
  assert.equal(h.commits, 1);
  assert.equal(h.snapshot.revision, 12);
  assert.equal(h.publications, 0);
  candidate.afterCommit();
  assert.equal(h.snapshot.revision, 13);
  assert.deepEqual(h.snapshot.contribution.study, createStudyIdentityV1(h.draft));
  assert.equal(h.publications, 1);
});

test("derived workspace and complete media catalogue remain exact and read-only", async () => {
  const h = await harness();
  const snapshot = await h.session.execute(h.request({ kind: "snapshot" }));
  const values = snapshot.result.owners.P1.values;
  assert.equal(values["P1.workspace.selected"], true);
  assert.equal(values["P1.workspace.displayName"], "Affect Research");
  assert.deepEqual(values["P1.workspace.layout"], { assetRoot: "assets", videoLibrary: "assets/stimuli", projectFile: "experiment.package.json" });
  assert.deepEqual(values["P1.workspace.snapshot"], h.snapshot);
  assert.deepEqual(values["P1.media.catalogue"], h.catalogue);
  assert.equal(values["P1.media.count"], h.catalogue.entries.length);
  assert.equal(values["P1.media.ready"], true);
  const before = h.draft;
  for (const field of ["P1.workspace.selected", "P1.workspace.layout", "P1.workspace.snapshot", "P1.media.catalogue", "P1.media.count"]) {
    const result = await h.session.execute(h.request({ kind: "set", field, value: null }, h.session.revision));
    assert.equal(result.issues[0].code, "read_only", field);
  }
  assert.deepEqual(h.draft, before);
  assert.equal(h.commits, 0);
});

test("invalid GUI study draft and unavailable media are reported without fallback values", async () => {
  const h = await harness({ selected: false });
  h.draft = { id: "INVALID ID", title: "" };
  h.snapshot = { ...h.snapshot, revision: 13, pending: true, contribution: null };
  const read = h.owner.read();
  assert.equal(read.values["P1.study.id"], "INVALID ID");
  assert.equal(read.values["P1.study.title"], "");
  assert.equal(read.values["P1.workspace.displayName"], "");
  assert.equal(read.values["P1.media.ready"], false);
  assert.equal(read.values["P1.media.pending"], true);
  assert.equal(read.values["P1.media.catalogue"], null);
  assert.deepEqual(read.issues.map(({ code }) => code), ["invalid_study_identity", "workspace_unselected"]);
});

test("bounded but incomplete study edits commit visibly and validation blocks readiness", async () => {
  const h = await harness();
  const result = await h.session.execute(h.request({ kind: "set", field: "P1.study.id", value: "Not valid" }, 0));
  assert.equal(result.status, "incomplete");
  assert.equal(result.issues[0].code, "invalid_study_identity");
  assert.equal((await h.session.execute(h.request({ kind: "get", field: "P1.study.id" }))).result.value, "Not valid");
  assert.equal(h.commits, 1);
});

test("stale staging and workspace dependency drift cannot mutate the study draft", async () => {
  const h = await harness();
  const before = h.draft;
  await assert.rejects(h.owner.stage([
    { kind: "set", field: "P1.study.title", value: "Stale title" },
  ], { isCurrent: () => false, signal: { aborted: false } }), error => error.code === "stale_revision");
  assert.deepEqual(h.draft, before);

  let calls = 0;
  const original = h.snapshot;
  const owner = createPlannerWorkspaceCommandOwner({
    readStudyDraft: () => before,
    commitStudyDraft() { throw new Error("must not commit"); },
    afterCommitStudyDraft() { throw new Error("must not publish"); },
    readWorkspaceSelection: () => ({ selected: true, label: "Workspace" }),
    getWorkspaceContributionSnapshot() {
      calls += 1;
      return calls === 1 ? original : { ...original, revision: original.revision + 1 };
    },
    performWorkspaceOperation: async () => null,
  });
  await assert.rejects(owner.stage([
    { kind: "set", field: "P1.study.title", value: "Dependency changed" },
  ], { isCurrent: () => true, signal: { aborted: false } }), error => error.code === "dependency_changed");
  assert.deepEqual(h.draft, before);
});

test("native workspace operations cannot enter atomic edit staging", async () => {
  const h = await harness();
  const result = await h.session.execute(h.request({ kind: "apply", edits: [
    { kind: "set", field: "P1.study.title", value: "Must stay unchanged" },
    { kind: "operation", owner: "P1", operation: "rescanVideoLibrary", arguments: {} },
  ] }, 0));
  assert.equal(result.status, "rejected");
  assert.equal(result.issues[0].code, "consequential_operation");
  assert.deepEqual(h.draft, { id: "video-affect-study", title: "Video Affect Study" });
  assert.equal(h.commits, 0);
  assert.equal(h.operations.length, 0);
});

test("separate P1 operation dispatcher validates exact arguments and returns the native receipt", async () => {
  const h = await harness();
  assert.deepEqual(await h.owner.runOperation("selectWorkspace", { workspaceGrantId: WORKSPACE_GRANT }), { operation: "selectWorkspace", completed: true, sequence: 1 });
  assert.deepEqual(await h.owner.runOperation("importVideos", { selectionKind: "videos", selectionGrantId: VIDEO_GRANT }), { operation: "importVideos", completed: true, sequence: 2 });
  assert.deepEqual(await h.owner.runOperation("importVideos", { selectionKind: "folder", selectionGrantId: FOLDER_GRANT }), { operation: "importVideos", completed: true, sequence: 3 });
  assert.deepEqual(await h.owner.runOperation("rescanVideoLibrary", {}), { operation: "rescanVideoLibrary", completed: true, sequence: 4 });
  assert.deepEqual(h.operations.map(({ operation, args }) => [operation, args]), [
    ["selectWorkspace", { workspaceGrantId: WORKSPACE_GRANT }],
    ["importVideos", { selectionKind: "videos", selectionGrantId: VIDEO_GRANT }],
    ["importVideos", { selectionKind: "folder", selectionGrantId: FOLDER_GRANT }], ["rescanVideoLibrary", {}],
  ]);
  for (const [operation, args] of [
    ["selectWorkspace", { path: "C:/arbitrary" }], ["selectWorkspace", { workspaceGrantId: "not-a-grant" }],
    ["importVideos", {}], ["importVideos", { selectionKind: "all", selectionGrantId: VIDEO_GRANT }],
    ["importVideos", { selectionKind: "videos", path: "C:/arbitrary" }], ["unknown", {}],
  ]) await assert.rejects(h.owner.runOperation(operation, args), error => ["invalid_operation_arguments", "unknown_operation"].includes(error.code));
  assert.equal(h.operations.length, 4);
});

test("operation guards prevent native work before cancellation and expose uncertain late outcomes", async () => {
  const h = await harness();
  await assert.rejects(h.owner.runOperation("rescanVideoLibrary", {}, { isCurrent: () => false, signal: { aborted: false } }), error => error.code === "canceled");
  assert.equal(h.operations.length, 0);

  let current = true;
  const pending = h.owner.runOperation("rescanVideoLibrary", {}, { isCurrent: () => current, signal: { aborted: false } });
  current = false;
  await assert.rejects(pending, error => error.code === "operation_outcome_unknown");
  assert.equal(h.operations.length, 1);
});
