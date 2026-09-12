# Supported native Planner recipe files

S7 Backend Verification allocation from Main `1fc6cdd`. These are additive
internal APIs; Main/root owns public command routing and registration.

```rust
read_supported_planner_recipe_file(path: &Path)
    -> ResearchResult<LoadedSupportedPlannerRecipe>

write_new_supported_planner_recipe(directory: &Path, source_text: &str)
    -> Result<SavedPlannerRecipeFile, PlannerRecipeWriteError>
```

The reader takes one bounded native byte snapshot and uses
`parse_supported_planner_recipe_bytes`. The writer uses that same strict reader
before staging and for both staging and final readback. Only the registered
supported master versions are accepted. There is no schema repair, conversion,
recompilation, legacy-package dispatch or ambient source/media restoration.

The existing `read_planner_recipe_path`, `write_selected_planner_recipe`, and
`write_new_planner_recipe` retain their prior accepted versions. In particular,
the existing master-v1 path rejects master-v2. Their historical experiment-package
read dispatch is unchanged.

A private document adapter chooses the strict parser; staging, flush/close,
bounded readback, link/reparse checks, timestamp naming, atomic no-clobber
publication, collision limits, cleanup and published-unverified failure handling
remain one shared filesystem implementation. Exact text and the complete native
receipt must match at readback. The receipt remains
`affect-research-planner-recipe-save-receipt` version 1 with the existing six
fields; its version describes the receipt, not the recipe. No absolute path is
added to the compact receipt.

The additive internal effect is:

```rust
NativeEffect::WriteSupportedRecipe { directory: PathBuf, source_text: String }
```

It returns the existing `NativeEffectReceipt::Recipe` and existing failure
classes. `WriteRecipe` retains v1-only behavior. The effect owner still checks
the guard before invocation and after completion; a late stale/cancellation
error stays separate from the actual native receipt. No guard argument is added
to the file writer, and a completed publication is not rolled back or reported
as an uninvoked effect. Main/root must retain outcomes and prevent stale adoption.

The standalone effects test harness adds the already-registered
`research_form_definition`, `research_questionnaire_recipe_v2`,
`research_planner_recipe_v2`, and `research_planner_recipe_supported` modules.
It imports real owners, without production `lib.rs` or command edits.

Focused checks use real temporary directories and existing canonical v1/mixed-v2,
location-v2 and XR-v2 fixtures. They cover exact bytes/hashes, receipt compatibility,
unsupported versions/fields, duplicate keys, malformed/oversized inputs, bad
integrity, collision/clock rollback, linked/locked paths, final readback failure
and early/late effect guards. They do not establish native CLI registration,
real mock export, media readiness, UI parity or Runner/XDF execution.

Validation from this isolated candidate: ten legacy file tests passed before
changes; all 14 file-service and nine effect tests pass after changes. Rustfmt
and diff checks pass. Commands use `--locked --no-default-features`, with
`--lib research_planner_recipe_file` and
`--test planner_cli_native_effects research_planner_cli_effects`, respectively.
D-drive temporary directories were used. Logs are
`D:/GitHub/.affect-checks/p7-supported-{baseline,files,effects}.log`.
The two library-test baseline warnings remain. Production compilation in the
effect harness reports 14 unused-code warnings while dispatch is pending, plus
one existing native-media re-export warning in the subset harness. None were
suppressed. Main's shared Cargo-target hold was released after these checks.

## Native GUI supported-version entrypoints

Main allocated this follow-up at `9843efc` (S7/P7, Backend Verification).
`read_supported_planner_recipe_path` dispatches one bounded byte snapshot to
strict master-v1/master-v2 parsing or the existing legacy-package reader, with
matching `planner-recipe-v1`, `planner-recipe-v2`, or `experiment-package-v1`
tags. A malformed master never falls back to a legacy parser.

`write_selected_supported_planner_recipe` validates supported canonical bytes
and shares the selected-destination staging/publication/readback implementation
with the strict v1 writer. Existing functions retain their original contracts.
The existing `research_load_planner_recipe` and `research_save_planner_recipe`
commands now call the supported helpers; save validates before opening its
dialog and retains Planner-role authorization, cancellation, filename policy,
no-clobber publication and published-unverified error handling. No registration
or `lib.rs` change is needed.

Two additional file-service tests cover tagged dispatch, legacy/v1 parity,
exact v2 documents, unknown schemas/versions, exact selected-save bytes and
receipts, existing destinations and invalid input. Existing Windows linked-path
and locked-file tests also exercise the supported GUI entrypoints.

Validation for this native GUI follow-up: all 16 native file-service tests pass
with `cargo test --locked --no-default-features --lib research_planner_recipe_file`
(the complete library and command module compile). The two pre-existing geometry
dead-code warnings remain. All 22 focused browser file/adapter and modular
architecture tests pass. Rustfmt and `git diff --check` pass. Native log:
`D:/GitHub/.affect-checks/p7-native-gui-files.log`. The shared Cargo target was
released after this finite check. Native picker interaction, installed-app
qualification and Main's integrated app adapters remain integration gates.
