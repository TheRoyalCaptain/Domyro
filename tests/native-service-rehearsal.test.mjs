// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {access,readFile,stat,writeFile} from 'node:fs/promises';
import {arch as hostArch} from 'node:os';
import {join} from 'node:path';
import {buildSignedSourceRelease} from '../tools/build-release.mjs';
import {rehearseNativeServiceLayout} from '../src/lifecycle/native-service-rehearsal.mjs';

const arch=hostArch()==='arm64'?'arm64':'amd64';
const key=generateKeyPairSync('ed25519');
async function signed(){
  const doc=await buildSignedSourceRelease({
    projectRoot:process.cwd(),version:'0.2.0',channel:'stable',
    publishedAt:'2026-11-01T21:30:00Z',
    privateKeyPem:key.privateKey.export({format:'pem',type:'pkcs8'}),
  });
  return {
    manifestBytes:doc.manifestBytes,signatureBase64:doc.signatureBase64,
    trustedPublicKeyPem:key.publicKey.export({format:'pem',type:'spki'}),
    artifactBytes:doc.artifactBytes['domyro-0.2.0-ubuntu-'+arch+'.bundle.json'],arch,
  };
}
test('signed release creates idempotent Ubuntu-like sandbox layout and starts a separate Node process twice',async()=>{
  const args=await signed();
  let root;
  const result=await rehearseNativeServiceLayout({...args,onPrepared:async({sandbox,release,unitPath})=>{
    root=sandbox;
    const unit=await readFile(unitPath,'utf8');
    assert.match(unit,/ProtectSystem=strict/);
    assert.match(unit,/DOMYRO_HOST=127\.0\.0\.1/);
    assert.equal((await stat(join(sandbox,'var/lib/domyro'))).mode&0o077,0);
    assert.equal((await readFile(join(release,'package.json'),'utf8')).includes('"name": "domyro"'),true);
  }});
  assert.equal(result.result,'native_service_layout_rehearsal_passed');
  assert.equal(result.idempotentLayout,true);
  assert.equal(result.restartProbed,true);
  assert.equal(result.systemdUnitDraftWritten,true);
  assert.equal(result.systemdUnitActivated,false);
  assert.equal(result.hostModified,false);
  assert.equal(result.installationApproved,false);
  await assert.rejects(()=>access(root),/ENOENT/);
});
test('bad release key and corrupted artifacts cannot create a service',async()=>{
  const args=await signed();
  const other=generateKeyPairSync('ed25519');
  await assert.rejects(()=>rehearseNativeServiceLayout({
    ...args,trustedPublicKeyPem:other.publicKey.export({format:'pem',type:'spki'}),
  }),/signature_untrusted/);
  await assert.rejects(()=>rehearseNativeServiceLayout({
    ...args,artifactBytes:Buffer.from('corrupt bundled data'),
  }),/artifact_hash_mismatch/);
});
test('exception during layout validation cleans all scratch service files',async()=>{
  const args=await signed();
  let tmp;
  await assert.rejects(()=>rehearseNativeServiceLayout({...args,onPrepared:async({sandbox})=>{
    tmp=sandbox;throw new Error('simulated_service_install_failure');
  }}),/simulated_service_install_failure/);
  await assert.rejects(()=>access(tmp),/ENOENT/);
});
test('unsupported native architecture is rejected',async()=>{
  const args=await signed();
  await assert.rejects(()=>rehearseNativeServiceLayout({
    ...args,arch:arch==='amd64'?'arm64':'amd64',
  }),/native_architecture_mismatch/);
});

test('modifying signed source after layout but before launch fails closed and cleans sandbox',async()=>{
  const args=await signed();
  let temp;
  await assert.rejects(()=>rehearseNativeServiceLayout({
    ...args,onPrepared:async({sandbox,release})=>{
      temp=sandbox;
      await writeFile(join(release,'src/server.mjs'),'// injected untrusted code\n',{mode:0o600});
    },
  }),/staged_release_file_changed/);
  await assert.rejects(()=>access(temp),/ENOENT/);
});
test('tampering with prepared unit is detected before the test process starts',async()=>{
  const args=await signed();
  let temp;
  await assert.rejects(()=>rehearseNativeServiceLayout({
    ...args,onPrepared:async({sandbox,unitPath})=>{
      temp=sandbox;
      await writeFile(unitPath,'[Service]\nExecStart=/tmp/untrusted\n',{mode:0o600});
    },
  }),/rehearsal_existing_file_changed/);
  await assert.rejects(()=>access(temp),/ENOENT/);
});
test('adding unlisted code to signed release fails even if signed files are intact',async()=>{
  const args=await signed();
  await assert.rejects(()=>rehearseNativeServiceLayout({
    ...args,onPrepared:async({release})=>{
      await writeFile(join(release,'src/surprise.mjs'),'export const unsafe = true;\n',{mode:0o600});
    },
  }),/staged_release_unlisted_file/);
});
