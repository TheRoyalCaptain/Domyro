// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { access } from 'node:fs/promises';
import { arch } from 'node:os';
import { buildSignedSourceRelease } from '../tools/build-release.mjs';
import { rehearseNativeBundle } from '../src/lifecycle/native-rehearsal.mjs';

const architecture = arch() === 'arm64' ? 'arm64' : 'amd64';
const keys = generateKeyPairSync('ed25519');
const pem = keys.publicKey.export({format:'pem',type:'spki'});
const input = {
  projectRoot:process.cwd(),version:'0.1.1',channel:'stable',
  publishedAt:'2026-11-01T18:00:00Z',
  privateKeyPem:keys.privateKey.export({format:'pem',type:'pkcs8'}),
};
async function signed() {
  const release = await buildSignedSourceRelease(input);
  return {
    manifestBytes:release.manifestBytes,signatureBase64:release.signatureBase64,
    trustedPublicKeyPem:pem,arch:architecture,
    artifactBytes:release.artifactBytes['domyro-0.1.1-ubuntu-'+architecture+'.bundle.json'],
  };
}
test('source bundle includes all runtime modules, assets and migrations, not only 9 original files',async()=>{
  const bundle=await signed();
  const source=JSON.parse(bundle.artifactBytes.toString('utf8'));
  const paths=new Set(source.files.map(f=>f.path));
  for(const file of [
    'src/server.mjs','src/security/http-auth.mjs','src/security/credentials.mjs',
    'src/lifecycle/native-rehearsal.mjs','src/lifecycle/streamed-backup.mjs',
    'src/lifecycle/update-center.mjs','src/persistence/migrator.mjs',
    'src/persistence/migrations/003_zigbee_registry.sql',
    'web/login.html','web/assets/login.js','web/assets/login.css',
    'web/index.html','web/assets/app.js','package.json',
  ]) assert.equal(paths.has(file),true,file);
  assert.equal(paths.has('tests/native-rehearsal.test.mjs'),false);
  assert.equal(paths.has('docs/INSTALL-UPGRADE-GATE.md'),false);
  assert.ok(paths.size>30);
});
test('signed bundle actually boots local Domyro and checks HTTP pages without any host install',async()=>{
  const args=await signed();
  let sandboxPath;
  const result=await rehearseNativeBundle({...args,beforeProbe:async({sandbox})=>{
    sandboxPath=sandbox;
  }});
  assert.equal(result.result,'isolated_http_smoke_passed');
  assert.equal(result.endpointsChecked,8);
  assert.equal(result.testedArch,architecture);
  assert.equal(result.productionReady,false);
  assert.equal(result.databaseMigrated,false);
  assert.equal(result.systemServiceInstalled,false);
  assert.equal(result.gate,'D-53');
  await assert.rejects(()=>access(sandboxPath),/ENOENT/);
});
test('untrusted or damaged artifacts and failing probe never leave an install directory',async()=>{
  const args=await signed();
  const other=generateKeyPairSync('ed25519');
  await assert.rejects(()=>rehearseNativeBundle({
    ...args,trustedPublicKeyPem:other.publicKey.export({format:'pem',type:'spki'}),
  }),/signature_untrusted/);
  await assert.rejects(()=>rehearseNativeBundle({
    ...args,artifactBytes:Buffer.from('tampered source'),
  }),/artifact_hash_mismatch/);
  let temp;
  await assert.rejects(()=>rehearseNativeBundle({
    ...args,beforeProbe:async({sandbox})=>{
      temp=sandbox;
      throw new Error('simulated_preflight_failure');
    },
  }),/simulated_preflight_failure/);
  await assert.rejects(()=>access(temp),/ENOENT/);
});
test('architecture mismatch is blocked before creating a sandbox',async()=>{
  const args=await signed();
  await assert.rejects(()=>rehearseNativeBundle({
    ...args,arch:architecture==='amd64'?'arm64':'amd64',
  }),/native_architecture_mismatch/);
});
