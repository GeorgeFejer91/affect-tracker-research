# P4 prepared content restoration

Allocated CLI-P4 / P7 Open seam, based on Main `928b395`. Main registers this
owner in the ten-step protocol from `docs/planner-recipe-restoration.md` at root
`7260976`; this change does not register application or native commands.

```js
const prepared = await editor.prepareRestoreContent(value, {
  savedWorkspaceContribution, savedFeedbackContribution, isCurrent,
});
// { isCurrent(), commit(), afterCommit() }
```

P4 runs after P1 and P5 publication. Saved context validates the complete profile
through the existing state-owner validator; actual current dependencies resolve
the live projection. Saved inputs never manufacture current media readiness.
Preparation clones inputs, converts all saved fields with the existing converter
and resolves geometry without observing dependency-cache changes. It neither
advances the editor revision nor changes controls, acceptance or notifications.

The candidate binds draft revision, operation generation, editor lifetime,
dependency identity, dependency binding instance and caller guard. `isCurrent`
is read-only. `commit` rechecks the guard and synchronously installs the prepared
draft/projection, advances P4 once and clears its contribution. It returns no
promise and invokes no observer or DOM work. Repeated or stale commits throw.
Concurrent preparations can coexist; the first successful commit fences others.

`afterCommit` is synchronous and at most once, notifying the owner then syncing
controls/rendering. An observer failure still permits controls to reflect the
committed state, then propagates; a rendering failure also propagates without
undoing state. Calls before commit throw. Disposal/cancellation or intervening
edits fence publication; newer state is never rolled back. Main must retain
partial completion and projection errors using the sequence coordinator.

Existing `restoreContent` awaits this same preparation, calls commit then
afterCommit, and returns the current snapshot. Existing accepting
`restoreContribution` and historical draft restoration remain unchanged.

All 65 focused P4 tests pass; `git diff --check` passes. Tests cover real editor/state/validator with minimal DOM doubles and
synthetic saved P1/P5 fixtures: read-only preparation, detached content, complete
draft parity, delayed projection, explicit no acceptance, missing live media,
invalid input, edits/reset/disposal/cancellation/dependency drift, competing
preparations, and observer/DOM failure retention. These are component checks,
not actual CLI Open, browser layout, native persistence or Runner evidence.
