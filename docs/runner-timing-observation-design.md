# R1 timing observation and benchmark design — 2026-09-12

This is the root-allocated R1 / RR-04, RR-05, RR-10 documentation-only timing
pass. Its deliverable is an instrumentation and comparison design, not an
implementation or qualification receipt. No logging, probe, marker change,
benchmark execution, new UI or experiment loop is included. Master3 intake
awaits a separate Main/S1 contract freeze and allocation.

## Authority and preserved behavior

Exactly one authoritative native execution timeline must govern occurrence
transitions, input admission, neutral reset and timing. The frontend projects
native state; its 100 ms poll and animation-frame callbacks are not another
experiment clock. Media timestamps must map explicitly into that native timeline;
a derived video must not acquire independent experiment authority.

Keep original recipe/source hashes, video and named-ISI IDs, ordered entry and
execution identities, P4 placement and P5 mappings. Preserve requested ISIs of
1750 and 3213 ms. Questionnaires remain mandatory and participant-paced; their
variable duration breaks fixed media blocks. Flubber remains live and separate
from encoded video. Before every ISI, withdraw input, complete its barrier,
clear queued/held/repeated input, reset authoritative x/y to zero and publish
neutral before interval admission. Project that native state into the hidden
preview before Presented. A stale input cannot undo the reset. Existing hidden,
input-disabled ISIs do not imply freezing neutral animation.

## Verified source and existing seams

Read-only inspection used Main commit `791c205d98c1d7c69935bc9405b68b3ba9d43b06`.
This document is based on later clean Main `29f21158576fe43d124b396af302b5c5acc77f9d`;
line references below describe the inspected source, not a timeless API promise.

| Existing location | Observation available | Limit |
| --- | --- | --- |
| `src-tauri/src/research_native_media/gst_actor.rs`, `connect_signals` around 830 | Play state, EOS and position callbacks | Main-context-delivered observations, not original sink emission or physical display timestamps |
| Same file, `apply_admitted_signal` around 608 and `publish_status_snapshot` | Generation-fenced admission and status publication | Downstream of callback dispatch; no frame presentation receipt |
| `research_runner_master/worker.rs`, `prepare_video`, `reconcile`, `stop_media`, `next` | Requests/returns and worker observation of Playing/Ended | Current VideoStart/VideoEnd follow state observation |
| Same worker, interval Presented branch around 243 and `reset_response` around 704 | Quiescence, neutral publication, interval admission/deadline | State order can be attested independently of frontend polling |
| `runner/src/master-protocol.js`, `poll` | Status receipt, render completion, two rAF callbacks, Presented send | Scheduling handshake only; 100 ms is neither measured delay nor an upper bound |
| `research_native_media/gst_actor/diagnostic.rs`, `actor_phase`/`trace` | Existing test-only, explicitly opted-in diagnostic containment | Current stdout trace is not suitable for per-frame work |
| `research_native_media/live_frame.rs`, `capture` | JPEG projection and `position_estimate_ms` | Snapshot work can approach/exceed 100 ms; not onset timing or a continuous timing sampler |

Current Prepare retires/tears down the old player, creates a new GstPlay,
requests PAUSED and returns Preparing. It does not implement a ready next-item
queue. Neither pre-rolled sequencing nor compiled fixed blocks is implemented
by this design.

## Smallest proposed diagnostic slice

Use the existing test-only containment, with a private bounded trace collector.
At callback receipt, actor admission and worker observation, capture a high
resolution native monotonic timestamp and a trace-local sequence. Preserve
run/attempt, plan/source hashes, entry/video/ISI/execution IDs and native media
session/generation. Do not log participant questionnaire answers.

Record these transitions, without altering control flow:

1. Prepare request/receipt, Play request/return, callback receipt, admitted state,
   worker Playing/Ended observation, Stop request/ack and next-state publication.
2. Quiesce begin/barrier completion, cleared pending/held input, native neutral
   reset, neutral publication while AwaitingPresentation, admission, deadline
   and observed expiry.
3. Frontend poll request/response, native mapping applied to the preview, each
   real rAF callback, Presented send and native receipt.

Avoid synchronous formatting or disk output on callback/render paths. A future
collector must admit compact records without blocking, flush outside measured
transitions, count losses and invalidate incomplete timing evidence. Do not put
per-buffer records into the existing reliable lifecycle signal queue (capacity 256)
or weaken its failure behavior. Measure instrumentation overhead separately.
This is a proposal only; this pass adds no collector or per-frame logging.

## Optional buffer-observation tier, still not presentation

Locally installed pinned Rust sources expose safe `Play::pipeline()`
(`gstreamer-play` 0.25.0, `src/auto/play.rs:126`) and
`PadExtManual::add_probe/remove_probe` (`gstreamer` 0.25.3, `src/pad.rs:202/221`).
After native-owner review, a diagnostic could observe BUFFER and SEGMENT/EOS on
the actual selected video sink's sink pad without replacing the renderer.
Capture buffer PTS/duration, segment-to-running-time mapping, pipeline clock and
base-time, and local monotonic observation. This establishes buffer arrival or
readiness, not sink render, compositor delivery, scanout or physical onset.

Sink discovery and probe lifetime are unimplemented. If the sink cannot be
observed safely, report the missing tier rather than substituting a sink. Do
not take over GstPlay's bus consumer. Any supplementary QoS observation needs a
verified nonconsuming path; absence of a QoS message does not prove no drops.
Retire generation and remove probes before teardown. No HWND exposure, raw
pointer, new project unsafe boundary or production contract is proposed.

## Clocks and measurements

Keep native monotonic, JavaScript `performance.now`, GStreamer running-time and
LSL clock domains distinct. Future bracketed clock-pair observations must retain
mapping uncertainty and account for pauses and media-generation changes. Do not
subtract unrelated timestamps or backdate observations to planned deadlines.
A finer numeric timebase does not establish finer physical display timing.

Report callback-to-admission-to-worker delay, publication-to-UI-to-Presented delay,
requested versus native interval duration, and observed EOS-to-next-Playing gap.
Name the last metric a state-observation gap, not visible ISI. Buffer arrival and
readiness metrics form a separate evidence layer. Physical video offset/onset
requires synchronized photodiode or independently timed high-speed display
measurement later. Hidden neutral reset is an ordering invariant, not a paint.

## Candidate comparison

| Arm | What it can reduce | Work and limits |
| --- | --- | --- |
| Current fresh Prepare/Play baseline | Nothing assumed | Retain measured preparation, stop, handshake and observation delays |
| Prepared native sequence, unimplemented | Ahead-of-time readiness could avoid file-switch delays | Requires native-owner scheduling/readiness/lateness design under the single native timeline |
| Pre-rendered fixed video/ISI block, unimplemented | Removes internal file switches | Requires explicit encoding/frame/audio policy and original-occurrence-to-derived-PTS mapping; not display timing proof |

Split candidate fixed blocks at questionnaires. Preserve live Flubber and its
original occurrence transitions in both candidates. A diagnostic-only derived
asset manifest would retain source and output hashes, encoding profile, original
IDs, PTS/frame boundaries, rounding differences, audio boundaries and source-image
placement within any canvas. It is not a new accepted master field or capability.

A later finite matched trial matrix should hold source/master, viewport/display,
refresh, runtime, audio and input workload constant. Compare cold/warm cache,
idle/load, pause/resume, late readiness/stall, strong affect before ISI, first and
consecutive ISIs, and stop/recovery. No extra experiment loops or UI are requested.
Report signed errors, sample counts, tails, failures and missing observations;
separate encoding quantization, software scheduling and physical error. Compare
trace-enabled versus disabled overhead. Do not select an arm from average
Playing/EOS jitter alone. Hidden diagnostics can assess decode/readiness only.

## Measurement provenance and nonclaims

Root owns `docs/runner-playback-timing-assessment.md` in commits `767cd7c` and
`e701b078`, retained at
`D:/GitHub/affect-tracker-research-timing-assessment-root/docs/runner-playback-timing-assessment.md`.
Collect those commits separately with root/Main; this pass does not copy their
older board or goal snapshots. The following measurements are attributed to that
assessment, not newly executed or independently reproduced in this pass.

Root's offline 60 fps diagnostic encoded requested black 1750 ms / white 1000 ms /
black 3213 ms as 1750 / 1000 / 3216.6667 ms. The final requested 3213 ms remains
unchanged: +3.6667 ms is an encoding result, not a silent replacement policy.
The 30 fps result was 1766.6667 / 1000 / 3233.3333 ms. Neither proves physical timing.

Evidence directory: `D:/GitHub/.affect-checks/prerender-intervals-20260912-201700/`.
`result.json` SHA-256:
`826253958743814bfa15b9c251791cf4974a6c3414c2d263192a7d1255779794`.
Retained external script `D:/GitHub/.affect-checks/inspect-prerender-intervals.mjs`
SHA-256: `9d292fb97acb819303c21c51b1d8f3a2fac062cb82c44e6f1a805499c3a92458`.
The assessment identifies local FFmpeg 2025-02-06-git-6da82b4485-essentials_build;
it is not adopted or qualified as a product dependency.

Exact Great Dictator source SHA-256:
`b5327e7465ec92a4c93f3236a1ebab4556cdf508e24eafe6c593eac1e13afd49`.
Root's `real-source-probe.json` SHA-256:
`1daec4702c6922270e7e269b3fe3c2d1ce96c56f49f48f4c31cb934bc7e2e401`.
Its video 254.400 s, audio/container 254.405 s and earlier native 254406 ms are
separate observations. Do not silently trim audio or replace accepted P1 duration.
Native receipt: `D:/GitHub/.affect-native-diagnostic-build/attempt-06/stdout.log`,
SHA-256 `25435e4fa75e132e77c3e3fb2feb6b7d4a39e1893464c716a35b12cd0dd5031e`.

Neutral components `acac539` and `bfc3746` supply bounded worker/preview tests;
headless preview receipts and test scheduler substitutions are described in the
root assessment and Runner component documents. They are not native/physical
execution evidence. The actual CLI-authored master and independent XDF goal
remain separately gated in for-ai/69.

## Eventual XDF requirement

Current markers contain no reset-coordinate payload and sampling is disabled
during ISIs. Consequently XDF alone cannot yet attest neutral reset. An eventual
explicitly allocated/versioned evidence contract must let an independent reader
bind native reset values and ordering to the exact occurrence and interval,
retaining actual observation times, clock mapping/uncertainty and incomplete
records. It must not infer reset from planned timing or missing samples. This
pass specifies the requirement, not its wire schema; it changes no public
marker, LSL stream, recorder policy, qualification flag or master reader.
