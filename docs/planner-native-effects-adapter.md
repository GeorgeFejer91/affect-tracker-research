# Planner native effects adapter

Main's `createPlannerNativeEffects({invoke,sessionId})` provides the fixed JS
transport for the agreed native broker. It exposes
`execute(context,action,{isCurrent,signal,recordEffect})` and `destroy()`.
Context is the shared coordinator's frozen sessionId/requestId/expectedRevision.
The native broker remains the authority for original-request fingerprints,
one-use grants, cancellation, effect leases, CAS, source bytes and file writes.

The only RPC is `research_planner_authoring_effect({request:{context,action}})`.
Closed actions are selectWorkspace, importVideos, importVideoFolder,
rescanVideoLibrary, readQuestionnaire, storeQuestionnaire, writeRecipe and
readRecipe. Paths cannot replace opaque grant UUIDs. Encoded request size,
including its wrapper and final LF allowance, is bounded to 16 MiB.

The reply is the agreed closed native-result envelope with original public
perform operation, effect, payload, error and superseded. Private action names
map to importQuestionnaire/saveQuestionnaire/saveRecipe/openRecipe as appropriate.
An acknowledgement for another operation cannot be adopted. The adapter records
unknown dispatched outcome before invoking native and the actual compact effect
before checking a late error/cancellation. Only current successful payloads reach
the caller. A lost RPC does not imply that no write occurred; the native ledger
must retain and reconcile its own acknowledgement independently.

Five focused injected-transport tests pass: detached identity, current payload,
late acknowledgement retention, closed actions/grants, predispatch cancellation,
lost-response unknown outcome and mismatched-operation rejection. This adapter
is not yet registered in production app boot or connected to core9 owners;
these tests do not establish actual native writes or a complete CLI run.

`withPlannerCore9(owner, prepare)` separately supplies the exact nine public
consequence descriptors and delegates to the host's actual preparation functions.
P1 owns four workspace/media operations, P2 owns import/save, and P7 owns confirm,
final Save and Open. Only Open opts into sequence publication. P5 confirmation
rejects with `final_capture`; valid independent confirmations are P1/P2/P3/P4/P6.
The wrapper preserves the existing owner methods/settings and adds no state.
Two metadata/delegation tests pass. It is intentionally not installed into the
app until its preparation handlers are connected; advertised metadata alone is
not evidence that native operations work.
