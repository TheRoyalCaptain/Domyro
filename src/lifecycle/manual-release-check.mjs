// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Explicitly invoked, local administrator-only release discovery.
 * Does not download a package, run a command, change the database or grant
 * installation permission. GitHub release metadata is NEVER a trust anchor.
 */
import { compareVersions } from './release.mjs';
import { checkLatestOfficialRelease } from './native-release-discovery.mjs';
import { INSTALLED_VERSION } from './installed-version.mjs';

const STATES=new Set([
  'no_official_release_published','newer_release_advertised',
  'already_latest','github_advertises_older_version',
]);
const MIN_INTERVAL_MS=30_000;


export function createManualReleaseChecker({
  currentVersion=INSTALLED_VERSION,discover=checkLatestOfficialRelease,
  clock=()=>Date.now(),minimumIntervalMs=MIN_INTERVAL_MS,
}={}){
  compareVersions(currentVersion,currentVersion);
  if(typeof discover!=='function'||typeof clock!=='function'||
    !Number.isSafeInteger(minimumIntervalMs)||minimumIntervalMs<1000)
    throw new TypeError('update_check_dependencies_invalid');
  let nextAllowedAt=0;
  let active=false;
  return Object.freeze({
    async check(){
      const now=clock();
      if(!Number.isSafeInteger(now)||now<0)throw new Error('update_check_clock_invalid');
      // An explicit browser check starts at most one request per interval.
      // Repeated clicks cannot create an outbound request flood.
      if(active||now<nextAllowedAt){
        return Object.freeze({
          state:'check_rate_limited',retryAfterSeconds:Math.ceil(Math.max(
            1,nextAllowedAt-now)/1000),currentVersion,latestVersion:null,
          checkedAt:null,source:'github_release_metadata_unverified',
          signedFeedConfigured:false,verifiedPublisherSignature:false,
          installAllowed:false,installationGate:'D-53',
        });
      }
      nextAllowedAt=now+minimumIntervalMs;
      active=true;
      try{
        const candidate=await discover({currentVersion});
        if(!candidate||!STATES.has(candidate.state)||
          candidate.currentVersion!==currentVersion||
          (candidate.latestVersion!==null &&
           (typeof candidate.latestVersion!=='string'||candidate.latestVersion.length>80)) ||
          (candidate.state==='no_official_release_published'&&candidate.latestVersion!==null) ||
          (candidate.state!=='no_official_release_published' &&
            (candidate.latestVersion===null||
             !Number.isInteger(compareVersions(candidate.latestVersion,currentVersion))))){
          throw new Error('update_check_discovery_invalid');
        }
        const actual=candidate.latestVersion===null?null:
          compareVersions(candidate.latestVersion,currentVersion);
        if((candidate.state==='newer_release_advertised'&&actual!==1)||
          (candidate.state==='already_latest'&&actual!==0)||
          (candidate.state==='github_advertises_older_version'&&actual!==-1)){
          throw new Error('update_check_discovery_inconsistent');
        }
        return Object.freeze({
          state:candidate.state,currentVersion,
          latestVersion:candidate.latestVersion,
          checkedAt:new Date(now).toISOString(),
          source:'github_release_metadata_unverified',
          signedFeedConfigured:false,verifiedPublisherSignature:false,
          installAllowed:false,installationGate:'D-53',
          manualInstallRequired:true,
        });
      }catch{
        // No untrusted provider payload or network error details leave the API.
        return Object.freeze({
          state:'release_check_unavailable',
          currentVersion,latestVersion:null,
          checkedAt:new Date(now).toISOString(),
          source:'github_release_metadata_unverified',
          signedFeedConfigured:false,verifiedPublisherSignature:false,
          installAllowed:false,installationGate:'D-53',
        });
      }finally{active=false;}
    },
  });
}
