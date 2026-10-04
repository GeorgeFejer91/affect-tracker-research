# Native VLC Flubber side quest

Status 2026-10-04: **experimental feasibility probe**, separate from the
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
