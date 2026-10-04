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

## Exact installed-file evidence

[Windows run 37176003853](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37176003853)
passed source checks, built the unsigned NSIS setup from commit
`1fd9ceafa0949b2023ddf423c715a2acc75dea7a`, installed it silently into a
fresh directory on the ephemeral Windows runner, and passed
`affect-windows-suite-installed-audit-v1` with no issues and
`launcherVerified: true`. The preceding diagnostic run `37174530590` proved
that Tauri places the two resource-mapped receipts at the installation root;
the NSIS hook now checks those actual paths.

The uploaded [unqualified candidate artifact](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37176003853/artifacts/11293408018)
is a 153,635,460-byte ZIP with SHA-256
`786c5ca9275210b2a9e911de6ea4b701f5b74b398c232b2ac72ff5481675d924`.
This digest identifies the uploaded artifact ZIP, not the executable inside.
The workflow retains it for 14 days; it is not a signed release.

## Claim boundary

The exact NSIS candidate has passed an ephemeral silent install and installed
file/hash audit. It has not been installed or opened on the researcher's PC.
Native playback, physical input, actual video-pool execution, LSL/XDF, timing,
accessibility, uninstallation, and the full Planner-to-Runner installed
workflow still require independent exact-artifact checks. The local C: drive
remains below the 6 GiB suite build headroom. Do not present this candidate as
a research-ready release.
