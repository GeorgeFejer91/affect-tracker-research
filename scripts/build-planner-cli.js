// Build one embedded-asset native Planner CLI; never start a dev server or GUI.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => !["--release", "--no-default-features", "--native-gstreamer"].includes(flag))) {
  throw new Error("Usage: node scripts/build-planner-cli.js [--release] [--no-default-features] [--native-gstreamer]");
}
const features = flags.delete("--native-gstreamer")
  ? "tauri/custom-protocol,native-gstreamer" : "tauri/custom-protocol";
function run(command, args) {
  const child = spawnSync(command, args, { cwd: root, stdio: "inherit", windowsHide: true, shell: false });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
run(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "build", "--config", "desktop/vite.config.js"]);
run(process.execPath, [resolve(root, "scripts/verify-research-build.js"), "desktop"]);
const cargo = process.env.CARGO ?? (process.platform === "win32" && process.env.USERPROFILE
  ? resolve(process.env.USERPROFILE, ".cargo/bin/cargo.exe") : "cargo");
run(cargo, ["build", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--bin", "affect-planner-cli",
  "--features", features, "-j", "2", ...flags]);
