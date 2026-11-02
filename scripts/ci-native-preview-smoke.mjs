#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// CI ONLY, disposable GitHub-hosted Ubuntu 24.04 native PostgreSQL + systemd.
// Docker/containerization is expressly NOT used in the native preview.
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

if(process.env.GITHUB_ACTIONS!=='true'||
   process.env.RUNNER_ENVIRONMENT!=='github-hosted'||
   process.env.RUNNER_OS!=='Linux'||
   !process.env.GITHUB_WORKSPACE?.startsWith('/home/runner/work/')||
   resolve(process.cwd())!==resolve(process.env.GITHUB_WORKSPACE)||
   process.getuid?.()===0||process.env.DOMYRO_CI_NATIVE_PREVIEW!=='1'){
  throw Error('ci_native_preview_disposable_github_host_required');
}
const UNIT='domyro-preview-native',DATABASE='domyro_preview_native';
const CONFDIR='/etc/domyro-preview-native',INSTALL='/opt/domyro-preview-native';
const TIMEOUT=30000,BASE='http://127.0.0.1:8844';
const run=(file,args,timeout=TIMEOUT)=>{
  const r=spawnSync(file,args,{cwd:process.cwd(),timeout,encoding:'utf8',
    env:{...process.env,DOCKER_HOST:undefined,DOCKER_CONTEXT:undefined}});
  if(r.status!==0)throw Error('ci_native_preview_command_failed: '+file+
    ' '+args[0]+' (exit '+r.status+')');
  return r.stdout.trim();
};
const sudo=(...args)=>run('sudo',args);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(path,options={}){
  // Restarting a real native systemd process invalidates old HTTP keep-alives.
  // Retry only transport disconnects; never hide an actual HTTP error.
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(BASE+path,{...options,signal:AbortSignal.timeout(5000)});
      let body={};try{body=await response.json();}catch{}
      return {status:response.status,body,cookie:response.headers.get('set-cookie')};
    }catch(error){
      if(attempt===2)throw error;
      await sleep(150);
    }
  }
}
async function wait(){
  for(let i=0;i<40;i++){
    try{if((await request('/api/v1/health/live')).status===200)return;}catch{}
    await sleep(500);
  }
  throw Error('ci_native_preview_server_unreachable');
}
const post=(path,body,cookie,csrf,method='POST')=>request(path,{
  method,headers:{
    origin:BASE,'content-type':'application/json',
    ...(cookie?{cookie}:{}),...(csrf?{'x-domyro-csrf':csrf}:{}),
  },body:JSON.stringify(body),
});
function checkCoreGate(status){
  if(status.status!==200||status.body.installationGate!=='D-53'||
     status.body.installAllowed!==false)
    throw Error('ci_native_preview_production_gate_violated');
}
async function testNative(){
  const script=await readFile('scripts/native-preview-install.sh','utf8');
  if(/(?:^|\s)(?:docker|podman)\s+(?:run|compose|build|pull|create)/m.test(script))
    throw Error('ci_native_preview_contains_container_invocation');
  // Refuse existing locations ahead of changes. The first install can
  // exclusively create these exact paths and dedicated DB/roles.
  run('bash',['-n','scripts/native-preview-install.sh']);
  const output=sudo('bash','scripts/native-preview-install.sh','--install-native-preview');
  if(!output.includes('READY: native localhost portal'))
    throw Error('ci_native_preview_installer_not_ready');
  await wait();
  const status=await request('/api/v1/public/status');
  if(status.status!==200||status.body.productionReady!==false)
    throw Error('ci_native_preview_status_incorrect');
  if((await request('/api/v1/sites')).status!==401)
    throw Error('ci_native_preview_private_data_exposed');
  if(sudo('systemctl','is-enabled',UNIT+'.service')!=='enabled'||
     sudo('systemctl','is-active',UNIT+'.service')!=='active')
    throw Error('ci_native_preview_systemd_not_enabled');
  if(sudo('systemctl','show','--value','-p','User',UNIT+'.service')!==UNIT||
     sudo('systemctl','show','--value','-p','ProtectSystem',UNIT+'.service')!=='strict'||
     sudo('systemctl','show','--value','-p','NoNewPrivileges',UNIT+'.service')!=='yes')
    throw Error('ci_native_preview_systemd_not_hardened');
  if(sudo('stat','-c','%a',CONFDIR+'/runtime.env')!=='600'||
     sudo('stat','-c','%a',CONFDIR+'/owner-password.txt')!=='600'||
     sudo('stat','-c','%U',INSTALL+'/src/server.mjs')!=='root')
    throw Error('ci_native_preview_permissions');
  const port=sudo('ss','-ltn');
  if(!port.split('\n').some(line=>line.includes('127.0.0.1:8844'))||
     port.split('\n').some(line=>/(?:0\.0\.0\.0|\[::\]):8844\b/.test(line)))
    throw Error('ci_native_preview_listener_not_loopback');
  const password=sudo('cat',CONFDIR+'/owner-password.txt').trim();
  if(password.length<40)throw Error('ci_native_preview_weak_owner_password');
  const login=await post('/api/v1/auth/login',{
    login:'native_preview_owner',password,
  });
  if(login.status!==200||!login.cookie?.includes('HttpOnly')||
     !login.body.csrfToken)throw Error('ci_native_preview_login_failed');
  const cookie=login.cookie.split(';')[0],csrf=login.body.csrfToken;
  const home=await post('/api/v1/sites',{displayName:'Server Design'},cookie,csrf);
  if(home.status!==201)throw Error('ci_native_preview_site_failed');
  const id=home.body.site.id;
  const room=await post('/api/v1/sites/'+id+'/areas',{
    displayName:'Woonkamer',
  },cookie,csrf);
  if(room.status!==201)throw Error('ci_native_preview_room_failed');
  const denied=await post('/api/v1/sites/'+id,{
    displayName:'Unauthorized',
  },cookie,null,'PATCH');
  if(denied.status!==403)throw Error('ci_native_preview_csrf_bypass');
  const renamed=await post('/api/v1/sites/'+id,{
    displayName:'Ontwerplab',
  },cookie,csrf,'PATCH');
  if(renamed.status!==200)throw Error('ci_native_preview_site_rename_failed');
  checkCoreGate(await request('/api/v1/system/updates',{headers:{cookie}}));
  const firstRoomId=room.body.area.id;
  // Restart real native systemd; database must still hold created site and room.
  sudo('systemctl','restart',UNIT+'.service');
  await wait();
  const after=await request('/api/v1/sites/'+id+'/areas',{headers:{cookie}});
  if(after.status!==200||after.body.areas?.[0]?.id!==firstRoomId)
    throw Error('ci_native_preview_post_restart_data_missing');
  const html=await fetch(BASE+'/');
  if(html.status!==200||!(await html.text()).includes('id="homes-list"'))
    throw Error('ci_native_preview_dashboard_missing');
  await verifySecondInstallDenied();
  // Manually update the NATIVE preview from the checked-out source.
  // No Docker, no PostgreSQL migrations, and no owner data deletion.
  const updated=sudo('bash','scripts/native-preview-refresh.sh','--refresh-native-preview');
  if(!updated.includes('UPDATED: native preview running'))
    throw Error('ci_native_preview_refresh_failed');
  await wait();
  const retained=await request('/api/v1/sites/'+id+'/areas',{headers:{cookie}});
  if(retained.status!==200||retained.body.areas?.[0]?.id!==firstRoomId)
    throw Error('ci_native_preview_refresh_lost_persisted_rooms');
  if(!sudo('ls','-A','/opt/domyro-preview-native-history'))
    throw Error('ci_native_preview_missing_prior_release');
  // Kill the real native update shell AFTER it archived old code but BEFORE
  // it activated the new code. The durable journal must survive SIGKILL.
  const interrupted=spawnSync('sudo',[
    'env','GITHUB_ACTIONS=true','RUNNER_ENVIRONMENT=github-hosted',
    'RUNNER_OS=Linux','DOMYRO_CI_NATIVE_PREVIEW=1',
    'GITHUB_WORKSPACE='+process.env.GITHUB_WORKSPACE,
    'DOMYRO_CI_NATIVE_REFRESH_FAULT=after-old-moved',
    'bash','scripts/native-preview-refresh.sh','--refresh-native-preview',
  ],{cwd:process.cwd(),encoding:'utf8',timeout:30000});
  if(interrupted.status===0 ||
     !/Simulating CI SIGKILL after previous release archived/.test(interrupted.stdout))
    throw Error('ci_native_refresh_sigkill_not_triggered:'+interrupted.status);
  const journal='/opt/domyro-preview-native-history/.pending-refresh';
  const token=sudo('cat',journal).trim();
  if(!/^[0-9]{8}T[0-9]{6}Z-[0-9]{1,12}$/.test(token))
    throw Error('ci_native_refresh_durable_journal_invalid');
  if(sudo('stat','-c','%a',journal)!=='600'||
     sudo('stat','-c','%U',journal)!=='root')
    throw Error('ci_native_refresh_journal_not_private');
  const oldDir='/opt/domyro-preview-native-history/'+token;
  if(sudo('test','-f',oldDir+'/src/server.mjs')!=='' ||
     sudo('test','-f',oldDir+'/scripts/migrate-db.mjs')!=='')
    throw Error('ci_native_refresh_old_code_not_preserved');
  // Retrying the update MUST refuse the existing interrupted journal/service.
  const refused=spawnSync('sudo',[
    'bash','scripts/native-preview-refresh.sh','--refresh-native-preview',
  ],{cwd:process.cwd(),encoding:'utf8',timeout:15000});
  if(refused.status===0)
    throw Error('ci_native_refresh_repeated_over_interrupted_transaction');
  const recovered=sudo('bash','scripts/native-preview-recover.sh',
    '--recover-native-preview');
  if(!recovered.includes('previous release active'))
    throw Error('ci_native_refresh_explicit_recovery_failed');
  await wait();
  const preserved=await request('/api/v1/sites/'+id+'/areas',{headers:{cookie}});
  if(preserved.status!==200||preserved.body.areas?.[0]?.id!==firstRoomId)
    throw Error('ci_native_refresh_sigkill_lost_site_room_data');
  if((await request('/api/v1/system/updates',{headers:{cookie}})).body.installAllowed!==false)
    throw Error('ci_native_refresh_recovery_opened_production_gate');
  // Recovery cannot replay a completed journal or replace healthy files.
  const replay=spawnSync('sudo',[
    'bash','scripts/native-preview-recover.sh','--recover-native-preview',
  ],{cwd:process.cwd(),encoding:'utf8',timeout:15000});
  if(replay.status!==86||!/no safely recorded interrupted refresh/.test(replay.stderr))
    throw Error('ci_native_refresh_recovery_replay_not_refused');
  const again=sudo('bash','scripts/native-preview-refresh.sh',
    '--refresh-native-preview');
  if(!again.includes('UPDATED: native preview running'))
    throw Error('ci_native_refresh_second_update_failed');
  await wait();
  const afterRecover=await request('/api/v1/sites/'+id+'/areas',{headers:{cookie}});
  if(afterRecover.status!==200||afterRecover.body.areas?.[0]?.id!==firstRoomId)
    throw Error('ci_native_refresh_recovery_followup_lost_data');
}
async function verifySecondInstallDenied(){
  const r=spawnSync('sudo',['bash','scripts/native-preview-install.sh','--install-native-preview'],{
    encoding:'utf8',timeout:20000,
  });
  if(r.status!==86||!/existing installation files/.test(r.stderr))
    throw Error('ci_native_preview_second_install_not_denied');
}
async function cleanup(){
  // Only CI exact named resources. This is never run on user machines.
  const best=(f,args)=>{spawnSync(f,args,{encoding:'utf8',timeout:30000});};
  best('sudo',['systemctl','disable','--now',UNIT+'.service']);
  best('sudo',['rm','-f','/etc/systemd/system/'+UNIT+'.service']);
  best('sudo',['systemctl','daemon-reload']);
  best('sudo',['userdel',UNIT]);
  for(const location of [CONFDIR,INSTALL,'/opt/domyro-preview-native-history','/run/domyro-preview-native'])
    best('sudo',['rm','-rf','--',location]);
  best('sudo',['runuser','-u','postgres','--','psql','-X','-q',
    '-v','ON_ERROR_STOP=1','-d','postgres','-c','DROP DATABASE IF EXISTS domyro_preview_native WITH (FORCE)']);
  for(const role of ['domyro_preview_native_app','domyro_preview_native_migrator'])
    best('sudo',['runuser','-u','postgres','--','psql','-X','-q','-d','postgres',
      '-c','DROP ROLE IF EXISTS '+role]);
}
try{
  // Missing or owned dirs should only fail; no Docker images or containers.
  await testNative();
  process.stdout.write('Native Ubuntu systemd + host PostgreSQL + localhost authenticated portal + persistence VERIFIED. No Docker.\n');
}finally{await cleanup();}
