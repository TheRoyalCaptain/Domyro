// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const script=resolve('scripts/ci-native-account-test.sh');
const base={
  ...process.env,
  GITHUB_ACTIONS:'true',
  RUNNER_ENVIRONMENT:'github-hosted',
  DOMYRO_CI_SYSTEMD_ALLOWED:'1',
  RUNNER_OS:'Linux',
  GITHUB_RUN_ID:'12345678901',
  GITHUB_RUN_ATTEMPT:'1',
  GITHUB_WORKSPACE:process.cwd(),
};
test('privileged native service-account rehearsal rejects non-CI execution before host changes',()=>{
  for(const override of [
    {GITHUB_ACTIONS:'false'},
    {RUNNER_ENVIRONMENT:'self-hosted'},
    {DOMYRO_CI_SYSTEMD_ALLOWED:'0'},
    {RUNNER_OS:'Windows'},
    {GITHUB_RUN_ID:'../etc'},
    {GITHUB_RUN_ATTEMPT:'0;rm'},
  ]){
    const result=spawnSync('bash',[script],{
      env:{...base,...override},cwd:process.cwd(),timeout:5000,encoding:'utf8',
    });
    assert.equal(result.status,90,JSON.stringify(override)+' '+result.stderr);
    assert.match(result.stderr,/Refusing native account test/);
  }
});
test('native account rehearsal refuses a non-hosted workspace without sudo',()=>{
  const result=spawnSync('bash',[script],{
    env:{...base,GITHUB_WORKSPACE:'/tmp/domyro-not-hosted'},
    cwd:process.cwd(),timeout:5000,encoding:'utf8',
  });
  // The script may reject earlier if the current user is not the hosted runner.
  assert.ok([90,91].includes(result.status),result.stderr);
});
