# Neutral before every ISI

## Hidden preview continuation

R1/RR-10 continuation from `acac539` applies the native status coordinates through
`runnerMasterFeedbackState` in the interval branch before `hideFeedback:true`.
Previously that branch changed only visibility, leaving cached preview coordinates
and mappings from the video. No renderer-authored zero overrides native authority;
the preceding native invariant supplies neutral. Hidden/input-disabled intervals,
animation behavior, recipe, sampling and markers are unchanged.

The existing full app headless harness now includes first, consecutive and
video-following ISIs plus the next video. At the actual mocked Presented command
it checks hidden SVG cursor coordinates, idle color, and the actual preview
closure's cached x/y and six P5 mapping values. A test-only esbuild observer reads
that closure without changing its calculations or production API. Strong video
coordinates are observed first, then neutral values before interval admission.
This establishes hidden preview state/DOM updates, not a visible Flubber frame or
physical compositor/presentation timing.

All six harness cases pass in `runner-isi-preview-ui-03/receipt.json` under
`D:/GitHub/.affect-runner-master-build/`; Runner build/boundary verification also
passes (`runner-isi-preview-build.log`). The first attempt's animated SVG path
inequality was not a reliable hidden-renderer assertion and was replaced by
direct cached-state observation; the second attempt rejected a test-plugin regex
flag unsupported by esbuild. Both failed logs are retained; production remains
the single interval projection change. Native replies and sequence advances are
synthetic, and no desktop app was launched.

The user's 2026-09-12 invariant requires neutral Flubber coordinates before every
interstimulus interval. RR-04/RR-05 implements this in the native master worker.
`next()` already replaced the response state but previously left its public
coordinates stale until a later tick. It now resets both together.

Every interval's Presented action additionally completes the native input
dispatch barrier, clears the final queued digital/absolute release and coalesced
state, replaces the P5 response state (including held/repeat/pulse state), and
publishes zero valence/arousal with input inactive while still awaiting interval
admission. Only then does it enter Interval, establish its deadline and emit
IsiStart. Input remains disabled during the ISI. No animation freeze or playback
strategy change is introduced. Clearing the mailbox does not erase its latched
input failures.

Focused tests inject non-neutral state into the actual worker and inspect it at
the call to the existing observation emitter, before IsiStart is recorded. They
cover first ISI, consecutive ISIs including zero duration, the next() boundary
after a video, and stale absolute/coalesced input. They inspect authoritative and
published coordinates, input phase, mailbox contents and movement after repeat
deadlines. Test probes are excluded from production. Sources and input/media
authority are synthetic; this is ordering evidence, not a physical paint test.

All six focused worker tests pass in `runner-isi-neutral-native-final.log` under
`D:/GitHub/.affect-runner-master-build/`. The initial 5/6 run selected an interval
as the test's supposed preceding video; the test now discovers an actual adjacent
video/ISI pair. That correction changed no production logic. Main-approved
test-only lib registrations are excluded from delivery; the retained
`runner-isi-neutral-test-only-registration.patch` has SHA-256
`d2032c170fd4b4420f67bd1928379f26c1aa453de19e5c1bc6dcf55a461214bc`.

## Recording and visible timing limits

The existing XDF marker schema contains no neutral-coordinate payload, and rating
sampling is disabled during ISIs. It cannot independently attest the reset state
or physical screen paint. This patch adds no marker fields, sample rows, stream
schema, reset event or completion claim. A versioned reset attestation would need
separate shared contract agreement and matching independent reader checks.

The current visible video-offset-to-next-onset gap is not simply the authored
ISI duration. Source inventory:

- The worker polls native status and observes Ended, then stops media and calls
  next(). Its existing marker uses worker observation time.
- `NativeMasterProtocolAdapter` polls at 100 ms and waits two animation frames
  before sending Presented. The native interval deadline starts there.
- After the interval deadline, another frontend polling/render/Presented cycle
  precedes native prepare/play for the next video. Preparation/decoding adds time.

Thus a correct interval deadline alone cannot establish visible gap precision.
This neutral-reset patch does not remove those stages or qualify timing.

## Proposed next bounded timing pass (not implemented)

First instrument a local diagnostic trace with native monotonic timestamps for
EOS observation, stop request/acknowledgement, renderer readiness/Presented,
interval admission/deadline, next-media preparation readiness, play request and
observed Playing/first-frame evidence when the actor exposes it. Preserve the
distinction between observed state and physical display onset; use synchronized
capture for the latter. No diagnostic should be represented as an LSL scientific
event without an agreed versioned contract.

Then coordinate native-player/Main ownership for a pre-ready next-video handoff
during the black interval, with the native deadline controlling release only
after media and presentation readiness. Late readiness must remain an explicit
measured failure/gap, never a shortened or falsely qualified interval. That pass
must settle actor preparation, frame visibility and notification semantics before
implementation. FFmpeg pre-rendered continuous blocks remain a separate research
option; no playback strategy change is authorized by this proposal.

## Authored tiny-grid screenshot audit

The locations fixture selects P5 `presentation.renderer: grid`, not Flubber.
Its P4 projection requests a 10.935 × 10.935 px feedback box at
(954.5325, 755.9325) on the 1920 × 1080 viewport. The actual app DOM measured
10.921875 × 10.921875 px at (954.53125, 755.921875), within CSS rounding.
The 1 px border leaves an 8.921875 px grid, matching the tiny square screenshot.
The grid SVG uses `0 0 100 100`; the canvas backing store is 72 × 72.
The Flubber SVG has computed `display: none`, zero visible bounds and a populated
2880-character path. This is the authored grid layout, not a Flubber geometry
regression. Preserve the adversarial fixture and do not force another renderer.

Evidence: `D:/GitHub/.affect-runner-master-build/runner-render-geometry-02/receipt.json`
records actual DOM/SVG/canvas measurements. All six headless app cases pass
(130 checks). These synthetic projections establish geometry correspondence only;
they do not qualify native playback or provide a representative visible-Flubber
capture. The initial audit assertion incorrectly read an HTML `hidden` property
from an SVG; the corrected assertion checks computed display. The failed receipt
is retained in `runner-render-geometry-01`.

## Representative synthetic Flubber projection

Run the same harness with trailing `1938,1176 flubber`. It preserves the grid
fixture on disk and derives a separately labelled synthetic recipe with the
existing strict Planner compiler/serializer. Explicit changes: reference box
60 by 60 percent, centre 50/35, feedback offset 0/75, side24, minimumgap3;
1920 by1080 viewport remains exact. P5 selects visible Flubber. All other fixture
values, including portrait reference source, mappings, halo and colours remain
explicitly inherited, not replaced with new defaults. Therefore this is not the
CLI-authored real-video mock.

Four cases (324 checks) record neutral, strong(.9,-.8), hidden-neutral ISI and
next-video-neutral DOM/SVG geometry and screenshots. P4 resolves to87.48px at
916.26/820.26; actual stage87.46875px at916.25/820.25; visibleSVG85.46875px.
Each state's eight mapped values match the production mapping; strong changes
actual SVG path and colour. Neutral animation phase may differ across captures.
The original six grid cases still pass130checks.

Evidence directory: `D:/GitHub/.affect-runner-master-build/runner-flubber-visible-04`.
Images: `flubber-neutral.png`, `flubber-strong.png`, `flubber-isi.png`,
`flubber-next.png`; measurements and SVG paths are in `receipt.json`.

Qualification limit: synthetic native responses and test-only16ms timer scheduling
of the unchanged production renderFrame function. Chrome headless virtual time
stalled real requestAnimationFrame;01 retained a stale frame,02 waiting for native
RAF produced no receipt.03/04 explicitly substitute only frame scheduling in the
esbuild test observer. No production code changes, physical-paint/timing, native
video, CLI-authored JSON or XDF claim follows from these screenshots.

### Nonblocking participant chrome finding

The thin square around Flubber is inherited container chrome, not its authored
P5 outline: `site/research.css` applies a1px border to `.run-feedback-stage`.
Runner CSS removes the stimulus and inner-preview borders but omits the feedback
container. The2px outer/inner geometry difference corroborates this. R1 presentation
follow-up: remove unrequested container chrome using Runner-specific CSS while
preserving the authored wavy Flubber outline. No shared P5 edit is needed; no fix
is included in this evidence pass. Root notified separately.
