import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "runner/dist");
const files = (await readdir(dist, { recursive: true, withFileTypes: true })).filter((item) => item.isFile())
  .map((item) => relative(dist, resolve(item.parentPath, item.name)).replaceAll("\\", "/"));
const expectedKinds = ["index.html", "runner.js", "runner.css", "runner-symbol.svg", "app-symbol.svg", "professor-qr.svg", "controller-qr.svg", "professor-widget.svg", "input-widget.svg", "remote-widget.svg"];
const sharedCss = await readFile(resolve(root, "site/research.css"), "utf8");
for (const theme of ["dark", "light"]) {
  if (sharedCss.includes(`flubber-input-${theme}.svg`)) {
    // Vite coalesces byte-identical assets. The shared dark input symbol is also
    // the Runner widget; require the exact bytes, not a second physical copy.
    const source = await readFile(resolve(root, `site/assets/flubber-input-${theme}.svg`));
    const runnerInput = await readFile(resolve(root, "runner/assets/input-widget.svg"));
    if (!source.equals(runnerInput)) expectedKinds.push(`flubber-input-${theme}.svg`);
  }
}
const actualKinds = files.map(file => file === "index.html" ? file : file.replace(/^assets\/(professor-widget|input-widget|remote-widget|professor-qr|controller-qr|runner-symbol|app-symbol|flubber-input-dark|flubber-input-light|runner)-[\w-]+\.(js|css|svg)$/u, "$1.$2"));
assert.deepEqual(actualKinds.sort(), expectedKinds.sort(), "Runner build must contain exactly the declared entry and referenced shared CSS assets.");
const graph = await build({ entryPoints: [resolve(root, "runner/src/entry.js")], bundle: true, write: false, metafile: true, format: "esm", loader: { ".svg": "dataurl" }, logLevel: "silent" });
const sharedRecipeReaders = new Set(["planner-recipe.js", "planner-recipe-wire.js", "planner-recipe-policy.js", "planner-recipe-questionnaires.js", "planner-recipe-reproduction.js"]);
for (const input of Object.keys(graph.metafile.inputs)) {
  if (sharedRecipeReaders.has(input.replaceAll("\\", "/").split("/").at(-1))) continue;
  assert.doesNotMatch(input.replaceAll("\\", "/"), /site\/src\/research\/(?:app|ui-view|native-bridge|runtime-bridge|planner-.+|.+-editor)\.js$/u, "Runner must not import Planner composition or editors.");
}
const planner = JSON.parse(await readFile(resolve(root, "src-tauri/tauri.conf.json")));
const runner = JSON.parse(await readFile(resolve(root, "src-tauri/tauri.runner.conf.json")));
assert.notEqual(planner.identifier, runner.identifier);
assert.notEqual(planner.build.frontendDist, runner.build.frontendDist);
assert.notEqual(planner.build.devUrl, runner.build.devUrl);
console.log(`Runner boundary verified (${files.length} files; ${Object.keys(graph.metafile.inputs).length} dependency inputs; separate desktop identity).`);
