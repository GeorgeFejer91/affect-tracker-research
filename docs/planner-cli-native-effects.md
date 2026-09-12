# Native Planner CLI effect handoff

S7 allocation, Backend Verification, base `23e8f3a`. Main owns production
registration and broker integration. The new module is internal and has no
Serde input or public command registration.

`execute_native_effect(&WorkspaceService, NativeEffect, check_current)` consumes
an owned, non-Clone effect. The guard returns `ResearchResult<()>`. Call this
helper on Main's blocking execution lane, without holding the broker mutex.
The guard must release its own lock before returning. Main must serialize
effects, authorize paths and bytes, consume grants and retain retry outcomes.

| Effect | Fields | Existing service |
| --- | --- | --- |
| `SelectWorkspace` | `path: PathBuf` | `WorkspaceService::select` |
| `ImportVideos` | `workspace_id: String`, `paths: Vec<PathBuf>` | `import_paths` |
| `ImportVideoFolder` | `workspace_id: String`, `path: PathBuf` | `import_paths` |
| `RescanVideoLibrary` | `workspace_id: String` | `rescan_planner_videos` |
| `StoreQuestionnaire` | `workspace_id`, `family_id`, `language_tag`, `format`, `source_sha256`: String; `bytes: Vec<u8>` | `store_questionnaire_asset` |
| `WriteRecipe` | `directory: PathBuf`, `source_text: String` | `write_new_planner_recipe` |

Receipt variants `Workspace`, `VideoLibrary`, `Questionnaire`, and `Recipe`
contain the actual `WorkspaceStatus`, `RescanResult`, `QuestionnaireAssetReceipt`,
and `SavedPlannerRecipeFile`. Main projects compact public receipts separately.
The helper does not invent a decode attestation, normalize questionnaire source,
compile a recipe, grant filesystem access, or adopt authoring state.

`NativeEffectOutcome` has independent `result` and `superseded` fields:

- Early guard failure returns `EffectNotInvoked` with the original error and no
  service call. `superseded` is absent because this is an entry rejection.
- After entry, native success or failure remains in `result`; a failed second
  guard is returned separately in `superseded`, preventing current-state adoption.
- Workspace/import/source failures conservatively use `MayHaveChangedWorkspace`.
  They do not promise that an owner rolled back directories, imported files or
  workspace state before returning an error.
- Recipe writer errors retain `NoRecipePublished` or
  `RecipePublishedUnverified { basename }` from its typed publication result.
  The original `CommandError` is preserved. A completed file cannot be undone
  by cancellation; neither late failure nor a lost acknowledgement permits a
  blind retry.

The existing writer remains the authority for strict recipe validation,
timestamp naming, exclusive publication and final byte readback. This helper
adds no schema, compiler, unsafe code, dependency or source-derived algorithm.

The integration harness imports actual owner modules so S7 can test the helper
without changing Main's `lib.rs`. Inline helper tests also become available
through ordinary library tests after Main registers the module. Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --locked --no-default-features --test planner_cli_native_effects research_planner_cli_effects
```

Tests use temporary directories, synthetic unverified media/source bytes and
the existing canonical recipe fixture. They establish filesystem and outcome
semantics only; production stdin transport, real media decode, UI parity,
instrument-source authorization and Runner execution remain independent gates.

Validation: eight focused helper tests pass on Windows with locked dependencies
and no default features. Rustfmt and diff checks pass. Planner and Runner asset
builds/boundary checks passed to supply the test crate's embedded assets. Existing
library dead-code warnings and the subset harness's unused native-media exports
remain visible. The first harness attempt failed on module resolution; the
corrected harness passed without production owner changes. The native test log
is `D:/GitHub/.affect-checks/p7-native-effects-test.log`.
