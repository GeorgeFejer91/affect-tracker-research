# Planner consequential owner protocol

This implements the CLI-SHARED coordinator seam for the frozen public vocabulary
in [planner-cli-consequential-commands-v1.md](planner-cli-consequential-commands-v1.md).
It does not itself register production file operations, create filesystem
authority, change a recipe schema, or prove native/Runner execution. Main owns
composition, opaque native grants, service invocation and actual owner adoption.

## Optional owner interface

Existing `read/stage/validate/settings/operations` owners remain valid unchanged.
An owner can additionally register `consequences` and `prepareConsequence`:

```js
{
  consequences: [{
    id: "saveRecipe",
    arguments: { type: "object", additionalProperties: false,
      required: ["directory"], properties: { directory: { type: "string" } } }
  }],
  async prepareConsequence(operation, args, { isCurrent, signal, read, request }) {
    // Validate with existing domain primitives and prepare a detached candidate.
    // Only read-only preparation: no write/import/selection, editor mutation,
    // manufactured confirmation or native side effect.
    return {
      isCurrent() { return true; }, // bind actual owner/dependency generations
      async dispatch({ isCurrent, signal, recordEffect, publish }) {
        // Recheck currentness before every native operation. Immediately before
        // a native write/import/selection, retain a compact possiblyChanged
        // receipt, then replace it with the exact native acknowledgement.
        // The native broker independently retains its own effect evidence.
        recordEffect({ state: "possiblyChanged" });
        // ... await existing native owner operation and record its actual ack
        publish(
          () => { /* synchronous state-only adoption; may be empty */ },
          () => { /* optional synchronous projection/notifications */ }
        );
        return { /* compact operation result, never a full source or recipe */ };
      }
    };
  }
}
```

This is a protocol sketch, not a filesystem implementation. Preparation's
`read("P7")` returns detached owner readback; `read()` returns a detached whole
session snapshot. Preparation may call native read-only helpers. Guards are
read-only and must bind actual owner/dependency lifetimes.
`request` is a detached frozen `{sessionId,requestId,expectedRevision}` projection
from the validated command. Native adapters use it to bind the exact active
broker request; it is not an ambient current-request variable or a grant by
itself. The native broker still owns the original external fingerprint and
purpose-bound file authority.

Names are globally unique, unqualified IDs from a closed registered list; the
owner ID is separate metadata. Every argument key is required, with
`additionalProperties:false`. The coordinator checks the exact key set; the
owner checks types, bounds and preconditions during preparation. The public
catalogue adds a separate `consequences` array only when registered. Internal
owner operations, including opaque-grant descriptors with the same name, remain
in `operations`; they are not public path-based commands.

## Adoption and effects

`publish` runs inside `dispatch`, after its necessary native/read-only
preparation. It checks global and owner guards, locks publication, calls
`onBeforeCommit`, then advances revision once and synchronously adopts state.
`isCurrent` follows that new revision after adoption. Neither install nor
projection may return asynchronous work or perform native effects. Pure source
imports/confirmations may omit `recordEffect`; every successful dispatch must
still publish once. An acknowledged native-only command may publish an empty
state install. The session cannot undo an owner that violates these rules.

Each `recordEffect` accepts a nonempty JSON object of at most 64 KiB in canonical
UTF-8. Returned results have the same 64 KiB bound, with undefined normalized to
null. Values are detached before retention. An oversized or invalid
acknowledgement cannot erase a previous possiblyChanged receipt. If a command
has several native effects, its compact receipt must carry their combined
outcome rather than discarding earlier effects.

Effect recording remains open while the operation settles after cancellation
or destruction, so a late acknowledgement can be returned truthfully; it closes
after settlement and grants no permission for additional work. Destroyed
sessions do not revive their retry cache. Native receipts independently survive
renderer/transport lifetime. Commands that have timed out need native broker
reconciliation, not an assumption that an absent JavaScript result means no write.

The result's `result` is exactly
`{operation,owner,published,effect,result,updatedOwners}`. Failure before any
recorded effect/adoption is rejected or canceled. Failure, cancellation or stale
state after an effect or adoption is incomplete, preserving receipts and the
actual revision. Dispatch ending without publication is an incomplete protocol
failure even when no effect is recorded. Observer, projection and validation
issues cannot erase adoption. Identical completed retries return the retained
result without redispatch; changed content with the same ID rejects, including
while the original request is in flight. Unknown outcomes require reconciliation.

## Concurrency and limits

Preparation permits queries of current drafts. During dispatch, `get`,
`snapshot` and `validate` report busy, as does programmatic `snapshot()`.
Catalogue and cancellation remain available except during synchronous publication.
Other mutations cannot overlap. This shares the existing atomic-operation lock,
CAS, lifetime guards and 1,024-entry/8 MiB retained retry budget. Admission reserves
512 KiB for a bounded result before preparation, including both compact receipts
and at most 64 bounded issues. No previous retry record is evicted to admit work.
Consequential operations cannot be inserted into atomic `apply` batches.

## Verification scope

`test/research-planner-authoring-consequences.test.js` exercises the production
coordinator with owner doubles: exact arguments and catalogue namespaces,
read-only preparation, dispatch/read exclusion, CAS and six interruption modes,
late effects, post-publication cancellation, one-use adoption, callback failures,
detached retry results, bounded result/retry admission, and reentrant lock safety.
These checks are not native storage, actual media, UI or complete mock evidence.
The all-owner regression suite also covers the existing P1 rejection code and
unchanged atomic field operations. Main must collect this seam with actual
operations and test the complete production stdin-to-native-to-editor-to-file
path before any end-to-end completion claim.
