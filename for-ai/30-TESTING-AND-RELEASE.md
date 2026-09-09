# Testing and release gates

## Status

These gates apply only to Affect Research v1. The feature-rich application's
tests and physical receipts remain historical evidence in Playground and do
not qualify the changed Research runtime.

The first internal target is `0.4.0-alpha.1`. Documentation, schemas, mocks,
compilation, a staged native runtime, or one successful adapter never establish
a stable or research-ready claim. Acceptance evidence must bind the exact Git
commit, package/output contract versions and derived hashes, built artifact hashes, OS/browser
versions, hardware, and test receipt.

## Automated candidate gates

Run the repository's exact commands from a clean candidate checkout:

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build:pages
pnpm desktop:build
pnpm audit --audit-level=moderate
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo check --manifest-path src-tauri/Cargo.toml --locked --all-features
cargo check --manifest-path src-tauri/Cargo.toml --locked --no-default-features
cargo test --manifest-path src-tauri/Cargo.toml --locked --all-features
cargo test --manifest-path src-tauri/Cargo.toml --locked --no-default-features
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features -- -D warnings
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets --no-default-features -- -D warnings
```

Build an unsigned native-playback NSIS candidate only after staging and
verifying an approved required native-media closure. The current interface-only
NSIS candidate deliberately contains no such runtime and disables native
acquisition. Inspect any resulting installer and installed application rather
than treating the bundler exit code as runtime evidence.

The manual `desktop-release.yml` workflow may build unsigned Windows x64
NSIS, macOS ARM64/x64 DMG, and Linux x64 DEB/AppImage interface-evaluation
artifacts on their native GitHub runners. Verify their closed provenance and
Start rejection. Their build success is not experiment-use or cross-platform
qualification evidence.

### Contracts and settings

- Round-trip all historical V1/V2/V3 settings, experiment, assignment,
  questionnaire, protocol, manifest, and recovery families unchanged. Treat
  them as historical readers or explicit authoring inputs, never as aliases of
  `ExperimentPackageV1`.
- Round-trip exact canonical `experiment.package.json` bytes and package-bound
  resolved receipts through owning Rust and browser readers. Recompute
  `integrity.packageDefinitionSha256` with the whole derived `integrity` member
  omitted, verify the full-file `canonicalSourceByteSha256`, and prove exact
  byte-for-byte re-export with no BOM, whitespace, key-order, newline, or
  number drift.
- Reject unknown fields, duplicate keys/IDs, wrong schemas/versions/algorithms,
  invalid enums/colors/paths, non-finite/out-of-range numbers, excessive
  counts/depth/bytes, missing explicit settings, bad tree/reference edges,
  cycles, incomplete language variants, and package/settings/assets/
  assignment/protocol hash drift.
- Require every nullable wire member to be present explicitly, reject
  noncanonical frozen IDs/detail codes/URLs rather than rewriting them, and
  enforce cross-field counts identically in Rust and JavaScript.
- Prove canonical package-definition/full-byte, settings, asset-manifest,
  experiment-plan, and protocol-matrix SHA-256 equality across Rust and browser
  fixtures. Separately prove participant-specific assignment and
  participant-plus-terminal-language protocol-plan equality. Noncanonical JSON
  is authoring input and cannot Start.
- Exercise explicit legacy settings/experiment/questionnaire import, reporting
  every carried, defaulted, rejected, and discarded value. Prove that existing
  app data, browser storage, OS locale, prior packages, and platform defaults
  never merge automatically.
- Verify all eight Setup accordions, their exact order and single-open state,
  persistent preview, package load/re-export and legacy authoring import,
  explicit 1–240 Hz package value with 130 Hz only as an authoring suggestion,
  always-on continuous rating, and absence of summary-only acquisition or
  in-app randomization controls.

### Questionnaires and protocol sequence

- Strictly parse UTF-8 RFC 4180 `questionnaire-csv-v1`: exact 14-column header,
  optional BOM, bounded byte/row/item/option/text counts, consistent repeated
  metadata, contiguous item rows, unique IDs, explicit required flags, and
  finite-or-blank scores. Reject every unknown, missing, malformed, duplicate,
  noncontiguous, inconsistent, or control-character case. Prove the CSV is
  consumed only by an explicit converter and the resulting definition is
  embedded in the canonical package before Start.
- Prove authoring-source and embedded canonical definition hashes independently,
  plus JS/Rust canonical-hash parity. Golden-test bundled German MAIA-2
  item/option order, reverse-scored items 5–12 and 15, eight subscales,
  attribution, and source identity.
- Golden-test the bundled English researcher-supplied VR Experience, MAIA-2,
  six-item SSQ, and TAS-20 fixtures for exact item/option order, numeric response
  values, and Max Planck Institute for Human Brain and Cognitive Sciences,
  Department of Neurology attribution. Verify that all remain identified as
  unvalidated authoring candidates. For TAS-20, prove that no reverse scoring,
  subscales, totals, thresholds, or diagnostic interpretation is inferred, and
  keep documented rights/reuse approval as a blocking pre-deployment gate.
- Property-test the finite rooted language-selection tree: all edges resolve,
  no cycles or unreachable/duplicate terminals exist, and no OS/browser locale
  or prior language state is read. For each terminal language, compile exactly
  its ordered `questionnaireModuleIds`; reject unknown, duplicate,
  language-incompatible, or globally unmapped modules. An empty terminal list
  is an explicit no-questionnaire route and never falls back to another
  language.
- UI-test nested and single-language participant traversal, ordered prompts,
  Back and Cancel behavior, absence of a flattened selector or first-route
  default, Start blocking before a terminal, and selection reset across
  participant/disposition changes, rejected/successful Start, and completion.
  Recovery tests must prove the narrow `__recoveryBinding` contains no package
  source, path, workspace, demographic, answer, or sample data; exact package,
  participant, attempt, terminal path, and assignment mismatch must fail closed.
- Property-test session/block/after-video (`afterStimulus` on the wire) hooks,
  multiple same-hook modules,
  participant-specific manual block/video orders, `blockId`/`stimulusId`
  targets, both explicit `relativeToIsi` sides, interval insertion between the
  pre-ISI and post-ISI hooks, and stable protocol hashes. Every authored block,
  stimulus, and `isiAfterMs` must survive unchanged and every protocol position
  is unique.
- Crash at every draft, submit, event, safe-step, and finalization boundary.
  Submission must atomically commit immutable derived response rows, completion
  event, and safe protocol advance; controlled partials preserve drafts.
- Prove invalid option and WebView score spoof rejection, no sampling/rating
  input/regular LSL state during questionnaires, CSV/TSV response parity,
  keyboard-only completion, managed focus, labels, and 200% reflow.
- Run end to end for every terminal language: pre-session form, pre-block form,
  complete video, targeted pre-ISI after-video form, its exact interval,
  targeted post-ISI after-video form, remainder of block, post-block form, next
  manually ordered block, post-session form, receipt; repeat with interruption
  and safe recovery at every step kind, including zero-duration and terminal
  intervals.
- During every interval, prove rating input, sample rows, regular LSL state, and
  animation acquisition are stopped; affect state is neutral; one bounded
  start/completion event pair binds its preceding stimulus and duration.

### Experiment package, authored order, and participant identity

- Accept only bounded canonical UTF-8 JSON without BOM and with exactly one
  trailing LF. Reject any byte serialization that is not the exact canonical
  `ExperimentPackageV1` re-export, plus duplicate keys/IDs, unknown or omitted
  fields/references, unsafe/non-`assets/stimuli/` paths, participant-ID gaps,
  missing/repeated blocks, within-participant stimulus duplicates, missing/
  extra/mismatched assets, and non-integer/out-of-range ISIs.
- Prove the package-definition self-hash omits only the derived `integrity`
  member, every other field changes it, the full canonical-byte hash includes
  the integrity block and LF, and package array order is preserved byte-for-
  semantic-position across load, preview, assignment/protocol resolution, CSV
  export, run, outputs, and recovery. Instrument tests must establish that no
  RNG, seed, shuffle,
  Williams/cyclic, pool allocator, directory order, clock, or `balanced-v1`
  path is called for a package attempt.
- Prove asset resolution verifies only the exact declared hash/size/duration
  closure, records decode readiness separately, never enrolls a scanned file,
  substitutes a source, or changes block/video/ISI order.
- Exercise the exact serialized `complete-video-v1` policy on each surface.
  Missing or unavailable `nativeGstPlay` must block qualified Windows Start;
  `unqualifiedWebview` must be selected explicitly and permanently labelled;
  Chromium must require `browserMediaAdapters`; no mode may automatically fall
  back.
- Test virtualized preview, resolved schedule CSV, concurrent starts,
  lock/journal/manifest reconstruction, reruns, and create-new attempt numbers.
- Cover Unicode extended-grapheme participant codes and uppercase expansion.
  Prove raw names and self-description never reach storage, output, filenames,
  markers, logs, crash state, or IPC after derivation.

### Permanent independent-instance reproduction benchmark

- For every candidate, load the exact same canonical `experiment.package.json`
  bytes into two clean independent application instances against the same
  read-only declared asset tree. Use distinct empty app-data/browser profiles, caches,
  IndexedDB/local-storage namespaces, and process state.
- Enumerate every declared participant crossed with every reachable terminal
  language. For every pair, independently derive and compare the exact full
  package-byte, selected-settings, asset-manifest, participant-assignment, and
  participant/language protocol-plan hashes plus the full ordered typed
  sequence, including language path, all five questionnaire hook
  kinds, video identities, and per-video ISIs.
- Require each instance's package re-export to be byte-identical to the input
  and to the other export. Reject timestamps, OS/browser locale, RNG,
  filesystem enumeration order, prior settings/package selections, ambient
  defaults, or shared storage as resolver inputs. Instrument reads so absence
  of ambient dependency is positive evidence rather than an assumption.
- Retain this as a permanent gate after implementation. A passing reproduction
  receipt proves deterministic package resolution only; it never substitutes
  for native playback, timing, persistence, physical input, LSL,
  accessibility, or scientific qualification.

### Input, visual feedback, and mappings

- Golden-test Arrow, WASD, IJKL, numpad, pointer/trackpad, mouse button/wheel,
  gamepad D-pad, left stick, and right stick presets plus custom capture.
- Prove conflict rejection, input-test receipt invalidation after any binding or
  device change, OS key-repeat suppression, Arrow/0.1 authoring suggestions but
  an explicit package binding, and Step Size **N/A** for continuous/absolute
  inputs.
- On Windows, require the Rust input authority to own capture, test, run
  preparation, device epochs, and the allowed input region. WebView controls
  such as Pause and Stop Early must never be interpreted as rating input.
- Prove native callback ordering across keyboard/mouse and XInput sources,
  absolute-pointer rejection outside the registered physical region, gamepad
  device exclusivity/disconnect loss, the exact 128-edge queue bound,
  authority-loss priority, continuous latest-state coalescing and its bounded
  observable counter, Start/Resume handoff, Pause/terminal barriers, and
  durable safe-boundary recovery after overflow or authority loss.
- Prove the native dispatch barrier cannot be overtaken by Pause/Stop, the
  digital FIFO fails closed rather than dropping an accepted edge, authority
  loss outranks queued input, continuous coalescing remains bounded and
  observable, and Start/Resume applies every accepted post-playback update
  exactly once before the next authoritative sample.
- Prove Pause, focus loss, and layout invalidation publish inactive state while
  preserving the current rating coordinates without rearming held keys;
  persistence failures during an input edge must stop
  write-unhealthy without a recursive event; interrupt timeout must retain the
  worker handle and input authority for later cleanup.
- Verify Grid and Flubber independently/together, Size %, Transparency, hidden
  feedback without stopped acquisition, normalized drag bounds, sole Lock
  position ownership, forced Run lock, outline/halo/cursor geometry, and every
  color wheel/hex/reset path.
- Golden-test all six mapping labels, bounds, package-authoring suggestions,
  explicit package values, drivers, Reverse,
  neutral angle zero, axes/corners, min=max, and interpolation.

### Browser workspace, recording, and recovery

- Exercise secure-context/user-activation directory selection, exact handle
  retention, permission renewal/revocation, fixed `assets/stimuli/` import/
  rescan bounds, closed declared-asset verification, and isolated
  `affect-research/v1` IndexedDB/local-storage keys.
- Prove workspace readiness with actual create/read/delete probes. Validate
  package bytes/hash, derived receipts, journals, events, ratings, and manifests
  strictly; reject path traversal, malformed/noncanonical JSON, stale hashes,
  missing/extra asset or output tails, and conflicting attempt artifacts.
- Prove worker session/command/provenance epochs prevent stale rows from being
  relabelled across stimulus, pause, resume, recovery, or later attempts.
- Test accepted-batch journaling before acknowledgement, explicit timing gaps,
  pending finalization, byte-identical retry, evidence quarantine, and
  finalization after reload without restarting media or sampling.
- Verify CSV/TSV toggles are independent with at least one selected. Both files
  must serialize the same canonical rows, columns, ordering, values, and count.

### Native package-root boundary

- The no-argument `research_load_experiment_package` picker and
  `research_save_experiment_package` writer must handle valid, oversized, invalid-
  UTF-8, BOM/noncanonical, duplicate-key, unknown/missing-field, bad-self-hash,
  bad-tree/reference, and semantically invalid files. Prove it returns only a
  path-free package receipt, derived hashes match browser fixtures, re-exported
  bytes are exact, and cancellation mutates no package/root state. A load may
  return a normalized authoring receipt, but Start must reject unless source and
  canonical bytes are identical. Recompute experiment-plan and protocol-matrix
  integrity in Rust rather than trusting well-formed supplied hashes. Keep
  `research_load_experiment` coverage as legacy authoring/import evidence only;
  its `LoadedExperimentReceipt` cannot authorize a package run.
- Assert `librariesReady` reflects the exact package root and fixed asset,
  output, and recovery descendants. Remove one, replace it with a file or a new same-path
  directory, and replace it with a symlink/junction to an external directory;
  status and every privileged operation must fail closed without recreating the
  library or exposing a native path.
- Exercise durable readiness probes in both `recovery/` and a temporary nested
  `outputs/<experiment>/<participant>/<session>/` hierarchy. Verify exact
  cleanup, path-free receipts/errors, and failure when either hierarchy cannot
  be used.
- For actual run creation, place a file, an outside-target junction, and a
  same-path directory replacement at each nested experiment/participant
  boundary. Assert that the runtime never follows it, revalidates around the
  participant lock, preserves create-new session semantics, and emits no output
  beyond the selected workspace.
- Treat Windows reparse-point races as an explicit residual boundary until a
  separately reviewed safe handle/file-ID design exists; passing junction and
  replacement tests is not evidence of a race-free sandbox.

## Native Windows media gate

Qualified declared package-asset playback uses only the pinned bundled
GStreamer 1.28.6 MSVC x86_64 runtime and private plugin closure.

### Supply-chain and package evidence

- Verify the official combined installer is 528,572,178 bytes with SHA-256
  `059251444d1267b486eba390b18d25fed87e10315e72f757ec6c7e912fa746b5`
  and verify all component source hashes against
  `src-tauri/native-media/gstreamer-runtime-v1.json`.
- Stage only the required DLLs, plugin tree, and upstream notices. Verify the
  complete generated file-hash manifest and reject links, Windows directory
  junctions/reparse points, traversal, extra, missing, modified, or
  wrong-architecture files. A real-junction regression must prove the verifier
  rejects before traversal and never changes the external target.
- Package with `AFFECT_RESEARCH_REQUIRE_GSTREAMER_RUNTIME=1` and the
  `native-gstreamer` feature; prove the build fails closed when the tree is
  absent or altered. The running app must clear ambient plugin paths and use
  only its private registry and scanner without runtime downloads.
- Retain applicable source/license obligations and approve the exact shipped
  plugin/codec redistribution closure.
- Every distributed Windows alpha artifact must include the exact pinned
  GStreamer source materials, the machine-readable runtime pin, and provenance
  record binding repository, workflow/run, Git commit, runtime-pin identity,
  and installer/source SHA-256 plus byte lengths. Every external build action
  is pinned to an exact commit and the materialized checkout must remain clean.
  Any future wrapper that distributes native GStreamer must activate the same
  required-runtime gate. Until this complete evidence and redistribution review
  exist, `pnpm desktop:bundle` must instead build with no optional features,
  exclude the runtime, positively disable native acquisition, and label the
  artifact interface-only. The artifact name also includes the full commit SHA;
  a mutable filename or unbound aggregate pass count is not release evidence.

### Player-actor security and lifecycle evidence

The in-process renderer cannot be accepted until explicit user approval for its
contained `unsafe` raw-window GstPlay constructor is recorded. Audit validated
handle and strong-window lifetimes, GLib/GstPlay one-thread affinity, bounded
callbacks, stale-generation fencing, panic containment, child-window ownership,
and callbacks-after-teardown prevention.

- Revalidate opaque media identity, root generation, hash, byte length,
  duration, and decode evidence immediately before Prepare. No WebView path or
  arbitrary native handle may cross IPC.
- Prove only native decoded Playing opens sampling. Pause, buffering, end,
  error, actor loss, window close, and teardown must fence sampling before UI
  projection and retain an authoritative recovery boundary.
- Test Prepare/Play/Pause/Resume/Stop/End/Error, stimulus-to-interval and
  interval-to-next-step transitions, rerun, recovery restart from zero, rapid
  command races, stale callbacks, and clean repeated shutdown.
- Test supported containers/codecs, corrupt/truncated/zero-length/renamed files,
  missing plugins, audio present/absent, output device changes, mute/volume
  policy, seek prohibition, multi-monitor movement, resize, minimize/restore,
  and 100/125/150/200% display scaling.
- Exercise native-library load and symbol failure without process crash. Run
  leak/handle-growth and forced-termination checks on the packaged candidate.
- Prove `unqualifiedWebview` is an explicit opt-in, never an automatic fallback,
  and that status, first event, journal, receipt, and manifest all retain the
  unqualified label. Its media errors must still stop native sampling.
- For the unqualified desktop probe, require decoded-frame callbacks at the
  deterministic near-start, midpoint, and near-end positions; reject metadata,
  seek, or short-play evidence without those frames. Assert the
  `representativeFramesV1` / `webviewVideoFrameCallback` /
  `attestedUnqualified` labels and one-use grant consumption on success,
  rejection, and explicit revocation.
- Race delayed events from a detached prior video against the current source,
  lifecycle IPC against status polls, and an older status response against a
  newer response. Require run/participant/attempt/hash/playback receipt binding,
  per-source element generations, and fail-closed unknown-outcome reconciliation.

Runtime staging, a verified capability response, or successful unit tests alone
do not satisfy this gate.

## Persistence and adversity gates

- Verify create-new output directories and attempt counters never overwrite.
  Every terminal attempt contains the frozen settings snapshot, semantic
  `events.jsonl`, and selected rating files. Historical attempts retain
  `ResearchRunManifestV2/V3`; package attempts add byte-identical
  `experiment.package.json`, immutable derived receipts, questionnaire-response
  tables, and the required `experimentPackage` output and recovery binding in
  strict `ResearchRunManifestV4`, all bound to exact package/
  settings/assets/assignment/protocol/language/playback/output/stimulus/hook/ISI
  identity.
- Test controlled Stop Early as terminal Partial separately from crash/write
  recovery. Resume is offered only for a valid recoverable journal and only at
  a safe boundary; a partially viewed stimulus restarts from the beginning and
  an interrupted ISI restarts at its full frozen duration. Never persist or
  infer an elapsed-interval remainder.
- Exercise quota/full disk, read-only/unwritable workspace, revoked browser
  permission, unavailable IndexedDB, process/tab termination, power-loss
  simulation, corrupt/truncated journals, manifest/output disagreement,
  finalization interruption, and idempotent retry.
- Inject lifecycle event/checkpoint failures and prove native sampling/input
  authority stops while the last durable journal remains recoverable. Reject
  evidence shorter than journaled prefixes; permit only deterministic repair
  beyond those prefixes. Exercise the explicit Setup pending-finalization action
  without demographics or acquisition preflights and bind its receipt to the
  exact durable run, participant, attempt, outcome, settings, plan, and playback
  provenance.
- Inject every terminal write/sync/rename boundary, including a nonempty partial
  final-manifest write. Across process reload, prove every exact canonical
  manifest prefix is append-retryable and every divergent prefix is preserved
  unchanged and quarantined.
- Prove accepted evidence is never silently discarded, backfilled, relabelled,
  overwritten, or called Complete before durable finalization and lock release.

## Timing qualification

Run separate visible 30-minute tests at 130 Hz on the exact packaged Windows
Tauri candidate, current desktop Chrome, and current desktop Edge. Each receipt
must show:

- mean steady-state rate from 129 through 131 Hz;
- p95 scheduler lateness no greater than two configured periods;
- input-to-authoritative-state p95 no greater than two periods in Tauri and
  three periods in Chrome/Edge;
- zero silent sequence gaps, invented catch-up rows, timestamp backfill,
  corrupt rows, or unreported stalls; and
- one explicit timing-gap event for every missed slot.

Also test 1 Hz and 240 Hz, pause, native/browser buffering, visibility loss,
minimize/restore, sleep/wake, zero/nonzero/terminal authored intervals, neutral
reset, state-anchor age, clock mapping, and recorded monotonic/LSL-compatible
time and jitter. Rendering must never control the scheduler.

The non-production worker diagnostic at
`scripts/qualification/browser-timing.html` can be served with
`pnpm qualification:browser:serve`. It exercises the exact browser sampling
Worker, accounts every explicit missed slot, measures scheduler lateness and
controller-state-to-sample latency, and emits a JSON record containing an
operator-supplied, unverified candidate SHA plus the observed environment. Its
receipt is deliberately labelled worker-only: it does not replace
the required visible full-application runs, physical input, media, persistence,
LSL, Chrome/Edge separation, or installed-artifact evidence.
The version 2 worker-only threshold also requires full requested-window slot
accounting, the complete planned two-second state-probe schedule, exact
state-anchor provenance for every matched probe, and zero visibility loss.

## LSL qualification

- The deterministic Rust suite checks the state/marker metadata contract,
  channel order, sample serialization, marker bounds, and unavailable-build
  failure without requiring a network receiver. On Windows, run the ignored
  project-level socket loopback explicitly with:

  ```powershell
  $env:AFFECT_RESEARCH_RUN_LSL_LOOPBACK = "1"
  & "$env:USERPROFILE\.cargo\bin\cargo.exe" test --manifest-path src-tauri/Cargo.toml --locked --all-features research_lsl::tests::windows_lsl_loopback_conformance -- --ignored --exact --nocapture
  Remove-Item Env:AFFECT_RESEARCH_RUN_LSL_LOOPBACK
  ```

  The loopback exercises `LslService`-owned outlets through real local
  discovery, wire metadata, inlets, state/marker transport, shutdown, and a
  distinct-run restart. It is same-process project evidence only. It does not
  substitute for an independent receiver, LabRecorder, packaged-candidate,
  clock/network, disconnect/reconnect, sleep/wake, or long-run receipt.
- Resolve the regular state and irregular marker outlets with an independent
  current receiver and LabRecorder.
- Confirm eight Float32 channels in exact order, configured nominal rate,
  source metadata, LSL/monotonic timestamp relationship, lifecycle markers,
  restart, disconnect/reconnect, sleep/wake, gap reporting, and clean shutdown.
- Verify missing or incompatible LSL fails Start with a useful bounded status,
  and Chrome/Edge preserves imported values but blocks Start when LSL is enabled.
- Confirm markers contain no raw names, typed text, arbitrary error/path data,
  settings bodies, or video data. Do not claim clock identity with independently
  running Polar software.

## Accessibility, containment, and deployed evidence

- Complete Setup and Run using only the keyboard. Verify visible focus,
  semantic labels/status, polite announcements, non-color meaning, contrast,
  200% zoom/reflow, and reduced-motion behavior.
- Test exact two-mode navigation and eight Setup accordions in the real Pages
  build and packaged Tauri application. Hiding feedback must not hide timing,
  write/recovery, or LSL status.
- Verify the allowlisted Pages and desktop build closures contain no WebXR,
  Quest, remote/VDO/BRSP, Party/Ground Control, direct Polar, face, touch,
  calibration, retro, phone/Picture-in-Picture, or legacy media assets/routes.
- Qualify current Chrome and Edge separately against the exact deployed commit,
  including cache-bypassed loading at
  `https://GeorgeFejer91.github.io/affect-tracker-research/`.
- Prove repository and network media references, including Experimental
  YouTube, reject under `ExperimentPackageV1`; package playback resolves only
  its closed safe `assets/stimuli/` complete-video manifest.

## Release boundary

CI may validate the static artifact and optional Windows GStreamer integration
tree without uploading that tree. Manual workflows may produce explicitly
unqualified, no-optional-feature Windows/macOS/Linux interface-evaluation
packages. The internal
`0.4.0-alpha.1` label remains non-stable and non-research-ready until every
applicable automated, installed-artifact, timing, media, recovery, input, LSL,
accessibility, and physical workflow gate above passes for one exact candidate.

Publishing or signing an installer, creating a public GitHub Release, enabling
an updater, submitting to a store, or handling production credentials requires
explicit authorization. Test the exact artifact before promotion; never rebuild
after approval and call it the same release.
