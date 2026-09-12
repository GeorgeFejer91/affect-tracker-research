import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "runner/dist");
const files = (await readdir(dist, { recursive: true, withFileTypes: true })).filter((item) => item.isFile())
  .map((item) => relative(dist, resolve(item.parentPath, item.name)).replaceAll("\\", "/"));
const expectedKinds = ["index.html", "runner.js", "runner.css", "runner-symbol.svg", "app-symbol.svg"];
const sharedCss = await readFile(resolve(root, "site/research.css"), "utf8");
for (const theme of ["dark", "light"]) {
  if (sharedCss.includes(`flubber-input-${theme}.svg`)) expectedKinds.push(`flubber-input-${theme}.svg`);
}
const actualKinds = files.map(file => file === "index.html" ? file : file.replace(/^assets\/(runner-symbol|app-symbol|flubber-input-dark|flubber-input-light|runner)-[\w-]+\.(js|css|svg)$/u, "$1.$2"));
assert.deepEqual(actualKinds.sort(), expectedKinds.sort(), "Runner build must contain exactly the declared entry and referenced shared CSS assets.");
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
