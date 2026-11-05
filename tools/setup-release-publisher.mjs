#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Explicit local preparation. Does not upload secrets, alter trust or publish.
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdir,open,realpath,lstat} from 'node:fs/promises';
import {dirname,join,resolve,isAbsolute,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validatePublisherTrustPolicy} from '../src/lifecycle/publisher-trust-policy.mjs';

export async function preparePublisher(directory,{projectRoot=resolve('.')}={}) {
  if(!isAbsolute(directory))throw Error('absolute_private_directory_required');
  const target=resolve(directory),parent=dirname(target);
  const canonical=await realpath(parent);
  if(canonical!==parent)throw Error('symlink_parent_refused');
  const info=await lstat(parent);
  if(!info.isDirectory()||info.uid!==process.getuid()||(info.mode&0o022)!==0)
    throw Error('private_directory_parent_unsafe');
  const repo=await realpath(projectRoot),rel=relative(repo,target);
  if(!rel||(!rel.startsWith('../')&&!isAbsolute(rel)))throw Error('private_key_must_be_outside_project');
  for(let path=parent;;path=dirname(path)) {
    try {await lstat(join(path,'.git'));throw Error('private_key_must_be_outside_git');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(dirname(path)===path)break;
  }
  // Exclusive directory creation prevents replacing a previous signing key.
  await mkdir(target,{mode:0o700});
  const keys=generateKeyPairSync('ed25519');
  const privateKeyPem=keys.privateKey.export({type:'pkcs8',format:'pem'});
  const policy={schemaVersion:1,configured:true,
    publicKeyPem:keys.publicKey.export({type:'spki',format:'pem'}),
    publisherFingerprintSha256:createHash('sha256').update(keys.publicKey.export({type:'spki',format:'der'})).digest('hex'),
    releaseSource:'github.com/TheRoyalCaptain/Domyro/releases'};
  validatePublisherTrustPolicy({policy,privateKeyPem});
  for(const [name,content] of [['release-private.pem',privateKeyPem],['release-publisher.json',JSON.stringify(policy,null,2)+'\n']]){
    const fd=await open(join(target,name),'wx',0o600);
    try{await fd.writeFile(content);await fd.sync();}finally{await fd.close();}
  }
  const fd=await open(target,'r');try{await fd.sync();}finally{await fd.close();}
  return {directory:target,publicPolicy:join(target,'release-publisher.json'),
    privateKey:join(target,'release-private.pem'),fingerprint:policy.publisherFingerprintSha256};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3)throw Error('usage: node tools/setup-release-publisher.mjs /absolute/private-directory');
    const result=await preparePublisher(process.argv[2]);
    console.log(JSON.stringify(result,null,2));
    console.log('Prepared only. Back up the private key securely; import it into the production-release GitHub environment secret. Commit only the public policy after review.');
  }catch(error){console.error('Publisher setup refused: '+error.message);process.exitCode=1;}
}
