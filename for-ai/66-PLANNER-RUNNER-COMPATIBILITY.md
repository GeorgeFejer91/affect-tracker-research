# Planner JSON and Runner compatibility contract

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
