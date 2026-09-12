import { bootResearchUi } from '../../site/src/research/app.js';
import { importQuestionnaireAuthoring } from '../../site/src/research/questionnaire-authoring.js';
import { createCoveredFlatLanguageSelectionV1 } from '../../site/src/research/questionnaire-assets.js';
import { QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION } from '../../site/src/research/external-protocol.js';
import english from '../../site/questionnaires/maia-2-en.csv';
import german from '../../site/questionnaires/maia-2-de.csv';

(async () => {
  const root = bootResearchUi({surface:'browser'});
  const state = location.hash.slice(1) || 'empty';
  if (['populated','german','settings','footer'].includes(state)) {
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
  if (['german','settings','footer'].includes(state)) {
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    root.querySelector('[data-sheet-key="maia-2/en"]').open=false;
    const sheet=root.querySelector('[data-sheet-key="maia-2/de"]');
    sheet.open=true;
    const settings=sheet.querySelector('.sheet-options');
    settings.open=state!=='german';
    await new Promise(resolve=>setTimeout(resolve,1000));
    const target=state==='german' ? sheet : state==='settings' ? settings : sheet.querySelector('.sheet-footer');
    const pane=root.querySelector('.setup-pane');
    pane.scrollTop += target.getBoundingClientRect().top-pane.getBoundingClientRect().top-(state==='footer' ? pane.clientHeight/2 : 12);
    await new Promise(resolve=>setTimeout(resolve,100));
    if(pane.scrollTop===0) throw new Error(`Expected scrolled questionnaire pane: ${JSON.stringify({clientHeight:pane.clientHeight,scrollHeight:pane.scrollHeight,targetTop:target.getBoundingClientRect().top,paneTop:pane.getBoundingClientRect().top,connected:target.isConnected,overflow:getComputedStyle(pane).overflowY})}`);
    const selectors=['.sheet-heading','.sheet-options > summary','[data-sheet-meta="title"]','[data-sheet-meta="instructions"]','[data-sheet-required-all]','[data-sheet-repeat]','[data-sheet-meta="attribution"]','[data-sheet-action="preview"]','[data-sheet-action="save"]'];
    const rect=node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    const metrics=document.createElement('script');
    metrics.id='questionnaire-visual-metrics'; metrics.type='application/json';
    metrics.textContent=JSON.stringify({state,paneScrollTop:root.querySelector('.setup-pane').scrollTop,language:sheet.querySelector('.sheet-heading').textContent,settingsOpen:settings.open,controls:Object.fromEntries(selectors.map(selector=>[selector,rect(sheet.querySelector(selector))])),confirmation:rect(root.querySelector('[data-confirm-section="questionnaires"]'))});
    document.body.append(metrics);
  }
  root.dataset.visualReceipt=state;
})().catch(error=>{document.body.dataset.visualError=error.message;});
