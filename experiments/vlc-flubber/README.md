# VLC Flubber Runner

This directory contains one current Windows VLC Flubber player and a **separate
Recorder**. The player gives the original media file to bundled LibVLC 3.0.20,
shows video above a native SVG Flubber and two-axis rating grid, publishes
affect and video control markers to LSL, and writes a CSV backup beside the
played video. The Recorder subscribes to LSL, controls playback over loopback,
and writes XDF in its own application-data recordings directory. Neither
program changes the standard WebView Experiment Runner.

The player uses foreground relative mouse movement for valence and arousal;
arrow keys remain available. It emits filename-based `Start` and `Stop`
bookends, with `Pause`, `Resume`, `Interrupt`, `BufferingStart`,
`BufferingEnd`, `End`, and `Error` markers as observed. The CSV is a unique
`time_s,valence,arousal` file in the video's directory, which must be
writable. A separate Recorder is optional; the VLC streams and CSV run on
their own. See the [player guide](PLAYER-README.md) for input and marker
semantics and the [Recorder guide](flubbercorder-tauri/README.md) for JSON,
LSL/XDF, and package details.

## Build and local check

On Windows x64 with Rust and Inno Setup 6:

1. Run `./package-player.ps1`. This downloads and hash-checks pinned VLC
   3.0.20, builds the Rust player and SVG renderer, and stages one standalone
   player under `build/player-package/stage`.
2. Optionally run `npm ci` and `npm run build` in `flubbercorder-tauri/` to
   build the separate Recorder against that staged player. Its native XDF
   recorder runtime and corresponding source live in `flubbercorder/`.
3. Compile `installer-player.iss` and `installer-tauri.iss` with Inno Setup
   when Windows installer candidates are needed. These are two programs,
   with one VLC playback implementation.

For a focused source check, run `cargo test --locked --manifest-path
libvlc-player/Cargo.toml` and `cargo test --locked --manifest-path
flubbercorder-native/Cargo.toml`. Build `probe.exe` with `cargo build
--release --locked --manifest-path libvlc-player/Cargo.toml --bin probe` to
observe the LSL streams during a visible player run. LibVLC video output
needs a visible window on the tested machine.

The former VLC video-filter, FFmpeg conversion launcher, Python console and
installer were 0.1.x prototypes. Their exact source and release evidence
remain in Git history and the `vlc-flubber-native-v0.1.1` tag; they are not
alternative current launch paths. The [status record](../../for-ai/75-VLC-FLUBBER-SIDE-QUEST.md)
describes the experimental evidence and open qualification gates. This VLC
Runner is not research-qualified by the local checks above.
