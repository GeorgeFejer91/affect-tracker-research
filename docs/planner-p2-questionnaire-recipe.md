# P2 questionnaire recipe contribution v1

Owner: Section 2. This versioned Planner contribution preserves questionnaire
content and presentation without changing the strict legacy questionnaire
definitions, hooks, or ExperimentPackageV1. JSON remains a backend artifact;
researchers use the questionnaire tables and settings.

## Exact contract

`site/src/research/questionnaire-recipe.js` exports the pure async
`validateQuestionnaireRecipeContributionV1(value)` (detached validated object)
and `validateQuestionnaireRecipeContribution(value)` (true or throws).

The wrapper has exactly these fields:

```json
{
  "schema": "affect-research-questionnaire-recipe-contribution",
  "version": 1,
  "questionnaires": { "algorithmVersion": "questionnaire-hooks-v2", "definitions": [], "modules": [] },
  "languageSelection": "existing LanguageSelectionTreeV1 object",
  "presentation": {
    "schema": "affect-research-questionnaire-presentation",
    "version": 1,
    "definitions": []
  }
}
```

The languageSelection string above is explanatory, not a valid fixture. See
`test/fixtures/questionnaire-recipe-v1.json` for a complete valid synthetic
English/German example shared with native tests.

Each presentation definition has exactly `questionnaireId`,
`definitionSha256`, and numeric `repeatLabelsEvery` (1, 5, or 10). Entries must
match scientific definitions one-to-one, in the same order and with the same
identity/hash. Missing, extra, stale, reordered or invalid entries reject the
whole contribution; imported settings never receive implicit defaults.

## Preserved fields and display meaning

The existing definitions preserve titles, instructions, attribution, language,
item IDs/order, prompts, required flags, participant-facing answer labels,
explicit nullable recorded codes, researcher-supplied subscale metadata, and
definition hashes. Modules preserve their existing placements and references.
Every included questionnaire family needs a module in every selected language;
language-tree routing must reference the correct language's modules.

`repeatLabelsEvery` is separate from scientific content and is included in the
new recipe contribution. Groups contain at most the requested number of items;
a change to participant-facing answer labels starts a new group immediately.
Recorded codes do not affect visible grouping. This describes Planner preview
semantics, not a claim that Runner execution is implemented.

The explicit UI/legacy projection `createQuestionnairePresentationV1` may assign
1 when creating a new contribution. The strict importer never invokes that
default. Legacy exports still reject unsupported presentation rather than
silently losing it. Legacy two-key contribution readers reject this new wrapper.

## Boundaries

P7 owns embedding, root canonical JSON, integrity, persistence and export policy.
P2 owns scientific-content validation, language coverage, and presentation.
Unsupported route placements must be rejected by P7, not silently dropped or
reinterpreted. Neither this wrapper nor its fixture defines scoring totals,
missing-response policy, translated scientific instruments, or Runner behavior.
Unfinished editor drafts and workspace save receipts are not final recipe data.

The canonical fixture digest (without the trailing file newline) is
`ac7ef132eb5896794dfbef833b5a94e1a56a67d89fdd2854f1d84f3ff6da4d89`.
