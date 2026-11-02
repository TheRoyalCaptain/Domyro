// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync,createHash,sign } from 'node:crypto';
import { lstat,rm } from 'node:fs/promises';
import { fetchVerifiedOfficialSourceRelease,officialReleaseUrl } from '../src/lifecycle/native-release-download.mjs';

const keys=generateKeyPairSync('ed25519');
const publisher=keys.publicKey.export({type:'spki',format:'pem'});
const fingerprint=createHash('sha256').update(keys.publicKey.export({
  type:'spki',format:'der',
})).digest('hex');
const version='0.1.1';
function fixture({tamper=null,now=new Date().toISOString()}={}){
  const artifact=Buffer.from(JSON.stringify({schemaVersion:1,files:[
    {path:'src/server.mjs',base64:Buffer.from('console.log("native signed proof")').toString('base64')},
  ]}));
  const manifest={
    schemaVersion:1,version,channel:'stable',publishedAt:now,
    database:{min:3,max:3,target:3,migration:'none'},
    artifacts:['amd64','arm64'].map(arch=>({
      os:'ubuntu',arch,file:'domyro-'+version+'-ubuntu-'+arch+'.bundle.json',
      sha256:createHash('sha256').update(artifact).digest('hex'),
      bytes:artifact.length,
    })),
  };
  if(tamper==='version')manifest.version='0.1.2';
  if(tamper==='single-arch')manifest.artifacts.pop();
  const rawManifest=Buffer.from(JSON.stringify(manifest));
  const signature=sign(null,rawManifest,keys.privateKey).toString('base64')+'\n';
  const files=new Map([
    ['release-manifest.json',rawManifest],
    ['release-manifest.sig',Buffer.from(tamper==='signature'?'invalid\n':signature)],
    ...manifest.artifacts.map(item=>[item.file,artifact]),
  ]);
  if(tamper==='artifact'){
    files.set(manifest.artifacts[0].file,Buffer.from('tampered'));
  }
  let requests=0;
  const fetcher=async (url,options)=>{
    requests++;
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');
    assert.equal(options.credentials,'omit');
    const path=new URL(url).pathname;
    const filename=path.slice(path.lastIndexOf('/')+1);
    if(!files.has(filename))return new Response(null,{status:404});
    return new Response(files.get(filename),{status:200});
  };
  return {fetcher,get requests(){return requests;}};
}
function input(fetcher,extras={}){
  return {version,architecture:'amd64',databaseSchema:3,
    trustedPublicKeyPem:publisher,expectedPublicKeySha256:fingerprint,
    fetcher,...extras};
}
test('signed official-source downloader reads every multiarch file before returning and leaves production gate locked',async t=>{
  const f=fixture();
  const result=await fetchVerifiedOfficialSourceRelease(input(f.fetcher));
  t.after(()=>rm(result.directory,{recursive:true,force:true}));
  assert.equal(result.allArtifactsVerified,true);
  assert.equal(result.installationAllowed,false);
  assert.equal(result.updateAllowed,false);
  assert.equal(result.version,version);
  assert.equal(result.installationGate,'D-53');
  assert.equal(result.publisherFingerprint,fingerprint);
  assert.equal(f.requests,4);
  assert.equal((await lstat(result.directory)).isDirectory(),true);
});
test('download trust fingerprint MUST be independently pinned even with a valid signature',async()=>{
  let count=0;
  await assert.rejects(fetchVerifiedOfficialSourceRelease(input(
    async()=>{count++;throw Error('must not be called');},
    {expectedPublicKeySha256:'a'.repeat(64)},
  )),/trust_root_fingerprint_mismatch/);
  assert.equal(count,0);
});
test('wrong signed version, partial signed release, modified artifact and signature all fail',async()=>{
  for(const tamper of ['version','single-arch','artifact','signature']){
    const f=fixture({tamper});
    await assert.rejects(fetchVerifiedOfficialSourceRelease(input(f.fetcher)),
      /release_signed_version_mismatch|release_multiarch_required|release_download_artifact_integrity_failed|signature_invalid|signature_untrusted/);
  }
});
test('no downgrade via arbitrary URL, no version injection or filename traversal',()=>{
  assert.equal(officialReleaseUrl('1.2.3'),
    'https://github.com/TheRoyalCaptain/Domyro/releases/download/v1.2.3');
  for(const bad of ['../latest','latest','1.2.3/../../else','1.2.3?raw=1',
    '1.2.3#comment','1.2.3..','01.2.3']){
    assert.throws(()=>officialReleaseUrl(bad),/release_version_invalid/);
  }
});
test('downgrade redirect and excessive response body are rejected',async()=>{
  const f=fixture();
  await assert.rejects(fetchVerifiedOfficialSourceRelease(input(
    async(url,opt)=>url.endsWith('release-manifest.json')?
      new Response(null,{status:302,headers:{location:'http://evil.example/source'}}):
      f.fetcher(url,opt),
  )),/release_https_source_not_approved/);
  const oversized=async()=>new Response(Buffer.alloc(256*1024+1),{status:200});
  await assert.rejects(fetchVerifiedOfficialSourceRelease(input(oversized)),
    /release_download_(size_exceeded|length_invalid)/);
});
test('network errors, missing assets, invalid schemas and future signed releases fail closed',async()=>{
  const f=fixture();
  await assert.rejects(fetchVerifiedOfficialSourceRelease(input(
    async()=>{throw Error('network down');}
  )),/release_download_failed/);
  await assert.rejects(fetchVerifiedOfficialSourceRelease(input(
    async()=>new Response(null,{status:404})
  )),/release_download_http_404/);
  const future=fixture({now:new Date(Date.now()+10*60_000).toISOString().replace(/\.\d{3}Z$/,'Z')});
  await assert.rejects(fetchVerifiedOfficialSourceRelease(input(future.fetcher)),
    /release_published_in_future/);
});
