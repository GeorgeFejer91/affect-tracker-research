import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { canonicalSha256 } from "../site/src/research/canonical.js";
import { createDefaultResearchSettings } from "../site/src/research/contracts.js";
import {
  EXTERNAL_ORDER_ALGORITHM_VERSION,
  assertExperimentPlanMatchesDefinition,
  parseExperimentDefinitionV1,
  resolveExternalExperimentPlanV1,
  validateExperimentDefinitionV1,
  validateResolvedExperimentPlanV1,
} from "../site/src/research/external-experiment.js";
import {
  applyLegacySettingsV1ToResearchSettingsV3,
  EXTERNAL_QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION,
  QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
  resolveProtocolPlanV2,
  validateResearchSettingsV3,
  validateResolvedProtocolPlanV2,
} from "../site/src/research/external-protocol.js";

const templateUrl = new URL("../site/experiment-template.json", import.meta.url);
const digest = (value) => createHash("sha256").update(value).digest("hex");

function verifiedStimulus(reference, index) {
  return {
    stimulusId: `catalogue-${index + 1}`,
    title: `Catalogue ${index + 1}`,
    source: {
      kind: "workspaceFile",
      relativePath: reference.relativePath,
      mimeType: "video/mp4",
      sha256: digest(reference.relativePath),
      byteLength: 1_000 + index,
      durationMs: 10_000 + index,
    },
  };
}

async function fixture() {
  const source = await readFile(templateUrl);
  const parsed = await parseExperimentDefinitionV1(source);
  const defaults = createDefaultResearchSettings();
  const items = parsed.definition.stimuli.map(verifiedStimulus).map((item, index) => ({
    stimulusId: parsed.definition.stimuli[index].stimulusId,
    title: parsed.definition.stimuli[index].title,
    source: item.source,
  }));
  const settings = await validateResearchSettingsV3({
    schema: defaults.schema,
    version: 3,
    experiment: {
      id: parsed.definition.experimentId,
      title: parsed.definition.title,
      participantCount: parsed.definition.schedules.length,
      samplingFrequencyHz: 130,
    },
    stimuli: { items },
    input: defaults.input,
    visual: defaults.visual,
    advanced: defaults.advanced,
    output: defaults.output,
    questionnaires: {
      algorithmVersion: QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
      definitions: [],
      modules: [],
    },
    externalProtocol: {
      algorithmVersion: EXTERNAL_ORDER_ALGORITHM_VERSION,
      sourceByteSha256: parsed.sourceByteSha256,
      definitionSha256: parsed.definitionSha256,
      definition: parsed.definition,
    },
  });
  const settingsSha256 = await canonicalSha256(settings);
  const plan = await resolveExternalExperimentPlanV1(
    parsed,
    parsed.definition.stimuli.map(verifiedStimulus),
    settingsSha256,
  );
  return { source, parsed, settings, settingsSha256, plan };
}

test("experiment.json preserves exact participant, block, video, and ISI order", async () => {
  const { source, parsed, plan, settingsSha256 } = await fixture();
  assert.equal(parsed.sourceByteSha256, digest(source));
  assert.equal(parsed.sourceText, source.toString("utf8"));
  assert.equal(parsed.definitionSha256, await canonicalSha256(parsed.definition));
  assert.deepEqual(plan.participantIds, ["P001", "P002"]);
  assert.deepEqual(plan.assignments[0].slots.map(({ stimulusId, isiAfterMs }) => [stimulusId, isiAfterMs]), [
    ["calm-01", 3_000],
    ["active-01", 0],
  ]);
  assert.deepEqual(plan.assignments[1].slots.map(({ stimulusId, isiAfterMs }) => [stimulusId, isiAfterMs]), [
    ["active-01", 3_000],
    ["calm-01", 0],
  ]);
  assert.equal(plan.settingsSha256, settingsSha256);
  assert.equal(plan.algorithmVersion, "external-order-v1");
  assert.equal(assertExperimentPlanMatchesDefinition(plan, parsed.definition), true);
  assert.deepEqual(await validateResolvedExperimentPlanV1(plan), plan);
});

test("experiment.json rejects unknown fields, duplicate keys, unsafe paths, repeats, and invalid ISI", async () => {
  const { parsed } = await fixture();
  assert.throws(() => validateExperimentDefinitionV1({ ...parsed.definition, seed: "not-allowed" }), /unknown field seed/u);
  const duplicate = Buffer.from('{"schema":"affect-research-experiment","schema":"affect-research-experiment"}');
  await assert.rejects(parseExperimentDefinitionV1(duplicate), /Duplicate JSON key/u);

  const unsafe = structuredClone(parsed.definition);
  unsafe.stimuli[0].relativePath = "../calm.mp4";
  assert.throws(() => validateExperimentDefinitionV1(unsafe), /beneath stimuli/u);

  const reserved = structuredClone(parsed.definition);
  reserved.stimuli[0].relativePath = "stimuli/CON.mp4";
  assert.throws(() => validateExperimentDefinitionV1(reserved), /safe path/u);

  for (const unsafePath of [
    "stimuli/%4eUL.mp4",
    "stimuli/video%3aone.mp4",
    "stimuli/video\u007fone.mp4",
    "stimuli/video%7fone.mp4",
    "stimuli/%252e%252e/escape.mp4",
    "stimuli/Cafe\u0301.mp4",
  ]) {
    const encoded = structuredClone(parsed.definition);
    encoded.stimuli[0].relativePath = unsafePath;
    assert.throws(
      () => validateExperimentDefinitionV1(encoded),
      /safe path|encoded unsafe path|NFC-normalized/u,
      unsafePath,
    );
  }

  const repeated = structuredClone(parsed.definition);
  repeated.schedules[0].blocks[0].videos[1].stimulusId = "calm-01";
  assert.throws(() => validateExperimentDefinitionV1(repeated), /repeats stimulus/u);

  const invalidIsi = structuredClone(parsed.definition);
  invalidIsi.schedules[0].blocks[0].videos[0].isiAfterMs = 3.5;
  assert.throws(() => validateExperimentDefinitionV1(invalidIsi), /integer/u);
});

test("four-digit participant IDs remain canonical through external protocol resolution", async () => {
  const participantCount = 1_000;
  const definition = {
    schema: "affect-research-experiment",
    version: 1,
    experimentId: "large-participant-study",
    title: "Large participant study",
    stimuli: [{ stimulusId: "only-video", title: "Only video", relativePath: "stimuli/only.mp4" }],
    blocks: [{ blockId: "main", label: "Main" }],
    schedules: Array.from({ length: participantCount }, (_, index) => ({
      participantId: `P${String(index + 1).padStart(4, "0")}`,
      blocks: [{
        blockId: "main",
        videos: [{ stimulusId: "only-video", isiAfterMs: 0 }],
      }],
    })),
  };
  const parsed = await parseExperimentDefinitionV1(
    new TextEncoder().encode(JSON.stringify(definition)),
  );
  const defaults = createDefaultResearchSettings();
  const item = {
    stimulusId: "only-video",
    title: "Only video",
    source: {
      kind: "workspaceFile",
      relativePath: "stimuli/only.mp4",
      mimeType: "video/mp4",
      sha256: digest("only-video"),
      byteLength: 1_024,
      durationMs: 2_000,
    },
  };
  const settings = await validateResearchSettingsV3({
    schema: defaults.schema,
    version: 3,
    experiment: {
      id: definition.experimentId,
      title: definition.title,
      participantCount,
      samplingFrequencyHz: 130,
    },
    stimuli: { items: [item] },
    input: defaults.input,
    visual: defaults.visual,
    advanced: defaults.advanced,
    output: defaults.output,
    questionnaires: {
      algorithmVersion: QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
      definitions: [],
      modules: [],
    },
    externalProtocol: {
      algorithmVersion: EXTERNAL_ORDER_ALGORITHM_VERSION,
      sourceByteSha256: parsed.sourceByteSha256,
      definitionSha256: parsed.definitionSha256,
      definition: parsed.definition,
    },
  });
  const plan = await resolveExternalExperimentPlanV1(
    parsed,
    [item],
    await canonicalSha256(settings),
  );
  const protocol = await resolveProtocolPlanV2(settings, plan, "P0001");
  assert.equal(protocol.participantId, "P0001");
  assert.equal(protocol.steps[0].stimulusId, "only-video");
});

test("explicit legacy settings import preserves external order authority", async () => {
  const { settings } = await fixture();
  const legacy = structuredClone(createDefaultResearchSettings());
  legacy.experiment.samplingFrequencyHz = 77;
  legacy.input.stepSize = 0.25;
  const merged = await applyLegacySettingsV1ToResearchSettingsV3(legacy, settings);
  assert.equal(merged.version, 3);
  assert.equal(merged.experiment.id, settings.experiment.id);
  assert.equal(merged.experiment.participantCount, settings.experiment.participantCount);
  assert.equal(merged.experiment.samplingFrequencyHz, 77);
  assert.equal(merged.input.stepSize, 0.25);
  assert.deepEqual(merged.externalProtocol, settings.externalProtocol);
});

test("workspace resolution fails closed for missing, ambiguous, or unverified paths", async () => {
  const { parsed, settingsSha256 } = await fixture();
  await assert.rejects(
    resolveExternalExperimentPlanV1(
      { ...parsed, sourceText: `${parsed.sourceText}\n` },
      parsed.definition.stimuli.map(verifiedStimulus),
      settingsSha256,
    ),
    /source bytes no longer match/u,
  );
  await assert.rejects(
    resolveExternalExperimentPlanV1(parsed, [], settingsSha256),
    /exactly one verified workspace video/u,
  );
  const first = verifiedStimulus(parsed.definition.stimuli[0], 0);
  await assert.rejects(
    resolveExternalExperimentPlanV1(parsed, [first, structuredClone(first)], settingsSha256),
    /exactly one verified workspace video/u,
  );
});

test("ProtocolPlanV2 inserts every authored interval before block and session hooks", async () => {
  const { settings, plan } = await fixture();
  const protocol = await resolveProtocolPlanV2(settings, plan, "P001");
  assert.equal(protocol.algorithmVersion, EXTERNAL_QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION);
  assert.deepEqual(protocol.steps.map((step) => (
    step.kind === "interval" ? [step.kind, step.stimulusId, step.durationMs] : [step.kind, step.stimulusId]
  )), [
    ["stimulus", "calm-01"],
    ["interval", "calm-01", 3_000],
    ["stimulus", "active-01"],
    ["interval", "active-01", 0],
  ]);
  assert.deepEqual(await validateResolvedProtocolPlanV2(protocol, {
    settingsV3: settings,
    resolvedExperimentPlanV1: plan,
  }), protocol);

  const changed = structuredClone(protocol);
  changed.steps[1].durationMs = 2_999;
  await assert.rejects(validateResolvedProtocolPlanV2(changed), /protocol hash/u);
});
