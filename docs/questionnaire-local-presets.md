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

## Main composition checkpoint

The shared integration now registers `LocalPresetService` for Planner only,
using the actual `app.path().app_data_dir()` for GUI and hidden CLI. Optional
store initialization failure is exposed as unavailable, not an app-start failure.
`research_read_local_questionnaire_preset` accepts `{request:{presetId}}`;
`research_install_local_questionnaire_preset` accepts
`{request:{presetId,bytes}}`, with an exact bounded byte-array deserializer.
Both enforce the native Planner role and `research` window. No path-valued
argument, Runner binding, new dependency or unsafe boundary is added.

The actual native bridge connects the helper to the existing prebuilt picker.
Opening it freshly verifies the private source; adding it fills only a pristine
selected-language table, then saves through the existing guarded work-folder
source store if one is selected. Without a work folder it remains an unsaved
draft. The UI offers a fixed-source local installation file input; source/hash
errors do not replace a study table. Section confirmation remains explicit.
`P2.localPresets` is a read-only metadata projection in the same CLI session,
never source bytes or a scientific recipe contribution. Its ready state means
the native source was freshly read and production-imported, not study acceptance.

Main's focused native check passed **7 tests with 1 external-source test ignored**.
The corrected full combined Node gate passed **914/914** with process-scoped D:
temporary storage. A first run retained a missing explicit CLI native-adapter
allow-list entry (913/914); a subsequent C:-full run failed eight filesystem
tests with ENOSPC. The linker likewise failed in C: scratch before the unchanged
native test passed with D: scratch. No acceptance/storage gate was relaxed.
Exact actual installation, native IPC readback and rendered picker evidence
remain distinct follow-up gates at this composition checkpoint.

## Windows namespace correction and actual local installation

The first real user-data installation stopped in store initialization, before
source publication: Windows packaged-process virtualization resolved the ordinary
`questionnaire-presets` child into the host package's LocalCache while the parent
still resolved to Roaming. The old exact-path check rejected that OS-managed
redirection. Initialization now resolves only this fixed namespace once, checking
ordinary/non-reparse parent and child identities before and after, then pins the
resolved directory. All subsequent preset-subdirectory and source exact-path,
identity, bounded-read, hash and no-clobber checks remain unchanged. A new test
explicitly rejects a namespace junction instead of treating it as virtualization.

The corrected native harness passes **9 tests**, with two explicit external
maintenance tests ignored by default. The separately authorized installation
and fresh-store reopening passed **1/1**, retaining exact 124978 bytes and the
fixed source hash. Evidence is external under
`D:/GitHub/.affect-checks/local-preset-main-20260912/`:
`native-namespace-tests.log`, `native-install-resolved-namespace.log`, and the
read-only `path-diagnostic.rs`/executable. The earlier initialization failure
remains in `native-install.log`.

This is installation into the current host's OS-resolved Planner namespace,
not proof that a separately launched unpackaged application shares that physical
location. No app-data setting or personal files were moved. Native CLI readback
is the next separate check; ordinary GUI file-input installation and real study
workspace-copy persistence remain distinct from this maintenance-store receipt.

Actual full-Planner visual/behavioral checks at source `90e69d2` pass eight cases:
Chrome/Edge × 1280/800 × source-save/draft. Each checks the exact 20 prompts and
100 labels/codes, unchanged source hash, Saved only after delayed acknowledgement,
unsaved state without workspace, occupied-slot refusal and no auto-confirmation.
All eight screenshots were reviewed, with zero browser errors. Reader and source
writer acknowledgements were injected, so these are not native IPC or disk-write
receipts. The private `p2-preset-ui-90e69/REPORT.md` and summary retain these limits;
summary SHA-256 is
`9899f71f23622257a5ea3ffa6272db1092c963028d4261abba444c3d13cc0d30`.

## Native readback startup counterevidence

Clean6098972 built successfully, but its actual native readback run exited2 on
the120-second startup deadline without a ready receipt. The preserved
`native-readback-6098972/` contains the driver receipt and stderr. Process
inspection showed the renderer using a pre-existing default EBWebView browser
profile instead of the newly created private profile. This does not establish
that the preset read itself failed.

Pinned local tauri-runtime2.11.3 omits `data_directory` in its
`WebviewAttributes::from(WindowConfig)` conversion. CLI startup now suppresses
automatic creation only for its one fixed window and uses the native builder's
explicit absolute data-directory setter, with visibility and focus both false.
Normal Planner/Runner window startup remains unchanged. Twelve focused adapter
and driver tests pass; a fresh actual process receipt must prove this correction.
No existing WebView process or profile was closed, modified or deleted.
