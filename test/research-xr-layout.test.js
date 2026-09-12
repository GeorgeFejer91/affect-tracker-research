import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  XR_TARGET_REQUIREMENTS, assertNoXrInV1Package, assertXrTargetSupported,
  canEditXrAngularSize, createDefaultXrLayoutProfile, createWorldFromSetup,
  parseXrLayoutProfileV1, resolveXrCatalogueV1, resolveXrLayoutProfileV1, serializeXrLayoutProfileV1,
  transformSetupPoint, validateXrLayoutProfileV1, withXrAngularSize, xrLayoutReceipt,
} from "../site/src/research/xr-layout.js";
import { createXrLayoutState } from "../site/src/research/xr-layout-editor.js";
import { xrLayoutEditorMarkup, xrLayoutSceneSvg } from "../site/src/research/xr-layout-view.js";
import { parseExperimentPackageV1 } from "../site/src/research/experiment-package.js";
import { XR_FEEDBACK_VIEWPORT_CSS_PX, resolveXrFeedbackFootprintV1 } from "../site/src/research/xr-layout-feedback.js";

const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const fixture = await readFile(new URL("fixtures/xr-layout-v1.canonical.json", import.meta.url), "utf8");
const cases = JSON.parse(await readFile(new URL("fixtures/xr-layout-geometry-v1.json", import.meta.url), "utf8"));

test("P6 canonical profile round trips exactly with a distinct byte hash", async () => {
  const profile = parseXrLayoutProfileV1(fixture);
  assert.equal(serializeXrLayoutProfileV1(profile), fixture);
  assert.equal((await xrLayoutReceipt(profile)).sha256, cases.canonicalSha256);
  const changed = structuredClone(profile); changed.video.distanceMetres += 0.001;
  assert.notEqual((await xrLayoutReceipt(changed)).sha256, cases.canonicalSha256);
});

test("P6 closed parser rejects duplicate keys, BOM, CRLF, omissions and noncanonical bytes", () => {
  for (const source of [fixture.replace('"version":1', '"version":1,"version":1'),
    `\ufeff${fixture}`, fixture.replaceAll("\n", "\r\n"), fixture.trim(),
    JSON.stringify(JSON.parse(fixture), null, 2), " ".repeat(8193), "null"]) {
    assert.throws(() => parseXrLayoutProfileV1(source));
  }
  const profile = JSON.parse(fixture); delete profile.video.rollDegrees;
  assert.throws(() => validateXrLayoutProfileV1(profile));
});

test("P6 rejects every shared invalid schema, policy, geometry and number fixture", () => {
  for (const { name, profile } of cases.invalid) assert.throws(() => validateXrLayoutProfileV1(profile), undefined, name);
  for (const invalid of [NaN, Infinity, -Infinity, "2", undefined]) {
    const p = createDefaultXrLayoutProfile(); p.video.distanceMetres = invalid;
    assert.throws(() => validateXrLayoutProfileV1(p));
  }
});

test("P6 forward frame, centre angles and local rotated offsets have explicit signs", () => {
  const p = createDefaultXrLayoutProfile();
  assert.deepEqual(resolveXrLayoutProfileV1(p).videoCentre, [0, 0, -2]);
  p.video.azimuthDegrees = 30; p.video.elevationDegrees = 30;
  let g = resolveXrLayoutProfileV1(p);
  close(g.videoCentre[0], Math.sqrt(3) / 2); close(g.videoCentre[1], 1); close(g.videoCentre[2], -1.5);
  p.video.azimuthDegrees = 0; p.video.elevationDegrees = 0; p.video.rollDegrees = 90;
  g = resolveXrLayoutProfileV1(p);
  close(g.feedbackCentre[0], 0.65); close(g.feedbackCentre[1], 0); close(g.feedbackCentre[2], -2);
});

test("P6 centre-only angular entry converts to one physical authority", () => {
  const p = createDefaultXrLayoutProfile(); p.feedback.enabled = false;
  const next = withXrAngularSize(p, 30, 20);
  close(next.video.widthMetres, 1.0717967697244908);
  close(next.video.heightMetres, 0.7053079228338599);
  close(resolveXrLayoutProfileV1(next).screenAngles.widthDegrees, 30);
  close(resolveXrLayoutProfileV1(next).screenAngles.heightDegrees, 20);
  assert.equal(Object.hasOwn(next.video, "angularWidth"), false);
  next.video.distanceMetres = 4;
  close(next.video.widthMetres, 1.0717967697244908);
  assert.ok(resolveXrLayoutProfileV1(next).screenAngles.widthDegrees < 16);
});

test("P6 angular height includes the edge centre and tilted extents match dense edge rays", () => {
  for (const c of cases.cases) {
    const g = resolveXrLayoutProfileV1(c.profile);
    const rays = g.videoCorners.flatMap((a, i) => {
      const b = g.videoCorners[(i + 1) % 4];
      return Array.from({ length: 1001 }, (_, t) => a.map((v, j) => v + (b[j] - v) * t / 1000));
    });
    const elevations = rays.map(([x, y, z]) => Math.atan2(y, Math.hypot(x, z)) * 180 / Math.PI);
    close(g.screenAngles.vertical[0], Math.min(...elevations), 1e-4);
    close(g.screenAngles.vertical[1], Math.max(...elevations), 1e-4);
  }
});

test("P6 arbitrary pose angles are readouts, never the centred inverse formula", () => {
  for (const field of ["azimuthDegrees", "elevationDegrees", "yawDegrees", "pitchDegrees", "rollDegrees"]) {
    const p = createDefaultXrLayoutProfile(); p.video[field] = 10;
    assert.equal(canEditXrAngularSize(p), false);
    assert.throws(() => withXrAngularSize(p, 30, 20), /centred/);
  }
});

test("P6 mixed-aspect videos preserve the fixed frame and feedback centre", () => {
  const p = createDefaultXrLayoutProfile();
  const wide = resolveXrLayoutProfileV1(p, { displayWidth: 1920, displayHeight: 1080 });
  const tall = resolveXrLayoutProfileV1(p, { displayWidth: 1080, displayHeight: 1920 });
  close(wide.fittedSize[0], 1.2); close(wide.fittedSize[1], 0.675);
  close(tall.fittedSize[0], 0.3796875); close(tall.fittedSize[1], 0.675);
  assert.deepEqual(wide.videoCentre, tall.videoCentre);
  assert.deepEqual(wide.feedbackCentre, tall.feedbackCentre);
  assert.throws(() => resolveXrLayoutProfileV1(p, { displayWidth: 0, displayHeight: 1920 }));
});

test("P6 alignment captures initial heading once and does not follow inspection/head motion", () => {
  const eye = [1, 2, 3], forward = [1, 0.3, 0];
  const anchor = createWorldFromSetup(eye, forward);
  assert.deepEqual(transformSetupPoint(anchor, [0, 0, -2]), [3, 2, 3]);
  forward[0] = 0; forward[2] = -1; eye[0] = 99;
  assert.deepEqual(transformSetupPoint(anchor, [0, 0, -2]), [3, 2, 3]);
  assert.throws(() => createWorldFromSetup([0, 0, 0], [0, 1, 0]), /horizontal/);
});

test("P6 target admission rejects desktop and unrecognized spatial contracts", () => {
  const p = createDefaultXrLayoutProfile();
  assert.equal(assertXrTargetSupported(p, { ...XR_TARGET_REQUIREMENTS }), true);
  for (const target of [null, { ...XR_TARGET_REQUIREMENTS, target: "desktop" },
    { ...XR_TARGET_REQUIREMENTS, profileVersion: 2 }, { ...XR_TARGET_REQUIREMENTS, gaze: true }]) {
    assert.throws(() => assertXrTargetSupported(p, target));
  }
  assert.throws(() => assertNoXrInV1Package(true), /v1/);
  assert.doesNotThrow(() => assertNoXrInV1Package(false));
});

test("P6 enabled/accepted/dirty/dependency transitions never return stale contributions", () => {
  const s = createXrLayoutState();
  assert.equal(s.getSnapshot().enabled, false);
  s.setEnabled(true); assert.equal(s.getSnapshot().pending, true); assert.throws(() => s.serialize());
  s.accept(); const saved = s.serialize(); assert.equal(s.getSnapshot().pending, false);
  const draft = s.getDraft(); draft.video.distanceMetres = null; s.setDraft(draft);
  assert.equal(s.getSnapshot().contribution, null); assert.throws(() => s.accept()); assert.throws(() => s.serialize());
  s.load(saved); assert.equal(s.serialize(), saved);
  s.setDependencyRevisions({ catalogue: 2, feedback: 3 });
  assert.equal(s.getSnapshot().pending, true);
  assert.deepEqual(s.getSnapshot().dependencyRevisions, [{ segment: "P1", revision: 2 }, { segment: "P5", revision: 3 }]);
  s.accept(); s.setEnabled(false); assert.equal(s.getSnapshot().contribution, null);
  assert.equal(s.getSnapshot().pending, false);
  const unchanged = s.getSnapshot();
  s.setDependencyRevisions({ feedback: 3, catalogue: 2 });
  assert.deepEqual(s.getSnapshot(), unchanged, "object-key order does not invalidate a dependency");
});

test("P6 reopen failure and caller mutation leave accepted state intact", () => {
  const s = createXrLayoutState(); s.load(fixture);
  const before = s.getSnapshot();
  assert.throws(() => s.load("{}")); assert.deepEqual(s.getSnapshot(), before);
  before.contribution.video.widthMetres = 99;
  assert.equal(s.serialize(), fixture);
  assert.throws(() => s.setDependencyRevisions({ catalogue: -1, feedback: 0 }));
});

test("P6 inspection and UI markup are isolated from saved settings and hardware", async () => {
  const p = createDefaultXrLayoutProfile(), before = serializeXrLayoutProfileV1(p);
  const a = xrLayoutSceneSvg(p, { yaw: 0, elevation: 0 });
  const b = xrLayoutSceneSvg(p, { yaw: 90, elevation: 20 });
  assert.notEqual(a, b); assert.equal(serializeXrLayoutProfileV1(p), before);
  for (const camera of [null, { yaw: NaN, elevation: 0 }, { yaw: 181, elevation: 0 }, { yaw: 0, elevation: -91 }]) {
    assert.throws(() => xrLayoutSceneSvg(p, camera));
  }
  const markup = xrLayoutEditorMarkup();
  assert.match(markup, /Inspection yaw/); assert.match(markup, /role="status"/);
  assert.match(markup, /data-xr-layout-editor/); assert.doesNotMatch(markup, /<iframe|<video|<canvas/);
  for (const file of ["xr-layout.js", "xr-layout-editor.js", "xr-layout-view.js", "xr-layout-feedback.js"]) {
    const source = await readFile(new URL(`../site/src/research/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /navigator\.xr|requestSession|getUserMedia|localStorage|indexedDB|@tauri-apps/);
  }
  await assert.rejects(() => parseExperimentPackageV1(fixture));
});

test("P6 maps the whole P5 animation square into its explicit maximum circular footprint", () => {
  const profile = createDefaultXrLayoutProfile();
  profile.video.rollDegrees = 35;
  const envelope = { algorithmVersion: "feedback-envelope-v1", origin: "design-centre",
    overlaySideCssPx: XR_FEEDBACK_VIEWPORT_CSS_PX, halfExtentCssPx: 650, configurationKey: "fixture" };
  const resolved = resolveXrFeedbackFootprintV1(profile, envelope);
  close(resolved.halfExtentMetres, .25 / (2 * Math.SQRT2));
  close(resolved.metresPerCssPx * 650 * Math.SQRT2, .125);
  const { feedbackCentre } = resolveXrLayoutProfileV1(profile);
  for (const corner of resolved.bounds) close(Math.hypot(...corner.map((v, i) => v - feedbackCentre[i])), .125);
  const larger = resolveXrFeedbackFootprintV1(profile, { ...envelope, halfExtentCssPx: 1000 });
  assert.ok(larger.metresPerCssPx < resolved.metresPerCssPx);
  assert.deepEqual(larger.bounds, resolved.bounds, "full bound stays fixed across configurations and all animation states");
  assert.match(xrLayoutSceneSvg(profile, undefined, null, resolved), /xr-feedback-envelope/);
  assert.equal(resolveXrFeedbackFootprintV1(profile, { ...envelope, halfExtentCssPx: 0 }).visible, false);
  for (const patch of [{ algorithmVersion: "v2" }, { origin: "centroid" }, { overlaySideCssPx: 500 },
    { halfExtentCssPx: Infinity }, { halfExtentCssPx: -1 }, { halfExtentCssPx: Number.MIN_VALUE }, { configurationKey: "" }]) {
    assert.throws(() => resolveXrFeedbackFootprintV1(profile, { ...envelope, ...patch }));
  }
});

test("P6 consumes only explicit unique P1 display geometry and contains every asset", () => {
  const p = createDefaultXrLayoutProfile();
  const catalogue = [{ assetId: "opaque-a", displayWidth: 1920, displayHeight: 1080 },
    { assetId: "opaque-b", displayWidth: 1080, displayHeight: 1920 }];
  const result = resolveXrCatalogueV1(p, catalogue);
  assert.deepEqual(result.map(({assetId}) => assetId), ["opaque-a", "opaque-b"]);
  close(result[1].geometry.fittedSize[0], .3796875);
  assert.deepEqual(result[0].geometry.videoCentre, result[1].geometry.videoCentre);
  for (const invalid of [null, [...catalogue, catalogue[0]], [{ ...catalogue[0], displayHeight: 0 }],
    [{ ...catalogue[0], status: "unverified" }], [{ displayWidth: 100, displayHeight: 100 }]]) {
    assert.throws(() => resolveXrCatalogueV1(p, invalid));
  }
});

test("P6 full-envelope fixture retains exact P5 provenance and reproducible physical geometry", async () => {
  const fixture = JSON.parse(await readFile(new URL("fixtures/xr-feedback-envelope-v1.json", import.meta.url), "utf8"));
  for (const {profile, envelope, expected} of fixture.cases) {
    assert.deepEqual(resolveXrFeedbackFootprintV1(profile, envelope), expected);
  }
});

test("P6 conformance is reproducible in two independent processes with ambient reads forbidden", async () => {
  const url = new URL("../site/src/research/xr-layout.js", import.meta.url).href;
  const code = `const m = await import(${JSON.stringify(url)});
    const source = ${JSON.stringify(fixture)};
    Math.random = () => { throw Error('RNG'); };
    Date.now = () => { throw Error('clock'); };
    for (const key of ['localStorage','indexedDB','navigator']) Object.defineProperty(globalThis,key,{configurable:true,get(){throw Error(key)}});
    const profile=m.parseXrLayoutProfileV1(source);
    process.stdout.write(JSON.stringify({receipt:await m.xrLayoutReceipt(profile),geometry:m.resolveXrLayoutProfileV1(profile)}));`;
  const run = promisify(execFile);
  const outputs = await Promise.all(["de-DE", "en-US"].map((locale) => run(process.execPath,
    ["--input-type=module", "-e", code], { windowsHide: true, env: { ...process.env, LANG: locale, TZ: locale === "de-DE" ? "Europe/Berlin" : "UTC" } })));
  assert.equal(outputs[0].stdout, outputs[1].stdout);
  assert.equal(JSON.parse(outputs[0].stdout).receipt.canonicalSource, fixture);
});
