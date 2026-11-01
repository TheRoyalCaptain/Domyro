// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {arch as hostArch} from 'node:os';
import {buildSignedSourceRelease} from '../tools/build-release.mjs';
import {rehearseManualUpdate} from '../src/lifecycle/native-update-rehearsal.mjs';

const arch=hostArch()==='arm64'?'arm64':'amd64';
const keys=generateKeyPairSync('ed25519');
const pem=keys.publicKey.export({format:'pem',type:'spki'});
async function source(version){
  const signed=await buildSignedSourceRelease({
    projectRoot:process.cwd(),version,channel:'stable',
    publishedAt:'2026-11-01T22:00:00Z',
    privateKeyPem:keys.privateKey.export({format:'pem',type:'pkcs8'}),
  });
  return {
    manifestBytes:signed.manifestBytes,signatureBase64:signed.signatureBase64,
    artifactBytes:signed.artifactBytes['domyro-'+version+'-ubuntu-'+arch+'.bundle.json'],
  };
}
test('isolated manual update switches from real healthy old process to new process',async()=>{
  const oldRelease=await source('0.2.2'),newRelease=await source('0.2.3');
  const got=await rehearseManualUpdate({
    oldRelease,newRelease,trustedPublicKeyPem:pem,arch,
    confirmedVersion:'0.2.3',
  });
  assert.equal(got.state,'candidate_process_healthy');
  assert.equal(got.activeVersion,'0.2.3');
  assert.equal(got.rolledBack,false);
  assert.equal(got.processRestarted,true);
  assert.equal(got.systemdActivated,false);
  assert.equal(got.productionApproval,false);
});
test('injected bad candidate health restores pointer and restarts the previous real process',async()=>{
  const oldRelease=await source('0.2.2'),newRelease=await source('0.2.3');
  const got=await rehearseManualUpdate({
    oldRelease,newRelease,trustedPublicKeyPem:pem,arch,
    confirmedVersion:'0.2.3',candidateFailure:true,
  });
  assert.equal(got.state,'rollback_and_old_process_recovered');
  assert.equal(got.activeVersion,'0.2.2');
  assert.equal(got.rolledBack,true);
  assert.equal(got.previousProcessRecovered,true);
  assert.equal(got.productionApproval,false);
});
test('explicit version confirmation and signed metadata remain mandatory',async()=>{
  const oldRelease=await source('0.2.2'),newRelease=await source('0.2.3');
  await assert.rejects(()=>rehearseManualUpdate({
    oldRelease,newRelease,trustedPublicKeyPem:pem,arch,
    confirmedVersion:'0.2.4',
  }),/explicit_version_confirmation_required/);
  await assert.rejects(()=>rehearseManualUpdate({
    oldRelease,newRelease:{...newRelease,artifactBytes:Buffer.from('tamper')},
    trustedPublicKeyPem:pem,arch,confirmedVersion:'0.2.3',
  }),/artifact_hash_mismatch/);
});
