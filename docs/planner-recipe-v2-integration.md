# Explicit typed-form master integration

Main owns the shared P7 compiler seam for the frozen demographics contract.
`planner-recipe.js` exports explicit `compilePlannerRecipeV2`,
`createPlannerRecipeV2`, `validatePlannerRecipeV2`, `serializePlannerRecipeV2`,
`parsePlannerRecipeV2`, `reproducePlannerRecipeV2` and
`reconstructPlannerRecipeSelectionV2`. Their argument and returned document shapes
match the corresponding V1 APIs. `parseSupportedPlannerRecipe(bytes)` dispatches
only exact master schema/version 1 or 2. Existing V1 and legacy file-dispatch
entrypoints remain strict and unchanged in accepted versions.

Master version 2 requires complete P2 contribution version 2 and reproduction
algorithm `planner-recipe-reproduction-v3`. Selection version 2 keeps the existing
outer fields and exact owner data; its questionnaire rows carry unchanged legacy
Likert or typed FormDefinitionV1 with the matching `likert`/`fields` presentation.
P1/P3/P4/P5/P6 validators and geometry/marker/timeline algorithms are shared, not
reimplemented or repaired. Root versions and scientific integrity are validated
before selection. No V2 object is rewritten into a fake V1 object for validation.

`test/fixtures/planner-recipe-v2-fixture.js` exports asynchronous
`plannerRecipeV2Fixture()` returning `{recipe,reproduction,selections}` for native
and Runner parity. It uses the real P2 editor/compiler with a synthetic save
callback and public project-authored EN/DE demographics plus synthetic legacy
Likert content. It is not the final real-media/MAIA/TAS mock. Serialize fixture
values with existing canonicalJson plus exactly one LF. All input fixtures and
owner algorithms are source-bound; native consumers must independently reproduce
and compare hashes and selection contents rather than trust this generator.

Fifteen focused V1/V2 compiler/file tests pass, including canonical old-byte
preservation, mixed route selection, version/algorithm confusion, malformed
presentation and changed definition rejection. Native decoding, actual CLI
source saving, full app capture/restore, Runner execution and XDF evidence remain
separately gated. No current foreground app or canonical branch was changed.

The main editor save callback now explicitly verifies typed definitions and
routes their exact canonical JSON + LF through the existing workspace storage
command with format `json`. `form-source-storage.js` computes the file hash from
the actual source bytes, not the definition self-hash, and refuses changed or
noncanonical source. It invents no CSV provenance receipt. Existing Likert source
storage retains its original format/receipt path. Module shape validation reuses
the existing V2 module validator, with the already verified typed definition
bound directly by its identity/hash rather than passed into the strict legacy
definition validator. Eight focused source/prepared-save/P2 checks pass; this is
not yet an actual native app storage receipt or consequential CLI publication.
