import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assetIdFromSha256,
  browserDisplayGeometry,
  createVideoCatalogueContributionV1,
  createVideoCatalogueProducerV1,
  projectVideoDisplayGeometryV1,
  projectVideoReferenceAliasesV1,
  reviseVideoCatalogueContributionV1,
  validateVideoCatalogueContributionV1,
  workspaceStimuliToVideoCatalogueEntriesV1,
} from "../site/src/research/video-catalogue-contribution.js";

const fixtureUrl = new URL("./fixtures/research-video-catalogue-contribution-v1.json", import.meta.url);

function entry({ hash = "a".repeat(64), path = "stimuli/folder/video.mp4", annotationId = "folder_video" } = {}) {
  return {
    assetId: assetIdFromSha256(hash),
    annotationId,
    sourceRelativePath: path,
    packageRelativePath: `assets/${path}`,
    sha256: hash,
    byteLength: 1_024,
    durationMs: 12_345,
    geometry: browserDisplayGeometry({ videoWidth: 1_920, videoHeight: 1_080 }),
  };
}

test("P1 catalogue identity, duration and oriented display geometry are canonical and order independent", async () => {
  const first = entry();
  const second = entry({ hash: "b".repeat(64), path: "stimuli/other/portrait.mp4", annotationId: "other_portrait" });
  second.geometry = browserDisplayGeometry({ videoWidth: 1_080, videoHeight: 1_920 });
  const catalogue = await createVideoCatalogueContributionV1({ revision: 7, entries: [second, first] });
  assert.deepEqual(catalogue.entries.map(({ assetId }) => assetId), [first.assetId, second.assetId]);
  assert.deepEqual(catalogue.entries[0].geometry.displayAspect, { numerator: 16, denominator: 9 });
  assert.deepEqual(catalogue.entries[1].geometry.displayAspect, { numerator: 9, denominator: 16 });
  assert.deepEqual(await validateVideoCatalogueContributionV1(catalogue), catalogue);
  assert.deepEqual(await projectVideoDisplayGeometryV1(catalogue), {
    catalogueRevision: 7,
    videos: [
      { assetId: first.assetId, displayWidth: 1_920, displayHeight: 1_080 },
      { assetId: second.assetId, displayWidth: 1_080, displayHeight: 1_920 },
    ],
  });
  assert.deepEqual(await projectVideoReferenceAliasesV1(catalogue), {
    catalogueRevision: 7,
    references: [
      { assetId: first.assetId, annotationId: "folder_video" },
      { assetId: second.assetId, annotationId: "other_portrait" },
    ],
  });
  assert.equal(Object.isFrozen(catalogue.entries[0].geometry.displayAspect), true);
});

test("shared P1 fixture remains an exact canonical consumer boundary", async () => {
  const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
  assert.deepEqual(await validateVideoCatalogueContributionV1(fixture), fixture);
});

test("live workspace projection rejects incomplete or unsupported videos instead of shortening the catalogue", () => {
  const accepted = {
    title: "folder_video",
    source: "workspace",
    verification: "verified",
    contractSource: {
      kind: "workspaceFile",
      relativePath: "stimuli/folder/video.mp4",
      mimeType: "video/mp4",
      sha256: "a".repeat(64),
      byteLength: 1_024,
      durationMs: 12_345,
    },
    displayGeometry: browserDisplayGeometry({ videoWidth: 1_920, videoHeight: 1_080 }),
  };
  assert.deepEqual(workspaceStimuliToVideoCatalogueEntriesV1([accepted]), [entry()]);
  assert.throws(() => workspaceStimuliToVideoCatalogueEntriesV1([
    accepted,
    { ...accepted, source: "youtube", verification: "unverified" },
  ]), /pending or unsupported/u);
  assert.throws(() => workspaceStimuliToVideoCatalogueEntriesV1([
    accepted,
    { ...accepted, verification: "pending" },
  ]), /pending or unsupported/u);
});

test("catalogue revision is stable for enumeration changes and invalidates every accepted metadata change", async () => {
  const first = entry();
  const second = entry({ hash: "b".repeat(64), path: "stimuli/other/video.mp4", annotationId: "other_video" });
  const initial = await reviseVideoCatalogueContributionV1(null, [first, second]);
  assert.equal(initial.revision, 1);
  assert.equal(await reviseVideoCatalogueContributionV1(initial, [second, first]), initial);
  for (const mutate of [
    (value) => { value.annotationId = "reviewed_name"; },
    (value) => { value.durationMs += 1; },
    (value) => { value.byteLength += 1; },
    (value) => { value.geometry = browserDisplayGeometry({ videoWidth: 1_280, videoHeight: 720 }); },
    (value) => {
      value.sourceRelativePath = "stimuli/renamed/video.mp4";
      value.packageRelativePath = "assets/stimuli/renamed/video.mp4";
    },
  ]) {
    const changed = structuredClone(first);
    mutate(changed);
    assert.equal((await reviseVideoCatalogueContributionV1(initial, [changed, second])).revision, 2);
  }
});

test("catalogue rejects ambiguous identity, unsafe paths, invented orientation and tampering", async () => {
  const valid = entry();
  for (const changed of [
    { ...valid, assetId: `asset-${"b".repeat(64)}` },
    { ...valid, sourceRelativePath: "stimuli/../escape.mp4", packageRelativePath: "assets/stimuli/../escape.mp4" },
    { ...valid, packageRelativePath: "assets/stimuli/other.mp4" },
    { ...valid, durationMs: null },
    { ...valid, geometry: { ...valid.geometry, rotationDegrees: 90 } },
    { ...valid, geometry: { ...valid.geometry, displayAspect: { numerator: 4, denominator: 3 } } },
  ]) await assert.rejects(createVideoCatalogueContributionV1({ revision: 1, entries: [changed] }));

  await assert.rejects(createVideoCatalogueContributionV1({ revision: 1, entries: [valid, valid] }));
  const catalogue = await createVideoCatalogueContributionV1({ revision: 1, entries: [valid] });
  await assert.rejects(validateVideoCatalogueContributionV1({ ...catalogue, revision: 2 }));
  await assert.rejects(validateVideoCatalogueContributionV1({ ...catalogue, hidden: true }));
});

test("producer exposes one revisioned snapshot and withdraws invalid catalogues instead of omitting entries", async () => {
  const notifications = [];
  const producer = createVideoCatalogueProducerV1({
    onChange: (snapshot) => notifications.push([snapshot.revision, snapshot.pending]),
  });
  assert.deepEqual(producer.getSnapshot(), {
    revision: 0, enabled: true, pending: true, contribution: null, dependencyRevisions: [],
  });

  const first = entry();
  const accepted = await producer.replaceEntries([first]);
  assert.equal(accepted.revision, 1);
  assert.equal(accepted.pending, false);
  assert.equal(accepted.contribution.entries[0].assetId, first.assetId);

  const reordered = await producer.replaceEntries([first]);
  assert.equal(reordered.revision, 1);
  assert.equal(reordered.contribution, accepted.contribution);

  await assert.rejects(producer.replaceEntries([{ ...first, durationMs: null }]));
  const withdrawn = producer.getSnapshot();
  assert.equal(withdrawn.revision, 2);
  assert.equal(withdrawn.pending, true);
  assert.equal(withdrawn.contribution, null);

  const restored = await producer.replaceEntries([first]);
  assert.equal(restored.revision, 3);
  assert.equal(restored.pending, false);
  assert.equal(restored.contribution, accepted.contribution);
  assert.deepEqual(notifications, [
    [1, false], [1, true], [1, false], [1, true], [2, true], [3, false],
  ]);
});

test("producer can restore validated catalogue content without granting directory authority", async () => {
  const saved = await createVideoCatalogueContributionV1({ revision: 9, entries: [entry()] });
  const producer = createVideoCatalogueProducerV1();
  const restored = await producer.restoreContribution(saved);
  assert.equal(restored.revision, 1, "live owner revision is local and monotonic");
  assert.deepEqual(restored.contribution, saved);
  assert.equal(restored.pending, false);
  assert.equal(Object.hasOwn(restored.contribution, "absolutePath"), false);
  await assert.rejects(producer.restoreContribution({ ...saved, revision: 10 }));
  assert.deepEqual(producer.getSnapshot(), restored, "invalid saved content cannot mutate the live producer");
});

test("deferred restore A cannot replace newer B, revive after withdrawal, or erase newer success on failure", async () => {
  const validations = [];
  const producer = createVideoCatalogueProducerV1({
    validateRestoredContribution(value) {
      return new Promise((resolve, reject) => validations.push({ value, resolve, reject }));
    },
  });
  const savedA = await createVideoCatalogueContributionV1({ revision: 7, entries: [entry()] });
  const savedB = await createVideoCatalogueContributionV1({
    revision: 8,
    entries: [{ ...entry(), annotationId: "newer-b" }],
  });

  const restoreA = producer.restoreContribution(savedA);
  const restoreB = producer.restoreContribution(savedB);
  validations[1].resolve(savedB);
  const acceptedB = await restoreB;
  validations[0].resolve(savedA);
  assert.deepEqual(await restoreA, acceptedB, "late A must observe, not replace, accepted B");
  assert.deepEqual(producer.getSnapshot(), acceptedB);

  const restoreBeforeWithdrawal = producer.restoreContribution(savedA);
  const withdrawn = producer.withdraw();
  validations[2].resolve(savedA);
  assert.deepEqual(await restoreBeforeWithdrawal, withdrawn, "late validation must not revive withdrawn content");
  assert.deepEqual(producer.getSnapshot(), withdrawn);

  const failingOlderRestore = producer.restoreContribution(savedA);
  const newerRestore = producer.restoreContribution(savedB);
  validations[4].resolve(savedB);
  const newerSuccess = await newerRestore;
  validations[3].reject(new TypeError("deferred invalid A"));
  await assert.rejects(failingOlderRestore, /deferred invalid A/u);
  assert.deepEqual(producer.getSnapshot(), newerSuccess, "stale failure must preserve newer success");
});

test("same-recipe media refresh identity blocks a late match after removal and a stale failure after newer success", async () => {
  const producer = createVideoCatalogueProducerV1();
  const savedA = await createVideoCatalogueContributionV1({ revision: 7, entries: [entry()] });
  const savedB = await createVideoCatalogueContributionV1({
    revision: 8,
    entries: [{ ...entry(), annotationId: "newer-media" }],
  });
  let refreshGeneration = 0;
  async function refreshAfter(verification, contribution) {
    const operation = ++refreshGeneration;
    const isCurrent = () => operation === refreshGeneration;
    try {
      await verification;
      return await producer.restoreContribution(contribution, { isCurrent });
    } catch (error) {
      if (isCurrent()) producer.withdraw();
      throw error;
    }
  }

  let releaseMatchingA;
  const matchingA = new Promise((resolve) => { releaseMatchingA = resolve; });
  const lateMatchingA = refreshAfter(matchingA, savedA);
  refreshGeneration += 1; // A media edit/removal starts a newer refresh.
  const removed = producer.withdraw();
  releaseMatchingA();
  assert.deepEqual(await lateMatchingA, removed, "old matching media cannot revive after removal");
  assert.deepEqual(producer.getSnapshot(), removed);

  let rejectStaleRefresh;
  const staleFailure = new Promise((resolve, reject) => { rejectStaleRefresh = reject; });
  const lateFailure = refreshAfter(staleFailure, savedA);
  refreshGeneration += 1;
  const newerSuccess = await producer.restoreContribution(savedB);
  rejectStaleRefresh(new TypeError("late stale media failure"));
  await assert.rejects(lateFailure, /late stale media failure/u);
  assert.deepEqual(producer.getSnapshot(), newerSuccess, "stale media failure cannot withdraw newer success");
});
