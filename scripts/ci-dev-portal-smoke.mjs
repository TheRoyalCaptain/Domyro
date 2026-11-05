#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Full opt-in disposable GitHub-hosted proof for locally runnable DOMYRO portal.
// New database and container must be unique and restricted to 127.0.0.1.
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile,lstat } from 'node:fs/promises';
import { join } from 'node:path';
const run=promisify(execFile);
if(process.env.GITHUB_ACTIONS!=='true'||process.env.RUNNER_ENVIRONMENT!=='github-hosted'||
   process.env.RUNNER_OS!=='Linux'||process.getuid?.()===0 ||
   !process.cwd().startsWith('/home/runner/work/')||
   process.env.DOMYRO_DATABASE_URL||process.env.DOCKER_HOST||
   process.env.DOCKER_CONTEXT){
  throw Error('ci_dev_portal_smoke_must_be_disposable_hosted_runner');
}
const root=process.cwd(),base='http://127.0.0.1:8844';
const passwordFile=join(root,'.domyro-preview','owner-password.txt');
const configFile=join(root,'.domyro-preview','state.json');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const work=spawn(process.execPath,['scripts/dev-portal.mjs','start'],{
  cwd:root,env:{...process.env,DOMYRO_PORT:'8844'},stdio:['ignore','pipe','pipe'],
});
let errors='';
work.stderr.on('data',data=>{errors=(errors+String(data)).slice(-2000);});
work.stdout.resume();
let finished=false,exitCode=null;
work.once('exit',code=>{finished=true;exitCode=code;});
async function wait(){
  for(let i=0;i<160;i++){
    if(finished)throw Error('dev_portal_exited_'+exitCode+'_without_web_server_'+errors);
    try{
      const response=await fetch(base+'/api/v1/health/live',{
        signal:AbortSignal.timeout(900),
      });
      if(response.status===200&&(await response.json()).status==='alive')return;
    }catch{}
    await sleep(1000);
  }
  throw Error('dev_portal_http_start_timeout_'+errors);
}
async function json(path,{method='GET',body,cookie,csrf,origin=base}={}){
  const headers={accept:'application/json'};
  if(body!==undefined)headers['content-type']='application/json';
  if(cookie)headers.cookie=cookie;
  if(csrf)headers['x-domyro-csrf']=csrf;
  if(method!=='GET')headers.origin=origin;
  const res=await fetch(base+path,{method,headers,
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(6000)});
  const data=await res.json();
  return {status:res.status,data,cookie:res.headers.get('set-cookie')};
}
async function verify(){
  await wait();
  const stat=await lstat(passwordFile);
  if(!stat.isFile()||(stat.mode&0o077)!==0)throw Error('ci_preview_owner_password_not_private');
  const password=(await readFile(passwordFile,'utf8')).trim();
  const saved=JSON.parse(await readFile(configFile,'utf8'));
  if(saved.kind!=='domyro-local-ui-preview-v1'||
    !saved.container.startsWith('domyro-preview-'))throw Error('ci_preview_state_invalid');
  const security=await run('docker',['container','inspect','--format',
    '{{index .Config.Labels "com.domyro.scope"}}|{{json .HostConfig.PortBindings}}',saved.container],
    {timeout:10000});
  if(!security.stdout.includes('domyro-local-ui-preview')||
     !security.stdout.includes('"HostIp":"127.0.0.1"')){
    throw Error('ci_dev_db_not_bound_to_localhost');
  }
  const homepage=await fetch(base+'/');
  if(homepage.status!==200||!(await homepage.text()).includes('id="homes-list"'))
    throw Error('ci_dev_portal_home_ui_missing');
  const signin=await fetch(base+'/login');
  if(signin.status!==200||!(await signin.text()).includes('id="add-site-form"'))
    throw Error('ci_dev_portal_signedin_ui_missing');
  if((await json('/api/v1/sites')).status!==401)throw Error('ci_preview_sites_leak');
  const login=await json('/api/v1/auth/login',{
    method:'POST',body:{login:'preview_owner',password},
  });
  if(login.status!==200||!login.cookie?.includes('HttpOnly')||
     typeof login.data.csrfToken!=='string')throw Error('ci_preview_login_failed');
  const cookie=login.cookie.split(';')[0],csrf=login.data.csrfToken;
  const sites=await json('/api/v1/sites',{cookie});
  if(sites.status!==200||sites.data.sites.length!==1||
     sites.data.sites[0].display_name!=='Mijn woning'){
    throw Error('ci_preview_bootstrap_home_missing');
  }
  const site=await json('/api/v1/sites',{
    method:'POST',cookie,csrf,body:{displayName:'Ontwerplab'},
  });
  if(site.status!==201||!site.data.site.id)throw Error('ci_preview_create_site_failed');
  const id=site.data.site.id;
  const updated=await json('/api/v1/sites/'+id,{
    method:'PATCH',cookie,csrf,body:{displayName:'Studio'},
  });
  if(updated.status!==200||updated.data.site.display_name!=='Studio')
    throw Error('ci_preview_rename_site_failed');
  const denied=await json('/api/v1/sites/'+id,{
    method:'PATCH',cookie,body:{displayName:'Wrong'},
  });
  if(denied.status!==403)throw Error('ci_preview_patch_bypassed_csrf');
  const newRoom=await json('/api/v1/sites/'+id+'/areas',{
    method:'POST',cookie,csrf,body:{displayName:'Woonkamer'},
  });
  if(newRoom.status!==201||!newRoom.data.area.id)
    throw Error('ci_preview_create_room_failed');
  const renameRoom=await json('/api/v1/sites/'+id+'/areas/'+newRoom.data.area.id,{
    method:'PATCH',cookie,csrf,body:{displayName:'Living'},
  });
  if(renameRoom.status!==200||renameRoom.data.area.display_name!=='Living')
    throw Error('ci_preview_rename_room_failed');
  const stored=await json('/api/v1/sites/'+id+'/areas',{cookie});
  if(stored.status!==200||stored.data.areas.length!==1||
     stored.data.areas[0].display_name!=='Living')
    throw Error('ci_preview_room_not_persistent');
  const devices=await json('/api/v1/sites/'+id+'/devices',{cookie});
  if(devices.status!==200||devices.data.readOnly!==true||
     !Array.isArray(devices.data.devices)||devices.data.devices.length!==0)
    throw Error('ci_preview_device_inventory_not_real_or_private');
  const stillClosed=await json('/api/v1/system/updates',{cookie});
  if(stillClosed.status!==200||stillClosed.data.installAllowed!==false)
    throw Error('ci_preview_enabled_unsafe_update');
  if((await json('/api/v1/system/updates/check',{cookie})).status!==405)
    throw Error('ci_dev_release_check_requires_explicit_post');
  if((await json('/api/v1/system/updates/check',{method:'POST',body:{},cookie})).status!==403)
    throw Error('ci_dev_release_check_requires_csrf');
  const checkMarkup=await fetch(base+'/login');
  if(!(await checkMarkup.text()).includes('id="update-check"'))
    throw Error('ci_dev_release_check_button_not_rendered');

  const screenshot=await fetch(base+'/assets/login.css');
  if(screenshot.status!==200||!(await screenshot.text()).includes('.portal-device-card'))
    throw Error('ci_preview_portal_styles_missing');
  process.stdout.write('CI preview authenticated browser/API flow, real PostgreSQL persistence, local-only network and D-53 gate VERIFIED\n');
}
try{
  await verify();
}finally{
  if(!finished){
    work.kill('SIGTERM');
    await Promise.race([new Promise(resolve=>work.once('exit',resolve)),sleep(6000)]);
    if(!finished)work.kill('SIGKILL');
  }
  const stopped=await run(process.execPath,['scripts/dev-portal.mjs','stop'],
    {cwd:root,timeout:30000,env:process.env}).catch(error=>{
      throw new Error('ci_preview_postgres_stop_failed');
    });
  process.stdout.write(stopped.stdout);
}
