# Central segment roadmap and capability checklist

**Active goal — 2026-09-12:** finish the Planner as a comprehensive JSON authoring
interface. Every P1–P6 segment, including experiment-defining Flubber/live
configuration, must contribute to one validated, saveable and editable master.
See [67-PLANNER-COMPLETION-GOAL.md](67-PLANNER-COMPLETION-GOAL.md) for current
assignments, concrete source gaps and evidence. Final Planner–Runner correspondence
is explicitly deferred to the last development stage. The separate-program and
Runner-owned recording amendment in [16](16-COMPANION-APP-BOUNDARY.md) supersedes
older one-program/two-mode wording below.

This is the central **final-state Planner roadmap**, segment contract map and
capability checklist requested by the researcher on 2026-09-11. Every future
agent must answer: **What is my segment supposed to do? What does it already
do? Which of its capability items remain?** Read the whole map for context,
then work only on the assigned segment and explicitly named shared seams.

**Current priority: finish the experiment Planner.** Runner responsibilities
are downstream contracts; Runner implementation, recording and runtime
qualification are deferred unless separately allocated by the researcher.

## Authority, status and evidence

- The dated amendment in [the charter](15-RESEARCH-V1-CHARTER.md) adopts this
  roadmap as the final-state capability and ownership plan. Accepted decisions
  below supersede conflicting old product-direction wording. Existing v1 JSON,
  records and reader semantics remain frozen until explicit versioned changes.
- This file owns segment capability checkboxes and unresolved product decisions.
  [40-ROADMAP.md](40-ROADMAP.md) retains implementation/qualification receipts;
  [61-IMPLEMENTATION-AUDIT.md](61-IMPLEMENTATION-AUDIT.md) is the detailed dated
  source audit; [30-TESTING-AND-RELEASE.md](30-TESTING-AND-RELEASE.md) owns claim
  gates. Requirement approval is not implementation evidence.
- [62-PLANNER-CLOSURE-PLAN.md](62-PLANNER-CLOSURE-PLAN.md) ranks remaining gaps and
  supplies concrete proposed editor/contribution designs and single-owner passes.
  Its new recommendations remain proposals; this file owns capability status
  and accepted decisions. Complete-component handoffs are now recorded in
  [67](67-PLANNER-COMPLETION-GOAL.md); final shared authoring/save/Open validation
  and canonical delivery remain incomplete. Older baseline rows below must not
  be read as an assertion that those newer components are still absent.
- Initial status baseline: integrated source
  `305d3ac6b2de40a27436f7c97cb1ee2d2a2e87ce`, audited 2026-09-11. Unmerged branches
  and private/installed runtime state are excluded from completion claims.
- `[x] Implemented component` means the narrowly stated behavior is present at
  that baseline, with the linked source/test evidence. It does not mean the
  whole segment, every platform or research qualification is complete.
- `[ ] Partial` means incomplete capability; `[ ] Missing` means absent from
  integrated source; `[ ] Decision` means unresolved researcher/contract input;
  `[ ] Deferred` means deliberately later work. Never tick an unresolved target.
- Do not invent percentage completion. A segment is complete only when its
  required items, JSON round trip and applicable gates close. A worktree result
  remains **pending integration** until collected and verified in canonical source.

## Accepted final-state decisions

1. Planner UI contributions compile into **one downloadable master JSON
   experiment recipe**. Researchers do not write or combine JSON by hand. A
   compatible Runner reconstructs the experiment from that JSON and referenced
   media; video bytes need not be embedded in JSON.
2. P1 owns workspace/library authoring and video annotations derived from the
   full relative file location. The 2026-09-12 Q04 answer explicitly includes
   filename and extension, e.g. `calm/forest.mp4` → `calm_forest.mp4`. Distinct
   legal paths must yield distinct IDs; do not introduce collisions by lossy
   normalization or require manual ID repair. Use an unambiguous reversible
   encoding for nesting/separators/literal characters when necessary. Immutable
   byte identity remains separate; relocation authorization remains Q05.
3. P2 has an extensible language catalogue. English and German are current
   priorities, not the only languages. Each selected language needs complete
   accepted questionnaire content and scoring annotations.
4. P3 accepts Excel paste with **one column per version and chronological video/
   ISI rows**. A video-ID cell plays that fixed-duration video. The researcher
   enters comma-separated millisecond values in an ISI field, producing a
   dictionary such as `ISI1=1000`, `ISI2=1500`, `ISI3=2700`. The version table uses
   **named ISIs only**, e.g. `video1`, `ISI1`, `video2`, `ISI2`; raw numbers are
   not accepted in table cells. The Planner derives start/stop events from these
   references. Give each video ID a consistent
   distinct color and all ISI values red, with textual type/value cues too.
   The researcher authors the variants; the app preserves the orders.
   All illustrated names/values are examples: durations, number of ISI entries
   and variant sequences are researcher-defined, with no fixed three-item list
   or prescribed timing presets.
5. **Latest answer in S3, 2026-09-11: “Leave allocation policy to Runner.”**
   P3 authors ordered variants and their identities, without participant-assignment
   UI or a Planner-selected allocation algorithm. This supersedes the earlier
   example of repeating V1…V4 by participant ordinal; that example is no longer
   a Planner requirement. Variant ID remains distinct from schema version.
6. P3 defines marker/event meaning so recorded LSL streams can identify and
   reconstruct stimulus/ISI boundaries. **Runner owns actual timestamps and
   recording.** Recording implementation is outside current Planner scope.
7. Remove the standalone old Experiment, Visual and Advanced UI sections.
   Consolidate input/controller, Flubber appearance and advanced animation
   controls beside the live preview. Necessary retained values still have one
   owner; their proposed homes below are recommendations awaiting confirmation.
8. Add Screen & Layout with whole-screen/video/Flubber miniature preview,
   physical or relative sizing, reference-video analysis, and placement defined
   by **Flubber centre relative to each displayed video's centre**. Percentage
   offsets use **one fixed reference area for all videos**, as confirmed.
9. Add optional XR spatial authoring and a rotatable 3D preview. Content is
   **fixed in virtual space, aligned to the participant's forward direction at
   setup**. This accepted future direction is not current APK/WebXR support.
10. Under the later two-program amendment in [16](16-COMPANION-APP-BOUNDARY.md),
    **Setting Up the Experiment** belongs to Experiment Planner and **Running
    the Experiment** belongs to the separate Experiment Runner. The Planner has
    no participant Start/Run surface. P1–P7 are responsibility IDs, not extra modes
    or necessarily seven identical accordions.
11. The later 2026-09-11 requirement relayed by **Add segment confirmation flow**
    makes segment confirmations accept the current segment's contribution in
    sequence, rather than only recording that its screen was reviewed. Live
    Preview is the exception: P7 captures its final settings, then offers a
    popup to name and save the final JSON. Review, accepted contribution and
    acknowledged persistence remain separate states; edits invalidate affected
    acceptance. This records product intent, not an implemented workflow or
    approval to bypass the stage/contract gates. Integration owns confirmation
    orchestration and P7 owns final naming/save semantics.
12. The 2026-09-12 goal requires complete modular P1–P6 authoring, including active
    experiment-defining Flubber/live settings, strict JSON export and editable
    reopen. Temporary test movement/inspection is distinct from configuration.
    P7 owns the successor wire shape; historical v1 readers remain supported.
13. Planner completion is the current goal; final correspondence with the
    still-developing Runner is a later final-stage check. Stream recording policy
    belongs to Runner sessions under the direct correction adopted in `16`;
    recorder selection/destination are not missing Planner fields. Authored
    emission configuration and experiment event/marker meaning remain Planner-owned.

## Segment map and single owners

| ID / owner | Final responsibility | Main JSON contribution | Baseline state |
| --- | --- | --- | --- |
| P1 `workspace` | Workspace, study identity, video catalogue | Workspace reference, metadata, assets and media geometry | Partial |
| P2 `questionnaires` | Items, scoring and languages | Definitions, variants, modules and coverage | Partial |
| P3 `variants` | Event columns, ISIs and markers | Ordered variants and event definitions; Runner owns allocation | Missing target workflow; explicit-plan predecessor exists |
| P4 `layout` | Video fitting and centre-relative Flubber layout | Units, reference geometry, offsets, size and fit policy | Missing target workflow; normalized placement exists |
| P5 `feedback` | Flubber/input/Advanced editor and live preview | Input configuration, visual style and mappings | Partial; old controls distributed across sections |
| P6 `xr-layout` | Optional world-fixed spatial recipe and 3D preview | Spatial profile, alignment and target requirements | Owner-ready authoring and live P1/P5 binding; integration/master round trip pending |
| P7 `package` | Recipe validation, save/reopen and export | Versioned master JSON, playback/output policy and integrity | Partial; strict v1 compiler/readers exist |
| R1 `runner` | Execute, timestamp and record | Consumes recipe; produces measurements/events/recordings | Deferred implementation; v1 components exist |

Homes for retained settings: P1 study name/ID; P7 retained study/count metadata,
sampling rate and authored stream-emission definition. Participant allocation,
recording policy, recorder selection and destination belong to Runner. P4 owns
desktop size/placement; P5 owns appearance/input. Controls shown in multiple
previews edit one owner. The complete current wire contract is P7's
`docs/planner-master-recipe-v1.md`; historical baseline proposals below do not
override the dated companion boundary or the active completion goal.

## Mandatory segment brief and update discipline

Before editing, every agent records in its pass/board entry:

1. Assigned segment ID and exact checklist IDs; intended capability.
2. Required user input, owned JSON contribution, producers and consumers.
3. Current source snapshot and implemented/partial/missing evidence.
4. Remaining items, open decisions and the smallest useful next slice.
5. Allowed files/symbols, shared seams, dependencies and proportional checks.

An allocation to one segment does not authorize implementing another segment's
dependencies. Read its contract and use documented interfaces. Record an unmet
interface as a dependency with its owner in the message board. Ask only for
missing information; do not re-request accepted decisions. Pending questions
block dependent implementation only, not independent work in the assigned scope.

At handoff update only your segment's items, relevant decision answers and
uniquely owned board entry. Every newly checked item needs exact source/commit,
tests actually run, platform, limitations and integration state. Keep detailed
receipts in `40-ROADMAP.md`. Keep the implementation audit dated, or explicitly
re-audit it. Do not rewrite other
segments' status or equate preview behavior with saved/Runner behavior. Follow
[50-AGENT-WORKFLOW.md](50-AGENT-WORKFLOW.md) for isolation and convergence.

A separately allocated `roadmap`, `contracts`, `media`, `timing`, `lsl` or
`integration` pass is a bounded owner too; name its exact checklist dependencies.
It never grants whole-project implementation. A Planner task must not silently
turn into Runner, device or recording work.

## P1 — Workspace & Video Library

**Purpose:** establish the study workspace and one reusable video catalogue.
**User input:** working directory, study name/ID and imported folders/files.
Location IDs are automatic under answered Q04; physical relocation is Q05.
**Receives:** user-selected files/directory through the owning platform adapter.
**Produces:** catalogue locations with an automatic reversible path ID, immutable
content identity, file reference, hash, length, duration and display geometry.
**Consumers:** P2 source storage; P3 video IDs; P4/P6 geometry; P7 assets.
**JSON:** versioned P1 workspace/catalogue contributions use only the fixed logical
layout `assets`, `assets/stimuli`, `experiment.package.json`; v2 catalogue entries
bind the `{assetId, annotationId}` content/location reference pair.

- [x] **P1-01 — Implemented component:** browser/native workspace selection and authorization (`workspace.js`, `research_workspace.rs`).
- [x] **P1-02 — Implemented component:** declared-asset verification binds safe paths, hashes, byte lengths and duration. Decode qualification remains separate.
- [x] **P1-03 — Implemented component:** browser/native Planner import and rescan use `assets/stimuli/`, preserve safe relative subfolders and reject conflicting overwrite.
- [x] **P1-04 — Implemented component:** v2 derives a reversible, NFC-exact location ID from every relative path component and filename extension. `_`, `%` and leading spreadsheet formula characters are escaped; unsupported whitespace/non-NFC paths reject; collisions are hard errors. Moving/renaming changes the location ID without changing equal content identity.
- [ ] **P1-05 — Partial / Q05:** authored JSON stores only the fixed logical layout and relative declarations. Reopen requires explicit fresh root authorization plus exact rehash/reprobe. A custom native workspace choice remains session-local; absolute provenance and permission persistence are not compile authority.
- [ ] **P1-06 — Partial:** browser decoder-oriented geometry and a safe native GstPlay orientation/PAR/square-pixel snapshot receipt feed catalogue v2. Pure/browser checks pass; installed GStreamer runtime qualification remains open, and ambiguous/missing/reflection metadata stays pending.
- [x] **P1-07 — Implemented component:** v1/v2 library content restores through a latest-operation fence, remains pending until exact media rebind and invalidates dependents on path, byte, duration or geometry change. P7 still owns master save/reopen composition.

**Acceptance:** collisions, rescans and moves have explicit outcomes; each ID
resolves to declared bytes after export/reload. No second catalogue or directory-
order experiment is created.
**Source:** [browser workspace](../site/src/research/workspace.js),
[native workspace](../src-tauri/src/research_workspace.rs), [audit](61-IMPLEMENTATION-AUDIT.md).
**Boundary:** P1 does not allocate participants, order events or lay out the screen.

## P2 — Questionnaires & Languages

**Purpose:** author questionnaire content and recorded scoring in all selected
languages, with EN/DE first and further languages using the same model.
**User input:** languages, family/title/instructions, wording, required flags,
option labels/codes, imports/paste and intended administration placement.
**Receives:** P1 storage capability and explicit source content.
**Produces:** per-language definitions, item/option IDs, scoring annotations,
modules and exact coverage.
**Consumers:** P3 placements; P7 compilation; R1 language/form rendering.
**JSON:** existing `settings.questionnaires` and `languageSelection`; added
presentation/scoring semantics need explicit ownership/versioning.

- [x] **P2-01 — Implemented component:** single-choice definitions, distinct labels/nullable numeric codes, hashes and module references.
- [x] **P2-02 — Implemented component:** family×language coverage and terminal-language references; picker already supports more than EN/DE.
- [x] **P2-03 — Implemented component:** bounded sheet editing/paste, file normalization and dirty/invalid compilation gates.
- [ ] **P2-04 — Partial:** full-content restore/snapshot from `74e879b`/`ae47df6` is in canonical `ba2110f`; P7's owner branch `6bac40f` consumes it for package load/Edit recipe and acknowledged save (27-case Chrome check on 2026-09-12). Combined canonical integration remains open. Invalid draft durability remains Q13. Historical language-neutral or colliding slots reject editable restoration explicitly; nested language roster editing remains unsupported.
- [ ] **P2-05 — Partial:** MAIA-2 EN/DE each supply 37 items and six labelled/coded options. Preserve source-specific annotations: supplied EN uses forward codes without subscales; DE includes supplied reverse codes and eight subscales. This is not proof of equivalent computed scoring. TAS EN remains rights-gated, DE is absent; neither catalogue entry is ready. Further-language authoring is verified using a synthetic EN/DE/FR round-trip and missing-FR rejection, not an invented instrument translation.
- [ ] **P2-06 — Decision:** placement, computed totals/subscale scoring beyond explicit option codes, and missing-answer behavior (Q09). Explicit reverse-coded option values already work.
- [ ] **P2-07 — Owner implementation ready, integration open:** versioned P2 recipe companion preserves label repetition 1/5/10, validates one-to-one definition identity/hash/order, notifies acceptance revisions, supports undo and guarded editable restore. Frozen legacy exports still reject unsupported repetition. P7 owns new master embedding; future Runner correspondence is a separate last-stage gate. See `docs/planner-p2-questionnaire-recipe.md` and the 2026-09-12 roadmap receipt.
- [ ] **P2-08 — Partial:** EN/DE code edits and synthetic EN/DE/FR contributions survive independent-process byte-identical re-export. P7 `6bac40f` passes 27 Chrome cases including wording edit, delayed acknowledgement, exact German definition/nested routes and explicit reopen draft reset. P7 is extending the combined fixture for code-only edits and acceptance metadata; canonical integration and Runner proof are not implied.

**Acceptance:** each selected language has exact required definitions; labels
and codes remain distinct; missing variants reject; imports preserve declared
content. No implicit translation/fallback supplies coverage. Existing module
placements remain explicit.
**Source:** [authoring](../site/src/research/questionnaire-authoring.js),
[editor](../site/src/research/questionnaire-editor.js),
[coverage](../site/src/research/questionnaire-assets.js),
[contracts](../site/src/research/questionnaires.js).
**Boundary:** P2 does not allocate participants, schedule videos or record answers.

2026-09-12 P2-04/P2-08 successor evidence: six pure tests include a shared
JavaScript/Rust canonical fixture and two independent byte-identical editable
round-trips. Actual-app Chrome checks cover every EN content field, codes,
required flags, untouched German content, nested routes, presentation-only
changes/undo, malformed imports, and stale/concurrent/disposed restore fencing.
The owner contribution is ready; combined P7 export/reopen remains integration
work, not an implied complete master or Runner claim. Q09/Q13 and source rights
remain as listed above.

## P3 — Versions, Timing & Markers

**Purpose:** turn researcher-authored event columns into repeatable variants
and a complete planned event/marker contract.
**User input:** comma-separated ISI durations in milliseconds, creating a named
dictionary; one Excel column per variant with video IDs and ISI names in
chronological rows. Videos have fixed catalogue durations. Q02 now accepts
repeated videos, leading/consecutive/terminal ISIs and unequal column lengths
with trailing padding; interior blanks reject. Questionnaire placement remains Q09.
**Receives:** P1 catalogue/durations and P2 module references.
**Produces:** embedded ISI dictionary, ordered variants with named references,
occurrence IDs, timing requirements and semantic marker definitions.
**Consumers:** P7 embeds; R1 resolves participants and timestamps actual events.
**JSON:** explicit v1 participant schedules are a predecessor; ordered variants
and their Runner-selection boundary require a successor recipe contract.

**Columns = versions; rows = chronological video/ISI references.** With ISI
input `1000, 1500, 2700`, the dictionary is `ISI1=1000ms`, `ISI2=1500ms`,
`ISI3=2700ms`, and a version column can be as below. This is illustrative only;
the researcher supplies the durations, entry count and experiment sequences.
Neither these times nor this number of entries is a required preset.

```text
V1
video1
ISI1
video2
ISI2
```

Resolve video IDs through P1 and ISI names through P3's dictionary. The Planner
expands references into video start/end and ISI start/end definitions; the
researcher need not type marker names or manually enter video duration. Raw
numeric table cells must report that an ISI dictionary reference is required.
Diagnose unknown or colliding video/ISI identities instead of guessing. Existing
integer timing limits remain the baseline unless explicitly changed. Define
the accepted exact-order grammar; do not repair or randomize input.

The master recipe embeds the ISI dictionary and every version's references;
no external dictionary file becomes Runner authority. P3 owns both. Q14 records
the accepted named-only rule, which supersedes the earlier numeric-cell proposal.

Accepted Q14 behavior: preserve ISI IDs when the duration list is edited;
never silently renumber a referenced entry. A changed duration invalidates every
referencing version/compiled recipe; deletion with live references must be
resolved explicitly. All ISI cells remain red and show their resolved millisecond
value alongside the ID. Duplicate durations are allowed under distinct names;
video/ISI identity collisions and malformed comma-list values reject.

The later Q06 answer leaves allocation policy to Runner. Preserve each variant's
identity and authored order without selecting a participant or defining a cyclic
policy in Planner. The successor contract must explicitly identify this boundary;
its exact wire representation is owned by P3/P7, not fixed by this document.

- [x] **P3-01 — Implemented predecessor:** strict imported block/video schedules, per-video ISIs and deterministic protocol resolution exist; no variant allocation is implied.
- [ ] **P3-02 — Component ready, integration pending:** named-ISI/video-column editor and atomic paste with precise errors; compact actual-boot empty/populated/error renders. Planned offsets wait for P1 verified durations.
- [ ] **P3-03 — Component ready, integration pending:** pure paired-boundary derivation and accepted Q02 validation exist; the P1-owned workspace projection now binds identity/duration and the registered workspace revision, with study-only/video-change fixtures. Missing durations reject rather than invent timing; combined live subscription remains the composition owner's handoff.
- [ ] **P3-04 — Component ready, P7 integration pending:** typed contribution embeds versioned ordered variants and `runnerAssigned` ownership; no participant controls or allocation algorithm.
- [ ] **P3-05 — Component ready, integration pending:** unique entry IDs preserve repeated occurrences; marker execution IDs distinguish restarts.
- [ ] **P3-06 — Specification ready, integration pending:** versioned marker envelope defines recipe/run/attempt/variant/version/entry/execution identities, sequence and observed monotonic time. Runner emission is deferred.
- [ ] **P3-07 — Specification ready, integration pending:** synthetic reconstruction fixtures cover video/ISI/forms, pauses, interruptions/restarts and incomplete streams; no recorded-stream qualification claim.
- [ ] **P3-08 — Component ready, integration pending:** JS/Rust canonical fixtures, native/browser save/reopen and standalone contribution validation preserve exact order without randomization or cell repair. Async ready-media restore binds registered P1; content-only restore renders editable saved fields pending on actual P1 until media rebind. Latest-request/edit/withdrawal/teardown guards prevent stale mutation. Preparation requires no authoring sidecar write; P7 registry acceptance and final persistence remain separate. See `docs/planner-p3-contribution-api.md` and the workspace-binding fixture.
- [ ] **P3-09 — Component ready, integration pending:** distinct consistent video colors, red ISIs and textual type/ID/duration cues; actual narrow-pane rendering inspected.
- [ ] **P3-10 — Component ready, integration pending:** comma-separated whole milliseconds create stable names; duplicate values allowed, referenced deletion blocked, edits invalidate acceptance. Q14 lifecycle rules accepted.

Component checkpoint `ae5cecd`, reconciled with canonical base in `bc8921d`.
Keep these unchecked until collected and verified on the integration branch.
Current implementation consumes the v1 hash-bound video library; P1's future
immutable assetId/readable-name schema is not silently inferred. See
[variant model](../site/src/research/variant-design.js),
[native mirror](../src-tauri/src/research_stimulus_order/variants.rs), and
[marker contract](../docs/planner-marker-contract-v1.md).

**Marker boundary:** Planner owns definitions/expected sequence; Runner owns
actual timestamps/recording. Predicted duration or Play request is not measured
visible onset. Events must be identifiable without the source spreadsheet.
The bounded planned profile is specified in the linked contract; an implemented
Planner contract does not change the existing runtime marker payload.

Current native package markers contain only `event:<eventType>`; richer local
records are not carried in the payload. Existing LSL outlets therefore do not
prove video identity reconstruction. See `event_marker` in
[native runtime](../src-tauri/src/research_native_protocol/runtime.rs) and
[LSL service](../src-tauri/src/research_lsl.rs).
**Boundary:** implement Planner definitions/fixtures here, not Runner recording.

## P4 — Screen & Layout

**Purpose:** preview and define a reproducible video/Flubber arrangement for
mixed video sizes.
**User input:** physical screen dimensions or relative mode, reference method,
Flubber size, centre offsets and required calibration/reference choices (Q08).
**Receives:** P1 display geometry and P5 style/maximum animation extent.
**Produces:** screen profile, units/reference, video fit, Flubber footprint and
centre-relative arrangement with whole-screen miniature preview.
**Consumers:** shared P5 preview, P7 serialization and R1 rendering.
**JSON:** new layout contract; normalized v1 `overlayPosition` is insufficient.

Accepted relationship after video fitting:
`flubberCentre = videoCentre + (offsetX, offsetY)`.
`offsetX=0` places centres on the same vertical line. Right-positive x/down-
positive y and a fixed animated Flubber design centre are explicit in the
accepted successor contract.
The researcher confirmed fixed-reference percentages across all videos; save
that reference explicitly rather than scaling offsets per video. Largest pixel resolution alone
does not resolve widest/tallest aspect-ratio constraints. Check every fitted
video and animation extent without silently using per-video bottom-edge alignment.

- [x] **P4-01 — Implemented predecessor:** normalized feedback placement/size and Run locking remain preserved; successor centre-offset/calibrated contracts are tracked below.
- [ ] **P4-02 — Component ready, integration pending:** whole-screen miniature consumes complete P1 v1/v2 geometry and P5 v1/v2 owned painted bounds. Invalid or unselected inputs withdraw geometry; inspection never changes saved placement.
- [ ] **P4-03 — Component ready, integration pending:** required per-recipe choice between largest oriented video by pixel area and combined maximum-width/height envelope, with no default. Automatic analysis then defines one fixed reference; contain fitting, right/down axes and fixed design centre are explicit.
- [ ] **P4-04 — Component ready, integration pending:** relative/mm authoring requires measured active dimensions and full-viewport mapping for uniform conversion; geometry and maximum painted bounds are preserved.
- [ ] **P4-05 — Component ready, P7 integration pending:** strict `affect-research-desktop-layout-contribution` v1, live prepare and guarded ready/content-only reopen share the same centre/geometry owner. P7 owns final master persistence; Runner application remains deferred.
- [ ] **P4-06 — Component ready, integration pending:** all unique P1 content assets are checked for aspect-preserving fit, full P5 animation bounds, overlap/gap/clipping; exact observed viewport mismatch rejects. No physical monitor attestation or runtime resizing is implied.
- [ ] **P4-07 — Component ready, integration pending:** both explicit methods and relative/mm profiles pass canonical JS/Rust geometry fixtures, independent-process reproduction and actual-app accepted layout export/reload against the preview. Final combined master evidence remains P7/integration work.

**Acceptance:** preview and saved geometry agree; units/reference are explicit;
mixed videos retain the chosen relationship; missing calibration/impossible fit
has an explicit outcome.
**Source predecessor:** [settings](../site/src/research/contracts.js),
[preview](../site/src/research/preview.js), [UI](../site/src/research/app.js).
**Boundary:** P4 owns geometry, not colors, input or animation parameters.

**Historical P4 branch evidence, 2026-09-11:** `codex/segment-p4-screen-layout`
contains a non-exportable UI draft for P4-02/P4-04/P4-06: numeric screen/reference/
offset controls, a whole-screen miniature, proposed measured unit conversion and
pure fit/overlap/clipping fixtures. Q08 choices remain proposals. The application
does not yet consume P1 geometry or P5 bounds; synthetic inputs are confined to
non-shipping verification fixtures. No accepted JSON contribution, persistence,
runtime application or export/reload is implemented, so completion boxes above
remain unchanged. See the [P4 evidence ledger](./40-ROADMAP.md#p4-screen--layout--non-exportable-design-draft).

**Historical 2026-09-12 owner-ready follow-up:** `f8654bf` in the isolated live-geometry
branch now binds actual P1/P5 producers, preserves the registered P1 workspace
revision, validates whole-library fit, and supplies atomic internal draft
restoration/P7 pending snapshots. Automatic largest-reference metric remains
Q08; neither candidate is silently chosen. Accepted P4 JSON and master recipe
round-trip remain absent, so the capability boxes stay open. Final evidence is
563 Node tests, 118 actual Chrome app checks/four inspected captures and both
frontend closures; see the [live P4 ledger](./40-ROADMAP.md#p4-live-geometry-and-draft-restoration--2026-09-12).

**2026-09-12 Planner completion:** coordinator `84300ed` clarifies both Q08
methods as explicit recipe parameters, without choosing a global default. Pure
accepted/native checkpoint `d0267fff` and the subsequent live preparation/reopen
work implement this direction. Final component source `77e4752` passes 680 Node,
203 no-default Rust, both builds and 231 clean-source Chrome assertions across
six inspected scenes. See [the exact contract and API](../docs/planner-p4-layout-contract.md)
and [final component evidence](./40-ROADMAP.md#p4-accepted-planner-layout--2026-09-12).
Integration/P7 own the remaining combined acceptance and master save/reopen
receipts; Runner remains separately deferred.
Current internal draft v2 adds a nullable method; explicit restoration of frozen
v1 drafts leaves that new choice unselected. Capability boxes remain open until
collected on the combined source. Runner correspondence is the final separately
allocated stage and does not block Planner authoring completion.

## P5 — Flubber & Controls

**Purpose:** one persistent editor for configured Flubber/Grid/procedural-Face
feedback and input/response behavior, with Advanced animation settings at the bottom.
**User input:** device/bindings, response behavior, colors/style/visibility and
explicit animation/mapping edits. Q10's current configured choices are now
allocated for complete Planner serialization; execution remains downstream work.
**Receives:** P4/P6 layout and explicit preview-test input.
**Produces:** one versioned input, response, presentation and affect-mapping set;
live preview projects these values.
**Consumers:** P4/P6 composition, P7 recipe and R1 adapters.
**JSON:** `affect-research-feedback` version 2, embedding the retained strict
input/visual/mapping objects plus explicit presentation and response. The exact
old three-key reader remains available; loading it does not invent V2 fields.

- [x] **P5-01 — Implemented component:** strict bindings/presets and saved digital step semantics; physical device qualification remains separate.
- [x] **P5-02 — Implemented component:** saved Grid/Flubber appearance, colors and six affect mappings.
- [x] **P5-03 — Implemented component:** live preview and input-test surfaces; configured response is saved in V2 while test movement, holds and capture state stay transient.
- [ ] **P5-04 — Pending integration:** isolated `8d3d256` consolidates old Input/Visual/Advanced with one value owner and bottom Advanced; canonical verification remains required.
- [ ] **P5-05 — Owner implementation ready:** complete active-control inventory and explicit units/authority are in `docs/planner-p5-feedback-v2.md`. Q10 now promotes the current renderer, response grid/timing/hold, halo, palette placement and applied labels. Test position, captures, un-applied dialogs and inspection framing remain transient.
- [ ] **P5-06 — Owner implementation ready:** `95b2e9`/`781886c` add complete strict V2 JS/Rust readers, shared fixtures, explicit authoring initialization and exact V1 compatibility. Controller wiring captures every active field, with unavailable legacy scalar/geometry/visibility controls clearly disabled in V2; no silent legacy export. Combined P7 master verification remains pending.
- [ ] **P5-07 — Owner implementation ready:** full saved V2 renderer/halo bounds and live revisions, atomic restore and transient reset at `5c9d3df`; 13 shared JS/Rust bound cases cover all three renderers, gradient/response modes and hidden output. P4/P6 consume the dispatch helper; combined accepted master round-trip remains the integration gate.
- [ ] **P5-08 — Owner verified, pending integration:** clean combined `38684c3` passes 668 Node checks and desktop11/Pages219 closures; actual-controller V2 restoration passes 129 checks at each of 1280/800, plus 15 reset checks per width and 84 long-label layout checks. Narrow restored and all four long-label captures were inspected after Preview's bounded repair. Final compact-axis follow-up `5c0ad7a` passes 38 focused tests, 258 restore and 122 expanded label checks plus both closures; both axis captures inspected and full accessible/hover/editor/saved labels preserved. Native P5 tests/Clippy remain bound to unchanged implementation at `5c9d3df`. Physical input and installed accessibility/Runner correspondence are deferred, not Planner completion gates.

**Acceptance:** saved edits survive preview/export/reopen; temporary test movement
does not become participant data or stored response rules. Animation speed is
distinct from the acquisition sample rate in recording policy.
**Source:** [input](../site/src/research/input-controller.js),
[contracts](../site/src/research/contracts.js),
[preview](../site/src/research/preview.js), [mappings](../site/src/research/mappings.js).
**Boundary:** no allocation, sampling clock, LSL transport or screen calibration.

**Current candidate receipt:** [2026-09-12 complete Planner feedback settings](./40-ROADMAP.md#p5-complete-planner-feedback-settings--2026-09-12).
Unchecked items remain unchecked until integration and the applicable gates;
the successor implements the newly allocated Q10 saved additions and preserves
P4/P6 geometry ownership. See the [complete P5 contract](../docs/planner-p5-feedback-v2.md).

## P6 — Optional XR Spatial Layout

**Purpose:** author a spatial presentation profile in the same recipe for a
future compatible VR APK/WebXR Runner.
**User input:** XR selection, video spatial/angular size, distance, centre
azimuth/elevation, orientation and relative Flubber offset.
**Confirmed:** world-fixed content, aligned to participant forward direction at
setup. Q11 answered in S6 on 2026-09-11: head-forward without eye tracking;
retain one anchor per attempt, recenter between attempts, stop on tracking loss.
**Receives:** P1 geometry, P5 feedback/input requirements and P4 centre semantics.
**Produces:** world-fixed spatial profile, alignment/target requirements and
rotatable 3D preview. **Consumers:** P7 and later R1 XR adapters.

- [ ] **P6-01 — Pending integration:** strict separate `XrLayoutProfileV1` authoring contribution and explicit WebXR target; P7 successor master embedding remains open.
- [ ] **P6-02 — Pending integration:** metre/angle controls, plane tilt, rotatable front/side/top inspection and oriented-media fitting; actual P1 workspace geometry/subscription is connected and validated in the owner candidate.
- [ ] **P6-03 — Pending integration:** declared right/up/back metre frame, world-fixed initial-head-forward policy and rotated local feedback centre; pure JS/Rust transform fixtures pass.
- [ ] **P6-04 — Answered, pending integration:** Q11 confirmed policies are explicit in the strict profile. Actual alignment/tracking enforcement remains deferred P6-06.
- [ ] **P6-05 — Pending integration:** live P1/P5 dependency binding, atomic canonical profile reopen, invalid/stale/target rejection, full P5 envelope conversion and pure independent-process geometry reproduction pass. Footer preparation is separate from P7 acceptance/save; finished master recipe round trip remains P7 work.
- [ ] **P6-06 — Deferred:** headset/APK/WebXR execution, LSL recording and physical qualification belong to a separate Runner pass.

**Planner acceptance:** spatial profile round-trips with reproducible transform/
angle fixtures; the preview does not claim headset accuracy. World-fixed is not
a measured-eye-tracking requirement. No active XR implementation exists at baseline.
P6 worktree source/contract and exact limits are in
[63-P6-XR-LAYOUT.md](63-P6-XR-LAYOUT.md), with receipts in
[40-ROADMAP.md](40-ROADMAP.md#p6-virtual-screen-authoring--2026-09-11).
These component results do not close canonical capabilities before integration.
**Boundary:** no unrelated Playground restoration or device work merely to finish authoring.

## P7 — Review, Recipe & Export

**Purpose:** validate accepted contributions and produce one saveable/reopenable
recipe for a compatible Runner.
**User input:** final review/export destination and retained acquisition/output
choices; responses to actionable validation errors.
**Receives:** P1–P6 contributions, IDs and dependency revisions.
**Produces:** canonical master JSON, exact save receipt and editable reopen state;
compiler owns derived integrity. **Consumers:** researcher/workspace and R1.
Retain the existing explicit complete-video playback policy unless the researcher
separately changes it; removing old UI sections must not orphan playback semantics.

- [x] **P7-01 — Implemented component:** strict canonical v1 construction/readers and independent-process reproduction fixtures.
- [x] **P7-02 — Implemented component:** embedded questionnaire content, media declarations and integrity form one v1 JSON.
- [ ] **P7-03 — Partial:** full UI create→save→reopen→revise→export without required imported `experiment.json`; plan authoring and language locks remain gaps.
- [ ] **P7-04 — Partial:** await actual native save success before completion/locking; handle cancellation/failure/retry (audit F03).
- [ ] **P7-05 — Missing:** successor contracts for variants/Runner-selection boundary, directory representation, geometry, saved feedback additions and optional XR; preserve v1 readers.
- [ ] **P7-06 — Missing:** cross-reference/language/geometry/marker/target validation with errors routed to owning segments.
- [ ] **P7-07 — Missing:** invalidate stale compiled output after contribution edits; recompute derived data without overwriting unrelated choices.
- [ ] **P7-08 — Decision:** retained metadata/acquisition/recording fields and export/reopen policy (Q12/Q13); recording implementation stays deferred.
- [ ] **P7-09 — Missing:** independent recipe reproduction for variants×languages×presentation profiles, including invalid/missing-media cases.

**Acceptance:** no raw JSON authoring prerequisite; every required value explicit;
embedded forms need no reopened source document; assets resolve; exact saved
bytes/hash are confirmed. An old reader cannot silently discard target fields.
**Source:** [JS package](../site/src/research/experiment-package.js),
[Rust mirror](../src-tauri/src/research_experiment_package.rs),
[fixture](../test/fixtures/experiment-package-v1.canonical.json).
**Boundary:** P7 compiles/saves; it does not acquire responses or implement recording.

## R1 — Runner downstream contract, implementation deferred

The researcher explicitly prioritizes Planner. This section defines what the
recipe must support, not permission to implement Runner now.
**Runtime input:** recipe, authorized media, participant ordinal/ID, language,
attempt/retry selection and screen/XR setup.
**Behavior:** select an explicit variant using Runner-owned policy, execute events/forms, apply
saved feedback/layout, timestamp actual transitions and record.
**Output:** responses, ratings, events, identity/timing evidence and recorded LSL
data. Runner owns recording; exact format/mechanism, start gates and failure
handling are later decisions.

- [x] **R1-01 — Implemented predecessor:** v1 package selection, explicit protocol resolution and local event/response/output contracts.
- [x] **R1-02 — Implemented component:** native LSL outlets and local evidence/recovery components; marker identity and push-time timestamps do not meet the new reconstruction target.
- [ ] **R1-03 — Deferred:** future recipe execution, Runner-owned participant allocation and screen/feedback/XR profiles with target validation; exact allocation policy remains downstream work.
- [ ] **R1-04 — Deferred:** occurrence-specific markers at defined observed boundaries, preserving pauses/restarts/incomplete evidence.
- [ ] **R1-05 — Deferred:** Runner-owned recording and recovery; explicitly outside Planner implementation scope.
- [ ] **R1-06 — Deferred:** recorded-stream-only reconstruction proof, including missing events and retries.
- [ ] **R1-07 — Deferred:** native package Start remains capability-blocked; playback/input/timing/LSL/accessibility and XR qualification need separate evidence.

## Information handoffs and master recipe composition

| Producer → consumer | Explicit handoff | Invalidated by |
| --- | --- | --- |
| P1 → P2 | Workspace source-storage capability | Permission/workspace change |
| P1 → P3 | Stable IDs, file identity and duration | Asset/identity change |
| P1 → P4/P6 | Display geometry and aspect ratio | Media/geometry-policy change |
| P2 → P3/P7 | Accepted definitions/languages/modules | Content/scoring/placement edit |
| P3 → P7/R1 | Ordered variants/identities, ISIs/dictionary references and marker meaning; allocation remains Runner-owned | Event/timing/variant/dictionary edit |
| P4/P6 ↔ P5 | Owned layout composed with owned style/input | Geometry/animation-extent edit |
| P1–P6 → P7 | Contributions and dependency revisions | Run-defining value change |
| P7 → R1 | Frozen master JSON and media references | Changed bytes/assets or unsupported target |

The recipe must cover study/workspace reference, assets, questionnaires/languages/
scoring, ISI dictionary/references, variants with a Runner-selection boundary,
events/timing/markers, input/visual/mappings, screen
layout, optional XR, playback/acquisition/output policy, schema identity and
integrity. These are logical categories, not finalized JSON root keys. P7 owns
composition; each segment owns its contribution's meaning. Actual answers,
ratings and event timestamps are generated later.

Current v1 has nine root members: `schema`, `version`, `packageId`, `assetRoot`,
`assets`, `languageSelection`, `playback`, `settings`, `integrity`. Closed nested
contracts cannot take new keys under the old version. Create explicit successor
schemas/migration fixtures, preserving historical meaning. Actual current field
shapes are in the [implementation audit](61-IMPLEMENTATION-AUDIT.md).

## Decision register and researcher questions

Do not re-ask answered questions. Recommendations are proposals until answered.
An open decision blocks only its dependent capability.

| ID | Status / owner | Question or answer | Recommendation / consequence |
| --- | --- | --- | --- |
| Q01 | Answered / P3 | One column per version; chronological video/ISI rows. | P3-02 must use this orientation; start/stop events are derived. |
| Q02 | Answered / P3 | User replied “Yes, use these rules” on 2026-09-11: repeated videos; ISIs anywhere including consecutive/final; unequal lengths via trailing padding; reject interior blanks. | Preserve exact order. No implicit block or questionnaire insertion; Q09 remains open. |
| Q03 | Answered; revised by Q14 / P3 | Video duration is fixed by the catalogue; ISI durations are milliseconds entered in the dictionary field. | Table cells use names, not raw numbers. Derive boundaries; Runner supplies actual timestamps. |
| Q04 | Answered / P1 | User rejected the artificial collision premise: IDs derive from location, e.g. `FOLDERNAME_video.mp4`; one exact path can name only one file. Include the extension and preserve full relative-path distinctions. | Implement injective/reversible readable path IDs; no lossy punctuation/Unicode flattening, arbitrary suffix or required manual collision repair. Byte identity remains separate. Changed locations update the annotation with explicit dependency invalidation. Preserve historical readers. |
| Q05 | Optional physical provenance open / P1/P7 | Absolute-directory provenance/relocation preference remains unanswered. Current authored logical roots and exact relative paths restore as pending and require a fresh authorized directory rebind and verification. | Existing relative declarations suffice for Planner JSON generation; do not add permission grants or silently choose Runner relocation policy. Remembering a custom native shell root across restart is a separate local preference gap, not a master compile gate. |
| Q06 | Answered: owner changed / P3/R1 | Latest direct answer in S3 on 2026-09-11: “Leave allocation policy to Runner.” P3 preserves ordered variants; no participant-assignment UI or Planner allocation algorithm. | Supersedes earlier cyclic/fixed-ordinal Planner proposal. Runner algorithm/retry/skip policy is deferred, not a Planner blocker. |
| Q07 | Owner answered; details deferred / R1 | Runner owns recording; implementation is outside current Planner scope. Format, receiver/start gate, failure handling and visible-onset evidence remain open. | Planner specifies required event fields/semantics now; no recording implementation. |
| Q08 | Fixed basis answered; per-recipe choice allocated / P4 | Fixed-reference percentages/centre relationship remain accepted. Root allocated both proposed analysis methods as an explicit required Planner choice: largest oriented video by area, or combined maximum-width/height envelope. No silent default. | Missing selection blocks that recipe, not the software's accepted contract. Save the method/reference, preview it and reproduce both choices. A global default preference remains unanswered; it is not needed to build a configurable Planner. Calibration/axes/design-centre semantics remain explicit in the owned profile. |
| Q09 | Open / P2 | Required questionnaire placements, computed scoring and missing-answer semantics beyond option codes? | Preserve explicit existing definitions/placements until answered. |
| Q10 | Answered for current Planner controls / P5 | The 2026-09-12 complete-Planner goal requires all current experiment-defining Flubber/live settings. Coordinator explicitly includes Flubber, Grid and the existing project-authored procedural Face, response grid/timing/hold, halo, Axes/Corners and applied labels. | Versioned complete contribution; no historical Face/Photoatlas restoration. Transient x/y, input capture, unapplied dialogs and inspection framing remain omitted. Runner correspondence/execution is deferred. |
| Q11 | Answered / P6 | Direct S6 answer on 2026-09-11: “Yes, use these alignment rules.” Head-forward with no eye tracking, world anchor throughout each attempt, stop on tracking loss, recenter only before the next attempt. | Profile encodes requirements; physical enforcement is later Runner work. |
| Q12 | Open / P1/P7 | Accept proposed homes/exposure for study identity, any retained participant-count metadata, sample rate and stream/output settings? | Remove redundant sections while retaining required recipe values; participant allocation is Runner-owned under updated Q06. |
| Q13 | Open / P7 | Does final JSON restore only accepted runnable design or also drafts/provenance; how are edits to used recipes versioned? | Separate editable drafts from immutable run evidence. |
| Q15 | Initial screen scope clarified; master selection open / P6/P7 | Researcher described a video screen inside a future WebXR headset with precise distance, size and viewing angles. P6 implements a flat monoscopic screen with yaw/pitch/roll, coplanar local feedback and explicit WebXR requirement. Combining desktop/XR alternatives in one master recipe remains P7 work. | No silent desktop fallback. Rotatable inspection remains separate from saved screen rotation. |
| Q14 | Answered / P3 | User replied “Yes, use these rules”: stable ISI names, duplicate durations allowed, deletion blocked while used, edits invalidate acceptance. User-supplied times/count remain illustrative. | Embed dictionary/references; named-only version cells. No renumbering existing definitions or silent conversion of numeric cells. |

## Recommended order and completion criteria

Use the [closure plan](62-PLANNER-CLOSURE-PLAN.md#delivery-order-and-bounded-passes)
for detailed slices, designs and acceptance. This is dependency order, not a
whole-project implementation allocation:

1. Allocate the successor contribution/schema seam and fixtures first. Close only
   the P1/P3 decisions needed for their next slice; preserve frozen v1 semantics.
2. Finish P1's import/catalogue/geometry handoff and adapt pending P3 work to the
   named dictionary, event sequence, variant identities and marker definitions. P2's
   accepted-definition/editable-save work can progress in its own lane.
3. Complete P4 geometry and P5 consolidated saved controls through one layout
   owner. Connect accepted contributions to P7 incrementally.
4. Close desktop P7 composition, acknowledged save/reopen and independent recipe
   reproduction. Optional XR does not block a desktop-only recipe.
5. Add P6 spatial authoring and P7's spatial-profile round trip once their contract
   is explicit. R1 execution, recording and qualification remain separate work.

Desktop Planner completion requires applicable P1–P5/P7 items closed, decisions
answered or explicitly deferred, one valid recipe created through UI,
reproducible reopen/compile fixtures and clear target requirements. Optional
spatial authoring also requires P6-01 through P6-05 and corresponding P7 checks;
P6-06 remains deferred Runner/device work. Runner readiness is a separate claim;
a recipe does not prove qualified execution or recording.

## Initial evidence and pending integration

The initial source audit executed 59 focused existing Node tests successfully
and inventoried every Research module. This roadmap pass is documentation-only;
no fresh native/browser/hardware qualification is implied. Exact command and
limits are in [61](61-IMPLEMENTATION-AUDIT.md).

Pending branches observed 2026-09-11 are not integrated completion evidence:

- S2 `59d15d9`: questionnaire grid/round-trip/prebuilt changes.
- S3 `01444a7`: event-row/variant-column editor, library CSV/XLSX and separate
  authoring JSON. Its content-bound `video-<16hex>` IDs differ from the requested
  readable annotations; allocation and master-package embedding remain absent.
  Reconcile it with the now-confirmed named-ISI dictionary grammar and colors.
- Preview `7c908949`: pinned/configured-input and display changes, still transient.
- Setup layout `20644e2`: draggable UI pane divider, not P4 experimental geometry.

Refresh HEAD/status and the integration board before each pass. Re-audit pending
work on collection rather than reimplementing it. Update only affected rows with
exact evidence; this 2026-09-11 baseline is not a perpetual live audit.
