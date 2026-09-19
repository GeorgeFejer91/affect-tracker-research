import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("Aurora Axis is the canonical Research desktop and Pages logo", async () => {
  // The selection is finished: app-icon.svg is the chosen logo, and the Pages
  // asset must stay byte-identical to it. The concept exploration it came from
  // is in Git history.
  const [desktop, pages] = await Promise.all([
    readFile(projectFile("experiment-planner/desktop/icons/app-icon.svg")),
    readFile(projectFile("experiment-planner/web/assets/app-logo.svg")),
  ]);

  assert.deepEqual(pages, desktop);
  assert.match(desktop.toString("utf8"), /data-concept="axis-05-aurora-axis"/u);
});

test("Research browser and Tauri icon assets use the required sizes and containers", async () => {
  const expectedPngs = new Map([
    ["experiment-planner/web/assets/app-icons/32x32.png", 32],
    ["experiment-planner/web/assets/app-icons/180x180.png", 180],
    ["experiment-planner/web/assets/app-icons/192x192.png", 192],
    ["experiment-planner/web/assets/app-icons/512x512.png", 512],
    ["native/icons/32x32.png", 32],
    ["native/icons/128x128.png", 128],
    ["native/icons/128x128@2x.png", 256],
  ]);

  for (const [relativePath, size] of expectedPngs) {
    const dimensions = pngDimensions(await readFile(projectFile(relativePath)));
    assert.deepEqual(dimensions, { width: size, height: size }, relativePath);
  }

  const ico = await readFile(projectFile("native/icons/icon.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 1);

  const icns = await readFile(projectFile("native/icons/icon.icns"));
  assert.equal(icns.subarray(0, 4).toString("ascii"), "icns");
});

test("checked-in Research icon binaries match the pinned Aurora Axis renders", async () => {
  const expectedHashes = new Map([
    ["native/icons/32x32.png", "b317cc6b12e472e8d26e8c440a076c6d58f191d4c42a6f38590a1ed55d8bc3e8"],
    ["native/icons/128x128.png", "61cf07e483a6f489af1505bfedca013c48432fc08b77ff997bd44499aff1213d"],
    ["native/icons/128x128@2x.png", "f0d2db2bf39f08ccd95b1882cc7a17b0e38fa7792df849d6ebd9f04c85b15c38"],
    ["native/icons/icon.ico", "332b6a46c25b495853b1578c8519d62ba293aa4fa598ed8ce0ba22892750a7f5"],
    ["experiment-planner/web/assets/app-icons/32x32.png", "b317cc6b12e472e8d26e8c440a076c6d58f191d4c42a6f38590a1ed55d8bc3e8"],
    ["experiment-planner/web/assets/app-icons/180x180.png", "cc0ac5a951c7c62a3285ec3f19f4456996916d586ec375872614dc21998845b6"],
    ["experiment-planner/web/assets/app-icons/192x192.png", "34c71acdfabb753eb85e4c80cb8eaa636514c94c141e609d24e974ca97a5b00e"],
    ["experiment-planner/web/assets/app-icons/512x512.png", "3ba778497f90044fb5864d3ac0c1995f4ac013da1084f081d2912b5e86a4b2eb"],
  ]);

  for (const [relativePath, expectedHash] of expectedHashes) {
    const contents = await readFile(projectFile(relativePath));
    const actualHash = createHash("sha256").update(contents).digest("hex");
    assert.equal(actualHash, expectedHash, relativePath);
  }
});

test("Research Pages, desktop, app header, and GitHub explainer expose Aurora Axis", async () => {
  const [pages, desktop, ui, styles, readme, pagesBuilder, buildVerifier] = await Promise.all([
    readText("experiment-planner/web/index.html"),
    readText("experiment-planner/desktop/index.html"),
    readText("experiment-planner/web/src/research/ui-view.js"),
    readText("experiment-planner/web/research.css"),
    readText("README.md"),
    readText("scripts/build-research-pages.js"),
    readText("scripts/verify-research-build.js"),
  ]);

  assert.match(pages, /rel="icon" type="image\/svg\+xml" href="\.\/assets\/app-logo\.svg"/u);
  assert.match(pages, /rel="apple-touch-icon" sizes="180x180"/u);
  assert.match(pages, /property="og:image" content="https:\/\/georgefejer91\.github\.io\/affect-tracker-research\/assets\/app-icons\/512x512\.png"/u);
  assert.doesNotMatch(pages, /rel="manifest"|serviceWorker\.register/u);
  assert.match(desktop, /rel="icon" type="image\/svg\+xml" href="\.\.\/web\/assets\/app-logo\.svg"/u);
  assert.match(ui, /class="product-mark" aria-hidden="true"/u);
  assert.match(styles, /\.product-mark\s*\{[^}]*app-symbol\.svg/u);
  assert.match(styles, /\.research-loading::before\s*\{[^}]*app-symbol\.svg/u);
  assert.match(readme, /src="\.\/experiment-planner\/web\/assets\/app-logo\.svg"/u);
  assert.match(readme, /Aurora Axis/u);
  assert.match(pagesBuilder, /"assets", "app-logo\.svg"/u);
  assert.match(pagesBuilder, /"assets", "app-symbol\.svg"/u);
  assert.match(buildVerifier, /assets\/app-logo\.svg/u);
});
