#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Disposable hosted CI ONLY: encrypted streaming backup of the real native
 * firstboot PostgreSQL database and independent scratch restore. Verification
 * may be re-run AFTER installer SIGKILL using the preserved private CI files.
 * NO production authorization, no restores into source/owner database.
 */
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { Pool } from 'pg';
import {
  dumpPostgresToStreamedBackup, restoreStreamedBackupToTestDatabase,
} from '../src/lifecycle/streamed-postgres-backup.mjs';

const BASE='postgresql://domyro_test:ci-throwaway-test-only@127.0.0.1:5432/domyro_test';
const NAME='native-firstboot.domyrobackup';
const TOOL=Object.freeze({
  dump:{executable:'docker',prefix:['run','--rm','--network=host','-i','-e','PGPASSWORD','postgres:17-alpine','pg_dump']},
  restore:{executable:'docker',prefix:['run','--rm','--network=host','-i','-e','PGPASSWORD','postgres:17-alpine','pg_restore']},
});
function guard() {
  const e=process.env;
  if(e.GITHUB_ACTIONS!=='true'||e.RUNNER_ENVIRONMENT!=='github-hosted'||
     e.RUNNER_OS!=='Linux'||e.DOMYRO_CI_SYSTEMD_ALLOWED!=='1'||
     e.DOMYRO_CI_PG_ONBOARDING!=='1'||e.DOMYRO_CI_NATIVE_BACKUP!=='1'||
     e.DOMYRO_TEST_DATABASE_URL!==BASE||e.USER!=='runner'||
     process.getuid?.()===0||!/^[0-9]+$/.test(e.GITHUB_RUN_ID??'')||
     !/^[0-9]+$/.test(e.GITHUB_RUN_ATTEMPT??'')||
     !e.GITHUB_WORKSPACE?.startsWith('/home/runner/work/')||
     resolve(process.cwd())!==resolve(e.GITHUB_WORKSPACE)||
     !['create','verify'].includes(process.argv[2])||process.argv.length!==3){
    throw new Error('ci_native_backup_requires_disposable_hosted_runner');
  }
  const stage=resolve(e.DOMYRO_CI_STAGING_BASE??'');
  if(!stage.startsWith(resolve(e.GITHUB_WORKSPACE)+sep+'.domyro-ci-signed-')||
     !/\/\.domyro-ci-signed-[A-Za-z0-9]{6}$/.test(stage)){
    throw new Error('ci_native_backup_private_stage_required');
  }
  return {stage,id:e.GITHUB_RUN_ID,attempt:e.GITHUB_RUN_ATTEMPT};
}
async function safeStage(directory) {
  const st=await lstat(directory);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0||
     st.uid!==process.getuid()||await realpath(directory)!==directory){
    throw new Error('ci_native_backup_stage_unsafe');
  }
}
const urlFor=name=>{const u=new URL(BASE);u.pathname='/'+name;return u.href;};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function rows(url) {
  const db=new Pool({connectionString:url,max:1,connectionTimeoutMillis:5000});
  try{
    const data={};
    for(const [key,sql] of [
      ['users','SELECT id, login, password_hash FROM domyro_users ORDER BY id'],
      ['sites','SELECT id, installation_id, display_name FROM domyro_sites ORDER BY id'],
      ['memberships','SELECT site_id, user_id, role FROM domyro_site_memberships ORDER BY site_id,user_id'],
      ['areas','SELECT id,site_id,display_name FROM domyro_areas ORDER BY id'],
    ])data[key]=(await db.query(sql)).rows;
    if(data.users.length!==1||data.sites.length!==1||
       data.memberships.length!==1||data.areas.length<1){
      throw new Error('ci_native_backup_expected_owner_site_room_missing');
    }
    return {counts:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])),
      sha256:digest(data)};
  }finally{await db.end();}
}
async function empty(url) {
  const db=new Pool({connectionString:url,max:1,connectionTimeoutMillis:5000});
  try {
    const q=await db.query("SELECT to_regclass('public.domyro_users') IS NULL AS empty");
    if(q.rows[0]?.empty!==true)throw new Error('ci_native_backup_target_modified_before_restore');
  }finally{await db.end();}
}
async function readPassword(stage) {
  const path=join(stage,'.ci-native-backup-password');
  const st=await lstat(path);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||(st.mode&0o077)!==0||
    st.uid!==process.getuid()||st.size<32||st.size>128){
    throw new Error('ci_native_backup_secret_file_unsafe');
  }
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const check=await fd.stat();
    if(check.ino!==st.ino||check.dev!==st.dev||check.size!==st.size)
      throw new Error('ci_native_backup_secret_changed');
    const secret=await fd.readFile('utf8');
    if(!/^[a-zA-Z0-9_-]{40,100}$/.test(secret))
      throw new Error('ci_native_backup_secret_invalid');
    return secret;
  }finally{await fd.close();}
}
async function readReceipt(stage) {
  const p=join(stage,'ci-native-restored-backup.json');
  const stat=await lstat(p);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
     (stat.mode&0o077)!==0||stat.size<40||stat.size>4096)
    throw new Error('ci_native_backup_receipt_unsafe');
  const record=JSON.parse(await readFile(p,'utf8'));
  if(record?.kind!=='domyro-ci-native-scratch-restore'||
     record?.gate!=='D-53'||record?.verified!==true||
     !/^[a-f0-9]{64}$/.test(record.sourceSha256??'')||
     !/^[a-f0-9]{64}$/.test(record.backupArchiveSha256??'')||
     !record.counts||record.counts.users!==1||
     record.counts.sites!==1||record.counts.memberships!==1||
     record.counts.areas<1)throw new Error('ci_native_backup_receipt_invalid');
  return record;
}
async function run() {
  const {stage,id,attempt}=guard();
  await safeStage(stage);
  const mode=process.argv[2];
  const sourceName='domyro_native_'+id+'_'+attempt;
  const restoreName='domyro_restore_test_'+id+'_'+attempt;
  const sourceUrl=urlFor(sourceName),targetUrl=urlFor(restoreName);
  const directory=stage;
  const existing=mode==='verify'?await readReceipt(stage):null;
  if(mode==='verify'){
    const before=await rows(sourceUrl);
    if(before.sha256!==existing.sourceSha256)
      throw new Error('ci_native_backup_live_source_changed_after_crash');
  }
  if(mode==='create'){
    const secret=randomBytes(48).toString('base64url');
    await writeFile(join(stage,'.ci-native-backup-password'),secret,{flag:'wx',mode:0o600});
    const before=await rows(sourceUrl);
    const snapshot=await dumpPostgresToStreamedBackup({
      sourceUrl,directory,name:NAME,password:secret,tools:TOOL,
      maxPlainBytes:64*1024*1024,
    });
    const admin=new Pool({connectionString:BASE,max:1});
    try{
      await admin.query('CREATE DATABASE "'+restoreName+'"');
    }finally{await admin.end();}
    try{
      // An invalid key MUST be rejected while the new target is still empty.
      await restoreStreamedBackupToTestDatabase({
        directory,name:NAME,password:'different-ci-secret-of-sufficient-length',
        targetUrl,tools:TOOL,
      }).then(()=>{throw new Error('ci_native_backup_accepted_wrong_password');},
        error=>{if(error.message!=='backup_authentication_failed')throw error;});
      await empty(targetUrl);
      const restored=await restoreStreamedBackupToTestDatabase({
        directory,name:NAME,password:secret,targetUrl,tools:TOOL,
        maxPlainBytes:64*1024*1024,
      });
      const after=await rows(targetUrl);
      if(after.sha256!==before.sha256||restored.archiveSha256!==snapshot.sha256||
         restored.schemaVersion!==3||restored.verifiedRestore!==true)
        throw new Error('ci_native_backup_restored_rows_mismatch');
      const report={
        kind:'domyro-ci-native-scratch-restore',gate:'D-53',verified:true,
        sourceSha256:before.sha256,backupArchiveSha256:snapshot.sha256,
        counts:before.counts,
      };
      await writeFile(join(stage,'ci-native-restored-backup.json'),JSON.stringify(report)+'\n',
        {flag:'wx',mode:0o600});
    }finally{
      const admin=new Pool({connectionString:BASE,max:1});
      try{await admin.query('DROP DATABASE IF EXISTS "'+restoreName+'" WITH (FORCE)');}
      finally{await admin.end();}
    }
  } else {
    const password=await readPassword(stage);
    // Recreate new empty scratch DB after the parent has SIGKILL'ed installer.
    const admin=new Pool({connectionString:BASE,max:1});
    try{await admin.query('CREATE DATABASE "'+restoreName+'"');}
    finally{await admin.end();}
    try{
      const restored=await restoreStreamedBackupToTestDatabase({
        directory,name:NAME,password,targetUrl,tools:TOOL,maxPlainBytes:64*1024*1024,
      });
      const after=await rows(targetUrl);
      if(!restored.verifiedRestore||restored.schemaVersion!==3||
        restored.archiveSha256!==existing.backupArchiveSha256||
        after.sha256!==existing.sourceSha256){
        throw new Error('ci_native_backup_sigkill_restore_mismatch');
      }
    }finally{
      const admin=new Pool({connectionString:BASE,max:1});
      try{await admin.query('DROP DATABASE IF EXISTS "'+restoreName+'" WITH (FORCE)');}
      finally{await admin.end();}
    }
  }
  process.stdout.write('CI native encrypted PostgreSQL snapshot restored and user/site/room hashes match: '+mode+'\n');
}
run().catch(error=>{
  // Do not print private data, PGPASSWORD or child tool output.
  process.stderr.write('CI native backup proof refused: '+error.message+'\n');
  process.exitCode=1;
});
