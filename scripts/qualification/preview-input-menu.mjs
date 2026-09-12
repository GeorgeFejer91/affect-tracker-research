// Background-only actual-app fixture. Never attaches to a user's app/profile.
// node scripts/qualification/preview-input-menu.mjs <edge.exe> <output-dir>
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { build } from "esbuild";

const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination);
const output = resolve(destination); await mkdir(output, { recursive: true });
const css = (await readFile(new URL("../../site/research.css", import.meta.url), "utf8"))
  .replaceAll('./assets/', pathToFileURL(fileURLToPath(new URL('../../site/assets/', import.meta.url))).href);
const bundle = await build({ write: false, bundle: true, format: "esm", stdin: {
  resolveDir: fileURLToPath(new URL("../../", import.meta.url)), contents: `
import {bootResearchUi} from './site/src/research/app.js';
import {withCustomDigitalAction} from './site/src/research/input-controller.js';
window.checkNativeMenu=async()=>{
 const root=bootResearchUi(),q=s=>root.querySelector(s),checks=[];
 const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
 const dialog=q('#binding-capture-dialog'),area=q('.binding-capture-area');
 q('#preview-input-menu').click();q('[data-binding-capture-target=left]').click();
 const before=root.researchUi.inputBinding,action={kind:'keyboard',code:'KeyJ'},binding=withCustomDigitalAction(before,'left',action);
 area.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyJ',key:'j',bubbles:true}));
 check('Tauri UI does not use browser keyboard capture',JSON.stringify(root.researchUi.inputBinding)===JSON.stringify(before));
 root.researchUi.applyNativeInputStatus({captureError:'Conflicting native action.'});
 check('native conflict is visible in popup',q('#binding-capture-receipt').textContent==='Conflicting native action.');
 check('wrong-direction result is rejected',root.researchUi.applyNativeCapture({binding,action,direction:'right'})===false);
 check('native success keeps menu open with assignment',root.researchUi.applyNativeCapture({binding,action,direction:'left'})===true&&dialog.open&&q('#binding-capture-receipt').dataset.state==='ready');
 q('[data-binding-capture-target=left]').click();q('#binding-capture-stop').click();
 check('cancelled native capture cannot apply',root.researchUi.applyNativeCapture({binding,action,direction:'left'})===false);
 q('[data-binding-capture-target=left]').click();root.researchUi.failNativeCapture('Device unavailable.');
 check('native begin failure disarms and stays visible',area.dataset.listening==='false'&&q('#binding-capture-receipt').textContent==='Device unavailable.');
 q('[data-binding-capture-target=left]').click();dialog.close();q('#preview-input-menu').click();q('[data-binding-capture-target=left]').click();await new Promise(r=>setTimeout(r,0));
 check('old close event cannot cancel reopened capture',area.dataset.listening==='true');
 q('#binding-capture-cancel').click();
 check('closed native popup rejects delayed result',root.researchUi.applyNativeCapture({binding,action,direction:'left'})===false);
 q('#preview-input-menu').click();document.getElementById('receipt').textContent=JSON.stringify({pass:true,checks});
};
window.checkMenu=async()=>{
 const root=bootResearchUi(),q=s=>root.querySelector(s),checks=[];
 const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw Error(name);};
 const dialog=q('#binding-capture-dialog'),area=q('.binding-capture-area'),opener=q('#preview-input-menu');
 const key=code=>area.dispatchEvent(new KeyboardEvent('keydown',{key:code,code,bubbles:true,cancelable:true}));
 const arm=d=>q('[data-binding-capture-target='+d+']').click();
 const binding=()=>root.researchUi.inputBinding;
 const initial=JSON.stringify(binding());
 const pane=q('.preview-pane'),oldWidth=pane.style.width;
 for(const width of [320,680]){pane.style.width=width+'px';const box=pane.getBoundingClientRect();check('preview header controls fit '+width+'px pane',[...pane.querySelectorAll('.preview-header-controls button')].every(e=>{const b=e.getBoundingClientRect();return b.left>=box.left&&b.right<=box.right;}));}
 pane.style.width=oldWidth;
 opener.focus();opener.click();key('KeyJ');
 check('opener does not arm capture',dialog.open&&JSON.stringify(binding())===initial);
 arm('left');check('target arms and focuses dedicated capture area',area===document.activeElement&&area.dataset.listening==='true');
 key('KeyJ');check('keyboard assignment updates saved binding and all readouts',binding().directions.left.code==='KeyJ'&&[...root.querySelectorAll('[data-binding-value=left]')].every(e=>e.textContent.includes('KeyJ')));
 arm('right');await new Promise(r=>setTimeout(r,220));
 check('success has no delayed close that cancels the next target',dialog.open&&area.dataset.listening==='true');
 key('KeyJ');check('conflict is visible and preserves existing binding',q('#binding-capture-receipt').dataset.state==='error'&&binding().directions.right.code==='ArrowRight');
 key('KeyL');check('conflict can be corrected without reopening',binding().directions.right.code==='KeyL');
 arm('up');area.dispatchEvent(new WheelEvent('wheel',{deltaY:-30,bubbles:true,cancelable:true}));
 arm('down');area.dispatchEvent(new WheelEvent('wheel',{deltaY:30,bubbles:true,cancelable:true}));
 check('wheel up and down are distinct assignments',binding().directions.up.direction==='up'&&binding().directions.down.direction==='down');
 const wheelBinding=JSON.stringify(binding());area.dispatchEvent(new WheelEvent('wheel',{deltaY:-30,bubbles:true,cancelable:true}));
 check('wheel burst cannot continue capture after success',JSON.stringify(binding())===wheelBinding&&area.dataset.listening==='false');
 arm('left');q('[data-binding-capture-target=right]').dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true}));
 check('menu mouse presses are not bindings',binding().directions.left.code==='KeyJ');
 area.dispatchEvent(new MouseEvent('mousedown',{button:1,bubbles:true,cancelable:true}));
 check('capture area assigns supported mouse button',binding().directions.left.kind==='mouseButton'&&binding().directions.left.button===1);
 arm('left');area.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',code:'Tab',bubbles:true}));key('KeyP');
 check('Tab cancels capture for keyboard navigation',binding().directions.left.kind==='mouseButton'&&area.dataset.listening==='false');
 arm('left');window.dispatchEvent(new Event('blur'));key('KeyP');
 check('focus loss cancels capture',binding().directions.left.kind==='mouseButton');
 const frames=new Map(),raf=window.requestAnimationFrame,caf=window.cancelAnimationFrame;let frameId=0,pads=[];
 window.requestAnimationFrame=cb=>{frames.set(++frameId,cb);return frameId;};window.cancelAnimationFrame=id=>frames.delete(id);
 Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>pads});
 const tick=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(cb=>cb(performance.now()));};
 pads=[{index:0,buttons:[{pressed:true}],axes:[1,-1]}];arm('left');tick();
 check('held gamepad button and resting axes do not assign',binding().directions.left.kind==='mouseButton');
 pads[0].buttons[0].pressed=false;tick();pads=[];tick();pads=[{index:0,buttons:[{pressed:true}],axes:[0,0]}];tick();
 check('reconnected held button needs a fresh release',binding().directions.left.kind==='mouseButton');
 pads[0].buttons[0].pressed=false;tick();pads[0].buttons[0].pressed=true;tick();
 check('fresh gamepad button edge assigns',binding().directions.left.kind==='gamepadButton'&&binding().directions.left.button===0);
 window.requestAnimationFrame=raf;window.cancelAnimationFrame=caf;
 arm('left');area.dispatchEvent(new MouseEvent('mousedown',{button:1,bubbles:true,cancelable:true}));
 arm('left');q('#binding-capture-stop').click();key('KeyP');
 check('cancel capture keeps menu open and binding unchanged',dialog.open&&binding().directions.left.kind==='mouseButton');
 arm('left');key('KeyJ');q('#binding-capture-cancel').click();await new Promise(r=>setTimeout(r,0));
 check('Done returns focus to opener',!dialog.open&&document.activeElement===opener);
 opener.click();arm('left');dialog.close();await new Promise(r=>setTimeout(r,0));key('KeyP');
 check('programmatic close cancels capture',binding().directions.left.code==='KeyJ');
 const stage=q('.preview-primary-stage');stage.focus();
 stage.dispatchEvent(new KeyboardEvent('keydown',{key:'l',code:'KeyL',bubbles:true,cancelable:true}));
 stage.dispatchEvent(new KeyboardEvent('keyup',{key:'l',code:'KeyL',bubbles:true}));
 check('accepted key drives the live preview',Number(q('.preview-pane [data-preview-x]').textContent)>0);
 opener.click();arm('down');area.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));
 check('Escape closes and stops capture',!dialog.open&&area.dataset.listening==='false');
 q('#input-preset').value='gamepad-left-stick';q('#input-preset').dispatchEvent(new Event('change',{bubbles:true}));opener.click();
 check('analog preset is clearly read-only in digital capture menu',[...dialog.querySelectorAll('[data-binding-capture-target]')].every(button=>button.disabled)&&q('#binding-capture-instruction').textContent.includes('analog'));
 q('#binding-capture-cancel').click();q('#input-preset').value='arrow-keys';q('#input-preset').dispatchEvent(new Event('change',{bubbles:true}));
 opener.click();window.scrollTo(0,0);await new Promise(resolve=>setTimeout(resolve,250));
 const box=dialog.getBoundingClientRect();check('dialog controls fit viewport',box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight&&[...dialog.querySelectorAll('button')].every(e=>{const b=e.getBoundingClientRect();return b.left>=box.left&&b.right<=box.right;}));
 const theme=window.fixtureTheme??(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');
 check('opener uses the matching theme asset',getComputedStyle(opener.firstElementChild).backgroundImage.includes('flubber-input-'+theme));
 document.getElementById('receipt').textContent=JSON.stringify({pass:true,checks,theme,dialogWidth:box.width});
};` } });
// Chrome's headless window has a platform minimum width. Exercise a genuinely
// 320px dialog inside a desktop viewport instead of mislabelling a clipped PNG.
for (const sample of [{name:'dark',width:1280}, {name:'light-narrow',width:820,dialogWidth:320}, {name:'native-adapter-ui',width:1280,surface:'tauri'}]) {
 const fixture=join(output,sample.name+'.html');
 // Force the source light-theme rule for component visual QA; this does not
 // change the user's OS theme or claim OS media-query integration qualification.
 const light=sample.name==='light-narrow';
 const fixtureCss=light?css.replace('@media (prefers-color-scheme: light)', '@media all'):css;
 await writeFile(fixture, `<!doctype html><meta charset="utf-8"><style>${fixtureCss}\n#receipt{display:none}${sample.dialogWidth ? '#binding-capture-dialog{width:'+sample.dialogWidth+'px}' : ''}</style><div id="research-app" data-research-surface="${sample.surface??'browser'}"></div><pre id="receipt">pending</pre><script type="module">window.fixtureTheme=${JSON.stringify(light?'light':null)};${bundle.outputFiles[0].text}\n${sample.surface?'checkNativeMenu':'checkMenu'}().catch(error=>document.getElementById('receipt').textContent=JSON.stringify({pass:false,error:error.stack}));</script>`);
 const profile=await mkdtemp(join(output,'isolated-profile-'));
 const {stdout,stderr}=await promisify(execFile)(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--run-all-compositor-stages-before-draw','--force-prefers-color-scheme='+(sample.name==='dark'?'dark':'light'),...(sample.name==='dark'?['--force-dark-mode']:[]), '--hide-scrollbars', '--user-data-dir='+profile,'--window-size='+sample.width+',1000','--virtual-time-budget=3500','--screenshot='+join(output,sample.name+'.png'),'--dump-dom',pathToFileURL(fixture).href],{windowsHide:true,timeout:30000,maxBuffer:5_000_000});
 await writeFile(join(output,sample.name+'-browser.log'),stderr);
 await writeFile(join(output,sample.name+'-dom.html'),stdout);
 const receipt=JSON.parse(stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1]??'null');
 await writeFile(join(output,sample.name+'.json'),JSON.stringify(receipt,null,2));
 assert.ok(receipt?.pass,JSON.stringify(receipt));
 console.log(JSON.stringify({sample:sample.name,checks:receipt.checks.length,pass:true}));
}
