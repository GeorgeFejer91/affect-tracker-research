import { build } from "esbuild";
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { surveyNotices, surveyNoticeBanner } from "./surveyjs-notices.js";
const directory = "site/src/research/vendor";
await mkdir(directory, { recursive: true });
const common = { bundle: true, write: false, format: "esm", minify: true, platform: "browser", legalComments: "inline", banner: { js: surveyNoticeBanner } };
const core = await build({ ...common, stdin: { contents: 'export * from "survey-core"; import "survey-core/i18n"; export {lintSurvey} from "survey-core/linter";', resolveDir: process.cwd() } });
const ui = await build({ ...common, stdin: { contents: 'export * from "survey-js-ui"; export * as SurveyThemes from "survey-core/themes"; export {default as createDOMPurify} from "dompurify";', resolveDir: process.cwd() },
  plugins: [{ name: "one-survey-core", setup(b) { b.onResolve({ filter: /^survey-core$/ }, () => ({ path: "./surveyjs-core.js", external: true })); } }] });
const manifest = { surveyJs: "3.0.4", domPurify: "3.4.15", files: {} };
manifest.files["THIRD-PARTY-NOTICES.txt"] = createHash("sha256").update(surveyNotices).digest("hex");
if (process.argv.includes("--check")) {
  if (await readFile(`${directory}/THIRD-PARTY-NOTICES.txt`, "utf8") !== surveyNotices) throw new Error("SurveyJS notices are stale.");
} else await writeFile(`${directory}/THIRD-PARTY-NOTICES.txt`, surveyNotices);
for (const [name, result] of [["surveyjs-core.js", core], ["surveyjs-ui.js", ui]]) {
  const bytes = result.outputFiles[0].text;
  if (process.argv.includes("--check")) {
    if (await readFile(`${directory}/${name}`, "utf8") !== bytes) throw new Error(`${name} is stale.`);
  } else await writeFile(`${directory}/${name}`, bytes);
  manifest.files[name] = createHash("sha256").update(bytes).digest("hex");
}
const css = await readFile("node_modules/survey-core/survey-core.min.css");
manifest.files["surveyjs.css"] = createHash("sha256").update(css).digest("hex");
if (process.argv.includes("--check")) {
  if (!(await readFile(`${directory}/surveyjs.css`)).equals(css)) throw new Error("SurveyJS CSS is stale.");
  if (await readFile(`${directory}/manifest.json`, "utf8") !== `${JSON.stringify(manifest, null, 2)}\n`) throw new Error("SurveyJS vendor manifest is stale.");
} else {
  await copyFile("node_modules/survey-core/survey-core.min.css", `${directory}/surveyjs.css`);
  await writeFile(`${directory}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
}
console.log("Bundled full SurveyJS core, built-in UI, translations, styles and HTML sanitizer.");
