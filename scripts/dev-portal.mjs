#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LOCALLY ISOLATED DEVELOPMENT PORTAL, NOT THE DOMYRO INSTALLER.
 * Starts a uniquely named PostgreSQL 17 Docker container on 127.0.0.1 only,
 * applies migrations to THAT NEW DATABASE and bootstraps a dev-only owner.
 * Never installs packages, asks for sudo, accesses MQTT, or changes /etc.
 *
 * Manual opt-in: npm run preview:portal
 * Stop DB: npm run preview:stop
 * Database volume persists intentionally across restarts.
 */
import {randomBytes} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
import {lstat,mkdir,open,readFile,realpath,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const run=promisify(execFile);
const REPO=resolve(fileURLToPath(new URL('../',import.meta.url)));
const DIR=join(REPO,'.domyro-preview');
const CONFIG=join(DIR,'state.json');
const DB_ENV=join(DIR,'postgres.env');
const PASS=join(DIR,'owner-password.txt');
const SCOPE='domyro-local-ui-preview';
const IMAGE='postgres:17-alpine';
const USER='preview_owner';
const NAME=/^domyro-preview-[0-9a-f]{16}$/;
const VOLUME=/^domyro-preview-data-[0-9a-f]{16}$/;
const CLI_ENV=Object.freeze({
  PATH:process.env.PATH??'/usr/bin:/bin',HOME:process.env.HOME??'/nonexistent',
});
async function docker(args,{allowMissing=false}={}){
  try{
    const {stdout}=await run('docker',args,{timeout:25000,maxBuffer:128*1024,
      env:{...process.env,DOCKER_HOST:undefined,DOCKER_CONTEXT:undefined}});
    return stdout.trim();
  }catch(error){
    if(allowMissing&&error.code!== 'ENOENT' && error.exitCode!==0)return null;
    throw new Error('preview_docker_failed_'+String(args[0]).replace(/[^a-z-]/g,''));
  }
}
async function localDocker(){
  if(process.env.DOCKER_HOST||process.env.DOCKER_CONTEXT){
    throw new Error('preview_refuses_custom_docker_target');
  }
  const target=await docker(['context','inspect','--format',
    '{{json .Endpoints.docker.Host}}']);
  let endpoint;
  try{endpoint=JSON.parse(target);}catch{throw new Error('preview_docker_target_unknown');}
  const uid=process.getuid();
  if(!['unix:///var/run/docker.sock','unix:///run/user/'+uid+'/docker.sock'].includes(endpoint)){
    throw new Error('preview_refuses_remote_docker_daemon');
  }
  await docker(['info','--format','{{.ServerVersion}}']);
}
async function secureDir(){
  const stat=await lstat(DIR);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||
    stat.uid!==process.getuid()||await realpath(DIR)!==DIR){
    throw new Error('preview_state_directory_unsafe');
  }
}
async function secureFile(path){
  const stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
    stat.uid!==process.getuid()||(stat.mode&0o077)!==0||
    stat.size<12||stat.size>8192){
    throw new Error('preview_state_file_unsafe');
  }
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const current=await fd.stat();
    if(current.ino!==stat.ino||current.dev!==stat.dev||
       current.size!==stat.size)throw new Error('preview_state_file_changed');
    return await fd.readFile('utf8');
  }finally{await fd.close();}
}
function validate(data){
  if(data?.kind!=='domyro-local-ui-preview-v1'||data.scope!==SCOPE||
    !NAME.test(data.container??'')||!VOLUME.test(data.volume??'')||
    data.volume!=='domyro-preview-data-'+data.container.slice('domyro-preview-'.length)||
    data.db!=='domyro_preview' ||data.user!=='domyro_preview'||
    !/^[0-9A-Za-z_-]{40,128}$/.test(data.password??'')){
    throw new Error('preview_state_invalid');
  }
  return data;
}
async function state({create=false}={}){
  try{
    await secureDir();
    return validate(JSON.parse(await secureFile(CONFIG)));
  }catch(error){
    if(error.code!=='ENOENT'||!create)throw error;
  }
  if(await lstat(DIR).then(()=>true,e=>e.code==='ENOENT'?false:Promise.reject(e))){
    throw new Error('preview_partial_directory_requires_manual_review');
  }
  await mkdir(DIR,{mode:0o700});
  await secureDir();
  const id=randomBytes(8).toString('hex');
  const config=validate({
    kind:'domyro-local-ui-preview-v1',scope:SCOPE,
    container:'domyro-preview-'+id,volume:'domyro-preview-data-'+id,
    user:'domyro_preview',db:'domyro_preview',
    password:randomBytes(40).toString('base64url'),
  });
  const ownerPassword=randomBytes(36).toString('base64url');
  await writeFile(DB_ENV,
    'POSTGRES_USER='+config.user+'\nPOSTGRES_DB='+config.db+
    '\nPOSTGRES_PASSWORD='+config.password+'\n',
    {flag:'wx',mode:0o600});
  await writeFile(PASS,ownerPassword,{flag:'wx',mode:0o600});
  await writeFile(CONFIG,JSON.stringify(config)+'\n',{flag:'wx',mode:0o600});
  return config;
}
async function containerStatus(config){
  const result=await docker(['container','inspect','--format',
    '{{index .Config.Labels "com.domyro.scope"}}|{{.State.Running}}|{{.Config.Image}}',
    config.container],{allowMissing:true});
  if(result===null)return null;
  const [scope,running,image]=result.split('|');
  if(scope!==SCOPE||image!==IMAGE||!['true','false'].includes(running)){
    throw new Error('preview_container_identity_mismatch');
  }
  return running==='true'?'running':'stopped';
}
async function ensureContainer(config){
  let status=await containerStatus(config);
  if(status==='stopped')await docker(['start',config.container]);
  if(status===null){
    const existing=await docker(['volume','inspect','--format',
      '{{index .Labels "com.domyro.scope"}}',config.volume],{allowMissing:true});
    if(existing!==null&&existing!==SCOPE){
      throw new Error('preview_volume_identity_mismatch');
    }
    if(existing===null)await docker(['volume','create','--label',
      'com.domyro.scope='+SCOPE,config.volume]);
    await docker(['run','-d','--restart=no',
      '--name',config.container,'--label','com.domyro.scope='+SCOPE,
      '--publish','127.0.0.1::5432','--env-file',DB_ENV,
      '--volume',config.volume+':/var/lib/postgresql/data',IMAGE]);
  }
  const exposed=await docker(['port',config.container,'5432/tcp']);
  const match=/^127\.0\.0\.1:([1-9]\d{3,4})$/.exec(exposed);
  if(!match||Number(match[1])>65535){
    throw new Error('preview_postgres_network_must_be_loopback');
  }
  return Number(match[1]);
}
async function waitForDb(url){
  const {Pool}=await import('pg');
  for(let attempt=0;attempt<45;attempt++){
    const db=new Pool({connectionString:url,max:1,connectionTimeoutMillis:1000});
    try{
      const result=await db.query('SELECT current_database() AS name');
      if(result.rows[0]?.name==='domyro_preview')return;
    }catch{ /* Docker PostgreSQL may still be initializing. */ }
    finally{await db.end();}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('preview_database_not_ready');
}
async function runNode(script,args,env){
  try{
    await run(process.execPath,[join(REPO,script),...args],{
      cwd:REPO,env:{...CLI_ENV,...env},timeout:30000,
      maxBuffer:100*1024,
    });
  }catch(error){
    throw new Error('preview_setup_failed_'+script.replace(/[^a-zA-Z]/g,'_'));
  }
}
async function start(){
  if(resolve(process.cwd())!==REPO||process.getuid?.()===0){
    throw new Error('preview_requires_nonroot_repository_workdir');
  }
  await localDocker();
  const config=await state({create:true});
  await Promise.all([secureFile(DB_ENV),secureFile(PASS)]);
  const port=await ensureContainer(config);
  const url=new URL('postgresql://127.0.0.1:'+port+'/'+config.db);
  url.username=config.user;url.password=config.password;
  await waitForDb(url.href);
  const env={DOMYRO_DATABASE_URL:url.href};
  // This migration applies ONLY to our unique Docker container, not the OS.
  await runNode('scripts/migrate-db.mjs',['--apply'],env);
  const {Pool}=await import('pg');
  const db=new Pool({connectionString:url.href,max:1});
  let current;
  try{current=(await db.query('SELECT login FROM domyro_users ORDER BY login')).rows;}
  finally{await db.end();}
  if(current.length===0){
    await runNode('scripts/bootstrap-owner.mjs',[
      '--login',USER,'--site','Mijn woning','--password-file',PASS,
    ],env);
  }else if(!current.some(user=>user.login===USER)){
    throw new Error('preview_existing_owner_identity_unknown');
  }
  const previewPort=Number(process.env.DOMYRO_PORT??8844);
  if(!Number.isSafeInteger(previewPort)||previewPort<1024||previewPort>65535){
    throw new Error('preview_http_port_invalid');
  }
  process.stdout.write('\nDOMYRO ONTWERPPORTAL (ALLEEN LOKAAL)\n'+
    'Dashboard: http://127.0.0.1:'+previewPort+'\n'+
    'Aanmelden: http://127.0.0.1:'+previewPort+'/login\n'+
    'Gebruiker: '+USER+'\n'+
    'Wachtwoord: in .domyro-preview/owner-password.txt (privé, niet in git)\n'+
    'Stop de webserver met Ctrl+C. De aparte database blijft behouden.\n\n');
  const child=spawn(process.execPath,[join(REPO,'src/server.mjs')],{
    cwd:REPO,env:{...CLI_ENV,...env,DOMYRO_HOST:'127.0.0.1',
      DOMYRO_PORT:String(previewPort)},stdio:'inherit',
  });
  const stop=()=>{if(child.exitCode===null)child.kill('SIGTERM');};
  process.once('SIGINT',stop);
  process.once('SIGTERM',stop);
  await new Promise((resolve,reject)=>{
    child.once('exit',code=>resolve(code));
    child.once('error',reject);
  });
}
async function stop(){
  if(resolve(process.cwd())!==REPO||process.getuid?.()===0){
    throw new Error('preview_requires_nonroot_repository_workdir');
  }
  await localDocker();
  const config=await state();
  if(await containerStatus(config)==='running'){
    await docker(['stop','--time','10',config.container]);
  }
  process.stdout.write('Lokale Domyro-ontwikkeldatabase gestopt. Volume en gegevens behouden.\n');
}
const cmd=process.argv[2]??'start';
if(process.argv.length>3||!['start','stop'].includes(cmd)){
  throw new Error('usage: node scripts/dev-portal.mjs start|stop');
}
(cmd==='start'?start():stop()).catch(error=>{
  process.stderr.write('Domyro preview geweigerd: '+error.message+'\n');
  process.exitCode=1;
});
