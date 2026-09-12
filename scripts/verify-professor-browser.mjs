import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const runtime = process.env.PLAYWRIGHT_MODULE ?? 'C:/Users/Georgeous/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(runtime));
const root = resolve(import.meta.dirname,'..'), output=resolve(root,'artifacts/professor'); await mkdir(output,{recursive:true});
// Inspect the shipped HTML/CSS under its real CSP; Vite remains available only
// for importing deterministic fixture modules, without its inline CSS injector.
const server=await createServer({configFile:resolve(root,'companion/vite.config.js'),server:{port:0,strictPort:false},plugins:[{
  name:'professor-production-fixture',enforce:'pre',
  transform(code,id){if(id.replaceAll('\\','/').endsWith('/companion/src/app.js'))return code.replace("import './style.css';",'');},
  configureServer(server){server.middlewares.use(async(req,res,next)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname!=='/'&&!/^\/assets\/[\w.-]+$/u.test(url.pathname))return next();
    try{const path=url.pathname==='/'?'index.html':url.pathname.slice(1);const data=await readFile(resolve(root,'companion/dist',path));
      res.setHeader('Content-Type',path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':path.endsWith('.svg')?'image/svg+xml':'text/html');res.end(data);
    }catch{next();}
  });},
}]});await server.listen();
const base=server.resolvedUrls.local[0];
const results=[];
try {
  for(const [name,exe] of [['Chrome','C:/Program Files/Google/Chrome/Application/chrome.exe'],['Edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']]) {
    const browser=await chromium.launch({executablePath:exe,headless:true});
    try {
      for(const width of [390,1280]) {
        const page=await browser.newPage({viewport:{width,height:844}});const errors=[],external=[];
        page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))external.push(new URL(r.url()).hostname);});
        await page.goto(base);await page.getByRole('button',{name:'Ratings timeline'}).click();
        await page.screenshot({path:resolve(output,`${name}-${width}-empty.png`)});
        assert.equal(await page.locator('#ratings-dialog').evaluate(e=>e.open),true);
        await page.locator('#close-ratings').click();
        await page.evaluate(async()=>{
          const {bootProfessor}=await import('/src/app.js');
          const {NativeProfessorConnection}=await import('/src/connection.js');
          const {createHelloEnvelope,verifyProofEnvelope}=await import('/vendor/brsp/brsp.js');
          const secret='0123456789abcdef'.repeat(4),session='professor_browser_fixture';
          const hello=createHelloEnvelope({role:'target',sessionId:session,senderId:'target_browser_fixture',senderEpoch:17,
            capabilities:['command-ack','latest-state','state-snapshot'],grantedScopes:['runner.observe','runner.operate']});
          const invitation={room:'professor_room_fixture',session,stream:'brsp_target_fixture',secret};
          const state={profile:'affect-runner-professor-v1',revision:1,active:true,phase:'playing',runId:'run_fixture',availableActions:['pause','stop'],step:2,stepCount:5,
            mediaTimeMs:1000,mediaDurationMs:10000,writeHealthy:true,inputActive:true,sample:null,mediaSelection:null,videoEnabled:false};
          class Lane extends EventTarget {
            installSdkListeners(){} listen(){} sendControl(peerKey,data){queueMicrotask(()=>this.other.dispatchEvent(new CustomEvent('controlmessage',{detail:{peerKey:'peer_fixture',data}})));return true;}
            sendState(peerKey,data){queueMicrotask(()=>this.other.dispatchEvent(new CustomEvent('statemessage',{detail:{peerKey:'peer_fixture',data}})));return true;}
            closePeer(){} async stop(){} sdk={addEventListener(){},removeEventListener(){}};
          }
          const targetLane=new Lane(),controllerLane=new Lane();targetLane.other=controllerLane;controllerLane.other=targetLane;
          let verified=false;
          const target=new NativeProfessorConnection({transport:targetLane,invitation:{...invitation,targetHello:hello},
            invoke:async(command,args)=>{
              if(command==='research_professor_verify') { verified=await verifyProofEnvelope({proof:args.request.proof,localHello:hello,remoteHello:args.request.controllerHello,secret});if(!verified)throw new Error('proof rejected');return {handle:'fixture_grant',scopes:['runner.observe','runner.operate']}; }
              if(!verified)throw new Error('not verified');return structuredClone(state);
            },getState:()=>structuredClone(state),applyCommand:async(command)=>{
              if(command.expectedRevision!==state.revision)return {ok:false,revision:state.revision,result:null,error:'revision_conflict'};
              window.fixture.commands.push(command.action);state.revision++;
              if(command.action==='pause'){state.phase='paused';state.availableActions=['resume','stop'];}
              if(command.action==='resume'){state.phase='playing';state.availableActions=['pause','stop'];}
              if(command.action==='stop'){state.phase='idle';state.active=false;state.availableActions=[];state.sample=null;}
              return {ok:true,revision:state.revision,result:null,error:null};
            }});
          controllerLane.start=async()=>{
            await target.attachPeer({peerKey:'peer_fixture'});
            controllerLane.dispatchEvent(new CustomEvent('peeropen',{detail:{peerKey:'peer_fixture'}}));
          };
          document.querySelector('#professor').remove();const mount=document.createElement('main');document.body.append(mount);
          const app=bootProfessor(mount,{location:{hash:'#'+new URLSearchParams(invitation),pathname:'/',search:''},history:{replaceState(){}},transportFactory:async()=>controllerLane});
          window.fixture={app,target,state,commands:[],publish(sequence,time=sequence*250){state.sample={runId:'run_fixture',sequence,elapsedMs:time,valence:Math.sin(sequence/12),arousal:Math.cos(sequence/15)};target.publishState(structuredClone(state),{revision:state.revision});}};
        });
        await page.getByRole('button',{name:'Connect',exact:true}).click();
        await page.getByText('Connected to the local Runner.',{exact:true}).waitFor();
        await page.evaluate(()=>{for(let i=1;i<=140;i++)window.fixture.publish(i);});
        await page.getByRole('button',{name:'Ratings timeline'}).click();
        assert.equal(await page.locator('#ratings-dialog canvas').count(),2);
        await page.screenshot({path:resolve(output,`${name}-${width}-timeline.png`)});
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        const points=await page.evaluate(()=>window.fixture.app.timeline.points.length);assert.equal(points,140);
        await page.locator('#close-ratings').click();
        await page.getByRole('button',{name:'Pause',exact:true}).click();await page.getByText('Runner confirmed the command.',{exact:true}).waitFor();
        assert.deepEqual(await page.evaluate(()=>window.fixture.commands),['pause']);
        await page.waitForTimeout(2200);assert.equal(await page.getByRole('button',{name:'Resume',exact:true}).isDisabled(),true);
        await page.evaluate(()=>window.fixture.publish(141,38000));
        assert.equal(await page.evaluate(()=>window.fixture.app.timeline.points.at(-1).gap),true);
        await page.getByRole('button',{name:'Resume',exact:true}).click();
        await page.waitForFunction(()=>window.fixture.commands.length===2);
        await page.getByRole('button',{name:'Stop experiment',exact:true}).click();await page.locator('#confirm-stop').click();
        await page.waitForFunction(()=>window.fixture.commands.length===3);
        await page.getByRole('button',{name:'Disconnect',exact:true}).click();
        assert.equal(await page.getByRole('button',{name:'Pause',exact:true}).isDisabled(),true);
        assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
        results.push({browser:name,version:browser.version(),width,tier:2,points,commands:['pause','resume','stop'],popup:true,gap:true,externalRequests:0});await page.close();
      }
    }finally{await browser.close();}
  }
  await writeFile(resolve(output,'browser-receipt.json'),JSON.stringify({date:new Date().toISOString(),results},null,2));
  console.log(JSON.stringify(results));
}finally{await server.close();}
