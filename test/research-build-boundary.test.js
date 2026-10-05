import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Research production builds have closed, Research-only input boundaries", async () => {
  const [vite, pages, verifier] = await Promise.all([
    read("desktop/vite.config.js"),
    read("scripts/build-research-pages.js"),
    read("scripts/verify-research-build.js"),
  ]);
  assert.match(vite, /publicDir:\s*false/u);
  assert.match(vite, /input:\s*\{\s*research:\s*resolve\(desktopRoot,\s*"index\.html"\)/u);
  assert.match(vite, /"\/site":\s*resolve\(desktopRoot,\s*"\.\.\/site"\)/u);
  assert.doesNotMatch(vite, /site\/vendor|overlay\.html|study\.html|webxr/iu);
  assert.match(pages, /resolve\(sourceRoot,\s*"src",\s*"research"\)/u);
  assert.match(pages, /distributableQuestionnaireFiles/u);
  assert.doesNotMatch(pages, /tas-20-en\.csv/u);
  assert.doesNotMatch(verifier, /tas-20-en/u);
  assert.doesNotMatch(pages, /vendor|overlay\.html|study\.html|webxr/iu);
});

test("Windows CI validates the HTML-video desktop boundary without native media runtime staging", async () => {
  const [checksWorkflow, packageWorkflow, buildHook, cargoToml] = await Promise.all([
    read(".github/workflows/desktop.yml"),
    read(".github/workflows/desktop-release.yml"),
    read("src-tauri/build.rs"),
    read("src-tauri/Cargo.toml"),
  ]);

  for (const workflow of [checksWorkflow, packageWorkflow]) {
    const actionReferences = [...workflow.matchAll(/^\s*uses:\s*[^@\s#]+@([^\s#]+)/gmu)];
    assert.ok(actionReferences.length >= 5, "expected the complete desktop action set");
    for (const [, reference] of actionReferences) assert.match(reference, /^[0-9a-f]{40}$/u);
    assert.match(workflow, /cargo test --locked --manifest-path src-tauri\/Cargo\.toml --no-default-features --no-run/u);
    assert.doesNotMatch(workflow, /libvlc|vlc-3\.0\.23/iu);
  }
  assert.match(checksWorkflow, /cargo test --locked --manifest-path src-tauri\/Cargo\.toml --all-features --no-run/u);
  for (const step of [
    "Check native Research backend",
    "Compile native Research tests with all features",
    "Lint native Research backend",
  ]) {
    assert.match(checksWorkflow, new RegExp(`- name: ${step}\\n\\s+run: cargo`, "u"));
  }
  assert.doesNotMatch(checksWorkflow, /prepare-gstreamer|GSTREAMER|native-gstreamer|gstreamer-runtime|native-media\/runtime|PATH =/iu);
  assert.doesNotMatch(packageWorkflow, /prepare-gstreamer|--all-features|GSTREAMER|native-gstreamer|native-media\/runtime/iu);
  assert.doesNotMatch(checksWorkflow, /tauri build|bundle\/nsis|upload-artifact|desktop:bundle|write-gstreamer-artifact-provenance/iu);
  assert.match(packageWorkflow, /build-unqualified-desktop-package\.js \$\{\{ matrix\.target \}\}/u);
  assert.match(packageWorkflow, /write-unqualified-package-provenance\.js/u);
  assert.match(packageWorkflow, /unqualified-internal-\$\{\{ matrix\.target \}\}-\$\{\{ github\.sha \}\}/u);
  assert.match(packageWorkflow, /bundle\/nsis\/\*\.exe/u);
  assert.doesNotMatch(packageWorkflow, /AFFECT_RESEARCH_REQUIRE_GSTREAMER_RUNTIME:\s*"1"|write-gstreamer-artifact-provenance|native-media\/runtime\/gstreamer/iu);

  assert.doesNotMatch(buildHook, /REQUIRE_NATIVE_MEDIA_RUNTIME|CARGO_FEATURE_NATIVE_GSTREAMER|native-gstreamer|GSTREAMER/iu);
  assert.doesNotMatch(cargoToml, /native-gstreamer|gstreamer|gstreamer-play|gstreamer-pbutils|async-channel/iu);
  assert.match(buildHook, /CARGO_FEATURE_NATIVE_ACQUISITION_WINDOWS/u);
});

test("the local Windows package is interface-only and excludes the unreviewed GStreamer closure", async () => {
  const [packageJson, helper, bundleConfigText, cargoToml, platform, gitignore] = await Promise.all([
    read("package.json"),
    read("scripts/build-unqualified-desktop-package.js"),
    read("src-tauri/tauri.bundle-windows-unqualified.conf.json"),
    read("src-tauri/Cargo.toml"),
    read("src-tauri/src/research_platform.rs"),
    read(".gitignore"),
  ]);
  const bundleConfig = JSON.parse(bundleConfigText);
  assert.match(packageJson, /"desktop:bundle": "node scripts\/build-unqualified-desktop-package\.js windows-x64"/u);
  assert.match(helper, /"windows-x64"[\s\S]*nodePlatform: "win32"[\s\S]*bundles: "nsis"[\s\S]*tauri\.bundle-windows-unqualified\.conf\.json/u);
  assert.match(helper, /--no-default-features/u);
  assert.doesNotMatch(helper, /AFFECT_RESEARCH_REQUIRE_GSTREAMER_RUNTIME: "0"|--features[\s\S]*native-gstreamer|lsl-streaming/iu);
  assert.match(cargoToml, /default = \["lsl-streaming", "native-acquisition-windows"\]/u);
  assert.match(platform, /feature = "native-acquisition-windows"/u);
  assert.deepEqual(bundleConfig.bundle.targets, ["nsis"]);
  assert.deepEqual(bundleConfig.bundle.resources, []);
  assert.match(bundleConfig.bundle.longDescription, /HTML-compatible video path/iu);
  assert.match(gitignore, /^src-tauri\/native-media\/runtime\/$/mu);
});
