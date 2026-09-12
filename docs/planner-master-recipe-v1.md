# Planner master recipe v1

P7 owns this successor contract. It is separate from frozen
`affect-research-experiment-package` version 1; no existing reader is widened.
The master carries complete authored experiment content and supports editable
reopening. File validity and content reconstruction do not grant media permission,
attest physical calibration or qualify a Runner implementation.

## Root and owner boundaries

The exact root fields are `schema`, `version`, `recipeId`, `presentationTarget`,
`policy`, `segments`, and `integrity`. Schema is `affect-research-planner-recipe`,
version 1. Recipe ID uses the existing 1–128 lowercase identifier convention.
The target is explicitly `desktop-screen` or `webxr-immersive-vr`.

`segments` has exactly P1, P2, P3, P4, P5, P6, in that canonical lexical order.
Each owner validates its entire payload; P7 never reconstructs fields from DOM,
copies another owner's formulas, or strips newly authored content to fit v1.

| Segment | Complete persisted contribution |
| --- | --- |
| P1 | `affect-research-workspace-contribution` v1 or v2: study, fixed logical workspace layout and complete hash-bound video catalogue, including decoder-oriented geometry. V2 preserves reversible relative-location annotations separately from immutable byte identity. |
| P2 | P2's `affect-research-questionnaire-recipe-contribution` v1: full definitions/modules, full language tree and strict `affect-research-questionnaire-presentation` v1 companion with repetition policy bound to each definition ID/hash. |
| P3 | `affect-research-variant-design` v1 or v2, matched to P1: exact ordered variants, entries, named ISIs, identities, integrity, Runner-assigned selection boundary and planned marker contract. V2 binds each video occurrence to its exact location/content pair. |
| P4 | Accepted `affect-research-desktop-layout-contribution` v1. Each recipe explicitly selects `largest-oriented-area` or `maximum-oriented-dimensions`; neither is a default. Saved source identity/dimensions must reproduce from P1. Internal screen-layout drafts are forbidden. |
| P5 | P5's complete `affect-research-feedback` v2, including saved renderer, response/grid, labels, halo, input, appearance and all mappings. Old three-field feedback cannot silently stand in for it. |
| P6 | Exactly `{status:"excluded"}` or `{status:"included",profile:<entire XrLayoutProfileV1>}`. |

Included XR requires the explicit WebXR target; excluded XR requires the desktop
target. Exclusion deliberately stores no inactive profile. Reopening an excluded
selection disables XR, clears the previous document's profile/preparation, and
initializes only the editor's draft defaults. It cannot reuse hidden old state.
Every recipe still includes the complete P4 desktop contribution.

P1 logical paths and saved declarations contain no live file handles or restored
permissions. Q05-dependent physical-directory provenance is not silently added.
Registry revisions, pending flags and acceptance receipts are session state and
are never serialized as saved readiness. P7 capture requires current acceptance
of P1–P5 and explicit inclusion or exclusion of P6.

`policy` is the complete strict `affect-research-planner-recipe-policy` v1:
participant-count metadata, integer sampling rate, CSV/TSV output selection,
authored LSL output definition and exact `complete-video-v1` playback policy.
There is no allocator or recorder-selection default. XDF recording and selection
of external LSL streams belong to the Runner session and are intentionally absent.

The current saved renderer identities are Flubber, Grid and the project-authored
procedural Face. This does not reintroduce historical Face/Photoatlas assets or
claim a validated instrument. Inspection camera, temporary test position/capture
and unapplied dialogs remain outside experiment configuration.

## Canonical identity and reconstruction

Canonical bytes use the existing recursive lexical-key JSON algorithm, preserve
all array order, encode UTF-8 and end with exactly one LF. Duplicate keys,
non-finite numbers, unknown/missing fields, noncanonical bytes and unsupported
versions reject. Maximum file size is 16 MiB and JSON nesting depth is 64.

Integrity has exactly `algorithmVersion`, `definitionSha256`, `segmentSha256`,
and `reproductionSha256`. Algorithm is `planner-recipe-reproduction-v1`.
`segmentSha256` has all six owner keys and hashes each full canonical payload.
`definitionSha256` hashes the entire authored root with `integrity` omitted.
Planned marker profiles bind this definition hash. `reproductionSha256` binds the
deterministic reconstruction matrix computed afterward, so no hash contains itself.
The file acknowledgement additionally binds the SHA-256 of the complete canonical
file bytes, including the integrity object and final LF.

Reconstruction preserves every explicit variant, terminal language path and
authored presentation profile. It selects no participant allocation. Count and
bound the full product before matrix allocation (maximum 25,000 cases, with the
existing owner limits of 64 variants, 64 language leaves and two profiles).
Reusable variant/timeline, language/presentation and layout projections are hashed
once; matrix cases refer to their complete identities rather than duplicating all
questionnaire/media data for each product row. Individual selection reconstruction
returns the complete selected content with no hidden runtime defaults.

The historical block/after-stimulus questionnaire hooks have no approved
correspondence to successor variants yet. Preserve their exact content and report
`variant-placement-unsupported`; do not silently move or remove them. The frozen
v1 reader continues to support its original meanings.

## Capture, save and editable reopen

Capture freezes one accepted revision set and all explicit policy/target values.
Any owner, policy, target, edit/revert, newer operation or teardown invalidates a
delayed compile/save. P5's entire current saved configuration is accepted at final
capture; it has no separate confirmation action.
`capturePlannerRecipeInputV1(registry,{recipeId,presentationTarget,policy,isCurrent})`
requires a caller guard bound to monotonic researcher-edit, operation and disposal
epochs. Its returned guard composes that lifetime with an irreversible registry
acceptance generation and accepted fingerprint. Clear/reaccept of identical values
cannot revive an old capture, even without an intermediate guard call. An observed
false result remains false. No caller may substitute a constant guard in the app.

Open strictly validates every segment, reference and hash before owner mutation.
Prepared restoration uses each owner's guarded content-only API in dependency
order. Saved media declarations remain unresolved until a new explicit directory
selection, hash/probe and exact owner comparison. No fabricated live snapshots
or imported acceptance receipts are installed.

An unchanged successfully loaded recipe may be saved again byte-for-byte even
while media is unresolved. This path requires an unchanged post-restoration edit/
load/disposal epoch and strict file validation. It acknowledges copied authored
content only; media readiness remains pending. Any user edit, including edit/revert
or an invalid field, forces current owner compilation and acceptance. Old file
bytes are never an error fallback for a changed design.

Saving waits for write/close and strict readback of exactly the prepared canonical
bytes. Picker cancellation, failed write, mismatched acknowledgement or stale
completion cannot mark the current design saved. Neither saving nor reconstructing
a file establishes Runner execution or recording qualification.

## Public API and delivery status

`planner-recipe.js` implements `compilePlannerRecipeV1`,
`createPlannerRecipeV1`, `validatePlannerRecipeV1`, `parsePlannerRecipeV1`,
`serializePlannerRecipeV1`, `reproducePlannerRecipeV1` and
`reconstructPlannerRecipeSelectionV1`. `parsePlannerRecipeFile` dispatches strictly
between the successor and unchanged frozen package reader. Syntax-only wire
validation is never sufficient to adopt or save a document.

`planner-recipe-file.js` implements `openBrowserPlannerRecipeFile`,
`prepareBrowserPlannerRecipeSave` and `validatePlannerRecipeSaveReceipt`.
Prepare immutable canonical text before the save dialog; invoke its
`chooseAndSave()` directly on the final button gesture. The shared dialog accepts
`{prepareSave: prepareBrowserPlannerRecipeSave}` without duplicate listeners.

`preparePlannerRecipeReopenV1(sourceText,{isCurrent})` validates before mutation.
Its one-use `apply(owners)` requires synchronous `begin` to revoke prior source
eligibility, then guarded P1, P2, P5, P3, P4, P6, policy and presentationTarget
callbacks. P3/P4 adapters obtain actual current dependencies after P1/P5 restore.
Failure reports completed portions and denies source adoption; it never rolls
back over newer edits. Only a successful return permits unchanged-source saving.
Ordinary Save adopts metadata only and never invokes these restore callbacks.

Real complete fixtures cover historical and location-aware owner versions,
all authored variants/languages, both explicit-policy owner calculations,
strict integrity, fresh-process reconstruction, save readback and partial/stale
restoration. P7 native independent read/save and shared application integration
remain work in progress at this component checkpoint. Actual Planner–Runner
correspondence is a later stage.
