# P7 recipe assembly and current boundary

P7 owns session acceptance, final composition, named save acknowledgement and
editable recipe reopening. Domain preparation in another segment is not session
acceptance or a file save. This Backend Verification pass implements P7-03/04/07
components and the policy/language foundations for P7-05/06/09; it does not yet
deliver the complete successor master recipe.

## Current interfaces

- `planner-contributions.js` registers one owner per P1–P6. Its
  `accept(segment,{selectedTarget})` validates detached current content and exact
  actual dependency snapshots before freezing acceptance. Any observed pending,
  withdrawn, replaced or changed dependency expires that acceptance, including an
  edit followed by a revert. `assertAccepted()` requires P1–P5 and an explicit
  exclusion/acceptance for each registered optional P6 owner.
- P1 registration uses the complete workspace getter, validator and subscription.
  The registered outer revision is the only P1 dependency revision. P1-owned
  projections retain that outer revision and the nested catalogue hash/revision.
- `package-file-picker.js` validates prepared canonical v1 bytes before the final
  button invokes its save picker. The writer awaits write/close, rereads and
  validates the selected file, and returns the exact six-key acknowledgement.
  `package-save-dialog.js` supplies the required fresh browser user gesture after
  asynchronous preparation. Native saving retains its existing single OS picker.
- Named browser Open needs only a selected file. It never installs a workspace
  handle or attests the fixed package asset root. File persistence and asset
  authorization are separate, and interrupted/failed writes cannot report Saved.
- `installPlannerContributions()` retains live property getters and removes
  subscriptions before producer destruction, including failed initialization and
  repeated teardown.
- Review exposes one explicit presentation selector. Controller
  `getSelectedPlannerTarget()` returns `null`, `desktop-screen`, or
  `webxr-immersive-vr`; initial selection is null and no value is inferred from
  the host or P6 profile. Integration passes this getter into P6 acceptance's
  `selectedTarget` option. A changed selection expires active P6 acceptance and
  compiled output, preserving unrelated P2 acceptance and a disabled P6 exclusion.
  A selected target cannot be silently omitted into a v1 save. This is a session
  interface, not a finalized master profile-combination contract or XR execution.

## Retained policy component

`PlannerRecipePolicyV1` has exactly `schema`, `version`, `participantCount`,
`samplingFrequencyHz`, `output`, `lsl` and `playback`. Schema identity is
`affect-research-planner-recipe-policy`, version 1. The JS and Rust validators use
the shared `test/fixtures/planner-recipe-policy-v1.json` conformance fixture.
Both assert canonical SHA-256
`c2b30a0af779d28e1ca5c753f84b36717ce10af241ab7a2837be49df6c982f21`.

Participant count retains its existing study metadata meaning and 1–100000 bound;
it does not assign participants to variants. Sampling retains the existing
integer 1–240 Hz bound. `output` contains explicit CSV/TSV choices, at least one
enabled. `lsl` retains the existing five saved fields and text bounds. Playback
retains the exact `complete-video-v1` policy, including sound, decoded end,
adjacent feedback and restart from the beginning. Parsing supplies no defaults
and rejects noncanonical text or unknown fields. The new component has no native
execution, LSL emission or recording authority.

The legacy-policy projector carries only these existing fields. It does not
convert an old explicit schedule into authored variants or alter used-run
evidence. The frozen `ExperimentPackageV1` reader and canonical bytes remain
unchanged.

## Questionnaire and variant correspondence

`compilePlannerQuestionnaireRoutesV1()` validates full P2 coverage and preserves
the exact nested language routes, module ordering, full definitions, response
codes, hashes and provenance. Before/after-session modules retain their existing
meaning. It never substitutes the currently selected participant language for
the complete authored language tree.

Current P3 variants do not define blocks or attach an ISI to a video. A historical
before/after-block or after-stimulus module therefore requires an explicit
successor correspondence. The compiler returns a `PlannerRecipeIssue` for P2 with
the exact module/placement field and `variant-placement-unsupported`; it does not
discard the hook or infer a relation to adjacent named ISIs. The historical v1
reader continues to support its original placements unchanged.

## Remaining assembly gates

P4 currently has no accepted desktop layout contract while Q08's exact reference
extent is pending. Its getter remains enabled/pending/null and its validator
rejects. `affect-research-screen-layout-draft` must not enter a master recipe.
The complete successor envelope, geometry/profile validation, derived variant ×
language × presentation reproduction, native mirror and final master dispatch
remain unfinished. The application currently blocks fresh unsupported owner
contributions from being silently omitted into a v1 save.

Content-only reopen first validates the complete saved recipe, then restores
authored fields without media permission. P1 stages saved declarations unresolved;
P3's `restoreStimulusVariantContent` and P6's `restoreXrLayoutDraft` must keep their
current real dependencies pending. They must not fabricate a ready P1 snapshot.
Fresh exact media rebinding, preparation and explicit acceptance are separate
steps. Ready-only restore APIs remain for already verified dependencies. A final
composition owner must await each owner mutation and fence edits, later opens and
teardown throughout the restore sequence.

Owner-level synthetic file handles, headless UI checks and independent-process
software reproduction are not installed file-picker, media, native playback,
Edge, XR or research qualification receipts. Integration and canonical promotion
remain owned by the shared integration task.
