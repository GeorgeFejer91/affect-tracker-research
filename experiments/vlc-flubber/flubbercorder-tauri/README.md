# Flubbercorder (VLC side project)

This Windows Tauri app is a separate experimenter console for the stock VLC
3.0.20 Qt player with its bottom Flubber panel. It loads a
`flubbercorder-experiment/v1` JSON, waits for exact Flubber LSL subscriptions
before playback, controls
VLC, shows live affect and marker streams, and records an XDF. VLC writes an
independent `time_s,valence,arousal` CSV beside the played video as a backup;
that directory must be writable. The app bundles its
own player and native XDF recorder; Python is not part of this installer.
The player opens the original file through VLC. Its native Flubber panel
and LSL affect outlet each run at nominal 30 Hz independently of video frame
rate. The fallback CSV contains 30 Hz video-bounded time, valence, and arousal
rows. The Recorder is a separate executable. It checks for filename Start/Stop
bookends, bounded VLC control markers between them, and that the XDF contains
at least as many affect samples as the video CSV before finalizing.

The app remains an experimental side project, outside the main Affect
Research Planner and Runner.

The experimenter and paired phone can Start, Pause, Resume, Stop, and set VLC
volume from 0–100%. Recorder-driven playback requests fullscreen immediately
before the original clip starts. The integrated VLC window retains its stock
menus, playlist, and controls, including View → Flubber Controls for
appearance JSON import and manual Flubber size and position.
Before Prepare, the experimenter can add up to six custom label/value fields;
Start writes these as a `flubbercorder-session/v1` `.session.json` file beside
the XDF. The experiment JSON supplies panel height and input step for a
controlled session; Flubber appearance is loaded in VLC's own View menu.

## Phone control

The experimenter can press **Give control** to start a phone page on a
detected local IPv4 address, then copy its pairing link to a browser on the
same trusted network. The phone page mirrors the recorder console's affect
samples, stream status, and markers; it does not open an LSL inlet. It can
Start, Pause, Resume, Stop, and change volume. **Revoke** closes that session.
Phone pairing requires an active private IPv4 network route.
This direct LAN prototype uses HTTP with a random session link, so the link
can be observed on an untrusted network. It does not change firewall rules;
Windows may require the user to allow local inbound access. The exact
boundary is in [REMOTE-PROFILE.md](REMOTE-PROFILE.md).

## Build on Windows

1. Build the pinned stock VLC player package in
   `../build/stock-vlc-package/stage` using
   [the stock VLC runbook](../vlc-qt/README.md). The Tauri build checks every
   listed file hash in that package's `manifest.json`.
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
Flubbercorder verifies `<video filename>_Start` and `_Stop` as XDF bookends,
accepts Pause, Resume, Interrupt, BufferingStart, BufferingEnd, End, and Error
events between them, and checks XDF affect coverage against VLC's video CSV before promoting
the partial recording to `.xdf`.

The experimental `.xdf.partial` is preserved when a run cannot be validated.
Do not treat this software as research-qualified without the remaining
timing, input, recovery, and broader installed checks in
[`for-ai/75`](../../../for-ai/75-VLC-FLUBBER-SIDE-QUEST.md).
