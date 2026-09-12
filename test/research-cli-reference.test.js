import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readCatalogue, renderReference, renderExternalContract, validateCatalogueShape, renderConsequences } from "../scripts/render-cli-reference.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function copiedReference(t) {
  const directory = await mkdtemp(resolve(tmpdir(), "affect-cli-reference-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const reference = await readCatalogue(root);
  for (const file of reference.sourceFiles) {
    const target = resolve(directory, file.path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, await readFile(resolve(root, file.path)));
  }
  await mkdir(resolve(directory, "docs/cli"), { recursive: true });
  await writeFile(resolve(directory, "docs/cli/planner-authoring-catalogue-evidence.json"), await readFile(resolve(root, "docs/cli/planner-authoring-catalogue-evidence.json")));
  const save = () => writeFile(resolve(directory, "docs/cli/planner-authoring-catalogue.json"), JSON.stringify(reference));
  await save();
  return { directory, reference, save };
}

test("public reference contains every registered descriptor once and distinguishes internal native operations", async () => {
  const { html, reference } = await renderReference(root);
  const ids = [...html.matchAll(/data-descriptor="([^"]+)"/gu)].map(match => match[1]);
  const expected = [...reference.catalogue.settings.map(field => field.id), ...reference.catalogue.operations.map(operation => `${operation.owner}.${operation.id}`)];
  assert.deepEqual(ids.sort(), expected.sort());
  assert.ok(!html.includes("<!-- CLI:"));
  assert.ok(html.includes("Internal consequential descriptor"));
  assert.ok(html.includes("no segments.P7"));
  assert.ok(html.includes(reference.sourceRevision));
  for (const match of html.matchAll(/href="#([^"]+)"/gu)) assert.ok(html.includes(`id="${match[1]}"`));
});

test("source drift blocks documentation instead of silently publishing an old catalogue", async t => {
  const { directory, reference } = await copiedReference(t);
  await writeFile(resolve(directory, reference.sourceFiles[0].path), "changed source");
  await assert.rejects(readCatalogue(directory), /catalogue is stale/u);
});

test("duplicate settings and incomplete source bindings reject", async t => {
  const { directory, reference, save } = await copiedReference(t);
  reference.catalogue.settings.push(reference.catalogue.settings[0]);
  await save();
  await assert.rejects(readCatalogue(directory), /duplicate CLI setting/u);
  reference.catalogue.settings.pop();
  reference.sourceFiles = reference.sourceFiles.filter(file => !file.path.endsWith("planner-authoring-p7.js"));
  await save();
  await assert.rejects(readCatalogue(directory), /required source binding/u);
});

test("source bindings cannot escape the checkout", async t => {
  const { directory, reference, save } = await copiedReference(t);
  reference.sourceFiles[0].path = "../outside.js";
  await save();
  await assert.rejects(readCatalogue(directory), /source binding/u);
});

test("a hand-edited descriptor cannot pass using unchanged source bindings", async t => {
  const { directory, reference, save } = await copiedReference(t);
  reference.catalogue.settings[0].label = "Invented descriptor";
  await save();
  await assert.rejects(readCatalogue(directory), /production evidence/u);
});

test("external commands render from the frozen contract without interpreting markup", () => {
  const source = '| Operation | Arguments | Authority |\n| --- | --- | --- |\n| `example` | `{kind:"a"\\|"b"}` | <script>alert(1)</script> |';
  const html = renderExternalContract(source);
  assert.ok(html.includes("&quot;a&quot;|&quot;b&quot;"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.throws(() => renderExternalContract("missing table"), /table is missing/u);
});

const publicCommand = () => ({
  id: "importVideos", owner: "P1", label: '<script>"metadata"</script>',
  arguments: { type: "object", additionalProperties: false, required: ["paths"], properties: { paths: { type: "array", items: { type: "string" } } } },
});
const catalogueWith = consequences => ({ settings: [], operations: [{ id: "importVideos", owner: "P1" }], consequences });

test("catalogue namespace compatibility retains absent and empty consequences independently", () => {
  const legacy = { settings: [], operations: [] };
  assert.doesNotThrow(() => validateCatalogueShape(legacy));
  assert.equal(renderConsequences(legacy), "");
  assert.doesNotThrow(() => validateCatalogueShape(catalogueWith([])));
  assert.match(renderConsequences(catalogueWith([])), /0 public consequences/u);
  const catalogue = catalogueWith([publicCommand()]);
  const before = JSON.stringify(catalogue);
  assert.doesNotThrow(() => validateCatalogueShape(catalogue));
  const html = renderConsequences(catalogue);
  assert.equal(JSON.stringify(catalogue), before);
  assert.equal((html.match(/data-consequence="importVideos"/gu) ?? []).length, 1);
  assert.ok(!html.includes("data-descriptor="));
  assert.ok(html.includes("use perform"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&quot;items&quot;"));
});

test("capture and reader shared validation reject unknown or malformed namespaces", () => {
  for (const consequences of [null, {}, "commands", 1]) {
    assert.throws(() => validateCatalogueShape(catalogueWith(consequences)), /namespaces/u);
  }
  for (const catalogue of [{ operations: [] }, { settings: [] }, { settings: [], operations: [], unknown: [] }]) {
    assert.throws(() => validateCatalogueShape(catalogue), /namespaces/u);
  }
});

test("public consequences require globally unique IDs and exact closed required arguments", () => {
  const duplicate = publicCommand();
  duplicate.owner = "P2";
  assert.throws(() => validateCatalogueShape(catalogueWith([publicCommand(), duplicate])), /duplicate public/u);
  const mutations = [
    item => { item.id = "P1.invalid"; },
    item => { item.owner = "P8"; },
    item => { item.arguments.additionalProperties = true; },
    item => { item.arguments.required = ["paths", "paths"]; },
    item => { item.arguments.required = ["other"]; },
    item => { item.arguments.required = []; },
    item => { item.arguments.required = [1]; },
    item => { item.arguments.properties = []; },
    item => { item.arguments.properties = null; },
    item => { item.arguments.type = "array"; },
  ];
  for (const mutate of mutations) {
    const item = publicCommand(); mutate(item);
    assert.throws(() => validateCatalogueShape(catalogueWith([item])), /public CLI consequence/u);
  }
  assert.throws(() => validateCatalogueShape(catalogueWith([null])), /public CLI consequence/u);
});

test("reader and full page retain consequences separately under the complete evidence digest", async t => {
  const { directory, reference, save } = await copiedReference(t);
  reference.catalogue.consequences = [publicCommand()];
  await save();
  await assert.rejects(readCatalogue(directory), /production evidence/u);
  // This isolated test fixture is not a production catalogue or capture receipt.
  const evidencePath = resolve(directory, "docs/cli/planner-authoring-catalogue-evidence.json");
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  evidence.catalogueSha256 = createHash("sha256").update(JSON.stringify(reference.catalogue)).digest("hex");
  await writeFile(evidencePath, JSON.stringify(evidence));
  for (const path of ["site/about/index.html", "docs/planner-cli-consequential-commands-v1.md"]) {
    await mkdir(resolve(directory, path, ".."), { recursive: true });
    await writeFile(resolve(directory, path), await readFile(resolve(root, path)));
  }
  const { html, reference: rendered } = await renderReference(directory);
  assert.deepEqual(rendered.catalogue, reference.catalogue);
  assert.equal((html.match(/data-descriptor=/gu) ?? []).length, reference.catalogue.settings.length + reference.catalogue.operations.length);
  assert.deepEqual([...html.matchAll(/data-consequence="([^"]+)"/gu)].map(match => match[1]), ["importVideos"]);
  assert.ok(html.includes("1 public consequences"));
  reference.catalogue.consequences[0].label = "Changed after capture";
  await save();
  await assert.rejects(readCatalogue(directory), /production evidence/u);
});
