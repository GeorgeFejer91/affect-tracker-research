# P3 prepared content restoration

Backend Verification follow-up for P3-08 and its P3-03 dependency seam.

`await editor.prepareRestoreContent(contribution, {savedWorkspaceContribution,
dependencies, isCurrent})` returns `{isCurrent, commit, afterCommit}`.
Pass the actual current P1 snapshot as `dependencies.P1` after P1 publication;
the saved workspace contribution supplies identity validation only. Main's
command guard must track the current command and external dependency lifetime.

Preparation clones saved inputs before awaiting, validates their catalogue and
variant hashes, projects the draft and colors, and reads the real owner revision
and supplied current P1 identity. It does not reserve a revision, change state,
render, notify, write files or accept the contribution. Competing preparations
can coexist until one commits. Its pure guard rejects owner edits, reset,
teardown, catalogue/restoration changes, changed supplied P1 identity, or a
false command guard. Validation and ordinary conversion finish before commit.

`commit()` is synchronous, state-only and single-use. It rechecks the guard,
installs the prepared table/library identities, advances the owner lifetime,
and clears acceptance. Saved media metadata never establishes current media
readiness: the snapshot remains pending with the actual P1 revision. Exact
media rebinding and explicit confirmation are still required.

`afterCommit()` is synchronous and once-only. It renders, notifies and reports
the reopened draft; it rejects before commit and does not project over a newer
edit/reset or destroyed editor. Main invokes it after session publication.
The legacy GUI `restoreContent` reuses preparation/commit/projection but retains
its initial `beginRestore()` reservation so a new GUI Open immediately fences
an older save, download or restore. The public prepared API makes no such
reservation. Existing command draft staging is unchanged.

Evidence: the pre-edit focused baseline passed 41 tests; the completed focused
editor/P3 authoring gate passes 49 tests. New checks cover detached saved input,
read-only preparation, synchronous state/projection separation, exact saved
contribution roundtrip after media rebinding, competing preparations and stale
edit/reset/destroy/dependency/cancellation rejection. Existing GUI reopen races,
legacy reader and command correspondence tests remain passing.

Main owns application registration and the complete native CLI openRecipe
sequence. This owner checkpoint does not claim native Open, rendered browser
qualification, Runner playback, participant allocation or XDF execution.
