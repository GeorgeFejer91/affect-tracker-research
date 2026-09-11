// Off-screen, isolated DOM behavior receipt. No user browser/clipboard/input.
// node scripts/qualification/questionnaire-table.mjs <edge.exe> <output-directory>
import { execFile } from 'node:child_process';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const [browser, destination] = process.argv.slice(2);
assert.ok(browser && destination, 'Provide a browser executable and an isolated output directory.');
const output = resolve(destination);
await mkdir(output, {recursive:true});
const profile = await mkdtemp(join(output,'isolated-profile-'));
const bundle = await build({ entryPoints:['test/fixtures/questionnaire-table-browser.js'], bundle:true,
  write:false, format:'iife', target:'chrome105', loader:{'.csv':'text'}, logLevel:'silent',
  define:{'import.meta.url':JSON.stringify(pathToFileURL(resolve('site/src/research/ui-view.js')).href)} });
const css = await readFile('site/research.css','utf8');
const html = `<!doctype html><meta charset="utf-8"><title>Section 2 off-screen regression</title><style>${css}</style><main></main><pre id="receipt">pending</pre><script>${bundle.outputFiles[0].text.replace(/<\/script/giu,'<\\/script')}</script>`;
const fixture = join(output,'questionnaire-table.html');
await writeFile(fixture,html);
const {stdout,stderr} = await promisify(execFile)(browser, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  `--user-data-dir=${profile}`,'--window-size=1366,1000','--virtual-time-budget=10000','--dump-dom',pathToFileURL(fixture).href],
  {windowsHide:true,timeout:45000,maxBuffer:4_000_000});
await writeFile(join(output,'dom.html'),stdout);
await writeFile(join(output,'browser.log'),stderr);
const raw = stdout.match(/<pre id="receipt">([^<]+)<\/pre>/u)?.[1];
assert.ok(raw && raw !== 'pending','Headless questionnaire fixture did not finish.');
const receipt = JSON.parse(raw.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&gt;','>').replaceAll('&lt;','<'));
await writeFile(join(output,'receipt.json'),JSON.stringify(receipt,null,2));
assert.equal(receipt.passed,true,JSON.stringify(receipt));
console.log(JSON.stringify({passed:true,cases:receipt.cases,output}));
