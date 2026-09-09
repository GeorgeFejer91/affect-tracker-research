# Research v1 roadmap

[`15-RESEARCH-V1-CHARTER.md`](./15-RESEARCH-V1-CHARTER.md) defines the target.
This file records implementation and qualification truth. The first internal
candidate is `0.4.0-alpha.1`; it is neither stable nor research-ready.

## Repository transition — verified

- Research retains ancestry through exact pre-split commit
  `5df1e5365aacd2e59cd36347d752b003f1af432d`; the implementation branch was cut
  from charter commit `8a3df6fbb2be0cc20ebc4635ba85e4104a56a934`.
- `checkpoint/feature-rich-2026-09-03` and annotated tag
  `checkpoint-2026-09-03-feature-rich` resolve to exact approved commit
  `34a137d9d6d0f33a8e5ebef6c04bf8bc0219fd86` in Research and Playground.
- [`affect-tracker-playground`](https://github.com/GeorgeFejer91/affect-tracker-playground)
  preserves the complete branch/tag graph. Its `main` has one checkpoint
  descendant, relocation-only commit
  `5d1f5fa3d30f93b3f2797a74b02e1f336acb7bc3`; later pre-split source remains on
  `history/post-checkpoint-source-main` at
  `5df1e5365aacd2e59cd36347d752b003f1af432d`.
- The active Research working tree removes superseded WebXR/Quest, remote,
  Party/Ground Control, direct Polar, face, touch, calibration, retro, phone,
  and legacy study source/assets/tests. This reduction is recoverable from the
  refs above and is committed and pushed on the implementation branch at
  `b61f9bbd2547a2f971f44e0de2cbe1e4325243f7`.

## Implemented candidate slices

The current `research/video-protocol-v1` working candidate contains:

- allowlisted Research-only Pages and desktop entrypoints plus artifact-closure
  verification;
- historical strict JavaScript/Rust settings, assignment, and protocol readers
  plus canonical JSON/SHA-256 and explicit legacy-import reporting. Williams/
  cyclic `balanced-v1` remains test-covered for historical V1/V2 records but is
  inactive for new experiments;
- strict browser `ExperimentDefinitionV1` parsing and
  `ResolvedExperimentPlanV1` resolution, transitional `ResearchSettingsV3` and
  `ResolvedProtocolPlanV2`, the downloadable legacy-authoring
  `experiment.json` template, and a native no-path experiment picker/validator.
  This pre-package path preserves exact authored participant/block/video/ISI
  order and invokes no allocator, but it is not `ExperimentPackageV1`;
- exactly two UI modes, eight ordered Setup accordions, persistent preview,
  external experiment load/summary, participant schedule preview, input
  configuration, visual/color/mapping controls, aggregate preflight, and
  restricted Run presentation;
- browser File System Access workspace handling, bounded recursive catalogue,
  write/read/delete readiness probe, real manifest/output audits, dedicated
  sampling worker, explicit timing gaps, IndexedDB journal, CSV/TSV parity,
  partial/final paths, pending-finalization recovery, and evidence quarantine;
- browser worker clock-origin mapping, session/command/provenance fencing, and
  fail-closed media-to-sampler behavior intended to prevent stale rows from
  crossing stimulus or recovery boundaries, plus a non-production worker-only
  diagnostic that exposes trailing silence, missing or unmatched planned state
  probes, exact-anchor mismatches, and visibility loss without claiming
  full-application qualification;
- direct `IndexedDbResearchJournal` adversity coverage for transaction abort,
  quota rejection, reload/reconciliation, and durable corrupt-evidence
  quarantine, using an atomic test harness that fails if the adapter touches
  `localStorage` or falls back to the in-memory journal;
- Rust Research contract, workspace, runtime, scheduler, persistence, input,
  LSL, participant-state, and narrow Tauri command modules, including exact
  run-ID binding for renderer lifecycle/finalization commands, selected-library
  revalidation, retry-safe terminal-output promotion, durable-prefix recovery,
  and reload-only pending-finalization;
- typed native persistence checkpoints across initial snapshots, empty event
  log, rating headers, streaming rows/events, and recovery journals; an input-
  authority exit fence; and conservative unpublished-session cleanup that
  revalidates exact directory identities and refuses swapped session/recovery
  links before removing its closed artifact set;
- exact LSL state/marker metadata validation plus an opt-in Windows local-
  socket loopback through the project service, covering discovery, inlets,
  payloads, timestamps, shutdown, and distinct-run restart without claiming an
  independent-receiver or LabRecorder qualification; and
- unqualified WebView generation/run fences, ordered native status projection,
  strict Start/Resume/terminal receipt binding, explicit unknown-outcome
  reconciliation, and a reachable acquisition-free finalization action.
- a manual, read-only-permission, host-native packaging workflow for unsigned
  Windows x64 NSIS, macOS ARM64/x64 DMG, and Linux x64 DEB/AppImage artifacts,
  each labelled
  `unqualified-internal-alpha` with exact artifact provenance and every run,
  media, input, LSL, installed-workflow, timing, and research-readiness claim
  false. These packages are interface-evaluation shells, not experiment-use
  builds; Start remains fail-closed through a positive native-acquisition
  feature gate until a qualified platform/runtime package is deliberately
  produced.

The safe-hardening sequence is published through commits
`eefa257d1696c8c22b9d6c9c619a2531457ee2c9` (persistence, IndexedDB, and LSL
boundaries), `218c1c99e3cc5847bfd9a042d0776854e6b65c1a` (durable recovery checkpoint
wait), and `03c505984e1a3eaeb3849793ba1ad1862bbb6beb` (scheduler-load-independent
recovery test). The exact final implementation commit passed 209/209
JavaScript tests. The Rust all-feature matrix passed 119 tests with the
explicitly environment-gated LSL loopback ignored by default, and the
no-default-feature matrix passed 118/118 tests. Format, both-matrix check and
clippy, dependency audit, Pages/desktop builds, Research-only artifact closure,
the required-runtime NSIS bundle gate, and a separately invoked real local LSL
loopback also passed. These automated results do not qualify physical workflow,
independent LSL reception, long-run timing, or native GstPlay playback.

## Native input status — safe pointer and gamepad authority implemented

Implemented:

- one listen-only Rust `ResearchInputService` owns native Setup capture/test and
  Run input without adding a local `unsafe` surface;
- test receipts are one-use, expire after 15 minutes, and bind all four tested
  directions to the canonical binding hash and device epoch;
- OS repeat is suppressed, capture conflicts fail closed, Pause/focus/layout
  barriers publish inactive state without changing rating coordinates or
  rearming held keys, and Setup
  focus/binding/device changes invalidate evidence;
- mouse-button and wheel actions are restricted to native client-coordinate
  regions for the visible test, capture, and Run-feedback surfaces; and
- Pointer Grid projects only normalized coordinates after an inside-region
  primary-button press, and a Windows-only XInput adapter supplies D-pad,
  left-stick, right-stick, and custom gamepad-button semantics without exposing
  dependency device identities;
- a serialized callback barrier, bounded 128-edge FIFO, latest-state continuous
  coalescing with an observable safe-integer counter, authority-loss priority,
  persistence-failure classification, timeout-safe worker ownership, and durable
  fail-closed recovery prevent silent native-input loss; and
- Tauri no longer accepts WebView affect-state or gamepad-button updates as Run
  authority. Browser input behavior remains separate and unchanged.

The Tauri backend now enables Arrow keys, WASD, IJKL, numpad,
mouse-button/wheel, Pointer Grid, gamepad D-pad/sticks, and compatible custom
bindings when their native backends are available. This closes the software
adapter portion of the former native-input roadmap item. Hardware, DPI,
multi-monitor, focus, disconnect, latency, and Pause/Stop-region qualification
remains pending and no physical-device claim is made from automated tests.

## ExperimentPackageV1 status — browser package slice; native/qualification pending

The uncommitted candidate now includes browser and Rust
`ExperimentPackageV1` types/readers, exact canonical serialization, fixed
`experiment.package.json` naming, the `assets/stimuli` manifest boundary, the
exact `complete-video-v1` policy, a finite rooted language tree, embedded
`ResearchSettingsV3`/manual schedule/questionnaire content, and a canonical
cross-runtime fixture in the working candidate. Browser Setup can author an
exact nested language tree with ordered per-terminal questionnaire-module IDs,
create/load the root package,
select a language route, compile participant protocol steps including wire
`afterStimulus` hooks and ISIs, bind package asset paths, and gate Start on a
package receipt. Native no-path load/save commands validate and write package
content without returning a filesystem path.

The browser and Rust validators independently recompute
`packageDefinitionSha256`, `settingsSha256`, `assetManifestSha256`,
`experimentPlanSha256`, and `protocolMatrixSha256`. Rust reconstructs the
external experiment plan and every explicit participant-by-language protocol
route rather than trusting producer-supplied derived hashes. Browser and Rust
package load paths reject every noncanonical byte
serialization, including BOM, pretty-printing, wrong key order, missing final
LF, and CRLF; accepted source and canonical byte hashes are identical.

A permanent contract-resolver gate now launches two separate Node processes
from distinct fresh empty profiles with intentionally different locale,
timezone, directory traversal order, clock/RNG sentinels, and storage sentinels.
Guarded ambient clock, RNG, browser storage, cache, and navigator reads fail.
Each process independently imports the same exact
canonical package, resolves every participant × terminal-language case, emits
its own exact package/settings/assets/participant-assignment/protocol tuple plus
asset-binding and step-sequence hashes, and
re-exports byte-identically; the test compares their exact receipts. The older
same-realm helper is explicitly labelled a local diagnostic and never claims
process or ambient isolation. Both child processes verify the same closed,
read-only fixture asset tree as regular non-link files with exact declared
SHA-256 and byte length, and reject undeclared entries. They do not decode those
fixture bytes, verify duration, or launch two full installed GUI application
profiles.

Browser package-backed execution now validates and freezes canonical package
bytes/source hash, selected language route, and asset bindings in recovery. It
materializes `experiment.package.json` as the `experimentPackage` output of
strict `ResearchRunManifestV4`; workspace audit reparses it and recompiles the frozen
settings, experiment plan, and protocol plan before accepting the manifest.
Historical package-less V3 output remains readable as ManifestV3 and is never
upgraded in place. This is browser software evidence, not installed/physical qualification.
Native package Start remains blocked before mutation.

The permanent gate remains pending: exact canonical bytes must be loaded in two
clean independent instances against the same read-only asset tree and, for
every participant and terminal language, compare full package-byte, selected-
settings, asset-manifest, participant-assignment, and participant/language
protocol-plan hashes plus the exact step sequence and byte-identical re-export.
The completed gate must add decode/duration evidence on a representative media
closure and positively prove that ambient defaults, locale, RNG, clock,
directory order, and storage were not consulted. No complete acceptance
receipt exists.

## External experiment protocol status — transitional authoring path

The browser has a
strict, duplicate-aware `ExperimentDefinitionV1` reader, separate exact-source
and canonical-definition hashes, media-verified
`ResolvedExperimentPlanV1`, transitional `ResearchSettingsV3`,
`QuestionnaireModuleV2`, and participant-specific `ResolvedProtocolPlanV2`.
The Setup surface loads an `experiment.json`, reports its hashes, and presents
the externally authored participant/block/video order and per-video
`isiAfterMs`. The generated protocol contains an explicit interval after every
video, including terminal and zero-duration intervals; no active V3 code calls
an RNG or the historical Williams/cyclic `balanced-v1` allocator.

These contracts now support explicit package authoring and historical reads,
but they no longer constitute the target runtime authority on their own. A
browser package attempt is authorized only through the canonical package Run
binding that reproduces this embedded V3 settings/plan/protocol tuple.
Tauri's no-argument `research_load_experiment` owns its native picker and
strictly returns a path-free receipt for files no larger than 5 MiB. Separate
native package load/save commands now exist, but native transitional-V3 and
package Start remain fail-closed before mutation. Native player/scheduler
routing, language/after-video execution, interval recovery, and final package
output integration are not implemented or qualified. Historical
settings, experiment, assignment, module, and protocol readers retain their
original meanings.

## Questionnaire protocol status — package authoring/compile; native fail-closed

The questionnaire-aware contract now places active modules through
`QuestionnaireModuleV2` block IDs and resolves them with the external schedule
in `ResolvedProtocolPlanV2`. The browser retains strict
`questionnaire-csv-v1`, the bundled verified German MAIA-2, and bundled
researcher-supplied English VR Experience, MAIA-2, six-item SSQ, and TAS-20
authoring candidates with their institutional attribution. The TAS-20 candidate
is unscored and still requires documented rights/reuse approval before
deployment; bundling is not validation or licensing authorization. The browser
also retains response/event/recovery records, an eighth Setup accordion, and
mutually exclusive Run questionnaire/video/interval stages. Historical
V1/V2 readers are not reinterpreted. The browser package slice embeds these
definitions/modules, compiles each terminal language's exact ordered
`questionnaireModuleIds`, and places wire `afterStimulus` hooks on their
explicitly authored side of the ISI.
Browser recovery and
`ResearchRunManifestV4` now retain and audit the canonical package binding, but
decode-backed reproduction and physical workflow gates remain open.
The browser Setup surface now leaves language unset at package load, traverses
the package-owned tree explicitly per participant/new attempt, and restores a
compatible interrupted attempt from a narrow hash-bound recovery projection.
There is no flattened route selector or first-route default.
Tauri validates the package structure and questionnaire languages but does not
own language-specific protocol compilation; it rejects transitional V3/package
Start before mutation until its atomic native execution/writer is complete.
Do not treat deterministic browser tests or native validation as run-ready
evidence until Rust execution parity, physical recovery/output, accessibility,
timing, media, and packaged-workflow gates pass.

## Native GStreamer/GstPlay status — safe groundwork only

Implemented safe groundwork:

- exact GStreamer 1.28.6 Windows MSVC x86_64 combined-installer identity and a
  canonical 827-file / 340,362,958-byte integration-tree manifest. Component
  checksum notes exist, but source archive names, URLs, byte lengths, retained
  artifacts, and automated source verification are explicitly incomplete;
- a deterministic staging/verifying script that rejects traversal, links,
  missing/extra/modified files, coordinated DLL-plus-manifest tampering, and
  wrong-architecture engine DLLs while preserving upstream notices;
- a build-time package gate controlled by
  `AFFECT_RESEARCH_REQUIRE_GSTREAMER_RUNTIME=1`;
- ephemeral Windows CI compilation/testing of the optional bindings and runtime
  verifier. The current manual Windows/macOS/Linux package wrappers use no
  optional features, exclude the GStreamer tree, positively disable native
  acquisition, and write all-false, exact-commit artifact provenance;
- a path-free native-media capability contract;
- run/receipt/recovery labelling for `nativeGstPlay`, retired parse-only
`nativeLibvlc`, versus explicit
  `unqualifiedWebview`, including fail-closed media-error handling;
- an IPC authority fence that accepts renderer playback lifecycle/failure
  events only for the exact active run in the explicit unqualified WebView
  fallback. A future qualified GstPlay run cannot treat WebView media events as
  native playback authority;
- per-source detached video generations, ordered status/lifecycle fencing,
  strict receipt binding, duration-end validation, and explicit restart-required
  handling when native terminal state cannot be reconciled; and
- explicit lower-trust WebView decode evidence requiring representative frame
  callbacks near the start, midpoint, and end. One-use media grants are
  consumed and this evidence remains labelled `attestedUnqualified`; it cannot
  satisfy the future native GstPlay qualification gate.

Not implemented or qualified:

- the serialized GLib/GstPlay player actor and callback fencing;
- isolated runtime/plugin registry initialization and native decode discovery;
- a reviewed minimal distributable plugin/codec closure, complete
  corresponding-source artifacts/provenance, and redistribution approval;
- a safe installed Windows pre-`main` DLL-resolution/bootstrap design that
  cannot be masked by CI `PATH` or load an ambient GStreamer runtime;
- the application-owned child HWND/render-rectangle adapter;
- native playback commands/events connected to exact media grants; or
- packaged playback, codec, DPI/resize, audio, recovery, shutdown, and soak
  receipts.

The capability therefore reports `playerActorReady: false` and
`qualifiedStartAvailable: false`. The transitional native status prefers
`nativeGstPlay`, while `ExperimentPackageV1` must carry an explicit playback
policy; qualified Start fails closed in either case. Implementing the raw-window GstPlay renderer requires
explicit approval for the contained `unsafe` constructor, followed by focused
audit. The researcher granted that approval on 2026-09-10. Implementation,
audit, and installed-artifact qualification remain incomplete; staging the
runtime is not playback qualification.

## Open software work before candidate acceptance

1. Refactor the large frontend and native runtime coordinators along the
   chartered module topology. Keep one composition root, narrow typed module
   interfaces, an explicit native/browser adapter boundary, and focused tests;
   do not move behavior or weaken recovery while splitting it.
2. Finish the package authority slice: bind the exact playback
   backend/output policy into terminal evidence, and implement atomic native
   package execution while preserving historical readers/importers.
3. Extend the permanently gated two-clean-process contract benchmark to two
   full independent installed/browser application profiles, representative
   decodable read-only media with duration receipts, and platform-specific
   normalization checks. Retain the existing hostile ambient guards, closed
   asset tree, exact per-case five-hash tuple, sequence equality, and
   byte-identical re-export comparisons.
4. Approve a minimal GStreamer redistribution/source closure and safe Windows
   DLL-loader bootstrap; keep every downloadable package runtime-free until it
   passes review.
5. Implement the now-approved contained native GstPlay renderer and child-
   window adapter, connect player lifecycle atomically to the scheduler, and
   pass the security/lifecycle gates in
   [`30-TESTING-AND-RELEASE.md`](./30-TESTING-AND-RELEASE.md).
6. Implement native GstPlay-owned duration/decode preflight and exact lifecycle
   authority for declared package assets after the actor exists.
7. Exercise real full-disk/power-loss and directory-entry durability, real
   browser quota/permission loss, and packaged Setup-to-Run/recovery workflows;
   deterministic initial/streaming/journal and IndexedDB transaction fault
   coverage is now implemented.
8. Publish the validated implementation branch through normal repository
   safeguards, verify CI, merge deliberately, deploy Research Pages, and bind
   all later qualification receipts to the exact resulting candidate.

## Qualification receipts — limited engineering evidence only

The latest clean pre-external-protocol baseline
`dba439cc591c64f13826a59c9cc12e0fd045cb38` passed 265/265 JavaScript tests in
[Pages CI run 34264929981](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/34264929981)
and [Desktop CI run 34264929793](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/34264929793).
Desktop CI also passed both Rust matrices (133 passed/one environment-gated
ignored with all features; 132 passed with no default features), format, check,
clippy, audit, and both frontend builds. Those receipts predate both the
`ExperimentDefinitionV1` amendment and `ExperimentPackageV1` charter. They do
not validate package bytes/self-hash/export, the fixed asset tree, language or
after-video sequencing, independent-instance reproduction, the changed browser
run path, or native loader. They are automated baseline evidence only and
establish no physical, timing, media, LSL, accessibility, recovery, or
research-readiness claim.

An earlier committed pre-GStreamer baseline
`85e64f53bf61204a4a6b6c68ecb57f196df3b684` passed
[Pages CI](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/33929412486)
and [Desktop CI](https://github.com/GeorgeFejer91/affect-tracker-research/actions/runs/33929412484).
Desktop artifact `9958170005` is 66,127,690 bytes with GitHub-matching SHA-256
`e9eea21e14073e317c4227280e5cfc82c863ffa04ed24d6d64ef92a753df04a1`.
Its provenance binds that exact SHA and run attempt to the 39,639,096-byte
unsigned NSIS installer
`71500c0a0e5c2f4d00ec7ccfd044288a1600bd78b63983028764428855315dff`,
1,326-byte historical runtime pin
`cd4d2c6b717c1038e675285558d8891ae41f5d6ef2c7dce5457f85251deb72ee`,
staged manifest
`cab51c65c02bf656d0d77e86b3ec421b130e67b4f7ac52efac20f99cd4be3f26`,
and 26,486,988-byte historical libVLC source archive
`e891cae6aa3ccda69bf94173d5105cbc55c7a7d9b1d21b9b21666e69eff3e7e0`.
Pages artifact `9957992806` is 130,861 bytes with GitHub-matching SHA-256
`41b9d48a09feab4aa0bbd511cef34a650bd31862e132f63ccfec175a376eb831`;
deployment was correctly skipped by the implementation-branch gate. That exact
85e64f5 installer was not launched.

Earlier committed candidate `03c505984e1a3eaeb3849793ba1ad1862bbb6beb`
provided the isolated install/start/close/uninstall receipt: it verified its
historical exact 368-file / 142,167,916-byte runtime tree, launched responsively
as **Affect Research**, accepted a normal close, exited with code zero, and
uninstalled without a lingering process. These records are CI and installer-
integrity evidence for their historical libVLC-based commits, not evidence for
the subsequent GStreamer/questionnaire work, Setup-to-Run, native playback,
hardware, or installed-workflow qualification.

A ten-second current-Chrome Worker diagnostic at 130 Hz recorded 1300/1300
slots, zero gaps/missed/corrupt rows, five planned/sent/matched state probes,
130.048255 Hz mean rate, 4.776923 ms p95 lateness, and 12.199951 ms p95
state-to-sample latency. It correctly failed only the required 30-minute-window
gate. This is Worker-only diagnostic evidence, not a visible full-application
Chrome receipt. Current Edge remains untested because the required browser-
control endpoint was unavailable.

The project LSL service has also passed a same-process Windows local-socket
loopback for exact metadata, channel order, nominal rate, state/marker payloads,
timestamps, shutdown, and distinct-run restart. It is not independent-receiver,
LabRecorder, network reconnect, sleep/wake, packaged-candidate, or long-run
qualification. No physical-workflow, native-playback, 30-minute timing, or
accessibility qualification receipt currently exists for Research v1.

### Current local working-candidate verification — 2026-09-09

The uncommitted package/questionnaire/language-selection working candidate
passed 299/299 JavaScript tests, the allowlisted Pages and desktop frontend
builds, `git diff --check`, and the high-severity pnpm dependency audit. Rust
format and both clippy matrices passed with warnings denied. The no-default
Rust matrix passed 152/152 tests. With the exact pinned GStreamer 1.28.6
Windows development SDK and required-runtime gate enabled, all-feature check,
test, and clippy passed; the matrix reported 153 passed and one explicitly
environment-gated LSL loopback ignored. That loopback then passed in its
separate opt-in invocation.

The pinned installer SHA-256 and staged 827-file runtime closure were also
verified locally. A read-only interactive review of Setup and Review confirmed
the two-mode shell, ordered controls, participant-language blocker, explicit
nested language traversal, and accessible dialog semantics without console
errors. The automated browser runtime suite completed a canonical package run
through video, questionnaire, ISI, output, audit, interruption, and recovery
paths. This paragraph is local working-tree evidence only: the changes have no
candidate commit, remote CI run, package artifact, installed-app receipt, or
physical-workflow receipt yet. It must not be cited as release or
research-readiness qualification.

Before a stable or research-ready claim, record:

1. The permanent two-clean-instance `ExperimentPackageV1` reproduction
   benchmark for every participant and terminal language, exact five-hash and
   sequence equality, byte-identical re-export, and no ambient defaults/storage.
2. Separate visible 30-minute 130 Hz runs on declared Windows hardware in the
   packaged Tauri app, current Chrome, and current Edge: mean 129–131 Hz; p95
   lateness at most two periods; input-state p95 at most two Tauri periods and
   three browser periods; zero silent gaps/backfill/corrupt rows; explicit event
   for every missed slot.
3. Representative 1 Hz and 240 Hz runs plus pause/buffering, authored zero,
   nonzero, and terminal intervals, neutral reset, visibility/minimize,
   permission loss, unavailable IndexedDB,
   quota/full disk, forced termination, and safe-boundary recovery.
4. Independent LSL receiver and LabRecorder evidence for channel order,
   metadata, nominal rate, timestamps, markers, reconnect, gap reporting, and
   clean shutdown.
5. Real keyboard, mouse, wheel, pointer/trackpad, and supported gamepad checks;
   keyboard-only Setup/Run; visible focus; labels/status; non-color meaning;
   reflow/contrast; announcements; and reduced motion.
6. Installed native GstPlay evidence for exact runtime integrity and a declared
   supported container/codec matrix,
   player/scheduler lifecycle, errors, DPI/resize, audio, recovery, shutdown,
   forced termination, and a 30-minute run.
7. Cache-bypassed verification of the exact deployed Pages commit and real
   launch of the exact unsigned Windows installer artifact.

Experimental YouTube remains historical/inactive and outside research
qualification; `ExperimentPackageV1` rejects it.
Until all applicable receipts exist, retain `0.4.0-alpha.1` and do not publish a
stable/signed installer, GitHub Release, updater, store build, or research-ready
claim.
