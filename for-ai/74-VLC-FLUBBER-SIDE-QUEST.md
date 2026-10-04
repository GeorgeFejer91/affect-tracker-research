# Native VLC Flubber side quest

Status 2026-10-04: **experimental feasibility probe plus separate Flubbercorder
Windows release candidate**, separate from the
approved Experiment Planner and Experiment Runner. The user explicitly asked
for this as an additional project. Passing its checks does not approve it as
part of the main suite or change P1–P7/R1 requirements, saved recipe formats,
LSL contracts, recording policy, or release qualification.

The user's main playback direction is FFmpeg conversion to a format the player
can reliably play while preserving the clip's content. The earlier proposed
player stack was abandoned. This side quest uses the same conversion idea to
reserve a bottom panel, then lets a **native VLC 3.0.20 filter** draw the moving
Flubber there. It is not a replacement for the main direction.

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
explicit recipe. Its 195,369,013-byte installer has SHA-256
`42EFCB11BC2D38C2E53D7658EE5540B0C088882CD2F5C7F57546AB3EB988BF21`.
The installed candidate passed a real clip Start/early-Stop session with XDF,
CSV and exact `dictator-3-study.mp4_Start`/`_Stop` markers; a separate custom
JSON run still recorded 300 affect samples. Edge and Chrome rendered the
default-loaded desktop and narrow layouts without page errors or overflow.
This candidate has **not been publicly released**: redistribution rights for
the film clip must be confirmed first.

The earlier standalone probe and its receipts follow below.

The bounded goal was to load a clip with a defined video-to-Flubber height
ratio; show video and a dynamic Flubber together inside VLC; map arrow keys to
continuous valence/arousal; export a live affect series; and, if feasible,
publish LSL affect samples and `video_start`/`video_end` markers to an external
recorder. The implementation and runbook are in
[`experiments/vlc-flubber/`](../experiments/vlc-flubber/README.md).

This is a Windows x64 native VLC plugin, not a web overlay or a separate
Flubber window. The launcher pads video with FFmpeg, then enables the filter.
The filter rasterizes the project's circle-based Flubber geometry per decoded
frame, accepts VLC's `key-pressed` arrow events, flushes per-frame and key
events to CSV, and optionally creates two liblsl outlets. The probe retains no
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
