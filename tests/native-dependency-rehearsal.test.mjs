// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {access} from 'node:fs/promises';
import {arch as hostArch} from 'node:os';
import {buildSignedSourceRelease} from '../tools/build-release.mjs';
import {rehearseLockedDependencies} from '../src/lifecycle/native-dependency-rehearsal.mjs';
const enabled=process.env.DOMYRO_NATIVE_DEPS_TEST==='1';
const arch=hostArch()==='arm64'?'arm64':'amd64';
const pair=generateKeyPairSync('ed25519');
async function signed(){
  const signed=await buildSignedSourceRelease({
    projectRoot:process.cwd(),version:'0.2.1',channel:'stable',
    publishedAt:'2026-11-01T21:45:00Z',
    privateKeyPem:pair.privateKey.export({format:'pem',type:'pkcs8'}),
  });
  return {
    manifestBytes:signed.manifestBytes,signatureBase64:signed.signatureBase64,
    trustedPublicKeyPem:pair.publicKey.export({format:'pem',type:'spki'}),
    artifactBytes:signed.artifactBytes['domyro-0.2.1-ubuntu-'+arch+'.bundle.json'],arch,
  };
}
test('signed source bundle can npm ci exact runtime dependencies on native architecture', {skip:!enabled},async()=>{
  const args=await signed();
  let scratch;
  const state=await rehearseLockedDependencies({...args,onInstalled:async({sandbox})=>{scratch=sandbox;}});
  assert.equal(state.result,'isolated_locked_runtime_dependencies_passed');
  assert.equal(state.lockIntegrityEnforced,true);
  assert.equal(state.hostSoftwareInstalled,false);
  assert.equal(state.installationApproved,false);
  assert.equal(state.gate,'D-53');
  assert.deepEqual(state.dependencies,['@node-rs/argon2','mqtt','pg']);
  await assert.rejects(()=>access(scratch),/ENOENT/);
});
test('untrusted or tampered package archive cannot reach npm at all',async()=>{
  const args=await signed();
  const other=generateKeyPairSync('ed25519');
  await assert.rejects(()=>rehearseLockedDependencies({
    ...args,trustedPublicKeyPem:other.publicKey.export({format:'pem',type:'spki'}),
  }),/signature_untrusted/);
  await assert.rejects(()=>rehearseLockedDependencies({
    ...args,artifactBytes:Buffer.from('untrusted package with lockfile'),
  }),/artifact_hash_mismatch/);
  await assert.rejects(()=>rehearseLockedDependencies({...args,
    arch:arch==='amd64'?'arm64':'amd64'}),/sandbox_architecture_mismatch/);
});
