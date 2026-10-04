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

[Windows run 37182385963](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37182385963)
passed source checks, built the unsigned NSIS setup from commit
`3ae5fb320b77b1c899af67bc6530e7ad1c07d9a6`, installed it silently into a
fresh directory on the ephemeral Windows runner, and passed
`affect-windows-suite-installed-audit-v1` with no issues and
`launcherVerified: true`. Its [unqualified installer artifact](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37182385963/artifacts/11296121762)
is a 153,636,833-byte ZIP with SHA-256
`b098a19a0e9fac2fb14228cc708f94fa6442622900494b2bf1178c0fd933c3a1`.
That digest identifies the uploaded ZIP, not the setup executable inside.

The same run independently verified all six pinned direct GStreamer component
source archives against their bytes, SHA-256 values and published upstream
checksums. Its [temporary source-review artifact](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37182385963/artifacts/11295622049)
is a 19,317,679-byte ZIP with SHA-256
`f4d84e4329bc1cc87c080442a1ad5931ba595ba3b119c6168ee50537a45ae1fe`.
Both artifacts have 14-day retention. The installer contains no GStreamer
runtime; these source archives do not establish redistribution approval.

The later [Windows run 37185887919](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37185887919)
passed all three jobs at source commit
`308204455eb17b433edb2e2d1bbf9a593e5c7a61`, including the focused native
saved-renderer animation test. Its [installer artifact](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37185887919/artifacts/11297477320)
is a 153,634,544-byte ZIP with SHA-256
`508fdc31097b5d8412c6ddae6089091e6bf55e4f87c1edd5c68ff1fad9408bc9`.
The setup executable inside has SHA-256
`a8b6df00f7fec5645905d9891e6b09e83758cdc1d2a959b5caf226332792d986`.
It silently installed to a fresh per-user location on the researcher's current
PC and passed the original installed-file audit with matching source, receipts
and launcher verification. A subsequent inventory found an unintended
`affect-runner.exe` alongside the named launcher and engine. The strengthened
audit correctly rejects that installed candidate with
`duplicate-runner-executable`. A corrected exact-source installer and local
replacement check are pending.

## Claim boundary

The `3082044` candidate has been silently installed and file-audited on the
researcher's PC. It remains an unqualified candidate, and the duplicate Runner
file finding prevents treating that installation as the corrected suite.
Native playback, physical input, actual video-pool execution, LSL/XDF, timing,
accessibility, uninstallation, and the full Planner-to-Runner installed
workflow still require independent exact-artifact checks. Do not present this
candidate as a research-ready release.
