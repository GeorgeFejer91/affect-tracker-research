// Isolated headless Pages rendering; no existing browser or desktop input.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat, readdir } from "node:fs/promises";
import { resolve, relative, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { aboutFiles } from "../render-cli-reference.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const [browser, outputArgument, playwrightModule] = process.argv.slice(2);
if (!browser || !outputArgument || !playwrightModule) throw new Error("Usage: node scripts/qualification/cli-reference.mjs <browser.exe> <new-output-directory> <playwright-module>");
const output = resolve(outputArgument);
await mkdir(output, { recursive: true });
assert.equal((await readdir(output)).length, 0, "Preserve earlier evidence; choose a new directory.");
const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const inputPaths = ["scripts/qualification/cli-reference.mjs", "scripts/render-cli-reference.mjs", "docs/cli/planner-authoring-catalogue.json", "docs/cli/planner-authoring-catalogue-evidence.json", ...aboutFiles.map(path => `dist-pages/${path}`)];
const hashes = async () => Promise.all(inputPaths.map(async path => ({ path, sha256: sha256(await readFile(resolve(root, path))) })));
const inputs = await hashes();
const reference = JSON.parse(await readFile(resolve(root, "docs/cli/planner-authoring-catalogue.json"), "utf8"));
const descriptorCount = reference.catalogue.settings.length + reference.catalogue.operations.length;
const prefix = "/affect-tracker-research/";
const dist = resolve(root, "dist-pages");
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (!url.pathname.startsWith(prefix)) throw new Error("Outside project URL");
    const name = decodeURIComponent(url.pathname.slice(prefix.length));
    let path = resolve(dist, name);
    if (relative(dist, path).startsWith("..")) throw new Error("Outside site");
    if ((await stat(path)).isDirectory()) path = join(path, "index.html");
    response.writeHead(200, { "Content-Type": ({ ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".js": "text/javascript", ".png": "image/png" })[extname(path)] || "text/plain" });
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end("Not found"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir(join(output, "temp"));
let context;
try {
  context = await chromium.launchPersistentContext(join(output, "profile"), {
    executablePath: browser, headless: true,
    env: { ...process.env, TEMP: join(output, "temp"), TMP: join(output, "temp") },
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const rows = [];
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("requestfailed", request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`${origin}${prefix}about/`, { waitUntil: "networkidle" });
    assert.equal(await page.title(), "About & CLI library · Affect Tracker");
    assert.equal(await page.locator("[data-descriptor]").count(), descriptorCount);
    const links = await page.locator("a[href], link[href], img[src]").evaluateAll(elements => elements.map(element => element.href || element.src));
    for (const url of links.filter(url => url.startsWith(origin))) {
      assert.ok(new URL(url).pathname.startsWith(prefix));
      assert.equal((await fetch(url)).status, 200, url);
    }
    for (const scene of ["overview", "catalogue", "file-commands"]) {
      if (scene === "catalogue") {
        await page.evaluate(() => {
          document.querySelector("#owner-p7").open = true;
          document.querySelector('#owner-p7 [data-descriptor="P7.participantCount"]').open = true;
          document.querySelector("#owner-p7").scrollIntoView();
        });
      } else if (scene === "file-commands") {
        await page.locator("#external").evaluate(element => element.scrollIntoView());
      }
      const geometry = await page.evaluate(() => ({
        width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        expanded: [...document.querySelectorAll("details[open]")].length,
        scrollX,
      }));
      assert.ok(geometry.scrollWidth <= width, `${scene} overflows at ${width}`);
      assert.equal(geometry.scrollX, 0);
      const filename = `${width}-${scene}.png`;
      await page.screenshot({ path: join(output, filename) });
      rows.push({ width, scene, ...geometry, filename, sha256: sha256(await readFile(join(output, filename))) });
    }
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("h1").textContent(), "About & CLI library");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Skip to content");
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(await hashes(), inputs, "Reference inputs changed during rendering.");
  await writeFile(join(output, "receipt.json"), `${JSON.stringify({
    schema: "affect-research-cli-reference-render-receipt", version: 1,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    sourceStatus: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }),
    browser, browserSha256: sha256(await readFile(browser)), browserVersion: context.browser()?.version(),
    checkedAt: new Date().toISOString(), inputs, rows, errors, passed: true,
    scope: "Static Pages reference, project-prefix links, reload, keyboard focus and headless layout. No native commands or user browser interaction.",
  }, null, 2)}\n`);
  console.log(`${rows.length} reference scenes passed; receipt saved in ${output}`);
} finally {
  await context?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
