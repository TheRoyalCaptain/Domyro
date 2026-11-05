// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const matrix=resolve('scripts/ci-signed-package-admission-matrix.sh');
const signer=resolve('scripts/ci-stage-signed-source.mjs');
const env={
  ...process.env,
  GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',
  DOMYRO_CI_SYSTEMD_ALLOWED:'1',DOMYRO_CI_SIGNED_ADMISSION_MATRIX:'1',
  GITHUB_RUN_ID:'12345678901',GITHUB_RUN_ATTEMPT:'1',
  USER:'runner',GITHUB_WORKSPACE:process.cwd(),
};
test('signed package admission CI matrix rejects non-hosted or malformed environment',()=>{
  for(const override of [
    {GITHUB_ACTIONS:'false'},
    {RUNNER_ENVIRONMENT:'self-hosted'},
    {RUNNER_OS:'Windows'},
    {DOMYRO_CI_SYSTEMD_ALLOWED:'0'},
    {DOMYRO_CI_SIGNED_ADMISSION_MATRIX:'0'},
    {GITHUB_RUN_ID:'../etc'},
    {GITHUB_RUN_ATTEMPT:'1;drop'},
    {USER:'not-runner'},
    {GITHUB_WORKSPACE:'/tmp/not-hosted'},
  ]){
    const result=spawnSync('bash',[matrix],{
      env:{...env,...override},cwd:process.cwd(),timeout:5000,encoding:'utf8',
    });
    assert.ok([90,91].includes(result.status),
      JSON.stringify(override)+' status='+result.status+' stderr='+result.stderr);
    assert.match(result.stderr,/Refusing signed admission test/);
  }
});
test('offline signed source CI staging rejects execution outside hosted runner',()=>{
  const result=spawnSync(process.execPath,[signer,resolve('some-release-store')],{
    env:{...env,GITHUB_ACTIONS:'false'},cwd:process.cwd(),
    timeout:5000,encoding:'utf8',
  });
  assert.equal(result.status,1,result.stderr);
  assert.match(result.stderr,/ci_signed_stage_requires_disposable_hosted_runner/);
});
test('signed admission Bash script passes syntax check',()=>{
  const result=spawnSync('bash',['-n',matrix],{timeout:5000,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
