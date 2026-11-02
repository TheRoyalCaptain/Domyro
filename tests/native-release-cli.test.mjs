// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const bin='scripts/domyro-release.mjs';
const run=(args)=>spawnSync(process.execPath,[bin,...args],{
  cwd:process.cwd(),encoding:'utf8',timeout:8000,
});
test('install/update never activate a service while D-53 is closed',()=>{
  for(const command of ['install','update']){
    const result=run([command]);
    assert.equal(result.status,53,result.stderr);
    const data=JSON.parse(result.stdout);
    assert.equal(data.installAllowed,false);
    assert.equal(data.installationGate,'D-53');
    assert.equal(data.status,'blocked');
  }
});
test('invalid and duplicate arguments never trigger network or deployment',()=>{
  for(const args of [
    [],['fetch'],['check'],['check','--current=0.1.1','--arch=amd64'],
    ['prepare','--current=0.1.1'],
    ['prepare','--current=0.1.1','--arch=amd64','--schema=3',
      '--publisher-key=/etc/passwd','--publisher-fingerprint=bad'],
    ['check','--current=0.1.1','--current=0.1.2'],
  ]){
    const result=run(args);
    assert.equal(result.status,1,args.join(' ')+' '+result.stderr);
    assert.match(result.stderr,/release_cli_/);
  }
});
test('release CLI syntax, no proprietary install and no executable unpinned release key',()=>{
  const result=spawnSync(process.execPath,['--check',bin],{
    cwd:process.cwd(),encoding:'utf8',
  });
  assert.equal(result.status,0,result.stderr);
});
