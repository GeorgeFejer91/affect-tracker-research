import test from "node:test";
import assert from "node:assert/strict";
import { attestMasterMedia } from "../runner/src/master-media.js";
const host = { getBoundingClientRect() {} };
const recipe = geometries => ({version:3,segments:{P1:{videoCatalogue:{version:3,entries:geometries.map(geometry=>({geometry}))}}}});
const controlled={nativeDisplayMetadata:{version:2}};
function setup() {
  const calls=[];
  return {calls,options:{stimuli:[{workspaceFileId:"opaque",source:null}],workspaceId:"test",viewportHost:host,controller:{async prepare(){calls.push("prepare");},async awaitPrepared(){},async attestDecode(){calls.push(1);return{};},async attestDecodeV2(){calls.push(2);return{};},async stop(){calls.push("stop");}}}};
}
test("master3 chooses explicit controlled attestation and retains historical master behavior",async()=>{
  for(const [source,expected] of [[recipe([controlled]),2],[recipe([{}]),1],[{version:1},1],[{version:2},1]]) {
    const {calls,options}=setup(), result=await attestMasterMedia({...options,recipe:source});
    assert.equal(result.qualified.length,1);assert.equal(result.failures.length,0);assert.deepEqual(calls,["prepare",expected,"stop"]);
  }
});
test("mixed master3 proofs and unknown versions fail before native side effects",async()=>{
  for(const source of [recipe([{},controlled]),{version:6}]) {
    const {calls,options}=setup();await assert.rejects(attestMasterMedia({...options,recipe:source}));assert.deepEqual(calls,[]);
  }
});
test("controlled attestation failures stop the actor and never fall back to historical proof",async()=>{
  const {calls,options}=setup();options.controller.attestDecodeV2=async()=>{calls.push(2);throw Error("missing controlled proof");};
  const result=await attestMasterMedia({...options,recipe:recipe([controlled])});assert.equal(result.failures.length,1);assert.deepEqual(calls,["prepare",2,"stop"]);
});
test("prepared playback catalogues use browser-safe assets without native GstPlay side effects",async()=>{
  const prepared={version:5,segments:{P1:{version:4,videoCatalogue:{version:4,entries:[{preparedPlayback:{
    strategy:"ffmpeg-browser-safe-mp4-v1",packageRelativePath:"assets/stimuli/.prepared/clip.mp4",
    container:"mp4",videoCodec:"h264",audioCodec:"aac",pixelFormat:"yuv420p",fastStart:true,
  }}]}}}};
  const {calls,options}=setup();
  const result=await attestMasterMedia({...options,recipe:prepared});
  assert.equal(result.failures.length,0);assert.equal(result.qualified.length,1);assert.deepEqual(calls,[]);
});
