# Planner JSON and Runner compatibility contract

## Typed demographics and independent XDF reconstruction — 2026-09-12

The researcher now explicitly requests a shipped EN/DE demographic form and a
full actual Runner smoke whose saved XDF alone reconstructs participant metadata,
questionnaires/answers and every identified video/ISI transition. See [69](69-CLI-RUNNER-END-TO-END-GOAL.md).
S2 owns bilingual text/integer/single-choice definitions, main the explicit
versioned producer/native reader seam, and Runner presentation/typed answers and
the new versioned primary information stream. Existing Likert/master/legacy LSL
contracts retain exact dispatch and must not silently accept a new payload.

The XDF must retain exact canonical Planner content and immutable session
selection, complete definitions and typed answers, and observed occurrence
markers with actual clock timestamps. This is additional run evidence; Planner
still does not own XDF stream selection or capture policy. Reconstruction uses
the saved stream alone before comparison with original JSON/UI/native evidence.
Media bytes remain external hash-bound assets. Startup bundle fragmentation is
explicit, bounded and integrity checked, and missing chunks/events are reported
instead of repaired from expected timings. Current synthetic streams are not
evidence that the full requested real playback run has succeeded.

## Correspondence goal activated — 2026-09-12

The direct request now activates the formerly deferred end-to-end test: author
from production CLI, verify UI parity, load the exact exported master and observe
Runner actions. See [69](69-CLI-RUNNER-END-TO-END-GOAL.md) for allocation,
evidence and remaining inputs. Earlier deferral text below does not block this
newly authorized work, and completed Planner authoring remains independently true.
The 2026-09-12 correspondence pass now consumes P7's complete
`affect-research-planner-recipe` v1 with `planner-recipe-reproduction-v2` identity.
This is a separately allocated desktop test, superseding the earlier blanket
deferral. The existing strict native/browser master readers and owner projections
are the authority; no conversion to a reduced v1 package is permitted. Validity,
selected-content interpretation and actual execution remain separate claims.
The source at pass start is `3301440`; implementation/evidence follows below.

This is the producer/consumer inventory, not another recipe schema. P7 owns
complete canonical recipe formats. Runner derives requirements after strict
parsing and rejects any unsupported execution feature. The final correspondence
test is the last development stage; it does not block independent Planner
completion. [16](16-COMPANION-APP-BOUNDARY.md) defines the two-program boundary.

## Implemented predecessor

`ExperimentPackageV1`, schema `affect-research-experiment-package`, has exactly
`schema`, `version`, `packageId`, `assetRoot`, `assets`, `languageSelection`,
`playback`, `settings`, `integrity`. `assetRoot` is `assets/stimuli`.
Do not add `requiredCapabilities`, recording policy or successor contributions.

JS authority: `site/src/research/experiment-package.js`,
`parseExperimentPackageV1`, `compileExperimentPackageSelectionV1`,
`enumerateLanguageRoutesV1`. Rust authority:
`src-tauri/src/research_experiment_package.rs`,
`parse_experiment_package_bytes`, `parse_canonical_experiment_package_text`.
Readers reject unknown/missing/duplicate fields, invalid references/integrity,
noncanonical bytes and unsupported versions; UTF-8 without BOM, canonical JSON
plus LF, maximum 16 MiB. Do not reconstruct it from editable UI fields at Start.

| Producer option | Current v1 representation | Runner obligation / successor seam |
| --- | --- | --- |
| Study and participant metadata | `settings.experiment` | Preserve identity, title, count and sampling frequency; count is not an allocation algorithm |
| Video library | `assets.stimuli` | Exact identity, relative path, SHA-256, length, MIME and duration; explicit root authorization and full verification |
| Order and ISIs | `settings.externalProtocol.definition` | Exact historical participant/block/video schedule and explicit `isiAfterMs`; do not reinterpret as successor variants |
| Bindings | `settings.input` | Every saved preset/custom binding and digital step; actual input capability/test before acquisition |
| Feedback | `settings.visual` and `settings.advanced.mappings` | Grid/Flubber visibility, transparency, eight colors, strokes, halo and six mappings; use shared renderer math |
| Legacy layout | `visual.sizePercent`, `overlayPosition`, `lockPosition`; `playback.feedbackPlacement` | Existing normalized layout and adjacent feedback only; these are not physical P4 reference geometry |
| Full-video policy | `playback` | Start at zero, decoded end, rate 1, no seek/loop, allowed pause, audio unmuted at 1, restart from beginning |
| Questionnaires | `settings.questionnaires` | Full definitions, ordered modules, exact labels/codes and existing hook semantics; no source content substitution |
| Language | Full `languageSelection` tree | Explicit complete participant traversal to a terminal; never infer locale or choose first route |
| Table output | `settings.output` | Retain CSV/TSV intent and canonical data/journal contracts |
| LSL emission | `settings.advanced.lsl` | Preserve enabled/stateStream/streamType/markerStream/sourceId; actual transport/capability separate |
| Recorder | No Planner field, by user decision | Runner owns stream selection and XDF policy; save separately with attempt evidence |

## Successor coordination

At base `7946bc6`, accepted owner snapshots are internal authoring state, not a
finished runnable master. P7 is implementing the comprehensive successor JSON.
Each new master version needs one strict full reader, exact canonical fixture,
independent reconstruction, explicit dependency checks and preserved v1 dispatch.

| Owner | Required successor handoff | Runner consumer / initial gap |
| --- | --- | --- |
| P1 | Full study/catalogue, immutable IDs and oriented geometry | RR-02/04; do not promote raw native dimensions to oriented display geometry |
| P2 | Full multilingual definitions/tree and explicit placements | RR-03/06; successor block/after-stimulus correspondence must be explicit |
| P3 | Ordered named-ISI variants, hashes, occurrence IDs and marker definitions | RR-03/04/07; allocation is Runner-owned, no algorithm selected by Planner |
| P4 | Accepted units/reference/calibration/centres/fit and feedback bounds | RR-05; authoring `screen-layout-draft` must not execute |
| P5 | Complete approved saved input/style/response controls and math | RR-05/07; preview-only Face/halo-width/tiles/hold drafts do not become defaults |
| P6 | Optional explicitly targeted spatial profile | RR-02 rejects required XR on desktop; no silent desktop fallback |
| P7 | One complete schema/version with all required contributions | RR-02 dispatch; a valid component is not a valid master |

Keep capability derivation separate from schema validity. Valid but unsupported
recipes may be inspected with precise reasons; Start must remain unavailable.
Missing settings are not filled from browser storage, host locale, a previous
run or Planner memory. Unknown features cannot be silently ignored. Record exact
schema/build/recipe hashes for the later correspondence matrix.

## Evidence contract

Use `test/fixtures/experiment-package-v1.canonical.json` and
`test/research-experiment-package.test.js` for strict v1 round trips and two
independent hostile-process reproduction. Preserve Rust mirror tests. Add
consumer cases for unknown schema/version, corrupt integrity, authoring-only
documents, unsupported targets, missing media and stale asynchronous intake.

Later execution evidence must compare every approved saved control with actual
Runner behavior, including video/ISI order, stable layout across mixed aspect
ratios, Flubber extremes/visibility, language/form codes, sampling and emitted
markers. XDF tests independently reopen typed multi-stream recordings, verify
source timestamps/clock-offset chunks and incomplete/error reporting. They are
Runner tests, not a requirement that Planner serialize recording policy.

Do not mark native playback, hardware LSL, physiological data quality, installed
accessibility or research readiness as verified by parser/UI/build fixtures.


## Complete successor producer handoff — 2026-09-12

P7 delivered JS master `828fff77f7bce764d01538f523831f7886a152ef`, then independent
native full reader `70b30a441cb6bdb49f0b642ba8be1ea185f27750`. The latter owns
`research_planner_recipe::parse_planner_recipe_bytes/file`, `PlannerRecipeV1`
validation/reproduction/selection reconstruction/canonical bytes and the typed
`research_load_planner_recipe` new/legacy dispatcher. Save remains Planner-only.
Its current portable identity algorithm is `planner-recipe-reproduction-v2`;
old algorithm semantics remain independently validated. See that checkpoint's
`docs/planner-master-recipe-v1.md` and current desktop/XR fixtures for exact APIs.

Required producer follow-up: include
`48318a9c514164d794a8f781b2129dc97729835c` and its producer ancestry when consuming
the native reader. Its flat language graph traversal uses P2's validated node
count (up to 256), independently of the unchanged JSON nesting limit of 64.
The earlier reader wrongly rejected a valid 66-node graph by reusing the JSON
depth limit. P7 supplied a complete 66-node/one-leaf recipe and reconstruction
fixture with Rust/JS/browser coverage. Treat this as a required compatibility fix,
not a new language policy or evidence of Runner execution correspondence.

This is a completed producer handoff, not evidence that Runner has integrated
its execution semantics. The delivered Runner backend checkpoint `b11565c`
accepts the frozen complete package-v1 contract. Chat Orchestrator explicitly
placed current-master intake/execution correspondence in the later RR-02/RR-10
stage and confirmed it must not delay Planner completion or this backend handoff.
Do not convert the master into an older package by dropping P1–P6 options, infer
an allocator, reinterpret questionnaire label repetition as pagination, or claim
XR/native player qualification from successful document reconstruction.

### Runner participant/session consumption — 2026-09-12

Current v1 Runner resolves P01 display input to the declared P001 schedule. Its
preview uses the same strict participant/language compiler as actual preparation;
unknown numbers reject, and questionnaire hooks/ISIs keep their saved positions.
This is not a successor participant allocator. Runner retains the selection and
history per exact canonical JSON, with outputs/recipe-<full SHA-256>/ isolation.
New-attempt LSL names use Runner session naming v1 (P01_<authored base name>), with
an immutable naming receipt; Planner emission base names and original JSON remain
intact. XDF policy/destination belong to Runner. Ledger65 binds software evidence
and remaining native/master qualification. Frozen legacy recoveries preserve names
and paths; nothing is silently migrated or overwritten.

## Current user amendment — 2026-09-13

The JSON is the complete experiment authority; a common default folder must not be required. Use declared IDs, relative asset locations, hashes and owner metadata, with explicit versioned rules for any new locator semantics. See [72-RUNNER-FINAL-VALIDATION.md](72-RUNNER-FINAL-VALIDATION.md) for current portable-path rules and consumer verification gaps.
