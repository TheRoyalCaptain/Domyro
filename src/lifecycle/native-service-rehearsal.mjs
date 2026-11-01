// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ISOLATED NON-PRIVILEGED SERVICE REHEARSAL.
 * Simulates /opt/domyro, /etc/systemd/system and /var/lib/domyro beneath an
 * OS-created private temporary directory. Starts the signed application in
 * a separate Node process. NEVER operates on the host systemd, apt, real
 * PostgreSQL, MQTT, Matter or the owner's server.
 */
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,lstat,readFile,writeFile,symlink,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,arch as hostArch} from 'node:os';
import {pathToFileURL} from 'node:url';
import {stageVerifiedBundle,inspectActiveBundle,inspectVerifiedStagedBundle} from './transactional-release.mjs';
import {renderNativeSystemdDraft} from './native-install-plan.mjs';

const ARCH=Object.freeze({x64:'amd64',arm64:'arm64'});
const TIMEOUT=10000;
const CHILD_BOOTSTRAP=[
  'const {createDomyroServer}=await import(process.env.DOMYRO_REHEARSAL_ENTRY);',
  'const server=createDomyroServer({persistence:null,auth:null});',
  "server.listen(0,'127.0.0.1',()=>{const a=server.address();",
  "process.send?.({type:'ready',port:a.port,pid:process.pid,address:a.address});});",
  "process.on('message',msg=>{if(msg==='stop')server.close(()=>process.exit(0));});",
  "process.on('disconnect',()=>server.close(()=>process.exit(0)));",
].join('\n');

async function privateDirectory(path){
  await mkdir(path,{recursive:true,mode:0o700});
  const s=await lstat(path);
  if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)||await realpath(path)!==path)throw new Error('rehearsal_directory_untrusted');
}
async function ensureExactFile(path,expected){
  try{
    await writeFile(path,expected,{flag:'wx',mode:0o600});
    return false;
  }catch(e){
    if(e.code!=='EEXIST')throw e;
    const s=await lstat(path);
    if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)||(await readFile(path,'utf8'))!==expected)throw new Error('rehearsal_existing_file_changed');
    return true;
  }
}
async function layoutSandbox(sandbox,root,version){
  const dirs=['opt','etc','etc/domyro','etc/systemd','etc/systemd/system',
    'var','var/lib','var/lib/domyro','var/log','var/log/domyro'];
  for(const name of dirs)await privateDirectory(join(sandbox,...name.split('/')));
  let reusedPointer=false;
  try{await symlink('releases/'+version,join(root,'current'));}
  catch(e){
    if(e.code!=='EEXIST')throw e;
    if(await inspectActiveBundle(root)!==version)throw new Error('rehearsal_existing_version_changed');
    reusedPointer=true;
  }
  const unit=renderNativeSystemdDraft({port:8844});
  const reusedUnit=await ensureExactFile(join(sandbox,'etc/systemd/system/domyro.service'),unit);
  return Object.freeze({reusedPointer,reusedUnit,unitWrittenAsDraft:true});
}
async function stopChild(child){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise(resolve=>{
    let done=false;
    const finish=()=>{
      if(done)return;done=true;clearTimeout(timer);
      child.off('exit',finish);child.off('error',finish);
      resolve();
    };
    child.once('exit',finish);child.once('error',finish);
    const timer=setTimeout(()=>child.kill('SIGKILL'),3000);
    try{child.send('stop',e=>{if(e)child.kill('SIGTERM');});}
    catch{child.kill('SIGTERM');}
  });
}
async function startChild(directory,sandbox){
  const entry=pathToFileURL(join(directory,'src/server.mjs')).href;
  const child=spawn(process.execPath,['--input-type=module','--eval',CHILD_BOOTSTRAP],{
    cwd:directory,shell:false,windowsHide:true,
    env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:sandbox,NODE_ENV:'test',
      DOMYRO_REHEARSAL_ENTRY:entry},
    stdio:['ignore','pipe','pipe','ipc'],
  });
  child.stdout.resume();child.stderr.resume();
  try{
    const ready=await new Promise((resolve,reject)=>{
      let done=false;
      const finish=(error,value)=>{
        if(done)return;done=true;clearTimeout(timer);
        child.off('message',onMessage);child.off('error',onError);child.off('exit',onExit);
        if(error)reject(error);else resolve(value);
      };
      const onMessage=msg=>{
        if(msg?.type!=='ready')return;
        if(msg.address!=='127.0.0.1'||!Number.isInteger(msg.port)||msg.port<1||
          msg.port>65535||msg.pid!==child.pid){
          finish(new Error('child_invalid_listen_report'));return;
        }
        finish(null,msg);
      };
      const onError=()=>finish(new Error('child_spawn_failed'));
      const onExit=()=>finish(new Error('child_exited_before_ready'));
      const timer=setTimeout(()=>finish(new Error('child_start_timeout')),TIMEOUT);
      child.on('message',onMessage);child.on('error',onError);child.on('exit',onExit);
    });
    return {child,ready};
  }catch(error){
    await stopChild(child);
    throw error;
  }
}
async function probe(port){
  const origin='http://127.0.0.1:'+port;
  const get=path=>fetch(origin+path,{signal:AbortSignal.timeout(TIMEOUT),redirect:'error'});
  const live=await get('/api/v1/health/live');
  if(live.status!==200||(await live.json()).status!=='alive')throw new Error('child_liveness_failed');
  const ready=await get('/api/v1/health/ready');
  if(ready.status!==503||(await ready.json()).status!=='not_ready')throw new Error('child_false_readiness');
  const status=await get('/api/v1/public/status');
  if(status.status!==200||(await status.json()).productionReady!==false)throw new Error('child_false_production_status');
  for(const path of ['/login','/assets/login.js','/assets/login.css']){
    const r=await get(path);
    if(r.status!==200)throw new Error('child_static_asset_missing');
  }
}
/** No caller-supplied target root; only an OS-created disposable sandbox. */
export async function rehearseNativeServiceLayout({
  manifestBytes,signatureBase64,trustedPublicKeyPem,artifactBytes,
  arch=ARCH[hostArch()],onPrepared=async()=>{},
}={}){
  if(arch!==ARCH[hostArch()])throw new Error('native_architecture_mismatch');
  if(typeof onPrepared!=='function')throw new TypeError('invalid_rehearsal_hook');
  const sandbox=await mkdtemp(join(tmpdir(),'domyro-native-service-test-'));
  let child=null;
  try{
    const root=join(sandbox,'opt/domyro');
    const staged=await stageVerifiedBundle({root,manifestBytes,signatureBase64,
      trustedPublicKeyPem,artifactBytes,arch});
    const firstLayout=await layoutSandbox(sandbox,root,staged.version);
    const repeat=await layoutSandbox(sandbox,root,staged.version);
    if(firstLayout.reusedPointer||firstLayout.reusedUnit||!repeat.reusedPointer||!repeat.reusedUnit)
      throw new Error('native_layout_not_idempotent');
    if(await inspectActiveBundle(root)!==staged.version)throw new Error('native_staged_release_not_active_in_sandbox');
    const directory=join(root,'current');
    await onPrepared({sandbox,release:directory,unitPath:join(sandbox,'etc/systemd/system/domyro.service')});
    const checked=await layoutSandbox(sandbox,root,staged.version);
    if(!checked.reusedPointer||!checked.reusedUnit)throw new Error('native_layout_changed_after_preflight');
    await inspectVerifiedStagedBundle({root,version:staged.version,trustedPublicKeyPem,expectedArch:arch});
    const first=await startChild(directory,sandbox);child=first.child;
    await probe(first.ready.port);
    const pid=first.ready.pid;
    await stopChild(child);child=null;
    await inspectVerifiedStagedBundle({root,version:staged.version,trustedPublicKeyPem,expectedArch:arch});
    const next=await startChild(directory,sandbox);child=next.child;
    if(next.ready.pid===pid)throw new Error('native_service_child_not_restarted');
    await probe(next.ready.port);
    return Object.freeze({
      result:'native_service_layout_rehearsal_passed',
      version:staged.version,arch,mode:'isolated_unprivileged_child_process',
      idempotentLayout:true,restartProbed:true,systemdUnitDraftWritten:true,
      systemdUnitActivated:false,hostModified:false,productionReady:false,
      nativeDependenciesInstalled:false,installationApproved:false,gate:'D-53',
    });
  }finally{
    if(child)await stopChild(child);
    await rm(sandbox,{recursive:true,force:true});
  }
}
