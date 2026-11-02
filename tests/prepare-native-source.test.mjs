// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildSignedSourceRelease,writeSignedRelease} from '../tools/build-release.mjs';
import {prepareVerifiedNativeSource} from '../src/lifecycle/prepare-native-source.mjs';
import {inspectActiveBundle,inspectVerifiedStagedBundle} from '../src/lifecycle/transactional-release.mjs';

const pair=generateKeyPairSync('ed25519');
const publicKey=pair.publicKey.export({type:'spki',format:'pem'});
const fingerprint=createHash('sha256').update(
  pair.publicKey.export({type:'spki',format:'der'})).digest('hex');
const baseline={
  trustedPublicKeyPem:publicKey,expectedPublicKeySha256:fingerprint,
  architecture:'amd64',databaseSchema:3,currentVersion:'0.1.0-dev.1',
  now:new Date('2026-11-02T22:00:00Z'),
};
async function setup(t){
  const tmp=await mkdtemp(join(tmpdir(),'domyro-signed-native-stage-'));
  t.after(()=>rm(tmp,{recursive:true,force:true}));
  const directory=join(tmp,'signed');
  const signed=await buildSignedSourceRelease({
    projectRoot:process.cwd(),version:'0.1.1',channel:'stable',
    publishedAt:'2026-10-31T12:00:00Z',
    privateKeyPem:pair.privateKey.export({type:'pkcs8',format:'pem'}),
  });
  await writeSignedRelease(directory,signed);
  return {tmp,directory,signed,stageRoot:join(tmp,'staged')};
}
test('complete independently pinned signed source package becomes inert staged native release',async t=>{
  const {directory,stageRoot}=await setup(t);
  const result=await prepareVerifiedNativeSource({directory,stageRoot,...baseline});
  assert.equal(result.status,'verified_source_staged');
  assert.equal(result.version,'0.1.1');
  assert.equal(result.stageOnly,true);
  assert.equal(result.officialProductionInstallAllowed,false);
  assert.equal(result.nativeServiceUpdated,false);
  assert.equal(result.databaseModified,false);
  assert.equal(result.installationGate,'D-53');
  assert.equal(result.publisherFingerprint,fingerprint);
  assert.equal(await inspectActiveBundle(stageRoot),null);
  const pkg=JSON.parse(await readFile(join(result.stageDirectory,'package.json'),'utf8'));
  const lock=JSON.parse(await readFile(join(result.stageDirectory,'package-lock.json'),'utf8'));
  assert.equal(pkg.version,'0.1.1');
  assert.equal(lock.version,'0.1.1');
  assert.equal((await inspectVerifiedStagedBundle({
    root:stageRoot,version:'0.1.1',trustedPublicKeyPem:publicKey,
    expectedArch:'amd64',
  })).verified,true);
  await assert.rejects(()=>prepareVerifiedNativeSource({
    directory,stageRoot,...baseline,
  }),/release_already_staged/);
});
test('offline staging rejects forged public fingerprint and never writes a staging root',async t=>{
  const {directory,stageRoot}=await setup(t);
  await assert.rejects(()=>prepareVerifiedNativeSource({directory,stageRoot,
    ...baseline,expectedPublicKeySha256:'a'.repeat(64),
  }),/publisher_key_fingerprint_mismatch/);
  await assert.rejects(readdir(stageRoot),{code:'ENOENT'});
});
test('offline signed source preparation refuses downgrades, equal versions and wrong schema',async t=>{
  const {directory,stageRoot}=await setup(t);
  await assert.rejects(()=>prepareVerifiedNativeSource({
    directory,stageRoot,...baseline,currentVersion:'0.1.1',
  }),/downgrade_or_equal/);
  await assert.rejects(()=>prepareVerifiedNativeSource({
    directory,stageRoot,...baseline,currentVersion:'0.1.2',
  }),/downgrade_or_equal/);
  await assert.rejects(()=>prepareVerifiedNativeSource({
    directory,stageRoot,...baseline,databaseSchema:900,
  }),/release_database_migration_not_yet_supported/);
  await assert.rejects(readdir(stageRoot),{code:'ENOENT'});
});
test('corrupted artifact is rejected before creating a staged directory',async t=>{
  const {directory,stageRoot}=await setup(t);
  await writeFile(join(directory,'domyro-0.1.1-ubuntu-amd64.bundle.json'),'altered');
  await assert.rejects(()=>prepareVerifiedNativeSource({
    directory,stageRoot,...baseline,
  }),/release_artifact_hash_mismatch|release_file_unsafe_or_size_mismatch/);
  await assert.rejects(readdir(stageRoot),{code:'ENOENT'});
});
