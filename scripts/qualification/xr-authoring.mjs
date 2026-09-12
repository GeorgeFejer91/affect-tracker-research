// Actual bootstrap with synthetic typed producer events; no native or XR runtime.
import { execFile } from "node:child_process";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const [browser, destination, width = "1440"] = process.argv.slice(2);
assert.ok(browser && destination && /^\d{3,4}$/u.test(width));
const output = resolve(destination); await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(output, "isolated-profile-"));
const run = promisify(execFile);
const before = (await run("git", ["rev-parse", "HEAD"], { windowsHide: true })).stdout.trim();
const bundle = await build({ entryPoints: ["test/fixtures/xr-authoring-browser.js"], bundle: true,
  write: false, format: "iife", target: "chrome105", logLevel: "silent", metafile: true,
  define: { "import.meta.url": JSON.stringify(pathToFileURL(resolve("site/src/research/ui-view.js")).href) } });
const hashes = {};
for (const path of [...Object.keys(bundle.metafile.inputs), "site/research.css",
  "site/assets/flubber-input-dark.svg", "site/assets/flubber-input-light.svg"]) {
  hashes[path] = createHash("sha256").update(await readFile(path)).digest("hex");
}
const css = await readFile("site/research.css", "utf8"), fixture = join(output, "xr-authoring.html");
await writeFile(fixture, `<!doctype html><meta charset="utf-8"><title>P6 live authoring regression</title>
<base href="${pathToFileURL(resolve("site")).href}/">
<style>${css}</style><main></main><pre id="receipt">pending</pre><script>${bundle.outputFiles[0].text.replace(/<\/script/giu, "<\\/script")}</script>`);
const { stdout, stderr } = await run(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--force-prefers-reduced-motion",
  `--user-data-dir=${profile}`, `--window-size=${width},1100`, `--screenshot=${join(output, "xr-authoring.png")}`,
  "--virtual-time-budget=15000", "--dump-dom", pathToFileURL(fixture).href], { windowsHide: true, timeout: 45000, maxBuffer: 4_000_000 });
await writeFile(join(output, "dom.html"), stdout); await writeFile(join(output, "browser.log"), stderr);
const raw = stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1];
assert.ok(raw && raw !== "pending", "Browser produced no completed P6 receipt.");
const receipt = JSON.parse(raw.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<"));
const after = (await run("git", ["rev-parse", "HEAD"], { windowsHide: true })).stdout.trim();
assert.equal(before, after, "Source commit changed during verification.");
for (const [path, hash] of Object.entries(hashes)) assert.equal(createHash("sha256").update(await readFile(path)).digest("hex"), hash, path);
Object.assign(receipt, { commit: before, width, inputSha256: hashes,
  harnessSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex"),
  imageSha256: createHash("sha256").update(await readFile(join(output, "xr-authoring.png"))).digest("hex"),
  workingTreeStatus: (await run("git", ["status", "--short"], { windowsHide: true })).stdout });
await writeFile(join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
assert.equal(receipt.passed, true, JSON.stringify({ error: receipt.error, checks: receipt.checks, errors: receipt.errors }));
console.log(JSON.stringify({ passed: true, checks: receipt.checks.length, output }));
