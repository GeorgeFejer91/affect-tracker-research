# Planner CLI native selection grants

Allocated CLI-SHARED helper for the frozen consequential-command catalogue.
`src-tauri/src/research_planner_cli_io.rs` contains native path admission,
purpose-bound one-use grants and bounded questionnaire source reads. Main owns
module registration, the broker/wire, Tauri wrappers and composition with the
existing Workspace, questionnaire importer and S7 services. This module adds
no file writes, editor mutations, compiler, media identity or decoding authority.

## Native API

All entries are `pub(crate)`:

```rust
PlannerCliIoGrants::new(session_id: Uuid) -> Self
issue(&mut self, binding: CliIoRequestBinding, selection: CliIoSelection)
    -> ResearchResult<CliIoGrantReceipt>
claim(&mut self, binding: &CliIoRequestBinding, grant_id: Uuid,
      purpose: CliIoPurpose) -> ResearchResult<CliIoTarget>
claim_questionnaire_source(&mut self, binding: &CliIoRequestBinding,
                           grant_id: Uuid) -> ResearchResult<CliQuestionnaireSource>
revoke_request(&mut self, request_id: Uuid) -> bool
close(&mut self)
```

`CliIoRequestBinding` contains `session_id: Uuid`, `request_id: Uuid` and
`request_sha256: [u8; 32]`. The native broker computes the hash from the **full
canonical external request**, including its revision, operation and all
arguments. For questionnaire import this includes `familyId` and `language`.
A renderer-provided hash is not authoritative. Nil session/request IDs reject.
The helper additionally fingerprints the purpose and ordered exact input paths.

| Selection / purpose | Native input | Claimed native target |
| --- | --- | --- |
| `SelectWorkspace` | `directory: String` | `directory: PathBuf` |
| `ImportVideos` | `paths: Vec<String>` | ordered `paths: Vec<PathBuf>` |
| `ImportVideoFolder` | `directory: String` | `directory: PathBuf` |
| `ImportQuestionnaire` | `path: String` | bounded source receipt only |
| `SaveRecipe` | `directory: String` | `directory: PathBuf` |
| `OpenRecipe` | `path: String` | `path: PathBuf` |

Path-bearing input/target types implement neither `Serialize` nor `Debug`.
`CliIoGrantReceipt` serializes only `{grantId, purpose}`. Questionnaire source
serializes exactly `{grantId, logicalName, format, byteLength, sha256, bytesHex}`.
The format is `csv`, `txt` or `json`; SHA-256 and byte hex are lowercase.
The logical name is the basename, never a directory path. Hex preserves every
byte, including BOM, invalid UTF-8 and NUL, without compiling or normalizing.
Decode hex into bytes before handing them to the existing production importer.
The source receipt is renderer-safe in the sense of bounded source data; it
contains the researcher's source content and must not be logged by default.

## Broker lifecycle and integration responsibilities

1. Keep one store per native session behind the broker's synchronization. Admit
   only the matching active consequential request after operation, revision,
   cancellation and role checks. Validate the complete action against the frozen
   catalogue before constructing its selection and binding.
2. Call `issue` once, then dispatch only the opaque receipt to the renderer. An
   identical issue returns the retained original grant or admission error without
   reopening, rereading or revalidating paths. Any changed full request or input
   selection with the same request ID rejects as `request_id_reused`.
3. The matching native wrapper rechecks active request, revision, operation,
   lifetime and purpose, then calls the appropriate claim. The helper checks
   session, request, full fingerprint, grant ID and purpose before consuming.
   A mismatch does not consume a legitimate grant. A matching claim consumes
   **before** filesystem revalidation or reading, so even a failed claim cannot
   be replayed after repairing/replacing the file.
4. Dispatch the native target to the existing service, which owns its own path,
   content, import or no-clobber write policy. A claim authorizes a selected path;
   it does not prove a video's identity, decode status or unchanged bytes. For
   questionnaires, bytes and hash describe the one snapshot read at claim time,
   not at issue time. Source format is declared by extension; validity belongs
   to the existing importer.
5. The broker retains native outcomes and completed external-effect receipts.
   Completed retries return those exact outcomes instead of calling claim again.
   Recheck cancellation/revision before adopting an effect into editor state.
   A completed write survives late cancellation and is not described as rollback.
6. Revoke an issued request on cancellation and close the store on session end.
   `revoke_request` returns false for an unknown request: cancellation **before**
   issue remains the broker's admission gate. Revocation retains the original
   issue identity but disallows claims. Closing clears paths and records and
   permanently rejects future use of that store.

The helper does not itself enforce the broker's one-active-request rule, CAS,
questionnaire slot state or atomic editor adoption. Returning a native target
does not stop a caller from misusing/cloning it; trusted native wrappers must
dispatch it exactly once. No generic renderer filesystem command is introduced.

## Bounds and failure behavior

| Resource | Limit |
| --- | --- |
| Retained request identities per session | 256, including failures/consumed/revoked grants |
| Video paths per selection | 1–256; other purposes require exactly one path by type |
| Each external path | 1–4096 UTF-8 bytes, no control characters |
| Aggregate retained path payload charge | 1 MiB; conservative charge of twice each canonical `OsStr` encoded byte length |
| Questionnaire file | 1 byte–4 MiB, checked on issue and claim |
| Questionnaire logical basename | 1–1024 UTF-8 bytes, no controls |
| Questionnaire public source encoding | at most 8 MiB hex plus bounded metadata; below the 16 MiB wire frame |

Record/vector overhead is additionally bounded by the fixed request/path
counts. Claim/revocation releases retained path payload, but request records
remain. A full record store rejects new IDs with `session_capacity`; it never
evicts an old identity. Path-budget admission failures occupy a record and retain
the original failure even after capacity becomes available. A full record-store
failure does not allocate another record, and capacity stays full until close.

Other stable helper errors are `session_closed`, `stale_session`,
`request_id_reused`, `unknown_grant`, `grant_mismatch`, `grant_consumed`,
`grant_revoked`, `invalid_selection`, `unsupported_source`, `source_changed`
and existing `research_io`. Error messages never include the selected path or
unfiltered OS error text. Claim failures must be retained by the broker; the
helper retains the admission result and consumed state, not a duplicate source
snapshot or downstream effect result.

## Filesystem boundary and current limitation

On Windows, external selections must use ordinary absolute local drive paths.
Drive/root-relative, UNC/network, verbatim/device prefixes, dot/parent segments,
alternate streams, wildcard characters, trailing dot/space components and DOS
device aliases reject. Canonical paths remain native and are checked again.
Every selected path and ancestor must be unlinked and have the required regular
file/directory type. Duplicate canonical path spellings reject; this is not a
hard-link/media identity deduplication service.

Questionnaire reads use safe standard-library Windows options to open the final
object without following a reparse replacement and allow only read sharing.
An existing writer blocks that read. The opened handle must be an ordinary
bounded file; a capped read checks length and modification metadata and then
rechecks the path/ancestors. No `unsafe` or additional dependency is introduced.

**Directory namespace race limitation:** these ancestor checks match the
existing S7 service boundary; they do not hold handles to every ancestor and
cannot prove resistance to adversarial concurrent directory rename/replacement
between filesystem calls. A regular same-type replacement between issue and
claim is a current-path selection, not an immutable file identity. Subsequent
Workspace/S7 operations must revalidate under their existing policies. Do not
claim handle-pinned traversal, immutable media selection or native end-to-end
qualification from this helper.

## Focused validation

`src-tauri/tests/planner_cli_io.rs` compiles the exact module and existing
`research_error.rs` before Main registers the module in `lib.rs`; it contains
no alternate filesystem or error implementation. Its module tests cover all
purposes, exact public fields/bytes/hash, identity/purpose mismatches, retained
errors, one-use claims, cancellation/close, both capacity bounds, path/count/type
limits, questionnaire bounds, Windows aliases, actual junctions, ancestor/type
replacement and existing-writer rejection.

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --locked --no-default-features --test planner_cli_io
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --no-default-features --test planner_cli_io -- -D warnings -A dead_code
```

This is native helper evidence. Broker dispatch, actual imports/saves, renderer
adoption and installed application verification remain with Main integration.

On Windows, 17/17 focused tests passed (15 helper tests and two existing error
tests). Scoped Clippy passed with warnings denied and `dead_code` allowed for
existing unused APIs in the standalone harness/no-default-feature library.
Rustfmt and whitespace checks passed. No platform beyond Windows is qualified
by these results.

The unchanged `research_planner_recipe_file::tests` baseline also passed 10/10
with `--locked --no-default-features --lib`. Logs and exact source hashes are
retained in `D:/GitHub/.affect-preview-checks/cli-native-io-20260912/`.
