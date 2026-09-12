// Independent measurement oracle. No application geometry/compiler imports.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const box = (cx,cy,width,height) => ({x:cx-width/2,y:cy-height/2,width,height});
export function expectedLayout(recipe, annotationId) {
  const p=recipe.segments.P4, entries=recipe.segments.P1.videoCatalogue.entries;
  assert.equal(p.units,'relative'); assert.equal(p.fit,'contain');
  assert.equal(p.viewport.compatibility,'exact'); assert.equal(p.coordinateSystem,'viewport-right-down');
  assert.equal(p.feedback.origin,'design-centre');
  assert.equal(p.reference.source.policy,'largest-oriented-area');
  const videos=[...new Map(entries.map(v=>[v.assetId,v])).values()];
  videos.sort((a,b)=>b.geometry.displayWidthPx*b.geometry.displayHeightPx-a.geometry.displayWidthPx*a.geometry.displayHeightPx||(a.assetId<b.assetId?-1:a.assetId>b.assetId?1:0));
  const reference=videos[0], video=entries.find(v=>v.annotationId===annotationId);
  assert.ok(reference&&video); assert.equal(p.reference.source.assetId,reference.assetId);
  assert.equal(p.reference.source.displayWidthPx,reference.geometry.displayWidthPx);
  assert.equal(p.reference.source.displayHeightPx,reference.geometry.displayHeightPx);
  const W=p.viewport.widthCssPx,H=p.viewport.heightCssPx;
  const scale=Math.min(W*p.reference.box.width/100/reference.geometry.displayWidthPx,H*p.reference.box.height/100/reference.geometry.displayHeightPx);
  const rw=reference.geometry.displayWidthPx*scale,rh=reference.geometry.displayHeightPx*scale;
  const cx=W*p.reference.centre.x/100,cy=H*p.reference.centre.y/100;
  const videoScale=Math.min(rw/video.geometry.displayWidthPx,rh/video.geometry.displayHeightPx);
  const side=Math.min(rw,rh)*p.feedback.overlayViewportSide/100;
  const result={viewport:{width:W,height:H},reference:box(cx,cy,rw,rh),
    video:box(cx,cy,video.geometry.displayWidthPx*videoScale,video.geometry.displayHeightPx*videoScale),
    feedback:box(cx+rw*p.feedback.offset.x/100,cy+rh*p.feedback.offset.y/100,side,side),
    minimumGap:Math.min(rw,rh)*p.feedback.minimumGap/100};
  for(const rect of [result.reference,result.video,result.feedback]) {
    assert.ok(Object.values(rect).every(Number.isFinite)&&rect.width>0&&rect.height>0);
    assert.ok(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=W&&rect.y+rect.height<=H,'Authored rectangle clips');
  }
  return result;
}
function nearBox(actual,expected,label) {
  for(const key of ['x','y','width','height']) assert.ok(Number.isFinite(actual?.[key])&&Math.abs(actual[key]-expected[key])<=0.5,`${label}.${key} differs by more than 0.5 CSS px`);
}
export function compareLayout(recipe,sourceSha256,observation) {
  assert.equal(observation.schema,'affect-layout-observation-v1');
  assert.equal(observation.sourceSha256,sourceSha256,'Different exported master');
  assert.ok(['planner','runner'].includes(observation.surface));
  assert.equal(observation.visible,true,'Capture must show the selected surface');
  const expected=expectedLayout(recipe,observation.annotationId);
  assert.deepEqual(observation.designViewport,expected.viewport);
  assert.deepEqual(observation.windowViewport,{width:1920,height:1080});
  nearBox(observation.reference,expected.reference,'reference');
  nearBox(observation.feedback,expected.feedback,'feedback viewport');
  if(observation.surface==='planner') {
    nearBox(observation.video,expected.video,'Planner video miniature');
    const p=recipe.segments.P4, fields={screenWidth:p.viewport.widthCssPx,screenHeight:p.viewport.heightCssPx,
      referenceWidth:p.reference.box.width,referenceHeight:p.reference.box.height,referenceX:p.reference.centre.x,
      referenceY:p.reference.centre.y,diameter:p.feedback.overlayViewportSide,offsetX:p.feedback.offset.x,
      offsetY:p.feedback.offset.y,gap:p.feedback.minimumGap};
    for(const [key,value] of Object.entries(fields)) {
      assert.ok(String(observation.controls?.[key]??'').trim().length,`Missing Planner control ${key}`);
      assert.equal(Number(observation.controls[key]),value,`Planner control ${key}`);
    }
    assert.equal(observation.controls.units,p.units);assert.equal(observation.controls.referencePolicy,p.reference.source.policy);
  }
  else {
    assert.equal(observation.phase,'video');
    nearBox(observation.nativeHost,expected.reference,'native DOM host');
    nearBox(observation.overlay,expected.feedback,'feedback overlay');
    assert.equal(observation.flubberVisible,true);
    // DOM host is not decoded video pixels. Native evidence remains separately required.
    if(observation.nativeVideo) nearBox(observation.nativeVideo,expected.video,'observed native video');
  }
  return {pass:true,expected,nativeVideoMeasured:observation.surface==='runner'&&Boolean(observation.nativeVideo),
    limitation:'Bounds comparison only; identity attestation, screenshots, painted Flubber envelope and native playback require independent review.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [recipePath,observationPath,outputPath]=process.argv.slice(2);
  const bytes=await readFile(recipePath),observation=JSON.parse(await readFile(observationPath,'utf8'));
  const screenshot=await readFile(observation.screenshot.path);
  assert.equal(hash(screenshot),observation.screenshot.sha256);
  const result=compareLayout(JSON.parse(bytes),hash(bytes),observation);
  await writeFile(outputPath,JSON.stringify({...result,sourceSha256:hash(bytes),observationSha256:hash(await readFile(observationPath)),screenshotSha256:hash(screenshot)},null,2),{flag:'wx'});
}
