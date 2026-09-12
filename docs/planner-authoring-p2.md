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

The table controls expose title, version, instructions, attribution,
option count, answer labels/codes, required values and label repetition. CSV/TXT/
JSON imports and whole/range Excel paste remain source authoring routes, not
raw master-JSON editing. Compact advanced settings expose item IDs, subscales,
option IDs, item/option order and per-item option add/remove. Questionnaire and
family identities are established by standardized source import or blank-family
creation; they are not rewritten as part of participant wording edits.

`createQuestionnaireRoutingEditor({root,readContext,applyEdits})` is the P2-local
view. Main injects a Section 2 mount and invokes `sync()` on external owner
changes, `destroy()` at teardown. The view keeps only transient expansion/busy/
error state, reads the same context as the adapter and submits closed edits to
the same shared session. It never supplies raw source hashes or a JSON editor.
`applyEdits(edits,{isCurrent,signal})` must honor the view's lifetime guard in
addition to the session/owner revision guard; otherwise late disposal could
still apply a pending gesture. It may return an applied/incomplete result or
throw. Unknown stored selection values remain explicitly unavailable in the UI.

Graph gestures edit question/option IDs, prompts and labels, wrap an existing
route or the root in a new question, move routes between questions, reorder
questions/options and flatten a question into its parent. Existing strict tree
validation rejects cycles, duplicate/missing leaves and ID collisions before
any change. Languages expose IDs, tags, labels and order; changing a tag creates
missing-asset work, never a translation. Modules expose accepted source
references, before/afterSession placement, ID, global order and add/remove.
Each terminal language has a separate explicit module order/add/remove list.

`editor.saveAuthoringQuestionnaire(questionnaireId,{isCurrent,signal})` reuses the
normal source-save flow but throws failures and returns
`{questionnaireId,definitionSha256,sourceReceipt}`. The existing onSave callback
receives an optional second guard; the host checks it before native dispatch and
adoption and returns the actual storage acknowledgement. A null sourceReceipt
means the callback returned no acknowledgement, not a fabricated successful
write. Cancellation after a returned receipt retains it as `error.sourceReceipt`.
Native failures with possible side effects must likewise retain their receipts.
The UI's existing `save(key)` remains compatible and catches/display errors.

The owner view has focused Chrome event/semantic and screenshot checks; shared
app mounting, real native CLI invocation and actual Runner correspondence remain
integration evidence, not claims established by the isolated owner harness.

Bundled MAIA-2 and rights-gated TAS source availability are independent of the
adapter. Never invent a missing translation, permission, reverse-code scheme,
computed score or instrument item. Runner implementation belongs to its owner.
