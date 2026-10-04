# Windows companion suite

The intended download is one Windows NSIS installer containing separate
**Experiment Planner** and **Experiment Runner** programs. Planner authors the
segmented experiment JSON; Runner consumes that saved JSON for participant
execution. The installer also carries the pinned `ffprobe.exe` and `ffmpeg.exe`
pair that Planner uses to inspect a video pool and prepare playable siblings.
Original videos remain in the researcher-selected workspace.

## Build and installed-file checks

From a clean Windows x64 source commit with PowerShell 7 and locked Node and
Rust dependencies:

```powershell
pnpm suite:windows:check
pnpm suite:windows:build
```

The build downloads the pinned FFmpeg 9.0.2 essentials ZIP, checks its
SHA-256 against `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`,
and stages only `ffmpeg.exe`, `ffprobe.exe`, and their license, build notes,
source notice and receipt. The tools install beside Planner at
`ffmpeg/bin/`, the exact location P1 checks before falling back to `PATH`.
The build also compiles the Runner frontend and native engine, builds a
hash-bound Runner launcher, and bundles both programs into one unsigned setup.
The generated stage is ignored at `src-tauri/suite/`; a new build refuses to
overwrite it.

After installing an exact candidate, inspect its files without opening a GUI:

```powershell
node scripts/qualification/windows-suite-installed-audit.mjs --app-dir <installed-directory> --expected-commit <40-character-commit> --verify-launcher --verify-media-tools
```

The audit checks the two named programs, the Runner engine and receipt, the
video preparation tools and their receipts, the source commit, and tool
startup with no `PATH` dependency. The installer also verifies the Runner
launcher and required tool files before reporting success. CI repeats the
installed-file audit after a same-path reinstall and checks both Start Menu
shortcut targets.

## Current evidence and limits

An unsigned candidate was built from exact source commit
`55f5a61b9267e1d81d421d76bfaf01d708fa47d4` in
[Windows CI run 37199689479](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37199689479).
The [single-installer artifact](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37199689479/artifacts/11302133782)
is 209,901,535 bytes and is retained by GitHub Actions for 14 days. Its
uploaded ZIP SHA-256 is
`f12a7b3e5253785c366f14fa2ef0cf66959185ea70bb23a9ea2ff933f0fcfa3b`.
CI passed the source tests, frontend builds and native checks, then performed
fresh and same-path repeat silent installs. Both installed audits reported
`result: pass` with the exact source commit, launcher and tool hashes, and
successful launcher/tool startup. Start Menu targets and an installed
AVI-to-H.264 MP4 preparation smoke also passed.

That candidate was superseded by source commit
`735628655b616e2e9d3c58cfb9b328595955457e` in
[Windows CI run 37202963450](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37202963450).
The [exact suite artifact](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37202963450/artifacts/11304322446)
contains one 209,917,967-byte setup EXE, SHA-256
`1447e01995c77c3bb26caae6513bcad90a54954160fc78295a0d9e05db10eaed`.
Its Windows jobs passed source tests and builds, 21 independent native/JS
saved-plan selections, fresh and repeat silent installation, installed-file
audits, launcher/tool startup and Start Menu target checks. This exact EXE was
also silently installed on the local Windows machine at
`C:\Users\gfeje\AppData\Local\Programs\AffectResearchSuite` with exit code 0.
The local installed-file audit passed with the exact source commit, launcher
and media-tool checks; both local Start Menu shortcuts target the two installed
programs. The installed build receipt reports `researchQualified: false`.

That candidate was superseded by exact source commit
`94d63f01c8146cfce1c4f3c9406cfd7b87b69c13` in
[Windows CI run 37206813793](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37206813793).
The [suite artifact](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37206813793/artifacts/11305193039)
contains one 209,899,037-byte setup EXE, SHA-256
`de68d5de0dc87a57fa9534228e9c8b8e43de4ad218638ded39f166aa44846583`.
Both CI jobs passed, including the focused native media-binding test, 21
independent native/JS plan selections and fresh/repeat installed-file audits.
The exact EXE silently replaced the previous local installation with exit code
0. The local audit passed source, launcher and media-tool verification; both
Start Menu shortcuts target the installed programs. Its build receipt still
reports `researchQualified: false`. The P7 integration merge `e52362a` adds
documentation only beyond this tested source.

The current unqualified candidate is exact source commit
`2258716e6893c2f4c343a03f1aa624a85827ab8b` in
[Windows CI run 37212669321](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37212669321).
The [single-installer artifact](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37212669321/artifacts/11307674043)
contains one 210,038,687-byte setup EXE, SHA-256
`1f39a276a90ba473e8beae5946e132566504571ec4b0f10c701824b55d9ef6af`.
Both CI jobs passed: 1,191 frontend tests, independent JS/Rust plan parity,
focused HTML grant/complete-master tests, native no-feature/all-feature gates,
one suite build, fresh/repeat silent installs, shortcut targets and installed
media-tool smoke. The same EXE silently replaced the local installation with
exit code 0. A local installed-file audit passed the exact source commit,
launcher and media tools; both local shortcuts target the installed programs.
The receipt remains `researchQualified: false`. No app window was opened for
participant or visual qualification in this pass.

A passing file audit establishes layout, hashes, and tool startup only. It does
not establish Planner video preparation, participant playback, questionnaire
flow, physical input, LSL/XDF, timing, accessibility, or research readiness.
Those gates require independent checks against the same final candidate.

FFmpeg binary provenance and source links are installed in
`ffmpeg/SOURCE.txt` along with the upstream license and build notes. Any public
distribution must include a completed redistribution review for that exact
binary package.
