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

This is a feasibility test, not a released player. It has a loopback Recorder
command endpoint but no playlist, ordinary VLC Qt menus, or installer. LibVLC
uses VLC's normal decoder and video output path; the prototype does not
transcode or modify video pixels. Package and installed-machine quality gates
remain open. The CSV writer is separate from the LSL sampler. A bounded queue
prevents disk writes from blocking LSL; a writer or renderer failure stops
playback. CSV files are created without overwriting existing files, and a
second play in the same process gets a `.repeat2.csv` suffix.

The sampler and SVG workers use high-resolution Windows timers. The process
requests a 1 ms timer period and disables Windows 11's timer and execution
throttles while the player is running, then restores system-managed policy on
exit. This is needed for the outlet to stay at 30 Hz when the player window is
hidden or covered. In one hidden idle probe, an independent LSL inlet received
241 samples over 7.999 seconds (30.002 Hz), with a 33.68 ms 95th-percentile
interval, a 33.86 ms worst interval, and no interval over 50 ms. In a separate
Recorder-controlled original-file video run, XDF contained both filename
markers and 182 affect samples; the video-bounded CSV contained 120 rows from
0.033 to 4.000 seconds. These are local software observations, not a Windows
real-time guarantee or an installed-machine quality result.

Build with `cargo build --release --manifest-path libvlc-player/Cargo.toml`.
The executable expects sibling `vlc/libvlc.dll`, `vlc/plugins`, and
`svg/flubber_svg.dll`; set `FLUBBER_VLC_DIR` and `FLUBBER_SVG_DLL` to override
those paths for development. Run `flubber-libvlc-prototype.exe VIDEO [CSV]`.
Generate VLC's `plugins/plugins.dat` with its bundled `vlc-cache-gen.exe`
before packaging; the test VLC directory lacked that cache initially. The
player deliberately ignores the user's stock VLC configuration.

Left/right and up/down adjust valence/arousal, Space pauses or resumes, and
Escape stops. The player window can open with no video; LSL is then live while
idle. A video path on the command line starts playback. `--arm` waits for a
loopback `play` command from Flubbercorder; the same endpoint accepts `pause`,
`stop`, `volume 0..256`, `f on`, `is_playing`, and `quit`. The window remains
visible because hidden LibVLC video output did not decode in the local test.

`cargo build --release --bins` also builds `probe.exe`. Start that receiver
before playback to check 30 Hz delivery and the filename markers. For bounded
local runs, set `FLUBBER_TEST_EXIT_MS` to 1000–30000. The prototype's window
must be visible for video-output checks; `FLUBBER_TEST_HIDDEN` only tests idle
LSL startup.
