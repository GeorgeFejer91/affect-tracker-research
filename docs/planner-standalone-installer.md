# Standalone Windows Planner installer

The Windows `desktop:bundle` path builds one unsigned NSIS installer for
**Experiment Planner**. It bundles the existing `affect-planner-cli.exe` as a
separately runnable command. It does not bundle a Runner, grant the WebView
permission to launch processes, or change the master5 JSON and questionnaire
asset contract.

`scripts/build-unqualified-desktop-package.js windows-x64` requires a clean,
exact source commit and Windows MSVC x64. It builds the CLI with embedded
frontend assets and no default native-acquisition features, stages the
target-suffixed executable for Tauri, and bundles the Planner GUI. The manual
`desktop-release.yml` job runs this path after its source checks. Its
`unqualified-windows-x64-provenance.json` records the installer SHA-256 and
the staged CLI byte length and SHA-256.

For an installed candidate, compare `Experiment Planner.exe` and
`affect-planner-cli.exe` in the fresh installation directory with that exact
source/artifact receipt. Run the installed CLI with `--help` to confirm it
starts without a development server. A separate installed master5 Open/edit/
new Save and questionnaire-asset readback remains required before calling the
installed Planner workflow verified. Keep the source JSON and its declared
`assets/questionnaires/` and `assets/stimuli/` together.

This package remains an internal interface candidate. It has no bundled native
media actor, so its file and CLI checks cannot establish qualified video
inspection, Runner execution, timing, LSL/XDF, or research readiness.
