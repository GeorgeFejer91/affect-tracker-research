# Flubber VLC Player (experimental)

This standalone Windows player uses the bundled VLC 3.0.20 LibVLC decoder to
play the original video file in the upper part of one window. A native SVG
Flubber animates in the allocated area below it. The player does not transcode
the video. It has a custom window with a native **Flubber** menu and keyboard
controls rather than VLC's Qt playlist and other menus. Video playback still
depends on the codecs and outputs that the bundled VLC runtime can handle on
the computer.

Opening **Flubber VLC Player** starts the `VLC_Flubber_Affect` and
`VLC_Flubber_Markers` LSL outlets, even with no video playing. Drag a video
onto its shortcut, or run `FlubberVLC.exe "C:\path\to\video.mp4"`. Arrow keys
change valence and arousal, Space pauses or resumes, and Escape stops the
video. The SVG is rendered at physical display resolution on its own nominal
30 Hz clock. An independent 30 Hz worker publishes valence and arousal with
an LSL timestamp. It emits `<video filename>_Start` and `_Stop` markers.

Each video run creates a `time_s,valence,arousal` CSV under
`%LOCALAPPDATA%\VLC_Flubber_Player\recordings`. The time column is a monotonic
30 Hz clock aligned to LibVLC's first advancing media time; it is not a
decoded-frame presentation timestamp. The CSV writer is independent of LSL.
Replaying in one process creates another CSV instead of overwriting the first.

The player creates `%LOCALAPPDATA%\VLC_Flubber_Player\presets\default.flubber.json`:

```json
{"schema":"vlc-flubber-sidequest/v1","panelPercent":25,"stepPercent":10}
```

Choose **Flubber → Settings...** in the player window to edit panel height
(10–100%) and arrow key step (1–100%) in place. **Apply** changes this session;
**Save as default** also writes the default preset for future launches. The
editor works while idle or during playback. **Cancel** leaves the current
settings alone. Recorder-controlled `--arm` sessions disable this menu entry
because the Recorder owns those experiment values.

Place `<video stem>.flubber.json` beside a video or in that presets folder to
override the default. An adjacent preset wins over the shared folder; explicit
`--panel-percent` and `--step-percent` arguments win over both. A Recorder
experiment JSON supplies those explicit settings. The panel ratio means
panel height relative to the allocated video height; 25 makes the Flubber
area one-quarter as tall as the video area. A video-specific preset or command
line value still wins over the saved default when that video is opened again.

For Recorder control, `FlubberVLC.exe video.mp4 --arm` publishes its LSL
outlets and waits for a local `play` command. The Recorder subscribes before
playback, sends fullscreen, play/pause/stop/volume commands, monitors the
streams, and records XDF. The command port binds to `127.0.0.1` only. This
prototype remains a separate side project, outside the main Affect Research
Planner and Runner. Installed visual playback has been checked on one Windows
machine; timing, codec breadth, and research use need broader qualification.
