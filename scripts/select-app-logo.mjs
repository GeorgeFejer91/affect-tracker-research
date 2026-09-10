import { copyFile, mkdir } from "node:fs/promises";
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
  await mkdir(siteAssetDirectory, { recursive: true });
  await copyFile(selected.source, sourceIcon);
  await copyFile(selected.source, siteSourceIcon);

  const desktopResult = spawnSync(
    process.execPath,
    [tauriCli, "icon", sourceIcon, "-o", generatedIconDirectory],
    { cwd: repositoryRoot, stdio: "inherit" },
  );

  if (desktopResult.error) throw desktopResult.error;
  if (desktopResult.status !== 0) {
    process.exitCode = desktopResult.status ?? 1;
  } else {
    const siteResult = spawnSync(
      process.execPath,
      [
        tauriCli,
        "icon",
        siteSourceIcon,
        "-o",
        siteIconDirectory,
        "-p",
        "32",
        "-p",
        "180",
        "-p",
        "192",
        "-p",
        "512",
      ],
      { cwd: repositoryRoot, stdio: "inherit" },
    );

    if (siteResult.error) throw siteResult.error;
    if (siteResult.status !== 0) process.exitCode = siteResult.status ?? 1;
    else process.stdout.write(`Selected ${selected.id} (${selected.name}) for Tauri and GitHub Pages branding.\n`);
  }
}
