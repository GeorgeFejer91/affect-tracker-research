# Video and ISI timing assessment — 2026-09-12

The researcher asks whether synthesizing the video sequence with FFmpeg would
avoid timing errors from repeated starts, and explicitly requires Flubber to
reset to neutral before every ISI. This is a Backend Verification design review
and offline encoding diagnostic. It does not select or implement a new playback
backend, change recipe versions, enable qualified Start, or establish display
timing. The actual Planner → Runner → XDF goal remains open.

## Decision and scope

Recommend one native presentation timeline with content prepared ahead of its
deadline. Benchmark an optional pre-rendered asset for each fixed video/ISI block
against native pre-rolled playback before selecting the implementation. A whole
experiment cannot be a fixed-duration movie when questionnaires wait for answers.
Flubber remains an interactive renderer. Its position, neutral reset and recorded
state must follow the same authoritative occurrence transitions.

One file removes file-switch operations inside that file. It does not guarantee
on-screen onset precision or remove decoder stalls, dropped frames, display
refresh quantization, output latency or mismatched marker timestamps. No option
has been measured as the most stable on the final installed Runner yet.

## Verified current source

Runner checkpoint `893f320e31a849ecef609aa89d647f261977c649`:

- `runner/src/master-protocol.js`, `start`/`poll`: status polling every 100 ms;
  the awaiting-presentation handshake waits for two requestAnimationFrame
  callbacks before sending Presented. This is a renderer scheduling handshake,
  not proof of physical presentation.
- `research_runner_master/worker.rs`, `action`/`tick`: the interval's native
  deadline begins on Presented. When it expires, IsiEnd precedes `next()` and a
  new awaiting-presentation handshake.
- `prepare_video`/`reconcile`: each video obtains a new grant and media Prepare,
  then Play. VideoStart is timestamped when the worker observes native Playing;
  VideoEnd is timestamped when it observes Ended. These are state observations,
  not sink presentation timestamps. Stop and the next presentation handshake
  follow Ended.
- `next()` reconstructs ResponseState, but the public current-valence/arousal
  fields were not synchronously reset there. The Runner owner has the explicit
  neutral-before-ISI follow-up, including first and consecutive ISIs and stale
  held inputs. Completion requires its separate source/test receipt.

Subsequent Runner handoff `acac5396ebf1f7660d18e34b12e6984b30632ba8`
synchronizes those coordinates and completes the input dispatch barrier before
every ISI admission. Six focused worker checks pass; root inspected the diff.
Main collected that worker component in `4818856`. Actual assembled execution
and XDF validation remain open; this is not an on-screen timing measurement.

The Runner owner's independent source review then found that the interval
renderer sent only `hideFeedback: true`, leaving its hidden preview's previous
non-neutral mapping cached. Follow-up `bfc3746e19921982cf5e9c7eab492d6378659e4f`
also projects the native coordinates through the existing feedback mapper before
hiding the interval display. It does not substitute frontend zeros for native
authority. Root inspected the one-line production delta. Sixty focused neutral
checks pass within the headless browser harness, observing real preview cache
and DOM state before its synthetic Presented call, including first, consecutive,
video-following ISIs and the next video's neutral start. The existing hidden
interval policy remains unchanged. This renderer component still requires
integration and actual native execution; hidden state is not a visible paint.
Receipt: `D:/GitHub/.affect-runner-master-build/runner-isi-preview-ui-03/receipt.json`.

The measured-interval claim must distinguish the authored ISI timer from the
visible gap between video offset and subsequent video onset. The current path
adds unmeasured stop, UI, IPC and prepare delays outside the timer. Polling and
animation-frame periods are neither measured end-to-end delays nor upper bounds.
Reducing a poll interval alone would not repair this authority problem.

Native actor review at `c87bd95d00cbd884792f809ca34365e27a93d7be` likewise finds
state and position callbacks, with no implemented sink/presentation timestamp
observation. Native qualification and lifecycle work remain separate prerequisites.

## Options to compare

| Approach | Benefit | Limitation and qualification work |
| --- | --- | --- |
| Fresh Prepare/Play for each item | Preserves original independent assets | Current implementation adds variable transition gaps; inadequate evidence for precise stimulus-to-stimulus ISIs |
| Pre-roll/queue within a continuous native timeline | Keeps source assets and permits dynamic blocks without mandatory re-encoding | Requires tested ahead-of-time readiness, timestamp mapping, bounded queues and late/failure handling; generic gapless APIs are not proof of this app's behavior |
| Offline render of each fixed video/ISI block | Encodes internal boundaries into one media timeline and removes internal file switches | Requires explicit frame policy, A/V boundary verification, original-to-derived identity mapping, caches per variant and new capability/version handling; display and marker timing still need measurement |

GStreamer documents a shared pipeline clock, buffer timestamps and segment
mapping, with running time paused during PAUSED. Its gapless design prepares the
next item before switching and reuses compatible decoding components. These
support the proposed scheduling direction; they do not establish that this
project's current GstPlay actor already implements queued blocks.
[Clock documentation](https://gstreamer.freedesktop.org/documentation/application-development/advanced/clocks.html),
[gapless design](https://gstreamer.freedesktop.org/documentation/additional/design/playback-gapless.html).

FFmpeg's concat filter requires common stream properties, timestamp-zero segment
inputs and explicit resolution conversion. Different frame rates can produce
variable-frame-rate output; the longest related stream can determine a segment
boundary. Its concat demuxer also warns about gaps and erroneous input durations.
Therefore a generic stream-copy concat command is not a timing qualification.
[Filter documentation](https://ffmpeg.org/ffmpeg-filters.html#concat),
[demuxer documentation](https://ffmpeg.org/ffmpeg-formats.html#concat-1).

## Offline experiment actually performed

An external Node diagnostic invoked the existing local FFmpeg executable with
three synthetic lavfi inputs: black 1.750 s, white 1.000 s and black 3.213 s.
It reset input timestamps, concatenated them, encoded lossless H.264 and used a
60000-unit MP4 video timescale. It independently read ffprobe timestamps and
decoded every frame to gray pixels to identify the black/white boundaries.
No real stimulus was replaced or re-encoded, and no app window was launched.

| Nominal rate | First black interval | White interval | Final black interval | Total frames |
| --- | --- | --- | --- | --- |
| 30 fps | 53 frames = 1766.6667 ms | 30 frames = 1000 ms | 97 frames = 3233.3333 ms | 180 |
| 60 fps | 105 frames = 1750 ms | 60 frames = 1000 ms | 193 frames = 3216.6667 ms | 358 |

These are the actual results of this straightforward duration-based generation,
not a universal FFmpeg rounding rule or a comparison of playback jitter. A
deliberate nearest-frame policy could choose different counts. At exactly 60 Hz
with refresh-locked transitions, 3213 ms lies between 192 refresh periods
(3200 ms) and 193 (3216.6667 ms). A finer container timebase or VFR timestamps
cannot make a fixed-refresh display update between refreshes. The actual monitor
refresh rate and presentation behavior must be measured, not inferred from FPS.

Evidence directory:
`D:/GitHub/.affect-checks/prerender-intervals-20260912-201700/`.
The observation time in `result.json` is `2026-09-12T19:16:09.322Z`.
Its SHA-256 is
`826253958743814bfa15b9c251791cf4974a6c3414c2d263192a7d1255779794`.
The retained script `D:/GitHub/.affect-checks/inspect-prerender-intervals.mjs`
has SHA-256
`9d292fb97acb819303c21c51b1d8f3a2fac062cb82c44e6f1a805499c3a92458`.
Exact executable hashes, commands, per-frame probes and output hashes are retained.
FFmpeg was the local `2025-02-06-git-6da82b4485-essentials_build`; it has not been
adopted, bundled or qualified as a product dependency.

Read-only ffprobe of the exact Great Dictator source additionally reports
7632 video frames at 30 fps, video stream duration 254.400 s and audio/container
duration 254.405 s. Source bytes have SHA-256
`b5327e7465ec92a4c93f3236a1ebab4556cdf508e24eafe6c593eac1e13afd49`.
The retained `real-source-probe.json` in the same evidence directory binds that
source, the ffprobe executable and exact invocation; its SHA-256 is
`1daec4702c6922270e7e269b3fe3c2d1ce96c56f49f48f4c31cb934bc7e2e401`.
Earlier native decode evidence reports 254406 ms in
`D:/GitHub/.affect-native-diagnostic-build/attempt-06/stdout.log` (SHA-256
`25435e4fa75e132e77c3e3fb2feb6b7d4a39e1893464c716a35b12cd0dd5031e`).
The accompanying `process-receipt.json` binds the identical clip and diagnostic
artifact (SHA-256
`98b10c69896f35890d5abbd9fcb1e1b5a49046af3eea11e10067d6f5f2f417e8`).
These are different observations. Do not replace the actual P1 duration or
silently shorten audio to make a derived timeline fit a convenient video count.

## JSON, Flubber and XDF requirements

The original modular master remains experiment authority. If a compiled-media
capability is later selected, design explicit versioned producer/consumer
semantics before extending the current strict master. Retain each original video
and named ISI ID, source hash, occurrence order and requested duration. Bind each
derived asset by hash and record its encoding profile, frame/PTS boundaries,
rounding differences and original-image placement within any padded canvas.
The renderer must still reproduce the accepted P4 centre/fit geometry.

Before each ISI, stop accepting old input, clear held/repeated/pending input,
reset authoritative valence/arousal to zero and publish that neutral state before
interval admission. Keep the existing disabled-input-during-ISI policy; the new
request does not independently require freezing the neutral animation. Verify
the first ISI, consecutive ISIs and the transition from a strongly non-neutral
video state. A queued stale input must not immediately undo the reset.

The XDF must distinguish planned timing from observed events. A future timing
observation contract should bind occurrence/video/ISI IDs to presentation-clock
position, actual event timestamp in the LSL clock domain, clock mapping, lateness,
pauses, drops and completion state. Never backdate an observed event to its
planned deadline or treat queried playback position as display confirmation.
Current markers have no reset-coordinate payload and no affect samples during
ISIs, so XDF-only neutral-reset attestation is an open contract gap.

LSL clock synchronization cannot correct an event that was timestamped at the
wrong stage of presentation. Its documentation requires known device delays to
be measured and documented; foreign timestamps must not be passed as LSL clock
values without a valid mapping.
[LSL timestamp guidance](https://labstreaminglayer.readthedocs.io/info/faqs.html#timestamp-accuracy).
For physical onset qualification, compare software observations against a
photodiode or equivalent independently timestamped display measurement.
[Psychtoolbox photodiode implementation](https://github.com/Psychtoolbox-3/Psychtoolbox-3/blob/master/Psychtoolbox/PsychHardware/PsychPhotodiode.m).

## Next slice and evidence limits

Integrate and exercise both neutral-reset components and finish the native
lifecycle/qualification prerequisites. Instrument actual transition milestones and compare prepared
native playback with a compiled fixed block on the same candidate, sources,
viewport and display. Report actual boundary errors and tails under load, stalls,
pause/resume and recovery; retain failures instead of repairing their timestamps.
The original 1750/3213 ms request remains unchanged until an explicit timing
policy is agreed. No silent rounding is accepted in the production recipe.

Planner/Runner screenshots must use the same saved master and viewport and show
the real native video plus Flubber. DOM geometry and a separate decoded video
JPEG are useful component evidence, but their combination is not an actual
whole-window capture. Screenshots establish arrangement, not temporal precision.
The applicable native, installed and physical gates in for-ai/30 and40 remain.
