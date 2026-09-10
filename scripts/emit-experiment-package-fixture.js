import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

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
  createExperimentPackageV1,
  createFlatLanguageSelectionV1,
  serializeExperimentPackageV1,
} from "../site/src/research/experiment-package.js";
import { importQuestionnaireCsv } from "../site/src/research/questionnaires.js";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const definitionSource = await readFile(new URL("../site/experiment-template.json", import.meta.url));
const definition = await parseExperimentDefinitionV1(definitionSource);
const questionnaireSource = await readFile(new URL(
  "../site/questionnaires/vr-exp-en.csv",
  import.meta.url,
));
const questionnaire = await importQuestionnaireCsv(questionnaireSource, {
  sourceKind: "bundled",
  logicalName: "vr-exp-en.csv",
});
const defaults = createDefaultResearchSettings();
const settings = await validateResearchSettingsV3({
  schema: defaults.schema,
  version: 3,
  experiment: {
    id: definition.definition.experimentId,
    title: definition.definition.title,
    participantCount: definition.definition.schedules.length,
    samplingFrequencyHz: 137,
  },
  stimuli: {
    items: definition.definition.stimuli.map((stimulus, index) => ({
      stimulusId: stimulus.stimulusId,
      title: stimulus.title,
      source: {
        kind: "workspaceFile",
        relativePath: stimulus.relativePath,
        mimeType: "video/mp4",
        sha256: sha256(stimulus.relativePath),
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
    sourceByteSha256: definition.sourceByteSha256,
    definitionSha256: definition.definitionSha256,
    definition: definition.definition,
  },
});
const packageValue = await createExperimentPackageV1({
  packageId: "demo-study-package",
  languageSelection: createFlatLanguageSelectionV1([
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
  ]),
  settings,
});

const serialized = await serializeExperimentPackageV1(packageValue);
if (process.argv.includes("--write")) {
  await writeFile(
    new URL("../test/fixtures/experiment-package-v1.canonical.json", import.meta.url),
    serialized,
    "utf8",
  );
} else {
  process.stdout.write(serialized);
}
