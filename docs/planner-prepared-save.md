# Prepared final Save

P7 final Save compiles the current design before native effects. The CLI and
GUI use the same owner drafts, contribution acceptance and master compilers.
The new preparation API separates those authorities from the actual file write
and the synchronous publication of saved state. The existing GUI `save()` entry
point remains available and unchanged in its accepted versions.

`workflow.prepareSave({isCurrent, signal, parseDocument, compileDocument,
captureInput, adoptDocument, afterAdoptDocument})` returns a promise for
`{document, isCurrent, dispatch}`. Main injects the existing supported reader,
versioned compiler adapter and `capturePlannerRecipeInputPreparedFeedback`.
`compileDocument(input)` returns a fully validated immutable document with its
recipe, canonical source text and exact source-byte hash. `adoptDocument` is a
synchronous state-only hook, with an optional separate synchronous projection.

For a fresh or edited design, preparation obtains real P5 prepared acceptance
from the contribution registry. The capture helper requires that validated
snapshot to equal the actual current P5 snapshot, including revision and
dependencies. It requires actual accepted content for every other section,
including a recorded P6 exclusion. It never substitutes a fabricated accepted
registry or marks P5 accepted during compilation. Exact P2 contribution version
1 or 2 selects the corresponding master root; unknown versions reject. Full
domain and integrity validation remains with the existing compiler.

The detached capture retains actual acceptance generation, accepted-content and
producer fingerprints, prepared-feedback currentness and the caller lifetime.
Edits, clear/reaccept, owner/dependency changes, cancellation or disposal expire
it. Saved data contains no acceptance or filesystem permission receipts.

An unchanged source uses the supported strict reader on its exact existing
bytes. It neither recompiles nor reaccepts P5. Its original document association
must remain current throughout the new save.

## Native dispatch and publication

`prepared.dispatch({write, publish, isCurrent, signal})` reuses the existing
export controller. It may be called only once. The provided `write(document,
{isCurrent, signal})` owns native file effects and returns the existing exact
save receipt, or null for cancellation. The consequential caller must retain
possibly-written evidence before a native effect and the actual acknowledgement
when it arrives, even if cancellation makes editor adoption impossible.

The receipt must match recipe ID, definition hash, canonical source-byte hash
and byte length. After acknowledgement, one `publish(commit, afterCommit)` call
installs prepared P5 acceptance, invokes state-only document adoption, and records
the workflow's unchanged-source association. Only then do acceptance and document
projections run. The session advances its revision before state changes and
retains projection failures separately. A partially throwing state hook is not
rolled back; the saved file and applied revision remain visible in evidence.

Before publication, both the capture and the command must remain current. After
successful publication, validity follows the owning command lifetime and exact
new document association; it does not incorrectly reuse P5's precommit guard.
External edits or cancellation continue to invalidate remaining work.

If a write finishes after an edit, cancellation or disposal, the exporter retains
`saved-older-revision` and its exact receipt, without accepting P5 or adopting
that document into the current editor. Dispatch returns only compact
`{status, receipt}` metadata. The actual basename remains with the native effect
or caller result; complete master source is not repeated in the bounded retry
cache. Exact command retries are reconciled by the existing authoring session.

The app must permit its own command's synchronous publication in `canOperate`
and must not report that publication as an independent researcher edit. The
state-only adoption must make the new document visible before acceptance
projection, so current saved-source association can prevent self-invalidation.

## Evidence and remaining integration

Focused tests use the real command session, contribution registry, v1/v2 master
compilers/readers and a synthetic writer. They exercise fresh typed/legacy
capture, unchanged reexport, mandatory owner acceptance, compilation and write
interruption, exact acknowledgement, partial state failure, projection failure,
feedback substitution, generation invalidation and retained exact retries.

These are coordination and contract tests. Main owns actual native write/effect
binding, app adapters, production CLI registration and the timestamped master
artifact. The full CLI-authored mock and actual Runner/XDF acceptance remain
open until observed against the final production artifacts.
