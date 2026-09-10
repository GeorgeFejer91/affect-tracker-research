import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { APP_LOGO_CONCEPTS } from "./build-app-logo-concepts.mjs";
import { AXIS_BLOOM_VARIANTS } from "./build-axis-bloom-variants.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const conceptDirectory = path.join(repositoryRoot, "desktop", "icons", "concepts");
const sourceIcon = path.join(repositoryRoot, "desktop", "icons", "app-icon.svg");
const generatedIconDirectory = path.join(repositoryRoot, "src-tauri", "icons");
const siteAssetDirectory = path.join(repositoryRoot, "site", "assets");
const siteSourceIcon = path.join(siteAssetDirectory, "app-logo.svg");
const siteIconDirectory = path.join(siteAssetDirectory, "app-icons");
const tauriCli = path.join(repositoryRoot, "node_modules", "@tauri-apps", "cli", "tauri.js");
const desktopIconFiles = Object.freeze([
  "32x32.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.icns",
  "icon.ico",
]);
const siteIconSizes = Object.freeze(["32", "180", "192", "512"]);

const SELECTABLE_LOGOS = Object.freeze([
  ...APP_LOGO_CONCEPTS.map((concept) => Object.freeze({
    ...concept,
    source: path.join(conceptDirectory, `${concept.id}.svg`),
    family: "Original concepts",
  })),
  ...AXIS_BLOOM_VARIANTS.map((concept) => Object.freeze({
    ...concept,
    source: path.join(conceptDirectory, "axis-bloom-variants", `${concept.id}.svg`),
    family: "Axis Bloom variants",
  })),
]);

function printChoices() {
  process.stdout.write("Available Affect Research app-logo concepts:\n");
  let family = "";
  for (const concept of SELECTABLE_LOGOS) {
    if (concept.family !== family) {
      family = concept.family;
      process.stdout.write(`\n${family}:\n`);
    }
    process.stdout.write(`  ${concept.id.padEnd(24)} ${concept.name} — ${concept.summary}\n`);
  }
}

const [selectedId] = process.argv.slice(2).filter((argument) => argument !== "--");
const selected = SELECTABLE_LOGOS.find((concept) => concept.id === selectedId);

if (!selected) {
  printChoices();
  if (selectedId && selectedId !== "--list") {
    process.stderr.write(`\nUnknown app-logo concept: ${selectedId}\n`);
    process.exitCode = 1;
  }
} else {
  const stagingRoot = await mkdtemp(path.join(tmpdir(), "affect-research-logo-"));
  const stagedDesktopIcons = path.join(stagingRoot, "desktop-icons");
  const stagedSiteIcons = path.join(stagingRoot, "site-icons");

  try {
    const desktopResult = spawnSync(
      process.execPath,
      [tauriCli, "icon", selected.source, "-o", stagedDesktopIcons],
      { cwd: repositoryRoot, stdio: "inherit" },
    );

    if (desktopResult.error) throw desktopResult.error;
    if (desktopResult.status !== 0) {
      throw new Error(`Tauri icon generation failed with exit code ${desktopResult.status ?? 1}.`);
    }

    const siteResult = spawnSync(
      process.execPath,
      [
        tauriCli,
        "icon",
        selected.source,
        "-o",
        stagedSiteIcons,
        ...siteIconSizes.flatMap((size) => ["-p", size]),
      ],
      { cwd: repositoryRoot, stdio: "inherit" },
    );

    if (siteResult.error) throw siteResult.error;
    if (siteResult.status !== 0) {
      throw new Error(`Pages icon generation failed with exit code ${siteResult.status ?? 1}.`);
    }

    await Promise.all([
      mkdir(generatedIconDirectory, { recursive: true }),
      mkdir(siteIconDirectory, { recursive: true }),
    ]);
    await Promise.all([
      copyFile(selected.source, sourceIcon),
      copyFile(selected.source, siteSourceIcon),
      ...desktopIconFiles.map((filename) => (
        copyFile(path.join(stagedDesktopIcons, filename), path.join(generatedIconDirectory, filename))
      )),
      ...siteIconSizes.map((size) => (
        copyFile(path.join(stagedSiteIcons, `${size}x${size}.png`), path.join(siteIconDirectory, `${size}x${size}.png`))
      )),
    ]);
    process.stdout.write(`Selected ${selected.id} (${selected.name}) for Tauri and GitHub Pages branding.\n`);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}
