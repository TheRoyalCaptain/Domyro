#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * EXPLICIT owner-invoked OFFLINE staging. No services or Docker used.
 * The publisher's Ed25519 SPKI and fingerprint must be independently trusted.
 */
import {constants} from 'node:fs';
import {lstat,open} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {prepareVerifiedNativeSource} from '../src/lifecycle/prepare-native-source.mjs';

async function readPublicKey(path){
  const full=resolve(path);
  const info=await lstat(full);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||
     (info.mode&0o022)!==0||info.size>16384||info.size<30)
    throw new Error('signed_stage_public_key_file_unsafe');
  const handle=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const next=await handle.stat();
    if(next.ino!==info.ino||next.size!==info.size)
      throw new Error('signed_stage_public_key_file_changed');
    return await handle.readFile('utf8');
  }finally{await handle.close();}
}
function parse(args){
  const allowed=new Set(['directory','stage-root','publisher-key','publisher-fingerprint',
    'arch','schema','current','channel']);
  const values=new Map();
  for(const arg of args){
    const match=/^--([a-z-]+)=(.+)$/.exec(arg);
    if(!match||!allowed.has(match[1])||values.has(match[1]))
      throw new Error('signed_stage_argument_invalid');
    values.set(match[1],match[2]);
  }
  for(const key of ['directory','stage-root','publisher-key','publisher-fingerprint',
    'arch','schema','current']){
    if(!values.has(key))throw new Error('signed_stage_missing_'+key);
  }
  if(!['amd64','arm64'].includes(values.get('arch'))||
     !/^[0-9]{1,5}$/.test(values.get('schema'))||
     !/^[a-f0-9]{64}$/.test(values.get('publisher-fingerprint'))||
     !['stable','beta'].includes(values.get('channel')??'stable'))
    throw new Error('signed_stage_argument_invalid');
  for(const key of ['directory','stage-root','publisher-key'])
    if(!values.get(key).startsWith('/'))throw new Error('signed_stage_absolute_paths_required');
  const root=resolve(values.get('stage-root')),home=resolve(homedir());
  if(root===home||!root.startsWith(home+sep)||
     root.includes('/.ssh/')||root.includes('/.gnupg/'))
    throw new Error('signed_stage_must_be_inside_user_home');
  return {
    directory:resolve(values.get('directory')),stageRoot:root,
    keyPath:values.get('publisher-key'),
    expectedPublicKeySha256:values.get('publisher-fingerprint'),
    architecture:values.get('arch'),databaseSchema:Number(values.get('schema')),
    currentVersion:values.get('current'),channel:values.get('channel')??'stable',
  };
}
async function main(){
  if(process.getuid?.()===0)throw new Error('signed_stage_refuses_root_execution');
  const settings=parse(process.argv.slice(2));
  const trustedPublicKeyPem=await readPublicKey(settings.keyPath);
  const {keyPath,...inputs}=settings;
  const result=await prepareVerifiedNativeSource({...inputs,trustedPublicKeyPem});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
  main().catch(error=>{
    process.stderr.write('Domyro signed source stage REFUSED: '+error.message+'\n');
    process.exitCode=1;
  });
