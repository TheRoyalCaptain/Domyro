// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualReleaseChecker } from '../src/lifecycle/manual-release-check.mjs';

const version='0.1.0-dev.1';
const github=(latestVersion,state='newer_release_advertised')=>({
  state,currentVersion:version,latestVersion,
  verifiedPublisher:false,installAllowed:false,
});
const stamp=Date.parse('2026-11-02T18:00:00Z');
test('explicit check returns untrusted GitHub version, never an update authorization',async()=>{
  let calls=0;
  const service=createManualReleaseChecker({
    clock:()=>stamp,
    discover:async({currentVersion})=>{
      calls++;assert.equal(currentVersion,version);
      return github('0.1.1');
    },
  });
  const result=await service.check();
  assert.equal(result.state,'newer_release_advertised');
  assert.equal(result.latestVersion,'0.1.1');
  assert.equal(result.checkedAt,new Date(stamp).toISOString());
  assert.equal(result.source,'github_release_metadata_unverified');
  assert.equal(result.signedFeedConfigured,false);
  assert.equal(result.verifiedPublisherSignature,false);
  assert.equal(result.installAllowed,false);
  assert.equal(result.installationGate,'D-53');
  assert.equal(calls,1);
});
test('manual checks cannot flood the release API and never check in background',async()=>{
  let current=stamp,calls=0;
  const service=createManualReleaseChecker({
    clock:()=>current,minimumIntervalMs:30_000,
    discover:async()=>{calls++;return github('0.1.1');},
  });
  assert.equal(calls,0);
  assert.equal((await service.check()).state,'newer_release_advertised');
  const limited=await service.check();
  assert.equal(limited.state,'check_rate_limited');
  assert.equal(limited.retryAfterSeconds,30);
  assert.equal(limited.installAllowed,false);
  assert.equal(calls,1);
  current+=30_000;
  assert.equal((await service.check()).state,'newer_release_advertised');
  assert.equal(calls,2);
});
test('simultaneous checks are single-flight blocked, with no duplicated requests',async()=>{
  let release;
  let calls=0;
  const service=createManualReleaseChecker({
    clock:()=>stamp,
    discover:async()=>{
      calls++;
      return new Promise(resolve=>{release=resolve;});
    },
  });
  const pending=service.check();
  const other=await service.check();
  assert.equal(other.state,'check_rate_limited');
  release(github('0.1.1'));
  assert.equal((await pending).state,'newer_release_advertised');
  assert.equal(calls,1);
});
test('404/no public release, equivalent version, older version have honest read-only states',async()=>{
  for(const [candidate,expected] of [
    [github(null,'no_official_release_published'),'no_official_release_published'],
    [github(version,'already_latest'),'already_latest'],
    [github('0.0.9','github_advertises_older_version'),'github_advertises_older_version'],
  ]){
    const result=await createManualReleaseChecker({
      clock:()=>stamp,discover:async()=>candidate,
    }).check();
    assert.equal(result.state,expected);
    assert.equal(result.installAllowed,false);
  }
});
test('untrusted malformed or contradictory version data never reaches the UI',async()=>{
  for(const candidate of [
    github('../../etc/passwd'),github('0.1.1','already_latest'),
    github('0.0.1','newer_release_advertised'),
    github('0.1.2','no_official_release_published'),
    {...github('0.1.2'),currentVersion:'0.1.2'},
    {state:'installed',currentVersion:version,latestVersion:'0.1.2'},
    null,
  ]){
    const result=await createManualReleaseChecker({
      clock:()=>stamp,discover:async()=>candidate,
    }).check();
    assert.equal(result.state,'release_check_unavailable');
    assert.equal(result.latestVersion,null);
    assert.equal(result.installAllowed,false);
  }
});
test('release provider failure is not exposed and cannot install or restart',async()=>{
  const result=await createManualReleaseChecker({
    clock:()=>stamp,
    discover:async()=>{throw Error('SECRET_DO_NOT_REFLECT');},
  }).check();
  assert.equal(result.state,'release_check_unavailable');
  assert.equal(JSON.stringify(result).includes('SECRET_DO_NOT_REFLECT'),false);
  assert.equal(result.installAllowed,false);
});
test('reject invalid dependency/clock before outbound network activity',async()=>{
  assert.throws(()=>createManualReleaseChecker({minimumIntervalMs:-1}),
    /update_check_dependencies_invalid/);
  assert.throws(()=>createManualReleaseChecker({discover:null}),
    /update_check_dependencies_invalid/);
  const checker=createManualReleaseChecker({
    clock:()=>Infinity,
    discover:async()=>{throw Error('should not run');},
  });
  await assert.rejects(checker.check(),/update_check_clock_invalid/);
});
