import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
const root=resolve(import.meta.dirname,'../companion'),out=resolve(root,'../artifacts/professor');await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname;
  if(route==='/target'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Professor target fixture</title>');return;}
  const path=route==='/'?resolve(root,'dist/index.html'):route.startsWith('/assets/')?resolve(root,'dist','.'+route):resolve(root,'.'+route);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'text/html');res.end(await readFile(path));}catch{res.writeHead(404).end();}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE??'C:/Users/Georgeous/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
let targetBrowser,controllerBrowser;
try{
  targetBrowser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  controllerBrowser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const target=await targetBrowser.newPage(),controller=await controllerBrowser.newPage({viewport:{width:390,height:844}});
  for(const page of [target,controller]) await page.addInitScript(()=>{
    window.fixturePeers=[];const Original=window.RTCPeerConnection;
    window.RTCPeerConnection=class extends Original{constructor(...args){super(...args);window.fixturePeers.push(this);}};
  });
  const invitation={room:'professor_'+randomBytes(12).toString('hex'),session:'professor_'+randomBytes(12).toString('hex'),stream:'brsp_target_'+randomBytes(12).toString('hex'),secret:randomBytes(32).toString('hex')};
  await target.goto(base+'/target');
  await target.evaluate(async invitation=>{
    const {createTransport,NativeProfessorConnection}=await import('/src/connection.js');
    const {createHelloEnvelope,verifyProofEnvelope}=await import('/vendor/brsp/brsp.js');
    const {installVideoLane}=await import('/src/video.js');
    const hello=createHelloEnvelope({role:'target',sessionId:invitation.session,senderId:'target_network_fixture',senderEpoch:17,capabilities:['command-ack','latest-state','state-snapshot'],grantedScopes:['runner.observe','runner.operate','runner.video']});
    const state={profile:'affect-runner-professor-v1',revision:1,active:true,phase:'playing',runId:'run_network_fixture',availableActions:['pause','stop'],step:1,stepCount:2,
      mediaTimeMs:1000,mediaDurationMs:10000,writeHealthy:true,inputActive:true,sample:null,mediaSelection:'media_fixture:1',videoEnabled:true};
    const transport=await createTransport(invitation,'target');let verified=false;
    const connection=new NativeProfessorConnection({transport,invitation:{...invitation,targetHello:hello},getState:()=>structuredClone(state),
      invoke:async(command,args)=>{if(command==='research_professor_verify'){verified=await verifyProofEnvelope({proof:args.request.proof,localHello:hello,remoteHello:args.request.controllerHello,secret:invitation.secret});if(!verified)throw new Error('Proof rejected');return {handle:'fixture_grant',scopes:hello.body.grantedScopes};}if(!verified)throw new Error('Not authenticated');return structuredClone(state);},
      applyCommand:async command=>{state.revision++;state.phase=command.action==='pause'?'paused':'playing';state.availableActions=state.phase==='paused'?['resume','stop']:['pause','stop'];window.networkFixture.commands.push(command.action);return {ok:true,revision:state.revision,result:null,error:null};}});
    const video=installVideoLane(transport,connection);let route='unknown';transport.addEventListener('quality',e=>{route=e.detail.route;});
    window.networkFixture={connection,transport,video,state,commands:[],get route(){return route;},tick:0};
    connection.addEventListener('protocolerror',e=>{window.networkFixture.protocolError=e.detail.message.slice(0,160).replaceAll(invitation.secret,'[redacted]').replaceAll(invitation.room,'[redacted]').replaceAll(invitation.session,'[redacted]');});
    window.networkFixture.timer=setInterval(()=>{if(connection.phase!=='ready')return;const n=++window.networkFixture.tick;state.sample={runId:state.runId,sequence:n,elapsedMs:n*250,valence:Math.sin(n/10),arousal:Math.cos(n/12)};connection.currentState=structuredClone(state);connection.publishState(state,{revision:state.revision});},250);
    void transport.start().catch(()=>{window.networkFixture.startFailed=true;});
  },invitation);
  await controller.goto(base+'/#'+new URLSearchParams(invitation));
  await controller.getByRole('button',{name:'Connect',exact:true}).click();
  try{await controller.getByText('Connected to the local Runner.',{exact:true}).waitFor({timeout:45000});}
  catch(error){const phase=await target.evaluate(()=>({connection:window.networkFixture.connection.phase,transport:window.networkFixture.transport.phase,startFailed:window.networkFixture.startFailed===true,protocolError:window.networkFixture.protocolError}));await writeFile(resolve(out,'webrtc-receipt.json'),JSON.stringify({date:new Date().toISOString(),result:'failed',phase},null,2));throw error;}
  await controller.getByRole('button',{name:'Pause',exact:true}).click();await controller.getByText('Runner confirmed the command.',{exact:true}).waitFor();
  await target.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='#305b49';ctx.fillRect(0,0,320,180);ctx.fillStyle='#fff';ctx.font='20px sans-serif';ctx.fillText('Transport test frame',30,90);
    window.networkFixture.video.send({runId:'run_network_fixture',selection:'media_fixture:1',frame:{width:320,height:180,positionEstimateMs:1000,jpegBase64:canvas.toDataURL('image/jpeg',.6).split(',')[1]}});
  });
  await controller.locator('#video-preview').waitFor({state:'visible'});await controller.screenshot({path:resolve(out,'internet-video-fixture.png')});
  await controller.getByRole('button',{name:'Ratings timeline'}).click();await controller.screenshot({path:resolve(out,'internet-timeline-fixture.png')});
  const readRoute=page=>page.evaluate(async()=>{
    for(const peer of window.fixturePeers){const stats=await peer.getStats();
      for(const row of stats.values())if(row.type==='transport'&&row.selectedCandidatePairId){const pair=stats.get(row.selectedCandidatePairId),local=stats.get(pair.localCandidateId),remote=stats.get(pair.remoteCandidateId);
        return {route:local?.candidateType==='relay'||remote?.candidateType==='relay'?'relay':'direct',roundTripTime:pair.currentRoundTripTime??null};}}
    return {route:'unknown',roundTripTime:null};
  });
  const routes={target:await readRoute(target),controller:await readRoute(controller)};
  const result=await target.evaluate(()=>({commands:window.networkFixture.commands,frames:window.networkFixture.tick,phase:window.networkFixture.connection.phase}));
  result.routes=routes;
  assert.deepEqual(result.commands,['pause']);
  await writeFile(resolve(out,'webrtc-receipt.json'),JSON.stringify({date:new Date().toISOString(),result:'pass',target:targetBrowser.version(),controller:controllerBrowser.version(),environment:'two headless browsers on one Windows host; synthetic app/video fixture; not native or physical-device qualification',...result},null,2));
  console.log(JSON.stringify(result));
  await target.evaluate(async()=>{clearInterval(window.networkFixture.timer);window.networkFixture.video.close();await window.networkFixture.connection.close();});
}finally{await targetBrowser?.close();await controllerBrowser?.close();await new Promise(r=>server.close(r));}
