# P2 prepared recipe restoration

Backend Verification, P2-04/P2-07/P2-08 and complete P2-02 coverage.

`await questionnaireEditor.prepareRestoreRecipe(contribution, {isCurrent, signal})`
returns `{restored, isCurrent, commit, afterCommit}`. The detached `restored`
getter contains the existing version-specific authoring restoration result
(`contribution`, `families`, `languages`, `coverage`) plus exact `presentation`.
The v1 result retains its existing questionnaire/language contribution shape;
v2 retains its existing full recipe contribution shape. Main reads their common
`contribution.questionnaires` and `contribution.languageSelection` fields.

Preparation explicitly dispatches only P2 v1 or v2 through existing owner
validators, including full hashes, family/language coverage and exact
presentation binding. It snapshots saved input before awaiting. It creates
fresh entries from saved definitions rather than presets, with new preset
tokens, sourceDefinitionHash bound to the saved definition, dirty/pristine false,
and null sourceBytes/authoringResult/undo. No source file or media readiness is
invented. Current entries, context and projections remain unchanged.

The guard observes editor lifetime, entry identity/content, source bytes,
lock/busy state and caller cancellation/currentness across async validation and
before commit. GUI edits, source adoption, presentation restore, owner staging,
sync and reset advance the restoration lifetime. A pending restoration does not
itself reserve or advance that lifetime.

`commit()` is synchronous, state-only and single-use. It replaces the actual
entry map and editor context with prepared state, clearing pending upload and
projection fingerprints. Main installs app definitions/modules/families/languages
in the same publication step; it must not call editor.sync/reset or the existing
rendering restorePresentation inside that state boundary. `afterCommit()` renders
and notifies once, after publication. It rejects before commit and skips stale
projection after another editor lifetime change. The existing GUI
restorePresentation API and its behavior remain available.

Evidence: pre-edit scoped baseline18/18; final P2/typed/save/restore gate28/28,
including10 new tests for both versions, exact definitions/presentation, fresh
tokens and absent inherited bytes, detached results, state/projection separation,
reset/preset/lock/presentation/cancellation/source drift/overlapping save fences.
The wider run (before the final source/busy test) passed1029/1030. Its sole failure
is the existing raw-Tauri-invocation allowlist omission for
planner-authoring-native-effects.js in research-modular-architecture.test.js;
both files are unchanged from base342026a and the issue was sent to Main.
Log: D:/GitHub/.affect-checks/p2-recipe-restore-regression.log.

Main owns application wiring, native Open and whole-session publication evidence.
This checkpoint makes no native, rendered UI, Runner or XDF qualification claim.
