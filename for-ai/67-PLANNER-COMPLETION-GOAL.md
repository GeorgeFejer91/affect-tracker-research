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
   accepted layout and the remaining Q08 reference policy are missing.
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

- **Q08:** fixed-reference percentages and automatic reference analysis are
  accepted. The already-pending question distinguishes the largest oriented
  width×height video from a rectangle combining maximum width and height. S4
  identifies any additional exact required choice without reopening principles.
- **Q05:** the already-pending question distinguishes portable references with
  explicit folder reselection from requiring the original location. Pure content
  restore is independent of authorization; P1/P7 can implement it now.
- **Q04:** S1 identified paths such as `session-a/clip.mp4` and
  `session_a/clip.mp4` producing the same readable alias. Root has asked the user
  to choose explicit unique-ID edits with rescan preservation (recommended) or
  automatic suffixes. This question is already pending; do not ask it again.
- **Q09:** surface concrete questionnaire-placement/scoring ambiguities only as
  needed. Preserve explicit codes/provenance; do not invent translations,
  computed scores or implicit administration.
- **Q10:** the latest all-settings goal requires preserving active configured
  behavior. S5 records the exact inventory and any remaining semantic decision,
  separating temporary inspection/test state.

Q04/Q05/Q08 remain pending at this checkpoint. Do not duplicate their questions or
treat the general completion request, elapsed time or continuation as answers.

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
