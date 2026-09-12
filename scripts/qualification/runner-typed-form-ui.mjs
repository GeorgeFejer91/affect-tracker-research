// Real Chromium controls and P2 validators; no native runtime or participant data.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination); const root = resolve(import.meta.dirname, "../.."), output = resolve(destination);
await mkdir(output); const execute = promisify(execFile);
const entry = String.raw`
import {renderTypedForm} from './runner/src/typed-form.js';
import {verifyFormDefinitionV1} from './site/src/research/form-definition.js';
const language=new URL(location.href).searchParams.get('language'),checks=[],errors=[];
const check=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
try {
 const definition=await verifyFormDefinitionV1(await(await fetch('/test/fixtures/demographics-'+language+'-form-v1.canonical.json')).json());
 document.documentElement.lang=language; document.getElementById('title').textContent=definition.title;
 const host=document.getElementById('fields'),form=document.querySelector('form'),button=document.querySelector('button');
 const presenter=renderTypedForm(host,definition,{kind:'fields',questionnaireId:definition.questionnaireId,definitionSha256:definition.definitionSha256});
 document.getElementById('instructions').textContent=presenter.instructions;button.textContent=presenter.submitLabel;
 let submits=0;form.addEventListener('submit',e=>{e.preventDefault();presenter.read();submits++;});
 const fill=(id,value)=>{const input=host.querySelector('[data-form-item="'+id+'"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));return input;};
 const choose=(id,value)=>host.querySelector('[data-form-item="'+id+'"][value="'+value+'"]').click();
 const rejects=fn=>{try{fn();return false;}catch{return true;}};
 check(host.querySelectorAll('fieldset').length===4,'all four authored fields render');
 check([...host.querySelectorAll('legend')].every((el,i)=>el.textContent===definition.items[i].prompt),'exact localized field prompts');
 check([...host.querySelectorAll('label span')].map(el=>el.textContent).join('|')===definition.items.slice(2).flatMap(i=>i.response.options.map(o=>o.label)).join('|'),'exact localized option labels');
 check(presenter.progress().answered===0,'no default answers');button.click();check(submits===0,'empty form cannot submit');
 fill('fullName',' \u0085\ufeff ');check(!presenter.read({allowPartial:true}).complete,'exact whitespace draft is unanswered');button.click();check(submits===0,'whitespace cannot submit');
 const name='  Test Participant Ä\n李 👩🏽‍🔬  ';
 fill('fullName',name);fill('age','0');choose('gender','preferNotToSay');button.click();check(submits===0,'missing handedness cannot submit');
 choose('handedness','ambidextrous');
 const accepted=presenter.read();check(accepted.complete&&accepted.answers.length===4,'every field is required and complete');
 check(accepted.answers[0].value.text===name,'text preserves whitespace newlines and Unicode');
 check(accepted.answers[1].value.integer===0,'zero whole years accepted without eligibility gate');
 check(accepted.answers[2].value.optionId==='preferNotToSay','explicit prefer not to say is a response');
 button.click();check(submits===1,'valid form submits once');
 fill('age','1.5');check(rejects(()=>presenter.read({allowPartial:true})),'fractional age rejected even as draft');
 fill('age','9007199254740992');check(rejects(()=>presenter.read()),'unsafe integer rejected');
 fill('age','9007199254740991');check(presenter.read().answers[1].value.integer===9007199254740991,'safe representation bound accepted');fill('age','30');
 fill('fullName','ä'.repeat(513));check(rejects(()=>presenter.read({allowPartial:true})),'UTF8 byte limit enforced');fill('fullName',name);
 presenter.setDisabled(true);check([...host.querySelectorAll('input,textarea')].every(input=>input.disabled),'native pending state disables all answer controls');presenter.setDisabled(false);
 const progress=presenter.progress();document.getElementById('progress').textContent=progress.text;check(progress.answered===4,'localized completion count');
 check(document.documentElement.scrollWidth<=innerWidth,'no horizontal overflow');
 check(button.getBoundingClientRect().bottom<=innerHeight,'all demographic fields and Submit fit desktop viewport');
 check([...host.querySelectorAll('input,textarea')].every(input=>input.required),'required semantics exposed to browser');
}catch(error){errors.push(String(error));}
const receipt=document.createElement('pre');receipt.id='receipt';receipt.hidden=true;receipt.textContent=JSON.stringify({language,checks,errors,viewport:[innerWidth,innerHeight],scope:'P2 validator and real browser controls only; fictitious answers; no native execution'});document.body.append(receipt);
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: root, sourcefile: "typed-form-audit.js" }, bundle: true, format: "esm", write: false, platform: "browser", logLevel: "silent" });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/runner/runner.css"><div class="runner-shell is-presenting"><main class="runner-presentation"><section id="runner-questionnaire" class="runner-participant-page"><h2 id="title"></h2><p id="instructions"></p><p id="progress"></p><form><div id="fields"></div><button type="submit" class="primary-action"></button></form></section></main></div><script type="module" src="/audit.js"></script>'); return; }
    if (url.pathname === "/audit.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    const path = resolve(root, "." + decodeURIComponent(url.pathname)); assert.ok(path.startsWith(root + sep));
    res.setHeader("Content-Type", ({ ".css": "text/css", ".json": "application/json" })[extname(path)] ?? "application/octet-stream"); res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done)); const rows = [];
try {
  for (const language of ["en", "de"]) {
    const profile = await mkdtemp(join(output, "profile-"));
    const { stdout } = await execute(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--window-size=1938,1176", "--force-device-scale-factor=1", "--virtual-time-budget=10000", `--screenshot=${join(output, language + ".png")}`, "--dump-dom", `http://127.0.0.1:${server.address().port}/?language=${language}`], { windowsHide: true, timeout: 45000, maxBuffer: 4_000_000 });
    await writeFile(join(output, language + ".html"), stdout);
    const raw = stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1]; assert.ok(raw, "Missing browser receipt");
    const row = JSON.parse(raw.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")); rows.push(row); console.log(JSON.stringify(row)); assert.deepEqual(row.errors, []);
  }
} finally { server.close(); await writeFile(join(output, "receipt.json"), JSON.stringify({ root, rows }, null, 2)); }
