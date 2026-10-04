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

Source-level package checks and the focused installed-audit fixture pass at
`1461f85`. The package with the new media source and bundled tools has **not**
yet been built or installed. The last local install is an earlier internal
candidate; it does not contain the current media workflow or bundled tools.
Its prior [Windows CI run](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/37189915633)
qualified only fresh and repeat installation layout for that older source.

A passing file audit establishes layout, hashes, and tool startup only. It does
not establish Planner video preparation, participant playback, questionnaire
flow, physical input, LSL/XDF, timing, accessibility, or research readiness.
Those gates require independent checks against the same final candidate.

FFmpeg binary provenance and source links are installed in
`ffmpeg/SOURCE.txt` along with the upstream license and build notes. Any public
distribution must include a completed redistribution review for that exact
binary package.
