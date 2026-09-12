import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { canonicalJson } from "../site/src/research/canonical.js";
import { compilePlannerRecipeV1, parsePlannerRecipeFile, parsePlannerRecipeV1, serializePlannerRecipeV1,
  reproducePlannerRecipeV1, reconstructPlannerRecipeSelectionV1 } from "../site/src/research/planner-recipe.js";
import { openBrowserPlannerRecipeFile, prepareBrowserPlannerRecipeSave } from "../site/src/research/planner-recipe-file.js";
import { assertVariantReproduction } from "./fixtures/assert-variant-reproduction.js";
import { plannerLayoutIdentityV1 } from "../site/src/research/planner-recipe-reproduction.js";
import { projectVideoDisplayGeometry } from "../site/src/research/video-catalogue-contribution.js";
import { canonicalSha256 } from "../site/src/research/canonical.js";

const load = async name => JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const workspace = await load("variant-reproduction-v1");
const questionnaire = await load("questionnaire-recipe-v1");
const layout = await load("desktop-layout-candidates-v1");
const feedback = await load("research-feedback-settings-v2");
const policy = await load("planner-recipe-policy-v1");
const legacyBytes = new Uint8Array(await readFile(new URL("./fixtures/experiment-package-v1.canonical.json", import.meta.url)));
const core = () => structuredClone({ schema: "affect-research-planner-recipe", version: 1,
  recipeId: "complete-master", presentationTarget: "desktop-screen", policy,
  segments: { P1: workspace.workspace, P2: questionnaire, P3: workspace.contribution,
    P4: layout.cases[0].profile, P5: feedback, P6: { status: "excluded" } } });
const handle = bytes => ({ kind: "file", getFile: async () => ({ size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer }) });

const source = await readFile(new URL("./fixtures/planner-recipe-current-v1.canonical.json", import.meta.url), "utf8");
const bytes = new TextEncoder().encode(source);
const recipe = JSON.parse(source);
const matrixFixture = await load("planner-recipe-current-v1-reproduction");

test("full compiler and strict reader retain every owner and reproduce the complete saved matrix", async () => {
  const compiled = await compilePlannerRecipeV1(core());
  assert.equal(await serializePlannerRecipeV1(compiled), source);
  assert.deepEqual(compiled.segments, core().segments);
  const parsed = await parsePlannerRecipeV1(bytes);
  assert.equal(parsed.canonicalSourceText, source);
  assert.equal((await parsePlannerRecipeFile(bytes)).kind, "planner-recipe-v1");
  const matrix = await reproducePlannerRecipeV1(compiled);
  assert.deepEqual(matrix, matrixFixture);
  assert.equal(matrix.caseCount, matrix.routeCount * matrix.variantCount * matrix.presentationCount);
  assert.equal(matrix.variantCount, 3);
  const independent = await assertVariantReproduction(compiled.segments.P1, compiled.segments.P3,
    compiled.integrity.definitionSha256, workspace.expected);
  for (const row of matrix.cases) {
    const { selectionSha256: _hash, ...selector } = row;
    const selected = await reconstructPlannerRecipeSelectionV1(compiled, selector);
    assert.deepEqual(selected.feedback, feedback);
    assert.deepEqual(selected.policy, policy);
    assert.deepEqual(selected.assets, workspace.workspace.videoCatalogue.entries);
    const index = compiled.segments.P3.variants.findIndex(v => v.variantId === row.variantId);
    assert.deepEqual(selected.timeline, independent[index].timeline);
    assert.deepEqual(selected.markerProfile, independent[index].profile);
    for (const form of [...selected.questionnaires.beforeSession, ...selected.questionnaires.afterSession]) {
      assert.deepEqual(form.presentation, questionnaire.presentation.definitions.find(p => p.questionnaireId === form.definition.questionnaireId));
    }
  }
  for (const selected of [{ ...matrix.cases[0], presentationTarget: "webxr-immersive-vr" },
    { ...matrix.cases[0], languageSelectionPath: [] }, { ...matrix.cases[0], variantId: "absent" }]) {
    const { selectionSha256: _hash, ...selector } = selected;
    await assert.rejects(reconstructPlannerRecipeSelectionV1(compiled, selector));
  }
});

test("strict file transport and all root/segment integrity reject silent loss or repair", async () => {
  for (const malformed of [source.trim(), JSON.stringify(recipe, null, 2),
    source.replace('"recipeId":"complete-master"', '"recipeId":"complete-master","recipeId":"complete-master"'),
    source.replace('"segments":{', '"segments":{"__proto__":{},')]) {
    await assert.rejects(parsePlannerRecipeV1(new TextEncoder().encode(malformed)));
  }
  for (const mutate of [
    v => { delete v.segments.P6; }, v => { v.segments.P6.profile = {}; },
    v => { v.presentationTarget = "webxr-immersive-vr"; },
    v => { v.segments.P4.reference.source.policy = null; },
    v => { v.segments.P4.reference.source.displayWidthPx += 1; },
    v => { v.segments.P4.feedback.offset.y = 0; },
    v => { v.segments.P5.presentation.labels.axes.up = "Changed"; },
    v => { v.integrity.reproductionSha256 = "0".repeat(64); },
    v => { v.integrity.segmentSha256.P1 = "0".repeat(64); },
    v => { v.integrity.definitionSha256 = "0".repeat(64); },
    v => { v.policy.extra = true; }, v => { v.extra = true; },
  ]) {
    const value = structuredClone(recipe); mutate(value);
    await assert.rejects(parsePlannerRecipeV1(new TextEncoder().encode(`${canonicalJson(value)}\n`)));
  }
});

test("master preserves versioned location/content pairs and all separately named occurrences", async () => {
  const locations = await load("variant-reproduction-v2");
  const canonical = await readFile(new URL("./fixtures/planner-recipe-locations-v1.canonical.json", import.meta.url), "utf8");
  const { recipe: value } = await parsePlannerRecipeV1(new TextEncoder().encode(canonical));
  assert.equal(await serializePlannerRecipeV1(value), canonical);
  assert.deepEqual(value.segments.P1, locations.workspace);
  assert.deepEqual(value.segments.P3, locations.contribution);
  assert.deepEqual(await reproducePlannerRecipeV1(value), await load("planner-recipe-locations-v1-reproduction"));
  await assertVariantReproduction(value.segments.P1, value.segments.P3, value.integrity.definitionSha256, locations.expected);
  const entries = value.segments.P1.videoCatalogue.entries;
  assert.ok(new Set(entries.map(e => e.assetId)).size < entries.length);
  assert.equal(new Set(entries.map(e => e.annotationId)).size, entries.length);
  const { integrity: _integrity, ...input } = structuredClone(value);
  input.segments.P3.variants[0].entries.find(e => e.kind === "video").assetId = `asset-${"f".repeat(64)}`;
  await assert.rejects(compilePlannerRecipeV1(input), error => error.segment === "P3");
});

test("v2 binds exact layout inputs and named algorithms while v1 hashes retain their old meaning", async () => {
  for (const name of ["planner-recipe-current-v1", "planner-recipe-locations-current-v1", "planner-recipe-xr-current-v1"]) {
    const current = await load(`${name}.canonical`), matrix = await reproducePlannerRecipeV1(current);
    assert.equal(matrix.algorithmVersion, "planner-recipe-reproduction-v2");
    const media = (await projectVideoDisplayGeometry(current.segments.P1.videoCatalogue)).videos;
    for (const presentation of matrix.presentations) {
      assert.equal(Object.hasOwn(presentation, "layoutSha256"), false);
      const profile = presentation.presentationTarget === "desktop-screen" ? current.segments.P4 : current.segments.P6.profile;
      const identity = plannerLayoutIdentityV1(presentation.presentationTarget, profile, media, current.segments.P5);
      assert.equal(presentation.layoutIdentitySha256, await canonicalSha256(identity));
      assert.deepEqual(identity.profile, profile); assert.deepEqual(identity.feedback, current.segments.P5);
      const changed = structuredClone(identity); changed.media[0].displayWidth += 1;
      assert.notEqual(await canonicalSha256(changed), presentation.layoutIdentitySha256);
      const wrongAlgorithm = structuredClone(identity); wrongAlgorithm.algorithms.layout = "different-resolution";
      assert.notEqual(await canonicalSha256(wrongAlgorithm), presentation.layoutIdentitySha256);
    }
  }
});

test("a valid 66-node language graph is independent of JSON nesting and retains its one terminal path", async () => {
  const value = await load("planner-recipe-deep-language-v1.canonical");
  const encoded = new TextEncoder().encode(`${canonicalJson(value)}\n`);
  const parsed = await parsePlannerRecipeV1(encoded);
  const matrix = await reproducePlannerRecipeV1(parsed.recipe);
  assert.deepEqual(matrix, await load("planner-recipe-deep-language-v1-reproduction"));
  assert.equal(value.segments.P2.languageSelection.nodes.length, 66);
  assert.equal(matrix.routeCount, 1); assert.equal(matrix.caseCount, 3);
  assert.equal(matrix.languages[0].languageSelectionPath.length, 66);
  const { selectionSha256: _hash, ...selector } = matrix.cases[0];
  const selected = await reconstructPlannerRecipeSelectionV1(parsed.recipe, selector);
  assert.equal(selected.language.languageSelectionPath.length, 66);
});

test("two independent processes read only saved data and reproduce bytes and every selected projection", () => {
  const program = `import{readFileSync}from'node:fs';
    import{parsePlannerRecipeV1,serializePlannerRecipeV1,reproducePlannerRecipeV1,reconstructPlannerRecipeSelectionV1}from'./site/src/research/planner-recipe.js';
    import{canonicalJson}from'./site/src/research/canonical.js';
    const fail=()=>{throw Error('ambient state forbidden')};Math.random=fail;Date.now=fail;
    for(const key of ['localStorage','sessionStorage','navigator','document'])Object.defineProperty(globalThis,key,{get:fail});
    const bytes=new Uint8Array(readFileSync(process.argv[1]));const {recipe}=await parsePlannerRecipeV1(bytes);
    const matrix=await reproducePlannerRecipeV1(recipe),selections=[];
    for(const {selectionSha256,...selector}of matrix.cases)selections.push(await reconstructPlannerRecipeSelectionV1(recipe,selector));
    process.stdout.write(canonicalJson({source:await serializePlannerRecipeV1(recipe),matrix,selections}));`;
  const run = () => execFileSync(process.execPath, ["--input-type=module", "-e", program,
    "test/fixtures/planner-recipe-current-v1.canonical.json"], { cwd: new URL("..", import.meta.url), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const first = run(); assert.equal(run(), first);
  const observed = JSON.parse(first); assert.equal(observed.source, source);
  assert.deepEqual(observed.matrix, matrixFixture);
  assert.equal(observed.selections.length, observed.matrix.caseCount);
});

test("complete owner validation rejects corruption before any successor file can be constructed", async () => {
  const changes = [
    ["P1", value => { value.segments.P1.videoCatalogue.integritySha256 = "0".repeat(64); }],
    ["P2", value => { value.segments.P2.presentation.definitions[0].repeatLabelsEvery = 2; }],
    ["P3", value => { value.segments.P3.allocation.kind = "cyclic"; }],
    ["P5", value => { value.segments.P5.response.grid.columns = 4; }],
  ];
  for (const [segment, change] of changes) {
    const input = core(); change(input);
    await assert.rejects(compilePlannerRecipeV1(input), error => error.segment === segment);
  }
  const prototypeKey = core();
  Object.defineProperty(prototypeKey.segments.P5, "__proto__", { value: {}, enumerable: true });
  await assert.rejects(compilePlannerRecipeV1(prototypeKey), /__proto__/u);
});

test("compiler captures owner content before asynchronous domain hashing", async () => {
  const input = core(), pending = compilePlannerRecipeV1(input);
  input.segments.P2.presentation.definitions[0].repeatLabelsEvery = 2;
  assert.equal(await serializePlannerRecipeV1(await pending), source);
});

test("new file dispatcher preserves exact legacy reader and rejects unknown schema/version", async () => {
  for (const name of ["planner-recipe-v1", "planner-recipe-locations-v1", "planner-xr-master-v1"]) {
    const oldBytes = new Uint8Array(await readFile(new URL(`./fixtures/${name}.canonical.json`, import.meta.url)));
    const saved = await parsePlannerRecipeV1(oldBytes);
    assert.equal(saved.recipe.integrity.algorithmVersion, "planner-recipe-reproduction-v1");
    assert.equal(await serializePlannerRecipeV1(saved.recipe), new TextDecoder().decode(oldBytes));
  }
  const opened = await parsePlannerRecipeFile(legacyBytes);
  assert.equal(opened.kind, "experiment-package-v1");
  assert.equal(opened.document.canonicalSourceText, new TextDecoder().decode(legacyBytes));
  for (const value of [null, {}, { schema: "unknown", version: 1 }]) {
    await assert.rejects(parsePlannerRecipeFile(new TextEncoder().encode(`${JSON.stringify(value)}\n`)), /Unsupported/u);
  }
  const unsupportedVersion = new TextDecoder().decode(legacyBytes).replace(/"version":1\}\n$/u, '"version":2}\n');
  await assert.rejects(parsePlannerRecipeFile(new TextEncoder().encode(unsupportedVersion)), /unsupported/u);
});

test("named Open invokes its picker before awaiting and returns only strict dispatched content", async () => {
  let picks = 0;
  const pending = openBrowserPlannerRecipeFile({ isCurrent: () => true, pickOpenFile: () => { picks += 1; return Promise.resolve([handle(legacyBytes)]); } });
  assert.equal(picks, 1);
  assert.equal((await pending).kind, "experiment-package-v1");
  const cancelled = await openBrowserPlannerRecipeFile({ isCurrent: () => true, pickOpenFile: () => { throw Object.assign(Error("cancelled"), { name: "AbortError" }); } });
  assert.equal(cancelled, null);
});

test("late selected-file bytes cannot outlive the caller operation", async () => {
  let current = true, release;
  const buffer = new Promise(resolve => { release = resolve; });
  const pending = openBrowserPlannerRecipeFile({ isCurrent: () => current,
    pickOpenFile: () => [{ kind: "file", getFile: async () => ({ size: legacyBytes.byteLength, arrayBuffer: () => buffer }) }] });
  await Promise.resolve(); current = false; release(legacyBytes.slice().buffer);
  await assert.rejects(pending, /changed/u);
});

test("successor save validates source and currentness before requesting a destination", async () => {
  let picks = 0;
  const pickSaveFile = () => { picks += 1; throw Error("must not open"); };
  await assert.rejects(prepareBrowserPlannerRecipeSave(new TextDecoder().decode(legacyBytes), { isCurrent: () => true, pickSaveFile }));
  await assert.rejects(prepareBrowserPlannerRecipeSave("{}\n", { isCurrent: () => false, pickSaveFile }), /changed/u);
  await assert.rejects(prepareBrowserPlannerRecipeSave("{}\n", { pickSaveFile }), /guard/u);
  assert.equal(picks, 0);
});
