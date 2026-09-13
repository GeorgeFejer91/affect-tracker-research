# Planner JSON and Runner correspondence

Current source audit: `32c7c2d`, 2026-09-13. This maintained map points to
exact contracts; it does not define another schema.
The [prior ledger](../docs/history/66-PLANNER-RUNNER-COMPATIBILITY-2026-09-13.md)
is historical evidence, not current implementation status.

## Composition and interpretation

Planner UI and CLI edit the same owner models. Confirmation accepts complete
current owner content; it does not append duplicate contributions or write a
file. Edits invalidate affected acceptance. P7 captures accepted P1–P6, with
P5 captured at final Save, then validates cross-references and publishes JSON.

Master root members are exactly `schema`, `version`, `recipeId`,
`presentationTarget`, `policy`, `segments`, `integrity`.
The named segment map has P1–P6. JSON member order is never execution order.
P7 owns assembly, target/policy, integrity, acknowledged saving and Open.

Open validates everything before owner restoration, then restores P1, P2, P5,
P3, P4, P6, policy and target in dependency order. Editable design is distinct
from media permissions/readiness. Partial/stale restoration must not adopt an
unchanged saved source. Unchanged-source copying remains a separate supported
path; newly edited export needs current acceptance.

Runner independently parses exact bytes in JavaScript and Rust. Participant,
language path and saved variant produce a selected plan:
before-session forms → authored video/ISI occurrences → after-session forms.
Native observed lifecycle controls video/ISI progression. Form duration depends
on responses. Planned offsets are not observations. Unsupported requirements
must block with a precise reason.

See [master](../docs/planner-master-recipe-v1.md),
[master3](../docs/planner-master-v3.md),
[SurveyJS/master4](../docs/surveyjs-questionnaires.md),
[restoration](../docs/planner-recipe-restoration.md) and
[Runner plan](../docs/runner-master-execution-v1.md).

## Owner and consumer map

| Owner | Complete JSON authority | Consumer / boundary |
| --- | --- | --- |
| P1 Workspace/videos | Study, logical roots, locations/content IDs, hashes, lengths, durations and versioned geometry | P3 references; P4/P6 fit; native media binding. Video bytes remain external, hash-bound assets |
| P2 Questionnaires/languages | Full definitions/SurveyJS objects, provenance, modules, exact language tree and presentation | Form sequence, pinned renderer, native answer validation, durable responses/information stream |
| P3 Versions/ISIs | Named ISIs, variants, ordered occurrences, library identity and marker meaning | Exact selected chronology. `allocation:{kind:"runnerAssigned"}` declares ownership, not a repeating/cyclic algorithm |
| P4 Desktop layout | Reference method, viewport/calibration, units, sizes, centres and fit | Shared geometry, native viewport/media enforcement and participant rendering |
| P5 Feedback/input | Bindings, renderer, colors/labels, halo, mappings and response grid/timing/hold | Shared feedback projection and native response reducer. Legacy step/geometry fields remain inactive compatibility data |
| P6 XR | Explicit exclusion or complete spatial profile/target | Editable authoring; desktop Runner rejects XR |
| P7 / root | Sampling, output, playback/audio, authored LSL convention and integrity | Compiler/intake/native worker. Session/recording choices belong to Runner |

Self-contained design needs no Planner memory, earlier recipe, questionnaire
source file, host locale or default library. Runtime video resolves from the
loaded JSON's project root and declared package-relative paths, with fresh
verification. Paths grant no permissions. Survey resource completeness remains
an open mismatch below.

## Exact supported generations

| Master | P1 workspace | P2 | Reproduction suffix | Runner commands |
| --- | --- | --- | --- | --- |
| 1 | 1 or 2 | 1 | v1 historical / v2 | Start/Action 1 |
| 2 | 1 or 2 | 2: typed + Likert | v3 | Start/Action 2 |
| 3 | 3: controlled geometry | 2 | v4 | Start/Action 3 |
| 4 | 1, 2 or 3 | 3: SurveyJS + retained forms | v5 | Start/Action 4 |

Reproduction names use prefix `planner-recipe-reproduction-`.
`ExperimentPackageV1` remains a separate nine-root-member schema with its own
strict parser/compiler/runtime. Preserve its semantics and records. New capture
chooses a version from accepted owner contracts; Open never silently upgrades.

JS ingress: `site/src/research/planner-recipe.js::parseSupportedPlannerRecipe`;
Runner: `runner/src/recipe.js::readRunnerRecipe`.
Rust: `research_planner_recipe_supported::parse_supported_planner_recipe_bytes`;
plan compilation: `research_runner_master::PreparedMaster::read`.

## Session choices and evidence

The source JSON remains immutable. Runner owns participant/variant selection,
XDF-based advisory defaults, recording choices and session stream names. Use
actual saved variant IDs; V1/V2 display names index the saved order. See
[preselection](../docs/runner-version-preselection.md) and
[recent files](../docs/runner-recent-files.md).

Approved controller behavior requires original/effective bindings, native
validation, a fresh actual-device test, a frozen override hash and matching
attempt/recovery evidence. **Execution is not implemented at the audit base:**
changed settings are drafts that block Start. P5 v2's legacy `input.stepSize`
does not control its effective response-grid step.

The [information stream](../docs/runner-information-stream-v1.md) preserves
canonical recipe, selection, complete definitions, responses and observed
events for XDF-only reconstruction. It does not embed video bytes or repair
missing events. Master recovery remains unimplemented.

## Verified coverage and open gaps

The [critical audit](../docs/planner-runner-correspondence-audit.md) records
commands, source references and acceptance criteria. JS probes pass exact
round trips and 24 variant/language selections across masters 1–4, with
missing-segment/stale-integrity rejection. The focused existing suite passes
66 checks. No actual native session is claimed.

- A valid 5,616,674-byte master passes the reader but its P2 owner snapshot
  exceeds the separate 5 MiB handoff limit.
- SurveyJS permits remote image URLs without embedding/hash-binding resource
  bytes. Retaining the object does not ensure identical presentation.
- Master4 has intake/normal Start dispatch, but local validation accepts only
  master3 while normal research playback qualification remains closed.
- Controller override execution and receipts remain unimplemented.
- Mixed historical/controlled media proofs parse but fail Runner attestation
  pending native location mapping.

Native playback qualification, actual geometry/ISI observations, device testing
and independent actual-session XDF remain open under
[30](30-TESTING-AND-RELEASE.md) and [72](72-RUNNER-FINAL-VALIDATION.md).
Do not close capability checkboxes from parser or synthetic evidence.
