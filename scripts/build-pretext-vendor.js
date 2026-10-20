import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";

const directory = "site/src/research/vendor";
const pkg = JSON.parse(await readFile("node_modules/@chenglou/pretext/package.json", "utf8"));
if (pkg.version !== "0.0.9") throw new Error("Pinned Pretext version changed.");
const result = await build({
  stdin: { contents: 'export { measureLineStats, measureNaturalWidth, prepareWithSegments } from "@chenglou/pretext";', resolveDir: process.cwd() },
  bundle: true, write: false, format: "esm", minify: true, platform: "browser", legalComments: "inline",
  banner: { js: "/*! @chenglou/pretext 0.0.9, MIT. See pretext-LICENSE.txt. */" },
});
const files = [
  ["pretext.js", result.outputFiles[0].text],
  ["pretext-LICENSE.txt", await readFile("node_modules/@chenglou/pretext/LICENSE", "utf8")],
];
for (const [name, content] of files) {
  const path = `${directory}/${name}`;
  if (process.argv.includes("--check")) {
    if (await readFile(path, "utf8") !== content) throw new Error(`${name} is stale.`);
  } else await writeFile(path, content);
}
console.log("Pinned Pretext browser module and license verified.");
