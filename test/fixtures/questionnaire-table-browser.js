import { createQuestionnaireEditor } from '../../site/src/research/questionnaire-editor.js';
import { renderResearchUiMarkup } from '../../site/src/research/ui-view.js';
import { importQuestionnaireAuthoring } from '../../site/src/research/questionnaire-authoring.js';
import { initializeResearchUi } from '../../site/src/research/app.js';
import { createCoveredFlatLanguageSelectionV1 } from '../../site/src/research/questionnaire-assets.js';
import { QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION } from '../../site/src/research/external-protocol.js';
import english from '../../site/questionnaires/maia-2-en.csv';
import german from '../../site/questionnaires/maia-2-de.csv';

// DOM-only fixture events in a separate headless process. Never reads or writes
// the OS clipboard, attaches to a user's browser, or injects desktop input.
const results = [];
const check = (name, ok) => { if (!ok) throw new Error(name); results.push(name); };
const root = document.querySelector('main');
root.innerHTML = renderResearchUiMarkup('browser');
root.querySelectorAll('details').forEach(d => { d.open = true; });
const saved = [];
const editor = createQuestionnaireEditor({ root, onSave: async receipt => { saved.push(receipt); } });
const context = (family = 'custom') => ({ families: [{ id: family, label: family }],
  languages: [{ languageTag: 'en', label: 'English' }, { languageTag: 'de', label: 'Deutsch' }],
  definitions: [], familyForDefinition: () => family, locked: false });
const cell = (r,c,key='custom/en') => root.querySelector(`[data-sheet-key="${key}"] [data-sheet-cell="${r}:${c}"]`);
const action = name => root.querySelector(`[data-sheet-key="custom/en"] [data-sheet-action="${name}"]`);
function paste(target, text) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
  target.dispatchEvent(event);
}
function copy(target) {
  let text = null;
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { setData: (_type,value) => { text = value; } } });
  target.dispatchEvent(event); return text;
}
const key = (target, key, extra={}) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles:true, cancelable:true, ...extra }));
const click = (target, shiftKey=false) => target.dispatchEvent(new MouseEvent('click', { bubbles:true, shiftKey }));
const full = 'Item\tAnswer 1\tCode 1\tAnswer 2\tCode 2\tRequired\r\nFirst\tNever\t4\tAlways\t1\ttrue\r\nSecond\tNo\t0\tYes\t1\tfalse\r\n';

(async () => {
  editor.sync(context());
  paste(cell(0,0), full);
  check('full Excel table fills prompts, labels, codes, required and option count',
    cell(0,1).value === 'Never' && cell(0,2).value === '4' && cell(1,5).value === 'false' && !cell(2,0));
  check('other language remains an independent empty table', cell(0,0,'custom/de').value === '');
  click(cell(0,1)); click(cell(1,2), true);
  cell(1,2).setSelectionRange(0,1);
  check('multi-cell copy wins over stale textarea text selection', copy(cell(1,2)) === 'Never\t4\r\nNo\t0\r\n');
  key(cell(1,2), 'Tab');
  paste(cell(1,4), '7');
  check('Tab clears the old selection and paste uses the new cell', cell(1,4).value === '7' && cell(0,1).value === 'Never');
  click(cell(0,0)); key(cell(0,0), 'a', {ctrlKey:true});
  const tableCopy = copy(cell(0,0));
  check('select-all copy includes all visible columns and rows', tableCopy.split('\r\n').filter(Boolean).length === 2 && tableCopy.includes('Always\t1\ttrue'));
  action('add-row').click();
  check('rerender discards invisible cell selections', root.querySelectorAll('.sheet-cell-selected').length === 0);
  paste(cell(1,4), '8');
  check('paste after rerender edits only the chosen cell', cell(1,4).value === '8' && cell(0,0).value === 'First');
  action('undo').click();
  check('Undo restores the prior table and its numeric codes', cell(1,4).value === '7');
  const before = [...root.querySelectorAll('[data-sheet-key="custom/en"] [data-sheet-cell]')].map(c=>c.value).join('|');
  paste(cell(0,0), full.replace('\t4\t', '\t=2+2\t'));
  check('malformed paste rejects without partial DOM/data mutation', before === [...root.querySelectorAll('[data-sheet-key="custom/en"] [data-sheet-cell]')].map(c=>c.value).join('|'));
  paste(cell(0,0), full);
  const layout = root.querySelector('[data-sheet-key="custom/en"] [data-sheet-layout]');
  layout.value = 'codes-only'; layout.dispatchEvent(new Event('change',{bubbles:true}));
  paste(cell(0,0), 'Revised\t2\t3');
  await editor.save('custom/en');
  check('codes-only edit saves visible labels separately from custom codes', saved[0].definition.items[0].options[0].label === 'Never' && saved[0].definition.items[0].options[0].scoreValue === 2 && typeof saved[0].expectedPresetToken === 'symbol');
  check('saved table reports saved state', root.querySelector('[data-sheet-key="custom/en"] .sheet-save-state').textContent === 'Saved');
  check('one prebuilt selector replaces dedicated questionnaire toolbar buttons', Boolean(root.querySelector('#questionnaire-prebuilt-open')) && !root.querySelector('[data-questionnaire-preset]'));
  editor.sync(context('maia-2'));
  for (const [language, source] of [['en',english],['de',german]]) {
    const imported = await importQuestionnaireAuthoring(source, { logicalName:`maia-2-${language}.csv`, sourceKind:'bundled' });
    editor.loadDefinition(imported.definition, { familyId:'maia-2', authoringResult:imported });
    check(`MAIA-2 ${language} preloads all items, answer labels and codes`, Boolean(cell(36,12,`maia-2/${language}`)) && cell(0,1,`maia-2/${language}`).value === imported.definition.items[0].options[0].label && cell(0,2,`maia-2/${language}`).value === String(imported.definition.items[0].options[0].scoreValue));
  }
  check('all editable cells have accessible item/column labels', [...root.querySelectorAll('[data-sheet-cell]')].every(c=>Boolean(c.getAttribute('aria-label'))));
  const definitions = [];
  for (const [language,source] of [['en',english],['de',german]]) definitions.push((await importQuestionnaireAuthoring(source,{logicalName:`maia-2-${language}.csv`,sourceKind:'bundled'})).definition);
  const modules = definitions.map(d=>({schema:'affect-research-questionnaire-module',version:2,moduleId:d.questionnaireId,questionnaireId:d.questionnaireId,definitionSha256:d.definitionSha256,placement:{kind:'beforeSession',blockId:null}}));
  const languages = ['en','de'].map(language=>({languageId:language,languageTag:language,label:language}));
  const contribution = {questionnaires:{algorithmVersion:QUESTIONNAIRE_HOOKS_V2_ALGORITHM_VERSION,definitions,modules},
    languageSelection:createCoveredFlatLanguageSelectionV1({definitions,modules,languages,requestedFamilyIds:['maia-2']})};
  const appRoot = document.createElement('section'); document.body.append(appRoot);
  appRoot.innerHTML = renderResearchUiMarkup('browser');
  const app = initializeResearchUi(appRoot,{surface:'browser'});
  const restored = await app.restoreQuestionnaireContribution(contribution);
  check('app restoration reopens full accepted multilingual content as editable tables', !restored.pending && appRoot.querySelectorAll('[data-sheet-key]').length === 2 && !appRoot.querySelector('[data-sheet-cell="0:0"]').disabled);
  const promptCell = appRoot.querySelector('[data-sheet-cell="0:0"]');
  promptCell.value = 'A pending edit'; promptCell.dispatchEvent(new Event('input',{bubbles:true}));
  const pending = app.getQuestionnaireContributionSnapshot();
  check('app contribution revision advances and blocks export after a table edit', pending.pending && pending.revision > restored.revision);
  let superseded = false;
  try { await app.restoreQuestionnaireContribution(contribution,{isCurrent:()=>false}); } catch { superseded = true; }
  check('superseded restore does not replace the visible pending draft', superseded && promptCell.value === 'A pending edit');
  const reopened = await app.restoreQuestionnaireContribution(contribution);
  check('explicit restore resets old drafts without losing full canonical content', !reopened.pending && JSON.stringify(reopened.contribution) === JSON.stringify(contribution));
  appRoot.querySelector('[data-study-language-remove="de"]').click();
  const removedLanguage = app.getQuestionnaireContributionSnapshot();
  check('removing a language removes only its accepted variants and prevents orphaned export references', !removedLanguage.pending && removedLanguage.contribution.questionnaires.definitions.length === 1 && removedLanguage.contribution.questionnaires.definitions[0].language === 'en' && removedLanguage.contribution.languageSelection.languages.length === 1);
  app.destroy();
  document.querySelector('#receipt').textContent = JSON.stringify({passed:true, cases:results.length, results});
})().catch(error => { document.querySelector('#receipt').textContent = JSON.stringify({passed:false, error:error.stack, results}); });
