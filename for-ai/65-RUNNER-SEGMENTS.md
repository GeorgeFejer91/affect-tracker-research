# Experiment Runner agent ledger

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
| RR-01 Desktop composition | Independent Runner bootstrap/config; narrow commands | Separate program, capability/status UI | Build both closures; deny cross-app run/write commands. Allocated, open |
| RR-02 Recipe intake | Exact Planner bytes and known schema/version | Immutable validated recipe, requirements, rejection reasons | Corrupt/unknown/incomplete/stale inputs reject; canonical parity. Allocated, open |
| RR-03 Session selection | Valid recipe, explicit participant/language and attempt | Frozen participant/route/version receipt | Preserve v1 explicit schedules; successor allocation policy remains unselected. Open |
| RR-04 Playback/protocol | Bound complete media, ordered video/ISI/form steps | Observed player transitions and protocol events | Exact ordering; pause/interval/restart/failure; native qualification stays open |
| RR-05 Feedback/layout | Recipe input/style/mappings and supported layout | Participant feedback from native acquired state | Saved settings parity, hide/size/position, no preview draft fallback. Open |
| RR-06 Questionnaires | Full chosen route and ordered definitions | Durable draft/submitted responses | Labels/codes/required answers and safe boundary recovery. Existing engine, separate UI open |
| RR-07 Acquisition/LSL output | Native input, recipe sampling/emission config | Existing samples and markers on actual LSL clock | No WebView clock authority; preserve frozen outbound schema. Existing engine, composition open |
| RR-08 XDF recording | Runner-selected own/external streams, destination | XDF plus selected identities/status/failure receipt | Native typed samples, source clock offsets, no invented samples, independent XDF read. Allocated, open |
| RR-09 Records/recovery | Frozen recipe/session/recording identities and journals | Attempts, final receipts and explicit recovery | Exclusive paths, no overwrite, flush/failure/shutdown/restart checks. Existing engine, recorder binding open |
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
