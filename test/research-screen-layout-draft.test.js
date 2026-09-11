import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createScreenLayoutDraft, resolveScreenLayoutDraft, convertScreenLayoutDraftUnits } from "../site/src/research/screen-layout-draft.js";
import { screenLayoutDraftMarkup, screenLayoutSceneMarkup } from "../site/src/research/screen-layout-view.js";

const fixture = () => ({ ...createScreenLayoutDraft(), referenceWidth: 1280 / 1920 * 100, referenceHeight: 720 / 1080 * 100,
  referenceX: 50, referenceY: 400 / 1080 * 100, diameter: 25, offsetX: 0, offsetY: 500 / 720 * 100, gap: 50 / 720 * 100 });
const media = [
  { id: "landscape", source: "synthetic", width: 1920, height: 1080 },
  { id: "portrait", source: "synthetic", width: 1080, height: 1920 },
  { id: "wide", source: "synthetic", width: 2560, height: 720 },
];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("proposed contain geometry preserves both centres for every aspect ratio", () => {
  const p = resolveScreenLayoutDraft(fixture(), { media });
  assert.equal(p.exportable, false);
  assert.equal(p.status, "draft-only");
  assert.deepEqual(p.issues, []);
  near(p.geometry.reference.width, 1280);
  near(p.geometry.feedback.cx, 960);
  near(p.geometry.feedback.cy, 900);
  near(p.geometry.feedback.width, 180);
  near(p.videos[0].bounds.height, 720);
  near(p.videos[1].bounds.width, 405);
  near(p.videos[2].bounds.height, 360);
  for (const video of p.videos) {
    near(video.bounds.cx, 960);
    near(video.bounds.cy, 400);
    assert.equal(video.boundKind, "nominal-only");
  }
  near(p.videos[0].gap, 50);
  near(p.videos[1].gap, 50);
});

test("fixed-reference percentages do not change with the selected video's dimensions", () => {
  const d = { ...fixture(), offsetX: 10 };
  const a = resolveScreenLayoutDraft(d, { media: [media[0]] });
  const b = resolveScreenLayoutDraft(d, { media: [media[1]] });
  near(a.geometry.offset.x, 128);
  assert.deepEqual(a.geometry, b.geometry);
});

test("missing producer data never creates synthetic videos or verified bounds", () => {
  const p = resolveScreenLayoutDraft(createScreenLayoutDraft());
  assert.deepEqual(p.videos, []);
  assert.equal(p.geometry.maximumFeedback, null);
  assert.ok(p.dependencies.includes("P1 display geometry"));
  assert.ok(p.dependencies.includes("P5 animation envelope"));
  assert.equal(p.exportable, false);
});

test("unit switching requires measurement and preserves geometry without double conversion", () => {
  const d = { ...fixture(), physicalWidth: 480, physicalHeight: 270, fullViewportMapping: true };
  const original = structuredClone(d);
  const mm = convertScreenLayoutDraftUnits(d, "mm");
  assert.equal(mm.ok, true);
  near(mm.draft.referenceWidth, 320);
  near(mm.draft.diameter, 45);
  near(mm.draft.offsetY, 125);
  let current = mm.draft;
  for (let i = 0; i < 50; i++) {
    current = convertScreenLayoutDraftUnits(current, "relative").draft;
    current = convertScreenLayoutDraftUnits(current, "mm").draft;
  }
  const a = resolveScreenLayoutDraft(d).geometry;
  const b = resolveScreenLayoutDraft(current).geometry;
  for (const key of ["width", "height", "cx", "cy"]) near(a.feedback[key], b.feedback[key]);
  assert.deepEqual(d, original);
});

test("unavailable or anisotropic calibration rejects atomically", () => {
  for (const overrides of [{}, { physicalWidth: 480, physicalHeight: 270 }, { physicalWidth: 480, physicalHeight: 300, fullViewportMapping: true }]) {
    const d = { ...fixture(), ...overrides };
    const original = structuredClone(d);
    const result = convertScreenLayoutDraftUnits(d, "mm");
    assert.equal(result.ok, false);
    assert.equal(result.draft, d);
    assert.deepEqual(d, original);
    assert.ok(result.issues.length);
  }
  assert.equal(resolveScreenLayoutDraft({ ...fixture(), units: "mm" }).geometry, null);
});

test("invalid and out-of-range draft numbers do not clamp or reuse older geometry", () => {
  for (const [field, value] of [["screenWidth", ""], ["screenHeight", 0], ["screenWidth", 1.5], ["diameter", "NaN"], ["diameter", Infinity], ["offsetX", " "], ["referenceWidth", -1], ["gap", -1], ["offsetY", 100001]]) {
    const p = resolveScreenLayoutDraft({ ...fixture(), [field]: value });
    assert.equal(p.geometry, null, field);
    assert.ok(p.issues.some(item => item.field === field), field);
  }
});

test("clipping and overlap remain visible without moving or resizing the draft", () => {
  const overlap = resolveScreenLayoutDraft({ ...fixture(), offsetY: 0 }, { media });
  assert.equal(overlap.issues.filter(item => item.code === "video-overlap").length, 3);
  near(overlap.geometry.feedback.cy, 400);
  const clips = resolveScreenLayoutDraft({ ...fixture(), offsetY: 200 });
  assert.ok(clips.issues.some(item => item.code === "footprint-clips"));
  near(clips.geometry.feedback.cy, 1840);
  assert.ok(resolveScreenLayoutDraft({ ...fixture(), referenceWidth: 120 }).issues.some(item => item.code === "reference-clips"));
  assert.ok(resolveScreenLayoutDraft({ ...fixture(), gap: 10 }, { media }).issues.some(item => item.code === "gap-too-small"));
});

test("fixture envelope uses full extents and non-scaling CSS pixel padding", () => {
  const envelope = { source: "synthetic", revision: "test-v1", left: 0.6, right: 0.7, top: 0.8, bottom: 1.1, paddingCssPx: 2 };
  const p = resolveScreenLayoutDraft(fixture(), { media, envelope });
  near(p.geometry.maximumFeedback.x, 850);
  near(p.geometry.maximumFeedback.width, 238);
  assert.ok(p.issues.some(item => item.code === "envelope-clips"));
  assert.ok(p.issues.some(item => item.code === "video-overlap"));
  assert.equal(p.exportable, false);
  const invalid = resolveScreenLayoutDraft(fixture(), { envelope: { ...envelope, left: NaN } });
  assert.equal(invalid.geometry.maximumFeedback, null);
  assert.ok(invalid.issues.some(item => item.code === "invalid-envelope"));
});

test("the provisional fixture adapter rejects unowned real geometry and duplicate IDs", () => {
  const p = resolveScreenLayoutDraft(fixture(), { media: [media[0], media[0], { ...media[1], source: "unverified" }] });
  assert.equal(p.videos.length, 1);
  assert.equal(p.issues.filter(item => item.code === "invalid-media").length, 2);
  assert.equal(resolveScreenLayoutDraft(fixture(), { media: null }).issues.at(-1).code, "invalid-media");
});

test("draft markup provides numeric alternatives and explicitly excludes export and Run", () => {
  const markup = screenLayoutDraftMarkup();
  assert.match(markup, /not saved in the experiment package or applied during Run/u);
  assert.match(markup, /Q08 choices await confirmation/u);
  assert.match(markup, /aria-live="polite"/u);
  assert.match(markup, /for="layout-offsetX"/u);
  assert.match(markup, /for="layout-offsetY"/u);
  assert.doesNotMatch(markup, /type="submit"|data-confirm-section/u);
  assert.match(screenLayoutSceneMarkup(resolveScreenLayoutDraft(fixture())), /role="img" aria-labelledby=/u);
});

test("draft owner is isolated from package, native, storage and current Start projections", async () => {
  const base = new URL("../site/src/research/", import.meta.url);
  for (const file of ["screen-layout-draft.js", "screen-layout-editor.js", "screen-layout-view.js"]) {
    const source = await readFile(new URL(file, base), "utf8");
    assert.doesNotMatch(source, /from ["']\.\/(?:experiment-package|contracts|native-|runtime-|workspace)|localStorage|indexedDB|fetch\(|invoke\(/u);
  }
  const app = await readFile(new URL("app.js", base), "utf8");
  const start = app.slice(app.indexOf("const detail = {", app.indexOf("function requestStart")), app.indexOf('root.addEventListener("click"', app.indexOf("function requestStart")));
  assert.doesNotMatch(start, /layoutDraft|screenLayout/u);
  assert.match(app, /element\?\.closest\?\.\("\[data-screen-layout-draft\]"\)\) return false/u);
  assert.match(app, /layoutDraftEditor\.destroy\(\)/u);
});
