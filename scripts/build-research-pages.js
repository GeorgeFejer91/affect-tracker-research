import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = resolve(repositoryRoot, "experiment-planner", "web");
const outputRoot = resolve(repositoryRoot, "dist-pages");
const distributableQuestionnaireFiles = Object.freeze([
  "questionnaire-template.csv",
  "questionnaire-template.txt",
  "questionnaire-template.json",
  "maia-2-de.csv",
  "maia-2-en.csv",
  "ssq-six-item-en.csv",
  "vr-exp-en.csv",
]);
const pretextRuntimeFiles = Object.freeze([
  "analysis.js",
  "bidi.js",
  "layout.js",
  "line-break.js",
  "line-text.js",
  "measurement.js",
  "generated/bidi-data.js",
]);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(resolve(outputRoot, "src"), { recursive: true });
await mkdir(resolve(outputRoot, "assets"), { recursive: true });
await mkdir(resolve(outputRoot, "questionnaires"), { recursive: true });
await mkdir(resolve(outputRoot, "dependencies", "pretext", "generated"), { recursive: true });
await Promise.all([
  cp(resolve(sourceRoot, "index.html"), resolve(outputRoot, "index.html")),
  cp(resolve(sourceRoot, "research.html"), resolve(outputRoot, "research.html")),
  cp(resolve(sourceRoot, "preview.html"), resolve(outputRoot, "preview.html")),
  cp(resolve(sourceRoot, "launcher.css"), resolve(outputRoot, "launcher.css")),
  cp(resolve(sourceRoot, "planner"), resolve(outputRoot, "planner"), { recursive: true }),
  cp(resolve(sourceRoot, "planner-ledger"), resolve(outputRoot, "planner-ledger"), { recursive: true }),
  cp(resolve(sourceRoot, "research.css"), resolve(outputRoot, "research.css")),
  cp(resolve(sourceRoot, "experiment-template.json"), resolve(outputRoot, "experiment-template.json")),
  cp(resolve(sourceRoot, "src", "math.js"), resolve(outputRoot, "src", "math.js")),
  cp(resolve(sourceRoot, "src", "research"), resolve(outputRoot, "src", "research"), { recursive: true }),
  ...distributableQuestionnaireFiles.map((name) => cp(
    resolve(sourceRoot, "questionnaires", name),
    resolve(outputRoot, "questionnaires", name),
  )),
  cp(resolve(sourceRoot, "assets", "app-logo.svg"), resolve(outputRoot, "assets", "app-logo.svg")),
  cp(resolve(sourceRoot, "assets", "app-symbol.svg"), resolve(outputRoot, "assets", "app-symbol.svg")),
  cp(resolve(sourceRoot, "assets", "ledger-tab-icons.svg"), resolve(outputRoot, "assets", "ledger-tab-icons.svg")),
  ...pretextRuntimeFiles.map((name) => cp(
    resolve(repositoryRoot, "node_modules", "@chenglou", "pretext", "dist", name),
    resolve(outputRoot, "dependencies", "pretext", name),
  )),
  ...["en", "de"].map(language => cp(resolve(sourceRoot, "assets", "questionnaires", "demographics", `${language}.json`),
    resolve(outputRoot, "assets", "questionnaires", "demographics", `${language}.json`))),
  cp(resolve(repositoryRoot, "experiment-runner", "assets", "runner-symbol.svg"), resolve(outputRoot, "assets", "runner-symbol.svg")),
  cp(resolve(sourceRoot, "assets", "app-icons"), resolve(outputRoot, "assets", "app-icons"), { recursive: true }),
  cp(
    resolve(sourceRoot, "assets", "research-stimuli"),
    resolve(outputRoot, "assets", "research-stimuli"),
    { recursive: true },
  ),
]);

const textFitPath = resolve(outputRoot, "src", "research", "text-fit.js");
const textFitSource = await readFile(textFitPath, "utf8");
const pagesTextFitSource = textFitSource.replace(
  "../../../../node_modules/@chenglou/pretext/dist/layout.js",
  "../../dependencies/pretext/layout.js",
);
if (pagesTextFitSource === textFitSource) throw new Error("Pretext Pages import was not found.");
await writeFile(textFitPath, pagesTextFitSource);

// Browser delivery shares Research contracts and UI modules, but must not ship
// any Tauri-only entrypoint or native adapter implementation.
await Promise.all([
  "native-bridge.js",
  "native-entry.js",
  "native-package-protocol.js",
].map((name) => rm(resolve(outputRoot, "src", "research", name), { force: true })));

// Browser Runner is bundled separately so the desktop Tauri entrypoint remains
// outside the public Pages artifact while the shared Runner UI can be reused.
execFileSync(process.execPath, [resolve(repositoryRoot, "node_modules", "vite", "bin", "vite.js"), "build", "--config", "experiment-runner/vite.pages.config.js"], {
  cwd: repositoryRoot,
  stdio: "inherit",
});
await rename(resolve(outputRoot, "runner", "browser.html"), resolve(outputRoot, "runner", "index.html"));

// Bind the published entrypoints to the exact checkout used by Pages CI.
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
if (!/^[0-9a-f]{40}$/u.test(revision)) throw new Error("Invalid Pages source revision.");
for (const entrypoint of ["index.html", "planner/index.html", "planner-ledger/index.html", "runner/index.html", "research.html", "preview.html"]) {
  const path = resolve(outputRoot, entrypoint);
  const html = await readFile(path, "utf8");
  await writeFile(path, html.replace("</head>", `  <meta name="build-revision" content="${revision}">\n  </head>`));
}
await writeFile(resolve(outputRoot, "build-info.json"), `${JSON.stringify({ schema: "affect-tracker-pages-build-v1", revision })}\n`);
