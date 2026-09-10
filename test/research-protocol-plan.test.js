import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { canonicalSha256 } from "../site/src/research/canonical.js";
import { createDefaultResearchSettings } from "../site/src/research/contracts.js";
import { resolveAssignmentPlan } from "../site/src/research/counterbalancer.js";
import {
  QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION,
  RESEARCH_PROTOCOL_PLAN_SCHEMA,
  projectResearchSettingsV2ToAssignmentSettingsV1,
  resolveProtocolPlanV1,
  validateResearchSettingsV2,
  validateResolvedProtocolPlanV1,
} from "../site/src/research/protocol-plan.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");

function stimulus(id) {
  return {
    stimulusId: id,
    title: `Stimulus ${id}`,
    source: {
      kind: "workspaceFile",
      relativePath: `stimuli/${id}.mp4`,
      mimeType: "video/mp4",
      sha256: digest(id),
      byteLength: 1_000,
      durationMs: 30_000,
    },
  };
}

async function questionnaireDefinition(questionnaireId) {
  const definition = {
    schema: "affect-research-questionnaire-definition",
    version: 1,
    questionnaireId,
    questionnaireVersion: "1.0",
    title: `Questionnaire ${questionnaireId}`,
    language: "en",
    instructions: "Choose one response for each item.",
    attribution: "Project-authored protocol-plan test fixture.",
    source: {
      kind: "researcherCsv",
      logicalName: `${questionnaireId}.csv`,
      sourceDocumentSha256: null,
      formatVersion: "questionnaire-csv-v1",
      byteLength: 128,
      sha256: digest(`source:${questionnaireId}`),
    },
    items: [{
      itemId: "item-01",
      order: 1,
      prompt: "How do you feel?",
      required: true,
      subscale: null,
      options: [
        { optionId: "low", order: 1, label: "Low", scoreValue: 0 },
        { optionId: "high", order: 2, label: "High", scoreValue: 1 },
      ],
    }],
    definitionSha256: "0".repeat(64),
  };
  definition.definitionSha256 = await canonicalSha256(definition, {
    omitRootKeys: ["definitionSha256"],
  });
  return definition;
}

function module(moduleId, definition, kind, poolId = null) {
  return {
    schema: "affect-research-questionnaire-module",
    version: 1,
    moduleId,
    questionnaireId: definition.questionnaireId,
    definitionSha256: definition.definitionSha256,
    placement: { kind, poolId },
  };
}

async function settingsV2({ method = "williams", modules = [] } = {}) {
  const first = await questionnaireDefinition("check-in");
  const second = await questionnaireDefinition("reflection");
  const settings = structuredClone(createDefaultResearchSettings());
  settings.version = 2;
  settings.experiment.participantCount = 4;
  settings.stimuli.conditionOrder = method;
  settings.stimuli.items = [
    stimulus("a-01"),
    stimulus("a-02"),
    stimulus("b-01"),
    stimulus("b-02"),
  ];
  settings.stimuli.pools = [
    {
      poolId: "pool-a",
      label: "Pool A",
      videosPerParticipant: 1,
      stimulusIds: ["a-01", "a-02"],
    },
    {
      poolId: "pool-b",
      label: "Pool B",
      videosPerParticipant: 1,
      stimulusIds: ["b-01", "b-02"],
    },
  ];
  settings.questionnaires = {
    algorithmVersion: QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION,
    definitions: [first, second],
    modules: modules.map((entry) => entry(first, second)),
  };
  return settings;
}

async function resolveFor(settings, participantId = "P001") {
  const projected = await projectResearchSettingsV2ToAssignmentSettingsV1(settings);
  const assignmentPlan = await resolveAssignmentPlan(projected);
  const protocolPlan = await resolveProtocolPlanV1(settings, assignmentPlan, participantId);
  return { projected, assignmentPlan, protocolPlan };
}

async function rehashProtocolPlan(plan) {
  plan.protocolPlanHashSha256 = await canonicalSha256(plan, {
    omitRootKeys: ["protocolPlanHashSha256"],
  });
  return plan;
}

test("ResearchSettingsV2 explicitly projects to unchanged assignment SettingsV1", async () => {
  const settings = await settingsV2();
  const normalized = await validateResearchSettingsV2(settings);
  const projected = await projectResearchSettingsV2ToAssignmentSettingsV1(settings);

  assert.equal(normalized.schema, "affect-research-settings");
  assert.equal(normalized.version, 2);
  assert.equal(normalized.questionnaires.algorithmVersion, "questionnaire-hooks-v1");
  assert.equal(projected.version, 1);
  assert.equal("questionnaires" in projected, false);
  assert.deepEqual(projected.stimuli, normalized.stimuli);
});

test("absent questionnaires preserve the participant stimulus assignment and order", async () => {
  const settings = await settingsV2();
  settings.questionnaires.definitions = [];
  const { assignmentPlan, protocolPlan } = await resolveFor(settings);
  const assignment = assignmentPlan.assignments[0];
  const stimulusSteps = protocolPlan.steps.filter(({ kind }) => kind === "stimulus");

  assert.equal(protocolPlan.schema, RESEARCH_PROTOCOL_PLAN_SCHEMA);
  assert.deepEqual(protocolPlan.conditionOrder, assignment.conditionOrder);
  assert.deepEqual(
    stimulusSteps.map(({ stimulusPosition, poolId, poolPosition, stimulusId }) => ({
      position: stimulusPosition,
      poolId,
      poolPosition,
      stimulusId,
    })),
    assignment.slots,
  );
  assert.equal(protocolPlan.steps.some(({ kind }) => kind === "questionnaire"), false);
});

test("session and block hooks wrap one ordered block per assignment pool", async () => {
  const settings = await settingsV2({
    modules: [
      (first) => module("session-before", first, "beforeSession"),
      (first) => module("pool-a-before", first, "beforeBlock", "pool-a"),
      (_, second) => module("pool-a-after", second, "afterBlock", "pool-a"),
      (_, second) => module("pool-b-before", second, "beforeBlock", "pool-b"),
      (first) => module("pool-b-after", first, "afterBlock", "pool-b"),
      (_, second) => module("session-after", second, "afterSession"),
    ],
  });
  const { protocolPlan } = await resolveFor(settings);

  assert.deepEqual(protocolPlan.steps.map((step) => (
    step.kind === "questionnaire"
      ? `${step.placement}:${step.poolId ?? "session"}:${step.moduleId}`
      : `stimulus:${step.poolId}:${step.stimulusPosition}`
  )), [
    "beforeSession:session:session-before",
    "beforeBlock:pool-a:pool-a-before",
    "stimulus:pool-a:1",
    "afterBlock:pool-a:pool-a-after",
    "beforeBlock:pool-b:pool-b-before",
    "stimulus:pool-b:2",
    "afterBlock:pool-b:pool-b-after",
    "afterSession:session:session-after",
  ]);
  assert.deepEqual(
    protocolPlan.steps.map(({ protocolPosition }) => protocolPosition),
    Array.from({ length: protocolPlan.steps.length }, (_, index) => index + 1),
  );
});

test("multiple modules on the same hook retain their declared order", async () => {
  const settings = await settingsV2({
    modules: [
      (_, second) => module("before-second", second, "beforeSession"),
      (first) => module("before-first", first, "beforeSession"),
      (first) => module("block-third", first, "beforeBlock", "pool-a"),
      (_, second) => module("block-fourth", second, "beforeBlock", "pool-a"),
      (first) => module("after-second", first, "afterSession"),
      (_, second) => module("after-first", second, "afterSession"),
    ],
  });
  const { protocolPlan } = await resolveFor(settings);
  assert.deepEqual(
    protocolPlan.steps
      .filter(({ kind }) => kind === "questionnaire")
      .map(({ moduleId }) => moduleId),
    [
      "before-second",
      "before-first",
      "block-third",
      "block-fourth",
      "after-second",
      "after-first",
    ],
  );
});

test("protocol resolution and canonical hash are deterministic", async () => {
  const settings = await settingsV2({
    modules: [(first) => module("session-before", first, "beforeSession")],
  });
  const projected = await projectResearchSettingsV2ToAssignmentSettingsV1(settings);
  const assignmentPlan = await resolveAssignmentPlan(projected);
  const first = await resolveProtocolPlanV1(settings, assignmentPlan, "P003");
  const repeated = await resolveProtocolPlanV1(
    structuredClone(settings),
    structuredClone(assignmentPlan),
    "P003",
  );

  assert.deepEqual(repeated, first);
  assert.deepEqual(await validateResolvedProtocolPlanV1(structuredClone(first)), first);
  assert.deepEqual(await validateResolvedProtocolPlanV1(structuredClone(first), {
    settingsV2: settings,
    assignmentPlanV1: assignmentPlan,
  }), first);
});

test("Williams and cyclic participant sequences retain exact assignment positions", async () => {
  for (const method of ["williams", "cyclic"]) {
    const settings = await settingsV2({ method });
    const { assignmentPlan, protocolPlan } = await resolveFor(settings, "P002");
    const assignment = assignmentPlan.assignments[1];
    assert.deepEqual(protocolPlan.conditionOrder, assignment.conditionOrder, method);
    assert.deepEqual(
      protocolPlan.steps
        .filter(({ kind }) => kind === "stimulus")
        .map(({ stimulusPosition, poolId, poolPosition, stimulusId }) => ({
          position: stimulusPosition,
          poolId,
          poolPosition,
          stimulusId,
        })),
      assignment.slots,
      method,
    );
  }
});

test("settings reject invalid definition hashes, placements, references, and unknown fields", async () => {
  const unknown = await settingsV2();
  unknown.questionnaires.surprise = true;
  await assert.rejects(validateResearchSettingsV2(unknown), /unknown field surprise/);

  const badHash = await settingsV2();
  badHash.questionnaires.definitions[0].definitionSha256 = "0".repeat(64);
  await assert.rejects(validateResearchSettingsV2(badHash), /sha256|hash/i);

  const unknownPool = await settingsV2({
    modules: [(first) => module("unknown-pool", first, "beforeBlock", "pool-z")],
  });
  await assert.rejects(validateResearchSettingsV2(unknownPool), /unknown pool pool-z/);

  const unknownDefinition = await settingsV2({
    modules: [(first) => ({
      ...module("unknown-definition", first, "beforeSession"),
      questionnaireId: "missing",
    })],
  });
  await assert.rejects(validateResearchSettingsV2(unknownDefinition), /unknown definition/);
});

test("plan validation rejects unknown fields, invalid hook placement, and hash drift", async () => {
  const settings = await settingsV2({
    modules: [(first) => module("session-before", first, "beforeSession")],
  });
  const { protocolPlan } = await resolveFor(settings);

  const unknownRoot = { ...structuredClone(protocolPlan), surprise: true };
  await assert.rejects(validateResolvedProtocolPlanV1(unknownRoot), /unknown field surprise/);

  const unknownStep = structuredClone(protocolPlan);
  unknownStep.steps[0].surprise = true;
  await assert.rejects(validateResolvedProtocolPlanV1(unknownStep), /unknown field surprise/);

  const invalidPlacement = structuredClone(protocolPlan);
  invalidPlacement.steps[0].placement = "beforeBlock";
  await rehashProtocolPlan(invalidPlacement);
  await assert.rejects(validateResolvedProtocolPlanV1(invalidPlacement), /blockPosition/);

  const badHash = structuredClone(protocolPlan);
  badHash.protocolPlanHashSha256 = "0".repeat(64);
  await assert.rejects(validateResolvedProtocolPlanV1(badHash), /protocol hash does not match/);
});

test("protocol plan participant and step bounds match the shared Research contract", async () => {
  const settings = await settingsV2({
    modules: [(first) => module("session-before", first, "beforeSession")],
  });
  const { protocolPlan } = await resolveFor(settings);

  const upperParticipant = structuredClone(protocolPlan);
  upperParticipant.participantId = "P100000";
  await rehashProtocolPlan(upperParticipant);
  await assert.doesNotReject(validateResolvedProtocolPlanV1(upperParticipant));

  for (const participantId of ["P000000", "P100001"]) {
    const outsideParticipantRange = structuredClone(protocolPlan);
    outsideParticipantRange.participantId = participantId;
    await assert.rejects(
      validateResolvedProtocolPlanV1(outsideParticipantRange),
      /canonical participant identifier/u,
    );
  }

  const tooManySteps = structuredClone(protocolPlan);
  tooManySteps.steps = Array.from({ length: 20_001 }, () => structuredClone(protocolPlan.steps[0]));
  await assert.rejects(
    validateResolvedProtocolPlanV1(tooManySteps),
    /1–20000 entries/u,
  );
});

test("bound validation detects same-hook reordering even with a valid self-hash", async () => {
  const settings = await settingsV2({
    modules: [
      (first) => module("declared-first", first, "beforeSession"),
      (_, second) => module("declared-second", second, "beforeSession"),
    ],
  });
  const { assignmentPlan, protocolPlan } = await resolveFor(settings);
  const reordered = structuredClone(protocolPlan);
  [reordered.steps[0], reordered.steps[1]] = [reordered.steps[1], reordered.steps[0]];
  reordered.steps[0].protocolPosition = 1;
  reordered.steps[1].protocolPosition = 2;
  await rehashProtocolPlan(reordered);

  await assert.doesNotReject(validateResolvedProtocolPlanV1(reordered));
  await assert.rejects(validateResolvedProtocolPlanV1(reordered, {
    settingsV2: settings,
    assignmentPlanV1: assignmentPlan,
  }), /does not match its bound settings/);
});

test("bound validation rejects substituted settings and assignment digests", async () => {
  const settings = await settingsV2();
  const { assignmentPlan, protocolPlan } = await resolveFor(settings);

  for (const field of ["settingsSha256", "assignmentPlanSha256"]) {
    const substituted = structuredClone(protocolPlan);
    substituted[field] = "f".repeat(64);
    await rehashProtocolPlan(substituted);
    await assert.doesNotReject(validateResolvedProtocolPlanV1(substituted));
    await assert.rejects(validateResolvedProtocolPlanV1(substituted, {
      settingsV2: settings,
      assignmentPlanV1: assignmentPlan,
    }), /does not match its bound settings/);
  }
});
