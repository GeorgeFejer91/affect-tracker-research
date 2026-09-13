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
ambient presets resolve files. Limits:16MiB manifest/transport,4MiB per asset,
256 references. Duplicate, missing, extra, reordered or changed files reject.

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

Chat Orchestrator owns integration; the user extended the same task with the P2
minimal builder and SurveyJS preset conversion before final handoff.
