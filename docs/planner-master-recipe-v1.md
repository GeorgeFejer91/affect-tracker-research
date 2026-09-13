# Planner master recipe v1

## SurveyJS successor v4

Experiments containing imported SurveyJS definitions use explicit master v4,
P2 v3, hooks v4, presentation v3 and reproduction v5. The complete source object
is nested in each SurveyJS definition; no advanced content is flattened or
discarded. Existing master1–3 readers and unchanged-file saves retain their
original contracts. See [SurveyJS questionnaires](surveyjs-questionnaires.md)
for the complete producer/Runner/persistence extension. The v1 contract below
remains frozen.

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
Language graph depth is a separate concern: P2's validated acyclic tree may have
up to 256 flat nodes. A 66-node chain remains valid and does not create 66 levels
of JSON nesting. Native and browser readers share that existing owner contract.

Integrity has exactly `algorithmVersion`, `definitionSha256`, `segmentSha256`,
and `reproductionSha256`. New compilation uses `planner-recipe-reproduction-v2`.
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

Reproduction v2 uses presentation entries `{presentationTarget,
layoutIdentitySha256}`. Their hash covers this exact internal identity:

```js
{
  schema: "affect-research-planner-layout-identity", version: 1,
  presentationTarget,
  algorithms: {
    layout: "desktop-layout-resolution-v1" /* or xr-layout-resolution-v1 */,
    feedbackEnvelope: "feedback-envelope-v2",
    feedbackFootprint: null /* or xr-feedback-footprint-v1 */
  },
  profile, // complete validated P4 or P6 profile, without rounding
  media, // actual P1 display projection: ordered unique content IDs/dimensions
  feedback // complete validated P5 v2 contribution
}
```

The identifiers freeze the current owner algorithms; changes to their meaning
require a new identifier. All readers actually resolve and validate the complete
layout before hashing the identity. Authored root, owner hashes, profiles and
dependencies remain byte-exact. Independent numerical evidence compares exact
object/array shape and nonnumeric leaves, with absolute error less than `1e-10`
for derived geometry only. Saved inputs are never rounded or tolerance-matched.
Raw trigonometric output varies by about `1e-15` across JavaScript/Rust on the
tilted XR fixture and is unsuitable as a portable SHA input.

The earlier unreleased `planner-recipe-reproduction-v1` keeps its original
`layoutSha256 = SHA(full raw resolved layout)` meaning in readers. It is never
reinterpreted as v2. Native intake rejects an old v1 file if exact reconstruction
differs, including the known tilted XR vector. Browser readers likewise preserve
original bytes only when exact legacy reconstruction succeeds; they never repair
a cross-engine v1 mismatch. Frozen `ExperimentPackageV1` is unchanged.

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

Native `research_planner_recipe` exposes `parse_planner_recipe_bytes`,
`parse_planner_recipe_file`, `PlannerRecipeV1::{validate,reproduce,
reconstruct_selection,canonical_file_bytes}` and the exact saved receipt.
It invokes each owner's Rust validator/projection, independently rebuilds all
routes, timelines, marker profiles and layouts, then checks all hashes.
`research_load_planner_recipe` is read-only in both companion registries;
`research_save_planner_recipe(source_text)` is Planner-only and also checks the
executable role. Named staged writes are acknowledged only after strict exact
file readback. Cancellation returns null; invalid source is rejected before the
picker/write. No new unsafe boundary or runtime authority is introduced.

Current v2-algorithm fixtures are `planner-recipe-current-v1`,
`planner-recipe-locations-current-v1`, `planner-recipe-xr-current-v1` and
`planner-recipe-deep-language-v1`, each with
canonical JSON and reproduction matrix. Their filename's v1 denotes the master
schema; the integrity explicitly names reproduction v2. Earlier fixture bytes
remain unchanged. `scripts/qualification/planner-master-parity.mjs` runs the
independent Rust example against complete masters, both desktop policies/units
and all three renderers, checking every selected variant/language with source
and executable hashes. Actual Planner–Runner correspondence is later.

`scripts/qualification/planner-master-browser.mjs <browser.exe> <new-directory>`
runs the four complete current vectors in a fresh headless browser profile. Its
79 assertions cover exact compile/read/re-export, full reproduction matrices and
selected content/layout profiles. A bounded loopback HTTP receipt owns completion;
the Edge launcher may exit before its browser returns a result. Nonempty evidence
directories reject before capture, preserving earlier receipts. Receipt metadata
binds commit, dirty state, harness, served HTML, bundled sources and fixture hashes.
This is actual browser codec evidence, separate from application UI/file-picker
or installed native qualification. Chrome 152 and Edge 153 both pass this harness.

## Final P7 combined verification — 2026-09-12

Clean application checkpoint `15f5bfd36750c182a0943223dbcc491de182af60`
contains integration candidate `875efae0a852bdcea978e8a12b74c0e81288d51c`.
The product source is identical; the only additional changes are the P7 browser
codec harness and its documentation/board entry. P7-03 through P7-09 are ready
for the integration owner's final delivery. Root retains catalogue and complete
application promotion authority.

- All **769 JavaScript** and **235 no-default native library** tests pass.
- The actual shared Planner workflow passes **65 checks in each of Chrome 152
  and Edge 153**. It authors study/policy/order/ISI/layout/feedback changes,
  confirms owner sections, captures final P5 settings, writes a named test file,
  checks exact closed readback, opens it in a fresh controller, copies unresolved
  media content unchanged, rebinds exact media declarations, then reconfirms and
  recompiles identical bytes. Edit/revert and layout/color Reset withdraw old
  source eligibility. Both saved-state PNGs were inspected: Review heading,
  confirmation mark, save status and reachable footer agree.
- The rebuilt independent Rust reader reproduces both actual browser-authored
  files, complete matrices and **12 selected projections** exactly. Both files
  have SHA-256 `09dfedfee8309e4813fb3383bbdc7f6326d1be30bee55f2bd14fef89f1a0d948`.
  These desktop cases have zero derived geometry difference.
- **11 independent JS/native matrix cases** cover both location generations,
  long language graph, both desktop methods/units, all three renderers and XR.
  Maximum derived geometry difference is `3.552713678800501e-15`; authored
  content, identity and hashes agree exactly. Actual Chrome and Edge each pass
  **79 codec assertions** on the same clean combined source.

Evidence is under `D:/GitHub/.affect-checks/`: `p7-final-combined-node.log`,
`p7-final-combined-native.log`, `p7-final-combined-native-example-build.log`,
`p7-final-combined-app-{chrome,edge}/`,
`p7-final-combined-generated-native/`, `p7-final-combined-native-parity/` and
`p7-final-combined-codec-{chrome,edge}/`. Each receipt retains its exact source
and artifact bindings. The standalone generated-file verifier is
`p7-verify-generated-masters.mjs` in that evidence directory.

The UI fixture uses an explicit synthetic media boundary and disk-backed picker
adapter, and seeds questionnaire content through its owned restore API. Actual
table editing has its separate P2 evidence. These checks do not establish OS
picker interaction, physical decoding, installed native qualification or Runner
execution/recording correspondence. The normal no-default example build retains
five unrelated geometry/workspace dead-code warnings; the native test build
retains two geometry warnings. No warnings-denied combined Clippy claim is made.
The integration owner separately owns build closure, final all-section visuals
and canonical delivery.
