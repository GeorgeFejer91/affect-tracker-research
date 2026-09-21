import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const source = resolve("experiment-planner/web/assets/affect-planner-ledger-icon.svg");
const webOutput = resolve("experiment-planner/web/assets/app-icons/planner-ledger");
const nativeOutput = resolve("native/icons-ledger");
const temporaryParent = resolve("native/target");
const sizes = [32, 64, 128, 180, 192, 512];

async function requireFile(path, label) {
  const details = await stat(path).catch(() => null);
  if (!details?.isFile() || details.size === 0) {
    throw new Error(`${label} is missing or empty: ${path}`);
  }
}

function generate(cli, output, customSizes = []) {
  const arguments_ = [cli, "icon", source, "-o", output];
  for (const size of customSizes) arguments_.push("-p", String(size));
  const result = spawnSync(process.execPath, arguments_, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Tauri icon generation failed with exit code ${result.status}.`);
}

await requireFile(source, "Planner Ledger SVG source");
await mkdir(temporaryParent, { recursive: true });
const temporary = await mkdtemp(join(temporaryParent, "planner-ledger-icons-"));
try {
  const cli = createRequire(import.meta.url).resolve("@tauri-apps/cli/tauri.js");
  generate(cli, temporary);
  generate(cli, temporary, sizes);
  for (const size of sizes) await requireFile(join(temporary, `${size}x${size}.png`), `${size}px Ledger icon`);
  await requireFile(join(temporary, "icon.ico"), "Windows Ledger icon");

  await mkdir(webOutput, { recursive: true });
  await mkdir(nativeOutput, { recursive: true });
  await Promise.all([
    ...sizes.map(size => copyFile(join(temporary, `${size}x${size}.png`), join(webOutput, `${size}x${size}.png`))),
    copyFile(join(temporary, "128x128.png"), join(nativeOutput, "128x128.png")),
    copyFile(join(temporary, "icon.ico"), join(nativeOutput, "icon.ico")),
  ]);
  console.log(`Generated scoped Planner Ledger icons from ${source}.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
