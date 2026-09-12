import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "runner/dist");
const files = (await readdir(dist, { recursive: true, withFileTypes: true })).filter((item) => item.isFile())
  .map((item) => relative(dist, resolve(item.parentPath, item.name)).replaceAll("\\", "/"));
assert.equal(files.length, 5, "Runner must have an explicit five-file frontend closure.");
for (const file of files) assert.match(file, /^(?:index\.html|assets\/(?:runner|runner-symbol|app-symbol)-[\w-]+\.(?:js|css|svg))$/u);
const graph = await build({ entryPoints: [resolve(root, "runner/src/entry.js")], bundle: true, write: false, metafile: true, format: "esm", loader: { ".svg": "dataurl" }, logLevel: "silent" });
for (const input of Object.keys(graph.metafile.inputs)) {
  assert.doesNotMatch(input.replaceAll("\\", "/"), /site\/src\/research\/(?:app|ui-view|native-bridge|runtime-bridge|planner-.+|.+-editor)\.js$/u, "Runner must not import Planner composition or editors.");
}
const planner = JSON.parse(await readFile(resolve(root, "src-tauri/tauri.conf.json")));
const runner = JSON.parse(await readFile(resolve(root, "src-tauri/tauri.runner.conf.json")));
assert.notEqual(planner.identifier, runner.identifier);
assert.notEqual(planner.build.frontendDist, runner.build.frontendDist);
assert.notEqual(planner.build.devUrl, runner.build.devUrl);
console.log(`Runner boundary verified (${files.length} files; ${Object.keys(graph.metafile.inputs).length} dependency inputs; separate desktop identity).`);
