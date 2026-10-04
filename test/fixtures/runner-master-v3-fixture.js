import {readFile,writeFile} from 'node:fs/promises';
import {compilePlannerRecipeV3,serializePlannerRecipeV3,reproducePlannerRecipeV3,reconstructPlannerRecipeSelectionV3} from '../../site/src/research/planner-recipe.js';
import {canonicalJson,canonicalSha256} from '../../site/src/research/canonical.js';
// Synthetic HTML geometry, never a decoded/qualified media receipt. Start from
// Main's mixed/location fixture; original P2/P3/P4/P5/P6 values remain intact.
export async function runnerMasterV3Fixture() {
 const {integrity,...core}=JSON.parse(await readFile(new URL('./planner-recipe-v2-locations.canonical.json',import.meta.url),'utf8'));
 core.version=3;core.recipeId='runner-html-fixture';core.segments.P1.version=3;
 const catalogue=core.segments.P1.videoCatalogue;catalogue.version=3;
 const {integritySha256,...catalogueCore}=catalogue;catalogue.integritySha256=await canonicalSha256(catalogueCore);
 const recipe=await compilePlannerRecipeV3(core),source=await serializePlannerRecipeV3(recipe),matrix=await reproducePlannerRecipeV3(recipe),selections=[];
 for(const {selectionSha256,...selector} of matrix.cases)selections.push(await reconstructPlannerRecipeSelectionV3(recipe,selector));
 return{recipe,source,selections};
}
if(process.argv[2]==='write-fixtures'){
 const f=await runnerMasterV3Fixture();
 await writeFile(new URL('./runner-master-v3-owner.canonical.json',import.meta.url),f.source,{flag:'wx'});
 await writeFile(new URL('./runner-master-v3-owner-selections.canonical.json',import.meta.url),canonicalJson(f.selections)+'\n',{flag:'wx'});
}
