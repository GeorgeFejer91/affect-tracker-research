# Central segment roadmap and capability checklist

**Planner authoring goal completed — 2026-09-12:** every required P1–P6 segment,
including experiment-defining Flubber/live configuration, contributes to one
validated, saveable and editable master. Canonical source, local build and
combined verification are recorded in 67; checked capabilities below are delivered.
See [67-PLANNER-COMPLETION-GOAL.md](67-PLANNER-COMPLETION-GOAL.md) for current
assignments, exact source/artifact identities and evidence. Final Planner–Runner correspondence
is explicitly deferred to the last development stage. The separate-program and
Runner-owned recording amendment in [16](16-COMPANION-APP-BOUNDARY.md) supersedes
older one-program/two-mode wording below.

This is the central **final-state Planner roadmap**, segment contract map and
capability checklist requested by the researcher on 2026-09-11. Every future
agent must answer: **What is my segment supposed to do? What does it already
do? Which of its capability items remain?** Read the whole map for context,
then work only on the assigned segment and explicitly named shared seams.

**Current status: required Planner authoring is complete.** Runner responsibilities
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
- [62-PLANNER-CLOSURE-PLAN.md](62-PLANNER-CLOSURE-PLAN.md) summarizes current
  input/output contracts, optional extensions and bounded future passes.
  This file owns capability status and accepted decisions. Current combined application source is
  `875efae0a852bdcea978e8a12b74c0e81288d51c`; detailed final component and shared
  authoring/save/Open evidence is in [67](67-PLANNER-COMPLETION-GOAL.md).
  Canonical `codex/research-unified` received this product as
  `1218c9ebef87111109d784bc2a9bf5827767917f`. The checked Planner items below
  are delivered software capabilities; optional content and runtime gates are explicit.
- Initial status baseline: integrated source
  `305d3ac6b2de40a27436f7c97cb1ee2d2a2e87ce`, audited 2026-09-11. Unmerged branches
  and private/installed runtime state are excluded from completion claims.
- `[x] Implemented component` means the narrowly stated behavior is present at
  its stated source, with the linked source/test evidence. Current Planner rows
  bind the delivered `1218c9e` product and final evidence in 67. This does not mean the
  whole segment, every platform or research qualification is complete.
- `[ ] Partial` means incomplete capability; `[ ] Missing` means absent from
  integrated source; `[ ] Decision` means unresolved researcher/contract input;
  `[ ] Deferred` means deliberately later work. Never tick an unresolved target.
- Do not invent percentage completion. A segment is complete only when its
  required items, JSON round trip and applicable gates close. A worktree result
  remains **pending integration** until collected and verified in canonical source.
  That convergence is complete for the current required Planner rows.

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
   owner; their current homes are implemented under the all-settings goal.
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

| ID / owner | Final responsibility | Main JSON contribution | Verified combined state at 875efae |
| --- | --- | --- | --- |
| P1 `workspace` | Workspace, study identity, video catalogue | `segments.P1`: workspace, catalogue and oriented geometry | Implemented; exact current-directory verification and rebind |
| P2 `questionnaires` | Items, scoring and languages | `segments.P2`: definitions, languages, modules, presentation | Implemented; optional instrument content/advanced scoring remain separate |
| P3 `variants` | Event columns, ISIs and markers | `segments.P3`: ordered variants, named ISIs and planned markers | Implemented; Runner owns allocation and actual timestamps |
| P4 `layout` | Video fitting and centre-relative Flubber layout | `segments.P4`: complete accepted desktop profile | Implemented; two required explicit reference choices, relative/mm modes |
| P5 `feedback` | Flubber/input/Advanced editor and live preview | `segments.P5`: input, visual, mappings, presentation, response | Implemented; one editor, complete v2 settings and final Save capture |
| P6 `xr-layout` | Optional world-fixed spatial recipe and 3D preview | `segments.P6`: included profile or explicit exclusion | Implemented authoring and master round trip; headset execution deferred |
| P7 `package` | Recipe validation, save/reopen and export | Master envelope, target, policy and integrity | Implemented; strict JS/native readers and actual browser save/Open proof |
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
Location-derived annotations are automatic; no manual collision-repair step.
**Receives:** user-selected files/directory through the owning platform adapter.
**Produces:** catalogue locations with an automatic reversible path ID, immutable
content identity, file reference, hash, length, duration and display geometry.
**Consumers:** P2 source storage; P3 video IDs; P4/P6 geometry; P7 assets.
**JSON:** `segments.P1` embeds the complete workspace/catalogue contribution,
logical root and exact relative declarations, content/location pairs, hashes,
byte lengths, durations and oriented/display geometry. Handles and permissions
are never serialized.

The fixed logical layout is `assets`, `assets/stimuli`,
`experiment.package.json`. V2 references pair `{assetId, annotationId}`.
`assetId=asset-<full lowercase SHA-256>` identifies immutable content and may
repeat at distinct locations. The annotation encodes every path component below
`stimuli/`, including the filename extension: `%` becomes `%25`, `_` becomes
`%5F`, and encoded components join with `_`. A first-component `=`, `+`, `@`
or `-` is escaped as `%3D`, `%2B`, `%40` or `%2D`. Source text must already be
NFC; leading/trailing trim whitespace rejects rather than being normalized.
Decoding and canonical re-encoding must reproduce the exact path; collision is
a hard error, never enumeration-based suffixing. Moves change annotation identity
and acceptance, not equal content identity. Geometry consumers may deduplicate
content; reference consumers retain each pair. Ambiguous, missing or reflected
native geometry remains pending; installed GStreamer qualification stays separate.

- [x] **P1-01 — Implemented component:** browser/native workspace selection and authorization (`workspace.js`, `research_workspace.rs`).
- [x] **P1-02 — Implemented component:** declared-asset verification binds safe paths, hashes, byte lengths and duration. Decode qualification remains separate.
- [x] **P1-03 — Implemented Planner:** Correct assets/stimuli import/rescan on browser and native; current-directory enumeration rejects new/missing files and link replacement before accepting cached metadata.
- [x] **P1-04 — Implemented Planner:** Reversible full-relative-location v2 IDs retain filename/extension, punctuation and nesting distinctions; asset SHA identity stays separate. Moves invalidate dependent acceptance.
- [x] **P1-05 — Implemented Planner:** Logical root and exact relative declarations are embedded; Open restores content pending fresh authorization and exact rehash/reprobe/rebind. Absolute-root provenance is optional Q05.
- [x] **P1-06 — Implemented Planner:** Complete oriented/display dimensions, aspect and duration travel through P1 into P4/P6 and the master; native and browser validators preserve v1/v2 semantics.
- [x] **P1-07 — Implemented Planner:** Content restore, exact media rebind, revision publication and dependent invalidation are wired and regression tested, including reads before change publication. Final owner aee980d.

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
**JSON:** `segments.P2` embeds complete selected-language definitions, module
and language graph, source scoring/provenance and a hash-bound label-repetition
presentation companion. See [P2 contract](../docs/planner-p2-questionnaire-recipe.md).

- [x] **P2-01 — Implemented component:** single-choice definitions, distinct labels/nullable numeric codes, hashes and module references.
- [x] **P2-02 — Implemented component:** family×language coverage and terminal-language references; picker already supports more than EN/DE.
- [x] **P2-03 — Implemented component:** bounded sheet editing/paste, file normalization and dirty/invalid compilation gates.
- [x] **P2-04 — Implemented Planner:** Full accepted definitions, language graph, modules, scoring/provenance and editable content restore through the master. Missing media keeps readiness pending. Optional invalid-draft retention and nested roster editing are separate.
- [ ] **P2-05 — Optional instrument-content gap:** MAIA-2 EN/DE each supply 37 items and six labelled/coded options. Preserve source-specific annotations: supplied EN uses forward codes without subscales; DE includes supplied reverse codes and eight subscales. This is not proof of equivalent computed scoring. TAS EN remains rights-gated, DE is absent; neither catalogue entry is ready. Further-language authoring is verified using a synthetic EN/DE/FR round-trip and missing-FR rejection, not an invented instrument translation.
- [ ] **P2-06 — Optional extension decision:** computed totals/subscales, new questionnaire placements and missing-answer rules beyond explicit option codes remain Q09. Current before/after-session modules and reverse-coded options work; unsupported historical block/after-stimulus hooks reject explicitly. These extensions are not missing master fields.
- [x] **P2-07 — Implemented Planner:** The versioned presentation companion saves label repetition (every item/5/10) with its definition hash and restores exactly. It is not pagination or a new Runner default.
- [x] **P2-08 — Implemented Planner:** Full P2 content and presentation survive independent JS/native and actual UI master save/Open. Owner b08ceb0 preserves EN/DE edits and synthetic extra-language coverage; native 48318a9 also preserves the complete bounded language graph.

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
**JSON:** `segments.P3` embeds the complete v1/v2 design contribution, including
dictionary, ordered variants, occurrence references, planned timelines and marker
profiles. See [P3 contract](../docs/planner-p3-contribution-api.md).

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
- [x] **P3-02 — Implemented Planner:** One column per version, named-ISI/video chronology, atomic Excel paste and cell-specific errors are integrated. Actual shared UI paste and ISI edits enter the saved master.
- [x] **P3-03 — Implemented Planner:** Exact P1 identity/duration and registered owner revision drive paired planned boundaries; missing or changed dependencies withdraw acceptance instead of inventing durations.
- [x] **P3-04 — Implemented Planner:** Ordered variants and explicit runnerAssigned ownership are embedded. Planner contains no participant allocator or participant selection controls.
- [x] **P3-05 — Implemented Planner:** Retained occurrence identities distinguish repeated media and survive unequal version lengths; marker execution identities distinguish repeated attempts.
- [x] **P3-06 — Implemented Planner:** Versioned planned marker envelope defines recipe/run/attempt/variant/entry/execution identities and actual-event fields. This closes Planner specification only; Runner emission is later.
- [x] **P3-07 — Implemented Planner:** Synthetic reconstruction fixtures cover ordered video/ISI/form events, pauses/restarts and incomplete traces. Recorded-stream-only and physical onset proof stay R1 work.
- [x] **P3-08 — Implemented Planner:** Strict JS/Rust v1/v2 contribution/master reproduction, exact editable reopen and rebind are integrated; current-media CSV/XLSX export revalidates before and after native save selection. No required authoring sidecar.
- [x] **P3-09 — Implemented Planner:** Stable distinct video coloring, red ISIs and explicit ID/type/duration cues; long IDs remain horizontally contained without truncating stored values.
- [x] **P3-10 — Implemented Planner:** Researcher-defined comma-separated milliseconds create stable named ISIs; duplicate durations remain distinct, used deletion rejects and edits invalidate dependent acceptance.

Current P3 handoff `2f862b9`, native catalogue export `ea3c788` and reproduction
expectation `c7afb28` are collected in `875efae`. V1 hash references and V2 exact
asset/location pairs retain their separate semantics. See
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
**JSON:** `segments.P4` contains the accepted profile and its dependency-bound
geometry. [P4 contract](../docs/planner-p4-layout-contract.md) owns units,
reference methods, fit, centre conventions and all validation.

Accepted relationship after video fitting:
`flubberCentre = videoCentre + (offsetX, offsetY)`.
`offsetX=0` places centres on the same vertical line. Right-positive x/down-
positive y and a fixed animated Flubber design centre are explicit P4 conventions.
The researcher confirmed fixed-reference percentages across all videos; save
that reference explicitly rather than scaling offsets per video. Largest pixel resolution alone
does not resolve widest/tallest aspect-ratio constraints. Check every fitted
video and animation extent without silently using per-video bottom-edge alignment.

- [x] **P4-01 — Preserved compatibility:** historical normalized feedback placement/size retains its meaning; current accepted centre/calibration geometry belongs to P4-02–07.
- [x] **P4-02 — Implemented Planner:** Whole-screen miniature uses complete actual P1 geometry and P5 maximum painted bounds; no synthetic geometry enters product state.
- [x] **P4-03 — Implemented Planner:** Explicit required choice of largest oriented video area or maximum oriented width/height envelope; no default. One fixed reference, contain fit and defined centre/axes are saved.
- [x] **P4-04 — Implemented Planner:** Relative percentages and calibrated millimetres convert while preserving the same reference, centres and drawing geometry; missing required measurements reject.
- [x] **P4-05 — Implemented Planner:** Accepted P4 profile owns all desktop centre offsets, fitted video and feedback geometry across preview/export/reopen.
- [x] **P4-06 — Implemented Planner:** Every video and full animation/halo envelope is checked for clipping, overlap, separation and compatible viewport; no silent repositioning.
- [x] **P4-07 — Implemented Planner:** Independent JS/Rust geometry, both reference methods, relative/physical examples, pending/ready restore and full master round trip pass. Owner fa64e8d and shared875 evidence.

**Acceptance:** preview and saved geometry agree; units/reference are explicit;
mixed videos retain the chosen relationship; missing calibration/impossible fit
has an explicit outcome.
**Source predecessor:** [settings](../site/src/research/contracts.js),
[preview](../site/src/research/preview.js), [UI](../site/src/research/app.js).
**Boundary:** P4 owns geometry, not colors, input or animation parameters.

**Current evidence:** accepted/live P4 application `77e4752`, handoff `fa64e8d`,
is collected in `875efae`. Six owner scenes/231 checks, canonical JS/Rust geometry
fixtures, final combined default/error captures and the actual master workflow
replace the former draft-only status. Historical draft receipts remain dated in 40.

**Historical 2026-09-12 Planner completion handoff:** coordinator `84300ed` clarifies both Q08
methods as explicit recipe parameters, without choosing a global default. Pure
accepted/native checkpoint `d0267fff` and the subsequent live preparation/reopen
work implement this direction. Final component source `77e4752` passes 680 Node,
203 no-default Rust, both builds and 231 clean-source Chrome assertions across
six inspected scenes. See [the exact contract and API](../docs/planner-p4-layout-contract.md)
and [final component evidence](./40-ROADMAP.md#p4-accepted-planner-layout--2026-09-12).
Integration/P7 subsequently completed the combined acceptance and master
save/reopen receipts at delivered `1218c9e`; Runner remains separately deferred.
Current internal draft v2 adds a nullable method; explicit restoration of frozen
v1 drafts leaves that new choice unselected. The capability boxes now reflect
collected combined evidence. Runner correspondence is the final separately
allocated stage and does not block Planner authoring completion.

## P5 — Flubber & Controls

**Purpose:** one persistent editor for configured Flubber/Grid/procedural-Face
feedback and input/response behavior, with Advanced animation settings at the bottom.
**User input:** device/bindings, response behavior, colors/style/visibility and
explicit animation/mapping edits. The current saved inventory is resolved by
the all-settings goal and the versioned P5 contract; temporary test motion stays transient.
**Receives:** P4/P6 layout and explicit preview-test input.
**Produces:** one complete configuration for input, visual style, affect mappings,
renderer/labels/halo presentation and response grid/timing/hold behavior.
**Consumers:** P4/P6 composition, P7 recipe and R1 adapters.
**JSON:** `segments.P5` is `affect-research-feedback` v2 with exact
`input`, `visual`, `mappings`, `presentation`, `response` groups.
[P5 contract](../docs/planner-p5-feedback-v2.md) owns the field inventory and units.

- [x] **P5-01 — Implemented component:** strict bindings/presets and saved digital step semantics; physical device qualification remains separate.
- [x] **P5-02 — Implemented component:** saved Grid/Flubber appearance, colors and six affect mappings.
- [x] **P5-03 — Implemented component:** live preview and input-test surfaces; configured response is saved in V2 while test movement, transient holds and capture state stay transient.
- [x] **P5-04 — Implemented Planner:** Old Input/Visual/Advanced sections are removed; one persistent Flubber & Controls editor owns their retained values, with Advanced at the bottom.
- [x] **P5-05 — Implemented Planner:** Complete saved/temporary inventory and explicit units are documented in planner-p5-feedback-v2.md. Saved configuration includes all currently active Flubber/Grid/procedural Face settings; test motion is transient.
- [x] **P5-06 — Implemented Planner:** Version2 serializes input, visual, mappings, presentation and response, including renderer/labels, halo width/gradient/steepness, grid dimensions, full-span timing and hold/repeat behavior.
- [x] **P5-07 — Implemented Planner:** P4/P6 consume complete P5 bounds; accepted contributions invalidate on edits, including color Reset. V2 atomic restoration and explicit historical conversion preserve configured values.
- [x] **P5-08 — Implemented Planner:** Consolidated UI, expanded Advanced/Response, labels/dialogs, invalid focus and full configuration restore have source-bound rendered/software evidence. Physical input and installed accessibility qualification remain later gates.

**Acceptance:** saved edits survive preview/export/reopen; temporary test movement
does not become participant data or stored response rules. Animation speed is
distinct from the acquisition sample rate in recording policy.
**Source:** [input](../site/src/research/input-controller.js),
[contracts](../site/src/research/contracts.js),
[preview](../site/src/research/preview.js), [mappings](../site/src/research/mappings.js).
**Boundary:** no allocation, sampling clock, LSL transport or screen calibration.

**Current evidence:** complete P5 `5c0ad7a` / `495ee13` and Preview badge repair
`6d9cc35` are collected in `875efae`. P4/P6 own placement; P5 supplies complete
animated/painted bounds. The historical v1 reader and explicit conversion remain.

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

- [x] **P6-01 — Implemented Planner:** Strict optional spatial contribution is embedded in the master; desktop uses exact explicit exclusion and XR requires its selected compatible target.
- [x] **P6-02 — Implemented Planner:** Metres/angles, distance, centre, plane tilt and rotatable inspection are implemented against P1 oriented media; inspection camera is transient.
- [x] **P6-03 — Implemented Planner:** Right/up/back metre frame, world-fixed initial-head-forward policy and local feedback centre transforms have independent JS/Rust geometry fixtures.
- [x] **P6-04 — Implemented Planner:** Confirmed per-attempt anchor, head-forward setup without eye tracking, stop-on-tracking-loss and between-attempt recenter requirements are saved. Actual enforcement is P6-06.
- [x] **P6-05 — Implemented Planner:** Live P1/P5 binding, withdrawal, atomic pending/ready Open, included/excluded full master Save/readback and independent reproduction pass; actual owner UI has 60 checks at 1440/820.
- [ ] **P6-06 — Deferred:** headset/APK/WebXR execution, LSL recording and physical qualification belong to a separate Runner pass.

**Planner acceptance:** spatial profile round-trips with reproducible transform/
angle fixtures; the preview does not claim headset accuracy. World-fixed is not
a measured-eye-tracking requirement. Authoring is implemented; XR execution is later.
P6 worktree source/contract and exact limits are in
[63-P6-XR-LAYOUT.md](63-P6-XR-LAYOUT.md), with receipts in
[40-ROADMAP.md](40-ROADMAP.md#p6-virtual-screen-authoring--2026-09-11).
Final P6 `7fd56d5` (application `51685b0`) is collected in `875efae`; two actual
master save/Open scenes pass 60 checks each and preserve included/excluded profiles.
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
- [x] **P7-03 — Implemented Planner:** Fresh UI authoring, contribution confirmation, named master Save, editable Open and revision/re-export work without importing experiment.json; final shared fixture passes 65 checks in each browser.
- [x] **P7-04 — Implemented Planner:** Saved requires exact acknowledged write/close/readback bytes; cancel, failure, retry, stale edits, competing opens and disposal preserve newer state. Native Planner role is enforced.
- [x] **P7-05 — Implemented Planner:** Complete versioned master contains ordered P1-P6 segments, explicit target/policy and integrity. Historical package/master readers are preserved; unsupported content cannot be dropped into v1.
- [x] **P7-06 — Implemented Planner:** Strict closed-field, cross-reference, language, planned-marker, geometry and target validation routes actionable errors to the owning segment.
- [x] **P7-07 — Implemented Planner:** Contribution/edit/operation generations prevent stale compiled output, including edit/revert, P4 Reset and P5 color Reset. Shared reopen restores all owners before adoption.
- [x] **P7-08 — Implemented Planner:** Final JSON contains accepted design and authored metadata/sampling/output/LSL policy; it excludes drafts, live permissions, allocator and recording-session state. Optional draft/provenance storage stays separate.
- [x] **P7-09 — Implemented Planner:** Canonical independent-process and native/browser reproduction cover current desktop/XR and historical readers. Final11-case native parity,79 codec checks per browser and actual UI-generated files agree; Runner correspondence remains later.

**Acceptance:** no raw JSON authoring prerequisite; every required value explicit;
embedded forms need no reopened source document; assets resolve; exact saved
bytes/hash are confirmed. An old reader cannot silently discard target fields.
**Source:** [complete master contract](../docs/planner-master-recipe-v1.md),
[assembly/lifecycle contract](../docs/planner-p7-recipe-assembly.md).
Historical experiment-package-v1 readers remain a separate compatibility path.
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
integrity. P1–P6 have named members under `segments`; P7 owns
composition; each segment owns its contribution's meaning. Actual answers,
ratings and event timestamps are generated later.

Historical experiment-package v1 has nine root members: `schema`, `version`, `packageId`, `assetRoot`,
`assets`, `languageSelection`, `playback`, `settings`, `integrity`. Closed nested
contracts cannot take new keys under the old version. Create explicit successor
schemas/migration fixtures, preserving historical meaning. Actual current field
shapes are in the dated [implementation audit](61-IMPLEMENTATION-AUDIT.md).
The current `affect-research-planner-recipe` v1 has exactly `schema`, `version`,
`recipeId`, `presentationTarget`, `policy`, `segments`, `integrity`; its portable
reproduction identity is explicitly tagged v2. Full profile inputs and named
algorithms are exact; independently derived geometry is compared separately.

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
| Q09 | Optional extension open / P2 | Further placement, computed scoring and missing-answer semantics beyond supplied option codes are unallocated. | Current before/after-session modules and source codes work. Unsupported block/after-stimulus hooks reject explicitly; no invented scoring or translations. |
| Q10 | Resolved for current goal / P5 | The all-settings objective includes all active experiment configuration; P5 v2 inventories input/visual/mappings/presentation/response. | Temporary test movement, focus, unapplied dialogs and inspection camera are excluded. Current procedural Face is retained; historical Photoatlas is not restored. |
| Q11 | Answered / P6 | Direct S6 answer on 2026-09-11: “Yes, use these alignment rules.” Head-forward with no eye tracking, world anchor throughout each attempt, stop on tracking loss, recenter only before the next attempt. | Profile encodes requirements; physical enforcement is later Runner work. |
| Q12 | Current homes implemented / P1/P7 | P1 owns study identity; P7 owns retained count metadata, sampling, authored emission and output policy. | Allocation and recording selection/destination are Runner-owned session state under16; no duplicated settings. |
| Q13 | Accepted-design boundary implemented; optional draft persistence open / P7 | Final JSON contains a validated accepted design. Open restores editable content pending fresh media authority; edits produce newly compiled immutable bytes. | No invalid drafts, transient acceptance receipts or permissions in the master. Additional authoring-only recovery/provenance remains optional and must not alter frozen run evidence. |
| Q15 | Implemented authoring / P6/P7 | A flat monoscopic screen with yaw/pitch/roll, local feedback and explicit XR target is saved. Master always retains complete P4 and explicitly includes/excludes P6. | No silent target fallback. Inspection rotation is transient; runtime/headset correspondence is later. |
| Q14 | Answered / P3 | User replied “Yes, use these rules”: stable ISI names, duplicate durations allowed, deletion blocked while used, edits invalidate acceptance. User-supplied times/count remain illustrative. | Embed dictionary/references; named-only version cells. No renumbering existing definitions or silent conversion of numeric cells. |

## Future-pass order and completion criteria

Use the [bounded future-pass checklist](62-PLANNER-CLOSURE-PLAN.md#bounded-future-pass-checklist)
for new requested work. Required P1–P7 implementation is complete. Start from the
delivered source, allocate one concrete remaining defect or extension, preserve
owner contracts and route dependencies to their existing owners. Do not restart
the historical missing-editor passes or treat optional content as a universal
Planner blocker. R1 execution and qualification use their separate ledger65/66.

Desktop Planner completion requires applicable P1–P5/P7 items closed, decisions
answered or explicitly deferred, one valid recipe created through UI,
reproducible reopen/compile fixtures and clear target requirements. Optional
spatial authoring also requires P6-01 through P6-05 and corresponding P7 checks;
P6-06 remains deferred Runner/device work. Runner readiness is a separate claim;
a recipe does not prove qualified execution or recording.

## Historical initial evidence and pending integration

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
