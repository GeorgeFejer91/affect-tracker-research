import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readCatalogue, renderReference, renderExternalContract } from "../scripts/render-cli-reference.mjs";

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
