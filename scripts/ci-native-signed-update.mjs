#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Disposable native Ubuntu CI only. Uses ephemeral publisher keys and never
// changes the project's installation-readiness record or official publisher.
import {readFile,writeFile,mkdir,chmod,cp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {buildSignedSourceRelease,writeSignedRelease} from '../tools/build-release.mjs';
import {createNativeUpdateJob} from '../src/lifecycle/native-update-job.mjs';
import {createNativeUpdateHost} from '../src/lifecycle/native-update-host.mjs';

if(process.getuid?.()!==0||process.env.GITHUB_ACTIONS!=='true'||
   process.env.RUNNER_ENVIRONMENT!=='github-hosted'||
   process.env.DOMYRO_CI_NATIVE_PREVIEW!=='1'||
   !process.env.GITHUB_WORKSPACE?.startsWith('/home/runner/work/')||
   resolve(process.cwd())!==resolve(process.env.GITHUB_WORKSPACE))throw Error('disposable_native_CI_only');
const work='/opt/domyro-native-update-proof';
const app='/opt/domyro-preview-native',config='/etc/domyro-preview-native';
const run=(cmd,args)=>{
  const r=spawnSync(cmd,args,{encoding:'utf8',timeout:300000});
  if(r.status!==0)throw Error('native_update_ci_command_failed:'+cmd);
  return r.stdout.trim();
};
const base='http://127.0.0.1:8844';
const assert=(value,message)=>{if(!value)throw Error(message);};
async function api(path,{cookie,csrf,body}={}) {
  const res=await fetch(base+'/api/v1/'+path,{method:body?'POST':'GET',
    headers:{origin:base,'content-type':'application/json',connection:'close',
      ...(cookie?{cookie}:{}),...(csrf?{'x-domyro-csrf':csrf}:{})},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});
  return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
await mkdir(work,{mode:0o711});await chmod(work,0o711);
await mkdir(join(work,'state'),{mode:0o700});
try {
  run('bash',['scripts/native-preview-install.sh','--install-native-preview']);
  const login=await api('auth/login',{body:{login:'native_preview_owner',
    password:(await readFile(join(config,'owner-password.txt'),'utf8')).trim()}});
  assert(login.status===200,'native_update_ci_login_failed');
  const auth={cookie:login.cookie,csrf:login.body.csrfToken};
  const sites=await api('sites',auth),site=sites.body.sites[0].id;
  const room=await api('sites/'+site+'/areas',{...auth,body:{displayName:'Blijft bewaard'}});
  assert(room.status===201,'native_update_ci_room_failed');
  const keys=generateKeyPairSync('ed25519');
  const policy={schemaVersion:1,configured:true,releaseSource:'github.com/TheRoyalCaptain/Domyro/releases',
    publicKeyPem:keys.publicKey.export({type:'spki',format:'pem'}),
    publisherFingerprintSha256:createHash('sha256').update(keys.publicKey.export({type:'spki',format:'der'})).digest('hex')};
  const source=join(work,'source');await mkdir(source,{mode:0o700});
  for(const item of ['src','scripts','web','package.json','package-lock.json'])await cp(item,join(source,item),{recursive:true});
  async function build(version,broken=false) {
    if(broken)await writeFile(join(source,'src/server.mjs'),'import {Pool as FailurePool} from \'pg\';\nconst failureDb=new FailurePool({connectionString:process.env.DOMYRO_DATABASE_URL});\nawait failureDb.query(\"UPDATE domyro_areas SET display_name=\'candidate-mutation\'\");\nawait failureDb.end();\nthrow Error("intentional CI candidate failure");\n'+await readFile(join(source,'src/server.mjs'),'utf8'));
    const signed=await buildSignedSourceRelease({projectRoot:source,version,channel:'stable',
      publishedAt:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),privateKeyPem:keys.privateKey.export({type:'pkcs8',format:'pem'})});
    const directory=join(work,'release-'+version);await writeSignedRelease(directory,signed);return directory;
  }
  const releases={'0.1.1':await build('0.1.1'),'0.1.2':await build('0.1.2',true)};
  const host=createNativeUpdateHost({app,config,work,unit:'domyro-preview-native',
    database:'domyro_preview_native',serviceUser:'domyro-preview-native',port:8844,policy,
    authorize:async()=>{}, // Ephemeral CI only; the real worker enforces D-53.
    download:async({version})=>({directory:releases[version]})});
  for(const [name,method] of Object.entries(host))host[name]=async(...args)=>{
    try{return await method(...args);}catch(e){throw Error('native_ci_phase_'+name,{cause:e});}
  };
  const job=await createNativeUpdateJob({root:join(work,'state'),host});
  await job.install('0.1.1');
  assert((await api('public/status')).body.version==='0.1.1','native_update_ci_wrong_version');
  assert((await api('sites/'+site+'/areas',auth)).body.areas.some(x=>x.id===room.body.area.id),'native_update_ci_lost_data');
  let rejected=false;
  try{await job.install('0.1.2');}catch(e){rejected=e.message==='update_health_failed';}
  assert(rejected,'native_update_ci_broken_candidate_not_recovered');
  assert((await job.status()).job.phase==='recovered','native_update_ci_recovery_incomplete');
  assert((await api('public/status')).body.version==='0.1.1','native_update_ci_previous_version_not_restored');
  assert((await api('sites/'+site+'/areas',auth)).body.areas.some(x=>x.id===room.body.area.id&&x.display_name==='Blijft bewaard'),'native_update_ci_restore_lost_room');
  console.log('Native signed update and failed-candidate PostgreSQL/config/code restore verified. Official production gate unchanged.');
}finally {
  const best=(cmd,args)=>spawnSync(cmd,args,{stdio:'ignore',timeout:30000});
  best('systemctl',['disable','--now','domyro-preview-native.service']);
  best('rm',['-f','/etc/systemd/system/domyro-preview-native.service']);
  best('systemctl',['daemon-reload']);
  best('runuser',['-u','postgres','--','psql','-X','-q','-d','postgres','-c','DROP DATABASE IF EXISTS domyro_preview_native WITH (FORCE)']);
  for(const role of ['domyro_preview_native_app','domyro_preview_native_migrator'])
    best('runuser',['-u','postgres','--','psql','-X','-q','-d','postgres','-c','DROP ROLE IF EXISTS '+role]);
  best('userdel',['domyro-preview-native']);
  for(const path of [app,config,work])await rm(path,{recursive:true,force:true});
}
