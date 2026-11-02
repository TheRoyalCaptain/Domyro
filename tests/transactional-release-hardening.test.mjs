// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,mkdir,link,rename,symlink,writeFile,readlink,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageVerifiedBundle,inspectVerifiedStagedBundle,switchActiveBundle,inspectActiveBundle} from '../src/lifecycle/transactional-release.mjs';

const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const trustedPublicKeyPem=publicKey.export({format:'pem',type:'spki'});
function signed(version){
  const artifactBytes=Buffer.from(JSON.stringify({
    schemaVersion:1,files:[
      {path:'src/server.mjs',base64:Buffer.from('version='+version).toString('base64')},
      {path:'web/index.html',base64:Buffer.from('<h1>Domyro</h1>').toString('base64')},
    ],
  }));
  const manifestBytes=Buffer.from(JSON.stringify({
    schemaVersion:1,version,channel:'stable',publishedAt:'2026-11-02T00:00:00Z',
    database:{min:0,max:0,target:0,migration:'none'},
    artifacts:[{os:'ubuntu',arch:'amd64',file:'domyro-'+version+'.json',
      bytes:artifactBytes.length,sha256:createHash('sha256').update(artifactBytes).digest('hex')}],
  }));
  return {manifestBytes,artifactBytes,
    signatureBase64:sign(null,manifestBytes,privateKey).toString('base64'),
    trustedPublicKeyPem,arch:'amd64'};
}
async function sandbox(t){
  const root=await mkdtemp(join(tmpdir(),'domyro-hardening-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
}
async function staged(t,version='0.1.0'){
  const root=await sandbox(t);
  await stageVerifiedBundle({root,...signed(version)});
  return {root,release:join(root,'releases',version)};
}
const inspect=(root,version='0.1.0')=>inspectVerifiedStagedBundle({
  root,version,trustedPublicKeyPem,expectedArch:'amd64',
});
const activate=(root,version,probe=async()=>true)=>switchActiveBundle({
  root,version,confirmedVersion:version,verifiedBackup:true,trustedPublicKeyPem,probe,
});

test('receipt symlink is rejected even when it points at a valid signed receipt',async t=>{
  const {root,release}=await staged(t);
  const receipt=join(release,'.receipt.json');
  const moved=join(root,'external-receipt.json');
  await rename(receipt,moved);
  await symlink(moved,receipt);
  await assert.rejects(()=>inspect(root),/staged_release_receipt_unsafe/);
  await assert.rejects(()=>activate(root,'0.1.0'),/staged_release_receipt_unsafe/);
  assert.equal(await inspectActiveBundle(root),null);
});

test('hardlinked receipt or source file is rejected before activation',async t=>{
  const {root,release}=await staged(t);
  const receipt=join(release,'.receipt.json');
  await link(receipt,join(root,'receipt-hardlink'));
  await assert.rejects(()=>inspect(root),/staged_release_receipt_unsafe/);
  await rm(join(root,'receipt-hardlink'));
  const entry=join(release,'src/server.mjs');
  await link(entry,join(root,'source-hardlink'));
  await assert.rejects(()=>inspect(root),/staged_release_file_changed/);
  assert.equal(await inspectActiveBundle(root),null);
});

test('extra empty directories are not silently ignored by the signed file inventory',async t=>{
  const {root,release}=await staged(t);
  await mkdir(join(release,'unlisted/empty'),{recursive:true});
  await assert.rejects(()=>inspect(root),/staged_release_unlisted_directory/);
  assert.equal(await inspectActiveBundle(root),null);
});

test('tampered previous release prevents update before changing the live pointer',async t=>{
  const {root,release}=await staged(t);
  await activate(root,'0.1.0');
  await stageVerifiedBundle({root,...signed('0.1.1')});
  await writeFile(join(release,'src/server.mjs'),'corrupted previous release');
  let probed=false;
  await assert.rejects(()=>activate(root,'0.1.1',async()=>{probed=true;return true;}),
    /staged_release_file_changed/);
  assert.equal(probed,false);
  assert.equal(await inspectActiveBundle(root),'0.1.0');
  assert.equal(await readlink(join(root,'current')),'releases/0.1.0');
});

test('valid old and candidate releases still switch with explicit approval, never production authorization',async t=>{
  const {root}=await staged(t);
  await activate(root,'0.1.0');
  await stageVerifiedBundle({root,...signed('0.1.1')});
  const result=await activate(root,'0.1.1');
  assert.equal(result.active,'0.1.1');
  assert.equal(result.previous,'0.1.0');
  assert.equal(result.installationApproved,false);
  assert.equal(result.gate,'D-53');
});

test('writable signed receipt and files are rejected before activation',async t=>{
  const {root,release}=await staged(t);
  const receipt=join(release,'.receipt.json');
  await chmod(receipt,0o666);
  await assert.rejects(()=>inspect(root),/staged_release_receipt_unsafe/);
  await chmod(receipt,0o600);
  await chmod(join(release,'src/server.mjs'),0o666);
  await assert.rejects(()=>inspect(root),/staged_release_file_changed/);
  assert.equal(await inspectActiveBundle(root),null);
});

test('writable signed release directories fail closed',async t=>{
  const {root,release}=await staged(t);
  await chmod(join(release,'src'),0o777);
  await assert.rejects(()=>inspect(root),/staged_release_directory_writable/);
  await chmod(join(release,'src'),0o700);
  await chmod(release,0o777);
  await assert.rejects(()=>inspect(root),/staged_release_not_private_directory/);
  assert.equal(await inspectActiveBundle(root),null);
});
