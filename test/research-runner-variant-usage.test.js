import test from "node:test";
import assert from "node:assert/strict";
import {validateVariantUsage,leastUsedVariant,nextParticipant,usageColor} from "../runner/src/variant-picker.js";
const variants=[{variantId:"third"},{variantId:"first"},{variantId:"second"}];
const fixture=()=>({schema:"affect-runner-variant-usage",version:1,basis:"xdf-file-names-v1",recipeSourceByteSha256:"hash",ignoredXdfFiles:1,usedParticipantIds:["P001","P003"],variants:variants.map((v,i)=>({...v,recordingCount:[3,1,1][i],participantCount:[2,1,1][i]}))});
test("least used across participants ties in saved order and participant fills first gap",()=>{
 const usage=validateVariantUsage(fixture(),"hash",variants);assert.equal(leastUsedVariant(usage.variants),"first");assert.equal(nextParticipant(usage.usedParticipantIds),"P002");assert.equal(nextParticipant([]),"P001");assert.equal(leastUsedVariant(variants.map(v=>({...v,recordingCount:0}))),"third");assert.equal(nextParticipant(Array.from({length:100000},(_,i)=>`P${String(i+1).padStart(3,"0")}`)),null);
});
test("unknown, stale and malformed inventory cannot provide a default",()=>{
 for(const mutate of [u=>u.version=2,u=>u.recipeSourceByteSha256="other",u=>u.basis="completed",u=>u.variants.reverse(),u=>u.variants[0].recordingCount=-1,u=>u.variants[1].participantCount=2,u=>u.usedParticipantIds.push("P001"),u=>u.usedParticipantIds=["P01"]]){const u=fixture();mutate(u);assert.throws(()=>validateVariantUsage(u,"hash",variants));}
});
test("usage colors slide continuously against current maximum and zero is green",()=>{assert.equal(usageColor(0,0),"hsl(120 55% 52%)");assert.equal(usageColor(1,2),"hsl(60 55% 52%)");assert.equal(usageColor(2,2),"hsl(0 55% 52%)");});
