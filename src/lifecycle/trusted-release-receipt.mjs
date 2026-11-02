// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Development-only, fail-closed durable high-water receipt for a signed release.
 * The directory MUST be a freshly created private test directory under os.tmpdir().
 * Never an installer, publisher trust store, active updater, or permission to deploy.
 *
 * Lock acquisition is exclusive and crash-visible. If interrupted while writing,
 * a surviving lock blocks ALL reads/writes until investigated by an operator.
 */
import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { compareVersions, verifySignedManifest } from './release.mjs';

const RECEIPT = '.trusted-release-receipt.json';
const LOCK = '.trusted-release-receipt.lock';
const KIND = 'domyro-development-trusted-release-receipt';
const HEX = /^[a-f0-9]{64}$/;
const MAX_BYTES = 2048;
const frozen = value => Object.freeze(value);

async function safeTestDirectory(directory) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('test_receipt_directory_required');
  const root = resolve(directory);
  const temp = await realpath(tmpdir());
  if (!root.startsWith(temp + sep) || !basename(root).startsWith('domyro-test-') ||
      await realpath(root) !== root) throw new Error('receipt_test_directory_only');
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid())) {
    throw new Error('receipt_directory_not_private');
  }
  return root;
}

function fingerprint(trustedPublicKeyPem) {
  const key = createPublicKey(trustedPublicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('receipt_pinned_key_must_be_ed25519');
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

async function syncDirectory(directory) {
  const fd = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await fd.sync(); } finally { await fd.close(); }
}

function validReceipt(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) ||
      Object.keys(obj).sort().join(',') !== 'gate,kind,manifestSha256,publisherKeySha256,schemaVersion,version' ||
      obj.schemaVersion !== 1 || obj.kind !== KIND || obj.gate !== 'D-53' ||
      !HEX.test(obj.manifestSha256 ?? '') || !HEX.test(obj.publisherKeySha256 ?? '')) return false;
  try { compareVersions(obj.version, obj.version); return true; }
  catch { return false; }
}

async function ensureUnlocked(root) {
  try {
    await lstat(join(root, LOCK));
    throw new Error('receipt_lock_requires_manual_investigation');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function readFileNoFollow(root) {
  let fd;
  try { fd = await open(join(root, RECEIPT), constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('receipt_unreadable', { cause: error });
  }
  try {
    const st = await fd.stat();
    if (!st.isFile() || st.nlink !== 1 || (st.mode & 0o077) ||
        (typeof process.getuid === 'function' && st.uid !== process.getuid()) ||
        st.size < 1 || st.size > MAX_BYTES) throw new Error('receipt_unsafe');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== st.size) throw new Error('receipt_unsafe');
    let obj;
    try { obj = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')); }
    catch { throw new Error('receipt_invalid'); }
    if (!validReceipt(obj)) throw new Error('receipt_invalid');
    return frozen(obj);
  } finally { await fd.close(); }
}

/** Read the receipt only when no interrupted update intent/lock exists. */
export async function readTrustedReleaseReceipt({ directory, trustedPublicKeyPem } = {}) {
  const root = await safeTestDirectory(directory);
  const pinned = fingerprint(trustedPublicKeyPem);
  await ensureUnlocked(root);
  const receipt = await readFileNoFollow(root);
  // Re-check after reading: refuse a concurrently started or crashed writer.
  await ensureUnlocked(root);
  if (receipt && receipt.publisherKeySha256 !== pinned) throw new Error('receipt_publisher_key_changed');
  return receipt;
}

/**
 * Record only the actual bytes of a verified Ed25519 release manifest.
 * Never accept a caller-supplied version/digest or downgrade/equivocation.
 * A private lock makes concurrent writers fail closed; fsync + atomic rename
 * make the record survive an ordinary process crash in the test fixture.
 */
export async function recordTrustedReleaseReceipt({
  directory, manifestBytes, signatureBase64, trustedPublicKeyPem,
} = {}) {
  // Authentication precedes ANY write, even creating the lock.
  const manifest = verifySignedManifest({ manifestBytes, signatureBase64, trustedPublicKeyPem });
  const pinned = fingerprint(trustedPublicKeyPem);
  const bytes = Buffer.isBuffer(manifestBytes) ? manifestBytes : Buffer.from(manifestBytes, 'utf8');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const root = await safeTestDirectory(directory);
  const lockPath = join(root, LOCK);
  await mkdir(lockPath, { mode: 0o700 }); // EEXIST is NOT retried or silently removed.
  let published = false;
  let releaseLock = false;
  let temporary = null;
  try {
    await syncDirectory(root);
    const old = await readFileNoFollow(root);
    if (old) {
      if (old.publisherKeySha256 !== pinned) throw new Error('receipt_publisher_key_changed');
      const order = compareVersions(manifest.version, old.version);
      if (order < 0) throw new Error('receipt_rollback_detected');
      if (order === 0 && old.manifestSha256 !== digest) throw new Error('receipt_equivocation_detected');
      if (order === 0) {
        releaseLock = true;
        return frozen({ ...old, unchanged: true, installAllowed: false });
      }
    }
    const receipt = {
      schemaVersion: 1, kind: KIND, gate: 'D-53',
      version: manifest.version, manifestSha256: digest, publisherKeySha256: pinned,
    };
    if (!validReceipt(receipt)) throw new Error('receipt_invalid');
    temporary = join(root, '.receipt-writing-' + randomBytes(16).toString('hex'));
    const fd = await open(temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await fd.writeFile(JSON.stringify(receipt) + '\n'); await fd.sync(); }
    finally { await fd.close(); }
    await rename(temporary, join(root, RECEIPT));
    temporary = null;
    published = true;
    await syncDirectory(root);
    releaseLock = true;
    return frozen({ ...receipt, unchanged: false, installAllowed: false });
  } catch (error) {
    // Any failure before rename has not modified the trusted record, so
    // clearing our lock is safe. After rename, fsync failure means uncertain
    // durability: retain the lock so future reads fail closed.
    if (!published) releaseLock = true;
    throw error;
  } finally {
    if (temporary) await rm(temporary, { force: true });
    if (releaseLock) {
      await rm(lockPath, { recursive: true, force: true });
      await syncDirectory(root);
    }
  }
}
