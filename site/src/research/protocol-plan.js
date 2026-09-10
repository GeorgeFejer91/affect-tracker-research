import { canonicalJson, canonicalSha256 } from "./canonical.js";
import {
  RESEARCH_SETTINGS_SCHEMA,
  validateResearchSettingsV1,
  validateResolvedAssignmentPlanV1,
} from "./contracts.js";
import {
  validateQuestionnaireDefinitionV1,
  validateQuestionnaireModuleV1,
  verifyQuestionnaireDefinitionV1,
} from "./questionnaires.js";

export const RESEARCH_PROTOCOL_PLAN_SCHEMA = "affect-research-protocol-plan";
export const QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION = "questionnaire-hooks-v1";
export const QUESTIONNAIRE_PLACEMENTS = Object.freeze([
  "beforeSession",
  "afterSession",
  "beforeBlock",
  "afterBlock",
]);

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/u;
const PARTICIPANT_PATTERN = /^P\d{3,6}$/u;
const MAX_QUESTIONNAIRE_DEFINITIONS = 256;
const MAX_QUESTIONNAIRE_MODULES = 1_024;
const MAX_PROTOCOL_STEPS = 20_000;
const MAX_PARTICIPANTS = 100_000;

function isPlainObject(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, path, required) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object.`);
  const allowed = new Set(required);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${path} contains unknown field ${unknown}.`);
  const missing = required.find((key) => !Object.hasOwn(value, key));
  if (missing) throw new TypeError(`${path} is missing required field ${missing}.`);
  return value;
}

function identifier(value, path) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new TypeError(`${path} must be a canonical lowercase identifier.`);
  }
  return value;
}

function participantIdentifier(value, path) {
  if (typeof value !== "string" || !PARTICIPANT_PATTERN.test(value)
    || Number(value.slice(1)) < 1 || Number(value.slice(1)) > MAX_PARTICIPANTS) {
    throw new TypeError(`${path} must be a canonical participant identifier.`);
  }
  return value;
}

function sha256(value, path) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
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

function enumeration(value, path, values) {
  if (!values.includes(value)) {
    throw new TypeError(`${path} must be one of: ${values.join(", ")}.`);
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

function projectBaseSettingsV1(value) {
  exactObject(value, "ResearchSettingsV2", [
    "schema",
    "version",
    "experiment",
    "stimuli",
    "input",
    "visual",
    "advanced",
    "output",
    "questionnaires",
  ]);
  if (value.schema !== RESEARCH_SETTINGS_SCHEMA || value.version !== 2) {
    throw new TypeError("ResearchSettingsV2 has an unsupported schema or version.");
  }
  return validateResearchSettingsV1({
    schema: RESEARCH_SETTINGS_SCHEMA,
    version: 1,
    experiment: value.experiment,
    stimuli: value.stimuli,
    input: value.input,
    visual: value.visual,
    advanced: value.advanced,
    output: value.output,
  });
}

async function normalizeQuestionnaires(value, settingsV1) {
  exactObject(value, "ResearchSettingsV2.questionnaires", [
    "algorithmVersion",
    "definitions",
    "modules",
  ]);
  if (value.algorithmVersion !== QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION) {
    throw new TypeError("ResearchSettingsV2.questionnaires.algorithmVersion is unsupported.");
  }
  if (!Array.isArray(value.definitions)
    || value.definitions.length > MAX_QUESTIONNAIRE_DEFINITIONS) {
    throw new RangeError(
      `ResearchSettingsV2.questionnaires.definitions supports at most ${MAX_QUESTIONNAIRE_DEFINITIONS} definitions.`,
    );
  }
  if (!Array.isArray(value.modules) || value.modules.length > MAX_QUESTIONNAIRE_MODULES) {
    throw new RangeError(
      `ResearchSettingsV2.questionnaires.modules supports at most ${MAX_QUESTIONNAIRE_MODULES} modules.`,
    );
  }

  const definitions = [];
  for (let index = 0; index < value.definitions.length; index += 1) {
    const shaped = validateQuestionnaireDefinitionV1(value.definitions[index]);
    definitions.push(copy(await verifyQuestionnaireDefinitionV1(shaped)));
  }
  const definitionIds = new Set();
  const definitionHashes = new Set();
  for (const definition of definitions) {
    if (definitionIds.has(definition.questionnaireId)) {
      throw new TypeError(
        `ResearchSettingsV2.questionnaires contains duplicate definition ID ${definition.questionnaireId}.`,
      );
    }
    if (definitionHashes.has(definition.definitionSha256)) {
      throw new TypeError(
        `ResearchSettingsV2.questionnaires contains duplicate definition hash ${definition.definitionSha256}.`,
      );
    }
    definitionIds.add(definition.questionnaireId);
    definitionHashes.add(definition.definitionSha256);
  }

  const moduleIds = new Set();
  const definitionById = new Map(definitions.map((definition) => [
    definition.questionnaireId,
    definition,
  ]));
  const poolIds = settingsV1.stimuli.pools.map(({ poolId }) => poolId);
  const modules = value.modules.map((module) => {
    const shaped = validateQuestionnaireModuleV1(module, { poolIds });
    const definition = definitionById.get(shaped.questionnaireId);
    if (!definition) {
      throw new TypeError(`Questionnaire module ${shaped.moduleId} references an unknown definition.`);
    }
    return copy(validateQuestionnaireModuleV1(shaped, { poolIds, definition }));
  });
  for (const module of modules) {
    if (moduleIds.has(module.moduleId)) {
      throw new TypeError(
        `ResearchSettingsV2.questionnaires contains duplicate module ID ${module.moduleId}.`,
      );
    }
    moduleIds.add(module.moduleId);
  }

  return {
    algorithmVersion: QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION,
    definitions,
    modules,
  };
}

/**
 * Validate and normalize ResearchSettingsV2 without changing the historical
 * ResearchSettingsV1 contract. Module array order is protocol-significant.
 */
export async function validateResearchSettingsV2(value) {
  const settingsV1 = projectBaseSettingsV1(value);
  const questionnaires = await normalizeQuestionnaires(value.questionnaires, settingsV1);
  return deepFreeze({
    schema: RESEARCH_SETTINGS_SCHEMA,
    version: 2,
    experiment: copy(settingsV1.experiment),
    stimuli: copy(settingsV1.stimuli),
    input: copy(settingsV1.input),
    visual: copy(settingsV1.visual),
    advanced: copy(settingsV1.advanced),
    output: copy(settingsV1.output),
    questionnaires,
  });
}

function projectNormalizedSettingsV2ToV1(settingsV2) {
  return validateResearchSettingsV1({
    schema: RESEARCH_SETTINGS_SCHEMA,
    version: 1,
    experiment: copy(settingsV2.experiment),
    stimuli: copy(settingsV2.stimuli),
    input: copy(settingsV2.input),
    visual: copy(settingsV2.visual),
    advanced: copy(settingsV2.advanced),
    output: copy(settingsV2.output),
  });
}

/**
 * Explicitly project SettingsV2 to the unchanged SettingsV1 input consumed by
 * balanced-v1. Questionnaire content can never alter stimulus allocation.
 */
export async function projectResearchSettingsV2ToAssignmentSettingsV1(value) {
  return projectNormalizedSettingsV2ToV1(await validateResearchSettingsV2(value));
}

function appendQuestionnaireSteps(steps, modules, placement, poolId, blockPosition) {
  for (const module of modules) {
    if (module.placement.kind !== placement || module.placement.poolId !== poolId) continue;
    steps.push({
      protocolPosition: steps.length + 1,
      kind: "questionnaire",
      blockPosition,
      poolId,
      moduleId: module.moduleId,
      questionnaireId: module.questionnaireId,
      definitionSha256: module.definitionSha256,
      placement,
    });
  }
}

function buildProtocolPlanUnhashed(settingsV2, assignmentPlan, participantId) {
  const assignment = assignmentPlan.assignments.find((entry) => (
    entry.participantId === participantId
  ));
  if (!assignment) {
    throw new TypeError(`ResolvedAssignmentPlanV1 has no assignment for ${participantId}.`);
  }

  const steps = [];
  const modules = settingsV2.questionnaires.modules;
  appendQuestionnaireSteps(steps, modules, "beforeSession", null, null);

  const orderedStimulusPositions = [];
  assignment.conditionOrder.forEach((poolId, blockIndex) => {
    const blockPosition = blockIndex + 1;
    appendQuestionnaireSteps(steps, modules, "beforeBlock", poolId, blockPosition);
    const blockSlots = assignment.slots.filter((slot) => slot.poolId === poolId);
    if (!blockSlots.length) {
      throw new TypeError(`Assignment ${participantId} contains an empty block for ${poolId}.`);
    }
    for (const slot of blockSlots) {
      orderedStimulusPositions.push(slot.position);
      steps.push({
        protocolPosition: steps.length + 1,
        kind: "stimulus",
        blockPosition,
        poolId,
        stimulusPosition: slot.position,
        poolPosition: slot.poolPosition,
        stimulusId: slot.stimulusId,
      });
    }
    appendQuestionnaireSteps(steps, modules, "afterBlock", poolId, blockPosition);
  });

  const expectedStimulusPositions = orderedStimulusPositions.map((_, index) => index + 1);
  if (canonicalJson(orderedStimulusPositions) !== canonicalJson(expectedStimulusPositions)) {
    throw new TypeError(
      `Assignment ${participantId} slots do not form contiguous condition-order blocks.`,
    );
  }
  appendQuestionnaireSteps(steps, modules, "afterSession", null, null);

  return {
    schema: RESEARCH_PROTOCOL_PLAN_SCHEMA,
    version: 1,
    algorithmVersion: QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION,
    settingsSha256: null,
    assignmentPlanSha256: assignmentPlan.planHashSha256,
    participantId,
    conditionOrder: [...assignment.conditionOrder],
    steps,
  };
}

async function normalizeProtocolInputs(settingsValue, assignmentValue, participantId) {
  const settingsV2 = await validateResearchSettingsV2(settingsValue);
  const settingsV1 = projectNormalizedSettingsV2ToV1(settingsV2);
  const assignmentPlan = await validateResolvedAssignmentPlanV1(assignmentValue);
  const expectedAssignmentSettingsHash = await canonicalSha256(settingsV1);
  if (assignmentPlan.settingsSha256 !== expectedAssignmentSettingsHash) {
    throw new TypeError(
      "ResolvedAssignmentPlanV1 is not bound to the ResearchSettingsV2 assignment projection.",
    );
  }
  const normalizedParticipantId = participantIdentifier(
    participantId,
    "ResolvedProtocolPlanV1.participantId",
  );
  if (!assignmentPlan.participantIds.includes(normalizedParticipantId)) {
    throw new TypeError(`ResolvedAssignmentPlanV1 has no participant ${normalizedParticipantId}.`);
  }
  return {
    settingsV2,
    assignmentPlan,
    participantId: normalizedParticipantId,
    settingsSha256: await canonicalSha256(settingsV2),
  };
}

function validateQuestionnaireStep(step, path, conditionOrder) {
  exactObject(step, path, [
    "protocolPosition",
    "kind",
    "blockPosition",
    "poolId",
    "moduleId",
    "questionnaireId",
    "definitionSha256",
    "placement",
  ]);
  const placement = enumeration(step.placement, `${path}.placement`, QUESTIONNAIRE_PLACEMENTS);
  const sessionPlacement = placement === "beforeSession" || placement === "afterSession";
  let blockPosition = null;
  let poolId = null;
  if (sessionPlacement) {
    if (step.blockPosition !== null || step.poolId !== null) {
      throw new TypeError(`${path} session placement must have null blockPosition and poolId.`);
    }
  } else {
    blockPosition = integer(step.blockPosition, `${path}.blockPosition`, 1, conditionOrder.length);
    poolId = identifier(step.poolId, `${path}.poolId`);
    if (conditionOrder[blockPosition - 1] !== poolId) {
      throw new TypeError(`${path} block placement does not match conditionOrder.`);
    }
  }
  return {
    protocolPosition: integer(
      step.protocolPosition,
      `${path}.protocolPosition`,
      1,
      MAX_PROTOCOL_STEPS,
    ),
    kind: "questionnaire",
    blockPosition,
    poolId,
    moduleId: identifier(step.moduleId, `${path}.moduleId`),
    questionnaireId: identifier(step.questionnaireId, `${path}.questionnaireId`),
    definitionSha256: sha256(step.definitionSha256, `${path}.definitionSha256`),
    placement,
  };
}

function validateStimulusStep(step, path, conditionOrder) {
  exactObject(step, path, [
    "protocolPosition",
    "kind",
    "blockPosition",
    "poolId",
    "stimulusPosition",
    "poolPosition",
    "stimulusId",
  ]);
  const blockPosition = integer(
    step.blockPosition,
    `${path}.blockPosition`,
    1,
    conditionOrder.length,
  );
  const poolId = identifier(step.poolId, `${path}.poolId`);
  if (conditionOrder[blockPosition - 1] !== poolId) {
    throw new TypeError(`${path} stimulus block does not match conditionOrder.`);
  }
  return {
    protocolPosition: integer(
      step.protocolPosition,
      `${path}.protocolPosition`,
      1,
      MAX_PROTOCOL_STEPS,
    ),
    kind: "stimulus",
    blockPosition,
    poolId,
    stimulusPosition: integer(
      step.stimulusPosition,
      `${path}.stimulusPosition`,
      1,
      MAX_PROTOCOL_STEPS,
    ),
    poolPosition: integer(step.poolPosition, `${path}.poolPosition`, 1, MAX_PROTOCOL_STEPS),
    stimulusId: identifier(step.stimulusId, `${path}.stimulusId`),
  };
}

function assertProtocolStepOrder(steps, conditionOrder) {
  let cursor = 0;
  while (steps[cursor]?.kind === "questionnaire"
    && steps[cursor].placement === "beforeSession") cursor += 1;

  let expectedStimulusPosition = 1;
  const seenModuleIds = new Set();
  for (const step of steps) {
    if (step.kind === "questionnaire") {
      if (seenModuleIds.has(step.moduleId)) {
        throw new TypeError(`ResolvedProtocolPlanV1 repeats module ${step.moduleId}.`);
      }
      seenModuleIds.add(step.moduleId);
    }
  }

  for (let blockIndex = 0; blockIndex < conditionOrder.length; blockIndex += 1) {
    const blockPosition = blockIndex + 1;
    const poolId = conditionOrder[blockIndex];
    while (steps[cursor]?.kind === "questionnaire"
      && steps[cursor].placement === "beforeBlock") {
      if (steps[cursor].blockPosition !== blockPosition || steps[cursor].poolId !== poolId) {
        throw new TypeError("ResolvedProtocolPlanV1 has a questionnaire in the wrong block.");
      }
      cursor += 1;
    }

    let stimulusCount = 0;
    while (steps[cursor]?.kind === "stimulus") {
      const step = steps[cursor];
      if (step.blockPosition !== blockPosition || step.poolId !== poolId) break;
      if (step.stimulusPosition !== expectedStimulusPosition) {
        throw new TypeError(
          "ResolvedProtocolPlanV1 stimulusPosition values must retain contiguous assignment identity.",
        );
      }
      if (step.poolPosition !== stimulusCount + 1) {
        throw new TypeError(
          `ResolvedProtocolPlanV1 block ${poolId} has a non-contiguous poolPosition.`,
        );
      }
      expectedStimulusPosition += 1;
      stimulusCount += 1;
      cursor += 1;
    }
    if (!stimulusCount) {
      throw new TypeError(`ResolvedProtocolPlanV1 block ${poolId} contains no stimulus.`);
    }

    while (steps[cursor]?.kind === "questionnaire"
      && steps[cursor].placement === "afterBlock") {
      if (steps[cursor].blockPosition !== blockPosition || steps[cursor].poolId !== poolId) {
        throw new TypeError("ResolvedProtocolPlanV1 has a questionnaire in the wrong block.");
      }
      cursor += 1;
    }
  }

  while (steps[cursor]?.kind === "questionnaire"
    && steps[cursor].placement === "afterSession") cursor += 1;
  if (cursor !== steps.length) {
    throw new TypeError("ResolvedProtocolPlanV1 steps do not follow session and block hook order.");
  }
}

function validateProtocolPlanShape(value) {
  exactObject(value, "ResolvedProtocolPlanV1", [
    "schema",
    "version",
    "algorithmVersion",
    "settingsSha256",
    "assignmentPlanSha256",
    "participantId",
    "conditionOrder",
    "steps",
    "protocolPlanHashSha256",
  ]);
  if (value.schema !== RESEARCH_PROTOCOL_PLAN_SCHEMA || value.version !== 1) {
    throw new TypeError("ResolvedProtocolPlanV1 has an unsupported schema or version.");
  }
  if (value.algorithmVersion !== QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION) {
    throw new TypeError("ResolvedProtocolPlanV1 has an unsupported algorithm version.");
  }
  if (!Array.isArray(value.conditionOrder)
    || value.conditionOrder.length < 1
    || value.conditionOrder.length > 256) {
    throw new RangeError("ResolvedProtocolPlanV1 conditionOrder must contain 1–256 pools.");
  }
  const conditionOrder = value.conditionOrder.map((poolId, index) => (
    identifier(poolId, `ResolvedProtocolPlanV1.conditionOrder[${index}]`)
  ));
  if (new Set(conditionOrder).size !== conditionOrder.length) {
    throw new TypeError("ResolvedProtocolPlanV1 conditionOrder contains duplicate pools.");
  }
  if (!Array.isArray(value.steps)
    || value.steps.length < 1
    || value.steps.length > MAX_PROTOCOL_STEPS) {
    throw new RangeError(
      `ResolvedProtocolPlanV1 steps must contain 1–${MAX_PROTOCOL_STEPS} entries.`,
    );
  }
  const steps = value.steps.map((step, index) => {
    if (!isPlainObject(step)) {
      throw new TypeError(`ResolvedProtocolPlanV1.steps[${index}] must be an object.`);
    }
    const path = `ResolvedProtocolPlanV1.steps[${index}]`;
    let normalized;
    if (step.kind === "questionnaire") {
      normalized = validateQuestionnaireStep(step, path, conditionOrder);
    } else if (step.kind === "stimulus") {
      normalized = validateStimulusStep(step, path, conditionOrder);
    } else {
      throw new TypeError(`${path}.kind must be questionnaire or stimulus.`);
    }
    if (normalized.protocolPosition !== index + 1) {
      throw new TypeError("ResolvedProtocolPlanV1 protocolPosition values must be contiguous and one-based.");
    }
    return normalized;
  });
  const stimulusIds = steps
    .filter(({ kind }) => kind === "stimulus")
    .map(({ stimulusId }) => stimulusId);
  if (new Set(stimulusIds).size !== stimulusIds.length) {
    throw new TypeError("ResolvedProtocolPlanV1 repeats a participant stimulus.");
  }
  assertProtocolStepOrder(steps, conditionOrder);
  return {
    schema: RESEARCH_PROTOCOL_PLAN_SCHEMA,
    version: 1,
    algorithmVersion: QUESTIONNAIRE_HOOKS_ALGORITHM_VERSION,
    settingsSha256: sha256(value.settingsSha256, "ResolvedProtocolPlanV1.settingsSha256"),
    assignmentPlanSha256: sha256(
      value.assignmentPlanSha256,
      "ResolvedProtocolPlanV1.assignmentPlanSha256",
    ),
    participantId: participantIdentifier(
      value.participantId,
      "ResolvedProtocolPlanV1.participantId",
    ),
    conditionOrder,
    steps,
    protocolPlanHashSha256: sha256(
      value.protocolPlanHashSha256,
      "ResolvedProtocolPlanV1.protocolPlanHashSha256",
    ),
  };
}

/**
 * Validate plan structure and self-hash. When bindings are supplied, also
 * prove exact correspondence to the normalized SettingsV2 and AssignmentPlanV1.
 */
export async function validateResolvedProtocolPlanV1(value, bindings = undefined) {
  const output = validateProtocolPlanShape(value);
  const observedHash = await canonicalSha256(output, {
    omitRootKeys: ["protocolPlanHashSha256"],
  });
  if (observedHash !== output.protocolPlanHashSha256) {
    throw new TypeError("ResolvedProtocolPlanV1 protocol hash does not match its canonical content.");
  }

  if (bindings !== undefined) {
    exactObject(bindings, "ResolvedProtocolPlanV1 bindings", [
      "settingsV2",
      "assignmentPlanV1",
    ]);
    const normalized = await normalizeProtocolInputs(
      bindings.settingsV2,
      bindings.assignmentPlanV1,
      output.participantId,
    );
    const expected = buildProtocolPlanUnhashed(
      normalized.settingsV2,
      normalized.assignmentPlan,
      normalized.participantId,
    );
    expected.settingsSha256 = normalized.settingsSha256;
    const actualUnhashed = copy(output);
    delete actualUnhashed.protocolPlanHashSha256;
    if (canonicalJson(actualUnhashed) !== canonicalJson(expected)) {
      throw new TypeError(
        "ResolvedProtocolPlanV1 does not match its bound settings, assignment, participant, or module order.",
      );
    }
  }
  return deepFreeze(output);
}

/** Resolve one participant's exact questionnaire/stimulus execution sequence. */
export async function resolveProtocolPlanV1(settingsValue, assignmentValue, participantId) {
  const normalized = await normalizeProtocolInputs(
    settingsValue,
    assignmentValue,
    participantId,
  );
  const unhashed = buildProtocolPlanUnhashed(
    normalized.settingsV2,
    normalized.assignmentPlan,
    normalized.participantId,
  );
  unhashed.settingsSha256 = normalized.settingsSha256;
  const plan = {
    ...unhashed,
    protocolPlanHashSha256: await canonicalSha256(unhashed),
  };
  return validateResolvedProtocolPlanV1(plan);
}
