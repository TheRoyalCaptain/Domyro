#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CI-only encrypted actual native runtime+systemd configuration fixture.
 * Only private, explicitly copied files from a disposable hosted runner.
 * Never restore into /etc, /opt, systemd, or any installed service.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import {
  createEncryptedConfigFixture,
} from '../src/lifecycle/config-fixture-backup.mjs';
import {
  restoreConfigFixtureToScratch, inspectScratchConfigRestore,
} from '../src/lifecycle/config-fixture-restore.mjs';

const BASE='postgresql://domyro_test:ci-throwaway-test-only@127.0.0.1:5432/domyro_test';
const BACKUP_NAME='native-config.domyrobackup';
const FILES=Object.freeze(['native-runtime.env','native-unit.service']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function verifyEnv(){
  const e=process.env;
  if(e.GITHUB_ACTIONS!=='true'||e.RUNNER_ENVIRONMENT!=='github-hosted'||
     e.RUNNER_OS!=='Linux'||e.DOMYRO_CI_SYSTEMD_ALLOWED!=='1'||
     e.DOMYRO_CI_PG_ONBOARDING!=='1'||e.DOMYRO_CI_NATIVE_BACKUP!=='1'||
     e.DOMYRO_TEST_DATABASE_URL!==BASE||e.USER!=='runner'||process.getuid?.()===0||
     !/^[0-9]+$/.test(e.GITHUB_RUN_ID??'')||
     !/^[0-9]+$/.test(e.GITHUB_RUN_ATTEMPT??'')||
     !e.GITHUB_WORKSPACE?.startsWith('/home/runner/work/')||
     resolve(e.GITHUB_WORKSPACE)!==resolve(process.cwd())||
     process.argv.length!==3||!['create','verify'].includes(process.argv[2])){
    throw new Error('ci_native_config_requires_disposable_hosted_runner');
  }
  const stage=resolve(e.DOMYRO_CI_STAGING_BASE??'');
  if(!stage.startsWith(resolve(e.GITHUB_WORKSPACE)+sep+'.domyro-ci-signed-')||
     !/\/\.domyro-ci-signed-[A-Za-z0-9]{6}$/.test(stage)){
    throw new Error('ci_native_config_stage_not_allowed');
  }
  return {stage,id:e.GITHUB_RUN_ID,attempt:e.GITHUB_RUN_ATTEMPT};
}
async function privateDirectory(directory){
  const st=await lstat(directory);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0||
     st.uid!==process.getuid()||await realpath(directory)!==directory){
    throw new Error('ci_native_config_directory_unsafe');
  }
}
async function privateFile(path){
  const before=await lstat(path);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
     (before.mode&0o077)!==0||before.uid!==process.getuid()||
     before.size<8||before.size>512*1024){
    throw new Error('ci_native_config_file_unsafe');
  }
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const after=await fd.stat();
    if(after.ino!==before.ino||after.dev!==before.dev||after.size!==before.size)
      throw new Error('ci_native_config_file_changed');
    return await fd.readFile();
  }finally{await fd.close();}
}
async function passwordFrom(stage){
  const bytes=await privateFile(join(stage,'.ci-native-backup-password'));
  const value=bytes.toString('utf8');
  bytes.fill(0);
  if(!/^[a-zA-Z0-9_-]{40,100}$/.test(value))throw new Error('ci_native_config_backup_secret_invalid');
  return value;
}
async function original(stage){
  const rows={};
  for(const name of FILES)rows[name]=hash(await privateFile(join(stage,name)));
  return rows;
}
async function receipt(stage){
  const b=await privateFile(join(stage,'ci-native-config-restore-proof.json'));
  const data=JSON.parse(b.toString('utf8'));
  b.fill(0);
  if(data?.kind!=='domyro-ci-config-scratch-restore'||data?.gate!=='D-53'||
     data?.verified!==true||!data.files||
     Object.keys(data.files).sort().join(',')!==[...FILES].sort().join(',')||
     Object.values(data.files).some(x=>!/^[a-f0-9]{64}$/.test(x))){
    throw new Error('ci_native_config_receipt_invalid');
  }
  return data;
}
async function restoreOnce({stage,password,id,attempt,expected}){
  // This source folder and target are BOTH confined to the CI scratch space.
  const parent=join(stage,'ci-config-restore-parent');
  await mkdir(parent,{recursive:true,mode:0o700});
  await privateDirectory(parent);
  const targetName='domyro_restore_test_'+id+attempt;
  let created=false;
  try{
    const restored=await restoreConfigFixtureToScratch({
      backupDirectory:stage,backupName:BACKUP_NAME,password,
      scratchParent:parent,targetName,
    });
    created=true;
    if(!restored.scratchRestored||restored.productionRestoreApproved!==false||
       restored.fileCount!==2)throw new Error('ci_native_config_restore_incomplete');
    const checked=await inspectScratchConfigRestore({scratchParent:parent,targetName});
    if(!checked.scratchFilesMatchManifest||checked.fileCount!==2)
      throw new Error('ci_native_config_restore_not_verified');
    for(const name of FILES){
      const bytes=await privateFile(join(parent,targetName,'domyro_core',name));
      const actual=hash(bytes);
      bytes.fill(0);
      if(actual!==expected[name])throw new Error('ci_native_config_restored_hash_mismatch');
    }
    // Never allow an authenticated archive to replace an existing target,
    // even if all the bytes happen to be identical.
    await restoreConfigFixtureToScratch({
      backupDirectory:stage,backupName:BACKUP_NAME,password,
      scratchParent:parent,targetName,
    }).then(()=>{throw new Error('ci_native_config_allowed_repeated_restore');},
      e=>{if(e.code!=='EEXIST')throw e;});
  }finally {
    if(created)await rm(join(parent,targetName),{recursive:true,force:true});
  }
}
async function run(){
  const {stage,id,attempt}=verifyEnv();
  await privateDirectory(stage);
  const password=await passwordFrom(stage);
  const expected=await original(stage);
  if(process.argv[2]==='create'){
    const root=join(stage,'ci-config-original');
    await mkdir(root,{mode:0o700});
    for(const name of FILES){
      const bytes=await privateFile(join(stage,name));
      try{await writeFile(join(root,name),bytes,{flag:'wx',mode:0o600});}
      finally{bytes.fill(0);}
    }
    await createEncryptedConfigFixture({
      root,files:FILES.map(name=>({role:'domyro_core',name})),
      directory:stage,name:BACKUP_NAME,password,
    });
    // Prove failure on invalid password before scratch destination appears.
    const parent=join(stage,'ci-config-restore-parent');
    await mkdir(parent,{recursive:true,mode:0o700});
    await restoreConfigFixtureToScratch({
      backupDirectory:stage,backupName:BACKUP_NAME,
      password:'incorrect-disposable-ci-config-password',scratchParent:parent,
      targetName:'domyro_restore_test_'+id+attempt,
    }).then(()=>{throw new Error('ci_native_config_accepted_wrong_password');},
      e=>{if(e.message!=='backup_authentication_failed')throw e;});
    await restoreOnce({stage,password,id,attempt,expected});
    await writeFile(join(stage,'ci-native-config-restore-proof.json'),JSON.stringify({
      kind:'domyro-ci-config-scratch-restore',gate:'D-53',verified:true,files:expected,
    })+'\n',{flag:'wx',mode:0o600});
  } else {
    const previous=await receipt(stage);
    if(FILES.some(name=>expected[name]!==previous.files[name])){
      throw new Error('ci_native_config_original_changed_after_sigkill');
    }
    await restoreOnce({stage,password,id,attempt,expected:previous.files});
  }
  process.stdout.write('CI native config encrypted scratch restoration verified: '+process.argv[2]+'\n');
}
run().catch(e=>{
  // Credentials, configuration, and private source paths are never printed.
  process.stderr.write('CI native config restore refused: '+e.message+'\n');
  process.exitCode=1;
});
