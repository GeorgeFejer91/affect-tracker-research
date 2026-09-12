import test from "node:test";
import assert from "node:assert/strict";
import { assertMockRecipe } from "../scripts/qualification/planner-mock-experiment.mjs";

// Minimal comparison inputs, not valid master fixtures or native run evidence.
// The production native reader remains responsible for complete schema/hash validation.
function comparison() {
  const expected = {
    workspaceLayout: { assetRoot: "assets", videoLibrary: "assets/stimuli", projectFile: "experiment.package.json" },
    video: { assetId: "asset-clip", annotationId: "library_clip.mp4", sha256: "a".repeat(64) },
    definitions: ["demographics-en", "maia-2-en", "tas-20-en", "demographics-de", "maia-2-de", "tas-20-de"].map(questionnaireId => ({ questionnaireId })),
    modules: ["demographics-en", "maia-2-en", "tas-20-en", "demographics-de", "maia-2-de", "tas-20-de"].map(questionnaireId => ({ moduleId: questionnaireId, questionnaireId })),
    languageTree: { languages: [{ languageId: "en", questionnaireModuleIds: ["demographics-en", "maia-2-en", "tas-20-en"] },
      { languageId: "de", questionnaireModuleIds: ["demographics-de", "maia-2-de", "tas-20-de"] }] },
    isiDefinitions: [{ isiId: "ISI4", durationMs: 1750 }, { isiId: "ISI9", durationMs: 3213 }],
    variant: { variantId: "variant-2", entries: [
      { entryId: "entry-7", kind: "isi", referenceId: "ISI4" },
      { entryId: "entry-8", kind: "video", referenceId: "library_clip.mp4", assetId: "asset-clip" },
      { entryId: "entry-9", kind: "isi", referenceId: "ISI9" },
    ] },
    feedback: { presentation: { renderer: "flubber" }, input: { preset: "arrowKeys" }, visual: { hideFeedback: false } },
    policy: { participantCount: 1, samplingFrequencyHz: 130, output: { csv: true, tsv: true }, lsl: { enabled: true } },
  };
  const recipe = { recipeId: "mock-dictator-recipe", version: 2, presentationTarget: "desktop-screen",
    policy: structuredClone(expected.policy), segments: {
      P1: { study: { id: "mock-dictator", title: "Bilingual MAIA-2 / TAS-20 and Great Dictator mock" },
        workspaceLayout: structuredClone(expected.workspaceLayout), videoCatalogue: { entries: [structuredClone(expected.video)] } },
      P2: { questionnaires: { definitions: structuredClone(expected.definitions), modules: structuredClone(expected.modules) },
        languageSelection: structuredClone(expected.languageTree) },
      P3: { isiDefinitions: structuredClone(expected.isiDefinitions), variants: [{ ...structuredClone(expected.variant), title: "V1" }], allocation: { kind: "runnerAssigned" } },
      P4: { units: "relative", target: "desktop-screen", fit: "contain", calibration: null,
        viewport: { widthCssPx: 1920, heightCssPx: 1080, compatibility: "exact" },
        reference: { box: { width: 60, height: 60 }, centre: { x: 50, y: 35 }, source: { policy: "largest-oriented-area", assetId: "asset-clip" } },
        feedback: { minimumGap: 3, offset: { x: 0, y: 75 }, origin: "design-centre", overlayViewportSide: 24 } },
      P5: structuredClone(expected.feedback), P6: { status: "excluded" },
    } };
  return { recipe, expected };
}

test("mock comparison uses actual returned identities and preserves the requested route and chronology", () => {
  const { recipe, expected } = comparison();
  assert.doesNotThrow(() => assertMockRecipe(recipe, expected, 1));
  recipe.policy.participantCount = 2;
  assert.doesNotThrow(() => assertMockRecipe(recipe, expected, 2));
});

test("same counts and definition identities cannot hide wrong sequence, routing, layout, feedback or policy", () => {
  const mutations = [
    recipe => recipe.segments.P3.variants[0].entries.reverse(),
    recipe => recipe.segments.P3.variants[0].entries[0].referenceId = "ISI9",
    recipe => recipe.segments.P2.languageSelection.languages[0].questionnaireModuleIds.reverse(),
    recipe => recipe.segments.P2.languageSelection.languages.reverse(),
    recipe => recipe.segments.P2.questionnaires.modules.reverse(),
    recipe => recipe.segments.P1.videoCatalogue.entries[0].sha256 = "b".repeat(64),
    recipe => recipe.segments.P4.feedback.offset.y = 35,
    recipe => recipe.segments.P5.presentation.renderer = "grid",
    recipe => recipe.segments.P5.input.preset = "wasd",
    recipe => recipe.segments.P6.status = "included",
    recipe => recipe.presentationTarget = "xr",
    recipe => recipe.policy.lsl.enabled = false,
    recipe => recipe.policy.samplingFrequencyHz = 60,
  ];
  for (const mutate of mutations) {
    const { recipe, expected } = comparison(); mutate(recipe);
    assert.throws(() => assertMockRecipe(recipe, expected, 1), assert.AssertionError);
  }
});
