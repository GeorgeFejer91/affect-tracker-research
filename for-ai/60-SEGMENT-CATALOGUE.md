# Central segment roadmap and capability checklist

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
  and accepted decisions. All seven Planner segments remain incomplete.
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
2. P1 owns workspace/library authoring and stable video annotations based on
   folder and filename, e.g. `calm/forest.mp4` → `calm_forest`. Normalization,
   collisions and relocation semantics remain explicit decisions.
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
10. Preserve exactly two modes: **Setting Up the Experiment** and **Running the
    Experiment**. P1–P7 are responsibility IDs, not extra modes or necessarily
    seven identical accordions.
11. The later 2026-09-11 requirement relayed by **Add segment confirmation flow**
    makes segment confirmations accept the current segment's contribution in
    sequence, rather than only recording that its screen was reviewed. Live
    Preview is the exception: P7 captures its final settings, then offers a
    popup to name and save the final JSON. Review, accepted contribution and
    acknowledged persistence remain separate states; edits invalidate affected
    acceptance. This records product intent, not an implemented workflow or
    approval to bypass the stage/contract gates. Integration owns confirmation
    orchestration and P7 owns final naming/save semantics.

## Segment map and single owners

| ID / owner | Final responsibility | Main JSON contribution | Baseline state |
| --- | --- | --- | --- |
| P1 `workspace` | Workspace, study identity, video catalogue | Workspace reference, metadata, assets and media geometry | Partial |
| P2 `questionnaires` | Items, scoring and languages | Definitions, variants, modules and coverage | Partial |
| P3 `variants` | Event columns, ISIs and markers | Ordered variants and event definitions; Runner owns allocation | Missing target workflow; explicit-plan predecessor exists |
| P4 `layout` | Video fitting and centre-relative Flubber layout | Units, reference geometry, offsets, size and fit policy | Missing target workflow; normalized placement exists |
| P5 `feedback` | Flubber/input/Advanced editor and live preview | Input configuration, visual style and mappings | Partial; old controls distributed across sections |
| P6 `xr-layout` | Optional world-fixed spatial recipe and 3D preview | Spatial profile, alignment and target requirements | Missing; authoring target accepted |
| P7 `package` | Recipe validation, save/reopen and export | Versioned master JSON, playback/output policy and integrity | Partial; strict v1 compiler/readers exist |
| R1 `runner` | Execute, timestamp and record | Consumes recipe; produces measurements/events/recordings | Deferred implementation; v1 components exist |

Suggested homes for retained settings: P1 study name/ID; P7 retained study/count
metadata if required, with participant allocation left to Runner; P7 acquisition rate and recording/stream
policy. P4 owns size/placement; P5 owns appearance/input. These placements are
recommendations under Q12. Controls shown in multiple previews edit one owner.

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
**User input:** working directory, study name/ID, imported folders/files, review
of annotations and explicit corrections. Naming and relocation are Q04/Q05.
**Receives:** user-selected files/directory through the owning platform adapter.
**Produces:** catalogue with stable ID, display name, file reference, hash,
length, duration and display geometry.
**Consumers:** P2 source storage; P3 video IDs; P4/P6 geometry; P7 assets.
**JSON:** current `assetRoot`, `assets.stimuli[]` and matching logical registry;
directory representation and saved geometry need the successor recipe contract.

- [x] **P1-01 — Implemented component:** browser/native workspace selection and authorization (`workspace.js`, `research_workspace.rs`).
- [x] **P1-02 — Implemented component:** declared-asset verification binds safe paths, hashes, byte lengths and duration. Decode qualification remains separate.
- [ ] **P1-03 — Partial:** active package-root import/rescan; fix browser `stimuli/` versus `assets/stimuli/` handoff (audit F02).
- [ ] **P1-04 — Missing:** reviewed folder_filename annotations with explicit collision, nesting, rename and rescan rules (Q04).
- [ ] **P1-05 — Decision:** directory JSON representation and authorized relocation (Q05); recording a path grants no filesystem permission.
- [ ] **P1-06 — Missing:** preserve oriented/display dimensions and aspect ratios in the contribution. Existing probes observe dimensions but package assets omit them.
- [ ] **P1-07 — Partial:** editable library save/reopen and dependency invalidation without silently changing accepted identities.

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
- [ ] **P2-04 — Partial:** P2 full-content restore/snapshot seam from `74e879b` is included in integration candidate `cfd4c43` with final P2 handoff `ae47df6`; P7 owns its package load/Edit recipe wiring and acknowledged save. Invalid draft durability remains Q13. Historical language-neutral or colliding slots reject editable restoration explicitly; nested language roster editing remains unsupported.
- [ ] **P2-05 — Partial:** complete requested instruments in priority languages, then explicit further-language authoring; a picker entry is not available instrument content.
- [ ] **P2-06 — Decision:** placement, computed totals/subscale scoring beyond explicit option codes, and missing-answer behavior (Q09). Explicit reverse-coded option values already work.
- [ ] **P2-07 — Partial:** save approved presentation choices; label repetition5/10 is currently preview-only and blocks Build until reset.
- [ ] **P2-08 — Partial:** `74e879b`, collected through `ae47df6` in integration candidate `cfd4c43`, proves EN/DE edit→package→full-definition restore→byte-identical re-export in two independent processes and off-screen app restoration/dirty-revision behavior. P7-integrated final-step UI evidence remains open; Runner proof is deferred.

**Acceptance:** each selected language has exact required definitions; labels
and codes remain distinct; missing variants reject; imports preserve declared
content. No implicit translation/fallback supplies coverage. Existing module
placements remain explicit.
**Source:** [authoring](../site/src/research/questionnaire-authoring.js),
[editor](../site/src/research/questionnaire-editor.js),
[coverage](../site/src/research/questionnaire-assets.js),
[contracts](../site/src/research/questionnaires.js).
**Boundary:** P2 does not allocate participants, schedule videos or record answers.

## P3 — Versions, Timing & Markers

**Purpose:** turn researcher-authored event columns into repeatable variants
and a complete planned event/marker contract.
**User input:** comma-separated ISI durations in milliseconds, creating a named
dictionary; one Excel column per variant with video IDs and ISI names in
chronological rows. Videos have fixed catalogue durations. Blocks, blanks,
repeats and questionnaire placement remain Q02/Q09; the basic grammar is confirmed.
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
blank, repeated, consecutive or terminal entry behavior before repairing input.

The master recipe embeds the ISI dictionary and every version's references;
no external dictionary file becomes Runner authority. P3 owns both. Q14 records
the accepted named-only rule, which supersedes the earlier numeric-cell proposal.

Recommended behavior: preserve accepted ISI IDs when the duration list is edited;
never silently renumber a referenced entry. A changed duration invalidates every
referencing version/compiled recipe; deletion with live references must be
resolved explicitly. All ISI cells remain red and show their resolved millisecond
value alongside the ID. Video/ISI identity collisions, duplicate durations and
comma-list validation need explicit rules before implementation.

The later Q06 answer leaves allocation policy to Runner. Preserve each variant's
identity and authored order without selecting a participant or defining a cyclic
policy in Planner. The successor contract must explicitly identify this boundary;
its exact wire representation is owned by P3/P7, not fixed by this document.

- [x] **P3-01 — Implemented predecessor:** strict imported block/video schedules, per-video ISIs and deterministic protocol resolution exist; no variant allocation is implied.
- [ ] **P3-02 — Missing in baseline:** variant-column/video-ID-or-ISI-name editor/paste, precise cell errors and derived timeline preview (Q01/Q03/Q14 answered). Related S3 work is pending integration.
- [ ] **P3-03 — Missing:** derive paired events from full-video duration and referenced dictionary durations; validate boundary ordering, unknown/colliding IDs and repeat/block/blank rules (Q02).
- [ ] **P3-04 — Missing:** authored variants and stable identities in the recipe, with an explicit Runner-owned selection boundary and no Planner assignment UI/algorithm (latest Q06 answer).
- [ ] **P3-05 — Missing:** unique occurrence IDs distinguish repeated/restarted presentations of the same video.
- [ ] **P3-06 — Missing:** versioned marker vocabulary/envelope with run, variant, video, occurrence, event, sequence and actual-timestamp meaning.
- [ ] **P3-07 — Missing:** reconstruction contract for video/ISI, pauses, forms, interruptions and restarts from recorded stream data alone, including incomplete sequences (Q07).
- [ ] **P3-08 — Missing:** deterministic compile/reopen fixtures for each variant, without invented counterbalance orders or silent cell repair.
- [ ] **P3-09 — Missing:** consistent distinct video-ID colors across columns and red ISI cells, plus readable type/ID/duration cues so color is not the sole meaning. These are authoring feedback, not stimulus condition codes.
- [ ] **P3-10 — Missing:** reusable ISI dictionary from comma-separated millisecond values; named-only version cells and embedded dictionary/references (Q14 accepted). Finalize stable ID, duplicate-value and deletion semantics before implementation.

**Marker boundary:** Planner owns definitions/expected sequence; Runner owns
actual timestamps/recording. Predicted duration or Play request is not measured
visible onset. Events must be identifiable without the source spreadsheet.
Recommended shared vocabulary and variant/occurrence IDs still need bounded encoding.

Current native package markers contain only `event:<eventType>`; richer local
records are not carried in the payload. Existing LSL outlets therefore do not
prove video identity reconstruction. See `event_marker` in
[native runtime](../src-tauri/src/research_native_protocol/runtime.rs) and
[LSL service](../src-tauri/src/research_lsl.rs).
**Boundary:** implement Planner definitions/fixtures here, not Runner recording.

## P4 — Screen & Layout

**Purpose:** preview and define a reproducible video/Flubber arrangement for
mixed video sizes.
**User input:** physical screen dimensions or relative mode, fitting policy,
Flubber size, centre offsets and required calibration/reference choices (Q08).
**Receives:** P1 display geometry and P5 style/maximum animation extent.
**Produces:** screen profile, units/reference, video fit, Flubber footprint and
centre-relative arrangement with whole-screen miniature preview.
**Consumers:** shared P5 preview, P7 serialization and R1 rendering.
**JSON:** new layout contract; normalized v1 `overlayPosition` is insufficient.

Accepted relationship after video fitting:
`flubberCentre = videoCentre + (offsetX, offsetY)`.
`offsetX=0` places centres on the same vertical line. Right-positive x/down-
positive y and a fixed animated Flubber design centre are recommendations (Q08).
The researcher confirmed fixed-reference percentages across all videos; save
that reference explicitly rather than scaling offsets per video. Largest pixel resolution alone
does not resolve widest/tallest aspect-ratio constraints. Check every fitted
video and animation extent without silently using per-video bottom-edge alignment.

- [x] **P4-01 — Implemented predecessor:** normalized feedback placement/size and Run locking exist; centre-offset/calibrated screen contracts do not.
- [ ] **P4-02 — Missing:** whole-screen miniature using actual media geometry and shared Flubber configuration.
- [ ] **P4-03 — Decision:** exact reference-video selection/extent, fit/crop, centre definition and axes (Q08); fixed-reference percentage basis is already confirmed.
- [ ] **P4-04 — Missing:** physical/relative toggle, calibration and geometry-preserving conversion when measurements are available.
- [ ] **P4-05 — Missing:** save/apply centre offsets through one layout owner shared by preview/export.
- [ ] **P4-06 — Missing:** validate aspect ratios, animation bounds, overlap/clipping and incompatible runtime screens without silent repositioning.
- [ ] **P4-07 — Missing:** deterministic export/reload geometry fixtures for each relevant video/screen profile.

**Acceptance:** preview and saved geometry agree; units/reference are explicit;
mixed videos retain the chosen relationship; missing calibration/impossible fit
has an explicit outcome.
**Source predecessor:** [settings](../site/src/research/contracts.js),
[preview](../site/src/research/preview.js), [UI](../site/src/research/app.js).
**Boundary:** P4 owns geometry, not colors, input or animation parameters.

## P5 — Flubber & Controls

**Purpose:** one persistent editor for Flubber appearance/control, with Advanced
animation settings at the bottom.
**User input:** device/bindings, response behavior, colors/style/visibility and
explicit animation/mapping edits. Which drafts become runnable remains Q10.
**Receives:** P4/P6 layout and explicit preview-test input.
**Produces:** one input configuration, visual style and affect-mapping set;
live preview projects these values.
**Consumers:** P4/P6 composition, P7 recipe and R1 adapters.
**JSON:** existing input/visual/mapping objects; newly saved behavior needs
explicit versioned fields.

- [x] **P5-01 — Implemented component:** strict bindings/presets and saved digital step semantics; physical device qualification remains separate.
- [x] **P5-02 — Implemented component:** saved Grid/Flubber appearance, colors and six affect mappings.
- [x] **P5-03 — Implemented component:** live preview and input-test surfaces; not all simulator controls are saved settings.
- [ ] **P5-04 — Pending integration:** isolated `8d3d256` consolidates old Input/Visual/Advanced with one value owner and bottom Advanced; canonical verification remains required.
- [ ] **P5-05 — Decision:** saved/temporary controls and units are inventoried in the P5 roadmap receipt; Q10 promotion decisions remain open.
- [ ] **P5-06 — Missing:** serialize newly approved controls with explicit units/ranges and no silent Run defaults.
- [ ] **P5-07 — Partial:** `8d3d256` supplies a tested conservative saved-v1 envelope and labels retained normalized geometry as legacy; P4/P6 composition and accepted export/reload consistency remain open.
- [ ] **P5-08 — Pending integration/qualification:** real headless UI checks cover unique controls, reflow, confirmation and invalid-field disclosure/focus after consolidation; physical input and installed accessibility qualification remain separate.

**Acceptance:** saved edits survive preview/export/reopen; temporary test movement
does not become participant data or stored response rules. Animation speed is
distinct from the acquisition sample rate in recording policy.
**Source:** [input](../site/src/research/input-controller.js),
[contracts](../site/src/research/contracts.js),
[preview](../site/src/research/preview.js), [mappings](../site/src/research/mappings.js).
**Boundary:** no allocation, sampling clock, LSL transport or screen calibration.

**Candidate receipt:** [2026-09-11 P5 consolidation and control inventory](./40-ROADMAP.md#p5-consolidation-candidate--2026-09-11-pending-integration).
Unchecked items remain unchecked until integration and the applicable gates;
the candidate does not implement Q10 saved additions or P4/P6 geometry policy.

## P6 — Optional XR Spatial Layout

**Purpose:** author a spatial presentation profile in the same recipe for a
future compatible VR APK/WebXR Runner.
**User input:** XR selection, video spatial/angular size, distance, centre
azimuth/elevation, orientation and relative Flubber offset.
**Confirmed:** world-fixed content, aligned to participant forward direction at
setup. Recentring/tracking-loss details remain Q11.
**Receives:** P1 geometry, P5 feedback/input requirements and P4 centre semantics.
**Produces:** world-fixed spatial profile, alignment/target requirements and
rotatable 3D preview. **Consumers:** P7 and later R1 XR adapters.

- [ ] **P6-01 — Missing:** optional spatial profile and explicit compatible-target requirements.
- [ ] **P6-02 — Missing:** 3D preview distinguishing video angular width/height, centre offset and distance.
- [ ] **P6-03 — Missing:** world-fixed initial-forward alignment and video-local centre-offset transform with declared axes/units.
- [ ] **P6-04 — Decision:** forward reference, recentering/tracking loss and whether anything requires measured eye gaze (Q11).
- [ ] **P6-05 — Missing:** validation/export/reopen fixtures and explicit unsupported-target rejection.
- [ ] **P6-06 — Deferred:** headset/APK/WebXR execution, LSL recording and physical qualification belong to a separate Runner pass.

**Planner acceptance:** spatial profile round-trips with reproducible transform/
angle fixtures; the preview does not claim headset accuracy. World-fixed is not
a measured-eye-tracking requirement. No active XR implementation exists at baseline.
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
| Q02 | Basic grammar answered; edge cases open / P3 | Video-ID and named-ISI cells are confirmed. How should blocks, blanks, unequal lengths, repeats and consecutive/terminal entries work? | No manual event-name grammar is required; diagnose ambiguity and do not silently repair rows. |
| Q03 | Answered; revised by Q14 / P3 | Video duration is fixed by the catalogue; ISI durations are milliseconds entered in the dictionary field. | Table cells use names, not raw numbers. Derive boundaries; Runner supplies actual timestamps. |
| Q04 | Open / P1 | How do duplicate names, nested folders, renames, rescans and non-ASCII names affect IDs? | Readable annotations plus immutable asset identity; collision/rename rule needs agreement. |
| Q05 | Open / P1/P7 | Original absolute directory, portable root, or both with explicit relocation? | Portable binding recommended; recording directory information is accepted. |
| Q06 | Answered: owner changed / P3/R1 | Latest direct answer in S3 on 2026-09-11: “Leave allocation policy to Runner.” P3 preserves ordered variants; no participant-assignment UI or Planner allocation algorithm. | Supersedes earlier cyclic/fixed-ordinal Planner proposal. Runner algorithm/retry/skip policy is deferred, not a Planner blocker. |
| Q07 | Owner answered; details deferred / R1 | Runner owns recording; implementation is outside current Planner scope. Format, receiver/start gate, failure handling and visible-onset evidence remain open. | Planner specifies required event fields/semantics now; no recording implementation. |
| Q08 | Percentage basis answered; details open / P4 | Use one fixed reference area across all videos. Exact reference extent/selection, physical calibration, axes and stable Flubber centre remain open. | Centre-to-centre anchoring and fixed-reference percentages are accepted; fixed design centre remains recommended. |
| Q09 | Open / P2 | Required questionnaire placements, computed scoring and missing-answer semantics beyond option codes? | Preserve explicit existing definitions/placements until answered. |
| Q10 | Open / P5 | Which simulator/draft controls must become saved experiment controls, including hold, halo, tiles and alternate renderer choices? | Enumerate saved controls/units; do not assume every draft is approved. |
| Q11 | Anchor answered; details open / P6 | World-fixed, initially forward-aligned. How does recentering/tracking loss work; is forward head pose or measured eye gaze? | Head-forward recommended; do not infer eye-tracking support. |
| Q12 | Open / P1/P7 | Accept proposed homes/exposure for study identity, any retained participant-count metadata, sample rate and stream/output settings? | Remove redundant sections while retaining required recipe values; participant allocation is Runner-owned under updated Q06. |
| Q13 | Open / P7 | Does final JSON restore only accepted runnable design or also drafts/provenance; how are edits to used recipes versioned? | Separate editable drafts from immutable run evidence. |
| Q14 | Named-only/user-defined values answered; lifecycle details open / P3 | Researcher-supplied durations create named ISI entries; the sample names/times/count are illustrative. Version cells use names only, excluding raw numeric values. | Embed dictionary/references. Stable IDs and dependency invalidation are recommended; naming/duplicate/delete details remain open. |
| Q15 | Open / P6/P7 | Are desktop and XR alternative profiles in one recipe or separate target requirements; does initial spatial authoring use a flat monoscopic plane, and which plane rotations/depth offsets are exposed? | Explicit selected target, no silent desktop fallback; flat plane proposed first. Rotatable inspection is distinct from saved plane rotation. |

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
