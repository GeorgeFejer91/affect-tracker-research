import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = resolve(repositoryRoot, "site");
const outputRoot = resolve(repositoryRoot, "dist-pages");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(resolve(outputRoot, "src"), { recursive: true });
await mkdir(resolve(outputRoot, "assets"), { recursive: true });
await Promise.all([
  cp(resolve(sourceRoot, "index.html"), resolve(outputRoot, "index.html")),
  cp(resolve(sourceRoot, "research.html"), resolve(outputRoot, "research.html")),
  cp(resolve(sourceRoot, "launcher.css"), resolve(outputRoot, "launcher.css")),
  cp(resolve(sourceRoot, "planner"), resolve(outputRoot, "planner"), { recursive: true }),
  cp(resolve(sourceRoot, "runner"), resolve(outputRoot, "runner"), { recursive: true }),
  cp(resolve(sourceRoot, "research.css"), resolve(outputRoot, "research.css")),
  cp(resolve(sourceRoot, "experiment-template.json"), resolve(outputRoot, "experiment-template.json")),
  cp(resolve(sourceRoot, "src", "math.js"), resolve(outputRoot, "src", "math.js")),
  cp(resolve(sourceRoot, "src", "research"), resolve(outputRoot, "src", "research"), { recursive: true }),
  cp(resolve(sourceRoot, "questionnaires"), resolve(outputRoot, "questionnaires"), { recursive: true }),
  cp(resolve(sourceRoot, "assets", "app-logo.svg"), resolve(outputRoot, "assets", "app-logo.svg")),
  cp(resolve(sourceRoot, "assets", "app-symbol.svg"), resolve(outputRoot, "assets", "app-symbol.svg")),
  cp(resolve(repositoryRoot, "runner", "assets", "runner-symbol.svg"), resolve(outputRoot, "assets", "runner-symbol.svg")),
  cp(resolve(sourceRoot, "assets", "app-icons"), resolve(outputRoot, "assets", "app-icons"), { recursive: true }),
  cp(
    resolve(sourceRoot, "assets", "research-stimuli"),
    resolve(outputRoot, "assets", "research-stimuli"),
    { recursive: true },
  ),
]);

// Browser delivery shares Research contracts and UI modules, but must not ship
// any Tauri-only entrypoint or native adapter implementation.
await Promise.all([
  "native-bridge.js",
  "native-entry.js",
  "native-media-catalogue.js",
  "native-media-controller.js",
  "native-package-protocol.js",
  "native-run-media.js",
].map((name) => rm(resolve(outputRoot, "src", "research", name), { force: true })));

// Bind the published entrypoints to the exact checkout used by Pages CI.
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
if (!/^[0-9a-f]{40}$/u.test(revision)) throw new Error("Invalid Pages source revision.");
for (const entrypoint of ["index.html", "planner/index.html", "runner/index.html", "research.html"]) {
  const path = resolve(outputRoot, entrypoint);
  const html = await readFile(path, "utf8");
  await writeFile(path, html.replace("</head>", `  <meta name="build-revision" content="${revision}">\n  </head>`));
}
await writeFile(resolve(outputRoot, "build-info.json"), `${JSON.stringify({ schema: "affect-tracker-pages-build-v1", revision })}\n`);
