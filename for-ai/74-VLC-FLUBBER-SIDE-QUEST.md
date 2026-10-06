# Native VLC Flubber side quest

Status 2026-10-06: **public experimental Windows VLC player and Flubbercorder
prerelease**, separate from the
approved Experiment Planner and Experiment Runner. The user explicitly asked
for this as an additional project. Passing its checks does not approve it as
part of the main suite or change P1–P7/R1 requirements, saved recipe formats,
LSL contracts, recording policy, or release qualification.

## Recorder-mirrored phone monitor, 2026-10-06

The phone page now mirrors the Rust experimenter console's state; it never
subscribes to LSL. The console receives sample and marker receipts from the
native XDF recorder that already subscribes to VLC. This removes the extra
preview inlet, which discovered VLC outlets but did not deliver samples in the
installed Tauri run. The XDF remains the authoritative LSL recording and the
VLC per-frame CSV remains its independent fallback. A native 300-frame short
trial using the updated recorder produced 300 XDF affect samples, 300 console
preview samples, and both exact filename markers.

The final standalone installer is 164,555,123 bytes, SHA-256
`41CA2A044BC6E94AB3172A757002B898621CE7B4FB0CEE7F06C371CE38B46A7B`.
Its installed player passed all seven manifest hashes; the affect and marker
LSL outlets were discovered and opened while VLC was idle with no video.
The final Tauri installer is 256,147,263 bytes, SHA-256
`2427CECCAFAE754A5D49AB5E134AEB267895EBDA6AFD052D43A92ADC9047B565`.
It installed successfully over the local validation installation. Installed
runner, recorder, player manifest, and bundled film hashes matched their
sources. A phone-controlled default-demo trial applied Start, Pause, Resume,
and Stop, showed 67 live affect samples and the exact
`dictator-3-study.mp4_Start`/`_Stop` markers, and reached Complete with a
closed XDF and 67 fallback CSV rows. The runner promotes XDF only after its
sample count matches that CSV and the exact markers are present.
Both assets are publicly available from the
[VLC Flubber native v0.1.0 release](https://github.com/GeorgeFejer91/affect-tracker-research/releases/tag/vlc-flubber-native-v0.1.0).
GitHub asset digests match the local hashes above, and unauthenticated HEAD
requests to both direct download URLs returned HTTP 200. This does not promote
the side project into the main Planner or Runner or establish research
qualification.

## Frame-matched sampling follow-up, 2026-10-05

The separate Rust launcher now probes the source's average frame rate as a
rational number, converts to constant frame rate at that rate, and passes the
exact numerator and denominator to the VLC filter. VLC writes one
`time_s,valence,arousal` CSV row and publishes one two-channel affect LSL
sample for each decoded frame of the **prepared clip's original-video
interval**. The five-second lead and two-second tail produce neither affect
rows nor affect LSL samples. For variable-frame-rate inputs, the rate is the
source's probed average and FFmpeg may duplicate/drop source frames to form
the prepared constant-rate clip; the claim is per prepared output frame.
CSV times are frame index divided by the exact rational rate. XDF keeps the
independent live LSL clock, so exact CSV/XDF timestamp equality is not claimed.

The standalone no-Python installer candidate is
`Flubber_VLC_Player_Setup_0.1.0_x64.exe`, 99,654,791 bytes, SHA-256
`429040EBEC706336BC9F06AE5D1857AF2F2609C7F70D5FF0F029EF54F3B15C10`.
Its fresh installation passed all seven manifest hashes. A 90-frame
`30000/1001` synthetic clip yielded exactly 90 VLC time-series CSV rows,
90 recorded XDF affect samples, and the exact filename Start/Stop markers.
The CSV ran from 0.000000 to 2.969633 seconds.

The separate no-Python Rust/Tauri NSIS candidate bundles this player, the
native XDF recorder, the simple JSON and locally held Great Dictator clip.
The locally installed candidate completed the same 90-frame fractional-rate
trial with 90 CSV rows, 90 XDF affect samples, and an XDF validated for both
exact markers. Its SHA-256 is
`5E03A8A92311ABCDBA8B6FD1DCDA44D2A1AF1941DFF73745DA09D21E01589B5A`.
An installed full Great Dictator run subsequently completed from this
candidate. The source has 7,632 frames at 30 fps; VLC saved exactly 7,632
CSV rows from 0.000000 to 254.366667 seconds. The XDF was promoted only
after the native recorder confirmed the same affect count, exact
`dictator-3-study.mp4_Start`/`_Stop` markers, and matching stream footers.
The first uncached preparation exited early; a direct player preparation
then succeeded, and the installed Tauri run passed using its cached media.
The cause of that first conversion failure remains undiagnosed. Installed
browser-to-native phone control and public release checks remain open. The
user has stated they have
redistribution permission for the clip. The old Python prerelease does not
represent these candidates.

A follow-up native controller check at `30000/1001` used a bounded 5 ms first
pull on each preview LSL inlet. It received 90 live affect samples and both
filename markers while the independent XDF recorder captured the same 90
samples and marker pair. The phone page was inspected at 390 px without
horizontal overflow; its Start command reached VLC. Installed phone control
through all transport commands remains a release check.

The user's main playback direction is FFmpeg conversion to a format the player
can reliably play while preserving the clip's content. The earlier proposed
player stack was abandoned. This side quest uses the same conversion idea to
reserve a bottom panel, then lets a **native VLC 3.0.20 filter** draw the moving
Flubber there. It is not a replacement for the main direction.

The current local side-quest source now generates a fresh SVG path per frame
inside the VLC filter and calls a bundled Rust `resvg` DLL in the same VLC
process for antialiased rasterization. This replaces the earlier C scanline
renderer. It also automatically writes a separate three-variable
`time_s,valence,arousal` CSV, one flushed row per video frame between video
start and stop, alongside the pre-existing event/marker CSV. The Rust
standalone launcher chooses both file paths if none is supplied. A 2026-10-05
focused check completed 180/180 frames at 640x360/60 fps and 72/72 at
1920x1080/60 fps with a 50% panel; a five-second full-HD run completed
300/300 frame samples and a video-end event. Two exported full-HD VLC output frames
show changing geometry and smooth edges; see the side-quest runbook and
evidence. This is native SVG rendering at the *video output's pixel size*.
Display-independent vector composition, full HTML/SVG setting parity,
input-to-photon latency, and broader Rust/Tauri recorder qualification remain
open.
The previous 0.1 public installer is a historical Python-based prototype, not
the requested new Rust/Tauri distribution.

An earlier `Flubber_VLC_Player_Setup_0.1.0_x64.exe` **local candidate** was a
99,665,240-byte, no-Python installer with SHA-256
`FD49103CCB6BF9B2D8D5093A2954D60D4E95B66011118327D2E91EFF81464E78`.
Its fresh installation verified all seven manifest hashes and had no Python
files. A three-second synthetic source produced 180 video-bounded
`time_s,valence,arousal` samples (0.000000–2.983333 seconds) and a final
`video_end` event. The installed idle player exposed both exact Flubber LSL
outlets before any video. An independent installed loopback received both
`installed sample.mp4_Start` and `_Stop` plus 51 affect samples. That receiver
joined during the five-second lead, so it does not prove complete affect
capture. The new `--arm` mode holds prepared playback while VLC exposes both
outlets and a localhost RC port. With both native-recorder subscription receipts
confirmed before RC `add`, a local XDF closed with 180 affect samples and
exactly one filename Start and Stop marker; stream footers matched those
counts. A fresh installation of the final candidate verified its seven
manifest hashes, contained no Python files, and passed the same prearmed
recorder/marker path. The installed visible player was opened locally for
inspection. The final fresh installation also confirmed bundled VLC, FFmpeg,
and liblsl notices. Final installed playback reproduced 180 video-bounded
samples; a separate synthetic audio clip retained its audio packets at the
five-second prepared-media offset. This installer has **not** been published
or qualified as a complete Flubbercorder suite.

## Goal and result

The additional [Flubbercorder side project](../experiments/vlc-flubber/flubbercorder/README.md)
puts the experimenter console, LSL/XDF recorder, VLC process control, and
optional phone controller around the native plugin. It uses a distinct
`flubbercorder-experiment/v1` JSON, independent of Planner master recipes.
VLC creates both LSL outlets as soon as it starts, before the original video
begins. The recorder must subscribe to each outlet during a prepared black
lead. The native filter draws a dynamic Flubber beneath the video, uses a
private affect command channel to avoid VLC seek hotkeys, publishes affect
samples and `<source filename>_Start`/`_Stop` markers, and writes a fallback
CSV independently. Flubbercorder checks exact marker labels in the recorded
XDF, with selected external streams also recorded by the native recorder.

On 2026-10-04, the [public experimental Windows prerelease](https://github.com/GeorgeFejer91/affect-tracker-research/releases/tag/vlc-experimentrunner-v0.1.0)
was built from source commit `40e8493f1443c484afbd85c881451c9f6b8ea512`.
The installed offline package completed a five-second H.264 source session
with 300 affect rows in VLC CSV, 300 affect samples plus both exact filename
markers in XDF, and right/up affect commands without video seeking. Installed
checks also passed for a missing required stream, selected external stream,
pause/resume, and early stop with a valid closed XDF. Desktop and 390-pixel
browser layouts rendered in current Edge and Chrome without page errors or
horizontal overflow. The installer SHA-256 is
`3732CBD718DF1BD17301B96437B902A992C152C1EEC6FBB72697317AB618572A`;
GitHub reports the same asset digest, and its unauthenticated download returned
HTTP 200. The new GitHub workflow was not dispatched because it is only on the
side-project branch; the installed checks were run locally. This is installed
software evidence for the specific synthetic clip, not broad codec, timing,
device, or research qualification.

The follow-up 0.2 **local candidate** bundles the identified 86,870,779-byte
Great Dictator study clip and [simple demo JSON](../experiments/vlc-flubber/flubbercorder/demo/great-dictator.json).
The installed app loads that recipe automatically when opened without an
explicit recipe. Its final local 195,373,424-byte installer has SHA-256
`2E0208E4F1FF277806BD06A7C73E9F69159BB3ABCECE5970A630A5228C8CDD2C`.
The installed candidate passed a real clip Start/early-Stop session with XDF,
CSV and exact `dictator-3-study.mp4_Start`/`_Stop` markers; a separate custom
JSON run still recorded 300 affect samples. Edge and Chrome rendered the
default-loaded desktop and narrow layouts without page errors or overflow.
A full natural completion of the 254-second bundled clip subsequently passed
with 15,264 matching CSV and XDF affect samples plus both exact XDF markers.
That historical candidate was **not publicly released** while redistribution
rights for the film clip were unconfirmed. The user has since stated they have
permission, as recorded in the newer section above.

The earlier standalone probe and its receipts follow below.

The bounded goal was to load a clip with a defined video-to-Flubber height
ratio; show video and a dynamic Flubber together inside VLC; map arrow keys to
continuous valence/arousal; export a live affect series; and, if feasible,
publish LSL affect samples and `video_start`/`video_end` markers to an external
recorder. The implementation and runbook are in
[`experiments/vlc-flubber/`](../experiments/vlc-flubber/README.md).

This is a Windows x64 native VLC plugin, not a web overlay or a separate
Flubber window. The launcher pads video with FFmpeg, then enables the filter.
The filter generates the project's circle-based Flubber SVG path per decoded
frame; the current Rust renderer rasterizes it inside VLC. It accepts VLC's
`key-pressed` arrow events, flushes per-frame and key events to CSV, and
optionally creates two liblsl outlets. The probe retains no
external LSL streams and does not write XDF; a remote recorder may subscribe.

## Verification and claim boundary

| Check | Observed result on 2026-10-04 |
| --- | --- |
| Native module build and discovery | MSVC build against verified VLC 3.0.20 headers; VLC recognized Flubber options. Final tested module SHA256 `62ECDFE987CD980E3D59DEF636A94BD55BCE80BAEF44C279F2E7E856177DA831`. |
| Video and dynamic drawing | 640x360 video plus 36-, 90-, or 180-pixel panels played. [Captured frames](../experiments/vlc-flubber/evidence/frame-000.png) from the 180-pixel panel and [frame 60](../experiments/vlc-flubber/evidence/frame-060.png) show a changing shape below the undistorted video. |
| Controls | Focused VLC output received all four arrow keys; CSV values moved by 0.10 on the expected axes and returned to zero. Neighboring frame samples continued. |
| Local export | CSV flushed `sample` rows and `video_start`/`video_end` rows; the launcher checked a clean end row. |
| LSL loopback | [Independent liblsl receipt](../experiments/vlc-flubber/evidence/lsl-loopback.json) against the final module: 477 affect samples, equal to CSV, monotonic timestamps, and exactly one start/end marker; 8.024-second LSL marker span versus 7.933-second last CSV frame. |

The probe demonstrates technical feasibility on this setup. It does **not**
establish zero dropped frames, precise audiovisual/LSL latency, seek handling,
multi-video session behavior, recorder-to-XDF integrity, installer portability,
cross-platform support, or research readiness. The CSV `video_ms` clock is
based on frame order of the converted clip; LSL uses its live local clock.
See the runbook for the exact restrictions and reproduction command.

**Ownership:** this concern is the isolated `vlc-flubber` experiment, outside
the product segment catalogue. It has no P1–P7 or R1 checklist completion to
claim and no saved Planner JSON contribution. Any later promotion into Runner
needs a new explicit product decision, Runner contract allocation, and the
applicable media, input, timing, LSL, recording, accessibility, and installed
qualification gates.
