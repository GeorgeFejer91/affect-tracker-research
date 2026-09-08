import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Research production builds have closed, Research-only input boundaries", async () => {
  const [vite, pages] = await Promise.all([
    read("desktop/vite.config.js"),
    read("scripts/build-research-pages.js"),
  ]);
  assert.match(vite, /publicDir:\s*false/u);
  assert.match(vite, /input:\s*\{\s*research:\s*resolve\(desktopRoot,\s*"index\.html"\)/u);
  assert.doesNotMatch(vite, /site\/vendor|overlay\.html|study\.html|webxr/iu);
  assert.match(pages, /resolve\(sourceRoot,\s*"src",\s*"research"\)/u);
  assert.doesNotMatch(pages, /vendor|overlay\.html|study\.html|webxr/iu);
});

test("Windows GStreamer CI validates the pinned integration boundary without distributing its runtime", async () => {
  const [checksWorkflow, packageWorkflow, preparer, pinText, buildHook] = await Promise.all([
    read(".github/workflows/desktop.yml"),
    read(".github/workflows/desktop-multiplatform.yml"),
    read("src-tauri/native-media/prepare-gstreamer-windows-ci.ps1"),
    read("src-tauri/native-media/gstreamer-runtime-v1.json"),
    read("src-tauri/build.rs"),
  ]);
  const pin = JSON.parse(pinText);
  assert.equal(pin.backend, "gstreamer-gstplay");
  assert.equal(pin.api, "gstplay");
  assert.equal(pin.runtimeVersion, "1.28.6");
  assert.equal(pin.bindingsSeries, "0.25");
  assert.equal(pin.installer.runtimeInstallType, "runtime");
  assert.equal(pin.installer.developmentInstallType, "devel");
  assert.equal(pin.installer.byteLength, 528572178);
  assert.equal(pin.qualification.allFormatsClaimAllowed, false);
  assert.equal(pin.qualification.redistributionReviewRequired, true);
  assert.equal(pin.sourceEvidence.status, "incomplete-not-for-distribution");
  assert.equal(pin.sourceEvidence.automatedFetchAndVerification, false);
  assert.equal(pin.sourceEvidence.distributionApproved, false);

  for (const workflow of [checksWorkflow, packageWorkflow]) {
    const actionReferences = [...workflow.matchAll(/^\s*uses:\s*[^@\s#]+@([^\s#]+)/gmu)];
    assert.ok(actionReferences.length >= 5, "expected the complete desktop action set");
    for (const [, reference] of actionReferences) assert.match(reference, /^[0-9a-f]{40}$/u);
    assert.match(workflow, /cargo test --locked --manifest-path src-tauri\/Cargo\.toml --no-default-features/u);
    assert.doesNotMatch(workflow, /libvlc|vlc-3\.0\.23/iu);
  }
  assert.match(checksWorkflow, /cargo test --locked --manifest-path src-tauri\/Cargo\.toml --all-features/u);
  assert.match(checksWorkflow, /prepare-gstreamer-windows-ci\.ps1/u);
  assert.equal(
    [...checksWorkflow.matchAll(/AFFECT_RESEARCH_REQUIRE_GSTREAMER_RUNTIME:\s*"1"/gu)].length,
    3,
  );
  for (const step of [
    "Check native Research backend",
    "Test native Research backend with all features",
    "Lint native Research backend",
  ]) {
    assert.match(
      checksWorkflow,
      new RegExp(`- name: ${step}\\n\\s+env:\\n\\s+AFFECT_RESEARCH_REQUIRE_GSTREAMER_RUNTIME: "1"`, "u"),
    );
  }
  assert.doesNotMatch(packageWorkflow, /prepare-gstreamer-windows-ci\.ps1|--all-features/u);
  assert.doesNotMatch(checksWorkflow, /tauri build|bundle\/nsis|upload-artifact|desktop:bundle|write-gstreamer-artifact-provenance/iu);
  assert.match(packageWorkflow, /build-unqualified-desktop-package\.js \$\{\{ matrix\.target \}\}/u);
  assert.match(packageWorkflow, /write-unqualified-package-provenance\.js/u);
  assert.match(packageWorkflow, /unqualified-internal-\$\{\{ matrix\.target \}\}-\$\{\{ github\.sha \}\}/u);
  assert.match(packageWorkflow, /bundle\/nsis\/\*\.exe/u);
  assert.doesNotMatch(packageWorkflow, /AFFECT_RESEARCH_REQUIRE_GSTREAMER_RUNTIME:\s*"1"|write-gstreamer-artifact-provenance|native-media\/runtime\/gstreamer/iu);

  assert.match(preparer, /Get-Content -Raw -LiteralPath \$pinPath \| ConvertFrom-Json/u);
  assert.match(preparer, /Invoke-WebRequest -Uri \$installerUri\.AbsoluteUri/u);
  assert.match(preparer, /\$pin\.installer\.sha256/u);
  assert.match(preparer, /\$pin\.installer\.byteLength/u);
  assert.match(preparer, /stage-gstreamer-runtime\.ps1/u);
  assert.match(preparer, /\$pin\.installer\.developmentInstallType/u);
  assert.match(preparer, /GSTREAMER_1_0_ROOT_MSVC_X86_64=/u);
  assert.match(preparer, /PKG_CONFIG_PATH=/u);
  assert.doesNotMatch(preparer, /download\.videolan|libvlc/iu);

  assert.match(buildHook, /match env::var\(REQUIRE_NATIVE_MEDIA_RUNTIME\)/u);
  assert.match(buildHook, /must be unset, 0, or 1/u);
  assert.match(buildHook, /CARGO_FEATURE_NATIVE_GSTREAMER/u);
  assert.match(buildHook, /CARGO_FEATURE_NATIVE_ACQUISITION_WINDOWS/u);
  assert.match(buildHook, /requires the native-gstreamer Cargo feature/u);
  assert.match(buildHook, /requires the native-acquisition-windows Cargo feature/u);
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
  assert.match(helper, /AFFECT_RESEARCH_REQUIRE_GSTREAMER_RUNTIME: "0"/u);
  assert.doesNotMatch(helper, /--features[\s\S]*native-gstreamer|lsl-streaming/iu);
  assert.match(cargoToml, /default = \["lsl-streaming", "native-acquisition-windows"\]/u);
  assert.match(platform, /feature = "native-acquisition-windows"/u);
  assert.deepEqual(bundleConfig.bundle.targets, ["nsis"]);
  assert.deepEqual(bundleConfig.bundle.resources, []);
  assert.match(bundleConfig.bundle.longDescription, /GStreamer runtime is not bundled/iu);
  assert.match(gitignore, /^src-tauri\/native-media\/runtime\/$/mu);
});
