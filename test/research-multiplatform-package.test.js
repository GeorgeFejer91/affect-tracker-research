import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const WORKFLOW_PATH = ".github/workflows/desktop-release.yml";
const BUILD_HELPER_PATH = "scripts/build-unqualified-desktop-package.js";
const PROVENANCE_HELPER_PATH = "scripts/write-unqualified-package-provenance.js";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("multiplatform packaging is manual, read-only, and cannot publish a release", async () => {
  const workflow = await source(WORKFLOW_PATH);

  assert.match(workflow, /^on:\n  workflow_dispatch:\n/mu);
  assert.match(workflow, /^permissions:\n  contents: read$/mu);
  assert.doesNotMatch(workflow, /^\s*(?:push|pull_request|schedule):/mu);
  assert.doesNotMatch(workflow, /contents:\s*write|packages:\s*write|id-token:\s*write/iu);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\.|tauri-apps\/tauri-action|create-release|softprops\/action-gh-release/iu);

  const actionUses = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+).*$/gmu)].map((match) => match[1]);
  assert.ok(actionUses.length >= 5);
  for (const action of actionUses) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u);
  }
});

test("workflow uses host-native Windows, macOS ARM, macOS Intel, and Ubuntu 22.04 x64 jobs", async () => {
  const workflow = await source(WORKFLOW_PATH);

  for (const [target, runner, platform, architecture] of [
    ["windows-x64", "windows-latest", "windows", "x64"],
    ["runner-windows-x64", "windows-latest", "windows", "x64"],
    ["macos-arm64", "macos-15", "macos", "arm64"],
    ["macos-x64", "macos-15-intel", "macos", "x64"],
    ["linux-x64", "ubuntu-22.04", "linux", "x64"],
  ]) {
    assert.ok(workflow.includes(`'${target}' = @{ target = '${target}'; runner = '${runner}'; platform = '${platform}'; architecture = '${architecture}' }`));
  }
  assert.match(workflow, /matrix: \$\{\{ fromJSON\(needs\.select-targets\.outputs\.matrix\) \}\}/u);
  assert.match(workflow, /RUNNER_OS -cne 'Windows'/u);
  assert.match(workflow, /Darwin\/arm64/u);
  assert.match(workflow, /Darwin\/x86_64/u);
  assert.match(workflow, /Linux\/x86_64/u);
});

test("Linux build installs the pinned Tauri WebKit package boundary", async () => {
  const workflow = await source(WORKFLOW_PATH);
  for (const dependency of [
    "libwebkit2gtk-4.1-dev",
    "libayatana-appindicator3-dev",
    "librsvg2-dev",
    "patchelf",
  ]) {
    assert.match(workflow, new RegExp(`\\b${dependency.replaceAll(".", "\\.")}\\b`, "u"));
  }
  assert.match(workflow, /ubuntu-22\.04/u);
  assert.match(workflow, /bundle\/deb\/\*\.deb/u);
  assert.match(workflow, /bundle\/appimage\/\*\.AppImage/u);
  assert.match(workflow, /bundle\/nsis\/\*\.exe/u);
});

test("tests and no-default-feature Rust gates precede the unsigned package build", async () => {
  const workflow = await source(WORKFLOW_PATH);
  const packageIndex = workflow.indexOf("Build unsigned host-native package candidate");
  assert.ok(packageIndex > 0);
  for (const prerequisite of [
    "pnpm test",
    "pnpm desktop:build",
    "cargo check --locked --manifest-path src-tauri/Cargo.toml --no-default-features",
    "cargo test --locked --manifest-path src-tauri/Cargo.toml --no-default-features",
  ]) {
    const prerequisiteIndex = workflow.indexOf(prerequisite);
    assert.ok(prerequisiteIndex >= 0 && prerequisiteIndex < packageIndex, `${prerequisite} must precede packaging`);
  }
});

test("package helper rejects cross-host and signing boundaries", async () => {
  const helper = await source(BUILD_HELPER_PATH);

  assert.match(helper, /"windows-x64"[\s\S]*nodePlatform: "win32"[\s\S]*bundles: "nsis"/u);
  assert.match(helper, /process\.platform !== target\.nodePlatform \|\| process\.arch !== target\.nodeArch/u);
  assert.match(helper, /--no-sign/u);
  assert.match(helper, /--no-default-features/u);
  assert.match(helper, /AFFECT_TRACKER_BUILD_COMMIT: commit/u);
  assert.match(helper, /status", "--porcelain=v1", "--untracked-files=normal"/u);
  assert.match(helper, /TAURI_SIGNING_PRIVATE_KEY/u);
  assert.match(helper, /createRequire\(import\.meta\.url\)/u);
  assert.match(helper, /require\.resolve\("@tauri-apps\/cli\/tauri\.js"\)/u);
  assert.match(helper, /spawnSync\(\s*process\.execPath,\s*\[\s*tauriCli,/u);
  assert.doesNotMatch(helper, /pnpm\.cmd|shell:\s*true/iu);
  assert.doesNotMatch(helper, /native-gstreamer|lsl-streaming/u);
});

test("platform overrides exclude the Windows runtime and select only requested bundles", async () => {
  const windows = JSON.parse(await source("src-tauri/tauri.bundle-windows-unqualified.conf.json"));
  const macos = JSON.parse(await source("src-tauri/tauri.bundle-macos-unqualified.conf.json"));
  const linux = JSON.parse(await source("src-tauri/tauri.bundle-linux-unqualified.conf.json"));

  assert.deepEqual(windows.bundle.targets, ["nsis"]);
  assert.equal(windows.mainBinaryName, "Experiment Planner");
  assert.deepEqual(macos.bundle.targets, ["dmg"]);
  assert.deepEqual(linux.bundle.targets, ["deb", "appimage"]);
  assert.deepEqual(windows.bundle.resources, []);
  assert.deepEqual(windows.bundle.externalBin, ["target/planner-sidecars/affect-planner-cli"]);
  assert.deepEqual(macos.bundle.resources, []);
  assert.deepEqual(linux.bundle.resources, []);
  assert.equal(macos.bundle.externalBin, undefined);
  assert.equal(linux.bundle.externalBin, undefined);
  assert.equal(linux.bundle.linux.appimage.bundleMediaFramework, false);
  assert.match(windows.bundle.longDescription, /HTML-compatible video path/iu);
  assert.match(macos.bundle.longDescription, /not qualified/iu);
  assert.match(linux.bundle.longDescription, /not qualified/iu);
});

test("Windows package stages the embedded Planner CLI without granting WebView process access", async () => {
  const helper = await source(BUILD_HELPER_PATH);
  const provenance = await source(PROVENANCE_HELPER_PATH);
  const manifest = await source("src-tauri/Cargo.toml");
  const app = await source("src-tauri/src/lib.rs");

  assert.match(helper, /build-planner-cli\.js", "--release", "--no-default-features"/u);
  assert.match(helper, /affect-planner-cli-x86_64-pc-windows-msvc\.exe/u);
  assert.match(provenance, /plannerCli: await identifyPlannerCli\(\)/u);
  assert.match(provenance, /installedFileName: "affect-planner-cli\.exe"/u);
  assert.match(provenance, /sha256: await sha256\(path\)/u);
  assert.doesNotMatch(manifest, /tauri-plugin-shell/u);
  assert.doesNotMatch(app, /tauri_plugin_shell/u);
});

test("standard Runner has a separate unsigned NSIS target and no Planner CLI sidecar", async () => {
  const helper = await source(BUILD_HELPER_PATH);
  const provenance = await source(PROVENANCE_HELPER_PATH);
  const packageJson = JSON.parse(await source("package.json"));
  const runnerConfig = JSON.parse(await source("src-tauri/tauri.runner.conf.json"));

  assert.match(helper, /"runner-windows-x64"[\s\S]*config: "src-tauri\/tauri\.runner\.conf\.json"[\s\S]*binary: "affect-runner"/u);
  assert.match(helper, /target\.binary \? \["--bin", target\.binary\] : \[\]/u);
  assert.match(helper, /if \(target\.name === "windows-x64"\) \{[\s\S]*build-planner-cli/u);
  assert.equal(packageJson.scripts["runner:bundle"], "node scripts/build-unqualified-desktop-package.js runner-windows-x64");
  assert.equal(runnerConfig.productName, "Experiment Runner");
  assert.equal(runnerConfig.mainBinaryName, "affect-runner");
  assert.match(provenance, /"runner-windows-x64"[\s\S]*prefix: "Experiment Runner_"/u);
  assert.match(await source(".github/workflows/desktop-release.yml"), /'runner-windows-x64' = @\{ target = 'runner-windows-x64'; runner = 'windows-latest'/u);
});

test("provenance binds artifact hashes and sets every requested qualification claim false", async () => {
  const helper = await source(PROVENANCE_HELPER_PATH);

  assert.match(helper, /"windows-x64"[\s\S]*platform: "windows"[\s\S]*kind: "nsis"/u);
  assert.match(helper, /AffectResearchUnqualifiedInternalPackageProvenanceV2/u);
  assert.match(helper, /status: "unqualified-internal-alpha"/u);
  assert.match(helper, /commit,/u);
  assert.match(helper, /workflowRef,/u);
  assert.match(helper, /byteLength: details\.size/u);
  assert.match(helper, /sha256: await sha256\(path\)/u);
  for (const claim of ["standardRunnerWebView", "lsl", "nativeInput", "installedWorkflow", "timing", "researchReady"]) {
    assert.match(helper, new RegExp(`${claim}: false`, "u"));
  }
  assert.match(helper, /unsigned: true/u);
  assert.match(helper, /notarized: false/u);
  assert.match(helper, /published: false/u);
});
