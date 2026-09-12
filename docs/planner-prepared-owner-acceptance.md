# Prepared owner confirmation in the registry

S7 named registry allocation from Main `2fe9da8`, Backend Verification. Main
composes the actual P3/P4/P6 owner candidates; this change adds no owner editor,
native call, JSON schema, alternate compiler or automatic confirmation.

```js
const preparedOwner = await owner.prepareConfirmation({ isCurrent, signal });
const acceptance = await registry.prepareAcceptance(segment, {
  selectedTarget, isCurrent, signal, preparedOwner,
});
acceptance.commit();      // synchronous owner state, then registry acceptance
acceptance.afterCommit(); // owner projection, then registry projection
```

`preparedOwner` is optional. Omitting it preserves the existing registry API and
P5 final-save path. When provided, it is a trusted internal object with an own
`snapshot` getter and callable `isCurrent`, `commit`, and `afterCommit` methods.
The getter returns detached, stable content, including after commit. Its exact
shape is the existing raw owner snapshot, with no `segment` field:

```js
{ revision, enabled, pending, contribution, dependencyRevisions }
```

The registry binds that future snapshot and the getter/method references. It
reads the original live owner and uses a private nonobserving substitution to
apply the existing snapshot, revision, dependency/cycle and domain-validator
checks to the future. This preview does not update owner observations, expire
acceptances, install accepted state or notify a renderer. Normal live reads
still expire genuinely stale existing acceptances under the original rules.

An enabled future must be complete. Revision must advance if contribution,
enabled state or dependencies change; a pending-only change may retain revision.
An excluded P6 candidate may retain its exact disabled snapshot. The validator
receives detached actual dependency snapshots and the explicit selected target.

Before commit, registry and candidate guards must remain current: live snapshot,
owner identity/epoch, dependency identity/epoch/content, acceptance generation,
host predicate, abort signal and bound candidate content/callables. Commit then
invokes the owner synchronously and checks the actual live getter against the
entire verified future snapshot. Dependencies and host/abort fences are checked
again before the registry installs acceptance. A Promise-returning commit fails;
owner implementations must never defer publication or launch background work.

Once an owner commit is attempted, a thrown error, substituted snapshot or
partial/wrong install cannot be retried through that candidate. No new registry
acceptance is installed on failure; existing owner mutations are not rolled
back. The coordinator must report an attempted state publication truthfully.
Successful registry commit remains idempotent, preserving the prior API.

After successful commit, projection runs once in owner-then-registry order.
Both projections are attempted even if the owner renderer throws. Single errors
are rethrown; simultaneous errors remain in an `AggregateError`. Acceptance is
retained, and repeated projection does not rerun either callback. Owner projection
methods remain responsible for their own newer-state/disposal safeguards.

Verification: 23 baseline registry tests passed. Final 41 tests cover the existing
registry, eight new prepared-owner cases and ten existing P5 prepared-save cases:

```powershell
node --test test/research-planner-prepared-owner.test.js test/research-planner-contributions.test.js test/research-planner-prepared-save.test.js
```

The focused cases include no early owner/acceptance/projection mutation, exact
future/live equality, dependency/domain rejection, candidate substitution, abort,
stale/replaced owners, failed commits, both projection failures and exclusion.
Diff checks pass. Log: `D:/GitHub/.affect-checks/p7-prepared-owner.log`.
These are registry/coordinator checks with typed test owners; actual editor
composition, native CLI and user mock execution remain Main/root's next gates.
