import { copyFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { APP_LOGO_CONCEPTS } from "./build-app-logo-concepts.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "..");
const conceptDirectory = path.join(repositoryRoot, "desktop", "icons", "concepts");
const sourceIcon = path.join(repositoryRoot, "desktop", "icons", "app-icon.svg");
const generatedIconDirectory = path.join(repositoryRoot, "src-tauri", "icons");

function printChoices() {
  process.stdout.write("Available Affect Research app-logo concepts:\n");
  for (const concept of APP_LOGO_CONCEPTS) {
    process.stdout.write(`  ${concept.id.padEnd(18)} ${concept.name} — ${concept.summary}\n`);
  }
}

const [selectedId] = process.argv.slice(2).filter((argument) => argument !== "--");
const selected = APP_LOGO_CONCEPTS.find((concept) => concept.id === selectedId);

if (!selected) {
  printChoices();
  if (selectedId && selectedId !== "--list") {
    process.stderr.write(`\nUnknown app-logo concept: ${selectedId}\n`);
    process.exitCode = 1;
  }
} else {
  const selectedSvg = path.join(conceptDirectory, `${selected.id}.svg`);
  await copyFile(selectedSvg, sourceIcon);

  const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(
    packageManager,
    ["exec", "tauri", "icon", sourceIcon, "-o", generatedIconDirectory],
    { cwd: repositoryRoot, stdio: "inherit" },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else process.stdout.write(`Selected ${selected.id} (${selected.name}) and regenerated the Tauri icon pack.\n`);
}
