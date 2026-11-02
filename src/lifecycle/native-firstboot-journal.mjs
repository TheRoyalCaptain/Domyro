// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Disposable FIRST-BOOT crash journal. Models the privileged installer intent
 * without ever performing an installation, restart or recovery.
 *
 * The only permitted storage location is a private OS-created test directory
 * whose basename begins domyro-firstboot-test-. No production host access.
 * A crashed writer leaves a lock that MUST be investigated manually.
 */
import { constants } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { compareVersions } from './release.mjs';

const INTENT = '.native-firstboot-intent.json';
const LOCK = '.native-firstboot-intent.lock';
const KIND = 'domyro-isolated-firstboot-intent';
const HEX = /^[a-f0-9]{64}$/;
const MAX_BYTES = 2048;
export const FIRSTBOOT_PHASES = Object.freeze([
  'intent_created',
  'signed_source_verified',
  'locked_dependencies_prepared',
  'database_owner_bootstrapped',
  'restricted_runtime_verified',
  'native_service_started',
  'http_login_and_persistence_verified',
  'test_completed',
]);

async function testDirectory(directory) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('firstboot_test_directory_required');
  const root = resolve(directory), temp = await realpath(tmpdir());
  if (!root.startsWith(temp + sep) ||
      !basename(root).startsWith('domyro-firstboot-test-') ||
      await realpath(root) !== root) throw new Error('firstboot_disposable_directory_only');
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
    throw new Error('firstboot_directory_not_private');
  }
  return root;
}
async function syncDirectory(root) {
  const fd = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await fd.sync(); } finally { await fd.close(); }
}
async function noLock(root) {
  try {
    await lstat(join(root, LOCK));
    throw new Error('firstboot_interrupted_writer_requires_manual_review');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
function validVersion(value) {
  try { compareVersions(value, value); return true; }
  catch { return false; }
}
function safeIntent(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) ||
      Object.keys(obj).sort().join(',') !==
        'gate,kind,manifestSha256,phase,publisherKeySha256,releaseVersion,schemaVersion,sequence' ||
      obj.schemaVersion !== 1 || obj.gate !== 'D-53' || obj.kind !== KIND ||
      !HEX.test(obj.manifestSha256 ?? '') || !HEX.test(obj.publisherKeySha256 ?? '') ||
      !validVersion(obj.releaseVersion) ||
      !Number.isSafeInteger(obj.sequence) || obj.sequence < 0 ||
      obj.sequence >= FIRSTBOOT_PHASES.length ||
      obj.phase !== FIRSTBOOT_PHASES[obj.sequence]) return false;
  return true;
}
async function readIntent(root) {
  let fd;
  try {
    fd = await open(join(root, INTENT), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch(error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('firstboot_intent_unreadable', { cause:error });
  }
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 ||
        (typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
        stat.size < 1 || stat.size > MAX_BYTES) throw new Error('firstboot_intent_unsafe');
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await fd.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size || bytesRead > MAX_BYTES) throw new Error('firstboot_intent_unsafe');
    let parsed;
    try { parsed = JSON.parse(bytes.subarray(0,bytesRead).toString('utf8')); }
    catch { throw new Error('firstboot_intent_corrupt'); }
    if (!safeIntent(parsed)) throw new Error('firstboot_intent_corrupt');
    return Object.freeze(parsed);
  } finally { await fd.close(); }
}
const status = intent => Object.freeze({
  ...intent,
  nextPhase: FIRSTBOOT_PHASES[intent.sequence + 1] ?? null,
  completeInDisposableTest: intent.phase === 'test_completed',
  installationAllowed: false, automaticRecoveryAllowed: false,
  productionServicesChanged: false,
});
export async function inspectFirstBootIntent({ directory } = {}) {
  const root = await testDirectory(directory);
  await noLock(root);
  const intent = await readIntent(root);
  await noLock(root);
  return intent ? status(intent) : null;
}
async function writeExclusiveIntent(root, obj) {
  const bytes = JSON.stringify(obj) + '\n';
  if (Buffer.byteLength(bytes) > MAX_BYTES) throw new Error('firstboot_intent_too_large');
  const fd = await open(join(root, INTENT),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,0o600);
  try { await fd.writeFile(bytes); await fd.sync(); }
  finally { await fd.close(); }
  await syncDirectory(root);
}
export async function createFirstBootIntent({
  directory, releaseVersion, manifestSha256, publisherKeySha256,
} = {}) {
  const root = await testDirectory(directory);
  const value = {
    schemaVersion:1, kind:KIND, gate:'D-53',
    releaseVersion, manifestSha256, publisherKeySha256,
    phase:'intent_created', sequence:0,
  };
  if (!safeIntent(value)) throw new TypeError('firstboot_intent_identity_invalid');
  await mkdir(join(root,LOCK), { mode:0o700 }); // exclusive concurrency guard
  let safeToUnlock = false;
  try {
    await syncDirectory(root);
    await writeExclusiveIntent(root,value);
    safeToUnlock = true;
    return status(Object.freeze(value));
  } finally {
    // On uncertain durability the crash-visible lock must remain.
    if (safeToUnlock) {
      await rmdir(join(root,LOCK));
      await syncDirectory(root);
    }
  }
}
export async function advanceFirstBootIntent({ directory, expectedPhase, nextPhase } = {}) {
  const root = await testDirectory(directory);
  if (typeof expectedPhase !== 'string' || typeof nextPhase !== 'string') {
    throw new TypeError('firstboot_phase_required');
  }
  await mkdir(join(root,LOCK), { mode:0o700 });
  let safeToUnlock = false, published = false, temporary = null;
  try {
    await syncDirectory(root);
    const current = await readIntent(root);
    if (!current) throw new Error('firstboot_intent_missing');
    if (current.phase !== expectedPhase ||
        FIRSTBOOT_PHASES[current.sequence + 1] !== nextPhase) {
      throw new Error('firstboot_phase_transition_denied');
    }
    const next = {
      ...current, phase:nextPhase, sequence:current.sequence+1,
    };
    if (!safeIntent(next)) throw new Error('firstboot_intent_invalid');
    temporary=join(root,'.firstboot-writing-'+randomBytes(16).toString('hex'));
    const fd=await open(temporary,constants.O_WRONLY | constants.O_CREAT |
      constants.O_EXCL | constants.O_NOFOLLOW,0o600);
    try { await fd.writeFile(JSON.stringify(next)+'\n'); await fd.sync(); }
    finally { await fd.close(); }
    await rename(temporary,join(root,INTENT));
    published=true;
    temporary=null;
    await syncDirectory(root);
    safeToUnlock=true;
    return status(Object.freeze(next));
  } catch (error) {
    // Failed validation and failure before rename leave the old journal intact.
    // A failure AFTER rename leaves a lock for manual recovery/investigation.
    if (!published) safeToUnlock=true;
    throw error;
  } finally {
    if (temporary) await rm(temporary,{force:true});
    if (safeToUnlock) {
      await rmdir(join(root,LOCK));
      await syncDirectory(root);
    }
  }
}
