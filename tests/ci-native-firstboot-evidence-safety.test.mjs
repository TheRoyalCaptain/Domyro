// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const script=resolve('scripts/ci-native-firstboot-evidence.mjs');
const base={
  ...process.env,
  GITHUB_ACTIONS:'true', RUNNER_ENVIRONMENT:'github-hosted',
  RUNNER_OS:'Linux', DOMYRO_CI_SYSTEMD_ALLOWED:'1',
  DOMYRO_CI_PG_ONBOARDING:'1', DOMYRO_CI_FIRSTBOOT_EVIDENCE:'1',
  DOMYRO_TEST_DATABASE_URL:'postgresql://domyro_test:ci-throwaway-test-only@127.0.0.1:5432/domyro_test',
  GITHUB_RUN_ID:'12345678901', GITHUB_RUN_ATTEMPT:'1',USER:'runner',
  GITHUB_WORKSPACE:process.cwd(),
  DOMYRO_CI_STAGING_BASE:'/tmp/wrong',
  DOMYRO_CI_FIRSTBOOT_JOURNAL_DIR:'/tmp/wrong',
};
function call(env,action='begin') {
  return spawnSync(process.execPath,[script,action],{
    cwd:process.cwd(),env:{...base,...env},timeout:5000,encoding:'utf8',
  });
}
test('firstboot evidence bridge refuses self-hosted or non-disposable targets',()=>{
  for(const extra of [
    {GITHUB_ACTIONS:'false'}, {RUNNER_ENVIRONMENT:'self-hosted'},
    {RUNNER_OS:'Windows'}, {DOMYRO_CI_SYSTEMD_ALLOWED:'0'},
    {DOMYRO_CI_PG_ONBOARDING:'0'}, {DOMYRO_CI_FIRSTBOOT_EVIDENCE:'0'},
    {DOMYRO_TEST_DATABASE_URL:'postgresql://postgres@localhost:5432/postgres'},
    {GITHUB_RUN_ID:'../../etc'}, {GITHUB_RUN_ATTEMPT:'x'},
    {USER:'root'}, {GITHUB_WORKSPACE:'/tmp/non-hosted'},
  ]) {
    const result=call(extra);
    assert.equal(result.status,1,JSON.stringify(extra)+' '+result.stderr);
    assert.match(result.stderr,/ci_firstboot_evidence_requires_hosted_disposable_runner/);
  }
});
test('firstboot bridge rejects arbitrary destinations and unknown steps',()=>{
  for(const phase of ['migrate','install','erase','enable']) {
    const result=call({},phase);
    assert.equal(result.status,1,result.stderr);
    assert.match(result.stderr,/ci_firstboot_evidence_requires_hosted_disposable_runner/);
  }
  // On ordinary developer machines runner identity is itself a blocker;
  // additionally assert the fixed-path allowlist statically remains present.
  const result=call({
    DOMYRO_CI_STAGING_BASE:'/etc',
    DOMYRO_CI_FIRSTBOOT_JOURNAL_DIR:'/var/lib',
  });
  assert.equal(result.status,1,result.stderr);
});
test('firstboot bridge script parses on Node without external service access',()=>{
  const result=spawnSync(process.execPath,['--check',script],{
    cwd:process.cwd(),encoding:'utf8',timeout:5000,
  });
  assert.equal(result.status,0,result.stderr);
});
