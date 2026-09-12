# Native master v2 and supported-version intake

Main allocated this P2/P7 shared decoder lane from form-chain `5f786f0` on
`codex/segment-native-master-v2`. This is Backend Verification: strict typed
intake, canonical identities and independent selection reconstruction. Main owns
lib/native file-service registration; Runner owns worker/presenter execution.

The new modules are `research_questionnaire_recipe_v2`,
`research_planner_recipe_v2` and `research_planner_recipe_supported`. They retain
master2 / `planner-recipe-reproduction-v3`, P2 contribution2 /
`questionnaire-hooks-v3`, presentation2 and selection2. P2 explicitly dispatches
each definition by its schema/version to unchanged Likert V1 or Form V1. It checks
closed objects, definition hashes, unique identities/family-language slots,
complete language coverage, exact module references, session-only placements and
ordered matching `likert`/`fields` presentation entries. It never manufactures a
V1 definition or integrity hash to admit V2.

The existing workspace, variant/timeline/marker, feedback, desktop and XR
algorithms remain their native owners. The two existing master files change only
visibility of `owners`, `read_value`, and six existing helpers used by the new
composition. Legacy validation, accepted versions, hashes and file dispatcher
remain unchanged. The unchanged integrity field shape is reused; V2 independently
requires reproduction-v3 and validates the original V2 definition and segment
hashes before reproducing its matrix.

## Agreed Main/Runner API

```rust
pub enum SupportedPlannerRecipe {
    V1(PlannerRecipeV1),
    V2(PlannerRecipeV2),
}
pub struct LoadedSupportedPlannerRecipe {
    pub recipe: SupportedPlannerRecipe,
    pub canonical_source_text: String,
    pub canonical_source_byte_sha256: String,
}
pub fn parse_supported_planner_recipe_bytes(bytes: &[u8])
    -> ResearchResult<LoadedSupportedPlannerRecipe>;
```

The enum exposes `version() -> u32`, `recipe_id() -> &str`,
`presentation_target() -> &str`, `definition_sha256() -> &str`,
`policy() -> &PlannerRecipePolicyV1`,
`segment(id: &str) -> ResearchResult<serde_json::Value>` and
`reconstruct_selection(&serde_json::Value) -> ResearchResult<serde_json::Value>`.
Segment projections are detached exact owner data; unknown segment IDs fail.
Serialization preserves the original recipe object without an enum wrapper.
The loaded parser completes byte/depth/UTF-8/canonical/duplicate-key checks,
strict typed decode, lossless reencoding and all owner/hash validation before
returning. Public struct construction is not an alternative intake boundary.

Selection2 retains all selection1 outer fields, with `version: 2`. Each
beforeSession/afterSession row is `{module,definition,presentation}` with the
actual mixed definition kind and matching presentation. Authored fields, IDs,
order and identities remain exact. No file/media authority, runtime readiness or
participant answer state is granted by successful reconstruction.

## Independent fixtures and checks

The fixture generator uses Main's real JS compiler/editor at detached commit
`30291fc`, materialized beneath the external evidence directory. Its P2
source-save callback is synthetic. The three fixture families are
`planner-recipe-v2-mixed`, `planner-recipe-v2-xr` and
`planner-recipe-v2-locations`, each with canonical master, reproduction matrix
and applicable selections. The native manifest binds every fixture's file hash
and byte length. Public EN/DE demographics and synthetic legacy Likert content
are engineering inputs, not a participant study or final real-media mock.

The standalone test includes exact production modules without lib edits. It
checks all three canonical masters, every segment/definition/reproduction hash,
every applicable language/variant selection, detached readback, legacy reader
preservation, unsupported versions and algorithms, missing/unknown keys, wrong
mixed kinds/presentations, duplicate IDs, incompatible modules/routes, stale
hashes and transport resource/canonical bounds.

Master source bytes, reproduction matrices, authored data, definitions, routes,
presentation profiles and identities are byte/hash exact. Derived XR projection
alone uses the already-established P6 strict absolute tolerance `< 1e-10`, with
exact profile/metadata and object/array structure. The observed comparison found
150 derived numeric differences, maximum `3.552713678800501e-15`, in XR video
geometry. No production values or hashes are rounded or repaired. The external
`xr-derived-differences.json` retains every exact path/value/delta.

Evidence lives at `D:/GitHub/.affect-checks/native-master-v2/`: pinned JS
materialization, generator, failed/final logs, diagnostic comparison and a
minimal external native Cargo harness with repository dependency/lock versions
and explicit time/parsing feature (normally supplied by app feature unification).
Initial 70/71 passed; an overly strict test representation comparison treated
1.0 and 1 differently. The next 70/71 exposed derived XR rounding and its large
byte-array diagnostic slowed PowerShell output. Both failures are retained;
final tests use canonical comparison and the existing scoped P6 tolerance.

Final focused native gate: **71 passed, 0 failed, 0 ignored** in 2.28 seconds.
`native-test-final.log` records this exact-source run. Rustfmt and diff checks
pass. The initial failures changed test comparisons, not scientific algorithms.

The repository-equivalent command is `cargo test --manifest-path
src-tauri/Cargo.toml --no-default-features --test research_planner_recipe_v2`.
The external `run-focused.mjs` invokes the same source harness without Tauri
composition or the shared build target. Existing unused-owner warnings remain
visible. Native GUI/CLI, browser, file persistence, actual Runner playback,
answers/LSL/XDF reconstruction and installed qualification are not tested here.
