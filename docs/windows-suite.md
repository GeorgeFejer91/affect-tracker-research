# Windows companion suite candidate

The intended download is one NSIS setup executable. It contains two separate
programs, **Experiment Planner** and **Experiment Runner**, in one installation;
the researcher does not need to fetch a second application. The Runner launcher
checks the adjacent engine hash before opening it. The Planner authors the
segmented experiment JSON; the Runner consumes that exact saved JSON and owns
participant execution and recording. This package adds no experiment setting.

## Build and installed-file check

From a clean Windows x64 source commit with PowerShell 7 and the locked Node and
Rust dependencies:

```powershell
pnpm suite:windows:check
pnpm suite:windows:build
```

The build compiles the Runner frontend and native engine with the Runner Tauri
configuration, builds its hash-bound launcher, writes portable receipts, and
then bundles the Planner and both Runner executables with Tauri's NSIS target.
The generated stage is ignored at `src-tauri/suite/`; a new build refuses to
overwrite it. The NSIS artifact directory is
`src-tauri/target/release/bundle/nsis/`. The build is unsigned.

The manually dispatched `desktop.yml` Windows workflow first runs the normal
source checks, then builds and uploads this installer as a short-lived,
unqualified verification artifact. Before upload, it silently installs the
candidate on its ephemeral Windows runner and runs the installed-file audit
against the exact workflow commit. It does not publish a release.

After installing the exact candidate, inspect its
directory without opening either GUI:

```powershell
node scripts/qualification/windows-suite-installed-audit.mjs --app-dir <installed-directory> --expected-commit <40-character-commit> --verify-launcher
```

The audit checks the four companion files, portable receipt paths, source
identity, Runner hashes and the launcher's verification mode. A valid receipt
binds `Experiment Runner.exe` and `affect-runner-engine.exe` by SHA-256 and marks
`researchQualified: false`. The installer itself runs the launcher's
`--verify-only` check before it reports installation success. Uninstall removes
the installed program files and suite shortcuts; Tauri's normal app-data choice
controls any app-data removal.

## Claim boundary

The configuration and static audit have been checked, but no suite installer
has yet been built or installed from this branch. Native playback, physical
input, actual video-pool execution, LSL/XDF, timing, accessibility, and full
Planner-to-Runner installed workflow still require independent exact-artifact
checks. The current C: free space is about 1.2 GB, below the release build
headroom. Do not present a source check or unqualified NSIS build as a tested
download or a research-ready release.
