// Synthetic subprocess tests of the driver only, never production CLI evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { runPlannerCli } from "../scripts/qualification/planner-cli-driver.mjs";

const CHILD = `
import { createInterface } from 'node:readline';
const mode = process.argv[2];
const sessionId = 'b5b47dd1-45b4-4b69-b992-6ec777cfaf11';
let revision = 0;
const output = value => console.log(JSON.stringify(value));
if (mode === 'timeout') setInterval(() => {}, 1000);
else if (mode === 'invalid-utf8') process.stdout.write(Buffer.from([255,10]));
else {
  output({schema:'affect-research-planner-cli-ready',version:1,sessionId,revision,processId:process.pid,buildCommit:'a'.repeat(40),transport:'stdio',hidden:true});
  createInterface({input:process.stdin}).on('line', line => {
    const r=JSON.parse(line), mutation=r.expectedRevision!==null;
    if (mutation) {
      if (r.expectedRevision!==revision) throw Error('wrong driver revision');
      revision++;
    }
    const response={schema:'affect-research-planner-command-result',version:1,sessionId:mode==='wrong-session'?'a5b47dd1-45b4-4b69-b992-6ec777cfaf11':sessionId,requestId:r.requestId,status:mode==='rejected'?'rejected':mutation?'applied':'ok',revision,result:null,issues:[]};
    output(response);
    if(mode==='duplicate')output(response);
  });
}
`;

async function fixture(t) {
  const prefix = join(resolve(tmpdir()), "planner-cli-driver-test-");
  const directory = await mkdtemp(prefix);
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(prefix), "Cleanup stays in the created test directory");
    await rm(directory, { recursive: true, force: true });
  });
  const script = join(directory, "synthetic-child.mjs");
  await writeFile(script, CHILD, { flag: "wx" });
  return { directory, script };
}

test("driver supplies live identity/revision, drains EOF and preserves a reproducible transcript", async t => {
  const { directory, script } = await fixture(t);
  const outputDirectory = join(directory, "evidence");
  const receipt = await runPlannerCli({ executable: process.execPath, args: [script, "ok"], outputDirectory,
    steps: [{action:{kind:"snapshot"}}, {action:{kind:"set",field:"P7.participantCount",value:3}},
      {action:{kind:"set",field:"P7.participantCount",value:4}}], timeoutMs:30000 });
  assert.equal(receipt.passed, true, receipt.failure);
  assert.equal(receipt.completedSteps, 3);
  assert.equal(receipt.finalRevision, 2);
  assert.equal(receipt.exit.code, 0);
  const lines = (await readFile(join(outputDirectory,"transcript.jsonl"),"utf8")).trim().split("\n").map(JSON.parse);
  const requests = lines.filter(line=>line.direction==="request").map(line=>line.value);
  assert.deepEqual(requests.map(r=>r.expectedRevision),[null,0,1]);
  assert.equal(new Set(requests.map(r=>r.requestId)).size,3);
  assert.ok(requests.every(r=>r.sessionId===receipt.ready.sessionId));
  await assert.rejects(runPlannerCli({ executable:process.execPath,args:[script,"ok"],outputDirectory,
    steps:[{action:{kind:"snapshot"}}] }), /EEXIST/u);
  assert.deepEqual(JSON.parse(await readFile(join(outputDirectory,"receipt.json"),"utf8")), receipt);
});

for (const mode of ["wrong-session","duplicate","rejected","invalid-utf8","timeout"]) {
  test(`driver stops on ${mode} and retains failure evidence without retry`, async t => {
    const { directory,script }=await fixture(t);
    const outputDirectory=join(directory,"evidence");
    const receipt=await runPlannerCli({executable:process.execPath,args:[script,mode],outputDirectory,
      steps:[{action:{kind:"set",field:"P7.participantCount",value:3}}],timeoutMs: mode==="timeout"?1000:30000});
    assert.equal(receipt.passed,false);
    assert.ok(receipt.failure);
    const expectedFailure = {"wrong-session":/another session/u,"duplicate":/unsolicited or duplicate/u,
      "rejected":/returned rejected/u,"invalid-utf8":/encoded data|encoding/u,"timeout":/deadline elapsed/u};
    assert.match(receipt.failure,expectedFailure[mode]);
    const lines=(await readFile(join(outputDirectory,"transcript.jsonl"),"utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
    assert.ok(lines.filter(line=>line.direction==="request").length<=1);
    assert.notEqual(receipt.exit,null);
    assert.deepEqual(JSON.parse(await readFile(join(outputDirectory,"receipt.json"),"utf8")),receipt);
  });
}
