# P2 authoring adapter

`createPlannerAuthoringP2({editor,readContext,commitContext,onCommit?})` adapts
the existing questionnaire editor. It has no independent draft store, source
compiler, native bridge, or file writer. It uses the frozen shared command API
in `planner-authoring-command-api-v1.md` and the additive `afterCommit` hook.

## Host seams

`readContext()` returns detached `{families,languages,definitions,modules,
languageSelection,locked}`. Families are `{id,label}`. Languages are exactly
`{languageId,languageTag,label}`. `languageSelection` is an existing strict
LanguageSelectionTreeV1 or null for the existing flat-language projection.
Definitions are accepted source definitions, not unsaved draft material.

`commitContext(context)` synchronously installs prevalidated owner arrays and
the language tree. It must not render, notify, validate, write files or await.
The editor's `prepareAuthoringEntries` returns installation and render hooks.
The candidate's `commit` installs state only; `afterCommit` renders and calls
optional `onCommit` after **all** owner candidates have committed. The shared
host handles observer failures as incomplete applied changes, not rollback.

Preparation checks the actual editor/context snapshot and caller cancellation.
The host must call the candidate's pure `isCurrent` guard before any owner
commits. GUI intents and external dependency changes still need the shared
session's existing edit/invalidation notifications; snapshot equality alone
does not detect edit/revert.

## Settings

All five authored settings are typed JSON groups, not arbitrary JSON pointers.
The catalogue also exposes readonly `P2.acceptedDefinitions` and `P2.coverage`.

| Setting | Exact editable value | Final contribution |
| --- | --- | --- |
| `P2.questionnaires` | Draft array below | Prepared `questionnaires.definitions` |
| `P2.languages` | `{languageId,languageTag,label}[]` | `languageSelection.languages` |
| `P2.modules` | Existing QuestionnaireModuleV2 array | `questionnaires.modules` |
| `P2.languageSelection` | Existing LanguageSelectionTreeV1 or null | `languageSelection` |
| `P2.presentation` | `{questionnaireId,repeatLabelsEvery:1\|5\|10}[]`, exact draft order | Hash-bound `presentation.definitions` |

A draft has exactly `{familyId,language,questionnaireId,questionnaireVersion,
title,instructions,attribution,optionCount,items}`. Each item has exactly
`{itemId,prompt,required,subscale,options}`. Each option has exactly
`{optionId,label,scoreValue}`. IDs use the existing sheet's safe identity rules.
`subscale` is researcher-authored text or null; no scoring algorithm is inferred.
`label` is participant-visible text; `scoreValue` is the recorded number or null.
Numeric/required cells and option count can honestly retain invalid raw text;
these remain incomplete drafts and cannot become accepted source definitions.

The sheet owner enforces 256 language slots, 1,024 items, 2–64 options, finite
codes in ±1,000,000,000, bounded text and 4 MiB per sheet. Batches retain the
shared 256 edit / 16 MiB limit. No source bytes, provenance hash or acceptance
receipt is writable through an authored setting.

Whole questionnaire replacement orders families by first appearance, then
slots by selected-language order. Every family gets a slot in every selected
language; a missing translation creates a blank incomplete slot, not invented
content. Removing a slot's family/language drops corresponding references.
Accepted definitions remain unchanged for ordinary content edits until explicit
preparation/save. Presentation-only edits leave scientific hashes unchanged.

## Operations

Every operation uses `{kind:"operation",owner:"P2",operation,arguments}`.
All listed arguments are required, including explicit nulls; extra keys reject.
The catalogue lists argument keys and descriptions.

| Operation | Arguments |
| --- | --- |
| `addQuestionnaire` | `familyId,title,optionCount,rowCount` |
| `removeQuestionnaire` | `familyId` (all selected languages) |
| `updateQuestionnaire` | `questionnaireId,changes` (nonempty subset of version/title/instructions/attribution/optionCount; version key is `questionnaireVersion`) |
| `addItem` | `questionnaireId,item,beforeItemId` (null appends) |
| `setItem` | `questionnaireId,itemId,item` (retain item ID) |
| `removeItem` | `questionnaireId,itemId` |
| `reorderItems` | `questionnaireId,itemIds` (exact permutation) |
| `setOption` | `questionnaireId,itemId,optionId,label,scoreValue` |
| `reorderOptions` | `questionnaireId,itemId,optionIds` (exact permutation) |
| `reorderModules` | `moduleIds` (exact permutation) |

Module array order and each language's terminal module order are separate
authored lists. Changing one does not silently rewrite the other. Supported
master placements are beforeSession/afterSession. Historical typed placements
can be preserved and reported unsupported; this adapter does not add execution
hooks or alter Runner behavior.

## Consequential actions and UI parity

Source import, source preparation/save, confirmation and master-file writes are
separate consequential commands, never edits in an atomic batch. The existing
editor `save(familyId/language)` is a UI action that catches errors; it is **not**
an exact CLI side-effect receipt. Integration must use a guarded owner save seam
and the native storage acknowledgement before claiming that CLI action works.

The current table controls already expose title, instructions, attribution,
option count, answer labels/codes, required values and label repetition. CSV/TXT/
JSON imports and whole/range Excel paste remain source authoring routes, not
raw master-JSON editing. The explicitly allocated E2E-UI follow-up adds direct
graph/terminal-route/module placement controls and advanced identity/subscale
controls. Until integrated and exercised, richer CLI edits are adapter evidence,
not full GUI parity or native CLI/Runner correspondence.

Bundled MAIA-2 and rights-gated TAS source availability are independent of the
adapter. Never invent a missing translation, permission, reverse-code scheme,
computed score or instrument item. Runner implementation belongs to its owner.
