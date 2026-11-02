// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { chmod, link, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSignedSourceRelease, writeSignedRelease } from '../tools/build-release.mjs';
import { inspectOfflineNativeSourceRelease } from '../src/lifecycle/native-release-verifier.mjs';

const keys = generateKeyPairSync('ed25519');
const trustedPublicKeyPem = keys.publicKey.export({ type:'spki', format:'pem' });
const expectedPublicKeySha256 = createHash('sha256').update(
  keys.publicKey.export({ type:'spki', format:'der' })).digest('hex');
let signed;
const publishedAt = '2026-10-31T12:00:00Z';
const now = new Date('2026-11-02T12:00:00Z');
test.before(async () => {
  signed = await buildSignedSourceRelease({
    projectRoot:process.cwd(), version:'0.1.1',channel:'stable',publishedAt,
    privateKeyPem:keys.privateKey.export({ type:'pkcs8', format:'pem' }),
  });
});
const defaults = {
  trustedPublicKeyPem, expectedPublicKeySha256, architecture:'amd64',
  databaseSchema:3, channel:'stable', now,
};

async function packaged(t) {
  const root = await mkdtemp(join(tmpdir(),'domyro-release-verify-test-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const directory = join(root,'signed-package');
  await writeSignedRelease(directory,signed);
  return { root, directory, artifact: 'domyro-0.1.1-ubuntu-amd64.bundle.json' };
}
const inspect = (directory, extra = {}) =>
  inspectOfflineNativeSourceRelease({directory, ...defaults, ...extra});

test('real builder produces independently verified complete signed package for BOTH architectures',async t => {
  const {directory}=await packaged(t);
  for(const architecture of ['amd64','arm64']) {
    const got=await inspect(directory,{architecture});
    assert.equal(got.signatureVerified,true);
    assert.equal(got.allArtifactsVerified,true);
    assert.equal(got.verifiedArtifacts.length,2);
    assert.equal(got.publisherFingerprint,expectedPublicKeySha256);
    assert.equal(got.version,'0.1.1');
    assert.equal(got.architecture,architecture);
    assert.equal(got.canInstall,false);
    assert.equal(got.canExecute,false);
    assert.equal(got.canUpdate,false);
    assert.equal(got.hostModified,false);
    assert.equal(got.networkRequested,false);
    assert.equal(got.installationGate,'D-53');
    assert.equal(got.productionRuntimeBundled,false);
  }
});

test('corrupt artifact bytes fail SHA256 authentication',async t => {
  const {directory,artifact}=await packaged(t);
  const path=join(directory,artifact);
  const bytes=await readFile(path);
  bytes[bytes.length - 8]^=1;
  await writeFile(path,bytes);
  await assert.rejects(inspect(directory),/release_artifact_hash_mismatch/);
});

test('detached signature and modified manifest cannot be accepted',async t => {
  const {directory}=await packaged(t);
  const path=join(directory,'release-manifest.sig');
  await writeFile(path,'MALFORMED\n');
  await assert.rejects(inspect(directory),/signature_invalid/);
  await writeFile(path,signed.signatureBase64+'\n');
  const manifest=join(directory,'release-manifest.json');
  await writeFile(manifest,Buffer.from(signed.manifestBytes.toString().replace('0.1.1','0.1.2')));
  await assert.rejects(inspect(directory),/signature_untrusted/);
});

test('publisher fingerprint cannot be replaced by another valid key or omitted',async t => {
  const {directory}=await packaged(t);
  const wrong=generateKeyPairSync('ed25519');
  const wrongFingerprint=createHash('sha256').update(wrong.publicKey.export({type:'spki',format:'der'})).digest('hex');
  await assert.rejects(inspect(directory,{expectedPublicKeySha256:wrongFingerprint}),/publisher_key_fingerprint_mismatch/);
  await assert.rejects(inspect(directory,{expectedPublicKeySha256:null}),/pinned_publisher_fingerprint_required/);
  await assert.rejects(inspect(directory,{trustedPublicKeyPem:wrong.publicKey.export({type:'spki',format:'pem'})}),/publisher_key_fingerprint_mismatch/);
});

test('missing or additional files reject complete package verification',async t => {
  const {directory,artifact}=await packaged(t);
  await rm(join(directory,artifact));
  await assert.rejects(inspect(directory),/release_package_entries_unexpected/);
  await writeFile(join(directory,artifact),signed.artifactBytes[artifact]);
  await writeFile(join(directory,'unexpected.sh'),'do not execute');
  await assert.rejects(inspect(directory),/release_package_entries_unexpected/);
});

test('symlinked and hardlinked artifacts are rejected regardless of content',async t => {
  const {directory,artifact,root}=await packaged(t);
  const path=join(directory,artifact);
  const bytes=await readFile(path);
  await rm(path);
  const source=join(root,'same-bytes.bundle');
  await writeFile(source,bytes);
  await symlink(source,path);
  await assert.rejects(inspect(directory),/release_file_unsafe_or_size_mismatch/);
  await rm(path);
  await link(source,path);
  await assert.rejects(inspect(directory),/release_file_unsafe_or_size_mismatch/);
});

test('group/world writable files and package directories are forbidden',async t => {
  const {directory,artifact}=await packaged(t);
  await chmod(join(directory,artifact),0o666);
  await assert.rejects(inspect(directory),/release_file_unsafe_or_size_mismatch/);
  await chmod(join(directory,artifact),0o600);
  await chmod(directory,0o755);
  await assert.rejects(inspect(directory),/release_directory_not_private_or_untrusted/);
});

test('unsupported schema, wrong channel/arch and future time fail closed',async t => {
  const {directory}=await packaged(t);
  await assert.rejects(inspect(directory,{databaseSchema:4}),/release_database_migration_not_yet_supported/);
  await assert.rejects(inspect(directory,{architecture:'mips'}),/native_architecture_unsupported/);
  await assert.rejects(inspect(directory,{channel:'nightly'}),/native_release_channel_invalid/);
  await assert.rejects(inspect(directory,{now:new Date('2026-01-01T00:00:00Z')}),/release_not_yet_published/);
  await assert.rejects(inspect(directory,{now:new Date(NaN)}),/native_release_clock_invalid/);
});

test('offline verifier CLI validates pin and exits without allowing installation',async t => {
  const {directory,root}=await packaged(t);
  const key=join(root,'trusted-publisher.pem');
  await writeFile(key,trustedPublicKeyPem,{mode:0o600});
  const cli='scripts/verify-native-source-release.mjs';
  const flags=[
    '--directory='+directory,'--publisher-key='+key,
    '--publisher-fingerprint='+expectedPublicKeySha256,
    '--arch=arm64','--schema=3',
  ];
  const result=spawnSync(process.execPath,[cli,...flags],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout);
  assert.equal(report.architecture,'arm64');
  assert.equal(report.allArtifactsVerified,true);
  assert.equal(report.canInstall,false);
  assert.equal(report.installationGate,'D-53');
  const rejected=spawnSync(process.execPath,[cli,...flags,'--arch=amd64'],{encoding:'utf8',timeout:15000});
  assert.equal(rejected.status,1);
  assert.match(rejected.stderr,/invalid_or_duplicate_release_verifier_argument/);
  const wrong=spawnSync(process.execPath,[cli,...flags.map(f=>f.startsWith('--publisher-fingerprint=')?'--publisher-fingerprint='+'f'.repeat(64):f)],{encoding:'utf8',timeout:15000});
  assert.equal(wrong.status,1);
  assert.match(wrong.stderr,/publisher_key_fingerprint_mismatch/);
});

test('rejects untrusted public key types and missing published artifacts',async t => {
  const {directory,artifact,root}=await packaged(t);
  const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
  await assert.rejects(inspect(directory,{
    trustedPublicKeyPem:rsa.publicKey.export({type:'spki',format:'pem'}),
  }),/ed25519_publisher_key_required/);
  await rm(join(directory,artifact));
  await assert.rejects(inspect(directory),/release_package_entries_unexpected/);
  const names=await readdir(directory);
  assert.ok(names.includes('release-manifest.json'));
});
