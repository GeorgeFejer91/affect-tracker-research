# FlubberRecorder local shell

This is a separate Windows Tauri application and NSIS bundle. It contains no
VLC, FFmpeg, player launcher, video, Node runtime, LAN listener, or research
session engine. It verifies the seven files in the independently installed
FlubberVLC Player's `manifest.json`, then calls its `--inspect-master` command
to inspect a selected Planner master. The selected master and player location
remain in memory. Research Start is disabled.

By default the player is expected at
`%LOCALAPPDATA%\Programs\FlubberVLCPlayer`. A different local installation
folder can be selected in the UI. Missing, altered, or linked components are
rejected. The player installer must be installed separately for now. A
published, qualified player setup asset with fixed URL and SHA-256 is required
before Recorder setup can download and verify it; no download URL is assumed.

Build the Windows installer with `pnpm install --frozen-lockfile` followed by
`pnpm build` from this directory when Windows build prerequisites are available.
Installed player inspection and a
fresh NSIS install have not been qualified yet.
