// Background-only actual-controller confirmation and async media-rebind checks.
// node scripts/qualification/setup-contribution-cycle.mjs <browser.exe> <output-dir>
import { execFile } from "node:child_process";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { build } from "esbuild";
const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination);
const output = resolve(destination); await mkdir(output, { recursive: true });
const run = promisify(execFile), profile = await mkdtemp(join(output, "isolated-profile-"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = async args => (await run("git", args, { windowsHide: true })).stdout.trim();
const commit = await git(["rev-parse", "HEAD"]);
const bundle = await build({ entryPoints: ["test/fixtures/setup-contribution-cycle-browser.js"], bundle: true,
  write: false, format: "iife", target: "chrome105", logLevel: "silent", metafile: true,
  define: { "import.meta.url": JSON.stringify(pathToFileURL(resolve("site/src/research/ui-view.js")).href) } });
const inputSha256 = {};
for (const path of [...Object.keys(bundle.metafile.inputs), "site/research.css"]) inputSha256[path] = hash(await readFile(path));
const fixture = join(output, "cycle.html"), screenshot = join(output, "review.png");
await writeFile(fixture, `<!doctype html><meta charset="utf-8"><title>Segment contribution cycle</title>
<style>${await readFile("site/research.css", "utf8")}</style><main></main><pre id="receipt" hidden>pending</pre><script>${bundle.outputFiles[0].text.replace(/<\/script/giu, "<\\/script")}</script>`);
const { stdout, stderr } = await run(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--force-prefers-reduced-motion",
  `--user-data-dir=${profile}`, "--window-size=1280,1000", `--screenshot=${screenshot}`, "--virtual-time-budget=15000", "--dump-dom", pathToFileURL(fixture).href],
  { windowsHide: true, timeout: 45000, maxBuffer: 4_000_000 });
await writeFile(join(output, "browser.log"), stderr);
const raw = stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1];
assert.ok(raw && raw !== "pending", "No completed contribution-cycle receipt.");
const receipt = JSON.parse(raw.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<"));
assert.equal(await git(["rev-parse", "HEAD"]), commit);
for (const [path, digest] of Object.entries(inputSha256)) assert.equal(hash(await readFile(path)), digest, path);
Object.assign(receipt, { commit, inputSha256, screenshotSha256: hash(await readFile(screenshot)), workingTreeStatus: await git(["status", "--short"]) });
await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
assert.equal(receipt.passed, true, JSON.stringify(receipt));
console.log(JSON.stringify({ passed: true, checks: receipt.checks.length, output }));
