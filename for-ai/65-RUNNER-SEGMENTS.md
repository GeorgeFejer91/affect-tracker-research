# Experiment Runner agent ledger

## Active end-to-end allocation — 2026-09-12

The researcher now explicitly requests CLI-authored master intake and an actual
Runner correspondence test. [69](69-CLI-RUNNER-END-TO-END-GOAL.md) allocates
RR-02/RR-10 and named RR-03–07 consumer dependencies to Experiment Runner,
coordinated with main integration. This supersedes later-stage deferral for
this bounded test. Existing parser, native authority and qualification gates
remain; no execution success is inferred from a valid recipe or mocked run.

This ledger applies to agents implementing the **Runner companion only**.
Read [the two-program boundary](16-COMPANION-APP-BOUNDARY.md), the charter and
testing/workflow requirements first. R1 in the wider catalogue names the whole
Runner; the RR identifiers below divide that allocated application into bounded
work. They are ownership IDs, not application modes or evidence of completion.

## Allocated pass — 2026-09-12

Owner: **Experiment Runner** task, branch `codex/segment-runner-desktop-app`,
isolated `C:/Users/Georgeous/Documents/GitHub/affect-tracker-research-runner`.
Reviewed base `7946bc6` (application `d6acfd1`). Stage: Backend Verification.
Goal: independently launchable desktop Runner, separated from Planner authority,
strict recipe intake, existing native execution composition and Runner-owned XDF
recording. Docs are amended before source separation. User requests authorize
this pass; they do not authorize bypassing installed/physical qualification.

Current source at that base: one desktop executable composes both Planner and
Runner UI/services. Complete strict v1 JS/Rust readers and native package protocol
exist. The native player actor exists but qualified Start is deliberately blocked.
LSL outlets exist; no XDF recorder or external-stream selection exists. P4 accepted
desktop layout and complete successor master dispatch are still producer work.

| ID / owner lane | Function and inputs | Output / consumer | Required evidence and initial status |
| --- | --- | --- | --- |
| RR-01 Desktop composition | Independent Runner bootstrap/config; narrow commands | Separate program, capability/status UI | Implemented: separate native identity/build and both Planner entry guards; headless boundary/production build evidence below |
| RR-02 Recipe intake | Exact Planner bytes and known schema/version | Immutable validated recipe, requirements, rejection reasons | V1 strict intake/parity/rejection implemented; comprehensive successor reader handoff remains open |
| RR-03 Session selection | Valid recipe, explicit participant/language and attempt | Frozen participant/route/version receipt | Preserve v1 explicit schedules; successor allocation policy remains unselected. Open |
| RR-04 Playback/protocol | Bound complete media, ordered video/ISI/form steps | Observed player transitions and protocol events | Native package adapter wired; qualified player Start remains closed pending installed/physical gates |
| RR-05 Feedback/layout | Recipe input/style/mappings and supported layout | Participant feedback from native acquired state | Saved v1 style/mappings/placement parity implemented; successor desktop layout correspondence open |
| RR-06 Questionnaires | Full chosen route and ordered definitions | Durable draft/submitted responses | Separate one-item presenter implemented with frozen labels/codes/required checks; installed participant workflow open |
| RR-07 Acquisition/LSL output | Native input, recipe sampling/emission config | Existing samples and markers on actual LSL clock | Existing Rust authority composed; recorder tap preserves emitted values/timestamps; physical qualification open |
| RR-08 XDF recording | Runner-selected own/external streams, destination | XDF plus selected identities/status/failure receipt | Implemented; unit/worker, selected synthetic transport and independent pyxdf evidence below; device/long-run qualification open |
| RR-09 Records/recovery | Frozen recipe/session/recording identities and journals | Attempts, final receipts and explicit recovery | Existing attempt recovery wired; immutable recording receipts, fail/flush/drain/no-overwrite tested; automatic XDF repair is not offered |
| RR-10 Correspondence/qualification | Exact exported Planner recipe and Runner build | Per-option execution evidence | Last development stage; not a Planner authoring completion prerequisite. Open |

## Runner-only working rules

- Register one lane and named dependencies before implementation. Source
  inspection, implemented component, clean handoff, integrated app and physical
  qualification are separate states. Update the row and exact receipt below.
- RR-02 consumes P7 complete readers. P1 owns declarations; P2 definitions; P3
  ordered variants/ISI/marker semantics; P4 layout; P5 bindings/style/math; P6 XR
  authoring; P7 composition. Request an owner interface instead of copying policy.
- RR-08 recording policy belongs entirely to Runner. Discover/select streams
  explicitly; freeze stream identity and metadata, preserve timestamps and clock
  offsets, report unavailable/disconnected streams and incomplete files. Do not
  record all discovered sources implicitly or overwrite an earlier XDF.
- A v1 recipe need not contain recording options. Keep Runner session choices
  in separately versioned run evidence with recipe hash/attempt identity. A future
  output contract must not add fields silently to old manifests/readers.
- RR-04 and RR-07 remain Rust authorities. No new unsafe adapter, timing bypass,
  hidden allocator, simulated successful run or reduced qualification gate.
- No XR runtime, remote experiment controller, direct sensor SDK or unrelated
  Playground feature enters this desktop allocation. The professor control icon
  is artwork, not authorization to implement a controller protocol.

## Compatibility handoffs and evidence

2026-09-12: P7 confirmed v1 is the only current complete persisted master. Strict
JS/Rust reader APIs and fixture paths are recorded in `66`. New comprehensive
master work is P7-owned; actual Runner correspondence is deliberately last-stage.
Direct researcher answer fixes XDF own+selected external scope and Runner policy
ownership. **Chat Orchestrator** is the named escalation task for uncertain seams.

Baseline: 53 focused Node checks passed on `7946bc6` before mutation (UI, modular
architecture, package and native package-protocol files). No application launch
or physical recording occurred. Subsequent implementation receipts belong here;
none of the open items above is closed by this documentation amendment.

### Desktop boundary checkpoint — 2026-09-12

RR-01 and G11 shared seam implemented: independent `affect-runner` Cargo binary,
Runner Tauri identity/app-data/build entry, exclusive role-based native command
registries. Planner constructs no acquisition runtime and does not expose Start,
resume, finalize or playback commands. Its actual desktop boot removes participant
execution controls before controllers mount, retains seven authoring sections and
Flubber preview, and names the final section **Review & Export**. Historical
combined renderer code remains for legacy static/compatibility paths; this is a
desktop allocation, not a claim that every old module has been deleted.

Runner has its own interface, strict unchanged v1 package intake and compiled
selection, native protocol adapter and shared pure feedback renderer. It imports
no Planner editor or Planner runtime bridge. XDF controls are unavailable until
the separate recorder service is implemented; RR-08 remains open. RR-03–RR-07
remain under implementation/verification, and this checkpoint does not claim
successor-master support or installed native execution qualification.

Evidence: 648 existing Node tests; four new Runner parity/rejection/feedback and
native boundary checks; 199 no-default-feature Rust library tests. Both frontend
builds pass (Planner nine output files, Runner five). Headless Chrome actual app
boot harness `scripts/qualification/companion-boundary-audit.mjs` verifies Planner
title, seven sections, preview, absence of Run controls and native runtime startup
calls; Runner loads the canonical package, contains no Planner editors and keeps
unqualified Start disabled. Both have zero runtime errors, duplicate IDs and page
overflow at 1280 pixels. Native replies in that harness are synthetic. Receipt and
screenshots: `D:/GitHub/.affect-runner-build/boundary-audit/`. No physical input,
foreground application control, native experiment or real stream recording ran.

Static G11 follow-up: Chat Orchestrator allocated the browser entry boundary to
this lane. Static `site/index.html` now explicitly identifies Planner and uses
the same seven-section/preview/Review & Export surface. Its browser bridge skips
participant journal creation/audit/reconciliation, runtime lease, sampling worker,
output-manifest and acquisition storage probes, and refuses a synthetic Start
event. Browser authoring remains in its existing workspace/UI controllers. The
headless harness now checks both Planner surfaces plus Runner, with dependency
traps proving browser Planner startup/refresh/destruction invokes no run service.
Receipt: `D:/GitHub/.affect-runner-build/static-boundary-audit/`. This supersedes
the earlier desktop-only qualification of the entry boundary; historical combined
modules remain testable but are no longer the active Planner entry programs.

### RR-08/09 native recorder implementation — 2026-09-12

Implemented `research_recorder` as a Runner-only Rust service and four commands:
status, explicit discovery, native destination/start and stop. Runner selects
own streams and/or at most 16 cached external stream identities; no Planner
recording field, manifest-v4 extension, source substitution or reconnect policy
was added. Start/stop share the native protocol's idle mutex so IPC races cannot
change recording during Start/resume/active execution.

Own outlets attach before the protocol worker emits initial markers, after
input/storage preparation, and mirror successfully emitted f32/string samples
with exactly the same LSL timestamp through a bounded nonblocking queue. The
external recorder opens selected metadata-bound inlets with recovery and
postprocessing disabled, preserves each numeric wire type and records source
clock offsets. Samples, headers, boundaries and footers use the XDF 1 format.
Numeric Int64 stays integer throughout. No new unsafe boundary was introduced.

XDF and start/attempt/final JSON receipts use exclusive file creation. Every
receipt binds the recipe hash and recording identity; own binding additionally
freezes run ID. Shutdown interrupts the native run before draining/finalizing
the recorder. Buffer loss, disconnection, queue overflow and disk/receipt failures
are explicit incomplete recordings. A start receipt without a final receipt is
an interrupted file; automatic XDF repair/append/restart recovery is not offered.
External arbitrary invalid UTF-8 byte-string fidelity is unqualified because the
pinned safe LSL library decodes strings. See `runner/README.md` for limits and
local build/use commands; physical/long-run recording remains an open gate.

Evidence collected during implementation: nine initial recorder unit/worker
checks plus a selected synthetic local LSL Int64 outlet recorded alongside own
affect/initial/final markers. Independent pyxdf 1.17.0 reads the seven-format
fixture, exact raw timestamps, +0.125 clock correction, Int64 maximum, UTF-8
markers, sample-count footers and both complete worker recordings. The synthetic
fixtures reside in `D:/GitHub/.affect-runner-build/`, with a reproducible verifier
at `scripts/qualification/verify-runner-xdf.py`. Additional final compile/lint and
regression results are recorded in the final checkpoint handoff; these receipts
do not close RR-10 or native playback/device/long-run qualification.

Source checkpoints: `b7d3356` recorder/executable and `8ed7abd` separable legacy
production cleanup, after G11 `a0283d9`, `7e4b719`, `17b2d24` and closure fix
`f48e654`. Final regression count: 653 Node tests and 210 default-feature Rust
library tests pass (two opt-in transport tests excluded from that normal suite;
the new selected-external fixture was separately exercised). Default and
no-default all-target Clippy pass with `-D warnings`. Planner/Runner frontend
builds and Pages closure pass. A standalone Windows Runner executable built with
its own embedded resources/product identity. All-feature compilation is blocked
in this environment by missing pkg-config/GStreamer SDK; this is not a recorder
test failure or permission to weaken native player qualification. Integration
owns merging these checkpoints into its newer P1–P7 master candidate.
