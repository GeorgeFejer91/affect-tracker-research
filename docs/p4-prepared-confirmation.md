# P4 prepared confirmation

CLI-P4 confirmation seam from clean Main `2fe9da8`. Main owns app registration;
S7 owns optional registry `preparedOwner` composition. No registry acceptance
is created by this owner helper. Existing GUI `prepareContribution` is unchanged.

```js
const candidate = await editor.prepareConfirmation({isCurrent, signal});
// candidate.snapshot is a detached getter, also readable after commit.
// candidate.isCurrent(), candidate.commit(), candidate.afterCommit()
```

The future snapshot has exactly the existing `getSnapshot()` five keys:

```js
{revision, enabled: true, pending: false, contribution, dependencyRevisions}
```

`contribution` is the complete profile produced by the existing draft compiler
and full workspace/feedback validator. `dependencyRevisions` are actual current
P1/P5 revisions. The future revision increments only when the validated content
differs from the currently prepared contribution, matching GUI preparation.
The getter returns a fresh detached copy every time and retains the same future
snapshot after successful commit. It is a candidate, never a live readiness claim.

Preparation does not change draft, revision, operation generation, contribution,
projection, observer caches, notifications or DOM. Missing or invalid live
dependencies fail normally; saved content cannot substitute for current media.
The guard binds caller/AbortSignal, lifetime, binding instance, owner revision,
operation generation and nonobserving dependency identity. Both `isCurrent` and
commit recheck those inputs. Intervening GUI preparation, edits, reset, teardown,
dependency drift or another successful candidate commit fence this candidate.

`commit()` is synchronous and single-use. It installs only the validated
contribution and future revision, advancing the private operation generation
to fence competing work. It does not notify, render, compile or accept a registry
entry. Repeated commit throws. `afterCommit()` notifies/renders once, even when
notification throws; errors propagate without undoing installed state. Calls
before commit or after disposal throw. Repeated projection does nothing.

Main/S7 must preflight the candidate, commit it, compare the actual owner
snapshot with its future snapshot, then install registry acceptance through
the existing publication boundary. Owner notification and DOM work belong in
the projection phase. The registry remains responsible for dependency epochs,
acceptance identity and retaining partial failures.

All 70 focused P4 tests and `git diff --check` pass. Focused real-editor tests use existing P1/P5 synthetic fixtures and minimal DOM
doubles. They prove no early mutation, future/live/GUI parity, stable detached
getter, unchanged revision behavior, stale/abort/dependency guards, competing
candidates, missing readiness, single-use and projection failure retention.
No production CLI confirmation, native media or rendered runtime claim follows.
