import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const retiredRuntimeTerms = /native\/native-media|native-media\/runtime|runtime_manifest|stage-[\w-]*runtime|prepare-[\w-]*runtime|AFFECT_RESEARCH_REQUIRE_[A-Z_]+_RUNTIME/iu;

test("Research production builds have closed, Research-only input boundaries", async () => {
  const [vite, pages, verifier] = await Promise.all([
    read("experiment-planner/desktop/vite.config.js"),
    read("scripts/build-research-pages.js"),
    read("scripts/verify-research-build.js"),
  ]);
  assert.match(vite, /publicDir:\s*false/u);
  assert.match(vite, /input:\s*\{\s*research:\s*resolve\(desktopRoot,\s*"index\.html"\)/u);
  assert.match(vite, /"\/site":\s*resolve\(desktopRoot,\s*"\.\.\/web"\)/u);
  assert.doesNotMatch(vite, /experiment-planner\/web\/vendor|overlay\.html|study\.html|webxr/iu);
  assert.match(pages, /resolve\(sourceRoot,\s*"src",\s*"research"\)/u);
  assert.match(pages, /distributableQuestionnaireFiles/u);
  assert.doesNotMatch(pages, /tas-20-en\.csv/u);
  assert.doesNotMatch(verifier, /tas-20-en/u);
  assert.doesNotMatch(pages, /vendor|overlay\.html|study\.html|webxr/iu);
});

test("Windows desktop builds do not carry the removed native player stack protocol", async () => {
  const [checksWorkflow, packageWorkflow, buildHook, cargoToml, tauriConfig, runnerConfig, runnerBuild, cliBuild] = await Promise.all([
    read(".github/workflows/desktop.yml"),
    read(".github/workflows/desktop-release.yml"),
    read("native/build.rs"),
    read("native/Cargo.toml"),
    read("native/tauri.conf.json"),
    read("native/tauri.runner.conf.json"),
    read("scripts/build-runner-desktop.js"),
    read("scripts/build-planner-cli.js"),
  ]);

  for (const workflow of [checksWorkflow, packageWorkflow]) {
    const actionReferences = [...workflow.matchAll(/^\s*uses:\s*[^@\s#]+@([^\s#]+)/gmu)];
    assert.ok(actionReferences.length >= 5, "expected the complete desktop action set");
    for (const [, reference] of actionReferences) assert.match(reference, /^[0-9a-f]{40}$/u);
    assert.match(workflow, /cargo test --locked --manifest-path native\/Cargo\.toml --no-default-features/u);
    assert.doesNotMatch(workflow, /libvlc|vlc-3\.0\.23/iu);
    assert.doesNotMatch(workflow, retiredRuntimeTerms);
  }
  assert.match(checksWorkflow, /cargo test --locked --manifest-path native\/Cargo\.toml --all-features/u);
  assert.doesNotMatch(packageWorkflow, /--all-features/u);
  assert.doesNotMatch(checksWorkflow, /tauri build|bundle\/nsis|upload-artifact|desktop:bundle/iu);
  assert.match(packageWorkflow, /build-unqualified-desktop-package\.js \$\{\{ matrix\.target \}\}/u);
  assert.match(packageWorkflow, /write-unqualified-package-provenance\.js/u);
  assert.match(packageWorkflow, /unqualified-internal-\$\{\{ matrix\.target \}\}-\$\{\{ github\.sha \}\}/u);
  assert.match(packageWorkflow, /bundle\/nsis\/\*\.exe/u);
  for (const text of [buildHook, cargoToml, tauriConfig, runnerConfig, runnerBuild, cliBuild]) {
    assert.doesNotMatch(text, retiredRuntimeTerms);
  }
  assert.doesNotMatch(cargoToml, /async-channel|removed-player-pbutils|removed-player-play/iu);
  assert.deepEqual(JSON.parse(tauriConfig).bundle.resources ?? [], []);
  assert.deepEqual(JSON.parse(runnerConfig).bundle.resources ?? [], []);
});

test("the local Windows package is interface-only and excludes the unreviewed native player stack closure", async () => {
  const [packageJson, helper, bundleConfigText, cargoToml, platform, gitignore] = await Promise.all([
    read("package.json"),
    read("scripts/build-unqualified-desktop-package.js"),
    read("native/tauri.bundle-windows-unqualified.conf.json"),
    read("native/Cargo.toml"),
    read("native/src/research_platform.rs"),
    read(".gitignore"),
  ]);
  const bundleConfig = JSON.parse(bundleConfigText);
  assert.match(packageJson, /"desktop:bundle": "node scripts\/build-unqualified-desktop-package\.js windows-x64"/u);
  assert.match(helper, /"windows-x64"[\s\S]*nodePlatform: "win32"[\s\S]*bundles: "nsis"[\s\S]*tauri\.bundle-windows-unqualified\.conf\.json/u);
  assert.match(helper, /--no-default-features/u);
  assert.doesNotMatch(helper, /AFFECT_RESEARCH_REQUIRE_[A-Z_]+_RUNTIME|--features[\s\S]*native-[a-z-]+|lsl-streaming/iu);
  assert.match(cargoToml, /default = \["lsl-streaming", "native-acquisition-windows"\]/u);
  assert.match(platform, /feature = "native-acquisition-windows"/u);
  assert.deepEqual(bundleConfig.bundle.targets, ["nsis"]);
  assert.deepEqual(bundleConfig.bundle.resources, []);
  assert.match(bundleConfig.bundle.longDescription, /HTML-compatible video playback/iu);
  assert.doesNotMatch(gitignore, /^native\/native-media\/runtime\/$/mu);
});
