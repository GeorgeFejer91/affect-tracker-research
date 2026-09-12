// Isolated actual-app P7 issue presentation/actions at desktop and narrow widths.
// node scripts/qualification/planner-review-issues.mjs <browser.exe> <output-dir>
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
const run = promisify(execFile), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = async args => (await run("git", args, { windowsHide: true })).stdout.trim();
const commit = await git(["rev-parse", "HEAD"]);
assert.equal(await git(["status", "--porcelain", "--", "site", "test/fixtures/planner-review-issues-browser.js"]), "", "Capture a clean source checkpoint.");
const bundle = await build({ entryPoints: ["test/fixtures/planner-review-issues-browser.js"], bundle: true,
  write: false, format: "iife", target: "chrome105", logLevel: "silent", metafile: true,
  define: { "import.meta.url": JSON.stringify(pathToFileURL(resolve("site/src/research/ui-view.js")).href) } });
const inputSha256 = {};
for (const path of [...Object.keys(bundle.metafile.inputs), "site/research.css"]) inputSha256[path] = hash(await readFile(path));
const fixture = join(output, "review.html");
await writeFile(fixture, `<!doctype html><meta charset="utf-8"><title>Review issue presentation</title>
<style>${await readFile("site/research.css", "utf8")}</style><main></main><pre id="receipt" hidden>pending</pre><script>${bundle.outputFiles[0].text.replace(/<\/script/giu, "<\\/script")}</script>`);
const rows = [];
try {
  for (const width of [1280, 800]) {
    for (const expanded of [false, true]) {
      const name = `${width}-${expanded ? "details" : "compact"}`;
      const profile = await mkdtemp(join(output, "isolated-profile-")), screenshot = join(output, `${name}.png`);
      const { stdout, stderr } = await run(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--force-prefers-reduced-motion",
        `--user-data-dir=${profile}`, `--window-size=${width},${width === 800 ? 800 : 1000}`, "--force-device-scale-factor=1",
        `--screenshot=${screenshot}`, "--virtual-time-budget=20000", "--dump-dom", `${pathToFileURL(fixture).href}?expanded=${expanded}`],
      { windowsHide: true, timeout: 45000, maxBuffer: 4_000_000 });
      await writeFile(join(output, `${name}.log`), stderr);
      await writeFile(join(output, `${name}.html`), stdout);
      const raw = stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1];
      assert.ok(raw && raw !== "pending", `No completed receipt: ${name}`);
      const receipt = JSON.parse(raw.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<"));
      rows.push({ ...receipt, name, screenshot, screenshotSha256: hash(await readFile(screenshot)) });
      assert.equal(receipt.passed, true, JSON.stringify(receipt));
      console.log(JSON.stringify({ name, checks: receipt.checks.length, compactHeight: receipt.compactHeight }));
    }
  }
} finally {
  const stableSource = await git(["rev-parse", "HEAD"]) === commit
    && await git(["status", "--porcelain", "--", "site", "test/fixtures/planner-review-issues-browser.js"]) === "";
  for (const [path, digest] of Object.entries(inputSha256)) assert.equal(hash(await readFile(path)), digest, path);
  await writeFile(join(output, "receipt.json"), JSON.stringify({ commit, stableSource, inputSha256, harnessSha256: hash(await readFile(new URL(import.meta.url))), rows }, null, 2));
  assert.ok(stableSource, "Source changed during capture.");
}
