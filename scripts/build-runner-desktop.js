// Builds the independent executable with its own embedded frontend and native
// resources. --run is an explicit developer launch; a build alone never opens UI.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const userCargo = resolve(process.env.CARGO_HOME ?? resolve(homedir(), ".cargo"), "bin", process.platform === "win32" ? "cargo.exe" : "cargo");
const cargo = process.env.CARGO ?? (existsSync(userCargo) ? userCargo : "cargo");
const options = new Set(process.argv.slice(2));
if ([...options].some(option => !["--run", "--release", "--native-gstreamer"].includes(option))) throw new Error("Use --run, --release and/or --native-gstreamer only.");
const env = { ...process.env, TAURI_CONFIG: readFileSync(resolve(root, "src-tauri/tauri.runner.conf.json"), "utf8") };
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, [resolve(require.resolve("vite/package.json"), "../bin/vite.js"), "build", "--config", "runner/vite.config.js"]);
run(process.execPath, ["scripts/verify-runner-build.js"]);
run(cargo, [options.has("--run") ? "run" : "build", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--bin", "affect-runner", "--features", options.has("--native-gstreamer") ? "tauri/custom-protocol,native-gstreamer" : "tauri/custom-protocol", ...(options.has("--release") ? ["--release"] : [])]);
