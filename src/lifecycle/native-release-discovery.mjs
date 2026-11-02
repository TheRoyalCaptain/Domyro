// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Untrusted GitHub discovery + independently authenticated source downloads.
 * The release API only proposes a version string; never trust its contents
 * as a signature, install approval, or anti-rollback high-water mark.
 */
import { compareVersions } from './release.mjs';
import { fetchVerifiedOfficialSourceRelease } from './native-release-download.mjs';

const API='https://api.github.com/repos/TheRoyalCaptain/Domyro/releases/latest';
const VERSION=/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const LIMIT=32*1024;

export async function checkLatestOfficialRelease({
  currentVersion,fetcher=globalThis.fetch,
}={}){
  compareVersions(currentVersion,currentVersion);
  if(typeof fetcher!=='function')throw new TypeError('release_api_fetcher_invalid');
  let response;
  try{
    response=await fetcher(API,{method:'GET',redirect:'error',
      credentials:'omit',headers:{accept:'application/vnd.github+json'},
      signal:AbortSignal.timeout(10000)});
  }catch{throw new Error('release_discovery_unavailable');}
  if(response.status===404){
    return Object.freeze({state:'no_official_release_published',
      currentVersion,latestVersion:null,verifiedPublisher:false,installAllowed:false});
  }
  if(response.status!==200)throw new Error('release_discovery_http_'+response.status);
  const length=response.headers.get('content-length');
  if(length && (!/^[0-9]+$/.test(length)||Number(length)>LIMIT))
    throw new Error('release_discovery_size_invalid');
  if(!response.body)throw new Error('release_discovery_empty');
  const reader=response.body.getReader();
  let size=0;
  const parts=[];
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>LIMIT)throw new Error('release_discovery_size_invalid');
      parts.push(Buffer.from(value));
    }
  }finally{await reader.cancel().catch(()=>{});}
  let data;
  try{data=JSON.parse(Buffer.concat(parts).toString('utf8'));}
  catch{throw new Error('release_discovery_invalid_json');}
  if(data?.draft===true||data?.prerelease===true||
     typeof data?.tag_name!=='string'||!VERSION.test(data.tag_name)){
    throw new Error('release_discovery_invalid_tag');
  }
  const latestVersion=data.tag_name.slice(1);
  const relation=compareVersions(latestVersion,currentVersion);
  return Object.freeze({
    state:relation>0?'newer_release_advertised':
      relation===0?'already_latest':'github_advertises_older_version',
    currentVersion,latestVersion,verifiedPublisher:false,
    installAllowed:false,updateAllowed:false,gate:'D-53',
  });
}
/**
 * Only verified signed bytes may cross the recommendation → download boundary.
 * The returned directory is still NOT an installer or an update permission.
 */
export async function downloadLatestIfAuthenticated({
  currentVersion,architecture,databaseSchema,trustedPublicKeyPem,
  expectedPublicKeySha256,fetcher=globalThis.fetch,releaseFetch=globalThis.fetch,
}={}){
  const candidate=await checkLatestOfficialRelease({currentVersion,fetcher});
  if(candidate.state!=='newer_release_advertised'){
    return Object.freeze({...candidate,downloaded:false});
  }
  const verified=await fetchVerifiedOfficialSourceRelease({
    version:candidate.latestVersion,architecture,databaseSchema,
    trustedPublicKeyPem,expectedPublicKeySha256,fetcher:releaseFetch,
  });
  return Object.freeze({...candidate,state:'newer_release_download_verified',
    verifiedPublisher:true,downloaded:true,
    directory:verified.directory,manifestSha256:verified.manifestSha256,
    publisherFingerprint:verified.publisherFingerprint,
    installAllowed:false,updateAllowed:false,
  });
}
