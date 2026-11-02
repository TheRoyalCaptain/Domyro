// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,generateKeyPairSync } from 'node:crypto';
import { readFile,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validatePublisherTrustPolicy } from '../src/lifecycle/publisher-trust-policy.mjs';

const keys=generateKeyPairSync('ed25519');
const pem=keys.publicKey.export({type:'spki',format:'pem'});
const privateKeyPem=keys.privateKey.export({type:'pkcs8',format:'pem'});
const fingerprint=createHash('sha256').update(keys.publicKey.export({type:'spki',format:'der'})).digest('hex');
const policy={schemaVersion:1,configured:true,publicKeyPem:pem,
  publisherFingerprintSha256:fingerprint,
  releaseSource:'github.com/TheRoyalCaptain/Domyro/releases',
};
test('unconfigured publisher root remains a deliberate production blocker',async()=>{
  const current=JSON.parse(await readFile('config/release-publisher.json','utf8'));
  assert.equal(current.configured,false);
  assert.equal(current.publicKeyPem,null);
  assert.equal(current.publisherFingerprintSha256,null);
  assert.throws(()=>validatePublisherTrustPolicy({policy:current}),
    /official_publisher_not_configured/);
});
test('Ed25519 private signer must match the reviewed public fingerprint',()=>{
  const trusted=validatePublisherTrustPolicy({policy,privateKeyPem});
  assert.equal(trusted.signerMatchesPolicy,true);
  assert.equal(trusted.publisherFingerprintSha256,fingerprint);
  assert.equal(trusted.installationApproved,false);
  assert.throws(()=>validatePublisherTrustPolicy({
    policy:{...policy,publisherFingerprintSha256:'f'.repeat(64)},privateKeyPem,
  }),/publisher_trust_fingerprint_mismatch/);
  const other=generateKeyPairSync('ed25519');
  assert.throws(()=>validatePublisherTrustPolicy({
    policy,privateKeyPem:other.privateKey.export({type:'pkcs8',format:'pem'}),
  }),/publisher_private_key_does_not_match_pinned_public_key/);
});
test('publisher signing key validation CLI refuses insecure private key files',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'domyro-publisher-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const policyPath=join(dir,'policy.json'),privatePath=join(dir,'private.pem');
  await writeFile(policyPath,JSON.stringify(policy),{mode:0o600});
  await writeFile(privatePath,privateKeyPem,{mode:0o600});
  const invoke=()=>spawnSync(process.execPath,[
    'tools/verify-release-publisher.mjs',policyPath,privatePath,
  ],{cwd:process.cwd(),encoding:'utf8',timeout:5000});
  const success=invoke();
  assert.equal(success.status,0,success.stderr);
  assert.equal(JSON.parse(success.stdout).signerMatchesPolicy,true);
  const {chmod}=await import('node:fs/promises');
  await chmod(privatePath,0o644);
  const refused=invoke();
  assert.equal(refused.status,1,refused.stderr);
  assert.match(refused.stderr,/publisher_private_key_file_not_private/);
  assert.equal(refused.stderr.includes(privateKeyPem),false);
});
test('official publishing workflow requires production gate and draft publication',async()=>{
  const workflow=await readFile('.github/workflows/publish-official-release.yml','utf8');
  assert.ok(workflow.indexOf('node scripts/check-installation-gate.mjs --require-ready')<
    workflow.indexOf('RELEASE_PRIVATE_KEY_PEM:'));
  assert.ok(workflow.includes("github.ref == 'refs/heads/main'"));
  assert.ok(workflow.includes('environment: production-release'));
  assert.ok(workflow.includes('gh release create "$TAG"'));
  assert.ok(workflow.includes('--draft'));
  assert.ok(workflow.includes('node tools/verify-release-publisher.mjs'));
});
