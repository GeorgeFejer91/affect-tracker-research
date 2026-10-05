# Flubbercorder (VLC side project)

This Windows Tauri app is a separate experimenter console for the native VLC
Flubber player. It loads a `flubbercorder-experiment/v1` JSON, prepares the
video, waits for exact Flubber LSL subscriptions before playback, controls
VLC, shows live affect and marker streams, and records an XDF. VLC writes an
independent `time_s,valence,arousal` CSV as a fallback. The app bundles its
own player and native XDF recorder; Python is not part of this installer.
The player converts video to constant frame rate at the probed average rate,
including fractional rates. It emits one affect LSL sample and writes one CSV
row for each decoded frame during the original-video interval. The recorder
checks that the XDF affect count matches VLC's CSV count before finalizing.

The app remains an experimental side project, outside the main Affect
Research Planner and Runner.

## Phone control

The experimenter can press **Give control** to start a phone page on a
detected local IPv4 address, then copy its pairing link to a browser on the
same trusted network. The phone page mirrors the recorder console's affect
samples, stream status, and markers; it does not open an LSL inlet. It can
Start, Pause, Resume, or Stop. **Revoke** closes that session.
This direct LAN prototype uses HTTP with a random session link, so the link
can be observed on an untrusted network. It does not change firewall rules;
Windows may require the user to allow local inbound access. The exact
boundary is in [REMOTE-PROFILE.md](REMOTE-PROFILE.md).

## Build on Windows

1. Build the pinned player package in `../build/player-package/stage` using
   the [player runbook](../README.md). The Tauri build checks every binary
   hash in that package's `manifest.json`.
2. The checked-in `../flubbercorder/recorder-runtime/` is the native XDF
   recorder. Its C++ source and reproducible build script are in
   `../flubbercorder/recorder-source/`; Python is used only by that build script,
   not by the installed application. The recorder forwards sample and marker
   receipts to the Rust console while independently writing XDF.
3. Run `npm ci` here, then `npm run build` to compile the Tauri executable and
   its resources. Run Inno Setup on `../installer-tauri.iss` to create the
   Windows installer in `../build/tauri-package/out/`.
4. To include the locally held Great Dictator study clip, set
   `FLUBBERCORDER_DEMO_VIDEO` to its absolute path before the build. Its exact
   size and SHA-256 are checked. The user has stated they have permission to
   redistribute this clip in the side-project package.

The installer accepts the normal Inno Setup UI or `/VERYSILENT /DIR=<absolute install path>`
for an isolated verification install. At launch, it loads the bundled demo
JSON when its matching clip is present. The `FLUBBERCORDER_PLAYER_DIR`,
`FLUBBERCORDER_RECORDER_DIR`, and `FLUBBERCORDER_DEFAULT_RECIPE` environment
variables can override the bundled resources for local diagnostics.

The default JSON is in `../flubbercorder/demo/great-dictator.json`. A custom
recipe uses a video path relative to its JSON file:

```json
{
  "schema": "flubbercorder-experiment/v1",
  "video": "clip.mp4",
  "panelPercent": 25,
  "stepPercent": 10,
  "requiredStreams": []
}
```

`requiredStreams` holds additional LSL names to record. Prepare fails if
any required stream is absent or ambiguous. The bundled player emits both
Flubber outlets while armed, before the video starts. The recorder must
confirm both subscriptions before Start is enabled. At completion,
Flubbercorder verifies the exact `<video filename>_Start` and `_Stop` XDF
markers and checks the XDF affect count against VLC's CSV before promoting
the partial recording to `.xdf`.

The experimental `.xdf.partial` is preserved when a run cannot be validated.
Do not treat this software as research-qualified without the remaining
timing, input, recovery, and broader installed checks in
[`for-ai/74`](../../../for-ai/74-VLC-FLUBBER-SIDE-QUEST.md).
