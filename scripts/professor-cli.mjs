// Thin semantic browser-transport client. Rust in the paired Runner remains
// the authority. The invitation is read from stdin, never process arguments.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseInvitation, ACTIONS } from '../companion/src/profile.js';
const action=process.argv[2]??'status';
if(!['status',...ACTIONS].includes(action))throw new Error('Use status, start, pause, resume, or stop.');
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>1024)throw new Error('Invitation exceeds limit.');}
let invitation;try{invitation=parseInvitation(new URL(input.trim()).hash);}catch{throw new Error('Read a fresh Professor invitation URL from stdin.');}input='';
const root=resolve(import.meta.dirname,'../companion');
const server=createServer(async(req,res)=>{
  if(req.url==='/cli'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Professor transport</title>');return;}
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  try{const data=await readFile(path);res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':'text/html');res.end(data);}
  catch{res.writeHead(404).end();}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  const runtime=process.env.PLAYWRIGHT_MODULE??'C:/Users/Georgeous/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
  const {chromium}=await import(pathToFileURL(runtime));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/cli`);
  const outcome=await page.evaluate(async({invitation,action})=>{
    const {createTransport,createController}=await import('/src/connection.js');
    const {validateSnapshot}=await import('/src/profile.js');
    const transport=await createTransport(invitation,'controller');const connection=createController(transport,invitation,
      {scopes:action==='status'?['runner.observe']:['runner.observe','runner.operate']});
    let state,commandId,done,timer;const completed=new Promise((resolve,reject)=>{
      done={resolve,reject};timer=setTimeout(()=>reject(new Error('Companion deadline exceeded. Check local Runner; commands are not automatically repeated.')),30000);
    });
    const accept=event=>{try{state=validateSnapshot(event.detail.state);if(action==='status'){done.resolve({ok:true,state});return;}
      if(commandId)return;if(!state.availableActions.includes(action)){done.resolve({ok:false,error:'action_unavailable'});return;}
      commandId=connection.sendCommand('runner.operate',action,{}, {expectedRevision:state.revision});
    }catch{done.reject(new Error('Incompatible Runner state.'));}};
    connection.addEventListener('state',accept);connection.addEventListener('snapshot',accept);
    connection.addEventListener('commandapplied',event=>{if(event.detail.commandId===commandId)done.resolve({ok:event.detail.ok,revision:event.detail.revision,error:event.detail.error});});
    connection.addEventListener('protocolerror',()=>done.reject(new Error('Pairing failed.')));
    try{return await Promise.race([transport.start().then(()=>completed),completed]);}finally{clearTimeout(timer);await connection.close();}
  },{invitation,action});
  invitation=null;process.stdout.write(JSON.stringify(outcome)+'\n');if(!outcome.ok)process.exitCode=1;
}finally{await browser?.close();await new Promise(r=>server.close(r));}
