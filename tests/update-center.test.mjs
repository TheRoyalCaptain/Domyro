// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  normalizeUpdatePreferences, assessSignedUpdateCandidate, getDevelopmentUpdateStatus,
} from '../src/lifecycle/update-center.mjs';

const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const pem=publicKey.export({format:'pem',type:'spki'});
function candidate({
  version='0.1.1', channel='stable', publishedAt='2026-10-31T12:00:00Z',
  min=3,max=3,target=3,migration='none',arch='amd64',
}={}){
  const artifact=Buffer.from('disposable signed bundle');
  const manifestBytes=Buffer.from(JSON.stringify({
    schemaVersion:1,version,channel,publishedAt,
    database:{min,max,target,migration},
    artifacts:[{
      os:'ubuntu',arch,file:'domyro-test.bundle.json',bytes:artifact.length,
      sha256:createHash('sha256').update(artifact).digest('hex'),
    }],
  }));
  return {manifestBytes,signatureBase64:sign(null,manifestBytes,privateKey).toString('base64'),trustedPublicKeyPem:pem};
}
const base={
  currentVersion:'0.1.0',os:'ubuntu',arch:'amd64',currentDatabaseSchema:3,
  now:new Date('2026-11-01T12:00:00Z'),
};
test('default preferences never allow automatic installation',()=>{
  const p=normalizeUpdatePreferences();
  assert.equal(p.automaticChecks,true);
  assert.equal(p.automaticDownloads,false);
  assert.equal(p.automaticInstall,false);
  assert.equal(p.manualInstallRequired,true);
  assert.throws(()=>normalizeUpdatePreferences({automaticChecks:false,automaticDownloads:true}),/automatic_checks/);
  assert.throws(()=>normalizeUpdatePreferences({automaticInstall:true,downloadDelayHours:800}),/update_preferences_invalid/);
  assert.throws(()=>normalizeUpdatePreferences({channel:'nightly'}),/update_preferences_invalid/);
});
test('a signed stable release can appear as available without installing or downloading',()=>{
  const outcome=assessSignedUpdateCandidate({...base,...candidate()});
  assert.equal(outcome.state,'update_available');
  assert.equal(outcome.targetVersion,'0.1.1');
  assert.equal(outcome.verifiedPublisherSignature,true);
  assert.equal(outcome.installAllowed,false);
  assert.equal(outcome.mayDownloadAutomatically,false);
});
test('12-hour release age delays affect downloading only, never installing',()=>{
  const signed=candidate({publishedAt:'2026-11-01T06:00:00Z'});
  const opts={automaticChecks:true,automaticDownloads:true,downloadDelayHours:12};
  const before=assessSignedUpdateCandidate({...base,...signed,preferences:opts});
  assert.equal(before.state,'scheduled_for_download');
  assert.equal(before.eligibleAt,'2026-11-01T18:00:00.000Z');
  assert.equal(before.mayDownloadAutomatically,false);
  const after=assessSignedUpdateCandidate({...base,...signed,
    now:new Date('2026-11-01T19:00:00Z'),preferences:opts});
  assert.equal(after.state,'download_eligible');
  assert.equal(after.mayDownloadAutomatically,true);
  assert.equal(after.installAllowed,false);
});
test('wrong key, tampered manifest, unsupported DB or arch remain blocked',()=>{
  const signed=candidate();
  const {publicKey:other}=generateKeyPairSync('ed25519');
  assert.equal(assessSignedUpdateCandidate({...base,...signed,
    trustedPublicKeyPem:other.export({format:'pem',type:'spki'})}).state,'untrusted_release');
  assert.equal(assessSignedUpdateCandidate({...base,...signed,
    manifestBytes:Buffer.from(signed.manifestBytes.toString()+' ')}).state,'untrusted_release');
  assert.ok(assessSignedUpdateCandidate({...base,...candidate({migration:'irreversible',target:4,min:3,max:4})})
    .blockers.includes('migration_not_proven_safe'));
  assert.ok(assessSignedUpdateCandidate({...base,...candidate({arch:'arm64'})})
    .blockers.includes('artifact_for_host_missing'));
  assert.ok(assessSignedUpdateCandidate({...base,...candidate({min:4,max:5,target:4})})
    .blockers.includes('schema_incompatible'));
});
test('stable channel excludes beta release; older versions and future timestamps not offered',()=>{
  const beta=candidate({version:'0.1.2-beta.1',channel:'beta'});
  const got=assessSignedUpdateCandidate({...base,...beta});
  assert.equal(got.state,'unsupported');
  assert.ok(got.blockers.includes('channel_not_selected'));
  const allowed=assessSignedUpdateCandidate({...base,...beta,preferences:{channel:'beta'}});
  assert.equal(allowed.state,'update_available');
  assert.equal(assessSignedUpdateCandidate({...base,...candidate({version:'0.0.9'})}).state,'up_to_date');
  assert.ok(assessSignedUpdateCandidate({...base,...candidate({publishedAt:'2026-11-03T10:00:00Z'})})
    .blockers.includes('release_in_future'));
});
test('unconfigured project update center must never pretend install is enabled',()=>{
  const state=getDevelopmentUpdateStatus();
  assert.equal(state.installAllowed,false);
  assert.equal(state.signedFeedConfigured,false);
  assert.equal(state.manualInstallerImplemented,false);
  assert.equal(state.installationGate,'D-53');
  assert.ok(state.blockers.length);
});
