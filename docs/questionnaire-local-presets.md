# P2 researcher-local questionnaire preset owner

This is the owner handoff for the 2026-09-12 local German TAS amendment, not an
installed-app qualification. Main owns registration, file grants, native bridge,
picker composition and study-source persistence. Existing public TAS eligibility
is unchanged. No German questionnaire item text is shipped by this change.

## Fixed source

- Preset ID: `tas-20-de-handrack-2016-local`; family `tas-20`, language `de`.
- Logical name: `tas-20-de-handrack-2016-local.csv`.
- Source SHA-256: `7b32c878cf83d2b0348498355402f1a8d1db5853aeffeaf2f74863ea701eef92`.
- Source length: 124978 bytes.
- Definition SHA-256: `c8a6c8c8609caa590124144ce03dd9fb12570edcd15fb556a4b4c32dbb3eb60d`.
- Definition ID/version: `tas-20-de` / `handrack-2016-a8-raw`.
- Handrack (2016), appendix A8: 20 items, five answers, raw codes 1–5. Preserve
  the source's exact wording and attribution; do not infer reverse scoring,
  totals, subscales or public redistribution rights. Required responses are the
  local mock policy, not a claim about the original protocol.

The user-authorized source and owner proof remain external in
`D:/GitHub/.affect-checks/tas20-german-source-20260912/`. Do not copy them into the
repository/public build. Root owns the source/permission amendment in `for-ai/70`.

## Native service (new module only)

`src-tauri/src/research_local_questionnaire_presets.rs` provides:

```rust
LocalQuestionnairePresetStore::new(app_data_root: PathBuf) -> ResearchResult<Self>
install(&self, preset_id: &str, bytes: &[u8]) -> ResearchResult<LocalQuestionnairePresetReceipt>
read(&self, preset_id: &str) -> ResearchResult<Option<LocalQuestionnairePresetSource>>
```

The host creates and supplies its established actual app-data root; no renderer
path is accepted. Main must use that same real user-data location in hidden CLI
authoring even when other profile state is isolated. The private layout is
`questionnaire-presets/<presetId>/<fixedSourceSha256>.csv`. A single installation
therefore serves new studies and new workspace folders.

The receipt has exactly eight camelCase fields: `presetId`, `familyId`,
`languageTag`, `logicalName`, `sourceSha256`, `byteLength`, `usageScope`
(`researcherLocal`), and `publicReuseVerified` (`false`). A read returns exactly
`{receipt,bytes}` or `None` for genuine absence. There is no absolute path,
caller-selected relative path or workspace ID in the receipt.

Unknown IDs, wrong size/hash, corruption, nonordinary files, reparse points,
detected replacement and unreadable paths fail closed. Every successful read
hashes the same bounded snapshot that it returns. Windows opens deny shared
writes/deletes and use the safe standard-library reparse flag. Installation uses
exclusive staging, sync, verification and atomic no-clobber hard-link publication;
there is no replacement fallback. Existing exact bytes are idempotent; existing
corrupt content is not overwritten. A failure after publication does not imply
rollback: the caller may re-read the fixed ID to reconcile the result.

Identity checks use canonical paths, metadata, and on Windows creation time;
they are not a new handle-relative filesystem sandbox or file-index guarantee
against a privileged adversary spoofing metadata. Content acceptance remains
bound to the fixed SHA-256. No new unsafe boundary or dependency is introduced.

## JavaScript owner and composition contract

`site/src/research/questionnaire-local-presets.js` exports the metadata registry,
availability/merge helpers, verifier and factory:

```js
createResearcherLocalQuestionnairePresets({surface, readSource})
// readSource({presetId}, {signal,isCurrent}) -> {receipt,bytes}|null
owner.inspect({signal,isCurrent})
owner.load(presetId, {signal,isCurrent})
owner.loadIntoEditor(presetId, {editor,readContext}, {signal,isCurrent})
owner.destroy()
```

`surface` is `tauri` or `browser`. Browser inspection returns no native choices
and never calls the reader. Each native inspect/load freshly reads, clones,
verifies the closed receipt and fixed source, then uses the production CSV
importer. It retains no source cache or parallel questionnaire state. Metadata
descriptors report installed/notInstalled/unavailable. Cancellation is rethrown,
not relabelled as an absent source. Guards must include an AbortSignal and a
current-operation predicate.

`readContext()` supplies stable `{languages:[languageTags],locked,...}` context.
`loadIntoEditor` requires an already-created, selected-language, pristine slot;
it fences context changes, slot replacement, edits, cancellation and teardown
before calling the real editor's guarded `loadDefinition`. It opens and fills
that accordion with the imported prompts, displayed labels and coding values.
It never creates a family, saves a source or confirms a segment.

Main creates a family only through the normal owner workflow when necessary,
merges verified local choices into the existing single prebuilt picker, and
routes the separate save through `WorkspaceService.store_questionnaire_asset`.
The merge helper replaces only a matching unavailable public placeholder;
it never changes the public registry's readiness/rights flags. Copy the exact
source into each selected workspace before accepted study adoption. A completed
study must not depend on this global authoring library at runtime.

## Evidence and remaining integration gate

- Full JavaScript regression: **806/806**; focused local-preset tests **6/6**.
- Native auto integration harness: **8 passed**, including six preset tests and
  two existing error tests; one external-source test intentionally ignored in
  the default run. Separate explicit external-source run: **1/1 passed**.
- Real fixed German CSV passed native installation and reopening through a new
  store instance. Independent production importer/editor proof verifies exact
  definition, all 20×5 raw codes, unchanged English slot, fresh source reread,
  occupied-slot refusal and corruption refusal. The editor save callback received
  the original exact bytes. Its native reader/save callback were injected; this
  is not IPC, real workspace-write or installed picker evidence.
- External evidence: `local-preset-owner-proof.json` and
  `verify-local-preset-owner.mjs` alongside the private source. The initial proof
  harness incorrectly expected regenerated bytes for an unchanged sheet; the
  corrected proof checks the preserved-source save callback and passes.
- Cargo emitted the existing lib/bin PDB collision and unrelated dead-code
  warnings, plus unused existing error helpers in the standalone harness.

Default native test command:
`cargo test --manifest-path src-tauri/Cargo.toml --locked --no-default-features --test research_local_questionnaire_presets`.
The actual-source test requires explicit `AFFECT_LOCAL_TAS_SOURCE` and filter
`verified_external_german_tas_source_installs_and_reads_exactly -- --ignored --nocapture`.

Main still must register the native module/service and authorized install/read
commands, install the private source, integrate the picker, verify a new study's
source copy/save, and collect native UI/CLI correspondence evidence before an
installed-app or full Section 2 completion claim. No app reload was performed by
this owner pass. Runner execution remains outside P2 scope.
