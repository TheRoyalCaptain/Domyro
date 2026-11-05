// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Verified, OFFLINE, source-only preparation for an upcoming native release.
 * This can never restart systemd, run npm, touch PostgreSQL, or install.
 *
 * Publisher trust MUST be pinned separately from the release directory.
 */
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {inspectOfflineNativeSourceRelease} from './native-release-verifier.mjs';
import {stageVerifiedBundle,inspectVerifiedStagedBundle} from './transactional-release.mjs';
import {compareVersions} from './release.mjs';

const LIMIT=64*1024*1024;
async function readImmutableFile(directory,name,expectedSha=null){
  const path=join(directory,name);
  const info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||
    (info.mode&0o022)!==0||info.size<1||info.size>LIMIT||
    (typeof process.getuid==='function'&&info.uid!==process.getuid())){
    throw new Error('signed_prepare_file_unsafe');
  }
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await fd.stat();
    if(before.ino!==info.ino||before.dev!==info.dev||
      before.size!==info.size)throw new Error('signed_prepare_file_changed');
    const bytes=await fd.readFile();
    const after=await fd.stat();
    if(after.ino!==info.ino||after.size!==info.size||
       (expectedSha!==null&&createHash('sha256').update(bytes).digest('hex')!==expectedSha)){
      throw new Error('signed_prepare_file_changed');
    }
    const again=await lstat(path);
    if(again.ino!==info.ino||again.dev!==info.dev||again.size!==info.size||
      !again.isFile()||again.isSymbolicLink()){
      throw new Error('signed_prepare_file_changed');
    }
    return bytes;
  }finally{await fd.close();}
}
function verifyVersionedSnapshot(artifactBytes,version){
  let bundle;
  try{bundle=JSON.parse(artifactBytes.toString('utf8'));}
  catch{throw new Error('signed_prepare_bundle_invalid');}
  if(!bundle||bundle.schemaVersion!==1||!Array.isArray(bundle.files)||
     bundle.files.length>1500)throw new Error('signed_prepare_bundle_invalid');
  const byPath=new Map();
  for(const item of bundle.files){
    if(typeof item?.path!=='string'||typeof item?.base64!=='string'||
      byPath.has(item.path))throw new Error('signed_prepare_bundle_invalid');
    byPath.set(item.path,item.base64);
  }
  let pkg,lock;
  try{
    const parse=(name)=>JSON.parse(Buffer.from(byPath.get(name),'base64').toString('utf8'));
    pkg=parse('package.json');lock=parse('package-lock.json');
  }catch{throw new Error('signed_prepare_package_metadata_invalid');}
  if(pkg.name!=='domyro'||pkg.version!==version||
     lock.name!=='domyro'||lock.lockfileVersion!==3||
     lock.version!==version||lock.packages?.['']?.name!=='domyro'||
     lock.packages[''].version!==version||
     !['src/server.mjs','src/security/http-auth.mjs','src/lifecycle/installed-version.mjs',
       'web/index.html','web/login.html','scripts/domyro-release.mjs']
       .every(x=>byPath.has(x))){
    throw new Error('signed_prepare_package_version_or_runtime_mismatch');
  }
}
/**
 * Produces a source-only staged release in a caller-owned isolated store.
 * No active pointer is switched and no OS dependency is installed.
 */
export async function prepareVerifiedNativeSource({
  directory,stageRoot,trustedPublicKeyPem,expectedPublicKeySha256,
  architecture,databaseSchema,currentVersion,channel='stable',
  now=new Date(),
}={}){
  if(typeof currentVersion!=='string')throw new Error('signed_prepare_current_version_required');
  compareVersions(currentVersion,currentVersion);
  if(typeof stageRoot!=='string'||!stageRoot.startsWith('/')||
     stageRoot==='/'||stageRoot===process.cwd())throw new Error('signed_prepare_stage_root_invalid');
  const verified=await inspectOfflineNativeSourceRelease({
    directory,trustedPublicKeyPem,expectedPublicKeySha256,
    architecture,databaseSchema,channel,now,
  });
  if(compareVersions(verified.version,currentVersion)<=0){
    throw new Error('signed_prepare_downgrade_or_equal_version_refused');
  }
  const manifestBytes=await readImmutableFile(directory,'release-manifest.json',
    verified.manifestSha256);
  const signatureBytes=await readImmutableFile(directory,'release-manifest.sig');
  const artifact=verified.verifiedArtifacts.find(x=>x.architecture===architecture);
  if(!artifact)throw new Error('signed_prepare_architecture_missing');
  const artifactBytes=await readImmutableFile(directory,artifact.file,artifact.sha256);
  verifyVersionedSnapshot(artifactBytes,verified.version);
  const staged=await stageVerifiedBundle({
    root:stageRoot,manifestBytes,
    signatureBase64:signatureBytes.toString('utf8').replace(/\n$/,''),
    trustedPublicKeyPem,artifactBytes,arch:architecture,
  });
  const checked=await inspectVerifiedStagedBundle({
    root:stageRoot,version:verified.version,
    trustedPublicKeyPem,expectedArch:architecture,
  });
  if(!checked.verified||checked.version!==verified.version||
     checked.files!==staged.files){
    throw new Error('signed_prepare_stage_verification_failed');
  }
  return Object.freeze({
    status:'verified_source_staged',version:verified.version,
    architecture,files:checked.files,
    signedManifestSha256:verified.manifestSha256,
    publisherFingerprint:verified.publisherFingerprint,
    stageDirectory:join(stageRoot,'releases',verified.version),
    officialProductionInstallAllowed:false,
    nativeServiceUpdated:false,databaseModified:false,
    stageOnly:true,installationGate:'D-53',
  });
}
