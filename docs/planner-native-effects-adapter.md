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
