# Planner questionnaire assets

The 2026-09-13 amendment changes fresh saves to an experiment manifest plus
questionnaire files. Copy the JSON and its assets folder together. Paths resolve
from the directory containing the experiment JSON.

```text
experiment_UTCtimestamp.json
assets/questionnaires/<questionnaire-id>/<language>/<sha256>.survey.json
```

SurveyJS files contain raw SurveyJS models. Master5/P2v4 stores an ordered
`questionnaires.assets` registry: questionnaireId, language, definitionSha256,
format, relativePath, sha256, byteLength and wrapper metadata. Historical legacy
definitions can be externalized as `.definition.json` with null metadata. The
P2 follow-up saves freshly edited instruments as SurveyJS.

Modules and language routes still determine presentation order and placement;
registry order is definition order. IDs, source attribution, engine pin,
completion policy and all routing remain explicit.

## Identity

`planner-questionnaire-assets-v1` versions the manifest integrity. The manifest
hash binds references, paths, exact file hashes and `contentIntegrity`. The
latter binds the complete resolved master4 content, which is reconstructed and
strictly verified before acceptance. Plan5 (`master-sequence-v5`) binds the
actual manifest source-byte hash and selector; its selected content retains the
verified master4 projection and semantic hashes. File identity and content
identity are deliberately separate.

Historical strict readers1–4 reject5. Unchanged historical copies retain schema
and exact bytes. Fresh authoring compiles current semantics then externalizes.
The version1 `affect-research-planner-asset-bundle` is only an IPC/CLI/in-memory
envelope carrying exact manifest text and `{relativePath,sourceText}` snapshots.
It is not the saved master JSON. No absolute paths, URLs, inferred search or
ambient presets resolve files. Duplicate, missing, extra, reordered or changed
files reject. The manifest adds no arbitrary per-asset size or reference-count
ceiling. Existing shared readers still enforce historical 4MiB SurveyJS and
16MiB recipe/transport acceptance limits; these are implementation behavior, not
product requirements. Broad removal remains separately owned.

## Lifecycle

Native save creates/verifies assets before publishing a new master filename,
then reads the entire set back. Existing exact assets are reused; mismatches
never overwrite. Interrupted saves can leave unreferenced files but cannot
return success for an incomplete experiment. Browser save selects a directory
grant and verifies write/close/readback. Its cross-client exclusivity remains
weaker than native create-new. Browser Open needs the work-folder grant.

Runner verifies assets at intake, preflight and Start and freezes the exact
manifest/files per attempt. Startup5 information includes snapshots for offline
reconstruction from recorded data. Response3 semantics remain unchanged.
Version5 has distinct Start/actions and explicitly unqualified validation;
historical validation3 stays strict and research qualification remains gated.

## Evidence

Focused JS tests cover exact native fixtures, every variant/language plan,
independent processes, owner restore, browser directory save/Open, stale/cancelled
and failed writes, and standalone recorded-startup reconstruction. Native tests
compare every JS plan and verify real file readback/tampering rejection.
The native library checks without default features; its Windows test harness
needs the repository's existing copy-only Common Controls6 diagnostic manifest.
All three manifest native tests pass with that prepared copy. No dependency or
unsafe boundary was added. This is software evidence, not installed-device,
native playback, actual XDF acquisition, timing or research qualification.

## Minimal P2 builder

The production Planner opts into SurveyJS authoring. Importing MAIA-2, an
installed researcher-local TAS source, or demographics converts their complete
items to standard SurveyJS elements before save. Historical CSV/form presets
remain available to frozen readers. The questionnaire save writes raw SurveyJS
JSON; the manifest references that file. Researcher-local TAS content is not
redistributed in the repository.

Each questionnaire card contains a scrollable list of its added elements. Edit
prompts, choice labels and numeric codes; move elements up/down, place beside the
previous element, choose a page, or add choice/text/number elements and pages.
Paste a copied Excel table into the editable import grid and add its rows. A
second paste gives newly generated IDs distinct names and preserves original
item IDs in provenance. Unfinished paste and invalid cells block save/preview.
Imported advanced JSON keeps its conditions, nested panels and translations.

The bottom Participant preview button opens a dialog using the real participant
SurveyJS renderer. Researchers can answer and test the uploaded questionnaire.
Answers stay in the temporary preview and closing disposes its model. Preview
never changes saved questionnaire definitions or experiment results.

Raw JSON retains source attribution, original item identities, prompts, coding
and subscales in declared affectResearch metadata. Model construction omits only
those non-rendering fields. SurveyJS remains the questionnaire evaluator; the
shared completion hook also preserves the demographic UTF-8 text bound.

The user authorized unified integration with current Planner/Runner updates.
Chat Orchestrator and the active Runner task are informed of the tested handoff.

Final isolated software evidence (2026-09-13, D:/GitHub/.affect-checks):
1215 Node tests pass (questionnaire-builder-all-node-04.log); SurveyJS generated
bundle/fixture checks and both frontend builds/boundaries pass. Headless Edge
builder-final-ui-02 has 15 checks including the installed local TAS source;
builder-final-popup-02 has 14 checks at 800px. Both screenshot layouts inspected.
questionnaire-builder-native-03 uses the documented prepared diagnostic copy:
all three engine tests pass with the existing execution deadline unchanged.
