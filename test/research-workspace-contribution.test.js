import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createStudyIdentityV1 } from "../site/src/research/study-identity.js";
import { createVideoCatalogueContributionV1 } from "../site/src/research/video-catalogue-contribution.js";
import {
  createWorkspaceContribution,
  createWorkspaceContributionV1,
  createWorkspaceContributionProducer,
  createWorkspaceContributionProducerV1,
  prepareWorkspaceContentRestore,
  prepareWorkspaceContentRestoreV1,
  projectVideoCatalogueSnapshotV1,
  projectWorkspaceVideoCatalogueSnapshot,
  projectWorkspaceVideoCatalogueSnapshotV1,
  projectWorkspaceVideoDisplayGeometry,
  projectWorkspaceVideoDisplayGeometryV1,
  validateWorkspaceContribution,
  validateWorkspaceContributionV1,
  verifyWorkspaceRestoredVideoEntries,
  verifyWorkspaceRestoredVideoEntriesV1,
} from "../site/src/research/workspace-contribution.js";

const fixtureUrl = new URL("./fixtures/research-video-catalogue-contribution-v1.json", import.meta.url);
const fixtureV2Url = new URL("./fixtures/research-video-catalogue-contribution-v2.json", import.meta.url);

test("P1 workspace v2 keeps duplicate-content locations and composes the current producer", async () => {
  const videoCatalogue = JSON.parse(await readFile(fixtureV2Url, "utf8"));
  const study = createStudyIdentityV1({ id: "video-affect-study", title: "Video Affect Study" });
  const contribution = createWorkspaceContribution({ study, videoCatalogue });
  assert.equal(contribution.version, 2);
  assert.deepEqual(await validateWorkspaceContribution(contribution), contribution);
  const plan = await prepareWorkspaceContentRestore(contribution);
  assert.equal(plan.requiresVideoLibraryRebind, true);
  assert.deepEqual(plan.videoDeclarations.map(({ annotationId }) => annotationId), [
    "session%5Fa_clip.mp4", "session-a_clip.mp4",
  ]);
  assert.deepEqual(
    await verifyWorkspaceRestoredVideoEntries(contribution, videoCatalogue.entries),
    videoCatalogue,
  );

  let source = { revision: 4, enabled: true, pending: false, contribution: videoCatalogue, dependencyRevisions: [] };
  const producer = createWorkspaceContributionProducer({
    getStudyIdentity: () => study,
    getVideoCatalogueSnapshot: () => source,
  });
  const snapshot = producer.getSnapshot();
  assert.equal(snapshot.contribution.version, 2);
  assert.equal((await projectWorkspaceVideoCatalogueSnapshot(snapshot)).contribution.version, 2);
  assert.deepEqual(await projectWorkspaceVideoDisplayGeometry(snapshot), {
    revision: 1,
    pending: false,
    videos: [{
      assetId: `asset-${"d".repeat(64)}`, displayWidth: 1_920, displayHeight: 1_080,
    }],
  });
  source = { ...source, pending: true, contribution: null };
  assert.equal(producer.changed().pending, true);
});

test("P1 workspace contribution combines editable study content and fixed relative layout without filesystem authority", async () => {
  const videoCatalogue = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const contribution = createWorkspaceContributionV1({
    study: createStudyIdentityV1({ id: "video-affect-study", title: "Video Affect Study" }),
    videoCatalogue,
  });
  assert.deepEqual(contribution.workspaceLayout, {
    assetRoot: "assets",
    videoLibrary: "assets/stimuli",
    projectFile: "experiment.package.json",
  });
  assert.equal(Object.hasOwn(contribution.workspaceLayout, "absolutePath"), false);
  assert.equal(Object.hasOwn(contribution.workspaceLayout, "permission"), false);
  assert.deepEqual(await validateWorkspaceContributionV1(contribution), contribution);
});

test("P1 workspace contribution rejects altered layout and invalid nested catalogues", async () => {
  const videoCatalogue = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const valid = createWorkspaceContributionV1({
    study: createStudyIdentityV1({ id: "study", title: "Study" }),
    videoCatalogue,
  });
  await assert.rejects(validateWorkspaceContributionV1({
    ...valid,
    workspaceLayout: { ...valid.workspaceLayout, assetRoot: "C:/research/assets" },
  }));
  await assert.rejects(validateWorkspaceContributionV1({
    ...valid,
    videoCatalogue: { ...valid.videoCatalogue, revision: 2 },
  }));
});

test("workspace restore stages portable declarations without granting filesystem authority", async () => {
  const videoCatalogue = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const contribution = createWorkspaceContributionV1({
    study: createStudyIdentityV1({ id: "study", title: "Study" }), videoCatalogue,
  });
  const plan = await prepareWorkspaceContentRestoreV1(contribution);
  assert.deepEqual(plan, {
    study: { schema: "affect-research-study-identity", version: 1, id: "study", title: "Study" },
    workspaceLayout: {
      assetRoot: "assets", videoLibrary: "assets/stimuli", projectFile: "experiment.package.json",
    },
    videoDeclarations: videoCatalogue.entries.map((entry) => ({
      assetId: entry.assetId,
      annotationId: entry.annotationId,
      sourceRelativePath: entry.sourceRelativePath,
    })),
    requiresVideoLibraryRebind: true,
  });
  assert.equal(Object.hasOwn(plan, "absolutePath"), false);
  assert.equal(Object.hasOwn(plan, "permission"), false);
  assert.deepEqual(await verifyWorkspaceRestoredVideoEntriesV1(contribution, videoCatalogue.entries), videoCatalogue);
  await assert.rejects(verifyWorkspaceRestoredVideoEntriesV1(
    contribution,
    videoCatalogue.entries.map((entry, index) => index === 0
      ? { ...entry, annotationId: "changed-before-rebind" }
      : entry),
  ));
});

test("video consumers receive the registered outer P1 revision rather than an embedded catalogue revision", async () => {
  const videoCatalogue = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const workspaceContribution = createWorkspaceContributionV1({
    study: createStudyIdentityV1({ id: "study", title: "Study" }), videoCatalogue,
  });
  const workspaceSnapshot = {
    revision: 11, enabled: true, pending: false, contribution: workspaceContribution, dependencyRevisions: [],
  };
  const projected = await projectWorkspaceVideoCatalogueSnapshotV1(workspaceSnapshot);
  assert.equal(projected.revision, 11);
  assert.equal(projected.contribution.revision, 1);
  assert.equal(projected.pending, false);
  assert.deepEqual(projectVideoCatalogueSnapshotV1(workspaceSnapshot), projected);
  assert.deepEqual(await projectWorkspaceVideoDisplayGeometryV1(workspaceSnapshot), {
    revision: 11,
    pending: false,
    videos: [
      { assetId: `asset-${"a".repeat(64)}`, displayWidth: 1_920, displayHeight: 1_080 },
      { assetId: `asset-${"b".repeat(64)}`, displayWidth: 1_080, displayHeight: 1_920 },
    ],
  });
  await assert.rejects(projectWorkspaceVideoCatalogueSnapshotV1({
    ...workspaceSnapshot,
    contribution: { ...workspaceContribution, unexpectedAuthority: true },
  }));
  await assert.rejects(projectWorkspaceVideoCatalogueSnapshotV1({
    ...workspaceSnapshot,
    dependencyRevisions: [{ ownerId: "P0", revision: 1 }],
  }));
});

test("study and catalogue changes advance one coherent P1 revision for registry and video consumers", async () => {
  let study = createStudyIdentityV1({ id: "study-a", title: "Study A" });
  let catalogue = JSON.parse(await readFile(fixtureUrl, "utf8"));
  let videoSnapshot = {
    revision: 1, enabled: true, pending: false, contribution: catalogue, dependencyRevisions: [],
  };
  const notifications = [];
  const producer = createWorkspaceContributionProducerV1({
    getStudyIdentity: () => study,
    getVideoCatalogueSnapshot: () => videoSnapshot,
    onChange: (snapshot) => notifications.push(snapshot.revision),
  });

  assert.equal(producer.getSnapshot().revision, 1);
  assert.equal(producer.getVideoCatalogueSnapshot().revision, 1);
  study = createStudyIdentityV1({ id: "study-b", title: "Study B" });
  assert.equal(producer.changed().revision, 2);
  assert.equal(producer.getVideoCatalogueSnapshot().revision, 2);

  catalogue = await createVideoCatalogueContributionV1({
    revision: 2,
    entries: catalogue.entries.map((entry, index) => (
      index === 0 ? { ...entry, annotationId: "session1_reviewed" } : entry
    )),
  });
  videoSnapshot = { ...videoSnapshot, revision: 2, contribution: catalogue };
  assert.equal(producer.changed().pending, false);
  assert.equal(producer.getVideoCatalogueSnapshot().revision, 3);
  assert.deepEqual(notifications, [2, 3]);
});

test("P1 change publication survives an intervening registry read", async () => {
  let study = createStudyIdentityV1({ id: "study-a", title: "Study A" });
  const videoCatalogue = JSON.parse(await readFile(fixtureV2Url, "utf8"));
  const notifications = [];
  const producer = createWorkspaceContributionProducer({
    getStudyIdentity: () => study,
    getVideoCatalogueSnapshot: () => ({
      revision: 1, enabled: true, pending: false, contribution: videoCatalogue, dependencyRevisions: [],
    }),
    onChange: (snapshot) => {
      assert.equal(producer.getSnapshot().revision, snapshot.revision, "notification reads are reentrant");
      notifications.push(snapshot.revision);
    },
  });

  assert.equal(producer.getSnapshot().revision, 1);
  study = createStudyIdentityV1({ id: "study-a", title: "Edited Study" });
  assert.equal(producer.getSnapshot().revision, 2, "registry read observes the new state first");
  assert.deepEqual(notifications, []);
  assert.equal(producer.changed().revision, 2);
  assert.deepEqual(notifications, [2], "changed still publishes the unread event boundary");
  assert.equal(producer.changed().revision, 2);
  assert.deepEqual(notifications, [2], "unchanged state is not published twice");
});
