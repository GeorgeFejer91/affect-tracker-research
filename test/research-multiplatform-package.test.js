import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const WORKFLOW_PATH = ".github/workflows/desktop-release.yml";
const BUILD_HELPER_PATH = "scripts/build-unqualified-desktop-package.js";
const PROVENANCE_HELPER_PATH = "scripts/write-unqualified-package-provenance.js";
const INSTALLED_SMOKE_PATH = "scripts/qualification/planner-installed-smoke.ps1";

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
    "cargo check --locked --manifest-path native/Cargo.toml --no-default-features",
    "scripts/qualification/native-tests.ps1 -FeatureSet no-default-features",
    "cargo test --locked --manifest-path native/Cargo.toml --no-default-features",
  ]) {
    const prerequisiteIndex = workflow.indexOf(prerequisite);
    assert.ok(prerequisiteIndex >= 0 && prerequisiteIndex < packageIndex, `${prerequisite} must precede packaging`);
  }
  assert.ok(workflow.indexOf("scripts/qualification/native-tests.ps1 -FeatureSet all-features") < packageIndex);
});

test("package helper rejects cross-host and signing boundaries", async () => {
  const [helper, cargoToml] = await Promise.all([
    source(BUILD_HELPER_PATH),
    source("native/Cargo.toml"),
  ]);

  assert.match(helper, /"windows-x64"[\s\S]*nodePlatform: "win32"[\s\S]*bundles: "nsis"/u);
  assert.match(helper, /process\.platform !== target\.nodePlatform \|\| process\.arch !== target\.nodeArch/u);
  assert.match(helper, /--no-sign/u);
  assert.match(helper, /--no-default-features/u);
  assert.match(helper, /"--bin",\s*"affect-research"/u);
  assert.match(helper, /scripts\/build-runner-desktop\.js", "--release"/u);
  assert.match(helper, /AFFECT_TRACKER_BUILD_COMMIT: commit/u);
  assert.match(helper, /status", "--porcelain=v1", "--untracked-files=normal"/u);
  assert.match(helper, /TAURI_SIGNING_PRIVATE_KEY/u);
  assert.match(helper, /createRequire\(import\.meta\.url\)/u);
  assert.match(helper, /require\.resolve\("@tauri-apps\/cli\/tauri\.js"\)/u);
  assert.match(helper, /spawnSync\(\s*process\.execPath,\s*\[\s*tauriCli,/u);
  assert.doesNotMatch(helper, /pnpm\.cmd|shell:\s*true/iu);
  assert.doesNotMatch(helper, /--features[\s\S]*native-[a-z-]+|lsl-streaming/u);
  assert.match(cargoToml, /name = "affect-runner"[\s\S]*?required-features = \["runner-bin"\]/u);
  assert.match(cargoToml, /name = "affect-planner-cli"[\s\S]*?required-features = \["planner-cli-bin"\]/u);
});

test("platform overrides exclude the Windows runtime and select only requested bundles", async () => {
  const windows = JSON.parse(await source("native/tauri.bundle-windows-unqualified.conf.json"));
  const macos = JSON.parse(await source("native/tauri.bundle-macos-unqualified.conf.json"));
  const linux = JSON.parse(await source("native/tauri.bundle-linux-unqualified.conf.json"));

  assert.deepEqual(windows.bundle.targets, ["nsis"]);
  assert.deepEqual(macos.bundle.targets, ["dmg"]);
  assert.deepEqual(linux.bundle.targets, ["deb", "appimage"]);
  assert.deepEqual(windows.bundle.resources, {
    "icons-ledger/icon.ico": "resources/icons/planner-ledger.ico",
    "runner-icons/icon.ico": "resources/icons/experiment-runner.ico",
    "target/release/affect-runner.exe": "resources/bin/affect-runner.exe",
    "windows/affect-research-suite-root.json": "resources/affect-research-suite-root.json",
  });
  assert.deepEqual(macos.bundle.resources, []);
  assert.deepEqual(linux.bundle.resources, []);
  assert.equal(windows.bundle.windows.allowDowngrades, false);
  assert.deepEqual(windows.bundle.windows.webviewInstallMode, {
    type: "offlineInstaller",
    silent: true,
  });
  assert.equal(windows.bundle.windows.nsis.installMode, "currentUser");
  assert.equal(windows.bundle.windows.nsis.startMenuFolder, "Affect Research");
  assert.equal(windows.bundle.windows.nsis.installerHooks, "windows/installer-hooks.nsh");
  assert.equal(linux.bundle.linux.appimage.bundleMediaFramework, false);
  assert.match(windows.bundle.longDescription, /self-contained Windows suite/u);
  assert.match(macos.bundle.longDescription, /not qualified/iu);
  assert.match(linux.bundle.longDescription, /not qualified/iu);
});

test("provenance binds artifact hashes and sets every requested qualification claim false", async () => {
  const helper = await source(PROVENANCE_HELPER_PATH);

  assert.match(helper, /"windows-x64"[\s\S]*platform: "windows"[\s\S]*kind: "nsis"/u);
  assert.match(helper, /AffectResearchUnqualifiedInternalPackageProvenanceV2/u);
  assert.match(helper, /status: "unqualified-internal-alpha"/u);
  assert.match(helper, /origin: local \? "local" : "github-actions"/u);
  assert.match(helper, /local \? "AFFECT_RESEARCH_PACKAGE_COMMIT" : "GITHUB_SHA"/u);
  assert.match(helper, /workflow = local \? null/u);
  assert.match(helper, /\{ id: null, attempt: null, url: null \}/u);
  assert.match(helper, /No GitHub Actions run exists for these bytes/u);
  assert.match(helper, /buildCommitBinaries:[\s\S]*affect-research\.exe[\s\S]*affect-runner\.exe/u);
  assert.match(helper, /bytes\.includes\(Buffer\.from\(commit, "ascii"\)\)/u);
  assert.match(helper, /commit,/u);
  assert.match(helper, /workflowRef,/u);
  assert.match(helper, /byteLength: details\.size/u);
  assert.match(helper, /sha256: await sha256\(path\)/u);
  for (const claim of ["htmlVideoResearchReady", "lsl", "nativeInput", "installedWorkflow", "timing", "researchReady"]) {
    assert.match(helper, new RegExp(`${claim}: false`, "u"));
  }
  assert.match(helper, /htmlVideoPlayerOnly: true/u);
  assert.match(helper, /unsigned: true/u);
  assert.match(helper, /notarized: false/u);
  assert.match(helper, /published: false/u);
  assert.match(helper, /dirtyStateRejected: true/u);
  assert.match(helper, /lockedDependencies: true/u);
  assert.match(helper, /suitePrograms: target\.suitePrograms/u);
  assert.match(helper, /selfContainedSuiteRoot: Boolean\(target\.suitePrograms\)/u);
  for (const tool of ["node", "pnpm", "rustc", "cargo", "tauri"]) {
    assert.match(helper, new RegExp(`${tool}:`, "u"));
  }
});

test("Windows artifacts carry the checkout-free installed lifecycle smoke route", async () => {
  const [workflow, smoke] = await Promise.all([
    source(WORKFLOW_PATH),
    source(INSTALLED_SMOKE_PATH),
  ]);

  assert.match(workflow, /scripts\/qualification\/planner-installed-smoke\.ps1/u);
  assert.match(smoke, /AffectResearchSuiteInstalledSmokeV2/u);
  assert.match(smoke, /374DE290-123F-4565-9164-39C4925E467B/u);
  assert.match(smoke, /AffectResearchUnqualifiedInternalPackageProvenanceV2/u);
  assert.match(smoke, /dirtyStateRejected/u);
  assert.match(smoke, /lockedDependencies/u);
  assert.match(smoke, /node\.exe[\s\S]*pnpm\.cmd/u);
  assert.match(smoke, /8000, 8013, 1420, 5173/u);
  assert.match(smoke, /Experiment Planner\.lnk/u);
  assert.match(smoke, /Experiment Runner\.lnk/u);
  assert.doesNotMatch(smoke, /arguments -cne '--ledger'/u);
  assert.match(smoke, /IAffectResearchShellLinkW/u);
  assert.match(smoke, /GetIconLocation/u);
  assert.match(smoke, /AffectResearchShortcutReader\]::Read/u);
  assert.doesNotMatch(smoke, /WScript\.Shell/u);
  assert.match(smoke, /"\/D=\$Destination"/u);
  assert.match(smoke, /\[string\]\$InstallDirectoryName = 'Affect Research Suite'/u);
  assert.match(smoke, /GetDirectoryName\(\$installRoot\) -cne \$downloads/u);
  assert.match(smoke, /GetFileName\(\$installRoot\) -cne \$InstallDirectoryName/u);
  assert.match(smoke, /<Known Downloads>\/<Selected Suite Directory>/u);
  assert.match(smoke, /planner\\webview/u);
  assert.match(smoke, /runner\\webview/u);
  assert.match(smoke, /\$RequireOffline -and \$launchesWithTcp -ne 0/u);
  assert.doesNotMatch(smoke, /made no TCP connection/u);
  assert.match(smoke, /\[switch\]\$AllowDevelopmentHost/u);
  assert.match(smoke, /Set-Gate 'cleanProfile' 'blocked'[\s\S]*cannot qualify the clean-profile gate/u);
  assert.match(smoke, /\$receipt\.status = if \(\$receipt\.gates\.cleanProfile\.status -eq 'blocked'\)/u);
  assert.match(smoke, /Start-Process -FilePath \$Shortcut -PassThru/u);
  assert.doesNotMatch(smoke, /Get-Process -Id \$candidate/u);
  assert.match(smoke, /'stimuli', 'settings', 'outputs', 'recovery', 'assets', 'assets\/stimuli', 'assets\/questionnaires'/u);
  assert.match(smoke, /\[IO\.File\]::Delete\(\$ledgerIcon\)[\s\S]*Invoke-SilentInstaller \$installer \$installRoot/u);
  assert.match(smoke, /Invoke-SilentExecutable \$uninstaller/u);
  assert.match(smoke, /@\(Get-ProgramInventory \$installRoot\)\.Count -ne 0/u);
  assert.match(smoke, /\$receipt\.gates\[\$currentGate\]\.status -ne 'passed'[\s\S]*Set-Gate \$currentGate 'failed'/u);
  assert.doesNotMatch(smoke, /USERPROFILE[^\n]*Downloads|localhost|http:\/\//iu);
});
