// Actual bootResearchUi screenshots in independent off-screen fixture profiles.
import { execFile } from 'node:child_process';
import { readFile,mkdir,mkdtemp,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const run=promisify(execFile);
const [browser,destination,selection='initial']=process.argv.slice(2);
assert.ok(browser && destination,'Provide browser executable and output directory.');
assert.ok(['initial','details'].includes(selection),'Selection must be initial or details.');
const output=resolve(destination); await mkdir(output,{recursive:true});
const bundle=await build({entryPoints:['test/fixtures/questionnaire-visual-browser.js'],bundle:true,write:false,metafile:true,format:'iife',target:'chrome105',loader:{'.csv':'text'},logLevel:'silent',define:{'import.meta.url':JSON.stringify(pathToFileURL(resolve('site/src/research/app.js')).href)}});
const css=await readFile('site/research.css','utf8');
const sourceFiles={};
for (const path of [...Object.keys(bundle.metafile.inputs),'site/research.css','scripts/qualification/questionnaire-visual.mjs'].sort()) sourceFiles[path]=createHash('sha256').update(await readFile(path)).digest('hex');
const {stdout:commit}=await run('git',['rev-parse','HEAD'],{windowsHide:true});
const {stdout:sourceStatus}=await run('git',['status','--short'],{windowsHide:true});
const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Section 2 visual fixture</title><style>${css}</style></head><body><div id="research-app" data-research-surface="browser"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/giu,'<\\/script')}</script></body></html>`;
const fixture=join(output,'questionnaire-visual.html'); await writeFile(fixture,html);
const screenshots=[];
for(const [width,height] of [[1600,1100],[1000,1000]]) for(const state of selection==='details' ? ['german','settings','footer'] : ['empty','populated','error']) {
  const profile=await mkdtemp(join(output,'isolated-profile-'));
  const name=`${state}-${width}`;
  const screenshot=join(output,`${name}.png`);
  const {stdout,stderr}=await run(browser,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,`--window-size=${width},${height}`,'--virtual-time-budget=10000',`--screenshot=${screenshot}`,'--dump-dom',`${pathToFileURL(fixture).href}#${state}`],{windowsHide:true,timeout:45000,maxBuffer:5_000_000});
  await writeFile(join(output,`${name}.html`),stdout); await writeFile(join(output,`${name}.log`),stderr);
  assert.ok(stdout.includes(`data-visual-receipt="${state}"`) && !stdout.includes('data-visual-error='),`Fixture failed: ${name}`);
  const metrics=stdout.match(/<script id="questionnaire-visual-metrics" type="application\/json">(.*?)<\/script>/su);
  if(selection==='details') assert.ok(metrics,`Missing scrolled fixture metrics: ${name}`);
  screenshots.push({state,width,height,path:screenshot,...(metrics ? {metrics:JSON.parse(metrics[1])} : {})});
}
await writeFile(join(output,'receipt.json'),JSON.stringify({sourceCommit:commit.trim(),sourceStatus:sourceStatus.trim(),sourceFiles,purpose:'Off-screen visual audit; not runtime qualification',screenshots},null,2));
console.log(JSON.stringify({sourceCommit:commit.trim(),screenshots}));
