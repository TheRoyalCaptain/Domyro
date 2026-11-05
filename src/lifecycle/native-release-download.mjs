// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Download-only release transport used by a future one-line bootstrap and
 * release updater. Downloads an entire signed multiarch source package into
 * a NEW private os.tmpdir() directory, verifies the independent publisher pin,
 * the detached Ed25519 signature and every artifact hash BEFORE returning.
 *
 * No package installs, no extraction, no system services, no database writes.
 * A successful verification NEVER opens D-53.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectOfflineNativeSourceRelease } from './native-release-verifier.mjs';
import { verifySignedManifest } from './release.mjs';

const MAX_MANIFEST=256*1024,MAX_SIGNATURE=256,MAX_ARTIFACT=64*1024*1024;
const MAX_REDIRECTS=4;
const RELEASE_ORIGIN='https://github.com';
const ALLOWED_REDIRECT_HOSTS=new Set([
  'github.com','release-assets.githubusercontent.com','objects.githubusercontent.com',
]);
const VERSION=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const ARCH=new Set(['amd64','arm64']);

export function officialReleaseUrl(version) {
  if(typeof version!=='string'||!VERSION.test(version)||
    version.includes('..')||version.length>80)throw new TypeError('release_version_invalid');
  return RELEASE_ORIGIN+'/TheRoyalCaptain/Domyro/releases/download/v'+encodeURIComponent(version);
}
function locationUrl(value,{allowRedirect=false}={}){
  let url;
  try {url=new URL(value);}catch{throw new Error('release_source_url_invalid');}
  if(url.protocol!=='https:'||url.port||url.username||url.password||(!allowRedirect&&url.search)||
    url.hash||!ALLOWED_REDIRECT_HOSTS.has(url.hostname)){
    throw new Error('release_https_source_not_approved');
  }
  if(!allowRedirect && (url.origin!==RELEASE_ORIGIN||
      !/^\/TheRoyalCaptain\/Domyro\/releases\/download\/v/.test(url.pathname))){
    throw new Error('release_official_source_required');
  }
  return url;
}
function publisherSha(key){
  const object=createPublicKey(key);
  if(object.asymmetricKeyType!=='ed25519')throw new Error('ed25519_trust_root_required');
  return createHash('sha256').update(object.export({type:'spki',format:'der'})).digest('hex');
}
async function boundedGet(url,limit,fetcher){
  let current=locationUrl(url);
  for(let hop=0;hop<=MAX_REDIRECTS;hop++){
    let response;
    try{ response=await fetcher(current.href,{
      method:'GET',redirect:'manual',credentials:'omit',
      headers:{accept:'application/octet-stream'},
      signal:AbortSignal.timeout(20000),
    });}
    catch{throw new Error('release_download_failed');}
    if([301,302,303,307,308].includes(response.status)){
      if(hop===MAX_REDIRECTS)throw new Error('release_redirect_limit');
      const address=response.headers.get('location');
      if(!address)throw new Error('release_redirect_missing_location');
      current=locationUrl(new URL(address,current).href,{allowRedirect:true});
      await response.body?.cancel?.();
      continue;
    }
    if(response.status!==200)throw new Error('release_download_http_'+response.status);
    const length=response.headers.get('content-length');
    if(length!==null && (!/^[0-9]+$/.test(length)||Number(length)>limit||
      Number(length)<1))throw new Error('release_download_length_invalid');
    if(!response.body)throw new Error('release_download_body_missing');
    const reader=response.body.getReader();
    const chunks=[];
    let total=0;
    try{
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        if(!(value instanceof Uint8Array)||value.byteLength===0)continue;
        total+=value.byteLength;
        if(total>limit)throw new Error('release_download_size_exceeded');
        chunks.push(Buffer.from(value));
      }
    }finally{await reader.cancel().catch(()=>{});}
    if(total===0)throw new Error('release_download_empty');
    if(length!==null && total!==Number(length))throw new Error('release_download_truncated');
    return Buffer.concat(chunks,total);
  }
  throw new Error('release_redirect_limit');
}
function expectedEntryName(name) {
  return typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)&&
    name!=='release-manifest.json'&&name!=='release-manifest.sig';
}
async function privateWrite(dir,name,bytes){
  if(!expectedEntryName(name)&&!['release-manifest.json','release-manifest.sig'].includes(name)){
    throw new Error('release_download_unsafe_filename');
  }
  const fd=await open(join(dir,name),
    constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
}
/**
 * Fetch strictly the selected official VERSION, never a mutable "latest" URL.
 * Callers discover the version separately and must not trust discovery as
 * provenance. The returned package is sealed only by Ed25519+SHA-256.
 */
export async function fetchVerifiedOfficialSourceRelease({
  version,architecture,databaseSchema,trustedPublicKeyPem,
  expectedPublicKeySha256,channel='stable',fetcher=globalThis.fetch,
}={}){
  const base=officialReleaseUrl(version);
  if(!ARCH.has(architecture))throw new Error('native_architecture_unsupported');
  if(typeof fetcher!=='function')throw new TypeError('release_fetcher_invalid');
  if(!/^[a-f0-9]{64}$/.test(expectedPublicKeySha256??'')||
    publisherSha(trustedPublicKeyPem)!==expectedPublicKeySha256){
    throw new Error('release_trust_root_fingerprint_mismatch');
  }
  if(!Number.isSafeInteger(databaseSchema)||databaseSchema<0){
    throw new Error('release_database_schema_required');
  }
  if(!['stable','beta'].includes(channel))throw new Error('release_channel_invalid');
  const dir=await mkdtemp(join(tmpdir(),'domyro-source-download-'));
  let complete=false;
  try{
    const manifestBytes=await boundedGet(base+'/release-manifest.json',MAX_MANIFEST,fetcher);
    const signatureBytes=await boundedGet(base+'/release-manifest.sig',MAX_SIGNATURE,fetcher);
    const signature=signatureBytes.toString('utf8').replace(/\n$/,'');
    const manifest=verifySignedManifest({manifestBytes,signatureBase64:signature,trustedPublicKeyPem});
    if(manifest.version!==version)throw new Error('release_signed_version_mismatch');
    if(manifest.channel==='beta'&&channel!=='beta')throw new Error('release_channel_not_selected');
    if(Date.parse(manifest.publishedAt)>Date.now()+5*60_000){
      throw new Error('release_published_in_future');
    }
    if(!['amd64','arm64'].every(arch=>
       manifest.artifacts.some(a=>a.arch===arch&&a.os==='ubuntu'))||
       manifest.artifacts.length!==2)throw new Error('release_multiarch_required');
    for(const artifact of manifest.artifacts){
      if(!expectedEntryName(artifact.file)||artifact.bytes>MAX_ARTIFACT){
        throw new Error('release_artifact_invalid');
      }
    }
    await privateWrite(dir,'release-manifest.json',manifestBytes);
    await privateWrite(dir,'release-manifest.sig',signatureBytes);
    for(const artifact of manifest.artifacts){
      const contents=await boundedGet(base+'/'+artifact.file,MAX_ARTIFACT,fetcher);
      if(contents.byteLength!==artifact.bytes||
        createHash('sha256').update(contents).digest('hex')!==artifact.sha256){
        throw new Error('release_download_artifact_integrity_failed');
      }
      await privateWrite(dir,artifact.file,contents);
    }
    const verified=await inspectOfflineNativeSourceRelease({
      directory:dir,trustedPublicKeyPem,expectedPublicKeySha256,
      architecture,databaseSchema,channel,
    });
    if(verified.version!==version||verified.signatureVerified!==true||
      verified.allArtifactsVerified!==true||verified.canInstall!==false){
      throw new Error('release_unexpected_verification_result');
    }
    complete=true;
    return Object.freeze({directory:dir,version,architecture,
      manifestSha256:verified.manifestSha256,
      publisherFingerprint:verified.publisherFingerprint,
      allArtifactsVerified:true,installationAllowed:false,updateAllowed:false,
      installationGate:'D-53',source:'official_github_versioned_release'});
  }finally{
    if(!complete)await rm(dir,{recursive:true,force:true});
  }
}
