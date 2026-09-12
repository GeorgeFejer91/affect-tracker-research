# Active Planner completion goal — 2026-09-12

The researcher explicitly set a sustained goal to finish and validate the
**Experiment Planner** as a complete JSON authoring interface. This allocation
supersedes the preceding bounded UI/confirmation intake. The researcher then
clarified: **final Planner–Runner correspondence validation is the last
development step, not a gate for finishing the Planner now.**

[60-SEGMENT-CATALOGUE.md](60-SEGMENT-CATALOGUE.md) remains the segment capability
authority. This file records the active goal, assignments and completion evidence.
[16-COMPANION-APP-BOUNDARY.md](16-COMPANION-APP-BOUNDARY.md) owns the new two-program
boundary. Recording policy, including selected external streams and recording
destination, belongs to Runner sessions. Planner still owns authored emission
configuration and planned event/marker meaning.

## Required outcome

A researcher starts without an imported experiment definition, configures the
Planner, and saves **one comprehensive, strictly validated master JSON**. Each
P1–P6 producer has a clearly named, consistently ordered contribution; P7 owns
composition, integrity, naming, saving and editable reopening. The researcher
never assembles separate JSON files by hand.

| Contribution | Required information |
| --- | --- |
| P1 — Workspace/videos | Study identity, media reference and safe locations, stable asset identities/readable annotations, hashes/lengths, durations and oriented display geometry |
| P2 — Questionnaires | Complete selected-language definitions, instructions, items/options, labels/scoring annotations, required flags, modules and explicit presentation/administration semantics |
| P3 — Versions/timing | Exact variant identities/order, researcher-defined named ISIs, occurrences, planned boundaries and marker definitions; allocation remains Runner-owned |
| P4 — Screen/layout | Screen dimensions/calibration or relative basis, explicit fixed reference, fit policy, video/Flubber sizes and centre relationship, units and validation requirements |
| P5 — Flubber/controls | Active configured experiment behavior: input/bindings, appearance, mappings and live/Advanced configuration with explicit units/ranges and exact restoration |
| P6 — Optional XR | Explicit inclusion or exclusion; when included, the complete world-fixed/head-forward spatial profile and target requirements |

Schema/version, presentation target, remaining experiment policy and integrity
have one authoritative home. P7 owns the exact wire shape and publishes it early.
Consistent member order improves readability; consumers address named fields,
not their order. Video bytes need not be embedded. Recorded paths grant no file
access. Questionnaire content must not require reopening its source document.

The all-settings goal includes active **experiment-defining configuration**.
Transient test movement, focus, an unapplied dialog or inspection camera is not
automatically a setting. Root's narrow implementation interpretation is to save
the currently active renderer choice explicitly: Flubber, Grid or the existing
project-authored procedural Face. This adds no historical Face/Photoatlas code,
assets or instrument claim. Saved selection and restoration must be visible.

Preserve strict historical v1 readers. New contracts are explicitly versioned;
an unavailable contribution cannot be omitted into v1 to enable Save. P4's
internal editing draft is not an accepted layout contribution.

## Verified starting point and remaining seams

New work starts from combined `7946bc6b319ddf689bdaa81c07ec8aa6a4b3869d`, application
`d6acfd1`, site tree `e84b6c91fa59ae21748847fc1ea5883287011b62`. Canonical was still
`ba2110f`; owner-ready and integrated-candidate evidence are distinct from
canonical delivery. Root also read and collected documentation amendment
`d83c7a5` in its own documentation branch without changing application source.

Independent root source review at `7946bc6` found:

1. `app.js` still generates through `createExperimentPackageV1`; its settings
   draft requires imported `experiment.json`. The new path must compile directly
   from accepted producer contributions.
2. `screen-layout-state.js` remains pending/null with a throwing accepted
   validator. Real P1/P5 geometry and internal draft restore already exist;
   accepted layout and explicit per-recipe reference selection are missing.
3. P5's payload contains historical `input`, `visual`, `mappings`. Configured
   halo parameters, response/grid modes/dimensions, hold/timing behavior and
   edited anchor labels remain separate Preview state. S5 owns closing this
   inventory, invalidation and restoration with Live Preview.
4. Policy/language components exist separately; P7 must assemble and cross-check
   them. Historical block/after-stimulus questionnaire hooks have no approved
   variant mapping. Preserve explicit errors; before/after-session can proceed.
5. File adapters and Open/Edit remain v1-specific. Add successor dispatch and
   coordinated owner restoration while retaining acknowledgment, cancellation,
   edit, delayed-response and teardown guards already verified.

These are source findings, not new tests or Runner failures. Reuse the repaired
contribution lifecycle, media-refresh fencing and P3 content-only restoration.

## Component checkpoint — 2026-09-12, integration still active

These are exact owner handoffs, not a completed application or canonical release.
The earlier source findings above describe the starting point, not the latest
producer code. Integration reported clean `4091c71` with the full JS compiler
and live P4 editor collected; shared master confirmation/save/Open wiring is
the active critical path. Owner native readers and final combined checks remain
separate evidence.

| Owner | Ready component and evidence boundary |
| --- | --- |
| P1 | `0b7f793` / native `0e9b28b` / parity `ea7cf7d`: reversible relative-location v2 IDs, exact content/location pairs, complete oriented geometry and guarded restore/rebind. Native source checks with `DOCS_RS=1` are not linked-build evidence. S1 is restoring the missing pinned development SDK for normal native checks. |
| P2 | `b08ceb0` (app `6654bc2`): complete definitions, languages, score annotations and hash-bound label-repetition presentation companion; full-master UI restoration remains an integration check. |
| P3 | `2a16397`: location/content v2 variant contribution and independent timeline/marker fixtures; `11670a7` closes the stale CSV/XLSX save race. Native export adoption and long-ID combined UI checks remain with S3/integration. |
| P4 | `d0267ff` accepted pure/native contract; live `2499517`: both explicit reference methods, no default, fixed-reference fit, full P1/P5 dependency validation and guarded content restoration. Final shared-controller acceptance remains integration work. |
| P5 | `495ee13` (app `5c0ad7a`): complete v2 appearance/input/mappings, renderer, labels, halo and response/Advanced configuration. Preview `9237279` fixes bounded narrow editor captions while preserving full saved/accessibility text. |
| P6 | `485c2da` (application `188c080`): actual full-master included-XR and excluded-profile fixtures, both P1/P3 generations, complete P5, strict readback and independent-process reproduction. Owner reports 731 JS checks; this is component evidence, not the new combined controller. |
| P7 | `828fff7`: complete JS master compiler, strict reader, canonical integrity, named save/readback and one-use coordinated restore. Owner reports 725 JS checks at this checkpoint. Independent native master reader/persistence and actual app wiring are still active. |
| App boundary | `a0283d9`, static followup `7e4b719`, defect fix `17b2d24`: separate Planner surface/authority. Root source review confirms the fix avoids removed Run-media teardown and preserves visible/announced workspace errors. Integrated reproduction and rendered error layout remain checks. |

Root independently read the two canonical master fixtures at exact `828fff7`.
They contain ordered P1–P6 keys, 3 unequal variants × 2 language routes, full
questionnaire definitions/options with positive, negative/fractional and null
score annotations, the presentation companion, all P5 v2 field groups, accepted
P4 and explicit P6 exclusion. Independent Node crypto/canonicalization reproduced
both definition and reproduction hashes and every segment hash. The location
fixture keeps `session_a/clip.mp4` and `session-a/clip.mp4` distinct while allowing
shared content identity. This verifies those saved samples; it does not establish
fresh UI authoring or final native/browser parity.

The independent Windows prerequisite audit found the pinned runtime intact but
the former temporary development SDK removed. Rust/MSVC are installed. Use the
existing verified 1.28.6 preparation script and process-scoped build paths; never
count dependency-discovery bypasses as a linked artifact. Existing safe pre-main
DLL loading and runtime redistribution/resource packaging gates remain distinct
release limits. This goal does not approve a new unsafe adapter or runtime bundle.

## Existing-task assignments

All owners received the new goal and Planner-only clarification. Stage:
**Backend Verification**, including rendered checks for truthful state/access.
Each owner works in its isolated branch and only its segment and named seams.

| Existing task | Bounded allocation |
| --- | --- |
| S1 | P1-03–07: locations/identity, native oriented metadata, full contribution and authorized media rebind |
| S2 | P2-04–08: questionnaire/language/scoring/presentation preservation and successor restore |
| S3 | P3-04–08: variants/ISIs/markers embedded and restored exactly; planned-sequence reproduction |
| S4 | P4-03–07: accepted layout contract, live validation and deterministic geometry round trip |
| S5 | P5-05–08: full configured feedback/input/Advanced schema, invalidation and restore |
| Live Preview | Actual control inventory/projection with S5 and existing popup handoff; no parallel contract |
| S6 | P6-01–05: optional XR inclusion/exclusion, target validation and master-profile round trip |
| S7 | P7-03–09: successor schema/compiler/readers, cross-references, named save and coordinated reopen |
| Add segment confirmation flow | Sole integration owner: shared app/native wiring, subscriptions and complete Planner workflow fixtures |
| Create segment catalogue | Root coordination, roadmap/goal/visual evidence and independent Planner QA |

New integration branch: `codex/segment-planner-completion` in
`D:/GitHub/affect-tracker-research-integration-preview`; prior UI branch preserved.
Root branch: `codex/planner-completion-roadmap` in
`D:/GitHub/affect-tracker-research-planner-completion-roadmap`.
Root owns 60/62/64/67 and a unique 55 entry. Experiment Runner owns its separate
charter/router amendments, new 16/65/66 and unique 55 entry. S7 owns schema files;
coordinate shared application hunks through integration. No competing formats.

## Remaining decisions

Pending choices block only their dependent behavior. Continue independent schema,
editor, validation and persistence work; do not invent policy for a passing test.

- **Q08 implementation refinement:** implement both proposed analysis methods as
  an explicit required per-recipe UI choice, with no silently selected default:
  the largest oriented width×height video or the combined maximum-width/height
  envelope. After selection, automatically derive one fixed reference, preview
  it and save the method/result. Missing selection blocks the current recipe,
  not the application's accepted-type implementation. This parameterizes the
  Planner rather than inventing a global answer; the global default preference
  is optional and still unanswered. S4 owns the exact versioned semantics.
- **Q05:** original absolute-directory provenance remains optional/unanswered.
  P1 confirms existing logical roots and exact relative source/package paths
  fully represent authored media declarations. Reopening requires fresh explicit
  root authorization, rehash/reprobe and exact comparison. Neither live permission
  nor Runner relocation policy is inferred. A custom native shell root currently
  resets to the app-data default on restart; that local preference gap is separate
  from master JSON generation and is not a universal compilation blocker.
- **Q04 answered:** the user requires location-derived IDs such as
  `FOLDERNAME_video.mp4` and rejected the artificial collision premise. Preserve
  the complete relative path, filename and extension in an unambiguous reversible
  encoding; distinct legal paths must remain distinct. Do not create collisions
  by replacing different punctuation/Unicode sequences with the same text, or
  require manual ID repair/arbitrary suffixes. Immutable byte identity is separate.
  Moves change the location-derived annotation and invalidate dependent acceptance;
  S1 coordinates exact versioning/migration with P3/P7.
- **Q09:** surface concrete questionnaire-placement/scoring ambiguities only as
  needed. Preserve explicit codes/provenance; do not invent translations,
  computed scores or implicit administration.
- **Q10:** the latest all-settings goal requires preserving active configured
  behavior. S5 records the exact inventory and any remaining semantic decision,
  separating temporary inspection/test state.

Do not duplicate the outstanding preference questions or treat the general
completion request, elapsed time or continuation as answers. Parameterized
authoring with an explicit researcher selection does not require choosing that
researcher's actual experiment configuration in this development task.

## Planner completion evidence

Each checkbox needs exact integrated source and evidence. None requires a working
Runner, actual recording or final Planner–Runner correspondence validation.

- [ ] **G01 — Fresh authoring:** create a complete recipe through UI with at least
  two videos, repeated occurrences, unequal variants, named ISIs, multilingual
  questionnaires, nondefault feedback and accepted layout; no imported experiment
  definition or required authoring sidecar.
- [ ] **G02 — Full coverage:** each configured experiment value has one saved
  authority or documented deterministic derivation. P1–P6 are represented,
  including explicit optional exclusion; no lost or contradictory settings.
- [ ] **G03 — Strict composition:** all contribution/cross-reference/language/
  target/geometry/planned-marker checks pass; unknown/missing data rejects with
  actionable owner navigation.
- [ ] **G04 — Reopen and rebind:** saved content restores across every segment;
  absent media authority keeps dependent readiness pending. Exact rebind preserves
  edits and allows fresh acceptance/re-export.
- [ ] **G05 — Nondefault fidelity:** newly saved P5 controls and physical/relative
  P4 geometry affect payload/fingerprint and restore exactly; include explicit
  optional XR profile and exclusion cases.
- [ ] **G06 — Independent Planner reproduction:** separate-process validation and
  canonical re-export reproduce semantics and specified bytes across saved
  variants/languages/profiles; historical v1 remains readable.
- [ ] **G07 — Truthful persistence:** named save, cancel/failure/retry, write/close/
  readback failure, stale edits, competing Open and teardown preserve newer state.
  Only acknowledged current bytes produce Saved status.
- [ ] **G08 — Invalid/stale design:** missing translations/media, changed bytes,
  invalid geometry, unsupported placement and dependency edits block affected
  acceptance/export while preserving unrelated authored fields.
- [ ] **G09 — Rendered final workflow:** inspect populated/error states and Save
  at desktop/narrow widths; compact labels, no duplicate settings, reachable
  controls/footer and keyboard/error access.
- [ ] **G10 — Integrated delivery:** appropriate tests/builds pass on the exact
  candidate; required Planner gaps are closed or explicitly scoped out by the
  user, and integration records the delivered source/artifact.
- [ ] **G11 — Planner application boundary:** remove participant Run/Start controls
  from the Planner and verify its bootstrap/native surface does not construct
  acquisition, participant playback, outlets or recorders, or expose Runner-only
  commands. Integration coordinates this shared seam with the separately allocated
  Runner owner under amendment16. Retain authoring previews and narrow media
  inspection. This is Planner isolation evidence, not Runner correspondence.

Keep the goal active while required Planner work remains. Idle tasks, UI-only
checks or downloading a draft are not completion. Actual Runner execution,
recording, physical playback/timing, headset qualification and final correspondence
remain the later development stage specified by the researcher.
