#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CI-ONLY first-boot evidence bridge. Records actual completed steps into a
 * crash-visible, private /tmp journal. Never authorizes production deployment.
 * No database mutations, package installation or service-control writes.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import {
  createFirstBootIntent, advanceFirstBootIntent, inspectFirstBootIntent,
  FIRSTBOOT_PHASES,
} from '../src/lifecycle/native-firstboot-journal.mjs';

const DB_URL='postgresql://domyro_test:ci-throwaway-test-only@127.0.0.1:5432/domyro_test';
const PHASES=new Set(FIRSTBOOT_PHASES);
const fail=(message)=>{throw new Error(message);};
const numeric=s=>typeof s==='string'&&/^[0-9]+$/.test(s);
function guard(){
  if(process.env.GITHUB_ACTIONS!=='true'||
    process.env.RUNNER_ENVIRONMENT!=='github-hosted'||
    process.env.RUNNER_OS!=='Linux'||
    process.env.DOMYRO_CI_SYSTEMD_ALLOWED!=='1'||
    process.env.DOMYRO_CI_PG_ONBOARDING!=='1'||
    process.env.DOMYRO_CI_FIRSTBOOT_EVIDENCE!=='1'||
    process.env.DOMYRO_TEST_DATABASE_URL!==DB_URL||
    !numeric(process.env.GITHUB_RUN_ID)||
    !numeric(process.env.GITHUB_RUN_ATTEMPT)||
    process.env.USER!=='runner'||
    process.getuid?.()===0||
    !process.env.GITHUB_WORKSPACE?.startsWith('/home/runner/work/')||
    resolve(process.cwd())!==resolve(process.env.GITHUB_WORKSPACE)||
    process.argv.length!==3||
    !['begin','inspect',...PHASES].includes(process.argv[2])){
    fail('ci_firstboot_evidence_requires_hosted_disposable_runner');
  }
}
function testPaths() {
  const workspace=resolve(process.env.GITHUB_WORKSPACE);
  const staging=resolve(process.env.DOMYRO_CI_STAGING_BASE??'');
  const journal=resolve(process.env.DOMYRO_CI_FIRSTBOOT_JOURNAL_DIR??'');
  if(!staging.startsWith(workspace+sep+'.domyro-ci-signed-')||
     !/\/\.domyro-ci-signed-[A-Za-z0-9]{6}$/.test(staging)||
     !journal.startsWith(resolve(tmpdir())+sep+'domyro-firstboot-test-')||
     !/\/domyro-firstboot-test-[A-Za-z0-9]{6}$/.test(journal)) {
    fail('ci_firstboot_evidence_paths_not_disposable');
  }
  return {staging,journal};
}
async function verifyPrivate(path) {
  const info=await lstat(path);
  if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0||
     info.uid!==process.getuid()||await realpath(path)!==path) {
    fail('ci_firstboot_evidence_directory_untrusted');
  }
}
async function proof(staging) {
  const file=join(staging,'ci-signed-admission.json');
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||
     (info.mode&0o077)!==0||info.uid!==process.getuid()||
     info.size<10||info.size>1024)fail('ci_firstboot_unsigned_admission_proof');
  const record=JSON.parse(await readFile(file,'utf8'));
  if(record?.verified!==true||record?.gate!=='D-53'||
     record.version!=='0.1.1'||
     !/^[a-f0-9]{64}$/.test(record.publisherKeySha256??'')||
     !/^[a-f0-9]{64}$/.test(record.manifestSha256??'')||
     !['amd64','arm64'].includes(record.architecture)) {
    fail('ci_firstboot_admission_proof_invalid');
  }
  const bytes=await readFile(join(staging,'offline-signed-package','release-manifest.json'));
  if(createHash('sha256').update(bytes).digest('hex')!==record.manifestSha256){
    fail('ci_firstboot_admitted_manifest_changed');
  }
  return record;
}
async function withDb(callback){
  const id=process.env.GITHUB_RUN_ID, attempt=process.env.GITHUB_RUN_ATTEMPT;
  const database='domyro_native_'+id+'_'+attempt;
  const url=new URL(DB_URL);
  url.pathname='/'+database;
  const pool=new Pool({connectionString:url.href,max:1,connectionTimeoutMillis:5000});
  try {return await callback(pool);} finally {await pool.end();}
}
async function assertOwner(){
  await withDb(async db=>{
    const r=await db.query(
      'SELECT (SELECT count(*)::int FROM domyro_users) AS users, '+
      '(SELECT count(*)::int FROM domyro_sites) AS sites');
    if(r.rows[0].users!==1||r.rows[0].sites!==1)fail('ci_firstboot_owner_data_not_verified');
  });
}
async function assertRuntimeRole(){
  const id=process.env.GITHUB_RUN_ID, attempt=process.env.GITHUB_RUN_ATTEMPT;
  const role='domyro_app_'+id+'_'+attempt;
  const db=new Pool({connectionString:DB_URL,max:1,connectionTimeoutMillis:5000});
  try{
    const r=await db.query(
      'SELECT rolcanlogin,rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=$1',[role]);
    const roleInfo=r.rows[0];
    if(!roleInfo||roleInfo.rolsuper||roleInfo.rolcreaterole||roleInfo.rolcreatedb||
       !roleInfo.rolcanlogin)fail('ci_firstboot_runtime_role_not_restricted');
  }finally{await db.end();}
  await withDb(async db=>{
    const r=await db.query(
      "SELECT has_schema_privilege($1, 'public','CREATE') AS allowed",[role]);
    if(r.rows[0]?.allowed!==false)fail('ci_firstboot_runtime_ddl_allowed');
  });
}
function assertSystemd(){
  const suffix=process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT;
  const unit='domyro-ci-native-'+suffix+'.service';
  try {
    execFileSync('/usr/bin/systemctl',['is-active','--quiet',unit],
      {timeout:5000,stdio:'ignore',env:{PATH:'/usr/bin:/bin'}});
    const user=execFileSync('/usr/bin/systemctl',['show','--value','-p','User',unit],
      {timeout:5000,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}}).trim();
    if(user!=='domyroci'+process.env.GITHUB_RUN_ID)fail('ci_firstboot_wrong_service_account');
  } catch { fail('ci_firstboot_native_service_not_verified'); }
}
async function assertLive(){
  const port=Number(process.env.DOMYRO_CI_TARGET_PORT);
  if(!Number.isSafeInteger(port)||port<1024||port>65535)fail('ci_firstboot_port_invalid');
  const response=await fetch('http://127.0.0.1:'+port+'/api/v1/health/live',
    {redirect:'error',signal:AbortSignal.timeout(5000)});
  if(response.status!==200||(await response.json()).status!=='alive'){
    fail('ci_firstboot_http_liveness_unverified');
  }
}

async function validateConfigRestoreReceipt(staging) {
  const p=join(staging,'ci-native-config-restore-proof.json');
  const st=await lstat(p);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
     (st.mode&0o077)!==0||st.uid!==process.getuid()||
     st.size<40||st.size>2048)
    fail('ci_native_config_restore_receipt_unsafe');
  const record=JSON.parse(await readFile(p,'utf8'));
  if(record?.kind!=='domyro-ci-config-scratch-restore'||
    record?.gate!=='D-53'||record?.verified!==true||
    !record.files||
    Object.keys(record.files).sort().join(',')!=='native-runtime.env,native-unit.service'||
    Object.values(record.files).some(x=>!/^[a-f0-9]{64}$/.test(x)))
    fail('ci_native_config_restore_receipt_invalid');
  for(const name of ['native-runtime.env','native-unit.service']){
    const file=await lstat(join(staging,name));
    if(!file.isFile()||file.isSymbolicLink()||(file.mode&0o077)!==0)
      fail('ci_native_config_original_untrusted');
    const got=createHash('sha256').update(await readFile(join(staging,name))).digest('hex');
    if(got!==record.files[name])fail('ci_native_config_original_changed');
  }
  const encrypted=await lstat(join(staging,'native-config.domyrobackup'));
  if(!encrypted.isFile()||encrypted.isSymbolicLink()||
     (encrypted.mode&0o077)!==0||encrypted.size<100)
    fail('ci_native_config_ciphertext_missing');
}

async function validateRestoreReceipt(staging) {
  const p=join(staging,'ci-native-restored-backup.json');
  const st=await lstat(p);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||(st.mode&0o077)!==0||
     st.uid!==process.getuid()||st.size<40||st.size>4096)
    fail('ci_firstboot_backup_receipt_unsafe');
  const value=JSON.parse(await readFile(p,'utf8'));
  if(value?.kind!=='domyro-ci-native-scratch-restore'||
     value?.verified!==true||value?.gate!=='D-53'||
     !/^[a-f0-9]{64}$/.test(value?.sourceSha256??'')||
     !/^[a-f0-9]{64}$/.test(value?.backupArchiveSha256??'')||
     value?.counts?.users!==1||value?.counts?.sites!==1||
     value?.counts?.memberships!==1||
     !Number.isInteger(value?.counts?.areas)||value.counts.areas<1)
    fail('ci_firstboot_backup_receipt_invalid');
  const backup=await lstat(join(staging,'native-firstboot.domyrobackup'));
  if(!backup.isFile()||backup.isSymbolicLink()||
     (backup.mode&0o077)!==0||backup.size<100)
    fail('ci_firstboot_backup_file_missing_or_unsafe');
}
async function validatePhase(next,staging){
  const root=join(staging,'release-store','releases','0.1.1');
  switch(next){
    case 'signed_source_verified':
      if(!(await lstat(join(root,'src','server.mjs'))).isFile())fail('ci_firstboot_missing_signed_source');
      await proof(staging);
      break;
    case 'locked_dependencies_prepared':
      if(!(await lstat(join(root,'node_modules','pg','package.json'))).isFile())
        fail('ci_firstboot_dependencies_not_present');
      break;
    case 'database_owner_bootstrapped': await assertOwner(); break;
    case 'restricted_runtime_verified': await assertOwner();await assertRuntimeRole();break;
    case 'native_service_started': await assertRuntimeRole();assertSystemd();await assertLive();break;
    case 'http_login_and_persistence_verified': assertSystemd();await assertLive();await assertOwner();break;
    case 'postgres_scratch_restore_verified':
      assertSystemd();await assertLive();await assertOwner();
      await validateRestoreReceipt(staging);
      break;
    case 'config_scratch_restore_verified':
      assertSystemd();await assertLive();await assertOwner();
      await validateRestoreReceipt(staging);await validateConfigRestoreReceipt(staging);
      break;
    case 'test_completed':
      assertSystemd();await assertLive();await assertOwner();await assertRuntimeRole();
      await validateRestoreReceipt(staging);await validateConfigRestoreReceipt(staging);
      break;
    default: fail('ci_firstboot_phase_invalid');
  }
}
async function main(){
  guard();
  const {staging,journal}=testPaths();
  await Promise.all([verifyPrivate(staging),verifyPrivate(journal)]);
  const phase=process.argv[2];
  if(phase==='inspect'){
    const status=await inspectFirstBootIntent({directory:journal});
    if(!status)fail('ci_firstboot_intent_missing');
    process.stdout.write(JSON.stringify(status)+'\n');
    return;
  }
  if(phase==='begin'){
    const signed=await proof(staging);
    const current=await createFirstBootIntent({
      directory:journal,releaseVersion:signed.version,
      manifestSha256:signed.manifestSha256,
      publisherKeySha256:signed.publisherKeySha256,
    });
    process.stdout.write(current.phase+'\n');
    return;
  }
  await validatePhase(phase,staging);
  const status=await inspectFirstBootIntent({directory:journal});
  if(!status||status.nextPhase!==phase)fail('ci_firstboot_phase_not_next');
  const value=await advanceFirstBootIntent({
    directory:journal,expectedPhase:status.phase,nextPhase:phase,
  });
  process.stdout.write(value.phase+'\n');
}
main().catch(error=>{process.stderr.write('CI firstboot evidence refused: '+error.message+'\n');process.exitCode=1;});
