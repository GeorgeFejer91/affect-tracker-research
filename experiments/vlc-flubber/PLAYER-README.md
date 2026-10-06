# Flubber VLC Player

This separately installed Windows player contains VLC 3.0.20, FFmpeg,
liblsl, and the Flubber video filter. The installer places it in
`%LOCALAPPDATA%\Programs\FlubberVLCPlayer` by default. `FlubberVLC.exe` is
also usable without the FlubberRecorder installer.

The current player can open one video through its legacy Flubber path, and it
can inspect a saved Planner master1–5 file and print the selected plan without
starting VLC:

```
FlubberVLC.exe --inspect-master experiment.json --participant P001 --selector-json SELECTOR_JSON
```

`SELECTOR_JSON` is the explicit variant, language, language path, and
presentation target selection for that master, as produced by the shared
Planner/Runner selection contract.

The inspected master is not yet executable. Do not use this player for a
Planner-authored recording session until the shared video, LSL, and XDF gates
are implemented and qualified. Direct `--arm` access is retired. The local
FlubberRecorder uses the supervised `--control-stdio` interface documented in
`player-launcher/CONTROL-STDIO.md`; users should not send VLC RC commands.

`manifest.json` has the seven exact component names and hashes required by
FlubberRecorder. `payload-manifest.json` lists every staged payload file
except itself, including VLC runtime files, with forward-slash paths and
SHA-256 hashes.
The Recorder currently pins `manifest.json` and checks its seven components;
the broader inventory is for release audit and is not a Recorder trust gate.

Build from this repository checkout on Windows with Visual Studio C++ tools,
Rust/Cargo, PowerShell, and Inno Setup 6 (`ISCC.exe` on `PATH`):

```
pwsh -File experiments/vlc-flubber/package-player.ps1 -CompileInstaller
```

The script verifies downloaded VLC, FFmpeg, and liblsl archives against pinned
SHA-256 values, builds the native filter, renderer, and current launcher, then
stages the complete payload and compiles
`build/player-package/out/Flubber_VLC_Player_Setup_0.1.0_x64.exe`. Its output
prints the manifest SHA-256 for the matching Recorder build. Install and
launch testing are still required on a clean Windows machine before release.
