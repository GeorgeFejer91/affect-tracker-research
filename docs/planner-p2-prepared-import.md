# P2 prepared authoring import

Main-allocated Backend Verification follow-up for P2-03/P2-04 source intake.

`await editor.prepareAuthoringImport(imported, {familyId, language, sourceBytes,
isCurrent, signal})` returns `{questionnaireId, isCurrent, commit, afterCommit}`.
The requested existing family/language slot must be pristine, unlocked and idle.
The imported definition must already have exactly that family and language;
identity is never rewritten and no app family is renamed or created.

Preparation copies original bytes and importer output before awaiting. It reruns
`importQuestionnaireAuthoring` using the original logical name and source
provenance, comparing the complete importer result. Thus definition, original
bytes and CSV/TXT/JSON conversion receipt must agree. It builds a detached loaded
entry using the same private state preparation/install functions as loadDefinition.
There are no editor mutations, storage calls, rendering or notifications.

The current guard covers caller cancellation/currentness, editor generation,
context/entry/token identity, pristine/lock/busy state and current source/draft
content. `commit` rechecks it and synchronously installs the prepared loaded entry
once. Import remains a dirty draft. The next prepared save retains exact original
sourceBytes and authoringResult; neither a source write nor app definition/module
adoption is claimed here. `afterCommit` renders/notifies once, and skips projection
if a newer editor lifetime has replaced it. Main owns consequential publication.

Evidence: pre-edit save/restore baseline13/13; final focused import/save/restore/
integration gate29/29, including9 new tests. Tests cover CSV/TXT/JSON original
byte and receipt parity through save, no preparation or commit projection,
single-use commit, detached caller bytes, mismatched source/family/language,
reset/cancel/lock/preset and invalidation during await. No broad suite, builds,
foreground interaction, native persistence or Runner qualification was run.
