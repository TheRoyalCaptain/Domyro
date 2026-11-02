#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// CI release publisher trust check. No publication and no private-key logging.
import { constants } from 'node:fs';
import { open,lstat,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePublisherTrustPolicy } from '../src/lifecycle/publisher-trust-policy.mjs';

async function guardedSecret(path){
  if(!path?.startsWith('/'))throw new Error('publisher_private_key_file_absolute_required');
  const location=resolve(path);
  const before=await lstat(location);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
     (before.mode&0o077)!==0||before.size<50||before.size>8192){
    throw new Error('publisher_private_key_file_not_private');
  }
  const fd=await open(location,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const after=await fd.stat();
    if(after.ino!==before.ino||after.dev!==before.dev||after.size!==before.size){
      throw new Error('publisher_private_key_file_changed');
    }
    return await fd.readFile('utf8');
  }finally{await fd.close();}
}
async function main(){
  if(process.argv.length!==4)throw new Error('usage: verify-release-publisher <policy.json> <private.pem>');
  const policy=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
  const privateKeyPem=await guardedSecret(process.argv[3]);
  const checked=validatePublisherTrustPolicy({policy,privateKeyPem});
  process.stdout.write(JSON.stringify(checked)+'\n');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  main().catch(error=>{
    console.error('Official release publisher refused: '+error.message);
    process.exitCode=1;
  });
}
