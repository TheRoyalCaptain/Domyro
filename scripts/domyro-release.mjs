#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Native release lifecycle CLI: check -> authenticate -> download.
 * NEVER calls an install/activate/restart function while D-53 is closed.
 *
 * Usage:
 *   node scripts/domyro-release.mjs check --current=0.1.1
 *   node scripts/domyro-release.mjs prepare --current=0.1.1 --arch=amd64 \
 *      --schema=3 --publisher-key=/etc/domyro/publisher.pem \
 *      --publisher-fingerprint=<64-digit-pinned-SPKI-SHA256>
 */
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLatestOfficialRelease, downloadLatestIfAuthenticated } from '../src/lifecycle/native-release-discovery.mjs';

function parse(argv){
  const [command,...options]=argv;
  if(!['check','prepare','install','update'].includes(command))throw new Error('release_cli_command_invalid');
  if(['install','update'].includes(command)){
    return {command,blocked:true};
  }
  const accepted=new Set(['current','arch','schema','publisher-key','publisher-fingerprint']);
  const values=new Map();
  for(const option of options){
    const match=/^--([a-z-]+)=(.+)$/.exec(option);
    if(!match||!accepted.has(match[1])||values.has(match[1]))
      throw new Error('release_cli_argument_invalid');
    values.set(match[1],match[2]);
  }
  if(!values.has('current'))throw new Error('release_cli_current_version_required');
  if(command==='check'&&values.size!==1)throw new Error('release_cli_check_accepts_current_only');
  if(command==='prepare'){
    for(const key of ['arch','schema','publisher-key','publisher-fingerprint']){
      if(!values.has(key))throw new Error('release_cli_required:'+key);
    }
    if(!/^(0|[1-9][0-9]{0,8})$/.test(values.get('schema')))throw new Error('release_cli_schema_invalid');
    if(!['amd64','arm64'].includes(values.get('arch')))throw new Error('release_cli_arch_invalid');
    if(!/^[a-f0-9]{64}$/.test(values.get('publisher-fingerprint'))){
      throw new Error('release_cli_fingerprint_invalid');
    }
  }
  return {command,currentVersion:values.get('current'),
    architecture:values.get('arch'),databaseSchema:values.has('schema')?Number(values.get('schema')):null,
    keyPath:values.get('publisher-key'),
    expectedPublicKeySha256:values.get('publisher-fingerprint')};
}
async function privateKeyRead(path){
  if(typeof path!=='string'||!path.startsWith('/'))throw new Error('release_cli_public_key_absolute_path_required');
  const location=resolve(path);
  const before=await lstat(location);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
    before.size<1||before.size>16384||(before.mode&0o022)!==0){
    throw new Error('release_cli_publisher_key_file_unsafe');
  }
  const fd=await open(location,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const after=await fd.stat();
    if(after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size){
      throw new Error('release_cli_publisher_key_changed');
    }
    return await fd.readFile('utf8');
  }finally{await fd.close();}
}
async function main(){
  const args=parse(process.argv.slice(2));
  if(args.blocked){
    process.stdout.write(JSON.stringify({command:args.command,status:'blocked',
      installationGate:'D-53',installAllowed:false,
      reason:'official_release_key_and_native_install_update_engine_not_yet_approved'})+'\n');
    process.exitCode=53;
    return;
  }
  if(args.command==='check'){
    const result=await checkLatestOfficialRelease({currentVersion:args.currentVersion});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    return;
  }
  const trustedPublicKeyPem=await privateKeyRead(args.keyPath);
  const result=await downloadLatestIfAuthenticated({
    currentVersion:args.currentVersion,architecture:args.architecture,
    databaseSchema:args.databaseSchema,trustedPublicKeyPem,
    expectedPublicKeySha256:args.expectedPublicKeySha256,
  });
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main().catch(error=>{
    console.error('Domyro release manager refused: '+error.message);
    process.exitCode=1;
  });
}
