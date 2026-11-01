// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Developer-only test: install locked production npm dependencies inside an
 * ephemeral signed-source release. No systemd, apt, hardware or owner data.
 */
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {arch as osArch,tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageVerifiedBundle,inspectVerifiedStagedBundle} from './transactional-release.mjs';

const ARCH=Object.freeze({x64:'amd64',arm64:'arm64'});
function sandboxEnv(dir){
  return {PATH:process.env.PATH||'/usr/bin:/bin',HOME:dir,NODE_ENV:'production',
    npm_config_cache:join(dir,'npm-cache'),
    npm_config_ignore_scripts:'true',npm_config_audit:'false',
    npm_config_fund:'false',npm_config_update_notifier:'false'};
}
async function run(executable,args,opts){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{...opts,shell:false,stdio:['ignore','pipe','pipe']});
    let output='',size=0,failed=false,timedOut=false,settled=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},180000);
    function finish(error,result){
      if(settled)return;settled=true;clearTimeout(timer);
      if(error)reject(new Error(error));else resolve(result);
    }
    child.stdout.on('data',buf=>{
      size+=buf.length;
      if(size<=32768)output+=buf.toString('utf8');
      else{failed=true;child.kill('SIGKILL');}
    });
    child.stderr.on('data',buf=>{
      size+=buf.length;
      if(size>32768){failed=true;child.kill('SIGKILL');}
    });
    child.on('error',()=>finish('sandbox_tool_missing'));
    child.on('close',code=>{
      if(timedOut)finish('sandbox_tool_timeout');
      else if(code!==0||failed)finish('sandbox_tool_failed');
      else finish(null,output);
    });
  });
}
/** onInstalled is a controlled CI fault-injection callback, never deployment. */
export async function rehearseLockedDependencies({
  manifestBytes,signatureBase64,trustedPublicKeyPem,artifactBytes,
  arch=ARCH[osArch()],onInstalled=async()=>{},
}={}){
  if(arch!==ARCH[osArch()])throw new Error('sandbox_architecture_mismatch');
  if(typeof onInstalled!=='function')throw new TypeError('invalid_sandbox_hook');
  const sandbox=await mkdtemp(join(tmpdir(),'domyro-locked-runtime-test-'));
  try{
    const root=join(sandbox,'release-root');
    const staged=await stageVerifiedBundle({
      root,manifestBytes,signatureBase64,trustedPublicKeyPem,artifactBytes,arch});
    await inspectVerifiedStagedBundle({root,version:staged.version,trustedPublicKeyPem,expectedArch:arch});
    const release=join(root,'releases',staged.version);
    const pkg=JSON.parse(await readFile(join(release,'package.json'),'utf8'));
    const lock=JSON.parse(await readFile(join(release,'package-lock.json'),'utf8'));
    if(pkg.name!=='domyro'||lock.lockfileVersion!==3||
       lock.name!==pkg.name||lock.version!==pkg.version)throw new Error('runtime_lock_identity_invalid');
    for(const [name,wanted] of Object.entries(pkg.dependencies??{})){
      if(lock.packages?.['']?.dependencies?.[name]!==wanted||
         lock.packages?.['node_modules/'+name]?.version!==wanted)throw new Error('runtime_lock_dep_mismatch');
    }
    const options={cwd:release,env:sandboxEnv(sandbox)};
    // npm verifies registry SHA512 integrity and never runs lifecycle scripts.
    await run('npm',['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],options);
    await onInstalled({sandbox,release});
    const script=[
      "import {hash,verify} from '@node-rs/argon2';",
      "import {Pool} from 'pg';",
      "import mqtt from 'mqtt';",
      "const digest=await hash('isolated-runtime-only');",
      "if(!await verify(digest,'isolated-runtime-only')||typeof Pool!=='function'||typeof mqtt.connect!=='function')process.exit(13);",
      "process.stdout.write('DOMYRO_DEPS_IMPORT_OK');",
    ].join('\n');
    const output=await run(process.execPath,['--input-type=module','--eval',script],options);
    if(output.trim()!=='DOMYRO_DEPS_IMPORT_OK')throw new Error('runtime_dependency_probe_failed');
    return Object.freeze({
      result:'isolated_locked_runtime_dependencies_passed',
      arch,version:staged.version,
      dependencies:Object.freeze(Object.keys(pkg.dependencies).sort()),
      scriptsExecuted:false,lockIntegrityEnforced:true,environment:'disposable',
      hostSoftwareInstalled:false,installationApproved:false,gate:'D-53',
    });
  }finally{await rm(sandbox,{recursive:true,force:true});}
}
