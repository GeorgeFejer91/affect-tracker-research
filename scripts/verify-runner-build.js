import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "experiment-runner/dist");
const files = (await readdir(dist, { recursive: true, withFileTypes: true })).filter((item) => item.isFile())
  .map((item) => relative(dist, resolve(item.parentPath, item.name)).replaceAll("\\", "/"));
const expectedKinds = ["index.html", "surveyjs-notices.txt", "runner.js", "runner.css", "runner-symbol.svg", "app-symbol.svg", "professor-qr.svg", "controller-qr.svg", "professor-widget.svg", "input-widget.svg", "remote-widget.svg"];
const actualKinds = files.map(file => file === "index.html" ? file : file.replace(/^assets\/(professor-widget|input-widget|remote-widget|professor-qr|controller-qr|runner-symbol|app-symbol|runner)-[\w-]+\.(js|css|svg)$/u, "$1.$2"));
assert.deepEqual(actualKinds.sort(), expectedKinds.sort(), "Runner build must contain exactly the declared entry and referenced shared CSS assets.");
const graph = await build({ entryPoints: [resolve(root, "experiment-runner/src/entry.js")], bundle: true, write: false, metafile: true, format: "esm", loader: { ".svg": "dataurl" }, logLevel: "silent" });
const sharedRecipeReaders = new Set(["planner-recipe.js", "planner-recipe-wire.js", "planner-recipe-policy.js", "planner-recipe-questionnaires.js", "planner-recipe-reproduction.js", "planner-recipe-assets.js", "planner-recipe-transport.js"]);
for (const input of Object.keys(graph.metafile.inputs)) {
  if (sharedRecipeReaders.has(input.replaceAll("\\", "/").split("/").at(-1))) continue;
  assert.doesNotMatch(input.replaceAll("\\", "/"), /experiment-planner\/web\/src\/research\/(?:app|ui-view|native-bridge|runtime-bridge|planner-.+|.+-editor)\.js$/u, "Runner must not import Planner composition or editors.");
}
const planner = JSON.parse(await readFile(resolve(root, "native/tauri.conf.json")));
const runner = JSON.parse(await readFile(resolve(root, "native/tauri.runner.conf.json")));
assert.notEqual(planner.identifier, runner.identifier);
assert.notEqual(planner.build.frontendDist, runner.build.frontendDist);
assert.notEqual(planner.build.devUrl, runner.build.devUrl);
console.log(`Runner boundary verified (${files.length} files; ${Object.keys(graph.metafile.inputs).length} dependency inputs; separate desktop identity).`);
