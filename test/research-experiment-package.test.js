import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createDefaultResearchSettings } from "../site/src/research/contracts.js";
import {
  EXTERNAL_ORDER_ALGORITHM_VERSION,
  parseExperimentDefinitionV1,
} from "../site/src/research/external-experiment.js";
import {
  QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
  validateResearchSettingsV3,
} from "../site/src/research/external-protocol.js";
import {
  EXPERIMENT_PACKAGE_RECOVERY_BINDING_SCHEMA,
  compileExperimentPackageSelectionV1,
  createExperimentPackageV1,
  createFlatLanguageSelectionV1,
  enumerateLanguageRoutesV1,
  parseExperimentPackageV1,
  participantAssignmentSha256V1,
  projectExperimentPackageRecoveryBindingV1,
  projectParticipantAssignmentV1,
  resolveLanguageSelectionTraversalStepV1,
  serializeExperimentPackageV1,
  validateExperimentPackageV1,
  validateExperimentPackageRunBindingV1,
  validateExperimentPackageRecoveryBindingV1,
  validateLanguageSelectionTreeV1,
  verifySameRealmPackageReproductionV1,
} from "../site/src/research/experiment-package.js";
import { importQuestionnaireCsv } from "../site/src/research/questionnaires.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const execFileAsync = promisify(execFile);

function nestedLanguageSelection(questionnaireModuleIds = []) {
  return validateLanguageSelectionTreeV1({
    algorithmVersion: "language-tree-v1",
    rootNodeId: "language-family",
    languages: [
      {
        languageId: "en",
        languageTag: "en",
        label: "English",
        questionnaireModuleIds,
      },
      {
        languageId: "de",
        languageTag: "de",
        label: "Deutsch",
        questionnaireModuleIds: [],
      },
    ],
    nodes: [
      {
        nodeId: "language-family",
        prompt: "Choose a language group",
        options: [
          {
            optionId: "international",
            label: "International",
            target: { kind: "node", nodeId: "international-language" },
          },
          {
            optionId: "de",
            label: "Deutsch",
            target: { kind: "language", languageId: "de" },
          },
        ],
      },
      {
        nodeId: "international-language",
        prompt: "Choose your language",
        options: [{
          optionId: "en",
          label: "English",
          target: { kind: "language", languageId: "en" },
        }],
      },
    ],
  });
}

async function fixture() {
  const definitionBytes = await readFile(new URL("../site/experiment-template.json", import.meta.url));
  const parsed = await parseExperimentDefinitionV1(definitionBytes);
  const questionnaireBytes = await readFile(
    new URL("../site/questionnaires/vr-exp-en.csv", import.meta.url),
  );
  const questionnaire = await importQuestionnaireCsv(questionnaireBytes, {
    sourceKind: "bundled",
    logicalName: "vr-exp-en.csv",
  });
  const defaults = createDefaultResearchSettings();
  const settings = await validateResearchSettingsV3({
    schema: defaults.schema,
    version: 3,
    experiment: {
      id: parsed.definition.experimentId,
      title: parsed.definition.title,
      participantCount: parsed.definition.schedules.length,
      samplingFrequencyHz: 137,
    },
    stimuli: {
      items: parsed.definition.stimuli.map((stimulus, index) => ({
        stimulusId: stimulus.stimulusId,
        title: stimulus.title,
        source: {
          kind: "workspaceFile",
          relativePath: stimulus.relativePath,
          mimeType: "video/mp4",
          sha256: hash(stimulus.relativePath),
          byteLength: new TextEncoder().encode(stimulus.relativePath).byteLength,
          durationMs: 12_345 + index,
        },
      })),
    },
    input: { ...defaults.input, stepSize: 0.25 },
    visual: {
      ...structuredClone(defaults.visual),
      transparency: 0.37,
      overlayPosition: { x: 0.17, y: 0.83 },
    },
    advanced: structuredClone(defaults.advanced),
    output: { csv: true, tsv: true },
    questionnaires: {
      algorithmVersion: QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,
      definitions: [questionnaire.definition],
      modules: [{
        schema: "affect-research-questionnaire-module",
        version: 2,
        moduleId: "vr-after-calm",
        questionnaireId: questionnaire.definition.questionnaireId,
        definitionSha256: questionnaire.definition.definitionSha256,
        placement: {
          kind: "afterStimulus",
          blockId: null,
          stimulusId: "calm-01",
          relativeToIsi: "before",
        },
      }, {
        schema: "affect-research-questionnaire-module",
        version: 2,
        moduleId: "vr-after-calm-followup",
        questionnaireId: questionnaire.definition.questionnaireId,
        definitionSha256: questionnaire.definition.definitionSha256,
        placement: {
          kind: "afterStimulus",
          blockId: null,
          stimulusId: "calm-01",
          relativeToIsi: "before",
        },
      }, {
        schema: "affect-research-questionnaire-module",
        version: 2,
        moduleId: "vr-after-calm-isi",
        questionnaireId: questionnaire.definition.questionnaireId,
        definitionSha256: questionnaire.definition.definitionSha256,
        placement: {
          kind: "afterStimulus",
          blockId: null,
          stimulusId: "calm-01",
          relativeToIsi: "after",
        },
      }],
    },
    externalProtocol: {
      algorithmVersion: EXTERNAL_ORDER_ALGORITHM_VERSION,
      sourceByteSha256: parsed.sourceByteSha256,
      definitionSha256: parsed.definitionSha256,
      definition: parsed.definition,
    },
  });
  const languageSelection = createFlatLanguageSelectionV1([
    {
      languageId: "en",
      languageTag: "en",
      label: "English",
      questionnaireModuleIds: [
        "vr-after-calm-followup",
        "vr-after-calm",
        "vr-after-calm-isi",
      ],
    },
    { languageId: "de", languageTag: "de", label: "Deutsch", questionnaireModuleIds: [] },
  ]);
  const packageValue = await createExperimentPackageV1({
    packageId: "demo-study-package",
    languageSelection,
    settings,
  });
  return { packageValue, settings };
}

test("ExperimentPackageV1 owns canonical settings, fixed assets, playback, language tree, order, and ISIs", async () => {
  const { packageValue } = await fixture();
  assert.equal(packageValue.assetRoot, "assets/stimuli");
  assert.equal(packageValue.playback.algorithmVersion, "complete-video-v1");
  assert.equal(packageValue.playback.startAtMs, 0);
  assert.equal(packageValue.playback.endCondition, "decodedEnd");
  assert.deepEqual(
    packageValue.assets.stimuli.map(({ relativePath }) => relativePath),
    ["assets/stimuli/active-01.mp4", "assets/stimuli/calm-01.mp4"],
  );
  assert.equal(packageValue.settings.experiment.samplingFrequencyHz, 137);
  assert.equal(packageValue.settings.input.stepSize, 0.25);
  assert.equal(packageValue.settings.visual.transparency, 0.37);
  assert.equal(packageValue.settings.questionnaires.definitions.length, 1);
  assert.equal(packageValue.settings.questionnaires.modules[0].placement.kind, "afterStimulus");
  assert.deepEqual(packageValue.languageSelection.languages.map((language) => ({
    languageId: language.languageId,
    questionnaireModuleIds: language.questionnaireModuleIds,
  })), [{
    languageId: "en",
    questionnaireModuleIds: [
      "vr-after-calm-followup",
      "vr-after-calm",
      "vr-after-calm-isi",
    ],
  }, {
    languageId: "de",
    questionnaireModuleIds: [],
  }]);
  assert.deepEqual(
    packageValue.settings.externalProtocol.definition.schedules[0].blocks
      .flatMap(({ videos }) => videos.map(({ stimulusId, isiAfterMs }) => [stimulusId, isiAfterMs])),
    [["calm-01", 3_000], ["active-01", 0]],
  );
  assert.equal(enumerateLanguageRoutesV1(packageValue.languageSelection).length, 2);
  assert.deepEqual(await validateExperimentPackageV1(packageValue), packageValue);
});

test("the checked-in cross-runtime package fixture is the exact canonical JS serialization", async () => {
  const { packageValue } = await fixture();
  const checkedIn = await readFile(
    new URL("./fixtures/experiment-package-v1.canonical.json", import.meta.url),
    "utf8",
  );
  assert.equal(checkedIn, await serializeExperimentPackageV1(packageValue));
  assert.equal(checkedIn.endsWith("\n"), true);
});

test("two hostile clean process instances reconstruct one closed package root byte-identically", async () => {
  const verifierPath = new URL("../scripts/verify-experiment-package-instance.js", import.meta.url);
  const leftDirectory = await mkdtemp(join(tmpdir(), "affect-package-left-"));
  const rightDirectory = await mkdtemp(join(tmpdir(), "affect-package-right-"));
  const packageRoot = await mkdtemp(join(tmpdir(), "affect-package-root-"));
  try {
    const { packageValue: flatPackage } = await fixture();
    const packageValue = await createExperimentPackageV1({
      packageId: flatPackage.packageId,
      languageSelection: nestedLanguageSelection([
        "vr-after-calm-followup",
        "vr-after-calm",
        "vr-after-calm-isi",
      ]),
      settings: flatPackage.settings,
    });
    const packageBytes = new TextEncoder().encode(
      await serializeExperimentPackageV1(packageValue),
    );
    const packagePath = join(packageRoot, "experiment.package.json");
    await writeFile(packagePath, packageBytes);
    await chmod(packagePath, 0o444);
    for (const asset of packageValue.assets.stimuli) {
      const assetPath = join(packageRoot, ...asset.relativePath.split("/"));
      await mkdir(join(packageRoot, ...asset.relativePath.split("/").slice(0, -1)), {
        recursive: true,
      });
      await writeFile(assetPath, asset.relativePath.replace(/^assets\//u, ""), "utf8");
      await chmod(assetPath, 0o444);
    }
    const run = (cwd, variant) => execFileAsync(process.execPath, [
      fileURLToPath(verifierPath),
      packageRoot,
      cwd,
    ], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        TZ: variant === "left" ? "Pacific/Kiritimati" : "America/Adak",
        LANG: variant === "left" ? "tr_TR.UTF-8" : "ja_JP.UTF-8",
        LC_ALL: variant === "left" ? "tr_TR.UTF-8" : "ja_JP.UTF-8",
        AFFECT_RESEARCH_BENCHMARK_DIRECTORY_ORDER: variant === "left" ? "forward" : "reverse",
        AFFECT_RESEARCH_BENCHMARK_CLOCK_SEED: variant === "left" ? "111" : "999",
        AFFECT_RESEARCH_BENCHMARK_RNG_SEED: variant === "left" ? "alpha" : "omega",
        AFFECT_RESEARCH_BENCHMARK_STORAGE_SENTINEL: variant,
      },
    });
    const [left, right] = await Promise.all([
      run(leftDirectory, "left"),
      run(rightDirectory, "right"),
    ]);
    assert.equal(left.stderr, "");
    assert.equal(right.stderr, "");
    assert.equal(left.stdout, right.stdout);
    assert.deepEqual(await readdir(leftDirectory), []);
    assert.deepEqual(await readdir(rightDirectory), []);
    const receipt = JSON.parse(left.stdout);
    assert.equal(receipt.schema, "affect-research-independent-package-instance-receipt");
    assert.equal(receipt.cases.length, 4);
    assert.equal(receipt.verifiedAssetCount, 2);
    assert.equal(receipt.ambientGuardVersion, "package-ambient-guard-v1");
    assert.equal(receipt.ambientDefaultReadCount, 0);
    assert.equal(receipt.emptyProfileVerified, true);
    assert.match(receipt.assetTreeSha256, /^[a-f0-9]{64}$/u);
    assert.equal(receipt.canonicalSourceByteSha256, hash(await readFile(packagePath)));
    assert.equal(receipt.assetManifestSha256, packageValue.integrity.assetManifestSha256);
    for (const entry of receipt.cases) {
      assert.equal(entry.canonicalSourceByteSha256, receipt.canonicalSourceByteSha256);
      assert.equal(entry.assetManifestSha256, receipt.assetManifestSha256);
      assert.notEqual(entry.assignmentSha256, entry.experimentPlanSha256);
    }
    assert.equal(new Set(receipt.cases
      .filter(({ languageId }) => languageId === "en")
      .map(({ assignmentSha256 }) => assignmentSha256)).size, 2);
    assert.deepEqual(
      [...new Set(receipt.cases
        .filter(({ languageId }) => languageId === "en")
        .map(({ languageSelectionPath }) => JSON.stringify(languageSelectionPath)))],
      [JSON.stringify(["international", "en"])],
    );

    const extraAsset = join(packageRoot, "assets", "stimuli", "undeclared.bin");
    await writeFile(extraAsset, "undeclared", "utf8");
    await chmod(extraAsset, 0o444);
    await assert.rejects(
      run(leftDirectory, "left"),
      /missing, extra, or undeclared files/u,
    );
  } finally {
    await Promise.all([
      rmdir(leftDirectory),
      rmdir(rightDirectory),
      rm(packageRoot, { recursive: true, force: true }),
    ]);
  }
});

test("participant-facing language traversal follows nested prompts and requires an explicit terminal choice", () => {
  const tree = nestedLanguageSelection(["vr-after-calm"]);
  const root = resolveLanguageSelectionTraversalStepV1(tree);
  assert.deepEqual(root, {
    kind: "choice",
    nodeId: "language-family",
    prompt: "Choose a language group",
    optionIds: [],
    labels: [],
    options: [
      { optionId: "international", label: "International" },
      { optionId: "de", label: "Deutsch" },
    ],
  });

  const nested = resolveLanguageSelectionTraversalStepV1(tree, ["international"]);
  assert.equal(nested.kind, "choice");
  assert.equal(nested.nodeId, "international-language");
  assert.equal(nested.prompt, "Choose your language");
  assert.deepEqual(nested.optionIds, ["international"]);
  assert.deepEqual(nested.options, [{ optionId: "en", label: "English" }]);

  const terminal = resolveLanguageSelectionTraversalStepV1(
    tree,
    ["international", "en"],
  );
  assert.deepEqual(terminal, {
    kind: "terminal",
    languageId: "en",
    languageTag: "en",
    languageLabel: "English",
    questionnaireModuleIds: ["vr-after-calm"],
    optionIds: ["international", "en"],
    labels: ["International", "English"],
  });
  assert.throws(
    () => resolveLanguageSelectionTraversalStepV1(tree, ["en"]),
    /not available at node language-family/u,
  );
  assert.throws(
    () => resolveLanguageSelectionTraversalStepV1(tree, ["de", "extra"]),
    /continues beyond a terminal language/u,
  );
});

test("a single-language tree still presents one explicit participant choice", () => {
  const tree = createFlatLanguageSelectionV1([{
    languageId: "en",
    languageTag: "en",
    label: "English",
    questionnaireModuleIds: [],
  }]);
  const first = resolveLanguageSelectionTraversalStepV1(tree);
  assert.equal(first.kind, "choice");
  assert.deepEqual(first.options, [{ optionId: "en", label: "English" }]);
  assert.equal(resolveLanguageSelectionTraversalStepV1(tree, ["en"]).kind, "terminal");
});

test("recoverable package language projection is narrow, exact, and hash-bound", async () => {
  const { packageValue } = await fixture();
  const sourceText = await serializeExperimentPackageV1(packageValue);
  const compiled = await compileExperimentPackageSelectionV1(packageValue, {
    languageId: "en",
    languageSelectionPath: ["en"],
    participantId: "P001",
  });
  const projected = projectExperimentPackageRecoveryBindingV1({
    participantId: "P001",
    attemptNumber: 3,
    context: {
      experimentPackage: {
        packageId: packageValue.packageId,
        sourceByteSha256: hash(sourceText),
        packageDefinitionSha256: packageValue.integrity.packageDefinitionSha256,
        languageId: "en",
        languageSelectionPath: ["en"],
        assignmentSha256: compiled.assignmentSha256,
        sourceText,
        assetBindings: compiled.assetBindings,
      },
    },
  });
  assert.deepEqual(projected, {
    schema: EXPERIMENT_PACKAGE_RECOVERY_BINDING_SCHEMA,
    version: 1,
    participantId: "P001",
    attemptNumber: 3,
    disposition: "resume-compatible",
    packageId: packageValue.packageId,
    canonicalSourceByteSha256: hash(sourceText),
    packageDefinitionSha256: packageValue.integrity.packageDefinitionSha256,
    languageId: "en",
    languageSelectionPath: ["en"],
    assignmentSha256: compiled.assignmentSha256,
  });
  for (const forbidden of ["sourceText", "assetBindings", "settings", "workspaceId", "runId"]) {
    assert.equal(Object.hasOwn(projected, forbidden), false, forbidden);
  }
  assert.throws(
    () => validateExperimentPackageRecoveryBindingV1({ ...projected, path: "C:/private" }),
    /unknown field path/u,
  );
  assert.throws(
    () => validateExperimentPackageRecoveryBindingV1({ ...projected, languageSelectionPath: [] }),
    /must contain/u,
  );
  assert.equal(projectExperimentPackageRecoveryBindingV1({ context: {} }), null);
});

test("same-realm package diagnostic replays every participant and language without claiming isolation", async () => {
  const { packageValue } = await fixture();
  const source = await serializeExperimentPackageV1(packageValue);
  const left = await parseExperimentPackageV1(new TextEncoder().encode(source));
  const right = await parseExperimentPackageV1(new TextEncoder().encode(source));
  assert.equal(await serializeExperimentPackageV1(left.package), source);
  assert.equal(await serializeExperimentPackageV1(right.package), source);
  assert.equal(left.sourceText, left.canonicalSourceText);
  assert.equal(left.sourceByteSha256, right.sourceByteSha256);
  assert.equal(left.sourceByteSha256, left.canonicalSourceByteSha256);
  const receipt = await verifySameRealmPackageReproductionV1(packageValue);
  assert.equal(receipt.byteIdenticalReexport, true);
  assert.equal(receipt.verificationScope, "same-realm-diagnostic");
  assert.equal(receipt.sameRealmDeterminismVerified, true);
  assert.equal(receipt.independentProcessIsolationVerified, false);
  assert.equal(receipt.ambientIsolationVerified, false);
  assert.equal(receipt.participantCount, 2);
  assert.equal(receipt.languageCount, 2);
  assert.equal(receipt.caseCount, 4);

  const compiled = await compileExperimentPackageSelectionV1(packageValue, {
    languageId: "de",
    languageSelectionPath: ["de"],
    participantId: "P002",
  });
  assert.equal(compiled.languageTag, "de");
  assert.deepEqual(compiled.languageSelectionPath, ["de"]);
  assert.deepEqual(compiled.protocolPlan.steps.filter(({ kind }) => kind === "interval")
    .map(({ durationMs }) => durationMs), [3_000, 0]);
  assert.equal(compiled.assetBindings[0].packagePath, "assets/stimuli/active-01.mp4");
  assert.equal(compiled.protocolPlan.steps.some(({ kind }) => kind === "questionnaire"), false);
  assert.deepEqual(compiled.assignment, {
    participantId: "P002",
    blockOrder: ["main"],
    slots: [
      { position: 1, blockId: "main", poolPosition: 1, stimulusId: "active-01", isiAfterMs: 3_000 },
      { position: 2, blockId: "main", poolPosition: 2, stimulusId: "calm-01", isiAfterMs: 0 },
    ],
  });
  assert.equal(
    compiled.assignmentSha256,
    await participantAssignmentSha256V1(compiled.experimentPlan, "P002"),
  );
  assert.notEqual(
    compiled.assignmentSha256,
    compiled.experimentPlan.planHashSha256,
    "a participant assignment digest must not alias the aggregate experiment-plan digest",
  );

  const english = await compileExperimentPackageSelectionV1(packageValue, {
    languageId: "en",
    languageSelectionPath: ["en"],
    participantId: "P001",
  });
  assert.deepEqual(english.settings.questionnaires.modules.map(({ moduleId }) => moduleId), [
    "vr-after-calm-followup",
    "vr-after-calm",
    "vr-after-calm-isi",
  ]);
  assert.deepEqual(english.protocolPlan.steps.map((step) => (
    step.kind === "questionnaire" ? `${step.kind}:${step.relativeToIsi}` : step.kind
  )), [
    "stimulus",
    "questionnaire:before",
    "questionnaire:before",
    "interval",
    "questionnaire:after",
    "stimulus",
    "interval",
  ]);
  assert.deepEqual(english.protocolPlan.steps
    .filter(({ kind }) => kind === "questionnaire")
    .map(({ moduleId }) => moduleId), [
    "vr-after-calm-followup",
    "vr-after-calm",
    "vr-after-calm-isi",
  ]);

  const binding = await validateExperimentPackageRunBindingV1({
    schema: "affect-research-experiment-package-run-binding",
    version: 1,
    sourceText: source,
    sourceByteSha256: left.sourceByteSha256,
    packageDefinitionSha256: packageValue.integrity.packageDefinitionSha256,
    packageId: packageValue.packageId,
    languageId: english.languageId,
    languageSelectionPath: english.languageSelectionPath,
    assignmentSha256: english.assignmentSha256,
    assetBindings: english.assetBindings,
  }, {
    settings: english.settings,
    experimentPlan: english.experimentPlan,
    protocolPlan: english.protocolPlan,
    participantId: "P001",
  });
  assert.equal(binding.sourceText, source);
  assert.equal(binding.languageId, "en");
  assert.equal(binding.assignmentSha256, english.assignmentSha256);

  const otherAssignment = await projectParticipantAssignmentV1(
    english.experimentPlan,
    "P002",
  );
  assert.notDeepEqual(otherAssignment, english.assignment);
  await assert.rejects(validateExperimentPackageRunBindingV1({
    ...binding,
    assignmentSha256: compiled.assignmentSha256,
  }, {
    settings: english.settings,
    experimentPlan: english.experimentPlan,
    protocolPlan: english.protocolPlan,
    participantId: "P001",
  }), /does not reproduce the frozen participant protocol/u);
});

test("package mutation, asset drift, hidden playback defaults, and malformed language graphs fail closed", async () => {
  const { packageValue } = await fixture();
  const unknown = structuredClone(packageValue);
  unknown.generator = "ambient";
  await assert.rejects(validateExperimentPackageV1(unknown), /unknown field generator/u);

  const changedSetting = structuredClone(packageValue);
  changedSetting.settings.visual.transparency = 0.5;
  await assert.rejects(validateExperimentPackageV1(changedSetting), /integrity|hash/u);

  const changedAsset = structuredClone(packageValue);
  changedAsset.assets.stimuli[0].sha256 = "f".repeat(64);
  await assert.rejects(validateExperimentPackageV1(changedAsset), /bind|integrity|hash/u);

  const changedPlayback = structuredClone(packageValue);
  changedPlayback.playback.loop = true;
  await assert.rejects(validateExperimentPackageV1(changedPlayback), /complete-video-v1/u);

  for (const encodedUnsafePath of [
    "assets/stimuli/%4eUL.mp4",
    "assets/stimuli/video%3aone.mp4",
    "assets/stimuli/video%00one.mp4",
    "assets/stimuli/video%7fone.mp4",
    "assets/stimuli/%2e%2e/escape.mp4",
    "assets/stimuli/%252e%252e/escape.mp4",
  ]) {
    const unsafeAsset = structuredClone(packageValue);
    unsafeAsset.assets.stimuli[0].relativePath = encodedUnsafePath;
    await assert.rejects(
      validateExperimentPackageV1(unsafeAsset),
      /safe relative path|encoded unsafe path/u,
      encodedUnsafePath,
    );
  }

  const duplicateKey = (await serializeExperimentPackageV1(packageValue))
    .replace('{"assetRoot"', '{"schema":"shadow","assetRoot"');
  await assert.rejects(
    parseExperimentPackageV1(new TextEncoder().encode(duplicateKey)),
    /Duplicate JSON key/u,
  );

  const canonicalSource = await serializeExperimentPackageV1(packageValue);
  const canonicalValue = JSON.parse(canonicalSource);
  for (const noncanonicalSource of [
    canonicalSource.replace('{"assetRoot"', '{ "assetRoot"'),
    canonicalSource.trimEnd(),
    canonicalSource.replace(/\n$/u, "\r\n"),
    `${JSON.stringify(canonicalValue, null, 2)}\n`,
    `${JSON.stringify({ schema: canonicalValue.schema, ...canonicalValue })}\n`,
  ]) {
    await assert.rejects(
      parseExperimentPackageV1(new TextEncoder().encode(noncanonicalSource)),
      /exact canonical UTF-8 JSON bytes/u,
    );
  }
  const withBom = Uint8Array.from([
    0xef, 0xbb, 0xbf, ...new TextEncoder().encode(canonicalSource),
  ]);
  await assert.rejects(
    parseExperimentPackageV1(withBom),
    /exact canonical UTF-8 JSON bytes/u,
  );

  const unmappedModule = structuredClone(packageValue);
  for (const language of unmappedModule.languageSelection.languages) {
    language.questionnaireModuleIds = [];
  }
  await assert.rejects(
    validateExperimentPackageV1(unmappedModule),
    /not explicitly mapped/u,
  );

  const wrongLanguage = structuredClone(packageValue);
  wrongLanguage.languageSelection.languages[0].questionnaireModuleIds = [];
  wrongLanguage.languageSelection.languages[1].questionnaireModuleIds = [
    "vr-after-calm-followup", "vr-after-calm", "vr-after-calm-isi",
  ];
  await assert.rejects(
    validateExperimentPackageV1(wrongLanguage),
    /incompatible language/u,
  );

  const unknownModule = structuredClone(packageValue);
  unknownModule.languageSelection.languages[0].questionnaireModuleIds[0] = "unknown-module";
  await assert.rejects(
    validateExperimentPackageV1(unknownModule),
    /maps unknown questionnaire module/u,
  );

  const duplicateModule = structuredClone(packageValue.languageSelection);
  duplicateModule.languages[0].questionnaireModuleIds.push("vr-after-calm");
  assert.throws(
    () => validateLanguageSelectionTreeV1(duplicateModule),
    /must not repeat a module ID/u,
  );
  const omittedMapping = structuredClone(packageValue.languageSelection);
  delete omittedMapping.languages[0].questionnaireModuleIds;
  assert.throws(
    () => validateLanguageSelectionTreeV1(omittedMapping),
    /missing required field questionnaireModuleIds/u,
  );

  assert.throws(() => validateLanguageSelectionTreeV1({
    algorithmVersion: "language-tree-v1",
    rootNodeId: "root",
    languages: [{
      languageId: "en",
      languageTag: "en",
      label: "English",
      questionnaireModuleIds: [],
    }],
    nodes: [
      { nodeId: "root", prompt: "Choose", options: [{ optionId: "next", label: "Next", target: { kind: "node", nodeId: "cycle" } }] },
      { nodeId: "cycle", prompt: "Again", options: [{ optionId: "back", label: "Back", target: { kind: "node", nodeId: "root" } }] },
    ],
  }), /rooted tree|cycles/u);
});
