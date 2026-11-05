// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const gate='scripts/check-installation-gate.mjs';
const run=(flag)=>spawnSync(process.execPath,[gate,...flag],{
  encoding:'utf8',timeout:5000,cwd:process.cwd(),
});
test('D-53 is truly executed from CLI, no silent no-op in publication pipeline',async()=>{
  const config=JSON.parse(await readFile('config/installation-readiness.json','utf8'));
  const blockers=Object.entries(config.checks).filter(([,ok])=>!ok).map(([name])=>name);
  assert.equal(config.readyForOwnerInstallation,false);
  assert.equal(config.ownerDeploymentConsentRecorded,false);
  assert.equal(blockers.length,14);
  const report=run([]);
  assert.equal(report.status,0,report.stderr);
  const payload=JSON.parse(report.stdout);
  assert.equal(payload.releaseReady,false);
  assert.equal(payload.ready,false);
  assert.deepEqual(payload.blockers,blockers);
  assert.match(payload.summary,/NOT READY/);
});
test('release workflow cannot bypass open production gate on CLI',()=>{
  for(const flag of ['--require-ready','--require-release']){
    const result=run([flag]);
    assert.equal(result.status,2,'flag='+flag+' '+result.stderr);
    assert.equal(JSON.parse(result.stdout).releaseReady,false);
    assert.equal(JSON.parse(result.stdout).ready,false);
  }
});
test('invalid flags are rejected and never silently accepted',()=>{
  for(const argv of [['--unknown'],['--require-ready','--require-release']]){
    const result=run(argv);
    assert.equal(result.status,1,result.stderr);
    assert.match(result.stderr,/Usage/);
  }
});
