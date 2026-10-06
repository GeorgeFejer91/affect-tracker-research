# VLC Flubber player

This is the current native VLC Flubber player. It passes the original media
file to bundled LibVLC 3.0.20, displays video in an upper child window, and
renders the native SVG Flubber plus a two-axis rating grid in a lower surface.
No video frames are transcoded or copied through Flubber. This is a custom
LibVLC shell, not VLC's Qt window.

From startup, the player publishes `VLC_Flubber_Affect` with normalized
`[valence, arousal]` at nominal 30 Hz and `VLC_Flubber_Markers` as an irregular
string stream. Relative mouse movement changes the two-axis rating while the
player is foreground and playing. The pointer is hidden and confined during
active rating, then released on pause, focus loss, stop, and close. Arrow keys
remain available. Space toggles pause; Escape stops playback.
The relative-motion mapping adapts the interaction described by
[online-affect-rating](https://github.com/embodied-computation-group/online-affect-rating)
(MIT): one rating range spans 60% of the player height and each movement
event is capped at 150 units. Win32 raw mouse units can differ from browser
pointer-lock pixels across devices. Raw movement events are not stored.

Markers use the video filename followed by a fixed suffix: `Start`, `Pause`,
`Resume`, `Interrupt`, `BufferingStart`, `BufferingEnd`, `End`, `Error`, and
`Stop`. `Start` and `Stop` bookend each playback. The other markers describe
observed LibVLC state changes or loss of foreground during active rating.
State polling is at the UI's nominal 30 Hz, so sub-interval transitions can
be missed. The player owns these outlets; the separate Flubbercorder Recorder
subscribes and writes XDF.

The player independently writes a unique three-column
`time_s,valence,arousal` CSV **beside the played video**, including when no
Recorder is running. The video directory must be writable. CSV rows cover
playing time and exclude paused intervals; `time_s` is a monotonic 30 Hz clock
aligned to LibVLC's first advancing media time, not an exact decoded-frame
presentation timestamp. LSL samples continue while paused.

Build from `experiments/vlc-flubber/` with
`cargo build --release --locked --manifest-path libvlc-player/Cargo.toml`.
The executable expects sibling `vlc/libvlc.dll`, `vlc/plugins`, and
`svg/flubber_svg.dll`; `FLUBBER_VLC_DIR` and `FLUBBER_SVG_DLL` can override
these for local development. Run `FlubberVLC.exe VIDEO` or open the packaged
standalone player. An optional positional CSV path must remain in the video
folder. The `--arm` mode keeps the outlets live and waits for a loopback
`play` command from the separate Recorder; the endpoint also accepts
`pause`, `stop`, `volume 0..256`, `f on`, `is_playing`, and `quit`.

The pinned VLC runtime and installed-package evidence are in
[the side-project runbook](../README.md) and
[status record](../../../for-ai/75-VLC-FLUBBER-SIDE-QUEST.md). This remains
experimental and does not qualify the main suite for research use.
