import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fixture } from '../scripts/professor-proof-fixture.mjs';
import { RatingTimeline } from '../companion/src/timeline.js';
import { parseInvitation, invitationUrl, validateSnapshot, PROFILE } from '../companion/src/profile.js';
import { BRSPConnection, createProofEnvelope } from '../companion/vendor/brsp/brsp.js';
import { NativeProfessorConnection } from '../companion/src/connection.js';
import { installVideoLane } from '../companion/src/video.js';
const point = (sequence,elapsedMs=sequence*250) => ({ runId:'run_test',sequence,elapsedMs,valence:.2,arousal:-.4 });
test('Professor proof bytes are shared with the Rust verifier', async () => {
  assert.deepEqual(fixture, JSON.parse(await readFile(new URL('./fixtures/professor-proof.json',import.meta.url))));
});
test('bundled BRSP and VDO source bytes match their provenance pins',async()=>{
  const pins={
    'brsp/brsp.js':'7f28058297388a128e3acfc146248b627921d4629b8f3a575d80d3f6ff0b6911',
    'brsp/vdo-ninja-transport.js':'79ca3077c05d4eb1a1a07fd9d652a60f93901d9d6a85aa2659ef6ed798a6c003',
    'vdoninja/1.5.5/vdoninja-sdk.min.js':'390ea6c8b1a4e57bf7fa18ff2b394f25cc79e637130f97e4a29ca958a90fac77',
    'vdoninja/1.5.5/vdoninja-sdk.js':'8097d5420d7ed2426623d7ff08f6abd45f03f89e6540a6cc4b86bcdc057d841e',
  };
  for(const [path,hash] of Object.entries(pins))assert.equal(createHash('sha256').update(await readFile(new URL('../companion/vendor/'+path,import.meta.url))).digest('hex'),hash);
});
test('rating history remains bounded, ordered and shows disconnect/time gaps', () => {
  const h = new RatingTimeline({limit:3});
  for(let i=1;i<=4;i++) assert.equal(h.accept(point(i)),true);
  assert.equal(h.points.length,3); assert.equal(h.points[0].sequence,2);
  assert.equal(h.accept(point(3)),false); h.disconnect(); h.accept(point(5)); assert.equal(h.points.at(-1).gap,true);
  h.accept(point(6,5000)); assert.equal(h.points.at(-1).gap,true);
  assert.equal(h.accept({...point(7),valence:2}),false);
  assert.equal(h.accept({...point(7),elapsedMs:NaN}),false);
  h.accept({...point(1),runId:'new_run'}); assert.equal(h.points.length,1);
  assert.equal('participantId' in h.points[0],false);
});
test('invitations keep secrets in fragments and reject duplicate/unexpected fields', () => {
  const data={room:'professor_room',session:'professor_session',stream:'brsp_target_test',secret:fixture.secret};
  const url=new URL(invitationUrl(data)); assert.equal(url.search,''); assert.deepEqual(parseInvitation(url.hash),data);
  assert.throws(()=>parseInvitation(`${url.hash}&secret=${fixture.secret}`));
  assert.throws(()=>parseInvitation(`${url.hash}&command=run`));
});
test('public projection rejects extra private fields and invalid ratings', () => {
  const state={profile:PROFILE,revision:1,active:true,phase:'playing',runId:'run_test',availableActions:['pause','stop'],step:1,stepCount:2,
    mediaTimeMs:12,mediaDurationMs:100,writeHealthy:true,inputActive:true,sample:point(1),mediaSelection:'media:1',videoEnabled:true};
  assert.equal(validateSnapshot(state),state);
  for(const change of [{participantId:'P001'},{availableActions:['input']},{sample:{...point(2),arousal:NaN}},{mediaTimeMs:-1}]) assert.throws(()=>validateSnapshot({...state,...change}));
});
class Lane extends EventTarget {
  sendControl(peerKey,data) { queueMicrotask(()=>this.other.dispatchEvent(new CustomEvent('controlmessage',{detail:{peerKey:'peer_fixture',data}}))); return true; }
  sendState(peerKey,data) { queueMicrotask(()=>this.other.dispatchEvent(new CustomEvent('statemessage',{detail:{peerKey:'peer_fixture',data}}))); return true; }
  closePeer() {} async stop() {}
}
const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw new Error('Handshake deadline');};
test('native proof gates ready and sanitized command acknowledgement; no participant intent',async()=>{
  const a=new Lane(),b=new Lane();a.other=b;b.other=a;let verified=false,applied=0;
  const native=new NativeProfessorConnection({transport:a, invitation:{session:fixture.targetHello.sessionId,secret:fixture.secret,targetHello:fixture.targetHello},
    invoke:async(command,args)=>{
      if(command==='research_professor_verify'){
        const proof=await createProofEnvelope({localHello:args.request.controllerHello,remoteHello:fixture.targetHello,secret:fixture.secret,sequence:args.request.proof.sequence});
        assert.equal(proof.body.value,args.request.proof.body.value); verified=true; return {handle:'native_private',scopes:['runner.observe','runner.operate']};
      } assert.equal(verified,true); return {revision:3};
    },getState:()=>({revision:3}),applyCommand:async()=>{assert.equal(verified,true);applied++;return {ok:true,revision:4,result:null,error:null};}});
  const controller=new BRSPConnection({transport:b,role:'controller',sessionId:fixture.targetHello.sessionId,sharedSecret:fixture.secret,requestedScopes:['runner.observe','runner.operate']});
  await Promise.all([native.attachPeer({peerKey:'peer_fixture'}),controller.attachPeer({peerKey:'peer_fixture'})]);
  await until(()=>controller.phase==='ready'); assert.equal(native.phase,'ready');
  controller.sendControlEnvelope(await createProofEnvelope({localHello:controller.localHello,remoteHello:native.localHello,
    secret:fixture.secret,sequence:controller.nextControlSequence()}));
  await new Promise(r=>setTimeout(r,20));assert.equal(native.phase,'ready');
  controller.sendCommand('runner.operate','pause',{}, {expectedRevision:3}); await until(()=>applied===1&&controller.pendingCommands.size===0);
  assert.throws(()=>controller.sendIntent('runner.operate',{valence:1,arousal:1}));
  await native.close();await controller.close();
});
test('video lane rejects malformed/oversized frames and reassembles only bounded current frames',()=>{
  const sdk=new EventTarget();const connection=new EventTarget();Object.assign(connection,{phase:'ready',peerKey:'peer_fixture',acceptedScopes:['runner.video']});
  const transport={role:'controller',sdk,installSdkListeners(){},listen(s,g,t,h){s.addEventListener(t,h);}};
  const received=[];const lane=installVideoLane(transport,connection,{receive:f=>received.push(f)});
  transport.installSdkListeners(sdk,1);const channel=new EventTarget();channel.close=()=>{};
  sdk.dispatchEvent(new CustomEvent('channelOpen',{detail:{label:'x-professor-video-v1',uuid:'peer_fixture',channel}}));
  const packet={id:1,part:0,total:1,data:'/9j/2Q==',width:320,height:180,runId:'run_fixture',selection:'selection_fixture',positionEstimateMs:100};
  const send=p=>channel.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(p)}));
  send({...packet,width:641});send({...packet,data:'A'.repeat(18001)});send({...packet,participantId:'P001'});assert.equal(received.length,0);
  send(packet);assert.equal(received.length,1);send(packet);assert.equal(received.length,1);
  send({...packet,id:2,total:2,part:1,data:'2Q=='});send({...packet,id:2,total:2,part:0,data:'/9j/'});
  assert.equal(received.length,2);assert.equal(received[1].base64,'/9j/2Q==');
  lane.close();send({...packet,id:3});assert.equal(received.length,2);
});
