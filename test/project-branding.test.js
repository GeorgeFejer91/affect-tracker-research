import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (relativePath) => new URL(`../${relativePath}`, import.meta.url);

async function readText(relativePath) {
  return readFile(projectFile(relativePath), "utf8");
}

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "asset must be a PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test("Aurora Axis is the canonical desktop and Pages logo", async () => {
  const [selected, desktop, pages] = await Promise.all([
    readFile(projectFile("desktop/icons/concepts/axis-bloom-variants/axis-05-aurora-axis.svg")),
    readFile(projectFile("desktop/icons/app-icon.svg")),
    readFile(projectFile("site/assets/app-logo.svg")),
  ]);

  assert.deepEqual(desktop, selected);
  assert.deepEqual(pages, selected);
});

test("browser and Tauri icon assets have the required sizes and containers", async () => {
  const expectedPngs = new Map([
    ["site/assets/app-icons/32x32.png", 32],
    ["site/assets/app-icons/180x180.png", 180],
    ["site/assets/app-icons/192x192.png", 192],
    ["site/assets/app-icons/512x512.png", 512],
    ["src-tauri/icons/32x32.png", 32],
    ["src-tauri/icons/128x128.png", 128],
    ["src-tauri/icons/128x128@2x.png", 256],
  ]);

  for (const [relativePath, size] of expectedPngs) {
    const dimensions = pngDimensions(await readFile(projectFile(relativePath)));
    assert.deepEqual(dimensions, { width: size, height: size }, relativePath);
  }

  const ico = await readFile(projectFile("src-tauri/icons/icon.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 1);

  const icns = await readFile(projectFile("src-tauri/icons/icon.icns"));
  assert.equal(icns.subarray(0, 4).toString("ascii"), "icns");
});

test("GitHub Pages entry points use Aurora Axis without adding an installable PWA surface", async () => {
  const publicPages = ["site/index.html", "site/study.html", "site/study-remote.html", "site/webxr.html"];
  for (const relativePath of publicPages) {
    const html = await readText(relativePath);
    assert.match(html, /rel="icon" type="image\/svg\+xml" href="\.\/assets\/app-logo\.svg"/);
    assert.match(html, /rel="icon" type="image\/png" sizes="32x32" href="\.\/assets\/app-icons\/32x32\.png"/);
    assert.match(html, /name="theme-color"/);
    assert.doesNotMatch(html, /rel="manifest"|serviceWorker\.register/);
  }

  const mainPage = await readText("site/index.html");
  assert.match(mainPage, /class="app-brand-logo" src="\.\/assets\/app-logo\.svg" alt=""/);
  assert.match(mainPage, /rel="canonical" href="https:\/\/georgefejer91\.github\.io\/affect-tracker-research\/"/);
  assert.match(mainPage, /property="og:image" content="https:\/\/georgefejer91\.github\.io\/affect-tracker-research\/assets\/app-icons\/512x512\.png"/);
  assert.match(mainPage, /name="twitter:card" content="summary"/);
});

test("desktop WebViews and GitHub explainer use the project logo", async () => {
  const [settings, study, overlay, styles, readme] = await Promise.all([
    readText("desktop/index.html"),
    readText("desktop/study.html"),
    readText("desktop/overlay.html"),
    readText("desktop/styles.css"),
    readText("README.md"),
  ]);

  for (const html of [settings, study, overlay]) {
    assert.match(html, /rel="icon" type="image\/svg\+xml" href="\.\/icons\/app-icon\.svg"/);
  }
  assert.match(settings, /class="app-brand-logo" src="\.\/icons\/app-icon\.svg" alt=""/);
  assert.match(styles, /\.app-brand-logo\s*\{/);
  assert.doesNotMatch(overlay, /<img[^>]+app-brand-logo/);
  assert.match(readme, /src="\.\/site\/assets\/app-logo\.svg"/);
  assert.match(readme, /Aurora Axis/);
});
