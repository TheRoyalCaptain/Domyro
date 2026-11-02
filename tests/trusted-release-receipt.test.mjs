// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectSignedUpdateFromCatalog } from '../src/lifecycle/signed-release-catalog.mjs';
import {
  readTrustedReleaseReceipt, recordTrustedReleaseReceipt,
} from '../src/lifecycle/trusted-release-receipt.mjs';

const keys = generateKeyPairSync('ed25519');
const trustedPublicKeyPem = keys.publicKey.export({ type:'spki', format:'pem' });
const otherKeys = generateKeyPairSync('ed25519');
const otherPublicKey = otherKeys.publicKey.export({ type:'spki', format:'pem' });
const hash = createHash('sha256').update('isolated artifact').digest('hex');
function signed(version, file='release.bundle') {
  const manifestBytes = Buffer.from(JSON.stringify({
    schemaVersion:1, version, channel:'stable', publishedAt:'2026-11-01T00:00:00Z',
    database:{min:3,max:3,target:3,migration:'none'},
    artifacts:[{os:'ubuntu',arch:'amd64',file,bytes:17,sha256:hash}],
  }));
  return {manifestBytes,signatureBase64:sign(null,manifestBytes,keys.privateKey).toString('base64')};
}
async function sandbox(fn) {
  const directory = await mkdtemp(join(tmpdir(),'domyro-test-trust-'));
  try { return await fn(directory); }
  finally { await rm(directory,{recursive:true,force:true}); }
}
const args = (directory, release, key=trustedPublicKeyPem) => ({
  directory, ...release, trustedPublicKeyPem:key,
});

test('trusted receipt initially absent, then pinned and durable across independent reads', async()=>sandbox(async directory=>{
  assert.equal(await readTrustedReleaseReceipt({directory,trustedPublicKeyPem}),null);
  const result=await recordTrustedReleaseReceipt(args(directory,signed('1.2.0')));
  assert.equal(result.version,'1.2.0');
  assert.equal(result.installAllowed,false);
  assert.equal(result.gate,'D-53');
  const read=await readTrustedReleaseReceipt({directory,trustedPublicKeyPem});
  assert.equal(read.version,'1.2.0');
  assert.match(read.manifestSha256,/^[a-f0-9]{64}$/);
  assert.match(read.publisherKeySha256,/^[a-f0-9]{64}$/);
  assert.equal((await lstat(join(directory,'.trusted-release-receipt.json'))).mode & 0o077,0);
  await assert.rejects(lstat(join(directory,'.trusted-release-receipt.lock')), /ENOENT/);
}));

test('same signed release is idempotent; newer release advances high-water',async()=>sandbox(async directory=>{
  const first=signed('1.0.0');
  await recordTrustedReleaseReceipt(args(directory,first));
  assert.equal((await recordTrustedReleaseReceipt(args(directory,first))).unchanged,true);
  const next=await recordTrustedReleaseReceipt(args(directory,signed('1.1.0')));
  assert.equal(next.unchanged,false);
  assert.equal((await readTrustedReleaseReceipt({directory,trustedPublicKeyPem})).version,'1.1.0');
}));

test('signed downgrade and same-version equivocation fail closed, keeping prior record',async()=>sandbox(async directory=>{
  await recordTrustedReleaseReceipt(args(directory,signed('1.2.0')));
  await assert.rejects(recordTrustedReleaseReceipt(args(directory,signed('1.1.0'))),/receipt_rollback_detected/);
  await assert.rejects(recordTrustedReleaseReceipt(args(directory,signed('1.2.0','different.bundle'))),/receipt_equivocation_detected/);
  assert.equal((await readTrustedReleaseReceipt({directory,trustedPublicKeyPem})).version,'1.2.0');
}));

test('unsigned and modified manifests cannot create a trust receipt',async()=>sandbox(async directory=>{
  const release=signed('1.0.0');
  await assert.rejects(recordTrustedReleaseReceipt(args(directory,{...release,manifestBytes:Buffer.from(release.manifestBytes.toString().replace('1.0.0','9.0.0'))})),/signature_untrusted/);
  assert.equal(await readTrustedReleaseReceipt({directory,trustedPublicKeyPem}),null);
}));

test('publisher key substitution cannot read or overwrite previously trusted receipt',async()=>sandbox(async directory=>{
  await recordTrustedReleaseReceipt(args(directory,signed('1.0.0')));
  await assert.rejects(readTrustedReleaseReceipt({directory,trustedPublicKeyPem:otherPublicKey}),/receipt_publisher_key_changed/);
  // Manifest may verify under a different key, but the pinned receipt still blocks.
  const manifestBytes=signed('1.5.0').manifestBytes;
  const replacement={manifestBytes,signatureBase64:sign(null,manifestBytes,otherKeys.privateKey).toString('base64')};
  await assert.rejects(recordTrustedReleaseReceipt(args(directory,replacement,otherPublicKey)),/receipt_publisher_key_changed/);
  assert.equal((await readTrustedReleaseReceipt({directory,trustedPublicKeyPem})).version,'1.0.0');
}));

test('surviving crash-intent lock blocks reading and writing until investigated',async()=>sandbox(async directory=>{
  await recordTrustedReleaseReceipt(args(directory,signed('1.0.0')));
  await mkdir(join(directory,'.trusted-release-receipt.lock'),{mode:0o700});
  await assert.rejects(readTrustedReleaseReceipt({directory,trustedPublicKeyPem}),/receipt_lock_requires_manual_investigation/);
  await assert.rejects(recordTrustedReleaseReceipt(args(directory,signed('1.1.0'))),/EEXIST/);
  assert.equal((await readFile(join(directory,'.trusted-release-receipt.json'),'utf8')).includes('1.0.0'),true);
}));

test('tampering, symlinks and world-readable receipts are not accepted',async()=>sandbox(async directory=>{
  const file=join(directory,'.trusted-release-receipt.json');
  await recordTrustedReleaseReceipt(args(directory,signed('1.0.0')));
  await chmod(file,0o644);
  await assert.rejects(readTrustedReleaseReceipt({directory,trustedPublicKeyPem}),/receipt_unsafe/);
  await chmod(file,0o600);
  await writeFile(file,'{"oops":true}');
  await assert.rejects(readTrustedReleaseReceipt({directory,trustedPublicKeyPem}),/receipt_invalid/);
  await rm(file);
  await symlink('/etc/passwd',file);
  await assert.rejects(readTrustedReleaseReceipt({directory,trustedPublicKeyPem}),/receipt_unreadable/);
}));

test('test-only sandbox guard refuses arbitrary paths and insecure directories',async()=>sandbox(async directory=>{
  await chmod(directory,0o755);
  await assert.rejects(readTrustedReleaseReceipt({directory,trustedPublicKeyPem}),/receipt_directory_not_private/);
  await chmod(directory,0o700);
  await assert.rejects(readTrustedReleaseReceipt({directory:'/var/lib/domyro',trustedPublicKeyPem}),/receipt_test_directory_only/);
  await assert.rejects(recordTrustedReleaseReceipt(args('/etc/domyro',signed('1.0.0'))),/receipt_test_directory_only/);
}));

test('two concurrent writers never cause an overwrite or a downgrade',async()=>sandbox(async directory=>{
  const release=signed('1.0.0');
  const settled=await Promise.allSettled([
    recordTrustedReleaseReceipt(args(directory,release)),
    recordTrustedReleaseReceipt(args(directory,signed('1.0.0','conflicting.bundle'))),
  ]);
  assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(settled.filter(x=>x.status==='rejected').length,1);
  assert.equal((await readTrustedReleaseReceipt({directory,trustedPublicKeyPem})).version,'1.0.0');
}));

test('persisted high-water survives a new selection process and rejects signed feed rollback',async()=>sandbox(async directory=>{
  const newest=signed('1.8.0');
  await recordTrustedReleaseReceipt(args(directory,newest));
  const loaded=await readTrustedReleaseReceipt({directory,trustedPublicKeyPem});
  const result=selectSignedUpdateFromCatalog({
    releases:[signed('1.4.0')], trustedPublicKeyPem,
    currentVersion:'1.0.0', os:'ubuntu', arch:'amd64',currentDatabaseSchema:3,
    now:new Date('2026-11-02T03:00:00Z'),
    highestSeenVersion:loaded.version,
    highestSeenManifestSha256:loaded.manifestSha256,
  });
  assert.equal(result.state,'catalog_rollback_detected');
  assert.equal(result.selected,null);
  assert.equal(result.installAllowed,false);
}));
