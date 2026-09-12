import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, open, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { canonicalJson, canonicalSha256 } from "../site/src/research/canonical.js";
import { compilePlannerRecipeV1, parsePlannerRecipeV1, serializePlannerRecipeV1,
  reproducePlannerRecipeV1, reconstructPlannerRecipeSelectionV1 } from "../site/src/research/planner-recipe.js";
import { prepareBrowserPlannerRecipeSave, openBrowserPlannerRecipeFile } from "../site/src/research/planner-recipe-file.js";
import { resolveSavedXrLayoutContribution } from "../site/src/research/xr-layout-recipe.js";
import { createXrLayoutAuthoring } from "../site/src/research/xr-layout-authoring.js";
import { createXrLayoutState } from "../site/src/research/xr-layout-editor.js";
import { serializeXrLayoutProfileV1, createDefaultXrLayoutProfile } from "../site/src/research/xr-layout.js";
import { projectWorkspaceVideoDisplayGeometry } from "../site/src/research/workspace-contribution.js";
import { projectVideoDisplayGeometry } from "../site/src/research/video-catalogue-contribution.js";
import { plannerLayoutIdentityV1 } from "../site/src/research/planner-recipe-reproduction.js";

const masters = await Promise.all(["planner-recipe-v1", "planner-recipe-locations-v1"].map(async name =>
  JSON.parse(await readFile(new URL(`fixtures/${name}.canonical.json`, import.meta.url)))));
const spatial = JSON.parse(await readFile(new URL("fixtures/xr-layout-recipe-v1.json", import.meta.url)));
const encoder = new TextEncoder();
function core(profile = null, masterIndex = 1) {
  const { integrity, ...value } = structuredClone(masters[masterIndex]);
  value.presentationTarget = profile ? "webxr-immersive-vr" : "desktop-screen";
  value.segments.P6 = profile ? { status: "included", profile: structuredClone(profile) } : { status: "excluded" };
  return value;
}
const selector = ({ variantId, languageId, languageSelectionPath, presentationTarget }) =>
  ({ variantId, languageId, languageSelectionPath, presentationTarget });

test("complete master retains and reconstructs every spatial field through canonical reopen", async () => {
  for (const masterIndex of [0, 1]) for (const profile of spatial.profiles) {
    const input = core(profile, masterIndex), recipe = await compilePlannerRecipeV1(input);
    const source = await serializePlannerRecipeV1(recipe), document = await parsePlannerRecipeV1(encoder.encode(source));
    assert.equal(await serializePlannerRecipeV1(document.recipe), source);
    assert.deepEqual(document.recipe.segments, input.segments);
    assert.equal(serializeXrLayoutProfileV1(document.recipe.segments.P6.profile), serializeXrLayoutProfileV1(profile));
    const expected = await resolveSavedXrLayoutContribution(profile, {
      workspaceContribution: input.segments.P1, feedbackContribution: input.segments.P5,
      selectedTarget: input.presentationTarget,
    });
    const matrix = await reproducePlannerRecipeV1(document.recipe);
    const presentation = matrix.presentations.find(value => value.presentationTarget === "webxr-immersive-vr");
    const media = (await projectVideoDisplayGeometry(input.segments.P1.videoCatalogue)).videos;
    const identity = plannerLayoutIdentityV1(input.presentationTarget, profile, media, input.segments.P5);
    assert.equal(matrix.algorithmVersion, "planner-recipe-reproduction-v2");
    assert.equal(presentation.layoutIdentitySha256, await canonicalSha256(identity));
    assert.equal(Object.hasOwn(presentation, "layoutSha256"), false, "portable input identity is explicitly distinct from raw geometry hashing");
    assert.equal(matrix.presentations.length, 2, "the explicitly authored desktop profile also survives");
    for (const item of matrix.cases.filter(value => value.presentationTarget === "webxr-immersive-vr")) {
      const selected = await reconstructPlannerRecipeSelectionV1(document.recipe, selector(item));
      assert.deepEqual(selected.layout, expected);
      assert.deepEqual(selected.feedback, input.segments.P5);
      assert.deepEqual(selected.assets, input.segments.P1.videoCatalogue.entries);
      await assert.rejects(reconstructPlannerRecipeSelectionV1(document.recipe,
        { ...selector(item), presentationTarget: "desktop-screen" }), /presentation target/u);
    }
  }
  const desktop = await compilePlannerRecipeV1(core());
  assert.deepEqual(desktop.segments.P6, { status: "excluded" });
  assert.equal((await reproducePlannerRecipeV1(desktop)).presentations.length, 1);
});

test("full master rejects missing XR configuration, incompatible targets and stale integrity", async () => {
  const profile = spatial.profiles[0];
  for (const change of [
    value => { value.presentationTarget = "desktop-screen"; },
    value => { value.segments.P6 = { status: "excluded" }; },
    value => { delete value.segments.P6.profile.video.rollDegrees; },
    value => { value.segments.P6.profile.alignment.trackingLossPolicy = "continue"; },
  ]) {
    const input = core(profile); change(input);
    await assert.rejects(compilePlannerRecipeV1(input));
  }
  const excluded = core(); excluded.segments.P6.profile = profile;
  await assert.rejects(compilePlannerRecipeV1(excluded));
  const altered = structuredClone(await compilePlannerRecipeV1(core(profile)));
  altered.segments.P6.profile.video.distanceMetres += 0.1;
  await assert.rejects(parsePlannerRecipeV1(encoder.encode(`${canonicalJson(altered)}\n`)), /integrity/u);
});

test("P7 writer persists and rereads the complete XR master through a disk-backed file adapter", async () => {
  const directory = await mkdtemp(join(tmpdir(), "affect-p6-master-")), path = join(directory, "experiment.json");
  let exists = false;
  const handle = { kind: "file",
    async createWritable() {
      const file = await open(path, "w"); exists = true;
      return { write: bytes => file.writeFile(bytes), close: () => file.close(), abort: () => file.close() };
    },
    async getFile() {
      const bytes = await readFile(path);
      return { size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
    },
  };
  try {
    for (const profile of spatial.profiles) {
      const source = await serializePlannerRecipeV1(await compilePlannerRecipeV1(core(profile)));
      const writer = await prepareBrowserPlannerRecipeSave(source, { isCurrent: () => true, pickSaveFile: () => handle });
      const receipt = await writer.chooseAndSave();
      assert.equal(await readFile(path, "utf8"), source);
      const reopened = await openBrowserPlannerRecipeFile({ isCurrent: () => true, pickOpenFile: () => [handle] });
      assert.equal(reopened.kind, "planner-recipe-v1");
      assert.equal(reopened.document.canonicalSourceByteSha256, receipt.canonicalSourceByteSha256);
      assert.deepEqual(reopened.document.recipe.segments.P6, { status: "included", profile });
    }
  } finally {
    if (exists) await unlink(path);
    await rmdir(directory);
  }
});

test("a parsed complete master restores editable XR content without accepting missing media", async () => {
  const document = await parsePlannerRecipeV1(encoder.encode(await serializePlannerRecipeV1(
    await compilePlannerRecipeV1(core(spatial.profiles[0])))));
  const state = createXrLayoutState();
  const snapshot = (contribution, revision, pending = false) => ({ revision, enabled: true, pending, contribution, dependencyRevisions: [] });
  let dependencies = { P1: snapshot(null, 51, true), P5: snapshot(document.recipe.segments.P5, 53) };
  const editor = { getSnapshot: state.getSnapshot, getDraft: state.getDraft,
    setDependencies: value => state.setDependencyRevisions({ catalogue: value.catalogueRevision, feedback: value.feedbackRevision }),
    acceptLayout: () => { state.accept(); return state.getSnapshot(); },
    restoreDraft: value => { state.loadDraft(serializeXrLayoutProfileV1(value)); return state.getSnapshot(); },
    restoreExcluded: () => { state.resetExcluded(); return state.getSnapshot(); },
  };
  const authoring = createXrLayoutAuthoring({ editor, getDependencies: () => dependencies,
    projectCatalogue: projectWorkspaceVideoDisplayGeometry, subscribe: [] });
  try {
    await authoring.refresh();
    const reopened = authoring.restoreSelection(document.recipe.segments.P6, { isCurrent: () => true });
    assert.equal(reopened.pending, true); assert.equal(reopened.contribution, null);
    assert.deepEqual(state.getDraft(), spatial.profiles[0]);
    await assert.rejects(authoring.prepare());
    dependencies = { ...dependencies, P1: snapshot(document.recipe.segments.P1, 54) };
    await authoring.refresh();
    const prepared = await authoring.prepare();
    assert.deepEqual(prepared.contribution, spatial.profiles[0]);
    assert.equal(prepared.dependencyRevisions[0].revision, 54);
    const excluded = await compilePlannerRecipeV1(core());
    authoring.restoreSelection(excluded.segments.P6, { isCurrent: () => true });
    assert.equal(state.getSnapshot().enabled, false);
    assert.equal(state.getSnapshot().contribution, null);
    assert.deepEqual(state.getDraft(), createDefaultXrLayoutProfile());
  } finally { authoring.destroy(); }
});

test("independent full-master processes reproduce identical XR bytes and every spatial selection", async () => {
  const run = promisify(execFile), entry = fileURLToPath(new URL("fixtures/planner-xr-instance.js", import.meta.url));
  const outputs = await Promise.all(["UTC", "Europe/Berlin"].map(TZ => run(process.execPath, [entry], {
    windowsHide: true, env: { ...process.env, TZ, LANG: TZ === "UTC" ? "en-US" : "de-DE" },
  })));
  assert.equal(outputs[0].stdout, outputs[1].stdout);
  const receipts = JSON.parse(outputs[0].stdout);
  assert.equal(receipts.length, spatial.profiles.length * masters.length);
  for (const [index, receipt] of receipts.entries()) {
    assert.deepEqual(JSON.parse(receipt.source).segments.P6.profile, spatial.profiles[index % spatial.profiles.length]);
    assert.equal(JSON.parse(receipt.source).segments.P1.version, index < spatial.profiles.length ? 1 : 2);
    assert.ok(receipt.selections.length > 0);
    assert.equal(receipt.selections.length, receipt.matrix.cases.filter(value => value.presentationTarget === "webxr-immersive-vr").length);
  }
});

test("the native-consumer XR master fixture matches the actual full compiler and P6 projection", async () => {
  const recipe = await compilePlannerRecipeV1(core(spatial.profiles[0]));
  const source = await readFile(new URL("fixtures/planner-recipe-xr-current-v1.canonical.json", import.meta.url), "utf8");
  const matrix = JSON.parse(await readFile(new URL("fixtures/planner-recipe-xr-current-v1-reproduction.json", import.meta.url)));
  const layout = JSON.parse(await readFile(new URL("fixtures/planner-xr-master-v1-layout.json", import.meta.url)));
  assert.equal(await serializePlannerRecipeV1(recipe), source);
  assert.deepEqual(await reproducePlannerRecipeV1(recipe), matrix);
  assert.deepEqual(await resolveSavedXrLayoutContribution(recipe.segments.P6.profile, {
    workspaceContribution: recipe.segments.P1, feedbackContribution: recipe.segments.P5, selectedTarget: recipe.presentationTarget,
  }), layout);
});

test("historical raw-geometry XR master retains its exact reader semantics and fixture bytes", async () => {
  const source = await readFile(new URL("fixtures/planner-xr-master-v1.canonical.json", import.meta.url), "utf8");
  const matrix = JSON.parse(await readFile(new URL("fixtures/planner-xr-master-v1-reproduction.json", import.meta.url)));
  const old = await parsePlannerRecipeV1(encoder.encode(source));
  assert.equal(old.recipe.integrity.algorithmVersion, "planner-recipe-reproduction-v1");
  assert.equal(await serializePlannerRecipeV1(old.recipe), source);
  assert.deepEqual(await reproducePlannerRecipeV1(old.recipe), matrix);
  assert.ok(matrix.presentations.every(value => Object.hasOwn(value, "layoutSha256") && !Object.hasOwn(value, "layoutIdentitySha256")));
  const current = await compilePlannerRecipeV1(core(spatial.profiles[0]));
  assert.deepEqual(current.segments, old.recipe.segments, "portable hashing changes no authored content");
  assert.equal(current.integrity.definitionSha256, old.recipe.integrity.definitionSha256);
  assert.notEqual(current.integrity.reproductionSha256, old.recipe.integrity.reproductionSha256);
});
