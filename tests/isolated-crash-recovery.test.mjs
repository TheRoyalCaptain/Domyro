// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, lstat, rm, symlink, unlink, writeFile, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  stageVerifiedBundle, switchActiveBundle, inspectActiveBundle,
  inspectInterruptedActivation,
} from '../src/lifecycle/transactional-release.mjs';
import { persistActivationIntent, readActivationIntent } from '../src/lifecycle/activation-journal.mjs';
import { rehearseInterruptedPointerRecovery } from '../src/lifecycle/isolated-crash-recovery.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const trustedPublicKeyPem = publicKey.export({ format: 'pem', type: 'spki' });
function signed(version) {
  const artifactBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, files: [
    { path: 'src/server.mjs', base64: Buffer.from('fixture-'+version).toString('base64') },
  ] }));
  const manifestBytes = Buffer.from(JSON.stringify({
    schemaVersion: 1, version, channel: 'stable', publishedAt: '2026-11-02T00:00:00Z',
    database: { min: 0, max: 0, target: 0, migration: 'none' },
    artifacts: [{ os: 'ubuntu', arch: 'amd64', file: 'fixture.json',
      bytes: artifactBytes.length, sha256: createHash('sha256').update(artifactBytes).digest('hex') }],
  }));
  return { manifestBytes, artifactBytes, arch: 'amd64', trustedPublicKeyPem,
    signatureBase64: sign(null, manifestBytes, privateKey).toString('base64') };
}
async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), 'domyro-recovery-rehearsal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const activate = (root, version, probe = async () => true) => switchActiveBundle({
  root, version, confirmedVersion: version, verifiedBackup: true, trustedPublicKeyPem, probe,
});
const recover = (root, overrides = {}) => rehearseInterruptedPointerRecovery({
  root, trustedPublicKeyPem, confirmedPreviousVersion: '0.1.0',
  testOnly: true, processExited: true, verifiedBackup: true, ...overrides,
});
async function stagedPair(t) {
  const root = await sandbox(t);
  await stageVerifiedBundle({ root, ...signed('0.1.0') });
  await activate(root, '0.1.0');
  await stageVerifiedBundle({ root, ...signed('0.1.1') });
  return root;
}
async function interruptedFixture(t) {
  const root = await stagedPair(t);
  await persistActivationIntent(root, { previous: '0.1.0', target: '0.1.1' });
  await writeFile(join(root, '.activation.lock'), '', { flag: 'wx', mode: 0o600 });
  await symlink('releases/0.1.1', join(root, '.pending'));
  const { rename } = await import('node:fs/promises');
  await rename(join(root, '.pending'), join(root, 'current'));
  return root;
}
async function absent(path) { await assert.rejects(() => lstat(path), { code: 'ENOENT' }); }

test('explicit offline recovery of a SIGKILLed pointer switch restores signed previous tree', async t => {
  const root = await stagedPair(t);
  const moduleUrl = pathToFileURL(join(process.cwd(), 'src/lifecycle/transactional-release.mjs')).href;
  const script = `
    import {switchActiveBundle} from ${JSON.stringify(moduleUrl)};
    await switchActiveBundle({
      root:process.env.TEST_ROOT,version:'0.1.1',confirmedVersion:'0.1.1',
      verifiedBackup:true,trustedPublicKeyPem:process.env.TEST_PEM,
      probe:async()=>{process.stdout.write('AFTER_SWITCH\\n',()=>{
        process.kill(process.pid,'SIGKILL');
      });await new Promise(()=>{});}
    });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: process.cwd(), env: { ...process.env, TEST_ROOT: root, TEST_PEM: trustedPublicKeyPem },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', x => stdout += x);
  child.stderr.on('data', x => stderr += x);
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('child_timeout')); }, 12000);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  assert.equal(result.signal, 'SIGKILL', stderr);
  assert.match(stdout, /AFTER_SWITCH/);
  assert.equal(await inspectActiveBundle(root), '0.1.1');
  const outcome = await recover(root);
  assert.equal(outcome.active, '0.1.0');
  assert.equal(outcome.abandonedCandidate, '0.1.1');
  assert.equal(outcome.databaseRestored, false);
  assert.equal(outcome.productionRecoveryApproved, false);
  assert.equal(outcome.gate, 'D-53');
  assert.equal(await inspectActiveBundle(root), '0.1.0');
  for (const name of ['.activation-intent.json', '.activation.lock', '.recovery.lock']) {
    await absent(join(root, name));
  }
  assert.equal((await inspectInterruptedActivation({ root, trustedPublicKeyPem })).state, 'clean');
  await activate(root, '0.1.1');
  assert.equal(await inspectActiveBundle(root), '0.1.1');
});

test('missing explicit test approval, quiescence assertion or backup assertion refuses all changes', async t => {
  const root = await interruptedFixture(t);
  for (const flag of ['testOnly', 'processExited', 'verifiedBackup']) {
    await assert.rejects(() => recover(root, { [flag]: false }),
      /isolated_recovery_explicit_test_approval_required/);
  }
  await assert.rejects(() => recover(root, { confirmedPreviousVersion: '0.1.1' }),
    /isolated_recovery_previous_version_confirmation_required/);
  assert.equal(await inspectActiveBundle(root), '0.1.1');
  assert.ok(await readActivationIntent(root));
});

test('corrupted previous signed release cannot be selected for recovery', async t => {
  const root = await interruptedFixture(t);
  await writeFile(join(root, 'releases/0.1.0/src/server.mjs'), 'tampered');
  await assert.rejects(() => recover(root), /isolated_recovery_source_integrity_unverified/);
  assert.equal(await inspectActiveBundle(root), '0.1.1');
  assert.ok(await readActivationIntent(root));
  await absent(join(root, '.recovery.lock'));
});

test('unexpected active pointer blocks recovery without deleting intent', async t => {
  const root = await interruptedFixture(t);
  await unlink(join(root, 'current'));
  await symlink('releases/0.1.2', join(root, 'current'));
  await assert.rejects(() => recover(root), /isolated_recovery_source_integrity_unverified/);
  assert.equal(await readlink(join(root, 'current')), 'releases/0.1.2');
  assert.ok(await readActivationIntent(root));
});

test('existing recovery lock blocks all source switches and reports unresolved recovery state', async t => {
  const root = await stagedPair(t);
  await writeFile(join(root, '.recovery.lock'), '', { flag: 'wx', mode: 0o600 });
  await assert.rejects(() => activate(root, '0.1.1'),
    /isolated_recovery_lock_requires_manual_review/);
  const diagnosis = await inspectInterruptedActivation({ root, trustedPublicKeyPem });
  assert.equal(diagnosis.state, 'unresolved_recovery_lock');
  assert.equal(diagnosis.recoveryLockPresent, true);
  await assert.rejects(() => recover(root), { code: 'EEXIST' });
  assert.equal(await inspectActiveBundle(root), '0.1.0');
});

test('test-only recovery rejects a non-disposable root even with all approval flags', async t => {
  const root = await mkdtemp(join(tmpdir(), 'domyro-not-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => recover(root), /isolated_recovery_disposable_root_required/);
  await absent(join(root, '.recovery.lock'));
});

test('clean fixture cannot be recovered and cannot erase a signed current release', async t => {
  const root = await stagedPair(t);
  await assert.rejects(() => recover(root), /isolated_recovery_no_interrupted_intent/);
  assert.equal(await inspectActiveBundle(root), '0.1.0');
  await absent(join(root, '.recovery.lock'));
});

test('unsafe hardlinked stale activation lock blocks recovery without erasing intent', async t => {
  const root = await interruptedFixture(t);
  const { link } = await import('node:fs/promises');
  await link(join(root, '.activation.lock'), join(root, 'external-lock-hardlink'));
  await assert.rejects(() => recover(root), /isolated_recovery_activation_lock_unsafe/);
  assert.equal(await inspectActiveBundle(root), '0.1.1');
  assert.ok(await readActivationIntent(root));
});


async function killRecoveryAt(root, checkpoint) {
  const moduleUrl = pathToFileURL(join(process.cwd(), 'src/lifecycle/isolated-crash-recovery.mjs')).href;
  const script = [
    'import {rehearseInterruptedPointerRecovery} from ' + JSON.stringify(moduleUrl) + ';',
    'await rehearseInterruptedPointerRecovery({',
    "root:process.env.TEST_ROOT, trustedPublicKeyPem:process.env.TEST_PEM,",
    "confirmedPreviousVersion:'0.1.0', testOnly:true, processExited:true, verifiedBackup:true,",
    "onTestCheckpoint:async point=>{if(point===process.env.TEST_CHECKPOINT){",
    "process.stdout.write('RECOVERY_CHECKPOINT\\n',()=>process.kill(process.pid,'SIGKILL'));",
    "await new Promise(()=>{});",
    "}}",
    '});',
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    env: { ...process.env, TEST_ROOT: root, TEST_PEM: trustedPublicKeyPem, TEST_CHECKPOINT: checkpoint },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', x => { stdout += x; });
  child.stderr.on('data', x => { stderr += x; });
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('recovery_child_timeout'));
    }, 12000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  assert.equal(result.signal, 'SIGKILL', stderr);
  assert.match(stdout, /RECOVERY_CHECKPOINT/, stderr);
}

for (const checkpoint of ['pointer_restored', 'activation_lock_removed']) {
  test('SIGKILL during offline recovery at ' + checkpoint + ' leaves durable intent and permits explicit retry', async t => {
    const root = await interruptedFixture(t);
    await killRecoveryAt(root, checkpoint);
    assert.equal(await inspectActiveBundle(root), '0.1.0');
    assert.ok(await readActivationIntent(root));
    // A killed process leaves its exclusive recovery lock. An operator must
    // inspect and remove it; the application must never auto-clear it.
    assert.equal((await lstat(join(root, '.recovery.lock'))).isFile(), true);
    await assert.rejects(() => recover(root), { code: 'EEXIST' });
    await unlink(join(root, '.recovery.lock'));
    const result = await recover(root);
    assert.equal(result.active, '0.1.0');
    assert.equal(result.productionRecoveryApproved, false);
    assert.equal((await inspectInterruptedActivation({ root, trustedPublicKeyPem })).state, 'clean');
    for (const name of ['.activation-intent.json', '.activation.lock', '.recovery.lock']) {
      await absent(join(root, name));
    }
  });
}

test('recovery never unlinks a substituted recovery lock inode', async t => {
  const root = await interruptedFixture(t);
  const lockPath = join(root, '.recovery.lock');
  await assert.rejects(() => recover(root, {
    onTestCheckpoint: async point => {
      if (point === 'pointer_restored') {
        await unlink(lockPath);
        await writeFile(lockPath, 'replacement', { flag: 'wx', mode: 0o600 });
      }
    },
  }), /isolated_recovery_lock_changed/);
  assert.equal((await lstat(lockPath)).isFile(), true);
  assert.ok(await readActivationIntent(root));
  assert.equal(await inspectActiveBundle(root), '0.1.0');
  await assert.rejects(() => recover(root), { code: 'EEXIST' });
  await unlink(lockPath);
  const result = await recover(root);
  assert.equal(result.active, '0.1.0');
  assert.equal((await inspectInterruptedActivation({ root, trustedPublicKeyPem })).state, 'clean');
});

test('recovery rejects nonfunction test checkpoint before creating a lock', async t => {
  const root = await interruptedFixture(t);
  await assert.rejects(() => recover(root, { onTestCheckpoint: 'not-a-function' }),
    /isolated_recovery_invalid_test_checkpoint/);
  await absent(join(root, '.recovery.lock'));
  assert.ok(await readActivationIntent(root));
});


test('tampering the old signed tree after pointer restoration preserves recovery intent', async t => {
  const root = await interruptedFixture(t);
  await assert.rejects(() => recover(root, {
    onTestCheckpoint: async point => {
      if (point === 'pointer_restored') {
        await writeFile(join(root, 'releases/0.1.0/src/server.mjs'), 'tampered-after-rename');
      }
    },
  }));
  assert.equal(await inspectActiveBundle(root), '0.1.0');
  assert.ok(await readActivationIntent(root));
  await absent(join(root, '.recovery.lock'));
  await assert.rejects(() => activate(root, '0.1.1'),
    /interrupted_activation_requires_manual_recovery/);
});

test('altering the activation intent after restoring pointer refuses final clearance', async t => {
  const root = await interruptedFixture(t);
  await assert.rejects(() => recover(root, {
    onTestCheckpoint: async point => {
      if (point === 'activation_lock_removed') {
        await writeFile(join(root, '.activation-intent.json'), '{"invalid":true}\n');
      }
    },
  }), /activation_intent_invalid/);
  assert.equal(await inspectActiveBundle(root), '0.1.0');
  assert.equal((await lstat(join(root, '.activation-intent.json'))).isFile(), true);
  await absent(join(root, '.recovery.lock'));
  await assert.rejects(() => activate(root, '0.1.1'), /activation_intent_invalid/);
});
