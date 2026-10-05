# Flubber VLC Player (experimental)

This separate Windows player bundles VLC 3.0.20, FFmpeg, liblsl and the native
SVG Flubber filter. It has no Python runtime. Opening **Flubber VLC Player**
starts VLC with the Flubber affect and marker LSL outlets online even when no
video is playing. To play a clip with Flubber below it, drag the clip onto the
player shortcut or run `FlubberVLC.exe "C:\path\to\video.mp4"`. The Rust
launcher converts the clip with FFmpeg, preserving its content, audio and
supported subtitles, then starts VLC with the video and dynamic Flubber.
The prepared file has a five-second black lead so the LSL outlets exist before
the original clip starts, plus a short closing tail. CSV time zero remains the
first frame of the original clip. A recorder that needs the Start marker must
subscribe before that boundary; the separate Flubbercorder will gate playback
on confirmed subscriptions.

For a recorder-controlled session, `FlubberVLC.exe video.mp4 --arm` prepares
the clip and starts VLC idle. It prints the local VLC RC address, prepared
clip path, and CSV paths. The recorder can subscribe to both LSL outlets before
sending VLC an `add <prepared file URI>` command. The RC address binds only to
127.0.0.1; it is not a network pairing service.

For a video-specific preset, place `<video stem>.flubber.json` beside the clip:

```json
{"schema":"vlc-flubber-sidequest/v1","panelPercent":25,"stepPercent":10}
```

The arrow keys change valence and arousal during playback. VLC saves an event
CSV and a separate three-variable `time_s,valence,arousal` CSV automatically
under `%LOCALAPPDATA%\VLC_Flubber_Player\recordings`. It emits
`<video filename>_Start` and `<video filename>_Stop` LSL markers. The SVG is
rendered at the video output's pixel size; enlarging a low-resolution VLC
window beyond that size can soften the graphic.

Opening an unconverted file with VLC's own **Media > Open File** bypasses the
Flubber preparation step. Use the shortcut drag-and-drop or the launcher CLI.
This is an experimental standalone player, not the main Affect Research Runner.
