// Read-only software probes for the 2026-09-13 correspondence audit.
// Reproduced limitations are observations, not requirements to preserve defects.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../experiment-planner/web/src/research/canonical.js';
import { parseSupportedPlannerRecipe, compilePlannerRecipeV4 } from '../../experiment-planner/web/src/research/planner-recipe.js';
import { enumerateLanguageRoutesV1 } from '../../experiment-planner/web/src/research/experiment-package.js';
import { validatePlannerContributionSnapshot } from '../../experiment-planner/web/src/research/planner-contributions.js';
import { importSurveyJson } from '../../experiment-planner/web/src/research/surveyjs-definition.js';
import { createQuestionnairePresentationV3 } from '../../experiment-planner/web/src/research/questionnaire-recipe-v2.js';
import { resolveMasterPlan } from '../../experiment-runner/src/master-recipe.js';
import { NativeMasterProtocolAdapter } from '../../experiment-runner/src/master-protocol.js';

const encode = value => new TextEncoder().encode(canonicalJson(value) + '\n');
const report = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  probeSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  evidence: 'JavaScript software probes; no native execution, network, media, or XDF', versions: [], limitations: [] };
let latest;
for (const basename of ['planner-recipe-current-v1.canonical.json', 'planner-recipe-v2-mixed.canonical.json', 'planner-recipe-v3-locations.canonical.json', 'planner-recipe-v4-surveyjs.canonical.json']) {
  const bytes = new Uint8Array(await readFile(new URL(`../../test/fixtures/${basename}`, import.meta.url)));
  const start = performance.now();
  const receipt = await parseSupportedPlannerRecipe(bytes);
  assert.deepEqual(encode(receipt.recipe), bytes);
  let selections = 0;
  for (const variant of receipt.recipe.segments.P3.variants) {
    for (const route of enumerateLanguageRoutesV1(receipt.recipe.segments.P2.languageSelection)) {
      const plan = await resolveMasterPlan(receipt, 'P001', route.optionIds, variant.variantId);
      assert.deepEqual(plan.steps.filter(step => step.kind !== 'questionnaire').map(step => step.entryId), variant.entries.map(entry => entry.entryId));
      assert.equal(plan.steps.filter(step => step.kind === 'questionnaire').length, plan.selected.questionnaires.beforeSession.length + plan.selected.questionnaires.afterSession.length);
      assert.deepEqual(plan.selected.feedback, receipt.recipe.segments.P5);
      assert.deepEqual(plan.selected.policy, receipt.recipe.policy);
      assert.deepEqual(plan.selected.assets, receipt.recipe.segments.P1.videoCatalogue.entries);
      selections++;
    }
  }
  const missing = structuredClone(receipt.recipe); delete missing.segments.P2;
  await assert.rejects(parseSupportedPlannerRecipe(encode(missing)));
  const changed = structuredClone(receipt.recipe); changed.policy.participantCount++;
  await assert.rejects(parseSupportedPlannerRecipe(encode(changed)));
  report.versions.push({ version: receipt.recipe.version, bytes: bytes.length, selections, roundTrip: true, missingSegmentRejected: true, staleIntegrityRejected: true, elapsedMs: Math.round(performance.now() - start) });
  latest = receipt;
}

const remote = await importSurveyJson(JSON.stringify({ elements: [{ type: 'image', name: 'stimulus', imageLink: 'https://example.invalid/stimulus.png' }, { type: 'text', name: 'answer' }] }), { questionnaireId: 'remote-en', language: 'en' });
report.limitations.push({ id: 'remote-resource', accepted: true, retainedUrl: remote.definition.surveyJson.elements[0].imageLink, embeddedImageBytes: false });

const route = enumerateLanguageRoutesV1(latest.recipe.segments.P2.languageSelection)[0];
const plan = await resolveMasterPlan(latest, 'P001', route.optionIds, latest.recipe.segments.P3.variants[0].variantId);
report.limitations.push({ id: 'shallow-plan-freeze', planFrozen: Object.isFrozen(plan), stepsFrozen: Object.isFrozen(plan.steps), firstStepFrozen: Object.isFrozen(plan.steps[0]), selectorFrozen: Object.isFrozen(plan.selector) });
let invocations = 0;
const adapter = new NativeMasterProtocolAdapter({ invoke() { invocations++; throw new Error('Unexpected native call'); } });
try { await adapter.start(plan, { version: 4, participantId: 'P001' }, { validation: true }); }
catch (error) { report.limitations.push({ id: 'master4-validation', reason: error.message, nativeInvocations: invocations }); }

// Four independently valid definitions, each well below the documented 4 MiB
// definition limit, produce a master below its 16 MiB limit but above the
// separate 5 MiB owner-snapshot limit.
const { integrity, ...core } = structuredClone(latest.recipe);
const p2 = core.segments.P2;
for (let i = 0; i < p2.questionnaires.definitions.length; i++) {
  const old = p2.questionnaires.definitions[i];
  p2.questionnaires.definitions[i] = (await importSurveyJson(JSON.stringify({ elements: [{ type: 'html', name: 'instructions', html: `<p>${'x'.repeat(1400000)}</p>` }, { type: 'text', name: 'answer' }] }), { questionnaireId: old.questionnaireId, language: old.language })).definition;
}
for (const module of p2.questionnaires.modules) module.definitionSha256 = p2.questionnaires.definitions.find(d => d.questionnaireId === module.questionnaireId).definitionSha256;
p2.presentation = createQuestionnairePresentationV3(p2.questionnaires.definitions);
const largeRecipe = await compilePlannerRecipeV4(core);
const largeBytes = encode(largeRecipe);
await parseSupportedPlannerRecipe(largeBytes);
try { validatePlannerContributionSnapshot({ revision: 1, enabled: true, pending: false, contribution: largeRecipe.segments.P2, dependencyRevisions: [] }); }
catch (error) { report.limitations.push({ id: 'owner-size-mismatch', validMasterBytes: largeBytes.length, definitions: p2.questionnaires.definitions.length, p2Bytes: encode(p2).length, ownerRejection: error.message }); }
console.log(JSON.stringify(report, null, 2));
