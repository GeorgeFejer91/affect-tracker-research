import { canonicalJson, canonicalSha256, sha256Hex } from "./canonical.js";
import { validateStimulusV1 } from "./contracts.js";

export const EXPERIMENT_DEFINITION_SCHEMA = "affect-research-experiment";
export const RESOLVED_EXPERIMENT_PLAN_SCHEMA = "affect-research-experiment-plan";
export const EXTERNAL_ORDER_ALGORITHM_VERSION = "external-order-v1";
export const MAX_EXPERIMENT_DEFINITION_BYTES = 5 * 1024 * 1024;

const ID = /^[a-z0-9][a-z0-9_-]{0,127}$/u;
const PARTICIPANT = /^P\d{3,6}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const WINDOWS_RESERVED_COMPONENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const MAX_PARTICIPANTS = 100_000;
const MAX_STIMULI = 10_000;
const MAX_BLOCKS = 256;
const MAX_STEPS_PER_PARTICIPANT = 20_000;
const MAX_ISI_MS = 3_600_000;

function isPlainObject(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, path, fields) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object.`);
  const allowed = new Set(fields);
  const missing = fields.find((field) => !Object.hasOwn(value, field));
  if (missing) throw new TypeError(`${path} is missing required field ${missing}.`);
  const unknown = Object.keys(value).find((field) => !allowed.has(field));
  if (unknown) throw new TypeError(`${path} contains unknown field ${unknown}.`);
  return value;
}

function identifier(value, path) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new TypeError(`${path} must be a lowercase identifier using letters, numbers, _ or -.`);
  }
  return value;
}

function text(value, path, maximum = 200) {
  if (typeof value !== "string") throw new TypeError(`${path} must be text.`);
  const normalized = value.normalize("NFC").trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new TypeError(`${path} must contain 1–${maximum} printable characters.`);
  }
  return normalized;
}

function integer(value, path, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${path} must be an integer within ${minimum}–${maximum}.`);
  }
  return value;
}

function hash(value, path) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
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

function unsafeStimulusPath(value) {
  if (typeof value !== "string" || value.includes("\\") || value.startsWith("/")
    || /^[A-Za-z]:/u.test(value) || value.length > 1_024) return true;
  const parts = value.split("/");
  return parts.length < 2 || parts.length > 32 || parts[0] !== "stimuli"
    || parts.some((part) => !part || part === "." || part === ".."
      || /[<>:"|?*\u0000-\u001f\u007f]/u.test(part) || /[ .]$/u.test(part)
      || WINDOWS_RESERVED_COMPONENT.test(part));
}

function safeStimulusPath(value, path) {
  if (unsafeStimulusPath(value)) {
    throw new TypeError(`${path} must be a safe path beneath stimuli/.`);
  }
  if (value.normalize("NFC") !== value) {
    throw new TypeError(`${path} must use NFC-normalized path components.`);
  }
  let decoded = value;
  for (let pass = 0; pass < 4; pass += 1) {
    let next;
    try { next = decodeURIComponent(decoded); } catch {
      throw new TypeError(`${path} contains invalid percent encoding.`);
    }
    if (next === decoded) break;
    if (unsafeStimulusPath(next)) {
      throw new TypeError(`${path} contains an encoded unsafe path.`);
    }
    decoded = next;
  }
  return value;
}

function participantIdFor(index, count) {
  const width = Math.max(3, String(count).length);
  return `P${String(index + 1).padStart(width, "0")}`;
}

function normalizeDefinition(value) {
  exactObject(value, "ExperimentDefinitionV1", [
    "schema", "version", "experimentId", "title", "stimuli", "blocks", "schedules",
  ]);
  if (value.schema !== EXPERIMENT_DEFINITION_SCHEMA || value.version !== 1) {
    throw new TypeError("ExperimentDefinitionV1 has an unsupported schema or version.");
  }
  if (!Array.isArray(value.stimuli) || value.stimuli.length < 1
    || value.stimuli.length > MAX_STIMULI) {
    throw new RangeError(`ExperimentDefinitionV1.stimuli must contain 1–${MAX_STIMULI} entries.`);
  }
  if (!Array.isArray(value.blocks) || value.blocks.length < 1 || value.blocks.length > MAX_BLOCKS) {
    throw new RangeError(`ExperimentDefinitionV1.blocks must contain 1–${MAX_BLOCKS} entries.`);
  }
  if (!Array.isArray(value.schedules) || value.schedules.length < 1
    || value.schedules.length > MAX_PARTICIPANTS) {
    throw new RangeError(`ExperimentDefinitionV1.schedules must contain 1–${MAX_PARTICIPANTS} entries.`);
  }

  const stimuli = value.stimuli.map((candidate, index) => {
    const path = `ExperimentDefinitionV1.stimuli[${index}]`;
    exactObject(candidate, path, ["stimulusId", "title", "relativePath"]);
    return {
      stimulusId: identifier(candidate.stimulusId, `${path}.stimulusId`),
      title: text(candidate.title, `${path}.title`),
      relativePath: safeStimulusPath(candidate.relativePath, `${path}.relativePath`),
    };
  });
  if (new Set(stimuli.map(({ stimulusId }) => stimulusId)).size !== stimuli.length) {
    throw new TypeError("ExperimentDefinitionV1.stimuli contains duplicate stimulus IDs.");
  }
  if (new Set(stimuli.map(({ relativePath }) => relativePath)).size !== stimuli.length) {
    throw new TypeError("ExperimentDefinitionV1.stimuli contains duplicate workspace paths.");
  }

  const blocks = value.blocks.map((candidate, index) => {
    const path = `ExperimentDefinitionV1.blocks[${index}]`;
    exactObject(candidate, path, ["blockId", "label"]);
    return {
      blockId: identifier(candidate.blockId, `${path}.blockId`),
      label: text(candidate.label, `${path}.label`),
    };
  });
  const blockIds = blocks.map(({ blockId }) => blockId);
  if (new Set(blockIds).size !== blocks.length) {
    throw new TypeError("ExperimentDefinitionV1.blocks contains duplicate block IDs.");
  }
  const stimulusIds = new Set(stimuli.map(({ stimulusId }) => stimulusId));
  const referencedStimuli = new Set();
  const schedules = value.schedules.map((candidate, scheduleIndex) => {
    const path = `ExperimentDefinitionV1.schedules[${scheduleIndex}]`;
    exactObject(candidate, path, ["participantId", "blocks"]);
    const participantId = candidate.participantId;
    if (typeof participantId !== "string" || !PARTICIPANT.test(participantId)
      || participantId !== participantIdFor(scheduleIndex, value.schedules.length)) {
      throw new TypeError(`${path}.participantId must be ${participantIdFor(scheduleIndex, value.schedules.length)}.`);
    }
    if (!Array.isArray(candidate.blocks) || candidate.blocks.length !== blocks.length) {
      throw new TypeError(`${path}.blocks must contain every declared block exactly once.`);
    }
    let stepCount = 0;
    const participantStimuli = new Set();
    const scheduleBlocks = candidate.blocks.map((block, blockIndex) => {
      const blockPath = `${path}.blocks[${blockIndex}]`;
      exactObject(block, blockPath, ["blockId", "videos"]);
      const blockId = identifier(block.blockId, `${blockPath}.blockId`);
      if (!blockIds.includes(blockId)) throw new TypeError(`${blockPath}.blockId is not declared.`);
      if (!Array.isArray(block.videos) || block.videos.length < 1) {
        throw new TypeError(`${blockPath}.videos must contain at least one video.`);
      }
      stepCount += block.videos.length;
      if (stepCount > MAX_STEPS_PER_PARTICIPANT) {
        throw new RangeError(`${path} exceeds ${MAX_STEPS_PER_PARTICIPANT} videos.`);
      }
      const videos = block.videos.map((video, videoIndex) => {
        const videoPath = `${blockPath}.videos[${videoIndex}]`;
        exactObject(video, videoPath, ["stimulusId", "isiAfterMs"]);
        const stimulusId = identifier(video.stimulusId, `${videoPath}.stimulusId`);
        if (!stimulusIds.has(stimulusId)) throw new TypeError(`${videoPath}.stimulusId is not declared.`);
        if (participantStimuli.has(stimulusId)) {
          throw new TypeError(`${path} repeats stimulus ${stimulusId}; v1 requires unique videos per participant.`);
        }
        participantStimuli.add(stimulusId);
        referencedStimuli.add(stimulusId);
        return {
          stimulusId,
          isiAfterMs: integer(video.isiAfterMs, `${videoPath}.isiAfterMs`, 0, MAX_ISI_MS),
        };
      });
      return { blockId, videos };
    });
    if (new Set(scheduleBlocks.map(({ blockId }) => blockId)).size !== blockIds.length) {
      throw new TypeError(`${path}.blocks must contain every declared block exactly once.`);
    }
    return { participantId, blocks: scheduleBlocks };
  });
  const unused = [...stimulusIds].filter((stimulusId) => !referencedStimuli.has(stimulusId));
  if (unused.length) {
    throw new TypeError(`ExperimentDefinitionV1 declares unused stimuli: ${unused.join(", ")}.`);
  }
  return {
    schema: EXPERIMENT_DEFINITION_SCHEMA,
    version: 1,
    experimentId: identifier(value.experimentId, "ExperimentDefinitionV1.experimentId"),
    title: text(value.title, "ExperimentDefinitionV1.title"),
    stimuli,
    blocks,
    schedules,
  };
}

/** Validate and freeze a normalized externally authored experiment document. */
export function validateExperimentDefinitionV1(value) {
  return deepFreeze(normalizeDefinition(structuredClone(value)));
}

// JSON.parse silently accepts duplicate keys. This scanner validates the JSON
// grammar and rejects duplicate keys before the ordinary parser is allowed to run.
export function parseStrictJsonDocument(text) {
  let index = 0;
  const whitespace = /[\u0009\u000a\u000d\u0020]/u;
  const skip = () => { while (index < text.length && whitespace.test(text[index])) index += 1; };
  const syntax = (message) => { throw new SyntaxError(`${message} at character ${index}.`); };
  const stringToken = () => {
    if (text[index] !== '"') syntax("Expected a JSON string");
    const start = index++;
    while (index < text.length) {
      const character = text[index];
      if (character === '"') {
        index += 1;
        try { return JSON.parse(text.slice(start, index)); } catch { syntax("Invalid JSON string"); }
      }
      if (character === "\\") {
        index += 1;
        if (index >= text.length) syntax("Unterminated JSON escape");
        if (text[index] === "u") {
          if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(index + 1, index + 5))) syntax("Invalid Unicode escape");
          index += 4;
        } else if (!/["\\/bfnrt]/u.test(text[index])) syntax("Invalid JSON escape");
      } else if (character.charCodeAt(0) <= 0x1f) syntax("Unescaped control character");
      index += 1;
    }
    syntax("Unterminated JSON string");
  };
  const valueToken = () => {
    skip();
    if (text[index] === "{") {
      index += 1;
      skip();
      const keys = new Set();
      if (text[index] === "}") { index += 1; return; }
      while (index < text.length) {
        skip();
        const key = stringToken();
        if (keys.has(key)) throw new SyntaxError(`Duplicate JSON key ${JSON.stringify(key)}.`);
        keys.add(key);
        skip();
        if (text[index] !== ":") syntax("Expected ':' after object key");
        index += 1;
        valueToken();
        skip();
        if (text[index] === "}") { index += 1; return; }
        if (text[index] !== ",") syntax("Expected ',' or '}'");
        index += 1;
      }
      syntax("Unterminated JSON object");
    }
    if (text[index] === "[") {
      index += 1;
      skip();
      if (text[index] === "]") { index += 1; return; }
      while (index < text.length) {
        valueToken();
        skip();
        if (text[index] === "]") { index += 1; return; }
        if (text[index] !== ",") syntax("Expected ',' or ']'");
        index += 1;
      }
      syntax("Unterminated JSON array");
    }
    if (text[index] === '"') { stringToken(); return; }
    for (const literal of ["true", "false", "null"]) {
      if (text.startsWith(literal, index)) { index += literal.length; return; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(text.slice(index))?.[0];
    if (!number) syntax("Expected a JSON value");
    index += number.length;
  };
  valueToken();
  skip();
  if (index !== text.length) syntax("Unexpected trailing content");
  return JSON.parse(text);
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new TypeError("experiment.json must be supplied as UTF-8 bytes.");
}

/** Parse once, preserving both the exact source-byte and canonical semantic hashes. */
export async function parseExperimentDefinitionV1(input) {
  const bytes = asBytes(input);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_EXPERIMENT_DEFINITION_BYTES) {
    throw new RangeError(`experiment.json must contain 1–${MAX_EXPERIMENT_DEFINITION_BYTES} bytes.`);
  }
  const textValue = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const definition = validateExperimentDefinitionV1(parseStrictJsonDocument(textValue));
  return deepFreeze({
    definition,
    sourceText: textValue,
    sourceByteSha256: await sha256Hex(bytes),
    definitionSha256: await canonicalSha256(definition),
  });
}

/** Canonical UTF-8 source used when a larger portable package embeds a definition. */
export function serializeExperimentDefinitionV1(value) {
  return `${canonicalJson(validateExperimentDefinitionV1(value))}\n`;
}

function normalizeResolvedPlan(value) {
  exactObject(value, "ResolvedExperimentPlanV1", [
    "schema", "version", "algorithmVersion", "experimentId", "title", "settingsSha256",
    "sourceByteSha256", "definitionSha256", "participantIds", "stimuli", "blocks",
    "assignments", "planHashSha256",
  ]);
  if (value.schema !== RESOLVED_EXPERIMENT_PLAN_SCHEMA || value.version !== 1
    || value.algorithmVersion !== EXTERNAL_ORDER_ALGORITHM_VERSION) {
    throw new TypeError("ResolvedExperimentPlanV1 has an unsupported schema, version, or algorithm.");
  }
  if (!Array.isArray(value.participantIds) || value.participantIds.length < 1
    || value.participantIds.length > MAX_PARTICIPANTS) {
    throw new RangeError("ResolvedExperimentPlanV1.participantIds has an invalid length.");
  }
  const participantIds = value.participantIds.map((participantId, index) => {
    if (participantId !== participantIdFor(index, value.participantIds.length)) {
      throw new TypeError("ResolvedExperimentPlanV1 participant IDs must be canonical and ordered.");
    }
    return participantId;
  });
  const stimuli = value.stimuli.map((stimulus, index) => structuredClone(
    validateStimulusV1(stimulus, `ResolvedExperimentPlanV1.stimuli[${index}]`),
  ));
  if (new Set(stimuli.map(({ stimulusId }) => stimulusId)).size !== stimuli.length) {
    throw new TypeError("ResolvedExperimentPlanV1 contains duplicate stimuli.");
  }
  const blocks = value.blocks.map((block, index) => {
    const path = `ResolvedExperimentPlanV1.blocks[${index}]`;
    exactObject(block, path, ["blockId", "label"]);
    return { blockId: identifier(block.blockId, `${path}.blockId`), label: text(block.label, `${path}.label`) };
  });
  const registeredBlocks = blocks.map(({ blockId }) => blockId);
  if (new Set(registeredBlocks).size !== blocks.length) {
    throw new TypeError("ResolvedExperimentPlanV1 contains duplicate blocks.");
  }
  const knownStimuli = new Set(stimuli.map(({ stimulusId }) => stimulusId));
  if (!Array.isArray(value.assignments) || value.assignments.length !== participantIds.length) {
    throw new TypeError("ResolvedExperimentPlanV1 requires one assignment per participant.");
  }
  const assignments = value.assignments.map((assignment, assignmentIndex) => {
    const path = `ResolvedExperimentPlanV1.assignments[${assignmentIndex}]`;
    exactObject(assignment, path, ["participantId", "blockOrder", "slots"]);
    if (assignment.participantId !== participantIds[assignmentIndex]) {
      throw new TypeError(`${path}.participantId does not match participantIds order.`);
    }
    if (!Array.isArray(assignment.blockOrder) || assignment.blockOrder.length !== blocks.length
      || new Set(assignment.blockOrder).size !== blocks.length
      || assignment.blockOrder.some((blockId) => !registeredBlocks.includes(blockId))) {
      throw new TypeError(`${path}.blockOrder must contain every block exactly once.`);
    }
    if (!Array.isArray(assignment.slots) || assignment.slots.length < 1
      || assignment.slots.length > MAX_STEPS_PER_PARTICIPANT) {
      throw new RangeError(`${path}.slots has an invalid length.`);
    }
    const blockCounts = new Map();
    const seenStimuli = new Set();
    const slots = assignment.slots.map((slot, slotIndex) => {
      const slotPath = `${path}.slots[${slotIndex}]`;
      exactObject(slot, slotPath, ["position", "blockId", "poolPosition", "stimulusId", "isiAfterMs"]);
      const blockId = identifier(slot.blockId, `${slotPath}.blockId`);
      const expectedPoolPosition = (blockCounts.get(blockId) ?? 0) + 1;
      if (slot.position !== slotIndex + 1 || slot.poolPosition !== expectedPoolPosition
        || !assignment.blockOrder.includes(blockId)) {
        throw new TypeError(`${slotPath} positions or block identity are not contiguous.`);
      }
      blockCounts.set(blockId, expectedPoolPosition);
      const stimulusId = identifier(slot.stimulusId, `${slotPath}.stimulusId`);
      if (!knownStimuli.has(stimulusId) || seenStimuli.has(stimulusId)) {
        throw new TypeError(`${slotPath}.stimulusId is unknown or repeated.`);
      }
      seenStimuli.add(stimulusId);
      return {
        position: slot.position,
        blockId,
        poolPosition: slot.poolPosition,
        stimulusId,
        isiAfterMs: integer(slot.isiAfterMs, `${slotPath}.isiAfterMs`, 0, MAX_ISI_MS),
      };
    });
    let cursor = 0;
    for (const blockId of assignment.blockOrder) {
      const blockSlots = slots.filter((slot) => slot.blockId === blockId);
      if (!blockSlots.length || slots.slice(cursor, cursor + blockSlots.length).some((slot) => slot.blockId !== blockId)) {
        throw new TypeError(`${path}.slots must form contiguous nonempty block groups in blockOrder.`);
      }
      cursor += blockSlots.length;
    }
    return { participantId: assignment.participantId, blockOrder: [...assignment.blockOrder], slots };
  });
  return {
    schema: RESOLVED_EXPERIMENT_PLAN_SCHEMA,
    version: 1,
    algorithmVersion: EXTERNAL_ORDER_ALGORITHM_VERSION,
    experimentId: identifier(value.experimentId, "ResolvedExperimentPlanV1.experimentId"),
    title: text(value.title, "ResolvedExperimentPlanV1.title"),
    settingsSha256: hash(value.settingsSha256, "ResolvedExperimentPlanV1.settingsSha256"),
    sourceByteSha256: hash(value.sourceByteSha256, "ResolvedExperimentPlanV1.sourceByteSha256"),
    definitionSha256: hash(value.definitionSha256, "ResolvedExperimentPlanV1.definitionSha256"),
    participantIds,
    stimuli,
    blocks,
    assignments,
    planHashSha256: hash(value.planHashSha256, "ResolvedExperimentPlanV1.planHashSha256"),
  };
}

export async function validateResolvedExperimentPlanV1(value) {
  const normalized = normalizeResolvedPlan(structuredClone(value));
  const observed = await canonicalSha256(normalized, { omitRootKeys: ["planHashSha256"] });
  if (observed !== normalized.planHashSha256) {
    throw new TypeError("ResolvedExperimentPlanV1 plan hash does not match its canonical content.");
  }
  return deepFreeze(normalized);
}

/** Resolve author paths against freshly verified workspace stimuli without changing author order. */
export async function resolveExternalExperimentPlanV1(parsedValue, catalogueValue, settingsSha256) {
  exactObject(parsedValue, "Parsed ExperimentDefinitionV1", [
    "definition", "sourceText", "sourceByteSha256", "definitionSha256",
  ]);
  const definition = validateExperimentDefinitionV1(parsedValue.definition);
  if (typeof parsedValue.sourceText !== "string"
    || await sha256Hex(new TextEncoder().encode(parsedValue.sourceText)) !== parsedValue.sourceByteSha256) {
    throw new TypeError("Parsed experiment source bytes no longer match sourceByteSha256.");
  }
  const sourceByteSha256 = hash(parsedValue.sourceByteSha256, "sourceByteSha256");
  const definitionSha256 = hash(parsedValue.definitionSha256, "definitionSha256");
  if (await canonicalSha256(definition) !== definitionSha256) {
    throw new TypeError("Parsed experiment definition hash no longer matches its content.");
  }
  if (!Array.isArray(catalogueValue)) throw new TypeError("Verified stimulus catalogue must be an array.");
  const catalogue = catalogueValue.map((value, index) => structuredClone(
    validateStimulusV1(value, `catalogue[${index}]`),
  ));
  const byPath = new Map();
  for (const stimulus of catalogue) {
    if (stimulus.source.kind !== "workspaceFile") continue;
    const list = byPath.get(stimulus.source.relativePath) ?? [];
    list.push(stimulus);
    byPath.set(stimulus.source.relativePath, list);
  }
  const stimuli = definition.stimuli.map((reference) => {
    const matches = byPath.get(reference.relativePath) ?? [];
    if (matches.length !== 1) {
      throw new TypeError(`${reference.relativePath} must resolve to exactly one verified workspace video.`);
    }
    return structuredClone(validateStimulusV1({
      stimulusId: reference.stimulusId,
      title: reference.title,
      source: matches[0].source,
    }));
  });
  const assignments = definition.schedules.map((schedule) => {
    const slots = [];
    for (const block of schedule.blocks) {
      for (let index = 0; index < block.videos.length; index += 1) {
        const video = block.videos[index];
        slots.push({
          position: slots.length + 1,
          blockId: block.blockId,
          poolPosition: index + 1,
          stimulusId: video.stimulusId,
          isiAfterMs: video.isiAfterMs,
        });
      }
    }
    return {
      participantId: schedule.participantId,
      blockOrder: schedule.blocks.map(({ blockId }) => blockId),
      slots,
    };
  });
  const unhashed = {
    schema: RESOLVED_EXPERIMENT_PLAN_SCHEMA,
    version: 1,
    algorithmVersion: EXTERNAL_ORDER_ALGORITHM_VERSION,
    experimentId: definition.experimentId,
    title: definition.title,
    settingsSha256: hash(settingsSha256, "settingsSha256"),
    sourceByteSha256,
    definitionSha256,
    participantIds: definition.schedules.map(({ participantId }) => participantId),
    stimuli,
    blocks: structuredClone(definition.blocks),
    assignments,
  };
  return validateResolvedExperimentPlanV1({
    ...unhashed,
    planHashSha256: await canonicalSha256(unhashed),
  });
}

export const resolveExperimentPlanV1 = resolveExternalExperimentPlanV1;

/** Reconstruct the canonical author order and prove it equals the resolved plan. */
export function assertExperimentPlanMatchesDefinition(plan, definitionValue) {
  const definition = validateExperimentDefinitionV1(definitionValue);
  if (plan.experimentId !== definition.experimentId || plan.title !== definition.title
    || plan.definitionSha256 === undefined
    || canonicalJson(plan.blocks) !== canonicalJson(definition.blocks)) {
    throw new TypeError("Resolved experiment plan identity differs from experiment.json.");
  }
  const expected = definition.schedules.map((schedule) => ({
    participantId: schedule.participantId,
    blockOrder: schedule.blocks.map(({ blockId }) => blockId),
    slots: schedule.blocks.flatMap((block) => block.videos.map((video, index) => ({
      position: 0,
      blockId: block.blockId,
      poolPosition: index + 1,
      stimulusId: video.stimulusId,
      isiAfterMs: video.isiAfterMs,
    }))).map((slot, index) => ({ ...slot, position: index + 1 })),
  }));
  if (canonicalJson(plan.assignments) !== canonicalJson(expected)) {
    throw new TypeError("Resolved experiment plan changes the authored participant order or ISI values.");
  }
  return true;
}
