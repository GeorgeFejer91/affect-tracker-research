# P6 prepared selection restoration

Backend Verification for P6-04/P6-05 and the allocated CLI `openRecipe` seam.
Main owns composition into the real recipe workflow; this owner API introduces
no saved fields, acceptance, native calls or XR execution.

`authoring.prepareRestoreSelection(selection, {isCurrent})` synchronously
returns `{isCurrent, commit, afterCommit}` and can also be awaited. The required
request guard must remain true through the owning publication and projection.
Preparation validates and detaches the exact existing included/excluded union.
It neither refreshes dependencies nor changes editor state or projections.
Missing media does not prevent restoration of saved authored content.

The candidate binds authoring lifecycle, complete live dependency identity,
editor revision and file-operation generation. Edits, reset, changed dependencies
(including silently changed payloads), cancellation or disposal fence commit.
`commit()` checks those guards, synchronously installs prepared state, increments
the editor revision once, invalidates pending file reads and returns the snapshot.
A second commit rejects. Included restores every saved profile field as an
enabled pending draft. Excluded clears the previous profile to editor defaults
and disables XR. Both clear domain acceptance and preserve dependency revisions.

`afterCommit()` synchronously updates fields, renders and notifies once, with no
state adoption. It rejects before commit or after intervening edit/disposal.
Projection failure leaves committed state intact; retrying projection does not
repeat notifications. The candidate's precommit `isCurrent()` becomes false
after commit, so composition must use the command lifetime for postcommit checks.

Legacy `authoring.restoreSelection` reuses these steps immediately and returns
the same snapshot shape. Editor `restoreDraft` and `restoreExcluded` also reuse
the editor seam. Existing live validation/acceptance APIs retain their meaning.

Focused Node tests run the real editor/controller with minimal DOM doubles and
check read-only preparation, detached exact settings, both branches, state-only
commit, deferred notification, drift/reset/disposal, single use and projection
failure. Existing authoring, CLI, geometry and full-master reproduction tests
cover compatibility. These are software checks, not rendered-browser, native,
headset or research qualification evidence.
