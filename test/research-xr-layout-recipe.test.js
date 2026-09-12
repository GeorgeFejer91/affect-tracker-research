import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../site/src/research/canonical.js";
import { resolveSavedXrLayoutContribution } from "../site/src/research/xr-layout-recipe.js";
import { serializeXrLayoutProfileV1, parseXrLayoutProfileV1 } from "../site/src/research/xr-layout.js";
import { resolveFeedbackEnvelope } from "../site/src/research/feedback-layout.js";
import { resolveXrFeedbackFootprintV1 } from "../site/src/research/xr-layout-feedback.js";
import { createWorkspaceContribution, projectWorkspaceVideoDisplayGeometry } from "../site/src/research/workspace-contribution.js";
import { resolveXrLayoutDependencies, resolveXrLayoutContribution } from "../site/src/research/xr-layout-authoring.js";

const fixture = JSON.parse(await readFile(new URL("fixtures/xr-layout-recipe-v1.json", import.meta.url)));
const options = () => ({ workspaceContribution: structuredClone(fixture.workspace),
  feedbackContribution: structuredClone(fixture.feedback), selectedTarget: "webxr-immersive-vr" });

test("pure saved XR geometry retains every authored field and all declared videos without a live snapshot", async () => {
  for (const profile of fixture.profiles) {
    const before = canonicalJson(profile), inputs = options();
    const compiled = await resolveSavedXrLayoutContribution(profile, inputs);
    assert.equal(canonicalJson(compiled.profile), before);
    assert.deepEqual(Object.keys(compiled).sort(), ["feedback", "profile", "requirements", "videos"]);
    assert.equal(compiled.videos.length, fixture.workspace.videoCatalogue.entries.length);
    assert.deepEqual(compiled.videos.map(({ assetId }) => assetId), fixture.workspace.videoCatalogue.entries.map(({ assetId }) => assetId));
    assert.deepEqual(compiled.profile.alignment, profile.alignment);
    assert.equal(compiled.feedback.visible, profile.feedback.enabled);
    assert.equal(compiled.feedback.referenceViewportCssPx, 1024);
    assert.equal(serializeXrLayoutProfileV1(compiled.profile), serializeXrLayoutProfileV1(profile));
    assert.equal(Object.hasOwn(compiled, "dependencyRevisions"), false);
    assert.equal(Object.hasOwn(compiled, "revision"), false);
    assert.deepEqual(inputs, options());
  }
});

test("saved XR validation rejects unsupported targets and altered full owner content", async () => {
  for (const target of [null, undefined, "desktop-screen", "unknown"]) {
    await assert.rejects(resolveSavedXrLayoutContribution(fixture.profiles[0], { ...options(), selectedTarget: target }));
  }
  for (const mutate of [
    (value) => { value.workspaceContribution.study.title = ""; },
    (value) => { value.workspaceContribution.workspaceLayout.assetRoot = "C:/ambient"; },
    (value) => { value.workspaceContribution.videoCatalogue.entries[1].geometry.displayWidthPx += 1; },
    (value) => { value.feedbackContribution.importedBound = 1; },
    (value) => { value.feedbackContribution.visual.grid.cursorSize = null; },
  ]) {
    const inputs = options(); mutate(inputs);
    await assert.rejects(resolveSavedXrLayoutContribution(fixture.profiles[0], inputs));
  }
});

test("saved XR validation captures caller content before asynchronous hashing", async () => {
  const inputs = options(), profile = structuredClone(fixture.profiles[0]);
  const pending = resolveSavedXrLayoutContribution(profile, inputs);
  profile.video.widthMetres = 0;
  inputs.workspaceContribution.videoCatalogue.entries[0].geometry.displayWidthPx = 0;
  inputs.feedbackContribution.visual.grid.cursorSize = 0;
  const resolved = await pending;
  assert.deepEqual(resolved.profile, fixture.profiles[0]);
  assert.deepEqual(resolved, await resolveSavedXrLayoutContribution(fixture.profiles[0], options()));
});

test("saved and live XR use the P1 v2 owner projection for repeated content at different locations", async () => {
  const catalogue = JSON.parse(await readFile(new URL("fixtures/research-video-catalogue-contribution-v2.json", import.meta.url)));
  const workspace = createWorkspaceContribution({ study: fixture.workspace.study, videoCatalogue: catalogue });
  const before = canonicalJson(workspace), profile = fixture.profiles[0];
  const inputs = { workspaceContribution: workspace, feedbackContribution: fixture.feedbackV2, selectedTarget: profile.target };
  const saved = await resolveSavedXrLayoutContribution(profile, inputs);
  const snapshot = (contribution, revision) => ({ revision, enabled: true, pending: false, contribution, dependencyRevisions: [] });
  const dependencies = await resolveXrLayoutDependencies({ P1: snapshot(workspace, 41),
    P5: snapshot(fixture.feedbackV2, 43) }, projectWorkspaceVideoDisplayGeometry);
  assert.deepEqual(resolveXrLayoutContribution(profile, dependencies, profile.target), saved);
  assert.equal(dependencies.catalogueRevision, 41, "bind the owner revision, not the persisted catalogue revision");
  assert.equal(catalogue.entries.length, 2);
  assert.notEqual(catalogue.entries[0].annotationId, catalogue.entries[1].annotationId);
  assert.equal(saved.videos.length, 1, "P1 projects one geometry for identical content");
  assert.equal(saved.videos[0].assetId, catalogue.entries[0].assetId);
  assert.equal(canonicalJson(workspace), before, "both authored locations remain in the master workspace input");
  assert.deepEqual(saved.profile, profile);
  const tampered = structuredClone(workspace);
  tampered.videoCatalogue.entries[1].geometry.displayWidthPx += 1;
  await assert.rejects(resolveSavedXrLayoutContribution(profile, { ...inputs, workspaceContribution: tampered }));
  const unsupported = { ...workspace, version: 3 };
  await assert.rejects(resolveSavedXrLayoutContribution(profile, { ...inputs, workspaceContribution: unsupported }));
});

test("saved XR uses P5's complete successor renderer and halo envelope without truncation", async () => {
  for (const renderer of ["flubber", "grid", "procedural-face"]) for (const gradient of [false, true]) {
    const feedback = structuredClone(fixture.feedbackV2);
    feedback.presentation.renderer = renderer; feedback.presentation.halo.gradient = gradient;
    const before = canonicalJson(feedback), envelope = resolveFeedbackEnvelope(feedback, 1024);
    const resolved = await resolveSavedXrLayoutContribution(fixture.profiles[0], { ...options(), feedbackContribution: feedback });
    assert.equal(resolved.feedback.configurationKey, envelope.configurationKey);
    assert.equal(resolved.feedback.metresPerCssPx, resolved.feedback.halfExtentMetres / envelope.halfExtentCssPx);
    assert.equal(canonicalJson(feedback), before);
  }
  for (const field of ["presentation", "response"]) {
    const incomplete = structuredClone(fixture.feedbackV2); delete incomplete[field];
    await assert.rejects(resolveSavedXrLayoutContribution(fixture.profiles[0], { ...options(), feedbackContribution: incomplete }));
  }
});

test("V2 P5 bounds and XR geometry match the shared Rust/JavaScript fixture", async () => {
  const shared = JSON.parse(await readFile(new URL("fixtures/xr-feedback-envelope-v2.json", import.meta.url)));
  for (const item of shared.cases) {
    const envelope = resolveFeedbackEnvelope(item.configuration, 1024);
    assert.deepEqual(envelope, item.envelope);
    assert.deepEqual(resolveXrFeedbackFootprintV1(item.profile, envelope), item.expected);
    assert.throws(() => resolveXrFeedbackFootprintV1(item.profile, { ...envelope, algorithmVersion: "feedback-envelope-v3" }));
  }
});

test("independent saved-content processes reproduce exact profiles and geometry without ambient state", async () => {
  const run = promisify(execFile), entry = fileURLToPath(new URL("fixtures/xr-recipe-instance.js", import.meta.url));
  const results = await Promise.all(["UTC", "Europe/Berlin"].map((TZ) => run(process.execPath, [entry], {
    windowsHide: true, env: { ...process.env, TZ, LANG: TZ === "UTC" ? "en-US" : "de-DE" },
  })));
  assert.equal(results[0].stdout, results[1].stdout);
  const receipts = JSON.parse(results[0].stdout);
  assert.equal(receipts.length, fixture.profiles.length * 4);
  for (let index = 0; index < receipts.length; index += 1) {
    assert.deepEqual(parseXrLayoutProfileV1(receipts[index].source), fixture.profiles[index % fixture.profiles.length]);
    const workspaceVersion = index < fixture.profiles.length * 2 ? 1 : 2;
    assert.equal(JSON.parse(receipts[index].workspaceSource).version, workspaceVersion);
    assert.equal(JSON.parse(receipts[index].workspaceSource).videoCatalogue.entries.length, 2);
    assert.equal(receipts[index].compiled.videos.length, workspaceVersion === 1 ? 2 : 1);
    assert.equal(receipts[index].feedbackSource, canonicalJson(index % (fixture.profiles.length * 2) < fixture.profiles.length ? fixture.feedback : fixture.feedbackV2));
  }
});
