// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Explicit, OFFLINE crash-recovery drill for disposable source-pointer fixtures.
 * This is intentionally unusable for a real Domyro installation: the root must
 * be a private direct child of the OS temp directory with a special test prefix.
 * No service, database, network, package, device, or host configuration actions.
 *
 * The caller's "processExited" and "verifiedBackup" flags are TEST ASSERTIONS,
 * NOT independently established proofs of process quiescence or data recovery.
 * Never expose this as a production updater or install endpoint. D-53 CLOSED.
 */
import { constants } from 'node:fs';
import { lstat, open, realpath, readlink, symlink, rename, unlink, rm } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readActivationIntent, clearActivationIntent, syncActivationDirectory } from './activation-journal.mjs';
import {
  inspectActiveBundle, inspectInterruptedActivation, inspectVerifiedStagedBundle,
} from './transactional-release.mjs';

const TEST_PREFIX = 'domyro-recovery-rehearsal-';
const RECOVERY_LOCK = '.recovery.lock';

async function disposableRoot(root) {
  if (typeof root !== 'string' || !root) throw new Error('isolated_recovery_root_required');
  const base = await realpath(root);
  const temp = await realpath(tmpdir());
  if (dirname(base) !== temp || !basename(base).startsWith(TEST_PREFIX) ||
      basename(base).length <= TEST_PREFIX.length || base.includes(sep + '..')) {
    throw new Error('isolated_recovery_disposable_root_required');
  }
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw new Error('isolated_recovery_private_root_required');
  }
  return base;
}

async function inspectStaleLock(base) {
  try {
    const info = await lstat(join(base, '.activation.lock'));
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 ||
        info.size !== 0 || (info.mode & 0o077) !== 0) {
      throw new Error('isolated_recovery_activation_lock_unsafe');
    }
    return info;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Simulates the operator's manually approved return to the previous SIGNED
 * source tree after a killed test process. No live process is controlled.
 * A surviving intent is never cleared until the old signed tree and pointer
 * have both been verified again. Errors preserve the intent (fail closed).
 */
export async function rehearseInterruptedPointerRecovery({
  root, trustedPublicKeyPem, confirmedPreviousVersion,
  testOnly = false, processExited = false, verifiedBackup = false,
  onTestCheckpoint = null,
} = {}) {
  if (testOnly !== true || processExited !== true || verifiedBackup !== true) {
    throw new Error('isolated_recovery_explicit_test_approval_required');
  }
  if (typeof trustedPublicKeyPem !== 'string' || !trustedPublicKeyPem) {
    throw new Error('pinned_trust_root_required');
  }
  if (onTestCheckpoint !== null && typeof onTestCheckpoint !== 'function') {
    throw new TypeError('isolated_recovery_invalid_test_checkpoint');
  }
  const base = await disposableRoot(root);
  const lockPath = join(base, RECOVERY_LOCK);
  const lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT |
    constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  // The inode belongs to this recovery invocation. Never remove a lock that
  // has been replaced while we were running (even on a disposable fixture).
  const ownedLock = await lock.stat();
  try {
    const diagnosis = await inspectInterruptedActivation({ root: base, trustedPublicKeyPem });
    if (diagnosis.state !== 'interrupted') throw new Error('isolated_recovery_no_interrupted_intent');
    if (diagnosis.previous === null) throw new Error('isolated_recovery_no_signed_previous_version');
    if (confirmedPreviousVersion !== diagnosis.previous) {
      throw new Error('isolated_recovery_previous_version_confirmation_required');
    }
    if (!diagnosis.activeMatchesIntent || !diagnosis.previousSignedSourceVerified) {
      throw new Error('isolated_recovery_source_integrity_unverified');
    }
    const staleLock = await inspectStaleLock(base);
    const expected = { previous: diagnosis.previous, target: diagnosis.target };
    const currentIntent = await readActivationIntent(base);
    if (!currentIntent || currentIntent.previous !== expected.previous ||
        currentIntent.target !== expected.target ||
        (await inspectActiveBundle(base)) !== diagnosis.active) {
      throw new Error('isolated_recovery_state_changed');
    }
    await inspectVerifiedStagedBundle({ root: base, version: expected.previous, trustedPublicKeyPem });
    // Only an isolated symlink changes; no systemd, DB or user-owned paths.
    const tempLink = join(base, '.recovery-current-' + randomUUID());
    try {
      await symlink('releases/' + expected.previous, tempLink);
      await rename(tempLink, join(base, 'current'));
      await syncActivationDirectory(base);
    } finally {
      await rm(tempLink, { force: true });
    }
    // A test-only crash here must leave the durable intent, so retrying the
    // explicit recovery can complete without losing the prior signed source.
    if (onTestCheckpoint) await onTestCheckpoint('pointer_restored');
    if ((await inspectActiveBundle(base)) !== expected.previous) {
      throw new Error('isolated_recovery_pointer_verification_failed');
    }
    await inspectVerifiedStagedBundle({ root: base, version: expected.previous, trustedPublicKeyPem });
    // Remove the stale activation lock only if it is still the same inode.
    // If the rehearsal is interrupted here, the separate intent survives.
    if (staleLock) {
      const now = await inspectStaleLock(base);
      if (!now || now.dev !== staleLock.dev || now.ino !== staleLock.ino) {
        throw new Error('isolated_recovery_activation_lock_changed');
      }
      await unlink(join(base, '.activation.lock'));
      await syncActivationDirectory(base);
    }
    // A second crash window: stale activation lock is gone, but the journal
    // must still be present until the signed old pointer has been verified.
    if (onTestCheckpoint) await onTestCheckpoint('activation_lock_removed');
    // Keep the recovery lock held until the intent is durably cleared.
    await clearActivationIntent(base, expected);
    return Object.freeze({
      active: expected.previous, abandonedCandidate: expected.target,
      previousSignedSourceVerified: true, sourcePointerRestored: true,
      servicesTouched: false, databaseRestored: false,
      productionRecoveryApproved: false, gate: 'D-53',
    });
  } finally {
    try {
      const currentLock = await lstat(lockPath);
      if (!currentLock.isFile() || currentLock.isSymbolicLink() ||
          currentLock.dev !== ownedLock.dev || currentLock.ino !== ownedLock.ino ||
          currentLock.nlink !== 1 || (currentLock.mode & 0o077) !== 0) {
        throw new Error('isolated_recovery_lock_changed');
      }
    } finally {
      await lock.close();
    }
    // The preceding inode check is a fixture-only guard, not an atomic
    // process fence. A real updater requires a privileged locking service.
    await unlink(lockPath);
    await syncActivationDirectory(base);
  }
}
