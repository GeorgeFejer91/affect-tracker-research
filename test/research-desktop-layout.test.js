import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { canonicalJson, canonicalSha256 } from "../site/src/research/canonical.js";
import { resolveFeedbackEnvelope } from "../site/src/research/feedback-layout.js";
import { validateWorkspaceContributionV1 } from "../site/src/research/workspace-contribution.js";
import { DEFAULT_DESKTOP_REFERENCE_POLICY, validateDesktopLayoutProfileV1, selectDesktopReference,
  resolveDesktopLayoutBase, resolveDesktopLayoutGeometry, convertDesktopLayoutUnits, assertDesktopLayoutViewport } from "../site/src/research/desktop-layout.js";
import { validateDesktopLayoutContribution, resolveDesktopLayoutContribution, serializeDesktopLayoutContribution, parseDesktopLayoutContribution, desktopLayoutDraftFromProfile,
  desktopLayoutProfileFromDraft } from "../site/src/research/desktop-layout-contribution.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/desktop-layout-candidates-v1.json", import.meta.url), "utf8"));
const clone = structuredClone;
const profile = () => clone(fixture.cases[0].profile);
function resolve(p, feedback = fixture.feedback, media = fixture.media) {
  const side = resolveDesktopLayoutBase(p).geometry.feedback.width;
  return resolveDesktopLayoutGeometry(p, media, resolveFeedbackEnvelope(feedback, side));
}
function near(a, b) {
  if (typeof a === "number") assert.ok(Math.abs(a - b) <= 1e-8, `${a} differs from ${b}`);
  else if (a && typeof a === "object") { assert.deepEqual(Object.keys(a), Object.keys(b)); for (const k of Object.keys(a)) near(a[k], b[k]); }
  else assert.equal(a, b);
}

test("both explicitly chosen methods validate full P1/P5 content and reproduce geometry and canonical bytes", async () => {
  await validateWorkspaceContributionV1(fixture.workspace);
  for (const c of fixture.cases) {
    const p = validateDesktopLayoutProfileV1(c.profile), result = resolve(p);
    assert.equal(await canonicalSha256(p), c.canonicalSha256);
    assert.deepEqual(result.geometry, c.geometry); assert.deepEqual(result.videos, c.videos); assert.deepEqual(result.issues, []);
    assert.equal(canonicalJson(desktopLayoutProfileFromDraft(desktopLayoutDraftFromProfile(p), fixture.media, p.reference.source.policy)), canonicalJson(p));
    assert.deepEqual(await validateDesktopLayoutContribution(p, fixture), p);
    assert.deepEqual((await resolveDesktopLayoutContribution(p, fixture)).geometry, c.geometry);
    const source = await serializeDesktopLayoutContribution(p, fixture);
    assert.equal(source, `${canonicalJson(p)}\n`);
    assert.equal(await serializeDesktopLayoutContribution(await parseDesktopLayoutContribution(source, fixture), fixture), source);
  }
  assert.equal(DEFAULT_DESKTOP_REFERENCE_POLICY, null);
  const draft = desktopLayoutDraftFromProfile(profile()); delete draft.referencePolicy;
  assert.throws(() => desktopLayoutProfileFromDraft(draft, fixture.media), { code: "reference-policy-required" });
});

test("every authored field is required and closed at each object boundary", () => {
  function visit(value, path = []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const key of Object.keys(value)) {
      const p = profile(), object = path.reduce((a, k) => a[k], p); delete object[key];
      assert.throws(() => validateDesktopLayoutProfileV1(p), undefined, `missing ${path.join(".")}.${key}`);
    }
    const p = profile(); path.reduce((a, k) => a[k], p).unexpected = true;
    assert.throws(() => validateDesktopLayoutProfileV1(p));
    for (const [key, nested] of Object.entries(value)) visit(nested, [...path, key]);
  }
  visit(profile());
  for (const [path, bad] of [
    [["version"], 2], [["units"], "px"], [["fit"], "cover"], [["target"], "webxr-immersive-vr"],
    [["coordinateSystem"], "right-up"], [["feedback", "origin"], "animated-centroid"],
    [["viewport", "widthCssPx"], 1.5], [["viewport", "heightCssPx"], 32769],
    [["reference", "source", "assetId"], null], [["feedback", "overlayViewportSide"], 0],
    [["feedback", "minimumGap"], -1], [["feedback", "offset", "x"], -0],
    [["reference", "box", "width"], "60"], [["feedback", "offset", "y"], Infinity],
  ]) { const p = profile(); path.slice(0, -1).reduce((a, k) => a[k], p)[path.at(-1)] = bad; assert.throws(() => validateDesktopLayoutProfileV1(p)); }
});

test("automatic reference uses all oriented videos and an immutable ASCII identity tie break", () => {
  assert.deepEqual(selectDesktopReference(fixture.media, "largest-oriented-area"), selectDesktopReference([...fixture.media].reverse(), "largest-oriented-area"));
  assert.equal(selectDesktopReference(fixture.media, "largest-oriented-area").assetId, fixture.media[0].assetId);
  const bigger = { assetId: `asset-${"c".repeat(64)}`, displayWidth: 4096, displayHeight: 2160 };
  assert.equal(selectDesktopReference([...fixture.media, bigger], "largest-oriented-area").assetId, bigger.assetId);
  assert.throws(() => resolve(profile(), fixture.feedback, [...fixture.media, bigger]), { code: "source-mismatch" });
  assert.throws(() => selectDesktopReference([], "largest-oriented-area"));
  assert.throws(() => selectDesktopReference([fixture.media[0], fixture.media[0]], "largest-oriented-area"));
  const malformed = clone(fixture.media); malformed[0].displayWidth = 1.5;
  assert.throws(() => selectDesktopReference(malformed, "largest-oriented-area"));
});

test("every contain fit preserves centres and positive x/y offsets against the same fixed frame", () => {
  const p = profile(); p.feedback.offset.x = 9; p.feedback.offset.y = 95;
  const { geometry: g, videos } = resolve(p);
  near(g.feedback.cx, g.reference.cx + g.reference.width * 0.09);
  near(g.feedback.cy, g.reference.cy + g.reference.height * 0.95);
  for (const v of videos) {
    near(v.bounds.cx, g.reference.cx); near(v.bounds.cy, g.reference.cy);
    near(v.bounds.width / v.bounds.height, v.displayWidth / v.displayHeight);
    assert.ok(v.bounds.width <= g.reference.width + 1e-8 && v.bounds.height <= g.reference.height + 1e-8);
  }
  assert.notEqual(videos[0].bounds.width, videos[1].bounds.width);
});

test("physical conversion preserves reference, offsets, SVG viewport and complete P5 painted bounds", () => {
  for (const c of fixture.cases.filter(c => c.profile.units === "relative")) {
    const mm = convertDesktopLayoutUnits(c.profile, "mm"), back = convertDesktopLayoutUnits(mm, "relative");
    near(resolve(mm).geometry, resolve(c.profile).geometry); near(resolve(back).geometry, resolve(c.profile).geometry);
  }
  const p = profile(); p.calibration = null;
  assert.throws(() => convertDesktopLayoutUnits(p, "mm"), { code: "required" });
  p.units = "mm"; assert.throws(() => validateDesktopLayoutProfileV1(p));
  const mismatch = profile(); mismatch.calibration.activeHeightMm = 300;
  assert.throws(() => convertDesktopLayoutUnits(mismatch, "mm"), { code: "aspect-mismatch" });
});

test("clipping, overlap, gap and full animated halo failures never move authored geometry", () => {
  for (const [edit, code] of [
    [p => { p.reference.centre.x = 5; }, "reference-clips"],
    [p => { p.feedback.offset.y = 0; }, "video-overlap"],
    [p => { p.feedback.minimumGap = 100; }, "gap-too-small"],
    [p => { p.feedback.overlayViewportSide = 300; }, "envelope-clips"],
  ]) { const p = profile(); edit(p); const before = canonicalJson(p); assert.ok(resolve(p).issues.some(i => i.code === code), code); assert.equal(canonicalJson(p), before); }
  const p = profile(), feedback = clone(fixture.feedback); feedback.visual.hideFeedback = true;
  p.feedback.offset.y = 0;
  assert.deepEqual(resolve(p, feedback).issues, []);
  assert.equal(resolve(p, feedback).geometry.maximumFeedback.width, 0);
});

test("wrong P5 envelope or observed viewport fails explicitly without fallback", () => {
  const p = profile(), side = resolveDesktopLayoutBase(p).geometry.feedback.width;
  const envelope = resolveFeedbackEnvelope(fixture.feedback, side);
  for (const [key, value] of [["origin", "centroid"], ["algorithmVersion", "guessed"], ["overlaySideCssPx", side + 1], ["halfExtentCssPx", NaN], ["halfExtentCssPx", -1], ["configurationKey", ""]]) {
    assert.throws(() => resolveDesktopLayoutGeometry(p, fixture.media, { ...envelope, [key]: value }), { code: "envelope" });
  }
  assert.equal(assertDesktopLayoutViewport(p, { widthCssPx: 1920, heightCssPx: 1080 }), true);
  assert.throws(() => assertDesktopLayoutViewport(p, { widthCssPx: 1280, heightCssPx: 720 }), { code: "incompatible" });
});

test("canonical reader rejects duplicate/unknown/noncanonical data without choosing a missing policy", async () => {
  const p = profile(), text = `${canonicalJson(p)}\n`;
  for (const source of [text.trim(), JSON.stringify(p, null, 2), text.replace('"version":1', '"version":1,"version":1'), "x".repeat(8193)]) {
    await assert.rejects(parseDesktopLayoutContribution(source, fixture));
  }
  assert.deepEqual(await parseDesktopLayoutContribution(text, fixture), p);
  delete p.reference.source.policy;
  await assert.rejects(validateDesktopLayoutContribution(p, fixture));
});

test("accepted composition rejects altered media, feedback and fit instead of trusting profile or claimed bounds", async () => {
  const p = profile(), changed = structuredClone(fixture);
  changed.workspace.videoCatalogue.entries[0].geometry.displayWidthPx += 1;
  await assert.rejects(validateDesktopLayoutContribution(p, changed));
  await assert.rejects(validateDesktopLayoutContribution(p, { ...fixture, feedback: { ...fixture.feedback, halfExtentCssPx: 0 } }));
  const overlap = profile(); overlap.feedback.offset.y = 0;
  await assert.rejects(validateDesktopLayoutContribution(overlap, fixture), { code: "video-overlap" });
  const missing = profile(); missing.reference.source.assetId = `asset-${"d".repeat(64)}`;
  await assert.rejects(validateDesktopLayoutContribution(missing, fixture), { code: "source-mismatch" });
});

test("two clean processes reproduce candidate bytes and geometry without app/default/storage imports", () => {
  const script = `import {readFileSync} from 'node:fs';
    import {canonicalJson} from './site/src/research/canonical.js';
    import {resolveDesktopLayoutBase,resolveDesktopLayoutGeometry,validateDesktopLayoutProfileV1} from './site/src/research/desktop-layout.js';
    import {resolveFeedbackEnvelope} from './site/src/research/feedback-layout.js';
    for(const key of ['localStorage','sessionStorage','document','window']) Object.defineProperty(globalThis,key,{get(){throw Error('ambient '+key)}});
    const f=JSON.parse(readFileSync('test/fixtures/desktop-layout-candidates-v1.json','utf8'));
    process.stdout.write(canonicalJson(f.cases.map(c=>{const p=validateDesktopLayoutProfileV1(c.profile); const g=resolveDesktopLayoutGeometry(p,f.media,resolveFeedbackEnvelope(f.feedback,resolveDesktopLayoutBase(p).geometry.feedback.width));return {profile:p,geometry:g.geometry,videos:g.videos};})));`;
  const run = () => execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  const first = run(); assert.equal(run(), first);
  assert.equal(first, canonicalJson(fixture.cases.map(c => ({ profile: c.profile, geometry: c.geometry, videos: c.videos }))));
});
