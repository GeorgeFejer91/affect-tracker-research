// Background actual-app P2 successor proof, never a user browser or native writer.
// node scripts/qualification/questionnaire-recipe.mjs <chrome.exe> <output> [width]
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { build } from "esbuild";

const execute = promisify(execFile);
const [browser, destination, width = "1280", entryPoint = "test/fixtures/questionnaire-recipe-browser.js"] = process.argv.slice(2);
assert.ok(browser && destination && /^\d{3,4}$/u.test(width), "Supply browser, isolated output and optional width.");
const output = resolve(destination); await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, "isolated-profile-"));
const hash = value => createHash("sha256").update(value).digest("hex");
const git = async (...args) => (await execute("git", args, { windowsHide: true })).stdout.trim();
const commit = await git("rev-parse", "HEAD"), status = await git("status", "--porcelain");
const bundle = await build({ entryPoints: [entryPoint], bundle: true,
  write: false, metafile: true, format: "iife", target: "chrome105", logLevel: "silent", loader: { ".csv": "text" },
  define: { "import.meta.url": JSON.stringify(pathToFileURL(resolve("site/src/research/ui-view.js")).href) } });
const inputs = [...new Set([...Object.keys(bundle.metafile.inputs), "site/research.css", "scripts/qualification/questionnaire-recipe.mjs"])].sort();
const sourceHashes = Object.fromEntries(await Promise.all(inputs.map(async path => [path, hash(await readFile(path))])));
const css = await readFile("site/research.css", "utf8");
const html = `<!doctype html><meta charset="utf-8"><title>P2 successor verification</title><style>${css}</style><main></main><pre id="receipt" hidden>pending</pre><script>${bundle.outputFiles[0].text.replace(/<\/script/giu, "<\\/script")}</script>`;
const fixture = join(output, "questionnaire-recipe.html"); await writeFile(fixture, html);
const { stdout, stderr } = await execute(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--force-prefers-reduced-motion", `--user-data-dir=${profile}`, `--window-size=${width},1000`,
  `--screenshot=${join(output, "questionnaire-recipe.png")}`, "--virtual-time-budget=15000", "--dump-dom", pathToFileURL(fixture).href],
  { windowsHide: true, timeout: 45000, maxBuffer: 4_000_000 });
await writeFile(join(output, "dom.html"), stdout); await writeFile(join(output, "browser.log"), stderr);
const raw = stdout.match(/<pre id="receipt"[^>]*>([^<]+)<\/pre>/u)?.[1];
assert.ok(raw && raw !== "pending", "Questionnaire recipe fixture did not finish.");
const result = JSON.parse(raw.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<"));
const stable = commit === await git("rev-parse", "HEAD") && status === await git("status", "--porcelain")
  && (await Promise.all(inputs.map(async path => hash(await readFile(path)) === sourceHashes[path]))).every(Boolean);
const receipt = { ...result, commit, dirty: Boolean(status), sourceHashes, sourceStable: stable, browser, width: Number(width),
  fixtureSha256: hash(html), imageSha256: hash(await readFile(join(output, "questionnaire-recipe.png"))) };
await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
assert.ok(stable && result.passed, JSON.stringify(receipt));
console.log(JSON.stringify({ passed: true, cases: result.cases.length, commit, dirty: Boolean(status), output }));
