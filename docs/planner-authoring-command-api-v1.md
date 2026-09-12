# Planner authoring command adapter v1

This is the shared integration interface for the explicitly allocated local CLI
pass. It does not change a saved recipe schema, scientific hashes, media grants,
Runner behavior, or the authority of each existing Planner editor.

## Lifetime and transport

The production CLI owns one hidden native Planner and uses bounded stdin/stdout
JSONL. It does not attach to an arbitrary open window or start a listener.
The existing JavaScript editors retain their sole drafts. The shared session
holds only identity, authored revision, operation/cancellation and retry metadata.
Rust retains file selection, media verification and strict final-file authority.

`affect-planner-cli jsonl` is the only enabled ingress. The window is configured
hidden and unfocused before creation, retaining the normal nonzero geometry and
native parent handle. Each invocation uses a new isolated temporary WebView/app
profile and begins with no selected workspace. No ordinary GUI or Runner process
is attached or controlled. Temporary profiles currently remain on disk after
exit; no user workspace or recipe is deleted during shutdown.

The native broker admits at most four queued/in-flight commands and four output
frames, each limited to 16 MiB including line framing. Startup and in-flight
commands have 120-second deadlines; idle sessions have a 300-second deadline.
EOF drains queued work and flushed replies before exit 0. Framing overflow,
unconsumed output, I/O failure or a deadline closes only this owned process with
exit 2 and a fixed diagnostic code. A startup failure emits a fixed JSON error.
After a nonzero exit, no assumption about an unacknowledged edit is permitted.

## Owner interface (frozen for this pass)

Each owner supplies an object to `createPlannerAuthoringSession`:

```js
{
  id: "P7",
  settings: [
    { id: "P7.participantCount", type: "integer", classification: "authored",
      writable: true, minimum: 1, maximum: 100000, label: "Participant count" }
  ],
  operations: [],
  read() { return { values: { "P7.participantCount": 42 }, issues: [] }; },
  async stage(edits, { isCurrent, signal }) {
    // Validate detached candidates with the existing owner primitives.
    // NO mutation, native side effect, publication or manufactured acceptance.
    return {
      isCurrent() { return true; }, // bind actual owner/dependency revisions
      commit() { /* synchronous, prevalidated, nonthrowing owner state install */ },
      afterCommit() { /* optional synchronous notifications/render, after ALL commits */ }
    };
  },
  validate() { return []; }
}
```

Setting IDs are namespaced stable product identities, never DOM selectors or
unrestricted JSON pointers. Types are `boolean`, `integer`, `number`, `string`,
or explicitly described `json`. Classifications are `authored`, `derived`,
`compatibility` and `transient`. Derived entries are read-only. `read` includes
incomplete drafts honestly; invalid numeric text is represented as a string
with an issue, never NaN, a fabricated default or a last-valid value.

Edits are either `{kind:"set", field, value}` or
`{kind:"operation", owner, operation, arguments}`. Operation names and argument
schemas are closed owner-registered lists; list edits use stable resource IDs.
Owners must stage the entire ordered edit list against a detached candidate.
`commit` has no await, native work or validation that can newly fail. A staged
`isCurrent()` is required where owner/dependency state can drift; it is a pure
read-only predicate. The session checks every staged guard and global revision/
cancellation before committing any owner. `dependenciesChanged()` invalidates
the shared operation generation without inventing an authored edit.
Incomplete but syntactically valid drafts may be committed; validation issues
block confirmation/export. Unsupported operations reject, not silently no-op.
Optional staged `afterCommit()` holds existing owner notifications and render
work; it runs safely after every candidate's state installation. Exceptions here
are reported as post-publication issues, never as rejected-with-no-change. Both
commit phases are synchronous; no native side effect belongs in either phase.

Native imports, media preparation, confirmation and final file writes are
separate consequential commands, not members of an atomic field-edit batch.
Their adapters use the same current-operation guard and return exact
side-effect receipts; cancellation cannot undo an already written file. The
optional owner interface and result/lifetime rules are specified in
[`planner-authoring-consequences.md`](planner-authoring-consequences.md).

## Wire envelope

```json
{
  "schema": "affect-research-planner-command",
  "version": 1,
  "sessionId": "UUID from the ready receipt",
  "requestId": "caller-generated UUID",
  "expectedRevision": 0,
  "action": { "kind": "set", "field": "P7.participantCount", "value": 42 }
}
```

Queries use `expectedRevision:null`. First-slice actions are `catalogue`,
`snapshot`, `get` (`field`), `validate` (`owner` or null), `set`, `apply`
(`edits`), `perform` (`operation`, `arguments`), and `cancel` (`requestId` of the
operation to cancel).
Mutation revisions are required. JSON objects have exact keys; duplicate keys,
prototype-sensitive keys, invalid UTF-8/JSON, trailing input, nonfinite values,
oversized input and unknown actions fail closed.

The result envelope contains schema/version, sessionId, requestId, status,
revision, result and issues. Successful queries are `ok`; writes are `applied`
or `incomplete`. Rejection/cancellation does not mean an earlier native side
effect was rolled back. Unknown timeout outcomes must be reconciled using the
same request ID, not blindly retried with a new identity.

Authored revision advances for every committed semantic edit and every GUI
authoring intent, including invalid edits and edit/revert. Navigation and
inspection do not change authored revision. The session enters a publication
lock (reentrant command/readback and Save must report busy), then calls
`onBeforeCommit` to invalidate the existing file workflow without duplicating
the session revision. It advances revision and publishes all candidates without
awaiting. `onCommit` refreshes projections after publication; observer/validation
failures cannot turn an already applied edit into a rejected-as-no-change result.
Observers are notified only after the complete batch. Save's `canOperate` must
include `!session.publishing`.

Retry identity is `(sessionId,requestId,canonical request fingerprint)`.
Identical completed mutations return the original result. Changed reuse rejects.
Entries are retained for the process generation: capacity exhaustion rejects new
mutations, never evicts an old ID and reapplies it. Session destruction aborts
pending preparation, wakes observers and prevents any later commit.
Retained mutation metadata is capped at 1,024 entries / 8 MiB. Admission accounts
for the escaped request fingerprint plus a 512 KiB result reservation. Results
retain at most 64 bounded issues; no raw exception or arbitrary owner object is
stored in an issue. Queries do not consume retained mutation identities.

## Ownership and verification

Shared integration owns this contract, `planner-authoring-*` session/transport
modules, app/bootstrap installation, native stdin broker/CLI and registration.
P1–P6 owners supply new owner-local adapter modules and minimal existing-owner
method seams; they do not edit the shared gateway or composition root. P7's
policy adapter is the first slice. P7's separately allocated file owner supplies
timestamp naming and strict no-clobber versioned file service.

Every registered setting needs read/set/readback coverage and classification.
Each owner tests invalid/stale staging, dependency drift and unchanged scientific
meaning. Integration proves real same-session native/JS readback, lifecycle,
framing and no ordinary-startup ingress, followed by complete saved-recipe and
fresh-media mock workflows. A parser-only test is not native CLI evidence.
