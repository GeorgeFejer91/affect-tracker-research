import test from 'node:test';
import assert from 'node:assert/strict';
import {expectedLayout,compareLayout} from '../scripts/qualification/planner-runner-layout-compare.mjs';
const recipe=()=>({segments:{P1:{videoCatalogue:{entries:[{assetId:'asset-a',annotationId:'clip',geometry:{displayWidthPx:1920,displayHeightPx:1080}}]}},P4:{units:'relative',fit:'contain',coordinateSystem:'viewport-right-down',viewport:{widthCssPx:1920,heightCssPx:1080,compatibility:'exact'},reference:{source:{policy:'largest-oriented-area',assetId:'asset-a',displayWidthPx:1920,displayHeightPx:1080},box:{width:60,height:60},centre:{x:50,y:35}},feedback:{origin:'design-centre',overlayViewportSide:24,offset:{x:0,y:75},minimumGap:3}}}});
const observation=(r=recipe())=>{const e=expectedLayout(r,'clip');return {schema:'affect-layout-observation-v1',sourceSha256:'same',surface:'runner',visible:true,phase:'video',annotationId:'clip',designViewport:e.viewport,windowViewport:{width:1920,height:1080},reference:e.reference,feedback:e.feedback,nativeHost:e.reference,overlay:e.feedback,flubberVisible:true};};
test('independent mock arithmetic has explicit hand-computed anchors',()=>{
 const e=expectedLayout(recipe(),'clip');assert.deepEqual(e.video,{x:384,y:54,width:1152,height:648});
 assert.equal(e.feedback.x,882.24);assert.equal(e.feedback.y,786.24);assert.equal(e.feedback.width,155.52);assert.equal(e.minimumGap,19.44);
 assert.equal(compareLayout(recipe(),'same',observation()).nativeVideoMeasured,false);
});
test('bounds and identity counterexamples fail; changed controls cannot reuse old measurements',()=>{
 for(const mutate of [o=>o.sourceSha256='other',o=>o.windowViewport.width=1919,o=>o.visible=false,o=>o.phase='interval',o=>o.reference.x+=2,o=>o.feedback.y-=100,o=>o.nativeHost.width=1920,o=>o.overlay.width=200,o=>o.flubberVisible=false,o=>o.nativeVideo={x:0,y:0,width:1920,height:1080},o=>o.feedback.x=NaN]){
  const o=observation();mutate(o);assert.throws(()=>compareLayout(recipe(),'same',o));
 }
 const alternate=recipe();alternate.segments.P4.reference.centre.x=45;alternate.segments.P4.feedback.offset.x=10;alternate.segments.P4.feedback.overlayViewportSide=18;
 assert.throws(()=>compareLayout(alternate,'same',observation()));
 assert.equal(compareLayout(alternate,'same',observation(alternate)).pass,true);
 const e=expectedLayout(alternate,'clip');assert.equal(e.video.x,288);assert.equal(e.feedback.width,116.64);assert.equal(e.feedback.x+e.feedback.width/2,979.2);
});
test('Planner miniature and actual control readback must both match the master',()=>{
 const r=recipe(),e=expectedLayout(r,'clip'),o={...observation(r),surface:'planner',video:e.video,
   controls:{screenWidth:'1920',screenHeight:'1080',referenceWidth:'60',referenceHeight:'60',referenceX:'50',referenceY:'35',diameter:'24',offsetX:'0',offsetY:'75',gap:'3',units:'relative',referencePolicy:'largest-oriented-area'}};
 assert.equal(compareLayout(r,'same',o).pass,true);
 for(const mutate of [v=>v.controls.offsetX='',v=>v.controls.diameter='18',v=>v.video.width=600]) {
  const changed=structuredClone(o);mutate(changed);assert.throws(()=>compareLayout(r,'same',changed));
 }
});
