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

  assert.match(workflow, /target: windows-x64\n\s+runner: windows-latest\n\s+platform: windows\n\s+architecture: x64/u);
  assert.match(workflow, /target: macos-arm64\n\s+runner: macos-15\n\s+platform: macos\n\s+architecture: arm64/u);
  assert.match(workflow, /target: macos-x64\n\s+runner: macos-15-intel\n\s+platform: macos\n\s+architecture: x64/u);
  assert.match(workflow, /target: linux-x64\n\s+runner: ubuntu-22\.04\n\s+platform: linux\n\s+architecture: x64/u);
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
  assert.match(helper, /AFFECT_RESEARCH_REQUIRE_GSTREAMER_RUNTIME: "0"/u);
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
  assert.deepEqual(macos.bundle.targets, ["dmg"]);
  assert.deepEqual(linux.bundle.targets, ["deb", "appimage"]);
  assert.deepEqual(windows.bundle.resources, []);
  assert.deepEqual(macos.bundle.resources, []);
  assert.deepEqual(linux.bundle.resources, []);
  assert.equal(linux.bundle.linux.appimage.bundleMediaFramework, false);
  assert.match(windows.bundle.longDescription, /not bundled/iu);
  assert.match(macos.bundle.longDescription, /not qualified/iu);
  assert.match(linux.bundle.longDescription, /not qualified/iu);
});

test("provenance binds artifact hashes and sets every requested qualification claim false", async () => {
  const helper = await source(PROVENANCE_HELPER_PATH);

  assert.match(helper, /"windows-x64"[\s\S]*platform: "windows"[\s\S]*kind: "nsis"/u);
  assert.match(helper, /AffectResearchUnqualifiedInternalPackageProvenanceV1/u);
  assert.match(helper, /status: "unqualified-internal-alpha"/u);
  assert.match(helper, /commit,/u);
  assert.match(helper, /workflowRef,/u);
  assert.match(helper, /byteLength: details\.size/u);
  assert.match(helper, /sha256: await sha256\(path\)/u);
  for (const claim of ["nativeGstPlay", "lsl", "nativeInput", "installedWorkflow", "timing", "researchReady"]) {
    assert.match(helper, new RegExp(`${claim}: false`, "u"));
  }
  assert.match(helper, /unsigned: true/u);
  assert.match(helper, /notarized: false/u);
  assert.match(helper, /published: false/u);
});
