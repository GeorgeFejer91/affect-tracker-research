import { canonicalJson, canonicalSha256 } from "./canonical.js";
import {
  RESEARCH_SETTINGS_SCHEMA,
  validateResearchSettingsV1,
  validateStimulusV1,
} from "./contracts.js";
import {
  assertExperimentPlanMatchesDefinition,
  validateExperimentDefinitionV1,
  validateResolvedExperimentPlanV1,
} from "./external-experiment.js";
import {
  validateQuestionnaireModuleV2,
  verifyQuestionnaireDefinitionV1,
} from "./questionnaires.js";

export const QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION = "questionnaire-hooks-v2";
export const EXTERNAL_PROTOCOL_ALGORITHM_VERSION = "external-order-v1";
export const EXTERNAL_QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION = "external-questionnaire-hooks-v1";
export const RESEARCH_PROTOCOL_PLAN_SCHEMA = "affect-research-protocol-plan";

const QUESTIONNAIRE_PLACEMENTS = Object.freeze([
  "beforeSession",
  "afterSession",
  "beforeBlock",
  "afterBlock",
  "afterStimulus",
]);
const MAX_PROTOCOL_STEPS = 40_000;
const MAX_QUESTIONNAIRE_DEFINITIONS = 256;
const MAX_QUESTIONNAIRE_MODULES = 1_024;
const IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,127}$/u;
const PARTICIPANT_IDENTIFIER = /^P(?=\d{3,6}$)(?!0+$)\d+$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, path, required) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object.`);
  const requiredSet = new Set(required);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${path} is missing field ${key}.`);
  }
  for (const key of Object.keys(value)) {
    if (!requiredSet.has(key)) throw new TypeError(`${path} has unknown field ${key}.`);
  }
}

function identifier(value, path) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new TypeError(`${path} must be a lowercase canonical identifier.`);
  }
  return value;
}

function participantIdentifier(value, path) {
  if (typeof value !== "string" || !PARTICIPANT_IDENTIFIER.test(value)) {
    throw new TypeError(`${path} must be a canonical participant identifier.`);
  }
  return value;
}

function sha256(value, path) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function integer(value, path, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${path} must be an integer within ${minimum}–${maximum}.`);
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function copy(value) {
  return structuredClone(value);
}

function normalizedCommonSettings(value) {
  exactObject(value.experiment, "ResearchSettingsV3.experiment", [
    "id",
    "title",
    "participantCount",
    "samplingFrequencyHz",
  ]);
  return validateResearchSettingsV1({
    schema: RESEARCH_SETTINGS_SCHEMA,
    version: 1,
    experiment: {
      ...copy(value.experiment),
      betweenVideos: { mode: "fixed", durationMs: 0 },
    },
    stimuli: {
      allocationAlgorithm: "balanced-v1",
      conditionOrder: "williams",
      seed: "00000000000000000000000000000000",
      items: [],
      pools: [],
    },
    input: copy(value.input),
    visual: copy(value.visual),
    advanced: copy(value.advanced),
    output: copy(value.output),
  });
}

async function normalizeQuestionnaires(value, definition) {
  exactObject(value, "ResearchSettingsV3.questionnaires", [
    "algorithmVersion",
    "definitions",
    "modules",
  ]);
  if (value.algorithmVersion !== QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION) {
    throw new TypeError("ResearchSettingsV3.questionnaires.algorithmVersion is unsupported.");
  }
  if (!Array.isArray(value.definitions)
    || value.definitions.length > MAX_QUESTIONNAIRE_DEFINITIONS) {
    throw new RangeError(
      `ResearchSettingsV3.questionnaires.definitions supports at most ${MAX_QUESTIONNAIRE_DEFINITIONS} definitions.`,
    );
  }
  if (!Array.isArray(value.modules) || value.modules.length > MAX_QUESTIONNAIRE_MODULES) {
    throw new RangeError(
      `ResearchSettingsV3.questionnaires.modules supports at most ${MAX_QUESTIONNAIRE_MODULES} modules.`,
    );
  }

  const definitions = [];
  for (const candidate of value.definitions) {
    definitions.push(copy(await verifyQuestionnaireDefinitionV1(candidate)));
  }
  const definitionIds = new Set();
  const definitionHashes = new Set();
  for (const candidate of definitions) {
    if (definitionIds.has(candidate.questionnaireId)) {
      throw new TypeError(
        `ResearchSettingsV3.questionnaires repeats definition ID ${candidate.questionnaireId}.`,
      );
    }
    if (definitionHashes.has(candidate.definitionSha256)) {
      throw new TypeError(
        `ResearchSettingsV3.questionnaires repeats definition hash ${candidate.definitionSha256}.`,
      );
    }
    definitionIds.add(candidate.questionnaireId);
    definitionHashes.add(candidate.definitionSha256);
  }
  const definitionById = new Map(definitions.map((candidate) => [
    candidate.questionnaireId,
    candidate,
  ]));
  const blockIds = definition.blocks.map(({ blockId }) => blockId);
  const stimulusIds = definition.stimuli.map(({ stimulusId }) => stimulusId);
  const modules = value.modules.map((candidate) => {
    const normalized = validateQuestionnaireModuleV2(candidate, { blockIds, stimulusIds });
    const boundDefinition = definitionById.get(normalized.questionnaireId);
    if (!boundDefinition) {
      throw new TypeError(
        `Questionnaire module ${normalized.moduleId} references an unknown definition.`,
      );
    }
    return copy(validateQuestionnaireModuleV2(normalized, {
      blockIds,
      stimulusIds,
      definition: boundDefinition,
    }));
  });
  if (new Set(modules.map(({ moduleId }) => moduleId)).size !== modules.length) {
    throw new TypeError("ResearchSettingsV3.questionnaires contains duplicate module IDs.");
  }
  return {
    algorithmVersion: QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
    definitions,
    modules,
  };
}

export { validateQuestionnaireModuleV2 };

function assertDefinitionBindings(experiment, items, definition) {
  if (experiment.id !== definition.experimentId || experiment.title !== definition.title) {
    throw new TypeError("ResearchSettingsV3 experiment identity does not match experiment.json.");
  }
  if (experiment.participantCount !== definition.schedules.length) {
    throw new TypeError("ResearchSettingsV3 participant count does not match experiment.json.");
  }
  if (items.length !== definition.stimuli.length) {
    throw new TypeError("ResearchSettingsV3 stimuli do not match the experiment.json registry.");
  }
  const itemsById = new Map(items.map((item) => [item.stimulusId, item]));
  if (itemsById.size !== items.length) {
    throw new TypeError("ResearchSettingsV3 contains duplicate stimulus IDs.");
  }
  for (const reference of definition.stimuli) {
    const item = itemsById.get(reference.stimulusId);
    if (!item || item.title !== reference.title
      || item.source.kind !== "workspaceFile"
      || item.source.relativePath !== reference.relativePath) {
      throw new TypeError(
        `ResearchSettingsV3 stimulus ${reference.stimulusId} does not bind its experiment.json workspace path and title.`,
      );
    }
  }
}

/** Strict settings contract for externally ordered video protocols. */
export async function validateResearchSettingsV3(value) {
  exactObject(value, "ResearchSettingsV3", [
    "schema",
    "version",
    "experiment",
    "stimuli",
    "input",
    "visual",
    "advanced",
    "output",
    "questionnaires",
    "externalProtocol",
  ]);
  if (value.schema !== RESEARCH_SETTINGS_SCHEMA || value.version !== 3) {
    throw new TypeError("ResearchSettingsV3 has an unsupported schema or version.");
  }
  exactObject(value.stimuli, "ResearchSettingsV3.stimuli", ["items"]);
  exactObject(value.externalProtocol, "ResearchSettingsV3.externalProtocol", [
    "algorithmVersion",
    "sourceByteSha256",
    "definitionSha256",
    "definition",
  ]);
  if (value.externalProtocol.algorithmVersion !== EXTERNAL_PROTOCOL_ALGORITHM_VERSION) {
    throw new TypeError("ResearchSettingsV3.externalProtocol.algorithmVersion is unsupported.");
  }

  const common = normalizedCommonSettings(value);
  const definition = copy(await validateExperimentDefinitionV1(
    value.externalProtocol.definition,
  ));
  const observedDefinitionSha256 = await canonicalSha256(definition);
  const definitionSha256 = sha256(
    value.externalProtocol.definitionSha256,
    "ResearchSettingsV3.externalProtocol.definitionSha256",
  );
  if (definitionSha256 !== observedDefinitionSha256) {
    throw new TypeError(
      "ResearchSettingsV3.externalProtocol.definitionSha256 does not match experiment.json.",
    );
  }
  const items = value.stimuli.items.map((candidate, index) => copy(validateStimulusV1(
    candidate,
    `ResearchSettingsV3.stimuli.items[${index}]`,
  ))).sort((left, right) => (
    left.stimulusId < right.stimulusId ? -1 : left.stimulusId > right.stimulusId ? 1 : 0
  ));
  assertDefinitionBindings(common.experiment, items, definition);
  const questionnaires = await normalizeQuestionnaires(value.questionnaires, definition);

  return deepFreeze({
    schema: RESEARCH_SETTINGS_SCHEMA,
    version: 3,
    experiment: {
      id: common.experiment.id,
      title: common.experiment.title,
      participantCount: common.experiment.participantCount,
      samplingFrequencyHz: common.experiment.samplingFrequencyHz,
    },
    stimuli: { items },
    input: copy(common.input),
    visual: copy(common.visual),
    advanced: copy(common.advanced),
    output: copy(common.output),
    questionnaires,
    externalProtocol: {
      algorithmVersion: EXTERNAL_PROTOCOL_ALGORITHM_VERSION,
      sourceByteSha256: sha256(
        value.externalProtocol.sourceByteSha256,
        "ResearchSettingsV3.externalProtocol.sourceByteSha256",
      ),
      definitionSha256,
      definition,
    },
  });
}

/**
 * Apply fields supported by the explicit portable-settings importer to an
 * already selected external experiment. Experiment identity, authored order,
 * ISIs, and questionnaire hooks remain owned by the V3 base document.
 */
export async function applyLegacySettingsV1ToResearchSettingsV3(legacyValue, baseValue) {
  const legacy = validateResearchSettingsV1(legacyValue);
  const base = await validateResearchSettingsV3(baseValue);
  return validateResearchSettingsV3({
    ...copy(base),
    experiment: {
      ...copy(base.experiment),
      samplingFrequencyHz: legacy.experiment.samplingFrequencyHz,
    },
    input: copy(legacy.input),
    visual: copy(legacy.visual),
    advanced: copy(legacy.advanced),
    output: copy(legacy.output),
  });
}

function appendQuestionnaireSteps(steps, modules, placement, blockId, blockPosition) {
  for (const module of modules) {
    if (module.placement.kind !== placement || module.placement.blockId !== blockId) continue;
    steps.push({
      protocolPosition: steps.length + 1,
      kind: "questionnaire",
      blockPosition,
      blockId,
      moduleId: module.moduleId,
      questionnaireId: module.questionnaireId,
      definitionSha256: module.definitionSha256,
      placement,
    });
  }
}

function appendStimulusQuestionnaireSteps(steps, modules, slot, blockPosition, relativeToIsi) {
  for (const module of modules) {
    if (module.placement.kind !== "afterStimulus"
      || module.placement.stimulusId !== slot.stimulusId
      || module.placement.relativeToIsi !== relativeToIsi) continue;
    steps.push({
      protocolPosition: steps.length + 1,
      kind: "questionnaire",
      stimulusPosition: slot.position,
      blockPosition,
      blockId: slot.blockId,
      blockStimulusPosition: slot.poolPosition,
      stimulusId: slot.stimulusId,
      moduleId: module.moduleId,
      questionnaireId: module.questionnaireId,
      definitionSha256: module.definitionSha256,
      placement: "afterStimulus",
      relativeToIsi,
    });
  }
}

function buildProtocolPlanUnhashed(settings, experimentPlan, participantId) {
  const assignment = experimentPlan.assignments.find((candidate) => (
    candidate.participantId === participantId
  ));
  if (!assignment) {
    throw new TypeError(`ResolvedExperimentPlanV1 has no assignment for ${participantId}.`);
  }
  const modules = settings.questionnaires.modules;
  const steps = [];
  appendQuestionnaireSteps(steps, modules, "beforeSession", null, null);
  for (const blockId of assignment.blockOrder) {
    const blockPosition = assignment.blockOrder.indexOf(blockId) + 1;
    appendQuestionnaireSteps(steps, modules, "beforeBlock", blockId, blockPosition);
    const slots = assignment.slots.filter((slot) => slot.blockId === blockId);
    if (slots.length === 0) {
      throw new TypeError(`ResolvedExperimentPlanV1 assignment has empty block ${blockId}.`);
    }
    for (const slot of slots) {
      const shared = {
        stimulusPosition: slot.position,
        blockPosition,
        blockId,
        blockStimulusPosition: slot.poolPosition,
        stimulusId: slot.stimulusId,
      };
      steps.push({
        protocolPosition: steps.length + 1,
        kind: "stimulus",
        ...shared,
      });
      appendStimulusQuestionnaireSteps(steps, modules, slot, blockPosition, "before");
      steps.push({
        protocolPosition: steps.length + 1,
        kind: "interval",
        ...shared,
        durationMs: slot.isiAfterMs,
      });
      appendStimulusQuestionnaireSteps(steps, modules, slot, blockPosition, "after");
    }
    appendQuestionnaireSteps(steps, modules, "afterBlock", blockId, blockPosition);
  }
  appendQuestionnaireSteps(steps, modules, "afterSession", null, null);
  return {
    schema: RESEARCH_PROTOCOL_PLAN_SCHEMA,
    version: 2,
    algorithmVersion: EXTERNAL_QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION,
    settingsSha256: null,
    assignmentPlanSha256: experimentPlan.planHashSha256,
    participantId,
    blockOrder: [...assignment.blockOrder],
    steps,
  };
}

function validateQuestionnaireStep(step, path, blockOrder) {
  const commonFields = [
    "protocolPosition",
    "kind",
    "blockPosition",
    "blockId",
    "moduleId",
    "questionnaireId",
    "definitionSha256",
    "placement",
  ];
  const stimulusPlacement = step.placement === "afterStimulus";
  exactObject(step, path, stimulusPlacement ? [
    ...commonFields,
    "stimulusPosition",
    "blockStimulusPosition",
    "stimulusId",
    "relativeToIsi",
  ] : commonFields);
  if (step.kind !== "questionnaire") throw new TypeError(`${path}.kind is invalid.`);
  if (!QUESTIONNAIRE_PLACEMENTS.includes(step.placement)) {
    throw new TypeError(`${path}.placement is invalid.`);
  }
  const sessionPlacement = step.placement === "beforeSession" || step.placement === "afterSession";
  let blockPosition = null;
  let blockId = null;
  if (sessionPlacement) {
    if (step.blockPosition !== null || step.blockId !== null) {
      throw new TypeError(`${path} session questionnaire must have null block identity.`);
    }
  } else {
    blockPosition = integer(step.blockPosition, `${path}.blockPosition`, 1, blockOrder.length);
    blockId = identifier(step.blockId, `${path}.blockId`);
    if (blockOrder[blockPosition - 1] !== blockId) {
      throw new TypeError(`${path} questionnaire block does not match blockOrder.`);
    }
  }
  const normalized = {
    protocolPosition: integer(step.protocolPosition, `${path}.protocolPosition`, 1, MAX_PROTOCOL_STEPS),
    kind: "questionnaire",
    blockPosition,
    blockId,
    moduleId: identifier(step.moduleId, `${path}.moduleId`),
    questionnaireId: identifier(step.questionnaireId, `${path}.questionnaireId`),
    definitionSha256: sha256(step.definitionSha256, `${path}.definitionSha256`),
    placement: step.placement,
  };
  if (stimulusPlacement) {
    normalized.stimulusPosition = integer(
      step.stimulusPosition,
      `${path}.stimulusPosition`,
      1,
      MAX_PROTOCOL_STEPS,
    );
    normalized.blockStimulusPosition = integer(
      step.blockStimulusPosition,
      `${path}.blockStimulusPosition`,
      1,
      MAX_PROTOCOL_STEPS,
    );
    normalized.stimulusId = identifier(step.stimulusId, `${path}.stimulusId`);
    if (!["before", "after"].includes(step.relativeToIsi)) {
      throw new TypeError(`${path}.relativeToIsi must be before or after.`);
    }
    normalized.relativeToIsi = step.relativeToIsi;
  }
  return normalized;
}

function validateMediaStep(step, path, blockOrder, kind) {
  const fields = [
    "protocolPosition",
    "kind",
    "stimulusPosition",
    "blockPosition",
    "blockId",
    "blockStimulusPosition",
    "stimulusId",
  ];
  if (kind === "interval") fields.push("durationMs");
  exactObject(step, path, fields);
  if (step.kind !== kind) throw new TypeError(`${path}.kind is invalid.`);
  const blockPosition = integer(step.blockPosition, `${path}.blockPosition`, 1, blockOrder.length);
  const blockId = identifier(step.blockId, `${path}.blockId`);
  if (blockOrder[blockPosition - 1] !== blockId) {
    throw new TypeError(`${path} block does not match blockOrder.`);
  }
  return {
    protocolPosition: integer(step.protocolPosition, `${path}.protocolPosition`, 1, MAX_PROTOCOL_STEPS),
    kind,
    stimulusPosition: integer(step.stimulusPosition, `${path}.stimulusPosition`, 1, MAX_PROTOCOL_STEPS),
    blockPosition,
    blockId,
    blockStimulusPosition: integer(
      step.blockStimulusPosition,
      `${path}.blockStimulusPosition`,
      1,
      MAX_PROTOCOL_STEPS,
    ),
    stimulusId: identifier(step.stimulusId, `${path}.stimulusId`),
    ...(kind === "interval" ? {
      durationMs: integer(step.durationMs, `${path}.durationMs`, 0, 3_600_000),
    } : {}),
  };
}

function assertPlanStepOrder(steps, blockOrder) {
  let cursor = 0;
  while (steps[cursor]?.kind === "questionnaire"
    && steps[cursor].placement === "beforeSession") cursor += 1;
  const seenModules = new Set();
  let expectedStimulusPosition = 1;
  for (const step of steps) {
    if (step.kind !== "questionnaire") continue;
    if (seenModules.has(step.moduleId)) {
      throw new TypeError(`ResolvedProtocolPlanV2 repeats questionnaire module ${step.moduleId}.`);
    }
    seenModules.add(step.moduleId);
  }

  for (let blockIndex = 0; blockIndex < blockOrder.length; blockIndex += 1) {
    const blockId = blockOrder[blockIndex];
    const blockPosition = blockIndex + 1;
    while (steps[cursor]?.kind === "questionnaire"
      && steps[cursor].placement === "beforeBlock") {
      if (steps[cursor].blockId !== blockId || steps[cursor].blockPosition !== blockPosition) {
        throw new TypeError("ResolvedProtocolPlanV2 has a questionnaire in the wrong block.");
      }
      cursor += 1;
    }
    let blockStimulusPosition = 1;
    while (steps[cursor]?.kind === "stimulus") {
      const stimulus = steps[cursor];
      if (stimulus.blockId !== blockId || stimulus.blockPosition !== blockPosition) break;
      if (stimulus.stimulusPosition !== expectedStimulusPosition
        || stimulus.blockStimulusPosition !== blockStimulusPosition) {
        throw new TypeError("ResolvedProtocolPlanV2 stimulus positions are not contiguous.");
      }
      cursor += 1;
      while (steps[cursor]?.kind === "questionnaire"
        && steps[cursor].placement === "afterStimulus"
        && steps[cursor].relativeToIsi === "before") {
        const questionnaire = steps[cursor];
        for (const field of [
          "stimulusPosition", "blockPosition", "blockId", "blockStimulusPosition", "stimulusId",
        ]) {
          if (questionnaire[field] !== stimulus[field]) {
            throw new TypeError("ResolvedProtocolPlanV2 post-video questionnaire does not bind its stimulus.");
          }
        }
        cursor += 1;
      }
      const interval = steps[cursor];
      if (!interval || interval.kind !== "interval") {
        throw new TypeError("ResolvedProtocolPlanV2 requires one interval after every stimulus.");
      }
      for (const field of [
        "stimulusPosition",
        "blockPosition",
        "blockId",
        "blockStimulusPosition",
        "stimulusId",
      ]) {
        if (interval[field] !== stimulus[field]) {
          throw new TypeError("ResolvedProtocolPlanV2 interval does not bind its preceding stimulus.");
        }
      }
      cursor += 1;
      while (steps[cursor]?.kind === "questionnaire"
        && steps[cursor].placement === "afterStimulus"
        && steps[cursor].relativeToIsi === "after") {
        const questionnaire = steps[cursor];
        for (const field of [
          "stimulusPosition", "blockPosition", "blockId", "blockStimulusPosition", "stimulusId",
        ]) {
          if (questionnaire[field] !== stimulus[field]) {
            throw new TypeError("ResolvedProtocolPlanV2 post-ISI questionnaire does not bind its stimulus.");
          }
        }
        cursor += 1;
      }
      expectedStimulusPosition += 1;
      blockStimulusPosition += 1;
    }
    if (blockStimulusPosition === 1) {
      throw new TypeError(`ResolvedProtocolPlanV2 block ${blockId} contains no stimulus.`);
    }
    while (steps[cursor]?.kind === "questionnaire"
      && steps[cursor].placement === "afterBlock") {
      if (steps[cursor].blockId !== blockId || steps[cursor].blockPosition !== blockPosition) {
        throw new TypeError("ResolvedProtocolPlanV2 has a questionnaire in the wrong block.");
      }
      cursor += 1;
    }
  }
  while (steps[cursor]?.kind === "questionnaire"
    && steps[cursor].placement === "afterSession") cursor += 1;
  if (cursor !== steps.length) {
    throw new TypeError("ResolvedProtocolPlanV2 steps do not follow session and block hook order.");
  }
}

function validateProtocolPlanShape(value) {
  exactObject(value, "ResolvedProtocolPlanV2", [
    "schema",
    "version",
    "algorithmVersion",
    "settingsSha256",
    "assignmentPlanSha256",
    "participantId",
    "blockOrder",
    "steps",
    "protocolPlanHashSha256",
  ]);
  if (value.schema !== RESEARCH_PROTOCOL_PLAN_SCHEMA || value.version !== 2) {
    throw new TypeError("ResolvedProtocolPlanV2 has an unsupported schema or version.");
  }
  if (value.algorithmVersion !== EXTERNAL_QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION) {
    throw new TypeError("ResolvedProtocolPlanV2 has an unsupported algorithm version.");
  }
  if (!Array.isArray(value.blockOrder) || value.blockOrder.length < 1
    || value.blockOrder.length > 256) {
    throw new RangeError("ResolvedProtocolPlanV2.blockOrder must contain 1–256 blocks.");
  }
  const blockOrder = value.blockOrder.map((blockId, index) => (
    identifier(blockId, `ResolvedProtocolPlanV2.blockOrder[${index}]`)
  ));
  if (new Set(blockOrder).size !== blockOrder.length) {
    throw new TypeError("ResolvedProtocolPlanV2.blockOrder contains duplicate blocks.");
  }
  if (!Array.isArray(value.steps) || value.steps.length < 2
    || value.steps.length > MAX_PROTOCOL_STEPS) {
    throw new RangeError(
      `ResolvedProtocolPlanV2.steps must contain 2–${MAX_PROTOCOL_STEPS} entries.`,
    );
  }
  const steps = value.steps.map((step, index) => {
    if (!isPlainObject(step)) {
      throw new TypeError(`ResolvedProtocolPlanV2.steps[${index}] must be an object.`);
    }
    const path = `ResolvedProtocolPlanV2.steps[${index}]`;
    let normalized;
    if (step.kind === "questionnaire") {
      normalized = validateQuestionnaireStep(step, path, blockOrder);
    } else if (step.kind === "stimulus" || step.kind === "interval") {
      normalized = validateMediaStep(step, path, blockOrder, step.kind);
    } else {
      throw new TypeError(`${path}.kind must be questionnaire, stimulus, or interval.`);
    }
    if (normalized.protocolPosition !== index + 1) {
      throw new TypeError(
        "ResolvedProtocolPlanV2 protocolPosition values must be contiguous and one-based.",
      );
    }
    return normalized;
  });
  assertPlanStepOrder(steps, blockOrder);
  return {
    schema: RESEARCH_PROTOCOL_PLAN_SCHEMA,
    version: 2,
    algorithmVersion: EXTERNAL_QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION,
    settingsSha256: sha256(value.settingsSha256, "ResolvedProtocolPlanV2.settingsSha256"),
    assignmentPlanSha256: sha256(
      value.assignmentPlanSha256,
      "ResolvedProtocolPlanV2.assignmentPlanSha256",
    ),
    participantId: participantIdentifier(
      value.participantId,
      "ResolvedProtocolPlanV2.participantId",
    ),
    blockOrder,
    steps,
    protocolPlanHashSha256: sha256(
      value.protocolPlanHashSha256,
      "ResolvedProtocolPlanV2.protocolPlanHashSha256",
    ),
  };
}

async function normalizeProtocolInputs(settingsValue, experimentPlanValue, participantId) {
  const settings = await validateResearchSettingsV3(settingsValue);
  const experimentPlan = await validateResolvedExperimentPlanV1(experimentPlanValue);
  const normalizedParticipantId = participantIdentifier(
    participantId,
    "ResolvedProtocolPlanV2.participantId",
  );
  const settingsSha256 = await canonicalSha256(settings);
  if (!experimentPlan.participantIds.includes(normalizedParticipantId)) {
    throw new TypeError(`ResolvedExperimentPlanV1 has no participant ${normalizedParticipantId}.`);
  }
  if (experimentPlan.settingsSha256 !== settingsSha256
    || experimentPlan.sourceByteSha256 !== settings.externalProtocol.sourceByteSha256
    || experimentPlan.definitionSha256 !== settings.externalProtocol.definitionSha256
    || experimentPlan.experimentId !== settings.experiment.id
    || experimentPlan.title !== settings.experiment.title
    || experimentPlan.participantIds.length !== settings.experiment.participantCount) {
    throw new TypeError("ResolvedExperimentPlanV1 does not bind the selected experiment.json.");
  }
  assertExperimentPlanMatchesDefinition(experimentPlan, settings.externalProtocol.definition);
  const settingsItems = new Map(settings.stimuli.items.map((stimulus) => [
    stimulus.stimulusId,
    stimulus,
  ]));
  if (experimentPlan.stimuli.length !== settingsItems.size
    || experimentPlan.stimuli.some((stimulus) => (
      canonicalJson(stimulus) !== canonicalJson(settingsItems.get(stimulus.stimulusId))
    ))) {
    throw new TypeError("ResolvedExperimentPlanV1 stimuli do not match ResearchSettingsV3.");
  }
  return { settings, experimentPlan, participantId: normalizedParticipantId, settingsSha256 };
}

/** Validate a self-hashed Protocol Plan V2 and optionally its exact frozen inputs. */
export async function validateResolvedProtocolPlanV2(value, bindings = undefined) {
  const output = validateProtocolPlanShape(value);
  const observedHash = await canonicalSha256(output, {
    omitRootKeys: ["protocolPlanHashSha256"],
  });
  if (observedHash !== output.protocolPlanHashSha256) {
    throw new TypeError("ResolvedProtocolPlanV2 protocol hash does not match its canonical content.");
  }
  if (bindings !== undefined) {
    exactObject(bindings, "ResolvedProtocolPlanV2 bindings", [
      "settingsV3",
      "resolvedExperimentPlanV1",
    ]);
    const normalized = await normalizeProtocolInputs(
      bindings.settingsV3,
      bindings.resolvedExperimentPlanV1,
      output.participantId,
    );
    const expected = buildProtocolPlanUnhashed(
      normalized.settings,
      normalized.experimentPlan,
      normalized.participantId,
    );
    expected.settingsSha256 = normalized.settingsSha256;
    const actual = copy(output);
    delete actual.protocolPlanHashSha256;
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      throw new TypeError(
        "ResolvedProtocolPlanV2 does not match its bound settings, experiment plan, participant, or module order.",
      );
    }
  }
  return deepFreeze(output);
}

/** Resolve one participant's exact externally ordered video, interval, and questionnaire plan. */
export async function resolveProtocolPlanV2(settingsValue, experimentPlanValue, participantId) {
  const normalized = await normalizeProtocolInputs(
    settingsValue,
    experimentPlanValue,
    participantId,
  );
  const unhashed = buildProtocolPlanUnhashed(
    normalized.settings,
    normalized.experimentPlan,
    normalized.participantId,
  );
  unhashed.settingsSha256 = normalized.settingsSha256;
  const plan = {
    ...unhashed,
    protocolPlanHashSha256: await canonicalSha256(unhashed),
  };
  return validateResolvedProtocolPlanV2(plan);
}
