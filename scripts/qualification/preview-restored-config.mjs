// Dedicated headless profiles only. Does not connect to a user app or Runner.
// node scripts/qualification/preview-restored-config.mjs <browser.exe> <output-dir>
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "esbuild";

const [browser,destination]=process.argv.slice(2);
assert.ok(browser&&destination);
const output=resolve(destination);await mkdir(output,{recursive:true});
const repository=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const run=promisify(execFile);
const git=async(...args)=>(await run("git",args,{cwd:repository,windowsHide:true})).stdout.trim();
const provenance={commit:await git("rev-parse","HEAD"),applicationTree:await git("rev-parse","HEAD:site"),applicationDirty:Boolean(await git("diff","HEAD","--name-only","--","site")),browserSha256:createHash("sha256").update(await readFile(browser)).digest("hex")};
const css=(await readFile(new URL("../../site/research.css",import.meta.url),"utf8"))
  .replaceAll('./assets/',pathToFileURL(fileURLToPath(new URL('../../site/assets/',import.meta.url))).href);
const bundle=await build({write:false,bundle:true,format:"esm",stdin:{resolveDir:fileURLToPath(new URL(".",import.meta.url)),contents:`import {checkPreviewInspectionReset} from './preview-inspection-reset-fixture.js';checkPreviewInspectionReset().then(receipt=>parent.document.querySelector('#receipt').textContent=JSON.stringify(receipt)).catch(error=>parent.document.querySelector('#receipt').textContent=JSON.stringify({pass:false,error:error.stack}));`}});
for(const width of [1280,800]){
 const profile=await mkdtemp(join(output,`profile-${width}-`)),file=join(output,`${width}.html`),png=join(output,`${width}.png`);
 const frame=`<!doctype html><meta charset="utf-8"><style>${css}</style><div id="research-app" data-research-surface="browser"></div><script type="module">${bundle.outputFiles[0].text.replaceAll("</script","<\\/script")}</script>`;
 await writeFile(file,`<!doctype html><style>html,body{margin:0}iframe{border:0;width:${width}px;height:1000px}</style><pre id="receipt" hidden></pre><iframe srcdoc="${frame.replaceAll('&','&amp;').replaceAll('"','&quot;')}"></iframe>`);
 const {stdout}=await run(browser,["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check",`--user-data-dir=${profile}`,`--window-size=${width},1000`,"--virtual-time-budget=4000",`--screenshot=${png}`,"--dump-dom",pathToFileURL(file).href],{windowsHide:true,timeout:30000,maxBuffer:3_000_000});
 const raw=stdout.match(/<pre id="receipt" hidden="">([^<]+)<\/pre>/u)?.[1];assert.ok(raw,"Missing fixture receipt");
 const receipt=JSON.parse(raw.replaceAll('&quot;','"').replaceAll('&gt;','>').replaceAll('&lt;','<').replaceAll('&amp;','&'));
 receipt.provenance={...provenance,fixtureSha256:createHash('sha256').update(await readFile(file)).digest('hex'),screenshotSha256:createHash('sha256').update(await readFile(png)).digest('hex')};
 await writeFile(join(output,`${width}.json`),JSON.stringify(receipt,null,2));assert.ok(receipt.pass,JSON.stringify(receipt));
 console.log(JSON.stringify({width,checks:receipt.rows.length,pass:true}));
}
