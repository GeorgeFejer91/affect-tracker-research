# SurveyJS questionnaires in Planner and Runner

Planner imports questionnaires from the [SurveyJS online builder](https://surveyjs.io/create-free-survey)
or from code that produces SurveyJS JSON. Runner bundles SurveyJS Form Library
3.0.4, including its standard question controls, translations, themes and styles.
Rendering does not require a CDN or a SurveyJS account.

## Author a questionnaire

1. Add a questionnaire and select its language in Planner's questionnaire section.
2. Use the existing table for a simple questionnaire, or select **Open SurveyJS
   builder**. Copy the builder's JSON Editor output or download its JSON file.
3. Select **Paste SurveyJS JSON** or import the `.json` file into that language's
   questionnaire slot. Ordinary pretty-printed JSON is accepted. Node.js may
   generate exactly the same object; no Node.js runtime is needed on participants'
   computers.
4. Preview the questionnaire, then **Save questionnaire**. Add each required
   language version, its placement and routing as usual, and save the experiment.

The original survey object stays intact inside the final experiment JSON.
Pages, conditions, validators, expressions, nested forms, choices and localized
strings are preserved. Reopening the experiment restores the full object. The
imported sheet supports metadata edits, replacement import and download of the
original SurveyJS object; it does not flatten advanced surveys into table rows.

MAIA-2 remains selectable in English and German. The existing authorized German
TAS source remains available through the researcher-local preset installer.
Unavailable TAS translations stay disabled until authorized source assets are
installed; selecting a language never fabricates or translates validated wording.
These presets also render through SurveyJS while retaining their original prompts,
item identities, answer labels and recorded codes. Saved 1/5/10-item label
repetition uses a presentation adapter and does not change scoring or paging.

## Runtime behavior and scope

The complete standard Form Library is bundled, including dynamic panels and
matrices, branching, calculated values, ranking, ratings, sliders, file questions
and signature pads. SurveyJS owns question rendering, page navigation and
validation. Keyboard behavior follows SurveyJS and browser controls; the former
handwritten form's Enter-to-next-field shortcuts are not a separate interaction
layer over arbitrary imported surveys.

The experiment's existing completion rule remains explicit: **every visible input
question must be answered**. This includes nested questions and matrix rows;
hidden branches and display-only elements do not require input. The wrapper records
`completionPolicy: "allVisibleQuestions"`. This runtime overlay does not rewrite
the imported JSON, even when the source marks an input optional. Read-only values
retain their SurveyJS behavior. Native validation must succeed before completion.

JSON cannot install custom JavaScript, plugins, custom widgets or event handlers.
Unknown question types, invalid schemas, REST choice services, external upload
handlers and completion redirects are rejected at import. File answers use inline
data (`storeDataAsText: true`) and share the answer-size limit. HTML is sanitized
with DOMPurify. Remote media references require reachable permitted resources;
they are not downloaded into the experiment. For offline use, include resources
as supported inline data. Large attachments may exceed the bounded experiment
transport, so preview and test the intended content before data collection.

This integration contains the Form Library and a link to the online builder.
It does not embed the separately licensed Creator editor, Dashboard analytics
product or PDF Generator. Browser-compatible rendering is shared with the desktop
apps; hosting an online participant runner and its data collection service remains
a separate deployment task.

## Versioned contracts and persistence

Imported definitions use `affect-research-surveyjs-definition` v1 with exact fields
`schema`, `version`, `questionnaireId`, `questionnaireVersion`, `title`, `language`,
`engineVersion`, `completionPolicy`, `source`, `surveyJson`, `definitionSha256`.
Source metadata retains kind `researcherJson`, basename and SHA-256 of the original
import bytes. The definition hash binds the complete canonical wrapper, excluding
its own hash. The native source store saves canonical wrapper bytes with a final
newline under source format `surveyJsDefinitionV1`.

An experiment containing SurveyJS definitions uses master v4, P2 v3,
`questionnaire-hooks-v4`, presentation v3 and `planner-recipe-reproduction-v5`.
Master v4 accepts the existing P1 v1/v2/v3 contracts with their original semantics.
Older master and P2 readers remain strict; saved v1–v3 files are not silently
rewritten. Runner uses explicit Start/Action v4 envelopes, plan algorithm
`master-sequence-v4`, and `surveyDraft` / `surveySubmit` actions bound to the
current occurrence. Existing typed and Likert answer contracts remain intact.

Rust re-evaluates the pinned SurveyJS core in the safe Rust Boa 0.22 engine, on
a dedicated bounded worker. A renderer's assertion that a survey is complete is
not authoritative. Imported content is JSON data, never executable source. The VM
has no filesystem, network or DOM bindings. Import/answer objects are bounded to
4 MiB each, depth 48, 100,000 nodes and 2,048 questions; the native queue, execution
deadline, loop/recursion/stack limits bound evaluation. There is no claimed hard
heap quota. Survey definitions and supported behavior are pinned to 3.0.4; a
future library upgrade requires new compatibility validation.

Master v4 writes `master-responses.v3.jsonl`. Survey responses contain exactly
`engineVersion`, `language`, `completionPolicy`, `randomSeed`, `evaluatedAtUnixMs`,
`inputData`, `data`, `visibleQuestionNames`, `pageNo`, `elapsedMs` inside the normal
occurrence-bound response record. `inputData` is the submitted checkpoint;
`data` is SurveyJS's processed result, including completion cleanup and calculations.
Both are needed to reproduce conditions that change when hidden answers are
cleared at completion. Partial drafts also retain answers. Randomization uses a
stable definition-and-occurrence seed; expression evaluation time is recorded.
Draft and completed records are flushed and synced before acknowledgement or
advancement. Full definitions and full response records remain in the existing
Runner information stream for XDF reconstruction; an independent consumer checks
SurveyJS replay against the recorded inputs, seed and clock.

## CLI and verification

The existing CLI `perform` operations are unchanged:

```json
{"kind":"perform","operation":"importQuestionnaire","arguments":{"path":"C:/study/custom.json","familyId":"custom","language":"en"}}
{"kind":"perform","operation":"saveQuestionnaire","arguments":{"questionnaireId":"custom-en"}}
```

Select a workspace and create the intended pristine family/language slot first.
The public envelope still requires the live session ID, request ID and current
revision. `P2.questionnaires` exposes imported drafts as `kind: "surveyjs"` with
their complete definition. Change survey content through import, and save through
the native source-store operation before final experiment capture. See the
[consequential command contract](planner-cli-consequential-commands-v1.md).

`pnpm surveyjs:build` regenerates committed browser and native assets from locked
packages. `pnpm surveyjs:check` checks bundles, hashes, license notices and the
cross-language master fixture; CI runs it before the test suite. Source licenses
are in `docs/licenses`, with complete notices in generated bundles and
`site/src/research/vendor/THIRD-PARTY-NOTICES.txt`.

Qualification entry points are `surveyjs-rendered.mjs` (Planner, presets and
renderer), `runner-surveyjs-ui.mjs` (actual Runner app, master 2/3/4) and
`planner-surveyjs-cli.mjs` (real hidden Planner process). These live under
`scripts/qualification`. Native tests independently exercise the core, strict
master parsing and durable worker submission. Browser receipts using synthetic
native replies do not establish native video timing, live LSL/XDF acquisition or
installed-app qualification. Those remain the final consolidated Runner checks.
