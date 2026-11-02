// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLatestOfficialRelease,downloadLatestIfAuthenticated } from '../src/lifecycle/native-release-discovery.mjs';
const result=(tag_name,overrides={})=>new Response(JSON.stringify({
  tag_name,draft:false,prerelease:false,...overrides,
}),{status:200,headers:{'content-type':'application/json'}});
test('latest release API returns only an unauthenticated candidate, NEVER installation approval',async()=>{
  for(const [tag,state] of [
    ['v1.2.4','newer_release_advertised'],
    ['v1.2.3','already_latest'],
    ['v1.2.2','github_advertises_older_version'],
  ]){
    let urlSeen;
    const candidate=await checkLatestOfficialRelease({
      currentVersion:'1.2.3',
      fetcher:async (url,options)=>{
        urlSeen=url;
        assert.equal(options.method,'GET');
        assert.equal(options.redirect,'error');
        assert.equal(options.credentials,'omit');
        return result(tag);
      },
    });
    assert.equal(urlSeen,'https://api.github.com/repos/TheRoyalCaptain/Domyro/releases/latest');
    assert.equal(candidate.state,state);
    assert.equal(candidate.verifiedPublisher,false);
    assert.equal(candidate.installAllowed,false);
    assert.equal(candidate.latestVersion,tag.slice(1));
  }
});
test('draft, prerelease, unsafe tags and redirects are never trusted as stable releases',async()=>{
  for(const data of [
    result('v1.2.4',{draft:true}),result('v1.2.4',{prerelease:true}),
    result('../../v1.2.4'),result('1.2.4'),result('v1.2.4-beta.1'),
    result('v1.2.4/../../evil'),result('v999999999999999999999.1.1'),
  ]){
    await assert.rejects(checkLatestOfficialRelease({currentVersion:'1.2.3',
      fetcher:async()=>data}),/release_discovery_invalid_tag|version component too large/);
  }
});
test('missing published official release is safe and never triggers a release-asset download',async()=>{
  let downloaded=0;
  const output=await downloadLatestIfAuthenticated({
    currentVersion:'1.2.3',
    fetcher:async()=>new Response(null,{status:404}),
    releaseFetch:async()=>{downloaded++;throw Error('not allowed');},
  });
  assert.equal(output.state,'no_official_release_published');
  assert.equal(output.downloaded,false);
  assert.equal(output.installAllowed,false);
  assert.equal(downloaded,0);
});
test('already up-to-date may not contact artifact URLs or trust mutable tags',async()=>{
  let released=0;
  const output=await downloadLatestIfAuthenticated({
    currentVersion:'1.2.3',
    fetcher:async()=>result('v1.2.3'),
    releaseFetch:async()=>{released++;throw Error('not allowed');},
  });
  assert.equal(output.state,'already_latest');
  assert.equal(output.downloaded,false);
  assert.equal(released,0);
});
test('API failures, malformed JSON and oversized body fail before any update attempt',async()=>{
  await assert.rejects(checkLatestOfficialRelease({currentVersion:'1.2.3',
    fetcher:async()=>{throw Error('network down');}}),/release_discovery_unavailable/);
  await assert.rejects(checkLatestOfficialRelease({currentVersion:'1.2.3',
    fetcher:async()=>new Response('?',{status:200})}),/release_discovery_invalid_json/);
  await assert.rejects(checkLatestOfficialRelease({currentVersion:'1.2.3',
    fetcher:async()=>new Response('x'.repeat(33000),{status:200})}),/release_discovery_size_invalid/);
  await assert.rejects(checkLatestOfficialRelease({currentVersion:'1.2.3',
    fetcher:async()=>new Response(null,{status:502})}),/release_discovery_http_502/);
});
test('a forged new version can only proceed to download after a real pinned publisher fingerprint',async()=>{
  let assetRequests=0;
  await assert.rejects(downloadLatestIfAuthenticated({
    currentVersion:'0.1.1',architecture:'amd64',databaseSchema:3,
    trustedPublicKeyPem:'not-an-ed25519-key',expectedPublicKeySha256:'a'.repeat(64),
    fetcher:async()=>result('v0.1.2'),
    releaseFetch:async()=>{assetRequests++;return result('v0.1.2');},
  }));
  assert.equal(assetRequests,0);
});
