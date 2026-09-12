import test from "node:test";
import assert from "node:assert/strict";
import { assertMockRecipe, assertPublishedConsequence, mockBindingsReady } from "../scripts/qualification/planner-mock-experiment.mjs";

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
        feedback: { minimumGap: 3, offset: { x: 0, y: 75 }, origin: "design-centre", overlayViewportSide: 12 } },
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

function acknowledged(operation, issues=[]) {
  const request={requestId:"request-1",action:{kind:"perform",operation,arguments:{}}};
  const response={status:issues.length?"incomplete":"applied",issues,
    result:{operation,published:true,effect:{operation,requestId:request.requestId,stage:"completed",outcome:"acknowledged",possiblyChanged:true,receipt:{saved:true}}}};
  return {request,response};
}

test("controlled mock comparison requires the exact master3 chain and rejects downgrades", () => {
  const { recipe, expected } = comparison();
  expected.masterVersion = 3;
  recipe.version = 3;
  recipe.segments.P1.version = 3;
  recipe.segments.P1.videoCatalogue.version = 3;
  recipe.segments.P2.version = 2;
  recipe.integrity = { algorithmVersion: "planner-recipe-reproduction-v4" };
  assert.doesNotThrow(() => assertMockRecipe(recipe, expected, 1));
  for (const mutate of [r => r.version = 2, r => r.segments.P1.version = 2,
    r => r.segments.P1.videoCatalogue.version = 2, r => r.segments.P2.version = 1,
    r => r.integrity.algorithmVersion = "planner-recipe-reproduction-v3"]) {
    const changed = structuredClone(recipe); mutate(changed);
    assert.throws(() => assertMockRecipe(changed, expected, 1), assert.AssertionError);
  }
});
test("mock accepts only named partial-readiness issues after actual native acknowledgement",()=>{
  const cases=[acknowledged("selectWorkspace",[{owner:"P1",field:"P1.media.catalogue",code:"media_pending"}]),
    acknowledged("importQuestionnaire",[{owner:"P2",field:"P2.questionnaires",code:"unsaved_draft"}]),
    acknowledged("importQuestionnaire",[{owner:"P2",field:"P2.questionnaires",code:"invalid_draft"}]),
    acknowledged("saveQuestionnaire",[{owner:"P2",field:"P2.languages",code:"missing_language_asset"}]),acknowledged("saveRecipe")];
  for(const value of cases)assert.doesNotThrow(()=>assertPublishedConsequence(value));
  const mutations=[r=>r.result.published=false,r=>r.result.effect.outcome="unknown",r=>r.result.effect.outcome="synthetic",
    r=>r.result.effect.operation="different",r=>r.result.effect.requestId="other",r=>r.result.effect.stage="dispatching",
    r=>r.result.effect.receipt=null,r=>r.status="rejected",r=>r.issues[0].code="projection_failed",r=>r.status="applied"];
  for(const mutate of mutations){const value=structuredClone(cases[0]);mutate(value.response);assert.throws(()=>assertPublishedConsequence(value));}
  const failedFinal=acknowledged("saveRecipe",[{owner:"P2",field:"P2.questionnaires",code:"unsaved_draft"}]);
  assert.throws(()=>assertPublishedConsequence(failedFinal));
  for(const operation of ["saveQuestionnaire","saveRecipe","confirmSegment"])
    assert.throws(()=>assertPublishedConsequence(acknowledged(operation,[{owner:"P2",field:"P2.questionnaires",code:"invalid_draft"}])));
});

test("mock readiness needs matching video identities and completed layout dependency projections",()=>{
  const response={status:"ok",result:{owners:{
    P1:{values:{"P1.media.ready":true,"P1.workspace.snapshot":{revision:8},"P1.media.catalogue":{entries:[{annotationId:"clip",assetId:"asset",geometry:{displayWidthPx:1920,displayHeightPx:1080}}]}},issues:[]},
    P3:{values:{"P3.videoAnnotations":["clip"]},issues:[]},
    P4:{values:{"P4.reference.candidates":{largestVideo:{assetId:"asset",width:1920,height:1080}},"P4.geometry":{},"P4.videoFits":[{id:"asset"}]},issues:[]},
    P6:{values:{"P6.enabled":false},issues:[]},
  }}};
  assert.equal(mockBindingsReady(response,{requireLayout:true}),true);
  for(const mutate of [o=>o.P1.values["P1.media.ready"]=false,o=>o.P3.values["P3.videoAnnotations"]=["old"],
    o=>o.P3.issues.push({code:"owner_busy"}),o=>o.P4.issues.push({code:"catalogue-pending"}),
    o=>o.P4.values["P4.reference.candidates"].largestVideo.width=1280,o=>o.P4.values["P4.videoFits"]=[],
    o=>o.P6.values["P6.enabled"]=true]) {
    const value=structuredClone(response);mutate(value.result.owners);assert.equal(mockBindingsReady(value,{requireLayout:true}),false);
  }
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
