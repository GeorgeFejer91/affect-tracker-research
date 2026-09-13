import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { surveyNoticeBanner } from "./surveyjs-notices.js";
const result = await build({ entryPoints: ["scripts/surveyjs-native-entry.js"], bundle: true, write: false, format: "iife", minify: true,
  platform: "neutral", mainFields: ["module", "main"], legalComments: "inline", banner: { js: surveyNoticeBanner } });
const source = result.outputFiles[0].text;
const directory = "src-tauri/surveyjs";
if (process.argv.includes("--check")) {
  if (await readFile(`${directory}/engine.js`, "utf8") !== source || (await readFile(`${directory}/engine.sha256`, "utf8")).trim() !== createHash("sha256").update(source).digest("hex")) throw new Error("Bundled native SurveyJS engine is stale. Run pnpm surveyjs:build.");
} else {
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/engine.js`, source);
  await writeFile(`${directory}/engine.sha256`, `${createHash("sha256").update(source).digest("hex")}\n`);
}
console.log(`SurveyJS 3.0.4 native bundle: ${Buffer.byteLength(source)} bytes.`);
