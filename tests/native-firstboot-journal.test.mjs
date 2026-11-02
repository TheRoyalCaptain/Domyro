// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FIRSTBOOT_PHASES, createFirstBootIntent, advanceFirstBootIntent, inspectFirstBootIntent,
} from '../src/lifecycle/native-firstboot-journal.mjs';

const digest = 'a'.repeat(64), publisher = 'b'.repeat(64);
async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'domyro-firstboot-test-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return directory;
}
function start(directory,overrides={}) {
  return createFirstBootIntent({
    directory,releaseVersion:'0.1.1',manifestSha256:digest,
    publisherKeySha256:publisher,...overrides,
  });
}
function next(directory,expectedPhase,nextPhase) {
  return advanceFirstBootIntent({directory,expectedPhase,nextPhase});
}
test('clean private firstboot fixture can create an immutable crash-visible intent',async t=>{
  const directory=await fixture(t);
  assert.equal(await inspectFirstBootIntent({directory}),null);
  const actual=await start(directory);
  assert.equal(actual.sequence,0);
  assert.equal(actual.phase,'intent_created');
  assert.equal(actual.nextPhase,'signed_source_verified');
  assert.equal(actual.installationAllowed,false);
  assert.equal(actual.automaticRecoveryAllowed,false);
  assert.equal(actual.gate,'D-53');
  const loaded=await inspectFirstBootIntent({directory});
  assert.equal(loaded.manifestSha256,digest);
  assert.equal(loaded.publisherKeySha256,publisher);
  assert.equal(loaded.releaseVersion,'0.1.1');
  assert.deepEqual(loaded,actual);
  await assert.rejects(start(directory),/EEXIST/);
  assert.equal((await inspectFirstBootIntent({directory})).phase,'intent_created');
});
test('every ordered firstboot phase persists without authorizing deployment',async t=>{
  const directory=await fixture(t);
  await start(directory);
  for(let i=1;i<FIRSTBOOT_PHASES.length;i++){
    const result=await next(directory,FIRSTBOOT_PHASES[i-1],FIRSTBOOT_PHASES[i]);
    assert.equal(result.sequence,i);
    assert.equal(result.phase,FIRSTBOOT_PHASES[i]);
    assert.equal(result.completeInDisposableTest,i===FIRSTBOOT_PHASES.length-1);
    assert.equal(result.installationAllowed,false);
    assert.equal(result.productionServicesChanged,false);
    assert.equal((await inspectFirstBootIntent({directory})).phase,result.phase);
  }
  await assert.rejects(next(directory,'test_completed','intent_created'),/firstboot_phase_transition_denied/);
});
test('missing intent, skipped phase, stale expected phase and retries are rejected',async t=>{
  const directory=await fixture(t);
  await assert.rejects(next(directory,'intent_created','signed_source_verified'),/firstboot_intent_missing/);
  await start(directory);
  await assert.rejects(next(directory,'intent_created','database_owner_bootstrapped'),/firstboot_phase_transition_denied/);
  await assert.rejects(next(directory,'signed_source_verified','locked_dependencies_prepared'),/firstboot_phase_transition_denied/);
  assert.equal((await inspectFirstBootIntent({directory})).phase,'intent_created');
  await next(directory,'intent_created','signed_source_verified');
  await assert.rejects(next(directory,'intent_created','signed_source_verified'),/firstboot_phase_transition_denied/);
  assert.equal((await inspectFirstBootIntent({directory})).phase,'signed_source_verified');
});
test('an interrupted writer lock blocks ALL future reads and writes until review',async t=>{
  const directory=await fixture(t);
  await start(directory);
  await mkdir(join(directory,'.native-firstboot-intent.lock'),{mode:0o700});
  await assert.rejects(inspectFirstBootIntent({directory}),/firstboot_interrupted_writer_requires_manual_review/);
  await assert.rejects(next(directory,'intent_created','signed_source_verified'),/EEXIST/);
  assert.match(await readFile(join(directory,'.native-firstboot-intent.json'),'utf8'),/intent_created/);
});
test('two concurrent attempts cannot both advance the same phase',async t=>{
  const directory=await fixture(t);
  await start(directory);
  const results=await Promise.allSettled([
    next(directory,'intent_created','signed_source_verified'),
    next(directory,'intent_created','signed_source_verified'),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await inspectFirstBootIntent({directory})).phase,'signed_source_verified');
});
test('tampered journal bytes are refused, never repaired automatically',async t=>{
  const directory=await fixture(t);
  await start(directory);
  const file=join(directory,'.native-firstboot-intent.json');
  const doc=JSON.parse(await readFile(file,'utf8'));
  doc.sequence=7;
  await writeFile(file,JSON.stringify(doc));
  await assert.rejects(inspectFirstBootIntent({directory}),/firstboot_intent_corrupt/);
});
test('symlinked or world-readable intent files are rejected',async t=>{
  const directory=await fixture(t);
  await start(directory);
  const file=join(directory,'.native-firstboot-intent.json');
  await chmod(file,0o644);
  await assert.rejects(inspectFirstBootIntent({directory}),/firstboot_intent_unsafe/);
  await chmod(file,0o600);
  const original=await readFile(file);
  await rm(file);
  const outside=join(directory,'outside.json');
  await writeFile(outside,original);
  await symlink(outside,file);
  await assert.rejects(inspectFirstBootIntent({directory}),/firstboot_intent_unreadable/);
});
test('public/private directory confusion blocks journaling',async t=>{
  const directory=await fixture(t);
  await chmod(directory,0o755);
  await assert.rejects(start(directory),/firstboot_directory_not_private/);
  await chmod(directory,0o700);
  await assert.rejects(start('/opt/domyro',{releaseVersion:'0.1.1'}),/firstboot_disposable_directory_only|ENOENT/);
});
test('invalid release identity or digest cannot create an intent',async t=>{
  const directory=await fixture(t);
  await assert.rejects(start(directory,{releaseVersion:'../../etc/passwd'}),/firstboot_intent_identity_invalid/);
  await assert.rejects(start(directory,{manifestSha256:'uncertain'}),/firstboot_intent_identity_invalid/);
  await assert.rejects(start(directory,{publisherKeySha256:'ff'}),/firstboot_intent_identity_invalid/);
  assert.equal(await inspectFirstBootIntent({directory}),null);
});
