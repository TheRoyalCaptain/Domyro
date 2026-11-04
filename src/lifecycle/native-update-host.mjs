// SPDX-License-Identifier: AGPL-3.0-only
// Native systemd/PostgreSQL adapter. Only the separately installed privileged
// worker imports this file. Paths and commands never come from HTTP clients.
import {spawn} from 'node:child_process';
import {createReadStream, createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {readFile,writeFile,mkdir,cp,rename,lstat,readdir,chmod,open,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fetchVerifiedOfficialSourceRelease} from './native-release-download.mjs';
import {prepareVerifiedNativeSource} from './prepare-native-source.mjs';
import {inspectVerifiedStagedBundle} from './transactional-release.mjs';
import {validatePublisherTrustPolicy} from './publisher-trust-policy.mjs';

// Never print child stderr: npm, PostgreSQL and service logs can contain secrets.
async function command(executable,args,{cwd,input,output,timeout=120000}={}) {
  const child=spawn(executable,args,{cwd,env:{PATH:process.env.PATH,LANG:'C.UTF-8'},
    stdio:['pipe','pipe','pipe']});
  let text='',oversized=false;
  child.stderr.resume();
  const done=new Promise((resolve,reject)=>{
    child.on('error',reject);
    child.on('close',code=>code===0&&!oversized?resolve(text):reject(Error('native_command_failed:'+executable)));
  });
  const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
  try {
    const flows=[];
    if(input)flows.push(pipeline(createReadStream(input),child.stdin));else child.stdin.end();
    if(output)flows.push(pipeline(child.stdout,createWriteStream(output,{flags:'wx',mode:0o600})));
    else child.stdout.on('data',data=>{text+=data;if(text.length>1024*1024){oversized=true;child.kill('SIGKILL');}});
    const results=await Promise.allSettled([done,...flows]);
    const failed=results.find(r=>r.status==='rejected');
    if(failed)throw failed.reason;
    return text.trim();
  }finally {clearTimeout(timer);}
}
async function exists(path) {try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function owned(path,{directory=false,privateFile=false}={}) {
  const s=await lstat(path);
  if(s.isSymbolicLink()||s.uid!==0||(s.mode&(privateFile?0o077:0o022))!==0||
     (directory?!s.isDirectory():!s.isFile()||s.nlink!==1))throw Error('native_update_unsafe_path');
}
async function noLinks(path) {
  for(const e of await readdir(path,{withFileTypes:true})) {
    const p=join(path,e.name);
    if(e.isSymbolicLink())throw Error('native_update_config_symlink');
    if(e.isDirectory())await noLinks(p);else await owned(p);
  }
}
async function syncFile(path) {const f=await open(path,'r');try{await f.sync();}finally{await f.close();}}
async function syncTree(path) {
  for(const e of await readdir(path,{withFileTypes:true})) {
    if(e.isDirectory())await syncTree(join(path,e.name));
    else if(e.isFile())await syncFile(join(path,e.name));
  }
  await syncFile(path);
}

/** layout is loaded from a root-owned worker configuration, never a request.
 * All installed integrations must be stopped by stop(); this adapter supports
 * core-only, same-schema releases. Unsupported integrations block authorization.
 */
export function createNativeUpdateHost({app,config,work,unit,database,serviceUser,port,
  policy,authorize,download=fetchVerifiedOfficialSourceRelease}) {
  if(![app,config,work].every(p=>typeof p==='string'&&/^\/[A-Za-z0-9/_-]+$/.test(p))||
     new Set([app,config,work]).size!==3||
     [app,config,work].some(p=>[app,config,work].some(q=>p!==q&&p.startsWith(q+'/')))||
     ![unit,serviceUser].every(v=>/^[a-z][a-z0-9-]{1,60}$/.test(v))||
     !/^[a-z][a-z0-9_]{1,60}$/.test(database)||
     !Number.isInteger(port)||port<1024||port>65535||typeof authorize!=='function') {
    throw Error('native_update_configuration_invalid');
  }
  const maintenance=join(work,'maintenance');
  const currentVersion=async()=>JSON.parse(await readFile(join(app,'package.json'),'utf8')).version;
  const folder=r=>join(work,r.id);
  const pg=(args,options)=>command('runuser',['-u','postgres','--',...args],options);
  const control=action=>command('systemctl',[action,unit+'.service']);
  return {
    currentVersion,
    async authorize() {
      if(process.getuid?.()!==0)throw Error('native_update_worker_requires_root');
      await authorize();
      validatePublisherTrustPolicy({policy});
      const os=await readFile('/etc/os-release','utf8');
      if(!/^ID=ubuntu$/m.test(os)||!/^VERSION_ID="24\.04"$/m.test(os)||
         !await exists('/run/systemd/system')||await exists('/.dockerenv'))throw Error('native_ubuntu_host_required');
      await owned(app,{directory:true});await owned(config,{directory:true});
      await owned(work,{directory:true});await noLinks(config);
      const runtime=await readFile(join(config,'runtime.env'),'utf8');
      if(!runtime.split('\n').includes('DOMYRO_MAINTENANCE_FILE='+maintenance))
        throw Error('native_update_maintenance_not_configured');
      if((await lstat(app)).dev!==(await lstat(work)).dev)throw Error('native_update_same_filesystem_required');
      if(await command('systemctl',['show','--value','-p','User',unit+'.service'])!==serviceUser)
        throw Error('native_update_service_identity_mismatch');
    },
    async prepare(record) {
      const root=folder(record);
      await mkdir(root,{mode:0o711});
      await chmod(root,0o711);
      const architecture={x64:'amd64',arm64:'arm64'}[process.arch];
      if(!architecture)throw Error('native_architecture_unsupported');
      const migrations=join(app,'src/persistence/migrations');
      const files=(await readdir(migrations)).filter(n=>n.endsWith('.sql')).sort();
      const databaseSchema=Number(files.at(-1)?.slice(0,3));
      const trust={trustedPublicKeyPem:policy.publicKeyPem,
        expectedPublicKeySha256:policy.publisherFingerprintSha256,architecture,databaseSchema};
      const release=await download({version:record.version,...trust});
      let staged;
      try { staged=await prepareVerifiedNativeSource({directory:release.directory,
        stageRoot:join(root,'signed'),currentVersion:record.previousVersion,...trust}); }
      finally { if(release.directory.startsWith('/tmp/domyro-source-download-'))
        await rm(release.directory,{recursive:true,force:true}); }
      // Independently compare every migration with installed code. Version
      // ranges in a manifest alone cannot authorize SQL changes.
      const incoming=join(staged.stageDirectory,'src/persistence/migrations');
      if(JSON.stringify((await readdir(incoming)).sort())!==JSON.stringify(files))
        throw Error('native_update_schema_change_refused');
      for(const file of files)if(!(await readFile(join(incoming,file))).equals(await readFile(join(migrations,file))))
        throw Error('native_update_schema_change_refused');
      const candidate=join(root,'candidate');
      await cp(staged.stageDirectory,candidate,{recursive:true,errorOnExist:true,force:false});
      await command('chown',['-R',serviceUser+':'+serviceUser,candidate]);
      await command('runuser',['-u',serviceUser,'--','env','HOME='+candidate,
        'npm','ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--cache='+join(candidate,'.npm-cache')],
        {cwd:candidate,timeout:300000});
      await rm(join(candidate,'.npm-cache'),{recursive:true,force:true});
      await command('chown',['-R','root:root',candidate]);
      await command('chmod',['-R','go-w',candidate]);
      // Reverify immutable staged source, then compare ALL signed source
      // bytes with the dependency-install destination (npm cannot alter code).
      await inspectVerifiedStagedBundle({root:join(root,'signed'),version:record.version,
        trustedPublicKeyPem:policy.publicKeyPem,expectedArch:architecture});
      const compare=async(relative='')=>{
        for(const e of await readdir(join(staged.stageDirectory,relative),{withFileTypes:true})) {
          const name=join(relative,e.name),target=join(candidate,name);
          if(e.isDirectory()){await owned(target,{directory:true});await compare(name);}
          else {await owned(target);if(!(await readFile(join(staged.stageDirectory,name))).equals(await readFile(target)))
            throw Error('native_update_source_changed');}
        }
      };
      await compare();
      await syncTree(candidate);
    },
    async stop() {
      await writeFile(maintenance,'update in progress\n',{mode:0o644});
      await chmod(maintenance,0o644);await syncFile(maintenance);await syncFile(work);
      await control('stop');
    },
    async resume() {await rm(maintenance,{force:true});await syncFile(work);},
    async backup(record) {
      const root=folder(record),snapshot=join(root,'snapshot');
      await mkdir(snapshot,{mode:0o700});
      const dump=join(snapshot,'database.dump');
      await pg(['pg_dump','--format=custom','--dbname='+database],{output:dump});
      await cp(config,join(snapshot,'config'),{recursive:true,errorOnExist:true,force:false});
      // Prove that the dump restores into a separate disposable database.
      const scratch='domyro_verify_'+record.id.replaceAll('-','');
      await pg(['createdb','--template=template0',scratch]);
      try {
        await pg(['pg_restore','--exit-on-error','--no-owner','--no-privileges','--dbname='+scratch],{input:dump});
        const schema=await pg(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d',scratch,
          '-c','SELECT count(*) FROM domyro_schema_migrations']);
        if(!/^[1-9][0-9]*$/.test(schema))throw Error('native_update_backup_restore_invalid');
      } finally {await pg(['dropdb',scratch]);}
      await writeFile(join(snapshot,'verified.json'),JSON.stringify({id:record.id,version:record.previousVersion}),{flag:'wx',mode:0o600});
      await syncTree(snapshot);
    },
    async activate(record) {
      const root=folder(record);
      await rename(app,join(root,'previous'));
      await syncFile(root);await syncFile(join(app,'..'));
      await rename(join(root,'candidate'),app);
      await command('chmod',['-R','a+rX',app]);
      await syncFile(root);await syncFile(join(app,'..'));
    },
    async restore(record) {
      const root=folder(record),snapshot=join(root,'snapshot');
      await owned(join(snapshot,'verified.json'),{privateFile:true});
      const receipt=JSON.parse(await readFile(join(snapshot,'verified.json'),'utf8'));
      if(receipt.id!==record.id||receipt.version!==record.previousVersion)throw Error('native_update_backup_receipt_mismatch');
      // Rename operations are replayable after a second power interruption.
      if(await exists(join(root,'previous'))) {
        if(await exists(app))await rename(app,join(root,'rejected'));
        await rename(join(root,'previous'),app);
      }
      if(await currentVersion()!==record.previousVersion)throw Error('native_update_previous_release_missing');
      await pg(['pg_restore','--exit-on-error','--single-transaction','--clean','--if-exists','--dbname='+database],
        {input:join(snapshot,'database.dump')});
      if(!await exists(join(root,'rejected-config'))&&await exists(config))await rename(config,join(root,'rejected-config'));
      await cp(join(snapshot,'config'),config,{recursive:true,force:true});
      await syncTree(config);await syncFile(root);await syncFile(join(app,'..'));
    },
    async start() {await control('reset-failed');await control('start');},
    async healthy(version) {
      for(let attempt=0;attempt<30;attempt++) {
        try {
          const result=await fetch('http://127.0.0.1:'+port+'/api/v1/public/status',
            {signal:AbortSignal.timeout(2000)});
          const body=await result.json();
          if(result.ok&&body.version===version&&body.persistence==='ready')return true;
        }catch{}
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      return false;
    },
  };
}
