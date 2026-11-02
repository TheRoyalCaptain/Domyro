// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Offline, read-only verification of a detached Ed25519-signed source release
 * as it exists ON DISK. The future native bootstrap must independently pin
 * the publisher key fingerprint before trusting a release.
 *
 * NO installer, no network, no writing, no unpacking, no service/DB changes.
 * D-53 remains closed even for a fully verified development bundle.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { verifySignedManifest } from './release.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_SIGNATURE_BYTES = 256;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 20;
const MAX_FUTURE_MS = 5 * 60_000;

function publisherFingerprint(keyPem) {
  const key = createPublicKey(keyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('ed25519_publisher_key_required');
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

async function inspectPrivateDirectory(directory) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('release_directory_required');
  const absolute = resolve(directory);
  const info = await lstat(absolute);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid()) ||
      await realpath(absolute) !== absolute) {
    throw new Error('release_directory_not_private_or_untrusted');
  }
  return absolute;
}

async function safeReadFile(root, filename, { limit, expectedBytes = null, expectedSha256 = null } = {}) {
  const pathname = join(root, filename);
  const pre = await lstat(pathname);
  if (!pre.isFile() || pre.isSymbolicLink() || pre.nlink !== 1 ||
      (pre.mode & 0o022) !== 0 || (typeof process.getuid === 'function' && pre.uid !== process.getuid()) ||
      pre.size < 1 || pre.size > limit ||
      (expectedBytes !== null && pre.size !== expectedBytes)) {
    throw new Error('release_file_unsafe_or_size_mismatch');
  }
  const handle = await open(pathname, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.dev !== pre.dev || info.ino !== pre.ino ||
        info.size !== pre.size || (info.mode & 0o022) !== 0) {
      throw new Error('release_file_changed_during_open');
    }
    const digest = createHash('sha256');
    const fragments = expectedSha256 === null ? [] : null;
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let read = 0;
    while (read < info.size) {
      const result = await handle.read(buffer, 0, Math.min(buffer.length, info.size - read), read);
      if (result.bytesRead <= 0) throw new Error('release_file_truncated');
      const chunk = buffer.subarray(0, result.bytesRead);
      digest.update(chunk);
      if (fragments) fragments.push(Buffer.from(chunk));
      read += result.bytesRead;
    }
    const after = await handle.stat();
    const pathAfter = await lstat(pathname);
    if (after.size !== info.size || after.ino !== info.ino || after.dev !== info.dev ||
        pathAfter.ino !== info.ino || pathAfter.dev !== info.dev ||
        !pathAfter.isFile() || pathAfter.isSymbolicLink() || pathAfter.nlink !== 1 ||
        (pathAfter.mode & 0o022) !== 0) {
      throw new Error('release_file_changed_during_read');
    }
    const sha256 = digest.digest('hex');
    if (expectedSha256 !== null && sha256 !== expectedSha256) throw new Error('release_artifact_hash_mismatch');
    return Object.freeze({ sha256, bytes: read, data: fragments ? Buffer.concat(fragments, read) : null });
  } finally {
    await handle.close();
  }
}

/**
 * Treat the package as an immutable, detached-signature release envelope.
 * The public-key SPKI fingerprint must originate from a distinct trusted
 * channel; it MUST NOT be read from the downloaded manifest/package.
 */
export async function inspectOfflineNativeSourceRelease({
  directory, trustedPublicKeyPem, expectedPublicKeySha256,
  architecture, databaseSchema, channel = 'stable', now = new Date(),
} = {}) {
  if (!SHA256.test(expectedPublicKeySha256 ?? '')) throw new Error('pinned_publisher_fingerprint_required');
  const actualFingerprint = publisherFingerprint(trustedPublicKeyPem);
  if (actualFingerprint !== expectedPublicKeySha256) throw new Error('publisher_key_fingerprint_mismatch');
  if (!['amd64', 'arm64'].includes(architecture)) throw new Error('native_architecture_unsupported');
  if (!Number.isSafeInteger(databaseSchema) || databaseSchema < 0) throw new Error('database_schema_evidence_required');
  if (!['stable', 'beta'].includes(channel)) throw new Error('native_release_channel_invalid');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('native_release_clock_invalid');
  const root = await inspectPrivateDirectory(directory);

  const manifestRead = await safeReadFile(root, 'release-manifest.json', { limit: MAX_MANIFEST_BYTES });
  const signatureRead = await safeReadFile(root, 'release-manifest.sig', { limit: MAX_SIGNATURE_BYTES });
  const signature = signatureRead.data.toString('utf8').replace(/\n$/, '');
  const manifest = verifySignedManifest({
    manifestBytes: manifestRead.data, signatureBase64: signature, trustedPublicKeyPem,
  });
  if (manifest.channel === 'beta' && channel === 'stable') throw new Error('release_channel_not_selected');
  if (Date.parse(manifest.publishedAt) > now.getTime() + MAX_FUTURE_MS) throw new Error('release_not_yet_published');
  if (databaseSchema < manifest.database.min || databaseSchema > manifest.database.max ||
      manifest.database.target !== databaseSchema || manifest.database.migration !== 'none') {
    throw new Error('release_database_migration_not_yet_supported');
  }
  if (!manifest.artifacts.some(item => item.os === 'ubuntu' && item.arch === architecture)) {
    throw new Error('signed_artifact_for_architecture_missing');
  }
  // Require the complete multiarchitecture package and nothing unlisted.
  const expected = new Set(['release-manifest.json', 'release-manifest.sig',
    ...manifest.artifacts.map(item => item.file)]);
  const actual = await readdir(root);
  if (actual.length !== expected.size || actual.length > MAX_ENTRIES ||
      actual.some(filename => !expected.has(filename))) throw new Error('release_package_entries_unexpected');

  const verifiedArtifacts = [];
  for (const artifact of manifest.artifacts) {
    if (artifact.bytes > MAX_ARTIFACT_BYTES) throw new Error('release_artifact_exceeds_bound');
    const verified = await safeReadFile(root, artifact.file, {
      limit: MAX_ARTIFACT_BYTES, expectedBytes: artifact.bytes, expectedSha256: artifact.sha256,
    });
    verifiedArtifacts.push(Object.freeze({
      os: artifact.os, architecture: artifact.arch, file: artifact.file,
      bytes: verified.bytes, sha256: verified.sha256,
    }));
  }
  // Post-read directory evidence is still informational; no activation is
  // permitted, and production code must revalidate at the actual use boundary.
  const after = await readdir(root);
  if (after.length !== expected.size || after.some(filename => !expected.has(filename))) {
    throw new Error('release_package_changed_during_inspection');
  }
  return Object.freeze({
    state: 'verified_development_source_package',
    version: manifest.version, publisherFingerprint: actualFingerprint,
    manifestSha256: manifestRead.sha256, channel: manifest.channel,
    architecture, databaseSchema, verifiedArtifacts: Object.freeze(verifiedArtifacts),
    signatureVerified: true, allArtifactsVerified: true,
    sourceOnly: true, productionRuntimeBundled: false,
    canInstall: false, canExecute: false, canUpdate: false,
    requiresOwnerReleaseApproval: true, installationGate: 'D-53',
    hostModified: false, networkRequested: false,
  });
}
