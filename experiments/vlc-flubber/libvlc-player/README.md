# LibVLC separated-surfaces prototype

This isolated Windows prototype tests original-file LibVLC playback in an upper
child window, with a separately clocked native SVG Flubber panel below. Rust
publishes `VLC_Flubber_Affect` at 30 Hz from application startup and emits
`VLC_Flubber_Markers` at the beginning and end of video playback. A three-column
`time_s,valence,arousal` CSV is bounded by video playback. `time_s` is a 30 Hz
monotonic elapsed clock aligned to LibVLC's first advancing media time, not a
per-decoded-frame presentation timestamp. LSL supplies the sample timestamp;
its data channels are valence and arousal. The existing VLC 3
video-filter player and public installers are unchanged.

This is a feasibility test, not a released player. It has no Recorder command
endpoint, playlist, ordinary VLC Qt menus, or installer. LibVLC uses VLC's
normal decoder and video output path; the prototype does not transcode or
modify video pixels. Package and installed-machine quality gates remain open.
The prototype's CSV and LSL writes share one sampler thread; independent
fallback recording still needs a separate writer before release.

Build with `cargo build --release --manifest-path libvlc-player/Cargo.toml`.
The executable expects sibling `vlc/libvlc.dll`, `vlc/plugins`, and
`svg/flubber_svg.dll`; set `FLUBBER_VLC_DIR` and `FLUBBER_SVG_DLL` to override
those paths for development. Run `flubber-libvlc-prototype.exe VIDEO [CSV]`.
Generate VLC's `plugins/plugins.dat` with its bundled `vlc-cache-gen.exe`
before packaging; the test VLC directory lacked that cache initially. The
player deliberately ignores the user's stock VLC configuration.
Left/right and up/down adjust valence/arousal, Space pauses or resumes, and
Escape stops. The player window can open with no video; LSL is then live while
idle. A video path on the command line starts playback.

`cargo build --release --bins` also builds `probe.exe`. Start that receiver
before playback to check 30 Hz delivery and the filename markers. For bounded
local runs, set `FLUBBER_TEST_EXIT_MS` to 1000–30000. The prototype's window
must be visible for video-output checks; `FLUBBER_TEST_HIDDEN` only tests idle
LSL startup.
