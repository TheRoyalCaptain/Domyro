// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, lstat, rm, symlink, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  stageVerifiedBundle, switchActiveBundle, inspectActiveBundle,
  inspectInterruptedActivation,
} from '../src/lifecycle/transactional-release.mjs';
import { readActivationIntent } from '../src/lifecycle/activation-journal.mjs';

const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const trustedPublicKeyPem=publicKey.export({format:'pem',type:'spki'});
function signed(version) {
  const artifactBytes=Buffer.from(JSON.stringify({schemaVersion:1,files:[
    {path:'src/server.mjs',base64:Buffer.from('safe-'+version).toString('base64')},
  ]}));
  const manifestBytes=Buffer.from(JSON.stringify({
    schemaVersion:1,version,channel:'stable',publishedAt:'2026-11-02T00:00:00Z',
    database:{min:0,max:0,target:0,migration:'none'},
    artifacts:[{os:'ubuntu',arch:'amd64',file:'domyro-'+version+'.json',
      bytes:artifactBytes.length,sha256:createHash('sha256').update(artifactBytes).digest('hex')}],
  }));
  return {manifestBytes,artifactBytes,arch:'amd64',trustedPublicKeyPem,
    signatureBase64:sign(null,manifestBytes,privateKey).toString('base64')};
}
async function sandbox(t) {
  const root=await mkdtemp(join(tmpdir(),'domyro-crash-intent-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  return root;
}
const switchTo=(root,version,probe=async()=>true)=>switchActiveBundle({
  root,version,confirmedVersion:version,verifiedBackup:true,trustedPublicKeyPem,probe,
});
async function stage(root,version){await stageVerifiedBundle({root,...signed(version)});}
async function absent(path) {await assert.rejects(()=>lstat(path),{code:'ENOENT'});}

test('completed and rolled-back isolated switches fsync and clear their intent',async t=>{
  const root=await sandbox(t);
  await stage(root,'0.1.0');
  await switchTo(root,'0.1.0');
  await absent(join(root,'.activation-intent.json'));
  await absent(join(root,'.activation.lock'));
  await stage(root,'0.1.1');
  await assert.rejects(()=>switchTo(root,'0.1.1',async()=>false),
    /post_activation_health_failed_rolled_back_pointer/);
  assert.equal(await inspectActiveBundle(root),'0.1.0');
  await absent(join(root,'.activation-intent.json'));
  await absent(join(root,'.activation.lock'));
  await switchTo(root,'0.1.1');
  assert.equal((await inspectInterruptedActivation({root,trustedPublicKeyPem})).state,'clean');
});

test('SIGKILL after pointer switch leaves durable intent and blocks retries, without automatic rollback',async t=>{
  const root=await sandbox(t);
  await stage(root,'0.1.0');
  await switchTo(root,'0.1.0');
  await stage(root,'0.1.1');
  const moduleUrl=pathToFileURL(join(process.cwd(),'src/lifecycle/transactional-release.mjs')).href;
  const script=`
    import {switchActiveBundle} from ${JSON.stringify(moduleUrl)};
    await switchActiveBundle({
      root:process.env.TEST_ROOT,version:'0.1.1',confirmedVersion:'0.1.1',
      verifiedBackup:true,trustedPublicKeyPem:process.env.TEST_PEM,
      probe:async()=>{
        await new Promise(resolve=>process.stdout.write('POINTER_SWITCHED\\n',resolve));
        process.kill(process.pid,'SIGKILL');
        return true;
      }
    });
  `;
  const child=spawn(process.execPath,['--input-type=module','--eval',script],{
    cwd:process.cwd(),env:{...process.env,TEST_ROOT:root,TEST_PEM:trustedPublicKeyPem},
    stdio:['ignore','pipe','pipe'],
  });
  let stdout='',stderr='';
  child.stdout.on('data',chunk=>stdout+=chunk.toString());
  child.stderr.on('data',chunk=>stderr+=chunk.toString());
  const result=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('child_timeout'));},12000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});
  });
  assert.equal(result.signal,'SIGKILL',stderr);
  assert.match(stdout,/POINTER_SWITCHED/);
  assert.equal(await inspectActiveBundle(root),'0.1.1');
  const intent=await readActivationIntent(root);
  assert.equal(intent.previous,'0.1.0');
  assert.equal(intent.target,'0.1.1');
  const inspection=await inspectInterruptedActivation({root,trustedPublicKeyPem});
  assert.equal(inspection.state,'interrupted');
  assert.equal(inspection.activeMatchesIntent,true);
  assert.equal(inspection.previousSignedSourceVerified,true);
  assert.equal(inspection.candidateSignedSourceVerified,true);
  assert.equal(inspection.lockPresent,true);
  assert.equal(inspection.automaticRecoveryAllowed,false);
  assert.equal(inspection.manualRecoveryRequired,true);
  // Even removing a stale lock cannot erase the separate durable intent.
  await unlink(join(root,'.activation.lock'));
  await assert.rejects(()=>switchTo(root,'0.1.0'),
    /interrupted_activation_requires_manual_recovery/);
  assert.equal(await inspectActiveBundle(root),'0.1.1');
});

test('malformed or symlinked intent fails closed and never switches the pointer',async t=>{
  const root=await sandbox(t);
  await stage(root,'0.1.0');
  await switchTo(root,'0.1.0');
  await stage(root,'0.1.1');
  const path=join(root,'.activation-intent.json');
  await writeFile(path,'{', {mode:0o600});
  await assert.rejects(()=>inspectInterruptedActivation({root,trustedPublicKeyPem}),
    /activation_intent_invalid/);
  await assert.rejects(()=>switchTo(root,'0.1.1'),/activation_intent_invalid/);
  await unlink(path);
  await writeFile(join(root,'other.json'),'{}',{mode:0o600});
  await symlink(join(root,'other.json'),path);
  await assert.rejects(()=>switchTo(root,'0.1.1'),/activation_intent_unreadable/);
  assert.equal(await inspectActiveBundle(root),'0.1.0');
});

test('read-only crash inspection does not create a missing release root',async t=>{
  const root=join(await sandbox(t),'not-created');
  await assert.rejects(()=>inspectInterruptedActivation({root,trustedPublicKeyPem}),{code:'ENOENT'});
  await absent(root);
});

test('tampering with a persisted intent during the health probe is a critical failure',async t=>{
  const root=await sandbox(t);
  await stage(root,'0.1.0');
  await switchTo(root,'0.1.0');
  await stage(root,'0.1.1');
  const path=join(root,'.activation-intent.json');
  await assert.rejects(()=>switchTo(root,'0.1.1',async()=>{
    const value=JSON.parse(await readFile(path,'utf8'));
    value.target='0.1.2';
    await writeFile(path,JSON.stringify(value)+'\\n');
    return true;
  }),/rollback_integrity_or_cleanup_failed/);
  assert.equal(await inspectActiveBundle(root),'0.1.0');
  assert.equal((await readActivationIntent(root)).target,'0.1.2');
  await absent(join(root,'.activation.lock'));
  await assert.rejects(()=>switchTo(root,'0.1.1'),
    /interrupted_activation_requires_manual_recovery/);
});

test('crash inspector flags a corrupted previous signed source instead of suggesting recovery',async t=>{
  const root=await sandbox(t);
  await stage(root,'0.1.0');
  await switchTo(root,'0.1.0');
  await stage(root,'0.1.1');
  const {persistActivationIntent}=await import('../src/lifecycle/activation-journal.mjs');
  await persistActivationIntent(root,{previous:'0.1.0',target:'0.1.1'});
  await writeFile(join(root,'releases/0.1.0/src/server.mjs'),'tampered');
  const result=await inspectInterruptedActivation({root,trustedPublicKeyPem});
  assert.equal(result.state,'interrupted');
  assert.equal(result.previousSignedSourceVerified,false);
  assert.equal(result.candidateSignedSourceVerified,true);
  assert.equal(result.automaticRecoveryAllowed,false);
});
