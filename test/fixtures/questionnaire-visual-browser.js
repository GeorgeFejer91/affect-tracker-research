import { bootResearchUi } from '../../site/src/research/app.js';
import { importQuestionnaireAuthoring } from '../../site/src/research/questionnaire-authoring.js';
import { createCoveredFlatLanguageSelectionV1 } from '../../site/src/research/questionnaire-assets.js';
import { QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION } from '../../site/src/research/external-protocol.js';
import english from '../../site/questionnaires/maia-2-en.csv';
import german from '../../site/questionnaires/maia-2-de.csv';

(async () => {
  const root = bootResearchUi({surface:'browser'});
  const state = location.hash.slice(1) || 'empty';
  if (state === 'populated') {
    const definitions=[];
    for (const [language,source] of [['en',english],['de',german]]) definitions.push((await importQuestionnaireAuthoring(source,{logicalName:`maia-2-${language}.csv`,sourceKind:'bundled'})).definition);
    const modules=definitions.map(d=>({schema:'affect-research-questionnaire-module',version:2,moduleId:d.questionnaireId,questionnaireId:d.questionnaireId,definitionSha256:d.definitionSha256,placement:{kind:'beforeSession',blockId:null}}));
    const languages=[{languageId:'en',languageTag:'en',label:'English'},{languageId:'de',languageTag:'de',label:'Deutsch'}];
    await root.researchUi.restoreQuestionnaireContribution({questionnaires:{algorithmVersion:QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,definitions,modules},languageSelection:createCoveredFlatLanguageSelectionV1({definitions,modules,languages,requestedFamilyIds:['maia-2']})});
  } else if (state === 'error') {
    root.querySelector('#questionnaire-add-blank').click();
    const cell=root.querySelector('[data-sheet-cell="0:2"]');
    cell.value='invalid'; cell.dispatchEvent(new Event('input',{bubbles:true}));
  }
  root.researchUi.openSetupSection('questionnaires');
  root.dataset.visualReceipt=state;
})().catch(error=>{document.body.dataset.visualError=error.message;});
