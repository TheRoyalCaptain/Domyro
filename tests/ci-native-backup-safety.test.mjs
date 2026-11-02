// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const script=resolve('scripts/ci-native-backup-restore-proof.mjs');
const existing=resolve('scripts/ci-native-account-test.sh');
const crash=resolve('scripts/ci-native-sigkill-recovery.sh');
const env={
  ...process.env,
  GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',
  DOMYRO_CI_SYSTEMD_ALLOWED:'1',DOMYRO_CI_PG_ONBOARDING:'1',
  DOMYRO_CI_NATIVE_BACKUP:'1',
  DOMYRO_TEST_DATABASE_URL:'postgresql://domyro_test:ci-throwaway-test-only@127.0.0.1:5432/domyro_test',
  GITHUB_RUN_ID:'12345678901',GITHUB_RUN_ATTEMPT:'1',USER:'runner',
  GITHUB_WORKSPACE:process.cwd(),
  DOMYRO_CI_STAGING_BASE:'/tmp/not-a-signed-staging-dir',
};
function call(changes={},action='create'){
  return spawnSync(process.execPath,[script,action],{
    cwd:process.cwd(),env:{...env,...changes},timeout:5000,encoding:'utf8',
  });
}
test('independent native encrypted backup restore proof blocks untrusted execution',()=>{
  for(const options of [
    {GITHUB_ACTIONS:'false'},
    {RUNNER_ENVIRONMENT:'self-hosted'},
    {RUNNER_OS:'Windows'},
    {DOMYRO_CI_SYSTEMD_ALLOWED:'0'},
    {DOMYRO_CI_PG_ONBOARDING:'0'},
    {DOMYRO_CI_NATIVE_BACKUP:'0'},
    {DOMYRO_TEST_DATABASE_URL:'postgresql://postgres:password@127.0.0.1:5432/main'},
    {GITHUB_RUN_ID:'../../../etc'},
    {GITHUB_RUN_ATTEMPT:'notnumeric'},
    {USER:'root'},
    {GITHUB_WORKSPACE:'/tmp/owner-server'},
  ]){
    const r=call(options);
    assert.equal(r.status,1,JSON.stringify(options)+' '+r.stderr);
    assert.match(r.stderr,/ci_native_backup_requires_disposable_hosted_runner/);
    assert.doesNotMatch(r.stderr,/password@/);
  }
});
test('backup restoration has no arbitrary target or method',()=>{
  for(const action of ['restore','overwrite','delete','download','update','../../etc']){
    const r=call({},action);
    assert.equal(r.status,1,r.stderr);
  }
  const r=call({DOMYRO_CI_STAGING_BASE:'/var/lib/domyro'});
  assert.equal(r.status,1,r.stderr);
  assert.match(r.stderr,/ci_native_backup_/);
});
test('native installer and SIGKILL-parent require independent scratch recovery proof',()=>{
  const installer=readFileSync(existing,'utf8');
  const outer=readFileSync(crash,'utf8');
  assert.ok(installer.includes('DOMYRO_CI_NATIVE_BACKUP=1 node "$CI_BACKUP_BRIDGE" create'));
  assert.ok(installer.includes('ci_journal postgres_scratch_restore_verified'));
  assert.ok(outer.includes('node scripts/ci-native-backup-restore-proof.mjs verify'));
  assert.ok(outer.includes('report.phase!=="postgres_scratch_restore_verified"'));
  const recovery=readFileSync(script,'utf8');
  assert.ok(recovery.includes('ci_native_backup_source_changed_during_restore'));
  assert.ok(recovery.includes('ci_native_backup_allowed_inplace_restore'));
  assert.ok(recovery.includes('ci_native_backup_accepted_tampered_blob'));
  assert.ok(recovery.includes('await empty(targetUrl)'));
});
test('backup proof and CI installer scripts parse without privileged execution',()=>{
  const r=spawnSync(process.execPath,['--check',script],{timeout:5000,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const b=spawnSync('bash',['-n',existing,crash],{timeout:5000,encoding:'utf8'});
  assert.equal(b.status,0,b.stderr);
});
