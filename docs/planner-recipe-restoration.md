# Prepared recipe reopening

P7-03/P7-04/P7-07 and CLI `openRecipe` use the same validated saved content.
This module coordinates restoration; owner editors remain the only mutable
drafts, the supported reader validates complete content, and native services
own file access. Opening does not restore media permission or acceptance.

`preparePlannerRecipeReopenV1(sourceText, {isCurrent})` retains its strict v1
reader and existing sequential `apply(owners)` behavior. That legacy asynchronous
API is not an atomic publication hook.

`preparePlannerRecipeReopen(sourceText, {isCurrent, parseDocument})` requires an
explicit supported document reader. Main injects `parseSupportedPlannerRecipe`
from `planner-recipe.js`; the reader receives UTF-8 bytes and returns the fully
validated immutable `{recipe, canonicalSourceText, canonicalSourceByteSha256}`.
No alternate parser is attempted after rejection. Preparation performs no owner
mutation and exposes `{document, isCurrent, apply, applyViaPublication}`. A
prepared plan can be applied only once, across both application methods.

## Publication contract

`await prepared.applyViaPublication(owners, {publishStep, isCurrent})` uses the
authoring session's existing `openRecipe` sequence protocol. Its ten steps are:

1. `begin`
2. `P1`
3. `P2`
4. `P5`
5. `P3`
6. `P4`
7. `P6`
8. `policy`
9. `presentationTarget`
10. `adoptDocument`

`owners.begin()` and `owners.adoptDocument(document)` are synchronous state-only
hooks. `afterBegin()` and `afterAdoptDocument()` are optional synchronous
projections. Every other owner is an asynchronous preparation function accepting
its detached saved contribution and `{workspace, feedback, presentationTarget,
isCurrent}`. The latter values are saved context, not fabricated current ready
snapshots. P3/P4 preparation reads actual dependencies after P1/P5 publication.

Each owner returns `{isCurrent?, commit, afterCommit?}`. Preparation must not
change state. `commit()` installs only prepared state synchronously;
`afterCommit()` optionally refreshes projections. All conversion, hashing and
validation that can fail ordinarily should finish before commit. Async functions
and returned promises cannot masquerade as a completed synchronous boundary.
The owner-only guard applies before commit; the command/edit lifetime applies
throughout, including after a commit invalidates its old candidate guard.

The publication adapter must invoke each supplied commit exactly once, advance
the session revision before mutation, and record attempted/completed steps. The
production session retains projection failures without erasing completed state.
`PlannerRecipeRestoreError` carries `attempted` and `completed` arrays; no partial
restore is rolled back over newer edits. Source adoption occurs only after every
owner succeeds. Native source-read receipts and final compact `finish(...)`
belong to the consequential caller, not this restoration helper.

## File workflow composition

`workflow.prepareOpen(sourceText, {isCurrent, parseDocument, prepareOwners})`
prepares the same plan and returns `{document, isCurrent, applyViaPublication}`.
`prepareOwners` supplies all hooks above, including a separate state-only
`adoptDocument`; the existing GUI constructor callback may include rendering and
must not be passed off as state-only.

At `begin`, the workflow revokes its previous unchanged-source eligibility,
invalidates export with notification deferred, and clears acceptance using
`registry.clearAcceptance({notify:false})`. Its projection then calls
`registry.notifyAcceptanceChange()` and the owner's projection. At final
adoption, it records unchanged-source eligibility only after the owner's state
hook succeeds. A changed, superseded or disposed preparation cannot adopt. The
opening flag always clears on settlement; native writes are never invoked.

Main must bind `canOperate` and the command guard to the actual mode/disposal/edit
lifetime while allowing the exact owning Open's publication. A blanket
`!session.publishing` check would incorrectly reject its own synchronous commit.
Likewise, Main's `onBeforeCommit` must not classify this Open's own boundary as an
independent researcher edit. External edits and cancellation must still fence
remaining work. Owner notification callbacks belong in projection hooks.

## Evidence and limits

The focused publication tests use the real authoring session, real contribution
registry, strict v1 reader and synthetic owner preparation adapters. They cover
complete ordered publication, detached saved content, exact retries, deferred
validation, cancellation, edits, disposal, competing GUI Open, malformed and
throwing commits, owner drift, projection failure and single-use behavior. Legacy
file save/reopen tests remain unchanged and pass.

These checks validate the coordination contract. Main still owns actual owner
adapters, supported v2 reader injection, native grants/receipts, application
registration, and real CLI export/reopen. They do not establish a production
mock export, native playback, participant execution or XDF correspondence.
