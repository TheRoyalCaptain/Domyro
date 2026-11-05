// SPDX-License-Identifier: AGPL-3.0-only
// An operator may preload signed packages for offline installations. The cache
// is NOT a trust anchor: the ordinary independent signature/hash verifier still
// runs before staging, dependency installation or service changes.
import {lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fetchVerifiedOfficialSourceRelease} from './native-release-download.mjs';

export async function selectNativeReleasePackage(inputs,{
  root='/var/lib/domyro-updater/offline',download=fetchVerifiedOfficialSourceRelease,
}={}) {
  const version=inputs?.version;
  if(typeof version!=='string'||version.length>80||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version))
    throw Error('offline_release_version_invalid');
  for(const path of [root,join(root,version)]) {
    let stat;
    try {stat=await lstat(path);}catch(e){if(e.code==='ENOENT')return download(inputs);throw e;}
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)
      throw Error('offline_release_cache_unsafe');
  }
  return {directory:join(root,version),source:'operator_preloaded_signature_unverified'};
}
