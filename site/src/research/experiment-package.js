import { canonicalJson, canonicalSha256, sha256Hex } from "./canonical.js";
import {
  parseExperimentDefinitionV1,
  parseStrictJsonDocument,
  resolveExternalExperimentPlanV1,
  serializeExperimentDefinitionV1,
  validateResolvedExperimentPlanV1,
} from "./external-experiment.js";
import {
  resolveProtocolPlanV2,
  validateResearchSettingsV3,
} from "./external-protocol.js";

export const EXPERIMENT_PACKAGE_SCHEMA = "affect-research-experiment-package";
export const EXPERIMENT_PACKAGE_VERSION = 1;
export const EXPERIMENT_PACKAGE_FILE_NAME = "experiment.package.json";
export const EXPERIMENT_PACKAGE_ASSET_ROOT = "assets/stimuli";
export const EXPERIMENT_PACKAGE_INTEGRITY_ALGORITHM = "experiment-package-reproduction-v1";
export const LANGUAGE_TREE_ALGORITHM = "language-tree-v1";
export const COMPLETE_VIDEO_PLAYBACK_ALGORITHM = "complete-video-v1";
export const EXPERIMENT_PACKAGE_RUN_BINDING_SCHEMA = "affect-research-experiment-package-run-binding";
export const EXPERIMENT_PACKAGE_RECOVERY_BINDING_SCHEMA = "affect-research-experiment-package-recovery-binding";
export const MAX_EXPERIMENT_PACKAGE_BYTES = 16 * 1024 * 1024;
export const MAX_PACKAGE_LANGUAGES = 64;
export const MAX_LANGUAGE_NODES = 256;
export const MAX_LANGUAGE_QUESTIONNAIRE_MODULES = 1_024;
export const MAX_REPRODUCTION_CASES = 25_000;

const ID = /^[a-z0-9][a-z0-9_-]{0,127}$/u;
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PARTICIPANT_ID = /^P[0-9]{3,}$/u;
const WINDOWS_RESERVED_COMPONENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const encoder = new TextEncoder();

export const DEFAULT_COMPLETE_VIDEO_PLAYBACK_V1 = Object.freeze({
  algorithmVersion: COMPLETE_VIDEO_PLAYBACK_ALGORITHM,
  startAtMs: 0,
  endCondition: "decodedEnd",
  playbackRate: 1,
  loop: false,
  seekingAllowed: false,
  pauseAllowed: true,
  audio: Object.freeze({ muted: false, volume: 1 }),
  feedbackPlacement: "adjacent",
  recoveryRestart: "fromBeginning",
});

function isPlainObject(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, path, fields) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object.`);
  const expected = new Set(fields);
  const missing = fields.find((field) => !Object.hasOwn(value, field));
  if (missing) throw new TypeError(`${path} is missing required field ${missing}.`);
  const unknown = Object.keys(value).find((field) => !expected.has(field));
  if (unknown) throw new TypeError(`${path} contains unknown field ${unknown}.`);
  return value;
}

function identifier(value, path) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new TypeError(`${path} must be a lowercase identifier using letters, numbers, _ or -.`);
  }
  return value;
}

function boundedText(value, path, maximum = 500) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum
    || value.normalize("NFC").trim() !== value || /\p{Cc}/u.test(value)) {
    throw new TypeError(`${path} must be bounded, trimmed NFC text.`);
  }
  return value;
}

function digest(value, path) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function positiveInteger(value, path, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${path} must be an integer within 1–${maximum}.`);
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

function unsafePackageAssetPath(value) {
  if (typeof value !== "string" || value.includes("\\") || value.startsWith("/")
    || /^[A-Za-z]:/u.test(value) || value.length > 1_024) return true;
  const parts = value.split("/");
  return parts.length < 3 || parts.length > 34
    || parts[0] !== "assets" || parts[1] !== "stimuli"
    || parts.some((part) => !part || part === "." || part === ".."
      || /[<>:"|?*\u0000-\u001f\u007f]/u.test(part) || /[ .]$/u.test(part)
      || WINDOWS_RESERVED_COMPONENT.test(part));
}

function packageAssetPath(value, path) {
  if (unsafePackageAssetPath(value)) {
    throw new TypeError(`${path} must be a safe relative path beneath ${EXPERIMENT_PACKAGE_ASSET_ROOT}/.`);
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
    if (unsafePackageAssetPath(next)) {
      throw new TypeError(`${path} contains an encoded unsafe path.`);
    }
    decoded = next;
  }
  return value;
}

function logicalPathForAsset(relativePath) {
  return packageAssetPath(relativePath, "ExperimentPackageV1 asset path").slice("assets/".length);
}

function assetPathForLogical(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.startsWith("stimuli/")) {
    throw new TypeError("Packaged settings may contain only local stimuli/ workspace videos.");
  }
  return packageAssetPath(`assets/${relativePath}`, "ExperimentPackageV1 generated asset path");
}

function normalizeAssets(value, settings) {
  exactObject(value, "ExperimentPackageV1.assets", ["stimuli"]);
  if (!Array.isArray(value.stimuli) || value.stimuli.length !== settings.stimuli.items.length) {
    throw new TypeError("ExperimentPackageV1.assets.stimuli must match the complete settings registry one-to-one.");
  }
  const settingsById = new Map(settings.stimuli.items.map((stimulus) => [stimulus.stimulusId, stimulus]));
  const seenIds = new Set();
  const seenPaths = new Set();
  const stimuli = value.stimuli.map((candidate, index) => {
    const path = `ExperimentPackageV1.assets.stimuli[${index}]`;
    exactObject(candidate, path, [
      "stimulusId", "title", "relativePath", "mimeType", "sha256", "byteLength", "durationMs",
    ]);
    const stimulusId = identifier(candidate.stimulusId, `${path}.stimulusId`);
    const relativePath = packageAssetPath(candidate.relativePath, `${path}.relativePath`);
    const source = settingsById.get(stimulusId)?.source;
    if (!source || source.kind !== "workspaceFile") {
      throw new TypeError(`${path} must bind one local workspace stimulus from ResearchSettingsV3.`);
    }
    const output = {
      stimulusId,
      title: boundedText(candidate.title, `${path}.title`, 200),
      relativePath,
      mimeType: boundedText(candidate.mimeType, `${path}.mimeType`, 100).toLowerCase(),
      sha256: digest(candidate.sha256, `${path}.sha256`),
      byteLength: positiveInteger(candidate.byteLength, `${path}.byteLength`),
      durationMs: candidate.durationMs,
    };
    if (!Number.isFinite(output.durationMs) || output.durationMs <= 0 || output.durationMs > 86_400_000) {
      throw new RangeError(`${path}.durationMs must be within (0, 86400000].`);
    }
    if (!/^video\/[a-z0-9.+-]+$/u.test(output.mimeType)) {
      throw new TypeError(`${path}.mimeType must identify video media.`);
    }
    if (output.title !== settingsById.get(stimulusId).title
      || logicalPathForAsset(output.relativePath) !== source.relativePath
      || output.mimeType !== source.mimeType
      || output.sha256 !== source.sha256
      || output.byteLength !== source.byteLength
      || output.durationMs !== source.durationMs) {
      throw new TypeError(`${path} does not exactly bind its logical settings stimulus.`);
    }
    if (seenIds.has(stimulusId) || seenPaths.has(relativePath)) {
      throw new TypeError("ExperimentPackageV1 assets contain duplicate stimulus IDs or paths.");
    }
    seenIds.add(stimulusId);
    seenPaths.add(relativePath);
    return output;
  });
  if (stimuli.some((stimulus, index) => stimulus.stimulusId !== settings.stimuli.items[index].stimulusId)) {
    throw new TypeError("ExperimentPackageV1 assets must use canonical settings stimulus order.");
  }
  return { stimuli };
}

function normalizeLanguageTarget(value, path) {
  if (!isPlainObject(value) || !Object.hasOwn(value, "kind")) {
    throw new TypeError(`${path} must be a tagged target object.`);
  }
  if (value.kind === "node") {
    exactObject(value, path, ["kind", "nodeId"]);
    return { kind: "node", nodeId: identifier(value.nodeId, `${path}.nodeId`) };
  }
  if (value.kind === "language") {
    exactObject(value, path, ["kind", "languageId"]);
    return { kind: "language", languageId: identifier(value.languageId, `${path}.languageId`) };
  }
  throw new TypeError(`${path}.kind must be node or language.`);
}

export function validateLanguageSelectionTreeV1(value) {
  exactObject(value, "LanguageSelectionTreeV1", [
    "algorithmVersion", "rootNodeId", "languages", "nodes",
  ]);
  if (value.algorithmVersion !== LANGUAGE_TREE_ALGORITHM) {
    throw new TypeError("LanguageSelectionTreeV1.algorithmVersion is unsupported.");
  }
  if (!Array.isArray(value.languages) || value.languages.length < 1
    || value.languages.length > MAX_PACKAGE_LANGUAGES) {
    throw new RangeError(`LanguageSelectionTreeV1 supports 1–${MAX_PACKAGE_LANGUAGES} languages.`);
  }
  if (!Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > MAX_LANGUAGE_NODES) {
    throw new RangeError(`LanguageSelectionTreeV1 supports 1–${MAX_LANGUAGE_NODES} nodes.`);
  }
  const languages = value.languages.map((candidate, index) => {
    const path = `LanguageSelectionTreeV1.languages[${index}]`;
    exactObject(candidate, path, [
      "languageId", "languageTag", "label", "questionnaireModuleIds",
    ]);
    const languageTag = boundedText(candidate.languageTag, `${path}.languageTag`, 80);
    if (!LANGUAGE_TAG.test(languageTag)) throw new TypeError(`${path}.languageTag is invalid.`);
    if (!Array.isArray(candidate.questionnaireModuleIds)
      || candidate.questionnaireModuleIds.length > MAX_LANGUAGE_QUESTIONNAIRE_MODULES) {
      throw new RangeError(
        `${path}.questionnaireModuleIds must contain at most ${MAX_LANGUAGE_QUESTIONNAIRE_MODULES} module IDs.`,
      );
    }
    const questionnaireModuleIds = candidate.questionnaireModuleIds.map((moduleId, moduleIndex) => (
      identifier(moduleId, `${path}.questionnaireModuleIds[${moduleIndex}]`)
    ));
    if (new Set(questionnaireModuleIds).size !== questionnaireModuleIds.length) {
      throw new TypeError(`${path}.questionnaireModuleIds must not repeat a module ID.`);
    }
    return {
      languageId: identifier(candidate.languageId, `${path}.languageId`),
      languageTag,
      label: boundedText(candidate.label, `${path}.label`, 120),
      questionnaireModuleIds,
    };
  });
  if (new Set(languages.map(({ languageId }) => languageId)).size !== languages.length
    || new Set(languages.map(({ languageTag }) => languageTag)).size !== languages.length) {
    throw new TypeError("LanguageSelectionTreeV1 languages must have unique IDs and tags.");
  }
  const nodes = value.nodes.map((candidate, nodeIndex) => {
    const path = `LanguageSelectionTreeV1.nodes[${nodeIndex}]`;
    exactObject(candidate, path, ["nodeId", "prompt", "options"]);
    if (!Array.isArray(candidate.options) || candidate.options.length < 1 || candidate.options.length > 64) {
      throw new RangeError(`${path}.options must contain 1–64 routes.`);
    }
    const optionIds = new Set();
    const options = candidate.options.map((option, optionIndex) => {
      const optionPath = `${path}.options[${optionIndex}]`;
      exactObject(option, optionPath, ["optionId", "label", "target"]);
      const optionId = identifier(option.optionId, `${optionPath}.optionId`);
      if (optionIds.has(optionId)) throw new TypeError(`${path} contains duplicate option ${optionId}.`);
      optionIds.add(optionId);
      return {
        optionId,
        label: boundedText(option.label, `${optionPath}.label`, 120),
        target: normalizeLanguageTarget(option.target, `${optionPath}.target`),
      };
    });
    return {
      nodeId: identifier(candidate.nodeId, `${path}.nodeId`),
      prompt: boundedText(candidate.prompt, `${path}.prompt`, 500),
      options,
    };
  });
  const rootNodeId = identifier(value.rootNodeId, "LanguageSelectionTreeV1.rootNodeId");
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
  const languageIds = new Set(languages.map(({ languageId }) => languageId));
  if (nodeById.size !== nodes.length || !nodeById.has(rootNodeId)) {
    throw new TypeError("LanguageSelectionTreeV1 requires unique nodes and a declared root.");
  }
  const incomingNodes = new Map(nodes.map(({ nodeId }) => [nodeId, 0]));
  const incomingLanguages = new Map(languages.map(({ languageId }) => [languageId, 0]));
  for (const node of nodes) {
    for (const option of node.options) {
      if (option.target.kind === "node") {
        if (!nodeById.has(option.target.nodeId)) throw new TypeError("Language tree option references an unknown node.");
        incomingNodes.set(option.target.nodeId, incomingNodes.get(option.target.nodeId) + 1);
      } else {
        if (!languageIds.has(option.target.languageId)) throw new TypeError("Language tree option references an unknown language.");
        incomingLanguages.set(option.target.languageId, incomingLanguages.get(option.target.languageId) + 1);
      }
    }
  }
  if (incomingNodes.get(rootNodeId) !== 0
    || [...incomingNodes].some(([nodeId, count]) => nodeId !== rootNodeId && count !== 1)
    || [...incomingLanguages.values()].some((count) => count !== 1)) {
    throw new TypeError("LanguageSelectionTreeV1 must be one rooted tree with each language as one leaf.");
  }
  const visiting = new Set();
  const visited = new Set();
  const walk = (nodeId) => {
    if (visiting.has(nodeId)) throw new TypeError("LanguageSelectionTreeV1 must not contain cycles.");
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const option of nodeById.get(nodeId).options) {
      if (option.target.kind === "node") walk(option.target.nodeId);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  walk(rootNodeId);
  if (visited.size !== nodes.length) throw new TypeError("LanguageSelectionTreeV1 contains an unreachable node.");
  return deepFreeze({ algorithmVersion: LANGUAGE_TREE_ALGORITHM, rootNodeId, languages, nodes });
}

export function enumerateLanguageRoutesV1(value) {
  const tree = validateLanguageSelectionTreeV1(value);
  const nodes = new Map(tree.nodes.map((node) => [node.nodeId, node]));
  const languages = new Map(tree.languages.map((language) => [language.languageId, language]));
  const routes = [];
  const walk = (nodeId, optionIds, labels) => {
    const node = nodes.get(nodeId);
    for (const option of node.options) {
      const nextOptionIds = [...optionIds, option.optionId];
      const nextLabels = [...labels, option.label];
      if (option.target.kind === "node") {
        walk(option.target.nodeId, nextOptionIds, nextLabels);
      } else {
        const language = languages.get(option.target.languageId);
        routes.push({
          languageId: language.languageId,
          languageTag: language.languageTag,
          languageLabel: language.label,
          questionnaireModuleIds: [...language.questionnaireModuleIds],
          optionIds: nextOptionIds,
          labels: nextLabels,
        });
      }
    }
  };
  walk(tree.rootNodeId, [], []);
  return deepFreeze(routes);
}

/**
 * Resolve one participant-facing step of the package-owned language tree.
 *
 * The caller retains only the ordered option-id path. Replaying that path from
 * the declared root on every call makes the validated package the sole tree
 * authority and prevents UI state from supplying a hidden node, target, or
 * terminal-language default.
 */
export function resolveLanguageSelectionTraversalStepV1(value, selectionPath = []) {
  const tree = validateLanguageSelectionTreeV1(value);
  if (!Array.isArray(selectionPath) || selectionPath.length > MAX_LANGUAGE_NODES) {
    throw new RangeError(
      `Language selection paths may contain at most ${MAX_LANGUAGE_NODES} choices.`,
    );
  }
  const path = selectionPath.map((optionId, index) => (
    identifier(optionId, `Language selection path[${index}]`)
  ));
  const nodes = new Map(tree.nodes.map((node) => [node.nodeId, node]));
  const languages = new Map(tree.languages.map((language) => [language.languageId, language]));
  const labels = [];
  let node = nodes.get(tree.rootNodeId);

  for (let index = 0; index < path.length; index += 1) {
    const option = node.options.find(({ optionId }) => optionId === path[index]);
    if (!option) {
      throw new TypeError(
        `Language selection option ${path[index]} is not available at node ${node.nodeId}.`,
      );
    }
    labels.push(option.label);
    if (option.target.kind === "language") {
      if (index !== path.length - 1) {
        throw new TypeError("Language selection path continues beyond a terminal language.");
      }
      const language = languages.get(option.target.languageId);
      return deepFreeze({
        kind: "terminal",
        languageId: language.languageId,
        languageTag: language.languageTag,
        languageLabel: language.label,
        questionnaireModuleIds: [...language.questionnaireModuleIds],
        optionIds: [...path],
        labels,
      });
    }
    node = nodes.get(option.target.nodeId);
  }

  return deepFreeze({
    kind: "choice",
    nodeId: node.nodeId,
    prompt: node.prompt,
    optionIds: [...path],
    labels,
    options: node.options.map(({ optionId, label }) => ({ optionId, label })),
  });
}

/**
 * Validate the deliberately narrow package identity exposed to Setup for a
 * recoverable attempt. It contains no source text, file-system identity,
 * participant demographics, questionnaire answers, or run samples.
 */
export function validateExperimentPackageRecoveryBindingV1(value) {
  exactObject(value, "ExperimentPackageRecoveryBindingV1", [
    "schema", "version", "participantId", "attemptNumber", "disposition",
    "packageId", "canonicalSourceByteSha256", "packageDefinitionSha256",
    "languageId", "languageSelectionPath", "assignmentSha256",
  ]);
  if (value.schema !== EXPERIMENT_PACKAGE_RECOVERY_BINDING_SCHEMA || value.version !== 1) {
    throw new TypeError("ExperimentPackageRecoveryBindingV1 has an unsupported schema or version.");
  }
  if (typeof value.participantId !== "string" || !PARTICIPANT_ID.test(value.participantId)) {
    throw new TypeError("ExperimentPackageRecoveryBindingV1.participantId is invalid.");
  }
  if (value.disposition !== "resume-compatible") {
    throw new TypeError("ExperimentPackageRecoveryBindingV1.disposition must be resume-compatible.");
  }
  if (!Array.isArray(value.languageSelectionPath)
    || value.languageSelectionPath.length < 1
    || value.languageSelectionPath.length > MAX_LANGUAGE_NODES) {
    throw new RangeError(
      `ExperimentPackageRecoveryBindingV1.languageSelectionPath must contain 1–${MAX_LANGUAGE_NODES} choices.`,
    );
  }
  return deepFreeze({
    schema: EXPERIMENT_PACKAGE_RECOVERY_BINDING_SCHEMA,
    version: 1,
    participantId: value.participantId,
    attemptNumber: positiveInteger(value.attemptNumber, "ExperimentPackageRecoveryBindingV1.attemptNumber"),
    disposition: "resume-compatible",
    packageId: identifier(value.packageId, "ExperimentPackageRecoveryBindingV1.packageId"),
    canonicalSourceByteSha256: digest(
      value.canonicalSourceByteSha256,
      "ExperimentPackageRecoveryBindingV1.canonicalSourceByteSha256",
    ),
    packageDefinitionSha256: digest(
      value.packageDefinitionSha256,
      "ExperimentPackageRecoveryBindingV1.packageDefinitionSha256",
    ),
    languageId: identifier(value.languageId, "ExperimentPackageRecoveryBindingV1.languageId"),
    languageSelectionPath: value.languageSelectionPath.map((optionId, index) => (
      identifier(optionId, `ExperimentPackageRecoveryBindingV1.languageSelectionPath[${index}]`)
    )),
    assignmentSha256: digest(
      value.assignmentSha256,
      "ExperimentPackageRecoveryBindingV1.assignmentSha256",
    ),
  });
}

export function projectExperimentPackageRecoveryBindingV1(attempt) {
  if (!isPlainObject(attempt)) throw new TypeError("A recovery attempt object is required.");
  const packageBinding = attempt.context?.experimentPackage;
  if (packageBinding === undefined) return null;
  if (!isPlainObject(packageBinding)) {
    throw new TypeError("The recovery attempt has a malformed experiment package binding.");
  }
  return validateExperimentPackageRecoveryBindingV1({
    schema: EXPERIMENT_PACKAGE_RECOVERY_BINDING_SCHEMA,
    version: 1,
    participantId: attempt.participantId,
    attemptNumber: attempt.attemptNumber,
    disposition: "resume-compatible",
    packageId: packageBinding.packageId,
    canonicalSourceByteSha256: packageBinding.sourceByteSha256,
    packageDefinitionSha256: packageBinding.packageDefinitionSha256,
    languageId: packageBinding.languageId,
    languageSelectionPath: packageBinding.languageSelectionPath,
    assignmentSha256: packageBinding.assignmentSha256,
  });
}

export function createFlatLanguageSelectionV1(languagesValue) {
  if (!Array.isArray(languagesValue)) throw new TypeError("languages must be an array.");
  const languages = languagesValue.map((language) => ({
    languageId: language.languageId,
    languageTag: language.languageTag,
    label: language.label,
    questionnaireModuleIds: language.questionnaireModuleIds ?? [],
  }));
  return validateLanguageSelectionTreeV1({
    algorithmVersion: LANGUAGE_TREE_ALGORITHM,
    rootNodeId: "language",
    languages,
    nodes: [{
      nodeId: "language",
      prompt: "Choose your language",
      options: languages.map((language) => ({
        optionId: language.languageId,
        label: language.label,
        target: { kind: "language", languageId: language.languageId },
      })),
    }],
  });
}

function normalizePlayback(value) {
  exactObject(value, "ExperimentPackageV1.playback", [
    "algorithmVersion", "startAtMs", "endCondition", "playbackRate", "loop",
    "seekingAllowed", "pauseAllowed", "audio", "feedbackPlacement", "recoveryRestart",
  ]);
  exactObject(value.audio, "ExperimentPackageV1.playback.audio", ["muted", "volume"]);
  const normalized = {
    algorithmVersion: value.algorithmVersion,
    startAtMs: value.startAtMs,
    endCondition: value.endCondition,
    playbackRate: value.playbackRate,
    loop: value.loop,
    seekingAllowed: value.seekingAllowed,
    pauseAllowed: value.pauseAllowed,
    audio: { muted: value.audio.muted, volume: value.audio.volume },
    feedbackPlacement: value.feedbackPlacement,
    recoveryRestart: value.recoveryRestart,
  };
  if (canonicalJson(normalized) !== canonicalJson(DEFAULT_COMPLETE_VIDEO_PLAYBACK_V1)) {
    throw new TypeError("ExperimentPackageV1.playback must state the complete-video-v1 policy exactly.");
  }
  return normalized;
}

function questionnairesForLanguage(settings, language) {
  const moduleById = new Map(settings.questionnaires.modules.map((module) => [
    module.moduleId,
    module,
  ]));
  const definitionById = new Map(settings.questionnaires.definitions.map((definition) => [
    definition.questionnaireId,
    definition,
  ]));
  const modules = language.questionnaireModuleIds.map((moduleId) => moduleById.get(moduleId));
  const definitions = [];
  const includedDefinitionIds = new Set();
  for (const module of modules) {
    if (!includedDefinitionIds.has(module.questionnaireId)) {
      includedDefinitionIds.add(module.questionnaireId);
      definitions.push(definitionById.get(module.questionnaireId));
    }
  }
  return { definitions, modules };
}

async function settingsForLanguage(settings, language) {
  const questionnaires = questionnairesForLanguage(settings, language);
  return validateResearchSettingsV3({
    ...structuredClone(settings),
    questionnaires: {
      algorithmVersion: settings.questionnaires.algorithmVersion,
      definitions: structuredClone(questionnaires.definitions),
      modules: structuredClone(questionnaires.modules),
    },
  });
}

function validateQuestionnaireLanguageMappings(settings, languageSelection) {
  const languageTags = new Set(languageSelection.languages.map(({ languageTag }) => languageTag));
  const definitionById = new Map(settings.questionnaires.definitions.map((definition) => [
    definition.questionnaireId,
    definition,
  ]));
  const moduleById = new Map(settings.questionnaires.modules.map((module) => [
    module.moduleId,
    module,
  ]));
  const mappedModuleIds = new Set();

  for (const definition of settings.questionnaires.definitions) {
    if (definition.language !== "und" && !languageTags.has(definition.language)) {
      throw new TypeError(
        `Questionnaire ${definition.questionnaireId} uses language ${definition.language}, which is absent from the language tree.`,
      );
    }
  }
  for (const language of languageSelection.languages) {
    for (const moduleId of language.questionnaireModuleIds) {
      const module = moduleById.get(moduleId);
      if (!module) {
        throw new TypeError(
          `Language ${language.languageId} maps unknown questionnaire module ${moduleId}.`,
        );
      }
      const definition = definitionById.get(module.questionnaireId);
      if (!definition || (definition.language !== "und"
        && definition.language !== language.languageTag)) {
        throw new TypeError(
          `Language ${language.languageId} maps questionnaire module ${moduleId} to a definition with an incompatible language.`,
        );
      }
      mappedModuleIds.add(moduleId);
    }
  }
  const unmapped = settings.questionnaires.modules.find(({ moduleId }) => !mappedModuleIds.has(moduleId));
  if (unmapped) {
    throw new TypeError(
      `Questionnaire module ${unmapped.moduleId} is not explicitly mapped to any package language.`,
    );
  }
}

async function parsedEmbeddedExperiment(settings) {
  const sourceText = serializeExperimentDefinitionV1(settings.externalProtocol.definition);
  const parsed = await parseExperimentDefinitionV1(encoder.encode(sourceText));
  if (parsed.sourceByteSha256 !== settings.externalProtocol.sourceByteSha256
    || parsed.definitionSha256 !== settings.externalProtocol.definitionSha256) {
    throw new TypeError(
      "ExperimentPackageV1 settings must bind the canonical embedded experiment definition bytes.",
    );
  }
  return parsed;
}

async function normalizeCore(value) {
  exactObject(value, "ExperimentPackageV1", [
    "schema", "version", "packageId", "assetRoot", "assets", "languageSelection",
    "playback", "settings", "integrity",
  ]);
  if (value.schema !== EXPERIMENT_PACKAGE_SCHEMA || value.version !== EXPERIMENT_PACKAGE_VERSION) {
    throw new TypeError("ExperimentPackageV1 has an unsupported schema or version.");
  }
  if (value.assetRoot !== EXPERIMENT_PACKAGE_ASSET_ROOT) {
    throw new TypeError(`ExperimentPackageV1.assetRoot must be ${EXPERIMENT_PACKAGE_ASSET_ROOT}.`);
  }
  const settings = await validateResearchSettingsV3(value.settings);
  const languageSelection = validateLanguageSelectionTreeV1(value.languageSelection);
  validateQuestionnaireLanguageMappings(settings, languageSelection);
  if (settings.experiment.participantCount * languageSelection.languages.length > MAX_REPRODUCTION_CASES) {
    throw new RangeError(
      `ExperimentPackageV1 participant × language matrix may not exceed ${MAX_REPRODUCTION_CASES} cases.`,
    );
  }
  await parsedEmbeddedExperiment(settings);
  return {
    schema: EXPERIMENT_PACKAGE_SCHEMA,
    version: EXPERIMENT_PACKAGE_VERSION,
    packageId: identifier(value.packageId, "ExperimentPackageV1.packageId"),
    assetRoot: EXPERIMENT_PACKAGE_ASSET_ROOT,
    assets: normalizeAssets(value.assets, settings),
    languageSelection,
    playback: normalizePlayback(value.playback),
    settings: structuredClone(settings),
  };
}

async function compileNormalizedSelection(core, route, participantId) {
  const settings = await settingsForLanguage(core.settings, route);
  const experimentDocument = await parsedEmbeddedExperiment(settings);
  const settingsSha256 = await canonicalSha256(settings);
  const experimentPlan = await resolveExternalExperimentPlanV1(
    experimentDocument,
    settings.stimuli.items,
    settingsSha256,
  );
  const assignment = await projectParticipantAssignmentV1(experimentPlan, participantId);
  const assignmentSha256 = await canonicalSha256(assignment);
  const protocolPlan = await resolveProtocolPlanV2(settings, experimentPlan, participantId);
  return {
    languageId: route.languageId,
    languageTag: route.languageTag,
    languageSelectionPath: [...route.optionIds],
    settings,
    settingsSha256,
    experimentDocument,
    experimentPlan,
    assignment,
    assignmentSha256,
    protocolPlan,
    assetBindings: core.assets.stimuli.map((asset) => ({
      stimulusId: asset.stimulusId,
      logicalPath: logicalPathForAsset(asset.relativePath),
      packagePath: asset.relativePath,
      sha256: asset.sha256,
      byteLength: asset.byteLength,
      durationMs: asset.durationMs,
    })),
  };
}

/**
 * Project exactly one participant's authored block/video/ISI assignment.
 *
 * The projection deliberately excludes aggregate experiment-plan identity and
 * language-specific protocol state. Its canonical SHA-256 is therefore a
 * participant-assignment receipt, not an alias for ResolvedExperimentPlanV1's
 * global plan hash.
 */
export async function projectParticipantAssignmentV1(value, participantId) {
  const plan = await validateResolvedExperimentPlanV1(value);
  const assignment = plan.assignments.find((candidate) => (
    candidate.participantId === participantId
  ));
  if (!assignment) {
    throw new TypeError(`ResolvedExperimentPlanV1 has no assignment for ${participantId}.`);
  }
  return deepFreeze({
    participantId: assignment.participantId,
    blockOrder: [...assignment.blockOrder],
    slots: assignment.slots.map((slot) => ({ ...slot })),
  });
}

export async function participantAssignmentSha256V1(value, participantId) {
  return canonicalSha256(await projectParticipantAssignmentV1(value, participantId));
}

async function expectedIntegrity(core) {
  const settingsSha256 = await canonicalSha256(core.settings);
  const experimentDocument = await parsedEmbeddedExperiment(core.settings);
  const experimentPlan = await resolveExternalExperimentPlanV1(
    experimentDocument,
    core.settings.stimuli.items,
    settingsSha256,
  );
  const routes = enumerateLanguageRoutesV1(core.languageSelection);
  const matrix = [];
  for (const route of routes) {
    const selectedSettings = await settingsForLanguage(core.settings, route);
    const selectedSettingsSha256 = await canonicalSha256(selectedSettings);
    const selectedExperiment = await parsedEmbeddedExperiment(selectedSettings);
    const selectedPlan = await resolveExternalExperimentPlanV1(
      selectedExperiment,
      selectedSettings.stimuli.items,
      selectedSettingsSha256,
    );
    for (const participantId of selectedPlan.participantIds) {
      const assignmentSha256 = await participantAssignmentSha256V1(
        selectedPlan,
        participantId,
      );
      const protocolPlan = await resolveProtocolPlanV2(selectedSettings, selectedPlan, participantId);
      matrix.push({
        participantId,
        languageId: route.languageId,
        languageTag: route.languageTag,
        languageSelectionPath: [...route.optionIds],
        settingsSha256: selectedSettingsSha256,
        experimentPlanSha256: selectedPlan.planHashSha256,
        assignmentSha256,
        protocolPlanSha256: protocolPlan.protocolPlanHashSha256,
      });
    }
  }
  return {
    algorithmVersion: EXPERIMENT_PACKAGE_INTEGRITY_ALGORITHM,
    packageDefinitionSha256: await canonicalSha256(core),
    settingsSha256,
    assetManifestSha256: await canonicalSha256(core.assets),
    experimentPlanSha256: experimentPlan.planHashSha256,
    protocolMatrixSha256: await canonicalSha256(matrix),
  };
}

function normalizeIntegrity(value) {
  exactObject(value, "ExperimentPackageV1.integrity", [
    "algorithmVersion", "packageDefinitionSha256", "settingsSha256",
    "assetManifestSha256", "experimentPlanSha256", "protocolMatrixSha256",
  ]);
  if (value.algorithmVersion !== EXPERIMENT_PACKAGE_INTEGRITY_ALGORITHM) {
    throw new TypeError("ExperimentPackageV1.integrity.algorithmVersion is unsupported.");
  }
  return {
    algorithmVersion: EXPERIMENT_PACKAGE_INTEGRITY_ALGORITHM,
    packageDefinitionSha256: digest(value.packageDefinitionSha256, "ExperimentPackageV1.integrity.packageDefinitionSha256"),
    settingsSha256: digest(value.settingsSha256, "ExperimentPackageV1.integrity.settingsSha256"),
    assetManifestSha256: digest(value.assetManifestSha256, "ExperimentPackageV1.integrity.assetManifestSha256"),
    experimentPlanSha256: digest(value.experimentPlanSha256, "ExperimentPackageV1.integrity.experimentPlanSha256"),
    protocolMatrixSha256: digest(value.protocolMatrixSha256, "ExperimentPackageV1.integrity.protocolMatrixSha256"),
  };
}

export async function validateExperimentPackageV1(value) {
  const core = await normalizeCore(structuredClone(value));
  const integrity = normalizeIntegrity(value.integrity);
  const expected = await expectedIntegrity(core);
  if (canonicalJson(integrity) !== canonicalJson(expected)) {
    throw new TypeError("ExperimentPackageV1 integrity hashes do not match its complete portable content.");
  }
  return deepFreeze({ ...core, integrity });
}

export async function createExperimentPackageV1({
  packageId,
  languageSelection,
  settings: settingsValue,
  playback = DEFAULT_COMPLETE_VIDEO_PLAYBACK_V1,
}) {
  const settings = await validateResearchSettingsV3(settingsValue);
  const canonicalDefinitionSource = serializeExperimentDefinitionV1(settings.externalProtocol.definition);
  const canonicalDefinition = await parseExperimentDefinitionV1(encoder.encode(canonicalDefinitionSource));
  const canonicalSettings = await validateResearchSettingsV3({
    ...structuredClone(settings),
    externalProtocol: {
      ...structuredClone(settings.externalProtocol),
      sourceByteSha256: canonicalDefinition.sourceByteSha256,
      definitionSha256: canonicalDefinition.definitionSha256,
      definition: structuredClone(canonicalDefinition.definition),
    },
  });
  const coreInput = {
    schema: EXPERIMENT_PACKAGE_SCHEMA,
    version: EXPERIMENT_PACKAGE_VERSION,
    packageId,
    assetRoot: EXPERIMENT_PACKAGE_ASSET_ROOT,
    assets: {
      stimuli: canonicalSettings.stimuli.items.map((stimulus) => {
        if (stimulus.source.kind !== "workspaceFile") {
          throw new TypeError("ExperimentPackageV1 can package only byte-verified local videos.");
        }
        return {
          stimulusId: stimulus.stimulusId,
          title: stimulus.title,
          relativePath: assetPathForLogical(stimulus.source.relativePath),
          mimeType: stimulus.source.mimeType,
          sha256: stimulus.source.sha256,
          byteLength: stimulus.source.byteLength,
          durationMs: stimulus.source.durationMs,
        };
      }),
    },
    languageSelection,
    playback,
    settings: canonicalSettings,
    integrity: {
      algorithmVersion: EXPERIMENT_PACKAGE_INTEGRITY_ALGORITHM,
      packageDefinitionSha256: "0".repeat(64),
      settingsSha256: "0".repeat(64),
      assetManifestSha256: "0".repeat(64),
      experimentPlanSha256: "0".repeat(64),
      protocolMatrixSha256: "0".repeat(64),
    },
  };
  const core = await normalizeCore(coreInput);
  return validateExperimentPackageV1({ ...core, integrity: await expectedIntegrity(core) });
}

export async function serializeExperimentPackageV1(value) {
  return `${canonicalJson(await validateExperimentPackageV1(value))}\n`;
}

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError("experiment.package.json must be supplied as UTF-8 bytes.");
}

export async function parseExperimentPackageV1(input) {
  const sourceBytes = bytes(input);
  if (sourceBytes.byteLength < 1 || sourceBytes.byteLength > MAX_EXPERIMENT_PACKAGE_BYTES) {
    throw new RangeError(`experiment.package.json must contain 1–${MAX_EXPERIMENT_PACKAGE_BYTES} bytes.`);
  }
  const sourceText = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
  const packageValue = await validateExperimentPackageV1(parseStrictJsonDocument(sourceText));
  const canonicalSourceText = `${canonicalJson(packageValue)}\n`;
  const canonicalSourceBytes = encoder.encode(canonicalSourceText);
  if (sourceBytes.byteLength !== canonicalSourceBytes.byteLength
    || sourceBytes.some((byte, index) => byte !== canonicalSourceBytes[index])) {
    throw new TypeError(
      "experiment.package.json must use exact canonical UTF-8 JSON bytes with one trailing LF.",
    );
  }
  const sourceByteSha256 = await sha256Hex(sourceBytes);
  return deepFreeze({
    package: packageValue,
    sourceText: canonicalSourceText,
    sourceByteSha256,
    canonicalSourceText,
    canonicalSourceByteSha256: sourceByteSha256,
  });
}

export async function compileExperimentPackageSelectionV1(value, {
  languageId,
  languageSelectionPath,
  participantId,
}) {
  const packageValue = await validateExperimentPackageV1(value);
  const route = enumerateLanguageRoutesV1(packageValue.languageSelection).find((candidate) => (
    candidate.languageId === languageId
    && canonicalJson(candidate.optionIds) === canonicalJson(languageSelectionPath)
  ));
  if (!route) throw new TypeError("The selected language path is not a terminal route in the package tree.");
  const compiled = await compileNormalizedSelection(packageValue, route, participantId);
  return deepFreeze({
    ...compiled,
    package: packageValue,
    packageDefinitionSha256: packageValue.integrity.packageDefinitionSha256,
  });
}

export async function validateExperimentPackageRunBindingV1(value, {
  settings,
  experimentPlan,
  protocolPlan,
  participantId,
} = {}) {
  exactObject(value, "ExperimentPackageRunBindingV1", [
    "schema", "version", "sourceText", "sourceByteSha256", "packageDefinitionSha256",
    "packageId", "languageId", "languageSelectionPath", "assignmentSha256", "assetBindings",
  ]);
  if (value.schema !== EXPERIMENT_PACKAGE_RUN_BINDING_SCHEMA || value.version !== 1) {
    throw new TypeError("ExperimentPackageRunBindingV1 has an unsupported schema or version.");
  }
  if (typeof value.sourceText !== "string") {
    throw new TypeError("ExperimentPackageRunBindingV1.sourceText must contain canonical package JSON.");
  }
  if (!Array.isArray(value.languageSelectionPath) || !Array.isArray(value.assetBindings)) {
    throw new TypeError("ExperimentPackageRunBindingV1 route and asset bindings must be arrays.");
  }
  const parsed = await parseExperimentPackageV1(encoder.encode(value.sourceText));
  if (digest(value.sourceByteSha256, "ExperimentPackageRunBindingV1.sourceByteSha256")
      !== parsed.sourceByteSha256
    || digest(value.packageDefinitionSha256, "ExperimentPackageRunBindingV1.packageDefinitionSha256")
      !== parsed.package.integrity.packageDefinitionSha256
    || identifier(value.packageId, "ExperimentPackageRunBindingV1.packageId")
      !== parsed.package.packageId) {
    throw new TypeError("ExperimentPackageRunBindingV1 does not bind canonical experiment.package.json bytes.");
  }
  const compiled = await compileExperimentPackageSelectionV1(parsed.package, {
    languageId: identifier(value.languageId, "ExperimentPackageRunBindingV1.languageId"),
    languageSelectionPath: value.languageSelectionPath,
    participantId,
  });
  if (canonicalJson(compiled.settings) !== canonicalJson(settings)
    || canonicalJson(compiled.experimentPlan) !== canonicalJson(experimentPlan)
    || canonicalJson(compiled.protocolPlan) !== canonicalJson(protocolPlan)
    || digest(value.assignmentSha256, "ExperimentPackageRunBindingV1.assignmentSha256")
      !== compiled.assignmentSha256
    || canonicalJson(compiled.assetBindings) !== canonicalJson(value.assetBindings)) {
    throw new TypeError("ExperimentPackageRunBindingV1 does not reproduce the frozen participant protocol.");
  }
  return deepFreeze({
    schema: EXPERIMENT_PACKAGE_RUN_BINDING_SCHEMA,
    version: 1,
    sourceText: parsed.canonicalSourceText,
    sourceByteSha256: parsed.canonicalSourceByteSha256,
    packageDefinitionSha256: parsed.package.integrity.packageDefinitionSha256,
    packageId: parsed.package.packageId,
    languageId: compiled.languageId,
    languageSelectionPath: [...compiled.languageSelectionPath],
    assignmentSha256: compiled.assignmentSha256,
    assetBindings: structuredClone(compiled.assetBindings),
  });
}

export async function verifySameRealmPackageReproductionV1(value) {
  const packageValue = await validateExperimentPackageV1(value);
  const canonicalSourceText = await serializeExperimentPackageV1(packageValue);
  const first = await parseExperimentPackageV1(encoder.encode(canonicalSourceText));
  const second = await parseExperimentPackageV1(encoder.encode(canonicalSourceText));
  const firstExport = await serializeExperimentPackageV1(first.package);
  const secondExport = await serializeExperimentPackageV1(second.package);
  if (firstExport !== canonicalSourceText || secondExport !== canonicalSourceText) {
    throw new TypeError("Repeated same-realm package parses did not re-export byte-identical canonical JSON.");
  }
  const routes = enumerateLanguageRoutesV1(packageValue.languageSelection);
  const cases = [];
  for (const route of routes) {
    for (const participantId of packageValue.settings.externalProtocol.definition.schedules
      .map((schedule) => schedule.participantId)) {
      const left = await compileNormalizedSelection(first.package, route, participantId);
      const right = await compileNormalizedSelection(second.package, route, participantId);
      const signature = (compiled) => canonicalJson({
        languageId: compiled.languageId,
        languageTag: compiled.languageTag,
        languageSelectionPath: compiled.languageSelectionPath,
        settingsSha256: compiled.settingsSha256,
        experimentPlanSha256: compiled.experimentPlan.planHashSha256,
        assignmentSha256: compiled.assignmentSha256,
        protocolPlanSha256: compiled.protocolPlan.protocolPlanHashSha256,
        assetBindings: compiled.assetBindings,
        protocolSteps: compiled.protocolPlan.steps,
      });
      const leftSignature = signature(left);
      if (leftSignature !== signature(right)) {
        throw new TypeError("Repeated same-realm package parses resolved different participant protocol logic.");
      }
      cases.push({
        participantId,
        languageId: route.languageId,
        canonicalSourceByteSha256: first.canonicalSourceByteSha256,
        settingsSha256: left.settingsSha256,
        assetManifestSha256: packageValue.integrity.assetManifestSha256,
        assignmentSha256: left.assignmentSha256,
        protocolPlanSha256: left.protocolPlan.protocolPlanHashSha256,
        protocolStepsSha256: await canonicalSha256(left.protocolPlan.steps),
        signatureSha256: await sha256Hex(leftSignature),
      });
    }
  }
  const caseMatrixSha256 = await canonicalSha256(cases);
  return deepFreeze({
    schema: "affect-research-package-reproduction-receipt",
    version: 1,
    algorithmVersion: EXPERIMENT_PACKAGE_INTEGRITY_ALGORITHM,
    packageDefinitionSha256: packageValue.integrity.packageDefinitionSha256,
    canonicalSourceByteSha256: first.canonicalSourceByteSha256,
    settingsSha256: packageValue.integrity.settingsSha256,
    assetManifestSha256: packageValue.integrity.assetManifestSha256,
    experimentPlanSha256: packageValue.integrity.experimentPlanSha256,
    protocolMatrixSha256: packageValue.integrity.protocolMatrixSha256,
    independentCaseReceiptSha256: caseMatrixSha256,
    cases,
    participantCount: packageValue.settings.experiment.participantCount,
    languageCount: routes.length,
    caseCount: cases.length,
    canonicalByteLength: encoder.encode(canonicalSourceText).byteLength,
    byteIdenticalReexport: true,
    verificationScope: "same-realm-diagnostic",
    sameRealmDeterminismVerified: true,
    independentProcessIsolationVerified: false,
    ambientIsolationVerified: false,
  });
}
