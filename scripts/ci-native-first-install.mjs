#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Real host first-install proof with ephemeral authority on disposable CI only.
import {readFile,writeFile,mkdir,cp,rm,lstat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {buildSignedSourceRelease,writeSignedRelease} from '../tools/build-release.mjs';

const e=process.env;
if(process.getuid?.()!==0||e.GITHUB_ACTIONS!=='true'||e.RUNNER_ENVIRONMENT!=='github-hosted'||
   e.DOMYRO_CI_FIRST_INSTALL!=='1'||!e.GITHUB_WORKSPACE?.startsWith('/home/runner/work/')||
   resolve(process.cwd())!==resolve(e.GITHUB_WORKSPACE))throw Error('disposable_first_install_ci_only');
const tmp='/var/tmp/domyro-ci-first-install';
const assert=(value,message)=>{if(!value)throw Error(message);};
const run=(file,args)=>{
  const r=spawnSync(file,args,{encoding:'utf8',timeout:300000});
  if(r.status!==0)throw Error('first_install_ci_command_failed:'+file);
  return r.stdout.trim();
};
const pg=sql=>run('runuser',['-u','postgres','--','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d','postgres','-c',sql]);
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const resources=['/opt/domyro','/etc/domyro','/etc/domyro-updater','/usr/lib/domyro-updater',
  '/var/lib/domyro-updater','/var/lib/domyro-first-install','/run/domyro-updater'];
// Refuse any resources predating this disposable proof, including dangling links.
for(const path of resources)try{await lstat(path);throw Error('existing_first_install_resource');}catch(err){if(err.code!=='ENOENT')throw err;}
assert(pg("SELECT count(*) FROM pg_database WHERE datname='domyro'")==='0','existing_database');
assert(pg("SELECT count(*) FROM pg_roles WHERE rolname IN ('domyro_app','domyro_migrator')")==='0','existing_roles');
assert(spawnSync('getent',['passwd','domyro']).status===2,'existing_account');
await mkdir(tmp,{mode:0o700});
const pair=generateKeyPairSync('ed25519');
const policy={schemaVersion:1,configured:true,releaseSource:'github.com/TheRoyalCaptain/Domyro/releases',
  publicKeyPem:pair.publicKey.export({type:'spki',format:'pem'}),
  publisherFingerprintSha256:createHash('sha256').update(pair.publicKey.export({type:'spki',format:'der'})).digest('hex')};
const originalGate=JSON.parse(await readFile('config/installation-readiness.json','utf8'));
const readiness={...originalGate,checks:Object.fromEntries(Object.keys(originalGate.checks).map(k=>[k,true])),
  readyForOwnerInstallation:true,ownerDeploymentConsentRecorded:true};
await writeFile(tmp+'/publisher.json',JSON.stringify(policy),{mode:0o600});
await writeFile(tmp+'/readiness.json',JSON.stringify(readiness),{mode:0o600});
async function build(directory,projectRoot,version='0.1.1') {
  const signed=await buildSignedSourceRelease({projectRoot,version,channel:'stable',
    publishedAt:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),privateKeyPem:pair.privateKey.export({type:'pkcs8',format:'pem'})});
  await writeSignedRelease(directory,signed);
}
function install(directory) {
  return spawnSync(process.execPath,['scripts/install-native-source.mjs','--install','--directory='+directory,
    '--publisher-policy='+tmp+'/publisher.json','--readiness='+tmp+'/readiness.json'],{
    encoding:'utf8',timeout:300000,env:process.env});
}
async function cleanup() {
  const best=(f,args)=>spawnSync(f,args,{stdio:'ignore',timeout:30000});
  for(const unit of ['domyro-updater','domyro']) {
    best('systemctl',['disable','--now',unit+'.service']);
    await rm('/etc/systemd/system/'+unit+'.service',{force:true});
  }
  best('systemctl',['daemon-reload']);
  best('runuser',['-u','postgres','--','psql','-X','-q','-d','postgres','-c','DROP DATABASE IF EXISTS domyro WITH (FORCE)']);
  for(const role of ['domyro_app','domyro_migrator'])best('runuser',['-u','postgres','--','psql','-X','-q','-d','postgres','-c','DROP ROLE IF EXISTS '+role]);
  best('userdel',['domyro']);
  for(const path of resources)await rm(path,{recursive:true,force:true});
}
const base='http://127.0.0.1:8844';
async function api(path,{body,cookie,csrf}={}) {
  const r=await fetch(base+'/api/v1/'+path,{method:body?'POST':'GET',signal:AbortSignal.timeout(5000),
    headers:{origin:base,'content-type':'application/json',connection:'close',...(cookie?{cookie}:{}),...(csrf?{'x-domyro-csrf':csrf}:{})},
    body:body?JSON.stringify(body):undefined});
  return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
try {
  await build(tmp+'/good',process.cwd());
  const installed=install(tmp+'/good');
  assert(installed.status===0,'first_install_failed: '+(installed.stderr??'').slice(-2000)+' '+(installed.stdout??'').slice(-1000));
  assert((await readFile('/var/lib/domyro-first-install/phase','utf8')).trim()==='installed','first_install_phase_missing');
  const password=(await readFile('/etc/domyro/owner-password.txt','utf8')).trim();
  const login=await api('auth/login',{body:{login:'owner',password}});
  assert(login.status===200,'first_install_login_failed');
  const auth={cookie:login.cookie,csrf:login.body.csrfToken};
  const site=(await api('sites',auth)).body.sites[0].id;
  const room=await api('sites/'+site+'/areas',{...auth,body:{displayName:'Opgeslagen na installatie'}});
  assert(room.status===201,'first_install_room_failed');
  const updates=await api('system/updates',auth);
  assert(updates.status===200&&updates.body.workerAvailable===true&&updates.body.installAllowed===true,'first_install_updater_not_ready');
  const supervisor=run('systemctl',['show','--value','-p','MainPID','domyro-updater.service']);
  const before=await hash('/etc/domyro/runtime.env');
  assert(install(tmp+'/good').status!==0,'first_install_repeat_not_refused');
  assert(await hash('/etc/domyro/runtime.env')===before,'repeat_changed_credentials');
  run('systemctl',['restart','domyro.service']);
  let rooms;
  for(let n=0;n<40;n++){try{rooms=await api('sites/'+site+'/areas',auth);break;}catch{await new Promise(r=>setTimeout(r,250));}}
  assert(rooms?.body.areas?.some(x=>x.id===room.body.area.id),'first_install_restart_lost_room');
  assert(run('systemctl',['show','--value','-p','MainPID','domyro-updater.service'])===supervisor,'core_restart_stopped_supervisor');
  // Install a separately signed, preloaded release through the REAL portal,
  // Unix socket and root systemd worker. No alternate worker or mocked host.
  await mkdir('/var/lib/domyro-updater/offline',{mode:0o700});
  await build('/var/lib/domyro-updater/offline/0.1.2',process.cwd(),'0.1.2');
  const queued=await api('system/updates/install',{...auth,body:{version:'0.1.2'}});
  assert(queued.status===202,'first_install_portal_update_not_accepted');
  let updated=false;
  for(let n=0;n<120;n++) {
    await new Promise(r=>setTimeout(r,1000));
    try {
      const status=await api('system/updates',auth);
      if(status.status!==200)continue;
      assert(!status.body.lastError&&!status.body.recoveryRequired,'first_install_portal_update_failed');
      if(status.body.job?.phase==='committed'&&status.body.currentVersion==='0.1.2'&&!status.body.busy) {updated=true;break;}
    }catch(error){if(error.message==='first_install_portal_update_failed')throw error;}
  }
  assert(updated,'first_install_portal_update_did_not_finish');
  assert((await api('sites/'+site+'/areas',auth)).body.areas.some(x=>x.id===room.body.area.id),'portal_update_lost_room');
  assert(run('systemctl',['show','--value','-p','MainPID','domyro-updater.service'])===supervisor,'portal_update_stopped_worker');
  console.log('Signed first install: native core, generated owner, PostgreSQL persistence and independent updater verified.');
  await cleanup();

  // Fault AFTER owner creation: keep credentials and initialized database.
  // A repeat request must refuse rather than deleting or reinitializing them.
  const source=tmp+'/broken-source';await mkdir(source,{mode:0o700});
  for(const item of ['src','scripts','web','package.json','package-lock.json'])await cp(item,join(source,item),{recursive:true});
  const installer=join(source,'scripts/native-core-install.sh');
  await writeFile(installer,(await readFile(installer,'utf8')).replace('phase installing_services','phase installing_services\nfalse # CI fault after owner initialization'));
  await build(tmp+'/broken',source);
  const failed=install(tmp+'/broken');assert(failed.status!==0,'fault_install_unexpected_success');
  assert(pg("SELECT count(*) FROM pg_database WHERE datname='domyro'")==='1','fault_install_lost_database');
  assert(run('runuser',['-u','postgres','--','psql','-X','-qAt','-d','domyro','-c',"SELECT count(*) FROM domyro_users WHERE login='owner'"])==='1','fault_install_lost_owner');
  const saved=await hash('/etc/domyro/runtime.env');
  assert(install(tmp+'/broken').status!==0,'fault_repeat_not_refused');
  assert(await hash('/etc/domyro/runtime.env')===saved,'fault_repeat_changed_credentials');
  console.log('Interrupted first install preserved owner/database/credentials; repeat refused. No official gate changed.');
}finally {await cleanup();await rm(tmp,{recursive:true,force:true});}
