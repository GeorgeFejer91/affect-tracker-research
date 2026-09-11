import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateQuestionnaireContribution, restoreQuestionnaireAuthoring, reconcileQuestionnaireModuleMappings } from "../site/src/research/questionnaire-contribution.js";
import { createQuestionnaireSheet, setQuestionnaireGridCell, sheetToAuthoring, sheetFromDefinition } from "../site/src/research/questionnaire-sheet.js";
import { updateQuestionnaireDefinitionReferences } from "../site/src/research/questionnaire-assets.js";
import { parseExperimentPackageV1, createExperimentPackageV1, serializeExperimentPackageV1 } from "../site/src/research/experiment-package.js";

async function fixture() {
  const { package: base } = await parseExperimentPackageV1(await readFile(new URL("./fixtures/experiment-package-v1.canonical.json", import.meta.url)));
  const definitions = [];
  for (const language of ["en", "de"]) {
    const sheet = createQuestionnaireSheet({ familyId:"study", language, optionCount:2, rowCount:1 });
    setQuestionnaireGridCell(sheet, 0, 0, language === "de" ? "Wie fühlen Sie sich?" : "How do you feel?");
    setQuestionnaireGridCell(sheet, 0, 1, language === "de" ? "Nie" : "Never");
    setQuestionnaireGridCell(sheet, 0, 2, 4);
    setQuestionnaireGridCell(sheet, 0, 3, language === "de" ? "Immer" : "Always");
    setQuestionnaireGridCell(sheet, 0, 4, 1);
    sheet.rows[0].subscale = "explicit-subscale";
    definitions.push((await sheetToAuthoring(sheet)).definition);
  }
  const modules = definitions.flatMap(d => [
    { schema:"affect-research-questionnaire-module", version:2, moduleId:`${d.language}-before`, questionnaireId:d.questionnaireId, definitionSha256:d.definitionSha256, placement:{kind:"beforeSession",blockId:null} },
    { schema:"affect-research-questionnaire-module", version:2, moduleId:`${d.language}-after`, questionnaireId:d.questionnaireId, definitionSha256:d.definitionSha256, placement:{kind:"afterStimulus",blockId:null,stimulusId:base.settings.stimuli.items[0].stimulusId,relativeToIsi:"after"} },
  ]);
  const contribution = { questionnaires:{algorithmVersion:base.settings.questionnaires.algorithmVersion, definitions, modules},
    languageSelection:{algorithmVersion:"language-tree-v1",rootNodeId:"root",languages:["en","de"].map(language => ({languageId:language,languageTag:language,label:language,questionnaireModuleIds:[`${language}-after`,`${language}-before`]})),nodes:[
      {nodeId:"root",prompt:"Choose group",options:[{optionId:"group",label:"Languages",target:{kind:"node",nodeId:"languages"}}]},
      {nodeId:"languages",prompt:"Choose language",options:["en","de"].map(language=>({optionId:language,label:language,target:{kind:"language",languageId:language}}))},
    ]} };
  return { base, contribution };
}

test("full restoration retains scientific identities, source receipts, hooks and nested routing", async () => {
  const { contribution } = await fixture();
  const restored = await restoreQuestionnaireAuthoring(contribution);
  assert.deepEqual(restored.contribution, contribution);
  assert.equal(restored.coverage.complete, true);
  assert.deepEqual(restored.families.map(f=>f.id), ["study"]);
  for (const d of restored.contribution.questionnaires.definitions) {
    assert.deepEqual((await sheetToAuthoring(sheetFromDefinition(d,{familyId:"study"}))).definition,d);
  }
  restored.contribution.questionnaires.definitions[0].title = "Independent copy";
  assert.notEqual(contribution.questionnaires.definitions[0].title, "Independent copy");
});

test("contribution rejects tampered hashes, dangling mappings, foreign languages and unknown fields", async () => {
  const { contribution } = await fixture();
  for (const mutate of [
    c=>{c.questionnaires.definitions[0].items[0].prompt="Tampered";},
    c=>{c.questionnaires.modules[0].definitionSha256="0".repeat(64);},
    c=>{c.languageSelection.languages[0].questionnaireModuleIds=["unknown"];},
    c=>{c.languageSelection.languages[0].questionnaireModuleIds=["de-before"];},
    c=>{c.questionnaires.extra=true;},
    c=>{c.extra=true;},
  ]) {
    const candidate=structuredClone(contribution); mutate(candidate);
    await assert.rejects(validateQuestionnaireContribution(candidate));
  }
});

test("missing selected-language assets stay incomplete rather than acquiring an invented translation", async () => {
  const { contribution }=await fixture();
  contribution.questionnaires.definitions=contribution.questionnaires.definitions.slice(0,1);
  contribution.questionnaires.modules=contribution.questionnaires.modules.filter(m=>m.questionnaireId==="study-en");
  contribution.languageSelection.languages[1].questionnaireModuleIds=[];
  const restored=await restoreQuestionnaireAuthoring(contribution);
  assert.equal(restored.coverage.complete,false);
  assert.equal(restored.coverage.missing[0].languageTag,"de");
});

test("mapping reconciliation preserves imported routes and module order while removing retired modules", async () => {
  const { contribution:c }=await fixture();
  const tree=reconcileQuestionnaireModuleMappings(c.languageSelection,c.questionnaires.definitions,c.questionnaires.modules.filter(m=>m.moduleId!=="en-before"));
  assert.deepEqual(tree.nodes,c.languageSelection.nodes);
  assert.deepEqual(tree.languages[0].questionnaireModuleIds,["en-after"]);
  assert.deepEqual(tree.languages[1],c.languageSelection.languages[1]);
});

function independentReopen(source) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[fileURLToPath(new URL("./fixtures/questionnaire-reopen-instance.js",import.meta.url))],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let output="",errors="";
    const timeout=setTimeout(()=>{child.kill();reject(new Error("Independent reopen timed out."));},20000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data",chunk=>{output+=chunk;}); child.stderr.on("data",chunk=>{errors+=chunk;});
    child.on("error",error=>{clearTimeout(timeout);reject(error);});
    child.on("close",code=>{clearTimeout(timeout);code===0?resolve(output):reject(new Error(errors));});
    child.stdin.on("error",reject); child.stdin.end(source);
  });
}

test("multilingual edit → package export → independent editable reopen → unchanged export is byte-identical", async () => {
  const {base,contribution:c}=await fixture();
  const original=await createExperimentPackageV1({...base, settings:{...base.settings,questionnaires:c.questionnaires},languageSelection:c.languageSelection});
  const sheet=sheetFromDefinition(c.questionnaires.definitions[1],{familyId:"study"});
  setQuestionnaireGridCell(sheet,0,2,-7);
  const revised=(await sheetToAuthoring(sheet)).definition;
  c.questionnaires.definitions[1]=revised;
  c.questionnaires.modules=updateQuestionnaireDefinitionReferences(c.questionnaires.modules,revised);
  const exported=await createExperimentPackageV1({...base,settings:{...base.settings,questionnaires:c.questionnaires},languageSelection:c.languageSelection});
  assert.notEqual(exported.integrity.packageDefinitionSha256,original.integrity.packageDefinitionSha256);
  assert.notEqual(exported.integrity.protocolMatrixSha256,original.integrity.protocolMatrixSha256);
  assert.deepEqual(exported.languageSelection,c.languageSelection);
  assert.equal(revised.items[0].options[0].label,"Nie");
  assert.equal(revised.items[0].subscale,"explicit-subscale");
  const source=await serializeExperimentPackageV1(exported);
  const [a,b]=await Promise.all([independentReopen(source),independentReopen(source)]);
  assert.equal(a,source); assert.equal(b,source);
});
