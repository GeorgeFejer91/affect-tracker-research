import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stimulusRoot = path.join(root, "site", "assets", "research-stimuli");
const caavRoot = path.join(stimulusRoot, "caav", "v1");
const openlavRoot = path.join(stimulusRoot, "openlav", "v1");

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(stimulusRoot, relativePath), "utf8"));
}

async function digest(filePath, algorithm = "sha256") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

const sha256 = (filePath) => digest(filePath);

function resolvedChild(parent, relativePath) {
  const resolved = path.resolve(parent, relativePath);
  assert.ok(resolved.startsWith(`${path.resolve(parent)}${path.sep}`), `${relativePath} escapes its catalog root`);
  return resolved;
}

test("research stimulus registry documents every reviewed acquisition target", async () => {
  const registry = await json("catalog.json");
  assert.equal(registry.schema, "org.aliusresearch.research-stimulus-sources");
  const ids = registry.datasets.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  for (const expectedId of [
    "caav",
    "devo-2",
    "avdos",
    "liris-accede",
    "one-minute-silent-videos",
    "expanded-emdb",
    "emo-film",
    "openlav",
    "deam",
    "idest",
    "case",
    "amigos",
    "emo-soundscapes",
    "sendv1",
    "k-emocon",
  ]) {
    assert.ok(ids.includes(expectedId), `missing reviewed dataset ${expectedId}`);
  }
  const mirrored = registry.datasets.filter(({ hostedClipCount }) => hostedClipCount > 0);
  assert.deepEqual(mirrored.map(({ id, hostedClipCount }) => ({ id, hostedClipCount })), [
    { id: "caav", hostedClipCount: 96 },
  ]);
});

test("source/version folders and hosted media follow the naming convention", async () => {
  for (const source of ["caav", "openlav"]) {
    await access(path.join(stimulusRoot, source, "v1", "ratings"));
  }
  const caavCatalog = await json("caav/v1/catalog.json");
  for (const clip of caavCatalog.clips) {
    assert.match(path.basename(clip.media.path), /^caav__[a-z0-9-]+__h264-1080p\.mp4$/);
  }
  const openlavCatalog = await json("openlav/v1/catalog.json");
  for (const item of openlavCatalog.includedRatings) {
    assert.match(path.basename(item.path), /^openlav__[a-z0-9-]+__original\.csv$/);
  }
});

test("CAAV catalog binds 96 browser clips to ratings, bytes, and SHA-256 identities", async () => {
  const catalog = await json("caav/v1/catalog.json");
  assert.equal(catalog.schema, "org.aliusresearch.affect-stimulus-catalog");
  assert.equal(catalog.dataset.license.name, "CC0 1.0");
  assert.equal(catalog.hostedSubset.clipCount, 96);
  assert.equal(catalog.hostedSubset.distinctActionCount, 90);
  assert.equal(catalog.clips.length, 96);
  assert.equal(new Set(catalog.clips.map(({ id }) => id)).size, 96);
  assert.equal(new Set(catalog.clips.map(({ action }) => action)).size, 90);

  let frame450Count = 0;
  for (const clip of catalog.clips) {
    assert.match(clip.id, /^[13]_[FM]_\d{3}$/);
    assert.match(clip.media.path, /^media\/caav__[13]-[fm]-\d{3}__h264-1080p\.mp4$/);
    assert.equal(clip.media.mimeType, "video/mp4");
    assert.equal(clip.media.codec, "H.264/AVC");
    assert.equal(clip.media.width, 1920);
    assert.equal(clip.media.height, 1080);
    assert.equal(clip.media.frameRate, 30);
    assert.equal(clip.media.audio, false);
    assert.ok(clip.media.frameCount === 450 || clip.media.frameCount === 451);
    frame450Count += Number(clip.media.frameCount === 450);

    for (const participantGroup of Object.values(clip.ratings)) {
      for (const dimension of Object.values(participantGroup)) {
        assert.ok(
          Math.abs(dimension.meanAffectTrackerMinus1To1 - ((dimension.meanSam1To9 - 5) / 4)) <= 0.000001,
        );
        assert.ok(dimension.meanAffectTrackerMinus1To1 >= -1);
        assert.ok(dimension.meanAffectTrackerMinus1To1 <= 1);
      }
    }

    const mediaPath = resolvedChild(caavRoot, clip.media.path);
    const mediaStat = await stat(mediaPath);
    assert.equal(mediaStat.size, clip.media.byteLength);
    assert.equal(await sha256(mediaPath), clip.media.sha256);
  }
  assert.equal(frame450Count, 1);
});

test("OpenLAV retains every original aggregate/raw CSV with publisher and local hashes", async () => {
  const catalog = await json("openlav/v1/catalog.json");
  assert.equal(catalog.schema, "org.aliusresearch.affect-stimulus-catalog");
  assert.equal(catalog.dataset.license.name, "CC BY 4.0");
  assert.equal(catalog.dataset.publishedClipCount, 188);
  assert.equal(catalog.dataset.publishedRawRatingCount, 13264);
  assert.equal(catalog.hostedSubset.clipCount, 0);
  assert.equal(catalog.hostedSubset.ratingTables, "complete");

  for (const item of [...catalog.includedRatings, ...catalog.includedMetadata]) {
    const localPath = resolvedChild(openlavRoot, item.path);
    const localStat = await stat(localPath);
    assert.equal(localStat.size, item.byteLength);
    assert.equal(await sha256(localPath), item.sha256);
    assert.equal(await digest(localPath, "md5"), item.publishedMd5);
    if (item.rowCountIncludingHeader) {
      const text = await readFile(localPath, "utf8");
      assert.equal(text.trimEnd().split("\n").length, item.rowCountIncludingHeader);
    }
  }
});

test("CAAV public subset retains original and CSV ratings while excluding source MPG files", async () => {
  const catalog = await json("caav/v1/catalog.json");
  for (const item of [...catalog.includedRatings, ...catalog.includedMetadata]) {
    const metadataPath = resolvedChild(caavRoot, item.path);
    const metadataStat = await stat(metadataPath);
    assert.equal(metadataStat.size, item.byteLength);
    assert.equal(await sha256(metadataPath), item.sha256);
  }
  await assert.rejects(access(path.join(caavRoot, "source")));
  assert.deepEqual(
    catalog.includedRatings.map(({ path: ratingPath }) => ratingPath),
    [
      "ratings/original/CAAV_Dataset.xlsx",
      "ratings/original/CAAV_RawData.xlsx",
      "ratings/caav__clip-norms__sam-1-9.csv",
      "ratings/caav__raw-valence__sam-1-9.csv",
      "ratings/caav__raw-arousal__sam-1-9.csv",
    ],
  );
  const csvRowCounts = new Map([
    ["caav__clip-norms__sam-1-9.csv", 361],
    ["caav__raw-valence__sam-1-9.csv", 218],
    ["caav__raw-arousal__sam-1-9.csv", 240],
  ]);
  for (const [name, expectedRows] of csvRowCounts) {
    const text = await readFile(path.join(caavRoot, "ratings", name), "utf8");
    assert.equal(text.trimEnd().split("\n").length, expectedRows);
  }
});
