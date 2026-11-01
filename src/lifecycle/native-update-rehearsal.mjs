// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Test-only integration of signed releases, real Node processes, explicit
 * version confirmation, health probing and pointer rollback.
 *
 * Uses only a disposable OS-created directory. No DB migration, systemd,
 * real backup, trusted production signing key, apt, or operator server access.
 */
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir,arch as osArch} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  stageVerifiedBundle,inspectActiveBundle,switchActiveBundle,inspectVerifiedStagedBundle,
} from './transactional-release.mjs';

const ARCH=Object.freeze({x64:'amd64',arm64:'arm64'});
const BOOT=[
  "const {createDomyroServer}=await import(process.env.DOMYRO_ENTRY);",
  "const server=createDomyroServer({persistence:null,auth:null});",
  "server.listen(0,'127.0.0.1',()=>{const a=server.address();",
  "process.send?.({type:'ready',address:a.address,port:a.port});});",
  "process.on('message',x=>{if(x==='stop')server.close(()=>process.exit(0));});",
  "process.on('disconnect',()=>server.close(()=>process.exit(0)));",
].join('\n');
async function start(release,sandbox) {
  const child=spawn(process.execPath,['--input-type=module','--eval',BOOT],{
    cwd:release,shell:false,
    env:{HOME:sandbox,PATH:process.env.PATH??'/usr/bin:/bin',NODE_ENV:'test',
      DOMYRO_ENTRY:pathToFileURL(join(release,'src/server.mjs')).href},
    stdio:['ignore','pipe','pipe','ipc'],
  });
  child.stdout.resume();child.stderr.resume();
  try {
    const message=await new Promise((resolve,reject)=>{
      let completed=false;
      const end=(error,result)=>{
        if(completed)return;completed=true;clearTimeout(timer);
        child.off('message',onMessage);child.off('error',onError);child.off('exit',onExit);
        if(error)reject(error);else resolve(result);
      };
      const onMessage=msg=>{
        if(msg?.type!=='ready')return;
        if(msg.address!=='127.0.0.1'||!Number.isSafeInteger(msg.port)||
           msg.port<=0||msg.port>65535)end(new Error('invalid_rehearsal_endpoint'));
        else end(null,msg);
      };
      const onError=()=>end(new Error('rehearsal_spawn_failed'));
      const onExit=()=>end(new Error('rehearsal_process_exited_before_ready'));
      const timer=setTimeout(()=>end(new Error('rehearsal_process_boot_timeout')),8000);
      child.on('message',onMessage);child.on('error',onError);child.on('exit',onExit);
    });
    return {child,port:message.port};
  } catch(error) {await stop(child);throw error;}
}
async function stop(child) {
  if(!child || child.exitCode!==null || child.signalCode!==null)return;
  await new Promise(resolve=>{
    let done=false;
    const finish=()=>{
      if(done)return;done=true;clearTimeout(timer);
      child.off('exit',finish);child.off('error',finish);resolve();
    };
    child.once('exit',finish);child.once('error',finish);
    const timer=setTimeout(()=>child.kill('SIGKILL'),3000);
    try{child.send('stop',err=>{if(err)child.kill('SIGTERM');});}
    catch{child.kill('SIGTERM');}
  });
}
async function healthy(running) {
  const base='http://127.0.0.1:'+running.port;
  const get=path=>fetch(base+path,{signal:AbortSignal.timeout(7000),redirect:'error'});
  const live=await get('/api/v1/health/live');
  const ready=await get('/api/v1/health/ready');
  const status=await get('/api/v1/public/status');
  const login=await get('/login');
  return live.status===200 && (await live.json()).status==='alive' &&
    ready.status===503 && (await ready.json()).status==='not_ready' &&
    status.status===200 && (await status.json()).productionReady===false &&
    login.status===200;
}
/**
 * candidateFailure is a test-only failure injection after actual new Node
 * process starts. Even a healthy candidate cannot override failed inspection.
 */
export async function rehearseManualUpdate({
  oldRelease,newRelease,trustedPublicKeyPem,arch=ARCH[osArch()],
  confirmedVersion,candidateFailure=false,
}={}){
  if(arch!==ARCH[osArch()])throw new Error('rehearsal_architecture_mismatch');
  if(typeof candidateFailure!=='boolean')throw new TypeError('invalid_failure_injection');
  const sandbox=await mkdtemp(join(tmpdir(),'domyro-real-update-test-'));
  let running=null;
  try{
    const root=join(sandbox,'release-root');
    for(const spec of [oldRelease,newRelease]){
      const {version}=await stageVerifiedBundle({...spec,root,arch,trustedPublicKeyPem});
      await inspectVerifiedStagedBundle({root,version,trustedPublicKeyPem,expectedArch:arch});
    }
    const oldVersion=(await inspectActiveBundle(root))??JSON.parse(Buffer.from(oldRelease.manifestBytes).toString()).version;
    const newVersion=JSON.parse(Buffer.from(newRelease.manifestBytes).toString()).version;
    if(confirmedVersion!==newVersion)throw new Error('explicit_version_confirmation_required');
    await switchActiveBundle({root,version:oldVersion,confirmedVersion:oldVersion,
      verifiedBackup:true,trustedPublicKeyPem,
      probe:async()=>{
        running=await start(join(root,'current'),sandbox);
        return healthy(running);
      }});
    if(!running || !await healthy(running))throw new Error('previous_version_not_healthy');
    await stop(running.child);running=null;
    let failed=false;
    try{
      await switchActiveBundle({root,version:newVersion,confirmedVersion,
        verifiedBackup:true,trustedPublicKeyPem,
        probe:async()=>{
          running=await start(join(root,'current'),sandbox);
          const live=await healthy(running);
          if(candidateFailure)throw new Error('injected_candidate_health_failure');
          return live;
        }});
    }catch(error){
      if(error.message!=='post_activation_health_failed_rolled_back_pointer')throw error;
      failed=true;
      if(running)await stop(running.child);
      running=null;
    }
    if(failed){
      if(await inspectActiveBundle(root)!==oldVersion)throw new Error('rollback_pointer_not_restored');
      await inspectVerifiedStagedBundle({root,version:oldVersion,trustedPublicKeyPem,expectedArch:arch});
      running=await start(join(root,'current'),sandbox);
      if(!await healthy(running))throw new Error('previous_version_recovery_failed');
    }else if(await inspectActiveBundle(root)!==newVersion){
      throw new Error('successful_update_pointer_missing');
    }
    return Object.freeze({
      state:failed?'rollback_and_old_process_recovered':'candidate_process_healthy',
      oldVersion,newVersion,activeVersion:await inspectActiveBundle(root),
      rolledBack:failed,previousProcessRecovered:failed,
      processRestarted:true,databaseMigrated:false,systemdActivated:false,
      realBackupTested:false,productionApproval:false,gate:'D-53',
    });
  }finally{
    if(running)await stop(running.child);
    await rm(sandbox,{recursive:true,force:true});
  }
}
