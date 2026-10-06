# Flubber VLC Player (experimental)

This standalone Windows player uses the bundled VLC 3.0.20 LibVLC decoder to
play the original video file in the upper part of one window. A native SVG
Flubber animates in the allocated area below it. The player does not transcode
the video. It has a custom window and keyboard controls rather than VLC's Qt
menus or playlist. Video playback still depends on the codecs and outputs that
the bundled VLC runtime can handle on the computer.

Opening **Flubber VLC Player** starts the `VLC_Flubber_Affect` and
`VLC_Flubber_Markers` LSL outlets, even with no video playing. Drag a video
onto its shortcut, or run `FlubberVLC.exe "C:\path\to\video.mp4"`. While the
player is in the foreground, moving the mouse changes the two-axis rating:
right/left changes valence and up/down changes arousal. The pointer is confined
to the player and hidden during active rating, then released on pause, focus
loss, stop, and close. The first movement after capture is ignored. A small
grid beside Flubber shows the current position. Arrow keys remain available;
Space pauses or resumes, and Escape stops the video. Moving to another app
while actively rating pauses the video and requires an explicit resume. The
SVG is rendered at physical display resolution on its own nominal
30 Hz clock. An independent 30 Hz worker publishes valence and arousal with
an LSL timestamp. The marker outlet emits `<video filename>_Start` and `_Stop`
around each run, plus observed `_Pause`, `_Resume`, `_Interrupt`,
`_BufferingStart`, `_BufferingEnd`, `_End`, and `_Error` events as applicable.
An `_Interrupt` marks loss of foreground while mouse rating was active;
`_Pause` follows when LibVLC reports its paused state. `_End` denotes natural
completion, while `_Stop` closes every run, including manual stop and error.

Each video run creates a unique `time_s,valence,arousal` CSV **in the same
folder as the played video**. That folder must be writable. The time column is a monotonic
30 Hz clock aligned to LibVLC's first advancing media time; it is not a
decoded-frame presentation timestamp. The CSV writer is independent of LSL.
Replaying in one process creates another CSV instead of overwriting the first.
The player does not write XDF; a separate Recorder can subscribe to its LSL
streams and store XDF elsewhere.

The player creates `%LOCALAPPDATA%\VLC_Flubber_Player\presets\default.flubber.json`:

```json
{"schema":"vlc-flubber-sidequest/v1","panelPercent":25,"stepPercent":10}
```

Place `<video stem>.flubber.json` beside a video or in that presets folder to
override the default. An adjacent preset wins over the shared folder; explicit
`--panel-percent` and `--step-percent` arguments win over both. A Recorder
experiment JSON supplies those explicit settings. The panel ratio means
panel height relative to the allocated video height; 25 makes the Flubber
area one-quarter as tall as the video area.

For Recorder control, `FlubberVLC.exe video.mp4 --arm` publishes its LSL
outlets and waits for a local `play` command. The Recorder subscribes before
playback, sends fullscreen, play/pause/stop/volume commands, monitors the
streams, and records XDF. The command port binds to `127.0.0.1` only. This
prototype remains a separate side project, outside the main Affect Research
Planner and Runner. Installed visual playback has been checked on one Windows
machine; timing, codec breadth, and research use need broader qualification.
